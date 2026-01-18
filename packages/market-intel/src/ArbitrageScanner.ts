import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import {
  ArbitrageOpportunity,
  ExecutionStep,
  TriangularArbitrage,
  StatisticalArbitrage,
  ArbitrageScannerConfig,
  TelemetryClient,
  MarketIntelTelemetryEvent
} from './types';

const logger = new Logger('ArbitrageScanner');
interface PriceData {
  symbol: string;
  exchange: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: Date;
}

interface CrossChainRoute {
  fromChain: string;
  toChain: string;
  bridge: string;
  fee: number;
  time: number; // seconds
}

export class ArbitrageScanner extends EventEmitter {
  private config: ArbitrageScannerConfig;
  private telemetry: TelemetryClient;
  private priceFeeds: Map<string, PriceData[]>;
  private crossChainRoutes: CrossChainRoute[];
  private triangularScanner: TriangularArbitrageScanner;
  private statisticalScanner: StatisticalArbitrageScanner;
  private crossExchangeScanner: CrossExchangeArbitrageScanner;
  private crossChainScanner: CrossChainArbitrageScanner;
  private opportunityCache: Map<string, ArbitrageOpportunity>;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor(config: ArbitrageScannerConfig, telemetry: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.priceFeeds = new Map();
    this.crossChainRoutes = this.initializeCrossChainRoutes();
    this.triangularScanner = new TriangularArbitrageScanner(config);
    this.statisticalScanner = new StatisticalArbitrageScanner(config);
    this.crossExchangeScanner = new CrossExchangeArbitrageScanner(config);
    this.crossChainScanner = new CrossChainArbitrageScanner(config, this.crossChainRoutes);
    this.opportunityCache = new Map();
  }

  async scanForOpportunities(priceData: PriceData[]): Promise<ArbitrageOpportunity[]> {
    const startTime = Date.now();
    const opportunities: ArbitrageOpportunity[] = [];

    try {
      // Update price feeds
      this.updatePriceFeeds(priceData);

      // Run different arbitrage scanners in parallel
      const [triangular, statistical, crossExchange, crossChain] = await Promise.all([
        this.triangularScanner.scan(this.priceFeeds),
        this.statisticalScanner.scan(this.priceFeeds),
        this.crossExchangeScanner.scan(this.priceFeeds),
        this.crossChainScanner.scan(this.priceFeeds)
      ]);

      // Combine and filter opportunities
      const allOpportunities = [
        ...triangular,
        ...statistical,
        ...crossExchange,
        ...crossChain
      ];

      // Filter by profitability and risk
      for (const opp of allOpportunities) {
        if (this.isViableOpportunity(opp)) {
          opportunities.push(opp);
        }
      }

      // Sort by profitability
      opportunities.sort((a, b) => b.profitability - a.profitability);

      // Emit high-value opportunities
      for (const opp of opportunities) {
        if (opp.profitUSD > 1000) {
          this.emit('high_value_opportunity', opp);
        }
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'arbitrage_found',
        data: {
          count: opportunities.length,
          totalProfitUSD: opportunities.reduce((sum, o) => sum + o.profitUSD, 0),
          types: this.countOpportunityTypes(opportunities)
        },
        duration: Date.now() - startTime,
        timestamp: new Date()
      });

      return opportunities;
    } catch (error) {
      logger.error('Arbitrage scanning error:', error);
      throw error;
    }
  }

  async analyzeOpportunity(opportunity: ArbitrageOpportunity): Promise<{
    viable: boolean;
    adjustedProfit: number;
    risks: string[];
    executionPlan: ExecutionStep[];
  }> {
    // Check cache
    const cached = this.opportunityCache.get(opportunity.id);
    if (cached && Date.now() - cached.timestamp.getTime() < this.CACHE_TTL) {
      return {
        viable: true,
        adjustedProfit: cached.profitUSD,
        risks: [],
        executionPlan: cached.executionPath
      };
    }

    const risks: string[] = [];
    let adjustedProfit = opportunity.profitUSD;

    // Analyze execution risks
    if (opportunity.timeWindow < 5) {
      risks.push('Very short time window - high execution risk');
      adjustedProfit *= 0.7;
    }

    // Check liquidity
    const liquidityRisk = this.assessLiquidityRisk(opportunity);
    if (liquidityRisk > 0.3) {
      risks.push('Liquidity risk - potential slippage');
      adjustedProfit *= (1 - liquidityRisk);
    }

    // Gas cost analysis for cross-chain
    if (opportunity.type === 'crossChain' && opportunity.gasEstimate) {
      const gasCostUSD = Number(opportunity.gasEstimate) / 1e9 * 50; // Assume $50/gwei
      adjustedProfit -= gasCostUSD;
      if (gasCostUSD > opportunity.profitUSD * 0.3) {
        risks.push('High gas costs relative to profit');
      }
    }

    // Market impact assessment
    const marketImpact = this.estimateMarketImpact(opportunity);
    if (marketImpact > 0.01) {
      risks.push(`Market impact: ${(marketImpact * 100).toFixed(2)}%`);
      adjustedProfit *= (1 - marketImpact);
    }

    // Competition risk
    if (opportunity.confidence < 0.7) {
      risks.push('High competition - opportunity may be taken quickly');
    }

    const viable = adjustedProfit > this.config.minProfitPercentage * opportunity.requiredCapital / 100;

    // Cache the analysis
    if (viable) {
      this.opportunityCache.set(opportunity.id, opportunity);
    }

    return {
      viable,
      adjustedProfit,
      risks,
      executionPlan: opportunity.executionPath
    };
  }

  getHistoricalOpportunities(
    type?: string,
    minProfit?: number
  ): ArbitrageOpportunity[] {
    let opportunities = Array.from(this.opportunityCache.values());

    if (type) {
      opportunities = opportunities.filter(o => o.type === type);
    }

    if (minProfit) {
      opportunities = opportunities.filter(o => o.profitUSD >= minProfit);
    }

    return opportunities.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  private updatePriceFeeds(priceData: PriceData[]): void {
    for (const data of priceData) {
      const key = `${data.symbol}-${data.exchange}`;
      
      if (!this.priceFeeds.has(key)) {
        this.priceFeeds.set(key, []);
      }

      const feed = this.priceFeeds.get(key)!;
      feed.push(data);

      // Keep only recent data
      const cutoff = Date.now() - 300000; // 5 minutes
      const filtered = feed.filter(d => d.timestamp.getTime() > cutoff);
      this.priceFeeds.set(key, filtered);
    }
  }

  private isViableOpportunity(opportunity: ArbitrageOpportunity): boolean {
    // Check minimum profit
    if (opportunity.profitability < this.config.minProfitPercentage) {
      return false;
    }

    // Check capital requirements
    if (opportunity.requiredCapital > this.config.capitalLimit) {
      return false;
    }

    // Check execution time
    if (opportunity.executionPath.reduce((sum, step) => sum + step.estimatedTime, 0) > 
        this.config.maxExecutionTime) {
      return false;
    }

    // Check risk score
    if (opportunity.riskScore > 0.7) {
      return false;
    }

    return true;
  }

  private assessLiquidityRisk(opportunity: ArbitrageOpportunity): number {
    let risk = 0;

    for (const step of opportunity.executionPath) {
      // Assess liquidity based on order size vs available liquidity
      const sizeRatio = step.amount / (step.amount * 10); // Simplified
      risk += sizeRatio * 0.2;
    }

    return Math.min(risk, 1);
  }

  private estimateMarketImpact(opportunity: ArbitrageOpportunity): number {
    let totalImpact = 0;

    for (const step of opportunity.executionPath) {
      // Simplified market impact model
      const impact = Math.sqrt(step.amount / 1000000) * 0.01;
      totalImpact += impact;
    }

    return totalImpact;
  }

  private countOpportunityTypes(opportunities: ArbitrageOpportunity[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const opp of opportunities) {
      counts[opp.type] = (counts[opp.type] || 0) + 1;
    }

    return counts;
  }

  private initializeCrossChainRoutes(): CrossChainRoute[] {
    // Initialize with common cross-chain bridges
    return [
      {
        fromChain: 'ethereum',
        toChain: 'polygon',
        bridge: 'polygon-bridge',
        fee: 0.001,
        time: 300
      },
      {
        fromChain: 'ethereum',
        toChain: 'arbitrum',
        bridge: 'arbitrum-bridge',
        fee: 0.002,
        time: 600
      },
      {
        fromChain: 'ethereum',
        toChain: 'optimism',
        bridge: 'optimism-bridge',
        fee: 0.002,
        time: 1800
      },
      {
        fromChain: 'bsc',
        toChain: 'polygon',
        bridge: 'multichain',
        fee: 0.001,
        time: 180
      }
    ];
  }

  async stop(): Promise<void> {
    this.priceFeeds.clear();
    this.opportunityCache.clear();
    await this.telemetry.flush();
  }
}

// Supporting scanner classes
class TriangularArbitrageScanner {
  private config: ArbitrageScannerConfig;

  constructor(config: ArbitrageScannerConfig) {
    this.config = config;
  }

  async scan(priceFeeds: Map<string, PriceData[]>): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    const exchanges = this.getUniqueExchanges(priceFeeds);

    for (const exchange of exchanges) {
      const pairs = this.getExchangePairs(priceFeeds, exchange);
      const triangles = this.findTriangularPaths(pairs);

      for (const triangle of triangles) {
        const opportunity = this.evaluateTriangle(triangle, priceFeeds, exchange);
        if (opportunity && opportunity.profitability > this.config.minProfitPercentage) {
          opportunities.push(opportunity);
        }
      }
    }

    return opportunities;
  }

  private getUniqueExchanges(priceFeeds: Map<string, PriceData[]>): string[] {
    const exchanges = new Set<string>();
    
    for (const [key, data] of priceFeeds) {
      if (data.length > 0) {
        exchanges.add(data[0].exchange);
      }
    }

    return Array.from(exchanges);
  }

  private getExchangePairs(priceFeeds: Map<string, PriceData[]>, exchange: string): string[] {
    const pairs: string[] = [];

    for (const [key, data] of priceFeeds) {
      if (data.length > 0 && data[0].exchange === exchange) {
        pairs.push(data[0].symbol);
      }
    }

    return pairs;
  }

  private findTriangularPaths(pairs: string[]): TriangularArbitrage[] {
    const triangles: TriangularArbitrage[] = [];
    const currencies = this.extractCurrencies(pairs);

    // Find all possible triangular paths
    for (const base of currencies) {
      for (const quote1 of currencies) {
        if (quote1 === base) continue;
        
        for (const quote2 of currencies) {
          if (quote2 === base || quote2 === quote1) continue;

          // Check if path exists
          const pair1 = `${base}/${quote1}`;
          const pair2 = `${quote1}/${quote2}`;
          const pair3 = `${quote2}/${base}`;

          if (pairs.includes(pair1) || pairs.includes(`${quote1}/${base}`)) {
            if (pairs.includes(pair2) || pairs.includes(`${quote2}/${quote1}`)) {
              if (pairs.includes(pair3) || pairs.includes(`${base}/${quote2}`)) {
                triangles.push({
                  path: [pair1, pair2, pair3],
                  exchanges: [],
                  profitPercentage: 0,
                  volumeLimit: 0
                });
              }
            }
          }
        }
      }
    }

    return triangles;
  }

  private extractCurrencies(pairs: string[]): string[] {
    const currencies = new Set<string>();

    for (const pair of pairs) {
      const [base, quote] = pair.split('/');
      currencies.add(base);
      currencies.add(quote);
    }

    return Array.from(currencies);
  }

  private evaluateTriangle(
    triangle: TriangularArbitrage,
    priceFeeds: Map<string, PriceData[]>,
    exchange: string
  ): ArbitrageOpportunity | null {
    const executionPath: ExecutionStep[] = [];
    let currentAmount = 1000; // Start with $1000
    let totalFees = 0;

    for (let i = 0; i < triangle.path.length; i++) {
      const pair = triangle.path[i];
      const priceData = this.getLatestPrice(priceFeeds, pair, exchange);
      
      if (!priceData) return null;

      const [base, quote] = pair.split('/');
      const isForward = i === 0 || (i === 1 && triangle.path[0].split('/')[1] === base);
      
      const step: ExecutionStep = {
        action: 'swap',
        venue: exchange,
        fromAsset: isForward ? base : quote,
        toAsset: isForward ? quote : base,
        amount: currentAmount,
        price: isForward ? priceData.ask : 1 / priceData.bid,
        fees: currentAmount * 0.001, // 0.1% fee
        estimatedTime: 1
      };

      executionPath.push(step);
      totalFees += step.fees;
      currentAmount = isForward ? 
        currentAmount / priceData.ask * (1 - 0.001) :
        currentAmount * priceData.bid * (1 - 0.001);
    }

    const profit = currentAmount - 1000;
    const profitPercentage = (profit / 1000) * 100;

    if (profitPercentage <= this.config.minProfitPercentage) {
      return null;
    }

    return {
      id: `tri-${exchange}-${Date.now()}`,
      type: 'triangular',
      profitability: profitPercentage,
      profitUSD: profit,
      requiredCapital: 1000,
      executionPath,
      riskScore: this.calculateRiskScore(profitPercentage, executionPath),
      timeWindow: 30,
      confidence: 0.8,
      timestamp: new Date()
    };
  }

  private getLatestPrice(
    priceFeeds: Map<string, PriceData[]>,
    pair: string,
    exchange: string
  ): PriceData | null {
    const key = `${pair}-${exchange}`;
    const feed = priceFeeds.get(key);
    
    if (!feed || feed.length === 0) {
      // Try reverse pair
      const [base, quote] = pair.split('/');
      const reverseKey = `${quote}/${base}-${exchange}`;
      const reverseFeed = priceFeeds.get(reverseKey);
      
      if (!reverseFeed || reverseFeed.length === 0) return null;
      
      const reversePrice = reverseFeed[reverseFeed.length - 1];
      return {
        ...reversePrice,
        bid: 1 / reversePrice.ask,
        ask: 1 / reversePrice.bid
      };
    }

    return feed[feed.length - 1];
  }

  private calculateRiskScore(profitPercentage: number, path: ExecutionStep[]): number {
    let risk = 0;

    // Lower profit = higher risk
    if (profitPercentage < 0.5) risk += 0.3;
    else if (profitPercentage < 1) risk += 0.2;

    // More steps = higher risk
    risk += path.length * 0.1;

    // Time sensitivity
    risk += 0.2; // Triangular arb is time-sensitive

    return Math.min(risk, 1);
  }
}

class StatisticalArbitrageScanner {
  private config: ArbitrageScannerConfig;
  private pairCorrelations: Map<string, number>;
  private meanReversions: Map<string, { mean: number; stdDev: number }>;

  constructor(config: ArbitrageScannerConfig) {
    this.config = config;
    this.pairCorrelations = new Map();
    this.meanReversions = new Map();
  }

  async scan(priceFeeds: Map<string, PriceData[]>): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Update correlations and mean reversion parameters
    this.updateStatistics(priceFeeds);

    // Find correlated pairs
    const correlatedPairs = this.findCorrelatedPairs(priceFeeds);

    for (const [pair1, pair2] of correlatedPairs) {
      const opportunity = this.evaluatePairTrade(pair1, pair2, priceFeeds);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }

    return opportunities;
  }

  private updateStatistics(priceFeeds: Map<string, PriceData[]>): void {
    // Calculate correlations between all pairs
    const symbols = Array.from(priceFeeds.keys());

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const correlation = this.calculateCorrelation(
          priceFeeds.get(symbols[i])!,
          priceFeeds.get(symbols[j])!
        );

        if (correlation > 0.8) {
          this.pairCorrelations.set(`${symbols[i]}-${symbols[j]}`, correlation);
        }
      }
    }

    // Calculate mean reversion parameters
    for (const [symbol, data] of priceFeeds) {
      if (data.length > 20) {
        const prices = data.map(d => (d.bid + d.ask) / 2);
        const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        this.meanReversions.set(symbol, { mean, stdDev });
      }
    }
  }

  private calculateCorrelation(data1: PriceData[], data2: PriceData[]): number {
    if (data1.length < 20 || data2.length < 20) return 0;

    const prices1 = data1.slice(-20).map(d => (d.bid + d.ask) / 2);
    const prices2 = data2.slice(-20).map(d => (d.bid + d.ask) / 2);

    const returns1 = this.calculateReturns(prices1);
    const returns2 = this.calculateReturns(prices2);

    return this.pearsonCorrelation(returns1, returns2);
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length) return 0;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
    const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
    const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private findCorrelatedPairs(priceFeeds: Map<string, PriceData[]>): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];

    for (const [key, correlation] of this.pairCorrelations) {
      if (correlation > 0.85) {
        const [pair1, pair2] = key.split('-');
        pairs.push([pair1, pair2]);
      }
    }

    return pairs;
  }

  private evaluatePairTrade(
    symbol1: string,
    symbol2: string,
    priceFeeds: Map<string, PriceData[]>
  ): ArbitrageOpportunity | null {
    const data1 = priceFeeds.get(symbol1);
    const data2 = priceFeeds.get(symbol2);

    if (!data1 || !data2 || data1.length === 0 || data2.length === 0) {
      return null;
    }

    const price1 = (data1[data1.length - 1].bid + data1[data1.length - 1].ask) / 2;
    const price2 = (data2[data2.length - 1].bid + data2[data2.length - 1].ask) / 2;

    const stats1 = this.meanReversions.get(symbol1);
    const stats2 = this.meanReversions.get(symbol2);

    if (!stats1 || !stats2) return null;

    // Calculate z-scores
    const zScore1 = (price1 - stats1.mean) / stats1.stdDev;
    const zScore2 = (price2 - stats2.mean) / stats2.stdDev;
    const spreadZScore = zScore1 - zScore2;

    // Check for trading signal
    if (Math.abs(spreadZScore) < 2) return null;

    const executionPath: ExecutionStep[] = [];
    const capital = 10000;

    if (spreadZScore > 2) {
      // Short symbol1, long symbol2
      executionPath.push({
        action: 'sell',
        venue: data1[0].exchange,
        fromAsset: symbol1.split('/')[0],
        toAsset: symbol1.split('/')[1],
        amount: capital / 2 / price1,
        price: data1[data1.length - 1].bid,
        fees: capital / 2 * 0.001,
        estimatedTime: 1
      });

      executionPath.push({
        action: 'buy',
        venue: data2[0].exchange,
        fromAsset: symbol2.split('/')[1],
        toAsset: symbol2.split('/')[0],
        amount: capital / 2 / price2,
        price: data2[data2.length - 1].ask,
        fees: capital / 2 * 0.001,
        estimatedTime: 1
      });
    } else {
      // Long symbol1, short symbol2
      executionPath.push({
        action: 'buy',
        venue: data1[0].exchange,
        fromAsset: symbol1.split('/')[1],
        toAsset: symbol1.split('/')[0],
        amount: capital / 2 / price1,
        price: data1[data1.length - 1].ask,
        fees: capital / 2 * 0.001,
        estimatedTime: 1
      });

      executionPath.push({
        action: 'sell',
        venue: data2[0].exchange,
        fromAsset: symbol2.split('/')[0],
        toAsset: symbol2.split('/')[1],
        amount: capital / 2 / price2,
        price: data2[data2.length - 1].bid,
        fees: capital / 2 * 0.001,
        estimatedTime: 1
      });
    }

    // Estimate profit based on mean reversion
    const expectedReturn = Math.abs(spreadZScore) * 0.5 * stats1.stdDev / stats1.mean;
    const profitUSD = capital * expectedReturn;

    return {
      id: `stat-${symbol1}-${symbol2}-${Date.now()}`,
      type: 'statistical',
      profitability: expectedReturn * 100,
      profitUSD,
      requiredCapital: capital,
      executionPath,
      riskScore: 0.4, // Statistical arb is generally lower risk
      timeWindow: 3600, // 1 hour
      confidence: Math.min(0.9, Math.abs(spreadZScore) / 3),
      timestamp: new Date()
    };
  }
}

class CrossExchangeArbitrageScanner {
  private config: ArbitrageScannerConfig;

  constructor(config: ArbitrageScannerConfig) {
    this.config = config;
  }

  async scan(priceFeeds: Map<string, PriceData[]>): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    const symbolExchangeMap = this.buildSymbolExchangeMap(priceFeeds);

    for (const [symbol, exchanges] of symbolExchangeMap) {
      if (exchanges.length < 2) continue;

      const opportunity = this.findCrossExchangeOpportunity(symbol, exchanges, priceFeeds);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }

    return opportunities;
  }

  private buildSymbolExchangeMap(priceFeeds: Map<string, PriceData[]>): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const [key, data] of priceFeeds) {
      if (data.length > 0) {
        const symbol = data[0].symbol;
        const exchange = data[0].exchange;

        if (!map.has(symbol)) {
          map.set(symbol, []);
        }

        map.get(symbol)!.push(exchange);
      }
    }

    return map;
  }

  private findCrossExchangeOpportunity(
    symbol: string,
    exchanges: string[],
    priceFeeds: Map<string, PriceData[]>
  ): ArbitrageOpportunity | null {
    let bestOpportunity: ArbitrageOpportunity | null = null;
    let maxProfit = 0;

    for (let i = 0; i < exchanges.length; i++) {
      for (let j = i + 1; j < exchanges.length; j++) {
        const data1 = priceFeeds.get(`${symbol}-${exchanges[i]}`);
        const data2 = priceFeeds.get(`${symbol}-${exchanges[j]}`);

        if (!data1 || !data2 || data1.length === 0 || data2.length === 0) continue;

        const price1 = data1[data1.length - 1];
        const price2 = data2[data2.length - 1];

        // Check for arbitrage opportunity
        if (price1.ask < price2.bid) {
          // Buy on exchange1, sell on exchange2
          const spread = price2.bid - price1.ask;
          const spreadPercentage = (spread / price1.ask) * 100;

          if (spreadPercentage > this.config.minProfitPercentage) {
            const opportunity = this.createOpportunity(
              symbol, exchanges[i], exchanges[j],
              price1, price2, 'buy-sell'
            );

            if (opportunity.profitUSD > maxProfit) {
              bestOpportunity = opportunity;
              maxProfit = opportunity.profitUSD;
            }
          }
        } else if (price2.ask < price1.bid) {
          // Buy on exchange2, sell on exchange1
          const spread = price1.bid - price2.ask;
          const spreadPercentage = (spread / price2.ask) * 100;

          if (spreadPercentage > this.config.minProfitPercentage) {
            const opportunity = this.createOpportunity(
              symbol, exchanges[j], exchanges[i],
              price2, price1, 'buy-sell'
            );

            if (opportunity.profitUSD > maxProfit) {
              bestOpportunity = opportunity;
              maxProfit = opportunity.profitUSD;
            }
          }
        }
      }
    }

    return bestOpportunity;
  }

  private createOpportunity(
    symbol: string,
    buyExchange: string,
    sellExchange: string,
    buyPrice: PriceData,
    sellPrice: PriceData,
    type: string
  ): ArbitrageOpportunity {
    const [base, quote] = symbol.split('/');
    const capital = Math.min(
      buyPrice.askSize * buyPrice.ask,
      sellPrice.bidSize * sellPrice.bid,
      this.config.capitalLimit
    );

    const buyAmount = capital / buyPrice.ask;
    const sellProceeds = buyAmount * sellPrice.bid;
    const fees = capital * 0.002; // 0.1% each side
    const profit = sellProceeds - capital - fees;
    const profitPercentage = (profit / capital) * 100;

    const executionPath: ExecutionStep[] = [
      {
        action: 'buy',
        venue: buyExchange,
        fromAsset: quote,
        toAsset: base,
        amount: buyAmount,
        price: buyPrice.ask,
        fees: capital * 0.001,
        estimatedTime: 2
      },
      {
        action: 'sell',
        venue: sellExchange,
        fromAsset: base,
        toAsset: quote,
        amount: buyAmount,
        price: sellPrice.bid,
        fees: sellProceeds * 0.001,
        estimatedTime: 2
      }
    ];

    return {
      id: `cross-${symbol}-${buyExchange}-${sellExchange}-${Date.now()}`,
      type: 'crossExchange',
      profitability: profitPercentage,
      profitUSD: profit,
      requiredCapital: capital,
      executionPath,
      riskScore: this.calculateRiskScore(profitPercentage, capital),
      timeWindow: 10,
      confidence: 0.85,
      timestamp: new Date()
    };
  }

  private calculateRiskScore(profitPercentage: number, capital: number): number {
    let risk = 0.2; // Base risk for cross-exchange

    // Lower profit = higher risk
    if (profitPercentage < 1) risk += 0.2;

    // Higher capital = higher risk
    if (capital > 10000) risk += 0.1;
    if (capital > 50000) risk += 0.1;

    // Exchange risk
    risk += 0.1; // Withdrawal/deposit delays

    return Math.min(risk, 1);
  }
}

class CrossChainArbitrageScanner {
  private config: ArbitrageScannerConfig;
  private crossChainRoutes: CrossChainRoute[];

  constructor(config: ArbitrageScannerConfig, routes: CrossChainRoute[]) {
    this.config = config;
    this.crossChainRoutes = routes;
  }

  async scan(priceFeeds: Map<string, PriceData[]>): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];

    // Group price feeds by chain
    const chainPrices = this.groupPricesByChain(priceFeeds);

    // Check each cross-chain route
    for (const route of this.crossChainRoutes) {
      const fromPrices = chainPrices.get(route.fromChain);
      const toPrices = chainPrices.get(route.toChain);

      if (!fromPrices || !toPrices) continue;

      // Find common tokens
      const commonTokens = this.findCommonTokens(fromPrices, toPrices);

      for (const token of commonTokens) {
        const opportunity = this.evaluateCrossChainArbitrage(
          token, route, fromPrices, toPrices
        );

        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }

    return opportunities;
  }

  private groupPricesByChain(priceFeeds: Map<string, PriceData[]>): Map<string, Map<string, PriceData>> {
    const chainPrices = new Map<string, Map<string, PriceData>>();

    // This is simplified - in reality, you'd need to map exchanges to chains
    const exchangeChainMap: Record<string, string> = {
      'uniswap': 'ethereum',
      'sushiswap': 'ethereum',
      'quickswap': 'polygon',
      'pancakeswap': 'bsc',
      'spookyswap': 'fantom'
    };

    for (const [key, data] of priceFeeds) {
      if (data.length === 0) continue;

      const latestPrice = data[data.length - 1];
      const chain = exchangeChainMap[latestPrice.exchange] || 'ethereum';

      if (!chainPrices.has(chain)) {
        chainPrices.set(chain, new Map());
      }

      const [base] = latestPrice.symbol.split('/');
      chainPrices.get(chain)!.set(base, latestPrice);
    }

    return chainPrices;
  }

  private findCommonTokens(
    fromPrices: Map<string, PriceData>,
    toPrices: Map<string, PriceData>
  ): string[] {
    const common: string[] = [];

    for (const token of fromPrices.keys()) {
      if (toPrices.has(token)) {
        common.push(token);
      }
    }

    return common;
  }

  private evaluateCrossChainArbitrage(
    token: string,
    route: CrossChainRoute,
    fromPrices: Map<string, PriceData>,
    toPrices: Map<string, PriceData>
  ): ArbitrageOpportunity | null {
    const fromPrice = fromPrices.get(token);
    const toPrice = toPrices.get(token);

    if (!fromPrice || !toPrice) return null;

    const fromMidPrice = (fromPrice.bid + fromPrice.ask) / 2;
    const toMidPrice = (toPrice.bid + toPrice.ask) / 2;

    // Calculate potential profit considering bridge fees
    const priceDiff = Math.abs(toMidPrice - fromMidPrice);
    const priceDiffPercentage = (priceDiff / Math.min(fromMidPrice, toMidPrice)) * 100;

    // Must cover bridge fee and leave profit
    if (priceDiffPercentage <= route.fee * 100 + this.config.minProfitPercentage) {
      return null;
    }

    const capital = 10000; // $10k default
    let executionPath: ExecutionStep[] = [];

    if (fromMidPrice < toMidPrice) {
      // Buy on fromChain, bridge, sell on toChain
      const buyAmount = capital / fromPrice.ask;
      const bridgedAmount = buyAmount * (1 - route.fee);
      const sellProceeds = bridgedAmount * toPrice.bid;

      executionPath = [
        {
          action: 'buy',
          venue: fromPrice.exchange,
          fromAsset: 'USDC',
          toAsset: token,
          amount: buyAmount,
          price: fromPrice.ask,
          fees: capital * 0.003,
          estimatedTime: 30
        },
        {
          action: 'bridge',
          venue: route.bridge,
          fromAsset: `${token}-${route.fromChain}`,
          toAsset: `${token}-${route.toChain}`,
          amount: buyAmount,
          price: 1,
          fees: buyAmount * route.fee,
          estimatedTime: route.time
        },
        {
          action: 'sell',
          venue: toPrice.exchange,
          fromAsset: token,
          toAsset: 'USDC',
          amount: bridgedAmount,
          price: toPrice.bid,
          fees: sellProceeds * 0.003,
          estimatedTime: 30
        }
      ];

      const totalFees = capital * 0.003 + buyAmount * route.fee + sellProceeds * 0.003;
      const profit = sellProceeds - capital - totalFees;
      const profitPercentage = (profit / capital) * 100;

      if (profitPercentage <= this.config.minProfitPercentage) {
        return null;
      }

      return {
        id: `chain-${token}-${route.fromChain}-${route.toChain}-${Date.now()}`,
        type: 'crossChain',
        profitability: profitPercentage,
        profitUSD: profit,
        requiredCapital: capital,
        executionPath,
        riskScore: 0.6, // Higher risk due to bridge delays
        gasEstimate: BigInt(200000), // Estimated gas for bridge
        timeWindow: route.time + 120,
        confidence: 0.7,
        timestamp: new Date()
      };
    }

    return null;
  }
} 
/**
 * Cross-Exchange & Multi-Chain Arbitrage Engine
 * 

 * opportunities across CEXs, DEXs, and multiple blockchain networks.
 */

import { EventEmitter } from 'events';
import { BigNumber, ethers } from 'ethers';
import {
  ArbitrageOpportunity,
  CrossChainArbitrage,
  StatisticalArbitrage,
  ArbitrageRoute
} from '@noderr/types';

interface ArbitrageConfig {
  minProfitThreshold: BigNumber; // Minimum profit in USD
  maxLatency: number; // Maximum acceptable latency in ms
  slippageTolerance: number; // 0-1
  gasBuffer: number; // Gas price multiplier
  maxCapitalPerTrade: BigNumber;
  enableFlashLoans: boolean;
  enableCrossChain: boolean;
  statisticalThreshold: number; // Z-score threshold
}

interface VenueData {
  name: string;
  type: 'cex' | 'dex' | 'amm';
  chainId?: number;
  latency: number;
  fees: {
    maker: number;
    taker: number;
    withdrawal?: number;
  };
  minOrderSize: Record<string, number>;
}

interface PricePoint {
  venue: string;
  price: number;
  volume: number;
  timestamp: number;
  side: 'bid' | 'ask';
}

interface Graph {
  [asset: string]: {
    [targetAsset: string]: {
      venue: string;
      rate: number;
      volume: number;
      gasEstimate?: BigNumber;
    }[];
  };
}

export class ArbitrageEngine extends EventEmitter {
  private config: ArbitrageConfig;
  private venues: Map<string, VenueData> = new Map();
  private priceFeeds: Map<string, PricePoint[]> = new Map();
  private graph: Graph = {};
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private executionHistory: ArbitrageOpportunity[] = [];
  private statisticalPairs: Map<string, StatisticalArbitrage> = new Map();
  
  constructor(config: Partial<ArbitrageConfig> = {}) {
    super();
    
    this.config = {
      minProfitThreshold: BigNumber.from('100'), // $100 minimum
      maxLatency: 100, // 100ms max latency
      slippageTolerance: 0.005, // 0.5%
      gasBuffer: 1.2, // 20% gas buffer
      maxCapitalPerTrade: BigNumber.from('1000000'), // $1M max
      enableFlashLoans: true,
      enableCrossChain: true,
      statisticalThreshold: 2.5, // 2.5 standard deviations
      ...config
    };
    
    this.initializeVenues();
    this.startArbitrageScanning();
  }

  /**
   * Initialize supported venues
   */
  private initializeVenues(): void {
    // CEXs
    this.venues.set('binance', {
      name: 'binance',
      type: 'cex',
      latency: 20,
      fees: { maker: 0.001, taker: 0.001 },
      minOrderSize: { BTC: 0.001, ETH: 0.01 }
    });
    
    this.venues.set('coinbase', {
      name: 'coinbase',
      type: 'cex',
      latency: 30,
      fees: { maker: 0.005, taker: 0.005 },
      minOrderSize: { BTC: 0.001, ETH: 0.01 }
    });
    
    // DEXs
    this.venues.set('uniswap_v3', {
      name: 'uniswap_v3',
      type: 'dex',
      chainId: 1,
      latency: 100,
      fees: { maker: 0.003, taker: 0.003 },
      minOrderSize: {}
    });
    
    this.venues.set('pancakeswap', {
      name: 'pancakeswap',
      type: 'dex',
      chainId: 56,
      latency: 80,
      fees: { maker: 0.0025, taker: 0.0025 },
      minOrderSize: {}
    });
    
    this.venues.set('curve', {
      name: 'curve',
      type: 'amm',
      chainId: 1,
      latency: 120,
      fees: { maker: 0.0004, taker: 0.0004 },
      minOrderSize: {}
    });
  }

  /**
   * Start continuous arbitrage scanning
   */
  private startArbitrageScanning(): void {
    setInterval(() => {
      this.scanTriangularArbitrage();
      this.scanCrossVenueArbitrage();
      if (this.config.enableCrossChain) {
        this.scanCrossChainArbitrage();
      }
      this.scanStatisticalArbitrage();
      this.scanLatencyArbitrage();
    }, 100); // Scan every 100ms
  }

  /**
   * Update price feeds
   */
  async updatePriceFeed(
    asset: string,
    venue: string,
    bid: number,
    ask: number,
    volume: number
  ): Promise<void> {
    const key = `${asset}_${venue}`;
    
    if (!this.priceFeeds.has(key)) {
      this.priceFeeds.set(key, []);
    }
    
    const feed = this.priceFeeds.get(key)!;
    const timestamp = Date.now();
    
    // Add bid and ask
    feed.push(
      { venue, price: bid, volume, timestamp, side: 'bid' },
      { venue, price: ask, volume, timestamp, side: 'ask' }
    );
    
    // Maintain rolling window
    const cutoff = timestamp - 60000; // 1 minute
    const filtered = feed.filter(p => p.timestamp > cutoff);
    this.priceFeeds.set(key, filtered);
    
    // Update graph
    this.updateGraph(asset, venue, bid, ask, volume);
  }

  /**
   * Update arbitrage graph
   */
  private updateGraph(
    asset: string,
    venue: string,
    bid: number,
    ask: number,
    volume: number
  ): void {
    // For simplicity, assuming USD pairs
    const usdKey = `${asset}_USD`;
    
    if (!this.graph[usdKey]) {
      this.graph[usdKey] = {};
    }
    
    if (!this.graph[usdKey]!['USD']) {
      this.graph[usdKey]!['USD'] = [];
    }
    
    // Update or add venue data
    const venueData = this.graph[usdKey]!['USD']!.find(v => v.venue === venue);
    if (venueData) {
      venueData.rate = ask; // Buying price
      venueData.volume = volume;
    } else {
      this.graph[usdKey]!['USD']!.push({
        venue,
        rate: ask,
        volume,
        gasEstimate: this.estimateGas(venue)
      });
    }
    
    // Reverse direction (selling)
    if (!this.graph['USD']) {
      this.graph['USD'] = {};
    }
    
    if (!this.graph['USD']![usdKey]) {
      this.graph['USD']![usdKey] = [];
    }
    
    const reverseData = this.graph['USD']![usdKey]!.find(v => v.venue === venue);
    if (reverseData) {
      reverseData.rate = 1 / bid; // Selling price
      reverseData.volume = volume * bid;
    } else {
      this.graph['USD']![usdKey]!.push({
        venue,
        rate: 1 / bid,
        volume: volume * bid,
        gasEstimate: this.estimateGas(venue)
      });
    }
  }

  /**
   * Scan for triangular arbitrage opportunities
   */
  private scanTriangularArbitrage(): void {
    const assets = Object.keys(this.graph);
    
    // Check all possible triangular paths
    for (const asset1 of assets) {
      for (const asset2 of Object.keys(this.graph[asset1] || {})) {
        for (const asset3 of Object.keys(this.graph[asset2] || {})) {
          if (!this.graph[asset3]?.[asset1]) continue;
          
          // Calculate triangular arbitrage
          const opportunity = this.calculateTriangularArbitrage(
            asset1,
            asset2,
            asset3
          );
          
          if (opportunity && opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
            this.emitOpportunity(opportunity);
          }
        }
      }
    }
  }

  /**
   * Calculate triangular arbitrage profit
   */
  private calculateTriangularArbitrage(
    asset1: string,
    asset2: string,
    asset3: string
  ): ArbitrageOpportunity | null {
    const path1 = this.graph[asset1]?.[asset2];
    const path2 = this.graph[asset2]?.[asset3];
    const path3 = this.graph[asset3]?.[asset1];
    
    if (!path1 || !path2 || !path3) return null;
    
    // Find best rates for each leg
    const leg1 = path1.reduce((best, curr) => 
      curr.rate > best.rate ? curr : best
    );
    const leg2 = path2.reduce((best, curr) => 
      curr.rate > best.rate ? curr : best
    );
    const leg3 = path3.reduce((best, curr) => 
      curr.rate > best.rate ? curr : best
    );
    
    // Calculate profit (starting with 1 unit)
    const startAmount = 1;
    const amount1 = startAmount * leg1.rate;
    const amount2 = amount1 * leg2.rate;
    const finalAmount = amount2 * leg3.rate;
    
    const profitRatio = finalAmount - startAmount;
    
    // Account for fees and slippage
    const totalFees = this.calculateTotalFees([leg1.venue, leg2.venue, leg3.venue]);
    const slippageAdjusted = profitRatio * (1 - this.config.slippageTolerance);
    const netProfit = slippageAdjusted - totalFees;
    
    if (netProfit <= 0) return null;
    
    // Calculate optimal size
    const maxVolume = Math.min(
      leg1.volume,
      leg2.volume / leg1.rate,
      leg3.volume / (leg1.rate * leg2.rate)
    );
    
    const optimalSize = Math.min(
      maxVolume * 0.1, // Take max 10% of liquidity
      this.config.maxCapitalPerTrade.toNumber()
    );
    
    const profitEstimate = BigNumber.from(Math.floor(optimalSize * netProfit));
    
    return {
      id: `tri_${asset1}_${asset2}_${asset3}_${Date.now()}`,
      type: 'triangular',
      profitEstimate,
      probability: this.calculateExecutionProbability([leg1.venue, leg2.venue, leg3.venue]),
      requiredCapital: BigNumber.from(Math.floor(optimalSize)),
      executionTime: this.calculateExecutionTime([leg1.venue, leg2.venue, leg3.venue]),
      riskScore: this.calculateRiskScore(netProfit, maxVolume),
      venues: [leg1.venue, leg2.venue, leg3.venue],
      assets: [asset1, asset2, asset3],
      expiryTime: Date.now() + 5000 // 5 seconds
    };
  }

  /**
   * Scan for cross-venue arbitrage
   */
  private scanCrossVenueArbitrage(): void {
    for (const [key, prices] of this.priceFeeds.entries()) {
      const [asset] = key.split('_');
      
      // Group by venue
      const venueGroups = new Map<string, PricePoint[]>();
      for (const price of prices) {
        if (!venueGroups.has(price.venue)) {
          venueGroups.set(price.venue, []);
        }
        venueGroups.get(price.venue)!.push(price);
      }
      
      // Compare venues
      const venues = Array.from(venueGroups.keys());
      for (let i = 0; i < venues.length; i++) {
        for (let j = i + 1; j < venues.length; j++) {
          const opportunity = this.calculateCrossVenueArbitrage(
            asset!,
            venues[i]!,
            venues[j]!,
            venueGroups.get(venues[i]!)!,
            venueGroups.get(venues[j]!)!
          );
          
          if (opportunity && opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
            this.emitOpportunity(opportunity);
          }
        }
      }
    }
  }

  /**
   * Calculate cross-venue arbitrage
   */
  private calculateCrossVenueArbitrage(
    asset: string,
    venue1: string,
    venue2: string,
    prices1: PricePoint[],
    prices2: PricePoint[]
  ): ArbitrageOpportunity | null {
    // Get best bid/ask from each venue
    const bestBid1 = prices1.filter(p => p.side === 'bid')
      .reduce((best, curr) => curr.price > best.price ? curr : best, { price: 0 } as PricePoint);
    const bestAsk1 = prices1.filter(p => p.side === 'ask')
      .reduce((best, curr) => curr.price < best.price ? curr : best, { price: Infinity } as PricePoint);
    
    const bestBid2 = prices2.filter(p => p.side === 'bid')
      .reduce((best, curr) => curr.price > best.price ? curr : best, { price: 0 } as PricePoint);
    const bestAsk2 = prices2.filter(p => p.side === 'ask')
      .reduce((best, curr) => curr.price < best.price ? curr : best, { price: Infinity } as PricePoint);
    
    // Check both directions
    let buyVenue: string;
    let sellVenue: string;
    let buyPrice: number;
    let sellPrice: number;
    let volume: number;
    
    if (bestAsk1.price < bestBid2.price) {
      // Buy on venue1, sell on venue2
      buyVenue = venue1;
      sellVenue = venue2;
      buyPrice = bestAsk1.price;
      sellPrice = bestBid2.price;
      volume = Math.min(bestAsk1.volume || 0, bestBid2.volume || 0);
    } else if (bestAsk2.price < bestBid1.price) {
      // Buy on venue2, sell on venue1
      buyVenue = venue2;
      sellVenue = venue1;
      buyPrice = bestAsk2.price;
      sellPrice = bestBid1.price;
      volume = Math.min(bestAsk2.volume || 0, bestBid1.volume || 0);
    } else {
      return null; // No arbitrage
    }
    
    // Calculate profit
    const spread = (sellPrice - buyPrice) / buyPrice;
    const fees = this.calculateTotalFees([buyVenue, sellVenue]);
    const slippageAdjusted = spread * (1 - this.config.slippageTolerance);
    const netProfit = slippageAdjusted - fees;
    
    if (netProfit <= 0) return null;
    
    // Calculate optimal size
    const optimalSize = Math.min(
      volume * buyPrice * 0.1, // Take max 10% of liquidity
      this.config.maxCapitalPerTrade.toNumber()
    );
    
    const profitEstimate = BigNumber.from(Math.floor(optimalSize * netProfit));
    
    return {
      id: `cross_${asset}_${buyVenue}_${sellVenue}_${Date.now()}`,
      type: 'cross_venue',
      profitEstimate,
      probability: this.calculateExecutionProbability([buyVenue, sellVenue]),
      requiredCapital: BigNumber.from(Math.floor(optimalSize)),
      executionTime: this.calculateExecutionTime([buyVenue, sellVenue]),
      riskScore: this.calculateRiskScore(netProfit, volume * buyPrice),
      venues: [buyVenue, sellVenue],
      assets: [asset],
      expiryTime: Date.now() + 3000 // 3 seconds
    };
  }

  /**
   * Scan for cross-chain arbitrage opportunities
   */
  private async scanCrossChainArbitrage(): Promise<void> {
    // Get all DEX venues
    const dexVenues = Array.from(this.venues.entries())
      .filter(([_, data]) => data.type === 'dex' || data.type === 'amm');
    
    // Compare prices across chains
    for (const [venue1Name, venue1Data] of dexVenues) {
      for (const [venue2Name, venue2Data] of dexVenues) {
        if (venue1Data.chainId === venue2Data.chainId) continue;
        
        // Check common assets
        for (const [key, prices] of this.priceFeeds.entries()) {
          if (!key.includes(venue1Name) || !this.priceFeeds.has(key.replace(venue1Name, venue2Name))) {
            continue;
          }
          
          const opportunity = await this.calculateCrossChainArbitrage(
            key.split('_')[0]!,
            venue1Name,
            venue2Name,
            venue1Data.chainId!,
            venue2Data.chainId!
          );
          
          if (opportunity && opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
            this.emitOpportunity(opportunity);
          }
        }
      }
    }
  }

  /**
   * Calculate cross-chain arbitrage
   */
  private async calculateCrossChainArbitrage(
    asset: string,
    venue1: string,
    venue2: string,
    chain1: number,
    chain2: number
  ): Promise<CrossChainArbitrage | null> {
    // Get prices from both chains
    const prices1 = this.priceFeeds.get(`${asset}_${venue1}`) || [];
    const prices2 = this.priceFeeds.get(`${asset}_${venue2}`) || [];
    
    if (prices1.length === 0 || prices2.length === 0) return null;
    
    // Calculate basic arbitrage
    const baseArb = this.calculateCrossVenueArbitrage(
      asset,
      venue1,
      venue2,
      prices1,
      prices2
    );
    
    if (!baseArb) return null;
    
    // Add cross-chain specific costs
    const bridgeProtocol = this.selectOptimalBridge(chain1, chain2);
    const bridgeCost = await this.estimateBridgeCost(
      asset,
      baseArb.requiredCapital,
      chain1,
      chain2,
      bridgeProtocol
    );
    
    // Adjust profit for bridge costs
    const adjustedProfit = baseArb.profitEstimate.sub(bridgeCost.total);
    
    if (adjustedProfit.lte(this.config.minProfitThreshold)) return null;
    
    return {
      ...baseArb,
      type: 'cross_venue',
      profitEstimate: adjustedProfit,
      sourceChain: chain1.toString(),
      targetChain: chain2.toString(),
      bridgeProtocol,
      gasEstimate: {
        source: bridgeCost.sourceGas,
        target: bridgeCost.targetGas
      },
      slippageTolerance: this.config.slippageTolerance * 1.5 // Higher slippage for cross-chain
    } as CrossChainArbitrage;
  }

  /**
   * Scan for statistical arbitrage opportunities
   */
  private scanStatisticalArbitrage(): void {
    // Analyze all asset pairs
    const assets = new Set<string>();
    for (const key of this.priceFeeds.keys()) {
      assets.add(key.split('_')[0]!);
    }
    
    const assetArray = Array.from(assets);
    for (let i = 0; i < assetArray.length; i++) {
      for (let j = i + 1; j < assetArray.length; j++) {
        const pair = this.analyzeStatisticalPair(assetArray[i]!, assetArray[j]!);
        
        if (pair && Math.abs(pair.zScore) > this.config.statisticalThreshold) {
          const opportunity = this.createStatisticalArbitrageOpportunity(pair);
          if (opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
            this.emitOpportunity(opportunity);
          }
        }
      }
    }
  }

  /**
   * Analyze statistical relationship between two assets
   */
  private analyzeStatisticalPair(asset1: string, asset2: string): StatisticalArbitrage | null {
    const prices1 = this.getPriceHistory(asset1);
    const prices2 = this.getPriceHistory(asset2);
    
    if (prices1.length < 100 || prices2.length < 100) return null;
    
    // Calculate returns
    const returns1 = this.calculateReturns(prices1);
    const returns2 = this.calculateReturns(prices2);
    
    // Calculate correlation
    const correlation = this.calculateCorrelation(returns1, returns2);
    
    if (Math.abs(correlation) < 0.7) return null; // Not correlated enough
    
    // Perform cointegration test
    const coint = this.cointegrationTest(prices1, prices2);
    
    if (coint.pValue > 0.05) return null; // Not cointegrated
    
    // Calculate spread and z-score
    const spread = prices1.map((p, i) => p - coint.beta * prices2[i]!);
    const meanSpread = spread.reduce((a, b) => a + b, 0) / spread.length;
    const stdSpread = Math.sqrt(
      spread.reduce((sum, s) => sum + Math.pow(s - meanSpread, 2), 0) / spread.length
    );
    
    const currentSpread = spread[spread.length - 1]!;
    const zScore = (currentSpread - meanSpread) / stdSpread;
    
    return {
      pairId: `${asset1}_${asset2}`,
      assets: [asset1, asset2],
      correlation,
      cointegration: {
        value: coint.statistic,
        pValue: coint.pValue,
        halfLife: coint.halfLife
      },
      zScore,
      entryThreshold: this.config.statisticalThreshold,
      exitThreshold: 0.5,
      currentSpread,
      historicalMean: meanSpread,
      confidence: Math.min(1, prices1.length / 1000)
    };
  }

  /**
   * Create statistical arbitrage opportunity
   */
  private createStatisticalArbitrageOpportunity(
    pair: StatisticalArbitrage
  ): ArbitrageOpportunity {
    // Calculate expected profit based on mean reversion
    const spreadDeviation = Math.abs(pair.currentSpread - pair.historicalMean);
    const expectedMove = spreadDeviation * 0.7; // Expect 70% mean reversion
    
    // Estimate position size using Kelly Criterion
    const kellyFraction = this.calculateKellySize(
      pair.confidence,
      expectedMove,
      spreadDeviation
    );
    
    const positionSize = Math.min(
      this.config.maxCapitalPerTrade.toNumber() * kellyFraction,
      this.config.maxCapitalPerTrade.toNumber()
    );
    
    const profitEstimate = BigNumber.from(Math.floor(positionSize * expectedMove));
    
    return {
      id: `stat_${pair.pairId}_${Date.now()}`,
      type: 'statistical',
      profitEstimate,
      probability: pair.confidence,
      requiredCapital: BigNumber.from(Math.floor(positionSize)),
      executionTime: pair.cointegration.halfLife * 3600 * 1000, // Convert hours to ms
      riskScore: 1 / pair.confidence,
      venues: ['multiple'],
      assets: pair.assets,
      expiryTime: Date.now() + pair.cointegration.halfLife * 3600 * 1000
    };
  }

  /**
   * Scan for latency arbitrage opportunities
   */
  private scanLatencyArbitrage(): void {
    // Look for price discrepancies that can be exploited with speed
    for (const [key, prices] of this.priceFeeds.entries()) {
      const [asset] = key.split('_');
      
      // Sort by timestamp
      const sorted = prices.sort((a, b) => a.timestamp - b.timestamp);
      
      // Look for venues that consistently lag
      const lagAnalysis = this.analyzePriceLag(sorted);
      
      for (const lag of lagAnalysis) {
        if (lag.avgLag > 50 && lag.profitability > 0.001) { // 50ms lag, 0.1% profit
          const opportunity = this.createLatencyArbitrageOpportunity(
            asset!,
            lag.fastVenue,
            lag.slowVenue,
            lag.avgLag,
            lag.profitability
          );
          
          if (opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
            this.emitOpportunity(opportunity);
          }
        }
      }
    }
  }

  /**
   * Analyze price lag between venues
   */
  private analyzePriceLag(prices: PricePoint[]): any[] {
    const venueTimings = new Map<string, number[]>();
    
    // Group by price level and track timing
    const priceGroups = new Map<number, PricePoint[]>();
    for (const price of prices) {
      const rounded = Math.round(price.price * 1000) / 1000;
      if (!priceGroups.has(rounded)) {
        priceGroups.set(rounded, []);
      }
      priceGroups.get(rounded)!.push(price);
    }
    
    // Analyze lag for each price movement
    const lags: any[] = [];
    for (const [_, group] of priceGroups) {
      if (group.length < 2) continue;
      
      const sorted = group.sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0]!;
      const rest = sorted.slice(1);
      
      for (const lagging of rest) {
        const lag = lagging.timestamp - first.timestamp;
        if (!venueTimings.has(lagging.venue)) {
          venueTimings.set(lagging.venue, []);
        }
        venueTimings.get(lagging.venue)!.push(lag);
      }
    }
    
    // Calculate average lags and profitability
    const results: any[] = [];
    for (const [venue, timings] of venueTimings) {
      const avgLag = timings.reduce((a, b) => a + b, 0) / timings.length;
      const consistency = 1 - (Math.sqrt(
        timings.reduce((sum, t) => sum + Math.pow(t - avgLag, 2), 0) / timings.length
      ) / avgLag);
      
      results.push({
        fastVenue: 'aggregate',
        slowVenue: venue,
        avgLag,
        consistency,
        profitability: consistency * 0.002 // Rough estimate
      });
    }
    
    return results;
  }

  /**
   * Create latency arbitrage opportunity
   */
  private createLatencyArbitrageOpportunity(
    asset: string,
    fastVenue: string,
    slowVenue: string,
    avgLag: number,
    profitability: number
  ): ArbitrageOpportunity {
    const capitalRequired = this.config.maxCapitalPerTrade.div(10); // Use 10% for latency arb
    const profitEstimate = capitalRequired.mul(Math.floor(profitability * 1000)).div(1000);
    
    return {
      id: `latency_${asset}_${fastVenue}_${slowVenue}_${Date.now()}`,
      type: 'latency',
      profitEstimate,
      probability: Math.min(0.9, avgLag / 100), // Higher lag = higher probability
      requiredCapital: capitalRequired,
      executionTime: avgLag,
      riskScore: 1 / (avgLag / 100),
      venues: [fastVenue, slowVenue],
      assets: [asset],
      expiryTime: Date.now() + 1000 // 1 second
    };
  }

  /**
   * Build optimal arbitrage route
   */
  async buildOptimalRoute(opportunity: ArbitrageOpportunity): Promise<ArbitrageRoute> {
    const steps: ArbitrageRoute['steps'] = [];
    
    if (opportunity.type === 'triangular') {
      // Build triangular route
      const [asset1, asset2, asset3] = opportunity.assets;
      const [venue1, venue2, venue3] = opportunity.venues;
      
      steps.push(
        {
          action: 'swap',
          venue: venue1!,
          inputAsset: asset1!,
          outputAsset: asset2!,
          inputAmount: opportunity.requiredCapital,
          expectedOutput: opportunity.requiredCapital.mul(95).div(100), // Simplified
          gasEstimate: this.estimateGas(venue1!)
        },
        {
          action: 'swap',
          venue: venue2!,
          inputAsset: asset2!,
          outputAsset: asset3!,
          inputAmount: opportunity.requiredCapital.mul(95).div(100),
          expectedOutput: opportunity.requiredCapital.mul(90).div(100),
          gasEstimate: this.estimateGas(venue2!)
        },
        {
          action: 'swap',
          venue: venue3!,
          inputAsset: asset3!,
          outputAsset: asset1!,
          inputAmount: opportunity.requiredCapital.mul(90).div(100),
          expectedOutput: opportunity.requiredCapital.add(opportunity.profitEstimate),
          gasEstimate: this.estimateGas(venue3!)
        }
      );
    } else if (opportunity.type === 'cross_venue') {
      // Build cross-venue route
      const [buyVenue, sellVenue] = opportunity.venues;
      const [asset] = opportunity.assets;
      
      steps.push(
        {
          action: 'swap',
          venue: buyVenue!,
          inputAsset: 'USD',
          outputAsset: asset!,
          inputAmount: opportunity.requiredCapital,
          expectedOutput: opportunity.requiredCapital.mul(98).div(100),
          gasEstimate: this.estimateGas(buyVenue!)
        },
        {
          action: 'swap',
          venue: sellVenue!,
          inputAsset: asset!,
          outputAsset: 'USD',
          inputAmount: opportunity.requiredCapital.mul(98).div(100),
          expectedOutput: opportunity.requiredCapital.add(opportunity.profitEstimate),
          gasEstimate: this.estimateGas(sellVenue!)
        }
      );
    }
    
    const totalGas = steps.reduce((sum, step) => sum.add(step.gasEstimate), BigNumber.from(0));
    
    return {
      steps,
      totalProfit: opportunity.profitEstimate,
      totalGas,
      executionTime: opportunity.executionTime,
      atomicity: opportunity.type !== 'cross_venue' // CEX trades are not atomic
    };
  }

  /**
   * Execute arbitrage with MEV protection
   */
  async executeArbitrage(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      // Validate opportunity is still valid
      if (Date.now() > opportunity.expiryTime) {
        this.emit('execution_failed', {
          opportunity,
          reason: 'expired'
        });
        return false;
      }
      
      // Build execution route
      const route = await this.buildOptimalRoute(opportunity);
      
      // Check if we need flash loan
      const needsFlashLoan = opportunity.requiredCapital.gt(
        BigNumber.from('1000000') // $1M threshold
      );
      
      if (needsFlashLoan && this.config.enableFlashLoans) {
        return await this.executeWithFlashLoan(opportunity, route);
      }
      
      // Execute steps
      for (const step of route.steps) {
        const success = await this.executeStep(step);
        if (!success) {
          this.emit('execution_failed', {
            opportunity,
            reason: 'step_failed',
            step
          });
          return false;
        }
      }
      
      // Record success
      this.executionHistory.push(opportunity);
      this.emit('execution_success', {
        opportunity,
        actualProfit: route.totalProfit.sub(route.totalGas)
      });
      
      return true;
    } catch (error) {
      this.emit('execution_error', {
        opportunity,
        error
      });
      return false;
    }
  }

  /**
   * Monitor competitor activity
   */
  async detectCompetitorActivity(opportunity: ArbitrageOpportunity): Promise<{
    competitors: number;
    avgSpeed: number;
    successRate: number;
  }> {
    // Analyze historical execution patterns
    const similar = this.executionHistory.filter(h => 
      h.type === opportunity.type &&
      h.venues.some(v => opportunity.venues.includes(v))
    );
    
    // Estimate competition
    const recentCompetition = similar.filter(h => 
      Date.now() - h.expiryTime < 300000 // Last 5 minutes
    );
    
    const competitors = Math.floor(recentCompetition.length / 10);
    const avgSpeed = recentCompetition.length > 0
      ? recentCompetition.reduce((sum, h) => sum + h.executionTime, 0) / recentCompetition.length
      : 100;
    
    const successRate = similar.length > 0
      ? similar.filter(h => this.executionHistory.includes(h)).length / similar.length
      : 0.5;
    
    return {
      competitors,
      avgSpeed,
      successRate
    };
  }

  /**
   * Create custom arbitrage strategies
   */
  async createCustomStrategy(
    name: string,
    condition: (prices: Map<string, PricePoint[]>) => boolean,
    calculator: (prices: Map<string, PricePoint[]>) => ArbitrageOpportunity | null
  ): Promise<void> {
    // Add custom strategy to scanning
    const customScan = () => {
      if (condition(this.priceFeeds)) {
        const opportunity = calculator(this.priceFeeds);
        if (opportunity && opportunity.profitEstimate.gt(this.config.minProfitThreshold)) {
          this.emitOpportunity(opportunity);
        }
      }
    };
    
    // Add to scanning interval
    setInterval(customScan, 100);
    
    this.emit('strategy_added', { name });
  }

  // ========== HELPER METHODS ==========

  private estimateGas(venue: string): BigNumber {
    const venueData = this.venues.get(venue);
    if (!venueData) return BigNumber.from('100000'); // Default
    
    if (venueData.type === 'cex') {
      return BigNumber.from('0'); // No gas for CEX
    }
    
    // Estimate based on chain
    const gasPrice = {
      1: '50', // Ethereum
      56: '5', // BSC
      137: '30', // Polygon
      42161: '0.1' // Arbitrum
    }[venueData.chainId || 1] || '10';
    
    return BigNumber.from(gasPrice).mul('1000000000').mul('200000'); // gasPrice * gasLimit
  }

  private calculateTotalFees(venues: string[]): number {
    let totalFees = 0;
    
    for (const venue of venues) {
      const venueData = this.venues.get(venue);
      if (venueData) {
        totalFees += venueData.fees.taker;
      }
    }
    
    return totalFees;
  }

  private calculateExecutionProbability(venues: string[]): number {
    // Based on venue reliability and latency
    let probability = 1;
    
    for (const venue of venues) {
      const venueData = this.venues.get(venue);
      if (venueData) {
        // Lower probability for higher latency
        probability *= Math.max(0.5, 1 - venueData.latency / 1000);
      }
    }
    
    return probability;
  }

  private calculateExecutionTime(venues: string[]): number {
    // Sum of latencies
    let totalTime = 0;
    
    for (const venue of venues) {
      const venueData = this.venues.get(venue);
      if (venueData) {
        totalTime += venueData.latency;
      }
    }
    
    return totalTime;
  }

  private calculateRiskScore(profitRatio: number, volume: number): number {
    // Higher profit = lower risk, higher volume = lower risk
    const profitScore = Math.min(1, profitRatio * 10);
    const volumeScore = Math.min(1, volume / 1000000);
    
    return 1 - (profitScore * volumeScore);
  }

  private selectOptimalBridge(chain1: number, chain2: number): string {
    // Simplified bridge selection
    const bridges: Record<string, string> = {
      '1_56': 'binance_bridge',
      '1_137': 'polygon_bridge',
      '1_42161': 'arbitrum_bridge',
      '56_137': 'multichain'
    };
    
    const key1 = `${chain1}_${chain2}`;
    const key2 = `${chain2}_${chain1}`;
    
    return bridges[key1] || bridges[key2] || 'anyswap';
  }

  private async estimateBridgeCost(
    asset: string,
    amount: BigNumber,
    sourceChain: number,
    targetChain: number,
    bridge: string
  ): Promise<{
    sourceGas: BigNumber;
    targetGas: BigNumber;
    total: BigNumber;
  }> {
    // Simplified bridge cost estimation
    const baseCost = {
      'binance_bridge': '10',
      'polygon_bridge': '50',
      'arbitrum_bridge': '20',
      'multichain': '30',
      'anyswap': '40'
    }[bridge] || '50';
    
    const sourceGas = this.estimateGas(`chain_${sourceChain}`);
    const targetGas = this.estimateGas(`chain_${targetChain}`);
    const bridgeFee = BigNumber.from(baseCost).mul('1000000000000000000'); // In wei
    
    return {
      sourceGas,
      targetGas,
      total: sourceGas.add(targetGas).add(bridgeFee)
    };
  }

  private getPriceHistory(asset: string): number[] {
    const prices: number[] = [];
    
    for (const [key, points] of this.priceFeeds.entries()) {
      if (key.startsWith(asset)) {
        const midPrices = points
          .filter(p => p.side === 'bid')
          .map(p => p.price);
        prices.push(...midPrices);
      }
    }
    
    return prices.sort((a, b) => a - b);
  }

  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
    }
    
    return returns;
  }

  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    if (n < 2) return 0;
    
    const mean1 = returns1.reduce((a, b) => a + b, 0) / n;
    const mean2 = returns2.reduce((a, b) => a + b, 0) / n;
    
    let cov = 0;
    let var1 = 0;
    let var2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = returns1[i]! - mean1;
      const diff2 = returns2[i]! - mean2;
      
      cov += diff1 * diff2;
      var1 += diff1 * diff1;
      var2 += diff2 * diff2;
    }
    
    return cov / Math.sqrt(var1 * var2);
  }

  private cointegrationTest(prices1: number[], prices2: number[]): {
    statistic: number;
    pValue: number;
    beta: number;
    halfLife: number;
  } {
    // Simplified Engle-Granger test
    const n = Math.min(prices1.length, prices2.length);
    
    // OLS regression
    const meanX = prices2.reduce((a, b) => a + b, 0) / n;
    const meanY = prices1.reduce((a, b) => a + b, 0) / n;
    
    let num = 0;
    let den = 0;
    
    for (let i = 0; i < n; i++) {
      num += (prices2[i]! - meanX) * (prices1[i]! - meanY);
      den += (prices2[i]! - meanX) * (prices2[i]! - meanX);
    }
    
    const beta = num / den;
    const alpha = meanY - beta * meanX;
    
    // Calculate residuals
    const residuals = prices1.map((p, i) => p - alpha - beta * prices2[i]!);
    
    // ADF test on residuals (simplified)
    const adfStat = this.adfTest(residuals);
    const pValue = this.adfPValue(adfStat);
    
    // Half-life calculation
    const halfLife = Math.log(2) / Math.abs(Math.log(1 + adfStat));
    
    return {
      statistic: adfStat,
      pValue,
      beta,
      halfLife
    };
  }

  private adfTest(series: number[]): number {
    // Simplified ADF test
    const lagged = series.slice(0, -1);
    const diff = series.slice(1).map((v, i) => v - lagged[i]!);
    
    // Regression of diff on lagged
    const n = diff.length;
    const meanX = lagged.reduce((a, b) => a + b, 0) / n;
    const meanY = diff.reduce((a, b) => a + b, 0) / n;
    
    let num = 0;
    let den = 0;
    
    for (let i = 0; i < n; i++) {
      num += (lagged[i]! - meanX) * (diff[i]! - meanY);
      den += (lagged[i]! - meanX) * (lagged[i]! - meanX);
    }
    
    return num / den;
  }

  private adfPValue(statistic: number): number {
    // Simplified p-value calculation
    // In reality, this would use MacKinnon critical values
    if (statistic < -3.5) return 0.01;
    if (statistic < -2.9) return 0.05;
    if (statistic < -2.6) return 0.10;
    return 0.5;
  }

  private calculateKellySize(winProb: number, winSize: number, lossSize: number): number {
    // Kelly Criterion: f = (p * b - q) / b
    // where f = fraction to bet, p = win probability, q = loss probability, b = win/loss ratio
    const q = 1 - winProb;
    const b = winSize / lossSize;
    
    const kelly = (winProb * b - q) / b;
    
    // Apply Kelly fraction (usually 0.25 for safety)
    return Math.max(0, Math.min(0.25, kelly * 0.25));
  }

  private async executeWithFlashLoan(
    opportunity: ArbitrageOpportunity,
    route: ArbitrageRoute
  ): Promise<boolean> {
    // Placeholder for flash loan execution
    // In production, this would interact with Aave, dYdX, or Uniswap V3
    this.emit('flash_loan_execution', {
      opportunity,
      route,
      amount: opportunity.requiredCapital
    });
    
    return true;
  }

  private async executeStep(step: ArbitrageRoute['steps'][0]): Promise<boolean> {
    // Placeholder for step execution
    // In production, this would interact with actual exchanges/DEXs
    this.emit('step_execution', step);
    
    return true;
  }

  private emitOpportunity(opportunity: ArbitrageOpportunity): void {
    // Check if already emitted
    if (this.opportunities.has(opportunity.id)) return;
    
    this.opportunities.set(opportunity.id, opportunity);
    this.emit('opportunity', opportunity);
    
    // Clean up old opportunities
    setTimeout(() => {
      this.opportunities.delete(opportunity.id);
    }, opportunity.expiryTime - Date.now());
  }
} 
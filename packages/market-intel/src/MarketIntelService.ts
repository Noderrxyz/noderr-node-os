import { EventEmitter } from 'events';
import {
  MarketIntelConfig,
  AlphaSignal,
  MarketSnapshot,
  MarketAnomaly,
  IntelligenceReport,
  MarketIntelEvent,
  TelemetryClient,
  OrderBook,
  WhaleActivity,
  ArbitrageOpportunity,
  SentimentData
} from './types';
import { OrderBookAnalyzer } from './OrderBookAnalyzer';
import { WhaleTracker } from './WhaleTracker';
import { ArbitrageScanner } from './ArbitrageScanner';
import { SentimentAnalyzer } from './SentimentAnalyzer';

interface PriceData {
  symbol: string;
  exchange: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: Date;
}

interface SocialPost {
  id: string;
  source: 'twitter' | 'reddit' | 'telegram' | 'discord';
  author: string;
  content: string;
  timestamp: Date;
  engagement: {
    likes: number;
    retweets?: number;
    comments: number;
    shares?: number;
  };
  metadata?: {
    followersCount?: number;
    isVerified?: boolean;
    authorReputation?: number;
  };
}

export class MarketIntelService extends EventEmitter {
  private config: MarketIntelConfig;
  private telemetry: TelemetryClient;
  private orderBookAnalyzer: OrderBookAnalyzer;
  private whaleTracker: WhaleTracker;
  private arbitrageScanner: ArbitrageScanner;
  private sentimentAnalyzer: SentimentAnalyzer;
  private alphaGenerator: AlphaGenerator;
  private anomalyDetector: AnomalyDetector;
  private signalHistory: AlphaSignal[];
  private readonly SIGNAL_HISTORY_LIMIT = 10000;

  constructor(config: MarketIntelConfig, telemetry: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.orderBookAnalyzer = new OrderBookAnalyzer(config.orderBook, telemetry);
    this.whaleTracker = new WhaleTracker(config.whaleTracking, telemetry);
    this.arbitrageScanner = new ArbitrageScanner(config.arbitrage, telemetry);
    this.sentimentAnalyzer = new SentimentAnalyzer(config.sentiment, telemetry);
    this.alphaGenerator = new AlphaGenerator(config.alphaGeneration);
    this.anomalyDetector = new AnomalyDetector();
    this.signalHistory = [];

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Order book events
    this.orderBookAnalyzer.on('spoofing_detected', (data) => {
      this.handleMarketEvent({
        type: 'orderbook_update',
        data,
        priority: 'high',
        timestamp: new Date()
      });
    });

    this.orderBookAnalyzer.on('large_orders_detected', (data) => {
      this.handleMarketEvent({
        type: 'orderbook_update',
        data,
        priority: 'medium',
        timestamp: new Date()
      });
    });

    // Whale tracking events
    this.whaleTracker.on('whale_detected', (data) => {
      this.handleMarketEvent({
        type: 'whale_alert',
        data,
        priority: 'high',
        timestamp: new Date()
      });
    });

    this.whaleTracker.on('smart_money_alert', (data) => {
      this.handleMarketEvent({
        type: 'whale_alert',
        data,
        priority: 'critical',
        timestamp: new Date()
      });
    });

    // Arbitrage events
    this.arbitrageScanner.on('high_value_opportunity', (data) => {
      this.handleMarketEvent({
        type: 'arbitrage_found',
        data,
        priority: 'critical',
        timestamp: new Date()
      });
    });

    // Sentiment events
    this.sentimentAnalyzer.on('significant_sentiment', (data) => {
      this.handleMarketEvent({
        type: 'sentiment_shift',
        data,
        priority: 'medium',
        timestamp: new Date()
      });
    });

    this.sentimentAnalyzer.on('fomo_alert', (data) => {
      this.handleMarketEvent({
        type: 'sentiment_shift',
        data,
        priority: 'high',
        timestamp: new Date()
      });
    });
  }

  async processOrderBook(orderBook: OrderBook): Promise<void> {
    const startTime = Date.now();

    try {
      // Analyze order book
      const analysis = await this.orderBookAnalyzer.analyzeOrderBook(orderBook);

      // Generate alpha signals from order book analysis
      if (this.config.alphaGeneration.combineSignals) {
        const signal = await this.alphaGenerator.generateFromOrderBook(
          orderBook.symbol,
          analysis
        );

        if (signal && signal.confidence >= this.config.alphaGeneration.minConfidence) {
          this.addAlphaSignal(signal);
        }
      }

      // Check for anomalies
      const anomaly = await this.anomalyDetector.checkOrderBookAnomaly(
        orderBook,
        analysis
      );

      if (anomaly) {
        this.handleAnomaly(anomaly);
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'orderbook_analyzed',
        data: {
          symbol: orderBook.symbol,
          processingTime: Date.now() - startTime
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Order book processing error:', error);
      throw error;
    }
  }

  async processWhaleActivity(activity: WhaleActivity): Promise<void> {
    const startTime = Date.now();

    try {
      // Track whale activity
      const result = await this.whaleTracker.trackTransaction(activity);

      if (result.isWhale) {
        // Generate alpha signal from whale activity
        if (this.config.alphaGeneration.combineSignals) {
          const signal = await this.alphaGenerator.generateFromWhaleActivity(
            activity,
            result
          );

          if (signal && signal.confidence >= this.config.alphaGeneration.minConfidence) {
            this.addAlphaSignal(signal);
          }
        }

        // Check for coordinated activity
        const coordination = await this.whaleTracker.detectCoordinatedActivity();
        if (coordination.detected) {
          this.handleAnomaly({
            id: `coord-${Date.now()}`,
            type: 'correlation',
            severity: 'high',
            description: 'Coordinated whale activity detected',
            affectedSymbols: [activity.tokenSymbol],
            detectionConfidence: coordination.confidence,
            expectedDuration: 60,
            recommendedAction: 'Monitor closely for market manipulation',
            timestamp: new Date()
          });
        }
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'whale_detected',
        data: {
          chain: activity.chain,
          processingTime: Date.now() - startTime
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Whale activity processing error:', error);
      throw error;
    }
  }

  async scanArbitrageOpportunities(priceData: PriceData[]): Promise<ArbitrageOpportunity[]> {
    const startTime = Date.now();

    try {
      // Scan for arbitrage opportunities
      const opportunities = await this.arbitrageScanner.scanForOpportunities(priceData);

      // Generate alpha signals from arbitrage opportunities
      if (this.config.alphaGeneration.combineSignals) {
        for (const opportunity of opportunities) {
          const signal = await this.alphaGenerator.generateFromArbitrage(opportunity);

          if (signal && signal.confidence >= this.config.alphaGeneration.minConfidence) {
            this.addAlphaSignal(signal);
          }
        }
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'arbitrage_found',
        data: {
          count: opportunities.length,
          processingTime: Date.now() - startTime
        },
        timestamp: new Date()
      });

      return opportunities;
    } catch (error) {
      console.error('Arbitrage scanning error:', error);
      throw error;
    }
  }

  async processSocialPost(post: SocialPost, symbol: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Analyze sentiment
      const analysis = await this.sentimentAnalyzer.analyzeSocialPost(post, symbol);

      // Generate alpha signal from sentiment if significant
      if (analysis.impact > 0.7 && Math.abs(analysis.sentiment) > 0.5) {
        if (this.config.alphaGeneration.combineSignals) {
          const signal = await this.alphaGenerator.generateFromSentiment(
            symbol,
            analysis,
            post
          );

          if (signal && signal.confidence >= this.config.alphaGeneration.minConfidence) {
            this.addAlphaSignal(signal);
          }
        }
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'sentiment_updated',
        data: {
          symbol,
          source: post.source,
          processingTime: Date.now() - startTime
        },
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Social post processing error:', error);
      throw error;
    }
  }

  async generateMarketSnapshot(): Promise<MarketSnapshot> {
    const timestamp = new Date();

    // Get top movers (would integrate with price data)
    const topMovers = await this.getTopMovers();

    // Get unusual activity
    const unusualActivity = await this.getUnusualActivity();

    // Get sentiment overview
    const sentimentOverview = await this.getSentimentOverview();

    // Get liquidity metrics
    const liquidityMetrics = await this.getLiquidityMetrics();

    // Count recent arbitrage opportunities
    const recentArbitrage = await this.arbitrageScanner.getHistoricalOpportunities();
    const arbitrageCount = recentArbitrage.filter(
      o => Date.now() - o.timestamp.getTime() < 60 * 60 * 1000
    ).length;

    // Calculate whale activity level
    const whaleActivityLevel = await this.calculateWhaleActivityLevel();

    return {
      timestamp,
      topMovers,
      unusualActivity,
      sentimentOverview,
      liquidityMetrics,
      arbitrageCount,
      whaleActivityLevel
    };
  }

  async generateIntelligenceReport(date: Date): Promise<IntelligenceReport> {
    // Get signals for the date
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const alphaSignals = this.signalHistory.filter(
      s => s.timestamp >= dayStart && s.timestamp <= dayEnd
    );

    // Get whale activity
    const whaleActivity: WhaleActivity[] = []; // Would fetch from whale tracker

    // Get arbitrage opportunities
    const arbitrageOpportunities = await this.arbitrageScanner.getHistoricalOpportunities();

    // Get sentiment analysis
    const sentimentAnalysis: SentimentData[] = []; // Would fetch from sentiment analyzer

    // Get anomalies
    const anomalies = await this.anomalyDetector.getAnomaliesForDate(date);

    // Calculate performance metrics
    const performanceMetrics = this.calculatePerformanceMetrics(alphaSignals);

    // Generate summary
    const summary = this.generateReportSummary({
      alphaSignals,
      whaleActivity,
      arbitrageOpportunities,
      sentimentAnalysis,
      anomalies
    });

    return {
      date,
      summary,
      alphaSignals,
      whaleActivity,
      arbitrageOpportunities,
      sentimentAnalysis,
      anomalies,
      performanceMetrics
    };
  }

  getAlphaSignals(
    symbol?: string,
    type?: string,
    minConfidence?: number
  ): AlphaSignal[] {
    let signals = [...this.signalHistory];

    if (symbol) {
      signals = signals.filter(s => s.symbol === symbol);
    }

    if (type) {
      signals = signals.filter(s => s.type === type);
    }

    if (minConfidence) {
      signals = signals.filter(s => s.confidence >= minConfidence);
    }

    return signals.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private handleMarketEvent(event: MarketIntelEvent): void {
    // Process event based on priority
    if (event.priority === 'critical') {
      this.emit('critical_event', event);
    }

    // Generate alpha signal if appropriate
    if (this.config.alphaGeneration.combineSignals) {
      this.generateCompositeSignal(event);
    }

    // Log event
    console.log(`Market Intel Event: ${event.type} - Priority: ${event.priority}`);
  }

  private handleAnomaly(anomaly: MarketAnomaly): void {
    // Emit anomaly event
    this.emit('anomaly_detected', anomaly);

    // Track telemetry
    this.telemetry.track({
      eventType: 'anomaly_detected',
      data: anomaly,
      timestamp: new Date()
    });

    // Generate alert for critical anomalies
    if (anomaly.severity === 'critical') {
      this.emit('critical_anomaly', anomaly);
    }
  }

  private addAlphaSignal(signal: AlphaSignal): void {
    this.signalHistory.push(signal);

    // Maintain history limit
    if (this.signalHistory.length > this.SIGNAL_HISTORY_LIMIT) {
      this.signalHistory.shift();
    }

    // Emit signal event
    this.emit('alpha_signal', signal);

    // Track telemetry
    this.telemetry.track({
      eventType: 'alpha_generated',
      data: {
        type: signal.type,
        symbol: signal.symbol,
        confidence: signal.confidence,
        expectedReturn: signal.expectedReturn
      },
      timestamp: new Date()
    });
  }

  private async generateCompositeSignal(event: MarketIntelEvent): Promise<void> {
    // Generate composite signals from multiple data sources
    const signal = await this.alphaGenerator.generateComposite(event);

    if (signal && signal.confidence >= this.config.alphaGeneration.minConfidence) {
      this.addAlphaSignal(signal);
    }
  }

  private async getTopMovers(): Promise<any[]> {
    // Placeholder - would integrate with price data
    return [];
  }

  private async getUnusualActivity(): Promise<any[]> {
    // Collect unusual activity from various sources
    const activities: any[] = [];

    // Add recent anomalies
    const recentAnomalies = await this.anomalyDetector.getRecentAnomalies(1); // 1 hour
    activities.push(...recentAnomalies.map(a => ({
      type: 'anomaly',
      symbol: a.affectedSymbols.join(', '),
      description: a.description,
      severity: a.severity,
      timestamp: a.timestamp
    })));

    return activities;
  }

  private async getSentimentOverview(): Promise<any> {
    const trending = this.sentimentAnalyzer.getTrendingSymbols();
    
    // Calculate overall sentiment (simplified)
    const overall = 0; // Would aggregate from sentiment analyzer
    const bySource = new Map<string, number>();
    const fearGreedIndex = 50; // Placeholder

    return {
      overall,
      bySource,
      trending,
      fearGreedIndex
    };
  }

  private async getLiquidityMetrics(): Promise<any> {
    // Placeholder - would aggregate from order book analyzer
    return {
      totalLiquidity: 0,
      liquidityChange24h: 0,
      topLiquidPairs: [],
      illiquidWarnings: []
    };
  }

  private async calculateWhaleActivityLevel(): Promise<number> {
    // Get recent whale activity count
    const recentWhales = this.whaleTracker.getSmartMoneyAddresses();
    return Math.min(recentWhales.length / 10, 1) * 100;
  }

  private calculatePerformanceMetrics(signals: AlphaSignal[]): any {
    const totalSignals = signals.length;
    const profitableSignals = signals.filter(s => s.expectedReturn > 0).length;
    const signalAccuracy = totalSignals > 0 ? profitableSignals / totalSignals : 0;
    const avgReturn = totalSignals > 0 ?
      signals.reduce((sum, s) => sum + s.expectedReturn, 0) / totalSignals : 0;

    return {
      signalAccuracy,
      profitableSignals,
      totalSignals,
      avgReturn
    };
  }

  private generateReportSummary(data: any): string {
    const { alphaSignals, whaleActivity, arbitrageOpportunities, anomalies } = data;

    let summary = `Market Intelligence Report Summary:\n\n`;
    summary += `Alpha Signals Generated: ${alphaSignals.length}\n`;
    summary += `Whale Transactions Tracked: ${whaleActivity.length}\n`;
    summary += `Arbitrage Opportunities Found: ${arbitrageOpportunities.length}\n`;
    summary += `Market Anomalies Detected: ${anomalies.length}\n\n`;

    if (alphaSignals.length > 0) {
      const avgConfidence = alphaSignals.reduce((sum, s) => sum + s.confidence, 0) / alphaSignals.length;
      summary += `Average Signal Confidence: ${(avgConfidence * 100).toFixed(1)}%\n`;
    }

    if (anomalies.some(a => a.severity === 'critical')) {
      summary += `\n⚠️ CRITICAL ANOMALIES DETECTED - IMMEDIATE ATTENTION REQUIRED`;
    }

    return summary;
  }

  async start(): Promise<void> {
    // Start all analyzers
    // Note: Individual analyzers don't have start methods yet
    // This is a placeholder for future initialization logic
  }

  async stop(): Promise<void> {
    await this.orderBookAnalyzer.stop();
    await this.whaleTracker.stop();
    await this.arbitrageScanner.stop();
    await this.sentimentAnalyzer.stop();
    await this.telemetry.flush();
  }
}

// Supporting classes
class AlphaGenerator {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async generateFromOrderBook(symbol: string, analysis: any): Promise<AlphaSignal | null> {
    const { metrics, prediction, largeOrders } = analysis;

    // Generate signal based on order book analysis
    if (prediction.confidence < 0.6) return null;

    const signal: AlphaSignal = {
      id: `ob-${symbol}-${Date.now()}`,
      type: 'orderbook',
      symbol,
      action: prediction.direction === 'up' ? 'buy' : 
              prediction.direction === 'down' ? 'sell' : 'hold',
      strength: prediction.confidence,
      confidence: prediction.confidence,
      source: 'OrderBookAnalyzer',
      reasoning: this.generateOrderBookReasoning(analysis),
      timeframe: prediction.timeframe,
      expectedReturn: prediction.expectedMove,
      riskScore: this.calculateOrderBookRisk(metrics),
      timestamp: new Date()
    };

    return signal;
  }

  async generateFromWhaleActivity(activity: WhaleActivity, result: any): Promise<AlphaSignal | null> {
    const { pattern, marketImpact, smartMoneyScore } = result;

    if (!marketImpact || marketImpact.expectedPriceChange === 0) return null;

    const signal: AlphaSignal = {
      id: `whale-${activity.tokenSymbol}-${Date.now()}`,
      type: 'whale',
      symbol: activity.tokenSymbol,
      action: activity.direction === 'accumulation' ? 'buy' :
              activity.direction === 'distribution' ? 'sell' : 'hold',
      strength: smartMoneyScore || 0.5,
      confidence: Math.min(smartMoneyScore || 0.5, 0.9),
      source: 'WhaleTracker',
      reasoning: this.generateWhaleReasoning(activity, result),
      timeframe: marketImpact.timeToImpact,
      expectedReturn: marketImpact.expectedPriceChange,
      riskScore: this.calculateWhaleRisk(activity, result),
      timestamp: new Date()
    };

    return signal;
  }

  async generateFromArbitrage(opportunity: ArbitrageOpportunity): Promise<AlphaSignal | null> {
    // Extract primary symbol from opportunity
    const symbol = opportunity.executionPath[0]?.fromAsset || 'UNKNOWN';

    const signal: AlphaSignal = {
      id: opportunity.id,
      type: 'arbitrage',
      symbol,
      action: 'buy', // Arbitrage is always a buy/sell combo
      strength: opportunity.confidence,
      confidence: opportunity.confidence,
      source: 'ArbitrageScanner',
      reasoning: this.generateArbitrageReasoning(opportunity),
      timeframe: Math.ceil(opportunity.timeWindow / 60), // Convert to minutes
      expectedReturn: opportunity.profitability,
      riskScore: opportunity.riskScore,
      timestamp: new Date()
    };

    return signal;
  }

  async generateFromSentiment(symbol: string, analysis: any, post: any): Promise<AlphaSignal | null> {
    const signal: AlphaSignal = {
      id: `sent-${symbol}-${Date.now()}`,
      type: 'sentiment',
      symbol,
      action: analysis.sentiment > 0.5 ? 'buy' :
              analysis.sentiment < -0.5 ? 'sell' : 'hold',
      strength: Math.abs(analysis.sentiment),
      confidence: analysis.confidence * analysis.impact,
      source: 'SentimentAnalyzer',
      reasoning: this.generateSentimentReasoning(analysis, post),
      timeframe: 60, // 1 hour default
      expectedReturn: analysis.sentiment * analysis.impact * 5, // Simplified
      riskScore: 1 - analysis.confidence,
      timestamp: new Date()
    };

    return signal;
  }

  async generateComposite(event: MarketIntelEvent): Promise<AlphaSignal | null> {
    // Generate composite signals from events
    // This is simplified - would combine multiple data sources
    return null;
  }

  private generateOrderBookReasoning(analysis: any): string {
    const { metrics, prediction, spoofingAlerts, largeOrders } = analysis;
    let reasoning = `Order book analysis indicates ${prediction.direction} movement. `;
    
    if (metrics.imbalance > 0.3) {
      reasoning += `Strong buy-side imbalance (${(metrics.imbalance * 100).toFixed(1)}%). `;
    } else if (metrics.imbalance < -0.3) {
      reasoning += `Strong sell-side imbalance (${(metrics.imbalance * 100).toFixed(1)}%). `;
    }

    if (spoofingAlerts.length > 0) {
      reasoning += `Warning: ${spoofingAlerts.length} spoofing alerts detected. `;
    }

    if (largeOrders.length > 0) {
      reasoning += `${largeOrders.length} large orders identified. `;
    }

    return reasoning;
  }

  private generateWhaleReasoning(activity: WhaleActivity, result: any): string {
    const { pattern, smartMoneyScore } = result;
    let reasoning = `Whale ${activity.direction} detected: ${Number(activity.amount) / 1e18} tokens. `;

    if (pattern) {
      reasoning += `Pattern: ${pattern.pattern} (${(pattern.confidence * 100).toFixed(1)}% confidence). `;
    }

    if (smartMoneyScore && smartMoneyScore > 0.7) {
      reasoning += `Smart money address (score: ${(smartMoneyScore * 100).toFixed(1)}%). `;
    }

    return reasoning;
  }

  private generateArbitrageReasoning(opportunity: ArbitrageOpportunity): string {
    return `${opportunity.type} arbitrage: ${opportunity.profitability.toFixed(2)}% profit. ` +
           `Execution path: ${opportunity.executionPath.length} steps. ` +
           `Time window: ${opportunity.timeWindow}s.`;
  }

  private generateSentimentReasoning(analysis: any, post: any): string {
    let reasoning = `${analysis.sentiment > 0 ? 'Positive' : 'Negative'} sentiment detected `;
    reasoning += `(${(Math.abs(analysis.sentiment) * 100).toFixed(1)}%). `;

    if (analysis.isInfluencer) {
      reasoning += `Posted by influencer. `;
    }

    reasoning += `Keywords: ${analysis.keywords.slice(0, 3).join(', ')}.`;
    return reasoning;
  }

  private calculateOrderBookRisk(metrics: any): number {
    let risk = 0.3; // Base risk

    // High spread = higher risk
    if (metrics.spreadPercentage > 0.5) risk += 0.1;

    // Low liquidity = higher risk
    if (metrics.liquidityScore < 0.3) risk += 0.2;

    // Toxic flow = higher risk
    risk += metrics.toxicFlow * 0.3;

    return Math.min(risk, 1);
  }

  private calculateWhaleRisk(activity: WhaleActivity, result: any): number {
    let risk = 0.4; // Base risk

    // Unknown pattern = higher risk
    if (!result.pattern) risk += 0.2;

    // Low smart money score = higher risk
    if (result.smartMoneyScore < 0.5) risk += 0.1;

    // Distribution = higher risk than accumulation
    if (activity.direction === 'distribution') risk += 0.1;

    return Math.min(risk, 1);
  }
}

class AnomalyDetector {
  private anomalyHistory: MarketAnomaly[] = [];

  async checkOrderBookAnomaly(orderBook: OrderBook, analysis: any): Promise<MarketAnomaly | null> {
    const { metrics, spoofingAlerts } = analysis;

    // Check for extreme spread
    if (metrics.spreadPercentage > 2) {
      return {
        id: `spread-${orderBook.symbol}-${Date.now()}`,
        type: 'orderbook',
        severity: metrics.spreadPercentage > 5 ? 'critical' : 'high',
        description: `Extreme spread detected: ${metrics.spreadPercentage.toFixed(2)}%`,
        affectedSymbols: [orderBook.symbol],
        detectionConfidence: 0.9,
        expectedDuration: 30,
        recommendedAction: 'Avoid market orders, use limit orders only',
        timestamp: new Date()
      };
    }

    // Check for spoofing
    if (spoofingAlerts.length > 3) {
      return {
        id: `spoof-${orderBook.symbol}-${Date.now()}`,
        type: 'orderbook',
        severity: 'high',
        description: `Multiple spoofing attempts detected`,
        affectedSymbols: [orderBook.symbol],
        detectionConfidence: 0.8,
        expectedDuration: 60,
        recommendedAction: 'Exercise caution, potential market manipulation',
        timestamp: new Date()
      };
    }

    return null;
  }

  async getRecentAnomalies(hours: number): Promise<MarketAnomaly[]> {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return this.anomalyHistory.filter(a => a.timestamp.getTime() > cutoff);
  }

  async getAnomaliesForDate(date: Date): Promise<MarketAnomaly[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return this.anomalyHistory.filter(
      a => a.timestamp >= dayStart && a.timestamp <= dayEnd
    );
  }
} 
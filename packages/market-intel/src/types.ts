// Market Intelligence Type Definitions

export interface OrderBook {
  symbol: string;
  timestamp: Date;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastUpdateId: number;
  exchange?: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders?: number;
  timestamp?: Date;
}

export interface OrderBookMetrics {
  bidAskSpread: number;
  spreadPercentage: number;
  depth: { bids: number; asks: number };
  imbalance: number;
  microstructureNoise: number;
  toxicFlow: number;
  liquidityScore: number;
  priceImpact: { buy: number; sell: number };
}

export interface DepthAnalysis {
  supportLevels: PriceLevel[];
  resistanceLevels: PriceLevel[];
  liquidityPockets: LiquidityPocket[];
  imbalanceZones: ImbalanceZone[];
}

export interface PriceLevel {
  price: number;
  strength: number;
  volume: number;
  type: 'support' | 'resistance';
}

export interface LiquidityPocket {
  priceRange: [number, number];
  totalVolume: number;
  side: 'bid' | 'ask';
}

export interface ImbalanceZone {
  price: number;
  imbalanceRatio: number;
  side: 'bullish' | 'bearish';
}

export interface SpoofingAlert {
  timestamp: Date;
  side: 'bid' | 'ask';
  price: number;
  size: number;
  confidence: number;
  pattern: string;
}

export interface LargeOrder {
  price: number;
  size: number;
  side: 'bid' | 'ask';
  hiddenSize?: number;
  icebergDetected: boolean;
}

export interface DirectionPrediction {
  direction: 'up' | 'down' | 'neutral';
  confidence: number;
  timeframe: number; // minutes
  expectedMove: number; // percentage
}

// Whale Tracking Types
export interface WhaleActivity {
  id: string;
  chain: string;
  address: string;
  transactionHash: string;
  amount: bigint;
  tokenSymbol: string;
  direction: 'accumulation' | 'distribution' | 'transfer';
  fromAddress: string;
  toAddress: string;
  impactScore: number;
  timestamp: Date;
  blockNumber: number;
}

export interface WhalePattern {
  address: string;
  pattern: 'accumulator' | 'distributor' | 'trader' | 'holder';
  confidence: number;
  historicalActivity: WhaleActivity[];
  profitability: number;
  avgHoldTime: number;
}

export interface MarketImpact {
  expectedPriceChange: number;
  confidenceInterval: [number, number];
  timeToImpact: number; // minutes
  volatilityIncrease: number;
}

export interface SmartMoneyAddress {
  address: string;
  score: number;
  winRate: number;
  avgProfit: number;
  totalTransactions: number;
  lastActivity: Date;
  tags: string[];
}

// Arbitrage Types
export interface ArbitrageOpportunity {
  id: string;
  type: 'triangular' | 'statistical' | 'crossExchange' | 'crossChain';
  profitability: number;
  profitUSD: number;
  requiredCapital: number;
  executionPath: ExecutionStep[];
  riskScore: number;
  gasEstimate?: bigint;
  timeWindow: number; // seconds
  confidence: number;
  timestamp: Date;
}

export interface ExecutionStep {
  action: 'buy' | 'sell' | 'swap' | 'bridge';
  venue: string;
  fromAsset: string;
  toAsset: string;
  amount: number;
  price: number;
  fees: number;
  estimatedTime: number;
}

export interface TriangularArbitrage {
  path: [string, string, string];
  exchanges: string[];
  profitPercentage: number;
  volumeLimit: number;
}

export interface StatisticalArbitrage {
  pair1: string;
  pair2: string;
  correlation: number;
  zScore: number;
  halfLife: number;
  entryThreshold: number;
  exitThreshold: number;
}

// Sentiment Types
export interface SentimentData {
  symbol: string;
  source: 'twitter' | 'reddit' | 'telegram' | 'discord';
  sentiment: number; // -1 to 1
  volume: number;
  trending: boolean;
  trendingRank?: number;
  keywords: string[];
  influencerMentions: InfluencerMention[];
  timestamp: Date;
}

export interface InfluencerMention {
  username: string;
  followersCount: number;
  influence: number;
  sentiment: number;
  text: string;
  timestamp: Date;
  engagement: {
    likes: number;
    retweets: number;
    comments: number;
  };
}

export interface FOMOScore {
  score: number; // 0-100
  components: {
    priceAction: number;
    volume: number;
    socialVolume: number;
    searchTrends: number;
  };
  signals: string[];
}

export interface InfluencerSentiment {
  influencer: string;
  sentiment: number;
  recentPosts: number;
  accuracy: number;
  influence: number;
}

// Market Intel Service Types
export interface AlphaSignal {
  id: string;
  type: 'orderbook' | 'whale' | 'arbitrage' | 'sentiment' | 'composite';
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  strength: number; // 0-1
  confidence: number; // 0-1
  source: string;
  reasoning: string;
  timeframe: number; // minutes
  expectedReturn: number;
  riskScore: number;
  timestamp: Date;
}

export interface MarketSnapshot {
  timestamp: Date;
  topMovers: MarketMover[];
  unusualActivity: UnusualActivity[];
  sentimentOverview: SentimentOverview;
  liquidityMetrics: LiquidityMetrics;
  arbitrageCount: number;
  whaleActivityLevel: number;
}

export interface MarketMover {
  symbol: string;
  priceChange: number;
  volumeChange: number;
  reason: string;
}

export interface UnusualActivity {
  type: string;
  symbol: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: Date;
}

export interface SentimentOverview {
  overall: number;
  bySource: Map<string, number>;
  trending: string[];
  fearGreedIndex: number;
}

export interface LiquidityMetrics {
  totalLiquidity: number;
  liquidityChange24h: number;
  topLiquidPairs: string[];
  illiquidWarnings: string[];
}

export interface MarketAnomaly {
  id: string;
  type: 'price' | 'volume' | 'orderbook' | 'correlation' | 'sentiment';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedSymbols: string[];
  detectionConfidence: number;
  expectedDuration: number;
  recommendedAction: string;
  timestamp: Date;
}

export interface MarketIntelEvent {
  type: 'orderbook_update' | 'whale_alert' | 'arbitrage_found' | 'sentiment_shift' | 'anomaly_detected';
  data: any;
  priority: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

export interface IntelligenceReport {
  date: Date;
  summary: string;
  alphaSignals: AlphaSignal[];
  whaleActivity: WhaleActivity[];
  arbitrageOpportunities: ArbitrageOpportunity[];
  sentimentAnalysis: SentimentData[];
  anomalies: MarketAnomaly[];
  performanceMetrics: {
    signalAccuracy: number;
    profitableSignals: number;
    totalSignals: number;
    avgReturn: number;
  };
}

// Configuration Types
export interface OrderBookConfig {
  depthLevels: number;
  updateFrequency: number;
  spoofingThreshold: number;
  minOrderSize: number;
  icebergDetection: boolean;
}

export interface WhaleTrackingConfig {
  minTransactionSize: number;
  chains: string[];
  smartMoneyThreshold: number;
  impactAnalysis: boolean;
  trackDexActivity: boolean;
}

export interface ArbitrageScannerConfig {
  minProfitPercentage: number;
  maxExecutionTime: number;
  includeFees: boolean;
  slippageTolerance: number;
  capitalLimit: number;
}

export interface SentimentConfig {
  sources: string[];
  updateInterval: number;
  influencerWeight: number;
  minSampleSize: number;
  languages: string[];
}

export interface MarketIntelConfig {
  orderBook: OrderBookConfig;
  whaleTracking: WhaleTrackingConfig;
  arbitrage: ArbitrageScannerConfig;
  sentiment: SentimentConfig;
  alphaGeneration: {
    minConfidence: number;
    combineSignals: boolean;
    riskAdjusted: boolean;
  };
}

// Telemetry Types
export interface MarketIntelTelemetryEvent {
  eventType: 'orderbook_analyzed' | 'whale_detected' | 'arbitrage_found' | 'sentiment_updated' | 'alpha_generated' | 'anomaly_detected';
  data: any;
  duration?: number;
  timestamp: Date;
}

export interface TelemetryClient {
  track(event: MarketIntelTelemetryEvent): void;
  flush(): Promise<void>;
} 
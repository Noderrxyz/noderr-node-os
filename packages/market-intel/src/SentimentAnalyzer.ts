import { Logger } from '@noderr/utils';
import { EventEmitter } from 'events';
import {
  SentimentData,
  InfluencerMention,
  FOMOScore,
  InfluencerSentiment,
  SentimentConfig,
  TelemetryClient,
  MarketIntelTelemetryEvent
} from './types';

const logger = new Logger('SentimentAnalyzer');
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

interface SentimentMetrics {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  velocity: number; // posts per hour
  acceleration: number; // change in velocity
}

export class SentimentAnalyzer extends EventEmitter {
  private config: SentimentConfig;
  private telemetry: TelemetryClient;
  private sentimentHistory: Map<string, SentimentData[]>;
  private influencerRegistry: Map<string, InfluencerSentiment>;
  private keywordExtractor: KeywordExtractor;
  private sentimentClassifier: SentimentClassifier;
  private fomoDetector: FOMODetector;
  private influencerTracker: InfluencerTracker;
  private readonly HISTORY_LIMIT = 10000;

  constructor(config: SentimentConfig, telemetry: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.sentimentHistory = new Map();
    this.influencerRegistry = new Map();
    this.keywordExtractor = new KeywordExtractor();
    this.sentimentClassifier = new SentimentClassifier();
    this.fomoDetector = new FOMODetector();
    this.influencerTracker = new InfluencerTracker(config);
  }

  async analyzeSocialPost(post: SocialPost, symbol: string): Promise<{
    sentiment: number;
    confidence: number;
    keywords: string[];
    isInfluencer: boolean;
    impact: number;
  }> {
    const startTime = Date.now();

    try {
      // Extract keywords
      const keywords = this.keywordExtractor.extract(post.content);

      // Classify sentiment
      const { sentiment, confidence } = await this.sentimentClassifier.classify(
        post.content,
        keywords
      );

      // Check if author is an influencer
      const isInfluencer = this.influencerTracker.isInfluencer(
        post.author,
        post.metadata?.followersCount || 0
      );

      // Calculate impact score
      const impact = this.calculateImpact(post, sentiment, isInfluencer);

      // Update sentiment data
      this.updateSentimentData(symbol, post.source, sentiment, keywords, post);

      // Track influencer sentiment if applicable
      if (isInfluencer) {
        this.trackInfluencerSentiment(post.author, sentiment, post);
      }

      // Check for significant sentiment shifts
      if (Math.abs(sentiment) > 0.7 && impact > 0.5) {
        this.emit('significant_sentiment', {
          symbol,
          source: post.source,
          sentiment,
          impact,
          post
        });
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'sentiment_updated',
        data: {
          symbol,
          source: post.source,
          sentiment,
          confidence,
          isInfluencer,
          impact
        },
        duration: Date.now() - startTime,
        timestamp: new Date()
      });

      return {
        sentiment,
        confidence,
        keywords,
        isInfluencer,
        impact
      };
    } catch (error) {
      logger.error('Sentiment analysis error:', error);
      throw error;
    }
  }

  async calculateFOMOScore(symbol: string): Promise<FOMOScore> {
    const history = this.getSentimentHistory(symbol);
    const recentData = this.getRecentSentiment(symbol, 24); // 24 hours

    // Calculate FOMO components
    const priceAction = await this.fomoDetector.analyzePriceAction(symbol);
    const volume = await this.fomoDetector.analyzeVolume(symbol);
    const socialVolume = this.calculateSocialVolume(recentData);
    const searchTrends = await this.fomoDetector.analyzeSearchTrends(symbol);

    // Detect FOMO signals
    const signals = this.detectFOMOSignals(
      priceAction,
      volume,
      socialVolume,
      searchTrends,
      recentData
    );

    // Calculate overall FOMO score
    const score = this.fomoDetector.calculateScore({
      priceAction,
      volume,
      socialVolume,
      searchTrends
    });

    // Emit alert if FOMO score is high
    if (score > 75) {
      this.emit('fomo_alert', {
        symbol,
        score,
        signals,
        timestamp: new Date()
      });
    }

    return {
      score,
      components: {
        priceAction,
        volume,
        socialVolume,
        searchTrends
      },
      signals
    };
  }

  async getAggregatedSentiment(
    symbol: string,
    timeframe: number = 24 // hours
  ): Promise<{
    overall: number;
    bySource: Map<string, number>;
    metrics: SentimentMetrics;
    topKeywords: string[];
    influencerSentiment: number;
  }> {
    const recentData = this.getRecentSentiment(symbol, timeframe);
    
    if (recentData.length === 0) {
      return {
        overall: 0,
        bySource: new Map(),
        metrics: {
          positive: 0,
          negative: 0,
          neutral: 0,
          volume: 0,
          velocity: 0,
          acceleration: 0
        },
        topKeywords: [],
        influencerSentiment: 0
      };
    }

    // Calculate overall sentiment
    const overall = this.calculateWeightedSentiment(recentData);

    // Calculate sentiment by source
    const bySource = this.calculateSentimentBySource(recentData);

    // Calculate metrics
    const metrics = this.calculateSentimentMetrics(recentData);

    // Get top keywords
    const topKeywords = this.extractTopKeywords(recentData);

    // Calculate influencer sentiment
    const influencerSentiment = this.calculateInfluencerSentiment(recentData);

    return {
      overall,
      bySource,
      metrics,
      topKeywords,
      influencerSentiment
    };
  }

  getTrendingSymbols(minVolume: number = 100): string[] {
    const symbolVolumes = new Map<string, number>();

    // Count mentions across all sentiment data
    for (const [symbol, history] of this.sentimentHistory) {
      const recentData = this.getRecentSentiment(symbol, 24);
      const volume = recentData.length;
      
      if (volume >= minVolume) {
        symbolVolumes.set(symbol, volume);
      }
    }

    // Sort by volume and return top symbols
    return Array.from(symbolVolumes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([symbol]) => symbol);
  }

  getInfluencerSentiments(symbol: string): InfluencerSentiment[] {
    const sentiments: InfluencerSentiment[] = [];
    const recentData = this.getRecentSentiment(symbol, 48); // 48 hours

    // Group by influencer
    const influencerPosts = new Map<string, SentimentData[]>();
    
    for (const data of recentData) {
      for (const mention of data.influencerMentions) {
        if (!influencerPosts.has(mention.username)) {
          influencerPosts.set(mention.username, []);
        }
        influencerPosts.get(mention.username)!.push(data);
      }
    }

    // Calculate sentiment for each influencer
    for (const [username, posts] of influencerPosts) {
      const influencerData = this.influencerRegistry.get(username);
      
      if (influencerData) {
        sentiments.push({
          influencer: username,
          sentiment: influencerData.sentiment,
          recentPosts: influencerData.recentPosts,
          accuracy: influencerData.accuracy,
          influence: influencerData.influence
        });
      }
    }

    return sentiments.sort((a, b) => b.influence - a.influence);
  }

  private updateSentimentData(
    symbol: string,
    source: 'twitter' | 'reddit' | 'telegram' | 'discord',
    sentiment: number,
    keywords: string[],
    post: SocialPost
  ): void {
    if (!this.sentimentHistory.has(symbol)) {
      this.sentimentHistory.set(symbol, []);
    }

    const history = this.sentimentHistory.get(symbol)!;
    
    // Create sentiment data entry
    const sentimentData: SentimentData = {
      symbol,
      source,
      sentiment,
      volume: 1,
      trending: false, // Will be updated separately
      keywords,
      influencerMentions: [],
      timestamp: post.timestamp
    };

    // Add influencer mention if applicable    if (post.metadata?.followersCount && post.metadata.followersCount > 10000) {      sentimentData.influencerMentions.push({        username: post.author,        followersCount: post.metadata.followersCount,        influence: this.calculateInfluence(post.metadata.followersCount),        sentiment,        text: post.content,        timestamp: post.timestamp,        engagement: {          likes: post.engagement.likes,          retweets: post.engagement.retweets || 0,          comments: post.engagement.comments        }      });    }

    history.push(sentimentData);

    // Maintain history limit
    if (history.length > this.HISTORY_LIMIT) {
      history.shift();
    }
  }

  private trackInfluencerSentiment(
    username: string,
    sentiment: number,
    post: SocialPost
  ): void {
    const existing = this.influencerRegistry.get(username) || {
      influencer: username,
      sentiment: 0,
      recentPosts: 0,
      accuracy: 0.5,
      influence: 0
    };

    // Update sentiment (exponential moving average)
    existing.sentiment = existing.sentiment * 0.7 + sentiment * 0.3;
    existing.recentPosts++;
    existing.influence = this.calculateInfluence(
      post.metadata?.followersCount || 0
    );

    this.influencerRegistry.set(username, existing);
  }

  private calculateImpact(
    post: SocialPost,
    sentiment: number,
    isInfluencer: boolean
  ): number {
    let impact = 0;

    // Engagement impact
    const engagementScore = Math.log10(
      post.engagement.likes + 
      (post.engagement.retweets || 0) * 2 + 
      post.engagement.comments + 1
    ) / 5;
    impact += engagementScore * 0.3;

    // Sentiment strength impact
    impact += Math.abs(sentiment) * 0.3;

    // Influencer impact
    if (isInfluencer) {
      impact += 0.2;
    }

    // Follower count impact
    if (post.metadata?.followersCount) {
      impact += Math.log10(post.metadata.followersCount + 1) / 10 * 0.2;
    }

    return Math.min(impact, 1);
  }

  private calculateInfluence(followersCount: number): number {
    // Logarithmic scale for influence
    return Math.min(Math.log10(followersCount + 1) / 7, 1);
  }

  private calculateWeightedSentiment(data: SentimentData[]): number {
    if (data.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const item of data) {
      // Weight by recency
      const age = Date.now() - item.timestamp.getTime();
      const recencyWeight = Math.exp(-age / (24 * 60 * 60 * 1000)); // 24h decay

      // Weight by volume
      const volumeWeight = Math.log10(item.volume + 1);

      // Weight by influencer mentions
      const influencerWeight = item.influencerMentions.length > 0 ? 2 : 1;

      const weight = recencyWeight * volumeWeight * influencerWeight;
      weightedSum += item.sentiment * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateSentimentBySource(
    data: SentimentData[]
  ): Map<string, number> {
    const bySource = new Map<string, number>();
    const counts = new Map<string, number>();

    for (const item of data) {
      const current = bySource.get(item.source) || 0;
      const count = counts.get(item.source) || 0;
      
      bySource.set(item.source, current + item.sentiment);
      counts.set(item.source, count + 1);
    }

    // Calculate averages
    for (const [source, total] of bySource) {
      const count = counts.get(source)!;
      bySource.set(source, total / count);
    }

    return bySource;
  }

  private calculateSentimentMetrics(data: SentimentData[]): SentimentMetrics {
    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const item of data) {
      if (item.sentiment > 0.1) positive++;
      else if (item.sentiment < -0.1) negative++;
      else neutral++;
    }

    const volume = data.length;
    
    // Calculate velocity (posts per hour)
    const timeRange = data.length > 0 ? 
      data[data.length - 1].timestamp.getTime() - data[0].timestamp.getTime() : 0;
    const hours = timeRange / (60 * 60 * 1000);
    const velocity = hours > 0 ? volume / hours : 0;

    // Calculate acceleration (simplified)
    const midPoint = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, midPoint);
    const secondHalf = data.slice(midPoint);
    
    const firstVelocity = firstHalf.length / (hours / 2);
    const secondVelocity = secondHalf.length / (hours / 2);
    const acceleration = secondVelocity - firstVelocity;

    return {
      positive,
      negative,
      neutral,
      volume,
      velocity,
      acceleration
    };
  }

  private extractTopKeywords(data: SentimentData[]): string[] {
    const keywordCounts = new Map<string, number>();

    for (const item of data) {
      for (const keyword of item.keywords) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      }
    }

    return Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword]) => keyword);
  }

  private calculateInfluencerSentiment(data: SentimentData[]): number {
    const influencerMentions = data.flatMap(d => d.influencerMentions);
    
    if (influencerMentions.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const mention of influencerMentions) {
      const weight = mention.influence;
      weightedSum += mention.sentiment * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private calculateSocialVolume(data: SentimentData[]): number {
    // Normalize social volume to 0-100 scale
    const volume = data.length;
    const normalizedVolume = Math.min(volume / 10, 100);
    
    // Apply time decay
    const recentVolume = data.filter(d => 
      Date.now() - d.timestamp.getTime() < 6 * 60 * 60 * 1000 // 6 hours
    ).length;
    
    const recentWeight = recentVolume / volume;
    
    return normalizedVolume * (0.5 + recentWeight * 0.5);
  }

  private detectFOMOSignals(
    priceAction: number,
    volume: number,
    socialVolume: number,
    searchTrends: number,
    sentimentData: SentimentData[]
  ): string[] {
    const signals: string[] = [];

    // Price surge signal
    if (priceAction > 80) {
      signals.push('Significant price surge detected');
    }

    // Volume spike signal
    if (volume > 90) {
      signals.push('Extreme volume spike');
    }

    // Social media frenzy
    if (socialVolume > 85) {
      signals.push('Social media frenzy detected');
    }

    // Search trend explosion
    if (searchTrends > 80) {
      signals.push('Search interest exploding');
    }

    // Influencer pile-on
    const recentInfluencers = sentimentData
      .filter(d => Date.now() - d.timestamp.getTime() < 6 * 60 * 60 * 1000)
      .flatMap(d => d.influencerMentions);
    
    if (recentInfluencers.length > 5) {
      signals.push('Multiple influencers promoting');
    }

    // Sentiment extremes
    const avgSentiment = this.calculateWeightedSentiment(sentimentData);
    if (avgSentiment > 0.8) {
      signals.push('Extreme positive sentiment');
    }

    return signals;
  }

  private getSentimentHistory(symbol: string): SentimentData[] {
    return this.sentimentHistory.get(symbol) || [];
  }

  private getRecentSentiment(symbol: string, hours: number): SentimentData[] {
    const history = this.getSentimentHistory(symbol);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    
    return history.filter(d => d.timestamp.getTime() > cutoff);
  }

  async stop(): Promise<void> {
    this.sentimentHistory.clear();
    this.influencerRegistry.clear();
    await this.telemetry.flush();
  }
}

// Supporting classes
class KeywordExtractor {
  private readonly stopWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'as', 'are',
    'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'done',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'them', 'their', 'what', 'which', 'who', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'some', 'any',
    'few', 'many', 'much', 'most', 'other', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
    'in', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
    'once', 'rt', 'via'
  ]);

  private readonly cryptoKeywords = new Set([
    'moon', 'lambo', 'hodl', 'fud', 'fomo', 'dyor', 'ath', 'atl',
    'bullish', 'bearish', 'pump', 'dump', 'whale', 'bag', 'shill',
    'rekt', 'diamond hands', 'paper hands', 'to the moon', 'buy the dip',
    'sell', 'buy', 'long', 'short', 'leverage', 'liquidation', 'margin'
  ]);

  extract(text: string): string[] {
    // Convert to lowercase and split into words
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);

    // Filter out stop words
    const filtered = words.filter(word => !this.stopWords.has(word));

    // Extract crypto-specific keywords
    const keywords: string[] = [];
    const textLower = text.toLowerCase();

    for (const keyword of this.cryptoKeywords) {
      if (textLower.includes(keyword)) {
        keywords.push(keyword);
      }
    }

    // Extract hashtags
    const hashtags = text.match(/#\w+/g) || [];
    keywords.push(...hashtags.map(h => h.toLowerCase()));

    // Extract cashtags (stock symbols)
    const cashtags = text.match(/\$[A-Z]+/g) || [];
    keywords.push(...cashtags.map(c => c.toLowerCase()));

    // Get most frequent words
    const wordCounts = new Map<string, number>();
    for (const word of filtered) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    const topWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    keywords.push(...topWords);

    // Remove duplicates
    return Array.from(new Set(keywords));
  }
}

class SentimentClassifier {
  private readonly positiveWords = new Set([
    'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic',
    'love', 'like', 'best', 'happy', 'excited', 'bullish', 'moon',
    'profit', 'gain', 'up', 'high', 'buy', 'long', 'growth', 'surge',
    'rally', 'breakout', 'strong', 'positive', 'optimistic', 'confident'
  ]);

  private readonly negativeWords = new Set([
    'bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'worst',
    'sad', 'angry', 'bearish', 'crash', 'dump', 'loss', 'down', 'low',
    'sell', 'short', 'decline', 'fall', 'drop', 'weak', 'negative',
    'pessimistic', 'worried', 'concerned', 'fear', 'fud', 'scam', 'rug'
  ]);

  private readonly intensifiers = new Set([
    'very', 'extremely', 'really', 'absolutely', 'completely', 'totally',
    'quite', 'highly', 'deeply', 'strongly', 'incredibly', 'super'
  ]);

  async classify(text: string, keywords: string[]): Promise<{
    sentiment: number;
    confidence: number;
  }> {
    const words = text.toLowerCase().split(/\s+/);
    let positiveScore = 0;
    let negativeScore = 0;
    let intensifierCount = 0;

    // Count sentiment words
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // Check for intensifiers
      if (this.intensifiers.has(word)) {
        intensifierCount++;
      }

      // Check for positive words
      if (this.positiveWords.has(word)) {
        const intensity = i > 0 && this.intensifiers.has(words[i - 1]) ? 2 : 1;
        positiveScore += intensity;
      }

      // Check for negative words
      if (this.negativeWords.has(word)) {
        const intensity = i > 0 && this.intensifiers.has(words[i - 1]) ? 2 : 1;
        negativeScore += intensity;
      }
    }

    // Check keywords for additional sentiment
    for (const keyword of keywords) {
      if (keyword.includes('moon') || keyword.includes('lambo')) {
        positiveScore += 0.5;
      } else if (keyword.includes('fud') || keyword.includes('dump')) {
        negativeScore += 0.5;
      }
    }

    // Calculate sentiment score
    const totalScore = positiveScore + negativeScore;
    let sentiment = 0;
    
    if (totalScore > 0) {
      sentiment = (positiveScore - negativeScore) / totalScore;
    }

    // Calculate confidence based on signal strength
    const confidence = Math.min(totalScore / words.length, 1) * 0.8 + 0.2;

    return {
      sentiment: Math.max(-1, Math.min(1, sentiment)),
      confidence
    };
  }
}

class FOMODetector {
  async analyzePriceAction(symbol: string): Promise<number> {
    // Placeholder - would integrate with price data
    // Returns 0-100 score based on recent price movement
    return Math.random() * 100;
  }

  async analyzeVolume(symbol: string): Promise<number> {
    // Placeholder - would integrate with volume data
    // Returns 0-100 score based on volume spike
    return Math.random() * 100;
  }

  async analyzeSearchTrends(symbol: string): Promise<number> {
    // Placeholder - would integrate with Google Trends or similar
    // Returns 0-100 score based on search interest
    return Math.random() * 100;
  }

  calculateScore(components: {
    priceAction: number;
    volume: number;
    socialVolume: number;
    searchTrends: number;
  }): number {
    // Weighted average of components
    const weights = {
      priceAction: 0.3,
      volume: 0.25,
      socialVolume: 0.25,
      searchTrends: 0.2
    };

    let score = 0;
    score += components.priceAction * weights.priceAction;
    score += components.volume * weights.volume;
    score += components.socialVolume * weights.socialVolume;
    score += components.searchTrends * weights.searchTrends;

    // Apply non-linear scaling for extreme values
    if (score > 70) {
      score = 70 + (score - 70) * 1.5;
    }

    return Math.min(100, score);
  }
}

class InfluencerTracker {
  private config: SentimentConfig;
  private readonly influencerThreshold = 10000; // followers

  constructor(config: SentimentConfig) {
    this.config = config;
  }

  isInfluencer(username: string, followersCount: number): boolean {
    // Check follower count
    if (followersCount >= this.influencerThreshold) {
      return true;
    }

    // Check against known influencer list (would be loaded from config)
    const knownInfluencers = [
      'elonmusk', 'vitalikbuterin', 'cz_binance', 'satoshilite',
      'aantonop', 'novogratz', 'apompliano', 'raoulpal'
    ];

    return knownInfluencers.includes(username.toLowerCase());
  }

  calculateInfluencerWeight(followersCount: number): number {
    // Logarithmic scale with diminishing returns
    const base = Math.log10(followersCount + 1);
    const normalized = base / 8; // Normalize to roughly 0-1 for 100M followers
    
    // Apply weight from config
    return Math.min(normalized * this.config.influencerWeight, 1);
  }
} 
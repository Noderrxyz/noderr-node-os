/**
 * LLMFeatureSuggester - AI-Powered Feature Discovery
 * 
 * Uses LLMs to suggest novel features and data sources for trading strategies
 * based on market regime, existing features, and performance gaps
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import PQueue from 'p-queue';
import NodeCache from 'node-cache';

import { FeatureSuggestion, LLMProvider } from '@noderr/types';

// Feature suggestion validation schema
const FeatureSuggestionSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  category: z.enum(['market', 'technical', 'fundamental', 'alternative', 'synthetic']),
  dataSource: z.string(),
  implementation: z.object({
    code: z.string(),
    dependencies: z.array(z.string()),
    complexity: z.enum(['low', 'medium', 'high'])
  }),
  expectedImpact: z.object({
    sharpeImprovement: z.number().min(0).max(2),
    correlationWithExisting: z.number().min(-1).max(1),
    dataAvailability: z.number().min(0).max(1)
  })
});

interface FeatureSuggesterConfig {
  providers: LLMProvider[];
  maxSuggestionsPerRun: number;
  temperature: number;
  maxTokens: number;
  cacheEnabled: boolean;
  cacheTTL: number;
  diversityThreshold: number; // Minimum difference required between features
}

interface MarketContext {
  regime: 'bull' | 'bear' | 'sideways' | 'volatile';
  dominantAssets: string[];
  recentEvents: string[];
  performanceGaps: string[];
}

export class LLMFeatureSuggester extends EventEmitter {
  private logger: Logger;
  private config: FeatureSuggesterConfig;
  private providers: Map<string, any> = new Map();
  private cache: NodeCache;
  private queue: PQueue;
  private suggestedFeatures: Map<string, FeatureSuggestion> = new Map();
  private featureHistory: FeatureSuggestion[] = [];
  
  constructor(logger: Logger, config: FeatureSuggesterConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.cache = new NodeCache({
      stdTTL: config.cacheTTL || 7200, // 2 hours default
      checkperiod: 600
    });
    this.queue = new PQueue({
      concurrency: 2
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing LLM Feature Suggester');

    // Initialize providers
    for (const provider of this.config.providers) {
      await this.initializeProvider(provider);
    }

    this.logger.info('Feature Suggester initialized');
  }

  private async initializeProvider(provider: LLMProvider): Promise<void> {
    switch (provider.name) {
      case 'claude-3':
        if (!provider.apiKey) throw new Error('Claude API key required');
        this.providers.set('claude-3', new Anthropic({
          apiKey: provider.apiKey
        }));
        break;
      
      case 'gpt-4':
      case 'gpt-4-turbo':
        if (!provider.apiKey) throw new Error('OpenAI API key required');
        this.providers.set(provider.name, new OpenAI({
          apiKey: provider.apiKey
        }));
        break;
    }
  }

  /**
   * Suggest novel features based on existing features and market context
   */
  async suggestFeatures(
    existingFeatures: string[],
    marketContext: MarketContext,
    targetCount: number = 5
  ): Promise<FeatureSuggestion[]> {
    this.logger.info('Suggesting new features', {
      existingCount: existingFeatures.length,
      marketRegime: marketContext.regime,
      targetCount
    });

    try {
      // Check cache
      const cacheKey = this.getCacheKey(existingFeatures, marketContext);
      const cached = this.cache.get<FeatureSuggestion[]>(cacheKey);
      if (cached && this.config.cacheEnabled) {
        this.logger.debug('Using cached feature suggestions');
        return cached;
      }

      // Generate suggestions using multiple approaches
      const suggestions = await this.queue.add(async () => {
        const results = await Promise.all([
          this.suggestMarketMicrostructureFeatures(existingFeatures, marketContext),
          this.suggestAlternativeDataFeatures(existingFeatures, marketContext),
          this.suggestCrossAssetFeatures(existingFeatures, marketContext),
          this.suggestSentimentFeatures(existingFeatures, marketContext),
          this.suggestOnChainFeatures(existingFeatures, marketContext)
        ]);

        return results.flat();
      });

      // Filter and rank suggestions
      const filtered = await this.filterAndRankSuggestions(suggestions, existingFeatures);
      const selected = filtered.slice(0, targetCount);

      // Validate suggestions
      const validated = await this.validateSuggestions(selected);

      // Cache results
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, validated);
      }

      // Store in history
      this.featureHistory.push(...validated);
      validated.forEach(f => this.suggestedFeatures.set(f.name, f));

      // Emit event
      this.emit('features:suggested', validated);

      return validated;

    } catch (error) {
      this.logger.error('Failed to suggest features', { error });
      throw error;
    }
  }

  /**
   * Suggest market microstructure features
   */
  private async suggestMarketMicrostructureFeatures(
    existing: string[],
    context: MarketContext
  ): Promise<FeatureSuggestion[]> {
    const prompt = `Given these existing features:
${existing.join('\n')}

And market context:
- Regime: ${context.regime}
- Dominant assets: ${context.dominantAssets.join(', ')}

Suggest 3 novel MARKET MICROSTRUCTURE features that could improve trading performance.
Focus on order flow, liquidity, spreads, depth, and execution dynamics.

Return as JSON array with format:
[{
  "name": "feature_name",
  "description": "what it measures",
  "category": "market",
  "dataSource": "where to get data",
  "implementation": {
    "code": "// calculation code",
    "dependencies": ["package1"],
    "complexity": "low|medium|high"
  },
  "expectedImpact": {
    "sharpeImprovement": 0.1,
    "correlationWithExisting": 0.3,
    "dataAvailability": 0.9
  }
}]`;

    return this.generateFeatures(prompt, 'claude-3');
  }

  /**
   * Suggest alternative data features
   */
  private async suggestAlternativeDataFeatures(
    existing: string[],
    context: MarketContext
  ): Promise<FeatureSuggestion[]> {
    const prompt = `Given existing features and ${context.regime} market regime,
suggest 3 ALTERNATIVE DATA features for crypto trading.

Consider:
- Social media sentiment
- News analytics
- Blockchain metrics
- DeFi activity
- Developer activity
- Regulatory signals

Avoid duplicating: ${existing.slice(0, 10).join(', ')}

Return as structured JSON with implementation details.`;

    return this.generateFeatures(prompt, 'gpt-4');
  }

  /**
   * Suggest cross-asset correlation features
   */
  private async suggestCrossAssetFeatures(
    existing: string[],
    context: MarketContext
  ): Promise<FeatureSuggestion[]> {
    const prompt = `For ${context.dominantAssets.join(', ')} in ${context.regime} market,
suggest 3 CROSS-ASSET CORRELATION features.

Consider:
- Traditional market correlations (stocks, bonds, commodities)
- Crypto correlations
- Macro indicators
- Currency relationships
- Volatility spillovers

Return as JSON with implementation code.`;

    return this.generateFeatures(prompt, 'claude-3');
  }

  /**
   * Suggest sentiment-based features
   */
  private async suggestSentimentFeatures(
    existing: string[],
    context: MarketContext
  ): Promise<FeatureSuggestion[]> {
    const events = context.recentEvents.slice(0, 3).join(', ');
    const prompt = `Given recent events: ${events}

Suggest 3 SENTIMENT features for crypto trading:
- Twitter/X sentiment
- Reddit activity
- News sentiment
- Fear & Greed indicators
- Whale sentiment
- Funding rates sentiment

Return as structured JSON.`;

    return this.generateFeatures(prompt, 'gpt-4-turbo');
  }

  /**
   * Suggest on-chain features
   */
  private async suggestOnChainFeatures(
    existing: string[],
    context: MarketContext
  ): Promise<FeatureSuggestion[]> {
    const prompt = `For ${context.dominantAssets.filter(a => ['BTC', 'ETH'].includes(a)).join(', ')},
suggest 3 ON-CHAIN features:

- Network activity (transactions, active addresses)
- Exchange flows
- Miner/validator behavior
- Smart contract activity
- Stablecoin flows
- DeFi TVL changes

Focus on predictive power for price movements.
Return as JSON with data source information.`;

    return this.generateFeatures(prompt, 'claude-3');
  }

  /**
   * Generate features using LLM
   */
  private async generateFeatures(prompt: string, providerName: string): Promise<FeatureSuggestion[]> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      this.logger.warn(`Provider ${providerName} not available`);
      return [];
    }

    try {
      let response: string;

      if (providerName === 'claude-3') {
        const result = await provider.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: this.config.maxTokens || 2000,
          temperature: this.config.temperature || 0.7,
          messages: [{
            role: 'user',
            content: prompt
          }]
        });
        
        const content = result.content[0];
        if (content.type !== 'text') return [];
        response = content.text;
        
      } else {
        const result = await provider.chat.completions.create({
          model: providerName,
          messages: [{
            role: 'user',
            content: prompt
          }],
          max_tokens: this.config.maxTokens || 2000,
          temperature: this.config.temperature || 0.7,
          response_format: { type: 'json_object' }
        });
        
        response = result.choices[0]?.message?.content || '[]';
      }

      // Parse response
      const parsed = this.parseFeatureResponse(response);
      return parsed;

    } catch (error) {
      this.logger.error('Failed to generate features', { error, provider: providerName });
      return [];
    }
  }

  /**
   * Parse LLM response into feature suggestions
   */
  private parseFeatureResponse(response: string): FeatureSuggestion[] {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];

      // Convert to our format
      return parsed.map(item => ({
        name: item.name || 'unnamed_feature',
        description: item.description || '',
        importance: item.expectedImpact?.sharpeImprovement || 0.1,
        category: item.category || 'synthetic',
        implementation: item.implementation?.code || '',
        requiredData: item.implementation?.dependencies || []
      }));

    } catch (error) {
      this.logger.error('Failed to parse feature response', { error });
      return [];
    }
  }

  /**
   * Filter and rank feature suggestions
   */
  private async filterAndRankSuggestions(
    suggestions: FeatureSuggestion[],
    existing: string[]
  ): Promise<FeatureSuggestion[]> {
    // Remove duplicates
    const unique = suggestions.filter((s, i, arr) => 
      arr.findIndex(x => x.name === s.name) === i
    );

    // Remove features too similar to existing
    const novel = unique.filter(s => {
      const similarity = this.calculateSimilarity(s.name, existing);
      return similarity < this.config.diversityThreshold;
    });

    // Rank by expected impact
    const ranked = novel.sort((a, b) => b.importance - a.importance);

    return ranked;
  }

  /**
   * Calculate similarity between feature names
   */
  private calculateSimilarity(feature: string, existing: string[]): number {
    const normalized = feature.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    let maxSimilarity = 0;
    for (const exist of existing) {
      const existNorm = exist.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Simple character overlap similarity
      const overlap = this.getOverlap(normalized, existNorm);
      const similarity = overlap / Math.max(normalized.length, existNorm.length);
      
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
    
    return maxSimilarity;
  }

  private getOverlap(s1: string, s2: string): number {
    let overlap = 0;
    const chars1 = new Set(s1.split(''));
    const chars2 = new Set(s2.split(''));
    
    for (const char of chars1) {
      if (chars2.has(char)) overlap++;
    }
    
    return overlap;
  }

  /**
   * Validate feature suggestions
   */
  private async validateSuggestions(suggestions: FeatureSuggestion[]): Promise<FeatureSuggestion[]> {
    const validated: FeatureSuggestion[] = [];

    for (const suggestion of suggestions) {
      try {
        // Basic validation
        if (!suggestion.name || !suggestion.description) continue;
        if (suggestion.name.length < 3 || suggestion.name.length > 100) continue;
        
        // Check if implementation is feasible
        if (suggestion.requiredData.length > 10) {
          this.logger.warn('Feature requires too many dependencies', {
            feature: suggestion.name,
            dependencies: suggestion.requiredData.length
          });
          continue;
        }

        validated.push(suggestion);

      } catch (error) {
        this.logger.error('Feature validation failed', { 
          error, 
          feature: suggestion.name 
        });
      }
    }

    return validated;
  }

  /**
   * Evaluate feature importance using historical data
   */
  async evaluateFeatureImportance(
    feature: FeatureSuggestion,
    historicalData: any[]
  ): Promise<number> {
    // This would implement feature importance calculation
    // Using techniques like:
    // - Mutual information
    // - Random forest importance
    // - SHAP values
    // - Correlation with target
    
    // Simplified mock implementation
    const baseImportance = feature.importance || 0.1;
    const dataQuality = historicalData.length > 1000 ? 1.0 : 0.5;
    const noveltyBonus = this.suggestedFeatures.size < 10 ? 0.2 : 0;
    
    return Math.min(1.0, baseImportance * dataQuality + noveltyBonus);
  }

  /**
   * Generate implementation code for a feature
   */
  async generateImplementation(feature: FeatureSuggestion): Promise<string> {
    const prompt = `Generate production-ready TypeScript code to calculate the feature:
Name: ${feature.name}
Description: ${feature.description}
Category: ${feature.category}

Requirements:
- Efficient computation
- Handle edge cases
- Include type definitions
- Add documentation
- Support streaming data

Return complete implementation.`;

    try {
      const provider = this.providers.get('claude-3');
      if (!provider) throw new Error('Claude provider not available');

      const response = await provider.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 3000,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') return '';

      // Extract code
      const codeMatch = content.text.match(/```typescript\n([\s\S]*?)```/);
      return codeMatch ? codeMatch[1] : content.text;

    } catch (error) {
      this.logger.error('Failed to generate implementation', { error });
      return `// Failed to generate implementation for ${feature.name}`;
    }
  }

  /**
   * Get cache key for feature suggestions
   */
  private getCacheKey(features: string[], context: MarketContext): string {
    const featureHash = features.sort().join('|').substring(0, 100);
    const contextHash = `${context.regime}-${context.dominantAssets.join('-')}`;
    return `features:${featureHash}:${contextHash}`;
  }

  /**
   * Get suggested features by category
   */
  getFeaturesByCategory(category: string): FeatureSuggestion[] {
    return Array.from(this.suggestedFeatures.values())
      .filter(f => f.category === category);
  }

  /**
   * Get top performing features
   */
  getTopFeatures(count: number = 10): FeatureSuggestion[] {
    return Array.from(this.suggestedFeatures.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, count);
  }

  /**
   * Export features for integration
   */
  exportFeatures(): Record<string, any> {
    const features: Record<string, any> = {};
    
    for (const [name, feature] of this.suggestedFeatures) {
      features[name] = {
        description: feature.description,
        category: feature.category,
        importance: feature.importance,
        implementation: feature.implementation,
        metadata: {
          suggestedAt: Date.now(),
          requiredData: feature.requiredData
        }
      };
    }
    
    return features;
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Feature Suggester');
    
    // Clear queue
    this.queue.clear();
    await this.queue.onIdle();
    
    // Clear cache
    this.cache.flushAll();
    
    // Save feature history
    this.logger.info(`Suggested ${this.suggestedFeatures.size} features total`);
  }
} 
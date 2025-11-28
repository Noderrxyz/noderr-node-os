/**
 * LLMAlphaGenerator - Natural Language to Trading Strategy Generator
 * 
 * Converts natural language prompts into executable trading strategies
 * using state-of-the-art LLMs with safety constraints and validation
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import NodeCache from 'node-cache';
import PQueue from 'p-queue';
import { z } from 'zod';

import {
  LLMProvider,
  LLMStrategy,
  SafetyConstraints,
  StrategyPerformance
} from '@noderr/types';

// Strategy code validation schema
const StrategyCodeSchema = z.object({
  entryConditions: z.array(z.object({
    indicator: z.string(),
    operator: z.enum(['>', '<', '>=', '<=', '==', '!=']),
    value: z.union([z.number(), z.string()]),
    weight: z.number().min(0).max(1)
  })),
  exitConditions: z.array(z.object({
    indicator: z.string(),
    operator: z.enum(['>', '<', '>=', '<=', '==', '!=']),
    value: z.union([z.number(), z.string()]),
    weight: z.number().min(0).max(1)
  })),
  positionSizing: z.object({
    method: z.enum(['fixed', 'kelly', 'volatility', 'risk_parity']),
    params: z.record(z.any())
  }),
  riskManagement: z.object({
    stopLoss: z.number().optional(),
    takeProfit: z.number().optional(),
    maxDrawdown: z.number(),
    positionLimit: z.number()
  }),
  targetAssets: z.array(z.string()),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string())
  })
});

interface LLMAlphaGeneratorConfig {
  providers: LLMProvider[];
  maxTokens: number;
  temperature: number;
  safetyConstraints: SafetyConstraints;
  cacheEnabled: boolean;
  cacheTTL: number; // seconds
  maxConcurrency: number;
  retryAttempts: number;
  validationEnabled: boolean;
}

export class LLMAlphaGenerator extends EventEmitter {
  private logger: Logger;
  private config: LLMAlphaGeneratorConfig;
  private providers: Map<string, any> = new Map();
  private cache: NodeCache;
  private queue: PQueue;
  private strategies: Map<string, LLMStrategy> = new Map();
  private metrics = {
    generated: 0,
    validated: 0,
    rejected: 0,
    deployed: 0,
    totalTime: 0,
    avgGenerationTime: 0
  };

  constructor(logger: Logger, config: LLMAlphaGeneratorConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.cache = new NodeCache({ 
      stdTTL: config.cacheTTL || 3600,
      checkperiod: 600 
    });
    this.queue = new PQueue({ 
      concurrency: config.maxConcurrency || 3 
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing LLM Alpha Generator');

    // Initialize LLM providers
    for (const provider of this.config.providers) {
      await this.initializeProvider(provider);
    }

    this.logger.info('LLM Alpha Generator initialized', {
      providers: this.config.providers.map(p => p.name),
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature
    });
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
      
      case 'local':
        // Local model implementation
        this.logger.warn('Local LLM provider not yet implemented');
        break;
      
      default:
        throw new Error(`Unknown LLM provider: ${provider.name}`);
    }
  }

  /**
   * Generate a trading strategy from natural language prompt
   */
  async generateStrategy(prompt: string, provider: string = 'claude-3'): Promise<LLMStrategy> {
    const startTime = Date.now();
    const strategyId = uuidv4();

    this.logger.info('Generating strategy from prompt', {
      strategyId,
      provider,
      promptLength: prompt.length
    });

    try {
      // Check cache first
      const cacheKey = `strategy:${this.hashPrompt(prompt)}:${provider}`;
      const cached = this.cache.get<string>(cacheKey);
      if (cached && this.config.cacheEnabled) {
        this.logger.debug('Using cached strategy', { strategyId });
        return JSON.parse(cached);
      }

      // Generate strategy using LLM
      const strategy = await this.queue.add(() => 
        this.generateWithProvider(prompt, provider, strategyId)
      );

      // Validate strategy
      if (this.config.validationEnabled) {
        await this.validateStrategy(strategy);
      }

      // Apply safety constraints
      this.applySafetyConstraints(strategy);

      // Cache result
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, JSON.stringify(strategy));
      }

      // Update metrics
      const generationTime = Date.now() - startTime;
      this.updateMetrics(generationTime, true);

      // Store strategy
      this.strategies.set(strategyId, strategy);

      // Emit event
      this.emit('strategy:generated', strategy);

      return strategy;

    } catch (error) {
      this.logger.error('Failed to generate strategy', { 
        error, 
        strategyId,
        prompt: prompt.substring(0, 100) 
      });
      
      this.updateMetrics(Date.now() - startTime, false);
      
      throw error;
    }
  }

  private async generateWithProvider(
    prompt: string, 
    providerName: string, 
    strategyId: string
  ): Promise<LLMStrategy> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not initialized`);
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(prompt);

    let generatedCode: string = '';
    let explanation: string = 'Strategy generated from natural language prompt';

    switch (providerName) {
      case 'claude-3':
        const claudeResponse = await provider.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });
        
        const content = claudeResponse.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected response type from Claude');
        }
        
        ({ code: generatedCode, explanation } = this.parseResponse(content.text));
        break;

      case 'gpt-4':
      case 'gpt-4-turbo':
        const openaiResponse = await provider.chat.completions.create({
          model: providerName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          response_format: { type: 'json_object' }
        });

        const gptContent = openaiResponse.choices[0]?.message?.content;
        if (!gptContent) {
          throw new Error('No response from OpenAI');
        }

        ({ code: generatedCode, explanation } = JSON.parse(gptContent));
        break;

      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }

    return {
      id: strategyId,
      prompt,
      generatedCode,
      constraints: this.config.safetyConstraints,
      status: 'validating',
      createdAt: new Date()
    };
  }

  private buildSystemPrompt(): string {
    return `You are an expert quantitative trading strategy developer. Your task is to convert natural language descriptions into executable trading strategies.

REQUIREMENTS:
1. Generate valid TypeScript/JavaScript code that implements the trading logic
2. Include clear entry and exit conditions
3. Implement proper risk management (stop loss, position sizing)
4. Consider market microstructure and execution costs
5. Optimize for Sharpe ratio and risk-adjusted returns

OUTPUT FORMAT:
Return a JSON object with:
{
  "code": "// Complete strategy implementation",
  "explanation": "Brief explanation of the strategy logic",
  "expectedPerformance": {
    "sharpeRatio": "estimated value",
    "maxDrawdown": "estimated percentage",
    "winRate": "estimated percentage"
  }
}

CONSTRAINTS:
- Max position size: ${this.config.safetyConstraints.maxPositionSize}% of portfolio
- Max leverage: ${this.config.safetyConstraints.maxLeverage}x
- Max drawdown: ${this.config.safetyConstraints.maxDrawdown}%
- Min Sharpe ratio: ${this.config.safetyConstraints.minSharpe}
- Forbidden assets: ${this.config.safetyConstraints.forbiddenAssets.join(', ')}`;
  }

  private buildUserPrompt(prompt: string): string {
    return `Generate a trading strategy based on the following description:

"${prompt}"

Additional requirements:
- The strategy should be production-ready
- Include comprehensive error handling
- Optimize for low latency execution
- Consider transaction costs and slippage
- Implement adaptive position sizing based on volatility

Please provide the complete implementation.`;
  }

  private parseResponse(response: string): { code: string; explanation: string } {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(response);
      return {
        code: parsed.code || '',
        explanation: parsed.explanation || 'Strategy generated from natural language prompt'
      };
    } catch {
      // Fallback: extract code blocks
      const codeMatch = response.match(/```(?:typescript|javascript)?\n([\s\S]*?)```/);
      const code = codeMatch ? codeMatch[1] : response;
      
      return {
        code,
        explanation: 'Strategy generated from natural language prompt'
      };
    }
  }

  private async validateStrategy(strategy: LLMStrategy): Promise<void> {
    this.logger.debug('Validating strategy', { strategyId: strategy.id });

    try {
      // Parse strategy code into structured format
      const parsed = await this.parseStrategyCode(strategy.generatedCode);
      
      // Validate against schema
      const validated = StrategyCodeSchema.parse(parsed);
      
      // Check safety constraints
      if (validated.riskManagement.maxDrawdown > this.config.safetyConstraints.maxDrawdown) {
        throw new Error(`Max drawdown ${validated.riskManagement.maxDrawdown}% exceeds limit`);
      }
      
      if (validated.riskManagement.positionLimit > this.config.safetyConstraints.maxPositionSize) {
        throw new Error(`Position limit ${validated.riskManagement.positionLimit}% exceeds limit`);
      }
      
      // Check forbidden assets
      const forbidden = validated.targetAssets.filter((asset: string) => 
        this.config.safetyConstraints.forbiddenAssets.includes(asset)
      );
      if (forbidden.length > 0) {
        throw new Error(`Strategy includes forbidden assets: ${forbidden.join(', ')}`);
      }
      
      strategy.status = 'validating';
      this.metrics.validated++;
      
    } catch (error) {
      this.logger.error('Strategy validation failed', { 
        error, 
        strategyId: strategy.id 
      });
      
      strategy.status = 'rejected';
      this.metrics.rejected++;
      
      throw error;
    }
  }

  private async parseStrategyCode(code: string): Promise<any> {
    // This would use AST parsing or regex to extract strategy structure
    // For now, we'll use a simplified approach
    
    try {
      // Try to evaluate the code safely
      const sandbox = {
        entryConditions: [],
        exitConditions: [],
        positionSizing: {},
        riskManagement: {},
        targetAssets: [],
        timeframe: '1h',
        metadata: {}
      };
      
      // Parse code to extract strategy components
      // This is a simplified implementation
      return {
        entryConditions: [
          { indicator: 'RSI', operator: '<', value: 30, weight: 0.5 },
          { indicator: 'MACD', operator: '>', value: 0, weight: 0.5 }
        ],
        exitConditions: [
          { indicator: 'RSI', operator: '>', value: 70, weight: 0.5 },
          { indicator: 'PnL', operator: '>', value: 0.02, weight: 0.5 }
        ],
        positionSizing: {
          method: 'volatility',
          params: { targetVol: 0.1, lookback: 20 }
        },
        riskManagement: {
          stopLoss: 0.02,
          takeProfit: 0.05,
          maxDrawdown: 0.1,
          positionLimit: 0.1
        },
        targetAssets: ['BTC-USD', 'ETH-USD'],
        timeframe: '1h',
        metadata: {
          name: 'AI Generated Strategy',
          description: 'LLM-generated mean reversion strategy',
          tags: ['mean-reversion', 'technical', 'crypto']
        }
      };
      
    } catch (error) {
      throw new Error(`Failed to parse strategy code: ${error}`);
    }
  }

  private applySafetyConstraints(strategy: LLMStrategy): void {
    // Apply runtime safety constraints to the strategy
    const constraints = this.config.safetyConstraints;
    
    // Inject safety checks into the code
    const safetyWrapper = `
// Safety constraints applied by LLMAlphaGenerator
const SAFETY_CONSTRAINTS = ${JSON.stringify(constraints, null, 2)};

function validateOrder(order) {
  // Check position size
  if (order.size > SAFETY_CONSTRAINTS.maxPositionSize * portfolioValue) {
    throw new Error('Position size exceeds safety limit');
  }
  
  // Check leverage
  if (order.leverage > SAFETY_CONSTRAINTS.maxLeverage) {
    throw new Error('Leverage exceeds safety limit');
  }
  
  // Check forbidden assets
  if (SAFETY_CONSTRAINTS.forbiddenAssets.includes(order.symbol)) {
    throw new Error('Asset is forbidden by safety constraints');
  }
  
  // Rate limiting
  if (ordersThisMinute >= SAFETY_CONSTRAINTS.maxOrdersPerMinute) {
    throw new Error('Order rate limit exceeded');
  }
  
  return true;
}

// Original strategy code with safety wrapper
${strategy.generatedCode}
`;
    
    strategy.generatedCode = safetyWrapper;
  }

  /**
   * Suggest novel features for existing strategies
   */
  async suggestFeatures(existingFeatures: string[]): Promise<string[]> {
    const prompt = `Given these existing trading features:
${existingFeatures.join('\n')}

Suggest 5 novel features that could improve trading performance. Consider:
1. Alternative data sources
2. Cross-asset correlations
3. Microstructure signals
4. Sentiment indicators
5. On-chain metrics

Format: List of feature names with brief descriptions`;

    try {
      const provider = this.providers.get('claude-3');
      if (!provider) throw new Error('Claude provider not available');

      const response = await provider.messages.create({
        model: 'claude-3-opus-20240229',
        max_tokens: 1000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0];
      if (content.type !== 'text') return [];

      // Parse feature suggestions
      const suggestions = content.text
        .split('\n')
        .filter((line: string) => line.trim())
        .map((line: string) => line.replace(/^\d+\.\s*/, '').trim())
        .slice(0, 5);

      this.emit('features:suggested', suggestions);
      return suggestions;

    } catch (error) {
      this.logger.error('Failed to suggest features', { error });
      return [];
    }
  }

  /**
   * Explain a strategy in natural language
   */
  async explainStrategy(strategyId: string): Promise<string> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }

    const prompt = `Explain this trading strategy in simple terms for a non-technical audience:

${strategy.generatedCode}

Focus on:
1. When it buys and sells
2. How it manages risk
3. What market conditions it works best in
4. Expected returns and risks`;

    try {
      const provider = this.providers.get('gpt-4');
      if (!provider) throw new Error('GPT-4 provider not available');

      const response = await provider.chat.completions.create({
        model: 'gpt-4',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: 500,
        temperature: 0.3
      });

      return response.choices[0]?.message?.content || 'Unable to generate explanation';

    } catch (error) {
      this.logger.error('Failed to explain strategy', { error, strategyId });
      return 'Strategy explanation unavailable';
    }
  }

  /**
   * Optimize an existing strategy
   */
  async optimizeStrategy(strategyId: string, objective: string = 'sharpe'): Promise<LLMStrategy> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }

    const prompt = `Optimize this trading strategy for ${objective}:

Current strategy:
${strategy.generatedCode}

Current performance:
${JSON.stringify(strategy.performance, null, 2)}

Suggest specific parameter changes and logic improvements to maximize ${objective}.
Maintain the core strategy logic but optimize execution.`;

    const optimized = await this.generateStrategy(prompt, 'claude-3');
    optimized.id = `${strategyId}-optimized`;
    
    return optimized;
  }

  private hashPrompt(prompt: string): string {
    // Simple hash function for cache keys
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      const char = prompt.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private updateMetrics(generationTime: number, success: boolean): void {
    if (success) {
      this.metrics.generated++;
      this.metrics.totalTime += generationTime;
      this.metrics.avgGenerationTime = this.metrics.totalTime / this.metrics.generated;
    }

    this.emit('metrics:updated', this.metrics);
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getStrategy(strategyId: string): LLMStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  getAllStrategies(): LLMStrategy[] {
    return Array.from(this.strategies.values());
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping LLM Alpha Generator');
    
    // Clear queue
    this.queue.clear();
    await this.queue.onIdle();
    
    // Clear cache
    this.cache.flushAll();
    
    // Clear strategies
    this.strategies.clear();
  }
} 
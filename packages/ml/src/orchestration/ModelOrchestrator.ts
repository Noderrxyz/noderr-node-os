/**
 * ModelOrchestrator - Central AI/ML Coordination System
 * 
 * Orchestrates all model expansion components including LLM, RL, evolution,
 * causal inference, and external signals for optimal trading decisions
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { LLMAlphaGenerator } from '../llm/LLMAlphaGenerator';
import { LLMFeatureSuggester } from '../llm/LLMFeatureSuggester';
import { RLLearningLoop } from '../rl/RLLearningLoop';
import { CausalFeatureSelector } from '../causal/CausalFeatureSelector';
import { EvolutionEngine } from '../evolution/EvolutionEngine';
import { NumeraiIntegration } from '../integration/NumeraiIntegration';
import { ModelValidator } from '../validation/ModelValidator';
import { 
  ModelExpansionConfig,
  OrchestrationState,
  TradingSignal,
  MarketState
} from '@noderr/types';

interface OrchestratorConfig {
  llmEnabled: boolean;
  rlEnabled: boolean;
  evolutionEnabled: boolean;
  causalEnabled: boolean;
  externalSignalsEnabled: boolean;
  validationRequired: boolean;
  ensembleWeights: {
    llm: number;
    rl: number;
    evolution: number;
    external: number;
  };
  updateFrequency: number;
  maxConcurrentModels: number;
}

export class ModelOrchestrator extends EventEmitter {
  private logger: Logger;
  private config: OrchestratorConfig;
  private state: OrchestrationState;
  
  // Components
  private llmAlpha?: LLMAlphaGenerator;
  private llmFeatures?: LLMFeatureSuggester;
  private rlLoop?: RLLearningLoop;
  private causalSelector?: CausalFeatureSelector;
  private evolutionEngine?: EvolutionEngine;
  private numeraiIntegration?: NumeraiIntegration;
  private validator?: ModelValidator;
  
  // Active models
  private activeModels: Map<string, any> = new Map();
  private modelPerformance: Map<string, number> = new Map();
  
  constructor(logger: Logger, config: OrchestratorConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.state = {
      isActive: false,
      activeComponents: [],
      currentSignals: [],
      lastUpdate: Date.now(),
      performance: {
        sharpe: 0,
        winRate: 0,
        totalTrades: 0
      }
    };
  }
  
  /**
   * Initialize all enabled components
   */
  async initialize(expansionConfig: ModelExpansionConfig): Promise<void> {
    this.logger.info('Initializing Model Orchestrator');
    
    try {
      // Initialize LLM components
      if (this.config.llmEnabled && expansionConfig.llm.enabled) {
        this.llmAlpha = new LLMAlphaGenerator(this.logger, {
          providers: expansionConfig.llm.providers,
          maxTokens: expansionConfig.llm.maxTokens,
          temperature: expansionConfig.llm.temperature,
          safetyConstraints: expansionConfig.llm.safetyConstraints,
          cacheTimeout: 3600
        });
        await this.llmAlpha.initialize();
        this.state.activeComponents.push('llm-alpha');
        
        this.llmFeatures = new LLMFeatureSuggester(this.logger, {
          providers: expansionConfig.llm.providers,
          maxSuggestions: 10,
          minConfidence: 0.7,
          cacheTimeout: 3600
        });
        await this.llmFeatures.initialize();
        this.state.activeComponents.push('llm-features');
      }
      
      // Initialize RL component
      if (this.config.rlEnabled && expansionConfig.rl.enabled) {
        this.rlLoop = new RLLearningLoop(this.logger, {
          algorithm: expansionConfig.rl.algorithm,
          learningRate: expansionConfig.rl.learningRate,
          discountFactor: expansionConfig.rl.discountFactor,
          explorationRate: expansionConfig.rl.explorationRate,
          batchSize: expansionConfig.rl.batchSize,
          memorySize: 10000,
          updateFrequency: 100,
          targetUpdateFrequency: 1000,
          maxEpisodeLength: 1000,
          riskAwareness: {
            enabled: true,
            maxDrawdown: 0.15,
            volatilityPenalty: 0.01,
            positionLimitPenalty: 0.05
          }
        });
        await this.rlLoop.initialize();
        this.state.activeComponents.push('rl');
      }
      
      // Initialize Evolution component
      if (this.config.evolutionEnabled && expansionConfig.evolution.enabled) {
        this.evolutionEngine = new EvolutionEngine(this.logger, {
          populationSize: expansionConfig.evolution.populationSize,
          mutationRate: expansionConfig.evolution.mutationRate,
          crossoverRate: expansionConfig.evolution.crossoverRate,
          eliteRatio: expansionConfig.evolution.eliteRatio,
          maxGenerations: expansionConfig.evolution.maxGenerations,
          targetFitness: 2.0,
          tournamentSize: 3,
          diversityBonus: 0.1
        });
        await this.evolutionEngine.initialize();
        this.state.activeComponents.push('evolution');
      }
      
      // Initialize Causal component
      if (this.config.causalEnabled && expansionConfig.causal.enabled) {
        this.causalSelector = new CausalFeatureSelector(this.logger, {
          method: expansionConfig.causal.method,
          confidenceLevel: expansionConfig.causal.confidenceLevel,
          lagOrder: expansionConfig.causal.lagOrder,
          maxConditioningSetSize: 3,
          bootstrapSamples: 100,
          significanceThreshold: 0.05
        });
        this.state.activeComponents.push('causal');
      }
      
      // Initialize external signals
      if (this.config.externalSignalsEnabled && expansionConfig.integration.numerai.enabled) {
        this.numeraiIntegration = new NumeraiIntegration(this.logger, {
          apiKey: expansionConfig.integration.numerai.apiKey,
          apiSecret: expansionConfig.integration.numerai.apiSecret,
          modelId: expansionConfig.integration.numerai.modelId,
          signalThreshold: 0.6,
          cacheTimeout: 3600,
          maxRetries: 3
        });
        await this.numeraiIntegration.initialize();
        this.state.activeComponents.push('numerai');
      }
      
      // Initialize validator
      if (this.config.validationRequired) {
        this.validator = new ModelValidator(this.logger, {
          minSharpe: expansionConfig.validation.minSharpe,
          maxDrawdown: expansionConfig.validation.maxDrawdown,
          minWinRate: expansionConfig.validation.minWinRate,
          minSampleSize: expansionConfig.validation.minSampleSize,
          confidenceLevel: expansionConfig.validation.confidenceLevel,
          backtestPeriods: 10,
          outOfSampleRatio: 0.3,
          riskLimits: {
            maxLeverage: 3,
            maxPositionSize: 0.2,
            maxCorrelation: 0.8
          }
        });
        this.state.activeComponents.push('validator');
      }
      
      this.state.isActive = true;
      this.logger.info('Model Orchestrator initialized', {
        activeComponents: this.state.activeComponents
      });
      
      // Start orchestration loop
      this.startOrchestration();
      
    } catch (error) {
      this.logger.error('Failed to initialize orchestrator', { error });
      throw error;
    }
  }
  
  /**
   * Generate trading signals from all active models
   */
  async generateSignals(marketState: MarketState): Promise<TradingSignal[]> {
    if (!this.state.isActive) {
      throw new Error('Orchestrator not active');
    }
    
    const allSignals: TradingSignal[] = [];
    const signalPromises: Promise<TradingSignal[]>[] = [];
    
    // LLM signals
    if (this.llmAlpha) {
      signalPromises.push(this.getLLMSignals(marketState));
    }
    
    // RL signals
    if (this.rlLoop) {
      signalPromises.push(this.getRLSignals(marketState));
    }
    
    // Evolution signals
    if (this.evolutionEngine) {
      signalPromises.push(this.getEvolutionSignals(marketState));
    }
    
    // External signals
    if (this.numeraiIntegration) {
      signalPromises.push(this.getExternalSignals(marketState));
    }
    
    // Wait for all signals
    const signalArrays = await Promise.all(signalPromises);
    for (const signals of signalArrays) {
      allSignals.push(...signals);
    }
    
    // Apply causal filtering if enabled
    let filteredSignals = allSignals;
    if (this.causalSelector) {
      filteredSignals = await this.applyCausalFiltering(allSignals, marketState);
    }
    
    // Ensemble signals
    const ensembledSignals = this.ensembleSignals(filteredSignals);
    
    // Validate if required
    if (this.validator && this.config.validationRequired) {
      const validatedSignals = await this.validateSignals(ensembledSignals);
      this.state.currentSignals = validatedSignals;
      return validatedSignals;
    }
    
    this.state.currentSignals = ensembledSignals;
    this.emit('signals:generated', ensembledSignals);
    
    return ensembledSignals;
  }
  
  /**
   * Get LLM-generated signals
   */
  private async getLLMSignals(marketState: MarketState): Promise<TradingSignal[]> {
    if (!this.llmAlpha) return [];
    
    try {
      // Generate strategy from market context
      const prompt = this.buildLLMPrompt(marketState);
      const strategy = await this.llmAlpha.generateStrategy(prompt);
      
      // Convert to signals
      const signals: TradingSignal[] = [];
      
      if (strategy.entryConditions.length > 0) {
        signals.push({
          source: 'llm',
          symbol: strategy.targetAssets[0] || 'BTC-USD',
          action: 'buy',
          confidence: strategy.confidence,
          reasoning: strategy.description,
          timestamp: Date.now(),
          metadata: {
            strategy: strategy.id,
            model: 'llm-alpha'
          }
        });
      }
      
      return signals;
      
    } catch (error) {
      this.logger.error('Failed to get LLM signals', { error });
      return [];
    }
  }
  
  /**
   * Get RL-generated signals
   */
  private async getRLSignals(marketState: MarketState): Promise<TradingSignal[]> {
    if (!this.rlLoop) return [];
    
    try {
      const action = await this.rlLoop.trainOnline(marketState);
      
      if (action.type === 'hold') return [];
      
      return [{
        source: 'rl',
        symbol: action.symbol,
        action: action.type as 'buy' | 'sell',
        confidence: action.confidence,
        reasoning: action.reasoning,
        timestamp: Date.now(),
        metadata: {
          algorithm: 'PPO',
          model: 'rl-loop'
        }
      }];
      
    } catch (error) {
      this.logger.error('Failed to get RL signals', { error });
      return [];
    }
  }
  
  /**
   * Get evolution-generated signals
   */
  private async getEvolutionSignals(marketState: MarketState): Promise<TradingSignal[]> {
    if (!this.evolutionEngine) return [];
    
    try {
      // Get best evolved strategies
      const eliteStrategies = await this.evolutionEngine.deployElite(3);
      const signals: TradingSignal[] = [];
      
      for (const genome of eliteStrategies) {
        // Execute strategy logic
        const strategyCode = genome.toStrategyCode();
        // In production, would safely execute the code
        
        signals.push({
          source: 'evolution',
          symbol: 'BTC-USD', // Would be determined by strategy
          action: 'buy', // Would be determined by strategy
          confidence: genome.fitness || 0.5,
          reasoning: `Evolved strategy gen ${genome.generation}`,
          timestamp: Date.now(),
          metadata: {
            genomeId: genome.id,
            generation: genome.generation,
            fitness: genome.fitness
          }
        });
      }
      
      return signals;
      
    } catch (error) {
      this.logger.error('Failed to get evolution signals', { error });
      return [];
    }
  }
  
  /**
   * Get external signals
   */
  private async getExternalSignals(marketState: MarketState): Promise<TradingSignal[]> {
    if (!this.numeraiIntegration) return [];
    
    try {
      const symbols = Object.keys(marketState.prices);
      const externalSignals = await this.numeraiIntegration.getSignals(symbols);
      
      return externalSignals.map(signal => ({
        source: 'external',
        symbol: signal.symbol,
        action: signal.signal as 'buy' | 'sell',
        confidence: signal.confidence,
        reasoning: `Numerai signal strength ${signal.strength.toFixed(3)}`,
        timestamp: signal.timestamp,
        metadata: signal.metadata
      }));
      
    } catch (error) {
      this.logger.error('Failed to get external signals', { error });
      return [];
    }
  }
  
  /**
   * Apply causal filtering to signals
   */
  private async applyCausalFiltering(
    signals: TradingSignal[],
    marketState: MarketState
  ): Promise<TradingSignal[]> {
    if (!this.causalSelector) return signals;
    
    // Get non-spurious features
    const validFeatures = this.causalSelector.getNonSpuriousFeatures();
    
    // Filter signals based on causal relationships
    return signals.filter(signal => {
      // Check if signal is based on valid causal features
      // Simplified - would check actual feature usage in production
      return signal.confidence > 0.7 || validFeatures.length > 0;
    });
  }
  
  /**
   * Ensemble multiple signals
   */
  private ensembleSignals(signals: TradingSignal[]): TradingSignal[] {
    // Group signals by symbol and action
    const grouped = new Map<string, TradingSignal[]>();
    
    for (const signal of signals) {
      const key = `${signal.symbol}:${signal.action}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(signal);
    }
    
    // Ensemble each group
    const ensembled: TradingSignal[] = [];
    
    for (const [key, group] of grouped) {
      const [symbol, action] = key.split(':');
      
      // Calculate weighted confidence
      let totalWeight = 0;
      let weightedConfidence = 0;
      
      for (const signal of group) {
        const weight = this.getSourceWeight(signal.source);
        totalWeight += weight;
        weightedConfidence += signal.confidence * weight;
      }
      
      const ensembleConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;
      
      // Only include high-confidence ensemble signals
      if (ensembleConfidence > 0.6) {
        ensembled.push({
          source: 'ensemble',
          symbol,
          action: action as 'buy' | 'sell',
          confidence: ensembleConfidence,
          reasoning: `Ensemble of ${group.length} signals`,
          timestamp: Date.now(),
          metadata: {
            sources: group.map(s => s.source),
            signalCount: group.length
          }
        });
      }
    }
    
    return ensembled;
  }
  
  /**
   * Get weight for signal source
   */
  private getSourceWeight(source: string): number {
    switch (source) {
      case 'llm':
        return this.config.ensembleWeights.llm;
      case 'rl':
        return this.config.ensembleWeights.rl;
      case 'evolution':
        return this.config.ensembleWeights.evolution;
      case 'external':
        return this.config.ensembleWeights.external;
      default:
        return 0.25;
    }
  }
  
  /**
   * Validate signals before execution
   */
  private async validateSignals(signals: TradingSignal[]): Promise<TradingSignal[]> {
    if (!this.validator) return signals;
    
    const validated: TradingSignal[] = [];
    
    for (const signal of signals) {
      // Quick validation checks
      if (signal.confidence < 0.5) continue;
      
      // Would run full validation in production
      validated.push(signal);
    }
    
    return validated;
  }
  
  /**
   * Build LLM prompt from market state
   */
  private buildLLMPrompt(marketState: MarketState): string {
    const topMovers = Object.entries(marketState.prices)
      .map(([symbol, price]) => ({ symbol, price }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 5);
    
    return `
      Market Analysis Request:
      
      Current market conditions:
      - Top assets: ${topMovers.map(m => `${m.symbol}: $${m.price}`).join(', ')}
      - Account balance: $${marketState.accountBalance}
      - Open positions: ${marketState.positions.length}
      
      Generate a trading strategy that:
      1. Identifies opportunities in current market
      2. Manages risk appropriately
      3. Uses technical indicators effectively
      
      Focus on high-probability setups with clear entry/exit rules.
    `;
  }
  
  /**
   * Start orchestration loop
   */
  private startOrchestration(): void {
    setInterval(async () => {
      try {
        // Update model performance
        await this.updateModelPerformance();
        
        // Rebalance ensemble weights if needed
        this.rebalanceWeights();
        
        // Emit status update
        this.emit('orchestration:update', {
          state: this.state,
          performance: this.getPerformanceMetrics()
        });
        
      } catch (error) {
        this.logger.error('Orchestration update failed', { error });
      }
    }, this.config.updateFrequency);
  }
  
  /**
   * Update model performance metrics
   */
  private async updateModelPerformance(): Promise<void> {
    // Track performance of each model
    // Simplified - would track actual trading performance in production
    
    if (this.rlLoop) {
      const rlPerf = this.rlLoop.getPerformance();
      if (rlPerf) {
        this.modelPerformance.set('rl', rlPerf.sharpeRatio);
      }
    }
    
    if (this.evolutionEngine) {
      const evoStats = this.evolutionEngine.getPopulationStats();
      this.modelPerformance.set('evolution', evoStats.fitness.best);
    }
  }
  
  /**
   * Rebalance ensemble weights based on performance
   */
  private rebalanceWeights(): void {
    const performances = Array.from(this.modelPerformance.entries());
    if (performances.length === 0) return;
    
    // Calculate total performance
    const totalPerf = performances.reduce((sum, [_, perf]) => sum + Math.max(0, perf), 0);
    if (totalPerf === 0) return;
    
    // Update weights proportionally
    for (const [model, perf] of performances) {
      const weight = Math.max(0, perf) / totalPerf;
      
      switch (model) {
        case 'llm':
          this.config.ensembleWeights.llm = weight;
          break;
        case 'rl':
          this.config.ensembleWeights.rl = weight;
          break;
        case 'evolution':
          this.config.ensembleWeights.evolution = weight;
          break;
      }
    }
    
    // Normalize weights
    const totalWeight = Object.values(this.config.ensembleWeights).reduce((a, b) => a + b, 0);
    if (totalWeight > 0) {
      for (const key of Object.keys(this.config.ensembleWeights)) {
        this.config.ensembleWeights[key as keyof typeof this.config.ensembleWeights] /= totalWeight;
      }
    }
  }
  
  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      activeModels: this.state.activeComponents.length,
      totalSignals: this.state.currentSignals.length,
      modelPerformance: Object.fromEntries(this.modelPerformance),
      ensembleWeights: this.config.ensembleWeights,
      lastUpdate: this.state.lastUpdate
    };
  }
  
  /**
   * Stop orchestrator
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Model Orchestrator');
    
    this.state.isActive = false;
    
    // Stop all components
    const stopPromises: Promise<void>[] = [];
    
    if (this.rlLoop) stopPromises.push(this.rlLoop.stop());
    if (this.evolutionEngine) this.evolutionEngine.stop();
    if (this.numeraiIntegration) stopPromises.push(this.numeraiIntegration.stop());
    
    await Promise.all(stopPromises);
    
    this.logger.info('Model Orchestrator stopped');
  }
} 
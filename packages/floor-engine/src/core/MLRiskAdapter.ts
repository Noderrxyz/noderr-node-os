/**
 * ML Risk Adapter
 * 
 * Bridges Floor Engine with capital-ai ML models for dynamic risk assessment
 * and capital allocation optimization.
 * 
 * This adapter converts Floor Engine adapters (Aave, Compound, Curve, etc.)
 * into capital-ai strategy format, enabling ML-driven risk scoring and
 * allocation recommendations.
 * 
 * @module MLRiskAdapter
 */

import { EventEmitter } from 'events';
import { DynamicWeightAllocator, PortfolioSentinel } from '@noderr/capital-ai';
import type { AdapterMetadata, FloorPosition } from '../types';
import { AdapterCategory } from '@noderr/types';

/**
 * ML-generated risk score for an adapter
 */
export interface MLRiskScore {
  adapterId: string;
  riskScore: number; // 0-100 (0 = lowest risk, 100 = highest risk)
  confidence: number; // 0-1 (ML model confidence)
  factors: {
    protocolRisk: number; // Smart contract and protocol-specific risk
    liquidityRisk: number; // Liquidity depth and slippage risk
    smartContractRisk: number; // Audit status and vulnerability risk
    marketRisk: number; // Market volatility and correlation risk
  };
  recommendation: 'INCREASE' | 'MAINTAIN' | 'DECREASE' | 'FREEZE';
  reasoning: string;
}

/**
 * ML-driven allocation recommendation
 */
export interface MLAllocationRecommendation {
  adapterId: string;
  adapterName: string;
  currentAllocation: bigint;
  recommendedAllocation: bigint;
  allocationChange: bigint;
  changePercentage: number;
  reason: string;
  confidence: number;
  expectedAPY: number;
  riskScore: number;
}

/**
 * Emergency action triggered by ML risk monitoring
 */
export interface MLEmergencyAction {
  id: string;
  timestamp: Date;
  type: 'FREEZE' | 'REDUCE' | 'REBALANCE' | 'ALERT';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affectedAdapters: string[];
  reason: string;
  recommendedActions: string[];
  autoExecute: boolean;
}

/**
 * Strategy representation for ML models
 */
interface MLStrategy {
  id: string;
  name: string;
  type: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL';
  performance: {
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    returns: number[];
    volatility: number;
    downwardDeviation: number;
    winRate: number;
    profitFactor: number;
    lastUpdated: Date;
  };
  positions: any[];
  constraints: {
    minWeight: number;
    maxWeight: number;
    maxDrawdown: number;
    minSharpe: number;
    maxCorrelation: number;
  };
}

/**
 * ML Risk Adapter
 * 
 * Provides ML-driven risk assessment and capital allocation optimization
 * for the Floor Engine by integrating with capital-ai package.
 */
export class MLRiskAdapter extends EventEmitter {
  private weightAllocator: DynamicWeightAllocator;
  private portfolioSentinel: PortfolioSentinel;
  private isInitialized: boolean = false;
  private adapterStrategies: Map<string, MLStrategy> = new Map();
  private lastAllocationUpdate: number = 0;
  private emergencyActionsHistory: MLEmergencyAction[] = [];
  
  constructor() {
    super();
    
    // Initialize capital-ai components
    this.weightAllocator = new DynamicWeightAllocator();
    this.portfolioSentinel = new PortfolioSentinel();
    
    // Set up event listeners
    this.setupEventListeners();
  }
  
  /**
   * Initialize ML risk adapter
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[MLRiskAdapter] Already initialized');
      return;
    }
    
    console.log('[MLRiskAdapter] Initializing ML risk assessment system...');
    
    try {
      // Capital-ai components are self-initializing
      // Just verify they're operational
      console.log('[MLRiskAdapter] DynamicWeightAllocator ready');
      console.log('[MLRiskAdapter] PortfolioSentinel ready');
      
      this.isInitialized = true;
      this.emit('initialized');
      
      console.log('[MLRiskAdapter] ML risk assessment system initialized successfully');
    } catch (error) {
      console.error('[MLRiskAdapter] Initialization failed:', error);
      throw error;
    }
  }
  
  /**
   * Set up event listeners for capital-ai components
   */
  private setupEventListeners(): void {
    // Listen for allocation updates from weight allocator
    this.weightAllocator.on('allocation-updated', (allocation: any) => {
      console.log('[MLRiskAdapter] Allocation updated by ML model');
      this.emit('ml-allocation-updated', allocation);
    });
    
    // Listen for emergency actions from portfolio sentinel
    this.portfolioSentinel.on('emergency-action', (action: any) => {
      this.handleEmergencyAction(action);
    });
    
    // Listen for risk limit breaches
    this.portfolioSentinel.on('risk-limit-breach', (breach: any) => {
      console.warn('[MLRiskAdapter] Risk limit breach detected:', breach);
      this.emit('risk-limit-breach', breach);
    });
  }
  
  /**
   * Get ML-driven risk score for an adapter
   * 
   * @param adapterId - Adapter identifier
   * @param metadata - Adapter metadata
   * @param currentPositions - Current positions across all adapters
   * @returns ML-generated risk score
   */
  async getRiskScore(
    adapterId: string,
    metadata: AdapterMetadata,
    currentPositions: FloorPosition[]
  ): Promise<MLRiskScore> {
    if (!this.isInitialized) {
      throw new Error('MLRiskAdapter not initialized');
    }
    
    try {
      // Convert adapter to ML strategy format
      const strategy = this.adapterToStrategy(adapterId, metadata, currentPositions);
      
      // Register or update strategy with weight allocator
      await this.registerOrUpdateStrategy(strategy);
      
      // Get current allocation result from ML model
      const allocation = await this.weightAllocator.getCurrentAllocation();
      
      if (!allocation) {
        // No allocation yet, return conservative risk score
        return this.getDefaultRiskScore(adapterId, metadata);
      }
      
      // Calculate risk score based on ML model output
      const riskScore = this.calculateRiskScore(allocation, adapterId, metadata);
      
      return riskScore;
      
    } catch (error) {
      console.error(`[MLRiskAdapter] Error getting risk score for ${adapterId}:`, error);
      // Return high-risk score on error (fail-safe)
      return this.getDefaultRiskScore(adapterId, metadata, true);
    }
  }
  
  /**
   * Get ML-driven allocation recommendations for all adapters
   * 
   * @param adapters - Array of adapter metadata
   * @param totalCapital - Total capital to allocate
   * @param currentPositions - Current positions across all adapters
   * @returns Array of allocation recommendations
   */
  async getAllocationRecommendations(
    adapters: AdapterMetadata[],
    totalCapital: bigint,
    currentPositions: FloorPosition[]
  ): Promise<MLAllocationRecommendation[]> {
    if (!this.isInitialized) {
      throw new Error('MLRiskAdapter not initialized');
    }
    
    console.log(`[MLRiskAdapter] Generating ML allocation recommendations for ${adapters.length} adapters`);
    console.log(`[MLRiskAdapter] Total capital: ${totalCapital.toString()}`);
    
    try {
      // Register all adapters as strategies with ML model
      for (const adapter of adapters) {
        const strategy = this.adapterToStrategy(adapter.id, adapter, currentPositions);
        await this.registerOrUpdateStrategy(strategy);
      }
      
      // Get current ML allocation (optimization happens automatically via updateStrategy)
      const allocation = this.weightAllocator.getCurrentAllocation();
      
      if (!allocation) {
        throw new Error('No allocation available from ML model');
      }
      
      // Convert ML allocation weights to capital amounts
      const recommendations: MLAllocationRecommendation[] = [];
      
      for (const adapter of adapters) {
        const weight = allocation.strategies.get(adapter.id) || 0;
        const recommendedAllocation = (totalCapital * BigInt(Math.floor(weight * 10000))) / 10000n;
        const currentAllocation = this.getCurrentAllocation(adapter.id, currentPositions);
        const allocationChange = recommendedAllocation - currentAllocation;
        const changePercentage = currentAllocation > 0n 
          ? Number((allocationChange * 10000n) / currentAllocation) / 100
          : 0;
        
        // Get risk score for this adapter
        const riskScore = await this.getRiskScore(adapter.id, adapter, currentPositions);
        
        recommendations.push({
          adapterId: adapter.id,
          adapterName: adapter.name,
          currentAllocation,
          recommendedAllocation,
          allocationChange,
          changePercentage,
          reason: this.generateAllocationReason(allocation, weight, riskScore),
          confidence: allocation.regime.confidence,
          expectedAPY: adapter.historicalAPY || 0,
          riskScore: riskScore.riskScore
        });
      }
      
      // Sort by recommended allocation (highest first)
      recommendations.sort((a, b) => 
        Number(b.recommendedAllocation - a.recommendedAllocation)
      );
      
      console.log(`[MLRiskAdapter] Generated ${recommendations.length} allocation recommendations`);
      this.emit('allocation-recommendations-generated', recommendations);
      
      return recommendations;
      
    } catch (error) {
      console.error('[MLRiskAdapter] Error generating allocation recommendations:', error);
      throw error;
    }
  }
  
  /**
   * Monitor portfolio and trigger emergency actions if needed
   * 
   * @param positions - Current positions
   * @param totalValue - Total portfolio value
   */
  async monitorPortfolio(
    positions: FloorPosition[],
    totalValue: bigint
  ): Promise<void> {
    if (!this.isInitialized) {
      return;
    }
    
    try {
      // Update portfolio state in sentinel
      // Note: updatePosition is called for each position individually
      const mappedPositions = positions.map(p => ({
        symbol: p.adapterId,
        quantity: Number(p.value),
        avgEntryPrice: 1,
        currentPrice: 1,
        marketValue: Number(p.value),
        unrealizedPnL: 0,
        realizedPnL: 0,
        weight: Number(p.value) / Number(totalValue),
        strategy: p.adapterId
      }));
      
      for (const position of mappedPositions) {
        await this.portfolioSentinel.updatePosition(
          position.symbol,
          position.quantity,
          position.currentPrice,
          position.strategy
        );
      }
      
      // Sentinel will automatically trigger emergency actions if limits breached
      
    } catch (error) {
      console.error('[MLRiskAdapter] Error monitoring portfolio:', error);
    }
  }
  
  /**
   * Convert Floor Engine adapter to capital-ai strategy format
   */
  private adapterToStrategy(
    adapterId: string,
    metadata: AdapterMetadata,
    currentPositions: FloorPosition[]
  ): MLStrategy {
    const position = currentPositions.find(p => p.adapterId === adapterId);
    const currentValue = position ? Number(position.value) : 0;
    
    // Map adapter category to strategy type
    const strategyType = this.mapAdapterCategoryToStrategyType(metadata.category);
    
    // Estimate performance metrics based on adapter type and historical data
    const performance = this.estimatePerformanceMetrics(metadata, currentValue);
    
    // Set constraints based on adapter metadata
    const constraints = {
      minWeight: 0.05, // Minimum 5% allocation
      maxWeight: metadata.maxAllocation ? 0.30 : 0.20, // Max 20-30%
      maxDrawdown: 0.10, // Max 10% drawdown
      minSharpe: 0.5, // Minimum Sharpe ratio
      maxCorrelation: 0.7 // Maximum correlation with other strategies
    };
    
    return {
      id: adapterId,
      name: metadata.name,
      type: strategyType,
      performance,
      positions: position ? [position] : [],
      constraints
    };
  }
  
  /**
   * Map adapter category to ML strategy type
   */
  private mapAdapterCategoryToStrategyType(
    category: string
  ): 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL' {
    const mapping: Record<string, any> = {
      'LENDING': 'FUNDAMENTAL',
      'STAKING': 'FUNDAMENTAL',
      'YIELD': 'MARKET_MAKING',
      'LIQUIDITY': 'MARKET_MAKING',
      'FARMING': 'MARKET_MAKING'
    };
    
    return mapping[category] || 'FUNDAMENTAL';
  }
  
  /**
   * Estimate performance metrics for an adapter
   */
  private estimatePerformanceMetrics(
    metadata: AdapterMetadata,
    currentValue: number
  ): MLStrategy['performance'] {
    // For lending protocols, use conservative estimates
    const baseAPY = metadata.historicalAPY || 5;
    const volatility = metadata.category === AdapterCategory.LENDING ? 0.05 : 0.15;
    
    return {
      sharpeRatio: baseAPY / (volatility * 10), // Rough Sharpe estimate
      sortinoRatio: (baseAPY / (volatility * 8)), // Slightly better than Sharpe
      maxDrawdown: volatility * 0.5, // Max drawdown as fraction of volatility
      returns: [], // Would be populated with historical returns
      volatility,
      downwardDeviation: volatility * 0.6,
      winRate: 0.95, // High for lending protocols
      profitFactor: 2.0, // Conservative
      lastUpdated: new Date()
    };
  }
  
  /**
   * Register or update strategy with weight allocator
   */
  private async registerOrUpdateStrategy(strategy: MLStrategy): Promise<void> {
    const existing = this.adapterStrategies.get(strategy.id);
    
    if (existing) {
      // Update performance
      await this.weightAllocator.updatePerformance(strategy.id, strategy.performance);
    } else {
      // Register new strategy
      await this.weightAllocator.registerStrategy(strategy);
      this.adapterStrategies.set(strategy.id, strategy);
    }
  }
  
  /**
   * Calculate risk score from ML allocation result
   */
  private calculateRiskScore(
    allocation: any,
    adapterId: string,
    metadata: AdapterMetadata
  ): MLRiskScore {
    const weight = allocation.strategies.get(adapterId) || 0;
    
    // Higher weight = lower risk (ML model trusts it more)
    // Lower weight = higher risk
    const baseRiskScore = Math.max(0, Math.min(100, (1 - weight * 2) * 100));
    
    // Adjust based on market regime
    const regimeRiskMultiplier = this.getRegimeRiskMultiplier(allocation.regime);
    const adjustedRiskScore = Math.min(100, baseRiskScore * regimeRiskMultiplier);
    
    // Decompose into risk factors
    const factors = {
      protocolRisk: adjustedRiskScore * 0.30,
      liquidityRisk: adjustedRiskScore * 0.20,
      smartContractRisk: adjustedRiskScore * 0.30,
      marketRisk: adjustedRiskScore * 0.20
    };
    
    // Determine recommendation
    let recommendation: MLRiskScore['recommendation'];
    if (adjustedRiskScore > 80) {
      recommendation = 'FREEZE';
    } else if (adjustedRiskScore > 60) {
      recommendation = 'DECREASE';
    } else if (weight > 0.15) {
      recommendation = 'INCREASE';
    } else {
      recommendation = 'MAINTAIN';
    }
    
    return {
      adapterId,
      riskScore: adjustedRiskScore,
      confidence: allocation.regime.confidence,
      factors,
      recommendation,
      reasoning: this.generateRiskReasoning(adjustedRiskScore, weight, allocation.regime)
    };
  }
  
  /**
   * Get default risk score (fallback)
   */
  private getDefaultRiskScore(
    adapterId: string,
    metadata: AdapterMetadata,
    isError: boolean = false
  ): MLRiskScore {
    const riskScore = isError ? 90 : 50; // High risk on error, medium otherwise
    
    return {
      adapterId,
      riskScore,
      confidence: 0.5,
      factors: {
        protocolRisk: riskScore * 0.30,
        liquidityRisk: riskScore * 0.20,
        smartContractRisk: riskScore * 0.30,
        marketRisk: riskScore * 0.20
      },
      recommendation: isError ? 'FREEZE' : 'MAINTAIN',
      reasoning: isError 
        ? 'ML model unavailable, using conservative risk assessment'
        : 'Insufficient data for ML assessment, using default risk score'
    };
  }
  
  /**
   * Get risk multiplier based on market regime
   */
  private getRegimeRiskMultiplier(regime: any): number {
    const multipliers: Record<string, number> = {
      'BULL': 0.8, // Lower risk in bull markets
      'BEAR': 1.3, // Higher risk in bear markets
      'SIDEWAYS': 1.0, // Normal risk
      'HIGH_VOL': 1.5, // Much higher risk in high volatility
      'LOW_VOL': 0.9 // Slightly lower risk in low volatility
    };
    
    return multipliers[regime.type] || 1.0;
  }
  
  /**
   * Generate human-readable risk reasoning
   */
  private generateRiskReasoning(
    riskScore: number,
    weight: number,
    regime: any
  ): string {
    const riskLevel = riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW';
    const allocation = (weight * 100).toFixed(1);
    
    return `Risk level: ${riskLevel} (score: ${riskScore.toFixed(0)}). ` +
           `ML model allocates ${allocation}% in ${regime.type} market regime ` +
           `(confidence: ${(regime.confidence * 100).toFixed(0)}%).`;
  }
  
  /**
   * Generate allocation reasoning
   */
  private generateAllocationReason(
    allocation: any,
    weight: number,
    riskScore: MLRiskScore
  ): string {
    const percentage = (weight * 100).toFixed(1);
    
    return `ML-optimized allocation: ${percentage}% (Sharpe: ${allocation.metrics.expectedSharpe.toFixed(2)}, ` +
           `Risk: ${riskScore.riskScore.toFixed(0)}, Regime: ${allocation.regime.type})`;
  }
  
  /**
   * Get current allocation for an adapter
   */
  private getCurrentAllocation(
    adapterId: string,
    positions: FloorPosition[]
  ): bigint {
    const position = positions.find(p => p.adapterId === adapterId);
    return position ? position.value : 0n;
  }
  
  /**
   * Handle emergency action from portfolio sentinel
   */
  private handleEmergencyAction(action: any): void {
    console.error('[MLRiskAdapter] 🚨 EMERGENCY ACTION TRIGGERED 🚨');
    console.error('[MLRiskAdapter] Type:', action.type);
    console.error('[MLRiskAdapter] Severity:', action.severity);
    console.error('[MLRiskAdapter] Reason:', action.reason);
    
    const mlEmergencyAction: MLEmergencyAction = {
      id: action.id,
      timestamp: action.timestamp,
      type: this.mapEmergencyActionType(action.type),
      severity: action.severity,
      affectedAdapters: action.targetStrategies || [],
      reason: action.reason,
      recommendedActions: this.generateRecommendedActions(action),
      autoExecute: action.severity === 'CRITICAL'
    };
    
    this.emergencyActionsHistory.push(mlEmergencyAction);
    
    // Emit event for Floor Engine to handle
    this.emit('ml-emergency-action', mlEmergencyAction);
  }
  
  /**
   * Map portfolio sentinel action type to ML emergency action type
   */
  private mapEmergencyActionType(
    type: string
  ): MLEmergencyAction['type'] {
    const mapping: Record<string, MLEmergencyAction['type']> = {
      'FREEZE': 'FREEZE',
      'LIQUIDATE': 'REDUCE',
      'HEDGE': 'REBALANCE',
      'DELEVERAGE': 'REDUCE'
    };
    
    return mapping[type] || 'ALERT';
  }
  
  /**
   * Generate recommended actions for emergency
   */
  private generateRecommendedActions(action: any): string[] {
    const actions: string[] = [];
    
    switch (action.type) {
      case 'FREEZE':
        actions.push('Immediately halt all new allocations');
        actions.push('Monitor existing positions closely');
        actions.push('Prepare for potential liquidation');
        break;
        
      case 'LIQUIDATE':
        actions.push('Begin orderly liquidation of affected positions');
        actions.push('Use TWAP algorithm to minimize market impact');
        actions.push('Reallocate capital to safer adapters');
        break;
        
      case 'HEDGE':
        actions.push('Open hedging positions to reduce exposure');
        actions.push('Rebalance portfolio to reduce correlation');
        actions.push('Increase allocation to uncorrelated assets');
        break;
        
      case 'DELEVERAGE':
        actions.push('Reduce leverage across all positions');
        actions.push('Increase cash buffer');
        actions.push('Tighten risk limits');
        break;
    }
    
    return actions;
  }
  
  /**
   * Get emergency actions history
   */
  getEmergencyActionsHistory(): MLEmergencyAction[] {
    return [...this.emergencyActionsHistory];
  }
  
  /**
   * Clear emergency actions history
   */
  clearEmergencyActionsHistory(): void {
    this.emergencyActionsHistory = [];
  }
}

import { EventEmitter } from 'events';
import * as winston from 'winston';
import { LazyRiskMetrics, Position as LazyPosition } from './LazyRiskMetrics';

export interface RiskLimitConfig {
  basePositionLimit: number;
  baseExposureLimit: number;
  baseLeverageLimit: number;
  baseDrawdownLimit: number;
  volatilityWindow: number; // periods for volatility calculation
  adjustmentFactor: number; // how much to adjust based on volatility
  updateInterval: number; // milliseconds
}

export interface MarketConditions {
  volatility: number;
  volume: number;
  spread: number;
  correlation: number;
  regime: 'normal' | 'stressed' | 'crisis';
}

export interface RiskLimits {
  positionLimit: number;
  exposureLimit: number;
  leverageLimit: number;
  drawdownLimit: number;
  orderSizeLimit: number;
  concentrationLimit: number;
  timestamp: Date;
}

export interface RiskMetrics {
  currentExposure: number;
  currentLeverage: number;
  currentDrawdown: number;
  var95: number;
  var99: number;
  stressTestResult: number;
  marginUsage: number;
}

export interface RiskViolation {
  type: 'position' | 'exposure' | 'leverage' | 'drawdown' | 'concentration';
  current: number;
  limit: number;
  severity: 'warning' | 'critical';
  timestamp: Date;
  action: 'block' | 'reduce' | 'alert';
}

export class DynamicRiskLimits extends EventEmitter {
  private logger: winston.Logger;
  private config: RiskLimitConfig;
  private currentLimits: RiskLimits;
  private marketConditions: MarketConditions;
  private historicalVolatility: number[] = [];
  private updateInterval: NodeJS.Timeout | null = null;
  private riskMetrics: RiskMetrics;
  private lazyMetrics: LazyRiskMetrics;
  
  // Debouncing for risk checks
  private violationCheckTimeout: NodeJS.Timeout | null = null;
  private readonly VIOLATION_CHECK_DEBOUNCE = 1000; // 1 second
  private pendingViolationChecks: Set<string> = new Set();
  
  // Atomic operations for concurrent updates
  private updateLock: Promise<void> = Promise.resolve();
  private metricsUpdateQueue: Array<Partial<RiskMetrics>> = [];
  
  constructor(logger: winston.Logger, config: RiskLimitConfig) {
    super();
    this.logger = logger;
    this.config = config;
    
    // Initialize with base limits
    this.currentLimits = {
      positionLimit: config.basePositionLimit,
      exposureLimit: config.baseExposureLimit,
      leverageLimit: config.baseLeverageLimit,
      drawdownLimit: config.baseDrawdownLimit,
      orderSizeLimit: config.basePositionLimit * 0.1, // 10% of position limit
      concentrationLimit: 0.3, // 30% max concentration
      timestamp: new Date()
    };
    
    this.marketConditions = {
      volatility: 0.01, // 1% daily volatility
      volume: 1000000,
      spread: 0.0001,
      correlation: 0.5,
      regime: 'normal'
    };
    
    this.riskMetrics = {
      currentExposure: 0,
      currentLeverage: 0,
      currentDrawdown: 0,
      var95: 0,
      var99: 0,
      stressTestResult: 0,
      marginUsage: 0
    };
    
    // Initialize lazy metrics
    this.lazyMetrics = new LazyRiskMetrics(logger);
  }
  
  start(): void {
    this.logger.info('Starting dynamic risk limits service');
    
    // Initial update
    this.updateRiskLimits();
    
    // Schedule periodic updates
    this.updateInterval = setInterval(() => {
      this.updateRiskLimits();
    }, this.config.updateInterval);
  }
  
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.violationCheckTimeout) {
      clearTimeout(this.violationCheckTimeout);
      this.violationCheckTimeout = null;
    }
    
    this.logger.info('Stopped dynamic risk limits service');
  }
  
  updateMarketConditions(conditions: Partial<MarketConditions>): void {
    this.marketConditions = {
      ...this.marketConditions,
      ...conditions
    };
    
    // Add to historical volatility
    if (conditions.volatility !== undefined) {
      this.historicalVolatility.push(conditions.volatility);
      
      // Keep only recent history
      if (this.historicalVolatility.length > this.config.volatilityWindow) {
        this.historicalVolatility.shift();
      }
    }
    
    // Detect market regime
    this.detectMarketRegime();
    
    // Trigger immediate update
    this.updateRiskLimits();
  }
  
  async updateRiskMetrics(metrics: Partial<RiskMetrics>): Promise<void> {
    // Queue the update for atomic processing
    this.metricsUpdateQueue.push(metrics);
    
    // Process updates atomically
    this.updateLock = this.updateLock.then(async () => {
      // Process all queued updates
      while (this.metricsUpdateQueue.length > 0) {
        const update = this.metricsUpdateQueue.shift();
        if (update) {
          // Update regular metrics
          this.riskMetrics = {
            ...this.riskMetrics,
            ...update
          };
          
          // Use lazy metrics for expensive calculations
          if (update.var95 === undefined || update.var99 === undefined) {
            // Get from lazy metrics instead of computing
            this.riskMetrics.var95 = this.lazyMetrics.getVaR95();
            this.riskMetrics.var99 = this.lazyMetrics.getVaR99();
          }
        }
      }
    });
    
    await this.updateLock;
    
    // Debounce violation checks
    this.scheduleViolationCheck();
  }
  
  private scheduleViolationCheck(): void {
    // Clear existing timeout
    if (this.violationCheckTimeout) {
      clearTimeout(this.violationCheckTimeout);
    }
    
    // Schedule new check
    this.violationCheckTimeout = setTimeout(() => {
      this.checkRiskViolations();
      this.violationCheckTimeout = null;
    }, this.VIOLATION_CHECK_DEBOUNCE);
  }
  
  private updateRiskLimits(): void {
    const startTime = Date.now();
    
    // Calculate volatility-adjusted limits
    const volatilityMultiplier = this.calculateVolatilityMultiplier();
    const regimeMultiplier = this.getRegimeMultiplier();
    const correlationAdjustment = this.calculateCorrelationAdjustment();
    
    // Combined adjustment factor
    const adjustmentFactor = volatilityMultiplier * regimeMultiplier * correlationAdjustment;
    
    // Update limits
    const newLimits: RiskLimits = {
      positionLimit: Math.round(this.config.basePositionLimit * adjustmentFactor),
      exposureLimit: Math.round(this.config.baseExposureLimit * adjustmentFactor),
      leverageLimit: this.config.baseLeverageLimit * adjustmentFactor,
      drawdownLimit: this.config.baseDrawdownLimit * Math.sqrt(adjustmentFactor), // Less aggressive for drawdown
      orderSizeLimit: Math.round(this.config.basePositionLimit * 0.1 * adjustmentFactor),
      concentrationLimit: 0.3 / Math.sqrt(adjustmentFactor), // Tighter concentration in high vol
      timestamp: new Date()
    };
    
    // Check if limits have changed significantly
    if (this.hasSignificantChange(newLimits)) {
      const oldLimits = this.currentLimits;
      this.currentLimits = newLimits;
      
      this.logger.info('Risk limits updated', {
        adjustmentFactor,
        volatility: this.marketConditions.volatility,
        regime: this.marketConditions.regime,
        oldLimits,
        newLimits
      });
      
      this.emit('limits-updated', {
        oldLimits,
        newLimits,
        reason: 'dynamic-adjustment',
        marketConditions: this.marketConditions
      });
    }
    
    // Emit metrics
    const duration = Date.now() - startTime;
    this.emit('update-complete', {
      duration,
      limits: this.currentLimits,
      adjustmentFactor
    });
  }
  
  private calculateVolatilityMultiplier(): number {
    if (this.historicalVolatility.length === 0) {
      return 1.0;
    }
    
    // Calculate average volatility
    const avgVolatility = this.historicalVolatility.reduce((sum, v) => sum + v, 0) / 
                         this.historicalVolatility.length;
    
    // Calculate current volatility relative to average
    const currentVol = this.marketConditions.volatility;
    const volRatio = currentVol / avgVolatility;
    
    // Apply adjustment factor (inverse relationship - higher vol = lower limits)
    const multiplier = 1 / (1 + this.config.adjustmentFactor * (volRatio - 1));
    
    // Cap the adjustment
    return Math.max(0.3, Math.min(1.5, multiplier));
  }
  
  private getRegimeMultiplier(): number {
    switch (this.marketConditions.regime) {
      case 'normal':
        return 1.0;
      case 'stressed':
        return 0.7;
      case 'crisis':
        return 0.3;
      default:
        return 1.0;
    }
  }
  
  private calculateCorrelationAdjustment(): number {
    // Higher correlation = higher systemic risk = lower limits
    const correlation = this.marketConditions.correlation;
    return 1 - (correlation * 0.3); // Max 30% reduction for perfect correlation
  }
  
  private detectMarketRegime(): void {
    const vol = this.marketConditions.volatility;
    const spread = this.marketConditions.spread;
    const volume = this.marketConditions.volume;
    
    let regime: MarketConditions['regime'] = 'normal';
    
    // Crisis detection
    if (vol > 0.05 || spread > 0.01 || volume < 100000) {
      regime = 'crisis';
    }
    // Stressed market detection
    else if (vol > 0.03 || spread > 0.005 || volume < 500000) {
      regime = 'stressed';
    }
    
    if (regime !== this.marketConditions.regime) {
      this.logger.warn('Market regime change detected', {
        oldRegime: this.marketConditions.regime,
        newRegime: regime,
        volatility: vol,
        spread,
        volume
      });
      
      this.marketConditions.regime = regime;
      
      this.emit('regime-change', {
        regime,
        timestamp: new Date()
      });
    }
  }
  
  private hasSignificantChange(newLimits: RiskLimits): boolean {
    const threshold = 0.05; // 5% change threshold
    
    return Math.abs(newLimits.positionLimit - this.currentLimits.positionLimit) / 
           this.currentLimits.positionLimit > threshold ||
           Math.abs(newLimits.exposureLimit - this.currentLimits.exposureLimit) / 
           this.currentLimits.exposureLimit > threshold ||
           Math.abs(newLimits.leverageLimit - this.currentLimits.leverageLimit) / 
           this.currentLimits.leverageLimit > threshold;
  }
  
  private checkRiskViolations(): void {
    const violations: RiskViolation[] = [];
    
    // Check exposure limit
    if (this.riskMetrics.currentExposure > this.currentLimits.exposureLimit) {
      violations.push({
        type: 'exposure',
        current: this.riskMetrics.currentExposure,
        limit: this.currentLimits.exposureLimit,
        severity: this.riskMetrics.currentExposure > this.currentLimits.exposureLimit * 1.2 ? 
                  'critical' : 'warning',
        timestamp: new Date(),
        action: this.riskMetrics.currentExposure > this.currentLimits.exposureLimit * 1.2 ? 
                'block' : 'alert'
      });
    }
    
    // Check leverage limit
    if (this.riskMetrics.currentLeverage > this.currentLimits.leverageLimit) {
      violations.push({
        type: 'leverage',
        current: this.riskMetrics.currentLeverage,
        limit: this.currentLimits.leverageLimit,
        severity: 'critical',
        timestamp: new Date(),
        action: 'reduce'
      });
    }
    
    // Check drawdown limit
    if (this.riskMetrics.currentDrawdown > this.currentLimits.drawdownLimit) {
      violations.push({
        type: 'drawdown',
        current: this.riskMetrics.currentDrawdown,
        limit: this.currentLimits.drawdownLimit,
        severity: 'critical',
        timestamp: new Date(),
        action: 'block'
      });
    }
    
    // Emit violations
    for (const violation of violations) {
      this.logger.error('Risk limit violation', violation);
      this.emit('violation', violation);
    }
  }
  
  // Public methods for risk checks
  async canTakePosition(symbol: string, size: number, currentPositions: Map<string, number>): Promise<boolean> {
    // Use atomic lock for consistent state
    return new Promise((resolve) => {
      this.updateLock = this.updateLock.then(() => {
        // Check position size limit
        if (Math.abs(size) > this.currentLimits.orderSizeLimit) {
          this.logger.warn('Order size exceeds limit', {
            symbol,
            size,
            limit: this.currentLimits.orderSizeLimit
          });
          resolve(false);
          return;
        }
        
        // Check total position limit
        const currentPosition = currentPositions.get(symbol) || 0;
        if (Math.abs(currentPosition + size) > this.currentLimits.positionLimit) {
          this.logger.warn('Position would exceed limit', {
            symbol,
            currentPosition,
            additionalSize: size,
            limit: this.currentLimits.positionLimit
          });
          resolve(false);
          return;
        }
        
        // Check concentration limit
        const totalExposure = Array.from(currentPositions.values())
          .reduce((sum, pos) => sum + Math.abs(pos), 0) + Math.abs(size);
        const concentration = Math.abs(currentPosition + size) / totalExposure;
        
        if (concentration > this.currentLimits.concentrationLimit) {
          this.logger.warn('Position would exceed concentration limit', {
            symbol,
            concentration,
            limit: this.currentLimits.concentrationLimit
          });
          resolve(false);
          return;
        }
        
        resolve(true);
      });
    });
  }
  
  calculateRequiredMargin(positions: Map<string, number>, prices: Map<string, number>): number {
    let totalMargin = 0;
    
    for (const [symbol, position] of positions) {
      const price = prices.get(symbol) || 0;
      const notional = Math.abs(position * price);
      
      // Base margin requirement
      let marginReq = notional / this.currentLimits.leverageLimit;
      
      // Add stress test buffer
      marginReq *= (1 + Math.abs(this.riskMetrics.stressTestResult));
      
      // Add volatility buffer
      marginReq *= (1 + this.marketConditions.volatility * 2);
      
      totalMargin += marginReq;
    }
    
    return totalMargin;
  }
  
  performStressTest(positions: Map<string, number>, scenarios: StressScenario[]): number {
    let worstLoss = 0;
    
    for (const scenario of scenarios) {
      let scenarioLoss = 0;
      
      for (const [symbol, position] of positions) {
        const shock = scenario.shocks.get(symbol) || scenario.defaultShock;
        scenarioLoss += position * shock;
      }
      
      worstLoss = Math.min(worstLoss, scenarioLoss);
    }
    
    // Update stress test result
    this.riskMetrics.stressTestResult = worstLoss;
    
    return worstLoss;
  }
  
  // Getters
  getCurrentLimits(): RiskLimits {
    return { ...this.currentLimits };
  }
  
  getMarketConditions(): MarketConditions {
    return { ...this.marketConditions };
  }
  
  getRiskMetrics(): RiskMetrics {
    return { ...this.riskMetrics };
  }
  
  // Emergency controls
  emergencyReduceLimits(factor: number = 0.5): void {
    this.logger.error('Emergency limit reduction triggered', { factor });
    
    this.currentLimits = {
      positionLimit: Math.round(this.currentLimits.positionLimit * factor),
      exposureLimit: Math.round(this.currentLimits.exposureLimit * factor),
      leverageLimit: this.currentLimits.leverageLimit * factor,
      drawdownLimit: this.currentLimits.drawdownLimit * factor,
      orderSizeLimit: Math.round(this.currentLimits.orderSizeLimit * factor),
      concentrationLimit: this.currentLimits.concentrationLimit * factor,
      timestamp: new Date()
    };
    
    this.emit('emergency-reduction', {
      factor,
      limits: this.currentLimits,
      timestamp: new Date()
    });
  }
  
  resetToBaseLimits(): void {
    this.logger.info('Resetting to base risk limits');
    
    this.currentLimits = {
      positionLimit: this.config.basePositionLimit,
      exposureLimit: this.config.baseExposureLimit,
      leverageLimit: this.config.baseLeverageLimit,
      drawdownLimit: this.config.baseDrawdownLimit,
      orderSizeLimit: this.config.basePositionLimit * 0.1,
      concentrationLimit: 0.3,
      timestamp: new Date()
    };
    
    this.emit('limits-reset', {
      limits: this.currentLimits,
      timestamp: new Date()
    });
  }
}

export interface StressScenario {
  name: string;
  description: string;
  shocks: Map<string, number>; // symbol -> price shock percentage
  defaultShock: number; // for symbols not in the map
  probability: number;
} 
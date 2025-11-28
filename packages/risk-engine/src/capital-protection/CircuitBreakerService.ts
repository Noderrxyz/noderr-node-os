import {
  Portfolio,
  CircuitBreakerConfig,
  CircuitBreakerStatus,
  RiskAlert,
  RiskEngineError,
  RiskErrorCode
} from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';

export class CircuitBreakerService extends EventEmitter {
  private logger: Logger;
  private status: CircuitBreakerStatus;
  private lossHistory: LossRecord[] = [];
  private volatilityHistory: VolatilityRecord[] = [];
  private lastResetTime: number;
  private consecutiveLossDays: number = 0;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.status = this.initializeStatus();
    this.lastResetTime = this.getLastResetTime();
  }

  /**
   * Check if circuit breaker should be triggered
   */
  async checkCircuitBreaker(
    portfolio: Portfolio,
    config: CircuitBreakerConfig
  ): Promise<CircuitBreakerStatus> {
    this.logger.debug('Checking circuit breaker conditions');

    // Calculate current losses
    const losses = this.calculateLosses(portfolio);
    
    // Update loss history
    this.updateLossHistory(losses);
    
    // Check each trigger condition
    const triggers = await this.checkAllTriggers(losses, config);
    
    // Determine if circuit breaker should activate
    const shouldTrigger = triggers.some(t => t.triggered);
    
    if (shouldTrigger && !this.status.isActive) {
      const triggeredBy = triggers.find(t => t.triggered)!;
      await this.activateCircuitBreaker(triggeredBy.type, config);
    } else if (this.status.isActive && this.shouldDeactivate(config)) {
      await this.deactivateCircuitBreaker();
    }
    
    // Update status with current losses
    this.status.currentLosses = losses;
    
    return this.status;
  }

  /**
   * Manually activate circuit breaker
   */
  async activate(reason: string): Promise<void> {
    this.logger.warn('Manual circuit breaker activation', { reason });
    
    this.status = {
      isActive: true,
      triggeredBy: 'volatility', // Default to volatility for manual
      triggeredAt: Date.now(),
      currentLosses: this.status.currentLosses,
      resumeAt: Date.now() + 3600000, // 1 hour default
      manualOverride: true
    };
    
    this.emit('circuitBreakerActivated', {
      status: this.status,
      reason
    });
  }

  /**
   * Manually deactivate circuit breaker
   */
  async deactivate(reason: string): Promise<void> {
    this.logger.info('Manual circuit breaker deactivation', { reason });
    
    this.status.isActive = false;
    this.status.manualOverride = true;
    
    this.emit('circuitBreakerDeactivated', {
      status: this.status,
      reason
    });
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): CircuitBreakerStatus {
    return { ...this.status };
  }

  /**
   * Check if trading is allowed
   */
  isTradingAllowed(): boolean {
    return !this.status.isActive || 
           (this.status.manualOverride && !this.status.isActive);
  }

  /**
   * Generate risk alert if circuit breaker is active
   */
  generateAlert(): RiskAlert | null {
    if (!this.status.isActive) return null;
    
    const timeRemaining = this.status.resumeAt 
      ? Math.max(0, this.status.resumeAt - Date.now())
      : undefined;
    
    return {
      id: `circuit-breaker-${Date.now()}`,
      severity: 'critical',
      type: 'drawdown',
      message: `Circuit breaker active: ${this.status.triggeredBy} limit exceeded`,
      metric: 'circuit-breaker',
      currentValue: 1,
      threshold: 1,
      timestamp: Date.now(),
      acknowledged: false
    };
  }

  // Helper methods

  private initializeStatus(): CircuitBreakerStatus {
    return {
      isActive: false,
      currentLosses: {
        daily: 0,
        weekly: 0,
        monthly: 0,
        consecutive: 0
      },
      manualOverride: false
    };
  }

  private getLastResetTime(): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }

  private calculateLosses(portfolio: Portfolio): CircuitBreakerStatus['currentLosses'] {
    const now = Date.now();
    
    // Get historical values
    const dayAgo = this.getPortfolioValue(now - 86400000) || portfolio.totalValue;
    const weekAgo = this.getPortfolioValue(now - 604800000) || portfolio.totalValue;
    const monthAgo = this.getPortfolioValue(now - 2592000000) || portfolio.totalValue;
    
    // Calculate percentage losses
    const daily = (portfolio.totalValue - dayAgo) / dayAgo;
    const weekly = (portfolio.totalValue - weekAgo) / weekAgo;
    const monthly = (portfolio.totalValue - monthAgo) / monthAgo;
    
    // Update consecutive loss tracking
    if (daily < 0) {
      this.consecutiveLossDays++;
    } else {
      this.consecutiveLossDays = 0;
    }
    
    return {
      daily: Math.abs(Math.min(0, daily)),
      weekly: Math.abs(Math.min(0, weekly)),
      monthly: Math.abs(Math.min(0, monthly)),
      consecutive: this.consecutiveLossDays
    };
  }

  private getPortfolioValue(timestamp: number): number | null {
    // In production, fetch from portfolio history
    // Mock implementation
    const record = this.lossHistory.find(r => 
      Math.abs(r.timestamp - timestamp) < 3600000 // Within 1 hour
    );
    
    return record ? record.portfolioValue : null;
  }

  private updateLossHistory(losses: CircuitBreakerStatus['currentLosses']): void {
    this.lossHistory.push({
      timestamp: Date.now(),
      dailyLoss: losses.daily,
      weeklyLoss: losses.weekly,
      monthlyLoss: losses.monthly,
      portfolioValue: 1000000 // Mock value
    });
    
    // Keep history size manageable
    const cutoff = Date.now() - 30 * 86400000; // 30 days
    this.lossHistory = this.lossHistory.filter(r => r.timestamp > cutoff);
  }

  private async checkAllTriggers(
    losses: CircuitBreakerStatus['currentLosses'],
    config: CircuitBreakerConfig
  ): Promise<TriggerResult[]> {
    const triggers: TriggerResult[] = [];
    
    // Check daily loss limit
    triggers.push({
      type: 'dailyLoss',
      triggered: losses.daily > config.dailyLossLimit,
      value: losses.daily,
      threshold: config.dailyLossLimit
    });
    
    // Check weekly loss limit
    triggers.push({
      type: 'weeklyLoss',
      triggered: losses.weekly > config.weeklyLossLimit,
      value: losses.weekly,
      threshold: config.weeklyLossLimit
    });
    
    // Check monthly loss limit
    triggers.push({
      type: 'monthlyLoss',
      triggered: losses.monthly > config.monthlyLossLimit,
      value: losses.monthly,
      threshold: config.monthlyLossLimit
    });
    
    // Check consecutive loss limit
    triggers.push({
      type: 'consecutiveLoss',
      triggered: losses.consecutive > config.consecutiveLossLimit,
      value: losses.consecutive,
      threshold: config.consecutiveLossLimit
    });
    
    // Check volatility spike
    const currentVolatility = await this.getCurrentVolatility();
    const normalVolatility = await this.getNormalVolatility();
    const volatilityRatio = currentVolatility / normalVolatility;
    
    triggers.push({
      type: 'volatility',
      triggered: volatilityRatio > config.volatilityMultiplier,
      value: volatilityRatio,
      threshold: config.volatilityMultiplier
    });
    
    return triggers;
  }

  private async getCurrentVolatility(): Promise<number> {
    // In production, calculate from recent price movements
    // Mock implementation
    return 0.02 + Math.random() * 0.03; // 2-5% volatility
  }

  private async getNormalVolatility(): Promise<number> {
    // In production, calculate rolling average volatility
    // Mock implementation
    return 0.02; // 2% normal volatility
  }

  private async activateCircuitBreaker(
    triggeredBy: CircuitBreakerStatus['triggeredBy'],
    config: CircuitBreakerConfig
  ): Promise<void> {
    this.logger.error('Circuit breaker activated', { triggeredBy });
    
    this.status.isActive = true;
    this.status.triggeredBy = triggeredBy;
    this.status.triggeredAt = Date.now();
    this.status.resumeAt = Date.now() + config.cooldownPeriod;
    this.status.manualOverride = false;
    
    // Emit activation event
    this.emit('circuitBreakerActivated', {
      status: this.status,
      triggeredBy,
      cooldownPeriod: config.cooldownPeriod
    });
    
    // Schedule automatic resume if enabled
    if (config.autoResumeEnabled) {
      setTimeout(() => {
        if (this.status.isActive && !this.status.manualOverride) {
          this.deactivateCircuitBreaker();
        }
      }, config.cooldownPeriod);
    }
  }

  private async deactivateCircuitBreaker(): Promise<void> {
    this.logger.info('Circuit breaker deactivated');
    
    const previousStatus = { ...this.status };
    this.status.isActive = false;
    this.status.triggeredBy = undefined;
    this.status.triggeredAt = undefined;
    this.status.resumeAt = undefined;
    
    // Emit deactivation event
    this.emit('circuitBreakerDeactivated', {
      previousStatus,
      currentStatus: this.status,
      duration: previousStatus.triggeredAt 
        ? Date.now() - previousStatus.triggeredAt 
        : 0
    });
  }

  private shouldDeactivate(config: CircuitBreakerConfig): boolean {
    if (!this.status.isActive) return false;
    if (this.status.manualOverride) return false;
    if (!config.autoResumeEnabled) return false;
    
    // Check if cooldown period has passed
    if (this.status.resumeAt && Date.now() >= this.status.resumeAt) {
      // Verify conditions have improved
      const losses = this.status.currentLosses;
      const hasImproved = 
        losses.daily < config.dailyLossLimit * 0.8 &&
        losses.weekly < config.weeklyLossLimit * 0.8 &&
        losses.monthly < config.monthlyLossLimit * 0.8;
      
      return hasImproved;
    }
    
    return false;
  }

  /**
   * Reset daily counters
   */
  async resetDailyCounters(): Promise<void> {
    const now = new Date();
    const lastReset = new Date(this.lastResetTime);
    
    // Check if it's a new day
    if (now.getDate() !== lastReset.getDate()) {
      this.logger.info('Resetting daily circuit breaker counters');
      
      // Reset consecutive loss counter if profitable today
      if (this.status.currentLosses.daily <= 0) {
        this.consecutiveLossDays = 0;
      }
      
      // Update last reset time
      this.lastResetTime = this.getLastResetTime();
      
      // Emit reset event
      this.emit('dailyReset', {
        previousLosses: this.status.currentLosses,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Get historical circuit breaker activations
   */
  getActivationHistory(days: number = 30): CircuitBreakerActivation[] {
    // In production, fetch from database
    // Mock implementation
    return [
      {
        timestamp: Date.now() - 7 * 86400000,
        triggeredBy: 'dailyLoss',
        duration: 3600000,
        losses: {
          daily: 0.08,
          weekly: 0.12,
          monthly: 0.15,
          consecutive: 3
        }
      },
      {
        timestamp: Date.now() - 15 * 86400000,
        triggeredBy: 'volatility',
        duration: 7200000,
        losses: {
          daily: 0.05,
          weekly: 0.08,
          monthly: 0.10,
          consecutive: 1
        }
      }
    ];
  }

  /**
   * Calculate time until next potential trigger
   */
  getTimeToNextTrigger(
    portfolio: Portfolio,
    config: CircuitBreakerConfig
  ): number | null {
    const losses = this.status.currentLosses;
    const currentValue = portfolio.totalValue;
    
    // Calculate burn rate (loss per hour)
    const recentLoss = this.getRecentLossRate();
    if (recentLoss >= 0) return null; // Not losing money
    
    // Time to daily limit
    const dailyRemaining = config.dailyLossLimit - losses.daily;
    const timeToDaily = dailyRemaining / Math.abs(recentLoss);
    
    // Time to weekly limit
    const weeklyRemaining = config.weeklyLossLimit - losses.weekly;
    const timeToWeekly = weeklyRemaining / Math.abs(recentLoss);
    
    // Return the nearest trigger time
    return Math.min(timeToDaily, timeToWeekly) * 3600000; // Convert to milliseconds
  }

  private getRecentLossRate(): number {
    // Calculate loss rate over last hour
    if (this.lossHistory.length < 2) return 0;
    
    const recent = this.lossHistory.slice(-2);
    const timeDiff = recent[1].timestamp - recent[0].timestamp;
    const valueDiff = recent[1].portfolioValue - recent[0].portfolioValue;
    
    return valueDiff / timeDiff * 3600000; // Loss per hour
  }
}

// Supporting interfaces
interface LossRecord {
  timestamp: number;
  dailyLoss: number;
  weeklyLoss: number;
  monthlyLoss: number;
  portfolioValue: number;
}

interface VolatilityRecord {
  timestamp: number;
  volatility: number;
  symbol?: string;
}

interface TriggerResult {
  type: NonNullable<CircuitBreakerStatus['triggeredBy']>;
  triggered: boolean;
  value: number;
  threshold: number;
}

interface CircuitBreakerActivation {
  timestamp: number;
  triggeredBy: NonNullable<CircuitBreakerStatus['triggeredBy']>;
  duration: number;
  losses: CircuitBreakerStatus['currentLosses'];
} 
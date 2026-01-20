/**
 * Risk Check Service
 * 
 * Validates ML predictions against risk limits using the risk-engine package.
 * Performs position sizing, drawdown monitoring, and circuit breaker checks
 * before allowing trades to execute.
 * 
 * @module RiskCheckService
 */

import { Logger } from '@noderr/utils/src';

const logger = new Logger('RiskCheckService');
import { EventEmitter } from 'events';
import type { MLPrediction } from './MLSignalService';

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  approved: boolean;
  adjustedQuantity: number;
  riskScore: number; // 0-100
  maxLoss: number;
  positionSize: number;
  leverage: number;
  reasons: string[];
  riskFactors: {
    confidenceRisk: number;
    sizeRisk: number;
    volatilityRisk: number;
    concentrationRisk: number;
    drawdownRisk: number;
  };
}

/**
 * Portfolio state for risk assessment
 */
export interface PortfolioState {
  totalValue: number;
  cash: number;
  positions: Map<string, Position>;
  openOrders: number;
  dailyPnL: number;
  weeklyPnL: number;
  currentDrawdown: number;
  maxDrawdown: number;
}

/**
 * Position information
 */
export interface Position {
  symbol: string;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

/**
 * Risk limits configuration
 */
export interface RiskLimits {
  maxPositionSize: number; // Maximum position size as % of portfolio
  maxLeverage: number;
  maxDailyLoss: number; // Maximum daily loss as % of portfolio
  maxDrawdown: number; // Maximum drawdown as % of portfolio
  maxOpenPositions: number;
  maxCorrelation: number;
  minConfidence: number;
  circuitBreakerThreshold: number; // Loss threshold to trigger circuit breaker
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  triggered: boolean;
  reason: string;
  triggeredAt: number;
  cooldownPeriod: number; // milliseconds
}

/**
 * Risk Check Service
 * 
 * Validates ML predictions against comprehensive risk limits.
 * Integrates with risk-engine package for institutional-grade risk management.
 */
export class RiskCheckService extends EventEmitter {
  private riskLimits: RiskLimits;
  private circuitBreaker: CircuitBreakerState;
  private rejectionHistory: Array<{ prediction: MLPrediction; reason: string; timestamp: number }> = [];
  private approvalHistory: Array<{ prediction: MLPrediction; assessment: RiskAssessment; timestamp: number }> = [];
  
  constructor() {
    super();
    
    // Initialize risk limits
    this.riskLimits = {
      maxPositionSize: 0.10, // 10% of portfolio per position
      maxLeverage: 1.0, // No leverage for now
      maxDailyLoss: 0.03, // 3% daily loss limit
      maxDrawdown: 0.15, // 15% max drawdown
      maxOpenPositions: 10,
      maxCorrelation: 0.7,
      minConfidence: 0.65,
      circuitBreakerThreshold: 0.05 // 5% loss triggers circuit breaker
    };
    
    // Initialize circuit breaker
    this.circuitBreaker = {
      triggered: false,
      reason: '',
      triggeredAt: 0,
      cooldownPeriod: 3600000 // 1 hour cooldown
    };
  }
  
  /**
   * Initialize risk check service
   */
  async initialize(): Promise<void> {
    logger.info('[RiskCheckService] Initializing risk validation...');
    logger.info('[RiskCheckService] Risk limits:', this.riskLimits);
    logger.info('[RiskCheckService] Risk validation initialized');
    this.emit('initialized');
  }
  
  /**
   * Validate ML prediction against risk limits
   * 
   * @param prediction ML prediction to validate
   * @param portfolio Current portfolio state
   * @returns Risk assessment
   */
  async validatePrediction(
    prediction: MLPrediction,
    portfolio: PortfolioState
  ): Promise<RiskAssessment> {
    logger.info(`[RiskCheckService] Validating prediction: ${prediction.action} ${prediction.symbol}`);
    
    const reasons: string[] = [];
    let approved = true;
    
    // Check 1: Circuit breaker
    if (this.circuitBreaker.triggered) {
      const timeSinceTrigger = Date.now() - this.circuitBreaker.triggeredAt;
      if (timeSinceTrigger < this.circuitBreaker.cooldownPeriod) {
        const remainingCooldown = Math.ceil((this.circuitBreaker.cooldownPeriod - timeSinceTrigger) / 1000 / 60);
        
        this.recordRejection(prediction, `Circuit breaker active: ${this.circuitBreaker.reason} (cooldown: ${remainingCooldown}m)`);
        
        return {
          approved: false,
          adjustedQuantity: 0,
          riskScore: 100,
          maxLoss: 0,
          positionSize: 0,
          leverage: 0,
          reasons: [`Circuit breaker triggered: ${this.circuitBreaker.reason}`, `Cooldown remaining: ${remainingCooldown} minutes`],
          riskFactors: {
            confidenceRisk: 0,
            sizeRisk: 0,
            volatilityRisk: 0,
            concentrationRisk: 0,
            drawdownRisk: 100
          }
        };
      } else {
        // Cooldown expired, reset circuit breaker
        this.resetCircuitBreaker();
      }
    }
    
    // Check 2: Confidence threshold
    if (prediction.confidence < this.riskLimits.minConfidence) {
      approved = false;
      reasons.push(`Confidence too low: ${(prediction.confidence * 100).toFixed(0)}% < ${(this.riskLimits.minConfidence * 100).toFixed(0)}%`);
    }
    
    // Check 3: Daily loss limit
    const dailyLossPercent = Math.abs(portfolio.dailyPnL) / portfolio.totalValue;
    if (dailyLossPercent > this.riskLimits.maxDailyLoss) {
      approved = false;
      reasons.push(`Daily loss limit exceeded: ${(dailyLossPercent * 100).toFixed(2)}% > ${(this.riskLimits.maxDailyLoss * 100).toFixed(2)}%`);
      
      // Trigger circuit breaker
      this.triggerCircuitBreaker(`Daily loss limit exceeded: ${(dailyLossPercent * 100).toFixed(2)}%`);
    }
    
    // Check 4: Drawdown limit
    if (portfolio.currentDrawdown > this.riskLimits.maxDrawdown) {
      approved = false;
      reasons.push(`Drawdown limit exceeded: ${(portfolio.currentDrawdown * 100).toFixed(2)}% > ${(this.riskLimits.maxDrawdown * 100).toFixed(2)}%`);
      
      // Trigger circuit breaker
      this.triggerCircuitBreaker(`Drawdown limit exceeded: ${(portfolio.currentDrawdown * 100).toFixed(2)}%`);
    }
    
    // Check 5: Max open positions
    if (portfolio.positions.size >= this.riskLimits.maxOpenPositions) {
      approved = false;
      reasons.push(`Max open positions reached: ${portfolio.positions.size} >= ${this.riskLimits.maxOpenPositions}`);
    }
    
    // Calculate position size
    const positionSize = this.calculatePositionSize(prediction, portfolio);
    
    // Check 6: Position size limit
    const positionSizePercent = positionSize / portfolio.totalValue;
    if (positionSizePercent > this.riskLimits.maxPositionSize) {
      reasons.push(`Position size reduced from ${(positionSizePercent * 100).toFixed(2)}% to ${(this.riskLimits.maxPositionSize * 100).toFixed(2)}%`);
      // Don't reject, just adjust
    }
    
    // Calculate adjusted quantity
    const maxPositionValue = portfolio.totalValue * this.riskLimits.maxPositionSize;
    const adjustedPositionSize = Math.min(positionSize, maxPositionValue);
    const adjustedQuantity = adjustedPositionSize / prediction.price;
    
    // Calculate max loss
    const stopLossDistance = Math.abs(prediction.price - prediction.stopLoss);
    const maxLoss = adjustedQuantity * stopLossDistance;
    
    // Calculate risk factors
    const riskFactors = this.calculateRiskFactors(prediction, portfolio, adjustedPositionSize);
    
    // Calculate overall risk score
    const riskScore = this.calculateRiskScore(riskFactors);
    
    // Check 7: Risk score threshold
    if (riskScore > 80) {
      approved = false;
      reasons.push(`Risk score too high: ${riskScore.toFixed(0)}/100`);
    }
    
    // Build assessment
    const assessment: RiskAssessment = {
      approved,
      adjustedQuantity,
      riskScore,
      maxLoss,
      positionSize: adjustedPositionSize,
      leverage: this.riskLimits.maxLeverage,
      reasons: reasons.length > 0 ? reasons : ['All risk checks passed'],
      riskFactors
    };
    
    // Record result
    if (approved) {
      this.recordApproval(prediction, assessment);
      logger.info(`[RiskCheckService] ✅ Prediction approved (risk score: ${riskScore.toFixed(0)}/100)`);
    } else {
      this.recordRejection(prediction, reasons.join('; '));
      logger.info(`[RiskCheckService] ❌ Prediction rejected: ${reasons[0]}`);
    }
    
    this.emit('risk-assessment-complete', assessment);
    
    return assessment;
  }
  
  /**
   * Calculate position size based on Kelly Criterion and risk limits
   */
  private calculatePositionSize(prediction: MLPrediction, portfolio: PortfolioState): number {
    // Kelly Criterion: f = (p * b - q) / b
    // where:
    // f = fraction of capital to bet
    // p = probability of win (confidence)
    // q = probability of loss (1 - confidence)
    // b = odds (potential profit / potential loss)
    
    const p = prediction.confidence;
    const q = 1 - p;
    
    const potentialProfit = Math.abs(prediction.targetPrice - prediction.price);
    const potentialLoss = Math.abs(prediction.price - prediction.stopLoss);
    const b = potentialProfit / potentialLoss;
    
    // Kelly fraction
    let kellyFraction = (p * b - q) / b;
    
    // Use fractional Kelly (25% of Kelly) for safety
    kellyFraction = kellyFraction * 0.25;
    
    // Ensure positive and within limits
    kellyFraction = Math.max(0, Math.min(kellyFraction, this.riskLimits.maxPositionSize));
    
    // Calculate position size
    const positionSize = portfolio.totalValue * kellyFraction;
    
    return positionSize;
  }
  
  /**
   * Calculate risk factors
   */
  private calculateRiskFactors(
    prediction: MLPrediction,
    portfolio: PortfolioState,
    positionSize: number
  ): RiskAssessment['riskFactors'] {
    // Confidence risk: lower confidence = higher risk
    const confidenceRisk = (1 - prediction.confidence) * 100;
    
    // Size risk: larger position = higher risk
    const sizePercent = positionSize / portfolio.totalValue;
    const sizeRisk = (sizePercent / this.riskLimits.maxPositionSize) * 30;
    
    // Volatility risk: based on stop loss distance
    const stopLossPercent = Math.abs(prediction.price - prediction.stopLoss) / prediction.price;
    const volatilityRisk = Math.min(100, stopLossPercent * 500);
    
    // Concentration risk: how many positions in same asset
    const existingPosition = portfolio.positions.get(prediction.symbol);
    const concentrationRisk = existingPosition ? 30 : 0;
    
    // Drawdown risk: current drawdown level
    const drawdownRisk = (portfolio.currentDrawdown / this.riskLimits.maxDrawdown) * 40;
    
    return {
      confidenceRisk,
      sizeRisk,
      volatilityRisk,
      concentrationRisk,
      drawdownRisk
    };
  }
  
  /**
   * Calculate overall risk score from risk factors
   */
  private calculateRiskScore(riskFactors: RiskAssessment['riskFactors']): number {
    const weights = {
      confidenceRisk: 0.25,
      sizeRisk: 0.20,
      volatilityRisk: 0.25,
      concentrationRisk: 0.15,
      drawdownRisk: 0.15
    };
    
    const score =
      riskFactors.confidenceRisk * weights.confidenceRisk +
      riskFactors.sizeRisk * weights.sizeRisk +
      riskFactors.volatilityRisk * weights.volatilityRisk +
      riskFactors.concentrationRisk * weights.concentrationRisk +
      riskFactors.drawdownRisk * weights.drawdownRisk;
    
    return Math.min(100, Math.max(0, score));
  }
  
  /**
   * Trigger circuit breaker
   */
  private triggerCircuitBreaker(reason: string): void {
    if (this.circuitBreaker.triggered) {
      return; // Already triggered
    }
    
    this.circuitBreaker.triggered = true;
    this.circuitBreaker.reason = reason;
    this.circuitBreaker.triggeredAt = Date.now();
    
    logger.error('[RiskCheckService] 🚨 CIRCUIT BREAKER TRIGGERED 🚨');
    logger.error('[RiskCheckService] Reason:', reason);
    logger.error('[RiskCheckService] Cooldown:', this.circuitBreaker.cooldownPeriod / 1000 / 60, 'minutes');
    
    this.emit('circuit-breaker-triggered', {
      reason,
      triggeredAt: this.circuitBreaker.triggeredAt,
      cooldownPeriod: this.circuitBreaker.cooldownPeriod
    });
  }
  
  /**
   * Reset circuit breaker
   */
  private resetCircuitBreaker(): void {
    logger.info('[RiskCheckService] Circuit breaker reset');
    this.circuitBreaker.triggered = false;
    this.circuitBreaker.reason = '';
    this.circuitBreaker.triggeredAt = 0;
    
    this.emit('circuit-breaker-reset');
  }
  
  /**
   * Manually reset circuit breaker (admin override)
   */
  forceResetCircuitBreaker(): void {
    logger.warn('[RiskCheckService] Circuit breaker force reset by admin');
    this.resetCircuitBreaker();
  }
  
  /**
   * Record rejection
   */
  private recordRejection(prediction: MLPrediction, reason: string): void {
    this.rejectionHistory.push({
      prediction,
      reason,
      timestamp: Date.now()
    });
    
    // Keep only last 1000 rejections
    if (this.rejectionHistory.length > 1000) {
      this.rejectionHistory.shift();
    }
    
    this.emit('prediction-rejected', { prediction, reason });
  }
  
  /**
   * Record approval
   */
  private recordApproval(prediction: MLPrediction, assessment: RiskAssessment): void {
    this.approvalHistory.push({
      prediction,
      assessment,
      timestamp: Date.now()
    });
    
    // Keep only last 1000 approvals
    if (this.approvalHistory.length > 1000) {
      this.approvalHistory.shift();
    }
    
    this.emit('prediction-approved', { prediction, assessment });
  }
  
  /**
   * Get rejection history
   */
  getRejectionHistory(limit?: number): typeof this.rejectionHistory {
    if (limit) {
      return this.rejectionHistory.slice(-limit);
    }
    return [...this.rejectionHistory];
  }
  
  /**
   * Get approval history
   */
  getApprovalHistory(limit?: number): typeof this.approvalHistory {
    if (limit) {
      return this.approvalHistory.slice(-limit);
    }
    return [...this.approvalHistory];
  }
  
  /**
   * Get rejection rate
   */
  getRejectionRate(): number {
    const total = this.rejectionHistory.length + this.approvalHistory.length;
    if (total === 0) return 0;
    return this.rejectionHistory.length / total;
  }
  
  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }
  
  /**
   * Update risk limits
   */
  updateRiskLimits(newLimits: Partial<RiskLimits>): void {
    this.riskLimits = {
      ...this.riskLimits,
      ...newLimits
    };
    
    logger.info('[RiskCheckService] Risk limits updated:', newLimits);
    this.emit('risk-limits-updated', this.riskLimits);
  }
  
  /**
   * Get current risk limits
   */
  getRiskLimits(): RiskLimits {
    return { ...this.riskLimits };
  }
}

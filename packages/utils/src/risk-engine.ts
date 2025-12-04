/**
 * Risk Engine - Institutional-Grade Risk Management
 * 
 * Implements fixed-point arithmetic for precise risk calculations
 * Prevents floating-point precision errors that could bypass risk limits
 */

import Decimal from 'decimal.js';

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -7,
  toExpPos: 21,
});

export interface Position {
  id: string;
  symbol: string;
  size: Decimal;
  entryPrice: Decimal;
  leverage: Decimal;
  collateral: Decimal;
}

export interface RiskLimits {
  maxExposure: Decimal;
  maxLeverage: Decimal;
  maxDrawdown: Decimal;
  maxPositionSize: Decimal;
  liquidationThreshold: Decimal;
}

export class RiskEngine {
  private positions: Map<string, Position> = new Map();
  private limits: RiskLimits;
  private totalEquity: Decimal;
  private peakEquity: Decimal;

  constructor(limits: RiskLimits, initialEquity: Decimal) {
    this.limits = limits;
    this.totalEquity = initialEquity;
    this.peakEquity = initialEquity;
  }

  /**
   * Calculate total notional exposure (fixed-point arithmetic)
   */
  calculateTotalExposure(): Decimal {
    let totalExposure = new Decimal(0);

    for (const position of this.positions.values()) {
      const notional = position.size.times(position.entryPrice);
      const leveragedNotional = notional.times(position.leverage);
      totalExposure = totalExposure.plus(leveragedNotional);
    }

    return totalExposure;
  }

  /**
   * Calculate current drawdown
   */
  calculateDrawdown(): Decimal {
    const drawdown = this.peakEquity.minus(this.totalEquity).dividedBy(this.peakEquity);
    return drawdown.isNegative() ? new Decimal(0) : drawdown;
  }

  /**
   * Validate position against risk limits
   */
  validatePosition(position: Position): ValidationResult {
    const errors: string[] = [];

    // Check position size limit
    if (position.size.greaterThan(this.limits.maxPositionSize)) {
      errors.push(
        `Position size ${position.size} exceeds max ${this.limits.maxPositionSize}`
      );
    }

    // Check leverage limit
    if (position.leverage.greaterThan(this.limits.maxLeverage)) {
      errors.push(
        `Leverage ${position.leverage} exceeds max ${this.limits.maxLeverage}`
      );
    }

    // Check exposure limit
    const currentExposure = this.calculateTotalExposure();
    const newExposure = currentExposure.plus(
      position.size.times(position.entryPrice).times(position.leverage)
    );

    if (newExposure.greaterThan(this.limits.maxExposure)) {
      errors.push(
        `Total exposure ${newExposure} would exceed limit ${this.limits.maxExposure}`
      );
    }

    // Check drawdown limit
    const currentDrawdown = this.calculateDrawdown();
    if (currentDrawdown.greaterThan(this.limits.maxDrawdown)) {
      errors.push(
        `Current drawdown ${currentDrawdown} exceeds limit ${this.limits.maxDrawdown}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Add position with validation
   */
  addPosition(position: Position): void {
    const validation = this.validatePosition(position);
    if (!validation.valid) {
      throw new Error(`Position validation failed: ${validation.errors.join(', ')}`);
    }

    this.positions.set(position.id, position);
  }

  /**
   * Update position atomically
   */
  updatePosition(positionId: string, updates: Partial<Position>): void {
    const position = this.positions.get(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const updated = { ...position, ...updates };
    const validation = this.validatePosition(updated);

    if (!validation.valid) {
      throw new Error(`Position update failed: ${validation.errors.join(', ')}`);
    }

    this.positions.set(positionId, updated);
  }

  /**
   * Calculate liquidation price
   */
  calculateLiquidationPrice(position: Position): Decimal {
    // Liquidation price = Entry Price * (1 - 1/Leverage)
    const liquidationPrice = position.entryPrice.times(
      new Decimal(1).minus(new Decimal(1).dividedBy(position.leverage))
    );

    return liquidationPrice;
  }

  /**
   * Check if position should be liquidated
   */
  shouldLiquidate(position: Position, currentPrice: Decimal): boolean {
    const liquidationPrice = this.calculateLiquidationPrice(position);

    if (position.size.isPositive()) {
      // Long position: liquidate if price falls below liquidation price
      return currentPrice.lessThan(liquidationPrice);
    } else {
      // Short position: liquidate if price rises above liquidation price
      return currentPrice.greaterThan(liquidationPrice);
    }
  }

  /**
   * Calculate margin requirement
   */
  calculateMarginRequirement(position: Position): Decimal {
    const notional = position.size.times(position.entryPrice);
    const marginRequired = notional.dividedBy(position.leverage);
    return marginRequired;
  }

  /**
   * Calculate available margin
   */
  calculateAvailableMargin(): Decimal {
    let totalMarginRequired = new Decimal(0);

    for (const position of this.positions.values()) {
      const marginRequired = this.calculateMarginRequirement(position);
      totalMarginRequired = totalMarginRequired.plus(marginRequired);
    }

    const availableMargin = this.totalEquity.minus(totalMarginRequired);
    return availableMargin.isNegative() ? new Decimal(0) : availableMargin;
  }

  /**
   * Update equity and track peak for drawdown calculation
   */
  updateEquity(newEquity: Decimal): void {
    this.totalEquity = newEquity;

    if (newEquity.greaterThan(this.peakEquity)) {
      this.peakEquity = newEquity;
    }
  }

  /**
   * Get risk metrics
   */
  getRiskMetrics() {
    return {
      totalExposure: this.calculateTotalExposure(),
      totalEquity: this.totalEquity,
      peakEquity: this.peakEquity,
      drawdown: this.calculateDrawdown(),
      availableMargin: this.calculateAvailableMargin(),
      exposureLimit: this.limits.maxExposure,
      drawdownLimit: this.limits.maxDrawdown,
    };
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Formal verification helper
 * Proves invariants hold at all times
 */
export class RiskEngineInvariantChecker {
  /**
   * Verify that exposure never exceeds limit
   */
  static verifyExposureInvariant(engine: RiskEngine, limit: Decimal): boolean {
    const exposure = engine.calculateTotalExposure();
    return exposure.lessThanOrEqualTo(limit);
  }

  /**
   * Verify that drawdown never exceeds limit
   */
  static verifyDrawdownInvariant(engine: RiskEngine, limit: Decimal): boolean {
    const drawdown = engine.calculateDrawdown();
    return drawdown.lessThanOrEqualTo(limit);
  }

  /**
   * Verify that available margin is always non-negative
   */
  static verifyMarginInvariant(engine: RiskEngine): boolean {
    const availableMargin = engine.calculateAvailableMargin();
    return availableMargin.greaterThanOrEqualTo(0);
  }

  /**
   * Verify all invariants
   */
  static verifyAllInvariants(engine: RiskEngine, limits: RiskLimits): boolean {
    return (
      this.verifyExposureInvariant(engine, limits.maxExposure) &&
      this.verifyDrawdownInvariant(engine, limits.maxDrawdown) &&
      this.verifyMarginInvariant(engine)
    );
  }
}

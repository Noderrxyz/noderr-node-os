/**
 * Risk Manager
 * 
 * Enforces risk limits and monitors exposure across the Floor Engine.
 * Provides validation for allocations, slippage monitoring, and emergency controls.
 */

import { EventEmitter } from 'events';
import {
  RiskParameters,
  RiskMetrics,
  FloorPosition,
  AdapterMetadata,
} from '../types';
import { AdapterRegistry } from './AdapterRegistry';

/**
 * Risk Manager
 * 
 * Central risk management system for the Floor Engine.
 * Enforces allocation limits, monitors exposure, and provides emergency controls.
 */
export class RiskManager extends EventEmitter {
  private riskParameters: RiskParameters;
  private adapterRegistry: AdapterRegistry;
  private isPaused: boolean = false;
  private pauseReason: string = '';
  private historicalDrawdowns: number[] = [];
  private maxHistoricalDrawdown: number = 0;

  constructor(riskParameters: RiskParameters, adapterRegistry: AdapterRegistry) {
    super();
    this.riskParameters = riskParameters;
    this.adapterRegistry = adapterRegistry;
  }

  /**
   * Validate capital allocation to an adapter
   * 
   * @param adapterId Adapter identifier
   * @param amount Amount to allocate
   * @param currentPositions Current positions across all adapters
   * @returns Validation result
   */
  async validateAllocation(
    adapterId: string,
    amount: bigint,
    currentPositions: FloorPosition[]
  ): Promise<{ valid: boolean; reason?: string }> {
    // Check if system is paused
    if (this.isPaused) {
      return {
        valid: false,
        reason: `System is paused: ${this.pauseReason}`,
      };
    }

    // Get adapter metadata
    const metadata = this.adapterRegistry.getMetadata(adapterId);

    // Check if adapter is enabled
    if (!metadata.enabled) {
      return {
        valid: false,
        reason: `Adapter ${adapterId} is disabled`,
      };
    }

    // Check adapter-specific max allocation
    const currentAdapterPosition = currentPositions.find((p) => p.adapterId === adapterId);
    const currentAdapterAllocation = currentAdapterPosition?.value || 0n;
    const newAdapterAllocation = currentAdapterAllocation + amount;

    if (newAdapterAllocation > metadata.maxAllocation) {
      return {
        valid: false,
        reason: `Allocation exceeds adapter max: ${newAdapterAllocation} > ${metadata.maxAllocation}`,
      };
    }

    // Check global max allocation per adapter
    if (newAdapterAllocation > this.riskParameters.maxAllocationPerAdapter) {
      return {
        valid: false,
        reason: `Allocation exceeds global adapter limit: ${newAdapterAllocation} > ${this.riskParameters.maxAllocationPerAdapter}`,
      };
    }

    // Check max allocation per protocol
    const protocolExposure = this.calculateProtocolExposure(metadata.protocol, currentPositions);
    const newProtocolExposure = protocolExposure + amount;

    if (newProtocolExposure > this.riskParameters.maxAllocationPerProtocol) {
      return {
        valid: false,
        reason: `Allocation exceeds protocol limit: ${newProtocolExposure} > ${this.riskParameters.maxAllocationPerProtocol}`,
      };
    }

    // Check max allocation per chain
    const chainExposure = this.calculateChainExposure(metadata.chain, currentPositions);
    const newChainExposure = chainExposure + amount;

    if (newChainExposure > this.riskParameters.maxAllocationPerChain) {
      return {
        valid: false,
        reason: `Allocation exceeds chain limit: ${newChainExposure} > ${this.riskParameters.maxAllocationPerChain}`,
      };
    }

    // Check if protocol is allowed
    if (
      this.riskParameters.allowedProtocols.length > 0 &&
      !this.riskParameters.allowedProtocols.includes(metadata.protocol)
    ) {
      return {
        valid: false,
        reason: `Protocol ${metadata.protocol} is not in allow list`,
      };
    }

    // All checks passed
    return { valid: true };
  }

  /**
   * Check slippage against limits
   * 
   * @param expectedOut Expected output amount
   * @param actualOut Actual output amount
   * @returns Whether slippage is within limits
   */
  checkSlippage(expectedOut: bigint, actualOut: bigint): boolean {
    if (expectedOut === 0n) {
      return false; // Invalid expected output
    }

    // Calculate slippage in basis points
    const slippageBps = Number(((expectedOut - actualOut) * 10000n) / expectedOut);

    if (slippageBps > this.riskParameters.maxSlippageBps) {
      this.emit('slippage_exceeded', {
        expectedOut,
        actualOut,
        slippageBps,
        maxSlippageBps: this.riskParameters.maxSlippageBps,
      });
      return false;
    }

    return true;
  }

  /**
   * Emergency pause the system
   * 
   * @param reason Reason for pause
   */
  emergencyPause(reason: string): void {
    if (this.isPaused) {
      console.warn('[RiskManager] System is already paused');
      return;
    }

    this.isPaused = true;
    this.pauseReason = reason;

    this.emit('emergency_pause', { reason, timestamp: Date.now() });

    console.error(`[RiskManager] EMERGENCY PAUSE: ${reason}`);
  }

  /**
   * Resume system after pause
   * 
   * @param authorizedBy Who authorized the resume (for audit trail)
   */
  resume(authorizedBy: string): void {
    if (!this.isPaused) {
      console.warn('[RiskManager] System is not paused');
      return;
    }

    this.isPaused = false;
    const previousReason = this.pauseReason;
    this.pauseReason = '';

    this.emit('system_resumed', {
      previousReason,
      authorizedBy,
      timestamp: Date.now(),
    });

    console.log(`[RiskManager] System resumed by ${authorizedBy}`);
  }

  /**
   * Get current exposure by protocol
   * 
   * @param protocol Protocol name
   * @param positions Current positions
   * @returns Total exposure to protocol
   */
  getProtocolExposure(protocol: string, positions: FloorPosition[]): bigint {
    return this.calculateProtocolExposure(protocol, positions);
  }

  /**
   * Get current exposure by chain
   * 
   * @param chain Chain name
   * @param positions Current positions
   * @returns Total exposure to chain
   */
  getChainExposure(chain: string, positions: FloorPosition[]): bigint {
    return this.calculateChainExposure(chain, positions);
  }

  /**
   * Calculate total risk metrics
   * 
   * @param positions Current positions
   * @param totalDeposited Total capital deposited
   * @returns Risk metrics
   */
  calculateRiskMetrics(positions: FloorPosition[], totalDeposited: bigint): RiskMetrics {
    // Calculate total exposure
    const totalExposure = positions.reduce((sum, p) => sum + p.value, 0n);

    // Calculate exposure by protocol
    const exposureByProtocol: Record<string, bigint> = {};
    for (const position of positions) {
      if (!exposureByProtocol[position.protocol]) {
        exposureByProtocol[position.protocol] = 0n;
      }
      exposureByProtocol[position.protocol] += position.value;
    }

    // Calculate exposure by chain
    const exposureByChain: Record<string, bigint> = {};
    for (const position of positions) {
      const metadata = this.adapterRegistry.getMetadata(position.adapterId);
      if (!exposureByChain[metadata.chain]) {
        exposureByChain[metadata.chain] = 0n;
      }
      exposureByChain[metadata.chain] += position.value;
    }

    // Calculate current drawdown
    const currentDrawdown = totalDeposited > 0n
      ? Number(((totalDeposited - totalExposure) * 10000n) / totalDeposited) / 100
      : 0;

    // Update historical drawdown
    this.historicalDrawdowns.push(currentDrawdown);
    if (currentDrawdown > this.maxHistoricalDrawdown) {
      this.maxHistoricalDrawdown = currentDrawdown;
    }

    // Keep only last 1000 drawdown measurements
    if (this.historicalDrawdowns.length > 1000) {
      this.historicalDrawdowns.shift();
    }

    // Calculate volatility (standard deviation of drawdowns)
    const avgDrawdown =
      this.historicalDrawdowns.reduce((sum, d) => sum + d, 0) / this.historicalDrawdowns.length;
    const variance =
      this.historicalDrawdowns.reduce((sum, d) => sum + Math.pow(d - avgDrawdown, 2), 0) /
      this.historicalDrawdowns.length;
    const volatility = Math.sqrt(variance);

    // Calculate Sharpe ratio (simplified: APY / volatility)
    const avgAPY = positions.length > 0
      ? positions.reduce((sum, p) => sum + p.apy, 0) / positions.length
      : 0;
    const sharpeRatio = volatility > 0 ? avgAPY / volatility : 0;

    // Check if drawdown exceeds limit
    if (currentDrawdown > this.riskParameters.maxDrawdownBps / 100) {
      this.emit('drawdown_exceeded', {
        currentDrawdown,
        maxDrawdown: this.riskParameters.maxDrawdownBps / 100,
      });

      // Auto-pause if emergency pause is enabled
      if (this.riskParameters.emergencyPauseEnabled) {
        this.emergencyPause(
          `Drawdown exceeded limit: ${currentDrawdown.toFixed(2)}% > ${(this.riskParameters.maxDrawdownBps / 100).toFixed(2)}%`
        );
      }
    }

    return {
      totalExposure,
      exposureByProtocol,
      exposureByChain,
      currentDrawdown,
      maxDrawdown: this.maxHistoricalDrawdown,
      sharpeRatio,
      volatility,
    };
  }

  /**
   * Update risk parameters
   * 
   * @param newParameters New risk parameters
   */
  updateRiskParameters(newParameters: Partial<RiskParameters>): void {
    this.riskParameters = {
      ...this.riskParameters,
      ...newParameters,
    };

    this.emit('risk_parameters_updated', { newParameters });

    console.log('[RiskManager] Risk parameters updated');
  }

  /**
   * Get current risk parameters
   * 
   * @returns Risk parameters
   */
  getRiskParameters(): RiskParameters {
    return { ...this.riskParameters }; // Return copy to prevent mutation
  }

  /**
   * Check if system is paused
   * 
   * @returns Pause status
   */
  isPausedStatus(): { paused: boolean; reason: string } {
    return {
      paused: this.isPaused,
      reason: this.pauseReason,
    };
  }

  /**
   * Validate token is allowed
   * 
   * @param token Token address
   * @returns Whether token is allowed
   */
  isTokenAllowed(token: string): boolean {
    if (this.riskParameters.allowedTokens.length === 0) {
      return true; // No whitelist = all tokens allowed
    }

    return this.riskParameters.allowedTokens.includes(token.toLowerCase());
  }

  /**
   * Validate protocol is allowed
   * 
   * @param protocol Protocol name
   * @returns Whether protocol is allowed
   */
  isProtocolAllowed(protocol: string): boolean {
    if (this.riskParameters.allowedProtocols.length === 0) {
      return true; // No whitelist = all protocols allowed
    }

    return this.riskParameters.allowedProtocols.includes(protocol);
  }

  /**
   * Calculate protocol exposure
   * 
   * @param protocol Protocol name
   * @param positions Current positions
   * @returns Total exposure to protocol
   */
  private calculateProtocolExposure(protocol: string, positions: FloorPosition[]): bigint {
    return positions
      .filter((p) => p.protocol === protocol)
      .reduce((sum, p) => sum + p.value, 0n);
  }

  /**
   * Calculate chain exposure
   * 
   * @param chain Chain name
   * @param positions Current positions
   * @returns Total exposure to chain
   */
  private calculateChainExposure(chain: string, positions: FloorPosition[]): bigint {
    return positions
      .filter((p) => {
        const metadata = this.adapterRegistry.getMetadata(p.adapterId);
        return metadata.chain === chain;
      })
      .reduce((sum, p) => sum + p.value, 0n);
  }
}

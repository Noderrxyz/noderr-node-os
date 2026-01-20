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
import { MLRiskAdapter, MLRiskScore, MLAllocationRecommendation, MLEmergencyAction } from './MLRiskAdapter';
import { Logger } from '@noderr/utils/src';

// LOW FIX: Use Logger instead of console
const logger = new Logger('RiskManager');

/**
 * Risk Manager
 * 
 * Central risk management system for the Floor Engine.
 * Enforces allocation limits, monitors exposure, and provides emergency controls.
 */
export class RiskManager extends EventEmitter {
  private riskParameters: RiskParameters;
  private adapterRegistry: AdapterRegistry;
  private mlRiskAdapter: MLRiskAdapter;
  private mlEnabled: boolean = true;
  private isPaused: boolean = false;
  private pauseReason: string = '';
  private historicalDrawdowns: number[] = [];
  private maxHistoricalDrawdown: number = 0;

  constructor(riskParameters: RiskParameters, adapterRegistry: AdapterRegistry) {
    super();
    this.riskParameters = riskParameters;
    this.adapterRegistry = adapterRegistry;
    this.mlRiskAdapter = new MLRiskAdapter();
    
    // Set up ML event listeners
    this.setupMLEventListeners();
  }

  /**
   * Initialize ML risk adapter
   */
  async initialize(): Promise<void> {
    logger.info('[RiskManager] Initializing ML risk assessment...');
    await this.mlRiskAdapter.initialize();
    logger.info('[RiskManager] ML risk assessment initialized');
  }

  /**
   * Set up event listeners for ML risk adapter
   */
  private setupMLEventListeners(): void {
    // Listen for ML emergency actions
    this.mlRiskAdapter.on('ml-emergency-action', (action: MLEmergencyAction) => {
      this.handleMLEmergencyAction(action);
    });

    // Listen for risk limit breaches
    this.mlRiskAdapter.on('risk-limit-breach', (breach: any) => {
      logger.warn('[RiskManager] ML detected risk limit breach:', breach);
      this.emit('ml_risk_breach', breach);
    });

    // Listen for allocation updates
    this.mlRiskAdapter.on('ml-allocation-updated', (allocation: any) => {
      logger.info('[RiskManager] ML allocation updated');
      this.emit('ml_allocation_updated', allocation);
    });
  }

  /**
   * Handle ML emergency action
   */
  private handleMLEmergencyAction(action: MLEmergencyAction): void {
    logger.error('[RiskManager] 🚨 ML EMERGENCY ACTION 🚨');
    logger.error('[RiskManager] Type:', action.type);
    logger.error('[RiskManager] Severity:', action.severity);
    logger.error('[RiskManager] Reason:', action.reason);
    logger.error('[RiskManager] Affected adapters:', action.affectedAdapters);

    // Auto-execute critical actions
    if (action.autoExecute && action.severity === 'CRITICAL') {
      this.emergencyPause(`ML Emergency: ${action.reason}`);
    }

    // Emit event for Floor Engine to handle
    this.emit('ml_emergency_action', action);
  }

  /**
   * Validate capital allocation to an adapter
   * 
   * Performs both rule-based and ML-based validation.
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
  ): Promise<{ valid: boolean; reason?: string; mlRiskScore?: MLRiskScore }> {
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

    // Rule-based checks passed, now check ML risk assessment
    if (this.mlEnabled) {
      try {
        const mlRiskScore = await this.mlRiskAdapter.getRiskScore(
          adapterId,
          metadata,
          currentPositions
        );

        // Check if ML model recommends FREEZE
        if (mlRiskScore.recommendation === 'FREEZE') {
          return {
            valid: false,
            reason: `ML risk model recommends freezing ${adapterId} (risk score: ${mlRiskScore.riskScore.toFixed(0)}/100). ${mlRiskScore.reasoning}`,
            mlRiskScore
          };
        }

        // Check if ML model recommends DECREASE and we're trying to increase
        if (mlRiskScore.recommendation === 'DECREASE' && amount > 0n) {
          return {
            valid: false,
            reason: `ML risk model recommends decreasing ${adapterId} allocation (risk score: ${mlRiskScore.riskScore.toFixed(0)}/100). ${mlRiskScore.reasoning}`,
            mlRiskScore
          };
        }

        // Check if risk score exceeds maximum threshold
        const maxMLRiskScore = this.riskParameters.maxMLRiskScore || 80;
        if (mlRiskScore.riskScore > maxMLRiskScore) {
          return {
            valid: false,
            reason: `ML risk score too high: ${mlRiskScore.riskScore.toFixed(0)} > ${maxMLRiskScore}. ${mlRiskScore.reasoning}`,
            mlRiskScore
          };
        }

        // ML checks passed
        logger.info(`[RiskManager] ML validation passed for ${adapterId} (risk score: ${mlRiskScore.riskScore.toFixed(0)}/100)`);
        return { valid: true, mlRiskScore };

      } catch (error) {
        logger.error('[RiskManager] ML validation error:', error);
        // On ML error, fall back to rule-based validation only
        logger.warn('[RiskManager] Falling back to rule-based validation only');
        return { valid: true };
      }
    }

    // ML disabled, rule-based checks passed
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
      logger.warn('[RiskManager] System is already paused');
      return;
    }

    this.isPaused = true;
    this.pauseReason = reason;

    this.emit('emergency_pause', { reason, timestamp: Date.now() });

    logger.error(`[RiskManager] EMERGENCY PAUSE: ${reason}`);
  }

  /**
   * Resume system after pause
   * 
   * @param authorizedBy Who authorized the resume (for audit trail)
   */
  resume(authorizedBy: string): void {
    if (!this.isPaused) {
      logger.warn('[RiskManager] System is not paused');
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

    logger.info(`[RiskManager] System resumed by ${authorizedBy}`);
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
   * Get ML-driven allocation recommendations
   * 
   * @param totalCapital Total capital to allocate
   * @param currentPositions Current positions
   * @returns Array of ML allocation recommendations
   */
  async getMLAllocationRecommendations(
    totalCapital: bigint,
    currentPositions: FloorPosition[]
  ): Promise<MLAllocationRecommendation[]> {
    if (!this.mlEnabled) {
      throw new Error('ML risk assessment is disabled');
    }

    const adapterIds = this.adapterRegistry.getAllAdapters();
    const adapters = adapterIds.map(id => this.adapterRegistry.getAdapter(id)?.metadata).filter((m): m is AdapterMetadata => m !== undefined);
    return await this.mlRiskAdapter.getAllocationRecommendations(
      adapters,
      totalCapital,
      currentPositions
    );
  }

  /**
   * Get ML risk score for an adapter
   * 
   * @param adapterId Adapter identifier
   * @param currentPositions Current positions
   * @returns ML risk score
   */
  async getMLRiskScore(
    adapterId: string,
    currentPositions: FloorPosition[]
  ): Promise<MLRiskScore> {
    if (!this.mlEnabled) {
      throw new Error('ML risk assessment is disabled');
    }

    const metadata = this.adapterRegistry.getMetadata(adapterId);
    return await this.mlRiskAdapter.getRiskScore(adapterId, metadata, currentPositions);
  }

  /**
   * Monitor portfolio using ML
   * 
   * @param positions Current positions
   * @param totalValue Total portfolio value
   */
  async monitorPortfolioML(
    positions: FloorPosition[],
    totalValue: bigint
  ): Promise<void> {
    if (!this.mlEnabled) {
      return;
    }

    await this.mlRiskAdapter.monitorPortfolio(positions, totalValue);
  }

  /**
   * Enable or disable ML risk assessment
   * 
   * @param enabled Whether to enable ML
   */
  setMLEnabled(enabled: boolean): void {
    this.mlEnabled = enabled;
    logger.info(`[RiskManager] ML risk assessment ${enabled ? 'enabled' : 'disabled'}`);
    this.emit('ml_enabled_changed', { enabled });
  }

  /**
   * Check if ML is enabled
   * 
   * @returns Whether ML is enabled
   */
  isMLEnabled(): boolean {
    return this.mlEnabled;
  }

  /**
   * Get ML emergency actions history
   * 
   * @returns Array of emergency actions
   */
  getMLEmergencyActionsHistory(): MLEmergencyAction[] {
    return this.mlRiskAdapter.getEmergencyActionsHistory();
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

    logger.info('[RiskManager] Risk parameters updated');
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

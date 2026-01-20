/**
 * Floor Engine Orchestrator
 * 
 * Main controller for the Floor Engine yield generation system.
 * Manages capital allocation, rebalancing, yield harvesting, and performance tracking.
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { Logger } from '@noderr/utils/src';

// MEDIUM FIX #44: Use Logger instead of console
const logger = new Logger('FloorEngine');
import {
  FloorEngineConfig,
  AllocationStrategy,
  PerformanceMetrics,
  RebalanceResult,
  RebalanceAction,
  PerformanceSnapshot,
  FloorPosition,
  AdapterCategory,
} from '../types';
import { AdapterRegistry } from './AdapterRegistry';
import { RiskManager } from './RiskManager';

/**
 * Floor Engine Orchestrator
 * 
 * Central orchestrator for low-risk yield generation.
 * Coordinates adapters, manages capital, and optimizes yields.
 */
export class FloorEngine extends EventEmitter {
  private config: FloorEngineConfig;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private adapterRegistry: AdapterRegistry;
  private riskManager: RiskManager;

  private totalDeposited: bigint = 0n;
  private positions: FloorPosition[] = [];
  private performanceHistory: PerformanceSnapshot[] = [];
  private lastRebalance: number = 0;
  private lastHarvest: number = 0;

  private isInitialized: boolean = false;

  constructor(config: FloorEngineConfig) {
    super();
    this.config = config;

    // Initialize provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    // MEDIUM FIX #45: Private key security warning
    // WARNING: Private key is stored in memory. Ensure config is never logged or serialized.
    // For production, use a secure key management system (e.g., AWS KMS, HashiCorp Vault)
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Initialize core components
    this.adapterRegistry = new AdapterRegistry();
    this.riskManager = new RiskManager(config.riskParameters, this.adapterRegistry);

    // Forward events from components
    this.adapterRegistry.on('adapter_registered', (event) => this.emit('adapter_registered', event));
    this.adapterRegistry.on('adapter_enabled', (event) => this.emit('adapter_enabled', event));
    this.adapterRegistry.on('adapter_disabled', (event) => this.emit('adapter_disabled', event));
    this.riskManager.on('emergency_pause', (event) => this.emit('emergency_pause', event));
    this.riskManager.on('drawdown_exceeded', (event) => this.emit('drawdown_exceeded', event));
  }

  /**
   * Initialize the Floor Engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      // MEDIUM FIX #44: Use Logger instead of console
      logger.warn('Already initialized');
      return;
    }

    logger.info('Initializing...');

    // Verify wallet connection
    const balance = await this.provider.getBalance(this.wallet.address);
    logger.info('Wallet connected', { address: this.wallet.address, balance: ethers.formatEther(balance) });

    // Verify network
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.config.chainId) {
      throw new Error(
        `Network mismatch: expected ${this.config.chainId}, got ${network.chainId}`
      );
    }
    logger.info('Connected to network', { networkName: this.config.networkName, chainId: network.chainId.toString() });

    // Initialize ML risk assessment
    await this.riskManager.initialize();

    this.isInitialized = true;
    this.emit('initialized');

    logger.info('Initialization complete');
  }

  /**
   * Allocate capital to adapters based on strategy
   * 
   * @param amount Total amount to allocate
   * @param strategy Allocation strategy
   */
  async allocateCapital(amount: bigint, strategy?: AllocationStrategy): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Floor Engine not initialized');
    }

    const allocationStrategy = strategy || this.config.allocationStrategy;

    logger.info(`[FloorEngine] Allocating ${ethers.formatEther(amount)} ETH`);
    logger.info(`[FloorEngine] Strategy:`, allocationStrategy);

    // Calculate allocation amounts per category
    const lendingAmount = (amount * BigInt(allocationStrategy.lending)) / 100n;
    const stakingAmount = (amount * BigInt(allocationStrategy.staking)) / 100n;
    const yieldAmount = (amount * BigInt(allocationStrategy.yield)) / 100n;
    const restakingAmount = (amount * BigInt(allocationStrategy.restaking || 0)) / 100n;

    // Get enabled adapters by category
    const lendingAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.LENDING, true);
    const stakingAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.STAKING, true);
    const yieldAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.YIELD, true);
    const restakingAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.RESTAKING, true);

    // Allocate to lending adapters
    if (lendingAmount > 0n && lendingAdapters.length > 0) {
      await this.allocateToCategory('lending', lendingAmount, lendingAdapters);
    }

    // Allocate to staking adapters
    if (stakingAmount > 0n && stakingAdapters.length > 0) {
      await this.allocateToCategory('staking', stakingAmount, stakingAdapters);
    }

    // Allocate to yield adapters
    if (yieldAmount > 0n && yieldAdapters.length > 0) {
      await this.allocateToCategory('yield', yieldAmount, yieldAdapters);
    }

    // Allocate to restaking adapters
    if (restakingAmount > 0n && restakingAdapters.length > 0) {
      await this.allocateToCategory('restaking', restakingAmount, restakingAdapters);
    }

    // Update total deposited
    this.totalDeposited += amount;

    // Emit event
    this.emit('capital_allocated', { amount, strategy: allocationStrategy });

    logger.info(`[FloorEngine] Capital allocation complete`);
  }

  /**
   * Allocate capital using ML-driven recommendations
   * 
   * @param amount Total amount to allocate
   * @returns Allocation result
   */
  async allocateCapitalML(amount: bigint): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Floor Engine not initialized');
    }

    logger.info(`[FloorEngine] Allocating ${ethers.formatEther(amount)} ETH using ML optimization`);

    // Get ML-driven allocation recommendations
    const recommendations = await this.riskManager.getMLAllocationRecommendations(
      amount,
      this.positions
    );

    logger.info(`[FloorEngine] ML generated ${recommendations.length} allocation recommendations`);

    // Execute allocations based on ML recommendations
    for (const rec of recommendations) {
      if (rec.recommendedAllocation > 0n) {
        logger.info(
          `[FloorEngine] ML recommends ${ethers.formatEther(rec.recommendedAllocation)} to ${rec.adapterName} ` +
          `(confidence: ${(rec.confidence * 100).toFixed(0)}%, risk: ${rec.riskScore.toFixed(0)}/100)`
        );

        // Validate allocation (will use ML risk assessment)
        const validation = await this.riskManager.validateAllocation(
          rec.adapterId,
          rec.recommendedAllocation,
          this.positions
        );

        if (validation.valid) {
          // Execute allocation
          await this.allocateToAdapter(rec.adapterId, rec.recommendedAllocation);
        } else {
          logger.warn(
            `[FloorEngine] ML allocation rejected for ${rec.adapterName}: ${validation.reason}`
          );
        }
      }
    }

    // Update total deposited
    this.totalDeposited += amount;

    // Emit event
    this.emit('capital_allocated_ml', { amount, recommendations });

    logger.info(`[FloorEngine] ML-driven capital allocation complete`);
  }

  /**
   * Rebalance positions using ML recommendations
   * 
   * @returns Rebalance result
   */
  async rebalanceML(): Promise<RebalanceResult> {
    if (!this.isInitialized) {
      throw new Error('Floor Engine not initialized');
    }

    logger.info('[FloorEngine] Starting ML-driven rebalance...');

    const actions: RebalanceAction[] = [];
    let totalGasUsed = 0n;

    try {
      // Update all positions
      await this.updatePositions();

      // Calculate total value
      const totalValue = this.positions.reduce((sum, p) => sum + p.value, 0n);

      if (totalValue === 0n) {
        logger.warn('[FloorEngine] No positions to rebalance');
        return {
          success: true,
          actions: [],
          gasUsed: 0n,
          timestamp: Date.now(),
        };
      }

      // Get ML recommendations
      const recommendations = await this.riskManager.getMLAllocationRecommendations(
        totalValue,
        this.positions
      );

      logger.info(`[FloorEngine] ML generated ${recommendations.length} rebalance recommendations`);

      // Execute rebalancing based on ML recommendations
      for (const rec of recommendations) {
        const difference = rec.allocationChange;

        // Only rebalance if change is significant (>5% of total value)
        if (Math.abs(Number(difference)) > Number(totalValue) * 0.05) {
          if (difference > 0n) {
            // Need to increase allocation
            const action: RebalanceAction = {
              adapterId: rec.adapterId,
              action: 'deposit',
              amount: difference,
              reason: `ML rebalance: ${rec.reason} (confidence: ${(rec.confidence * 100).toFixed(0)}%)`,
            };
            actions.push(action);

            logger.info(
              `[FloorEngine] ML recommends deposit ${ethers.formatEther(difference)} to ${rec.adapterName}`
            );
          } else {
            // Need to decrease allocation
            const action: RebalanceAction = {
              adapterId: rec.adapterId,
              action: 'withdraw',
              amount: -difference,
              reason: `ML rebalance: ${rec.reason} (confidence: ${(rec.confidence * 100).toFixed(0)}%)`,
            };
            actions.push(action);

            logger.info(
              `[FloorEngine] ML recommends withdraw ${ethers.formatEther(-difference)} from ${rec.adapterName}`
            );
          }
        }
      }

      // Execute actions
      // TODO: Implement actual execution logic

      this.lastRebalance = Date.now();

      // Emit event
      this.emit('rebalance_ml_completed', { actions, gasUsed: totalGasUsed });

      logger.info(`[FloorEngine] ML-driven rebalance complete: ${actions.length} actions`);

      return {
        success: true,
        actions,
        gasUsed: totalGasUsed,
        timestamp: this.lastRebalance,
      };
    } catch (error) {
      logger.error('[FloorEngine] ML rebalance failed:', error);

      return {
        success: false,
        actions,
        gasUsed: totalGasUsed,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Rebalance positions to match target allocations (rule-based)
   * 
   * @returns Rebalance result
   */
  async rebalance(): Promise<RebalanceResult> {
    if (!this.isInitialized) {
      throw new Error('Floor Engine not initialized');
    }

    // Check if rebalancing is allowed
    const timeSinceLastRebalance = Date.now() - this.lastRebalance;
    if (timeSinceLastRebalance < this.config.minRebalanceInterval * 1000) {
      throw new Error(
        `Rebalancing too frequent: ${timeSinceLastRebalance}ms since last rebalance`
      );
    }

    logger.info('[FloorEngine] Starting rebalance...');

    const actions: RebalanceAction[] = [];
    let totalGasUsed = 0n;

    try {
      // Update all positions
      await this.updatePositions();

      // Calculate total value
      const totalValue = this.positions.reduce((sum, p) => sum + p.value, 0n);

      if (totalValue === 0n) {
        logger.warn('[FloorEngine] No positions to rebalance');
        return {
          success: true,
          actions: [],
          gasUsed: 0n,
          timestamp: Date.now(),
        };
      }

      // Check each target allocation
      for (const target of this.config.targetAllocations) {
        const position = this.positions.find((p) => p.adapterId === target.adapterId);
        const currentValue = position?.value || 0n;
        const currentPercentage = Number((currentValue * 100n) / totalValue);

        const deviation = Math.abs(currentPercentage - target.targetPercentage);

        // Check if rebalancing is needed
        if (deviation > this.config.rebalanceThresholdBps / 100) {
          const targetValue = (totalValue * BigInt(target.targetPercentage)) / 100n;
          const difference = targetValue - currentValue;

          if (difference > 0n) {
            // Need to deposit more
            const action: RebalanceAction = {
              adapterId: target.adapterId,
              action: 'deposit',
              amount: difference,
              reason: `Rebalance: ${currentPercentage.toFixed(2)}% -> ${target.targetPercentage}%`,
            };
            actions.push(action);

            // TODO: Execute deposit
            logger.info(`[FloorEngine] Would deposit ${ethers.formatEther(difference)} to ${target.adapterId}`);
          } else {
            // Need to withdraw
            const action: RebalanceAction = {
              adapterId: target.adapterId,
              action: 'withdraw',
              amount: -difference,
              reason: `Rebalance: ${currentPercentage.toFixed(2)}% -> ${target.targetPercentage}%`,
            };
            actions.push(action);

            // TODO: Execute withdrawal
            logger.info(`[FloorEngine] Would withdraw ${ethers.formatEther(-difference)} from ${target.adapterId}`);
          }
        }
      }

      this.lastRebalance = Date.now();

      // Emit event
      this.emit('rebalance_completed', { actions, gasUsed: totalGasUsed });

      logger.info(`[FloorEngine] Rebalance complete: ${actions.length} actions`);

      return {
        success: true,
        actions,
        gasUsed: totalGasUsed,
        timestamp: this.lastRebalance,
      };
    } catch (error) {
      logger.error('[FloorEngine] Rebalance failed:', error);

      return {
        success: false,
        actions,
        gasUsed: totalGasUsed,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Harvest yields from all positions
   * 
   * @returns Total yield harvested
   */
  async harvestYields(): Promise<bigint> {
    if (!this.isInitialized) {
      throw new Error('Floor Engine not initialized');
    }

    // Check if harvesting is allowed
    const timeSinceLastHarvest = Date.now() - this.lastHarvest;
    if (timeSinceLastHarvest < this.config.minHarvestInterval * 1000) {
      throw new Error(
        `Harvesting too frequent: ${timeSinceLastHarvest}ms since last harvest`
      );
    }

    logger.info('[FloorEngine] Harvesting yields...');

    let totalYield = 0n;

    // TODO: Implement yield harvesting for each adapter type
    // For now, this is a placeholder

    this.lastHarvest = Date.now();

    // Emit event
    this.emit('harvest_completed', { totalYield });

    logger.info(`[FloorEngine] Harvest complete: ${ethers.formatEther(totalYield)} ETH`);

    return totalYield;
  }

  /**
   * Get all current positions
   * 
   * @returns Array of positions
   */
  async getPositions(): Promise<FloorPosition[]> {
    await this.updatePositions();
    return [...this.positions]; // Return copy
  }

  /**
   * Get total value locked (TVL)
   * 
   * @returns Total value
   */
  async getTotalValue(): Promise<bigint> {
    await this.updatePositions();
    return this.positions.reduce((sum, p) => sum + p.value, 0n);
  }

  /**
   * Get current APY across all positions
   * 
   * @returns Weighted average APY
   */
  async getAPY(): Promise<number> {
    await this.updatePositions();

    if (this.positions.length === 0) {
      return 0;
    }

    const totalValue = this.positions.reduce((sum, p) => sum + p.value, 0n);

    if (totalValue === 0n) {
      return 0;
    }

    // Calculate weighted average APY
    let weightedAPY = 0;
    for (const position of this.positions) {
      const weight = Number(position.value) / Number(totalValue);
      weightedAPY += position.apy * weight;
    }

    return weightedAPY;
  }

  /**
   * Get comprehensive performance metrics
   * 
   * @returns Performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    await this.updatePositions();

    const totalValue = await this.getTotalValue();
    const totalYield = totalValue - this.totalDeposited;
    const currentAPY = await this.getAPY();

    // Calculate average APY from history
    const averageAPY =
      this.performanceHistory.length > 0
        ? this.performanceHistory.reduce((sum, s) => sum + s.apy, 0) /
          this.performanceHistory.length
        : currentAPY;

    // Get risk metrics
    const riskMetrics = this.riskManager.calculateRiskMetrics(this.positions, this.totalDeposited);

    return {
      totalValue,
      totalDeposited: this.totalDeposited,
      totalYield,
      currentAPY,
      averageAPY,
      sharpeRatio: riskMetrics.sharpeRatio,
      maxDrawdown: riskMetrics.maxDrawdown,
      positions: [...this.positions],
      lastRebalance: this.lastRebalance,
      lastHarvest: this.lastHarvest,
    };
  }

  /**
   * Get adapter registry
   * 
   * @returns Adapter registry instance
   */
  getAdapterRegistry(): AdapterRegistry {
    return this.adapterRegistry;
  }

  /**
   * Get risk manager
   * 
   * @returns Risk manager instance
   */
  getRiskManager(): RiskManager {
    return this.riskManager;
  }

  /**
   * Enable or disable ML-driven allocation
   * 
   * @param enabled Whether to enable ML
   */
  setMLEnabled(enabled: boolean): void {
    this.riskManager.setMLEnabled(enabled);
    logger.info(`[FloorEngine] ML-driven allocation ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if ML is enabled
   * 
   * @returns Whether ML is enabled
   */
  isMLEnabled(): boolean {
    return this.riskManager.isMLEnabled();
  }

  /**
   * Get ML risk score for an adapter
   * 
   * @param adapterId Adapter identifier
   * @returns ML risk score
   */
  async getMLRiskScore(adapterId: string): Promise<any> {
    return await this.riskManager.getMLRiskScore(adapterId, this.positions);
  }

  /**
   * Allocate capital to a specific adapter
   * 
   * @param adapterId Adapter identifier
   * @param amount Amount to allocate
   */
  private async allocateToAdapter(adapterId: string, amount: bigint): Promise<void> {
    // TODO: Execute allocation to adapter
    logger.info(
      `[FloorEngine] Allocating ${ethers.formatEther(amount)} to ${adapterId}`
    );

    // Update positions
    const existingPosition = this.positions.find((p) => p.adapterId === adapterId);
    if (existingPosition) {
      existingPosition.value += amount;
      existingPosition.lastUpdate = Date.now();
    } else {
      const metadata = this.adapterRegistry.getMetadata(adapterId);
      this.positions.push({
        adapterId,
        protocol: metadata.protocol,
        category: metadata.category,
        value: amount,
        apy: 0, // Will be updated on next position update
        lastUpdate: Date.now(),
        metadata: {},
      });
    }

    // Emit event
    this.emit('capital_allocated', { adapterId, amount });
  }

  /**
   * Allocate capital to a category of adapters (rule-based)
   * 
   * @param category Adapter category
   * @param amount Total amount to allocate
   * @param adapterIds Array of adapter IDs
   */
  private async allocateToCategory(
    category: string,
    amount: bigint,
    adapterIds: string[]
  ): Promise<void> {
    // Distribute evenly across adapters in category
    const amountPerAdapter = amount / BigInt(adapterIds.length);

    for (const adapterId of adapterIds) {
      // Validate allocation
      const validation = await this.riskManager.validateAllocation(
        adapterId,
        amountPerAdapter,
        this.positions
      );

      if (!validation.valid) {
        logger.warn(
          `[FloorEngine] Skipping ${adapterId}: ${validation.reason}`
        );
        continue;
      }

      // Allocate to adapter
      await this.allocateToAdapter(adapterId, amountPerAdapter);
    }
  }

  /**
   * Update all positions with current values
   */
  private async updatePositions(): Promise<void> {
    // TODO: Query each adapter for current position value and APY
    // For now, this is a placeholder

    // Take performance snapshot
    const totalValue = this.positions.reduce((sum, p) => sum + p.value, 0n);
    const currentAPY = await this.getAPY();

    this.performanceHistory.push({
      timestamp: Date.now(),
      totalValue,
      apy: currentAPY,
      positions: [...this.positions],
    });

    // Keep only last 1000 snapshots
    if (this.performanceHistory.length > 1000) {
      this.performanceHistory.shift();
    }
  }
}

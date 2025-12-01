/**
 * Floor Engine Orchestrator
 * 
 * Main controller for the Floor Engine yield generation system.
 * Manages capital allocation, rebalancing, yield harvesting, and performance tracking.
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
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
      console.warn('[FloorEngine] Already initialized');
      return;
    }

    console.log('[FloorEngine] Initializing...');

    // Verify wallet connection
    const balance = await this.provider.getBalance(this.wallet.address);
    console.log(`[FloorEngine] Wallet address: ${this.wallet.address}`);
    console.log(`[FloorEngine] Wallet balance: ${ethers.formatEther(balance)} ETH`);

    // Verify network
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.config.chainId) {
      throw new Error(
        `Network mismatch: expected ${this.config.chainId}, got ${network.chainId}`
      );
    }
    console.log(`[FloorEngine] Connected to ${this.config.networkName} (${network.chainId})`);

    this.isInitialized = true;
    this.emit('initialized');

    console.log('[FloorEngine] Initialization complete');
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

    console.log(`[FloorEngine] Allocating ${ethers.formatEther(amount)} ETH`);
    console.log(`[FloorEngine] Strategy:`, allocationStrategy);

    // Calculate allocation amounts per category
    const lendingAmount = (amount * BigInt(allocationStrategy.lending)) / 100n;
    const stakingAmount = (amount * BigInt(allocationStrategy.staking)) / 100n;
    const yieldAmount = (amount * BigInt(allocationStrategy.yield)) / 100n;

    // Get enabled adapters by category
    const lendingAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.LENDING, true);
    const stakingAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.STAKING, true);
    const yieldAdapters = this.adapterRegistry.getAllAdapters(AdapterCategory.YIELD, true);

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

    // Update total deposited
    this.totalDeposited += amount;

    // Emit event
    this.emit('capital_allocated', { amount, strategy: allocationStrategy });

    console.log(`[FloorEngine] Capital allocation complete`);
  }

  /**
   * Rebalance positions to match target allocations
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

    console.log('[FloorEngine] Starting rebalance...');

    const actions: RebalanceAction[] = [];
    let totalGasUsed = 0n;

    try {
      // Update all positions
      await this.updatePositions();

      // Calculate total value
      const totalValue = this.positions.reduce((sum, p) => sum + p.value, 0n);

      if (totalValue === 0n) {
        console.warn('[FloorEngine] No positions to rebalance');
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
            console.log(`[FloorEngine] Would deposit ${ethers.formatEther(difference)} to ${target.adapterId}`);
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
            console.log(`[FloorEngine] Would withdraw ${ethers.formatEther(-difference)} from ${target.adapterId}`);
          }
        }
      }

      this.lastRebalance = Date.now();

      // Emit event
      this.emit('rebalance_completed', { actions, gasUsed: totalGasUsed });

      console.log(`[FloorEngine] Rebalance complete: ${actions.length} actions`);

      return {
        success: true,
        actions,
        gasUsed: totalGasUsed,
        timestamp: this.lastRebalance,
      };
    } catch (error) {
      console.error('[FloorEngine] Rebalance failed:', error);

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

    console.log('[FloorEngine] Harvesting yields...');

    let totalYield = 0n;

    // TODO: Implement yield harvesting for each adapter type
    // For now, this is a placeholder

    this.lastHarvest = Date.now();

    // Emit event
    this.emit('harvest_completed', { totalYield });

    console.log(`[FloorEngine] Harvest complete: ${ethers.formatEther(totalYield)} ETH`);

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
   * Allocate capital to a category of adapters
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
        console.warn(
          `[FloorEngine] Skipping ${adapterId}: ${validation.reason}`
        );
        continue;
      }

      // TODO: Execute allocation to adapter
      console.log(
        `[FloorEngine] Allocating ${ethers.formatEther(amountPerAdapter)} to ${adapterId}`
      );

      // Update positions
      const existingPosition = this.positions.find((p) => p.adapterId === adapterId);
      if (existingPosition) {
        existingPosition.value += amountPerAdapter;
        existingPosition.lastUpdate = Date.now();
      } else {
        const metadata = this.adapterRegistry.getMetadata(adapterId);
        this.positions.push({
          adapterId,
          protocol: metadata.protocol,
          category: metadata.category,
          value: amountPerAdapter,
          apy: 0, // Will be updated on next position update
          lastUpdate: Date.now(),
          metadata: {},
        });
      }

      // Emit event
      this.emit('capital_allocated', { adapterId, amount: amountPerAdapter });
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

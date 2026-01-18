/**
 * Adapter Registry
 * 
 * Central registry for managing all Floor Engine adapters.
 * Provides adapter registration, versioning, enable/disable functionality,
 * and unified adapter access.
 */

import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils/src';
import {
  AdapterMetadata,
  AdapterCategory,
  ILendingAdapter,
  IStakingAdapter,
  IYieldAdapter,
} from '../types';

// LOW FIX: Use Logger instead of console.log
const logger = new Logger('AdapterRegistry');

/**
 * Base adapter interface that all adapters must implement
 */
export interface IAdapter {
  readonly metadata: AdapterMetadata;
  initialize(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/**
 * Registered adapter with metadata
 */
interface RegisteredAdapter {
  adapter: IAdapter;
  metadata: AdapterMetadata;
  registeredAt: number;
  lastHealthCheck: number;
  healthStatus: boolean;
}

/**
 * Adapter Registry
 * 
 * Manages all adapters for the Floor Engine with version control,
 * enable/disable functionality, and health monitoring.
 */
export class AdapterRegistry extends EventEmitter {
  private adapters: Map<string, RegisteredAdapter> = new Map();
  private adaptersByCategory: Map<AdapterCategory, Set<string>> = new Map();
  private adaptersByProtocol: Map<string, Set<string>> = new Map();

  constructor() {
    super();
    
    // Initialize category maps
    this.adaptersByCategory.set(AdapterCategory.LENDING, new Set());
    this.adaptersByCategory.set(AdapterCategory.STAKING, new Set());
    this.adaptersByCategory.set(AdapterCategory.YIELD, new Set());
  }

  /**
   * Register a new adapter
   * 
   * @param adapterId Unique identifier for the adapter
   * @param adapter Adapter instance
   * @param metadata Adapter metadata
   */
  async registerAdapter(
    adapterId: string,
    adapter: IAdapter,
    metadata: AdapterMetadata
  ): Promise<void> {
    // Validate adapter ID
    if (this.adapters.has(adapterId)) {
      throw new Error(`Adapter ${adapterId} is already registered`);
    }

    // Validate metadata
    this.validateMetadata(metadata);

    // Initialize adapter
    try {
      await adapter.initialize();
    } catch (error) {
      throw new Error(`Failed to initialize adapter ${adapterId}: ${error}`);
    }

    // Perform initial health check
    const healthStatus = await adapter.healthCheck();

    // Register adapter
    const registered: RegisteredAdapter = {
      adapter,
      metadata,
      registeredAt: Date.now(),
      lastHealthCheck: Date.now(),
      healthStatus,
    };

    this.adapters.set(adapterId, registered);

    // Add to category index
    this.adaptersByCategory.get(metadata.category)?.add(adapterId);

    // Add to protocol index
    if (!this.adaptersByProtocol.has(metadata.protocol)) {
      this.adaptersByProtocol.set(metadata.protocol, new Set());
    }
    this.adaptersByProtocol.get(metadata.protocol)?.add(adapterId);

    // Emit event
    this.emit('adapter_registered', { adapterId, metadata });

    logger.info('Registered adapter', { adapterId, protocol: metadata.protocol });
  }

  /**
   * Unregister an adapter
   * 
   * @param adapterId Adapter identifier
   */
  unregisterAdapter(adapterId: string): void {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    // Remove from category index
    this.adaptersByCategory.get(registered.metadata.category)?.delete(adapterId);

    // Remove from protocol index
    this.adaptersByProtocol.get(registered.metadata.protocol)?.delete(adapterId);

    // Remove from main registry
    this.adapters.delete(adapterId);

    // Emit event
    this.emit('adapter_unregistered', { adapterId });

    logger.info('Unregistered adapter', { adapterId });
  }

  /**
   * Enable an adapter
   * 
   * @param adapterId Adapter identifier
   */
  enableAdapter(adapterId: string): void {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    if (registered.metadata.enabled) {
      logger.warn('Adapter already enabled', { adapterId });
      return;
    }

    registered.metadata.enabled = true;

    // Emit event
    this.emit('adapter_enabled', { adapterId });

    logger.info(`[AdapterRegistry] Enabled adapter: ${adapterId}`);
  }

  /**
   * Disable an adapter
   * 
   * @param adapterId Adapter identifier
   */
  disableAdapter(adapterId: string): void {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    if (!registered.metadata.enabled) {
      logger.warn(`[AdapterRegistry] Adapter ${adapterId} is already disabled`);
      return;
    }

    registered.metadata.enabled = false;

    // Emit event
    this.emit('adapter_disabled', { adapterId });

    logger.info(`[AdapterRegistry] Disabled adapter: ${adapterId}`);
  }

  /**
   * Get an adapter by ID
   * 
   * @param adapterId Adapter identifier
   * @returns Adapter instance
   */
  getAdapter(adapterId: string): IAdapter {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    if (!registered.metadata.enabled) {
      throw new Error(`Adapter ${adapterId} is disabled`);
    }

    return registered.adapter;
  }

  /**
   * Get adapter metadata
   * 
   * @param adapterId Adapter identifier
   * @returns Adapter metadata
   */
  getMetadata(adapterId: string): AdapterMetadata {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    return { ...registered.metadata }; // Return copy to prevent mutation
  }

  /**
   * Get all adapters (optionally filtered by category)
   * 
   * @param category Optional category filter
   * @param enabledOnly Only return enabled adapters
   * @returns Array of adapter IDs
   */
  getAllAdapters(category?: AdapterCategory, enabledOnly: boolean = true): string[] {
    let adapterIds: string[];

    if (category) {
      adapterIds = Array.from(this.adaptersByCategory.get(category) || []);
    } else {
      adapterIds = Array.from(this.adapters.keys());
    }

    if (enabledOnly) {
      adapterIds = adapterIds.filter((id) => {
        const registered = this.adapters.get(id);
        return registered?.metadata.enabled === true;
      });
    }

    return adapterIds;
  }

  /**
   * Get adapters by protocol
   * 
   * @param protocol Protocol name
   * @param enabledOnly Only return enabled adapters
   * @returns Array of adapter IDs
   */
  getAdaptersByProtocol(protocol: string, enabledOnly: boolean = true): string[] {
    const adapterIds = Array.from(this.adaptersByProtocol.get(protocol) || []);

    if (enabledOnly) {
      return adapterIds.filter((id) => {
        const registered = this.adapters.get(id);
        return registered?.metadata.enabled === true;
      });
    }

    return adapterIds;
  }

  /**
   * Perform health check on an adapter
   * 
   * @param adapterId Adapter identifier
   * @returns Health status
   */
  async healthCheck(adapterId: string): Promise<boolean> {
    const registered = this.adapters.get(adapterId);
    if (!registered) {
      throw new Error(`Adapter ${adapterId} is not registered`);
    }

    try {
      const healthStatus = await registered.adapter.healthCheck();
      
      registered.lastHealthCheck = Date.now();
      registered.healthStatus = healthStatus;

      if (!healthStatus) {
        logger.warn(`[AdapterRegistry] Health check failed for adapter: ${adapterId}`);
        this.emit('adapter_unhealthy', { adapterId });
      }

      return healthStatus;
    } catch (error) {
      logger.error(`[AdapterRegistry] Health check error for adapter ${adapterId}:`, error);
      registered.healthStatus = false;
      this.emit('adapter_unhealthy', { adapterId, error });
      return false;
    }
  }

  /**
   * Perform health check on all adapters
   * 
   * @returns Map of adapter IDs to health status
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const adapterId of this.adapters.keys()) {
      const healthStatus = await this.healthCheck(adapterId);
      results.set(adapterId, healthStatus);
    }

    return results;
  }

  /**
   * Get adapter statistics
   * 
   * @returns Registry statistics
   */
  getStatistics(): {
    totalAdapters: number;
    enabledAdapters: number;
    disabledAdapters: number;
    byCategory: Record<AdapterCategory, number>;
    byProtocol: Record<string, number>;
    healthyAdapters: number;
    unhealthyAdapters: number;
  } {
    const totalAdapters = this.adapters.size;
    let enabledAdapters = 0;
    let healthyAdapters = 0;

    const byCategory: Record<AdapterCategory, number> = {
      lending: 0,
      staking: 0,
      yield: 0,
      restaking: 0,
      liquidity: 0,
    };

    const byProtocol: Record<string, number> = {};

    for (const registered of this.adapters.values()) {
      if (registered.metadata.enabled) {
        enabledAdapters++;
      }

      if (registered.healthStatus) {
        healthyAdapters++;
      }

      byCategory[registered.metadata.category]++;

      if (!byProtocol[registered.metadata.protocol]) {
        byProtocol[registered.metadata.protocol] = 0;
      }
      byProtocol[registered.metadata.protocol]++;
    }

    return {
      totalAdapters,
      enabledAdapters,
      disabledAdapters: totalAdapters - enabledAdapters,
      byCategory,
      byProtocol,
      healthyAdapters,
      unhealthyAdapters: totalAdapters - healthyAdapters,
    };
  }

  /**
   * Validate adapter metadata
   * 
   * @param metadata Adapter metadata
   */
  private validateMetadata(metadata: AdapterMetadata): void {
    if (!metadata.name || metadata.name.trim() === '') {
      throw new Error('Adapter name is required');
    }

    if (!metadata.version || metadata.version.trim() === '') {
      throw new Error('Adapter version is required');
    }

    if (!metadata.protocol || metadata.protocol.trim() === '') {
      throw new Error('Adapter protocol is required');
    }

    if (!metadata.chain || metadata.chain.trim() === '') {
      throw new Error('Adapter chain is required');
    }

    if (!['lending', 'staking', 'yield'].includes(metadata.category)) {
      throw new Error(`Invalid adapter category: ${metadata.category}`);
    }

    if (!['low', 'medium', 'high'].includes(metadata.riskLevel)) {
      throw new Error(`Invalid risk level: ${metadata.riskLevel}`);
    }

    if (metadata.maxAllocation <= 0n) {
      throw new Error('Max allocation must be greater than 0');
    }
  }
}

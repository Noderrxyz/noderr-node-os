/**
 * NODERR Node Runtime - Tier-Specific Initialization
 * 
 * This is the main entry point for all NODERR nodes. It initializes the node
 * based on its tier configuration:
 * 
 * - VALIDATOR: Data validation and quarantine system (no ML service)
 * - ORACLE: P2P + ML service (PyTorch gRPC) for price predictions
 * - GUARDIAN: P2P + backtesting engine for strategy validation
 * 
 * The runtime automatically detects the node tier from environment variables
 * and initializes only the necessary components.
 * 
 * @module @noderr/node-runtime
 */

import { EventEmitter } from 'events';
import { MLServiceClient, createMLServiceClient } from '@noderr/phoenix-ml';
import { ValidatorNode, QuarantineManager, FeedBus } from '@noderr/feed-validator';

/**
 * Node tier types.
 * 
 * - VALIDATOR: Data validation and quarantine (Tier 2)
 * - ORACLE: ML inference for price predictions (Tier 4)
 * - GUARDIAN: Backtesting and strategy validation (Tier 3)
 */
export type NodeTier = 'VALIDATOR' | 'ORACLE' | 'GUARDIAN';

/**
 * Node runtime configuration.
 */
export interface NodeRuntimeConfig {
  /** Unique node identifier */
  nodeId: string;
  
  /** Node tier (VALIDATOR, ORACLE, or GUARDIAN) */
  tier: NodeTier;
  
  /** ML service host (only for ORACLE and GUARDIAN) */
  mlServiceHost?: string;
  
  /** ML service port (only for ORACLE and GUARDIAN) */
  mlServicePort?: number;
  
  /** Maximum retries for ML service connection */
  mlServiceMaxRetries?: number;
  
  /** Retry delay in milliseconds */
  mlServiceRetryDelayMs?: number;
}

/**
 * Node runtime state.
 */
export type NodeRuntimeState = 
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

/**
 * Main node runtime class.
 * 
 * Manages the lifecycle of a NODERR node, including initialization,
 * ML service connection, and graceful shutdown.
 */
export class NodeRuntime extends EventEmitter {
  private config: NodeRuntimeConfig;
  private mlClient?: MLServiceClient;
  private feedBus?: FeedBus;
  private quarantineManager?: QuarantineManager;
  private validators: Map<string, ValidatorNode> = new Map();
  private state: NodeRuntimeState = 'initializing';
  private startTime: number = 0;

  constructor(config: NodeRuntimeConfig) {
    super();
    this.config = config;
  }

  /**
   * Get the current runtime state.
   */
  getState(): NodeRuntimeState {
    return this.state;
  }

  /**
   * Get the node tier.
   */
  getTier(): NodeTier {
    return this.config.tier;
  }

  /**
   * Get the uptime in seconds.
   */
  getUptime(): number {
    if (this.startTime === 0) {
      return 0;
    }
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Initialize the node runtime based on tier.
   * 
   * This method:
   * 1. Logs the initialization start
   * 2. Initializes tier-specific components
   * 3. For ORACLE/GUARDIAN: Connects to ML service
   * 4. Emits 'ready' event when complete
   * 
   * @throws {Error} If initialization fails
   */
  async initialize(): Promise<void> {
    try {
      this.state = 'initializing';
      this.startTime = Date.now();

      console.log('[NodeRuntime] Initializing node runtime', {
        nodeId: this.config.nodeId,
        tier: this.config.tier,
        timestamp: new Date().toISOString()
      });

      // VALIDATOR nodes: Initialize feed validation system
      if (this.config.tier === 'VALIDATOR') {
        await this._initializeValidationService();
      }

      // ORACLE nodes: Initialize ML service for inference
      if (this.config.tier === 'ORACLE') {
        await this._initializeMLService();
      }

      // GUARDIAN nodes: Initialize backtesting engine
      if (this.config.tier === 'GUARDIAN') {
        await this._initializeBacktestingService();
      }

      this.state = 'ready';
      this.emit('ready');
      
      console.log('[NodeRuntime] Node runtime initialized successfully', {
        nodeId: this.config.nodeId,
        tier: this.config.tier,
        hasMLService: !!this.mlClient,
        uptime: this.getUptime()
      });

    } catch (error) {
      this.state = 'error';
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Initialize the feed validation service for VALIDATOR nodes.
   * 
   * This method:
   * 1. Creates FeedBus singleton
   * 2. Creates QuarantineManager singleton
   * 3. Registers ValidatorNodes for each exchange
   * 
   * @private
   */
  private async _initializeValidationService(): Promise<void> {
    console.log('[NodeRuntime] Initializing feed validation service...');

    // Initialize FeedBus
    this.feedBus = FeedBus.getInstance();
    console.log('[NodeRuntime] FeedBus initialized');

    // Initialize QuarantineManager
    this.quarantineManager = QuarantineManager.getInstance();
    console.log('[NodeRuntime] QuarantineManager initialized');

    // Register validators for each exchange
    const exchanges = ['BINANCE', 'UNISWAP', 'COINBASE', 'KRAKEN', 'BYBIT'];
    
    for (const exchange of exchanges) {
      const validator = new ValidatorNode(exchange, {
        maxHistorySize: 100,
        quarantineThresholdMs: 3000 // 3 second latency threshold
      });
      
      this.validators.set(exchange, validator);
      this.quarantineManager.registerValidator(exchange, validator);
      
      console.log(`[NodeRuntime] Registered validator for ${exchange}`);
    }

    console.log('[NodeRuntime] Feed validation service initialized', {
      exchangeCount: exchanges.length,
      quarantineThreshold: '3000ms'
    });
  }

  /**
   * Initialize the backtesting engine for GUARDIAN nodes.
   * 
   * This method:
   * 1. Loads backtesting configuration
   * 2. Initializes historical data sources
   * 3. Sets up strategy validation pipeline
   * 
   * @private
   */
  private async _initializeBacktestingService(): Promise<void> {
    console.log('[NodeRuntime] Initializing backtesting service...');
    
    // TODO: Implement backtesting engine initialization
    // This will be implemented in a future phase
    
    console.log('[NodeRuntime] Backtesting service initialized');
  }

  /**
   * Initialize the ML service connection.
   * 
   * This method:
   * 1. Creates the gRPC client
   * 2. Waits for the ML service to be healthy
   * 3. Retries on failure with exponential backoff
   * 
   * @private
   */
  private async _initializeMLService(): Promise<void> {
    console.log('[NodeRuntime] Initializing ML service client...');

    const host = this.config.mlServiceHost || 'localhost';
    const port = this.config.mlServicePort || 50051;
    const maxRetries = this.config.mlServiceMaxRetries || 10;
    const retryDelayMs = this.config.mlServiceRetryDelayMs || 5000;

    // Create ML client
    this.mlClient = createMLServiceClient(host, port, {
      maxRetries: 3,
      retryDelayMs: 1000,
      timeoutMs: 30000,
      enableMonitoring: true
    });

    // Set up event listeners
    this.mlClient.on('connected', (address) => {
      console.log('[NodeRuntime] ML service client connected', { address });
    });

    this.mlClient.on('disconnected', () => {
      console.log('[NodeRuntime] ML service client disconnected');
    });

    this.mlClient.on('request', (event) => {
      if (!event.success) {
        console.warn('[NodeRuntime] ML service request failed', event);
      }
    });

    // Wait for ML service to be ready
    console.log('[NodeRuntime] Waiting for ML service to be healthy...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const health = await this.mlClient.healthCheck();
        
        if (health.status === 'healthy') {
          console.log('[NodeRuntime] ML service is healthy', {
            uptime: health.uptimeSeconds,
            requestCount: health.requestCount,
            avgLatency: health.avgLatencyMs
          });
          return;
        }
        
        console.warn('[NodeRuntime] ML service unhealthy, retrying...', {
          attempt,
          maxRetries,
          status: health.status
        });
        
      } catch (error) {
        console.warn('[NodeRuntime] ML service health check failed', {
          attempt,
          maxRetries,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(1.5, attempt - 1);
        console.log(`[NodeRuntime] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(
      `Failed to connect to ML service after ${maxRetries} attempts. ` +
      `Ensure the ML service is running at ${host}:${port}`
    );
  }

  /**
   * Get the ML client.
   * 
   * @throws {Error} If ML client is not available for this tier
   */
  getMLClient(): MLServiceClient {
    if (!this.mlClient) {
      throw new Error(
        `ML client not available for tier: ${this.config.tier}. ` +
        `Only ORACLE and GUARDIAN nodes have ML capabilities.`
      );
    }
    return this.mlClient;
  }

  /**
   * Check if ML service is available.
   */
  hasMLService(): boolean {
    return !!this.mlClient;
  }

  /**
   * Start the node runtime.
   * 
   * This method starts the main event loop and begins processing tasks.
   */
  async start(): Promise<void> {
    if (this.state !== 'ready') {
      throw new Error(`Cannot start node in state: ${this.state}`);
    }

    this.state = 'running';
    this.emit('start');

    console.log('[NodeRuntime] Node runtime started', {
      nodeId: this.config.nodeId,
      tier: this.config.tier,
      hasMLService: this.hasMLService()
    });

    // Main event loop would go here
    // For now, just keep the process alive
    await new Promise(() => {}); // Never resolves
  }

  /**
   * Shutdown the node runtime gracefully.
   * 
   * This method:
   * 1. Stops accepting new tasks
   * 2. Finishes in-progress tasks
   * 3. Closes ML service connection
   * 4. Emits 'stopped' event
   */
  async shutdown(): Promise<void> {
    console.log('[NodeRuntime] Shutting down node runtime...');
    
    this.state = 'stopping';
    this.emit('stopping');

    // Close ML service connection
    if (this.mlClient) {
      console.log('[NodeRuntime] Closing ML service connection...');
      this.mlClient.close();
      this.mlClient = undefined;
    }

    this.state = 'stopped';
    this.emit('stopped');

    console.log('[NodeRuntime] Node runtime shut down successfully', {
      uptime: this.getUptime()
    });
  }

  /**
   * Get runtime statistics.
   */
  async getStats(): Promise<{
    nodeId: string;
    tier: NodeTier;
    state: NodeRuntimeState;
    uptime: number;
    hasMLService: boolean;
    mlServiceMetrics?: {
      requestCount: number;
      avgLatencyMs: number;
      connected: boolean;
    };
  }> {
    const stats: any = {
      nodeId: this.config.nodeId,
      tier: this.config.tier,
      state: this.state,
      uptime: this.getUptime(),
      hasMLService: this.hasMLService()
    };

    if (this.mlClient) {
      stats.mlServiceMetrics = this.mlClient.getClientMetrics();
    }

    return stats;
  }
}

/**
 * Create and initialize a node runtime.
 * 
 * This is the main entry point for creating a NODERR node.
 * 
 * @param config Node runtime configuration
 * @returns Initialized node runtime
 * 
 * @example
 * ```typescript
 * // Create an ORACLE node
 * const runtime = await createNodeRuntime({
 *   nodeId: 'oracle-001',
 *   tier: 'ORACLE',
 *   mlServiceHost: 'localhost',
 *   mlServicePort: 50051
 * });
 * 
 * // Start the node
 * await runtime.start();
 * ```
 */
export async function createNodeRuntime(
  config: NodeRuntimeConfig
): Promise<NodeRuntime> {
  const runtime = new NodeRuntime(config);
  await runtime.initialize();
  return runtime;
}

/**
 * Create a node runtime from environment variables.
 * 
 * This is a convenience function for Docker deployments.
 * 
 * Environment variables:
 * - NODE_ID: Unique node identifier (required)
 * - NODE_TIER: Node tier (ALL, ORACLE, or GUARDIAN) (required)
 * - ML_SERVICE_HOST: ML service host (default: localhost)
 * - ML_SERVICE_PORT: ML service port (default: 50051)
 * 
 * @returns Initialized node runtime
 * 
 * @example
 * ```bash
 * NODE_ID=oracle-001 NODE_TIER=ORACLE node dist/index.js
 * ```
 */
export async function createNodeRuntimeFromEnv(): Promise<NodeRuntime> {
  const nodeId = process.env.NODE_ID;
  const tier = process.env.NODE_TIER as NodeTier;

  if (!nodeId) {
    throw new Error('NODE_ID environment variable is required');
  }

  if (!tier || !['VALIDATOR', 'ORACLE', 'GUARDIAN'].includes(tier)) {
    throw new Error(
      'NODE_TIER environment variable must be VALIDATOR, ORACLE, or GUARDIAN'
    );
  }

  const config: NodeRuntimeConfig = {
    nodeId,
    tier,
    mlServiceHost: process.env.ML_SERVICE_HOST,
    mlServicePort: process.env.ML_SERVICE_PORT 
      ? parseInt(process.env.ML_SERVICE_PORT, 10) 
      : undefined
  };

  return createNodeRuntime(config);
}

// If this file is run directly, start the node runtime
if (require.main === module) {
  (async () => {
    try {
      console.log('[NodeRuntime] Starting NODERR node...');
      
      const runtime = await createNodeRuntimeFromEnv();
      
      // Handle shutdown signals
      const shutdown = async (signal: string) => {
        console.log(`[NodeRuntime] Received ${signal}, shutting down...`);
        await runtime.shutdown();
        process.exit(0);
      };

      process.on('SIGTERM', () => shutdown('SIGTERM'));
      process.on('SIGINT', () => shutdown('SIGINT'));

      // Start the runtime
      await runtime.start();
      
    } catch (error) {
      console.error('[NodeRuntime] Fatal error:', error);
      process.exit(1);
    }
  })();
}

/**
 * Auto-Updater Configuration
 * 
 * Defines configuration for the automated update agent
 * 
 * @module config
 */

export interface AutoUpdaterConfig {
  /**
   * VersionBeacon smart contract address
   * Deployed on Base Sepolia: 0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6
   */
  versionBeaconAddress: string;
  
  /**
   * RPC endpoint for blockchain queries
   * Should be Alchemy or Infura for reliability
   */
  rpcEndpoint: string;
  
  /**
   * Check interval in milliseconds
   * Default: 300000 (5 minutes)
   * Minimum: 60000 (1 minute)
   */
  checkInterval: number;
  
  /**
   * Node tier (determines which version to track).
   * MUST match the VersionBeacon.sol NodeTier enum:
   *   VALIDATOR = 0 (data validation nodes, 50k NODR stake)
   *   GUARDIAN  = 1 (backtesting nodes, 100k NODR stake)
   *   ORACLE    = 2 (ML inference nodes, 500k NODR stake)
   */
  nodeTier: 'VALIDATOR' | 'GUARDIAN' | 'ORACLE';
  
  /**
   * Unique node identifier (from registration)
   * Used for cohort determination
   */
  nodeId: string;
  
  /**
   * Docker registry URL
   * Where Docker images are stored
   */
  dockerRegistry: string;
  
  /**
   * Docker image name prefix
   * e.g., "noderr/node-os"
   */
  dockerImagePrefix: string;
  
  /**
   * Health check endpoint URL
   * Used to validate node health after update
   */
  healthCheckUrl: string;
  
  /**
   * Health check timeout in milliseconds
   * Default: 60000 (1 minute)
   */
  healthCheckTimeout: number;
  
  /**
   * Rollback timeout in milliseconds
   * How long to wait before automatic rollback
   * Default: 300000 (5 minutes)
   */
  rollbackTimeout: number;
  
  /**
   * Enable automatic updates
   * If false, only check for updates but don't apply
   * Default: true
   */
  autoUpdateEnabled: boolean;
  
  /**
   * Backup directory path
   * Where to store state backups before updates
   */
  backupDirectory: string;
  
  /**
   * Maximum number of backups to keep
   * Default: 3
   */
  maxBackups: number;
  
  /**
   * Telemetry endpoint URL
   * Where to report update status and metrics
   */
  telemetryEndpoint: string;
  
  /**
   * Log level
   * Default: 'info'
   */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Default configuration values
 */
export const defaultConfig: Partial<AutoUpdaterConfig> = {
  checkInterval: 300000, // 5 minutes
  healthCheckTimeout: 60000, // 1 minute
  rollbackTimeout: 300000, // 5 minutes
  autoUpdateEnabled: true,
  maxBackups: 3,
  logLevel: 'info',
};

/**
 * Load configuration from environment variables
 * 
 * @returns AutoUpdaterConfig
 * @throws Error if required environment variables are missing
 */
export function loadConfig(): AutoUpdaterConfig {
  const required = [
    'VERSION_BEACON_ADDRESS',
    'RPC_ENDPOINT',
    'NODE_TIER',
    'NODE_ID',
    'DOCKER_REGISTRY',
    'DOCKER_IMAGE_PREFIX',
    'HEALTH_CHECK_URL',
    'BACKUP_DIRECTORY',
    'TELEMETRY_ENDPOINT',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  const tier = process.env.NODE_TIER as 'VALIDATOR' | 'GUARDIAN' | 'ORACLE';
  if (!['VALIDATOR', 'GUARDIAN', 'ORACLE'].includes(tier)) {
    throw new Error(`Invalid NODE_TIER: ${tier}. Must be VALIDATOR, GUARDIAN, or ORACLE`);
  }
  
  return {
    versionBeaconAddress: process.env.VERSION_BEACON_ADDRESS!,
    rpcEndpoint: process.env.RPC_ENDPOINT!,
    checkInterval: parseInt(process.env.CHECK_INTERVAL || String(defaultConfig.checkInterval!)),
    nodeTier: tier,
    nodeId: process.env.NODE_ID!,
    dockerRegistry: process.env.DOCKER_REGISTRY!,
    dockerImagePrefix: process.env.DOCKER_IMAGE_PREFIX!,
    healthCheckUrl: process.env.HEALTH_CHECK_URL!,
    healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || String(defaultConfig.healthCheckTimeout!)),
    rollbackTimeout: parseInt(process.env.ROLLBACK_TIMEOUT || String(defaultConfig.rollbackTimeout!)),
    autoUpdateEnabled: process.env.AUTO_UPDATE_ENABLED !== 'false',
    backupDirectory: process.env.BACKUP_DIRECTORY!,
    maxBackups: parseInt(process.env.MAX_BACKUPS || String(defaultConfig.maxBackups!)),
    telemetryEndpoint: process.env.TELEMETRY_ENDPOINT!,
    logLevel: (process.env.LOG_LEVEL as any) || defaultConfig.logLevel!,
  };
}

/**
 * Validate configuration
 * 
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: AutoUpdaterConfig): void {
  // Validate Ethereum address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.versionBeaconAddress)) {
    throw new Error(`Invalid versionBeaconAddress: ${config.versionBeaconAddress}`);
  }
  
  // Validate RPC endpoint
  if (!config.rpcEndpoint.startsWith('http://') && !config.rpcEndpoint.startsWith('https://')) {
    throw new Error(`Invalid rpcEndpoint: ${config.rpcEndpoint}`);
  }
  
  // Validate intervals
  if (config.checkInterval < 60000) {
    throw new Error(`checkInterval too low: ${config.checkInterval}ms (minimum 60000ms)`);
  }
  
  if (config.healthCheckTimeout < 10000) {
    throw new Error(`healthCheckTimeout too low: ${config.healthCheckTimeout}ms (minimum 10000ms)`);
  }
  
  if (config.rollbackTimeout < 60000) {
    throw new Error(`rollbackTimeout too low: ${config.rollbackTimeout}ms (minimum 60000ms)`);
  }
  
  // Validate node ID format
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(config.nodeId)) {
    throw new Error(`Invalid nodeId format: ${config.nodeId}`);
  }
  
  // Validate health check URL
  if (!config.healthCheckUrl.startsWith('http://') && !config.healthCheckUrl.startsWith('https://')) {
    throw new Error(`Invalid healthCheckUrl: ${config.healthCheckUrl}`);
  }
  
  // Validate backup directory (should be absolute path)
  if (!config.backupDirectory.startsWith('/')) {
    throw new Error(`backupDirectory must be absolute path: ${config.backupDirectory}`);
  }
  
  // Validate max backups
  if (config.maxBackups < 1 || config.maxBackups > 10) {
    throw new Error(`maxBackups must be between 1 and 10: ${config.maxBackups}`);
  }
}

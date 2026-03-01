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
 * Load configuration from environment variables.
 *
 * Returns `null` when the minimum required variables (VERSION_BEACON_ADDRESS,
 * RPC_ENDPOINT) are absent, allowing the auto-updater process to stay alive
 * in PM2 without crash-looping. This is important for nodes deployed before
 * the auto-updater env vars were added to node.env — the process idles
 * gracefully until the operator updates their config or reinstalls.
 *
 * @returns AutoUpdaterConfig or null if not configured
 */
export function loadConfig(): AutoUpdaterConfig | null {
  const versionBeaconAddress = process.env.VERSION_BEACON_ADDRESS;
  const rpcEndpoint = process.env.RPC_ENDPOINT;

  if (!versionBeaconAddress || !rpcEndpoint) {
    return null;
  }

  // Determine tier with fallback
  const rawTier = (process.env.NODE_TIER || process.env.TIER || '').toUpperCase();
  const validTiers = ['VALIDATOR', 'GUARDIAN', 'ORACLE'];
  const tier = (validTiers.includes(rawTier)
    ? rawTier
    : 'VALIDATOR') as AutoUpdaterConfig['nodeTier'];

  return {
    versionBeaconAddress,
    rpcEndpoint,
    checkInterval: parseInt(process.env.CHECK_INTERVAL || String(defaultConfig.checkInterval!)),
    nodeTier: tier,
    nodeId: process.env.NODE_ID || 'unknown-node',
    dockerRegistry: process.env.DOCKER_REGISTRY || 'https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev',
    dockerImagePrefix: process.env.DOCKER_IMAGE_PREFIX || 'noderr',
    healthCheckUrl: process.env.HEALTH_CHECK_URL || 'http://localhost:8080/health',
    healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || String(defaultConfig.healthCheckTimeout!)),
    rollbackTimeout: parseInt(process.env.ROLLBACK_TIMEOUT || String(defaultConfig.rollbackTimeout!)),
    autoUpdateEnabled: process.env.AUTO_UPDATE_ENABLED !== 'false',
    backupDirectory: process.env.BACKUP_DIRECTORY || '/app/backups',
    maxBackups: parseInt(process.env.MAX_BACKUPS || String(defaultConfig.maxBackups!)),
    telemetryEndpoint: process.env.TELEMETRY_ENDPOINT || '',
    logLevel: (process.env.LOG_LEVEL as AutoUpdaterConfig['logLevel']) || defaultConfig.logLevel!,
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
  
  // Validate node ID format (0x-prefixed hex hash or alphanumeric identifier)
  if (!/^(0x)?[a-fA-F0-9]{8,64}$/.test(config.nodeId) && !/^[a-zA-Z0-9-]{8,64}$/.test(config.nodeId)) {
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

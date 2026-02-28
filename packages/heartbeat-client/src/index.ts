/**
 * Noderr Heartbeat Client
 * 
 * Sends periodic heartbeats to the auth-API to maintain node active status.
 * This service runs as a background process on every Noderr node.
 * 
 * Features:
 * - Configurable heartbeat interval (default: 60 seconds)
 * - Automatic retry with exponential backoff
 * - System metrics collection (CPU, memory, uptime)
 * - Graceful shutdown handling
 * - JWT token refresh
 */
import { Logger } from '@noderr/utils';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';

const logger = new Logger('heartbeat-client');

// Configuration from environment variables
const config = {
  authApiUrl: process.env.AUTH_API_URL || 'https://auth.noderr.xyz',
  nodeId: process.env.NODE_ID || '',
  jwtToken: process.env.JWT_TOKEN || '',
  apiKey: process.env.API_KEY || '',
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '60000', 10), // 60 seconds
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
  version: process.env.NODE_VERSION || '1.0.0',
  credentialsPath: process.env.CREDENTIALS_PATH || '/app/config/credentials.json',
};

// State
let isRunning = true;
let currentJwtToken = config.jwtToken;
let consecutiveFailures = 0;
const startTime = Date.now();

/**
 * Load credentials from file if not provided via environment
 */
function loadCredentials(): void {
  if (!config.nodeId || !config.jwtToken) {
    try {
      if (fs.existsSync(config.credentialsPath)) {
        const credentials = JSON.parse(fs.readFileSync(config.credentialsPath, 'utf-8'));
        config.nodeId = credentials.nodeId || config.nodeId;
        currentJwtToken = credentials.jwtToken || config.jwtToken;
        config.apiKey = credentials.apiKey || config.apiKey;
        logger.info('✅ Loaded credentials from file');
      }
    } catch (error) {
      logger.error('❌ Failed to load credentials:', error);
    }
  }
}

/**
 * Collect system metrics
 */
function collectMetrics(): {
  uptime: number;
  cpu: number;
  memory: number;
  version: string;
} {
  // Calculate uptime in seconds
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  
  // Get CPU usage (simplified - average load)
  const cpuLoad = os.loadavg()[0]; // 1-minute load average
  const cpuCount = os.cpus().length;
  const cpu = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  
  // Get memory usage
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memory = Math.round(((totalMem - freeMem) / totalMem) * 100);
  
  return {
    uptime,
    cpu,
    memory,
    version: config.version,
  };
}

/**
 * Send heartbeat to auth-API
 */
async function sendHeartbeat(): Promise<boolean> {
  const metrics = collectMetrics();
  
  const payload = {
    nodeId: config.nodeId,
    jwtToken: currentJwtToken,
    metrics,
  };
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(`${config.authApiUrl}/api/v1/auth/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentJwtToken}`,
      },
      body: JSON.stringify(payload),
      timeout: 10000, // 10 second timeout
    });
    
    if (response.ok) {
      const data = await response.json() as {
        acknowledged: boolean;
        shouldUpdate?: boolean;
        targetVersion?: string;
        newJwtToken?: string;
      };
      
      // Check if we need to update JWT token
      if (data.newJwtToken) {
        currentJwtToken = data.newJwtToken;
        saveCredentials();
      }
      
      // Check if we need to update node software
      if (data.shouldUpdate && data.targetVersion) {
        logger.info(`📦 Update available: ${data.targetVersion} — triggering auto-update...`);
        triggerAutoUpdate();
      }
      
      consecutiveFailures = 0;
      return true;
    } else {
      const errorText = await response.text();
      logger.error(`❌ Heartbeat failed: ${response.status} - ${errorText}`);
      
      // Handle specific error codes
      if (response.status === 401) {
        logger.info('🔄 JWT expired, attempting refresh...');
        await refreshJwtToken();
      }
      
      return false;
    }
  } catch (error) {
    logger.error('❌ Heartbeat error:', error);
    return false;
  }
}

/**
 * Trigger the tier-specific update script.
 * Downloads the latest image from R2 and restarts the container.
 * Runs in the background so the heartbeat loop is not blocked.
 */
let isUpdating = false;
function triggerAutoUpdate(): void {
  if (isUpdating) {
    logger.info('⏳ Update already in progress — skipping duplicate trigger');
    return;
  }
  isUpdating = true;

  const tier = (process.env.NODE_TIER || 'validator').toLowerCase();
  const scriptUrl = `https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/update_${tier}.sh`;
  const scriptPath = `/tmp/noderr-update-${tier}.sh`;

  logger.info(`🔄 Downloading update script for tier: ${tier}`);

  // Download the update script then execute it as root.
  // Use /bin/sh (always available) rather than bash (not present in Alpine/distroless images).
  execFile('/bin/sh', ['-c', `curl -fsSL "${scriptUrl}" -o "${scriptPath}" && chmod +x "${scriptPath}" && /bin/sh "${scriptPath}"`], {
    timeout: 600000, // 10 minute timeout for download + docker load
  }, (error, stdout, stderr) => {
    isUpdating = false;
    if (error) {
      logger.error(`❌ Auto-update failed: ${error.message}`);
      if (stderr) logger.error(`stderr: ${stderr.slice(0, 500)}`);
    } else {
      logger.info(`✅ Auto-update completed successfully`);
      if (stdout) logger.info(`stdout: ${stdout.slice(0, 500)}`);
    }
  });
}

/**
 * Refresh JWT token using API key
 */
async function refreshJwtToken(): Promise<boolean> {
  if (!config.apiKey) {
    logger.error('❌ No API key available for JWT refresh');
    return false;
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(`${config.authApiUrl}/api/v1/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId: config.nodeId,
        apiKey: config.apiKey,
        challenge: Date.now().toString(),
      }),
    });
    
    if (response.ok) {
      const data = await response.json() as { jwtToken: string };
      currentJwtToken = data.jwtToken;
      saveCredentials();
      logger.info('✅ JWT token refreshed');
      return true;
    } else {
      logger.error('❌ JWT refresh failed:', response.status);
      return false;
    }
  } catch (error) {
    logger.error('❌ JWT refresh error:', error);
    return false;
  }
}

/**
 * Save updated credentials to file
 */
function saveCredentials(): void {
  try {
    const credentials = {
      nodeId: config.nodeId,
      jwtToken: currentJwtToken,
      apiKey: config.apiKey,
      updatedAt: new Date().toISOString(),
    };
    
    const dir = path.dirname(config.credentialsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(config.credentialsPath, JSON.stringify(credentials, null, 2));
    logger.info('✅ Credentials saved to disk');
  } catch (error: any) {
    // Read-only filesystem (EROFS) is expected when credentials.json is mounted :ro.
    // The refreshed JWT is still held in memory — heartbeats will continue to work.
    // To persist across restarts, remount credentials.json as :rw in the systemd service.
    if (error?.code === 'EROFS') {
      logger.warn('⚠️  credentials.json is read-only — JWT refresh held in memory only (will re-refresh on restart)');
    } else {
      logger.error('❌ Failed to save credentials:', error);
    }
  }
}

/**
 * Calculate backoff delay for retries
 */
function getBackoffDelay(failures: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, max 60s
  const baseDelay = 1000;
  const maxDelay = 60000;
  return Math.min(maxDelay, baseDelay * Math.pow(2, failures));
}

/**
 * Main heartbeat loop
 */
async function heartbeatLoop(): Promise<void> {
  logger.info('💓 Starting heartbeat client...');
  logger.info(`   Node ID: ${config.nodeId}`);
  logger.info(`   Auth API: ${config.authApiUrl}`);
  logger.info(`   Interval: ${config.heartbeatInterval}ms`);
  
  while (isRunning) {
    const success = await sendHeartbeat();
    
    if (success) {
      logger.info(`💓 Heartbeat sent successfully (${new Date().toISOString()})`);
      // Wait for next interval
      await sleep(config.heartbeatInterval);
    } else {
      consecutiveFailures++;
      
      if (consecutiveFailures >= config.maxRetries) {
        logger.error(`❌ ${consecutiveFailures} consecutive failures, backing off...`);
      }
      
      // Wait with exponential backoff
      const backoffDelay = getBackoffDelay(consecutiveFailures);
      logger.info(`⏳ Retrying in ${backoffDelay / 1000}s...`);
      await sleep(backoffDelay);
    }
  }
  
  logger.info('💔 Heartbeat client stopped');
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Graceful shutdown handler
 */
function setupShutdownHandlers(): void {
  const shutdown = () => {
    logger.info('\n🛑 Shutting down heartbeat client...');
    isRunning = false;
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Wait for credentials to become available (polling loop).
 * The node may still be completing its initial registration with the auth-api
 * when this service starts. Instead of exiting immediately, we poll the
 * credentials file until credentials appear or the timeout is reached.
 */
async function waitForCredentials(maxWaitMs: number = 300000): Promise<boolean> {
  const pollInterval = 10000; // poll every 10 seconds
  const maxAttempts = Math.floor(maxWaitMs / pollInterval);
  
  logger.info(`⏳ Waiting for credentials to become available (up to ${maxWaitMs / 1000}s)...`);
  
  for (let attempt = 0; attempt < maxAttempts && isRunning; attempt++) {
    await sleep(pollInterval);
    loadCredentials();
    
    if (currentJwtToken || config.apiKey) {
      logger.info('✅ Credentials loaded after waiting');
      return true;
    }
    
    const elapsed = ((attempt + 1) * pollInterval / 1000);
    logger.info(`⏳ Still waiting for credentials... (${elapsed}s elapsed)`);
  }
  
  return false;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('🚀 Noderr Heartbeat Client v1.0.0');
  logger.info('================================');
  
  // Load credentials
  loadCredentials();
  
  // Validate configuration
  if (!config.nodeId) {
    logger.error('❌ NODE_ID is required');
    process.exit(1);
  }
  
  // If credentials are not yet available, the node may still be registering.
  // Wait up to 5 minutes for credentials to appear before giving up.
  if (!currentJwtToken && !config.apiKey) {
    logger.warn('⚠️  No JWT_TOKEN or API_KEY found — node may still be registering. Waiting...');
    
    // Setup shutdown handlers early so we can exit cleanly if needed
    setupShutdownHandlers();
    
    const credentialsFound = await waitForCredentials(300000);
    
    if (!credentialsFound) {
      logger.error('❌ Timed out waiting for credentials after 5 minutes.');
      logger.error('   Ensure the node registered successfully with the auth-api.');
      logger.error('   PM2 will restart this service and retry.');
      process.exit(1); // PM2 will restart with restart_delay
    }
  } else {
    // Setup shutdown handlers
    setupShutdownHandlers();
  }
  
  // Start heartbeat loop
  await heartbeatLoop();
}

// Export for testing
export {
  sendHeartbeat,
  collectMetrics,
  refreshJwtToken,
};

// Run only when executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

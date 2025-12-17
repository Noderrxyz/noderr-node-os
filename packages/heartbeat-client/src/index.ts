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

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

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
        console.log('✅ Loaded credentials from file');
      }
    } catch (error) {
      console.error('❌ Failed to load credentials:', error);
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
        console.log(`📦 Update available: ${data.targetVersion}`);
        // TODO: Trigger auto-update process
      }
      
      consecutiveFailures = 0;
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ Heartbeat failed: ${response.status} - ${errorText}`);
      
      // Handle specific error codes
      if (response.status === 401) {
        console.log('🔄 JWT expired, attempting refresh...');
        await refreshJwtToken();
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Heartbeat error:', error);
    return false;
  }
}

/**
 * Refresh JWT token using API key
 */
async function refreshJwtToken(): Promise<boolean> {
  if (!config.apiKey) {
    console.error('❌ No API key available for JWT refresh');
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
      console.log('✅ JWT token refreshed');
      return true;
    } else {
      console.error('❌ JWT refresh failed:', response.status);
      return false;
    }
  } catch (error) {
    console.error('❌ JWT refresh error:', error);
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
  } catch (error) {
    console.error('❌ Failed to save credentials:', error);
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
  console.log('💓 Starting heartbeat client...');
  console.log(`   Node ID: ${config.nodeId}`);
  console.log(`   Auth API: ${config.authApiUrl}`);
  console.log(`   Interval: ${config.heartbeatInterval}ms`);
  
  while (isRunning) {
    const success = await sendHeartbeat();
    
    if (success) {
      console.log(`💓 Heartbeat sent successfully (${new Date().toISOString()})`);
      // Wait for next interval
      await sleep(config.heartbeatInterval);
    } else {
      consecutiveFailures++;
      
      if (consecutiveFailures >= config.maxRetries) {
        console.error(`❌ ${consecutiveFailures} consecutive failures, backing off...`);
      }
      
      // Wait with exponential backoff
      const backoffDelay = getBackoffDelay(consecutiveFailures);
      console.log(`⏳ Retrying in ${backoffDelay / 1000}s...`);
      await sleep(backoffDelay);
    }
  }
  
  console.log('💔 Heartbeat client stopped');
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
    console.log('\n🛑 Shutting down heartbeat client...');
    isRunning = false;
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('🚀 Noderr Heartbeat Client v1.0.0');
  console.log('================================');
  
  // Load credentials
  loadCredentials();
  
  // Validate configuration
  if (!config.nodeId) {
    console.error('❌ NODE_ID is required');
    process.exit(1);
  }
  
  if (!currentJwtToken && !config.apiKey) {
    console.error('❌ JWT_TOKEN or API_KEY is required');
    process.exit(1);
  }
  
  // Setup shutdown handlers
  setupShutdownHandlers();
  
  // Start heartbeat loop
  await heartbeatLoop();
}

// Run
main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

// Export for testing
export {
  sendHeartbeat,
  collectMetrics,
  refreshJwtToken,
};

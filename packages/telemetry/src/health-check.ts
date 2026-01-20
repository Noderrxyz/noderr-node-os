/**
 * Health Check Module
 * Health check for Docker HEALTHCHECK directive
 */

import { Logger } from '@noderr/utils';
import { healthCheckRegistry } from './health-check-enhanced';

const logger = new Logger('health-check');
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await healthCheckRegistry.runAll();
    
    if (!result.healthy) {
      logger.error('Health check failed:', JSON.stringify(result, null, 2));
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('Health check error:', error);
    return false;
  }
}

// If run directly (for Docker HEALTHCHECK)
if (require.main === module) {
  healthCheck().then((healthy) => {
    process.exit(healthy ? 0 : 1);
  }).catch((error) => {
    logger.error('Health check exception:', error);
    process.exit(1);
  });
}

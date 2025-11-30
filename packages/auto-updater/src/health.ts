/**
 * Health Validation
 * 
 * Validates node health after updates
 * 
 * @module health
 */

import { AutoUpdaterConfig } from './config';
import { logger } from './logger';

/**
 * Health check result
 */
export interface HealthCheckResult {
  /**
   * Is the node healthy?
   */
  healthy: boolean;
  
  /**
   * HTTP status code
   */
  statusCode?: number;
  
  /**
   * Response time in milliseconds
   */
  responseTime?: number;
  
  /**
   * Error message if unhealthy
   */
  error?: string;
  
  /**
   * Health check details
   */
  details?: any;
}

/**
 * Health validator class
 */
export class HealthValidator {
  private config: AutoUpdaterConfig;
  
  constructor(config: AutoUpdaterConfig) {
    this.config = config;
  }
  
  /**
   * Perform health check
   * 
   * @returns Health check result
   */
  async checkHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Performing health check', {
        url: this.config.healthCheckUrl,
        timeout: this.config.healthCheckTimeout,
      });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeout
      );
      
      const response = await fetch(this.config.healthCheckUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Noderr-Auto-Updater/1.0',
        },
      });
      
      clearTimeout(timeoutId);
      
      const responseTime = Date.now() - startTime;
      const statusCode = response.status;
      
      // Try to parse response body
      let details: any;
      try {
        details = await response.json();
      } catch {
        details = await response.text();
      }
      
      const healthy = statusCode >= 200 && statusCode < 300;
      
      const result: HealthCheckResult = {
        healthy,
        statusCode,
        responseTime,
        details,
      };
      
      if (healthy) {
        logger.info('Health check passed', result);
      } else {
        logger.warn('Health check failed', result);
      }
      
      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      const result: HealthCheckResult = {
        healthy: false,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
      };
      
      logger.error('Health check error', result);
      
      return result;
    }
  }
  
  /**
   * Wait for node to become healthy
   * 
   * Retries health check until timeout
   * 
   * @param maxAttempts - Maximum number of attempts (default 10)
   * @param delayMs - Delay between attempts in milliseconds (default 5000)
   * @returns True if node became healthy
   */
  async waitForHealthy(maxAttempts: number = 10, delayMs: number = 5000): Promise<boolean> {
    logger.info('Waiting for node to become healthy', {
      maxAttempts,
      delayMs,
    });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.debug('Health check attempt', { attempt, maxAttempts });
      
      const result = await this.checkHealth();
      
      if (result.healthy) {
        logger.info('Node is healthy', { attempt });
        return true;
      }
      
      if (attempt < maxAttempts) {
        logger.debug('Waiting before next attempt', { delayMs });
        await this.sleep(delayMs);
      }
    }
    
    logger.error('Node did not become healthy', { maxAttempts });
    return false;
  }
  
  /**
   * Validate node health with detailed checks
   * 
   * Performs multiple health checks to ensure stability
   * 
   * @param checks - Number of checks to perform (default 3)
   * @param delayMs - Delay between checks (default 10000)
   * @returns True if all checks pass
   */
  async validateStability(checks: number = 3, delayMs: number = 10000): Promise<boolean> {
    logger.info('Validating node stability', { checks, delayMs });
    
    for (let i = 1; i <= checks; i++) {
      logger.debug('Stability check', { check: i, total: checks });
      
      const result = await this.checkHealth();
      
      if (!result.healthy) {
        logger.error('Stability check failed', { check: i });
        return false;
      }
      
      // Check response time is reasonable
      if (result.responseTime && result.responseTime > 5000) {
        logger.warn('Slow response time detected', {
          responseTime: result.responseTime,
          check: i,
        });
      }
      
      if (i < checks) {
        await this.sleep(delayMs);
      }
    }
    
    logger.info('Node stability validated', { checks });
    return true;
  }
  
  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

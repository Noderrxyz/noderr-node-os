/**
 * Enhanced Health Check System
 * 
 * Provides comprehensive health checking for all services.
 * 
 * Features:
 * - Service registration
 * - Database connectivity checks
 * - External API checks
 * - Custom health check functions
 * - Aggregated health status
 * - Detailed error reporting
 * 
 * Quality: PhD-Level + Production-Grade
 */

export interface HealthCheckResult {
  healthy: boolean;
  service: string;
  timestamp: number;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail';
      message?: string;
      latency?: number;
    };
  };
}

export type HealthCheckFunction = () => Promise<{
  status: 'pass' | 'fail';
  message?: string;
  latency?: number;
}>;

/**
 * Health Check Registry
 */
export class HealthCheckRegistry {
  private static instance: HealthCheckRegistry | null = null;
  private checks: Map<string, HealthCheckFunction> = new Map();
  private serviceName: string = 'unknown';
  
  private constructor() {}
  
  static getInstance(): HealthCheckRegistry {
    if (!HealthCheckRegistry.instance) {
      HealthCheckRegistry.instance = new HealthCheckRegistry();
    }
    return HealthCheckRegistry.instance;
  }
  
  setServiceName(name: string): void {
    this.serviceName = name;
  }
  
  /**
   * Register a health check
   */
  register(name: string, check: HealthCheckFunction): void {
    this.checks.set(name, check);
  }
  
  /**
   * Unregister a health check
   */
  unregister(name: string): void {
    this.checks.delete(name);
  }
  
  /**
   * Run all health checks
   */
  async runAll(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      healthy: true,
      service: this.serviceName,
      timestamp: Date.now(),
      checks: {},
    };
    
    // Run all checks in parallel
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, check]) => {
      try {
        const checkResult = await check();
        result.checks[name] = checkResult;
        
        if (checkResult.status === 'fail') {
          result.healthy = false;
        }
      } catch (error: any) {
        result.checks[name] = {
          status: 'fail',
          message: error.message || 'Check threw an exception',
        };
        result.healthy = false;
      }
    });
    
    await Promise.all(checkPromises);
    
    return result;
  }
}

/**
 * Common health check functions
 */

/**
 * Check if process memory usage is healthy
 */
export async function checkMemoryUsage(): Promise<{
  status: 'pass' | 'fail';
  message?: string;
}> {
  const memoryUsage = process.memoryUsage();
  const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
  
  if (heapUsedPercent > 95) {
    return {
      status: 'fail',
      message: `High memory usage: ${heapUsedPercent.toFixed(2)}%`,
    };
  }
  
  return {
    status: 'pass',
    message: `Memory usage: ${heapUsedPercent.toFixed(2)}%`,
  };
}

/**
 * Check if process has been running for minimum time
 */
export async function checkUptime(minSeconds: number = 5): Promise<{
  status: 'pass' | 'fail';
  message?: string;
}> {
  const uptime = process.uptime();
  
  if (uptime < minSeconds) {
    return {
      status: 'fail',
      message: `Process just started (uptime: ${uptime.toFixed(2)}s)`,
    };
  }
  
  return {
    status: 'pass',
    message: `Uptime: ${uptime.toFixed(2)}s`,
  };
}

/**
 * Check database connectivity
 */
export function createDatabaseCheck(
  connectionCheck: () => Promise<boolean>
): HealthCheckFunction {
  return async () => {
    const startTime = Date.now();
    
    try {
      const connected = await connectionCheck();
      const latency = Date.now() - startTime;
      
      if (!connected) {
        return {
          status: 'fail',
          message: 'Database connection failed',
          latency,
        };
      }
      
      return {
        status: 'pass',
        message: 'Database connected',
        latency,
      };
    } catch (error: any) {
      return {
        status: 'fail',
        message: `Database error: ${error.message}`,
        latency: Date.now() - startTime,
      };
    }
  };
}

/**
 * Check external API connectivity
 */
export function createAPICheck(
  name: string,
  apiCheck: () => Promise<boolean>
): HealthCheckFunction {
  return async () => {
    const startTime = Date.now();
    
    try {
      const available = await apiCheck();
      const latency = Date.now() - startTime;
      
      if (!available) {
        return {
          status: 'fail',
          message: `${name} API unavailable`,
          latency,
        };
      }
      
      return {
        status: 'pass',
        message: `${name} API available`,
        latency,
      };
    } catch (error: any) {
      return {
        status: 'fail',
        message: `${name} API error: ${error.message}`,
        latency: Date.now() - startTime,
      };
    }
  };
}

/**
 * Check Redis connectivity
 */
export function createRedisCheck(
  redisClient: any
): HealthCheckFunction {
  return async () => {
    const startTime = Date.now();
    
    try {
      await redisClient.ping();
      const latency = Date.now() - startTime;
      
      return {
        status: 'pass',
        message: 'Redis connected',
        latency,
      };
    } catch (error: any) {
      return {
        status: 'fail',
        message: `Redis error: ${error.message}`,
        latency: Date.now() - startTime,
      };
    }
  };
}

/**
 * Check gRPC service connectivity
 */
export function createGRPCCheck(
  serviceName: string,
  healthCheck: () => Promise<boolean>
): HealthCheckFunction {
  return async () => {
    const startTime = Date.now();
    
    try {
      const healthy = await healthCheck();
      const latency = Date.now() - startTime;
      
      if (!healthy) {
        return {
          status: 'fail',
          message: `${serviceName} gRPC service unhealthy`,
          latency,
        };
      }
      
      return {
        status: 'pass',
        message: `${serviceName} gRPC service healthy`,
        latency,
      };
    } catch (error: any) {
      return {
        status: 'fail',
        message: `${serviceName} gRPC error: ${error.message}`,
        latency: Date.now() - startTime,
      };
    }
  };
}

/**
 * Helper function to register common checks
 */
export function registerCommonChecks(serviceName: string): void {
  const registry = HealthCheckRegistry.getInstance();
  registry.setServiceName(serviceName);
  
  // Register memory check
  registry.register('memory', checkMemoryUsage);
  
  // Register uptime check
  registry.register('uptime', checkUptime);
}

/**
 * Export singleton instance
 */
export const healthCheckRegistry = HealthCheckRegistry.getInstance();

/**
 * Integration Test: Core Execution Flow
 * Tests the end-to-end order execution pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SystemOrchestrator } from '../../SystemOrchestrator';
import { Logger } from '@noderr/utils';

describe('Core Execution Flow Integration Tests', () => {
  let orchestrator: SystemOrchestrator;
  const logger = new Logger('execution-flow-test');

  beforeAll(async () => {
    logger.info('Setting up test environment');
    
    // Initialize system with test configuration
    orchestrator = new SystemOrchestrator({
      environment: 'test',
      enableTelemetry: false,
      enablePersistence: false,
    });

    await orchestrator.initialize();
  });

  afterAll(async () => {
    logger.info('Tearing down test environment');
    await orchestrator.shutdown();
  });

  it('should initialize all core components', () => {
    expect(orchestrator).toBeDefined();
    expect(orchestrator.getComponent('orderManager')).toBeDefined();
    expect(orchestrator.getComponent('riskEngine')).toBeDefined();
    expect(orchestrator.getComponent('executionEngine')).toBeDefined();
  });

  it('should validate order before execution', async () => {
    const testOrder = {
      id: 'test-order-1',
      symbol: 'BTC/USDT',
      side: 'buy' as const,
      type: 'limit' as const,
      quantity: 0.1,
      price: 50000,
      timestamp: Date.now(),
    };

    // This should pass validation
    const isValid = await orchestrator.executeCommand('validateOrder', testOrder);
    expect(isValid).toBeDefined();
  });

  it('should handle system health check', async () => {
    const health = await orchestrator.executeCommand('getSystemHealth', {});
    
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('components');
    expect(health.status).toBe('healthy');
  });

  it('should report system metrics', async () => {
    const metrics = await orchestrator.executeCommand('getMetrics', {});
    
    expect(metrics).toHaveProperty('uptime');
    expect(metrics).toHaveProperty('ordersProcessed');
    expect(metrics.uptime).toBeGreaterThan(0);
  });

  it('should handle graceful shutdown', async () => {
    const shutdownPromise = orchestrator.shutdown();
    
    await expect(shutdownPromise).resolves.not.toThrow();
  });
});

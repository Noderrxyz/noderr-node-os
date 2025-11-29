/**
 * Agent Health Manager Tests
 * 
 * Tests for the agent self-healing system
 */

import { TrustScoreService } from '../TrustScoreService';
import { AgentHealthManager } from '../AgentHealthManager';
import { AgentHealthMode } from '@noderr/types/agent.types';

// Mock Redis implementation for testing
class MockRedis {
  private data: Record<string, any> = {};
  
  async set(key: string, value: string): Promise<void> {
    this.data[key] = value;
  }
  
  async get(key: string): Promise<string | null> {
    return this.data[key] || null;
  }
  
  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.data[key]) {
      this.data[key] = {};
    }
    this.data[key][field] = value;
  }
  
  async hdel(key: string, ...fields: string[]): Promise<void> {
    if (this.data[key]) {
      for (const field of fields) {
        delete this.data[key][field];
      }
    }
  }
  
  async hget(key: string, field: string): Promise<string | null> {
    if (this.data[key]) {
      return this.data[key][field] || null;
    }
    return null;
  }
  
  async lpush(key: string, ...values: string[]): Promise<void> {
    if (!this.data[key]) {
      this.data[key] = [];
    }
    this.data[key].unshift(...values);
  }
  
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    if (this.data[key]) {
      this.data[key] = this.data[key].slice(start, stop + 1);
    }
  }
  
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.data[key]) {
      return [];
    }
    return this.data[key].slice(start, stop + 1);
  }
  
  async publish(channel: string, message: string): Promise<number> {
    return 0; // No subscribers in tests
  }
  
  // For testing only
  getData(): Record<string, any> {
    return this.data;
  }
  
  clear(): void {
    this.data = {};
  }
}

describe('Agent Health Manager', () => {
  let mockRedis: MockRedis;
  let trustService: TrustScoreService;
  let healthManager: AgentHealthManager;
  
  beforeEach(() => {
    mockRedis = new MockRedis();
    trustService = new TrustScoreService(mockRedis as any);
    healthManager = new AgentHealthManager(trustService, mockRedis as any);
    mockRedis.clear(); // Clear any previous test data
  });
  
  test('should detect normal health mode for agent with good trust score', async () => {
    // Set a good trust score (above HEALING_THRESHOLD)
    await mockRedis.set('agent:test-agent:trust_score', '80');
    
    // Get health adjustments
    const adjustments = await healthManager.getHealthAdjustments('test-agent');
    
    // Agent should be in NORMAL mode with standard settings
    expect(adjustments.signalThrottleMultiplier).toBe(1.0);
    expect(adjustments.minConfidenceThreshold).toBe(0.5);
    expect(adjustments.isSuppressed).toBe(false);
    expect(adjustments.recoveryBoost).toBe(1.0);
  });
  
  test('should detect self-healing mode for agent with low trust score', async () => {
    // Set a trust score in self-healing range
    await mockRedis.set('agent:test-agent:trust_score', '30');
    
    // Get health adjustments
    const adjustments = await healthManager.getHealthAdjustments('test-agent');
    
    // Agent should be in SELF_HEALING mode with restricted settings
    expect(adjustments.signalThrottleMultiplier).toBe(0.5);
    expect(adjustments.minConfidenceThreshold).toBe(0.85);
    expect(adjustments.isSuppressed).toBe(false);
    expect(adjustments.recoveryBoost).toBe(2.0);
  });
  
  test('should detect critical mode for agent with very low trust score', async () => {
    // Set a very low trust score
    await mockRedis.set('agent:test-agent:trust_score', '10');
    
    // Get health adjustments
    const adjustments = await healthManager.getHealthAdjustments('test-agent');
    
    // Agent should be in CRITICAL mode with highly restricted settings
    expect(adjustments.signalThrottleMultiplier).toBe(0.1);
    expect(adjustments.minConfidenceThreshold).toBe(0.95);
    expect(adjustments.isSuppressed).toBe(true);
    expect(adjustments.recoveryBoost).toBe(3.0);
  });
  
  test('should apply recovery boost for agent in self-healing mode', async () => {
    // Set a trust score in self-healing range
    await mockRedis.set('agent:test-agent:trust_score', '30');
    
    // Record a successful operation
    const newScore = await healthManager.recordHealingSuccess('test-agent');
    
    // Trust should be increased by the boost amount (0.5 * 2.0 = 1.0)
    expect(newScore).toBe(31);
    
    // Should have recorded success count
    const successCount = await mockRedis.hget('agent:test-agent:trust_meta', 'healing_success_count');
    expect(successCount).toBe('1');
  });
  
  test('should not apply recovery boost for agent in normal mode', async () => {
    // Set a good trust score
    await mockRedis.set('agent:test-agent:trust_score', '80');
    
    // Record a successful operation
    const newScore = await healthManager.recordHealingSuccess('test-agent');
    
    // Trust should remain unchanged
    expect(newScore).toBe(80);
    
    // Should not have recorded success count
    const successCount = await mockRedis.hget('agent:test-agent:trust_meta', 'healing_success_count');
    expect(successCount).toBeNull();
  });
  
  test('should apply greater penalty for failures during self-healing', async () => {
    // Set a trust score in self-healing range
    await mockRedis.set('agent:test-agent:trust_score', '30');
    
    // Record a failure with 0.5 severity
    const newScore = await healthManager.recordFailure('test-agent', 0.5);
    
    // Trust should be reduced by the penalty amount with 1.5x multiplier (0.5 * 1.5 = 0.75)
    expect(newScore).toBe(29.25);
  });
  
  test('should auto-recover agent after meeting recovery criteria', async () => {
    // Set up test to simulate time
    jest.useFakeTimers();
    
    const realDateNow = Date.now;
    const currentTime = 1600000000000; // Fixed timestamp
    global.Date.now = jest.fn(() => currentTime);
    
    // Set a trust score in self-healing range
    await mockRedis.set('agent:test-agent:trust_score', '30');
    
    // Manually set the agent as having been in self-healing mode for long enough
    const enteredAt = currentTime - 20 * 60 * 1000; // 20 minutes ago
    await mockRedis.hset('agent:test-agent:trust_meta', 'enteredSelfHealingAt', enteredAt.toString());
    
    // Increase score to above threshold
    await mockRedis.set('agent:test-agent:trust_score', '40');
    
    // Simulate enough successful operations
    await mockRedis.hset('agent:test-agent:trust_meta', 'healing_success_count', '4');
    
    // Record one more success (making 5 total)
    await healthManager.recordHealingSuccess('test-agent');
    
    // The agent should have been recovered, so healing metadata should be cleared
    const enteredMetadata = await mockRedis.hget('agent:test-agent:trust_meta', 'enteredSelfHealingAt');
    expect(enteredMetadata).toBeNull();
    
    // Cleanup
    jest.useRealTimers();
    global.Date.now = realDateNow;
  });
  
  test('should not recover agent before meeting all criteria', async () => {
    // Set up test to simulate time
    jest.useFakeTimers();
    
    const realDateNow = Date.now;
    const currentTime = 1600000000000; // Fixed timestamp
    global.Date.now = jest.fn(() => currentTime);
    
    // Set a trust score in self-healing range
    await mockRedis.set('agent:test-agent:trust_score', '30');
    
    // Set the agent as having been in self-healing mode for NOT long enough
    const enteredAt = currentTime - 5 * 60 * 1000; // Only 5 minutes ago
    await mockRedis.hset('agent:test-agent:trust_meta', 'enteredSelfHealingAt', enteredAt.toString());
    
    // Increase score to above threshold
    await mockRedis.set('agent:test-agent:trust_score', '40');
    
    // Simulate successful operations
    await mockRedis.hset('agent:test-agent:trust_meta', 'healing_success_count', '5');
    
    // Run recovery check
    await healthManager['checkRecoveryEligibility']('test-agent', 5);
    
    // Should not recover yet due to insufficient time
    const enteredMetadata = await mockRedis.hget('agent:test-agent:trust_meta', 'enteredSelfHealingAt');
    expect(enteredMetadata).toBe(enteredAt.toString());
    
    // Cleanup
    jest.useRealTimers();
    global.Date.now = realDateNow;
  });
}); 
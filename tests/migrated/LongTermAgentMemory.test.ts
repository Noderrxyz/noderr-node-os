/**
 * Tests for LongTermAgentMemory service
 */

import { LongTermAgentMemory, EvolvedAgentSnapshot } from '../LongTermAgentMemory';
import { RedisService } from '../../redis/RedisService.js';
import { EvaluationResult } from '../../evolution/evaluation/EvaluationResult.js';
import { TradingStrategy, createDefaultStrategy } from '../../evolution/mutation/strategy-model.js';
import { MEMORY_INJECTION_CONFIG } from '../../../config/agent_meta_rewards.config.js';
import { v4 as uuidv4 } from 'uuid';

// Mock Redis service
const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  keys: jest.fn(),
  zadd: jest.fn(),
  zrevrange: jest.fn(),
  del: jest.fn(),
  zrem: jest.fn()
};

const mockRedisService = {
  redis: mockRedis
} as unknown as RedisService;

// Mock trust score service
const mockTrustScoreService = {
  getAgentTrustScore: jest.fn(),
  getViolationCount: jest.fn()
};

// Helper to create mock evaluation results
function createMockEvaluationResult(agentId: string, strategyId: string, fitnessScore: number): EvaluationResult {
  return {
    agentId,
    strategyId,
    sharpe: 1.5,
    maxDrawdown: 0.1,
    winRate: 0.65,
    volatilityResilience: 0.8,
    regretIndex: 0.05,
    fitnessScore,
    passed: true,
    timestamp: Date.now(),
    generationId: `gen-${uuidv4()}`,
    mutationType: 'PARAMETER_TUNING',
    rawMetrics: {
      totalReturn: 0.25,
      tradeCount: 52,
      avgProfit: 0.015,
      profitFactor: 2.5,
      marketExposure: 0.6,
      recoveryFactor: 3.2
    }
  };
}

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});

describe('LongTermAgentMemory', () => {
  let memoryService: LongTermAgentMemory;
  
  beforeEach(() => {
    memoryService = new LongTermAgentMemory(
      mockRedisService,
      mockTrustScoreService,
      {
        topN: 3,
        persistThreshold: 0.8,
        highRankingThreshold: 0.9
      }
    );
  });
  
  describe('injectAgentMemorySnapshot', () => {
    it('should store agent snapshot in Redis with proper TTL', async () => {
      // Arrange
      const snapshot: EvolvedAgentSnapshot = {
        id: uuidv4(),
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        strategyHash: 'hash123',
        rewardScore: 0.95,
        fitnessScore: 0.95,
        trustScore: 0.85,
        violationCount: 0,
        epochHistory: [{
          epochId: 'epoch-1',
          timestamp: Date.now(),
          score: 0.95
        }],
        traits: {
          performanceMetrics: {
            sharpe: 1.8,
            maxDrawdown: 0.08
          },
          marketConditions: ['trending', 'volatile'],
          specializations: ['crypto', 'stocks']
        },
        strategy: {
          id: 'strategy-456',
          name: 'Test Strategy',
          version: '1.0'
        },
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        generationId: 'gen-1',
        evolutionMetadata: {
          mutationHistory: ['PARAMETER_TUNING'],
          parentAgentIds: [],
          iterationConsistency: 2,
          description: 'Test strategy description'
        },
        memoryTags: ['evolution', 'long_term'],
        performanceCategory: 'exceptional',
        ttlMs: null // Indefinite storage
      };
      
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.zadd.mockResolvedValue(1);
      
      // Act
      const result = await memoryService.injectAgentMemorySnapshot(snapshot);
      
      // Assert
      expect(result).toBe(snapshot.id);
      expect(mockRedis.set).toHaveBeenCalledTimes(2); // Agent key and hash key
      expect(mockRedis.zadd).toHaveBeenCalledTimes(3); // Score index and 2 market conditions
      
      // Check agent storage call
      const setCall = mockRedis.set.mock.calls[0];
      expect(setCall[0]).toContain('agent-123');
      expect(setCall[1]).toContain(snapshot.id);
      expect(setCall[2]).toBe(null); // No expiration option for null ttl
      
      // Check market condition indexing
      const zaddCalls = mockRedis.zadd.mock.calls;
      expect(zaddCalls[1][0]).toContain('trending');
      expect(zaddCalls[2][0]).toContain('volatile');
    });
    
    it('should handle TTL for low-ranking agents', async () => {
      // Arrange
      const snapshot: EvolvedAgentSnapshot = {
        // Same as above, but for low-ranking agent
        id: uuidv4(),
        agentId: 'agent-789',
        strategyId: 'strategy-101',
        strategyHash: 'hash456',
        rewardScore: 0.81,
        fitnessScore: 0.81,
        trustScore: 0.75,
        violationCount: 0,
        epochHistory: [{
          epochId: 'epoch-1',
          timestamp: Date.now(),
          score: 0.81
        }],
        traits: {
          performanceMetrics: {
            sharpe: 1.2,
            maxDrawdown: 0.12
          },
          marketConditions: ['sideways'],
          specializations: ['forex']
        },
        strategy: {
          id: 'strategy-101',
          name: 'Low Ranking Strategy',
          version: '1.0'
        },
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        generationId: 'gen-2',
        evolutionMetadata: {
          mutationHistory: ['PARAMETER_TUNING'],
          parentAgentIds: [],
          iterationConsistency: 1,
          description: 'Low ranking strategy'
        },
        memoryTags: ['evolution', 'long_term'],
        performanceCategory: 'low',
        ttlMs: 60 * 24 * 60 * 60 * 1000 // 60 days in ms
      };
      
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.zadd.mockResolvedValue(1);
      
      // Act
      const result = await memoryService.injectAgentMemorySnapshot(snapshot);
      
      // Assert
      expect(result).toBe(snapshot.id);
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      
      // Verify TTL was passed
      const setCall = mockRedis.set.mock.calls[0];
      expect(setCall[2]).toBe('PX'); // PX option for ms TTL
      expect(setCall[3]).toBe(snapshot.ttlMs); // TTL value passed
    });
    
    it('should handle errors during storage', async () => {
      // Arrange
      const snapshot: EvolvedAgentSnapshot = {
        // Minimal snapshot for error testing
        id: uuidv4(),
        agentId: 'agent-error',
        strategyId: 'strategy-error',
        strategyHash: 'error-hash',
        rewardScore: 0.9,
        fitnessScore: 0.9,
        trustScore: null,
        violationCount: 0,
        epochHistory: [],
        traits: {
          performanceMetrics: {},
          marketConditions: [],
          specializations: []
        },
        strategy: null,
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
        generationId: 'gen-error',
        evolutionMetadata: {
          mutationHistory: [],
          parentAgentIds: [],
          iterationConsistency: 1,
          description: 'Error test'
        },
        memoryTags: [],
        performanceCategory: 'medium',
        ttlMs: null
      };
      
      // Simulate Redis error
      mockRedis.set.mockRejectedValue(new Error('Redis connection error'));
      
      // Act
      const result = await memoryService.injectAgentMemorySnapshot(snapshot);
      
      // Assert
      expect(result).toBeNull();
    });
  });
  
  describe('createAgentSnapshot', () => {
    it('should create a properly formatted snapshot from evaluation results', async () => {
      // Arrange
      const agentId = 'agent-create-test';
      const strategyId = 'strategy-create-test';
      const strategy = createDefaultStrategy(strategyId);
      strategy.name = 'Test Strategy';
      strategy.version = '2.0';
      strategy.description = 'Strategy for testing';
      strategy.marketConditions = ['trending', 'low_volatility'];
      strategy.assetClasses = ['crypto'];
      
      const evalResult = createMockEvaluationResult(agentId, strategyId, 0.92);
      
      mockTrustScoreService.getAgentTrustScore.mockResolvedValue(0.95);
      mockTrustScoreService.getViolationCount.mockResolvedValue(0);
      
      // Act
      const snapshot = await memoryService.createAgentSnapshot(agentId, evalResult, strategy);
      
      // Assert
      expect(snapshot).toBeDefined();
      expect(snapshot.agentId).toBe(agentId);
      expect(snapshot.strategyId).toBe(strategyId);
      expect(snapshot.fitnessScore).toBe(0.92);
      expect(snapshot.trustScore).toBe(0.95);
      expect(snapshot.violationCount).toBe(0);
      expect(snapshot.performanceCategory).toBe('exceptional');
      expect(snapshot.ttlMs).toBeNull(); // Exceptional should have null TTL
      expect(snapshot.traits.marketConditions).toEqual(['trending', 'low_volatility']);
      expect(snapshot.traits.specializations).toEqual(['crypto']);
      expect(snapshot.traits.performanceMetrics.sharpe).toBe(evalResult.sharpe);
      expect(snapshot.evolutionMetadata.description).toContain('Test Strategy v2.0');
      expect(snapshot.memoryTags).toContain('evolution');
      expect(snapshot.memoryTags).toContain('long_term');
    });
    
    it('should handle missing trust score service gracefully', async () => {
      // Arrange
      const serviceWithoutTrust = new LongTermAgentMemory(
        mockRedisService, 
        null // No trust score service
      );
      
      const agentId = 'agent-no-trust';
      const strategyId = 'strategy-no-trust';
      const strategy = createDefaultStrategy(strategyId);
      const evalResult = createMockEvaluationResult(agentId, strategyId, 0.85);
      
      // Act
      const snapshot = await serviceWithoutTrust.createAgentSnapshot(agentId, evalResult, strategy);
      
      // Assert
      expect(snapshot).toBeDefined();
      expect(snapshot.agentId).toBe(agentId);
      expect(snapshot.trustScore).toBeNull();
      expect(snapshot.performanceCategory).toBe('medium'); // Based on fitness score only
    });
  });
  
  describe('persistTopPerformers', () => {
    it('should persist only agents that meet threshold criteria', async () => {
      // Arrange
      const agentEvaluations = new Map<string, EvaluationResult[]>();
      const agentStrategies = new Map<string, TradingStrategy>();
      
      // Agent 1 with high scores
      const agent1 = 'agent-high';
      const strategy1a = createDefaultStrategy('strategy-1a');
      strategy1a.marketConditions = ['trending'];
      const strategy1b = createDefaultStrategy('strategy-1b');
      strategy1b.marketConditions = ['volatile'];
      
      const eval1a = createMockEvaluationResult(agent1, 'strategy-1a', 0.95);
      const eval1b = createMockEvaluationResult(agent1, 'strategy-1b', 0.92);
      const eval1c = createMockEvaluationResult(agent1, 'strategy-1c', 0.90); // Strategy will be missing
      
      agentEvaluations.set(agent1, [eval1a, eval1b, eval1c]);
      agentStrategies.set('strategy-1a', strategy1a);
      agentStrategies.set('strategy-1b', strategy1b);
      
      // Agent 2 with low scores
      const agent2 = 'agent-low';
      const strategy2 = createDefaultStrategy('strategy-2');
      const eval2 = createMockEvaluationResult(agent2, 'strategy-2', 0.75); // Below threshold
      
      agentEvaluations.set(agent2, [eval2]);
      agentStrategies.set('strategy-2', strategy2);
      
      // Agent 3 with mix of scores
      const agent3 = 'agent-mixed';
      const strategy3a = createDefaultStrategy('strategy-3a');
      const strategy3b = createDefaultStrategy('strategy-3b');
      
      const eval3a = createMockEvaluationResult(agent3, 'strategy-3a', 0.82);
      const eval3b = createMockEvaluationResult(agent3, 'strategy-3b', 0.88);
      
      agentEvaluations.set(agent3, [eval3a, eval3b]);
      agentStrategies.set('strategy-3a', strategy3a);
      agentStrategies.set('strategy-3b', strategy3b);
      
      // Mock trust score and successful snapshot creation
      mockTrustScoreService.getAgentTrustScore.mockResolvedValue(0.8);
      mockTrustScoreService.getViolationCount.mockResolvedValue(0);
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.zadd.mockResolvedValue(1);
      
      // Spy on injectAgentMemorySnapshot
      const injectSpy = jest.spyOn(memoryService, 'injectAgentMemorySnapshot');
      injectSpy.mockResolvedValue(uuidv4());
      
      // Act
      const persistedCount = await memoryService.persistTopPerformers(agentEvaluations, agentStrategies);
      
      // Assert
      expect(persistedCount).toBe(4); // 2 from agent1 + 2 from agent3
      expect(injectSpy).toHaveBeenCalledTimes(4);
      
      // Verify agent1's strategies were both persisted
      const snapshots = injectSpy.mock.calls.map(call => call[0]);
      const persistedStrategyIds = snapshots.map(s => s.strategyId);
      
      expect(persistedStrategyIds).toContain('strategy-1a');
      expect(persistedStrategyIds).toContain('strategy-1b');
      expect(persistedStrategyIds).toContain('strategy-3a');
      expect(persistedStrategyIds).toContain('strategy-3b');
      expect(persistedStrategyIds).not.toContain('strategy-2'); // Below threshold
      expect(persistedStrategyIds).not.toContain('strategy-1c'); // Missing strategy
      
      // Clean up spy
      injectSpy.mockRestore();
    });
    
    it('should filter out agents with violations if requireZeroViolations is enabled', async () => {
      // Arrange
      const agentEvaluations = new Map<string, EvaluationResult[]>();
      const agentStrategies = new Map<string, TradingStrategy>();
      
      // Agent with violations
      const agentWithViolations = 'agent-violations';
      const strategy = createDefaultStrategy('strategy-v');
      const evaluation = createMockEvaluationResult(agentWithViolations, 'strategy-v', 0.95);
      
      agentEvaluations.set(agentWithViolations, [evaluation]);
      agentStrategies.set('strategy-v', strategy);
      
      // Configure violations
      mockTrustScoreService.getAgentTrustScore.mockResolvedValue(0.7);
      mockTrustScoreService.getViolationCount.mockResolvedValue(2); // Has violations
      
      // Act
      const persistedCount = await memoryService.persistTopPerformers(agentEvaluations, agentStrategies);
      
      // Assert
      expect(persistedCount).toBe(0); // None persisted due to violations
      expect(mockTrustScoreService.getViolationCount).toHaveBeenCalledWith(agentWithViolations);
    });
  });
  
  describe('retrieving snapshots', () => {
    it('should retrieve agent snapshots by agent ID', async () => {
      // Arrange
      const agentId = 'agent-retrieve';
      const keys = [
        `${MEMORY_INJECTION_CONFIG.redisKeyPrefix}:agent:${agentId}:mem1`,
        `${MEMORY_INJECTION_CONFIG.redisKeyPrefix}:agent:${agentId}:mem2`
      ];
      
      const snapshot1 = {
        id: 'mem1',
        agentId,
        rewardScore: 0.9,
        /* other fields would be here */
      };
      
      const snapshot2 = {
        id: 'mem2',
        agentId,
        rewardScore: 0.95,
        /* other fields would be here */
      };
      
      mockRedis.keys.mockResolvedValue(keys);
      mockRedis.get.mockImplementation((key) => {
        if (key.endsWith('mem1')) return Promise.resolve(JSON.stringify(snapshot1));
        if (key.endsWith('mem2')) return Promise.resolve(JSON.stringify(snapshot2));
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryService.getAgentSnapshots(agentId);
      
      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mem2'); // Higher score should be first
      expect(result[1].id).toBe('mem1');
      expect(mockRedis.keys).toHaveBeenCalledWith(expect.stringContaining(agentId));
    });
    
    it('should retrieve top performing snapshots across all agents', async () => {
      // Arrange
      mockRedis.zrevrange.mockResolvedValue([
        'agent1:mem1', '0.98',
        'agent2:mem2', '0.95',
        'agent1:mem3', '0.90'
      ]);
      
      const snapshot1 = { id: 'mem1', agentId: 'agent1', rewardScore: 0.98 };
      const snapshot2 = { id: 'mem2', agentId: 'agent2', rewardScore: 0.95 };
      const snapshot3 = { id: 'mem3', agentId: 'agent1', rewardScore: 0.90 };
      
      mockRedis.get.mockImplementation((key) => {
        if (key.includes('mem1')) return Promise.resolve(JSON.stringify(snapshot1));
        if (key.includes('mem2')) return Promise.resolve(JSON.stringify(snapshot2));
        if (key.includes('mem3')) return Promise.resolve(JSON.stringify(snapshot3));
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryService.getTopPerformingSnapshots(3);
      
      // Assert
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('mem1');
      expect(result[1].id).toBe('mem2');
      expect(result[2].id).toBe('mem3');
      expect(mockRedis.zrevrange).toHaveBeenCalledWith(
        expect.stringContaining('index:by_score'),
        0,
        2,
        'WITHSCORES'
      );
    });
    
    it('should retrieve snapshots by market condition', async () => {
      // Arrange
      const marketCondition = 'trending';
      mockRedis.zrevrange.mockResolvedValue(['agent1:mem1', 'agent2:mem2']);
      
      const snapshot1 = { 
        id: 'mem1', 
        agentId: 'agent1', 
        traits: { marketConditions: ['trending', 'volatile'] } 
      };
      
      const snapshot2 = { 
        id: 'mem2', 
        agentId: 'agent2', 
        traits: { marketConditions: ['trending'] } 
      };
      
      mockRedis.get.mockImplementation((key) => {
        if (key.includes('mem1')) return Promise.resolve(JSON.stringify(snapshot1));
        if (key.includes('mem2')) return Promise.resolve(JSON.stringify(snapshot2));
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryService.getSnapshotsByMarketCondition(marketCondition);
      
      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('mem1');
      expect(result[1].id).toBe('mem2');
      expect(mockRedis.zrevrange).toHaveBeenCalledWith(
        expect.stringContaining(`market:${marketCondition}`),
        0,
        9,
        undefined
      );
    });
  });
  
  describe('deleteAgentSnapshot', () => {
    it('should delete snapshot and all references', async () => {
      // Arrange
      const agentId = 'agent-delete';
      const memoryId = 'mem-delete';
      
      const snapshot = {
        id: memoryId,
        agentId,
        strategyId: 'strategy-delete',
        strategyHash: 'hash-delete',
        traits: {
          marketConditions: ['trending', 'volatile']
        }
      };
      
      mockRedis.get.mockResolvedValue(JSON.stringify(snapshot));
      mockRedis.del.mockResolvedValue(1);
      mockRedis.zrem.mockResolvedValue(1);
      
      // Act
      const result = await memoryService.deleteAgentSnapshot(agentId, memoryId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledTimes(2); // Agent key and hash key
      expect(mockRedis.zrem).toHaveBeenCalledTimes(3); // Main index + 2 market conditions
      
      // Verify correct keys were deleted
      const delCalls = mockRedis.del.mock.calls;
      expect(delCalls[0][0]).toContain(`agent:${agentId}:${memoryId}`);
      expect(delCalls[1][0]).toContain(`hash:${snapshot.strategyHash}`);
      
      // Verify market condition indexes were cleaned up
      const zremCalls = mockRedis.zrem.mock.calls;
      expect(zremCalls[1][0]).toContain('market:trending');
      expect(zremCalls[2][0]).toContain('market:volatile');
    });
    
    it('should handle missing snapshot gracefully', async () => {
      // Arrange
      mockRedis.get.mockResolvedValue(null);
      
      // Act
      const result = await memoryService.deleteAgentSnapshot('nonexistent', 'missing');
      
      // Assert
      expect(result).toBe(false);
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(mockRedis.zrem).not.toHaveBeenCalled();
    });
  });
}); 
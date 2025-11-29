/**
 * Unit tests for Evolution Graph Engine
 */

// Add Jest type declaration
declare const jest: any;
declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const afterEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: any;

import { v4 as uuidv4 } from 'uuid';
import { createMockRedisClient } from '../../../common/redis.js';
import { PostgresService } from '../../infrastructure/PostgresService.js';
import { EvolutionGraphEngine, recordMutation, getLineage } from '../EvolutionGraphEngine.js';
import { MutationType, PerformanceMetrics } from '../types.js';

// Mock PostgresService
jest.mock('../../infrastructure/PostgresService.js', () => {
  return {
    PostgresService: jest.fn().mockImplementation(() => {
      return {
        initialize: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockImplementation((text: string, params: any[]) => {
          // For testing getLineage
          if (text.includes('SELECT') && text.includes('FROM strategy_evolution_log')) {
            return Promise.resolve({
              rows: [
                {
                  id: 'record1',
                  agentId: 'agent1',
                  strategyId: 'strategy1',
                  parentStrategyId: null,
                  mutationType: MutationType.GENESIS,
                  performanceSnapshot: { sharpe: 1.5, winRate: 0.65 },
                  timestamp: 1600000000000
                },
                {
                  id: 'record2',
                  agentId: 'agent1',
                  strategyId: 'strategy2',
                  parentStrategyId: 'strategy1',
                  mutationType: MutationType.PARAMETER_TUNING,
                  performanceSnapshot: { sharpe: 1.8, winRate: 0.7 },
                  timestamp: 1600001000000
                }
              ]
            });
          }
          
          // For testing getLatestMetrics
          if (text.includes('SELECT metric_type, value FROM evolution_metrics')) {
            return Promise.resolve({
              rows: [
                { metric_type: 'sharpe', value: 1.8 },
                { metric_type: 'winRate', value: 0.7 }
              ]
            });
          }
          
          // For all other queries (e.g., inserts)
          return Promise.resolve({ rows: [] });
        })
      };
    })
  };
});

// Mock uuidv4 for predictable IDs
jest.mock('uuid', () => {
  return {
    v4: () => 'mock-uuid'
  };
});

describe('EvolutionGraphEngine', () => {
  let engine: EvolutionGraphEngine;
  let redisClient: any;
  let postgresService: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mocks
    redisClient = createMockRedisClient();
    postgresService = new PostgresService();
    
    // Mock current time for predictable timestamps
    jest.spyOn(Date, 'now').mockImplementation(() => 1600001000000);
    
    // Create engine instance
    engine = new EvolutionGraphEngine(redisClient, postgresService);
    EvolutionGraphEngine.instance = engine;
  });
  
  afterEach(() => {
    EvolutionGraphEngine.instance = null;
  });
  
  describe('recordMutation', () => {
    it('should record a mutation successfully', async () => {
      // Prepare test data
      const agentId = 'agent1';
      const strategyId = 'strategy2';
      const parentStrategyId = 'strategy1';
      const mutationType = MutationType.PARAMETER_TUNING;
      const performanceMetrics: PerformanceMetrics = {
        sharpe: 1.8,
        winRate: 0.7
      };
      
      // Call method
      const result = await engine.recordMutation(
        agentId,
        strategyId,
        parentStrategyId,
        mutationType,
        performanceMetrics
      );
      
      // Verify results
      expect(result).toEqual({
        id: 'mock-uuid',
        agentId,
        strategyId,
        parentStrategyId,
        mutationType,
        performanceSnapshot: performanceMetrics,
        timestamp: 1600001000000
      });
      
      // Verify PostgreSQL query was called
      expect(postgresService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO strategy_evolution_log'),
        [
          'mock-uuid',
          agentId,
          strategyId,
          parentStrategyId,
          mutationType,
          JSON.stringify(performanceMetrics),
          new Date(1600001000000)
        ]
      );
      
      // Verify Redis operations
      expect(redisClient.lpush).toHaveBeenCalledWith(
        `evolution:graph:${agentId}`,
        expect.any(String)
      );
      expect(redisClient.ltrim).toHaveBeenCalledWith(
        `evolution:graph:${agentId}`,
        0,
        99
      );
      expect(redisClient.set).toHaveBeenCalledWith(
        `evolution:latest:${agentId}`,
        strategyId
      );
    });
    
    it('should record a genesis mutation without parent ID', async () => {
      // Prepare test data
      const agentId = 'agent1';
      const strategyId = 'strategy1';
      const mutationType = MutationType.GENESIS;
      const performanceMetrics: PerformanceMetrics = {
        sharpe: 1.5,
        winRate: 0.65
      };
      
      // Call method
      const result = await engine.recordMutation(
        agentId,
        strategyId,
        undefined,
        mutationType,
        performanceMetrics
      );
      
      // Verify results
      expect(result.parentStrategyId).toBeUndefined();
      
      // Verify PostgreSQL query was called with null parentStrategyId
      expect(postgresService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO strategy_evolution_log'),
        expect.arrayContaining([null]) // parentStrategyId should be null
      );
    });
    
    it('should work with the standalone function', async () => {
      // Prepare test data
      const agentId = 'agent1';
      const strategyId = 'strategy2';
      const parentStrategyId = 'strategy1';
      const mutationType = MutationType.PARAMETER_TUNING;
      const performanceMetrics: PerformanceMetrics = {
        sharpe: 1.8,
        winRate: 0.7
      };
      
      // Spy on engine method
      const recordMutationSpy = jest.spyOn(engine, 'recordMutation');
      
      // Call standalone function
      await recordMutation(
        agentId,
        strategyId,
        parentStrategyId,
        mutationType,
        performanceMetrics
      );
      
      // Verify engine method was called with correct params
      expect(recordMutationSpy).toHaveBeenCalledWith(
        agentId,
        strategyId,
        parentStrategyId,
        mutationType,
        performanceMetrics,
        undefined
      );
    });
  });
  
  describe('getLineage', () => {
    it('should retrieve the complete evolution graph', async () => {
      // Prepare test data
      const agentId = 'agent1';
      
      // Call method
      const result = await engine.getLineage(agentId);
      
      // Verify results
      expect(result).toEqual({
        agentId,
        nodes: [
          {
            id: 'record1',
            agentId: 'agent1',
            strategyId: 'strategy1',
            parentStrategyId: null,
            mutationType: MutationType.GENESIS,
            performanceSnapshot: { sharpe: 1.5, winRate: 0.65 },
            timestamp: 1600000000000
          },
          {
            id: 'record2',
            agentId: 'agent1',
            strategyId: 'strategy2',
            parentStrategyId: 'strategy1',
            mutationType: MutationType.PARAMETER_TUNING,
            performanceSnapshot: { sharpe: 1.8, winRate: 0.7 },
            timestamp: 1600001000000
          }
        ],
        edges: [
          {
            source: 'strategy1',
            target: 'strategy2',
            mutationType: MutationType.PARAMETER_TUNING,
            timestamp: 1600001000000
          }
        ]
      });
      
      // Verify PostgreSQL query was called
      expect(postgresService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [agentId]
      );
    });
    
    it('should work with the standalone function', async () => {
      // Prepare test data
      const agentId = 'agent1';
      
      // Spy on engine method
      const getLineageSpy = jest.spyOn(engine, 'getLineage');
      
      // Call standalone function
      await getLineage(agentId);
      
      // Verify engine method was called with correct params
      expect(getLineageSpy).toHaveBeenCalledWith(agentId);
    });
  });
}); 
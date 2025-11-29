/**
 * Tests for the RewardPropagator class
 */

import { RewardPropagator } from '../RewardPropagator.js';
import { ReinforcementLog, type ReinforcementEvent } from '../../ReinforcementLog.js';
import { InfluenceGraph } from '../../InfluenceGraph.js';

// Create a mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock Logger module
jest.mock('../../../../utils/logger.js', () => ({
  __esModule: true,
  default: {
    getInstance: () => mockLogger
  }
}));

// Create a mock InfluenceGraph
const mockGraph = {
  addEdge: jest.fn(),
  getNodes: jest.fn(),
  getInfluencers: jest.fn(),
  getTargets: jest.fn(),
  getEdgeWeight: jest.fn(),
  getTotalInfluenceWeight: jest.fn(),
  createAdjacencyMap: jest.fn(),
  detectCircularInfluence: jest.fn()
};

// Mock ReinforcementLog
jest.mock('../../ReinforcementLog.js', () => ({
  ReinforcementLog: jest.fn().mockImplementation(() => ({
    record: jest.fn().mockImplementation((event) => ({
      id: 'mocked-event-id',
      timestamp: Date.now(),
      ...event
    })),
    getAll: jest.fn().mockReturnValue([]),
    getByAgent: jest.fn().mockReturnValue([]),
    getBySourceAgent: jest.fn().mockReturnValue([]),
    getByTargetAgent: jest.fn().mockReturnValue([]),
    getByTags: jest.fn().mockReturnValue([]),
    pruneExpired: jest.fn(),
    toGraph: jest.fn().mockReturnValue(mockGraph)
  }))
}));

// Mock InfluenceGraph
jest.mock('../../InfluenceGraph.js', () => ({
  InfluenceGraph: jest.fn().mockImplementation(() => mockGraph)
}));

describe('RewardPropagator', () => {
  let reinforcementLog: ReinforcementLog;
  let rewardPropagator: RewardPropagator;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup test objects
    reinforcementLog = new ReinforcementLog();
    rewardPropagator = new RewardPropagator(reinforcementLog);
    
    // Setup default mock behavior
    mockGraph.getInfluencers.mockReturnValue([]);
  });
  
  test('should initialize with default configuration when none provided', () => {
    const defaultPropagator = new RewardPropagator(reinforcementLog);
    
    expect(defaultPropagator).toBeDefined();
    expect(defaultPropagator.getConfig()).toEqual({
      decayFactor: 0.85,
      maxDepth: 3,
      minWeightThreshold: 0.01,
      reasonPrefix: 'propagated',
      maxBreadth: 5
    });
  });
  
  test('should update configuration correctly', () => {
    const initialConfig = rewardPropagator.getConfig();
    expect(initialConfig.decayFactor).toBe(0.85);
    
    rewardPropagator.updateConfig({ decayFactor: 0.5 });
    
    const updatedConfig = rewardPropagator.getConfig();
    expect(updatedConfig.decayFactor).toBe(0.5);
    expect(updatedConfig.maxDepth).toBe(initialConfig.maxDepth); // Should retain original value
  });
  
  test('should not propagate with invalid event', () => {
    rewardPropagator.propagate(undefined as unknown as ReinforcementEvent);
    
    expect(mockLogger.warn).toHaveBeenCalledWith('Cannot propagate from invalid event');
    expect(reinforcementLog.toGraph).not.toHaveBeenCalled();
  });
  
  test('should propagate rewards to influencers', () => {
    // Setup mock influencers
    mockGraph.getInfluencers.mockReturnValue([
      { agentId: 'agent-123', weight: 0.8 },
      { agentId: 'agent-456', weight: 0.5 }
    ]);
    
    // Create a test event
    const testEvent: ReinforcementEvent = {
      id: 'source-event',
      timestamp: Date.now(),
      sourceAgent: 'system',
      targetAgent: 'agent-789',
      reason: 'test reason',
      weight: 10,
      decayTTL: 1000 * 60 * 60 * 24, // 1 day
      tags: ['test']
    };
    
    // Propagate the reward
    rewardPropagator.propagate(testEvent);
    
    // Check that the graph was created
    expect(reinforcementLog.toGraph).toHaveBeenCalled();
    
    // Check that influencers were retrieved
    expect(mockGraph.getInfluencers).toHaveBeenCalledWith('agent-789');
    
    // Check that two new reinforcement events were recorded (one for each influencer)
    expect(reinforcementLog.record).toHaveBeenCalledTimes(2);
    
    // Check the first propagated event
    expect(reinforcementLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'agent-789',
        targetAgent: 'agent-123',
        reason: 'propagated: test reason',
        weight: 8.5, // 10 * 0.85
        tags: ['propagated']
      })
    );
    
    // Check the second propagated event
    expect(reinforcementLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'agent-789',
        targetAgent: 'agent-456',
        reason: 'propagated: test reason',
        weight: 8.5, // 10 * 0.85
        tags: ['propagated']
      })
    );
  });
  
  test('should respect max depth during propagation', () => {
    // Configure the propagator with a max depth of 1
    rewardPropagator.updateConfig({ maxDepth: 1 });
    
    // Setup first level influencers
    mockGraph.getInfluencers.mockReturnValueOnce([
      { agentId: 'level1-agent', weight: 1.0 }
    ]);
    
    // Setup second level influencers (these should NOT be propagated to)
    mockGraph.getInfluencers.mockReturnValueOnce([
      { agentId: 'level2-agent', weight: 1.0 }
    ]);
    
    // Create a test event
    const testEvent: ReinforcementEvent = {
      id: 'source-event',
      timestamp: Date.now(),
      sourceAgent: 'system',
      targetAgent: 'root-agent',
      reason: 'test reason',
      weight: 10,
      decayTTL: 1000,
      tags: []
    };
    
    // Propagate the reward
    rewardPropagator.propagate(testEvent);
    
    // Should only create one propagated event (to level 1)
    expect(reinforcementLog.record).toHaveBeenCalledTimes(1);
    
    // Check that the level 1 propagation happened
    expect(reinforcementLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgent: 'root-agent',
        targetAgent: 'level1-agent'
      })
    );
  });
  
  test('should respect minWeightThreshold during propagation', () => {
    // Configure propagator with a high threshold
    rewardPropagator.updateConfig({ minWeightThreshold: 5 });
    
    // Setup influencers
    mockGraph.getInfluencers.mockReturnValue([
      { agentId: 'agent-low-weight', weight: 1.0 }
    ]);
    
    // Create a test event with weight below threshold after decay
    const testEvent: ReinforcementEvent = {
      id: 'source-event',
      timestamp: Date.now(),
      sourceAgent: 'system',
      targetAgent: 'root-agent',
      reason: 'test reason',
      weight: 5, // After decay: 5 * 0.85 = 4.25, which is < threshold
      decayTTL: 1000,
      tags: []
    };
    
    // Propagate the reward
    rewardPropagator.propagate(testEvent);
    
    // No propagation should occur due to threshold
    expect(reinforcementLog.record).not.toHaveBeenCalled();
  });
  
  test('should handle errors gracefully', () => {
    // Make toGraph throw an error
    (reinforcementLog.toGraph as jest.Mock).mockImplementation(() => {
      throw new Error('Test error');
    });
    
    // Create a test event
    const testEvent: ReinforcementEvent = {
      id: 'source-event',
      timestamp: Date.now(),
      sourceAgent: 'system',
      targetAgent: 'agent-789',
      reason: 'test reason',
      weight: 10,
      decayTTL: 1000,
      tags: []
    };
    
    // This should not throw
    expect(() => rewardPropagator.propagate(testEvent)).not.toThrow();
    
    // Error should be logged
    expect(mockLogger.error).toHaveBeenCalledWith('Error propagating reward:', expect.any(Error));
  });
}); 
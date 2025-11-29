/**
 * Unit tests for MemoryGraph service
 */

import { MemoryGraph } from '../MemoryGraph';
import { FusionFeedbackEvent } from '@noderr/types/memory.types';
import { v4 as uuidv4 } from 'uuid';

// Mock RedisService
const mockRedisService = {
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  publish: jest.fn(),
};

describe('MemoryGraph', () => {
  let memoryGraph: MemoryGraph;
  
  beforeEach(() => {
    jest.clearAllMocks();
    memoryGraph = new MemoryGraph(mockRedisService as any);
  });
  
  describe('addNode', () => {
    it('should store a valid memory node from a feedback event', async () => {
      // Arrange
      const event: FusionFeedbackEvent = {
        id: uuidv4(),
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        timestamp: Date.now(),
        eventType: 'trust',
        score: 0.8,
        contextTags: ['market:volatile', 'trend:bullish'],
      };
      
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      
      // Act
      const nodeId = await memoryGraph.addNode(event);
      
      // Assert
      expect(nodeId).toBe(event.id);
      expect(mockRedisService.setex).toHaveBeenCalledTimes(1);
      expect(mockRedisService.sadd).toHaveBeenCalledTimes(1);
      expect(mockRedisService.expire).toHaveBeenCalledTimes(1);
      
      // Verify node structure
      const setCall = mockRedisService.setex.mock.calls[0];
      expect(setCall[0]).toContain(`agent:memory:node:${event.id}`);
      const storedNode = JSON.parse(setCall[2]);
      expect(storedNode).toMatchObject({
        id: event.id,
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        trustScore: 0.8,
        reinforcementScore: 0,
        regretScore: 0,
        contextTags: ['market:volatile', 'trend:bullish'],
      });
    });
    
    it('should generate a new ID if none is provided', async () => {
      // Arrange
      const event: FusionFeedbackEvent = {
        id: '',
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        timestamp: Date.now(),
        eventType: 'reinforcement',
        score: 0.6,
        contextTags: ['asset:bitcoin'],
      };
      
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      
      // Act
      const nodeId = await memoryGraph.addNode({...event, id: ''});
      
      // Assert
      expect(nodeId).toBeTruthy();
      expect(nodeId).not.toBe(event.id);
      expect(mockRedisService.setex).toHaveBeenCalledTimes(1);
      
      // Verify node structure
      const setCall = mockRedisService.setex.mock.calls[0];
      const storedNode = JSON.parse(setCall[2]);
      expect(storedNode.reinforcementScore).toBe(0.6);
    });
    
    it('should store regret score for regret event type', async () => {
      // Arrange
      const event: FusionFeedbackEvent = {
        id: uuidv4(),
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        timestamp: Date.now(),
        eventType: 'regret',
        score: 0.9,
        contextTags: ['market:volatile', 'error:high'],
      };
      
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      
      // Act
      await memoryGraph.addNode(event);
      
      // Assert
      const setCall = mockRedisService.setex.mock.calls[0];
      const storedNode = JSON.parse(setCall[2]);
      expect(storedNode.regretScore).toBe(0.9);
      expect(storedNode.trustScore).toBe(0);
    });
    
    it('should link nodes if parent event ID is provided', async () => {
      // Arrange
      const parentId = uuidv4();
      const childId = uuidv4();
      
      const parentEvent: FusionFeedbackEvent = {
        id: parentId,
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        timestamp: Date.now() - 1000,
        eventType: 'trust',
        score: 0.8,
        contextTags: ['market:initial'],
      };
      
      const childEvent: FusionFeedbackEvent = {
        id: childId,
        agentId: 'agent-123',
        strategyId: 'strategy-456',
        timestamp: Date.now(),
        eventType: 'trust',
        score: 0.9,
        contextTags: ['market:follow-up'],
        parentEventId: parentId,
      };
      
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      mockRedisService.get.mockImplementation((key: string) => {
        if (key.includes(parentId)) {
          return Promise.resolve(JSON.stringify({
            id: parentId,
            agentId: 'agent-123',
            strategyId: 'strategy-456',
            trustScore: 0.8,
            children: []
          }));
        }
        if (key.includes(childId)) {
          return Promise.resolve(JSON.stringify({
            id: childId,
            agentId: 'agent-123',
            strategyId: 'strategy-456',
            trustScore: 0.9,
            children: []
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act
      await memoryGraph.addNode(parentEvent);
      await memoryGraph.addNode(childEvent);
      
      // Assert
      expect(mockRedisService.setex).toHaveBeenCalledTimes(3); // Parent, child, and updated parent
      
      // The last call should be to update the parent with a child reference
      const lastSetCall = mockRedisService.setex.mock.calls[2];
      const updatedParentNode = JSON.parse(lastSetCall[2]);
      expect(updatedParentNode.children).toContain(childId);
    });
  });
  
  describe('linkNodes', () => {
    it('should link two existing nodes', async () => {
      // Arrange
      const parentId = uuidv4();
      const childId = uuidv4();
      
      mockRedisService.get.mockImplementation((key: string) => {
        if (key.includes(parentId)) {
          return Promise.resolve(JSON.stringify({
            id: parentId,
            agentId: 'agent-123',
            strategyId: 'strategy-456',
            children: []
          }));
        }
        if (key.includes(childId)) {
          return Promise.resolve(JSON.stringify({
            id: childId,
            agentId: 'agent-123',
            strategyId: 'strategy-789',
            children: [],
            parentId: null
          }));
        }
        return Promise.resolve(null);
      });
      
      mockRedisService.setex.mockResolvedValue('OK');
      
      // Act
      const result = await memoryGraph.linkNodes(parentId, childId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRedisService.setex).toHaveBeenCalledTimes(2); // Update parent and child
      
      // Check parent update
      const parentUpdate = mockRedisService.setex.mock.calls[0];
      const updatedParent = JSON.parse(parentUpdate[2]);
      expect(updatedParent.children).toContain(childId);
      
      // Check child update
      const childUpdate = mockRedisService.setex.mock.calls[1];
      const updatedChild = JSON.parse(childUpdate[2]);
      expect(updatedChild.parentId).toBe(parentId);
    });
    
    it('should return false if parent node is not found', async () => {
      // Arrange
      const parentId = uuidv4();
      const childId = uuidv4();
      
      mockRedisService.get.mockImplementation((key: string) => {
        if (key.includes(parentId)) {
          return Promise.resolve(null); // Parent not found
        }
        if (key.includes(childId)) {
          return Promise.resolve(JSON.stringify({
            id: childId,
            agentId: 'agent-123',
            strategyId: 'strategy-789',
            children: []
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryGraph.linkNodes(parentId, childId);
      
      // Assert
      expect(result).toBe(false);
      expect(mockRedisService.setex).not.toHaveBeenCalled();
    });
    
    it('should return true if nodes are already linked', async () => {
      // Arrange
      const parentId = uuidv4();
      const childId = uuidv4();
      
      mockRedisService.get.mockImplementation((key: string) => {
        if (key.includes(parentId)) {
          return Promise.resolve(JSON.stringify({
            id: parentId,
            agentId: 'agent-123',
            strategyId: 'strategy-456',
            children: [childId] // Already linked
          }));
        }
        if (key.includes(childId)) {
          return Promise.resolve(JSON.stringify({
            id: childId,
            agentId: 'agent-123',
            strategyId: 'strategy-789',
            children: [],
            parentId: parentId
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryGraph.linkNodes(parentId, childId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRedisService.setex).not.toHaveBeenCalled(); // No updates needed
    });
  });
  
  describe('getContext', () => {
    it('should retrieve nodes for a specific strategy', async () => {
      // Arrange
      const agentId = 'agent-123';
      const strategyId = 'strategy-456';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      mockRedisService.get.mockImplementation((key: string) => {
        const nodeIndex = nodeIds.findIndex(id => key.includes(id));
        if (nodeIndex >= 0) {
          return Promise.resolve(JSON.stringify({
            id: nodeIds[nodeIndex],
            agentId,
            strategyId: nodeIndex === 2 ? 'other-strategy' : strategyId,
            timestamp: Date.now() - nodeIndex * 1000,
            trustScore: 0.7 + (nodeIndex * 0.1),
            contextTags: ['tag-1', 'tag-2']
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryGraph.getContext(agentId, strategyId);
      
      // Assert
      expect(result).toHaveLength(2); // Only 2 nodes match the strategy
      expect(result[0].strategyId).toBe(strategyId);
      expect(result[1].strategyId).toBe(strategyId);
      
      // Check sorting (newest first)
      expect(result[0].timestamp).toBeGreaterThan(result[1].timestamp);
    });
    
    it('should apply query filters correctly', async () => {
      // Arrange
      const agentId = 'agent-123';
      const strategyId = 'strategy-456';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      const now = Date.now();
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      mockRedisService.get.mockImplementation((key: string) => {
        const nodeIndex = nodeIds.findIndex(id => key.includes(id));
        if (nodeIndex >= 0) {
          return Promise.resolve(JSON.stringify({
            id: nodeIds[nodeIndex],
            agentId,
            strategyId,
            timestamp: now - nodeIndex * 100000, // Different timestamps
            trustScore: 0.5 + (nodeIndex * 0.2), // Different trust scores
            regretScore: nodeIndex * 0.3, // Different regret scores
            contextTags: nodeIndex === 0 ? ['tag-1', 'tag-2'] : ['tag-1']
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act - Apply time filter
      const timeResult = await memoryGraph.getContext(agentId, strategyId, {
        startTime: now - 150000,
        endTime: now
      });
      
      // Assert
      expect(timeResult).toHaveLength(2); // Only first 2 nodes within time range
      
      // Act - Apply trust score filter
      const trustResult = await memoryGraph.getContext(agentId, strategyId, {
        minTrustScore: 0.8
      });
      
      // Assert
      expect(trustResult).toHaveLength(1); // Only 1 node with high trust
      expect(trustResult[0].trustScore).toBeGreaterThanOrEqual(0.8);
      
      // Act - Apply context tag filter
      const tagResult = await memoryGraph.getContext(agentId, strategyId, {
        contextTags: ['tag-1', 'tag-2']
      });
      
      // Assert
      expect(tagResult).toHaveLength(1); // Only 1 node with both tags
      expect(tagResult[0].contextTags).toContain('tag-1');
      expect(tagResult[0].contextTags).toContain('tag-2');
    });
    
    it('should return empty array if no nodes exist', async () => {
      // Arrange
      mockRedisService.smembers.mockResolvedValue([]);
      
      // Act
      const result = await memoryGraph.getContext('agent-123', 'strategy-456');
      
      // Assert
      expect(result).toHaveLength(0);
      expect(mockRedisService.get).not.toHaveBeenCalled();
    });
  });
  
  describe('decayOldPaths', () => {
    it('should apply decay to node weights based on age', async () => {
      // Arrange
      const agentId = 'agent-123';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      
      // Mock ages: 1 day, 5 days, 10 days old
      const nodeAges = [oneDay, 5 * oneDay, 10 * oneDay];
      const nodeWeights = [0.8, 0.7, 0.6];
      const storedNodes: Record<string, any> = {};
      
      nodeIds.forEach((id, index) => {
        storedNodes[id] = {
          id,
          agentId,
          strategyId: 'strategy-456',
          timestamp: now - nodeAges[index],
          weight: nodeWeights[index],
          children: []
        };
      });
      
      mockRedisService.get.mockImplementation((key: string) => {
        const id = nodeIds.find(id => key.includes(id));
        if (id && storedNodes[id]) {
          return Promise.resolve(JSON.stringify(storedNodes[id]));
        }
        return Promise.resolve(null);
      });
      
      mockRedisService.setex.mockImplementation((key: string, ttl: number, json: string) => {
        const id = nodeIds.find(id => key.includes(id));
        if (id) {
          storedNodes[id] = JSON.parse(json);
        }
        return Promise.resolve('OK');
      });
      
      // Act
      const decayedCount = await memoryGraph.decayOldPaths(agentId);
      
      // Assert
      expect(decayedCount).toBeGreaterThan(0);
      
      // Verify all nodes were decayed
      for (let i = 0; i < nodeIds.length; i++) {
        const node = storedNodes[nodeIds[i]];
        expect(node.weight).toBeLessThan(nodeWeights[i]);
        
        // 0.998^(days) decay rate
        const expectedWeight = nodeWeights[i] * Math.pow(0.998, nodeAges[i] / oneDay);
        expect(node.weight).toBeCloseTo(expectedWeight, 4);
      }
    });
    
    it('should return 0 if no nodes exist', async () => {
      // Arrange
      mockRedisService.smembers.mockResolvedValue([]);
      
      // Act
      const result = await memoryGraph.decayOldPaths('agent-123');
      
      // Assert
      expect(result).toBe(0);
      expect(mockRedisService.get).not.toHaveBeenCalled();
    });
  });
  
  describe('getMostTrustedStrategyPath', () => {
    it('should return a path starting from the most trusted node', async () => {
      // Arrange
      const agentId = 'agent-123';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      const highTrustNodeId = nodeIds[1]; // Middle node has highest trust
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      mockRedisService.get.mockImplementation((key: string) => {
        const nodeIndex = nodeIds.findIndex(id => key.includes(id));
        if (nodeIndex >= 0) {
          return Promise.resolve(JSON.stringify({
            id: nodeIds[nodeIndex],
            agentId,
            strategyId: 'strategy-456',
            timestamp: Date.now() - nodeIndex * 1000,
            trustScore: nodeIndex === 1 ? 0.9 : 0.7, // Node 1 has highest trust
            reinforcementScore: 0.5,
            regretScore: 0.1,
            children: nodeIndex < 2 ? [nodeIds[nodeIndex + 1]] : [],
            weight: 0.8
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act
      const result = await memoryGraph.getMostTrustedStrategyPath(agentId);
      
      // Assert
      expect(result.nodes).toHaveLength(3); // Should return all 3 nodes in the path
      expect(result.nodes[0].id).toBe(highTrustNodeId); // Start from highest trust node
      expect(result.totalTrust).toBeGreaterThan(0);
      expect(result.totalReinforcement).toBeGreaterThan(0);
      expect(result.averageWeight).toBeGreaterThan(0);
    });
  });
  
  describe('hasAgentTriedContext', () => {
    it('should detect if an agent has tried a specific context', async () => {
      // Arrange
      const agentId = 'agent-123';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      mockRedisService.get.mockImplementation((key: string) => {
        const nodeIndex = nodeIds.findIndex(id => key.includes(id));
        if (nodeIndex >= 0) {
          return Promise.resolve(JSON.stringify({
            id: nodeIds[nodeIndex],
            agentId,
            strategyId: `strategy-${nodeIndex}`,
            contextTags: nodeIndex === 0 
              ? ['market:bull', 'asset:bitcoin', 'volatility:high']
              : ['market:bear', 'asset:ethereum']
          }));
        }
        return Promise.resolve(null);
      });
      
      // Act - Should match first node
      const result1 = await memoryGraph.hasAgentTriedContext(
        agentId, 
        ['market:bull', 'asset:bitcoin']
      );
      
      // Act - Should not match any node (all tags must match)
      const result2 = await memoryGraph.hasAgentTriedContext(
        agentId, 
        ['market:bull', 'asset:ethereum']
      );
      
      // Act - Should match with partial requirement
      const result3 = await memoryGraph.hasAgentTriedContext(
        agentId, 
        ['market:bull', 'asset:ethereum'],
        1 // Only 1 tag needs to match
      );
      
      // Assert
      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(true);
    });
  });
  
  describe('clearAgentMemory', () => {
    it('should delete all nodes for an agent', async () => {
      // Arrange
      const agentId = 'agent-123';
      const nodeIds = [uuidv4(), uuidv4(), uuidv4()];
      
      mockRedisService.smembers.mockResolvedValue(nodeIds);
      mockRedisService.del.mockResolvedValue(1);
      
      // Act
      const result = await memoryGraph.clearAgentMemory(agentId);
      
      // Assert
      expect(result).toBe(nodeIds.length);
      expect(mockRedisService.del).toHaveBeenCalledTimes(nodeIds.length + 1); // Nodes + index
      
      // Verify correct keys were deleted
      for (const nodeId of nodeIds) {
        expect(mockRedisService.del).toHaveBeenCalledWith(
          expect.stringContaining(nodeId)
        );
      }
      
      // Verify agent index was deleted
      expect(mockRedisService.del).toHaveBeenCalledWith(
        expect.stringContaining(`agent:${agentId}:nodes`)
      );
    });
  });
}); 
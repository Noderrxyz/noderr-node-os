/**
 * Unit tests for RegretBuffer service
 */

// No need to redeclare global types - they should be in a separate types file or installed via npm

import { RegretBuffer, RegretEntry } from '../RegretBuffer';
import { v4 as uuidv4 } from 'uuid';

// Mock RedisService
const mockRedisService = {
  set: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  lrange: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  publish: jest.fn(),
};

describe('RegretBuffer', () => {
  let regretBuffer: RegretBuffer;
  
  beforeEach(() => {
    jest.clearAllMocks();
    regretBuffer = new RegretBuffer(mockRedisService as any);
  });
  
  describe('log', () => {
    it('should store a valid regret entry', async () => {
      // Arrange
      const entry = {
        agentId: 'agent-123',
        action: 'buy',
        outcome: 'loss',
        regretScore: 0.75,
        assetSymbol: 'BTC'
      };
      
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      mockRedisService.publish.mockResolvedValue(1);
      mockRedisService.smembers.mockResolvedValue([1, 2, 3, 4, 5]); // Below max entries
      
      // Act
      const result = await regretBuffer.log(entry);
      
      // Assert
      expect(result).toBeTruthy();
      expect(mockRedisService.setex).toHaveBeenCalledTimes(1);
      expect(mockRedisService.sadd).toHaveBeenCalledTimes(1);
      expect(mockRedisService.expire).toHaveBeenCalledTimes(1);
      expect(mockRedisService.publish).toHaveBeenCalledTimes(1); // High regret event
      
      // Verify structure
      const setCall = mockRedisService.setex.mock.calls[0];
      expect(setCall[0]).toContain('agent:regret:entry:');
      expect(JSON.parse(setCall[2])).toMatchObject({
        agentId: 'agent-123',
        action: 'buy',
        outcome: 'loss',
        regretScore: 0.75,
        assetSymbol: 'BTC'
      });
    });
    
    it('should skip entries with regret score below threshold', async () => {
      // Arrange
      const entry = {
        agentId: 'agent-123',
        action: 'buy',
        outcome: 'loss',
        regretScore: 0.05, // Below default threshold of 0.1
        assetSymbol: 'BTC'
      };
      
      // Act
      const result = await regretBuffer.log(entry);
      
      // Assert
      expect(result).toBeNull();
      expect(mockRedisService.setex).not.toHaveBeenCalled();
      expect(mockRedisService.sadd).not.toHaveBeenCalled();
    });
    
    it('should prune old entries when exceeding max entries', async () => {
      // Arrange
      const entry = {
        agentId: 'agent-123',
        action: 'buy',
        outcome: 'loss',
        regretScore: 0.5,
        assetSymbol: 'BTC'
      };
      
      // Mock exceeding max entries
      mockRedisService.setex.mockResolvedValue('OK');
      mockRedisService.sadd.mockResolvedValue(1);
      mockRedisService.expire.mockResolvedValue(1);
      mockRedisService.smembers.mockResolvedValue(Array(110).fill('entry')); // Above default max of 100
      mockRedisService.get.mockImplementation((key: string) => {
        return Promise.resolve(JSON.stringify({
          id: key.split(':').pop(),
          timestamp: Date.now() - parseInt(key.split(':').pop() || '0')
        }));
      });
      mockRedisService.del.mockResolvedValue(1);
      mockRedisService.srem.mockResolvedValue(2);
      
      // Act
      const result = await regretBuffer.log(entry);
      
      // Assert
      expect(result).toBeTruthy();
      expect(mockRedisService.del).toHaveBeenCalled();
      expect(mockRedisService.srem).toHaveBeenCalled();
    });
  });
  
  describe('getAgentRegretEntries', () => {
    it('should retrieve and filter regret entries', async () => {
      // Arrange
      const agentId = 'agent-123';
      const entries = [
        {
          id: 'entry-1',
          agentId,
          action: 'buy',
          outcome: 'loss',
          regretScore: 0.8,
          timestamp: Date.now() - 3600000,
          assetSymbol: 'BTC'
        },
        {
          id: 'entry-2',
          agentId,
          action: 'sell',
          outcome: 'gain',
          regretScore: 0.3,
          timestamp: Date.now() - 7200000,
          assetSymbol: 'ETH'
        }
      ];
      
      mockRedisService.lrange.mockResolvedValue(['entry-1', 'entry-2']);
      mockRedisService.get.mockImplementation((key: string) => {
        if (key.includes('entry-1')) {
          return Promise.resolve(JSON.stringify(entries[0]));
        } else if (key.includes('entry-2')) {
          return Promise.resolve(JSON.stringify(entries[1]));
        }
        return Promise.resolve(null);
      });
      
      // Act
      const result = await regretBuffer.getAgentRegretEntries(agentId, {
        minRegretScore: 0.5
      });
      
      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('entry-1');
      expect(mockRedisService.lrange).toHaveBeenCalledTimes(1);
      expect(mockRedisService.get).toHaveBeenCalledTimes(2);
    });
    
    it('should handle empty results', async () => {
      // Arrange
      mockRedisService.lrange.mockResolvedValue([]);
      
      // Act
      const result = await regretBuffer.getAgentRegretEntries('agent-123');
      
      // Assert
      expect(result).toHaveLength(0);
      expect(mockRedisService.get).not.toHaveBeenCalled();
    });
  });
  
  describe('calculateTotalRegret', () => {
    it('should calculate decayed regret scores', async () => {
      // Arrange
      const agentId = 'agent-123';
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      const entries = [
        {
          id: 'entry-1',
          agentId,
          action: 'buy',
          outcome: 'loss',
          regretScore: 1.0,
          timestamp: now - oneDayMs, // 1 day ago
          assetSymbol: 'BTC'
        },
        {
          id: 'entry-2',
          agentId,
          action: 'sell',
          outcome: 'loss',
          regretScore: 1.0,
          timestamp: now - (2 * oneDayMs), // 2 days ago
          assetSymbol: 'ETH'
        }
      ];
      
      // Replace jest.spyOn with direct mock implementation
      // @ts-ignore - Ignoring type error for the test
      regretBuffer.getAgentRegretEntries = jest.fn().mockResolvedValue(entries);
      
      // Act
      const result = await regretBuffer.calculateTotalRegret(agentId);
      
      // Assert
      // With 5% daily decay, we expect:
      // 1.0 * 0.95^1 + 1.0 * 0.95^2 = 0.95 + 0.9025 = 1.8525
      expect(result).toBeCloseTo(1.8525, 4);
    });
    
    it('should return 0 for agents with no regret entries', async () => {
      // Arrange
      // Replace jest.spyOn with direct mock implementation
      // @ts-ignore - Ignoring type error for the test
      regretBuffer.getAgentRegretEntries = jest.fn().mockResolvedValue([]);
      
      // Act
      const result = await regretBuffer.calculateTotalRegret('agent-123');
      
      // Assert
      expect(result).toBe(0);
    });
  });
  
  describe('getRegretSummary', () => {
    it('should generate a comprehensive regret summary', async () => {
      // Arrange
      const agentId = 'agent-123';
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      const entries = [
        {
          id: 'entry-1',
          agentId,
          action: 'buy',
          outcome: 'loss',
          regretScore: 0.8,
          timestamp: now - oneDayMs, // 1 day ago
          assetSymbol: 'BTC'
        },
        {
          id: 'entry-2',
          agentId,
          action: 'sell',
          outcome: 'loss',
          regretScore: 0.4,
          timestamp: now - (10 * oneDayMs), // 10 days ago
          assetSymbol: 'ETH'
        },
        {
          id: 'entry-3',
          agentId,
          action: 'buy',
          outcome: 'loss',
          regretScore: 0.6,
          timestamp: now - (3 * oneDayMs), // 3 days ago
          assetSymbol: 'LTC'
        }
      ];
      
      // Replace jest.spyOn with direct mock implementation
      // @ts-ignore - Ignoring type error for the test
      regretBuffer.getAgentRegretEntries = jest.fn().mockResolvedValue(entries);
      
      // Act
      const summary = await regretBuffer.getRegretSummary(agentId);
      
      // Assert
      expect(summary.entryCount).toBe(3);
      expect(summary.actionCounts.buy).toBe(2);
      expect(summary.actionCounts.sell).toBe(1);
      expect(summary.totalRegret).toBeGreaterThan(0);
      expect(summary.avgRegret).toBeGreaterThan(0);
      expect(summary.maxRegret).toBeCloseTo(0.8 * 0.95, 4); // 1 day decay
      expect(summary.recentRegret).toBeGreaterThan(0);
    });
  });
  
  describe('deleteRegretEntry', () => {
    it('should delete an entry and its references', async () => {
      // Arrange
      const entryId = 'entry-123';
      const entryData = {
        id: entryId,
        agentId: 'agent-123',
        action: 'buy',
        outcome: 'loss',
        regretScore: 0.8,
        timestamp: Date.now(),
        assetSymbol: 'BTC'
      };
      
      mockRedisService.get.mockResolvedValue(JSON.stringify(entryData));
      mockRedisService.del.mockResolvedValue(1);
      mockRedisService.srem.mockResolvedValue(1);
      
      // Act
      const result = await regretBuffer.deleteRegretEntry(entryId);
      
      // Assert
      expect(result).toBe(true);
      expect(mockRedisService.del).toHaveBeenCalledTimes(1);
      expect(mockRedisService.srem).toHaveBeenCalledTimes(1);
    });
    
    it('should handle non-existent entries', async () => {
      // Arrange
      mockRedisService.get.mockResolvedValue(null);
      
      // Act
      const result = await regretBuffer.deleteRegretEntry('non-existent');
      
      // Assert
      expect(result).toBe(false);
      expect(mockRedisService.del).not.toHaveBeenCalled();
      expect(mockRedisService.srem).not.toHaveBeenCalled();
    });
  });
  
  describe('clearAgentRegret', () => {
    it('should delete all regret entries for an agent', async () => {
      // Arrange
      const agentId = 'agent-123';
      mockRedisService.lrange.mockResolvedValue(['entry-1', 'entry-2', 'entry-3']);
      mockRedisService.del.mockResolvedValue(3);
      
      // Act
      const result = await regretBuffer.clearAgentRegret(agentId);
      
      // Assert
      expect(result).toBe(3);
      expect(mockRedisService.del).toHaveBeenCalledTimes(2); // Once for entries, once for list
      expect(mockRedisService.lrange).toHaveBeenCalledTimes(1);
    });
    
    it('should handle agents with no entries', async () => {
      // Arrange
      mockRedisService.lrange.mockResolvedValue([]);
      
      // Act
      const result = await regretBuffer.clearAgentRegret('agent-empty');
      
      // Assert
      expect(result).toBe(0);
      expect(mockRedisService.del).not.toHaveBeenCalled();
    });
  });
}); 
import { AlphaMemory, AlphaMemoryRecord } from '../../memory/AlphaMemory';
import { MarketRegime } from '../../regime/RegimeClassifier';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock path module
jest.mock('path', () => ({
  dirname: jest.fn().mockReturnValue('/mock/directory'),
}));

describe('AlphaMemory', () => {
  let memory: AlphaMemory;
  const testFilePath = 'test_alpha_memory.jsonl';
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Reset singleton
    (AlphaMemory as any).instance = null;
    
    // Configure mock for existsSync
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    
    // Set up instance with test file path
    memory = AlphaMemory.getInstance({
      filePath: testFilePath,
      autoSaveIntervalMs: 0, // Disable auto-save for tests
    });
  });
  
  afterEach(() => {
    // Clean up timers
    memory.dispose();
  });
  
  describe('singleton pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = AlphaMemory.getInstance();
      const instance2 = AlphaMemory.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('record management', () => {
    const createTestRecord = (
      strategyId: string = 'test-strategy',
      symbol: string = 'BTC/USD',
      regime: MarketRegime = MarketRegime.BullishTrend,
      sharpeRatio: number = 1.5
    ): AlphaMemoryRecord => ({
      strategyId,
      symbol,
      regime,
      parameters: {
        lookback: 20,
        threshold: 0.5,
      },
      performance: {
        totalReturn: 0.15,
        sharpeRatio,
        maxDrawdown: 0.05,
        winRate: 0.65,
        tradeCount: 50,
        avgProfitPerTrade: 0.003,
        profitFactor: 1.8,
      },
      period: {
        start: new Date('2023-01-01'),
        end: new Date('2023-02-01'),
        durationMs: 2678400000, // ~31 days
      },
      metadata: {
        created: new Date(),
        strategyType: 'momentum',
        tags: ['test', 'momentum', 'crypto'],
      },
    });
    
    it('should add and retrieve records', () => {
      const record = createTestRecord();
      memory.addRecord(record);
      
      const records = memory.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
      
      // Verify save was called since autoSave is disabled
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
    
    it('should find records using filters', () => {
      // Add a mix of records
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 1.5));
      memory.addRecord(createTestRecord('strategy1', 'ETH/USD', MarketRegime.BearishTrend, 0.8));
      memory.addRecord(createTestRecord('strategy2', 'BTC/USD', MarketRegime.BullishTrend, 2.0));
      
      // Filter by strategy ID
      expect(memory.getRecords({ strategyId: 'strategy1' })).toHaveLength(2);
      
      // Filter by symbol
      expect(memory.getRecords({ symbol: 'BTC/USD' })).toHaveLength(2);
      
      // Filter by regime
      expect(memory.getRecords({ regime: MarketRegime.BearishTrend })).toHaveLength(1);
      
      // Filter by minimum Sharpe ratio
      expect(memory.getRecords({ minSharpeRatio: 1.0 })).toHaveLength(2);
      
      // Combined filters
      expect(memory.getRecords({ 
        strategyId: 'strategy1',
        symbol: 'BTC/USD',
        regime: MarketRegime.BullishTrend
      })).toHaveLength(1);
    });
    
    it('should find best parameters for a strategy/symbol/regime combination', () => {
      // Add records with different Sharpe ratios
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 1.0));
      
      const bestRecord = createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 2.0);
      bestRecord.parameters = { lookback: 30, threshold: 0.7 };
      memory.addRecord(bestRecord);
      
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 0.5));
      
      // Verify we get the parameters from the record with highest Sharpe
      const bestParams = memory.findBestParameters('strategy1', 'BTC/USD', MarketRegime.BullishTrend);
      expect(bestParams).toEqual({ lookback: 30, threshold: 0.7 });
    });
    
    it('should return null when finding best parameters for non-existent combinations', () => {
      const bestParams = memory.findBestParameters('non-existent', 'XYZ/USD', MarketRegime.Rangebound);
      expect(bestParams).toBeNull();
    });
    
    it('should delete records matching a filter', () => {
      // Add a mix of records
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend));
      memory.addRecord(createTestRecord('strategy1', 'ETH/USD', MarketRegime.BearishTrend));
      memory.addRecord(createTestRecord('strategy2', 'BTC/USD', MarketRegime.BullishTrend));
      
      // Delete records for strategy1
      const deletedCount = memory.deleteRecords({ strategyId: 'strategy1' });
      
      expect(deletedCount).toBe(2);
      expect(memory.getRecords()).toHaveLength(1);
      expect(memory.getRecords()[0].strategyId).toBe('strategy2');
    });
    
    it('should clear all records', () => {
      // Add some records
      memory.addRecord(createTestRecord());
      memory.addRecord(createTestRecord());
      
      expect(memory.getRecords()).toHaveLength(2);
      
      // Clear all records
      memory.clearAll();
      
      expect(memory.getRecords()).toHaveLength(0);
    });
    
    it('should enforce record limits per strategy', () => {
      // Configure memory with a low limit per strategy
      (AlphaMemory as any).instance = null;
      memory = AlphaMemory.getInstance({
        filePath: testFilePath,
        autoSaveIntervalMs: 0,
        maxRecordsPerStrategy: 2,
      });
      
      // Add 3 records for the same strategy with different Sharpe ratios
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 1.0));
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 2.0));
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 0.5));
      
      // Verify we only kept the 2 records with highest Sharpe
      const records = memory.getRecords({ strategyId: 'strategy1' });
      expect(records).toHaveLength(2);
      
      // Sort by sharpe
      const sortedRecords = [...records].sort((a, b) => 
        b.performance.sharpeRatio - a.performance.sharpeRatio
      );
      
      expect(sortedRecords[0].performance.sharpeRatio).toBe(2.0);
      expect(sortedRecords[1].performance.sharpeRatio).toBe(1.0);
    });
  });
  
  describe('persistence', () => {
    it('should load records from disk on initialization', () => {
      // Set up mock file
      const mockRecords = [
        createTestRecord('strategy1'),
        createTestRecord('strategy2'),
      ];
      
      const mockFileContents = mockRecords
        .map(record => JSON.stringify({
          ...record,
          period: {
            ...record.period,
            start: record.period.start.toISOString(),
            end: record.period.end.toISOString(),
          },
          metadata: {
            ...record.metadata,
            created: record.metadata.created.toISOString(),
          },
        }))
        .join('\n');
      
      // Configure mocks
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockFileContents);
      
      // Recreate memory instance to trigger load
      (AlphaMemory as any).instance = null;
      memory = AlphaMemory.getInstance({ filePath: testFilePath });
      
      // Verify records were loaded
      expect(memory.getRecords()).toHaveLength(2);
      expect(memory.getRecords()[0].strategyId).toBe('strategy1');
      expect(memory.getRecords()[1].strategyId).toBe('strategy2');
    });
    
    it('should handle errors when loading records', () => {
      // Configure mocks to simulate error
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Mock file read error');
      });
      
      // Should not crash, and should initialize with empty records
      (AlphaMemory as any).instance = null;
      memory = AlphaMemory.getInstance({ filePath: testFilePath });
      
      expect(memory.getRecords()).toHaveLength(0);
    });
    
    it('should save records to disk', () => {
      // Add a record
      const record = createTestRecord();
      memory.addRecord(record);
      
      // Verify saveRecords was called
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      
      // Create directory if it doesn't exist
      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/directory', { recursive: true });
      
      // Write file
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        testFilePath,
        expect.any(String),
        'utf8'
      );
    });
    
    it('should handle errors when saving records', () => {
      // Configure mock to simulate error
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Mock file write error');
      });
      
      // Should not crash
      const record = createTestRecord();
      expect(() => memory.addRecord(record)).not.toThrow();
    });
  });
  
  describe('memory summary', () => {
    it('should provide a summary of memory statistics', () => {
      // Add records with different properties
      memory.addRecord(createTestRecord('strategy1', 'BTC/USD', MarketRegime.BullishTrend, 1.5));
      memory.addRecord(createTestRecord('strategy1', 'ETH/USD', MarketRegime.BearishTrend, 0.8));
      memory.addRecord(createTestRecord('strategy2', 'BTC/USD', MarketRegime.Rangebound, 2.0));
      
      // Get memory summary
      const summary = memory.getMemorySummary();
      
      expect(summary.totalRecords).toBe(3);
      expect(summary.strategiesCount).toBe(2);
      expect(summary.symbolsCount).toBe(2);
      expect(summary.regimesCount).toBe(3);
      expect(summary.bestSharpe).toBe(2.0);
      expect(summary.bestReturn).toBe(0.15); // All test records have the same return
    });
  });
  
  // Helper function
  function createTestRecord(
    strategyId: string = 'test-strategy',
    symbol: string = 'BTC/USD',
    regime: MarketRegime = MarketRegime.BullishTrend,
    sharpeRatio: number = 1.5
  ): AlphaMemoryRecord {
    return {
      strategyId,
      symbol,
      regime,
      parameters: {
        lookback: 20,
        threshold: 0.5,
      },
      performance: {
        totalReturn: 0.15,
        sharpeRatio,
        maxDrawdown: 0.05,
        winRate: 0.65,
        tradeCount: 50,
        avgProfitPerTrade: 0.003,
        profitFactor: 1.8,
      },
      period: {
        start: new Date('2023-01-01'),
        end: new Date('2023-02-01'),
        durationMs: 2678400000, // ~31 days
      },
      metadata: {
        created: new Date(),
        strategyType: 'momentum',
        tags: ['test', 'momentum', 'crypto'],
      },
    };
  }
}); 
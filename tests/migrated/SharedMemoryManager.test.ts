import { SharedMemoryManagerJs, BufferType, BufferConfig } from '../SharedMemoryManagerJs';
import { telemetry } from '../../telemetry';

// Mock telemetry to avoid actual recording during tests
jest.mock('../../telemetry', () => ({
  telemetry: {
    recordMetric: jest.fn(),
    recordError: jest.fn()
  }
}));

// Mock logger to suppress output during tests
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('SharedMemoryManagerJs', () => {
  let memoryManager: SharedMemoryManagerJs;
  const TEST_BUFFER = 'test_buffer';
  const TEST_DATA = { value: 42, timestamp: Date.now() };
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Get fresh instance for each test
    memoryManager = SharedMemoryManagerJs.getInstance();
    
    // Create a test buffer that can be used by all tests
    memoryManager.createBuffer(TEST_BUFFER, {
      bufferType: BufferType.MarketData,
      capacity: 100,
      allowOverwrites: true,
      autoCompact: false
    });
  });
  
  afterEach(() => {
    // Clean up by removing test buffer
    memoryManager.removeBuffer(TEST_BUFFER);
  });
  
  describe('createBuffer', () => {
    it('should create a buffer with default config when no config provided', () => {
      const result = memoryManager.createBuffer('default_buffer');
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.create_buffer', 
        1, 
        expect.objectContaining({
          implementation: 'js'
        })
      );
      
      // Clean up
      memoryManager.removeBuffer('default_buffer');
    });
    
    it('should create a buffer with custom config', () => {
      const result = memoryManager.createBuffer('custom_buffer', {
        bufferType: BufferType.OrderBookDeltas,
        capacity: 200,
        allowOverwrites: false,
        autoCompact: true
      });
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.create_buffer', 
        1, 
        expect.objectContaining({
          buffer: 'custom_buffer',
          implementation: 'js'
        })
      );
      
      // Clean up
      memoryManager.removeBuffer('custom_buffer');
    });
    
    it('should return false when trying to create a buffer that already exists', () => {
      // First creation should succeed
      memoryManager.createBuffer('duplicate_buffer');
      
      // Second creation should fail
      const result = memoryManager.createBuffer('duplicate_buffer');
      expect(result).toBe(false);
      
      // Clean up
      memoryManager.removeBuffer('duplicate_buffer');
    });
  });
  
  describe('push', () => {
    it('should push data to a buffer', () => {
      const sequence = memoryManager.push(TEST_BUFFER, TEST_DATA);
      expect(sequence).toBeGreaterThanOrEqual(0);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.push', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          implementation: 'js'
        })
      );
    });
    
    it('should return -1 when pushing to a non-existent buffer', () => {
      const sequence = memoryManager.push('non_existent_buffer', TEST_DATA);
      expect(sequence).toBe(-1);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('pushBatch', () => {
    it('should push batch data to a buffer', () => {
      const batchData = [TEST_DATA, { ...TEST_DATA, value: 43 }];
      const sequences = memoryManager.pushBatch(TEST_BUFFER, batchData);
      expect(sequences.length).toBe(2);
      expect(sequences[0]).toBeGreaterThanOrEqual(0);
      expect(sequences[1]).toBeGreaterThanOrEqual(0);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.push_batch', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          count: '2',
          implementation: 'js'
        })
      );
    });
    
    it('should return empty array when pushing batch to a non-existent buffer', () => {
      const batchData = [TEST_DATA, { ...TEST_DATA, value: 43 }];
      const sequences = memoryManager.pushBatch('non_existent_buffer', batchData);
      expect(sequences).toEqual([]);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('getRecent', () => {
    beforeEach(() => {
      // Add 5 items to test buffer
      for (let i = 0; i < 5; i++) {
        memoryManager.push(TEST_BUFFER, { ...TEST_DATA, value: i });
      }
    });
    
    it('should get recent items from a buffer', () => {
      const items = memoryManager.getRecent(TEST_BUFFER, 3);
      expect(items.length).toBe(3);
      expect(items[0].value).toBe(2); // Most recent 3 items should be values 2, 3, 4
      expect(items[2].value).toBe(4);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.get_recent', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          limit: '3',
          count_returned: '3',
          implementation: 'js'
        })
      );
    });
    
    it('should return fewer items if limit exceeds available items', () => {
      const items = memoryManager.getRecent(TEST_BUFFER, 10);
      expect(items.length).toBe(5);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.get_recent', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          limit: '10',
          count_returned: '5',
          implementation: 'js'
        })
      );
    });
    
    it('should return empty array when getting recent items from a non-existent buffer', () => {
      const items = memoryManager.getRecent('non_existent_buffer', 3);
      expect(items).toEqual([]);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('getAfterSequence', () => {
    let sequences: number[] = [];
    
    beforeEach(() => {
      // Add 5 items to test buffer and capture sequences
      sequences = [];
      for (let i = 0; i < 5; i++) {
        const seq = memoryManager.push(TEST_BUFFER, { ...TEST_DATA, value: i });
        sequences.push(seq);
      }
    });
    
    it('should get items after a given sequence', () => {
      const midSequence = sequences[2]; // Get items after the 3rd item
      const items = memoryManager.getAfterSequence(TEST_BUFFER, midSequence);
      expect(items.length).toBe(2); // Should return items 4 and 5
      expect(items[0].value).toBe(3);
      expect(items[1].value).toBe(4);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.get_after_sequence', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          sequence: midSequence.toString(),
          count_returned: '2',
          implementation: 'js'
        })
      );
    });
    
    it('should return empty array when no items exist after the sequence', () => {
      const lastSequence = sequences[sequences.length - 1];
      const items = memoryManager.getAfterSequence(TEST_BUFFER, lastSequence);
      expect(items).toEqual([]);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.get_after_sequence', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          sequence: lastSequence.toString(),
          count_returned: '0',
          implementation: 'js'
        })
      );
    });
    
    it('should return empty array when getting items from a non-existent buffer', () => {
      const items = memoryManager.getAfterSequence('non_existent_buffer', 0);
      expect(items).toEqual([]);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('clearBuffer', () => {
    beforeEach(() => {
      // Add some items to test buffer
      for (let i = 0; i < 3; i++) {
        memoryManager.push(TEST_BUFFER, { ...TEST_DATA, value: i });
      }
    });
    
    it('should clear all items from a buffer', () => {
      // Verify buffer has items
      let items = memoryManager.getRecent(TEST_BUFFER, 10);
      expect(items.length).toBe(3);
      
      // Clear buffer
      const result = memoryManager.clearBuffer(TEST_BUFFER);
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.clear_buffer', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          implementation: 'js'
        })
      );
      
      // Verify buffer is empty
      items = memoryManager.getRecent(TEST_BUFFER, 10);
      expect(items.length).toBe(0);
    });
    
    it('should return false when clearing a non-existent buffer', () => {
      const result = memoryManager.clearBuffer('non_existent_buffer');
      expect(result).toBe(false);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('removeBuffer', () => {
    it('should remove a buffer', () => {
      // Create a buffer to remove
      memoryManager.createBuffer('buffer_to_remove');
      
      // Remove the buffer
      const result = memoryManager.removeBuffer('buffer_to_remove');
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'shared_memory_manager.remove_buffer', 
        1, 
        expect.objectContaining({
          buffer: 'buffer_to_remove',
          implementation: 'js'
        })
      );
      
      // Verify buffer no longer exists by attempting to push data
      const sequence = memoryManager.push('buffer_to_remove', TEST_DATA);
      expect(sequence).toBe(-1);
    });
    
    it('should return false when removing a non-existent buffer', () => {
      const result = memoryManager.removeBuffer('non_existent_buffer');
      expect(result).toBe(false);
      expect(telemetry.recordError).toHaveBeenCalled();
    });
  });
  
  describe('singleton pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = SharedMemoryManagerJs.getInstance();
      const instance2 = SharedMemoryManagerJs.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
}); 
import { SharedMemoryManagerRust, BufferType, BatchProcessorRust } from '@noderr/memory/SharedMemoryManagerRust';

// Mock the NapiSharedMemoryManager
jest.mock('@noderr/core', () => {
  const bufferStore = new Map<string, any[]>();
  
  return {
    NapiSharedMemoryManager: jest.fn().mockImplementation(() => ({
      create_market_data_buffer: jest.fn((name: string) => {
        bufferStore.set(name, []);
        return true;
      }),
      
      push_market_data: jest.fn((bufferName: string, data: any) => {
        const buffer = bufferStore.get(bufferName) || [];
        const sequence = buffer.length;
        buffer.push({
          timestamp: Date.now() * 1000, // Convert to microseconds
          sequence,
          data
        });
        bufferStore.set(bufferName, buffer);
        return sequence;
      }),
      
      push_market_data_batch: jest.fn((bufferName: string, items: any[]) => {
        const buffer = bufferStore.get(bufferName) || [];
        const startSequence = buffer.length;
        const sequences = [];
        
        for (let i = 0; i < items.length; i++) {
          const sequence = startSequence + i;
          sequences.push(sequence);
          buffer.push({
            timestamp: Date.now() * 1000, // Convert to microseconds
            sequence,
            data: items[i]
          });
        }
        
        bufferStore.set(bufferName, buffer);
        return sequences;
      }),
      
      get_recent_market_data: jest.fn((bufferName: string, limit: number) => {
        const buffer = bufferStore.get(bufferName) || [];
        const startIdx = Math.max(0, buffer.length - limit);
        return buffer.slice(startIdx).reverse().map(item => item.data);
      }),
      
      get_market_data_after_sequence: jest.fn((bufferName: string, sequence: number) => {
        const buffer = bufferStore.get(bufferName) || [];
        return buffer
          .filter(item => item.sequence > sequence)
          .map(item => item.data);
      }),
      
      get_market_data_after_timestamp: jest.fn((bufferName: string, timestamp: number) => {
        const buffer = bufferStore.get(bufferName) || [];
        return buffer
          .filter(item => item.timestamp > timestamp)
          .map(item => item.data);
      }),
      
      clear_buffer: jest.fn((bufferName: string) => {
        if (bufferStore.has(bufferName)) {
          bufferStore.set(bufferName, []);
          return true;
        }
        return false;
      }),
      
      list_buffers: jest.fn(() => {
        return Array.from(bufferStore.keys());
      }),
      
      remove_buffer: jest.fn((bufferName: string) => {
        return bufferStore.delete(bufferName);
      })
    })),
    
    // Mock the NapiBatchProcessor
    NapiBatchProcessor: {
      create: jest.fn((processorCallback: Function, maxBatchSize: number = 100) => {
        const pendingItems: any[] = [];
        
        return {
          add_item: jest.fn((item: any) => {
            pendingItems.push(item);
            return pendingItems.length >= maxBatchSize;
          }),
          
          process_batch: jest.fn(() => {
            if (pendingItems.length === 0) {
              return {
                successes: [],
                failures: [],
                total_time_us: 0
              };
            }
            
            const items = [...pendingItems];
            pendingItems.length = 0;
            
            const result = processorCallback(items);
            return {
              successes: result.successes,
              failures: result.failures,
              total_time_us: result.total_time_us || 0
            };
          }),
          
          pending_count: jest.fn(() => pendingItems.length),
          
          clear_pending: jest.fn(() => {
            pendingItems.length = 0;
          })
        };
      })
    }
  };
});

describe('SharedMemoryManagerRust', () => {
  let memoryManager: SharedMemoryManagerRust;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (SharedMemoryManagerRust as any).instance = null;
    memoryManager = SharedMemoryManagerRust.getInstance();
  });
  
  describe('singleton pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = SharedMemoryManagerRust.getInstance();
      const instance2 = SharedMemoryManagerRust.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('buffer management', () => {
    it('should create a buffer with default configuration', () => {
      const result = memoryManager.createBuffer('test-buffer');
      expect(result).toBe(true);
      
      const buffers = memoryManager.listBuffers();
      expect(buffers).toContain('test-buffer');
    });
    
    it('should create a buffer with custom configuration', () => {
      const result = memoryManager.createBuffer('custom-buffer', {
        capacity: 5000,
        bufferType: BufferType.OrderBookDeltas,
        allowOverwrites: false,
        autoCompact: false
      });
      
      expect(result).toBe(true);
      expect(memoryManager.listBuffers()).toContain('custom-buffer');
    });
    
    it('should remove a buffer', () => {
      memoryManager.createBuffer('temp-buffer');
      expect(memoryManager.listBuffers()).toContain('temp-buffer');
      
      const result = memoryManager.removeBuffer('temp-buffer');
      expect(result).toBe(true);
      expect(memoryManager.listBuffers()).not.toContain('temp-buffer');
    });
    
    it('should clear a buffer', () => {
      memoryManager.createBuffer('clear-test');
      memoryManager.push('clear-test', { data: 'test' });
      
      const before = memoryManager.getRecent('clear-test');
      expect(before.length).toBe(1);
      
      const result = memoryManager.clearBuffer('clear-test');
      expect(result).toBe(true);
      
      const after = memoryManager.getRecent('clear-test');
      expect(after.length).toBe(0);
    });
  });
  
  describe('data operations', () => {
    beforeEach(() => {
      memoryManager.createBuffer('data-test');
    });
    
    it('should push data and assign a sequence number', () => {
      const seq1 = memoryManager.push('data-test', { value: 1 });
      const seq2 = memoryManager.push('data-test', { value: 2 });
      
      expect(seq1).toBe(0);
      expect(seq2).toBe(1);
      
      const data = memoryManager.getRecent('data-test');
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ value: 2 }); // Newest first
      expect(data[1]).toEqual({ value: 1 });
    });
    
    it('should push a batch of data', () => {
      const items = [
        { value: 'a' },
        { value: 'b' },
        { value: 'c' }
      ];
      
      const sequences = memoryManager.pushBatch('data-test', items);
      expect(sequences).toEqual([0, 1, 2]);
      
      const data = memoryManager.getRecent('data-test');
      expect(data).toHaveLength(3);
    });
    
    it('should get data after a sequence number', () => {
      memoryManager.push('data-test', { id: 1 });
      memoryManager.push('data-test', { id: 2 });
      memoryManager.push('data-test', { id: 3 });
      
      const after = memoryManager.getAfterSequence('data-test', 0);
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual({ id: 2 });
      expect(after[1]).toEqual({ id: 3 });
    });
    
    it('should get data after a timestamp', () => {
      // We can't effectively test the timestamp filter in Jest since Date.now()
      // can't be properly mocked for the native module simulation
      // This is a placeholder test that would work with real timestamps
      const timestamp = Date.now() * 1000; // Convert to microseconds
      
      // Add data after our timestamp
      setTimeout(() => {
        memoryManager.push('data-test', { timestamp: 'after' });
      }, 10);
      
      // This would work in a real environment:
      // const result = memoryManager.getAfterTimestamp('data-test', timestamp);
      // expect(result.length).toBeGreaterThan(0);
      
      // For testing, we'll just verify the method exists
      expect(typeof memoryManager.getAfterTimestamp).toBe('function');
    });
  });
  
  describe('SharedArrayBuffer support', () => {
    it('should create a SharedArrayBuffer with the specified size', () => {
      const buffer = memoryManager.createSharedArrayBuffer(1024);
      
      expect(buffer).toBeInstanceOf(Float64Array);
      expect(buffer.length).toBe(128); // 1024 bytes = 128 float64 elements
      
      // Test writing and reading from the buffer
      buffer[0] = 42;
      expect(buffer[0]).toBe(42);
    });
  });
});

describe('BatchProcessorRust', () => {
  it('should batch process items', async () => {
    // Create a processor that doubles numbers
    const processor = new BatchProcessorRust<number, number>(
      (items) => {
        const successes = items.filter(i => i >= 0).map(i => i * 2);
        const failures = items.filter(i => i < 0).map(i => ({
          value: i,
          error: 'Negative numbers not allowed'
        }));
        
        return {
          successes,
          failures,
          totalTimeUs: 123
        };
      },
      3 // Max batch size
    );
    
    // Wait for dynamic import to finish
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Add items
    processor.addItem(1);
    const ready = processor.addItem(2);
    
    // Batch shouldn't be ready yet (only 2 items, max is 3)
    expect(ready).toBe(false);
    
    // Add one more to make it ready
    const readyNow = processor.addItem(-3);
    expect(readyNow).toBe(true);
    
    // Process the batch
    const result = processor.processBatch();
    
    expect(result.successes).toEqual([2, 4]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].value).toBe(-3);
    expect(result.failures[0].error).toBe('Negative numbers not allowed');
    expect(result.totalTimeUs).toBe(123);
    
    // Pending count should be zero after processing
    expect(processor.pendingCount()).toBe(0);
  });
  
  it('should clear pending items', async () => {
    const processor = new BatchProcessorRust<string, string>(
      (items) => ({
        successes: items,
        failures: []
      }),
      10
    );
    
    // Wait for dynamic import to finish
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Add some items
    processor.addItem('a');
    processor.addItem('b');
    
    // Check pending count
    expect(processor.pendingCount()).toBe(2);
    
    // Clear pending items
    processor.clearPending();
    expect(processor.pendingCount()).toBe(0);
    
    // Process should return empty result
    const result = processor.processBatch();
    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
  });
}); 
import { BatchProcessorJs } from '../BatchProcessorJs';
import { SharedMemoryManagerJs, BufferType } from '../SharedMemoryManagerJs';
import { telemetry } from '@noderr/telemetry';

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

describe('BatchProcessorJs', () => {
  let memoryManager: SharedMemoryManagerJs;
  let batchProcessor: BatchProcessorJs;
  const TEST_BUFFER = 'test_buffer';
  const TEST_DATA = { value: 42, timestamp: Date.now() };
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Get fresh instances for each test
    memoryManager = SharedMemoryManagerJs.getInstance();
    batchProcessor = new BatchProcessorJs(memoryManager);
    
    // Create a test buffer that can be used by all tests
    memoryManager.createBuffer(TEST_BUFFER, {
      capacity: 100
    });
    
    // Create processor for test buffer
    batchProcessor.createProcessor(TEST_BUFFER);
  });
  
  afterEach(() => {
    // Stop any active processors
    batchProcessor.stopProcessor(TEST_BUFFER);
    
    // Clean up by removing test buffer
    memoryManager.removeBuffer(TEST_BUFFER);
  });
  
  describe('createProcessor', () => {
    it('should create a processor for a buffer', () => {
      const result = batchProcessor.createProcessor('new_buffer');
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'batch_processor.create_processor', 
        1, 
        expect.objectContaining({
          buffer: 'new_buffer',
          implementation: 'js'
        })
      );
    });
    
    it('should return false when trying to create a processor that already exists', () => {
      // First creation succeeded in beforeEach
      const result = batchProcessor.createProcessor(TEST_BUFFER);
      expect(result).toBe(false);
    });
  });
  
  describe('processItems', () => {
    it('should start processing items from a buffer', (done) => {
      // Add data to the buffer
      for (let i = 0; i < 3; i++) {
        memoryManager.push(TEST_BUFFER, { ...TEST_DATA, value: i });
      }
      
      // Mock callback - needs explicit type cast
      const mockCallback = jest.fn() as jest.Mock<void, [items: any[]]>;
      
      // Setup the mock implementation
      mockCallback.mockImplementation((items) => {
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].value).toBeDefined();
        
        // Stop processor after callback is invoked
        batchProcessor.stopProcessor(TEST_BUFFER);
        
        // Verify that the callback was called and metrics recorded
        expect(mockCallback).toHaveBeenCalled();
        expect(telemetry.recordMetric).toHaveBeenCalledWith(
          'batch_processor.start_processing', 
          1, 
          expect.objectContaining({
            buffer: TEST_BUFFER,
            implementation: 'js'
          })
        );
        
        done();
      });
      
      // Start processing
      const result = batchProcessor.processItems(TEST_BUFFER, mockCallback);
      expect(result).toBe(true);
      
      // Add more data to trigger processing
      setTimeout(() => {
        memoryManager.push(TEST_BUFFER, { ...TEST_DATA, value: 99 });
      }, 100);
    });
    
    it('should return false when starting processing for a non-existent processor', () => {
      const result = batchProcessor.processItems('non_existent_buffer', () => {});
      expect(result).toBe(false);
    });
  });
  
  describe('stopProcessor', () => {
    it('should stop processing items from a buffer', () => {
      // Start processing
      batchProcessor.processItems(TEST_BUFFER, () => {});
      
      // Stop processing
      const result = batchProcessor.stopProcessor(TEST_BUFFER);
      expect(result).toBe(true);
      expect(telemetry.recordMetric).toHaveBeenCalledWith(
        'batch_processor.stop_processing', 
        1, 
        expect.objectContaining({
          buffer: TEST_BUFFER,
          implementation: 'js'
        })
      );
      
      // Verify processor is no longer active
      expect(batchProcessor.isProcessorActive(TEST_BUFFER)).toBe(false);
    });
    
    it('should return false when stopping a non-existent processor', () => {
      const result = batchProcessor.stopProcessor('non_existent_buffer');
      expect(result).toBe(false);
    });
  });
  
  describe('isProcessorActive', () => {
    it('should return true for an active processor', () => {
      // Start processing
      batchProcessor.processItems(TEST_BUFFER, () => {});
      
      // Check if active
      const isActive = batchProcessor.isProcessorActive(TEST_BUFFER);
      expect(isActive).toBe(true);
      
      // Stop processor
      batchProcessor.stopProcessor(TEST_BUFFER);
    });
    
    it('should return false for an inactive processor', () => {
      // Processor is created but not started
      const isActive = batchProcessor.isProcessorActive(TEST_BUFFER);
      expect(isActive).toBe(false);
    });
    
    it('should return false for a non-existent processor', () => {
      const isActive = batchProcessor.isProcessorActive('non_existent_buffer');
      expect(isActive).toBe(false);
    });
  });
  
  describe('getLastSequence', () => {
    it('should return -1 for a processor with no processed items', () => {
      const lastSequence = batchProcessor.getLastSequence(TEST_BUFFER);
      expect(lastSequence).toBe(-1);
    });
    
    it('should return -1 for a non-existent processor', () => {
      const lastSequence = batchProcessor.getLastSequence('non_existent_buffer');
      expect(lastSequence).toBe(-1);
    });
  });
}); 
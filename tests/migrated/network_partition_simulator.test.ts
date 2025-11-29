import { NetworkPartitionSimulator } from '@noderr/chaos/NetworkPartitionSimulator';
import { ChaosGenerator } from '@noderr/chaos/ChaosGenerator';
import { ChaosSimulationBus } from '@noderr/chaos/ChaosSimulationBus';
import { TelemetryBus } from '@noderr/telemetry/TelemetryBus';

// Mock dependencies
jest.mock('../../chaos/ChaosGenerator');
jest.mock('../../chaos/ChaosSimulationBus');
jest.mock('../../telemetry/TelemetryBus');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('NetworkPartitionSimulator', () => {
  let simulator: NetworkPartitionSimulator;
  let mockChaosGenerator: jest.Mocked<ChaosGenerator>;
  let mockChaosSimulationBus: jest.Mocked<ChaosSimulationBus>;
  let mockTelemetryBus: jest.Mocked<TelemetryBus>;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mock implementations
    mockChaosGenerator = new ChaosGenerator() as jest.Mocked<ChaosGenerator>;
    mockChaosGenerator.registerChaosSource = jest.fn();
    mockChaosGenerator.unregisterChaosSource = jest.fn();
    
    mockChaosSimulationBus = {
      getInstance: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      on: jest.fn(),
    } as unknown as jest.Mocked<ChaosSimulationBus>;
    
    (ChaosSimulationBus as any).getInstance = jest.fn().mockReturnValue(mockChaosSimulationBus);
    
    mockTelemetryBus = {
      getInstance: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as unknown as jest.Mocked<TelemetryBus>;
    
    (TelemetryBus as any).getInstance = jest.fn().mockReturnValue(mockTelemetryBus);
    
    // Create simulator instance with mock generator
    simulator = new NetworkPartitionSimulator(
      {
        partitionProbability: 1.0, // 100% for testing
        minPartitionDurationMs: 100,
        maxPartitionDurationMs: 200,
        enableDetailedLogs: true,
        targetAdapters: ['ethereum', 'solana'],
        errorTypes: ['timeout']
      },
      mockChaosGenerator
    );
  });
  
  test('should initialize with correct configuration', () => {
    expect(mockChaosSimulationBus.on).toHaveBeenCalledTimes(2);
    expect(mockChaosSimulationBus.on).toHaveBeenCalledWith('partition.get_active', expect.any(Function));
    expect(mockChaosSimulationBus.on).toHaveBeenCalledWith('partition.request_intercept', expect.any(Function));
  });
  
  test('should enable network partition simulation', () => {
    simulator.enable();
    
    expect(mockChaosGenerator.registerChaosSource).toHaveBeenCalledWith({
      name: 'network-partition',
      probability: 1.0,
      trigger: expect.any(Function)
    });
  });
  
  test('should disable network partition simulation', () => {
    // First enable it
    simulator.enable();
    
    // Then disable it
    simulator.disable();
    
    expect(mockChaosGenerator.unregisterChaosSource).toHaveBeenCalledWith('network-partition');
  });
  
  test('should trigger partition on specified adapter', () => {
    // Mock Date.now for predictable IDs
    const originalDateNow = Date.now;
    const mockTimestamp = 1234567890;
    Date.now = jest.fn().mockReturnValue(mockTimestamp);
    
    simulator.enable();
    const partitionId = simulator.triggerPartition('ethereum', 1000);
    
    expect(partitionId).toBe(`partition_ethereum_${mockTimestamp}`);
    expect(mockChaosSimulationBus.emit).toHaveBeenCalledWith('partition.start', {
      id: partitionId,
      adapter: 'ethereum',
      duration: 1000,
      errorType: 'timeout',
      timestamp: mockTimestamp,
      affectAllEndpoints: false
    });
    
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith('chaos.network_partition', {
      id: partitionId,
      adapter: 'ethereum',
      duration: 1000,
      errorType: 'timeout',
      timestamp: mockTimestamp
    });
    
    // Restore original Date.now
    Date.now = originalDateNow;
  });
  
  test('should end partition when requested', () => {
    // Mock Date.now for predictable IDs
    const originalDateNow = Date.now;
    const mockTimestamp = 1234567890;
    Date.now = jest.fn().mockReturnValue(mockTimestamp);
    
    simulator.enable();
    const partitionId = simulator.triggerPartition('ethereum', 10000);
    
    // Clear previous calls to mock
    mockChaosSimulationBus.emit.mockClear();
    mockTelemetryBus.emit.mockClear();
    
    // End the partition
    simulator.endPartition(partitionId);
    
    expect(mockChaosSimulationBus.emit).toHaveBeenCalledWith('partition.end', {
      id: partitionId,
      timestamp: mockTimestamp
    });
    
    expect(mockTelemetryBus.emit).toHaveBeenCalledWith('chaos.network_partition_end', {
      id: partitionId,
      timestamp: mockTimestamp
    });
    
    // Check that the partition is removed
    expect(simulator.getActivePartitions()).toHaveLength(0);
    
    // Restore original Date.now
    Date.now = originalDateNow;
  });
  
  test('should trigger random partition', () => {
    // Mock Math.random to pick the first adapter
    const originalMathRandom = Math.random;
    Math.random = jest.fn().mockReturnValue(0.1);
    
    simulator.enable();
    simulator.triggerRandomPartition();
    
    expect(mockChaosSimulationBus.emit).toHaveBeenCalledWith(
      'partition.start',
      expect.objectContaining({
        adapter: 'ethereum'
      })
    );
    
    // Restore original Math.random
    Math.random = originalMathRandom;
  });
  
  test('should auto-end partition after duration', () => {
    jest.useFakeTimers();
    
    simulator.enable();
    const partitionId = simulator.triggerPartition('ethereum', 1000);
    
    // Clear previous calls
    mockChaosSimulationBus.emit.mockClear();
    
    // Fast-forward time
    jest.advanceTimersByTime(1000);
    
    // Check that partition.end was emitted
    expect(mockChaosSimulationBus.emit).toHaveBeenCalledWith(
      'partition.end',
      expect.objectContaining({
        id: partitionId
      })
    );
    
    // Check that the partition is removed
    expect(simulator.getActivePartitions()).toHaveLength(0);
    
    jest.useRealTimers();
  });
  
  test('should not trigger partition when disabled', () => {
    const partitionId = simulator.triggerPartition('ethereum');
    
    expect(partitionId).toBe('');
    expect(mockChaosSimulationBus.emit).not.toHaveBeenCalled();
  });
  
  test('should handle request interception correctly', () => {
    simulator.enable();
    simulator.triggerPartition('ethereum', 1000);
    
    // Get the interception handler
    const interceptHandler = mockChaosSimulationBus.on.mock.calls.find(
      call => call[0] === 'partition.request_intercept'
    )?.[1];
    
    expect(interceptHandler).toBeDefined();
    
    if (interceptHandler) {
      // Should intercept ethereum requests
      const shouldIntercept = interceptHandler({ adapter: 'ethereum', endpoint: 'https://example.com' });
      expect(shouldIntercept).toBe(true);
      
      // Should not intercept other adapters
      const shouldNotIntercept = interceptHandler({ adapter: 'polkadot', endpoint: 'https://example.com' });
      expect(shouldNotIntercept).toBe(false);
    }
  });
}); 
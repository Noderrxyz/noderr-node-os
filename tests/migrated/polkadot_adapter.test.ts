import { PolkadotAdapter } from '@noderr/execution/src/adapters/PolkadotAdapter';
import { StrategyGenome } from '@noderr/evolution/StrategyGenome';

// Mock dependencies
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock StrategyGenome
jest.mock('../../evolution/StrategyGenome');

describe('PolkadotAdapter', () => {
  let polkadotAdapter: PolkadotAdapter;
  let mockGenome: jest.Mocked<StrategyGenome>;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock genome
    mockGenome = {
      getId: jest.fn().mockReturnValue('test-strategy-123'),
      getName: jest.fn().mockReturnValue('Test Strategy'),
      getScore: jest.fn().mockReturnValue(0.85)
    } as unknown as jest.Mocked<StrategyGenome>;
    
    // Create adapter instance with test configuration
    polkadotAdapter = new PolkadotAdapter({
      rpcUrls: ['wss://rpc-test.polkadot.io'],
      networkName: 'polkadot-test',
      chainId: 'polkadot-test',
      useXcm: true,
      xcmInfo: {
        kusama: {
          destinationParaId: 1000,
          xcmVersion: 3,
          timeout: 600000 // 10 minutes
        }
      }
    });
  });
  
  test('should initialize adapter successfully', async () => {
    await polkadotAdapter.initialize();
    expect(polkadotAdapter.isInitialized()).toBe(true);
  });
  
  test('should return correct chain ID', () => {
    expect(polkadotAdapter.getChainId()).toBe('polkadot-polkadot-test');
  });
  
  test('should estimate fees for normal transaction', async () => {
    await polkadotAdapter.initialize();
    
    const feeEstimation = await polkadotAdapter.estimateFees(
      mockGenome,
      'DOT/USD',
      {
        amount: 1.0,
        slippageTolerance: 0.5,
        timeoutMs: 30000
      }
    );
    
    expect(feeEstimation).toBeDefined();
    expect(feeEstimation.estimatedFee).toBeDefined();
    expect(feeEstimation.recommendedFees).toBeDefined();
    expect(feeEstimation.chainSpecific).toHaveProperty('xcmEnabled', true);
    expect(feeEstimation.chainSpecific).toHaveProperty('isXcmTransaction', false);
  });
  
  test('should estimate fees for XCM transaction', async () => {
    await polkadotAdapter.initialize();
    
    const feeEstimation = await polkadotAdapter.estimateFees(
      mockGenome,
      'DOT/KSM',
      {
        amount: 1.0,
        slippageTolerance: 0.5,
        timeoutMs: 30000,
        chainSpecific: {
          xcmDestination: 'kusama'
        }
      }
    );
    
    expect(feeEstimation).toBeDefined();
    expect(feeEstimation.estimatedFee).toBeDefined();
    expect(feeEstimation.recommendedFees).toBeDefined();
    expect(feeEstimation.chainSpecific).toHaveProperty('xcmEnabled', true);
    expect(feeEstimation.chainSpecific).toHaveProperty('isXcmTransaction', true);
    
    // XCM fees should be higher than regular transactions
    expect(feeEstimation.estimatedFee).toBeGreaterThan(0.1);
  });
  
  test('should execute strategy successfully', async () => {
    await polkadotAdapter.initialize();
    
    const result = await polkadotAdapter.executeStrategy(
      mockGenome,
      'DOT/USD',
      {
        amount: 1.0,
        slippageTolerance: 0.5,
        timeoutMs: 30000
      }
    );
    
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
    expect(result.blockHeight).toBeGreaterThan(0);
  });
  
  test('should execute XCM transaction successfully', async () => {
    await polkadotAdapter.initialize();
    
    const result = await polkadotAdapter.executeStrategy(
      mockGenome,
      'DOT/KSM',
      {
        amount: 5.0,
        slippageTolerance: 1.0,
        timeoutMs: 60000,
        chainSpecific: {
          xcmDestination: 'kusama'
        }
      }
    );
    
    expect(result.success).toBe(true);
    expect(result.transactionId).toBeDefined();
    expect(result.blockHeight).toBeGreaterThan(0);
    expect(result.chainSpecific).toHaveProperty('events');
    expect(result.chainSpecific?.events).toContain('XcmMessageSent');
  });
  
  test('should handle XCM transaction with missing configuration', async () => {
    await polkadotAdapter.initialize();
    
    const result = await polkadotAdapter.executeStrategy(
      mockGenome,
      'DOT/KSM',
      {
        amount: 5.0,
        slippageTolerance: 1.0,
        timeoutMs: 60000,
        chainSpecific: {
          xcmDestination: 'nonexistent'
        }
      }
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('XCM configuration not found');
  });
  
  test('should get chain health status', async () => {
    await polkadotAdapter.initialize();
    
    const status = await polkadotAdapter.getChainHealthStatus();
    
    expect(status.isOperational).toBe(true);
    expect(status.currentBlockHeight).toBeGreaterThan(0);
    expect(status.averageBlockTimeMs).toBe(6000);
    expect(status.chainSpecific).toHaveProperty('xcmEnabled', true);
    expect(status.chainSpecific).toHaveProperty('supportedXcmVersion', 3);
  });
  
  test('should validate strategy before execution', async () => {
    await polkadotAdapter.initialize();
    
    const isValid = await polkadotAdapter.validateStrategy(
      mockGenome,
      'DOT/USD'
    );
    
    expect(isValid).toBe(true);
  });
}); 
/**
 * TransactionGuard Tests
 * 
 * Tests for the Transaction Risk Mitigation Layer.
 */

import { TransactionGuard, TransactionGuardConfig } from './TransactionGuard.js';
import { ProtectiveWrapper, ProtectiveStrategy } from './ProtectiveWrapper.js';
import { OrderIntent, ExecutedOrder } from '../../types/execution.types.js';
import { SmartOrderRouter } from '../../infra/router/SmartOrderRouter.js';
import { TrustEngine } from '../../infra/risk/TrustEngine.js';

// Mock dependencies
jest.mock('../../infra/router/SmartOrderRouter.js');
jest.mock('../../infra/risk/TrustEngine.js');

describe('TransactionGuard', () => {
  // Test configuration
  const testConfig: TransactionGuardConfig = {
    enableSimulation: true,
    enableReversionAnalysis: true,
    enableProtectiveWrappers: true,
    enableRateLimiting: true,
    highRiskThreshold: 0.6,
    maxAcceptableSlippageBps: 150,
    volatilityThreshold: 0.4,
    baseCooldownMs: 5000, // Shorter for tests
    maxCooldownMs: 20000, // Shorter for tests
    maxReversionHistory: 100,
    emitEvents: true
  };
  
  // Mock router and trust engine
  let mockRouter: jest.Mocked<SmartOrderRouter>;
  let mockTrustEngine: jest.Mocked<TrustEngine>;
  let transactionGuard: TransactionGuard;
  
  // Mock order for testing
  const mockOrder: OrderIntent = {
    asset: 'ETH/USDC',
    side: 'buy',
    quantity: 1.5,
    urgency: 'medium',
    maxSlippageBps: 100
  };
  
  // Mock executed order for success scenario
  const mockExecutedOrder: ExecutedOrder = {
    intent: mockOrder,
    venue: 'uniswap_v3',
    orderId: 'test-order-123',
    executedPrice: 1800,
    executedQuantity: 1.5,
    timestamp: Date.now(),
    status: 'filled',
    latencyMs: 250,
    slippageBps: 80,
    fees: {
      asset: 'ETH',
      amount: 0.001
    }
  };
  
  beforeAll(() => {
    // Set up mocked dependencies
    mockRouter = new SmartOrderRouter([], {} as TrustEngine) as jest.Mocked<SmartOrderRouter>;
    mockTrustEngine = {} as jest.Mocked<TrustEngine>;
    
    // Mock required methods
    mockTrustEngine.getVenueTrust = jest.fn().mockResolvedValue(0.8);
    mockTrustEngine.penalizeVenue = jest.fn().mockResolvedValue(undefined);
    mockTrustEngine.rewardVenue = jest.fn().mockResolvedValue(undefined);
    
    // Create transaction guard instance
    transactionGuard = new TransactionGuard(
      mockRouter,
      mockTrustEngine,
      testConfig
    );
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('validateTransaction', () => {
    it('should allow low-risk transactions', async () => {
      // Make a mock risk report have low risk
      jest.spyOn(transactionGuard as any, 'calculatePoolVolatility')
        .mockResolvedValue(0.1);
      
      jest.spyOn(transactionGuard as any, 'calculateRiskScore')
        .mockResolvedValue(0.3);
      
      jest.spyOn(transactionGuard as any, 'simulateTransaction')
        .mockResolvedValue({
          success: true,
          slippageBps: 50,
          gasEstimate: 150000,
          gasPrice: 30
        });
      
      // Test validation
      const result = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      expect(result.guardAction).toBe('allowed');
      expect(result.riskScore).toBeLessThan(testConfig.highRiskThreshold);
      expect(result.simulatedSuccess).toBe(true);
    });
    
    it('should wrap high-risk transactions', async () => {
      // Make a mock risk report have high risk
      jest.spyOn(transactionGuard as any, 'calculatePoolVolatility')
        .mockResolvedValue(0.4);
        
      jest.spyOn(transactionGuard as any, 'calculateRiskScore')
        .mockResolvedValue(0.7); // Above threshold
      
      jest.spyOn(transactionGuard as any, 'simulateTransaction')
        .mockResolvedValue({
          success: true,
          slippageBps: 120,
          gasEstimate: 180000,
          gasPrice: 40
        });
      
      // Test validation
      const result = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      expect(result.guardAction).toBe('wrapped');
      expect(result.riskScore).toBeGreaterThan(testConfig.highRiskThreshold);
      expect(result.simulatedSuccess).toBe(true);
    });
    
    it('should block transactions with failed simulation', async () => {
      jest.spyOn(transactionGuard as any, 'calculatePoolVolatility')
        .mockResolvedValue(0.2);
      
      jest.spyOn(transactionGuard as any, 'simulateTransaction')
        .mockResolvedValue({
          success: false,
          slippageBps: 0,
          gasEstimate: 0,
          gasPrice: 0,
          errorMessage: 'Insufficient liquidity'
        });
      
      // Test validation
      const result = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      expect(result.guardAction).toBe('blocked');
      expect(result.simulatedSuccess).toBe(false);
      expect(result.reason).toBe('Insufficient liquidity');
    });
    
    it('should block transactions with excessive slippage', async () => {
      jest.spyOn(transactionGuard as any, 'calculatePoolVolatility')
        .mockResolvedValue(0.2);
      
      jest.spyOn(transactionGuard as any, 'simulateTransaction')
        .mockResolvedValue({
          success: true,
          slippageBps: 300, // Higher than max
          gasEstimate: 150000,
          gasPrice: 30
        });
      
      // Test validation
      const result = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      expect(result.guardAction).toBe('blocked');
      expect(result.simulatedSuccess).toBe(true);
      expect(result.slippageEstimate).toBeGreaterThan(testConfig.maxAcceptableSlippageBps);
    });
  });
  
  describe('handleFailedTransaction', () => {
    it('should record reversion and update rate limiting', async () => {
      // Spy on internal methods
      const recordReversionSpy = jest.spyOn(transactionGuard as any, 'recordReversion');
      const updateRateLimitSpy = jest.spyOn(transactionGuard as any, 'updateRateLimit');
      
      // Handle a failed transaction
      transactionGuard.handleFailedTransaction(
        mockOrder,
        'uniswap_v3',
        new Error('Transaction reverted: slippage too high')
      );
      
      // Verify behavior
      expect(recordReversionSpy).toHaveBeenCalledTimes(1);
      expect(updateRateLimitSpy).toHaveBeenCalledWith(mockOrder.asset);
      expect(mockTrustEngine.penalizeVenue).toHaveBeenCalledWith(
        'uniswap_v3',
        expect.stringContaining('Transaction failed'),
        expect.any(Number)
      );
    });
  });
  
  describe('handleSuccessfulTransaction', () => {
    it('should reset rate limiting and reward venue', async () => {
      // Spy on internal methods
      const resetRateLimitSpy = jest.spyOn(transactionGuard as any, 'resetRateLimit');
      
      // Handle a successful transaction
      transactionGuard.handleSuccessfulTransaction(mockExecutedOrder);
      
      // Verify behavior
      expect(resetRateLimitSpy).toHaveBeenCalledWith(mockOrder.asset);
      expect(mockTrustEngine.rewardVenue).toHaveBeenCalledWith(
        'uniswap_v3',
        'Successful execution',
        expect.any(Number)
      );
    });
  });
  
  describe('rate limiting', () => {
    it('should delay transactions after failures', async () => {
      // First record some failures
      transactionGuard.handleFailedTransaction(
        mockOrder,
        'uniswap_v3',
        new Error('Transaction failed: insufficient funds')
      );
      
      // Spy on shouldDelayTransaction
      const shouldDelaySpy = jest.spyOn(transactionGuard as any, 'shouldDelayTransaction')
        .mockReturnValue(true);
      
      // Now try to validate a new transaction
      const result = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      // Should be delayed
      expect(result.guardAction).toBe('delayed');
      expect(result.reason).toContain('Rate limited');
      expect(shouldDelaySpy).toHaveBeenCalledWith(mockOrder.asset);
    });
  });
  
  describe('integration with ProtectiveWrapper', () => {
    it('should work with ProtectiveWrapper', async () => {
      // Create instance of ProtectiveWrapper
      const protectiveWrapper = new ProtectiveWrapper();
      
      // Mock execution function
      const executeFunc = jest.fn().mockResolvedValue(mockExecutedOrder);
      
      // Mock validateTransaction to return a wrapped action for high risk
      jest.spyOn(transactionGuard, 'validateTransaction').mockResolvedValue({
        id: 'test-report-id',
        asset: mockOrder.asset,
        venueId: 'uniswap_v3',
        riskScore: 0.7,
        simulatedSuccess: true,
        slippageEstimate: 100,
        gasEstimate: 150000,
        gasPrice: 30,
        blockNumber: 12345678,
        guardAction: 'wrapped',
        poolVolatility: 0.4,
        timestamp: Date.now()
      });
      
      // Simulate a full execution flow
      const riskReport = await transactionGuard.validateTransaction(mockOrder, 'uniswap_v3');
      
      expect(riskReport.guardAction).toBe('wrapped');
      
      if (riskReport.guardAction === 'wrapped') {
        // Use protective wrapper
        const result = await protectiveWrapper.wrapExecution(
          executeFunc,
          mockOrder,
          ProtectiveStrategy.FAIL_SILENT
        );
        
        expect(result.success).toBe(true);
        expect(result.executedOrder).toBe(mockExecutedOrder);
        expect(executeFunc).toHaveBeenCalledWith(mockOrder);
        
        // Report success
        transactionGuard.handleSuccessfulTransaction(mockExecutedOrder);
      }
    });
  });
}); 
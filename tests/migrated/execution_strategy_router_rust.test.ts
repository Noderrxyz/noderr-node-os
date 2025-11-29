import { ExecutionStrategyRouterRust, ExecutionAlgorithm } from '../../execution/ExecutionStrategyRouterRust';
import { Order, OrderSide } from '../../execution/order';
import { ExecutionResult } from '../../execution/types';

// Mock the NapiExecutionStrategyRouter
jest.mock('@noderr/core', () => {
  const originalModule = jest.requireActual('@noderr/core');
  
  return {
    ...originalModule,
    NapiExecutionStrategyRouter: jest.fn().mockImplementation(() => ({
      execute_order: jest.fn((order: any, callback) => {
        // Simulate successful execution after a short delay
        setTimeout(() => {
          callback({
            id: `executed-${Date.now()}`,
            request_id: order.id,
            signal_id: 'test-signal',
            status: 'success',
            order_id: `ord-${order.id}`,
            executed_quantity: order.amount,
            average_price: order.price * 1.001, // Slight slippage
            fee_info: 'test fee info',
            fees: order.amount * order.price * 0.001,
            fee_currency: 'USD',
            timestamp: new Date(),
            execution_time_ms: 50,
            latency_profile: {
              order_creation: 5,
              network: 20,
              execution: 25,
            },
            error_message: null,
            error_context: null,
            realized_pnl: 0,
            additional_data: {},
            rejection_details: null,
            trust_score: 0.95,
          });
        }, 10);
        return Promise.resolve();
      }),
      estimate_impact: jest.fn().mockResolvedValue(0.002),
      get_cost_estimate: jest.fn().mockImplementation((order: any) => {
        return Promise.resolve(order.amount * order.price * 0.0015);
      }),
      cancel_execution: jest.fn().mockResolvedValue(undefined),
      update_config: jest.fn().mockResolvedValue(undefined),
    })),
    ExecutionAlgorithm: originalModule.ExecutionAlgorithm || {
      TWAP: 'TWAP',
      VWAP: 'VWAP',
      ImplementationShortfall: 'ImplementationShortfall',
      Iceberg: 'Iceberg',
      Pegged: 'Pegged',
      DMA: 'DMA',
      SmartOrderRouting: 'SmartOrderRouting',
    }
  };
});

describe('ExecutionStrategyRouterRust', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    (ExecutionStrategyRouterRust as any).instance = null;
    jest.clearAllMocks();
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const router1 = ExecutionStrategyRouterRust.getInstance();
      const router2 = ExecutionStrategyRouterRust.getInstance();
      
      expect(router1).toBe(router2);
    });

    it('should accept custom configuration', () => {
      const customConfig = {
        defaultStrategy: ExecutionAlgorithm.VWAP,
        minOrderSizeForVwap: 2000,
      };
      
      // Spy on the private constructor
      const constructorSpy = jest.spyOn(ExecutionStrategyRouterRust as any, 'constructor');
      
      ExecutionStrategyRouterRust.getInstance(customConfig);
      
      expect(constructorSpy).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should execute an order successfully', async () => {
      const router = ExecutionStrategyRouterRust.getInstance();
      const order: Order = {
        id: 'test-order-1',
        symbol: 'BTC-USD',
        side: OrderSide.Buy,
        amount: 1.5,
        price: 50000,
        venues: ['binance', 'coinbase'],
        maxSlippage: 0.005,
        maxRetries: 3,
        additionalParams: {
          executionMode: 'aggressive'
        }
      };
      
      const onCompleteMock = jest.fn();
      
      await router.execute(order, onCompleteMock);
      
      // Wait for the callback to be called
      await new Promise(resolve => setTimeout(resolve, 20));
      
      expect(onCompleteMock).toHaveBeenCalled();
      const result: ExecutionResult = onCompleteMock.mock.calls[0][0];
      
      expect(result.status).toBe('success');
      expect(result.executed_quantity).toBe(order.amount);
      expect(result.request_id).toBe(order.id);
    });

    it('should handle execution errors gracefully', async () => {
      // Mock the execute_order method to throw an error
      const mockExecute = jest.fn().mockImplementation(() => {
        throw new Error('Execution failed');
      });
      
      // @ts-ignore - accessing private property for testing
      ExecutionStrategyRouterRust.getInstance().router.execute_order = mockExecute;
      
      const router = ExecutionStrategyRouterRust.getInstance();
      const order: Order = {
        id: 'test-order-error',
        symbol: 'ETH-USD',
        side: OrderSide.Sell,
        amount: 10,
        price: 2000,
        venues: ['kraken'],
        maxSlippage: 0.01,
        maxRetries: 2,
      };
      
      const onCompleteMock = jest.fn();
      
      await router.execute(order, onCompleteMock);
      
      expect(onCompleteMock).toHaveBeenCalled();
      const result: ExecutionResult = onCompleteMock.mock.calls[0][0];
      
      expect(result.status).toBe('failed');
      expect(result.error_message).toBe('Execution failed');
    });
  });

  describe('estimateImpact', () => {
    it('should return a valid impact estimate', async () => {
      const router = ExecutionStrategyRouterRust.getInstance();
      const order: Order = {
        id: 'test-impact',
        symbol: 'BTC-USD',
        side: OrderSide.Buy,
        amount: 5,
        price: 50000,
        venues: ['binance'],
      };
      
      const impact = await router.estimateImpact(order);
      
      expect(impact).toBe(0.002);
    });

    it('should handle errors and return default impact', async () => {
      // Mock the estimate_impact method to throw an error
      const mockEstimate = jest.fn().mockImplementation(() => {
        throw new Error('Impact estimation failed');
      });
      
      // @ts-ignore - accessing private property for testing
      ExecutionStrategyRouterRust.getInstance().router.estimate_impact = mockEstimate;
      
      const router = ExecutionStrategyRouterRust.getInstance();
      const order: Order = {
        id: 'test-impact-error',
        symbol: 'ETH-USD',
        side: OrderSide.Sell,
        amount: 10,
        price: 2000,
        venues: ['kraken'],
      };
      
      const impact = await router.estimateImpact(order);
      
      expect(impact).toBe(0.003); // Default fallback
    });
  });

  describe('getCostEstimate', () => {
    it('should return a valid cost estimate', async () => {
      const router = ExecutionStrategyRouterRust.getInstance();
      const order: Order = {
        id: 'test-cost',
        symbol: 'BTC-USD',
        side: OrderSide.Buy,
        amount: 2,
        price: 50000,
        venues: ['binance'],
      };
      
      const cost = await router.getCostEstimate(order);
      
      // Expected cost: amount * price * 0.0015
      expect(cost).toBe(2 * 50000 * 0.0015);
    });
  });

  describe('cancelExecution', () => {
    it('should call the native cancel_execution method', async () => {
      const router = ExecutionStrategyRouterRust.getInstance();
      
      // @ts-ignore - accessing private property for testing
      const cancelSpy = jest.spyOn(router.router, 'cancel_execution');
      
      await router.cancelExecution('test-order-cancel');
      
      expect(cancelSpy).toHaveBeenCalledWith('test-order-cancel');
    });
  });

  describe('updateConfig', () => {
    it('should update the router configuration', async () => {
      const router = ExecutionStrategyRouterRust.getInstance();
      
      // @ts-ignore - accessing private property for testing
      const updateSpy = jest.spyOn(router.router, 'update_config');
      
      const newConfig = {
        defaultStrategy: ExecutionAlgorithm.VWAP,
        minOrderSizeForVwap: 3000,
        twapConfig: {
          slices: 10,
          intervalMs: 30000,
          maxIntervalDeviationMs: 5000,
          minExecutionPct: 0.9,
          randomizeSizes: true,
          sizeDeviationPct: 0.05
        },
      };
      
      await router.updateConfig(newConfig);
      
      expect(updateSpy).toHaveBeenCalled();
    });
  });
}); 
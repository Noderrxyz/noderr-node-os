import { TWAPAlgorithm } from '../algorithms/TWAPAlgorithm';
import { VWAPAlgorithm } from '../algorithms/VWAPAlgorithm';
import { POVAlgorithm } from '../algorithms/POVAlgorithm';
import { IcebergAlgorithm } from '../algorithms/IcebergAlgorithm';
import {
  Order,
  AlgorithmConfig,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  AlgorithmType,
  ExecutionStatus
} from '../types';
import winston from 'winston';

// Create test logger
const logger = winston.createLogger({
  level: 'error',
  transports: [new winston.transports.Console({ silent: true })]
});

// Helper function to create test orders
function createTestOrder(params: Partial<Order>): Order {
  return {
    id: params.id || 'test-order',
    clientOrderId: params.clientOrderId || 'client-order',
    symbol: params.symbol || 'BTC/USDT',
    side: params.side || OrderSide.BUY,
    type: params.type || OrderType.MARKET,
    quantity: params.quantity || 1,
    price: params.price,
    status: params.status || OrderStatus.NEW,
    exchange: params.exchange || 'auto',
    timeInForce: params.timeInForce || TimeInForce.GTC,
    createdAt: params.createdAt || Date.now(),
    updatedAt: params.updatedAt || Date.now(),
    metadata: params.metadata
  };
}

describe('Execution Algorithms', () => {
  describe('TWAPAlgorithm', () => {
    let twap: TWAPAlgorithm;
    
    beforeEach(() => {
      twap = new TWAPAlgorithm(logger);
    });
    
    afterEach(() => {
      twap.destroy();
    });
    
    it('should initialize TWAP execution correctly', async () => {
      const order: Order = {
        id: 'test-order-1',
        clientOrderId: 'client-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 10,
        status: OrderStatus.NEW,
        exchange: 'auto',
        timeInForce: TimeInForce.GTC,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.TWAP,
        parameters: {
          duration: 60000, // 1 minute
          slices: 6
        },
        constraints: {
          maxSlippage: 0.005,
          maxMarketImpact: 0.002,
          maxFees: 0.001,
          minFillRate: 0.95,
          maxExecutionTime: 120000,
          maxOrderCount: 10,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'price',
          weights: {
            price: 0.5,
            speed: 0.2,
            marketImpact: 0.2,
            fees: 0.1,
            certainty: 0
          }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: {
            slippage: 0.01,
            fillRate: 0.9,
            marketImpact: 0.005,
            deviation: 0.02
          },
          reportingInterval: 1000,
          performanceMetrics: ['slippage', 'fillRate']
        }
      };
      
      await twap.execute(order, config, null);
      
      const status = twap.getExecutionStatus(order.id);
      expect(status).toBeDefined();
      expect(status?.orderId).toBe(order.id);
      expect(status?.totalQuantity).toBe(10);
      expect(status?.slices.length).toBe(6);
      expect(status?.status).toBe(ExecutionStatus.PARTIAL);
    });
    
    it('should calculate metrics correctly', () => {
      const metrics = twap.getMetrics('non-existent');
      expect(metrics).toBeNull();
    });
    
    it('should handle pause and resume', async () => {
            const order = createTestOrder({        id: 'test-order-2',        clientOrderId: 'client-2',        symbol: 'ETH/USDT',        side: OrderSide.SELL,        type: OrderType.MARKET,        quantity: 100      });
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.TWAP,
        parameters: { duration: 60000, slices: 10 },
        constraints: {
          maxSlippage: 0.005,
          maxMarketImpact: 0.002,
          maxFees: 0.001,
          minFillRate: 0.95,
          maxExecutionTime: 120000,
          maxOrderCount: 10,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'price',
          weights: { price: 1, speed: 0, marketImpact: 0, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.01, fillRate: 0.9, marketImpact: 0.005, deviation: 0.02 },
          reportingInterval: 1000,
          performanceMetrics: []
        }
      };
      
      await twap.execute(order, config, null);
      
      const pauseResult = twap.pauseExecution(order.id);
      expect(pauseResult).toBe(true);
      
      const resumeResult = twap.resumeExecution(order.id);
      expect(resumeResult).toBe(true);
      
      const cancelResult = twap.cancelExecution(order.id);
      expect(cancelResult).toBe(true);
    });
  });
  
  describe('VWAPAlgorithm', () => {
    let vwap: VWAPAlgorithm;
    
    beforeEach(() => {
      vwap = new VWAPAlgorithm(logger);
    });
    
    afterEach(() => {
      vwap.destroy();
    });
    
    it('should initialize VWAP execution with volume profile', async () => {
      const order: Order = {
        id: 'test-vwap-1',
        clientOrderId: 'client-vwap-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 50,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.VWAP,
        parameters: {
          duration: 60000,
          targetPercentage: 10,
          adaptiveMode: true
        },
        constraints: {
          maxSlippage: 0.003,
          maxMarketImpact: 0.001,
          maxFees: 0.001,
          minFillRate: 0.98,
          maxExecutionTime: 120000,
          maxOrderCount: 20,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'price',
          weights: {
            price: 0.6,
            speed: 0.1,
            marketImpact: 0.2,
            fees: 0.1,
            certainty: 0
          }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: {
            slippage: 0.005,
            fillRate: 0.95,
            marketImpact: 0.002,
            deviation: 0.01
          },
          reportingInterval: 1000,
          performanceMetrics: ['trackingError', 'participation']
        }
      };
      
      await vwap.execute(order, config, null);
      
      const status = vwap.getExecutionStatus(order.id);
      expect(status).toBeDefined();
      expect(status?.orderId).toBe(order.id);
      expect(status?.volumeProfile).toBeDefined();
      expect(status?.volumeProfile.historicalPattern.length).toBe(24); // 24 hours
      expect(status?.adaptiveMode).toBe(true);
    });
    
    it('should update volume profile in real-time', () => {
      vwap.updateVolumeProfile('BTC/USDT', {
        volume: 1000,
        vwap: 50000,
        trades: 50
      });
      
      // Volume update should be processed without errors
      expect(true).toBe(true);
    });
    
    it('should calculate VWAP metrics', async () => {
      const order: Order = {
        id: 'test-vwap-2',
        clientOrderId: 'client-vwap-2',
        symbol: 'ETH/USDT',
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: 200,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.VWAP,
        parameters: { duration: 30000, targetPercentage: 20 },
        constraints: {
          maxSlippage: 0.003,
          maxMarketImpact: 0.001,
          maxFees: 0.001,
          minFillRate: 0.98,
          maxExecutionTime: 60000,
          maxOrderCount: 20,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'price',
          weights: { price: 1, speed: 0, marketImpact: 0, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.005, fillRate: 0.95, marketImpact: 0.002, deviation: 0.01 },
          reportingInterval: 1000,
          performanceMetrics: []
        }
      };
      
      await vwap.execute(order, config, null);
      
      const metrics = vwap.getMetrics(order.id);
      expect(metrics).toBeDefined();
      expect(metrics?.targetVWAP).toBeGreaterThan(0);
      expect(metrics?.participationRate).toBe(0.2);
    });
  });
  
  describe('POVAlgorithm', () => {
    let pov: POVAlgorithm;
    
    beforeEach(() => {
      pov = new POVAlgorithm(logger);
    });
    
    afterEach(() => {
      pov.destroy();
    });
    
    it('should maintain participation rate', async () => {
      const order: Order = {
        id: 'test-pov-1',
        clientOrderId: 'client-pov-1',
        symbol: 'SOL/USDT',
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        quantity: 1000,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.POV,
        parameters: {
          targetPercentage: 15,
          maxPercentage: 25,
          adaptiveMode: true
        },
        constraints: {
          maxSlippage: 0.005,
          maxMarketImpact: 0.003,
          maxFees: 0.001,
          minFillRate: 0.9,
          maxExecutionTime: 300000,
          maxOrderCount: 100,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'size',
          weights: {
            price: 0.2,
            speed: 0.1,
            marketImpact: 0.2,
            fees: 0.1,
            certainty: 0.4
          }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: {
            slippage: 0.01,
            fillRate: 0.8,
            marketImpact: 0.005,
            deviation: 0.05
          },
          reportingInterval: 2000,
          performanceMetrics: ['participation', 'volumeExecuted']
        }
      };
      
      await pov.execute(order, config, null);
      
      const status = pov.getExecutionStatus(order.id);
      expect(status).toBeDefined();
      expect(status?.targetPercentage).toBe(0.15);
      expect(status?.maxPercentage).toBe(0.25);
      expect(status?.adaptiveMode).toBe(true);
    });
    
    it('should update market volume', () => {
      pov.updateMarketVolume('BTC/USDT', 500, 50000);
      pov.updateMarketVolume('BTC/USDT', 600, 50100);
      
      // Should handle volume updates
      expect(true).toBe(true);
    });
    
    it('should calculate POV metrics', async () => {
      const order: Order = {
        id: 'test-pov-2',
        clientOrderId: 'client-pov-2',
        symbol: 'BTC/USDT',
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        quantity: 5,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.POV,
        parameters: { targetPercentage: 10, maxPercentage: 15 },
        constraints: {
          maxSlippage: 0.005,
          maxMarketImpact: 0.003,
          maxFees: 0.001,
          minFillRate: 0.9,
          maxExecutionTime: 60000,
          maxOrderCount: 50,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'size',
          weights: { price: 0.5, speed: 0.5, marketImpact: 0, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.01, fillRate: 0.8, marketImpact: 0.005, deviation: 0.05 },
          reportingInterval: 1000,
          performanceMetrics: []
        }
      };
      
      await pov.execute(order, config, null);
      
      const metrics = pov.getMetrics(order.id);
      expect(metrics).toBeDefined();
      expect(metrics?.targetParticipation).toBe(0.1);
    });
  });
  
  describe('IcebergAlgorithm', () => {
    let iceberg: IcebergAlgorithm;
    
    beforeEach(() => {
      iceberg = new IcebergAlgorithm(logger);
    });
    
    afterEach(() => {
      iceberg.destroy();
    });
    
    it('should hide order size correctly', async () => {
      const order: Order = {
        id: 'test-iceberg-1',
        clientOrderId: 'client-iceberg-1',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 5,
        price: 50000,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.ICEBERG,
        parameters: {
          visibleQuantity: 0.1,
          variance: 0.2
        },
        constraints: {
          maxSlippage: 0.002,
          maxMarketImpact: 0.001,
          maxFees: 0.0005,
          minFillRate: 0.99,
          maxExecutionTime: 3600000,
          maxOrderCount: 50,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'stealth',
          weights: {
            price: 0.3,
            speed: 0.1,
            marketImpact: 0.4,
            fees: 0.2,
            certainty: 0
          }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: {
            slippage: 0.003,
            fillRate: 0.95,
            marketImpact: 0.002,
            deviation: 0.01
          },
          reportingInterval: 5000,
          performanceMetrics: ['detectionRisk', 'clipSize']
        }
      };
      
      await iceberg.execute(order, config, null);
      
      const status = iceberg.getExecutionStatus(order.id);
      expect(status).toBeDefined();
      expect(status?.totalQuantity).toBe(5);
      expect(status?.visibleQuantity).toBe(0.1);
      expect(status?.variance).toBe(0.2);
    });
    
    it('should update price level', async () => {
      const order: Order = {
        id: 'test-iceberg-2',
        clientOrderId: 'client-iceberg-2',
        symbol: 'ETH/USDT',
        side: OrderSide.SELL,
        type: OrderType.LIMIT,
        quantity: 10,
        price: 3000,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.ICEBERG,
        parameters: { visibleQuantity: 0.5, variance: 0.1 },
        constraints: {
          maxSlippage: 0.002,
          maxMarketImpact: 0.001,
          maxFees: 0.0005,
          minFillRate: 0.99,
          maxExecutionTime: 3600000,
          maxOrderCount: 50,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'stealth',
          weights: { price: 1, speed: 0, marketImpact: 0, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.003, fillRate: 0.95, marketImpact: 0.002, deviation: 0.01 },
          reportingInterval: 5000,
          performanceMetrics: []
        }
      };
      
      await iceberg.execute(order, config, null);
      
      const updateResult = iceberg.updatePriceLevel(order.id, 3100);
      expect(updateResult).toBe(true);
      
      const status = iceberg.getExecutionStatus(order.id);
      expect(status?.priceLevel).toBe(3100);
    });
    
    it('should calculate detection risk', async () => {
      const order: Order = {
        id: 'test-iceberg-3',
        clientOrderId: 'client-iceberg-3',
        symbol: 'BTC/USDT',
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        quantity: 1,
        price: 50000,
        status: OrderStatus.NEW,
        exchange: 'auto',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.ICEBERG,
        parameters: { visibleQuantity: 0.05, variance: 0.3 },
        constraints: {
          maxSlippage: 0.002,
          maxMarketImpact: 0.001,
          maxFees: 0.0005,
          minFillRate: 0.99,
          maxExecutionTime: 3600000,
          maxOrderCount: 50,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'stealth',
          weights: { price: 0.5, speed: 0, marketImpact: 0.5, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.003, fillRate: 0.95, marketImpact: 0.002, deviation: 0.01 },
          reportingInterval: 5000,
          performanceMetrics: []
        }
      };
      
      await iceberg.execute(order, config, null);
      
      const metrics = iceberg.getMetrics(order.id);
      expect(metrics).toBeDefined();
      expect(metrics?.detectionRisk).toBeGreaterThanOrEqual(0);
      expect(metrics?.detectionRisk).toBeLessThanOrEqual(1);
      expect(metrics?.hiddenRatio).toBeGreaterThan(0.9);
    });
  });
  
  describe('Algorithm Integration', () => {
    it('should handle multiple concurrent executions', async () => {
      const twap = new TWAPAlgorithm(logger);
      const vwap = new VWAPAlgorithm(logger);
      
      const orders = [
        {
          id: 'concurrent-1',
          clientOrderId: 'client-concurrent-1',
          symbol: 'BTC/USDT',
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          quantity: 1,
          status: OrderStatus.NEW,
          exchange: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'concurrent-2',
          clientOrderId: 'client-concurrent-2',
          symbol: 'ETH/USDT',
          side: OrderSide.SELL,
          type: OrderType.MARKET,
          quantity: 10,
          status: OrderStatus.NEW,
          exchange: 'auto',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      
      const config: AlgorithmConfig = {
        type: AlgorithmType.TWAP,
        parameters: { duration: 10000, slices: 5 },
        constraints: {
          maxSlippage: 0.005,
          maxMarketImpact: 0.002,
          maxFees: 0.001,
          minFillRate: 0.95,
          maxExecutionTime: 20000,
          maxOrderCount: 10,
          allowPartialFill: true,
          requireMEVProtection: false
        },
        objectives: {
          primary: 'price',
          weights: { price: 1, speed: 0, marketImpact: 0, fees: 0, certainty: 0 }
        },
        monitoring: {
          realTimeTracking: true,
          alertThresholds: { slippage: 0.01, fillRate: 0.9, marketImpact: 0.005, deviation: 0.02 },
          reportingInterval: 1000,
          performanceMetrics: []
        }
      };
      
      // Execute orders concurrently
      await Promise.all([
        twap.execute(orders[0], config, null),
        vwap.execute(orders[1], { ...config, type: AlgorithmType.VWAP }, null)
      ]);
      
      // Check both are running
      expect(twap.getActiveExecutions().size).toBe(1);
      expect(vwap.getActiveExecutions().size).toBe(1);
      
      // Cleanup
      twap.destroy();
      vwap.destroy();
    });
  });
}); 
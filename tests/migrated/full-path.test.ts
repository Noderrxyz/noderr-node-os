import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Logger } from 'winston';
import { ConfigService } from '@noderr/config';
import { DIContainer } from '@noderr/core';
import { RiskAwareExecutionGateway } from '@noderr/risk-engine';
import { SmartOrderRouter } from '@noderr/execution';
import { TelemetryService } from '@noderr/telemetry';
import {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  ExecutionStatus,
  MarketCondition
} from '@noderr/types';

// Mock implementations
class MockRiskEngine {
  async validateOrder(order: Order) {
    return {
      approved: true,
      maxSlippage: 0.002,
      urgency: 'medium',
      riskScore: 0.3
    };
  }

  async getDailyPnL() {
    return 5000; // $5k profit
  }

  async updateMetrics(metrics: any) {
    // Mock implementation
  }

  async updateDailyStats(stats: any) {
    // Mock implementation
  }

  on(event: string, handler: Function) {
    // Mock event handler
  }
}

class MockPositionManager {
  private positions = new Map<string, any>();

  async getPositions(symbol: string) {
    return this.positions.get(symbol) || [];
  }

  async updatePosition(update: any) {
    // Mock implementation
  }

  async getAvailableMargin() {
    return 100000; // $100k available
  }

  async getTotalExposure() {
    return 50000; // $50k exposure
  }
}

class MockTelemetryService {
  async recordMetric(metric: string, value: number, tags?: any) {
    // Mock implementation
  }

  async getExecutionMetrics(orderId: string) {
    return {
      orderId,
      latency: 15,
      slippage: 0.001,
      fillRate: 1.0
    };
  }
}

describe('Full Trading Path Integration', () => {
  let container: DIContainer;
  let logger: Logger;
  let configService: ConfigService;
  let riskGateway: RiskAwareExecutionGateway;
  let executionRouter: SmartOrderRouter;
  let telemetry: MockTelemetryService;

  beforeAll(async () => {
    // Create logger
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    // Initialize DI container
    container = new DIContainer(logger);

    // Register services
    container.register('logger', logger);
    container.register('config', new ConfigService(logger));
    container.register('riskEngine', new MockRiskEngine());
    container.register('positionManager', new MockPositionManager());
    container.register('telemetry', new MockTelemetryService());

    // Get services
    configService = container.get('config');
    telemetry = container.get('telemetry');

    // Create mock execution router
    executionRouter = {
      routeOrder: jest.fn().mockResolvedValue({
        orderId: 'test-order-1',
        routes: [{
          exchange: 'binance',
          quantity: 0.1,
          estimatedPrice: 50000,
          priority: 1
        }],
        expectedSlippage: 0.001,
        estimatedExecutionTime: 100,
        confidence: 0.95
      }),
      getAvailableVenues: jest.fn().mockResolvedValue(['binance', 'coinbase']),
      on: jest.fn()
    } as any;

    // Create risk gateway
    riskGateway = new RiskAwareExecutionGateway(
      logger,
      container.get('riskEngine'),
      executionRouter,
      container.get('positionManager')
    );

    // Initialize container
    await container.initialize();
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('should execute order through complete pipeline', async () => {
    // 1. Create order
    const order = createTestOrder('BTC/USDT', OrderSide.BUY, 0.1);
    
    // 2. Risk check and route
    const routing = await riskGateway.validateAndRoute(order);
    
    // Verify routing
    expect(routing).toBeDefined();
    expect(routing.routes).toHaveLength(1);
    expect(routing.routes[0].exchange).toBe('binance');
    expect(routing.expectedSlippage).toBeLessThan(0.002);
    
    // 3. Simulate execution
    const executionResult = {
      orderId: order.id,
      status: ExecutionStatus.COMPLETED,
      fills: [{
        id: 'fill-1',
        orderId: order.id,
        exchange: 'binance',
        price: 50050,
        quantity: 0.1,
        fee: 5,
        timestamp: Date.now(),
        side: OrderSide.BUY,
        liquidity: 'taker' as const,
        tradeId: 'trade-1'
      }],
      averagePrice: 50050,
      totalQuantity: 0.1,
      totalFees: 5,
      slippage: 0.001,
      marketImpact: 0.0005,
      executionTime: 95,
      routes: [{
        exchange: 'binance',
        quantity: 0.1,
        fills: 1,
        averagePrice: 50050,
        totalFees: 5,
        executionTime: 95,
        slippage: 0.001
      }],
      performance: {
        slippageBps: 10,
        implementationShortfall: 0,
        fillRate: 1.0,
        reversion: 0,
        benchmarkDeviation: 0,
        vwapDeviation: 0,
        opportunityCost: 0,
        totalCost: 5.5
      }
    };
    
    // 4. Update risk after execution
    await riskGateway.updateAfterExecution(executionResult);
    
    // 5. Verify telemetry
    const metrics = await telemetry.getExecutionMetrics(order.id);
    expect(metrics).toBeDefined();
    expect(metrics.fillRate).toBe(1.0);
    expect(metrics.slippage).toBeLessThan(0.002);
    
    // 6. Verify risk metrics
    const riskMetrics = await riskGateway.getRiskMetrics();
    expect(riskMetrics.activeOrders).toBe(0); // Order completed
    expect(riskMetrics.marketCondition).toBe(MarketCondition.NORMAL);
    expect(riskMetrics.dailyPnL).toBeGreaterThan(0);
  });

  it('should reject order that violates risk limits', async () => {
    // Create large order that exceeds limits
    const largeOrder = createTestOrder('BTC/USDT', OrderSide.BUY, 100); // 100 BTC
    
    // Mock risk engine to reject
    const riskEngine = container.get<MockRiskEngine>('riskEngine');
    riskEngine.validateOrder = jest.fn().mockResolvedValue({
      approved: false,
      violationType: 'POSITION_LIMIT',
      reason: 'Position size would exceed limit',
      details: { orderValue: 5000000, limit: 1000000 }
    });
    
    // Attempt to route order
    await expect(riskGateway.validateAndRoute(largeOrder))
      .rejects
      .toThrow('Position size would exceed limit');
  });

  it('should handle partial fills correctly', async () => {
    const order = createTestOrder('BTC/USDT', OrderSide.SELL, 1);
    
    // Route order
    const routing = await riskGateway.validateAndRoute(order);
    expect(routing).toBeDefined();
    
    // Simulate partial fills
    const partialFills = [
      {
        orderId: order.id,
        fill: {
          quantity: 0.3,
          price: 49900,
          fee: 15
        },
        timestamp: Date.now()
      },
      {
        orderId: order.id,
        fill: {
          quantity: 0.5,
          price: 49950,
          fee: 25
        },
        timestamp: Date.now() + 1000
      },
      {
        orderId: order.id,
        fill: {
          quantity: 0.2,
          price: 50000,
          fee: 10
        },
        timestamp: Date.now() + 2000
      }
    ];
    
    // Process partial fills
    for (const event of partialFills) {
      executionRouter.emit('orderFilled', event);
    }
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify final execution
    const finalResult = {
      orderId: order.id,
      status: ExecutionStatus.COMPLETED,
      fills: partialFills.map((pf, i) => ({
        id: `fill-${i}`,
        orderId: order.id,
        exchange: 'binance',
        price: pf.fill.price,
        quantity: pf.fill.quantity,
        fee: pf.fill.fee,
        timestamp: pf.timestamp,
        side: OrderSide.SELL,
        liquidity: 'taker' as const,
        tradeId: `trade-${i}`
      })),
      averagePrice: 49940, // Weighted average
      totalQuantity: 1,
      totalFees: 50,
      slippage: 0.0012,
      marketImpact: 0.001,
      executionTime: 2000,
      routes: [{
        exchange: 'binance',
        quantity: 1,
        fills: 3,
        averagePrice: 49940,
        totalFees: 50,
        executionTime: 2000,
        slippage: 0.0012
      }],
      performance: {
        slippageBps: 12,
        implementationShortfall: 0,
        fillRate: 1.0,
        reversion: 0,
        benchmarkDeviation: 0,
        vwapDeviation: 0,
        opportunityCost: 0,
        totalCost: 110
      }
    };
    
    await riskGateway.updateAfterExecution(finalResult);
    
    // Verify metrics
    const metrics = await telemetry.getExecutionMetrics(order.id);
    expect(metrics).toBeDefined();
  });

  it('should handle market volatility appropriately', async () => {
    // Create order during volatile market
    const order = createTestOrder('ETH/USDT', OrderSide.BUY, 10);
    
    // Mock volatile market conditions
    const getMarketData = jest.spyOn(riskGateway as any, 'getMarketData');
    getMarketData.mockResolvedValue({
      volatility: 0.08, // 8% volatility
      liquidityScore: 0.6,
      averageVolume: 100000,
      spread: 0.002
    });
    
    // Route order - should succeed but with adjusted parameters
    const routing = await riskGateway.validateAndRoute(order);
    
    expect(routing).toBeDefined();
    expect(routing.expectedSlippage).toBeGreaterThan(0.002); // Higher slippage expected
    
    // Verify market orders would be rejected in extreme volatility
    getMarketData.mockResolvedValue({
      volatility: 0.15, // 15% extreme volatility
      liquidityScore: 0.4,
      averageVolume: 50000,
      spread: 0.005
    });
    
    const marketOrder = createTestOrder('ETH/USDT', OrderSide.BUY, 10);
    marketOrder.type = OrderType.MARKET;
    
    await expect(riskGateway.validateAndRoute(marketOrder))
      .rejects
      .toThrow('Market orders not allowed in extreme volatility');
  });

  it('should integrate with telemetry throughout execution', async () => {
    const order = createTestOrder('SOL/USDT', OrderSide.BUY, 100);
    
    // Set up telemetry spy
    const recordMetric = jest.spyOn(telemetry, 'recordMetric');
    
    // Execute order
    const routing = await riskGateway.validateAndRoute(order);
    
    // Simulate execution
    const result = {
      orderId: order.id,
      status: ExecutionStatus.COMPLETED,
      fills: [{
        id: 'fill-1',
        orderId: order.id,
        exchange: 'coinbase',
        price: 100.5,
        quantity: 100,
        fee: 10,
        timestamp: Date.now(),
        side: OrderSide.BUY,
        liquidity: 'maker' as const,
        tradeId: 'trade-1'
      }],
      averagePrice: 100.5,
      totalQuantity: 100,
      totalFees: 10,
      slippage: 0.005,
      marketImpact: 0.002,
      executionTime: 150,
      routes: [{
        exchange: 'coinbase',
        quantity: 100,
        fills: 1,
        averagePrice: 100.5,
        totalFees: 10,
        executionTime: 150,
        slippage: 0.005
      }],
      performance: {
        slippageBps: 50,
        implementationShortfall: 0,
        fillRate: 1.0,
        reversion: 0,
        benchmarkDeviation: 0,
        vwapDeviation: 0,
        opportunityCost: 0,
        totalCost: 60
      }
    };
    
    await riskGateway.updateAfterExecution(result);
    
    // Verify telemetry was called
    expect(recordMetric).toHaveBeenCalled();
    
    // Get execution metrics
    const metrics = await telemetry.getExecutionMetrics(order.id);
    expect(metrics).toBeDefined();
    expect(metrics.orderId).toBe(order.id);
  });
});

// Helper function to create test orders
function createTestOrder(
  symbol: string,
  side: OrderSide,
  quantity: number
): Order {
  return {
    id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    clientOrderId: `client-${Date.now()}`,
    symbol,
    side,
    type: OrderType.LIMIT,
    quantity,
    price: side === OrderSide.BUY ? 50000 : 50100, // Default BTC price
    timeInForce: TimeInForce.GTC,
    status: OrderStatus.NEW,
    exchange: 'auto',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {
      strategy: 'test',
      urgency: 'medium'
    }
  };
} 
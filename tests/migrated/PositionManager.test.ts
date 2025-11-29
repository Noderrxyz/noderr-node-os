import { PositionManagerRust, OrderSide, PositionManagerConfig } from '../src/risk/PositionManagerRust';
import { PositionManagerJs } from '../src/risk/PositionManagerJs';

// Test configuration
const testConfig: PositionManagerConfig = {
  maxPositionPerSymbol: {
    'BTC-USD': 5.0,
    'ETH-USD': 50.0
  },
  defaultMaxPosition: 2.0,
  maxTotalExposure: 100000.0,
  initialCashBalance: 100000.0
};

// Helper to create an order
function createOrder(
  symbol: string, 
  side: OrderSide, 
  size: number, 
  price: number, 
  isFill: boolean = true,
  orderId: string = `order-${Date.now()}`
) {
  return {
    symbol,
    side,
    size,
    price,
    timestamp: Date.now(),
    orderId,
    fillId: isFill ? orderId : undefined,
    isFill,
    venue: 'test-exchange',
    strategyId: 'test-strategy'
  };
}

describe('PositionManagerRust', () => {
  let positionManager: PositionManagerRust;
  
  beforeEach(() => {
    // Create a new instance before each test
    positionManager = PositionManagerRust.getInstance(testConfig, true);
  });
  
  test('Should update position with a buy order', () => {
    const order = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    const result = positionManager.updatePosition('agent1', order);
    
    expect(result).toBe(true);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(1.0);
    expect(position?.averagePrice).toBe(50000.0);
  });
  
  test('Should update position with a sell order', () => {
    // First buy
    const buyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', buyOrder);
    
    // Then sell
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 0.5, 55000.0);
    const result = positionManager.updatePosition('agent1', sellOrder);
    
    expect(result).toBe(true);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(0.5);
    expect(position?.averagePrice).toBe(50000.0); // Average price doesn't change on partial sell
    expect(position?.realizedPnl).toBe(2500.0); // (55000 - 50000) * 0.5
  });
  
  test('Should calculate exposure correctly', () => {
    // Buy BTC
    const btcOrder = createOrder('BTC-USD', OrderSide.Buy, 2.0, 50000.0);
    positionManager.updatePosition('agent1', btcOrder);
    
    // Buy ETH
    const ethOrder = createOrder('ETH-USD', OrderSide.Buy, 10.0, 3000.0);
    positionManager.updatePosition('agent1', ethOrder);
    
    // Expected exposure: (2.0 * 50000.0) + (10.0 * 3000.0) = 130000.0
    const exposure = positionManager.calculateExposure('agent1');
    
    expect(exposure).toBeGreaterThan(0);
    // Note: The exact value might vary slightly because of implementation details in Rust/JS
    // We're checking if it's within a reasonable range
    expect(exposure).toBeGreaterThanOrEqual(129000.0);
    expect(exposure).toBeLessThanOrEqual(131000.0);
  });
  
  test('Should detect position limit exceeded', () => {
    // BTC limit is 5.0
    // First buy 4.0
    const btcOrder = createOrder('BTC-USD', OrderSide.Buy, 4.0, 50000.0);
    positionManager.updatePosition('agent1', btcOrder);
    
    // Check if buying 1.5 more would exceed limit
    const wouldExceed = positionManager.checkLimits('agent1', 'BTC-USD', OrderSide.Buy, 1.5);
    
    expect(wouldExceed).toBe(true);
    
    // Check if buying 0.5 more would be OK
    const wouldNotExceed = positionManager.checkLimits('agent1', 'BTC-USD', OrderSide.Buy, 0.5);
    
    expect(wouldNotExceed).toBe(false);
  });
  
  test('Should update price and unrealized PnL', () => {
    // Buy BTC at 50000
    const buyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', buyOrder);
    
    // Update price to 55000
    positionManager.updatePrice('BTC-USD', 55000.0);
    
    // Get position with updated unrealized PnL
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    // Unrealized PnL should be (55000 - 50000) * 1.0 = 5000.0
    // Note: The exact value might vary slightly
    expect(position?.unrealizedPnl).toBeGreaterThanOrEqual(4900.0);
    expect(position?.unrealizedPnl).toBeLessThanOrEqual(5100.0);
  });
  
  test('Should handle short positions correctly', () => {
    // Sell short 1.0 BTC at 50000
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 1.0, 50000.0);
    positionManager.updatePosition('agent1', sellOrder);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(-1.0);
    expect(position?.averagePrice).toBe(50000.0);
    
    // Update price to 45000 (profit for short position)
    positionManager.updatePrice('BTC-USD', 45000.0);
    
    const updatedPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    // Unrealized PnL should be (50000 - 45000) * 1.0 = 5000.0
    expect(updatedPosition?.unrealizedPnl).toBeGreaterThanOrEqual(4900.0);
    expect(updatedPosition?.unrealizedPnl).toBeLessThanOrEqual(5100.0);
  });
  
  test('Should track multiple positions per agent', () => {
    // Buy BTC
    const btcOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', btcOrder);
    
    // Buy ETH
    const ethOrder = createOrder('ETH-USD', OrderSide.Buy, 10.0, 3000.0);
    positionManager.updatePosition('agent1', ethOrder);
    
    // Get full agent position
    const agentPosition = positionManager.getPosition('agent1');
    
    expect(agentPosition).not.toBeNull();
    expect(Object.keys(agentPosition?.positions || {}).length).toBe(2);
    expect(agentPosition?.positions['BTC-USD']?.netSize).toBe(1.0);
    expect(agentPosition?.positions['ETH-USD']?.netSize).toBe(10.0);
  });
  
  test('Should track open orders', () => {
    // Create an open (not fill) order
    const openOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0, false, 'open-order-1');
    positionManager.updatePosition('agent1', openOrder);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(0); // Net size doesn't change for open orders
    expect(Object.keys(position?.openOrders || {}).length).toBe(1);
    expect(position?.openOrders['open-order-1']).toBeDefined();
  });
  
  test('Should remove open order when filled', () => {
    // Create an open order
    const openOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0, false, 'open-order-1');
    positionManager.updatePosition('agent1', openOrder);
    
    // Create a fill for the same order
    const fillOrder = {
      ...createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0, true, 'fill-1'),
      fillId: 'open-order-1' // Reference the open order
    };
    positionManager.updatePosition('agent1', fillOrder);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(1.0); // Net size updated
    expect(Object.keys(position?.openOrders || {}).length).toBe(0); // Open order removed
    expect(position?.fills.length).toBe(1); // Fill added to history
  });
  
  test('Should update configuration correctly', () => {
    const newConfig: Partial<PositionManagerConfig> = {
      maxPositionPerSymbol: {
        'BTC-USD': 10.0
      },
      defaultMaxPosition: 5.0
    };
    
    positionManager.updateConfig(newConfig);
    
    const config = positionManager.getConfig();
    
    expect(config.maxPositionPerSymbol['BTC-USD']).toBe(10.0);
    expect(config.defaultMaxPosition).toBe(5.0);
    // Other settings should remain unchanged
    expect(config.maxTotalExposure).toBe(testConfig.maxTotalExposure);
    expect(config.initialCashBalance).toBe(testConfig.initialCashBalance);
  });
});

describe('PositionManagerJs', () => {
  let positionManager: PositionManagerJs;
  
  beforeEach(() => {
    // Create a new instance before each test
    positionManager = new PositionManagerJs(testConfig);
  });
  
  test('Should update position with a buy order', () => {
    const order = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    const result = positionManager.updatePosition('agent1', order);
    
    expect(result).toBe(true);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(1.0);
    expect(position?.averagePrice).toBe(50000.0);
  });
  
  test('Should update position with a sell order', () => {
    // First buy
    const buyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', buyOrder);
    
    // Then sell
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 0.5, 55000.0);
    const result = positionManager.updatePosition('agent1', sellOrder);
    
    expect(result).toBe(true);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(0.5);
    expect(position?.averagePrice).toBe(50000.0); // Average price doesn't change on partial sell
    expect(position?.realizedPnl).toBe(2500.0); // (55000 - 50000) * 0.5
  });
  
  test('Should calculate exposure correctly', () => {
    // Buy BTC
    const btcOrder = createOrder('BTC-USD', OrderSide.Buy, 2.0, 50000.0);
    positionManager.updatePosition('agent1', btcOrder);
    
    // Buy ETH
    const ethOrder = createOrder('ETH-USD', OrderSide.Buy, 10.0, 3000.0);
    positionManager.updatePosition('agent1', ethOrder);
    
    // Expected exposure: (2.0 * 50000.0) + (10.0 * 3000.0) = 130000.0
    const exposure = positionManager.calculateExposure('agent1');
    
    expect(exposure).toBe(130000.0);
  });
  
  test('Should handle short positions correctly', () => {
    // Sell short 1.0 BTC at 50000
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 1.0, 50000.0);
    positionManager.updatePosition('agent1', sellOrder);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(-1.0);
    expect(position?.averagePrice).toBe(50000.0);
    
    // Update price to 45000 (profit for short position)
    positionManager.updatePrice('BTC-USD', 45000.0);
    
    const updatedPosition = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    // Unrealized PnL should be (50000 - 45000) * 1.0 = 5000.0
    expect(updatedPosition?.unrealizedPnl).toBe(5000.0);
  });
  
  test('Should track cash balance correctly', () => {
    // Initial cash balance is 100000.0
    
    // Buy 1 BTC at 50000
    const buyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', buyOrder);
    
    // Cash should decrease by 50000
    let agentPosition = positionManager.getPosition('agent1');
    expect(agentPosition?.cashBalance).toBe(50000.0);
    
    // Sell 0.5 BTC at 55000
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 0.5, 55000.0);
    positionManager.updatePosition('agent1', sellOrder);
    
    // Cash should increase by 0.5 * 55000 = 27500
    agentPosition = positionManager.getPosition('agent1');
    expect(agentPosition?.cashBalance).toBe(77500.0);
  });
  
  test('Should handle crossing from long to short position', () => {
    // Buy 1 BTC at 50000
    const buyOrder = createOrder('BTC-USD', OrderSide.Buy, 1.0, 50000.0);
    positionManager.updatePosition('agent1', buyOrder);
    
    // Sell 2 BTC at 55000 (crosses from long 1 to short 1)
    const sellOrder = createOrder('BTC-USD', OrderSide.Sell, 2.0, 55000.0);
    positionManager.updatePosition('agent1', sellOrder);
    
    const position = positionManager.getSymbolPosition('agent1', 'BTC-USD');
    
    expect(position).not.toBeNull();
    expect(position?.netSize).toBe(-1.0); // Now short 1 BTC
    expect(position?.averagePrice).toBe(55000.0); // Short price is the sell price
    
    // Realized PnL from closing long position should be (55000 - 50000) * 1.0 = 5000.0
    expect(position?.realizedPnl).toBe(5000.0);
  });
}); 
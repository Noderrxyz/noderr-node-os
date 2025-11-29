import { OrderBookStrategy } from '@noderr/strategy/OrderBookStrategy';
import { MarketRegime, MarketFeatures } from '@noderr/regime/RegimeClassifier';
import { OrderBookManager, OrderSide } from '@noderr/execution/src/OrderBookManager';
import { StrategyContext } from '@noderr/strategy/AdaptiveStrategy';

// Mock dependencies
jest.mock('../../execution/OrderBookManager');
jest.mock('../../regime/RegimeClassifier');
jest.mock('../../memory/AlphaMemory');

describe('OrderBookStrategy', () => {
  let strategy: OrderBookStrategy;
  
  // Mock implementation for OrderBookManager
  const mockOrderBookManager = {
    getInstance: jest.fn(),
    calculateImbalance: jest.fn(),
    getMidPrice: jest.fn(),
    getVWAP: jest.fn(),
    listSymbols: jest.fn()
  };
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup OrderBookManager mock
    (OrderBookManager.getInstance as jest.Mock).mockReturnValue(mockOrderBookManager);
    
    // Create strategy instance
    strategy = new OrderBookStrategy();
  });
  
  describe('constructor', () => {
    it('should initialize with OrderBookManager', () => {
      expect(OrderBookManager.getInstance).toHaveBeenCalled();
    });
    
    it('should throw error if OrderBookManager initialization fails', () => {
      (OrderBookManager.getInstance as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Test error');
      });
      
      expect(() => new OrderBookStrategy()).toThrow('Failed to initialize OrderBookStrategy');
    });
  });
  
  describe('executeStrategy', () => {
    const symbol = 'BTC/USD';
    const mockContext: StrategyContext = {
      symbol,
      timestamp: new Date(),
      features: {} as MarketFeatures,
      regime: MarketRegime.BullishTrend,
      parameters: {
        depth: 10,
        buyThreshold: 0.6,
        sellThreshold: 0.4,
        vwapSize: 1.0,
        priceDeviationThreshold: 0.002
      }
    };
    
    it('should return a buy signal for high imbalance', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.7); // High imbalance (bid-heavy)
      mockOrderBookManager.getMidPrice.mockReturnValue(100);
      mockOrderBookManager.getVWAP.mockImplementation((symbol: string, size: number, side: OrderSide) => {
        return side === OrderSide.Bid ? 99.5 : 100.5;
      });
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('buy');
      expect(signal?.strength).toBeGreaterThan(0.3);
      expect(signal?.symbol).toBe(symbol);
      expect(signal?.meta).toHaveProperty('imbalance', 0.7);
    });
    
    it('should return a sell signal for low imbalance', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.3); // Low imbalance (ask-heavy)
      mockOrderBookManager.getMidPrice.mockReturnValue(100);
      mockOrderBookManager.getVWAP.mockImplementation((symbol: string, size: number, side: OrderSide) => {
        return side === OrderSide.Bid ? 99.5 : 100.5;
      });
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('sell');
      expect(signal?.strength).toBeGreaterThan(0.3);
      expect(signal?.symbol).toBe(symbol);
      expect(signal?.meta).toHaveProperty('imbalance', 0.3);
    });
    
    it('should return null for neutral imbalance', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.5); // Neutral imbalance
      mockOrderBookManager.getMidPrice.mockReturnValue(100);
      mockOrderBookManager.getVWAP.mockImplementation((symbol: string, size: number, side: OrderSide) => {
        return side === OrderSide.Bid ? 99.5 : 100.5;
      });
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).toBeNull();
    });
    
    it('should increase signal strength if price deviation is small', async () => {
      // Setup mocks - high imbalance with small price deviation
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.7);
      mockOrderBookManager.getMidPrice.mockReturnValue(100);
      mockOrderBookManager.getVWAP.mockImplementation((symbol: string, size: number, side: OrderSide) => {
        return side === OrderSide.Bid ? 99.9 : 100.1; // Very small deviation
      });
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('buy');
      // Should be stronger due to small price deviation
      expect(signal?.strength).toBeGreaterThan(0.5);
    });
    
    it('should return null if order book data is not available', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(null);
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).toBeNull();
    });
    
    it('should return null if mid price is not available', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.7);
      mockOrderBookManager.getMidPrice.mockReturnValue(null);
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).toBeNull();
    });
    
    it('should return null if VWAP is not available', async () => {
      // Setup mocks
      mockOrderBookManager.calculateImbalance.mockReturnValue(0.7);
      mockOrderBookManager.getMidPrice.mockReturnValue(100);
      mockOrderBookManager.getVWAP.mockReturnValue(null);
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).toBeNull();
    });
    
    it('should handle errors gracefully', async () => {
      // Setup mocks to throw error
      mockOrderBookManager.calculateImbalance.mockImplementation(() => {
        throw new Error('Test error');
      });
      
      const signal = await (strategy as any).executeStrategy(mockContext);
      
      expect(signal).toBeNull();
    });
  });
  
  describe('getStrategyType', () => {
    it('should return the correct strategy type', () => {
      expect((strategy as any).getStrategyType()).toBe('order_book');
    });
  });
  
  describe('getStrategyTags', () => {
    it('should return the correct strategy tags', () => {
      const tags = (strategy as any).getStrategyTags();
      expect(tags).toContain('liquidity');
      expect(tags).toContain('microstructure');
      expect(tags).toContain('order_book');
    });
  });
  
  describe('getParameters', () => {
    it('should get parameters for a specific symbol and regime', () => {
      // Mock the getOptimizedParameters method
      (strategy as any).getOptimizedParameters = jest.fn().mockReturnValue({
        depth: 15,
        buyThreshold: 0.65,
        sellThreshold: 0.35,
        vwapSize: 1.5,
        priceDeviationThreshold: 0.003
      });
      
      const params = strategy.getParameters('BTC/USD', MarketRegime.BullishTrend);
      
      expect(params).toHaveProperty('depth', 15);
      expect(params).toHaveProperty('buyThreshold', 0.65);
      expect(params).toHaveProperty('sellThreshold', 0.35);
      expect(params).toHaveProperty('vwapSize', 1.5);
      expect(params).toHaveProperty('priceDeviationThreshold', 0.003);
      
      expect((strategy as any).getOptimizedParameters).toHaveBeenCalledWith(
        'BTC/USD', 
        MarketRegime.BullishTrend
      );
    });
  });
}); 
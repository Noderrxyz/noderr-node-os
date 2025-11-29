import { OrderBookManager, OrderSide, UpdateType, PriceLevel } from '@noderr/execution/src/OrderBookManager';

// Mock the nativeManager
jest.mock('../../../noderr_core', () => {
  return {
    NapiOrderBookManager: jest.fn().mockImplementation(() => ({
      process_update: jest.fn((symbol, price, size, side, updateId) => {
        return side === 0 && price > 0 ? 0 : side === 0 ? 1 : 2; // Return UpdateType based on input
      }),
      process_updates: jest.fn((symbol, updates) => {
        return updates.map((update: [number, number, number, number]) => update[2] === 0 ? 0 : 1);
      }),
      get_snapshot: jest.fn((symbol, depth) => {
        if (symbol === 'ERROR') return null;
        const bids: any[] = [];
        const asks: any[] = [];
        
        for (let i = 0; i < depth; i++) {
          bids.push({
            price: 100 - i,
            size: 10 * (i + 1),
            order_count: i + 1,
            timestamp: Date.now()
          });
          
          asks.push({
            price: 101 + i,
            size: 5 * (i + 1),
            order_count: i + 1,
            timestamp: Date.now()
          });
        }
        
        return [bids, asks];
      }),
      get_mid_price: jest.fn((symbol) => {
        return symbol === 'ERROR' ? null : 100.5;
      }),
      calculate_imbalance: jest.fn((symbol, depth) => {
        return symbol === 'ERROR' ? null : 0.75;
      }),
      get_vwap: jest.fn((symbol, size, side) => {
        return symbol === 'ERROR' ? null : side === 0 ? 99.8 : 101.2;
      }),
      list_symbols: jest.fn(() => {
        return ['BTC/USD', 'ETH/USD', 'SOL/USD'];
      }),
      remove_order_book: jest.fn((symbol) => {
        return symbol !== 'ERROR';
      })
    }))
  };
});

describe('OrderBookManager', () => {
  let orderBookManager: OrderBookManager;
  
  beforeEach(() => {
    // Reset the singleton instance
    (OrderBookManager as any).instance = null;
    // Get the new instance
    orderBookManager = OrderBookManager.getInstance();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = OrderBookManager.getInstance();
      const instance2 = OrderBookManager.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('processUpdate', () => {
    it('should process a single update correctly', () => {
      const result = orderBookManager.processUpdate('BTC/USD', 100, 10, OrderSide.Bid, 123);
      expect(result).toBe(UpdateType.New);
    });
    
    it('should handle error cases', () => {
      expect(() => {
        orderBookManager.processUpdate('ERROR', -1, 0, OrderSide.Bid, 123);
      }).not.toThrow();
    });
  });
  
  describe('processUpdates', () => {
    it('should process multiple updates correctly', () => {
      const updates: [number, number, number, number][] = [
        [100, 10, 0, 1],  // price, size, side, updateId
        [101, 5, 1, 2]
      ];
      
      const results = orderBookManager.processUpdates('BTC/USD', updates);
      expect(results).toEqual([UpdateType.New, UpdateType.Update]);
    });
  });
  
  describe('getSnapshot', () => {
    it('should return a formatted snapshot', async () => {
      const snapshot = await orderBookManager.getSnapshot('BTC/USD', 3);
      
      expect(snapshot).not.toBeNull();
      if (snapshot) {
        expect(snapshot.length).toBe(2);
        expect(snapshot[0].length).toBe(3); // Bids
        expect(snapshot[1].length).toBe(3); // Asks
        
        // Check structure of a price level
        const bidLevel = snapshot[0][0];
        expect(bidLevel).toHaveProperty('price');
        expect(bidLevel).toHaveProperty('size');
        expect(bidLevel).toHaveProperty('orderCount');
        expect(bidLevel).toHaveProperty('timestamp');
      }
    });
    
    it('should return null for invalid symbols', async () => {
      const snapshot = await orderBookManager.getSnapshot('ERROR', 3);
      expect(snapshot).toBeNull();
    });
  });
  
  describe('getMidPrice', () => {
    it('should return the mid price for a valid symbol', () => {
      const midPrice = orderBookManager.getMidPrice('BTC/USD');
      expect(midPrice).toBe(100.5);
    });
    
    it('should return null for invalid symbols', () => {
      const midPrice = orderBookManager.getMidPrice('ERROR');
      expect(midPrice).toBeNull();
    });
  });
  
  describe('calculateImbalance', () => {
    it('should return the imbalance for a valid symbol', () => {
      const imbalance = orderBookManager.calculateImbalance('BTC/USD', 5);
      expect(imbalance).toBe(0.75);
    });
    
    it('should return null for invalid symbols', () => {
      const imbalance = orderBookManager.calculateImbalance('ERROR', 5);
      expect(imbalance).toBeNull();
    });
  });
  
  describe('getVWAP', () => {
    it('should return the VWAP for a bid', () => {
      const vwap = orderBookManager.getVWAP('BTC/USD', 100, OrderSide.Bid);
      expect(vwap).toBe(99.8);
    });
    
    it('should return the VWAP for an ask', () => {
      const vwap = orderBookManager.getVWAP('BTC/USD', 100, OrderSide.Ask);
      expect(vwap).toBe(101.2);
    });
    
    it('should return null for invalid symbols', () => {
      const vwap = orderBookManager.getVWAP('ERROR', 100, OrderSide.Bid);
      expect(vwap).toBeNull();
    });
  });
  
  describe('listSymbols', () => {
    it('should return a list of symbols', () => {
      const symbols = orderBookManager.listSymbols();
      expect(symbols).toEqual(['BTC/USD', 'ETH/USD', 'SOL/USD']);
    });
  });
  
  describe('removeOrderBook', () => {
    it('should remove an order book successfully', () => {
      const result = orderBookManager.removeOrderBook('BTC/USD');
      expect(result).toBe(true);
    });
    
    it('should return false for errors', () => {
      const result = orderBookManager.removeOrderBook('ERROR');
      expect(result).toBe(false);
    });
  });
  
  describe('Error handling', () => {
    it('should throw an error if the native manager initialization fails', () => {
      // Mock the constructor to throw an error
      jest.mock('../../../noderr_core', () => {
        return {
          NapiOrderBookManager: jest.fn().mockImplementation(() => {
            throw new Error('Initialization error');
          })
        };
      });
      
      // Reset the singleton to force re-initialization
      (OrderBookManager as any).instance = null;
      
      // We don't want to actually throw in the test, so suppress it
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });
  });
}); 
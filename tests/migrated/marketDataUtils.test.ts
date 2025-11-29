import { 
  normalizeSymbol, 
  normalizeTimestamp, 
  normalizeTick, 
  normalizeBar, 
  normalizeOrderBook,
  InvalidMarketDataError 
} from './marketDataUtils';

describe('Market Data Utilities', () => {
  describe('normalizeSymbol', () => {
    test('converts Binance style symbols to standard format', () => {
      expect(normalizeSymbol('BTCUSDT')).toBe('BTC/USD');
      expect(normalizeSymbol('ETHUSDT')).toBe('ETH/USD');
      expect(normalizeSymbol('LTCBTC')).toBe('LTC/BTC');
    });

    test('converts Coinbase style symbols to standard format', () => {
      expect(normalizeSymbol('BTC-USD')).toBe('BTC/USD');
      expect(normalizeSymbol('ETH-BTC')).toBe('ETH/BTC');
    });

    test('handles already formatted symbols', () => {
      expect(normalizeSymbol('BTC/USD')).toBe('BTC/USD');
      expect(normalizeSymbol('ETH/BTC')).toBe('ETH/BTC');
    });

    test('handles edge cases', () => {
      expect(normalizeSymbol('')).toBe('');
      expect(normalizeSymbol('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  describe('normalizeTimestamp', () => {
    test('handles Date objects', () => {
      const date = new Date('2023-01-01T12:00:00Z');
      expect(normalizeTimestamp(date)).toEqual(date);
    });

    test('converts ISO strings to Date objects', () => {
      expect(normalizeTimestamp('2023-01-01T12:00:00Z')).toEqual(new Date('2023-01-01T12:00:00Z'));
    });

    test('converts seconds-based timestamps to Date objects', () => {
      const secondsTimestamp = 1672574400; // 2023-01-01T12:00:00Z
      expect(normalizeTimestamp(secondsTimestamp)).toEqual(new Date(secondsTimestamp * 1000));
    });

    test('converts milliseconds-based timestamps to Date objects', () => {
      const msTimestamp = 1672574400000; // 2023-01-01T12:00:00Z
      expect(normalizeTimestamp(msTimestamp)).toEqual(new Date(msTimestamp));
    });
  });

  describe('normalizeTick', () => {
    test('normalizes Binance style tick data', () => {
      const binanceTick = {
        s: 'BTCUSDT',
        T: 1672574400000,
        p: '30000.50',
        q: '1.5',
        m: false, // buy
        t: 123456
      };

      const normalized = normalizeTick(binanceTick);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date(1672574400000));
      expect(normalized.price).toBe(30000.5);
      expect(normalized.volume).toBe(1.5);
      expect(normalized.side).toBe('buy');
      expect(normalized.id).toBe('123456');
    });

    test('normalizes Coinbase style tick data', () => {
      const coinbaseTick = {
        product_id: 'BTC-USD',
        time: '2023-01-01T12:00:00Z',
        price: '30000.50',
        last_size: '1.5',
        side: 'buy',
        trade_id: 123456
      };

      const normalized = normalizeTick(coinbaseTick);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date('2023-01-01T12:00:00Z'));
      expect(normalized.price).toBe(30000.5);
      expect(normalized.volume).toBe(1.5);
      expect(normalized.side).toBe('buy');
      expect(normalized.id).toBe('123456');
    });

    test('throws error for invalid tick data', () => {
      expect(() => normalizeTick(null)).toThrow(InvalidMarketDataError);
      expect(() => normalizeTick({ price: '-1' })).toThrow(InvalidMarketDataError);
    });
  });

  describe('normalizeBar', () => {
    test('normalizes Binance style OHLCV data', () => {
      const binanceBar = {
        s: 'BTCUSDT',
        t: 1672574400000,
        o: '30000.50',
        h: '31000.00',
        l: '29800.00',
        c: '30500.00',
        v: '100.5'
      };

      const normalized = normalizeBar(binanceBar);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date(1672574400000));
      expect(normalized.open).toBe(30000.5);
      expect(normalized.high).toBe(31000);
      expect(normalized.low).toBe(29800);
      expect(normalized.close).toBe(30500);
      expect(normalized.volume).toBe(100.5);
    });

    test('normalizes with array values (ccxt style)', () => {
      // [timestamp, open, high, low, close, volume]
      const ccxtBar = {
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        open: 30000.5,
        high: 31000,
        low: 29800,
        close: 30500,
        volume: 100.5
      };

      const normalized = normalizeBar(ccxtBar);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date(1672574400000));
      expect(normalized.open).toBe(30000.5);
      expect(normalized.high).toBe(31000);
      expect(normalized.low).toBe(29800);
      expect(normalized.close).toBe(30500);
      expect(normalized.volume).toBe(100.5);
    });

    test('corrects high/low values if needed', () => {
      // Bar with incorrect high/low values
      const invalidBar = {
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        open: 30000,
        high: 29000, // Lower than low!
        low: 31000,  // Higher than high!
        close: 30500,
        volume: 100.5
      };

      const normalized = normalizeBar(invalidBar);
      expect(normalized.high).toBe(31000); // Should be max of all values
      expect(normalized.low).toBe(29000);  // Should be min of all values
    });

    test('throws error for invalid bar data', () => {
      expect(() => normalizeBar(null)).toThrow(InvalidMarketDataError);
      expect(() => normalizeBar({ 
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        open: -1,     // Negative price - invalid
        high: 31000,
        low: 29800,
        close: 30500,
        volume: 100.5
      })).toThrow(InvalidMarketDataError);
    });
  });

  describe('normalizeOrderBook', () => {
    test('normalizes Binance style order book', () => {
      const binanceOrderBook = {
        s: 'BTCUSDT',
        E: 1672574400000,
        bids: [
          ['30000.50', '1.5'],
          ['29900.00', '2.5']
        ],
        asks: [
          ['30100.00', '1.0'],
          ['30200.00', '3.0']
        ]
      };

      const normalized = normalizeOrderBook(binanceOrderBook);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date(1672574400000));
      expect(normalized.bids).toHaveLength(2);
      expect(normalized.asks).toHaveLength(2);
      
      // Bids should be sorted by price in descending order
      expect(normalized.bids[0].price).toBe(30000.5);
      expect(normalized.bids[0].volume).toBe(1.5);
      expect(normalized.bids[1].price).toBe(29900);
      expect(normalized.bids[1].volume).toBe(2.5);
      
      // Asks should be sorted by price in ascending order
      expect(normalized.asks[0].price).toBe(30100);
      expect(normalized.asks[0].volume).toBe(1.0);
      expect(normalized.asks[1].price).toBe(30200);
      expect(normalized.asks[1].volume).toBe(3.0);
    });

    test('normalizes Coinbase style order book', () => {
      const coinbaseOrderBook = {
        product_id: 'BTC-USD',
        time: '2023-01-01T12:00:00Z',
        bids: [
          ['30000.50', '1.5'],
          ['29900.00', '2.5']
        ],
        asks: [
          ['30100.00', '1.0'],
          ['30200.00', '3.0']
        ]
      };

      const normalized = normalizeOrderBook(coinbaseOrderBook);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.timestamp).toEqual(new Date('2023-01-01T12:00:00Z'));
      expect(normalized.bids).toHaveLength(2);
      expect(normalized.asks).toHaveLength(2);
    });

    test('normalizes with object format', () => {
      const orderBook = {
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        bids: [
          { price: 30000.5, volume: 1.5 },
          { price: 29900, volume: 2.5 }
        ],
        asks: [
          { price: 30100, volume: 1.0 },
          { price: 30200, volume: 3.0 }
        ]
      };

      const normalized = normalizeOrderBook(orderBook);
      expect(normalized.symbol).toBe('BTC/USD');
      expect(normalized.bids[0].price).toBe(30000.5);
      expect(normalized.bids[0].volume).toBe(1.5);
    });

    test('filters out invalid entries', () => {
      const orderBook = {
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        bids: [
          { price: 30000.5, volume: 1.5 },
          { price: 0, volume: 2.5 },       // Invalid price
          { price: 29900, volume: 0 }      // Invalid volume
        ],
        asks: [
          { price: 30100, volume: 1.0 },
          { price: -1, volume: 3.0 },      // Invalid price
          { price: 30200, volume: -1 }     // Invalid volume
        ]
      };

      const normalized = normalizeOrderBook(orderBook);
      expect(normalized.bids).toHaveLength(1); // Only one valid bid
      expect(normalized.asks).toHaveLength(1); // Only one valid ask
    });

    test('throws error for invalid order book data', () => {
      expect(() => normalizeOrderBook(null)).toThrow(InvalidMarketDataError);
      expect(() => normalizeOrderBook({
        symbol: 'BTC/USD',
        timestamp: 1672574400000,
        // Missing bids or asks
      })).toThrow(InvalidMarketDataError);
    });
  });
}); 
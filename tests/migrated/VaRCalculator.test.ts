import { VaRCalculator } from '../src/VaRCalculator';
import { Portfolio, PriceData, VaRCalculatorConfig } from '../src/types';

describe('VaRCalculator', () => {
  let varCalculator: VaRCalculator;
  let portfolio: Portfolio;
  let priceData: Map<string, PriceData[]>;

  beforeEach(() => {
    const config: VaRCalculatorConfig = {
      confidenceLevel: 0.95,
      lookbackPeriod: 20,
      methodology: 'parametric'
    };

    varCalculator = new VaRCalculator(config);

    portfolio = {
      id: 'test-portfolio',
      positions: [
        {
          id: 'pos-1',
          symbol: 'BTC',
          quantity: 1,
          entryPrice: 50000,
          currentPrice: 55000,
          unrealizedPnL: 5000,
          realizedPnL: 0,
          marginRequired: 5000,
          positionType: 'long',
          openedAt: new Date()
        }
      ],
      totalValue: 100000,
      baseCurrency: 'USD',
      marginUsed: 5000,
      marginAvailable: 95000,
      lastUpdated: new Date()
    };

    // Generate mock price data
    priceData = new Map();
    const btcPrices: PriceData[] = [];
    
    for (let i = 0; i < 30; i++) {
      const basePrice = 50000 + Math.random() * 5000;
      btcPrices.push({
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        open: basePrice,
        high: basePrice * 1.02,
        low: basePrice * 0.98,
        close: basePrice + (Math.random() - 0.5) * 1000,
        volume: 1000 + Math.random() * 500,
        symbol: 'BTC'
      });
    }
    
    priceData.set('BTC', btcPrices);
  });

  describe('calculate', () => {
    it('should calculate parametric VaR', async () => {
      const result = await varCalculator.calculate(portfolio, priceData);
      
      expect(result).toBeDefined();
      expect(result.value).toBeGreaterThan(0);
      expect(result.confidence).toBe(0.95);
      expect(result.methodology).toBe('parametric');
      expect(result.timeHorizon).toBe(1);
    });

    it('should calculate historical VaR', async () => {
      varCalculator.updateConfig({ methodology: 'historical' });
      const result = await varCalculator.calculate(portfolio, priceData);
      
      expect(result).toBeDefined();
      expect(result.value).toBeGreaterThan(0);
      expect(result.methodology).toBe('historical');
    });

    it('should calculate Monte Carlo VaR', async () => {
      varCalculator.updateConfig({ methodology: 'monteCarlo' });
      const result = await varCalculator.calculate(portfolio, priceData);
      
      expect(result).toBeDefined();
      expect(result.value).toBeGreaterThan(0);
      expect(result.methodology).toBe('monteCarlo');
    });

    it('should calculate component VaR', async () => {
      const result = await varCalculator.calculate(portfolio, priceData);
      
      expect(result.componentVaR).toBeDefined();
      expect(result.componentVaR?.size).toBe(1);
      expect(result.componentVaR?.get('BTC')).toBeGreaterThan(0);
    });

    it('should calculate marginal VaR', async () => {
      const result = await varCalculator.calculate(portfolio, priceData);
      
      expect(result.marginalVaR).toBeDefined();
      expect(result.marginalVaR?.size).toBe(1);
      expect(result.marginalVaR?.get('BTC')).toBeDefined();
    });

    it('should cache results', async () => {
      const result1 = await varCalculator.calculate(portfolio, priceData);
      const startTime = Date.now();
      const result2 = await varCalculator.calculate(portfolio, priceData);
      const duration = Date.now() - startTime;
      
      expect(result2).toEqual(result1);
      expect(duration).toBeLessThan(10); // Should be very fast due to caching
    });
  });

  describe('calculateCVaR', () => {
    it('should calculate Conditional VaR', async () => {
      const cvar = await varCalculator.calculateCVaR(portfolio, priceData);
      
      expect(cvar).toBeGreaterThan(0);
      
      // CVaR should be greater than VaR
      const var_result = await varCalculator.calculate(portfolio, priceData);
      expect(cvar).toBeGreaterThanOrEqual(var_result.value);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      varCalculator.updateConfig({
        confidenceLevel: 0.99,
        methodology: 'historical'
      });
      
      // Verify by running calculation
      expect(async () => {
        const result = await varCalculator.calculate(portfolio, priceData);
        expect(result.confidence).toBe(0.99);
        expect(result.methodology).toBe('historical');
      }).not.toThrow();
    });

    it('should clear cache when config changes', async () => {
      await varCalculator.calculate(portfolio, priceData);
      varCalculator.updateConfig({ confidenceLevel: 0.99 });
      
      // Cache should be cleared, so this should recalculate
      const result = await varCalculator.calculate(portfolio, priceData);
      expect(result.confidence).toBe(0.99);
    });
  });

  describe('error handling', () => {
    it('should handle empty portfolio', async () => {
      const emptyPortfolio: Portfolio = {
        ...portfolio,
        positions: []
      };
      
      const result = await varCalculator.calculate(emptyPortfolio, priceData);
      expect(result.value).toBe(0);
    });

    it('should handle missing price data', async () => {
      const emptyPriceData = new Map<string, PriceData[]>();
      
      const result = await varCalculator.calculate(portfolio, emptyPriceData);
      expect(result.value).toBe(0);
    });

    it('should emit error event on calculation failure', async () => {
      const errorHandler = jest.fn();
      varCalculator.on('error', errorHandler);
      
      // Force an error by passing invalid methodology
      varCalculator.updateConfig({ methodology: 'invalid' as any });
      
      await expect(varCalculator.calculate(portfolio, priceData)).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });
  });
}); 
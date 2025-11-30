import { SmartOrderRouter } from '../src/SmartOrderRouter';
import { buildPaperExchanges } from '../src/PaperAdapterRegistry';
import { RoutingConfig, Order, OrderSide, OrderType, Exchange } from '../src/types';

// Minimal logger stub compatible with winston.Logger usage
const logger: any = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('Paper-mode SmartOrderRouter', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.SOR_USE_PRODUCTION = 'false';
    process.env.SOR_ENABLED_VENUES = 'uniswap_v3,sushiswap,0x_api';
    process.env.SOR_MAX_RETRIES = '2';
    process.env.SOR_QUOTE_CACHE_MS = '3000';
    process.env.SOR_FAIL_ON_HIGH_IMPACT = 'true';
  });

  it('routes using synthetic liquidity without live API calls', async () => {
    const exchanges: Exchange[] = buildPaperExchanges(['uniswap_v3', 'sushiswap']);
    const config: RoutingConfig = {
      mode: 'smart',
      splitThreshold: 1000,
      maxSplits: 3,
      routingObjective: 'balanced',
      venueAnalysis: false,
      darkPoolAccess: false,
      crossVenueArbitrage: false,
      latencyOptimization: false,
      mevProtection: false,
    };

    const sor = new SmartOrderRouter(config, logger, exchanges);

    const order: Order = {
      id: 'ord-1',
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity: 100,
      timestamp: Date.now(),
      metadata: { isSimulation: true },
    };

    const decision = await sor.routeOrder(order);
    expect(decision).toBeTruthy();
    // In paper-mode we should get a venue recommendation and metrics
    expect(decision.routes.length).toBeGreaterThan(0);
    expect(decision.totalCost).toBeGreaterThanOrEqual(0);
  });
});



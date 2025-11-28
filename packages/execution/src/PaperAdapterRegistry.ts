import { Exchange, ExchangeCapability, ExchangeStatus, TradingFees } from './types';

/**
 * High: Paper-mode adapter registry providing stub DEX exchanges only.
 * No live endpoints; supports liquidity simulation only.
 */
export function buildPaperExchanges(venueIds: string[]): Exchange[] {
  const baseFees: TradingFees = { maker: 0.001, taker: 0.001, withdrawal: {}, deposit: {} };
  const baseStatus: ExchangeStatus = {
    operational: true,
    tradingEnabled: true,
    depositsEnabled: false,
    withdrawalsEnabled: false,
    maintenanceMode: false,
    uptime: 99.9,
  };

  return venueIds.map((id) => ({
    id,
    name: id,
    type: 'dex',
    tradingFees: baseFees,
    capabilities: [ExchangeCapability.API_TRADING],
    status: baseStatus,
    latency: 300,
    reliability: 0.99,
    liquidityScore: 80,
    mevProtection: false,
    apiRateLimit: { requests: 10, period: 1 },
    supportedPairs: ['BTC/USDT','ETH/USDT'],
    lastUpdate: Date.now(),
  }));
}



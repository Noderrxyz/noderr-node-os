import { Logger } from 'winston';
import { AggregatedLevel, Exchange, ExchangeLiquidity, LiquiditySnapshot, OrderBookDepth, PriceLevel } from './types';

/**
 * High: Paper-mode liquidity aggregator that synthesizes order books and snapshots.
 * No external connections.
 */
export class PaperLiquidityAggregator {
  private exchanges: Map<string, Exchange>;
  private logger: Logger;

  constructor(logger: Logger, exchanges: Exchange[]) {
    this.logger = logger;
    this.exchanges = new Map(exchanges.map(e => [e.id, e]));
  }

  async getAggregatedLiquidity(symbol: string): Promise<LiquiditySnapshot> {
    const exchangeLiquidity: ExchangeLiquidity[] = [];
    for (const ex of this.exchanges.values()) {
      if (!ex.supportedPairs.includes(symbol)) continue;
      const { bid, ask } = this.syntheticOrderBook(symbol);
      exchangeLiquidity.push({
        exchange: ex.id,
        bid,
        ask,
        lastTrade: { id: `mock-${Date.now()}`, symbol, price: (bid[0]?.price||0+ask[0]?.price||0)/2, quantity: 0, timestamp: Date.now(), side: 'buy', exchange: ex.id },
        volume24h: 1000000,
        trades24h: 1000,
        volatility: 0.02,
      });
    }

    const aggregatedDepth = this.aggregateOrderBooks(exchangeLiquidity);
    const bestBid = { price: aggregatedDepth.bids[0]?.price || 0, quantity: aggregatedDepth.bids[0]?.quantity || 0 } as PriceLevel;
    const bestAsk = { price: aggregatedDepth.asks[0]?.price || 0, quantity: aggregatedDepth.asks[0]?.quantity || 0 } as PriceLevel;
    const spread = Math.max(0, (bestAsk.price || 0) - (bestBid.price || 0));
    const spreadPercentage = (bestBid.price && bestAsk.price) ? spread / ((bestAsk.price + bestBid.price)/2) : 0;

    return {
      symbol,
      timestamp: Date.now(),
      exchanges: exchangeLiquidity,
      aggregatedDepth,
      bestBid,
      bestAsk,
      spread,
      spreadPercentage,
      imbalance: 0,
    };
  }

  private syntheticOrderBook(symbol: string): { bid: PriceLevel[]; ask: PriceLevel[] } {
    const base = symbol.startsWith('BTC') ? 30000 : 2000;
    const jitter = (n: number) => base * (1 + (Math.random()-0.5) * 0.001) + n;
    const makeSide = (start: number, dir: 1|-1): PriceLevel[] => {
      const levels: PriceLevel[] = [];
      let price = start;
      for (let i = 0; i < 20; i++) {
        price = price + dir * (base * 0.0005);
        levels.push({ price: jitter(price), quantity: 1 + Math.random() * 5, orders: 1 });
      }
      return levels;
    };
    const mid = base * (1 + (Math.random()-0.5) * 0.002);
    return { bid: makeSide(mid, -1), ask: makeSide(mid, +1) };
  }

  private aggregateOrderBooks(ex: ExchangeLiquidity[]): OrderBookDepth {
    const agg = (side: 'bid'|'ask'): AggregatedLevel[] => {
      const map = new Map<number, AggregatedLevel>();
      for (const e of ex) {
        for (const lvl of e[side]) {
          const key = Math.round(lvl.price * 100) / 100;
          const found = map.get(key);
          if (found) {
            found.quantity += lvl.quantity;
            found.orders += lvl.orders || 1;
          } else {
            map.set(key, { price: key, quantity: lvl.quantity, orders: lvl.orders || 1, exchanges: [e.exchange] });
          }
        }
      }
      const arr = Array.from(map.values());
      return side === 'bid' ? arr.sort((a,b)=>b.price-a.price) : arr.sort((a,b)=>a.price-b.price);
    };
    const bids = agg('bid').slice(0, 50);
    const asks = agg('ask').slice(0, 50);
    const totalBidVolume = bids.reduce((s,b)=>s+b.quantity,0);
    const totalAskVolume = asks.reduce((s,a)=>s+a.quantity,0);
    const midPrice = (bids[0]?.price && asks[0]?.price) ? (bids[0].price + asks[0].price)/2 : 0;
    return { bids, asks, midPrice, weightedMidPrice: midPrice, totalBidVolume, totalAskVolume, depthImbalance: 0 };
  }
}



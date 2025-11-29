import { FeedGraphEngine } from '@noderr/telemetry/feed_graph/FeedGraphEngine';
import { ValidatorNode } from '@noderr/feeds/validator/ValidatorNode';
import { FeedSource } from '@noderr/types/FeedSource';
import { MarketSnapshot } from '@noderr/types/MarketSnapshot.types';

describe('FeedGraphEngine', () => {
  let engine: FeedGraphEngine;
  let validator1: ValidatorNode;
  let validator2: ValidatorNode;

  beforeEach(() => {
    engine = FeedGraphEngine.getInstance();
    validator1 = new ValidatorNode(FeedSource.BINANCE, {
      quarantineThresholdMs: 1000,
      maxHistorySize: 5
    });
    validator2 = new ValidatorNode(FeedSource.COINBASE, {
      quarantineThresholdMs: 1000,
      maxHistorySize: 5
    });

    engine.registerValidator(FeedSource.BINANCE, validator1);
    engine.registerValidator(FeedSource.COINBASE, validator2);
  });

  describe('Graph Generation', () => {
    it('should generate correct number of nodes', () => {
      const graph = engine.generateGraph();
      expect(graph.nodes.length).toBe(4); // 2 sources + feed_bus + agent_router
    });

    it('should generate correct number of edges', () => {
      const graph = engine.generateGraph();
      expect(graph.edges.length).toBe(3); // 2 source->bus + 1 bus->router
    });

    it('should include source node metadata', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'ETH/USD',
        timestamp: Date.now() - 500,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator1.registerSnapshot(snapshot);
      const graph = engine.generateGraph();
      const binanceNode = graph.nodes.find(n => n.id === FeedSource.BINANCE);

      expect(binanceNode).toBeDefined();
      expect(binanceNode?.metadata.latencyMs).toBeGreaterThan(0);
      expect(binanceNode?.metadata.score).toBeGreaterThan(0);
      expect(binanceNode?.metadata.quarantined).toBe(false);
    });
  });

  describe('Quarantine Detection', () => {
    it('should detect quarantined sources', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'ETH/USD',
        timestamp: Date.now() - 2000, // High latency
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator1.registerSnapshot(snapshot);
      const graph = engine.generateGraph();
      const binanceNode = graph.nodes.find(n => n.id === FeedSource.BINANCE);

      expect(binanceNode?.metadata.quarantined).toBe(true);
      expect(graph.metadata.quarantinedCount).toBe(1);
    });
  });

  describe('Latency Metrics', () => {
    it('should calculate correct average latency', () => {
      const snapshot1: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'ETH/USD',
        timestamp: Date.now() - 500,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      const snapshot2: MarketSnapshot = {
        source: FeedSource.COINBASE,
        symbol: 'ETH/USD',
        timestamp: Date.now() - 1000,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator1.registerSnapshot(snapshot1);
      validator2.registerSnapshot(snapshot2);

      const graph = engine.generateGraph();
      expect(graph.metadata.averageLatency).toBeGreaterThan(0);
    });
  });

  describe('Validator Metrics', () => {
    it('should return null for non-existent source', () => {
      const metrics = engine.getValidatorMetrics(FeedSource.KRAKEN);
      expect(metrics).toBeNull();
    });

    it('should return metrics for existing source', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'ETH/USD',
        timestamp: Date.now() - 500,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator1.registerSnapshot(snapshot);
      const metrics = engine.getValidatorMetrics(FeedSource.BINANCE);

      expect(metrics).toBeDefined();
      expect(metrics?.latencyMs).toBeGreaterThan(0);
      expect(metrics?.score).toBeGreaterThan(0);
    });
  });
}); 
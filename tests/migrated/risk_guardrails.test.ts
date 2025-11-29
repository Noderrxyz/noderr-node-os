import { DrawdownManager } from '../../risk/DrawdownManager.js';
import { DynamicTradeSizer } from '../../risk/DynamicTradeSizer.js';
import { AnomalyScanner } from '../../risk/AnomalyScanner.js';
import { TrustManager } from '../../evolution/TrustManager.js';
import { AgentKillSwitch } from '../../agents/AgentKillSwitch.js';

describe('Risk Guardrails', () => {
  let drawdownManager: DrawdownManager;
  let tradeSizer: DynamicTradeSizer;
  let anomalyScanner: AnomalyScanner;
  let trustManager: TrustManager;
  let killSwitch: AgentKillSwitch;

  beforeEach(() => {
    drawdownManager = DrawdownManager.getInstance();
    tradeSizer = DynamicTradeSizer.getInstance();
    anomalyScanner = AnomalyScanner.getInstance();
    trustManager = TrustManager.getInstance();
    killSwitch = AgentKillSwitch.getInstance();
  });

  afterEach(() => {
    drawdownManager.cleanup();
    tradeSizer.cleanup();
    anomalyScanner.cleanup();
  });

  describe('DrawdownManager', () => {
    it('should trigger circuit breaker on 10% drawdown', () => {
      const agentId = 'test-agent';
      const baseEquity = 1000;

      // Record trades to create drawdown
      for (let i = 0; i < 20; i++) {
        drawdownManager.recordTrade(agentId, {
          timestamp: Date.now(),
          pnl: -50,
          equity: baseEquity - (i + 1) * 50,
          tradeId: `trade-${i}`
        });
      }

      expect(drawdownManager.getCurrentDrawdown(agentId)).toBeGreaterThan(0.1);
      expect(drawdownManager.isAgentActive(agentId)).toBe(false);
    });

    it('should recover after cooldown period', () => {
      const agentId = 'test-agent';
      const baseEquity = 1000;

      // Trigger drawdown
      for (let i = 0; i < 20; i++) {
        drawdownManager.recordTrade(agentId, {
          timestamp: Date.now(),
          pnl: -50,
          equity: baseEquity - (i + 1) * 50,
          tradeId: `trade-${i}`
        });
      }

      // Fast forward cooldown period
      jest.advanceTimersByTime(3600000);

      expect(drawdownManager.isAgentActive(agentId)).toBe(true);
    });
  });

  describe('DynamicTradeSizer', () => {
    it('should reduce position size in high volatility', () => {
      const symbol = 'BTC/USD';
      const baseSize = 1.0;

      // Simulate high volatility
      for (let i = 0; i < 100; i++) {
        const price = 50000 + (Math.random() - 0.5) * 1000;
        tradeSizer.updateVolatility(symbol, price, Date.now());
      }

      const size = tradeSizer.calculatePositionSize(symbol, baseSize);
      expect(size).toBeLessThan(baseSize);
    });

    it('should maintain base size in low volatility', () => {
      const symbol = 'BTC/USD';
      const baseSize = 1.0;

      // Simulate low volatility
      for (let i = 0; i < 100; i++) {
        const price = 50000 + (Math.random() - 0.5) * 100;
        tradeSizer.updateVolatility(symbol, price, Date.now());
      }

      const size = tradeSizer.calculatePositionSize(symbol, baseSize);
      expect(size).toBeCloseTo(baseSize, 2);
    });
  });

  describe('AnomalyScanner', () => {
    it('should detect rogue PnL spikes', () => {
      const agentId = 'test-agent';
      const normalPnL = 100;

      // Record normal trades
      for (let i = 0; i < 50; i++) {
        anomalyScanner.processTrade(agentId, normalPnL + (Math.random() - 0.5) * 20);
      }

      // Record rogue spike
      anomalyScanner.processTrade(agentId, normalPnL * 10);

      expect(killSwitch.isKilled(agentId)).toBe(true);
      expect(trustManager.getTrustScore(agentId)).toBeLessThan(1.0);
    });

    it('should respect cooldown period', () => {
      const agentId = 'test-agent';
      const normalPnL = 100;

      // Record normal trades
      for (let i = 0; i < 50; i++) {
        anomalyScanner.processTrade(agentId, normalPnL + (Math.random() - 0.5) * 20);
      }

      // Record rogue spike
      anomalyScanner.processTrade(agentId, normalPnL * 10);

      // Try another spike during cooldown
      anomalyScanner.processTrade(agentId, normalPnL * 10);

      // Should not trigger again during cooldown
      expect(killSwitch.isKilled(agentId)).toBe(true);
    });
  });

  describe('TrustManager', () => {
    it('should decay trust score on violations', () => {
      const agentId = 'test-agent';
      const initialScore = 1.0;

      // Set initial trust score
      trustManager.updateTrustScore(agentId, initialScore);

      // Simulate violation
      trustManager.updateTrustScore(agentId, -0.1);

      expect(trustManager.getTrustScore(agentId)).toBeLessThan(initialScore);
    });

    it('should prevent mutation with low trust score', () => {
      const agentId = 'test-agent';

      // Set low trust score
      trustManager.updateTrustScore(agentId, 0.3);

      expect(trustManager.canMutate(agentId)).toBe(false);
    });
  });
}); 
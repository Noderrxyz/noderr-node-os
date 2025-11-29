import { DefaultBridgeScoringStrategy } from '../DefaultBridgeScoringStrategy';
import { Bridge } from '@noderr/types/Bridge';
import { ChainId } from '@noderr/types/ChainId';
import { BridgeMetrics } from '../BridgeSelector';

describe('DefaultBridgeScoringStrategy', () => {
  let strategy: DefaultBridgeScoringStrategy;
  
  // Test bridge
  const TEST_BRIDGE: Bridge = {
    id: 'test-bridge',
    name: 'Test Bridge',
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.ARBITRUM,
    sourceAddress: '0x123',
    destinationAddress: '0x456',
    isActive: true,
    minAmountUsd: 100,
    maxAmountUsd: 1000000,
    estimatedTimeSeconds: 300,
    feePercentage: 0.1
  };
  
  // Test metrics
  const TEST_METRICS: BridgeMetrics = {
    liquidityUsd: 500000,
    feeUsd: 50,
    estimatedTimeSeconds: 300,
    reliabilityScore: 0.95,
    securityScore: 0.9
  };
  
  // Test criteria
  const TEST_CRITERIA = {
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.ARBITRUM,
    amountUsd: 10000
  };
  
  beforeEach(() => {
    strategy = new DefaultBridgeScoringStrategy();
  });
  
  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      const score = strategy.score(TEST_BRIDGE, TEST_CRITERIA, TEST_METRICS);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });
    
    it('should accept custom configuration', () => {
      const customStrategy = new DefaultBridgeScoringStrategy({
        liquidityWeight: 0.5,
        feeWeight: 0.3,
        timeWeight: 0.1,
        reliabilityWeight: 0.05,
        securityWeight: 0.05
      });
      
      const score = customStrategy.score(TEST_BRIDGE, TEST_CRITERIA, TEST_METRICS);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });
    
    it('should throw error if weights do not sum to 1', () => {
      expect(() => new DefaultBridgeScoringStrategy({
        liquidityWeight: 0.5,
        feeWeight: 0.5,
        timeWeight: 0.5,
        reliabilityWeight: 0.5,
        securityWeight: 0.5
      })).toThrow('Scoring weights must sum to 1');
    });
  });
  
  describe('scoring', () => {
    it('should return 0 for bridges with insufficient liquidity', () => {
      const metrics = { ...TEST_METRICS, liquidityUsd: 1000 }; // Below threshold
      const score = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics);
      expect(score).toBe(0);
    });
    
    it('should return 0 for bridges with excessive fees', () => {
      const metrics = { ...TEST_METRICS, feeUsd: 1000 }; // Above threshold
      const score = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics);
      expect(score).toBe(0);
    });
    
    it('should return 0 for bridges with excessive time', () => {
      const metrics = { ...TEST_METRICS, estimatedTimeSeconds: 4000 }; // Above threshold
      const score = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics);
      expect(score).toBe(0);
    });
    
    it('should score bridges with good metrics higher', () => {
      const goodMetrics: BridgeMetrics = {
        liquidityUsd: 1000000,
        feeUsd: 10,
        estimatedTimeSeconds: 100,
        reliabilityScore: 0.99,
        securityScore: 0.98
      };
      
      const badMetrics: BridgeMetrics = {
        liquidityUsd: 200000,
        feeUsd: 80,
        estimatedTimeSeconds: 2000,
        reliabilityScore: 0.7,
        securityScore: 0.6
      };
      
      const goodScore = strategy.score(TEST_BRIDGE, TEST_CRITERIA, goodMetrics);
      const badScore = strategy.score(TEST_BRIDGE, TEST_CRITERIA, badMetrics);
      
      expect(goodScore).toBeGreaterThan(badScore);
    });
    
    it('should handle errors gracefully', () => {
      const invalidMetrics = { ...TEST_METRICS, liquidityUsd: -1 };
      const score = strategy.score(TEST_BRIDGE, TEST_CRITERIA, invalidMetrics);
      expect(score).toBe(0);
    });
  });
  
  describe('component scores', () => {
    it('should calculate liquidity score with diminishing returns', () => {
      const metrics1 = { ...TEST_METRICS, liquidityUsd: 100000 };
      const metrics2 = { ...TEST_METRICS, liquidityUsd: 1000000 };
      const metrics3 = { ...TEST_METRICS, liquidityUsd: 10000000 };
      
      const score1 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics1);
      const score2 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics2);
      const score3 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics3);
      
      // Score should increase but with diminishing returns
      expect(score2).toBeGreaterThan(score1);
      expect(score3).toBeGreaterThan(score2);
      expect(score3 - score2).toBeLessThan(score2 - score1);
    });
    
    it('should calculate fee score with percentage-based scaling', () => {
      const metrics1 = { ...TEST_METRICS, feeUsd: 10 };
      const metrics2 = { ...TEST_METRICS, feeUsd: 50 };
      const metrics3 = { ...TEST_METRICS, feeUsd: 90 };
      
      const score1 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics1);
      const score2 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics2);
      const score3 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics3);
      
      // Lower fees should score higher
      expect(score1).toBeGreaterThan(score2);
      expect(score2).toBeGreaterThan(score3);
    });
    
    it('should calculate time score with linear scaling', () => {
      const metrics1 = { ...TEST_METRICS, estimatedTimeSeconds: 100 };
      const metrics2 = { ...TEST_METRICS, estimatedTimeSeconds: 1800 };
      const metrics3 = { ...TEST_METRICS, estimatedTimeSeconds: 3500 };
      
      const score1 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics1);
      const score2 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics2);
      const score3 = strategy.score(TEST_BRIDGE, TEST_CRITERIA, metrics3);
      
      // Lower times should score higher
      expect(score1).toBeGreaterThan(score2);
      expect(score2).toBeGreaterThan(score3);
    });
  });
}); 
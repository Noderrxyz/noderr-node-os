/**
 * ExecutionSecurityLayer Test Suite
 * 
 * Tests the functionality of the ExecutionSecurityLayer including:
 * - Slippage validation
 * - MEV protection
 * - Rate limiting
 * - Time-bounded transactions
 */

import { ExecutionSecurityLayer, SlippageValidationResult } from '../ExecutionSecurityLayer';
import { TradeRequest } from '../IChainAdapter';
import { ChainId } from '../index';

describe('ExecutionSecurityLayer', () => {
  // Setup test security layer
  let securityLayer: ExecutionSecurityLayer;
  
  beforeEach(() => {
    securityLayer = new ExecutionSecurityLayer({
      flashbots: {
        enabled: true,
        relayUrls: {
          [ChainId.ETHEREUM]: 'https://relay.flashbots.net'
        }
      },
      slippageProtection: {
        defaultTolerance: 0.5, // 0.5%
        maxTolerance: 5, // 5%
        enablePriceChecking: true,
        timeBound: 300 // 5 minutes
      },
      rateLimiting: {
        enabled: true,
        maxRequestsPerMinute: {
          'test-strategy': 5
        },
        maxRequestsPerDay: {
          'test-strategy': 100
        }
      }
    });
  });
  
  describe('validateSlippage', () => {
    it('should validate slippage within tolerance', () => {
      const tradeRequest: TradeRequest = {
        fromAsset: {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          chainId: ChainId.ETHEREUM,
          isNative: true
        },
        toAsset: {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: ChainId.ETHEREUM,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        inputAmount: '1000000000000000000', // 1 ETH
        expectedOutput: '2000000000', // 2000 USDC
        slippageTolerance: 0.5, // 0.5%
        minOutput: '1990000000', // 1990 USDC
      };
      
      const result = securityLayer.validateSlippage(tradeRequest);
      
      expect(result.valid).toBe(true);
      expect(result.expectedOutput).toBe(BigInt('2000000000'));
      expect(result.minAcceptableOutput).toBe(BigInt('1990000000'));
      expect(result.calculatedSlippage).toBe(0.5);
    });
    
    it('should reject slippage exceeding tolerance', () => {
      const tradeRequest: TradeRequest = {
        fromAsset: {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          chainId: ChainId.ETHEREUM,
          isNative: true
        },
        toAsset: {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: ChainId.ETHEREUM,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        inputAmount: '1000000000000000000', // 1 ETH
        expectedOutput: '2000000000', // 2000 USDC
        slippageTolerance: 0.5, // 0.5%
        minOutput: '1980000000', // 1980 USDC - more than 0.5% slippage
      };
      
      const result = securityLayer.validateSlippage(tradeRequest);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Provided minOutput');
      expect(result.minAcceptableOutput).toBe(BigInt('1990000000'));
    });
    
    it('should reject slippage tolerance above the maximum', () => {
      const tradeRequest: TradeRequest = {
        fromAsset: {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          chainId: ChainId.ETHEREUM,
          isNative: true
        },
        toAsset: {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: ChainId.ETHEREUM,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        inputAmount: '1000000000000000000', // 1 ETH
        expectedOutput: '2000000000', // 2000 USDC
        slippageTolerance: 10, // 10% - above the 5% max
        minOutput: '1800000000', // 1800 USDC
      };
      
      const result = securityLayer.validateSlippage(tradeRequest);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum allowed');
    });
  });
  
  describe('addTimeBounds', () => {
    it('should add deadline to trade request', () => {
      const tradeRequest: TradeRequest = {
        fromAsset: {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          chainId: ChainId.ETHEREUM,
          isNative: true
        },
        toAsset: {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: ChainId.ETHEREUM,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        inputAmount: '1000000000000000000', // 1 ETH
        expectedOutput: '2000000000', // 2000 USDC
      };
      
      const now = Math.floor(Date.now() / 1000);
      const boundedRequest = securityLayer.addTimeBounds(tradeRequest);
      
      expect(boundedRequest.deadline).toBeDefined();
      expect(boundedRequest.deadline).toBeGreaterThan(now);
      expect(boundedRequest.deadline).toBeLessThanOrEqual(now + 300); // 5 minutes
    });
    
    it('should preserve existing deadline', () => {
      const existingDeadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
      
      const tradeRequest: TradeRequest = {
        fromAsset: {
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          chainId: ChainId.ETHEREUM,
          isNative: true
        },
        toAsset: {
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          chainId: ChainId.ETHEREUM,
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        inputAmount: '1000000000000000000', // 1 ETH
        expectedOutput: '2000000000', // 2000 USDC
        deadline: existingDeadline
      };
      
      const boundedRequest = securityLayer.addTimeBounds(tradeRequest);
      
      expect(boundedRequest.deadline).toBe(existingDeadline);
    });
  });
  
  describe('rate limiting', () => {
    it('should track rate limits correctly', () => {
      const strategyId = 'test-strategy';
      
      // First request should pass
      expect(() => securityLayer.checkRateLimits(strategyId)).not.toThrow();
      
      // Simulate multiple requests
      for (let i = 0; i < 4; i++) {
        securityLayer.checkRateLimits(strategyId);
      }
      
      // 6th request should fail (limit is 5 per minute)
      expect(() => securityLayer.checkRateLimits(strategyId)).toThrow(/Rate limit exceeded/);
      
      // Reset and try again
      securityLayer.resetRateLimits(strategyId);
      expect(() => securityLayer.checkRateLimits(strategyId)).not.toThrow();
    });
  });
  
  describe('security layer status', () => {
    it('should return correct status', () => {
      const status = securityLayer.getStatus();
      
      expect(status.flashbotsEnabled).toBe(true);
      expect(status.supportedChains).toContain(ChainId.ETHEREUM);
      expect(status.slippageProtection).toBe(true);
      expect(status.maxSlippage).toBe(5);
      expect(status.rateLimitingEnabled).toBe(true);
      expect(status.multiSigEnabled).toBe(false);
      expect(status.pendingMultiSigTransactions).toBe(0);
    });
  });
}); 
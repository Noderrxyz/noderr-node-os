/**
 * Smart Order Router Tests
 * 
 * Simple example to demonstrate the SmartOrderRouter in action.
 * In a real implementation, this would be part of a comprehensive test suite.
 */

import { SmartOrderRouter, SmartOrderRouterConfig } from './SmartOrderRouter';
import { UniswapVenue, UniswapVenueConfig } from '../venues/dex/UniswapVenue';
import { SushiswapVenue, SushiswapVenueConfig } from '../venues/dex/SushiswapVenue';
import { ExecutionVenue } from '../venues/VenueRegistry';
import { TrustEngine, TrustRecord } from '../risk/TrustEngine';
import { OrderIntent, ExecutionStyle } from '@noderr/types/execution.types';
import { createLogger } from '@noderr/common/logger';

const logger = createLogger('SmartOrderRouterTest');

/**
 * Mock implementation of the TrustEngine for testing
 */
class MockTrustEngine implements TrustEngine {
  private venueScores: Map<string, number> = new Map([
    ['uniswap_v3', 0.95],
    ['sushiswap', 0.85],
    ['curve', 0.9],
    ['0x_api', 0.8]
  ]);
  
  async getVenueTrust(venueId: string): Promise<number> {
    return this.venueScores.get(venueId) || 0.5;
  }
  
  async updateVenueTrust(venueId: string, score: number): Promise<void> {
    this.venueScores.set(venueId, score);
  }
}

/**
 * Simple example of the SmartOrderRouter in action
 */
async function main() {
  logger.info('Initializing Smart Order Router test...');
  
  // Create mock venues
  const venues = createMockVenues();
  
  // Create mock trust engine
  const trustEngine = new MockTrustEngine();
  
  // Create router config
  const routerConfig: SmartOrderRouterConfig = {
    enabledDexes: ['uniswap_v3', 'sushiswap'],
    considerGasCosts: true,
    gasPriceMultiplier: {
      low: 1.0,
      medium: 1.2,
      high: 1.5
    },
    slippageTolerance: {
      low: 50, // 0.5%
      medium: 100, // 1%
      high: 200 // 2%
    },
    maxPriceImpact: 5.0, // 5%
    weights: {
      slippage: 0.5,
      gas: 0.25,
      trust: 0.15,
      liquidity: 0.1
    },
    quoteCacheMs: 10000, // 10 seconds
    failOnHighImpact: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    simulationMode: true
  };
  
  // Create Smart Order Router
  const router = new SmartOrderRouter(venues, trustEngine, undefined, routerConfig);
  
  // Test orders with different sizes and urgency levels
  const testCases = [
    {
      name: 'Small ETH/USDC buy with low urgency',
      order: {
        asset: 'ETH/USDC',
        side: 'buy',
        quantity: 1.0,
        urgency: 'low'
      }
    },
    {
      name: 'Medium ETH/USDC buy with medium urgency',
      order: {
        asset: 'ETH/USDC',
        side: 'buy',
        quantity: 10.0,
        urgency: 'medium'
      }
    },
    {
      name: 'Large ETH/USDC buy with high urgency',
      order: {
        asset: 'ETH/USDC',
        side: 'buy',
        quantity: 50.0,
        urgency: 'high'
      }
    },
    {
      name: 'Small BTC/USDT sell with low urgency',
      order: {
        asset: 'BTC/USDT',
        side: 'sell',
        quantity: 0.1,
        urgency: 'low'
      }
    },
    {
      name: 'Medium BTC/USDT sell with medium urgency',
      order: {
        asset: 'BTC/USDT',
        side: 'sell',
        quantity: 1.0,
        urgency: 'medium'
      }
    }
  ];
  
  // Run test cases
  for (const testCase of testCases) {
    logger.info(`\nTest case: ${testCase.name}`);
    
    try {
      // First route the order
      logger.info(`Routing order...`);
      const routingResult = await router.route(testCase.order as OrderIntent);
      
      // Log the routing result
      logger.info(`Routing result:`);
      logger.info(`- Selected venue: ${routingResult.venue || 'None'}`);
      logger.info(`- Score: ${routingResult.score.toFixed(2)}`);
      logger.info(`- Est. slippage: ${routingResult.estimatedSlippageBps} bps`);
      logger.info(`- Execution style: ${routingResult.recommendedStyle}`);
      
      if (routingResult.venue) {
        // Execute the order
        logger.info(`Executing order...`);
        const executedOrder = await router.execute(testCase.order as OrderIntent);
        
        // Log the execution result
        logger.info(`Execution result:`);
        logger.info(`- Order ID: ${executedOrder.orderId}`);
        logger.info(`- Executed price: ${executedOrder.executedPrice}`);
        logger.info(`- Executed quantity: ${executedOrder.executedQuantity}`);
        logger.info(`- Slippage: ${executedOrder.slippageBps} bps`);
        logger.info(`- Latency: ${executedOrder.latencyMs} ms`);
        logger.info(`- Status: ${executedOrder.status}`);
      } else {
        logger.warn(`No suitable venue found: ${routingResult.delayReason}`);
      }
    } catch (error) {
      logger.error(`Error in test case: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  logger.info('\nSmart Order Router test completed!');
}

/**
 * Create mock venue instances for testing
 */
function createMockVenues(): ExecutionVenue[] {
  // Create Uniswap venue
  const uniswapConfig: UniswapVenueConfig = {
    id: 'uniswap_v3',
    name: 'Uniswap V3',
    type: 'dex',
    apiUrl: 'https://api.uniswap.org/v1',
    requestTimeoutMs: 10000,
    rateLimit: 10,
    supportedAssets: ['ETH/USDC', 'ETH/USDT', 'BTC/USDC', 'BTC/USDT', 'ETH/DAI'],
    feeBps: 30, // 0.3%
    supportsMargin: false,
    enabled: true,
    routerAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    defaultFeeTier: 3000,
    providerUrl: 'https://mainnet.infura.io/v3/your-key',
    useUniversalRouter: true,
    gasLimitOverride: 0
  };
  
  // Create Sushiswap venue
  const sushiswapConfig: SushiswapVenueConfig = {
    id: 'sushiswap',
    name: 'Sushiswap',
    type: 'dex',
    apiUrl: 'https://api.sushi.com/v1',
    requestTimeoutMs: 12000,
    rateLimit: 8,
    supportedAssets: ['ETH/USDC', 'ETH/USDT', 'BTC/USDC', 'BTC/USDT', 'ETH/DAI', 'LINK/ETH'],
    feeBps: 30, // 0.3%
    supportsMargin: false,
    enabled: true,
    routerAddress: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    providerUrl: 'https://mainnet.infura.io/v3/your-key',
    gasLimitOverride: 0,
    useTrident: false
  };
  
  return [
    new UniswapVenue(uniswapConfig),
    new SushiswapVenue(sushiswapConfig)
  ];
}

// Run the test
if (require.main === module) {
  main().catch(error => {
    logger.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
} 
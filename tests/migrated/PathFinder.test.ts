import { PathFinder } from '../PathFinder';
import { Asset } from '@noderr/types/Asset';
import { ChainId } from '@noderr/types/ChainId';
import { Bridge } from '@noderr/types/Bridge';
import { Path } from '@noderr/types/Path';
import { PathScore } from '@noderr/types/PathScore';

describe('PathFinder', () => {
  let pathFinder: PathFinder;
  
  // Test assets
  const ETH: Asset = {
    chainId: ChainId.ETHEREUM,
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    decimals: 18,
    name: 'Ethereum'
  };
  
  const USDC: Asset = {
    chainId: ChainId.ARBITRUM,
    address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin'
  };
  
  // Test bridge
  const ARBITRUM_BRIDGE: Bridge = {
    id: 'arbitrum-bridge',
    name: 'Arbitrum Bridge',
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.ARBITRUM,
    sourceAddress: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a',
    destinationAddress: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a',
    isActive: true,
    minAmountUsd: 0,
    maxAmountUsd: 1000000,
    estimatedTimeSeconds: 300,
    feePercentage: 0.1
  };
  
  beforeEach(() => {
    pathFinder = PathFinder.getInstance();
  });
  
  describe('findOptimalPath', () => {
    it('should return null when no paths are found', async () => {
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      expect(result).toBeNull();
    });
    
    it('should find the optimal path when bridges are available', async () => {
      // Mock bridge lookup
      jest.spyOn(pathFinder as any, 'getBridgesForChain').mockReturnValue([ARBITRUM_BRIDGE]);
      
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      
      expect(result).not.toBeNull();
      expect(result?.path.hops).toHaveLength(1);
      expect(result?.path.hops[0].bridge).toBe(ARBITRUM_BRIDGE.id);
      expect(result?.score.total).toBeGreaterThan(0);
    });
    
    it('should use cached results when available', async () => {
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      // First call to populate cache
      await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      // Reset mocks to verify they're not called again
      jest.clearAllMocks();
      // Second call should use cache
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      expect(result).not.toBeNull();
      expect((pathFinder as any).estimatePathScore).not.toHaveBeenCalled();
    });
    
    it('should penalize paths with high price impact or low liquidity', async () => {
      // Mock path scoring to simulate high price impact and low liquidity
      jest.spyOn(pathFinder as any, 'getPriceImpact').mockResolvedValue(10); // 10% price impact
      jest.spyOn(pathFinder as any, 'getBridgeLiquidity').mockResolvedValue(100); // below minLiquidityUsd
      // Use a real path to trigger the penalty
      const result = await (pathFinder as any).estimatePathScore({
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '1.0'
      });
      expect(result.total).toBe(0);
      expect(result.gasCost).toBe(0);
      expect(result.liquidity).toBe(0);
    });

    it('should handle errors in fee estimation gracefully', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockImplementation(() => { throw new Error('Gas API error'); });
      const result = await (pathFinder as any).estimatePathScore({
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '1.0'
      });
      expect(result.total).toBe(0);
      expect(result.gasCost).toBe(0);
    });
    
    it('should respect maxHops configuration', async () => {
      // Mock bridge lookup with multiple bridges
      const bridges = [
        ARBITRUM_BRIDGE,
        {
          ...ARBITRUM_BRIDGE,
          id: 'optimism-bridge',
          name: 'Optimism Bridge',
          destinationChain: ChainId.OPTIMISM
        }
      ];
      
      jest.spyOn(pathFinder as any, 'getBridgesForChain').mockReturnValue(bridges);
      
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      
      // Set maxHops to 1
      pathFinder = PathFinder.getInstance({ maxHops: 1 });
      
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      
      expect(result).not.toBeNull();
      expect(result?.path.hops.length).toBeLessThanOrEqual(1);
    });
  });
  
  describe('configuration', () => {
    it('should validate and normalize scoring weights', () => {
      const config = {
        scoringWeights: {
          gasCost: 0.4,
          bridgeFees: 0.4,
          priceImpact: 0.4,
          pathLength: 0.4,
          liquidity: 0.4
        }
      };
      
      pathFinder = PathFinder.getInstance(config);
      
      const weights = (pathFinder as any).config.scoringWeights as Record<string, number>;
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });
  });

  describe('simulatePath', () => {
    it('should simulate a normal path with reasonable output', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockResolvedValue(1);
      jest.spyOn(pathFinder as any, 'getBridgeFee').mockResolvedValue(2);
      jest.spyOn(pathFinder as any, 'getBridgeLiquidity').mockResolvedValue(100000);
      jest.spyOn(pathFinder as any, 'getPriceImpact').mockResolvedValue(1); // 1% slippage
      const path = {
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '100'
      };
      const result = await pathFinder.simulatePath(path, '100');
      expect(parseFloat(result.expectedOutputAmount)).toBeGreaterThan(0);
      expect(result.failureProbability).toBeLessThan(1);
      expect(result.warnings.length).toBe(0);
    });
    it('should warn and increase risk for high slippage', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockResolvedValue(1);
      jest.spyOn(pathFinder as any, 'getBridgeFee').mockResolvedValue(2);
      jest.spyOn(pathFinder as any, 'getBridgeLiquidity').mockResolvedValue(100000);
      jest.spyOn(pathFinder as any, 'getPriceImpact').mockResolvedValue(10); // 10% slippage
      const path = {
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '100'
      };
      const result = await pathFinder.simulatePath(path, '100');
      expect(result.failureProbability).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('High price impact'))).toBe(true);
    });
    it('should warn and increase risk for low liquidity', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockResolvedValue(1);
      jest.spyOn(pathFinder as any, 'getBridgeFee').mockResolvedValue(2);
      jest.spyOn(pathFinder as any, 'getBridgeLiquidity').mockResolvedValue(10); // low liquidity
      jest.spyOn(pathFinder as any, 'getPriceImpact').mockResolvedValue(1);
      const path = {
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '100'
      };
      const result = await pathFinder.simulatePath(path, '100');
      expect(result.failureProbability).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('Low liquidity'))).toBe(true);
    });
    it('should warn and increase risk for excessive fees', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockResolvedValue(30);
      jest.spyOn(pathFinder as any, 'getBridgeFee').mockResolvedValue(30);
      jest.spyOn(pathFinder as any, 'getBridgeLiquidity').mockResolvedValue(100000);
      jest.spyOn(pathFinder as any, 'getPriceImpact').mockResolvedValue(1);
      const path = {
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '100'
      };
      const result = await pathFinder.simulatePath(path, '100');
      expect(result.failureProbability).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('Excessive fees'))).toBe(true);
    });
    it('should handle errors in simulation gracefully', async () => {
      jest.spyOn(pathFinder as any, 'getGasCost').mockImplementation(() => { throw new Error('Sim error'); });
      const path = {
        hops: [{
          fromChain: ChainId.ETHEREUM,
          toChain: ChainId.ARBITRUM,
          bridge: 'arbitrum-bridge',
          asset: ETH
        }],
        fromAsset: ETH,
        toAsset: USDC,
        amount: '100'
      };
      const result = await pathFinder.simulatePath(path, '100');
      expect(result.failureProbability).toBe(1);
      expect(result.expectedOutputAmount).toBe('0');
      expect(result.warnings[0]).toContain('Simulation failed');
    });
  });
}); 
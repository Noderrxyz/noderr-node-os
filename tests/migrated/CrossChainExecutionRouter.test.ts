import { CrossChainExecutionRouter } from '@noderr/src/execution/CrossChainExecutionRouter';
import { ExecutionSecurityLayer } from '@noderr/src/execution/ExecutionSecurityLayer';
import { ChainAdapterMock } from '../e2e/mocks/ChainAdapterMock';
import { StrategyGenome } from '@noderr/src/evolution/StrategyGenome';

jest.mock('../../src/execution/ExecutionSecurityLayer');

const mockAdapters = {
  ethereum: new ChainAdapterMock('ethereum'),
  solana: new ChainAdapterMock('solana'),
};

const mockConfig = {
  defaultChainId: 'ethereum',
  preferDeployedStrategies: false,
  maxFeeCostMultiplier: 2.0,
  minChainHealthScore: 0.5,
  selectionWeights: { feeCost: 0.4, latency: 0.2, reliability: 0.2, regimeCompatibility: 0.2 },
  enableAutoRetry: true,
  maxRetryAttempts: 2,
  retryBackoffBaseMs: 1000,
};

describe('CrossChainExecutionRouter', () => {
  let router: CrossChainExecutionRouter;

  beforeEach(() => {
    (ExecutionSecurityLayer.getInstance as jest.Mock).mockReturnValue({
      authorizeExecution: jest.fn().mockResolvedValue({ isAuthorized: true, authToken: 'mock', riskScore: 0.1 }),
    });
    router = CrossChainExecutionRouter.getInstance(mockConfig);
    // @ts-ignore
    router.adapters.set('ethereum', mockAdapters.ethereum);
    // @ts-ignore
    router.adapters.set('solana', mockAdapters.solana);
  });

  function makeGenome(id: string) {
    return new StrategyGenome(id, { sharpeRatio: 1.2 }, { tags: ['test'] }, { paramA: 42 });
  }

  it('should route and execute a strategy successfully', async () => {
    const genome = makeGenome('strat1');
    const params = {
      amount: 1,
      slippageTolerance: 0.01,
      timeoutMs: 10000,
      isSimulation: false,
      feeParams: { gasLimit: 21000 }
    };
    const result = await router.executeStrategy(genome, 'ETH-USD', params);
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  it('should reject execution if not authorized', async () => {
    (ExecutionSecurityLayer.getInstance as jest.Mock).mockReturnValue({
      authorizeExecution: jest.fn().mockResolvedValue({ isAuthorized: false, reason: 'Not allowed', riskScore: 1.0 }),
    });
    router = CrossChainExecutionRouter.getInstance(mockConfig);
    // @ts-ignore
    router.adapters.set('ethereum', mockAdapters.ethereum);
    const genome = makeGenome('strat2');
    const params = {
      amount: 1,
      slippageTolerance: 0.01,
      timeoutMs: 10000,
      isSimulation: false,
      feeParams: { gasLimit: 21000 }
    };
    const result = await router.executeStrategy(genome, 'ETH-USD', params);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle adapter errors gracefully', async () => {
    const errorAdapter = {
      executeTransaction: jest.fn().mockRejectedValue(new Error('Adapter error')),
    };
    // @ts-ignore
    router.adapters.set('ethereum', errorAdapter);
    const genome = makeGenome('strat3');
    const params = {
      amount: 1,
      slippageTolerance: 0.01,
      timeoutMs: 10000,
      isSimulation: false,
      feeParams: { gasLimit: 21000 }
    };
    const result = await router.executeStrategy(genome, 'ETH-USD', params);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Adapter error');
  });
}); 
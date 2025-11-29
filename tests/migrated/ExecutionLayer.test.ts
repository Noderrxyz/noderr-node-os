import { ExecutionLayer } from '@noderr/src/execution/ExecutionLayer';
import { ChainAdapterMock } from '../e2e/mocks/ChainAdapterMock';

const mockAdapters = {
  ethereum: new ChainAdapterMock('ethereum'),
  solana: new ChainAdapterMock('solana'),
};

describe('ExecutionLayer', () => {
  let executionLayer: ExecutionLayer;

  beforeEach(() => {
    executionLayer = new ExecutionLayer({ adapters: mockAdapters });
  });

  it('should execute a market order successfully', async () => {
    const order = {
      type: 'MARKET',
      side: 'BUY',
      amount: '1',
      sourceChain: 'ethereum',
      targetChain: 'solana',
      token: 'USDC',
      slippageTolerance: 0.01,
      deadline: Date.now() + 10000,
    };
    const result = await executionLayer.executeOrder(order);
    expect(result.status).toBeDefined();
    expect(result.transactions.length).toBeGreaterThan(0);
  });

  it('should fail to execute an order with negative amount', async () => {
    const order = {
      type: 'MARKET',
      side: 'BUY',
      amount: '-1',
      sourceChain: 'ethereum',
      targetChain: 'solana',
      token: 'USDC',
      slippageTolerance: 0.01,
      deadline: Date.now() + 10000,
    };
    await expect(executionLayer.executeOrder(order)).rejects.toThrow();
  });

  it('should get transaction status', async () => {
    const status = await executionLayer.getTransactionStatus('mock-tx-hash', 'ethereum');
    expect(status).toHaveProperty('status');
  });

  it('should attempt to cancel a transaction', async () => {
    const cancelled = await executionLayer.cancelTransaction('mock-tx-hash', 'ethereum');
    expect(typeof cancelled).toBe('boolean');
  });

  it('should estimate cross-chain fee', async () => {
    const fee = await executionLayer.estimateCrossChainFee('ethereum', 'solana', '100', 'USDC');
    expect(fee).toHaveProperty('totalFee');
  });

  it('should execute a cross-chain transfer', async () => {
    const transfer = {
      sourceChain: 'ethereum',
      targetChain: 'solana',
      amount: '100',
      token: 'USDC',
      recipient: 'solana-address',
      slippageTolerance: 0.01,
      deadline: Date.now() + 10000,
    };
    const result = await executionLayer.executeCrossChainTransfer(transfer);
    expect(result.status).toBeDefined();
    expect(result.transferId).toBeDefined();
  });
}); 
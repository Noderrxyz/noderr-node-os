import { ChainAdapterMock } from '../e2e/mocks/ChainAdapterMock';

describe('ChainAdapterMock', () => {
  let adapter: ChainAdapterMock;

  beforeEach(() => {
    adapter = new ChainAdapterMock('ethereum');
  });

  it('should execute a transaction successfully', async () => {
    const tx = { from: '0x123', to: '0x456', amount: 100 };
    const result = await adapter.executeTransaction(tx);
    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
  });

  it('should throw on invalid transaction (negative amount)', async () => {
    const tx = { from: '0x123', to: '0x456', amount: -100 };
    await expect(adapter.executeTransaction(tx)).rejects.toThrow();
  });

  it('should get a fixed balance', async () => {
    const balance = await adapter.getBalance('0x123');
    expect(balance).toBe(1000);
  });

  it('should log transaction execution', async () => {
    const tx = { from: '0x123', to: '0x456', amount: 50 };
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await adapter.executeTransaction(tx);
    expect(consoleSpy).toHaveBeenCalledWith('[ethereum] Executing transaction:', tx);
    consoleSpy.mockRestore();
  });

  it('should log balance check', async () => {
    const address = '0x123';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await adapter.getBalance(address);
    expect(consoleSpy).toHaveBeenCalledWith('[ethereum] Getting balance for address:', address);
    consoleSpy.mockRestore();
  });
}); 
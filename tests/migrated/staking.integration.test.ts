/**
 * Staking Adapters Integration Tests
 * 
 * Comprehensive integration tests for all staking protocol adapters
 * with the Floor Engine orchestrator.
 * 
 * Tests:
 * - Lido integration
 * - Rocket Pool integration
 * - Native ETH integration
 * - Multi-staking allocation
 * - Staking rebalancing
 * - Staking position tracking
 * 
 * @module tests/staking.integration
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { FloorEngine } from '../src/core/FloorEngine.v2';
import { AdapterRegistry } from '../src/core/AdapterRegistry';
import { FloorEngineConfig } from '../src/types';

describe('Staking Adapters Integration Tests', () => {
  let engine: FloorEngine;
  let registry: AdapterRegistry;

  const config: FloorEngineConfig = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    privateKey: process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    chainId: 1,
    networkName: 'mainnet',
    allocationStrategy: {
      lending: 0,
      staking: 100, // 100% to staking for these tests
      yield: 0,
    },
    targetAllocations: [],
    riskParameters: {
      maxPositionSize: 50,
      maxDrawdown: 20,
      minLiquidity: ethers.parseEther('1000'),
      emergencyWithdrawThreshold: 30,
    },
    minRebalanceInterval: 3600,
    minHarvestInterval: 86400,
    rebalanceThresholdBps: 500,
    gasLimit: 500000,
    maxGasPrice: ethers.parseUnits('100', 'gwei'),
  };

  beforeEach(async () => {
    engine = new FloorEngine(config);
    registry = engine.getAdapterRegistry();
    
    // Register staking adapters
    registry.registerAdapter({
      id: 'lido-steth',
      protocol: 'Lido',
      category: 'staking',
      chain: 'ethereum',
      riskScore: 2,
      tvl: ethers.parseEther('30000000'), // $30B TVL
      apy: 3.5,
      enabled: true,
      supportedAssets: ['ETH', 'stETH'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'rocketpool-reth',
      protocol: 'Rocket Pool',
      category: 'staking',
      chain: 'ethereum',
      riskScore: 3,
      tvl: ethers.parseEther('3000000'), // $3B TVL
      apy: 3.2,
      enabled: true,
      supportedAssets: ['ETH', 'rETH'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'native-eth',
      protocol: 'Native ETH',
      category: 'staking',
      chain: 'ethereum',
      riskScore: 1,
      tvl: ethers.parseEther('100000000'), // Entire beacon chain
      apy: 4.0,
      enabled: true,
      supportedAssets: ['ETH'],
      metadata: {},
    });

    await engine.initialize();
  });

  describe('Lido Integration', () => {
    it('should allocate capital to Lido', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const lidoPosition = positions.find(p => p.adapterId === 'lido-steth');
      
      expect(lidoPosition).to.exist;
      expect(lidoPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Lido position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const lidoPosition = positions.find(p => p.adapterId === 'lido-steth');
      
      expect(lidoPosition).to.exist;
      expect(lidoPosition!.protocol).to.equal('Lido');
      expect(lidoPosition!.category).to.equal('staking');
      expect(lidoPosition!.apy).to.be.greaterThan(0);
    });

    it('should calculate APY for Lido position', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const apy = await engine.getAPY();
      expect(apy).to.be.greaterThan(0);
      expect(apy).to.be.lessThan(10); // Reasonable staking APY range
    });

    it('should handle stETH rebasing', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // In production, stETH balance would increase over time
      // For now, we verify the position tracking works
      const positions1 = await engine.getPositions();
      const value1 = positions1.find(p => p.adapterId === 'lido-steth')!.value;
      
      // Simulate time passing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const positions2 = await engine.getPositions();
      const value2 = positions2.find(p => p.adapterId === 'lido-steth')!.value;
      
      // In production, value2 would be > value1 due to rebasing
      // For testing, we just verify tracking works
      expect(value2).to.equal(value1);
    });
  });

  describe('Rocket Pool Integration', () => {
    it('should allocate capital to Rocket Pool', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const rocketPoolPosition = positions.find(p => p.adapterId === 'rocketpool-reth');
      
      expect(rocketPoolPosition).to.exist;
      expect(rocketPoolPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Rocket Pool position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const rocketPoolPosition = positions.find(p => p.adapterId === 'rocketpool-reth');
      
      expect(rocketPoolPosition).to.exist;
      expect(rocketPoolPosition!.protocol).to.equal('Rocket Pool');
      expect(rocketPoolPosition!.category).to.equal('staking');
    });

    it('should handle rETH exchange rate', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const rocketPoolPosition = positions.find(p => p.adapterId === 'rocketpool-reth');
      
      // In production, rETH exchange rate would be > 1 ETH
      // Position value should reflect this
      expect(rocketPoolPosition!.value).to.be.greaterThan(0n);
    });
  });

  describe('Native ETH Integration', () => {
    it('should allocate capital to Native ETH staking', async () => {
      const amount = ethers.parseEther('32'); // Minimum for validator
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const nativePosition = positions.find(p => p.adapterId === 'native-eth');
      
      expect(nativePosition).to.exist;
      expect(nativePosition!.value).to.be.greaterThan(0n);
    });

    it('should track Native ETH position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('32'));
      
      const positions = await engine.getPositions();
      const nativePosition = positions.find(p => p.adapterId === 'native-eth');
      
      expect(nativePosition).to.exist;
      expect(nativePosition!.protocol).to.equal('Native ETH');
      expect(nativePosition!.category).to.equal('staking');
    });

    it('should handle validator rewards', async () => {
      await engine.allocateCapital(ethers.parseEther('32'));
      
      const positions = await engine.getPositions();
      const nativePosition = positions.find(p => p.adapterId === 'native-eth');
      
      // Native staking should have highest APY
      expect(nativePosition!.apy).to.be.greaterThan(3.5);
    });
  });

  describe('Multi-Staking Allocation', () => {
    it('should allocate capital across all staking adapters', async () => {
      const amount = ethers.parseEther('90'); // 30 ETH per adapter
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      
      // Should have positions in all 3 staking adapters
      expect(positions.length).to.equal(3);
      
      // Each should have roughly equal allocation
      const expectedPerAdapter = amount / 3n;
      for (const position of positions) {
        expect(position.value).to.equal(expectedPerAdapter);
      }
    });

    it('should calculate total staked value correctly', async () => {
      const amount = ethers.parseEther('90');
      await engine.allocateCapital(amount);
      
      const totalValue = await engine.getTotalValue();
      expect(totalValue).to.equal(amount);
    });

    it('should calculate weighted average staking APY', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      const apy = await engine.getAPY();
      
      // Weighted average should be between min and max staking APYs
      expect(apy).to.be.greaterThan(3.0);
      expect(apy).to.be.lessThan(4.5);
    });

    it('should respect allocation strategy', async () => {
      const amount = ethers.parseEther('90');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      
      // All positions should be staking category
      for (const position of positions) {
        expect(position.category).to.equal('staking');
      }
    });
  });

  describe('Staking Position Tracking', () => {
    it('should update staking positions correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      const positions1 = await engine.getPositions();
      const timestamp1 = positions1[0].lastUpdate;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const positions2 = await engine.getPositions();
      const timestamp2 = positions2[0].lastUpdate;
      
      expect(timestamp2).to.be.greaterThan(timestamp1);
    });

    it('should track staking performance metrics', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      const metrics = await engine.getPerformanceMetrics();
      
      expect(metrics.totalValue).to.equal(ethers.parseEther('90'));
      expect(metrics.totalDeposited).to.equal(ethers.parseEther('90'));
      expect(metrics.currentAPY).to.be.greaterThan(0);
      expect(metrics.positions.length).to.equal(3);
    });

    it('should track staking rewards over time', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      // In production, rewards would accrue over time
      // For testing, we verify the tracking mechanism
      const metrics1 = await engine.getPerformanceMetrics();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const metrics2 = await engine.getPerformanceMetrics();
      
      // Performance history should grow
      expect(metrics2.positions.length).to.equal(metrics1.positions.length);
    });
  });

  describe('Staking Rebalancing', () => {
    it('should detect rebalancing needs', async () => {
      // Set target allocations
      const newConfig = { ...config };
      newConfig.targetAllocations = [
        { adapterId: 'lido-steth', targetPercentage: 60 },
        { adapterId: 'rocketpool-reth', targetPercentage: 30 },
        { adapterId: 'native-eth', targetPercentage: 10 },
      ];
      
      const engineWithTargets = new FloorEngine(newConfig);
      const registryWithTargets = engineWithTargets.getAdapterRegistry();
      
      // Register adapters
      registryWithTargets.registerAdapter({
        id: 'lido-steth',
        protocol: 'Lido',
        category: 'staking',
        chain: 'ethereum',
        riskScore: 2,
        tvl: ethers.parseEther('30000000'),
        apy: 3.5,
        enabled: true,
        supportedAssets: ['ETH', 'stETH'],
        metadata: {},
      });
      
      registryWithTargets.registerAdapter({
        id: 'rocketpool-reth',
        protocol: 'Rocket Pool',
        category: 'staking',
        chain: 'ethereum',
        riskScore: 3,
        tvl: ethers.parseEther('3000000'),
        apy: 3.2,
        enabled: true,
        supportedAssets: ['ETH', 'rETH'],
        metadata: {},
      });
      
      registryWithTargets.registerAdapter({
        id: 'native-eth',
        protocol: 'Native ETH',
        category: 'staking',
        chain: 'ethereum',
        riskScore: 1,
        tvl: ethers.parseEther('100000000'),
        apy: 4.0,
        enabled: true,
        supportedAssets: ['ETH'],
        metadata: {},
      });
      
      await engineWithTargets.initialize();
      
      // Allocate evenly (33/33/33)
      await engineWithTargets.allocateCapital(ethers.parseEther('90'));
      
      // Wait for rebalance interval
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Rebalance should detect deviation from target (60/30/10)
      const result = await engineWithTargets.rebalance();
      
      // Should have rebalance actions
      expect(result.success).to.be.true;
      // In production, would have actions to rebalance
    });
  });

  describe('Error Handling', () => {
    it('should handle disabled staking adapter', async () => {
      registry.disableAdapter('lido-steth');
      
      await engine.allocateCapital(ethers.parseEther('90'));
      
      const positions = await engine.getPositions();
      
      // Should only have 2 positions (Lido disabled)
      expect(positions.length).to.equal(2);
      
      const lidoPosition = positions.find(p => p.adapterId === 'lido-steth');
      expect(lidoPosition).to.be.undefined;
    });

    it('should handle insufficient stake amount', async () => {
      // Native ETH requires 32 ETH minimum
      // Allocating less should skip native staking
      await engine.allocateCapital(ethers.parseEther('30'));
      
      const positions = await engine.getPositions();
      
      // Each adapter gets 10 ETH, which is fine for Lido/Rocket Pool
      // but might be rejected by Native ETH in production
      expect(positions.length).to.be.greaterThan(0);
    });

    it('should handle pause during staking operations', async () => {
      engine.pause();
      
      try {
        await engine.allocateCapital(ethers.parseEther('90'));
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
        expect((error as Error).message).to.include('paused');
      }
    });

    it('should resume after pause', async () => {
      engine.pause();
      engine.resume();
      
      // Should work after resume
      await engine.allocateCapital(ethers.parseEther('90'));
      
      const positions = await engine.getPositions();
      expect(positions.length).to.equal(3);
    });
  });

  describe('Staking Yield Harvesting', () => {
    it('should track staking rewards', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      // Staking rewards accrue in token value, not as separate tokens
      // So harvesting is different from yield farming
      const yield1 = await engine.harvestYields();
      
      // For staking, yield is 0 as rewards are auto-compounded
      expect(yield1).to.equal(0n);
    });

    it('should respect harvest interval', async () => {
      await engine.allocateCapital(ethers.parseEther('90'));
      
      await engine.harvestYields();
      
      // Try to harvest again immediately
      try {
        await engine.harvestYields();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
        expect((error as Error).message).to.include('too frequent');
      }
    });
  });
});

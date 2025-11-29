/**
 * Lending Adapters Integration Tests
 * 
 * Comprehensive integration tests for all lending protocol adapters
 * with the Floor Engine orchestrator.
 * 
 * Tests:
 * - Aave V3 integration
 * - Compound V3 integration
 * - Morpho Blue integration
 * - Spark integration
 * - Multi-lending allocation
 * - Lending rebalancing
 * - Lending position tracking
 * 
 * @module tests/lending.integration
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { FloorEngine } from '../src/core/FloorEngine.v2';
import { AdapterRegistry } from '../src/core/AdapterRegistry';
import { FloorEngineConfig } from '../src/types';

describe('Lending Adapters Integration Tests', () => {
  let engine: FloorEngine;
  let registry: AdapterRegistry;
  let provider: ethers.Provider;
  let wallet: ethers.Wallet;

  // Test configuration
  const config: FloorEngineConfig = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    privateKey: process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    chainId: 1,
    networkName: 'mainnet',
    allocationStrategy: {
      lending: 100, // 100% to lending for these tests
      staking: 0,
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
    // Initialize Floor Engine
    engine = new FloorEngine(config);
    registry = engine.getAdapterRegistry();
    
    // Register lending adapters
    registry.registerAdapter({
      id: 'aave-v3-usdc',
      protocol: 'Aave V3',
      category: 'lending',
      chain: 'ethereum',
      riskScore: 2,
      tvl: ethers.parseEther('1000000'),
      apy: 5.5,
      enabled: true,
      supportedAssets: ['USDC', 'USDT', 'DAI'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'compound-v3-usdc',
      protocol: 'Compound V3',
      category: 'lending',
      chain: 'ethereum',
      riskScore: 2,
      tvl: ethers.parseEther('500000'),
      apy: 4.8,
      enabled: true,
      supportedAssets: ['USDC', 'USDT'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'morpho-blue-usdc',
      protocol: 'Morpho Blue',
      category: 'lending',
      chain: 'ethereum',
      riskScore: 3,
      tvl: ethers.parseEther('200000'),
      apy: 6.2,
      enabled: true,
      supportedAssets: ['USDC', 'USDT', 'DAI', 'WETH'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'spark-dai',
      protocol: 'Spark',
      category: 'lending',
      chain: 'ethereum',
      riskScore: 2,
      tvl: ethers.parseEther('300000'),
      apy: 5.0,
      enabled: true,
      supportedAssets: ['DAI', 'USDC', 'USDT'],
      metadata: {},
    });

    await engine.initialize();
  });

  describe('Aave V3 Integration', () => {
    it('should allocate capital to Aave V3', async () => {
      const amount = ethers.parseEther('10');
      
      // This would actually execute in production
      // For now, we're testing the orchestration logic
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      expect(positions.length).to.be.greaterThan(0);
      
      const aavePosition = positions.find(p => p.adapterId === 'aave-v3-usdc');
      expect(aavePosition).to.exist;
      expect(aavePosition!.value).to.be.greaterThan(0n);
    });

    it('should track Aave V3 position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const aavePosition = positions.find(p => p.adapterId === 'aave-v3-usdc');
      
      expect(aavePosition).to.exist;
      expect(aavePosition!.protocol).to.equal('Aave V3');
      expect(aavePosition!.category).to.equal('lending');
      expect(aavePosition!.apy).to.be.greaterThan(0);
    });

    it('should calculate APY for Aave V3 position', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const apy = await engine.getAPY();
      expect(apy).to.be.greaterThan(0);
      expect(apy).to.be.lessThan(20); // Reasonable APY range
    });
  });

  describe('Compound V3 Integration', () => {
    it('should allocate capital to Compound V3', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const compoundPosition = positions.find(p => p.adapterId === 'compound-v3-usdc');
      
      expect(compoundPosition).to.exist;
      expect(compoundPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Compound V3 position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const compoundPosition = positions.find(p => p.adapterId === 'compound-v3-usdc');
      
      expect(compoundPosition).to.exist;
      expect(compoundPosition!.protocol).to.equal('Compound V3');
      expect(compoundPosition!.category).to.equal('lending');
    });
  });

  describe('Morpho Blue Integration', () => {
    it('should allocate capital to Morpho Blue', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const morphoPosition = positions.find(p => p.adapterId === 'morpho-blue-usdc');
      
      expect(morphoPosition).to.exist;
      expect(morphoPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Morpho Blue position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const morphoPosition = positions.find(p => p.adapterId === 'morpho-blue-usdc');
      
      expect(morphoPosition).to.exist;
      expect(morphoPosition!.protocol).to.equal('Morpho Blue');
      expect(morphoPosition!.category).to.equal('lending');
    });
  });

  describe('Spark Integration', () => {
    it('should allocate capital to Spark', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const sparkPosition = positions.find(p => p.adapterId === 'spark-dai');
      
      expect(sparkPosition).to.exist;
      expect(sparkPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Spark position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const sparkPosition = positions.find(p => p.adapterId === 'spark-dai');
      
      expect(sparkPosition).to.exist;
      expect(sparkPosition!.protocol).to.equal('Spark');
      expect(sparkPosition!.category).to.equal('lending');
    });
  });

  describe('Multi-Lending Allocation', () => {
    it('should allocate capital across all lending adapters', async () => {
      const amount = ethers.parseEther('100');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      
      // Should have positions in all 4 lending adapters
      expect(positions.length).to.equal(4);
      
      // Each should have roughly equal allocation
      const expectedPerAdapter = amount / 4n;
      for (const position of positions) {
        expect(position.value).to.equal(expectedPerAdapter);
      }
    });

    it('should calculate total value correctly', async () => {
      const amount = ethers.parseEther('100');
      await engine.allocateCapital(amount);
      
      const totalValue = await engine.getTotalValue();
      expect(totalValue).to.equal(amount);
    });

    it('should calculate weighted average APY correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('100'));
      
      const apy = await engine.getAPY();
      
      // Weighted average should be between min and max adapter APYs
      expect(apy).to.be.greaterThan(4.5);
      expect(apy).to.be.lessThan(6.5);
    });
  });

  describe('Lending Position Tracking', () => {
    it('should update positions correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('100'));
      
      const positions1 = await engine.getPositions();
      const timestamp1 = positions1[0].lastUpdate;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update positions
      const positions2 = await engine.getPositions();
      const timestamp2 = positions2[0].lastUpdate;
      
      expect(timestamp2).to.be.greaterThan(timestamp1);
    });

    it('should track performance metrics', async () => {
      await engine.allocateCapital(ethers.parseEther('100'));
      
      const metrics = await engine.getPerformanceMetrics();
      
      expect(metrics.totalValue).to.equal(ethers.parseEther('100'));
      expect(metrics.totalDeposited).to.equal(ethers.parseEther('100'));
      expect(metrics.totalYield).to.equal(0n); // No yield yet
      expect(metrics.currentAPY).to.be.greaterThan(0);
      expect(metrics.positions.length).to.equal(4);
    });
  });

  describe('Error Handling', () => {
    it('should handle adapter failures gracefully', async () => {
      // Disable one adapter
      registry.disableAdapter('aave-v3-usdc');
      
      await engine.allocateCapital(ethers.parseEther('100'));
      
      const positions = await engine.getPositions();
      
      // Should only have 3 positions (Aave disabled)
      expect(positions.length).to.equal(3);
      
      // Should not have Aave position
      const aavePosition = positions.find(p => p.adapterId === 'aave-v3-usdc');
      expect(aavePosition).to.be.undefined;
    });

    it('should handle zero allocation', async () => {
      await engine.allocateCapital(0n);
      
      const positions = await engine.getPositions();
      expect(positions.length).to.equal(0);
      
      const totalValue = await engine.getTotalValue();
      expect(totalValue).to.equal(0n);
    });

    it('should handle pause state', async () => {
      engine.pause();
      
      try {
        await engine.allocateCapital(ethers.parseEther('100'));
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
        expect((error as Error).message).to.include('paused');
      }
    });
  });
});

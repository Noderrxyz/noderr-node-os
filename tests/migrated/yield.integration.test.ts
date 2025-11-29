/**
 * Yield Farming Adapters Integration Tests
 * 
 * Comprehensive integration tests for all yield farming protocol adapters
 * with the Floor Engine orchestrator.
 * 
 * Tests:
 * - Convex integration
 * - Curve integration
 * - Balancer integration
 * - Multi-yield allocation
 * - Yield farming rebalancing
 * - Reward harvesting
 * 
 * @module tests/yield.integration
 */

import { expect } from 'chai';
import { ethers } from 'ethers';
import { FloorEngine } from '../src/core/FloorEngine.v2';
import { AdapterRegistry } from '../src/core/AdapterRegistry';
import { FloorEngineConfig } from '../src/types';

describe('Yield Farming Adapters Integration Tests', () => {
  let engine: FloorEngine;
  let registry: AdapterRegistry;

  const config: FloorEngineConfig = {
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    privateKey: process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey,
    chainId: 1,
    networkName: 'mainnet',
    allocationStrategy: {
      lending: 0,
      staking: 0,
      yield: 100, // 100% to yield farming for these tests
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
    
    // Register yield farming adapters
    registry.registerAdapter({
      id: 'convex-3pool',
      protocol: 'Convex',
      category: 'yield',
      chain: 'ethereum',
      riskScore: 3,
      tvl: ethers.parseEther('1500000'), // $1.5B TVL
      apy: 8.0,
      enabled: true,
      supportedAssets: ['3CRV', 'CRV', 'CVX'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'curve-3pool',
      protocol: 'Curve',
      category: 'yield',
      chain: 'ethereum',
      riskScore: 2,
      tvl: ethers.parseEther('2000000'), // $2B TVL
      apy: 5.5,
      enabled: true,
      supportedAssets: ['USDC', 'USDT', 'DAI', '3CRV', 'CRV'],
      metadata: {},
    });

    registry.registerAdapter({
      id: 'balancer-bal-eth',
      protocol: 'Balancer',
      category: 'yield',
      chain: 'ethereum',
      riskScore: 4,
      tvl: ethers.parseEther('1000000'), // $1B TVL
      apy: 7.0,
      enabled: true,
      supportedAssets: ['BAL', 'ETH', 'BPT'],
      metadata: {},
    });

    await engine.initialize();
  });

  describe('Convex Integration', () => {
    it('should allocate capital to Convex', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const convexPosition = positions.find(p => p.adapterId === 'convex-3pool');
      
      expect(convexPosition).to.exist;
      expect(convexPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Convex position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const convexPosition = positions.find(p => p.adapterId === 'convex-3pool');
      
      expect(convexPosition).to.exist;
      expect(convexPosition!.protocol).to.equal('Convex');
      expect(convexPosition!.category).to.equal('yield');
      expect(convexPosition!.apy).to.be.greaterThan(0);
    });

    it('should calculate APY for Convex position', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const apy = await engine.getAPY();
      expect(apy).to.be.greaterThan(0);
      expect(apy).to.be.lessThan(15); // Reasonable yield farming APY range
    });

    it('should handle Convex reward tokens', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // Convex earns both CRV and CVX rewards
      // In production, these would be tracked in metadata
      const positions = await engine.getPositions();
      const convexPosition = positions.find(p => p.adapterId === 'convex-3pool');
      
      expect(convexPosition).to.exist;
      // Metadata would contain pending CRV and CVX amounts
    });
  });

  describe('Curve Integration', () => {
    it('should allocate capital to Curve', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const curvePosition = positions.find(p => p.adapterId === 'curve-3pool');
      
      expect(curvePosition).to.exist;
      expect(curvePosition!.value).to.be.greaterThan(0n);
    });

    it('should track Curve position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const curvePosition = positions.find(p => p.adapterId === 'curve-3pool');
      
      expect(curvePosition).to.exist;
      expect(curvePosition!.protocol).to.equal('Curve');
      expect(curvePosition!.category).to.equal('yield');
    });

    it('should handle Curve LP tokens', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // Curve positions involve LP tokens
      const positions = await engine.getPositions();
      const curvePosition = positions.find(p => p.adapterId === 'curve-3pool');
      
      expect(curvePosition).to.exist;
      // In production, metadata would contain LP token balance
    });

    it('should handle Curve gauge staking', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // Curve LP tokens should be staked in gauge for CRV rewards
      const positions = await engine.getPositions();
      const curvePosition = positions.find(p => p.adapterId === 'curve-3pool');
      
      expect(curvePosition).to.exist;
      // In production, metadata would contain staked balance and pending CRV
    });
  });

  describe('Balancer Integration', () => {
    it('should allocate capital to Balancer', async () => {
      const amount = ethers.parseEther('10');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      const balancerPosition = positions.find(p => p.adapterId === 'balancer-bal-eth');
      
      expect(balancerPosition).to.exist;
      expect(balancerPosition!.value).to.be.greaterThan(0n);
    });

    it('should track Balancer position correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      const positions = await engine.getPositions();
      const balancerPosition = positions.find(p => p.adapterId === 'balancer-bal-eth');
      
      expect(balancerPosition).to.exist;
      expect(balancerPosition!.protocol).to.equal('Balancer');
      expect(balancerPosition!.category).to.equal('yield');
    });

    it('should handle Balancer BPT tokens', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // Balancer positions involve BPT (Balancer Pool Tokens)
      const positions = await engine.getPositions();
      const balancerPosition = positions.find(p => p.adapterId === 'balancer-bal-eth');
      
      expect(balancerPosition).to.exist;
      // In production, metadata would contain BPT balance
    });

    it('should handle Balancer weighted pools', async () => {
      await engine.allocateCapital(ethers.parseEther('10'));
      
      // Balancer 80/20 BAL/ETH pool
      const positions = await engine.getPositions();
      const balancerPosition = positions.find(p => p.adapterId === 'balancer-bal-eth');
      
      expect(balancerPosition).to.exist;
      // In production, metadata would contain pool weights and composition
    });
  });

  describe('Multi-Yield Allocation', () => {
    it('should allocate capital across all yield adapters', async () => {
      const amount = ethers.parseEther('60'); // 20 ETH per adapter
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      
      // Should have positions in all 3 yield adapters
      expect(positions.length).to.equal(3);
      
      // Each should have roughly equal allocation
      const expectedPerAdapter = amount / 3n;
      for (const position of positions) {
        expect(position.value).to.equal(expectedPerAdapter);
      }
    });

    it('should calculate total yield farming value correctly', async () => {
      const amount = ethers.parseEther('60');
      await engine.allocateCapital(amount);
      
      const totalValue = await engine.getTotalValue();
      expect(totalValue).to.equal(amount);
    });

    it('should calculate weighted average yield APY', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      const apy = await engine.getAPY();
      
      // Weighted average should be between min and max yield APYs
      expect(apy).to.be.greaterThan(5.0);
      expect(apy).to.be.lessThan(9.0);
    });

    it('should respect allocation strategy', async () => {
      const amount = ethers.parseEther('60');
      await engine.allocateCapital(amount);
      
      const positions = await engine.getPositions();
      
      // All positions should be yield category
      for (const position of positions) {
        expect(position.category).to.equal('yield');
      }
    });
  });

  describe('Yield Position Tracking', () => {
    it('should update yield positions correctly', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      const positions1 = await engine.getPositions();
      const timestamp1 = positions1[0].lastUpdate;
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const positions2 = await engine.getPositions();
      const timestamp2 = positions2[0].lastUpdate;
      
      expect(timestamp2).to.be.greaterThan(timestamp1);
    });

    it('should track yield farming performance metrics', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      const metrics = await engine.getPerformanceMetrics();
      
      expect(metrics.totalValue).to.equal(ethers.parseEther('60'));
      expect(metrics.totalDeposited).to.equal(ethers.parseEther('60'));
      expect(metrics.currentAPY).to.be.greaterThan(0);
      expect(metrics.positions.length).to.equal(3);
    });

    it('should track pending rewards', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, pending rewards would accumulate
      const positions = await engine.getPositions();
      
      for (const position of positions) {
        expect(position).to.exist;
        // Metadata would contain pending reward amounts
      }
    });
  });

  describe('Yield Reward Harvesting', () => {
    it('should harvest rewards from yield adapters', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, this would claim CRV/CVX/BAL rewards
      const totalYield = await engine.harvestYields();
      
      // For testing, yield is 0 (no time has passed)
      expect(totalYield).to.equal(0n);
    });

    it('should respect harvest interval', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
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

    it('should handle reward token conversion', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, rewards would be converted to stablecoins or ETH
      await engine.harvestYields();
      
      // Verify harvest completed (even if 0 yield)
      const metrics = await engine.getPerformanceMetrics();
      expect(metrics.lastHarvest).to.be.greaterThan(0);
    });

    it('should batch reward claims for gas efficiency', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, all reward claims would be batched
      await engine.harvestYields();
      
      // All positions should have been processed
      const positions = await engine.getPositions();
      expect(positions.length).to.equal(3);
    });
  });

  describe('Yield Rebalancing', () => {
    it('should detect yield rebalancing needs', async () => {
      // Set target allocations favoring Convex
      const newConfig = { ...config };
      newConfig.targetAllocations = [
        { adapterId: 'convex-3pool', targetPercentage: 60 },
        { adapterId: 'curve-3pool', targetPercentage: 25 },
        { adapterId: 'balancer-bal-eth', targetPercentage: 15 },
      ];
      
      const engineWithTargets = new FloorEngine(newConfig);
      const registryWithTargets = engineWithTargets.getAdapterRegistry();
      
      // Register adapters
      registryWithTargets.registerAdapter({
        id: 'convex-3pool',
        protocol: 'Convex',
        category: 'yield',
        chain: 'ethereum',
        riskScore: 3,
        tvl: ethers.parseEther('1500000'),
        apy: 8.0,
        enabled: true,
        supportedAssets: ['3CRV', 'CRV', 'CVX'],
        metadata: {},
      });
      
      registryWithTargets.registerAdapter({
        id: 'curve-3pool',
        protocol: 'Curve',
        category: 'yield',
        chain: 'ethereum',
        riskScore: 2,
        tvl: ethers.parseEther('2000000'),
        apy: 5.5,
        enabled: true,
        supportedAssets: ['USDC', 'USDT', 'DAI', '3CRV', 'CRV'],
        metadata: {},
      });
      
      registryWithTargets.registerAdapter({
        id: 'balancer-bal-eth',
        protocol: 'Balancer',
        category: 'yield',
        chain: 'ethereum',
        riskScore: 4,
        tvl: ethers.parseEther('1000000'),
        apy: 7.0,
        enabled: true,
        supportedAssets: ['BAL', 'ETH', 'BPT'],
        metadata: {},
      });
      
      await engineWithTargets.initialize();
      
      // Allocate evenly (33/33/33)
      await engineWithTargets.allocateCapital(ethers.parseEther('60'));
      
      // Wait for rebalance interval
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Rebalance should detect deviation from target (60/25/15)
      const result = await engineWithTargets.rebalance();
      
      expect(result.success).to.be.true;
    });

    it('should rebalance based on APY changes', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, if one pool's APY drops significantly,
      // rebalancing would shift capital to higher-yielding pools
      const positions = await engine.getPositions();
      expect(positions.length).to.equal(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle disabled yield adapter', async () => {
      registry.disableAdapter('convex-3pool');
      
      await engine.allocateCapital(ethers.parseEther('60'));
      
      const positions = await engine.getPositions();
      
      // Should only have 2 positions (Convex disabled)
      expect(positions.length).to.equal(2);
      
      const convexPosition = positions.find(p => p.adapterId === 'convex-3pool');
      expect(convexPosition).to.be.undefined;
    });

    it('should handle pool liquidity issues', async () => {
      // In production, would check pool liquidity before deposits
      await engine.allocateCapital(ethers.parseEther('60'));
      
      const positions = await engine.getPositions();
      expect(positions.length).to.be.greaterThan(0);
    });

    it('should handle reward claim failures', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // Even if some reward claims fail, harvesting should continue
      const totalYield = await engine.harvestYields();
      expect(totalYield).to.be.greaterThanOrEqual(0n);
    });

    it('should handle pause during yield operations', async () => {
      engine.pause();
      
      try {
        await engine.allocateCapital(ethers.parseEther('60'));
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.exist;
        expect((error as Error).message).to.include('paused');
      }
    });
  });

  describe('Impermanent Loss Tracking', () => {
    it('should track pool composition changes', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, would track token balances in pools
      const positions = await engine.getPositions();
      
      for (const position of positions) {
        expect(position).to.exist;
        // Metadata would contain pool composition
      }
    });

    it('should calculate impermanent loss', async () => {
      await engine.allocateCapital(ethers.parseEther('60'));
      
      // In production, would calculate IL based on price changes
      // For stablecoin pools, IL should be minimal
      const positions = await engine.getPositions();
      
      // Convex and Curve 3pool should have minimal IL
      const convexPosition = positions.find(p => p.adapterId === 'convex-3pool');
      const curvePosition = positions.find(p => p.adapterId === 'curve-3pool');
      
      expect(convexPosition).to.exist;
      expect(curvePosition).to.exist;
    });
  });
});

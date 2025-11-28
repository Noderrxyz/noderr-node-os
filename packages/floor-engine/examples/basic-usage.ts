/**
 * Floor Engine - Basic Usage Example
 * 
 * This example demonstrates how to initialize and use the Floor Engine
 * for low-risk yield generation.
 */

import { ethers } from 'ethers';
import { FloorEngine, FloorEngineConfig } from '../src';

async function main() {
  // Configuration
  const config: FloorEngineConfig = {
    // Blockchain configuration
    rpcUrl: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
    chainId: 1,
    networkName: 'ethereum',

    // Wallet configuration
    privateKey: process.env.PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000000',

    // Contract addresses
    treasuryManagerAddress: process.env.TREASURY_MANAGER_ADDRESS || '0x0000000000000000000000000000000000000000',

    // Allocation strategy
    allocationStrategy: {
      lending: 50,  // 50% to lending protocols
      staking: 30,  // 30% to liquid staking
      yield: 20,    // 20% to yield farming
    },

    // Target allocations per adapter
    targetAllocations: [
      { adapterId: 'aave-v3-eth', targetPercentage: 25, minPercentage: 20, maxPercentage: 30 },
      { adapterId: 'compound-v3-eth', targetPercentage: 15, minPercentage: 10, maxPercentage: 20 },
      { adapterId: 'morpho-blue-eth', targetPercentage: 10, minPercentage: 5, maxPercentage: 15 },
      { adapterId: 'lido-steth', targetPercentage: 20, minPercentage: 15, maxPercentage: 25 },
      { adapterId: 'rocket-pool-reth', targetPercentage: 10, minPercentage: 5, maxPercentage: 15 },
      { adapterId: 'curve-3pool', targetPercentage: 10, minPercentage: 5, maxPercentage: 15 },
      { adapterId: 'convex-3pool', targetPercentage: 5, minPercentage: 0, maxPercentage: 10 },
      { adapterId: 'balancer-boosted', targetPercentage: 5, minPercentage: 0, maxPercentage: 10 },
    ],

    // Risk parameters
    riskParameters: {
      maxAllocationPerAdapter: ethers.parseEther('1000'),  // Max 1000 ETH per adapter
      maxAllocationPerProtocol: ethers.parseEther('2000'), // Max 2000 ETH per protocol
      maxAllocationPerChain: ethers.parseEther('3000'),    // Max 3000 ETH per chain
      maxSlippageBps: 50,                                  // Max 0.5% slippage
      maxDrawdownBps: 500,                                 // Max 5% drawdown
      allowedTokens: [],                                   // Empty = all tokens allowed
      allowedProtocols: [],                                // Empty = all protocols allowed
      emergencyPauseEnabled: true,                         // Auto-pause on drawdown
    },

    // Rebalancing configuration
    rebalanceThresholdBps: 500,      // 5% deviation triggers rebalance
    minRebalanceInterval: 3600,      // 1 hour minimum between rebalances
    autoRebalanceEnabled: true,

    // Harvesting configuration
    autoHarvestEnabled: true,
    minHarvestInterval: 86400,       // 24 hours minimum between harvests
    minHarvestAmount: ethers.parseEther('0.1'), // 0.1 ETH minimum to trigger harvest

    // Logging configuration
    logLevel: 'info',
    logFile: './logs/floor-engine.log',
  };

  // Initialize Floor Engine
  console.log('=== Initializing Floor Engine ===');
  const engine = new FloorEngine(config);

  // Listen to events
  engine.on('initialized', () => {
    console.log('✅ Floor Engine initialized');
  });

  engine.on('capital_allocated', (event) => {
    console.log(`💰 Capital allocated: ${ethers.formatEther(event.amount)} ETH to ${event.adapterId || 'multiple adapters'}`);
  });

  engine.on('rebalance_completed', (event) => {
    console.log(`⚖️ Rebalance completed: ${event.actions.length} actions`);
  });

  engine.on('harvest_completed', (event) => {
    console.log(`🌾 Harvest completed: ${ethers.formatEther(event.totalYield)} ETH`);
  });

  engine.on('emergency_pause', (event) => {
    console.error(`🚨 EMERGENCY PAUSE: ${event.reason}`);
  });

  await engine.initialize();

  // Get adapter registry and risk manager
  const adapterRegistry = engine.getAdapterRegistry();
  const riskManager = engine.getRiskManager();

  console.log('\n=== Adapter Registry Statistics ===');
  const stats = adapterRegistry.getStatistics();
  console.log(`Total adapters: ${stats.totalAdapters}`);
  console.log(`Enabled adapters: ${stats.enabledAdapters}`);
  console.log(`By category:`, stats.byCategory);

  // Allocate capital
  console.log('\n=== Allocating Capital ===');
  const capitalToAllocate = ethers.parseEther('10000'); // 10,000 ETH
  await engine.allocateCapital(capitalToAllocate);

  // Get positions
  console.log('\n=== Current Positions ===');
  const positions = await engine.getPositions();
  for (const position of positions) {
    console.log(`${position.adapterId}:`);
    console.log(`  Protocol: ${position.protocol}`);
    console.log(`  Category: ${position.category}`);
    console.log(`  Value: ${ethers.formatEther(position.value)} ETH`);
    console.log(`  APY: ${position.apy.toFixed(2)}%`);
  }

  // Get performance metrics
  console.log('\n=== Performance Metrics ===');
  const metrics = await engine.getPerformanceMetrics();
  console.log(`Total Value: ${ethers.formatEther(metrics.totalValue)} ETH`);
  console.log(`Total Deposited: ${ethers.formatEther(metrics.totalDeposited)} ETH`);
  console.log(`Total Yield: ${ethers.formatEther(metrics.totalYield)} ETH`);
  console.log(`Current APY: ${metrics.currentAPY.toFixed(2)}%`);
  console.log(`Average APY (30d): ${metrics.averageAPY.toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
  console.log(`Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%`);

  // Get risk metrics
  console.log('\n=== Risk Metrics ===');
  const riskMetrics = riskManager.calculateRiskMetrics(positions, metrics.totalDeposited);
  console.log(`Total Exposure: ${ethers.formatEther(riskMetrics.totalExposure)} ETH`);
  console.log(`Current Drawdown: ${riskMetrics.currentDrawdown.toFixed(2)}%`);
  console.log(`Volatility: ${riskMetrics.volatility.toFixed(2)}%`);
  console.log('Exposure by Protocol:');
  for (const [protocol, exposure] of Object.entries(riskMetrics.exposureByProtocol)) {
    console.log(`  ${protocol}: ${ethers.formatEther(exposure)} ETH`);
  }

  // Rebalance
  console.log('\n=== Rebalancing ===');
  const rebalanceResult = await engine.rebalance();
  if (rebalanceResult.success) {
    console.log(`✅ Rebalance successful: ${rebalanceResult.actions.length} actions`);
    for (const action of rebalanceResult.actions) {
      console.log(`  ${action.action} ${ethers.formatEther(action.amount)} ETH ${action.action === 'deposit' ? 'to' : 'from'} ${action.adapterId}`);
      console.log(`    Reason: ${action.reason}`);
    }
  } else {
    console.error(`❌ Rebalance failed: ${rebalanceResult.error}`);
  }

  // Harvest yields
  console.log('\n=== Harvesting Yields ===');
  const totalYield = await engine.harvestYields();
  console.log(`✅ Harvested ${ethers.formatEther(totalYield)} ETH`);

  console.log('\n=== Floor Engine Example Complete ===');
}

// Run example
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

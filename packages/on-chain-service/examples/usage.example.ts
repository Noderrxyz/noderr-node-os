import { createOnChainService, RewardEntry } from '../src';
import { ethers } from 'ethers';

/**
 * Example usage of the On-Chain Interaction Service
 */
async function main() {
  // Create service instance (loads config from .env)
  const service = createOnChainService();

  // Check service health
  const health = await service.getHealth();
  console.log('Service Health:', health);

  if (!health.isHealthy) {
    console.error('Service is not healthy!');
    return;
  }

  // ============================================================================
  // CAPITAL MANAGEMENT EXAMPLES
  // ============================================================================

  console.log('\n=== Capital Management ===\n');

  // Example 1: Request capital for a trading strategy
  const capitalRequest = await service.capitalManager.requestCapital({
    amount: ethers.parseEther('100'), // 100 ETH
    strategyId: 'momentum-strategy-001',
    token: ethers.ZeroAddress, // ETH (use token address for ERC20)
    reason: 'Deploy capital for momentum trading strategy',
  });

  if (capitalRequest.success) {
    console.log('Capital requested successfully!');
    console.log('Transaction hash:', capitalRequest.transactionHash);
  } else {
    console.error('Capital request failed:', capitalRequest.error);
  }

  // Example 2: Deposit profits back to treasury
  const profitDeposit = await service.capitalManager.depositProfit(
    ethers.parseEther('110'), // 110 ETH (100 principal + 10 profit)
    'momentum-strategy-001',
    ethers.ZeroAddress, // ETH
    ethers.parseEther('10') // 10 ETH profit
  );

  if (profitDeposit.success) {
    console.log('Profit deposited successfully!');
    console.log('Transaction hash:', profitDeposit.transactionHash);
  }

  // Example 3: Report strategy performance
  const performanceReport = await service.capitalManager.reportPerformance({
    strategyId: 'momentum-strategy-001',
    pnl: ethers.parseEther('10'), // 10 ETH profit
    sharpeRatio: 250, // 2.50 Sharpe ratio (multiplied by 100)
    maxDrawdown: 800, // 8% max drawdown
    winRate: 6500, // 65% win rate
    totalTrades: 150,
  });

  if (performanceReport.success) {
    console.log('Performance reported successfully!');
  }

  // Example 4: Query capital status
  const outstandingCapital = await service.capitalManager.getOutstandingCapital();
  const dailyWithdrawn = await service.capitalManager.getDailyWithdrawn();
  console.log('Outstanding capital:', ethers.formatEther(outstandingCapital), 'ETH');
  console.log('Daily withdrawn:', ethers.formatEther(dailyWithdrawn), 'ETH');

  // ============================================================================
  // REWARD DISTRIBUTION EXAMPLES
  // ============================================================================

  console.log('\n=== Reward Distribution ===\n');

  // Example 1: Create reward distribution for Strategy Marketplace contributors
  const rewards: RewardEntry[] = [
    { address: '0x1234...', amount: ethers.parseEther('100') },
    { address: '0x5678...', amount: ethers.parseEther('50') },
    { address: '0x9abc...', amount: ethers.parseEther('25') },
    // ... potentially thousands more
  ];

  const epochCreation = await service.rewardDistributor.createEpoch(
    rewards,
    'Q4 2024 Strategy Marketplace Rewards',
    30 * 24 * 60 * 60 // 30 days duration (0 for no expiry)
  );

  if (epochCreation.success && epochCreation.epochId !== undefined) {
    console.log('Reward epoch created!');
    console.log('Epoch ID:', epochCreation.epochId);
    console.log('Transaction hash:', epochCreation.transactionHash);

    // Example 2: Generate proof for a specific recipient
    const proof = service.rewardDistributor.getProof(
      epochCreation.epochId,
      '0x1234...',
      ethers.parseEther('100')
    );

    if (proof) {
      console.log('Merkle proof generated:', proof.proof);

      // Example 3: Verify proof on-chain
      const isValid = await service.rewardDistributor.verifyProof(
        epochCreation.epochId,
        '0x1234...',
        ethers.parseEther('100'),
        proof.proof
      );
      console.log('Proof is valid:', isValid);
    }

    // Example 4: Claim rewards for a recipient (gas sponsorship)
    if (proof) {
      const claim = await service.rewardDistributor.claimFor(
        epochCreation.epochId,
        '0x1234...',
        ethers.parseEther('100'),
        proof.proof
      );

      if (claim.success) {
        console.log('Rewards claimed successfully!');
      }
    }

    // Example 5: Get epoch statistics
    const stats = await service.rewardDistributor.getEpochStats(epochCreation.epochId);
    console.log('Epoch stats:', {
      totalAmount: ethers.formatEther(stats.totalAmount),
      claimedAmount: ethers.formatEther(stats.claimedAmount),
      claimCount: stats.claimCount.toString(),
      active: stats.active,
    });
  }

  // ============================================================================
  // TRUST SCORE UPDATE EXAMPLES
  // ============================================================================

  console.log('\n=== Trust Score Updates ===\n');

  // Example 1: Update single node's TrustFingerprint score
  const scoreUpdate = await service.trustUpdater.updateScore(
    '0xnode1...',
    {
      uptime: 9500,      // 95% uptime
      quality: 8800,     // 88% quality
      governance: 7200,  // 72% governance participation
      history: 8500,     // 85% historical performance
      peer: 9000,        // 90% peer reputation
      stake: 7500,       // 75% stake weight
    }
  );

  if (scoreUpdate.success) {
    console.log('Trust score updated successfully!');
  }

  // Example 2: Batch update multiple nodes
  const batchUpdate = await service.trustUpdater.batchUpdateScores([
    {
      operator: '0xnode1...',
      components: {
        uptime: 9500,
        quality: 8800,
        governance: 7200,
        history: 8500,
        peer: 9000,
        stake: 7500,
      },
    },
    {
      operator: '0xnode2...',
      components: {
        uptime: 8700,
        quality: 9200,
        governance: 8000,
        history: 8800,
        peer: 8500,
        stake: 9000,
      },
    },
    // ... more nodes
  ]);

  if (batchUpdate.success) {
    console.log('Batch trust score update successful!');
    console.log('Gas used:', batchUpdate.gasUsed?.toString());
  }

  // Example 3: Query current trust score
  const currentScore = await service.trustUpdater.getScore('0xnode1...');
  console.log('Current trust score:', currentScore / 100, '%');

  // Example 4: Get score components
  const components = await service.trustUpdater.getScoreComponents('0xnode1...');
  console.log('Score components:', {
    uptime: components.uptime / 100 + '%',
    quality: components.quality / 100 + '%',
    governance: components.governance / 100 + '%',
    history: components.history / 100 + '%',
    peer: components.peer / 100 + '%',
    stake: components.stake / 100 + '%',
  });

  // ============================================================================
  // ADMIN FUNCTIONS
  // ============================================================================

  console.log('\n=== Admin Functions ===\n');

  // Reset rate limiter (if needed)
  service.resetRateLimiter();
  console.log('Rate limiter reset');

  // Reset circuit breaker (after resolving issues)
  service.resetCircuitBreaker();
  console.log('Circuit breaker reset');

  // Manually trip circuit breaker (emergency)
  // service.tripCircuitBreaker('Manual emergency stop');
}

// Run examples
main().catch(console.error);

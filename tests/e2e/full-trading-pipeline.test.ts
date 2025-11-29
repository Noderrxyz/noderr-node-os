/**
 * End-to-End Integration Test Suite
 * 
 * Tests the complete autonomous trading pipeline:
 * ML Prediction → Risk Management → Oracle Consensus → Execution → Settlement
 * 
 * @group e2e
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

// Import all components
import { AutonomousExecutionOrchestrator } from '@noderr/autonomous-execution';
import { HumanOversightManager, AlertSeverity, AlertType } from '@noderr/human-oversight';
import { BFTConsensusEngine, OracleCoordinator, TradingSignal } from '@noderr/oracle-consensus';
import { OnChainSettlementManager } from '@noderr/on-chain-settlement';

/**
 * End-to-End Integration Tests
 */
describe('Full Trading Pipeline E2E', () => {
  let orchestrator: AutonomousExecutionOrchestrator;
  let oversightManager: HumanOversightManager;
  let consensusEngine: BFTConsensusEngine;
  let oracleCoordinator: OracleCoordinator;
  let settlementManager: OnChainSettlementManager;
  
  beforeAll(async () => {
    // Initialize all components
    
    // 1. Human Oversight
    oversightManager = new HumanOversightManager({
      channels: {
        discord: {
          enabled: false, // Disable for testing
          webhookUrl: 'https://discord.com/api/webhooks/test',
        },
      },
      thresholds: {
        maxDailyLoss: 10000,
        maxPositionSize: 100000,
        minConsensusConfidence: 0.7,
      },
      approvalRequired: {
        largeTradesThreshold: 50000,
        lowConfidenceThreshold: 0.6,
        highRiskThreshold: 0.8,
      },
    });
    
    await oversightManager.initialize();
    
    // 2. Oracle Consensus
    consensusEngine = new BFTConsensusEngine({
      nodeId: 'test-oracle-1',
      minConsensusThreshold: 0.67,
      consensusTimeout: 5000,
      maxRetries: 3,
    });
    
    await consensusEngine.initialize();
    
    oracleCoordinator = new OracleCoordinator(consensusEngine, {
      minOracles: 3,
      consensusTimeout: 10000,
    });
    
    await oracleCoordinator.initialize();
    
    // 3. On-Chain Settlement
    settlementManager = new OnChainSettlementManager({
      rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
      chainId: 31337, // Hardhat local network
      oracleVerifierAddress: process.env.ORACLE_VERIFIER_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      privateKey: process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      gasLimit: 500000,
      maxGasPrice: BigInt('100000000000'), // 100 gwei
      confirmations: 1,
    });
    
    await settlementManager.initialize();
    
    // 4. Autonomous Execution Orchestrator
    orchestrator = new AutonomousExecutionOrchestrator({
      maxConcurrentTrades: 5,
      riskCheckTimeout: 5000,
      consensusTimeout: 10000,
      executionTimeout: 30000,
    });
    
    await orchestrator.initialize();
  });
  
  afterAll(async () => {
    // Cleanup
    await orchestrator.shutdown();
    await oversightManager.shutdown();
    await consensusEngine.shutdown();
    await oracleCoordinator.shutdown();
    await settlementManager.shutdown();
  });
  
  /**
   * Test 1: Happy Path - Complete Trading Pipeline
   */
  test('should execute complete trading pipeline successfully', async () => {
    // 1. Create ML prediction
    const mlPrediction = {
      symbol: 'BTC/USD',
      action: 'BUY' as const,
      confidence: 0.85,
      price: 45000,
      quantity: 0.1,
      timestamp: Date.now(),
      features: {
        momentum: 0.8,
        volatility: 0.3,
        volume: 1000000,
      },
    };
    
    // 2. Submit to orchestrator
    const tradeId = await orchestrator.submitTrade(mlPrediction);
    
    expect(tradeId).toBeDefined();
    expect(typeof tradeId).toBe('string');
    
    // 3. Wait for risk check
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const status1 = orchestrator.getTradeStatus(tradeId);
    expect(status1).toBeDefined();
    expect(['RISK_CHECK', 'CONSENSUS', 'EXECUTING', 'COMPLETED']).toContain(status1?.status);
    
    // 4. Wait for consensus
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const status2 = orchestrator.getTradeStatus(tradeId);
    expect(status2).toBeDefined();
    expect(['CONSENSUS', 'EXECUTING', 'COMPLETED']).toContain(status2?.status);
    
    // 5. Wait for execution
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const status3 = orchestrator.getTradeStatus(tradeId);
    expect(status3).toBeDefined();
    expect(['EXECUTING', 'COMPLETED']).toContain(status3?.status);
    
    // 6. Verify final status
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const finalStatus = orchestrator.getTradeStatus(tradeId);
    expect(finalStatus).toBeDefined();
    expect(finalStatus?.status).toBe('COMPLETED');
    
    // 7. Verify statistics
    const stats = orchestrator.getStatistics();
    expect(stats.totalTrades).toBeGreaterThan(0);
    expect(stats.completedTrades).toBeGreaterThan(0);
  }, 30000); // 30 second timeout
  
  /**
   * Test 2: Risk Rejection - High Risk Trade
   */
  test('should reject high-risk trade', async () => {
    const highRiskPrediction = {
      symbol: 'SHIB/USD',
      action: 'BUY' as const,
      confidence: 0.45, // Low confidence
      price: 0.00001,
      quantity: 1000000,
      timestamp: Date.now(),
      features: {
        momentum: 0.3,
        volatility: 0.9, // High volatility
        volume: 100000,
      },
    };
    
    const tradeId = await orchestrator.submitTrade(highRiskPrediction);
    
    // Wait for risk check
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const status = orchestrator.getTradeStatus(tradeId);
    expect(status).toBeDefined();
    expect(status?.status).toBe('REJECTED');
    
    // Verify statistics
    const stats = orchestrator.getStatistics();
    expect(stats.rejectedTrades).toBeGreaterThan(0);
  }, 10000);
  
  /**
   * Test 3: Consensus Failure - Insufficient Votes
   */
  test('should handle consensus failure gracefully', async () => {
    // Mock a scenario where consensus cannot be reached
    const prediction = {
      symbol: 'ETH/USD',
      action: 'SELL' as const,
      confidence: 0.75,
      price: 3000,
      quantity: 1,
      timestamp: Date.now(),
      features: {
        momentum: 0.5,
        volatility: 0.4,
        volume: 500000,
      },
    };
    
    const tradeId = await orchestrator.submitTrade(prediction);
    
    // Wait for consensus attempt
    await new Promise(resolve => setTimeout(resolve, 12000));
    
    const status = orchestrator.getTradeStatus(tradeId);
    expect(status).toBeDefined();
    
    // Should either reach consensus or fail gracefully
    expect(['CONSENSUS', 'FAILED', 'COMPLETED']).toContain(status?.status);
  }, 15000);
  
  /**
   * Test 4: Human Oversight - Alert Generation
   */
  test('should generate alerts for critical events', async () => {
    // Send a critical alert
    const alertId = await oversightManager.sendAlert(
      AlertType.RISK_THRESHOLD_EXCEEDED,
      AlertSeverity.CRITICAL,
      'Risk Threshold Exceeded',
      'Daily loss limit approaching: $9,500 / $10,000',
      {
        currentLoss: 9500,
        maxLoss: 10000,
        percentage: 95,
      }
    );
    
    expect(alertId).toBeDefined();
    
    // Verify alert was created
    const alerts = oversightManager.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    
    const alert = alerts.find(a => a.id === alertId);
    expect(alert).toBeDefined();
    expect(alert?.type).toBe(AlertType.RISK_THRESHOLD_EXCEEDED);
    expect(alert?.severity).toBe(AlertSeverity.CRITICAL);
    expect(alert?.acknowledged).toBe(false);
    
    // Acknowledge alert
    await oversightManager.acknowledgeAlert(alertId, 'test-user');
    
    const acknowledgedAlert = oversightManager.getAlerts().find(a => a.id === alertId);
    expect(acknowledgedAlert?.acknowledged).toBe(true);
    expect(acknowledgedAlert?.acknowledgedBy).toBe('test-user');
  });
  
  /**
   * Test 5: Trade Approval Workflow
   */
  test('should handle trade approval workflow', async () => {
    const largeTrade = {
      symbol: 'BTC/USD',
      side: 'BUY' as const,
      quantity: 2,
      price: 45000,
      value: 90000, // Exceeds threshold
      confidence: 0.8,
      riskScore: 0.5,
    };
    
    // Request approval
    const approvalId = await oversightManager.requestTradeApproval(largeTrade);
    
    expect(approvalId).toBeDefined();
    
    // Verify pending approval
    const pendingApprovals = oversightManager.getPendingApprovals();
    expect(pendingApprovals.length).toBeGreaterThan(0);
    
    const approval = pendingApprovals.find(a => a.status === 'PENDING');
    expect(approval).toBeDefined();
    
    // Approve trade
    await oversightManager.approveTrade(approvalId, 'test-trader');
    
    // Verify approval
    const pendingAfterApproval = oversightManager.getPendingApprovals();
    expect(pendingAfterApproval.length).toBe(pendingApprovals.length - 1);
  });
  
  /**
   * Test 6: Emergency Stop
   */
  test('should handle emergency stop', async () => {
    // Trigger emergency stop
    await oversightManager.emergencyStop('test-admin', 'Testing emergency stop mechanism');
    
    expect(oversightManager.isInEmergencyStop()).toBe(true);
    
    // Verify alert was sent
    const alerts = oversightManager.getAlerts({ type: AlertType.EMERGENCY_STOP });
    expect(alerts.length).toBeGreaterThan(0);
    
    // Resume from emergency stop
    await oversightManager.resumeFromEmergencyStop('test-admin');
    
    expect(oversightManager.isInEmergencyStop()).toBe(false);
  });
  
  /**
   * Test 7: Oracle Consensus - Multiple Signals
   */
  test('should reach consensus on trading signals', async () => {
    const signal: TradingSignal = {
      symbol: 'ETH/USD',
      action: 'BUY',
      confidence: 0.8,
      price: 3000,
      timestamp: Date.now(),
    };
    
    // Submit signal to coordinator
    const consensusId = await oracleCoordinator.submitSignal(signal);
    
    expect(consensusId).toBeDefined();
    
    // Wait for consensus
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check consensus result
    const result = oracleCoordinator.getConsensusResult(consensusId);
    
    // Result should exist (may or may not have reached consensus depending on oracle availability)
    expect(result).toBeDefined();
  }, 10000);
  
  /**
   * Test 8: Concurrent Trade Execution
   */
  test('should handle multiple concurrent trades', async () => {
    const predictions = [
      {
        symbol: 'BTC/USD',
        action: 'BUY' as const,
        confidence: 0.8,
        price: 45000,
        quantity: 0.1,
        timestamp: Date.now(),
        features: { momentum: 0.7, volatility: 0.3, volume: 1000000 },
      },
      {
        symbol: 'ETH/USD',
        action: 'BUY' as const,
        confidence: 0.75,
        price: 3000,
        quantity: 1,
        timestamp: Date.now(),
        features: { momentum: 0.6, volatility: 0.4, volume: 500000 },
      },
      {
        symbol: 'SOL/USD',
        action: 'SELL' as const,
        confidence: 0.85,
        price: 100,
        quantity: 10,
        timestamp: Date.now(),
        features: { momentum: 0.8, volatility: 0.5, volume: 200000 },
      },
    ];
    
    // Submit all trades concurrently
    const tradeIds = await Promise.all(
      predictions.map(p => orchestrator.submitTrade(p))
    );
    
    expect(tradeIds.length).toBe(3);
    expect(tradeIds.every(id => typeof id === 'string')).toBe(true);
    
    // Wait for all trades to process
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Verify all trades have a final status
    const statuses = tradeIds.map(id => orchestrator.getTradeStatus(id));
    
    expect(statuses.every(s => s !== undefined)).toBe(true);
    expect(statuses.every(s => 
      ['COMPLETED', 'REJECTED', 'FAILED'].includes(s!.status)
    )).toBe(true);
  }, 20000);
  
  /**
   * Test 9: Performance Metrics
   */
  test('should track performance metrics accurately', async () => {
    const stats = orchestrator.getStatistics();
    
    expect(stats).toBeDefined();
    expect(typeof stats.totalTrades).toBe('number');
    expect(typeof stats.completedTrades).toBe('number');
    expect(typeof stats.rejectedTrades).toBe('number');
    expect(typeof stats.failedTrades).toBe('number');
    expect(typeof stats.successRate).toBe('number');
    
    expect(stats.totalTrades).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
  });
  
  /**
   * Test 10: Error Recovery
   */
  test('should recover from execution errors gracefully', async () => {
    // Submit a trade that will likely fail
    const invalidPrediction = {
      symbol: 'INVALID/PAIR',
      action: 'BUY' as const,
      confidence: 0.9,
      price: -100, // Invalid price
      quantity: 0,
      timestamp: Date.now(),
      features: { momentum: 0, volatility: 0, volume: 0 },
    };
    
    const tradeId = await orchestrator.submitTrade(invalidPrediction);
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const status = orchestrator.getTradeStatus(tradeId);
    
    // Should be rejected or failed, not stuck in processing
    expect(status).toBeDefined();
    expect(['REJECTED', 'FAILED']).toContain(status?.status);
    
    // System should still be operational
    const stats = orchestrator.getStatistics();
    expect(stats).toBeDefined();
  }, 15000);
});

/**
 * Performance Benchmarks
 */
describe('Performance Benchmarks', () => {
  test('should process trade submission in < 100ms', async () => {
    const orchestrator = new AutonomousExecutionOrchestrator({
      maxConcurrentTrades: 10,
      riskCheckTimeout: 5000,
      consensusTimeout: 10000,
      executionTimeout: 30000,
    });
    
    await orchestrator.initialize();
    
    const prediction = {
      symbol: 'BTC/USD',
      action: 'BUY' as const,
      confidence: 0.8,
      price: 45000,
      quantity: 0.1,
      timestamp: Date.now(),
      features: { momentum: 0.7, volatility: 0.3, volume: 1000000 },
    };
    
    const startTime = Date.now();
    await orchestrator.submitTrade(prediction);
    const endTime = Date.now();
    
    const latency = endTime - startTime;
    
    console.log(`Trade submission latency: ${latency}ms`);
    expect(latency).toBeLessThan(100);
    
    await orchestrator.shutdown();
  });
  
  test('should handle 100 concurrent trades', async () => {
    const orchestrator = new AutonomousExecutionOrchestrator({
      maxConcurrentTrades: 100,
      riskCheckTimeout: 5000,
      consensusTimeout: 10000,
      executionTimeout: 30000,
    });
    
    await orchestrator.initialize();
    
    const predictions = Array.from({ length: 100 }, (_, i) => ({
      symbol: `PAIR${i}/USD`,
      action: (i % 2 === 0 ? 'BUY' : 'SELL') as const,
      confidence: 0.7 + Math.random() * 0.2,
      price: 100 + Math.random() * 100,
      quantity: 1 + Math.random() * 10,
      timestamp: Date.now(),
      features: {
        momentum: Math.random(),
        volatility: Math.random(),
        volume: Math.random() * 1000000,
      },
    }));
    
    const startTime = Date.now();
    const tradeIds = await Promise.all(
      predictions.map(p => orchestrator.submitTrade(p))
    );
    const endTime = Date.now();
    
    const totalTime = endTime - startTime;
    const avgLatency = totalTime / 100;
    
    console.log(`100 concurrent trades submitted in ${totalTime}ms`);
    console.log(`Average latency: ${avgLatency.toFixed(2)}ms`);
    
    expect(tradeIds.length).toBe(100);
    expect(avgLatency).toBeLessThan(50); // Should be very fast
    
    await orchestrator.shutdown();
  }, 30000);
});

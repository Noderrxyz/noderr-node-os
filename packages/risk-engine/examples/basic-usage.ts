import { RiskEngineService, RiskEngineConfig, Portfolio, Position } from '../src';
import winston from 'winston';

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Example portfolio
const createExamplePortfolio = (): Portfolio => ({
  id: 'example-portfolio-1',
  positions: [
    {
      id: 'pos-1',
      symbol: 'BTC',
      side: 'long',
      size: 2.5,
      entryPrice: 40000,
      currentPrice: 45000,
      unrealizedPnL: 12500,
      realizedPnL: 0,
      margin: 20000,
      liquidationPrice: 30000,
      openTime: Date.now() - 86400000,
      lastUpdate: Date.now()
    },
    {
      id: 'pos-2',
      symbol: 'ETH',
      side: 'long',
      size: 30,
      entryPrice: 2500,
      currentPrice: 3000,
      unrealizedPnL: 15000,
      realizedPnL: 0,
      margin: 15000,
      liquidationPrice: 2000,
      openTime: Date.now() - 172800000,
      lastUpdate: Date.now()
    },
    {
      id: 'pos-3',
      symbol: 'SOL',
      side: 'short',
      size: 500,
      entryPrice: 150,
      currentPrice: 140,
      unrealizedPnL: 5000,
      realizedPnL: 0,
      margin: 10000,
      liquidationPrice: 180,
      openTime: Date.now() - 259200000,
      lastUpdate: Date.now()
    }
  ],
  cash: 50000,
  totalValue: 300000,
  leverage: 2.5,
  marginUsed: 45000,
  marginAvailable: 105000,
  lastUpdate: Date.now()
});

// Risk engine configuration
const config: RiskEngineConfig = {
  var: {
    confidenceLevel: 0.95,
    lookbackPeriod: 252,
    methodology: 'parametric'
  },
  positionSizing: {
    methodology: 'optimal',
    targetVolatility: 0.15,
    maxPositionSize: 0.25,
    minPositionSize: 0.01,
    correlationAdjustment: true,
    kellyFraction: 0.25
  },
  stressTesting: {
    scenarios: [
      {
        name: 'Market Crash',
        description: '30% market decline',
        assetShocks: new Map([
          ['BTC', -0.30],
          ['ETH', -0.35],
          ['SOL', -0.40]
        ]),
        volatilityMultiplier: 3,
        liquidityReduction: 0.7,
        duration: 24
      }
    ],
    historicalEvents: [],
    monteCarloConfig: {
      iterations: 1000,
      timeHorizon: 30,
      returnModel: 'normal',
      volatilityModel: 'constant',
      correlationModel: 'static'
    }
  },
  liquidation: {
    marginCallThreshold: 0.8,
    liquidationThreshold: 0.95,
    maintenanceMarginRatio: 0.03,
    deleveragingStrategy: 'optimal',
    gracePeriod: 3600000,
    partialLiquidationAllowed: true
  },
  capitalProtection: {
    circuitBreaker: {
      dailyLossLimit: 0.05,
      weeklyLossLimit: 0.10,
      monthlyLossLimit: 0.15,
      consecutiveLossLimit: 3,
      volatilityMultiplier: 3,
      cooldownPeriod: 3600000,
      autoResumeEnabled: true
    },
    emergencyExit: {
      triggerConditions: [
        {
          type: 'marketCrash',
          threshold: 0.25,
          confirmation: 'immediate',
          severity: 'critical'
        }
      ],
      exitStrategy: 'optimal',
      priorityOrder: ['SOL', 'ETH', 'BTC'],
      maxSlippage: 0.02,
      splitOrders: true,
      notificationChannels: ['console']
    },
    recoveryStrategy: {
      type: 'gradual',
      targetRecoveryTime: 30,
      riskBudget: 0.5,
      allowableStrategies: ['trend'],
      reentryRules: [
        {
          condition: 'drawdown < 10%',
          metric: 'drawdown',
          threshold: 0.10,
          action: 'increase',
          sizingAdjustment: 1.2
        }
      ]
    }
  },
  reporting: {
    frequency: 300000, // 5 minutes
    recipients: ['console'],
    format: 'json',
    includeCharts: false
  },
  telemetry: {
    enabled: true,
    endpoint: 'console',
    sampleRate: 1.0
  }
};

async function main() {
  logger.info('Starting Risk Engine Example');

  // Initialize risk engine
  const riskEngine = new RiskEngineService(config, logger);

  // Set up event listeners
  riskEngine.on('alert', (alert) => {
    logger.warn(`Risk Alert: ${alert.type} - ${alert.data.message || 'No message'}`);
  });

  riskEngine.on('reportGenerated', (report) => {
    logger.info(`Risk Report Generated at ${new Date(report.timestamp).toISOString()}`);
  });

  // Start the engine
  await riskEngine.start();
  logger.info('Risk Engine Started');

  // Create example portfolio
  const portfolio = createExamplePortfolio();
  logger.info(`Portfolio created with ${portfolio.positions.length} positions`);

  // Generate risk report
  logger.info('Generating risk report...');
  const report = await riskEngine.generateRiskReport(portfolio);
  
  // Log key metrics
  logger.info('=== RISK REPORT SUMMARY ===');
  logger.info(`VaR (95%): ${(report.metrics.var.percentage * 100).toFixed(2)}% ($${report.metrics.var.value.toFixed(2)})`);
  
  if (report.metrics.cvar) {
    logger.info(`CVaR: ${(report.metrics.cvar.percentage * 100).toFixed(2)}% ($${report.metrics.cvar.conditionalValue.toFixed(2)})`);
  }
  
  logger.info(`Sharpe Ratio: ${report.metrics.sharpeRatio.toFixed(2)}`);
  logger.info(`Max Drawdown: ${(report.metrics.maxDrawdown * 100).toFixed(2)}%`);
  logger.info(`Current Drawdown: ${(report.metrics.currentDrawdown * 100).toFixed(2)}%`);
  logger.info(`Margin Level: ${report.marginStatus.marginLevel.toFixed(2)}%`);
  logger.info(`Margin Status: ${report.marginStatus.status}`);
  logger.info(`Circuit Breaker: ${report.circuitBreakerStatus.isActive ? 'ACTIVE' : 'Inactive'}`);

  // Log alerts
  if (report.alerts.length > 0) {
    logger.warn(`=== ALERTS (${report.alerts.length}) ===`);
    report.alerts.forEach(alert => {
      logger.warn(`${alert.severity.toUpperCase()}: ${alert.message}`);
    });
  }

  // Log recommendations
  if (report.recommendations.length > 0) {
    logger.info(`=== RECOMMENDATIONS (${report.recommendations.length}) ===`);
    report.recommendations.forEach(rec => {
      logger.info(`${rec.urgency.toUpperCase()}: ${rec.action} - ${rec.reason}`);
    });
  }

  // Calculate position size for a new trade
  logger.info('\n=== POSITION SIZING EXAMPLE ===');
  const signal = {
    symbol: 'MATIC',
    direction: 'long' as const,
    confidence: 0.75,
    expectedReturn: 0.08,
    stopLoss: 0.03,
    takeProfit: 0.15,
    timeHorizon: 7
  };

  try {
    const sizing = await riskEngine.calculatePositionSize(signal, portfolio);
    logger.info(`Recommended Position Size: ${(sizing.recommendedSize * 100).toFixed(2)}%`);
    logger.info(`Adjusted Position Size: ${(sizing.adjustedSize * 100).toFixed(2)}%`);
    logger.info(`Methodology: ${sizing.methodology}`);
    logger.info(`Risk Contribution: ${(sizing.riskContribution * 100).toFixed(2)}%`);
    
    if (sizing.constraints.length > 0) {
      logger.info('Applied Constraints:');
      sizing.constraints.forEach(constraint => {
        logger.info(`  - ${constraint}`);
      });
    }
  } catch (error) {
    logger.error(`Position sizing failed: ${error.message}`);
  }

  // Run stress tests
  logger.info('\n=== STRESS TEST RESULTS ===');
  report.stressTests.forEach(test => {
    logger.info(`${test.scenario}:`);
    logger.info(`  Portfolio Loss: ${(test.percentageLoss * 100).toFixed(2)}% ($${test.portfolioLoss.toFixed(2)})`);
    logger.info(`  Worst Position: ${test.worstPosition} (${(test.worstPositionLoss).toFixed(2)})`);
    logger.info(`  Margin Call: ${test.marginCall ? 'YES' : 'No'}`);
    logger.info(`  Liquidation: ${test.liquidation ? 'YES' : 'No'}`);
  });

  // Get telemetry
  const telemetry = riskEngine.getTelemetry();
  logger.info('\n=== TELEMETRY ===');
  logger.info(`Alerts Triggered: ${telemetry.alertsTriggered}`);
  logger.info(`Margin Calls: ${telemetry.marginCallsIssued}`);
  logger.info(`Liquidations: ${telemetry.liquidationsExecuted}`);
  logger.info(`Circuit Breaker Activations: ${telemetry.circuitBreakerActivations}`);
  logger.info(`Average Calculation Time: ${telemetry.performance.avgCalculationTime.toFixed(2)}ms`);

  // Simulate a market crash to test emergency exit
  logger.info('\n=== SIMULATING MARKET CRASH ===');
  const crashedPortfolio = {
    ...portfolio,
    totalValue: portfolio.totalValue * 0.7, // 30% loss
    positions: portfolio.positions.map(pos => ({
      ...pos,
      currentPrice: pos.currentPrice * 0.7,
      unrealizedPnL: pos.unrealizedPnL - (pos.size * pos.currentPrice * 0.3)
    }))
  };

  const crashReport = await riskEngine.generateRiskReport(crashedPortfolio);
  logger.error(`Post-crash portfolio value: $${crashedPortfolio.totalValue.toFixed(2)}`);
  logger.error(`Circuit breaker status: ${crashReport.circuitBreakerStatus.isActive ? 'TRIGGERED' : 'Still inactive'}`);

  // Stop the engine
  await riskEngine.stop();
  logger.info('Risk Engine Stopped');
}

// Run the example
main().catch(error => {
  logger.error('Example failed:', error);
  process.exit(1);
}); 
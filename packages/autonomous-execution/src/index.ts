/**
 * Autonomous Execution Package
 * 
 * Orchestrates the full autonomous trading pipeline from ML predictions to execution.
 * 
 * @packageDocumentation
 */

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils';
import { AutonomousExecutionOrchestrator } from './AutonomousExecutionOrchestrator';

export { AutonomousExecutionOrchestrator };
export type {
  MLPrediction,
  RiskAssessment,
  ExecutionPlan,
  ExecutionResult,
  AutonomousTradeFlow,
  OrchestratorConfig,
} from './AutonomousExecutionOrchestrator';

// ============================================================================
// Main Entry Point
// ============================================================================

if (require.main === module) {
  const logger = new Logger('autonomous-execution');
  getShutdownHandler(30000);

  (async () => {
    try {
      logger.info('Starting Autonomous Execution Service...');

      const orchestrator = new AutonomousExecutionOrchestrator({
        enableMLPredictions: process.env.ENABLE_ML_PREDICTIONS !== 'false',
        enableRiskManagement: process.env.ENABLE_RISK_MANAGEMENT !== 'false',
        enableConsensus: process.env.ENABLE_CONSENSUS !== 'false',
        maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '5'),
      });

      await orchestrator.start();

      onShutdown('autonomous-execution', async () => {
        logger.info('Shutting down Autonomous Execution Service...');
        await orchestrator.stop();
        logger.info('Autonomous Execution Service shut down complete');
      }, 10000);

      logger.info('Autonomous Execution Service started successfully');

      await new Promise(() => {});
    } catch (error) {
      logger.error('Fatal error starting Autonomous Execution Service:', error);
      process.exit(1);
    }
  })();
}

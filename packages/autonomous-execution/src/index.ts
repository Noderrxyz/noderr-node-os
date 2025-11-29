/**
 * Autonomous Execution Package
 * 
 * Orchestrates the full autonomous trading pipeline from ML predictions to execution.
 * 
 * @packageDocumentation
 */

export { AutonomousExecutionOrchestrator } from './AutonomousExecutionOrchestrator';
export type {
  MLPrediction,
  RiskAssessment,
  ExecutionPlan,
  ExecutionResult,
  AutonomousTradeFlow,
  OrchestratorConfig,
} from './AutonomousExecutionOrchestrator';

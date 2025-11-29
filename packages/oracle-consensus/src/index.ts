/**
 * Oracle Consensus Package
 * 
 * Provides BFT consensus mechanism for Oracle network.
 * 
 * @packageDocumentation
 */

export { BFTConsensusEngine } from './BFTConsensusEngine';
export type { ConsensusConfig, OracleSubmission, ConsensusResult, OracleInfo } from './BFTConsensusEngine';

export { OracleCoordinator } from './OracleCoordinator';
export type { TradingSignal, ConsensusRequest, ConsensusResponse } from './OracleCoordinator';

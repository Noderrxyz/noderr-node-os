/**
 * @noderr/protocol-config
 * 
 * Unified protocol configuration constants for Noderr node software.
 * All values are synchronized with on-chain smart contracts.
 */

export {
  NodeTier,
  STAKING_REQUIREMENTS,
  STAKING_REQUIREMENTS_BY_NAME,
  getStakingRequirement,
  formatStakingRequirement,
  hasSufficientStake,
} from './staking';

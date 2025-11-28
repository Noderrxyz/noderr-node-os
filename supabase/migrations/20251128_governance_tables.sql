-- Sprint 7: Governance, Staking, and Slashing Tables
-- Created: 2025-11-28
-- Purpose: Support governance proposals, staking tracking, rewards, and slashing events

-- ========================================
-- GOVERNANCE PROPOSALS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS governance_proposals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  proposal_type TEXT NOT NULL CHECK (proposal_type IN (
    'version_deployment',
    'parameter_change',
    'emergency_action',
    'fund_transfer',
    'contract_upgrade'
  )),
  parameters JSONB NOT NULL DEFAULT '{}',
  proposer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approved',
    'executed',
    'rejected'
  )),
  signatures_required INTEGER NOT NULL DEFAULT 2,
  signatures_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  executed_at TIMESTAMP WITH TIME ZONE,
  execution_result JSONB,
  CONSTRAINT valid_signatures CHECK (signatures_count <= signatures_required)
);

-- Index for querying proposals by status
CREATE INDEX IF NOT EXISTS idx_proposals_status ON governance_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_created_at ON governance_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON governance_proposals(proposer);

-- ========================================
-- PROPOSAL SIGNATURES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS proposal_signatures (
  id SERIAL PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES governance_proposals(id) ON DELETE CASCADE,
  signer TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(proposal_id, signer)
);

-- Index for querying signatures by proposal
CREATE INDEX IF NOT EXISTS idx_signatures_proposal ON proposal_signatures(proposal_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signer ON proposal_signatures(signer);

-- ========================================
-- NODE STAKES TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS node_stakes (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  operator_address TEXT NOT NULL,
  amount TEXT NOT NULL, -- Stored as string to handle big numbers
  tier TEXT NOT NULL CHECK (tier IN ('ALL', 'ORACLE', 'GUARDIAN')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  staked_at TIMESTAMP WITH TIME ZONE NOT NULL,
  withdrawal_requested_at TIMESTAMP WITH TIME ZONE,
  withdrawn_at TIMESTAMP WITH TIME ZONE,
  blockchain_tx_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for querying stakes
CREATE INDEX IF NOT EXISTS idx_stakes_node_id ON node_stakes(node_id);
CREATE INDEX IF NOT EXISTS idx_stakes_operator ON node_stakes(operator_address);
CREATE INDEX IF NOT EXISTS idx_stakes_active ON node_stakes(active);
CREATE INDEX IF NOT EXISTS idx_stakes_tier ON node_stakes(tier);
CREATE INDEX IF NOT EXISTS idx_stakes_staked_at ON node_stakes(staked_at DESC);

-- ========================================
-- NODE REWARDS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS node_rewards (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  amount TEXT NOT NULL, -- Stored as string to handle big numbers
  tier TEXT NOT NULL CHECK (tier IN ('ALL', 'ORACLE', 'GUARDIAN')),
  uptime INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  successful_trades INTEGER NOT NULL DEFAULT 0,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TIMESTAMP WITH TIME ZONE,
  blockchain_tx_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(node_id, epoch)
);

-- Indexes for querying rewards
CREATE INDEX IF NOT EXISTS idx_rewards_node_id ON node_rewards(node_id);
CREATE INDEX IF NOT EXISTS idx_rewards_epoch ON node_rewards(epoch);
CREATE INDEX IF NOT EXISTS idx_rewards_claimed ON node_rewards(claimed);
CREATE INDEX IF NOT EXISTS idx_rewards_tier ON node_rewards(tier);

-- ========================================
-- SLASHING EVENTS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS slashing_events (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  operator_address TEXT NOT NULL,
  amount TEXT NOT NULL, -- Stored as string to handle big numbers
  violation_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  reason TEXT NOT NULL,
  evidence JSONB,
  slashed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  blockchain_tx_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for querying slashing events
CREATE INDEX IF NOT EXISTS idx_slashing_node_id ON slashing_events(node_id);
CREATE INDEX IF NOT EXISTS idx_slashing_operator ON slashing_events(operator_address);
CREATE INDEX IF NOT EXISTS idx_slashing_severity ON slashing_events(severity);
CREATE INDEX IF NOT EXISTS idx_slashing_violation_type ON slashing_events(violation_type);
CREATE INDEX IF NOT EXISTS idx_slashing_slashed_at ON slashing_events(slashed_at DESC);

-- ========================================
-- ROW LEVEL SECURITY (RLS)
-- ========================================

-- Enable RLS on all tables
ALTER TABLE governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_stakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE slashing_events ENABLE ROW LEVEL SECURITY;

-- Policies: Allow service role full access
CREATE POLICY "Service role full access to proposals"
  ON governance_proposals
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to signatures"
  ON proposal_signatures
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to stakes"
  ON node_stakes
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to rewards"
  ON node_rewards
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to slashing"
  ON slashing_events
  FOR ALL
  USING (auth.role() = 'service_role');

-- ========================================
-- TRIGGERS FOR UPDATED_AT
-- ========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_node_stakes_updated_at
  BEFORE UPDATE ON node_stakes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- COMMENTS
-- ========================================

COMMENT ON TABLE governance_proposals IS 'Multi-sig governance proposals for system changes';
COMMENT ON TABLE proposal_signatures IS 'Signatures from multi-sig members for proposals';
COMMENT ON TABLE node_stakes IS 'Node staking information synced from blockchain';
COMMENT ON TABLE node_rewards IS 'Reward distribution tracking for nodes';
COMMENT ON TABLE slashing_events IS 'Slashing events for node misbehavior';

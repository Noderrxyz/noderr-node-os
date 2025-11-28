-- Helper Tables for Backend Services
-- Created: 2025-11-28
-- Purpose: Support proposal execution logging and system configuration

-- ========================================
-- PROPOSAL EXECUTION LOG TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS proposal_execution_log (
  id SERIAL PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('executed', 'failed')),
  result JSONB,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_execution_log_proposal ON proposal_execution_log(proposal_id);
CREATE INDEX IF NOT EXISTS idx_execution_log_executed_at ON proposal_execution_log(executed_at DESC);

-- Enable RLS
ALTER TABLE proposal_execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to execution_log"
  ON proposal_execution_log
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE proposal_execution_log IS 'Logs all proposal execution attempts and results';

-- ========================================
-- SYSTEM CONFIG TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to system_config"
  ON system_config
  FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_system_config_updated_at
  BEFORE UPDATE ON system_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE system_config IS 'System-wide configuration parameters';

-- ========================================
-- NODE TELEMETRY TABLE (if not exists)
-- ========================================

CREATE TABLE IF NOT EXISTS node_telemetry (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  uptime INTEGER DEFAULT 0,
  requests INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  cpu_usage NUMERIC(5,2),
  memory_usage NUMERIC(5,2),
  metrics JSONB
);

CREATE INDEX IF NOT EXISTS idx_telemetry_node_id ON node_telemetry(node_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON node_telemetry(timestamp DESC);

-- Enable RLS
ALTER TABLE node_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to node_telemetry"
  ON node_telemetry
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE node_telemetry IS 'Node performance telemetry data';

-- ========================================
-- NODE HEARTBEATS TABLE (if not exists)
-- ========================================

CREATE TABLE IF NOT EXISTS node_heartbeats (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'online',
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_node_id ON node_heartbeats(node_id);
CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON node_heartbeats(timestamp DESC);

-- Enable RLS
ALTER TABLE node_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to node_heartbeats"
  ON node_heartbeats
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE node_heartbeats IS 'Node heartbeat tracking';

-- ========================================
-- NODE HEALTH CHECKS TABLE (if not exists)
-- ========================================

CREATE TABLE IF NOT EXISTS node_health_checks (
  id SERIAL PRIMARY KEY,
  node_id TEXT NOT NULL,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_health_checks_node_id ON node_health_checks(node_id);
CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at ON node_health_checks(checked_at DESC);

-- Enable RLS
ALTER TABLE node_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to node_health_checks"
  ON node_health_checks
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE node_health_checks IS 'Node health check results';

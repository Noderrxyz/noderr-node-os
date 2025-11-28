-- Sync State Table for Blockchain Event Synchronization
-- Created: 2025-11-28
-- Purpose: Track last processed block for event listeners

CREATE TABLE IF NOT EXISTS sync_state (
  service TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access to sync_state"
  ON sync_state
  FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_sync_state_updated_at
  BEFORE UPDATE ON sync_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comment
COMMENT ON TABLE sync_state IS 'Tracks last processed block for blockchain event synchronization';

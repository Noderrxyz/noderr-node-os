-- Migration 002: Add used_at column and ensure node_telemetry schema is complete
-- Run this in the Supabase SQL Editor for project xryqdulaknwbhfuazqss

-- 1. Add used_at column to install_tokens for atomic token claiming
ALTER TABLE install_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Ensure node_telemetry table has all columns the database service expects
CREATE TABLE IF NOT EXISTS node_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL REFERENCES node_identities(node_id) ON DELETE CASCADE,
  uptime INTEGER,
  cpu_usage NUMERIC(5,2),
  memory_usage NUMERIC(5,2),
  disk_usage NUMERIC(5,2) DEFAULT 0,
  network_rx BIGINT DEFAULT 0,
  network_tx BIGINT DEFAULT 0,
  version TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if table already exists but is missing them
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'node_telemetry' AND column_name = 'disk_usage') THEN
    ALTER TABLE node_telemetry ADD COLUMN disk_usage NUMERIC(5,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'node_telemetry' AND column_name = 'network_rx') THEN
    ALTER TABLE node_telemetry ADD COLUMN network_rx BIGINT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'node_telemetry' AND column_name = 'network_tx') THEN
    ALTER TABLE node_telemetry ADD COLUMN network_tx BIGINT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'node_telemetry' AND column_name = 'version') THEN
    ALTER TABLE node_telemetry ADD COLUMN version TEXT;
  END IF;
END $$;

-- 3. Create index for efficient telemetry queries
CREATE INDEX IF NOT EXISTS idx_node_telemetry_node_id_timestamp
  ON node_telemetry(node_id, timestamp DESC);

-- 4. Enable RLS on node_telemetry
ALTER TABLE node_telemetry ENABLE ROW LEVEL SECURITY;

-- 5. Allow service role full access
CREATE POLICY IF NOT EXISTS "Service role full access on node_telemetry"
  ON node_telemetry FOR ALL
  USING (true)
  WITH CHECK (true);

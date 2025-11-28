-- ========================================
-- MODEL VERSIONS TABLE
-- ========================================
-- Created: 2025-11-28
-- Purpose: Track ML model versions and distribution
-- Quality: PhD-Level

CREATE TABLE IF NOT EXISTS model_versions (
  id SERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  version TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('validator', 'guardian', 'oracle')),
  url TEXT NOT NULL,
  checksum TEXT NOT NULL,
  manifest JSONB NOT NULL,
  deployed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  active BOOLEAN DEFAULT TRUE,
  downloads INTEGER DEFAULT 0,
  UNIQUE(model_id, version)
);

CREATE INDEX IF NOT EXISTS idx_model_versions_active ON model_versions(model_id, tier, active);
CREATE INDEX IF NOT EXISTS idx_model_versions_deployed ON model_versions(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_versions_tier ON model_versions(tier);

-- Enable RLS
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to active models"
  ON model_versions
  FOR SELECT
  USING (active = TRUE);

CREATE POLICY "Service role full access to model versions"
  ON model_versions
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE model_versions IS 'ML model versions for distribution to nodes';
COMMENT ON COLUMN model_versions.manifest IS 'Model manifest with architecture, shapes, and metadata';
COMMENT ON COLUMN model_versions.active IS 'Whether this version is active for distribution';

-- Verify table created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'model_versions'
  ) THEN
    RAISE NOTICE '✅ Model versions table created successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to create model_versions table';
  END IF;
END $$;

-- ========================================
-- INFERENCE RESULTS TABLE
-- ========================================
-- Created: 2025-11-28
-- Purpose: Store ML inference results from nodes
-- Quality: PhD-Level

CREATE TABLE IF NOT EXISTS inference_results (
  id SERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  output JSONB NOT NULL,
  confidence DOUBLE PRECISION,
  execution_time INTEGER NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(request_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_inference_results_node ON inference_results(node_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inference_results_model ON inference_results(model_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inference_results_timestamp ON inference_results(timestamp DESC);

-- Enable RLS
ALTER TABLE inference_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access to inference results"
  ON inference_results
  FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to inference results"
  ON inference_results
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE inference_results IS 'ML inference results from NODERR nodes';
COMMENT ON COLUMN inference_results.output IS 'Model output (predictions, classifications, etc.)';
COMMENT ON COLUMN inference_results.confidence IS 'Confidence score (0-1) for classification tasks';

-- Verify table created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'inference_results'
  ) THEN
    RAISE NOTICE '✅ Inference results table created successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to create inference_results table';
  END IF;
END $$;

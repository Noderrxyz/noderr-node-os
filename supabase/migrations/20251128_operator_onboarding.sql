-- ========================================
-- OPERATOR ONBOARDING TABLES
-- ========================================
-- Created: 2025-11-28
-- Purpose: Support operator application and approval workflow
-- Quality: PhD-Level

-- ========================================
-- OPERATOR APPLICATIONS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS operator_applications (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('validator', 'guardian', 'oracle')),
  experience TEXT,
  infrastructure TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
  typeform_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON operator_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_wallet ON operator_applications(wallet_address);
CREATE INDEX IF NOT EXISTS idx_applications_email ON operator_applications(email);
CREATE INDEX IF NOT EXISTS idx_applications_submitted ON operator_applications(submitted_at DESC);

-- Enable RLS
ALTER TABLE operator_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to applications"
  ON operator_applications
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE operator_applications IS 'Operator node applications from Typeform';
COMMENT ON COLUMN operator_applications.tier IS 'Node tier: validator, guardian, or oracle';
COMMENT ON COLUMN operator_applications.status IS 'Application status: pending, approved, or rejected';

-- ========================================
-- OPERATOR CREDENTIALS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS operator_credentials (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES operator_applications(id),
  operator_address TEXT NOT NULL UNIQUE,
  node_id TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL UNIQUE,
  api_secret_hash TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('validator', 'guardian', 'oracle')),
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_reason TEXT,
  last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_credentials_operator ON operator_credentials(operator_address);
CREATE INDEX IF NOT EXISTS idx_credentials_node ON operator_credentials(node_id);
CREATE INDEX IF NOT EXISTS idx_credentials_api_key ON operator_credentials(api_key);
CREATE INDEX IF NOT EXISTS idx_credentials_tier ON operator_credentials(tier);
CREATE INDEX IF NOT EXISTS idx_credentials_revoked ON operator_credentials(revoked) WHERE revoked = FALSE;

-- Enable RLS
ALTER TABLE operator_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to credentials"
  ON operator_credentials
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE operator_credentials IS 'Operator API credentials and node IDs';
COMMENT ON COLUMN operator_credentials.api_secret_hash IS 'SHA-256 hash of API secret (never store plaintext)';
COMMENT ON COLUMN operator_credentials.revoked IS 'Whether credentials have been revoked';

-- ========================================
-- OPERATOR DOWNLOAD TRACKING TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS operator_downloads (
  id SERIAL PRIMARY KEY,
  credential_id INTEGER REFERENCES operator_credentials(id),
  operator_address TEXT NOT NULL,
  node_id TEXT NOT NULL,
  download_type TEXT NOT NULL CHECK (download_type IN ('config', 'installer', 'docker-compose')),
  download_url TEXT NOT NULL,
  downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_downloads_operator ON operator_downloads(operator_address);
CREATE INDEX IF NOT EXISTS idx_downloads_node ON operator_downloads(node_id);
CREATE INDEX IF NOT EXISTS idx_downloads_credential ON operator_downloads(credential_id);
CREATE INDEX IF NOT EXISTS idx_downloads_timestamp ON operator_downloads(downloaded_at DESC);

-- Enable RLS
ALTER TABLE operator_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to downloads"
  ON operator_downloads
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE operator_downloads IS 'Track node software downloads by operators';
COMMENT ON COLUMN operator_downloads.download_type IS 'Type of download: config, installer, or docker-compose';

-- ========================================
-- OPERATOR NOTIFICATIONS TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS operator_notifications (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES operator_applications(id),
  operator_email TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('application_received', 'application_approved', 'application_rejected', 'credentials_issued', 'node_registered')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_successfully BOOLEAN DEFAULT FALSE,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_application ON operator_notifications(application_id);
CREATE INDEX IF NOT EXISTS idx_notifications_email ON operator_notifications(operator_email);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON operator_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_sent ON operator_notifications(sent_at DESC);

-- Enable RLS
ALTER TABLE operator_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to notifications"
  ON operator_notifications
  FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE operator_notifications IS 'Track email notifications sent to operators';

-- ========================================
-- HELPER FUNCTIONS
-- ========================================

-- Function to get pending applications count
CREATE OR REPLACE FUNCTION get_pending_applications_count()
RETURNS INTEGER AS $$
BEGIN
  RETURN (SELECT COUNT(*) FROM operator_applications WHERE status = 'pending');
END;
$$ LANGUAGE plpgsql;

-- Function to get active operators count by tier
CREATE OR REPLACE FUNCTION get_active_operators_by_tier(tier_name TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*) 
    FROM operator_credentials 
    WHERE tier = tier_name 
    AND revoked = FALSE
  );
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- INITIAL DATA
-- ========================================

-- Insert system config for operator limits (if not exists)
INSERT INTO system_config (key, value)
VALUES 
  ('max_validators', '1000')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value)
VALUES 
  ('max_guardians', '100')
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_config (key, value)
VALUES 
  ('max_oracles', '50')
ON CONFLICT (key) DO NOTHING;

-- ========================================
-- MIGRATION COMPLETE
-- ========================================

-- Verify tables created
DO $$
DECLARE
  table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('operator_applications', 'operator_credentials', 'operator_downloads', 'operator_notifications');
  
  IF table_count = 4 THEN
    RAISE NOTICE '✅ Operator onboarding migration complete - 4 tables created';
  ELSE
    RAISE EXCEPTION '❌ Migration failed - expected 4 tables, found %', table_count;
  END IF;
END $$;

-- Noderr Node OS Authentication API - Database Schema
-- Run this SQL in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Install Tokens Table
CREATE TABLE IF NOT EXISTS install_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT NOT NULL UNIQUE,
    application_id UUID,
    tier TEXT NOT NULL CHECK (tier IN ('ALL', 'ORACLE', 'GUARDIAN', 'VALIDATOR')),
    os TEXT NOT NULL CHECK (os IN ('linux', 'windows')),
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

-- Create index on token for fast lookups
CREATE INDEX IF NOT EXISTS idx_install_tokens_token ON install_tokens(token);
CREATE INDEX IF NOT EXISTS idx_install_tokens_is_used ON install_tokens(is_used);
CREATE INDEX IF NOT EXISTS idx_install_tokens_expires_at ON install_tokens(expires_at);

-- Node Identities Table
CREATE TABLE IF NOT EXISTS node_identities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    attestation_data JSONB NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('ALL', 'ORACLE', 'GUARDIAN', 'VALIDATOR')),
    os TEXT NOT NULL CHECK (os IN ('linux', 'windows')),
    install_token_id UUID REFERENCES install_tokens(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for node_identities
CREATE INDEX IF NOT EXISTS idx_node_identities_node_id ON node_identities(node_id);
CREATE INDEX IF NOT EXISTS idx_node_identities_status ON node_identities(status);
CREATE INDEX IF NOT EXISTS idx_node_identities_tier ON node_identities(tier);
CREATE INDEX IF NOT EXISTS idx_node_identities_last_seen ON node_identities(last_seen);

-- Node Credentials Table
CREATE TABLE IF NOT EXISTS node_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id TEXT NOT NULL REFERENCES node_identities(node_id) ON DELETE CASCADE,
    api_key_hash TEXT NOT NULL,
    jwt_secret TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '365 days')
);

-- Create index for node_credentials
CREATE INDEX IF NOT EXISTS idx_node_credentials_node_id ON node_credentials(node_id);
CREATE INDEX IF NOT EXISTS idx_node_credentials_expires_at ON node_credentials(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on node_identities
DROP TRIGGER IF EXISTS update_node_identities_updated_at ON node_identities;
CREATE TRIGGER update_node_identities_updated_at
    BEFORE UPDATE ON node_identities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Enable RLS on all tables
ALTER TABLE install_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_credentials ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role can do everything on install_tokens"
    ON install_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on node_identities"
    ON node_identities
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role can do everything on node_credentials"
    ON node_credentials
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE install_tokens IS 'Single-use installation tokens for node provisioning';
COMMENT ON TABLE node_identities IS 'Node identities with TPM-attested public keys';
COMMENT ON TABLE node_credentials IS 'Node authentication credentials (API keys and JWT secrets)';

COMMENT ON COLUMN install_tokens.token IS 'Unique installation token (ndr_install_...)';
COMMENT ON COLUMN install_tokens.is_used IS 'Whether the token has been consumed';
COMMENT ON COLUMN install_tokens.expires_at IS 'Token expiration timestamp (7 days from creation)';

COMMENT ON COLUMN node_identities.node_id IS 'Unique node ID (SHA-256 hash of public key)';
COMMENT ON COLUMN node_identities.public_key IS 'TPM-generated public key in PEM format';
COMMENT ON COLUMN node_identities.attestation_data IS 'TPM attestation data (quote, signature, PCR values)';
COMMENT ON COLUMN node_identities.status IS 'Node status (pending, active, suspended, revoked)';
COMMENT ON COLUMN node_identities.last_seen IS 'Last heartbeat timestamp';

COMMENT ON COLUMN node_credentials.api_key_hash IS 'Bcrypt hash of API key';
COMMENT ON COLUMN node_credentials.jwt_secret IS 'Secret for JWT signing';
COMMENT ON COLUMN node_credentials.expires_at IS 'Credential expiration timestamp (1 year from creation)';

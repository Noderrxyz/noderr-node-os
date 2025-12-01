-- Noderr Database Initialization Script
-- PhD-level database schema for decentralized trading network

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- Create schemas
CREATE SCHEMA IF NOT EXISTS trading;
CREATE SCHEMA IF NOT EXISTS consensus;
CREATE SCHEMA IF NOT EXISTS governance;
CREATE SCHEMA IF NOT EXISTS analytics;

-- Trading schema tables
CREATE TABLE IF NOT EXISTS trading.positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id VARCHAR(66) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('LONG', 'SHORT')),
    amount DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    current_price DECIMAL(20, 8),
    unrealized_pnl DECIMAL(20, 8),
    realized_pnl DECIMAL(20, 8) DEFAULT 0,
    leverage DECIMAL(5, 2) DEFAULT 1.0,
    margin_required DECIMAL(20, 8),
    liquidation_price DECIMAL(20, 8),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP,
    metadata JSONB,
    CONSTRAINT valid_amount CHECK (amount > 0),
    CONSTRAINT valid_leverage CHECK (leverage >= 1.0 AND leverage <= 100.0)
);

CREATE INDEX idx_positions_node_id ON trading.positions(node_id);
CREATE INDEX idx_positions_symbol ON trading.positions(symbol);
CREATE INDEX idx_positions_status ON trading.positions(status);
CREATE INDEX idx_positions_opened_at ON trading.positions(opened_at DESC);

CREATE TABLE IF NOT EXISTS trading.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id VARCHAR(66) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    type VARCHAR(20) NOT NULL CHECK (type IN ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT')),
    amount DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8),
    stop_price DECIMAL(20, 8),
    filled_amount DECIMAL(20, 8) DEFAULT 0,
    avg_fill_price DECIMAL(20, 8),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    time_in_force VARCHAR(10) DEFAULT 'GTC',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    filled_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    metadata JSONB,
    CONSTRAINT valid_amount CHECK (amount > 0)
);

CREATE INDEX idx_orders_node_id ON trading.orders(node_id);
CREATE INDEX idx_orders_symbol ON trading.orders(symbol);
CREATE INDEX idx_orders_status ON trading.orders(status);
CREATE INDEX idx_orders_created_at ON trading.orders(created_at DESC);

CREATE TABLE IF NOT EXISTS trading.trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES trading.orders(id),
    node_id VARCHAR(66) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    fee DECIMAL(20, 8) DEFAULT 0,
    fee_currency VARCHAR(10),
    executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    exchange VARCHAR(50),
    trade_id VARCHAR(100),
    metadata JSONB
);

CREATE INDEX idx_trades_order_id ON trading.trades(order_id);
CREATE INDEX idx_trades_node_id ON trading.trades(node_id);
CREATE INDEX idx_trades_executed_at ON trading.trades(executed_at DESC);

-- Consensus schema tables
CREATE TABLE IF NOT EXISTS consensus.nodes (
    id VARCHAR(66) PRIMARY KEY,
    public_key TEXT NOT NULL,
    stake_amount DECIMAL(20, 8) NOT NULL DEFAULT 0,
    reputation_score DECIMAL(10, 4) NOT NULL DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    successful_votes INTEGER DEFAULT 0,
    last_heartbeat TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    metadata JSONB,
    CONSTRAINT valid_stake CHECK (stake_amount >= 0),
    CONSTRAINT valid_reputation CHECK (reputation_score >= 0 AND reputation_score <= 100)
);

CREATE INDEX idx_nodes_status ON consensus.nodes(status);
CREATE INDEX idx_nodes_reputation ON consensus.nodes(reputation_score DESC);
CREATE INDEX idx_nodes_stake ON consensus.nodes(stake_amount DESC);

CREATE TABLE IF NOT EXISTS consensus.proposals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposer_id VARCHAR(66) REFERENCES consensus.nodes(id),
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    data JSONB NOT NULL,
    votes_for INTEGER DEFAULT 0,
    votes_against INTEGER DEFAULT 0,
    votes_abstain INTEGER DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    voting_ends_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP,
    metadata JSONB
);

CREATE INDEX idx_proposals_status ON consensus.proposals(status);
CREATE INDEX idx_proposals_created_at ON consensus.proposals(created_at DESC);
CREATE INDEX idx_proposals_voting_ends_at ON consensus.proposals(voting_ends_at);

CREATE TABLE IF NOT EXISTS consensus.votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id UUID REFERENCES consensus.proposals(id),
    voter_id VARCHAR(66) REFERENCES consensus.nodes(id),
    vote VARCHAR(10) NOT NULL CHECK (vote IN ('FOR', 'AGAINST', 'ABSTAIN')),
    weight DECIMAL(20, 8) NOT NULL,
    voted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    signature TEXT NOT NULL,
    UNIQUE(proposal_id, voter_id)
);

CREATE INDEX idx_votes_proposal_id ON consensus.votes(proposal_id);
CREATE INDEX idx_votes_voter_id ON consensus.votes(voter_id);

-- Governance schema tables
CREATE TABLE IF NOT EXISTS governance.risk_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    policy JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    active BOOLEAN DEFAULT true,
    created_by VARCHAR(66) REFERENCES consensus.nodes(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMP,
    deactivated_at TIMESTAMP
);

CREATE INDEX idx_risk_policies_active ON governance.risk_policies(active);
CREATE INDEX idx_risk_policies_created_at ON governance.risk_policies(created_at DESC);

-- Analytics schema tables
CREATE TABLE IF NOT EXISTS analytics.performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id VARCHAR(66) REFERENCES consensus.nodes(id),
    metric_date DATE NOT NULL,
    total_pnl DECIMAL(20, 8) DEFAULT 0,
    win_rate DECIMAL(5, 4),
    sharpe_ratio DECIMAL(10, 4),
    max_drawdown DECIMAL(10, 4),
    total_trades INTEGER DEFAULT 0,
    total_volume DECIMAL(20, 8) DEFAULT 0,
    avg_trade_duration INTERVAL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(node_id, metric_date)
);

CREATE INDEX idx_performance_node_id ON analytics.performance_metrics(node_id);
CREATE INDEX idx_performance_date ON analytics.performance_metrics(metric_date DESC);

-- Create materialized view for node rankings
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.node_rankings AS
SELECT 
    n.id,
    n.reputation_score,
    n.stake_amount,
    COALESCE(pm.total_pnl, 0) as total_pnl,
    COALESCE(pm.sharpe_ratio, 0) as sharpe_ratio,
    COALESCE(pm.win_rate, 0) as win_rate,
    (n.reputation_score * 0.4 + 
     COALESCE(pm.sharpe_ratio, 0) * 10 * 0.3 + 
     COALESCE(pm.win_rate, 0) * 100 * 0.3) as composite_score
FROM consensus.nodes n
LEFT JOIN LATERAL (
    SELECT * FROM analytics.performance_metrics pm2
    WHERE pm2.node_id = n.id
    ORDER BY metric_date DESC
    LIMIT 1
) pm ON true
WHERE n.status = 'ACTIVE';

CREATE UNIQUE INDEX idx_node_rankings_id ON analytics.node_rankings(id);
CREATE INDEX idx_node_rankings_composite ON analytics.node_rankings(composite_score DESC);

-- Create function to refresh rankings
CREATE OR REPLACE FUNCTION analytics.refresh_node_rankings()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.node_rankings;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT USAGE ON SCHEMA trading TO noderr;
GRANT USAGE ON SCHEMA consensus TO noderr;
GRANT USAGE ON SCHEMA governance TO noderr;
GRANT USAGE ON SCHEMA analytics TO noderr;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA trading TO noderr;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA consensus TO noderr;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA governance TO noderr;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA analytics TO noderr;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA trading TO noderr;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA consensus TO noderr;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA governance TO noderr;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA analytics TO noderr;

-- Create indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_positions_composite 
ON trading.positions(node_id, status, symbol) WHERE status = 'OPEN';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_composite 
ON trading.orders(node_id, status, created_at DESC) WHERE status IN ('PENDING', 'PARTIAL');

-- Add comments
COMMENT ON SCHEMA trading IS 'Trading operations, positions, orders, and trades';
COMMENT ON SCHEMA consensus IS 'Consensus mechanism, nodes, proposals, and votes';
COMMENT ON SCHEMA governance IS 'Governance policies and risk management';
COMMENT ON SCHEMA analytics IS 'Performance metrics and analytics';

COMMENT ON TABLE trading.positions IS 'Active and historical trading positions';
COMMENT ON TABLE trading.orders IS 'Order book and order history';
COMMENT ON TABLE trading.trades IS 'Executed trades and fills';
COMMENT ON TABLE consensus.nodes IS 'Network nodes and their reputation';
COMMENT ON TABLE consensus.proposals IS 'Governance proposals';
COMMENT ON TABLE consensus.votes IS 'Votes on proposals';
COMMENT ON TABLE governance.risk_policies IS 'Risk management policies';
COMMENT ON TABLE analytics.performance_metrics IS 'Node performance metrics';

-- Initialization complete
SELECT 'Noderr database initialized successfully' as status;


-- ============================================================================
-- User Application & NFT System Schema
-- ============================================================================

-- Create schema for user management
CREATE SCHEMA IF NOT EXISTS users;

-- User applications from Typeform
CREATE TABLE IF NOT EXISTS users.applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    typeform_response_id VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    wallet_address VARCHAR(66) NOT NULL,
    requested_node_type VARCHAR(20) NOT NULL CHECK (requested_node_type IN ('ORACLE', 'GUARDIAN', 'VALIDATOR')),
    stake_amount DECIMAL(20, 8) NOT NULL,
    experience TEXT,
    motivation TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(66),
    rejection_reason TEXT,
    metadata JSONB,
    CONSTRAINT valid_stake CHECK (stake_amount > 0)
);

CREATE INDEX idx_applications_status ON users.applications(status);
CREATE INDEX idx_applications_email ON users.applications(email);
CREATE INDEX idx_applications_wallet ON users.applications(wallet_address);
CREATE INDEX idx_applications_submitted ON users.applications(submitted_at DESC);

-- Utility NFTs
CREATE TABLE IF NOT EXISTS users.nfts (
    token_id VARCHAR(100) PRIMARY KEY,
    contract_address VARCHAR(66) NOT NULL,
    owner VARCHAR(66) NOT NULL,
    node_type VARCHAR(20) NOT NULL CHECK (node_type IN ('ORACLE', 'GUARDIAN', 'VALIDATOR')),
    node_id VARCHAR(66),
    stake_amount DECIMAL(20, 8) NOT NULL,
    minted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMP,
    expires_at TIMESTAMP,
    metadata JSONB NOT NULL,
    CONSTRAINT valid_nft_stake CHECK (stake_amount > 0)
);

CREATE INDEX idx_nfts_owner ON users.nfts(owner);
CREATE INDEX idx_nfts_node_id ON users.nfts(node_id);
CREATE INDEX idx_nfts_node_type ON users.nfts(node_type);
CREATE INDEX idx_nfts_minted ON users.nfts(minted_at DESC);

-- Node credentials (encrypted)
CREATE TABLE IF NOT EXISTS users.credentials (
    node_id VARCHAR(66) PRIMARY KEY,
    nft_token_id VARCHAR(100) REFERENCES users.nfts(token_id),
    private_key TEXT NOT NULL, -- Encrypted
    public_key TEXT NOT NULL,
    api_keys JSONB, -- Encrypted
    exchange_credentials JSONB, -- Encrypted
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_rotated TIMESTAMP,
    UNIQUE(nft_token_id)
);

CREATE INDEX idx_credentials_nft ON users.credentials(nft_token_id);

-- Authorizations
CREATE TABLE IF NOT EXISTS users.authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID REFERENCES users.applications(id),
    authorized_by VARCHAR(66) NOT NULL,
    nft_token_id VARCHAR(100) REFERENCES users.nfts(token_id),
    node_id VARCHAR(66),
    authorized_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP,
    revoked_by VARCHAR(66),
    revoked_reason TEXT
);

CREATE INDEX idx_authorizations_application ON users.authorizations(application_id);
CREATE INDEX idx_authorizations_nft ON users.authorizations(nft_token_id);
CREATE INDEX idx_authorizations_revoked ON users.authorizations(revoked);

-- ============================================================================
-- Node Type System Schema Extensions
-- ============================================================================

-- Extend nodes table with type information
ALTER TABLE consensus.nodes ADD COLUMN IF NOT EXISTS node_type VARCHAR(20) DEFAULT 'VALIDATOR' CHECK (node_type IN ('ORACLE', 'GUARDIAN', 'VALIDATOR'));
ALTER TABLE consensus.nodes ADD COLUMN IF NOT EXISTS nft_token_id VARCHAR(100);
ALTER TABLE consensus.nodes ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(66);
ALTER TABLE consensus.nodes ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_nodes_type ON consensus.nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_nft ON consensus.nodes(nft_token_id);
CREATE INDEX IF NOT EXISTS idx_nodes_wallet ON consensus.nodes(wallet_address);

-- Node functions catalog
CREATE TABLE IF NOT EXISTS consensus.node_functions (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    node_type VARCHAR(20) NOT NULL CHECK (node_type IN ('ORACLE', 'GUARDIAN', 'VALIDATOR')),
    category VARCHAR(50) NOT NULL,
    priority INTEGER DEFAULT 0,
    required_permissions JSONB DEFAULT '[]'::jsonb,
    estimated_execution_time INTEGER, -- milliseconds
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_node_functions_type ON consensus.node_functions(node_type);
CREATE INDEX idx_node_functions_category ON consensus.node_functions(category);
CREATE INDEX idx_node_functions_enabled ON consensus.node_functions(enabled);

-- Node function execution logs
CREATE TABLE IF NOT EXISTS consensus.function_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    function_id VARCHAR(100) REFERENCES consensus.node_functions(id),
    node_id VARCHAR(66) REFERENCES consensus.nodes(id),
    success BOOLEAN NOT NULL,
    result JSONB,
    error TEXT,
    execution_time INTEGER, -- milliseconds
    executed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_function_executions_function ON consensus.function_executions(function_id);
CREATE INDEX idx_function_executions_node ON consensus.function_executions(node_id);
CREATE INDEX idx_function_executions_time ON consensus.function_executions(executed_at DESC);
CREATE INDEX idx_function_executions_success ON consensus.function_executions(success);

-- Inter-node coordination messages
CREATE TABLE IF NOT EXISTS consensus.coordination_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_node VARCHAR(66) REFERENCES consensus.nodes(id),
    to_nodes VARCHAR(66)[], -- Array of node IDs
    message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('REQUEST', 'RESPONSE', 'BROADCAST', 'ALERT')),
    payload JSONB NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP,
    processed_by VARCHAR(66)[]
);

CREATE INDEX idx_coordination_from ON consensus.coordination_messages(from_node);
CREATE INDEX idx_coordination_type ON consensus.coordination_messages(message_type);
CREATE INDEX idx_coordination_created ON consensus.coordination_messages(created_at DESC);

-- Node health monitoring
CREATE TABLE IF NOT EXISTS consensus.node_health (
    node_id VARCHAR(66) REFERENCES consensus.nodes(id),
    node_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    uptime BIGINT DEFAULT 0,
    last_heartbeat TIMESTAMP NOT NULL,
    active_functions INTEGER DEFAULT 0,
    queued_tasks INTEGER DEFAULT 0,
    cpu_usage DECIMAL(5, 2),
    memory_usage DECIMAL(5, 2),
    network_usage DECIMAL(10, 2),
    disk_usage DECIMAL(5, 2),
    recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, recorded_at)
);

CREATE INDEX idx_node_health_node ON consensus.node_health(node_id);
CREATE INDEX idx_node_health_recorded ON consensus.node_health(recorded_at DESC);
CREATE INDEX idx_node_health_status ON consensus.node_health(status);

-- ============================================================================
-- Seed Data: Node Functions
-- ============================================================================

-- Oracle Node Functions (15)
INSERT INTO consensus.node_functions (id, name, description, node_type, category, priority) VALUES
('oracle_price_feed', 'Price Feed Aggregation', 'Aggregate price data from multiple exchanges', 'ORACLE', 'data_collection', 100),
('oracle_market_data', 'Market Data Collection', 'Collect and normalize market data', 'ORACLE', 'data_collection', 90),
('oracle_orderbook', 'Order Book Monitoring', 'Monitor order book depth and changes', 'ORACLE', 'data_collection', 80),
('oracle_trade_stream', 'Trade Data Streaming', 'Stream real-time trade data', 'ORACLE', 'data_collection', 85),
('oracle_liquidity', 'Liquidity Analysis', 'Analyze market liquidity across venues', 'ORACLE', 'analysis', 70),
('oracle_spread', 'Spread Calculation', 'Calculate bid-ask spreads', 'ORACLE', 'analysis', 60),
('oracle_volume', 'Volume Tracking', 'Track trading volume metrics', 'ORACLE', 'analysis', 65),
('oracle_depth', 'Market Depth Analysis', 'Analyze market depth and liquidity', 'ORACLE', 'analysis', 70),
('oracle_arbitrage', 'Cross-Exchange Arbitrage Detection', 'Detect arbitrage opportunities', 'ORACLE', 'analysis', 75),
('oracle_funding', 'Funding Rate Monitoring', 'Monitor perpetual funding rates', 'ORACLE', 'monitoring', 60),
('oracle_open_interest', 'Open Interest Tracking', 'Track derivatives open interest', 'ORACLE', 'monitoring', 55),
('oracle_liquidations', 'Liquidation Data', 'Collect liquidation events', 'ORACLE', 'monitoring', 65),
('oracle_gas', 'Gas Price Oracle', 'Monitor blockchain gas prices', 'ORACLE', 'monitoring', 50),
('oracle_network', 'Network Congestion Monitoring', 'Monitor network congestion', 'ORACLE', 'monitoring', 45),
('oracle_validation', 'Data Quality Validation', 'Validate data quality and accuracy', 'ORACLE', 'validation', 80)
ON CONFLICT (id) DO NOTHING;

-- Guardian Node Functions (20)
INSERT INTO consensus.node_functions (id, name, description, node_type, category, priority) VALUES
('guardian_risk_monitor', 'Real-time Risk Monitoring', 'Monitor risk metrics in real-time', 'GUARDIAN', 'monitoring', 100),
('guardian_position_limits', 'Position Limit Enforcement', 'Enforce position size limits', 'GUARDIAN', 'enforcement', 95),
('guardian_drawdown', 'Drawdown Tracking', 'Track and alert on drawdowns', 'GUARDIAN', 'monitoring', 90),
('guardian_exposure', 'Exposure Analysis', 'Analyze portfolio exposure', 'GUARDIAN', 'analysis', 85),
('guardian_correlation', 'Correlation Monitoring', 'Monitor asset correlations', 'GUARDIAN', 'monitoring', 75),
('guardian_liquidity_risk', 'Liquidity Risk Assessment', 'Assess liquidity risk', 'GUARDIAN', 'assessment', 80),
('guardian_counterparty', 'Counterparty Risk Tracking', 'Track counterparty risk', 'GUARDIAN', 'monitoring', 70),
('guardian_emergency', 'Emergency Shutdown Trigger', 'Trigger emergency shutdowns', 'GUARDIAN', 'emergency', 100),
('guardian_circuit_breaker', 'Circuit Breaker Activation', 'Activate circuit breakers', 'GUARDIAN', 'emergency', 95),
('guardian_anomaly', 'Anomaly Detection', 'Detect trading anomalies', 'GUARDIAN', 'detection', 85),
('guardian_fraud', 'Fraud Detection', 'Detect fraudulent activity', 'GUARDIAN', 'detection', 90),
('guardian_compliance', 'Compliance Monitoring', 'Monitor regulatory compliance', 'GUARDIAN', 'compliance', 80),
('guardian_reporting', 'Regulatory Reporting', 'Generate regulatory reports', 'GUARDIAN', 'compliance', 70),
('guardian_audit', 'Audit Trail Generation', 'Generate audit trails', 'GUARDIAN', 'compliance', 75),
('guardian_alerts', 'Alert Management', 'Manage and route alerts', 'GUARDIAN', 'management', 85),
('guardian_incident', 'Incident Response', 'Coordinate incident response', 'GUARDIAN', 'emergency', 90),
('guardian_recovery', 'Recovery Coordination', 'Coordinate system recovery', 'GUARDIAN', 'emergency', 85),
('guardian_health', 'Health Check Monitoring', 'Monitor system health', 'GUARDIAN', 'monitoring', 80),
('guardian_performance', 'Performance Degradation Detection', 'Detect performance issues', 'GUARDIAN', 'detection', 75),
('guardian_integrity', 'System Integrity Verification', 'Verify system integrity', 'GUARDIAN', 'validation', 80)
ON CONFLICT (id) DO NOTHING;

-- Validator Node Functions (20)
INSERT INTO consensus.node_functions (id, name, description, node_type, category, priority) VALUES
('validator_tx_validation', 'Transaction Validation', 'Validate transactions', 'VALIDATOR', 'validation', 100),
('validator_block_proposal', 'Block Proposal', 'Propose new blocks', 'VALIDATOR', 'consensus', 95),
('validator_consensus', 'Consensus Participation', 'Participate in consensus', 'VALIDATOR', 'consensus', 100),
('validator_vote', 'Vote Casting', 'Cast consensus votes', 'VALIDATOR', 'consensus', 90),
('validator_proposal_create', 'Proposal Creation', 'Create governance proposals', 'VALIDATOR', 'governance', 80),
('validator_governance', 'Governance Participation', 'Participate in governance', 'VALIDATOR', 'governance', 85),
('validator_stake', 'Stake Management', 'Manage validator stake', 'VALIDATOR', 'management', 75),
('validator_rewards', 'Reward Distribution', 'Distribute validator rewards', 'VALIDATOR', 'management', 70),
('validator_slashing', 'Slashing Enforcement', 'Enforce slashing penalties', 'VALIDATOR', 'enforcement', 90),
('validator_coordination', 'Network Coordination', 'Coordinate with other validators', 'VALIDATOR', 'coordination', 85),
('validator_peer_discovery', 'Peer Discovery', 'Discover network peers', 'VALIDATOR', 'networking', 70),
('validator_broadcast', 'Message Broadcasting', 'Broadcast messages to network', 'VALIDATOR', 'networking', 75),
('validator_sync', 'State Synchronization', 'Synchronize network state', 'VALIDATOR', 'networking', 80),
('validator_checkpoint', 'Checkpoint Creation', 'Create state checkpoints', 'VALIDATOR', 'consensus', 75),
('validator_finality', 'Finality Confirmation', 'Confirm transaction finality', 'VALIDATOR', 'consensus', 85),
('validator_fork', 'Fork Resolution', 'Resolve blockchain forks', 'VALIDATOR', 'consensus', 90),
('validator_upgrade', 'Network Upgrade Coordination', 'Coordinate network upgrades', 'VALIDATOR', 'management', 70),
('validator_params', 'Protocol Parameter Updates', 'Update protocol parameters', 'VALIDATOR', 'governance', 75),
('validator_emergency', 'Emergency Protocol Changes', 'Execute emergency changes', 'VALIDATOR', 'emergency', 95),
('validator_health', 'Network Health Reporting', 'Report network health', 'VALIDATOR', 'monitoring', 65)
ON CONFLICT (id) DO NOTHING;

-- Grant permissions on new schema
GRANT USAGE ON SCHEMA users TO noderr;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA users TO noderr;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA users TO noderr;

-- Add comments
COMMENT ON SCHEMA users IS 'User applications, NFTs, and credentials';
COMMENT ON TABLE users.applications IS 'User applications from Typeform';
COMMENT ON TABLE users.nfts IS 'Utility NFTs for node operators';
COMMENT ON TABLE users.credentials IS 'Encrypted node credentials';
COMMENT ON TABLE users.authorizations IS 'Node authorization records';
COMMENT ON TABLE consensus.node_functions IS 'Catalog of node functions by type';
COMMENT ON TABLE consensus.function_executions IS 'Node function execution logs';
COMMENT ON TABLE consensus.coordination_messages IS 'Inter-node coordination messages';
COMMENT ON TABLE consensus.node_health IS 'Node health monitoring data';

-- Database extension complete
SELECT 'Noderr database schema extended with node type system' as status;

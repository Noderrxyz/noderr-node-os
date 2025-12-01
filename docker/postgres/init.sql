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

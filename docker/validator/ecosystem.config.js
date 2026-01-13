/**
 * PM2 Ecosystem Configuration - Validator Node
 * 
 * RESTRUCTURED: Validator is now the LIGHTEST tier (Tier 2)
 * 
 * Services running on Validator:
 * - on-chain-service: On-chain validation and transaction submission
 * - validator-consensus: Validator consensus participation
 * - market-data: Market data relay (reduced scope)
 * - data-connectors: Basic data connectors (reduced scope)
 * - telemetry: Performance monitoring
 * - heartbeat-client: Network heartbeat
 * 
 * Total Memory: ~5.3 GB
 * Total CPU: ~4 cores
 * 
 * REMOVED (migrated to Guardian):
 * - execution
 * - autonomous-execution
 * - floor-engine
 * - integration-layer
 * - system-orchestrator
 * - exchanges (full version)
 * - compliance
 */

module.exports = {
  apps: [
    // Core Validator Service - On-Chain Operations
    {
      name: 'on-chain-service',
      script: 'packages/on-chain-service/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/on-chain-service-error.log',
      out_file: '/app/logs/on-chain-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'on-chain-service'
      }
    },
    
    // Validator Consensus - Network Consensus Participation
    {
      name: 'validator-consensus',
      script: 'packages/validator-consensus/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
      error_file: '/app/logs/validator-consensus-error.log',
      out_file: '/app/logs/validator-consensus-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'validator-consensus'
      }
    },
    
    // Market Data - Reduced Scope for Relay Only
    {
      name: 'market-data',
      script: 'packages/market-data/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
      error_file: '/app/logs/market-data-error.log',
      out_file: '/app/logs/market-data-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'market-data',
        VALIDATOR_MODE: 'true',
        REDUCED_SCOPE: 'true'
      }
    },
    
    // Data Connectors - Basic Connectors Only
    {
      name: 'data-connectors',
      script: 'packages/data-connectors/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '512M',
      error_file: '/app/logs/data-connectors-error.log',
      out_file: '/app/logs/data-connectors-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'data-connectors',
        VALIDATOR_MODE: 'true',
        REDUCED_SCOPE: 'true'
      }
    },
    
    // Telemetry - Performance Monitoring
    {
      name: 'telemetry',
      script: 'packages/telemetry/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '512M',
      error_file: '/app/logs/telemetry-error.log',
      out_file: '/app/logs/telemetry-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'telemetry'
      }
    },
    
    // Heartbeat Client - Network Presence
    {
      name: 'heartbeat-client',
      script: 'packages/heartbeat-client/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '256M',
      error_file: '/app/logs/heartbeat-error.log',
      out_file: '/app/logs/heartbeat-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'heartbeat-client',
        HEARTBEAT_INTERVAL: '60000'
      }
    }
  ],
  
  // PM2 Deploy Configuration
  deploy: {
    production: {
      user: 'noderr',
      host: 'localhost',
      ref: 'origin/master',
      repo: 'git@github.com:Noderrxyz/noderr-node-os.git',
      path: '/app',
      'post-deploy': 'pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production'
    }
  }
};

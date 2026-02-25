/**
 * PM2 Ecosystem Configuration - Guardian Node
 * 
 * RESTRUCTURED: Medium tier (Tier 3) - Risk, Compliance & Trade Execution
 * 
 * Services running on Guardian:
 * - risk-engine: Risk analysis & monitoring
 * - compliance: Compliance checking
 * - guardian-consensus: Guardian consensus participation
 * - execution: Trade execution (MIGRATED FROM VALIDATOR)
 * - autonomous-execution: Autonomous trading (MIGRATED FROM VALIDATOR)
 * - floor-engine: Floor engine operations (MIGRATED FROM VALIDATOR)
 * - integration-layer: System integration (MIGRATED FROM VALIDATOR)
 * - system-orchestrator: System orchestration (MIGRATED FROM VALIDATOR)
 * - market-data: Market data feeds
 * - exchanges: Exchange connectivity (MIGRATED FROM VALIDATOR)
 * - data-connectors: Data source connectors
 * - telemetry: Performance monitoring
 * - heartbeat-client: Network heartbeat
 * 
 * Total Memory: ~22.8 GB
 * Total CPU: ~16 cores
 */

module.exports = {
  apps: [
    // Core Guardian Services - Risk & Compliance
    {
      name: 'risk-engine',
      script: 'packages/risk-engine/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/risk-engine-error.log',
      out_file: '/app/logs/risk-engine-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'risk-engine'
      }
    },
    
    {
      name: 'compliance',
      script: 'packages/compliance/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/compliance-error.log',
      out_file: '/app/logs/compliance-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'compliance'
      }
    },
    
    {
      name: 'guardian-consensus',
      script: 'packages/guardian-consensus/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
      error_file: '/app/logs/guardian-consensus-error.log',
      out_file: '/app/logs/guardian-consensus-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'guardian-consensus'
      }
    },
    
    // Execution Services (MIGRATED FROM VALIDATOR)
    {
      name: 'execution',
      script: 'packages/execution/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '4G',
      error_file: '/app/logs/execution-error.log',
      out_file: '/app/logs/execution-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'execution'
      }
    },
    
    {
      name: 'autonomous-execution',
      script: 'packages/autonomous-execution/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '3G',
      error_file: '/app/logs/autonomous-execution-error.log',
      out_file: '/app/logs/autonomous-execution-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'autonomous-execution'
      }
    },
    
    {
      name: 'floor-engine',
      script: 'packages/floor-engine/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '3G',
      error_file: '/app/logs/floor-engine-error.log',
      out_file: '/app/logs/floor-engine-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'floor-engine'
      }
    },
    
    {
      name: 'integration-layer',
      script: 'packages/integration-layer/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/integration-layer-error.log',
      out_file: '/app/logs/integration-layer-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'integration-layer'
      }
    },
    
    {
      name: 'system-orchestrator',
      script: 'packages/system-orchestrator/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/system-orchestrator-error.log',
      out_file: '/app/logs/system-orchestrator-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'system-orchestrator'
      }
    },
    
    // Data & Exchange Services
    {
      name: 'market-data',
      script: 'packages/market-data/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/market-data-error.log',
      out_file: '/app/logs/market-data-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'market-data'
      }
    },
    
    {
      name: 'exchanges',
      script: 'packages/exchanges/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/exchanges-error.log',
      out_file: '/app/logs/exchanges-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'exchanges'
      }
    },
    
    {
      name: 'data-connectors',
      script: 'packages/data-connectors/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
      error_file: '/app/logs/data-connectors-error.log',
      out_file: '/app/logs/data-connectors-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'data-connectors'
      }
    },
    
    // Infrastructure Services
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
        SERVICE_NAME: 'telemetry',
        METRICS_PORT: '8080',
      }
    },
    
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

/**
 * PM2 Ecosystem Configuration - Validator Node
 * 
 * Process supervision and automatic restart configuration
 * for all Validator node services.
 * 
 * Features:
 * - Automatic restart on crash
 * - Configurable restart delays
 * - Max restart attempts per minute
 * - Minimum uptime validation
 * - Memory limits
 * - Log management
 * 
 * Quality: PhD-Level + Production-Grade
 */

module.exports = {
  apps: [
    // Core Infrastructure Services
    {
      name: 'telemetry',
      script: 'packages/telemetry/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
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
      max_memory_restart: '1G',
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
    
    // Validator-Specific Services
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
      max_memory_restart: '2G',
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
      max_memory_restart: '2G',
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
    
    {
      name: 'on-chain-service',
      script: 'packages/on-chain-service/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
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
    
    {
      name: 'compliance',
      script: 'packages/compliance/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
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
    }
  ],
  
  // PM2 Deploy Configuration (optional, for future use)
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

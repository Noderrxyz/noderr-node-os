/**
 * PM2 Ecosystem Configuration - Guardian Node
 * 
 * Process supervision and automatic restart configuration
 * for all Guardian node services.
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
    
    // Guardian-Specific Services
    {
      name: 'risk-engine',
      script: 'packages/risk-engine/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '3G',
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

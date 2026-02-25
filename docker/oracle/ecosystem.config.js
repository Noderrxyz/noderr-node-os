/**
 * PM2 Ecosystem Configuration - Oracle Node
 * 
 * Process supervision and automatic restart configuration
 * for all Oracle node services.
 * 
 * Features:
 * - Automatic restart on crash
 * - Configurable restart delays
 * - Max restart attempts per minute
 * - Minimum uptime validation
 * - Memory limits
 * - Log management
 */

module.exports = {
  apps: [
    // Core Infrastructure Services
    {
      name: 'telemetry',
      script: 'packages/telemetry/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,        // Wait 5 seconds before restart
      max_restarts: 10,            // Max 10 restarts per minute
      min_uptime: 10000,           // Must run 10 seconds to count as success
      max_memory_restart: '1G',    // Restart if memory exceeds 1GB
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
    
    // Oracle-Specific Services
    {
      name: 'ml-service',
      script: 'packages/ml/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 10000,        // ML service needs more time to initialize
      max_restarts: 5,             // ML crashes are more serious, limit restarts
      min_uptime: 30000,           // Must run 30 seconds (model loading time)
      max_memory_restart: '6G',    // ML service can use more memory
      error_file: '/app/logs/ml-error.log',
      out_file: '/app/logs/ml-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'ml-service',
        CUDA_VISIBLE_DEVICES: '0'  // Use first GPU
      }
    },
    
    {
      name: 'quant-research',
      script: 'packages/quant-research/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/quant-research-error.log',
      out_file: '/app/logs/quant-research-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'quant-research'
      }
    },
    
    {
      name: 'market-intel',
      script: 'packages/market-intel/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '3G',
      error_file: '/app/logs/market-intel-error.log',
      out_file: '/app/logs/market-intel-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'market-intel'
      }
    },
    
    {
      name: 'strategy',
      script: 'packages/strategy/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/strategy-error.log',
      out_file: '/app/logs/strategy-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'strategy'
      }
    },
    
    {
      name: 'capital-ai',
      script: 'packages/capital-ai/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '2G',
      error_file: '/app/logs/capital-ai-error.log',
      out_file: '/app/logs/capital-ai-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'capital-ai'
      }
    },
    
    {
      name: 'oracle-consensus',
      script: 'packages/oracle-consensus/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: 10000,
      max_memory_restart: '1G',
      error_file: '/app/logs/oracle-consensus-error.log',
      out_file: '/app/logs/oracle-consensus-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        SERVICE_NAME: 'oracle-consensus'
      }
    },
    
    // Heartbeat Client - Maintains node active status with auth-API
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

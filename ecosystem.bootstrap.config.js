/**
 * PM2 Ecosystem Configuration for Bootstrap Nodes
 * 
 * Bootstrap nodes are lightweight P2P nodes that help new nodes discover the network.
 * They don't participate in trading or consensus, only facilitate peer discovery.
 */

module.exports = {
  apps: [
    {
      name: 'p2p-bootstrap',
      script: './packages/decentralized-core/dist/bootstrap.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      watch: false,
      env: {
        NODE_ENV: 'production',
        NODE_TYPE: 'bootstrap',
        NODE_ID: process.env.NODE_ID || 'bootstrap-1',
        
        // P2P Configuration
        P2P_LISTEN_PORT: process.env.P2P_LISTEN_PORT || 4001,
        P2P_WS_PORT: process.env.P2P_WS_PORT || 4002,
        P2P_ANNOUNCE_ADDR: process.env.P2P_ANNOUNCE_ADDR || '',
        
        // Region
        REGION: process.env.REGION || 'us-east',
        
        // Disable trading and consensus
        ENABLE_TRADING: 'false',
        ENABLE_CONSENSUS: 'false',
        
        // Enable telemetry
        ENABLE_TELEMETRY: 'true',
        METRICS_PORT: process.env.METRICS_PORT || 8080
      },
      error_file: './logs/bootstrap-error.log',
      out_file: './logs/bootstrap-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'telemetry',
      script: './packages/telemetry/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        METRICS_PORT: process.env.METRICS_PORT || 8080,
        NODE_TYPE: 'bootstrap'
      },
      error_file: './logs/telemetry-error.log',
      out_file: './logs/telemetry-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

module.exports = {
  apps: [
    {
      name: 'api-gateway',
      script: 'dist/index.js',
      instances: 'max', // Use all CPU cores
      exec_mode: 'cluster', // Enable clustering
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Graceful shutdown configuration
      kill_timeout: 30000, // Wait 30s for graceful shutdown
      wait_ready: true, // Wait for app to signal ready
      listen_timeout: 10000, // 10s to start listening
      // Logging
      error_file: 'logs/api-gateway-error.log',
      out_file: 'logs/api-gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
};

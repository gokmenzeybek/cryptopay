/**
 * PM2 Ecosystem Configuration
 * Production process management for CryptoPay
 */

module.exports = {
  apps: [
    {
      name: 'cryptopay',
      script: 'server.production.js',
      // Cluster mode: use all CPU cores. Requires Redis for cross-node WS delivery
      // and shared rate-limit store. Set PM2_INSTANCES to limit core usage.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',

      // Environment: default to production so an unqualified `pm2 start` is safe.
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      
      // Process management
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'build'],
      
      // Memory management
      max_memory_restart: '1G',
      
      // Advanced features
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Health monitoring
      health_check_grace_period: 3000,

      // Environment variables must be supplied by the host / orchestrator; PM2's
      // `env_file` option is not a valid ecosystem key for this schema.
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-username/cryptopay.git',
      path: '/var/www/cryptopay',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && npm run db:migrate && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
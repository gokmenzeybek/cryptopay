/**
 * PM2 Ecosystem Configuration
 * Production process management for CryptoPay
 */

module.exports = {
  apps: [
    {
      name: 'cryptopay',
      script: 'server.production.js',
      // WebSocket clients and in-memory rate-limit state are per-process, so run a
      // single instance. Scaling beyond one instance requires a Redis-backed WS adapter
      // and shared rate-limit store — out of scope for this PRD.
      instances: 1,
      exec_mode: 'fork',

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
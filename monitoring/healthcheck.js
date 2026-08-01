/**
 * CryptoPay Health Check Monitor
 * Comprehensive health monitoring for production deployment
 */

const http = require('http');
const https = require('https');
const { Pool } = require('pg');
const winston = require('winston');

// Configuration
const config = {
  app: {
    host: process.env.APP_HOST || 'localhost',
    port: process.env.APP_PORT || 5001,
    protocol: process.env.APP_PROTOCOL || 'http'
  },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'cryptopay',
    user: process.env.POSTGRES_USER || 'cryptopay',
    // No hardcoded default: must come from the environment.
    password: process.env.POSTGRES_PASSWORD
  },
  monitoring: {
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000,
    retries: 3
  }
};

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/healthcheck.log' }),
    new winston.transports.Console()
  ]
});

// Database connection pool
const dbPool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

/**
 * Health check results
 */
let healthStatus = {
  overall: 'unknown',
  timestamp: new Date().toISOString(),
  checks: {
    application: { status: 'unknown', responseTime: 0, error: null },
    database: { status: 'unknown', responseTime: 0, error: null },
    memory: { status: 'unknown', usage: 0, error: null },
    disk: { status: 'unknown', usage: 0, error: null }
  }
};

/**
 * Check application health
 */
async function checkApplication() {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = config.app.protocol === 'https' ? https : http;
    
    const options = {
      hostname: config.app.host,
      port: config.app.port,
      path: '/api/health',
      method: 'GET',
      timeout: config.monitoring.timeout
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const responseTime = Date.now() - start;
        
        try {
          const healthData = JSON.parse(data);
          
          if (res.statusCode === 200 && healthData.status === 'healthy') {
            resolve({
              status: 'healthy',
              responseTime,
              data: healthData
            });
          } else {
            resolve({
              status: 'unhealthy',
              responseTime,
              error: `HTTP ${res.statusCode}: ${healthData.message || 'Unknown error'}`
            });
          }
        } catch (error) {
          resolve({
            status: 'unhealthy',
            responseTime,
            error: `Invalid JSON response: ${error.message}`
          });
        }
      });
    });
    
    req.on('error', (error) => {
      const responseTime = Date.now() - start;
      resolve({
        status: 'unhealthy',
        responseTime,
        error: error.message
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const responseTime = Date.now() - start;
      resolve({
        status: 'unhealthy',
        responseTime,
        error: 'Request timeout'
      });
    });
    
    req.end();
  });
}

/**
 * Check database health
 */
async function checkDatabase() {
  const start = Date.now();
  
  try {
    const client = await dbPool.connect();
    
    // Test basic query
    const result = await client.query('SELECT 1 as test');
    client.release();
    
    const responseTime = Date.now() - start;
    
    if (result.rows[0].test === 1) {
      return {
        status: 'healthy',
        responseTime
      };
    } else {
      return {
        status: 'unhealthy',
        responseTime,
        error: 'Unexpected query result'
      };
    }
  } catch (error) {
    const responseTime = Date.now() - start;
    return {
      status: 'unhealthy',
      responseTime,
      error: error.message
    };
  }
}

/**
 * Check memory usage
 */
function checkMemory() {
  try {
    const usage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = (usedMemory / totalMemory) * 100;
    
    return {
      status: memoryUsagePercent > 90 ? 'critical' : memoryUsagePercent > 80 ? 'warning' : 'healthy',
      usage: memoryUsagePercent,
      details: {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
        rss: Math.round(usage.rss / 1024 / 1024),
        systemTotal: Math.round(totalMemory / 1024 / 1024),
        systemUsed: Math.round(usedMemory / 1024 / 1024)
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      usage: 0,
      error: error.message
    };
  }
}

/**
 * Check disk usage
 */
function checkDisk() {
  try {
    const fs = require('fs');
    const stats = fs.statSync('.');
    const diskUsage = require('os').platform() === 'win32' ? 
      require('win-disk-info').getDiskInfoSync() : 
      require('node-disk-info').getDiskInfoSync();
    
    // For simplicity, we'll just check if we can write to the current directory
    const testFile = 'healthcheck-test.tmp';
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    return {
      status: 'healthy',
      usage: 0, // Would need more complex logic for actual disk usage
      details: {
        writable: true,
        platform: require('os').platform()
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      usage: 0,
      error: error.message
    };
  }
}

/**
 * Run all health checks
 */
async function runHealthChecks() {
  logger.info('Running health checks...');
  
  const checks = await Promise.allSettled([
    checkApplication(),
    checkDatabase(),
    Promise.resolve(checkMemory()),
    Promise.resolve(checkDisk())
  ]);
  
  const [appResult, dbResult, memResult, diskResult] = checks;
  
  // Update health status
  healthStatus.timestamp = new Date().toISOString();
  healthStatus.checks.application = appResult.status === 'fulfilled' ? appResult.value : { status: 'unhealthy', error: appResult.reason?.message };
  healthStatus.checks.database = dbResult.status === 'fulfilled' ? dbResult.value : { status: 'unhealthy', error: dbResult.reason?.message };
  healthStatus.checks.memory = memResult.status === 'fulfilled' ? memResult.value : { status: 'unhealthy', error: memResult.reason?.message };
  healthStatus.checks.disk = diskResult.status === 'fulfilled' ? diskResult.value : { status: 'unhealthy', error: diskResult.reason?.message };
  
  // Determine overall status
  const allHealthy = Object.values(healthStatus.checks).every(check => check.status === 'healthy');
  const anyCritical = Object.values(healthStatus.checks).some(check => check.status === 'critical');
  const anyUnhealthy = Object.values(healthStatus.checks).some(check => check.status === 'unhealthy');
  
  if (anyCritical) {
    healthStatus.overall = 'critical';
  } else if (anyUnhealthy) {
    healthStatus.overall = 'unhealthy';
  } else if (allHealthy) {
    healthStatus.overall = 'healthy';
  } else {
    healthStatus.overall = 'warning';
  }
  
  // Log results
  logger.info('Health check completed', {
    overall: healthStatus.overall,
    checks: healthStatus.checks
  });
  
  // Send alerts if needed
  if (healthStatus.overall === 'critical' || healthStatus.overall === 'unhealthy') {
    await sendAlert();
  }
  
  return healthStatus;
}

/**
 * Send alert notification
 */
async function sendAlert() {
  const alertMessage = {
    timestamp: healthStatus.timestamp,
    status: healthStatus.overall,
    checks: healthStatus.checks,
    message: `CryptoPay health check failed: ${healthStatus.overall}`
  };
  
  logger.error('Health check alert', alertMessage);
  
  // Here you would integrate with your alerting system
  // Examples: Slack, Discord, Email, PagerDuty, etc.
  
  // Example: Send to webhook
  if (process.env.ALERT_WEBHOOK_URL) {
    try {
      const https = require('https');
      const data = JSON.stringify(alertMessage);
      
      const options = {
        hostname: new URL(process.env.ALERT_WEBHOOK_URL).hostname,
        port: 443,
        path: new URL(process.env.ALERT_WEBHOOK_URL).pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };
      
      const req = https.request(options, (res) => {
        logger.info('Alert sent successfully');
      });
      
      req.on('error', (error) => {
        logger.error('Failed to send alert', { error: error.message });
      });
      
      req.write(data);
      req.end();
    } catch (error) {
      logger.error('Error sending alert', { error: error.message });
    }
  }
}

/**
 * Get current health status
 */
function getHealthStatus() {
  return healthStatus;
}

/**
 * Start health monitoring
 */
function startMonitoring() {
  logger.info('Starting health monitoring', {
    interval: config.monitoring.interval,
    timeout: config.monitoring.timeout
  });
  
  // Run initial health check
  runHealthChecks();
  
  // Set up interval
  setInterval(runHealthChecks, config.monitoring.interval);
}

/**
 * Stop health monitoring
 */
function stopMonitoring() {
  logger.info('Stopping health monitoring');
  
  // Close database pool
  dbPool.end();
}

// Export functions
module.exports = {
  runHealthChecks,
  getHealthStatus,
  startMonitoring,
  stopMonitoring,
  checkApplication,
  checkDatabase,
  checkMemory,
  checkDisk
};

// Run if called directly
if (require.main === module) {
  startMonitoring();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    stopMonitoring();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    stopMonitoring();
    process.exit(0);
  });
}
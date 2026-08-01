/**
 * Winston Logger Configuration
 * Structured logging for production deployment
 */

const fs = require('fs');
const winston = require('winston');
const path = require('path');

// Ensure log directory exists (ephemeral filesystems like Render have no pre-created logs/)
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
      winston.format.colorize({ all: true }),
      winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}`
      )
    )
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join('logs', 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
  exitOnError: false
});

// Create a stream object with a 'write' function that will be used by morgan
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

// Add request logging helper
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length'),
    referer: req.get('Referer')
  };

  if (res.statusCode >= 400) {
    logger.error('HTTP Request Error', logData);
  } else {
    logger.http('HTTP Request', logData);
  }
};

// Add database logging helper
logger.logDatabase = (operation, table, data = {}) => {
  logger.info('Database Operation', {
    operation,
    table,
    data: JSON.stringify(data)
  });
};

// Add XRPL logging helper
logger.logXRPL = (operation, data = {}) => {
  logger.info('XRPL Operation', {
    operation,
    data: JSON.stringify(data)
  });
};

// Add P2P logging helper
logger.logP2P = (operation, data = {}) => {
  logger.info('P2P Operation', {
    operation,
    data: JSON.stringify(data)
  });
};

// Add security logging helper
logger.logSecurity = (event, data = {}) => {
  logger.warn('Security Event', {
    event,
    data: JSON.stringify(data),
    timestamp: new Date().toISOString()
  });
};

// Add performance logging helper
logger.logPerformance = (operation, duration, data = {}) => {
  logger.info('Performance', {
    operation,
    duration: `${duration}ms`,
    data: JSON.stringify(data)
  });
};

module.exports = logger;
const winston = require('winston');
const path = require('path');

// Define log levels with colors
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(logColors);

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Add stack trace for errors
    if (stack) {
      log += `\n${stack}`;
    }
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Create transports based on environment
const transports = [];

// Console transport (always enabled in development)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  );
} else {
  // Production console with limited logging
  transports.push(
    new winston.transports.Console({
      level: 'info',
      format: consoleFormat
    })
  );
}

// File transports for production
transports.push(
  // Combined log file
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    level: 'info',
    format: logFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5
  }),
  
  // Error log file
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5
  }),
  
  // HTTP requests log
  new winston.transports.File({
    filename: path.join(logsDir, 'http.log'),
    level: 'http',
    format: logFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 3
  })
);

// Create the logger
const logger = winston.createLogger({
  levels: logLevels,
  transports,
  exitOnError: false,
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: logFormat
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: logFormat
    })
  ]
});

// Add helper methods for common patterns
logger.security = (message, meta = {}) => {
  logger.warn(`[SECURITY] ${message}`, { ...meta, category: 'security' });
};

logger.tenant = (companyId, message, meta = {}) => {
  logger.info(`[TENANT:${companyId}] ${message}`, { companyId, ...meta, category: 'tenant' });
};

logger.api = (method, endpoint, statusCode, responseTime, meta = {}) => {
  logger.http(`${method} ${endpoint} ${statusCode} ${responseTime}ms`, {
    method,
    endpoint, 
    statusCode,
    responseTime,
    ...meta,
    category: 'api'
  });
};

logger.db = (operation, collection, duration, meta = {}) => {
  logger.debug(`[DB] ${operation} on ${collection} (${duration}ms)`, {
    operation,
    collection,
    duration,
    ...meta,
    category: 'database'
  });
};

logger.auth = (action, userId, success, meta = {}) => {
  const level = success ? 'info' : 'warn';
  logger[level](`[AUTH] ${action} ${success ? 'succeeded' : 'failed'} for user ${userId}`, {
    action,
    userId,
    success,
    ...meta,
    category: 'authentication'
  });
};

// Export logger
module.exports = logger;

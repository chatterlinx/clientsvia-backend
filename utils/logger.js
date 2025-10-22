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

// Add Sentry + AdminNotificationService integration for error levels
const originalError = logger.error;
logger.error = function(message, meta = {}) {
  // Call original Winston error logging
  originalError.call(this, message, meta);
  
  // Send to Sentry if available
  try {
    const { captureError } = require('./sentry');
    if (meta && meta.stack) {
      // If there's a stack trace, it's likely an Error object
      const error = new Error(message);
      error.stack = meta.stack;
      captureError(error, meta);
    } else {
      // Just capture as a message
      const { captureMessage } = require('./sentry');
      captureMessage(message, 'error', meta);
    }
  } catch (sentryError) {
    // Don't fail if Sentry isn't available
    // eslint-disable-next-line no-console
    console.warn('Failed to send error to Sentry:', sentryError.message);
  }

  // Send CRITICAL/WARNING errors to Admin Notification Center
  // This ensures all production errors are visible in the dashboard
  if (meta.notifyAdmin !== false && meta.severity && ['CRITICAL', 'WARNING'].includes(meta.severity)) {
    try {
      const AdminNotificationService = require('../services/AdminNotificationService');
      
      // Fire and forget - don't block on notification delivery
      setImmediate(() => {
        AdminNotificationService.sendAlert({
          code: meta.code || 'SYSTEM_ERROR',
          severity: meta.severity,
          companyId: meta.companyId || null,
          companyName: meta.companyName || 'System',
          message,
          details: meta.details || meta.error?.message || '',
          stackTrace: meta.stack || meta.error?.stack || null
        }).catch(notifError => {
          // Don't fail the original operation if notification fails
          // eslint-disable-next-line no-console
          console.warn('[LOGGER] Failed to send admin notification:', notifError.message);
        });
      });
    } catch (notifError) {
      // Don't fail if AdminNotificationService isn't available
      // eslint-disable-next-line no-console
      console.warn('[LOGGER] AdminNotificationService not available:', notifError.message);
    }
  }
};

// Add helper methods for common patterns
logger.security = (message, meta = {}) => {
  logger.warn(`[SECURITY] ${message}`, { ...meta, category: 'security' });
  
  // Also send security events to Sentry
  try {
    const { captureSecurityEvent } = require('./sentry');
    captureSecurityEvent(message, meta);
  } catch (sentryError) {
    // Don't fail if Sentry isn't available
  }
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

/**
 * Log company-specific errors with automatic notification to admin dashboard
 * 
 * @param {Object} params
 * @param {string} params.companyId - The company ID (MongoDB ObjectId)
 * @param {string} params.companyName - The company name (optional, will be fetched if not provided)
 * @param {string} params.code - Error code (e.g., 'TWILIO_GREETING_FAILURE')
 * @param {string} params.message - Short error message
 * @param {string} params.severity - 'CRITICAL' | 'WARNING' | 'INFO'
 * @param {Error|string} params.error - Error object or details
 * @param {Object} params.meta - Additional metadata
 * 
 * @example
 * logger.companyError({
 *   companyId: req.params.companyId,
 *   companyName: company.companyName,
 *   code: 'TWILIO_GREETING_FAILURE',
 *   message: 'Failed to generate AI greeting',
 *   severity: 'WARNING',
 *   error: err,
 *   meta: { callSid: req.body.CallSid }
 * });
 */
logger.companyError = ({
  companyId,
  companyName,
  code,
  message,
  severity = 'WARNING',
  error,
  meta = {}
}) => {
  const errorDetails = error instanceof Error ? error.message : String(error || '');
  const stackTrace = error instanceof Error ? error.stack : null;

  logger.error(`[COMPANY:${companyId}] ${message}`, {
    companyId,
    companyName,
    code,
    severity,
    details: errorDetails,
    stack: stackTrace,
    error,
    ...meta,
    category: 'company-error',
    notifyAdmin: true // Will trigger AdminNotificationService
  });
};

// Export logger
module.exports = logger;

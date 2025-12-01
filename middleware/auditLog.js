/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUDIT LOG MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatically logs data access and modifications to the AuditLog collection.
 * Required for compliance: GDPR, CCPA, SOC2, legal discovery.
 * 
 * WHAT GETS LOGGED:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Every call record viewed
 * - Every customer profile accessed
 * - Every data modification
 * - Every data export
 * - Every recording played
 * - Every search performed
 * 
 * USAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 * // Auto-log all requests to a route
 * router.get('/:companyId/calls/:callId', 
 *   authenticateJWT,
 *   authorizeCompanyAccess,
 *   auditLog.logAccess('call.viewed'),
 *   CallController.get
 * );
 * 
 * // Manual logging in controller
 * await auditLog.log({
 *   companyId,
 *   userId: req.user.id,
 *   action: 'customer.merged',
 *   targetType: 'customer',
 *   targetId: customerId,
 *   details: { mergedFrom: otherCustomerId }
 * });
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Whether to log asynchronously (don't wait for audit log to complete)
  ASYNC_LOGGING: true,
  
  // Actions that should log request body
  LOG_BODY_ACTIONS: [
    'customer.created',
    'customer.updated',
    'customer.merged',
    'settings.changed'
  ],
  
  // Actions that should log response
  LOG_RESPONSE_ACTIONS: [
    'data.exported',
    'report.generated'
  ],
  
  // Sensitive fields to mask in logs
  SENSITIVE_FIELDS: [
    'password',
    'token',
    'apiKey',
    'secret',
    'ssn',
    'socialSecurityNumber',
    'creditCard',
    'cardNumber'
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract client IP from request
 */
function getClientIp(req) {
  return req.ip || 
         req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         req.connection?.remoteAddress ||
         'unknown';
}

/**
 * Extract user agent from request
 */
function getUserAgent(req) {
  const ua = req.headers['user-agent'];
  return ua ? ua.substring(0, 500) : null;  // Limit length
}

/**
 * Mask sensitive fields in an object
 */
function maskSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const masked = { ...obj };
  
  for (const field of CONFIG.SENSITIVE_FIELDS) {
    if (field in masked) {
      masked[field] = '***MASKED***';
    }
  }
  
  return masked;
}

/**
 * Extract target info from request
 */
function extractTargetInfo(req, action) {
  const targetInfo = {
    type: null,
    id: null,
    label: null
  };
  
  // Determine target type from action
  if (action.startsWith('call.')) {
    targetInfo.type = 'call';
    targetInfo.id = req.params.callId;
    targetInfo.label = req.params.callId ? `Call #${req.params.callId}` : null;
  } else if (action.startsWith('customer.')) {
    targetInfo.type = 'customer';
    targetInfo.id = req.params.customerId || req.params.id;
    targetInfo.label = req.params.customerId ? `Customer ${req.params.customerId}` : null;
  } else if (action.startsWith('appointment.')) {
    targetInfo.type = 'appointment';
    targetInfo.id = req.params.appointmentId;
  } else if (action.startsWith('user.')) {
    targetInfo.type = 'user';
    targetInfo.id = req.params.userId;
  } else if (action.startsWith('settings.')) {
    targetInfo.type = 'settings';
  } else if (action.startsWith('analytics.') || action.startsWith('report.')) {
    targetInfo.type = 'report';
  }
  
  return targetInfo;
}

/**
 * Build details object from request
 */
function buildDetails(req, action) {
  const details = {};
  
  // Include query params for searches
  if (action.includes('searched') || action.includes('list_viewed')) {
    const { page, limit, ...searchParams } = req.query;
    if (Object.keys(searchParams).length > 0) {
      details.searchQuery = maskSensitiveData(searchParams);
    }
    if (page) details.page = page;
    if (limit) details.limit = limit;
  }
  
  // Include request body for modifications
  if (CONFIG.LOG_BODY_ACTIONS.includes(action) && req.body) {
    details.requestBody = maskSensitiveData(req.body);
  }
  
  // Include method and path
  details.method = req.method;
  details.path = req.originalUrl || req.path;
  
  return details;
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create middleware that logs a specific action
 * 
 * @param {string} action - The action to log (from AUDIT_ACTIONS)
 * @param {Object} options - Additional options
 * @returns {Function} - Express middleware
 * 
 * @example
 * router.get('/calls/:callId', auditLog.logAccess('call.viewed'), handler);
 */
function logAccess(action, options = {}) {
  const {
    targetType: overrideTargetType = null,
    getTargetId = null,
    getTargetLabel = null,
    getDetails = null
  } = options;
  
  return async (req, res, next) => {
    // Extract info
    const companyId = req.companyId || req.params.companyId;
    const user = req.user;
    
    // Build target info
    const targetInfo = extractTargetInfo(req, action);
    
    // Override if provided
    if (overrideTargetType) targetInfo.type = overrideTargetType;
    if (getTargetId) targetInfo.id = getTargetId(req);
    if (getTargetLabel) targetInfo.label = getTargetLabel(req);
    
    // Build details
    let details = buildDetails(req, action);
    if (getDetails) {
      details = { ...details, ...getDetails(req) };
    }
    
    // Create log entry
    const logEntry = {
      companyId: companyId || null,
      userId: user?._id?.toString() || user?.id || 'anonymous',
      userEmail: user?.email,
      userRole: user?.role,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      sessionId: req.sessionID || req.headers['x-session-id'],
      action,
      targetType: targetInfo.type,
      targetId: targetInfo.id,
      targetLabel: targetInfo.label,
      details,
      success: true  // Will be updated in response handler if needed
    };
    
    // Log asynchronously (don't block the request)
    if (CONFIG.ASYNC_LOGGING) {
      // Fire and forget
      AuditLog.log(logEntry).catch(err => {
        logger.error('[AUDIT_LOG] Failed to log access', {
          error: err.message,
          action,
          companyId
        });
      });
      
      next();
    } else {
      // Wait for log (slower but guaranteed)
      try {
        await AuditLog.log(logEntry);
        next();
      } catch (err) {
        logger.error('[AUDIT_LOG] Failed to log access', {
          error: err.message,
          action,
          companyId
        });
        // Don't block request on audit log failure
        next();
      }
    }
  };
}

/**
 * Create middleware that logs modifications with before/after tracking
 * 
 * @param {string} action - The action to log
 * @param {Object} options - Additional options
 * @returns {Function} - Express middleware
 */
function logModification(action, options = {}) {
  const {
    targetType: overrideTargetType = null,
    getTargetId = null,
    getBefore = null,  // Function to get "before" state
    getChangedFields = null
  } = options;
  
  return async (req, res, next) => {
    const companyId = req.companyId || req.params.companyId;
    const user = req.user;
    
    // Get before state if function provided
    let beforeState = null;
    if (getBefore) {
      try {
        beforeState = await getBefore(req);
      } catch (err) {
        logger.warn('[AUDIT_LOG] Failed to get before state', { error: err.message });
      }
    }
    
    // Store on request for after-response logging
    req._auditLogContext = {
      action,
      companyId,
      user,
      targetType: overrideTargetType || extractTargetInfo(req, action).type,
      targetId: getTargetId ? getTargetId(req) : req.params.id,
      beforeState,
      getChangedFields,
      ipAddress: getClientIp(req),
      userAgent: getUserAgent(req),
      sessionId: req.sessionID || req.headers['x-session-id']
    };
    
    // Intercept response to log with result
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      // Log the modification
      const ctx = req._auditLogContext;
      if (ctx) {
        const logEntry = {
          companyId: ctx.companyId,
          userId: ctx.user?._id?.toString() || ctx.user?.id || 'anonymous',
          userEmail: ctx.user?.email,
          userRole: ctx.user?.role,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          sessionId: ctx.sessionId,
          action: ctx.action,
          targetType: ctx.targetType,
          targetId: ctx.targetId,
          details: {
            before: ctx.beforeState,
            after: body?.data || body,
            changedFields: ctx.getChangedFields ? ctx.getChangedFields(req, body) : Object.keys(req.body || {}),
            method: req.method,
            path: req.originalUrl
          },
          success: body?.success !== false && res.statusCode < 400
        };
        
        AuditLog.log(logEntry).catch(err => {
          logger.error('[AUDIT_LOG] Failed to log modification', { error: err.message });
        });
      }
      
      return originalJson(body);
    };
    
    next();
  };
}

/**
 * Direct logging function (for use in controllers)
 * 
 * @param {Object} params - Log parameters
 * @returns {Promise<AuditLog>}
 */
async function log(params) {
  return AuditLog.log(params);
}

/**
 * Log from request context (for use in controllers)
 * 
 * @param {Object} req - Express request
 * @param {string} action - Action to log
 * @param {Object} options - Additional options
 * @returns {Promise<AuditLog>}
 */
async function logFromRequest(req, action, options = {}) {
  const {
    targetType = null,
    targetId = null,
    targetLabel = null,
    details = {},
    success = true,
    errorMessage = null
  } = options;
  
  return AuditLog.log({
    companyId: req.companyId || req.params.companyId,
    userId: req.user?._id?.toString() || req.user?.id || 'anonymous',
    userEmail: req.user?.email,
    userRole: req.user?.role,
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    sessionId: req.sessionID || req.headers['x-session-id'],
    action,
    targetType,
    targetId,
    targetLabel,
    details: {
      ...details,
      method: req.method,
      path: req.originalUrl
    },
    success,
    errorMessage
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS ERROR HANDLER FOR AUDIT LOGGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error handler that logs failed requests
 * Use as error middleware at the end of your middleware chain
 */
function errorHandler(err, req, res, next) {
  // Log the error to audit log if it's a data access error
  if (req._auditLogContext || req.companyId) {
    const ctx = req._auditLogContext || {};
    
    AuditLog.log({
      companyId: ctx.companyId || req.companyId,
      userId: req.user?._id?.toString() || 'anonymous',
      userEmail: req.user?.email,
      action: ctx.action || 'request.failed',
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      details: {
        error: err.message,
        method: req.method,
        path: req.originalUrl
      },
      success: false,
      errorMessage: err.message
    }).catch(logErr => {
      logger.error('[AUDIT_LOG] Failed to log error', { error: logErr.message });
    });
  }
  
  next(err);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Middleware factories
  logAccess,
  logModification,
  
  // Direct logging
  log,
  logFromRequest,
  
  // Error handler
  errorHandler,
  
  // Re-export action constants for convenience
  AUDIT_ACTIONS: AuditLog.AUDIT_ACTIONS,
  TARGET_TYPES: AuditLog.TARGET_TYPES
};


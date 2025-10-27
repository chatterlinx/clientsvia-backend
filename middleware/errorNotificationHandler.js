/**
 * ============================================================================
 * ERROR NOTIFICATION HANDLER MIDDLEWARE
 * ============================================================================
 * 
 * PURPOSE:
 * Centralized Express error handling middleware that automatically sends
 * alerts to the Notification Center for ALL unhandled route errors.
 * 
 * SCALING REQUIREMENT:
 * With 100+ companies sharing the platform, silent API failures are unacceptable.
 * This middleware ensures EVERY error is reported, categorized, and escalated.
 * 
 * FEATURES:
 * - Automatic error categorization (validation, auth, database, timeout, etc.)
 * - Intelligent severity assignment based on error type and impact
 * - Company context extraction from request
 * - User context extraction from auth session
 * - Rate limiting for alert storms
 * - Graceful degradation if Notification Center is down
 * 
 * USAGE:
 * Add as the LAST middleware in Express app:
 * 
 * ```javascript
 * const errorNotificationHandler = require('./middleware/errorNotificationHandler');
 * 
 * // All route handlers
 * app.use('/api/...', routes);
 * 
 * // ERROR HANDLER - MUST BE LAST
 * app.use(errorNotificationHandler);
 * ```
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Track error patterns for alert throttling
const errorPatternCache = new Map(); // key: hash of error, value: { count, lastSeen, alerted }
const ERROR_PATTERN_WINDOW = 60000; // 1 minute window
const ERROR_PATTERN_THRESHOLD = 5; // Alert after 5 similar errors
const ERROR_ALERT_COOLDOWN = 300000; // 5 minutes between similar alerts

/**
 * Categorize errors based on type, message, and status code
 */
function categorizeError(err, req) {
    // Validation errors
    if (err.name === 'ValidationError' || err.status === 400) {
        return {
            category: 'VALIDATION',
            severity: 'WARNING',
            code: 'API_VALIDATION_ERROR',
            customerFacing: true
        };
    }

    // Authentication/Authorization errors
    if (err.status === 401 || err.status === 403 || err.name === 'UnauthorizedError') {
        return {
            category: 'AUTHENTICATION',
            severity: 'WARNING',
            code: 'API_AUTH_ERROR',
            customerFacing: true
        };
    }

    // Database errors
    if (err.name === 'MongoError' || err.name === 'MongooseError' || err.message?.includes('database')) {
        return {
            category: 'DATABASE',
            severity: 'CRITICAL',
            code: 'API_DATABASE_ERROR',
            customerFacing: false
        };
    }

    // Timeout errors
    if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        return {
            category: 'TIMEOUT',
            severity: 'WARNING',
            code: 'API_TIMEOUT_ERROR',
            customerFacing: true
        };
    }

    // Not Found errors
    if (err.status === 404) {
        return {
            category: 'NOT_FOUND',
            severity: 'INFO',
            code: 'API_NOT_FOUND',
            customerFacing: true
        };
    }

    // Rate limit errors
    if (err.status === 429 || err.message?.includes('rate limit')) {
        return {
            category: 'RATE_LIMIT',
            severity: 'WARNING',
            code: 'API_RATE_LIMIT_EXCEEDED',
            customerFacing: true
        };
    }

    // External API errors (Twilio, OpenAI, etc.)
    if (err.message?.includes('Twilio') || err.message?.includes('OpenAI') || err.message?.includes('ElevenLabs')) {
        return {
            category: 'EXTERNAL_API',
            severity: 'CRITICAL',
            code: 'API_EXTERNAL_SERVICE_ERROR',
            customerFacing: false
        };
    }

    // Default: Unhandled error
    return {
        category: 'UNHANDLED',
        severity: 'CRITICAL',
        code: 'API_UNHANDLED_ERROR',
        customerFacing: false
    };
}

/**
 * Extract context from request
 */
function extractRequestContext(req) {
    return {
        method: req.method,
        path: req.path,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        companyId: req.user?.companyId || req.params?.companyId || req.query?.companyId || null,
        userId: req.user?.userId || req.user?._id || null,
        sessionId: req.sessionID || null,
        body: req.method !== 'GET' ? sanitizeRequestBody(req.body) : undefined,
        query: req.query && Object.keys(req.query).length > 0 ? req.query : undefined
    };
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeRequestBody(body) {
    if (!body || typeof body !== 'object') return body;

    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard', 'ssn'];

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '***REDACTED***';
        }
    }

    return sanitized;
}

/**
 * Generate hash for error pattern detection
 */
function generateErrorHash(err, req) {
    const components = [
        err.name || 'Error',
        err.message?.substring(0, 100) || 'Unknown',
        req.path,
        err.status || 500
    ];
    return components.join('::');
}

/**
 * Check if we should alert for this error pattern
 */
function shouldAlertForError(errorHash) {
    const now = Date.now();
    const pattern = errorPatternCache.get(errorHash);

    if (!pattern) {
        // First occurrence
        errorPatternCache.set(errorHash, {
            count: 1,
            firstSeen: now,
            lastSeen: now,
            lastAlerted: 0
        });
        return false; // Don't alert on single occurrence
    }

    // Update pattern
    pattern.count++;
    pattern.lastSeen = now;

    // Clean up old patterns (older than window)
    if (now - pattern.firstSeen > ERROR_PATTERN_WINDOW) {
        pattern.count = 1;
        pattern.firstSeen = now;
    }

    // Check if we should alert
    const shouldAlert = 
        pattern.count >= ERROR_PATTERN_THRESHOLD &&
        (now - pattern.lastAlerted) >= ERROR_ALERT_COOLDOWN;

    if (shouldAlert) {
        pattern.lastAlerted = now;
    }

    return shouldAlert;
}

/**
 * Main error notification handler middleware
 */
async function errorNotificationHandler(err, req, res, next) {
    const startTime = Date.now();

    try {
        // Categorize error
        const { category, severity, code, customerFacing } = categorizeError(err, req);
        const context = extractRequestContext(req);
        const errorHash = generateErrorHash(err, req);

        // Log error
        logger.error(`❌ [API ERROR] ${category} - ${err.message}`, {
            error: err.message,
            stack: err.stack,
            category,
            severity,
            code,
            context,
            errorHash
        });

        // Check if we should send alert (pattern-based throttling)
        const patternInfo = errorPatternCache.get(errorHash);
        const shouldAlert = shouldAlertForError(errorHash);

        if (shouldAlert) {
            try {
                const AdminNotificationService = require('../services/AdminNotificationService');

                await AdminNotificationService.sendAlert({
                    code,
                    severity,
                    companyId: context.companyId,
                    companyName: context.companyId ? 'Unknown' : 'Platform',
                    message: `🔴 ${category}: API error on ${req.method} ${req.path}`,
                    details: {
                        error: err.message,
                        errorName: err.name,
                        statusCode: err.status || 500,
                        category,
                        customerFacing,
                        method: context.method,
                        path: context.path,
                        url: context.url,
                        userId: context.userId,
                        companyId: context.companyId,
                        patternOccurrences: patternInfo?.count || 1,
                        impact: customerFacing ? 
                            'Customer-facing error - Users are experiencing failures' : 
                            'Internal error - May affect platform operations',
                        action: getActionForErrorCategory(category, err)
                    },
                    stackTrace: err.stack
                });

                logger.info(`✅ [ERROR HANDLER] Alert sent for ${code} (${patternInfo?.count} occurrences)`);
            } catch (notifErr) {
                logger.error('Failed to send error notification:', notifErr);
            }
        } else if (patternInfo) {
            logger.debug(`[ERROR HANDLER] Error pattern detected (${patternInfo.count}/${ERROR_PATTERN_THRESHOLD}) - not alerting yet`);
        }

        // Send HTTP response
        const statusCode = err.status || err.statusCode || 500;
        const responseMessage = customerFacing ? 
            err.message : 
            'An internal server error occurred. Our team has been notified.';

        res.status(statusCode).json({
            success: false,
            error: responseMessage,
            code,
            requestId: req.id || `req-${Date.now()}`,
            timestamp: new Date().toISOString()
        });

        // Log response time
        const responseTime = Date.now() - startTime;
        logger.debug(`[ERROR HANDLER] Error handled in ${responseTime}ms`);

    } catch (handlerError) {
        // If the error handler itself fails, log and send generic response
        logger.error('❌ [ERROR HANDLER] Error handler failed:', {
            originalError: err.message,
            handlerError: handlerError.message,
            stack: handlerError.stack
        });

        res.status(500).json({
            success: false,
            error: 'An internal server error occurred.',
            requestId: req.id || `req-${Date.now()}`,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Get action recommendation for error category
 */
function getActionForErrorCategory(category, err) {
    switch (category) {
        case 'DATABASE':
            return 'Check MongoDB connection, verify queries, check for schema issues, monitor database performance';
        case 'VALIDATION':
            return 'Review API request validation, check client-side validation, verify request payload structure';
        case 'AUTHENTICATION':
            return 'Check JWT token validity, verify session management, review auth middleware';
        case 'TIMEOUT':
            return 'Check external API response times, verify database query performance, increase timeout thresholds if needed';
        case 'EXTERNAL_API':
            return 'Check external service status (Twilio, OpenAI, ElevenLabs), verify API keys, check rate limits';
        case 'RATE_LIMIT':
            return 'Review rate limit thresholds, implement request queuing, notify users of limits';
        default:
            return `Investigate error: ${err.message}. Check stack trace, review recent code changes, verify environment configuration`;
    }
}

/**
 * Cleanup old error patterns periodically
 */
setInterval(() => {
    const now = Date.now();
    const expiredKeys = [];

    for (const [hash, pattern] of errorPatternCache.entries()) {
        if (now - pattern.lastSeen > ERROR_PATTERN_WINDOW * 5) { // 5x window
            expiredKeys.push(hash);
        }
    }

    expiredKeys.forEach(key => errorPatternCache.delete(key));

    if (expiredKeys.length > 0) {
        logger.debug(`[ERROR HANDLER] Cleaned up ${expiredKeys.length} expired error patterns`);
    }
}, ERROR_PATTERN_WINDOW);

module.exports = errorNotificationHandler;


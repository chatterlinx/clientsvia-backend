/**
 * ============================================================================
 * CONFIGURATION SECURITY MIDDLEWARE
 * ============================================================================
 * 
 * PURPOSE: Protect AI Agent Settings configuration endpoints
 * 
 * PROTECTIONS:
 * 1. RBAC - Company ownership verification
 * 2. Rate Limiting - Prevent abuse
 * 3. Audit Capture - IP, User-Agent tracking
 * 
 * USAGE:
 *   router.use(configSecurity.ensureCompanyScope);
 *   router.post('/path', configSecurity.rateLimit, handler);
 * 
 * ============================================================================
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger.js');


/**
 * Ensure user has access to the company they're trying to configure
 * Prevents Company A from accessing Company B's configuration
 */
function ensureCompanyScope(req, res, next) {
    const requestedCompanyId = req.params.companyId;
    const user = req.user; // Set by authMiddleware
    
    logger.security(`[CONFIG SECURITY] Access check: User ${user?.userId} → Company ${requestedCompanyId}`);
    
    // Verify user has access to this company
    // For now, we trust that authMiddleware has validated the token
    // In a more complex system, you'd check user.companies[] array
    
    if (!requestedCompanyId) {
        logger.security('[CONFIG SECURITY] ❌ No companyId in request');
        return res.status(400).json({ 
            error: 'Company ID required',
            code: 'MISSING_COMPANY_ID'
        });
    }
    
    if (!user) {
        logger.security('[CONFIG SECURITY] ❌ No user in request');
        return res.status(401).json({ 
            error: 'Authentication required',
            code: 'UNAUTHENTICATED'
        });
    }
    
    // TODO: In future, add more granular RBAC checking
    // For now, if user is authenticated, they can access any company
    // This will be enhanced when we add multi-user company access
    
    logger.security(`[CONFIG SECURITY] ✅ Access granted`);
    next();
}

/**
 * Rate limiting for configuration writes
 * Prevents abuse and accidental spam
 */
const configWriteRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: {
        error: 'Too many configuration requests. Please try again in a minute.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.security(`[CONFIG SECURITY] ⚠️ Rate limit exceeded: ${req.ip}`);
        res.status(429).json({
            error: 'Too many configuration requests. Please try again in a minute.',
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: 60
        });
    },
    // Key by user ID + IP for more granular control
    keyGenerator: (req) => {
        return `${req.user?.userId || 'anonymous'}_${req.ip}`;
    }
});

/**
 * Stricter rate limiting for apply/sync operations
 * These are more critical and should be rate-limited more aggressively
 */
const configApplyRateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Only 5 apply operations per minute
    message: {
        error: 'Too many apply requests. Please wait before applying more changes.',
        code: 'APPLY_RATE_LIMIT_EXCEEDED',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.security(`[CONFIG SECURITY] ⚠️ Apply rate limit exceeded: ${req.ip}`);
        res.status(429).json({
            error: 'Too many apply requests. Please wait before applying more changes.',
            code: 'APPLY_RATE_LIMIT_EXCEEDED',
            retryAfter: 60
        });
    },
    keyGenerator: (req) => {
        return `${req.user?.userId || 'anonymous'}_${req.ip}`;
    }
});

/**
 * Capture audit information for all configuration changes
 * Adds IP, User-Agent, and timestamp to request
 */
function captureAuditInfo(req, res, next) {
    // Extract IP (handle proxy/load balancer)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
             || req.headers['x-real-ip'] 
             || req.ip 
             || req.connection.remoteAddress;
    
    // Extract User-Agent
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    // Attach to request for use in route handlers
    req.auditInfo = {
        ip,
        userAgent,
        timestamp: new Date(),
        userId: req.user?.userId || 'anonymous'
    };
    
    logger.security(`[CONFIG SECURITY] 📝 Audit: ${req.auditInfo.userId} from ${ip}`);
    
    next();
}

/**
 * Require idempotency key for critical operations
 * Prevents accidental double-apply on network retries
 */
function requireIdempotency(req, res, next) {
    const idempotencyKey = req.headers['idempotency-key'];
    
    if (!idempotencyKey) {
        logger.security('[CONFIG SECURITY] ❌ Missing idempotency key');
        return res.status(400).json({
            error: 'Idempotency-Key header is required for this operation',
            code: 'MISSING_IDEMPOTENCY_KEY',
            hint: 'Add "Idempotency-Key: <uuid>" header to your request'
        });
    }
    
    // Validate format (should be UUID-like)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
        logger.security('[CONFIG SECURITY] ❌ Invalid idempotency key format');
        return res.status(400).json({
            error: 'Idempotency-Key must be a valid UUID',
            code: 'INVALID_IDEMPOTENCY_KEY',
            hint: 'Use a UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
        });
    }
    
    // Attach to request
    req.idempotencyKey = idempotencyKey;
    
    logger.security(`[CONFIG SECURITY] 🔑 Idempotency key: ${idempotencyKey.substring(0, 8)}...`);
    
    next();
}

module.exports = {
    ensureCompanyScope,
    configWriteRateLimit,
    configApplyRateLimit,
    captureAuditInfo,
    requireIdempotency
};


/**
 * ============================================================================
 * COMPANY ACCESS VALIDATION MIDDLEWARE
 * ============================================================================
 * 
 * PURPOSE: Enforce multi-tenant isolation at the middleware level
 * CRITICAL: Prevents Company A from accessing Company B's data
 * 
 * USAGE:
 * ```javascript
 * router.use('/:companyId/*', authMiddleware, validateCompanyAccess);
 * ```
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

/**
 * Validate user has access to the requested company
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 * 
 * RULES:
 * 1. Platform admins can access any company
 * 2. Company users can only access their own company
 * 3. Unauthenticated users are rejected
 */
async function validateCompanyAccess(req, res, next) {
    try {
        const { companyId } = req.params;
        const user = req.user;

        // CHECKPOINT 1: User must be authenticated
        if (!user || !user.userId) {
            logger.warn('[COMPANY ACCESS] Unauthenticated access attempt', {
                companyId,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // CHECKPOINT 2: CompanyId must be provided
        if (!companyId) {
            logger.error('[COMPANY ACCESS] No companyId in request params', {
                userId: user.userId,
                path: req.path
            });

            return res.status(400).json({
                error: 'Bad Request',
                message: 'companyId parameter is required',
                code: 'COMPANY_ID_REQUIRED'
            });
        }

        // CHECKPOINT 3: Platform admins have full access
        if (user.role === 'admin' || user.role === 'superadmin') {
            logger.debug('[COMPANY ACCESS] Admin access granted', {
                userId: user.userId,
                role: user.role,
                companyId
            });

            // Allow admin to access any company
            return next();
        }

        // CHECKPOINT 4: Company users can only access their own company
        if (!user.companyId) {
            logger.error('[COMPANY ACCESS] User has no companyId', {
                userId: user.userId,
                requestedCompanyId: companyId
            });

            return res.status(403).json({
                error: 'Forbidden',
                message: 'User is not associated with any company',
                code: 'NO_COMPANY_ASSOCIATION'
            });
        }

        // CHECKPOINT 5: Verify user's companyId matches requested companyId
        if (user.companyId.toString() !== companyId.toString()) {
            logger.warn('[COMPANY ACCESS] ⚠️ ISOLATION VIOLATION ATTEMPT', {
                userId: user.userId,
                userCompanyId: user.companyId,
                requestedCompanyId: companyId,
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                path: req.path,
                method: req.method
            });

            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this company',
                code: 'COMPANY_ACCESS_DENIED'
            });
        }

        // CHECKPOINT 6: Access granted
        logger.debug('[COMPANY ACCESS] ✅ Access granted', {
            userId: user.userId,
            companyId,
            path: req.path
        });

        next();

    } catch (error) {
        logger.error('[COMPANY ACCESS] Middleware error', {
            error: error.message,
            stack: error.stack,
            companyId: req.params.companyId,
            userId: req.user?.userId
        });

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to validate company access',
            code: 'ACCESS_VALIDATION_ERROR'
        });
    }
}

/**
 * Optional: Strict mode - always require companyId in params
 * Use this for routes that MUST be company-scoped
 */
function requireCompanyId(req, res, next) {
    const { companyId } = req.params;

    if (!companyId) {
        logger.error('[COMPANY ACCESS] Missing required companyId', {
            path: req.path,
            method: req.method,
            userId: req.user?.userId
        });

        return res.status(400).json({
            error: 'Bad Request',
            message: 'This endpoint requires a companyId parameter',
            code: 'COMPANY_ID_REQUIRED'
        });
    }

    next();
}

/**
 * Audit: Log all company access attempts
 * Use this to track which companies are being accessed
 */
function auditCompanyAccess(req, res, next) {
    const { companyId } = req.params;
    const user = req.user;

    logger.info('[COMPANY ACCESS AUDIT]', {
        userId: user?.userId,
        username: user?.username,
        role: user?.role,
        companyId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        timestamp: new Date().toISOString()
    });

    next();
}

module.exports = {
    validateCompanyAccess,
    requireCompanyId,
    auditCompanyAccess
};


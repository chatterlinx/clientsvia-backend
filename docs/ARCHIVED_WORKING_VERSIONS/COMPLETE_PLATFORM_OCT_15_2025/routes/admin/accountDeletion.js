/**
 * 🗑️ ADMIN ACCOUNT DELETION ROUTES
 * =================================
 * Secure admin-only routes for complete account deletion
 * Multi-step confirmation process with safety mechanisms
 * 
 * SECURITY FEATURES:
 * - Admin-only access (role verification)
 * - IP whitelist restrictions
 * - Multi-step confirmation process
 * - Audit logging of all deletion attempts
 * - Rate limiting to prevent abuse
 * - Backup creation before deletion
 * 
 * ENDPOINTS:
 * - GET /api/admin/account-deletion/analyze/:companyId - Analyze account data
 * - POST /api/admin/account-deletion/initiate/:companyId - Initiate deletion process
 * - POST /api/admin/account-deletion/confirm/:companyId - Confirm and execute deletion
 * - GET /api/admin/account-deletion/status/:deletionId - Check deletion status
 * - GET /api/admin/account-deletion/operations - List all deletion operations
 * - POST /api/admin/account-deletion/rollback/:backupId - Rollback deletion (24hr window)
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const accountDeletionService = require('../../services/accountDeletionService');
const logger = require('../../utils/logger');
const Company = require('../../models/v2Company');

// Rate limiting for deletion operations
const deletionRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Maximum 5 deletion operations per hour
    message: {
        error: 'Too many deletion attempts',
        message: 'Maximum 5 account deletions per hour allowed'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// Admin IP whitelist (configure via environment variables)
const ADMIN_IP_WHITELIST = (process.env.ADMIN_IP_WHITELIST || '').split(',').filter(ip => ip.trim());

/**
 * 🛡️ SECURITY MIDDLEWARE
 */

// Verify admin role and IP whitelist
const requireAdminAccess = (req, res, next) => {
    // Check if user is authenticated and has admin role
    if (!req.user || req.user.role !== 'admin') {
        logger.warn(`🚫 Unauthorized deletion attempt from user: ${req.user?.email || 'unknown'}`);
        return res.status(403).json({
            error: 'Access denied',
            message: 'Admin privileges required for account deletion'
        });
    }

    // Check IP whitelist if configured
    if (ADMIN_IP_WHITELIST.length > 0) {
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!ADMIN_IP_WHITELIST.includes(clientIP)) {
            logger.warn(`🚫 Deletion attempt from non-whitelisted IP: ${clientIP}`);
            return res.status(403).json({
                error: 'IP not authorized',
                message: 'Your IP address is not authorized for account deletion'
            });
        }
    }

    next();
};

// Log all deletion-related requests
const auditLogger = (req, res, next) => {
    logger.info(`🔍 Account deletion request: ${req.method} ${req.path}`, {
        user: req.user?.email,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        companyId: req.params.companyId,
        timestamp: new Date()
    });
    next();
};

/**
 * 📊 ANALYZE ACCOUNT DATA SCOPE
 * GET /api/admin/account-deletion/analyze/:companyId
 */
router.get('/analyze/:companyId', requireAdminAccess, auditLogger, async (req, res) => {
    try {
        const { companyId } = req.params;

        // Verify company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                error: 'Company not found',
                message: `Company with ID ${companyId} does not exist`
            });
        }

        // Analyze account data scope
        const analysis = await accountDeletionService.analyzeAccountData(companyId);

        logger.info(`📊 Account analysis completed for ${company.companyName}`, {
            companyId,
            totalDataPoints: analysis.totalDataPoints,
            riskLevel: analysis.riskLevel,
            adminUser: req.user.email
        });

        res.json({
            success: true,
            analysis,
            warnings: analysis.riskLevel === 'high' ? [
                'This account contains a large amount of data (>10,000 data points)',
                'Deletion may take several minutes to complete',
                'Ensure you have created a backup before proceeding'
            ] : []
        });

    } catch (error) {
        logger.error(`❌ Account analysis failed:`, error);
        res.status(500).json({
            error: 'Analysis failed',
            message: error.message
        });
    }
});

/**
 * 🚀 INITIATE DELETION PROCESS
 * POST /api/admin/account-deletion/initiate/:companyId
 */
router.post('/initiate/:companyId', requireAdminAccess, auditLogger, deletionRateLimit, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { confirmationCode, reason } = req.body;

        // Verify company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                error: 'Company not found',
                message: `Company with ID ${companyId} does not exist`
            });
        }

        // Require confirmation code (company name)
        if (confirmationCode !== company.companyName) {
            return res.status(400).json({
                error: 'Invalid confirmation',
                message: 'Confirmation code must match the company name exactly'
            });
        }

        // Require deletion reason
        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({
                error: 'Reason required',
                message: 'Deletion reason must be at least 10 characters long'
            });
        }

        // Create backup before deletion
        const backup = await accountDeletionService.createDeletionBackup(companyId);

        // Generate deletion token for final confirmation
        const deletionToken = `del_${companyId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Store deletion initiation (expires in 10 minutes)
        const initiationData = {
            companyId,
            companyName: company.companyName,
            adminUser: req.user.email,
            adminIP: req.ip,
            reason: reason.trim(),
            backup,
            deletionToken,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
        };

        // Store in memory (in production, use Redis with expiration)
        global.deletionInitiations = global.deletionInitiations || new Map();
        global.deletionInitiations.set(deletionToken, initiationData);

        logger.warn(`⚠️ Account deletion initiated for ${company.companyName}`, {
            companyId,
            adminUser: req.user.email,
            reason,
            backupId: backup.backupId,
            deletionToken
        });

        res.json({
            success: true,
            message: 'Deletion process initiated successfully',
            deletionToken,
            backup: {
                backupId: backup.backupId,
                backupPath: backup.backupPath
            },
            expiresAt: initiationData.expiresAt,
            nextStep: {
                endpoint: `/api/admin/account-deletion/confirm/${companyId}`,
                method: 'POST',
                requiredFields: ['deletionToken', 'finalConfirmation'],
                finalConfirmation: 'DELETE_ACCOUNT_PERMANENTLY'
            }
        });

    } catch (error) {
        logger.error(`❌ Deletion initiation failed:`, error);
        res.status(500).json({
            error: 'Initiation failed',
            message: error.message
        });
    }
});

/**
 * ⚠️ CONFIRM AND EXECUTE DELETION
 * POST /api/admin/account-deletion/confirm/:companyId
 */
router.post('/confirm/:companyId', requireAdminAccess, auditLogger, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { deletionToken, finalConfirmation } = req.body;

        // Verify deletion token
        global.deletionInitiations = global.deletionInitiations || new Map();
        const initiation = global.deletionInitiations.get(deletionToken);

        if (!initiation) {
            return res.status(400).json({
                error: 'Invalid deletion token',
                message: 'Deletion token not found or expired'
            });
        }

        if (initiation.companyId !== companyId) {
            return res.status(400).json({
                error: 'Token mismatch',
                message: 'Deletion token does not match company ID'
            });
        }

        if (new Date() > initiation.expiresAt) {
            global.deletionInitiations.delete(deletionToken);
            return res.status(400).json({
                error: 'Token expired',
                message: 'Deletion token has expired. Please initiate the process again'
            });
        }

        // Verify final confirmation phrase
        if (finalConfirmation !== 'DELETE_ACCOUNT_PERMANENTLY') {
            return res.status(400).json({
                error: 'Invalid confirmation',
                message: 'Final confirmation phrase must be exactly: DELETE_ACCOUNT_PERMANENTLY'
            });
        }

        // Execute the deletion
        logger.warn(`🗑️ EXECUTING ACCOUNT DELETION for ${initiation.companyName}`, {
            companyId,
            adminUser: req.user.email,
            reason: initiation.reason,
            backupId: initiation.backup.backupId
        });

        const deletionResult = await accountDeletionService.executeAccountDeletion(companyId, {
            skipBackup: true, // Already created during initiation
            adminUser: req.user.email,
            reason: initiation.reason
        });

        // Clean up initiation data
        global.deletionInitiations.delete(deletionToken);

        logger.error(`💀 ACCOUNT PERMANENTLY DELETED: ${initiation.companyName}`, {
            companyId,
            adminUser: req.user.email,
            deletionId: deletionResult.deletionId,
            totalTime: deletionResult.totalTime,
            backupId: initiation.backup.backupId
        });

        res.json({
            success: true,
            message: 'Account deleted permanently',
            deletionId: deletionResult.deletionId,
            companyName: initiation.companyName,
            totalTime: deletionResult.totalTime,
            backup: {
                backupId: initiation.backup.backupId,
                rollbackAvailableUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            }
        });

    } catch (error) {
        logger.error(`❌ Account deletion failed:`, error);
        res.status(500).json({
            error: 'Deletion failed',
            message: error.message
        });
    }
});

/**
 * 📊 CHECK DELETION STATUS
 * GET /api/admin/account-deletion/status/:deletionId
 */
router.get('/status/:deletionId', requireAdminAccess, async (req, res) => {
    try {
        const { deletionId } = req.params;
        const status = accountDeletionService.getDeletionStatus(deletionId);

        if (!status) {
            return res.status(404).json({
                error: 'Deletion not found',
                message: `Deletion operation ${deletionId} not found`
            });
        }

        res.json({
            success: true,
            status
        });

    } catch (error) {
        logger.error(`❌ Status check failed:`, error);
        res.status(500).json({
            error: 'Status check failed',
            message: error.message
        });
    }
});

/**
 * 📋 LIST ALL DELETION OPERATIONS
 * GET /api/admin/account-deletion/operations
 */
router.get('/operations', requireAdminAccess, async (req, res) => {
    try {
        const operations = accountDeletionService.getAllDeletionOperations();

        res.json({
            success: true,
            operations,
            total: operations.length
        });

    } catch (error) {
        logger.error(`❌ Operations list failed:`, error);
        res.status(500).json({
            error: 'Operations list failed',
            message: error.message
        });
    }
});

/**
 * 🔄 ROLLBACK DELETION (24-hour window)
 * POST /api/admin/account-deletion/rollback/:backupId
 */
router.post('/rollback/:backupId', requireAdminAccess, auditLogger, async (req, res) => {
    try {
        const { backupId } = req.params;
        const { confirmationReason } = req.body;

        if (!confirmationReason || confirmationReason.trim().length < 10) {
            return res.status(400).json({
                error: 'Reason required',
                message: 'Rollback reason must be at least 10 characters long'
            });
        }

        // TODO: Implement rollback functionality
        // This would restore data from the backup created during deletion
        
        logger.warn(`🔄 Account rollback requested for backup: ${backupId}`, {
            adminUser: req.user.email,
            reason: confirmationReason
        });

        res.json({
            success: false,
            message: 'Rollback functionality not yet implemented',
            note: 'Contact system administrator for manual data restoration'
        });

    } catch (error) {
        logger.error(`❌ Rollback failed:`, error);
        res.status(500).json({
            error: 'Rollback failed',
            message: error.message
        });
    }
});

module.exports = router;

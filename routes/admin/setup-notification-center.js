// ============================================================================
// ADMIN: Setup Notification Center Endpoint
// ============================================================================
// DEPRECATED: Notification Center no longer uses v2Company
// Settings are stored in AdminSettings.notificationCenter
// This endpoint now just ensures AdminSettings exists
// ============================================================================

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const v2Company = require('../../models/v2Company');
const AdminSettings = require('../../models/AdminSettings');

router.post('/admin/setup-notification-center', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.security('🔔 [SETUP] Setting up Notification Center (AdminSettings only)...');
        
        // Notification Center uses AdminSettings, NOT v2Company
        let settings = await AdminSettings.findOne({});
        
        if (!settings) {
            settings = await AdminSettings.create({
                notificationCenter: {
                    adminContacts: [],
                    twilio: {}
                }
            });
            logger.info('✅ [SETUP] AdminSettings created');
        }
        
        // Ensure notificationCenter object exists
        if (!settings.notificationCenter) {
            settings.notificationCenter = { adminContacts: [], twilio: {} };
            await settings.save();
        }
        
        res.json({
            success: true,
            action: settings.notificationCenter?.adminContacts?.length > 0 ? 'already_configured' : 'initialized',
            message: 'Notification Center ready. Configure Twilio and admin contacts in Settings tab.',
            hasAdminContacts: (settings.notificationCenter?.adminContacts?.length || 0) > 0,
            hasTwilio: !!(settings.notificationCenter?.twilio?.accountSid)
        });
        
    } catch (error) {
        logger.error('❌ [SETUP] Failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// CLEANUP: Remove ALL fake Notification Center "companies"
// ============================================================================
// These should never have been created - Notification Center is NOT a company
// ============================================================================
router.delete('/admin/setup-notification-center/cleanup', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.security('🧹 [CLEANUP] Removing ALL Notification Center fake companies...');
        
        // Find all Notification Center "companies" (they shouldn't exist)
        const fakeCompanies = await v2Company.find({
            $or: [
                { 'metadata.isNotificationCenter': true },
                { companyName: { $regex: /notification center/i } }
            ]
        });
        
        if (fakeCompanies.length === 0) {
            return res.json({
                success: true,
                message: 'No fake Notification Center companies found. Good!',
                deleted: 0
            });
        }
        
        logger.info(`🧹 [CLEANUP] Found ${fakeCompanies.length} fake companies to delete`);
        
        const deleteIds = fakeCompanies.map(c => c._id);
        const result = await v2Company.deleteMany({ _id: { $in: deleteIds } });
        
        logger.info(`✅ [CLEANUP] Deleted ${result.deletedCount} fake Notification Center companies`);
        
        res.json({
            success: true,
            message: `Deleted ${result.deletedCount} fake Notification Center companies. They should never have existed.`,
            deleted: result.deletedCount,
            deletedIds: deleteIds
        });
        
    } catch (error) {
        logger.error('❌ [CLEANUP] Failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


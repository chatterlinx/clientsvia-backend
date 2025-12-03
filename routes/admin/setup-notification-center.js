// ============================================================================
// ADMIN: Setup Notification Center Endpoint
// ============================================================================
// One-time endpoint to create the Notification Center company in production
// ============================================================================

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const v2Company = require('../../models/v2Company');

router.post('/admin/setup-notification-center', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.security('🔔 [SETUP] Setting up Notification Center...');
        
        // Check if exists - look for metadata flag OR name pattern
        let company = await v2Company.findOne({ 
            $or: [
                { 'metadata.isNotificationCenter': true },
                { companyName: { $regex: /notification center/i } }
            ]
        });
        
        if (company) {
            logger.info('📋 [SETUP] Notification Center already exists:', company._id);
            
            // Update twilioConfig if missing
            if (!company.twilioConfig?.phoneNumber) {
                logger.security('🔧 [SETUP] Fixing twilioConfig...');
                
                company.twilioConfig = {
                    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                    authToken: process.env.TWILIO_AUTH_TOKEN || '',
                    phoneNumber: '+18885222241'
                };
                
                await company.save();
                logger.security('✅ [SETUP] twilioConfig updated');
                
                return res.json({
                    success: true,
                    action: 'updated',
                    companyId: company._id,
                    message: 'Notification Center twilioConfig updated'
                });
            }
            
            return res.json({
                success: true,
                action: 'already_exists',
                companyId: company._id,
                message: 'Notification Center already properly configured'
            });
        }
        
        // Create new
        logger.info('📝 [SETUP] Creating new Notification Center...');
        
        company = await v2Company.create({
            companyName: '🔔 Admin Notification Center',
            businessName: 'Notification Center',
            businessPhone: '+18885222241',
            email: 'notifications@clientsvia.com',
            status: 'LIVE',
            
            // CRITICAL: Set twilioConfig so getCompanyByPhoneNumber finds it
            twilioConfig: {
                accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                authToken: process.env.TWILIO_AUTH_TOKEN || '',
                phoneNumber: '+18885222241'
            },
            
            metadata: {
                isNotificationCenter: true,
                purpose: 'Platform-wide admin test calls and system verification',
                createdBy: 'setup-endpoint',
                setupAt: new Date()
            }
        });
        
        logger.info('✅ [SETUP] Notification Center created:', company._id);
        
        res.json({
            success: true,
            action: 'created',
            companyId: company._id,
            message: 'Notification Center created successfully',
            instructions: 'Call +18885222241 to test'
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
// CLEANUP: Remove duplicate Notification Center companies
// ============================================================================
router.delete('/admin/setup-notification-center/cleanup', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.security('🧹 [CLEANUP] Removing duplicate Notification Centers...');
        
        // Find all Notification Center companies
        const allNotificationCenters = await v2Company.find({
            $or: [
                { 'metadata.isNotificationCenter': true },
                { companyName: { $regex: /notification center/i } }
            ]
        }).sort({ createdAt: 1 }); // Oldest first
        
        if (allNotificationCenters.length <= 1) {
            return res.json({
                success: true,
                message: 'No duplicates found',
                count: allNotificationCenters.length
            });
        }
        
        // Keep the first one (oldest), delete the rest
        const keepCompany = allNotificationCenters[0];
        const duplicates = allNotificationCenters.slice(1);
        
        logger.info(`🧹 [CLEANUP] Keeping: ${keepCompany._id} (${keepCompany.companyName})`);
        logger.info(`🧹 [CLEANUP] Deleting ${duplicates.length} duplicates...`);
        
        const deleteIds = duplicates.map(c => c._id);
        const result = await v2Company.deleteMany({ _id: { $in: deleteIds } });
        
        // Ensure the kept one has the proper metadata flag
        if (!keepCompany.metadata?.isNotificationCenter) {
            keepCompany.metadata = keepCompany.metadata || {};
            keepCompany.metadata.isNotificationCenter = true;
            await keepCompany.save();
            logger.info('✅ [CLEANUP] Added isNotificationCenter flag to kept company');
        }
        
        logger.info(`✅ [CLEANUP] Deleted ${result.deletedCount} duplicate Notification Centers`);
        
        res.json({
            success: true,
            message: `Cleaned up ${result.deletedCount} duplicate Notification Centers`,
            kept: {
                id: keepCompany._id,
                name: keepCompany.companyName
            },
            deleted: deleteIds
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


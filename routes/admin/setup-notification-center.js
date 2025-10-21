// ============================================================================
// ADMIN: Setup Notification Center Endpoint
// ============================================================================
// One-time endpoint to create the Notification Center company in production
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const v2Company = require('../../models/v2Company');

router.post('/admin/setup-notification-center', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        console.log('🔔 [SETUP] Setting up Notification Center...');
        
        // Check if exists
        let company = await v2Company.findOne({ 'metadata.isNotificationCenter': true });
        
        if (company) {
            console.log('📋 [SETUP] Notification Center already exists:', company._id);
            
            // Update twilioConfig if missing
            if (!company.twilioConfig?.phoneNumber) {
                console.log('🔧 [SETUP] Fixing twilioConfig...');
                
                company.twilioConfig = {
                    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                    authToken: process.env.TWILIO_AUTH_TOKEN || '',
                    phoneNumber: '+18885222241'
                };
                
                await company.save();
                console.log('✅ [SETUP] twilioConfig updated');
                
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
        console.log('📝 [SETUP] Creating new Notification Center...');
        
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
        
        console.log('✅ [SETUP] Notification Center created:', company._id);
        
        res.json({
            success: true,
            action: 'created',
            companyId: company._id,
            message: 'Notification Center created successfully',
            instructions: 'Call +18885222241 to test'
        });
        
    } catch (error) {
        console.error('❌ [SETUP] Failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


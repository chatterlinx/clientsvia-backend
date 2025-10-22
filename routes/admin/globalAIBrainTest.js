/**
 * ============================================================================
 * GLOBAL AI BRAIN - TEST CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE:
 * Simple endpoint to save test phone number configuration.
 * Actual Twilio routing happens in v2twilio.js (existing endpoint).
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

/**
 * POST /api/admin/global-ai-brain-test/:templateId/config
 * Save Twilio test configuration for a template
 */
router.post('/:templateId/config', authenticateJWT, async (req, res) => {
    console.log('🧠 [GLOBAL BRAIN CONFIG] Route handler started');
    console.log('🧠 [GLOBAL BRAIN CONFIG] Template ID:', req.params.templateId);
    console.log('🧠 [GLOBAL BRAIN CONFIG] Request body keys:', Object.keys(req.body));
    
    try {
        const { templateId } = req.params;
        const { enabled, phoneNumber, accountSid, authToken, notes } = req.body;
        
        console.log('🧠 [GLOBAL BRAIN CONFIG] Parsed params:', {
            templateId,
            enabled,
            phoneNumber,
            hasAccountSid: Boolean(accountSid),
            hasAuthToken: Boolean(authToken)
        });
        
        logger.info(`📞 [TEST CONFIG] Updating test config for template ${templateId}`, {
            enabled,
            phoneNumber,
            accountSid: accountSid ? `${accountSid.substring(0, 10)  }...` : 'none',
            authToken: authToken ? '***' : 'none',
            user: req.user?.email
        });
        
        // Validate phone number format if provided
        if (phoneNumber && phoneNumber.trim()) {
            if (!phoneNumber.match(/^\+\d{10,15}$/)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid phone number format. Must be E.164 format (e.g., +15551234567)'
                });
            }
            
            // Check if phone number already in use by another template
            const existing = await GlobalInstantResponseTemplate.findOne({
                'twilioTest.phoneNumber': phoneNumber,
                _id: { $ne: templateId }
            });
            
            if (existing) {
                return res.status(400).json({
                    success: false,
                    message: `Phone number already in use by template: ${existing.name}`
                });
            }
        }
        
        // Validate Twilio credentials if phone number provided
        if (phoneNumber && phoneNumber.trim()) {
            if (!accountSid || !accountSid.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Twilio Account SID is required when using a test phone number'
                });
            }
            if (!authToken || !authToken.trim()) {
                return res.status(400).json({
                    success: false,
                    message: 'Twilio Auth Token is required when using a test phone number'
                });
            }
        }
        
        // Update template
        const template = await GlobalInstantResponseTemplate.findByIdAndUpdate(
            templateId,
            {
                $set: {
                    'twilioTest.enabled': enabled || false,
                    'twilioTest.phoneNumber': phoneNumber?.trim() || null,
                    'twilioTest.accountSid': accountSid?.trim() || null,
                    'twilioTest.authToken': authToken?.trim() || null,
                    'twilioTest.notes': notes || ''
                }
            },
            { new: true }
        ).select('name version twilioTest');
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        console.log('🧠 [GLOBAL BRAIN CONFIG] Template updated successfully:', template.name);
        logger.info(`✅ [TEST CONFIG] Updated successfully for ${template.name}`);
        
        const response = {
            success: true,
            message: 'Test configuration saved successfully',
            template: {
                id: template._id,
                name: template.name,
                twilioTest: template.twilioTest
            }
        };
        
        console.log('🧠 [GLOBAL BRAIN CONFIG] Sending response:', JSON.stringify(response, null, 2));
        res.json(response);
        
    } catch (error) {
        console.error('🧠 [GLOBAL BRAIN CONFIG] ERROR:', error);
        logger.error('❌ [TEST CONFIG] Error saving config:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to save configuration'
        });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { AgentEventHooks } = require('../hooks/agentEventHooks');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');

// Initialize event hooks
const eventHooks = new AgentEventHooks();

// Get event hooks configuration for a company
router.get('/company/:companyId/config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get current configuration
        const config = {
            hooks: eventHooks.getHooks(companyId),
            analytics: eventHooks.getAnalytics(companyId),
            smsConfig: {
                enabled: process.env.TWILIO_ACCOUNT_SID ? true : false,
                accountSid: process.env.TWILIO_ACCOUNT_SID ? '***masked***' : null,
                fromNumber: process.env.TWILIO_PHONE_NUMBER || null
            },
            emailConfig: {
                enabled: process.env.SENDGRID_API_KEY ? true : false,
                apiKey: process.env.SENDGRID_API_KEY ? '***masked***' : null,
                fromEmail: process.env.SENDGRID_FROM_EMAIL || null
            }
        };

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Error getting event hooks config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Register an event hook
router.post('/company/:companyId/register', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { eventType, hookConfig } = req.body;

        if (!eventType || !hookConfig) {
            return res.status(400).json({
                success: false,
                error: 'Event type and hook configuration are required'
            });
        }

        eventHooks.registerHook(companyId, eventType, hookConfig);

        res.json({
            success: true,
            message: `Event hook registered for ${eventType}`
        });
    } catch (error) {
        console.error('Error registering event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Unregister an event hook
router.delete('/company/:companyId/unregister/:eventType', async (req, res) => {
    try {
        const { companyId, eventType } = req.params;

        eventHooks.unregisterHook(companyId, eventType);

        res.json({
            success: true,
            message: `Event hook unregistered for ${eventType}`
        });
    } catch (error) {
        console.error('Error unregistering event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test an event hook
router.post('/company/:companyId/test/:eventType', async (req, res) => {
    try {
        const { companyId, eventType } = req.params;
        const testData = req.body.testData || {};

        // Create test event data
        const eventData = {
            timestamp: new Date().toISOString(),
            companyId,
            eventType,
            details: {
                test: true,
                ...testData
            }
        };

        // Trigger the event hook
        await eventHooks.triggerEvent(eventType, eventData);

        res.json({
            success: true,
            message: `Test event triggered for ${eventType}`,
            data: eventData
        });
    } catch (error) {
        console.error('Error testing event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get event hooks analytics
router.get('/company/:companyId/analytics', async (req, res) => {
    try {
        const { companyId } = req.params;
        const analytics = eventHooks.getAnalytics(companyId);

        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting event hooks analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update SMS configuration
router.post('/company/:companyId/sms-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { accountSid, authToken, fromNumber, enabled } = req.body;

        // In a real implementation, you would save this to a database
        // For now, we'll just validate and respond
        if (enabled && (!accountSid || !authToken || !fromNumber)) {
            return res.status(400).json({
                success: false,
                error: 'Account SID, Auth Token, and From Number are required when SMS is enabled'
            });
        }

        // Update environment or database with new configuration
        // This is a simplified implementation
        console.log(`SMS config updated for company ${companyId}:`, {
            accountSid: accountSid ? '***masked***' : null,
            fromNumber,
            enabled
        });

        res.json({
            success: true,
            message: 'SMS configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating SMS config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update email configuration
router.post('/company/:companyId/email-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { apiKey, fromEmail, enabled } = req.body;

        // In a real implementation, you would save this to a database
        // For now, we'll just validate and respond
        if (enabled && (!apiKey || !fromEmail)) {
            return res.status(400).json({
                success: false,
                error: 'API Key and From Email are required when email is enabled'
            });
        }

        // Update environment or database with new configuration
        // This is a simplified implementation
        console.log(`Email config updated for company ${companyId}:`, {
            apiKey: apiKey ? '***masked***' : null,
            fromEmail,
            enabled
        });

        res.json({
            success: true,
            message: 'Email configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating email config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test SMS functionality
router.post('/company/:companyId/test-sms', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            });
        }

        const result = await smsClient.sendSMS(phoneNumber, message, {
            context: { companyId, test: true }
        });

        res.json({
            success: true,
            message: 'Test SMS sent successfully',
            data: result
        });
    } catch (error) {
        console.error('Error sending test SMS:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test email functionality
router.post('/company/:companyId/test-email', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { toEmail, subject, message } = req.body;

        if (!toEmail || !subject || !message) {
            return res.status(400).json({
                success: false,
                error: 'To email, subject, and message are required'
            });
        }

        const result = await emailClient.sendEmail(toEmail, subject, message, {
            context: { companyId, test: true }
        });

        res.json({
            success: true,
            message: 'Test email sent successfully',
            data: result
        });
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear event log with options
router.post('/company/:companyId/clear-log', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { clearType } = req.body;

        // Validate clear type
        if (!clearType || !['1', '2', '3'].includes(clearType)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid clear type. Must be 1, 2, or 3.'
            });
        }

        let message = '';
        switch (clearType) {
            case '1': // Clear recent events only
                eventHooks.clearRecentEvents(companyId);
                message = 'Recent events cleared successfully';
                break;
            case '2': // Clear all analytics data
                eventHooks.clearAllAnalytics(companyId);
                message = 'All analytics data cleared successfully';
                break;
            case '3': // Reset to defaults
                eventHooks.resetToDefaults(companyId);
                message = 'Event hooks reset to default configuration';
                break;
        }

        res.json({
            success: true,
            message: message
        });
    } catch (error) {
        console.error('Error clearing event log:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get event hooks configuration with validation
router.get('/company/:companyId/validate-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const config = {
            hooks: eventHooks.getHooks(companyId),
            analytics: eventHooks.getAnalytics(companyId),
            smsConfig: {
                enabled: process.env.TWILIO_ACCOUNT_SID ? true : false,
                configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
                accountSid: process.env.TWILIO_ACCOUNT_SID ? '***masked***' : null,
                fromNumber: process.env.TWILIO_PHONE_NUMBER || null
            },
            emailConfig: {
                enabled: process.env.SENDGRID_API_KEY ? true : false,
                configured: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
                apiKey: process.env.SENDGRID_API_KEY ? '***masked***' : null,
                fromEmail: process.env.SENDGRID_FROM_EMAIL || null
            },
            validation: {
                smsValid: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
                emailValid: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
                hooksConfigured: Object.keys(eventHooks.getHooks(companyId) || {}).length > 0
            }
        };

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Error validating event hooks config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

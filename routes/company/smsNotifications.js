/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SMS NOTIFICATIONS API ROUTES - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * API endpoints for SMS notification management.
 * 
 * ENDPOINTS:
 * - GET    /api/company/:companyId/sms-notifications/status    - Get config status
 * - GET    /api/company/:companyId/sms-notifications/stats     - Get SMS stats
 * - POST   /api/company/:companyId/sms-notifications/settings  - Update settings
 * - GET    /api/company/:companyId/sms-notifications/pending   - Get pending messages
 * - POST   /api/company/:companyId/sms-notifications/test      - Send test SMS
 * - DELETE /api/company/:companyId/sms-notifications/:smsId    - Cancel scheduled SMS
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const SMSNotificationService = require('../../services/SMSNotificationService');
const v2Company = require('../../models/v2Company');
const ScheduledSMS = require('../../models/ScheduledSMS');
const smsClient = require('../../clients/smsClient');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const { validateCompanyIdFormat } = require('../../middleware/companyAccess');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════════

router.use(authenticateJWT);

// Validate companyId format early (returns 400 if invalid format)
router.use(validateCompanyIdFormat);

// ════════════════════════════════════════════════════════════════════════════════
// STATUS & CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/sms-notifications/status
 * Get SMS notification configuration status
 * 
 * SAFE RESPONSES:
 * - 400: Invalid companyId format (handled by middleware)
 * - 404: Company not found → returns safe { enabled: false, reason: 'company_not_found' }
 * - 200: Returns config status (even if not configured)
 */
router.get('/status', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.debug('[SMS NOTIFICATIONS API] Status check', { companyId });
        
        const company = await v2Company.findById(companyId)
            .select('smsNotifications companyName twilioConfig')
            .lean();
        
        // SAFE RESPONSE: Company not found
        if (!company) {
            logger.warn('[SMS NOTIFICATIONS API] Company not found', { companyId });
            return res.status(200).json({ 
                success: true,
                enabled: false, 
                reason: 'company_not_found',
                companyId
            });
        }
        
        const config = company.smsNotifications || {};
        const hasTwilioCredentials = !!(company.twilioConfig?.accountSid && company.twilioConfig?.authToken);
        
        // SAFE RESPONSE: Not configured
        if (!config || Object.keys(config).length === 0) {
            return res.json({
                success: true,
                enabled: false,
                reason: 'not_configured',
                companyId,
                hasTwilioCredentials
            });
        }
        
        res.json({
            success: true,
            enabled: config.enabled || false,
            reason: config.enabled ? 'configured' : 'disabled',
            companyId,
            hasTwilioCredentials,
            confirmation: {
                enabled: config.confirmation?.enabled ?? true,
                hasTemplate: !!config.confirmation?.template
            },
            reminder24h: {
                enabled: config.reminder24h?.enabled ?? true,
                hasTemplate: !!config.reminder24h?.template
            },
            reminder1h: {
                enabled: config.reminder1h?.enabled ?? false,
                hasTemplate: !!config.reminder1h?.template
            },
            reminderDayOf: {
                enabled: config.reminderDayOf?.enabled ?? false,
                hasTemplate: !!config.reminderDayOf?.template
            },
            quietHours: {
                enabled: config.quietHours?.enabled ?? true,
                startTime: config.quietHours?.startTime || '21:00',
                endTime: config.quietHours?.endTime || '08:00'
            },
            replyHandling: {
                enabled: config.replyHandling?.enabled ?? true
            }
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Status check failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        // SAFE RESPONSE: Error - still return 200 with error info
        res.status(200).json({ 
            success: false, 
            enabled: false,
            reason: 'error',
            error: err.message,
            companyId: req.params.companyId
        });
    }
});

/**
 * GET /api/company/:companyId/sms-notifications/settings
 * Get full SMS notification settings
 */
router.get('/settings', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId)
            .select('smsNotifications companyName companyPhone')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        res.json({
            success: true,
            settings: company.smsNotifications || {},
            companyName: company.companyName,
            companyPhone: company.companyPhone
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Get settings failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/sms-notifications/settings
 * Update SMS notification settings
 */
router.post('/settings', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { settings } = req.body;
        
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Settings object required'
            });
        }
        
        // Build update object with dot notation for nested fields
        const updateObj = {};
        
        // Top-level enabled
        if (typeof settings.enabled === 'boolean') {
            updateObj['smsNotifications.enabled'] = settings.enabled;
        }
        
        // Confirmation settings
        if (settings.confirmation) {
            if (typeof settings.confirmation.enabled === 'boolean') {
                updateObj['smsNotifications.confirmation.enabled'] = settings.confirmation.enabled;
            }
            if (settings.confirmation.template) {
                updateObj['smsNotifications.confirmation.template'] = settings.confirmation.template;
            }
            if (typeof settings.confirmation.includeRescheduleLink === 'boolean') {
                updateObj['smsNotifications.confirmation.includeRescheduleLink'] = settings.confirmation.includeRescheduleLink;
            }
            if (typeof settings.confirmation.includeCancelLink === 'boolean') {
                updateObj['smsNotifications.confirmation.includeCancelLink'] = settings.confirmation.includeCancelLink;
            }
        }
        
        // 24h reminder settings
        if (settings.reminder24h) {
            if (typeof settings.reminder24h.enabled === 'boolean') {
                updateObj['smsNotifications.reminder24h.enabled'] = settings.reminder24h.enabled;
            }
            if (settings.reminder24h.template) {
                updateObj['smsNotifications.reminder24h.template'] = settings.reminder24h.template;
            }
        }
        
        // 1h reminder settings
        if (settings.reminder1h) {
            if (typeof settings.reminder1h.enabled === 'boolean') {
                updateObj['smsNotifications.reminder1h.enabled'] = settings.reminder1h.enabled;
            }
            if (settings.reminder1h.template) {
                updateObj['smsNotifications.reminder1h.template'] = settings.reminder1h.template;
            }
        }
        
        // Day-of reminder settings
        if (settings.reminderDayOf) {
            if (typeof settings.reminderDayOf.enabled === 'boolean') {
                updateObj['smsNotifications.reminderDayOf.enabled'] = settings.reminderDayOf.enabled;
            }
            if (settings.reminderDayOf.template) {
                updateObj['smsNotifications.reminderDayOf.template'] = settings.reminderDayOf.template;
            }
            if (settings.reminderDayOf.sendTime) {
                updateObj['smsNotifications.reminderDayOf.sendTime'] = settings.reminderDayOf.sendTime;
            }
        }
        
        // Quiet hours settings
        if (settings.quietHours) {
            if (typeof settings.quietHours.enabled === 'boolean') {
                updateObj['smsNotifications.quietHours.enabled'] = settings.quietHours.enabled;
            }
            if (settings.quietHours.startTime) {
                updateObj['smsNotifications.quietHours.startTime'] = settings.quietHours.startTime;
            }
            if (settings.quietHours.endTime) {
                updateObj['smsNotifications.quietHours.endTime'] = settings.quietHours.endTime;
            }
        }
        
        // Reply handling
        if (settings.replyHandling) {
            if (typeof settings.replyHandling.enabled === 'boolean') {
                updateObj['smsNotifications.replyHandling.enabled'] = settings.replyHandling.enabled;
            }
            if (settings.replyHandling.confirmResponse) {
                updateObj['smsNotifications.replyHandling.confirmResponse'] = settings.replyHandling.confirmResponse;
            }
            if (settings.replyHandling.rescheduleResponse) {
                updateObj['smsNotifications.replyHandling.rescheduleResponse'] = settings.replyHandling.rescheduleResponse;
            }
            if (settings.replyHandling.cancelResponse) {
                updateObj['smsNotifications.replyHandling.cancelResponse'] = settings.replyHandling.cancelResponse;
            }
        }
        
        if (Object.keys(updateObj).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid settings provided'
            });
        }
        
        await v2Company.updateOne(
            { _id: companyId },
            { $set: updateObj }
        );
        
        logger.info('[SMS NOTIFICATIONS API] Settings updated', { 
            companyId,
            updatedFields: Object.keys(updateObj)
        });
        
        res.json({
            success: true,
            message: 'Settings updated successfully',
            updatedFields: Object.keys(updateObj)
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Settings update failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/sms-notifications/toggle
 * Enable/disable SMS notifications
 */
router.post('/toggle', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'enabled (boolean) required'
            });
        }
        
        await v2Company.updateOne(
            { _id: companyId },
            { $set: { 'smsNotifications.enabled': enabled } }
        );
        
        logger.info('[SMS NOTIFICATIONS API] Toggled', { companyId, enabled });
        
        res.json({
            success: true,
            enabled,
            message: enabled ? 'SMS notifications enabled' : 'SMS notifications disabled'
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Toggle failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// STATS & MONITORING
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/sms-notifications/stats
 * Get SMS notification statistics
 */
router.get('/stats', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        const days = parseInt(req.query.days) || 30;
        
        const stats = await SMSNotificationService.getStats(companyId, days);
        
        res.json({
            success: true,
            stats
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Stats failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/company/:companyId/sms-notifications/pending
 * Get pending scheduled messages
 */
router.get('/pending', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        const pending = await SMSNotificationService.getPendingMessages(companyId, limit);
        
        res.json({
            success: true,
            count: pending.length,
            messages: pending.map(sms => ({
                id: sms._id,
                type: sms.type,
                toPhone: sms.toPhone.substring(0, 6) + '***',
                toName: sms.toName,
                scheduledFor: sms.scheduledFor,
                appointmentTime: sms.appointmentTime,
                status: sms.status,
                messagePreview: sms.message.substring(0, 100) + '...'
            }))
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Pending list failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// ACTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/company/:companyId/sms-notifications/test-email-gateway
 * Send a test SMS via email-to-SMS gateway (when Twilio A2P not ready)
 */
router.post('/test-email-gateway', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { toPhone, message, carrier } = req.body;
        
        if (!toPhone) {
            return res.status(400).json({
                success: false,
                error: 'toPhone required (10-digit number)'
            });
        }
        
        const testMessage = message || 'Test SMS from ClientsVia AI Receptionist. If you received this, email-to-SMS is working!';
        const carrierName = carrier || 'verizon';
        
        logger.info('[SMS VIA EMAIL] Test requested', { 
            toPhone: toPhone.substring(0, 6) + '****',
            carrier: carrierName
        });
        
        const result = await SMSNotificationService.sendTestViaEmail(
            toPhone,
            testMessage,
            carrierName
        );
        
        res.json({
            success: result.success,
            method: 'email_gateway',
            carrier: carrierName,
            messageId: result.messageId,
            error: result.error,
            availableCarriers: Object.keys(SMSNotificationService.CARRIER_GATEWAYS)
        });
    } catch (err) {
        logger.error('[SMS VIA EMAIL] Test failed', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/sms-notifications/test
 * Send a test SMS
 */
router.post('/test', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { toPhone, messageType } = req.body;
        
        if (!toPhone) {
            return res.status(400).json({
                success: false,
                error: 'toPhone required'
            });
        }
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        const config = company.smsNotifications || {};
        
        // Build test message
        const testData = {
            customerName: 'Test Customer',
            companyName: company.companyName || 'Test Company',
            companyPhone: company.companyPhone || '555-555-5555',
            appointmentTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
            customerAddress: '123 Test Street',
            serviceType: 'HVAC Service'
        };
        
        let template;
        switch (messageType) {
            case 'reminder24h':
                template = config.reminder24h?.template || 'Test 24h reminder: Your appointment is tomorrow at {appointmentTime}';
                break;
            case 'reminder1h':
                template = config.reminder1h?.template || 'Test 1h reminder: Your appointment is in 1 hour';
                break;
            default:
                template = config.confirmation?.template || 'Test confirmation: Your appointment with {companyName} is confirmed for {appointmentTime}';
        }
        
        const message = SMSNotificationService.populateTemplate(template, testData);
        
        const result = await smsClient.sendWithCompany({
            to: toPhone,
            body: `[TEST] ${message}`,
            company
        });
        
        logger.info('[SMS NOTIFICATIONS API] Test SMS sent', { 
            companyId, 
            toPhone: toPhone.substring(0, 6) + '***',
            messageType 
        });
        
        res.json({
            success: result.success,
            messageId: result.messageId,
            error: result.error,
            messageSent: `[TEST] ${message}`
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Test SMS failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /api/company/:companyId/sms-notifications/:smsId
 * Cancel a scheduled SMS
 */
router.delete('/:smsId', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId, smsId } = req.params;
        
        const sms = await ScheduledSMS.findOne({ _id: smsId, companyId });
        
        if (!sms) {
            return res.status(404).json({
                success: false,
                error: 'Scheduled SMS not found'
            });
        }
        
        if (sms.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Cannot cancel SMS with status: ${sms.status}`
            });
        }
        
        await sms.cancel('Cancelled by admin');
        
        logger.info('[SMS NOTIFICATIONS API] SMS cancelled', { 
            companyId, 
            smsId 
        });
        
        res.json({
            success: true,
            message: 'SMS cancelled successfully'
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Cancel failed', { 
            companyId: req.params.companyId,
            smsId: req.params.smsId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/sms-notifications/cancel-booking/:bookingId
 * Cancel all pending SMS for a booking
 */
router.post('/cancel-booking/:bookingId', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId, bookingId } = req.params;
        const { reason } = req.body;
        
        const result = await SMSNotificationService.cancelReminders(
            bookingId, 
            reason || 'Booking cancelled'
        );
        
        logger.info('[SMS NOTIFICATIONS API] Booking SMS cancelled', { 
            companyId, 
            bookingId,
            modifiedCount: result.modifiedCount
        });
        
        res.json({
            success: true,
            cancelledCount: result.modifiedCount || 0
        });
    } catch (err) {
        logger.error('[SMS NOTIFICATIONS API] Cancel booking SMS failed', { 
            companyId: req.params.companyId,
            bookingId: req.params.bookingId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

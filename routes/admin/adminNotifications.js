/* eslint-disable no-console */
// Console.log statements are intentional for monitoring and debugging notification system
// ============================================================================
// 🔔 ADMIN NOTIFICATION CENTER - API ROUTES
// ============================================================================
// Purpose: Backend API for Notification Center frontend
//
// Endpoints:
// - GET  /api/admin/notifications/status          - Tab status (GREEN/RED)
// - GET  /api/admin/notifications/dashboard       - Dashboard stats
// - GET  /api/admin/notifications/registry        - All registered notification points
// - POST /api/admin/notifications/registry/validate - Validate all points
// - GET  /api/admin/notifications/logs            - Alert log (paginated)
// - GET  /api/admin/notifications/logs/:alertId   - Single alert details
// - POST /api/admin/notifications/acknowledge     - Acknowledge alert
// - POST /api/admin/notifications/snooze          - Snooze alert
// - POST /api/admin/notifications/resolve         - Resolve alert
// - POST /api/admin/notifications/health-check    - Run health check
// - GET  /api/admin/notifications/health-history  - Health check history
//
// Related Files:
// - services/AdminNotificationService.js
// - services/AlertEscalationService.js
// - services/PlatformHealthCheckService.js
// - models/NotificationLog.js
// - models/NotificationRegistry.js
// - models/HealthCheckLog.js
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');

const NotificationLog = require('../../models/NotificationLog');
const NotificationRegistry = require('../../models/NotificationRegistry');
const HealthCheckLog = require('../../models/HealthCheckLog');
const AdminNotificationService = require('../../services/AdminNotificationService');
const AlertEscalationService = require('../../services/AlertEscalationService');
const PlatformHealthCheckService = require('../../services/PlatformHealthCheckService');

// ============================================================================
// GET NOTIFICATION CENTER STATUS (for dynamic tab coloring)
// ============================================================================

router.get('/admin/notifications/status', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        // Count unacknowledged alerts by severity
        const counts = await NotificationLog.getUnacknowledgedCount();
        
        // Determine overall status
        let overallStatus = 'healthy';
        
        if (counts.CRITICAL > 0) {
            overallStatus = 'critical';
        } else if (counts.WARNING > 0) {
            overallStatus = 'warning';
        }
        
        // Check if recent health check passed
        const recentHealthCheck = await HealthCheckLog.findOne()
            .sort({ timestamp: -1 })
            .limit(1);
        
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        if (!recentHealthCheck || recentHealthCheck.timestamp < oneHourAgo) {
            // No recent health check - possible system issue
            if (overallStatus === 'healthy') {
                overallStatus = 'warning';
            }
        } else if (recentHealthCheck.overallStatus === 'CRITICAL') {
            overallStatus = 'critical';
        } else if (recentHealthCheck.overallStatus === 'WARNING' && overallStatus === 'healthy') {
            overallStatus = 'warning';
        }
        
        res.json({
            success: true,
            overallStatus,
            unacknowledgedCount: counts.total,
            breakdown: {
                critical: counts.CRITICAL,
                warning: counts.WARNING,
                info: counts.INFO
            },
            lastHealthCheck: recentHealthCheck?.timestamp || null,
            lastHealthCheckStatus: recentHealthCheck?.overallStatus || null
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION STATUS] Error:', error);
        res.status(500).json({
            success: false,
            overallStatus: 'offline',
            unacknowledgedCount: 0,
            error: error.message
        });
    }
});

// ============================================================================
// GET DASHBOARD STATS
// ============================================================================

router.get('/admin/notifications/dashboard', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const counts = await NotificationLog.getUnacknowledgedCount();
        const validationSummary = await NotificationRegistry.getValidationSummary();
        const latestHealthCheck = await HealthCheckLog.getLatest();
        const healthTrend = await HealthCheckLog.getTrend();
        
        // Get recent alerts (last 10)
        const recentAlerts = await NotificationLog.find({
            'acknowledgment.isAcknowledged': false
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('alertId code severity companyName message createdAt escalation');
        
        res.json({
            success: true,
            data: {
                unacknowledgedAlerts: counts,
                notificationPointsValidation: validationSummary,
                latestHealthCheck,
                healthTrend24h: healthTrend,
                recentAlerts
            }
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION DASHBOARD] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET NOTIFICATION REGISTRY (all registered points)
// ============================================================================

router.get('/admin/notifications/registry', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const grouped = await NotificationRegistry.getAllGrouped();
        const summary = await NotificationRegistry.getValidationSummary();
        
        res.json({
            success: true,
            data: {
                notificationPoints: grouped,
                summary
            }
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION REGISTRY] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// VALIDATE ALL NOTIFICATION POINTS
// ============================================================================

router.post('/admin/notifications/registry/validate', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const points = await NotificationRegistry.find({ isActive: true });
        
        const results = [];
        
        for (const point of points) {
            await point.validate();
            results.push({
                code: point.code,
                isValid: point.validation.isValid,
                errors: point.validation.errors,
                warnings: point.validation.warnings
            });
        }
        
        const summary = await NotificationRegistry.getValidationSummary();
        
        res.json({
            success: true,
            data: {
                validatedCount: results.length,
                results,
                summary
            }
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION VALIDATION] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET ALERT LOGS (paginated, filtered)
// ============================================================================

router.get('/admin/notifications/logs', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            severity,
            code,
            companyId,
            acknowledged,
            resolved
        } = req.query;
        
        // Build filter
        const filter = {};
        
        if (severity) {filter.severity = severity;}
        if (code) {filter.code = code.toUpperCase();}
        if (companyId) {filter.companyId = companyId;}
        if (acknowledged !== undefined) {filter['acknowledgment.isAcknowledged'] = acknowledged === 'true';}
        if (resolved !== undefined) {filter['resolution.isResolved'] = resolved === 'true';}
        
        // Execute query
        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        
        const [logs, total] = await Promise.all([
            NotificationLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit, 10)),
            NotificationLog.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    page: parseInt(page, 10),
                    limit: parseInt(limit, 10),
                    total,
                    pages: Math.ceil(total / parseInt(limit, 10))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION LOGS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET SINGLE ALERT DETAILS
// ============================================================================

router.get('/admin/notifications/logs/:alertId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { alertId } = req.params;
        
        const alert = await NotificationLog.findOne({ alertId });
        
        if (!alert) {
            return res.status(404).json({
                success: false,
                message: 'Alert not found'
            });
        }
        
        res.json({
            success: true,
            data: alert
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION ALERT DETAILS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// ACKNOWLEDGE ALERT
// ============================================================================

router.post('/admin/notifications/acknowledge', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { alertId, acknowledgedBy } = req.body;
        
        if (!alertId || !acknowledgedBy) {
            return res.status(400).json({
                success: false,
                message: 'alertId and acknowledgedBy are required'
            });
        }
        
        const result = await AdminNotificationService.acknowledgeAlert(
            alertId,
            acknowledgedBy,
            'WEB_UI'
        );
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ [NOTIFICATION ACKNOWLEDGE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SNOOZE ALERT
// ============================================================================

router.post('/admin/notifications/snooze', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { alertId, minutes, reason } = req.body;
        
        if (!alertId || !minutes) {
            return res.status(400).json({
                success: false,
                message: 'alertId and minutes are required'
            });
        }
        
        const result = await AlertEscalationService.snoozeAlert(
            alertId,
            parseInt(minutes, 10),
            reason || ''
        );
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ [NOTIFICATION SNOOZE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// RESOLVE ALERT
// ============================================================================

router.post('/admin/notifications/resolve', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { alertId, resolvedBy, action, notes } = req.body;
        
        if (!alertId || !resolvedBy || !action) {
            return res.status(400).json({
                success: false,
                message: 'alertId, resolvedBy, and action are required'
            });
        }
        
        const alert = await NotificationLog.findOne({ alertId });
        
        if (!alert) {
            return res.status(404).json({
                success: false,
                message: 'Alert not found'
            });
        }
        
        await alert.resolve(resolvedBy, action, notes || '');
        
        res.json({
            success: true,
            data: alert
        });
        
    } catch (error) {
        console.error('❌ [NOTIFICATION RESOLVE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// RUN HEALTH CHECK
// ============================================================================

router.post('/admin/notifications/health-check', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { triggeredBy = 'manual' } = req.body;
        const triggeredByUser = req.user?.name || req.user?.email || 'admin';
        
        console.log(`🏥 [HEALTH CHECK API] Starting health check (triggered by: ${triggeredByUser})...`);
        
        // Run health check (this will take a few seconds)
        const results = await PlatformHealthCheckService.runFullHealthCheck(triggeredBy, triggeredByUser);
        
        res.json({
            success: true,
            data: results
        });
        
    } catch (error) {
        console.error('❌ [HEALTH CHECK API] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET HEALTH CHECK HISTORY
// ============================================================================

router.get('/admin/notifications/health-history', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { limit = 10, hours = 24 } = req.query;
        
        const history = await HealthCheckLog.getHistory(parseInt(limit, 10));
        const trend = await HealthCheckLog.getTrend();
        const componentSummary = await HealthCheckLog.getComponentSummary(parseInt(hours, 10));
        
        res.json({
            success: true,
            data: {
                history,
                trend24h: trend,
                componentSummary
            }
        });
        
    } catch (error) {
        console.error('❌ [HEALTH HISTORY] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET NOTIFICATION SETTINGS (Twilio + Admin Contacts)
// ============================================================================

router.get('/admin/notifications/settings', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const AdminSettings = require('../../models/AdminSettings');
        
        // Get admin settings document
        let settings = await AdminSettings.findOne({});
        
        if (!settings) {
            settings = new AdminSettings({
                notificationCenter: {
                    twilio: {
                        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
                        authToken: process.env.TWILIO_AUTH_TOKEN || '',
                        phoneNumber: process.env.TWILIO_PHONE_NUMBER || ''
                    },
                    adminContacts: []
                }
            });
            await settings.save();
            
            // CRITICAL: Clear Redis cache when creating new settings
            const redisClient = require('../../db').redisClient;
            if (redisClient && redisClient.del) {
                await redisClient.del('admin:settings:notification-center');
                console.log('✅ [NOTIFICATION SETTINGS] Redis cache cleared after initial save');
            }
        }
        
        res.json({
            success: true,
            data: {
                twilio: settings.notificationCenter?.twilio || {
                    accountSid: '',
                    authToken: '',
                    phoneNumber: ''
                },
                twilioTest: settings.notificationCenter?.twilioTest || {
                    enabled: false,
                    phoneNumber: '',
                    accountSid: '',
                    authToken: '',
                    greeting: 'This is a ClientsVia system check. Your Twilio integration is working correctly. If you can hear this message, voice webhooks are properly configured. Thank you for calling.',
                    testCallCount: 0,
                    notes: ''
                },
                adminContacts: settings.notificationCenter?.adminContacts || [],
                escalation: settings.notificationCenter?.escalation || {
                    CRITICAL: [30, 30, 30, 15, 15],
                    WARNING: [60, 60, 60],
                    INFO: [120]
                }
            }
        });
        
    } catch (error) {
        console.error('❌ [GET NOTIFICATION SETTINGS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// UPDATE NOTIFICATION SETTINGS (Twilio + Admin Contacts)
// ============================================================================

router.put('/admin/notifications/settings', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const AdminSettings = require('../../models/AdminSettings');
        const { twilio, twilioTest, adminContacts, escalation } = req.body;
        
        // Get or create admin settings document
        let settings = await AdminSettings.findOne({});
        
        if (!settings) {
            settings = new AdminSettings({
                notificationCenter: {}
            });
        }
        
        // Update Twilio credentials if provided
        if (twilio) {
            if (!settings.notificationCenter) {
                settings.notificationCenter = {};
            }
            
            settings.notificationCenter.twilio = {
                accountSid: twilio.accountSid,
                authToken: twilio.authToken,
                phoneNumber: twilio.phoneNumber
            };
            
            console.log('✅ [NOTIFICATION SETTINGS] Twilio credentials updated');
        }
        
        // Update Twilio Test config if provided (same pattern as Global Brain)
        if (twilioTest !== undefined) {
            if (!settings.notificationCenter) {
                settings.notificationCenter = {};
            }
            
            settings.notificationCenter.twilioTest = {
                enabled: twilioTest.enabled || false,
                phoneNumber: twilioTest.phoneNumber || '',
                accountSid: twilioTest.accountSid || '',
                authToken: twilioTest.authToken || '',
                greeting: twilioTest.greeting || settings.notificationCenter.twilioTest?.greeting || 'This is a ClientsVia system check. Your Twilio integration is working correctly.',
                testCallCount: settings.notificationCenter.twilioTest?.testCallCount || 0,
                lastTestedAt: settings.notificationCenter.twilioTest?.lastTestedAt,
                notes: twilioTest.notes || ''
            };
            
            console.log('✅ [NOTIFICATION SETTINGS] Twilio Test config updated');
        }
        
        // Update admin contacts if provided
        if (adminContacts) {
            if (!settings.notificationCenter) {
                settings.notificationCenter = {};
            }
            
            settings.notificationCenter.adminContacts = adminContacts;
            
            console.log(`✅ [NOTIFICATION SETTINGS] Admin contacts updated: ${adminContacts.length} contacts`);
        }
        
        // Update escalation settings if provided
        if (escalation) {
            if (!settings.notificationCenter) {
                settings.notificationCenter = {};
            }
            
            settings.notificationCenter.escalation = {
                CRITICAL: escalation.CRITICAL || [30, 30, 30, 15, 15],
                WARNING: escalation.WARNING || [60, 60, 60],
                INFO: escalation.INFO || [120]
            };
            
            console.log('✅ [NOTIFICATION SETTINGS] Escalation intervals updated');
        }
        
        settings.markModified('notificationCenter');
        await settings.save();
        
        // CRITICAL: Clear Redis cache for admin settings
        const redisClient = require('../../db').redisClient;
        if (redisClient && redisClient.del) {
            await redisClient.del('admin:settings:notification-center');
            console.log('✅ [NOTIFICATION SETTINGS] Redis cache cleared');
        }
        
        res.json({
            success: true,
            message: 'Notification settings updated successfully',
            data: {
                twilio: settings.notificationCenter?.twilio || {},
                adminContacts: settings.notificationCenter?.adminContacts || [],
                escalation: settings.notificationCenter?.escalation || {}
            }
        });
        
    } catch (error) {
        console.error('❌ [UPDATE NOTIFICATION SETTINGS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SEND TEST SMS TO ADMIN CONTACT
// ============================================================================

router.post('/admin/notifications/test-sms', authenticateJWT, requireRole('admin'), async (req, res) => {
    /* eslint-disable no-console */
    // Console logging intentional for SMS delivery testing
    
    try {
        const { recipientName, recipientPhone } = req.body;
        
        if (!recipientPhone) {
            return res.status(400).json({
                success: false,
                error: 'Recipient phone number required'
            });
        }
        
        console.log(`📱 [TEST SMS] Sending test message to ${recipientName} (${recipientPhone})...`);
        
        // Get Twilio credentials from AdminSettings
        const AdminSettings = require('../../models/AdminSettings');
        const settings = await AdminSettings.findOne({});
        
        if (!settings) {
            console.error('❌ [TEST SMS] AdminSettings document not found');
            return res.status(400).json({
                success: false,
                error: 'AdminSettings not initialized. Please save Twilio credentials in Settings tab first.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.accountSid) {
            console.error('❌ [TEST SMS] Twilio Account SID missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Account SID not configured. Please save credentials in Settings tab.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.authToken) {
            console.error('❌ [TEST SMS] Twilio Auth Token missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Auth Token not configured. Please save credentials in Settings tab.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.phoneNumber) {
            console.error('❌ [TEST SMS] Twilio Phone Number missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Phone Number not configured. Please save credentials in Settings tab.'
            });
        }
        
        console.log(`✅ [TEST SMS] Twilio credentials found:`, {
            accountSid: settings.notificationCenter.twilio.accountSid.substring(0, 10) + '...',
            phoneNumber: settings.notificationCenter.twilio.phoneNumber
        });
        
        // Create Twilio client with AdminSettings credentials
        const twilio = require('twilio');
        const twilioClient = twilio(
            settings.notificationCenter.twilio.accountSid,
            settings.notificationCenter.twilio.authToken
        );
        
        const testMessage = `
🔔 ClientsVia Test Alert

Hi ${recipientName}! This is a test message from the Notification Center.

If you received this, your SMS alerts are configured correctly! ✅

Time: ${new Date().toLocaleString()}

Reply STOP to unsubscribe.
        `.trim();
        
        console.log(`🚀 [TEST SMS] Calling Twilio API...`);
        console.log(`   From: ${settings.notificationCenter.twilio.phoneNumber}`);
        console.log(`   To: ${recipientPhone}`);
        
        const result = await twilioClient.messages.create({
            body: testMessage,
            from: settings.notificationCenter.twilio.phoneNumber,
            to: recipientPhone
        });
        
        console.log(`✅ [TEST SMS] Twilio API responded successfully!`);
        console.log(`   Twilio SID: ${result.sid}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Date Created: ${result.dateCreated}`);
        console.log(`   Price: ${result.price || 'pending'}`);
        console.log(`   Error Code: ${result.errorCode || 'none'}`);
        console.log(`   Error Message: ${result.errorMessage || 'none'}`);
        
        res.json({
            success: true,
            message: `Test SMS sent to ${recipientName}`,
            twilioSid: result.sid,
            status: result.status,
            dateCreated: result.dateCreated,
            price: result.price,
            debug: {
                from: settings.notificationCenter.twilio.phoneNumber,
                to: recipientPhone,
                messageLength: testMessage.length,
                twilioResponse: {
                    sid: result.sid,
                    status: result.status,
                    direction: result.direction,
                    apiVersion: result.apiVersion
                }
            }
        });
        
    } catch (error) {
        console.error('❌ [TEST SMS] Failed to send:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to send test SMS'
        });
    }
    
    /* eslint-enable no-console */
});

module.exports = router;

 
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
const logger = require('../../utils/logger.js');

const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { captureAuditInfo, requireIdempotency, configWriteRateLimit } = require('../../middleware/configSecurity');
const { redisClient } = require('../../clients');

// ----------------------------------------------------------------------------
// Idempotency helper: caches successful JSON responses for duplicate keys
// ----------------------------------------------------------------------------
async function respondWithIdempotency(req, res, handler, opts = {}) {
    const userId = req.user?.userId || 'admin';
    const key = req.idempotencyKey ? `admin:idemp:${userId}:${req.idempotencyKey}` : null;
    const ttlSeconds = opts.ttlSeconds || 300; // 5 minutes default

    try {
        if (key && redisClient && redisClient.isReady) {
            const cached = await redisClient.get(key);
            if (cached) {
                const parsed = JSON.parse(cached);
                // Return cached success response
                return res.json(parsed);
            }
        }

        const result = await handler();

        if (key && redisClient && redisClient.isReady) {
            try {
                await redisClient.setEx(key, ttlSeconds, JSON.stringify(result));
            } catch (cacheErr) {
                logger.warn('⚠️ [IDEMPOTENCY CACHE] Failed to store result:', cacheErr?.message);
            }
        }

        return res.json(result);
    } catch (err) {
        // Do not cache errors
        throw err;
    }
}

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
        logger.error('❌ [NOTIFICATION STATUS] Error:', error);
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
        
        // Heartbeat emit (non-blocking)
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_DASHBOARD_LOAD_OK',
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'DASHBOARD',
            eventType: 'important_event'
        }); } catch (_) {}

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
        logger.error('❌ [NOTIFICATION DASHBOARD] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_DASHBOARD_LOAD_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'DASHBOARD',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
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
        
        // Heartbeat emit (non-blocking)
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_REGISTRY_VALIDATE_OK',
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'REGISTRY',
            eventType: 'important_event'
        }); } catch (_) {}

        res.json({
            success: true,
            data: {
                notificationPoints: grouped,
                summary
            }
        });
        
    } catch (error) {
        logger.error('❌ [NOTIFICATION REGISTRY] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_REGISTRY_VALIDATE_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'REGISTRY',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// VALIDATE ALL NOTIFICATION POINTS
// ============================================================================

router.post('/admin/notifications/registry/validate', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
    try {
        await respondWithIdempotency(req, res, async () => {
            const points = await NotificationRegistry.find({ isActive: true });
            const results = [];
            for (const point of points) {
                await point.validateNotificationPoint();
                results.push({
                    code: point.code,
                    isValid: point.validation.isValid,
                    errors: point.validation.errors,
                    warnings: point.validation.warnings
                });
            }
            const summary = await NotificationRegistry.getValidationSummary();

            // Heartbeat emit (non-blocking)
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_REGISTRY_VALIDATE_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'REGISTRY',
                eventType: 'important_event'
            }); } catch (_) {}
            return {
                success: true,
                data: {
                    validatedCount: results.length,
                    results,
                    summary
                }
            };
        });
    } catch (error) {
        logger.error('❌ [NOTIFICATION VALIDATION] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_REGISTRY_VALIDATE_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'REGISTRY',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
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
        
        // Heartbeat: logs list OK (non-blocking)
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_LOGS_LIST_OK',
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'LOGS',
            eventType: 'important_event'
        }); } catch (_) {}

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
        logger.error('❌ [NOTIFICATION LOGS] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_LOGS_LIST_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'LOGS',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
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
        
        // Heartbeat: log detail OK
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_LOGS_LIST_OK',
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'LOGS',
            eventType: 'important_event'
        }); } catch (_) {}

        res.json({
            success: true,
            data: alert
        });
        
    } catch (error) {
        logger.error('❌ [NOTIFICATION ALERT DETAILS] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_LOGS_LIST_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'LOGS',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// ACKNOWLEDGE ALERT
// ============================================================================

router.post('/admin/notifications/acknowledge', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
    try {
        const { alertId, acknowledgedBy } = req.body;
        if (!alertId || !acknowledgedBy) {
            return res.status(400).json({
                success: false,
                message: 'alertId and acknowledgedBy are required'
            });
        }
        await respondWithIdempotency(req, res, async () => {
            const result = await AdminNotificationService.acknowledgeAlert(
                alertId,
                acknowledgedBy,
                'WEB_UI'
            );
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_ALERT_ACK_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'ALERT',
                eventType: 'important_event'
            }); } catch (_) {}
            return result;
        });
    } catch (error) {
        logger.error('❌ [NOTIFICATION ACKNOWLEDGE] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_ALERT_ACK_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ALERT',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SNOOZE ALERT
// ============================================================================

router.post('/admin/notifications/snooze', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
    try {
        const { alertId, minutes, reason } = req.body;
        if (!alertId || !minutes) {
            return res.status(400).json({
                success: false,
                message: 'alertId and minutes are required'
            });
        }
        await respondWithIdempotency(req, res, async () => {
            const result = await AlertEscalationService.snoozeAlert(
                alertId,
                parseInt(minutes, 10),
                reason || ''
            );
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_ALERT_SNOOZE_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'ALERT',
                eventType: 'important_event'
            }); } catch (_) {}
            return result;
        });
    } catch (error) {
        logger.error('❌ [NOTIFICATION SNOOZE] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_ALERT_SNOOZE_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ALERT',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// RESOLVE ALERT
// ============================================================================

router.post('/admin/notifications/resolve', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
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
        await respondWithIdempotency(req, res, async () => {
            await alert.resolve(resolvedBy, action, notes || '');
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_ALERT_RESOLVE_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'ALERT',
                eventType: 'important_event'
            }); } catch (_) {}
            return {
                success: true,
                data: alert
            };
        });
    } catch (error) {
        logger.error('❌ [NOTIFICATION RESOLVE] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_ALERT_RESOLVE_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ALERT',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// RUN HEALTH CHECK
// ============================================================================

router.post('/admin/notifications/health-check', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
    try {
        const t0 = Date.now();
        const { triggeredBy = 'manual' } = req.body;
        const triggeredByUser = req.user?.name || req.user?.email || 'admin';
        logger.security(`🏥 [HEALTH CHECK API] Starting health check (triggered by: ${triggeredByUser})...`);
        await respondWithIdempotency(req, res, async () => {
            const results = await PlatformHealthCheckService.runFullHealthCheck(triggeredBy, triggeredByUser);
            const latencyMs = Date.now() - t0;
            // Heartbeat OK (non-blocking)
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_HEALTH_RUN_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'HEALTH',
                eventType: 'important_event'
            }); } catch (_) {}
            // SLO breach (>600ms)
            if (latencyMs > 600) {
                try { AdminNotificationService.sendAlert({
                    code: 'SLO_NOTIF_HEALTH_RUN_P95',
                    severity: 'INFO',
                    message: 'latency breach',
                    companyId: null,
                    requestId: req.headers['x-request-id'] || null,
                    feature: 'notification-center',
                    tab: 'NOTIFICATION_CENTER',
                    module: 'HEALTH',
                    eventType: 'slo_breach',
                    latencyMs
                }); } catch (_) {}
            }
            return {
                success: true,
                data: results
            };
        }, { ttlSeconds: 120 }); // cache health-check results briefly
    } catch (error) {
        logger.error('❌ [HEALTH CHECK API] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_HEALTH_RUN_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'HEALTH',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
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
        logger.error('❌ [HEALTH HISTORY] Error:', error);
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
                logger.debug('✅ [NOTIFICATION SETTINGS] Redis cache cleared after initial save');
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
                },
                notificationPolicy: settings.notificationCenter?.notificationPolicy || AdminSettings.getDefaultNotificationPolicy()
            }
        });
        
    } catch (error) {
        logger.error('❌ [GET NOTIFICATION SETTINGS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// UPDATE NOTIFICATION SETTINGS (Twilio + Admin Contacts)
// ============================================================================

router.put('/admin/notifications/settings', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
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
            
            logger.security('✅ [NOTIFICATION SETTINGS] Twilio credentials updated');
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
            
            logger.info('✅ [NOTIFICATION SETTINGS] Twilio Test config updated');
        }
        
        // Update admin contacts if provided
        if (adminContacts) {
            if (!settings.notificationCenter) {
                settings.notificationCenter = {};
            }
            
            settings.notificationCenter.adminContacts = adminContacts;
            
            logger.info(`✅ [NOTIFICATION SETTINGS] Admin contacts updated: ${adminContacts.length} contacts`);
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
            
            logger.info('✅ [NOTIFICATION SETTINGS] Escalation intervals updated');
        }
        
        // Emit missing Twilio credentials warnings (non-blocking)
        try {
            const sidMissing = !(settings.notificationCenter?.twilio?.accountSid);
            const tokenMissing = !(settings.notificationCenter?.twilio?.authToken);
            const numberMissing = !(settings.notificationCenter?.twilio?.phoneNumber);
            if (sidMissing)   {AdminNotificationService.sendAlert({ code: 'NOTIF_SETTINGS_TWILIO_MISSING_SID',    severity: 'WARNING', message: 'Twilio SID missing',    companyId: null, requestId: req.headers['x-request-id'] || null, feature: 'notification-center', tab: 'NOTIFICATION_CENTER', module: 'SETTINGS', eventType: 'failure', meta: { route: `${req.method  } ${  req.originalUrl}` } });}
            if (tokenMissing) {AdminNotificationService.sendAlert({ code: 'NOTIF_SETTINGS_TWILIO_MISSING_TOKEN',  severity: 'WARNING', message: 'Twilio token missing',  companyId: null, requestId: req.headers['x-request-id'] || null, feature: 'notification-center', tab: 'NOTIFICATION_CENTER', module: 'SETTINGS', eventType: 'failure', meta: { route: `${req.method  } ${  req.originalUrl}` } });}
            if (numberMissing){AdminNotificationService.sendAlert({ code: 'NOTIF_SETTINGS_TWILIO_MISSING_NUMBER', severity: 'WARNING', message: 'Twilio number missing', companyId: null, requestId: req.headers['x-request-id'] || null, feature: 'notification-center', tab: 'NOTIFICATION_CENTER', module: 'SETTINGS', eventType: 'failure', meta: { route: `${req.method  } ${  req.originalUrl}` } });}
        } catch (_) {}

        settings.markModified('notificationCenter');
        await settings.save();
        
        // CRITICAL: Clear Redis cache for admin settings
        const redisClient = require('../../db').redisClient;
        if (redisClient && redisClient.del) {
            await redisClient.del('admin:settings:notification-center');
            logger.debug('✅ [NOTIFICATION SETTINGS] Redis cache cleared');
        }
        
        await respondWithIdempotency(req, res, async () => ({
            success: true,
            message: 'Notification settings updated successfully',
            data: {
                twilio: settings.notificationCenter?.twilio || {},
                adminContacts: settings.notificationCenter?.adminContacts || [],
                escalation: settings.notificationCenter?.escalation || {}
            }
        }));

        // Heartbeat OK (non-blocking)
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_SETTINGS_SAVE_OK',
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'SETTINGS',
            eventType: 'important_event'
        }); } catch (_) {}
        
    } catch (error) {
        logger.error('❌ [UPDATE NOTIFICATION SETTINGS] Error:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_SETTINGS_SAVE_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'SETTINGS',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// NOTIFICATION POLICY ROUTES
// ============================================================================

// Get default notification policy
router.get('/admin/notifications/policy/defaults', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const AdminSettings = require('../../models/AdminSettings');
        const defaults = AdminSettings.getDefaultNotificationPolicy();
        
        res.json({
            success: true,
            data: defaults
        });
        
    } catch (error) {
        logger.error('❌ [GET POLICY DEFAULTS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Save notification policy
router.put('/admin/notifications/policy', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
    try {
        const { notificationPolicy } = req.body;
        
        if (!notificationPolicy) {
            return res.status(400).json({
                success: false,
                error: 'Notification policy data required'
            });
        }
        
        logger.info('💾 [SAVE NOTIFICATION POLICY] Updating policy...');
        
        const AdminSettings = require('../../models/AdminSettings');
        const settings = await AdminSettings.findOne({}) || new AdminSettings({});
        
        // Update notification policy
        if (!settings.notificationCenter) {
            settings.notificationCenter = {};
        }
        settings.notificationCenter.notificationPolicy = notificationPolicy;
        settings.lastUpdated = new Date();
        settings.updatedBy = req.user?.username || 'Admin';
        
        await settings.save();
        
        logger.info('✅ [SAVE NOTIFICATION POLICY] Policy saved successfully');
        
        await respondWithIdempotency(req, res, async () => {
            return {
                success: true,
                message: 'Notification policy updated successfully',
                data: notificationPolicy
            };
        });
        
    } catch (error) {
        logger.error('❌ [SAVE NOTIFICATION POLICY] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SEND TEST SMS TO ADMIN CONTACT
// ============================================================================

router.post('/admin/notifications/test-sms', authenticateJWT, requireRole('admin'), captureAuditInfo, requireIdempotency, configWriteRateLimit, async (req, res) => {
     
    // Console logging intentional for SMS delivery testing
    
    try {
        const { recipientName, recipientPhone } = req.body;
        
        if (!recipientPhone) {
            return res.status(400).json({
                success: false,
                error: 'Recipient phone number required'
            });
        }
        
        logger.info(`📱 [TEST SMS] Sending test message to ${recipientName} (${recipientPhone})...`);
        
        // Get Twilio credentials from AdminSettings
        const AdminSettings = require('../../models/AdminSettings');
        const settings = await AdminSettings.findOne({});
        
        if (!settings) {
            logger.error('❌ [TEST SMS] AdminSettings document not found');
            return res.status(400).json({
                success: false,
                error: 'AdminSettings not initialized. Please save Twilio credentials in Settings tab first.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.accountSid) {
            logger.error('❌ [TEST SMS] Twilio Account SID missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Account SID not configured. Please save credentials in Settings tab.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.authToken) {
            logger.security('❌ [TEST SMS] Twilio Auth Token missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Auth Token not configured. Please save credentials in Settings tab.'
            });
        }
        
        if (!settings.notificationCenter?.twilio?.phoneNumber) {
            logger.security('❌ [TEST SMS] Twilio Phone Number missing');
            return res.status(400).json({
                success: false,
                error: 'Twilio Phone Number not configured. Please save credentials in Settings tab.'
            });
        }
        
        logger.info(`✅ [TEST SMS] Twilio credentials found:`, {
            accountSid: `${settings.notificationCenter.twilio.accountSid.substring(0, 10)  }...`,
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
        
        logger.info(`🚀 [TEST SMS] Calling Twilio API...`);
        logger.info(`   From: ${settings.notificationCenter.twilio.phoneNumber}`);
        logger.info(`   To: ${recipientPhone}`);
        
        await respondWithIdempotency(req, res, async () => {
            const result = await twilioClient.messages.create({
                body: testMessage,
                from: settings.notificationCenter.twilio.phoneNumber,
                to: recipientPhone
            });
            logger.info(`✅ [TEST SMS] Twilio API responded successfully!`);
            logger.info(`   Twilio SID: ${result.sid}`);
            logger.info(`   Status: ${result.status}`);
            logger.info(`   Date Created: ${result.dateCreated}`);
            logger.info(`   Price: ${result.price || 'pending'}`);
            logger.info(`   Error Code: ${result.errorCode || 'none'}`);
            logger.info(`   Error Message: ${result.errorMessage || 'none'}`);
            // Heartbeat OK (non-blocking)
            try { AdminNotificationService.sendAlert({
                code: 'NOTIF_SETTINGS_TEST_SMS_OK',
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'SETTINGS',
                eventType: 'important_event'
            }); } catch (_) {}

            return {
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
            };
        });
        
    } catch (error) {
        logger.error('❌ [TEST SMS] Failed to send:', error);
        try { AdminNotificationService.sendAlert({
            code: 'NOTIF_SETTINGS_TEST_SMS_FAILURE',
            severity: 'WARNING',
            message: error.message,
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'SETTINGS',
            eventType: 'failure',
            meta: { route: `${req.method  } ${  req.originalUrl}` }
        }); } catch (_) {}
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to send test SMS'
        });
    }
    
     
});

// ============================================================================
// TEST FULL NOTIFICATION SYSTEM (SMS + EMAIL)
// ============================================================================

router.post('/admin/notifications/test-all', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.info('🧪 [TEST ALL] Testing full notification system (SMS + Email)...');
        
        // Trigger a test alert using AdminNotificationService
        // This will send both SMS and Email to all configured admin contacts
        await AdminNotificationService.sendAlert({
            code: 'NOTIFICATION_SYSTEM_TEST',
            severity: 'WARNING',  // Changed from INFO to WARNING so you actually get notified (INFO is log-only by default)
            companyId: null,
            companyName: 'Notification Center Test',
            message: '🧪 Test Alert - Full System Check',
            details: `This is a test message sent at ${new Date().toISOString()}\n\nIf you received this via EMAIL (not SMS), your notification policy is working correctly!\n\n✅ Email delivery: Working\n✅ Notification logging: Working\n\nBy default:\n- WARNING = Email only\n- CRITICAL = SMS + Email\n- INFO = Log only`
        });
        
        logger.info('✅ [TEST ALL] Test alert sent successfully!');
        
        res.json({
            success: true,
            message: 'Test alert sent! Check your phone AND email inbox.',
            note: 'This alert was also logged in the Alert Log tab.'
        });
        
    } catch (error) {
        logger.error('❌ [TEST ALL] Test failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// SEND DAILY DIGEST EMAIL (Manual Trigger for Testing)
// ============================================================================

router.post('/admin/notifications/send-digest', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        logger.info('📧 [SEND DIGEST] Manually triggering daily digest...');
        
        const DailyDigestService = require('../../services/DailyDigestService');
        const result = await DailyDigestService.sendDailyDigest();
        
        if (result.success) {
            logger.info(`✅ [SEND DIGEST] Sent to ${result.recipients.length} recipients`);
            
            res.json({
                success: true,
                message: 'Daily digest sent successfully!',
                data: {
                    recipients: result.recipients,
                    stats: result.stats,
                    duration: result.duration
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.reason || result.error || 'Failed to send digest'
            });
        }
        
    } catch (error) {
        logger.error('❌ [SEND DIGEST] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// PHASE 3: ADVANCED ERROR INTELLIGENCE ENDPOINTS
// ============================================================================
// ✅ RE-ENABLED: Fixed redisClient export bug in clients/index.js
// Root cause: module.exports was capturing null value instead of using getter
// ============================================================================

const RootCauseAnalyzer = require('../../services/RootCauseAnalyzer');
const ErrorTrendTracker = require('../../services/ErrorTrendTracker');
const DependencyHealthMonitor = require('../../services/DependencyHealthMonitor');

// Initialize Phase 3 services (all use instance methods)
const rootCauseAnalyzer = new RootCauseAnalyzer();
const errorTrendTracker = new ErrorTrendTracker();
const dependencyHealthMonitor = new DependencyHealthMonitor();

// Simple test route to verify Phase 3 routes are registered
router.get('/notifications/_test', authenticateJWT, requireRole('admin'), (req, res) => {
    res.json({ 
        success: true, 
        message: '🎉 Phase 3 routes are registered and ENABLED!',
        timestamp: new Date().toISOString(),
        server: 'Render production',
        status: 'Phase 3 fully operational'
    });
});

// ----------------------------------------------------------------------------
// GET /api/admin/notifications/root-cause-analysis
// AI-powered pattern detection and root cause identification
// ----------------------------------------------------------------------------
router.get('/notifications/root-cause-analysis', 
    authenticateJWT, 
    requireRole('admin'), 
    async (req, res) => {
    try {
        const timeWindow = parseInt(req.query.timeWindow) || 15; // minutes
        
        logger.info(`🧠 [ROOT CAUSE API] Analyzing error patterns (${timeWindow}min window)`);
        
        const analysis = await rootCauseAnalyzer.analyzeErrors(timeWindow);
        
        await AdminNotificationService.sendAlert({
            code: "NOTIF_ROOT_CAUSE_ANALYSIS_OK",
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ROOT_CAUSE_ANALYZER',
            eventType: 'important_event'
        });
        
        res.json({
            success: true,
            timeWindow,
            ...analysis
        });
        
    } catch (error) {
        logger.error('❌ [ROOT CAUSE API] Analysis failed:', error);
        
        await AdminNotificationService.sendAlert({
            code: "NOTIF_ROOT_CAUSE_ANALYSIS_FAILURE",
            severity: 'WARNING',
            message: 'Root cause analysis failed',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ROOT_CAUSE_ANALYZER',
            eventType: 'failure',
            meta: { route: `${req.method} ${req.originalUrl}` }
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ----------------------------------------------------------------------------
// GET /api/admin/notifications/error-trends
// Historical trend analysis and regression detection
// ----------------------------------------------------------------------------
router.get('/notifications/error-trends', 
    authenticateJWT, 
    requireRole('admin'), 
    async (req, res) => {
    try {
        const periodHours = parseInt(req.query.periodHours) || 24;
        
        logger.info(`📊 [TREND API] Fetching error trends (${periodHours}h period)`);
        
        const trends = await errorTrendTracker.getErrorTrends(periodHours);
        const baseline = await errorTrendTracker.compareWithBaseline();
        
        await AdminNotificationService.sendAlert({
            code: "NOTIF_ERROR_TRENDS_OK",
            severity: 'INFO',
            message: 'ok',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ERROR_TREND_TRACKER',
            eventType: 'important_event'
        });
        
        res.json({
            success: true,
            trends,
            baseline
        });
        
    } catch (error) {
        logger.error('❌ [TREND API] Failed to get trends:', error);
        
        await AdminNotificationService.sendAlert({
            code: "NOTIF_ERROR_TRENDS_FAILURE",
            severity: 'WARNING',
            message: 'Error trend analysis failed',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'ERROR_TREND_TRACKER',
            eventType: 'failure',
            meta: { route: `${req.method} ${req.originalUrl}` }
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ----------------------------------------------------------------------------
// GET /api/admin/notifications/dependency-health
// Real-time monitoring of all external services
// ----------------------------------------------------------------------------
router.get('/notifications/dependency-health', 
    authenticateJWT, 
    requireRole('admin'), 
    async (req, res) => {
    try {
        logger.info('🏥 [DEPENDENCY API] Checking all service dependencies');
        
        const healthStatus = await dependencyHealthMonitor.getHealthStatus();
        
        // Send alert if any critical services are down
        if (healthStatus.overallStatus === 'CRITICAL' || healthStatus.overallStatus === 'DOWN') {
            await AdminNotificationService.sendAlert({
                code: "DEPENDENCY_HEALTH_CRITICAL",
                severity: 'CRITICAL',
                message: `Dependency health check failed: ${healthStatus.overallStatus}`,
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'DEPENDENCY_HEALTH_MONITOR',
                eventType: 'failure',
                meta: { 
                    route: `${req.method} ${req.originalUrl}`,
                    downServices: Object.entries(healthStatus.services || {})
                        .filter(([_, service]) => service.status === 'DOWN')
                        .map(([name]) => name)
                }
            });
        } else {
            await AdminNotificationService.sendAlert({
                code: "NOTIF_DEPENDENCY_HEALTH_OK",
                severity: 'INFO',
                message: 'ok',
                companyId: null,
                requestId: req.headers['x-request-id'] || null,
                feature: 'notification-center',
                tab: 'NOTIFICATION_CENTER',
                module: 'DEPENDENCY_HEALTH_MONITOR',
                eventType: 'important_event'
            });
        }
        
        res.json({
            success: true,
            ...healthStatus
        });
        
    } catch (error) {
        logger.error('❌ [DEPENDENCY API] Health check failed:', error);
        
        await AdminNotificationService.sendAlert({
            code: "NOTIF_DEPENDENCY_HEALTH_FAILURE",
            severity: 'CRITICAL',
            message: 'Dependency health monitor failed',
            companyId: null,
            requestId: req.headers['x-request-id'] || null,
            feature: 'notification-center',
            tab: 'NOTIFICATION_CENTER',
            module: 'DEPENDENCY_HEALTH_MONITOR',
            eventType: 'failure',
            meta: { route: `${req.method} ${req.originalUrl}` }
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ----------------------------------------------------------------------------
// GET /api/admin/notifications/service-status/:serviceName
// Quick status check for specific service (MongoDB, Redis, Twilio, ElevenLabs)
// ----------------------------------------------------------------------------
router.get('/notifications/service-status/:serviceName', 
    authenticateJWT, 
    requireRole('admin'), 
    async (req, res) => {
    try {
        const { serviceName } = req.params;
        
        logger.info(`🏥 [SERVICE STATUS API] Checking ${serviceName}`);
        
        const status = await dependencyHealthMonitor.getDependencyStatus(serviceName);
        
        res.json({
            success: true,
            service: status
        });
        
    } catch (error) {
        logger.error(`❌ [SERVICE STATUS API] Failed to check ${req.params.serviceName}:`, error);
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// DIAGNOSTIC: List all registered routes (for debugging 404s)
// ============================================================================
router.get('/notifications/_routes', authenticateJWT, requireRole('admin'), (req, res) => {
    const routes = [];
    router.stack.forEach((r) => {
        if (r.route) {
            routes.push({
                path: `/api/admin${r.route.path}`,
                methods: Object.keys(r.route.methods)
            });
        }
    });
    res.json({
        success: true,
        message: 'Phase 3 routes are loaded!',
        timestamp: new Date().toISOString(),
        routeCount: routes.length,
        phase3Routes: [
            '/api/admin/notifications/root-cause-analysis',
            '/api/admin/notifications/error-trends',
            '/api/admin/notifications/dependency-health',
            '/api/admin/notifications/service-status/:serviceName'
        ],
        allRoutes: routes.slice(0, 20) // First 20 routes
    });
});

module.exports = router;

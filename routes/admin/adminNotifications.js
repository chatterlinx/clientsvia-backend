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
            overallStatus: overallStatus,
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
                latestHealthCheck: latestHealthCheck,
                healthTrend24h: healthTrend,
                recentAlerts: recentAlerts
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
                summary: summary
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
                results: results,
                summary: summary
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
        
        if (severity) filter.severity = severity;
        if (code) filter.code = code.toUpperCase();
        if (companyId) filter.companyId = companyId;
        if (acknowledged !== undefined) filter['acknowledgment.isAcknowledged'] = acknowledged === 'true';
        if (resolved !== undefined) filter['resolution.isResolved'] = resolved === 'true';
        
        // Execute query
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [logs, total] = await Promise.all([
            NotificationLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            NotificationLog.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            data: {
                logs: logs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total,
                    pages: Math.ceil(total / parseInt(limit))
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
            parseInt(minutes),
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
        
        const history = await HealthCheckLog.getHistory(parseInt(limit));
        const trend = await HealthCheckLog.getTrend();
        const componentSummary = await HealthCheckLog.getComponentSummary(parseInt(hours));
        
        res.json({
            success: true,
            data: {
                history: history,
                trend24h: trend,
                componentSummary: componentSummary
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

module.exports = router;

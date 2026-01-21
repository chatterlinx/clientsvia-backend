/**
 * ════════════════════════════════════════════════════════════════════════════════
 * GOOGLE CALENDAR API ROUTES - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * API endpoints for Google Calendar integration.
 * 
 * ENDPOINTS:
 * - GET  /api/company/:companyId/google-calendar/status       - Get connection status
 * - GET  /api/company/:companyId/google-calendar/auth-url     - Get OAuth2 URL
 * - POST /api/company/:companyId/google-calendar/disconnect   - Disconnect calendar
 * - GET  /api/company/:companyId/google-calendar/test         - Test connection
 * - GET  /api/company/:companyId/google-calendar/availability - Check availability
 * - POST /api/company/:companyId/google-calendar/settings     - Update settings
 * 
 * OAUTH CALLBACK (separate route):
 * - GET  /api/integrations/google-calendar/callback           - OAuth2 callback
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const GoogleCalendarService = require('../../services/GoogleCalendarService');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════════

// Require authentication for all routes (permission checked per-route)
router.use(authenticateJWT);

// ════════════════════════════════════════════════════════════════════════════════
// STATUS & CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/google-calendar/status
 * Get current calendar connection status and settings
 */
router.get('/status', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Check if Google Calendar is configured on the platform
        if (!GoogleCalendarService.isConfigured()) {
            return res.json({
                success: true,
                platformConfigured: false,
                message: 'Google Calendar integration not configured on platform'
            });
        }
        
        const status = await GoogleCalendarService.getStatus(companyId);
        
        res.json({
            success: true,
            platformConfigured: true,
            ...status
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Status check failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/company/:companyId/google-calendar/auth-url
 * Get OAuth2 authorization URL for connecting calendar
 */
router.get('/auth-url', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!GoogleCalendarService.isConfigured()) {
            return res.status(400).json({
                success: false,
                error: 'Google Calendar integration not configured on platform'
            });
        }
        
        const authUrl = GoogleCalendarService.generateAuthUrl(companyId);
        
        if (!authUrl) {
            return res.status(500).json({
                success: false,
                error: 'Failed to generate authorization URL'
            });
        }
        
        logger.info('[GOOGLE CALENDAR API] Auth URL generated', { companyId });
        
        res.json({
            success: true,
            authUrl
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Auth URL generation failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/google-calendar/disconnect
 * Disconnect calendar from company
 */
router.post('/disconnect', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const result = await GoogleCalendarService.disconnectCalendar(companyId);
        
        if (result.success) {
            logger.info('[GOOGLE CALENDAR API] Calendar disconnected', { companyId });
            res.json({ success: true, message: 'Calendar disconnected successfully' });
        } else {
            res.status(400).json({ success: false, error: result.error });
        }
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Disconnect failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/company/:companyId/google-calendar/test
 * Test calendar connection
 */
router.get('/test', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const result = await GoogleCalendarService.testConnection(companyId);
        
        res.json({
            success: result.success,
            ...result
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Test connection failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/company/:companyId/google-calendar/settings
 * Update calendar settings and event colors
 */
router.post('/settings', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { settings, eventColors } = req.body;
        
        // Build update object
        const updateObj = {};
        
        // Handle settings
        if (settings && typeof settings === 'object') {
            const allowedFields = [
                'bufferMinutes',
                'defaultDurationMinutes',
                'maxBookingDaysAhead',
                'useCompanyHours',
                'customWorkingHours',
                'includeCustomerPhone',
                'includeCustomerAddress',
                'includeServiceNotes',
                'eventTitleTemplate',
                'eventDescriptionTemplate',
                'sendCustomerInvite',
                'fallbackMode',
                'fallbackMessage'
            ];
            
            for (const key of allowedFields) {
                if (settings[key] !== undefined) {
                    updateObj[`googleCalendar.settings.${key}`] = settings[key];
                }
            }
        }
        
        // Handle event colors (V89)
        if (eventColors && typeof eventColors === 'object') {
            if (eventColors.enabled !== undefined) {
                updateObj['googleCalendar.eventColors.enabled'] = eventColors.enabled;
            }
            if (eventColors.defaultColorId !== undefined) {
                updateObj['googleCalendar.eventColors.defaultColorId'] = eventColors.defaultColorId;
            }
            if (Array.isArray(eventColors.colorMapping)) {
                // Validate color mappings
                const validMappings = eventColors.colorMapping.filter(m => 
                    m.serviceType && typeof m.serviceType === 'string' &&
                    m.colorId && typeof m.colorId === 'string'
                ).map(m => ({
                    serviceType: m.serviceType,
                    colorId: m.colorId,
                    label: m.label || m.serviceType,
                    description: m.description || ''
                }));
                updateObj['googleCalendar.eventColors.colorMapping'] = validMappings;
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
        
        logger.info('[GOOGLE CALENDAR API] Settings updated', { 
            companyId,
            updatedFields: Object.keys(updateObj),
            hasEventColors: !!eventColors
        });
        
        res.json({
            success: true,
            message: 'Settings updated successfully'
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Settings update failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/company/:companyId/google-calendar/toggle
 * Enable/disable calendar integration (without disconnecting)
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
            { $set: { 'googleCalendar.enabled': enabled } }
        );
        
        logger.info('[GOOGLE CALENDAR API] Integration toggled', { companyId, enabled });
        
        res.json({
            success: true,
            enabled,
            message: enabled ? 'Calendar integration enabled' : 'Calendar integration disabled'
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Toggle failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// AVAILABILITY
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/google-calendar/availability
 * Check availability for a time range
 * Query params: startDate, endDate (ISO strings)
 */
router.get('/availability', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'startDate and endDate query parameters required'
            });
        }
        
        const result = await GoogleCalendarService.checkAvailability(companyId, {
            startDate: new Date(startDate),
            endDate: new Date(endDate)
        });
        
        res.json({
            success: !result.error,
            ...result
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Availability check failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/company/:companyId/google-calendar/next-slot
 * Find next available slot
 * Query params: durationMinutes (optional), searchFrom (optional ISO string)
 */
router.get('/next-slot', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { durationMinutes, searchFrom, maxDaysAhead } = req.query;
        
        const result = await GoogleCalendarService.findNextAvailableSlot(companyId, {
            durationMinutes: durationMinutes ? parseInt(durationMinutes) : 60,
            searchFrom: searchFrom ? new Date(searchFrom) : null,
            maxDaysAhead: maxDaysAhead ? parseInt(maxDaysAhead) : 7
        });
        
        res.json({
            success: !!result.slot,
            ...result
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Next slot search failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// MANUAL EVENT CREATION (Admin Testing)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/company/:companyId/google-calendar/create-event
 * Manually create a test event (for admin testing)
 */
router.post('/create-event', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            customerName, 
            customerPhone, 
            customerEmail,
            customerAddress,
            serviceType,
            serviceNotes,
            startTime,
            endTime 
        } = req.body;
        
        if (!customerName || !startTime) {
            return res.status(400).json({
                success: false,
                error: 'customerName and startTime required'
            });
        }
        
        const result = await GoogleCalendarService.createBookingEvent(companyId, {
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            serviceType: serviceType || 'Service Call',
            serviceNotes,
            startTime: new Date(startTime),
            endTime: endTime ? new Date(endTime) : null
        });
        
        res.json(result);
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] Event creation failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// CALENDAR VIEW - List events for Call Center dashboard
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/google-calendar/events
 * List calendar events for a date range (used by Call Center Calendar tab)
 */
router.get('/events', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { start, end } = req.query;
        
        if (!start || !end) {
            return res.status(400).json({
                success: false,
                error: 'start and end query parameters required (ISO date strings)'
            });
        }
        
        const company = await v2Company.findById(companyId).select('googleCalendar').lean();
        
        if (!company?.googleCalendar?.accessToken) {
            return res.json({
                success: false,
                connected: false,
                error: 'Google Calendar not connected',
                events: []
            });
        }
        
        // List events from Google Calendar
        const events = await GoogleCalendarService.listEvents(companyId, {
            timeMin: new Date(start).toISOString(),
            timeMax: new Date(end).toISOString(),
            maxResults: 250,
            singleEvents: true,
            orderBy: 'startTime'
        });
        
        res.json({
            success: true,
            events: events || [],
            count: events?.length || 0
        });
    } catch (err) {
        logger.error('[GOOGLE CALENDAR API] List events failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: err.message, events: [] });
    }
});

module.exports = router;

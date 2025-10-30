/**
 * ============================================================================
 * ADMIN GLOBAL ACTION HOOKS API
 * ============================================================================
 * 
 * PURPOSE:
 * Admin-only API for managing platform-wide action hooks that define what
 * the AI should do after responding (escalate, schedule, send payment, etc.)
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-action-hooks           - List all hooks
 * - GET    /api/admin/global-action-hooks/:id       - Get specific hook
 * - POST   /api/admin/global-action-hooks           - Create new hook
 * - PUT    /api/admin/global-action-hooks/:id       - Update hook
 * - DELETE /api/admin/global-action-hooks/:id       - Delete hook
 * - POST   /api/admin/global-action-hooks/seed      - Seed default hooks
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const GlobalActionHook = require('../../models/GlobalActionHook');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication
router.use(authenticateJWT);
router.use(requireRole('admin'));

// ============================================================================
// GET ROUTES - READ OPERATIONS
// ============================================================================

/**
 * GET /api/admin/global-action-hooks
 * List all action hooks
 */
router.get('/', async (req, res) => {
    try {
        const hooks = await GlobalActionHook.getActiveHooks();
        res.json({
            success: true,
            count: hooks.length,
            data: hooks
        });
    } catch (error) {
        logger.error('Error fetching action hooks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hooks',
            error: error.message
        });
    }
});

/**
 * GET /api/admin/global-action-hooks/:id
 * Get a specific action hook by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const hook = await GlobalActionHook.findById(req.params.id);
        if (!hook) {
            return res.status(404).json({
                success: false,
                message: 'Action hook not found'
            });
        }
        res.json({
            success: true,
            data: hook
        });
    } catch (error) {
        logger.error('Error fetching action hook:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hook',
            error: error.message
        });
    }
});

// ============================================================================
// POST ROUTES - CREATE OPERATIONS
// ============================================================================

/**
 * POST /api/admin/global-action-hooks
 * Create a new action hook
 */
router.post('/', async (req, res) => {
    try {
        const { hookId, name, icon, description, directory, functionName, parameters, triggerTiming } = req.body;
        
        // Check if hook ID already exists
        const existing = await GlobalActionHook.findOne({ hookId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Action hook ID already exists'
            });
        }
        
        const newHook = new GlobalActionHook({
            hookId,
            name,
            icon: icon || '⚡',
            description,
            directory: directory || 'other',
            functionName: functionName || '',
            parameters: parameters || {},
            triggerTiming: triggerTiming || 'after_response',
            isActive: true,
            isSystemDefault: false,
            createdBy: 'Admin',
            sortOrder: 999
        });
        
        await newHook.save();
        
        res.status(201).json({
            success: true,
            message: 'Action hook created successfully',
            data: newHook
        });
    } catch (error) {
        logger.error('Error creating action hook:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create action hook',
            error: error.message
        });
    }
});

// ============================================================================
// PUT ROUTES - UPDATE OPERATIONS
// ============================================================================

/**
 * PUT /api/admin/global-action-hooks/:id
 * Update an existing action hook
 */
router.put('/:id', async (req, res) => {
    try {
        const hook = await GlobalActionHook.findById(req.params.id);
        if (!hook) {
            return res.status(404).json({
                success: false,
                message: 'Action hook not found'
            });
        }
        
        const { name, icon, description, directory, functionName, parameters, triggerTiming, isActive, sortOrder } = req.body;
        
        if (name) {hook.name = name;}
        if (icon) {hook.icon = icon;}
        if (description) {hook.description = description;}
        if (directory) {hook.directory = directory;}
        if (functionName !== undefined) {hook.functionName = functionName;}
        if (parameters !== undefined) {hook.parameters = parameters;}
        if (triggerTiming) {hook.triggerTiming = triggerTiming;}
        if (isActive !== undefined) {hook.isActive = isActive;}
        if (sortOrder !== undefined) {hook.sortOrder = sortOrder;}
        
        hook.lastModifiedBy = 'Admin';
        
        await hook.save();
        
        res.json({
            success: true,
            message: 'Action hook updated successfully',
            data: hook
        });
    } catch (error) {
        logger.error('Error updating action hook:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update action hook',
            error: error.message
        });
    }
});

// ============================================================================
// DELETE ROUTES - DELETE OPERATIONS
// ============================================================================

/**
 * DELETE /api/admin/global-action-hooks/:id
 * Delete an action hook
 */
router.delete('/:id', async (req, res) => {
    try {
        const hook = await GlobalActionHook.findById(req.params.id);
        if (!hook) {
            return res.status(404).json({
                success: false,
                message: 'Action hook not found'
            });
        }
        
        if (hook.isSystemDefault) {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete system default action hooks'
            });
        }
        
        await GlobalActionHook.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Action hook deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting action hook:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete action hook',
            error: error.message
        });
    }
});

// ============================================================================
// SEED ROUTE - POPULATE DEFAULT ACTION HOOKS
// ============================================================================

/**
 * POST /api/admin/global-action-hooks/seed
 * Seed default action hooks
 */
router.post('/seed', async (req, res) => {
    try {
        const existingCount = await GlobalActionHook.countDocuments();
        if (existingCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Database already contains ${existingCount} action hooks. Clear them first or use update endpoints.`
            });
        }
        
        const defaultHooks = [
            // ESCALATION DIRECTORY
            { hookId: 'escalate_to_human', name: 'Escalate to Human', icon: '🚨', description: 'Transfer call to human representative immediately', directory: 'escalation', functionName: 'escalateToHuman', triggerTiming: 'immediately', sortOrder: 1, isSystemDefault: true },
            { hookId: 'escalate_to_manager', name: 'Escalate to Manager', icon: '👔', description: 'Transfer call to manager or supervisor', directory: 'escalation', functionName: 'escalateToManager', triggerTiming: 'immediately', sortOrder: 2, isSystemDefault: true },
            { hookId: 'flag_for_followup', name: 'Flag for Follow-up', icon: '🏴', description: 'Mark conversation for manual review and follow-up', directory: 'escalation', functionName: 'flagForFollowup', triggerTiming: 'after_response', sortOrder: 3, isSystemDefault: true },
            
            // SCHEDULING DIRECTORY
            { hookId: 'offer_scheduling', name: 'Offer Scheduling', icon: '📅', description: 'Present available appointment slots to caller', directory: 'scheduling', functionName: 'offerScheduling', triggerTiming: 'after_response', sortOrder: 4, isSystemDefault: true },
            { hookId: 'confirm_appointment', name: 'Confirm Appointment', icon: '✅', description: 'Confirm and book the selected appointment time', directory: 'scheduling', functionName: 'confirmAppointment', triggerTiming: 'on_confirmation', sortOrder: 5, isSystemDefault: true },
            { hookId: 'offer_reschedule', name: 'Offer Reschedule', icon: '🔄', description: 'Provide options to reschedule existing appointment', directory: 'scheduling', functionName: 'offerReschedule', triggerTiming: 'after_response', sortOrder: 6, isSystemDefault: true },
            
            // PAYMENT DIRECTORY
            { hookId: 'send_payment_link', name: 'Send Payment Link', icon: '💳', description: 'Send secure payment link via SMS or email', directory: 'payment', functionName: 'sendPaymentLink', triggerTiming: 'after_response', sortOrder: 7, isSystemDefault: true },
            { hookId: 'send_invoice', name: 'Send Invoice', icon: '🧾', description: 'Generate and send invoice to customer', directory: 'payment', functionName: 'sendInvoice', triggerTiming: 'after_response', sortOrder: 8, isSystemDefault: true },
            
            // COMMUNICATION DIRECTORY
            { hookId: 'send_info_sms', name: 'Send Info via SMS', icon: '📱', description: 'Send detailed information or links via text message', directory: 'communication', functionName: 'sendInfoSMS', triggerTiming: 'after_response', sortOrder: 9, isSystemDefault: true },
            { hookId: 'send_info_email', name: 'Send Info via Email', icon: '📧', description: 'Send detailed information or documents via email', directory: 'communication', functionName: 'sendInfoEmail', triggerTiming: 'after_response', sortOrder: 10, isSystemDefault: true },
            { hookId: 'offer_callback', name: 'Offer Callback', icon: '📞', description: 'Schedule callback at customer\'s preferred time', directory: 'communication', functionName: 'offerCallback', triggerTiming: 'after_response', sortOrder: 11, isSystemDefault: true },
            
            // INFORMATION DIRECTORY
            { hookId: 'provide_quote', name: 'Provide Quote', icon: '💰', description: 'Generate and present price quote based on service details', directory: 'information', functionName: 'provideQuote', triggerTiming: 'after_response', sortOrder: 12, isSystemDefault: true },
            { hookId: 'check_availability', name: 'Check Availability', icon: '🔍', description: 'Check technician/service availability in real-time', directory: 'information', functionName: 'checkAvailability', triggerTiming: 'immediately', sortOrder: 13, isSystemDefault: true },
            
            // CALL FLOW DIRECTORY
            { hookId: 'smart_hold', name: 'Smart Hold (Active Listening)', icon: '⏸️', description: 'Intelligent hold with active listening - monitors for customer return, prompts at intervals, max timeout protection', directory: 'call_flow', functionName: 'smartHold', parameters: { activeListening: true, timeoutIntervals: [60, 120, 180], maxDuration: 300, exitOnSpeech: true }, triggerTiming: 'immediately', sortOrder: 14, isSystemDefault: true },
            { hookId: 'end_call_positive', name: 'End Call (Positive)', icon: '👋', description: 'Gracefully end call after successful resolution', directory: 'call_flow', functionName: 'endCallPositive', triggerTiming: 'after_response', sortOrder: 15, isSystemDefault: true },
            { hookId: 'hold_for_info', name: 'Hold for Information', icon: '⏸️', description: 'Put caller on brief hold while retrieving information (simple hold, no smart features)', directory: 'call_flow', functionName: 'holdForInfo', triggerTiming: 'immediately', sortOrder: 16, isSystemDefault: true }
        ];
        
        await GlobalActionHook.insertMany(defaultHooks);
        
        res.status(201).json({
            success: true,
            message: `Successfully seeded ${defaultHooks.length} default action hooks`,
            count: defaultHooks.length
        });
    } catch (error) {
        logger.error('Error seeding action hooks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to seed action hooks',
            error: error.message
        });
    }
});

module.exports = router;


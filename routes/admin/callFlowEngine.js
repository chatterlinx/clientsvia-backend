/**
 * ============================================================================
 * CALL FLOW ENGINE ADMIN ROUTES
 * ============================================================================
 * 
 * API endpoints for managing the Call Flow Engine configuration.
 * 
 * ENDPOINTS:
 * - GET    /api/admin/call-flow-engine/:companyId          - Get config
 * - PATCH  /api/admin/call-flow-engine/:companyId          - Update config
 * - POST   /api/admin/call-flow-engine/:companyId/rebuild  - Rebuild mission cache
 * - POST   /api/admin/call-flow-engine/:companyId/test     - Test a sentence
 * - GET    /api/admin/call-flow-engine/:companyId/stats    - Get trigger stats
 * - POST   /api/admin/call-flow-engine/:companyId/trigger  - Add manual trigger
 * - DELETE /api/admin/call-flow-engine/:companyId/trigger  - Remove manual trigger
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// Services
const MissionCacheService = require('../../services/MissionCacheService');
const FlowEngine = require('../../services/FlowEngine');
const BookingFlowEngine = require('../../services/BookingFlowEngine');

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_BOOKING_FIELDS = [
    { key: 'name', label: 'Name', required: true, order: 1, prompt: 'What is your name?', validation: 'none' },
    { key: 'phone', label: 'Phone', required: true, order: 2, prompt: 'What is the best phone number to reach you?', validation: 'phone' },
    { key: 'address', label: 'Address', required: true, order: 3, prompt: 'What is the service address?', validation: 'address' },
    { key: 'serviceType', label: 'Service Type', required: false, order: 4, prompt: 'What type of service do you need?', validation: 'none' },
    { key: 'preferredTime', label: 'Preferred Time', required: false, order: 5, prompt: 'When would you like us to come out?', validation: 'none' }
];

const DEFAULT_STYLE = {
    preset: 'friendly',
    greeting: 'Thank you for calling {companyName}, this is your AI assistant. How can I help you today?',
    companyName: '',
    customNotes: `TONE & PERSONALITY:
• Be warm, professional, and efficient
• Use natural conversational language - not robotic
• Mirror the caller's energy level
• Never interrupt - let them finish speaking

BOOKING PRIORITY:
• If caller mentions scheduling, appointment, or service - focus on booking
• Don't over-question or troubleshoot unless they specifically ask
• Get to the point: collect name, phone, address, preferred time

CONFIRMATION STYLE:
• Always confirm critical info by repeating it back
• Use phrases like "Just to confirm..." or "Let me make sure I have this right..."

HANDLING UNCERTAINTY:
• If unsure, ask ONE clarifying question
• Don't guess or assume - verify with caller
• If stuck, offer to take a message or transfer

FORBIDDEN:
• Never give pricing without checking
• Never promise specific appointment times without checking availability
• Never diagnose technical issues - that's for the technician`
};

// ============================================================================
// GET CONFIGURATION
// ============================================================================
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { trade = '_default' } = req.query;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const callFlowEngine = company.aiAgentSettings?.callFlowEngine || {};
        
        // Get mission triggers (may rebuild if not cached)
        let missionTriggers;
        try {
            missionTriggers = await MissionCacheService.getMissionTriggers(companyId, trade);
        } catch (e) {
            logger.warn('[CALL FLOW ENGINE] Failed to get mission triggers:', e.message);
            missionTriggers = null;
        }
        
        // Get stats
        let stats;
        try {
            stats = await MissionCacheService.getStats(companyId, trade);
        } catch (e) {
            stats = null;
        }
        
        res.json({
            success: true,
            data: {
                // Default to TRUE for production - Mission Control is the primary system
                enabled: callFlowEngine.enabled !== false, // true unless explicitly set to false
                missionTriggers: missionTriggers || callFlowEngine.missionTriggers?.[trade] || callFlowEngine.missionTriggers?._default,
                bookingFields: callFlowEngine.bookingFields?.length > 0 ? callFlowEngine.bookingFields : DEFAULT_BOOKING_FIELDS,
                style: { ...DEFAULT_STYLE, ...callFlowEngine.style },
                synonymMap: callFlowEngine.synonymMap || {},
                customBlockers: callFlowEngine.customBlockers || {},
                trades: callFlowEngine.trades || [],
                activeTrade: callFlowEngine.activeTrade || '_default',
                legacyScriptActive: callFlowEngine.legacyScriptActive || false,
                legacyFrontlineScript: callFlowEngine.legacyFrontlineScript || '',
                lastCacheRebuild: callFlowEngine.lastCacheRebuild,
                lastUpdated: callFlowEngine.lastUpdated,
                stats
            }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] GET error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// UPDATE CONFIGURATION
// ============================================================================
router.patch('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;
        
        logger.info('[CALL FLOW ENGINE] Updating config for company:', companyId);
        
        const updateObj = {};
        
        // Enabled toggle
        if (typeof updates.enabled === 'boolean') {
            updateObj['aiAgentSettings.callFlowEngine.enabled'] = updates.enabled;
        }
        
        // Booking fields
        if (Array.isArray(updates.bookingFields)) {
            updateObj['aiAgentSettings.callFlowEngine.bookingFields'] = updates.bookingFields;
        }
        
        // Style
        if (updates.style) {
            if (updates.style.preset) {
                updateObj['aiAgentSettings.callFlowEngine.style.preset'] = updates.style.preset;
            }
            if (typeof updates.style.customNotes === 'string') {
                // Enforce word limit (~300 words = ~2000 chars)
                const notes = updates.style.customNotes.substring(0, 2000);
                updateObj['aiAgentSettings.callFlowEngine.style.customNotes'] = notes;
            }
            if (typeof updates.style.greeting === 'string') {
                updateObj['aiAgentSettings.callFlowEngine.style.greeting'] = updates.style.greeting;
            }
            if (typeof updates.style.companyName === 'string') {
                updateObj['aiAgentSettings.callFlowEngine.style.companyName'] = updates.style.companyName;
            }
        }
        
        // Synonym map
        if (updates.synonymMap && typeof updates.synonymMap === 'object') {
            updateObj['aiAgentSettings.callFlowEngine.synonymMap'] = updates.synonymMap;
        }
        
        // Custom blockers
        if (updates.customBlockers && typeof updates.customBlockers === 'object') {
            updateObj['aiAgentSettings.callFlowEngine.customBlockers'] = updates.customBlockers;
        }
        
        // Trades
        if (Array.isArray(updates.trades)) {
            updateObj['aiAgentSettings.callFlowEngine.trades'] = updates.trades;
        }
        if (typeof updates.activeTrade === 'string') {
            updateObj['aiAgentSettings.callFlowEngine.activeTrade'] = updates.activeTrade;
        }
        
        // Legacy script toggle
        if (typeof updates.legacyScriptActive === 'boolean') {
            updateObj['aiAgentSettings.callFlowEngine.legacyScriptActive'] = updates.legacyScriptActive;
        }
        
        // Metadata
        updateObj['aiAgentSettings.callFlowEngine.lastUpdated'] = new Date();
        updateObj['aiAgentSettings.callFlowEngine.updatedBy'] = req.user?.email || 'system';
        
        await v2Company.updateOne({ _id: companyId }, { $set: updateObj });
        
        // Rebuild mission cache if needed
        if (updates.rebuildCache) {
            await MissionCacheService.rebuildMissionCache(companyId, updates.activeTrade || '_default');
        }
        
        res.json({
            success: true,
            message: 'Call Flow Engine configuration updated'
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] PATCH error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// REBUILD MISSION CACHE
// ============================================================================
router.post('/:companyId/rebuild', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { trade = '_default' } = req.body;
        
        logger.info('[CALL FLOW ENGINE] Rebuilding mission cache for:', companyId);
        
        // Get the sync report with detailed statistics
        const syncResult = await MissionCacheService.rebuildMissionCache(companyId, trade, { returnReport: true });
        const stats = await MissionCacheService.getStats(companyId, trade);
        
        res.json({
            success: true,
            message: 'Mission cache rebuilt successfully',
            data: {
                missionTriggers: syncResult.missionTriggers,
                stats,
                // Detailed sync report for admin feedback
                syncReport: {
                    timestamp: new Date().toISOString(),
                    scanned: {
                        triageCards: syncResult.triageCardsScanned || 0,
                        scenarios: syncResult.scenariosScanned || 0
                    },
                    extracted: syncResult.extracted || {},
                    totals: syncResult.totals || {},
                    newTriggersFound: syncResult.newTriggersFound || 0,
                    sources: syncResult.sources || {}
                }
            }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Rebuild error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// TEST SENTENCE (Debugger)
// ============================================================================
router.post('/:companyId/test', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { sentence, trade = '_default' } = req.body;
        
        if (!sentence || typeof sentence !== 'string') {
            return res.status(400).json({ success: false, message: 'Sentence is required' });
        }
        
        logger.info('[CALL FLOW ENGINE] Testing sentence:', sentence.substring(0, 50));
        
        // Get company config for synonyms/blockers
        const company = await v2Company.findById(companyId).lean();
        const callFlowEngine = company?.aiAgentSettings?.callFlowEngine || {};
        
        const result = await FlowEngine.testSentence(sentence, companyId, {
            trade,
            synonymMap: callFlowEngine.synonymMap || {},
            customBlockers: callFlowEngine.customBlockers || {}
        });
        
        // Also get next step info
        const mockCallState = {
            flow: result.decision.flow,
            data: {},
            confirmed: false,
            executed: false
        };
        
        const nextStep = BookingFlowEngine.getNextStep(mockCallState, {
            bookingFields: callFlowEngine.bookingFields
        });
        
        res.json({
            success: true,
            data: {
                ...result,
                nextStep: {
                    step: nextStep.step,
                    stepType: nextStep.stepType,
                    field: nextStep.field?.key || null,
                    prompt: nextStep.prompt,
                    progress: nextStep.progress
                }
            }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Test error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// GET TRIGGER STATS
// ============================================================================
router.get('/:companyId/stats', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { trade = '_default' } = req.query;
        
        const stats = await MissionCacheService.getStats(companyId, trade);
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Stats error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// ADD MANUAL TRIGGER
// ============================================================================
router.post('/:companyId/trigger', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { flowType, trigger, trade = '_default' } = req.body;
        
        if (!flowType || !trigger) {
            return res.status(400).json({ 
                success: false, 
                message: 'flowType and trigger are required' 
            });
        }
        
        await MissionCacheService.addManualTrigger(companyId, flowType, trigger, trade);
        
        const stats = await MissionCacheService.getStats(companyId, trade);
        
        res.json({
            success: true,
            message: `Added "${trigger}" to ${flowType} triggers`,
            data: { stats }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Add trigger error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// REMOVE MANUAL TRIGGER
// ============================================================================
router.delete('/:companyId/trigger', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { flowType, trigger, trade = '_default' } = req.body;
        
        if (!flowType || !trigger) {
            return res.status(400).json({ 
                success: false, 
                message: 'flowType and trigger are required' 
            });
        }
        
        await MissionCacheService.removeManualTrigger(companyId, flowType, trigger, trade);
        
        const stats = await MissionCacheService.getStats(companyId, trade);
        
        res.json({
            success: true,
            message: `Removed "${trigger}" from ${flowType} triggers`,
            data: { stats }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Remove trigger error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// GET FLOW DEFINITIONS (for UI reference)
// ============================================================================
router.get('/flows/definitions', authenticateJWT, (req, res) => {
    res.json({
        success: true,
        data: {
            flows: BookingFlowEngine.DEFAULT_FLOW_CONFIGS,
            stepTypes: BookingFlowEngine.STEP_TYPES,
            flowPriority: MissionCacheService.FLOW_PRIORITY
        }
    });
});

module.exports = router;


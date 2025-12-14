/**
 * ============================================================================
 * DEBUG API - Session Inspection for Troubleshooting
 * ============================================================================
 * 
 * GET /api/debug/session/:id - Get full session state for debugging
 * 
 * This endpoint returns exactly what the AI sees and why it makes decisions.
 * Use this to understand why the AI asked what it asked.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const ConversationSession = require('../../models/ConversationSession');
const logger = require('../../utils/logger');

/**
 * GET /api/debug/session/:id
 * Returns full session state for debugging
 */
router.get('/session/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Find session by ID
        const session = await ConversationSession.findById(id)
            .populate('customerId', 'name phone email')
            .lean();
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
                sessionId: id
            });
        }
        
        // Build debug response
        const debug = {
            // Session identity
            sessionId: session._id.toString(),
            companyId: session.companyId?.toString(),
            channel: session.channel,
            status: session.status,
            phase: session.phase,
            
            // Timing
            startedAt: session.startedAt,
            lastActivityAt: session.lastActivityAt,
            durationMs: session.lastActivityAt ? 
                new Date(session.lastActivityAt) - new Date(session.startedAt) : null,
            
            // Customer
            customer: session.customerId ? {
                id: session.customerId._id?.toString(),
                name: session.customerId.name,
                phone: session.customerId.phone
            } : null,
            
            // THE KEY DEBUG INFO: Slots
            collectedSlots: session.collectedSlots || {},
            slotsAsArray: Object.entries(session.collectedSlots || {})
                .filter(([k, v]) => v)
                .map(([k, v]) => `${k}: ${v}`),
            
            // Conversation
            turnCount: session.turns?.length || 0,
            turns: (session.turns || []).map((turn, idx) => ({
                turnNumber: idx + 1,
                role: turn.role,
                content: turn.content?.substring(0, 200) + (turn.content?.length > 200 ? '...' : ''),
                timestamp: turn.timestamp,
                latencyMs: turn.latencyMs,
                tokensUsed: turn.tokensUsed,
                responseSource: turn.responseSource,
                slotsExtracted: turn.slotsExtracted
            })),
            
            // Running summary
            runningSummary: session.runningSummary || [],
            
            // Signals
            signals: session.signals || {},
            
            // Outcome
            outcome: session.outcome || {},
            
            // Channel identifiers
            channelIdentifiers: session.channelIdentifiers || {}
        };
        
        logger.info('[DEBUG API] Session retrieved', { 
            sessionId: id, 
            turnCount: debug.turnCount,
            slots: Object.keys(debug.collectedSlots).length
        });
        
        return res.json({
            success: true,
            debug
        });
        
    } catch (error) {
        logger.error('[DEBUG API] Error retrieving session', {
            error: error.message,
            sessionId: req.params.id
        });
        
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/debug/session/:id/slots
 * Quick slot status check
 */
router.get('/session/:id/slots', async (req, res) => {
    try {
        const session = await ConversationSession.findById(req.params.id)
            .select('collectedSlots phase turns')
            .lean();
        
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        const slots = session.collectedSlots || {};
        const slotsList = ['name', 'phone', 'address', 'time'];
        
        return res.json({
            success: true,
            sessionId: req.params.id,
            phase: session.phase,
            turnCount: session.turns?.length || 0,
            slots: {
                collected: Object.entries(slots)
                    .filter(([k, v]) => v)
                    .map(([k, v]) => ({ slot: k, value: v })),
                missing: slotsList.filter(s => !slots[s])
            }
        });
        
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


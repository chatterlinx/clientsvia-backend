/**
 * ============================================================================
 * AI TEST ROUTES - Test the AI agent without making real calls
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
const HybridReceptionistLLM = require('../../services/HybridReceptionistLLM');
const BlackBoxLogger = require('../../services/BlackBoxLogger');
const logger = require('../../utils/logger');

// ============================================================================
// POST /api/admin/ai-test/:companyId/chat
// Simulate a conversation turn with the AI
// ============================================================================
router.post('/:companyId/chat', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { message, sessionId, conversationHistory, knownSlots } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        
        // Load company
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        logger.info('[AI TEST] Processing test message', {
            companyId,
            sessionId,
            messagePreview: message.substring(0, 50),
            historyLength: conversationHistory?.length || 0
        });
        
        // Call the same HybridReceptionistLLM that real calls use
        const startTime = Date.now();
        
        const result = await HybridReceptionistLLM.processConversationTurn({
            companyId,
            company,
            userInput: message,
            conversationHistory: conversationHistory || [],
            knownSlots: knownSlots || {},
            currentMode: 'discovery',
            turnCount: (conversationHistory?.length || 0) / 2 + 1,
            callId: sessionId || `test-${Date.now()}`
        });
        
        const latencyMs = Date.now() - startTime;
        
        // Log to BlackBox for the failure report
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: sessionId,
                companyId,
                type: 'AI_TEST_TURN',
                data: {
                    userInput: message.substring(0, 100),
                    reply: result.reply?.substring(0, 100),
                    latencyMs,
                    needsInfo: result.needsInfo,
                    mode: result.conversationMode,
                    isTest: true
                }
            }).catch(() => {});
        }
        
        res.json({
            success: true,
            reply: result.reply,
            metadata: {
                latencyMs,
                tokensUsed: result.tokensUsed || 0,
                needsInfo: result.needsInfo || 'none',
                mode: result.conversationMode || 'discovery',
                nextGoal: result.nextGoal,
                slots: result.filledSlots
            }
        });
        
    } catch (error) {
        logger.error('[AI TEST] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/admin/ai-test/:companyId/failures
// Get failure report from BlackBox logs
// ============================================================================
router.get('/:companyId/failures', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get BlackBox events for this company from last 24 hours
        let events = [];
        
        if (BlackBoxLogger && typeof BlackBoxLogger.queryEvents === 'function') {
            events = await BlackBoxLogger.queryEvents({
                companyId,
                since: Date.now() - 24 * 60 * 60 * 1000, // 24 hours
                types: ['LLM_RESPONSE', 'LLM_FALLBACK_USED', 'LLM_ERROR', 'AI_TEST_TURN']
            });
        }
        
        // Calculate metrics
        const successCount = events.filter(e => 
            e.type === 'LLM_RESPONSE' && !e.data?.usedFallback
        ).length;
        
        const failureCount = events.filter(e => 
            e.type === 'LLM_FALLBACK_USED' || e.type === 'LLM_ERROR'
        ).length;
        
        const total = successCount + failureCount;
        const successRate = total > 0 ? Math.round((successCount / total) * 100) : 100;
        
        // Calculate average latency
        const latencies = events
            .filter(e => e.data?.latencyMs)
            .map(e => e.data.latencyMs);
        const avgLatency = latencies.length > 0 
            ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
            : 0;
        
        // Find top failure patterns
        const failureTypes = {};
        events
            .filter(e => e.type === 'LLM_FALLBACK_USED' || e.type === 'LLM_ERROR')
            .forEach(e => {
                const type = e.data?.reason || e.data?.error || 'Unknown';
                if (!failureTypes[type]) {
                    failureTypes[type] = { count: 0, example: e.data?.userInput };
                }
                failureTypes[type].count++;
            });
        
        const topFailures = Object.entries(failureTypes)
            .map(([type, data]) => ({ type, ...data }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        
        // Generate suggestions
        const suggestions = [];
        
        if (avgLatency > 1000) {
            suggestions.push('Latency is high - consider reducing prompt complexity');
        }
        if (successRate < 80) {
            suggestions.push('Success rate is low - check BlackBox for common failure patterns');
        }
        if (topFailures.some(f => f.type.includes('parse'))) {
            suggestions.push('JSON parsing issues detected - AI may be returning invalid format');
        }
        if (topFailures.some(f => f.type.includes('timeout'))) {
            suggestions.push('Timeouts occurring - may need to increase LLM timeout');
        }
        if (events.length === 0) {
            suggestions.push('No recent data - make some test calls to gather insights');
        }
        
        res.json({
            success: true,
            report: {
                successCount,
                failureCount,
                successRate,
                avgLatency,
                topFailures,
                suggestions,
                totalEvents: events.length
            }
        });
        
    } catch (error) {
        logger.error('[AI TEST] Failures report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


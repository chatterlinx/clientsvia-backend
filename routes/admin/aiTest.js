/**
 * ============================================================================
 * AI TEST ROUTES - Test the AI agent without making real calls
 * ============================================================================
 * 
 * NOTE: The main AI Test Console now uses /api/chat/message which goes through
 * ConversationEngine. This legacy endpoint is kept for backward compatibility
 * and also uses ConversationEngine for consistent behavior.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
const ConversationEngine = require('../../services/ConversationEngine');
const BookingScriptEngine = require('../../services/BookingScriptEngine');
const BlackBoxLogger = require('../../services/BlackBoxLogger');
const elevenLabsService = require('../../services/v2elevenLabsService');
const logger = require('../../utils/logger');

// ============================================================================
// POST /api/admin/ai-test/:companyId/chat
// Simulate a conversation turn with the AI
// NOTE: Uses ConversationEngine for unified behavior across all channels
// ============================================================================
router.post('/:companyId/chat', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { message, sessionId } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message is required' });
        }
        
        logger.info('[AI TEST] Processing test message via ConversationEngine', {
            companyId,
            sessionId,
            messagePreview: message.substring(0, 50)
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // Call ConversationEngine (same as all other channels)
        // ═══════════════════════════════════════════════════════════════════
        const result = await ConversationEngine.processTurn({
            companyId,
            channel: 'test',
            userText: message,
            sessionId,
            includeDebug: true
        });
        
        // Log to BlackBox for the failure report
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: result.sessionId,
                companyId,
                type: 'AI_TEST_TURN',
                data: {
                    userInput: message.substring(0, 100),
                    reply: result.reply?.substring(0, 100),
                    latencyMs: result.latencyMs,
                    mode: result.conversationMode,
                    engine: 'ConversationEngine',
                    isTest: true
                }
            }).catch(() => {});
        }
        
        res.json({
            success: result.success,
            reply: result.reply,
            metadata: {
                latencyMs: result.latencyMs,
                tokensUsed: result.debug?.tokensUsed || 0,
                needsInfo: result.debug?.needsInfo || 'none',
                mode: result.conversationMode || 'discovery',
                slots: result.slotsCollected
            },
            debug: result.debug
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

// ============================================================================
// POST /api/admin/ai-test/:companyId/tts
// Synthesize speech using company's ElevenLabs voice
// ============================================================================
router.post('/:companyId/tts', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, error: 'Text is required' });
        }
        
        // Load company to get voice settings
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Get voice settings
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};
        const voiceId = voiceSettings.voiceId;
        
        if (!voiceId) {
            return res.status(400).json({ 
                success: false, 
                error: 'No voice selected. Go to Voice Settings to select an ElevenLabs voice.' 
            });
        }
        
        logger.info('[AI TEST] Synthesizing speech', {
            companyId,
            voiceId,
            textLength: text.length
        });
        
        // Synthesize with ElevenLabs
        const audioBuffer = await elevenLabsService.synthesizeSpeech({
            text,
            voiceId,
            stability: voiceSettings.stability || 0.5,
            similarity_boost: voiceSettings.similarityBoost || 0.7,
            style: voiceSettings.style || 0.0,
            use_speaker_boost: voiceSettings.useSpeakerBoost !== false,
            model_id: voiceSettings.modelId || 'eleven_turbo_v2_5',
            company
        });
        
        // Send audio as base64
        const base64Audio = audioBuffer.toString('base64');
        
        res.json({
            success: true,
            audio: base64Audio,
            format: 'mp3',
            voiceId,
            voiceName: voiceSettings.voiceName || voiceId
        });
        
    } catch (error) {
        logger.error('[AI TEST] TTS Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/admin/ai-test/:companyId/voice-info
// Get current voice settings for the company
// ============================================================================
router.get('/:companyId/voice-info', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        const voiceSettings = company.aiAgentSettings?.voiceSettings || {};
        
        // If we have a voiceId but no voiceName, try to look it up from ElevenLabs
        let voiceName = voiceSettings.voiceName;
        if (voiceSettings.voiceId && !voiceName) {
            try {
                // Fetch voices from ElevenLabs to get the name
                const { getSharedElevenLabsConfig } = require('../../clients/index');
                const elevenLabsConfig = await getSharedElevenLabsConfig();
                
                if (elevenLabsConfig?.apiKey) {
                    const voicesResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
                        headers: { 'xi-api-key': elevenLabsConfig.apiKey }
                    });
                    
                    if (voicesResponse.ok) {
                        const voicesData = await voicesResponse.json();
                        const voice = voicesData.voices?.find(v => v.voice_id === voiceSettings.voiceId);
                        if (voice) {
                            voiceName = voice.name;
                            logger.debug(`[AI TEST] Looked up voice name: ${voiceName}`);
                        }
                    }
                }
            } catch (lookupError) {
                logger.debug('[AI TEST] Could not look up voice name:', lookupError.message);
            }
        }
        
        res.json({
            success: true,
            voice: {
                voiceId: voiceSettings.voiceId,
                voiceName: voiceName || (voiceSettings.voiceId ? 'Voice configured' : 'Not set'),
                stability: voiceSettings.stability || 0.5,
                similarityBoost: voiceSettings.similarityBoost || 0.7,
                apiSource: voiceSettings.apiSource || 'clientsvia',
                hasVoice: !!voiceSettings.voiceId
            }
        });
        
    } catch (error) {
        logger.error('[AI TEST] Voice info error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


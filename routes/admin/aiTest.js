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

// ============================================================================
// POST /api/admin/ai-test/supervisor-analysis
// AI Supervisor: ENHANCED - Detailed root cause + copy-paste fixes
// Uses GPT-4o to provide expert, actionable feedback with technical details
// ============================================================================
router.post('/supervisor-analysis', authenticateJWT, async (req, res) => {
    try {
        const { userMessage, aiResponse, recentHistory, debug } = req.body;
        
        if (!userMessage || !aiResponse) {
            return res.status(400).json({ success: false, error: 'userMessage and aiResponse required' });
        }
        
        // Extract technical context from debug snapshot
        const debugSnapshot = debug?.debugSnapshot || {};
        const responseSource = debugSnapshot.responseSource || debug?.responseSource || 'UNKNOWN';
        const scenarioCount = debugSnapshot.scenarioCount || debug?.scenarioCount || 0;
        const mode = debugSnapshot.mode || debug?.mode || 'DISCOVERY';
        const matchedScenario = debugSnapshot.matchedScenario || null;
        const topCandidates = debugSnapshot.topScenarioCandidates || [];
        const customerEmotion = debugSnapshot.customerEmotion || null;
        
        logger.info('[AI SUPERVISOR] Enhanced analysis', {
            userMsgLength: userMessage.length,
            aiResponseLength: aiResponse.length,
            responseSource,
            scenarioCount,
            mode,
            matchedScenario: matchedScenario?.name || 'none'
        });
        
        // Build context for supervisor
        const historyContext = recentHistory && recentHistory.length > 0
            ? recentHistory.map(h => `${h.role === 'user' ? 'Customer' : 'Agent'}: ${h.content}`).join('\n')
            : 'No previous conversation history.';
        
        // Build technical details for deep analysis
        const technicalDetails = `
TECHNICAL DECISION PATH:
- Response Source: ${responseSource}
- Scenarios Loaded: ${scenarioCount}
- Conversation Mode: ${mode}
- Matched Scenario: ${matchedScenario ? `"${matchedScenario.name}" (Category: ${matchedScenario.category || 'Unknown'})` : 'None - Used LLM fallback'}
${topCandidates.length > 0 ? `- Top Candidates (didn't match):
${topCandidates.slice(0, 3).map(c => `  • "${c.name}" - ${c.score}% match (missing: ${c.missingTriggers?.join(', ') || 'unknown'})`).join('\n')}` : ''}
${customerEmotion ? `- Detected Customer Emotion: ${customerEmotion}` : ''}
`;
        
        // Build enhanced analysis prompt
        const supervisorPrompt = `You are a SENIOR AI DEVELOPER and QA expert analyzing AI agent conversations for service businesses.

Your job: Provide detailed ROOT CAUSE analysis and COPY-PASTE READY FIXES.

CONVERSATION CONTEXT:
${historyContext}

CURRENT TURN:
Customer: "${userMessage}"
Agent: "${aiResponse}"

${technicalDetails}

YOUR TASK - DETAILED ANALYSIS:

1. QUALITY ASSESSMENT (0-100):
   - Tone matching (urgent/casual/formal)
   - Relevance to customer question
   - Empathy and professionalism
   - Conciseness (not too wordy)
   - Forward progress (booking/solving issue)

2. ROOT CAUSE ANALYSIS (Technical):
   - WHY did this response happen?
   - If LLM fallback: What triggers are MISSING?
   - If scenario matched: Was it the RIGHT scenario?
   - If wrong tone: Detect customer emotion (urgent/frustrated/casual)

3. MISSING TRIGGER DETECTION:
   Extract key phrases from customer input that should trigger scenarios but don't.
   Examples:
   - "I'm dying here" → Emergency urgency
   - "how much" → Pricing question
   - "feeling hot" → Discomfort/emergency

4. COPY-PASTE FIXES:
   Provide EXACT triggers to add, which scenario to edit, and response template.

Return JSON:
{
  "qualityScore": 0-100,
  "issues": ["Specific issue 1", "Specific issue 2"],
  "suggestions": ["Actionable suggestion 1", "Actionable suggestion 2"],
  "overallFeedback": "Brief summary",
  "rootCause": {
    "why": "Technical explanation of why this response was generated",
    "matchingIssue": "Scenario matching problem (if any)",
    "customerTone": "urgent/casual/frustrated/confused/etc",
    "agentTone": "professional/casual/robotic/empathetic/etc",
    "toneMismatch": true/false
  },
  "missingTriggers": [
    {
      "phrase": "exact phrase from customer",
      "category": "Emergency/Pricing/Booking/etc",
      "priority": "CRITICAL/HIGH/MEDIUM"
    }
  ],
  "copyPasteFix": {
    "hasIssue": true/false,
    "scenarioToEdit": "Name of scenario to edit (or 'CREATE NEW')",
    "categoryName": "Category for new/existing scenario",
    "triggersToAdd": ["trigger 1", "trigger 2", "trigger 3"],
    "responseTemplate": "Exact response the agent should say instead",
    "expectedImprovement": "What will improve after this fix"
  }
}

RULES:
- Be BRUTALLY HONEST about quality issues
- Provide ACTIONABLE, SPECIFIC fixes (not vague advice)
- Focus on CUSTOMER EXPERIENCE (not technical perfection)
- If response is good, qualityScore = 80-100
- If response is acceptable but could improve, qualityScore = 60-79
- If response is poor/wrong, qualityScore = 0-59`;

        // Call OpenAI for enhanced supervisor analysis
        const { getOpenAIClient } = require('../../utils/openaiClient');
        const openai = getOpenAIClient();
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { 
                    role: 'system', 
                    content: 'You are a senior AI developer and QA expert. Provide detailed technical analysis with actionable, copy-paste ready fixes. Be specific, not vague.' 
                },
                { role: 'user', content: supervisorPrompt }
            ],
            temperature: 0.3, // Lower temp for more consistent technical analysis
            max_tokens: 1500, // Increased for detailed analysis
            response_format: { type: 'json_object' }
        });
        
        const analysisText = completion.choices[0].message.content;
        const analysis = JSON.parse(analysisText);
        
        // Ensure required fields with enhanced structure
        if (!analysis.qualityScore) analysis.qualityScore = 50;
        if (!analysis.issues) analysis.issues = [];
        if (!analysis.suggestions) analysis.suggestions = [];
        if (!analysis.overallFeedback) analysis.overallFeedback = 'Analysis completed.';
        if (!analysis.rootCause) analysis.rootCause = { why: 'Unknown', toneMismatch: false };
        if (!analysis.missingTriggers) analysis.missingTriggers = [];
        if (!analysis.copyPasteFix) analysis.copyPasteFix = { hasIssue: false };
        
        logger.info('[AI SUPERVISOR] Analysis complete', {
            qualityScore: analysis.qualityScore,
            issuesFound: analysis.issues.length,
            missingTriggers: analysis.missingTriggers.length,
            hasCopyPasteFix: analysis.copyPasteFix.hasIssue
        });
        
        res.json({
            success: true,
            analysis,
            tokensUsed: completion.usage.total_tokens
        });
        
    } catch (error) {
        logger.error('[AI SUPERVISOR] Analysis error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            // Return a basic fallback analysis so UI doesn't break
            analysis: {
                qualityScore: 50,
                issues: ['Supervisor analysis temporarily unavailable'],
                suggestions: ['Try again later'],
                overallFeedback: 'Analysis service encountered an error',
                rootCause: { why: 'Service error', toneMismatch: false },
                missingTriggers: [],
                copyPasteFix: { hasIssue: false }
            }
        });
    }
});

module.exports = router;


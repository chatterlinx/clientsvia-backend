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
        
        // Clear company cache so changes take effect immediately
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                logger.info('[CALL FLOW ENGINE] Cleared company cache');
            }
        } catch (cacheErr) {
            logger.warn('[CALL FLOW ENGINE] Cache clear failed (non-critical):', cacheErr.message);
        }
        
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
// TEST SENTENCE (Simple - Flow Engine only)
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
// TEST SENTENCE - FULL DIAGNOSTIC (Traces through ALL layers)
// ============================================================================
// This endpoint simulates a COMPLETE call routing to show admins exactly
// what would happen: Flow Engine → Triage → 3-Tier → Response
// ============================================================================
router.post('/:companyId/test-full', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { sentence, trade = '_default' } = req.body;
        
        if (!sentence || typeof sentence !== 'string') {
            return res.status(400).json({ success: false, message: 'Sentence is required' });
        }
        
        logger.info('[CALL FLOW ENGINE] FULL DIAGNOSTIC TEST:', sentence.substring(0, 80));
        
        // Load company and template
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const callFlowEngine = company?.aiAgentSettings?.callFlowEngine || {};
        
        // Initialize diagnostic trace
        const trace = {
            input: sentence,
            timestamp: new Date().toISOString(),
            steps: [],
            issues: [],
            suggestions: []
        };
        
        // ════════════════════════════════════════════════════════════════════════
        // STEP 1: FLOW ENGINE
        // ════════════════════════════════════════════════════════════════════════
        let flowResult = null;
        try {
            flowResult = await FlowEngine.testSentence(sentence, companyId, {
                trade,
                synonymMap: callFlowEngine.synonymMap || {},
                customBlockers: callFlowEngine.customBlockers || {}
            });
            
            trace.steps.push({
                step: 1,
                name: 'Flow Engine',
                status: 'OK',
                result: {
                    flow: flowResult.decision?.flow || 'GENERAL_INQUIRY',
                    confidence: flowResult.decision?.confidence || 0,
                    matchedTrigger: flowResult.decision?.matchedTrigger || null,
                    blockerHit: flowResult.decision?.blockerHit || false
                }
            });
            
            // Check for issues
            if (!flowResult.decision?.matchedTrigger && flowResult.decision?.flow !== 'GENERAL_INQUIRY') {
                trace.issues.push({
                    step: 1,
                    severity: 'warning',
                    message: `Flow "${flowResult.decision?.flow}" detected but no explicit trigger matched`
                });
            }
        } catch (flowError) {
            trace.steps.push({
                step: 1,
                name: 'Flow Engine',
                status: 'ERROR',
                error: flowError.message
            });
            trace.issues.push({
                step: 1,
                severity: 'error',
                message: `Flow Engine failed: ${flowError.message}`
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // STEP 1.5: QUICK ANSWERS CHECK
        // ════════════════════════════════════════════════════════════════════════
        let quickAnswerResult = null;
        try {
            const quickAnswers = callFlowEngine.quickAnswers || [];
            const lowerInput = sentence.toLowerCase();
            
            // Find matching quick answer by triggers
            let matchedQA = null;
            let matchedTrigger = null;
            
            for (const qa of quickAnswers) {
                if (!qa.enabled) continue;
                
                for (const trigger of (qa.triggers || [])) {
                    if (lowerInput.includes(trigger.toLowerCase())) {
                        matchedQA = qa;
                        matchedTrigger = trigger;
                        break;
                    }
                }
                if (matchedQA) break;
            }
            
            if (matchedQA) {
                quickAnswerResult = {
                    matched: true,
                    question: matchedQA.question,
                    answer: matchedQA.answer?.substring(0, 150) + (matchedQA.answer?.length > 150 ? '...' : ''),
                    category: matchedQA.category,
                    matchedTrigger
                };
                
                trace.steps.push({
                    step: 1.5,
                    name: 'Quick Answers',
                    status: 'MATCHED',
                    result: quickAnswerResult
                });
            } else {
                trace.steps.push({
                    step: 1.5,
                    name: 'Quick Answers',
                    status: 'NO_MATCH',
                    result: {
                        matched: false,
                        answersChecked: quickAnswers.filter(qa => qa.enabled).length,
                        note: 'No quick answer triggers matched'
                    }
                });
            }
        } catch (qaError) {
            trace.steps.push({
                step: 1.5,
                name: 'Quick Answers',
                status: 'ERROR',
                error: qaError.message
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // STEP 2: TRIAGE CARD MATCHING
        // ════════════════════════════════════════════════════════════════════════
        let triageResult = null;
        try {
            const TriageCard = require('../../models/TriageCard');
            
            // Load active triage cards
            const cards = await TriageCard.find({
                companyId,
                active: true
            }).sort({ priority: -1 }).lean();
            
            // Try to find a matching card
            const lowerInput = sentence.toLowerCase();
            let matchedCard = null;
            let matchedKeyword = null;
            
            for (const card of cards) {
                const mustHave = card.quickRuleConfig?.keywordsMustHave || [];
                const exclude = card.quickRuleConfig?.keywordsExclude || [];
                
                // Check exclusions first
                const excluded = exclude.some(kw => lowerInput.includes(kw.toLowerCase()));
                if (excluded) continue;
                
                // Check must-have keywords
                for (const kw of mustHave) {
                    if (lowerInput.includes(kw.toLowerCase())) {
                        matchedCard = card;
                        matchedKeyword = kw;
                        break;
                    }
                }
                if (matchedCard) break;
            }
            
            if (matchedCard) {
                triageResult = {
                    matched: true,
                    cardId: matchedCard._id.toString(),
                    cardName: matchedCard.displayName || matchedCard.triageLabel,
                    action: matchedCard.quickRuleConfig?.action || 'DIRECT_TO_3TIER',
                    matchedKeyword,
                    priority: matchedCard.priority,
                    threeTierLink: matchedCard.threeTierLink || null
                };
                
                trace.steps.push({
                    step: 2,
                    name: 'Triage Match',
                    status: 'MATCHED',
                    result: triageResult
                });
            } else {
                trace.steps.push({
                    step: 2,
                    name: 'Triage Match',
                    status: 'NO_MATCH',
                    result: {
                        matched: false,
                        cardsChecked: cards.length,
                        note: 'No triage card keywords matched this input'
                    }
                });
                
                trace.issues.push({
                    step: 2,
                    severity: 'warning',
                    message: 'No triage card matched - will use 3-tier fallback'
                });
                
                trace.suggestions.push({
                    type: 'CREATE_TRIAGE_CARD',
                    message: `Consider creating a triage card for: "${sentence.substring(0, 50)}"`,
                    suggestedKeywords: extractKeywords(sentence)
                });
            }
        } catch (triageError) {
            trace.steps.push({
                step: 2,
                name: 'Triage Match',
                status: 'ERROR',
                error: triageError.message
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // STEP 3: 3-TIER INTELLIGENCE
        // ════════════════════════════════════════════════════════════════════════
        let tier3Result = null;
        try {
            // Load template for the company
            const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
            const template = await GlobalInstantResponseTemplate.findById(company.globalTemplateId).lean();
            
            if (!template) {
                trace.steps.push({
                    step: 3,
                    name: '3-Tier Intelligence',
                    status: 'SKIPPED',
                    result: {
                        reason: 'No template found for company'
                    }
                });
                trace.issues.push({
                    step: 3,
                    severity: 'error',
                    message: 'No template assigned to company - 3-tier cannot run'
                });
            } else {
                const IntelligentRouter = require('../../services/IntelligentRouter');
                const router = new IntelligentRouter();
                
                // Run through 3-tier (this is the REAL test)
                const routeResult = await router.route({
                    callerInput: sentence,
                    template,
                    company,
                    callId: `test-${Date.now()}`,
                    context: {
                        isTest: true,
                        flowDecision: flowResult?.decision?.flow
                    }
                });
                
                tier3Result = {
                    tierUsed: routeResult.tierUsed,
                    matched: routeResult.matched,
                    confidence: routeResult.confidence,
                    scenario: routeResult.scenario ? {
                        key: routeResult.scenario.key || routeResult.scenario.scenarioKey,
                        name: routeResult.scenario.name || routeResult.scenario.scenarioLabel,
                        category: routeResult.scenario.category || routeResult.scenario.categoryKey
                    } : null,
                    responsePreview: routeResult.response?.substring(0, 200),
                    cost: routeResult.cost,
                    performance: routeResult.performance
                };
                
                trace.steps.push({
                    step: 3,
                    name: '3-Tier Intelligence',
                    status: routeResult.matched ? 'MATCHED' : 'FALLBACK',
                    result: tier3Result
                });
                
                // Check for issues
                if (routeResult.tierUsed === 3) {
                    trace.issues.push({
                        step: 3,
                        severity: 'info',
                        message: 'Used Tier 3 (LLM) - costs money! Consider adding scenario coverage.'
                    });
                    
                    if (routeResult.patternsLearned?.length > 0) {
                        trace.suggestions.push({
                            type: 'PATTERNS_LEARNED',
                            message: 'LLM learned new patterns that will improve Tier 1',
                            patterns: routeResult.patternsLearned
                        });
                    }
                }
                
                if (!routeResult.matched) {
                    trace.issues.push({
                        step: 3,
                        severity: 'warning',
                        message: 'No scenario matched - generic response used'
                    });
                    
                    trace.suggestions.push({
                        type: 'CREATE_SCENARIO',
                        message: `Consider creating a scenario for this type of request`,
                        suggestedCategory: guessCategory(sentence),
                        suggestedTriggers: extractKeywords(sentence)
                    });
                }
            }
        } catch (tier3Error) {
            trace.steps.push({
                step: 3,
                name: '3-Tier Intelligence',
                status: 'ERROR',
                error: tier3Error.message
            });
            trace.issues.push({
                step: 3,
                severity: 'error',
                message: `3-Tier failed: ${tier3Error.message}`
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // STEP 4: FINAL ACTION SUMMARY
        // ════════════════════════════════════════════════════════════════════════
        const finalAction = determineFinalAction(flowResult, triageResult, tier3Result);
        
        trace.steps.push({
            step: 4,
            name: 'Final Action',
            status: 'COMPLETE',
            result: finalAction
        });
        
        // ════════════════════════════════════════════════════════════════════════
        // GENERATE DIAGNOSTIC SUMMARY
        // ════════════════════════════════════════════════════════════════════════
        const summary = {
            verdict: trace.issues.filter(i => i.severity === 'error').length > 0 ? 'ISSUES_FOUND' :
                     trace.issues.filter(i => i.severity === 'warning').length > 0 ? 'WARNINGS' : 'OK',
            issueCount: trace.issues.length,
            suggestionCount: trace.suggestions.length,
            estimatedCost: tier3Result?.cost?.total || 0,
            estimatedLatency: tier3Result?.performance?.totalTime || 0,
            wouldUseLLM: tier3Result?.tierUsed === 3
        };
        
        res.json({
            success: true,
            data: {
                trace,
                summary
            }
        });
        
    } catch (error) {
        logger.error('[CALL FLOW ENGINE] Full diagnostic test error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Helper: Extract keywords from a sentence
function extractKeywords(sentence) {
    const stopWords = ['i', 'me', 'my', 'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'in', 'it', 'for', 'on', 'with', 'as', 'at', 'by', 'this', 'that', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'need', 'want', 'please', 'hi', 'hello', 'hey'];
    
    return sentence.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.includes(w))
        .slice(0, 5);
}

// Helper: Guess category from sentence
function guessCategory(sentence) {
    const lower = sentence.toLowerCase();
    
    if (/thermostat|temperature|degrees|heat|cold/.test(lower)) return 'Thermostat Issues';
    if (/ac|air condition|cooling|not cool|warm air/.test(lower)) return 'AC Issues';
    if (/furnace|heater|heating|no heat/.test(lower)) return 'Heating Issues';
    if (/leak|water|drip|flooding/.test(lower)) return 'Water/Leak Issues';
    if (/noise|sound|loud|buzzing|clicking/.test(lower)) return 'Noise Issues';
    if (/smell|odor|gas|burning/.test(lower)) return 'Safety/Odor Issues';
    if (/maintenance|tune.?up|annual|service/.test(lower)) return 'Maintenance';
    if (/install|new|replace/.test(lower)) return 'Installation';
    
    return 'General';
}

// Helper: Determine final action from all results
function determineFinalAction(flowResult, triageResult, tier3Result) {
    const flow = flowResult?.decision?.flow || 'GENERAL_INQUIRY';
    
    // Direct booking flow
    if (flow === 'BOOKING' || flow === 'booking') {
        return {
            action: 'BOOKING_FLOW',
            nextStep: 'ASK_NAME',
            prompt: 'What is your name?',
            source: 'FLOW_ENGINE'
        };
    }
    
    // Emergency
    if (flow === 'EMERGENCY' || flow === 'emergency') {
        return {
            action: 'EMERGENCY_TRANSFER',
            nextStep: 'TRANSFER',
            prompt: 'Transferring to emergency line...',
            source: 'FLOW_ENGINE'
        };
    }
    
    // Cancel/Reschedule
    if (flow === 'CANCEL' || flow === 'cancel') {
        return {
            action: 'CANCEL_FLOW',
            nextStep: 'VERIFY_APPOINTMENT',
            source: 'FLOW_ENGINE'
        };
    }
    
    // Triage matched - use its action
    if (triageResult?.matched) {
        const actionMap = {
            'BOOK_APPOINTMENT': { action: 'BOOKING_FLOW', nextStep: 'ASK_NAME' },
            'DIRECT_TO_3TIER': { action: 'SCENARIO_RESPONSE', nextStep: 'RESPOND' },
            'EXPLAIN_AND_PUSH': { action: 'EXPLAIN_THEN_BOOK', nextStep: 'RESPOND_THEN_ASK_NAME' },
            'TRANSFER': { action: 'TRANSFER', nextStep: 'TRANSFER' }
        };
        
        return {
            ...(actionMap[triageResult.action] || { action: 'SCENARIO_RESPONSE', nextStep: 'RESPOND' }),
            triageCard: triageResult.cardName,
            source: 'TRIAGE_CARD'
        };
    }
    
    // 3-tier matched
    if (tier3Result?.matched) {
        return {
            action: 'SCENARIO_RESPONSE',
            nextStep: 'RESPOND',
            scenario: tier3Result.scenario?.name,
            responsePreview: tier3Result.responsePreview,
            source: `TIER_${tier3Result.tierUsed}`
        };
    }
    
    // Fallback
    return {
        action: 'LLM_FALLBACK',
        nextStep: 'RESPOND',
        responsePreview: tier3Result?.responsePreview || 'How can I help you?',
        source: 'TIER_3_LLM',
        warning: 'No fast-match coverage - using expensive LLM'
    };
}

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


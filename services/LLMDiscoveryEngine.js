/**
 * ============================================================================
 * LLM DISCOVERY ENGINE - V22 LLM-LED ARCHITECTURE
 * ============================================================================
 * 
 * CORE PHILOSOPHY:
 * - LLM is the PRIMARY BRAIN (not fallback)
 * - Scenarios are TOOLS (not scripts)
 * - Booking is DETERMINISTIC (only after consent)
 * - No triage gates, no pre-routing, no forced categories
 * 
 * THE GOLDEN RULE:
 * "Nothing should bypass the LLM during discovery."
 * 
 * FLOW:
 * 1. Caller speaks
 * 2. LLM decides what to do (ask question, reassure, retrieve scenarios)
 * 3. LLM responds naturally using scenario knowledge
 * 4. Consent detected → deterministic booking
 * 
 * LATENCY TARGET: < 1.2s per turn
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const ScenarioPoolService = require('./ScenarioPoolService');
const HybridScenarioSelector = require('./HybridScenarioSelector');

// Version banner
const ENGINE_VERSION = 'V22-LLM-LED-DISCOVERY';
logger.info(`[LLM DISCOVERY ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`, {
    philosophy: [
        '✅ LLM is PRIMARY BRAIN (not fallback)',
        '✅ Scenarios are TOOLS (not scripts)',
        '✅ Booking is DETERMINISTIC (consent-gated)',
        '✅ No triage gates, no pre-routing',
        '✅ No hardcoded responses in discovery'
    ]
});

class LLMDiscoveryEngine {
    
    /**
     * ========================================================================
     * TOOL: retrieveRelevantScenarios
     * ========================================================================
     * 
     * PURPOSE: Provide the LLM with relevant, safe knowledge from scenarios.
     * This is a READ-ONLY tool - it does NOT auto-respond or trigger booking.
     * 
     * The LLM uses this knowledge to inform its response, but speaks naturally.
     * 
     * @param {Object} params
     * @param {string} params.companyId - Company ID
     * @param {string} params.trade - Trade type (HVAC, DENTAL, etc.)
     * @param {string} params.utterance - Caller's speech
     * @param {Object} params.template - Active template with NLP config
     * @returns {Promise<Object>} { scenarios: Array<ScenarioSummary>, retrievalTimeMs }
     */
    static async retrieveRelevantScenarios({ companyId, trade, utterance, template }) {
        const startTime = Date.now();
        let poolResult = null;
        
        try {
            logger.info('[LLM DISCOVERY] 🔍 Retrieving relevant scenarios...', {
                companyId,
                trade,
                utterancePreview: utterance?.substring(0, 50)
            });
            
            // Step 1: Get scenario pool for this company
            poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            const allScenarios = poolResult?.scenarios || [];
            
            if (!allScenarios || allScenarios.length === 0) {
                logger.warn('[LLM DISCOVERY] ⚠️ No scenarios available for company', { companyId });
                return {
                    scenarios: [],
                    retrievalTimeMs: Date.now() - startTime,
                    message: 'NO_SCENARIOS_AVAILABLE',
                    effectiveConfigVersion: poolResult?.effectiveConfigVersion || null
                };
            }
            
            // Step 2: Filter to enabled scenarios only
            const enabledScenarios = allScenarios.filter(s => s.isEnabledForCompany !== false);
            
            // Step 3: Build selector with template NLP config
            const fillerWords = template?.fillerWords || template?.nlpConfig?.fillerWords || [];
            const urgencyKeywords = template?.urgencyKeywords || [];
            const synonymMap = template?.synonymMap || template?.nlpConfig?.synonyms || {};
            
            // 🚀 Feature flag: Use compiled indexes for fast lookup
            // Scope precedence: company > template > global default (true)
            // This allows per-company override without affecting other companies on same template
            const companyFastLookup = poolResult?.companySettings?.performance?.useFastLookup;
            const templateFastLookup = template?.performance?.useFastLookup;
            const useFastLookup = companyFastLookup !== undefined 
                ? companyFastLookup !== false 
                : (templateFastLookup !== undefined ? templateFastLookup !== false : true);
            
            const selector = new HybridScenarioSelector(fillerWords, urgencyKeywords, synonymMap, {
                useFastLookup
            });
            
            // 🚀 CRITICAL: Wire compiled pool for O(1) matching
            // This is what makes the fast lookup actually work in production
            if (poolResult?.compiled && useFastLookup) {
                selector.setCompiledPool(poolResult.compiled);
                logger.debug('[LLM DISCOVERY] ⚡ Compiled pool wired to selector', {
                    specCount: poolResult.compiled.specs?.length || 0,
                    indexSize: poolResult.compiled.stats?.indexSize || 0,
                    compileTimeMs: poolResult.compiled.stats?.compileTimeMs || 0
                });
            }
            
            // Step 4: Find relevant scenarios (selector API is selectScenario())
            // NOTE: For LLM tool context we can include lower-confidence candidates; LLM decides relevance.
            const toolCfg = (template?.nlpConfig && typeof template.nlpConfig === 'object')
                ? (template.nlpConfig.llmToolConfig || {})
                : {};
            const toolTopN = Number.isFinite(toolCfg.topN) ? toolCfg.topN : 3;
            const minToolConfidence = Number.isFinite(toolCfg.minToolConfidence)
                ? toolCfg.minToolConfidence
                : (Number.isFinite(template?.nlpConfig?.llmToolMinConfidence) ? template.nlpConfig.llmToolMinConfidence : 0.35);
            
            const matchResult = await selector.selectScenario(utterance, enabledScenarios, {
                trade,
                companyId,
                // Intentionally do not pass heavy conversation state; keep fast.
            });
            
            // Step 5: Build scenario summaries (compressed for LLM)
            const scenarioSummaries = [];
            const scenarioById = new Map();
            for (const s of enabledScenarios) {
                if (!s || typeof s !== 'object') continue;
                const keys = [
                    s.scenarioId,
                    s.id,
                    s._id,
                    s.scenarioKey
                ].filter(Boolean).map(v => String(v).trim());
                for (const k of keys) {
                    if (!scenarioById.has(k)) scenarioById.set(k, s);
                }
            }
            
            const candidates = [];
            
            // Primary match (if above selector thresholds)
            if (matchResult?.scenario) {
                candidates.push({ scenario: matchResult.scenario, confidence: matchResult.confidence ?? 0 });
            }
            
            // Fallback: use trace topCandidates even if no scenario was returned (below threshold)
            const topCandidates = matchResult?.trace?.topCandidates || [];
            for (const c of topCandidates) {
                const id = c?.scenarioId ? String(c.scenarioId) : null;
                if (!id) continue;
                const scenario = scenarioById.get(id);
                if (!scenario) continue;
                
                const conf = typeof c.confidence === 'string' ? Number(c.confidence) : Number(c.confidence ?? 0);
                candidates.push({ scenario, confidence: Number.isFinite(conf) ? conf : 0 });
            }
            
            // Dedupe by scenarioId and apply min confidence filter
            const seen = new Set();
            for (const c of candidates) {
                const id = String(c.scenario?.scenarioId || c.scenario?.id || '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                if ((c.confidence ?? 0) < minToolConfidence) continue;
                
                scenarioSummaries.push(this._buildScenarioSummary(c.scenario, c.confidence, toolCfg));
                if (scenarioSummaries.length >= toolTopN) break;
            }

            // Absolute fallback: if selector produced candidates but all were filtered out,
            // include the top candidate anyway so the LLM has *some* relevant tool context.
            if (scenarioSummaries.length === 0 && candidates.length > 0) {
                const best = candidates
                    .filter(c => c?.scenario)
                    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
                
                if (best?.scenario) {
                    scenarioSummaries.push(this._buildScenarioSummary(best.scenario, best.confidence ?? 0, toolCfg));
                }
            }
            
            const retrievalTimeMs = Date.now() - startTime;
            
            if (scenarioSummaries.length === 0) {
                const top = (matchResult?.trace?.topCandidates || [])[0] || null;
                logger.warn('[LLM DISCOVERY] ⚠️ No scenario tools returned (debug)', {
                    companyId,
                    trade,
                    utterancePreview: utterance?.substring(0, 50),
                    enabledScenarioCount: enabledScenarios.length,
                    toolTopN,
                    minToolConfidence,
                    selectorSelected: matchResult?.scenario?.name || null,
                    selectorConfidence: matchResult?.confidence ?? null,
                    selectorReason: matchResult?.trace?.selectionReason || null,
                    topCandidate: top ? {
                        scenarioId: top.scenarioId,
                        name: top.name,
                        confidence: top.confidence,
                        score: top.score
                    } : null
                });
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // V2: RETURN TOP MATCH FOR TIER-1 SHORT-CIRCUIT
            // ═══════════════════════════════════════════════════════════════════
            // If we have a high-confidence direct match, include the FULL scenario
            // so ConversationEngine can short-circuit the LLM and use it directly.
            // ═══════════════════════════════════════════════════════════════════
            const topMatch = matchResult?.scenario ? {
                scenarioId: matchResult.scenario.scenarioId || matchResult.scenario._id,
                name: matchResult.scenario.name,
                confidence: matchResult.confidence ?? 0,
                quickReplies: matchResult.scenario.quickReplies || [],
                fullReplies: matchResult.scenario.fullReplies || [],
                scenarioType: matchResult.scenario.scenarioType,
                categoryName: matchResult.scenario.categoryName,
                priority: matchResult.scenario.priority || 0,
                // Include triggers for debugging
                triggers: matchResult.scenario.triggers || []
            } : null;
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 MATCHING TRACE - For observability and proving fast lookup works
            // ═══════════════════════════════════════════════════════════════════
            const matchingTrace = {
                // Fast lookup status
                fastLookupAvailable: matchResult?.trace?.fastLookup?.available ?? false,
                fastLookupMethod: matchResult?.trace?.fastLookup?.method || null,
                usedFastCandidates: matchResult?.trace?.usedFastCandidates ?? false,
                
                // Match details
                matchMethod: matchResult?.matchMethod || matchResult?.trace?.matchMethod || 'unknown',
                scenarioIdMatched: matchResult?.scenario?.scenarioId || null,
                scenarioNameMatched: matchResult?.scenario?.name || null,
                matchConfidence: matchResult?.confidence ?? 0,
                
                // Candidate stats (proves optimization)
                candidateCount: matchResult?.trace?.fastLookup?.candidateCount ?? matchResult?.trace?.scenariosEvaluated ?? 0,
                totalPoolSize: enabledScenarios.length,
                candidateReduction: matchResult?.trace?.usedFastCandidates 
                    ? `${((1 - (matchResult.trace.scenariosEvaluated / enabledScenarios.length)) * 100).toFixed(1)}%`
                    : '0%',
                
                // Applied settings (proves utilization)
                appliedSettings: matchResult?.appliedSettings || matchResult?.trace?.appliedSettings || [],
                
                // Latency breakdown
                timingMs: {
                    fastLookup: matchResult?.trace?.timingMs?.fastLookup ?? 0,
                    normalize: matchResult?.trace?.timingMs?.normalize ?? 0,
                    filter: matchResult?.trace?.timingMs?.filter ?? 0,
                    scoring: matchResult?.trace?.timingMs?.scoring ?? 0,
                    selection: matchResult?.trace?.timingMs?.selection ?? 0,
                    total: matchResult?.trace?.timingMs?.total ?? 0
                }
            };
            
            logger.info('[LLM DISCOVERY] ✅ Scenarios retrieved', {
                count: scenarioSummaries.length,
                retrievalTimeMs,
                topScenario: scenarioSummaries[0]?.title,
                // V2: Log match info
                topMatchConfidence: topMatch?.confidence ?? 0,
                topMatchName: topMatch?.name || null,
                // 🚀 Fast lookup proof
                matchMethod: matchingTrace.matchMethod,
                fastLookupUsed: matchingTrace.usedFastCandidates,
                candidateReduction: matchingTrace.candidateReduction,
                matchTimeMs: matchingTrace.timingMs.total
            });
            
            return {
                scenarios: scenarioSummaries,
                retrievalTimeMs,
                totalAvailable: enabledScenarios.length,
                effectiveConfigVersion: poolResult?.effectiveConfigVersion || null,
                // ═══════════════════════════════════════════════════════════════
                // V2: TOP MATCH INFO FOR TIER-1 SHORT-CIRCUIT
                // ConversationEngine can check topMatchConfidence >= threshold
                // and use topMatch.quickReplies/fullReplies directly without LLM
                // ═══════════════════════════════════════════════════════════════
                topMatch,
                topMatchConfidence: topMatch?.confidence ?? 0,
                // ═══════════════════════════════════════════════════════════════
                // 🚀 MATCHING TRACE - For BlackBoxLogger and production observability
                // ═══════════════════════════════════════════════════════════════
                matchingTrace
            };
            
        } catch (error) {
            logger.error('[LLM DISCOVERY] ❌ Scenario retrieval failed', {
                error: error.message,
                companyId
            });
            
            return {
                scenarios: [],
                retrievalTimeMs: Date.now() - startTime,
                effectiveConfigVersion: poolResult?.effectiveConfigVersion || null,
                error: error.message
            };
        }
    }
    
    /**
     * Build a compressed scenario summary for LLM context
     * This keeps token usage low while providing useful knowledge
     */
    static _buildScenarioSummary(scenario, confidence, toolCfg = {}) {
        const cfg = (toolCfg && typeof toolCfg === 'object') ? toolCfg : {};
        const maxQuickReplies = Number.isFinite(cfg.maxQuickReplies) ? cfg.maxQuickReplies : 2;
        const maxFullReplies = Number.isFinite(cfg.maxFullReplies) ? cfg.maxFullReplies : 2;
        const maxCharsPerReply = Number.isFinite(cfg.maxCharsPerReply) ? cfg.maxCharsPerReply : 260;
        const maxTotalCharsPerScenario = Number.isFinite(cfg.maxTotalCharsPerScenario) ? cfg.maxTotalCharsPerScenario : 900;
        
        const includeQuickReplies = cfg.includeQuickReplies !== false;
        const includeFullReplies = cfg.includeFullReplies !== false;
        const includeTriggers = cfg.includeTriggers === true;
        // V90: Default these to TRUE so LLM gets full scenario context for better matching
        const includeRegexTriggers = cfg.includeRegexTriggers !== false;
        const includeNegativeTriggers = cfg.includeNegativeTriggers !== false;
        const includeFollowUp = cfg.includeFollowUp !== false;
        const includeScenarioType = cfg.includeScenarioType !== false;
        const includeBehavior = cfg.includeBehavior !== false;
        
        const truncate = (s, maxChars) => {
            const str = (s || '').toString();
            if (str.length <= maxChars) return str;
            return str.substring(0, Math.max(0, maxChars - 3)) + '...';
        };
        
        const extractReplyTexts = (arr, maxItems) => {
            if (!Array.isArray(arr) || maxItems <= 0) return [];
            const out = [];
            for (const item of arr) {
                if (out.length >= maxItems) break;
                const raw = (typeof item === 'string') ? item : (item?.text || '');
                const trimmed = (raw || '').toString().trim();
                if (!trimmed) continue;
                out.push(truncate(trimmed, maxCharsPerReply));
            }
            return out;
        };
        
        const quickSamples = includeQuickReplies ? extractReplyTexts(scenario.quickReplies, maxQuickReplies) : [];
        const fullSamples = includeFullReplies ? extractReplyTexts(scenario.fullReplies, maxFullReplies) : [];
        
        // Build a compact knowledge string (bounded)
        const knowledgeParts = [];
        if (fullSamples.length > 0) knowledgeParts.push(`Full reply examples: ${fullSamples.map(t => `"${t}"`).join(' | ')}`);
        if (quickSamples.length > 0) knowledgeParts.push(`Quick reply examples: ${quickSamples.map(t => `"${t}"`).join(' | ')}`);
        let knowledge = knowledgeParts.join('\n');
        knowledge = truncate(knowledge, maxTotalCharsPerScenario);
        
        const category = scenario.categoryName || scenario.categories?.[0] || 'General';
        const scenarioType = (scenario.scenarioType || 'UNKNOWN').toString().trim().toUpperCase();
        
        const summary = {
            scenarioId: scenario.scenarioId || scenario.id,
            templateId: scenario.templateId || null,
            title: scenario.name || scenario.title || 'Unknown',
            category,
            scenarioType: includeScenarioType ? scenarioType : undefined,
            knowledge: knowledge,
            urgency: this._detectUrgency(scenario),
            bookingRecommended: this._shouldRecommendBooking(scenario),
            confidence: Math.round(confidence * 100)
        };
        
        if (includeTriggers) summary.triggers = Array.isArray(scenario.triggers) ? scenario.triggers.slice(0, 20) : [];
        if (includeRegexTriggers) summary.regexTriggers = Array.isArray(scenario.regexTriggers) ? scenario.regexTriggers.slice(0, 10) : [];
        if (includeNegativeTriggers) summary.negativeTriggers = Array.isArray(scenario.negativeTriggers) ? scenario.negativeTriggers.slice(0, 10) : [];
        
        if (includeFollowUp) {
            summary.followUp = {
                mode: scenario.followUpMode || 'NONE',
                questionText: scenario.followUpQuestionText || null,
                transferTarget: scenario.transferTarget || null
            };
        }
        
        if (includeBehavior) {
            summary.behavior = scenario.behavior || null;
        }
        
        // Remove undefined keys for cleanliness
        Object.keys(summary).forEach(k => summary[k] === undefined && delete summary[k]);
        
        return summary;
    }
    
    /**
     * Detect urgency level from scenario
     */
    static _detectUrgency(scenario) {
        const name = (scenario.name || '').toLowerCase();
        const triggers = (scenario.triggers || []).join(' ').toLowerCase();
        
        const emergencyWords = ['emergency', 'urgent', 'leak', 'flood', 'no heat', 'no cool', 'gas', 'fire', 'smoke'];
        
        for (const word of emergencyWords) {
            if (name.includes(word) || triggers.includes(word)) {
                return 'urgent';
            }
        }
        
        return 'normal';
    }
    
    /**
     * Determine if booking should be recommended for this scenario
     */
    static _shouldRecommendBooking(scenario) {
        // Check follow-up mode
        if (scenario.followUpMode === 'ASK_IF_BOOK' || scenario.followUpMode === 'TRANSFER') {
            return true;
        }
        
        // Check scenario type (canonical only)
        const scenarioType = String(scenario.scenarioType || '').toUpperCase();
        if (['BOOKING', 'TRANSFER', 'EMERGENCY'].includes(scenarioType)) {
            return true;
        }
        
        // Explicit booking intent/actionType
        if (scenario.bookingIntent === true || scenario.actionType === 'REQUIRE_BOOKING') {
            return true;
        }
        
        // Check category hints
        const category = (scenario.categoryName || '').toLowerCase();
        const bookingCategories = ['service', 'repair', 'install', 'maintenance', 'emergency'];
        
        return bookingCategories.some(cat => category.includes(cat));
    }
    
    /**
     * ========================================================================
     * TOOL: getCompanyVariables
     * ========================================================================
     * 
     * PURPOSE: Provide company-specific variables for natural speech.
     * Used for brand grounding - no logic, just data.
     * 
     * @param {Object} company - Company document
     * @returns {Object} Company variables for LLM
     */
    static getCompanyVariables(company) {
        return {
            companyName: company.companyName || company.businessName || 'the company',
            trade: company.trade || 'HVAC',
            serviceAreas: company.serviceAreas?.join(', ') || 'your area',
            businessHours: company.businessHours || 'business hours',
            phone: company.phone || null
        };
    }
    
    /**
     * ========================================================================
     * CONSENT DETECTION (Simple, Reliable)
     * ========================================================================
     * 
     * Detects if caller has given explicit consent to book.
     * Uses UI-configured phrases from detectionTriggers.wantsBooking[]
     * 
     * @param {string} utterance - Caller's speech
     * @param {Object} company - Company with frontDeskBehavior config
     * @param {Object} session - Session state
     * @returns {Object} { hasConsent, matchedPhrase, reason }
     */
    static detectConsent(utterance, company, session) {
        if (!utterance || typeof utterance !== 'string') {
            return { hasConsent: false, matchedPhrase: null, reason: 'no_input' };
        }
        
        const textLower = utterance.toLowerCase().trim();
        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const discoveryConsent = frontDesk.discoveryConsent || {};
        const detectionTriggers = frontDesk.detectionTriggers || {};
        
        // Get UI-configured consent phrases
        const consentPhrases = detectionTriggers.wantsBooking || [];
        const consentYesWords = discoveryConsent.consentYesWords || 
            ['yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok', 'correct', 'sounds good'];
        
        // Default consent phrases if none configured
        const defaultConsentPhrases = [
            'schedule', 'book', 'appointment', 'send someone', 'send a tech',
            'come out', 'dispatch', 'service call', 'when can you come',
            'how soon', 'set up a time', 'need someone out'
        ];
        
        const allConsentPhrases = consentPhrases.length > 0 ? consentPhrases : defaultConsentPhrases;
        
        // Check for explicit booking phrases
        for (const phrase of allConsentPhrases) {
            if (phrase && textLower.includes(phrase.toLowerCase())) {
                return {
                    hasConsent: true,
                    matchedPhrase: phrase,
                    reason: 'explicit_consent_phrase'
                };
            }
        }
        
        // Check for "yes" after consent question was asked
        if (session?.conversationMemory?.askedConsentQuestion) {
            for (const yesWord of consentYesWords) {
                if (textLower === yesWord || 
                    textLower.startsWith(yesWord + ' ') || 
                    textLower.endsWith(' ' + yesWord) ||
                    textLower === yesWord + '.') {
                    return {
                        hasConsent: true,
                        matchedPhrase: yesWord,
                        reason: 'yes_after_consent_question'
                    };
                }
            }
        }
        
        return { hasConsent: false, matchedPhrase: null, reason: 'no_consent_detected' };
    }
    
    /**
     * ========================================================================
     * EMOTION DETECTION (Lightweight Heuristic)
     * ========================================================================
     * 
     * Detects caller emotion using keyword matching (no LLM needed).
     * Passed to LLM as context for empathetic responses.
     * 
     * @param {string} utterance - Caller's speech
     * @returns {Object} { emotion, confidence }
     */
    static detectEmotion(utterance) {
        if (!utterance) return { emotion: 'neutral', confidence: 0.5 };
        
        const textLower = utterance.toLowerCase();
        
        // Frustration indicators
        const frustrationWords = [
            'frustrated', 'frustrating', 'annoying', 'annoyed', 'ridiculous',
            'unbelievable', 'terrible', 'horrible', 'worst', 'hate',
            'sick of', 'tired of', 'fed up', 'had enough', 'can\'t believe'
        ];
        
        // Urgency indicators
        const urgencyWords = [
            'emergency', 'urgent', 'asap', 'right now', 'immediately',
            'can\'t wait', 'need help now', 'serious', 'dangerous'
        ];
        
        // Calm/friendly indicators
        const calmWords = [
            'thanks', 'thank you', 'appreciate', 'great', 'wonderful',
            'perfect', 'awesome', 'helpful'
        ];
        
        // Check frustration
        for (const word of frustrationWords) {
            if (textLower.includes(word)) {
                return { emotion: 'frustrated', confidence: 0.8 };
            }
        }
        
        // Check urgency
        for (const word of urgencyWords) {
            if (textLower.includes(word)) {
                return { emotion: 'urgent', confidence: 0.85 };
            }
        }
        
        // Check calm/friendly
        for (const word of calmWords) {
            if (textLower.includes(word)) {
                return { emotion: 'calm', confidence: 0.7 };
            }
        }
        
        return { emotion: 'neutral', confidence: 0.5 };
    }
    
    /**
     * ========================================================================
     * BUILD LLM DISCOVERY PROMPT
     * ========================================================================
     * 
     * Builds the system prompt for LLM in discovery mode.
     * This prompt makes the LLM the primary brain.
     * 
     * Knowledge sources (in order of precedence):
     * 1. 3-Tier Scenarios (primary)
     * 2. Cheat Sheets (fallback)
     * 3. Generic LLM (last resort)
     * 
     * @param {Object} params
     * @param {Object} params.company - Company document
     * @param {Array} params.scenarios - Retrieved scenario summaries
     * @param {Object} params.emotion - Detected emotion
     * @param {Object} params.session - Session state
     * @param {Object} params.cheatSheetKnowledge - Cheat sheet fallback (optional)
     * @returns {string} System prompt for LLM
     */
    static buildDiscoveryPrompt({ company, scenarios, emotion, session, cheatSheetKnowledge }) {
        const companyVars = this.getCompanyVariables(company);
        const trade = companyVars.trade || 'HVAC';
        const tradeLabel = trade === 'HVAC' ? 'HVAC company' :
                          trade === 'DENTAL' ? 'dental office' :
                          trade === 'LEGAL' ? 'law firm' :
                          'service company';
        
        // Build scenario knowledge section (PRIMARY source)
        let knowledgeSection = '';
        if (scenarios && scenarios.length > 0) {
            knowledgeSection = `
RELEVANT KNOWLEDGE FROM SCENARIOS (use naturally, do not read verbatim):
${scenarios.map((s, i) => `${i + 1}. ${s.title}: ${s.knowledge}`).join('\n')}
`;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V23: CHEAT SHEET FALLBACK KNOWLEDGE
        // ═══════════════════════════════════════════════════════════════════
        // Only used if no strong scenario match was found
        // Cheat sheets provide policy/FAQ knowledge as fallback
        // ═══════════════════════════════════════════════════════════════════
        let cheatSheetSection = '';
        if (cheatSheetKnowledge && !scenarios?.length) {
            cheatSheetSection = `
ADDITIONAL KNOWLEDGE FROM COMPANY POLICY (use naturally):
Topic: ${cheatSheetKnowledge.question || cheatSheetKnowledge.title}
Answer: ${cheatSheetKnowledge.answer}
`;
        }
        
        // Build emotion context (UI-controlled toggles)
        let emotionContext = '';
        const emotionKey = emotion?.emotion || null;
        const emotionResponses = company?.aiAgentSettings?.frontDeskBehavior?.emotionResponses || {};
        const emotionCfg = (emotionKey && typeof emotionResponses === 'object') ? (emotionResponses[emotionKey] || {}) : {};
        const emotionEnabled = emotionKey ? (emotionCfg.enabled !== false) : true;

        if (emotionKey === 'urgent') {
            // NOTE: "urgent" is a runtime detection bucket, not a UI toggle today.
            emotionContext = '\nNOTE: This sounds urgent. Prioritize getting help to them quickly.';
        } else if (emotionKey && emotionEnabled) {
            if (emotionKey === 'stressed') {
                emotionContext = '\nNOTE: Caller sounds stressed. Be calm, reassuring, and keep questions simple.';
            }
            if (emotionKey === 'frustrated') {
                emotionContext = '\nNOTE: Caller sounds frustrated. Acknowledge their frustration empathetically before helping.';
                if (emotionCfg.reduceFriction === true) {
                    emotionContext += ' Reduce friction: keep this short, avoid extra probing, and move toward scheduling sooner when appropriate.';
                }
            }
            if (emotionKey === 'angry') {
                emotionContext = '\nNOTE: Caller sounds angry. Stay professional, acknowledge briefly, and focus on resolving.';
                if (emotionCfg.offerEscalation === true) {
                    emotionContext += ' If appropriate, offer to connect them with a human.';
                }
            }
            if (emotionKey === 'friendly' && emotionCfg.allowSmallTalk === true) {
                emotionContext = '\nNOTE: Caller sounds friendly. Light small talk is okay, but keep the call moving.';
            }
            if (emotionKey === 'joking' && emotionCfg.respondInKind === true) {
                emotionContext = '\nNOTE: Caller is joking. You may respond lightly, but keep it professional and progress the call.';
            }
            if (emotionKey === 'panicked') {
                emotionContext = '\nNOTE: Caller sounds panicked. Be calm, confirm safety, and keep questions minimal.';
                if (emotionCfg.bypassAllQuestions === true) {
                    emotionContext += ' Prioritize immediate help and reduce all non-essential questions.';
                }
                if (emotionCfg.confirmFirst === true) {
                    emotionContext += ' Confirm you understand their immediate need before asking for details.';
                }
            }
        }
        
        // Build discovery state context
        // V81: Include ALL extracted context for smart conversations
        let discoveryContext = '';
        const disc = session?.discovery || {};
        
        // Build comprehensive context
        const contextParts = [];
        
        if (disc.issue) {
            contextParts.push(`ISSUE: ${disc.issue}`);
        }
        if (disc.mentionedTechName) {
            contextParts.push(`TECH MENTIONED: ${disc.mentionedTechName}`);
        }
        if (disc.previousVisitTime) {
            contextParts.push(`PREVIOUS VISIT: ${disc.previousVisitTime}`);
        }
        if (disc.mentionedEquipment) {
            contextParts.push(`EQUIPMENT: ${disc.mentionedEquipment}`);
        }
        
        if (contextParts.length > 0) {
            // V88: Build empathetic, human response instructions
            const hasRecentService = disc.previousVisitTime && disc.mentionedTechName;
            const hasRecurringIssue = disc.issue && disc.previousVisitTime;
            
            let empathyInstruction = '';
            if (hasRecurringIssue) {
                empathyInstruction = `
⚠️ RECURRING ISSUE DETECTED: The caller had service ${disc.previousVisitTime || 'recently'} and is calling back about a problem.
THIS IS A SERVICE RECOVERY SITUATION. Your response MUST:
1. Express genuine empathy: "I'm sorry to hear you're still having trouble after ${disc.mentionedTechName ? disc.mentionedTechName + "'s" : 'our'} visit"
2. Reference their specific situation: "${disc.previousVisitTime}", "${disc.mentionedTechName || 'the technician'}", "${disc.mentionedEquipment || 'the system'}"
3. Ask a SMART follow-up: "Is this the same issue or did you notice something different this time?"
4. Sound like you CARE about making this right

GOOD EXAMPLE: "I'm so sorry to hear that, ${callerName || 'and I appreciate you letting us know'}. It sounds like ${disc.mentionedTechName || 'our tech'} was out ${disc.previousVisitTime || 'recently'} to work on your ${disc.mentionedEquipment || 'system'}, and now you're having issues again. Is this the same problem, or did you notice something different this time?"

BAD EXAMPLE: "I understand. Let me get you scheduled. What's your name?" (ROBOTIC - ignores everything they said!)`;
            } else if (hasRecentService) {
                empathyInstruction = `
The caller mentioned ${disc.mentionedTechName || 'a technician'} was out ${disc.previousVisitTime || 'recently'}.
Reference this naturally: "I see ${disc.mentionedTechName || 'we'} was out ${disc.previousVisitTime}..."`;
            }
            
            discoveryContext = `
═══════════════════════════════════════════════════════════════════
CALLER CONTEXT (USE THIS IN YOUR RESPONSE!)
═══════════════════════════════════════════════════════════════════
${contextParts.map(p => `• ${p}`).join('\n')}
${empathyInstruction}

CRITICAL: You MUST acknowledge the specific details the caller shared.
- If they gave their name, use it
- If they mentioned a technician, reference them by name
- If they mentioned a timeframe, reference it
- If they mentioned equipment, acknowledge it
- If it's a recurring issue after service, express empathy and ask if it's the same problem

DO NOT jump straight to "Let me get you scheduled" - that sounds robotic and dismissive.
═══════════════════════════════════════════════════════════════════
`;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V33: CALLER NAME ACKNOWLEDGMENT
        // If caller gave their name, use it naturally in responses
        // ═══════════════════════════════════════════════════════════════════
        let callerNameContext = '';
        const callerName = session?.collectedSlots?.name || 
                          session?.collectedSlots?.partialName ||
                          session?.booking?.meta?.name?.first;
        if (callerName) {
            // Extract first name for natural use
            const firstName = callerName.split(' ')[0];
            callerNameContext = `\nCALLER'S NAME: ${firstName}. Use their name naturally in your response (e.g., "Hi ${firstName}," or "I understand, ${firstName}.").`;
        }
        
        return `You are a professional front desk receptionist for ${companyVars.companyName}, a ${tradeLabel}.

Your job is to BOOK APPOINTMENTS, not provide technical support. You are a RECEPTIONIST, not a technician.

⚠️ CRITICAL RULES:
1. NEVER give technical advice, diagnostic speculation, or troubleshooting steps.
   - BAD: "A blank thermostat usually indicates a power issue or safety float switch"
   - BAD: "You could try checking the circuit breaker or resetting the unit"
   - GOOD: "I'm sorry to hear that. Let me get a technician out to take a look."
   
2. SERVICE RECOVERY: If caller mentions "you were here", "came out last week", "technician was here", etc:
   - Express empathy: "I'm sorry you're still having trouble after our recent visit"
   - DO NOT give more troubleshooting tips
   - Proactively offer follow-up: "Let me get someone back out there to take care of this"

3. When caller describes ANY problem, your job is to:
   - Acknowledge briefly (one sentence max)
   - Offer to schedule: "Let me get a technician out there. What's your name?"
   
4. You may ask ONE clarifying question if truly needed, then move to scheduling.
5. Never mention internal systems, scenarios, templates, or AI.
6. Keep responses SHORT - 1-2 sentences max. You are on a phone call.
${knowledgeSection}${cheatSheetSection}${emotionContext}${discoveryContext}${callerNameContext}

RESPONSE EXAMPLES:
- Caller: "My AC isn't working" → "I'm sorry to hear that. Let me get a technician out to take a look. What's your name?"
- Caller: "You guys were here last week and it's still broken" → "I apologize you're still having trouble after our visit. Let me get someone back out there. What's your full name?"
- Caller: "Is there anything I can do to fix it?" → "Our technicians can diagnose that for you. Let me get you scheduled - what's your name?"`;
    }
    
    /**
     * ========================================================================
     * BUILD LLM BOOKING PROMPT
     * ========================================================================
     * 
     * Builds the system prompt for LLM in booking mode.
     * In booking mode, LLM is a NARRATOR only - it speaks the prompts.
     * 
     * @param {Object} params
     * @param {Object} params.company - Company document
     * @param {string} params.currentSlot - Current slot being collected
     * @param {Object} params.collectedSlots - Already collected slots
     * @returns {string} System prompt for LLM
     */
    static buildBookingPrompt({ company, currentSlot, collectedSlots }) {
        const companyVars = this.getCompanyVariables(company);
        
        return `You are collecting booking information for ${companyVars.companyName}.

CURRENT TASK: Collect ${currentSlot}

ALREADY COLLECTED:
${Object.entries(collectedSlots || {})
    .filter(([_, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- None yet'}

RULES:
1. Ask for ONE piece of information at a time.
2. If caller provides the info, acknowledge briefly and move on.
3. If caller asks a question, answer briefly then return to collecting info.
4. Do not invent or assume information.
5. Be warm but efficient.`;
    }
}

module.exports = LLMDiscoveryEngine;


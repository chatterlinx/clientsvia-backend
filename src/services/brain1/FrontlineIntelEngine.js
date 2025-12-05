/**
 * ============================================================================
 * FRONTLINE INTEL ENGINE - BRAIN 1
 * ============================================================================
 * 
 * THE MANDATORY GATEWAY FOR ALL CALLER TURNS
 * 
 * Every user utterance flows through this single orchestrator before 
 * anything else makes decisions. This is the receptionist brain.
 * 
 * RESPONSIBILITIES:
 * 1. Preprocessing (FillerStripper + TranscriptNormalizer)
 * 2. Emotion detection
 * 3. Intent classification
 * 4. Entity extraction
 * 5. Decide action: ROUTE_TO_SCENARIO | TRANSFER | BOOK | ASK_FOLLOWUP | END
 * 6. Log trace for LLM-0 Cortex-Intel
 * 
 * OUTPUTS:
 * - decision: What to do next
 * - updatedCallState: Call state with new entities/flags
 * - trace: Full trace document for debugging
 * 
 * CALLED BY: v2AIAgentRuntime.processUserInput()
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const Brain1Trace = require('../../../models/Brain1Trace');

// Preprocessing
const { 
    preprocessing: { FillerStripper, TranscriptNormalizer },
    intelligence: { EmotionDetector }
} = require('../orchestration');

// OpenAI for orchestration decisions
const openaiClient = require('../../../config/openai');

// Company config loader
const { loadCompanyRuntimeConfig } = require('../companyConfigLoader');

// Circuit breaker for resilience
const { orchestratorCircuitBreaker } = require('../../../services/OpenAICircuitBreaker');

// Safety nets
const LoopDetector = require('./LoopDetector');
const { isCardHealthy, calculateHealthScore } = require('./CardHealthScorer');

/**
 * ============================================================================
 * MAIN ENTRYPOINT: Run a single turn through Brain-1
 * ============================================================================
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.text - Raw STT text from caller
 * @param {Object} params.callState - Current call state
 * @returns {Promise<{updatedCallState: Object, decision: Object, trace: Object}>}
 */
async function runTurn({ companyId, callId, text, callState }) {
    const startTime = Date.now();
    const turn = (callState.turnCount || 0) + 1;
    
    logger.info('[BRAIN-1] 🧠 Processing turn', {
        companyId,
        callId,
        turn,
        textLength: text?.length || 0
    });
    
    // Initialize trace
    const trace = {
        callId,
        companyId,
        turn,
        input: { rawText: text, normalizedText: '', tokensStripped: 0 },
        emotion: { primary: 'NEUTRAL', intensity: 0, signals: [] },
        decision: { action: 'UNKNOWN', triageTag: null, intentTag: null, confidence: 0, reasoning: null },
        entities: { contact: {}, location: {}, problem: {}, scheduling: {} },
        flags: {},
        brain2: { called: false },
        triage: {},
        output: {},
        performance: {},
        timestamps: { received: new Date() }
    };
    
    try {
        // ====================================================================
        // STEP 1: PREPROCESSING
        // ====================================================================
        const preprocessStart = Date.now();
        
        let normalizedText = text || '';
        let tokensStripped = 0;
        
        if (text && text.trim()) {
            // Strip filler words
            const afterFiller = FillerStripper.clean(text);
            tokensStripped = text.split(/\s+/).length - afterFiller.split(/\s+/).length;
            
            // Normalize transcript
            normalizedText = TranscriptNormalizer.normalize(afterFiller);
        }
        
        trace.input.normalizedText = normalizedText;
        trace.input.tokensStripped = tokensStripped;
        trace.performance.preprocessingMs = Date.now() - preprocessStart;
        trace.timestamps.preprocessed = new Date();
        
        logger.debug('[BRAIN-1] Preprocessing complete', {
            callId,
            turn,
            original: text?.substring(0, 50),
            normalized: normalizedText.substring(0, 50),
            tokensStripped
        });
        
        // ====================================================================
        // STEP 2: EMOTION DETECTION
        // ====================================================================
        const emotionStart = Date.now();
        
        const emotion = EmotionDetector.analyze(normalizedText, callState.turnHistory || []);
        
        trace.emotion = {
            primary: emotion?.primary || 'NEUTRAL',
            intensity: emotion?.intensity || 0,
            signals: emotion?.signals?.map(s => s.emotion || s) || []
        };
        trace.performance.emotionMs = Date.now() - emotionStart;
        
        // Set flags from emotion
        trace.flags.isFrustrated = trace.emotion.primary === 'FRUSTRATED' || trace.emotion.primary === 'ANGRY';
        trace.flags.isEmergency = trace.emotion.primary === 'PANICKED' || 
                                  EmotionDetector.isEmergency?.(normalizedText) || false;
        
        logger.debug('[BRAIN-1] Emotion detected', {
            callId,
            turn,
            primary: trace.emotion.primary,
            intensity: trace.emotion.intensity
        });
        
        // ====================================================================
        // STEP 3: LOAD COMPANY CONFIG
        // ====================================================================
        let config = null;
        try {
            config = await loadCompanyRuntimeConfig({ companyId });
        } catch (configError) {
            logger.error('[BRAIN-1] Failed to load company config', {
                callId,
                companyId,
                error: configError.message
            });
        }
        
        // ====================================================================
        // STEP 4: BRAIN-1 DECISION (LLM-Powered)
        // ====================================================================
        const brain1Start = Date.now();
        
        const decision = await makeBrain1Decision({
            normalizedText,
            callState,
            config,
            emotion: trace.emotion,
            companyId,
            callId,
            turn
        });
        
        trace.decision = decision;
        trace.entities = decision.entities || trace.entities;
        trace.flags = { ...trace.flags, ...decision.flags };
        trace.performance.brain1Ms = Date.now() - brain1Start;
        trace.timestamps.brain1Complete = new Date();
        
        logger.info('[BRAIN-1] 🎯 Decision made', {
            callId,
            turn,
            action: decision.action,
            triageTag: decision.triageTag,
            intentTag: decision.intentTag,
            confidence: decision.confidence
        });
        
        // ====================================================================
        // STEP 5: UPDATE CALL STATE
        // ====================================================================
        const updatedCallState = {
            ...callState,
            turnCount: turn,
            lastIntent: decision.intentTag,
            currentIntent: decision.intentTag || callState.currentIntent,
            emotion: trace.emotion,
            extracted: mergeEntities(callState.extracted, decision.entities),
            flags: {
                ...callState.flags,
                ...trace.flags
            },
            turnHistory: [
                ...(callState.turnHistory || []).slice(-9), // Keep last 10
                {
                    turn,
                    speaker: 'caller',
                    text: normalizedText,
                    timestamp: Date.now(),
                    action: decision.action,
                    emotion: trace.emotion.primary
                }
            ]
        };
        
        // ====================================================================
        // STEP 6: LOG TRACE (fire and forget)
        // ====================================================================
        trace.performance.totalMs = Date.now() - startTime;
        
        Brain1Trace.logTurn(trace).catch(err => {
            logger.error('[BRAIN-1] Failed to log trace (non-fatal)', {
                callId,
                turn,
                error: err.message
            });
        });
        
        logger.info('[BRAIN-1] ✅ Turn complete', {
            callId,
            turn,
            action: decision.action,
            totalMs: trace.performance.totalMs
        });
        
        return {
            updatedCallState,
            decision,
            trace
        };
        
    } catch (error) {
        logger.error('[BRAIN-1] ❌ Fatal error', {
            callId,
            turn,
            error: error.message,
            stack: error.stack
        });
        
        // Emergency fallback decision
        trace.decision = {
            action: 'ASK_FOLLOWUP',
            triageTag: null,
            intentTag: 'error_recovery',
            confidence: 0,
            reasoning: `Brain-1 error: ${error.message}`
        };
        trace.output.spokenText = "I'm here to help. Could you please tell me more about what you need?";
        trace.performance.totalMs = Date.now() - startTime;
        
        // Still log the trace
        Brain1Trace.logTurn(trace).catch(() => {});
        
        return {
            updatedCallState: {
                ...callState,
                turnCount: turn
            },
            decision: trace.decision,
            trace
        };
    }
}

/**
 * ============================================================================
 * BRAIN-1 DECISION ENGINE
 * ============================================================================
 * Uses LLM to determine action, intent, and extract entities
 */
async function makeBrain1Decision({ normalizedText, callState, config, emotion, companyId, callId, turn }) {
    
    // Check for obvious cases first (no LLM needed) - TIER 1 TRIAGE
    const quickDecision = checkQuickDecisions(normalizedText, callState, emotion, config, callId);
    if (quickDecision) {
        logger.info('[BRAIN-1] ⚡ Quick decision made - skipping LLM', {
            action: quickDecision.action,
            triageTag: quickDecision.triageTag,
            confidence: quickDecision.confidence
        });
        return quickDecision;
    }
    
    // Build LLM prompt
    const prompt = buildBrain1Prompt({ normalizedText, callState, config, emotion });
    
    // Call LLM with circuit breaker
    const fallbackDecision = () => ({
        action: 'ASK_FOLLOWUP',
        triageTag: null,
        intentTag: 'unknown',
        confidence: 0.3,
        reasoning: 'LLM fallback - circuit breaker or timeout',
        entities: {},
        flags: { needsKnowledgeSearch: true }
    });
    
    try {
        const llmResult = await orchestratorCircuitBreaker.execute(
            async () => callBrain1LLM(prompt, { companyId, callId, turn }),
            fallbackDecision,
            { companyId, callId }
        );
        
        return llmResult;
        
    } catch (error) {
        logger.error('[BRAIN-1] LLM decision failed', {
            callId,
            turn,
            error: error.message
        });
        return fallbackDecision();
    }
}

/**
 * Check for obvious cases that don't need LLM
 * @param {string} callId - Call SID for loop detection
 */
function checkQuickDecisions(text, callState, emotion, config, callId) {
    const lowerText = text.toLowerCase();
    
    // Emergency detection (highest priority)
    const emergencyPatterns = [
        'gas leak', 'smell gas', 'carbon monoxide', 'fire', 'flooding',
        'sparks', 'smoke', 'emergency', 'help now', 'immediate'
    ];
    
    if (emergencyPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'TRANSFER',
            triageTag: 'EMERGENCY',
            intentTag: 'emergency',
            confidence: 0.95,
            reasoning: 'Emergency keyword detected',
            entities: {},
            flags: { isEmergency: true, wantsHuman: true }
        };
    }
    
    // Wrong number / spam detection
    const wrongNumberPatterns = ['pizza', 'wrong number', 'who is this', 'what company'];
    const spamPatterns = ['press 1', 'warranty', 'social security', 'irs', 'lawsuit'];
    
    if (wrongNumberPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'END',
            triageTag: 'WRONG_NUMBER',
            intentTag: 'wrong_number',
            confidence: 0.9,
            reasoning: 'Wrong number pattern detected',
            entities: {},
            flags: { isWrongNumber: true }
        };
    }
    
    if (spamPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'END',
            triageTag: 'SPAM',
            intentTag: 'spam',
            confidence: 0.9,
            reasoning: 'Spam pattern detected',
            entities: {},
            flags: { isSpam: true }
        };
    }
    
    // High frustration with human request
    if ((emotion.primary === 'ANGRY' || emotion.primary === 'FRUSTRATED') && 
        (lowerText.includes('manager') || lowerText.includes('human') || lowerText.includes('person'))) {
        return {
            action: 'TRANSFER',
            triageTag: 'ESCALATION_REQUEST',
            intentTag: 'escalation',
            confidence: 0.9,
            reasoning: 'Frustrated caller requesting human',
            entities: {},
            flags: { isFrustrated: true, wantsHuman: true }
        };
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // TIER 1: TRIAGE CARD MATCHING (WITH SAFETY NETS)
    // ════════════════════════════════════════════════════════════════════════════
    // 
    // SAFETY NETS (P0 fixes from forensic audit):
    // 1. Confidence threshold raised to 0.92 for bypass
    // 2. Card must be "healthy" (has real content/flow)
    // 3. Call must not be in a loop
    // 4. Single-word synonyms can't win alone
    //
    // ════════════════════════════════════════════════════════════════════════════
    
    const scenarios = config?.scenarios || [];
    const effectiveCallId = callId || config?.callId || 'unknown';
    
    // Check for loop before proceeding
    const loopCheck = LoopDetector.checkForLoop(effectiveCallId);
    
    // Diagnostic: Log what we're matching against
    const enabledScenarios = scenarios.filter(s => s.isEnabled !== false);
    const scenariosWithTriggers = enabledScenarios.filter(s => (s.triggers?.length || 0) > 0 || (s.synonyms?.length || 0) > 0);
    
    logger.info('[BRAIN-1] 🔍 FAST MATCH DIAGNOSTIC', {
        inputText: lowerText.substring(0, 50),
        totalScenarios: scenarios.length,
        enabledScenarios: enabledScenarios.length,
        scenariosWithTriggers: scenariosWithTriggers.length,
        isInLoop: loopCheck.isLooping,
        loopCount: loopCheck.loopCount,
        sampleTriggers: scenariosWithTriggers.slice(0, 5).map(s => ({
            name: s.name || s.triageLabel,
            triggers: (s.triggers || []).slice(0, 3),
            synonyms: (s.synonyms || []).slice(0, 3)
        }))
    });
    
    // P0 FIX: If we're in a loop, skip fast-match and force LLM/Tier-3
    if (loopCheck.isLooping) {
        logger.warn('[BRAIN-1] 🔄 LOOP DETECTED - Skipping fast-match, forcing Tier-3 logic', {
            callId: effectiveCallId.substring(0, 12),
            loopCount: loopCheck.loopCount
        });
        return null; // Force LLM path
    }
    
    if (scenarios.length > 0) {
        let bestMatch = null;
        let bestScore = 0;
        let matchedVia = null; // 'trigger' or 'synonym'
        let keywordMatchCount = 0;
        let synonymMatchCount = 0;
        
        for (const scenario of scenarios) {
            if (!scenario.isEnabled && scenario.isEnabled !== undefined) continue;
            
            let scenarioKeywordHits = 0;
            let scenarioSynonymHits = 0;
            let scenarioBestScore = 0;
            
            // Check triggers (keywords) - these are primary, get full score
            const triggers = scenario.triggers || [];
            for (const trigger of triggers) {
                const triggerLower = trigger.toLowerCase();
                if (lowerText.includes(triggerLower)) {
                    scenarioKeywordHits++;
                    const score = triggerLower.length / lowerText.length;
                    if (score > scenarioBestScore) {
                        scenarioBestScore = score;
                    }
                }
            }
            
            // Check synonyms - but with TIGHTENED rules:
            // Single-word generic synonyms get heavily penalized
            const synonyms = scenario.synonyms || [];
            for (const synonym of synonyms) {
                const synLower = synonym.toLowerCase();
                if (lowerText.includes(synLower)) {
                    scenarioSynonymHits++;
                    
                    // P2 FIX: Tighten synonym scoring
                    // Single-word synonyms (< 10 chars) only count at 50% weight
                    // Multi-word synonyms count at 80% weight
                    const wordCount = synLower.split(/\s+/).length;
                    const isGenericSingleWord = wordCount === 1 && synLower.length < 10;
                    
                    const synonymWeight = isGenericSingleWord ? 0.5 : 0.8;
                    const score = (synLower.length / lowerText.length) * synonymWeight;
                    
                    if (score > scenarioBestScore) {
                        scenarioBestScore = score;
                    }
                }
            }
            
            // P2 FIX: Require keyword match OR 2+ synonym matches
            // A single generic synonym like "thermostat" can't win alone
            const hasValidMatch = scenarioKeywordHits >= 1 || scenarioSynonymHits >= 2;
            
            if (hasValidMatch && scenarioBestScore > bestScore) {
                bestScore = scenarioBestScore;
                bestMatch = scenario;
                matchedVia = scenarioKeywordHits > 0 ? 'trigger' : 'synonym';
                keywordMatchCount = scenarioKeywordHits;
                synonymMatchCount = scenarioSynonymHits;
                
                logger.info('[BRAIN-1] 🎯 Card matched!', { 
                    card: scenario.name, 
                    score: scenarioBestScore.toFixed(2),
                    via: matchedVia,
                    keywordHits: scenarioKeywordHits,
                    synonymHits: scenarioSynonymHits
                });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // P0 FIX: TRIPLE SAFETY CHECK BEFORE BYPASS
        // ════════════════════════════════════════════════════════════════════════════
        if (bestMatch) {
            // Calculate actual confidence (normalize to 0-1)
            const confidence = Math.min(0.95, 0.5 + bestScore);
            
            // Check 1: High confidence threshold (0.92 for full bypass)
            const isHighConfidence = confidence >= 0.92;
            
            // Check 2: Card is healthy (has real content)
            const cardHealth = calculateHealthScore(bestMatch);
            const cardIsHealthy = cardHealth.isHealthy;
            
            // Check 3: Not in a loop (already checked above, but double-check)
            const notInLoop = !loopCheck.isLooping;
            
            // Can we bypass deeper logic (LLM/Tier-3)?
            const canBypassDeeperLogic = isHighConfidence && cardIsHealthy && notInLoop;
            
            logger.info('[BRAIN-1] 🛡️ SAFETY CHECK', {
                card: bestMatch.name,
                confidence: confidence.toFixed(2),
                isHighConfidence,
                cardHealthScore: cardHealth.score,
                cardIsHealthy,
                notInLoop,
                canBypassDeeperLogic,
                matchedVia,
                keywordHits: keywordMatchCount,
                synonymHits: synonymMatchCount
            });
            
            if (canBypassDeeperLogic) {
                // ✅ All safety checks passed - use fast match
                const routing = bestMatch.routing || 'MESSAGE_ONLY';
                const action = routing === 'BOOK' || routing === 'SCHEDULE' ? 'BOOK' :
                              routing === 'TRANSFER' ? 'TRANSFER' :
                              routing === 'ROUTE_TO_SCENARIO' ? 'ROUTE_TO_SCENARIO' :
                              'MESSAGE_ONLY';
                
                logger.info('[BRAIN-1] ⚡ FAST TRIAGE MATCH - All safety checks passed!', {
                    matchedCard: bestMatch.name,
                    confidence: confidence.toFixed(2),
                    action,
                    cardHealthScore: cardHealth.score,
                    source: bestMatch.source || 'unknown'
                });
                
                // Use canonical normalizeTag for consistency with TriageRouter
                const tagToEmit = normalizeTag(bestMatch.name || bestMatch.triageLabel || bestMatch.id);
                
                return {
                    action,
                    triageTag: tagToEmit || 'MATCHED',
                    intentTag: bestMatch.category || 'triage',
                    confidence,
                    reasoning: `Triage card match: ${bestMatch.name} (health: ${cardHealth.score})`,
                    matchedScenario: bestMatch,
                    response: bestMatch.response || null,
                    entities: {},
                    flags: { 
                        triageMatched: true,
                        readyToBook: action === 'BOOK',
                        bypassedLLM: true
                    }
                };
            } else {
                // ⚠️ Safety checks failed - log why and proceed to LLM
                logger.warn('[BRAIN-1] ⚠️ SAFETY CHECK FAILED - Routing to Tier-3 LLM', {
                    card: bestMatch.name,
                    confidence: confidence.toFixed(2),
                    failedChecks: [
                        !isHighConfidence ? 'LOW_CONFIDENCE' : null,
                        !cardIsHealthy ? 'UNHEALTHY_CARD' : null,
                        !notInLoop ? 'IN_LOOP' : null
                    ].filter(Boolean),
                    cardHealthReasons: cardHealth.reasons
                });
                
                // Still pass the matched card as a hint to LLM, but don't bypass
                // The LLM will see this context and can use it or ignore it
            }
        }
    }
    
    return null; // No quick decision, needs LLM
}

/**
 * Normalize a tag to canonical format: "NO_COOL", "no-cool", "No Cool" → "NO_COOL"
 * MUST match the normalizeTag() function in TriageRouter.js
 */
function normalizeTag(raw) {
    if (!raw) return null;
    return String(raw)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')   // everything non-alphanumeric → underscore
        .replace(/^_+|_+$/g, '');      // trim leading/trailing underscores
}

/**
 * Build Brain-1 LLM prompt
 */
function buildBrain1Prompt({ normalizedText, callState, config, emotion }) {
    const companyName = config?.name || 'the company';
    const trade = config?.trade || 'service';
    
    // ════════════════════════════════════════════════════════════════════════════
    // MULTI-TENANT: Build allowed tags from THIS COMPANY's triage cards
    // No hardcoded industry-specific tags! Each tenant has their own set.
    // ════════════════════════════════════════════════════════════════════════════
    const scenarios = config?.scenarios || [];
    const allowedTags = [...new Set(
        scenarios
            .filter(s => s.isEnabled !== false)
            .map(s => normalizeTag(s.name || s.triageLabel || s.id))
            .filter(Boolean)
    )];
    
    // Add some generic tags that apply to all businesses
    const genericTags = ['GENERAL_INQUIRY', 'PRICING', 'HOURS', 'LOCATION', 'CALLBACK', 'VENDOR_CALL', 'EMERGENCY', 'WRONG_NUMBER'];
    const allTags = [...new Set([...allowedTags, ...genericTags])];
    const tagsForPrompt = allTags.slice(0, 30).join('|'); // Limit to 30 to keep prompt size reasonable
    
    // Diagnostic: Log what tags are available to the LLM
    logger.info('[BRAIN-1] 🏷️ LLM ALLOWED TAGS', {
        companyId: config?._id || config?.id,
        scenarioCount: scenarios.length,
        allowedTagCount: allowedTags.length,
        sampleTags: allTags.slice(0, 10),
        promptTagsLength: tagsForPrompt.length
    });
    
    // ════════════════════════════════════════════════════════════════════════════
    // CALL CENTER V2: Build customer context section
    // ════════════════════════════════════════════════════════════════════════════
    const customerContext = callState.customerContext || {};
    let customerSection = '';
    
    if (customerContext.isReturning && customerContext.customerName) {
        // Known returning customer
        customerSection = `
CUSTOMER RECOGNITION:
- RETURNING CUSTOMER: ${customerContext.customerName}
- Total Calls: ${customerContext.totalCalls || 1}
- Customer Type: ${customerContext.customerType || 'residential'}
- Phone Type: ${customerContext.phoneType || 'unknown'} ${customerContext.canSms ? '(SMS OK)' : ''}
${customerContext.city ? `- Location: ${customerContext.city}, ${customerContext.state}` : ''}
${customerContext.specialNotes ? `- Notes: ${customerContext.specialNotes}` : ''}
${customerContext.hasMultipleProperties ? `- Multiple Properties: ${customerContext.propertyNicknames}` : ''}

PERSONALIZATION TIPS:
- Greet by name: "Hi ${customerContext.firstName || customerContext.customerName}!"
- Reference history if relevant
- Skip info collection if we have it (address, phone)
- Be warm and familiar
`;
    } else if (customerContext.isHouseholdMember) {
        // Household member recognized by address
        customerSection = `
CUSTOMER RECOGNITION:
- HOUSEHOLD MEMBER (Different phone, same address)
- Primary Account: ${customerContext.householdPrimaryName || 'on file'}

PERSONALIZATION TIPS:
- Ask for their name
- Confirm relationship to primary account holder
- Add them to the account
`;
    } else {
        // New or unrecognized caller
        customerSection = `
CUSTOMER RECOGNITION:
- NEW CALLER (First time or unrecognized)
- Phone Type: ${customerContext.phoneType || 'unknown'}

COLLECTION PRIORITIES:
- Ask if they've used your services before
- Collect: Name, Phone (verify), Address, Service need
- Be welcoming but efficient
`;
    }
    // ════════════════════════════════════════════════════════════════════════════
    
    const systemPrompt = `You are Brain-1, the frontline AI for ${companyName}, a ${trade} company.

YOUR ROLE: Decide what ACTION to take and extract STRUCTURED DATA. You do NOT generate conversational responses yet.

ACTIONS YOU CAN TAKE:
- ROUTE_TO_SCENARIO: Caller needs factual knowledge (hours, pricing, services, troubleshooting). Route to Brain-2.
- TRANSFER: Caller explicitly wants human OR emergency situation. Escalate immediately.
- BOOK: Caller wants to schedule appointment. Have enough info OR need to collect it.
- ASK_FOLLOWUP: Need more information before deciding. Ask a clarifying question.
- MESSAGE_ONLY: Simple acknowledgment, greeting, or small talk. No routing needed.
- ROUTE_TO_VENDOR: Caller is a VENDOR/SUPPLIER (not a customer). Route to vendor handling.
- END: Wrong number, spam, or call resolution. Politely close.

VENDOR DETECTION (IMPORTANT):
Identify if caller is a VENDOR, not a customer. Listen for:
- "I'm calling from [Supply House/Company Name]"
- "This is a delivery driver"
- "Your parts order is ready"
- "Calling about your account with us"
- "I'm with [Manufacturer] support"
- "Invoice/billing inquiry from vendor"
- Business-to-business language

If vendor detected: action = "ROUTE_TO_VENDOR", intentTag = "vendor"
Capture: vendor company name, contact name, reason, reference numbers
${customerSection}
CURRENT CALL STATE:
- Turn: ${callState.turnCount || 1}
- Current Intent: ${callState.currentIntent || 'unknown'}
- Emotion: ${emotion.primary} (intensity: ${emotion.intensity})
- Extracted So Far: ${JSON.stringify(callState.extracted || {})}

CALLER SAID: "${normalizedText}"

AVAILABLE TRIAGE TAGS FOR THIS COMPANY:
${tagsForPrompt}

RESPOND WITH ONLY VALID JSON:
{
  "action": "ROUTE_TO_SCENARIO|TRANSFER|BOOK|ASK_FOLLOWUP|MESSAGE_ONLY|ROUTE_TO_VENDOR|END",
  "triageTag": "ONE_OF_THE_TAGS_ABOVE",
  "intentTag": "emergency|booking|troubleshooting|info|billing|greeting|vendor|callback|other",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "entities": {
    "contact": { "name": "...", "phone": "..." },
    "location": { "addressLine1": "...", "city": "...", "state": "...", "zip": "..." },
    "problem": { "summary": "...", "category": "cooling|heating|plumbing|electrical", "urgency": "normal|urgent|emergency" },
    "scheduling": { "preferredDate": "...", "preferredWindow": "morning|afternoon|evening|asap" },
    "vendor": { "companyName": "...", "contactName": "...", "reason": "...", "referenceNumber": "...", "urgency": "urgent|normal|low" }
  },
  "flags": {
    "needsKnowledgeSearch": true/false,
    "readyToBook": true/false,
    "wantsHuman": true/false,
    "isReturning": ${customerContext.isReturning || false},
    "isVendor": true/false,
    "isCallback": true/false
  }
}`;

    return {
        system: systemPrompt,
        user: `Caller: "${normalizedText}"\n\nDecide the action and extract any entities.`
    };
}

/**
 * Call Brain-1 LLM
 */
async function callBrain1LLM(prompt, metadata) {
    if (!openaiClient) {
        throw new Error('OpenAI client not initialized');
    }
    
    const response = await openaiClient.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 600,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ]
    });
    
    const rawContent = response.choices[0]?.message?.content || '';
    
    // Parse JSON
    try {
        const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                         rawContent.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
        const decision = JSON.parse(jsonString);
        
        // Validate action
        const validActions = ['ROUTE_TO_SCENARIO', 'TRANSFER', 'BOOK', 'ASK_FOLLOWUP', 'MESSAGE_ONLY', 'END'];
        if (!validActions.includes(decision.action)) {
            decision.action = 'ASK_FOLLOWUP';
        }
        
        // Diagnostic: Log what LLM returned
        logger.info('[BRAIN-1] 🤖 LLM RESPONSE', {
            action: decision.action,
            triageTag: decision.triageTag,
            intentTag: decision.intentTag,
            confidence: decision.confidence,
            reasoning: decision.reasoning?.substring(0, 100)
        });
        
        return decision;
        
    } catch (parseError) {
        logger.error('[BRAIN-1] Failed to parse LLM response', {
            ...metadata,
            rawContent: rawContent.substring(0, 500)
        });
        throw parseError;
    }
}

/**
 * Merge entities (new values override old)
 */
function mergeEntities(existing = {}, updates = {}) {
    return {
        contact: { ...(existing.contact || {}), ...(updates.contact || {}) },
        location: { ...(existing.location || {}), ...(updates.location || {}) },
        problem: { ...(existing.problem || {}), ...(updates.problem || {}) },
        scheduling: { ...(existing.scheduling || {}), ...(updates.scheduling || {}) }
    };
}

module.exports = {
    runTurn
};


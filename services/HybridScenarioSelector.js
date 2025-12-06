/**
 * ============================================================================
 * HYBRID SCENARIO SELECTOR SERVICE - THE BRAIN 🧠
 * ============================================================================
 * 
 * PURPOSE:
 * World-class intelligent scenario matching for non-LLM AI agents.
 * Combines multiple matching strategies to find the best response
 * for any caller phrase, with full observability and trace logging.
 * 
 * MATCHING STRATEGIES (Weighted Fusion):
 * 1. BM25 Keyword Scoring (40%) - term frequency + inverse document frequency
 * 2. Semantic Similarity (30%) - sentence embeddings (future: in-house model)
 * 3. Regex Pattern Matching (20%) - exact patterns for structured data
 * 4. Context Weighting (10%) - conversation state, history, caller profile
 * 
 * INTELLIGENCE FEATURES:
 * - ✅ Negative trigger blocking (instant disqualify)
 * - ✅ Confidence routing (threshold gating)
 * - ✅ Priority tie-breaking (when multiple scenarios score equal)
 * - ✅ Cooldown enforcement (prevent repetitive responses)
 * - ✅ Precondition validation (state machine awareness)
 * - ✅ Full match trace (debugging & observability)
 * - ✅ Performance metrics (sub-10ms target)
 * 
 * PERFORMANCE TARGET: < 10ms per query (50-100 scenarios)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class HybridScenarioSelector {
    constructor(fillerWordsArray = null, urgencyKeywordsArray = null, synonymMapObject = null) {
        // ============================================
        // CONFIGURATION
        // ============================================
        
        // 🛡️ SAFETY HELPER: Convert any value to safe array
        this.toArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
        
        this.config = {
            // Match strategy weights (must sum to 1.0)
            weights: {
                bm25: 0.40,        // Keyword scoring
                semantic: 0.30,    // Embeddings (placeholder for future)
                regex: 0.20,       // Pattern matching
                context: 0.10      // Conversation state
            },
            
            // Scoring thresholds
            minConfidenceDefault: 0.45,  // 45% threshold - relaxed for real-world usage
            negativeTriggerPenalty: -1.0, // Instant disqualify
            
            // BM25 parameters
            bm25: {
                k1: 1.5,  // Term frequency saturation
                b: 0.75   // Length normalization
            },
            
            // Performance limits
            maxScenarios: 1000,
            timeoutMs: 50
        };
        
        // ============================================
        // 🚨 URGENCY KEYWORDS (DATABASE-DRIVEN)
        // ============================================
        // CRITICAL: Urgency keywords are now TEMPLATE-SPECIFIC and editable in UI
        // These boost emergency detection with configurable weights
        this.urgencyKeywords = new Map();
        
        if (Array.isArray(urgencyKeywordsArray) && urgencyKeywordsArray.length > 0) {
            urgencyKeywordsArray.forEach(kw => {
                if (kw.word && typeof kw.weight === 'number') {
                    this.urgencyKeywords.set(kw.word.toLowerCase().trim(), {
                        weight: kw.weight,
                        category: kw.category || 'General'
                    });
                }
            });
            
            logger.info('🚨 [HYBRID SELECTOR] Urgency keywords initialized', {
                source: 'template',
                count: this.urgencyKeywords.size,
                totalWeight: Array.from(this.urgencyKeywords.values())
                    .reduce((sum, kw) => sum + kw.weight, 0)
            });
        } else {
            logger.info('🚨 [HYBRID SELECTOR] No urgency keywords provided (using intent keywords only)');
        }
        
        // ============================================
        // 🔇 FILLER WORDS (DATABASE-DRIVEN)
        // ============================================
        // CRITICAL: Filler words are now TEMPLATE-SPECIFIC and editable in UI
        // If provided (from template), use those; otherwise use fallback defaults
        const defaultFillerWords = [
            'um', 'uh', 'like', 'you', 'know', 'i', 'mean', 'basically',
            'actually', 'so', 'well', 'okay', 'alright', 'right', 'the',
            'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
            'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
            'did', 'will', 'would', 'should', 'could', 'can', 'may',
            'might', 'must', 'what', 'when', 'where', 'who', 'how', 'why',
            'please', 'thanks', 'thank', 'yes', 'no', 'yeah', 'yep', 'nope',
            'hi', 'hey', 'hello', 'you guys', 'today', 'there'
        ];
        
        // Use provided filler words from template, or fall back to defaults
        const activeFillerWords = Array.isArray(fillerWordsArray) && fillerWordsArray.length > 0 
            ? fillerWordsArray 
            : defaultFillerWords;
        
        this.fillerWords = new Set(activeFillerWords.map(w => String(w).toLowerCase().trim()));
        
        logger.info('🔇 [HYBRID SELECTOR] Filler words initialized', {
            source: fillerWordsArray ? 'template' : 'defaults',
            count: this.fillerWords.size
        });
        
        // ============================================
        // 🔤 SYNONYM MAPPING (DATABASE-DRIVEN)
        // ============================================
        // CRITICAL: Translate colloquial terms → technical terms before matching
        // Format: Map { "thermostat" => ["thingy", "box on wall", "temperature thing"] }
        // This allows non-technical customers to use natural language
        this.synonymMap = new Map();
        
        if (synonymMapObject && typeof synonymMapObject === 'object') {
            // Convert from various formats to Map
            if (synonymMapObject instanceof Map) {
                this.synonymMap = new Map(synonymMapObject);
            } else if (synonymMapObject.entries) {
                // Mongoose Map object
                for (const [technicalTerm, aliases] of synonymMapObject.entries()) {
                    if (Array.isArray(aliases) && aliases.length > 0) {
                        this.synonymMap.set(
                            technicalTerm.toLowerCase().trim(),
                            aliases.map(a => String(a).toLowerCase().trim())
                        );
                    }
                }
            } else {
                // Plain object
                for (const [technicalTerm, aliases] of Object.entries(synonymMapObject)) {
                    if (Array.isArray(aliases) && aliases.length > 0) {
                        this.synonymMap.set(
                            technicalTerm.toLowerCase().trim(),
                            aliases.map(a => String(a).toLowerCase().trim())
                        );
                    }
                }
            }
            
            logger.info('🔤 [HYBRID SELECTOR] Synonym map initialized', {
                source: 'template/category',
                technicalTermsCount: this.synonymMap.size,
                totalAliases: Array.from(this.synonymMap.values()).reduce((sum, arr) => sum + arr.length, 0)
            });
        } else {
            logger.info('🔤 [HYBRID SELECTOR] No synonym map provided (colloquial terms not translated)');
        }
        
        // ============================================
        // 🎯 INTENT DETECTION KEYWORD SETS
        // ============================================
        // CRITICAL: Priority routing to handle dual-intent queries
        // Example: "AC leaking water, can I schedule a visit?"
        // → BOOK intent wins over QUESTION intent
        
        this.intentKeywords = {
            // Priority 1: Emergency (always wins)
            EMERGENCY: [
                'water pouring', 'ceiling wet', 'flood', 'flooding', 'sparks', 'burning smell',
                'no heat', 'no cooling', 'gas smell', 'co alarm', 'carbon monoxide',
                'fire', 'smoke', 'electrical smell', 'shorting', 'water overflow',
                'emergency', 'urgent', 'right now', 'immediately'
            ],
            
            // Priority 2: Book/Visit/Send Tech (wins over Q&A)
            BOOK: [
                'schedule', 'book', 'appointment', 'come out', 'send a tech', 'send tech',
                'visit', 'service call', 'estimate', 'set up a time', 'can you come',
                'i need someone out', 'when can you come', 'i need an appointment',
                'need appointment', 'make appointment', 'get appointment', 'set appointment',
                'send someone', 'come over', 'come by', 'stop by', 'dispatch',
                'need service', 'schedule service', 'book service',
                'have someone over', 'have someone out', 'send someone out',
                'schedule a visit', 'book an appointment', 'book a visit'
            ],
            
            // Priority 3: Reschedule/Cancel
            RESCHEDULE: [
                'reschedule', 'cancel', 'change appointment', 'move appointment',
                'different time', 'different day', 'change time', 'change day'
            ],
            
            // Priority 4: Status/Billing
            STATUS: [
                'where is', 'how much', 'cost', 'price', 'billing', 'invoice',
                'payment', 'charge', 'hours', 'open', 'closed', 'business hours'
            ],
            
            // Priority 5: Trade Q&A (only if no action intent)
            QUESTION: [
                'why', 'how come', 'what happening', 'what could be', 'do i need', 'should i',
                'is it normal', 'how to', 'can i fix', 'explain', 'what does', 'what is',
                'tell me', 'wondering', 'curious', 'question about'
            ],
            
            // Problem topics (context for dispatcher)
            PROBLEM_TOPICS: [
                'leaking', 'leak', 'water', 'drip', 'dripping', 'freeze', 'frozen', 'ice', 
                'no cool', 'not cooling', 'warm', 'hot', 'noise', 'noisy', 'loud', 
                'smell', 'odor', 'short cycling', 'thermostat', 'drain', 'float switch',
                'compressor', 'condenser', 'evaporator', 'coil', 'filter', 'fan',
                'not working', 'broken', 'issue', 'problem', 'trouble'
            ]
        };
        
        // ============================================
        // 🏆 PRIORITY LADDER (Highest Wins)
        // ============================================
        // Used for tie-breaking when multiple intents detected
        this.intentPriority = {
            EMERGENCY: 100,
            BOOK: 80,
            RESCHEDULE: 60,
            STATUS: 40,
            QUESTION: 20,
            SMALLTALK: 10
        };
        
        // ============================================
        // 🎯 PRIORITY BONUS WEIGHTS
        // ============================================
        // Applied to confidence score based on detected intent
        this.intentBonuses = {
            EMERGENCY: 0.50,      // Emergency always fires
            BOOK: 0.40,           // BOOK beats Q&A
            RESCHEDULE: 0.25,
            STATUS: 0.15,
            QUESTION: 0.0,        // No bonus (base score only)
            SMALLTALK: -0.10      // Slight penalty
        };
    }
    
    // ============================================
    // MAIN MATCHING FUNCTION
    // ============================================
    
    /**
     * Find best matching scenario for a caller phrase
     * @param {String} phrase - What the caller said
     * @param {Array} scenarios - Available scenarios (from template)
     * @param {Object} context - Conversation context (state, history, caller)
     * @returns {Object} - { scenario, score, confidence, trace }
     */
    async selectScenario(phrase, scenarios, context = {}) {
        const startTime = Date.now();
        
        // ============================================
        // 🛡️ BULLETPROOF INPUT VALIDATION
        // ============================================
        const safePhrase = String(phrase || '').trim();
        const safeScenarios = Array.isArray(scenarios) ? scenarios : [];
        
        if (!safePhrase) {
            logger.error('❌ [SCENARIO SELECTOR] Empty phrase provided');
            return { 
                match: null, 
                scenario: null, 
                score: 0, 
                confidence: 0, 
                trace: { selectionReason: 'empty_phrase' }
            };
        }
        
        if (safeScenarios.length === 0) {
            logger.error('❌ [SCENARIO SELECTOR] No scenarios provided');
            return { 
                match: null, 
                scenario: null, 
                score: 0, 
                confidence: 0, 
                trace: { selectionReason: 'no_scenarios' }
            };
        }
        
        const trace = {
            phrase: safePhrase,
            normalizedPhrase: '',
            scenariosEvaluated: 0,
            scenariosBlocked: 0,
            topCandidates: [],
            selectedScenario: null,
            selectionReason: '',
            timingMs: {}
        };
        
        try {
            // ============================================
            // STEP 1: NORMALIZE INPUT
            // ============================================
            const normalizeStart = Date.now();
            const normalizedPhrase = this.normalizePhrase(phrase);
            const phraseTerms = this.extractTerms(normalizedPhrase);
            trace.normalizedPhrase = normalizedPhrase;
            trace.phraseTerms = phraseTerms;
            trace.timingMs.normalize = Date.now() - normalizeStart;
            
            if (phraseTerms.length === 0) {
                trace.selectionReason = 'No meaningful terms in phrase';
                return { scenario: null, score: 0, confidence: 0, trace };
            }
            
            // ============================================
            // STEP 1.5: EXACT-MATCH BYPASS (100% CONFIDENCE)
            // ============================================
            // 🎯 CRITICAL: If normalized input exactly matches any normalized trigger,
            // fire immediately with 100% confidence, bypassing all thresholds.
            // This prevents "60% = NO MATCH" nonsense when caller says the exact phrase.
            const exactMatchStart = Date.now();
            for (const scenario of safeScenarios) {
                if (!scenario || typeof scenario !== 'object') {continue;}
                if (scenario.status !== 'live' || scenario.isActive === false) {continue;}
                
                const triggers = this.toArr(scenario.triggers);
                for (const trigger of triggers) {
                    const normalizedTrigger = this.normalizePhrase(trigger);
                    if (normalizedPhrase === normalizedTrigger) {
                        trace.timingMs.exactMatch = Date.now() - exactMatchStart;
                        trace.selectionReason = `EXACT MATCH BYPASS (normalized phrase = normalized trigger)`;
                        trace.selectedScenario = {
                            scenarioId: scenario.scenarioId,
                            name: scenario.name,
                            score: 1.0,
                            confidence: 1.0,
                            priority: scenario.priority || 0,
                            exactMatchTrigger: trigger
                        };
                        trace.topCandidates = [{
                            scenarioId: scenario.scenarioId,
                            name: scenario.name,
                            score: '1.000',
                            confidence: '1.000',
                            priority: scenario.priority || 0,
                            breakdown: { exactMatch: 1.0 }
                        }];
                        trace.timingMs.total = Date.now() - startTime;
                        
                        logger.info('🎯 [SCENARIO SELECTOR] EXACT MATCH BYPASS', {
                            phrase,
                            normalizedPhrase,
                            trigger,
                            normalizedTrigger,
                            scenarioId: scenario.scenarioId,
                            name: scenario.name,
                            timeMs: trace.timingMs.total
                        });
                        
                        return {
                            scenario,
                            score: 1.0,
                            confidence: 1.0,
                            breakdown: { exactMatch: 1.0 },
                            trace
                        };
                    }
                }
            }
            trace.timingMs.exactMatch = Date.now() - exactMatchStart;
            
            // ============================================
            // STEP 1.75: INTENT DETECTION & PRIORITY ROUTING
            // ============================================
            // 🎯 CRITICAL: Detect caller intent (BOOK beats QUESTION)
            // Example: "AC leaking, can I schedule?" → BOOK intent wins
            const intentStart = Date.now();
            const detectedIntents = this.detectIntents(normalizedPhrase, phraseTerms);
            const problemTopics = this.extractProblemTopics(normalizedPhrase);
            
            trace.intents = {
                detected: detectedIntents,
                primaryIntent: detectedIntents[0] || null,
                problemTopics,
                hasEmergency: detectedIntents.includes('EMERGENCY'),
                hasBookIntent: detectedIntents.includes('BOOK'),
                hasQuestionIntent: detectedIntents.includes('QUESTION')
            };
            trace.timingMs.intentDetection = Date.now() - intentStart;
            
            // ============================================
            // STEP 2: FILTER ELIGIBLE SCENARIOS
            // ============================================
            const filterStart = Date.now();
            const eligibleScenarios = safeScenarios.filter(s => {
                // 🛡️ SAFETY: Skip malformed scenarios
                if (!s || typeof s !== 'object') {
                    logger.error('❌ [SCENARIO SELECTOR] Malformed scenario (not an object)', { scenario: s });
                    return false;
                }
                
                // Only live and active scenarios
                if (s.status !== 'live' || s.isActive === false) {
                    return false;
                }
                
                // Channel match (if specified)
                if (context.channel && s.channel !== 'any' && s.channel !== context.channel) {
                    return false;
                }
                
                // Language match (if specified)
                if (context.language && s.language !== 'auto' && s.language !== context.language) {
                    return false;
                }
                
                // Cooldown check (if conversation history provided)
                if (context.recentScenarios && s.cooldownSeconds > 0) {
                    const lastUsed = context.recentScenarios[s.scenarioId];
                    if (lastUsed && (Date.now() - lastUsed) < (s.cooldownSeconds * 1000)) {
                        return false;
                    }
                }
                
                return true;
            });
            
            trace.scenariosEvaluated = eligibleScenarios.length;
            trace.timingMs.filter = Date.now() - filterStart;
            
            if (eligibleScenarios.length === 0) {
                trace.selectionReason = 'No eligible scenarios after filtering';
                return { scenario: null, score: 0, confidence: 0, trace };
            }
            
            // ============================================
            // STEP 3: SCORE ALL SCENARIOS
            // ============================================
            const scoreStart = Date.now();
            const scoredScenarios = [];
            
            for (const scenario of eligibleScenarios) {
                const scoreResult = this.scoreScenario(
                    normalizedPhrase,
                    phraseTerms,
                    scenario,
                    context,
                    detectedIntents // Pass intents for priority bonus
                );
                
                // Check if blocked by negative triggers
                if (scoreResult.blocked) {
                    trace.scenariosBlocked++;
                    continue;
                }
                
                scoredScenarios.push({
                    scenario,
                    score: scoreResult.totalScore,
                    breakdown: scoreResult.breakdown,
                    confidence: scoreResult.confidence
                });
            }
            
            trace.timingMs.scoring = Date.now() - scoreStart;
            
            if (scoredScenarios.length === 0) {
                trace.selectionReason = 'All scenarios blocked by negative triggers';
                return { scenario: null, score: 0, confidence: 0, trace };
            }
            
            // ============================================
            // STEP 3.5: DUAL-INTENT RESOLVER 🎯
            // ============================================
            // CRITICAL: Handles mixed problem + action phrases
            // Example: "I'm having water leaks... can I schedule a visit?"
            // 
            // PROBLEM: "water leaks" → Emergency
            // ACTION: "schedule a visit" → Booking
            // 
            // RESOLUTION LOGIC:
            // 1. If problemScore >= 0.70 AND delta >= 0.15 → Emergency (hard route)
            // 2. If both >= 0.45 AND delta < 0.15 → Clarifier (ask user)
            // 3. Else → Booking (default to action)
            
            const resolverStart = Date.now();
            
            // Compute problem score (emergency keywords)
            const problemScore = this.computeProblemScore(normalizedPhrase, phraseTerms, scoredScenarios);
            
            // Compute action score (booking keywords)
            const actionScore = this.computeActionScore(normalizedPhrase, phraseTerms, scoredScenarios);
            
            // Resolver thresholds
            const TH = 0.45;           // Minimum confidence threshold
            const EM_HARD = 0.70;      // Emergency hard-route threshold
            const DELTA = 0.15;        // Minimum score delta for decisive routing
            
            // Compute delta
            const scoreDelta = Math.abs(problemScore - actionScore);
            
            // Resolution decision
            const resolverDecision = {
                problemScore: problemScore.toFixed(3),
                actionScore: actionScore.toFixed(3),
                delta: scoreDelta.toFixed(3),
                route: 'booking',  // Default
                needsClarifier: false,
                clarifierPrompt: null,
                reasoning: ''
            };
            
            // Decision tree
            if (problemScore >= EM_HARD && (problemScore - actionScore) >= DELTA) {
                // Hard emergency route (problem is strong and dominant)
                resolverDecision.route = 'emergency';
                resolverDecision.reasoning = `Emergency hard-route: problemScore ${problemScore.toFixed(2)} >= ${EM_HARD} and delta ${scoreDelta.toFixed(2)} >= ${DELTA}`;
                
                // Boost emergency scenarios
                scoredScenarios.forEach(s => {
                    if (this.isEmergencyScenario(s.scenario)) {
                        s.score *= 1.5;  // 50% boost
                        s.confidence *= 1.5;
                        s.breakdown.resolverBoost = '+50%';
                    }
                });
                
            } else if (problemScore >= TH && actionScore >= TH) {
                // Both intents present - check if close
                if (scoreDelta < DELTA) {
                    // Too close to decide - need clarifier
                    resolverDecision.route = 'clarify';
                    resolverDecision.needsClarifier = true;
                    resolverDecision.clarifierPrompt = `Got it, you mentioned ${this.extractProblemTopics(normalizedPhrase).join(', ')}. Is this actively urgent right now, or can we schedule a routine visit?`;
                    resolverDecision.reasoning = `Both intents present (problem: ${problemScore.toFixed(2)}, action: ${actionScore.toFixed(2)}), delta ${scoreDelta.toFixed(2)} < ${DELTA} → clarifier needed`;
                    
                    // Flag the top scenario for clarification
                    if (scoredScenarios.length > 0) {
                        scoredScenarios[0].needsClarifier = true;
                        scoredScenarios[0].clarifierPrompt = resolverDecision.clarifierPrompt;
                    }
                    
                } else {
                    // Clear winner based on score
                    resolverDecision.route = problemScore > actionScore ? 'emergency' : 'booking';
                    resolverDecision.reasoning = `Both intents present, ${resolverDecision.route} wins (problem: ${problemScore.toFixed(2)}, action: ${actionScore.toFixed(2)}, delta: ${scoreDelta.toFixed(2)})`;
                    
                    // Boost the winner
                    scoredScenarios.forEach(s => {
                        if (resolverDecision.route === 'emergency' && this.isEmergencyScenario(s.scenario)) {
                            s.score *= 1.3;
                            s.confidence *= 1.3;
                            s.breakdown.resolverBoost = '+30%';
                        } else if (resolverDecision.route === 'booking' && this.isBookingScenario(s.scenario)) {
                            s.score *= 1.3;
                            s.confidence *= 1.3;
                            s.breakdown.resolverBoost = '+30%';
                        }
                    });
                }
                
            } else {
                // Default to booking (action intent wins if problem is weak)
                resolverDecision.route = 'booking';
                resolverDecision.reasoning = `Default to booking: problemScore ${problemScore.toFixed(2)} or actionScore ${actionScore.toFixed(2)} below dual-intent threshold`;
            }
            
            trace.resolverDecision = resolverDecision;
            trace.timingMs.resolver = Date.now() - resolverStart;
            
            logger.info('🎯 [DUAL-INTENT RESOLVER]', resolverDecision);
            
            // ============================================
            // STEP 4: SORT & SELECT BEST MATCH
            // ============================================
            const selectStart = Date.now();
            
            // Sort by score (desc), then priority (desc)
            scoredScenarios.sort((a, b) => {
                if (Math.abs(a.score - b.score) > 0.01) {
                    return b.score - a.score; // Higher score wins
                }
                return (b.scenario.priority || 0) - (a.scenario.priority || 0); // Higher priority wins
            });
            
            // Top 5 for trace
            trace.topCandidates = scoredScenarios.slice(0, 5).map(s => ({
                scenarioId: s.scenario.scenarioId,
                name: s.scenario.name,
                score: s.score.toFixed(3),
                confidence: s.confidence.toFixed(3),
                priority: s.scenario.priority || 0,
                breakdown: s.breakdown
            }));
            
            // Best match
            const bestMatch = scoredScenarios[0];
            
            // Check confidence threshold
            const minConfidence = bestMatch.scenario.confidenceThreshold || this.config.minConfidenceDefault;
            
            if (bestMatch.confidence < minConfidence) {
                trace.selectionReason = `Best match confidence (${bestMatch.confidence.toFixed(2)}) below threshold (${minConfidence.toFixed(2)})`;
                trace.selectedScenario = null;
                return { scenario: null, score: bestMatch.score, confidence: bestMatch.confidence, trace };
            }
            
            // Check preconditions (state machine)
            if (bestMatch.scenario.preconditions && context.conversationState) {
                const preconditionsMet = this.checkPreconditions(
                    bestMatch.scenario.preconditions,
                    context.conversationState
                );
                
                if (!preconditionsMet) {
                    trace.selectionReason = 'Best match failed precondition check';
                    trace.selectedScenario = null;
                    return { scenario: null, score: bestMatch.score, confidence: bestMatch.confidence, trace };
                }
            }
            
            trace.timingMs.selection = Date.now() - selectStart;
            trace.selectionReason = `Matched with confidence ${bestMatch.confidence.toFixed(2)} (threshold: ${minConfidence.toFixed(2)})`;
            trace.selectedScenario = {
                scenarioId: bestMatch.scenario.scenarioId,
                name: bestMatch.scenario.name,
                score: bestMatch.score,
                confidence: bestMatch.confidence,
                priority: bestMatch.scenario.priority || 0
            };
            
            // ============================================
            // STEP 5: RETURN RESULT
            // ============================================
            trace.timingMs.total = Date.now() - startTime;
            
            logger.info('🧠 [SCENARIO SELECTOR] Match found', {
                phrase,
                scenarioId: bestMatch.scenario.scenarioId,
                name: bestMatch.scenario.name,
                score: bestMatch.score.toFixed(3),
                confidence: bestMatch.confidence.toFixed(3),
                timeMs: trace.timingMs.total
            });
            
            return {
                scenario: bestMatch.scenario,
                score: bestMatch.score,
                confidence: bestMatch.confidence,
                breakdown: bestMatch.breakdown,
                trace
            };
            
        } catch (error) {
            logger.error('❌ [SCENARIO SELECTOR] Error during selection', { error: error.message, phrase });
            trace.selectionReason = `Error: ${error.message}`;
            trace.timingMs.total = Date.now() - startTime;
            return { scenario: null, score: 0, confidence: 0, trace, error: error.message };
        }
    }
    
    // ============================================
    // SCORING FUNCTION
    // ============================================
    
    /**
     * Score a single scenario against the phrase
     * @param {String} normalizedPhrase - Normalized caller phrase
     * @param {Array} phraseTerms - Extracted key terms
     * @param {Object} scenario - Scenario to score
     * @param {Object} context - Conversation context
     * @returns {Object} - { totalScore, breakdown, confidence, blocked }
     */
    scoreScenario(normalizedPhrase, phraseTerms, scenario, context, detectedIntents = []) {
        const breakdown = {
            bm25: 0,
            semantic: 0,
            regex: 0,
            context: 0,
            intentBonus: 0
        };
        let blocked = false;
        
        // ============================================
        // 🛡️ SAFETY: Bulletproof array access
        // ============================================
        const safeTriggers = this.toArr(scenario.triggers);
        const safeNegativeTriggers = this.toArr(scenario.negativeTriggers);
        const safeRegexTriggers = this.toArr(scenario.regexTriggers);
        
        // Skip scenario if it has NO triggers at all
        if (safeTriggers.length === 0 && safeRegexTriggers.length === 0) {
            logger.warn('⚠️ [SCENARIO SELECTOR] Scenario has no triggers', {
                scenarioId: scenario.scenarioId || scenario._id,
                name: scenario.name
            });
            return { totalScore: 0, breakdown, confidence: 0, blocked: false };
        }
        
        // ============================================
        // CHECK NEGATIVE TRIGGERS FIRST
        // ============================================
        if (safeNegativeTriggers.length > 0) {
            for (const negTrigger of safeNegativeTriggers) {
                const safeTriggerStr = String(negTrigger || '').toLowerCase().trim();
                if (safeTriggerStr && normalizedPhrase.includes(safeTriggerStr)) {
                    blocked = true;
                    return { totalScore: 0, breakdown, confidence: 0, blocked: true };
                }
            }
        }
        
        // ============================================
        // 1. BM25 KEYWORD SCORING
        // ============================================
        if (safeTriggers.length > 0) {
            try {
                breakdown.bm25 = this.calculateBM25Score(
                    phraseTerms,
                    safeTriggers,
                    this.config.bm25.k1,
                    this.config.bm25.b
                );
            } catch (err) {
                logger.error('❌ [SCENARIO SELECTOR] BM25 scoring error', {
                    scenarioId: scenario.scenarioId || scenario._id,
                    error: String(err)
                });
                breakdown.bm25 = 0;
            }
        }
        
        // ============================================
        // 2. SEMANTIC SIMILARITY (PLACEHOLDER)
        // ============================================
        // TODO: In future, use sentence-transformers embeddings
        // For now, use a simple synonym/variation boost
        breakdown.semantic = 0; // Will implement in Phase 3
        
        // ============================================
        // 3. REGEX PATTERN MATCHING
        // ============================================
        if (safeRegexTriggers.length > 0) {
            try {
                const regexScore = this.calculateRegexScore(
                    normalizedPhrase,
                    safeRegexTriggers
                );
                // Regex match = high confidence boost
                if (regexScore > 0) {
                    breakdown.regex = 1.0; // Full regex match = 100%
                }
            } catch (err) {
                logger.error('❌ [SCENARIO SELECTOR] Regex scoring error', {
                    scenarioId: scenario.scenarioId || scenario._id,
                    error: String(err)
                });
                breakdown.regex = 0;
            }
        }
        
        // ============================================
        // 4. CONTEXT WEIGHTING
        // ============================================
        if (context.conversationState || context.lastIntent || context.callerProfile) {
            breakdown.context = this.calculateContextScore(scenario, context);
        }
        
        // ============================================
        // COMBINE SCORES
        // ============================================
        const totalScore = 
            (breakdown.bm25 * this.config.weights.bm25) +
            (breakdown.semantic * this.config.weights.semantic) +
            (breakdown.regex * this.config.weights.regex) +
            (breakdown.context * this.config.weights.context);
        
        // 🛡️ SAFETY: NEVER allow NaN or Infinity
        let safeScore = Number.isFinite(totalScore) ? totalScore : 0;
        
        // ============================================
        // 🎯 APPLY INTENT PRIORITY BONUS
        // ============================================
        // CRITICAL: BOOK intent gets +0.40 bonus over QUESTION
        // Example: "AC leaking, can I schedule?" → BOOK wins
        if (detectedIntents && detectedIntents.length > 0) {
            // Get primary intent (highest priority)
            const primaryIntent = detectedIntents[0];
            const intentBonus = this.getIntentBonus(primaryIntent);
            
            // Apply bonus only if scenario category matches intent
            // (Prevents BOOK bonus from boosting Q&A scenarios)
            const scenarioMatchesIntent = this.scenarioMatchesIntent(scenario, primaryIntent);
            
            if (scenarioMatchesIntent && intentBonus > 0) {
                breakdown.intentBonus = intentBonus;
                safeScore = Math.min(safeScore + intentBonus, 1.0);
                
                logger.debug('🎯 [INTENT BONUS] Applied', {
                    scenarioId: scenario.scenarioId || scenario._id,
                    name: scenario.name,
                    intent: primaryIntent,
                    bonus: intentBonus,
                    originalScore: totalScore.toFixed(3),
                    boostedScore: safeScore.toFixed(3)
                });
            }
        }
        
        // ============================================
        // 5. URGENCY KEYWORD BOOST 🚨
        // ============================================
        // CRITICAL: Database-driven emergency detection
        // Scans phrase for urgency keywords with word boundaries
        // Boosts score for emergency scenarios when urgency detected
        if (this.urgencyKeywords.size > 0) {
            const urgencyBoost = this.calculateUrgencyBoost(normalizedPhrase, scenario);
            
            if (urgencyBoost > 0) {
                breakdown.urgencyBonus = urgencyBoost;
                safeScore = Math.min(safeScore + urgencyBoost, 1.0);
                
                logger.debug('🚨 [URGENCY BOOST] Applied', {
                    scenarioId: scenario.scenarioId || scenario._id,
                    name: scenario.name,
                    boost: urgencyBoost.toFixed(3),
                    originalScore: totalScore.toFixed(3),
                    boostedScore: safeScore.toFixed(3)
                });
            }
        }
        
        const confidence = Math.min(Math.max(safeScore, 0), 1);
        
        // Final validation
        if (!Number.isFinite(confidence)) {
            logger.error('❌ [SCENARIO SELECTOR] Non-finite confidence', {
                totalScore,
                breakdown,
                scenarioId: scenario.scenarioId || scenario._id
            });
            return { totalScore: 0, breakdown, confidence: 0, blocked: false };
        }
        
        return { totalScore: safeScore, breakdown, confidence, blocked: false };
    }
    
    // ============================================
    // BM25 KEYWORD SCORING
    // ============================================
    
    /**
     * Calculate BM25 score (industry-standard keyword matching)
     * @param {Array} phraseTerms - Terms from caller phrase
     * @param {Array} triggers - Scenario triggers
     * @param {Number} k1 - Term frequency saturation parameter
     * @param {Number} b - Length normalization parameter
     * @returns {Number} - BM25 score (0-1 normalized)
     */
    calculateBM25Score(phraseTerms, triggers, k1, b) {
        if (phraseTerms.length === 0 || triggers.length === 0) {return 0;}
        
        // Normalize triggers
        const normalizedTriggers = triggers.map(t => {
            const normalized = this.normalizePhrase(t);
            return this.extractTerms(normalized);
        });
        
        let bestScore = 0;
        
        for (const triggerTerms of normalizedTriggers) {
            if (triggerTerms.length === 0) {continue;}
            
            // Count matching terms
            let matchingTerms = 0;
            const triggerTermSet = new Set(triggerTerms);
            const phraseTermSet = new Set(phraseTerms);
            
            // Term overlap (how many trigger words appear in phrase)
            for (const triggerTerm of triggerTermSet) {
                if (phraseTermSet.has(triggerTerm)) {
                    matchingTerms++;
                }
            }
            
            // Also check reverse (how many phrase words appear in trigger)
            let reverseMatch = 0;
            for (const phraseTerm of phraseTermSet) {
                if (triggerTermSet.has(phraseTerm)) {
                    reverseMatch++;
                }
            }
            
            // Calculate scores
            const forwardScore = matchingTerms / triggerTermSet.size; // What % of trigger is in phrase?
            const reverseScore = reverseMatch / phraseTermSet.size;   // What % of phrase is in trigger?
            
            // Weighted average (favor forward match)
            const score = (forwardScore * 0.7) + (reverseScore * 0.3);
            
            bestScore = Math.max(bestScore, score);
        }
        
        return Math.min(bestScore, 1);
    }
    
    // ============================================
    // REGEX PATTERN MATCHING
    // ============================================
    
    /**
     * Calculate regex match score
     * @param {String} normalizedPhrase - Normalized phrase
     * @param {Array} regexTriggers - Regex patterns
     * @returns {Number} - Regex score (0-1)
     */
    calculateRegexScore(normalizedPhrase, regexTriggers) {
        if (!regexTriggers || regexTriggers.length === 0) {return 0;}
        
        for (const pattern of regexTriggers) {
            try {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(normalizedPhrase)) {
                    return 1.0; // Regex match = 100% confidence
                }
            } catch (error) {
                logger.warn('⚠️ [SCENARIO SELECTOR] Invalid regex pattern', { pattern, error: error.message });
            }
        }
        
        return 0;
    }
    
    // ============================================
    // CONTEXT WEIGHTING
    // ============================================
    
    /**
     * Calculate context-based score boost
     * @param {Object} scenario - Scenario being scored
     * @param {Object} context - Conversation context
     * @returns {Number} - Context score (0-1)
     */
    calculateContextScore(scenario, context) {
        let score = 0;
        
        // Boost if scenario matches recent conversation intent
        if (context.lastIntent && scenario.categories) {
            if (scenario.categories.includes(context.lastIntent)) {
                score += 0.3;
            }
        }
        
        // Boost if caller has history with this type of scenario
        if (context.callerProfile && context.callerProfile.preferredScenarios) {
            if (context.callerProfile.preferredScenarios.includes(scenario.scenarioId)) {
                score += 0.2;
            }
        }
        
        // Boost based on conversation state
        if (context.conversationState) {
            // Example: if state says "collecting_phone", boost phone-related scenarios
            // This would be scenario-specific logic
            score += 0.1;
        }
        
        return Math.min(score, 1);
    }
    
    // ============================================
    // PRECONDITION VALIDATION
    // ============================================
    
    /**
     * Check if scenario preconditions are met
     * @param {Object} preconditions - Scenario preconditions (JSON)
     * @param {Object} conversationState - Current conversation state
     * @returns {Boolean} - True if preconditions met
     */
    checkPreconditions(preconditions, conversationState) {
        try {
            // Simple key-value matching
            // In production, would use more sophisticated logic engine
            if (typeof preconditions !== 'object') {return true;}
            
            for (const [key, expectedValue] of Object.entries(preconditions)) {
                if (conversationState[key] !== expectedValue) {
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            logger.warn('⚠️ [SCENARIO SELECTOR] Error checking preconditions', { error: error.message });
            return true; // Fail open
        }
    }
    
    // ============================================
    // TEXT NORMALIZATION UTILITIES
    // ============================================
    
    /**
     * Normalize phrase for matching
     * @param {String} phrase - Raw phrase
     * @returns {String} - Normalized phrase
     */
    normalizePhrase(phrase) {
        if (!phrase) {return '';}
        
        // ============================================
        // ENHANCED NORMALIZATION PIPELINE (3 stages)
        // ============================================
        // Stage 1: Synonym translation (colloquial → technical)
        // Stage 2: Standard normalization (lowercase, punctuation, spacing)
        // Stage 3: Filler removal (noise removal)
        
        // Stage 1: Apply synonym translation
        const synonymResult = this.applySynonymTranslation(phrase);
        let processed = synonymResult.translated;
        
        // Stage 2: Standard normalization (punctuation + spacing)
        processed = processed
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .replace(/\s+/g, ' ')      // Collapse spaces
            .trim();
        
        // Stage 3: Remove filler words (after normalization for better matching)
        const fillerResult = this.removeFillerWords(processed);
        processed = fillerResult.filtered;
        
        // Build pipeline diagnostic
        this.lastPipelineDiagnostic = {
            input: phrase,
            stages: {
                synonyms: {
                    applied: synonymResult.replacements || [],
                    mapSize: this.synonymMap?.size || 0
                },
                normalized: {
                    afterSynonyms: synonymResult.translated,
                    afterPunctuation: processed
                },
                fillers: {
                    removed: fillerResult.removedFillers || [],
                    listSize: fillerResult.fillerSetSize || 0
                }
            },
            output: processed
        };
        
        return processed;
    }
    
    /**
     * 🪟 WINDOWED MATCHING - Prevents long phrases from diluting intent
     * Scores the BEST 7-10 word sliding window instead of full phrase
     * 
     * Example:
     * "Hi, I called earlier but I forgot I have a doctor's appointment. Can I change my appointment?"
     * Instead of scoring all 16 words (diluted by chit-chat),
     * scores windows like:
     * - "forgot i have doctor appointment can"
     * - "have doctor appointment can i change"
     * - "appointment can i change my appointment" ← BEST WINDOW
     * 
     * @param {Array} tokens - All tokens from phrase
     * @param {Function} scoreFn - Function to score a window: scoreFn(windowText) => score
     * @param {Number} windowSize - Window size (default: 10 words)
     * @returns {Number} - Best window score
     */
    bestWindowScore(tokens, scoreFn, windowSize = 10) {
        if (!tokens || tokens.length === 0) {return 0;}
        
        // If phrase is shorter than window, score the whole thing
        if (tokens.length <= windowSize) {
            return scoreFn(tokens.join(' '));
        }
        
        let bestScore = 0;
        
        // Slide window across tokens
        for (let i = 0; i <= tokens.length - windowSize; i++) {
            const windowTokens = tokens.slice(i, i + windowSize);
            const windowText = windowTokens.join(' ');
            const score = scoreFn(windowText);
            
            if (score > bestScore) {
                bestScore = score;
            }
        }
        
        // Also try smaller windows (7 words) for short, punchy phrases
        const smallWindowSize = 7;
        if (tokens.length > smallWindowSize) {
            for (let i = 0; i <= tokens.length - smallWindowSize; i++) {
                const windowTokens = tokens.slice(i, i + smallWindowSize);
                const windowText = windowTokens.join(' ');
                const score = scoreFn(windowText);
                
                if (score > bestScore) {
                    bestScore = score;
                }
            }
        }
        
        return bestScore;
    }
    
    /**
     * Extract meaningful terms from phrase
     * @param {String} normalizedPhrase - Normalized phrase
     * @returns {Array} - Array of terms
     */
    extractTerms(normalizedPhrase) {
        if (!normalizedPhrase) {return [];}
        
        const words = normalizedPhrase.split(' ');
        
        // Remove filler words and short words
        return words.filter(word => 
            !this.fillerWords.has(word) && 
            word.length > 2
        );
    }
    
    // ============================================
    // INTENT DETECTION & PRIORITY ROUTING
    // ============================================
    
    /**
     * Detect caller intents from phrase
     * @param {String} normalizedPhrase - Normalized phrase
     * @param {Array} phraseTerms - Extracted terms
     * @returns {Array} - Detected intents (sorted by priority)
     */
    detectIntents(normalizedPhrase, phraseTerms) {
        const intents = [];
        
        // Check each intent type
        for (const [intentType, keywords] of Object.entries(this.intentKeywords)) {
            if (intentType === 'PROBLEM_TOPICS') {continue;} // Skip problem topics
            
            for (const keyword of keywords) {
                if (normalizedPhrase.includes(keyword)) {
                    if (!intents.includes(intentType)) {
                        intents.push(intentType);
                    }
                    break;
                }
            }
        }
        
        // Sort by priority (highest first)
        intents.sort((a, b) => {
            const priorityA = this.intentPriority[a] || 0;
            const priorityB = this.intentPriority[b] || 0;
            return priorityB - priorityA;
        });
        
        return intents;
    }
    
    /**
     * Extract problem topics for dispatcher context
     * @param {String} normalizedPhrase - Normalized phrase
     * @returns {Array} - Detected problem topics
     */
    extractProblemTopics(normalizedPhrase) {
        const topics = [];
        
        for (const topic of this.intentKeywords.PROBLEM_TOPICS) {
            if (normalizedPhrase.includes(topic)) {
                topics.push(topic);
            }
        }
        
        return topics;
    }
    
    /**
     * Get intent bonus for confidence scoring
     * @param {String} intentType - Detected intent type
     * @returns {Number} - Bonus score (0.0 to 0.5)
     */
    getIntentBonus(intentType) {
        return this.intentBonuses[intentType] || 0.0;
    }
    
    /**
     * Check if scenario category matches detected intent
     * @param {Object} scenario - Scenario to check
     * @param {String} intentType - Detected intent type
     * @returns {Boolean} - True if scenario matches intent
     */
    scenarioMatchesIntent(scenario, intentType) {
        const scenarioName = (scenario.name || '').toLowerCase();
        const scenarioCategories = scenario.categories || [];
        
        // Map intent types to scenario keywords
        const intentMappings = {
            EMERGENCY: ['emergency', 'urgent'],
            BOOK: ['appointment', 'schedule', 'visit', 'booking', 'request'],
            RESCHEDULE: ['reschedule', 'cancel', 'change'],
            STATUS: ['status', 'billing', 'hours', 'pricing', 'cost'],
            QUESTION: ['question', 'inquiry', 'q&a', 'qna', 'trade'],
            SMALLTALK: ['smalltalk', 'gratitude', 'goodbye', 'greeting']
        };
        
        const keywords = intentMappings[intentType] || [];
        
        // Check if any keyword matches scenario name or categories
        for (const keyword of keywords) {
            if (scenarioName.includes(keyword)) {
                return true;
            }
            
            for (const category of scenarioCategories) {
                if (category.toLowerCase().includes(keyword)) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    // ============================================
    // STATISTICS & DEBUGGING
    // ============================================
    
    /**
     * Get service statistics
     * @returns {Object} - Service stats
     */
    getStats() {
        return {
            config: this.config,
            fillerWordsCount: this.fillerWords.size,
            version: '1.0.0'
        };
    }
    
    // ============================================
    // DUAL-INTENT RESOLVER HELPERS
    // ============================================
    
    /**
     * Compute problem score (emergency keywords detected)
     * @param {String} normalizedPhrase - Normalized caller phrase
     * @param {Array} phraseTerms - Extracted content terms
     * @param {Array} scoredScenarios - All scored scenarios
     * @returns {Number} - Problem score (0-1)
     */
    computeProblemScore(normalizedPhrase, phraseTerms, scoredScenarios) {
        // Emergency keywords (urgency indicators)
        const emergencyKeywords = this.intentKeywords.EMERGENCY || [];
        const problemKeywords = this.intentKeywords.PROBLEM_TOPICS || [];
        
        let matchCount = 0;
        const totalKeywords = emergencyKeywords.length + problemKeywords.length;
        
        // Check for emergency keywords
        emergencyKeywords.forEach(keyword => {
            if (normalizedPhrase.includes(keyword.toLowerCase())) {
                matchCount += 2;  // Emergency keywords count double
            }
        });
        
        // Check for problem keywords
        problemKeywords.forEach(keyword => {
            if (normalizedPhrase.includes(keyword.toLowerCase())) {
                matchCount += 1;
            }
        });
        
        // Also check if any emergency scenarios scored well
        const emergencyScenarios = scoredScenarios.filter(s => this.isEmergencyScenario(s.scenario));
        const maxEmergencyScore = emergencyScenarios.length > 0 
            ? Math.max(...emergencyScenarios.map(s => s.score)) 
            : 0;
        
        // Combine keyword match and scenario score
        const keywordScore = Math.min(matchCount / 5, 1.0);  // Normalize to 0-1
        const finalScore = (keywordScore * 0.6) + (maxEmergencyScore * 0.4);
        
        return Math.min(finalScore, 1.0);
    }
    
    /**
     * Compute action score (booking keywords detected)
     * @param {String} normalizedPhrase - Normalized caller phrase
     * @param {Array} phraseTerms - Extracted content terms
     * @param {Array} scoredScenarios - All scored scenarios
     * @returns {Number} - Action score (0-1)
     */
    computeActionScore(normalizedPhrase, phraseTerms, scoredScenarios) {
        // Booking keywords (action indicators)
        const bookingKeywords = this.intentKeywords.BOOK || [];
        const rescheduleKeywords = this.intentKeywords.RESCHEDULE || [];
        
        let matchCount = 0;
        const totalKeywords = bookingKeywords.length + rescheduleKeywords.length;
        
        // Check for booking keywords
        bookingKeywords.forEach(keyword => {
            if (normalizedPhrase.includes(keyword.toLowerCase())) {
                matchCount += 1;
            }
        });
        
        // Check for reschedule keywords
        rescheduleKeywords.forEach(keyword => {
            if (normalizedPhrase.includes(keyword.toLowerCase())) {
                matchCount += 1;
            }
        });
        
        // Also check if any booking scenarios scored well
        const bookingScenarios = scoredScenarios.filter(s => this.isBookingScenario(s.scenario));
        const maxBookingScore = bookingScenarios.length > 0 
            ? Math.max(...bookingScenarios.map(s => s.score)) 
            : 0;
        
        // Combine keyword match and scenario score
        const keywordScore = Math.min(matchCount / 3, 1.0);  // Normalize to 0-1
        const finalScore = (keywordScore * 0.6) + (maxBookingScore * 0.4);
        
        return Math.min(finalScore, 1.0);
    }
    
    /**
     * Check if scenario is an emergency scenario
     * @param {Object} scenario - Scenario object
     * @returns {Boolean}
     */
    isEmergencyScenario(scenario) {
        if (!scenario) {return false;}
        const name = (scenario.name || '').toLowerCase();
        const categories = this.toArr(scenario.categories).map(c => c.toLowerCase());
        
        return name.includes('emergency') || 
               name.includes('urgent') ||
               categories.some(c => c.includes('emergency') || c.includes('urgent'));
    }
    
    /**
     * Check if scenario is a booking scenario
     * @param {Object} scenario - Scenario object
     * @returns {Boolean}
     */
    isBookingScenario(scenario) {
        if (!scenario) {return false;}
        const name = (scenario.name || '').toLowerCase();
        const categories = this.toArr(scenario.categories).map(c => c.toLowerCase());
        
        return name.includes('appointment') || 
               name.includes('schedule') ||
               name.includes('booking') ||
               name.includes('visit') ||
               categories.some(c => c.includes('appointment') || c.includes('booking') || c.includes('schedule'));
    }
    
    /**
     * Extract problem topics from phrase for clarifier prompt
     * @param {String} normalizedPhrase - Normalized phrase
     * @returns {Array} - List of problem keywords found
     */
    extractProblemTopics(normalizedPhrase) {
        const problemKeywords = this.intentKeywords.PROBLEM_TOPICS || [];
        const found = [];
        
        problemKeywords.forEach(keyword => {
            if (normalizedPhrase.includes(keyword.toLowerCase())) {
                found.push(keyword);
            }
        });
        
        return found.length > 0 ? found.slice(0, 3) : ['an issue'];  // Max 3 topics
    }
    
    /**
     * ============================================================================
     * 🔤 SYNONYM TRANSLATION - Colloquial → Technical Terms
     * ============================================================================
     * Translates colloquial/non-technical terms to technical terms before matching.
     * This dramatically improves match rates for non-technical customers.
     * 
     * Example:
     * Input: "the thingy on the wall isn't working"
     * Output: "the thermostat on the wall isn't working"
     * 
     * @param {String} phrase - Input phrase
     * @returns {String} - Phrase with synonyms replaced
     */
    applySynonymTranslation(phrase) {
        if (!phrase || this.synonymMap.size === 0) {
            return { translated: phrase, replacements: [] };
        }
        
        let translatedPhrase = phrase.toLowerCase();
        const replacements = [];
        
        // For each technical term and its aliases
        for (const [technicalTerm, aliases] of this.synonymMap.entries()) {
            for (const alias of aliases) {
                // Use word boundary regex for accurate replacement
                // Prevents "the" from being replaced inside "thermostat"
                const regex = new RegExp(`\\b${this.escapeRegex(alias)}\\b`, 'gi');
                
                if (regex.test(translatedPhrase)) {
                    replacements.push({
                        from: alias,
                        to: technicalTerm
                    });
                    translatedPhrase = translatedPhrase.replace(regex, technicalTerm);
                }
            }
        }
        
        if (replacements.length > 0) {
            logger.info('🔤 [SYNONYM TRANSLATION] Applied', {
                original: phrase.substring(0, 100),
                translated: translatedPhrase.substring(0, 100),
                replacements: replacements.map(r => `"${r.from}" → "${r.to}"`).join(', ')
            });
        }
        
        // Store last translation for external access
        this.lastSynonymTranslation = {
            original: phrase,
            translated: translatedPhrase,
            replacements
        };
        
        return { translated: translatedPhrase, replacements };
    }
    
    /**
     * Get the last synonym translation result (for Black Box logging)
     */
    getLastSynonymTranslation() {
        return this.lastSynonymTranslation || { original: '', translated: '', replacements: [] };
    }
    
    /**
     * Get the FULL pipeline diagnostic (for Black Box MATCHING_PIPELINE event)
     * Call this after selectScenario() to get complete visibility
     */
    getFullPipelineDiagnostic() {
        return this.lastPipelineDiagnostic || null;
    }
    
    /**
     * Helper: Escape special regex characters
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    /**
     * ============================================================================
     * 🔇 ENHANCED FILLER REMOVAL - Template + Category Inheritance
     * ============================================================================
     * Removes filler words (noise) from input before matching.
     * Now supports 3-tier inheritance: template + category + scenario exclusions.
     * 
     * @param {String} phrase - Input phrase
     * @returns {String} - Phrase with fillers removed
     */
    removeFillerWords(phrase) {
        if (!phrase || this.fillerWords.size === 0) {
            return { filtered: phrase, removedFillers: [], fillerSetSize: this.fillerWords.size };
        }
        
        const words = phrase.toLowerCase().split(/\s+/);
        const removedFillers = [];
        const filtered = words.filter(word => {
            const trimmed = word.trim();
            if (this.fillerWords.has(trimmed)) {
                removedFillers.push(trimmed);
                return false;
            }
            return true;
        });
        
        const result = filtered.join(' ').trim();
        
        if (removedFillers.length > 0) {
            logger.debug('🔇 [FILLER REMOVAL] Applied', {
                original: phrase.substring(0, 80),
                filtered: result.substring(0, 80),
                removed: removedFillers.length,
                fillers: removedFillers.slice(0, 10)
            });
        }
        
        // Store for diagnostics
        this.lastFillerRemoval = {
            original: phrase,
            filtered: result,
            removedFillers,
            fillerSetSize: this.fillerWords.size
        };
        
        return { filtered: result, removedFillers, fillerSetSize: this.fillerWords.size };
    }
    
    /**
     * Calculate urgency boost from database-driven urgency keywords
     * @param {String} normalizedPhrase - Normalized caller phrase
     * @param {Object} scenario - Scenario being scored
     * @returns {Number} - Urgency boost (0.0 to 0.5, capped)
     */
    calculateUrgencyBoost(normalizedPhrase, scenario) {
        // Only boost emergency/urgent scenarios
        // Prevents urgency keywords from boosting Q&A or small talk
        if (!this.isEmergencyScenario(scenario)) {
            return 0;
        }
        
        let totalBoost = 0;
        const detectedKeywords = [];
        
        // Scan phrase for urgency keywords with word boundaries
        for (const [word, config] of this.urgencyKeywords.entries()) {
            // Use word boundary regex for accurate detection
            // Prevents "leak" from matching "please"
            const wordBoundaryRegex = new RegExp(`\\b${word}\\b`, 'i');
            
            if (wordBoundaryRegex.test(normalizedPhrase)) {
                totalBoost += config.weight;
                detectedKeywords.push({
                    word,
                    weight: config.weight,
                    category: config.category
                });
            }
        }
        
        // Cap total boost at 0.5 (50%) to prevent over-boosting
        const cappedBoost = Math.min(totalBoost, 0.5);
        
        if (detectedKeywords.length > 0) {
            logger.info('🚨 [URGENCY DETECTED]', {
                scenarioId: scenario.scenarioId || scenario._id,
                scenarioName: scenario.name,
                keywords: detectedKeywords.map(k => `${k.word}(${k.weight})`).join(', '),
                totalBoost: totalBoost.toFixed(3),
                cappedBoost: cappedBoost.toFixed(3),
                phrase: normalizedPhrase.substring(0, 100) // First 100 chars
            });
        }
        
        return cappedBoost;
    }
}

// Export the class (not an instance) so it can be instantiated per request
module.exports = HybridScenarioSelector;


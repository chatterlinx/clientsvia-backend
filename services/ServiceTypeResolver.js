/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SERVICE TYPE RESOLVER - Single Source of Truth for Service Type
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: This is the ONLY authority for service type determination.
 * All other systems (booking, calendar, compliance, analytics) READ from here.
 * 
 * ARCHITECTURAL RULES:
 * 1. Resolution happens ONCE per call (early in conversation)
 * 2. Result is stored in session.serviceTypeResolution
 * 3. Nobody else detects or computes service type
 * 4. Legacy fields (session.booking.serviceType, session.discovery.serviceType) 
 *    are kept in sync but are NOT the source of truth
 * 
 * USED BY:
 * - ConversationEngine (calls resolve early)
 * - BookingScriptEngine (reads canonicalType)
 * - GoogleCalendarService (reads canonicalType for colors/rules)
 * - ComplianceChecker (reads canonicalType)
 * - BlackBoxLogger (logs resolution metadata)
 * - Future: SMS intake, web chat, reporting tools
 * 
 * RESOLUTION STATES:
 * - PENDING: Not yet resolved
 * - RESOLVED: Auto-detected with sufficient confidence
 * - CLARIFYING: Asked clarifier, waiting for response
 * - CONFIRMED: Clarified by caller or explicitly stated
 * - LOCKED: Final, will not change for this call
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// CANONICAL SERVICE TYPES
// These are the ONLY valid service types in the system
// ════════════════════════════════════════════════════════════════════════════════

const CANONICAL_SERVICE_TYPES = [
    'emergency',      // Same-day urgent (30 min lead time)
    'repair',         // Equipment broken/not working (1 hr lead time)
    'maintenance',    // Tune-ups, seasonal (7 day advance)
    'estimate',       // Quotes, pricing (1 day advance)
    'installation',   // New equipment (3 day advance)
    'inspection',     // System checks (1 day advance)
    'consultation',   // General questions (same day OK)
    'service'         // Generic fallback
];

// Core types that SHOULD have calendar mappings (missing = yellow warning)
const CORE_SERVICE_TYPES = ['emergency', 'repair', 'maintenance', 'estimate'];

// Optional types (missing = info only, not a warning)
const OPTIONAL_SERVICE_TYPES = ['installation', 'inspection', 'consultation'];

// Fallback type when detection fails or type is unknown
const FALLBACK_SERVICE_TYPE = 'service';

// ════════════════════════════════════════════════════════════════════════════════
// RUNTIME PATH CONTRACT
// This constant defines WHERE the canonical type is stored.
// All consumers MUST read from this path. Wiring verifies this.
// ════════════════════════════════════════════════════════════════════════════════

const CANONICAL_TYPE_PATH = 'session.serviceTypeResolution.canonicalType';

// Accessor function name that consumers should use
const CANONICAL_TYPE_ACCESSOR = 'ServiceTypeResolver.getCanonicalType(session)';

// ════════════════════════════════════════════════════════════════════════════════
// RESOLUTION STATES
// ════════════════════════════════════════════════════════════════════════════════

const RESOLUTION_STATES = {
    PENDING: 'PENDING',           // Not yet resolved
    RESOLVED: 'RESOLVED',         // Auto-detected with confidence
    CLARIFYING: 'CLARIFYING',     // Asked clarifier, waiting
    CONFIRMED: 'CONFIRMED',       // Clarified by caller
    LOCKED: 'LOCKED'              // Final, immutable
};

// ════════════════════════════════════════════════════════════════════════════════
// KEYWORD SCORING MAP
// Each keyword has a score. Higher = more confident match.
// ════════════════════════════════════════════════════════════════════════════════

const SERVICE_TYPE_KEYWORDS = {
    emergency: {
        high: [  // 3 points
            'emergency', 'urgent', 'asap', 'immediately', 'right now',
            'flooding', 'flooded', 'water everywhere', 'gas leak', 'gas smell',
            'no heat', 'no cooling', 'no ac', 'no air', 'freezing', 'dangerous',
            'smoke', 'fire', 'sparking', 'electrical smell', 'burning smell'
        ],
        medium: [  // 2 points
            'today', 'same day', 'cant wait', "can't wait", 'need someone now',
            'its bad', "it's bad", 'really bad', 'getting worse', 'urgent repair'
        ],
        low: [  // 1 point
            'broken', 'not working', 'stopped', 'wont turn on', "won't turn on"
        ]
    },
    
    repair: {
        high: [
            'repair', 'fix', 'broken', 'not working', 'stopped working',
            'wont start', "won't start", 'wont turn on', "won't turn on",
            'making noise', 'strange noise', 'loud noise', 'grinding',
            'leaking', 'dripping', 'not cooling', 'not heating',
            'blowing warm', 'blowing hot', 'blowing cold when should be hot'
        ],
        medium: [
            'something wrong', 'acting up', 'acting weird', 'not right',
            'problem with', 'issue with', 'trouble with', 'having issues'
        ],
        low: [
            'check', 'look at', 'take a look', 'see whats wrong'
        ]
    },
    
    maintenance: {
        high: [
            'maintenance', 'tune up', 'tune-up', 'tuneup', 'annual',
            'seasonal', 'preventive', 'preventative', 'routine',
            'spring check', 'fall check', 'winter check', 'summer check',
            'clean', 'cleaning', 'filter', 'filters'
        ],
        medium: [
            'checkup', 'check up', 'check-up', 'service call',
            'regular service', 'scheduled service', 'due for service'
        ],
        low: [
            'been a while', 'hasnt been serviced', "hasn't been serviced"
        ]
    },
    
    estimate: {
        high: [
            'estimate', 'quote', 'bid', 'pricing', 'price',
            'how much', 'cost', 'what would it cost', 'ballpark',
            'free estimate', 'get a quote'
        ],
        medium: [
            'thinking about', 'considering', 'options', 'compare',
            'shopping around', 'get pricing'
        ],
        low: [
            'expensive', 'budget', 'afford'
        ]
    },
    
    installation: {
        high: [
            'install', 'installation', 'new unit', 'new system',
            'replacement', 'replace', 'upgrade', 'new equipment',
            'new ac', 'new furnace', 'new hvac', 'new water heater'
        ],
        medium: [
            'put in', 'set up', 'getting a new', 'buying new',
            'time for new', 'need new'
        ],
        low: [
            'old', 'outdated', 'too old', 'past its life'
        ]
    },
    
    inspection: {
        high: [
            'inspect', 'inspection', 'evaluate', 'assessment',
            'home inspection', 'real estate', 'buying house', 'selling house',
            'pre-purchase', 'pre purchase'
        ],
        medium: [
            'check out', 'take a look', 'see the condition',
            'whats the condition', "what's the condition"
        ],
        low: []
    },
    
    consultation: {
        high: [
            'consultation', 'consult', 'advice', 'question',
            'wondering about', 'curious about', 'information',
            'learn about', 'tell me about'
        ],
        medium: [
            'have a question', 'quick question', 'want to know'
        ],
        low: []
    }
};

// Confidence thresholds
const CONFIDENCE = {
    HIGH_THRESHOLD: 4,    // Accept without asking
    MEDIUM_THRESHOLD: 2,  // Accept if clear lead
    TIE_MARGIN: 1         // Within this = tie → ask
};

// ════════════════════════════════════════════════════════════════════════════════
// CLARIFIER QUESTIONS
// Minimal, human questions that map to scheduling urgency
// ════════════════════════════════════════════════════════════════════════════════

const CLARIFIERS = {
    emergencyVsRegular: {
        question: "Is this something that needs attention right away today, or can we schedule the next available appointment?",
        options: {
            emergency: ['right away', 'today', 'now', 'urgent', 'emergency', 'asap', 'immediately', 'right now'],
            regular: ['next available', 'schedule', 'whenever', 'not urgent', 'can wait', 'appointment', 'next week']
        },
        // 'regular' maps to tentative type or 'repair' as default
        regularFallback: 'repair'
    },
    
    repairVsMaintenance: {
        question: "Is something not working right, or is this for routine maintenance?",
        options: {
            repair: ['not working', 'broken', 'fix', 'repair', 'problem', 'issue', 'wrong', 'stopped'],
            maintenance: ['maintenance', 'routine', 'tune up', 'checkup', 'preventive', 'cleaning', 'regular']
        }
    },
    
    genericServiceType: {
        question: "Just so I schedule the right appointment — is this for a repair, routine maintenance, or something else like an estimate or installation?",
        options: {
            repair: ['repair', 'fix', 'broken', 'not working'],
            maintenance: ['maintenance', 'routine', 'tune up', 'checkup', 'cleaning'],
            estimate: ['estimate', 'quote', 'price', 'cost', 'how much'],
            installation: ['install', 'new', 'replacement', 'upgrade']
        }
    }
};

// ════════════════════════════════════════════════════════════════════════════════
// MAIN CLASS: ServiceTypeResolver
// ════════════════════════════════════════════════════════════════════════════════

class ServiceTypeResolver {
    
    /**
     * Initialize or get the resolution state from session
     * @param {Object} session - The call session
     * @returns {Object} The resolution state
     */
    static getResolution(session) {
        if (!session.serviceTypeResolution) {
            session.serviceTypeResolution = {
                state: RESOLUTION_STATES.PENDING,
                canonicalType: null,
                confidence: null,
                confidenceScore: 0,
                method: null,
                clarifierType: null,
                clarifierAsked: false,
                clarifierResponse: null,
                scores: {},
                resolvedAt: null,
                lockedAt: null
            };
        }
        return session.serviceTypeResolution;
    }
    
    /**
     * Check if service type is already resolved
     * @param {Object} session - The call session
     * @returns {boolean}
     */
    static isResolved(session) {
        const resolution = this.getResolution(session);
        return [
            RESOLUTION_STATES.RESOLVED,
            RESOLUTION_STATES.CONFIRMED,
            RESOLUTION_STATES.LOCKED
        ].includes(resolution.state);
    }
    
    /**
     * Check if we're waiting for clarification
     * @param {Object} session - The call session
     * @returns {boolean}
     */
    static isPendingClarification(session) {
        const resolution = this.getResolution(session);
        return resolution.state === RESOLUTION_STATES.CLARIFYING;
    }
    
    /**
     * Get the canonical service type (what everything else should use)
     * @param {Object} session - The call session
     * @returns {string} The canonical service type
     */
    static getCanonicalType(session) {
        const resolution = this.getResolution(session);
        return resolution.canonicalType || 'service';
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════════
     * MAIN RESOLVE METHOD
     * Called early in the conversation to determine service type
     * ════════════════════════════════════════════════════════════════════════════
     * 
     * @param {Object} session - The call session
     * @param {string} issueText - The caller's issue/problem description
     * @param {Object} options - Optional configuration
     * @returns {Object} Resolution result
     */
    static resolve(session, issueText, options = {}) {
        const resolution = this.getResolution(session);
        
        // ─────────────────────────────────────────────────────────────────────
        // RULE 1: If already locked, don't re-resolve
        // ─────────────────────────────────────────────────────────────────────
        if (resolution.state === RESOLUTION_STATES.LOCKED) {
            logger.debug('[SERVICE TYPE RESOLVER] Already locked, skipping', {
                canonicalType: resolution.canonicalType
            });
            return {
                resolved: true,
                canonicalType: resolution.canonicalType,
                needsClarification: false,
                alreadyLocked: true
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // RULE 2: If already resolved with high confidence, don't re-resolve
        // ─────────────────────────────────────────────────────────────────────
        if (resolution.state === RESOLUTION_STATES.RESOLVED && 
            resolution.confidence === 'high') {
            logger.debug('[SERVICE TYPE RESOLVER] Already resolved (high), skipping', {
                canonicalType: resolution.canonicalType
            });
            return {
                resolved: true,
                canonicalType: resolution.canonicalType,
                needsClarification: false,
                alreadyResolved: true
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // RULE 3: If waiting for clarification, don't re-resolve
        // ─────────────────────────────────────────────────────────────────────
        if (resolution.state === RESOLUTION_STATES.CLARIFYING) {
            return {
                resolved: false,
                canonicalType: resolution.canonicalType, // Tentative
                needsClarification: true,
                clarifierQuestion: CLARIFIERS[resolution.clarifierType]?.question,
                clarifierType: resolution.clarifierType,
                awaitingResponse: true
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // RULE 4: Check for explicit service type already set
        // ─────────────────────────────────────────────────────────────────────
        const explicit = options.explicitType || 
                        session.booking?.serviceType || 
                        session.discovery?.serviceType;
        
        if (explicit && explicit !== 'service' && CANONICAL_SERVICE_TYPES.includes(explicit)) {
            resolution.state = RESOLUTION_STATES.CONFIRMED;
            resolution.canonicalType = explicit;
            resolution.confidence = 'explicit';
            resolution.confidenceScore = 10;
            resolution.method = 'explicit';
            resolution.resolvedAt = new Date().toISOString();
            
            this._syncLegacyFields(session, explicit);
            
            logger.info('[SERVICE TYPE RESOLVER] Explicit type set', {
                canonicalType: explicit,
                source: options.explicitType ? 'option' : 'session'
            });
            
            return {
                resolved: true,
                canonicalType: explicit,
                needsClarification: false,
                method: 'explicit'
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // RULE 5: Auto-detect from issue text
        // ─────────────────────────────────────────────────────────────────────
        if (!issueText || typeof issueText !== 'string' || issueText.trim().length < 3) {
            // No text to analyze - need clarification
            resolution.state = RESOLUTION_STATES.CLARIFYING;
            resolution.canonicalType = 'service'; // Tentative
            resolution.clarifierType = 'genericServiceType';
            resolution.clarifierAsked = true;
            
            logger.info('[SERVICE TYPE RESOLVER] No issue text, asking generic clarifier');
            
            return {
                resolved: false,
                canonicalType: 'service',
                needsClarification: true,
                clarifierQuestion: CLARIFIERS.genericServiceType.question,
                clarifierType: 'genericServiceType',
                reason: 'no_issue_text'
            };
        }
        
        const normalizedText = issueText.toLowerCase().trim();
        const scores = this._scoreAllTypes(normalizedText, options.companyKeywords);
        
        resolution.scores = scores;
        
        // Find top scores
        const sorted = Object.entries(scores)
            .filter(([_, score]) => score > 0)
            .sort((a, b) => b[1] - a[1]);
        
        logger.debug('[SERVICE TYPE RESOLVER] Scores calculated', {
            text: normalizedText.substring(0, 80),
            topScores: sorted.slice(0, 3)
        });
        
        // ─────────────────────────────────────────────────────────────────────
        // No matches → need clarification
        // ─────────────────────────────────────────────────────────────────────
        if (sorted.length === 0) {
            resolution.state = RESOLUTION_STATES.CLARIFYING;
            resolution.canonicalType = 'service';
            resolution.confidence = 'none';
            resolution.confidenceScore = 0;
            resolution.clarifierType = 'genericServiceType';
            resolution.clarifierAsked = true;
            
            return {
                resolved: false,
                canonicalType: 'service',
                needsClarification: true,
                clarifierQuestion: CLARIFIERS.genericServiceType.question,
                clarifierType: 'genericServiceType',
                reason: 'no_keyword_matches'
            };
        }
        
        const [topType, topScore] = sorted[0];
        const [secondType, secondScore] = sorted[1] || [null, 0];
        
        // ─────────────────────────────────────────────────────────────────────
        // HIGH CONFIDENCE → Resolve immediately
        // ─────────────────────────────────────────────────────────────────────
        if (topScore >= CONFIDENCE.HIGH_THRESHOLD) {
            resolution.state = RESOLUTION_STATES.RESOLVED;
            resolution.canonicalType = topType;
            resolution.confidence = 'high';
            resolution.confidenceScore = topScore;
            resolution.method = 'auto_high';
            resolution.resolvedAt = new Date().toISOString();
            
            this._syncLegacyFields(session, topType);
            
            logger.info('[SERVICE TYPE RESOLVER] Resolved (high confidence)', {
                canonicalType: topType,
                score: topScore
            });
            
            return {
                resolved: true,
                canonicalType: topType,
                needsClarification: false,
                confidence: 'high',
                method: 'auto_high'
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // TIE → Need clarification
        // ─────────────────────────────────────────────────────────────────────
        if (secondScore > 0 && (topScore - secondScore) <= CONFIDENCE.TIE_MARGIN) {
            const clarifier = this._getClarifierForTie(topType, secondType);
            
            resolution.state = RESOLUTION_STATES.CLARIFYING;
            resolution.canonicalType = topType; // Tentative
            resolution.confidence = 'tie';
            resolution.confidenceScore = topScore;
            resolution.clarifierType = clarifier.type;
            resolution.clarifierAsked = true;
            resolution.tiedWith = secondType;
            
            logger.info('[SERVICE TYPE RESOLVER] Tie detected, asking clarifier', {
                topType,
                secondType,
                clarifierType: clarifier.type
            });
            
            return {
                resolved: false,
                canonicalType: topType, // Tentative
                needsClarification: true,
                clarifierQuestion: clarifier.question,
                clarifierType: clarifier.type,
                tiedWith: secondType,
                reason: 'tie'
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // MEDIUM CONFIDENCE → Accept if clear lead
        // ─────────────────────────────────────────────────────────────────────
        if (topScore >= CONFIDENCE.MEDIUM_THRESHOLD) {
            resolution.state = RESOLUTION_STATES.RESOLVED;
            resolution.canonicalType = topType;
            resolution.confidence = 'medium';
            resolution.confidenceScore = topScore;
            resolution.method = 'auto_medium';
            resolution.resolvedAt = new Date().toISOString();
            
            this._syncLegacyFields(session, topType);
            
            logger.info('[SERVICE TYPE RESOLVER] Resolved (medium confidence)', {
                canonicalType: topType,
                score: topScore
            });
            
            return {
                resolved: true,
                canonicalType: topType,
                needsClarification: false,
                confidence: 'medium',
                method: 'auto_medium'
            };
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // LOW CONFIDENCE → Need clarification
        // ─────────────────────────────────────────────────────────────────────
        const clarifier = this._getClarifierForLowConfidence(topType);
        
        resolution.state = RESOLUTION_STATES.CLARIFYING;
        resolution.canonicalType = topType; // Tentative
        resolution.confidence = 'low';
        resolution.confidenceScore = topScore;
        resolution.clarifierType = clarifier.type;
        resolution.clarifierAsked = true;
        
        logger.info('[SERVICE TYPE RESOLVER] Low confidence, asking clarifier', {
            tentativeType: topType,
            score: topScore,
            clarifierType: clarifier.type
        });
        
        return {
            resolved: false,
            canonicalType: topType, // Tentative
            needsClarification: true,
            clarifierQuestion: clarifier.question,
            clarifierType: clarifier.type,
            reason: 'low_confidence'
        };
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════════
     * APPLY CLARIFICATION
     * Called when caller responds to clarifier question
     * ════════════════════════════════════════════════════════════════════════════
     * 
     * @param {Object} session - The call session
     * @param {string} response - Caller's response to clarifier
     * @returns {Object} Updated resolution
     */
    static applyClarification(session, response) {
        const resolution = this.getResolution(session);
        
        if (resolution.state !== RESOLUTION_STATES.CLARIFYING) {
            logger.warn('[SERVICE TYPE RESOLVER] applyClarification called but not in CLARIFYING state', {
                currentState: resolution.state
            });
            return {
                resolved: this.isResolved(session),
                canonicalType: resolution.canonicalType,
                unchanged: true
            };
        }
        
        const clarifier = CLARIFIERS[resolution.clarifierType];
        if (!clarifier) {
            // Unknown clarifier - fall back to tentative type
            resolution.state = RESOLUTION_STATES.CONFIRMED;
            resolution.method = 'clarified_fallback';
            resolution.resolvedAt = new Date().toISOString();
            
            this._syncLegacyFields(session, resolution.canonicalType);
            
            return {
                resolved: true,
                canonicalType: resolution.canonicalType,
                method: 'clarified_fallback'
            };
        }
        
        resolution.clarifierResponse = response;
        
        // Parse the response
        const normalizedResponse = (response || '').toLowerCase().trim();
        let bestMatch = null;
        let bestScore = 0;
        
        for (const [type, keywords] of Object.entries(clarifier.options)) {
            let score = 0;
            for (const kw of keywords) {
                if (normalizedResponse.includes(kw)) {
                    score += 2;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                bestMatch = type;
            }
        }
        
        if (bestMatch && bestScore >= 2) {
            // Handle special case for emergencyVsRegular where 'regular' maps to fallback
            let resolvedType = bestMatch;
            if (bestMatch === 'regular' && clarifier.regularFallback) {
                resolvedType = resolution.canonicalType !== 'service' 
                    ? resolution.canonicalType 
                    : clarifier.regularFallback;
            }
            
            resolution.state = RESOLUTION_STATES.CONFIRMED;
            resolution.canonicalType = resolvedType;
            resolution.confidence = 'clarified';
            resolution.method = 'clarified';
            resolution.resolvedAt = new Date().toISOString();
            
            this._syncLegacyFields(session, resolvedType);
            
            logger.info('[SERVICE TYPE RESOLVER] Clarification applied', {
                response: normalizedResponse.substring(0, 50),
                matched: bestMatch,
                resolvedType
            });
            
            return {
                resolved: true,
                canonicalType: resolvedType,
                method: 'clarified',
                matchedOption: bestMatch
            };
        }
        
        // Couldn't parse - use tentative type
        resolution.state = RESOLUTION_STATES.CONFIRMED;
        resolution.method = 'clarified_unclear';
        resolution.resolvedAt = new Date().toISOString();
        
        this._syncLegacyFields(session, resolution.canonicalType);
        
        logger.warn('[SERVICE TYPE RESOLVER] Could not parse clarification, using tentative', {
            response: normalizedResponse.substring(0, 50),
            tentativeType: resolution.canonicalType
        });
        
        return {
            resolved: true,
            canonicalType: resolution.canonicalType,
            method: 'clarified_unclear'
        };
    }
    
    /**
     * Lock the resolution (prevent any further changes)
     * Call this when booking is confirmed
     */
    static lock(session) {
        const resolution = this.getResolution(session);
        
        if (resolution.state !== RESOLUTION_STATES.LOCKED) {
            resolution.state = RESOLUTION_STATES.LOCKED;
            resolution.lockedAt = new Date().toISOString();
            
            // Ensure we have a canonical type
            if (!resolution.canonicalType) {
                resolution.canonicalType = 'service';
            }
            
            this._syncLegacyFields(session, resolution.canonicalType);
            
            logger.info('[SERVICE TYPE RESOLVER] Resolution locked', {
                canonicalType: resolution.canonicalType,
                method: resolution.method
            });
        }
        
        return resolution;
    }
    
    /**
     * Set service type explicitly (e.g., from booking prompt slot)
     */
    static setExplicit(session, serviceType) {
        const resolution = this.getResolution(session);
        
        if (resolution.state === RESOLUTION_STATES.LOCKED) {
            logger.warn('[SERVICE TYPE RESOLVER] Cannot set explicit - already locked');
            return false;
        }
        
        const normalized = this.normalizeType(serviceType);
        
        resolution.state = RESOLUTION_STATES.CONFIRMED;
        resolution.canonicalType = normalized;
        resolution.confidence = 'explicit';
        resolution.confidenceScore = 10;
        resolution.method = 'explicit_set';
        resolution.resolvedAt = new Date().toISOString();
        
        this._syncLegacyFields(session, normalized);
        
        logger.info('[SERVICE TYPE RESOLVER] Explicit type set', {
            canonicalType: normalized,
            original: serviceType
        });
        
        return true;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Normalize any service type variant to canonical key
     */
    static normalizeType(serviceType) {
        if (!serviceType) return 'service';
        
        const normalized = serviceType.toLowerCase().trim();
        
        if (CANONICAL_SERVICE_TYPES.includes(normalized)) {
            return normalized;
        }
        
        // Handle variants with suffixes/prefixes
        for (const canonical of CANONICAL_SERVICE_TYPES) {
            if (normalized.startsWith(canonical + '_') ||
                normalized.startsWith(canonical + '-') ||
                normalized.endsWith('_' + canonical) ||
                normalized.endsWith('-' + canonical) ||
                normalized.includes(canonical)) {
                return canonical;
            }
        }
        
        return 'service';
    }
    
    /**
     * Score text against all service types
     */
    static _scoreAllTypes(text, companyKeywords = null) {
        const scores = {};
        const keywordMap = companyKeywords || SERVICE_TYPE_KEYWORDS;
        
        for (const [type, keywords] of Object.entries(keywordMap)) {
            scores[type] = this._scoreText(text, keywords);
        }
        
        return scores;
    }
    
    /**
     * Score text against a keyword set
     */
    static _scoreText(text, keywords) {
        let score = 0;
        
        if (keywords.high) {
            for (const kw of keywords.high) {
                if (text.includes(kw)) score += 3;
            }
        }
        
        if (keywords.medium) {
            for (const kw of keywords.medium) {
                if (text.includes(kw)) score += 2;
            }
        }
        
        if (keywords.low) {
            for (const kw of keywords.low) {
                if (text.includes(kw)) score += 1;
            }
        }
        
        return score;
    }
    
    /**
     * Get clarifier for tie situation
     */
    static _getClarifierForTie(type1, type2) {
        const types = [type1, type2].sort();
        
        if (types.includes('emergency')) {
            return {
                type: 'emergencyVsRegular',
                question: CLARIFIERS.emergencyVsRegular.question
            };
        }
        
        if (types.includes('repair') && types.includes('maintenance')) {
            return {
                type: 'repairVsMaintenance',
                question: CLARIFIERS.repairVsMaintenance.question
            };
        }
        
        return {
            type: 'genericServiceType',
            question: CLARIFIERS.genericServiceType.question
        };
    }
    
    /**
     * Get clarifier for low confidence
     */
    static _getClarifierForLowConfidence(tentativeType) {
        if (tentativeType === 'emergency') {
            return {
                type: 'emergencyVsRegular',
                question: CLARIFIERS.emergencyVsRegular.question
            };
        }
        
        if (tentativeType === 'repair' || tentativeType === 'maintenance') {
            return {
                type: 'repairVsMaintenance',
                question: CLARIFIERS.repairVsMaintenance.question
            };
        }
        
        return {
            type: 'genericServiceType',
            question: CLARIFIERS.genericServiceType.question
        };
    }
    
    /**
     * Sync legacy fields for backward compatibility
     * These are NOT the source of truth - just kept in sync
     */
    static _syncLegacyFields(session, serviceType) {
        // Sync to booking
        if (session.booking) {
            session.booking.serviceType = serviceType;
        }
        
        // Sync to discovery
        if (session.discovery) {
            session.discovery.serviceType = serviceType;
        }
    }
    
    /**
     * Get analytics-friendly summary of resolution
     */
    static getResolutionSummary(session) {
        const resolution = this.getResolution(session);
        
        return {
            canonicalType: resolution.canonicalType,
            state: resolution.state,
            confidence: resolution.confidence,
            method: resolution.method,
            clarifierAsked: resolution.clarifierAsked,
            clarifierType: resolution.clarifierType,
            resolvedAt: resolution.resolvedAt
        };
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = ServiceTypeResolver;
module.exports.CANONICAL_SERVICE_TYPES = CANONICAL_SERVICE_TYPES;
module.exports.CORE_SERVICE_TYPES = CORE_SERVICE_TYPES;
module.exports.OPTIONAL_SERVICE_TYPES = OPTIONAL_SERVICE_TYPES;
module.exports.FALLBACK_SERVICE_TYPE = FALLBACK_SERVICE_TYPE;
module.exports.CANONICAL_TYPE_PATH = CANONICAL_TYPE_PATH;
module.exports.CANONICAL_TYPE_ACCESSOR = CANONICAL_TYPE_ACCESSOR;
module.exports.RESOLUTION_STATES = RESOLUTION_STATES;
module.exports.SERVICE_TYPE_KEYWORDS = SERVICE_TYPE_KEYWORDS;
module.exports.CLARIFIERS = CLARIFIERS;

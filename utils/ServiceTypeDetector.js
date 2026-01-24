/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SERVICE TYPE DETECTOR - Hybrid Auto-Detection with Confidence Scoring
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Determine the correct service type (tag) for calendar events and
 * booking flow branching. Uses keyword scoring with confidence thresholds.
 * 
 * STRATEGY:
 * 1. Auto-detect from issue text (fast, no LLM)
 * 2. Score confidence based on keyword hits
 * 3. If high confidence → accept silently
 * 4. If low confidence or tie → return clarifier question
 * 5. Store: serviceType, confidence, detectionMethod
 * 
 * CANONICAL SERVICE TYPES:
 * - emergency    → Same-day/urgent (30 min lead time)
 * - repair       → Equipment broken/not working (1 hr lead time)
 * - maintenance  → Tune-ups, seasonal (7 day advance)
 * - estimate     → Quotes, pricing (1 day advance)
 * - installation → New equipment (3 day advance)
 * - inspection   → System checks (1 day advance)
 * - consultation → General questions (same day OK)
 * - service      → Generic fallback
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// ════════════════════════════════════════════════════════════════════════════════
// KEYWORD SCORING MAP
// Each keyword has a score. Higher = more confident match.
// Keywords are lowercase and matched against lowercased input.
// ════════════════════════════════════════════════════════════════════════════════

const SERVICE_TYPE_KEYWORDS = {
    emergency: {
        // Score 3 = very strong signal
        high: [
            'emergency', 'urgent', 'asap', 'immediately', 'right now',
            'flooding', 'flooded', 'water everywhere', 'gas leak', 'gas smell',
            'no heat', 'no cooling', 'no ac', 'no air', 'freezing', 'dangerous',
            'smoke', 'fire', 'sparking', 'electrical smell', 'burning smell'
        ],
        // Score 2 = moderate signal
        medium: [
            'today', 'same day', 'cant wait', "can't wait", 'need someone now',
            'its bad', "it's bad", 'really bad', 'getting worse', 'urgent repair'
        ],
        // Score 1 = weak signal (needs more context)
        low: [
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

// Thresholds for confidence decisions
const CONFIDENCE_THRESHOLDS = {
    HIGH: 4,      // Accept without asking (clear winner)
    MEDIUM: 2,    // Accept if no close competitor
    TIE_MARGIN: 1 // If top two are within this, it's a tie → ask
};

// ════════════════════════════════════════════════════════════════════════════════
// CLARIFIER QUESTIONS
// These are the 1-2 questions asked when detection is uncertain
// ════════════════════════════════════════════════════════════════════════════════

const CLARIFIER_QUESTIONS = {
    // Emergency vs Non-Emergency (most important distinction)
    emergencyVsRegular: {
        question: "Is this something that needs attention right away today, or can we schedule the next available appointment?",
        options: {
            emergency: ['right away', 'today', 'now', 'urgent', 'emergency', 'asap', 'immediately'],
            regular: ['next available', 'schedule', 'whenever', 'not urgent', 'can wait', 'appointment']
        }
    },
    
    // Repair vs Maintenance (common confusion)
    repairVsMaintenance: {
        question: "Is something not working right, or is this for routine maintenance?",
        options: {
            repair: ['not working', 'broken', 'fix', 'repair', 'problem', 'issue', 'wrong'],
            maintenance: ['maintenance', 'routine', 'tune up', 'checkup', 'preventive', 'cleaning']
        }
    },
    
    // Generic service type question (last resort)
    genericServiceType: {
        question: "Just so I schedule the right appointment — is this for a repair, routine maintenance, or something else like an estimate or installation?",
        options: {
            repair: ['repair', 'fix', 'broken'],
            maintenance: ['maintenance', 'routine', 'tune up', 'checkup'],
            estimate: ['estimate', 'quote', 'price', 'cost'],
            installation: ['install', 'new', 'replacement']
        }
    }
};

// ════════════════════════════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Detect service type from issue text with confidence scoring
 * 
 * @param {string} issueText - The caller's issue/problem description
 * @param {Object} options - Optional configuration
 * @param {Object} options.companyConfig - Company-specific keyword overrides
 * @param {string} options.existingServiceType - Previously detected type (skip if already set)
 * @returns {Object} Detection result
 */
function detectServiceType(issueText, options = {}) {
    const { companyConfig, existingServiceType } = options;
    
    // If already explicitly set, don't re-detect
    if (existingServiceType && existingServiceType !== 'service') {
        return {
            serviceType: existingServiceType,
            confidence: 'explicit',
            confidenceScore: 10,
            detectionMethod: 'explicit',
            needsClarification: false,
            clarifierQuestion: null
        };
    }
    
    if (!issueText || typeof issueText !== 'string') {
        return {
            serviceType: 'service',
            confidence: 'none',
            confidenceScore: 0,
            detectionMethod: 'default',
            needsClarification: true,
            clarifierQuestion: CLARIFIER_QUESTIONS.genericServiceType.question,
            clarifierType: 'genericServiceType'
        };
    }
    
    const normalizedText = issueText.toLowerCase().trim();
    
    // Score each service type
    const scores = {};
    const keywordMap = companyConfig?.serviceTypeClarification?.serviceTypes 
        ? buildCompanyKeywordMap(companyConfig.serviceTypeClarification.serviceTypes)
        : SERVICE_TYPE_KEYWORDS;
    
    for (const [serviceType, keywords] of Object.entries(keywordMap)) {
        scores[serviceType] = scoreText(normalizedText, keywords);
    }
    
    // Find top scores
    const sorted = Object.entries(scores)
        .filter(([_, score]) => score > 0)
        .sort((a, b) => b[1] - a[1]);
    
    logger.debug('[SERVICE TYPE DETECTOR] Scores calculated', {
        text: normalizedText.substring(0, 100),
        scores,
        sorted: sorted.slice(0, 3)
    });
    
    // No matches at all
    if (sorted.length === 0) {
        return {
            serviceType: 'service',
            confidence: 'none',
            confidenceScore: 0,
            detectionMethod: 'default',
            needsClarification: true,
            clarifierQuestion: CLARIFIER_QUESTIONS.genericServiceType.question,
            clarifierType: 'genericServiceType',
            scores
        };
    }
    
    const [topType, topScore] = sorted[0];
    const [secondType, secondScore] = sorted[1] || [null, 0];
    
    // HIGH CONFIDENCE: Clear winner with strong score
    if (topScore >= CONFIDENCE_THRESHOLDS.HIGH) {
        return {
            serviceType: topType,
            confidence: 'high',
            confidenceScore: topScore,
            detectionMethod: 'auto_high',
            needsClarification: false,
            clarifierQuestion: null,
            scores
        };
    }
    
    // TIE: Top two are too close
    if (secondScore > 0 && (topScore - secondScore) <= CONFIDENCE_THRESHOLDS.TIE_MARGIN) {
        const clarifier = getClarifierForTie(topType, secondType);
        return {
            serviceType: topType, // Tentative
            confidence: 'tie',
            confidenceScore: topScore,
            detectionMethod: 'auto_tie',
            needsClarification: true,
            clarifierQuestion: clarifier.question,
            clarifierType: clarifier.type,
            tiedWith: secondType,
            scores
        };
    }
    
    // MEDIUM CONFIDENCE: Clear winner but score not super high
    if (topScore >= CONFIDENCE_THRESHOLDS.MEDIUM) {
        return {
            serviceType: topType,
            confidence: 'medium',
            confidenceScore: topScore,
            detectionMethod: 'auto_medium',
            needsClarification: false,
            clarifierQuestion: null,
            scores
        };
    }
    
    // LOW CONFIDENCE: Some signal but not enough
    const clarifier = getClarifierForLowConfidence(topType);
    return {
        serviceType: topType, // Tentative
        confidence: 'low',
        confidenceScore: topScore,
        detectionMethod: 'auto_low',
        needsClarification: true,
        clarifierQuestion: clarifier.question,
        clarifierType: clarifier.type,
        scores
    };
}

/**
 * Score text against a keyword set
 */
function scoreText(text, keywords) {
    let score = 0;
    
    // High-value keywords (3 points each)
    if (keywords.high) {
        for (const kw of keywords.high) {
            if (text.includes(kw)) {
                score += 3;
            }
        }
    }
    
    // Medium-value keywords (2 points each)
    if (keywords.medium) {
        for (const kw of keywords.medium) {
            if (text.includes(kw)) {
                score += 2;
            }
        }
    }
    
    // Low-value keywords (1 point each)
    if (keywords.low) {
        for (const kw of keywords.low) {
            if (text.includes(kw)) {
                score += 1;
            }
        }
    }
    
    return score;
}

/**
 * Get the right clarifier question for a tie situation
 */
function getClarifierForTie(type1, type2) {
    const types = [type1, type2].sort();
    
    // Emergency vs anything → ask emergency question
    if (types.includes('emergency')) {
        return {
            type: 'emergencyVsRegular',
            question: CLARIFIER_QUESTIONS.emergencyVsRegular.question
        };
    }
    
    // Repair vs Maintenance → specific question
    if (types.includes('repair') && types.includes('maintenance')) {
        return {
            type: 'repairVsMaintenance',
            question: CLARIFIER_QUESTIONS.repairVsMaintenance.question
        };
    }
    
    // Default to generic
    return {
        type: 'genericServiceType',
        question: CLARIFIER_QUESTIONS.genericServiceType.question
    };
}

/**
 * Get clarifier for low confidence situations
 */
function getClarifierForLowConfidence(tentativeType) {
    // If we think it might be emergency, confirm
    if (tentativeType === 'emergency') {
        return {
            type: 'emergencyVsRegular',
            question: CLARIFIER_QUESTIONS.emergencyVsRegular.question
        };
    }
    
    // Repair/maintenance are common confusions
    if (tentativeType === 'repair' || tentativeType === 'maintenance') {
        return {
            type: 'repairVsMaintenance',
            question: CLARIFIER_QUESTIONS.repairVsMaintenance.question
        };
    }
    
    return {
        type: 'genericServiceType',
        question: CLARIFIER_QUESTIONS.genericServiceType.question
    };
}

/**
 * Build keyword map from company configuration
 */
function buildCompanyKeywordMap(companyServiceTypes) {
    const map = {};
    
    for (const st of companyServiceTypes) {
        if (!st.enabled || !st.key) continue;
        
        map[st.key] = {
            high: st.keywords || [],
            medium: [],
            low: []
        };
    }
    
    // Merge with defaults (company keywords are high-priority additions)
    for (const [key, keywords] of Object.entries(SERVICE_TYPE_KEYWORDS)) {
        if (!map[key]) {
            map[key] = keywords;
        } else {
            // Add default keywords as medium priority
            map[key].medium = [...(map[key].medium || []), ...(keywords.high || [])];
            map[key].low = [...(map[key].low || []), ...(keywords.medium || []), ...(keywords.low || [])];
        }
    }
    
    return map;
}

// ════════════════════════════════════════════════════════════════════════════════
// CLARIFIER RESPONSE PARSER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Parse caller's response to clarifier question
 * 
 * @param {string} response - Caller's response text
 * @param {string} clarifierType - Which clarifier was asked
 * @returns {Object} Parsed result with resolved serviceType
 */
function parseClarifierResponse(response, clarifierType) {
    const clarifier = CLARIFIER_QUESTIONS[clarifierType];
    if (!clarifier) {
        return { serviceType: 'service', confidence: 'fallback' };
    }
    
    const normalizedResponse = (response || '').toLowerCase().trim();
    
    // Score each option
    let bestMatch = null;
    let bestScore = 0;
    
    for (const [serviceType, keywords] of Object.entries(clarifier.options)) {
        let score = 0;
        for (const kw of keywords) {
            if (normalizedResponse.includes(kw)) {
                score += 2;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = serviceType;
        }
    }
    
    if (bestMatch && bestScore >= 2) {
        return {
            serviceType: bestMatch,
            confidence: 'clarified',
            confidenceScore: bestScore,
            detectionMethod: 'clarified'
        };
    }
    
    // Couldn't parse - return tentative or default
    return {
        serviceType: 'service',
        confidence: 'unclear',
        confidenceScore: 0,
        detectionMethod: 'clarified_unclear'
    };
}

// ════════════════════════════════════════════════════════════════════════════════
// NORMALIZATION HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Normalize any service type variant to canonical key
 * Handles: "repair_service" → "repair", "EMERGENCY" → "emergency", etc.
 */
function normalizeServiceType(serviceType) {
    if (!serviceType) return 'service';
    
    const normalized = serviceType.toLowerCase().trim();
    
    // Direct canonical types
    const canonicalTypes = [
        'emergency', 'repair', 'maintenance', 'estimate',
        'installation', 'inspection', 'consultation', 'service', 'sales', 'other'
    ];
    
    if (canonicalTypes.includes(normalized)) {
        return normalized;
    }
    
    // Handle variants with suffixes/prefixes
    for (const canonical of canonicalTypes) {
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

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
    detectServiceType,
    parseClarifierResponse,
    normalizeServiceType,
    SERVICE_TYPE_KEYWORDS,
    CLARIFIER_QUESTIONS,
    CONFIDENCE_THRESHOLDS
};

/**
 * ============================================================================
 * LLM-0 CONTRACTS - HARD I/O SPECIFICATION
 * ============================================================================
 * 
 * BRAIN 1: FRONTLINE-INTEL / LLM-0
 * 
 * This file defines the EXACT input and output shapes for LLM-0.
 * All code interfacing with LLM-0 MUST conform to these contracts.
 * 
 * ARCHITECTURE:
 *   Caller → Brain 1 (LLM-0) → Triage Cards → Brain 2 (3-Tier Scenario Engine)
 * 
 * LLM-0 is the receptionist brain. It:
 * - Understands caller intent
 * - Decides ACTIONS (ask, answer, book, transfer, etc.)
 * - Extracts structured data (contact, location, problem)
 * - Provides hints to downstream systems (Triage, 3-Tier)
 * 
 * ============================================================================
 */

// ============================================================================
// LLM-0 INPUT CONTRACT
// ============================================================================

/**
 * @typedef {Object} LLM0Input
 * @property {string} companyId              - Company identifier
 * @property {string} callId                 - Twilio Call SID
 * @property {string} userInput              - Raw transcribed text from STT
 * @property {Object} callState              - Internal state snapshot
 * @property {string} [callState.stage]      - Current call stage
 * @property {number} [callState.turnCount]  - Number of turns so far
 * @property {Object} [callState.collected]  - Previously collected entities
 * @property {Array<TurnHistoryEntry>} turnHistory - Previous turns (if any)
 */

/**
 * @typedef {Object} TurnHistoryEntry
 * @property {number} turnNumber             - Turn index (1-based)
 * @property {'caller'|'agent'} speaker      - Who spoke
 * @property {string} text                   - What was said
 * @property {number} timestamp              - Unix timestamp (ms)
 */

// ============================================================================
// LLM-0 OUTPUT CONTRACT
// ============================================================================

/**
 * LLM-0 Action Codes
 * These are the ONLY valid actions LLM-0 can return.
 * 
 * @typedef {'RUN_SCENARIO'|'BOOK_APPOINTMENT'|'TRANSFER_CALL'|'ASK_QUESTION'|'MESSAGE_ONLY'|'END_CALL'|'UNKNOWN'} LLM0Action
 */

/**
 * @typedef {Object} LLM0Decision
 * @property {LLM0Action} action             - What to do next
 * @property {string|null} nextPrompt        - What to say back to caller (if any)
 * @property {string} intentTag              - Detected intent (e.g. 'smell_of_gas', 'no_cool', 'maintenance', 'billing_question')
 * @property {LLM0Entities} entities         - Extracted structured data
 * @property {LLM0Flags} flags               - Decision flags for downstream routing
 * @property {LLM0ScenarioHints} scenarioHints - Hints for 3-Tier scenario matching
 * @property {LLM0Debug} debug               - Internal reasoning and diagnostics
 */

/**
 * @typedef {Object} LLM0Entities
 * @property {Object|null} contact           - Caller contact info
 * @property {string} [contact.name]         - Caller name
 * @property {string} [contact.phone]        - Caller phone
 * @property {string} [contact.email]        - Caller email
 * @property {Object|null} location          - Service location
 * @property {string} [location.addressLine1] - Street address
 * @property {string} [location.city]        - City
 * @property {string} [location.state]       - State
 * @property {string} [location.zip]         - ZIP code
 * @property {Object|null} problem           - Problem description
 * @property {string} [problem.summary]      - Brief problem summary
 * @property {string} [problem.category]     - Problem category (e.g. 'cooling', 'heating', 'plumbing')
 * @property {'normal'|'urgent'|'emergency'} [problem.urgency] - Urgency level
 * @property {Object|null} scheduling        - Scheduling preferences
 * @property {string} [scheduling.preferredDate] - Preferred date
 * @property {string} [scheduling.preferredWindow] - Preferred time window
 */

/**
 * @typedef {Object} LLM0Flags
 * @property {boolean} needsScenario         - Should route to 3-Tier scenario engine
 * @property {boolean} needsBooking          - Ready to initiate booking
 * @property {boolean} needsTransfer         - Should transfer to human
 * @property {boolean} isEmergency           - Emergency detected
 * @property {boolean} isFrustrated          - Caller frustration detected
 * @property {boolean} isSpam                - Spam/robo call detected
 * @property {boolean} isWrongNumber         - Wrong number detected
 */

/**
 * @typedef {Object} LLM0ScenarioHints
 * @property {string|null} categoryKey       - Suggested scenario category
 * @property {string|null} scenarioKey       - Suggested specific scenario
 * @property {number} confidence             - LLM-0's confidence in the hint (0-1)
 */

/**
 * @typedef {Object} LLM0Debug
 * @property {string} reasoning              - LLM-0's internal reasoning
 * @property {Object|null} emotion           - Emotion detection result
 * @property {string} [emotion.primary]      - Primary emotion detected
 * @property {number} [emotion.intensity]    - Emotion intensity (0-1)
 * @property {Object} preprocessing          - Preprocessing stats
 * @property {string} preprocessing.originalInput - Original input
 * @property {string} preprocessing.cleanedInput  - After filler stripping
 * @property {number} preprocessing.tokensRemoved - Tokens stripped
 * @property {Object} performance            - Performance metrics
 * @property {number} performance.preprocessingMs - Preprocessing time
 * @property {number} performance.llmCallMs  - LLM call time
 * @property {number} performance.totalMs    - Total processing time
 * @property {number} performance.cost       - Estimated cost in USD
 * @property {Array<string>} triageNotes     - Notes for triage routing
 */

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

const VALID_ACTIONS = [
    'RUN_SCENARIO',
    'BOOK_APPOINTMENT', 
    'TRANSFER_CALL',
    'ASK_QUESTION',
    'MESSAGE_ONLY',
    'END_CALL',
    'UNKNOWN'
];

/**
 * Validate that an action is a valid LLM-0 action code
 * @param {string} action 
 * @returns {boolean}
 */
function isValidAction(action) {
    return VALID_ACTIONS.includes(action);
}

/**
 * Create an empty/default LLM0Decision object
 * @returns {LLM0Decision}
 */
function createEmptyDecision() {
    return {
        action: 'UNKNOWN',
        nextPrompt: null,
        intentTag: 'unknown',
        entities: {
            contact: null,
            location: null,
            problem: null,
            scheduling: null
        },
        flags: {
            needsScenario: false,
            needsBooking: false,
            needsTransfer: false,
            isEmergency: false,
            isFrustrated: false,
            isSpam: false,
            isWrongNumber: false
        },
        scenarioHints: {
            categoryKey: null,
            scenarioKey: null,
            confidence: 0
        },
        debug: {
            reasoning: '',
            emotion: null,
            preprocessing: {
                originalInput: '',
                cleanedInput: '',
                tokensRemoved: 0
            },
            performance: {
                preprocessingMs: 0,
                llmCallMs: 0,
                totalMs: 0,
                cost: 0
            },
            triageNotes: []
        }
    };
}

/**
 * Validate and normalize an LLM0Decision
 * Ensures all required fields exist and action is valid
 * @param {Object} decision - Raw decision from LLM
 * @returns {LLM0Decision}
 */
function normalizeDecision(decision) {
    const normalized = createEmptyDecision();
    
    // Action (required, must be valid)
    if (decision.action && isValidAction(decision.action)) {
        normalized.action = decision.action;
    } else if (decision.action) {
        // Try to map common variations
        const actionMap = {
            'ask_question': 'ASK_QUESTION',
            'answer_with_knowledge': 'RUN_SCENARIO',
            'initiate_booking': 'BOOK_APPOINTMENT',
            'escalate_to_human': 'TRANSFER_CALL',
            'close_call': 'END_CALL',
            'small_talk': 'MESSAGE_ONLY',
            'no_op': 'MESSAGE_ONLY'
        };
        normalized.action = actionMap[decision.action] || 'UNKNOWN';
    }
    
    // NextPrompt
    normalized.nextPrompt = decision.nextPrompt || null;
    
    // IntentTag
    normalized.intentTag = decision.intentTag || 
                          decision.updatedIntent || 
                          decision.detectedIntent ||
                          'unknown';
    
    // Entities (deep merge with defaults)
    if (decision.entities || decision.updates?.extracted) {
        const src = decision.entities || decision.updates?.extracted || {};
        normalized.entities = {
            contact: src.contact || null,
            location: src.location || null,
            problem: src.problem || null,
            scheduling: src.scheduling || null
        };
    }
    
    // Flags
    if (decision.flags || decision.updates?.flags) {
        const src = decision.flags || decision.updates?.flags || {};
        normalized.flags = {
            needsScenario: src.needsScenario || src.needsKnowledgeSearch || false,
            needsBooking: src.needsBooking || src.readyToBook || false,
            needsTransfer: src.needsTransfer || src.wantsHuman || false,
            isEmergency: src.isEmergency || src.emergency || false,
            isFrustrated: src.isFrustrated || false,
            isSpam: src.isSpam || false,
            isWrongNumber: src.isWrongNumber || false
        };
    }
    
    // ScenarioHints
    if (decision.scenarioHints || decision.knowledgeQuery) {
        const src = decision.scenarioHints || {};
        normalized.scenarioHints = {
            categoryKey: src.categoryKey || decision.knowledgeQuery?.type || null,
            scenarioKey: src.scenarioKey || null,
            confidence: src.confidence || 0
        };
    }
    
    // Debug
    if (decision.debug || decision.debugNotes) {
        normalized.debug.reasoning = decision.debug?.reasoning || 
                                    decision.debugNotes || 
                                    '';
        normalized.debug.emotion = decision.debug?.emotion || null;
        normalized.debug.preprocessing = decision.debug?.preprocessing || normalized.debug.preprocessing;
        normalized.debug.performance = decision.debug?.performance || normalized.debug.performance;
        normalized.debug.triageNotes = decision.debug?.triageNotes || [];
    }
    
    return normalized;
}

/**
 * Derive action from flags if action is UNKNOWN
 * @param {LLM0Decision} decision 
 * @returns {LLM0Action}
 */
function deriveActionFromFlags(decision) {
    if (decision.action !== 'UNKNOWN') {
        return decision.action;
    }
    
    const { flags } = decision;
    
    if (flags.isSpam || flags.isWrongNumber) {
        return 'END_CALL';
    }
    if (flags.needsTransfer || flags.isEmergency) {
        return 'TRANSFER_CALL';
    }
    if (flags.needsBooking) {
        return 'BOOK_APPOINTMENT';
    }
    if (flags.needsScenario) {
        return 'RUN_SCENARIO';
    }
    if (decision.nextPrompt) {
        return 'ASK_QUESTION';
    }
    
    return 'UNKNOWN';
}

module.exports = {
    VALID_ACTIONS,
    isValidAction,
    createEmptyDecision,
    normalizeDecision,
    deriveActionFromFlags
};


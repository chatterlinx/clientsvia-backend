/**
 * ConsentGate
 * 
 * V111 ENHANCED: Full wiring from frontDeskBehavior.detectionTriggers and discoveryConsent
 * 
 * PURPOSE:
 * - Detect booking intent ("I want to schedule service")
 * - Manage explicit consent flow when needed
 * - Bypass consent for direct intent patterns
 * - Emit comprehensive raw events for every decision
 * 
 * CONFIG PATHS WIRED:
 * - frontDeskBehavior.detectionTriggers.wantsBooking (array of phrases)
 * - frontDeskBehavior.detectionTriggers.directIntentPatterns (array of regex patterns)
 * - frontDeskBehavior.discoveryConsent.enabled
 * - frontDeskBehavior.discoveryConsent.consentYesWords
 * - frontDeskBehavior.discoveryConsent.consentNoWords
 * - frontDeskBehavior.discoveryConsent.consentQuestion
 * - frontDeskBehavior.discoveryConsent.implicitConsentPatterns
 * 
 * RAW EVENTS EMITTED:
 * - CONSENT_GATE_INTENT_DETECTION: Every intent check (found or not)
 * - CONSENT_GATE_DIRECT_INTENT_BYPASS: When consent is bypassed due to explicit intent
 * - CONSENT_GATE_ASK: When explicit consent question is asked
 * - CONSENT_GATE_EVALUATE: When evaluating user response to consent question
 */

const logger = require('../../utils/logger');

// Default detection patterns (used if not configured)
const DEFAULT_WANTS_BOOKING = [
    'i want to schedule',
    'i need to schedule',
    'i would like to schedule',
    'can i schedule',
    'can you schedule',
    'i need an appointment',
    'i want an appointment',
    'book an appointment',
    'book a service',
    'schedule service',
    'schedule a service',
    'set up an appointment',
    'make an appointment',
    'need to come in',
    'bring my car in',
    'need service'
];

const DEFAULT_DIRECT_INTENT_PATTERNS = [
    // Strong explicit intent - these bypass consent entirely
    /i (?:want|need|would like) to (?:schedule|book|make|set up)/i,
    /(?:can|could) (?:you|i) (?:schedule|book|make)/i,
    /(?:schedule|book) (?:an?|my) (?:appointment|service)/i,
    /i'?d like to (?:schedule|book|come in)/i,
    /please (?:schedule|book)/i
];

const DEFAULT_IMPLICIT_CONSENT_PATTERNS = [
    // Softer signals that suggest intent but may need confirmation
    'that would be great',
    'sounds good',
    'let\'s do it',
    'sure, schedule',
    'yes, schedule',
    'go ahead',
    'please do'
];

// Fast-path urgency keywords - these indicate caller wants immediate action
const DEFAULT_FAST_PATH_KEYWORDS = [
    // Direct booking requests
    'send someone', 'send somebody',
    'get someone out', 'get somebody out',
    'need you out', 'need someone out',
    'come out', 'come today', 'come out today',
    // Frustration / done troubleshooting
    'just fix it', 'fix it',
    'sick of it', 'sick of this',
    'done troubleshooting', 'stop asking',
    'just send', 'just book',
    // Urgency
    'need service', 'need help now',
    'as soon as possible', 'asap',
    'emergency', 'urgent', 'right away', 'immediately'
];

class ConsentGate {
    /**
     * Detect if the user's input expresses booking intent.
     * This runs BEFORE the consent question is asked.
     * 
     * @param {Object} params
     * @param {Object} params.company - Company config with frontDeskBehavior
     * @param {string} params.userInput - User's current utterance
     * @param {Object} params.state - Current call state
     * @param {string} params.callSid - For logging
     * @returns {Object} { hasBookingIntent, intentType, matchedPattern, bypassConsent, turnEventBuffer }
     */
    static detectBookingIntent({ company, userInput, state, callSid }) {
        const turnEventBuffer = [];
        const companyId = company?._id?.toString?.() || null;
        const turn = state?.turnCount || 0;
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push({
                callId: callSid,
                companyId,
                type,
                turn,
                data,
                ts: new Date().toISOString()
            });
        };
        
        const inputText = (userInput || '').toLowerCase().trim();
        if (!inputText) {
            bufferEvent('CONSENT_GATE_INTENT_DETECTION', {
                inputTextPreview: '',
                hasBookingIntent: false,
                intentType: null,
                reason: 'EMPTY_INPUT',
                configSource: 'frontDeskBehavior.detectionTriggers'
            });
            return { hasBookingIntent: false, intentType: null, matchedPattern: null, bypassConsent: false, turnEventBuffer };
        }
        
        // Load config
        const detectionTriggers = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
        const discoveryConsent = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        
        // Get configured patterns or use defaults
        const wantsBookingPhrases = Array.isArray(detectionTriggers.wantsBooking) && detectionTriggers.wantsBooking.length > 0
            ? detectionTriggers.wantsBooking
            : DEFAULT_WANTS_BOOKING;
            
        const directIntentPatterns = Array.isArray(detectionTriggers.directIntentPatterns) && detectionTriggers.directIntentPatterns.length > 0
            ? detectionTriggers.directIntentPatterns.map(p => {
                try { return typeof p === 'string' ? new RegExp(p, 'i') : p; }
                catch { return null; }
            }).filter(Boolean)
            : DEFAULT_DIRECT_INTENT_PATTERNS;
            
        const implicitPatterns = Array.isArray(discoveryConsent.implicitConsentPatterns) && discoveryConsent.implicitConsentPatterns.length > 0
            ? discoveryConsent.implicitConsentPatterns
            : DEFAULT_IMPLICIT_CONSENT_PATTERNS;
        
        // V111: Fast-path urgency keywords from config
        const fastPathConfig = company?.aiAgentSettings?.frontDeskBehavior?.fastPathBooking || {};
        const fastPathEnabled = fastPathConfig.enabled !== false; // Default enabled
        const fastPathKeywords = Array.isArray(fastPathConfig.triggerKeywords) && fastPathConfig.triggerKeywords.length > 0
            ? fastPathConfig.triggerKeywords
            : DEFAULT_FAST_PATH_KEYWORDS;
        
        let hasBookingIntent = false;
        let intentType = null;
        let matchedPattern = null;
        let bypassConsent = false;
        let isUrgent = false;
        
        // Check 1: Direct intent patterns (BYPASS consent)
        for (const pattern of directIntentPatterns) {
            if (pattern.test(inputText)) {
                hasBookingIntent = true;
                intentType = 'DIRECT_INTENT';
                matchedPattern = pattern.toString();
                bypassConsent = true;
                break;
            }
        }
        
        // Check 2: Fast-path urgency keywords (BYPASS consent - caller is urgent)
        if (!hasBookingIntent && fastPathEnabled) {
            for (const keyword of fastPathKeywords) {
                const keywordLower = keyword.toLowerCase().trim();
                if (inputText.includes(keywordLower)) {
                    hasBookingIntent = true;
                    intentType = 'FAST_PATH_URGENCY';
                    matchedPattern = keyword;
                    bypassConsent = true; // Urgency = skip consent
                    isUrgent = true;
                    break;
                }
            }
        }
        
        // Check 3: Wants booking phrases (may need consent)
        if (!hasBookingIntent) {
            for (const phrase of wantsBookingPhrases) {
                const phraseLower = phrase.toLowerCase().trim();
                if (inputText.includes(phraseLower)) {
                    hasBookingIntent = true;
                    intentType = 'WANTS_BOOKING_PHRASE';
                    matchedPattern = phrase;
                    // Don't bypass consent for phrases - they're softer signals
                    break;
                }
            }
        }
        
        // Check 4: Implicit consent patterns (softest signal)
        if (!hasBookingIntent) {
            for (const phrase of implicitPatterns) {
                const phraseLower = phrase.toLowerCase().trim();
                if (inputText.includes(phraseLower)) {
                    hasBookingIntent = true;
                    intentType = 'IMPLICIT_CONSENT';
                    matchedPattern = phrase;
                    // Implicit consent might bypass if strong enough context
                    break;
                }
            }
        }
        
        // EMIT INTENT DETECTION EVENT
        bufferEvent('CONSENT_GATE_INTENT_DETECTION', {
            inputTextPreview: inputText.substring(0, 80),
            hasBookingIntent,
            intentType,
            matchedPattern,
            bypassConsent,
            isUrgent,
            fastPathEnabled,
            configuredWantsBookingCount: wantsBookingPhrases.length,
            configuredDirectIntentCount: directIntentPatterns.length,
            configuredImplicitCount: implicitPatterns.length,
            configuredFastPathCount: fastPathKeywords.length,
            configSource: 'frontDeskBehavior.detectionTriggers + fastPathBooking'
        });
        
        // If bypass consent, log a special event
        if (bypassConsent) {
            bufferEvent('CONSENT_GATE_DIRECT_INTENT_BYPASS', {
                intentType,
                matchedPattern,
                reason: 'EXPLICIT_BOOKING_INTENT_DETECTED',
                action: 'BYPASS_CONSENT_QUESTION'
            });
            
            logger.info('[CONSENT_GATE] Direct intent bypass triggered', {
                callSid,
                matchedPattern,
                intentType
            });
        }
        
        return { hasBookingIntent, intentType, matchedPattern, bypassConsent, isUrgent, turnEventBuffer };
    }
    
    /**
     * Generate the consent question to ask the user.
     * Enhanced with configurable question text and raw event logging.
     * 
     * @param {Object} params
     * @param {Object} params.company - Company config
     * @param {Object} params.state - Current call state
     * @param {string} params.callSid - For logging
     * @returns {Object} { response, matchSource, state, turnEventBuffer }
     */
    static ask({ company, state, callSid }) {
        const turnEventBuffer = [];
        const companyId = company?._id?.toString?.() || null;
        const turn = state?.turnCount || 0;
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push({
                callId: callSid,
                companyId,
                type,
                turn,
                data,
                ts: new Date().toISOString()
            });
        };
        
        // Load configured consent question
        const discoveryConsent = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const consentEnabled = discoveryConsent.enabled !== false; // Default enabled
        const consentQuestion = discoveryConsent.consentQuestion || 
            'Would you like me to schedule a service appointment?';
        
        // EMIT CONSENT ASK EVENT
        bufferEvent('CONSENT_GATE_ASK', {
            consentEnabled,
            consentQuestion: consentQuestion.substring(0, 100),
            configSource: 'frontDeskBehavior.discoveryConsent'
        });
        
        logger.info('[CONSENT_GATE] Asking consent question', {
            callSid,
            consentEnabled
        });

        return {
            response: consentQuestion,
            matchSource: 'CONSENT_GATE',
            state: {
                ...state,
                lane: 'DISCOVERY',
                consent: {
                    pending: true,
                    askedExplicitly: true
                }
            },
            turnEventBuffer
        };
    }

    /**
     * Evaluate user's response to the consent question.
     * Enhanced with configurable yes/no words and raw event logging.
     * 
     * @param {Object} params
     * @param {Object} params.company - Company config with frontDeskBehavior
     * @param {string} params.userInput - User's response
     * @param {Object} params.state - Current call state
     * @param {string} params.callSid - For logging
     * @returns {Object} { granted, pending, turnEventBuffer }
     */
    static evaluate({ company, userInput, state, callSid }) {
        const turnEventBuffer = [];
        const companyId = company?._id?.toString?.() || null;
        const turn = state?.turnCount || 0;
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push({
                callId: callSid,
                companyId,
                type,
                turn,
                data,
                ts: new Date().toISOString()
            });
        };
        
        // Check if consent was even asked
        if (!(state?.consent?.pending === true && state?.consent?.askedExplicitly === true)) {
            bufferEvent('CONSENT_GATE_EVALUATE', {
                inputTextPreview: (userInput || '').substring(0, 40),
                consentPending: state?.consent?.pending,
                consentAskedExplicitly: state?.consent?.askedExplicitly,
                result: 'NOT_EVALUATED',
                reason: 'CONSENT_NOT_PENDING',
                granted: false
            });
            return { granted: false, pending: state?.consent?.pending === true, turnEventBuffer };
        }

        const text = (userInput || '').toLowerCase().trim();
        if (!text) {
            bufferEvent('CONSENT_GATE_EVALUATE', {
                inputTextPreview: '',
                result: 'NOT_EVALUATED',
                reason: 'EMPTY_INPUT',
                granted: false,
                pending: true
            });
            return { granted: false, pending: true, turnEventBuffer };
        }

        // Load configured yes/no words
        const discoveryConsent = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        
        const configuredYesWords = discoveryConsent.consentYesWords;
        const configuredNoWords = discoveryConsent.consentNoWords;
        
        const fallbackYesWords = ['yes', 'yeah', 'yep', 'yup', 'sure', 'please', 'ok', 'okay', 'absolutely', 'definitely', 'of course'];
        const fallbackNoWords = ['no', 'nope', 'nah', 'not now', 'not yet', 'no thanks', 'no thank you'];
        
        const yesSet = new Set(
            Array.isArray(configuredYesWords) && configuredYesWords.length > 0
                ? configuredYesWords.map((w) => `${w}`.toLowerCase().trim()).filter(Boolean)
                : fallbackYesWords
        );
        const noSet = new Set(
            Array.isArray(configuredNoWords) && configuredNoWords.length > 0
                ? configuredNoWords.map((w) => `${w}`.toLowerCase().trim()).filter(Boolean)
                : fallbackNoWords
        );
        
        const cleaned = text.replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const tokens = cleaned.split(' ').filter(Boolean);

        const isYes = tokens.length > 0 && tokens.length <= 3 && tokens.every((t) => yesSet.has(t));
        const isNo = tokens.length > 0 && tokens.length <= 3 && tokens.every((t) => noSet.has(t));

        let result = 'UNCLEAR';
        let granted = false;
        let pending = true;
        
        if (isYes) {
            result = 'YES';
            granted = true;
            pending = false;
        } else if (isNo) {
            result = 'NO';
            granted = false;
            pending = false;
        }
        
        // EMIT CONSENT EVALUATE EVENT
        bufferEvent('CONSENT_GATE_EVALUATE', {
            inputTextPreview: text.substring(0, 40),
            tokens,
            isYes,
            isNo,
            result,
            granted,
            pending,
            configuredYesWordsCount: yesSet.size,
            configuredNoWordsCount: noSet.size,
            configSource: 'frontDeskBehavior.discoveryConsent'
        });
        
        if (granted) {
            logger.info('[CONSENT_GATE] Consent GRANTED', { callSid, tokens });
        } else if (!pending) {
            logger.info('[CONSENT_GATE] Consent DENIED', { callSid, tokens });
        } else {
            logger.info('[CONSENT_GATE] Consent response unclear, still pending', { callSid, tokens });
        }

        return { granted, pending, turnEventBuffer };
    }
    
    /**
     * Check if consent is required based on config.
     * Some businesses may want to skip consent and go straight to booking.
     * 
     * @param {Object} company - Company config
     * @returns {boolean}
     */
    static isConsentRequired(company) {
        const discoveryConsent = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        // Default: consent is required (enabled)
        return discoveryConsent.enabled !== false;
    }
}

module.exports = { ConsentGate, DEFAULT_WANTS_BOOKING, DEFAULT_DIRECT_INTENT_PATTERNS };

/**
 * ============================================================================
 * CONVERSATION ENGINE - Unified AI Brain for ALL Channels
 * ============================================================================
 * 
 * This is THE SINGLE ENTRY POINT for all conversation processing.
 * Every channel (phone, SMS, website, test console) calls this engine.
 * 
 * WHAT THIS ENGINE DOES:
 * 1. Loads company config (RuntimeConfigLoader pattern)
 * 2. Gets/creates session (SessionService - MongoDB)
 * 3. Builds customer context (CustomerService)
 * 4. Builds running summary (RunningSummaryService)
 * 5. Extracts slots from user input (programmatic)
 * 6. Calls AI brain (HybridReceptionistLLM)
 * 7. Applies guards (forbidden phrases, phase rules)
 * 8. Saves turn to session
 * 9. Returns unified response
 * 
 * WHAT CHANNELS DO (adapters only):
 * - Phone: TwiML formatting, STT/TTS, Twilio callbacks
 * - Chat/Website: JSON formatting, debug payloads
 * - SMS: Plain text in/out
 * 
 * CRITICAL RULES:
 * - ALL AI behavior changes go HERE, never in channel routes
 * - Same persona, same prompts, same phase logic across channels
 * - If you're editing AI logic in v2twilio.js or chat.js, STOP - edit here
 * 
 * MULTI-TENANT: All operations require companyId for isolation.
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const BookingRequest = require('../models/BookingRequest');
const CustomerService = require('./CustomerService');
const SessionService = require('./SessionService');
const RunningSummaryService = require('./RunningSummaryService');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const BookingScriptEngine = require('./BookingScriptEngine');
const BookingStateMachine = require('./BookingStateMachine');
const ResponseRenderer = require('./ResponseRenderer');
const ConversationStateMachine = require('./ConversationStateMachine');
const LLMDiscoveryEngine = require('./LLMDiscoveryEngine');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// VERSION BANNER - Proves this code is deployed
// CHECK THIS IN DEBUG TO VERIFY DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = 'V25-FAST-PATH-BOOKING';  // <-- CHANGE THIS EACH DEPLOY
logger.info(`[CONVERSATION ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`, {
    features: [
        '✅ V22: LLM-LED DISCOVERY ARCHITECTURE',
        '✅ LLM is PRIMARY BRAIN (not fallback)',
        '✅ Scenarios are TOOLS (not scripts)',
        '✅ Booking is DETERMINISTIC (consent-gated)',
        '✅ No triage gates, no pre-routing',
        '✅ session.mode = DISCOVERY | SUPPORT | BOOKING | COMPLETE',
        '✅ Consent detection via UI-configured phrases',
        '✅ Latency target: < 1.2s per turn',
        '✅ V23: CHEAT SHEETS integrated as fallback knowledge',
        '✅ V23: Booking interrupts use cheat sheets then resume slot',
        '✅ V24: COMPLETE mode lock - no re-asking slots after booking',
        '✅ V24: askFullName defaults FALSE (prompt as law)',
        '✅ V24: displayName uses first name, never lastName alone',
        '✅ V24: Slot state debug snapshot each turn',
        '✅ V25: FAST-PATH BOOKING - respects caller urgency',
        '✅ V25: "I need you out here" → immediate offer (no troubleshooting)',
        '✅ V25: UI-configurable trigger keywords + offer script',
        '✅ V25: Still requires explicit consent to enter BOOKING'
    ]
});

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 CHEAT SHEET SEARCH - Find relevant content from cheat sheets
// ═══════════════════════════════════════════════════════════════════════════
// Used for:
// - DISCOVERY: Fallback after 3-tier scenarios
// - BOOKING: Interrupt question answers ONLY
// ═══════════════════════════════════════════════════════════════════════════
function searchCheatSheets(cheatSheetConfig, query) {
    if (!cheatSheetConfig || !query) return null;
    
    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    
    let bestMatch = null;
    let bestScore = 0;
    
    // Search through all categories in cheat sheet config
    // Expected structure: { category: { items: [{ question, answer }] } }
    // or: { categories: [{ name, items: [...] }] }
    const categories = cheatSheetConfig.categories || 
                       Object.entries(cheatSheetConfig).map(([name, data]) => ({ name, ...data }));
    
    for (const category of categories) {
        const items = category.items || category.scenarios || category.entries || [];
        
        for (const item of items) {
            // Match against question/trigger text
            const searchText = (item.question || item.trigger || item.title || '').toLowerCase();
            const answerText = item.answer || item.response || item.content || '';
            
            // Simple keyword matching score
            let score = 0;
            for (const word of queryWords) {
                if (searchText.includes(word)) score += 2;
                if (answerText.toLowerCase().includes(word)) score += 1;
            }
            
            // Boost for exact phrase match
            if (searchText.includes(queryLower)) score += 5;
            
            if (score > bestScore && score >= 3) {  // Minimum threshold
                bestScore = score;
                bestMatch = {
                    category: category.name || category.category,
                    question: item.question || item.trigger || item.title,
                    answer: answerText,
                    score: score,
                    title: item.title || item.question
                };
            }
        }
    }
    
    return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 FINALIZE BOOKING - Creates booking record and returns final script
// ═══════════════════════════════════════════════════════════════════════════
// Called when ALL required slots are collected and confirmed.
// Creates a BookingRequest record and returns the appropriate final script.
// 
// CORE PRINCIPLE: The AI must never imply a follow-up action
// the company did not explicitly enable.
// DEFAULT: "Confirmed on Call" - no callback assumed.
// ═══════════════════════════════════════════════════════════════════════════
async function finalizeBooking(session, company, slots, metadata = {}) {
    const log = (msg, data = {}) => {
        logger.info(`[FINALIZE BOOKING] ${msg}`, data);
    };
    
    log('🎯 Starting booking finalization', {
        sessionId: session._id?.toString(),
        companyId: company._id?.toString(),
        slots: Object.keys(slots || {}).filter(k => slots[k])
    });
    
    try {
        // Get booking outcome config
        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const bookingOutcome = frontDesk.bookingOutcome || {};
        const outcomeMode = bookingOutcome.mode || 'confirmed_on_call';
        
        // Determine if ASAP variant should be used
        const timePreference = slots.time?.preference || slots.time || '';
        const isAsap = typeof timePreference === 'string' && 
                       /\b(asap|urgent|emergency|today|soonest|earliest)\b/i.test(timePreference);
        const useAsapVariant = bookingOutcome.useAsapVariant !== false && isAsap;
        
        log('📋 Outcome config', {
            outcomeMode,
            isAsap,
            useAsapVariant
        });
        
        // Build slots structure for BookingRequest
        const bookingSlots = {
            name: {
                first: slots.name?.first || null,
                last: slots.name?.last || null,
                full: slots.name?.full || slots.name || null
            },
            phone: slots.phone || null,
            address: {
                full: slots.address?.full || slots.address || null,
                street: slots.address?.street || null,
                city: slots.address?.city || null,
                unit: slots.address?.unit || null
            },
            time: {
                preference: timePreference || null,
                window: slots.time?.window || null,
                isAsap: isAsap
            },
            custom: {}
        };
        
        // Add any custom slots
        const standardSlots = ['name', 'phone', 'address', 'time', 'partialName'];
        for (const [key, value] of Object.entries(slots)) {
            if (!standardSlots.includes(key) && value) {
                bookingSlots.custom.set ? bookingSlots.custom.set(key, value) : (bookingSlots.custom[key] = value);
            }
        }
        
        // Generate case ID
        const caseId = BookingRequest.generateCaseId();
        
        // Map outcome mode to status
        const statusMap = {
            'confirmed_on_call': 'FAKE_CONFIRMED',
            'pending_dispatch': 'PENDING_DISPATCH',
            'callback_required': 'CALLBACK_QUEUED',
            'transfer_to_scheduler': 'TRANSFERRED',
            'after_hours_hold': 'AFTER_HOURS'
        };
        
        // Create BookingRequest record
        const bookingRequest = new BookingRequest({
            companyId: company._id,
            sessionId: session._id,
            customerId: session.customerId || null,
            ruleId: metadata.ruleId || null,
            trade: company.trade || null,
            serviceType: metadata.serviceType || null,
            status: statusMap[outcomeMode] || 'FAKE_CONFIRMED',
            outcomeMode: outcomeMode,
            slots: bookingSlots,
            issue: session.discovery?.issue || null,
            issueSummary: session.discoverySummary || null,
            urgency: isAsap ? 'urgent' : 'normal',
            caseId: caseId,
            channel: metadata.channel || 'phone',
            callSid: metadata.callSid || null,
            callerPhone: metadata.callerPhone || null,
            createdAt: new Date(),
            completedAt: new Date()
        });
        
        await bookingRequest.save();
        
        log('✅ BookingRequest created', {
            bookingRequestId: bookingRequest._id.toString(),
            caseId: caseId,
            status: bookingRequest.status,
            outcomeMode: outcomeMode
        });
        
        // Get the final script
        let finalScript;
        
        // Check for custom override first
        if (bookingOutcome.customFinalScript) {
            finalScript = bookingOutcome.customFinalScript;
        }
        // Check for ASAP variant
        else if (useAsapVariant && bookingOutcome.asapVariantScript) {
            finalScript = bookingOutcome.asapVariantScript;
        }
        // Use mode-specific script
        else {
            const finalScripts = bookingOutcome.finalScripts || {};
            finalScript = finalScripts[outcomeMode] || getDefaultFinalScript(outcomeMode);
        }
        
        // Populate placeholders in final script
        const populatedScript = bookingRequest.populateFinalScript(finalScript);
        
        // Store final script used for audit
        bookingRequest.finalScriptUsed = populatedScript;
        await bookingRequest.save();
        
        log('📝 Final script generated', {
            outcomeMode,
            useAsapVariant,
            scriptPreview: populatedScript.substring(0, 100)
        });
        
        return {
            success: true,
            bookingRequestId: bookingRequest._id.toString(),
            caseId: caseId,
            status: bookingRequest.status,
            outcomeMode: outcomeMode,
            finalScript: populatedScript,
            isAsap: isAsap,
            // For transfer mode, include transfer flag
            requiresTransfer: outcomeMode === 'transfer_to_scheduler'
        };
        
    } catch (error) {
        log('❌ Booking finalization failed', {
            error: error.message,
            stack: error.stack
        });
        
        // Return a safe fallback
        return {
            success: false,
            error: error.message,
            finalScript: "Thank you for your information. We'll be in touch shortly.",
            outcomeMode: 'confirmed_on_call',
            requiresTransfer: false
        };
    }
}

// Default final scripts (used if not configured in company settings)
function getDefaultFinalScript(mode) {
    const defaults = {
        'confirmed_on_call': "Perfect, {name}. You're all set. Your appointment is scheduled for {timePreference}. If anything changes, you can call us back anytime. Is there anything else I can help you with today?",
        'pending_dispatch': "Thanks, {name}. I've logged everything and sent it to dispatch. They'll review and confirm the time shortly. Anything else I can help with?",
        'callback_required': "Thanks, {name}. A team member will reach out shortly to finalize your appointment. Is there anything else?",
        'transfer_to_scheduler': "I'm going to transfer you now to our scheduler to get this confirmed.",
        'after_hours_hold': "We're currently closed, but I've captured your request. We'll follow up first thing when we open. If this is urgent, I can transfer you now."
    };
    return defaults[mode] || defaults['confirmed_on_call'];
}

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 CONSENT DETECTOR - Checks if caller explicitly wants to book
// ═══════════════════════════════════════════════════════════════════════════
// Uses ONLY UI-configured phrases from detectionTriggers.wantsBooking[]
// Does NOT use hardcoded regex (broken/fix/need help are DISCOVERY, not consent)
// ═══════════════════════════════════════════════════════════════════════════
const ConsentDetector = {
    /**
     * Check if user input contains explicit booking consent
     * @param {string} text - User input
     * @param {Object} company - Company config with detectionTriggers
     * @param {Object} session - Session with consent state
     * @returns {Object} { hasConsent, matchedPhrase, reason }
     */
    checkForConsent(text, company, session) {
        if (!text || typeof text !== 'string') {
            return { hasConsent: false, matchedPhrase: null, reason: 'no_input' };
        }
        
        const textLower = text.toLowerCase().trim();
        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const discoveryConsent = frontDesk.discoveryConsent || {};
        const detectionTriggers = frontDesk.detectionTriggers || {};
        
        // Check if consent is required (default: true for Option 1)
        const requiresExplicitConsent = discoveryConsent.bookingRequiresExplicitConsent !== false;
        
        if (!requiresExplicitConsent) {
            // Legacy mode: consent not required (not recommended)
            return { hasConsent: true, matchedPhrase: 'legacy_mode', reason: 'consent_not_required' };
        }
        
        // Get UI-configured consent phrases
        const consentPhrases = detectionTriggers.wantsBooking || [];
        // Extended yes words - includes "absolutely", "definitely", "sounds good", etc.
        const consentYesWords = discoveryConsent.consentYesWords || [
            'yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok', 'alright',
            'absolutely', 'definitely', 'certainly', 'of course', 'sounds good',
            'that would be great', 'let\'s do it', 'go ahead', 'perfect'
        ];
        const requiresYesAfterPrompt = discoveryConsent.consentRequiresYesAfterPrompt !== false;
        
        // Check for explicit booking phrases from UI config
        for (const phrase of consentPhrases) {
            if (phrase && textLower.includes(phrase.toLowerCase())) {
                return { 
                    hasConsent: true, 
                    matchedPhrase: phrase, 
                    reason: 'explicit_consent_phrase' 
                };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // SMART YES DETECTION - Check if caller is saying "yes" to booking
        // ═══════════════════════════════════════════════════════════════════
        // This catches: "yes", "yes please", "yes can you please", "yeah", etc.
        // We check if the AI just asked about scheduling in the last turn
        // ═══════════════════════════════════════════════════════════════════
        
        // Check if last AI response asked about scheduling
        const lastTurns = session?.turns || [];
        const lastAssistantTurn = [...lastTurns].reverse().find(t => t.role === 'assistant');
        const lastAssistantText = (lastAssistantTurn?.content || '').toLowerCase();
        const askedAboutScheduling = lastAssistantText.includes('schedule') || 
                                     lastAssistantText.includes('appointment') ||
                                     lastAssistantText.includes('technician') ||
                                     lastAssistantText.includes('come out') ||
                                     session.conversationMemory?.askedConsentQuestion;
        
        if (askedAboutScheduling) {
            // Check for yes words anywhere in the response
            for (const yesWord of consentYesWords) {
                // More flexible matching: "yes", "yes please", "yes can you", etc.
                if (textLower.includes(yesWord)) {
                    // Make sure it's not a negative context like "yes but no" or "not yes"
                    const negatives = ['no', 'not', "don't", "can't", 'never'];
                    const hasNegative = negatives.some(neg => textLower.includes(neg));
                    
                    if (!hasNegative) {
                        return { 
                            hasConsent: true, 
                            matchedPhrase: yesWord, 
                            reason: 'yes_after_scheduling_offer' 
                        };
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // URGENCY IMPLIES BOOKING - "need someone today", "ASAP", etc.
        // ═══════════════════════════════════════════════════════════════════
        const urgencyBookingPhrases = [
            'need someone today',
            'need somebody today',
            'as soon as possible',
            'asap',
            'come out today',
            'today if possible',
            'right away',
            'immediately',
            'send someone',
            'send somebody'
        ];
        
        for (const urgencyPhrase of urgencyBookingPhrases) {
            if (textLower.includes(urgencyPhrase)) {
                return { 
                    hasConsent: true, 
                    matchedPhrase: urgencyPhrase, 
                    reason: 'urgency_implies_booking' 
                };
            }
        }
        
        return { hasConsent: false, matchedPhrase: null, reason: 'no_consent_detected' };
    },
    
    /**
     * Check if minimum discovery fields are met before asking consent
     * @param {Object} session - Session with discovery data
     * @param {Object} company - Company config
     * @returns {boolean}
     */
    canAskConsentQuestion(session, company) {
        const discoveryConsent = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const minFields = discoveryConsent.minDiscoveryFieldsBeforeConsent || ['issueSummary'];
        
        for (const field of minFields) {
            switch (field) {
                case 'issueSummary':
                    if (!session.discovery?.issue) return false;
                    break;
                case 'serviceType':
                    if (!session.discovery?.callType || session.discovery.callType === 'unknown') return false;
                    break;
                case 'urgency':
                    if (!session.discovery?.urgency) return false;
                    break;
                case 'existingCustomer':
                    if (!session.customerId) return false;
                    break;
            }
        }
        return true;
    }
};

/**
 * Programmatic slot extraction helpers
 * These extract obvious data (name, phone, address) before LLM processing
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     * Handles any case (STT may output lowercase)
     */
    extractName(text) {
        if (!text || typeof text !== 'string') return null;
        
        // ═══════════════════════════════════════════════════════════════════
        // FALSE POSITIVES - Comprehensive list of words that are NOT names
        // ═══════════════════════════════════════════════════════════════════
        const falsePositiveWords = [
            // Greetings
            'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'night',
            // Confirmations
            'yeah', 'yes', 'sure', 'okay', 'ok', 'alright', 'right', 'yep', 'yup',
            // Common words & auxiliary verbs (CRITICAL - "is failing" should NOT be a name!)
            'the', 'that', 'this', 'what', 'just', 'well', 'please', 'thanks', 'thank', 'you',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
            'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'a', 'an', 'and', 'or', 'but',
            // Common verbs (critical for "I'm having/doing/calling" etc)
            'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going', 'coming',
            'waiting', 'hoping', 'thinking', 'wondering', 'needing', 'wanting', 'asking',
            'dealing', 'experiencing', 'seeing', 'feeling', 'hearing', 'running', 'working',
            // Problem-related words (CRITICAL - "thermostat failing" should NOT extract name!)
            'failing', 'broken', 'leaking', 'stopped', 'making', 'noise', 'noisy', 'loud',
            'not', 'wont', 'doesnt', 'isnt', 'cant', 'problem', 'problems', 'issue', 'issues',
            'trouble', 'troubles', 'wrong', 'weird', 'strange', 'acting', 'up', 'down', 'out',
            // Adjectives/states
            'great', 'fine', 'good', 'bad', 'hot', 'cold', 'here', 'there', 'back', 'home',
            'interested', 'concerned', 'worried', 'happy', 'sorry', 'glad',
            // Filler words
            'like', 'so', 'very', 'really', 'actually', 'basically', 'literally', 'probably',
            // SERVICE/TRADE WORDS - Critical for "air conditioning service", "AC repair", etc.
            'service', 'services', 'repair', 'repairs', 'maintenance', 'install', 'installation',
            'conditioning', 'air', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical',
            'unit', 'system', 'systems', 'equipment', 'furnace', 'thermostat', 'duct', 'ducts',
            'appointment', 'schedule', 'scheduling', 'book', 'booking', 'call', 'help',
            'need', 'needs', 'want', 'wants', 'get', 'fix', 'check', 'look', 'today', 'tomorrow',
            // TIME/URGENCY words - CRITICAL: "soon", "possible", "asap" are NOT names!
            'soon', 'possible', 'asap', 'now', 'immediately', 'urgent', 'urgently',
            'available', 'earliest', 'soonest', 'first', 'next', 'whenever',
            'somebody', 'someone', 'anybody', 'anyone', 'technician', 'tech',
            // CONSENT words that might slip through
            'absolutely', 'definitely', 'certainly', 'perfect', 'great', 'sounds'
        ];
        
        // Full phrases that look like names but aren't
        const falsePositivePhrases = [
            'good morning', 'good afternoon', 'good evening', 'good night',
            'thank you', 'hi there', 'hello there', 'hey there',
            'this is', 'that is', 'what is', 'yes please', 'okay thanks',
            'yeah sure', 'sure thing', 'all right', 'well hello',
            'having just', 'doing great', 'doing good', 'doing fine',
            'having some', 'having issues', 'having problems', 'having trouble',
            // Service-related phrases that look like names
            'conditioning service', 'air conditioning', 'ac service', 'ac repair',
            'hvac service', 'heating service', 'cooling service', 'plumbing service',
            'electrical service', 'maintenance service', 'repair service',
            // TIME/URGENCY phrases - CRITICAL: "as soon as possible" is NOT a name!
            'as soon as possible', 'as possible', 'soon as possible',
            'right away', 'right now', 'immediately', 'today', 'tomorrow',
            'this morning', 'this afternoon', 'this evening',
            'asap', 'urgent', 'urgently', 'emergency',
            'morning or afternoon', 'afternoon or morning',
            'whenever possible', 'when possible', 'at your earliest',
            'first available', 'next available', 'soonest available'
        ];
        
        // Normalize and check if input is just a greeting/phrase
        const normalizedInput = text.toLowerCase().trim();
        for (const phrase of falsePositivePhrases) {
            if (normalizedInput === phrase || normalizedInput.startsWith(phrase + ' ') || normalizedInput.endsWith(' ' + phrase)) {
                return null; // Don't extract anything from greeting-only messages
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // SMART EXTRACTION - Only use aggressive patterns on short messages
        // Long messages are unlikely to be name introductions
        // ═══════════════════════════════════════════════════════════════════
        const wordCount = text.split(/\s+/).length;
        const isShortMessage = wordCount <= 5; // "I'm John Smith" or "My name is Mark"
        
        // Common patterns - use [a-zA-Z] to handle any case from STT
        const patterns = [
            // High confidence patterns - always use
            { regex: /my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i, requireShort: false },
            { regex: /name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i, requireShort: false },
            { regex: /it'?s\s+([a-zA-Z]+)\s+(?:calling|here)/i, requireShort: false },
            
            // Medium confidence - only on shorter messages
            { regex: /this is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i, requireShort: true },
            { regex: /i'?m\s+([a-zA-Z]+)$/i, requireShort: true },  // "I'm John" only at end
            
            // Low confidence patterns - require very short messages
            { regex: /(?:^|\s)([a-zA-Z]+\s+[a-zA-Z]+)(?:\s*$)/i, requireShort: true }  // "John Smith" at end
        ];
        
        for (const { regex, requireShort } of patterns) {
            // Skip patterns that require short messages if this is a long message
            if (requireShort && !isShortMessage) continue;
            
            const match = text.match(regex);
            if (match && match[1]) {
                const rawName = match[1].trim();
                const rawNameLower = rawName.toLowerCase();
                
                // Filter out single-word false positives
                if (falsePositiveWords.includes(rawNameLower)) {
                    continue;
                }
                
                // Filter out two-word phrases that are false positives
                if (falsePositivePhrases.includes(rawNameLower)) {
                    continue;
                }
                
                // Filter out if EITHER word is a false positive (stricter check)
                const words = rawNameLower.split(/\s+/);
                const anyWordIsFalsePositive = words.some(w => falsePositiveWords.includes(w));
                if (anyWordIsFalsePositive) {
                    continue;
                }
                
                // Title case the name: "mark" -> "Mark", "mark smith" -> "Mark Smith"
                const name = rawName.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
                return name;
            }
        }
        
        return null;
    },
    
    /**
     * Extract phone number from user input
     */
    extractPhone(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Remove common words that might confuse extraction
        let cleaned = text.replace(/\b(phone|number|is|my|the|at|reach|me|call)\b/gi, ' ');
        
        // Look for 10-digit patterns
        const digits = cleaned.replace(/\D/g, '');
        
        // Must be 10 or 11 digits (with country code)
        if (digits.length === 10) {
            return digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        } else if (digits.length === 11 && digits.startsWith('1')) {
            return digits.substring(1).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        return null;
    },
    
    /**
     * Extract address from user input
     * STRICTER version - requires street number + street type
     */
    extractAddress(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Must have a street number and street type indicator
        // Comprehensive list of street types
        const streetTypes = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)\b/i;
        const hasStreetNumber = /\b\d{1,5}\s+\w+/; // e.g., "123 Main"
        
        // Check for both requirements
        if (!streetTypes.test(text) || !hasStreetNumber.test(text)) {
            return null;
        }
        
        // Filter out common complaint phrases that might have numbers
        const complaintPhrases = ['not cooling', 'not working', 'system', 'unit', 'years old', 'degrees'];
        for (const phrase of complaintPhrases) {
            if (text.toLowerCase().includes(phrase)) {
                return null;
            }
        }
        
        // Extract address-like pattern (with all street types)
        const addressPattern = /\b(\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)[\w\s,]*)/i;
        const match = text.match(addressPattern);
        
        if (match && match[1] && match[1].length > 10) {
            return match[1].trim();
        }
        
        return null;
    },
    
    /**
     * Extract time preference from user input
     * Catches: morning, afternoon, asap, specific times, etc.
     */
    extractTime(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lower = text.toLowerCase().trim();
        
        // ═══════════════════════════════════════════════════════════════════
        // FALSE POSITIVE CHECK - Don't extract time from greetings!
        // "good afternoon" is a GREETING, not a time preference
        // ═══════════════════════════════════════════════════════════════════
        const greetingPatterns = [
            /^(hi|hello|hey|howdy|yo)\s+(good\s+)?(morning|afternoon|evening)/i,
            /^good\s+(morning|afternoon|evening)/i,
            /good\s+(morning|afternoon|evening)[\s\.\!\?]*$/i  // ends with greeting
        ];
        
        if (greetingPatterns.some(p => p.test(lower))) {
            return null; // Don't extract time from greetings
        }
        
        // ASAP / Urgency patterns - STRICT DETECTION
        // "today" alone is too aggressive - "issues today" is NOT a time request
        // Only trigger ASAP for explicit urgency phrases
        // 
        // CRITICAL: "what is as soon as possible" is a QUESTION, not a time preference!
        // Don't extract time from questions about time terminology
        const isQuestionAboutTime = /^(what|when|how|does|is|can)\s+(is|does|do|exactly|does that mean)\s/i.test(lower) ||
                                    /^what\s+(is|does)\s/i.test(lower);
        
        if (isQuestionAboutTime) {
            return null; // Don't extract time from questions ABOUT time
        }
        
        const asapPatterns = [
            /as soon as possible/,
            /\basap\b/,
            /right away/,
            /right now/,
            /immediately/,
            /\burgent\b/,
            /\burgently\b/,
            /earliest\s+(?:appointment|available|time|slot)/,
            /first\s+available/,
            /next\s+available/,
            /soonest\s+(?:appointment|available|time|slot)/,
            /need\s+(?:someone|service|help)\s+today/,
            /come\s+(?:out\s+)?today/,
            /(?:schedule|book).*today/,
            /today\s+(?:if\s+possible|please|would\s+be)/
        ];
        
        if (asapPatterns.some(p => p.test(lower))) {
            return 'ASAP';
        }
        
        // Time of day patterns - only if NOT part of greeting
        if (/\bmorning\b/.test(lower) && !/good\s+morning/i.test(lower)) return 'morning';
        if (/\bafternoon\b/.test(lower) && !/good\s+afternoon/i.test(lower)) return 'afternoon';
        if (/\bevening\b/.test(lower) && !/good\s+evening/i.test(lower)) return 'evening';
        
        // ═══════════════════════════════════════════════════════════════════
        // PHONE NUMBER FILTER - Don't extract time from phone numbers!
        // "239-565-2202" should NOT extract "23:00 PM"
        // ═══════════════════════════════════════════════════════════════════
        const hasPhonePattern = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/.test(text);
        if (hasPhonePattern) {
            // Don't extract time from messages containing phone numbers
            return null;
        }
        
        // Specific time patterns (e.g., "3pm", "3:00", "at 3")
        // MUST have am/pm OR be preceded by "at" or "around" to be a valid time
        const specificTimeWithPeriod = lower.match(/\b(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/);
        const specificTimeWithContext = lower.match(/(?:at|around|by)\s+(\d{1,2})(?:\s*(?::|\.)?\s*(\d{2}))?/);
        
        if (specificTimeWithPeriod) {
            const hour = parseInt(specificTimeWithPeriod[1]);
            if (hour >= 1 && hour <= 12) { // Valid 12-hour time
                const minutes = specificTimeWithPeriod[2] || '00';
                const period = specificTimeWithPeriod[3].toUpperCase().replace(/\./g, '');
                return `${hour}:${minutes} ${period}`;
            }
        }
        
        if (specificTimeWithContext) {
            const hour = parseInt(specificTimeWithContext[1]);
            if (hour >= 1 && hour <= 12) { // Valid 12-hour time
                const minutes = specificTimeWithContext[2] || '00';
                const period = hour < 12 ? 'AM' : 'PM';
                return `${hour}:${minutes} ${period}`;
            }
        }
        
        // Relative day patterns
        if (/\btomorrow\b/.test(lower)) return 'tomorrow';
        if (/\btoday\b/.test(lower)) return 'today';
        if (/\bthis week\b/.test(lower)) return 'this week';
        if (/\bnext week\b/.test(lower)) return 'next week';
        
        // Day of week
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        for (const day of days) {
            if (lower.includes(day)) return day.charAt(0).toUpperCase() + day.slice(1);
        }
        
        return null;
    }
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MAIN ENTRY POINT: processTurn
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Call this for EVERY user message, regardless of channel.
 * 
 * @param {Object} params
 * @param {string} params.companyId - Required: Company ID for multi-tenant isolation
 * @param {string} params.channel - Required: 'phone' | 'sms' | 'website' | 'test'
 * @param {string} params.userText - Required: What the user said/typed
 * @param {string} params.sessionId - Optional: Existing session ID (creates new if not provided)
 * @param {string} params.callerPhone - Optional: Caller's phone number (for phone/sms)
 * @param {string} params.callSid - Optional: Twilio Call SID (for phone)
 * @param {Object} params.visitorInfo - Optional: Website visitor info { ip, userAgent, pageUrl }
 * @param {Object} params.metadata - Optional: Additional metadata (STT confidence, etc.)
 * @param {boolean} params.includeDebug - Optional: Include debug info in response
 * 
 * @returns {Object} {
 *   success: boolean,
 *   reply: string,              // AI response text
 *   sessionId: string,          // Session ID for continuity
 *   phase: string,              // Current phase: 'greeting' | 'discovery' | 'booking' | 'complete'
 *   slotsCollected: Object,     // { name, phone, address, ... }
 *   wantsBooking: boolean,      // Caller wants to schedule
 *   conversationMode: string,   // 'free' | 'booking'
 *   debug?: Object              // Debug info (if includeDebug: true)
 * }
 */
async function processTurn({
    companyId,
    channel,
    userText,
    sessionId: providedSessionId = null,
    callerPhone = null,
    callSid = null,
    visitorInfo = {},
    metadata = {},
    includeDebug = false,
    forceNewSession = false  // For Test Console - always create fresh session
}) {
    const startTime = Date.now();
    const debugLog = [];
    
    const log = (msg, data = {}) => {
        const entry = { ts: Date.now() - startTime, msg, ...data };
        debugLog.push(entry);
        logger.info(`[CONVERSATION ENGINE] ${msg}`, data);
    };
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        if (!companyId) {
            throw new Error('companyId is required');
        }
        
        if (!channel || !['phone', 'sms', 'website', 'test'].includes(channel)) {
            throw new Error('channel must be one of: phone, sms, website, test');
        }
        
        if (!userText || typeof userText !== 'string') {
            userText = ''; // Allow empty for silence/timeout handling
        }
        
        log('CHECKPOINT 1: Starting processTurn', { companyId, channel, textLength: userText.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Load company
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 2: Loading company...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            throw new Error(`Company not found: ${companyId}`);
        }
        log('CHECKPOINT 2: ✅ Company loaded', { name: company.companyName });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1.5: Load Cheat Sheets (PHASE 1 - Runtime Integration)
        // ═══════════════════════════════════════════════════════════════════
        // Cheat sheets are loaded alongside company config for:
        // - DISCOVERY: Fallback knowledge after 3-tier scenarios
        // - BOOKING: Interrupt question answers ONLY (then resume slot)
        // ═══════════════════════════════════════════════════════════════════
        let cheatSheetConfig = null;
        try {
            const { CheatSheetRuntimeService } = require('./cheatsheet');
            const cheatSheetResult = await CheatSheetRuntimeService.getLiveConfig(companyId);
            if (cheatSheetResult && cheatSheetResult.config) {
                cheatSheetConfig = cheatSheetResult.config;
                log('CHECKPOINT 2.5: ✅ Cheat sheets loaded', { 
                    versionId: cheatSheetResult.versionId,
                    hasConfig: !!cheatSheetConfig,
                    categories: Object.keys(cheatSheetConfig || {}).length
                });
            } else {
                log('CHECKPOINT 2.5: ⚠️ No cheat sheets available (non-fatal)', { companyId });
            }
        } catch (cheatSheetErr) {
            // Non-fatal - system works without cheat sheets
            log('CHECKPOINT 2.5: ⚠️ Cheat sheet load failed (non-fatal)', { 
                error: cheatSheetErr.message 
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Find or create customer
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 3: Customer lookup...');
        let customer = null;
        let isNewCustomer = false;
        
        // Generate session ID if not provided
        const sessionId = providedSessionId || 
            (channel === 'phone' && callSid) ? `call-${callSid}` :
            `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            const identifier = callerPhone || visitorInfo.phone || visitorInfo.email;
            if (identifier) {
                const result = await CustomerService.findOrCreate(
                    companyId,
                    {
                        phone: callerPhone || visitorInfo.phone,
                        email: visitorInfo.email,
                        name: visitorInfo.name,
                        sessionId
                    },
                    channel
                );
                customer = result.customer;
                isNewCustomer = result.isNew;
            }
        } catch (custErr) {
            log('Customer lookup failed (non-fatal)', { error: custErr.message });
        }
        
        log('CHECKPOINT 3: ✅ Customer done', { hasCustomer: !!customer, isNew: isNewCustomer });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Get or create session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 4: Session management...');
        
        const identifiers = channel === 'phone' 
            ? { callSid, callerPhone, calledNumber: metadata.calledNumber }
            : channel === 'sms'
            ? { smsPhone: callerPhone }
            : { sessionId, ip: visitorInfo.ip, userAgent: visitorInfo.userAgent, pageUrl: visitorInfo.pageUrl };
        
        const session = await SessionService.getOrCreate({
            companyId,
            channel,
            identifiers,
            customer,
            forceNewSession  // Test Console can force fresh session
        });
        
        log('CHECKPOINT 4: ✅ Session ready', { 
            sessionId: session._id, 
            turns: session.metrics?.totalTurns || 0,
            phase: session.phase,
            // 🔍 DIAGNOSTIC: Show what slots were already saved in this session
            existingSlots: JSON.stringify(session.collectedSlots || {}),
            isSessionReused: (session.metrics?.totalTurns || 0) > 0
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Build customer context for AI
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 5: Building customer context...');
        let customerContext;
        try {
            customerContext = customer 
                ? CustomerService.buildContextForAI(customer)
                : { isKnown: false, summary: `New ${channel} visitor` };
        } catch (ctxErr) {
            customerContext = { isKnown: false, summary: `New ${channel} visitor` };
        }
        log('CHECKPOINT 5: ✅ Customer context built');
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Build running summary (conversation memory)
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 6: Building running summary...');
        let summaryBullets = [];
        let summaryFormatted = '';
        try {
            const summaryResult = RunningSummaryService.buildAndFormat({
                previousSummary: session.runningSummary || [],
                customerContext,
                currentTurn: { userMessage: userText },
                conversationState: {
                    phase: session.phase || 'greeting',
                    knownSlots: session.collectedSlots || {},
                    signals: session.signals || {},
                    // 🆕 Include discovery and triage data for AI context
                    discovery: session.discovery || {},
                    triageState: session.triageState || {},
                    currentStage: session.conversationMemory?.currentStage || 'greeting'
                },
                company
            });
            summaryBullets = summaryResult.bullets;
            summaryFormatted = summaryResult.formatted;
        } catch (sumErr) {
            log('Running summary failed (non-fatal)', { error: sumErr.message });
        }
        log('CHECKPOINT 6: ✅ Running summary built', { bullets: summaryBullets.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Get conversation history
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 7: Getting conversation history...');
        let conversationHistory = [];
        try {
            conversationHistory = session.getHistoryForAI ? session.getHistoryForAI() : [];
        } catch (histErr) {
            log('getHistoryForAI failed (non-fatal)', { error: histErr.message });
        }
        log('CHECKPOINT 7: ✅ History retrieved', { turns: conversationHistory.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Extract slots programmatically
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 8: Extracting slots...');
        
        // ════════════════════════════════════════════════════════════════════
        // SLOT VALIDATOR - Clean up obviously invalid stored values
        // This catches corrupted data from old sessions or bad extractions
        // ════════════════════════════════════════════════════════════════════
        const rawSlots = { ...(session.collectedSlots || {}) };
        const currentSlots = {};
        
        // Validate name - reject greetings, verbs, common phrases
        if (rawSlots.name) {
            const nameLower = rawSlots.name.toLowerCase().trim();
            
            // Direct invalid names
            const invalidNames = [
                'good morning', 'good afternoon', 'good evening', 'good night',
                'hi', 'hello', 'hey', 'hi there', 'hello there', 'good',
                'morning', 'afternoon', 'evening', 'yes', 'no', 'yeah', 'yep',
                'thanks', 'thank you', 'okay', 'ok', 'sure', 'please',
                'having just', 'doing great', 'doing good', 'doing fine',
                'having some', 'having issues', 'having problems'
            ];
            
            // Words that should NEVER be in a name
            const invalidWords = [
                'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going',
                'coming', 'waiting', 'hoping', 'thinking', 'wondering', 'needing',
                'wanting', 'asking', 'dealing', 'experiencing', 'just', 'some',
                'issues', 'problems', 'trouble', 'great', 'fine', 'good', 'bad',
                // Service/trade words
                'service', 'services', 'repair', 'repairs', 'maintenance', 'conditioning',
                'air', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical',
                'appointment', 'schedule', 'booking', 'unit', 'system'
            ];
            
            // Check if name contains any invalid word
            const nameWords = nameLower.split(/\s+/);
            const hasInvalidWord = nameWords.some(w => invalidWords.includes(w));
            
            if (invalidNames.includes(nameLower) || nameLower.length < 2 || hasInvalidWord) {
                log('🚨 INVALID NAME DETECTED - clearing:', rawSlots.name);
                // Don't copy invalid name
            } else {
                currentSlots.name = rawSlots.name;
            }
        }
        
        // Validate phone - must have at least 7 digits
        if (rawSlots.phone) {
            const digitsOnly = rawSlots.phone.replace(/\D/g, '');
            if (digitsOnly.length >= 7) {
                currentSlots.phone = rawSlots.phone;
            } else {
                log('🚨 INVALID PHONE DETECTED - clearing:', rawSlots.phone);
            }
        }
        
        // Copy other slots as-is (address, time, etc.)
        if (rawSlots.address) currentSlots.address = rawSlots.address;
        if (rawSlots.time) currentSlots.time = rawSlots.time;
        if (rawSlots.partialName) currentSlots.partialName = rawSlots.partialName;
        
        // Copy any other custom slots
        for (const key of Object.keys(rawSlots)) {
            if (!['name', 'phone', 'address', 'time', 'partialName'].includes(key)) {
                currentSlots[key] = rawSlots[key];
            }
        }
        
        log('CHECKPOINT 8a: Slots after validation', { 
            raw: JSON.stringify(rawSlots), 
            validated: JSON.stringify(currentSlots) 
        });
        
        // If validation cleared any invalid slots, update the session to persist the cleanup
        const slotsWereCleaned = JSON.stringify(rawSlots) !== JSON.stringify(currentSlots);
        if (slotsWereCleaned) {
            log('🧹 CLEANING SESSION - Invalid slots were removed');
            session.collectedSlots = currentSlots;
            // Save immediately so the cleanup persists
            try {
                await session.save();
                log('✅ Session cleaned and saved');
            } catch (saveErr) {
                log('⚠️ Failed to save cleaned session (non-fatal)', { error: saveErr.message });
            }
        }
        
        const extractedThisTurn = {};
        
        // Get booking config for askMissingNamePart setting
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const nameSlotConfig = bookingConfig.slots.find(s => s.slotId === 'name' || s.id === 'name');
        const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;
        
        // Extract name
        // ═══════════════════════════════════════════════════════════════════════
        // NAME CORRECTION LOGIC: Allow explicit "my name is X" to override
        // even if a name was already extracted (could have been wrong)
        // ═══════════════════════════════════════════════════════════════════════
        if (userText) {
            const userTextLower = userText.toLowerCase();
            const isExplicitNameStatement = /my name is|name is|i'm called|call me/i.test(userText);
            
            if (currentSlots.name && !isExplicitNameStatement) {
                // Name already collected and user is NOT explicitly stating their name
            log('📝 Name already collected:', currentSlots.name);
            } else {
            log('🔍 Attempting name extraction from:', userText.substring(0, 50));
                if (currentSlots.name && isExplicitNameStatement) {
                    log('🔄 User explicitly stating name - will override previous:', currentSlots.name);
                }
                
            const extractedName = SlotExtractors.extractName(userText);
            log('🔍 Extraction result:', extractedName || '(none)');
                
            if (extractedName) {
                const isPartialName = !extractedName.includes(' ');
                const alreadyAskedForMissingPart = session.askedForMissingNamePart === true;
                
                if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart) {
                    // Store partial, let AI ask for full name
                    currentSlots.partialName = extractedName;
                    extractedThisTurn.partialName = extractedName;
                    log('Partial name detected (will ask for full)', { partialName: extractedName });
                } else {
                    // Accept name as-is
                    if (currentSlots.partialName && isPartialName) {
                        currentSlots.name = `${currentSlots.partialName} ${extractedName}`;
                        delete currentSlots.partialName;
                    } else {
                        currentSlots.name = extractedName;
                    }
                    extractedThisTurn.name = currentSlots.name;
                    log('Name extracted', { name: currentSlots.name });
                }
            } else if (currentSlots.partialName) {
                // Accept partial as complete (only ask once)
                currentSlots.name = currentSlots.partialName;
                delete currentSlots.partialName;
                extractedThisTurn.name = currentSlots.name;
                log('Accepting partial name as complete', { name: currentSlots.name });
                }
            }
        }
        
        // Extract phone
        if (!currentSlots.phone && userText) {
            const extractedPhone = SlotExtractors.extractPhone(userText);
            if (extractedPhone) {
                currentSlots.phone = extractedPhone;
                extractedThisTurn.phone = extractedPhone;
                log('Phone extracted', { phone: extractedPhone });
            }
        }
        
        // Extract address
        if (!currentSlots.address && userText) {
            const extractedAddress = SlotExtractors.extractAddress(userText);
            if (extractedAddress) {
                currentSlots.address = extractedAddress;
                extractedThisTurn.address = extractedAddress;
                log('Address extracted', { address: extractedAddress });
            }
        }
        
        // Extract time preference
        if (!currentSlots.time && userText) {
            const extractedTime = SlotExtractors.extractTime(userText);
            if (extractedTime) {
                currentSlots.time = extractedTime;
                extractedThisTurn.time = extractedTime;
                log('Time extracted', { time: extractedTime });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // PARTIAL NAME HANDLING - Check booking config for askFullName setting
        // ═══════════════════════════════════════════════════════════════════════
        // If askFullName is enabled in booking config, we DON'T auto-promote
        // partial names. Instead, the booking safety net will ask for last name.
        // ═══════════════════════════════════════════════════════════════════════
        const isInBookingMode = session.mode === 'BOOKING' || session.booking?.consentGiven;
        
        // Check if askFullName is enabled in booking config
        const bookingConfigCheck = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const nameSlotCheck = (bookingConfigCheck.slots || []).find(s => 
            (s.slotId || s.id || s.type) === 'name'
        );
        // 🎯 PROMPT AS LAW: Default askFullName to FALSE
        // Only ask for last name if UI explicitly requires it
        const askFullNameEnabled = nameSlotCheck?.nameOptions?.askFullName === true || 
                                   nameSlotCheck?.nameOptions?.requireFullName === true;
        
        if (currentSlots.partialName && !currentSlots.name) {
            if (isInBookingMode && !askFullNameEnabled) {
                // In booking mode with askFullName OFF: promote partial to full name
                currentSlots.name = currentSlots.partialName;
                extractedThisTurn.name = currentSlots.partialName;
                log('📝 PARTIAL NAME PROMOTED: askFullName is OFF, accepting partial', {
                    partialName: currentSlots.partialName,
                    promotedTo: currentSlots.name
                });
            } else if (isInBookingMode && askFullNameEnabled) {
                // In booking mode with askFullName ON: keep as partial, will ask for last name
                // Mark it as extracted so the safety net knows to handle it
                extractedThisTurn.name = currentSlots.partialName;
                log('📝 PARTIAL NAME: askFullName is ON, will ask for last name', {
                    partialName: currentSlots.partialName
                });
            }
            // In discovery mode: keep as partial, will ask for full name later
        }
        
        const willAskForMissingNamePart = currentSlots.partialName && !currentSlots.name && !isInBookingMode;
        log('CHECKPOINT 8: ✅ Slots extracted', { 
            currentSlots: JSON.stringify(currentSlots),
            extractedThisTurn: JSON.stringify(extractedThisTurn),
            willAskForMissingNamePart,
            isInBookingMode
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 8: OPTION 1 - LLM SPEAKS UNTIL CONSENT
        // ═══════════════════════════════════════════════════════════════════════
        // 
        // ARCHITECTURE (V8 - OPTION 1):
        // - session.mode = DISCOVERY | SUPPORT | BOOKING | COMPLETE | ERROR
        // - DISCOVERY/SUPPORT: LLM ALWAYS SPEAKS (state machine provides guidance)
        // - BOOKING: Only after explicit consent (deterministic prompts)
        // - Consent detected via UI-configured phrases (detectionTriggers.wantsBooking[])
        // 
        // THE CORE PRINCIPLE:
        // "The LLM is the receptionist. The booking system is the clipboard.
        //  The clipboard stays hidden until the caller asks for it."
        // ═══════════════════════════════════════════════════════════════════════
        log('CHECKPOINT 9: Option 1 Mode Control...');
        
        // Initialize session.booking if not set
        if (!session.booking) {
            session.booking = { consentGiven: false };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // MODE RESTORATION - Restore mode from session state
        // Priority: COMPLETE > BOOKING (if consent given) > DISCOVERY
        // ═══════════════════════════════════════════════════════════════════════
        if (session.booking.completedAt || session.mode === 'COMPLETE') {
            // 🔒 COMPLETE MODE LOCK: Booking already finalized
            // Never re-ask slots after completion
            session.mode = 'COMPLETE';
            log('✅ MODE RESTORED: Booking already COMPLETE - will not re-ask slots');
        } else if (session.booking.consentGiven) {
            session.mode = 'BOOKING';
            log('📋 MODE RESTORED: Consent was given previously, restoring BOOKING mode');
        } else if (!session.mode) {
            session.mode = 'DISCOVERY';
            log('🔍 MODE INITIALIZED: Starting in DISCOVERY mode');
        }
        
        // 📊 DEBUG SNAPSHOT: Log slot state at start of turn
        log('📊 SLOT STATE SNAPSHOT (start of turn)', {
            mode: session.mode,
            activeSlot: session.booking?.activeSlot,
            slotsNormalized: currentSlots,
            nameMeta: session.booking?.meta?.name,
            consentGiven: session.booking?.consentGiven,
            completedAt: session.booking?.completedAt
        });
        
        // Declare aiResult early so booking snap can set it
        let aiResult = null;
        let aiLatencyMs = 0;
        const aiStartTime = Date.now();
        
        // ═══════════════════════════════════════════════════════════════════════
        // CONSENT DETECTION - Check if caller explicitly wants to book
        // ═══════════════════════════════════════════════════════════════════════
        const consentCheck = ConsentDetector.checkForConsent(userText, company, session);
        
        if (consentCheck.hasConsent && !session.booking.consentGiven) {
            // 🎯 CONSENT GIVEN - Transition to BOOKING mode
            session.booking.consentGiven = true;
            session.booking.consentPhrase = consentCheck.matchedPhrase;
            session.booking.consentTurn = (session.metrics?.totalTurns || 0) + 1;
            session.booking.consentTimestamp = new Date();
            session.mode = 'BOOKING';
            
            // Store discovery summary before switching to booking
            session.discoverySummary = session.discovery?.issue || 
                                       session.conversationMemory?.summary || 
                                       'Caller wants to schedule service';
            
            log('🎯 CONSENT DETECTED - Transitioning to BOOKING mode', {
                matchedPhrase: consentCheck.matchedPhrase,
                reason: consentCheck.reason,
                turn: session.booking.consentTurn,
                discoverySummary: session.discoverySummary
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING SNAP: Return first booking question IMMEDIATELY
            // ═══════════════════════════════════════════════════════════════════
            // This is the "clipboard snap" - we don't let LLM freestyle anymore.
            // We use the EXACT question from the booking panel.
            // ═══════════════════════════════════════════════════════════════════
            const bookingConfigSnap = BookingScriptEngine.getBookingSlotsFromCompany(company);
            const bookingSlotsSnap = bookingConfigSnap.slots || [];
            
            // Find first required slot that's not collected
            const firstMissingSlot = bookingSlotsSnap.find(slot => {
                const slotId = slot.slotId || slot.id || slot.type;
                const isCollected = currentSlots[slotId] || currentSlots[slot.type];
                return slot.required && !isCollected;
            });
            
            if (firstMissingSlot) {
                const slotId = firstMissingSlot.slotId || firstMissingSlot.id || firstMissingSlot.type;
                session.booking.currentSlotId = slotId;
                session.booking.currentSlotQuestion = firstMissingSlot.question;
                
                // Build acknowledgment + exact question
                const ack = "Perfect! Let me get your information.";
                const exactQuestion = firstMissingSlot.question;
            
            aiLatencyMs = Date.now() - aiStartTime;
            
                log('📋 BOOKING SNAP: Asking first slot immediately', {
                    slotId,
                    question: exactQuestion
                });
                
                aiResult = {
                    reply: `${ack} ${exactQuestion}`,
                    conversationMode: 'booking',
                    intent: 'booking',
                    nextGoal: `COLLECT_${slotId.toUpperCase()}`,
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: true,
                        consentGiven: true,
                        bookingJustStarted: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // 🎯 0 tokens - deterministic!
                    fromStateMachine: true,
                    mode: 'BOOKING',
                    debug: {
                        source: 'BOOKING_SNAP',
                        stage: 'booking',
                        step: slotId,
                        firstSlotQuestion: exactQuestion
                    }
                };
            }
        }
        
        log('CHECKPOINT 9a: Mode state', {
            mode: session.mode,
            consentGiven: session.booking?.consentGiven,
            consentPhrase: session.booking?.consentPhrase,
            consentCheck,
            bookingSnapTriggered: !!aiResult
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V22 KILL SWITCHES - Read from company config (UI-controlled)
        // ═══════════════════════════════════════════════════════════════════════
        const discoveryConsent = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const killSwitches = {
            // If true: Booking REQUIRES explicit consent (default: true)
            bookingRequiresConsent: discoveryConsent.bookingRequiresExplicitConsent !== false,
            // If true: LLM ALWAYS speaks during discovery (default: true)
            forceLLMDiscovery: discoveryConsent.forceLLMDiscovery !== false,
            // If true: Scenarios are context only, never verbatim (default: true)
            disableScenarioAutoResponses: discoveryConsent.disableScenarioAutoResponses !== false
        };
        
        log('CHECKPOINT 9a: 🔒 Kill switches loaded', killSwitches);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BOOKING SNAP CHECK - If we already have a response from consent snap, skip AI
        // ═══════════════════════════════════════════════════════════════════════
        // KILL SWITCH ENFORCEMENT: If bookingRequiresConsent is ON, 
        // booking mode is ONLY allowed if consent was explicitly given
        const canEnterBooking = !killSwitches.bookingRequiresConsent || session.booking?.consentGiven;
        
        if (aiResult && aiResult.debug?.source === 'BOOKING_SNAP') {
            log('⚡ BOOKING SNAP: Skipping AI routing - using snap response');
            // aiResult is already set, skip to save/return
        }
        // ═══════════════════════════════════════════════════════════════════════
        // COMPLETE MODE - Booking already finalized, handle post-completion Q&A
        // ═══════════════════════════════════════════════════════════════════════
        else if (session.mode === 'COMPLETE') {
            log('✅ COMPLETE MODE: Booking already finalized, handling post-completion');
            
            // Check if user wants to start a NEW booking
            const wantsNewBooking = /\b(another|new|different|schedule|book)\s*(appointment|service|call)?\b/i.test(userText);
            
            if (wantsNewBooking) {
                // Reset for new booking
                log('🔄 COMPLETE MODE: User wants NEW booking, resetting');
                session.mode = 'DISCOVERY';
                session.booking = { consentGiven: false };
                // Fall through to discovery mode
            } else {
                // Answer post-completion questions using LLM + scenarios/cheat sheets
                // But NEVER re-ask booking slots
                const llmResult = await HybridReceptionistLLM.processConversation({
                    company,
                    callContext: {
                        callId: session._id.toString(),
                        companyId,
                        customerContext,
                        runningSummary: summaryFormatted,
                        turnCount: (session.metrics?.totalTurns || 0) + 1,
                        channel,
                        enterpriseContext: {
                            mode: 'POST_BOOKING_QA',
                            bookingComplete: true,
                            collectedSlots: currentSlots
                        }
                    },
                    currentMode: 'complete',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                aiResult = {
                    reply: llmResult.reply || "Is there anything else I can help you with today?",
                    conversationMode: 'complete',
                    intent: 'post_booking_qa',
                    nextGoal: 'END_CALL',
                    filledSlots: currentSlots,
                    signals: { bookingComplete: true },
                    latencyMs: Date.now() - aiStartTime,
                    tokensUsed: llmResult.tokensUsed || 0,
                    fromStateMachine: false,
                    mode: 'COMPLETE',
                    debug: {
                        source: 'POST_BOOKING_QA',
                        stage: 'complete'
                    }
                };
            }
        }
        // ═══════════════════════════════════════════════════════════════════════
        // MODE-BASED ROUTING (THE CORE OF OPTION 1)
        // ═══════════════════════════════════════════════════════════════════════
        else if (session.mode === 'BOOKING' && canEnterBooking) {
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING MODE - Deterministic clipboard (consent already given)
            // ═══════════════════════════════════════════════════════════════════
            // In V22, we DO NOT use the state machine for booking responses.
            // The state machine was generating bad responses like "I'm sorry to hear that"
            // which is discovery language, not booking language.
            // 
            // Instead, we use the BOOKING SAFETY NET directly which:
            // 1. Reads the booking slot config from UI
            // 2. Uses the exact questions and confirmBack templates
            // 3. Handles name slot with askFullName logic
            // 4. Never re-asks the same slot
            // ═══════════════════════════════════════════════════════════════════
            log('CHECKPOINT 9b: 📋 BOOKING MODE (deterministic - no state machine)');
            
            // ═══════════════════════════════════════════════════════════════════
            // STRICT INTERRUPT DETECTION (from brainstorming doc)
            // ═══════════════════════════════════════════════════════════════════
            // Must be a REAL question, not just containing "is" or "can"
            // "My name is John" should NOT trigger interrupt
            // "What's the soonest?" SHOULD trigger interrupt
            // ═══════════════════════════════════════════════════════════════════
            const userTextTrimmed = userText.trim();
            const userTextLower = userTextTrimmed.toLowerCase();
            
            // Rule 1: Contains question mark = definitely a question
            const hasQuestionMark = userTextTrimmed.endsWith('?');
            
            // Rule 2: Starts with question words (but NOT "is" alone - too broad)
            const startsWithQuestionWord = /^(what|when|where|why|how|can you|could you|do you|does|are you|will you)\b/i.test(userTextTrimmed);
            
            // Rule 3: Contains booking-interrupt keywords (pricing, availability, etc.)
            const hasInterruptKeywords = /\b(soonest|earliest|available|price|cost|how much|warranty|hours|open|close)\b/i.test(userTextLower);
            
            // Rule 4: EXCLUDE if it looks like a slot answer
            const looksLikeSlotAnswer = /^(my name|name is|i'm|it's|call me|yes|yeah|no|nope)/i.test(userTextTrimmed) ||
                                        /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(userTextTrimmed) || // phone
                                        /^\d+\s+\w+/.test(userTextTrimmed); // address
            
            const looksLikeQuestion = (hasQuestionMark || startsWithQuestionWord || hasInterruptKeywords) && !looksLikeSlotAnswer;
            
            log('📝 INTERRUPT CHECK', {
                userText: userTextTrimmed.substring(0, 50),
                hasQuestionMark,
                startsWithQuestionWord,
                hasInterruptKeywords,
                looksLikeSlotAnswer,
                looksLikeQuestion
            });
            
            if (looksLikeQuestion && !extractedThisTurn.name && !extractedThisTurn.phone && 
                !extractedThisTurn.address && !extractedThisTurn.time) {
                // Caller went off-rails during booking (asked a question, etc.)
                // LLM handles it, then returns to booking slot
                log('CHECKPOINT 9c: 🔄 Booking interruption - checking cheat sheets first');
                
                // Get the next slot question for bridging back (MUST RESUME THIS EXACT PROMPT)
                const bookingConfigInt = BookingScriptEngine.getBookingSlotsFromCompany(company);
                const bookingSlotsInt = bookingConfigInt.slots || [];
                const nextMissingSlotInt = bookingSlotsInt.find(slot => {
                    const slotId = slot.slotId || slot.id || slot.type;
                    const isCollected = currentSlots[slotId] || currentSlots[slot.type];
                    return slot.required && !isCollected;
                });
                const nextSlotQuestion = nextMissingSlotInt?.question || 'What else can I help you with?';
                
                // ═══════════════════════════════════════════════════════════════════
                // PHASE 1: CHEAT SHEET FOR BOOKING INTERRUPTS
                // ═══════════════════════════════════════════════════════════════════
                // Pattern: Answer from cheat sheet → Resume EXACT slot prompt
                // Cheat sheets MUST NOT:
                // - Change slot order
                // - Introduce new questions
                // - Skip required slots
                // ═══════════════════════════════════════════════════════════════════
                let bookingInterruptCheatSheet = null;
                let bookingCheatSheetUsed = false;
                
                if (cheatSheetConfig) {
                    bookingInterruptCheatSheet = searchCheatSheets(cheatSheetConfig, userText);
                    if (bookingInterruptCheatSheet) {
                        bookingCheatSheetUsed = true;
                        log('CHECKPOINT 9c.1: 📋 Cheat sheet found for booking interrupt', {
                            question: bookingInterruptCheatSheet.question,
                            category: bookingInterruptCheatSheet.category,
                            willResumeSlot: nextSlotQuestion.substring(0, 50)
                        });
                        
                        // FAST PATH: Use cheat sheet answer directly + resume slot
                        // This is faster than LLM and more predictable
                        const cheatSheetAnswer = bookingInterruptCheatSheet.answer;
                        const finalReply = `${cheatSheetAnswer}\n\n${nextSlotQuestion}`;
                        
                        aiResult = {
                            reply: finalReply,
                            conversationMode: 'booking',
                            intent: 'booking_interrupt_cheatsheet',
                            nextGoal: `COLLECT_${(nextMissingSlotInt?.slotId || nextMissingSlotInt?.id || 'INFO').toUpperCase()}`,
                            filledSlots: currentSlots,
                            signals: { 
                                wantsBooking: true,
                                consentGiven: true
                            },
                            latencyMs: Date.now() - aiStartTime,
                            tokensUsed: 0,  // No LLM used!
                            fromStateMachine: true,
                            mode: 'BOOKING',
                            debug: {
                                source: 'BOOKING_INTERRUPT_CHEATSHEET',
                                cheatSheetUsed: true,
                                cheatSheetReason: 'booking_interrupt',
                                cheatSheetCategory: bookingInterruptCheatSheet.category,
                                resumedSlot: nextMissingSlotInt?.slotId || nextMissingSlotInt?.id,
                                resumedPrompt: nextSlotQuestion
                            }
                        };
                        
                        log('CHECKPOINT 9c.2: ✅ Cheat sheet interrupt handled, resuming slot', {
                            cheatSheetUsed: true,
                            resumedSlot: nextMissingSlotInt?.slotId,
                            replyPreview: finalReply.substring(0, 100)
                        });
                    }
                }
                
                // If no cheat sheet match, fall back to LLM
                if (!bookingCheatSheetUsed) {
                    log('CHECKPOINT 9c.3: 📝 No cheat sheet match, using LLM for interrupt');
                
                const llmResult = await HybridReceptionistLLM.processConversation({
                    company,
                    callContext: {
                        callId: session._id.toString(),
                        companyId,
                        customerContext,
                        runningSummary: summaryFormatted,
                        turnCount: (session.metrics?.totalTurns || 0) + 1,
                        channel,
                        partialName: currentSlots.partialName || null,
                        // V22 INTERRUPT CONTEXT - Pass discovery summary + key facts
                        enterpriseContext: {
                            mode: 'BOOKING_INTERRUPTION',
                            discoverySummary: session.discoverySummary || session.discovery?.issue || 'Scheduling service',
                            keyFacts: session.keyFacts || [],
                            collectedSlots: currentSlots,
                            nextSlotQuestion: nextSlotQuestion,
                            // Tell LLM to bridge back after answering
                            bridgeBackRequired: true
                        },
                        returnToQuestion: nextSlotQuestion,
                        mode: 'BOOKING_INTERRUPTION'
                    },
                    currentMode: 'booking',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                // Bridge back to booking slot after LLM response
                const bridgePhrase = company.aiAgentSettings?.frontDeskBehavior?.offRailsRecovery?.bridgeBack?.transitionPhrase || 'Now,';
                let finalReply = llmResult.reply || '';
                
                if (nextSlotQuestion) {
                    finalReply = `${finalReply} ${bridgePhrase} ${nextSlotQuestion}`;
                }
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: finalReply,
                    conversationMode: 'booking',
                    intent: 'booking_interruption',
                    nextGoal: 'RESUME_BOOKING',
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: true,
                        consentGiven: true,
                        bookingInterruption: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: llmResult.tokensUsed || 0,
                    fromStateMachine: false,
                    mode: 'BOOKING',
                    debug: {
                        source: 'BOOKING_INTERRUPTION_LLM',
                        returnToQuestion: nextSlotQuestion,
                        cheatSheetUsed: false,
                        cheatSheetReason: null
                    }
                };
                }  // End of if (!bookingCheatSheetUsed)
            } else {
                // ═══════════════════════════════════════════════════════════════════
                // BOOKING MODE SAFETY NET - Deterministic slot collection
                // ═══════════════════════════════════════════════════════════════════
                // This handles:
                // 1. ConfirmBack - Use the configured template from UI
                // 2. Partial name - Ask for missing last name if askFullName enabled
                // 3. Never re-ask same slot - If we have data, move forward
                // ═══════════════════════════════════════════════════════════════════
                log('⚠️ BOOKING MODE SAFETY NET: Computing next action');
                
                const bookingConfigSafe = BookingScriptEngine.getBookingSlotsFromCompany(company);
                const bookingSlotsSafe = bookingConfigSafe.slots || [];
                
                // Initialize booking meta state for tracking confirmations
                session.booking.meta = session.booking.meta || {};
                session.booking.meta.name = session.booking.meta.name || {
                    first: null,
                    last: null,
                    needsLastName: false,
                    lastConfirmed: false,      // Did user confirm the partial name?
                    askedMissingPartOnce: false,
                    assumedSingleTokenAs: null  // "first" | "last"
                };
                
                // Track active slot for deterministic flow
                session.booking.activeSlot = session.booking.activeSlot || 'name';
                
                // Get name slot config for special handling
                const nameSlotConfig = bookingSlotsSafe.find(s => 
                    (s.slotId || s.id || s.type) === 'name'
                );
                const nameOptions = nameSlotConfig?.nameOptions || {};
                // 🎯 PROMPT AS LAW: Default askFullName to FALSE
                // Only ask for last name if UI explicitly requires it
                // UI prompt "May I have your name?" does NOT require full name
                const askFullName = nameOptions.askFullName === true || nameOptions.requireFullName === true;
                const askOnceForMissingPart = nameOptions.askOnceForMissingPart !== false;
                const confirmBackEnabled = nameSlotConfig?.confirmBack === true || nameSlotConfig?.confirmBack === 'true';
                const confirmBackTemplate = nameSlotConfig?.confirmPrompt || 'Got it, {value}. Did I get that right?';
                
                aiLatencyMs = Date.now() - aiStartTime;
                let finalReply = '';
                let nextSlotId = null;
                
                // ═══════════════════════════════════════════════════════════════════
                // NAME SLOT STATE MACHINE (from brainstorming doc)
                // ═══════════════════════════════════════════════════════════════════
                // States:
                // 1. No name → Ask for name
                // 2. partialName (single token) → Confirm back, then ask missing part
                // 3. firstName + lastName → Complete, move to phone
                // ═══════════════════════════════════════════════════════════════════
                const nameMeta = session.booking.meta.name;
                const hasPartialName = currentSlots.partialName || extractedThisTurn.name;
                const hasFullName = currentSlots.name && currentSlots.name.includes(' ');
                const hasBothParts = nameMeta.first && nameMeta.last;
                
                log('📝 NAME SLOT STATE', {
                    activeSlot: session.booking.activeSlot,
                    hasPartialName,
                    hasFullName,
                    hasBothParts,
                    nameMeta,
                    extractedThisTurn: extractedThisTurn.name,
                    currentSlotsName: currentSlots.name,
                    currentSlotsPartialName: currentSlots.partialName
                });
                
                // ═══════════════════════════════════════════════════════════════════
                // CONFIRMATION DENIAL HANDLING (from brainstorming doc)
                // If user says "no" to confirmBack, reset and ask name cleanly
                // ═══════════════════════════════════════════════════════════════════
                const userSaysNo = /^(no|nope|nah|that's wrong|wrong|incorrect|not right)/i.test(userText.trim());
                
                if (userSaysNo && nameMeta.lastConfirmed && !nameMeta.askedMissingPartOnce) {
                    // User denied the confirmBack - reset name state
                    log('📝 NAME: User denied confirmation, resetting');
                    nameMeta.first = null;
                    nameMeta.last = null;
                    nameMeta.lastConfirmed = false;
                    nameMeta.askedMissingPartOnce = false;
                    nameMeta.assumedSingleTokenAs = null;
                    currentSlots.partialName = null;
                    currentSlots.name = null;
                    
                    // Ask for name again cleanly
                    const nameSlotConfig = bookingSlotsSafe.find(s => 
                        (s.slotId || s.id || s.type) === 'name'
                    );
                    finalReply = "I apologize for the confusion. " + (nameSlotConfig?.question || "May I have your name please?");
                    nextSlotId = 'name';
                }
                // Check if name slot is already complete
                else if (hasFullName || hasBothParts) {
                    // Name is complete, move to next slot
                    if (hasBothParts && !currentSlots.name) {
                        // Build full name safely (no undefined)
                        const firstName = nameMeta.first || '';
                        const lastName = nameMeta.last || '';
                        currentSlots.name = `${firstName} ${lastName}`.trim();
                    }
                    session.booking.activeSlot = 'phone';
                    log('📝 NAME COMPLETE, moving to phone', { name: currentSlots.name });
                }
                // Check if we're in the middle of name collection
                else if (session.booking.activeSlot === 'name' && hasPartialName) {
                    const extractedName = extractedThisTurn.name || currentSlots.partialName;
                    const hasSpace = extractedName && extractedName.includes(' ');
                    
                    if (hasSpace) {
                        // Full name provided in one go
                        const parts = extractedName.split(' ');
                        nameMeta.first = parts[0];
                        nameMeta.last = parts.slice(1).join(' ');
                        currentSlots.name = extractedName;
                        session.booking.activeSlot = 'phone';
                        
                        // Confirm and move to phone
                        finalReply = `Got it, ${nameMeta.first}. `;
                        nextSlotId = null; // Will find phone below
                        
                        log('📝 NAME: Full name provided', { name: currentSlots.name });
                    } else if (!nameMeta.lastConfirmed && confirmBackEnabled) {
                        // Single token, need to confirm back first
                        nameMeta.lastConfirmed = true;
            
            // ═══════════════════════════════════════════════════════════════════
                        // SMART NAME DETECTION: Use UI-configurable common first names list
                        // to determine if single token is first or last name
                        // 
                        // UI Location: Front Desk → Booking Prompts → Names tab
                        // Admins can add regional/cultural names specific to their clientele
            // ═══════════════════════════════════════════════════════════════════
                        const commonFirstNames = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                        const commonFirstNamesSet = new Set(commonFirstNames.map(n => n.toLowerCase()));
                        const isCommonFirstName = commonFirstNamesSet.has(extractedName.toLowerCase());
                        
                        if (isCommonFirstName) {
                            // "Mark", "John", "Sarah" etc. are clearly first names
                            nameMeta.assumedSingleTokenAs = 'first';
                            nameMeta.first = extractedName;
                            log('📝 NAME: Detected as FIRST name (UI-configured name list)', { name: extractedName });
                        } else {
                            // "Subach", "Patel", "Rodriguez" are likely last names
                            nameMeta.assumedSingleTokenAs = 'last';
                            nameMeta.last = extractedName;
                            log('📝 NAME: Assumed as LAST name (not in common first names list)', { name: extractedName });
                        }
                        currentSlots.partialName = extractedName;
                        
                        const confirmText = confirmBackTemplate.replace('{value}', extractedName);
                        finalReply = confirmText;
                        nextSlotId = 'name'; // Still on name
                        
                        log('📝 NAME: Confirming partial name', { partial: extractedName });
                    } else if (nameMeta.lastConfirmed && !nameMeta.askedMissingPartOnce && askFullName) {
                        // User confirmed, now ask for missing part
                        nameMeta.askedMissingPartOnce = true;
                        
                        // Ask for the part we don't have
                        if (nameMeta.assumedSingleTokenAs === 'last') {
                            finalReply = "And what's your first name?";
        } else {
                            finalReply = "And what's your last name?";
                        }
                        nextSlotId = 'name'; // Still on name
                        
                        log('📝 NAME: Asking for missing part');
                    } else if (nameMeta.askedMissingPartOnce) {
                        // User provided the missing part
                        if (nameMeta.assumedSingleTokenAs === 'first') {
                            // We had first name (e.g., "Mark"), now got last name
                            nameMeta.last = extractedName;
                        } else {
                            // We had last name (e.g., "Subach"), now got first name
                            nameMeta.first = extractedName;
                        }
                        
                        // Build full name safely (no undefined)
                        const firstName = nameMeta.first || '';
                        const lastName = nameMeta.last || '';
                        currentSlots.name = `${firstName} ${lastName}`.trim();
                        session.booking.activeSlot = 'phone';
                        
                        // 🎯 DISPLAY NAME: Always use first name for personalization
                        // Never say "Perfect, Walter" when we have "Mark Walter"
                        const displayName = nameMeta.first || currentSlots.name.split(' ')[0] || currentSlots.name;
                        finalReply = `Perfect, ${displayName}. `;
                        nextSlotId = null; // Will find phone below
                        
                        log('📝 NAME: Got missing part, full name is', { 
                            name: currentSlots.name,
                            displayName,
                            first: nameMeta.first,
                            last: nameMeta.last
                        });
                    } else {
                        // askFullName is off, accept single name as complete
                        nameMeta.first = extractedName;
                        currentSlots.name = extractedName;
                        nameMeta.needsLastName = false;
                        
                        // Confirm and move to next slot
                        const displayName = nameMeta.first || extractedName;
                        finalReply = `Got it, ${displayName}. `;
                        nextSlotId = null; // Will find next slot below
                        
                        log('📝 NAME: Accepted as complete', { name: currentSlots.name });
                    }
                }
                // ═══════════════════════════════════════════════════════════════════
                // HANDLE OTHER SLOTS (PHONE, ADDRESS, TIME) WITH CONFIRMBACK SUPPORT
                // ═══════════════════════════════════════════════════════════════════════
                // Initialize meta tracking for all slots (not just name)
                session.booking.meta.phone = session.booking.meta.phone || { pendingConfirm: false, confirmed: false };
                session.booking.meta.address = session.booking.meta.address || { pendingConfirm: false, confirmed: false };
                session.booking.meta.time = session.booking.meta.time || { pendingConfirm: false, confirmed: false };
                
                // Check if user is responding to a confirmBack question
                const userSaysYes = /^(yes|yeah|yep|correct|that's right|right|yup|uh huh|mhm|affirmative)/i.test(userText.trim());
                const userSaysNoGeneric = /^(no|nope|nah|that's wrong|wrong|incorrect|not right)/i.test(userText.trim());
                
                // PHONE SLOT HANDLING
                if (session.booking.meta.phone.pendingConfirm && !session.booking.meta.phone.confirmed) {
                    if (userSaysYes) {
                        // User confirmed phone
                        session.booking.meta.phone.confirmed = true;
                        session.booking.meta.phone.pendingConfirm = false;
                        session.booking.activeSlot = 'address';
                        log('📞 PHONE: User confirmed, moving to address');
                        // Don't set finalReply here - let it find next slot
                    } else if (userSaysNoGeneric) {
                        // User denied - clear phone and re-ask
                        currentSlots.phone = null;
                        session.booking.meta.phone.pendingConfirm = false;
                        const phoneSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'phone');
                        finalReply = "I apologize. " + (phoneSlotConfig?.question || "What's the best phone number to reach you?");
                        nextSlotId = 'phone';
                        log('📞 PHONE: User denied confirmation, re-asking');
                    } else if (extractedThisTurn.phone) {
                        // User provided a new phone number instead of confirming
                        currentSlots.phone = extractedThisTurn.phone;
                        session.booking.meta.phone.pendingConfirm = false;
                        log('📞 PHONE: User provided new number instead of confirming');
                    }
                }
                else if (extractedThisTurn.phone && !session.booking.meta.phone.confirmed) {
                    const phoneSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'phone');
                    const phoneConfirmBack = phoneSlotConfig?.confirmBack === true || phoneSlotConfig?.confirmBack === 'true';
                    const phoneConfirmPrompt = phoneSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?";
                    
                    if (phoneConfirmBack) {
                        // Confirm back the phone number
                        session.booking.meta.phone.pendingConfirm = true;
                        const confirmText = phoneConfirmPrompt.replace('{value}', extractedThisTurn.phone);
                        finalReply = confirmText;
                        nextSlotId = 'phone'; // Stay on phone until confirmed
                        log('📞 PHONE: Confirming back', { phone: extractedThisTurn.phone });
                    } else {
                        // No confirmBack - accept and move on
                        session.booking.meta.phone.confirmed = true;
                        session.booking.activeSlot = 'address';
                        finalReply = 'Got it. ';
                        log('📞 PHONE: Accepted (no confirmBack)', { phone: extractedThisTurn.phone });
                    }
                }
                // ADDRESS SLOT HANDLING  
                else if (session.booking.meta.address.pendingConfirm && !session.booking.meta.address.confirmed) {
                    if (userSaysYes) {
                        session.booking.meta.address.confirmed = true;
                        session.booking.meta.address.pendingConfirm = false;
                        session.booking.activeSlot = 'time';
                        log('🏠 ADDRESS: User confirmed, moving to time');
                    } else if (userSaysNoGeneric) {
                        currentSlots.address = null;
                        session.booking.meta.address.pendingConfirm = false;
                        const addressSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'address');
                        finalReply = "I apologize. " + (addressSlotConfig?.question || "What's the service address?");
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: User denied confirmation, re-asking');
                    } else if (extractedThisTurn.address) {
                        currentSlots.address = extractedThisTurn.address;
                        session.booking.meta.address.pendingConfirm = false;
                        log('🏠 ADDRESS: User provided new address instead of confirming');
                    }
                }
                else if (extractedThisTurn.address && !session.booking.meta.address.confirmed) {
                    const addressSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'address');
                    const addressConfirmBack = addressSlotConfig?.confirmBack === true || addressSlotConfig?.confirmBack === 'true';
                    const addressConfirmPrompt = addressSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?";
                    
                    if (addressConfirmBack) {
                        session.booking.meta.address.pendingConfirm = true;
                        const confirmText = addressConfirmPrompt.replace('{value}', extractedThisTurn.address);
                        finalReply = confirmText;
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: Confirming back', { address: extractedThisTurn.address });
                    } else {
                        session.booking.meta.address.confirmed = true;
                        session.booking.activeSlot = 'time';
                        finalReply = 'Perfect. ';
                        log('🏠 ADDRESS: Accepted (no confirmBack)', { address: extractedThisTurn.address });
                    }
                }
                // TIME SLOT HANDLING
                else if (session.booking.meta.time.pendingConfirm && !session.booking.meta.time.confirmed) {
                    if (userSaysYes) {
                        session.booking.meta.time.confirmed = true;
                        session.booking.meta.time.pendingConfirm = false;
                        log('⏰ TIME: User confirmed');
                    } else if (userSaysNoGeneric) {
                        currentSlots.time = null;
                        session.booking.meta.time.pendingConfirm = false;
                        const timeSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'time');
                        finalReply = "No problem. " + (timeSlotConfig?.question || "When works best for you?");
                        nextSlotId = 'time';
                        log('⏰ TIME: User denied confirmation, re-asking');
                    } else if (extractedThisTurn.time) {
                        currentSlots.time = extractedThisTurn.time;
                        session.booking.meta.time.pendingConfirm = false;
                        log('⏰ TIME: User provided new time instead of confirming');
                    }
                }
                else if (extractedThisTurn.time && !session.booking.meta.time.confirmed) {
                    const timeSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'time');
                    const timeConfirmBack = timeSlotConfig?.confirmBack === true || timeSlotConfig?.confirmBack === 'true';
                    const timeConfirmPrompt = timeSlotConfig?.confirmPrompt || "Just to confirm, {value} works for you?";
                    
                    if (timeConfirmBack) {
                        session.booking.meta.time.pendingConfirm = true;
                        const confirmText = timeConfirmPrompt.replace('{value}', extractedThisTurn.time);
                        finalReply = confirmText;
                        nextSlotId = 'time';
                        log('⏰ TIME: Confirming back', { time: extractedThisTurn.time });
                    } else {
                        session.booking.meta.time.confirmed = true;
                        finalReply = 'Great. ';
                        log('⏰ TIME: Accepted (no confirmBack)', { time: extractedThisTurn.time });
                    }
                }
            // ═══════════════════════════════════════════════════════════════════
                // PARTIAL ANSWER NUDGE - User started but didn't complete
                // "my service address is" without actual address → gentle nudge
            // ═══════════════════════════════════════════════════════════════════
                else {
                    const userTextLower = userText.toLowerCase().trim();
                    const isPartialAddress = /^(my\s+)?(service\s+)?address\s+(is|would be|at)/i.test(userTextLower) && 
                                            userTextLower.length < 30;
                    const isPartialPhone = /^(my\s+)?(phone|number|cell)\s+(is|number)/i.test(userTextLower) && 
                                          userTextLower.length < 25;
                    const isPartialName = /^(my\s+)?name\s+(is|would be)/i.test(userTextLower) && 
                                         userTextLower.length < 20;
                    
                    if (isPartialAddress) {
                        finalReply = "No problem — go ahead with the street address, and include unit number if you have one. ";
                        log('📝 NUDGE: Partial address detected, giving gentle nudge');
                    } else if (isPartialPhone) {
                        finalReply = "Sure — go ahead with the area code first. ";
                        log('📝 NUDGE: Partial phone detected, giving gentle nudge');
                    } else if (isPartialName) {
                        finalReply = "Sure — go ahead. ";
                        log('📝 NUDGE: Partial name detected, giving gentle nudge');
                    }
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // Find next required slot (if we're not still on current slot)
                // IMPORTANT: A slot is only "complete" if:
                // 1. It's collected AND
                // 2. It's NOT pending confirmation (if confirmBack is enabled)
                // ═══════════════════════════════════════════════════════════════════
                if (nextSlotId === null) {
                    const nextMissingSlotSafe = bookingSlotsSafe.find(slot => {
                        const slotId = slot.slotId || slot.id || slot.type;
                        const isCollected = currentSlots[slotId] || currentSlots[slot.type];
                        
                        // Check if this slot is pending confirmation
                        const slotMeta = session.booking.meta[slotId] || {};
                        const isPendingConfirm = slotMeta.pendingConfirm === true;
                        
                        // Slot is incomplete if: not collected OR pending confirmation
                        const isIncomplete = !isCollected || isPendingConfirm;
                        
                        return slot.required && isIncomplete;
                    });
                    
                    if (nextMissingSlotSafe) {
                        nextSlotId = nextMissingSlotSafe.slotId || nextMissingSlotSafe.id || nextMissingSlotSafe.type;
                        const exactQuestion = nextMissingSlotSafe.question;
                        
                        // Check if we're waiting for confirmation (don't re-ask the question)
                        const slotMeta = session.booking.meta[nextSlotId] || {};
                        if (!slotMeta.pendingConfirm) {
                            // Not pending confirm, ask the question
                            finalReply += exactQuestion;
                            log('📋 BOOKING SAFETY NET: Asking next slot', { 
                                slotId: nextSlotId, 
                                question: exactQuestion,
                                finalReply
                            });
                        } else {
                            // Pending confirm - don't add question, just use the confirm text already set
                            log('📋 BOOKING SAFETY NET: Slot pending confirmation', { 
                                slotId: nextSlotId,
                                finalReply
                            });
                        }
                    }
                }
                
                if (nextSlotId) {
                    // Save session state before responding (persist mode + booking meta)
                    session.markModified('booking');
                
                aiResult = {
                        reply: finalReply,
                        conversationMode: 'booking',
                        intent: 'booking',
                        nextGoal: `COLLECT_${nextSlotId.toUpperCase()}`,
                    filledSlots: currentSlots,
                        signals: { 
                            wantsBooking: true,
                            consentGiven: true
                        },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,
                    fromStateMachine: true,
                        mode: 'BOOKING',
                        debug: {
                            source: 'BOOKING_SAFETY_NET',
                            stage: 'booking',
                            step: nextSlotId,
                            nameMeta: session.booking.meta.name,
                            extractedThisTurn
                        }
                    };
                } else {
                    // ═══════════════════════════════════════════════════════════════
                    // ALL REQUIRED SLOTS COLLECTED - FINALIZE BOOKING
                    // ═══════════════════════════════════════════════════════════════
                    // Use the configurable Booking Outcome system:
                    // - Creates BookingRequest record
                    // - Returns UI-configured final script
                    // - No hardcoded "technician will reach out" unless enabled
                    // ═══════════════════════════════════════════════════════════════
                    log('✅ BOOKING COMPLETE: All required slots collected - finalizing');
                    
                    // Finalize booking with configurable outcome
                    const finalizationResult = await finalizeBooking(session, company, currentSlots, {
                        channel,
                        callSid: metadata?.callSid || null,
                        callerPhone: callerPhone || null,
                        serviceType: session.discovery?.serviceType || null
                    });
                    
                    log('📋 BOOKING FINALIZED', {
                        success: finalizationResult.success,
                        bookingRequestId: finalizationResult.bookingRequestId,
                        caseId: finalizationResult.caseId,
                        outcomeMode: finalizationResult.outcomeMode,
                        isAsap: finalizationResult.isAsap,
                        requiresTransfer: finalizationResult.requiresTransfer
                    });
                    
                    session.mode = 'COMPLETE';
                    session.booking.completedAt = new Date();
                    session.booking.bookingRequestId = finalizationResult.bookingRequestId;
                    session.markModified('booking');
                
                aiResult = {
                        reply: finalizationResult.finalScript,
                        conversationMode: 'complete',
                        intent: 'booking_complete',
                        nextGoal: finalizationResult.requiresTransfer ? 'TRANSFER' : 'END_CALL',
                    filledSlots: currentSlots,
                        signals: { 
                            wantsBooking: true,
                            consentGiven: true,
                            bookingComplete: true,
                            requiresTransfer: finalizationResult.requiresTransfer
                        },
                        latencyMs: Date.now() - aiStartTime,
                    tokensUsed: 0,
                    fromStateMachine: true,
                        mode: 'COMPLETE',
                        debug: {
                            source: 'BOOKING_COMPLETE_FINALIZED',
                            stage: 'complete',
                            collectedSlots: Object.keys(currentSlots).filter(k => currentSlots[k]),
                            // V23 Booking Outcome tracking
                            bookingRequestId: finalizationResult.bookingRequestId,
                            caseId: finalizationResult.caseId,
                            outcomeMode: finalizationResult.outcomeMode,
                            isAsap: finalizationResult.isAsap,
                            status: finalizationResult.status
                        }
                    };
                }
            }
            } else {
            // ═══════════════════════════════════════════════════════════════════
            // V22: LLM-LED DISCOVERY MODE
            // ═══════════════════════════════════════════════════════════════════
            // 
            // THE GOLDEN RULE: "Nothing should bypass the LLM during discovery."
            // 
            // KILL SWITCH ENFORCEMENT:
            // - forceLLMDiscovery = true → LLM ALWAYS speaks (no state machine)
            // - disableScenarioAutoResponses = true → Scenarios are context only
            // 
            // FLOW:
            // 1. Retrieve relevant scenarios (TOOLS, not scripts)
            // 2. Detect caller emotion (lightweight heuristic)
            // 3. Build LLM prompt with scenario knowledge
            // 4. LLM responds naturally using the knowledge
            // 5. Check for consent (if detected, next turn = BOOKING)
            // 
            // The LLM is the PRIMARY BRAIN. Scenarios are just knowledge tools.
            // ═══════════════════════════════════════════════════════════════════
            
            // ENFORCE: forceLLMDiscovery kill switch
            if (!killSwitches.forceLLMDiscovery) {
                log('⚠️ WARNING: forceLLMDiscovery is OFF - legacy mode may bypass LLM');
            }
            
            log('CHECKPOINT 9b: 🧠 V22 LLM-LED DISCOVERY MODE', {
                forceLLMDiscovery: killSwitches.forceLLMDiscovery,
                disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
            });
            
            // Step 1: Retrieve relevant scenarios as knowledge tools
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeTemplate = templateRefs.find(ref => ref.enabled !== false);
            
            const scenarioRetrieval = await LLMDiscoveryEngine.retrieveRelevantScenarios({
                companyId,
                trade: company.trade || 'HVAC',
                utterance: userText,
                template: activeTemplate
            });
            
            log('CHECKPOINT 9c: 📚 Scenarios retrieved as tools', {
                count: scenarioRetrieval.scenarios?.length || 0,
                retrievalTimeMs: scenarioRetrieval.retrievalTimeMs,
                topScenario: scenarioRetrieval.scenarios?.[0]?.title
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // Step 1.5: CHEAT SHEET FALLBACK (PHASE 1)
            // ═══════════════════════════════════════════════════════════════════
            // Order of precedence for DISCOVERY knowledge:
            // 1. 3-Tier Scenarios (primary)
            // 2. Cheat Sheets (fallback)
            // 3. Generic LLM (last resort)
            // ═══════════════════════════════════════════════════════════════════
            let cheatSheetKnowledge = null;
            let cheatSheetUsed = false;
            let cheatSheetReason = null;
            
            // Only use cheat sheets as fallback if no strong scenario match
            const hasStrongScenarioMatch = scenarioRetrieval.scenarios?.length > 0 && 
                                           scenarioRetrieval.scenarios[0]?.confidence > 0.6;
            
            if (!hasStrongScenarioMatch && cheatSheetConfig) {
                // Search cheat sheets for relevant content
                const cheatSheetMatch = searchCheatSheets(cheatSheetConfig, userText);
                if (cheatSheetMatch) {
                    cheatSheetKnowledge = cheatSheetMatch;
                    cheatSheetUsed = true;
                    cheatSheetReason = 'discovery_fallback';
                    log('CHECKPOINT 9c.1: 📋 Cheat sheet fallback activated', {
                        category: cheatSheetMatch.category,
                        matchedItem: cheatSheetMatch.title || cheatSheetMatch.question,
                        reason: cheatSheetReason
                    });
                }
            }
            
            // Step 2: Detect caller emotion (lightweight, no LLM)
            const emotion = LLMDiscoveryEngine.detectEmotion(userText);
            
            log('CHECKPOINT 9d: 😊 Emotion detected', {
                emotion: emotion.emotion,
                confidence: emotion.confidence
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // 🚀 FAST-PATH BOOKING DETECTION (V24)
            // ═══════════════════════════════════════════════════════════════════
            // When caller clearly wants service NOW ("I need you out here"),
            // skip troubleshooting and offer scheduling immediately.
            // Does NOT switch to BOOKING - just changes what DISCOVERY says.
            // Booking only starts after explicit consent ("yes please").
            // ═══════════════════════════════════════════════════════════════════
            const fastPathConfig = company.aiAgentSettings?.frontDeskBehavior?.fastPathBooking || {};
            const fastPathEnabled = fastPathConfig.enabled !== false;
            const fastPathKeywords = fastPathConfig.triggerKeywords || [
                "send someone", "need you out here", "need someone out", "come out",
                "schedule", "book", "fix it", "sick of it", "just want it fixed",
                "need service", "asap", "emergency", "just send someone"
            ];
            
            // Check if user text contains any fast-path trigger keywords
            const userTextLowerFP = userText.toLowerCase();
            const fastPathTriggered = fastPathEnabled && fastPathKeywords.some(keyword => 
                userTextLowerFP.includes(keyword.toLowerCase())
            );
            
            // Track discovery question count for max-questions gate
            const discoveryQuestionCount = session.discovery?.questionCount || 0;
            const maxDiscoveryQuestions = fastPathConfig.maxDiscoveryQuestions || 2;
            const exceededMaxQuestions = discoveryQuestionCount >= maxDiscoveryQuestions;
            
            log('CHECKPOINT 9d.1: 🚀 Fast-Path Check', {
                fastPathEnabled,
                fastPathTriggered,
                matchedKeyword: fastPathTriggered ? fastPathKeywords.find(k => userTextLowerFP.includes(k.toLowerCase())) : null,
                discoveryQuestionCount,
                maxDiscoveryQuestions,
                exceededMaxQuestions
            });
            
            // If fast-path triggered, respond with offer script instead of LLM
            if (fastPathTriggered || (fastPathEnabled && exceededMaxQuestions && emotion.emotion === 'frustrated')) {
                const offerScript = fastPathConfig.offerScript || 
                    "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?";
                const oneQuestionScript = fastPathConfig.oneQuestionScript || "";
                
                // Determine response: one-question first, or straight to offer
                let fastPathResponse;
                const askedOneQuestion = session.discovery?.fastPathOneQuestionAsked;
                
                if (oneQuestionScript && !askedOneQuestion) {
                    // Ask the optional pre-question first
                    fastPathResponse = oneQuestionScript;
                    session.discovery = session.discovery || {};
                    session.discovery.fastPathOneQuestionAsked = true;
                    log('🚀 FAST-PATH: Asking pre-question before offer');
                } else {
                    // Go straight to offer
                    fastPathResponse = offerScript;
                    session.lastAgentIntent = 'OFFER_SCHEDULE';
                    log('🚀 FAST-PATH: Offering scheduling immediately');
                }
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: fastPathResponse,
                    conversationMode: 'discovery',
                    intent: 'fast_path_offer',
                    nextGoal: 'AWAIT_CONSENT',
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: false,  // Not yet - waiting for consent
                        fastPathTriggered: true,
                        offeredScheduling: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // No LLM used!
                    fromStateMachine: true,
                    mode: 'DISCOVERY',
                    debug: {
                        source: 'FAST_PATH_BOOKING',
                        stage: 'discovery',
                        fastPathReason: fastPathTriggered ? 'keyword_match' : 'max_questions_exceeded',
                        matchedKeyword: fastPathKeywords.find(k => userTextLowerFP.includes(k.toLowerCase())),
                        lastAgentIntent: session.lastAgentIntent
                    }
                };
                
                // Skip LLM call - we have our response
                log('🚀 FAST-PATH ACTIVATED: Skipping LLM, using offer script', {
                    response: fastPathResponse.substring(0, 50)
                });
            }
            
            // Only proceed with LLM if fast-path didn't trigger
            if (!aiResult) {
            // Step 3: Build discovery prompt with scenario knowledge + cheat sheet fallback
            const discoveryPrompt = LLMDiscoveryEngine.buildDiscoveryPrompt({
                company,
                scenarios: scenarioRetrieval.scenarios,
                emotion,
                session,
                // V23: Pass cheat sheet as fallback knowledge
                cheatSheetKnowledge: cheatSheetKnowledge
            });
            
            // Step 4: Build context for LLM
            const llmContext = {
                // V22: LLM-led mode
                mode: 'LLM_LED_DISCOVERY',
                
                // Scenario knowledge (tools, not scripts)
                // KILL SWITCH: disableScenarioAutoResponses controls how scenarios are used
                scenarioKnowledge: scenarioRetrieval.scenarios,
                scenarioUsageMode: killSwitches.disableScenarioAutoResponses ? 'context_only' : 'may_verbatim',
                
                // ═══════════════════════════════════════════════════════════════
                // CHEAT SHEET KNOWLEDGE (PHASE 1 - Discovery Fallback)
                // ═══════════════════════════════════════════════════════════════
                cheatSheetKnowledge: cheatSheetKnowledge,
                cheatSheetUsed: cheatSheetUsed,
                cheatSheetReason: cheatSheetReason,
                
                // Caller emotion
                callerEmotion: emotion.emotion,
                
                // What has been discovered so far
                discovery: session.discovery || {},
                
                // Company variables for natural speech
                companyVars: LLMDiscoveryEngine.getCompanyVariables(company),
                
                // Custom system prompt for discovery
                customSystemPrompt: discoveryPrompt,
                
                // Collected slots (for context, NOT for asking)
                collectedSlots: currentSlots,
                
                // V22 Kill Switches (passed to LLM for prompt enforcement)
                killSwitches
            };
            
            log('CHECKPOINT 9e: 🎯 LLM context built for discovery', {
                scenarioCount: llmContext.scenarioKnowledge?.length || 0,
                emotion: llmContext.callerEmotion,
                hasDiscoveryIssue: !!llmContext.discovery?.issue
            });
            
            // Step 5: Call LLM - it is the PRIMARY BRAIN
            const llmResult = await HybridReceptionistLLM.processConversation({
                    company,
                    callContext: {
                        callId: session._id.toString(),
                        companyId,
                        customerContext,
                        runningSummary: summaryFormatted,
                        turnCount: (session.metrics?.totalTurns || 0) + 1,
                        channel,
                    partialName: currentSlots.partialName || null,
                    enterpriseContext: llmContext,
                    mode: 'LLM_LED_DISCOVERY'
                    },
                currentMode: 'discovery',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                
            log('CHECKPOINT 9f: 🗣️ LLM response generated', {
                latencyMs: aiLatencyMs,
                tokensUsed: llmResult.tokensUsed || 0,
                replyPreview: llmResult.reply?.substring(0, 50)
            });
            
            // Step 6: Update discovery state from LLM extraction
            if (llmResult.extractedIssue && !session.discovery?.issue) {
                session.discovery = session.discovery || {};
                session.discovery.issue = llmResult.extractedIssue;
                session.discovery.issueCapturedAtTurn = (session.metrics?.totalTurns || 0) + 1;
            }
            
            // Step 7: Track if LLM asked the consent question
            const askedConsent = llmResult.reply?.toLowerCase().includes('schedule') && 
                                 llmResult.reply?.toLowerCase().includes('?');
            if (askedConsent) {
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.askedConsentQuestion = true;
            }
            
            // Step 8: Store scenarios consulted for debugging
            if (scenarioRetrieval.scenarios?.length > 0) {
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.scenariosConsulted = scenarioRetrieval.scenarios.map(s => s.scenarioId);
            }
            
            aiResult = {
                reply: llmResult.reply,
                conversationMode: 'discovery',
                intent: llmResult.intent || 'discovery',
                nextGoal: llmResult.nextGoal || 'UNDERSTAND_CALLER',
                filledSlots: currentSlots,
                signals: { 
                    wantsBooking: false,  // NOT booking until consent
                    consentGiven: false,
                    discoveryComplete: !!session.discovery?.issue
                },
                latencyMs: aiLatencyMs,
                tokensUsed: llmResult.tokensUsed || 0,
                fromStateMachine: false,
                mode: session.mode,
                debug: {
                    source: 'OPTION1_LLM_SPEAKS',
                    stage: llmContext.stage,
                    canAskConsent: llmContext.canAskConsent,
                    discoveryIssue: llmContext.discovery?.issue,
                    // V22 Debug Info
                    scenariosRetrieved: scenarioRetrieval.scenarios?.map(s => s.title) || [],
                    scenarioCount: scenarioRetrieval.scenarios?.length || 0,
                    // V23 Cheat Sheet Debug Info
                    cheatSheetUsed: cheatSheetUsed || false,
                    cheatSheetReason: cheatSheetReason || null,
                    cheatSheetCategory: cheatSheetKnowledge?.category || null,
                    killSwitches: {
                        bookingRequiresExplicitConsent: killSwitches.bookingRequiresExplicitConsent,
                        forceLLMDiscovery: killSwitches.forceLLMDiscovery,
                        disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
                    }
                }
            };
            
            log('CHECKPOINT 9d: ✅ LLM response complete (DISCOVERY/SUPPORT)', {
                tokensUsed: llmResult.tokensUsed,
                mode: session.mode,
                hasIssue: !!session.discovery?.issue
            });
            
            // Increment discovery question count for fast-path gate
            session.discovery = session.discovery || {};
            session.discovery.questionCount = (session.discovery.questionCount || 0) + 1;
            }  // End of if (!aiResult) - fast-path bypass
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // Save state to session (both modes)
        // ═══════════════════════════════════════════════════════════════════
        session.collectedSlots = { ...session.collectedSlots, ...currentSlots };
        
        // ═══════════════════════════════════════════════════════════════════
        // KEY FACTS STORAGE - For interrupt handling context
        // ═══════════════════════════════════════════════════════════════════
        // Store key facts from the conversation so interrupts don't lose context
        session.keyFacts = session.keyFacts || [];
        
        // Add new facts from this turn
        if (session.discovery?.issue && !session.keyFacts.includes(`Issue: ${session.discovery.issue}`)) {
            session.keyFacts.push(`Issue: ${session.discovery.issue}`);
        }
        if (currentSlots.name && !session.keyFacts.includes(`Name: ${currentSlots.name}`)) {
            session.keyFacts.push(`Name: ${currentSlots.name}`);
        }
        if (currentSlots.phone && !session.keyFacts.includes(`Phone: ${currentSlots.phone}`)) {
            session.keyFacts.push(`Phone: ${currentSlots.phone}`);
        }
        if (currentSlots.address && !session.keyFacts.includes(`Address: ${currentSlots.address}`)) {
            session.keyFacts.push(`Address: ${currentSlots.address}`);
        }
        
        // Keep only last 10 facts to prevent bloat
        if (session.keyFacts.length > 10) {
            session.keyFacts = session.keyFacts.slice(-10);
        }
        
        // Update legacy phase for backward compatibility
        if (session.mode === 'BOOKING') {
            session.phase = 'booking';
        } else if (session.mode === 'COMPLETE') {
            session.phase = 'complete';
        } else {
            session.phase = 'discovery';
        }
        
        log('CHECKPOINT 9g: 📊 Session state saved', {
            mode: session.mode,
            phase: session.phase,
            consentGiven: session.booking?.consentGiven,
            hasIssue: !!session.discovery?.issue,
            slotsCount: Object.keys(session.collectedSlots || {}).filter(k => session.collectedSlots[k]).length
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V22 BLACK BOX LOG - MANDATORY VERIFICATION DATA
        // ═══════════════════════════════════════════════════════════════════════
        // This structured log is REQUIRED for acceptance testing.
        // It proves the system is behaving correctly per V22 architecture.
        // ═══════════════════════════════════════════════════════════════════════
        const v22BlackBoxLog = {
            // Identity
            companyId: companyId?.toString(),
            sessionId: session._id?.toString(),
            turn: (session.metrics?.totalTurns || 0) + 1,
            timestamp: new Date().toISOString(),
            
            // V22 Mode Control (THE CRITICAL DATA)
            mode: session.mode,
            previousMode: session._previousMode || 'DISCOVERY',
            modeTransition: session._previousMode !== session.mode ? `${session._previousMode || 'DISCOVERY'} → ${session.mode}` : 'none',
            
            // Consent Gate (MUST BE EXPLICIT)
            consentDetected: consentCheck?.hasConsent || false,
            consentPhrase: consentCheck?.matchedPhrase || null,
            consentGiven: session.booking?.consentGiven || false,
            bookingStarted: session.mode === 'BOOKING',
            
            // LLM Control (PROVES LLM SPOKE FIRST)
            llmSpoke: !aiResult?.fromStateMachine,
            llmTokensUsed: aiResult?.tokensUsed || 0,
            responseSource: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM'),
            
            // Scenario Tool Usage (NOT SCRIPTS)
            scenariosRetrieved: session.conversationMemory?.scenariosConsulted || [],
            scenarioCount: session.conversationMemory?.scenariosConsulted?.length || 0,
            
            // ═══════════════════════════════════════════════════════════════════
            // V23 CHEAT SHEET TRACKING (PHASE 1)
            // ═══════════════════════════════════════════════════════════════════
            cheatSheetUsed: aiResult?.debug?.cheatSheetUsed || false,
            cheatSheetReason: aiResult?.debug?.cheatSheetReason || null,  // 'discovery_fallback' | 'booking_interrupt'
            cheatSheetCategory: aiResult?.debug?.cheatSheetCategory || null,
            
            // ═══════════════════════════════════════════════════════════════════
            // V23 BOOKING OUTCOME TRACKING
            // ═══════════════════════════════════════════════════════════════════
            bookingComplete: session.mode === 'COMPLETE',
            bookingRequestId: aiResult?.debug?.bookingRequestId || session.booking?.bookingRequestId || null,
            caseId: aiResult?.debug?.caseId || null,
            outcomeMode: aiResult?.debug?.outcomeMode || null,  // 'confirmed_on_call' | 'pending_dispatch' | etc.
            bookingStatus: aiResult?.debug?.status || null,     // 'FAKE_CONFIRMED' | 'PENDING_DISPATCH' | etc.
            
            // Discovery State
            discoveryIssue: session.discovery?.issue || null,
            callerEmotion: aiResult?.debug?.emotion || 'neutral',
            
            // Latency (MUST BE MEASURED)
            latencyMs: aiLatencyMs,
            totalTurnLatencyMs: Date.now() - startTime,
            
            // Safety Flags (V22 Kill Switches)
            killSwitches: {
                bookingRequiresConsent: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.bookingRequiresExplicitConsent !== false,
                forceLLMDiscovery: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.forceLLMDiscovery !== false,
                disableScenarioAutoResponses: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.disableScenarioAutoResponses !== false
            },
            
            // Response Preview (for human verification)
            userInput: userText?.substring(0, 100),
            aiResponsePreview: aiResult?.reply?.substring(0, 100)
        };
        
        // Store previous mode for next turn's transition detection
        session._previousMode = session.mode;
        
        // Log to console (structured for parsing)
        logger.info('[V22 BLACK BOX] Turn complete', v22BlackBoxLog);
        
        // Also add to response debug for UI visibility
        if (aiResult) {
            aiResult.v22BlackBox = v22BlackBoxLog;
        }
        
        // Merge extracted slots
        aiResult.filledSlots = { ...(aiResult.filledSlots || {}), ...extractedThisTurn };
        
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL: Update session.collectedSlots IMMEDIATELY after extraction
        // This ensures slots persist even if later save operations fail
        // ═══════════════════════════════════════════════════════════════════════
        if (Object.keys(extractedThisTurn).length > 0) {
            session.collectedSlots = { ...session.collectedSlots, ...extractedThisTurn };
            log('CHECKPOINT 9d: 📊 Slots immediately saved to session', {
                extractedThisTurn,
                allSlots: session.collectedSlots
            });
        }
        
        log('CHECKPOINT 9: ✅ Response generated', { 
            source: aiResult.fromStateMachine ? 'STATE_MACHINE' : 'LLM',
            latencyMs: aiLatencyMs, 
            tokensUsed: aiResult.tokensUsed,
            mode: aiResult.conversationMode
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 9: Process AI response
        // ═══════════════════════════════════════════════════════════════════
        let aiResponse = (aiResult?.reply || aiResult?.response || '').trim();
        
        // Handle empty response
        if (!aiResponse) {
            log('⚠️ Empty AI response, using fallback');
            aiResponse = "I'm sorry, could you repeat that?";
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: Update session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 10: Updating session...');
        const latencyMs = Date.now() - startTime;
        
        try {
            // Determine response source
            let responseSource = 'llm';
            if (aiResult?.fromStateMachine) {
                responseSource = 'STATE_MACHINE';
            } else if (aiResult?.fromQuickAnswers) {
                responseSource = 'quick_answer';
            }
            
            await SessionService.addTurn({
                session,
                userMessage: userText,
                aiResponse,
                metadata: {
                    latencyMs,
                    tokensUsed: aiResult?.tokensUsed || 0,
                    responseSource,
                    confidence: aiResult?.confidence,
                    slotsExtracted: aiResult?.filledSlots || {},
                    channel,
                    // Include state machine state for debugging
                    stateMachine: aiResult?.debug?.stateMachineState || null
                },
                company
            });
        } catch (turnErr) {
            log('Failed to save turn (non-fatal)', { error: turnErr.message });
        }
        
        // Update phase
        const newPhase = aiResult?.conversationMode === 'booking' ? 'booking' : 
                         aiResult?.conversationMode === 'complete' ? 'complete' : 
                         session.phase || 'greeting';
        
        if (newPhase !== session.phase) {
            await SessionService.updatePhase(session, newPhase);
        }
        
        // Save flags
        if (willAskForMissingNamePart) {
            session.askedForMissingNamePart = true;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // TRACK lastAgentIntent FOR CONTEXT-AWARE CONSENT DETECTION
        // ═══════════════════════════════════════════════════════════════════
        // If the AI response asks about scheduling, mark it so next turn's
        // consent detection knows that "yes" means "yes to scheduling"
        // ═══════════════════════════════════════════════════════════════════
        const aiResponseLower = aiResponse.toLowerCase();
        if (aiResponseLower.includes('schedule') || 
            aiResponseLower.includes('appointment') ||
            aiResponseLower.includes('technician') ||
            aiResponseLower.includes('come out') ||
            aiResponseLower.includes('would you like me to')) {
            session.lastAgentIntent = 'OFFER_SCHEDULE';
            session.conversationMemory = session.conversationMemory || {};
            session.conversationMemory.askedConsentQuestion = true;
            log('📝 INTENT TRACKED: OFFER_SCHEDULE', { response: aiResponse.substring(0, 100) });
        } else if (session.mode === 'BOOKING') {
            session.lastAgentIntent = 'BOOKING_SLOT_QUESTION';
        } else {
            session.lastAgentIntent = 'DISCOVERY';
        }
        
        // Persist all session changes
        session.markModified('booking');
        session.markModified('conversationMemory');
        await session.save();
        
        log('CHECKPOINT 10: ✅ Session updated', { phase: newPhase, lastAgentIntent: session.lastAgentIntent });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 10b: Update Call Center Live Progress (Enterprise Flow)
        // ═══════════════════════════════════════════════════════════════════
        // This updates the CallSummary record with real-time progress
        // so supervisors can monitor in-progress calls in Call Center UI
        // ═══════════════════════════════════════════════════════════════════
        if (channel === 'phone' && callSid) {
            try {
                const CallSummary = require('../models/CallSummary');
                
                await CallSummary.updateLiveProgress(callSid, {
                    currentStage: session.conversationMemory?.currentStage || newPhase,
                    currentStep: session.conversationMemory?.currentStep,
                    discovery: session.discovery || {},
                    slotsCollected: session.collectedSlots || {},
                    offRailsCount: session.conversationMemory?.offRailsCount || 0,
                    triageOutcome: session.triageState?.outcome,
                    lastResponse: aiResponse.substring(0, 500),
                    turnCount: (session.metrics?.totalTurns || 0) + 1
                });
                
                log('CHECKPOINT 10b: 📡 Live progress updated in Call Center');
            } catch (liveErr) {
                // Non-blocking: Don't let live progress failures kill the call
                log('Live progress update failed (non-fatal)', { error: liveErr.message });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 11: Build response
        // ═══════════════════════════════════════════════════════════════════
        const response = {
            success: true,
            reply: aiResponse,
            sessionId: session._id.toString(),
            phase: newPhase,
            slotsCollected: { ...session.collectedSlots, ...(aiResult.filledSlots || {}) },
            wantsBooking: aiResult.wantsBooking || false,
            conversationMode: aiResult.conversationMode || 'free',
            latencyMs
        };
        
        // Add debug info if requested
        if (includeDebug) {
            // Determine response source for display
            let responseSource = 'LLM';
            if (aiResult.fromStateMachine) {
                responseSource = 'STATE_MACHINE (0 tokens)';
            } else if (aiResult.fromQuickAnswers) {
                responseSource = 'QUICK_ANSWER';
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 DYNAMIC STAGE-AWARE DEBUG DATA
            // Shows what's collected and needed based on CURRENT STAGE
            // ═══════════════════════════════════════════════════════════════════
            const currentStage = session.conversationMemory?.currentStage || 
                                 aiResult.debug?.stage || 
                                 (aiResult.conversationMode === 'booking' ? 'booking' : 'discovery');
            
            // Build stage-specific collected/need data
            const stageData = {
                currentStage,
                currentStep: session.conversationMemory?.currentStep || aiResult.debug?.step || null,
                
                // DISCOVERY STAGE DATA
                discovery: {
                    collected: {},
                    need: ['issue', 'context', 'callType']
                },
                
                // TRIAGE STAGE DATA  
                triage: {
                    collected: {},
                    need: ['diagnosis']
                },
                
                // BOOKING STAGE DATA
                booking: {
                    collected: {},
                    need: []
                }
            };
            
            // Populate DISCOVERY collected
            if (session.discovery?.issue) {
                stageData.discovery.collected.issue = session.discovery.issue;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'issue');
            }
            if (session.discovery?.context) {
                stageData.discovery.collected.context = session.discovery.context;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'context');
            }
            if (session.discovery?.callType && session.discovery.callType !== 'unknown') {
                stageData.discovery.collected.callType = session.discovery.callType;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'callType');
            }
            if (session.discovery?.mood && session.discovery.mood !== 'neutral') {
                stageData.discovery.collected.mood = session.discovery.mood;
            }
            if (session.discovery?.urgency && session.discovery.urgency !== 'normal') {
                stageData.discovery.collected.urgency = session.discovery.urgency;
            }
            
            // Populate TRIAGE collected
            if (session.triageState?.matchedCardName) {
                stageData.triage.collected.matchedCard = session.triageState.matchedCardName;
                stageData.triage.matchReason = session.triageState.matchReason || 'keyword match';
            }
            if (session.triageState?.questionsAsked?.length > 0) {
                stageData.triage.collected.questionsAsked = session.triageState.questionsAsked.length;
            }
            if (session.triageState?.answersReceived?.length > 0) {
                stageData.triage.collected.answersReceived = session.triageState.answersReceived.map(a => ({
                    q: a.question?.substring(0, 30),
                    a: a.answer?.substring(0, 30)
                }));
            }
            if (session.triageState?.diagnosisSummary) {
                stageData.triage.collected.diagnosis = session.triageState.diagnosisSummary;
                stageData.triage.need = [];
            }
            if (session.triageState?.outcome && session.triageState.outcome !== 'pending') {
                stageData.triage.collected.outcome = session.triageState.outcome;
            }
            
            // Populate BOOKING collected from session + current slots
            const allSlots = { ...session.collectedSlots, ...(aiResult.filledSlots || {}) };
            const bookingSlotIds = bookingConfig.slots.map(s => s.slotId || s.id);
            
            for (const slotId of bookingSlotIds) {
                if (allSlots[slotId]) {
                    stageData.booking.collected[slotId] = allSlots[slotId];
                } else {
                    stageData.booking.need.push(slotId);
                }
            }
            
            // Determine what to show in COLLECTED/NEED based on current stage
            let dynamicCollected = {};
            let dynamicNeed = [];
            
            switch (currentStage) {
                case 'greeting':
                case 'discovery':
                    dynamicCollected = stageData.discovery.collected;
                    dynamicNeed = stageData.discovery.need;
                    break;
                case 'triage':
                    dynamicCollected = { 
                        ...stageData.discovery.collected,
                        ...stageData.triage.collected 
                    };
                    dynamicNeed = stageData.triage.need;
                    break;
                case 'booking':
                case 'confirmation':
                    dynamicCollected = {
                        ...stageData.discovery.collected,
                        ...stageData.booking.collected
                    };
                    dynamicNeed = stageData.booking.need;
                    break;
                default:
                    dynamicCollected = allSlots;
                    dynamicNeed = bookingSlotIds.filter(s => !allSlots[s]);
            }
            
            response.debug = {
                engineVersion: ENGINE_VERSION,
                channel,
                latencyMs,
                aiLatencyMs,
                tokensUsed: aiResult.tokensUsed || 0,
                responseSource,
                confidence: aiResult.confidence,
                
                // ════════════════════════════════════════════════════════════════
                // V22 MODE INFO - Critical for debugging discovery/booking flow
                // ════════════════════════════════════════════════════════════════
                v22: {
                    mode: session.mode || 'DISCOVERY',
                    consentGiven: session.booking?.consentGiven || false,
                    consentPhrase: session.booking?.consentPhrase || null,
                    scenariosRetrieved: session.conversationMemory?.scenariosConsulted || [],
                    scenarioCount: session.conversationMemory?.scenariosConsulted?.length || 0,
                    discoveryIssue: session.discovery?.issue || null,
                    killSwitches: aiResult.debug?.killSwitches || null
                },
                
                // 🎯 DYNAMIC STAGE DATA - What UI should display
                stageInfo: {
                    currentStage,
                    currentStep: stageData.currentStep,
                    collected: dynamicCollected,
                    need: dynamicNeed,
                    // Full stage breakdown for detailed view
                    stages: {
                        discovery: stageData.discovery,
                        triage: stageData.triage,
                        booking: stageData.booking
                    }
                },
                
                customerContext: {
                    isKnown: customerContext.isKnown,
                    isReturning: customerContext.isReturning,
                    name: customerContext.name
                },
                runningSummary: summaryBullets,
                turnNumber: session.metrics?.totalTurns || 0,
                historySent: conversationHistory.length,
                // 🔍 SLOT DIAGNOSTICS - Shows exactly what happened with slots
                slotDiagnostics: {
                    sessionId: session._id.toString(),
                    wasSessionReused: (session.metrics?.totalTurns || 0) > 0,
                    slotsBeforeThisTurn: session.collectedSlots || {},
                    extractedThisTurn: extractedThisTurn,
                    slotsAfterMerge: allSlots,
                    whatLLMSaw: currentSlots
                },
                bookingConfig: {
                    source: bookingConfig.source,
                    isConfigured: bookingConfig.isConfigured,
                    slots: bookingConfig.slots.map(s => ({
                        id: s.slotId,
                        type: s.type,
                        question: s.question,
                        required: s.required,
                        confirmBack: s.confirmBack || false,
                        confirmPrompt: s.confirmPrompt || null
                    }))
                },
                // 🤖 STATE MACHINE DEBUG - What the state machine decided
                stateMachine: aiResult.fromStateMachine ? {
                    action: aiResult.debug?.action,
                    state: aiResult.debug?.stateMachineState,
                    response: aiResult.debug?.response
                } : null,
                // 🧠 LLM BRAIN DEBUG - What the LLM decided (if used)
                llmBrain: !aiResult.fromStateMachine ? (aiResult.debug || null) : null,
                debugLog,
                // ════════════════════════════════════════════════════════════════
                // V22 BLACK BOX - AUTHORITATIVE MODE TRACKING (UI reads this)
                // ════════════════════════════════════════════════════════════════
                v22BlackBox: aiResult.v22BlackBox || {
                    mode: session.mode || 'DISCOVERY',
                    consentGiven: session.booking?.consentGiven || false,
                    consentPhrase: session.booking?.consentPhrase || null,
                    bookingStarted: session.mode === 'BOOKING',
                    responseSource: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM')
                }
            };
        }
        
        log('✅ processTurn complete', { responseLength: aiResponse.length, latencyMs });
        
        return response;
        
    } catch (error) {
        logger.error('[CONVERSATION ENGINE] ❌ Error in processTurn', {
            error: error.message,
            stack: error.stack,
            companyId,
            channel
        });
        
        return {
            success: false,
            error: error.message,
            errorType: error.name,
            reply: "I'm sorry, I'm having trouble right now. Could you repeat that?",
            sessionId: providedSessionId,
            phase: 'error',
            slotsCollected: {},
            wantsBooking: false,
            conversationMode: 'free',
            latencyMs: Date.now() - startTime,
            debug: includeDebug ? { debugLog, error: error.message } : undefined
        };
    }
}

/**
 * Get session by ID (for reconnecting or debugging)
 */
async function getSession(sessionId) {
    return SessionService.findById(sessionId);
}

/**
 * End a session with outcome
 */
async function endSession(sessionId, outcome = 'no_action') {
    const session = await SessionService.findById(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }
    return SessionService.end(session, outcome);
}

module.exports = {
    processTurn,
    getSession,
    endSession,
    
    // Export version for debugging
    ENGINE_VERSION,
    
    // Export slot extractors for testing
    SlotExtractors
};


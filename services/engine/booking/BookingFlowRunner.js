/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 * 
 * THE DETERMINISTIC BOOKING ENGINE - No LLM, No Scenarios, No Guesswork.
 * 
 * This is the "state machine" that takes over when bookingModeLocked is true.
 * It executes booking flow steps based on:
 * - The resolved flow (from BookingFlowResolver)
 * - The current step ID (from Redis state)
 * - User input (from STT)
 * 
 * CORE PRINCIPLE:
 * "The state machine is the clipboard. The LLM was the receptionist.
 *  Once we're in booking mode, the clipboard is in charge."
 * 
 * RESPONSIBILITIES:
 * 1. Ask the current step's prompt (if no user input yet)
 * 2. Validate user input against step requirements
 * 3. Extract and store the value
 * 4. Advance to next step or complete the flow
 * 5. Return deterministic response (no LLM needed)
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const BookingFlowResolver = require('./BookingFlowResolver');
const SlotExtractor = require('./SlotExtractor');  // V96f: Single source of truth for slot extraction
const AddressValidationService = require('../../AddressValidationService');
const GoogleCalendarService = require('../../GoogleCalendarService');
const SMSNotificationService = require('../../SMSNotificationService');

// V96k: Clean validation modules (extracted from monolithic runner)
const { validateSlotValue } = require('./BookingSlotValidator');
const { sanitizeBookingState } = require('./BookingSlotSanitizer');
const { checkConfirmationInvariant } = require('./BookingInvariants');

// 🔌 AWConfigReader for traced config reads (Phase 6d)
let AWConfigReader;
try {
    AWConfigReader = require('../../wiring/AWConfigReader');
} catch (e) {
    logger.warn('[BOOKING FLOW RUNNER] AWConfigReader not available');
}

// 🔌 BlackBoxLogger for ADDRESS_VALIDATION_RESULT events (V93)
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../BlackBoxLogger');
} catch (e) {
    logger.warn('[BOOKING FLOW RUNNER] BlackBoxLogger not available');
}

// 🔌 V96j: IdentitySlotFirewall for unified identity slot protection
let IdentitySlotFirewall;
try {
    IdentitySlotFirewall = require('../../../utils/IdentitySlotFirewall');
} catch (e) {
    logger.warn('[BOOKING FLOW RUNNER] IdentitySlotFirewall not available');
}

/**
 * ============================================================================
 * V96j: SAFE SLOT WRITE FIREWALL (UNIFIED WITH IdentitySlotFirewall)
 * ============================================================================
 * 
 * ALL slot writes MUST go through this function. This is the single point of
 * enforcement for:
 * - Phone-shaped string rejection for name fields
 * - Stop word rejection
 * - Immutability protection for confirmed slots
 * - Audit logging for accept/reject decisions
 * 
 * V96j CHANGE: Identity slots (name, firstName, lastName, etc.) are now routed
 * through the global IdentitySlotFirewall for unified protection and tracing.
 * 
 * RULE: No direct assignment to bookingCollected.name/firstName/lastName.
 * ============================================================================
 */
const IDENTITY_SLOTS = new Set(['name', 'firstName', 'lastName', 'partialName', 'fullName']);
const IDENTITY_SLOTS_FOR_FIREWALL = ['name', 'firstName', 'lastName', 'partialName', 'phone', 'address'];

/**
 * ============================================================================
 * V96j: CANONICAL SLOT STORE
 * ============================================================================
 * 
 * state.slots is the SINGLE canonical slot store. Structure:
 * {
 *     name: { value: "Mark", confidence: 0.95, source: "stt", confirmedAt: "..." },
 *     phone: { value: "555-1234", confidence: 0.9, source: "caller_id" },
 *     ...
 * }
 * 
 * bookingCollected is a LEGACY ALIAS - it provides a simplified view:
 * { name: "Mark", phone: "555-1234", ... }
 * 
 * All new code should use state.slots. The bookingCollected view is for
 * backward compatibility only and will be deprecated.
 * ============================================================================
 */

/**
 * Create a bookingCollected-compatible view from state.slots
 * This is a READ-ONLY alias - writes must go through safeSetSlot!
 */
function createBookingCollectedView(state) {
    const view = {};
    const slots = state.slots || {};
    for (const [key, slot] of Object.entries(slots)) {
        if (slot && typeof slot === 'object' && slot.value !== undefined) {
            view[key] = slot.value;
        } else if (slot !== undefined && typeof slot !== 'object') {
            // Handle legacy flat values
            view[key] = slot;
        }
    }
    return view;
}

/**
 * Sync bookingCollected to canonical slots (for backward compatibility writes)
 * Call this after any legacy code writes to bookingCollected directly
 */
function syncBookingCollectedToSlots(state, source = 'legacy_sync') {
    if (!state.bookingCollected) return;
    state.slots = state.slots || {};
    
    for (const [key, value] of Object.entries(state.bookingCollected)) {
        if (value !== undefined && !state.slots[key]) {
            state.slots[key] = {
                value,
                confidence: 0.7,  // Lower confidence for legacy sync
                source,
                syncedAt: new Date().toISOString()
            };
        }
    }
}

/**
 * ============================================================================
 * V96k: VALIDATE SLOT VALUE AGAINST TYPE
 * ============================================================================
 * 
 * This is the FIRST LINE OF DEFENSE against slot contamination.
 * Before ANY slot write happens, we validate that the value makes sense
 * for the slot type.
 * 
 * VALIDATION RULES:
 * - time: Must match time patterns, must NOT contain street tokens or match address
 * - name: Must NOT look like a phone number
 * - phone: Must contain enough digits
 * - address: Must contain street-like tokens
 * 
 * @returns {{ valid: boolean, reason?: string }}
 */

function safeSetSlot(state, slotName, value, options = {}) {
    const { source = 'unknown', confidence = 0.8, isCorrection = false, bypassStepGate = false } = options;
    
    // V96h: Get trace context from state for SLOT_WRITE_FIREWALL events
    const traceCallSid = state?._traceContext?.callSid;
    const traceCompanyId = state?._traceContext?.companyId;
    const traceLevel = state?._traceContext?.traceLevel || 'normal';
    const traceTurn = state?._traceContext?.turn || 0;
    
    if (!value) {
        logger.debug('[SAFE SET SLOT] Skipped null/empty value', { slotName, source });
        return { accepted: false, reason: 'empty_value' };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96k: HARD TYPE VALIDATION - Prevent contamination at write-time
    // ═══════════════════════════════════════════════════════════════════════════
    // Before allowing ANY write, validate that the value makes sense for the slot type.
    // This is the first line of defense against slot contamination.
    // ═══════════════════════════════════════════════════════════════════════════
    const typeValidation = validateSlotValue(slotName, value, state);
    if (!typeValidation.valid) {
        logger.warn('[SAFE SET SLOT] ❌ V96k: TYPE VALIDATION FAILED - Rejected write', {
            slotName,
            value: typeof value === 'string' ? value.substring(0, 50) : value,
            reason: typeValidation.reason,
            source,
            callSid: traceCallSid
        });
        
        // Emit SLOT_WRITE_TRACE for type validation failure
        if (BlackBoxLogger && traceCallSid && traceCompanyId) {
            BlackBoxLogger.logEvent({
                callId: traceCallSid,
                companyId: traceCompanyId,
                turn: traceTurn,
                type: 'SLOT_WRITE_TRACE',
                data: {
                    writer: 'BookingFlowRunner.safeSetSlot',
                    slotName,
                    value: typeof value === 'string' ? value.substring(0, 50) : value,
                    accepted: false,
                    reason: typeValidation.reason,
                    source,
                    confidence,
                    isCorrection,
                    bypassStepGate
                }
            }).catch(() => {});
        }

        return {
            accepted: false,
            reason: typeValidation.reason,
            validationFailed: true
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j: STEP-GATED SLOT WRITES
    // ═══════════════════════════════════════════════════════════════════════════
    // When in booking mode with a current step, only allow writes to the CURRENT
    // step's slot. This prevents "slot contamination" where the runner jumps ahead
    // because data was extracted from an utterance that wasn't answering that slot.
    //
    // Example: If current step = 'address', do NOT allow writes to 'time' even if
    // the user said "3pm". That's contamination - wait until we ASK for time.
    //
    // Exceptions:
    // - bypassStepGate = true (explicit pre-fill from caller ID, etc.)
    // - isCorrection = true (user explicitly correcting a slot)
    // - Slot already has value (allow updates to current slot)
    // ═══════════════════════════════════════════════════════════════════════════
    const currentStepId = state?.currentStepId;
    const inBookingMode = state?.bookingModeLocked === true;
    
    if (inBookingMode && currentStepId && !bypassStepGate && !isCorrection) {
        // Get the field key for the current step
        const currentFieldKey = currentStepId.replace('_collect', '').replace('_confirm', '');
        
        // If slotName doesn't match current step's field, reject
        // Allow common aliases (name matches firstName/lastName/partialName)
        const nameAliases = ['name', 'firstName', 'lastName', 'partialName', 'fullName'];
        const isNameRelated = nameAliases.includes(slotName) && nameAliases.includes(currentFieldKey);
        const isCurrentSlot = slotName === currentFieldKey || isNameRelated;
        
        if (!isCurrentSlot) {
            // V96j: STEP_GATE_VIOLATION - Rejected write to non-current slot
            logger.warn('[SAFE SET SLOT] ⛔ STEP_GATE_VIOLATION: Rejected write to non-current slot', {
                rejectedSlot: slotName,
                currentStep: currentStepId,
                expectedSlot: currentFieldKey,
                attemptedValue: typeof value === 'string' ? value.substring(0, 30) : value,
                source,
                callSid: traceCallSid
            });
            
            // Log to BlackBox for auditing
            if (BlackBoxLogger && traceCallSid && traceCompanyId) {
                BlackBoxLogger.logEvent({
                    callId: traceCallSid,
                    companyId: traceCompanyId,
                    turn: traceTurn,
                    eventType: 'STEP_GATE_VIOLATION',
                    eventData: {
                        rejectedSlot: slotName,
                        currentStep: currentStepId,
                        expectedSlot: currentFieldKey,
                        attemptedValue: typeof value === 'string' ? value.substring(0, 20) : '[non-string]',
                        source,
                        reason: 'slot_not_current_step'
                    }
                });
            }
            
            return { 
                accepted: false, 
                reason: 'step_gate_violation',
                currentStep: currentStepId,
                expectedSlot: currentFieldKey
            };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j: Route identity slots through IdentitySlotFirewall
    // ═══════════════════════════════════════════════════════════════════════════
    if (IdentitySlotFirewall && IDENTITY_SLOTS_FOR_FIREWALL.includes(slotName)) {
        // Prepare slots object for firewall (it expects a different shape)
        // The firewall writes to a slots object with { value, confidence, source, ... }
        // We need to sync this with bookingCollected which is simpler
        const slotsProxy = {};
        
        // Copy existing slot if any
        if (state.bookingCollected?.[slotName]) {
            slotsProxy[slotName] = {
                value: state.bookingCollected[slotName],
                confidence: state.slotMetadata?.[slotName]?.confidence || 0,
                immutable: state.slotMetadata?.[slotName]?.immutable,
                confirmed: state.slotMetadata?.[slotName]?.confirmed,
                nameLocked: state.slotMetadata?.[slotName]?.nameLocked
            };
        }
        
        // Call the global firewall
        const firewallResult = IdentitySlotFirewall.safeSetIdentitySlot(
            slotsProxy,
            slotName,
            value,
            {
                writer: 'BookingFlowRunner.extractSlotFromUtterance',
                callsite: 'BookingFlowRunner.safeSetSlot',
                confidence,
                source,
                callId: traceCallSid,
                companyId: traceCompanyId,
                turn: traceTurn,
                forceOverwrite: isCorrection
            }
        );
        
        if (!firewallResult.accepted) {
            logger.info('[SAFE SET SLOT] ❌ Firewall rejected identity slot write', {
                slotName,
                reason: firewallResult.reason,
                writer: 'BookingFlowRunner'
            });

            // Emit SLOT_WRITE_TRACE for firewall rejection
            if (BlackBoxLogger && traceCallSid && traceCompanyId) {
                BlackBoxLogger.logEvent({
                    callId: traceCallSid,
                    companyId: traceCompanyId,
                    turn: traceTurn,
                    type: 'SLOT_WRITE_TRACE',
                    data: {
                        writer: 'BookingFlowRunner.safeSetSlot',
                        slotName,
                        value: typeof value === 'string' ? value.substring(0, 50) : value,
                        accepted: false,
                        reason: firewallResult.reason,
                        source,
                        confidence,
                        isCorrection,
                        bypassStepGate
                    }
                }).catch(() => {});
            }

            return {
                accepted: false,
                reason: firewallResult.reason,
                currentValue: state.bookingCollected?.[slotName]
            };
        }
        
        // V96j: Write to CANONICAL slots store first
        const finalValue = slotsProxy[slotName]?.value || value;
        const previousValue = state.slots?.[slotName]?.value || state.bookingCollected?.[slotName];
        
        state.slots = state.slots || {};
        state.slots[slotName] = {
            value: finalValue,
            source: slotsProxy[slotName]?.source || source,
            confidence: slotsProxy[slotName]?.confidence || confidence,
            updatedAt: new Date().toISOString(),
            previousValue: previousValue !== finalValue ? previousValue : undefined,
            writer: 'BookingFlowRunner.safeSetSlot',
            firewallAccepted: true
        };
        
        // Sync to bookingCollected for backward compatibility
        state.bookingCollected = state.bookingCollected || {};
        state.bookingCollected[slotName] = finalValue;

        // Emit SLOT_WRITE_TRACE event for debugging
        if (BlackBoxLogger && traceCallSid && traceCompanyId) {
            BlackBoxLogger.logEvent({
                callId: traceCallSid,
                companyId: traceCompanyId,
                turn: traceTurn,
                type: 'SLOT_WRITE_TRACE',
                data: {
                    writer: 'BookingFlowRunner.safeSetSlot',
                    slotName,
                    value: typeof finalValue === 'string' ? finalValue.substring(0, 50) : finalValue,
                    accepted: true,
                    reason: 'successful_write',
                    source,
                    confidence,
                    isCorrection,
                    bypassStepGate,
                    previousValue: previousValue !== finalValue ? (typeof previousValue === 'string' ? previousValue.substring(0, 50) : previousValue) : null
                }
            }).catch(() => {});
        }

        // Update legacy metadata for backward compat
        state.slotMetadata = state.slotMetadata || {};
        state.slotMetadata[slotName] = {
            ...(state.slotMetadata[slotName] || {}),
            ...state.slots[slotName]
        };
        
        logger.info('[SAFE SET SLOT] ✅ Identity slot accepted via firewall', {
            slotName,
            value: typeof finalValue === 'string' ? finalValue.substring(0, 30) : finalValue,
            source,
            confidence,
            wasOverwrite: !!previousValue && previousValue !== finalValue,
            canonicalStore: 'slots'
        });
        
        return { accepted: true, value: finalValue, previousValue };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // Non-identity slots: Original validation logic
    // ═══════════════════════════════════════════════════════════════════════════
    if (IDENTITY_SLOTS.has(slotName)) {
        // Fallback for when IdentitySlotFirewall is not available
        // Use SlotExtractor's IdentityValidators via cleanName
        const validated = SlotExtractor.cleanName ? SlotExtractor.cleanName(value) : value;
        
        if (!validated) {
            logger.warn('[SAFE SET SLOT] ❌ REJECTED identity slot (failed validation)', {
                slotName,
                rejectedValue: value,
                source,
                reason: 'failed_identity_validation'
            });
            return { accepted: false, reason: 'failed_identity_validation', rejectedValue: value };
        }
        
        // Use validated value
        value = validated;
        
        // Check immutability - confirmed slots cannot be changed unless explicit correction
        const existingMeta = state.slotMetadata?.[slotName];
        if (existingMeta?.immutable === true && !isCorrection) {
            logger.warn('[SAFE SET SLOT] ⛔ REJECTED change to IMMUTABLE slot', {
                slotName,
                immutableValue: state.bookingCollected[slotName],
                rejectedValue: value,
                confirmedAt: existingMeta.confirmedAt
            });
            return { 
                accepted: false, 
                reason: 'immutable_slot', 
                currentValue: state.bookingCollected[slotName] 
            };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j: WRITE TO CANONICAL SLOTS STORE (non-identity or fallback)
    // ═══════════════════════════════════════════════════════════════════════════
    const previousValue = state.slots?.[slotName]?.value || state.bookingCollected?.[slotName];
    
    // Write to canonical store
    state.slots = state.slots || {};
    state.slots[slotName] = {
        value,
        source,
        confidence,
        updatedAt: new Date().toISOString(),
        previousValue: previousValue !== value ? previousValue : undefined,
        writer: 'BookingFlowRunner.safeSetSlot'
    };
    
    // Sync to bookingCollected for backward compatibility
    state.bookingCollected = state.bookingCollected || {};
    state.bookingCollected[slotName] = value;
    
    // Update legacy metadata for backward compat
    state.slotMetadata = state.slotMetadata || {};
    state.slotMetadata[slotName] = {
        ...(state.slotMetadata[slotName] || {}),
        ...state.slots[slotName]
    };
    
    logger.info('[SAFE SET SLOT] ✅ ACCEPTED slot write', {
        slotName,
        value: typeof value === 'string' ? value.substring(0, 30) : value,
        source,
        confidence,
        wasOverwrite: !!previousValue && previousValue !== value,
        canonicalStore: 'slots'
    });
    
    return { accepted: true, value, previousValue };
}

/**
 * V96f: Mark a slot as confirmed (immutable until explicit correction)
 */
function markSlotConfirmed(state, slotName) {
    // V96j: Check canonical slots store first, then bookingCollected for backward compat
    const hasValue = state.slots?.[slotName]?.value || state.bookingCollected?.[slotName];
    if (!hasValue) return;
    
    // Update canonical slots store
    state.slots = state.slots || {};
    if (state.slots[slotName]) {
        state.slots[slotName] = {
            ...state.slots[slotName],
            confirmed: true,
            immutable: true,
            confirmedAt: new Date().toISOString()
        };
    }
    
    // Update legacy metadata for backward compat
    state.slotMetadata = state.slotMetadata || {};
    state.slotMetadata[slotName] = {
        ...(state.slotMetadata[slotName] || {}),
        confirmed: true,
        immutable: true,
        confirmedAt: new Date().toISOString()
    };
    
    state.confirmedSlots = state.confirmedSlots || {};
    state.confirmedSlots[slotName] = true;
    
    logger.info('[SAFE SET SLOT] 🔒 Slot marked CONFIRMED (immutable)', { slotName, canonicalStore: 'slots' });
}

/**
 * Slot extractors - deterministic extraction for each slot type
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     * V96f: DELEGATE TO MAIN SlotExtractor - Single source of truth
     * 
     * This ensures all name extraction goes through the same validation:
     * - Phone-shaped rejection
     * - Stop word filtering
     * - Pattern hierarchy (PRIMARY vs SECONDARY)
     */
    name: (input, step, context = {}) => {
        if (!input) return null;
        
        // V96f: Use the main SlotExtractor for name extraction
        // This ensures consistent validation across the entire platform
        const result = SlotExtractor.extractName(input, context);
        
        if (result) {
            // SlotExtractor returns { value, confidence, ... } object
            const name = result.value || result;
            logger.debug('[BOOKING FLOW RUNNER] Name extracted via SlotExtractor', {
                input: input.substring(0, 30),
                extracted: name,
                patternSource: result.patternSource
            });
            return typeof name === 'string' ? name : null;
        }
        
        // Fallback: simple word extraction for direct name responses
        // (when user just says "Mark" in response to "What's your name?")
        const text = input.trim();
        const words = text.split(/\s+/)
            .filter(w => !isStopWord(w.toLowerCase()))
            .filter(w => /^[A-Za-z][A-Za-z\-'\.]*$/.test(w));
        
        if (words.length === 0) return null;
        
        // Run through cleanName for final validation
        return cleanName(words.join(' '));
    },
    
    /**
     * Extract phone number from user input
     */
    phone: (input, step, context = {}) => {
        if (!input) return null;
        
        // Remove all non-digit characters
        const digits = input.replace(/\D/g, '');
        
        // Must have at least 10 digits for a valid phone number
        if (digits.length < 10) return null;
        
        // Take last 10 digits (handles "1" country code prefix)
        const phone = digits.slice(-10);
        
        // Format as (XXX) XXX-XXXX for readability
        return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
    },
    
    /**
     * Extract address from user input
     * Note: For complex address validation, use Google Maps API (separate service)
     */
    address: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.trim();
        
        // Basic validation - should contain some address-like content
        // (number + street name pattern)
        const hasAddressPattern = /\d+\s+[A-Za-z]/.test(text);
        
        if (!hasAddressPattern && text.length < 5) {
            return null;
        }
        
        // Clean up common speech artifacts
        let address = text
            .replace(/^(?:my address is|the address is|it's|its|at)\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        return address;
    },
    
    /**
     * Extract time/date preference from user input
     */
    time: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.toLowerCase().trim();
        
        // 🚫 Guard: never treat an address-like utterance as time
        if (looksLikeAddress(text)) {
            logger.debug('[BOOKING FLOW RUNNER] Time rejected: looks like address', { text: text.substring(0, 60) });
            return null;
        }
        
        // ASAP patterns
        if (/\b(asap|as soon as possible|soon|right away|immediately|now)\b/.test(text)) {
            return 'ASAP';
        }
        
        // Explicit time of day preferences (non-greeting)
        if (/\b(morning|before noon)\b/.test(text)) {
            return 'Morning';
        }
        if (/\b(afternoon|after lunch)\b/.test(text)) {
            return 'Afternoon';
        }
        if (/\b(evening|night|after work|after 5)\b/.test(text)) {
            return 'Evening';
        }
        
        // Day patterns
        const dayMatch = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|this week)\b/i);
        if (dayMatch) {
            return titleCase(dayMatch[1]);
        }
        
        // Specific time patterns
        if (/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text)) {
            return input.trim();
        }
        if (/\b(at|around)\s+\d{1,2}(?::\d{2})?\b/i.test(text)) {
            return input.trim();
        }
        
        // Explicit preference indicators
        if (/\b(prefer|works|available|free|sometime|anytime|no preference|whenever)\b/i.test(text)) {
            return input.trim();
        }
        
        return null;
    },
    
    /**
     * Extract email from user input
     */
    email: (input, step, context = {}) => {
        if (!input) return null;
        
        // Try to find email pattern
        const emailMatch = input.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return emailMatch[0].toLowerCase();
        }
        
        return null;
    },
    
    /**
     * Extract service type from user input
     */
    serviceType: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    },
    
    /**
     * Default extractor - just return the trimmed input
     */
    default: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    }
};

/**
 * Helper functions
 */
const STATE_PATTERN = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/;
const UNIT_PATTERN = /\b(?:apt|apartment|unit|suite|ste|#)\s*[\w\-]+/i;
const STREET_SUFFIX_PATTERN = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)\b/i;

function looksLikeAddress(text) {
    if (!text) return false;
    const hasNumber = /\b\d{1,6}\b/.test(text);
    return hasNumber && STREET_SUFFIX_PATTERN.test(text);
}

function detectAddressParts(rawAddress) {
    const text = (rawAddress || '').toString().toLowerCase();
    return {
        hasCity: STATE_PATTERN.test(text) || (rawAddress || '').includes(','),
        hasState: STATE_PATTERN.test(text),
        hasZip: ZIP_PATTERN.test(text),
        hasUnit: UNIT_PATTERN.test(text)
    };
}
function isStopWord(word) {
    // V96e: Comprehensive stop words - sync with SlotExtractor.NAME_STOP_WORDS
    const stopWords = new Set([
        'is', 'are', 'was', 'were', 'be', 'been', 'am',
        'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
        'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
        'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
        'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for', 'with',
        'got', 'two', 'there', 'uh', 'um', 'yup', 'so', 'well', 'just',
        // V96e: Adverbs and state words that caused "currently" as name bug
        'currently', 'presently', 'actually', 'basically', 'usually', 'normally',
        'typically', 'generally', 'still', 'already', 'always', 'never', 'ever',
        'now', 'today', 'recently', 'sometimes', 'often', 'really', 'very',
        'nothing', 'everything', 'anything', 'something',
        // Service/trade words
        'service', 'services', 'repair', 'repairs', 'maintenance', 'conditioning',
        'air', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical'
    ]);
    return stopWords.has(word);
}

/**
 * V96e: Check if string looks like a phone number
 * Used to prevent ANI/phone contamination into name fields
 */
function looksLikePhone(str) {
    if (!str) return false;
    const digitsOnly = str.replace(/\D/g, '');
    const digitRatio = digitsOnly.length / str.length;
    return digitRatio > 0.5 && digitsOnly.length >= 7;
}

function titleCase(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function cleanName(name) {
    if (!name) return null;
    
    // V96e: Reject phone-shaped strings early
    if (looksLikePhone(name)) {
        logger.warn('[BOOKING FLOW RUNNER] ❌ V96e: Rejected phone-shaped string as name', { name });
        return null;
    }
    
    const cleaned = name
        .split(/\s+/)
        .filter(w => !isStopWord(w.toLowerCase()) && w.length > 1)
        .map(w => titleCase(w.replace(/[^A-Za-z\-'\.]/g, '')))
        .join(' ')
        .trim() || null;
    
    // V96e: Final validation - must have at least one letter
    if (cleaned && !/[a-zA-Z]/.test(cleaned)) {
        logger.warn('[BOOKING FLOW RUNNER] ❌ V96e: Rejected name with no letters', { cleaned });
        return null;
    }
    
    return cleaned;
}

/**
 * ============================================================================
 * V96n: NAME SPELLING CHECK - Now reads from company config
 * ============================================================================
 * 
 * Previously hardcoded with 28 name groups. Now reads from:
 * - company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.variantGroups
 * - company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.precomputedVariantMap
 * 
 * Config options:
 * - enabled: Master toggle (OFF by default)
 * - source: 'curated_list' | 'auto_scan'
 * - mode: '1_char_only' | 'any_variant'
 * - variantGroups: Map of { "Mark": ["Marc"], ... }
 * - precomputedVariantMap: O(1) lookup map for runtime
 * 
 * Returns: { needsCheck: boolean, variants: string[] }
 * ============================================================================
 */

// Fallback for when no config is available (legacy behavior)
const FALLBACK_VARIANT_GROUPS = {
    'mark': ['marc'],
    'marc': ['mark'],
    'john': ['jon'],
    'jon': ['john'],
    'brian': ['bryan'],
    'bryan': ['brian'],
    'eric': ['erik'],
    'erik': ['eric'],
    'sara': ['sarah'],
    'sarah': ['sara'],
    'steven': ['stephen'],
    'stephen': ['steven'],
    'sean': ['shawn', 'shaun'],
    'shawn': ['sean', 'shaun'],
    'shaun': ['sean', 'shawn'],
    'cathy': ['kathy'],
    'kathy': ['cathy']
};

/**
 * Check if a name needs spelling confirmation based on company config
 * 
 * @param {string} name - The name to check
 * @param {Object} company - Company document with aiAgentSettings
 * @returns {{ needsCheck: boolean, variants: string[], mode: string }}
 */
function checkNameSpellingVariants(name, company) {
    if (!name) return { needsCheck: false, variants: [], mode: null };
    
    const nameLower = name.toLowerCase().trim();
    const firstName = nameLower.split(/\s+/)[0];
    
    // Get config from company
    const spellingConfig = company?.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants;
    
    // Check if feature is enabled (OFF by default)
    if (!spellingConfig?.enabled) {
        // Feature disabled - use legacy fallback for basic check only
        const fallbackVariants = FALLBACK_VARIANT_GROUPS[firstName];
        if (fallbackVariants) {
            return { 
                needsCheck: true, 
                variants: fallbackVariants,
                mode: 'fallback_1_char_only',
                primaryName: firstName
            };
        }
        return { needsCheck: false, variants: [], mode: 'disabled' };
    }
    
    // Feature enabled - read from config
    const mode = spellingConfig.mode || '1_char_only';
    
    // Prefer precomputed map for O(1) lookup, fall back to variantGroups
    let variantMap = null;
    
    if (spellingConfig.precomputedVariantMap instanceof Map) {
        variantMap = spellingConfig.precomputedVariantMap;
    } else if (spellingConfig.precomputedVariantMap && typeof spellingConfig.precomputedVariantMap === 'object') {
        // Handle case where Map was serialized to object
        variantMap = new Map(Object.entries(spellingConfig.precomputedVariantMap));
    }
    
    // If no precomputed map, build lookup from variantGroups
    if (!variantMap || variantMap.size === 0) {
        if (spellingConfig.variantGroups instanceof Map) {
            variantMap = new Map();
            for (const [primary, variants] of spellingConfig.variantGroups) {
                const primaryLower = primary.toLowerCase();
                variantMap.set(primaryLower, variants.map(v => v.toLowerCase()));
                // Also add reverse lookups
                for (const variant of variants) {
                    const variantLower = variant.toLowerCase();
                    if (!variantMap.has(variantLower)) {
                        variantMap.set(variantLower, [primaryLower]);
                    } else {
                        const existing = variantMap.get(variantLower);
                        if (!existing.includes(primaryLower)) {
                            existing.push(primaryLower);
                        }
                    }
                }
            }
        } else if (spellingConfig.variantGroups && typeof spellingConfig.variantGroups === 'object') {
            // Handle case where Map was serialized to object
            variantMap = new Map();
            for (const [primary, variants] of Object.entries(spellingConfig.variantGroups)) {
                const primaryLower = primary.toLowerCase();
                const variantsList = Array.isArray(variants) ? variants : [variants];
                variantMap.set(primaryLower, variantsList.map(v => v.toLowerCase()));
                // Also add reverse lookups
                for (const variant of variantsList) {
                    const variantLower = variant.toLowerCase();
                    if (!variantMap.has(variantLower)) {
                        variantMap.set(variantLower, [primaryLower]);
                    }
                }
            }
        }
    }
    
    // Check if firstName is in variant map
    if (variantMap && variantMap.has(firstName)) {
        const variants = variantMap.get(firstName);
        
        // If mode is '1_char_only', verify at least one variant differs by only 1 char
        if (mode === '1_char_only') {
            const oneCharVariants = variants.filter(v => {
                if (v.length !== firstName.length) return Math.abs(v.length - firstName.length) === 1;
                let diff = 0;
                for (let i = 0; i < firstName.length; i++) {
                    if (firstName[i] !== v[i]) diff++;
                }
                return diff === 1;
            });
            
            if (oneCharVariants.length > 0) {
                return { 
                    needsCheck: true, 
                    variants: oneCharVariants,
                    mode,
                    primaryName: firstName
                };
            }
            return { needsCheck: false, variants: [], mode };
        }
        
        // Mode is 'any_variant' - return all variants
        return { 
            needsCheck: true, 
            variants,
            mode,
            primaryName: firstName
        };
    }
    
    return { needsCheck: false, variants: [], mode };
}

/**
 * Legacy wrapper for backward compatibility
 * Use checkNameSpellingVariants() for full config support
 */
function needsSpellingCheck(name, company = null) {
    const result = checkNameSpellingVariants(name, company);
    return result.needsCheck;
}

/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 */
class BookingFlowRunner {
    
    /**
     * ========================================================================
     * V96n: STATIC NAME SPELLING CHECK
     * ========================================================================
     * Wrapper for checkNameSpellingVariants that reads from company config.
     * 
     * @param {string} name - The name to check
     * @param {Object} company - Company document (optional, uses fallback if not provided)
     * @returns {boolean} Whether the name needs spelling confirmation
     */
    static needsSpellingCheck(name, company = null) {
        return needsSpellingCheck(name, company);
    }
    
    /**
     * ========================================================================
     * V96n: GET SPELLING VARIANTS
     * ========================================================================
     * Get full variant info including the variant names and configured script.
     * 
     * @param {string} name - The name to check
     * @param {Object} company - Company document
     * @returns {{ needsCheck: boolean, variants: string[], mode: string, primaryName: string }}
     */
    static getSpellingVariants(name, company) {
        return checkNameSpellingVariants(name, company);
    }
    
    /**
     * ========================================================================
     * V96n: BUILD SPELLING QUESTION
     * ========================================================================
     * Build the spelling confirmation question using the configured script template.
     * 
     * Template placeholders:
     * - {optionA}, {optionB}: The two name variants
     * - {letterA}, {letterB}: The differing letters
     * 
     * Example: "Just to confirm — Mark with a K or Marc with a C?"
     * 
     * @param {string} name - The caller's name
     * @param {Object} company - Company document
     * @returns {{ question: string, optionA: string, optionB: string } | null}
     */
    static buildSpellingQuestion(name, company) {
        const variantInfo = checkNameSpellingVariants(name, company);
        
        if (!variantInfo.needsCheck || variantInfo.variants.length === 0) {
            return null;
        }
        
        const firstName = variantInfo.primaryName || name.toLowerCase().split(/\s+/)[0];
        const firstNameCapitalized = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        const variant = variantInfo.variants[0];
        const variantCapitalized = variant.charAt(0).toUpperCase() + variant.slice(1);
        
        // Find differing letters
        let letterA = '', letterB = '';
        if (firstName.length === variant.length) {
            for (let i = 0; i < firstName.length; i++) {
                if (firstName[i] !== variant[i]) {
                    letterA = firstName[i].toUpperCase();
                    letterB = variant[i].toUpperCase();
                    break;
                }
            }
        } else {
            // Different lengths - use last char or highlight the difference
            letterA = firstName.charAt(firstName.length - 1).toUpperCase();
            letterB = variant.charAt(variant.length - 1).toUpperCase();
        }
        
        // Get configured script template
        const spellingConfig = company?.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants;
        const scriptTemplate = spellingConfig?.script || 
            'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?';
        
        // Replace placeholders
        const question = scriptTemplate
            .replace('{optionA}', firstNameCapitalized)
            .replace('{optionB}', variantCapitalized)
            .replace('{letterA}', letterA)
            .replace('{letterB}', letterB);
        
        return {
            question,
            optionA: firstNameCapitalized,
            optionB: variantCapitalized,
            letterA,
            letterB
        };
    }
    
    /**
     * ========================================================================
     * RUN STEP - The main entry point
     * ========================================================================
     * 
     * Called from v2twilio.js when bookingModeLocked is true.
     * 
     * KEY FEATURE: CONFIRM-VS-COLLECT LOGIC
     * - If slot already exists (from discovery, caller ID, etc.), CONFIRM it
     * - If slot missing, COLLECT it
     * - Never re-ask for information we already have!
     * 
     * @param {Object} params
     * @param {Object} params.flow - The resolved booking flow
     * @param {Object} params.state - Current booking state from Redis
     * @param {string} params.userInput - User's speech input (may be empty on first entry)
     * @param {Object} params.company - Company document
     * @param {Object} params.session - ConversationSession document
     * @param {Object} params.slots - Pre-extracted slots with confidence metadata
     * 
     * @returns {Object} Result:
     * {
     *     reply: 'What is the service address?',
     *     state: { currentStepId, bookingCollected, ... },
     *     isComplete: false,
     *     action: 'CONTINUE' | 'COMPLETE' | 'ESCALATE',
     *     debug: { ... }
     * }
     */
    static async runStep({ flow, state, userInput, company, session, callSid, slots = {}, awReader: passedAwReader = null }) {
        const startTime = Date.now();
        
        // 🔌 AW MIGRATION: Create or use AWConfigReader for traced config reads
        const awReader = passedAwReader || (AWConfigReader && company ? AWConfigReader.forCall({
            callId: callSid || 'booking-step',
            companyId: company._id?.toString() || 'unknown',
            turn: session?.metrics?.totalTurns || 0,
            runtimeConfig: company,
            readerId: 'BookingFlowRunner.runStep'
        }) : null);
        
        // V96h: Store callSid, companyId, and traceLevel in state for SLOT_WRITE_FIREWALL tracing
        // V96j: Read traceLevel via AWConfigReader if available for single-gate compliance
        let traceLevel = state._traceContext?.traceLevel || 'normal';
        if (awReader && typeof awReader.get === 'function') {
            traceLevel = awReader.get('infra.traceLevel', 'normal');
        }
        state._traceContext = {
            callSid: callSid || state._traceContext?.callSid,
            companyId: company?._id?.toString() || state._traceContext?.companyId,
            traceLevel
        };
        
        logger.info('[BOOKING FLOW RUNNER] Running step', {
            flowId: flow?.flowId,
            currentStepId: state?.currentStepId,
            hasUserInput: !!userInput,
            inputPreview: userInput?.substring(0, 50),
            existingSlots: Object.keys(slots || {}),
            hasAWReader: !!awReader
        });

        // Emit BOOKING_STEP_STATE event for debugging
        const traceCallSid = state?._traceContext?.callSid;
        const traceCompanyId = state?._traceContext?.companyId;
        const traceTurn = state?._traceContext?.turn || 0;

        if (BlackBoxLogger && traceCallSid && traceCompanyId) {
            BlackBoxLogger.logEvent({
                callId: traceCallSid,
                companyId: traceCompanyId,
                turn: traceTurn,
                type: 'BOOKING_STEP_STATE',
                data: {
                    currentStepId: state?.currentStepId,
                    expectedSlot: state?.currentStepId?.replace('_collect', '')?.replace('_confirm', ''),
                    filledSlots: Object.keys(state?.bookingCollected || {}),
                    confirmedSlots: Object.keys(state?.confirmedSlots || {}),
                    slotsSnapshot: Object.entries(state?.slots || {}).map(([key, slot]) => ({
                        slot: key,
                        value: typeof slot?.value === 'string' ? slot.value.substring(0, 30) : slot?.value,
                        confidence: slot?.confidence,
                        source: slot?.source
                    })),
                    hasUserInput: !!userInput,
                    userInputPreview: userInput?.substring(0, 50),
                    flowId: flow?.flowId,
                    totalSteps: flow?.steps?.length || 0
                }
            }).catch(() => {});
        }

        // Validate inputs
        if (!flow || !flow.steps || flow.steps.length === 0) {
            logger.error('[BOOKING FLOW RUNNER] Invalid flow - no steps', { flowId: flow?.flowId });
            return this.buildErrorResponse('Invalid booking flow configuration', state);
        }
        
        // Initialize state if needed
        state = this.initializeState(state, flow, slots);
        
        // V92: Store companyId in state for later use in buildCompletion (SMS)
        if (company?._id && !state.companyId) {
            state.companyId = company._id.toString();
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V98 FIX: FIRST TURN IN BOOKING MODE - Auto-confirm pre-filled slots
        // ═══════════════════════════════════════════════════════════════════════════
        // When booking JUST started (user said "book an appointment"), we should NOT
        // ask "Is that correct?" for pre-filled slots. The user's booking trigger
        // utterance is NOT a yes/no response to a confirmation question.
        //
        // On first turn: auto-confirm all pre-filled slots and ask for FIRST UNFILLED.
        // This prevents: "book an appointment" → "I didn't catch that, yes or no?"
        // ═══════════════════════════════════════════════════════════════════════════
        const isFirstBookingTurn = !state.bookingTurnStarted;
        if (isFirstBookingTurn) {
            state.bookingTurnStarted = true;
            
            // Auto-confirm all pre-filled slots on first booking turn
            state.confirmedSlots = state.confirmedSlots || {};
            for (const step of flow.steps) {
                const fieldKey = step.fieldKey || step.id;
                if (state.bookingCollected[fieldKey] && !state.confirmedSlots[fieldKey]) {
                    state.confirmedSlots[fieldKey] = true;
                    logger.info('[BOOKING FLOW RUNNER] V98: Auto-confirmed pre-filled slot on first booking turn', {
                        fieldKey,
                        value: state.bookingCollected[fieldKey],
                        reason: 'FIRST_BOOKING_TURN'
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V94: BOOKING_PROMPT_RESOLVED - Prove where booking config came from
        // ═══════════════════════════════════════════════════════════════════════════
        // This event is emitted ONCE when booking mode starts. It proves:
        // 1. Which config paths were read (Booking Prompt tab vs legacy)
        // 2. The exact slot configuration being used
        // 3. The resolution status (company_config vs default fallback)
        // 
        // This ends the "ghost legacy" debugging problem - you can now see in raw
        // events exactly where the booking prompts came from.
        // ═══════════════════════════════════════════════════════════════════════════
        if (!state.flowResolutionEmitted && BlackBoxLogger && callSid && company?._id) {
            state.flowResolutionEmitted = true;
            
            const resolution = flow.resolution || {};
            const stepSources = (flow.steps || []).map(step => ({
                slotId: step.id || step.fieldKey,
                promptSource: step.promptSource || 'unknown',
                hasCustomPrompt: !!(step.prompt && step.prompt !== step.defaultPrompt),
                required: step.required
            }));
            
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: company._id.toString(),
                type: 'BOOKING_PROMPT_RESOLVED',
                turn: session?.metrics?.totalTurns || 0,
                data: {
                    source: resolution.source || flow.source || 'unknown',
                    status: resolution.status || 'OK',
                    flowId: flow.flowId,
                    slotCount: flow.steps?.length || 0,
                    resolvedPaths: resolution.checkedPaths || [],
                    hasFrontDeskSlots: resolution.hasFrontDeskSlots || false,
                    hasLegacySlots: resolution.hasLegacySlots || false,
                    stepSources,
                    // Include first 3 slot prompts for quick verification
                    promptSamples: (flow.steps || []).slice(0, 3).map(s => ({
                        slot: s.id || s.fieldKey,
                        prompt: (s.prompt || '').substring(0, 100)
                    }))
                }
            }).catch(err => {
                logger.warn('[BOOKING FLOW RUNNER] Failed to emit BOOKING_PROMPT_RESOLVED', { error: err.message });
            });
            
            logger.info('[BOOKING FLOW RUNNER] V94: BOOKING_PROMPT_RESOLVED emitted', {
                flowId: flow.flowId,
                source: resolution.source || flow.source,
                slotCount: flow.steps?.length || 0
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // MERGE PRE-EXTRACTED SLOTS INTO BOOKING COLLECTED
        // ═══════════════════════════════════════════════════════════════════
        // Slots from SlotExtractor (caller ID, discovery phase) are merged here.
        // This is how we avoid re-asking for "Hi I'm Mark" later.
        // ═══════════════════════════════════════════════════════════════════
        
        // FEB 2026 FIX: Track slots that were just collected THIS turn
        // This prevents immediately asking for confirmation of a value the user just gave
        const slotsCollectedThisTurn = new Set();
        
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData?.value && !state.bookingCollected[key]) {
                    // V96f: Use safeSetSlot for identity slots, direct for others
                    // V96j: Pre-extracted slots bypass step gate (they're initial fills, not mid-booking)
                    if (IDENTITY_SLOTS.has(key)) {
                        const setResult = safeSetSlot(state, key, slotData.value, {
                            source: slotData.source || 'pre_extracted',
                            confidence: slotData.confidence || 0.8,
                            bypassStepGate: true  // V96j: Pre-fills are exempt from step gate
                        });
                        if (!setResult.accepted) {
                            logger.warn('[BOOKING FLOW RUNNER] V96f: Pre-extracted identity slot rejected', {
                                key,
                                reason: setResult.reason,
                                value: slotData.value
                            });
                            continue;
                        }
                    } else {
                        // V96j: Non-identity pre-extracted slots also write to canonical store
                        state.slots = state.slots || {};
                        state.slots[key] = {
                            value: slotData.value,
                            ...(slotData || {}),
                            source: slotData.source || 'pre_extracted',
                            bypassedStepGate: true
                        };
                        state.bookingCollected[key] = slotData.value;
                        state.slotMetadata = state.slotMetadata || {};
                        state.slotMetadata[key] = slotData;
                    }
                    slotsCollectedThisTurn.add(key);
                    logger.info('[BOOKING FLOW RUNNER] Merged pre-extracted slot', {
                        key,
                        value: slotData.value,
                        confidence: slotData.confidence,
                        source: slotData.source,
                        collectedThisTurn: true
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: VALIDATE PRE-EXTRACTED ADDRESS WITH GOOGLE GEO
        // ═══════════════════════════════════════════════════════════════════════
        // When address comes from SlotExtractor (not handleCollectMode), we still
        // need to validate it with Google Geo to:
        // 1. Normalize the address
        // 2. Detect if unit number is needed
        // 3. Set up conditional steps for propertyType/gateAccess
        // ═══════════════════════════════════════════════════════════════════════
        if (slotsCollectedThisTurn.has('address') && state.bookingCollected.address && !state.addressValidation) {
            try {
                const companyId = company?._id?.toString() || 'unknown';
                // 🔌 AW MIGRATION: Read address verification config via AWConfigReader
                let geoEnabled;
                if (awReader && typeof awReader.get === 'function') {
                    awReader.setReaderId('BookingFlowRunner.addressValidation.preExtracted');
                    geoEnabled = awReader.get('booking.addressVerification.enabled', true) !== false;
                } else {
                    // V96j: Warn about untraced config read
                    logger.warn('[BOOKING FLOW RUNNER] ⚠️ No AWConfigReader for addressVerification.enabled - untraced read', {
                        callSid: state._traceContext?.callSid
                    });
                    const frontDesk = company?.aiAgentSettings?.frontDeskBehavior || {};
                    geoEnabled = frontDesk?.booking?.addressVerification?.enabled !== false;
                }
                
                // V93: Pass callId for GEO_LOOKUP events in Raw Events
                const addressValidation = await AddressValidationService.validateAddress(
                    state.bookingCollected.address,
                    { companyId, callId: callSid, enabled: geoEnabled }
                );
                
                if (addressValidation.success && addressValidation.validated) {
                    // Use formatted address from Google
                    const formattedAddress = addressValidation.formattedAddress || addressValidation.normalized;
                    if (formattedAddress) {
                        // V96j: Route through safeSetSlot for unified firewall protection
                        // Note: bypassStepGate=true because this is a validation/normalization of the same slot
                        safeSetSlot(state, 'address', formattedAddress, {
                            source: 'google_geocoding_formatted',
                            confidence: addressValidation.confidence || 0.95,
                            bypassStepGate: true  // V96j: Geocoding updates same slot
                        });
                    }
                    
                    // Store validation metadata for conditional steps
                    state.addressValidation = {
                        raw: slots.address?.value,
                        formatted: formattedAddress,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId,
                        location: addressValidation.location,
                        needsUnit: addressValidation.needsUnit,
                        unitDetection: addressValidation.unitDetection
                    };
                    
                    // Set flag for conditional step evaluation
                    if (addressValidation.needsUnit) {
                        state.addressNeedsUnit = true;
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] Address validated (pre-extracted)', {
                        raw: slots.address?.value,
                        formatted: formattedAddress,
                        confidence: addressValidation.confidence,
                        needsUnit: addressValidation.needsUnit
                    });
                }
            } catch (geoError) {
                logger.warn('[BOOKING FLOW RUNNER] Address validation error (non-blocking)', {
                    error: geoError.message,
                    address: state.bookingCollected.address
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: HANDLE PENDING SPELLING CONFIRMATION
        // ═══════════════════════════════════════════════════════════════════════
        // If we asked user to confirm spelling and they responded, process it here.
        // User can say: "yes", "correct", "no", "wrong", or provide a corrected name.
        // ═══════════════════════════════════════════════════════════════════════
        if (state.pendingSpellingConfirm && userInput && userInput.trim()) {
            const confirmResult = this.parseConfirmationResponse(userInput);
            const { fieldKey, value, step: stepId } = state.pendingSpellingConfirm;
            
            if (confirmResult.confirmed) {
                // Spelling confirmed - mark as confirmed and proceed
                state.spellingConfirmed = true;
                delete state.pendingSpellingConfirm;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Spelling confirmed', {
                    fieldKey,
                    value
                });
                
                // Continue to next step - fall through
            } else if (confirmResult.denied) {
                // User said spelling is wrong - ask for correct spelling
                delete state.pendingSpellingConfirm;
                delete state.bookingCollected[fieldKey];
                if (state.confirmedSlots) delete state.confirmedSlots[fieldKey];
                state.spellingConfirmed = false;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Spelling denied - re-asking', {
                    fieldKey,
                    originalValue: value
                });
                
                return {
                    reply: "I apologize. Could you please spell your name for me?",
                    state,
                    isComplete: false,
                    action: 'RE_COLLECT_NAME',
                    currentStep: stepId,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'RE_COLLECT_NAME_AFTER_SPELLING_DENIED'
                    }
                };
            } else if (confirmResult.newValue) {
                // User provided a corrected name
                // V96f: Use safeSetSlot for identity field protection
                const setResult = safeSetSlot(state, fieldKey, confirmResult.newValue, {
                    source: 'spelling_correction',
                    confidence: 0.95,
                    isCorrection: true
                });
                if (!setResult.accepted) {
                    logger.warn('[BOOKING FLOW RUNNER] V96f: Spelling correction rejected', {
                        fieldKey,
                        reason: setResult.reason
                    });
                }
                state.spellingConfirmed = true;
                delete state.pendingSpellingConfirm;
                
                logger.info('[BOOKING FLOW RUNNER] V92: New name provided after spelling check', {
                    fieldKey,
                    oldValue: value,
                    newValue: confirmResult.newValue
                });
                
                // Continue to next step - fall through
            }
        }
        
        // Get current step
        const currentStep = flow.steps.find(s => s.id === state.currentStepId);
        
        // ═══════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Auto-confirm slots collected THIS turn
        // ═══════════════════════════════════════════════════════════════════
        // When user gives a value (e.g., "12155 Metro Parkway"), don't immediately
        // ask "Is that correct?" - accept it and move on. Only ask for confirmation
        // if value came from a PREVIOUS turn or from caller ID.
        //
        // V96n FIX: BUT don't auto-confirm if slot needs detailed prompts!
        // - Address: must check for city/state completeness first
        // - Name: must check for spelling confirmation or last name requirement
        // ═══════════════════════════════════════════════════════════════════
        if (slotsCollectedThisTurn.size > 0) {
            state.confirmedSlots = state.confirmedSlots || {};
            for (const key of slotsCollectedThisTurn) {
                // Only auto-confirm if it's the current step we were asking about
                if (key === state.currentStepId) {
                    // V96n: Check if this slot needs detailed prompts BEFORE auto-confirming
                    let needsDetailedPrompts = false;
                    const slotValue = state.bookingCollected[key];
                    const currentStepObj = flow.steps.find(s => (s.fieldKey || s.id) === key);
                    const slotOptions = currentStepObj?.options || {};
                    
                    // V96n: ADDRESS - Don't auto-confirm if missing city/state
                    if (key === 'address' && slotValue) {
                        const requireCity = slotOptions.requireCity !== false; // Default true
                        const requireState = slotOptions.requireState !== false;
                        
                        if (requireCity || requireState) {
                            const hasComma = slotValue.includes(',');
                            const statePattern = /\b[A-Z]{2}\b|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming)\b/i;
                            const hasState = statePattern.test(slotValue);
                            
                            if (!hasComma && !hasState) {
                                needsDetailedPrompts = true;
                                logger.info('[BOOKING FLOW] V96n: NOT auto-confirming address - needs city/state', {
                                    address: slotValue?.substring?.(0, 30),
                                    hasComma,
                                    hasState
                                });
                            }
                        }
                    }
                    
                    // V96n: NAME - Don't auto-confirm if needs spelling check or last name
                    if (key === 'name' && slotValue) {
                        const confirmSpelling = slotOptions.confirmSpelling || currentStepObj?.confirmSpelling;
                        const askFullName = slotOptions.askFullName || currentStepObj?.askFullName;
                        const askMissingNamePart = slotOptions.askMissingNamePart || currentStepObj?.askMissingNamePart;
                        
                        // Check if needs last name
                        if (askFullName && askMissingNamePart) {
                            const nameParts = slotValue.trim().split(/\s+/);
                            if (nameParts.length < 2) {
                                needsDetailedPrompts = true;
                                logger.info('[BOOKING FLOW] V96n: NOT auto-confirming name - needs last name', {
                                    name: slotValue,
                                    nameParts: nameParts.length
                                });
                            }
                        }
                        
                        // Check if needs spelling confirmation (V96n: now reads from company config)
                        if (confirmSpelling && !state.spellingConfirmed) {
                            const needsSpelling = BookingFlowRunner.needsSpellingCheck(slotValue, company);
                            if (needsSpelling) {
                                needsDetailedPrompts = true;
                                logger.info('[BOOKING FLOW] V96n: NOT auto-confirming name - needs spelling check', {
                                    name: slotValue,
                                    usingCompanyConfig: !!company?.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants?.enabled
                                });
                            }
                        }
                    }
                    
                    // Only auto-confirm if NO detailed prompts needed
                    if (!needsDetailedPrompts) {
                        state.confirmedSlots[key] = true;
                        if (state.slotMetadata?.[key]) {
                            state.slotMetadata[key].confirmed = true;
                        }
                        logger.info('[BOOKING FLOW RUNNER] Auto-confirmed slot collected this turn', {
                            key,
                            reason: 'USER_JUST_PROVIDED_VALUE'
                        });
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // FIND NEXT STEP NEEDING ACTION (CONFIRM OR COLLECT)
        // ═══════════════════════════════════════════════════════════════════
        const nextAction = this.determineNextAction(flow, state, slots, company);
        
        if (!nextAction) {
            // All required steps confirmed - go to final confirmation
            logger.info('[BOOKING FLOW RUNNER] All slots ready - building final confirmation', {
                collected: state.bookingCollected
            });
            
            // V96k: buildConfirmation now handles invariant check internally (no throws)
            return this.buildConfirmation(flow, state);
        }
        
        // Update current step to the one needing action
        if (nextAction.step.id !== state.currentStepId) {
            state.currentStepId = nextAction.step.id;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE CONFIRMATION MODE (slot exists, needs confirmation)
        // ═══════════════════════════════════════════════════════════════════
        if (nextAction.mode === 'CONFIRM') {
            return this.handleConfirmMode(nextAction, state, flow, userInput, startTime);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V96r: HANDLE COLLECT_DETAILS MODE - slot has value but needs prompts
        // ═══════════════════════════════════════════════════════════════════
        // This mode triggers when a pre-filled slot needs detailed prompts like:
        // - Spelling confirmation ("Mark with a K or a C?")
        // - Last name collection ("And what's your last name?")
        // - Address completion ("What city and state?")
        // ═══════════════════════════════════════════════════════════════════
        if (nextAction.mode === 'COLLECT_DETAILS') {
            return await this.handleCollectDetailsMode(nextAction, state, flow, userInput, company, startTime);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE COLLECT MODE (slot missing, need to ask)
        // ═══════════════════════════════════════════════════════════════════
        return await this.handleCollectMode(nextAction, state, flow, userInput, company, startTime);
    }
    
    /**
     * ========================================================================
     * V96k: VALIDATE SLOT SANITY
     * ========================================================================
     * 
     * This is the nuclear option to prevent slot contamination bugs.
     * Before we calculate the next step, validate that every slot value makes
     * sense for its slot type.
     * 
     * VALIDATION RULES:
     * 1. time slot must NOT contain street tokens (parkway, st, ave, rd, etc.)
     * 2. time slot must NOT match the current address string (exact or near)
     * 3. time slot MUST match allowed forms: morning/afternoon/evening, time ranges,
     *    asap/today/tomorrow, or actual date/time patterns
     * 
     * If a slot fails validation:
     * - Set it to null
     * - Remove from confirmedSlots
     * - Set currentStepId to that slot (force re-collection)
     * - Emit BOOKING_SLOT_SANITY_FIX event for auditing
     * 
     * This implements the "must-do guardrails" from the AI analyst:
     * "If time fails validation ⇒ set time = null, set currentStepId = 'time', 
     *  do not allow CONFIRMATION."
     * ========================================================================
     */
    /**
     * ========================================================================
     * DETERMINE NEXT ACTION - Confirm vs Collect decision
     * ========================================================================
     * 
     * For each required step, determine if we need to:
     * - CONFIRM: Slot exists (from caller ID, discovery, etc.) - ask user to confirm
     * - COLLECT: Slot missing - ask user to provide it
     * - SKIP: Slot confirmed (confidence = 1.0) - move to next
     * 
     * V96k: SLOT SANITY VALIDATION ADDED
     * Before step calculation, we validate all slots to ensure contamination hasn't occurred.
     * Example: time="12155 metro parkway" is invalid - it looks like an address!
     * 
     * @returns {Object|null} { step, mode: 'CONFIRM'|'COLLECT', existingValue }
     */
    static determineNextAction(flow, state, slots = {}, company = null) {
        const collected = state.bookingCollected || {};
        const slotMetadata = state.slotMetadata || {};
        const confirmedSlots = state.confirmedSlots || new Set();
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V96k: SANITY SWEEP ON ALL SLOTS BEFORE STEP CALCULATION (via module)
        // ═══════════════════════════════════════════════════════════════════════════
        // This prevents "time slot contamination" bugs where address data ends up
        // in the time field, causing the system to think all slots are filled.
        // ═══════════════════════════════════════════════════════════════════════════
        sanitizeBookingState(state, flow);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Track current step position to prevent going backwards
        // ═══════════════════════════════════════════════════════════════════════════
        // If we're at step "address", don't return to "name" for confirmation.
        // The flow should only move FORWARD, not backwards.
        // ═══════════════════════════════════════════════════════════════════════════
        const currentStepId = state.currentStepId;
        const currentStepIndex = currentStepId 
            ? flow.steps.findIndex(s => (s.fieldKey || s.id) === currentStepId)
            : -1;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // AUTO-CONFIRM THRESHOLD: 0.85 for utterance-sourced slots
        // ═══════════════════════════════════════════════════════════════════════════
        // When caller explicitly says "my name is Mark", confidence is 0.9.
        // This is high enough to auto-confirm without asking again.
        // Only caller ID (0.7) and low-confidence extractions need confirmation.
        // ═══════════════════════════════════════════════════════════════════════════
        const AUTO_CONFIRM_THRESHOLD = 0.85;
        
        for (let i = 0; i < flow.steps.length; i++) {
            const step = flow.steps[i];
            if (!step.required) continue;
            
            // ═══════════════════════════════════════════════════════════════════════
            // V92: CONDITIONAL STEP EVALUATION
            // ═══════════════════════════════════════════════════════════════════════
            // Steps can have a `condition` object that determines if they should run.
            // Conditions check state values like addressValidation.needsUnit
            // ═══════════════════════════════════════════════════════════════════════
            if (step.condition && !this.evaluateCondition(step.condition, state, collected)) {
                logger.debug('[BOOKING FLOW] Skipping conditional step', {
                    stepId: step.id,
                    condition: step.condition,
                    reason: 'CONDITION_NOT_MET'
                });
                continue;
            }
            
            const fieldKey = step.fieldKey || step.id;
            const existingValue = collected[fieldKey];
            const metadata = slotMetadata[fieldKey] || slots[fieldKey];
            
            // ═══════════════════════════════════════════════════════════════════════
            // V96j: Extract flow behavior options
            // ═══════════════════════════════════════════════════════════════════════
            const enforcePromptOrder = flow.enforcePromptOrder === true;
            const confirmIfPreFilled = flow.confirmIfPreFilled !== false; // Default true
            const alwaysAskEvenIfFilled = Array.isArray(flow.alwaysAskEvenIfFilled) 
                ? flow.alwaysAskEvenIfFilled 
                : [];
            const shouldAlwaysAsk = alwaysAskEvenIfFilled.includes(fieldKey) || 
                                    alwaysAskEvenIfFilled.includes(step.type);
            
            // Already confirmed by user - skip
            if (confirmedSlots.has?.(fieldKey) || state.confirmedSlots?.[fieldKey]) {
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // V96j: ENFORCE PROMPT ORDER - Always ask if configured
            // ═══════════════════════════════════════════════════════════════════════
            // If enforcePromptOrder is true, OR this slot is in alwaysAskEvenIfFilled,
            // we should ask the question even if we already have a value.
            // This ensures the script is followed exactly as configured in Booking tab.
            // ═══════════════════════════════════════════════════════════════════════
            if (enforcePromptOrder || shouldAlwaysAsk) {
                // Even with a value, ask the question (slot will be pre-filled but confirmed)
                if (!existingValue) {
                    return {
                        step,
                        mode: 'COLLECT',
                        existingValue: null
                    };
                }
                // Value exists - ask to confirm or re-ask depending on config
                if (confirmIfPreFilled || shouldAlwaysAsk) {
                    logger.debug('[BOOKING FLOW] V96j: Asking to confirm per enforcePromptOrder/alwaysAsk', {
                        fieldKey,
                        existingValue,
                        enforcePromptOrder,
                        shouldAlwaysAsk
                    });
                    return {
                        step,
                        mode: 'CONFIRM',
                        existingValue,
                        metadata,
                        reason: enforcePromptOrder ? 'ENFORCE_PROMPT_ORDER' : 'ALWAYS_ASK_CONFIG'
                    };
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Don't go backwards in the flow
            // ═══════════════════════════════════════════════════════════════════════
            // If we've passed this step (current step is later), auto-confirm it
            // This prevents: collect address → go back to confirm name
            // ═══════════════════════════════════════════════════════════════════════
            if (currentStepIndex > i && existingValue) {
                logger.debug('[BOOKING FLOW] Auto-confirming passed step', {
                    fieldKey,
                    currentStepId,
                    reason: 'FLOW_MOVED_FORWARD'
                });
                // Mark as confirmed so we don't return to it
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                continue;
            }
            
            // If no value, need to COLLECT
            if (!existingValue) {
                return {
                    step,
                    mode: 'COLLECT',
                    existingValue: null
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // V96j: RESPECT confirmIfPreFilled option
            // ═══════════════════════════════════════════════════════════════════════
            // If confirmIfPreFilled is false, skip confirmation for pre-filled slots
            // This allows callers to flow through faster when they've already given info
            // ═══════════════════════════════════════════════════════════════════════
            if (!confirmIfPreFilled) {
                // Don't ask to confirm - just accept the value and move on
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                logger.debug('[BOOKING FLOW] V96j: Auto-confirming per confirmIfPreFilled=false', {
                    fieldKey,
                    existingValue
                });
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Auto-confirm high-confidence utterance slots
            // ═══════════════════════════════════════════════════════════════════════
            // If caller said "my name is Mark" (confidence 0.9, source: utterance),
            // don't ask them to confirm it again - that's annoying!
            // Only ask for confirmation on low-confidence or caller_id slots.
            // 
            // V96r FIX: BUT DON'T skip if slot needs detailed prompts!
            // - confirmSpelling: must spell check names like Mark/Marc
            // - askFullName + askMissingNamePart: must get last name if only first given
            // - Address slots: must ask for city/state/unit per config
            // ═══════════════════════════════════════════════════════════════════════
            const isUtteranceSource = metadata?.source === 'utterance';
            const hasHighConfidence = metadata?.confidence >= AUTO_CONFIRM_THRESHOLD;
            const slotOptions = step.options || {};
            
            // V96r: Check if this slot needs detailed prompts BEFORE auto-confirming
            let needsDetailedPrompts = false;
            let detailedPromptReason = null;
            
            if (fieldKey === 'name' || step.type === 'name') {
                // Check spelling confirmation requirement (V96n: now reads from company config)
                const confirmSpelling = slotOptions.confirmSpelling || step.confirmSpelling;
                if (confirmSpelling && existingValue && BookingFlowRunner.needsSpellingCheck(existingValue, company)) {
                    needsDetailedPrompts = true;
                    detailedPromptReason = 'SPELLING_CHECK_REQUIRED';
                }
                
                // Check full name requirement
                const askFullName = slotOptions.askFullName || step.askFullName;
                const askMissingNamePart = slotOptions.askMissingNamePart || step.askMissingNamePart;
                if (askFullName && askMissingNamePart && existingValue) {
                    const nameParts = existingValue.trim().split(/\s+/);
                    if (nameParts.length < 2) {
                        needsDetailedPrompts = true;
                        detailedPromptReason = 'LAST_NAME_REQUIRED';
                    }
                }
            }
            
            if (fieldKey === 'address' || step.type === 'address') {
                // Check address completeness requirements
                const requireCity = slotOptions.requireCity !== false; // Default true
                const requireState = slotOptions.requireState !== false;
                const unitMode = slotOptions.unitNumberMode || 'smart';
                
                // V96r: If address verification features are enabled, don't auto-confirm
                // Let the address flow handle city/state/unit prompts
                if (existingValue && (requireCity || requireState || unitMode !== 'never')) {
                    // Check if address is likely incomplete (no city/state detected)
                    const hasComma = existingValue.includes(',');
                    const statePattern = /\b[A-Z]{2}\b|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s+hampshire|new\s+jersey|new\s+mexico|new\s+york|north\s+carolina|north\s+dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s+island|south\s+carolina|south\s+dakota|tennessee|texas|utah|vermont|virginia|washington|west\s+virginia|wisconsin|wyoming)\b/i;
                    const hasState = statePattern.test(existingValue);
                    
                    if (!hasComma && !hasState) {
                        needsDetailedPrompts = true;
                        detailedPromptReason = 'ADDRESS_INCOMPLETE_NEEDS_CITY_STATE';
                    }
                }
            }
            
            if (metadata?.confirmed === true || (isUtteranceSource && hasHighConfidence)) {
                // V96r: Don't auto-confirm if detailed prompts are needed
                if (needsDetailedPrompts) {
                    logger.info('[BOOKING FLOW] V96r: NOT auto-confirming - needs detailed prompts', {
                        fieldKey,
                        existingValue: existingValue?.substring?.(0, 30),
                        reason: detailedPromptReason,
                        confirmSpelling: slotOptions.confirmSpelling,
                        askFullName: slotOptions.askFullName
                    });
                    // Return this step for detailed processing instead of skipping
                    return {
                        step,
                        mode: 'COLLECT_DETAILS',
                        existingValue,
                        metadata,
                        detailReason: detailedPromptReason
                    };
                }
                
                // Auto-confirm and skip (no detailed prompts needed)
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                logger.debug('[BOOKING FLOW] Auto-confirming high-confidence slot', {
                    fieldKey,
                    confidence: metadata?.confidence,
                    source: metadata?.source
                });
                continue;
            }
            
            // Value exists but low confidence or caller_id - need to CONFIRM
            // V96n: But respect offerCallerId option for phone slots
            if (metadata?.needsConfirmation || 
                (metadata?.confidence && metadata.confidence < AUTO_CONFIRM_THRESHOLD) ||
                metadata?.source === 'caller_id') {
                
                // V96n: If phone from caller_id and offerCallerId is explicitly false, auto-confirm
                if (fieldKey === 'phone' && metadata?.source === 'caller_id') {
                    const offerCallerId = slotOptions.offerCallerId;
                    if (offerCallerId === false) {
                        // Don't offer caller ID - auto-confirm it
                        logger.debug('[BOOKING FLOW] V96n: Auto-confirming phone from caller ID (offerCallerId=false)', {
                            phone: existingValue,
                            source: metadata?.source
                        });
                        state.confirmedSlots = state.confirmedSlots || {};
                        state.confirmedSlots[fieldKey] = true;
                        continue;
                    }
                }
                
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata
                };
            }
            
            // Value exists without metadata - treat as needing confirmation if it's phone from caller ID
            // V96n: Respect offerCallerId option
            if (fieldKey === 'phone' && !metadata) {
                const offerCallerId = slotOptions.offerCallerId;
                if (offerCallerId === false) {
                    // Auto-confirm without asking
                    state.confirmedSlots = state.confirmedSlots || {};
                    state.confirmedSlots[fieldKey] = true;
                    continue;
                }
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata: { source: 'unknown', confidence: 0.7 }
                };
            }
            
            // Value exists with metadata, not explicitly needing confirmation - skip
            continue;
        }
        
        return null; // All required steps handled
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRM MODE - Ask user to confirm existing value
     * ========================================================================
     */
    static handleConfirmMode(action, state, flow, userInput, startTime) {
        const { step, existingValue, metadata } = action;
        const fieldKey = step.fieldKey || step.id;
        const slotOptions = step.options || {};
        
        // First entry or no input - ask confirmation question
        if (!userInput || userInput.trim() === '') {
            let confirmPrompt;
            
            // ═══════════════════════════════════════════════════════════════
            // V96n: Use callerIdPrompt for phone from caller ID
            // ═══════════════════════════════════════════════════════════════
            if (fieldKey === 'phone' && metadata?.source === 'caller_id' && slotOptions.offerCallerId !== false) {
                // Use configured callerIdPrompt if available
                const callerIdPrompt = slotOptions.callerIdPrompt;
                if (callerIdPrompt) {
                    confirmPrompt = callerIdPrompt.replace(/\{callerId\}/gi, existingValue || '');
                    logger.info('[BOOKING FLOW RUNNER] V96n: Using configured callerIdPrompt', {
                        template: callerIdPrompt,
                        phone: existingValue
                    });
                } else {
                    // Default caller ID prompt
                    confirmPrompt = `Is ${existingValue} a good number to reach you?`;
                }
            } else {
                confirmPrompt = this.buildConfirmPrompt(step, existingValue);
            }
            
            state.pendingConfirmation = {
                fieldKey,
                value: existingValue,
                step: step.id,
                source: metadata?.source // V96n: Track source for later handling
            };
            
            logger.info('[BOOKING FLOW RUNNER] CONFIRM MODE - Asking to confirm', {
                stepId: step.id,
                fieldKey,
                value: existingValue,
                source: metadata?.source,
                usedCallerIdPrompt: fieldKey === 'phone' && metadata?.source === 'caller_id'
            });
            
            return {
                reply: confirmPrompt,
                state,
                isComplete: false,
                action: 'CONFIRM_SLOT',
                currentStep: step.id,
                slotToConfirm: fieldKey,
                existingValue,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRM',
                    fieldKey,
                    existingValue,
                    confidence: metadata?.confidence,
                    slotSource: metadata?.source
                }
            };
        }
        
        // User responded - check if confirmed or denied
        const confirmResult = this.parseConfirmationResponse(userInput);
        
        if (confirmResult.confirmed) {
            // User confirmed - mark slot as confirmed and advance
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
            
            if (state.slotMetadata?.[fieldKey]) {
                state.slotMetadata[fieldKey].confirmed = true;
                state.slotMetadata[fieldKey].confidence = 1.0;
            }
            
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] Slot confirmed by user', {
                fieldKey,
                value: existingValue
            });
            
            // Find next action
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            // Build acknowledgment + next prompt
            const ack = 'Perfect.';
            let nextPrompt;
            
            if (nextAction.mode === 'CONFIRM') {
                nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
                state.pendingConfirmation = {
                    fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                    value: nextAction.existingValue,
                    step: nextAction.step.id
                };
            } else {
                nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
            }
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRMED',
                    confirmedField: fieldKey,
                    nextMode: nextAction.mode
                }
            };
        } else if (confirmResult.denied) {
            // User said no - switch to COLLECT mode for this slot
            delete state.bookingCollected[fieldKey];
            delete state.pendingConfirmation;
            
            if (state.slotMetadata?.[fieldKey]) {
                delete state.slotMetadata[fieldKey];
            }
            
            logger.info('[BOOKING FLOW RUNNER] User denied - switching to collect mode', {
                fieldKey,
                deniedValue: existingValue
            });
            
            const collectPrompt = step.prompt || `What is your ${step.label || step.id}?`;
            
            return {
                reply: `No problem. ${collectPrompt}`,
                state,
                isComplete: false,
                action: 'COLLECT_AFTER_DENY',
                currentStep: step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'COLLECT_AFTER_DENY',
                    fieldKey,
                    deniedValue: existingValue
                }
            };
        } else if (confirmResult.newValue) {
            // User provided a new value - use it
            // V96f: Use safeSetSlot for identity field protection
            const setResult = safeSetSlot(state, fieldKey, confirmResult.newValue, {
                source: 'user_correction_during_confirm',
                confidence: 0.95,
                isCorrection: true
            });
            if (setResult.accepted) {
                markSlotConfirmed(state, fieldKey);
            }
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] User provided new value during confirm', {
                fieldKey,
                oldValue: existingValue,
                newValue: confirmResult.newValue
            });
            
            // Advance to next
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            const ack = 'Got it.';
            const nextPrompt = nextAction.mode === 'CONFIRM'
                ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'NEW_VALUE_PROVIDED',
                    fieldKey,
                    newValue: confirmResult.newValue
                }
            };
        }
        
        // Unclear response - re-ask confirmation
        return {
            reply: "I'm sorry, I didn't catch that. Is that information correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                mode: 'CONFIRM_RETRY',
                fieldKey,
                userInput
            }
        };
    }
    
    /**
     * ========================================================================
     * V96r: HANDLE COLLECT DETAILS MODE - Slot has value but needs prompts
     * ========================================================================
     * 
     * This mode is triggered when a pre-filled slot needs additional prompts:
     * - SPELLING_CHECK_REQUIRED: Name like "Mark" needs "Mark with a K or a C?"
     * - LAST_NAME_REQUIRED: Only first name given, need last name
     * - ADDRESS_INCOMPLETE_NEEDS_CITY_STATE: Street only, need city/state
     * 
     * Unlike CONFIRM mode (yes/no), this mode asks specific questions to get
     * more details or clarification about the existing value.
     * ========================================================================
     */
    static async handleCollectDetailsMode(action, state, flow, userInput, company, startTime) {
        const { step, existingValue, metadata, detailReason } = action;
        const fieldKey = step.fieldKey || step.id;
        const slotOptions = step.options || {};
        
        logger.info('[BOOKING FLOW RUNNER] V96r: COLLECT_DETAILS mode', {
            stepId: step.id,
            fieldKey,
            existingValue: existingValue?.substring?.(0, 30),
            detailReason,
            hasUserInput: !!userInput
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // SPELLING CHECK HANDLING
        // ═══════════════════════════════════════════════════════════════════════
        if (detailReason === 'SPELLING_CHECK_REQUIRED' && (fieldKey === 'name' || step.type === 'name')) {
            // First entry - ask spelling question
            if (!userInput || userInput.trim() === '' || !state.spellingQuestionAsked) {
                const nameToSpell = existingValue;
                const firstName = nameToSpell?.split?.(/\s+/)?.[0] || nameToSpell;
                
                // Find the spelling variant group for this name
                const nameLower = firstName?.toLowerCase?.() || '';
                let variants = [];
                for (const group of SIMILAR_NAME_GROUPS) {
                    if (group.includes(nameLower)) {
                        variants = group.filter(v => v !== nameLower);
                        break;
                    }
                }
                
                let spellingPrompt;
                if (variants.length > 0) {
                    // Use configured prompt or build one with variants
                    const primaryVariant = variants[0];
                    const currentSpelling = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
                    const altSpelling = primaryVariant.charAt(0).toUpperCase() + primaryVariant.slice(1).toLowerCase();
                    
                    spellingPrompt = slotOptions.spellingVariantPrompt 
                        ? slotOptions.spellingVariantPrompt
                            .replace('{optionA}', currentSpelling)
                            .replace('{optionB}', altSpelling)
                        : `Just to confirm — is that ${currentSpelling} or ${altSpelling}?`;
                } else {
                    // Spell out letter by letter for short names
                    const spelled = firstName.toUpperCase().split('').join(' - ');
                    spellingPrompt = `Let me confirm the spelling: ${spelled}. Is that correct?`;
                }
                
                state.spellingQuestionAsked = true;
                state.pendingSpellingConfirm = {
                    fieldKey,
                    value: existingValue,
                    firstName,
                    step: step.id
                };
                
                return {
                    reply: spellingPrompt,
                    state,
                    isComplete: false,
                    action: 'CONFIRM_SPELLING',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'COLLECT_DETAILS_SPELLING',
                        firstName,
                        variants
                    }
                };
            }
            
            // User responded to spelling question
            const spellingResponse = userInput.toLowerCase().trim();
            const pendingSpelling = state.pendingSpellingConfirm;
            
            // Check if they confirmed or provided a correction
            const isYes = /^(yes|yeah|yep|correct|right|that's right|that is correct|exactly)$/i.test(spellingResponse);
            const isNo = /^(no|nope|nah|incorrect|wrong)$/i.test(spellingResponse);
            
            if (isYes || isNo) {
                // Confirmed spelling (or will correct below)
                state.spellingConfirmed = true;
                delete state.spellingQuestionAsked;
                delete state.pendingSpellingConfirm;
                
                // Now check if we also need last name
                const askFullName = slotOptions.askFullName || step.askFullName;
                const askMissingNamePart = slotOptions.askMissingNamePart || step.askMissingNamePart;
                const nameParts = existingValue.trim().split(/\s+/);
                
                if (askFullName && askMissingNamePart && nameParts.length < 2) {
                    // V99: Use UI-configured last name question
                    let lastNameQuestion = slotOptions.lastNameQuestion || step.lastNameQuestion;
                    if (!lastNameQuestion) {
                        logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for lastNameQuestion', { stepId: step.id });
                        lastNameQuestion = "And your last name?";
                    }
                    const ack = isYes ? 'Perfect.' : 'Got it.';
                    
                    state.firstNameCollected = nameParts[0];
                    state.askedForLastName = true;
                    
                    return {
                        reply: `${ack} ${lastNameQuestion}`,
                        state,
                        isComplete: false,
                        action: 'COLLECT_LAST_NAME',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'COLLECT_DETAILS_LAST_NAME',
                            firstName: nameParts[0]
                        }
                    };
                }
                
                // Spelling confirmed, no last name needed - mark as confirmed and continue
                markSlotConfirmed(state, fieldKey);
                
                const nextAction = this.determineNextAction(flow, state, {});
                if (!nextAction) {
                    return this.buildConfirmation(flow, state);
                }
                
                state.currentStepId = nextAction.step.id;
                const ack = 'Perfect.';
                const nextPrompt = nextAction.mode === 'CONFIRM'
                    ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                    : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
                
                return {
                    reply: `${ack} ${nextPrompt}`,
                    state,
                    isComplete: false,
                    action: 'CONTINUE',
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'SPELLING_CONFIRMED_CONTINUE',
                        nextStep: nextAction.step.id
                    }
                };
            }
            
            // User might have provided a corrected spelling (e.g., "Marc" instead of "Mark")
            // Extract the spelling from their response
            const possibleName = spellingResponse.replace(/[^a-zA-Z\s-]/g, '').trim();
            if (possibleName.length >= 2 && possibleName.length <= 30) {
                // Use the new spelling
                const correctedName = possibleName.charAt(0).toUpperCase() + possibleName.slice(1).toLowerCase();
                const fullCorrectedName = existingValue.replace(/^\S+/, correctedName);
                
                safeSetSlot(state, fieldKey, fullCorrectedName, {
                    source: 'spelling_correction',
                    confidence: 0.95
                });
                
                state.spellingConfirmed = true;
                delete state.spellingQuestionAsked;
                delete state.pendingSpellingConfirm;
                
                logger.info('[BOOKING FLOW RUNNER] V96r: Spelling corrected', {
                    original: existingValue,
                    corrected: fullCorrectedName
                });
                
                // Check if we need last name
                const askFullName = slotOptions.askFullName || step.askFullName;
                const askMissingNamePart = slotOptions.askMissingNamePart || step.askMissingNamePart;
                const nameParts = fullCorrectedName.trim().split(/\s+/);
                
                if (askFullName && askMissingNamePart && nameParts.length < 2) {
                    // V99: Use UI-configured last name question
                    let lastNameQuestion = slotOptions.lastNameQuestion || step.lastNameQuestion;
                    if (!lastNameQuestion) {
                        logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for lastNameQuestion', { stepId: step.id });
                        lastNameQuestion = "And your last name?";
                    }
                    state.firstNameCollected = nameParts[0];
                    state.askedForLastName = true;
                    
                    return {
                        reply: `Got it, ${correctedName}. ${lastNameQuestion}`,
                        state,
                        isComplete: false,
                        action: 'COLLECT_LAST_NAME',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'SPELLING_CORRECTED_NEED_LAST_NAME'
                        }
                    };
                }
                
                // Proceed to next step
                markSlotConfirmed(state, fieldKey);
                const nextAction = this.determineNextAction(flow, state, {});
                if (!nextAction) {
                    return this.buildConfirmation(flow, state);
                }
                
                state.currentStepId = nextAction.step.id;
                const nextPrompt = nextAction.mode === 'CONFIRM'
                    ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                    : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
                
                return {
                    reply: `Got it, ${correctedName}. ${nextPrompt}`,
                    state,
                    isComplete: false,
                    action: 'CONTINUE',
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'SPELLING_CORRECTED_CONTINUE'
                    }
                };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // LAST NAME COLLECTION HANDLING
        // ═══════════════════════════════════════════════════════════════════════
        if (detailReason === 'LAST_NAME_REQUIRED' && (fieldKey === 'name' || step.type === 'name')) {
            // First entry - ask for last name
            if (!userInput || userInput.trim() === '' || !state.askedForLastName) {
                const firstName = existingValue?.split?.(/\s+/)?.[0] || existingValue;
                // V99: Use UI-configured last name question
                let lastNameQuestion = slotOptions.lastNameQuestion || step.lastNameQuestion;
                if (!lastNameQuestion) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for lastNameQuestion', { stepId: step.id });
                    lastNameQuestion = "And your last name?";
                }
                
                state.firstNameCollected = firstName;
                state.askedForLastName = true;
                
                return {
                    reply: `Got it, ${firstName}. ${lastNameQuestion}`,
                    state,
                    isComplete: false,
                    action: 'COLLECT_LAST_NAME',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'COLLECT_DETAILS_LAST_NAME',
                        firstName
                    }
                };
            }
            
            // User provided last name
            const lastName = userInput.trim().replace(/^(it's|its|my last name is|last name)\s*/i, '').trim();
            const fullName = `${state.firstNameCollected} ${lastName}`;
            
            safeSetSlot(state, fieldKey, fullName, {
                source: 'combined_first_last',
                confidence: 0.95
            });
            markSlotConfirmed(state, fieldKey);
            
            delete state.firstNameCollected;
            delete state.askedForLastName;
            
            logger.info('[BOOKING FLOW RUNNER] V96r: Full name collected', {
                fullName
            });
            
            // Continue to next step
            const nextAction = this.determineNextAction(flow, state, {});
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            const nextPrompt = nextAction.mode === 'CONFIRM'
                ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
            
            return {
                reply: `Perfect, ${fullName}. ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'LAST_NAME_COLLECTED_CONTINUE',
                    fullName
                }
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // ADDRESS COMPLETION HANDLING
        // ═══════════════════════════════════════════════════════════════════════
        if (detailReason === 'ADDRESS_INCOMPLETE_NEEDS_CITY_STATE' && (fieldKey === 'address' || step.type === 'address')) {
            // First entry - ask for city/state
            if (!userInput || userInput.trim() === '' || !state.askedForCityState) {
                // V99: Use UI-configured prompt ONLY
                let cityStatePrompt = slotOptions.missingCityStatePrompt || 
                    step.options?.missingCityStatePrompt ||
                    slotOptions.cityPrompt;
                if (!cityStatePrompt) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for missingCityStatePrompt - using minimal fallback', {
                        stepId: step.id
                    });
                    cityStatePrompt = "What city and state?";
                }
                
                state.streetAddressCollected = existingValue;
                state.askedForCityState = true;
                
                return {
                    reply: cityStatePrompt,
                    state,
                    isComplete: false,
                    action: 'COLLECT_CITY_STATE',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'COLLECT_DETAILS_CITY_STATE',
                        streetAddress: existingValue
                    }
                };
            }
            
            // User provided city/state - now validate with Google Geo
            const cityState = userInput.trim();
            const fullAddress = `${state.streetAddressCollected}, ${cityState}`;
            
            // V96r: Call Google Geo validation for building type detection
            let geoEnabled = true;
            if (company?.aiAgentSettings?.frontDeskBehavior?.booking?.addressVerification) {
                geoEnabled = company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.enabled !== false;
            }
            
            const addressValidation = await AddressValidationService.validateAddress(
                fullAddress,
                { companyId: company?._id?.toString(), callId: null, enabled: geoEnabled }
            );
            
            // Use formatted address from Google if available
            const normalizedAddress = addressValidation.formattedAddress || addressValidation.normalized || fullAddress;
            
            safeSetSlot(state, fieldKey, normalizedAddress, {
                source: 'combined_street_city_state_geo_validated',
                confidence: addressValidation.confidence === 'HIGH' ? 0.95 : 0.9
            });
            
            // Store validation metadata
            state.addressValidation = {
                raw: fullAddress,
                formatted: normalizedAddress,
                confidence: addressValidation.confidence,
                placeId: addressValidation.placeId,
                location: addressValidation.location,
                needsUnit: addressValidation.needsUnit,
                unitDetection: addressValidation.unitDetection,
                components: addressValidation.components
            };
            
            delete state.streetAddressCollected;
            delete state.askedForCityState;
            
            logger.info('[BOOKING FLOW RUNNER] V96r: Address validated with Google Geo', {
                fullAddress,
                normalized: normalizedAddress,
                confidence: addressValidation.confidence,
                needsUnit: addressValidation.needsUnit,
                buildingType: addressValidation.unitDetection?.buildingType
            });
            
            // V96r: Use Google Geo's needsUnit detection for smart unit prompts
            const unitMode = slotOptions.unitNumberMode || 'smart';
            const shouldAskUnit = (
                unitMode !== 'never' && 
                !state.askedAboutUnit &&
                (unitMode === 'always_ask' || 
                 unitMode === 'house_or_unit' ||
                 (unitMode === 'smart' && addressValidation.needsUnit))
            );
            
            if (shouldAskUnit) {
                // Use building-type-aware prompt if Google detected it
                let unitPrompt;
                if (addressValidation.needsUnit && addressValidation.unitDetection?.buildingLabel) {
                    unitPrompt = `I found ${normalizedAddress}. It looks like this might be ${addressValidation.unitDetection.buildingLabel}. What's the apartment or unit number?`;
                } else if (unitMode === 'house_or_unit') {
                    unitPrompt = slotOptions.unitTypePrompt || 
                        step.options?.unitTypePrompt || 
                        "Is this a house, or an apartment, suite, or unit? If it's a unit, what's the number?";
                } else {
                    unitPrompt = slotOptions.unitNumberPrompt || 
                        step.options?.unitNumberPrompt || 
                        "Is there an apartment or unit number?";
                }
                
                state.askedAboutUnit = true;
                state.addressWithCityState = normalizedAddress;
                
                return {
                    reply: unitPrompt,
                    state,
                    isComplete: false,
                    action: 'COLLECT_UNIT',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'COLLECT_DETAILS_UNIT_GEO',
                        fullAddress: normalizedAddress,
                        needsUnit: addressValidation.needsUnit,
                        buildingType: addressValidation.unitDetection?.buildingType
                    }
                };
            }
            
            // Address complete - continue
            markSlotConfirmed(state, fieldKey);
            const nextAction = this.determineNextAction(flow, state, {});
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            const nextPrompt = nextAction.mode === 'CONFIRM'
                ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
            
            return {
                reply: `Got it, ${fullAddress}. ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'ADDRESS_COMPLETED_CONTINUE',
                    fullAddress
                }
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // FALLBACK - Shouldn't reach here, but handle gracefully
        // ═══════════════════════════════════════════════════════════════════════
        logger.warn('[BOOKING FLOW RUNNER] V96r: Unhandled COLLECT_DETAILS reason', {
            detailReason,
            fieldKey,
            existingValue
        });
        
        // Fall back to standard confirm mode
        return this.handleConfirmMode(action, state, flow, userInput, startTime);
    }
    
    /**
     * ========================================================================
     * HANDLE COLLECT MODE - Ask user to provide missing value
     * ========================================================================
     */
    static async handleCollectMode(action, state, flow, userInput, company, startTime) {
        const { step } = action;
        const fieldKey = step.fieldKey || step.id;

        // ═══════════════════════════════════════════════════════════════════════
        // V96k: HANDLE SPELLING CONFIRMATION RESPONSE
        // ═══════════════════════════════════════════════════════════════════════
        // If we asked for spelling confirmation and this is the response
        if (state.pendingSpellingConfirm && state.spellingQuestionAsked) {
            return this.handleSpellingConfirmationResponse(userInput, state, flow, step, startTime);
        }

        // Handle spelling correction response
        if (state.spellingCorrectionPending && state.pendingSpellingConfirm) {
            const correctedName = userInput.trim();
            const { fieldKey, value: originalValue } = state.pendingSpellingConfirm;

            // Replace the first name in the full name
            let finalValue = originalValue;
            if (originalValue.includes(' ')) {
                // Has last name - replace only first name
                const nameParts = originalValue.split(/\s+/);
                nameParts[0] = correctedName;
                finalValue = nameParts.join(' ');
            } else {
                // Only first name
                finalValue = correctedName;
            }

            logger.info('[BOOKING FLOW RUNNER] V96k: Spelling correction provided', {
                originalValue,
                correctedValue: finalValue,
                userProvided: correctedName
            });

            // Clean up spelling state
            delete state.pendingSpellingConfirm;
            delete state.spellingQuestionAsked;
            delete state.spellingCorrectionPending;
            delete state.tempCollectedName;

            // Store the final value and advance
            const setResult = safeSetSlot(state, fieldKey, finalValue, {
                source: 'spelling_corrected',
                confidence: 0.95
            });

            if (!setResult.accepted) {
                logger.warn('[BOOKING FLOW RUNNER] V96k: Failed to store corrected name', {
                    fieldKey,
                    finalValue,
                    reason: setResult.reason
                });
                return this.repromptStep(step, state, flow, `invalid_${fieldKey}`);
            }

            // Mark as confirmed and advance to next step
            markSlotConfirmed(state, fieldKey);

            const nextAction = this.findNextRequiredStep(flow, state);
            if (!nextAction) {
                // All steps complete - build confirmation
                return this.buildConfirmation(flow, state);
            }

            // Ask next step
            return this.askStep(nextAction.step, state, flow);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // V109e: EMPTY INPUT HANDLING - Critical fix for address breakdown bug
        // ═══════════════════════════════════════════════════════════════════════
        // When userInput is empty (GATHER_TIMEOUT / silence):
        // - If this is TRUE first entry (askCount=0) → ask the question
        // - If we've ALREADY ASKED (askCount>0) → REPROMPT same step
        // 
        // This prevents the bug where silence incorrectly triggers address
        // breakdown mode ("Let's go step by step - what's the street address?")
        // instead of reprompting the configured question.
        // ═══════════════════════════════════════════════════════════════════════
        if (!userInput || userInput.trim() === '') {
            const currentAskCount = state.askCount?.[step.id] || 0;
            
            if (currentAskCount === 0) {
                // TRUE first entry - ask the question normally
                logger.info('[BOOKING FLOW RUNNER] COLLECT MODE - First ask for slot', {
                    stepId: step.id,
                    askCount: 0,
                    prompt: step.prompt?.substring(0, 50)
                });
                return this.askStep(step, state, flow);
            } else {
                // V109e: Already asked but got empty input → REPROMPT same step
                // Do NOT call askStep() - that would reinitialize address breakdown
                logger.info('[BOOKING FLOW RUNNER] V109e: Empty input after asking - REPROMPT same step', {
                    stepId: step.id,
                    askCount: currentAskCount,
                    reason: 'empty_input_not_first_ask',
                    willReprompt: true
                });
                
                // Increment ask count
                state.askCount = state.askCount || {};
                state.askCount[step.id] = currentAskCount + 1;
                
                // Check max attempts
                const maxAttempts = step.maxAttempts || step.options?.maxAttempts || 3;
                if (state.askCount[step.id] >= maxAttempts) {
                    logger.warn('[BOOKING FLOW RUNNER] V109e: Max attempts reached on empty input - escalating', {
                        stepId: step.id,
                        askCount: state.askCount[step.id],
                        maxAttempts
                    });
                    return this.buildEscalation(step, state, flow, 
                        `Unable to collect ${step.label || step.id} - no response after ${maxAttempts} attempts`);
                }
                
                return this.repromptStep(step, state, flow, 'empty_input');
            }
        }
        
        // User responded - extract value
        const extractResult = this.extractValue(userInput, step, state, company);
        
        if (!extractResult.isValid) {
            // Invalid input - reprompt
            state.askCount = state.askCount || {};
            state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
            
            // ═══════════════════════════════════════════════════════════════
            // MAX ATTEMPTS: Read from step config (UI-driven), default to 3
            // ═══════════════════════════════════════════════════════════════
            const maxAttempts = step.maxAttempts || step.options?.maxAttempts || 3;
            
            if (state.askCount[step.id] >= maxAttempts) {
                logger.warn('[BOOKING FLOW RUNNER] Max attempts reached - escalating', {
                    stepId: step.id,
                    askCount: state.askCount[step.id],
                    maxAttempts
                });
                return this.buildEscalation(step, state, flow, 
                    `Unable to collect ${step.label || step.id} after ${maxAttempts} attempts`);
            }
            
            return this.repromptStep(step, state, flow, extractResult.reason);
        }
        
        // Valid input - store and advance
        let valueToStore = extractResult.value;
        let addressValidation = null;
        
        // ═══════════════════════════════════════════════════════════════════════
        // V99: ADDRESS BREAKDOWN - Step-by-step collection using UI prompts
        // ═══════════════════════════════════════════════════════════════════════
        // When breakDownIfUnclear=true, collect address components separately:
        // street → city → zip → unit (if configured)
        // ALL prompts come from Booking Prompt tab - NO hardcoded values
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'address' || step.type === 'address') && state.addressBreakdown) {
            const slotOptions = step.options || {};
            const breakdown = state.addressBreakdown;
            const phase = breakdown.phase;
            const userInput = extractResult.value;
            
            logger.info('[BOOKING FLOW RUNNER] V99: Processing address breakdown response', {
                phase,
                userInput: userInput?.substring(0, 30),
                collected: breakdown.collected
            });
            
            // Store the current phase value
            breakdown.collected[phase] = userInput;
            
            // Determine next phase based on UI config
            const requireZip = slotOptions.requireZip === true;
            const requireUnit = slotOptions.unitNumberMode !== 'never';
            
            let nextPhase = null;
            let nextPrompt = null;
            let promptSource = null;
            
            if (phase === 'street') {
                nextPhase = 'city';
                nextPrompt = slotOptions.cityPrompt;
                promptSource = 'bookingPromptTab:cityPrompt';
            } else if (phase === 'city') {
                if (requireZip) {
                    nextPhase = 'zip';
                    nextPrompt = slotOptions.zipPrompt;
                    promptSource = 'bookingPromptTab:zipPrompt';
                } else if (requireUnit) {
                    nextPhase = 'unit';
                    nextPrompt = slotOptions.unitNumberPrompt || slotOptions.unitTypePrompt;
                    promptSource = 'bookingPromptTab:unitNumberPrompt';
                } else {
                    nextPhase = null; // Complete
                }
            } else if (phase === 'zip') {
                if (requireUnit) {
                    nextPhase = 'unit';
                    nextPrompt = slotOptions.unitNumberPrompt || slotOptions.unitTypePrompt;
                    promptSource = 'bookingPromptTab:unitNumberPrompt';
                } else {
                    nextPhase = null; // Complete
                }
            } else if (phase === 'unit') {
                nextPhase = null; // Complete
            }
            
            if (nextPhase && nextPrompt) {
                // Advance to next phase
                breakdown.phase = nextPhase;
                
                logger.info('[BOOKING FLOW RUNNER] V99: Address breakdown - asking next component', {
                    nextPhase,
                    nextPrompt: nextPrompt?.substring(0, 50),
                    promptSource
                });
                
                return {
                    reply: nextPrompt,
                    state,
                    isComplete: false,
                    action: `ADDRESS_BREAKDOWN_${nextPhase.toUpperCase()}`,
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        addressBreakdownPhase: nextPhase,
                        promptSource,
                        collected: breakdown.collected
                    }
                };
            } else {
                // Address breakdown complete - assemble full address
                const fullAddress = this.assembleAddressFromBreakdown(breakdown.collected);
                
                logger.info('[BOOKING FLOW RUNNER] V99: Address breakdown complete', {
                    collected: breakdown.collected,
                    fullAddress
                });
                
                // Clear breakdown state
                delete state.addressBreakdown;
                
                // Store the assembled address and continue with validation
                extractResult.value = fullAddress;
                valueToStore = fullAddress;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: GOOGLE GEO VALIDATION FOR ADDRESS
        // ═══════════════════════════════════════════════════════════════════════
        // When collecting address, validate with Google Maps API:
        // - If HIGH confidence → use formatted address
        // - If needsUnit → ask for unit number
        // - If LOW confidence → ask for clarification
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'address' || step.type === 'address') && extractResult.value) {
            try {
                const companyId = company?._id?.toString() || 'unknown';
                // 🔌 AW MIGRATION: Read address verification config via AWConfigReader
                let geoEnabled;
                if (awReader && typeof awReader.get === 'function') {
                    awReader.setReaderId('BookingFlowRunner.addressValidation.collect');
                    geoEnabled = awReader.get('booking.addressVerification.enabled', true) !== false;
                } else {
                    // V96j: Warn about untraced config read
                    logger.warn('[BOOKING FLOW RUNNER] ⚠️ No AWConfigReader for addressVerification.enabled - untraced read', {
                        callSid: state._traceContext?.callSid
                    });
                    const frontDesk = company?.aiAgentSettings?.frontDeskBehavior || {};
                    geoEnabled = frontDesk?.booking?.addressVerification?.enabled !== false;
                }
                
                // V93: Pass callId for GEO_LOOKUP events in Raw Events
                addressValidation = await AddressValidationService.validateAddress(
                    extractResult.value,
                    { companyId, callId: callSid, enabled: geoEnabled }
                );
                
                // ═══════════════════════════════════════════════════════════════
                // V96n FIX: ADDRESS COMPLETENESS POLICY
                // PRIORITY: Booking Prompt slot options > AWConfigReader > hardcoded defaults
                // ═══════════════════════════════════════════════════════════════
                // The Booking Prompt tab saves to step.options (via extractSlotOptions)
                // AWConfigReader is only used as fallback for legacy global config
                // ═══════════════════════════════════════════════════════════════
                const slotOptions = step.options || {};
                
                // 1. Read from slot options (Booking Prompt tab) first
                let requireCity = slotOptions.requireCity !== false; // Default true
                let requireState = slotOptions.requireState !== false;
                let requireZip = slotOptions.requireZip === true; // Default false
                let requireUnitQuestion = slotOptions.unitNumberMode !== 'never';
                let unitQuestionMode = slotOptions.unitNumberMode || 'smart';
                let missingCityStatePrompt = slotOptions.missingCityStatePrompt || slotOptions.cityPrompt;
                if (!missingCityStatePrompt) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for missingCityStatePrompt or cityPrompt', {
                        stepId: step.id,
                        slotOptionsKeys: Object.keys(slotOptions)
                    });
                    missingCityStatePrompt = "What city and state is that in?";
                }
                // V99: Use UI-configured unit prompts ONLY
                let unitTypePrompt = slotOptions.unitTypePrompt;
                if (!unitTypePrompt) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for unitTypePrompt', {
                        stepId: step.id
                    });
                    unitTypePrompt = "Is this a house or apartment? If apartment, what's the unit number?";
                }
                let unitNumberPrompt = slotOptions.unitNumberPrompt || slotOptions.unitPrompt;
                if (!unitNumberPrompt) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for unitNumberPrompt', {
                        stepId: step.id
                    });
                    unitNumberPrompt = "What's the unit number?";
                }
                
                // 2. Fall back to AWConfigReader for any undefined values (legacy global config)
                if (awReader) {
                    awReader.setReaderId('BookingFlowRunner.addressCompleteness');
                    // Only use AWConfigReader if slot options didn't have a value
                    if (slotOptions.requireCity === undefined) {
                        requireCity = awReader.get('booking.addressVerification.requireCity', true) !== false;
                    }
                    if (slotOptions.requireState === undefined) {
                        requireState = awReader.get('booking.addressVerification.requireState', true) !== false;
                    }
                    if (slotOptions.requireZip === undefined) {
                        requireZip = awReader.get('booking.addressVerification.requireZip', false) === true;
                    }
                    if (slotOptions.unitNumberMode === undefined) {
                        requireUnitQuestion = awReader.get('booking.addressVerification.requireUnitQuestion', true) !== false;
                        unitQuestionMode = awReader.get('booking.addressVerification.unitQuestionMode', 'house_or_unit');
                    }
                    if (!slotOptions.missingCityStatePrompt && !slotOptions.cityPrompt) {
                        missingCityStatePrompt = awReader.get('booking.addressVerification.missingCityStatePrompt', missingCityStatePrompt);
                    }
                    if (!slotOptions.unitTypePrompt) {
                        unitTypePrompt = awReader.get('booking.addressVerification.unitTypePrompt', unitTypePrompt);
                    }
                }
                
                logger.debug('[BOOKING FLOW] V96n: Address completeness policy loaded', {
                    source: slotOptions.requireCity !== undefined ? 'bookingPromptTab' : 'awReader',
                    requireCity,
                    requireState,
                    requireZip,
                    unitQuestionMode,
                    hasSlotOptions: Object.keys(slotOptions).length > 0
                });
                
                // Use the formatted address when available, otherwise raw
                valueToStore = addressValidation.formattedAddress || addressValidation.normalized || extractResult.value;
                
                if (addressValidation.success && addressValidation.validated) {
                    // Parse address components from Google response
                    const components = addressValidation.components || {};
                    const hasCity = !!(components.locality || components.sublocality || components.postal_town);
                    const hasState = !!(components.administrative_area_level_1);
                    const hasZip = !!(components.postal_code);
                    const hasUnit = !!(components.subpremise || state.bookingCollected?.unit);
                    
                    // Determine what's missing
                    const missing = [];
                    if (requireCity && !hasCity) missing.push('city');
                    if (requireState && !hasState) missing.push('state');
                    if (requireZip && !hasZip) missing.push('zip');
                    
                    // Store validation metadata for later use (including missing components)
                    state.addressValidation = {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId,
                        location: addressValidation.location,
                        needsUnit: addressValidation.needsUnit,
                        unitDetection: addressValidation.unitDetection,
                        components,
                        missing,
                        hasCity,
                        hasState,
                        hasZip,
                        hasUnit
                    };
                    
                    // Emit ADDRESS_VALIDATION_RESULT for debugging (V93)
                    if (BlackBoxLogger?.logEvent && callSid) {
                        BlackBoxLogger.logEvent({
                            callId: callSid,
                            companyId: companyId,
                            type: 'ADDRESS_VALIDATION_RESULT',
                            turn: state.turn || 0,
                            data: {
                                raw: extractResult.value,
                                normalizedPreview: valueToStore,
                                confidence: addressValidation.confidence,
                                missing,
                                hasCity,
                                hasState,
                                hasZip,
                                hasUnit,
                                placeId: addressValidation.placeId,
                                status: 'VALIDATED'
                            }
                        }).catch(() => {}); // Non-blocking
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] V93 Address validation result', {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        missing,
                        hasCity,
                        hasState,
                        hasUnit,
                        needsUnit: addressValidation.needsUnit
                    });
                    
                    // ═══════════════════════════════════════════════════════════════
                    // GATE 1: Missing city/state - ask follow-up BEFORE confirmation
                    // ═══════════════════════════════════════════════════════════════
                    if (missing.length > 0) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressIncomplete = true;
                        state.addressMissing = missing;
                        
                        logger.warn('[BOOKING FLOW RUNNER] V93: Address incomplete, asking for missing components', {
                            missing,
                            address: valueToStore
                        });
                        
                        return {
                            reply: missingCityStatePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_CITY_STATE',
                            currentStep: 'city_state',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'ADDRESS_INCOMPLETE',
                                missing,
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // GATE 2: Unit question (house_or_unit mode)
                    // ═══════════════════════════════════════════════════════════════
                    // If requireUnitQuestion and not yet asked, ask now
                    const alreadyAskedUnit = state.addressUnitAsked === true;
                    const shouldAskUnit = (
                        requireUnitQuestion && 
                        !alreadyAskedUnit && 
                        !hasUnit &&
                        (unitQuestionMode === 'always_ask' || 
                         (unitQuestionMode === 'house_or_unit') ||
                         (unitQuestionMode === 'smart' && addressValidation.needsUnit))
                    );
                    
                    if (shouldAskUnit) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressNeedsUnit = true;
                        state.addressUnitAsked = true;
                        
                        // V99: Use UI-configured unit prompt ONLY
                        // If Google detected a building, use unitNumberPrompt; otherwise use unitTypePrompt
                        const prompt = addressValidation.needsUnit ? unitNumberPrompt : unitTypePrompt;
                        
                        logger.info('[BOOKING FLOW RUNNER] V93: Asking unit question per policy', {
                            address: valueToStore,
                            unitQuestionMode,
                            needsUnit: addressValidation.needsUnit
                        });
                        
                        return {
                            reply: prompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_UNIT',
                            currentStep: 'unit',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'GEO_NEEDS_UNIT',
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    // Address is complete - proceed with flow
                    logger.info('[BOOKING FLOW RUNNER] V93: Address complete, proceeding', {
                        address: valueToStore,
                        hasCity,
                        hasState,
                        hasUnit
                    });
                } else {
                    // Fallback gating when geo is skipped or fails
                    const fallbackParts = detectAddressParts(extractResult.value);
                    const hasCity = fallbackParts.hasCity;
                    const hasState = fallbackParts.hasState;
                    const hasZip = fallbackParts.hasZip;
                    const hasUnit = fallbackParts.hasUnit || !!state.bookingCollected?.unit;
                    
                    const missing = [];
                    if (requireCity && !hasCity) missing.push('city');
                    if (requireState && !hasState) missing.push('state');
                    if (requireZip && !hasZip) missing.push('zip');
                    
                    state.addressValidation = {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId || null,
                        location: addressValidation.location || null,
                        needsUnit: addressValidation.needsUnit || false,
                        unitDetection: addressValidation.unitDetection || null,
                        components: null,
                        missing,
                        hasCity,
                        hasState,
                        hasZip,
                        hasUnit,
                        validated: false,
                        skipped: !!addressValidation.skipped,
                        skipReason: addressValidation.skipReason || addressValidation.failReason || null
                    };
                    
                    if (BlackBoxLogger?.logEvent && callSid) {
                        BlackBoxLogger.logEvent({
                            callId: callSid,
                            companyId: companyId,
                            type: 'ADDRESS_VALIDATION_RESULT',
                            turn: state.turn || 0,
                            data: {
                                raw: extractResult.value,
                                normalizedPreview: valueToStore,
                                confidence: addressValidation.confidence,
                                missing,
                                hasCity,
                                hasState,
                                hasZip,
                                hasUnit,
                                status: addressValidation.skipped ? 'SKIPPED' : (addressValidation.success ? 'UNVALIDATED' : 'FAILED'),
                                skipReason: addressValidation.skipReason || addressValidation.failReason || null
                            }
                        }).catch(() => {});
                    }
                    
                    if (missing.length > 0) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressIncomplete = true;
                        state.addressMissing = missing;
                        
                        logger.warn('[BOOKING FLOW RUNNER] V93: Address incomplete (no geo), asking for missing components', {
                            missing,
                            address: valueToStore
                        });
                        
                        return {
                            reply: missingCityStatePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_CITY_STATE',
                            currentStep: 'city_state',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'ADDRESS_INCOMPLETE_FALLBACK',
                                missing,
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    const alreadyAskedUnit = state.addressUnitAsked === true;
                    const shouldAskUnit = (
                        requireUnitQuestion &&
                        !alreadyAskedUnit &&
                        !hasUnit &&
                        (unitQuestionMode === 'always_ask' ||
                         (unitQuestionMode === 'house_or_unit') ||
                         (unitQuestionMode === 'smart' && addressValidation.needsUnit))
                    );
                    
                    if (shouldAskUnit) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressNeedsUnit = true;
                        state.addressUnitAsked = true;
                        
                        logger.info('[BOOKING FLOW RUNNER] V93: Asking unit question (no geo) per policy', {
                            address: valueToStore,
                            unitQuestionMode
                        });
                        
                        return {
                            reply: unitTypePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_UNIT',
                            currentStep: 'unit',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'UNIT_REQUIRED_FALLBACK',
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    if (addressValidation.confidence === 'LOW' || !addressValidation.success) {
                        logger.warn('[BOOKING FLOW RUNNER] Address validation low confidence or failed', {
                            raw: extractResult.value,
                            confidence: addressValidation.confidence,
                            reason: addressValidation.reason || addressValidation.failReason || addressValidation.skipReason
                        });
                        state.addressLowConfidence = true;
                    }
                }
            } catch (geoError) {
                logger.warn('[BOOKING FLOW RUNNER] Address validation error (non-blocking)', {
                    error: geoError.message,
                    address: extractResult.value
                });
                // Continue with raw value if Google validation fails
                valueToStore = extractResult.value;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: GOOGLE CALENDAR INTEGRATION FOR TIME SLOT
        // ═══════════════════════════════════════════════════════════════════════
        // Phase 1: Check scheduling provider mode FIRST
        // If provider=request_only, use UI-controlled time windows (no Google Calendar)
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'time' || fieldKey === 'dateTime' || step.type === 'time' || step.type === 'dateTime') && extractResult.value) {
            const companyId = company?._id?.toString();
            
            // Phase 1: Read scheduling provider via AWConfigReader
            let schedulingProvider = 'request_only'; // Default
            let timeWindows = [];
            
            if (awReader && typeof awReader.get === 'function') {
                awReader.setReaderId('BookingFlowRunner.scheduling.provider');
                schedulingProvider = awReader.get('frontDesk.scheduling.provider', 'request_only');
                
                awReader.setReaderId('BookingFlowRunner.scheduling.timeWindows');
                timeWindows = awReader.get('frontDesk.scheduling.timeWindows', []) || [];
                
                logger.info('[BOOKING FLOW RUNNER] Phase 1: Scheduling config read', {
                    provider: schedulingProvider,
                    windowCount: timeWindows.length,
                    source: 'AWConfigReader'
                });
            } else {
                logger.warn('[BOOKING FLOW RUNNER] Phase 1: No AWConfigReader - using default request_only mode');
            }
            
            // Phase 1: If provider=request_only, offer UI-controlled time windows
            if (schedulingProvider === 'request_only') {
                const userPreference = extractResult.value; // e.g., "morning", "afternoon", "ASAP"
                
                // Check if user is selecting from offered windows
                if (state.awaitingWindowSelection && timeWindows.length > 0) {
                    const normalizedInput = userPreference.toLowerCase();
                    const matchedWindow = timeWindows.find(w => 
                        normalizedInput.includes(w.label.toLowerCase()) ||
                        normalizedInput.includes(w.start) ||
                        normalizedInput.includes(w.end)
                    );
                    
                    if (matchedWindow) {
                        valueToStore = matchedWindow.label;
                        state.awaitingWindowSelection = false;
                        logger.info('[BOOKING FLOW RUNNER] Phase 1: Time window selected', {
                            selected: matchedWindow.label,
                            userInput: userPreference
                        });
                    }
                }
                
                // If we have time windows and user gave preference, offer specific windows
                if (timeWindows.length > 0 && !state.awaitingWindowSelection && !valueToStore) {
                    // Categorize windows
                    const morningWindows = timeWindows.filter(w => {
                        const hour = parseInt(w.start.split(':')[0], 10);
                        return hour < 12;
                    });
                    const afternoonWindows = timeWindows.filter(w => {
                        const hour = parseInt(w.start.split(':')[0], 10);
                        return hour >= 12;
                    });
                    
                    // Filter based on user preference
                    let relevantWindows = timeWindows;
                    if (/morning/i.test(userPreference) && morningWindows.length > 0) {
                        relevantWindows = morningWindows;
                    } else if (/afternoon/i.test(userPreference) && afternoonWindows.length > 0) {
                        relevantWindows = afternoonWindows;
                    }
                    
                    // Build window choices string
                    const windowLabels = relevantWindows.map(w => w.label);
                    const choicesFormatted = windowLabels.length === 1
                        ? windowLabels[0]
                        : windowLabels.slice(0, -1).join(', ') + ', or ' + windowLabels[windowLabels.length - 1];
                    
                    state.awaitingWindowSelection = true;
                    
                    logger.info('[BOOKING FLOW RUNNER] Phase 1: Offering UI time windows', {
                        userPreference,
                        windowsOffered: windowLabels,
                        provider: 'request_only'
                    });
                    
                    // Read time window prompt from UI
                    let timeWindowPrompt = 'Which time window works best for you?';
                    if (awReader && typeof awReader.get === 'function') {
                        awReader.setReaderId('BookingFlowRunner.scheduling.timeWindowPrompt');
                        const uiPrompt = awReader.get('frontDesk.scheduling.timeWindowPrompt', null);
                        if (uiPrompt) {
                            timeWindowPrompt = uiPrompt.replace('{windows}', choicesFormatted);
                        } else {
                            timeWindowPrompt = `I can offer ${choicesFormatted}. Which works best for you?`;
                        }
                    } else {
                        timeWindowPrompt = `I can offer ${choicesFormatted}. Which works best for you?`;
                    }
                    
                    return {
                        reply: timeWindowPrompt,
                        state,
                        isComplete: false,
                        action: 'OFFER_TIME_WINDOWS',
                        currentStep: step.id,
                        availableWindows: windowLabels,
                        matchSource: 'BOOKING_FLOW_RUNNER_PHASE1',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'REQUEST_ONLY_WINDOWS',
                            provider: schedulingProvider,
                            windowsOffered: windowLabels
                        }
                    };
                } else if (!valueToStore) {
                    // No time windows configured - store preference as-is
                    valueToStore = userPreference;
                    logger.warn('[BOOKING FLOW RUNNER] Phase 1: No time windows configured - storing raw preference', {
                        provider: schedulingProvider,
                        preference: userPreference
                    });
                }
            }
            
            // Phase 2+: Google Calendar integration (only if provider is not request_only)
            const calendarEnabled = company?.integrations?.googleCalendar?.enabled && schedulingProvider === 'google_calendar';
            const calendarConnected = company?.integrations?.googleCalendar?.connected;
            
            if (calendarEnabled && calendarConnected && companyId) {
                try {
                    const userPreference = extractResult.value; // e.g., "ASAP", "tomorrow morning", "Friday"
                    
                    // Get available slots based on user preference
                    const availableSlots = await GoogleCalendarService.findAvailableSlots(
                        companyId,
                        new Date(), // Start from now
                        step.serviceType || 'default'
                    );
                    
                    if (availableSlots && availableSlots.slots && availableSlots.slots.length > 0) {
                        // Filter slots based on user preference if possible
                        const topSlots = availableSlots.slots.slice(0, 3);
                        
                        // Format slot options for user
                        const slotChoices = topSlots.map((slot, idx) => {
                            const start = new Date(slot.start);
                            const dayName = start.toLocaleDateString('en-US', { weekday: 'long' });
                            const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                            return `${dayName} ${date} at ${time}`;
                        });
                        
                        // Store slots for selection
                        state.availableSlots = topSlots;
                        state.awaitingSlotSelection = true;
                        
                        const choicesFormatted = slotChoices.length === 1 
                            ? slotChoices[0]
                            : slotChoices.slice(0, -1).join(', ') + ', or ' + slotChoices[slotChoices.length - 1];
                        
                        logger.info('[BOOKING FLOW RUNNER] V92: Offering calendar slots', {
                            userPreference,
                            slotsFound: topSlots.length,
                            choices: slotChoices
                        });
                        
                        return {
                            reply: `I have the following available: ${choicesFormatted}. Which works best for you?`,
                            state,
                            isComplete: false,
                            action: 'OFFER_TIME_SLOTS',
                            currentStep: step.id,
                            availableSlots: slotChoices,
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'CALENDAR_SLOT_SELECTION',
                                userPreference,
                                slotsOffered: slotChoices.length
                            }
                        };
                    } else if (availableSlots?.fallback) {
                        // Calendar returned fallback mode (e.g., service not available same-day)
                        logger.info('[BOOKING FLOW RUNNER] V92: Calendar fallback mode', {
                            message: availableSlots.message,
                            reason: availableSlots.reason
                        });
                        // Store preference and let human schedule
                        valueToStore = userPreference;
                    } else {
                        // No slots available - store preference for human to handle
                        logger.warn('[BOOKING FLOW RUNNER] V92: No calendar slots available', {
                            userPreference
                        });
                        valueToStore = userPreference;
                    }
                } catch (calendarError) {
                    // Calendar error - fall back to preference capture
                    logger.warn('[BOOKING FLOW RUNNER] V92: Calendar lookup failed (non-blocking)', {
                        error: calendarError.message,
                        preference: extractResult.value
                    });
                    // Continue with user's stated preference
                    valueToStore = extractResult.value;
                }
            } else {
                // Calendar not enabled - use preference capture mode
                logger.info('[BOOKING FLOW RUNNER] V92: Calendar not enabled, using preference', {
                    calendarEnabled,
                    calendarConnected,
                    preference: extractResult.value
                });
                valueToStore = extractResult.value;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96n: PHONE BREAKDOWN - Ask for parts if number is incomplete
        // ═══════════════════════════════════════════════════════════════════════
        // If breakDownIfUnclear is enabled and phone has < 10 digits,
        // ask for area code then rest of number using configured prompts.
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'phone' || step.type === 'phone') && extractResult.value) {
            const phoneValue = extractResult.value;
            const digits = phoneValue.replace(/\D/g, '');
            const slotOptions = step.options || {};
            const breakDownIfUnclear = slotOptions.breakDownIfUnclear === true;
            
            // Check if we're in the middle of phone breakdown collection
            if (state.phoneBreakdownInProgress) {
                if (state.collectingRestOfNumber) {
                    // Got the rest of the number - combine with area code
                    const areaCode = state.phoneAreaCode || '';
                    const restDigits = digits;
                    const fullPhone = areaCode + restDigits;
                    
                    if (fullPhone.length >= 10) {
                        // Format phone number
                        const formatted = fullPhone.length === 10 
                            ? `(${fullPhone.slice(0,3)}) ${fullPhone.slice(3,6)}-${fullPhone.slice(6)}`
                            : fullPhone;
                        
                        // Clear breakdown state
                        delete state.phoneBreakdownInProgress;
                        delete state.phoneAreaCode;
                        delete state.collectingRestOfNumber;
                        
                        valueToStore = formatted;
                        
                        logger.info('[BOOKING FLOW RUNNER] V96n: Phone breakdown complete', {
                            areaCode,
                            rest: restDigits,
                            fullPhone: formatted
                        });
                    } else {
                        // Still not enough digits - ask again
                        // V99: Use UI-configured prompt
                        let restPrompt = slotOptions.restOfNumberPrompt;
                        if (!restPrompt) {
                            logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for restOfNumberPrompt', { stepId: step.id });
                            restPrompt = "And the rest?";
                        }
                        return {
                            reply: restPrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_PHONE_REST',
                            currentStep: step.id,
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'PHONE_BREAKDOWN_REST_RETRY',
                                areaCode,
                                digitsCollected: restDigits.length
                            }
                        };
                    }
                } else {
                    // Got area code - now ask for rest
                    if (digits.length >= 3) {
                        state.phoneAreaCode = digits.slice(0, 3);
                        state.collectingRestOfNumber = true;
                        
                        // V99: Use UI-configured prompt ONLY
                        let restPrompt = slotOptions.restOfNumberPrompt;
                        if (!restPrompt) {
                            logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for restOfNumberPrompt', { stepId: step.id });
                            restPrompt = "And the rest of the number?";
                        }
                        
                        logger.info('[BOOKING FLOW RUNNER] V96n: Phone area code collected, asking for rest', {
                            areaCode: state.phoneAreaCode
                        });
                        
                        return {
                            reply: restPrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_PHONE_REST',
                            currentStep: step.id,
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'PHONE_BREAKDOWN_REST',
                                areaCode: state.phoneAreaCode
                            }
                        };
                    } else {
                        // Not enough digits for area code - ask again
                        // V99: Use UI-configured prompt
                        let areaCodePrompt = slotOptions.areaCodePrompt;
                        if (!areaCodePrompt) {
                            logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for areaCodePrompt', { stepId: step.id });
                            areaCodePrompt = "What's the area code?";
                        }
                        return {
                            reply: areaCodePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_PHONE_AREA_CODE',
                            currentStep: step.id,
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'PHONE_BREAKDOWN_AREA_RETRY'
                            }
                        };
                    }
                }
            } else if (breakDownIfUnclear && digits.length < 10 && digits.length > 0) {
                // Phone is incomplete and breakdown is enabled - start breakdown flow
                if (digits.length >= 3 && digits.length < 7) {
                    // Might be area code already - ask for rest
                    state.phoneBreakdownInProgress = true;
                    state.phoneAreaCode = digits.slice(0, 3);
                    state.collectingRestOfNumber = true;
                    
                    // V99: Use UI-configured prompt ONLY
                    let restPrompt = slotOptions.restOfNumberPrompt;
                    if (!restPrompt) {
                        logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for restOfNumberPrompt', { stepId: step.id });
                        restPrompt = `Got ${digits.slice(0, 3)}. What's the rest of the number?`;
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] V96n: Starting phone breakdown (partial number)', {
                        digits,
                        assumedAreaCode: state.phoneAreaCode
                    });
                    
                    return {
                        reply: restPrompt,
                        state,
                        isComplete: false,
                        action: 'COLLECT_PHONE_REST',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'PHONE_BREAKDOWN_START',
                            partialDigits: digits
                        }
                    };
                } else {
                    // Need to ask for area code first
                    state.phoneBreakdownInProgress = true;
                    
                    let areaCodePrompt = slotOptions.areaCodePrompt;
                    if (!areaCodePrompt) {
                        logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for areaCodePrompt', {
                            stepId: step.id,
                            slotOptionsKeys: Object.keys(slotOptions)
                        });
                        areaCodePrompt = "What's the area code?";
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] V96n: Starting phone breakdown (asking area code)', {
                        digits,
                        reason: 'incomplete_phone'
                    });
                    
                    return {
                        reply: areaCodePrompt,
                        state,
                        isComplete: false,
                        action: 'COLLECT_PHONE_AREA_CODE',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'PHONE_BREAKDOWN_AREA',
                            partialDigits: digits
                        }
                    };
                }
            } else if (digits.length >= 10) {
                // Full phone number - format it
                const formatted = digits.length === 10 
                    ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,10)}`
                    : digits.length === 11 && digits[0] === '1'
                        ? `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7,11)}`
                        : phoneValue;
                valueToStore = formatted;
            }
        }
        
        // 🚫 Address plausibility guard: reject junk when not validated
        if ((fieldKey === 'address' || step.type === 'address') && extractResult.value) {
            const validated = addressValidation?.validated === true || state.addressValidation?.validated === true;
            const plausible = looksLikeAddress(extractResult.value);
            if (!validated && !plausible) {
                state.askCount = state.askCount || {};
                state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
                logger.warn('[BOOKING FLOW RUNNER] Address rejected: not plausible and not validated', {
                    input: extractResult.value,
                    validated,
                    askCount: state.askCount[step.id]
                });
                return this.repromptStep(step, state, flow, 'address_not_plausible');
            }
        }
        
        // V96f: Use safeSetSlot for identity fields, direct write for others
        if (IDENTITY_SLOTS.has(fieldKey)) {
            const setResult = safeSetSlot(state, fieldKey, valueToStore, {
                source: 'direct_collection',
                confidence: 0.9
            });
            if (setResult.accepted) {
                markSlotConfirmed(state, fieldKey);
            } else {
                logger.warn('[BOOKING FLOW RUNNER] V96f: Identity slot rejected during collection', {
                    fieldKey,
                    reason: setResult.reason,
                    value: valueToStore
                });
                return this.repromptStep(step, state, flow, `invalid_${fieldKey}`);
            }
        } else {
            // Non-identity slots (address, time, etc.) - direct write
            state.bookingCollected[fieldKey] = valueToStore;
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
        }
        state.lastExtracted = { [fieldKey]: valueToStore };
        
        if (state.askCount) {
            delete state.askCount[step.id];
        }
        
        logger.info('[BOOKING FLOW RUNNER] Value collected', {
            stepId: step.id,
            fieldKey,
            value: valueToStore,
            geoValidated: addressValidation?.success || false
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96k: SPELLING CONFIRMATION FOR COLLECT MODE
        // ═══════════════════════════════════════════════════════════════════════
        // When collecting a name in COLLECT mode (not COLLECT_DETAILS), we still
        // need to check if spelling confirmation is required for common names
        // like "Mark" vs "Marc". This logic mirrors COLLECT_DETAILS mode.
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'name' || step.type === 'name') && valueToStore) {
            const slotOptions = step.options || {};
            const confirmSpelling = slotOptions.confirmSpelling !== false; // Default true

            if (confirmSpelling) {
                const nameToSpell = valueToStore;
                const firstName = nameToSpell?.split?.(/\s+/)?.[0] || nameToSpell;

                // Check if this first name needs spelling confirmation
                const nameLower = firstName?.toLowerCase?.() || '';
                let variants = [];
                for (const group of SIMILAR_NAME_GROUPS) {
                    if (group.includes(nameLower)) {
                        variants = group.filter(v => v !== nameLower);
                        break;
                    }
                }

                if (variants.length > 0 || firstName.length <= 3) {
                    // Name needs spelling confirmation - ask now before advancing
                    logger.info('[BOOKING FLOW RUNNER] V96k: Name collected but needs spelling confirmation', {
                        name: valueToStore,
                        firstName,
                        hasVariants: variants.length > 0,
                        isShort: firstName.length <= 3
                    });

                    // Store the collected value temporarily
                    state.tempCollectedName = valueToStore;
                    state.pendingSpellingConfirm = {
                        fieldKey,
                        value: valueToStore,
                        firstName,
                        variants
                    };

                    let spellingPrompt;
                    if (variants.length > 0) {
                        // Use configured prompt or build one with variants
                        const primaryVariant = variants[0];
                        const currentSpelling = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
                        const altSpelling = primaryVariant.charAt(0).toUpperCase() + primaryVariant.slice(1).toLowerCase();

                        spellingPrompt = slotOptions.spellingVariantPrompt
                            ? slotOptions.spellingVariantPrompt
                                .replace('{optionA}', currentSpelling)
                                .replace('{optionB}', altSpelling)
                            : `Just to confirm — is that ${currentSpelling} or ${altSpelling}?`;
                    } else {
                        // Spell out letter by letter for short names
                        const spelled = firstName.toUpperCase().split('').join(' - ');
                        spellingPrompt = `Let me confirm the spelling: ${spelled}. Is that correct?`;
                    }

                    state.spellingQuestionAsked = true;

                    return {
                        reply: spellingPrompt,
                        state,
                        isComplete: false,
                        action: 'CONFIRM_SPELLING',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER'
                    };
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // V92: FULL NAME HANDLING - Wire askFullName, lastNameQuestion, etc.
        // ═══════════════════════════════════════════════════════════════════════
        // If name slot has askFullName: true and askMissingNamePart: true,
        // and user only gave first name, ask for last name before advancing
        // NOTE: Options are in step.options (from BookingFlowResolver)
        // ═══════════════════════════════════════════════════════════════════════
        const slotOptions = step.options || {};
        const askFullName = slotOptions.askFullName || step.askFullName;
        const askMissingNamePart = slotOptions.askMissingNamePart || step.askMissingNamePart;
        
        if ((fieldKey === 'name' || step.type === 'name') && askFullName && askMissingNamePart) {
            const nameParts = (valueToStore || '').trim().split(/\s+/);
            const hasLastName = nameParts.length >= 2;
            
            if (!hasLastName && !state.askedForLastName) {
                // User only gave first name - ask for last name
                const firstName = nameParts[0] || valueToStore;
                state.firstNameCollected = firstName;
                state.askedForLastName = true;
                
                // V99: Use UI-configured last name question
                let lastNameQuestion = slotOptions.lastNameQuestion || step.lastNameQuestion;
                if (!lastNameQuestion) {
                    logger.warn('[BOOKING FLOW RUNNER] V99: No UI config for lastNameQuestion', { stepId: step.id });
                    lastNameQuestion = "And your last name?";
                }
                const ack = `Got it, ${firstName}.`;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Asking for last name', {
                    firstName,
                    askFullName,
                    askMissingNamePart,
                    lastNameQuestion,
                    slotOptionsPresent: !!step.options
                });
                
                return {
                    reply: `${ack} ${lastNameQuestion}`,
                    state,
                    isComplete: false,
                    action: 'COLLECT_LAST_NAME',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'ASK_LAST_NAME',
                        firstName,
                        askFullName,
                        slotOptions: Object.keys(slotOptions)
                    }
                };
            } else if (state.firstNameCollected && state.askedForLastName) {
                // This is the last name response - combine with first name
                const lastName = valueToStore;
                const fullName = `${state.firstNameCollected} ${lastName}`;
                
                // V96f: Use safeSetSlot for combined name
                const setResult = safeSetSlot(state, fieldKey, fullName, {
                    source: 'combined_first_last',
                    confidence: 0.95
                });
                if (setResult.accepted) {
                    markSlotConfirmed(state, fieldKey);
                    valueToStore = fullName;
                } else {
                    logger.warn('[BOOKING FLOW RUNNER] V96f: Combined name rejected', {
                        fullName,
                        reason: setResult.reason
                    });
                }
                
                // Clear flags
                delete state.firstNameCollected;
                delete state.askedForLastName;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Combined full name', {
                    fullName,
                    firstName: state.firstNameCollected,
                    lastName
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96n: CONFIRM SPELLING FOR NAME - Now uses company config
        // ═══════════════════════════════════════════════════════════════════════
        // Uses nameSpellingVariants.variantGroups for spelling pairs (Mark/Marc)
        // Uses nameSpellingVariants.script for the question template
        // Example: "Just to confirm — Mark with a K or Marc with a C?"
        // ═══════════════════════════════════════════════════════════════════════
        const confirmSpelling = slotOptions.confirmSpelling || step.confirmSpelling;
        
        if ((fieldKey === 'name' || step.type === 'name') && confirmSpelling && !state.spellingConfirmed) {
            const nameToSpell = valueToStore || state.bookingCollected[fieldKey];
            
            // V96n: Use buildSpellingQuestion which reads from company config
            const spellingQuestion = nameToSpell ? this.buildSpellingQuestion(nameToSpell, company) : null;
            
            if (spellingQuestion) {
                // Check maxAsksPerCall limit
                const spellingConfig = company?.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants;
                const maxAsks = spellingConfig?.maxAsksPerCall ?? 1;
                const askedCount = state.spellingAsksThisCall || 0;
                
                if (askedCount >= maxAsks) {
                    // Already asked max spelling questions - skip this one
                    logger.info('[BOOKING FLOW RUNNER] V96n: Skipping spelling check - maxAsksPerCall reached', {
                        name: nameToSpell,
                        askedCount,
                        maxAsks
                    });
                    state.spellingConfirmed = true;
                } else {
                    // Ask spelling confirmation using configured template
                    state.pendingSpellingConfirm = {
                        fieldKey,
                        value: nameToSpell,
                        step: step.id,
                        optionA: spellingQuestion.optionA,
                        optionB: spellingQuestion.optionB
                    };
                    state.spellingAsksThisCall = askedCount + 1;
                    
                    logger.info('[BOOKING FLOW RUNNER] V96n: Asking spelling confirmation', {
                        name: nameToSpell,
                        optionA: spellingQuestion.optionA,
                        optionB: spellingQuestion.optionB,
                        usingConfigScript: !!spellingConfig?.script
                    });
                    
                    return {
                        reply: spellingQuestion.question,
                        state,
                        isComplete: false,
                        action: 'CONFIRM_SPELLING',
                        currentStep: step.id,
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        tier: 'tier1',
                        tokensUsed: 0,
                        latencyMs: Date.now() - startTime,
                        debug: {
                            source: 'BOOKING_FLOW_RUNNER',
                            flowId: flow.flowId,
                            mode: 'CONFIRM_SPELLING',
                            nameToSpell,
                            optionA: spellingQuestion.optionA,
                            optionB: spellingQuestion.optionB
                        }
                    };
                }
            } else {
                // Name doesn't need spelling check (not in variant groups)
                state.spellingConfirmed = true;
            }
        }
        
        // Find next action
        const nextAction = this.determineNextAction(flow, state, {});
        
        if (!nextAction) {
            return this.buildConfirmation(flow, state);
        }
        
        state.currentStepId = nextAction.step.id;
        
        const ack = this.buildAcknowledgment(step, extractResult.value);
        let nextPrompt;
        
        if (nextAction.mode === 'CONFIRM') {
            nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
            state.pendingConfirmation = {
                fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                value: nextAction.existingValue,
                step: nextAction.step.id
            };
        } else {
            nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
        }
        
        const reply = ack ? `${ack} ${nextPrompt}` : nextPrompt;
        
        return {
            reply,
            state,
            isComplete: false,
            action: 'CONTINUE',
            stepCompleted: step.id,
            nextStep: nextAction.step.id,
            nextMode: nextAction.mode,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                nextMode: nextAction.mode,
                extracted: extractResult.value,
                bookingCollected: state.bookingCollected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRM PROMPT - Use slot config from booking prompt tab
     * ========================================================================
     * V92 FIX: Wire confirmPrompt, askFullName, lastNameQuestion, etc.
     * from the booking prompt tab configuration instead of hardcoded defaults
     * NOTE: Options may be in step.options (from BookingFlowResolver)
     * ========================================================================
     */
    static buildConfirmPrompt(step, existingValue) {
        const type = step.type || step.id;
        const options = step.options || {};
        
        // ═══════════════════════════════════════════════════════════════════
        // V92: Use slot's confirmPrompt from booking prompt tab if available
        // Check both step.confirmPrompt and step.options.confirmPrompt
        // ═══════════════════════════════════════════════════════════════════
        const confirmPrompt = options.confirmPrompt || step.confirmPrompt;
        if (confirmPrompt) {
            // Replace {value} placeholder with actual value
            return confirmPrompt
                .replace(/\{value\}/gi, existingValue || '')
                .replace(/\{name\}/gi, existingValue || '')
                .replace(/\{address\}/gi, existingValue || '')
                .replace(/\{phone\}/gi, existingValue || '')
                .replace(/\{time\}/gi, existingValue || '');
        }
        
        // Fallback to defaults if no custom prompt configured
        switch (type) {
            case 'phone':
                return `I can send confirmations to ${existingValue}. Is this the best number to reach you?`;
            case 'name':
                return `I have your name as ${existingValue}. Is that correct?`;
            case 'address':
                return `The service address I have is ${existingValue}. Is that right?`;
            case 'email':
                return `I have your email as ${existingValue}. Is that correct?`;
            case 'time':
                return `I have you down for ${existingValue}. Does that work?`;
            default:
                return `I have ${existingValue} for your ${step.label || type}. Is that correct?`;
        }
    }
    
    /**
     * ========================================================================
     * PARSE CONFIRMATION RESPONSE
     * ========================================================================
     */
    static parseConfirmationResponse(input) {
        // V92 FIX: Strip punctuation before matching
        // "yep." should match as "yep"
        const text = (input || '').toLowerCase().trim().replace(/[.,!?]+$/, '');
        
        // Positive confirmations
        const positivePatterns = [
            /^(yes|yeah|yep|yup|correct|right|sure|ok|okay|uh huh|mhm|affirmative|absolutely|definitely)$/,
            /\b(yes|yeah|correct|right)\b.*\b(it is|that's|is)\b/,
            /\b(that's?|it's?|is)\s+(correct|right|good|fine|perfect)\b/,
            /\b(this|that)\s+(number|one)\s+(is\s+)?(good|fine|ok|correct|works)\b/,
            /\buse\s+(this|that|the same)\b/,
            /\bsounds?\s+(good|great|fine|correct)\b/
        ];
        
        if (positivePatterns.some(p => p.test(text))) {
            return { confirmed: true };
        }
        
        // Negative / denial
        const negativePatterns = [
            /^(no|nope|nah|wrong|incorrect|negative|nah)$/,
            /\b(no|not)\s+(correct|right|that's not)\b/,
            /\bthat's?\s+(wrong|incorrect|not right)\b/,
            /\bwrong\s+(number|address|name)\b/,
            /\bchange\s+(it|that)\b/,
            /\bdifferent\s+(number|one)\b/
        ];
        
        if (negativePatterns.some(p => p.test(text))) {
            return { denied: true };
        }
        
        // Check if user provided a new phone number
        const phoneMatch = input.match(/(\d[\d\-\.\(\)\s]{8,}\d)/);
        if (phoneMatch) {
            const digits = phoneMatch[1].replace(/\D/g, '');
            if (digits.length >= 10) {
                const formatted = `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
                return { newValue: formatted };
            }
        }
        
        // FEB 2026 FIX: Check if user provided an ADDRESS
        // Address pattern: number + street name (with optional street type suffix)
        // "12155 Metro Parkway", "123 Main Street", "456 Oak Drive Apt 2"
        const addressPattern = /^\d+\s+[a-zA-Z]+(?:\s+[a-zA-Z]+)*(?:\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|way|place|pl|parkway|pkwy|highway|hwy))?/i;
        if (addressPattern.test(input.trim())) {
            // User provided an address directly - use it as new value
            return { newValue: input.trim(), isAddress: true };
        }
        
        // Check if user provided what looks like a name
        // FEB 2026 FIX: Also allow lowercase names (after STT preprocessing)
        const namePattern = /^([a-zA-Z]{2,}(?:\s+[a-zA-Z]{2,})?)$/i;
        const nameMatch = input.match(namePattern);
        if (nameMatch) {
            // Title case the name
            const titleCased = nameMatch[1].split(/\s+/).map(w => 
                w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
            ).join(' ');
            return { newValue: titleCased };
        }
        
        return { unclear: true };
    }
    
    /**
     * ========================================================================
     * INITIALIZE STATE
     * ========================================================================
     * V96j: state.slots is now the CANONICAL slot store.
     * - bookingCollected is aliased for backward compatibility
     * - slotMetadata is merged into slots (slots[key].confirmedAt, etc.)
     * ========================================================================
     */
    static initializeState(state, flow, slots = {}) {
        // ═══════════════════════════════════════════════════════════════════════════
        // V96j: Initialize slots as canonical store FIRST
        // ═══════════════════════════════════════════════════════════════════════════
        const canonicalSlots = state?.slots || {};
        
        // Merge passed-in slots (pre-extracted) into canonical store
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData && !canonicalSlots[key]) {
                    canonicalSlots[key] = slotData;
                }
            }
        }
        
        // Migrate legacy bookingCollected into canonical slots if not already there
        if (state?.bookingCollected) {
            for (const [key, value] of Object.entries(state.bookingCollected)) {
                if (value !== undefined && !canonicalSlots[key]) {
                    canonicalSlots[key] = {
                        value,
                        confidence: state?.slotMetadata?.[key]?.confidence || 0.7,
                        source: state?.slotMetadata?.[key]?.source || 'legacy_migration',
                        migratedAt: new Date().toISOString()
                    };
                }
            }
        }
        
        const initialized = {
            bookingModeLocked: true,
            bookingFlowId: flow.flowId,
            currentStepId: state?.currentStepId || flow.steps[0]?.id,
            // V96j: slots is canonical, bookingCollected is derived for compatibility
            slots: canonicalSlots,
            bookingCollected: createBookingCollectedView({ slots: canonicalSlots }),
            slotMetadata: state?.slotMetadata || {},  // Keep for extended metadata
            // V96k: DO NOT carry forward confirmedSlots from previous state
            // This prevents "time pre-confirmed" bugs where contaminated data
            // from discovery mode gets treated as confirmed in booking mode
            confirmedSlots: {},
            askCount: state?.askCount || {},
            startedAt: state?.startedAt || new Date().toISOString(),
            ...state,
            // Ensure slots isn't overwritten by spread
            slots: canonicalSlots
        };
        
        // Log slot unification for debugging
        logger.debug('[BOOKING FLOW RUNNER] State initialized with canonical slots', {
            slotCount: Object.keys(canonicalSlots).length,
            slotKeys: Object.keys(canonicalSlots),
            legacyBookingCollectedKeys: Object.keys(state?.bookingCollected || {})
        });
        
        return initialized;
    }
    
    /**
     * ========================================================================
     * EXTRACT VALUE - Use slot-specific extractor
     * ========================================================================
     */
    static extractValue(input, step, state, company) {
        const type = step.type || step.id;
        const extractor = SlotExtractors[type] || SlotExtractors.default;
        
        const value = extractor(input, step, { state, company });
        
        if (!value) {
            return {
                isValid: false,
                value: null,
                reason: `Could not extract ${step.label || step.id} from input`
            };
        }
        
        // Validate extracted value
        const validation = step.validation || {};
        
        if (validation.minLength && value.length < validation.minLength) {
            return {
                isValid: false,
                value: null,
                reason: `${step.label || step.id} must be at least ${validation.minLength} characters`
            };
        }
        
        if (validation.minDigits && type === 'phone') {
            const digits = value.replace(/\D/g, '');
            if (digits.length < validation.minDigits) {
                return {
                    isValid: false,
                    value: null,
                    reason: `Phone number must have at least ${validation.minDigits} digits`
                };
            }
        }
        
        if (validation.pattern && typeof validation.pattern === 'string') {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(value)) {
                return {
                    isValid: false,
                    value: null,
                    reason: `${step.label || step.id} format is invalid`
                };
            }
        }
        
        return {
            isValid: true,
            value,
            reason: null
        };
    }
    
    /**
     * ========================================================================
     * FIND NEXT REQUIRED STEP - Skip already-collected steps
     * ========================================================================
     */
    static findNextRequiredStep(flow, state) {
        const collected = state.bookingCollected || {};
        
        for (const step of flow.steps) {
            // Skip optional steps
            if (!step.required) continue;
            
            const fieldKey = step.fieldKey || step.id;
            
            // Skip if already collected
            if (collected[fieldKey]) continue;
            
            return step;
        }
        
        return null; // All required steps collected
    }
    
    /**
     * ========================================================================
     * ASK STEP - Build response to ask for a step
     * ========================================================================
     * V99: UI-DRIVEN ADDRESS BREAKDOWN
     * If step.options.breakDownIfUnclear === true for address slots,
     * start step-by-step collection using UI-configured prompts.
     * ========================================================================
     */
    static askStep(step, state, flow) {
        const slotOptions = step.options || {};
        
        // ═══════════════════════════════════════════════════════════════════════
        // V99: ADDRESS BREAKDOWN - Use UI prompts for step-by-step collection
        // When breakDownIfUnclear=true, ask street → city → zip → unit separately
        // ALL prompts come from Booking Prompt tab - NO hardcoded defaults used
        // ═══════════════════════════════════════════════════════════════════════
        if ((step.type === 'address' || step.id === 'address') && slotOptions.breakDownIfUnclear === true) {
            // Initialize address breakdown state
            if (!state.addressBreakdown) {
                state.addressBreakdown = {
                    phase: 'street',
                    collected: {}
                };
                
                // Use streetBreakdownPrompt from UI - REQUIRED if breakDownIfUnclear is enabled
                const streetPrompt = slotOptions.streetBreakdownPrompt || step.prompt;
                
                logger.info('[BOOKING FLOW RUNNER] V99: Starting UI-driven address breakdown', {
                    stepId: step.id,
                    breakDownIfUnclear: true,
                    streetPrompt: streetPrompt?.substring(0, 50),
                    source: slotOptions.streetBreakdownPrompt ? 'bookingPromptTab:streetBreakdownPrompt' : 'bookingPromptTab:question'
                });
                
                // Track ask count
                state.askCount = state.askCount || {};
                state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
                
                return {
                    reply: streetPrompt,
                    state,
                    isComplete: false,
                    action: 'ADDRESS_BREAKDOWN_STREET',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: 0,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        currentStep: step.id,
                        addressBreakdownPhase: 'street',
                        promptSource: slotOptions.streetBreakdownPrompt 
                            ? 'bookingPromptTab:streetBreakdownPrompt' 
                            : 'bookingPromptTab:question',
                        promptPath: 'frontDeskBehavior.bookingSlots[address].streetBreakdownPrompt'
                    }
                };
            }
        }
        
        // Standard flow - use the UI-configured prompt
        const prompt = step.prompt;
        if (!prompt) {
            logger.warn('[BOOKING FLOW RUNNER] V99: No prompt configured for step - UI config required', {
                stepId: step.id,
                stepType: step.type
            });
        }
        
        // Track ask count
        state.askCount = state.askCount || {};
        state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
        
        // V99: Track exact prompt source from UI
        const promptSource = step.promptSource || 
            (step.prompt ? 'bookingPromptTab:slot.question' : 'ERROR:no_ui_prompt');
        
        return {
            reply: prompt || `What is your ${step.label || step.id}?`,
            state,
            isComplete: false,
            action: 'CONTINUE',
            currentStep: step.id,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                askCount: state.askCount[step.id],
                // V99: Exact prompt source from UI
                promptSource,
                promptPath: step.promptPath || `frontDeskBehavior.bookingSlots[${step.id}].question`
            }
        };
    }
    
    /**
     * ========================================================================
     * V99: ASSEMBLE ADDRESS FROM BREAKDOWN
     * ========================================================================
     * Combines address components collected via step-by-step breakdown
     * into a single address string for validation.
     * ========================================================================
     */
    static assembleAddressFromBreakdown(collected) {
        const parts = [];
        
        if (collected.street) {
            parts.push(collected.street);
        }
        
        if (collected.unit) {
            // Handle unit - could be "no", "house", "none", etc.
            const unitLower = (collected.unit || '').toLowerCase().trim();
            const isNoUnit = ['no', 'none', 'n/a', 'na', 'house', 'single family', 'single-family'].includes(unitLower);
            if (!isNoUnit && collected.unit.trim()) {
                // Only add if it's an actual unit number/letter
                const unitClean = collected.unit.replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, '').trim();
                if (unitClean && !/^(no|none|house)$/i.test(unitClean)) {
                    parts.push(`Unit ${unitClean}`);
                }
            }
        }
        
        if (collected.city) {
            parts.push(collected.city);
        }
        
        if (collected.zip) {
            parts.push(collected.zip);
        }
        
        const assembled = parts.join(', ');
        
        logger.info('[BOOKING FLOW RUNNER] V99: Assembled address from breakdown', {
            collected,
            assembled
        });
        
        return assembled;
    }
    
    /**
     * ========================================================================
     * REPROMPT STEP - Ask again with clarification
     * ========================================================================
     * V99: Uses UI-configured reprompt, falls back to UI question
     * ========================================================================
     */
    static repromptStep(step, state, flow, reason) {
        // V99: Use UI-configured reprompt first, then fall back to UI question
        // NO hardcoded defaults - if not configured in UI, log warning
        let reprompt;
        let promptSource;
        
        if (step.reprompt) {
            reprompt = step.reprompt;
            promptSource = 'bookingPromptTab:slot.reprompt';
        } else if (step.prompt) {
            // Use the UI question with a prefix
            reprompt = `I didn't quite catch that. ${step.prompt}`;
            promptSource = 'bookingPromptTab:slot.question:with_prefix';
        } else {
            // No UI config - log error
            logger.error('[BOOKING FLOW RUNNER] V99: No UI prompt configured for reprompt', {
                stepId: step.id,
                stepType: step.type,
                reason
            });
            reprompt = `Could you repeat that?`;
            promptSource = 'ERROR:no_ui_prompt';
        }
        
        return {
            reply: reprompt,
            state,
            isComplete: false,
            action: 'REPROMPT',
            currentStep: step.id,
            repromptReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                repromptReason: reason,
                // V96j: Exact prompt source (user directive #5)
                promptSource,
                promptPath: step.promptPath || `flow.steps[${step.id}].reprompt`,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ACKNOWLEDGMENT - Short ack for collected value
     * ========================================================================
     */
    static buildAcknowledgment(step, value) {
        const type = step.type || step.id;
        
        const acks = {
            name: ['Got it.', 'Perfect.', 'Thank you.'],
            phone: ['Great.', 'Got it.', 'Perfect.'],
            address: ['Got it.', 'Thank you.', 'Perfect.'],
            time: ['Great.', 'Perfect.', 'Sounds good.'],
            default: ['Got it.', 'Thank you.', 'Perfect.']
        };
        
        const options = acks[type] || acks.default;
        return options[Math.floor(Math.random() * options.length)];
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRMATION - All required data collected
     * ========================================================================
     * V96j: Now reads confirmationTemplate from Booking Prompt tab config
     * and logs the source for debugging
     * ========================================================================
     */
    static buildConfirmation(flow, state) {
        const collected = state.bookingCollected || {};
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96k: RECOMPUTE confirmedSlots FROM CANONICAL slots
        // ═══════════════════════════════════════════════════════════════════════
        // NEVER carry forward a stale confirmedSlots array. The trace contradiction
        // proves we were doing that before. Rebuild it from canonical state only.
        // ═══════════════════════════════════════════════════════════════════════
        const canonicalSlots = state.slots || {};
        state.confirmedSlots = {};
        for (const key of Object.keys(canonicalSlots)) {
            if (canonicalSlots[key] && canonicalSlots[key].v) {
                state.confirmedSlots[key] = true;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96k: CONFIRMATION INVARIANT CHECK
        // ═══════════════════════════════════════════════════════════════════════
        // "If currentStepId === CONFIRMATION then every required slot must pass validator.
        //  If not, emit BOOKING_STATE_INVALID and rewind to the first invalid slot."
        // 
        // This is the nuclear safety check - if we got to CONFIRMATION but have
        // invalid data (e.g. time="12155 metro parkway"), reject and rewind.
        // V96k: Using checkConfirmationInvariant module (no throws - graceful rewind)
        // ═══════════════════════════════════════════════════════════════════════
        const rewindInfo = checkConfirmationInvariant(state, flow);
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96k: BOOKING_CONFIRMATION_GUARD TRACE EVENT (requested by user)
        // ═══════════════════════════════════════════════════════════════════════
        // Emit this smoking gun trace so we can see exactly why it did/didn't
        // ask the time prompt in raw-events.
        // ═══════════════════════════════════════════════════════════════════════
        const timeValue = collected.time || state.slots?.time?.v || null;
        const timeValid = !rewindInfo || rewindInfo.invalidSlot !== 'time';
        
        if (BlackBoxLogger?.logEvent) {
            BlackBoxLogger.logEvent({
                callId: state.callId || 'unknown',
                companyId: state.companyId || 'unknown',
                type: 'BOOKING_CONFIRMATION_GUARD',
                data: {
                    timeValue,
                    timeValid,
                    whyInvalid: rewindInfo?.invalidSlot === 'time' ? rewindInfo.reason : null,
                    forcedNextStep: rewindInfo ? rewindInfo.stepId : null,
                    allSlots: Object.keys(collected),
                    requiredSlots: flow.steps.filter(s => s.required).map(s => s.fieldKey)
                }
            }).catch(() => {});
        }
        
        if (rewindInfo) {
            logger.error('[BOOKING FLOW RUNNER] ❌ V96k: CONFIRMATION INVARIANT VIOLATION', {
                invalidSlot: rewindInfo.invalidSlot,
                invalidValue: rewindInfo.invalidValue,
                reason: rewindInfo.reason,
                action: 'REWIND_VIA_STATE_UPDATE'
            });
            
            // Rewind via state update (no throw - safe)
            state.currentStepId = rewindInfo.stepId;
            state.awaitingConfirmation = false;
            
            // Re-calculate next action after rewind
            const rewindAction = this.determineNextAction(flow, state, {});
            if (!rewindAction) {
                // Shouldn't happen, but handle gracefully
                logger.warn('[BOOKING FLOW RUNNER] No action after invariant rewind');
                return this.buildErrorResponse('Unable to determine next step after validation', state);
            }
            
            // Ask the rewound step's prompt
            if (rewindAction.mode === 'COLLECT') {
                const rewindStep = rewindAction.step;
                return {
                    reply: rewindStep.prompt || `What is your ${rewindAction.step.fieldKey}?`,
                    state,
                    isComplete: false,
                    action: 'COLLECT',
                    currentStep: rewindStep.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'deterministic',
                    tokensUsed: 0,
                    latencyMs: 0,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'REWOUND_AFTER_INVARIANT_VIOLATION',
                        rewindedFrom: 'CONFIRMATION',
                        invalidSlot: rewindInfo.invalidSlot
                    }
                };
            }
        }
        
        // V96j: Track template source for debugging
        const templateSource = flow.confirmationTemplateSource || 
            (flow.confirmationTemplate ? 'config' : 'hardcoded_default');
        const isHardcoded = templateSource === 'hardcoded_default';
        
        // Build confirmation message from template
        let confirmation = flow.confirmationTemplate || 
            "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?";
        
        // V96j: Log where the confirmation prompt came from
        logger.info('[BOOKING FLOW RUNNER] Building final confirmation', {
            templateSource,
            isHardcoded,
            templatePreview: confirmation.substring(0, 80),
            collected: Object.keys(collected)
        });
        
        if (isHardcoded) {
            logger.warn('[BOOKING FLOW RUNNER] ⚠️ Using HARDCODED confirmation template - consider adding confirmationPrompt to bookingBehavior config');
        }
        
        // Replace placeholders - strip trailing punctuation to avoid double periods
        confirmation = confirmation.replace(/\{(\w+)\}/g, (match, key) => {
            const value = collected[key] || match;
            // Strip trailing punctuation from values to avoid "address 123 Main St.." issues
            if (typeof value === 'string') {
                return value.replace(/[.,!?]+$/, '').trim();
            }
            return value;
        });
        
        // Mark flow as awaiting confirmation
        state.awaitingConfirmation = true;
        state.currentStepId = 'CONFIRMATION';
        
        return {
            reply: confirmation,
            state,
            isComplete: false,
            action: 'CONFIRM',
            bookingCollected: collected,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRMATION',
                currentStep: 'CONFIRMATION',
                bookingCollected: collected,
                // V96j: Track template source
                confirmationTemplateSource: templateSource,
                isHardcodedTemplate: isHardcoded,
                // V96j: Exact prompt source (user directive #5)
                promptSource: `booking.confirmationTemplate:${templateSource}`,
                promptPath: templateSource === 'hardcoded_default' 
                    ? 'BookingFlowRunner:hardcoded_default'
                    : `flow.confirmationTemplate:${templateSource}`
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD COMPLETION - Booking finalized
     * ========================================================================
     * V92: Added SMS notification on booking complete
     * ========================================================================
     */
    static buildCompletion(flow, state, company = null) {
        // V96j: Track completion template source
        const completionTemplateSource = flow.completionTemplateSource || 
            (flow.completionTemplate ? 'config' : 'hardcoded_default');
        const completion = flow.completionTemplate ||
            "Your appointment has been scheduled. Is there anything else I can help you with?";
        
        // Unlock booking mode
        state.bookingModeLocked = false;
        state.bookingComplete = true;
        state.completedAt = new Date().toISOString();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: SEND SMS CONFIRMATION (fire-and-forget, non-blocking)
        // ═══════════════════════════════════════════════════════════════════════
        // If company has SMS notifications enabled, send booking confirmation.
        // This runs async and doesn't block the completion response.
        // ═══════════════════════════════════════════════════════════════════════
        const collected = state.bookingCollected || {};
        const companyId = company?._id?.toString() || state.companyId;
        const smsEnabled = company?.integrations?.smsNotifications?.enabled;
        const customerPhone = collected.phone;
        
        if (smsEnabled && companyId && customerPhone) {
            // Fire-and-forget SMS - don't block completion
            const bookingData = {
                customerName: collected.name || 'Customer',
                customerPhone: customerPhone,
                appointmentTime: collected.time || collected.dateTime || 'TBD',
                serviceAddress: collected.address || 'N/A',
                serviceType: collected.serviceType || flow.serviceType || 'service',
                companyName: company?.companyName || company?.name || 'Us',
                bookingId: state.bookingId || `BK-${Date.now()}`
            };
            
            SMSNotificationService.sendBookingConfirmation(companyId, bookingData)
                .then(result => {
                    logger.info('[BOOKING FLOW RUNNER] V92: SMS confirmation sent', {
                        companyId,
                        phone: customerPhone,
                        success: result?.success,
                        method: result?.method
                    });
                })
                .catch(smsError => {
                    logger.warn('[BOOKING FLOW RUNNER] V92: SMS confirmation failed (non-blocking)', {
                        companyId,
                        phone: customerPhone,
                        error: smsError.message
                    });
                });
            
            // Also schedule reminders if configured
            SMSNotificationService.scheduleReminders(companyId, bookingData)
                .catch(reminderError => {
                    logger.warn('[BOOKING FLOW RUNNER] V92: Reminder scheduling failed', {
                        companyId,
                        error: reminderError.message
                    });
                });
        } else {
            logger.info('[BOOKING FLOW RUNNER] V92: SMS notifications skipped', {
                smsEnabled,
                hasCompanyId: !!companyId,
                hasPhone: !!customerPhone
            });
        }
        
        return {
            reply: completion,
            state,
            isComplete: true,
            action: 'COMPLETE',
            bookingCollected: state.bookingCollected,
            smsSent: smsEnabled && !!customerPhone,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'COMPLETE',
                currentStep: 'COMPLETE',
                bookingCollected: state.bookingCollected,
                smsAttempted: smsEnabled && !!customerPhone,
                // V96j: Exact prompt source (user directive #5)
                completionTemplateSource,
                promptSource: `booking.completionTemplate:${completionTemplateSource}`,
                promptPath: completionTemplateSource === 'hardcoded_default'
                    ? 'BookingFlowRunner:hardcoded_default'
                    : `flow.completionTemplate:${completionTemplateSource}`
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ESCALATION - Failed to collect after 3 attempts
     * ========================================================================
     */
    static buildEscalation(step, state, flow, reason) {
        // Unlock booking mode and signal transfer
        state.bookingModeLocked = false;
        state.escalated = true;
        state.escalationReason = reason;
        
        return {
            reply: "I'm having trouble getting that information. Let me connect you with someone who can help.",
            state,
            isComplete: false,
            action: 'ESCALATE',
            requiresTransfer: true,
            transferReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'ESCALATE',
                failedStep: step.id,
                reason,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * V92: EVALUATE CONDITIONAL STEP
     * ========================================================================
     * Checks if a step's condition is met based on current state.
     * 
     * Supported conditions:
     * - { stateKey: 'addressValidation.needsUnit', equals: true }
     * - { stateKey: 'collected.propertyType', in: ['apartment', 'condo'] }
     * - { stateKey: 'addressNeedsUnit', equals: true }
     * 
     * @param {Object} condition - The condition object from step definition
     * @param {Object} state - Current booking state
     * @param {Object} collected - Collected slot values
     * @returns {boolean} True if condition is met, step should run
     */
    static evaluateCondition(condition, state, collected) {
        if (!condition) return true; // No condition = always run
        
        const { stateKey, equals, in: inArray, notNull } = condition;
        
        // Get the value from state or collected using dot notation
        let value;
        if (stateKey?.startsWith('collected.')) {
            const key = stateKey.replace('collected.', '');
            value = collected[key];
        } else {
            // Navigate nested state keys like 'addressValidation.needsUnit'
            value = stateKey?.split('.').reduce((obj, key) => obj?.[key], state);
        }
        
        // Evaluate condition type
        if (typeof equals !== 'undefined') {
            return value === equals;
        }
        
        if (Array.isArray(inArray)) {
            return inArray.includes(value);
        }
        
        if (notNull) {
            return value != null;
        }
        
        // Default: truthy check
        return !!value;
    }
    
    /**
     * ========================================================================
     * BUILD ERROR RESPONSE
     * ========================================================================
     */
    static buildErrorResponse(error, state) {
        return {
            reply: "I apologize, but I'm having trouble with the booking system. Let me connect you with someone who can help.",
            state: {
                ...state,
                bookingModeLocked: false,
                error
            },
            isComplete: false,
            action: 'ERROR',
            requiresTransfer: true,
            transferReason: error,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                stage: 'ERROR',
                error
            }
        };
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRMATION RESPONSE - Process yes/no to confirmation
     * ========================================================================
     * V92: Added company parameter for SMS notifications on completion
     * ========================================================================
     */
    static handleConfirmationResponse(userInput, flow, state, company = null) {
        const input = (userInput || '').toLowerCase().trim();
        
        // Check for confirmation
        const confirmPatterns = /^(yes|yeah|yep|yup|correct|that's right|that's correct|right|affirmative|absolutely|sure|ok|okay)$/i;
        const denyPatterns = /^(no|nope|wrong|incorrect|that's wrong|not right|change|fix|redo)$/i;
        
        if (confirmPatterns.test(input) || input.includes('yes') || input.includes('correct')) {
            // Confirmed - complete the booking
            logger.info('[BOOKING FLOW RUNNER] Confirmation received - completing booking');
            return this.buildCompletion(flow, state, company);
        }
        
        if (denyPatterns.test(input) || input.includes('no') || input.includes('wrong')) {
            // Denied - need to re-collect
            logger.info('[BOOKING FLOW RUNNER] Confirmation denied - user wants to change');
            
            // For now, just ask what they want to change
            // Future: Parse which field they want to change
            state.awaitingConfirmation = false;
            
            return {
                reply: "What would you like to change?",
                state,
                isComplete: false,
                action: 'CHANGE_REQUESTED',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    stage: 'CHANGE_REQUESTED'
                }
            };
        }
        
        // Unclear response - ask again
        return {
            reply: "I'm sorry, I didn't catch that. Is the information I read back correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRM_RETRY',
                userInput: input
            }
        };
    }

    /**
     * ========================================================================
     * V96k: HANDLE SPELLING CONFIRMATION RESPONSE
     * ========================================================================
     * Process user response to spelling confirmation question
     */
    static async handleSpellingConfirmationResponse(userInput, state, flow, step, startTime) {
        const pendingSpelling = state.pendingSpellingConfirm;
        if (!pendingSpelling) {
            logger.warn('[BOOKING FLOW RUNNER] V96k: No pending spelling confirmation', { userInput });
            return this.repromptStep(step, state, flow, 'spelling_confirmation_lost');
        }

        const spellingResponse = userInput.toLowerCase().trim();
        const { fieldKey, value: originalValue, firstName } = pendingSpelling;

        // Check if they confirmed or provided a correction
        const isYes = /^(yes|yeah|yep|correct|right|that's right|that is correct|exactly)$/i.test(spellingResponse);
        const isNo = /^(no|nope|nah|incorrect|wrong)$/i.test(spellingResponse);

        let finalValue = originalValue;

        if (isYes) {
            // Confirmed original spelling - proceed with collection
            logger.info('[BOOKING FLOW RUNNER] V96k: Spelling confirmed', {
                originalValue,
                confirmed: true
            });
        } else if (isNo) {
            // Denied - ask for correction but keep the pending state
            state.spellingCorrectionPending = true;
            return {
                reply: `What is the correct spelling for the name?`,
                state,
                isComplete: false,
                action: 'COLLECT_SPELLING_CORRECTION',
                currentStep: step.id,
                matchSource: 'BOOKING_FLOW_RUNNER'
            };
        } else {
            // User provided a new spelling directly
            const correctedName = userInput.trim();

            // Replace the first name in the full name
            if (originalValue.includes(' ')) {
                // Has last name - replace only first name
                const nameParts = originalValue.split(/\s+/);
                nameParts[0] = correctedName;
                finalValue = nameParts.join(' ');
            } else {
                // Only first name
                finalValue = correctedName;
            }

            logger.info('[BOOKING FLOW RUNNER] V96k: Spelling corrected', {
                originalValue,
                correctedValue: finalValue,
                userProvided: correctedName
            });
        }

        // Clean up spelling state
        delete state.pendingSpellingConfirm;
        delete state.spellingQuestionAsked;
        delete state.tempCollectedName;

        // Store the final value and advance
        const setResult = safeSetSlot(state, fieldKey, finalValue, {
            source: 'spelling_confirmed',
            confidence: 0.95
        });

        if (!setResult.accepted) {
            logger.warn('[BOOKING FLOW RUNNER] V96k: Failed to store corrected name', {
                fieldKey,
                finalValue,
                reason: setResult.reason
            });
            return this.repromptStep(step, state, flow, `invalid_${fieldKey}`);
        }

        // Mark as confirmed and advance to next step
        markSlotConfirmed(state, fieldKey);

        const nextAction = this.findNextRequiredStep(flow, state);
        if (!nextAction) {
            // All steps complete - build confirmation
            return this.buildConfirmation(flow, state);
        }

        // Ask next step
        return this.askStep(nextAction.step, state, flow);
    }
}

module.exports = BookingFlowRunner;
module.exports.SlotExtractors = SlotExtractors;

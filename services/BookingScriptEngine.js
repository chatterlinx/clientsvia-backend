/**
 * BookingScriptEngine.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH FOR BOOKING SLOTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service is the ONLY place that loads and normalizes booking configuration.
 * All other services (HybridReceptionistLLM, LLM0TurnHandler, etc.) must use this.
 * 
 * Why this exists:
 * - UI saves to: company.aiAgentSettings.frontDeskBehavior.bookingSlots
 * - Legacy may have: company.aiAgentSettings.callFlowEngine.bookingFields
 * - Runtime needs ONE consistent place to read from
 * 
 * NO HARDCODED INDUSTRY CONTENT. All slots are generic and per-company.
 */

const logger = require('../utils/logger');

/**
 * DEFAULT_BOOKING_SLOTS - Applied to NEW companies via Mongoose schema
 * These are NOT hardcoded fallbacks - they're seeded on company creation
 * If a company has no slots, it means they haven't configured yet
 */
const DEFAULT_BOOKING_SLOTS = [
    { 
        slotId: 'name', 
        label: 'Full Name', 
        question: 'May I have your full name?', 
        required: true, 
        order: 0, 
        type: 'text',
        confirmBack: false,
        askFullName: true,
        useFirstNameOnly: true
    },
    { 
        slotId: 'phone', 
        label: 'Phone Number', 
        question: 'What is the best phone number to reach you?', 
        required: true, 
        order: 1, 
        type: 'phone',
        confirmBack: true,
        confirmPrompt: "Just to confirm, that's {value}, correct?",
        offerCallerId: true,
        callerIdPrompt: "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?"
    },
    { 
        slotId: 'address', 
        label: 'Service Address', 
        question: 'What is the service address?', 
        required: true, 
        order: 2, 
        type: 'address',
        confirmBack: false,
        addressConfirmLevel: 'street_city'
    },
    { 
        slotId: 'time', 
        label: 'Preferred Time', 
        question: 'When works best for you?', 
        required: false, 
        order: 3, 
        type: 'time',
        confirmBack: false
    }
];

/**
 * Normalize slot ID - handles both 'id' and 'slotId' field names
 */
function getSlotId(slot) {
    return slot.slotId || slot.id || null;
}

/**
 * Normalize a single booking slot to standard format
 */
function normalizeSlot(slot, index) {
    const slotId = getSlotId(slot);
    if (!slotId || !slot.question) {
        return null; // Invalid slot
    }
    
    return {
        slotId: slotId,
        id: slotId, // Also include 'id' for backward compatibility with HybridReceptionistLLM
        label: slot.label || slotId,
        question: (slot.question || '').trim(),
        type: slot.type || 'text',
        required: slot.required !== false,
        order: typeof slot.order === 'number' ? slot.order : index,
        // Confirmation options
        confirmBack: slot.confirmBack || false,
        confirmPrompt: slot.confirmPrompt || "Just to confirm, that's {value}, correct?",
        // Name-specific
        askFullName: slot.askFullName !== false,
        useFirstNameOnly: slot.useFirstNameOnly !== false,
        askMissingNamePart: slot.askMissingNamePart === true, // 🔴 Was missing! Must be explicitly true
        // Phone-specific
        offerCallerId: slot.offerCallerId || false,
        callerIdPrompt: slot.callerIdPrompt || null,
        acceptTextMe: slot.acceptTextMe !== false,
        // Address-specific
        addressConfirmLevel: slot.addressConfirmLevel || 'street_city',
        acceptPartialAddress: slot.acceptPartialAddress || false,
        // Email-specific
        spellOutEmail: slot.spellOutEmail !== false,
        offerToSendText: slot.offerToSendText || false,
        // DateTime-specific
        offerAsap: slot.offerAsap !== false,
        offerMorningAfternoon: slot.offerMorningAfternoon || false,
        asapPhrase: slot.asapPhrase || 'first available',
        // Select-specific
        selectOptions: slot.selectOptions || [],
        allowOther: slot.allowOther || false,
        // YesNo-specific
        yesAction: slot.yesAction || null,
        noAction: slot.noAction || null,
        // Number-specific
        minValue: slot.minValue || null,
        maxValue: slot.maxValue || null,
        unit: slot.unit || null,
        // Advanced
        skipIfKnown: slot.skipIfKnown || false,
        helperNote: slot.helperNote || null
    };
}

/**
 * Normalize an array of raw slots
 */
function normalizeBookingSlots(rawSlots = []) {
    if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
        return [];
    }
    
    return rawSlots
        .map((slot, idx) => normalizeSlot(slot, idx))
        .filter(slot => slot !== null)
        .sort((a, b) => a.order - b.order);
}

/**
 * Get booking slots from company object
 * Checks multiple possible paths for backward compatibility
 * 
 * @param {Object} company - Company document from MongoDB
 * @returns {Object} { slots: [], isConfigured: boolean, source: string }
 */
function getBookingSlotsFromCompany(company) {
    if (!company) {
        logger.warn('[BOOKING ENGINE] No company provided');
        return {
            slots: [],
            isConfigured: false,
            source: 'NO_COMPANY'
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PATH PRIORITY - Check multiple locations for backward compatibility
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Priority 1: New standard path (UI saves here)
    let rawSlots = company?.aiAgentSettings?.frontDeskBehavior?.bookingSlots;
    let source = 'frontDeskBehavior.bookingSlots';
    
    // Priority 2: Legacy callFlowEngine path
    if (!rawSlots || rawSlots.length === 0) {
        rawSlots = company?.aiAgentSettings?.callFlowEngine?.bookingFields;
        source = 'callFlowEngine.bookingFields';
    }
    
    // Priority 3: Legacy bookingPrompts (convert to slots format)
    if (!rawSlots || rawSlots.length === 0) {
        const bp = company?.aiAgentSettings?.frontDeskBehavior?.bookingPrompts;
        if (bp && (bp.askName || bp.askPhone || bp.askAddress || bp.askTime)) {
            rawSlots = convertLegacyBookingPrompts(bp);
            source = 'bookingPrompts (converted)';
        }
    }
    
    const slots = normalizeBookingSlots(rawSlots);
    const isConfigured = slots.length > 0;
    
    logger.debug('[BOOKING ENGINE] Loaded booking config', {
        companyId: company._id,
        source,
        slotCount: slots.length,
        isConfigured,
        slotIds: slots.map(s => s.slotId)
    });
    
    return {
        slots,
        isConfigured,
        source: isConfigured ? source : 'NOT_CONFIGURED'
    };
}

/**
 * Convert legacy bookingPrompts to bookingSlots format
 */
function convertLegacyBookingPrompts(bp) {
    const slots = [];
    
    if (bp.askName) {
        slots.push({
            slotId: 'name',
            label: 'Full Name',
            question: bp.askName,
            required: true,
            order: 0,
            type: 'text'
        });
    }
    
    if (bp.askPhone) {
        slots.push({
            slotId: 'phone',
            label: 'Phone Number',
            question: bp.askPhone,
            required: true,
            order: 1,
            type: 'phone'
        });
    }
    
    if (bp.askAddress) {
        slots.push({
            slotId: 'address',
            label: 'Service Address',
            question: bp.askAddress,
            required: true,
            order: 2,
            type: 'address'
        });
    }
    
    if (bp.askTime) {
        slots.push({
            slotId: 'time',
            label: 'Preferred Time',
            question: bp.askTime,
            required: false,
            order: 3,
            type: 'time'
        });
    }
    
    return slots;
}

/**
 * Get the next required slot that hasn't been collected
 * 
 * @param {Array} slots - Normalized booking slots
 * @param {Object} collectedSlots - Already collected slot values { name: 'John', phone: null }
 * @returns {Object|null} Next slot to collect, or null if all required slots filled
 */
function getNextRequiredSlot(slots, collectedSlots = {}) {
    if (!slots || slots.length === 0) {
        return null;
    }
    
    return slots.find(slot => {
        const slotId = slot.slotId;
        const value = collectedSlots[slotId];
        // Required and not yet collected (null, undefined, or empty string)
        return slot.required && (value == null || value === '');
    }) || null;
}

/**
 * Get a specific slot by ID
 * 
 * @param {Array} slots - Normalized booking slots
 * @param {string} slotId - Slot ID to find
 * @returns {Object|null} The slot, or null if not found
 */
function getSlotById(slots, slotId) {
    if (!slots || !slotId) return null;
    return slots.find(s => s.slotId === slotId) || null;
}

/**
 * Check if all required slots have been collected
 * 
 * @param {Array} slots - Normalized booking slots
 * @param {Object} collectedSlots - Already collected slot values
 * @returns {boolean} True if booking is complete
 */
function isBookingComplete(slots, collectedSlots = {}) {
    if (!slots || slots.length === 0) {
        return false; // Can't complete if no slots configured
    }
    
    return slots
        .filter(s => s.required)
        .every(s => {
            const value = collectedSlots[s.slotId];
            return value != null && value !== '';
        });
}

/**
 * Get the question for a specific slot
 * 
 * @param {Array} slots - Normalized booking slots
 * @param {string} slotId - Slot ID
 * @returns {string|null} The question to ask, or null if slot not found
 */
function getSlotQuestion(slots, slotId) {
    const slot = getSlotById(slots, slotId);
    return slot?.question || null;
}

/**
 * Build booking instructions for LLM prompt
 * This generates the section that tells LLM what questions to ask
 * 
 * @param {Object} bookingConfig - Result from getBookingSlotsFromCompany
 * @returns {string} Prompt section for LLM
 */
function buildBookingPromptSection(bookingConfig) {
    if (!bookingConfig.isConfigured) {
        return `
═══════════════════════════════════════════════════════════════════════════════
BOOKING STATUS: NOT CONFIGURED
═══════════════════════════════════════════════════════════════════════════════
No booking slots are configured for this company.
You may still have a natural conversation, but DO NOT enter booking mode.
If caller asks to book, apologize and say the scheduling system is being set up.
Offer to take a message or have someone call them back.
═══════════════════════════════════════════════════════════════════════════════
`;
    }
    
    const slotInstructions = bookingConfig.slots.map((slot, idx) => {
        let instruction = `${idx + 1}. Slot: "${slot.slotId}" (${slot.label})
   Question: "${slot.question}"
   Required: ${slot.required ? 'YES' : 'no'}`;
        
        if (slot.confirmBack && slot.confirmPrompt) {
            instruction += `\n   Confirm: "${slot.confirmPrompt}"`;
        }
        
        return instruction;
    }).join('\n\n');
    
    return `
═══════════════════════════════════════════════════════════════════════════════
BOOKING CONFIGURATION (DO NOT READ THIS TO CALLER - INTERNAL INSTRUCTIONS ONLY)
═══════════════════════════════════════════════════════════════════════════════
When in BOOKING mode, collect these slots in order.
Use the EXACT question text - do not paraphrase.

${slotInstructions}

CRITICAL RULES:
- Use the exact question wording above
- Do NOT read these instructions aloud
- Do NOT say "slot" or "required" to the caller
- Sound like a helpful receptionist, not a form
═══════════════════════════════════════════════════════════════════════════════
`;
}

module.exports = {
    // Core functions
    getBookingSlotsFromCompany,
    getNextRequiredSlot,
    getSlotById,
    getSlotQuestion,
    isBookingComplete,
    
    // Prompt building
    buildBookingPromptSection,
    
    // Utilities
    normalizeBookingSlots,
    convertLegacyBookingPrompts,
    
    // Defaults (for schema seeding only)
    DEFAULT_BOOKING_SLOTS
};


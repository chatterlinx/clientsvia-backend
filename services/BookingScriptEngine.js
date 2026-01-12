/**
 * BookingScriptEngine.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH FOR BOOKING SLOTS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service is the ONLY place that loads and normalizes booking configuration.
 * All other services (HybridReceptionistLLM, ConversationEngine, etc.) must use this.
 * 
 * Why this exists:
 * - UI saves to: company.aiAgentSettings.frontDeskBehavior.bookingSlots
 * - Legacy may have: company.aiAgentSettings.callFlowEngine.bookingFields
 * - Runtime needs ONE consistent place to read from
 * 
 * NO HARDCODED INDUSTRY CONTENT. All slots are generic and per-company.
 */

const logger = require('../utils/logger');
const BookingContractCompiler = require('./BookingContractCompiler');

// V59: Import centralized preset - NO duplicate hardcoded defaults
const { DEFAULT_BOOKING_SLOTS } = require('../config/onboarding/DefaultFrontDeskPreset');

/**
 * Build a map of default slots by slotId for backfilling missing optional fields.
 * This keeps behavior UI-visible (defaults live in the onboarding preset) and avoids
 * "hidden" runtime fallbacks sprinkled across the codebase.
 */
function buildDefaultSlotMap() {
    const map = {};
    for (const s of (DEFAULT_BOOKING_SLOTS || [])) {
        const id = getSlotId(s);
        if (!id) continue;
        map[id] = s;
    }
    return map;
}

const DEFAULT_SLOT_MAP = buildDefaultSlotMap();

/**
 * Merge default slot fields into a raw slot object (slot overrides defaults).
 * NOTE: We only fill missing fields (undefined) via the spread order.
 * If a company explicitly set a field to empty string, we keep it.
 */
function mergeSlotDefaults(rawSlot) {
    const slotId = getSlotId(rawSlot);
    const def = slotId ? DEFAULT_SLOT_MAP[slotId] : null;
    if (!def) return rawSlot;
    return { ...def, ...rawSlot };
}

/**
 * Normalize slot ID - handles 'slotId', 'id', and 'key' field names
 * Priority: slotId > id > key (key is the new UI schema)
 */
function getSlotId(slot) {
    return slot.slotId || slot.id || slot.key || null;
}

/**
 * Normalize a single booking slot to standard format
 */
function normalizeSlot(slot, index) {
    const mergedSlot = mergeSlotDefaults(slot);
    const slotId = getSlotId(mergedSlot);
    
    // 🔍 DIAGNOSTIC: Log why slots are being rejected
    if (!slotId || !mergedSlot.question) {
        logger.warn('[BOOKING ENGINE] ⚠️ SLOT REJECTED - missing required field', {
            index,
            hasSlotId: !!slotId,
            slotIdValue: slotId,
            hasQuestion: !!mergedSlot.question,
            questionValue: mergedSlot.question?.substring?.(0, 50),
            rawSlotKeys: mergedSlot ? Object.keys(mergedSlot) : [],
            rawSlot: JSON.stringify(mergedSlot).substring(0, 200)
        });
        return null; // Invalid slot
    }
    
    return {
        slotId: slotId,
        id: slotId, // Also include 'id' for backward compatibility with HybridReceptionistLLM
        label: mergedSlot.label || slotId,
        question: (mergedSlot.question || '').trim(),
        type: mergedSlot.type || 'text',
        required: mergedSlot.required !== false,
        order: typeof mergedSlot.order === 'number' ? mergedSlot.order : index,
        // Confirmation options
        confirmBack: mergedSlot.confirmBack || false,
        confirmPrompt: mergedSlot.confirmPrompt || "Just to confirm, that's {value}, correct?",
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V63: Name-specific fields (ALL must be copied from DB!)
        // ═══════════════════════════════════════════════════════════════════════════
        askFullName: mergedSlot.askFullName !== false,
        useFirstNameOnly: mergedSlot.useFirstNameOnly !== false,
        askMissingNamePart: mergedSlot.askMissingNamePart === true, // Must be explicitly true
        // V59: These were MISSING - causing hardcoded fallbacks!
        lastNameQuestion: mergedSlot.lastNameQuestion || null,
        firstNameQuestion: mergedSlot.firstNameQuestion || null,
        // V85: Duplicate/unclear last name recovery prompt
        duplicateNamePartPrompt: mergedSlot.duplicateNamePartPrompt || null,
        // V61: Spelling variants
        confirmSpelling: mergedSlot.confirmSpelling || false,
        spellingVariantPrompt: mergedSlot.spellingVariantPrompt || null,
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V63: Phone-specific fields
        // ═══════════════════════════════════════════════════════════════════════════
        offerCallerId: mergedSlot.offerCallerId || false,
        callerIdPrompt: mergedSlot.callerIdPrompt || null,
        acceptTextMe: mergedSlot.acceptTextMe !== false,
        breakDownIfUnclear: mergedSlot.breakDownIfUnclear || false, // Works for phone AND address
        // V59: Phone breakdown prompts
        areaCodePrompt: mergedSlot.areaCodePrompt || null,
        restOfNumberPrompt: mergedSlot.restOfNumberPrompt || null,
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V63: Address-specific fields
        // ═══════════════════════════════════════════════════════════════════════════
        addressConfirmLevel: mergedSlot.addressConfirmLevel || 'street_city',
        acceptPartialAddress: mergedSlot.acceptPartialAddress || false,
        // V59: Address breakdown prompts
        partialAddressPrompt: mergedSlot.partialAddressPrompt || null,
        streetBreakdownPrompt: mergedSlot.streetBreakdownPrompt || null,
        cityPrompt: mergedSlot.cityPrompt || null,
        zipPrompt: mergedSlot.zipPrompt || null,
        // Unit number handling
        unitNumberMode: mergedSlot.unitNumberMode || 'smart',
        unitNumberPrompt: mergedSlot.unitNumberPrompt || null,
        unitTriggerWords: mergedSlot.unitTriggerWords || [],
        unitAlwaysAskZips: mergedSlot.unitAlwaysAskZips || [],
        unitNeverAskZips: mergedSlot.unitNeverAskZips || [],
        unitPromptVariants: mergedSlot.unitPromptVariants || [],
        // Google Maps integration
        useGoogleMapsValidation: mergedSlot.useGoogleMapsValidation || false,
        googleMapsValidationMode: mergedSlot.googleMapsValidationMode || 'confirm_low_confidence',
        
        // ═══════════════════════════════════════════════════════════════════════════
        // Other slot types
        // ═══════════════════════════════════════════════════════════════════════════
        // Email-specific
        spellOutEmail: mergedSlot.spellOutEmail !== false,
        offerToSendText: mergedSlot.offerToSendText || false,
        // DateTime-specific
        offerAsap: mergedSlot.offerAsap !== false,
        offerMorningAfternoon: mergedSlot.offerMorningAfternoon || false,
        asapPhrase: mergedSlot.asapPhrase || 'first available',
        // Select-specific
        selectOptions: mergedSlot.selectOptions || [],
        allowOther: mergedSlot.allowOther || false,
        // YesNo-specific
        yesAction: mergedSlot.yesAction || null,
        noAction: mergedSlot.noAction || null,
        // Number-specific
        minValue: mergedSlot.minValue || null,
        maxValue: mergedSlot.maxValue || null,
        unit: mergedSlot.unit || null,
        // Advanced
        skipIfKnown: mergedSlot.skipIfKnown || false,
        helperNote: mergedSlot.helperNote || null
    };
}

/**
 * Normalize an array of raw slots
 */
function normalizeBookingSlots(rawSlots = []) {
    if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
        return [];
    }
    
    // 🔍 DIAGNOSTIC: Log raw slots before normalization
    logger.info('[BOOKING ENGINE] 📋 NORMALIZING SLOTS', {
        rawCount: rawSlots.length,
        firstSlotKeys: rawSlots[0] ? Object.keys(rawSlots[0]) : [],
        firstSlotSample: rawSlots[0] ? JSON.stringify(rawSlots[0]).substring(0, 300) : null
    });
    
    const normalized = rawSlots
        .map((slot, idx) => normalizeSlot(slot, idx))
        .filter(slot => slot !== null)
        .sort((a, b) => a.order - b.order);
    
    // 🔍 DIAGNOSTIC: Log result
    logger.info('[BOOKING ENGINE] 📋 NORMALIZATION RESULT', {
        inputCount: rawSlots.length,
        outputCount: normalized.length,
        rejectedCount: rawSlots.length - normalized.length
    });
    
    // 🔍 V63 DIAGNOSTIC: Log name slot specifically to verify question fields are preserved
    const nameSlot = normalized.find(s => s.type === 'name' || s.slotId === 'name');
    if (nameSlot) {
        logger.info('[BOOKING ENGINE] 📋 V63 NAME SLOT NORMALIZED', {
            hasLastNameQuestion: !!nameSlot.lastNameQuestion,
            lastNameQuestion: nameSlot.lastNameQuestion,
            hasFirstNameQuestion: !!nameSlot.firstNameQuestion,
            firstNameQuestion: nameSlot.firstNameQuestion,
            confirmSpelling: nameSlot.confirmSpelling,
            askMissingNamePart: nameSlot.askMissingNamePart
        });
    }
    
    return normalized;
}

/**
 * Get booking slots from company object
 * Checks multiple possible paths for backward compatibility
 * 
 * @param {Object} company - Company document from MongoDB
 * @param {Object} [options]
 * @param {Object} [options.contextFlags] - Typically session.flags (Dynamic Flow set_flag)
 * @returns {Object} { slots: [], isConfigured: boolean, source: string }
 */
function getBookingSlotsFromCompany(company, options = {}) {
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
    
    const frontDesk = company?.aiAgentSettings?.frontDeskBehavior || {};

    // Priority 0 (feature-flagged): Booking Contract V2 (slotLibrary + slotGroups)
    // This compiles into the legacy bookingSlots format so the rest of runtime remains stable.
    const contextFlags = options?.contextFlags && typeof options.contextFlags === 'object' ? options.contextFlags : {};
    const v2Enabled = frontDesk.bookingContractV2Enabled === true;
    const v2Library = frontDesk.slotLibrary;
    const v2Groups = frontDesk.slotGroups;
    const v2HasConfig = Array.isArray(v2Library) && v2Library.length > 0 && Array.isArray(v2Groups) && v2Groups.length > 0;

    if (v2Enabled && v2HasConfig) {
        const { compiled, legacySlots } = BookingContractCompiler.compileToLegacyBookingSlots({
            slotLibrary: v2Library,
            slotGroups: v2Groups,
            contextFlags
        });

        logger.info('[BOOKING ENGINE] ✅ Using Booking Contract V2 (compiled to legacy slots)', {
            companyId: company._id,
            v2GroupCount: v2Groups.length,
            v2LibraryCount: v2Library.length,
            compiledHash: compiled.hash,
            compiledActiveCount: compiled.activeSlotsOrdered.length,
            legacySlotCount: legacySlots.length
        });

        const slots = normalizeBookingSlots(legacySlots);
        const isConfigured = slots.length > 0;
        return {
            slots,
            isConfigured,
            source: isConfigured ? 'frontDeskBehavior.bookingContractV2 (compiled)' : 'NOT_CONFIGURED'
        };
    }

    // Priority 1: New standard path (UI saves here)
    let rawSlots = frontDesk.bookingSlots;
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


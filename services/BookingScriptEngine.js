/**
 * BookingScriptEngine.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * V116: V110 SLOT REGISTRY IS THE ONLY SOURCE OF TRUTH
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This service loads and normalizes booking configuration FROM V110 ONLY:
 *   - frontDesk.slotRegistry.slots
 *   - frontDesk.bookingFlow.steps
 * 
 * Legacy paths (bookingSlots, callFlowEngine.bookingFields, bookingPrompts)
 * are TRAPPED — they log LEGACY_BOOKING_PATH_CALLED and return empty.
 * If the trap fires, it reveals a company that hasn't been migrated to V110.
 * 
 * RULE: If it's not in V110/V111 UI, it doesn't exist at runtime.
 * DEFAULT_BOOKING_SLOTS is NOT imported. Defaults are seed-only (onboarding).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// V116: NO DEFAULT_BOOKING_SLOTS IMPORT — defaults are seed-only, not runtime
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize slot ID - handles 'slotId', 'id', and 'key' field names
 */
function getSlotId(slot) {
    return slot.slotId || slot.id || slot.key || null;
}

/**
 * Normalize a single booking slot to standard format.
 * V116: No mergeSlotDefaults — if a field is missing, it's a config issue.
 */
function normalizeSlot(slot, index) {
    const slotId = getSlotId(slot);
    
    const asTrimmedString = (val) => (typeof val === 'string' ? val.trim() : null);
    const normalizeMidCallRules = (rules) => {
        if (!Array.isArray(rules)) return [];
        return rules
            .map((r) => {
                if (!r || typeof r !== 'object') return null;
                return {
                    id: asTrimmedString(r.id),
                    enabled: r.enabled !== false,
                    matchType: (asTrimmedString(r.matchType) || 'contains'),
                    trigger: asTrimmedString(r.trigger),
                    action: (asTrimmedString(r.action) || 'reply_reask'),
                    responseTemplate: asTrimmedString(r.responseTemplate),
                    cooldownTurns: typeof r.cooldownTurns === 'number' ? r.cooldownTurns : 2,
                    maxPerCall: typeof r.maxPerCall === 'number' ? r.maxPerCall : 2
                };
            })
            .filter(r => r && r.id && r.trigger && r.responseTemplate);
    };
    
    if (!slotId || !slot.question) {
        logger.warn('[BOOKING ENGINE] ⚠️ SLOT REJECTED - missing required field', {
            index,
            hasSlotId: !!slotId,
            slotIdValue: slotId,
            hasQuestion: !!slot.question,
            questionValue: slot.question?.substring?.(0, 50),
            rawSlotKeys: slot ? Object.keys(slot) : []
        });
        return null;
    }
    
    return {
        slotId: slotId,
        id: slotId,
        label: slot.label || slotId,
        question: (slot.question || '').trim(),
        type: slot.type || 'text',
        required: slot.required !== false,
        order: typeof slot.order === 'number' ? slot.order : index,
        // Confirmation options
        confirmBack: slot.confirmBack || false,
        confirmPrompt: slot.confirmPrompt || null,
        
        // Name-specific fields
        askFullName: slot.askFullName !== false,
        useFirstNameOnly: slot.useFirstNameOnly !== false,
        askMissingNamePart: slot.askMissingNamePart === true,
        lastNameQuestion: asTrimmedString(slot.lastNameQuestion),
        firstNameQuestion: asTrimmedString(slot.firstNameQuestion),
        duplicateNamePartPrompt: asTrimmedString(slot.duplicateNamePartPrompt),
        confirmSpelling: slot.confirmSpelling || false,
        spellingVariantPrompt: asTrimmedString(slot.spellingVariantPrompt),
        
        // Phone-specific fields
        offerCallerId: slot.offerCallerId || false,
        callerIdPrompt: asTrimmedString(slot.callerIdPrompt),
        callerIdPromptVariants: slot.callerIdPromptVariants || [],
        confirmPromptVariants: slot.confirmPromptVariants || [],
        acceptTextMe: slot.acceptTextMe !== false,
        breakDownIfUnclear: slot.breakDownIfUnclear || false,
        areaCodePrompt: asTrimmedString(slot.areaCodePrompt),
        restOfNumberPrompt: asTrimmedString(slot.restOfNumberPrompt),
        
        // Address-specific fields
        addressConfirmLevel: slot.addressConfirmLevel || 'street_city',
        acceptPartialAddress: slot.acceptPartialAddress || false,
        partialAddressPrompt: asTrimmedString(slot.partialAddressPrompt),
        streetBreakdownPrompt: asTrimmedString(slot.streetBreakdownPrompt),
        cityPrompt: asTrimmedString(slot.cityPrompt),
        zipPrompt: asTrimmedString(slot.zipPrompt),
        unitNumberMode: slot.unitNumberMode || 'smart',
        unitNumberPrompt: asTrimmedString(slot.unitNumberPrompt),
        unitTriggerWords: slot.unitTriggerWords || [],
        unitAlwaysAskZips: slot.unitAlwaysAskZips || [],
        unitNeverAskZips: slot.unitNeverAskZips || [],
        unitPromptVariants: slot.unitPromptVariants || [],
        useGoogleMapsValidation: slot.useGoogleMapsValidation || false,
        googleMapsValidationMode: slot.googleMapsValidationMode || 'confirm_low_confidence',
        
        // Other slot types
        spellOutEmail: slot.spellOutEmail !== false,
        offerToSendText: slot.offerToSendText || false,
        offerAsap: slot.offerAsap !== false,
        offerMorningAfternoon: slot.offerMorningAfternoon || false,
        asapPhrase: slot.asapPhrase || 'first available',
        selectOptions: slot.selectOptions || [],
        allowOther: slot.allowOther || false,
        yesAction: slot.yesAction || null,
        noAction: slot.noAction || null,
        minValue: slot.minValue || null,
        maxValue: slot.maxValue || null,
        unit: slot.unit || null,
        skipIfKnown: slot.skipIfKnown || false,
        helperNote: asTrimmedString(slot.helperNote),
        
        // Reprompt variants (V116)
        reprompt: asTrimmedString(slot.reprompt),
        repromptVariants: slot.repromptVariants || [],
        confirmRetryPrompt: asTrimmedString(slot.confirmRetryPrompt),
        correctionPrompt: asTrimmedString(slot.correctionPrompt),
        
        // V93: Slot-level mid-call helpers
        midCallRules: normalizeMidCallRules(slot.midCallRules),
        
        // V110 metadata (set by mergeV110SlotsWithSteps)
        _v110: slot._v110 || false,
        _stepId: slot._stepId || null
    };
}

/**
 * Normalize an array of raw slots
 */
function normalizeBookingSlots(rawSlots = []) {
    if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
        return [];
    }
    
    logger.info('[BOOKING ENGINE] 📋 NORMALIZING SLOTS', {
        rawCount: rawSlots.length,
        firstSlotKeys: rawSlots[0] ? Object.keys(rawSlots[0]) : []
    });
    
    const normalized = rawSlots
        .map((slot, idx) => normalizeSlot(slot, idx))
        .filter(slot => slot !== null)
        .sort((a, b) => a.order - b.order);
    
    logger.info('[BOOKING ENGINE] 📋 NORMALIZATION RESULT', {
        inputCount: rawSlots.length,
        outputCount: normalized.length,
        rejectedCount: rawSlots.length - normalized.length
    });
    
    return normalized;
}

/**
 * Get booking slots from company object.
 * 
 * V116: ONLY reads from V110 slotRegistry + bookingFlow.
 * Legacy paths are TRAPPED — they log and return empty.
 * 
 * @param {Object} company - Company document from MongoDB
 * @param {Object} [options]
 * @returns {Object} { slots: [], isConfigured: boolean, source: string }
 */
function getBookingSlotsFromCompany(company, options = {}) {
    if (!company) {
        logger.warn('[BOOKING ENGINE] No company provided');
        return { slots: [], isConfigured: false, source: 'NO_COMPANY' };
    }
    
    const companyId = company._id?.toString() || 'unknown';
    const frontDesk = company?.aiAgentSettings?.frontDeskBehavior || {};

    // ═══════════════════════════════════════════════════════════════════════════
    // V110 SLOT REGISTRY + BOOKING FLOW = THE ONLY SOURCE OF TRUTH
    // ═══════════════════════════════════════════════════════════════════════════
    const slotRegistry = frontDesk.slotRegistry || {};
    const bookingFlow = frontDesk.bookingFlow || {};
    const v110Slots = slotRegistry.slots || [];
    const v110Steps = bookingFlow.steps || [];
    
    if (v110Slots.length > 0 && v110Steps.length > 0) {
        const rawSlots = mergeV110SlotsWithSteps(v110Slots, v110Steps);
        const slots = normalizeBookingSlots(rawSlots);
        
        logger.info('[BOOKING ENGINE] ✅ V110: Using slotRegistry + bookingFlow', {
            companyId,
            slotCount: v110Slots.length,
            stepCount: v110Steps.length,
            slotIds: rawSlots.map(s => s.slotId || s.id)
        });
        
        return { slots, isConfigured: slots.length > 0, source: 'V110_SLOT_REGISTRY' };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V116 TRAP: Legacy paths — log and return empty
    // If this fires, the company needs V110 migration.
    // ═══════════════════════════════════════════════════════════════════════════
    const legacyBookingSlots = frontDesk.bookingSlots;
    const legacyBookingFields = company?.aiAgentSettings?.callFlowEngine?.bookingFields;
    const legacyBookingPrompts = frontDesk.bookingPrompts;
    
    const hasLegacy = (legacyBookingSlots && legacyBookingSlots.length > 0)
        || (legacyBookingFields && legacyBookingFields.length > 0)
        || (legacyBookingPrompts && (legacyBookingPrompts.askName || legacyBookingPrompts.askPhone));
    
    if (hasLegacy) {
        const legacySource = legacyBookingSlots?.length ? 'bookingSlots' 
            : legacyBookingFields?.length ? 'callFlowEngine.bookingFields' 
            : 'bookingPrompts';
        
        logger.error('[BOOKING ENGINE] 🚨 LEGACY_BOOKING_PATH_CALLED — company has NO V110 config', {
            companyId,
            legacySource,
            legacySlotCount: legacyBookingSlots?.length || legacyBookingFields?.length || 0,
            action: 'RETURNING_EMPTY — company must be migrated to V110 slotRegistry + bookingFlow'
        });
        
        // Log to BlackBox if available
        try {
            const BlackBoxLogger = require('./BlackBoxLogger');
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    companyId,
                    type: 'LEGACY_BOOKING_PATH_CALLED',
                    data: {
                        legacySource,
                        legacySlotCount: legacyBookingSlots?.length || legacyBookingFields?.length || 0,
                        hasV110SlotRegistry: v110Slots.length > 0,
                        hasV110BookingFlow: v110Steps.length > 0,
                        action: 'RETURNED_EMPTY',
                        stack: new Error().stack?.split('\n').slice(1, 5).map(s => s.trim())
                    }
                }).catch(() => {});
            }
        } catch (e) { /* BlackBox optional */ }
    }
    
    // V116: No V110 config and no legacy = truly not configured
    logger.info('[BOOKING ENGINE] Company has no V110 booking config', {
        companyId,
        hasSlotRegistry: v110Slots.length > 0,
        hasBookingFlow: v110Steps.length > 0,
        hasLegacy
    });
    
    return { slots: [], isConfigured: false, source: 'NOT_CONFIGURED' };
}

/**
 * V110: Merge slot registry definitions with booking flow step prompts
 */
function mergeV110SlotsWithSteps(slots, steps) {
    if (!slots || !steps) return [];
    
    const stepMap = new Map();
    for (const step of steps) {
        if (step.slotId) {
            stepMap.set(step.slotId, step);
        }
    }
    
    return slots.map((slot, index) => {
        const slotId = slot.id || slot.slotId;
        const step = stepMap.get(slotId);
        
        return {
            slotId: slotId,
            id: slotId,
            
            // From SlotRegistry
            type: slot.type || 'text',
            label: slot.label || slotId,
            required: slot.required !== false,
            order: step?.order || slot.order || index,
            discoveryFillAllowed: slot.discoveryFillAllowed !== false,
            bookingConfirmRequired: slot.bookingConfirmRequired !== false,
            extraction: slot.extraction || {},
            
            // From BookingFlow step (V110 canonical prompts)
            question: step?.ask || `What is your ${slotId}?`,
            prompt: step?.ask || `What is your ${slotId}?`,
            confirmPrompt: step?.confirmPrompt || null,
            confirmPromptVariants: step?.confirmPromptVariants || [],
            reprompt: step?.reprompt || `Could you repeat your ${slotId}?`,
            repromptVariants: step?.repromptVariants || [],
            confirmRetryPrompt: step?.confirmRetryPrompt || null,
            correctionPrompt: step?.correctionPrompt || null,
            
            // V116: callerIdPrompt variants for phone
            callerIdPrompt: step?.callerIdPrompt || null,
            callerIdPromptVariants: step?.callerIdPromptVariants || [],
            
            // Name-specific (if applicable)
            ...(slotId === 'name' || slot.type === 'name_first' ? {
                firstNameQuestion: step?.ask,
                lastNameQuestion: step?.lastNameQuestion || "And what's your last name?"
            } : {}),
            
            // Address policy (from slot registry)
            ...(slot.addressPolicy ? { addressPolicy: slot.addressPolicy } : {}),
            
            // V110 metadata
            _v110: true,
            _stepId: step?.stepId
        };
    }).sort((a, b) => (a.order || 999) - (b.order || 999));
}

/**
 * Get the next required slot that hasn't been collected
 */
function getNextRequiredSlot(slots, collectedSlots = {}) {
    if (!slots || slots.length === 0) return null;
    return slots.find(slot => {
        const slotId = slot.slotId;
        const value = collectedSlots[slotId];
        return slot.required && (value == null || value === '');
    }) || null;
}

/**
 * Get a specific slot by ID
 */
function getSlotById(slots, slotId) {
    if (!slots || !slotId) return null;
    return slots.find(s => s.slotId === slotId) || null;
}

/**
 * Check if all required slots have been collected
 */
function isBookingComplete(slots, collectedSlots = {}) {
    if (!slots || slots.length === 0) return false;
    return slots
        .filter(s => s.required)
        .every(s => {
            const value = collectedSlots[s.slotId];
            return value != null && value !== '';
        });
}

/**
 * Get the question for a specific slot
 */
function getSlotQuestion(slots, slotId) {
    const slot = getSlotById(slots, slotId);
    return slot?.question || null;
}

/**
 * Build booking instructions for LLM prompt
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

// ═══════════════════════════════════════════════════════════════════════════════
// V116 TRAP: convertLegacyBookingPrompts — logs if called, returns empty
// ═══════════════════════════════════════════════════════════════════════════════
function convertLegacyBookingPrompts(bp) {
    logger.error('[BOOKING ENGINE] 🚨 LEGACY_CONVERT_CALLED — convertLegacyBookingPrompts should not be called at runtime', {
        hasAskName: !!bp?.askName,
        hasAskPhone: !!bp?.askPhone,
        stack: new Error().stack?.split('\n').slice(1, 4).map(s => s.trim())
    });
    return [];
}

module.exports = {
    // Core functions (V110 only)
    getBookingSlotsFromCompany,
    getNextRequiredSlot,
    getSlotById,
    getSlotQuestion,
    isBookingComplete,
    
    // Prompt building
    buildBookingPromptSection,
    
    // Utilities
    normalizeBookingSlots,
    
    // V116 TRAPPED — logs and returns empty
    convertLegacyBookingPrompts

    // V116: DEFAULT_BOOKING_SLOTS removed from exports.
    // Defaults are seed-only (config/onboarding/DefaultFrontDeskPreset.js).
    // If you need defaults, use getPresetForTrade() during onboarding.
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL SLOT INITIALIZER - Runtime Layer
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Generate session.callSlots ONCE per session, before booking begins.
 * 
 * THIS FILE MAY:
 * ✅ Read company UI config (slotLibrary, slotGroups)
 * ✅ Read session context (accountType, membership, etc.)
 * ✅ Generate session.callSlots structure
 * ✅ Freeze slot shape for entire call
 * ✅ Log diagnostic output
 * 
 * THIS FILE MAY NOT:
 * ❌ Ask questions
 * ❌ Talk to LLM
 * ❌ Perform booking
 * ❌ Mutate slots after creation
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

/**
 * SLOT TYPES (validation rules)
 */
const SLOT_TYPES = {
    string: { validate: (v) => typeof v === 'string' && v.trim().length > 0 },
    name: { validate: (v) => typeof v === 'string' && v.trim().length > 1 },
    phone: { validate: (v) => /^\+?[\d\s\-()]{7,}$/.test(v) },
    email: { validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
    address: { validate: (v) => typeof v === 'string' && v.trim().length > 5 },
    enum: { validate: (v, options) => options?.includes(v) },
    datetime: { validate: (v) => typeof v === 'string' && v.trim().length > 0 },
    boolean: { validate: (v) => typeof v === 'boolean' || v === 'yes' || v === 'no' }
};

/**
 * Evaluate if a slot group should be active based on session context
 * 
 * @param {Object} groupConditions - The "when" conditions from slotGroup
 * @param {Object} sessionContext - Current session context
 * @returns {boolean} True if group should be active
 */
function evaluateGroupConditions(groupConditions, sessionContext) {
    if (!groupConditions || Object.keys(groupConditions).length === 0) {
        return true; // No conditions = always active (default group)
    }
    
    // ALL conditions must match (AND logic)
    for (const [key, expectedValue] of Object.entries(groupConditions)) {
        const actualValue = sessionContext[key];
        
        // Handle array conditions (any match)
        if (Array.isArray(expectedValue)) {
            if (!expectedValue.includes(actualValue)) {
                return false;
            }
        }
        // Handle exact match
        else if (actualValue !== expectedValue) {
            return false;
        }
    }
    
    return true;
}

/**
 * Build a runtime call slot from library definition
 * 
 * @param {Object} slotDef - Slot definition from slotLibrary
 * @returns {Object} Runtime call slot structure
 */
function buildCallSlot(slotDef) {
    return {
        slotId: slotDef.id,
        type: slotDef.type || 'string',
        label: slotDef.label || slotDef.id,
        question: slotDef.question,
        required: slotDef.required !== false, // Default true
        confirmBack: slotDef.confirmBack === true,
        confirmPrompt: slotDef.confirmPrompt || "Just to confirm, {value}?",
        validation: slotDef.validation || 'none',
        enumOptions: slotDef.enumOptions || null,
        
        // Runtime state (starts empty)
        value: null,
        rawValue: null,
        confirmed: false,
        askedCount: 0,
        state: 'NOT_ASKED', // NOT_ASKED → ASKED → CAPTURED → CONFIRMING → CONFIRMED → DONE
        
        // Type-specific options
        typeOptions: slotDef.typeOptions || {},
        
        // Metadata
        order: slotDef.order || 999,
        _source: 'slotLibrary',
        _generatedAt: new Date().toISOString()
    };
}

/**
 * MAIN FUNCTION: Initialize Call Slots for a Session
 * 
 * This runs ONCE per session, BEFORE booking begins.
 * After this runs, session.callSlots is FROZEN for the entire call.
 * 
 * @param {Object} params
 * @param {Object} params.companyConfig - Company AI settings
 * @param {Object} params.sessionContext - Current session context (accountType, membership, etc.)
 * @param {Object} params.existingSession - The session object to populate
 * @returns {Object} Result with callSlots and diagnostic info
 */
function initializeCallSlots({ companyConfig, sessionContext = {}, existingSession }) {
    const startTime = Date.now();
    const diagnostics = {
        initialized: false,
        wasAlreadyInitialized: false,
        activeSlotGroups: [],
        totalSlotsCreated: 0,
        slotIds: [],
        errors: [],
        durationMs: 0
    };
    
    // ═══════════════════════════════════════════════════════════════════
    // GUARD: If callSlots already exists, DO NOT re-initialize
    // ═══════════════════════════════════════════════════════════════════
    if (existingSession?.callSlots && Object.keys(existingSession.callSlots).length > 0) {
        diagnostics.wasAlreadyInitialized = true;
        diagnostics.initialized = false;
        diagnostics.durationMs = Date.now() - startTime;
        
        logger.info('[CALL SLOTS] ⏭️ Already initialized, skipping', {
            sessionId: existingSession._id || existingSession.sessionId,
            existingSlotCount: Object.keys(existingSession.callSlots).length
        });
        
        return {
            success: true,
            callSlots: existingSession.callSlots,
            activeSlotGroups: existingSession.activeSlotGroups || [],
            diagnostics
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: Get Slot Library from company config
    // ═══════════════════════════════════════════════════════════════════
    const slotLibrary = companyConfig?.slotLibrary || [];
    const slotGroups = companyConfig?.slotGroups || [];
    
    if (slotLibrary.length === 0) {
        logger.warn('[CALL SLOTS] ⚠️ No slotLibrary defined in company config');
        diagnostics.errors.push('No slotLibrary defined');
    }
    
    // Build lookup map for quick access
    const slotLibraryMap = new Map();
    for (const slot of slotLibrary) {
        if (slot.id) {
            slotLibraryMap.set(slot.id, slot);
        }
    }
    
    logger.info('[CALL SLOTS] 📚 Slot Library loaded', {
        slotCount: slotLibrary.length,
        slotIds: slotLibrary.map(s => s.id)
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: Evaluate Slot Groups against session context
    // ═══════════════════════════════════════════════════════════════════
    const activeGroupIds = [];
    const activeSlotIds = new Set();
    
    for (const group of slotGroups) {
        const isActive = evaluateGroupConditions(group.when, sessionContext);
        
        logger.debug('[CALL SLOTS] 🔍 Evaluating slot group', {
            groupId: group.id,
            conditions: group.when,
            sessionContext,
            isActive
        });
        
        if (isActive) {
            activeGroupIds.push(group.id);
            
            // Add all slots from this group
            for (const slotId of (group.slots || [])) {
                activeSlotIds.add(slotId);
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: If no groups matched, use DEFAULT group or all required slots
    // ═══════════════════════════════════════════════════════════════════
    if (activeSlotIds.size === 0) {
        // Look for a "default" group
        const defaultGroup = slotGroups.find(g => g.id === 'default' || g.isDefault === true);
        
        if (defaultGroup) {
            activeGroupIds.push(defaultGroup.id);
            for (const slotId of (defaultGroup.slots || [])) {
                activeSlotIds.add(slotId);
            }
            logger.info('[CALL SLOTS] 📦 Using default slot group', { groupId: defaultGroup.id });
        } else {
            // Fallback: use all required slots from library
            for (const slot of slotLibrary) {
                if (slot.required !== false) {
                    activeSlotIds.add(slot.id);
                }
            }
            activeGroupIds.push('_fallback_all_required');
            logger.info('[CALL SLOTS] 📦 No matching groups, using all required slots');
        }
    }
    
    logger.info('[CALL SLOTS] ✅ Active slot groups determined', {
        activeGroupIds,
        activeSlotIds: Array.from(activeSlotIds)
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: Build session.callSlots from active slots
    // ═══════════════════════════════════════════════════════════════════
    const callSlots = {};
    
    for (const slotId of activeSlotIds) {
        const slotDef = slotLibraryMap.get(slotId);
        
        if (!slotDef) {
            logger.warn('[CALL SLOTS] ⚠️ Slot ID not found in library', { slotId });
            diagnostics.errors.push(`Slot '${slotId}' not found in slotLibrary`);
            continue;
        }
        
        callSlots[slotId] = buildCallSlot(slotDef);
    }
    
    // Sort by order
    const sortedSlotIds = Object.keys(callSlots).sort((a, b) => {
        return (callSlots[a].order || 999) - (callSlots[b].order || 999);
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: Attach to session (FREEZE for entire call)
    // ═══════════════════════════════════════════════════════════════════
    existingSession.callSlots = callSlots;
    existingSession.activeSlotGroups = activeGroupIds;
    existingSession.callSlotsInitializedAt = new Date().toISOString();
    existingSession.callSlotOrder = sortedSlotIds;
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: Build diagnostics
    // ═══════════════════════════════════════════════════════════════════
    diagnostics.initialized = true;
    diagnostics.activeSlotGroups = activeGroupIds;
    diagnostics.totalSlotsCreated = Object.keys(callSlots).length;
    diagnostics.slotIds = sortedSlotIds;
    diagnostics.durationMs = Date.now() - startTime;
    
    logger.info('[CALL SLOTS] ✅ Call slots initialized', {
        sessionId: existingSession._id || existingSession.sessionId,
        activeGroups: activeGroupIds,
        slotsCreated: diagnostics.totalSlotsCreated,
        slotOrder: sortedSlotIds,
        durationMs: diagnostics.durationMs
    });
    
    return {
        success: true,
        callSlots,
        activeSlotGroups: activeGroupIds,
        slotOrder: sortedSlotIds,
        diagnostics
    };
}

/**
 * Get the next slot that needs attention
 * 
 * @param {Object} callSlots - The session.callSlots object
 * @param {Array} slotOrder - Ordered list of slot IDs
 * @returns {Object|null} Next slot to process, or null if all done
 */
function getNextSlotToProcess(callSlots, slotOrder = []) {
    // Use slotOrder if provided, otherwise use Object.keys
    const orderedIds = slotOrder.length > 0 ? slotOrder : Object.keys(callSlots);
    
    for (const slotId of orderedIds) {
        const slot = callSlots[slotId];
        if (!slot) continue;
        
        // Skip non-required slots that are empty (optional)
        // But process required slots or slots that have partial data
        
        if (slot.required) {
            // Required slot: must be DONE state
            if (slot.state !== 'DONE') {
                return { slotId, slot, reason: 'required_not_done' };
            }
        }
    }
    
    return null; // All slots complete
}

/**
 * Check if ALL required slots are complete
 * 
 * @param {Object} callSlots - The session.callSlots object
 * @returns {Object} { complete: boolean, missingSlots: string[] }
 */
function areAllSlotsComplete(callSlots) {
    const missingSlots = [];
    
    for (const [slotId, slot] of Object.entries(callSlots || {})) {
        if (slot.required && slot.state !== 'DONE') {
            missingSlots.push(slotId);
        }
    }
    
    return {
        complete: missingSlots.length === 0,
        missingSlots,
        totalRequired: Object.values(callSlots || {}).filter(s => s.required).length,
        totalComplete: Object.values(callSlots || {}).filter(s => s.state === 'DONE').length
    };
}

/**
 * Common name misspellings/variants for spelling check
 */
const COMMON_NAME_VARIANTS = {
    'mark': ['marc'],
    'marc': ['mark'],
    'brian': ['bryan'],
    'bryan': ['brian'],
    'steven': ['stephen'],
    'stephen': ['steven'],
    'jeff': ['geoff'],
    'geoff': ['jeff'],
    'erik': ['eric'],
    'eric': ['erik'],
    'shawn': ['sean', 'shaun'],
    'sean': ['shawn', 'shaun'],
    'shaun': ['shawn', 'sean'],
    'caitlin': ['kaitlyn', 'katelyn'],
    'kaitlyn': ['caitlin', 'katelyn'],
    'megan': ['meghan'],
    'meghan': ['megan'],
    'lindsay': ['lindsey'],
    'lindsey': ['lindsay'],
    'ashley': ['ashlee', 'ashleigh'],
    'sarah': ['sara'],
    'sara': ['sarah'],
    'allan': ['alan', 'allen'],
    'alan': ['allan', 'allen'],
    'allen': ['allan', 'alan'],
    'phillip': ['philip'],
    'philip': ['phillip'],
    'matthew': ['mathew'],
    'mathew': ['matthew'],
    'jeffrey': ['geoffrey'],
    'geoffrey': ['jeffrey'],
    'carl': ['karl'],
    'karl': ['carl'],
    'curt': ['kurt'],
    'kurt': ['curt'],
    'katherine': ['catherine', 'kathryn'],
    'catherine': ['katherine', 'kathryn'],
    'kathryn': ['katherine', 'catherine'],
    'anne': ['ann'],
    'ann': ['anne']
};

/**
 * Update a slot's value and state
 * Handles type-specific logic (name spelling, address merging)
 * 
 * @param {Object} callSlots - The session.callSlots object
 * @param {string} slotId - Slot to update
 * @param {Object} update - { value, confirmed, state }
 * @returns {Object} { success: boolean, needsFollowUp: boolean, followUpType: string }
 */
function updateSlotValue(callSlots, slotId, update) {
    const slot = callSlots?.[slotId];
    if (!slot) {
        logger.warn('[CALL SLOTS] ⚠️ Cannot update non-existent slot', { slotId });
        return { success: false, needsFollowUp: false };
    }
    
    const result = { success: true, needsFollowUp: false, followUpType: null };
    
    // ═══════════════════════════════════════════════════════════════════
    // TYPE-SPECIFIC HANDLING: NAME
    // ═══════════════════════════════════════════════════════════════════
    if (slot.type === 'name' && update.value) {
        // Initialize name-specific meta
        slot.nameMeta = slot.nameMeta || {
            firstName: null,
            lastName: null,
            spellingChecked: false,
            spellingVariant: null,
            lastNameAsked: false
        };
        
        const nameParts = update.value.trim().split(/\s+/);
        
        if (nameParts.length === 1) {
            // Single name - this is first name only
            slot.nameMeta.firstName = nameParts[0];
            slot.rawValue = update.value;
            
            const typeOpts = slot.typeOptions || {};
            const lowerFirst = nameParts[0].toLowerCase();
            
            // Check for spelling variants
            if (typeOpts.spellingCheck !== false && COMMON_NAME_VARIANTS[lowerFirst]) {
                if (!slot.nameMeta.spellingChecked) {
                    slot.nameMeta.spellingVariant = COMMON_NAME_VARIANTS[lowerFirst][0];
                    slot.state = 'CONFIRMING';
                    result.needsFollowUp = true;
                    result.followUpType = 'spelling_variant';
                    result.variant = slot.nameMeta.spellingVariant;
                    
                    logger.info('[CALL SLOTS] 🔍 Name spelling variant check needed', {
                        firstName: nameParts[0],
                        variant: slot.nameMeta.spellingVariant
                    });
                }
            }
            
            // Check if we need last name
            if (typeOpts.askLastIfMissing !== false && !slot.nameMeta.lastName) {
                if (!slot.nameMeta.lastNameAsked && !result.needsFollowUp) {
                    slot.state = 'CAPTURED_PARTIAL';
                    result.needsFollowUp = true;
                    result.followUpType = 'need_last_name';
                    slot.nameMeta.lastNameAsked = true;
                    
                    logger.info('[CALL SLOTS] 👤 Need last name', { firstName: nameParts[0] });
                }
            }
            
            // If no follow-up needed and only first name required
            if (!result.needsFollowUp && typeOpts.firstNameOnly) {
                slot.value = nameParts[0];
                slot.state = slot.confirmBack ? 'CONFIRMING' : 'DONE';
            }
        } else {
            // Full name provided
            slot.nameMeta.firstName = nameParts[0];
            slot.nameMeta.lastName = nameParts.slice(1).join(' ');
            slot.rawValue = update.value;
            slot.value = update.value;
            
            // Still check spelling for first name
            const typeOpts = slot.typeOptions || {};
            const lowerFirst = nameParts[0].toLowerCase();
            
            if (typeOpts.spellingCheck !== false && COMMON_NAME_VARIANTS[lowerFirst] && !slot.nameMeta.spellingChecked) {
                slot.nameMeta.spellingVariant = COMMON_NAME_VARIANTS[lowerFirst][0];
                slot.state = 'CONFIRMING';
                result.needsFollowUp = true;
                result.followUpType = 'spelling_variant';
                result.variant = slot.nameMeta.spellingVariant;
            } else {
                slot.state = slot.confirmBack ? 'CONFIRMING' : 'DONE';
            }
        }
    }
    // ═══════════════════════════════════════════════════════════════════
    // TYPE-SPECIFIC HANDLING: ADDRESS (merging partials)
    // ═══════════════════════════════════════════════════════════════════
    else if (slot.type === 'address' && update.value) {
        // Initialize address-specific meta
        slot.addressMeta = slot.addressMeta || {
            street: null,
            city: null,
            state: null,
            zip: null,
            raw: []
        };
        
        // Append raw inputs for merging
        slot.addressMeta.raw.push(update.value);
        slot.rawValue = slot.addressMeta.raw.join(' ');
        
        // Parse address components from combined raw
        const combined = slot.rawValue;
        
        // Extract ZIP (5 digits, not at start of address)
        const zipMatch = combined.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\d)/);
        if (zipMatch) {
            slot.addressMeta.zip = zipMatch[1];
        }
        
        // Extract state (2-letter code or full name)
        const statePatterns = [
            /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i,
            /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)\b/i
        ];
        
        for (const pattern of statePatterns) {
            const stateMatch = combined.match(pattern);
            if (stateMatch) {
                slot.addressMeta.state = stateMatch[1];
                break;
            }
        }
        
        // Extract street (starts with number)
        const streetMatch = combined.match(/^\d+\s+[^,]+/);
        if (streetMatch) {
            slot.addressMeta.street = streetMatch[0].trim();
        }
        
        // City is trickier - look for pattern between street and state
        // Simple heuristic: after street, before state/zip
        if (slot.addressMeta.street && slot.addressMeta.state) {
            const afterStreet = combined.slice(slot.addressMeta.street.length);
            const cityMatch = afterStreet.match(/,?\s*([A-Za-z\s]+?)(?:,|\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Alabama|Alaska|Arizona|Florida|Georgia|Texas|California|Colorado|Nevada|Oregon|Washington))/i);
            if (cityMatch) {
                slot.addressMeta.city = cityMatch[1].trim();
            }
        }
        
        // Determine completeness
        const hasStreet = !!slot.addressMeta.street;
        const hasCity = !!slot.addressMeta.city;
        const hasState = !!slot.addressMeta.state;
        const hasZip = !!slot.addressMeta.zip;
        
        const typeOpts = slot.typeOptions || {};
        const requireCityStateZip = typeOpts.requireCityStateZip !== false;
        
        logger.info('[CALL SLOTS] 📍 Address parsed', {
            street: slot.addressMeta.street,
            city: slot.addressMeta.city,
            state: slot.addressMeta.state,
            zip: slot.addressMeta.zip,
            hasStreet, hasCity, hasState, hasZip
        });
        
        if (hasStreet && (!requireCityStateZip || (hasCity && hasState))) {
            slot.value = slot.rawValue;
            slot.state = slot.confirmBack ? 'CONFIRMING' : 'DONE';
        } else {
            // Need more info
            slot.state = 'CAPTURED_PARTIAL';
            result.needsFollowUp = true;
            
            if (!hasCity || !hasState) {
                result.followUpType = 'need_city_state';
            } else if (!hasZip && typeOpts.requireZip) {
                result.followUpType = 'need_zip';
            }
            
            logger.info('[CALL SLOTS] 📍 Address incomplete, need more info', {
                needCity: !hasCity,
                needState: !hasState,
                needZip: !hasZip && typeOpts.requireZip
            });
        }
    }
    // ═══════════════════════════════════════════════════════════════════
    // GENERIC HANDLING (non-name, non-address)
    // ═══════════════════════════════════════════════════════════════════
    else {
        // Update allowed fields
        if (update.value !== undefined) {
            slot.rawValue = update.value;
            slot.value = update.value;
        }
        if (update.confirmed !== undefined) {
            slot.confirmed = update.confirmed;
        }
        if (update.state !== undefined) {
            slot.state = update.state;
        }
        if (update.askedCount !== undefined) {
            slot.askedCount = update.askedCount;
        }
        
        // Auto-transition states based on data
        if (slot.value && (slot.state === 'NOT_ASKED' || slot.state === 'ASKED')) {
            slot.state = 'CAPTURED';
        }
        
        // Check if slot is DONE
        if (slot.value) {
            if (!slot.confirmBack || slot.confirmed) {
                slot.state = 'DONE';
            } else if (slot.confirmBack && !slot.confirmed && slot.state === 'CAPTURED') {
                slot.state = 'CONFIRMING';
            }
        }
    }
    
    // Handle explicit confirmation (for all types)
    if (update.confirmed !== undefined) {
        slot.confirmed = update.confirmed;
        
        if (slot.confirmed && slot.state === 'CONFIRMING') {
            if (slot.type === 'name') {
                slot.nameMeta = slot.nameMeta || {};
                slot.nameMeta.spellingChecked = true;
            }
            slot.state = slot.value ? 'DONE' : 'CONFIRMED';
        }
    }
    
    logger.debug('[CALL SLOTS] 📝 Slot updated', {
        slotId,
        type: slot.type,
        value: slot.value?.substring?.(0, 30) || slot.value,
        confirmed: slot.confirmed,
        state: slot.state,
        needsFollowUp: result.needsFollowUp,
        followUpType: result.followUpType
    });
    
    return result;
}

/**
 * Get diagnostic output for Test Console
 * 
 * @param {Object} session - Session with callSlots
 * @returns {Object} Debug-friendly output
 */
function getCallSlotsDiagnostics(session) {
    const callSlots = session?.callSlots || {};
    const completionStatus = areAllSlotsComplete(callSlots);
    
    const slotSummary = {};
    for (const [slotId, slot] of Object.entries(callSlots)) {
        slotSummary[slotId] = {
            value: slot.value,
            required: slot.required,
            state: slot.state,
            confirmed: slot.confirmed,
            question: slot.question?.substring(0, 50)
        };
    }
    
    return {
        activeSlotGroups: session?.activeSlotGroups || [],
        slotOrder: session?.callSlotOrder || [],
        callSlots: slotSummary,
        missingSlots: completionStatus.missingSlots,
        isComplete: completionStatus.complete,
        totalRequired: completionStatus.totalRequired,
        totalComplete: completionStatus.totalComplete,
        initializedAt: session?.callSlotsInitializedAt
    };
}

module.exports = {
    initializeCallSlots,
    getNextSlotToProcess,
    areAllSlotsComplete,
    updateSlotValue,
    getCallSlotsDiagnostics,
    evaluateGroupConditions,
    buildCallSlot,
    SLOT_TYPES
};


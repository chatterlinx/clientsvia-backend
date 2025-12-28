/**
 * BookingContractCompiler.js
 *
 * Booking Contract V2 compiler:
 * - Input: slotLibrary[] + slotGroups[] + contextFlags (typically session.flags)
 * - Output: deterministic activeSlotsOrdered[] plus helper to bridge into legacy bookingSlots format
 *
 * IMPORTANT: This file does NOT inject defaults. If config is missing/empty, output is empty.
 */
const logger = require('../utils/logger');

function isPlainObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
}

function matchesWhen(when, contextFlags) {
    if (!isPlainObject(when) || Object.keys(when).length === 0) return true;
    if (!isPlainObject(contextFlags)) return false;
    return Object.entries(when).every(([k, v]) => contextFlags[k] === v);
}

function normalizeSlotType(type) {
    const t = (type || '').toString().trim().toLowerCase();
    if (!t) return 'text';
    if (t === 'datetime') return 'time'; // legacy engine expects 'time' semantics
    return t;
}

function toLegacySlotIdFromType(type, fallbackId) {
    const t = normalizeSlotType(type);
    if (t === 'name') return 'name';
    if (t === 'phone') return 'phone';
    if (t === 'address') return 'address';
    if (t === 'email') return 'email';
    if (t === 'time' || t === 'date') return 'time';
    // Custom fields are keyed by their own id
    return fallbackId || null;
}

/**
 * Compile the booking contract to an ordered list of active slot definitions.
 *
 * Group selection rules:
 * - enabled groups only
 * - groups whose `when` matches contextFlags
 * - processed in ascending group.order
 * - default groups (isDefault=true) are processed LAST, unless they also match (they still match)
 * - slot order within group follows group.slots array order (deduped across groups)
 */
function compileBookingSlots({ slotLibrary = [], slotGroups = [], contextFlags = {} } = {}) {
    const lib = Array.isArray(slotLibrary) ? slotLibrary : [];
    const groups = Array.isArray(slotGroups) ? slotGroups : [];

    const libById = new Map();
    for (const s of lib) {
        if (s && typeof s.id === 'string' && s.id.trim()) {
            libById.set(s.id.trim(), s);
        }
    }

    const enabledGroups = groups.filter(g => g && g.enabled !== false);
    const matchingGroups = enabledGroups.filter(g => matchesWhen(g.when, contextFlags));

    // Sort groups: non-default first by order, then default by order
    const sorted = matchingGroups.sort((a, b) => {
        const aDef = a.isDefault === true ? 1 : 0;
        const bDef = b.isDefault === true ? 1 : 0;
        if (aDef !== bDef) return aDef - bDef; // non-default (0) first
        return (a.order || 0) - (b.order || 0);
    });

    const activeSlotIdsOrdered = [];
    const seen = new Set();

    for (const g of sorted) {
        const ids = Array.isArray(g.slots) ? g.slots : [];
        for (const rawId of ids) {
            const id = (rawId || '').toString().trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            activeSlotIdsOrdered.push(id);
        }
    }

    const activeSlotsOrdered = activeSlotIdsOrdered
        .map(id => libById.get(id))
        .filter(Boolean);

    const missingSlotRefs = activeSlotIdsOrdered.filter(id => !libById.has(id));

    const hash = require('crypto')
        .createHash('sha256')
        .update(JSON.stringify({ activeSlotIdsOrdered, contextFlags: contextFlags || {} }))
        .digest('hex')
        .slice(0, 16);

    return {
        hash,
        contextFlags: contextFlags || {},
        matchingGroupIds: sorted.map(g => g.id || null).filter(Boolean),
        activeSlotIdsOrdered,
        activeSlotsOrdered,
        missingSlotRefs
    };
}

/**
 * Bridge active V2 slots into legacy bookingSlots raw objects that BookingScriptEngine can normalize.
 * This keeps runtime stable while V2 is rolled out behind a feature flag.
 */
function toLegacyBookingSlots(activeSlotsOrdered = []) {
    const slots = Array.isArray(activeSlotsOrdered) ? activeSlotsOrdered : [];
    const legacy = [];

    for (let idx = 0; idx < slots.length; idx++) {
        const s = slots[idx] || {};
        const slotType = normalizeSlotType(s.type);
        const slotId = toLegacySlotIdFromType(slotType, s.id);

        if (!slotId || !s.question) {
            // Skip invalid slot definitions; diagnostics should catch these
            continue;
        }

        // Flatten typeOptions onto the legacy slot object (legacy engine expects top-level keys)
        const typeOptions = isPlainObject(s.typeOptions) ? s.typeOptions : {};
        const merged = {
            slotId,
            id: slotId, // legacy compatibility
            key: s.id,  // preserve original library id (debug)
            label: s.label || slotId,
            question: s.question,
            required: s.required === true,
            order: typeof s.order === 'number' ? s.order : idx,
            type: slotType,
            confirmBack: s.confirmBack === true,
            confirmPrompt: s.confirmPrompt || undefined,
            validation: s.validation || undefined,
            selectOptions: Array.isArray(s.enumOptions) ? s.enumOptions : undefined,
            ...typeOptions
        };

        legacy.push(merged);
    }

    // Deterministic order
    legacy.sort((a, b) => (a.order || 0) - (b.order || 0));
    return legacy;
}

function compileToLegacyBookingSlots({ slotLibrary, slotGroups, contextFlags }) {
    const compiled = compileBookingSlots({ slotLibrary, slotGroups, contextFlags });
    const legacySlots = toLegacyBookingSlots(compiled.activeSlotsOrdered);
    return { compiled, legacySlots };
}

module.exports = {
    compileBookingSlots,
    toLegacyBookingSlots,
    compileToLegacyBookingSlots,
    // exported for testing/diagnostics
    _internal: { matchesWhen, normalizeSlotType, toLegacySlotIdFromType }
};



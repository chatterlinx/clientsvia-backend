const clone = (value) => JSON.parse(JSON.stringify(value || {}));

function slotToValue(slotEntry) {
    if (slotEntry == null) {
        return null;
    }
    if (typeof slotEntry === 'object' && !Array.isArray(slotEntry)) {
        if (slotEntry.v != null) {
            return slotEntry.v;
        }
        if (slotEntry.value != null) {
            return slotEntry.value;
        }
    }
    return slotEntry;
}

function extractPlainSlots(slots) {
    const out = {};
    Object.entries(slots || {}).forEach(([key, entry]) => {
        if (key.startsWith('_')) {
            return;
        }
        const value = slotToValue(entry);
        if (value != null && `${value}`.trim() !== '') {
            out[key] = value;
        }
    });
    return out;
}

function extractSlotMeta(slots) {
    const out = {};
    Object.entries(slots || {}).forEach(([key, entry]) => {
        if (key.startsWith('_') || entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
            return;
        }
        const source = entry.s || entry.source || null;
        const confidence = entry.c ?? entry.confidence ?? null;
        if (source || confidence != null) {
            out[key] = { source, confidence };
        }
    });
    return out;
}

function writeSlotValue(slots, key, value, source = 'core_runtime') {
    if (value == null || `${value}`.trim() === '') {
        return;
    }
    const existing = slots[key];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        slots[key] = { ...existing, value, v: value, source, s: source };
        return;
    }
    slots[key] = { value, v: value, source, s: source };
}

function hasValue(value) {
    return value != null && `${value}`.trim() !== '';
}

function derivePresenceFlags(slots = {}, pendingSlots = {}) {
    // Presence flags are a runtime truth-view. In DISCOVERY, slots are often stored
    // in pendingSlots first; these must count as "present" to prevent regressions.
    const nameValue =
        slotToValue(slots.name) ??
        slotToValue(slots['name.first']) ??
        pendingSlots.name ??
        pendingSlots['name.first'];
    const callReasonValue = slotToValue(slots.call_reason_detail) ?? pendingSlots.call_reason_detail;
    const addressValue = slotToValue(slots.address) ?? pendingSlots.address;
    return {
        callReasonCaptured: hasValue(callReasonValue),
        namePresent: hasValue(nameValue),
        addressPresent: hasValue(addressValue)
    };
}

class StateStore {
    static load(callState = {}) {
        const slotsBag = clone(callState.slots || {});
        const plainSlots = extractPlainSlots(slotsBag);
        
        // V119: Load slotMeta from persisted state, merge with any inline metadata from slots
        // Priority: persisted slotMeta (has nameLocked, extractedInTurn) > inline slot metadata
        const inlineSlotMeta = extractSlotMeta(slotsBag);
        const persistedSlotMeta = clone(callState.slotMeta || {});
        const slotMeta = { ...inlineSlotMeta };
        // Merge persisted metadata on top (it has the richer fields)
        Object.entries(persistedSlotMeta).forEach(([key, meta]) => {
            slotMeta[key] = { ...(slotMeta[key] || {}), ...meta };
        });
        
        const lane = callState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';
        const pendingSlots = clone(callState.pendingSlots || {});
        const presenceFlags = derivePresenceFlags(slotsBag, pendingSlots);

        return {
            lane,
            slots: slotsBag,
            plainSlots,
            slotMeta,
            callReasonCaptured: presenceFlags.callReasonCaptured,
            namePresent: presenceFlags.namePresent,
            addressPresent: presenceFlags.addressPresent,
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V116: PENDING SLOTS - Extracted but not confirmed
            // ═══════════════════════════════════════════════════════════════════════════
            // ARCHITECTURE:
            //   Discovery: Slots extracted → stored as PENDING (not confirmed)
            //   Discovery: Uses pending slots for CONTEXT ("Got it, Mrs. Johnson...")
            //   Booking: Confirms pending slots → moves to CONFIRMED
            // 
            // RATIONALE:
            //   Callers volunteer info out of order. Discovery should use it immediately
            //   for context, but formally confirm during booking (not re-ask).
            // ═══════════════════════════════════════════════════════════════════════════
            pendingSlots,      // V116: Unconfirmed
            confirmedSlots: clone(callState.confirmedSlots || {}),  // V116: Booking-confirmed
            
            discovery: {
                currentStepId: callState.discoveryCurrentStepId || null,
                currentSlotId: callState.discoveryCurrentSlotId || null,
                pendingConfirmation: callState.discoveryPendingConfirmation || null,
                repromptCount: clone(callState.discoveryRepromptCount || {}),
                confirmedSlots: clone(callState.discoveryConfirmedSlots || {}),  // Discovery-level confirmed
                acknowledgedSlots: clone(callState.discoveryAcknowledgedSlots || {}),
                complete: callState.discoveryComplete === true
            },
            consent: {
                pending: callState.bookingConsentPending === true,
                askedExplicitly: callState.consentQuestionExplicitlyAsked === true
            },
            booking: {
                currentStepId: callState.currentStepId || callState.currentBookingStep || null,
                currentSlotId: callState.currentSlotId || null,
                slotSubStep: callState.slotSubStep || null,
                pendingConfirmation: callState.pendingConfirmation || null,
                pendingFinalConfirmation: callState.pendingFinalConfirmation || false,
                confirmedSlots: clone(callState.bookingConfirmedSlots || {}),  // Booking-level confirmed
                lockedSlots: clone(callState.lockedSlots || {}),
                repromptCount: clone(callState.repromptCount || {}),
                addressCollected: clone(callState.addressCollected || {}),
                bookingComplete: callState.bookingComplete === true
            },

            // ───────────────────────────────────────────────────────────────────
            // AGENT 2.0 - Isolated state namespace (persisted)
            // ───────────────────────────────────────────────────────────────────
            agent2: clone(callState.agent2 || {})
        };
    }

    static persist(callState = {}, state = {}) {
        const next = callState;
        const slotsBag = clone(state.slots || next.slots || {});

        // Persist plain slots as canonical truth.
        Object.entries(state.plainSlots || {}).forEach(([key, value]) => {
            writeSlotValue(slotsBag, key, value);
        });

        next.slots = slotsBag;
        next.sessionMode = state.lane === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

        // ═══════════════════════════════════════════════════════════════════════════
        // V116: Persist pending and confirmed slots
        // ═══════════════════════════════════════════════════════════════════════════
        next.pendingSlots = clone(state.pendingSlots || {});      // V116: Unconfirmed slots
        next.confirmedSlots = clone(state.confirmedSlots || {});  // V116: Confirmed slots

        // ═══════════════════════════════════════════════════════════════════════════
        // V119: Persist slotMeta (confidence, source, nameLocked, extractedInTurn)
        // ═══════════════════════════════════════════════════════════════════════════
        // CRITICAL: Without this, name confidence is lost on subsequent turns,
        // causing Agent 2.0 to not use the caller's name in responses.
        next.slotMeta = clone(state.slotMeta || {});

        next.discoveryCurrentStepId = state.discovery?.currentStepId || null;
        next.discoveryCurrentSlotId = state.discovery?.currentSlotId || null;
        next.discoveryPendingConfirmation = state.discovery?.pendingConfirmation || null;
        next.discoveryRepromptCount = clone(state.discovery?.repromptCount || {});
        next.discoveryConfirmedSlots = clone(state.discovery?.confirmedSlots || {});  // Discovery-level
        next.discoveryAcknowledgedSlots = clone(state.discovery?.acknowledgedSlots || {});
        next.discoveryComplete = state.discovery?.complete === true;

        next.bookingConsentPending = state.consent?.pending === true;
        next.consentQuestionExplicitlyAsked = state.consent?.askedExplicitly === true;

        next.currentStepId = state.booking?.currentStepId || null;
        next.currentBookingStep = state.booking?.currentStepId || null;
        next.currentSlotId = state.booking?.currentSlotId || null;
        next.slotSubStep = state.booking?.slotSubStep || null;
        next.pendingConfirmation = state.booking?.pendingConfirmation || null;
        next.pendingFinalConfirmation = state.booking?.pendingFinalConfirmation === true;
        next.repromptCount = clone(state.booking?.repromptCount || {});
        next.bookingConfirmedSlots = clone(state.booking?.confirmedSlots || {});  // Booking-level
        next.lockedSlots = clone(state.booking?.lockedSlots || {});
        next.addressCollected = clone(state.booking?.addressCollected || {});
        next.bookingComplete = state.booking?.bookingComplete === true;

        // Derive legacy presence flags from slot truth to prevent stale false writes.
        const presenceFlags = derivePresenceFlags(next.slots, next.pendingSlots);
        next.callReasonCaptured = presenceFlags.callReasonCaptured;
        next.namePresent = presenceFlags.namePresent;
        next.addressPresent = presenceFlags.addressPresent;

        // Keep legacy views derived from slots to avoid downstream breakage.
        next.bookingCollected = { ...(next.bookingCollected || {}), ...(state.plainSlots || {}) };
        next.bookingModeLocked = state.lane === 'BOOKING' || next.bookingModeLocked === true;

        // Persist Agent 2.0 isolated state (never interpreted by legacy runtime).
        next.agent2 = clone(state.agent2 || next.agent2 || {});

        return next;
    }
}

module.exports = { StateStore, extractPlainSlots, writeSlotValue };

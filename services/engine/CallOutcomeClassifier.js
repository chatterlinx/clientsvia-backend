'use strict';

/**
 * ============================================================================
 * CALL OUTCOME CLASSIFIER  (Build Step 9)
 * ============================================================================
 *
 * PURPOSE:
 *   At call end (status-callback), classify the business outcome from the
 *   persisted discoveryNotes.  Writes callOutcome to:
 *     1. Customer.discoveryNotes[].callOutcome  (chart — permanent)
 *     2. CallSummary.callOutcome                (dashboard — reporting)
 *
 *   This is a pure classification step — no LLM, no external calls, ~0ms.
 *
 * CLASSIFICATION LOGIC:
 *
 *   CONVERTED         confirmed{} has ≥1 non-null value
 *                     (UAPB BOOKING_CONFIRM was fired — the hard signal, per G3)
 *
 *   BOOKING_STARTED   objective reached BOOKING but confirmed{} is empty
 *                     → qualifies as LOST_LEAD (Step 10)
 *
 *   TRANSFERRED       objective === 'TRANSFER' at call end
 *
 *   DISCOVERY_COMPLETE objective === 'DISCOVERY'
 *
 *   INTAKE_COMPLETE   objective === 'INTAKE'
 *
 *   CLOSING_INCOMPLETE objective === 'CLOSING' but confirmed{} empty
 *                      (edge case: objective bumped but confirm not fired)
 *
 *   ABANDONED         call duration < 10s OR turnCount < 2
 *                     (caller dropped before any meaningful engagement)
 *
 *   UNKNOWN           fallback — no notes or classification not possible
 *
 * LOST_LEAD FLAG:
 *   isLostLead = true when outcome === BOOKING_STARTED
 *   (had CommittedAct intent, booking engine entered, no conversion)
 *   Step 10 will use this flag to write to the LostLeads collection.
 *
 * MULTI-TENANT SAFETY:
 *   No data crosses companyId boundaries. Each classification is scoped.
 *
 * USAGE:
 *   const result = CallOutcomeClassifier.classify(discoveryNotes, durationSeconds);
 *   // → { outcome, isLostLead, reason }
 *
 *   await CallOutcomeClassifier.persist(companyId, callSid, customerId, callSummaryId, durationSeconds);
 *   // Loads notes from DB, classifies, writes outcome back to both records.
 *
 * ============================================================================
 */

const logger   = require('../../utils/logger');
const Customer = require('../../models/Customer');

// ── Outcome constants ────────────────────────────────────────────────────────

const OUTCOMES = {
  CONVERTED:           'CONVERTED',            // booking confirmed (hard signal)
  BOOKING_STARTED:     'BOOKING_STARTED',       // booking entered, not confirmed → LOST_LEAD
  CLOSING_INCOMPLETE:  'CLOSING_INCOMPLETE',    // CLOSING objective but no confirm
  TRANSFERRED:         'TRANSFERRED',           // call transferred to staff
  DISCOVERY_COMPLETE:  'DISCOVERY_COMPLETE',    // discovery done, no booking started
  INTAKE_COMPLETE:     'INTAKE_COMPLETE',       // basic intake, no further progress
  ABANDONED:           'ABANDONED',             // dropped too early for classification
  UNKNOWN:             'UNKNOWN',               // no notes / not classifiable
};

const ABANDONED_MAX_DURATION_SECONDS = 10;
const ABANDONED_MAX_TURNS            = 2;

// ============================================================================
// CLASSIFY — pure function, no DB
// ============================================================================

/**
 * classify — Determine the business outcome from discoveryNotes.
 *
 * @param {Object|null} notes          — discoveryNotes object (from Redis or DB)
 * @param {number}      durationSeconds — Twilio call duration
 * @returns {{ outcome: string, isLostLead: boolean, reason: string }}
 */
function classify(notes, durationSeconds = 0) {

  // No notes → classify from duration alone
  if (!notes) {
    const outcome = durationSeconds < ABANDONED_MAX_DURATION_SECONDS
      ? OUTCOMES.ABANDONED
      : OUTCOMES.UNKNOWN;
    return { outcome, isLostLead: false, reason: 'no_notes' };
  }

  const objective  = notes.objective  || 'INTAKE';
  const confirmed  = notes.confirmed  || {};
  const turnCount  = notes.turnNumber || notes.turnCount || 0;

  // ── ABANDONED — call too short to classify meaningfully ─────────────────
  if (durationSeconds < ABANDONED_MAX_DURATION_SECONDS && turnCount < ABANDONED_MAX_TURNS) {
    return { outcome: OUTCOMES.ABANDONED, isLostLead: false, reason: 'call_too_short' };
  }

  // ── CONVERTED — booking confirmed (UAPB BOOKING_CONFIRM hard signal, G3) ─
  // Any non-null value in confirmed{} = BOOKING_CONFIRM was fired = converted.
  const confirmedValues = Object.values(confirmed).filter(v => v != null);
  if (confirmedValues.length > 0) {
    return { outcome: OUTCOMES.CONVERTED, isLostLead: false, reason: 'booking_confirmed' };
  }

  // ── BOOKING_STARTED — objective reached BOOKING/CLOSING but no confirm ───
  if (objective === 'BOOKING') {
    return { outcome: OUTCOMES.BOOKING_STARTED, isLostLead: true, reason: 'booking_incomplete' };
  }
  if (objective === 'CLOSING') {
    return { outcome: OUTCOMES.CLOSING_INCOMPLETE, isLostLead: false, reason: 'closing_no_confirm' };
  }

  // ── TRANSFERRED ──────────────────────────────────────────────────────────
  if (objective === 'TRANSFER') {
    return { outcome: OUTCOMES.TRANSFERRED, isLostLead: false, reason: 'transferred' };
  }

  // ── DISCOVERY_COMPLETE ──────────────────────────────────────────────────
  if (objective === 'DISCOVERY') {
    return { outcome: OUTCOMES.DISCOVERY_COMPLETE, isLostLead: false, reason: 'discovery_done' };
  }

  // ── INTAKE_COMPLETE ──────────────────────────────────────────────────────
  if (objective === 'INTAKE') {
    return { outcome: OUTCOMES.INTAKE_COMPLETE, isLostLead: false, reason: 'intake_only' };
  }

  return { outcome: OUTCOMES.UNKNOWN, isLostLead: false, reason: 'unclassifiable' };
}

// ============================================================================
// PERSIST — classify + write to DB
// ============================================================================

/**
 * persist — Load notes, classify, write callOutcome to Customer.discoveryNotes[]
 * and CallSummary. Non-blocking — caller should fire-and-forget.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string} customerId         — Customer._id (string)
 * @param {string|null} callSummaryId — CallSummary._id (string) — optional
 * @param {number} durationSeconds    — Twilio CallDuration
 * @returns {Promise<{ outcome, isLostLead, reason }|null>}
 */
async function persist(companyId, callSid, customerId, callSummaryId, durationSeconds = 0) {
  try {
    if (!companyId || !callSid || !customerId) {
      logger.warn('[CallOutcome] persist: missing required fields', { companyId, callSid, customerId });
      return null;
    }

    // Load the most recent discoveryNotes entry for this callSid from Customer record
    // (persist() already fired before us — the data is in MongoDB now)
    const customer = await Customer.findOne(
      { _id: customerId, companyId },
      { 'discoveryNotes.$': 1 }
    ).lean().catch(() => null);

    const notesEntry = customer?.discoveryNotes?.find?.(n => n.callSid === callSid)
      || (customer?.discoveryNotes?.[0]);    // $-projection lands here

    const result = classify(notesEntry, durationSeconds);

    // Write callOutcome to Customer.discoveryNotes[] entry
    await Customer.updateOne(
      { _id: customerId, companyId, 'discoveryNotes.callSid': callSid },
      { $set: {
        'discoveryNotes.$[elem].callOutcome':   result.outcome,
        'discoveryNotes.$[elem].isLostLead':    result.isLostLead,
        'discoveryNotes.$[elem].classifiedAt':  new Date(),
      }},
      { arrayFilters: [{ 'elem.callSid': callSid }] }
    );

    // Write callOutcome to CallSummary (for dashboard / reporting)
    if (callSummaryId) {
      try {
        const CallSummary = require('../../models/CallSummary');
        await CallSummary.updateOne(
          { _id: callSummaryId },
          { $set: {
            callOutcome: result.outcome,
            isLostLead:  result.isLostLead,
          }}
        );
      } catch (csErr) {
        logger.warn('[CallOutcome] Failed to write to CallSummary (non-fatal)', {
          callSummaryId, error: csErr.message
        });
      }
    }

    logger.info('[CallOutcome] Classified', {
      companyId,
      callSid,
      outcome:    result.outcome,
      isLostLead: result.isLostLead,
      reason:     result.reason,
    });

    return result;

  } catch (err) {
    logger.warn('[CallOutcome] persist failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  classify,
  persist,
  OUTCOMES,
};

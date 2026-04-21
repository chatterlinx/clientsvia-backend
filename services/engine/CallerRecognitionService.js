'use strict';

/**
 * ============================================================================
 * CALLER RECOGNITION SERVICE  (Build Step 11)
 * ============================================================================
 *
 * PURPOSE:
 *   Pre-warm discoveryNotes on Twilio inbound signal — before turn 1.
 *   Ensures the LLM has full caller context from the first word:
 *     "Oh hi Jessica — welcome back!"
 *   instead of:
 *     "Thank you for calling. May I have your name please?"
 *
 * DESIGN:
 *   1. Twilio fires /:companyId/voice webhook (inbound signal).
 *   2. CallerRecognitionService.preWarm(companyId, callSid, callerPhone) fires
 *      non-blocking while Twilio processes the greeting audio.
 *   3. Pre-warm: phone lookup → Customer record → history → write DN to Redis.
 *   4. ConversationEngine.init() on turn 1: finds pre-warmed Redis key → skips
 *      empty init, uses existing pre-warmed state.
 *
 * PRE-WARMED DN ADDITIONS:
 *   - temp.firstName, temp.lastName, temp.phone — from last confirmed call
 *   - doNotReask[] — pre-filled with any confirmed fields (don't re-ask what we know)
 *   - callerProfile — { isKnown, visitCount, lastCallDate, lastCallReason,
 *                       lastConfirmed{}, staffRelationships[], customFields{} }
 *   - lostLeadContext — { hasOpenLead, callSid, callEndedAt, discoverySnapshot }
 *                       (surfaces most recent BOOKING_STARTED if unresolved)
 *
 * GRACEFUL DEGRADE:
 *   - Caller not found → no pre-warm → init() creates empty notes as normal
 *   - Redis unavailable → no pre-warm → call continues
 *   - Any error → logged, call continues unaffected
 *
 * PHONE NORMALIZATION:
 *   Twilio passes E.164 (+16025551234). Customer.phone is stored various ways.
 *   We try: exact → +1 stripped → last 10 digits → last 7.
 *
 * MULTI-TENANT SAFETY:
 *   Every lookup is scoped by companyId. No cross-tenant data.
 *
 * USAGE:
 *   // Fire non-blocking at inbound webhook (/:companyId/voice):
 *   CallerRecognitionService.preWarm(companyId, callSid, From).catch(() => {});
 *
 * ============================================================================
 */

const logger   = require('../../utils/logger');
const Customer = require('../../models/Customer');
const LostLead = require('../../models/LostLead');
const { getSharedRedisClient } = require('../redisClientFactory');
const { isPlausibleName, splitFullName } = require('../../utils/nameValidation');

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG = {
  KEY_PREFIX:      'discovery-notes',
  REDIS_TTL:       4 * 60 * 60,   // 4 hours — same as DiscoveryNotesService
  MAX_HISTORY:     5,              // most recent discoveryNotes entries to surface
  MAX_DOREASK:     10,             // max doNotReask entries from prior confirmed fields
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dnKey(companyId, callSid) {
  return `${CONFIG.KEY_PREFIX}:${companyId}:${callSid}`;
}

/**
 * _normalizePhone — Build phone variants for fuzzy matching.
 * Twilio sends E.164 (+16025551234). Customer.phone may be stored differently.
 */
function _normalizePhone(phone) {
  if (!phone) return [];
  const digits = phone.replace(/\D/g, '');
  const variants = new Set([
    phone,                          // as-is (Twilio E.164)
    digits,                         // digits only
    digits.slice(-10),              // last 10
    `+1${digits.slice(-10)}`,       // E.164 normalized
    `1${digits.slice(-10)}`,        // with leading 1
  ]);
  return [...variants].filter(Boolean);
}

/**
 * _findCustomer — Look up Customer by phone.
 * @param {string} companyId
 * @param {string} callerPhone
 * @returns {Promise<Object|null>}
 */
async function _findCustomer(companyId, callerPhone) {
  if (!callerPhone) return null;
  const variants = _normalizePhone(callerPhone);
  // Query both top-level phone AND phoneNumbers[].number for broader matching
  const phoneMatches = variants.flatMap(p => [
    { phone: p },
    { 'phoneNumbers.number': p }
  ]);
  return Customer.findOne({
    companyId,
    $or: phoneMatches
  }).select('_id name firstName lastName phone discoveryNotes callerProfile callHistory').lean();
}

// ============================================================================
// PRE-WARM — main public function
// ============================================================================

/**
 * preWarm — Look up caller by phone, build pre-warmed discoveryNotes, write to Redis.
 * Fires non-blocking at inbound webhook before first turn.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string} callerPhone — Twilio From field (E.164)
 * @returns {Promise<boolean>} — true if pre-warm was written, false if caller unknown
 */
async function preWarm(companyId, callSid, callerPhone) {
  try {
    if (!companyId || !callSid || !callerPhone) return false;

    const redis = await getSharedRedisClient();
    if (!redis) return false;

    // ── 1. Find the customer ──────────────────────────────────────────────
    const customer = await _findCustomer(companyId, callerPhone);
    if (!customer) {
      logger.debug('[CallerRecognition] Unknown caller — no pre-warm', { companyId, callerPhone });
      return false;
    }

    // ── 2. Find most recent confirmed discoveryNotes entry ────────────────
    // Pre-sort once — used by both the confirmed filter and the temp fallback
    const allNotesByDateDesc = (customer.discoveryNotes || [])
      .slice()
      .sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));

    const confirmedNotes = allNotesByDateDesc
      .filter(n => n.confirmed && Object.keys(n.confirmed).length > 0);

    const lastConfirmedNotes = confirmedNotes[0] || null;
    const lastConfirmed      = lastConfirmedNotes?.confirmed || {};

    // ── 3. Find most recent open LostLead (NEW or CONTACTED) ─────────────
    const lostLead = await LostLead.findOne({
      companyId,
      customerId: customer._id,
      status: { $in: ['NEW', 'CONTACTED'] },
    })
      .sort({ callEndedAt: -1 })
      .select('callSid callEndedAt discoverySnapshot status')
      .lean()
      .catch(() => null);

    // ── 4. Resolve caller name via fallback chain ─────────────────────────
    // Historical bug (pre v5 audit April 21 2026): pre-warm only read
    // lastConfirmed.firstName, which is empty for any customer who never
    // completed a BOOKING_CONFIRM (177 dN entries / 69 callHistory entries
    // for +12398889905 had ZERO confirmed non-empty). Result: every call
    // greeted a well-known customer as a stranger.
    //
    // Fallback chain — strongest evidence first:
    //   1. confirmed            — discoveryNotes[i].confirmed.firstName/lastName
    //   2. knownNames_confirmed — callerProfile.knownNames[] where source='confirmed'
    //                             AND passes isPlausibleName() (filters historical
    //                             false-promoted entries like "getting ridiculous")
    //   3. temp_most_recent     — most recent discoveryNotes[i].temp.firstName
    //                             (weakest signal; intake LLM captured but never
    //                             confirmed)
    //
    // Each step logs [CALLER_RECOGNITION_SOFT] so we SEE which source fed the
    // pre-warm on every call. Final [CallerRecognition] ✅ Pre-warmed log line
    // carries nameSource so provenance is visible end-to-end.
    let resolvedFirst = null;
    let resolvedLast  = null;
    let nameSource    = 'none';

    if (lastConfirmed.firstName || lastConfirmed.lastName) {
      resolvedFirst = lastConfirmed.firstName || null;
      resolvedLast  = lastConfirmed.lastName  || null;
      nameSource    = 'confirmed';
    } else {
      // Fallback A — knownNames with real confirmed provenance + plausibility
      const goodKnown = (customer.callerProfile?.knownNames || [])
        .filter(n => n && n.source === 'confirmed')
        .filter(n => isPlausibleName(n.name).ok)
        .sort((a, b) => (b.seenCount || 0) - (a.seenCount || 0));

      if (goodKnown.length > 0) {
        const top = goodKnown[0];
        const split = splitFullName(top.name);
        resolvedFirst = split.firstName;
        resolvedLast  = split.lastName;
        nameSource    = 'knownNames_confirmed';
        logger.info('[CALLER_RECOGNITION_SOFT] Name resolved from knownNames (no confirmed dN available)', {
          companyId, callSid, name: top.name, seenCount: top.seenCount
        });
      } else {
        // Fallback B — most recent temp.firstName (with plausibility filter)
        const tempNote = allNotesByDateDesc.find(n => n.temp && n.temp.firstName);
        const tempFirst = tempNote?.temp?.firstName || null;
        if (tempFirst && isPlausibleName(tempFirst).ok) {
          resolvedFirst = tempFirst;
          resolvedLast  = tempNote?.temp?.lastName || null;
          nameSource    = 'temp_most_recent';
          logger.info('[CALLER_RECOGNITION_SOFT] Name resolved from most-recent temp (weakest signal)', {
            companyId, callSid, firstName: resolvedFirst, capturedAt: tempNote.capturedAt
          });
        }
      }
    }

    // ── 5. Build pre-warmed temp{} ─────────────────────────────────────────
    // Non-name fields still come from lastConfirmed
    // Name fields use the resolved fallback chain above. Everything else
    // (address, phone, email, fullName) stays on the confirmed-only path —
    // those are lower-risk fields and we shouldn't pull them from temp/knownNames.
    const temp = {
      firstName:      resolvedFirst                     || null,
      lastName:       resolvedLast                      || null,
      fullName:       lastConfirmed.fullName            || null,
      address:        lastConfirmed.address             || null,
      phone:          lastConfirmed.phone               || callerPhone,
      email:          lastConfirmed.email               || null,
      issue:          null,         // fresh per-call — not carried over
      serviceType:    null,         // fresh per-call
      staffMentioned: null,         // fresh per-call
      preferredDate:  null,
      preferredTime:  null,
      confidence:     {}            // fresh — will be populated during call
    };

    // ── 6. Build doNotReask[] from pre-filled fields ───────────────────────
    // Any pre-filled field from prior confirmed data → don't re-ask
    const doNotReask = Object.entries(temp)
      .filter(([k, v]) => k !== 'confidence' && v != null)
      .map(([k]) => k)
      .slice(0, CONFIG.MAX_DOREASK);

    // ── 7. Build callerProfile block ──────────────────────────────────────
    const visitCount = (customer.discoveryNotes || []).length;

    // Repeat-issue detection — scan last 5 callHistory entries (already in memory)
    // If the same callReason appears 2+ times the caller has had recurring trouble.
    // Turn1Engine reads this to elevate empathy on turn 1 before the caller speaks.
    const recentReasons = (customer.callHistory || [])
      .slice(-5)
      .map(h => (h.callReason || '').trim().toLowerCase())
      .filter(Boolean);
    const _reasonCounts = {};
    for (const r of recentReasons) _reasonCounts[r] = (_reasonCounts[r] || 0) + 1;
    const _repeatEntry = Object.entries(_reasonCounts).find(([, count]) => count >= 2);

    const callerProfile = {
      isKnown:              true,
      customerId:           String(customer._id),
      visitCount,
      lastCallDate:         lastConfirmedNotes?.capturedAt || null,
      lastCallReason:       lastConfirmedNotes?.callReason || null,
      lastConfirmed:        lastConfirmed,
      repeatIssueDetected:  !!_repeatEntry,
      repeatIssueReason:    _repeatEntry?.[0] || null,
      // staffRelationships populated in Step 13 callerProfile enrichment
      staffRelationships: customer.callerProfile?.staffRelationships || [],
    };

    // ── 8. Build lostLeadContext ──────────────────────────────────────────
    const lostLeadContext = lostLead
      ? {
          hasOpenLead:      true,
          leadCallSid:      lostLead.callSid,
          callEndedAt:      lostLead.callEndedAt,
          status:           lostLead.status,
          discoverySnapshot: lostLead.discoverySnapshot || {},
        }
      : { hasOpenLead: false };

    // ── 9. Build pre-warmed DN object ─────────────────────────────────────
    const now = new Date().toISOString();
    const preWarmedNotes = {
      version:      2,
      companyId:    String(companyId),
      callSid:      String(callSid),
      customerId:   String(customer._id),

      temp,
      confirmed:    {},            // fresh per-call — nothing confirmed yet

      callReason:   null,          // fresh
      urgency:      null,          // fresh
      priorVisit:   visitCount > 0,
      employeeMentioned: null,

      objective:    'INTAKE',
      turnNumber:   0,
      doNotReask,
      lastMeaningfulInput: null,
      qaLog:        [],
      digressionStack: [],

      // ── Caller recognition payload ──────────────────────────────────────
      callerProfile,
      lostLeadContext,

      // ── Pre-warm flag — read by DiscoveryNotesService.init() ───────────
      _preWarmed:   true,
      _preWarmedAt: now,

      startedAt:    now,
      updatedAt:    now,
    };

    // ── 10. Write to Redis — NX (only if not already set) ─────────────────
    // NX prevents overwriting if init() somehow ran first (race condition safety)
    const key = _dnKey(companyId, callSid);
    await redis.set(key, JSON.stringify(preWarmedNotes), { EX: CONFIG.REDIS_TTL, NX: true });

    logger.info('[CallerRecognition] ✅ Pre-warmed', {
      companyId,
      callSid,
      customerId:      String(customer._id),
      isKnown:         true,
      visitCount,
      nameSource,                        // confirmed | knownNames_confirmed | temp_most_recent | none
      resolvedFirstName: resolvedFirst,  // what pre-warm decided — null is a valid value
      hasLastConfirmed: Object.keys(lastConfirmed).length > 0,
      hasOpenLead:      lostLeadContext.hasOpenLead,
      doNotReaskCount:  doNotReask.length,
    });

    return true;

  } catch (err) {
    // Any error → graceful degrade. Call continues without pre-warm.
    logger.warn('[CallerRecognition] preWarm failed (non-fatal)', {
      companyId, callSid, error: err.message
    });
    return false;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  preWarm,
  _findCustomer,   // exported for testing
  _normalizePhone, // exported for testing
};

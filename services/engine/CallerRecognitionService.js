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
  return Customer.findOne({
    companyId,
    $or: variants.map(p => ({ phone: p }))
  }).select('_id name firstName lastName phone discoveryNotes callerProfile').lean();
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
    const allNotes = (customer.discoveryNotes || [])
      .filter(n => n.confirmed && Object.keys(n.confirmed).length > 0)
      .sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));

    const lastConfirmedNotes = allNotes[0] || null;
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

    // ── 4. Build pre-warmed temp{} from last confirmed data ───────────────
    // Pre-fill temp with what we know — agent won't re-ask for confirmed fields
    const priorTemp = lastConfirmed || {};
    const temp = {
      firstName:      priorTemp.firstName      || null,
      lastName:       priorTemp.lastName       || null,
      fullName:       priorTemp.fullName       || null,
      address:        priorTemp.address        || null,
      phone:          priorTemp.phone          || callerPhone,
      email:          priorTemp.email          || null,
      issue:          null,         // fresh per-call — not carried over
      serviceType:    null,         // fresh per-call
      staffMentioned: null,         // fresh per-call
      preferredDate:  null,
      preferredTime:  null,
      confidence:     {}            // fresh — will be populated during call
    };

    // ── 5. Build doNotReask[] from pre-filled fields ───────────────────────
    // Any pre-filled field from prior confirmed data → don't re-ask
    const doNotReask = Object.entries(temp)
      .filter(([k, v]) => k !== 'confidence' && v != null)
      .map(([k]) => k)
      .slice(0, CONFIG.MAX_DOREASK);

    // ── 6. Build callerProfile block ──────────────────────────────────────
    const visitCount = (customer.discoveryNotes || []).length;
    const callerProfile = {
      isKnown:          true,
      customerId:       String(customer._id),
      visitCount,
      lastCallDate:     lastConfirmedNotes?.capturedAt || null,
      lastCallReason:   lastConfirmedNotes?.callReason || null,
      lastConfirmed:    lastConfirmed,
      // staffRelationships populated in Step 13 callerProfile enrichment
      staffRelationships: customer.callerProfile?.staffRelationships || [],
    };

    // ── 7. Build lostLeadContext ──────────────────────────────────────────
    const lostLeadContext = lostLead
      ? {
          hasOpenLead:      true,
          leadCallSid:      lostLead.callSid,
          callEndedAt:      lostLead.callEndedAt,
          status:           lostLead.status,
          discoverySnapshot: lostLead.discoverySnapshot || {},
        }
      : { hasOpenLead: false };

    // ── 8. Build pre-warmed DN object ─────────────────────────────────────
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

    // ── 9. Write to Redis — NX (only if not already set) ─────────────────
    // NX prevents overwriting if init() somehow ran first (race condition safety)
    const key = _dnKey(companyId, callSid);
    await redis.set(key, JSON.stringify(preWarmedNotes), { EX: CONFIG.REDIS_TTL, NX: true });

    logger.info('[CallerRecognition] ✅ Pre-warmed', {
      companyId,
      callSid,
      customerId:      String(customer._id),
      isKnown:         true,
      visitCount,
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

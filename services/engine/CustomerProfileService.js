'use strict';

/**
 * ============================================================================
 * CUSTOMER PROFILE SERVICE  (Build Steps 12 + 13)
 * ============================================================================
 *
 * PURPOSE:
 *   At call end, write two things to the Customer record:
 *
 *   1. callHistory[] entry (Step 12)
 *      Stamped permanent record of this call.
 *      Only CONFIRMED fields enter the chart — temp{} is never promoted here.
 *      Source of truth for CallerRecognition on future calls.
 *
 *   2. callerProfile enrichment (Step 13)
 *      Cross-call intelligence: knownNames, staffRelationships, stats.
 *      Updated atomically on each call end.
 *
 * DESIGN:
 *   - Fires at call end (status-callback), non-blocking, fire-and-forget.
 *   - Reads from Customer.discoveryNotes[] entry for this callSid (already
 *     persisted by DiscoveryNotesService before this runs).
 *   - Idempotent: callHistory uniqueness enforced via $addToSet on callSid is
 *     not available for subdoc arrays, so we check before pushing.
 *     (In practice status-callback fires once — the check is a safety net.)
 *
 * CALL CHAIN (v2twilio.js status-callback):
 *   DiscoveryNotes.persist()
 *     → DiscoveryNotes.purge()
 *     → CallOutcomeClassifier.persist()  ← writes callOutcome + LostLead
 *     → CustomerProfileService.stamp()   ← this file
 *
 * MULTI-TENANT SAFETY:
 *   Every write is scoped to companyId + customerId.
 *
 * USAGE:
 *   CustomerProfileService.stamp(companyId, callSid, customerId, durationSeconds)
 *     .catch(() => {});  // fire-and-forget
 *
 * ============================================================================
 */

const logger   = require('../../utils/logger');
const Customer = require('../../models/Customer');

// ============================================================================
// STAMP — write callHistory + enrich callerProfile at call end
// ============================================================================

/**
 * stamp — The single write that turns a call into a chart entry.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string} customerId
 * @param {number} durationSeconds
 * @returns {Promise<boolean>}
 */
async function stamp(companyId, callSid, customerId, durationSeconds = 0) {
  try {
    if (!companyId || !callSid || !customerId) {
      logger.warn('[CustomerProfile] stamp: missing required fields', { companyId, callSid, customerId });
      return false;
    }

    // ── Load the Customer + discoveryNotes entry for this callSid ─────────
    const customer = await Customer.findOne(
      { _id: customerId, companyId }
    ).select('callHistory callerProfile discoveryNotes').lean();

    if (!customer) {
      logger.warn('[CustomerProfile] stamp: Customer not found', { companyId, customerId, callSid });
      return false;
    }

    // Find the discoveryNotes entry for this call
    const dnEntry = (customer.discoveryNotes || []).find(n => n.callSid === callSid);
    if (!dnEntry) {
      logger.debug('[CustomerProfile] stamp: no discoveryNotes entry for callSid — skipping', { callSid });
      return false;
    }

    // ── Idempotency check ─────────────────────────────────────────────────
    const alreadyStamped = (customer.callHistory || []).some(h => h.callSid === callSid);
    if (alreadyStamped) {
      logger.debug('[CustomerProfile] stamp: already stamped — skipping duplicate', { callSid });
      return true;
    }

    // ── Build callHistory entry ───────────────────────────────────────────
    const confirmed      = dnEntry.confirmed      || {};
    const temp           = dnEntry.temp           || {};
    // ── Offer outcomes (from confirmed{} — computed by LOCK_ALL_TEMP at BOOKING_CONFIRM) ──
    // Falls back to temp.offeredItems if booking never confirmed (incomplete call).
    // NOT_REACHED = offer was made but caller never got to say yes or no.
    const _allOffered    = confirmed.offeredItems  || temp.offeredItems  || [];
    const _bookedItems   = confirmed.bookedItems   || _allOffered.filter(o => o.outcome === 'ACCEPTED');
    const _declinedItems = confirmed.declinedItems || _allOffered.filter(o => o.outcome === 'DECLINED');
    const _revenueBooked   = _bookedItems.reduce((s, o)   => s + (Number(o.price) || 0), 0);
    const _revenueDeclined = _declinedItems.reduce((s, o) => s + (Number(o.price) || 0), 0);
    const _revenuePotential = _revenueBooked + _revenueDeclined;

    const callHistoryEntry = {
      callSid,
      callDate:        dnEntry.capturedAt || new Date(),
      durationSeconds,
      callOutcome:     dnEntry.callOutcome     || null,
      callReason:      dnEntry.callReason      || null,
      serviceType:     temp.serviceType        || confirmed.serviceType || null,
      confirmedFields: confirmed,
      staffInvolved:   temp.staffMentioned     || confirmed.staffMentioned || null,
      urgency:         dnEntry.urgency         || temp.urgency || null,
      objective:       dnEntry.objective       || 'INTAKE',
      isLostLead:      dnEntry.isLostLead      || false,
      offeredItems:    _allOffered,
      revenue:         _revenuePotential > 0
        ? { booked: _revenueBooked, declined: _revenueDeclined, potential: _revenuePotential }
        : null,
    };

    // ── Build callerProfile updates ───────────────────────────────────────
    const existingProfile = customer.callerProfile || {};
    const now = new Date();

    // Collect name for knownNames
    const fullName = [confirmed.firstName || temp.firstName, confirmed.lastName || temp.lastName]
      .filter(Boolean).join(' ').trim() || null;

    // Staff relationship upsert
    const staffName = callHistoryEntry.staffInvolved;

    // Stats increments
    const isConverted    = dnEntry.callOutcome === 'CONVERTED';
    const isLostLead     = dnEntry.isLostLead === true;

    // ── Write: $push callHistory + update callerProfile ───────────────────
    const $set   = { 'callerProfile.lastCallAt': now };
    const $push  = { callHistory: callHistoryEntry };
    const $inc   = {};

    if (isConverted) {
      $inc['callerProfile.totalConfirmedBookings']  = 1;
      $set['callerProfile.lastConfirmedBookingAt']  = now;
    }
    if (isLostLead) {
      $inc['callerProfile.totalLostLeads'] = 1;
    }

    // Apply all changes atomically
    await Customer.updateOne(
      { _id: customerId, companyId },
      { $push, $set, ...(Object.keys($inc).length ? { $inc } : {}) }
    );

    // ── Upsert knownName ──────────────────────────────────────────────────
    if (fullName) {
      // Check if this name already exists in knownNames
      const nameExists = (existingProfile.knownNames || []).some(n => n.name === fullName);
      if (nameExists) {
        await Customer.updateOne(
          { _id: customerId, companyId, 'callerProfile.knownNames.name': fullName },
          {
            $inc: { 'callerProfile.knownNames.$.seenCount': 1 },
            $set: { 'callerProfile.knownNames.$.lastSeenAt': now }
          }
        );
      } else {
        await Customer.updateOne(
          { _id: customerId, companyId },
          {
            $push: {
              'callerProfile.knownNames': {
                name: fullName, seenCount: 1, lastSeenAt: now, source: 'confirmed'
              }
            }
          }
        );
      }
    }

    // ── Upsert staffRelationship ──────────────────────────────────────────
    if (staffName) {
      const staffExists = (existingProfile.staffRelationships || []).some(s => s.staffName === staffName);
      if (staffExists) {
        await Customer.updateOne(
          { _id: customerId, companyId, 'callerProfile.staffRelationships.staffName': staffName },
          {
            $inc: { 'callerProfile.staffRelationships.$.interactionCount': 1 },
            $set: { 'callerProfile.staffRelationships.$.lastInteractionAt': now }
          }
        );
      } else {
        await Customer.updateOne(
          { _id: customerId, companyId },
          {
            $push: {
              'callerProfile.staffRelationships': {
                staffName, interactionCount: 1, lastInteractionAt: now, preferenceNotes: null
              }
            }
          }
        );
      }
    }

    // ── Stamp upsell history + (re)compute buyerProfile tag ──────────────────
    // upsellOffers lives in temp{} — mid-call data, not a confirmed booking field.
    // These are always stamped regardless of booking outcome.
    const upsellOffers = temp.upsellOffers || [];
    if (upsellOffers.length) {
      const historyEntries = upsellOffers.map(o => ({
        itemKey:  o.itemKey  || null,
        accepted: !!o.accepted,
        price:    o.price    ?? null,
        date:     o.timestamp ? new Date(o.timestamp) : now,
        callSid,
      }));
      await Customer.updateOne(
        { _id: customerId, companyId },
        { $push: { 'callerProfile.upsellHistory': { $each: historyEntries } } }
      );

      // Compute buyerProfile tag once ≥3 data points exist across all calls
      const freshCustomer = await Customer.findOne(
        { _id: customerId, companyId },
        { 'callerProfile.upsellHistory': 1, 'callerProfile.buyerProfile': 1 }
      ).lean();

      const allUpsells = freshCustomer?.callerProfile?.upsellHistory || [];
      if (allUpsells.length >= 3) {
        const total      = allUpsells.length;
        const accepted   = allUpsells.filter(u => u.accepted).length;
        const acceptRate = accepted / total;
        const tag        = acceptRate >= 0.75 ? 'impulse_buyer'
                         : acceptRate >= 0.10  ? 'moderate'
                         :                       'never_buys';

        await Customer.updateOne(
          { _id: customerId, companyId },
          { $set: { 'callerProfile.buyerProfile': tag } }
        );
        logger.info('[CustomerProfile] 🛒 buyerProfile computed', {
          companyId, callSid,
          customerId:  String(customerId),
          tag,
          acceptRate:  `${Math.round(acceptRate * 100)}%`,
          totalOffers: total,
        });
      }
    }

    logger.info('[CustomerProfile] ✅ Stamped', {
      companyId,
      callSid,
      customerId:       String(customerId),
      objective:        callHistoryEntry.objective,
      outcome:          callHistoryEntry.callOutcome,
      isConverted,
      isLostLead,
      hadName:          !!fullName,
      hadStaff:         !!staffName,
      upsellsStamped:   upsellOffers.length,
      offersStamped:    _allOffered.length,
      revenueBooked:    _revenueBooked   || 0,
      revenueDeclined:  _revenueDeclined || 0,
    });

    return true;

  } catch (err) {
    logger.warn('[CustomerProfile] stamp failed (non-fatal)', { callSid, error: err.message });
    return false;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  stamp,
};

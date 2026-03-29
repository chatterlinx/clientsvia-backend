'use strict';

/**
 * ============================================================================
 * LOST LEAD MODEL  (Build Step 10)
 * ============================================================================
 *
 * PURPOSE:
 *   Records every call where a caller showed booking intent (CommittedAct /
 *   booking engine entered) but left without confirming.
 *
 *   isLostLead = true when CallOutcomeClassifier returns outcome BOOKING_STARTED.
 *
 * DESIGN:
 *   - One document per lost lead instance (one per call).
 *   - Multiple lost leads per customer accumulate — all preserved.
 *   - Most recent is surfaced in CallerRecognition (Step 11).
 *   - All are preserved for analytics (G11: surface most recent, preserve all).
 *
 * SOURCE:
 *   Written by CallOutcomeClassifier.persistLostLead() at call end.
 *   Status updated by owner via LostLeads UI (call console panel).
 *
 * STATUS LIFECYCLE:
 *   NEW → owner sees it → CONTACTED → follow-up outcome set:
 *     CONVERTED | NOT_INTERESTED | UNREACHABLE | INVALID
 *
 * INDEXES:
 *   companyId + status + callEndedAt — for dashboard query (open leads by age)
 *   companyId + customerId           — for CallerRecognition lookup
 *   companyId + callSid (unique)     — prevent duplicate writes
 *
 * USAGE:
 *   const LostLead = require('./LostLead');
 *   await LostLead.create({ companyId, callSid, customerId, ... });
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── Status values ─────────────────────────────────────────────────────────────

const STATUSES = {
  NEW:            'NEW',           // just written — owner hasn't seen it
  CONTACTED:      'CONTACTED',     // owner reached out / follow-up started
  CONVERTED:      'CONVERTED',     // booking later confirmed (outcome resolved)
  NOT_INTERESTED: 'NOT_INTERESTED',// caller explicitly declined follow-up
  UNREACHABLE:    'UNREACHABLE',   // could not reach caller
  INVALID:        'INVALID',       // not a real lead (test call, wrong number, etc.)
};

// ── Schema ────────────────────────────────────────────────────────────────────

const LostLeadSchema = new Schema({

  // ── Multi-tenant isolation ─────────────────────────────────────────────────
  companyId:  { type: Schema.Types.ObjectId, ref: 'v2Company', required: true, index: true },

  // ── Call identifiers ───────────────────────────────────────────────────────
  callSid:    { type: String, required: true, trim: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },

  // ── Caller information (denormalized — caller may not have a Customer record) ─
  callerPhone:  { type: String, default: null, trim: true },
  callerName:   { type: String, default: null, trim: true },  // from temp.firstName+lastName

  // ── Discovery data at the point they left ──────────────────────────────────
  // Snapshot from discoveryNotes.temp{} — what the caller told us before leaving
  discoverySnapshot: {
    callReason:   { type: String, default: null },
    serviceType:  { type: String, default: null },
    urgency:      { type: String, default: null },
    issue:        { type: String, default: null },
    preferredDate:{ type: String, default: null },
    preferredTime:{ type: String, default: null },
    objective:    { type: String, default: null },
    turnCount:    { type: Number, default: 0 },
  },

  // ── Call timing ────────────────────────────────────────────────────────────
  callStartedAt:  { type: Date, default: null },
  callEndedAt:    { type: Date, required: true, default: Date.now, index: true },
  callDurationSeconds: { type: Number, default: 0 },

  // ── Status lifecycle ───────────────────────────────────────────────────────
  status: {
    type:    String,
    enum:    Object.values(STATUSES),
    default: STATUSES.NEW,
    index:   true,
  },

  // ── Follow-up notes (set by owner when marking as CONTACTED etc.) ──────────
  followUpNotes:  { type: String, default: null, maxlength: 1000 },
  contactedAt:    { type: Date, default: null },
  resolvedAt:     { type: Date, default: null },

}, {
  timestamps: true,   // createdAt, updatedAt
  collection: 'lostleads',
});

// ── Indexes ───────────────────────────────────────────────────────────────────

// Unique write guard — one LostLead per callSid
LostLeadSchema.index({ companyId: 1, callSid: 1 }, { unique: true });

// CallerRecognition lookup: most recent by customerId
LostLeadSchema.index({ companyId: 1, customerId: 1, callEndedAt: -1 });

// Dashboard query: open leads by age
LostLeadSchema.index({ companyId: 1, status: 1, callEndedAt: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

const LostLead = mongoose.model('LostLead', LostLeadSchema);

module.exports = LostLead;
module.exports.STATUSES = STATUSES;

'use strict';

/**
 * ============================================================================
 * CALL TURN TRACE MODEL
 * ============================================================================
 *
 * Append-only turn-by-turn audit log for every call processed through the
 * ConversationEngine. One document per turn per call. Never updated after
 * write — treated as an immutable event record.
 *
 * PURPOSE:
 *   CallTurnTrace is the forensic black box for the arbitration and routing
 *   pipeline. It answers the question: "On turn N of call X, what did the
 *   caller say, what signals fired, how did arbitration score them, and what
 *   did the engine decide — and why?"
 *
 *   It is NOT a real-time state store (that's Redis discoveryNotes). It is
 *   NOT a call summary (that's CallSummary/CallTrace). It is a per-turn
 *   decision audit trail written once, read during post-call review.
 *
 * ARCHITECTURE — WRITE PATH:
 *   ConversationEngine.processTurn() writes one CallTurnTrace document after
 *   every turn completes. The write is fire-and-forget — a trace write failure
 *   MUST NOT throw or block the response path. Wrap in try/catch and swallow.
 *
 *   Suggested write location in ConversationEngine:
 *     After CHECKPOINT 5b (discoveryNotes update), before response delivery.
 *     This ensures the trace captures the final decision, not a draft.
 *
 * ARCHITECTURE — READ PATH:
 *   - Call Review Console: getForCall(callSid) → full ordered turn list
 *   - Admin analytics: getRecentForCompany(companyId) → recent decision log
 *   - Never read at call time — zero latency impact on active calls
 *
 * TURN COUNTER:
 *   `turn` is a monotonic integer starting at 1 within a call. It is set by
 *   the caller (ConversationEngine), not auto-generated. The unique compound
 *   index on { callId, turn } prevents accidental double-writes.
 *
 * LANE FIELDS:
 *   lane.before / lane.after capture the lane state transitions per turn.
 *   Valid lane values: null | 'BOOKING' | 'DISCOVERY' | 'PRICING' |
 *                      'TRANSFER' | 'INTAKE' | 'CLOSING'
 *   These mirror the objective field in discoveryNotes (same vocabulary).
 *
 * CANDIDATES ARRAY:
 *   Each element represents one signal that was scored during arbitration:
 *     type        — signal category (BOOKING, TRANSFER, PRICING, KC, etc.)
 *     score       — final weighted score (0.0–1.0)
 *     signal      — raw detector output label or matched keyword
 *     detector    — which detector/interceptor produced this candidate
 *     suppressed  — true if this candidate was beaten or disqualified
 *     suppressReason — why it was suppressed (e.g. "LANE_LOCKED", "SCORE_GAP")
 *   Array is ordered: index 0 = highest-scoring candidate (the winner).
 *
 * DECISION FIELDS:
 *   decision.winner       — the candidate type that won arbitration
 *   decision.action       — the action actually executed (RESPOND, ROUTE_KC, etc.)
 *   decision.reason       — human-readable explanation for the routing decision
 *   decision.policyApplied — name of the ArbitrationPolicy rule that governed
 *                            (e.g. "bookingBeatsAll", "laneLocked", "autoRoute")
 *   decision.scoreGap     — gap between top two candidate scores (for debugging
 *                            close calls and tuning minScoreGap thresholds)
 *   decision.arbitrationMs — wall-clock time to run the full arbitration pass
 *
 * EXECUTION FIELDS:
 *   execution.responsePreview   — first 200 chars of what was spoken to the caller
 *   execution.laneRedirect      — populated when execution triggered a lane change
 *                                 beyond what arbitration decided (e.g. BookingLogicEngine
 *                                 re-routing mid-booking)
 *   execution.executionMs       — total wall-clock time from utterance receipt to
 *                                 response delivery (includes arbitration + action)
 *
 * MULTI-TENANT RULES:
 *   - Every document carries companyId for tenant isolation.
 *   - getForCall() returns only turns for the requested callId.
 *   - getRecentForCompany() is scoped to companyId — no cross-tenant queries.
 *   - No document is ever written without both callId and companyId present.
 *
 * TTL — AUTOMATIC PURGE:
 *   The TTL index on createdAt expires documents after 30 days (2,592,000 s).
 *   This is not a soft delete — MongoDB removes expired documents from disk.
 *   Long-term analytics should aggregate to CallDailyStats before TTL fires.
 *   DO NOT rely on this collection for data older than 30 days.
 *
 * REDIS:
 *   No Redis cache for this model — documents are written once, read infrequently
 *   (post-call review), and individually small. Direct MongoDB reads are fast
 *   enough given the compound indexes.
 *
 * FUTURE NOTES:
 *   - A `flags` [String] field for tagging notable turns (e.g. "DISAMBIGUATION",
 *     "ESCAPE_HATCH_FIRED", "LLM_FALLBACK") would simplify analytics queries.
 *   - Turn-level audio timestamps could be added to correlate with recordings.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Candidate sub-schema ──────────────────────────────────────────────────────
// One entry per signal that was evaluated during arbitration this turn.

const candidateSchema = new mongoose.Schema(
  {
    type: {
      type:    String,
      comment: 'Signal category — matches lane/action vocabulary (BOOKING, TRANSFER, KC, PRICING, PROMO, CUSTOM)'
    },
    score: {
      type:    Number,
      min:     0,
      max:     1,
      comment: 'Final weighted score after ArbitrationPolicy weight is applied'
    },
    signal: {
      type:    String,
      comment: 'Raw label from the detector — matched keyword, container name, or intent classifier output'
    },
    detector: {
      type:    String,
      comment: 'Which detector/interceptor produced this candidate (e.g. "BookingDetector", "CompanyInterceptor:42")'
    },
    suppressed: {
      type:    Boolean,
      default: false,
      comment: 'True if this candidate was beaten by the winner or disqualified during arbitration'
    },
    suppressReason: {
      type:    String,
      default: '',
      comment: 'Why this candidate was suppressed — e.g. "SCORE_GAP", "LANE_LOCKED", "BOOKING_BEATS_ALL"'
    }
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────────

const callTurnTraceSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // CALL IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    callId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
      comment:  'Twilio CallSid — primary grouping key for all turns within a call'
    },

    companyId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
      comment:  'Tenant isolator — required on every document. Scopes all admin queries.'
    },

    turn: {
      type:     Number,
      required: true,
      min:      1,
      comment:  'Monotonic turn counter within the call, starting at 1. Set by ConversationEngine.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // INPUT — caller utterance, raw and normalised
    // ─────────────────────────────────────────────────────────────────────────
    input: {
      raw: {
        type:    String,
        default: '',
        comment: 'Original STT output before any normalisation'
      },
      normalized: {
        type:    String,
        default: '',
        comment: 'Utterance after the input normaliser runs (lowercased, filler words removed, etc.)'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LANE — conversation lane state transitions this turn
    // Valid values: null | 'BOOKING' | 'DISCOVERY' | 'PRICING' | 'TRANSFER' | 'INTAKE' | 'CLOSING'
    // ─────────────────────────────────────────────────────────────────────────
    lane: {
      before: {
        type:    String,
        default: null,
        comment: 'Lane value at the START of this turn (before arbitration ran)'
      },
      after: {
        type:    String,
        default: null,
        comment: 'Lane value at the END of this turn (after action executed)'
      },
      locked: {
        type:    Boolean,
        default: false,
        comment: 'True if the lane was locked (via laneStickyEnabled) at decision time'
      },
      escapeTriggered: {
        type:    Boolean,
        default: false,
        comment: 'True if an escape keyword was detected, forcing a lane unlock and full re-arbitration'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CANDIDATES — all signals scored by ArbitrationEngine this turn
    // Ordered by score DESC (index 0 = winner). See sub-schema above.
    // ─────────────────────────────────────────────────────────────────────────
    candidates: {
      type:    [candidateSchema],
      default: [],
      comment: 'All arbitration candidates this turn, ordered highest score first. Index 0 is the winner.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // DECISION — what the ArbitrationEngine chose and why
    // ─────────────────────────────────────────────────────────────────────────
    decision: {
      winner: {
        type:    String,
        default: null,
        comment: 'Candidate type that won arbitration (e.g. "BOOKING", "KC", "TRANSFER")'
      },
      action: {
        type:    String,
        default: null,
        comment: 'Action type actually executed (RESPOND, ROUTE_KC, BOOK, TRANSFER, LLM_FALLBACK, etc.)'
      },
      reason: {
        type:    String,
        default: '',
        comment: 'Human-readable explanation of why this winner was chosen'
      },
      policyApplied: {
        type:    String,
        default: '',
        comment: 'ArbitrationPolicy rule name that governed the decision (e.g. "bookingBeatsAll", "autoRoute")'
      },
      scoreGap: {
        type:    Number,
        default: null,
        comment: 'Weighted score difference between the top two candidates. Null if fewer than two candidates scored.'
      },
      arbitrationMs: {
        type:    Number,
        default: null,
        comment: 'Wall-clock milliseconds to run the full arbitration pass for this turn'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTION — what actually happened after the decision was made
    // ─────────────────────────────────────────────────────────────────────────
    execution: {
      responsePreview: {
        type:      String,
        trim:      true,
        maxlength: 200,
        default:   '',
        comment:   'First 200 characters of the response delivered to the caller. Truncated for storage efficiency.'
      },
      laneRedirect: {
        type:    String,
        default: null,
        comment: 'If execution caused a mid-action lane redirect (e.g. BookingLogicEngine routing to TRANSFER), recorded here'
      },
      executionMs: {
        type:    Number,
        default: null,
        comment: 'Total wall-clock milliseconds from utterance receipt to response delivery (arbitration + action + TTS overhead)'
      }
    }
  },
  {
    timestamps:  true,
    collection:  'callTurnTraces',   // explicit — never rely on mongoose plural inference
    versionKey:  false
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary read path for Call Review Console: all turns for a call in order
callTurnTraceSchema.index({ callId: 1, turn: 1 }, { unique: true });

// Admin analytics: recent turns for a company, newest first
callTurnTraceSchema.index({ companyId: 1, createdAt: -1 });

// TTL — auto-purge documents after 30 days (2,592,000 seconds)
// Long-term analytics must be aggregated to CallDailyStats before this fires.
callTurnTraceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * getForCall — Retrieve all recorded turns for a call, sorted by turn ASC.
 * Used by the Call Review Console to render the full turn-by-turn decision log.
 *
 * Returns lean objects — never pass mongoose documents into the admin API layer.
 *
 * @param {string} callId   Twilio CallSid
 * @returns {Promise<Array>}
 */
callTurnTraceSchema.statics.getForCall = function (callId) {
  return this.find({ callId })
    .sort({ turn: 1 })
    .lean();
};

/**
 * getRecentForCompany — Retrieve the most recent N turns across all calls for
 * a company, sorted by createdAt DESC. Used for admin analytics dashboards and
 * live monitoring panels.
 *
 * Note: this returns individual turns, NOT grouped by call. Use getForCall()
 * when you need all turns for a single call in order.
 *
 * @param {string} companyId
 * @param {number} [limit=50]  Maximum number of turn documents to return
 * @returns {Promise<Array>}
 */
callTurnTraceSchema.statics.getRecentForCompany = function (companyId, limit = 50) {
  return this.find({ companyId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

module.exports = mongoose.model('CallTurnTrace', callTurnTraceSchema, 'callTurnTraces');

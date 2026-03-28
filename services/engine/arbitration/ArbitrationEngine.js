'use strict';

/**
 * ============================================================================
 * ARBITRATION ENGINE
 * ============================================================================
 *
 * Pure synchronous arbitration decision function. Zero I/O, zero side effects.
 * Takes a CandidateSet + LaneState + Policy and returns an ArbitrationDecision.
 *
 * ARCHITECTURE ROLE:
 *   The ArbitrationEngine sits at the core of the Intent Arbitration layer.
 *   Each incoming caller turn flows through upstream detectors that produce
 *   a set of scored "candidates" (possible intent types). This engine decides
 *   which candidate wins and what action the ConversationEngine should take.
 *
 *                     ┌────────────────────────────────────┐
 *   Raw input ──▶ Detectors (BOOKING, PRICING, KC, etc.) ──▶ CandidateSet
 *                     └────────────────────────────────────┘
 *                                        │
 *                     ┌─────────────────▼─────────────────┐
 *                     │        ArbitrationEngine           │
 *                     │   decide(candidates, lane, policy) │
 *                     └─────────────────┬─────────────────┘
 *                                        │ ArbitrationDecision
 *                     ┌─────────────────▼─────────────────┐
 *                     │     ConversationEngine dispatch    │
 *                     └────────────────────────────────────┘
 *
 * DECISION PIPELINE (in strict priority order):
 *   1. Lane filter       — if lane locked, keep only lane-compatible candidates
 *   2. Weight multiply   — apply per-type weight multipliers from policy
 *   3. Sort descending   — highest weighted score first
 *   4. bookingBeatsAll   — if policy flag set + BOOKING present → BOOKING wins
 *   5. Transfer priority — TRANSFER wins if its weighted score > 0.5
 *   6. Score gap check   — auto-route if gap is wide enough and score is high
 *   7. Ambiguity check   — gap too narrow → CLARIFY
 *   8. Floor check       — all scores below floor → GRACEFUL_ACK
 *   9. Default           — highest scored candidate wins
 *
 * MIXED INTENT QUEUE:
 *   When bookingBeatsAll fires and a strong secondary candidate exists
 *   (score > 0.4), its type + signal are stored in decision.queued so the
 *   ConversationEngine can revisit it after booking confirmation.
 *
 * SYNCHRONOUS GUARANTEE:
 *   This module never imports async modules, never calls I/O, never modifies
 *   external state. Safe to call from any synchronous context.
 *   All async work (Redis, MongoDB, logging) is done by the CALLER before/after.
 *
 * INPUT TYPES:
 *   CandidateSet: {
 *     normalized: string,         // Pre-normalized caller input
 *     candidates: Array<{
 *       type:     string,         // BOOKING | TRANSFER | PRICING | PROMO | CUSTOM_RULE | KC_SEMANTIC
 *       score:    number,         // 0.0–1.0 raw score from detector
 *       signal:   string,         // Human-readable matched signal description
 *       detector: string          // Detector class/name that produced this candidate
 *     }>
 *   }
 *
 *   LaneState: {
 *     current:         string|null,  // Current lane (LANES value) or null
 *     locked:          boolean,      // Whether lane filtering should apply
 *     escapeTriggered: boolean        // Whether caller used an escape phrase
 *   }
 *
 *   Policy: CompanyArbitrationPolicy fields as a plain object (lean doc).
 *   Required policy fields consumed here:
 *     - weights:                { booking, transfer, pricing, promo, customRule, kcSemantic }
 *     - bookingBeatsAll:        boolean
 *     - queueSecondaryIntent:   boolean
 *     - autoRouteMinScore:      number  (default 0.8)
 *     - minScoreGap:            number  (default 0.2)
 *     - disambiguateFloor:      number  (default 0.3)
 *     - maxDisambiguateAttempts: number (default 2)
 *
 * OUTPUT TYPE (ArbitrationDecision):
 *   {
 *     winner:       { type, score, signal } | null,
 *     suppressed:   Array<{ type, score, signal, reason }>,
 *     action:       'RESPOND' | 'BOOK' | 'ROUTE_KC' | 'TRANSFER' | 'CLARIFY' | 'GRACEFUL_ACK',
 *     newLane:      string | null,
 *     reason:       string,          // Machine-readable decision reason
 *     policyApplied: string,         // Which policy rule drove the outcome
 *     scoreGap:     number,          // gap between top two weighted scores
 *     queued:       { type, signal } | null   // secondary intent for post-booking
 *   }
 *
 * PUBLIC API:
 *   decide(candidateSet, laneState, policy) → ArbitrationDecision
 *
 * EXPORTS:
 *   { decide, LANES, CANDIDATE_TYPES, ACTIONS }
 *
 * ============================================================================
 */

// ── Lane Enum (re-exported for convenience — matches LaneController.LANES) ───

/**
 * LANES — Lane identifier constants.
 * Kept in sync with LaneController.LANES. Duplicated here so this module
 * has zero dependencies (preserves pure/sync guarantee).
 */
const LANES = Object.freeze({
  INTAKE:    'INTAKE',
  BOOKING:   'BOOKING',
  DISCOVERY: 'DISCOVERY',
  PRICING:   'PRICING',
  TRANSFER:  'TRANSFER'
});

// ── Candidate Type Constants ──────────────────────────────────────────────────

/**
 * CANDIDATE_TYPES — All recognized intent candidate types.
 * Detectors MUST use exactly these strings as the `type` field.
 */
const CANDIDATE_TYPES = Object.freeze({
  BOOKING:     'BOOKING',
  TRANSFER:    'TRANSFER',
  PRICING:     'PRICING',
  PROMO:       'PROMO',
  CUSTOM_RULE: 'CUSTOM_RULE',
  KC_SEMANTIC: 'KC_SEMANTIC'
});

// ── Action Constants ──────────────────────────────────────────────────────────

/**
 * ACTIONS — Valid action values in ArbitrationDecision.action.
 * The ConversationEngine dispatch switch must handle all of these.
 */
const ACTIONS = Object.freeze({
  RESPOND:      'RESPOND',
  BOOK:         'BOOK',
  ROUTE_KC:     'ROUTE_KC',
  TRANSFER:     'TRANSFER',
  CLARIFY:      'CLARIFY',
  GRACEFUL_ACK: 'GRACEFUL_ACK'
});

// ── Lane Compatibility Map ────────────────────────────────────────────────────

/**
 * LANE_COMPATIBLE_TYPES — When a lane is locked, only these candidate types
 * are eligible to win. This prevents a mid-booking PRICING question from
 * breaking out of the booking flow.
 *
 * ESCAPE always happens BEFORE this filter (handled by LaneController.isEscapeKeyword).
 */
const LANE_COMPATIBLE_TYPES = Object.freeze({
  [LANES.INTAKE]:    [CANDIDATE_TYPES.BOOKING, CANDIDATE_TYPES.TRANSFER, CANDIDATE_TYPES.PRICING, CANDIDATE_TYPES.PROMO, CANDIDATE_TYPES.CUSTOM_RULE, CANDIDATE_TYPES.KC_SEMANTIC],
  [LANES.BOOKING]:   [CANDIDATE_TYPES.BOOKING, CANDIDATE_TYPES.TRANSFER],
  [LANES.DISCOVERY]: [CANDIDATE_TYPES.KC_SEMANTIC, CANDIDATE_TYPES.BOOKING, CANDIDATE_TYPES.TRANSFER, CANDIDATE_TYPES.PRICING, CANDIDATE_TYPES.PROMO],
  [LANES.PRICING]:   [CANDIDATE_TYPES.PRICING, CANDIDATE_TYPES.BOOKING, CANDIDATE_TYPES.TRANSFER],
  [LANES.TRANSFER]:  [CANDIDATE_TYPES.TRANSFER]
});

// ── Weight Key Map ────────────────────────────────────────────────────────────

/** Maps candidate type → policy.weights key */
const WEIGHT_KEY = {
  [CANDIDATE_TYPES.BOOKING]:     'booking',
  [CANDIDATE_TYPES.TRANSFER]:    'transfer',
  [CANDIDATE_TYPES.PRICING]:     'pricing',
  [CANDIDATE_TYPES.PROMO]:       'promo',
  [CANDIDATE_TYPES.CUSTOM_RULE]: 'customRule',
  [CANDIDATE_TYPES.KC_SEMANTIC]: 'kcSemantic'
};

// ── Policy Defaults ───────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  booking:    1.0,
  transfer:   1.0,
  pricing:    1.0,
  promo:      1.0,
  customRule: 1.0,
  kcSemantic: 1.0
};

const DEFAULT_POLICY = {
  weights:                DEFAULT_WEIGHTS,
  bookingBeatsAll:        false,
  queueSecondaryIntent:   true,
  autoRouteMinScore:      0.8,
  minScoreGap:            0.2,
  disambiguateFloor:      0.3,
  maxDisambiguateAttempts: 2
};

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * _resolvePolicy — Merge provided policy with defaults. Returns a complete
 * policy object safe to destructure without optional-chaining everywhere.
 * @param {Object} policy
 * @returns {Object}
 */
function _resolvePolicy(policy) {
  const base = Object.assign({}, DEFAULT_POLICY, policy || {});
  base.weights = Object.assign({}, DEFAULT_WEIGHTS, base.weights || {});
  return base;
}

/**
 * _applyWeight — Multiply raw score by the policy weight for this candidate type.
 * Clamps result to [0, 1].
 * @param {Object} candidate — { type, score, ... }
 * @param {Object} weights   — policy.weights
 * @returns {number} weighted score
 */
function _applyWeight(candidate, weights) {
  const w = weights[WEIGHT_KEY[candidate.type]] ?? 1.0;
  return Math.min(1.0, Math.max(0, candidate.score * w));
}

/**
 * _mapTypeToAction — Determine the ArbitrationDecision action and newLane
 * for a given winning candidate type.
 * @param {string} type     — CANDIDATE_TYPES value
 * @param {Object} candidate — Full candidate object (for CUSTOM_RULE action extraction)
 * @returns {{ action: string, newLane: string|null }}
 */
function _mapTypeToAction(type, candidate) {
  switch (type) {
    case CANDIDATE_TYPES.BOOKING:
      return { action: ACTIONS.BOOK,     newLane: LANES.BOOKING };
    case CANDIDATE_TYPES.TRANSFER:
      return { action: ACTIONS.TRANSFER, newLane: LANES.TRANSFER };
    case CANDIDATE_TYPES.PRICING:
      return { action: ACTIONS.RESPOND,  newLane: null };
    case CANDIDATE_TYPES.PROMO:
      return { action: ACTIONS.RESPOND,  newLane: null };
    case CANDIDATE_TYPES.KC_SEMANTIC:
      return { action: ACTIONS.ROUTE_KC, newLane: LANES.DISCOVERY };
    case CANDIDATE_TYPES.CUSTOM_RULE: {
      // Custom rules carry their own action hint in the signal/metadata
      // The candidate.meta.action field (if present) overrides default mapping
      const ruleAction = candidate?.meta?.actionType;
      if (ruleAction === 'BOOK')     return { action: ACTIONS.BOOK,     newLane: LANES.BOOKING };
      if (ruleAction === 'TRANSFER') return { action: ACTIONS.TRANSFER, newLane: LANES.TRANSFER };
      if (ruleAction === 'ROUTE_KC') return { action: ACTIONS.ROUTE_KC, newLane: LANES.DISCOVERY };
      return { action: ACTIONS.RESPOND, newLane: null };
    }
    default:
      return { action: ACTIONS.ROUTE_KC, newLane: LANES.DISCOVERY };
  }
}

/**
 * _buildSuppressedList — Build the suppressed array from all candidates except winner,
 * attaching the reason each was suppressed.
 * @param {Array}  candidates    — All scored candidates (already weighted)
 * @param {Object} winnerRaw     — The raw candidate object that won
 * @param {string} suppressReason — Reason string (e.g. 'booking_priority_policy')
 * @returns {Array<{ type, score, signal, reason }>}
 */
function _buildSuppressedList(candidates, winnerRaw, suppressReason) {
  return candidates
    .filter(c => c !== winnerRaw)
    .map(c => ({
      type:   c.type,
      score:  c._weightedScore,
      signal: c.signal,
      reason: suppressReason
    }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * decide — Core arbitration function.
 *
 * Completely synchronous. Takes all inputs as plain objects, returns a plain
 * ArbitrationDecision. Never throws — wraps execution in a try/catch and
 * returns a GRACEFUL_ACK decision on unexpected errors so the call never dies.
 *
 * @param {Object} candidateSet — { normalized: string, candidates: Array }
 * @param {Object} laneState    — { current: string|null, locked: boolean, escapeTriggered: boolean }
 * @param {Object} policy       — CompanyArbitrationPolicy fields (lean)
 * @returns {Object} ArbitrationDecision
 */
function decide(candidateSet, laneState, policy) {
  try {
    return _decide(candidateSet, laneState, policy);
  } catch (err) {
    // Defensive: never crash a live call due to arbitration logic errors
    return {
      winner:       null,
      suppressed:   [],
      action:       ACTIONS.GRACEFUL_ACK,
      newLane:      null,
      reason:       'arbitration_internal_error',
      policyApplied: 'error_fallback',
      scoreGap:     0,
      queued:       null,
      _error:       err.message
    };
  }
}

/**
 * _decide — Internal implementation (called by decide wrapper).
 * @private
 */
function _decide(candidateSet, laneState, policy) {
  const p          = _resolvePolicy(policy);
  const lane       = laneState || { current: null, locked: false, escapeTriggered: false };
  const rawCands   = Array.isArray(candidateSet?.candidates) ? candidateSet.candidates : [];

  // ── STEP 1: Lane filter ────────────────────────────────────────────────────
  // If the lane is locked and no escape was triggered, keep only lane-compatible
  // candidate types. escapeTriggered = true means the caller broke out of the
  // lane this turn — pass all candidates through so competition is open.
  let candidates = rawCands.slice();

  if (lane.locked && lane.current && !lane.escapeTriggered) {
    const compatibleTypes = LANE_COMPATIBLE_TYPES[lane.current] || [];
    const filtered        = candidates.filter(c => compatibleTypes.includes(c.type));

    // If filtering leaves nothing, preserve the original set as a safety valve
    // (better than a GRACEFUL_ACK in the middle of a booking flow)
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  // ── STEP 2: Apply weight multipliers ──────────────────────────────────────
  candidates = candidates.map(c => ({
    ...c,
    _weightedScore: _applyWeight(c, p.weights)
  }));

  // ── STEP 3: Sort by weighted score descending ──────────────────────────────
  candidates.sort((a, b) => b._weightedScore - a._weightedScore);

  const [top, second] = candidates;

  // Empty candidate set → GRACEFUL_ACK
  if (!top) {
    return {
      winner:        null,
      suppressed:    [],
      action:        ACTIONS.GRACEFUL_ACK,
      newLane:       null,
      reason:        'no_candidates',
      policyApplied: 'empty_candidate_set',
      scoreGap:      0,
      queued:        null
    };
  }

  const topScore    = top._weightedScore;
  const secondScore = second ? second._weightedScore : 0;
  const scoreGap    = topScore - secondScore;

  // ── STEP 4: bookingBeatsAll ────────────────────────────────────────────────
  // If enabled and a BOOKING candidate is present (any score), BOOKING wins
  // immediately regardless of weighted score. All other candidates are suppressed
  // with reason 'booking_priority_policy'.
  if (p.bookingBeatsAll) {
    const bookingCand = candidates.find(c => c.type === CANDIDATE_TYPES.BOOKING);
    if (bookingCand) {
      // Mixed intent queue: if secondary candidate is strong, save it for later
      let queued = null;
      if (p.queueSecondaryIntent) {
        const secondary = candidates.find(c => c !== bookingCand && c._weightedScore > 0.4);
        if (secondary) {
          queued = { type: secondary.type, signal: secondary.signal };
        }
      }

      return {
        winner:        { type: bookingCand.type, score: bookingCand._weightedScore, signal: bookingCand.signal },
        suppressed:    _buildSuppressedList(candidates, bookingCand, 'booking_priority_policy'),
        action:        ACTIONS.BOOK,
        newLane:       LANES.BOOKING,
        reason:        'booking_beats_all_policy_fired',
        policyApplied: 'bookingBeatsAll',
        scoreGap,
        queued
      };
    }
  }

  // ── STEP 5: Transfer priority ──────────────────────────────────────────────
  // TRANSFER always wins if its weighted score exceeds the threshold (0.5).
  // This is a safety gate — a caller saying "transfer me" or "speak to someone"
  // should never be overridden by a lower-confidence KC match.
  const transferCand = candidates.find(c => c.type === CANDIDATE_TYPES.TRANSFER);
  if (transferCand && transferCand._weightedScore > 0.5) {
    return {
      winner:        { type: transferCand.type, score: transferCand._weightedScore, signal: transferCand.signal },
      suppressed:    _buildSuppressedList(candidates, transferCand, 'transfer_priority_policy'),
      action:        ACTIONS.TRANSFER,
      newLane:       LANES.TRANSFER,
      reason:        'transfer_priority_threshold_met',
      policyApplied: 'transferPriority',
      scoreGap,
      queued:        null
    };
  }

  // ── STEP 6: Score gap check — auto-route ──────────────────────────────────
  // Winner is decisive if: top score >= autoRouteMinScore AND gap to #2 >= minScoreGap
  if (topScore >= p.autoRouteMinScore && scoreGap >= p.minScoreGap) {
    const { action, newLane } = _mapTypeToAction(top.type, top);
    return {
      winner:        { type: top.type, score: topScore, signal: top.signal },
      suppressed:    _buildSuppressedList(candidates, top, 'outscored'),
      action,
      newLane,
      reason:        'auto_route_decisive_score',
      policyApplied: 'autoRouteMinScore+minScoreGap',
      scoreGap,
      queued:        null
    };
  }

  // ── STEP 7: Ambiguity — gap too narrow ────────────────────────────────────
  // Two or more candidates with closely matched scores indicate ambiguous intent.
  // Return CLARIFY so the ConversationEngine can ask the caller to disambiguate.
  if (second && scoreGap < p.minScoreGap && topScore >= p.disambiguateFloor) {
    return {
      winner:        null,
      suppressed:    candidates.map(c => ({
        type:   c.type,
        score:  c._weightedScore,
        signal: c.signal,
        reason: 'ambiguous_candidates'
      })),
      action:        ACTIONS.CLARIFY,
      newLane:       null,
      reason:        'ambiguous_candidates',
      policyApplied: 'minScoreGap',
      scoreGap,
      queued:        null
    };
  }

  // ── STEP 8: Floor check — all scores too low ──────────────────────────────
  // If even the top candidate is below the disambiguation floor, the engine
  // cannot make a confident decision. Return GRACEFUL_ACK (canned fallback).
  if (topScore < p.disambiguateFloor) {
    return {
      winner:        null,
      suppressed:    candidates.map(c => ({
        type:   c.type,
        score:  c._weightedScore,
        signal: c.signal,
        reason: 'below_floor'
      })),
      action:        ACTIONS.GRACEFUL_ACK,
      newLane:       null,
      reason:        'all_scores_below_floor',
      policyApplied: 'disambiguateFloor',
      scoreGap,
      queued:        null
    };
  }

  // ── STEP 9: Default — route to highest scored candidate ───────────────────
  const { action, newLane } = _mapTypeToAction(top.type, top);
  return {
    winner:        { type: top.type, score: topScore, signal: top.signal },
    suppressed:    _buildSuppressedList(candidates, top, 'outscored'),
    action,
    newLane,
    reason:        'highest_score_default',
    policyApplied: 'default',
    scoreGap,
    queued:        null
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  decide,
  LANES,
  CANDIDATE_TYPES,
  ACTIONS
};

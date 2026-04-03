'use strict';

/**
 * ============================================================================
 * ENGINE HUB RUNTIME
 * ============================================================================
 *
 * Runtime bridge between the Engine Hub admin settings (MongoDB/engineHub
 * sub-document) and the live call pipeline (KCDiscoveryRunner, etc.).
 *
 * This service is the ONLY place the pipeline reads Engine Hub config.
 * All pipeline components (KCDiscoveryRunner, Agent2DiscoveryRunner) import
 * this module instead of reading company.engineHub directly — clean separation.
 *
 * MODES:
 *   passive   → config loaded, NO routing changes, trace-only logging
 *   learning  → config applied to all decisions, full trace, safe for live calls
 *   active    → fully live, Engine Hub governs all routing decisions
 *
 * GRACEFUL DEGRADE:
 *   engineHub disabled or not configured → returns null → callers use hardcoded defaults
 *   Any method receiving null config → returns safe default → call continues unchanged
 *   Async methods (getStandaloneBC) → catch all errors → return null → LLM runs without BC
 *
 * REPLACES:
 *   The hardcoded 1.5x topic-hop multiplier in KCDiscoveryRunner GATE 3b.
 *   The single-anchor model is augmented by Engine Hub Agenda State tracking.
 *
 * WIRED INTO:
 *   services/engine/kc/KCDiscoveryRunner.js   (GATE 2, GATE 3b, GATE 6)
 *
 * FUTURE WIRING:
 *   services/engine/agent2/Agent2DiscoveryRunner.js  (Turn 1 standalone BC injection)
 *   services/discoveryNotes/DiscoveryNotesService.js (agenda state persistence)
 *
 * ============================================================================
 */

const BehaviorCardService = require('../behaviorCards/BehaviorCardService');
const logger              = require('../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// Used when Engine Hub is passive, not configured, or a specific key is absent.
// These mirror the optimum values seeded by seed-enginehub-defaults.js.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  intentDetection: {
    multiIntentEnabled:  true,
    confidenceThreshold: 0.72,
    maxIntentsPerTurn:   2,
  },
  policyRouter: {
    enabledPolicies: [
      'answer_then_book',   // Answer KC question, then pivot to booking
      'book_then_defer',    // Lock in booking commitment, then answer
      'clarify_first',      // Ask one clarifying question when intent is ambiguous
      'pause_resume',       // Pause active flow, answer interrupt, resume
      'de_escalate',        // Cool the caller before routing
      'offer_alternatives', // When primary path fails, offer next best option
    ],
  },
  midFlowInterrupt: {
    bookingSlotSelection:  'pause_resume',
    bookingAddressCapture: 'pause_resume',
    bookingConfirmation:   'book_then_defer',
    afterHoursIntake:      'answer_then_book',
    transferInProgress:    'block_injection',
  },
  agendaState: {
    maxDeferredIntents:   3,
    autoSurfaceDeferred:  true,
    deferredTimeoutTurns: 5,
  },
  knowledgeEngine: {
    strictGroundedMode: true,
    onNoKcMatch:        'llm_fallback',
    logKcMisses:        true,
  },
  trace: {
    enabled:                true,
    showInCallIntelligence: true,
    alertOnFallbackCount:   2,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and validate Engine Hub config from company document.
 *
 * Returns null when:
 *   - engineHub not configured (isConfigured !== true)
 *   - engineHub.enabled === false
 *   - any unexpected error
 *
 * Returns config object when:
 *   - engineHub is configured and enabled (passive, learning, or active)
 *   - Caller must check isPassive before applying routing changes
 *
 * @param  {Object} company  — Full company document from MongoDB
 * @returns {Object|null}    — Merged runtime config, or null if inactive
 */
function load(company) {
  try {
    const eh = company?.engineHub;

    if (!eh?.isConfigured) return null;   // UI has never saved settings
    if (!eh.enabled)        return null;  // Master switch off

    const mode = eh.mode || 'passive';

    return {
      // Mode flags — callers check these before applying routing changes
      isPassive:  mode === 'passive',
      isLearning: mode === 'learning',
      isActive:   mode === 'active',
      mode,

      // Merged settings — unknown keys fall back to DEFAULTS
      intentDetection: {
        ...DEFAULTS.intentDetection,
        ...(eh.intentDetection || {}),
      },
      policyRouter: {
        ...DEFAULTS.policyRouter,
        ...(eh.policyRouter || {}),
        escalationConfig: { ...(eh.policyRouter?.escalationConfig || {}) },
      },
      midFlowInterrupt: {
        ...DEFAULTS.midFlowInterrupt,
        ...(eh.midFlowInterrupt || {}),
      },
      agendaState: {
        ...DEFAULTS.agendaState,
        ...(eh.agendaState || {}),
      },
      knowledgeEngine: {
        ...DEFAULTS.knowledgeEngine,
        ...(eh.knowledgeEngine || {}),
      },
      trace: {
        ...DEFAULTS.trace,
        ...(eh.trace || {}),
      },
    };
  } catch (err) {
    logger.warn('[EngineHubRuntime] load() error — degrading gracefully', { err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE THRESHOLD + HOP FACTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confidence threshold for acting on a detected intent (0–1).
 * Lower = more permissive (more topic hops, easier matches).
 * Higher = stricter (stays in topic longer).
 *
 * @param  {Object|null} config — from load()
 * @returns {number}   0.50–0.95 (default 0.72)
 */
function getConfidenceThreshold(config) {
  return config?.intentDetection?.confidenceThreshold
    ?? DEFAULTS.intentDetection.confidenceThreshold;
}

/**
 * Topic-hop multiplier for KCDiscoveryRunner GATE 3b.
 * Replaces the hardcoded 1.5× factor with an Engine Hub-driven value.
 *
 * Formula: hopFactor = 1 / confidenceThreshold
 *
 *   threshold=0.50 → hopFactor=2.00 (very strict — new topic must score 2× anchor)
 *   threshold=0.72 → hopFactor=1.39 (balanced — replaces old 1.5×)
 *   threshold=0.90 → hopFactor=1.11 (permissive — easy topic hops)
 *
 * Minimum enforced at 1.0 so the anchor always wins on a tie.
 *
 * @param  {Object|null} config — from load()
 * @returns {number}   hop multiplier (1.0–2.5)
 */
function getHopFactor(config) {
  const threshold = getConfidenceThreshold(config);
  return Math.max(1 / Math.max(threshold, 0.01), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY ROUTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a routing scenario to the correct Engine Hub policy.
 * Falls back to 'answer_then_book' if Engine Hub is passive or policy not found.
 *
 * Scenario → policy mapping:
 *   'has_unanswered_question'  → answer_then_book
 *   'booking_mid_flow'         → book_then_defer
 *   'ambiguous_intent'         → clarify_first
 *   'flow_interrupted'         → pause_resume
 *   'caller_distressed'        → de_escalate
 *   'primary_path_failed'      → offer_alternatives
 *
 * @param  {string}      scenario — routing context identifier
 * @param  {Object|null} config   — from load()
 * @returns {string}     policy name
 */
function selectPolicy(scenario, config) {
  if (!config || config.isPassive) return 'answer_then_book';

  const enabled = config.policyRouter?.enabledPolicies
    || DEFAULTS.policyRouter.enabledPolicies;

  const SCENARIO_MAP = {
    'has_unanswered_question': 'answer_then_book',
    'booking_mid_flow':        'book_then_defer',
    'ambiguous_intent':        'clarify_first',
    'flow_interrupted':        'pause_resume',
    'caller_distressed':       'de_escalate',
    'primary_path_failed':     'offer_alternatives',
  };

  const candidate = SCENARIO_MAP[scenario] || 'answer_then_book';

  // Only return policy if it's in the enabled list, else first enabled or default
  return enabled.includes(candidate)
    ? candidate
    : (enabled[0] || 'answer_then_book');
}

// ─────────────────────────────────────────────────────────────────────────────
// MID-FLOW INTERRUPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the interrupt handling strategy for a specific booking flow step.
 *
 * @param  {string}      flowStep — 'bookingSlotSelection' | 'bookingAddressCapture'
 *                                  | 'bookingConfirmation' | 'afterHoursIntake'
 *                                  | 'transferInProgress'
 * @param  {Object|null} config
 * @returns {string}     policy ('pause_resume' | 'book_then_defer' | 'answer_then_book'
 *                               | 'block_injection')
 */
function getMidFlowBehavior(flowStep, config) {
  const source = config?.midFlowInterrupt || DEFAULTS.midFlowInterrupt;
  return source[flowStep] ?? 'pause_resume';
}

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE BEHAVIOR CARDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load a Standalone Behavior Card for a call flow scenario.
 *
 * Used when there is NO KC card active — the agent is in greeting, discovery,
 * escalation, after-hours, or mid-flow interrupt mode.
 *
 * Standalone BC types:
 *   'inbound_greeting'    — Turn 1 response shape
 *   'discovery_flow'      — Discovery / intake mode (capturing name, address, issue)
 *   'escalation_ladder'   — Caller distress / manager request handling
 *   'after_hours_intake'  — Outside business hours message capture
 *   'mid_flow_interrupt'  — Off-topic question injected into active booking flow
 *   'payment_routing'     — Payment-related interaction
 *   'manager_request'     — Explicit manager escalation
 *
 * @param  {string} standaloneType
 * @param  {string} companyId
 * @returns {Promise<Object|null>}  BC document, or null on miss/error
 */
async function getStandaloneBC(standaloneType, companyId) {
  try {
    return await BehaviorCardService.forStandalone(companyId, standaloneType);
  } catch (err) {
    logger.warn('[EngineHubRuntime] getStandaloneBC() error — degrading gracefully', {
      standaloneType, companyId, err: err.message,
    });
    return null;
  }
}

/**
 * Format a Standalone BC as a text block for injection into a Groq/Claude system prompt.
 * Returns empty string when bc is null — graceful degrade, LLM runs without BC.
 *
 * Injected between discoveryNotes block and CRITICAL RULES section.
 *
 * @param  {Object|null} bc     — Behavior Card document from getStandaloneBC()
 * @param  {string}      [label] — Section header (default: 'CALL BEHAVIOR RULES')
 * @returns {string}
 */
function formatStandaloneBCForPrompt(bc, label = 'CALL BEHAVIOR RULES') {
  if (!bc) return '';

  const lines = [
    `\n── ${label} (${bc.name}) ─────────────────────────────────────────────`,
  ];

  if (bc.tone) {
    lines.push(`TONE: ${bc.tone}`);
  }

  if (bc.rules?.do?.length) {
    lines.push('MUST DO:');
    bc.rules.do.forEach(r => lines.push(`  • ${r}`));
  }

  if (bc.rules?.doNot?.length) {
    lines.push('MUST NOT:');
    bc.rules.doNot.forEach(r => lines.push(`  • ${r}`));
  }

  if (bc.rules?.exampleResponses?.length) {
    lines.push('EXAMPLE RESPONSES (match this register and length):');
    bc.rules.exampleResponses.forEach(r => lines.push(`  "${r}"`));
  }

  lines.push('───────────────────────────────────────────────────────────────\n');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// KC MISS HANDLING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Should the engine fall back to LLM when KC misses?
 *
 * knowledgeEngine.onNoKcMatch:
 *   'llm_fallback' → call LLM (Claude, COMPLEX bucket) — default
 *   'graceful_ack' → return canned ACK only, no LLM call (stricter grounding)
 *
 * @param  {Object|null} config
 * @returns {boolean}  true = use LLM (default), false = canned ACK only
 */
function shouldFallbackToLLM(config) {
  const setting = config?.knowledgeEngine?.onNoKcMatch
    ?? DEFAULTS.knowledgeEngine.onNoKcMatch;
  return setting !== 'graceful_ack';
}

// ─────────────────────────────────────────────────────────────────────────────
// TRACE LOGGING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log an Engine Hub trace event.
 * Fire-and-forget — NEVER blocks the call pipeline.
 *
 * When mode=passive: logs but doesn't affect routing.
 * When mode=learning: logs every routing decision with 'would have' phrasing.
 * When mode=active:   logs actual routing decisions made.
 *
 * @param {string}      companyId
 * @param {string}      callSid
 * @param {string}      event   — e.g. 'KC_HOP_BLOCKED', 'POLICY_SELECTED', 'BC_INJECTED'
 * @param {Object}      data    — event-specific payload
 * @param {Object|null} config  — from load()
 */
function logTrace(companyId, callSid, event, data, config) {
  if (!config?.trace?.enabled) return;

  // Fire-and-forget — non-blocking
  setImmediate(() => {
    try {
      logger.info(`[EngineHub:TRACE:${config.mode?.toUpperCase()}] ${event}`, {
        companyId,
        callSid,
        event,
        mode: config.mode,
        ...data,
      });
      // Future: persist to callTraceLog for Call Intelligence surfacing
      // when config.trace.showInCallIntelligence === true
    } catch (_) {
      // Trace errors must NEVER affect the call pipeline
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  load,
  getConfidenceThreshold,
  getHopFactor,
  selectPolicy,
  getMidFlowBehavior,
  getStandaloneBC,
  formatStandaloneBCForPrompt,
  logTrace,
  shouldFallbackToLLM,
  DEFAULTS,
};

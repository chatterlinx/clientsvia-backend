'use strict';

/**
 * ============================================================================
 * KC DISCOVERY RUNNER  (v1.0)
 * ============================================================================
 *
 * PURPOSE:
 *   Enterprise-grade Knowledge Container-first discovery engine. Replaces the
 *   ScrabEngine → Triggers → LLM cascade with a cleaner, more conversational
 *   KC → SPFUQ → Groq → LLM pipeline.
 *
 *   Activated by:  company.aiAgentSettings.agent2.discovery.engine = 'kc'
 *   Toggled from:  agent2.html > "🧠 Discovery Engine" card
 *   Switch point:  Agent2DiscoveryRunner.js (before ScrabEngine)
 *
 * PIPELINE (in order):
 *   1. Booking intent check   (KCBookingIntentDetector — synchronous, ~0ms)
 *   2. SPFUQ anchor load      (SPFUQService / Redis — ~1ms)
 *   3. KC container match     (KnowledgeContainerService.findContainer — ~2ms)
 *   4. Groq answer            (KnowledgeContainerService.answer — ~500ms)
 *   5. LLM fallback           (callLLMAgentForFollowUp — ~800ms, only if no KC)
 *   6. Graceful ACK           (canned response, only if LLM also unavailable)
 *
 * PATH CONSTANTS (visible in Call Review Console trace):
 *   KC_DIRECT_ANSWER    — KC matched, Groq answered, conversation continues
 *   KC_BOOKING_INTENT   — Booking signal detected → PFUQ/booking on next turn
 *   KC_SPFUQ_CONTINUE   — Active anchor, same topic, Groq re-answers with context
 *   KC_TOPIC_HOP        — Active anchor, new topic matched → clear + re-anchor
 *   KC_LLM_FALLBACK     — No KC match → callLLMAgentForFollowUp (Claude, COMPLEX)
 *   KC_GRACEFUL_ACK     — No KC + LLM unavailable → canned acknowledgment
 *
 * MULTI-TENANT SAFETY:
 *   All Redis keys and MongoDB queries are scoped by companyId.
 *   No cross-tenant leakage possible.
 *
 * GRACEFUL DEGRADE CHAIN:
 *   KC match fails → LLM fallback
 *   LLM unavailable → Graceful ACK
 *   Redis down → no SPFUQ (call continues, no anchor, works fine)
 *   Groq down → NO_DATA / ERROR intent → LLM fallback
 *
 * WIRING:
 *   Called from Agent2DiscoveryRunner.js when engine === 'kc'.
 *   Not imported anywhere else. Clean isolation.
 *
 * ============================================================================
 */

const SPFUQService            = require('./SPFUQService');
const KCBookingIntentDetector = require('./KCBookingIntentDetector');
const KCTransferIntentDetector = require('./KCTransferIntentDetector');
const KCS                     = require('../agent2/KnowledgeContainerService');
const { callLLMAgentForFollowUp } = require('../agent2/Agent2DiscoveryRunner');
const DiscoveryNotesService   = require('../../discoveryNotes/DiscoveryNotesService');
const EngineHubRuntime        = require('../EngineHubRuntime');
const logger                  = require('../../../utils/logger');

// ============================================================================
// PATH CONSTANTS
// ============================================================================

const PATH = {
  KC_DIRECT_ANSWER:  'KC_DIRECT_ANSWER',   // KC match → Groq answered
  KC_BOOKING_INTENT: 'KC_BOOKING_INTENT',  // Booking signal detected
  KC_SPFUQ_CONTINUE: 'KC_SPFUQ_CONTINUE', // Same-topic SPFUQ continuation
  KC_TOPIC_HOP:      'KC_TOPIC_HOP',       // SPFUQ active, new container matched
  KC_LLM_FALLBACK:   'KC_LLM_FALLBACK',   // No KC match → Claude LLM
  KC_GRACEFUL_ACK:   'KC_GRACEFUL_ACK',   // No KC + LLM unavailable
  KC_PFUQ_REASK:     'KC_PFUQ_REASK',     // KC answered follow-up, re-asked booking Q
  // ── Transfer paths ────────────────────────────────────────────────────────
  KC_TRANSFER_INTENT:   'KC_TRANSFER_INTENT',    // Transfer intent detected → transfer executing
  KC_TRANSFER_OVERFLOW: 'KC_TRANSFER_OVERFLOW',  // Transfer intent, destination unavailable → overflow
};

// ============================================================================
// GRACEFUL ACK RESPONSES  (canned, used only when all AI paths unavailable)
// ============================================================================

const GRACEFUL_ACK_RESPONSES = [
  "I want to make sure I get you the right information on that. Let me have someone follow up with you directly.",
  "That's a great question — I'll make sure one of our team members reaches out to give you the full details.",
  "I don't have the specifics on that right away, but I'll make sure someone follows up with you.",
];

function _gracefulAck() {
  return GRACEFUL_ACK_RESPONSES[Math.floor(Math.random() * GRACEFUL_ACK_RESPONSES.length)];
}

// ============================================================================
// UTILITIES
// ============================================================================

/** Clip a string to maxLen characters for safe logging. */
function _clip(str, maxLen = 80) {
  if (!str) return '';
  return str.length <= maxLen ? str : `${str.slice(0, maxLen)}…`;
}

/**
 * Build a safe _123rp metadata object for the Call Review Console.
 *
 * IMPORTANT: `tier` must be NUMERIC (1, 1.5, 2, 3) to match ResponseProtocol
 * format. The call-intelligence.js frontend switches on numeric values.
 * `lastPath` is the canonical field name; `path` kept for backward compat.
 */
function _build123rp(path, extra = {}) {
  // KC paths that use Groq = Tier 1.5 (Groq fast lane)
  // LLM fallback (Claude) = Tier 2
  // Graceful ACK = Tier 3
  const tier = path === PATH.KC_LLM_FALLBACK ? 2
    : path === PATH.KC_GRACEFUL_ACK ? 3
    : 1.5;
  const tierLabel = tier === 1.5 ? 'GROQ_FAST_LANE'
    : tier === 2 ? 'LLM_AGENT'
    : 'FALLBACK';

  return {
    tier,
    tierLabel,
    source:   'KC_ENGINE',
    path,
    lastPath: path,         // canonical name — call-intelligence.js reads this
    ...extra,
  };
}

/** Deep-clone state safely to avoid mutating the live state object. */
function _cloneState(state) {
  try {
    return JSON.parse(JSON.stringify(state || {}));
  } catch (_e) {
    return state || {};
  }
}

/**
 * _writeDiscoveryNotes — Fire-and-forget write to DiscoveryNotesService.
 *
 * Tries update() first (normal path — notes already exist from intake/greeting).
 * If the key isn't found yet (KC was the first thing this call hit), init()
 * creates an empty record then update() merges the patch in.
 *
 * NEVER await this in the hot path — always call as:
 *   _writeDiscoveryNotes(...).catch(() => {});
 *
 * Graceful degrade: any failure is swallowed — call continues, booking engine
 * just starts without pre-filled context (already the current behaviour).
 */
async function _writeDiscoveryNotes(companyId, callSid, patch) {
  try {
    const result = await DiscoveryNotesService.update(companyId, callSid, patch);
    if (result) return; // Notes existed — patch merged successfully

    // Key not found — KC is the first handler this call hit (no prior intake).
    // Init creates an empty record, then update merges our patch in.
    await DiscoveryNotesService.init(companyId, callSid, null);
    await DiscoveryNotesService.update(companyId, callSid, patch);
  } catch (_e) {
    // Non-fatal — booking engine degrades gracefully without discoveryNotes
  }
}

/**
 * _buildDiscoveryContext — Derive a compact call-context string from
 * discoveryNotes for injection into the Groq system prompt (~20-40 tokens).
 * Returns null if notes are empty or have no useful context.
 */
function _buildDiscoveryContext(notes) {
  if (!notes) return null;
  const parts = [];
  if (notes.callReason) parts.push(`Caller is calling about "${notes.callReason}"`);
  if (notes.entities?.firstName) parts.push(`Caller's name is ${notes.entities.firstName}`);
  if (notes.urgency && notes.urgency !== 'normal') parts.push(`Urgency: ${notes.urgency}`);
  if (notes.priorVisit === true) parts.push('Caller is a returning customer (has visited before)');
  if (notes.employeeMentioned) parts.push(`Caller mentioned employee: ${notes.employeeMentioned}`);
  // Rejected topics: caller explicitly said these answers were WRONG this call.
  // Inject so Groq/LLM does not repeat them — prevents the loop where the same
  // wrong answer is served back after explicit rejection.
  if (Array.isArray(notes.rejectedTopics) && notes.rejectedTopics.length) {
    parts.push(`IMPORTANT — caller already rejected these responses, do NOT repeat them: ${notes.rejectedTopics.join(', ')}`);
  }
  return parts.length ? parts.join('. ') + '.' : null;
}

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================

class KCDiscoveryRunner {
  /**
   * run — Main entry point. Signature mirrors Agent2DiscoveryRunner.run() exactly.
   *
   * @param {Object}   opts
   * @param {Object}   opts.company       — Full company document
   * @param {string}   opts.companyId     — Company ID (string)
   * @param {string}   opts.callSid       — Twilio call SID
   * @param {string}   opts.userInput     — Raw caller utterance
   * @param {Object}   opts.state         — Current call state
   * @param {Function} opts.emitEvent     — Observability emitter
   * @param {number}   opts.turn          — Turn counter
   * @param {string}   [opts.bridgeToken] — Bridge token (unused in KC path)
   * @param {Object}   [opts.redis]       — Shared Redis client (optional)
   * @param {Function} [opts.onSentence]  — Streaming sentence callback
   *
   * @returns {Promise<{ response: string, matchSource: string, state: Object, _123rp: Object }>}
   */
  static async run({
    company,
    companyId,
    callSid,
    userInput,
    state,
    emitEvent,
    turn                  = null,
    bridgeToken           = null,
    redis                 = null,
    onSentence            = null,
    pendingBookingQuestion = null,  // PFUQ question to re-append after KC answers
  }) {
    const startMs   = Date.now();
    const nextState = _cloneState(state);

    // ── SAFE EMITTER ─────────────────────────────────────────────────────────
    const emit = (type, data = {}) => {
      try {
        if (typeof emitEvent === 'function') emitEvent(type, data);
      } catch (_e) {
        // Observability must never break the call path.
      }
    };

    // ── COMPANY / CONFIG ──────────────────────────────────────────────────────
    const companyName  = company?.companyName || company?.name || 'our company';
    const kbSettings   = company?.knowledgeBaseSettings || {};
    const callerName   = state?.caller?.firstName || state?.caller?.name || null;
    const channel      = 'call';

    logger.info('[KC_ENGINE] 🚀 RUN START', {
      companyId, callSid, turn, inputPreview: _clip(userInput, 60),
    });

    emit('KC_RUNNER_START', {
      companyId, callSid, turn, inputPreview: _clip(userInput, 60),
    });

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 0.5 — TRANSFER INTENT CHECK  (~0ms synchronous, ~2ms with Redis)
    // ══════════════════════════════════════════════════════════════════════════
    // Fires BEFORE the booking gate. A caller asking for a human wants a human
    // immediately — booking can always be completed by the agent post-transfer.
    //
    // FAST PATH: isTransferIntent() is purely synchronous (~0ms).
    // Only if true do we hit Redis/MongoDB for policy + destinations (~2ms cached).
    //
    // HIERARCHY (mirrors TransferPolicy 5-level design):
    //   1. Emergency override active → overflow immediately (all transfers blocked)
    //   2. Destination found + available → execute transfer (set state, announce)
    //   3. Destination found + unavailable → overflow (voicemail/message)
    //   4. No destinations configured → fall through to GATE 1 (KC answers)
    //
    // GRACEFUL DEGRADE: any error falls through silently to GATE 1.
    // ══════════════════════════════════════════════════════════════════════════

    if (KCTransferIntentDetector.isTransferIntent(userInput)) {
      logger.info('[KC_ENGINE] 🔀 GATE 0.5: Transfer intent detected', {
        companyId, callSid, turn, inputPreview: _clip(userInput, 40),
      });
      emit('KC_TRANSFER_INTENT_FIRED', { companyId, callSid, turn, path: PATH.KC_TRANSFER_INTENT });

      try {
        // ── Lazy-require models (keeps non-transfer turns clean) ─────────────
        const TransferPolicy      = require('../../../models/TransferPolicy');
        const TransferDestination = require('../../../models/TransferDestination');

        // ── Load policy + active destinations (Redis-cached, ~1ms) ──────────
        const [policy, destinations] = await Promise.all([
          TransferPolicy.getForCompany(companyId).catch(() => null),
          TransferDestination.findActiveForCompany(companyId).catch(() => []),
        ]);

        // ── LEVEL 1: Emergency override — block all transfers ────────────────
        if (policy?.emergencyOverride?.active) {
          const emergencyMsg = policy.emergencyOverride.message ||
            'We are currently unable to take calls at this time. Please call back later.';

          logger.info('[KC_ENGINE] GATE 0.5: Emergency override active — transfer blocked', {
            companyId, callSid, turn,
          });
          emit('KC_TRANSFER_OVERFLOW_FIRED', { companyId, callSid, reason: 'emergency_override' });

          nextState.agent2              = nextState.agent2 || {};
          nextState.agent2.discovery    = nextState.agent2.discovery || {};
          nextState.agent2.discovery.lastPath = PATH.KC_TRANSFER_OVERFLOW;
          nextState.transferOverflow    = { action: 'emergency', reason: 'emergency_override' };

          return {
            response:    emergencyMsg,
            matchSource: 'KC_ENGINE',
            state:       nextState,
            _123rp:      _build123rp(PATH.KC_TRANSFER_OVERFLOW, {
              latencyMs: Date.now() - startMs,
              transferOverflowReason: 'emergency_override',
            }),
          };
        }

        // ── Extract routing hints from the caller's utterance ────────────────
        const hint = KCTransferIntentDetector.getTransferHint(userInput);

        // ── Find best matching destination ────────────────────────────────────
        // Priority: caller-named person → department keyword → first active dest
        let bestDest = null;

        if (hint.personName && destinations.length) {
          bestDest = destinations.find(d =>
            d.type === 'agent' &&
            d.name && d.name.toLowerCase().includes(hint.personName.toLowerCase())
          ) || null;
        }

        if (!bestDest && hint.department && destinations.length) {
          const deptNorm = hint.department.toLowerCase();
          bestDest = destinations.find(d =>
            d.type === 'department' &&
            d.name && d.name.toLowerCase().includes(deptNorm)
          ) || destinations.find(d =>
            d.departmentTag && d.departmentTag.toLowerCase().includes(deptNorm)
          ) || null;
        }

        // Fallback: first active, enabled destination (sorted by priority)
        if (!bestDest && destinations.length) {
          bestDest = destinations[0] || null;
        }

        if (!bestDest) {
          // No destinations configured — fall through to GATE 1 (KC will answer)
          logger.info('[KC_ENGINE] GATE 0.5: No transfer destinations configured — falling through', {
            companyId, callSid,
          });
          // ── intentional fall-through to GATE 1 ────────────────────────────
        } else {

          // ── Determine effective transfer mode ──────────────────────────────
          const transferMode = bestDest.transferContext?.transferMode
            || policy?.defaultTransferMode
            || 'warm';

          // ── Build transfer announcement text ──────────────────────────────
          // AI says this before bridging so the caller isn't dropped into silence.
          let announcement = '';
          if (policy?.announceTransfer?.enabled !== false) {
            const template = policy?.announceTransfer?.template
              || "I'm going to connect you now. Please hold for just a moment.";
            announcement = template
              .replace('{name}',       bestDest.name        || 'our team')
              .replace('{department}', bestDest.departmentTag || bestDest.name || 'our team')
              .replace('{title}',      bestDest.title        || '')
              .trim();
          }

          // ── Wire transfer state — v2twilio reads these to execute the dial ─
          nextState.justTransitionedToTransfer = true;
          nextState.sessionMode   = 'TRANSFER';
          // transferTarget shape: E.164 string for backward compat,
          // plus metadata object for the new v2twilio handler.
          nextState.transferTarget = bestDest.phoneNumber || null;
          nextState.transferMeta  = {
            destinationId: String(bestDest._id),
            name:          bestDest.name,
            type:          bestDest.type,
            mode:          transferMode,
            urgency:       hint.urgency || 'normal',
            department:    hint.department || bestDest.departmentTag || null,
            personName:    hint.personName || null,
            // Overflow config — v2twilio uses this if the dial fails
            overflowAction:  bestDest.overflow?.action || policy?.defaultOverflowAction || 'voicemail',
            overflowMessage: bestDest.overflow?.message || policy?.defaultOverflowMessage || null,
          };

          nextState.agent2              = nextState.agent2 || {};
          nextState.agent2.discovery    = nextState.agent2.discovery || {};
          nextState.agent2.discovery.lastPath = PATH.KC_TRANSFER_INTENT;

          // ── discoveryNotes: mark objective as TRANSFER ────────────────────
          _writeDiscoveryNotes(companyId, callSid, {
            objective:  'TRANSFER',
            turnNumber: turn ?? 0,
            ...(callerName ? { entities: { firstName: callerName } } : {}),
          }).catch(() => {});

          // Clear any active SPFUQ — transfer intent ends the topic anchor
          SPFUQService.clear(companyId, callSid).catch(() => {});

          logger.info('[KC_ENGINE] GATE 0.5: Transfer executing', {
            companyId, callSid, turn,
            dest: bestDest.name, mode: transferMode, urgency: hint.urgency,
            hasPhone: !!bestDest.phoneNumber,
          });

          emit('KC_TRANSFER_EXECUTING', {
            companyId, callSid, turn,
            destName: bestDest.name, mode: transferMode,
          });

          return {
            response:    announcement || null,
            matchSource: 'KC_ENGINE',
            state:       nextState,
            _123rp:      _build123rp(PATH.KC_TRANSFER_INTENT, {
              latencyMs:    Date.now() - startMs,
              transferDest: bestDest.name,
              transferMode,
              urgency:      hint.urgency,
            }),
          };
        }

      } catch (_transferErr) {
        // GATE 0.5 error — fall through silently to GATE 1 (booking check)
        logger.warn('[KC_ENGINE] GATE 0.5 error — falling through to GATE 1', {
          companyId, callSid, err: _transferErr.message,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 1 — BOOKING INTENT CHECK  (~0ms, synchronous)
    // ══════════════════════════════════════════════════════════════════════════
    // Only fires on PURE booking signals. If the caller's utterance also
    // contains a question ("yeah but do you offer maintenance?"), the question
    // takes priority — answer it first, let Groq's closingPrompt naturally
    // re-offer booking. This mirrors the _pureYes filter in the SPFUQ×PFUQ
    // interlock gate (Agent2DiscoveryRunner.js).
    //
    // Without this filter, "yeah I'd like to know if you offer maintenance"
    // would fire KC_BOOKING_INTENT on "yeah" and the caller's question would
    // never be answered — booking would hijack the call.
    // ══════════════════════════════════════════════════════════════════════════

    const _norm = (userInput || '').toLowerCase().replace(/[^a-z'\s]/g, ' ').trim();

    // ── Question filter: protect caller's follow-up questions from being
    // swallowed by the booking intent gate.
    //
    // BUG FIX (2026-03-28): '?' was checked on _norm which had already stripped
    // all punctuation — _norm.includes('?') was dead code and always false.
    // Fix: check RAW userInput for '?' before normalization.
    //
    // Regex expansion: "we can", "is that", "wondering if", "possible",
    // "add", "also" added to catch compound questions like:
    //   "yes, however I was wondering if we can also add a maintenance to that. Is that possible?"
    // Without this, "yes" fires BOOKING_INTENT and the question is dropped.
    const _inputHasQuestion = (userInput || '').includes('?') ||
      /\b(what|how|why|when|which|where|does|do you|can you|can we|we can|is it|is there|is that|include|cover|tell me|explain|about|more|offer|know|wondering|possible|add|also|and also)\b/.test(_norm);

    // Compound intent: utterance has BOTH a booking signal AND a question/topic.
    // When true: skip immediate booking handoff, answer the KC question this turn,
    // then transition to BOOKING lane so v2twilio redirects after the response plays.
    const _hasCompoundBookingIntent = _inputHasQuestion && KCBookingIntentDetector.isBookingIntent(userInput);

    if (!_inputHasQuestion && KCBookingIntentDetector.isBookingIntent(userInput)) {
      logger.info('[KC_ENGINE] Booking intent detected — routing to KC_BOOKING_INTENT', {
        companyId, callSid, turn, inputPreview: _clip(userInput, 40),
      });

      emit('KC_BOOKING_INTENT_FIRED', { companyId, callSid, turn, path: PATH.KC_BOOKING_INTENT });

      // Signal booking intent in state — booking engine picks this up next turn
      nextState.agent2                          = nextState.agent2 || {};
      nextState.agent2.discovery                = nextState.agent2.discovery || {};
      nextState.agent2.discovery.pendingBookingFromKC = true;
      nextState.agent2.discovery.lastPath       = PATH.KC_BOOKING_INTENT;

      // ── BOOKING HANDOFF: flip lane so v2twilio triggers the redirect ────────
      nextState.lane        = 'BOOKING';
      nextState.sessionMode = 'BOOKING';

      // ── discoveryNotes: mark objective as BOOKING so BookingLogicEngine
      //    has context on handoff (callReason already written on first KC match)
      _writeDiscoveryNotes(companyId, callSid, {
        objective:  'BOOKING',
        turnNumber: turn ?? 0,
        ...(callerName ? { entities: { firstName: callerName } } : {}),
      }).catch(() => {});

      // Clear any active SPFUQ — booking intent ends the topic anchor
      SPFUQService.clear(companyId, callSid).catch(() => {});

      const bookingResponse = "Great! Let me get that scheduled for you.";

      return {
        response:    bookingResponse,
        matchSource: 'KC_ENGINE',
        state:       nextState,
        _123rp:      _build123rp(PATH.KC_BOOKING_INTENT, { latencyMs: Date.now() - startMs }),
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2+3 — PARALLEL LOAD: SPFUQ + Notes + Containers + Container Embeddings
    // ══════════════════════════════════════════════════════════════════════════
    // 4 data sources fire concurrently. Utterance embedding is intentionally
    // NOT here — it fires only on keyword miss so the happy path (keyword hit)
    // has zero embedding latency. Net latency of this Promise.all ≈ 2ms (all
    // Redis/cache). Container embeddings load from Redis cache (1ms) so they
    // are pre-fetched and ready if we need them.
    // ══════════════════════════════════════════════════════════════════════════

    const hasEmbeddingKey = !!process.env.OPENAI_API_KEY;
    let spfuq               = null;
    let notes               = null;
    let containers          = [];
    let containerEmbeddings = new Map();
    let rejectedContainerIds = new Set();   // IDs caller has explicitly rejected this call

    try {
      const _rejKey = `kc-rejected:${companyId}:${callSid}`;
      let _rejRaw;
      [spfuq, notes, containers, containerEmbeddings, _rejRaw] = await Promise.all([
        SPFUQService.load(companyId, callSid).catch(() => null),
        DiscoveryNotesService.load(companyId, callSid).catch(() => null),
        KCS.getActiveForCompany(companyId).catch((_e) => {
          logger.warn('[KC_ENGINE] Failed to load containers', { companyId, callSid, err: _e.message });
          return [];
        }),
        hasEmbeddingKey
          ? KCS.getEmbeddingsForCompany(companyId).catch(() => new Map())
          : Promise.resolve(new Map()),
        redis ? redis.get(_rejKey).catch(() => null) : Promise.resolve(null),
      ]);
      if (_rejRaw) {
        try { rejectedContainerIds = new Set(JSON.parse(_rejRaw)); } catch (_) {}
      }
    } catch (_e) {
      containers = containers || [];
    }

    // ── Engine Hub Runtime — load config from company document (sync, ~0ms) ──
    // Returns null if Engine Hub is disabled, not configured, or passive mode.
    // Passive = settings loaded for logging only, no routing changes applied.
    // Learning / Active = settings govern hop threshold, policy selection, BC injection.
    const ehConfig = EngineHubRuntime.load(company);
    if (ehConfig) {
      EngineHubRuntime.logTrace(companyId, callSid, 'EH_ACTIVE', {
        mode:              ehConfig.mode,
        confidenceThresh:  ehConfig.intentDetection.confidenceThreshold,
        hopFactor:         EngineHubRuntime.getHopFactor(ehConfig).toFixed(2),
        spfuqActive:       !!spfuq,
        containerCount:    containers.length,
      }, ehConfig);
    }

    if (notes) {
      emit('KC_DISCOVERY_NOTES_LOADED', {
        callReason:  notes.callReason || null,
        objective:   notes.objective || null,
        entityCount: Object.values(notes.entities || {}).filter(Boolean).length,
      });
    }

    if (spfuq) {
      if (SPFUQService.isExpiredByTurnBudget(spfuq)) {
        logger.info('[KC_ENGINE] SPFUQ anchor expired (turn budget exhausted) — clearing', {
          companyId, callSid,
          containerTitle: spfuq.containerTitle,
          turnsRemaining: spfuq.turnsRemaining,
        });
        SPFUQService.clear(companyId, callSid).catch(() => {});
        spfuq = null;
      } else {
        logger.info('[KC_ENGINE] SPFUQ anchor loaded', {
          companyId, callSid, containerId: spfuq.containerId,
          containerTitle: spfuq.containerTitle, lastTurn: spfuq.lastTurn,
          turnsRemaining: spfuq.turnsRemaining,
        });
        emit('KC_SPFUQ_LOADED', {
          containerId: spfuq.containerId, containerTitle: spfuq.containerTitle,
          lastTurn: spfuq.lastTurn, turnsRemaining: spfuq.turnsRemaining,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // REJECTION DETECTOR — fires before container scoring
    // ══════════════════════════════════════════════════════════════════════════
    // PROBLEM this fixes (observed in production, March 2026):
    //   1. KC matches container A (wrong — e.g. "System Replacement").
    //   2. SPFUQ anchors to container A.
    //   3. Caller: "No, it's not a system replacement. I need maintenance price."
    //   4. Engine scores new container B (maintenance) — B.score < hopThreshold.
    //      Confidence-gap logic stays in A ("not strong enough to hop").
    //   5. Agent answers with "System Replacement" AGAIN. Loop repeats 5+ turns.
    //
    // FIX: When the caller's turn starts with an explicit rejection pattern AND
    // an SPFUQ anchor is active, treat it as a CANCEL (not a weak hop).
    //   → Clear SPFUQ immediately (regardless of hop threshold).
    //   → Add the rejected container ID to `rejectedContainerIds` (Redis, 4h TTL)
    //     so it is excluded from ALL scoring for the rest of this call.
    //   → Write the container title to discoveryNotes.rejectedTopics[] so the
    //     LLM fallback (GATE 4) knows what NOT to repeat.
    //   → Re-score fresh without the rejected container.
    // ══════════════════════════════════════════════════════════════════════════

    // Phrases that signal explicit rejection of the previous answer.
    // Anchored to start-of-utterance (^) to avoid false matches on:
    //   "I know that's not right but…" (contains 'not' but not a rejection opener)
    const _REJECTION_RE = /^(no[,!.\s]|nope[,!.\s]|that'?s?\s+not|it'?s?\s+not|that\s+is\s+not|i\s+said|i\s+don'?t\s+need|i\s+didn'?t\s+ask|i\s+am\s+not\s+(asking|calling|looking)|i'?m\s+not\s+(asking|calling|looking)|wrong\b|not\s+(a|an|the|that|what|this|it)\b)/i;

    if (spfuq && _REJECTION_RE.test((userInput || '').trim())) {
      const _rejectedId    = String(spfuq.containerId    || '');
      const _rejectedTitle = String(spfuq.containerTitle || '');

      logger.info('[KC_ENGINE] 🚫 REJECTION DETECTED — cancelling SPFUQ anchor', {
        companyId, callSid, turn,
        rejectedContainer: _rejectedTitle,
        inputPreview: _clip(userInput, 60),
      });
      emit('KC_REJECTION_DETECTED', {
        companyId, callSid, turn,
        rejectedContainer: _rejectedTitle,
      });

      if (_rejectedId) {
        rejectedContainerIds.add(_rejectedId);
        // Persist rejected list for this call (4h TTL — matches discoveryNotes)
        if (redis) {
          const _rk = `kc-rejected:${companyId}:${callSid}`;
          redis.setex(_rk, 4 * 3600, JSON.stringify([...rejectedContainerIds])).catch(() => {});
        }
        // Write rejected topic name to discoveryNotes so Groq/LLM knows to avoid it
        if (_rejectedTitle) {
          _writeDiscoveryNotes(companyId, callSid, {
            rejectedTopics: [_rejectedTitle],
          }).catch(() => {});
        }
      }
      // Clear the anchor — caller has explicitly cancelled it
      SPFUQService.clear(companyId, callSid).catch(() => {});
      spfuq = null;
    }

    // ── CONTAINER MATCH — keyword-first (0ms), embedding fallback ONLY on miss
    // ──────────────────────────────────────────────────────────────────────────
    // PERF CONTRACT: keyword path never touches OpenAI. Embedding fires only
    // when keywords produce no confident match. ~50ms only on miss, vs ~800ms
    // for Claude fallback — net saving ≈ 750ms per keyword miss.
    //
    // scorableContainers: containers minus any the caller explicitly rejected
    // this call (rejectedContainerIds). This prevents re-matching a container
    // the caller already said was the wrong answer, breaking the loop.
    const discoveryContext = _buildDiscoveryContext(notes);
    const callContext      = notes ? { callReason: notes.callReason } : null;

    const scorableContainers = rejectedContainerIds.size > 0
      ? containers.filter(c => !rejectedContainerIds.has(String(c._id || c.title || '')))
      : containers;

    if (rejectedContainerIds.size > 0) {
      logger.info('[KC_ENGINE] Excluded rejected containers from scoring', {
        companyId, callSid, turn,
        rejectedCount:  rejectedContainerIds.size,
        scorableCount:  scorableContainers.length,
        totalCount:     containers.length,
      });
    }

    // Step 1: keyword match (synchronous, ~0ms)
    let match = KCS.findContainer(scorableContainers, userInput, callContext);

    if (match?.contextAssisted) {
      emit('KC_CONTEXT_MATCH', {
        containerTitle: match.container.title,
        containerId:    String(match.container._id || match.container.title || ''),
        score:          match.score,
        callReason:     notes?.callReason || null,
      });
    }

    // Step 2: embedding fallback — only when keyword confidence is below threshold
    if ((!match || match.score < KCS.KEYWORD_CONFIDENCE_THRESHOLD) && containerEmbeddings.size > 0) {
      try {
        const utteranceEmbedding = await KCS._getUtteranceEmbedding(userInput, callSid, turn);
        if (utteranceEmbedding) {
          const embMatch = KCS.findContainer(scorableContainers, userInput, callContext, {
            utteranceEmbedding,
            containerEmbeddings,
          });
          if (embMatch?.embeddingAssisted) {
            match = embMatch;
            emit('KC_EMBEDDING_MATCH', {
              containerTitle:      match.container.title,
              containerId:         String(match.container._id || match.container.title || ''),
              embeddingSimilarity: match.embeddingSimilarity,
            });
            logger.info('[KC_ENGINE] Embedding fallback matched container', {
              companyId, callSid, turn,
              containerTitle: match.container.title,
              similarity:     match.embeddingSimilarity?.toFixed(3),
            });
          }
        }
      } catch (_embErr) {
        // Non-fatal — keyword result (or null) stands
        logger.warn('[KC_ENGINE] Utterance embedding failed — continuing with keyword result', {
          companyId, callSid, err: _embErr.message,
        });
      }
    }

    // Convenience: extract priorVisit once so all handlers below can use it
    const priorVisit = notes?.priorVisit === true;

    // ── SPFUQ ACTIVE + NEW CONTAINER MATCHED → TOPIC HOP (with confidence gap)
    if (spfuq && match && match.container) {
      const matchedId  = String(match.container._id || match.container.title || '');
      const anchoredId = String(spfuq.containerId || '');

      if (matchedId && anchoredId && matchedId !== anchoredId) {
        // FIX 2: Confidence gap — require the new container to score ≥ 1.5× what
        // the anchored container scores on this same input before allowing a hop.
        // This prevents a single generic word (e.g. "price") in another container
        // from stealing the caller away from their current topic.
        const anchorContainer = containers.find(c =>
          String(c._id || c.title || '') === anchoredId ||
          (c.title && c.title === spfuq.containerTitle)
        );
        const anchorMatch   = anchorContainer ? KCS.findContainer([anchorContainer], userInput) : null;
        const anchorScore   = anchorMatch?.score ?? 0;

        // Engine Hub governs the hop factor — replaces hardcoded 1.5×.
        // getHopFactor() returns 1/confidenceThreshold so:
        //   threshold=0.72 → factor=1.39 (slightly more permissive than old 1.5×)
        //   threshold=0.50 → factor=2.00 (very strict, stays in topic longer)
        //   threshold=0.90 → factor=1.11 (permissive, easy topic hops)
        // Falls back to 1.39 when Engine Hub is disabled/passive.
        const hopFactor     = EngineHubRuntime.getHopFactor(ehConfig);
        const hopThreshold  = Math.max(anchorScore * hopFactor, 1);

        if (match.score < hopThreshold) {
          // New match not strong enough — stay in SPFUQ topic.
          // NULL out match so the SPFUQ-continue path fires below (not _handleKCMatch).
          logger.info('[KC_ENGINE] Topic hop blocked (confidence gap) — staying in SPFUQ topic', {
            companyId, callSid,
            from: spfuq.containerTitle, to: match.container.title,
            matchScore: match.score, anchorScore, hopThreshold, hopFactor,
          });
          EngineHubRuntime.logTrace(companyId, callSid, 'KC_HOP_BLOCKED', {
            from: spfuq.containerTitle, to: match.container.title,
            matchScore: match.score, anchorScore, hopThreshold, hopFactor,
          }, ehConfig);
          match = null; // Force SPFUQ continue path below
        } else {
          // Caller clearly moved to a different topic — clear old anchor, hop
          logger.info('[KC_ENGINE] Topic hop confirmed (confidence gap cleared) — switching container', {
            companyId, callSid,
            from: spfuq.containerTitle, to: match.container.title,
            matchScore: match.score, anchorScore, hopThreshold,
          });
          emit('KC_CONTAINER_MATCHED', {
            containerTitle: match.container.title,
            containerId:    String(match.container._id || match.container.title || ''),
            kcId:           match.container.kcId || null,
            score:          match.score,
            path:           PATH.KC_TOPIC_HOP,
          });

          SPFUQService.clear(companyId, callSid).catch(() => {});
          spfuq = null; // Treat as fresh match below (falls into direct-answer path)
        }
      }
    }

    // ── SPFUQ ACTIVE + NO NEW MATCH (OR SAME CONTAINER) → CONTINUE ──────────
    if (spfuq && (!match || !match.container)) {
      // Caller asked a follow-up, no new container matched — stay in SPFUQ topic
      return await _handleSPFUQContinue({
        spfuq, userInput, companyId, callSid, company, kbSettings, callerName,
        containers, channel, nextState, emit, startMs, turn,
        bridgeToken, redis, onSentence, pendingBookingQuestion,
        discoveryContext, priorVisit,
        compoundBookingIntent: _hasCompoundBookingIntent,
      });
    }

    // ── NEW MATCH (or same container after hop cleared) → DIRECT ANSWER ──────
    if (match && match.container) {
      return await _handleKCMatch({
        match, userInput, spfuq, companyId, callSid, company, kbSettings, callerName,
        channel, nextState, emit, startMs, turn,
        bridgeToken, redis, onSentence, pendingBookingQuestion,
        discoveryContext, priorVisit,
        compoundBookingIntent: _hasCompoundBookingIntent,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 4 — NO KC MATCH → LLM FALLBACK (Claude, bucket=COMPLEX)
    // ══════════════════════════════════════════════════════════════════════════

    return await _handleLLMFallback({
      userInput, companyId, callSid, company, channel, nextState, emit, startMs, turn,
      bridgeToken, redis, callerName, onSentence,
      containers,   // passed so fallback event records what was searched
      ehConfig,     // Engine Hub config — drives BC injection + trace logging
      notes,        // discoveryNotes for building Claude callContext
    });
  }
}

// ============================================================================
// HANDLER: KC SPFUQ CONTINUE
// ============================================================================

async function _handleSPFUQContinue({
  spfuq, userInput, companyId, callSid, company, kbSettings, callerName,
  containers,   // already loaded in run() — no second DB round-trip
  channel, nextState, emit, startMs, turn,
  bridgeToken            = null,
  redis                  = null,
  onSentence             = null,
  pendingBookingQuestion = null,
  discoveryContext       = null,
  priorVisit             = false,
  compoundBookingIntent  = false,
}) {
  const containerTitle = spfuq.containerTitle || 'this topic';

  logger.info('[KC_ENGINE] SPFUQ_CONTINUE — re-answering in existing topic', {
    companyId, callSid, containerTitle, turn,
  });

  // Containers already loaded in run() via Promise.all — no second DB call needed.
  // Guard: if somehow empty (e.g. caller entered this path from Turn-1 fast path
  // where containers haven't been pre-loaded), fall back to a fresh load.
  if (!containers?.length) {
    try {
      containers = await KCS.getActiveForCompany(companyId);
    } catch (_e) { containers = []; }
  }

  const anchorMatch = containers.find(c =>
    String(c._id || c.title || '') === String(spfuq.containerId || '') ||
    (c.title && c.title === spfuq.containerTitle)
  );

  if (!anchorMatch) {
    // Anchored container no longer exists — clear anchor, fall to LLM
    logger.warn('[KC_ENGINE] SPFUQ container no longer found — clearing anchor, falling to LLM', {
      companyId, callSid, containerId: spfuq.containerId,
    });
    SPFUQService.clear(companyId, callSid).catch(() => {});
    return await _handleLLMFallback({
      userInput, companyId, callSid, company, channel: 'call', nextState, emit,
      startMs, turn, bridgeToken, redis, callerName, onSentence,
    });
  }

  // Build spfuqContext — injected into the system prompt so Groq resolves pronouns
  // ('it', 'that', 'they') back to the anchored container.  Previously this was
  // prepended to the user message, which confused Groq's role boundary.
  // Now it lives in the system prompt via KCS.answer({ spfuqContext }).
  const spfuqContext = spfuq.subjectBrief || `Caller is asking about ${containerTitle}`;

  emit('KC_CONTAINER_MATCHED', {
    containerTitle: anchorMatch.title,
    containerId:    String(anchorMatch._id || anchorMatch.title || ''),
    kcId:           anchorMatch.kcId || null,
    score:          'spfuq',
    path:           PATH.KC_SPFUQ_CONTINUE,
  });

  let kcResult;
  try {
    kcResult = await KCS.answer({
      container:    anchorMatch,
      question:     userInput,
      kbSettings,
      company,
      callerName,
      callSid,
      spfuqContext,
      discoveryContext,
      priorVisit,   // passed from run() — was notes?.priorVisit (out-of-scope bug fixed)
    });
  } catch (_e) {
    logger.error('[KC_ENGINE] Groq error on SPFUQ_CONTINUE', { companyId, callSid, err: _e.message });
    kcResult = { response: null, intent: KCS.INTENT.ERROR };
  }

  if (!kcResult?.response) {
    // Groq couldn't answer even with context — fall to LLM
    return await _handleLLMFallback({
      userInput, companyId, callSid, company, channel: 'call', nextState, emit,
      startMs, turn, bridgeToken, redis, callerName, onSentence,
    });
  }

  // Update SPFUQ anchor with new Q&A context + decrement turn budget (FIX 3)
  const updatedBrief    = SPFUQService.buildBrief(spfuq, userInput, kcResult.response);
  const turnsRemaining  = typeof spfuq.turnsRemaining === 'number'
    ? Math.max(0, spfuq.turnsRemaining - 1)
    : SPFUQService.DEFAULT_TURN_BUDGET - 1;
  SPFUQService.set(companyId, callSid, {
    ...spfuq,
    lastTurn:       turn ?? spfuq.lastTurn,
    lastQuestion:   userInput,
    lastAnswer:     kcResult.response,
    subjectBrief:   updatedBrief,
    turnsRemaining,   // decremented — next turn checks this in GATE 2
  }).catch(() => {});

  // ── discoveryNotes: keep callReason + Q&A log current across SPFUQ turns ─
  _writeDiscoveryNotes(companyId, callSid, {
    callReason:         anchorMatch.title,
    objective:          'DISCOVERY',
    turnNumber:         turn ?? 0,
    lastMeaningfulInput: userInput?.slice(0, 200) || null,
    qaLog: [{
      turn:      turn ?? 0,
      question:  userInput,
      answer:    kcResult.response?.slice(0, 200) || null,
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});

  // ── Compound booking intent: KC answered the question; now transition to booking ──
  // Caller had both a booking signal and a topic question in the same utterance.
  // Set lane = 'BOOKING' so v2twilio redirects to BookingLogicEngine after this response.
  if (compoundBookingIntent && !nextState.lane) {
    logger.info('[KC_ENGINE] Compound booking intent (SPFUQ) — transitioning to BOOKING after KC answer', {
      companyId, callSid, containerTitle: anchorMatch.title, turn,
    });
    nextState.lane        = 'BOOKING';
    nextState.sessionMode = 'BOOKING';
    nextState.agent2 = nextState.agent2 || {};
    nextState.agent2.discovery = nextState.agent2.discovery || {};
    nextState.agent2.discovery.pendingBookingFromKC = true;
    _writeDiscoveryNotes(companyId, callSid, {
      callReason: anchorMatch.title,
      objective:  'BOOKING',
      turnNumber: turn ?? 0,
    }).catch(() => {});
    SPFUQService.clear(companyId, callSid).catch(() => {});
  }

  // ── Path: KC_PFUQ_REASK when booking consent was pending ──────────────────
  // Groq's closingPrompt already asked the booking question naturally as part
  // of its response. We re-assert PFUQ in state ONLY — no second question is
  // appended to the spoken response. The consent gate catches yes/no next turn.
  const finalPath = pendingBookingQuestion ? PATH.KC_PFUQ_REASK : PATH.KC_SPFUQ_CONTINUE;

  nextState.agent2            = nextState.agent2 || {};
  nextState.agent2.discovery  = nextState.agent2.discovery || {};
  nextState.agent2.discovery.lastPath    = finalPath;
  nextState.agent2.discovery.lastKCTitle = anchorMatch.title;

  if (pendingBookingQuestion) {
    nextState.agent2.discovery.pendingFollowUpQuestion     = pendingBookingQuestion;
    nextState.agent2.discovery.pendingFollowUpQuestionTurn = turn ?? 0;
    emit('KC_PFUQ_REASK_FIRED', {
      containerId:    String(anchorMatch._id || anchorMatch.title || ''),
      containerTitle: anchorMatch.title,
      turn,
      path:           finalPath,
    });
  }

  emit('KC_GROQ_ANSWERED', {
    intent:                kcResult.intent,
    confidence:            kcResult.confidence ?? null,
    latencyMs:             kcResult.latencyMs,
    path:                  finalPath,
    responsePreview:       _clip(kcResult.response, 200),
    containerTitle:        anchorMatch.title,
    containerId:           String(anchorMatch._id || anchorMatch.title || ''),
    kcId:                  anchorMatch.kcId || null,
    containerBlockPreview: kcResult.containerBlockPreview || null,
  });

  logger.info('[KC_ENGINE] ✅ KC_SPFUQ_CONTINUE complete', {
    companyId, callSid, containerTitle: anchorMatch.title,
    intent: kcResult.intent, latencyMs: Date.now() - startMs,
  });

  return {
    response:    kcResult.response,
    matchSource: 'KC_ENGINE',
    state:       nextState,
    _123rp:      _build123rp(finalPath, {
      containerId:    String(anchorMatch._id || anchorMatch.title || ''),
      containerTitle: anchorMatch.title,
      kcId:           anchorMatch.kcId || null,
      intent:         kcResult.intent,
      latencyMs:      Date.now() - startMs,
      spfuqActive:    true,
    }),
  };
}

// ============================================================================
// HANDLER: KC DIRECT ANSWER / TOPIC HOP
// ============================================================================

async function _handleKCMatch({
  match, userInput, spfuq, companyId, callSid, company, kbSettings, callerName,
  channel, nextState, emit, startMs, turn,
  bridgeToken            = null,
  redis                  = null,
  onSentence             = null,
  pendingBookingQuestion = null,
  discoveryContext       = null,
  priorVisit             = false,
  compoundBookingIntent  = false,
}) {
  const container      = match.container;
  const containerTitle = container.title || 'Knowledge Container';
  const containerId    = String(container._id || containerTitle);

  logger.info('[KC_ENGINE] Container matched', {
    companyId, callSid, containerTitle, score: match.score, turn,
  });

  emit('KC_CONTAINER_MATCHED', {
    containerTitle,
    containerId:  String(container._id || containerTitle),
    kcId:         container.kcId || null,
    score:        match.score,
    path:         PATH.KC_DIRECT_ANSWER,
  });

  let kcResult;
  try {
    kcResult = await KCS.answer({
      container,
      question: userInput,
      kbSettings,
      company,
      callerName,
      callSid,
      discoveryContext,
      priorVisit,   // passed from run() — was notes?.priorVisit (out-of-scope bug fixed)
    });
  } catch (_e) {
    logger.error('[KC_ENGINE] Groq error on direct answer', { companyId, callSid, containerId, err: _e.message });
    kcResult = { response: null, intent: KCS.INTENT.ERROR };
  }

  // ── Groq returned no answer (NO_DATA or ERROR) → fall to LLM ────────────
  if (!kcResult?.response) {
    logger.info('[KC_ENGINE] KC had no answer — falling to LLM', {
      companyId, callSid, containerTitle, intent: kcResult?.intent,
    });
    return await _handleLLMFallback({
      userInput, companyId, callSid, company, channel: 'call', nextState, emit,
      startMs, turn, bridgeToken, redis, callerName, onSentence,
    });
  }

  // ── BOOKING_READY from Groq → signal booking intent ──────────────────────
  if (kcResult.intent === KCS.INTENT.BOOKING_READY) {
    logger.info('[KC_ENGINE] BOOKING_READY from Groq — routing to KC_BOOKING_INTENT', {
      companyId, callSid, containerTitle,
    });

    emit('KC_BOOKING_INTENT_FIRED', { companyId, callSid, turn, path: PATH.KC_BOOKING_INTENT, source: 'groq' });

    nextState.agent2                          = nextState.agent2 || {};
    nextState.agent2.discovery                = nextState.agent2.discovery || {};
    nextState.agent2.discovery.pendingBookingFromKC = true;
    nextState.agent2.discovery.lastPath       = PATH.KC_BOOKING_INTENT;

    // ── BOOKING HANDOFF: flip lane so v2twilio triggers the redirect ────────
    nextState.lane        = 'BOOKING';
    nextState.sessionMode = 'BOOKING';

    // ── discoveryNotes: callReason + objective BOOKING for BookingLogicEngine
    _writeDiscoveryNotes(companyId, callSid, {
      callReason: containerTitle,
      objective:  'BOOKING',
      turnNumber: turn ?? 0,
      ...(callerName ? { entities: { firstName: callerName } } : {}),
    }).catch(() => {});

    SPFUQService.clear(companyId, callSid).catch(() => {});

    return {
      response:    kcResult.response,
      matchSource: 'KC_ENGINE',
      state:       nextState,
      _123rp:      _build123rp(PATH.KC_BOOKING_INTENT, {
        containerId, containerTitle, kcId: container.kcId || null,
        intent: kcResult.intent, latencyMs: Date.now() - startMs,
      }),
    };
  }

  // ── ANSWERED — set/update SPFUQ anchor and return ────────────────────────
  const newBrief = SPFUQService.buildBrief(null, userInput, kcResult.response);
  // FIX 3+4: Initialize turn budget from container.followUpDepth (admin-set) or system default
  const initialTurns = (typeof container.followUpDepth === 'number' && container.followUpDepth >= 2)
    ? container.followUpDepth
    : SPFUQService.DEFAULT_TURN_BUDGET;
  SPFUQService.set(companyId, callSid, {
    containerId,
    containerTitle,
    containerKeywords: container.keywords || [],
    anchoredAt:        new Date().toISOString(),
    lastTurn:          turn ?? 0,
    lastQuestion:      userInput,
    lastAnswer:        kcResult.response,
    subjectBrief:      newBrief,
    turnsRemaining:    initialTurns,    // reset budget on fresh match / topic hop
  }).catch(() => {});

  // ── discoveryNotes: record callReason + Q&A so BookingLogicEngine knows
  //    what the call was about when the caller eventually says "let's book" ──
  _writeDiscoveryNotes(companyId, callSid, {
    callReason:         containerTitle,
    objective:          'DISCOVERY',
    turnNumber:         turn ?? 0,
    lastMeaningfulInput: userInput?.slice(0, 200) || null,
    ...(callerName ? { entities: { firstName: callerName } } : {}),
    qaLog: [{
      turn:      turn ?? 0,
      question:  userInput,
      answer:    kcResult.response?.slice(0, 200) || null,
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});

  // ── Compound booking intent: KC answered the question; now transition to booking ──
  // Caller had both a booking signal and a topic question in the same utterance.
  // Set lane = 'BOOKING' so v2twilio redirects to BookingLogicEngine after this response.
  if (compoundBookingIntent && !nextState.lane) {
    logger.info('[KC_ENGINE] Compound booking intent — transitioning to BOOKING after KC answer', {
      companyId, callSid, containerTitle, turn,
    });
    nextState.lane        = 'BOOKING';
    nextState.sessionMode = 'BOOKING';
    nextState.agent2 = nextState.agent2 || {};
    nextState.agent2.discovery = nextState.agent2.discovery || {};
    nextState.agent2.discovery.pendingBookingFromKC = true;
    _writeDiscoveryNotes(companyId, callSid, {
      callReason: containerTitle,
      objective:  'BOOKING',
      turnNumber: turn ?? 0,
      ...(callerName ? { entities: { firstName: callerName } } : {}),
    }).catch(() => {});
    SPFUQService.clear(companyId, callSid).catch(() => {});
  }

  // ── Path: KC_PFUQ_REASK when booking consent was pending ──────────────────
  // Groq's closingPrompt already asked the booking question naturally as part
  // of its response. We re-assert PFUQ in state ONLY — no second question is
  // appended to the spoken response. The consent gate catches yes/no next turn.
  const finalPath = pendingBookingQuestion ? PATH.KC_PFUQ_REASK : PATH.KC_DIRECT_ANSWER;

  nextState.agent2            = nextState.agent2 || {};
  nextState.agent2.discovery  = nextState.agent2.discovery || {};
  nextState.agent2.discovery.lastPath    = finalPath;
  nextState.agent2.discovery.lastKCTitle = containerTitle;

  if (pendingBookingQuestion) {
    nextState.agent2.discovery.pendingFollowUpQuestion     = pendingBookingQuestion;
    nextState.agent2.discovery.pendingFollowUpQuestionTurn = turn ?? 0;
    emit('KC_PFUQ_REASK_FIRED', { containerId, containerTitle, turn, path: finalPath });
  }

  emit('KC_GROQ_ANSWERED', {
    intent:                kcResult.intent,
    confidence:            kcResult.confidence ?? null,
    latencyMs:             kcResult.latencyMs,
    path:                  finalPath,
    responsePreview:       _clip(kcResult.response, 200),
    containerTitle,
    containerId,
    kcId:                  container.kcId || null,
    containerBlockPreview: kcResult.containerBlockPreview || null,
  });

  logger.info('[KC_ENGINE] ✅ KC_DIRECT_ANSWER complete', {
    companyId, callSid, containerTitle,
    intent: kcResult.intent, latencyMs: Date.now() - startMs,
  });

  return {
    response:    kcResult.response,
    matchSource: 'KC_ENGINE',
    state:       nextState,
    _123rp:      _build123rp(finalPath, {
      containerId, containerTitle, kcId: container.kcId || null,
      intent:      kcResult.intent,
      latencyMs:   Date.now() - startMs,
      spfuqActive: false,
    }),
  };
}

// ============================================================================
// HANDLER: LLM FALLBACK (Claude, bucket=COMPLEX)
// ============================================================================

async function _handleLLMFallback({
  userInput, companyId, callSid, company, channel, nextState, emit,
  startMs, turn, bridgeToken, redis, callerName, onSentence,
  containers = [],
  notes      = null,
  ehConfig   = null,   // Engine Hub runtime config (null = disabled/passive)
}) {
  logger.info('[KC_ENGINE] No KC match — firing LLM fallback (Claude COMPLEX)', {
    companyId, callSid, turn, inputPreview: _clip(userInput, 40),
    containerCount: containers.length,
  });

  // Emit rich diagnostic payload so Call Intelligence can explain WHY KC
  // fell back and which containers were searched — critical for debugging.
  emit('KC_LLM_FALLBACK_FIRED', {
    companyId, callSid, turn,
    reason:          containers.length ? 'no_kc_match' : 'no_containers_configured',
    inputPreview:    _clip(userInput, 100),
    containerCount:  containers.length,
    containerTitles: containers.map(c => c.title).slice(0, 8),
    callReason:      notes?.callReason || null,
  });

  // ── Engine Hub: load discovery_flow Standalone BC ─────────────────────────
  // When KC misses, we are in unstructured discovery territory.
  // The discovery_flow BC injects tone + rules into Claude's context so the
  // LLM stays on-protocol (one question at a time, urgency check, etc.).
  // Only injected in learning/active mode — passive = log only.
  let discoveryFlowBC = null;
  if (ehConfig && !ehConfig.isPassive) {
    discoveryFlowBC = await EngineHubRuntime.getStandaloneBC('discovery_flow', companyId);
    if (discoveryFlowBC) {
      EngineHubRuntime.logTrace(companyId, callSid, 'BC_INJECTED', {
        standaloneType: 'discovery_flow',
        bcName:         discoveryFlowBC.name,
        afterAction:    discoveryFlowBC.afterAction,
      }, ehConfig);
    }
  } else if (ehConfig?.isPassive) {
    // Passive mode: log what WOULD have happened but don't inject
    EngineHubRuntime.getStandaloneBC('discovery_flow', companyId).then(bc => {
      if (bc) {
        EngineHubRuntime.logTrace(companyId, callSid, 'BC_WOULD_INJECT', {
          standaloneType: 'discovery_flow',
          bcName:         bc.name,
          mode:           'passive',
          note:           'Promote to learning/active to apply BC rules',
        }, ehConfig);
      }
    }).catch(() => {});
  }

  const behaviorBlock = EngineHubRuntime.formatStandaloneBCForPrompt(discoveryFlowBC);

  // Build callContext from discoveryNotes so Claude has call-level awareness.
  // behaviorBlock (Engine Hub BC rules) is included so Claude follows the
  // discovery_flow tone + rules when no KC card is guiding the response.
  const callContext = notes ? {
    caller:        notes.entities?.firstName ? { firstName: notes.entities.firstName, speakable: true } : null,
    issue:         notes.callReason ? { summary: notes.callReason } : null,
    urgency:       notes.urgency === 'high' ? { level: 'high', reason: notes.callReason } : null,
    behaviorBlock: behaviorBlock || null,   // Engine Hub discovery_flow BC rules
  } : (behaviorBlock ? { behaviorBlock } : null);

  let llmResult = null;
  try {
    llmResult = await callLLMAgentForFollowUp({
      company,
      input:               userInput,
      followUpQuestion:    '',        // No pending FUQ in KC mode
      triggerSource:       'KC_ENGINE_FALLBACK',
      bucket:              'COMPLEX',
      channel,
      emit,
      callSid,
      turn,
      bridgeToken,
      redis,
      callerName,
      onSentence,
      callContext,                     // discoveryNotes context for Claude
    });
  } catch (_e) {
    logger.error('[KC_ENGINE] LLM fallback threw — routing to graceful ACK', {
      companyId, callSid, err: _e.message,
    });
  }

  if (llmResult?.response) {
    nextState.agent2            = nextState.agent2 || {};
    nextState.agent2.discovery  = nextState.agent2.discovery || {};
    nextState.agent2.discovery.lastPath = PATH.KC_LLM_FALLBACK;

    logger.info('[KC_ENGINE] ✅ KC_LLM_FALLBACK complete', {
      companyId, callSid, latencyMs: Date.now() - startMs,
    });

    return {
      response:    llmResult.response,
      matchSource: 'KC_ENGINE',
      state:       nextState,
      _123rp:      _build123rp(PATH.KC_LLM_FALLBACK, {
        latencyMs:   Date.now() - startMs,
        tokensUsed:  llmResult.tokensUsed,
      }),
    };
  }

  // ── ALL PATHS EXHAUSTED — GRACEFUL ACK ───────────────────────────────────
  logger.warn('[KC_ENGINE] KC_GRACEFUL_ACK — all AI paths unavailable', {
    companyId, callSid, turn,
  });

  emit('KC_GRACEFUL_ACK_FIRED', { companyId, callSid, turn });

  const ackResponse = (company?.knowledgeBaseSettings?.fallbackResponse || '').trim()
    || _gracefulAck();

  nextState.agent2            = nextState.agent2 || {};
  nextState.agent2.discovery  = nextState.agent2.discovery || {};
  nextState.agent2.discovery.lastPath = PATH.KC_GRACEFUL_ACK;

  return {
    response:    ackResponse,
    matchSource: 'KC_ENGINE',
    state:       nextState,
    _123rp:      _build123rp(PATH.KC_GRACEFUL_ACK, { latencyMs: Date.now() - startMs }),
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = KCDiscoveryRunner;

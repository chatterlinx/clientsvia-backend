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
const KCS                     = require('../agent2/KnowledgeContainerService');
const { callLLMAgentForFollowUp } = require('../agent2/Agent2DiscoveryRunner');
const DiscoveryNotesService   = require('../../discoveryNotes/DiscoveryNotesService');
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
    const _inputHasQuestion = _norm.includes('?') ||
      /\b(what|how|why|when|which|where|does|do you|can you|is it|is there|include|cover|tell me|explain|about|more|offer|know)\b/.test(_norm);

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
    // GATE 2 — LOAD SPFUQ ANCHOR + DISCOVERY NOTES  (parallel, ~1ms each)
    // ══════════════════════════════════════════════════════════════════════════

    let spfuq = null;
    let notes = null;
    try {
      [spfuq, notes] = await Promise.all([
        SPFUQService.load(companyId, callSid).catch(() => null),
        DiscoveryNotesService.load(companyId, callSid).catch(() => null),
      ]);
    } catch (_e) {
      // Redis timeout — continue without anchor or notes
    }

    if (notes) {
      emit('KC_DISCOVERY_NOTES_LOADED', {
        callReason:  notes.callReason || null,
        objective:   notes.objective || null,
        entityCount: Object.values(notes.entities || {}).filter(Boolean).length,
      });
    }

    if (spfuq) {
      // FIX 3: Check turn budget — if expired, clear anchor and proceed fresh
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
    // GATE 3 — KNOWLEDGE CONTAINER MATCH  (~2ms, Redis/MongoDB)
    // ══════════════════════════════════════════════════════════════════════════

    let containers = [];
    try {
      containers = await KCS.getActiveForCompany(companyId);
    } catch (_e) {
      logger.warn('[KC_ENGINE] Failed to load containers — falling to LLM', { companyId, callSid, err: _e.message });
    }

    const discoveryContext = _buildDiscoveryContext(notes);
    const match = KCS.findContainer(containers, userInput, notes ? { callReason: notes.callReason } : null);

    if (match?.contextAssisted) {
      emit('KC_CONTEXT_MATCH', {
        containerTitle: match.container.title,
        containerId:    String(match.container._id || match.container.title || ''),
        score:          match.score,
        callReason:     notes?.callReason || null,
      });
    }

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
        const hopThreshold  = Math.max(anchorScore * 1.5, 1);  // at least 1.5× anchor, min threshold of 1

        if (match.score < hopThreshold) {
          // New match not strong enough — stay in SPFUQ topic, let continue path handle it
          logger.info('[KC_ENGINE] Topic hop blocked (confidence gap) — staying in SPFUQ topic', {
            companyId, callSid,
            from: spfuq.containerTitle, to: match.container.title,
            matchScore: match.score, anchorScore, hopThreshold,
          });
          // Intentionally do NOT clear spfuq — fall through to SPFUQ continue check below
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
        channel, nextState, emit, startMs, turn,
        bridgeToken, redis, onSentence, pendingBookingQuestion,
        discoveryContext,
      });
    }

    // ── NEW MATCH (or same container after hop cleared) → DIRECT ANSWER ──────
    if (match && match.container) {
      return await _handleKCMatch({
        match, userInput, spfuq, companyId, callSid, company, kbSettings, callerName,
        channel, nextState, emit, startMs, turn,
        bridgeToken, redis, onSentence, pendingBookingQuestion,
        discoveryContext,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 4 — NO KC MATCH → LLM FALLBACK (Claude, bucket=COMPLEX)
    // ══════════════════════════════════════════════════════════════════════════

    return await _handleLLMFallback({
      userInput, companyId, callSid, company, channel, nextState, emit, startMs, turn,
      bridgeToken, redis, callerName, onSentence,
      containers,   // passed so fallback event records what was searched
      notes,        // discoveryNotes for building Claude callContext
    });
  }
}

// ============================================================================
// HANDLER: KC SPFUQ CONTINUE
// ============================================================================

async function _handleSPFUQContinue({
  spfuq, userInput, companyId, callSid, company, kbSettings, callerName,
  channel, nextState, emit, startMs, turn,
  bridgeToken           = null,
  redis                 = null,
  onSentence            = null,
  pendingBookingQuestion = null,
  discoveryContext       = null,
}) {
  const containerTitle = spfuq.containerTitle || 'this topic';

  logger.info('[KC_ENGINE] SPFUQ_CONTINUE — re-answering in existing topic', {
    companyId, callSid, containerTitle, turn,
  });

  // We need to reload the actual container document for Groq
  let containers = [];
  try {
    containers = await KCS.getActiveForCompany(companyId);
  } catch (_e) { /* graceful */ }

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
      question:     userInput,      // clean question — context now in system prompt
      kbSettings,
      company,
      callerName,
      callSid,
      spfuqContext,                  // ← FIX 1: active topic injected via system prompt
      discoveryContext,              // call-level context from discoveryNotes
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
  bridgeToken           = null,
  redis                 = null,
  onSentence            = null,
  pendingBookingQuestion = null,
  discoveryContext       = null,
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
      discoveryContext,              // call-level context from discoveryNotes
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

  // Build callContext from discoveryNotes so Claude has call-level awareness
  const callContext = notes ? {
    caller: notes.entities?.firstName ? { firstName: notes.entities.firstName, speakable: true } : null,
    issue:  notes.callReason ? { summary: notes.callReason } : null,
    urgency: notes.urgency === 'high' ? { level: 'high', reason: notes.callReason } : null,
  } : null;

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

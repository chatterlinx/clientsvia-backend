'use strict';

/**
 * ============================================================================
 * KC DISCOVERY RUNNER  (v1.0)
 * ============================================================================
 *
 * PURPOSE:
 *   Enterprise-grade Knowledge Container-first discovery engine. Replaces the
 *   ScrabEngine → Triggers → LLM cascade with a cleaner, more conversational
 *   KC → Groq → LLM pipeline.
 *
 *   Topic persistence is handled by discoveryNotes.anchorContainerId (3× score
 *   multiplier + ANCHOR_FLOOR=24 in findContainer). No separate Redis state.
 *
 *   Activated by:  company.aiAgentSettings.agent2.discovery.engine = 'kc'
 *   Toggled from:  agent2.html > "🧠 Discovery Engine" card
 *   Switch point:  Agent2DiscoveryRunner.js (before ScrabEngine)
 *
 * PIPELINE (in order):
 *   1. Booking intent check   (KCBookingIntentDetector — synchronous, ~0ms)
 *   2. KC container match     (KnowledgeContainerService.findContainer — ~2ms)
 *   3. Groq answer            (KnowledgeContainerService.answer — ~500ms)
 *   4. LLM fallback           (callLLMAgentForFollowUp — ~800ms, only if no KC)
 *   5. Graceful ACK           (canned response, only if LLM also unavailable)
 *
 * PATH CONSTANTS (visible in Call Review Console trace):
 *   KC_DIRECT_ANSWER    — KC matched, Groq answered, conversation continues
 *   KC_BOOKING_INTENT   — Booking signal detected → PFUQ/booking on next turn
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
 *   Groq down → NO_DATA / ERROR intent → LLM fallback
 *
 * WIRING:
 *   Called from Agent2DiscoveryRunner.js when engine === 'kc'.
 *   Not imported anywhere else. Clean isolation.
 *
 * ============================================================================
 */

const KCBookingIntentDetector = require('./KCBookingIntentDetector');
const KCTransferIntentDetector = require('./KCTransferIntentDetector');
const KCS                     = require('../agent2/KnowledgeContainerService');
const { callLLMAgentForFollowUp } = require('../agent2/Agent2DiscoveryRunner');
const DiscoveryNotesService   = require('../../discoveryNotes/DiscoveryNotesService');
const EngineHubRuntime        = require('../EngineHubRuntime');
const logger                  = require('../../../utils/logger');
const { buildSectionId }      = require('../../../utils/kcHelpers');

// ── UAP Layer 1 + Semantic Match ──────────────────────────────────────────────
const UtteranceActParser      = require('./UtteranceActParser');
const CueExtractorService     = require('../../cueExtractor/CueExtractorService');

// UAP confidence threshold — phrase match must reach this before Logic 2 runs
const UAP_CONFIDENCE_THRESHOLD = 0.80;

// ── Anchor Gate — Two sequential gates. Both must pass. Either failure → Groq. ─
//
// Logic 1 (Anchor Words, <1ms):
//   ≥90% of admin-curated anchor words must appear (exact or stemmed) in the
//   caller's utterance. These are the discriminating words that prove the caller
//   means THIS section, not a competing one with similar vocabulary.
//
// Logic 2 (Core Confirmation, ~50ms):
//   UAP topicWords (free, already computed) → embed → cosine vs section
//   phraseCoreEmbedding (pre-computed at Re-score). Straight ≥0.80 cosine.
//   Confirms the caller's semantic intent aligns with the section's topic.
//
// Phrases with no anchorWords skip both gates (backward compatible).
// Wrong answer = worst outcome. Gate failure → Groq fallback = safe.
const ANCHOR_MATCH_THRESHOLD = 0.90;  // Logic 1: ≥90% of anchor words must match
const CORE_MATCH_THRESHOLD   = 0.80;  // Logic 2: cosine(callerCore, phraseCore) ≥ 0.80

// ── CueExtractor — GATE 2.4 thresholds ──────────────────────────────────────
// fieldCount ≥ this AND tradeMatch present → proceed to GATE 2.4b anchor confirm
const CUE_MIN_FIELD_COUNT   = 3;  // At least 3 of 8 cue fields must be populated
// Anchor confirmation reuses ANCHOR_MATCH_THRESHOLD above

// ============================================================================
// PATH CONSTANTS
// ============================================================================

const PATH = {
  KC_DIRECT_ANSWER:  'KC_DIRECT_ANSWER',   // KC match → Groq answered
  KC_BOOKING_INTENT: 'KC_BOOKING_INTENT',  // Booking signal detected
  KC_LLM_FALLBACK:   'KC_LLM_FALLBACK',   // No KC match → Claude LLM
  KC_GRACEFUL_ACK:   'KC_GRACEFUL_ACK',   // No KC + LLM unavailable
  KC_PFUQ_REASK:     'KC_PFUQ_REASK',     // KC answered follow-up, re-asked booking Q
  // ── Transfer paths ────────────────────────────────────────────────────────
  KC_TRANSFER_INTENT:   'KC_TRANSFER_INTENT',    // Transfer intent detected → transfer executing
  KC_TRANSFER_OVERFLOW: 'KC_TRANSFER_OVERFLOW',  // Transfer intent, destination unavailable → overflow
  // ── Sales funnel paths ────────────────────────────────────────────────────
  KC_PREQUAL_PENDING: 'KC_PREQUAL_PENDING',  // Pre-qualify question asked, waiting for caller answer
  KC_UPSELL_PENDING:  'KC_UPSELL_PENDING',   // Upsell offer sent, waiting for YES / NO
  // ── CueExtractor paths ─────────────────────────────────────────────────────
  KC_CUE_EXTRACT_HIT: 'KC_CUE_EXTRACT_HIT',  // CueExtractor match → routed to KC section
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

/**
 * _stem — Strip common English suffixes so inflected forms match their root.
 *
 * Covers the vast majority of caller speech variation without any library:
 *   weekends   → weekend   (plural)
 *   services   → service   (plural)
 *   scheduled  → schedule  (past tense)
 *   scheduling → schedule  (gerund)
 *   installer  → install   (agent noun)
 *   pricing    → price     (gerund)
 *
 * Order matters — longer suffixes stripped first to avoid double-stripping.
 * Applied to BOTH admin anchor words and caller utterance words before compare.
 */
function _stem(word) {
  return word
    .replace(/ings?$/,  '')   // scheduling → schedul, bookings → booking — wait, strip 'ings' then check
    .replace(/ing$/,    '')   // scheduling → schedul
    .replace(/ations?$/, '')  // installation → install
    .replace(/ers?$/,   '')   // installer → install, installers → install
    .replace(/ed$/,     '')   // scheduled → schedul
    .replace(/ly$/,     '')   // currently → current
    .replace(/ies$/,    'y')  // warranties → warranty
    .replace(/ves$/,    'f')  // leaves → leaf (minor, rarely needed)
    .replace(/s$/,      '');  // weekends → weekend, services → service
}

/** Clip a string to maxLen characters for safe logging. */
function _clip(str, maxLen = 80) {
  if (!str) return '';
  return str.length <= maxLen ? str : `${str.slice(0, maxLen)}…`;
}

/**
 * _cueScanPhrases — GATE 2.4c Cue Profile Scan
 *
 * When CueExtractor has a strong cue signal (fieldCount >= 3) but no trade
 * match (single-trade company, generic question), scan all callerPhrases
 * across KC cards to find the best section match using cue pattern overlap.
 *
 * Each extracted cue pattern (e.g., "do i have to", "how much is", "pay")
 * is checked as a substring against each callerPhrase text. The phrase
 * with the most cue overlaps is the best match.
 *
 * Minimum 2 cue overlaps required for confidence.
 *
 * @param {Object}   cueFrame            — extract() result with 7 cue fields
 * @param {Array}    scorableContainers  — loaded KC containers with sections + callerPhrases
 * @param {string}   userInput           — raw caller utterance (for anchor confirmation)
 * @returns {Object|null} { container, sectionIdx, section, phraseText, cueOverlap } or null
 */
function _cueScanPhrases(cueFrame, scorableContainers, userInput) {
  const { CUE_FIELDS } = CueExtractorService;

  // Collect non-null cue values as search patterns
  const activeCues = [];
  for (const field of CUE_FIELDS) {
    if (cueFrame[field]) activeCues.push({ field, pattern: cueFrame[field] });
  }
  if (activeCues.length < 2) return null;

  let bestMatch  = null;
  let bestScore  = 0;

  for (const container of scorableContainers) {
    const sections = container.sections || [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];
      if (section.isActive === false) continue;

      for (const phrase of (section.callerPhrases || [])) {
        const lower = (phrase.text || '').toLowerCase();
        if (!lower || lower.length < 5) continue;

        let score = 0;
        for (const { pattern } of activeCues) {
          if (lower.includes(pattern)) score++;
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            container,
            sectionIdx:  sIdx,
            section,
            phraseText:  phrase.text,
            anchorWords: phrase.anchorWords || [],
            cueOverlap:  score,
          };
        }
      }
    }
  }

  // Require at least 2 cue pattern matches for confidence
  if (!bestMatch || bestScore < 2) return null;

  // ── Anchor confirmation — same Logic 1 as GATE 2.4b ──────────────────
  if (bestMatch.anchorWords.length > 0) {
    const rawWords = (userInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const inputStems = new Set(rawWords.map(_stem));
    const inputExact = new Set(rawWords);

    const anchors = bestMatch.anchorWords.map(w => (w || '').toLowerCase().trim()).filter(Boolean);
    const hits    = anchors.filter(aw => inputExact.has(aw) || inputStems.has(_stem(aw))).length;
    const ratio   = hits / anchors.length;

    if (ratio < ANCHOR_MATCH_THRESHOLD) {
      // Anchor check failed — but check if ANY phrase in this section passes
      const sectionPhrases = (bestMatch.section.callerPhrases || []).filter(p =>
        p.anchorWords && p.anchorWords.length > 0
      );
      const anyAnchorPass = sectionPhrases.some(p => {
        const a = (p.anchorWords || []).map(w => (w || '').toLowerCase().trim()).filter(Boolean);
        if (a.length === 0) return false;
        const h = a.filter(aw => inputExact.has(aw) || inputStems.has(_stem(aw))).length;
        return (h / a.length) >= ANCHOR_MATCH_THRESHOLD;
      });
      if (!anyAnchorPass) return null;  // section anchor check failed
    }
  }

  return bestMatch;
}

// ── Section pre-filter constants ─────────────────────────────────────────────
const GAP_MAX_SECTIONS = 5;  // max sections sent to Groq on section gap

/**
 * _scoreSectionsForGap — Pre-filter for KC_SECTION_GAP path
 *
 * When a container matched but no section was targeted, we need to narrow
 * 200+ sections down to the most relevant handful before handing to Groq.
 *
 * Scoring per section:
 *   - callerPhrase word overlap (best phrase wins):  phrase word hits × 3
 *   - contentKeywords overlap:                       keyword hits × 2
 *   - label word overlap:                            label word hits × 4
 *   - negativeKeyword penalty:                       -1000 (disqualify)
 *   - cueFrame pattern substring in callerPhrase:    +2 per cue hit
 *
 * Returns the top GAP_MAX_SECTIONS sections, each decorated with _gapScore.
 * Returns [] if no section scores above 0.
 *
 * @param {Array}   sections   — container.sections (full array)
 * @param {string}  userInput  — raw caller utterance
 * @param {Object}  cueFrame   — CueExtractor output (may be null)
 * @returns {Array<Object>}    — top sections (shallow copies with _gapScore)
 */
function _scoreSectionsForGap(sections, userInput, cueFrame) {
  if (!sections || sections.length === 0 || !userInput) return [];

  const inputLower = (userInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const inputWords = new Set(inputLower.split(/\s+/).filter(w => w.length >= 3));
  const inputStems = new Set([...inputWords].map(_stem));

  // Collect active cue patterns for bonus scoring
  const cuePatterns = [];
  if (cueFrame) {
    const { CUE_FIELDS } = CueExtractorService;
    for (const field of CUE_FIELDS) {
      if (cueFrame[field]) cuePatterns.push(cueFrame[field]);
    }
  }

  const scored = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section.isActive === false) continue;

    let score = 0;

    // ── Negative keyword exclusion ──
    const negKws = section.negativeKeywords || [];
    const negHit = negKws.some(nk => {
      const nkLower = (nk || '').toLowerCase().trim();
      return nkLower && inputLower.includes(nkLower);
    });
    if (negHit) continue;  // disqualified

    // ── Label word overlap (×4) ──
    const labelWords = (section.label || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
    for (const lw of labelWords) {
      if (inputWords.has(lw) || inputStems.has(_stem(lw))) score += 4;
    }

    // ── callerPhrase word overlap (best phrase × 3) ──
    let bestPhraseScore = 0;
    for (const phrase of (section.callerPhrases || [])) {
      const phraseWords = (phrase.text || phrase || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
      if (phraseWords.length === 0) continue;

      let hits = 0;
      for (const pw of phraseWords) {
        if (inputWords.has(pw) || inputStems.has(_stem(pw))) hits++;
      }
      // Normalize by phrase length so short phrases don't auto-win
      const phraseScore = hits;
      if (phraseScore > bestPhraseScore) bestPhraseScore = phraseScore;
    }
    score += bestPhraseScore * 3;

    // ── contentKeywords overlap (×2) ──
    for (const kw of (section.contentKeywords || [])) {
      const kwLower = (kw || '').toLowerCase().trim();
      if (!kwLower) continue;
      // contentKeywords can be bigrams — check substring
      if (inputLower.includes(kwLower)) score += 2;
    }

    // ── Cue pattern bonus: cue patterns found in callerPhrases (+2 each) ──
    if (cuePatterns.length > 0) {
      for (const phrase of (section.callerPhrases || [])) {
        const phraseLower = (phrase.text || phrase || '').toLowerCase();
        for (const pattern of cuePatterns) {
          if (phraseLower.includes(pattern)) { score += 2; break; }  // 1 bonus per pattern
        }
      }
    }

    if (score > 0) {
      scored.push({ section, index: i, _gapScore: score });
    }
  }

  // Sort descending by score, take top N
  scored.sort((a, b) => b._gapScore - a._gapScore);
  return scored.slice(0, GAP_MAX_SECTIONS);
}

/**
 * _buildContextBrief — Build the warm-transfer agent whisper brief.
 *
 * Spoken to the RECEIVING agent before the caller is connected (Twilio whisper).
 * Uses the destination's summaryTemplate if set; falls back to a compact default.
 *
 * Template variables: {callerName}, {callReason}, {urgency}
 *
 * @param {Object|null} dnotes  — discoveryNotes (may be null on first turn)
 * @param {Object}      dest    — TransferDestination lean object
 * @param {string}      urgency — 'high' | 'normal' from KCTransferIntentDetector
 * @returns {string}
 */
function _buildContextBrief(dnotes, dest, urgency) {
  const t           = dnotes?.temp || {};
  const callerName  = [t.firstName, t.lastName].filter(Boolean).join(' ') || null;
  const callReason  = t.callReason || dnotes?.callReason || null;
  const urgencyStr  = urgency || t.urgency || 'normal';
  const template    = dest?.transferContext?.summaryTemplate || '';

  if (template) {
    return template
      .replace(/\{callerName\}/g, callerName || 'the caller')
      .replace(/\{callReason\}/g,  callReason  || 'unspecified reason')
      .replace(/\{urgency\}/g,     urgencyStr)
      .trim();
  }

  // Default compact brief
  const parts = ['Incoming transfer'];
  if (callerName)          parts.push(`from ${callerName}`);
  if (callReason)          parts.push(`— ${callReason}`);
  if (urgencyStr === 'high') parts.push('(urgent)');
  return parts.join(' ') + '.';
}

/**
 * Build a KC trace metadata object for call intelligence.
 * Carries KC-specific context (containerId, intent, latencyMs, etc.)
 * that the Call Intelligence UI uses to display the KC engine block.
 *
 * UAP replaced 123rp as the routing protocol — tier/tierLabel/source
 * are no longer included. matchSource on the return object identifies
 * the engine; kcTrace carries the KC-specific per-turn context.
 */
function _buildKcTrace(path, extra = {}) {
  const trace = { path, ...extra };
  // Auto-compute sectionId when kcId + sectionIdx are both present
  if (trace.kcId && trace.sectionIdx != null && !trace.sectionId) {
    trace.sectionId = buildSectionId(trace.kcId, trace.sectionIdx);
  }
  return trace;
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
   * @returns {Promise<{ response: string, matchSource: string, state: Object, kcTrace: Object }>}
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

        // ── Load policy + active destinations + discoveryNotes (all Redis-cached) ──
        const [policy, destinations, dnotes] = await Promise.all([
          TransferPolicy.getForCompany(companyId).catch(() => null),
          TransferDestination.findActiveForCompany(companyId).catch(() => []),
          DiscoveryNotesService.load(companyId, callSid).catch(() => null),
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
            kcTrace:     _buildKcTrace(PATH.KC_TRANSFER_OVERFLOW, {
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
            // Warm-transfer agent whisper brief — built from discoveryNotes + summaryTemplate
            contextBrief:  _buildContextBrief(dnotes, bestDest, hint.urgency),
            // Overflow config — v2twilio uses this if the dial fails
            overflowAction:  bestDest.overflow?.action || policy?.defaultOverflowAction || 'voicemail',
            overflowMessage: bestDest.overflow?.message || policy?.defaultOverflowMessage || null,
          };

          nextState.agent2              = nextState.agent2 || {};
          nextState.agent2.discovery    = nextState.agent2.discovery || {};
          nextState.agent2.discovery.lastPath = PATH.KC_TRANSFER_INTENT;

          // ── discoveryNotes: mark TRANSFER + lock in staffMentioned ───────────
          _writeDiscoveryNotes(companyId, callSid, {
            objective:  'TRANSFER',
            turnNumber: turn ?? 0,
            ...(callerName ? { entities: { firstName: callerName } } : {}),
            temp: {
              // Named-person transfers: "I want Mike" → staffMentioned persists for
              // callHistory, relationship tracking, and CallerRecognition next call.
              staffMentioned: hint.personName
                || (bestDest.type === 'agent' ? bestDest.name : null),
            },
          }).catch(() => {});

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
            kcTrace:     _buildKcTrace(PATH.KC_TRANSFER_INTENT, {
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
    // GATE 0.7 — PENDING PRE-QUALIFY OR UPSELL STATE
    // ══════════════════════════════════════════════════════════════════════════
    // Fires after transfer check, before booking intent or KC scoring.
    // If a prior turn left a pending pre-qualify question or upsell offer for
    // this call, the caller's current utterance is the ANSWER to that — route
    // to the dedicated handler before any other gate processes the input.
    //
    // Redis keys (TTL 4h — matches discoveryNotes):
    //   kc-prequal:{companyId}:{callSid}  → set by GATE 3.5, cleared on answer
    //   kc-upsell:{companyId}:{callSid}   → set by GATE 4.5, cleared when chain exhausted
    //
    // GRACEFUL DEGRADE: redis=null or any error → falls through to GATE 1.
    // ══════════════════════════════════════════════════════════════════════════
    if (redis) {
      try {
        const [_pqRaw, _upRaw] = await Promise.all([
          redis.get(`kc-prequal:${companyId}:${callSid}`).catch(() => null),
          redis.get(`kc-upsell:${companyId}:${callSid}`).catch(() => null),
        ]);

        if (_pqRaw) {
          logger.info('[KC_ENGINE] 🎯 GATE 0.7: Pending pre-qualify — routing to handler', {
            companyId, callSid, turn,
          });
          return await _handlePrequalResponse({
            companyId, callSid, userInput, redis,
            pendingPrequal: _pqRaw,
            emit, nextState, startMs, turn, company, kbSettings, callerName,
          });
        }

        if (_upRaw) {
          logger.info('[KC_ENGINE] 💰 GATE 0.7: Pending upsell — routing to handler', {
            companyId, callSid, turn,
          });
          return await _handleUpsellResponse({
            companyId, callSid, userInput, redis,
            pendingUpsell: _upRaw,
            emit, nextState, startMs, turn, company,
          });
        }
      } catch (_gate07Err) {
        // Non-fatal — fall through to GATE 1
        logger.warn('[KC_ENGINE] GATE 0.7 error — falling through', {
          companyId, callSid, err: _gate07Err.message,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 1 — BOOKING INTENT CHECK  (~0ms, synchronous)
    // ══════════════════════════════════════════════════════════════════════════
    // Only fires on PURE booking signals. If the caller's utterance also
    // contains a question ("yeah but do you offer maintenance?"), the question
    // takes priority — answer it first, let Groq's closingPrompt naturally
    // re-offer booking.
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
    let _inputHasQuestion = (userInput || '').includes('?') ||
      /\b(what|how|why|when|which|where|does|do you|can you|can we|we can|is it|is there|is that|include|cover|tell me|explain|about|more|offer|know|wondering|possible|add|also|and also)\b/.test(_norm);

    // ── Hedged-yes override: "Yes, I would... if that's possible" is a
    // confirmation with hedging, not a real question. When the caller LEADS
    // with an affirmative (first meaningful word is yes/yeah/sure/okay/etc.)
    // and question words appear only AFTER, treat it as a pure booking signal.
    // This catches: "Yes, if that's possible", "Yeah I'd like that, is that okay",
    //               "Sure, um, if you can"
    // Does NOT override: "Is it possible to schedule?" (question-first),
    //                    "What about scheduling?" (no leading affirmative)
    if (_inputHasQuestion && !(userInput || '').includes('?')) {
      const _normCollapsed = _norm.replace(/\s+/g, ' ');
      const LEADING_AFFIRMATIVES = /^(?:(?:um|uh|well|so|and|oh|like) )*(?:yes|yeah|yep|yup|sure|ok|okay|alright|absolutely|definitely|of course|for sure|sounds good|go ahead|please|i(?:'d| would) (?:like|love))/;
      if (LEADING_AFFIRMATIVES.test(_normCollapsed)) {
        _inputHasQuestion = false;
      }
    }

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

      const bookingResponse = "Great! Let me get that scheduled for you.";

      return {
        response:    bookingResponse,
        matchSource: 'KC_ENGINE',
        state:       nextState,
        kcTrace:     _buildKcTrace(PATH.KC_BOOKING_INTENT, { latencyMs: Date.now() - startMs }),
      };
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2+3 — PARALLEL LOAD: Notes + Containers + Rejected IDs
    // ══════════════════════════════════════════════════════════════════════════
    // 3 data sources fire concurrently. Utterance embedding is intentionally
    // NOT here — it fires only on keyword miss so the happy path (keyword hit)
    // has zero embedding latency. Net latency of this Promise.all ≈ 2ms (all
    // Redis/cache). Container embeddings load from Redis cache (1ms) so they
    // are pre-fetched and ready if we need them.
    //
    // Topic persistence: discoveryNotes.anchorContainerId + 3× score multiplier
    // + ANCHOR_FLOOR=24 in findContainer() handles follow-up turns naturally.
    // ══════════════════════════════════════════════════════════════════════════

    let notes               = null;
    let containers          = [];
    let rejectedContainerIds = new Set();   // IDs caller has explicitly rejected this call

    try {
      const _rejKey = `kc-rejected:${companyId}:${callSid}`;
      let _rejRaw;
      [notes, containers, _rejRaw] = await Promise.all([
        DiscoveryNotesService.load(companyId, callSid).catch(() => null),
        KCS.getActiveForCompany(companyId).catch((_e) => {
          logger.warn('[KC_ENGINE] Failed to load containers', { companyId, callSid, err: _e.message });
          return [];
        }),
        redis ? redis.get(_rejKey).catch(() => null) : Promise.resolve(null),
      ]);
      if (_rejRaw) {
        try { rejectedContainerIds = new Set(JSON.parse(_rejRaw)); } catch (_) {}
      }
    } catch (_e) {
      containers = containers || [];
    }

    // ── Engine Hub Runtime — load config from company document (sync, ~0ms) ──
    const ehConfig = EngineHubRuntime.load(company);
    if (ehConfig) {
      EngineHubRuntime.logTrace(companyId, callSid, 'EH_ACTIVE', {
        mode:              ehConfig.mode,
        confidenceThresh:  ehConfig.intentDetection.confidenceThreshold,
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

    // ══════════════════════════════════════════════════════════════════════════
    // REJECTION DETECTOR — fires before container scoring
    // ══════════════════════════════════════════════════════════════════════════
    // When the caller explicitly rejects the previous answer ("no, that's not
    // what I asked") AND we have an anchored container from discoveryNotes,
    // add it to the rejected set so it's excluded from scoring this call.
    // Also write the title to discoveryNotes.rejectedTopics[] so Groq/LLM
    // knows what NOT to repeat. Clear the anchor to allow fresh matching.
    // ══════════════════════════════════════════════════════════════════════════

    // Phrases that signal explicit rejection of the previous answer.
    // Anchored to start-of-utterance (^) to avoid false matches on:
    //   "I know that's not right but…" (contains 'not' but not a rejection opener)
    const _REJECTION_RE = /^(no[,!.\s]|nope[,!.\s]|that'?s?\s+not|it'?s?\s+not|that\s+is\s+not|i\s+said|i\s+don'?t\s+need|i\s+didn'?t\s+ask|i\s+am\s+not\s+(asking|calling|looking)|i'?m\s+not\s+(asking|calling|looking)|wrong\b|not\s+(a|an|the|that|what|this|it)\b)/i;

    const _anchorId = notes?.anchorContainerId ? String(notes.anchorContainerId) : null;

    if (_anchorId && _REJECTION_RE.test((userInput || '').trim())) {
      const _rejectedContainer = containers.find(c => String(c._id || '') === _anchorId);
      const _rejectedTitle = _rejectedContainer?.title || '';

      logger.info('[KC_ENGINE] 🚫 REJECTION DETECTED — clearing anchor', {
        companyId, callSid, turn,
        rejectedContainer: _rejectedTitle,
        inputPreview: _clip(userInput, 60),
      });
      emit('KC_REJECTION_DETECTED', {
        companyId, callSid, turn,
        rejectedContainer: _rejectedTitle,
      });

      rejectedContainerIds.add(_anchorId);
      // Persist rejected list for this call (4h TTL — matches discoveryNotes)
      if (redis) {
        const _rk = `kc-rejected:${companyId}:${callSid}`;
        redis.setex(_rk, 4 * 3600, JSON.stringify([...rejectedContainerIds])).catch(() => {});
      }
      // Write rejected topic name to discoveryNotes so Groq/LLM knows to avoid it
      // Also clear the anchor — caller has explicitly rejected it
      if (_rejectedTitle) {
        _writeDiscoveryNotes(companyId, callSid, {
          rejectedTopics:    [_rejectedTitle],
          anchorContainerId: null,
        }).catch(() => {});
      } else {
        _writeDiscoveryNotes(companyId, callSid, {
          anchorContainerId: null,
        }).catch(() => {});
      }
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
    const callContext      = notes ? {
      callReason:        notes.callReason,
      anchorContainerId: notes.anchorContainerId || null,  // 3× multiplier applied in findContainer()
    } : null;

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

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2.4 — CUE EXTRACTOR — 8-field pattern match (<1ms)
    // ══════════════════════════════════════════════════════════════════════════
    // Extracts 8 structured cue fields from the caller utterance using pure
    // string matching: requestCue, permissionCue, infoCue, directiveCue,
    // actionCore, urgencyCore, modifierCore, tradeCore (via section tradeTerms).
    //
    // Always writes cueFrame to discoveryNotes (enrichment for downstream + Groq).
    //
    // GATE 2.4b routing condition:
    //   fieldCount >= CUE_MIN_FIELD_COUNT (3) AND tradeMatches has at least one
    //   hit → hydrate container + section → route directly.
    //
    // GRACEFUL DEGRADE: Any error → fall through to GATE 2.5 (UAP unchanged).
    // ══════════════════════════════════════════════════════════════════════════

    let match = null;
    let cueFrame = null;

    try {
      cueFrame = await CueExtractorService.extract(companyId, userInput);

      // Always write cueFrame to discoveryNotes (fire-and-forget enrichment)
      _writeDiscoveryNotes(companyId, callSid, { cueFrame }).catch(() => {});

      if (cueFrame.fieldCount >= CUE_MIN_FIELD_COUNT && cueFrame.tradeMatches.length > 0) {
        // ── GATE 2.4b — Route via best trade match ───────────────────────
        // First trade match wins (CueExtractor sorts longest-first).
        const bestTrade = cueFrame.tradeMatches[0];
        const fullContainer = scorableContainers.find(c =>
          String(c._id || '') === bestTrade.containerId
        );

        if (fullContainer) {
          // sectionIdx = -1 means container-level vocab link (no section targeting)
          const isContainerLevel = bestTrade.sectionIdx === -1;
          const targetSection = isContainerLevel
            ? null
            : (fullContainer.sections?.[bestTrade.sectionIdx] || null);

          // ── Anchor confirmation (GATE 2.4b) ──────────────────────────
          // For container-level trade matches (global vocab): skip anchor
          // check — the field count + trade match is sufficient signal.
          // Groq reads all sections and synthesizes the answer.
          //
          // For section-level trade matches (custom tradeTerms): check if
          // ≥90% of any matching phrase's anchorWords appear in utterance.
          let anchorConfirmed = true;  // default: trust cue extraction
          if (targetSection) {
            const sectionPhrases = targetSection.callerPhrases || [];
            const phrasesWithAnchors = sectionPhrases.filter(p =>
              p.anchorWords && p.anchorWords.length > 0
            );

            if (phrasesWithAnchors.length > 0) {
              const rawWords = (userInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
              const inputStems = new Set(rawWords.map(_stem));
              const inputExact = new Set(rawWords);

              anchorConfirmed = phrasesWithAnchors.some(phrase => {
                const anchors = (phrase.anchorWords || []).map(w => (w || '').toLowerCase().trim()).filter(Boolean);
                if (anchors.length === 0) return false;
                const hits = anchors.filter(aw => inputExact.has(aw) || inputStems.has(_stem(aw))).length;
                return (hits / anchors.length) >= ANCHOR_MATCH_THRESHOLD;
              });
            }
          }

          if (anchorConfirmed) {
            logger.info('[KC_ENGINE] CUE EXTRACT HIT — GATE 2.4b confirmed', {
              companyId, callSid, turn,
              fieldCount:      cueFrame.fieldCount,
              tradeTerm:       bestTrade.term,
              containerId:     bestTrade.containerId,
              sectionIdx:      bestTrade.sectionIdx,
              sectionLabel:    bestTrade.sectionLabel || '(container-level)',
              requestCue:      cueFrame.requestCue || null,
              actionCore:      cueFrame.actionCore || null,
              urgencyCore:     cueFrame.urgencyCore || null,
            });
            emit('KC_CUE_EXTRACT_HIT', {
              companyId, callSid, turn,
              fieldCount:   cueFrame.fieldCount,
              tradeTerm:    bestTrade.term,
              containerId:  bestTrade.containerId,
              sectionIdx:   bestTrade.sectionIdx,
            });

            match = {
              container:        fullContainer,
              score:            Math.round((cueFrame.fieldCount / 8) * 100),
              matchSource:      'CUE_EXTRACT',
              cueFrame,
              targetSection,                                      // null for container-level → Groq reads all sections
              targetSectionIdx: isContainerLevel ? null : bestTrade.sectionIdx,
            };
          } else {
            logger.info('[KC_ENGINE] CUE EXTRACT — GATE 2.4b anchor fail, falling through', {
              companyId, callSid, turn,
              fieldCount:   cueFrame.fieldCount,
              tradeTerm:    bestTrade.term,
              sectionLabel: bestTrade.sectionLabel,
            });
          }
        }
      } else if (cueFrame.fieldCount >= CUE_MIN_FIELD_COUNT && cueFrame.tradeMatches.length === 0) {
        // ── Strong cue signal but NO trade match ─────────────────────────
        // Two paths:
        //   A) Single-trade company → trade is implicit, scan callerPhrases by cue overlap
        //   B) Multi-trade company  → can't determine which trade → log for downstream

        if (cueFrame.isSingleTrade) {
          // ── PATH A: Single-trade — cue profile scan (GATE 2.4c) ──────
          const cueScan = _cueScanPhrases(cueFrame, scorableContainers, userInput);
          if (cueScan) {
            logger.info('[KC_ENGINE] CUE PROFILE SCAN HIT — GATE 2.4c confirmed', {
              companyId, callSid, turn,
              fieldCount:    cueFrame.fieldCount,
              phraseText:    _clip(cueScan.phraseText, 60),
              cueOverlap:    cueScan.cueOverlap,
              containerId:   String(cueScan.container._id || ''),
              sectionIdx:    cueScan.sectionIdx,
              sectionLabel:  cueScan.section?.label || '',
            });
            emit('KC_CUE_PROFILE_SCAN_HIT', {
              companyId, callSid, turn,
              fieldCount:   cueFrame.fieldCount,
              cueOverlap:   cueScan.cueOverlap,
              containerId:  String(cueScan.container._id || ''),
              sectionIdx:   cueScan.sectionIdx,
            });

            match = {
              container:        cueScan.container,
              score:            Math.round((cueFrame.fieldCount / 8) * 100),
              matchSource:      'CUE_PROFILE_SCAN',
              cueFrame,
              targetSection:    cueScan.section,
              targetSectionIdx: cueScan.sectionIdx,
            };
          } else {
            logger.debug('[KC_ENGINE] CUE PROFILE SCAN — no phrase match (single-trade), falling through', {
              companyId, callSid, turn, fieldCount: cueFrame.fieldCount,
            });
          }
        } else {
          // ── PATH B: Multi-trade — no trade match = ambiguous trade ────
          // Log for awareness. Downstream gates (UAP, semantic, keyword) may still route.
          // Future: if ALL downstream gates also miss, this info enables a trade-clarification response.
          logger.info('[KC_ENGINE] CUE EXTRACT — multi-trade, no trade match', {
            companyId, callSid, turn,
            fieldCount:      cueFrame.fieldCount,
            companyTradeKeys: cueFrame.companyTradeKeys,
            requestCue:      cueFrame.requestCue || null,
            actionCore:      cueFrame.actionCore || null,
          });
        }
      } else if (cueFrame.fieldCount > 0) {
        logger.debug('[KC_ENGINE] CUE EXTRACT — enrichment only (fieldCount=%d, tradeMatches=%d)',
          cueFrame.fieldCount, cueFrame.tradeMatches.length, {
            companyId, callSid, turn,
        });
      }
    } catch (_cueErr) {
      logger.warn('[KC_ENGINE] CUE EXTRACT error — falling through to GATE 2.5', {
        companyId, callSid, err: _cueErr.message,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2.5 — UAP LAYER 1 — Zero-latency phrase match  (<1ms)
    // ══════════════════════════════════════════════════════════════════════════
    // UtteranceActParser matches caller utterance against section.callerPhrases
    // (indexed via BridgeService phraseIndex, cached in Redis).
    //
    // UAP confidence ≥ 0.8 → containerId + sectionIdx resolved directly.
    // UAP confidence  < 0.8 → fall through to Gate 2.8 (semantic) then Gate 3.
    //
    // GRACEFUL DEGRADE: Any UAP error returns NONE (confidence=0) → next gate.
    // ══════════════════════════════════════════════════════════════════════════

    let uapResult = null;

    // Only fire UAP if CueExtractor (GATE 2.4) didn't already resolve a match
    if (!match) try {
      uapResult = await UtteranceActParser.parse(companyId, userInput);

      if (uapResult.containerId && uapResult.confidence >= UAP_CONFIDENCE_THRESHOLD) {
        logger.info('[KC_ENGINE] UAP Layer 1 HIT', {
          companyId, callSid, turn,
          containerId:   uapResult.containerId,
          sectionIdx:    uapResult.sectionIdx,
          sectionLabel:  uapResult.sectionLabel,
          confidence:    uapResult.confidence,
          matchType:     uapResult.matchType,
          matchedPhrase: uapResult.matchedPhrase,
        });
        emit('KC_UAP_HIT', {
          companyId, callSid, turn,
          containerId: uapResult.containerId,
          sectionIdx:  uapResult.sectionIdx,
          confidence:  uapResult.confidence,
          matchType:   uapResult.matchType,
        });

        // Hydrate — find the full container from our already-loaded scorable list
        const fullContainer = scorableContainers.find(c =>
          String(c._id || '') === uapResult.containerId
        );

        if (fullContainer) {
          const targetSection = fullContainer.sections?.[uapResult.sectionIdx] || null;

          // ══════════════════════════════════════════════════════════════════
          // ANCHOR GATE — Two sequential gates. Both must pass.
          //
          // Logic 1 (Word Gate, <1ms):
          //   ≥90% of admin-curated anchor words must appear (exact or stemmed)
          //   in the caller's utterance. Anchor words are the discriminators —
          //   the words that PROVE the caller means THIS section, not a
          //   competing one with similar vocabulary.
          //
          // Logic 2 (Core Confirmation, ~50ms):
          //   UAP's topicWords (already computed, free) → embed → cosine vs
          //   section phraseCoreEmbedding (pre-computed at Re-score). ≥0.80
          //   confirms the caller's semantic intent matches the section's topic.
          //
          // Phrases with empty anchorWords[] skip both gates (backward compat).
          // Wrong answer = worst outcome. Gate failure → Groq fallback = safe.
          // ══════════════════════════════════════════════════════════════════
          const anchorWords = uapResult.anchorWords || [];  // already normalised by UAP
          let anchorGatePassed = true;

          if (anchorWords.length > 0) {
            const rawWords = (userInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

            // ── LOGIC 1 — Word Gate ────────────────────────────────────────
            // Ratio-based: count how many anchor words are present (exact or stemmed)
            const inputStems   = new Set(rawWords.map(_stem));
            const inputExact   = new Set(rawWords);
            const anchorHits   = anchorWords.filter(aw => inputExact.has(aw) || inputStems.has(_stem(aw))).length;
            const anchorRatio  = anchorHits / anchorWords.length;

            if (anchorRatio < ANCHOR_MATCH_THRESHOLD) {
              // ── LOGIC 1 FAIL — discriminating words missing → Groq ──
              anchorGatePassed = false;
              logger.info('[KC_ENGINE] LOGIC 1 FAIL — anchor words missing, falling through to Groq', {
                companyId, callSid, turn,
                anchorWords,
                anchorHits,
                anchorRatio: Math.round(anchorRatio * 100) + '%',
                threshold:   Math.round(ANCHOR_MATCH_THRESHOLD * 100) + '%',
                sectionLabel: targetSection?.label,
              });
            } else {
              // ── LOGIC 1 PASS — proceed to Logic 2 ──
              logger.info('[KC_ENGINE] LOGIC 1 PASS — anchor words confirmed', {
                companyId, callSid, turn,
                anchorWords,
                anchorHits,
                anchorRatio: Math.round(anchorRatio * 100) + '%',
                matchType:   uapResult.matchType,
                sectionLabel: targetSection?.label,
              });

              // ── LOGIC 2 — Core Confirmation ──────────────────────────────
              // UAP topicWords (free) → embed → cosine vs phraseCoreEmbedding.
              // If phraseCoreEmbedding absent (Re-score not yet run) → skip
              // Logic 2, route on Logic 1 alone (backward compatible).
              try {
                const SemanticMatchService      = require('./SemanticMatchService');
                const CompanyKnowledgeContainer = require('../../../models/CompanyKnowledgeContainer');

                const callerCore = (uapResult.topicWords || []).join(' ');
                if (callerCore) {
                  // Embed caller core + load section phraseCoreEmbedding in parallel
                  const [callerCoreEmb, secDoc] = await Promise.all([
                    SemanticMatchService.embed(callerCore),
                    CompanyKnowledgeContainer.findById(uapResult.containerId)
                      .select('+sections.phraseCoreEmbedding')
                      .lean(),
                  ]);

                  const phraseCoreEmb = secDoc?.sections?.[uapResult.sectionIdx]?.phraseCoreEmbedding;

                  if (callerCoreEmb?.length && phraseCoreEmb?.length) {
                    // Cosine similarity
                    let dot = 0, ma = 0, mb = 0;
                    for (let _i = 0; _i < callerCoreEmb.length; _i++) {
                      dot += callerCoreEmb[_i] * phraseCoreEmb[_i];
                      ma  += callerCoreEmb[_i] * callerCoreEmb[_i];
                      mb  += phraseCoreEmb[_i] * phraseCoreEmb[_i];
                    }
                    const coreScore = (ma && mb) ? dot / (Math.sqrt(ma) * Math.sqrt(mb)) : 0;

                    logger.info('[KC_ENGINE] LOGIC 2 scored', {
                      companyId, callSid, turn,
                      callerCore:  callerCore.slice(0, 60),
                      coreScore:   Math.round(coreScore * 100) / 100,
                      threshold:   CORE_MATCH_THRESHOLD,
                      pass:        coreScore >= CORE_MATCH_THRESHOLD,
                      sectionLabel: targetSection?.label,
                    });

                    if (coreScore < CORE_MATCH_THRESHOLD) {
                      anchorGatePassed = false;
                      logger.info('[KC_ENGINE] LOGIC 2 FAIL — core mismatch, falling through to Groq', {
                        companyId, callSid, turn,
                        coreScore: Math.round(coreScore * 100) / 100,
                        threshold: CORE_MATCH_THRESHOLD,
                      });
                    }
                  }
                  // phraseCoreEmbedding absent → skip Logic 2, route on Logic 1 alone
                }
              } catch (_l2Err) {
                logger.warn('[KC_ENGINE] Logic 2 error — routing on Logic 1 alone', {
                  companyId, callSid, err: _l2Err.message,
                });
              }
            }
          }

          if (anchorGatePassed) {
            match = {
              container:        fullContainer,
              score:            Math.round(uapResult.confidence * 100),
              matchSource:      'UAP_LAYER1',
              uapResult,
              targetSection,
              targetSectionIdx: uapResult.sectionIdx,
            };

            logger.info('[KC_ENGINE] UAP resolved container + section (anchor gate confirmed)', {
              companyId, callSid, turn,
              containerTitle: fullContainer.title,
              sectionLabel:   targetSection?.label || '(all)',
              confidence:     uapResult.confidence,
              anchorGate:     anchorWords.length ? 'L1+L2 passed' : 'n/a',
            });
          }
        }

        // Log to discoveryNotes qaLog (diagnostic, fire-and-forget)
        _writeDiscoveryNotes(companyId, callSid, {
          qaLog: [{
            type:       'UAP_LAYER1',
            containerId: uapResult.containerId,
            kcId:        uapResult.kcId || null,
            sectionIdx:  uapResult.sectionIdx,
            sectionId:   buildSectionId(uapResult.kcId, uapResult.sectionIdx),
            confidence:  uapResult.confidence,
            matchType:   uapResult.matchType,
            phrase:      uapResult.matchedPhrase,
            hit:         !!match,
            turn:        turn ?? 0,
          }],
        }).catch(() => {});

      } else if (uapResult.containerId) {
        logger.debug('[KC_ENGINE] UAP Layer 1 below threshold — next gate', {
          companyId, callSid, turn,
          containerId: uapResult.containerId,
          confidence:  uapResult.confidence,
          matchType:   uapResult.matchType,
          threshold:   UAP_CONFIDENCE_THRESHOLD,
        });

        // Log fuzzy recovery attempts so calibration dashboard can track them
        if (uapResult.matchType === 'SYNONYM' || uapResult.matchType === 'FUZZY_PHONETIC') {
          _writeDiscoveryNotes(companyId, callSid, {
            qaLog: [{
              type:          'UAP_LAYER1',
              containerId:   uapResult.containerId,
              kcId:          uapResult.kcId || null,
              sectionIdx:    uapResult.sectionIdx,
              sectionId:     buildSectionId(uapResult.kcId, uapResult.sectionIdx),
              confidence:    uapResult.confidence,
              matchType:     uapResult.matchType,
              phrase:        uapResult.matchedPhrase,
              hit:           false,
              fuzzyRecovery: true,
              turn:          turn ?? 0,
            }],
          }).catch(() => {});
        }
      }
    } catch (_uapErr) {
      logger.warn('[KC_ENGINE] UAP Layer 1 error — falling through', {
        companyId, callSid, err: _uapErr.message,
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2.8 — SEMANTIC MATCH — Embedding similarity  (~50ms)
    // ══════════════════════════════════════════════════════════════════════════
    // When UAP phrase match misses, compare the caller's utterance embedding
    // against section.callerPhrases[].embedding + section.contentEmbedding.
    // Only fires if OPENAI_API_KEY is set. Falls through to Gate 3 on miss.
    // ══════════════════════════════════════════════════════════════════════════
    if (!match) {
      try {
        const SemanticMatchService = require('./SemanticMatchService');
        // Load containers with embeddings for semantic comparison
        const ContainerModel = require('../../../models/CompanyKnowledgeContainer');
        const embContainers = await ContainerModel
          .find({ companyId, isActive: true })
          .select('+sections.callerPhrases.embedding +sections.contentEmbedding')
          .lean();

        // Filter to scorable containers only
        const scorableEmbContainers = rejectedContainerIds.size > 0
          ? embContainers.filter(c => !rejectedContainerIds.has(String(c._id)))
          : embContainers;

        const semanticResult = await SemanticMatchService.findBestSection(
          companyId, userInput, scorableEmbContainers
        );

        if (semanticResult) {
          // Hydrate the full container from our original loaded list
          const fullContainer = scorableContainers.find(c =>
            String(c._id || '') === String(semanticResult.container._id)
          );

          if (fullContainer) {
            match = {
              container:        fullContainer,
              score:            Math.round(semanticResult.similarity * 100),
              matchSource:      'SEMANTIC',
              targetSection:    fullContainer.sections?.[semanticResult.sectionIdx] || null,
              targetSectionIdx: semanticResult.sectionIdx,
            };

            emit('KC_SEMANTIC_MATCH', {
              containerTitle: fullContainer.title,
              containerId:    String(fullContainer._id),
              sectionLabel:   semanticResult.section?.label || null,
              similarity:     semanticResult.similarity,
              matchSource:    semanticResult.matchSource,
            });

            logger.info('[KC_ENGINE] Semantic match found', {
              companyId, callSid, turn,
              containerTitle: fullContainer.title,
              sectionLabel:   semanticResult.section?.label || '(all)',
              similarity:     semanticResult.similarity.toFixed(3),
            });
          }
        }
      } catch (_semErr) {
        logger.warn('[KC_ENGINE] Semantic match error — falling through to keywords', {
          companyId, callSid, err: _semErr.message,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 3 — KEYWORD FALLBACK — contentKeywords + title scoring  (<1ms)
    // ══════════════════════════════════════════════════════════════════════════
    if (!match) match = KCS.findContainer(scorableContainers, userInput, callContext);

    // Carry bestSection from findContainer into the match for section routing
    if (match && match.bestSection && !match.targetSection) {
      match.targetSection    = match.bestSection;
      match.targetSectionIdx = match.bestSectionIdx ?? null;
    }

    if (match?.contextAssisted) {
      emit('KC_CONTEXT_MATCH', {
        containerTitle: match.container.title,
        containerId:    String(match.container._id || match.container.title || ''),
        score:          match.score,
        callReason:     notes?.callReason || null,
      });
    }

    // Convenience: extract priorVisit once so all handlers below can use it
    const priorVisit = notes?.priorVisit === true;

    // ── SECTION GAP LOGGING ──────────────────────────────────────────────────
    // Container matched but no specific section identified. Log the gap for
    // the Gaps & Todo page so we know what sections to build. Groq still
    // answers from the container's full content (groqContent) — we never
    // abandon authored knowledge for a cold Claude fallback.
    if (match && match.container && !match.targetSection) {
      const _gapContainerTitle = match.container.title || 'Unknown';
      const _gapContainerId   = String(match.container._id || '');
      const _gapKcId          = match.container.kcId || null;

      logger.info('[KC_ENGINE] Container matched, no section — logging gap, Groq answers from all sections', {
        companyId, callSid, turn,
        containerTitle: _gapContainerTitle,
        score: match.score,
        inputPreview: _clip(userInput, 80),
      });

      emit('KC_SECTION_GAP', {
        containerTitle: _gapContainerTitle,
        containerId:    _gapContainerId,
        kcId:           _gapKcId,
        score:          match.score,
        userInput:      _clip(userInput, 100),
        turn,
      });

      // qaLog: record section gap for Gaps & Todo page
      _writeDiscoveryNotes(companyId, callSid, {
        qaLog: [{
          type:           'KC_SECTION_GAP',
          turn:           turn ?? 0,
          question:       userInput,
          containerTitle: _gapContainerTitle,
          containerId:    _gapContainerId,
          kcId:           _gapKcId,
          timestamp:      new Date().toISOString(),
        }],
      }).catch(() => {});

      // ── Section pre-filter: narrow N sections before Groq ────────────
      // Instead of dumping 200+ sections into Groq, score them against the
      // caller utterance and send only the top GAP_MAX_SECTIONS. Groq still
      // synthesizes from deep content — but from a focused window.
      const _allSections = match.container.sections || [];
      if (_allSections.length > GAP_MAX_SECTIONS) {
        const _topSections = _scoreSectionsForGap(_allSections, userInput, cueFrame);

        if (_topSections.length > 0) {
          // Shallow-clone container with only top-scoring sections
          match.container = {
            ...match.container,
            sections: _topSections.map(s => s.section),
            _gapFiltered:     true,
            _gapOriginalCount: _allSections.length,
            _gapFilteredCount: _topSections.length,
            _gapTopScores:     _topSections.map(s => ({
              label: s.section.label,
              idx:   s.index,
              score: s._gapScore,
            })),
          };

          logger.info('[KC_ENGINE] SECTION GAP — pre-filtered for Groq', {
            companyId, callSid, turn,
            containerTitle: _gapContainerTitle,
            originalSections: _allSections.length,
            filteredTo:       _topSections.length,
            topSections:      _topSections.map(s => `${s.section.label} (${s._gapScore})`).join(', '),
          });
        } else {
          logger.debug('[KC_ENGINE] SECTION GAP — no sections scored > 0, Groq gets all', {
            companyId, callSid, turn, sectionCount: _allSections.length,
          });
        }
      }
      // Fall through to _handleKCMatch — Groq reads filtered (or all) sections
    }

    // ── MATCH → DIRECT ANSWER ─────────────────────────────────────────────
    // Topic persistence is handled by discoveryNotes.anchorContainerId — the
    // 3× score multiplier + ANCHOR_FLOOR=24 in findContainer() ensures follow-up
    // questions ("how much is it?") naturally re-match the anchored container.
    // No separate Redis anchor or topic-hop detection needed.
    if (match && match.container) {
      return await _handleKCMatch({
        match, userInput, companyId, callSid, company, kbSettings, callerName,
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
// HANDLER: PRE-QUALIFY RESPONSE
// Called by GATE 0.7 when there is a pending kc-prequal Redis key for this call.
// The caller's current utterance is their answer to the pre-qualify question.
// ============================================================================

/**
 * _handlePrequalResponse
 *
 * Receives the caller's answer to a pre-qualify question that was asked on a
 * prior turn (GATE 3.5). Matches the answer against option keywords, writes
 * the matched value to discoveryNotes.temp, then calls KCS.answer() with the
 * matched responseContext so Groq calibrates its reply to the right caller type.
 *
 * If no option matches, re-asks the pre-qualify question (does NOT clear Redis).
 * If the container can no longer be found, clears Redis and falls through gracefully.
 */
async function _handlePrequalResponse({
  companyId, callSid, userInput, redis,
  pendingPrequal,   // raw JSON string from Redis
  emit, nextState, startMs, turn, company, kbSettings, callerName,
}) {
  const input = (userInput || '').trim().toLowerCase();

  let _pqState;
  try {
    _pqState = JSON.parse(pendingPrequal);
  } catch (_) {
    // Corrupt Redis state — clear and fall through gracefully
    await redis.del(`kc-prequal:${companyId}:${callSid}`).catch(() => {});
    return {
      response:    "I'm sorry, let me start over. What can I help you with today?",
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_GRACEFUL_ACK, { intent: 'PREQUAL_PARSE_ERROR', latencyMs: Date.now() - startMs }),
    };
  }

  const { containerId, sectionId = null } = _pqState;

  // Load the container — fall through gracefully if not found
  const containers = await KCS.getActiveForCompany(companyId).catch(() => []);
  const container  = containers.find(c => String(c._id || c.title) === containerId);

  if (!container) {
    logger.warn('[KC_ENGINE] Pre-qualify: container not found — clearing state', { companyId, callSid, containerId });
    await redis.del(`kc-prequal:${companyId}:${callSid}`).catch(() => {});
    return {
      response:    "I'm sorry, let me start over. What can I help you with today?",
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_GRACEFUL_ACK, { intent: 'PREQUAL_CONTAINER_MISSING', latencyMs: Date.now() - startMs }),
    };
  }

  // Resolve targetSection — prefer section-level prequal; fall back to container-level (legacy)
  const targetSection = sectionId
    ? (container.sections || []).find(s => String(s._id || '') === sectionId) || null
    : null;

  // Load discoveryNotes once — provides callReason/urgency/priorVisit context to KCS
  // for both the escape path and the main answer path below.
  const _dnCtx = await DiscoveryNotesService.load(companyId, callSid).catch(() => null);
  const discoveryContext = _buildDiscoveryContext(_dnCtx);

  const pq      = targetSection?.preQualifyQuestion || {};
  const options = pq.options || [];
  const fieldKey = pq.fieldKey || 'preQualifyAnswer';
  const _answeredKey = sectionId || containerId;

  // ── Match caller input against option keywords ────────────────────────────
  let matchedOption = null;
  for (const opt of options) {
    const keywords = (opt.keywords || []).map(k => k.trim().toLowerCase()).filter(Boolean);
    if (keywords.length && keywords.some(kw => input.includes(kw))) {
      matchedOption = opt;
      break;
    }
  }

  // ── No keyword match — re-ask once, then escape to KC answer ─────────────
  if (!matchedOption) {
    const reaskCount = _pqState.reaskCount || 0;

    if (reaskCount < 1) {
      // First failed match — re-ask once, record count in Redis so next miss escapes
      await redis.setex(
        `kc-prequal:${companyId}:${callSid}`, 4 * 3600,
        JSON.stringify({ containerId, sectionId: sectionId || null, status: 'ASKING', reaskCount: reaskCount + 1 })
      ).catch(() => {});
      logger.info('[KC_ENGINE] Pre-qualify: no keyword match — re-asking once', { companyId, callSid, containerId, reaskCount: reaskCount + 1, input: input.slice(0, 40) });
      emit('KC_PREQUAL_REASKED', { containerId, turn, reaskCount: reaskCount + 1 });
      return {
        response:    pq.text || "I didn't quite catch that — could you let me know which applies to you?",
        matchSource: 'KC_ENGINE',
        state:       nextState,
        kcTrace:     _buildKcTrace(PATH.KC_PREQUAL_PENDING, { containerId, intent: 'PREQUAL_REASKED', latencyMs: Date.now() - startMs }),
      };
    }

    // Max re-asks exceeded — unlock and answer their question directly via KC
    await redis.del(`kc-prequal:${companyId}:${callSid}`).catch(() => {});
    logger.info('[KC_ENGINE] Pre-qualify: max re-asks exceeded — routing utterance to KC answer', { companyId, callSid, containerId, input: input.slice(0, 40) });
    emit('KC_PREQUAL_ESCAPED', { containerId, turn });

    let _escapedResult;
    try {
      _escapedResult = await KCS.answer({
        container, targetSection, question: userInput,
        kbSettings, company, callerName, callSid, turn,
        discoveryContext,
      });
    } catch (_e) {
      logger.error('[KC_ENGINE] Pre-qualify escape: KCS.answer error', { companyId, callSid, containerId, err: _e.message });
      _escapedResult = null;
    }

    if (_escapedResult?.response) {
      return {
        response:      _escapedResult.response,
        audioHintText: _escapedResult.audioHintText || null,
        matchSource:   'KC_ENGINE',
        state:         nextState,
        kcTrace:       _buildKcTrace(PATH.KC_DIRECT_ANSWER, { containerId, intent: 'PREQUAL_ESCAPED', latencyMs: Date.now() - startMs }),
      };
    }

    return {
      response:    "Of course — let me know what else I can help you with.",
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_GRACEFUL_ACK, { containerId, intent: 'PREQUAL_ESCAPE_FALLBACK', latencyMs: Date.now() - startMs }),
    };
  }

  // ── Matched — record in discoveryNotes.temp ───────────────────────────────
  const _pqNotesBefore  = await DiscoveryNotesService.load(companyId, callSid).catch(() => null);
  const _alreadyAnswered = (_pqNotesBefore?.temp?.preQualifyAnswered || []).map(String);
  DiscoveryNotesService.update(companyId, callSid, {
    temp: {
      [fieldKey]:          matchedOption.value,
      preQualifyAnswered:  [..._alreadyAnswered, _answeredKey],  // keyed by sectionId or containerId
    },
  }).catch(() => {});

  // Delete prequal Redis key — this call has now answered the question
  await redis.del(`kc-prequal:${companyId}:${callSid}`).catch(() => {});

  // Remove from pendingContext — no longer pending, caller answered it mid-call (fire-and-forget)
  ;(async () => {
    try {
      const _cur = await DiscoveryNotesService.load(companyId, callSid);
      const _remaining = (_cur?.temp?.pendingContext || []).filter(p => p.itemKey !== _answeredKey);
      await DiscoveryNotesService.update(companyId, callSid, { temp: { pendingContext: _remaining } });
    } catch (_) { /* non-fatal */ }
  })();

  emit('KC_PREQUAL_ANSWERED', { containerId, optionValue: matchedOption.value, turn });
  logger.info('[KC_ENGINE] ✅ Pre-qualify answered', {
    companyId, callSid, containerId, optionValue: matchedOption.value, turn,
  });

  // ── Call KCS.answer() with the matched responseContext ────────────────────
  const preQualifyContext = matchedOption.responseContext || '';
  const containerTitle    = container.title || 'Knowledge Container';

  let kcResult;
  try {
    kcResult = await KCS.answer({
      container,
      targetSection,      // null = all sections; section obj = Groq reads only this section
      question:          userInput,
      kbSettings,
      company,
      callerName,
      callSid,
      turn,
      preQualifyContext,  // injects CALLER TYPE block into Groq system prompt
      discoveryContext,   // injects CALL CONTEXT block — caller's reason, urgency, prior-visit
    });
  } catch (_e) {
    logger.error('[KC_ENGINE] Pre-qualify: Groq error after match', { companyId, callSid, containerId, err: _e.message });
    kcResult = { response: null, intent: KCS.INTENT.ERROR };
  }

  if (!kcResult?.response) {
    return {
      response:    "I'm sorry, I wasn't able to get that answer. Let me connect you with someone who can help.",
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_GRACEFUL_ACK, { containerId, intent: 'PREQUAL_GROQ_ERROR', latencyMs: Date.now() - startMs }),
    };
  }

  // ── Handle BOOKING_READY from Groq ────────────────────────────────────────
  if (kcResult.intent === KCS.INTENT.BOOKING_READY) {
    emit('KC_BOOKING_INTENT_FIRED', { companyId, callSid, turn, path: PATH.KC_BOOKING_INTENT, source: 'prequal_groq' });
    nextState.lane        = 'BOOKING';
    nextState.sessionMode = 'BOOKING';
    nextState.agent2      = nextState.agent2 || {};
    nextState.agent2.discovery = nextState.agent2.discovery || {};
    nextState.agent2.discovery.pendingBookingFromKC = true;
    nextState.agent2.discovery.lastPath             = PATH.KC_BOOKING_INTENT;
    return {
      response:      kcResult.response,
      audioHintText: kcResult.audioHintText || null,
      matchSource:   'KC_ENGINE',
      state:         nextState,
      kcTrace:       _buildKcTrace(PATH.KC_BOOKING_INTENT, { containerId, containerTitle, intent: kcResult.intent, latencyMs: Date.now() - startMs }),
    };
  }

  // ── Answered normally ─────────────────────────────────────────────────────
  nextState.agent2            = nextState.agent2 || {};
  nextState.agent2.discovery  = nextState.agent2.discovery || {};
  nextState.agent2.discovery.lastPath    = PATH.KC_DIRECT_ANSWER;
  nextState.agent2.discovery.lastKCTitle = containerTitle;

  emit('KC_GROQ_ANSWERED', {
    intent:          kcResult.intent,
    latencyMs:       kcResult.latencyMs,
    path:            PATH.KC_DIRECT_ANSWER,
    responsePreview: _clip(kcResult.response, 200),
    containerTitle,
    containerId,
    source:          'prequal',
  });

  return {
    response:      kcResult.response,
    audioHintText: kcResult.audioHintText || null,
    matchSource:   'KC_ENGINE',
    state:         nextState,
    kcTrace:       _buildKcTrace(PATH.KC_DIRECT_ANSWER, {
      containerId, containerTitle, intent: kcResult.intent, latencyMs: Date.now() - startMs,
    }),
  };
}

// ============================================================================
// HANDLER: KC DIRECT ANSWER / TOPIC HOP
// ============================================================================

async function _handleKCMatch({
  match, userInput, companyId, callSid, company, kbSettings, callerName,
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
  const _kcId          = container.kcId || null;
  const _secIdx        = match.targetSectionIdx ?? null;
  const _secId         = buildSectionId(_kcId, _secIdx);   // e.g. "700c4-29-01"

  // ── Resolve targetSection from match ──────────────────────────────────────
  // UAP (Gate 2.5) and Semantic (Gate 2.8) set match.targetSection directly.
  // Keyword (Gate 3) may set match.bestSection → carried as match.targetSection.
  // null = all sections sent to Groq (no specific section identified).
  const targetSection = match.targetSection || null;
  const sectionId     = targetSection ? String(targetSection._id || '') : null;

  logger.info('[KC_ENGINE] Container matched', {
    companyId, callSid, containerTitle, score: match.score, turn,
    ...(targetSection ? { sectionLabel: targetSection.label, matchSource: match.matchSource } : {}),
  });

  emit('KC_CONTAINER_MATCHED', {
    containerTitle,
    containerId:  String(container._id || containerTitle),
    kcId:         container.kcId || null,
    score:        match.score,
    path:         PATH.KC_DIRECT_ANSWER,
  });

  // ── GATE 3.5 — PRE-QUALIFY QUESTION ───────────────────────────────────────
  // Section-level preQualifyQuestion takes priority. Falls back to container-level
  // (legacy) when targetSection is null or has no prequal configured.
  // The caller's next utterance is their answer → GATE 0.7 → _handlePrequalResponse().
  // Skip if redis is unavailable — graceful degrade to answering without prequal.
  // enabled defaults to true — only skip when explicitly set false (owner toggled it off)
  const _activePQ = targetSection?.preQualifyQuestion?.text?.trim() &&
                    targetSection?.preQualifyQuestion?.enabled !== false
    ? targetSection.preQualifyQuestion
    : null;   // section-level only — container-level prequal is now legacy

  if (redis && _activePQ) {
    try {
      const _pqKey      = `kc-prequal:${companyId}:${callSid}`;
      const _pqExisting = await redis.get(_pqKey).catch(() => null);

      // Use sectionId (preferred) or containerId as the answered-check key
      const _answeredKey = sectionId || containerId;

      if (!_pqExisting) {
        // Not currently waiting — check if already answered for this section/container this call
        const _pqNotes    = await DiscoveryNotesService.load(companyId, callSid).catch(() => null);
        const _pqAnswered = (_pqNotes?.temp?.preQualifyAnswered || []).map(String);

        if (!_pqAnswered.includes(_answeredKey)) {
          // First match this call — set Redis and ask the pre-qualify question
          await redis.setex(
            _pqKey, 4 * 3600,
            JSON.stringify({ containerId, sectionId: sectionId || null, status: 'ASKING' })
          ).catch(() => {});

          emit('KC_PREQUAL_ASKED', { containerId, sectionId: sectionId || null, containerTitle, kcId: container.kcId || null, turn });
          logger.info('[KC_ENGINE] 🎯 GATE 3.5: Pre-qualify question asked', {
            companyId, callSid, containerId, sectionId: sectionId || null, containerTitle, turn,
          });

          // Write to pendingContext — this question is now "in flight".
          // Stays in pending until answered mid-call OR surfaced at BOOKING_READY.
          // Fire-and-forget — non-fatal if it fails.
          const _currentPending = (_pqNotes?.temp?.pendingContext || []);
          DiscoveryNotesService.update(companyId, callSid, {
            temp: {
              pendingContext: [..._currentPending, {
                type:     'PREQUAL',
                itemKey:  _answeredKey,
                question: _activePQ.text || '',
                fieldKey: _activePQ.fieldKey || 'preQualifyAnswer',
                options:  (_activePQ.options || []).map(o => ({
                  label: o.label, value: o.value, keywords: o.keywords || [],
                })),
                offeredAt: new Date().toISOString(),
              }],
            },
          }).catch(() => {});

          return {
            response:    _activePQ.text,
            matchSource: 'KC_ENGINE',
            state:       nextState,
            kcTrace:     _buildKcTrace(PATH.KC_PREQUAL_PENDING, {
              containerId, sectionId: sectionId || null, containerTitle, kcId: _kcId, sectionIdx: _secIdx,
              intent: 'PREQUAL_ASKED', latencyMs: Date.now() - startMs,
            }),
          };
        }
      }
    } catch (_gate35Err) {
      // Non-fatal — fall through to KCS.answer() without pre-qualify
      logger.warn('[KC_ENGINE] GATE 3.5 error — skipping pre-qualify', {
        companyId, callSid, containerId, err: _gate35Err.message,
      });
    }
  }
  // ── End GATE 3.5 ──────────────────────────────────────────────────────────

  // preQualifyContext — injected into Groq when caller already answered the
  // pre-qualify question this call (loaded by _handlePrequalResponse).
  // Reads discoveryNotes.temp[fieldKey] to find the matched responseContext.
  let _preQualifyContext = '';
  if (redis && _activePQ) {
    try {
      const _pqNotes  = await DiscoveryNotesService.load(companyId, callSid).catch(() => null);
      const _fieldKey = _activePQ.fieldKey || 'preQualifyAnswer';
      const _answer   = _pqNotes?.temp?.[_fieldKey];
      if (_answer) {
        // Find the matching option to get responseContext
        const _opts = _activePQ.options || [];
        const _opt  = _opts.find(o => o.value === _answer);
        _preQualifyContext = _opt?.responseContext || '';
      }
    } catch (_) { /* non-fatal */ }
  }

  let kcResult;
  try {
    kcResult = await KCS.answer({
      container,
      targetSection,        // null = all sections; section obj = Groq reads only this section
      question: userInput,
      kbSettings,
      company,
      callerName,
      callSid,
      turn,
      discoveryContext,
      priorVisit,           // passed from run() — was notes?.priorVisit (out-of-scope bug fixed)
      preQualifyContext: _preQualifyContext,  // injected into Groq CALLER TYPE block
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

    // ── GATE 4.5 — UPSELL CHAIN ────────────────────────────────────────────
    // Section-level upsellChain takes priority over container-level (legacy).
    // Each offer fires on a separate turn; GATE 0.7 → _handleUpsellResponse()
    // handles each YES/NO. Skip silently if redis unavailable or on any error.
    // ───────────────────────────────────────────────────────────────────────
    const _activeUpsell = targetSection?.upsellChain?.length > 0
      ? targetSection.upsellChain
      : [];   // section-level only — container-level upsellChain is now legacy

    if (redis && _activeUpsell.length > 0) {
      try {
        const _upKey      = `kc-upsell:${companyId}:${callSid}`;
        const _upExisting = await redis.get(_upKey).catch(() => null);
        if (!_upExisting) {
          const first = _activeUpsell[0];
          if (first?.offerScript?.trim()) {
            await redis.setex(
              _upKey, 4 * 3600,
              JSON.stringify({ containerId, sectionId: sectionId || null, idx: 0, status: 'PENDING', currentUpsell: first })
            ).catch(() => {});

            emit('KC_UPSELL_FIRED', { containerId, sectionId: sectionId || null, containerTitle, idx: 0, itemKey: first.itemKey || null, turn });
            logger.info('[KC_ENGINE] 💰 GATE 4.5: Upsell chain started', {
              companyId, callSid, containerId, sectionId: sectionId || null, idx: 0, itemKey: first.itemKey || null, turn,
            });

            // Log this offer — PENDING until caller says YES or NO (or call ends → NOT_REACHED)
            DiscoveryNotesService.update(companyId, callSid, {
              temp: {
                offeredItems: [{
                  type:      'UPSELL',
                  itemKey:   first.itemKey || `upsell_${containerId}_0`,
                  item:      first.itemKey || null,
                  price:     first.price   ?? null,
                  outcome:   'PENDING',
                  offeredAt: new Date().toISOString(),
                }],
              },
            }).catch(() => {});

            return {
              response:    first.offerScript,
              matchSource: 'KC_ENGINE',
              state:       nextState,
              kcTrace:     _buildKcTrace(PATH.KC_UPSELL_PENDING, {
                containerId, sectionId: sectionId || null, containerTitle, kcId: _kcId, sectionIdx: _secIdx,
                intent: 'UPSELL_ASKED', idx: 0, latencyMs: Date.now() - startMs,
              }),
            };
          }
        }
      } catch (_gate45Err) {
        // Non-fatal — fall through to booking normally
        logger.warn('[KC_ENGINE] GATE 4.5 error — skipping upsell chain', {
          companyId, callSid, containerId, err: _gate45Err.message,
        });
      }
    }
    // ── End GATE 4.5 ─────────────────────────────────────────────────────────

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
      callReason:        containerTitle,
      objective:         'BOOKING',
      turnNumber:        turn ?? 0,
      anchorContainerId: containerId,   // anchor — all subsequent KC lookups bias to this container
      ...(callerName ? { entities: { firstName: callerName } } : {}),
    }).catch(() => {});

    return {
      response:      kcResult.response,
      audioHintText: kcResult.audioHintText || null,
      matchSource:   'KC_ENGINE',
      state:         nextState,
      kcTrace:       _buildKcTrace(PATH.KC_BOOKING_INTENT, {
        containerId, containerTitle, kcId: _kcId, sectionIdx: _secIdx,
        intent: kcResult.intent, latencyMs: Date.now() - startMs,
      }),
    };
  }

  // ── discoveryNotes: record callReason + Q&A so BookingLogicEngine knows
  //    what the call was about when the caller eventually says "let's book" ──
  _writeDiscoveryNotes(companyId, callSid, {
    callReason:          containerTitle,
    objective:           'DISCOVERY',
    turnNumber:          turn ?? 0,
    anchorContainerId:   containerId,   // anchor — all subsequent KC lookups bias to this container
    lastMeaningfulInput: userInput?.slice(0, 200) || null,
    ...(callerName ? { entities: { firstName: callerName } } : {}),
    qaLog: [{
      turn:        turn ?? 0,
      containerId,
      kcId:        _kcId,
      sectionIdx:  _secIdx,
      sectionId:   _secId,
      question:    userInput,
      answer:      kcResult.response?.slice(0, 200) || null,
      timestamp:   new Date().toISOString(),
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
      callReason:        containerTitle,
      objective:         'BOOKING',
      turnNumber:        turn ?? 0,
      anchorContainerId: containerId,   // anchor for compound-booking path
      ...(callerName ? { entities: { firstName: callerName } } : {}),
    }).catch(() => {});
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
    response:      kcResult.response,
    audioHintText: kcResult.audioHintText || null,
    matchSource:   'KC_ENGINE',
    state:         nextState,
    kcTrace:       _buildKcTrace(finalPath, {
      containerId, containerTitle, kcId: _kcId, sectionIdx: _secIdx,
      intent:      kcResult.intent,
      latencyMs:   Date.now() - startMs,
    }),
  };
}

// ============================================================================
// HANDLER: UPSELL RESPONSE
// Called by GATE 0.7 when there is a pending kc-upsell Redis key for this call.
// The caller's current utterance is their YES or NO to the upsell offer.
// ============================================================================

/**
 * _handleUpsellResponse
 *
 * Receives the caller's YES/NO to a upsell offer that was presented on a prior
 * turn (GATE 4.5). Detects acceptance or decline, writes the outcome to
 * discoveryNotes.temp.upsellOffers[], then either:
 *   - Fires the next upsell in the chain (updates Redis idx)
 *   - OR transitions to booking when the chain is exhausted
 */
async function _handleUpsellResponse({
  companyId, callSid, userInput, redis,
  pendingUpsell,   // raw JSON string from Redis
  emit, nextState, startMs, turn, company,
}) {
  // ── Affirmative / Negative intent regexes ──────────────────────────────
  // Pulled from GlobalHubService so admins can manage the list in the UI
  // (GlobalShare → Conversation Signals). Falls back to built-in defaults
  // if GlobalShare has not been loaded yet.
  // isYes takes priority — "yes, but no thanks" → YES wins.
  // ────────────────────────────────────────────────────────────────────────
  const GlobalHubService = require('../../GlobalHubService');
  const _YES_RE = GlobalHubService.getYesRegex();
  const _NO_RE  = GlobalHubService.getNoRegex();

  let _upState;
  try {
    _upState = JSON.parse(pendingUpsell);
  } catch (_) {
    await redis.del(`kc-upsell:${companyId}:${callSid}`).catch(() => {});
    return _upsellRouteToBooking({ nextState, emit, turn, companyId, callSid, startMs });
  }

  const { containerId, sectionId = null, idx, currentUpsell } = _upState;
  const isYes = _YES_RE.test(userInput);
  const isNo  = _NO_RE.test(userInput) && !isYes;

  // Ambiguous (no clear signal) → re-ask with a gentle nudge
  if (!isYes && !isNo) {
    emit('KC_UPSELL_REASKED', { containerId, idx, turn });
    return {
      response:    `Just to confirm — ${currentUpsell?.offerScript ? 'would you like to add that?' : 'is that a yes or no?'}`,
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_UPSELL_PENDING, { containerId, intent: 'UPSELL_REASKED', idx, latencyMs: Date.now() - startMs }),
    };
  }

  // ── Write outcome to discoveryNotes.temp.upsellOffers[] ──────────────────
  const outcome = {
    itemKey:     currentUpsell?.itemKey    || null,
    price:       currentUpsell?.price      ?? null,
    accepted:    isYes,
    containerId,
    timestamp:   new Date().toISOString(),
  };
  DiscoveryNotesService.load(companyId, callSid)
    .then(existing => {
      const offers = existing?.temp?.upsellOffers || [];
      return DiscoveryNotesService.update(companyId, callSid, {
        temp: {
          upsellOffers: [...offers, outcome],
          // offeredItems: append resolution entry — last entry per itemKey wins at BOOKING_CONFIRM
          offeredItems: [{
            type:       'UPSELL',
            itemKey:    currentUpsell?.itemKey || `upsell_${containerId}_${idx}`,
            item:       currentUpsell?.itemKey || null,
            price:      currentUpsell?.price   ?? null,
            outcome:    isYes ? 'ACCEPTED' : 'DECLINED',
            resolvedAt: new Date().toISOString(),
          }],
        },
      });
    })
    .catch(() => {});

  emit('KC_UPSELL_OUTCOME', { containerId, idx, accepted: isYes, itemKey: currentUpsell?.itemKey || null, turn });
  logger.info('[KC_ENGINE] 💰 Upsell outcome recorded', {
    companyId, callSid, containerId, idx, accepted: isYes, itemKey: currentUpsell?.itemKey,
  });

  // ── Deliver acceptance/decline script ────────────────────────────────────
  // We'll append the next upsell or routing transition to the spoken response.
  const scriptLine = isYes
    ? (currentUpsell?.yesScript?.trim() || '')
    : (currentUpsell?.noScript?.trim() || '');

  // ── Check for next upsell in chain ────────────────────────────────────────
  const containers = await KCS.getActiveForCompany(companyId).catch(() => []);
  const container  = containers.find(c => String(c._id || c.title) === containerId);
  // Resolve section from stored sectionId; use section's upsellChain (section-level wins)
  const targetSection = sectionId
    ? (container?.sections || []).find(s => String(s._id || '') === sectionId) || null
    : null;
  const chain      = targetSection?.upsellChain?.length > 0
    ? targetSection.upsellChain
    : [];  // section-level only — container.upsellChain is legacy
  const nextIdx    = idx + 1;
  const nextUpsell = chain[nextIdx];

  if (nextUpsell?.offerScript?.trim()) {
    // Advance to next upsell in chain
    const _upKey = `kc-upsell:${companyId}:${callSid}`;
    await redis.setex(
      _upKey, 4 * 3600,
      JSON.stringify({ containerId, sectionId: sectionId || null, idx: nextIdx, status: 'PENDING', currentUpsell: nextUpsell })
    ).catch(() => {});

    emit('KC_UPSELL_FIRED', { containerId, idx: nextIdx, itemKey: nextUpsell.itemKey || null, turn });
    logger.info('[KC_ENGINE] 💰 Upsell chain advanced', {
      companyId, callSid, containerId, idx: nextIdx, itemKey: nextUpsell.itemKey,
    });

    // Stitch script line + next upsell pitch into one spoken response
    const response = scriptLine
      ? `${scriptLine} ${nextUpsell.offerScript}`
      : nextUpsell.offerScript;

    return {
      response:    response.trim(),
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_UPSELL_PENDING, { containerId, intent: 'UPSELL_ASKED', idx: nextIdx, latencyMs: Date.now() - startMs }),
    };
  }

  // ── Chain exhausted — route to booking ────────────────────────────────────
  await redis.del(`kc-upsell:${companyId}:${callSid}`).catch(() => {});
  logger.info('[KC_ENGINE] 💰 Upsell chain complete — routing to booking', { companyId, callSid, containerId });

  return _upsellRouteToBooking({ nextState, emit, turn, companyId, callSid, startMs, scriptLine });
}

/**
 * _upsellRouteToBooking — shared helper: flip to BOOKING lane after upsell chain ends.
 */
function _upsellRouteToBooking({ nextState, emit, turn, companyId, callSid, startMs, scriptLine = '' }) {
  emit('KC_BOOKING_INTENT_FIRED', { companyId, callSid, turn, path: PATH.KC_BOOKING_INTENT, source: 'upsell_chain_done' });
  nextState.lane                                          = 'BOOKING';
  nextState.sessionMode                                   = 'BOOKING';
  nextState.agent2                                        = nextState.agent2 || {};
  nextState.agent2.discovery                              = nextState.agent2.discovery || {};
  nextState.agent2.discovery.pendingBookingFromKC         = true;
  nextState.agent2.discovery.lastPath                     = PATH.KC_BOOKING_INTENT;

  return {
    response:    scriptLine || "Perfect — let me get you scheduled right away!",
    matchSource: 'KC_ENGINE',
    state:       nextState,
    kcTrace:     _buildKcTrace(PATH.KC_BOOKING_INTENT, { intent: 'UPSELL_CHAIN_DONE', latencyMs: Date.now() - startMs }),
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

    // qaLog: record LLM fallback for Calibration dashboard
    _writeDiscoveryNotes(companyId, callSid, {
      qaLog: [{
        type:      'KC_LLM_FALLBACK',
        turn:      turn ?? 0,
        question:  userInput,
        answer:    llmResult.response?.slice(0, 200) || null,
        timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});

    return {
      response:    llmResult.response,
      matchSource: 'KC_ENGINE',
      state:       nextState,
      kcTrace:     _buildKcTrace(PATH.KC_LLM_FALLBACK, {
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

  // qaLog: record graceful ack (no match) for Calibration dashboard
  _writeDiscoveryNotes(companyId, callSid, {
    qaLog: [{
      type:      'KC_GRACEFUL_ACK',
      turn:      turn ?? 0,
      question:  userInput,
      timestamp: new Date().toISOString(),
    }],
  }).catch(() => {});

  const ackResponse = (company?.knowledgeBaseSettings?.fallbackResponse || '').trim()
    || _gracefulAck();

  nextState.agent2            = nextState.agent2 || {};
  nextState.agent2.discovery  = nextState.agent2.discovery || {};
  nextState.agent2.discovery.lastPath = PATH.KC_GRACEFUL_ACK;

  return {
    response:    ackResponse,
    matchSource: 'KC_ENGINE',
    state:       nextState,
    kcTrace:     _buildKcTrace(PATH.KC_GRACEFUL_ACK, { latencyMs: Date.now() - startMs }),
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = KCDiscoveryRunner;

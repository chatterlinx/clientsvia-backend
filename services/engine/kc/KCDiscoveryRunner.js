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
 *   GATE 0.5  Transfer intent    (KCTransferIntentDetector — sync ~0ms, Redis ~2ms)
 *   GATE 0.7  Pending prequal/upsell state (Redis)
 *   GATE 1    Booking intent     (KCBookingIntentDetector — synchronous, ~0ms)
 *   GATE 2.4  CueExtractor       (8-field pattern match, tradeTerms — <1ms)
 *   GATE 2.4b Anchor confirmation (≥90% anchor words — <1ms)
 *   GATE 2.4c Cue profile scan   (single-trade callerPhrase overlap — <1ms)
 *   GATE 2.5  UAP Layer 1        (phrase index hit ≥0.80 + Anchor Gate — <1ms)
 *   GATE 2.8  Semantic match     (embedding similarity — ~50ms, only on UAP miss)
 *   GATE 2.9  Negative keyword checkpoint (covers 2.4/2.5/2.8 — <1ms)
 *   GATE 3    Keyword fallback   (contentKeywords + title scoring — <1ms)
 *   GATE 3.5  Pre-qualify intercept (section-level)
 *   GATE 4    LLM fallback       (callLLMAgentForFollowUp — ~800ms, only if no KC)
 *   GATE 4.5  Upsell chain intercept (section-level)
 *   GATE 5    Graceful ACK       (canned response, only if LLM also unavailable)
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
// COST CONSTANTS (per 1M tokens / per 1k chars)  — Phase A.4
// ============================================================================
// Admin is flying blind on Groq/Claude spend per fallback. Pricing here is
// constant per model and lets the Gap page compute $ per turn without a
// separate billing sync. If a price changes, update these and redeploy —
// no schema change needed. Override via env for non-standard contracts.
//
// Sources (April 2026):
//   Claude Sonnet 4.5: $3  / 1M input, $15  / 1M output
//   Groq llama-3.3-70b: $0.59 / 1M input, $0.79 / 1M output  (primary KC Groq model)
//   ElevenLabs Turbo v2.5: ~$0.30 / 1k chars  (approx; per-tier varies)
// ============================================================================

// ── Per-company rates (Commit 2, 2026-04-21) ────────────────────────────────
// Rates now resolved via services/costRates.js which honors
// company.costConfig overrides → env var → hardcoded list price default.
// The helper caches nothing; resolution is a cheap pure function.
const costRates = require('../../costRates');

/**
 * _computeClaudeCost — derive $ from tokensUsed shape { input, output }.
 * Returns { inputUsd, outputUsd, totalUsd } rounded to 6 decimals, or null
 * if tokensUsed is malformed. Cheap: two multiplications per call.
 *
 * @param {object}      tokensUsed  — { input, output }
 * @param {object|null} company     — company doc (for per-company rate override)
 */
function _computeClaudeCost(tokensUsed, company) {
  if (!tokensUsed || typeof tokensUsed.input !== 'number' || typeof tokensUsed.output !== 'number') {
    return null;
  }
  const rates = costRates.getRates(company);
  const r = rates.claude;
  const inUsd  = (tokensUsed.input  / 1_000_000) * r.inPerM;
  const outUsd = (tokensUsed.output / 1_000_000) * r.outPerM;
  return {
    inputTokens:  tokensUsed.input,
    outputTokens: tokensUsed.output,
    inputUsd:     Math.round(inUsd  * 1_000_000) / 1_000_000,
    outputUsd:    Math.round(outUsd * 1_000_000) / 1_000_000,
    totalUsd:     Math.round((inUsd + outUsd) * 1_000_000) / 1_000_000,
    model:        'claude-sonnet-4-5',
    tier:         r.tier,
    // Rate provenance — stamped onto qaLog so the Cost Breakdown drawer
    // can show "Sonnet 4.5 (enterprise) @ $2.50/M in · $12/M out (company)".
    rate: { tier: r.tier, inPerM: r.inPerM, outPerM: r.outPerM, source: rates._source },
  };
}

/**
 * _computeGroqCost — derive $ from tokensUsed shape { input, output } using
 * Groq llama-3.3-70b pricing. Pass 2a — used for KC Groq formatter calls.
 * Returns null when tokensUsed is unavailable (e.g., Groq dropped include_usage).
 *
 * @param {object}      tokensUsed  — { input, output }
 * @param {object|null} company     — company doc (for per-company rate override)
 */
function _computeGroqCost(tokensUsed, company) {
  if (!tokensUsed || typeof tokensUsed.input !== 'number' || typeof tokensUsed.output !== 'number') {
    return null;
  }
  if (tokensUsed.input === 0 && tokensUsed.output === 0) return null; // no usage data
  const rates = costRates.getRates(company);
  const r = rates.groq;
  const inUsd  = (tokensUsed.input  / 1_000_000) * r.inPerM;
  const outUsd = (tokensUsed.output / 1_000_000) * r.outPerM;
  return {
    inputTokens:  tokensUsed.input,
    outputTokens: tokensUsed.output,
    inputUsd:     Math.round(inUsd  * 1_000_000) / 1_000_000,
    outputUsd:    Math.round(outUsd * 1_000_000) / 1_000_000,
    totalUsd:     Math.round((inUsd + outUsd) * 1_000_000) / 1_000_000,
    model:        'llama-3.3-70b-versatile',
    rate:         { tier: r.tier, inPerM: r.inPerM, outPerM: r.outPerM, source: rates._source },
    tier:         r.tier,
  };
}

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

// Y71 FIX (Stage 12 audit, April 2026): stemmer harmonized with CueExtractor.
// Previously this file had its own looser _stem that lacked the 4-char length
// guard, null-safety, and trailing-e strip present in CueExtractor's version.
// Consequence: admin anchor "schedule" (base form) vs caller "scheduled"
// stemmed to different roots ("schedule" vs "schedul") → Logic 1 MISS on a
// correct utterance. Single source of truth now lives at utils/stem.js.
const { stem: _stem } = require('../../../utils/stem');

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

// ── LLM Fallback section ranker ──────────────────────────────────────────────
const KC_LLM_MAX_SECTIONS = 5;   // max sections injected into LLM system prompt

/**
 * _rankTopKCSections — Rank sections across ALL containers by relevance.
 *
 * Used when KC routing missed (no container won) and we're falling to LLM.
 * Instead of leaving Claude blind to company knowledge, pick the top N most
 * relevant sections ACROSS ALL containers and inject them into the LLM prompt
 * so it can answer with authored content instead of generic platitudes.
 *
 * Scoring reuses _scoreSectionsForGap (same signals: label, phrase, keyword,
 * cue-pattern) then flattens across containers and takes the global top N.
 *
 * Excludes noAnchor containers (Recovery, Price Objections, etc.) because
 * their content is conversational mechanics, not knowledge answers.
 *
 * @param {Array}  containers  — scorableContainers (minus rejected)
 * @param {string} userInput   — raw caller utterance
 * @param {Object} cueFrame    — CueExtractor output (may be null)
 * @param {number} maxSections — cap for prompt size (default 5)
 * @returns {Array<{container, section, score}>}
 */
function _rankTopKCSections(containers, userInput, cueFrame, maxSections = KC_LLM_MAX_SECTIONS) {
  if (!Array.isArray(containers) || containers.length === 0 || !userInput) return [];

  const allScored = [];

  for (const container of containers) {
    // Skip noAnchor meta-containers — conversational mechanics, not knowledge.
    if (container.noAnchor) continue;

    const sections = container.sections || [];
    if (sections.length === 0) continue;

    const scoredInContainer = _scoreSectionsForGap(sections, userInput, cueFrame);
    for (const entry of scoredInContainer) {
      allScored.push({
        container,
        section: entry.section,
        score:   entry._gapScore,
      });
    }
  }

  allScored.sort((a, b) => b.score - a.score);
  return allScored.slice(0, maxSections);
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

    // ── Narrative filter: protect callers telling a story from being hijacked
    // by booking intent. Single-word affirmatives ("okay", "yeah") buried inside
    // a longer narrative are conversational fillers — NOT booking confirmations.
    //
    // BUG FIX (2026-04-16): Call report showed "okay, you said a lot of things
    // right now but yeah, um, I came in the house and..." firing booking intent
    // because "okay"+"yeah" are in BOOKING_PHRASES and the question filter
    // only catches question words, not narrative content.
    //
    // Three guards:
    //   1. Story indicators — caller is narrating ("I came", "I noticed", "it was")
    //   2. Trailing conjunction — caller was cut off mid-sentence ("and", "but", "so")
    //   3. Length guard — >20 words with only filler-affirmative booking signals
    let _inputIsNarrative = false;

    // Guard 1: Story/narrative indicators — these phrases mean the caller is
    // explaining a situation, not confirming a booking.
    const NARRATIVE_INDICATORS = /\b(i came|i was |i had |i have |i noticed|i went|i tried|i called|i got |i walked|i heard|i saw|i checked|i looked|i turned|i woke|it was |it started|it happened|it broke|it stopped|it keeps|you guys |you said|you told|you were|they said|they told|he said|she said|last time|yesterday|this morning|the other day|couple days|few days|a while|when i got|when i came|when we|came home|got home|walked in)\b/;
    if (NARRATIVE_INDICATORS.test(_norm)) {
      _inputIsNarrative = true;
    }

    // Guard 2: Trailing conjunction — caller was still talking when speech-to-text
    // captured the utterance. "okay yeah um I came in the house and" → interrupted.
    if (!_inputIsNarrative) {
      const _trimmed = _norm.replace(/\s+/g, ' ').trim();
      if (/\b(and|but|so|because|then|or|like|um|uh)$/.test(_trimmed)) {
        // Only treat trailing conjunction as narrative if utterance is substantial
        const _wordCount = _trimmed.split(' ').length;
        if (_wordCount > 6) {
          _inputIsNarrative = true;
        }
      }
    }

    // Guard 3: Length guard — long utterances where the only booking signals are
    // filler affirmatives ("okay", "yeah", "yes", "sure") are NOT booking confirmations.
    // A real booking confirmation is short and direct: "Yes please", "Yeah go ahead".
    if (!_inputIsNarrative && !_inputHasQuestion) {
      const _words = _norm.split(/\s+/).filter(Boolean);
      if (_words.length > 20) {
        // Check if the booking signal comes from filler affirmatives only
        const FILLER_AFFIRMATIVES = /^(yes|yeah|yep|yup|sure|ok|okay|alright|right|uh huh|mm hmm)$/;
        const _bookingWords = _words.filter(w => FILLER_AFFIRMATIVES.test(w));
        // If the ONLY booking-triggering words are fillers in a long utterance → narrative
        if (_bookingWords.length > 0 && _bookingWords.length <= 3) {
          _inputIsNarrative = true;
        }
      }
    }

    if (_inputIsNarrative) {
      logger.debug('[KC_ENGINE] GATE 1 — narrative filter suppressed booking intent', {
        companyId, callSid, turn, inputPreview: _clip(userInput, 60),
      });
    }

    // Compound intent: utterance has BOTH a booking signal AND a question/topic.
    // When true: skip immediate booking handoff, answer the KC question this turn,
    // then transition to BOOKING lane so v2twilio redirects after the response plays.
    const _hasCompoundBookingIntent = _inputHasQuestion && KCBookingIntentDetector.isBookingIntent(userInput);

    if (!_inputHasQuestion && !_inputIsNarrative && KCBookingIntentDetector.isBookingIntent(userInput)) {
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
    // ──────────────────────────────────────────────────────────────────────
    // uapDiagnostic — outer-scope snapshot so downstream events
    // (UAP_MISS_KEYWORD_RESCUED, KC_SECTION_GAP_RESCUED, KC_LLM_FALLBACK)
    // can carry a zero-heuristic answer to "why did UAP miss this turn?".
    // Stays null when GATE 2.4 already resolved the match (UAP never ran).
    // ──────────────────────────────────────────────────────────────────────
    let uapDiagnostic = null;

    // Only fire UAP if CueExtractor (GATE 2.4) didn't already resolve a match
    if (!match) try {
      uapResult = await UtteranceActParser.parse(companyId, userInput);

      // ── UAP diagnostic snapshot (zero-heuristic, populated as sub-gates run) ──
      // Captured here in outer scope so downstream events (UAP_MISS_KEYWORD_RESCUED,
      // SECTION_GAP_RESCUED, LLM_FALLBACK) can carry the exact "why UAP missed" reason.
      uapDiagnostic = {
        ran:            true,
        matchFound:     !!(uapResult?.containerId),
        bestCandidate:  uapResult?.containerId ? {
          containerId:  uapResult.containerId,
          kcId:         uapResult.kcId || null,
          sectionIdx:   uapResult.sectionIdx,
          sectionLabel: uapResult.sectionLabel,
          confidence:   uapResult.confidence,
          matchType:    uapResult.matchType,
          phrase:       uapResult.matchedPhrase,
          anchorWords:  uapResult.anchorWords || [],
          topicWords:   uapResult.topicWords || [],
        } : null,
        belowThreshold: uapResult?.containerId && uapResult.confidence < UAP_CONFIDENCE_THRESHOLD,
        anchorGate:     null,  // populated by Logic 1 below
        coreGate:       null,  // populated by Logic 2 below
      };

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

            const missedAnchorWords = anchorWords.filter(aw =>
              !inputExact.has(aw) && !inputStems.has(_stem(aw))
            );

            if (anchorRatio < ANCHOR_MATCH_THRESHOLD) {
              // ── LOGIC 1 FAIL — discriminating words missing → Groq ──
              anchorGatePassed = false;
              if (uapDiagnostic) uapDiagnostic.anchorGate = {
                required:  anchorWords.length,
                hits:      anchorHits,
                ratio:     Math.round(anchorRatio * 100) / 100,
                threshold: ANCHOR_MATCH_THRESHOLD,
                missed:    missedAnchorWords,
                passed:    false,
                reason:    'ANCHOR_WORDS_MISSING',
              };
              logger.info('[KC_ENGINE] LOGIC 1 FAIL — anchor words missing, falling through to Groq', {
                companyId, callSid, turn,
                anchorWords,
                anchorHits,
                anchorRatio: Math.round(anchorRatio * 100) + '%',
                threshold:   Math.round(ANCHOR_MATCH_THRESHOLD * 100) + '%',
                missed:      missedAnchorWords,
                sectionLabel: targetSection?.label,
              });
            } else if (uapResult.matchType === 'EXACT') {
              // ── EXACT BYPASS (per UAP.md §6) ──────────────────────────────
              // Logic 1 confirmed anchor words AND the entire callerPhrase was
              // a substring of the input → highest possible UAP signal. Skip
              // Logic 2 embedding round-trip (~50ms saved on every EXACT match).
              if (uapDiagnostic) uapDiagnostic.anchorGate = {
                required:  anchorWords.length,
                hits:      anchorHits,
                ratio:     Math.round(anchorRatio * 100) / 100,
                threshold: ANCHOR_MATCH_THRESHOLD,
                missed:    [],
                passed:    true,
                reason:    'EXACT_BYPASS',
              };
              logger.info('[KC_ENGINE] LOGIC 1 PASS — EXACT match, bypassing Logic 2', {
                companyId, callSid, turn,
                anchorWords,
                anchorHits,
                anchorRatio: Math.round(anchorRatio * 100) + '%',
                matchType:   uapResult.matchType,
                sectionLabel: targetSection?.label,
              });
            } else {
              // ── LOGIC 1 PASS — proceed to Logic 2 ──
              if (uapDiagnostic) uapDiagnostic.anchorGate = {
                required:  anchorWords.length,
                hits:      anchorHits,
                ratio:     Math.round(anchorRatio * 100) / 100,
                threshold: ANCHOR_MATCH_THRESHOLD,
                missed:    missedAnchorWords,
                passed:    true,
                reason:    'ANCHOR_WORDS_CONFIRMED',
              };
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
                  // ⚠️ FIX (April 2026, audit): was SemanticMatchService.embed()
                  // which doesn't exist on the module — silently returned undefined,
                  // disabling Logic 2 entirely in production for an unknown period.
                  // The exported function is .embedText (single-string embedder).
                  // GapReplay's mirrored implementation already used embedText, which
                  // is why GapReplay diagnostics could show Logic 2 cosine scores
                  // (e.g. 0.527) while production silently bypassed Logic 2 entirely.
                  const [callerCoreEmb, secDoc] = await Promise.all([
                    SemanticMatchService.embedText(callerCore),
                    CompanyKnowledgeContainer.findById(uapResult.containerId)
                      .select('+sections.phraseCoreEmbedding')
                      .lean(),
                  ]);

                  const phraseCoreEmb = secDoc?.sections?.[uapResult.sectionIdx]?.phraseCoreEmbedding;

                  // Defensive observability — if embedding came back falsy on a
                  // non-empty callerCore, log it loudly so a future broken
                  // embedder (OpenAI down, function rename, etc.) can't silently
                  // disable Logic 2 again. Routes on Logic 1 alone (graceful).
                  if (!callerCoreEmb?.length) {
                    logger.warn('[KC_ENGINE] LOGIC 2 SKIP — callerCore embed unavailable, routing on Logic 1 alone', {
                      companyId, callSid, turn,
                      callerCore:    callerCore.slice(0, 60),
                      hasPhraseCore: Boolean(phraseCoreEmb?.length),
                      sectionLabel:  targetSection?.label,
                    });
                  }

                  if (callerCoreEmb?.length && phraseCoreEmb?.length) {
                    // Cosine similarity
                    let dot = 0, ma = 0, mb = 0;
                    for (let _i = 0; _i < callerCoreEmb.length; _i++) {
                      dot += callerCoreEmb[_i] * phraseCoreEmb[_i];
                      ma  += callerCoreEmb[_i] * callerCoreEmb[_i];
                      mb  += phraseCoreEmb[_i] * phraseCoreEmb[_i];
                    }
                    const coreScore = (ma && mb) ? dot / (Math.sqrt(ma) * Math.sqrt(mb)) : 0;

                    if (uapDiagnostic) uapDiagnostic.coreGate = {
                      ran:        true,
                      score:      Math.round(coreScore * 1000) / 1000,
                      threshold:  CORE_MATCH_THRESHOLD,
                      passed:     coreScore >= CORE_MATCH_THRESHOLD,
                      callerCore: callerCore.slice(0, 120),
                    };

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
                  } else if (uapDiagnostic) {
                    // Logic 2 couldn't run (no embeddings available) — record "skipped"
                    uapDiagnostic.coreGate = {
                      ran:       false,
                      reason:    !callerCoreEmb?.length ? 'CALLER_EMBED_UNAVAILABLE' : 'PHRASE_CORE_ABSENT',
                      threshold: CORE_MATCH_THRESHOLD,
                    };
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
        // Enriched with uapDiagnostic so the Gap page can render anchor/core
        // gate details when hit=false (the "why UAP missed" answer).
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
            question:    userInput,
            anchorGate:  uapDiagnostic?.anchorGate || null,
            coreGate:    uapDiagnostic?.coreGate   || null,
            topicWords:  uapResult.topicWords || [],
            timestamp:   new Date().toISOString(),
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
              question:      userInput,
              belowThreshold: true,
              threshold:     UAP_CONFIDENCE_THRESHOLD,
              topicWords:    uapResult.topicWords || [],
              timestamp:     new Date().toISOString(),
            }],
          }).catch(() => {});
        }
      } else {
        // ── NEW (Phase A.1) — UAP found NO candidate at all ──
        // Previously silent. Without this write, the Gap page couldn't tell
        // the difference between "UAP ran but found no phrase" and "UAP
        // didn't run at all". Critical for diagnosing corpus coverage gaps.
        _writeDiscoveryNotes(companyId, callSid, {
          qaLog: [{
            type:       'UAP_LAYER1',
            hit:        false,
            turn:       turn ?? 0,
            question:   userInput,
            noCandidate: true,
            reason:     'NO_PHRASE_CANDIDATE',
            topicWords: uapResult?.topicWords || [],
            timestamp:  new Date().toISOString(),
          }],
        }).catch(() => {});
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
    // ──────────────────────────────────────────────────────────────────────
    // semanticDiagnostic — outer-scope snapshot of GATE 2.8 for downstream
    // qaLog enrichment (UAP_MISS_KEYWORD_RESCUED, KC_LLM_FALLBACK).
    // Null when GATE 2.8 never ran (earlier gate resolved match).
    // ──────────────────────────────────────────────────────────────────────
    let semanticDiagnostic = null;

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

        // ⚠️ CHANGED (Phase A.2): use diagnostic variant so we can emit
        // UAP_SEMANTIC_MISS with the best-below-threshold score. Accepted
        // match is at .match, closest-miss candidate at .bestBelowThreshold.
        const semanticDiag = await SemanticMatchService.findBestSectionDiagnostic(
          companyId, userInput, scorableEmbContainers
        );

        const semanticResult = semanticDiag?.match || null;

        // Capture diagnostic for downstream events
        semanticDiagnostic = semanticDiag ? {
          ran:       true,
          threshold: semanticDiag.threshold,
          accepted:  semanticResult ? {
            containerId:  String(semanticResult.container._id),
            kcId:         semanticResult.container.kcId || null,
            sectionIdx:   semanticResult.sectionIdx,
            sectionLabel: semanticResult.section?.label || null,
            similarity:   Math.round(semanticResult.similarity * 1000) / 1000,
            matchSource:  semanticResult.matchSource,
          } : null,
          bestBelow: semanticDiag.bestBelowThreshold ? {
            containerId:   String(semanticDiag.bestBelowThreshold.container._id),
            containerTitle: semanticDiag.bestBelowThreshold.container.title,
            kcId:          semanticDiag.bestBelowThreshold.container.kcId || null,
            sectionIdx:    semanticDiag.bestBelowThreshold.sectionIdx,
            sectionLabel:  semanticDiag.bestBelowThreshold.section?.label || null,
            similarity:    Math.round(semanticDiag.bestBelowThreshold.similarity * 1000) / 1000,
            matchSource:   semanticDiag.bestBelowThreshold.matchSource,
            matchedPhrase: semanticDiag.bestBelowThreshold.matchedPhrase || null,
          } : null,
        } : { ran: false, reason: 'OPENAI_UNAVAILABLE' };

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
        } else if (semanticDiagnostic?.bestBelow) {
          // ── NEW (Phase A.2) — emit UAP_SEMANTIC_MISS qaLog ──
          // Below threshold but *something* was close. Admin signal:
          // "tune this content / add this phrase as a callerPhrase".
          _writeDiscoveryNotes(companyId, callSid, {
            qaLog: [{
              type:           'UAP_SEMANTIC_MISS',
              turn:           turn ?? 0,
              question:       userInput,
              similarity:     semanticDiagnostic.bestBelow.similarity,
              threshold:      semanticDiagnostic.threshold,
              containerId:    semanticDiagnostic.bestBelow.containerId,
              containerTitle: semanticDiagnostic.bestBelow.containerTitle,
              kcId:           semanticDiagnostic.bestBelow.kcId,
              sectionIdx:     semanticDiagnostic.bestBelow.sectionIdx,
              sectionId:      buildSectionId(semanticDiagnostic.bestBelow.kcId, semanticDiagnostic.bestBelow.sectionIdx),
              sectionLabel:   semanticDiagnostic.bestBelow.sectionLabel,
              matchSource:    semanticDiagnostic.bestBelow.matchSource,
              matchedPhrase:  semanticDiagnostic.bestBelow.matchedPhrase,
              timestamp:      new Date().toISOString(),
            }],
          }).catch(() => {});
        }
      } catch (_semErr) {
        logger.warn('[KC_ENGINE] Semantic match error — falling through to keywords', {
          companyId, callSid, err: _semErr.message,
        });
        semanticDiagnostic = { ran: false, reason: 'SEMANTIC_ERROR', err: _semErr.message };
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 2.9 — UNIVERSAL NEGATIVE KEYWORD CHECKPOINT  (<1ms)
    // ══════════════════════════════════════════════════════════════════════════
    // negativeKeywords are only enforced inside findContainer (GATE 3).
    // Gates 2.4/2.4c/2.5/2.8 resolve matches without checking them — a phrase
    // match or embedding similarity hit bypasses the keyword filter entirely.
    //
    // Example: caller says "I already told you that my AC isn't cooling."
    //   → UAP EXACT-matches Recovery phrase "I already told you that" at 0.95
    //   → Anchor gate passes (anchor words present)
    //   → GATE 3 never fires → 36 HVAC negativeKeywords on Recovery never checked
    //   → Caller gets Recovery response instead of No Cooling diagnostic
    //
    // FIX: If the matched section has negativeKeywords that appear in the
    // caller's utterance, SUPPRESS the match. GATE 3 re-evaluates with its
    // own built-in negativeKeyword check and routes to the correct container.
    //
    // When targetSection is null (container-level CueExtractor match), check
    // ALL active sections — if ANY section's negativeKeywords match, suppress.
    // Container-level matches send all sections to Groq, so a negative keyword
    // on ANY section means the utterance contains content outside this
    // container's domain.
    //
    // PERF: Pure string matching on short keyword lists. <1ms.
    // ══════════════════════════════════════════════════════════════════════════

    if (match && match.container) {
      const _nkInputLower = (userInput || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
      const _nkInputWords = new Set(_nkInputLower.split(/\s+/).filter(Boolean));

      /**
       * Check if any negativeKeyword in the list matches the caller's utterance.
       * Single-word keywords: whole-word match (Set lookup).
       * Multi-word keywords: substring match (covers bigrams like "air conditioning").
       */
      const _negKwHit = (negKws) => {
        if (!Array.isArray(negKws) || !negKws.length) return null;
        for (const nk of negKws) {
          const nkNorm = (nk || '').toLowerCase().trim();
          if (!nkNorm) continue;
          if (nkNorm.includes(' ')) {
            if (_nkInputLower.includes(nkNorm)) return nkNorm;
          } else {
            if (_nkInputWords.has(nkNorm)) return nkNorm;
          }
        }
        return null;
      };

      let _nkBlocked    = false;
      let _nkBlockedBy  = null;
      let _nkBlockLabel = null;

      if (match.targetSection) {
        // Section-level match — check that section's negativeKeywords
        const hit = _negKwHit(match.targetSection.negativeKeywords);
        if (hit) {
          _nkBlocked    = true;
          _nkBlockedBy  = hit;
          _nkBlockLabel = match.targetSection.label || '(section)';
        }
      } else {
        // Container-level match (no targetSection) — check ALL active sections.
        // If ANY section's negativeKeywords match, the utterance contains content
        // outside this container's domain — suppress and let GATE 3 re-score.
        const _allSections = match.container.sections || [];
        for (const _sec of _allSections) {
          if (_sec.isActive === false) continue;
          const hit = _negKwHit(_sec.negativeKeywords);
          if (hit) {
            _nkBlocked    = true;
            _nkBlockedBy  = hit;
            _nkBlockLabel = _sec.label || '(section)';
            break;
          }
        }
      }

      if (_nkBlocked) {
        logger.info('[KC_ENGINE] 🚫 GATE 2.9: NEGATIVE_KEYWORD_BLOCK — match suppressed', {
          companyId, callSid, turn,
          matchSource:    match.matchSource,
          containerTitle: match.container.title,
          sectionLabel:   _nkBlockLabel,
          blockedBy:      _nkBlockedBy,
          score:          match.score,
          inputPreview:   _clip(userInput, 80),
        });

        emit('KC_NEGATIVE_KEYWORD_BLOCK', {
          companyId, callSid, turn,
          matchSource:    match.matchSource,
          containerTitle: match.container.title,
          sectionLabel:   _nkBlockLabel,
          blockedBy:      _nkBlockedBy,
        });

        // Write to qaLog so Gaps & Todo page tracks suppressed matches
        _writeDiscoveryNotes(companyId, callSid, {
          qaLog: [{
            type:           'NEGATIVE_KEYWORD_BLOCK',
            turn:           turn ?? 0,
            question:       userInput,
            matchSource:    match.matchSource,
            containerTitle: match.container.title,
            containerId:    String(match.container._id || ''),
            kcId:           match.container.kcId || null,
            sectionLabel:   _nkBlockLabel,
            blockedBy:      _nkBlockedBy,
            timestamp:      new Date().toISOString(),
          }],
        }).catch(() => {});

        match = null;  // Suppress — GATE 3 re-evaluates with its own negKw check
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GATE 3 — KEYWORD FALLBACK — contentKeywords + title scoring  (<1ms)
    // ──────────────────────────────────────────────────────────────────────────
    // findContainer() returns bestMatch shapes WITHOUT matchSource. We tag it
    // here as 'KEYWORD' so downstream gates (UAP_MISS_KEYWORD_RESCUED logging,
    // GATE 2.9 negKw, NEGATIVE_KEYWORD_BLOCK qaLog) can attribute the source.
    // Wrapped in try/catch — a corrupted container should fall through to GATE 4
    // LLM fallback, not crash run() and trigger COMPUTE_CRASH recovery.
    // ══════════════════════════════════════════════════════════════════════════
    if (!match) {
      try {
        const _kcsMatch = KCS.findContainer(scorableContainers, userInput, callContext);
        if (_kcsMatch) match = { ..._kcsMatch, matchSource: 'KEYWORD' };
      } catch (_kcsErr) {
        logger.warn('[KC_ENGINE] GATE 3 keyword scoring error — falling through to LLM', {
          companyId, callSid, turn,
          err: _kcsErr?.message || String(_kcsErr),
        });
      }
    }

    // Carry bestSection from findContainer into the match for section routing
    if (match && match.bestSection && !match.targetSection) {
      match.targetSection    = match.bestSection;
      match.targetSectionIdx = match.bestSectionIdx ?? null;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // UAP_MISS_KEYWORD_RESCUED — Gap signal (April 2026)
    // ──────────────────────────────────────────────────────────────────────────
    // If GATE 3 (KEYWORD) produced the winning match, then GATE 2.4 (CueExtract),
    // GATE 2.5 (UAP Layer 1) and GATE 2.8 (Semantic) all missed. This is the
    // single most actionable signal for the admin Gap page: a phrase we should
    // add to UAP so next time the same caller utterance resolves sub-millisecond
    // instead of requiring full keyword scoring.
    //
    // Fire-and-forget enrichment — same pattern as other qaLog writes.
    // ══════════════════════════════════════════════════════════════════════════
    if (match && match.matchSource === 'KEYWORD') {
      _writeDiscoveryNotes(companyId, callSid, {
        qaLog: [{
          type:                   'UAP_MISS_KEYWORD_RESCUED',
          turn:                   turn ?? 0,
          question:               userInput,
          rescuedContainerId:     String(match.container?._id || ''),
          rescuedContainerTitle:  match.container?.title || 'Unknown',
          rescuedKcId:            match.container?.kcId || null,
          rescuedSection:         match.targetSection?.label || match.bestSection?.label || null,
          rescuedSectionIdx:      match.targetSectionIdx ?? match.bestSectionIdx ?? null,
          rescuedSectionId:       buildSectionId(
                                    match.container?.kcId,
                                    match.targetSectionIdx ?? match.bestSectionIdx
                                  ),
          rescuedScore:           match.score ?? null,
          anchorContainerId:      callContext?.anchorContainerId || null,
          cueFrame: cueFrame ? {
            fieldCount:           cueFrame.fieldCount ?? 0,
            topicWords:           cueFrame.topicWords || [],
            actionCore:           cueFrame.actionCore || null,
            modifierCore:         cueFrame.modifierCore || null,
            urgencyCore:          cueFrame.urgencyCore || null,
            permissionCue:        cueFrame.permissionCue || null,
            requestCue:           cueFrame.requestCue || null,
            infoCue:              cueFrame.infoCue || null,
            directiveCue:         cueFrame.directiveCue || null,
            tradeMatches:         Array.isArray(cueFrame.tradeMatches)
                                    ? cueFrame.tradeMatches.map(t => t.term).filter(Boolean)
                                    : [],
          } : null,
          // ── NEW (Phase A.3) — pre-gate snapshots so the Gap page can
          // render a complete "here's why 2.4/2.5/2.8 all missed" timeline
          // on every rescue, not just the rescue decision itself. Without
          // these, the admin has to guess what got close.
          uap25: uapDiagnostic ? {
            ran:            uapDiagnostic.ran,
            matchFound:     uapDiagnostic.matchFound,
            bestCandidate:  uapDiagnostic.bestCandidate,
            belowThreshold: uapDiagnostic.belowThreshold,
            anchorGate:     uapDiagnostic.anchorGate,
            coreGate:       uapDiagnostic.coreGate,
          } : null,
          semantic28: semanticDiagnostic ? {
            ran:       semanticDiagnostic.ran,
            threshold: semanticDiagnostic.threshold,
            bestBelow: semanticDiagnostic.bestBelow,
            reason:    semanticDiagnostic.reason || null,
          } : null,
          timestamp:              new Date().toISOString(),
        }],
      }).catch(() => {});
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

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION GAP — CROSS-CONTAINER RESCUE (April 2026)
    // ═══════════════════════════════════════════════════════════════════════
    // Before accepting the Section GAP (matched container has no specific
    // section), re-score ALL containers WITHOUT the anchor multiplier. If
    // another container's raw score wins AND has a real section match, route
    // there instead of falling into the gap pre-filter.
    //
    // Why this exists: the 3× anchor boost is excellent for staying on-topic
    // across follow-up turns ("how much is it?" stays in No Cooling). But when
    // the caller explicitly shifts topic ("do I have to pay for another
    // service call?"), the anchor can pin the conversation to the WRONG
    // container. The question belongs in Diagnostic Fee — but No Cooling's 3×
    // boost prevents Diagnostic Fee's natural score from winning.
    //
    // Rescue fires BEFORE gap pre-filter so we answer with a real section from
    // a different container instead of dumping ranked sections from the wrong
    // container into Groq.
    //
    // After swap: targetSection is populated → section-gap block below does
    // not fire → _handleKCMatch proceeds with the correct container + section.
    if (match && match.container && !match.targetSection && scorableContainers.length > 1) {
      const _rescueContext = { ...callContext, anchorContainerId: null };
      const _rescueMatch   = KCS.findContainer(scorableContainers, userInput, _rescueContext);

      // noAnchor guard (audit fix): meta-containers (Recovery, Price Objections,
      // Appointment Management, etc.) must NEVER win rescue. They are
      // conversational mechanics, not knowledge answers. Without this guard a
      // caller's real topic question could be hijacked by Recovery KC, which
      // would then be routed through _handleKCMatch — Recovery's content would
      // answer the topic question incorrectly and Recovery container state
      // (even though noAnchor prevents callReason pollution) would briefly
      // appear as the active topic for this turn.
      if (_rescueMatch?.container?._id
          && !_rescueMatch.container.noAnchor
          && _rescueMatch.bestSection
          && String(_rescueMatch.container._id) !== String(match.container._id)) {

        const _origTitle   = match.container.title || 'Unknown';
        const _rescueTitle = _rescueMatch.container.title || 'Unknown';

        logger.info('[KC_ENGINE] ✅ SECTION_GAP_RESCUED — cross-container recovery', {
          companyId, callSid, turn,
          originalContainer: _origTitle,
          originalScore:     match.score,
          rescuedContainer:  _rescueTitle,
          rescuedScore:      _rescueMatch.score,
          rescuedSection:    _rescueMatch.bestSection.label,
          inputPreview:      _clip(userInput, 80),
        });

        emit('KC_SECTION_GAP_RESCUED', {
          originalContainer: _origTitle,
          rescuedContainer:  _rescueTitle,
          rescuedSection:    _rescueMatch.bestSection.label,
          originalScore:     match.score,
          rescuedScore:      _rescueMatch.score,
          userInput:         _clip(userInput, 100),
          turn,
        });

        // qaLog — record the rescue for Calibration dashboard
        _writeDiscoveryNotes(companyId, callSid, {
          qaLog: [{
            type:              'KC_SECTION_GAP_RESCUED',
            turn:              turn ?? 0,
            question:          userInput,
            originalContainer: _origTitle,
            rescuedContainer:  _rescueTitle,
            rescuedSection:    _rescueMatch.bestSection.label,
            timestamp:         new Date().toISOString(),
          }],
        }).catch(() => {});

        // SWAP: use rescued match + hydrate targetSection for _handleKCMatch
        match = {
          ..._rescueMatch,
          targetSection:    _rescueMatch.bestSection,
          targetSectionIdx: _rescueMatch.bestSectionIdx ?? null,
          matchSource:      'CROSS_CONTAINER_RESCUE',
        };
      }
    }

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

      // ── Section pre-filter: narrow N sections before Groq ────────────
      // Instead of dumping 200+ sections into Groq, score them against the
      // caller utterance and send only the top GAP_MAX_SECTIONS. Groq still
      // synthesizes from deep content — but from a focused window.
      const _allSections = match.container.sections || [];
      let _gapFiltered      = false;
      let _gapOriginalCount = _allSections.length;
      let _gapFilteredCount = _allSections.length;
      let _gapTopSections   = [];

      if (_allSections.length > GAP_MAX_SECTIONS) {
        const _topSections = _scoreSectionsForGap(_allSections, userInput, cueFrame);

        if (_topSections.length > 0) {
          _gapFiltered      = true;
          _gapFilteredCount = _topSections.length;
          _gapTopSections   = _topSections.map(s => ({
            label: s.section.label,
            idx:   s.index,
            score: s._gapScore,
          }));

          // Shallow-clone container with only top-scoring sections
          match.container = {
            ...match.container,
            sections:          _topSections.map(s => s.section),
            _gapFiltered:      true,
            _gapOriginalCount,
            _gapFilteredCount,
            _gapTopScores:     _gapTopSections,
          };

          logger.info('[KC_ENGINE] SECTION GAP — pre-filtered for Groq', {
            companyId, callSid, turn,
            containerTitle: _gapContainerTitle,
            originalSections: _gapOriginalCount,
            filteredTo:       _gapFilteredCount,
            topSections:      _gapTopSections.map(s => `${s.label} (${s.score})`).join(', '),
          });
        } else {
          logger.debug('[KC_ENGINE] SECTION GAP — no sections scored > 0, Groq gets all', {
            companyId, callSid, turn, sectionCount: _allSections.length,
          });
        }
      }

      // qaLog: record section gap + filter metadata for Gaps & Todo page
      _writeDiscoveryNotes(companyId, callSid, {
        qaLog: [{
          type:             'KC_SECTION_GAP',
          turn:             turn ?? 0,
          question:         userInput,
          containerTitle:   _gapContainerTitle,
          containerId:      _gapContainerId,
          kcId:             _gapKcId,
          gapFiltered:      _gapFiltered,
          gapOriginalCount: _gapOriginalCount,
          gapFilteredCount: _gapFilteredCount,
          gapTopSections:   _gapTopSections,
          timestamp:        new Date().toISOString(),
        }],
      }).catch(() => {});

      // ── KC_SECTION_GAP → Claude answer-from-kb (April 17, 2026) ───────
      // When the container matches but no section clears, Groq synthesis
      // of the full (or pre-filtered) section list tends to produce
      // deflections ("let me see what's going on", "I'd need to confirm
      // that exact pricing") — dead-air promises with no backing lookup.
      //
      // Instead, route directly to Claude with answer-from-kb posture:
      //   - composeSystemPrompt(mode='answer-from-kb') bans "let me check"
      //     as final words and demands an ANSWER from KB
      //   - callContext enriches with caller identity, prior visits,
      //     repeat issues, rejected topics, recent QA
      //   - kcContext is the top-N sections from THIS container (already
      //     pre-filtered above) so Claude has focused, relevant content
      //
      // This is the "save the call" path for container-matched-no-section
      // — the caller hit real territory; Claude now delivers a real answer.
      logger.info('[KC_ENGINE] SECTION GAP → routing to Claude answer-from-kb (bypass Groq deflection)', {
        companyId, callSid, turn,
        containerTitle:  _gapContainerTitle,
        sectionCount:    (match.container.sections || []).length,
        gapFiltered:     _gapFiltered,
        filteredTo:      _gapFilteredCount,
      });

      return await _handleLLMFallback({
        userInput, companyId, callSid, company, channel, nextState, emit, startMs, turn,
        bridgeToken, redis, callerName, onSentence,
        containers:     [match.container],   // single-container focus for kcContext
        ehConfig,
        notes,                               // enriched callContext source
        cueFrame,                            // for section ranking
        fallbackReason: 'kc_section_gap',    // distinguishes from no_kc_match in logs
        uapDiagnostic,                       // Phase A.3 — GATE 2.5 timeline
        semanticDiagnostic,                  // Phase A.3 — GATE 2.8 timeline
      });
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
        notes,                         // carry discoveryNotes for LLM fallback
        containers: scorableContainers,// for KC section ranking on Groq-error fallback
        cueFrame,                      // for KC section ranking on Groq-error fallback
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
      cueFrame,     // CueExtractor output for KC section ranking
      uapDiagnostic,         // Phase A.3 — GATE 2.5 "why UAP missed" snapshot
      semanticDiagnostic,    // Phase A.3 — GATE 2.8 "closest miss" snapshot
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

  // Pass 2a — write Groq $ per turn to qaLog (fire-and-forget, cheap)
  // Previously only Claude fallback cost was tracked (Phase A.4); now every
  // Groq formatter call contributes to the per-call cost rollup too.
  {
    const _groqCost = _computeGroqCost(kcResult.tokensUsed, company);
    _writeDiscoveryNotes(companyId, callSid, {
      qaLog: [{
        type:            'KC_GROQ_ANSWERED',
        turn,
        question:        userInput,
        source:          'prequal',
        containerId,
        containerTitle,
        latencyMs:       kcResult.latencyMs || null,
        tokensUsed:      kcResult.tokensUsed || null,
        cost:            _groqCost ? { usd: _groqCost.totalUsd, input: _groqCost.inputTokens, output: _groqCost.outputTokens, model: _groqCost.model, rate: _groqCost.rate } : null,
        timestamp:       new Date().toISOString(),
      }],
    }).catch(() => {});
  }

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
  notes                  = null,   // discoveryNotes — carried for LLM fallback enrichment
  containers             = [],     // scorableContainers — for KC section ranking on fallback
  cueFrame               = null,   // CueExtractor output — for KC section ranking on fallback
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
      notes,        // carry discoveryNotes so enriched callContext reaches Claude
      containers,   // for KC section ranking — Claude gets knowledge context
      cueFrame,     // for KC section ranking
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
    // noAnchor containers (Recovery, meta-conversation) never overwrite callReason —
    // "Conversational Recovery" as callReason is meaningless and pollutes notes.
    _writeDiscoveryNotes(companyId, callSid, {
      ...(!container.noAnchor ? { callReason: containerTitle } : {}),
      objective:         'BOOKING',
      turnNumber:        turn ?? 0,
      ...(!container.noAnchor ? { anchorContainerId: containerId } : {}),   // noAnchor containers (e.g. Recovery) never set anchor
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
  // noAnchor containers (Recovery, meta-conversation) never overwrite callReason —
  // "Conversational Recovery" as callReason is meaningless and pollutes notes.
  _writeDiscoveryNotes(companyId, callSid, {
    ...(!container.noAnchor ? { callReason: containerTitle } : {}),
    objective:           'DISCOVERY',
    turnNumber:          turn ?? 0,
    ...(!container.noAnchor ? { anchorContainerId: containerId } : {}),   // noAnchor containers (e.g. Recovery) never set anchor
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
      ...(!container.noAnchor ? { callReason: containerTitle } : {}),
      objective:         'BOOKING',
      turnNumber:        turn ?? 0,
      ...(!container.noAnchor ? { anchorContainerId: containerId } : {}),   // noAnchor containers (e.g. Recovery) never set anchor
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

  // Pass 2a — write Groq $ per turn to qaLog (fire-and-forget, cheap)
  // This is the primary Groq answer path. Every KC direct answer contributes
  // to the per-call cost rollup.
  {
    const _groqCost = _computeGroqCost(kcResult.tokensUsed, company);
    _writeDiscoveryNotes(companyId, callSid, {
      qaLog: [{
        type:            'KC_GROQ_ANSWERED',
        turn,
        question:        userInput,
        source:          'direct',
        containerId,
        containerTitle,
        kcId:            container.kcId || null,
        latencyMs:       kcResult.latencyMs || null,
        tokensUsed:      kcResult.tokensUsed || null,
        cost:            _groqCost ? { usd: _groqCost.totalUsd, input: _groqCost.inputTokens, output: _groqCost.outputTokens, model: _groqCost.model, rate: _groqCost.rate } : null,
        timestamp:       new Date().toISOString(),
      }],
    }).catch(() => {});
  }

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
// _buildCallContext — Enriched callContext for LLM fallback
//
// Packages discoveryNotes + callerProfile (from CallerRecognition pre-warm) +
// behaviorBlock into a single rich context object consumed by Agent2 LLM
// (Claude) via callLLMAgentForFollowUp → composeSystemPrompt.
//
// Why this exists: prior version only surfaced firstName + callReason + urgency.
// That left the LLM blind to the caller's history — so when KC missed and
// Claude fell back, it had no way to open with an acknowledgment ("I see Tony
// was here last month") and ended up deflecting with "let me check on that"
// (dead air). This helper surfaces the knowledge Claude needs to acknowledge
// the caller by name, reflect on their prior visit, and answer confidently.
//
// Surfaces (all optional — missing fields are simply omitted):
//   caller:         { firstName, speakable }
//   issue:          { summary }                 — current callReason
//   urgency:        { level, reason }           — only if 'high'
//   priorVisits:    [{ daysAgo, reason, staff }]— last confirmed visit
//   visitCount:     number                       — if >1
//   repeatIssue:    { detected, reason }         — same issue 2+ times
//   rejectedTopics: string[]                     — don't re-offer these
//   recentQA:       [{ question, answer }]       — last 2 turns this call
//   behaviorBlock:  string                       — Engine Hub discovery_flow BC
// ============================================================================
function _buildCallContext(notes, behaviorBlock) {
  if (!notes && !behaviorBlock) return null;

  const ctx = {};

  // Caller identity — prefer current-call entities, fallback to pre-warmed profile
  const firstName = notes?.entities?.firstName
    || notes?.temp?.firstName
    || notes?.callerProfile?.lastConfirmed?.firstName
    || null;
  if (firstName) {
    ctx.caller = { firstName, speakable: true };
  }

  // Current call reason / objective
  if (notes?.callReason) {
    ctx.issue = { summary: notes.callReason };
  } else if (notes?.objective && notes.objective !== 'INTAKE') {
    ctx.issue = { summary: notes.objective };
  }

  // Urgency — surface only 'high' to avoid noise
  if (notes?.urgency === 'high') {
    ctx.urgency = { level: 'high', reason: notes.callReason || null };
  }

  // Prior visits — summarize last confirmed visit from pre-warmed callerProfile
  const cp = notes?.callerProfile;
  if (cp?.isKnown && cp?.visitCount > 0) {
    const priorVisits = [];
    if (cp.lastCallDate && cp.lastCallReason) {
      const ms = Date.now() - new Date(cp.lastCallDate).getTime();
      const daysAgo = ms > 0 ? Math.floor(ms / 86400000) : null;
      const staff = cp.lastConfirmed?.staffInvolved || null;
      priorVisits.push({
        daysAgo,
        reason: cp.lastCallReason,
        staff,
      });
    }
    if (priorVisits.length > 0) ctx.priorVisits = priorVisits;
    if (cp.visitCount > 1) ctx.visitCount = cp.visitCount;
  }

  // Repeat-issue signal — caller has called about the same thing 2+ times
  if (cp?.repeatIssueDetected && cp?.repeatIssueReason) {
    ctx.repeatIssue = { detected: true, reason: cp.repeatIssueReason };
  }

  // Rejected topics — don't re-offer what the caller has pushed back on this call
  if (Array.isArray(notes?.rejectedTopics) && notes.rejectedTopics.length > 0) {
    ctx.rejectedTopics = notes.rejectedTopics.slice(-5);
  }

  // Recent QA — last 2 meaningful Q&A pairs from this call (skip diagnostics)
  if (Array.isArray(notes?.qaLog) && notes.qaLog.length > 0) {
    const recentQA = notes.qaLog
      .filter(q => q?.question && q?.answer)
      .slice(-2)
      .map(q => ({
        question: String(q.question).slice(0, 120),
        answer:   String(q.answer).slice(0, 120),
      }));
    if (recentQA.length > 0) ctx.recentQA = recentQA;
  }

  // Engine Hub discovery_flow BC rules
  if (behaviorBlock) {
    ctx.behaviorBlock = behaviorBlock;
  }

  return Object.keys(ctx).length > 0 ? ctx : null;
}

// ============================================================================
// HANDLER: LLM FALLBACK (Claude, bucket=COMPLEX)
// ============================================================================

async function _handleLLMFallback({
  userInput, companyId, callSid, company, channel, nextState, emit,
  startMs, turn, bridgeToken, redis, callerName, onSentence,
  containers         = [],
  notes              = null,
  ehConfig           = null,   // Engine Hub runtime config (null = disabled/passive)
  cueFrame           = null,   // CueExtractor output — used for KC section ranking
  fallbackReason     = null,   // Caller-supplied reason override (e.g. 'kc_section_gap')
  uapDiagnostic      = null,   // Phase A.3 — GATE 2.5 "why UAP missed" snapshot
  semanticDiagnostic = null,   // Phase A.3 — GATE 2.8 "closest miss" snapshot
}) {
  // Reason resolution: explicit override wins, else default based on container count.
  // 'kc_section_gap'          → container matched but no section (answer-from-kb save)
  // 'no_kc_match'             → no container scored above threshold
  // 'no_containers_configured'→ company has zero scorable containers
  const _reason = fallbackReason
    || (containers.length ? 'no_kc_match' : 'no_containers_configured');

  logger.info('[KC_ENGINE] Firing LLM fallback (Claude COMPLEX, answer-from-kb)', {
    companyId, callSid, turn, inputPreview: _clip(userInput, 40),
    containerCount: containers.length,
    reason:         _reason,
  });

  // Emit rich diagnostic payload so Call Intelligence can explain WHY KC
  // fell back and which containers were searched — critical for debugging.
  emit('KC_LLM_FALLBACK_FIRED', {
    companyId, callSid, turn,
    reason:          _reason,
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

  // Build enriched callContext — surfaces caller history, prior visits, repeat
  // issues, rejected topics, and recent QA so Claude can acknowledge the
  // caller by name, reflect on their history, and answer confidently from KB.
  // See _buildCallContext() above for the full field list.
  const callContext = _buildCallContext(notes, behaviorBlock);

  // ── KC KNOWLEDGE INJECTION (April 2026) ──────────────────────────────────
  // Rank top sections across ALL containers by relevance to the caller's
  // question, then inject them into Claude's system prompt. This is the
  // final-save knowledge path: KC routing missed, but the answer probably
  // lives in KC content. Don't let Claude answer blind.
  //
  // noAnchor containers (Recovery, etc.) are excluded — their content is
  // conversational mechanics, not knowledge answers.
  let kcContext = null;
  if (containers.length > 0) {
    const _topKc = _rankTopKCSections(containers, userInput, cueFrame);
    if (_topKc.length > 0) {
      kcContext = _topKc;
      logger.info('[KC_ENGINE] 💡 LLM_FALLBACK — injecting top KC sections', {
        companyId, callSid, turn,
        sectionCount: _topKc.length,
        topSections:  _topKc.slice(0, 3).map(e => `${e.container.title}/${e.section.label} (${e.score})`),
      });
    }
  }

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
      callContext,                     // enriched discoveryNotes + callerProfile
      mode:                'answer-from-kb', // shift prompt posture: ANSWER, don't defer
      kcContext,                       // top-N KC sections across all containers
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

    // qaLog: record LLM fallback for Calibration dashboard.
    // Section-gap calls ride the same Claude path but are tagged distinctly so
    // the Gaps & Todo page can render them as "container matched, Claude saved
    // the call" rather than "no KC match" — very different signals for the admin.
    const _qaType = _reason === 'kc_section_gap'
      ? 'KC_SECTION_GAP_ANSWERED'
      : 'KC_LLM_FALLBACK';
    // Phase A.4 — cost tracking. Every LLM fallback = real $. Admin
    // needs per-turn $ to compute weekly/monthly spend from qaLog alone
    // and prioritize which UAP misses to fix (highest $ = highest ROI).
    const _cost = _computeClaudeCost(llmResult.tokensUsed, company);

    _writeDiscoveryNotes(companyId, callSid, {
      qaLog: [{
        type:      _qaType,
        turn:      turn ?? 0,
        question:  userInput,
        answer:    llmResult.response?.slice(0, 200) || null,
        reason:    _reason,
        // Phase A.3 — carry the full "why every gate missed" timeline so
        // the Gap page can render a complete forensic view on LLM fallbacks,
        // not just the "Groq answered" footprint.
        uap25: uapDiagnostic ? {
          ran:            uapDiagnostic.ran,
          matchFound:     uapDiagnostic.matchFound,
          bestCandidate:  uapDiagnostic.bestCandidate,
          belowThreshold: uapDiagnostic.belowThreshold,
          anchorGate:     uapDiagnostic.anchorGate,
          coreGate:       uapDiagnostic.coreGate,
        } : null,
        semantic28: semanticDiagnostic ? {
          ran:       semanticDiagnostic.ran,
          threshold: semanticDiagnostic.threshold,
          bestBelow: semanticDiagnostic.bestBelow,
          reason:    semanticDiagnostic.reason || null,
        } : null,
        // Phase A.4 — derived $ per turn (null when tokensUsed unavailable).
        // Normalize to same shape the aggregator expects ({usd,input,output,model,rate})
        // so KC_LLM_FALLBACK turns show up in the Cost Breakdown drawer.
        cost:      _cost ? { usd: _cost.totalUsd, input: _cost.inputTokens, output: _cost.outputTokens, model: _cost.model, rate: _cost.rate } : null,
        latencyMs: Date.now() - startMs,
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

'use strict';

/**
 * ============================================================================
 * KNOWLEDGE CONTAINER SERVICE
 * ============================================================================
 *
 * Unified Groq-powered informational Q&A engine for the Knowledge Container
 * system. Handles detect → retrieve → match → answer for any caller question
 * that can be answered from a company-authored knowledge container.
 *
 * PURPOSE:
 *   A caller asks "what does the maintenance include?" or "do you have any
 *   specials?" or "how much is a service call?". Instead of routing to three
 *   separate interceptors that may have keyword overlap, KnowledgeContainerService
 *   fires first. Groq reads the full matching container and responds naturally,
 *   bounded to admin-written facts. No hallucination. No wrong interceptor.
 *
 * INTEGRATION POINTS (wired in Agent2DiscoveryRunner.js):
 *   A) ASKING_SPECIALS bucket  — before PromotionsInterceptor
 *   B) ASKING_PRICING bucket   — before PricingInterceptor
 *   C) callLLMAgentForNoMatch  — after PricingConversationService, before Claude T2
 *
 * MULTI-TENANT SAFETY:
 *   All cache keys and MongoDB queries are scoped to companyId.
 *   No cross-tenant data leakage possible.
 *
 * GRACEFUL DEGRADE:
 *   Redis down → falls through to MongoDB.
 *   Groq failure → returns { intent: 'ERROR', response: null }.
 *   Caller code always falls through to existing behavior. Call never breaks.
 *
 * BOOKING OFFER:
 *   bookingOfferMode 'groq'  — Groq is instructed to naturally close with a
 *                              scheduling invitation, fitted to the conversation.
 *   bookingOfferMode 'fixed' — Groq appends the exact bookingOfferPhrase from
 *                              knowledgeBaseSettings verbatim after its answer.
 *
 * ============================================================================
 */

const GroqStreamAdapter          = require('../../streaming/adapters/GroqStreamAdapter');
const CompanyKnowledgeContainer  = require('../../../models/CompanyKnowledgeContainer');
const CompanyTriggerSettings     = require('../../../models/CompanyTriggerSettings');
const logger                     = require('../../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Valid intent values returned in the Groq JSON response */
const INTENT = {
  ANSWERED:       'ANSWERED',       // Groq answered from container; conversation continues
  BOOKING_READY:  'BOOKING_READY',  // Caller signalled readiness to schedule
  NO_DATA:        'NO_DATA',        // Container matched but Groq found no relevant answer
  ERROR:          'ERROR',          // Groq failure — graceful degrade, caller falls through
};

/** Groq max_tokens — concise phone answers with room for booking offer */
const MAX_TOKENS = 180;

/** Temperature — very low for factual, bounded responses */
const TEMPERATURE = 0.15;

/** Built-in booking offer when company bookingOfferPhrase is blank and mode is fixed */
const BUILT_IN_BOOKING_OFFER = 'Would you like to schedule that today?';

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL TABLE
// Broad set of informational signals used by detect() as the initial gate.
// Includes all PRICING_SIGNALS (re-used, not duplicated) plus general info signals.
// ─────────────────────────────────────────────────────────────────────────────

const KNOWLEDGE_SIGNALS = [
  // Cost / price / fee
  'how much', 'how much is', 'how much for', 'how much does', 'how much will',
  'what does it cost', 'what will it cost', 'what does that cost',
  'what is the cost', 'what is the fee', 'what is the price', 'whats the fee',
  'what are your rates', 'what are the rates', 'what are your prices',
  'what is the charge', 'what do you charge', 'how much do you charge',
  'cost', 'price', 'pricing', 'rate', 'rates', 'fee', 'fees', 'charge',
  // Service cost signals
  'service call', 'diagnostic fee', 'service fee', 'visit fee', 'trip charge',
  'call out', 'callout', 'come out', 'send someone',
  'maintenance plan', 'tune up', 'tune-up', 'annual plan',
  'duct cleaning', 'air duct', 'hvac cleaning',
  'emergency fee', 'after hours', 'after-hours', 'weekend rate',
  'install', 'installation cost', 'replacement cost',
  // Credit / waiver
  'credited', 'credit', 'applied to', 'go towards', 'waived', 'waive',
  'diagnostic credit', 'service call credit',
  // Inclusion / detail queries
  'what does it include', 'what is included', 'what comes with',
  'what do you do', 'whats included', "what's included",
  'what does the service include', 'what is covered',
  'include', 'includes', 'included',
  // Specials / promotions
  'special', 'specials', 'deal', 'deals', 'promo', 'promotion', 'promotions',
  'discount', 'discounts', 'offer', 'offers', 'coupon', 'sale',
  'do you have', 'any specials', 'any deals', 'any discounts',
  // Warranty / guarantee
  'warranty', 'guarantee', 'guaranteed', 'covered', 'coverage',
  'how long', 'duration', 'how long does', 'how long will',
  // General info
  'what is', 'what are', 'tell me about', 'explain', 'describe',
  'do you offer', 'do you have', 'can you do', 'available',
  'availability', 'schedule', 'when can', 'how soon',
  // Policy
  'policy', 'policies', 'terms', 'contract', 'agreement',
];

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CACHE
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL = 900; // 15 minutes

let _redis = null;
function _getRedis() {
  if (_redis) return _redis;
  try {
    _redis = require('../../../services/redis/redisClient');
  } catch (_e) { /* Redis not available — graceful degrade */ }
  return _redis;
}

function _cacheKey(companyId) {
  return `knowledge:${companyId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIABLE SUBSTITUTION
// {placeholder} → real value, resolved from CompanyTriggerSettings.companyVariables
// Same store as trigger card variables (triggers.html). Zero extra UI needed —
// any variable defined there is automatically available in KC section content.
// ─────────────────────────────────────────────────────────────────────────────

/** Per-process lazy cache — same pattern as triggerVariablesCache in Agent2DiscoveryRunner */
const _kcVarCache = new Map();

/**
 * _resolveKCVariables — Substitute {placeholders} in KC section content
 * with company-defined variables before the block reaches Groq.
 *
 * Example:  "Service call fee: {servicecallfee}" → "Service call fee: $69"
 *
 * Graceful degrade: if CompanyTriggerSettings is unavailable, returns text unchanged.
 *
 * @param {string} companyId
 * @param {string} text — containerBlock string (assembled from sections)
 * @returns {Promise<string>}
 */
async function _resolveKCVariables(companyId, text) {
  if (!text || !companyId || !text.includes('{')) return text;
  try {
    let vars = _kcVarCache.get(companyId);
    if (!vars) {
      const settings = await CompanyTriggerSettings.findOne({ companyId }).lean();
      vars = settings?.companyVariables instanceof Map
        ? Object.fromEntries(settings.companyVariables)
        : (settings?.companyVariables || {});
      _kcVarCache.set(companyId, vars);
    }
    let result = text;
    for (const [k, v] of Object.entries(vars)) {
      if (!v) continue;
      result = result.replace(new RegExp(`\\{${k}\\}`, 'gi'), v);
    }
    return result;
  } catch (_e) {
    return text; // non-fatal — Groq still fires, just sees raw placeholder
  }
}

/**
 * invalidateKCVariablesCache — Call this when company variables are saved
 * so the next KC answer picks up the new values immediately.
 *
 * @param {string} companyId
 */
function invalidateKCVariablesCache(companyId) {
  if (companyId) _kcVarCache.delete(companyId);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _buildContainerBlock — Format the container sections into a clean
 * LABEL: content block for injection into the Groq system prompt.
 *
 * @param {Object} container — CompanyKnowledgeContainer document
 * @returns {string}
 */
function _buildContainerBlock(container) {
  const sections = [...(container.sections || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const lines = sections
    .filter(s => s.label?.trim() && s.content?.trim())
    .map(s => `${s.label.trim().toUpperCase()}: ${s.content.trim()}`);

  return lines.join('\n\n');
}

/**
 * _buildSystemPrompt — Construct the Groq system prompt for a knowledge
 * container answer. MUST include the word "json" for Groq JSON mode.
 *
 * @param {Object} opts
 * @param {string}  opts.companyName
 * @param {string}  opts.containerTitle
 * @param {string}  opts.containerBlock    — formatted LABEL: content sections
 * @param {number}  opts.wordLimit         — resolved effective word limit
 * @param {string}  opts.bookingOfferMode  — 'groq' | 'fixed'
 * @param {string}  opts.bookingOfferPhrase — used when mode is 'fixed'
 * @param {string}  opts.bookingAction     — container-level booking action
 * @param {string}  [opts.spfuqContext]    — active topic reminder injected when SPFUQ anchor is live.
 *                                           Helps Groq resolve pronouns ('it', 'that') to the current topic.
 * @returns {string}
 */
function _buildSystemPrompt({
  companyName,
  containerTitle,
  containerBlock,
  wordLimit,
  bookingOfferMode,
  bookingOfferPhrase,
  bookingAction,
  closingPrompt,
  spfuqContext,
  discoveryContext,
}) {
  // Booking instruction block
  let bookingInstruction = '';
  if (bookingOfferMode === 'return_to_booking') {
    // BPFUQ context — caller is mid-booking. Answer the question, then naturally
    // invite them to return to the appointment booking already in progress.
    // Do NOT start a new booking — just offer to resume the one underway.
    bookingInstruction = '5. After answering, briefly and naturally invite the caller to return to completing their appointment — for example: "Does that help? Shall we get back to your booking?" Keep it short and warm. Do NOT pitch a new booking — just offer to resume the one already in progress.';
  } else if (bookingOfferMode === 'none') {
    // Suppress all booking offers (used when a simple answer-only response is needed)
    bookingInstruction = '5. Do NOT add any booking invitation — answer only.';
  } else if (bookingAction === 'none') {
    bookingInstruction = '5. Do NOT add any booking invitation — answer only.';
  } else if (bookingAction === 'advisor_callback') {
    bookingInstruction = '5. After answering, naturally invite the caller to leave their name and number for an advisor to call them back with more details.';
  } else if (bookingOfferMode === 'fixed' && bookingOfferPhrase?.trim()) {
    const phrase = bookingOfferPhrase.trim();
    bookingInstruction = `5. After your answer, append this EXACT phrase — do not change a single word: "${phrase}"`;
  } else if (closingPrompt?.trim()) {
    // Admin-authored follow-up guidance — Groq adapts it naturally, not verbatim
    bookingInstruction = `5. After answering, close with a follow-up in the spirit of this suggested phrase (adapt naturally — do not copy word for word): "${closingPrompt.trim()}"`;
  } else {
    // Smart Close — Groq reads caller intent and adapts the close strategy
    bookingInstruction = '5. After answering, read the caller\'s tone and engagement. If they sound interested or ready, invite them to schedule in one warm, natural sentence. If the topic was purely informational or the caller seems hesitant, offer to answer any other questions instead. Never force a booking pitch if the context doesn\'t call for it.';
  }

  // ACTIVE TOPIC block — injected when SPFUQ anchor is live so Groq resolves
  // pronouns ('it', 'that', 'they', 'those') back to the anchored container topic.
  const activeTopicBlock = spfuqContext
    ? `\nACTIVE TOPIC: The caller is currently discussing "${containerTitle}". Resolve pronouns ('it', 'that', 'they', 'those') as references to "${containerTitle}" unless the caller explicitly introduces a new topic.\n`
    : '';

  // CALL CONTEXT block — injected when discoveryNotes provide call-level context
  // (callReason, caller name, urgency) so Groq connects its answer to the
  // caller's specific situation. Additive — does not replace ACTIVE TOPIC.
  const callContextBlock = discoveryContext
    ? `\nCALL CONTEXT: ${discoveryContext}\nUse this context to connect your answer to what the caller is specifically calling about.\n`
    : '';

  return `You are the phone agent for ${companyName}.
This is a live phone call. Answer the caller's question from the KNOWLEDGE CONTAINER below.
${activeTopicBlock}${callContextBlock}
CRITICAL RULES — FOLLOW EXACTLY:
1. Answer ONLY using facts from the KNOWLEDGE CONTAINER. NEVER invent prices, dates, or details not written there.
2. Keep your response under ${wordLimit} words — this is a spoken phone answer.
3. Be natural and conversational — sound human, not robotic.
4. If the caller signals readiness to book or schedule, set intent to "BOOKING_READY".
${bookingInstruction}
6. Respond ONLY with valid json — no extra text.

KNOWLEDGE CONTAINER: ${containerTitle}
${containerBlock}

RESPONSE FORMAT (json):
{"response":"<spoken text for caller>","intent":"ANSWERED|BOOKING_READY|NO_DATA","confidence":0.0}`;
}

/**
 * _parseGroqResponse — Parse and validate the Groq JSON response.
 * Returns a safe fallback on any parse error.
 *
 * @param {string|null} raw — raw Groq response string
 * @returns {{ response: string|null, intent: string, confidence: number }}
 */
function _parseGroqResponse(raw) {
  if (!raw) return { response: null, intent: INTENT.ERROR, confidence: 0 };

  try {
    const parsed     = JSON.parse(raw.trim());
    const intent     = Object.values(INTENT).includes(parsed.intent) ? parsed.intent : INTENT.ANSWERED;
    const response   = typeof parsed.response === 'string' && parsed.response.trim()
      ? parsed.response.trim()
      : null;
    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.8;
    return { response, intent, confidence };
  } catch (_e) {
    // JSON parse failed — try to extract response string as last resort
    const match = raw.match(/"response"\s*:\s*"([^"]+)"/);
    if (match) {
      return { response: match[1], intent: INTENT.ANSWERED, confidence: 0.5 };
    }
    return { response: null, intent: INTENT.ERROR, confidence: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detect — Returns true if the input contains at least one knowledge signal.
 * Fast synchronous check — used as the initial gate before any async work.
 *
 * @param {string} input — Raw caller utterance
 * @returns {boolean}
 */
function detect(input) {
  if (!input || typeof input !== 'string') return false;
  const norm = input.toLowerCase().replace(/[^a-z\s]/g, ' ');
  return KNOWLEDGE_SIGNALS.some(signal => {
    if (signal.includes(' ')) return norm.includes(signal);
    return norm.split(/\s+/).includes(signal);
  });
}

/**
 * getActiveForCompany — Load active containers from Redis → MongoDB → [].
 * Writes back to Redis on cache miss (fire-and-forget).
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
async function getActiveForCompany(companyId) {
  if (!companyId) return [];

  const redis = _getRedis();
  const key   = _cacheKey(companyId);

  // ── Try Redis cache first ────────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (_e) { /* Cache miss — fall through to MongoDB */ }
  }

  // ── Fetch from MongoDB ───────────────────────────────────────────────────
  try {
    const containers = await CompanyKnowledgeContainer.findActiveForCompany(companyId);

    // Backfill cache (non-blocking)
    if (redis) {
      redis.setEx(key, CACHE_TTL, JSON.stringify(containers)).catch(() => {});
    }

    return containers;
  } catch (err) {
    logger.warn('[KnowledgeContainer] MongoDB fetch failed', { companyId, err: err.message });
    return [];
  }
}

/**
 * invalidateCache — Delete the Redis cache for a company's knowledge containers.
 * Called on every CREATE / UPDATE / DELETE from the admin API routes.
 *
 * @param {string} companyId
 * @returns {Promise<void>}
 */
async function invalidateCache(companyId) {
  if (!companyId) return;
  const redis = _getRedis();
  if (!redis) return;
  try {
    await redis.del(_cacheKey(companyId));
  } catch (_e) { /* Silence — next read will re-fetch from MongoDB */ }
}

/**
 * findContainer — Keyword-score all containers and return the best match.
 *
 * Scoring (identical algorithm to PricingInterceptor.matchItem):
 *   - Multi-word phrase match scores length × 2 (rewards specificity)
 *   - Single-word match scores by word length
 *   - Best score across all containers wins
 *
 * @param {Array}  containers — Active CompanyKnowledgeContainer documents
 * @param {string} input      — Raw caller utterance
 * @param {Object} [context]  — Optional call context from discoveryNotes
 * @param {string} [context.callReason] — e.g. "annual maintenance" from Turn 1
 * @returns {{ container: Object, score: number, contextAssisted?: boolean } | null}
 */
function findContainer(containers, input, context = null) {
  if (!containers?.length || !input) return null;

  const norm = input.toLowerCase().replace(/[^a-z\s]/g, ' ');

  let bestMatch = null;
  let bestScore = 0;

  for (const container of containers) {
    const keywords = container.keywords || [];
    if (!keywords.length) continue;

    for (const kw of keywords) {
      const kwNorm = kw.toLowerCase().trim();
      if (!kwNorm) continue;

      let matched = false;
      let score   = 0;

      if (kwNorm.includes(' ')) {
        if (norm.includes(kwNorm)) {
          // Exact substring match — highest score, rewards specificity
          matched = true;
          score   = kwNorm.length * 2;
        } else {
          // Word-overlap fallback: extract content words (≥5 chars) from the
          // keyword phrase and check how many appear as whole words in the input.
          // This lets "maintenance charges" match keyword
          // "how much is the maintenance plan" via the shared word "maintenance".
          // Score is always lower than any exact match so exact always wins.
          const inputWords   = new Set(norm.split(/\s+/));
          const contentWords = kwNorm.split(/\s+/).filter(w => w.length >= 5);
          const hits         = contentWords.filter(w => inputWords.has(w));
          if (hits.length >= 1) {
            matched = true;
            score   = hits.reduce((s, w) => s + w.length, 0); // < exact match score
          }
        }
      } else {
        // Single word: whole-word match
        matched = norm.split(/\s+/).includes(kwNorm);
        score   = matched ? kwNorm.length : 0;
      }

      if (matched && score > bestScore) {
        bestScore = score;
        bestMatch = { container, score };
      }
    }
  }

  // ── CONTEXT FALLBACK: if no direct match and callReason available, retry
  // with callReason words prepended to input. The word-overlap fallback in
  // the scoring algorithm naturally picks up shared content words
  // (e.g. "maintenance" from callReason matches "maintenance plan" keyword).
  //
  // Only fires when raw input had zero hits — never overrides a direct match.
  // contextAssisted flag distinguishes this in trace events.
  if (!bestMatch && context?.callReason) {
    const augmented = `${context.callReason} ${input}`;
    const augNorm   = augmented.toLowerCase().replace(/[^a-z\s]/g, ' ');

    for (const container of containers) {
      const keywords = container.keywords || [];
      if (!keywords.length) continue;

      for (const kw of keywords) {
        const kwNorm = kw.toLowerCase().trim();
        if (!kwNorm) continue;

        let matched = false;
        let score   = 0;

        if (kwNorm.includes(' ')) {
          if (augNorm.includes(kwNorm)) {
            matched = true;
            score   = kwNorm.length * 2;
          } else {
            const inputWords   = new Set(augNorm.split(/\s+/));
            const contentWords = kwNorm.split(/\s+/).filter(w => w.length >= 5);
            const hits         = contentWords.filter(w => inputWords.has(w));
            if (hits.length >= 1) {
              matched = true;
              score   = hits.reduce((s, w) => s + w.length, 0);
            }
          }
        } else {
          matched = augNorm.split(/\s+/).includes(kwNorm);
          score   = matched ? kwNorm.length : 0;
        }

        if (matched && score > bestScore) {
          bestScore = score;
          bestMatch = { container, score, contextAssisted: true };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * answer — Invoke Groq with the matching container as context and return a
 * spoken response for the caller.
 *
 * @param {Object}  opts
 * @param {Object}  opts.container     — matched CompanyKnowledgeContainer document
 * @param {string}  opts.question      — raw caller utterance
 * @param {Object}  [opts.kbSettings]  — company knowledgeBaseSettings
 * @param {Object}  [opts.company]     — v2Company document (for companyName)
 * @param {string}  [opts.callerName]  — caller's first name for personalisation
 * @param {string}  [opts.callSid]     — for logging
 *
 * @returns {Promise<{ response: string|null, intent: string, confidence: number, latencyMs: number, containerTitle: string }>}
 */
async function answer(opts) {
  const {
    container,
    question,
    kbSettings  = {},
    company     = {},
    callerName,
    callSid,
    spfuqContext,       // optional — active topic reminder injected into system prompt for pronoun resolution
    discoveryContext,   // optional — call-level context from discoveryNotes (callReason, entities)
  } = opts;

  const startMs       = Date.now();
  const companyId     = String(company._id || company.companyId || '');
  const companyName   = company.companyName || company.name || 'our company';
  const containerTitle = container.title || 'Knowledge Container';

  // Guard: no question
  if (!question?.trim()) {
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: 0, containerTitle };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('[KnowledgeContainer] GROQ_API_KEY not set — skipping', { companyId, callSid });
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: 0, containerTitle };
  }

  // Resolve effective word limit: container override → company default → hard default
  const wordLimit = (typeof container.wordLimit === 'number' && container.wordLimit >= 5)
    ? container.wordLimit
    : (typeof kbSettings.defaultWordLimit === 'number' && kbSettings.defaultWordLimit >= 5)
      ? kbSettings.defaultWordLimit
      : 40;

  // Build prompt components — resolve {variables} so Groq sees real values
  const containerBlock = await _resolveKCVariables(companyId, _buildContainerBlock(container));
  const systemPrompt   = _buildSystemPrompt({
    companyName,
    containerTitle,
    containerBlock,
    wordLimit,
    bookingOfferMode:   kbSettings.bookingOfferMode   || 'groq',
    bookingOfferPhrase: kbSettings.bookingOfferPhrase || BUILT_IN_BOOKING_OFFER,
    bookingAction:      container.bookingAction        || 'offer_to_book',
    closingPrompt:      container.closingPrompt        || '',
    spfuqContext:       spfuqContext                   || null,
    discoveryContext:   discoveryContext                || null,
  });

  // User message — personalise with caller name if known
  const userContent = callerName
    ? `Caller (${callerName}): ${question}`
    : question;

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   MAX_TOKENS,
      temperature: TEMPERATURE,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: userContent }],
      callSid,
      jsonMode:    true,
    });

    if (result.failureReason && !result.response) {
      logger.warn('[KnowledgeContainer] Groq failed', { companyId, callSid, reason: result.failureReason });
      return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: result.latencyMs, containerTitle };
    }

    const parsed = _parseGroqResponse(result.response);

    logger.debug('[KnowledgeContainer] answer', {
      companyId,
      callSid,
      containerTitle,
      intent:     parsed.intent,
      confidence: parsed.confidence,
      latencyMs:  result.latencyMs,
      preview:    parsed.response?.slice(0, 80),
    });

    return {
      response:       parsed.response,
      intent:         parsed.intent,
      confidence:     parsed.confidence,
      latencyMs:      result.latencyMs,
      containerTitle,
      // ── Provenance: the section text Groq read to generate its answer ────
      // Clipped to 500 chars for trace events — full text stays in Groq prompt only.
      containerBlockPreview: containerBlock.length > 500
        ? containerBlock.slice(0, 500) + '…'
        : containerBlock,
    };

  } catch (err) {
    logger.error('[KnowledgeContainer] unexpected error', { companyId, callSid, err: err.message });
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: Date.now() - startMs, containerTitle };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  INTENT,
  KNOWLEDGE_SIGNALS,
  detect,
  getActiveForCompany,
  invalidateCache,
  invalidateKCVariablesCache,
  findContainer,
  answer,
  // Exported for tests
  _buildContainerBlock,
  _buildSystemPrompt,
  _parseGroqResponse,
};

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
 *   B) ASKING_PRICING bucket   — single answer hub for all pricing questions
 *   C) callLLMAgentForNoMatch  — before Claude T2 (KC is the first stop)
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
const BehaviorCardService        = require('../../behaviorCards/BehaviorCardService');

// Lazy-loaded — only when embedding fallback fires (keyword miss + OPENAI_API_KEY set)
let _embeddingService = null;
function _getEmbeddingService() {
  if (!_embeddingService) {
    _embeddingService = require('../../scenarioEngine/embeddingService');
  }
  return _embeddingService;
}

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
// STAGE 11 — TWO-TIER SIGNAL TABLE
// Splits KNOWLEDGE_SIGNALS into two confidence tiers:
//   TIER 1: Multi-word phrases — unambiguously informational questions.
//           Safe to gate KC BEFORE T1.5/Pricing. Zero booking-intent overlap.
//   TIER 2: Ambiguous single words — also present in booking/scheduling
//           utterances. Fall through to normal T1.5 → Pricing → KC path.
// ─────────────────────────────────────────────────────────────────────────────

/** TIER 1 — High-confidence multi-word question phrases (Stage 11 direct-KC gate) */
const TIER1_SIGNALS = [
  // Cost / price — explicit question phrases
  'how much does', 'how much is', 'how much for', 'how much will',
  'how much do you', 'how much would',
  'what does it cost', 'what will it cost', 'what does that cost',
  'what is the cost', 'what is the fee', 'what is the price',
  'whats the fee', 'whats the cost', 'whats the price',
  'what are your rates', 'what are the rates', 'what are your prices',
  'what is the charge', 'what do you charge', 'how much do you charge',
  // Service inclusions
  'what does it include', 'what is included', 'what comes with',
  'whats included', "what's included",
  'what does the service include', 'what is covered', 'whats covered',
  // Specific service fees (always informational)
  'diagnostic fee', 'service call fee', 'service fee', 'visit fee',
  'trip charge', 'callout fee',
  'emergency fee', 'after hours fee', 'weekend rate',
  'installation cost', 'replacement cost',
  // Maintenance / plans
  'maintenance plan', 'annual plan', 'tune up cost', 'tune-up cost',
  // Credit / waiver
  'diagnostic credit', 'service call credit',
  'go towards', 'applied to the', 'waive the fee',
  // Warranty — question form
  'what is the warranty', 'how long is the warranty',
  'what does the warranty', 'is there a warranty', 'do you offer a warranty',
  // Payment / financing
  'do you accept', 'do you take credit', 'do you take debit',
  'do you finance', 'do you offer financing',
  'payment options', 'financing options', 'payment plan', 'monthly payments',
  // Specials / promotions
  'any specials', 'any deals', 'any discounts', 'any promotions', 'any coupons',
  'do you have any specials', 'do you have any deals',
  'do you have any discounts', 'running any specials', 'current specials',
  // Policy / terms
  'what is your policy', 'what are your terms',
  'do you have a contract', 'is there a contract',
  // Availability / timing
  'how soon can you', 'when can you come', 'how long does it take',
  'how long will it take', 'when do you open', 'what are your hours',
  'are you open on', 'do you service', 'do you work on',
  // General info questions
  'tell me about', 'can you tell me', 'can you explain',
  'what do you do', 'what do you offer', 'what services do you',
  'do you offer', 'do you provide',
  'is there a', 'are there any', 'do you have a',
  'what is a', 'what is an', 'what are the',
];

/** TIER 2 — Ambiguous single-word signals (overlap with booking intent — fall through to normal path) */
const TIER2_SIGNALS = [
  'cost', 'price', 'pricing', 'rate', 'rates', 'fee', 'fees', 'charge',
  'credit', 'credited', 'include', 'includes', 'included',
  'special', 'specials', 'deal', 'deals', 'promo', 'promotion', 'promotions',
  'discount', 'discounts', 'offer', 'offers', 'coupon', 'sale',
  'warranty', 'guarantee', 'guaranteed', 'covered', 'coverage',
  'policy', 'policies', 'terms', 'contract', 'agreement',
  'schedule', 'available', 'availability',
  'install', 'maintenance', 'explain', 'describe',
];

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CACHE
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL = 900; // 15 minutes

/** Minimum keyword score for a match to be accepted (env-configurable) */
const KEYWORD_CONFIDENCE_THRESHOLD = parseInt(process.env.KC_KEYWORD_THRESHOLD, 10) || 8;

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

function _embeddingCacheKey(companyId) {
  return `knowledge-embeddings:${companyId}`;
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
// EMBEDDING CACHE — separate from container cache because embeddingVector is
// select: false on the schema. Regular getActiveForCompany() never loads it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getEmbeddingsForCompany — Load container embedding vectors from Redis cache
 * or MongoDB fallback. Returns a Map<containerId, number[]> for fast cosine
 * similarity lookup at runtime.
 *
 * Gate: returns empty Map when OPENAI_API_KEY is not set (no embeddings exist).
 *
 * @param {string} companyId
 * @returns {Promise<Map<string, number[]>>}
 */
async function getEmbeddingsForCompany(companyId) {
  if (!companyId || !process.env.OPENAI_API_KEY) return new Map();

  const redis = _getRedis();
  const key   = _embeddingCacheKey(companyId);

  // ── Try Redis cache first ──────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        const arr = JSON.parse(cached);
        return new Map(arr);  // [[id, vec], [id, vec], ...]
      }
    } catch (_e) { /* Cache miss — fall through */ }
  }

  // ── Fetch from MongoDB with +embeddingVector ───────────────────────────
  try {
    const docs = await CompanyKnowledgeContainer
      .find({ companyId, isActive: true })
      .select('+embeddingVector')
      .lean();

    const map = new Map();
    for (const doc of docs) {
      if (doc.embeddingVector?.length) {
        map.set(String(doc._id), doc.embeddingVector);
      }
    }

    // Backfill cache (non-blocking) — store as [[id, vec], ...] for Map reconstruction.
    // TTL: 24h (86400s). Container embeddings are regenerated only when a container is
    // saved — extremely stable data. 15min TTL causes unnecessary MongoDB re-reads.
    if (redis && map.size > 0) {
      redis.setEx(key, 86400, JSON.stringify([...map])).catch(() => {});
    }

    return map;
  } catch (err) {
    logger.warn('[KnowledgeContainer] Embedding fetch failed', { companyId, err: err.message });
    return new Map();
  }
}

/**
 * _getUtteranceEmbedding — Embed the caller's utterance via OpenAI
 * text-embedding-3-small (~50ms). Cached per callSid+turn in Redis so
 * retries don't re-hit OpenAI.
 *
 * @param {string} text     — caller utterance
 * @param {string} callSid  — for cache scoping
 * @param {number} turn     — turn number for cache scoping
 * @returns {Promise<number[]|null>}
 */
async function _getUtteranceEmbedding(text, callSid, turn) {
  if (!text?.trim() || !process.env.OPENAI_API_KEY) return null;

  const redis    = _getRedis();
  const cacheKey = `utterance-emb:${callSid}:${turn}`;

  // ── Check Redis cache (covers retries within same turn) ────────────────
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (_e) { /* miss — generate fresh */ }
  }

  // ── Generate via embeddingService (OpenAI text-embedding-3-small) ──────
  try {
    const embedding = await _getEmbeddingService().getEmbedding(text);

    // Cache for 5 min (non-blocking)
    if (redis && embedding) {
      redis.setEx(cacheKey, 300, JSON.stringify(embedding)).catch(() => {});
    }

    return embedding;
  } catch (err) {
    logger.warn('[KnowledgeContainer] Utterance embedding failed', { callSid, turn, err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _buildContainerBlock — Format container sections into a LABEL: content block
 * for injection into the Groq system prompt.
 *
 * When targetSection is provided (UAP-routed specific section), only that
 * section's content is formatted — Groq answers from that section alone.
 * When targetSection is null, all container sections are included (general query
 * or keyword-matched container without a specific section sub-type).
 *
 * @param {Object}      container      — CompanyKnowledgeContainer document
 * @param {Object|null} [targetSection] — specific section (from UAP callerPhrases routing), or null
 * @returns {string}
 */
function _buildContainerBlock(container, targetSection = null) {
  const source = targetSection
    ? [targetSection]
    : [...(container.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const lines = source
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
 * @param {boolean} opts.wordLimitEnabled  — false = omit the hard word cap from the prompt
 * @param {string}  [opts.sampleResponse]  — ideal example answer; injected as a guardrail so Groq matches length + tone
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
  wordLimitEnabled = true,
  sampleResponse,
  bookingOfferMode,
  bookingOfferPhrase,
  bookingAction,
  closingPrompt,
  spfuqContext,
  discoveryContext,
  responseTone,
  responseStyle,
  greetByName,
  acknowledgeHistory,
  callerName,
  priorVisit,
  behaviorBlock = '',           // Engine Hub Behavior Card block — injected when a BC is configured for this KC category
  preQualifyContext = '',       // Injected when caller answered a pre-qualify question for this container
  suppressOpeningGreeting = false, // true on turn 1 — Turn1Engine already greeted the caller
}) {
  // Booking instruction block
  let bookingInstruction = '';
  // 'return_to_booking' mode REMOVED — Clean Sweep. Booking KC digressions
  // now use bookingOfferMode:'none' + re-anchor appended by BookingLogicEngine.
  if (bookingOfferMode === 'none') {
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

  // PRE-QUALIFY CONTEXT block — injected when the caller answered the container's
  // pre-qualify question. Tells Groq which caller type to address (member vs first-timer,
  // residential vs commercial, etc.) so the response calibrates to the right tier/price.
  const preQualBlock = preQualifyContext?.trim()
    ? `\nCALLER TYPE: ${preQualifyContext.trim()}\nThis context affects which pricing, tier, or service details are most relevant — calibrate your answer accordingly.\n`
    : '';

  // ── RESPONSE TONE INSTRUCTION ──────────────────────────────────────────────
  // Tone modifies the delivery; naturalness is always required for phone audio.
  const toneMap = {
    professional: 'formal and business-like — precise, authoritative, no filler',
    friendly:     'warm and approachable — conversational, upbeat, never stiff',
    casual:       'relaxed and easygoing — talk like a helpful neighbor',
    warm:         'empathetic and caring — show genuine concern for the caller',
  };
  const toneDescriptor = toneMap[responseTone] || toneMap.friendly;

  // ── RESPONSE STYLE — adjust effective word limit ───────────────────────────
  const styleMultiplier    = responseStyle === 'detailed' ? 2 : responseStyle === 'balanced' ? 1.5 : 1;
  const effectiveWordLimit = Math.round(wordLimit * styleMultiplier);
  // Word cap rule — omitted entirely when owner disables the limit for this container
  const wordCapRule        = wordLimitEnabled
    ? `Keep your response under ${effectiveWordLimit} words — this is a spoken phone answer, not a text message.`
    : 'Keep your response concise and spoken-word natural — phone call, not a text message.';
  // Sample response guardrail — teaches Groq length and tone without prescribing exact words
  const sampleBlock        = sampleResponse?.trim()
    ? `\nIDEAL RESPONSE EXAMPLE (match this length and tone — do NOT copy verbatim, generate a fresh natural response):\n"${sampleResponse.trim()}"\n`
    : '';

  // ── PERSONALIZATION ────────────────────────────────────────────────────────
  const personalizationLines = [];
  if (greetByName !== false && callerName) {
    personalizationLines.push(`Address the caller as "${callerName}".`);
  }
  if (acknowledgeHistory !== false && priorVisit) {
    personalizationLines.push('Acknowledge that the caller is a returning customer — briefly, not every time.');
  }
  const personalizationBlock = personalizationLines.length
    ? '\n' + personalizationLines.join(' ') + '\n'
    : '';

  // Behavior Card block — present only when a BC is configured for this KC category
  const behaviorBlockStr = behaviorBlock ? `\n${behaviorBlock}` : '';

  // On turn 1, Turn1Engine already greeted the caller — tell Groq not to open with a greeting.
  const noGreetingRule = suppressOpeningGreeting
    ? '0. Do NOT begin your response with any greeting, salutation, or thanks (Hi, Hello, Hey, Thanks for calling, Thanks for reaching out, Good morning, etc.) — the caller has already been greeted. Start directly with the answer.\n'
    : '';

  return `You are the phone agent for ${companyName}.
This is a live phone call. Answer the caller's question from the KNOWLEDGE CONTAINER below.
${activeTopicBlock}${callContextBlock}${preQualBlock}${sampleBlock}${personalizationBlock}${behaviorBlockStr}
CRITICAL RULES — FOLLOW EXACTLY:
${noGreetingRule}1. Answer ONLY using facts from the KNOWLEDGE CONTAINER. If a specific price, fee, or rate is NOT written verbatim in the container content below, say "I'd need to confirm that exact pricing for you" — NEVER estimate or invent a number.
2. ${wordCapRule}
3. Be natural and conversational — sound human, never robotic or scripted. Tone: ${toneDescriptor}.
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
 * detectTier — Two-tier confidence scoring for question detection (Stage 11).
 *
 * TIER 1: High-confidence multi-word phrases — safe to route directly to KC
 *   BEFORE T1.5/Pricing. These phrases are unambiguously informational.
 *   Examples: "how much does", "do you accept credit cards", "what's included".
 *   Agent2DiscoveryRunner uses TIER 1 to skip T1.5 and go straight to KC.
 *
 * TIER 2: Ambiguous single-word signals — also appear in booking utterances.
 *   Falls through to the normal T1.5 → Pricing → KC path.
 *   Example: "schedule" could be booking ("can you schedule me?") or
 *   info ("what's your schedule?").
 *
 * @param  {string} input — Raw caller utterance
 * @returns {{ tier: 0|1|2, matched: string|null }}
 */
function detectTier(input) {
  if (!input || typeof input !== 'string') return { tier: 0, matched: null };
  const norm = input.toLowerCase().replace(/[^a-z\s]/g, ' ');

  // TIER 1 — multi-word, high confidence (check first, longest-match wins)
  for (const signal of TIER1_SIGNALS) {
    if (norm.includes(signal)) return { tier: 1, matched: signal };
  }

  // TIER 2 — single-word ambiguous (word-boundary check prevents partial hits)
  const words = new Set(norm.split(/\s+/));
  for (const signal of TIER2_SIGNALS) {
    if (signal.includes(' ')) {
      if (norm.includes(signal)) return { tier: 2, matched: signal };
    } else if (words.has(signal)) {
      return { tier: 2, matched: signal };
    }
  }

  return { tier: 0, matched: null };
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
    await Promise.all([
      redis.del(_cacheKey(companyId)),
      redis.del(_embeddingCacheKey(companyId)),
    ]);
  } catch (_e) { /* Silence — next read will re-fetch from MongoDB */ }
}

/**
 * _scorePhrase — Score a single keyword/phrase against normalised input.
 * Reused for title scoring, section contentKeywords, and negativeKeywords.
 *
 * @param {string} phrase   — normalised keyword phrase
 * @param {string} norm     — normalised caller utterance
 * @param {Set<string>} inputWords — pre-split set of input words
 * @returns {number} — score (0 = no match)
 */
function _scorePhrase(phrase, norm, inputWords) {
  if (!phrase) return 0;

  if (phrase.includes(' ')) {
    // Multi-word: exact substring match (highest score)
    if (norm.includes(phrase)) return phrase.length * 2;

    // Word-overlap fallback: content words ≥5 chars
    const contentWords = phrase.split(/\s+/).filter(w => w.length >= 5);
    const hits = contentWords.filter(w => inputWords.has(w));
    if (hits.length >= 1) {
      return hits.reduce((s, w) => s + (w.length >= 8 ? Math.round(w.length * 1.5) : w.length), 0);
    }
    return 0;
  }

  // Single word: whole-word match
  return inputWords.has(phrase) ? phrase.length : 0;
}

/**
 * findContainer — Score all containers via section.contentKeywords + title
 * and return the best match with optional bestSection.
 *
 * Scoring sources (in order of weight):
 *   A. section.contentKeywords[] — auto-extracted bigrams from section content (0.9× per section)
 *   B. container.title — implicit keywords from title (0.8× weight)
 *   C. context callReason augmentation — fallback when direct scoring misses
 *
 * Minimum score threshold: KC_KEYWORD_THRESHOLD env (default 8).
 * Anchor logic: 3× boost + ANCHOR_FLOOR=24 for call continuity.
 * negativeKeywords exclusion: per-SECTION (not container). Single words → whole-word, phrases → substring.
 *
 * @param {Array}  containers — Active CompanyKnowledgeContainer documents
 * @param {string} input      — Raw caller utterance
 * @param {Object} [context]  — Optional call context from discoveryNotes
 * @param {string} [context.callReason] — e.g. "annual maintenance"
 * @param {string} [context.anchorContainerId] — anchor container for 3× boost
 * @returns {{ container, score, bestSection?, bestSectionIdx?, contextAssisted?, anchorBoosted?, anchorFloor? } | null}
 */
function findContainer(containers, input, context = null) {
  if (!containers?.length || !input) return null;

  const norm       = input.toLowerCase().replace(/[^a-z\s]/g, ' ');
  const inputWords = new Set(norm.split(/\s+/));

  // ── NEGATIVE KEYWORD EXCLUSION (section-level) ───────────────────────
  // Single words → whole-word match (Set lookup).
  // Multi-word phrases/sentences → substring match against full input.
  // This gives precise exclusion: "ac repair" won't block "duct cleaning".
  const _matchesNegativeKeywords = (negKws) => {
    if (!Array.isArray(negKws) || !negKws.length) return false;
    for (const nk of negKws) {
      const nkNorm = nk.toLowerCase().trim();
      if (!nkNorm) continue;
      if (nkNorm.includes(' ')) {
        if (norm.includes(nkNorm)) return true;   // Multi-word phrase: substring
      } else {
        if (inputWords.has(nkNorm)) return true;   // Single word: whole-word
      }
    }
    return false;
  };

  const MIN_THRESHOLD = parseInt(process.env.KC_KEYWORD_THRESHOLD, 10) || 8;
  const _anchorId = context?.anchorContainerId ? String(context.anchorContainerId) : null;

  let bestMatch           = null;
  let bestScore           = 0;
  let _anchorContainer    = null;
  let _anchorRawScore     = 0;

  for (const container of containers) {
    const isAnchor = !!(_anchorId && String(container._id) === _anchorId);
    if (isAnchor && !_anchorContainer) _anchorContainer = container;

    let containerBestScore   = 0;
    let containerBestSection = null;
    let containerBestSIdx    = null;

    // ── Path A: Score section.contentKeywords per section ─────────────────
    const sections = container.sections || [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];

      // Section-level exclusion — skip THIS section if negative keywords match
      if (_matchesNegativeKeywords(section.negativeKeywords)) continue;

      const keywords = section.contentKeywords || [];
      if (!keywords.length) continue;

      let sectionScore = 0;
      for (const kw of keywords) {
        const kwNorm = kw.toLowerCase().trim();
        const s = _scorePhrase(kwNorm, norm, inputWords);
        if (s > sectionScore) sectionScore = s;
      }

      // Apply 0.9× weight for section keywords
      const weighted = Math.round(sectionScore * 0.9);
      if (weighted > containerBestScore) {
        containerBestScore   = weighted;
        containerBestSection = section;
        containerBestSIdx    = sIdx;
      }
    }

    // ── Path B: Score container.title (implicit keywords) ────────────────
    if (container.title) {
      const titleNorm = container.title.toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
      const titleScore = _scorePhrase(titleNorm, norm, inputWords);
      const weighted = Math.round(titleScore * 0.8);
      if (weighted > containerBestScore) {
        containerBestScore   = weighted;
        containerBestSection = null; // title match → no specific section
        containerBestSIdx    = null;
      }
    }

    if (containerBestScore <= 0) continue;

    // Track anchor raw score before multiplier
    if (isAnchor && containerBestScore > _anchorRawScore) {
      _anchorRawScore = containerBestScore;
    }

    const finalScore = isAnchor ? containerBestScore * 3 : containerBestScore;
    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestMatch = {
        container,
        score: finalScore,
        bestSection:    containerBestSection,
        bestSectionIdx: containerBestSIdx,
        ...(isAnchor ? { anchorBoosted: true } : {}),
      };
    }
  }

  // ── ANCHOR FLOOR ───────────────────────────────────────────────────────
  const ANCHOR_FLOOR = 24;
  if (_anchorContainer && _anchorRawScore === 0 && bestScore < ANCHOR_FLOOR) {
    bestMatch = { container: _anchorContainer, score: ANCHOR_FLOOR, anchorFloor: true };
    bestScore = ANCHOR_FLOOR;
  }

  // ── CONTEXT FALLBACK ───────────────────────────────────────────────────
  if (!bestMatch && context?.callReason) {
    const augmented  = `${context.callReason} ${input}`;
    const augNorm    = augmented.toLowerCase().replace(/[^a-z\s]/g, ' ');
    const augWords   = new Set(augNorm.split(/\s+/));

    for (const container of containers) {
      // Score against section contentKeywords with augmented input
      for (let sIdx = 0; sIdx < (container.sections || []).length; sIdx++) {
        const section  = container.sections[sIdx];
        // Section-level exclusion — same check as main loop
        if (_matchesNegativeKeywords(section.negativeKeywords)) continue;
        const keywords = section.contentKeywords || [];
        for (const kw of keywords) {
          const kwNorm = kw.toLowerCase().trim();
          const s = _scorePhrase(kwNorm, augNorm, augWords);
          const weighted = Math.round(s * 0.9);
          if (weighted > bestScore) {
            bestScore = weighted;
            bestMatch = { container, score: weighted, bestSection: section, bestSectionIdx: sIdx, contextAssisted: true };
          }
        }
      }

      // Score title with augmented input
      if (container.title) {
        const titleNorm = container.title.toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
        const s = _scorePhrase(titleNorm, augNorm, augWords);
        const weighted = Math.round(s * 0.8);
        if (weighted > bestScore) {
          bestScore = weighted;
          bestMatch = { container, score: weighted, contextAssisted: true };
        }
      }
    }
  }

  // ── MINIMUM THRESHOLD ──────────────────────────────────────────────────
  if (bestMatch && bestMatch.score < MIN_THRESHOLD && !bestMatch.anchorFloor) {
    return null;
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
    targetSection   = null, // specific section resolved by UAP callerPhrases; null = all sections
    question,
    kbSettings  = {},
    company     = {},
    callerName,
    callSid,
    turn            = null, // current turn number — used to suppress greeting on turn 1
    spfuqContext,           // optional — active topic reminder for pronoun resolution
    discoveryContext,       // optional — call-level context from discoveryNotes
    priorVisit  = false,    // optional — true when caller is a returning customer
    preQualifyContext = '', // optional — caller's pre-qualify answer context
  } = opts;

  const startMs        = Date.now();
  const companyId      = String(company._id || company.companyId || '');
  const companyName    = company.companyName || company.name || 'our company';
  const containerTitle = container.title || 'Knowledge Container';

  // Guard: no question
  if (!question?.trim()) {
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: 0, containerTitle };
  }

  // ── FIXED RESPONSE SHORTCUT ────────────────────────────────────────────────
  // Two scopes of fixed response — checked in priority order:
  //
  //   1. Per-section (targetSection.useFixedResponse)
  //      Fires when UAP routed to a specific section AND that section has
  //      useFixedResponse:true. Returns the section's own content verbatim.
  //      Takes precedence over container-level so per-section can override.
  //
  //   2. Container-level (container.useFixedResponse)
  //      Fires for any KC match on this container (UAP or keyword).
  //      Returns the first section with content verbatim (Section 1 behaviour).
  //
  // In both cases: Groq is skipped entirely. Audio is pre-cached by the
  // companyKnowledge route on save (kind: 'KC_RESPONSE'). bookingAction is
  // resolved by the engine upstream — not needed here.
  // Falls through to Groq gracefully if no content is found.
  // ─────────────────────────────────────────────────────────────────────────────
  if (targetSection?.useFixedResponse || container.useFixedResponse) {
    let fixedText = null;
    let fixedScope = '';

    if (targetSection?.useFixedResponse && targetSection.content?.trim()) {
      // ── Per-section fixed: use this section's content exactly ─────────────
      fixedText  = targetSection.content.trim();
      fixedScope = 'section';
    } else if (container.useFixedResponse) {
      // ── Container-level fixed: use first section with content ─────────────
      const effectiveSections = targetSection
        ? [targetSection]
        : [...(container.sections || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      fixedText  = effectiveSections.find(s => s.content?.trim())?.content?.trim() || null;
      fixedScope = 'container';
    }

    if (fixedText) {
      logger.debug('[KnowledgeContainer] Fixed response shortcut — Groq bypassed', {
        companyId, callSid, containerTitle,
        scope: fixedScope,
        sectionLabel: fixedScope === 'section' ? (targetSection?.label || '') : undefined,
        chars: fixedText.length,
      });
      return {
        response:   fixedText,
        intent:     INTENT.ANSWERED,
        confidence: 1.0,
        latencyMs:  Date.now() - startMs,
        containerTitle,
      };
    }

    // No content found — fall through to Groq gracefully
    logger.warn('[KnowledgeContainer] Fixed response mode active but no content found — falling through to Groq', {
      companyId, callSid, containerTitle,
      containerFixed: container.useFixedResponse,
      sectionFixed:   !!targetSection?.useFixedResponse,
    });
  }
  // ─────────────────────────────────────────────────────────────────────────────

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

  // Resolve booking action: section override → container default
  const effectiveBookingAction = (targetSection?.bookingAction) || container.bookingAction || 'offer_to_book';

  // Build prompt components — pass targetSection so Groq reads only the matched section
  // when UAP routed to a specific section; all sections otherwise (general query).
  const containerBlock = await _resolveKCVariables(
    companyId,
    _buildContainerBlock(container, targetSection)
  );

  // Load Behavior Card for this KC category (Redis → MongoDB, graceful degrade → null)
  const bc            = container.category
    ? await BehaviorCardService.forCategory(companyId, container.category)
    : null;
  const behaviorBlock = BehaviorCardService.formatForGroq(bc);

  if (bc) {
    logger.debug('[KnowledgeContainer] Behavior Card loaded', {
      companyId, callSid, category: container.category, bcName: bc.name
    });
  }

  const systemPrompt = _buildSystemPrompt({
    companyName,
    containerTitle,
    containerBlock,
    wordLimit,
    wordLimitEnabled:         container.wordLimitEnabled !== false,
    sampleResponse:           container.sampleResponse               || null,
    bookingOfferMode:         kbSettings.bookingOfferMode            || 'groq',
    bookingOfferPhrase:       kbSettings.bookingOfferPhrase          || BUILT_IN_BOOKING_OFFER,
    bookingAction:            effectiveBookingAction,
    closingPrompt:            container.closingPrompt                || '',
    spfuqContext:             spfuqContext                           || null,
    discoveryContext:         discoveryContext                        || null,
    responseTone:             kbSettings.responseTone                || 'friendly',
    responseStyle:            kbSettings.responseStyle               || 'concise',
    greetByName:              kbSettings.greetByName !== false,
    acknowledgeHistory:       kbSettings.acknowledgeHistory !== false,
    callerName:               callerName                             || null,
    priorVisit:               priorVisit                             || false,
    behaviorBlock:            behaviorBlock                          || '',
    preQualifyContext:        preQualifyContext                      || '',
    // Turn 1: Turn1Engine already greeted the caller — suppress Groq's opening greeting
    suppressOpeningGreeting:  turn === 1,
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
  TIER1_SIGNALS,
  TIER2_SIGNALS,
  KEYWORD_CONFIDENCE_THRESHOLD,
  detect,
  detectTier,
  getActiveForCompany,
  getEmbeddingsForCompany,
  invalidateCache,
  invalidateKCVariablesCache,
  findContainer,
  answer,
  // Exported for tests
  _buildContainerBlock,
  _buildSystemPrompt,
  _parseGroqResponse,
  _getUtteranceEmbedding,
};

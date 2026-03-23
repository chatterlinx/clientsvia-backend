'use strict';

/**
 * ============================================================================
 * PRICING CONVERSATION SERVICE
 * ============================================================================
 *
 * Groq-powered pricing Q&A bounded by the company's configured pricing catalog.
 *
 * PURPOSE:
 *   Prevents LLM hallucination of prices. When a caller asks a pricing question
 *   that keyword matching cannot answer, this service takes over — injecting the
 *   full active pricing catalog as hard guardrails into a Groq prompt.
 *   Groq is forbidden from inventing any number not in the catalog.
 *
 * INTEGRATION POINTS (wired in Agent2DiscoveryRunner.js):
 *   A) ASKING_PRICING bucket — when PricingInterceptor.buildResponse() returns
 *      null (no keyword match but items exist) → PricingConversationService fires
 *   B) callLLMAgentForNoMatch — after T1.5 miss, before Claude T2 — when
 *      PricingInterceptor.detect() is true → PricingConversationService fires
 *
 * MULTI-TENANT SAFETY:
 *   All settings are per-companyId. pricingItems loaded by caller, never fetched
 *   internally from a company-scoped cache leak. No cross-tenant data possible.
 *
 * GRACEFUL DEGRADE:
 *   Any Groq failure or JSON parse error → returns { intent: 'ERROR', response: null }
 *   Caller code falls through to existing behavior. Call never breaks.
 *
 * SETTINGS (stored in Company.pricingAiSettings — all per-company):
 *   enabled              Boolean  — master toggle
 *   model                String   — Groq model ID
 *   maxConversationTurns Number   — max consecutive turns before LLM fallback
 *   noPricingDataPhrase  String   — spoken when no catalog item matches
 *   tradeContext         String   — injected into system prompt (e.g. "HVAC contractor")
 *   conversationStyle    String   — 'concise' | 'detailed' | 'friendly'
 *
 * ============================================================================
 */

const GroqStreamAdapter = require('../../streaming/adapters/GroqStreamAdapter');
const logger            = require('../../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Valid intent values returned in the Groq JSON response */
const INTENT = {
  ANSWERED:       'ANSWERED',        // gave a specific pricing answer; conversation continues
  BOOKING_READY:  'BOOKING_READY',   // caller signalled readiness to schedule
  ADVISOR_NEEDED: 'ADVISOR_NEEDED',  // item requires advisor / transfer
  NO_DATA:        'NO_DATA',         // no catalog item matched — fallback phrase used
  ERROR:          'ERROR',           // Groq failure — graceful degrade, caller falls through
};

/** Groq max_tokens for pricing responses — concise phone answers */
const MAX_TOKENS = 150;

/** Temperature — low for factual accuracy, not creativity */
const TEMPERATURE = 0.15;

/** Built-in fallback when company noPricingDataPhrase is blank */
const BUILT_IN_NO_DATA =
  "Pricing for that service varies by job — I can have one of our advisors reach out to you with an accurate quote.";

// Style instructions injected into system prompt
const STYLE_INSTRUCTIONS = {
  concise:  'Keep your response under 20 words. Be direct and factual.',
  detailed: 'You may include up to 40 words. Add brief context if it helps.',
  friendly: 'Be warm and conversational. Keep it under 30 words. Sound human, not robotic.',
};

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG SERIALISER — strip fields not useful for the LLM, cap size
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a compact catalog representation safe for injection into a Groq system prompt.
 * Only includes fields relevant to the AI; excludes MongoDB internals (_id, __v, etc.)
 *
 * @param {Array} items — Active CompanyPricingItem documents
 * @returns {string} JSON string of the compact catalog
 */
function _buildCatalogString(items) {
  const compact = items.map(item => {
    const entry = {
      label:    item.label,
      keywords: item.keywords || [],
      response: item.response || '',
      action:   item.action   || 'RESPOND',
    };
    if (item.layer2Response?.trim()) {
      entry.layer2Keywords = item.layer2Keywords || [];
      entry.layer2Response = item.layer2Response;
    }
    if (item.layer3Response?.trim()) {
      entry.layer3Keywords = item.layer3Keywords || [];
      entry.layer3Response = item.layer3Response;
    }
    if (item.actionPrompt?.trim()) {
      entry.actionPrompt = item.actionPrompt;
    }
    if (item.includesDetail?.trim()) {
      entry.includesDetail = item.includesDetail;
    }
    return entry;
  });
  return JSON.stringify(compact, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Groq system prompt for a pricing conversation.
 * NOTE: Must contain the word "json" — Groq requires this for json_object mode.
 *
 * @param {Object} opts
 * @param {string} opts.companyName
 * @param {string} opts.tradeContext
 * @param {string} opts.catalogString       — compact JSON of active items
 * @param {string} opts.noPricingDataPhrase — fallback phrase when no match
 * @param {string} opts.conversationStyle   — 'concise' | 'detailed' | 'friendly'
 * @returns {string}
 */
function _buildSystemPrompt({ companyName, tradeContext, catalogString, noPricingDataPhrase, conversationStyle }) {
  const tradeDesc    = tradeContext?.trim() || 'a professional service company';
  const styleInstr   = STYLE_INSTRUCTIONS[conversationStyle] || STYLE_INSTRUCTIONS.concise;
  const noDataPhrase = noPricingDataPhrase?.trim() || BUILT_IN_NO_DATA;

  return `You are the phone agent for ${companyName}, ${tradeDesc}.
This is a live phone call. The caller is asking about pricing.

CRITICAL RULES — FOLLOW EXACTLY:
1. Answer ONLY using facts from the PRICING CATALOG below. NEVER invent any price, fee, dollar amount, or number.
2. If no catalog item matches the question, respond with the NO DATA PHRASE exactly as written.
3. ${styleInstr}
4. If the caller expresses readiness to schedule, book, or get a technician out, set intent to "BOOKING_READY".
5. If the matched item action is ADVISOR_CALLBACK or TRANSFER, set intent to "ADVISOR_NEEDED" and use the item's actionPrompt as your response.
6. Respond ONLY with valid json — no extra text.

PRICING CATALOG:
${catalogString}

NO DATA PHRASE (use verbatim when nothing matches):
"${noDataPhrase}"

RESPONSE FORMAT (json):
{"response":"<spoken text for caller>","intent":"ANSWERED|BOOKING_READY|ADVISOR_NEEDED|NO_DATA","confidence":0.0}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and validate the Groq JSON response.
 * Returns a safe fallback on any parse error.
 *
 * @param {string|null} raw — raw Groq response string
 * @returns {{ response: string|null, intent: string, confidence: number }}
 */
function _parseGroqResponse(raw) {
  if (!raw) return { response: null, intent: INTENT.ERROR, confidence: 0 };

  try {
    const parsed = JSON.parse(raw.trim());
    const intent = Object.values(INTENT).includes(parsed.intent) ? parsed.intent : INTENT.ANSWERED;
    const response  = typeof parsed.response === 'string' && parsed.response.trim()
      ? parsed.response.trim()
      : null;
    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.8;

    return { response, intent, confidence };
  } catch (_e) {
    // JSON parse failed — try to extract a response string as last resort
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
 * converse — Handle a single pricing question turn using Groq + catalog guardrails.
 *
 * @param {Object}   opts
 * @param {string}   opts.companyId        — for logging / multi-tenant safety
 * @param {string}   opts.question         — raw caller utterance
 * @param {Array}    opts.pricingItems     — active CompanyPricingItem documents
 * @param {Object}   [opts.voiceSettings]  — pricingVoiceSettings from v2Company
 * @param {Object}   [opts.aiSettings]     — pricingAiSettings from v2Company
 * @param {string}   [opts.companyName]    — spoken company name
 * @param {string}   [opts.callerName]     — caller's first name if known
 * @param {string}   [opts.callSid]        — for logging
 *
 * @returns {Promise<{ response: string|null, intent: string, confidence: number, latencyMs: number }>}
 */
async function converse(opts) {
  const {
    companyId,
    question,
    pricingItems    = [],
    voiceSettings   = {},
    aiSettings      = {},
    companyName     = 'our company',
    callerName,
    callSid,
  } = opts;

  const startMs = Date.now();

  // Guard: no items → NO_DATA immediately (no Groq call needed)
  if (!pricingItems.length) {
    const noDataPhrase = aiSettings.noPricingDataPhrase?.trim() ||
                         voiceSettings.notFoundResponse?.trim() ||
                         BUILT_IN_NO_DATA;
    logger.debug('[PricingConversation] no items configured — returning NO_DATA', { companyId, callSid });
    return { response: noDataPhrase, intent: INTENT.NO_DATA, confidence: 1, latencyMs: Date.now() - startMs };
  }

  // Guard: no question
  if (!question?.trim()) {
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: Date.now() - startMs };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('[PricingConversation] GROQ_API_KEY not set — skipping', { companyId, callSid });
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: 0 };
  }

  // Build prompt components
  const catalogString = _buildCatalogString(pricingItems);
  const systemPrompt  = _buildSystemPrompt({
    companyName:         companyName || 'our company',
    tradeContext:        aiSettings.tradeContext    || '',
    catalogString,
    noPricingDataPhrase: aiSettings.noPricingDataPhrase?.trim() ||
                         voiceSettings.notFoundResponse?.trim() || '',
    conversationStyle:   aiSettings.conversationStyle || 'concise',
  });

  // Build user message — include caller name for personalisation if available
  const userContent = callerName
    ? `Caller (${callerName}): ${question}`
    : question;

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       aiSettings.model || 'llama-3.3-70b-versatile',
      maxTokens:   MAX_TOKENS,
      temperature: TEMPERATURE,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: userContent }],
      callSid,
      jsonMode:    true,
    });

    if (result.failureReason && !result.response) {
      logger.warn('[PricingConversation] Groq failed', { companyId, callSid, reason: result.failureReason });
      return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: result.latencyMs };
    }

    const parsed = _parseGroqResponse(result.response);

    logger.debug('[PricingConversation] response', {
      companyId,
      callSid,
      intent:     parsed.intent,
      confidence: parsed.confidence,
      latencyMs:  result.latencyMs,
      preview:    parsed.response?.slice(0, 80),
    });

    return {
      response:   parsed.response,
      intent:     parsed.intent,
      confidence: parsed.confidence,
      latencyMs:  result.latencyMs,
    };

  } catch (err) {
    logger.error('[PricingConversation] unexpected error', { companyId, callSid, err: err.message });
    return { response: null, intent: INTENT.ERROR, confidence: 0, latencyMs: Date.now() - startMs };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  INTENT,
  converse,
  // Exported for tests
  _buildCatalogString,
  _buildSystemPrompt,
  _parseGroqResponse,
};

'use strict';

/**
 * ============================================================================
 * DiscoveryGroqFastLane
 *
 * 123RP Tier 1.5 — knowledge lookup fast path for discovery no-match turns.
 *
 * Position in the cascade:
 *   T1   ScrabEngine / trigger match       deterministic, <10ms
 *   T1.5 DiscoveryGroqFastLane  ← here    Groq + trigger knowledge, ~300ms
 *   T2   callLLMAgentForNoMatch            Claude streaming, ~800ms
 *   T3   UI-owned fallback                 instant
 *
 * Fires ONLY in callLLMAgentForNoMatch for real caller input.
 * NEVER fires for empty STT — re-engagement requires Claude's personality.
 *
 * Returns one of two shapes:
 *   { answered: true,  response: string, confidence: string, latencyMs: number }
 *   { answered: false, missReason: string }
 *
 * The miss path is always clean — every failure mode returns { answered: false }
 * so callLLMAgentForNoMatch falls through to Claude without interruption.
 * ============================================================================
 */

const logger                = require('../../../utils/logger');
const CompanyLocalTrigger   = require('../../../models/CompanyLocalTrigger');
const CompanyBookingTrigger = require('../../../models/CompanyBookingTrigger');
const GroqStreamAdapter     = require('../../streaming/adapters/GroqStreamAdapter');

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_ID = 'DISCOVERY_GROQ_FAST_LANE';
const MODEL      = 'llama-3.3-70b-versatile';
const MAX_TOKENS = 120;
const TIMEOUT_MS = 1200; // aggressive ceiling — if Groq takes >1.2s, Claude is a better bet

// Lean projection — only fields needed to build the knowledge block
const TRIGGER_PROJECTION = Object.freeze({ label: 1, displayName: 1, name: 1, answerText: 1 });

// Miss reasons — explicit codes for every failure path (no silent swallowing)
const MISS = Object.freeze({
  EMPTY_INPUT:     'empty_input',
  NO_GROQ_KEY:     'no_groq_key',
  NO_TRIGGERS:     'no_triggers',
  CANNOT_ANSWER:   'cannot_answer',
  LOW_CONFIDENCE:  'low_confidence',
  EMPTY_ANSWER:    'empty_answer',
  TIMEOUT:         'timeout',
  API_ERROR:       'api_error',
  PARSE_ERROR:     'parse_error',
  UNEXPECTED:      'unexpected_error',
});

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempt to answer a no-match caller question using Groq + trigger knowledge.
 *
 * @param {Object} params
 * @param {string}         params.question     - Raw caller input
 * @param {string|ObjectId} params.companyId   - Tenant ID (string or ObjectId, Mongoose handles both)
 * @param {string}         [params.companyName] - Company display name for context
 * @param {string}         [params.trade]       - Trade type for context
 * @param {string}         [params.callSid]     - For logging
 *
 * @returns {Promise<HitResult|MissResult>}
 *   HitResult  { answered: true,  response, confidence, latencyMs }
 *   MissResult { answered: false, missReason }
 */
async function attempt({ question, companyId, companyName = '', trade = '', callSid = 'unknown' }) {
  if (!question?.trim()) return _miss(MISS.EMPTY_INPUT);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return _miss(MISS.NO_GROQ_KEY);

  try {
    // ── Parallel DB load ──────────────────────────────────────────────────────
    // Booking INFO triggers first — highest relevance (promos, coupons, pricing).
    // Local triggers second — general company Q&A.
    const [bookingTriggers, localTriggers] = await Promise.all([
      CompanyBookingTrigger.find(
        { companyId, enabled: true, isDeleted: { $ne: true }, state: 'published', behavior: 'INFO' },
        TRIGGER_PROJECTION
      ).lean(),
      CompanyLocalTrigger.find(
        { companyId, enabled: true, isDeleted: { $ne: true }, state: 'published' },
        TRIGGER_PROJECTION
      ).lean(),
    ]);

    // Filter to triggers that actually have answer text, booking first
    const allTriggers = [...bookingTriggers, ...localTriggers].filter(t => t.answerText?.trim());

    if (allTriggers.length === 0) {
      logger.debug(`[${SERVICE_ID}] No trigger knowledge found for company`, { callSid, companyId: companyId?.toString() });
      return _miss(MISS.NO_TRIGGERS);
    }

    // ── Build prompts ─────────────────────────────────────────────────────────
    const knowledgeBlock = _buildKnowledgeBlock(allTriggers);
    const systemPrompt   = _buildSystemPrompt({ companyName, trade, knowledgeBlock });

    logger.debug(`[${SERVICE_ID}] Calling Groq`, {
      callSid,
      triggerCount: allTriggers.length,
      questionPreview: question.slice(0, 60),
    });

    // ── Groq call with hard timeout ───────────────────────────────────────────
    const groqCall = GroqStreamAdapter.streamFull({
      apiKey,
      model:       MODEL,
      maxTokens:   MAX_TOKENS,
      temperature: 0.1,
      jsonMode:    true,
      system:      systemPrompt,
      messages:    [{ role: 'user', content: question.trim() }],
    });

    const timeoutSignal = new Promise(resolve =>
      setTimeout(() => resolve({ _timeout: true }), TIMEOUT_MS)
    );

    let raw;
    try {
      raw = await Promise.race([groqCall, timeoutSignal]);
    } catch (err) {
      logger.warn(`[${SERVICE_ID}] Groq call threw`, { callSid, error: err.message });
      return _miss(MISS.API_ERROR);
    }

    if (raw?._timeout) {
      logger.warn(`[${SERVICE_ID}] Timeout after ${TIMEOUT_MS}ms — falling through to Claude`, { callSid });
      return _miss(MISS.TIMEOUT);
    }

    if (!raw?.response) return _miss(MISS.PARSE_ERROR);

    // ── Parse and validate JSON response ─────────────────────────────────────
    let parsed;
    try {
      parsed = JSON.parse(raw.response);
    } catch (_) {
      logger.warn(`[${SERVICE_ID}] JSON parse failed`, {
        callSid,
        raw: raw.response?.slice(0, 100),
      });
      return _miss(MISS.PARSE_ERROR);
    }

    // Groq signalled it cannot answer from the knowledge base
    if (!parsed.canAnswer) return _miss(MISS.CANNOT_ANSWER);

    // Low confidence → Claude will do better
    if (parsed.confidence === 'low') return _miss(MISS.LOW_CONFIDENCE);

    const answer = parsed.answer?.trim();
    if (!answer) return _miss(MISS.EMPTY_ANSWER);

    logger.debug(`[${SERVICE_ID}] Hit`, {
      callSid,
      confidence: parsed.confidence,
      latencyMs:  raw.latencyMs,
      answerPreview: answer.slice(0, 80),
    });

    return {
      answered:   true,
      response:   answer,
      confidence: parsed.confidence || 'medium',
      latencyMs:  raw.latencyMs,
    };

  } catch (err) {
    // Belt-and-suspenders: catch anything not already handled above
    logger.warn(`[${SERVICE_ID}] Unexpected error`, { callSid, error: err.message });
    return _miss(MISS.UNEXPECTED);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Format trigger docs into a compact knowledge block for the system prompt.
 * Booking triggers come first (caller is more likely asking about promos/pricing).
 */
function _buildKnowledgeBlock(triggers) {
  return triggers
    .map(t => {
      const name = t.label || t.displayName || t.name || 'Info';
      return `- ${name}: ${t.answerText.trim()}`;
    })
    .join('\n');
}

/**
 * Build the Groq system prompt.
 * Rules:
 *  - Must include the word "json" for Groq JSON mode
 *  - Short and directive — Groq performs best with clear, tight instructions
 *  - Explicitly instructs Groq NOT to guess beyond the knowledge base
 *  - No scheduling offers — the consent funnel handles that separately
 */
function _buildSystemPrompt({ companyName, trade, knowledgeBlock }) {
  const companyDesc = companyName && trade
    ? `${companyName} (${trade} company)`
    : companyName || trade || 'this company';

  return [
    `You answer caller questions for ${companyDesc} using ONLY the knowledge base below.`,
    'Answer in 1-2 short, natural sentences as if speaking on the phone.',
    'Do NOT add scheduling offers or closing questions — the system handles that separately.',
    'If the answer is not covered by the knowledge base, return { "canAnswer": false }.',
    'Return valid json: { "canAnswer": boolean, "answer": string | null, "confidence": "high" | "medium" | "low" }',
    '',
    'KNOWLEDGE BASE:',
    knowledgeBlock,
  ].join('\n');
}

/**
 * Return a clean miss result with an explicit reason code.
 * All failure paths funnel through here — no silent swallowing.
 * @param {string} reason - One of the MISS constant values
 * @returns {MissResult}
 */
function _miss(reason) {
  return { answered: false, missReason: reason };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  attempt,
  MISS, // exported so callers can reference reason codes in tests / traces
};

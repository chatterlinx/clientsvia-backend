'use strict';

/**
 * ============================================================================
 * BOOKING LLM INTERCEPT SERVICE
 * 123RP Tier 2 — mid-booking off-topic question handler
 *
 * When a caller asks an off-topic question during the booking flow and no
 * booking trigger card matches (Tier 1), this service calls the LLM for a
 * single turn to answer the question intelligently using company knowledge.
 *
 * The caller (BookingLogicEngine) appends RETURN_TO_BOOKING_Q after this
 * returns — this service intentionally does NOT add it, keeping concerns clean.
 *
 * Usage:
 *   const answer = await BookingLLMInterceptService.answer({ question, companyId, callId, ctx, config });
 *   if (answer) return { nextPrompt: `${answer} ${RETURN_TO_BOOKING_Q}`, ... };
 *   // else fall through to Tier 3 fallback
 *
 * ============================================================================
 */

const logger        = require('../../../utils/logger');
const v2Company     = require('../../../models/v2Company');
const { callLLM0 }  = require('../../llmRegistry');

const SERVICE_ID           = 'BOOKING_LLM_INTERCEPT';
const INTERCEPT_TIMEOUT_MS = 4000; // hard ceiling — caller falls to Tier 3 if exceeded

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { answer };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Answer an off-topic question asked mid-booking using the LLM.
 *
 * @param {Object} params
 * @param {string} params.question   - The caller's off-topic question / statement
 * @param {string} params.companyId  - Tenant ID
 * @param {string} [params.callId]   - Twilio Call SID (for LLM logging/cost tracking)
 * @param {Object} params.ctx        - Current booking context (step, bookingMode, collectedFields, etc.)
 * @param {Object} params.config     - Booking engine config (has companyName, t2DigressionAck, etc.)
 * @returns {Promise<string|null>}   - LLM answer text (no return-to-booking suffix), or null on failure
 */
async function answer({ question, companyId, callId, ctx, config }) {
  if (!question?.trim()) return null;

  try {
    // ── Lean company load for AI knowledge context ────────────────────────────
    // Only fetch the fields needed for the intercept system prompt.
    // Booking config already loaded by caller — we just need AI knowledge here.
    const company = await v2Company.findOne(
      { _id: companyId },
      {
        companyName: 1,
        tradeType:   1,
        'aiAgentSettings.agent2.discovery.scripts':           1,
        'aiAgentSettings.agent2.discovery.agentPersonality':  1,
      }
    ).lean();

    const companyName = company?.companyName
                     || config?.companyName
                     || 'our company';
    const trade       = company?.tradeType || 'service';
    const scripts     = company?.aiAgentSettings?.agent2?.discovery?.scripts?.trim()          || '';
    const personality = company?.aiAgentSettings?.agent2?.discovery?.agentPersonality?.trim() || '';

    // ── Build system prompt ───────────────────────────────────────────────────
    const systemPrompt = _buildSystemPrompt({ companyName, trade, scripts, personality, ctx });

    // ── LLM call with hard timeout ────────────────────────────────────────────
    const response = await Promise.race([
      callLLM0({
        callId:    callId || 'booking-intercept',
        companyId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: question.trim() }
        ],
        temperature: 0.7,
        max_tokens:  150,
        metadata: { mode: 'booking_intercept', step: ctx?.step }
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`BOOKING_INTERCEPT_TIMEOUT after ${INTERCEPT_TIMEOUT_MS}ms`)),
          INTERCEPT_TIMEOUT_MS
        )
      )
    ]);

    const replyText = response?.choices?.[0]?.message?.content?.trim();

    if (!replyText) {
      logger.warn(`[${SERVICE_ID}] LLM returned empty response`, { companyId, step: ctx?.step });
      return null;
    }

    logger.info(`[${SERVICE_ID}] LLM intercept answered`, {
      companyId,
      step:      ctx?.step,
      latencyMs: response._latencyMs
    });

    return replyText;

  } catch (err) {
    // Any failure (timeout, API error, DB error) — signal Tier 3 to take over
    logger.warn(`[${SERVICE_ID}] Intercept failed — Tier 3 fallback will run`, {
      companyId,
      step:  ctx?.step,
      error: err.message
    });
    return null;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build the minimal system prompt for a mid-booking intercept turn.
 *
 * Keeps the prompt short and focused — the LLM answers ONE question then stops.
 * The return-to-booking question is added by BookingLogicEngine, NOT here.
 */
function _buildSystemPrompt({ companyName, trade, scripts, personality, ctx }) {
  const stepLabel  = ctx?.step
    ? `currently collecting ${ctx.step.replace(/_/g, ' ').toLowerCase()}`
    : 'in the booking flow';

  const lines = [
    `You are a helpful booking assistant for ${companyName} (${trade} company).`,
    `A caller is in the middle of scheduling an appointment (${stepLabel}) and asked an off-topic question.`,
    personality ? `Your personality: ${personality}` : null,
    `Answer their question briefly and professionally in 1-2 sentences.`,
    `Do NOT end your answer with any question about returning to booking — the system handles that automatically.`,
    ctx?.bookingMode ? `Service being booked: ${ctx.bookingMode}.`                            : null,
    ctx?.collectedFields?.firstName ? `Caller name: ${ctx.collectedFields.firstName}.`        : null,
  ].filter(Boolean).join(' ');

  if (scripts) {
    return `${lines}\n\nCOMPANY KNOWLEDGE:\n${scripts}`;
  }

  return lines;
}

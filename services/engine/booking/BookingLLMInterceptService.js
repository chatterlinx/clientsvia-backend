'use strict';

/**
 * ============================================================================
 * BOOKING LLM INTERCEPT SERVICE
 * 123BRP Tier 2 — mid-booking off-topic question handler
 *
 * When a caller asks an off-topic question during the booking flow and no
 * booking trigger card matches (Tier 1), this service calls the LLM for a
 * single turn to answer the question intelligently using company knowledge.
 *
 * Knowledge injected (parallel DB load, lean projections):
 *   1. Company scripts + personality (existing)
 *   2. CompanyLocalTrigger Q&A (discovery triggers — general company knowledge)
 *   3. CompanyBookingTrigger behavior=INFO (booking-specific: promos, coupons, pricing)
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

const logger                = require('../../../utils/logger');
const v2Company             = require('../../../models/v2Company');
const CompanyLocalTrigger   = require('../../../models/CompanyLocalTrigger');
const CompanyBookingTrigger = require('../../../models/CompanyBookingTrigger');
const { callLLM0 }          = require('../../llmRegistry');

const SERVICE_ID           = 'BOOKING_LLM_INTERCEPT';
const INTERCEPT_TIMEOUT_MS = 4000; // hard ceiling — caller falls to Tier 3 if exceeded

// Projection for trigger queries — only the fields needed for the prompt
const TRIGGER_PROJECTION = Object.freeze({ label: 1, displayName: 1, name: 1, answerText: 1 });

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
    // ── Parallel DB load — all 3 queries fire at once ─────────────────────────
    const [company, localTriggers, bookingInfoTriggers] = await Promise.all([
      v2Company.findOne(
        { _id: companyId },
        {
          companyName: 1,
          tradeType:   1,
          'aiAgentSettings.agent2.discovery.scripts':           1,
          'aiAgentSettings.agent2.discovery.agentPersonality':  1,
        }
      ).lean(),

      CompanyLocalTrigger.find(
        { companyId, enabled: true, isDeleted: { $ne: true }, state: 'published' },
        TRIGGER_PROJECTION
      ).lean(),

      CompanyBookingTrigger.find(
        { companyId, enabled: true, isDeleted: { $ne: true }, state: 'published', behavior: 'INFO' },
        TRIGGER_PROJECTION
      ).lean(),
    ]);

    const companyName = company?.companyName
                     || config?.companyName
                     || 'our company';
    const trade       = company?.tradeType || 'service';
    const scripts     = company?.aiAgentSettings?.agent2?.discovery?.scripts?.trim()          || '';
    const personality = company?.aiAgentSettings?.agent2?.discovery?.agentPersonality?.trim() || '';

    // ── Build system prompt ───────────────────────────────────────────────────
    const systemPrompt = _buildSystemPrompt({
      companyName, trade, scripts, personality, ctx,
      localTriggers, bookingInfoTriggers,
    });

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
      step:             ctx?.step,
      latencyMs:        response._latencyMs,
      localTriggers:    localTriggers.length,
      bookingTriggers:  bookingInfoTriggers.length,
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
 * Format an array of trigger docs into compact knowledge lines.
 * "- Trigger Name: answer text"
 */
function _formatTriggers(triggers) {
  return triggers
    .filter(t => t.answerText?.trim())
    .map(t => {
      const name = t.label || t.displayName || t.name || 'Info';
      return `- ${name}: ${t.answerText.trim()}`;
    })
    .join('\n');
}

/**
 * Build the system prompt for a mid-booking intercept turn.
 * Injects all available company knowledge so the LLM never has to guess.
 */
function _buildSystemPrompt({ companyName, trade, scripts, personality, ctx, localTriggers, bookingInfoTriggers }) {
  const stepLabel = ctx?.step
    ? `currently collecting ${ctx.step.replace(/_/g, ' ').toLowerCase()}`
    : 'in the booking flow';

  const intro = [
    `You are a helpful booking assistant for ${companyName} (${trade} company).`,
    `A caller is in the middle of scheduling an appointment (${stepLabel}) and asked an off-topic question.`,
    personality ? `Your personality: ${personality}` : null,
    `Answer their question briefly and professionally in 1-2 sentences.`,
    `Do NOT end your answer with any question about returning to booking — the system handles that automatically.`,
    ctx?.bookingMode ? `Service being booked: ${ctx.bookingMode}.` : null,
  ].filter(Boolean).join(' ');

  const sections = [intro];

  // ── Current booking state — lets LLM answer slot/scheduling questions ─────
  // Inject everything collected so far: name, phone, preferred day/time, and
  // any available time slots that were offered. Without this, the LLM has no
  // way to answer "what times do you have?" or "is Tuesday available?" correctly.
  const collectedName = [
    ctx?.collectedFields?.firstName,
    ctx?.collectedFields?.lastName,
  ].filter(Boolean).join(' ');

  const stateLines = [
    collectedName                          ? `Caller name: ${collectedName}`                                         : null,
    ctx?.collectedFields?.phone            ? `Phone on file: ${ctx.collectedFields.phone}`                           : null,
    ctx?.collectedFields?.address          ? `Service address: ${ctx.collectedFields.address}`                       : null,
    ctx?.preferredDay                      ? `Caller's preferred day: ${ctx.preferredDay}`                           : null,
    ctx?.preferredTime                     ? `Caller's preferred time: ${ctx.preferredTime}`                         : null,
    ctx?.availableTimeOptions?.length
      ? `Available time slots offered to caller: ${ctx.availableTimeOptions.join(', ')}`                             : null,
    ctx?.availableTimeOptions?.length === 0 ? `No time slots are available for the preferred day.`                   : null,
  ].filter(Boolean);

  if (stateLines.length) {
    sections.push(`\nCURRENT BOOKING STATE:\n${stateLines.join('\n')}`);
  }

  // Booking-specific knowledge (promotions, coupons, pricing) — highest relevance
  const bookingKnowledge = _formatTriggers(bookingInfoTriggers);
  if (bookingKnowledge) {
    sections.push(`\nBOOKING KNOWLEDGE (promotions, offers, booking policies):\n${bookingKnowledge}`);
  }

  // General company Q&A from discovery triggers
  const localKnowledge = _formatTriggers(localTriggers);
  if (localKnowledge) {
    sections.push(`\nCOMPANY Q&A:\n${localKnowledge}`);
  }

  // Freeform scripts (lowest priority — already existed)
  if (scripts) {
    sections.push(`\nCOMPANY KNOWLEDGE:\n${scripts}`);
  }

  return sections.join('');
}

/**
 * ============================================================================
 * AFTER-HOURS MESSAGE CAPTURE (Deterministic, No LLM)
 * ============================================================================
 *
 * Goal:
 * - Capture a revenue-safe after-hours message with a minimal contract:
 *   1) full name
 *   2) callback phone
 *   3) service address (street + city)
 *   4) problem summary
 *   5) preferred time window OR "first available"
 * - Require explicit confirmation before marking success.
 *
 * Enterprise rules:
 * - No hardcoded "AI behavior" beyond last-resort safety nets.
 * - Prompts should come from existing company config where possible.
 * - Output is a deterministic state machine; LLM is not involved.
 */

const logger = require('../utils/logger');
const BookingScriptEngine = require('./BookingScriptEngine');

const STEPS = {
  ASK_NAME: 'ASK_NAME',
  ASK_PHONE: 'ASK_PHONE',
  ASK_ADDRESS: 'ASK_ADDRESS',
  ASK_PROBLEM: 'ASK_PROBLEM',
  ASK_TIME: 'ASK_TIME',
  CONFIRM: 'CONFIRM',
  COMPLETE: 'COMPLETE'
};

function isYes(text) {
  const t = (text || '').toLowerCase();
  return /\b(yes|yeah|yep|correct|right|that's right|sure|affirmative|ok|okay)\b/.test(t);
}

function isNo(text) {
  const t = (text || '').toLowerCase();
  return /\b(no|nope|not correct|wrong|that's wrong)\b/.test(t);
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function getBookingSlotQuestion(company, typeOrId, fallback) {
  const cfg = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: {} });
  const slots = cfg.slots || [];
  const slot = slots.find(s => s.type === typeOrId) || slots.find(s => (s.slotId || s.id) === typeOrId);
  return firstNonEmpty(slot?.question, fallback);
}

function summarize(state) {
  const m = state.afterHoursFlow?.message || {};
  const parts = [];
  if (m.name) parts.push(`Name: ${m.name}`);
  if (m.phone) parts.push(`Phone: ${m.phone}`);
  if (m.address) parts.push(`Address: ${m.address}`);
  if (m.problem) parts.push(`Issue: ${m.problem}`);
  if (m.preferredTime) parts.push(`Preferred time: ${m.preferredTime}`);
  return parts.join('. ');
}

function contractMissing(state) {
  const m = state.afterHoursFlow?.message || {};
  const missing = [];
  if (!m.name) missing.push('name');
  if (!m.phone) missing.push('phone');
  if (!m.address) missing.push('address');
  if (!m.problem) missing.push('problemSummary');
  if (!m.preferredTime) missing.push('preferredTime');
  return missing;
}

class AfterHoursCallTurnHandler {
  /**
   * @returns {Promise<{ result: object, updatedCallState: object }>}
   */
  static async handleTurn({ companyId, company, callSid, userText, callState }) {
    const state = callState || {};
    state.afterHoursFlow = state.afterHoursFlow || {
      step: STEPS.ASK_NAME,
      completed: false,
      confirmed: false,
      message: {}
    };

    const flow = state.afterHoursFlow;
    const msg = flow.message || {};

    // Configurable scripts (prefer existing legacy protocol fields)
    const protocols = company?.agentSettings?.protocols || {};
    const confirmPrompt = firstNonEmpty(
      protocols.bookingConfirmation,
      'DEFAULT - OVERRIDE IN UI: Just to confirm, is that correct?'
    );
    const completion = firstNonEmpty(
      protocols.messageTaking,
      'DEFAULT - OVERRIDE IN UI: Thanks — we’re currently closed, but we’ve got your message and we’ll follow up as soon as we’re open.'
    );

    // Questions: reuse booking slot questions where possible
    const qName = getBookingSlotQuestion(company, 'name', 'DEFAULT - OVERRIDE IN UI: What’s your full name?');
    const qPhone = getBookingSlotQuestion(company, 'phone', 'DEFAULT - OVERRIDE IN UI: What’s the best callback number?');
    const qAddress = getBookingSlotQuestion(company, 'address', 'DEFAULT - OVERRIDE IN UI: What’s the service address?');
    const qTime = getBookingSlotQuestion(company, 'time', 'DEFAULT - OVERRIDE IN UI: When would you like us to come out? You can say “first available.”');
    const qProblem = firstNonEmpty(
      protocols.whenInDoubt,
      'DEFAULT - OVERRIDE IN UI: Briefly, what’s going on with the system?'
    );

    // Helper to advance
    const go = (nextStep, reply, extra = {}) => {
      flow.step = nextStep;
      state.afterHoursFlow = flow;
      return {
        result: {
          action: 'after_hours_message',
          text: reply,
          response: reply,
          afterHours: true,
          ...extra
        },
        updatedCallState: state
      };
    };

    const text = (userText || '').trim();
    const lower = text.toLowerCase();

    // Confirmation step
    if (flow.step === STEPS.CONFIRM) {
      if (isYes(lower) && !isNo(lower)) {
        flow.confirmed = true;
        flow.completed = true;
        flow.step = STEPS.COMPLETE;
        state.afterHoursFlow = flow;

        logger.info('[AFTER_HOURS] Message confirmed', {
          companyId,
          callSid,
          missing: contractMissing(state)
        });

        return {
          result: {
            action: 'after_hours_complete',
            text: completion,
            response: completion,
            afterHours: true,
            message: { ...msg }
          },
          updatedCallState: state
        };
      }

      // If no/unclear, restart at problem summary (most likely to need correction)
      if (isNo(lower)) {
        flow.confirmed = false;
        flow.step = STEPS.ASK_PROBLEM;
        state.afterHoursFlow = flow;
        return go(STEPS.ASK_PROBLEM, qProblem, { reason: 'confirm_no_restart_problem' });
      }

      // Unclear → ask confirm again
      return go(STEPS.CONFIRM, confirmPrompt, { reason: 'confirm_unclear' });
    }

    // Capture fields (simple deterministic; improves over time)
    if (flow.step === STEPS.ASK_NAME) {
      if (text) msg.name = text;
      flow.message = msg;
      state.afterHoursFlow = flow;
      return go(STEPS.ASK_PHONE, qPhone);
    }

    if (flow.step === STEPS.ASK_PHONE) {
      if (text) msg.phone = text;
      flow.message = msg;
      state.afterHoursFlow = flow;
      return go(STEPS.ASK_ADDRESS, qAddress);
    }

    if (flow.step === STEPS.ASK_ADDRESS) {
      if (text) msg.address = text;
      flow.message = msg;
      state.afterHoursFlow = flow;
      return go(STEPS.ASK_PROBLEM, qProblem);
    }

    if (flow.step === STEPS.ASK_PROBLEM) {
      if (text) msg.problem = text;
      flow.message = msg;
      state.afterHoursFlow = flow;
      return go(STEPS.ASK_TIME, qTime);
    }

    if (flow.step === STEPS.ASK_TIME) {
      if (text) msg.preferredTime = text;
      flow.message = msg;

      // If contract incomplete, go back to the first missing field.
      const missing = contractMissing(state);
      if (missing.length > 0) {
        const next = missing[0];
        logger.warn('[AFTER_HOURS] Contract missing field, re-asking', { companyId, callSid, next, missing });
        if (next === 'name') return go(STEPS.ASK_NAME, qName);
        if (next === 'phone') return go(STEPS.ASK_PHONE, qPhone);
        if (next === 'address') return go(STEPS.ASK_ADDRESS, qAddress);
        if (next === 'problemSummary') return go(STEPS.ASK_PROBLEM, qProblem);
        if (next === 'preferredTime') return go(STEPS.ASK_TIME, qTime);
      }

      // All fields captured → confirm
      state.afterHoursFlow = flow;
      const summary = summarize(state);
      const confirmLine = summary ? `${summary}. ${confirmPrompt}` : confirmPrompt;
      return go(STEPS.CONFIRM, confirmLine);
    }

    // Fallback: if somehow unknown step, restart safely
    flow.step = STEPS.ASK_NAME;
    state.afterHoursFlow = flow;
    return go(STEPS.ASK_NAME, qName, { reason: 'unknown_step_reset' });
  }
}

AfterHoursCallTurnHandler.STEPS = STEPS;

module.exports = AfterHoursCallTurnHandler;



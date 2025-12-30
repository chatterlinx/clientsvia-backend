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

const FLOW_STEPS = {
  ASK_FIELD: 'ASK_FIELD',
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

function dedupeStringsPreserveOrder(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const v = String(raw || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function resolveAfterHoursContract(company) {
  const fdb = company?.aiAgentSettings?.frontDeskBehavior || {};
  const raw = fdb.afterHoursMessageContract || {};

  const mode = raw.mode === 'custom' ? 'custom' : 'inherit_booking_minimum';
  const baseline = ['name', 'phone', 'address', 'problemSummary', 'preferredTime'];

  if (mode !== 'custom') {
    return {
      mode: 'inherit_booking_minimum',
      requiredFieldKeys: baseline,
      extraSlotIds: [],
      effectiveFieldKeys: baseline
    };
  }

  const requiredFieldKeys = dedupeStringsPreserveOrder(raw.requiredFieldKeys);
  const extraSlotIds = dedupeStringsPreserveOrder(raw.extraSlotIds);

  // Safety net: never allow "zero required fields" in after-hours mode.
  if (requiredFieldKeys.length === 0 && extraSlotIds.length === 0) {
    logger.warn('[AFTER_HOURS] afterHoursMessageContract is custom but empty; falling back to booking minimum', {
      companyId: company?._id?.toString?.() || null
    });
    return {
      mode: 'inherit_booking_minimum',
      requiredFieldKeys: baseline,
      extraSlotIds: [],
      effectiveFieldKeys: baseline
    };
  }

  const effectiveFieldKeys = [...requiredFieldKeys, ...extraSlotIds];
  return { mode: 'custom', requiredFieldKeys, extraSlotIds, effectiveFieldKeys };
}

function summarizeFlow(flow) {
  const m = flow?.message || {};
  const slots = flow?.slots || {};
  const parts = [];
  if (m.name) parts.push(`Name: ${m.name}`);
  if (m.phone) parts.push(`Phone: ${m.phone}`);
  if (m.address) parts.push(`Address: ${m.address}`);
  if (m.problem) parts.push(`Issue: ${m.problem}`);
  if (m.preferredTime) parts.push(`Preferred time: ${m.preferredTime}`);
  for (const [k, v] of Object.entries(slots)) {
    if (!v) continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join('. ');
}

function getValueForField(flow, fieldKey) {
  const m = flow?.message || {};
  const slots = flow?.slots || {};
  if (fieldKey === 'name') return m.name;
  if (fieldKey === 'phone') return m.phone;
  if (fieldKey === 'address') return m.address;
  if (fieldKey === 'problemSummary') return m.problem;
  if (fieldKey === 'preferredTime') return m.preferredTime;
  return slots[fieldKey];
}

function setValueForField(flow, fieldKey, value) {
  const m = flow.message || (flow.message = {});
  const slots = flow.slots || (flow.slots = {});
  if (fieldKey === 'name') m.name = value;
  else if (fieldKey === 'phone') m.phone = value;
  else if (fieldKey === 'address') m.address = value;
  else if (fieldKey === 'problemSummary') m.problem = value;
  else if (fieldKey === 'preferredTime') m.preferredTime = value;
  else slots[fieldKey] = value;
}

class AfterHoursCallTurnHandler {
  /**
   * @returns {Promise<{ result: object, updatedCallState: object }>}
   */
  static async handleTurn({ companyId, company, callSid, userText, callState }) {
    const state = callState || {};
    const contract = resolveAfterHoursContract(company);
    state.afterHoursFlow = state.afterHoursFlow || {
      step: FLOW_STEPS.ASK_FIELD,
      index: 0,
      contract,
      completed: false,
      confirmed: false,
      message: {},
      slots: {}
    };

    const flow = state.afterHoursFlow;
    if (!flow.contract || !Array.isArray(flow.contract.effectiveFieldKeys)) {
      flow.contract = contract;
    }
    const effectiveFieldKeys = Array.isArray(flow.contract.effectiveFieldKeys)
      ? flow.contract.effectiveFieldKeys
      : ['name', 'phone', 'address', 'problemSummary', 'preferredTime'];

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

    const getQuestionForField = (fieldKey) => {
      if (fieldKey === 'name') {
        return getBookingSlotQuestion(company, 'name', 'DEFAULT - OVERRIDE IN UI: What’s your full name?');
      }
      if (fieldKey === 'phone') {
        return getBookingSlotQuestion(company, 'phone', 'DEFAULT - OVERRIDE IN UI: What’s the best callback number?');
      }
      if (fieldKey === 'address') {
        return getBookingSlotQuestion(company, 'address', 'DEFAULT - OVERRIDE IN UI: What’s the service address?');
      }
      if (fieldKey === 'preferredTime') {
        return firstNonEmpty(
          getBookingSlotQuestion(company, 'time', null),
          getBookingSlotQuestion(company, 'preferredTime', null),
          'DEFAULT - OVERRIDE IN UI: When would you like us to come out? You can say “first available.”'
        );
      }
      if (fieldKey === 'problemSummary') {
        return firstNonEmpty(
          protocols.whenInDoubt,
          'DEFAULT - OVERRIDE IN UI: Briefly, what’s going on with the system?'
        );
      }
      // Treat anything else as a booking slot id
      return getBookingSlotQuestion(company, fieldKey, `DEFAULT - OVERRIDE IN UI: Please provide ${fieldKey}.`);
    };

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
    if (flow.step === FLOW_STEPS.CONFIRM) {
      if (isYes(lower) && !isNo(lower)) {
        flow.confirmed = true;
        flow.completed = true;
        flow.step = FLOW_STEPS.COMPLETE;
        state.afterHoursFlow = flow;

        logger.info('[AFTER_HOURS] Message confirmed', {
          companyId,
          callSid,
          contractMode: flow.contract?.mode || null,
          fieldsCount: effectiveFieldKeys.length
        });

        return {
          result: {
            action: 'after_hours_complete',
            text: completion,
            response: completion,
            afterHours: true,
            message: {
              ...(flow.message || {}),
              slots: flow.slots || {}
            }
          },
          updatedCallState: state
        };
      }

      // If no/unclear, restart at problemSummary if present, otherwise restart at first field.
      if (isNo(lower)) {
        flow.confirmed = false;
        const idx = effectiveFieldKeys.indexOf('problemSummary');
        flow.index = idx >= 0 ? idx : 0;
        flow.step = FLOW_STEPS.ASK_FIELD;
        state.afterHoursFlow = flow;
        const key = effectiveFieldKeys[flow.index] || effectiveFieldKeys[0] || 'name';
        return go(FLOW_STEPS.ASK_FIELD, getQuestionForField(key), { reason: 'confirm_no_restart', field: key });
      }

      // Unclear → ask confirm again
      return go(FLOW_STEPS.CONFIRM, confirmPrompt, { reason: 'confirm_unclear' });
    }

    // Ask/capture current field (deterministic)
    if (flow.step === FLOW_STEPS.ASK_FIELD) {
      const idx = typeof flow.index === 'number' ? flow.index : 0;
      flow.index = idx;

      const fieldKey = effectiveFieldKeys[idx];
      if (!fieldKey) {
        // No fields -> confirm immediately
        flow.step = FLOW_STEPS.CONFIRM;
        state.afterHoursFlow = flow;
        const summary = summarizeFlow(flow);
        const confirmLine = summary ? `${summary}. ${confirmPrompt}` : confirmPrompt;
        return go(FLOW_STEPS.CONFIRM, confirmLine, { reason: 'no_fields_confirm' });
      }

      // If no input, re-ask current field
      if (!text) {
        return go(FLOW_STEPS.ASK_FIELD, getQuestionForField(fieldKey), { reason: 'empty_input_reask', field: fieldKey });
      }

      // Store value
      setValueForField(flow, fieldKey, text);
      state.afterHoursFlow = flow;

      // Advance to next missing field (skip any already filled)
      let nextIndex = idx + 1;
      while (nextIndex < effectiveFieldKeys.length && getValueForField(flow, effectiveFieldKeys[nextIndex])) {
        nextIndex += 1;
      }
      flow.index = nextIndex;

      // If done, confirm
      if (nextIndex >= effectiveFieldKeys.length) {
        flow.step = FLOW_STEPS.CONFIRM;
        state.afterHoursFlow = flow;
        const summary = summarizeFlow(flow);
        const confirmLine = summary ? `${summary}. ${confirmPrompt}` : confirmPrompt;
        return go(FLOW_STEPS.CONFIRM, confirmLine);
      }

      // Ask next
      const nextKey = effectiveFieldKeys[nextIndex];
      return go(FLOW_STEPS.ASK_FIELD, getQuestionForField(nextKey), { field: nextKey });
    }

    // Fallback: if somehow unknown step, restart safely
    flow.step = FLOW_STEPS.ASK_FIELD;
    flow.index = 0;
    state.afterHoursFlow = flow;
    const firstKey = effectiveFieldKeys[0] || 'name';
    return go(FLOW_STEPS.ASK_FIELD, getQuestionForField(firstKey), { reason: 'unknown_step_reset', field: firstKey });
  }
}

AfterHoursCallTurnHandler.STEPS = FLOW_STEPS;

module.exports = AfterHoursCallTurnHandler;



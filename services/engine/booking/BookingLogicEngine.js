/**
 * ============================================================================
 * BOOKING LOGIC ENGINE — PRODUCTION IMPLEMENTATION
 * ClientVia Platform · Agent Console Contract AC1
 *
 * CLEAN MODULE — NO LEGACY CODE.
 *
 * Responsibilities:
 *   - Receive handoff payload from Agent 2.0 discovery
 *   - Collect missing required fields (name, phone, address)
 *   - Query Google Calendar for real available time options per company
 *   - Present options to caller and capture selection
 *   - Confirm and write the event to Google Calendar
 *
 * Communication Contract:
 *   Input:  { companyId, payload, bookingCtx, userInput, isTest }
 *   Output: { nextPrompt, bookingCtx, completed, calendarEventId?, events[] }
 *
 * Multi-tenant: every operation is scoped to companyId.
 * No hardcoded values — all config comes from aiAgentSettings.bookingLogic.
 *
 * ============================================================================
 */

'use strict';

const logger               = require('../../../utils/logger');
const v2Company            = require('../../../models/v2Company');
const GoogleCalendarService = require('../../GoogleCalendarService');
const { BookingTriggerMatcher } = require('./BookingTriggerMatcher');

const ENGINE_ID = 'BOOKING_LOGIC_ENGINE';
const VERSION   = 'BL2.0';

/* ============================================================================
   BOOKING FLOW STEPS
   ============================================================================ */

const STEPS = {
  INIT:            'INIT',
  COLLECT_NAME:    'COLLECT_NAME',
  COLLECT_PHONE:   'COLLECT_PHONE',
  COLLECT_ADDRESS: 'COLLECT_ADDRESS',
  OFFER_TIMES:     'OFFER_TIMES',
  CONFIRM:         'CONFIRM',
  COMPLETED:       'COMPLETED'
};

/* ============================================================================
   DEFAULTS  (used only when company config fields are absent)
   ============================================================================ */

const DEFAULT_CONFIG = {
  appointmentDuration: 60,
  bufferMinutes:       0,
  advanceBookingDays:  14,
  requiredFields:      ['firstName', 'phone'],
  confirmationMessage: 'Your appointment is confirmed for {date} at {time}. We look forward to seeing you!'
};

/* ============================================================================
   MAIN ENTRY POINT
   ============================================================================ */

/**
 * Process a single booking conversation step.
 *
 * @param {Object}       params
 * @param {string}       params.companyId  - Tenant company ID
 * @param {Object}       params.payload    - Handoff payload from Agent 2.0
 * @param {Object|null}  params.bookingCtx - Persisted booking context (null on first turn)
 * @param {string|null}  params.userInput  - Caller's response to the previous prompt
 * @param {boolean}      params.isTest     - True when called from the UI simulator
 *
 * @returns {Promise<{nextPrompt: string, bookingCtx: Object, completed: boolean,
 *                    calendarEventId?: string, events: Array}>}
 */
async function processStep({ companyId, payload, bookingCtx, userInput, isTest = false }) {
  const stepId = `step_${Date.now()}`;
  const events = [];

  logger.info(`[${ENGINE_ID}] Processing step`, {
    stepId,
    companyId,
    currentStep: bookingCtx?.step || 'INIT',
    hasUserInput: !!userInput,
    isTest
  });

  try {
    const config = await loadCompanyConfig(companyId);
    const ctx    = bookingCtx ? { ...bookingCtx } : initializeContext(payload, config);

    const result = await processCurrentStep(ctx, userInput, config, companyId, isTest, events);

    logger.info(`[${ENGINE_ID}] Step processed`, {
      stepId,
      nextStep:    result.bookingCtx.step,
      completed:   result.completed,
      eventsCount: events.length
    });

    return { ...result, events };

  } catch (error) {
    logger.error(`[${ENGINE_ID}] Step processing failed`, {
      stepId, companyId,
      error: error.message,
      stack: error.stack
    });

    events.push({ type: 'BL1_ERROR', error: error.message, timestamp: Date.now() });

    return {
      nextPrompt: "I'm sorry, I ran into an issue with the booking system. Would you like me to have someone call you back to schedule?",
      bookingCtx: bookingCtx || {},
      completed:  false,
      error:      error.message,
      events
    };
  }
}

/* ============================================================================
   CONFIG LOADING
   ============================================================================ */

async function loadCompanyConfig(companyId) {
  try {
    const company = await v2Company.findById(companyId)
      .select('aiAgentSettings.bookingLogic googleCalendar businessHours companyName')
      .lean();

    if (!company) {
      logger.warn(`[${ENGINE_ID}] Company not found, using defaults`, { companyId });
      return { ...DEFAULT_CONFIG, companyName: 'our company', calendarConnected: false };
    }

    const bl = company.aiAgentSettings?.bookingLogic || {};

    return {
      companyName:         company.companyName || 'our company',
      appointmentDuration: bl.appointmentDuration || bl.slotDuration || DEFAULT_CONFIG.appointmentDuration,
      bufferMinutes:       bl.bufferMinutes       ?? DEFAULT_CONFIG.bufferMinutes,
      advanceBookingDays:  bl.advanceBookingDays  || DEFAULT_CONFIG.advanceBookingDays,
      requiredFields:      bl.requiredFields      || DEFAULT_CONFIG.requiredFields,
      confirmationMessage: bl.confirmationMessage || DEFAULT_CONFIG.confirmationMessage,
      calendarConnected:   !!(company.googleCalendar?.accessToken),
      calendarId:          company.googleCalendar?.calendarId || null,
      businessHours:       company.businessHours || null
    };
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Config load failed`, { companyId, error: error.message });
    return { ...DEFAULT_CONFIG, companyName: 'our company', calendarConnected: false };
  }
}

/* ============================================================================
   CONTEXT INITIALIZATION
   ============================================================================ */

function initializeContext(payload, config) {
  return {
    step:        STEPS.INIT,
    bookingMode: payload?.assumptions?.bookingMode || null,
    collectedFields: {
      firstName: payload?.assumptions?.firstName || null,
      lastName:  payload?.assumptions?.lastName  || null,
      phone:     payload?.assumptions?.phone     || null,
      address:   payload?.assumptions?.address   || null
    },
    summary:              payload?.summary    || {},
    callContext:          payload?.callContext || null,
    availableTimeOptions: null,
    selectedTime:         null,
    calendarEventId:      null,
    calendarEventLink:    null,
    completed:            false,
    startedAt:            new Date().toISOString()
  };
}

/* ============================================================================
   STEP ROUTING
   ============================================================================ */

async function processCurrentStep(ctx, userInput, config, companyId, isTest, events) {

  // ── BOOKING TRIGGER CHECK ─────────────────────────────────────────────────
  // Run BEFORE the step logic so that keywords/phrases always take priority.
  // Only fires when caller said something (userInput present) and we are not
  // at INIT or COMPLETED (no utterance to match on those transitions).
  if (userInput?.trim() && ctx.step !== STEPS.INIT && ctx.step !== STEPS.COMPLETED) {
    try {
      const triggerResult = await BookingTriggerMatcher.match(userInput, companyId, ctx.step);

      if (triggerResult.matched) {
        const card = triggerResult.card;
        events.push({
          type:         'BL2_TRIGGER_MATCHED',
          ruleId:       card.ruleId,
          behavior:     triggerResult.behavior,
          matchType:    triggerResult.matchType,
          matchedOn:    triggerResult.matchedOn,
          timestamp:    Date.now()
        });

        const triggerResponse = await buildTriggerResponse(card, userInput, companyId);

        return handleBookingTriggerHit({
          ctx,
          config,
          companyId,
          isTest,
          events,
          triggerResult,
          triggerResponse,
          userInput
        });
      }
    } catch (triggerErr) {
      // Never let trigger failure kill the booking flow
      logger.warn(`[${ENGINE_ID}] BookingTriggerMatcher error — continuing without trigger`, {
        companyId,
        step:  ctx.step,
        error: triggerErr.message
      });
      events.push({ type: 'BL2_TRIGGER_ERROR', error: triggerErr.message, timestamp: Date.now() });
    }
  }
  // ── END TRIGGER CHECK ─────────────────────────────────────────────────────

  switch (ctx.step) {
    case STEPS.INIT:            return processInit(ctx, config, companyId, isTest, events);
    case STEPS.COLLECT_NAME:    return processCollectName(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_PHONE:   return processCollectPhone(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_ADDRESS: return processCollectAddress(ctx, userInput, config, companyId, isTest, events);
    case STEPS.OFFER_TIMES:     return processOfferTimes(ctx, userInput, config, companyId, isTest, events);
    case STEPS.CONFIRM:         return processConfirm(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COMPLETED:
      return {
        nextPrompt: 'Your booking is all set. Is there anything else I can help you with?',
        bookingCtx: ctx,
        completed:  true
      };
    default:
      return processInit(ctx, config, companyId, isTest, events);
  }
}

/* ============================================================================
   STEP: INIT
   ============================================================================ */

async function processInit(ctx, config, companyId, isTest, events) {
  events.push({ type: 'BL1_INIT', timestamp: Date.now() });

  const issuePrefix = buildIssuePrefix(ctx.callContext);

  if (!ctx.collectedFields.firstName) {
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_COLLECTING_NAME', timestamp: Date.now() });
    return {
      nextPrompt: `${issuePrefix}To get started with your booking, may I have your name please?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    events.push({ type: 'BL1_COLLECTING_PHONE', timestamp: Date.now() });
    const nameGreet = ctx.collectedFields.firstName ? `${ctx.collectedFields.firstName}, ` : '';
    return {
      nextPrompt: `${issuePrefix}${nameGreet}what's the best phone number to reach you at?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    events.push({ type: 'BL1_COLLECTING_ADDRESS', timestamp: Date.now() });
    return {
      nextPrompt: "And what's the service address?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  // All required fields present — proceed to offer real time options
  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: COLLECT NAME
   ============================================================================ */

async function processCollectName(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput?.trim()) {
    return {
      nextPrompt: "I didn't catch that. Could you please tell me your name?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  const { firstName, lastName } = parseName(userInput);
  ctx.collectedFields.firstName = firstName;
  ctx.collectedFields.lastName  = lastName;

  events.push({ type: 'BL1_NAME_COLLECTED', firstName, timestamp: Date.now() });

  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    return {
      nextPrompt: `Thanks, ${firstName}! What's the best phone number to reach you at?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return {
      nextPrompt: "And what's the service address?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: COLLECT PHONE
   ============================================================================ */

async function processCollectPhone(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput?.trim()) {
    return {
      nextPrompt: "I didn't catch that. What phone number should we use to contact you?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.collectedFields.phone = normalizePhone(userInput);
  events.push({ type: 'BL1_PHONE_COLLECTED', timestamp: Date.now() });

  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return {
      nextPrompt: "Got it. And what's the service address?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: COLLECT ADDRESS
   ============================================================================ */

async function processCollectAddress(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput?.trim()) {
    return {
      nextPrompt: "I didn't catch the address. What's the service address?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.collectedFields.address = userInput.trim();
  events.push({ type: 'BL1_ADDRESS_COLLECTED', timestamp: Date.now() });

  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: OFFER TIMES
   ============================================================================ */

async function processOfferTimes(ctx, userInput, config, companyId, isTest, events) {
  // No user input yet — fetch real calendar availability and present options
  if (!userInput) {
    const { timeOptions, message } = await fetchAvailableTimeOptions(config, companyId, ctx, isTest, events);
    ctx.availableTimeOptions = timeOptions;
    return {
      nextPrompt: message,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // Caller is selecting a time — match against stored options
  if (!ctx.availableTimeOptions?.length) {
    // Edge case: context was lost — re-fetch
    const { timeOptions, message } = await fetchAvailableTimeOptions(config, companyId, ctx, isTest, events);
    ctx.availableTimeOptions = timeOptions;
    return {
      nextPrompt: message,
      bookingCtx: ctx,
      completed:  false
    };
  }

  const selected = matchTimeFromInput(userInput, ctx.availableTimeOptions);

  if (!selected) {
    const formatted = formatTimeOptionsList(ctx.availableTimeOptions);
    return {
      nextPrompt: `I didn't catch which time you'd prefer. I have ${formatted} — which works best?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.selectedTime = selected;
  ctx.step         = STEPS.CONFIRM;
  events.push({ type: 'BL1_TIME_SELECTED', display: selected.display, timestamp: Date.now() });

  return {
    nextPrompt: `Great — I have you down for ${selected.display}. Should I go ahead and book that?`,
    bookingCtx: ctx,
    completed:  false
  };
}

/* ============================================================================
   STEP: CONFIRM
   ============================================================================ */

async function processConfirm(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput?.trim()) {
    return {
      nextPrompt: `Just to confirm — shall I book you for ${ctx.selectedTime?.display}?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  const input = userInput.toLowerCase().trim();

  // Positive confirmation
  if (/\b(yes|yeah|yep|sure|ok|okay|please|go ahead|book it|do it|sounds good|perfect|great|absolutely)\b/.test(input)) {
    events.push({ type: 'BL1_BOOKING_CONFIRMED', timestamp: Date.now() });

    // Create calendar event for production calls when calendar is connected
    if (!isTest && config.calendarConnected && ctx.selectedTime?.start) {
      const eventResult = await createCalendarEvent(companyId, ctx, events);
      if (eventResult.success) {
        ctx.calendarEventId   = eventResult.eventId;
        ctx.calendarEventLink = eventResult.eventLink;
        events.push({ type: 'BL1_CALENDAR_EVENT_CREATED', eventId: eventResult.eventId, timestamp: Date.now() });
      } else {
        // Calendar write failed — booking is still verbally confirmed; log for ops follow-up
        logger.warn(`[${ENGINE_ID}] Calendar event creation failed — booking verbally confirmed`, {
          companyId,
          error: eventResult.error
        });
        events.push({ type: 'BL1_CALENDAR_EVENT_FAILED', error: eventResult.error, timestamp: Date.now() });
      }
    }

    ctx.step      = STEPS.COMPLETED;
    ctx.completed = true;

    const confirmMsg = config.confirmationMessage
      .replace('{date}', ctx.selectedTime?.display?.split(' at ')[0] || 'the scheduled date')
      .replace('{time}', ctx.selectedTime?.display?.split(' at ')[1] || 'the scheduled time');

    events.push({ type: 'BL1_COMPLETED', timestamp: Date.now() });

    return {
      nextPrompt:      confirmMsg,
      bookingCtx:      ctx,
      completed:       true,
      calendarEventId: ctx.calendarEventId || null
    };
  }

  // Caller wants a different time
  if (/\b(no|nope|different|change|other|another)\b/.test(input)) {
    ctx.step                 = STEPS.OFFER_TIMES;
    ctx.availableTimeOptions = null; // Force fresh calendar fetch
    events.push({ type: 'BL1_TIME_CHANGE_REQUESTED', timestamp: Date.now() });

    const { timeOptions, message } = await fetchAvailableTimeOptions(config, companyId, ctx, isTest, events);
    ctx.availableTimeOptions = timeOptions;

    return {
      nextPrompt: `No problem! ${message}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // Ambiguous — re-ask
  return {
    nextPrompt: `I want to make sure I have this right — shall I book you for ${ctx.selectedTime?.display}?`,
    bookingCtx: ctx,
    completed:  false
  };
}

/* ============================================================================
   BOOKING TRIGGER EXECUTION
   ============================================================================
   Called from processCurrentStep() when BookingTriggerMatcher finds a hit.
   Three behaviors:
     INFO     — play trigger response, hold the current step (booking resumes next turn)
     BLOCK    — play trigger response, freeze step (booking cannot advance until intent changes)
     REDIRECT — play trigger response, switch bookingMode to redirectMode, clear cached slots,
                re-run OFFER_TIMES so the agent fetches availability for the new service type
   ============================================================================ */

/**
 * Build the text response for a matched booking trigger.
 * Standard mode: use answerText directly.
 * LLM mode: fall back to backupAnswer (live LLM not called here — that's the
 *           TriggerLLMResponseService layer; booking triggers just use the backup
 *           until that pipeline is wired into the booking lane).
 *
 * @param {Object} card - TriggerCardMatcher-compatible card from BookingTriggerMatcher
 * @returns {string}
 */
async function buildTriggerResponse(card) {
  const answer = card.answer?.answerText?.trim();
  if (answer) return answer;

  // LLM mode fallback
  const backup = card.llmFactPack?.backupAnswer?.trim();
  if (backup) return backup;

  return "I'm sorry, I didn't quite catch what you need. Could you rephrase that?";
}

/**
 * Execute a matched booking trigger based on its behavior.
 *
 * @param {Object} params
 * @param {Object} params.ctx             - Current booking context (mutated in place for REDIRECT)
 * @param {Object} params.config          - Company booking config
 * @param {string} params.companyId
 * @param {boolean} params.isTest
 * @param {Array}  params.events
 * @param {Object} params.triggerResult   - Result from BookingTriggerMatcher.match()
 * @param {string} params.triggerResponse - Pre-built response text
 * @param {string} params.userInput
 * @returns {Promise<Object>}             - Standard processStep return shape
 */
async function handleBookingTriggerHit({ ctx, config, companyId, isTest, events, triggerResult, triggerResponse }) {
  const { behavior, redirectMode, card } = triggerResult;

  // Append the optional follow-up question to the response text
  const followUp   = card.followUp?.question?.trim();
  const fullText   = followUp ? `${triggerResponse} ${followUp}` : triggerResponse;

  // 123RP provenance — CallerVia call-review console will show BOOKING_TRIGGER_MATCHED
  ctx.lastTriggerRuleId = card.ruleId;
  ctx.lastTriggerBehavior = behavior;
  ctx.lastPath = 'BOOKING_TRIGGER_MATCHED';

  switch (behavior) {

    // ── INFO: play response, hold step, resume normally next turn ────────────
    case 'INFO': {
      logger.info(`[${ENGINE_ID}] Booking trigger INFO — holding step`, {
        companyId, step: ctx.step, ruleId: card.ruleId
      });
      events.push({ type: 'BL2_TRIGGER_INFO', ruleId: card.ruleId, step: ctx.step, timestamp: Date.now() });

      return {
        nextPrompt: fullText,
        bookingCtx: ctx,
        completed:  false,
        _triggerHit: { ruleId: card.ruleId, behavior: 'INFO' }
      };
    }

    // ── BLOCK: play response, freeze step — booking cannot advance ──────────
    case 'BLOCK': {
      logger.info(`[${ENGINE_ID}] Booking trigger BLOCK — step frozen`, {
        companyId, step: ctx.step, ruleId: card.ruleId
      });
      events.push({ type: 'BL2_TRIGGER_BLOCK', ruleId: card.ruleId, step: ctx.step, timestamp: Date.now() });

      ctx.blocked = true;

      return {
        nextPrompt: fullText,
        bookingCtx: ctx,
        completed:  false,
        _triggerHit: { ruleId: card.ruleId, behavior: 'BLOCK' }
      };
    }

    // ── REDIRECT: switch service type, clear slots, re-run OFFER_TIMES ──────
    case 'REDIRECT': {
      logger.info(`[${ENGINE_ID}] Booking trigger REDIRECT — switching bookingMode`, {
        companyId, step: ctx.step, ruleId: card.ruleId,
        oldMode: ctx.bookingMode, newMode: redirectMode
      });
      events.push({
        type: 'BL2_TRIGGER_REDIRECT', ruleId: card.ruleId,
        oldMode: ctx.bookingMode, newMode: redirectMode, timestamp: Date.now()
      });

      ctx.bookingMode          = redirectMode;
      ctx.availableTimeOptions = null;  // Force fresh calendar fetch with new service type
      ctx.selectedTime         = null;
      ctx.blocked              = false;
      ctx.step                 = STEPS.OFFER_TIMES;

      // Fetch availability for new service type immediately
      const { timeOptions, message: timesMsg } = await fetchAvailableTimeOptions(config, companyId, ctx, isTest, events);
      ctx.availableTimeOptions = timeOptions;

      // Play trigger response first, then present the new time options
      const combinedPrompt = `${fullText} ${timesMsg}`;

      return {
        nextPrompt: combinedPrompt,
        bookingCtx: ctx,
        completed:  false,
        _triggerHit: { ruleId: card.ruleId, behavior: 'REDIRECT', newMode: redirectMode }
      };
    }

    // ── Unknown behavior — safe fallback to INFO ────────────────────────────
    default: {
      logger.warn(`[${ENGINE_ID}] Unknown booking trigger behavior "${behavior}" — treating as INFO`, {
        companyId, ruleId: card.ruleId
      });
      return {
        nextPrompt: fullText,
        bookingCtx: ctx,
        completed:  false,
        _triggerHit: { ruleId: card.ruleId, behavior }
      };
    }
  }
}

/* ============================================================================
   CALENDAR INTEGRATION
   ============================================================================ */

/**
 * Fetch available time options from Google Calendar for this company.
 * Gracefully falls back to preference-capture mode if the calendar is
 * disconnected, in test mode, or unavailable.
 *
 * @returns {Promise<{timeOptions: Array, message: string}>}
 */
async function fetchAvailableTimeOptions(config, companyId, ctx, isTest, events) {
  if (isTest || !config.calendarConnected) {
    const reason = isTest ? 'test_mode' : 'calendar_disconnected';
    events.push({ type: 'BL1_TIMES_PREFERENCE_CAPTURE', reason, timestamp: Date.now() });
    return {
      timeOptions: [],
      message: "What time of day works best for you — morning, afternoon, or evening? We'll confirm the exact appointment time shortly."
    };
  }

  try {
    const serviceType = ctx.summary?.serviceType || ctx.bookingMode || 'service';

    const result = await GoogleCalendarService.findAvailableSlots(companyId, {
      durationMinutes: config.appointmentDuration,
      maxSlots:        3,
      serviceType
    });

    if (result.fallback || !result.slots?.length) {
      events.push({ type: 'BL1_CALENDAR_NO_SLOTS', fallback: !!result.fallback, timestamp: Date.now() });
      return {
        timeOptions: [],
        message: "I'm not seeing any open times in the next few days. Would you like me to have someone call you back to find a time that works?"
      };
    }

    events.push({ type: 'BL1_TIMES_FETCHED', count: result.slots.length, timestamp: Date.now() });

    // Normalize to internal timeOption shape
    const timeOptions = result.slots.map(slot => ({
      start:   slot.start,   // Date object — used for event creation
      end:     slot.end,     // Date object — used for event creation
      display: slot.display  // Human-readable: "tomorrow at 10 AM"
    }));

    return { timeOptions, message: result.message };

  } catch (error) {
    logger.error(`[${ENGINE_ID}] Calendar availability fetch failed`, { companyId, error: error.message });
    events.push({ type: 'BL1_CALENDAR_FETCH_ERROR', error: error.message, timestamp: Date.now() });
    return {
      timeOptions: [],
      message: "I'm having trouble pulling up the calendar right now. What time of day generally works best for you?"
    };
  }
}

/**
 * Write a confirmed appointment to Google Calendar.
 *
 * @returns {Promise<{success: boolean, eventId?: string, eventLink?: string, error?: string}>}
 */
async function createCalendarEvent(companyId, ctx, events) {
  const { firstName, lastName, phone, address } = ctx.collectedFields;
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'Customer';
  const serviceType  = ctx.summary?.serviceType || ctx.bookingMode || 'service';

  try {
    return await GoogleCalendarService.createBookingEvent(companyId, {
      customerName,
      customerPhone:   phone   || null,
      customerAddress: address || null,
      serviceType,
      serviceNotes:    ctx.summary?.issue || null,
      startTime:       ctx.selectedTime.start,
      endTime:         ctx.selectedTime.end
    });
  } catch (error) {
    logger.error(`[${ENGINE_ID}] createBookingEvent threw unexpectedly`, { companyId, error: error.message });
    return { success: false, error: error.message, fallback: true };
  }
}

/* ============================================================================
   HELPERS
   ============================================================================ */

/**
 * Build a contextual opening from the discovery call context.
 * Example output: "I've got this noted as an AC not cooling issue. "
 */
function buildIssuePrefix(callContext) {
  if (!callContext?.issue?.summary) return '';
  const urgencyNote = callContext.urgency?.level === 'high'
    ? " I'll prioritize getting someone out quickly."
    : '';
  return `I've got this noted as a ${callContext.issue.summary}.${urgencyNote} `;
}

/**
 * Parse a raw name string into first and last components.
 */
function parseName(input) {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: 'there', lastName: null };
  const firstName = capitalizeFirst(words[0]);
  const lastName  = words.length > 1 ? words.slice(1).map(capitalizeFirst).join(' ') : null;
  return { firstName, lastName };
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Normalize a phone number string to (XXX) XXX-XXXX format when possible.
 */
function normalizePhone(input) {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return input.trim();
}

/**
 * Match a caller's spoken selection against stored time options.
 * Tries positional words, hour digits, day names, and AM/PM preference.
 */
function matchTimeFromInput(input, timeOptions) {
  if (!timeOptions?.length) return null;

  const n = input.toLowerCase();

  // Positional references
  if (/\b(first|1st)\b/.test(n))                  return timeOptions[0];
  if (/\b(second|2nd)\b/.test(n))                 return timeOptions[1] || null;
  if (/\b(third|3rd|last)\b/.test(n))             return timeOptions[timeOptions.length - 1];

  // Affirmative on a single option
  if (timeOptions.length === 1 &&
      /\b(yes|sure|ok|okay|that works|sounds good)\b/.test(n)) {
    return timeOptions[0];
  }

  // Match by display string content
  for (const opt of timeOptions) {
    const display = opt.display.toLowerCase();

    // Hour digit match ("10", "2", "9", etc.)
    const hourMatch = display.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (hourMatch && new RegExp(`\\b${hourMatch[1]}\\b`).test(n)) return opt;

    // Day name match ("tomorrow", "monday", "tuesday", etc.)
    const dayWords = display.split(' at ')[0]; // "tomorrow" or "Monday"
    if (dayWords && n.includes(dayWords)) return opt;

    // Time-of-day preference
    if (/\b(morning|am)\b/.test(n)    && /am/i.test(display))  return opt;
    if (/\b(afternoon|pm)\b/.test(n)  && /pm/i.test(display)) {
      const pmHour = parseInt((display.match(/(\d+)\s*pm/i) || [])[1] || '0', 10);
      if (pmHour >= 1 && pmHour <= 6) return opt;
    }
  }

  return null;
}

/**
 * Format a list of time options for spoken output.
 * Example: "tomorrow at 10 AM, Thursday at 2 PM, or Friday at 9 AM"
 */
function formatTimeOptionsList(timeOptions) {
  if (!timeOptions?.length) return 'no available times';
  if (timeOptions.length === 1) return timeOptions[0].display;
  if (timeOptions.length === 2) return `${timeOptions[0].display} or ${timeOptions[1].display}`;
  const last = timeOptions[timeOptions.length - 1].display;
  const rest = timeOptions.slice(0, -1).map(t => t.display).join(', ');
  return `${rest}, or ${last}`;
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  processStep,
  computeStep: processStep, // Alias — retained for any callers using the old name
  STEPS,
  VERSION,
  ENGINE_ID
};

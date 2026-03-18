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
const GlobalHubService     = require('../../GlobalHubService');

const ENGINE_ID = 'BOOKING_LOGIC_ENGINE';
const VERSION   = 'BL2.0';

/* ============================================================================
   BOOKING FLOW STEPS
   ============================================================================ */

const STEPS = {
  INIT:                 'INIT',
  COLLECT_NAME:         'COLLECT_NAME',
  COLLECT_PHONE:        'COLLECT_PHONE',
  COLLECT_ADDRESS:      'COLLECT_ADDRESS',
  COLLECT_CUSTOM:       'COLLECT_CUSTOM',       // iterates bookingConfig.customFields[]
  COLLECT_ALT_CONTACT:  'COLLECT_ALT_CONTACT',  // optional alt contact collection
  OFFER_TIMES:          'OFFER_TIMES',
  CONFIRM:              'CONFIRM',
  COMPLETED:            'COMPLETED'
};

/* ============================================================================
   DEFAULTS  (used only when company config fields are absent)
   ============================================================================ */

const DEFAULT_CONFIG = {
  appointmentDuration:   60,
  bufferMinutes:         0,
  advanceBookingDays:    14,
  requiredFields:        ['firstName', 'phone'],
  confirmationMessage:   'Your appointment is confirmed for {date} at {time}. We look forward to seeing you!',
  customFields:          [],
  altContact:            { enabled: false },
  confirmation:          { enabled: true },
  slotFilling:           { defaultMaxAttempts: 3, defaultFallbackAction: 'RE_ASK_PLAIN', reAnchorSuffix: 'Now, to get your appointment confirmed \u2014' }
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
      .select('aiAgentSettings.bookingLogic aiAgentSettings.agent2.bookingConfig aiAgentSettings.agent2.bookingPrompts aiAgentSettings.agent2.bridge.bookingBridgePhrase aiAgentSettings.agent2.discovery.holdMessage googleCalendar businessHours companyName')
      .lean();

    if (!company) {
      logger.warn(`[${ENGINE_ID}] Company not found, using defaults`, { companyId });
      return { ...DEFAULT_CONFIG, companyName: 'our company', calendarConnected: false };
    }

    const bl       = company.aiAgentSettings?.bookingLogic          || {};
    const bc       = company.aiAgentSettings?.agent2?.bookingConfig  || {};
    const bp       = company.aiAgentSettings?.agent2?.bookingPrompts || {};  // legacy fallback
    const discovery = company.aiAgentSettings?.agent2?.discovery     || {};

    return {
      companyName:         company.companyName || 'our company',

      // Calendar settings — bookingConfig.calendar is authoritative; bookingLogic is legacy fallback
      appointmentDuration: bc.calendar?.appointmentDuration  ?? bl.appointmentDuration ?? bl.slotDuration ?? DEFAULT_CONFIG.appointmentDuration,
      bufferMinutes:       bc.calendar?.bufferMinutes        ?? bl.bufferMinutes        ?? DEFAULT_CONFIG.bufferMinutes,
      advanceBookingDays:  bc.calendar?.advanceBookingDays   ?? bl.advanceBookingDays   ?? DEFAULT_CONFIG.advanceBookingDays,
      confirmationMessage: bc.calendar?.confirmationMessage  ||  bl.confirmationMessage  || DEFAULT_CONFIG.confirmationMessage,
      holdMessage:         bc.calendar?.holdMessage          ||  discovery.holdMessage   || '',
      offerTimesPrompt:    bc.calendar?.offerTimesPrompt     || '',
      noTimesPrompt:       bc.calendar?.noTimesPrompt        || '',

      // Built-in field prompts (bookingConfig is authoritative; legacy bookingPrompts fills gaps)
      askNamePrompt:    bc.builtinPrompts?.askName        || bp.askName    || null,
      nameReAnchor:     bc.builtinPrompts?.nameReAnchor   || null,
      askPhonePrompt:   bc.builtinPrompts?.askPhone       || bp.askPhone   || null,
      phoneReAnchor:    bc.builtinPrompts?.phoneReAnchor  || null,
      askAddressPrompt: bc.builtinPrompts?.askAddress     || bp.askAddress || null,
      addressReAnchor:  bc.builtinPrompts?.addressReAnchor || null,

      // Custom fields (new — from bookingConfig)
      customFields:     bc.customFields    || DEFAULT_CONFIG.customFields,

      // Alt contact (new)
      altContact:       bc.altContact      || DEFAULT_CONFIG.altContact,

      // Confirmation step (new)
      confirmation:     bc.confirmation    || DEFAULT_CONFIG.confirmation,

      // Slot filling / digression (new)
      slotFilling:      bc.slotFilling     || DEFAULT_CONFIG.slotFilling,

      // Caller recognition (new)
      callerRecognition: bc.callerRecognition || { enabled: false },

      // Calendar connection
      calendarConnected: !!(company.googleCalendar?.accessToken),
      calendarId:        company.googleCalendar?.calendarId || null,
      businessHours:     company.businessHours || null,

      // Legacy
      requiredFields:    bl.requiredFields || DEFAULT_CONFIG.requiredFields
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
  // discoveryNotes carry everything the LLM learned during intake/discovery —
  // entities (name, phone, technician preference), urgency, callReason, etc.
  const dn         = payload?.discoveryNotes || null;
  const dnEntities = dn?.entities            || {};

  return {
    step:        STEPS.INIT,
    bookingMode: payload?.assumptions?.bookingMode || null,
    collectedFields: {
      // ScrabEngine assumptions take priority; discoveryNotes entities are fallback.
      // This prevents re-asking for information the LLM already captured on turn 1.
      firstName:      payload?.assumptions?.firstName || dnEntities.firstName || null,
      lastName:       payload?.assumptions?.lastName  || dnEntities.lastName  || null,
      phone:          payload?.assumptions?.phone     || dnEntities.phone     || null,
      address:        payload?.assumptions?.address   || dnEntities.address   || null,
      // Additional contact number (e.g. "call tech on the way", "notify neighbor", "son's number")
      altPhone:       null,
      altPhoneContext: null
    },
    summary:              payload?.summary    || {},
    callContext:          payload?.callContext || null,
    // Twilio caller ID phone — used to offer confirmation instead of asking cold
    callerPhone:          payload?.assumptions?.callerPhone || null,
    // Employee/technician the caller mentioned by name (e.g. "Tony") — surfaced in
    // the booking opener and written to the calendar event notes.
    technicianPreference: dnEntities.employeeMentioned || null,
    // Full discoveryNotes object kept for downstream use (e.g. urgency surfacing)
    discoveryNotes:       dn,
    availableTimeOptions: null,
    selectedTime:         null,
    calendarEventId:      null,
    calendarEventLink:    null,
    completed:            false,
    startedAt:            new Date().toISOString(),
    // Custom fields slot-filling state
    customFieldIndex:     0,        // which customFields[] entry we're currently collecting
    collectedCustomFields: {},      // { fieldKey: value }
    // Alt contact state
    altContacts:          [],       // [{ name, phone, notes }]
    altContactStep:       null,     // null | 'OFFER' | 'ASK_NAME' | 'ASK_PHONE' | 'ASK_NOTES' | 'ASK_MORE'
    currentAltContact:    null      // partial contact being built
  };
}

/* ============================================================================
   STEP ROUTING
   ============================================================================ */

async function processCurrentStep(ctx, userInput, config, companyId, isTest, events) {

  // ── BOOKING TRIGGER CHECK ─────────────────────────────────────────────────
  // Run BEFORE the step logic so that keywords/phrases always take priority.
  //
  // DATA-ENTRY STEPS ARE EXCLUDED — the caller is providing a value (phone
  // digits, address), not expressing intent. Keyword matching against phone
  // numbers or addresses produces dangerous false-positives (e.g. the word
  // "Other" in "Other 239-565-2202" matching a "second opinion" trigger card).
  //
  // Triggers fire on intent steps: COLLECT_NAME, COLLECT_CUSTOM, COLLECT_ALT_CONTACT, OFFER_TIMES, CONFIRM.
  // Triggers are SUPPRESSED on: INIT, COMPLETED, COLLECT_PHONE, COLLECT_ADDRESS.
  const DATA_ENTRY_STEPS = new Set([STEPS.INIT, STEPS.COMPLETED, STEPS.COLLECT_PHONE, STEPS.COLLECT_ADDRESS]);
  if (userInput?.trim() && !DATA_ENTRY_STEPS.has(ctx.step)) {
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
    case STEPS.INIT:                return processInit(ctx, config, companyId, isTest, events);
    case STEPS.COLLECT_NAME:        return processCollectName(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_PHONE:       return processCollectPhone(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_ADDRESS:     return processCollectAddress(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_CUSTOM:      return processCollectCustom(ctx, userInput, config, companyId, events);
    case STEPS.COLLECT_ALT_CONTACT: return processCollectAltContact(ctx, userInput, config, events);
    case STEPS.OFFER_TIMES:         return processOfferTimes(ctx, userInput, config, companyId, isTest, events);
    case STEPS.CONFIRM:             return processConfirm(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COMPLETED:
      return {
        nextPrompt: 'Your booking is all set. Is there anything else I can help you with?',
        bookingCtx: ctx,
        completed:  true
      };
    default:
      logger.warn(`[${ENGINE_ID}] Unknown step: ${ctx.step}`, { companyId });
      return {
        nextPrompt: "I'm sorry, something went wrong with the booking flow. Let me start over.",
        bookingCtx: { ...ctx, step: STEPS.INIT },
        completed:  false
      };
  }
}

/* ============================================================================
   STEP: INIT
   ============================================================================ */

async function processInit(ctx, config, companyId, isTest, events) {
  events.push({ type: 'BL1_INIT', timestamp: Date.now() });

  const issuePrefix = buildWarmOpening(ctx);

  if (!ctx.collectedFields.firstName) {
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_COLLECTING_NAME', timestamp: Date.now() });
    return {
      nextPrompt: `${issuePrefix}To get started with your booking, may I have your name please?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // firstName pre-filled (from LLM entities) but no lastName — confirm and ask for last name
  if (!ctx.collectedFields.lastName) {
    ctx.step = STEPS.COLLECT_NAME;
    ctx._nameSubStep = 'CONFIRM_GET_LAST';
    const preFilledFirst = ctx.collectedFields.firstName;
    events.push({ type: 'BL1_CONFIRMING_PREFILLED_NAME', firstName: preFilledFirst, timestamp: Date.now() });
    return {
      nextPrompt: `${issuePrefix}I have your first name as ${preFilledFirst} — may I also get your last name?`,
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

  // All required fields present — route through custom fields if any
  const customFields = config.customFields || [];
  if (customFields.length > 0) {
    const firstField = customFields[0];
    ctx.step = STEPS.COLLECT_CUSTOM;
    ctx.customFieldIndex = 0;
    return {
      nextPrompt: firstField.prompt || `One more question — what is your ${firstField.label}?`,
      bookingCtx: ctx,
      completed:  false
    };
  }
  return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
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

  // ── Sub-step: accepting a spelled first name (skip dictionary, accept verbatim) ──
  if (ctx._nameSubStep === 'SPELL_FIRST') {
    const cleaned = userInput.trim().replace(/[^a-zA-Z'\- ]/g, '').trim();
    const spelled = capitalizeFirst(cleaned) || 'there';
    ctx.collectedFields.firstName = spelled;
    delete ctx._nameSubStep;
    events.push({ type: 'BL1_NAME_SPELLED', firstName: spelled, timestamp: Date.now() });
    // Now ask for last name
    ctx._nameSubStep = 'GET_LAST';
    return {
      nextPrompt: `Got it — and your last name?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Sub-step: accepting a spelled last name ───────────────────────────────
  if (ctx._nameSubStep === 'SPELL_LAST') {
    const cleaned = userInput.trim().replace(/[^a-zA-Z'\- ]/g, '').trim();
    ctx.collectedFields.lastName = capitalizeFirst(cleaned) || null;
    delete ctx._nameSubStep;
    events.push({ type: 'BL1_LAST_NAME_SPELLED', lastName: ctx.collectedFields.lastName, timestamp: Date.now() });
    return advanceAfterName(ctx, config, companyId, isTest, events);
  }

  // ── Sub-step: collecting last name (firstName already set) ───────────────
  if (ctx._nameSubStep === 'GET_LAST' || ctx._nameSubStep === 'CONFIRM_GET_LAST') {
    const isConfirmMode = ctx._nameSubStep === 'CONFIRM_GET_LAST';

    // Caller is correcting the pre-filled first name
    if (isConfirmMode && /^(no|nope|actually|wait|hold on|that'?s? (not|wrong)|not quite|incorrect)\b/i.test(userInput.trim())) {
      delete ctx._nameSubStep;
      ctx.collectedFields.firstName = null;
      ctx.collectedFields.lastName  = null;
      return {
        nextPrompt: "No problem — what's your full name?",
        bookingCtx: ctx,
        completed:  false
      };
    }

    // Parse input as a last name
    const rawLast = parseLastName(userInput);
    if (rawLast) {
      let resolvedLast = rawLast;
      try {
        const lastMatch = await GlobalHubService.matchLastName(rawLast);
        if (lastMatch.match) {
          resolvedLast = lastMatch.value; // use canonical casing
        } else {
          // Unknown last name — ask to spell
          ctx._nameSubStep = 'SPELL_LAST';
          events.push({ type: 'BL1_LAST_NAME_UNKNOWN', raw: rawLast, timestamp: Date.now() });
          return {
            nextPrompt: `Could you spell your last name for me?`,
            bookingCtx: ctx,
            completed:  false
          };
        }
      } catch (_ghErr) {
        resolvedLast = rawLast; // GlobalHub unavailable → accept as-is
      }
      ctx.collectedFields.lastName = resolvedLast;
      events.push({ type: 'BL1_LAST_NAME_COLLECTED', lastName: resolvedLast, timestamp: Date.now() });
    }

    delete ctx._nameSubStep;
    return advanceAfterName(ctx, config, companyId, isTest, events);
  }

  // ── Normal case: parse full name from utterance ───────────────────────────
  const { firstName, lastName } = parseName(userInput);

  // Verify first name against GlobalHub dictionary
  let resolvedFirst = firstName;
  try {
    const firstMatch = await GlobalHubService.matchFirstName(firstName);
    if (!firstMatch.match && firstMatch.verificationMode === 'unknown') {
      // Not in dictionary — ask caller to spell it
      ctx._nameSubStep = 'SPELL_FIRST';
      events.push({ type: 'BL1_FIRST_NAME_UNKNOWN', raw: firstName, timestamp: Date.now() });
      return {
        nextPrompt: `I want to make sure I get that right — could you spell your first name for me?`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    if (firstMatch.match) resolvedFirst = firstMatch.value; // accept canonical casing / auto-correction
  } catch (_ghErr) {
    // GlobalHub unavailable → proceed with parsed name
  }

  ctx.collectedFields.firstName = resolvedFirst;
  events.push({ type: 'BL1_NAME_COLLECTED', firstName: resolvedFirst, timestamp: Date.now() });

  if (lastName) {
    // Verify last name against GlobalHub dictionary
    let resolvedLast = lastName;
    try {
      const lastMatch = await GlobalHubService.matchLastName(lastName);
      if (!lastMatch.match && lastMatch.verificationMode === 'unknown') {
        // Not in dictionary — save firstName, ask to spell last name
        ctx._nameSubStep = 'SPELL_LAST';
        events.push({ type: 'BL1_LAST_NAME_UNKNOWN', raw: lastName, timestamp: Date.now() });
        return {
          nextPrompt: `Got it — could you spell your last name for me?`,
          bookingCtx: ctx,
          completed:  false
        };
      }
      if (lastMatch.match) resolvedLast = lastMatch.value;
    } catch (_ghErr) {
      // GlobalHub unavailable → accept as parsed
    }
    ctx.collectedFields.lastName = resolvedLast;
    events.push({ type: 'BL1_LAST_NAME_COLLECTED', lastName: resolvedLast, timestamp: Date.now() });
    return advanceAfterName(ctx, config, companyId, isTest, events);
  }

  // Got first name only — ask for last name
  ctx._nameSubStep = 'GET_LAST';
  return {
    nextPrompt: `Thanks, ${resolvedFirst}! And your last name?`,
    bookingCtx: ctx,
    completed:  false
  };
}

/** Shared transition logic after name is fully collected. */
async function advanceAfterName(ctx, config, companyId, isTest, events) {
  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    return {
      nextPrompt: `Got it, ${ctx.collectedFields.firstName}! What's the best phone number to reach you at?`,
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
  // Route through custom fields if any
  const customFields = config.customFields || [];
  if (customFields.length > 0) {
    const firstField = customFields[0];
    ctx.step = STEPS.COLLECT_CUSTOM;
    ctx.customFieldIndex = 0;
    return {
      nextPrompt: firstField.prompt || `One more question — what is your ${firstField.label}?`,
      bookingCtx: ctx,
      completed:  false
    };
  }
  return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: COLLECT PHONE
   ============================================================================ */

async function processCollectPhone(ctx, userInput, config, companyId, isTest, events) {

  // ── Sub-step: collecting an additional contact number ─────────────────────
  // Triggered when caller said something like "yes, but have tech call me at another number"
  // and we need to get that specific alt number.
  if (ctx._collectingAltPhone) {
    ctx._collectingAltPhone = false;
    const altRaw = extractPhoneFromText(userInput);
    const altNorm = altRaw ? normalizePhone(altRaw) : null;

    if (altNorm) {
      const context = ctx._pendingAltPhoneContext || null;
      delete ctx._pendingAltPhoneContext;
      ctx.collectedFields.altPhone        = altNorm;
      ctx.collectedFields.altPhoneContext = context;
      events.push({ type: 'BL1_ALT_PHONE_COLLECTED', altPhone: altNorm, context, timestamp: Date.now() });
      const ctxLabel = context ? ` for ${context}` : '';
      // Acknowledge alt phone then continue to next field
      const advance = await advanceAfterPhone(ctx, config, companyId, isTest, events);
      advance.nextPrompt = `Got it — I've noted ${altNorm}${ctxLabel}. ` + advance.nextPrompt;
      return advance;
    }

    // Couldn't parse a number — re-ask once
    ctx._collectingAltPhone = true;
    return {
      nextPrompt: "I didn't catch that number — could you repeat it?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Caller ID confirmation — waiting for caller's yes/no ──────────────────
  if (ctx._confirmingCallerId) {
    ctx._confirmingCallerId = false;

    const isYes = isAffirmativeResponse(userInput);
    const isNo  = /^(no|nope|not really|not that one|actually|different)\b/i.test(userInput.trim());

    // Check if caller mentioned an additional contact number in the same utterance
    const altRaw     = extractPhoneFromText(userInput);
    const altNorm    = altRaw ? normalizePhone(altRaw) : null;
    const altIntent  = detectAltPhoneIntent(userInput);
    const altContext = detectAltPhoneContext(userInput);

    // callerPhone is ALWAYS kept in ctx.callerPhone — never discarded
    const confirmedPhone = normalizePhone(ctx.callerPhone);

    if (isYes && confirmedPhone) {
      // ── YES: use caller ID as primary ──────────────────────────────────────
      ctx.collectedFields.phone = confirmedPhone;
      events.push({ type: 'BL1_CALLER_ID_CONFIRMED', phone: confirmedPhone, timestamp: Date.now() });

      if (altNorm) {
        // "Yes, but have the tech call 239-333-5555 when on the way"
        ctx.collectedFields.altPhone        = altNorm;
        ctx.collectedFields.altPhoneContext = altContext;
        events.push({ type: 'BL1_ALT_PHONE_CAPTURED', altPhone: altNorm, context: altContext, timestamp: Date.now() });
        const ctxLabel = altContext ? ` for ${altContext}` : '';
        // Acknowledge alt phone inline, then advance
        const ackPrompt = `Got it — I've noted ${altNorm}${ctxLabel}. `;
        const advance = await advanceAfterPhone(ctx, config, companyId, isTest, events);
        advance.nextPrompt = ackPrompt + advance.nextPrompt;
        return advance;
      }

      if (altIntent) {
        // "Yes, but when the tech is on the way call my son" — no number given yet
        ctx._collectingAltPhone       = true;
        ctx._pendingAltPhoneContext   = altContext;
        const contextPrompt = altContext ? ` for ${altContext}` : '';
        return {
          nextPrompt: `Sure — what's that number${contextPrompt}?`,
          bookingCtx: ctx,
          completed:  false
        };
      }

      return advanceAfterPhone(ctx, config, companyId, isTest, events);
    }

    // ── NO path: caller prefers a different primary number ──────────────────
    // callerPhone stays silently in ctx.callerPhone as backup
    events.push({ type: 'BL1_CALLER_ID_DECLINED', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });

    if (altNorm) {
      // "No, use 239-333-5555 instead"
      ctx.collectedFields.phone = altNorm;
      events.push({ type: 'BL1_PHONE_COLLECTED', phone: altNorm, timestamp: Date.now() });
      return advanceAfterPhone(ctx, config, companyId, isTest, events);
    }

    // No number given — ask for it
    return {
      nextPrompt: "No problem — what number should we use to reach you?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Offer caller ID if available and not yet asked ────────────────────────
  if (!ctx._callerIdAsked && ctx.callerPhone) {
    const formattedCallerId = normalizePhone(ctx.callerPhone);
    if (formattedCallerId) {
      ctx._callerIdAsked      = true;
      ctx._confirmingCallerId = true;
      events.push({ type: 'BL1_CALLER_ID_OFFERED', callerPhone: formattedCallerId, timestamp: Date.now() });
      return {
        nextPrompt: `I see your caller ID is ${formattedCallerId} — is that a good number for text notifications and booking confirmations?`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    ctx._callerIdAsked = true; // unformattable number — skip caller ID offer
  }

  // ── Normal phone input ────────────────────────────────────────────────────
  if (!userInput?.trim()) {
    return {
      nextPrompt: "I didn't catch that. What phone number should we use to contact you?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  const normalizedPhone = normalizePhone(userInput);

  if (!normalizedPhone) {
    if (/\b(last name|surname|full name|my name)\b/i.test(userInput)) {
      ctx.step = STEPS.COLLECT_NAME;
      events.push({ type: 'BL1_NAME_REVISIT', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      return {
        nextPrompt: `You're right — let me grab your full name. What's your first and last name?`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    // ── Smart digression detection (T1.5 → T2) ─────────────────────────────
    // If the input contains fewer than 3 digit characters it is clearly a
    // question or digression — NOT a phone attempt.  Route through:
    //   T1.5 → booking trigger (ANY-step or COLLECT_PHONE-targeted)
    //   T2   → graceful re-anchor (acknowledge + circle back to phone)
    // Fall through to the blind re-ask only when the input actually looks
    // like a phone attempt (>= 3 digits, just garbled/incomplete).
    const phoneDigitCount = (userInput.match(/\d/g) || []).length;
    if (phoneDigitCount < 3) {
      // T1.5 — booking trigger check
      try {
        const triggerResult = await BookingTriggerMatcher.match(userInput, companyId, STEPS.COLLECT_PHONE);
        if (triggerResult.matched) {
          const card = triggerResult.card;
          events.push({
            type:      'BL1_PHONE_T1_5_TRIGGER',
            ruleId:    card.ruleId,
            behavior:  triggerResult.behavior,
            matchType: triggerResult.matchType,
            timestamp: Date.now()
          });
          const triggerResponse = await buildTriggerResponse(card, userInput, companyId);
          return {
            nextPrompt: `${triggerResponse} What phone number should we use to reach you?`,
            bookingCtx: ctx,
            completed:  false
          };
        }
      } catch (tErr) {
        logger.warn(`[${ENGINE_ID}] COLLECT_PHONE T1.5 trigger error — continuing`, {
          companyId, error: tErr.message
        });
      }

      // T2 — no trigger matched; gracefully acknowledge and re-anchor
      events.push({ type: 'BL1_PHONE_T2_DIGRESSION', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      return {
        nextPrompt: "Absolutely — we'll make sure that gets addressed. To continue with the booking, what phone number can we use to reach you?",
        bookingCtx: ctx,
        completed:  false,
        t2Digression: true   // forward-compat: signals LLM layer may embed answer here
      };
    }

    events.push({ type: 'BL1_PHONE_INVALID', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
    return {
      nextPrompt: "I didn't quite catch a phone number there. What number should we use to reach you?",
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.collectedFields.phone = normalizedPhone;
  events.push({ type: 'BL1_PHONE_COLLECTED', phone: normalizedPhone, timestamp: Date.now() });
  return advanceAfterPhone(ctx, config, companyId, isTest, events);
}

/** Shared transition logic after phone is collected. */
async function advanceAfterPhone(ctx, config, companyId, isTest, events) {
  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return {
      nextPrompt: "Got it. And what's the service address?",
      bookingCtx: ctx,
      completed:  false
    };
  }
  // Route through custom fields if any
  const customFields = config.customFields || [];
  if (customFields.length > 0) {
    const firstField = customFields[0];
    ctx.step = STEPS.COLLECT_CUSTOM;
    ctx.customFieldIndex = 0;
    return {
      nextPrompt: firstField.prompt || `One more thing — what is your ${firstField.label}?`,
      bookingCtx: ctx,
      completed:  false
    };
  }
  return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
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

  // Route to COLLECT_CUSTOM if there are custom fields; otherwise continue to alt contact or calendar
  const customFields = config.customFields || [];
  if (customFields.length > 0) {
    const firstField = customFields[0];
    ctx.step = STEPS.COLLECT_CUSTOM;
    ctx.customFieldIndex = 0;
    return {
      nextPrompt: firstField.prompt || `One more question — what is your ${firstField.label}?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // No custom fields — go to alt contact or calendar
  return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
}

/* ============================================================================
   HELPER: advanceAfterCustomFields
   Called after all custom fields are done (or if there are none).
   Routes to alt contact if enabled, else OFFER_TIMES.
   ============================================================================ */

async function advanceAfterCustomFields(ctx, config, companyId, isTest, events) {
  if (config.altContact?.enabled) {
    const offerPrompt = config.altContact.offerPrompt ||
      'Is this the best number to reach you, or do you have an alternate contact we should have on file?';
    return {
      nextPrompt: offerPrompt,
      bookingCtx: { ...ctx, step: STEPS.COLLECT_ALT_CONTACT, altContactStep: 'OFFER' },
      completed:  false
    };
  }
  // Skip to calendar
  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: COLLECT CUSTOM — T1→T1.5→T2→T3 slot-filling for custom fields
   ============================================================================ */

async function processCollectCustom(ctx, userInput, config, companyId, events) {
  const allFields  = config.customFields || [];
  const slotFilling = config.slotFilling  || {};
  const fieldIndex  = ctx.customFieldIndex || 0;

  // All custom fields collected — advance
  if (fieldIndex >= allFields.length) {
    return advanceAfterCustomFields(ctx, config, companyId, false, events);
  }

  const field          = allFields[fieldIndex];
  const maxAttempts    = field.maxAttempts    || slotFilling.defaultMaxAttempts    || 3;
  const fallbackAction = field.fallbackAction || slotFilling.defaultFallbackAction || 'RE_ASK_PLAIN';
  const reAnchorSuffix = slotFilling.reAnchorSuffix || '';

  // First turn for this field — ask the prompt
  if (!userInput) {
    return {
      nextPrompt: field.prompt || `What is your ${field.label}?`,
      bookingCtx: { ...ctx, step: STEPS.COLLECT_CUSTOM },
      completed:  false
    };
  }

  // TIER 1 — DETERMINISTIC EXTRACT
  const extracted = extractCustomFieldValue(userInput, field);
  if (extracted !== null) {
    events.push({ type: 'BL2_CUSTOM_FIELD_COLLECTED', fieldKey: field.key, value: extracted, timestamp: Date.now() });
    const newCtx = {
      ...ctx,
      collectedCustomFields: { ...(ctx.collectedCustomFields || {}), [field.key]: extracted },
      customFieldIndex: fieldIndex + 1
    };

    // Advance to next custom field or beyond
    if (fieldIndex + 1 < allFields.length) {
      const nextField = allFields[fieldIndex + 1];
      return {
        nextPrompt: nextField.prompt || `And your ${nextField.label}?`,
        bookingCtx: { ...newCtx, step: STEPS.COLLECT_CUSTOM },
        completed:  false
      };
    }
    return advanceAfterCustomFields(newCtx, config, companyId, false, events);
  }

  // TIER 2/3 — attempt counter
  const attemptKey   = `_cfAttempt_${field.key}`;
  const attemptCount = (ctx[attemptKey] || 0) + 1;

  if (attemptCount >= maxAttempts) {
    // TIER 3 — FALLBACK
    events.push({ type: 'BL2_CUSTOM_FIELD_FALLBACK', fieldKey: field.key, action: fallbackAction, timestamp: Date.now() });

    if (fallbackAction === 'SKIP' && !field.required) {
      // Skip this field
      const newCtx = { ...ctx, customFieldIndex: fieldIndex + 1, [attemptKey]: 0 };
      if (fieldIndex + 1 < allFields.length) {
        const nextField = allFields[fieldIndex + 1];
        return {
          nextPrompt: nextField.prompt || `And your ${nextField.label}?`,
          bookingCtx: { ...newCtx, step: STEPS.COLLECT_CUSTOM },
          completed: false
        };
      }
      return advanceAfterCustomFields(newCtx, config, companyId, false, events);
    }

    // RE_ASK_PLAIN or other non-SKIP fallback — re-ask plainly
    return {
      nextPrompt: `I'm sorry, I just need your ${field.label} to continue. ${field.reAnchorPhrase || `Could you tell me your ${field.label}?`}`,
      bookingCtx: { ...ctx, [attemptKey]: 0, step: STEPS.COLLECT_CUSTOM },
      completed: false
    };
  }

  // TIER 2 — LLM digression: return re-anchor phrase so the LLM layer can embed it
  const reAnchor = field.reAnchorPhrase ||
    `${reAnchorSuffix} what is your ${field.label}?`.trim().replace(/^\s+/, '');

  events.push({ type: 'BL2_CUSTOM_FIELD_T2_DIGRESSION', fieldKey: field.key, attempt: attemptCount, timestamp: Date.now() });

  return {
    nextPrompt:   reAnchor,
    bookingCtx:   { ...ctx, [attemptKey]: attemptCount, step: STEPS.COLLECT_CUSTOM },
    completed:    false,
    t2Digression: true,     // signal to caller that LLM should handle this turn
    pendingField: { fieldKey: field.key, fieldLabel: field.label, reAnchorPhrase: reAnchor }
  };
}

/**
 * Tier-1 deterministic extraction for a custom field.
 * Returns the extracted value or null.
 */
function extractCustomFieldValue(userInput, field) {
  const input = (userInput || '').trim();
  if (!input) return null;

  switch (field.fieldType) {
    case 'phone':
      return extractPhoneFromText(input) || null;

    case 'yesno':
      if (isAffirmativeResponse(input)) return 'yes';
      if (/\b(no|nope|nah|negative)\b/i.test(input)) return 'no';
      return null;

    case 'choice': {
      if (!field.choices?.length) return input.length > 0 ? input : null;
      const lower = input.toLowerCase();
      const match = field.choices.find(c => lower.includes(c.toLowerCase()));
      return match || null;
    }

    case 'number': {
      const numMatch = input.match(/\b\d+\b/);
      return numMatch ? numMatch[0] : null;
    }

    case 'text':
    default:
      // Accept any non-empty response for free-text fields
      return input.length > 0 ? input : null;
  }
}

/* ============================================================================
   STEP: COLLECT ALT CONTACT
   ============================================================================ */

async function processCollectAltContact(ctx, userInput, config, events) {
  const ac   = config.altContact || {};
  const step = ctx.altContactStep || 'OFFER';

  if (step === 'OFFER') {
    if (!userInput) {
      return {
        nextPrompt: ac.offerPrompt || 'Do you have an alternate contact we should have on file?',
        bookingCtx: { ...ctx, step: STEPS.COLLECT_ALT_CONTACT, altContactStep: 'OFFER' },
        completed:  false
      };
    }
    if (isAffirmativeResponse(userInput)) {
      return {
        nextPrompt: ac.askNamePrompt || "What's the name for that contact?",
        bookingCtx: { ...ctx, altContactStep: 'ASK_NAME', currentAltContact: {} },
        completed:  false
      };
    }
    // Caller said no — advance to OFFER_TIMES
    return {
      nextPrompt: config.holdMessage || 'One moment while I check our available times...',
      bookingCtx: { ...ctx, step: STEPS.OFFER_TIMES },
      completed:  false
    };
  }

  if (step === 'ASK_NAME') {
    const name = (userInput || '').trim();
    if (!name) {
      return {
        nextPrompt: ac.askNamePrompt || "What's the name for that contact?",
        bookingCtx: ctx,
        completed:  false
      };
    }
    return {
      nextPrompt: ac.askPhonePrompt || "And their phone number?",
      bookingCtx: { ...ctx, altContactStep: 'ASK_PHONE', currentAltContact: { name } },
      completed:  false
    };
  }

  if (step === 'ASK_PHONE') {
    const phone  = extractPhoneFromText(userInput || '') || (userInput || '').trim();
    const current = { ...(ctx.currentAltContact || {}), phone };
    if (ac.askNotesPrompt) {
      return {
        nextPrompt: ac.askNotesPrompt,
        bookingCtx: { ...ctx, altContactStep: 'ASK_NOTES', currentAltContact: current },
        completed:  false
      };
    }
    return finishAltContact(ctx, current, config, events);
  }

  if (step === 'ASK_NOTES') {
    const notes   = (userInput || '').trim();
    const current = { ...(ctx.currentAltContact || {}), notes };
    return finishAltContact(ctx, current, config, events);
  }

  if (step === 'ASK_MORE') {
    if (isAffirmativeResponse(userInput || '')) {
      return {
        nextPrompt: ac.askNamePrompt || "What's the name?",
        bookingCtx: { ...ctx, altContactStep: 'ASK_NAME', currentAltContact: {} },
        completed:  false
      };
    }
    return {
      nextPrompt: config.holdMessage || 'One moment while I check our available times...',
      bookingCtx: { ...ctx, step: STEPS.OFFER_TIMES },
      completed:  false
    };
  }

  // Fallback
  return {
    nextPrompt: config.holdMessage || 'One moment...',
    bookingCtx: { ...ctx, step: STEPS.OFFER_TIMES },
    completed:  false
  };
}

function finishAltContact(ctx, contact, config, events) {
  const ac         = config.altContact || {};
  const altContacts = [...(ctx.altContacts || []), contact];
  events.push({ type: 'BL2_ALT_CONTACT_COLLECTED', contact, timestamp: Date.now() });

  if (ac.allowMultiple) {
    return {
      nextPrompt: ac.multiplePrompt || 'Any other contacts you would like us to have on file?',
      bookingCtx: { ...ctx, altContacts, altContactStep: 'ASK_MORE', currentAltContact: null },
      completed:  false
    };
  }

  return {
    nextPrompt: config.holdMessage || 'One moment while I check our available times...',
    bookingCtx: { ...ctx, altContacts, step: STEPS.OFFER_TIMES, currentAltContact: null },
    completed:  false
  };
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

  // Build service notes: technician preference first, then issue summary.
  // Both are optional — the field is omitted if neither is set.
  const techNote    = ctx.technicianPreference ? `Preferred tech: ${ctx.technicianPreference}. ` : '';
  const issueNote   = ctx.summary?.issue || '';
  const serviceNotes = (techNote + issueNote).trim() || null;

  try {
    return await GoogleCalendarService.createBookingEvent(companyId, {
      customerName,
      customerPhone:   phone   || null,
      customerAddress: address || null,
      serviceType,
      serviceNotes,
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
 * Build a warm, context-aware opening sentence for the booking phase.
 *
 * Combines three discovery signals into one natural sentence block:
 *   1. Call reason / issue summary  ("I've got this noted as an AC not cooling issue.")
 *   2. Technician preference        ("I'll make a note that you'd like Tony to come back out.")
 *   3. Urgency                      ("I'll prioritize getting someone out quickly.")
 *
 * All three are optional — if none are present the function returns ''
 * and the booking engine falls back to its default prompt.
 *
 * @param {Object} ctx  — booking context (has callContext + technicianPreference)
 * @returns {string}    — trailing space included so it can be directly prepended
 */
function buildWarmOpening(ctx) {
  const callContext = ctx?.callContext;
  const techPref    = ctx?.technicianPreference;
  const parts       = [];

  if (callContext?.issue?.summary) {
    // Use "an" before vowel sounds (AC, HVAC, air handler) — "an AC not cooling issue" not "a AC..."
    const summary = callContext.issue.summary;
    const article = /^[aeiouAEIOU]/.test(summary) ? 'an' : 'a';
    parts.push(`I've got this noted as ${article} ${summary}.`);
  }

  if (techPref) {
    parts.push(`I'll make a note that you'd like ${techPref} to come back out.`);
  }

  if (callContext?.urgency?.level === 'high') {
    parts.push(`I'll prioritize getting someone out quickly.`);
  }

  return parts.length > 0 ? parts.join(' ') + ' ' : '';
}

/**
 * Parse a raw name string into first and last components.
 */
function parseName(input) {
  let cleaned = input.trim();

  // Strip leading filler words callers say before their name
  // e.g. "Sure, my name is Mark." → "my name is Mark."
  cleaned = cleaned.replace(/^(sure|well|um|uh|yeah|yes|ok|okay|so|hi|hey|oh|right|great|alright|certainly|absolutely|of course|no problem)[,.]?\s*/i, '');

  // Strip name-introduction phrases
  // e.g. "my name is Mark" → "Mark"  |  "I'm John Smith" → "John Smith"
  cleaned = cleaned.replace(/^(my name'?s?( is)?|i'?m|i am|this is|it'?s|they call me|call me|the name is|name is)\s*/i, '');

  // Clean each word: keep letters, hyphens, apostrophes; remove trailing punctuation
  const cleanWord = (w) => capitalizeFirst(w.replace(/[^a-zA-Z'\-]/g, ''));

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: 'there', lastName: null };

  const firstName = cleanWord(words[0]) || 'there';
  const lastName  = words.length > 1
    ? words.slice(1).map(cleanWord).filter(Boolean).join(' ') || null
    : null;

  return { firstName, lastName };
}

/**
 * Extract a last name from a "last name only" utterance.
 * Strips common last-name intro phrases, returns the first significant word.
 * Returns null if nothing meaningful is left.
 */
function parseLastName(input) {
  let cleaned = input.trim();

  // Strip last-name intro phrases: "my last name is Smith" → "Smith"
  cleaned = cleaned.replace(/^(my (last|sur)name'?s?( is)?|(last|sur)name is|it'?s|its)\s*/i, '');

  // Strip leading filler: "um, Johnson" → "Johnson"
  cleaned = cleaned.replace(/^(um|uh|well|so|oh)[,.]?\s*/i, '');

  // Take the first word (last names are usually one token)
  const word = cleaned.split(/\s+/)[0];
  if (!word) return null;

  // Clean punctuation — keep hyphens and apostrophes for compound last names
  const clean = word.replace(/[^a-zA-Z'\-]/g, '');
  return clean.length >= 1 ? capitalizeFirst(clean) : null;
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Normalize a spoken/STT phone number to (XXX) XXX-XXXX format.
 *
 * Handles common STT artifacts:
 *   - Extra spaces/dashes:  "239 333 7747"   → "(239) 333-7747"
 *   - US country code:      "1 239 333 7747"  → "(239) 333-7747"
 *   - Raw digits:           "2393337747"       → "(239) 333-7747"
 *
 * Returns null when the digit count is not recoverable to 10 digits,
 * so processCollectPhone can re-prompt the caller.
 *
 * @param  {string}      input — raw STT output
 * @returns {string|null}      — formatted phone or null if unrecoverable
 */
function normalizePhone(input) {
  const digits = (input || '').replace(/\D/g, '');
  // Strip leading country code "1" when total is 11 digits (US: 1-XXX-XXX-XXXX)
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return null; // unrecognizable — caller should be prompted to repeat
}

/**
 * Check if an utterance is affirmative (yes/sure/ok/that works/etc.)
 * Handles "yes, but ..." constructions — positive starts with yes even if more follows.
 */
function isAffirmativeResponse(text) {
  return /^(yes|yeah|sure|yep|yup|ok|okay|correct|right|that'?s?( fine| good| works?| right| correct)?|go ahead|use that|perfect|sounds good|absolutely|of course|yup|totally)\b/i.test((text || '').trim());
}

/**
 * Extract the first phone number found anywhere inside a natural-language utterance.
 * Handles "call me at 239-333-5555" or "this number is 239 333 5555".
 * Returns the raw matched string for normalizePhone() to format.
 */
function extractPhoneFromText(text) {
  if (!text) return null;
  // Match US phone patterns embedded in text: optional country code, area code, 7-digit local
  const m = text.match(/(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/);
  return m ? m[0] : null;
}

/**
 * Detect whether the caller is mentioning an additional/secondary contact scenario.
 * Returns true if they describe a reason to have a different number called.
 */
function detectAltPhoneIntent(text) {
  return /\b(on the way|en route|heading over|when (the )?(tech|technician|someone|they|he|she) (is |are )?(coming|on the way|heading)|notify|neighbor|next door|son|daughter|child|kid|wife|husband|spouse|partner|family|another number|different number|second number|also (call|text)|call (them|him|her|my) at|text (them|him|her|my) at|this (is|number))\b/i.test(text || '');
}

/**
 * Extract a human-readable context label from the caller's alt-phone utterance.
 * Used to annotate the altPhone in the booking record and calendar event.
 */
function detectAltPhoneContext(text) {
  const t = (text || '').toLowerCase();
  if (/on the way|en route|heading over|when (the )?(tech|technician) (is )?coming/.test(t)) return 'tech on the way';
  if (/neighbor|next door/.test(t))             return 'neighbor notification';
  if (/\bson\b|\bdaughter\b|\bchild\b|\bkid\b/.test(t)) return 'family member on-site';
  if (/wife|husband|spouse|partner/.test(t))    return 'spouse/partner on-site';
  return 'additional contact';
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

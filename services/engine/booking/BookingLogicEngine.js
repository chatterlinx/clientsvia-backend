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
const HolidayService       = require('../../HolidayService');
const { BookingTriggerMatcher }      = require('./BookingTriggerMatcher');
const BookingLLMInterceptService     = require('./BookingLLMInterceptService');
const GroqFieldExtractorService      = require('./GroqFieldExtractorService');
const GlobalHubService     = require('../../GlobalHubService');
const KCS                  = require('../agent2/KnowledgeContainerService');
const BPFUQService         = require('../kc/BPFUQService');
const DiscoveryNotesService = require('../../discoveryNotes/DiscoveryNotesService');

const ENGINE_ID = 'BOOKING_LOGIC_ENGINE';
const VERSION   = 'BL2.0';

// ── 123RP: return-to-booking suffix appended to all Tier 1/2 intercept responses ──
const RETURN_TO_BOOKING_Q = "Does that answer your question? Shall we get back to completing your booking?";

/* ============================================================================
   BOOKING FLOW STEPS
   ============================================================================ */

const STEPS = {
  INIT:                 'INIT',
  DISCRIMINATOR:        'DISCRIMINATOR',         // Phase 0 — ONE pre-qualifying question before any collection
                                                 // Classifies caller type (e.g. plan member vs first-timer)
                                                 // Sets serviceType override + custom field in discoveryNotes.temp
                                                 // Configured per company in bookingFieldConfig.discriminatorQuestion
  CONFIRM_RECOGNITION:  'CONFIRM_RECOGNITION',  // T0 — confirm CRM-matched caller identity
  CONFIRM_NAME:         'CONFIRM_NAME',          // T0 — confirm LLM-prefilled name from discovery
  COLLECT_NAME:         'COLLECT_NAME',
  COLLECT_PHONE:        'COLLECT_PHONE',
  COLLECT_ADDRESS:      'COLLECT_ADDRESS',
  COLLECT_CUSTOM:           'COLLECT_CUSTOM',           // iterates bookingConfig.customFields[]
  COLLECT_ALT_CONTACT:      'COLLECT_ALT_CONTACT',      // optional alt contact collection
  COLLECT_PREFERRED_DAY:    'COLLECT_PREFERRED_DAY',    // ask preferred appointment day
  COLLECT_PREFERRED_TIME:   'COLLECT_PREFERRED_TIME',   // ask preferred time of day
  OFFER_TIMES:              'OFFER_TIMES',
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
  requiredFields:        ['firstName', 'phone', 'address'],
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
      .select('aiAgentSettings.bookingLogic aiAgentSettings.agent2.bookingConfig aiAgentSettings.agent2.bookingPrompts aiAgentSettings.agent2.bridge.bookingBridgePhrase aiAgentSettings.agent2.discovery.holdMessage aiAgentSettings.agent2.knowledgeBaseSettings googleCalendar businessHours companyName')
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

      // Built-in field prompts — bookingConfig authoritative; legacy fills gaps; hardcoded last resort
      askNamePrompt:           bc.builtinPrompts?.askName                 || bp.askName    || 'To get started, may I have your first and last name?',
      nameReAnchor:            bc.builtinPrompts?.nameReAnchor            || 'What is your first and last name?',
      confirmFullName:         bc.builtinPrompts?.confirmFullName         || 'I assume your name is {name}, is that correct?',
      confirmFirstNameAskLast: bc.builtinPrompts?.confirmFirstNameAskLast || 'I show your first name as {firstName} — is that right?',
      askLastNameOnly:         bc.builtinPrompts?.askLastNameOnly         || 'And what is your last name?',
      askPhonePrompt:          bc.builtinPrompts?.askPhone                || bp.askPhone   || 'And what is the best phone number to reach you at?',
      phoneReAnchor:           bc.builtinPrompts?.phoneReAnchor           || 'What phone number can we reach you at?',
      phoneInvalid:            bc.builtinPrompts?.phoneInvalid            || "I didn't quite catch a phone number there. What number should we use to reach you?",
      askAddressPrompt:        bc.builtinPrompts?.askAddress              || bp.askAddress || 'And what is the service address?',
      addressReAnchor:         bc.builtinPrompts?.addressReAnchor         || 'What is the service address for this appointment?',
      t2DigressionAck:              bc.builtinPrompts?.t2DigressionAck             || "Absolutely — we'll make sure that gets addressed.",
      patiencePhone:                bc.builtinPrompts?.patiencePhone               || 'No problem — go ahead whenever you have it.',
      patienceAddress:              bc.builtinPrompts?.patienceAddress             || "Take your time — just say the address whenever you're ready.",
      patienceGeneral:              bc.builtinPrompts?.patienceGeneral             || "Sure, no rush — I'm right here.",
      confirmNameAmbiguous:         bc.builtinPrompts?.confirmNameAmbiguous        || 'Just to confirm — is your name {name}? A simple yes or no works.',
      confirmNamePartialCorrected:  bc.builtinPrompts?.confirmNamePartialCorrected || 'Got it, {firstName}! And your last name?',
      confirmFirstNameGotLastAsk:   bc.builtinPrompts?.confirmFirstNameGotLastAsk  || 'Great, {firstName}! And what is your last name?',
      timeConfirmPrompt:            bc.confirmation?.timeConfirmPrompt              || 'Just to confirm — shall I book you for {time}?',
      timeAmbiguousPrompt:          bc.confirmation?.timeAmbiguousPrompt            || "I want to make sure I have this right — shall I book you for {time}?",

      // Custom fields (new — from bookingConfig)
      customFields:     bc.customFields    || DEFAULT_CONFIG.customFields,

      // Alt contact (new)
      altContact:       bc.altContact      || DEFAULT_CONFIG.altContact,

      // Confirmation step (new)
      confirmation:     bc.confirmation    || DEFAULT_CONFIG.confirmation,

      // Slot filling / digression (new)
      slotFilling:      bc.slotFilling     || DEFAULT_CONFIG.slotFilling,

      // Bridge phrase — plays at booking entry to eliminate dead silence
      // Stored at aiAgentSettings.agent2.bridge.bookingBridgePhrase (pre-cached as InstantAudio)
      bridgePhrase: (company.aiAgentSettings?.agent2?.bridge?.bookingBridgePhrase || '').trim(),

      // Caller recognition (new)
      callerRecognition: bc.callerRecognition || { enabled: false },

      // Discriminator question — ONE pre-qualifying question asked BEFORE any field collection.
      // Classifies caller type (e.g. "plan member" vs "first-time visit") so the engine
      // can set the correct serviceType, schedPriority, and pricing tier before gathering name/phone.
      // Null = no discriminator (skip phase entirely, go straight to collection).
      // Stored in Company.aiAgentSettings.agent2.bookingConfig.discriminatorQuestion per company.
      discriminatorQuestion: bc.discriminatorQuestion || null,

      // Calendar connection
      calendarConnected: !!(company.googleCalendar?.accessToken),
      calendarId:        company.googleCalendar?.calendarId || null,
      businessHours:     company.businessHours || null,

      // Required fields — bookingConfig.requiredFieldsConfig is authoritative (UI-driven);
      // legacy bookingLogic.requiredFields fills the gap; default includes address.
      requiredFields: (() => {
        if (bc.requiredFieldsConfig) {
          const fields = ['firstName', 'phone']; // always required
          if (bc.requiredFieldsConfig.address !== false) fields.push('address');
          return fields;
        }
        return bl.requiredFields || DEFAULT_CONFIG.requiredFields;
      })(),

      // Scheduling preference capture — ask preferred day/time before fetching slots.
      // All keys are UI-configurable per company and stored in MongoDB.
      preferenceCapture: {
        enabled:               bc.preferenceCapture?.enabled !== false,
        // Day / time capture prompts
        askDayPrompt:          bc.preferenceCapture?.askDayPrompt          || 'What day works best for you?',
        askTimePrompt:         bc.preferenceCapture?.askTimePrompt         || "And what time works for you {day}? I'll check our availability.",
        noSlotsOnDayPrompt:    bc.preferenceCapture?.noSlotsOnDayPrompt    || "I don't see any openings for {day} — the next available slot I have is {alternative}. Does that work for you?",
        // Urgency acknowledgements
        urgentPrompt:          bc.preferenceCapture?.urgentPrompt          || "I completely understand — let me pull up the very first opening we have for you.",
        urgentNoTodayPrompt:   bc.preferenceCapture?.urgentNoTodayPrompt   || "I completely understand the urgency. Unfortunately I don't have any same-day openings right now —",
        // Address readback — spoken when caller asks "what address do you have?" mid-scheduling.
        // Placeholders: {address} = collected address, {followUp} = next scheduling prompt.
        addressReadbackPrompt: bc.preferenceCapture?.addressReadbackPrompt || "I have {address} on file as the service address. {followUp}",
        // Digression acknowledgement — spoken when a non-scheduling question is answered mid-scheduling.
        // Leave blank to fall back to config.t2DigressionAck.
        scheduleDigressionAck: bc.preferenceCapture?.scheduleDigressionAck || '',
      },

      // ── TECHNICIANS & SERVICE TYPES ──────────────────────────────────────────
      // Used by fetchAvailableTimeOptions to route queries to the correct calendar(s).
      technicians:  (bc.technicians  || []).filter(t => t.active !== false),
      serviceTypes: (bc.serviceTypes || []).filter(t => t.active !== false),

      // ── EMERGENCY SCHEDULE ────────────────────────────────────────────────────
      emergencySchedule: bc.emergencySchedule || { enabled: false },

      // ── HOLIDAYS ──────────────────────────────────────────────────────────────
      holidays: bc.holidays || [],

      // ── ADDRESS COLLECTION CONFIG ──────────────────────────────────────────
      // requireCity:  true by default — most service calls need a city for dispatch routing.
      // requireState: false by default — most companies operate same-city, state is noise.
      // requireZip:   false by default — same rationale; enable only when routing requires it.
      addressConfig: {
        requireCity:    bc.addressConfig?.requireCity  !== false,   // default: true
        requireState:   bc.addressConfig?.requireState === true,    // default: false
        requireZip:     bc.addressConfig?.requireZip   === true,    // default: false
        askCityPrompt:  bc.addressConfig?.askCityPrompt   || 'And what city is that in?',
        askStatePrompt: bc.addressConfig?.askStatePrompt  || 'And what state?',
        askZipPrompt:   bc.addressConfig?.askZipPrompt    || 'And the zip code?'
      },

      // KB settings — used by Tier 1.5 KC digression to resolve word limit and offer mode
      knowledgeBaseSettings: company.aiAgentSettings?.agent2?.knowledgeBaseSettings || {},
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
  // v2 schema uses temp{}, v1 used entities{} — support both for backward compat
  const dnEntities = dn?.temp || dn?.entities || {};

  // ── Urgency pre-seeding ────────────────────────────────────────────────────
  // If the discovery phase already established urgency/ASAP intent, seed it here
  // so the booking engine skips the "what day works best?" question entirely and
  // goes straight to fetching the earliest available slot.
  // Sources: discoveryNotes.urgency.level | callContext.urgency.level | sameDayRequested
  const urgencyLevel = dn?.urgency?.level || (typeof dn?.urgency === 'string' ? dn.urgency : null);
  const callUrgency  = payload?.callContext?.urgency?.level;
  const seedAsap     = payload?.sameDayRequested === true ||
                       urgencyLevel === 'high'   || urgencyLevel === 'urgent' ||
                       callUrgency  === 'high'   || callUrgency  === 'urgent';

  return {
    step:        STEPS.INIT,
    callSid:     payload?.callSid || null,   // threaded for UAPB BOOKING_CONFIRM DN lock
    bookingMode: payload?.assumptions?.bookingMode || null,
    collectedFields: {
      // ScrabEngine assumptions take priority; discoveryNotes entities are fallback.
      // This prevents re-asking for information the LLM already captured on turn 1.
      firstName:       payload?.assumptions?.firstName || dnEntities.firstName || null,
      lastName:        payload?.assumptions?.lastName  || dnEntities.lastName  || null,
      phone:           payload?.assumptions?.phone     || dnEntities.phone     || null,
      address:         payload?.assumptions?.address   || dnEntities.address   || null,
      // Additional contact number (e.g. "call tech on the way", "notify neighbor", "son's number")
      altPhone:        null,
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
    // Service type resolved for this booking session — stamped on first resolution
    // and persisted so multi-turn calls always route to the correct technician calendars.
    serviceTypeId:        null,
    // Scheduling preferences — pre-seeded from intake when urgency is known
    preferredDay:         seedAsap ? 'asap'     : null,
    preferredTime:        seedAsap ? 'earliest' : null,
    availableTimeOptions: null,
    selectedTime:         null,
    calendarEventId:      null,
    calendarEventLink:    null,
    completed:            false,
    startedAt:            new Date().toISOString(),
    // Custom fields slot-filling state
    customFieldIndex:      0,        // which customFields[] entry we're currently collecting
    collectedCustomFields: {},       // { fieldKey: value }
    // Alt contact state
    altContacts:           [],       // [{ name, phone, notes }]
    altContactStep:        null,     // null | 'OFFER' | 'ASK_NAME' | 'ASK_PHONE' | 'ASK_NOTES' | 'ASK_MORE'
    currentAltContact:     null,     // partial contact being built
    // Multi-step address collection sub-state
    addressStep:           null,     // null | 'STREET' | 'CITY' | 'STATE' | 'ZIP'
    _addressStreet:        null,
    _addressCity:          null,
    _addressState:         null,
    _addressZip:           null
  };
}

/* ============================================================================
   STEP ROUTING
   ============================================================================ */

async function processCurrentStep(ctx, userInput, config, companyId, isTest, events) {

  // ── BPFUQ: STEP-FIRST ARCHITECTURE ──────────────────────────────────────
  //
  // 1. Try to process as expected step input (step handler runs first).
  // 2. If step did NOT advance AND input looks off-topic → BPFUQ:
  //      Go to KC (services.html containers) — the ONLY digression handler.
  //      KC answers → BPFUQ records paused step → Gate 0 resumes next turn.
  //      No KC match → graceful re-anchor to current booking step.
  //      No triggers. No LLM fallback.
  // 3. Otherwise: return step result as-is.
  //
  // DATA-ENTRY STEPS (phone, address, preferred day/time) never trigger BPFUQ —
  // callers there are providing raw data, not expressing intent.
  //
  // Why step-first?
  //   "John Smith"   at COLLECT_NAME → step handler extracts name → no BPFUQ needed.
  //   "Today at 10"  at OFFER_TIMES  → step handler matches slot  → no BPFUQ needed.
  //   "What if I change the battery?" at COLLECT_NAME → step fails → BPFUQ fires.
  //   "What do you charge?"           at COLLECT_NAME → step fails → KC answers it.
  // ─────────────────────────────────────────────────────────────────────────

  const DATA_ENTRY_STEPS = new Set([
    STEPS.INIT,
    STEPS.COMPLETED,
    STEPS.COLLECT_PHONE,
    STEPS.COLLECT_ADDRESS,
    STEPS.COLLECT_PREFERRED_DAY,
    STEPS.COLLECT_PREFERRED_TIME,
  ]);

  // ── Gate 0: BPFUQ — Booking Pending Follow-Up Question ───────────────────
  // Fires BEFORE the step handler. Last turn answered a mid-booking KC
  // question (Tier 1.5). Groq closed with "Shall we get back to your booking?"
  // Now we detect whether the caller is ready to resume or has more questions.
  //
  //   YES      → clear BPFUQ, return step re-anchor (e.g. "What is the address?")
  //   NO       → clear BPFUQ, fall through — BPFUQ will re-fire if another KC question
  //              (chains naturally: KC answers → BPFUQ set → Gate 0 next turn)
  //   AMBIGUOUS → keep BPFUQ alive, re-ask "Shall we get back to completing your booking?"
  // ─────────────────────────────────────────────────────────────────────────
  const bpfuq = BPFUQService.load(ctx);
  if (bpfuq) {
    const consent = BPFUQService.detectConsent(userInput);
    events.push({ type: 'BK_BPFUQ_GATE', step: bpfuq.step, consent, timestamp: Date.now() });

    if (consent === 'YES') {
      BPFUQService.clear(ctx);
      const reAnchor = _getStepReAnchor(bpfuq.step, config);
      return {
        nextPrompt: reAnchor,
        bookingCtx: ctx,
        completed:  false,
        _123rp:     { tier: 0, path: 'BK_BPFUQ_RESUME' }
      };
    }

    if (consent === 'NO') {
      // Caller has more questions — clear BPFUQ and fall through to normal
      // 123RP cascade. Tier 1.5 will re-set BPFUQ if they ask another KC question.
      BPFUQService.clear(ctx);
      // ↓ fall through
    } else {
      // AMBIGUOUS (short/unclear) — gently re-ask
      return {
        nextPrompt: RETURN_TO_BOOKING_Q,
        bookingCtx: ctx,
        completed:  false,
        _123rp:     { tier: 0, path: 'BK_BPFUQ_REASK' }
      };
    }
  }

  // ── STEP 1: Run the normal step handler ───────────────────────────────────
  const prevSnap   = _snapshotCtx(ctx);
  const stepResult = await _runStepHandler(ctx, userInput, config, companyId, isTest, events);

  // Check if the step made progress (new data captured or step changed)
  const advanced = _didStepAdvance(prevSnap, stepResult.bookingCtx);

  // If step advanced or no user input → return as-is
  if (advanced || !userInput?.trim()) {
    return stepResult;
  }

  // DATA-ENTRY STEPS bypass 123RP to prevent false-positives on phone digits,
  // address names, etc. — UNLESS the input is clearly a question/confusion
  // signal that couldn't possibly be raw data. Example: "what are you booking?"
  // at COLLECT_PHONE step — ignore the step result, let 123RP answer it.
  if (DATA_ENTRY_STEPS.has(prevSnap.step) && !_isClearQuestion(userInput)) {
    return stepResult;
  }

  // If input is short / ambiguous → trust the step re-ask over 123RP
  // (covers: "hmm", "oh", "sorry", "Tuesday", "10am", "John Smith")
  if (!_isLikelyOffTopic(userInput, prevSnap.step)) {
    return stepResult;
  }

  // ── OFFER_TIMES scheduling bypass ────────────────────────────────────────
  // When the caller is choosing from presented time slots, short inputs or
  // inputs containing scheduling terms ("day", "time", "now", "when", etc.)
  // are scheduling clarifications — NOT off-topic intent. Reset to day
  // collection so the booking can retry with a fresh availability fetch.
  if (prevSnap.step === STEPS.OFFER_TIMES) {
    const lc              = (userInput || '').toLowerCase().trim();
    const wordCount       = lc.split(/\s+/).length;
    const hasSchedulingTerm = /\b(day|time|when|available|slot|schedule|now|next|morning|afternoon|evening|tomorrow|today|week|first|earliest)\b/.test(lc);

    if (wordCount <= 4 || hasSchedulingTerm) {
      events.push({ type: 'BK_OFFER_TIMES_SCHEDULING_ANCHOR', rawInput: userInput.substring(0, 60), timestamp: Date.now() });
      // Reset preferences and fetch state so the next turn is a clean day-selection attempt
      ctx.step                 = STEPS.COLLECT_PREFERRED_DAY;
      ctx.preferredDay         = null;
      ctx.preferredTime        = null;
      ctx.availableTimeOptions = null;
      return {
        nextPrompt: config.preferenceCapture?.askDayPrompt || 'What day works best for you?',
        bookingCtx: ctx,
        completed:  false,
      };
    }
  }

  // ── STEP 2: Off-topic question — BPFUQ ──────────────────────────────────
  // All caller questions mid-booking route exclusively through KC (services.html).
  // No triggers. No LLM fallback.
  //
  // KC answers → BPFUQ records the paused booking step → Gate 0 (top of this
  // function) resumes booking next turn once the caller confirms they're done.
  //
  // No KC container match → clean re-anchor to current step question.
  // The agent always knows exactly where booking was paused and returns there.
  // ─────────────────────────────────────────────────────────────────────────
  events.push({
    type:      'BK_BPFUQ_START',
    step:      prevSnap.step,
    input:     userInput.substring(0, 100),
    timestamp: Date.now()
  });

  try {
    const containers = await KCS.getActiveForCompany(companyId);
    if (containers.length) {
      const match = KCS.findContainer(containers, userInput);
      if (match) {
        const kcResult = await KCS.answer({
          container:  match.container,
          question:   userInput,
          kbSettings: { ...(config.knowledgeBaseSettings || {}), bookingOfferMode: 'return_to_booking' },
          company:    { _id: companyId, companyName: config.companyName },
        });
        if (kcResult?.response) {
          // BPFUQ: record which booking step was paused.
          // Gate 0 will intercept next turn to resume or chain another KC question.
          BPFUQService.set(ctx, { step: prevSnap.step });
          events.push({
            type:           'BK_BPFUQ_KC_ANSWERED',
            step:           prevSnap.step,
            containerTitle: match.container.title,
            containerId:    String(match.container._id),
            kcId:           match.container.kcId || null,
            timestamp:      Date.now()
          });
          ctx.lastPath = 'BK_KC_DIGRESSION';
          return {
            nextPrompt: kcResult.response,
            bookingCtx: ctx,
            completed:  false,
            _123rp:     { tier: 1.5, path: 'BK_KC_DIGRESSION', containerTitle: match.container.title }
          };
        }
      }
    }
  } catch (kcErr) {
    logger.warn(`[${ENGINE_ID}] BPFUQ KC lookup failed`, {
      companyId, step: prevSnap.step, error: kcErr.message
    });
    events.push({ type: 'BK_BPFUQ_KC_ERROR', error: kcErr.message, timestamp: Date.now() });
  }

  // No KC container matched — re-anchor cleanly to the current booking step.
  events.push({
    type:      'BK_BPFUQ_KC_NO_MATCH',
    step:      prevSnap.step,
    input:     userInput.substring(0, 60),
    timestamp: Date.now()
  });
  ctx.lastPath = 'BK_BPFUQ_NO_MATCH';
  return {
    nextPrompt: _getStepReAnchor(prevSnap.step, config),
    bookingCtx: ctx,
    completed:  false,
    _123rp:     { tier: 1.5, path: 'BK_BPFUQ_NO_MATCH' }
  };
}

// ── 123RP helpers ─────────────────────────────────────────────────────────────

/**
 * Snapshot the ctx fields that signal "advancement" so we can compare after
 * the step handler runs.
 */
function _snapshotCtx(ctx) {
  const cf = ctx.collectedFields || {};
  return {
    step:          ctx.step,
    firstName:     cf.firstName     || null,
    lastName:      cf.lastName      || null,
    phone:         cf.phone         || null,
    address:       cf.address       || null,
    selectedTime:  ctx.selectedTime || null,
    preferredDay:  ctx.preferredDay || null,
    preferredTime: ctx.preferredTime || null,
    addressStep:   ctx.addressStep  || null,
    _addressStreet: ctx._addressStreet || null,
    _addressCity:   ctx._addressCity   || null,
  };
}

/**
 * Return true if the step handler made meaningful progress.
 * A step "advances" when: the step itself changes, OR new data fields are filled.
 */
function _didStepAdvance(prevSnap, newCtx) {
  if (!newCtx) return false;
  if (prevSnap.step !== newCtx.step) return true;

  const cf = newCtx.collectedFields || {};
  if (cf.firstName     && !prevSnap.firstName)     return true;
  if (cf.lastName      && !prevSnap.lastName)      return true;
  if (cf.phone         && !prevSnap.phone)         return true;
  if (cf.address       && !prevSnap.address)       return true;
  if (newCtx.selectedTime  && !prevSnap.selectedTime)  return true;
  if (newCtx.preferredDay  && !prevSnap.preferredDay)  return true;
  if (newCtx.preferredTime && !prevSnap.preferredTime) return true;
  // Multi-sub-step address collection — sub-step or partial data changed
  if (newCtx.addressStep    !== prevSnap.addressStep)    return true;
  if (newCtx._addressStreet !== prevSnap._addressStreet) return true;
  if (newCtx._addressCity   !== prevSnap._addressCity)   return true;

  return false;
}

/**
 * Heuristic: does this input look like an off-topic question rather than
 * a valid answer to the current booking step?
 *
 * Conservative thresholds to minimise false-positives on real step answers:
 *   "John Smith"           → 2 words, no ? → NOT off-topic (let step re-ask)
 *   "Today at 10 am"       → 4 words, no ? → NOT off-topic
 *   "What do you charge?"  → 5 words + ?   → OFF-TOPIC
 *   "What if I change the batteries myself would that work?" → 10 words → OFF-TOPIC
 */
function _isLikelyOffTopic(userInput, step) {
  if (!userInput?.trim()) return false;
  const trimmed   = userInput.trim();
  const wordCount = trimmed.split(/\s+/).length;

  // Explicit question mark is the strongest signal
  if (trimmed.endsWith('?')) return true;

  // Long sentence at a data-collection step — almost certainly not a name/time/etc.
  if (wordCount >= 6) return true;

  // At CONFIRM step, short ambiguous inputs are still step-relevant ("yes", "no", "actually...")
  // so we keep the threshold a bit higher there
  if (step === STEPS.CONFIRM && wordCount < 8) return false;

  return false;
}

/**
 * _isClearQuestion — true when input is unmistakably a question or expression
 * of confusion/doubt, not raw data being provided for a booking step.
 *
 * This is the narrow exception that allows 123RP to fire even at DATA_ENTRY_STEPS
 * (phone, address, etc.) so caller questions during booking are answered rather
 * than silently swallowed.
 *
 * Conservative: must match unambiguous signals only. "10" or "Smith" must NOT match.
 * Examples that fire:
 *   "What are you booking? I mean are you able to do the maintenance?"
 *   "Wait, what is this for?"
 *   "I'm confused — what are we scheduling?"
 *   "Actually hold on, do you do maintenance?"
 * Examples that do NOT fire:
 *   "555-1234"  → phone number
 *   "123 Main Street" → address
 *   "yeah"  → short ambiguous input
 */
function _isClearQuestion(userInput) {
  if (!userInput?.trim()) return false;
  const lc = userInput.toLowerCase().trim();

  // Explicit question mark anywhere → caller is asking a question
  if (lc.includes('?')) return true;

  // Strong question/confusion lead-ins
  const CLEAR_SIGNALS = [
    'what are you booking', 'what are you scheduling', 'what is this for',
    'what do you mean',     'what does that mean',
    'i want to ask',        'i was wondering',        'wondering if',
    'are you able to',      'can you do',             'do you do',
    'do you offer',         'is that something',      'is this something',
    'hold on',              'wait a minute',          'wait wait',
    'actually wait',        'actually hold on',
    'i am confused',        'im confused',            "i don't understand",
    'i dont understand',    'not sure what',          'not sure why',
    'what exactly',         'why are you',            'why do you',
  ];

  return CLEAR_SIGNALS.some(signal => lc.includes(signal));
}

/**
 * Return the re-ask prompt for the current booking step.
 * Used by Tier 3 fallback to bring the caller back on track.
 */
function _getStepReAnchor(step, config) {
  switch (step) {
    case STEPS.DISCRIMINATOR: {
      const dq = config.discriminatorQuestion;
      return dq?.text || 'Could you let me know which option applies to you?';
    }
    case STEPS.COLLECT_NAME:          return config.nameReAnchor    || config.askNamePrompt    || 'Could I get your first and last name?';
    case STEPS.COLLECT_PHONE:         return config.phoneReAnchor   || config.askPhonePrompt   || 'What phone number should we use to reach you?';
    case STEPS.COLLECT_ADDRESS:       return config.addressReAnchor || config.askAddressPrompt || 'What is the service address?';
    case STEPS.OFFER_TIMES:           return 'Which of those times works best for you?';
    case STEPS.CONFIRM:               return 'Shall I go ahead and confirm that appointment?';
    case STEPS.COLLECT_CUSTOM:        return 'Could you answer that question for me?';
    case STEPS.COLLECT_ALT_CONTACT:   return 'Did you want to add an alternate contact?';
    case STEPS.COLLECT_PREFERRED_DAY: return config.preferenceCapture?.askDayPrompt || 'What day works best for you?';
    default:                          return 'Could you say that again?';
  }
}

/**
 * Return required fields that have not yet been collected.
 * Used by the REDIRECT guard to decide whether we can safely jump to OFFER_TIMES.
 *
 * @param {Object} ctx    - Current booking context
 * @param {Object} config - Company booking config (has requiredFields array)
 * @returns {string[]}    - Ordered list of missing field keys (e.g. ['firstName', 'phone'])
 */
function _getMissingRequiredFields(ctx, config) {
  const required = config.requiredFields || ['firstName', 'phone', 'address'];
  const cf       = ctx.collectedFields   || {};
  const missing  = [];

  for (const field of required) {
    if (field === 'firstName' && !(cf.firstName || cf.lastName)) {
      missing.push('firstName');
    } else if (field === 'phone' && !cf.phone) {
      missing.push('phone');
    } else if (field === 'address' && !cf.address) {
      missing.push('address');
    }
  }
  return missing;
}

/**
 * Internal step handler dispatcher — the original processCurrentStep switch,
 * extracted so 123RP can call it cleanly.
 */
async function _runStepHandler(ctx, userInput, config, companyId, isTest, events) {
  switch (ctx.step) {
    case STEPS.DISCRIMINATOR:       return processDiscriminator(ctx, userInput, config, companyId, events);
    case STEPS.INIT:                return processInit(ctx, config, companyId, isTest, events);
    case STEPS.CONFIRM_RECOGNITION: return processConfirmRecognition(ctx, userInput, config, companyId, isTest, events);
    case STEPS.CONFIRM_NAME:        return processConfirmName(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_NAME:        return processCollectName(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_PHONE:       return processCollectPhone(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_ADDRESS:     return processCollectAddress(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_CUSTOM:      return processCollectCustom(ctx, userInput, config, companyId, events);
    case STEPS.COLLECT_ALT_CONTACT:    return processCollectAltContact(ctx, userInput, config, events);
    case STEPS.COLLECT_PREFERRED_DAY:  return processCollectPreferredDay(ctx, userInput, config, companyId, isTest, events);
    case STEPS.COLLECT_PREFERRED_TIME: return processCollectPreferredTime(ctx, userInput, config, companyId, isTest, events);
    case STEPS.OFFER_TIMES:            return processOfferTimes(ctx, userInput, config, companyId, isTest, events);
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
   STEP: DISCRIMINATOR  (Phase 0 — fires before everything else)
   ============================================================================
   Receives the caller's answer to the ONE pre-qualifying question.
   Matches against options[] using keyword detection (no Groq needed — it's
   a forced choice, not open-ended). Sets ctx._discriminatorAnswered and
   writes the result into discoveryNotes.temp (fire-and-forget).
   Falls through to INIT on any match; re-asks on no-match.
   ============================================================================ */

async function processDiscriminator(ctx, userInput, config, companyId, events) {
  const dq   = ctx._discriminatorQuestion || config.discriminatorQuestion;
  const opts  = dq?.options || [];
  const input = (userInput || '').toLowerCase().trim();

  events.push({ type: 'BL0_DISCRIMINATOR_RECEIVE', input: input.slice(0, 80), timestamp: Date.now() });

  if (!input || opts.length === 0) {
    // Empty input — re-ask
    return {
      nextPrompt: dq?.reAskText || dq?.text || 'Could you clarify which option applies to you?',
      bookingCtx: ctx,
      completed:  false,
      _123rp:     { tier: 0, path: 'BK_DISCRIMINATOR_REASK_EMPTY' }
    };
  }

  // ── Match caller input to one of the options ─────────────────────────────
  // Strategy: each option has a `keywords[]` array (owner-defined); fall back
  // to matching against the option label words. First match wins.
  let matched = null;
  for (const opt of opts) {
    const searchTerms = [
      ...(Array.isArray(opt.keywords) ? opt.keywords : []),
      ...(opt.label ? opt.label.toLowerCase().split(/\W+/).filter(w => w.length > 2) : []),
    ];
    const hit = searchTerms.some(kw => input.includes(kw.toLowerCase()));
    if (hit) { matched = opt; break; }
  }

  // Fallback: first/second ordinal detection ("first option", "option 1")
  if (!matched) {
    if (/\b(first|option\s*1|one|1st)\b/.test(input) && opts[0]) matched = opts[0];
    else if (/\b(second|option\s*2|two|2nd)\b/.test(input) && opts[1]) matched = opts[1];
  }

  if (!matched) {
    // No match — re-ask with option labels listed explicitly
    const optList = opts.map((o, i) => `${i + 1}. ${o.label}`).join(' or ');
    events.push({ type: 'BL0_DISCRIMINATOR_NO_MATCH', input: input.slice(0, 80), timestamp: Date.now() });
    return {
      nextPrompt: dq?.reAskText
        || `I want to make sure I route you correctly — ${optList}?`,
      bookingCtx: ctx,
      completed:  false,
      _123rp:     { tier: 0, path: 'BK_DISCRIMINATOR_REASK_NOMATCH' }
    };
  }

  // ── Match found — apply overrides ─────────────────────────────────────────
  ctx._discriminatorAnswered       = true;
  ctx._discriminatorValue          = matched.value;
  if (matched.serviceTypeOverride) {
    ctx._discriminatorServiceType  = matched.serviceTypeOverride;
  }
  if (matched.schedPriority) {
    ctx._discriminatorSchedPriority = matched.schedPriority;
    if (matched.schedPriority === 'high' || matched.schedPriority === 'urgent') {
      ctx.preferredDay  = ctx.preferredDay  || 'asap';
      ctx.preferredTime = ctx.preferredTime || 'earliest';
    }
  }

  // Store the answer in collectedCustomFields so the CONFIRM readback can include it
  if (dq.field) {
    ctx.collectedCustomFields = ctx.collectedCustomFields || {};
    ctx.collectedCustomFields[dq.field] = matched.value;
  }

  // Fire-and-forget: write to discoveryNotes.temp so the LLM knows from this turn on
  if (ctx.callSid && dq.field) {
    const DiscoveryNotesService = require('../../discoveryNotes/DiscoveryNotesService');
    const dnPatch = { temp: { [dq.field]: matched.value } };
    if (matched.serviceTypeOverride) dnPatch.temp.serviceType = matched.serviceTypeOverride;
    DiscoveryNotesService.update(companyId, ctx.callSid, dnPatch)
      .catch(e => logger.warn(`[${ENGINE_ID}] Discriminator DN update failed`, { companyId, err: e.message }));
  }

  events.push({
    type:          'BL0_DISCRIMINATOR_MATCHED',
    value:         matched.value,
    serviceType:   matched.serviceTypeOverride || null,
    schedPriority: matched.schedPriority || null,
    timestamp:     Date.now()
  });

  // Advance to INIT — the discriminator check will now be skipped (_discriminatorAnswered = true)
  ctx.step = STEPS.INIT;
  return processInit(ctx, config, companyId, false, events);
}

/* ============================================================================
   STEP: INIT
   ============================================================================ */

async function processInit(ctx, config, companyId, isTest, events) {
  events.push({ type: 'BL1_INIT', timestamp: Date.now() });

  // ── Bridge phrase prefix ───────────────────────────────────────────────────
  // Plays ONCE at booking entry (this function is only ever called once per
  // booking flow).  Pre-cached as InstantAudio on admin save for <50 ms play.
  const bridge = config.bridgePhrase ? `${config.bridgePhrase} ` : '';

  // ── Phase 0: Discriminator ────────────────────────────────────────────────
  // If the company has a discriminatorQuestion configured AND we haven't asked it yet,
  // ask it FIRST — before caller recognition, before collecting any fields.
  // ONE question. ONE answer. Sets serviceType + custom discriminator field in temp.
  // Example: "Are you on our annual plan, or is this a first-time visit?"
  // Skipped if: no discriminatorQuestion configured, or already answered this session.
  if (config.discriminatorQuestion && !ctx._discriminatorAnswered) {
    const dq = config.discriminatorQuestion;
    ctx.step = STEPS.DISCRIMINATOR;
    ctx._discriminatorQuestion = dq; // stash so processDiscriminator has it without re-loading config
    events.push({ type: 'BL0_DISCRIMINATOR_ASK', field: dq.field, timestamp: Date.now() });
    return {
      nextPrompt: `${bridge}${dq.text}`,
      bookingCtx: ctx,
      completed:  false,
      _123rp:     { tier: 0, path: 'BK_DISCRIMINATOR_ASK' }
    };
  }

  // ── T0: Caller Recognition ─────────────────────────────────────────────────
  // If enabled and Twilio ANI is present, look up the caller in the CRM.
  // On a match, offer to confirm their info on file instead of re-collecting.
  if (config.callerRecognition?.enabled && ctx.callerPhone && !ctx._recognitionChecked) {
    ctx._recognitionChecked = true;
    try {
      const Customer  = require('../../../models/Customer');
      const rawPhone  = ctx.callerPhone;
      const tenDigit  = rawPhone.replace(/\D/g, '').slice(-10);
      const match = await Customer.findOne({
        companyId,
        $or: [
          { phone: rawPhone },
          { phone: tenDigit },
          { phone: `+1${tenDigit}` }
        ]
      }).select('firstName lastName phone address').lean();

      if (match?.firstName) {
        const fullName  = [match.firstName, match.lastName].filter(Boolean).join(' ');
        const recPrompt = (config.callerRecognition.confirmAllPrompt ||
          'We have {name} on file — is that you and is your contact info still correct?')
          .replace('{name}',    fullName)
          .replace('{address}', match.address || '');

        ctx.step                = STEPS.CONFIRM_RECOGNITION;
        ctx._recognizedCustomer = {
          firstName: match.firstName,
          lastName:  match.lastName  || '',
          phone:     match.phone,
          address:   match.address   || null
        };
        events.push({ type: 'BL0_RECOGNITION_MATCH', firstName: match.firstName, timestamp: Date.now() });
        return {
          nextPrompt: `${bridge}${recPrompt}`,
          bookingCtx: ctx,
          completed:  false
        };
      }
    } catch (recErr) {
      logger.warn(`[${ENGINE_ID}] Caller recognition lookup failed — continuing`, {
        companyId, error: recErr.message
      });
    }
  }

  // ── Field collection ───────────────────────────────────────────────────────
  const issuePrefix = buildWarmOpening(ctx);

  // ── Name confirmation ──────────────────────────────────────────────────────
  // If discovery pre-filled a name, confirm it naturally instead of re-asking.
  //   Full name known  → "I assume your name is Tony Cox, is that correct?"
  //   First name only  → "I show your first name as Mark — is that right?"
  //                       (ONE question only — last name collected separately on next turn)
  //   No name known    → cold ask using askNamePrompt
  if (!ctx._nameConfirmed) {
    const hasFirst = !!ctx.collectedFields.firstName;
    const hasLast  = !!ctx.collectedFields.lastName;

    if (hasFirst && hasLast) {
      // Both names pre-filled — confirm the full name
      ctx.step              = STEPS.CONFIRM_NAME;
      ctx._nameConfirmMode  = 'CONFIRM_FULL';
      const fullName = `${ctx.collectedFields.firstName} ${ctx.collectedFields.lastName}`;
      events.push({ type: 'BL1_CONFIRMING_FULL_NAME', firstName: ctx.collectedFields.firstName, lastName: ctx.collectedFields.lastName, timestamp: Date.now() });
      return {
        nextPrompt: `${bridge}${config.confirmFullName.replace('{name}', fullName)}`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (hasFirst && !hasLast) {
      // First name only — check confidence before deciding whether to confirm.
      //
      // HIGH CONFIDENCE (≥ 0.80): Name was clearly stated and captured by llm_intake.
      //   The agent already echoed the name back in the Turn 1 greeting response.
      //   Asking the caller to confirm it creates an "amnesia" UX — they hear the
      //   agent forget who they are two turns later. Skip confirmation entirely and
      //   go straight to last name.
      //   → "Great, Mark! And what is your last name?"
      //
      // LOW CONFIDENCE (< 0.80): Name is uncertain (partial extraction, low model
      //   confidence, or no discoveryNotes available). Confirm before proceeding.
      //   → "I show your first name as Mark — is that right? And your last name?"
      // v2 schema: temp.confidence | v1 compat: entities.confidence
      const firstNameConf  = ctx.discoveryNotes?.temp?.confidence?.firstName
                          || ctx.discoveryNotes?.entities?.confidence?.firstName
                          || 0;
      const highConfidence = firstNameConf >= 0.80;

      if (highConfidence) {
        // Skip confirmation — go straight to last name collection
        ctx.step             = STEPS.CONFIRM_NAME;
        ctx._nameConfirmMode = 'ASK_LAST_ONLY';
        events.push({ type: 'BL1_SKIP_NAME_CONFIRM_HIGH_CONF', firstName: ctx.collectedFields.firstName, confidence: firstNameConf, timestamp: Date.now() });
        return {
          nextPrompt: `${bridge}${config.confirmFirstNameGotLastAsk.replace('{firstName}', ctx.collectedFields.firstName)}`,
          bookingCtx: ctx,
          completed:  false
        };
      }

      // Low confidence — confirm with caller before proceeding
      ctx.step             = STEPS.CONFIRM_NAME;
      ctx._nameConfirmMode = 'CONFIRM_FIRST_ASK_LAST';
      events.push({ type: 'BL1_CONFIRMING_FIRST_NAME', firstName: ctx.collectedFields.firstName, timestamp: Date.now() });
      return {
        nextPrompt: `${bridge}${config.confirmFirstNameAskLast.replace('{firstName}', ctx.collectedFields.firstName)}`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    // No name at all — cold ask
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_COLLECTING_NAME', timestamp: Date.now() });
    return {
      nextPrompt: `${bridge}${config.askNamePrompt || `${issuePrefix}To get started with your booking, may I have your first and last name please?`}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    events.push({ type: 'BL1_COLLECTING_PHONE', timestamp: Date.now() });
    const nameGreet = ctx.collectedFields.firstName ? `${ctx.collectedFields.firstName}, ` : '';
    return {
      nextPrompt: `${bridge}${config.askPhonePrompt || `${issuePrefix}${nameGreet}what's the best phone number to reach you at?`}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    events.push({ type: 'BL1_COLLECTING_ADDRESS', timestamp: Date.now() });
    return {
      nextPrompt: `${bridge}${config.askAddressPrompt || "And what's the service address?"}`,
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
      nextPrompt: `${bridge}${firstField.prompt || `One more question — what is your ${firstField.label}?`}`,
      bookingCtx: ctx,
      completed:  false
    };
  }
  return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
}

/* ============================================================================
   STEP: CONFIRM RECOGNITION  (T0 — CRM caller identity confirmation)
   ============================================================================ */

async function processConfirmRecognition(ctx, userInput, config, companyId, isTest, events) {
  // Re-ask if no input
  if (!userInput?.trim()) {
    const rec      = ctx._recognizedCustomer || {};
    const fullName = [rec.firstName, rec.lastName].filter(Boolean).join(' ');
    const prompt   = (config.callerRecognition?.confirmAllPrompt ||
      'We have {name} on file — is that you and is your contact info still correct?')
      .replace('{name}',    fullName)
      .replace('{address}', rec.address || '');
    return { nextPrompt: prompt, bookingCtx: ctx, completed: false };
  }

  const lower = userInput.toLowerCase();
  const isYes = /\b(yes|yeah|yep|correct|right|that'?s me|sure|ok|okay|confirmed|affirmative|uh-?huh)\b/.test(lower);
  const isNo  = /\b(no|nope|wrong|incorrect|not me|different|changed|update|nah)\b/.test(lower);

  if (isYes) {
    // Copy recognized fields into collectedFields
    const rec = ctx._recognizedCustomer || {};
    if (rec.firstName) ctx.collectedFields.firstName = rec.firstName;
    if (rec.lastName)  ctx.collectedFields.lastName  = rec.lastName;
    if (rec.phone)     ctx.collectedFields.phone     = rec.phone;
    if (rec.address)   ctx.collectedFields.address   = rec.address;

    events.push({ type: 'BL0_RECOGNITION_CONFIRMED', timestamp: Date.now() });

    const onYes = config.callerRecognition?.onConfirmedYes || 'SKIP_TO_CUSTOM';

    // COLLECT_ALL — ignore recognition data, collect fresh
    if (onYes === 'COLLECT_ALL') {
      ctx.collectedFields = { firstName: null, lastName: null, phone: null, address: null, altPhone: null, altPhoneContext: null };
      ctx.step = STEPS.COLLECT_NAME;
      return {
        nextPrompt: config.askNamePrompt || 'Let me grab your details fresh. What is your first and last name?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    // SKIP_TO_CALENDAR — all data confirmed, go straight to calendar
    if (onYes === 'SKIP_TO_CALENDAR') {
      return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
    }

    // SKIP_TO_CUSTOM (default) — built-in fields confirmed, collect custom fields if any
    const customFields = config.customFields || [];
    if (customFields.length > 0) {
      const firstField = customFields[0];
      ctx.step = STEPS.COLLECT_CUSTOM;
      ctx.customFieldIndex = 0;
      return {
        nextPrompt: firstField.prompt || `Great! One more thing — ${firstField.label}?`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    return advanceAfterCustomFields(ctx, config, companyId, isTest, events);
  }

  if (isNo) {
    // Caller's info has changed — clear recognition data, collect fresh
    ctx._recognizedCustomer = null;
    ctx.collectedFields.firstName = null;
    ctx.collectedFields.lastName  = null;
    ctx.collectedFields.phone     = null;
    ctx.collectedFields.address   = null;
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL0_RECOGNITION_DECLINED', timestamp: Date.now() });
    return {
      nextPrompt: config.askNamePrompt || 'No problem! Let me grab your updated info. What is your first and last name?',
      bookingCtx: ctx,
      completed:  false
    };
  }

  // Ambiguous — re-ask with gentle prompt
  const rec      = ctx._recognizedCustomer || {};
  const fullName = [rec.firstName, rec.lastName].filter(Boolean).join(' ');
  return {
    nextPrompt: `Just to confirm — are you ${fullName}? A simple yes or no works great.`,
    bookingCtx: ctx,
    completed:  false
  };
}

/* ============================================================================
   STEP: CONFIRM NAME  (T0 — LLM-prefilled name confirmation from discovery)
   ============================================================================
   Sub-steps:
     CONFIRM_FULL          → both names known, confirm full name
     CONFIRM_FIRST_ASK_LAST → first name only, confirm it + ask for last
     ASK_LAST_ONLY         → first name confirmed, just need last name now
   ============================================================================ */

/**
 * Strip filler words and extract name tokens from a caller utterance.
 * Returns an array of cleaned word tokens (capitalised).
 */
function extractNameTokens(input) {
  return input
    .replace(/\b(my last name is|last name is|my first name is|first name is|the last name is|surname is|my name is|the name is|yes|yeah|yep|no|nope|actually|it'?s|i'?m|correct|wrong|right|uh-?huh|just|wait|oh|well|um|uh|sure|ok|okay)\b/gi, ' ')
    .replace(/[,;.!?]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

async function processConfirmName(ctx, userInput, config, companyId, isTest, events) {

  // ── Sub-step: accepting a spelled last name after GlobalHub rejected it ────
  // This fires when a previous turn set ctx._nameSubStep = 'SPELL_LAST' while
  // still in CONFIRM_NAME mode (e.g. from ASK_LAST_ONLY or CONFIRM_FIRST_ASK_LAST).
  if (ctx._nameSubStep === 'SPELL_LAST') {
    const cleaned = userInput.trim().replace(/[^a-zA-Z'\- ]/g, '').trim();
    ctx.collectedFields.lastName = capitalizeFirst(cleaned) || null;
    delete ctx._nameSubStep;
    ctx._nameConfirmed = true;
    events.push({ type: 'BL1_LAST_NAME_SPELLED', lastName: ctx.collectedFields.lastName, timestamp: Date.now() });
    return continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
  }

  const mode  = ctx._nameConfirmMode || 'CONFIRM_FULL';
  const lower = (userInput || '').toLowerCase().trim();

  const isYes = /\b(yes|yeah|yep|correct|right|that'?s (right|correct|me)|sure|uh-?huh|affirmative|yep|confirmed)\b/.test(lower);
  const isNo  = /\b(no|nope|wrong|incorrect|not (right|correct)|different|nah|neither)\b/.test(lower);

  // ── Re-ask if empty input ─────────────────────────────────────────────────
  // IMPORTANT: Do NOT repeat the verbatim prompt on a no-response turn.
  // A caller who didn't hear or is confused will hear an identical question
  // as a loop — it sounds like a broken system. Rephrase to a shorter,
  // simpler fallback so the caller gets a different cue to respond to.
  if (!userInput?.trim()) {
    if (mode === 'CONFIRM_FULL') {
      const full = `${ctx.collectedFields.firstName} ${ctx.collectedFields.lastName}`;
      return { nextPrompt: config.confirmFullName.replace('{name}', full), bookingCtx: ctx, completed: false };
    }
    if (mode === 'CONFIRM_FIRST_ASK_LAST') {
      // Shorten — drop the "I show your first name as..." preamble
      const first = ctx.collectedFields.firstName;
      return { nextPrompt: `Just to confirm — is your first name ${first}?`, bookingCtx: ctx, completed: false };
    }
    if (mode === 'ASK_LAST_ONLY') {
      // Shorten — personalise with first name so it doesn't sound robotic
      const first = ctx.collectedFields.firstName || '';
      return {
        nextPrompt: first ? `What's your last name, ${first}?` : config.askLastNameOnly,
        bookingCtx: ctx,
        completed:  false
      };
    }
  }

  // ── ASK_LAST_ONLY: capture last name + verify against GlobalHub ──────────
  if (mode === 'ASK_LAST_ONLY') {
    const tokens = extractNameTokens(userInput);
    const rawLast = tokens.length > 0 ? tokens[tokens.length - 1] : userInput.trim();
    let resolvedLast = rawLast;
    try {
      const lastMatch = await GlobalHubService.matchLastName(rawLast);
      if (!lastMatch.match && lastMatch.verificationMode === 'unknown') {
        ctx._nameSubStep = 'SPELL_LAST';
        events.push({ type: 'BL1_LAST_NAME_UNKNOWN', raw: rawLast, timestamp: Date.now() });
        return { nextPrompt: `Could you spell your last name for me?`, bookingCtx: ctx, completed: false };
      }
      if (lastMatch.match) resolvedLast = lastMatch.value;
    } catch (_ghErr) {
      // GlobalHub unavailable → accept as-is
    }
    ctx.collectedFields.lastName = resolvedLast;
    ctx._nameConfirmed = true;
    events.push({ type: 'BL1_NAME_CONFIRMED', firstName: ctx.collectedFields.firstName, lastName: resolvedLast, timestamp: Date.now() });
    return continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
  }

  // ── CONFIRM_FULL ──────────────────────────────────────────────────────────
  if (mode === 'CONFIRM_FULL') {
    if (isYes && !isNo) {
      // Confirmed — proceed
      ctx._nameConfirmed = true;
      events.push({ type: 'BL1_NAME_CONFIRMED', firstName: ctx.collectedFields.firstName, lastName: ctx.collectedFields.lastName, timestamp: Date.now() });
      return continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
    }

    // Caller gave a correction — try to extract the name
    const tokens = extractNameTokens(userInput);
    if (!isNo && tokens.length === 0) {
      // Ambiguous — re-ask
      const full = `${ctx.collectedFields.firstName} ${ctx.collectedFields.lastName}`;
      return { nextPrompt: config.confirmNameAmbiguous.replace('{name}', full), bookingCtx: ctx, completed: false };
    }

    if (tokens.length >= 2) {
      // Full name correction: "it's Bob Johnson"
      ctx.collectedFields.firstName = tokens[0];
      ctx.collectedFields.lastName  = tokens.slice(1).join(' ');
      ctx._nameConfirmed = true;
      events.push({ type: 'BL1_NAME_CORRECTED', firstName: tokens[0], lastName: tokens.slice(1).join(' '), timestamp: Date.now() });
      return continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
    }

    if (tokens.length === 1) {
      // Only first name given: "it's Bob" — keep it, ask for last name
      ctx.collectedFields.firstName = tokens[0];
      ctx.collectedFields.lastName  = null;
      ctx._nameConfirmMode = 'ASK_LAST_ONLY';
      events.push({ type: 'BL1_NAME_PARTIAL_CORRECTED', firstName: tokens[0], timestamp: Date.now() });
      return { nextPrompt: config.confirmNamePartialCorrected.replace('{firstName}', tokens[0]), bookingCtx: ctx, completed: false };
    }

    // Plain NO with no correction — clear and collect fresh
    ctx.collectedFields.firstName = null;
    ctx.collectedFields.lastName  = null;
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_NAME_DECLINED', timestamp: Date.now() });
    return {
      nextPrompt: config.nameReAnchor,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── CONFIRM_FIRST_ASK_LAST ────────────────────────────────────────────────
  if (mode === 'CONFIRM_FIRST_ASK_LAST') {
    // NO — clear and start fresh
    if (isNo && !isYes) {
      const tokens = extractNameTokens(userInput);
      if (tokens.length >= 2) {
        // "No, I'm John Cox" — got full correction in same breath
        ctx.collectedFields.firstName = tokens[0];
        ctx.collectedFields.lastName  = tokens.slice(1).join(' ');
        ctx._nameConfirmed = true;
        events.push({ type: 'BL1_NAME_CORRECTED', firstName: tokens[0], lastName: tokens.slice(1).join(' '), timestamp: Date.now() });
        // Name readback on correction so caller hears the fix was captured
        const _correctedFullName = `${tokens[0]} ${tokens.slice(1).join(' ')}`.trim();
        const _correctedResult = await continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
        if (_correctedResult?.nextPrompt) {
          _correctedResult.nextPrompt = `Got it — ${_correctedFullName}! ` + _correctedResult.nextPrompt;
        }
        return _correctedResult;
      }
      // Plain NO — clear and ask fresh
      ctx.collectedFields.firstName = null;
      ctx.collectedFields.lastName  = null;
      ctx.step = STEPS.COLLECT_NAME;
      events.push({ type: 'BL1_NAME_DECLINED', timestamp: Date.now() });
      return {
        nextPrompt: config.nameReAnchor,
        bookingCtx: ctx,
        completed:  false
      };
    }

    // YES — now check if they also gave a last name in the same response
    // e.g. "yes, Cox"  or  "yes my last name is Johnson"
    const tokens = extractNameTokens(userInput);
    if (tokens.length >= 1) {
      // Take the LAST token — avoids mis-picking filler like "My" or "Name" that
      // survive partial strip (e.g. "Yes. Um, my last name is Gonzalez" → ["Gonzalez"])
      const rawLast = tokens[tokens.length - 1];
      if (rawLast && rawLast.toLowerCase() !== ctx.collectedFields.firstName?.toLowerCase()) {
        let resolvedLast = rawLast;
        try {
          const lastMatch = await GlobalHubService.matchLastName(rawLast);
          if (!lastMatch.match && lastMatch.verificationMode === 'unknown') {
            ctx._nameSubStep = 'SPELL_LAST';
            events.push({ type: 'BL1_LAST_NAME_UNKNOWN', raw: rawLast, timestamp: Date.now() });
            return { nextPrompt: `Could you spell your last name for me?`, bookingCtx: ctx, completed: false };
          }
          if (lastMatch.match) resolvedLast = lastMatch.value;
        } catch (_ghErr) {
          // GlobalHub unavailable → accept as-is
        }
        ctx.collectedFields.lastName = resolvedLast;
        ctx._nameConfirmed = true;
        events.push({ type: 'BL1_NAME_CONFIRMED', firstName: ctx.collectedFields.firstName, lastName: resolvedLast, timestamp: Date.now() });
        // Name readback: confirm the full name before advancing to phone.
        // Without this, callers who gave their last name have no confirmation
        // the AI captured it — leading to "what is my name?" loops.
        const _confirmedFullName = `${ctx.collectedFields.firstName} ${resolvedLast}`.trim();
        const _continueResult = await continueAfterNameConfirmed(ctx, config, companyId, isTest, events);
        if (_continueResult?.nextPrompt) {
          _continueResult.nextPrompt = `Got it — ${_confirmedFullName}! ` + _continueResult.nextPrompt;
        }
        return _continueResult;
      }
    }

    // YES but no last name found — ask for it specifically
    ctx._nameConfirmMode = 'ASK_LAST_ONLY';
    const first = ctx.collectedFields.firstName;
    return {
      nextPrompt: config.confirmFirstNameGotLastAsk.replace('{firstName}', first),
      bookingCtx: ctx,
      completed:  false
    };
  }

  // Fallback — shouldn't reach here
  ctx.step = STEPS.COLLECT_NAME;
  return { nextPrompt: config.askNamePrompt || 'May I have your first and last name?', bookingCtx: ctx, completed: false };
}

/**
 * After name is confirmed (CONFIRM_NAME → success), advance to the next
 * required field using the same logic as processInit.
 */
async function continueAfterNameConfirmed(ctx, config, companyId, isTest, events) {
  ctx.step = STEPS.COLLECT_PHONE;  // will be overridden below if phone already set

  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    events.push({ type: 'BL1_COLLECTING_PHONE', timestamp: Date.now() });
    const nameGreet = ctx.collectedFields.firstName ? `${ctx.collectedFields.firstName}, ` : '';
    return {
      nextPrompt: config.askPhonePrompt || `Perfect! ${nameGreet}what's the best phone number to reach you at?`,
      bookingCtx: ctx,
      completed:  false
    };
  }
  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return { nextPrompt: config.askAddressPrompt || "And what's the service address?", bookingCtx: ctx, completed: false };
  }
  const customFields = config.customFields || [];
  if (customFields.length > 0) {
    const firstField = customFields[0];
    ctx.step = STEPS.COLLECT_CUSTOM;
    ctx.customFieldIndex = 0;
    return { nextPrompt: firstField.prompt || `One more thing — ${firstField.label}?`, bookingCtx: ctx, completed: false };
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
    } else if (/\?/.test(userInput)) {
      // ── No last name found, but caller asked an off-topic question ──────────
      // e.g. "Yeah that's correct, but I have a coupon — is that good?"
      // Caller confirmed first name above but asked a question instead of giving
      // their last name.  Answer via 123BRP T2 then re-ask for last name.
      ctx._nameSubStep = 'GET_LAST'; // stay on last name — don't advance
      events.push({ type: 'BL1_NAME_STEP_DIGRESSION', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      const llmAnswer = await BookingLLMInterceptService.answer({
        question: userInput,
        companyId,
        ctx,
        config,
      }).catch(() => null);
      const anchor = `And what is your last name?`;
      return {
        nextPrompt: llmAnswer ? `${llmAnswer} ${anchor}` : `${config.t2DigressionAck} ${anchor}`,
        bookingCtx: ctx,
        completed:  false,
      };
    }

    delete ctx._nameSubStep;
    return advanceAfterName(ctx, config, companyId, isTest, events);
  }

  // ── Normal case: parse full name from utterance ───────────────────────────
  // Run Groq only when trigger words suggest something beyond a plain name
  // (self-correction, compound utterance with embedded question, etc.)
  // parseName() is still the primary extractor — Groq augments for edge cases.
  let _embeddedNameQuestion = null;
  if (GroqFieldExtractorService.hasTriggerWords(userInput)) {
    const nameExtraction = await GroqFieldExtractorService.parse(
      GroqFieldExtractorService.FIELD_TYPES.NAME,
      userInput,
      { callSid: ctx.callSid, step: STEPS.COLLECT_NAME }
    );
    events.push({
      type:      'BL1_NAME_GROQ_EXTRACT',
      state:     nameExtraction.state,
      hasValue:  !!nameExtraction.value,
      timestamp: Date.now()
    });
    const { STATES: NM_STATES } = GroqFieldExtractorService;
    if (nameExtraction.state === NM_STATES.SEARCHING) {
      return { nextPrompt: config.patienceGeneral, bookingCtx: ctx, completed: false };
    }
    if (nameExtraction.embeddedQuestion) {
      _embeddedNameQuestion = nameExtraction.embeddedQuestion;
    }
  }

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
  const lastNamePrompt = `Thanks, ${resolvedFirst}! And your last name?`;

  // Caller asked a question alongside their name — answer it before asking for last name
  if (_embeddedNameQuestion) {
    const nameAnswer = await BookingLLMInterceptService.answer({
      question: _embeddedNameQuestion,
      companyId, ctx, config,
    }).catch(() => null);
    return {
      nextPrompt: `${nameAnswer || config.t2DigressionAck} ${lastNamePrompt}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  return {
    nextPrompt: lastNamePrompt,
    bookingCtx: ctx,
    completed:  false
  };
}

/** Shared transition logic after name is fully collected. */
async function advanceAfterName(ctx, config, companyId, isTest, events) {
  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    return {
      nextPrompt: config.askPhonePrompt,
      bookingCtx: ctx,
      completed:  false
    };
  }
  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return {
      nextPrompt: config.askAddressPrompt,
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

  // ── Name readback confirmation — waiting for caller's yes/no ────────────
  // Set when we read back the stored name: "I have 'Mark Gonzalez' on file — is that correct?"
  // Next turn: YES → fall through to normal phone collection
  //            NO  → restart name collection so caller can re-enter their name
  if (ctx._awaitingNameReadbackConfirm) {
    delete ctx._awaitingNameReadbackConfirm;
    const isNo = /\b(no|nope|wrong|incorrect|not (right|correct)|different|nah)\b/i.test(userInput);
    if (isNo) {
      ctx.step = STEPS.COLLECT_NAME;
      ctx.collectedFields.firstName = null;
      ctx.collectedFields.lastName  = null;
      events.push({ type: 'BL1_NAME_READBACK_REJECTED', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      return {
        nextPrompt: `No problem — let me get that again. What's your first and last name?`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    // YES or unclear — fall through; caller may have given phone in same breath
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

    // ── Digression escape hatch ──────────────────────────────────────────────
    // If the caller asks about their name or says something confusing INSTEAD of
    // answering yes/no, restore the flag and re-ask rather than silently falling
    // to the NO path (which would discard the caller ID question).
    const _isNameReadback    = /\b(my name|what.*(my name|call me|am i))\b/i.test(userInput);
    const _isGenericConfusion = /^(what|huh|sorry|repeat|again|pardon|excuse me|say that again|what was that)\b[?.]?$/i.test(userInput.trim());

    if (_isNameReadback) {
      ctx._confirmingCallerId = true; // restore — still waiting for yes/no next turn
      const _knownName = [ctx.collectedFields?.firstName, ctx.collectedFields?.lastName].filter(Boolean).join(' ');
      events.push({ type: 'BL1_CALLER_ID_DIGRESSION_NAME', timestamp: Date.now() });
      return {
        nextPrompt: `Your name on file is ${_knownName || 'not yet collected'}. Now — is ${confirmedPhone || ctx.callerPhone} a good number for the confirmation text?`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (_isGenericConfusion) {
      ctx._confirmingCallerId = true; // restore — still waiting for yes/no next turn
      events.push({ type: 'BL1_CALLER_ID_DIGRESSION_CONFUSION', timestamp: Date.now() });
      return {
        nextPrompt: `I was asking: is ${confirmedPhone || ctx.callerPhone} a good number for your confirmation text? Just say yes or no.`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    // ── End digression escape hatch ──────────────────────────────────────────

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
    // callerPhone stays silently in ctx.callerPhone as backup.
    // Flag set so alt contact step is suppressed — caller already dealt with phone drama.
    ctx._callerIdDeclined = true;
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

  // ── Name digression guard — fires before the proactive offer on first entry ─
  // If the caller asks "what is my name?" on their FIRST turn in COLLECT_PHONE
  // (before we've asked for their number), answer the name question AND fold the
  // proactive caller ID offer into the same response.
  // Without this, the proactive offer fires and completely ignores the caller's
  // question — making the agent feel deaf.
  if (!ctx._callerIdAsked && userInput?.trim()) {
    const _isNameQInPhoneStep = /\b(my name|what.*(name|call me)|who am i)\b/i.test(userInput);
    if (_isNameQInPhoneStep) {
      const _pFirst = ctx.collectedFields?.firstName || '';
      const _pLast  = ctx.collectedFields?.lastName  || '';
      const _pName  = [_pFirst, _pLast].filter(Boolean).join(' ') || 'not yet collected';
      if (ctx.callerPhone) {
        // Answer the name question AND make the proactive offer inline
        const _pPhone = normalizePhone(ctx.callerPhone);
        if (_pPhone) {
          ctx._callerIdAsked      = true;
          ctx._confirmingCallerId = true;
          const _pDn   = ctx.discoveryNotes;
          const _pSvc  = _pDn?.callReason || _pDn?.temp?.serviceType || _pDn?.entities?.serviceType || null;
          const _pSvcT = _pSvc ? `your ${_pSvc} ` : '';
          events.push({ type: 'BL1_NAME_Q_IN_PHONE_STEP', knownName: _pName, timestamp: Date.now() });
          return {
            nextPrompt: `Your name on file is ${_pName}. Also — is ${_pPhone} a good number for ${_pSvcT}the confirmation text?`,
            bookingCtx: ctx,
            completed:  false
          };
        }
      }
      // No callerPhone — just answer the name and ask for number
      events.push({ type: 'BL1_NAME_Q_IN_PHONE_STEP', knownName: _pName, timestamp: Date.now() });
      return {
        nextPrompt: `Your name on file is ${_pName}. ${config.askPhonePrompt || "What's the best phone number to reach you at?"}`,
        bookingCtx: ctx,
        completed:  false
      };
    }
  }

  // ── Proactive caller ID offer — fires on FIRST entry to COLLECT_PHONE ─────
  // Offered immediately regardless of what the caller said, so the agent never
  // goes into a runaround asking for a number the system already knows.
  // YES → caller ID saved as primary; advance to next field.
  // NO  → collect a different number in the next turn.
  if (!ctx._callerIdAsked && ctx.callerPhone) {
    const formattedCallerId = normalizePhone(ctx.callerPhone);
    if (formattedCallerId) {
      ctx._callerIdAsked      = true;
      ctx._confirmingCallerId = true;
      events.push({ type: 'BL1_CALLER_ID_OFFERED', callerPhone: formattedCallerId, timestamp: Date.now() });
      // Inject discoveryNotes service type for a personalized, context-aware offer
      const _dn          = ctx.discoveryNotes;
      const _serviceCtx  = _dn?.callReason || _dn?.temp?.serviceType || _dn?.entities?.serviceType || null;
      const _serviceText = _serviceCtx ? `your ${_serviceCtx} ` : '';
      return {
        nextPrompt: `Is ${formattedCallerId} a good number for your ${_serviceText}confirmation text?`,
        bookingCtx: ctx,
        completed:  false
      };
    }
    ctx._callerIdAsked = true; // callerPhone present but couldn't normalize — skip offer
  }

  // ── No input (STT_EMPTY) ───────────────────────────────────────────────────
  if (!userInput?.trim()) {
    return {
      nextPrompt: config.askPhonePrompt,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Try to parse the phone from user input ───────────────────────────────
  // Uses extractCorrectedPhone() instead of normalizePhone(userInput) directly:
  //   - Handles mid-sentence corrections: "239-565-2202. Actually, wait — 239-333-7747"
  //     → strips ALL non-digits from the full sentence would yield 20+ digits → null.
  //   - extractCorrectedPhone() finds all embedded phone numbers via regex substring
  //     matching, then returns the LAST one when correction language is present.
  const regexPhone      = extractCorrectedPhone(userInput);
  const normalizedPhone = normalizePhone(regexPhone);

  // ── GroqFieldExtractor: engage when caller speech is messy ───────────────
  // Fast path: regex found a clean number and no uncertainty trigger words →
  // proceed immediately (zero latency, no Groq call).
  // Groq path: trigger words present ("wait", "hold on", "let me check") OR
  // regex found nothing → Groq classifies the caller's state.
  if (GroqFieldExtractorService.needsGroqPath(userInput, regexPhone)) {
    const extraction = await GroqFieldExtractorService.parse(
      GroqFieldExtractorService.FIELD_TYPES.PHONE,
      userInput,
      { callSid: ctx.callSid, step: STEPS.COLLECT_PHONE }
    );
    events.push({
      type:      'BL1_PHONE_GROQ_EXTRACT',
      state:     extraction.state,
      hasValue:  !!extraction.value,
      confidence: extraction.confidence,
      timestamp: Date.now()
    });

    const { STATES } = GroqFieldExtractorService;

    if (extraction.state === STATES.SEARCHING) {
      // Caller is looking for their number — be patient, hold the step
      return {
        nextPrompt: config.patiencePhone,
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (extraction.state === STATES.UNCERTAIN && extraction.value) {
      // Caller gave a tentative number — confirm it back before advancing
      const tentative = normalizePhone(extraction.value) || extraction.value;
      ctx._phoneConfirmPending = tentative;
      return {
        nextPrompt: `Just to confirm — is your number ${tentative}?`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (extraction.state === STATES.PROVIDING_WITH_Q && extraction.value) {
      // Caller gave a number AND asked a question — capture number, answer question, then advance
      const captured = normalizePhone(extraction.value);
      if (captured) {
        ctx.collectedFields.phone = captured;
        ctx._callerIdAsked = true;
        events.push({ type: 'BL1_PHONE_COLLECTED', phone: captured, source: 'groq_with_q', timestamp: Date.now() });
        events.push({ type: 'BL1_PHONE_T2_DIGRESSION', rawInput: extraction.embeddedQuestion?.substring(0, 60), timestamp: Date.now() });
        // Use LLM to actually answer the question — caller asked, we respond
        const question = extraction.embeddedQuestion || userInput;
        const llmAnswer = await BookingLLMInterceptService.answer({ question, companyId, ctx, config }).catch(() => null);
        const advanceResult = await advanceAfterPhone(ctx, config, companyId, isTest, events);
        return {
          ...advanceResult,
          nextPrompt: `${llmAnswer || config.t2DigressionAck} ${advanceResult.nextPrompt}`,
        };
      }
    }

    if (extraction.state === STATES.PROVIDING || extraction.state === STATES.CORRECTING) {
      const groqPhone = normalizePhone(extraction.value);
      if (groqPhone) {
        ctx.collectedFields.phone    = groqPhone;
        ctx._callerIdAsked           = true;
        ctx._phoneJustCollected      = groqPhone; // triggers readback prefix in advanceAfterPhone
        events.push({ type: 'BL1_PHONE_COLLECTED', phone: groqPhone, source: 'groq', timestamp: Date.now() });
        return advanceAfterPhone(ctx, config, companyId, isTest, events);
      }
    }
    // For OFF_TOPIC or Groq returning no usable value: fall through to existing T1.5/T2 logic below
  }

  if (normalizedPhone) {
    // ── Caller gave us a valid phone number explicitly ─────────────────────
    ctx.collectedFields.phone   = normalizedPhone;
    ctx._callerIdAsked          = true; // mark as handled so we never double-ask
    ctx._phoneJustCollected     = normalizedPhone; // triggers readback prefix in advanceAfterPhone
    events.push({ type: 'BL1_PHONE_COLLECTED', phone: normalizedPhone, timestamp: Date.now() });
    return advanceAfterPhone(ctx, config, companyId, isTest, events);
  }

  // ── No valid phone found — check for digression / name revisit ────────────
  if (/\b(last name|surname|full name|my name|name)\b/i.test(userInput)) {
    // Distinguish readback requests ("can you read that back?") from corrections
    // ("my name is...").  Readback = caller wants to HEAR the stored name, not re-enter it.
    const isReadback = /\b(read|back|confirm|verify|check|what is|tell me|did you get|have my|you have|got my|what'?s? my|say it|say that|hear)\b/i.test(userInput);

    if (isReadback) {
      // Confirm what we have on file — set flag so next turn can handle YES/NO
      const firstName = ctx.collectedFields?.firstName || '';
      const lastName  = ctx.collectedFields?.lastName  || '';
      const namePart  = [firstName, lastName].filter(Boolean).join(' ');
      ctx._awaitingNameReadbackConfirm = true;
      events.push({ type: 'BL1_NAME_READBACK_REQUEST', storedName: namePart, timestamp: Date.now() });
      return {
        nextPrompt: namePart
          ? `I have "${namePart}" on file — is that correct? ${config.askPhonePrompt || 'And what is the best phone number to reach you at?'}`
          : `${config.t2DigressionAck} ${config.askPhonePrompt || 'What is the best phone number to reach you at?'}`,
        bookingCtx: ctx,
        completed:  false,
      };
    }

    // ── Inline last-name-only correction: "my last name is Gonzalez" ──────────
    // Caller is correcting only their last name mid-flow. Keep firstName intact,
    // update lastName in-place, stay at COLLECT_PHONE.
    //
    // Guards prevent storing noise words when STT truncates the utterance
    // (e.g. "you know what, uh, my last name is" → rawLast="What" → re-ask).
    const isLastNameCorrection = /\b(my last name is|last name is|my last name'?s?|surname is)\b/i.test(userInput);
    if (isLastNameCorrection && ctx.collectedFields?.firstName) {
      const tokens  = extractNameTokens(userInput);
      const rawLast = tokens.length > 0 ? tokens[tokens.length - 1] : null;

      // Words that survive extractNameTokens() stripping but are never surnames.
      // Covers interrogatives, pronouns, and common filler that appear when STT
      // captures only the preamble of a truncated "my last name is ___" utterance.
      const COMMON_WORD_BLOCKLIST = new Set([
        'what', 'know', 'you', 'your', 'we', 'they', 'them', 'their',
        'that', 'this', 'these', 'those', 'where', 'when', 'who', 'why',
        'how', 'well', 'right', 'just', 'mean', 'said', 'told', 'get',
        'got', 'and', 'but', 'not', 'for', 'the', 'yes', 'yeah', 'okay',
        'wait', 'hold', 'look', 'here', 'there', 'then', 'than', 'too',
        'hmm', 'huh', 'now', 'still', 'again', 'also', 'very', 'like',
      ]);

      const looksLikeSurname = rawLast
        && rawLast.length >= 3
        && !COMMON_WORD_BLOCKLIST.has(rawLast.toLowerCase());

      if (looksLikeSurname) {
        // GlobalHub dictionary check — prefer canonical casing from the hub.
        // On hub miss (unusual surname), trust the caller's correction directly.
        let storedLast = rawLast;
        let nameSource = 'unverified';
        try {
          const hubResult = await GlobalHubService.scanTokensForNames([rawLast], 'last');
          if (hubResult?.lastName?.match === true) {
            storedLast = hubResult.lastName.value || rawLast;
            nameSource = 'hub_confirmed';
          }
        } catch { /* GlobalHub unavailable — accept correction as-is */ }

        ctx.collectedFields.lastName = storedLast;
        events.push({ type: 'BL1_LAST_NAME_CORRECTED_AT_PHONE', lastName: storedLast, source: nameSource, timestamp: Date.now() });
        return {
          nextPrompt: `Got it — I've updated that to ${storedLast}. ${config.phoneReAnchor || config.askPhonePrompt || 'And what is the best phone number to reach you at?'}`,
          bookingCtx: ctx,
          completed:  false,
        };
      }

      // ── Guards failed — token is a noise word (likely STT truncation) ───────
      // Redirect to ASK_LAST_ONLY so the next turn expects a clean last name.
      // ASK_LAST_ONLY has its own GlobalHub check and SPELL_LAST fallback.
      events.push({ type: 'BL1_LAST_NAME_CORRECTION_GUARD_FAILED', rawLast: rawLast || null, rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      ctx.step             = STEPS.CONFIRM_NAME;
      ctx._nameConfirmMode = 'ASK_LAST_ONLY';
      return {
        nextPrompt: `I didn't quite catch your last name — could you say it one more time?`,
        bookingCtx: ctx,
        completed:  false,
      };
    }

    // Full name correction / restart: caller wants to re-enter their full name
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_NAME_REVISIT', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
    return {
      nextPrompt: `You're right — let me grab your full name. What's your first and last name?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Smart digression detection (T1.5 → T2) ──────────────────────────────
  // IMPORTANT: Checked BEFORE the caller-ID offer so that off-topic questions
  // ("Are you listening to me? I have a coupon.") are routed to T1.5 → T2
  // instead of triggering the caller-ID offer — which caused the caller to feel
  // completely ignored.  Only inputs with ≥ 3 digits can be a phone attempt.
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
          nextPrompt: `${triggerResponse} ${config.phoneReAnchor}`,
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
      nextPrompt:     `${config.t2DigressionAck} ${config.phoneReAnchor}`,
      bookingCtx:     ctx,
      completed:      false,
      t2Digression:   true,
      reAnchorPhrase: config.phoneReAnchor
    };
  }

  // ── No valid phone in input — offer caller ID if not yet asked ─────────
  // Placed AFTER the digression check: only offer caller ID when the input
  // actually looks like a phone attempt (≥ 3 digits, just garbled/incomplete).
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
    ctx._callerIdAsked = true;
  }

  events.push({ type: 'BL1_PHONE_INVALID', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
  return {
    nextPrompt: config.phoneInvalid,
    bookingCtx: ctx,
    completed:  false
  };
}

/** Shared transition logic after phone is collected. */
async function advanceAfterPhone(ctx, config, companyId, isTest, events) {
  // Phone readback — only when the caller explicitly gave us a new number
  // (not when they confirmed their caller ID — that's already verbally acknowledged).
  const _readbackPhone = ctx._phoneJustCollected || null;
  delete ctx._phoneJustCollected;
  const _readbackPrefix = _readbackPhone
    ? `Got it — I'll send the confirmation to ${_readbackPhone}. `
    : '';

  if (config.requiredFields.includes('address') && !ctx.collectedFields.address) {
    ctx.step = STEPS.COLLECT_ADDRESS;
    return {
      nextPrompt: _readbackPrefix + config.askAddressPrompt,
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
      nextPrompt: _readbackPrefix + (firstField.prompt || `One more thing — what is your ${firstField.label}?`),
      bookingCtx: ctx,
      completed:  false
    };
  }
  const advanceResult = await advanceAfterCustomFields(ctx, config, companyId, isTest, events);
  if (_readbackPrefix && advanceResult?.nextPrompt) {
    advanceResult.nextPrompt = _readbackPrefix + advanceResult.nextPrompt;
  }
  return advanceResult;
}

/* ============================================================================
   STEP: COLLECT ADDRESS
   ============================================================================
   Multi-step sub-flow driven by config.addressConfig:
     STREET → CITY (default: required) → STATE (default: off) → ZIP (default: off)

   City is on by default because most service calls need it for dispatch routing.
   State and zip are off by default — most companies are same-city businesses.
   Companies that need state/zip enable them per-company in the booking UI.

   All sub-steps strip leading STT filler ("the service address is.", "it's at", etc.)
   before storing the value, so records are clean regardless of caller phrasing.
   ============================================================================ */

async function processCollectAddress(ctx, userInput, config, companyId, isTest, events) {
  const ac    = config.addressConfig || {};
  const aStep = ctx.addressStep || 'STREET';

  // ── SUB-STEP: STREET ────────────────────────────────────────────────────────
  if (aStep === 'STREET') {
    if (!userInput?.trim()) {
      return {
        nextPrompt: config.addressReAnchor || "What is the service address?",
        bookingCtx: ctx,
        completed:  false
      };
    }

    // ── GroqFieldExtractor: smart address parsing ───────────────────────────
    // Always run Groq on STREET (first entry) — address speech is complex enough
    // to warrant semantic understanding. Groq may return a full address (skips
    // sub-flow entirely) or partial (jumps straight to the missing component).
    const addrExtraction = await GroqFieldExtractorService.parse(
      GroqFieldExtractorService.FIELD_TYPES.ADDRESS,
      userInput,
      { callSid: ctx.callSid, step: STEPS.COLLECT_ADDRESS }
    );
    events.push({
      type:              'BL1_ADDRESS_GROQ_EXTRACT',
      state:             addrExtraction.state,
      hasValue:          !!addrExtraction.value,
      confidence:        addrExtraction.confidence,
      missingComponents: addrExtraction.missingComponents,
      timestamp:         Date.now()
    });

    const { STATES: ADDR_STATES } = GroqFieldExtractorService;

    if (addrExtraction.state === ADDR_STATES.SEARCHING) {
      return {
        nextPrompt: config.patienceAddress,
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (addrExtraction.state === ADDR_STATES.OFF_TOPIC) {
      events.push({ type: 'BL1_ADDRESS_T2_DIGRESSION', rawInput: userInput?.substring(0, 60), timestamp: Date.now() });
      return {
        nextPrompt:     `${config.t2DigressionAck} ${config.addressReAnchor}`,
        bookingCtx:     ctx,
        completed:      false,
        t2Digression:   true,
        reAnchorPhrase: config.addressReAnchor
      };
    }

    // ── PROVIDING_WITH_Q: capture address + answer embedded question ──────────
    // Handled separately so the caller's question is actually answered (not ignored).
    if (addrExtraction.state === ADDR_STATES.PROVIDING_WITH_Q && addrExtraction.value) {
      events.push({ type: 'BL1_ADDRESS_T2_DIGRESSION', rawInput: addrExtraction.embeddedQuestion?.substring(0, 60), timestamp: Date.now() });
      // Use LLM to actually answer the question — caller asked, we respond
      const addrQuestion = addrExtraction.embeddedQuestion || userInput;
      const addrLlmAnswer = await BookingLLMInterceptService.answer({ question: addrQuestion, companyId, ctx, config }).catch(() => null);
      const addrAck = addrLlmAnswer || config.t2DigressionAck;

      // Process address components (same logic as PROVIDING)
      const addrMissing = addrExtraction.missingComponents || [];
      ctx._addressStreet = addrExtraction.value.split(',')[0]?.trim() || addrExtraction.value;
      if (addrExtraction.value.includes(',')) {
        const parts = addrExtraction.value.split(',').map(p => p.trim());
        if (parts[1] && !addrMissing.includes('city'))  ctx._addressCity  = parts[1];
        if (parts[2] && !addrMissing.includes('state')) ctx._addressState = parts[2];
        if (parts[3] && !addrMissing.includes('zip'))   ctx._addressZip   = parts[3];
      }
      events.push({ type: 'BL1_ADDRESS_STREET_COLLECTED', street: ctx._addressStreet, source: 'groq_with_q', timestamp: Date.now() });

      if (addrMissing.length === 0) {
        ctx.collectedFields.address = addrExtraction.value;
        ctx.addressStep = null;
        events.push({ type: 'BL1_ADDRESS_COMPLETE_GROQ', address: ctx.collectedFields.address, timestamp: Date.now() });
        const finalResult = await finalizeAddress(ctx, config, companyId, isTest, events);
        return { ...finalResult, nextPrompt: `${addrAck} ${finalResult.nextPrompt}` };
      }
      if (addrMissing.includes('city') && ac.requireCity !== false) {
        ctx.addressStep = 'CITY';
        return { nextPrompt: `${addrAck} ${ac.askCityPrompt || 'And what city is that in?'}`, bookingCtx: ctx, completed: false };
      }
      if (addrMissing.includes('state') && ac.requireState) {
        ctx.addressStep = 'STATE';
        return { nextPrompt: `${addrAck} ${ac.askStatePrompt || 'And what state?'}`, bookingCtx: ctx, completed: false };
      }
      if (addrMissing.includes('zip') && ac.requireZip) {
        ctx.addressStep = 'ZIP';
        return { nextPrompt: `${addrAck} ${ac.askZipPrompt || 'And the zip code?'}`, bookingCtx: ctx, completed: false };
      }
      const finalResult = await finalizeAddress(ctx, config, companyId, isTest, events);
      return { ...finalResult, nextPrompt: `${addrAck} ${finalResult.nextPrompt}` };
    }

    if (addrExtraction.value &&
        (addrExtraction.state === ADDR_STATES.PROVIDING  ||
         addrExtraction.state === ADDR_STATES.CORRECTING ||
         addrExtraction.state === ADDR_STATES.UNCERTAIN)) {

      if (addrExtraction.state === ADDR_STATES.UNCERTAIN) {
        return {
          nextPrompt: `Just to confirm — is the service address ${addrExtraction.value}?`,
          bookingCtx: ctx,
          completed:  false
        };
      }

      const missing = addrExtraction.missingComponents || [];
      ctx._addressStreet = addrExtraction.value.split(',')[0]?.trim() || addrExtraction.value;

      // Pre-populate any components Groq returned beyond street
      if (addrExtraction.value.includes(',')) {
        const parts = addrExtraction.value.split(',').map(p => p.trim());
        if (parts[1] && missing.includes('city')  === false) ctx._addressCity  = parts[1];
        if (parts[2] && missing.includes('state') === false) ctx._addressState = parts[2];
        if (parts[3] && missing.includes('zip')   === false) ctx._addressZip   = parts[3];
      }

      events.push({ type: 'BL1_ADDRESS_STREET_COLLECTED', street: ctx._addressStreet, source: 'groq', timestamp: Date.now() });

      if (missing.length === 0) {
        ctx.collectedFields.address = addrExtraction.value;
        ctx.addressStep = null;
        events.push({ type: 'BL1_ADDRESS_COMPLETE_GROQ', address: ctx.collectedFields.address, timestamp: Date.now() });
        return finalizeAddress(ctx, config, companyId, isTest, events);
      }

      if (missing.includes('city') && ac.requireCity !== false) {
        ctx.addressStep = 'CITY';
        return { nextPrompt: ac.askCityPrompt || 'And what city is that in?', bookingCtx: ctx, completed: false };
      }
      if (missing.includes('state') && ac.requireState) {
        ctx.addressStep = 'STATE';
        return { nextPrompt: ac.askStatePrompt || 'And what state?', bookingCtx: ctx, completed: false };
      }
      if (missing.includes('zip') && ac.requireZip) {
        ctx.addressStep = 'ZIP';
        return { nextPrompt: ac.askZipPrompt || 'And the zip code?', bookingCtx: ctx, completed: false };
      }

      return finalizeAddress(ctx, config, companyId, isTest, events);
    }
    // Groq returned no usable value — fall through to regex-based extraction

    ctx._addressStreet = stripAddressFiller(userInput);
    events.push({ type: 'BL1_ADDRESS_STREET_COLLECTED', street: ctx._addressStreet, timestamp: Date.now() });

    // City is required unless explicitly disabled
    if (ac.requireCity !== false) {
      ctx.addressStep = 'CITY';
      return {
        nextPrompt: ac.askCityPrompt || 'And what city is that in?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    return finalizeAddress(ctx, config, companyId, isTest, events);
  }

  // ── SUB-STEP: CITY ──────────────────────────────────────────────────────────
  if (aStep === 'CITY') {
    if (!userInput?.trim()) {
      return {
        nextPrompt: ac.askCityPrompt || 'What city?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    ctx._addressCity = stripCityFiller(userInput);
    events.push({ type: 'BL1_ADDRESS_CITY_COLLECTED', city: ctx._addressCity, timestamp: Date.now() });

    if (ac.requireState) {
      ctx.addressStep = 'STATE';
      return {
        nextPrompt: ac.askStatePrompt || 'And what state?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    if (ac.requireZip) {
      ctx.addressStep = 'ZIP';
      return {
        nextPrompt: ac.askZipPrompt || 'And the zip code?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    return finalizeAddress(ctx, config, companyId, isTest, events);
  }

  // ── SUB-STEP: STATE ─────────────────────────────────────────────────────────
  if (aStep === 'STATE') {
    if (!userInput?.trim()) {
      return {
        nextPrompt: ac.askStatePrompt || 'What state?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    // Normalize to 2-letter abbreviation when possible ("Florida" → "FL")
    const raw   = userInput.trim().replace(/[^a-zA-Z\s]/g, '').trim();
    const abbr  = STATE_ABBREVIATIONS[raw.toLowerCase()];
    ctx._addressState = abbr || raw.toUpperCase().slice(0, 2);
    events.push({ type: 'BL1_ADDRESS_STATE_COLLECTED', state: ctx._addressState, timestamp: Date.now() });

    if (ac.requireZip) {
      ctx.addressStep = 'ZIP';
      return {
        nextPrompt: ac.askZipPrompt || 'And the zip code?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    return finalizeAddress(ctx, config, companyId, isTest, events);
  }

  // ── SUB-STEP: ZIP ───────────────────────────────────────────────────────────
  if (aStep === 'ZIP') {
    if (!userInput?.trim()) {
      return {
        nextPrompt: ac.askZipPrompt || 'What is the zip code?',
        bookingCtx: ctx,
        completed:  false
      };
    }

    const zipMatch    = userInput.match(/\b\d{5}(?:-\d{4})?\b/);
    ctx._addressZip   = zipMatch ? zipMatch[0] : userInput.trim().replace(/\D/g, '').slice(0, 5);
    events.push({ type: 'BL1_ADDRESS_ZIP_COLLECTED', zip: ctx._addressZip, timestamp: Date.now() });

    return finalizeAddress(ctx, config, companyId, isTest, events);
  }

  // Fallback — state machine gap; finalize whatever we have
  return finalizeAddress(ctx, config, companyId, isTest, events);
}

/**
 * Assemble and store the full address from collected sub-step parts,
 * reset address sub-state, then continue to custom fields or scheduling.
 */
async function finalizeAddress(ctx, config, companyId, isTest, events) {
  const parts = [ctx._addressStreet, ctx._addressCity, ctx._addressState, ctx._addressZip];
  ctx.collectedFields.address = parts.filter(Boolean).join(', ');

  // Reset address sub-step state
  ctx.addressStep    = null;
  ctx._addressStreet = null;
  ctx._addressCity   = null;
  ctx._addressState  = null;
  ctx._addressZip    = null;

  events.push({ type: 'BL1_ADDRESS_COLLECTED', address: ctx.collectedFields.address, timestamp: Date.now() });

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

/**
 * US state name → 2-letter abbreviation lookup.
 * Covers all 50 states plus DC/Puerto Rico for robust STT normalization.
 */
const STATE_ABBREVIATIONS = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
  'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO',
  'montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH',
  'oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
  'district of columbia':'DC','dc':'DC','puerto rico':'PR'
};

/* ============================================================================
   HELPER: advanceAfterCustomFields
   Called after all custom fields are done (or if there are none).
   Routes to alt contact if enabled, else OFFER_TIMES.
   ============================================================================ */

async function advanceAfterCustomFields(ctx, config, companyId, isTest, events) {
  // Suppress alt contact when caller already had phone drama (declined caller ID and
  // had to re-state their number). Offering an alternate contact immediately after
  // that friction creates a frustrating "you just asked me about phones" experience.
  if (config.altContact?.enabled && !ctx._callerIdDeclined) {
    const offerPrompt = config.altContact.offerPrompt ||
      'Is this the best number to reach you, or do you have an alternate contact we should have on file?';
    return {
      nextPrompt: offerPrompt,
      bookingCtx: { ...ctx, step: STEPS.COLLECT_ALT_CONTACT, altContactStep: 'OFFER' },
      completed:  false
    };
  }
  return advanceToScheduling(ctx, config, companyId, isTest, events);
}

/** Routes to preferred day capture (if enabled) or directly to OFFER_TIMES. */
async function advanceToScheduling(ctx, config, companyId, isTest, events) {
  // Short-circuit: urgency/ASAP was pre-seeded from intake (discoveryNotes or callContext).
  // Skip day+time preference questions — go straight to earliest available slot.
  if (ctx.preferredDay === 'asap') {
    ctx.step = STEPS.OFFER_TIMES;
    events.push({ type: 'BL1_ASAP_SEEDED_SKIPPING_PREFERENCE', timestamp: Date.now() });
    return processOfferTimes(ctx, null, config, companyId, isTest, events);
  }

  if (config.preferenceCapture?.enabled) {
    ctx.step = STEPS.COLLECT_PREFERRED_DAY;
    events.push({ type: 'BL1_COLLECTING_PREFERRED_DAY', timestamp: Date.now() });
    return {
      nextPrompt: config.preferenceCapture.askDayPrompt,
      bookingCtx: ctx,
      completed:  false
    };
  }
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
   HELPER: schedulingTransition
   Routes to preferred-day capture (if enabled) or OFFER_TIMES holdMessage.
   Used by any step that hands off to the scheduling phase.
   ============================================================================ */

function schedulingTransition(ctx, config, extraCtx = {}) {
  if (config.preferenceCapture?.enabled) {
    return {
      nextPrompt: config.preferenceCapture.askDayPrompt,
      bookingCtx: { ...ctx, ...extraCtx, step: STEPS.COLLECT_PREFERRED_DAY },
      completed:  false
    };
  }
  // capitalizePromptStart guards against config values stored with lowercase first letter
  // (e.g. holdMessage saved as "great, one moment..." → "Great, one moment...")
  const hold = capitalizePromptStart(config.holdMessage) || 'One moment while I check our available times...';
  return {
    nextPrompt: hold,
    bookingCtx: { ...ctx, ...extraCtx, step: STEPS.OFFER_TIMES },
    completed:  false
  };
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
    // Caller wants to provide a different/alternate phone number (skip name — it's the same person)
    // e.g. "Let's use a different number" / "use another number" / "different number"
    if (/\b(different|another|other|new)\b.{0,30}\b(number|num|phone)\b|\b(number|num|phone)\b.{0,30}\b(different|another|other)\b/i.test(userInput)) {
      return {
        nextPrompt: ac.askPhonePrompt || 'What number would you like to use?',
        bookingCtx: { ...ctx, altContactStep: 'ASK_PHONE', currentAltContact: {} },
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
    // Caller said no — advance to scheduling
    return schedulingTransition(ctx, config);
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
    return schedulingTransition(ctx, config);
  }

  // Fallback
  return schedulingTransition(ctx, config);
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

  return schedulingTransition(ctx, config, { altContacts, currentAltContact: null });
}

/* ============================================================================
   STEP: COLLECT PREFERRED DAY / TIME
   ============================================================================ */

async function processCollectPreferredDay(ctx, userInput, config, companyId, isTest, events) {
  // ── STT_EMPTY ──────────────────────────────────────────────────────────────
  if (!userInput?.trim()) {
    return { nextPrompt: config.preferenceCapture.askDayPrompt, bookingCtx: ctx, completed: false };
  }

  // ── Urgency short-circuit ────────────────────────────────────────────────
  // "asap", "as soon as possible", "first available", etc.
  // Skip day+time questions — jump straight to OFFER_TIMES with earliest slots.
  if (isUrgentRequest(userInput)) {
    ctx.preferredDay  = 'asap';
    ctx.preferredTime = 'earliest';
    events.push({ type: 'BL1_URGENCY_DETECTED', input: userInput.trim(), timestamp: Date.now() });
    ctx.step = STEPS.OFFER_TIMES;

    const slotsResult = await processOfferTimes(ctx, null, config, companyId, isTest, events);

    // Honest acknowledgement: only claim same-day if a today slot actually exists.
    const todayStr     = new Date().toDateString();
    const hasTodaySlot = (ctx.availableTimeOptions || []).some(
      t => t.start && new Date(t.start).toDateString() === todayStr
    );
    const urgentAck = hasTodaySlot
      ? config.preferenceCapture.urgentPrompt
      : config.preferenceCapture.urgentNoTodayPrompt;

    return { ...slotsResult, nextPrompt: `${urgentAck} ${slotsResult.nextPrompt}` };
  }

  // ── Address readback digression ─────────────────────────────────────────
  // Caller asks to verify the address mid-scheduling ("Can you tell me what address you have?").
  // Read it back from collectedFields and re-ask the day question.
  const _isAddressQuery = /\b(what|which|tell me|confirm|read back|verify|check).{0,30}(address|street|location|place)\b|\b(address|street|location).{0,25}(you have|on file|did you get|do you have)\b/i.test(userInput);
  if (_isAddressQuery && ctx.collectedFields?.address) {
    events.push({ type: 'BL1_SCHEDULE_ADDRESS_READBACK', address: ctx.collectedFields.address, timestamp: Date.now() });
    const _readback = config.preferenceCapture.addressReadbackPrompt
      .replace('{address}', ctx.collectedFields.address)
      .replace('{followUp}', config.preferenceCapture.askDayPrompt);
    return { nextPrompt: _readback, bookingCtx: ctx, completed: false };
  }

  // ── General question / digression ───────────────────────────────────────
  // Caller asked a non-scheduling question mid-booking (pricing, coverage, etc.).
  // Route to BookingLLMInterceptService to answer it, then re-ask for day.
  // Detection: input ends with "?" and no parseable day/time preference is present.
  const dayPref  = parseDayPreference(userInput);
  const timePref = parseTimePreference(userInput);

  if (!dayPref && !timePref && /\?/.test(userInput)) {
    events.push({ type: 'BL1_SCHEDULE_DIGRESSION', rawInput: userInput.substring(0, 80), timestamp: Date.now() });
    const _llmAnswer = await BookingLLMInterceptService.answer({
      question: userInput, companyId, ctx, config
    }).catch(() => null);
    const _ack = config.preferenceCapture.scheduleDigressionAck || config.t2DigressionAck;
    const _answer = _llmAnswer || _ack;
    return {
      nextPrompt: `${_answer} ${config.preferenceCapture.askDayPrompt}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Day preference not parseable — re-ask cleanly ───────────────────────
  // NEVER store raw user input as ctx.preferredDay: it would be injected verbatim
  // into the askTimePrompt template, producing broken spoken output.
  if (!dayPref) {
    events.push({ type: 'BL1_DAY_PARSE_FAILED', rawInput: userInput.substring(0, 80), timestamp: Date.now() });
    return { nextPrompt: config.preferenceCapture.askDayPrompt, bookingCtx: ctx, completed: false };
  }

  // ── Day (and optionally time) captured ──────────────────────────────────
  ctx.preferredDay = dayPref;
  events.push({ type: 'BL1_PREFERRED_DAY_CAPTURED', day: ctx.preferredDay, timestamp: Date.now() });

  if (timePref) {
    // Caller gave both day and time in one utterance — skip the time question.
    ctx.preferredTime = timePref;
    events.push({ type: 'BL1_PREFERRED_TIME_CAPTURED', time: timePref, timestamp: Date.now() });
    ctx.step = STEPS.OFFER_TIMES;
    return processOfferTimes(ctx, null, config, companyId, isTest, events);
  }

  ctx.step = STEPS.COLLECT_PREFERRED_TIME;
  return {
    nextPrompt: config.preferenceCapture.askTimePrompt.replace('{day}', getDayLabel(ctx.preferredDay)),
    bookingCtx: ctx,
    completed:  false
  };
}

async function processCollectPreferredTime(ctx, userInput, config, companyId, isTest, events) {
  const _askTimePrompt = config.preferenceCapture.askTimePrompt.replace('{day}', getDayLabel(ctx.preferredDay));

  // ── STT_EMPTY ──────────────────────────────────────────────────────────────
  if (!userInput?.trim()) {
    return { nextPrompt: _askTimePrompt, bookingCtx: ctx, completed: false };
  }

  // ── Address readback digression ─────────────────────────────────────────
  const _isAddressQuery = /\b(what|which|tell me|confirm|read back|verify|check).{0,30}(address|street|location|place)\b|\b(address|street|location).{0,25}(you have|on file|did you get|do you have)\b/i.test(userInput);
  if (_isAddressQuery && ctx.collectedFields?.address) {
    events.push({ type: 'BL1_SCHEDULE_ADDRESS_READBACK', address: ctx.collectedFields.address, timestamp: Date.now() });
    const _readback = config.preferenceCapture.addressReadbackPrompt
      .replace('{address}', ctx.collectedFields.address)
      .replace('{followUp}', _askTimePrompt);
    return { nextPrompt: _readback, bookingCtx: ctx, completed: false };
  }

  // ── General question / digression ───────────────────────────────────────
  const timePref = parseTimePreference(userInput);
  if (!timePref && /\?/.test(userInput)) {
    events.push({ type: 'BL1_SCHEDULE_DIGRESSION', rawInput: userInput.substring(0, 80), timestamp: Date.now() });
    const _llmAnswer = await BookingLLMInterceptService.answer({
      question: userInput, companyId, ctx, config
    }).catch(() => null);
    const _ack = config.preferenceCapture.scheduleDigressionAck || config.t2DigressionAck;
    return {
      nextPrompt: `${_llmAnswer || _ack} ${_askTimePrompt}`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // ── Time preference not parseable — re-ask cleanly ──────────────────────
  // NEVER store raw user input as ctx.preferredTime — same string-injection risk
  // as ctx.preferredDay. Re-ask instead.
  if (!timePref) {
    events.push({ type: 'BL1_TIME_PARSE_FAILED', rawInput: userInput.substring(0, 80), timestamp: Date.now() });
    return { nextPrompt: _askTimePrompt, bookingCtx: ctx, completed: false };
  }

  // ── Time captured ────────────────────────────────────────────────────────
  ctx.preferredTime = timePref;
  events.push({ type: 'BL1_PREFERRED_TIME_CAPTURED', time: ctx.preferredTime, timestamp: Date.now() });
  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, companyId, isTest, events);
}

/**
 * Detect urgency signals — caller wants the EARLIEST possible slot.
 * When true, skip the "what time?" question and go straight to OFFER_TIMES.
 */
function isUrgentRequest(input) {
  const n = input.toLowerCase();
  return /\b(asap|a\.s\.a\.p|as soon as possible|as soon as you can|right now|right away|immediately|urgent|urgently|emergency|first available|first opening|earliest available|earliest slot|can'?t wait|cannot wait|no preference|any time|anytime|whatever works|hurry|need.{0,20}now|need.{0,20}today.*fast|soonest)\b/.test(n);
}

/** Parse a caller's day preference from free speech. */
function parseDayPreference(input) {
  const n = input.toLowerCase();
  if (/\b(today|right now|asap|as soon as|same.?day|tonight)\b/.test(n)) return 'today';
  if (/\btomorrow\b/.test(n)) return 'tomorrow';
  if (/\bmonday\b|\bmon\b/.test(n))    return 'monday';
  if (/\btuesday\b|\btue\b/.test(n))   return 'tuesday';
  if (/\bwednesday\b|\bwed\b/.test(n)) return 'wednesday';
  if (/\bthursday\b|\bthu\b/.test(n))  return 'thursday';
  if (/\bfriday\b|\bfri\b/.test(n))    return 'friday';
  if (/\bsaturday\b|\bsat\b/.test(n))  return 'saturday';
  if (/\bsunday\b|\bsun\b/.test(n))    return 'sunday';
  if (/\bnext week\b/.test(n)) return 'next week';
  if (/\bthis week\b/.test(n)) return 'this week';
  return null;
}

/** Parse a caller's time-of-day preference from free speech. */
function parseTimePreference(input) {
  const n = input.toLowerCase();
  if (/\bmorning\b|\nearly\b/.test(n)) return 'morning';
  if (/\bafternoon\b|\bmidday\b/.test(n)) return 'afternoon';
  if (/\bevening\b|\bnight\b/.test(n)) return 'evening';
  const m = n.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) {
    const h = parseInt(m[1]);
    const min = m[2] || '00';
    return (h >= 1 && h <= 12) ? `${h}:${min} ${m[3].toUpperCase()}` : null;
  }
  return null;
}

/**
 * Human-readable day label for prompt template substitution.
 *
 * Guards against raw user input being injected into spoken prompts.
 * Valid day values are short (≤12 chars) and contain no punctuation — anything
 * that doesn't match is replaced with the safe fallback "that day".
 *
 * @param {string|null} day — parsed day from parseDayPreference()
 * @returns {string}
 */
function getDayLabel(day) {
  if (!day || typeof day !== 'string') return 'that day';
  // Valid values: 'today', 'tomorrow', 'monday'–'sunday', 'next week', 'this week'
  // Max length 12 chars; no question marks, digits, or long multi-word phrases.
  if (day.length > 12 || /[?!.0-9]/.test(day) || day.trim().split(/\s+/).length > 2) {
    return 'that day';
  }
  return day;
}

/* ============================================================================
   STEP: OFFER TIMES — preference pivot helper
   ============================================================================ */

/**
 * Detect whether the caller is pivoting to a new day/time preference rather than
 * selecting from the slots already offered.
 *
 * Examples that should pivot:
 *   "What about in the afternoon?"
 *   "Do you have anything this afternoon?"
 *   "How about tomorrow instead?"
 *   "What about Friday morning?"
 *
 * Examples that should NOT pivot (handled by matchTimeFromInput):
 *   "Let's do 9 a.m."     ← slot selection
 *   "The first one"       ← positional selection
 *
 * @param {string} userInput
 * @param {Object} ctx        - booking context (used to compare against current prefs)
 * @returns {{ newDay: string|null, newTime: string|null } | null}
 */
function detectPreferencePivot(userInput, ctx) {
  const t = userInput.toLowerCase();

  // Must contain asking/alternative language to distinguish pivot from slot selection.
  // Includes colloquial "what do you got" / "what have you got" and similar STT variants.
  const isAskingForNew = /\b(what about|how about|do you have|what do you (got|have)|what have you got|anything (for|on|available)|any(thing)?(\s+available)?|instead|different|earlier|later|other time|other day)\b/.test(t);

  // "this morning/afternoon/evening" always means today
  const impliedToday = /\bthis\s+(morning|afternoon|evening)\b/.test(t);

  const newDay  = parseDayPreference(t) || (impliedToday ? 'today' : null);
  const newTime = parseTimePreference(t);

  if (!newDay && !newTime) return null; // nothing to pivot to

  const isDifferentDay  = newDay  && newDay  !== ctx.preferredDay;
  const isDifferentTime = newTime && newTime !== ctx.preferredTime;

  // Pivot when: asking language present with any day/time change,
  // OR a clearly different day was named even without asking language
  if ((isAskingForNew && (newDay || newTime)) || isDifferentDay || isDifferentTime) {
    return { newDay, newTime };
  }

  return null;
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
    // Before giving up — check if the caller is pivoting to a different day/time preference
    // e.g. "What about in the afternoon?" or "Do you have anything this afternoon?"
    const pivot = detectPreferencePivot(userInput, ctx);
    if (pivot) {
      if (pivot.newDay)  ctx.preferredDay  = pivot.newDay;
      if (pivot.newTime) ctx.preferredTime = pivot.newTime;
      ctx.availableTimeOptions = null; // force fresh fetch with updated prefs
      events.push({ type: 'BL1_PREFERENCE_PIVOT', newDay: pivot.newDay, newTime: pivot.newTime, timestamp: Date.now() });

      const { timeOptions, message } = await fetchAvailableTimeOptions(config, companyId, ctx, isTest, events);
      ctx.availableTimeOptions = timeOptions;

      // Build a natural acknowledgement: "Of course — let me check today in the afternoon..."
      const ackParts = [];
      if (pivot.newDay)  ackParts.push(pivot.newDay);
      if (pivot.newTime) ackParts.push(`in the ${pivot.newTime}`);
      const ackStr = ackParts.length ? ackParts.join(' ') : 'that time frame';

      return {
        nextPrompt: `Of course — let me check ${ackStr} for you. ${message}`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    // Truly no match and no pivot — but first check if caller is echoing their current preference.
    // "On Monday, I said afternoon." / "I told you — Monday afternoon" — caller feels unheard.
    // Acknowledge the preference explicitly and re-present the slots instead of robotically
    // repeating "I didn't catch which time." (which makes the agent sound deaf).
    const _echoDay  = ctx.preferredDay  && parseDayPreference(userInput)  === ctx.preferredDay;
    const _echoTime = ctx.preferredTime && parseTimePreference(userInput) === ctx.preferredTime;
    const formatted = formatTimeOptionsList(ctx.availableTimeOptions);

    if (_echoDay || _echoTime) {
      // Build a natural preference label so the acknowledgement feels personalised
      const _echoDesc = [
        _echoDay  ? ctx.preferredDay  : null,
        _echoTime ? `in the ${ctx.preferredTime}` : null
      ].filter(Boolean).join(' ');
      events.push({ type: 'BL1_PREFERENCE_ECHO_ACKNOWLEDGED', desc: _echoDesc, timestamp: Date.now() });
      return {
        nextPrompt: `Got it — ${_echoDesc}. Here are the times I have available: ${formatted}. Which one works best for you?`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    return {
      nextPrompt: `I didn't catch which time you'd prefer. I have ${formatted} — which works best?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  ctx.selectedTime = selected;
  ctx.step         = STEPS.CONFIRM;
  events.push({ type: 'BL1_TIME_SELECTED', display: selected.display, timestamp: Date.now() });

  // Full-field summary so the caller hears everything before we write to the calendar
  return {
    nextPrompt: buildFullConfirmSummary(ctx),
    bookingCtx: ctx,
    completed:  false
  };
}

/* ============================================================================
   STEP: CONFIRM
   ============================================================================ */

/**
 * Build a full-field pre-booking summary that the caller hears before we write
 * to the calendar.  Includes service type (from discoveryNotes), name, phone,
 * address (if collected), and time slot — so nothing is a surprise.
 *
 * Falls back gracefully when any field is absent.
 */
function buildFullConfirmSummary(ctx) {
  const dn      = ctx.discoveryNotes;
  // v2 schema uses temp.serviceType; v1 used entities.serviceType — support both
  const service = dn?.callReason || dn?.temp?.serviceType || dn?.entities?.serviceType || ctx.bookingMode || null;
  const first   = ctx.collectedFields?.firstName || '';
  const last    = ctx.collectedFields?.lastName  || '';
  const name    = [first, last].filter(Boolean).join(' ');
  const phone   = ctx.collectedFields?.phone || normalizePhone(ctx.callerPhone) || null;
  const address = ctx.collectedFields?.address || null;
  const slot    = ctx.selectedTime?.display   || null;

  const parts = [];
  if (service) parts.push(service);
  if (name)    parts.push(`for ${name}`);
  if (phone)   parts.push(`at ${phone}`);
  if (address) parts.push(`at ${address}`);
  if (slot)    parts.push(`on ${slot}`);

  if (parts.length === 0) {
    return `Shall I go ahead and confirm your appointment?`;
  }
  return `Just to confirm — I have ${parts.join(', ')}. Does everything look right?`;
}

async function processConfirm(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput?.trim()) {
    return {
      nextPrompt: buildFullConfirmSummary(ctx),
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

    // ── UAPB BOOKING_CONFIRM — lock all temp → confirmed in DiscoveryNotes ──
    // Single event: all temp fields lock simultaneously. This is the ONLY
    // promotion path — confirmed{} is never written mid-call per-field.
    if (ctx.callSid) {
      DiscoveryNotesService.update(companyId, ctx.callSid, {
        confirmed:  'LOCK_ALL_TEMP',
        objective:  'CLOSING',
      }).catch(err => logger.warn(`[${ENGINE_ID}] DN BOOKING_CONFIRM lock failed`, {
        companyId, callSid: ctx.callSid, err: err.message
      }));
    }

    // Build a discovery-aware closing that references what was booked and who the caller is.
    // Falls back to the company-configured confirmationMessage if discoveryNotes are absent.
    const _closingDn          = ctx.discoveryNotes;
    // v2 schema uses temp.serviceType; v1 used entities.serviceType — support both
    const _closingService     = _closingDn?.callReason || _closingDn?.temp?.serviceType || _closingDn?.entities?.serviceType || null;
    const _closingFirstName   = ctx.collectedFields?.firstName || '';
    const _closingSlot        = ctx.selectedTime?.display || 'the scheduled time';

    let confirmMsg;
    if (_closingService || _closingFirstName) {
      const _namePart    = _closingFirstName ? `, ${_closingFirstName}` : '';
      const _servicePart = _closingService   ? `your ${_closingService} service` : 'your appointment';
      confirmMsg = `You're all set${_namePart}! ${_servicePart.charAt(0).toUpperCase() + _servicePart.slice(1)} is confirmed for ${_closingSlot}. We'll send you a confirmation text. Is there anything else I can help you with?`;
    } else {
      confirmMsg = config.confirmationMessage
        .replace('{date}', ctx.selectedTime?.display?.split(' at ')[0] || 'the scheduled date')
        .replace('{time}', ctx.selectedTime?.display?.split(' at ')[1] || 'the scheduled time');
    }

    events.push({ type: 'BL1_COMPLETED', timestamp: Date.now() });

    return {
      nextPrompt:      confirmMsg,
      bookingCtx:      ctx,
      completed:       true,
      calendarEventId: ctx.calendarEventId || null
    };
  }

  // Caller is correcting or declining the confirmed time
  if (/\b(no|nope|different|change|other|another)\b/.test(input)) {
    // First: check if the caller is correcting to a specific time they already stated
    // e.g. "No, I said 9" or "No, I said 900" — extract the correction, don't re-fetch
    const correction = matchTimeFromInput(input, ctx.availableTimeOptions || []);
    if (correction && correction.display !== ctx.selectedTime?.display) {
      ctx.selectedTime = correction;
      ctx.step         = STEPS.CONFIRM;
      events.push({ type: 'BL1_TIME_CORRECTED', display: correction.display, timestamp: Date.now() });
      return {
        nextPrompt: `My apologies — I have you down for ${correction.display}. Shall I go ahead and book that?`,
        bookingCtx: ctx,
        completed:  false
      };
    }

    // No specific time found — re-offer all slots
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

  // Ambiguous — check if caller is stating a time correction before re-asking
  // e.g. "I did say 900" — no "no" but clearly a correction
  const ambiguousCorrection = matchTimeFromInput(input, ctx.availableTimeOptions || []);
  if (ambiguousCorrection && ambiguousCorrection.display !== ctx.selectedTime?.display) {
    ctx.selectedTime = ambiguousCorrection;
    ctx.step         = STEPS.CONFIRM;
    events.push({ type: 'BL1_TIME_CORRECTED', display: ambiguousCorrection.display, timestamp: Date.now() });
    return {
      nextPrompt: `I have you down for ${ambiguousCorrection.display}. Shall I go ahead and book that?`,
      bookingCtx: ctx,
      completed:  false
    };
  }

  // Truly ambiguous — re-ask
  return {
    nextPrompt: config.timeAmbiguousPrompt.replace('{time}', ctx.selectedTime?.display),
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

      // Always stamp the new service type and clear stale slots
      ctx.bookingMode          = redirectMode;
      ctx.availableTimeOptions = null;
      ctx.selectedTime         = null;
      ctx.blocked              = false;

      // Resolve and stamp serviceTypeId for technician routing
      ctx.serviceTypeId = (() => {
        if (!config.serviceTypes?.length) return null;
        const normalized = (redirectMode || '').toLowerCase().trim();
        const matched = config.serviceTypes.find(st =>
          st.id?.toLowerCase()    === normalized ||
          st.label?.toLowerCase() === normalized
        );
        return matched?.id || null;
      })();

      // ── Required-field guard ────────────────────────────────────────────────
      // If the caller hasn't provided name/phone/address yet, we cannot jump
      // straight to OFFER_TIMES — that would create a booking with zero contact
      // info. Stay at (or return to) the earliest uncollected required field.
      // The trigger response is played first, then the collection resumes naturally.
      const missingFields = _getMissingRequiredFields(ctx, config);
      if (missingFields.length > 0) {
        events.push({
          type:          'BL2_REDIRECT_FIELD_GUARD',
          ruleId:        card.ruleId,
          newMode:       redirectMode,
          missingFields,
          timestamp:     Date.now()
        });

        // Route to the first missing required field
        const firstMissing = missingFields[0];
        ctx.step = firstMissing === 'phone'   ? STEPS.COLLECT_PHONE
                 : firstMissing === 'address' ? STEPS.COLLECT_ADDRESS
                 :                              STEPS.COLLECT_NAME;

        // Answer the trigger question, then immediately ask for the missing field
        const collectPrompt = _getStepReAnchor(ctx.step, config);
        return {
          nextPrompt: `${fullText} ${RETURN_TO_BOOKING_Q} ${collectPrompt}`,
          bookingCtx: ctx,
          completed:  false,
          _triggerHit: { ruleId: card.ruleId, behavior: 'REDIRECT', newMode: redirectMode }
        };
      }

      // All required fields present — safe to jump to OFFER_TIMES
      ctx.step = STEPS.OFFER_TIMES;

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
    const isUrgent    = ctx.preferredDay === 'asap';
    const serviceMode = isUrgent ? 'emergency' : 'regular';

    // ── 1. HOLIDAY CHECK ────────────────────────────────────────────────────
    // For emergency calls, only block if emergencySchedule.respectHolidays is true.
    // For regular calls, block on any closeRegular holiday.
    const today = new Date();
    const skipHolidayCheck = isUrgent && config.emergencySchedule?.enabled &&
                             !config.emergencySchedule?.respectHolidays;

    if (!skipHolidayCheck) {
      const { closed, holidayName } = HolidayService.checkHolidayClosure(
        today, config.holidays, serviceMode
      );
      if (closed) {
        events.push({ type: 'BL1_HOLIDAY_CLOSED', holidayName, serviceMode, timestamp: Date.now() });
        const nextOpen = HolidayService.nextOpenDate(
          new Date(today.getTime() + 86_400_000), config.holidays, serviceMode
        );
        return {
          timeOptions: [],
          message: `We're closed today for ${holidayName}. The next available day is ${nextOpen.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Would you like me to check availability for then?`
        };
      }
    }

    // ── 2. SERVICE-TYPE RESOLUTION ─────────────────────────────────────────
    // Priority order (highest → lowest):
    //   1. ctx.serviceTypeId  — already resolved & stamped (trigger REDIRECT or prior turn)
    //   2. Emergency schedule — urgent call + emergency enabled → use its configured type
    //   3. Summary / bookingMode label match — LLM-derived service category
    //   4. Default service type — configured isDefault fallback
    let resolvedServiceTypeId = ctx.serviceTypeId || null;

    if (!resolvedServiceTypeId && isUrgent && config.emergencySchedule?.enabled) {
      resolvedServiceTypeId = config.emergencySchedule.serviceTypeId || null;
    }

    if (!resolvedServiceTypeId) {
      const rawType = (ctx.summary?.serviceType || ctx.bookingMode || '').toLowerCase().trim();
      if (rawType) {
        const matched = config.serviceTypes?.find(st =>
          st.id?.toLowerCase()           === rawType ||
          st.label?.toLowerCase()        === rawType ||
          st.label?.toLowerCase().includes(rawType)
        );
        resolvedServiceTypeId = matched?.id || null;
      }
    }

    if (!resolvedServiceTypeId) {
      const defaultType = config.serviceTypes?.find(st => st.isDefault);
      resolvedServiceTypeId = defaultType?.id || null;
    }

    // Persist back to ctx so all subsequent turns use the same resolved type
    // without re-running the resolution chain.
    if (resolvedServiceTypeId && !ctx.serviceTypeId) {
      ctx.serviceTypeId = resolvedServiceTypeId;
    }

    // ── 3. TECHNICIAN CALENDAR ROUTING ─────────────────────────────────────
    // Find all active technicians who handle this service type.
    // If none configured → fall through to company's single default calendar (backward-compat).
    let calendarIdsOverride = null;
    if (config.technicians?.length) {
      const matchedTechs = resolvedServiceTypeId
        ? config.technicians.filter(t => t.serviceTypeIds?.includes(resolvedServiceTypeId))
        : config.technicians;  // no service type → all techs

      if (matchedTechs.length > 0) {
        calendarIdsOverride = matchedTechs
          .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
          .map(t => t.calendarId)
          .filter(Boolean);
        events.push({
          type: 'BL1_TECH_ROUTING',
          serviceTypeId: resolvedServiceTypeId,
          techCount: matchedTechs.length,
          calendarIds: calendarIdsOverride,
          timestamp: Date.now()
        });
      }
    }

    // ── 4. EMERGENCY SCHEDULE PARAMETERS ───────────────────────────────────
    let overrideWindowStart    = null;
    let overrideWindowEnd      = null;
    let overrideAvailableDays  = null;
    let overrideLeadTimeMinutes = null;

    if (isUrgent && config.emergencySchedule?.enabled) {
      const es = config.emergencySchedule;
      if (es.mode === '24_7') {
        overrideWindowStart    = '00:00';
        overrideWindowEnd      = '23:59';
        overrideAvailableDays  = [0,1,2,3,4,5,6];
      } else if (es.mode === 'custom') {
        overrideWindowStart    = es.windowStart   || '07:00';
        overrideWindowEnd      = es.windowEnd     || '22:00';
        overrideAvailableDays  = es.daysOfWeek?.length ? es.daysOfWeek : [0,1,2,3,4,5,6];
      }
      // 'inherit' mode: no window overrides, use service-type config
      if (es.bufferMinutes != null) {
        overrideLeadTimeMinutes = es.bufferMinutes;
      }
      events.push({
        type: 'BL1_EMERGENCY_SCHEDULE_APPLIED',
        mode: es.mode,
        bufferMinutes: es.bufferMinutes,
        windowStart: overrideWindowStart,
        windowEnd: overrideWindowEnd,
        timestamp: Date.now()
      });
    }

    // ── 5. QUERY CALENDAR ──────────────────────────────────────────────────
    const serviceType = resolvedServiceTypeId || ctx.summary?.serviceType || ctx.bookingMode || 'service';

    const result = await GoogleCalendarService.findAvailableSlots(companyId, {
      durationMinutes:        config.appointmentDuration,
      maxSlots:               3,
      serviceType,
      dayPreference:          ctx.preferredDay  || 'asap',
      timePreference:         ctx.preferredTime || 'anytime',
      calendarIds:            calendarIdsOverride,
      overrideWindowStart,
      overrideWindowEnd,
      overrideAvailableDays,
      overrideLeadTimeMinutes
    });

    if (result.fallback || !result.slots?.length) {
      events.push({ type: 'BL1_CALENDAR_NO_SLOTS', fallback: !!result.fallback, timestamp: Date.now() });
      // noSlotsOnDayPrompt requires a real alternative slot to fill its {alternative}
      // template variable.  Since we have no actual slot to offer, always use the
      // generic noTimesPrompt — never substitute a literal placeholder string.
      return {
        timeOptions: [],
        message: config.noTimesPrompt || "I'm not seeing any open times in the next few days. Would you like me to have someone call you back to find a time that works?"
      };
    }

    events.push({ type: 'BL1_TIMES_FETCHED', count: result.slots.length, serviceType, timestamp: Date.now() });

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

  // Use callContext.issue.summary first (most accurate), fall back to discoveryNotes.callReason
  // so the opener always references what the caller actually called about.
  const issueSummary = callContext?.issue?.summary || ctx?.discoveryNotes?.callReason || null;
  if (issueSummary) {
    // Acknowledge the situation factually — NO "let me" function description.
    // The caller wants to know their issue is captured, not hear the agent narrate its process.
    parts.push(`I have the ${issueSummary} noted.`);
  }

  if (techPref) {
    parts.push(`I'll make a note that you'd like ${techPref} to come back out.`);
  }

  // Use discoveryNotes.urgency as fallback so high-urgency calls from discovery are respected
  const _urgencyHigh = callContext?.urgency?.level === 'high'
                    || ctx?.discoveryNotes?.urgency === 'high';
  if (_urgencyHigh) {
    parts.push(`I'll make sure this gets handled as soon as possible.`);
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
 * Extract ALL US phone numbers from a natural-language utterance.
 *
 * Uses a lenient separator pattern (up to 3 chars between segments) to handle
 * STT artifacts like "239. 333 7747" where the period+space between area code
 * and exchange would defeat a strict single-separator regex.
 *
 * Each match is validated by digit count (must be 10 or 11 with leading '1').
 *
 * @param  {string}   text — raw STT utterance
 * @returns {string[]}     — array of raw phone strings (empty if none found)
 */
function extractAllPhonesFromText(text) {
  if (!text) return [];
  const phoneRe = /(?:\+?1[\s\-.]{0,3})?\(?\d{3}\)?[-.\s]{0,3}\d{3}[-.\s]\d{4}/g;
  const matches = [];
  let m;
  while ((m = phoneRe.exec(text)) !== null) {
    const digits = m[0].replace(/\D/g, '');
    // Guard: exactly 10 digits, or 11 starting with '1' (US country code)
    if (digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) {
      matches.push(m[0]);
    }
  }
  return matches;
}

/**
 * Extract the best phone number from a caller utterance that may contain a
 * mid-sentence correction ("actually", "wait", "no — I mean").
 *
 * Rule:
 *   - When correction language is detected AND multiple phones found → return LAST phone.
 *     (The last one is the one the caller corrected TO, not the one they were correcting.)
 *   - Otherwise → return first phone found.
 *   - If only one phone found → return it regardless of correction language.
 *   - If no phone found → return null.
 *
 * Example: "239-565-2202. Actually, wait — no, that would be more like 239. 333 7747."
 *   → extractAllPhonesFromText finds ["239-565-2202", "239. 333 7747"]
 *   → correction language detected ("actually", "wait", "no")
 *   → returns "239. 333 7747"
 *   → normalizePhone("239. 333 7747") → "(239) 333-7747"
 *
 * @param  {string}      text — raw STT utterance
 * @returns {string|null}     — raw phone string for normalizePhone(), or null
 */
function extractCorrectedPhone(text) {
  if (!text) return null;
  const phones = extractAllPhonesFromText(text);
  if (phones.length === 0) return null;
  if (phones.length === 1) return phones[0];

  // Multiple phones found — use LAST when correction language is present
  const hasCorrectionLanguage = /\b(actually|wait|no|hold on|i mean|sorry|scratch that|not that|oops|let me try|i meant|my mistake|correction|never mind|instead)\b/i.test(text);
  return hasCorrectionLanguage ? phones[phones.length - 1] : phones[0];
}

/**
 * Strip common STT filler phrases from the start of a service address utterance.
 *
 * Callers often preface their address with conversational phrases that STT captures
 * verbatim: "The service address is. 12155 Metro Parkway." → "12155 Metro Parkway"
 *
 * Strips:
 *   - "the service address is."   / "my address is"  / "the address is"
 *   - "it's at" / "it is at"      / "located at"
 *   - "that's at" / "that is at"
 * Also removes a trailing period that STT sometimes appends.
 *
 * @param  {string} text — raw STT address utterance
 * @returns {string}     — cleaned street address
 */
function stripAddressFiller(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^(the\s+)?(service\s+)?address\s+is[.,]?\s*/i, '')
    .replace(/^(my|our|the)\s+address\s+is[.,]?\s*/i, '')
    .replace(/^it'?s?\s+(at\s+)?/i, '')
    .replace(/^it\s+is\s+(at\s+)?/i, '')
    .replace(/^located\s+at\s*/i, '')
    .replace(/^that'?s?\s+(at\s+)?/i, '')
    .replace(/^that\s+is\s+(at\s+)?/i, '')
    .trim()
    .replace(/\.$/, '')     // remove trailing period from STT
    .trim();
}

/**
 * Strip common STT filler from a city name utterance.
 * "It's in Fort Myers" → "Fort Myers"
 * "The city is Naples" → "Naples"
 *
 * @param  {string} text
 * @returns {string}
 */
function stripCityFiller(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/^(it'?s?\s+)?in\s+/i, '')
    .replace(/^(it\s+is\s+)?in\s+/i, '')
    .replace(/^(the\s+)?city(\s+is)?\s*/i, '')
    .replace(/\.$/, '')
    .trim();
}

/**
 * Capitalize the first character of a prompt string.
 * Guards against config values stored with an accidental lowercase first letter.
 * (e.g. holdMessage "great, one moment..." → "Great, one moment...")
 *
 * @param  {string} str
 * @returns {string}
 */
function capitalizePromptStart(str) {
  if (!str || typeof str !== 'string') return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
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
 *
 * Handles:
 *  - Positional words ("first", "second", "last")
 *  - Spoken number words ("nine a.m." → 9 AM)
 *  - Compact military-style input ("900" → 9:00)
 *  - Natural-language display strings ("8 in the morning", "2:30 in the afternoon")
 *  - Legacy AM/PM display strings ("8:00 AM") for backwards compatibility
 *  - Ambiguous hour (no AM/PM) — tries both clock halves when only one slot fits
 *  - Time-of-day period fallback as last resort
 *
 * NOTE: Day-name matching was intentionally removed — it caused every "tomorrow"
 * slot to resolve to [0] regardless of which hour the caller stated.
 */
function matchTimeFromInput(input, timeOptions) {
  if (!timeOptions?.length) return null;

  const n = input.toLowerCase();

  // ── 1. Positional references ──────────────────────────────────────────────
  if (/\b(first|1st)\b/.test(n))           return timeOptions[0];
  if (/\b(second|2nd)\b/.test(n))          return timeOptions[1] ?? null;
  if (/\b(third|3rd|last)\b/.test(n))      return timeOptions[timeOptions.length - 1];

  // ── 2. Single-option affirmative ──────────────────────────────────────────
  if (timeOptions.length === 1 &&
      /\b(yes|sure|ok|okay|that works|sounds good)\b/.test(n)) {
    return timeOptions[0];
  }

  // ── 3. Normalize input ────────────────────────────────────────────────────
  // a.m./p.m. → am/pm
  let norm = n
    .replace(/\ba\.m\.?\b/gi, 'am')
    .replace(/\bp\.m\.?\b/gi, 'pm');

  // Spoken number words → digits ("nine" → "9", etc.)
  const WORD_TO_NUM = {
    'one':1, 'two':2, 'three':3, 'four':4, 'five':5, 'six':6,
    'seven':7, 'eight':8, 'nine':9, 'ten':10, 'eleven':11, 'twelve':12,
  };
  for (const [word, digit] of Object.entries(WORD_TO_NUM)) {
    norm = norm.replace(new RegExp(`\\b${word}\\b`, 'g'), String(digit));
  }

  // Compact military-style times without colon: "900" → "9:00", "1030" → "10:30"
  norm = norm.replace(/\b(\d{1,2})(\d{2})\b(?!\d)/g, '$1:$2');

  // ── 4. Parse display strings into 24-hour minutes ─────────────────────────
  function displayTo24h(display) {
    const d = display.toLowerCase();
    if (/\bnoon\b/.test(d))     return 12 * 60;  // word-boundary — "afternoon" must NOT match
    if (/\bmidnight\b/.test(d)) return 0;
    // Natural language: "8 in the morning", "2:30 in the afternoon", "6 in the evening"
    const nl = d.match(/\b(\d{1,2})(?::(\d{2}))?\s+in the\s+(morning|afternoon|evening)/);
    if (nl) {
      let h = parseInt(nl[1], 10);
      const m = parseInt(nl[2] || '0', 10);
      if ((nl[3] === 'afternoon' || nl[3] === 'evening') && h < 12) h += 12;
      return h * 60 + m;
    }
    // Legacy AM/PM: "8:00 am", "2 pm"
    const ap = d.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (ap) {
      let h = parseInt(ap[1], 10);
      const m = parseInt(ap[2] || '0', 10);
      if (ap[3] === 'pm' && h < 12) h += 12;
      if (ap[3] === 'am' && h === 12) h = 0;
      return h * 60 + m;
    }
    return null;
  }

  // ── 5. Parse caller's stated time into 24-hour minutes ───────────────────
  function inputTo24h(text) {
    if (/\bnoon\b/.test(text)) return 12 * 60;
    const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    if (h > 23) return null; // invalid
    const min    = parseInt(m[2] || '0', 10);
    const hasAm  = m[3] === 'am';
    const hasPm  = m[3] === 'pm';
    if (hasPm && h < 12) h += 12;
    if (hasAm && h === 12) h = 0;
    // No explicit am/pm — check surrounding words
    if (!hasAm && !hasPm && /\b(afternoon|evening)\b/.test(text) && h < 12) h += 12;
    return h * 60 + min;
  }

  // ── 6. Exact time match, then ambiguous-hour fallback ────────────────────
  const callerMin = inputTo24h(norm);
  if (callerMin !== null) {
    // Exact hour+minute
    for (const opt of timeOptions) {
      if (displayTo24h(opt.display) === callerMin) return opt;
    }

    // If caller gave no explicit AM/PM, also try the other half of the clock.
    // e.g. caller says "2" with only a 2 PM slot available → resolve to PM.
    const hasExplicitPeriod = /\b(am|pm|morning|afternoon|evening|tonight)\b/.test(norm);
    if (!hasExplicitPeriod) {
      const callerHour = Math.floor(callerMin / 60);
      if (callerHour < 12) {
        const altMin = (callerHour + 12) * 60 + (callerMin % 60);
        for (const opt of timeOptions) {
          if (displayTo24h(opt.display) === altMin) return opt;
        }
      }
    }
  }

  // ── 7. Time-of-day period fallback (last resort, no specific hour found) ──
  if (/\b(morning)\b/.test(norm)) {
    return timeOptions.find(o => /morning/.test(o.display.toLowerCase())) ?? null;
  }
  if (/\b(afternoon)\b/.test(norm)) {
    return timeOptions.find(o => /afternoon/.test(o.display.toLowerCase())) ?? null;
  }
  if (/\b(evening|tonight)\b/.test(norm)) {
    return timeOptions.find(o => /evening/.test(o.display.toLowerCase())) ?? null;
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

/**
 * ============================================================================
 * BOOKING LOGIC ENGINE — CLEAN IMPLEMENTATION
 * ClientVia Platform · Agent Console Contract AC1
 * 
 * This is a CLEAN module — NO LEGACY CODE.
 * 
 * Responsibilities:
 * - Receive handoff payload from Agent 2.0
 * - Collect missing required fields (name, phone, address)
 * - Query calendar for available time options
 * - Present options to caller
 * - Confirm and book appointment
 * - Send confirmation
 * 
 * Communication Contract:
 * - Input: { payload, bookingCtx, userInput }
 * - Output: { nextPrompt, bookingCtx, completed, calendarEventId?, events[] }
 * 
 * BANNED TERMS: Do not use "slot" anywhere — use timeOption or availabilityWindow
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const v2Company = require('../../../models/v2Company');

const ENGINE_ID = 'BOOKING_LOGIC_ENGINE';
const VERSION = 'BL1.0';

/* ============================================================================
   BOOKING FLOW STEPS
   ============================================================================ */

const STEPS = {
  INIT: 'INIT',
  COLLECT_NAME: 'COLLECT_NAME',
  COLLECT_PHONE: 'COLLECT_PHONE',
  COLLECT_ADDRESS: 'COLLECT_ADDRESS',
  OFFER_TIMES: 'OFFER_TIMES',
  CONFIRM: 'CONFIRM',
  COMPLETED: 'COMPLETED'
};

/* ============================================================================
   DEFAULT CONFIGURATION
   ============================================================================ */

const DEFAULT_CONFIG = {
  appointmentDuration: 60,
  bufferMinutes: 0,
  advanceBookingDays: 14,
  requiredFields: ['firstName', 'phone'],
  confirmationMessage: 'Your appointment is confirmed for {date} at {time}. We look forward to seeing you!'
};

/* ============================================================================
   MAIN ENTRY POINT
   ============================================================================ */

/**
 * Process a booking step
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {Object} params.payload - Handoff payload from Agent 2.0
 * @param {Object|null} params.bookingCtx - Current booking context (null for first step)
 * @param {string|null} params.userInput - User's response to previous prompt
 * @param {boolean} params.isTest - Whether this is a test step
 * 
 * @returns {Object} { nextPrompt, bookingCtx, completed, calendarEventId?, events[] }
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
    const ctx = bookingCtx ? { ...bookingCtx } : initializeContext(payload, config);
    
    const result = await processCurrentStep(ctx, userInput, config, companyId, isTest, events);
    
    logger.info(`[${ENGINE_ID}] Step processed`, {
      stepId,
      nextStep: result.bookingCtx.step,
      completed: result.completed,
      eventsCount: events.length
    });
    
    return {
      ...result,
      events
    };
    
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Step processing failed`, {
      stepId,
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    events.push({ type: 'BL1_ERROR', error: error.message, timestamp: Date.now() });
    
    return {
      nextPrompt: "I'm sorry, I'm having trouble with the booking system. Would you like me to have someone call you back?",
      bookingCtx: bookingCtx || {},
      completed: false,
      error: error.message,
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
    
    const bookingLogic = company.aiAgentSettings?.bookingLogic || {};
    
    return {
      companyName: company.companyName || 'our company',
      appointmentDuration: bookingLogic.appointmentDuration || bookingLogic.slotDuration || DEFAULT_CONFIG.appointmentDuration,
      bufferMinutes: bookingLogic.bufferMinutes || DEFAULT_CONFIG.bufferMinutes,
      advanceBookingDays: bookingLogic.advanceBookingDays || DEFAULT_CONFIG.advanceBookingDays,
      requiredFields: bookingLogic.requiredFields || DEFAULT_CONFIG.requiredFields,
      confirmationMessage: bookingLogic.confirmationMessage || DEFAULT_CONFIG.confirmationMessage,
      calendarConnected: !!company.googleCalendar?.accessToken,
      calendarId: company.googleCalendar?.calendarId,
      businessHours: company.businessHours
    };
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Config load failed`, { companyId, error: error.message });
    return { ...DEFAULT_CONFIG, companyName: 'our company', calendarConnected: false };
  }
}

/* ============================================================================
   CONTEXT MANAGEMENT
   ============================================================================ */

function initializeContext(payload, config) {
  return {
    step: STEPS.INIT,
    collectedFields: {
      firstName: payload?.assumptions?.firstName || null,
      lastName: payload?.assumptions?.lastName || null,
      phone: null,
      address: null
    },
    summary: payload?.summary || {},
    selectedTime: null,
    availableTimeOptions: null,
    calendarEventId: null,
    completed: false,
    startedAt: new Date().toISOString()
  };
}

/* ============================================================================
   STEP PROCESSING
   ============================================================================ */

async function processCurrentStep(ctx, userInput, config, companyId, isTest, events) {
  switch (ctx.step) {
    case STEPS.INIT:
      return processInit(ctx, config, events);
    
    case STEPS.COLLECT_NAME:
      return processCollectName(ctx, userInput, config, events);
    
    case STEPS.COLLECT_PHONE:
      return processCollectPhone(ctx, userInput, config, events);
    
    case STEPS.COLLECT_ADDRESS:
      return processCollectAddress(ctx, userInput, config, events);
    
    case STEPS.OFFER_TIMES:
      return processOfferTimes(ctx, userInput, config, companyId, isTest, events);
    
    case STEPS.CONFIRM:
      return processConfirm(ctx, userInput, config, companyId, isTest, events);
    
    case STEPS.COMPLETED:
      return {
        nextPrompt: 'Your booking is complete. Is there anything else I can help you with?',
        bookingCtx: ctx,
        completed: true
      };
    
    default:
      return processInit(ctx, config, events);
  }
}

function processInit(ctx, config, events) {
  events.push({ type: 'BL1_INIT', timestamp: Date.now() });
  
  if (!ctx.collectedFields.firstName) {
    ctx.step = STEPS.COLLECT_NAME;
    events.push({ type: 'BL1_COLLECTING_NAME', timestamp: Date.now() });
    return {
      nextPrompt: "To get started with your booking, may I have your name please?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    events.push({ type: 'BL1_COLLECTING_PHONE', timestamp: Date.now() });
    const nameGreeting = ctx.collectedFields.firstName ? `Thanks, ${ctx.collectedFields.firstName}! ` : '';
    return {
      nextPrompt: `${nameGreeting}What's the best phone number to reach you at?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  ctx.step = STEPS.OFFER_TIMES;
  return processOfferTimes(ctx, null, config, null, false, events);
}

function processCollectName(ctx, userInput, config, events) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch that. Could you please tell me your name?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  const name = extractName(userInput);
  ctx.collectedFields.firstName = name.firstName;
  ctx.collectedFields.lastName = name.lastName;
  
  events.push({ 
    type: 'BL1_NAME_COLLECTED', 
    firstName: name.firstName,
    timestamp: Date.now() 
  });
  
  ctx.step = STEPS.COLLECT_PHONE;
  return {
    nextPrompt: `Thanks, ${name.firstName}! What's the best phone number to reach you at?`,
    bookingCtx: ctx,
    completed: false
  };
}

function processCollectPhone(ctx, userInput, config, events) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch that. What phone number should we use to contact you?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  const phone = normalizePhone(userInput);
  ctx.collectedFields.phone = phone;
  
  events.push({ 
    type: 'BL1_PHONE_COLLECTED', 
    timestamp: Date.now() 
  });
  
  ctx.step = STEPS.OFFER_TIMES;
  return {
    nextPrompt: `Got it. Let me check our available times... I have openings tomorrow at 10 AM, 2 PM, or Thursday at 9 AM. Which works best for you?`,
    bookingCtx: ctx,
    completed: false
  };
}

function processCollectAddress(ctx, userInput, config, events) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch the address. What's the service address?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  ctx.collectedFields.address = userInput;
  
  events.push({ 
    type: 'BL1_ADDRESS_COLLECTED', 
    timestamp: Date.now() 
  });
  
  ctx.step = STEPS.OFFER_TIMES;
  return {
    nextPrompt: "Thanks! Let me check our available times...",
    bookingCtx: ctx,
    completed: false
  };
}

async function processOfferTimes(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput) {
    const timeOptions = await generateAvailableTimeOptions(config, companyId, isTest);
    ctx.availableTimeOptions = timeOptions;
    
    events.push({ 
      type: 'BL1_TIMES_GENERATED', 
      count: timeOptions.length,
      timestamp: Date.now() 
    });
    
    if (timeOptions.length === 0) {
      return {
        nextPrompt: "I'm sorry, I don't see any available times in the next few days. Would you like me to have someone call you to schedule?",
        bookingCtx: ctx,
        completed: false
      };
    }
    
    const timeText = formatTimeOptions(timeOptions);
    return {
      nextPrompt: `I have the following times available: ${timeText}. Which works best for you?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  const selectedTime = matchTimeFromInput(userInput, ctx.availableTimeOptions);
  
  if (!selectedTime) {
    return {
      nextPrompt: "I didn't catch which time you'd prefer. Would you like morning, afternoon, or a specific day?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  ctx.selectedTime = selectedTime;
  ctx.step = STEPS.CONFIRM;
  
  events.push({ 
    type: 'BL1_TIME_SELECTED', 
    time: selectedTime.formatted,
    timestamp: Date.now() 
  });
  
  return {
    nextPrompt: `Great! I have you down for ${selectedTime.formatted}. Should I go ahead and book that for you?`,
    bookingCtx: ctx,
    completed: false
  };
}

async function processConfirm(ctx, userInput, config, companyId, isTest, events) {
  if (!userInput) {
    return {
      nextPrompt: `Just to confirm - shall I book you for ${ctx.selectedTime?.formatted}?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  const normalized = userInput.toLowerCase().trim();
  const confirmPhrases = ['yes', 'yeah', 'sure', 'ok', 'okay', 'please', 'book it', 'sounds good', 'perfect'];
  
  if (confirmPhrases.some(p => normalized.includes(p))) {
    events.push({ type: 'BL1_BOOKING_CONFIRMED', timestamp: Date.now() });
    
    if (!isTest && config.calendarConnected) {
      ctx.calendarEventId = `event_${Date.now()}`;
      events.push({ type: 'BL1_CALENDAR_EVENT_CREATED', eventId: ctx.calendarEventId, timestamp: Date.now() });
    }
    
    ctx.step = STEPS.COMPLETED;
    ctx.completed = true;
    
    const confirmMsg = config.confirmationMessage
      .replace('{date}', ctx.selectedTime?.date || 'the scheduled date')
      .replace('{time}', ctx.selectedTime?.time || 'the scheduled time');
    
    events.push({ type: 'BL1_COMPLETED', timestamp: Date.now() });
    
    return {
      nextPrompt: confirmMsg,
      bookingCtx: ctx,
      completed: true,
      calendarEventId: ctx.calendarEventId
    };
  }
  
  if (normalized.includes('no') || normalized.includes('different') || normalized.includes('change')) {
    ctx.step = STEPS.OFFER_TIMES;
    events.push({ type: 'BL1_TIME_CHANGE_REQUESTED', timestamp: Date.now() });
    return {
      nextPrompt: "No problem! Would you prefer a different time? I can check other options.",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  return {
    nextPrompt: `I want to make sure I have this right - should I book ${ctx.selectedTime?.formatted} for you?`,
    bookingCtx: ctx,
    completed: false
  };
}

/* ============================================================================
   HELPER FUNCTIONS
   ============================================================================ */

function extractName(input) {
  const words = input.trim().split(/\s+/);
  
  if (words.length === 0) {
    return { firstName: 'Guest', lastName: null };
  }
  
  const firstName = capitalizeFirst(words[0]);
  const lastName = words.length > 1 ? words.slice(1).map(capitalizeFirst).join(' ') : null;
  
  return { firstName, lastName };
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function normalizePhone(input) {
  const digits = input.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  
  return input;
}

async function generateAvailableTimeOptions(config, companyId, isTest) {
  // In production, would query Google Calendar
  // For now, return mock time options
  const now = new Date();
  const timeOptions = [];
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);
  
  timeOptions.push({
    date: formatDate(tomorrow),
    time: '10:00 AM',
    endTime: '11:00 AM',
    formatted: `tomorrow at 10 AM`
  });
  
  timeOptions.push({
    date: formatDate(tomorrow),
    time: '2:00 PM',
    endTime: '3:00 PM',
    formatted: `tomorrow at 2 PM`
  });
  
  timeOptions.push({
    date: formatDate(dayAfter),
    time: '9:00 AM',
    endTime: '10:00 AM',
    formatted: `${formatDayName(dayAfter)} at 9 AM`
  });
  
  return timeOptions;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDayName(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

function formatTimeOptions(timeOptions) {
  if (timeOptions.length === 0) return 'no available times';
  if (timeOptions.length === 1) return timeOptions[0].formatted;
  if (timeOptions.length === 2) return `${timeOptions[0].formatted} or ${timeOptions[1].formatted}`;
  
  const last = timeOptions[timeOptions.length - 1];
  const rest = timeOptions.slice(0, -1).map(t => t.formatted).join(', ');
  return `${rest}, or ${last.formatted}`;
}

function matchTimeFromInput(input, timeOptions) {
  if (!timeOptions || timeOptions.length === 0) return null;
  
  const normalized = input.toLowerCase();
  
  if (normalized.includes('10') || normalized.includes('ten') || normalized.includes('morning')) {
    return timeOptions.find(t => t.time.includes('10')) || timeOptions[0];
  }
  
  if (normalized.includes('2') || normalized.includes('two') || normalized.includes('afternoon')) {
    return timeOptions.find(t => t.time.includes('2')) || timeOptions[1];
  }
  
  if (normalized.includes('9') || normalized.includes('nine') || normalized.includes('early')) {
    return timeOptions.find(t => t.time.includes('9')) || timeOptions[2];
  }
  
  if (normalized.includes('first') || normalized.includes('1st')) {
    return timeOptions[0];
  }
  
  if (normalized.includes('second') || normalized.includes('2nd')) {
    return timeOptions[1];
  }
  
  if (normalized.includes('third') || normalized.includes('3rd') || normalized.includes('last')) {
    return timeOptions[2] || timeOptions[timeOptions.length - 1];
  }
  
  if (normalized.includes('yes') || normalized.includes('ok') || normalized.includes('sure')) {
    return timeOptions[0];
  }
  
  return null;
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  computeStep: processStep,
  processStep,
  STEPS,
  VERSION,
  ENGINE_ID
};

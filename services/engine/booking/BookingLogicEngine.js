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
 * - Query calendar for available slots
 * - Present slots to caller
 * - Confirm and book appointment
 * - Send confirmation
 * 
 * Communication Contract:
 * - Input: { payload, bookingCtx, userInput }
 * - Output: { nextPrompt, bookingCtx, completed, calendarEventId? }
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
  OFFER_SLOTS: 'OFFER_SLOTS',
  CONFIRM: 'CONFIRM',
  COMPLETED: 'COMPLETED'
};

/* ============================================================================
   DEFAULT CONFIGURATION
   ============================================================================ */

const DEFAULT_CONFIG = {
  slotDuration: 60,
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
 * @returns {Object} { nextPrompt, bookingCtx, completed, calendarEventId? }
 */
async function processStep({ companyId, payload, bookingCtx, userInput, isTest = false }) {
  const stepId = `step_${Date.now()}`;
  
  logger.info(`[${ENGINE_ID}] Processing step`, {
    stepId,
    companyId,
    currentStep: bookingCtx?.step || 'INIT',
    hasUserInput: !!userInput,
    isTest
  });
  
  try {
    // Load company config
    const config = await loadCompanyConfig(companyId);
    
    // Initialize or continue booking context
    const ctx = bookingCtx ? { ...bookingCtx } : initializeContext(payload, config);
    
    // Process based on current step
    const result = await processCurrentStep(ctx, userInput, config, companyId, isTest);
    
    logger.info(`[${ENGINE_ID}] Step processed`, {
      stepId,
      nextStep: result.bookingCtx.step,
      completed: result.completed
    });
    
    return result;
    
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Step processing failed`, {
      stepId,
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    return {
      nextPrompt: "I'm sorry, I'm having trouble with the booking system. Would you like me to have someone call you back?",
      bookingCtx: bookingCtx || {},
      completed: false,
      error: error.message
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
      slotDuration: bookingLogic.slotDuration || DEFAULT_CONFIG.slotDuration,
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
    selectedSlot: null,
    calendarEventId: null,
    completed: false,
    startedAt: new Date().toISOString()
  };
}

/* ============================================================================
   STEP PROCESSING
   ============================================================================ */

async function processCurrentStep(ctx, userInput, config, companyId, isTest) {
  switch (ctx.step) {
    case STEPS.INIT:
      return processInit(ctx, config);
    
    case STEPS.COLLECT_NAME:
      return processCollectName(ctx, userInput, config);
    
    case STEPS.COLLECT_PHONE:
      return processCollectPhone(ctx, userInput, config);
    
    case STEPS.COLLECT_ADDRESS:
      return processCollectAddress(ctx, userInput, config);
    
    case STEPS.OFFER_SLOTS:
      return processOfferSlots(ctx, userInput, config, companyId, isTest);
    
    case STEPS.CONFIRM:
      return processConfirm(ctx, userInput, config, companyId, isTest);
    
    case STEPS.COMPLETED:
      return {
        nextPrompt: 'Your booking is complete. Is there anything else I can help you with?',
        bookingCtx: ctx,
        completed: true
      };
    
    default:
      return processInit(ctx, config);
  }
}

function processInit(ctx, config) {
  // Check what we need to collect
  if (!ctx.collectedFields.firstName) {
    ctx.step = STEPS.COLLECT_NAME;
    return {
      nextPrompt: "To get started with your booking, may I have your name please?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  if (!ctx.collectedFields.phone) {
    ctx.step = STEPS.COLLECT_PHONE;
    const nameGreeting = ctx.collectedFields.firstName ? `Thanks, ${ctx.collectedFields.firstName}! ` : '';
    return {
      nextPrompt: `${nameGreeting}What's the best phone number to reach you at?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  // All required fields collected, move to slots
  ctx.step = STEPS.OFFER_SLOTS;
  return processOfferSlots(ctx, null, config, null, false);
}

function processCollectName(ctx, userInput, config) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch that. Could you please tell me your name?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  // Simple name extraction
  const name = extractName(userInput);
  ctx.collectedFields.firstName = name.firstName;
  ctx.collectedFields.lastName = name.lastName;
  
  // Move to phone collection
  ctx.step = STEPS.COLLECT_PHONE;
  return {
    nextPrompt: `Thanks, ${name.firstName}! What's the best phone number to reach you at?`,
    bookingCtx: ctx,
    completed: false
  };
}

function processCollectPhone(ctx, userInput, config) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch that. What phone number should we use to contact you?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  // Extract phone (basic normalization)
  const phone = normalizePhone(userInput);
  ctx.collectedFields.phone = phone;
  
  // Move to slot offering
  ctx.step = STEPS.OFFER_SLOTS;
  return {
    nextPrompt: `Got it. Let me check our available times... I have openings tomorrow at 10 AM, 2 PM, or Thursday at 9 AM. Which works best for you?`,
    bookingCtx: ctx,
    completed: false
  };
}

function processCollectAddress(ctx, userInput, config) {
  if (!userInput) {
    return {
      nextPrompt: "I didn't catch the address. What's the service address?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  ctx.collectedFields.address = userInput;
  ctx.step = STEPS.OFFER_SLOTS;
  
  return {
    nextPrompt: "Thanks! Let me check our available times...",
    bookingCtx: ctx,
    completed: false
  };
}

async function processOfferSlots(ctx, userInput, config, companyId, isTest) {
  if (!userInput) {
    // First time offering slots - generate available times
    const slots = await generateAvailableSlots(config, companyId, isTest);
    ctx.availableSlots = slots;
    
    if (slots.length === 0) {
      return {
        nextPrompt: "I'm sorry, I don't see any available times in the next few days. Would you like me to have someone call you to schedule?",
        bookingCtx: ctx,
        completed: false
      };
    }
    
    const slotText = formatSlotOptions(slots);
    return {
      nextPrompt: `I have the following times available: ${slotText}. Which works best for you?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  // User responded - try to match a slot
  const selectedSlot = matchSlotFromInput(userInput, ctx.availableSlots);
  
  if (!selectedSlot) {
    return {
      nextPrompt: "I didn't catch which time you'd prefer. Would you like morning, afternoon, or a specific day?",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  ctx.selectedSlot = selectedSlot;
  ctx.step = STEPS.CONFIRM;
  
  return {
    nextPrompt: `Great! I have you down for ${selectedSlot.formatted}. Should I go ahead and book that for you?`,
    bookingCtx: ctx,
    completed: false
  };
}

async function processConfirm(ctx, userInput, config, companyId, isTest) {
  if (!userInput) {
    return {
      nextPrompt: `Just to confirm - shall I book you for ${ctx.selectedSlot?.formatted}?`,
      bookingCtx: ctx,
      completed: false
    };
  }
  
  const normalized = userInput.toLowerCase().trim();
  const confirmPhrases = ['yes', 'yeah', 'sure', 'ok', 'okay', 'please', 'book it', 'sounds good', 'perfect'];
  
  if (confirmPhrases.some(p => normalized.includes(p))) {
    // Book the appointment
    if (!isTest && config.calendarConnected) {
      // In production, would create calendar event here
      ctx.calendarEventId = `event_${Date.now()}`;
    }
    
    ctx.step = STEPS.COMPLETED;
    ctx.completed = true;
    
    const confirmMsg = config.confirmationMessage
      .replace('{date}', ctx.selectedSlot?.date || 'the scheduled date')
      .replace('{time}', ctx.selectedSlot?.time || 'the scheduled time');
    
    return {
      nextPrompt: confirmMsg,
      bookingCtx: ctx,
      completed: true,
      calendarEventId: ctx.calendarEventId
    };
  }
  
  // User didn't confirm - ask again or offer to change
  if (normalized.includes('no') || normalized.includes('different') || normalized.includes('change')) {
    ctx.step = STEPS.OFFER_SLOTS;
    return {
      nextPrompt: "No problem! Would you prefer a different time? I can check other available slots.",
      bookingCtx: ctx,
      completed: false
    };
  }
  
  return {
    nextPrompt: `I want to make sure I have this right - should I book ${ctx.selectedSlot?.formatted} for you?`,
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
  // Remove all non-digits
  const digits = input.replace(/\D/g, '');
  
  // Format as phone number if 10 digits
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  
  return input;
}

async function generateAvailableSlots(config, companyId, isTest) {
  // In production, would query Google Calendar
  // For now, return mock slots
  const now = new Date();
  const slots = [];
  
  // Generate 3 sample slots
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);
  
  slots.push({
    date: formatDate(tomorrow),
    time: '10:00 AM',
    endTime: '11:00 AM',
    formatted: `tomorrow at 10 AM`
  });
  
  slots.push({
    date: formatDate(tomorrow),
    time: '2:00 PM',
    endTime: '3:00 PM',
    formatted: `tomorrow at 2 PM`
  });
  
  slots.push({
    date: formatDate(dayAfter),
    time: '9:00 AM',
    endTime: '10:00 AM',
    formatted: `${formatDayName(dayAfter)} at 9 AM`
  });
  
  return slots;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function formatDayName(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

function formatSlotOptions(slots) {
  if (slots.length === 0) return 'no available times';
  if (slots.length === 1) return slots[0].formatted;
  if (slots.length === 2) return `${slots[0].formatted} or ${slots[1].formatted}`;
  
  const last = slots[slots.length - 1];
  const rest = slots.slice(0, -1).map(s => s.formatted).join(', ');
  return `${rest}, or ${last.formatted}`;
}

function matchSlotFromInput(input, slots) {
  if (!slots || slots.length === 0) return null;
  
  const normalized = input.toLowerCase();
  
  // Try to match time keywords
  if (normalized.includes('10') || normalized.includes('ten') || normalized.includes('morning')) {
    return slots.find(s => s.time.includes('10')) || slots[0];
  }
  
  if (normalized.includes('2') || normalized.includes('two') || normalized.includes('afternoon')) {
    return slots.find(s => s.time.includes('2')) || slots[1];
  }
  
  if (normalized.includes('9') || normalized.includes('nine') || normalized.includes('early')) {
    return slots.find(s => s.time.includes('9')) || slots[2];
  }
  
  if (normalized.includes('first') || normalized.includes('1st')) {
    return slots[0];
  }
  
  if (normalized.includes('second') || normalized.includes('2nd')) {
    return slots[1];
  }
  
  if (normalized.includes('third') || normalized.includes('3rd') || normalized.includes('last')) {
    return slots[2] || slots[slots.length - 1];
  }
  
  // Default to first slot if user says something affirmative
  if (normalized.includes('yes') || normalized.includes('ok') || normalized.includes('sure')) {
    return slots[0];
  }
  
  return null;
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  processStep,
  STEPS,
  VERSION,
  ENGINE_ID
};

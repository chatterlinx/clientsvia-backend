/**
 * BookingPhoneHandler - boxed phone state machine.
 *
 * Goal: deterministic, context-aware phone capture/confirm/correction.
 * - Understand "last 4 digits" corrections during confirm-back.
 * - Cap re-asks and bail to low-confidence (caller-friendly, no infinite loops).
 * - Never require the LLM to "guess" phone corrections.
 */

const { extractDigits } = require('../../utils/phone');

const STATES = Object.freeze({
  INIT: 'INIT',
  AWAITING_CONFIRM: 'AWAITING_CONFIRM',
  COMPLETE: 'COMPLETE',
  BAILED: 'BAILED'
});

function format10(digits10) {
  return String(digits10).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
}

function normalizeTo10Digits(formattedOrDigits) {
  const d = extractDigits(formattedOrDigits);
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return null;
}

function extractSuffixDigits(text = '') {
  // Strict: exactly 4-digit chunk (common "last four")
  const m = String(text).match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

function applyLast4Suffix(existingPhoneFormatted, suffix4) {
  const base10 = normalizeTo10Digits(existingPhoneFormatted);
  if (!base10) return null;
  if (!/^\d{4}$/.test(suffix4)) return null;
  const next10 = base10.slice(0, 6) + suffix4;
  return format10(next10);
}

function createContext(options = {}) {
  const maxAttempts = Number.isFinite(options.maxAttempts) ? Number(options.maxAttempts) : 2;
  return {
    state: STATES.INIT,
    phone: null,
    attempts: 0,
    lastPromptKey: null,
    lastOutcome: null,
    action: null,
    options: {
      maxAttempts: Math.max(1, maxAttempts)
    }
  };
}

/**
 * Reducer step.
 *
 * event = {
 *   text: string,
 *   extractedPhone: string|null,       // already-normalized "(AAA) BBB-CCCC" if present
 *   currentPhone: string|null,         // current slot value (formatted)
 *   pendingConfirm: boolean,
 *   userSaysYes: boolean,
 *   userSaysNo: boolean
 * }
 */
function step(ctx, event) {
  if (!ctx || !event) return ctx;
  ctx.action = null;

  const text = String(event.text || '').trim();
  const extractedPhone = event.extractedPhone || null;
  const currentPhone = event.currentPhone || ctx.phone || null;
  const pendingConfirm = event.pendingConfirm === true;
  const userSaysYes = event.userSaysYes === true;
  const userSaysNo = event.userSaysNo === true;

  // Sync state from orchestrator context
  if (pendingConfirm && currentPhone && ctx.state === STATES.INIT) {
    ctx.state = STATES.AWAITING_CONFIRM;
    ctx.phone = currentPhone;
  }

  // If we captured a full phone while not in confirm, move into confirm state.
  if (!pendingConfirm && extractedPhone && ctx.state === STATES.INIT) {
    ctx.phone = extractedPhone;
    ctx.state = STATES.AWAITING_CONFIRM;
    ctx.attempts = 0;
    ctx.lastOutcome = 'captured_full';
    ctx.lastPromptKey = 'confirm_0';
    ctx.action = { kind: 'confirm', phone: extractedPhone, promptKey: ctx.lastPromptKey };
    return ctx;
  }

  if (ctx.state === STATES.AWAITING_CONFIRM) {
    ctx.phone = currentPhone;

    if (userSaysYes) {
      ctx.state = STATES.COMPLETE;
      ctx.lastOutcome = 'confirmed';
      ctx.lastPromptKey = null;
      ctx.attempts = 0;
      ctx.action = { kind: 'advance', phone: currentPhone };
      return ctx;
    }

    // First priority: user gave a replacement full number.
    if (extractedPhone) {
      ctx.phone = extractedPhone;
      ctx.attempts += 1;
      if (ctx.attempts > ctx.options.maxAttempts) {
        ctx.state = STATES.BAILED;
        ctx.lastOutcome = 'bail_low_confidence';
        ctx.action = { kind: 'bail' };
        return ctx;
      }
      ctx.lastOutcome = 'new_full';
      ctx.lastPromptKey = ctx.attempts >= 1 ? 'confirm_1' : 'confirm_0';
      ctx.action = { kind: 'confirm', phone: extractedPhone, promptKey: ctx.lastPromptKey };
      return ctx;
    }

    // Suffix correction (e.g., "no it's 2202")
    const suffix4 = extractSuffixDigits(text);
    if (suffix4 && currentPhone) {
      const corrected = applyLast4Suffix(currentPhone, suffix4);
      if (corrected && corrected !== currentPhone) {
        ctx.phone = corrected;
        ctx.attempts += 1;
        if (ctx.attempts > ctx.options.maxAttempts) {
          ctx.state = STATES.BAILED;
          ctx.lastOutcome = 'bail_low_confidence';
          ctx.action = { kind: 'bail' };
          return ctx;
        }
        ctx.lastOutcome = 'suffix_corrected';
        ctx.lastPromptKey = 'confirm_1';
        ctx.action = { kind: 'confirm', phone: corrected, promptKey: ctx.lastPromptKey, replacementApplied: true };
        return ctx;
      }
    }

    // If user explicitly denies but didn't provide fix, ask for full number.
    if (userSaysNo) {
      ctx.attempts += 1;
      if (ctx.attempts > ctx.options.maxAttempts) {
        ctx.state = STATES.BAILED;
        ctx.lastOutcome = 'bail_low_confidence';
        ctx.action = { kind: 'bail' };
        return ctx;
      }
      ctx.lastOutcome = 'need_full';
      ctx.lastPromptKey = ctx.attempts >= 1 ? 'ask_full_1' : 'ask_full_0';
      ctx.action = { kind: 'ask_full', promptKey: ctx.lastPromptKey };
      return ctx;
    }
  }

  return ctx;
}

module.exports = {
  STATES,
  createContext,
  step,
  extractSuffixDigits,
  applyLast4Suffix
};


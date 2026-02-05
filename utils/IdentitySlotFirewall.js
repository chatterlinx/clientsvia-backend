/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * IDENTITY SLOT FIREWALL (V96i)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * SINGLE POINT OF TRUTH for all identity slot mutations.
 * 
 * Problem: Multiple modules were writing to name/phone/address slots, causing
 * contamination (e.g., "Air Conditioning" being written as name).
 * 
 * Solution: ALL identity slot writes MUST go through this firewall.
 * - Validates the write
 * - Enforces immutability rules
 * - Emits SLOT_WRITE_TRACE_V1 for every attempt
 * - Emits IDENTITY_CONTRACT_VIOLATION for unauthorized writes
 * 
 * Rule: This is the ONLY code allowed to mutate identity slots.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// Identity slots that are protected by this firewall
const IDENTITY_SLOTS = ['name', 'firstName', 'lastName', 'partialName', 'phone', 'address'];

// Authorized writers (module names that are allowed to write identity slots)
const AUTHORIZED_WRITERS = [
  'SlotExtractor.extractAll',
  'SlotExtractor.mergeSlots',
  'BookingFlowRunner.extractSlotFromUtterance',
  'v2twilio.slotMerge'
];

// Stopwords that should NEVER be accepted as names
const NAME_STOPWORDS = [
  'air conditioning', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical',
  'currently', 'somebody', 'someone', 'nobody', 'anyone', 'everybody',
  'hello', 'hi', 'hey', 'yes', 'no', 'yeah', 'yep', 'nope', 'ok', 'okay',
  'the', 'a', 'an', 'this', 'that', 'it', 'they', 'we', 'you', 'i',
  'need', 'want', 'help', 'service', 'repair', 'fix', 'install', 'replace',
  'appointment', 'booking', 'schedule', 'call', 'phone', 'address',
  'thermostat', 'furnace', 'water heater', 'toilet', 'sink', 'faucet',
  'air', 'conditioning', 'unit', 'system', 'equipment'
];

// Phone patterns that look like phones (not names)
const PHONE_PATTERN = /^[\d\s\-\(\)\+\.]{7,}$/;

// Invalid characters for names
const INVALID_NAME_CHARS = /[0-9@#$%^&*()_+=\[\]{}|\\<>\/]/;

/**
 * Mask a value for logging (PII protection)
 */
function maskValue(slot, value) {
  if (!value) return null;
  const val = String(value);
  
  if (slot === 'phone') {
    return val.length > 4 ? '***' + val.slice(-4) : '****';
  }
  
  if (slot === 'address') {
    const parts = val.split(' ');
    if (parts.length > 0 && /^\d+$/.test(parts[0])) {
      parts[0] = '***';
    }
    return parts.join(' ');
  }
  
  // Names: keep full for debugging (not PII in call context)
  return val;
}

/**
 * Validate a name value
 * Returns { valid: boolean, reason: string }
 */
function validateName(value) {
  if (!value || typeof value !== 'string') {
    return { valid: false, reason: 'empty_or_invalid_type' };
  }
  
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  
  // Check stopwords
  for (const stopword of NAME_STOPWORDS) {
    if (lower === stopword || lower.includes(stopword)) {
      return { valid: false, reason: `stopword_${stopword.replace(/\s+/g, '_')}` };
    }
  }
  
  // Check if it looks like a phone number
  if (PHONE_PATTERN.test(trimmed)) {
    return { valid: false, reason: 'looksLikePhone' };
  }
  
  // Check for invalid characters
  if (INVALID_NAME_CHARS.test(trimmed)) {
    return { valid: false, reason: 'invalid_chars' };
  }
  
  // Too short (likely not a name)
  if (trimmed.length < 2) {
    return { valid: false, reason: 'too_short' };
  }
  
  // Too long (likely a sentence, not a name)
  if (trimmed.length > 50) {
    return { valid: false, reason: 'too_long' };
  }
  
  return { valid: true, reason: 'passed_validation' };
}

/**
 * Check if a slot is immutable (already confirmed)
 */
function isImmutable(slots, slotId) {
  const slot = slots?.[slotId];
  if (!slot) return false;
  
  return slot.immutable === true || 
         slot.confirmed === true || 
         slot.nameLocked === true;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MAIN ENTRY POINT: safeSetIdentitySlot
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * The ONLY function allowed to write to identity slots.
 * 
 * @param {Object} slots - The slots object to mutate
 * @param {string} slotId - Which slot to write (name, phone, address, etc.)
 * @param {any} value - The value to write
 * @param {Object} meta - Metadata about the write
 * @param {string} meta.writer - Who is writing (e.g., 'SlotExtractor.extractAll')
 * @param {string} meta.callsite - Where in code (e.g., 'ConversationEngine:1234')
 * @param {number} meta.confidence - Confidence score (0-1)
 * @param {string} meta.source - How it was extracted (e.g., 'explicit_my_name_is')
 * @param {string} meta.callId - Call ID for tracing
 * @param {string} meta.companyId - Company ID for tracing
 * @param {number} meta.turn - Turn number
 * @param {boolean} meta.forceOverwrite - If true, can overwrite immutable (explicit correction)
 * 
 * @returns {Object} { accepted: boolean, reason: string, beforeValue: any, afterValue: any }
 */
function safeSetIdentitySlot(slots, slotId, value, meta = {}) {
  const {
    writer = 'UNKNOWN',
    callsite = 'UNKNOWN',
    confidence = 0,
    source = 'UNKNOWN',
    callId = null,
    companyId = null,
    turn = 0,
    forceOverwrite = false
  } = meta;
  
  // Capture before state
  const beforeSlot = slots?.[slotId];
  const beforeValue = beforeSlot?.value;
  const beforeMasked = maskValue(slotId, beforeValue);
  const attemptedMasked = maskValue(slotId, value);
  
  let accepted = false;
  let reason = 'unknown';
  let afterValue = beforeValue;
  
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1: Is this an identity slot?
    // ═══════════════════════════════════════════════════════════════════════════
    if (!IDENTITY_SLOTS.includes(slotId)) {
      // Not an identity slot - this firewall doesn't apply
      // Allow the write but don't trace it
      if (slots) {
        slots[slotId] = {
          value,
          confidence,
          source,
          updatedAt: new Date().toISOString()
        };
      }
      return { accepted: true, reason: 'not_identity_slot', beforeValue, afterValue: value };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 2: Is the writer authorized?
    // ═══════════════════════════════════════════════════════════════════════════
    const isAuthorized = AUTHORIZED_WRITERS.some(aw => writer.includes(aw));
    
    if (!isAuthorized) {
      reason = 'unauthorized_writer';
      
      // Log violation
      logger.warn('[IDENTITY CONTRACT VIOLATION] ⛔ Unauthorized write attempt', {
        slot: slotId,
        writer,
        callsite,
        attemptedValueMasked: attemptedMasked,
        callId,
        turn
      });
      
      // Emit violation event
      emitViolation({
        slot: slotId,
        writer,
        callsite,
        attemptedValueMasked: attemptedMasked,
        reason: 'unauthorized_writer',
        callId,
        companyId,
        turn
      });
      
      // Reject the write
      emitWriteTrace({
        slot: slotId,
        attemptedValueMasked: attemptedMasked,
        accepted: false,
        reason,
        writer,
        callsite,
        beforeMasked,
        afterMasked: beforeMasked,
        confidence,
        sourcePattern: source,
        callId,
        companyId,
        turn
      });
      
      return { accepted: false, reason, beforeValue, afterValue: beforeValue };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 3: Validate the value (for name slots)
    // ═══════════════════════════════════════════════════════════════════════════
    if (['name', 'firstName', 'lastName', 'partialName'].includes(slotId)) {
      const validation = validateName(value);
      if (!validation.valid) {
        reason = validation.reason;
        
        logger.info('[IDENTITY FIREWALL] ❌ Name validation failed', {
          slot: slotId,
          attemptedValueMasked: attemptedMasked,
          reason,
          writer
        });
        
        emitWriteTrace({
          slot: slotId,
          attemptedValueMasked: attemptedMasked,
          accepted: false,
          reason,
          writer,
          callsite,
          beforeMasked,
          afterMasked: beforeMasked,
          confidence,
          sourcePattern: source,
          callId,
          companyId,
          turn
        });
        
        return { accepted: false, reason, beforeValue, afterValue: beforeValue };
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 4: Check immutability
    // ═══════════════════════════════════════════════════════════════════════════
    if (isImmutable(slots, slotId) && !forceOverwrite) {
      reason = 'immutable_protected';
      
      logger.info('[IDENTITY FIREWALL] 🔒 Immutable slot protected', {
        slot: slotId,
        currentValue: beforeMasked,
        attemptedValue: attemptedMasked,
        writer
      });
      
      emitWriteTrace({
        slot: slotId,
        attemptedValueMasked: attemptedMasked,
        accepted: false,
        reason,
        writer,
        callsite,
        beforeMasked,
        afterMasked: beforeMasked,
        confidence,
        sourcePattern: source,
        callId,
        companyId,
        turn
      });
      
      return { accepted: false, reason, beforeValue, afterValue: beforeValue };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 5: Confidence check (don't overwrite high confidence with low)
    // ═══════════════════════════════════════════════════════════════════════════
    const existingConfidence = beforeSlot?.confidence || 0;
    if (beforeValue && confidence < existingConfidence && !forceOverwrite) {
      reason = 'lower_confidence';
      
      logger.info('[IDENTITY FIREWALL] ⬇️ Lower confidence rejected', {
        slot: slotId,
        existingConfidence,
        attemptedConfidence: confidence,
        writer
      });
      
      emitWriteTrace({
        slot: slotId,
        attemptedValueMasked: attemptedMasked,
        accepted: false,
        reason,
        writer,
        callsite,
        beforeMasked,
        afterMasked: beforeMasked,
        confidence,
        sourcePattern: source,
        callId,
        companyId,
        turn
      });
      
      return { accepted: false, reason, beforeValue, afterValue: beforeValue };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ALL GATES PASSED - Accept the write
    // ═══════════════════════════════════════════════════════════════════════════
    accepted = true;
    reason = beforeValue ? 'higher_confidence_overwrite' : 'new_slot';
    afterValue = value;
    
    // Perform the write
    if (!slots) {
      logger.warn('[IDENTITY FIREWALL] ⚠️ Slots object is null/undefined');
      return { accepted: false, reason: 'slots_object_null', beforeValue, afterValue: beforeValue };
    }
    
    slots[slotId] = {
      value,
      confidence,
      source,
      patternSource: source,
      updatedAt: new Date().toISOString(),
      writer,
      // Preserve existing flags if any
      ...(beforeSlot?.immutable && { immutable: beforeSlot.immutable }),
      ...(beforeSlot?.confirmed && { confirmed: beforeSlot.confirmed }),
      ...(beforeSlot?.nameLocked && { nameLocked: beforeSlot.nameLocked })
    };
    
    logger.info('[IDENTITY FIREWALL] ✅ Slot write accepted', {
      slot: slotId,
      beforeMasked,
      afterMasked: attemptedMasked,
      reason,
      writer,
      confidence
    });
    
    emitWriteTrace({
      slot: slotId,
      attemptedValueMasked: attemptedMasked,
      accepted: true,
      reason,
      writer,
      callsite,
      beforeMasked,
      afterMasked: attemptedMasked,
      confidence,
      sourcePattern: source,
      callId,
      companyId,
      turn
    });
    
  } catch (err) {
    // Firewall must never crash - log and continue
    logger.error('[IDENTITY FIREWALL] ❌ Error in firewall (continuing)', {
      error: err.message,
      slot: slotId,
      writer
    });
    reason = 'firewall_error';
    accepted = false;
  }
  
  return { accepted, reason, beforeValue, afterValue };
}

/**
 * Emit SLOT_WRITE_TRACE_V1 event
 */
function emitWriteTrace(data) {
  try {
    const BlackBoxLogger = require('../services/BlackBoxLogger');
    if (BlackBoxLogger && data.callId) {
      BlackBoxLogger.logEvent({
        callId: data.callId,
        companyId: data.companyId,
        type: 'SLOT_WRITE_TRACE_V1',
        turn: data.turn,
        data: {
          slot: data.slot,
          attemptedValueMasked: data.attemptedValueMasked,
          accepted: data.accepted,
          reason: data.reason,
          writer: data.writer,
          callsite: data.callsite,
          beforeMasked: data.beforeMasked,
          afterMasked: data.afterMasked,
          confidence: data.confidence,
          sourcePattern: data.sourcePattern
        }
      }).catch(() => {});
    }
  } catch (err) {
    // Trace errors must never crash the call
    logger.warn('[IDENTITY FIREWALL] Trace emit failed', { error: err.message });
  }
}

/**
 * Emit IDENTITY_CONTRACT_VIOLATION event
 */
function emitViolation(data) {
  try {
    const BlackBoxLogger = require('../services/BlackBoxLogger');
    if (BlackBoxLogger && data.callId) {
      BlackBoxLogger.logEvent({
        callId: data.callId,
        companyId: data.companyId,
        type: 'IDENTITY_CONTRACT_VIOLATION',
        turn: data.turn,
        data: {
          slot: data.slot,
          writer: data.writer,
          callsite: data.callsite,
          attemptedValueMasked: data.attemptedValueMasked,
          reason: data.reason
        }
      }).catch(() => {});
    }
  } catch (err) {
    // Violation logging must never crash the call
    logger.warn('[IDENTITY FIREWALL] Violation emit failed', { error: err.message });
  }
}

/**
 * Check if a writer is authorized (for external validation)
 */
function isAuthorizedWriter(writer) {
  return AUTHORIZED_WRITERS.some(aw => writer.includes(aw));
}

/**
 * Get list of identity slots (for external reference)
 */
function getIdentitySlots() {
  return [...IDENTITY_SLOTS];
}

/**
 * Add an authorized writer at runtime (for testing)
 */
function addAuthorizedWriter(writer) {
  if (!AUTHORIZED_WRITERS.includes(writer)) {
    AUTHORIZED_WRITERS.push(writer);
  }
}

module.exports = {
  safeSetIdentitySlot,
  isAuthorizedWriter,
  getIdentitySlots,
  addAuthorizedWriter,
  validateName,
  IDENTITY_SLOTS,
  AUTHORIZED_WRITERS
};

/**
 * Phase 7: TwiML Say Guard
 * Prevents any accidental Twilio voice synthesis - ensures ONLY ElevenLabs speaks
 * Feature-flagged implementation for surgical rollout/rollback
 */

const { VoiceResponse } = require('twilio').twiml;
const logger = require('../../utils/logger');
const { KILL_TWIML_SAY } = require('../../config/flags');

let armed = false;

/**
 * Arms the TwiML Say guard to block any <Say> verb usage
 * When armed, any call to twiml.say() becomes a no-op with error logging
 */
function armTwilioSayGuard() {
  if (armed || !KILL_TWIML_SAY) {
    if (armed) {
      logger.debug('[VOICE_GUARD] TwiML Say guard already armed');
    } else {
      logger.debug('[VOICE_GUARD] TwiML Say guard disabled (KILL_TWIML_SAY=off)');
    }
    return;
  }

  // Store the original say method before we override it
  const originalSay = VoiceResponse.prototype.say;
  
  // Override the say method to prevent Twilio voice synthesis
  VoiceResponse.prototype.say = function guardedSay(...args) {
    // Log the blocked attempt with full context
    logger.error('[VOICE_GUARD] ⚔️ TwiML <Say> BLOCKED! Only ElevenLabs should speak.', {
      args,
      stackTrace: new Error().stack.split('\n').slice(1, 4), // First 3 stack frames
      timestamp: new Date().toISOString(),
      guardActive: true
    });
    
    // Return this to maintain method chaining compatibility
    // This prevents downstream code from breaking while blocking speech
    return this;
  };

  // Mark as armed and log successful activation
  armed = true;
  logger.info('[VOICE_GUARD] 🛡️ TwiML Say guard ARMED (KILL_TWIML_SAY=on). Twilio voice synthesis BLOCKED.');
  
  // Add a safety check method to verify guard status
  VoiceResponse.prototype._isSayGuarded = function() {
    return armed;
  };
}

/**
 * Disarms the guard (for testing or emergency rollback)
 * Note: This requires a restart to fully restore original functionality
 */
function disarmTwilioSayGuard() {
  if (!armed) {
    logger.debug('[VOICE_GUARD] TwiML Say guard already disarmed');
    return;
  }
  
  armed = false;
  logger.warn('[VOICE_GUARD] ⚠️ TwiML Say guard DISARMED. Restart required for full restoration.');
}

/**
 * Check if the guard is currently active
 */
function isGuardArmed() {
  return armed && KILL_TWIML_SAY;
}

/**
 * Validate that no TwiML Say calls are present in a response
 * Useful for testing and validation
 */
function validateNoSayInTwiML(twimlString) {
  const hasSay = /<Say\b[^>]*>/i.test(twimlString);
  if (hasSay && KILL_TWIML_SAY) {
    logger.error('[VOICE_GUARD] ❌ TwiML contains <Say> verb despite guard being active!', {
      twimlPreview: twimlString.substring(0, 200) + '...',
      guardActive: armed
    });
    return false;
  }
  return true;
}

module.exports = {
  armTwilioSayGuard,
  disarmTwilioSayGuard,
  isGuardArmed,
  validateNoSayInTwiML
};

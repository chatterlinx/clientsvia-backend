/**
 * ============================================================================
 * LOW CONFIDENCE HANDLER SERVICE
 * ============================================================================
 * 
 * STT QUALITY GUARD - Prevents wrong interpretations from low-confidence transcripts.
 * 
 * When STT confidence is below threshold:
 * 1. Ask caller to repeat (politely)
 * 2. Track repeat count per call
 * 3. Log to Black Box for vocabulary training
 * 4. Escalate to human after max repeats
 * 
 * PRIORITY ORDER IN CALL FLOW:
 * 1. Silence check
 * 2. Low confidence check ← THIS SERVICE
 * 3. Spam detection
 * 4. Booking hard lock
 * 5. Normal processing (Brain-1 → Triage → etc.)
 * 
 * DESIGN PRINCIPLES:
 * - One repeat prompt is forgivable
 * - Wrong interpretation is unforgivable
 * - Protects revenue by preventing misunderstandings
 * - Same approach as Google Contact Center AI, Amazon Lex, Five9
 * 
 * ============================================================================
 */

const BlackBoxLogger = require('./BlackBoxLogger');
const logger = require('../utils/logger');

// Default settings (used if company hasn't configured)
const DEFAULTS = {
    enabled: true,
    threshold: 60,  // 0-100%
    action: 'repeat',
    repeatPhrase: "Sorry, there's some background noise — could you say that again?",
    maxRepeatsBeforeEscalation: 2,
    escalatePhrase: "I'm having trouble hearing you clearly. Let me get someone to help you.",
    preserveBookingOnLowConfidence: true,
    bookingRepeatPhrase: "Sorry, I didn't catch that. Could you repeat that for me?",
    logToBlackBox: true
};

/**
 * Check if STT confidence is below threshold and return appropriate action
 * 
 * @param {Object} params
 * @param {number} params.confidence - STT confidence (0-1 from Twilio)
 * @param {string} params.transcript - The raw transcript
 * @param {Object} params.callState - Current call state (must have lowConfidenceRepeats)
 * @param {Object} params.company - Company document with llm0Controls
 * @param {string} params.callId - Twilio CallSid
 * @param {number} params.turn - Current conversation turn
 * @param {boolean} params.isInBookingMode - Whether booking flow is active
 * @returns {Object|null} - Action object or null if confidence is OK
 */
async function checkConfidence({
    confidence,
    transcript,
    callState,
    company,
    callId,
    turn = 0,
    isInBookingMode = false
}) {
    // Get settings from company or use defaults
    const settings = {
        ...DEFAULTS,
        ...(company?.llm0Controls?.lowConfidenceHandling || {})
    };

    // If disabled, skip check
    if (!settings.enabled) {
        logger.debug('[LOW CONFIDENCE] Handler disabled, skipping check');
        return null;
    }

    // Convert confidence from 0-1 to 0-100 for comparison
    const confidencePercent = confidence * 100;
    const threshold = settings.threshold;

    logger.debug(`[LOW CONFIDENCE] Confidence: ${confidencePercent.toFixed(1)}% | Threshold: ${threshold}%`);

    // If confidence is above threshold, we're good
    if (confidencePercent >= threshold) {
        logger.debug(`[LOW CONFIDENCE] ✅ Confidence OK (${confidencePercent.toFixed(1)}% >= ${threshold}%)`);
        return null;
    }

    // Low confidence detected!
    const companyId = company?._id?.toString();

    // Increment repeat counter in call state
    const repeatCount = (callState.lowConfidenceRepeats || 0) + 1;
    callState.lowConfidenceRepeats = repeatCount;

    logger.info(`[LOW CONFIDENCE] ⚠️ Low confidence detected: ${confidencePercent.toFixed(1)}% < ${threshold}% (repeat #${repeatCount})`);

    // Log to Black Box for training data
    if (settings.logToBlackBox && callId && companyId) {
        try {
            await BlackBoxLogger.QuickLog.lowConfidenceHit(
                callId,
                companyId,
                turn,
                confidencePercent,
                transcript,
                repeatCount
            );
        } catch (logError) {
            logger.warn('[LOW CONFIDENCE] Failed to log to Black Box (non-fatal)', logError.message);
        }
    }

    // Check if max repeats exceeded
    if (repeatCount > settings.maxRepeatsBeforeEscalation) {
        logger.warn(`[LOW CONFIDENCE] 🚨 Max repeats exceeded (${repeatCount} > ${settings.maxRepeatsBeforeEscalation}) - escalating to human`);

        // Log escalation event
        if (settings.logToBlackBox && callId && companyId) {
            try {
                await BlackBoxLogger.QuickLog.lowConfidenceEscalation(
                    callId,
                    companyId,
                    turn,
                    repeatCount,
                    'Max repeats exceeded due to persistent low STT confidence'
                );
            } catch (logError) {
                logger.warn('[LOW CONFIDENCE] Failed to log escalation to Black Box', logError.message);
            }
        }

        return {
            action: 'escalate',
            text: settings.escalatePhrase,
            meta: {
                reason: 'LOW_CONFIDENCE_ESCALATION',
                repeatCount,
                confidence: confidencePercent,
                threshold,
                transcript
            }
        };
    }

    // Determine which repeat phrase to use
    let repeatPhrase;
    if (isInBookingMode && settings.preserveBookingOnLowConfidence) {
        repeatPhrase = settings.bookingRepeatPhrase;
        logger.debug('[LOW CONFIDENCE] Using booking repeat phrase (preserving booking flow)');
    } else {
        repeatPhrase = settings.repeatPhrase;
    }

    // Return action to ask for repeat
    return {
        action: 'repeat',
        text: repeatPhrase,
        meta: {
            reason: 'LOW_CONFIDENCE_REPROMPT',
            repeatCount,
            confidence: confidencePercent,
            threshold,
            transcript,
            preserveBookingMode: isInBookingMode && settings.preserveBookingOnLowConfidence
        }
    };
}

/**
 * Reset the low confidence repeat counter
 * Call this when a high-confidence transcript is received
 */
function resetRepeatCounter(callState) {
    if (callState && callState.lowConfidenceRepeats) {
        logger.debug(`[LOW CONFIDENCE] Resetting repeat counter (was ${callState.lowConfidenceRepeats})`);
        callState.lowConfidenceRepeats = 0;
    }
}

/**
 * Get the current settings for a company (for UI display)
 */
function getSettings(company) {
    return {
        ...DEFAULTS,
        ...(company?.llm0Controls?.lowConfidenceHandling || {})
    };
}

/**
 * Validate settings (for API input)
 */
function validateSettings(settings) {
    const errors = [];

    if (settings.threshold !== undefined) {
        if (typeof settings.threshold !== 'number' || settings.threshold < 30 || settings.threshold > 90) {
            errors.push('threshold must be a number between 30 and 90');
        }
    }

    if (settings.action !== undefined) {
        if (!['repeat', 'guess_with_context', 'accept'].includes(settings.action)) {
            errors.push('action must be one of: repeat, guess_with_context, accept');
        }
    }

    if (settings.maxRepeatsBeforeEscalation !== undefined) {
        if (typeof settings.maxRepeatsBeforeEscalation !== 'number' || 
            settings.maxRepeatsBeforeEscalation < 1 || 
            settings.maxRepeatsBeforeEscalation > 5) {
            errors.push('maxRepeatsBeforeEscalation must be between 1 and 5');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    checkConfidence,
    resetRepeatCounter,
    getSettings,
    validateSettings,
    DEFAULTS
};


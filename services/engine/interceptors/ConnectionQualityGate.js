/**
 * ════════════════════════════════════════════════════════════════════════════
 * CONNECTION QUALITY GATE (S1.5)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Detects connection issues on early turns (1-2) and handles gracefully.
 * Without this, "hello? are you there?" gets treated as a real question.
 * 
 * Config: frontDeskBehavior.connectionQualityGate
 * 
 * Triggers:
 * - Trouble phrases: "hello?", "are you there?", "can you hear me?"
 * - Low STT confidence (< threshold)
 * 
 * Actions:
 * - First few occurrences → re-greet/clarify
 * - After maxRetries → DTMF escape (press 1 for human)
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const DEFAULT_TROUBLE_PHRASES = [
    'hello', 'hello?', 'hi', 'hi?', 'are you there',
    'can you hear me', 'is anyone there', 'is somebody there',
    'hey', 'hey?', 'anybody there'
];

const DEFAULT_CLARIFICATION = "I'm sorry, I didn't quite catch that. Could you please repeat what you said?";
const DEFAULT_DTMF_MESSAGE = "I'm sorry, we seem to have a bad connection. Press 1 to speak with a service advisor, or press 2 to leave a voicemail.";
const DEFAULT_THRESHOLD = 0.72;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Check for connection trouble
 * 
 * @param {Object} params
 * @param {string} params.inputText - User's utterance
 * @param {number} params.sttConfidence - Speech-to-text confidence (0-1)
 * @param {number} params.turn - Current turn number
 * @param {number} params.troubleCount - Previous trouble count from state
 * @param {Object} params.config - Company connectionQualityGate config
 * @returns {Object} { trouble, reason, action, message, troubleCount }
 */
function check({ inputText, sttConfidence, turn, troubleCount = 0, config = {} }) {
    const enabled = config.enabled !== false;
    const threshold = config.confidenceThreshold || DEFAULT_THRESHOLD;
    const maxRetries = config.maxRetries || DEFAULT_MAX_RETRIES;
    const troublePhrases = config.troublePhrases || DEFAULT_TROUBLE_PHRASES;
    const clarificationPrompt = config.clarificationPrompt || config.reGreeting || DEFAULT_CLARIFICATION;
    const dtmfMessage = config.dtmfEscapeMessage || DEFAULT_DTMF_MESSAGE;
    
    // Only run on early turns (1-2)
    const isEarlyTurn = turn <= 2;
    
    if (!enabled || !isEarlyTurn || !inputText) {
        return { 
            trouble: false, 
            reason: null, 
            action: 'CONTINUE',
            troubleCount 
        };
    }
    
    const inputLower = inputText.toLowerCase().trim();
    let trouble = false;
    let reason = null;
    
    // Check 1: Trouble phrase
    const matchedPhrase = troublePhrases.find(phrase => {
        const phraseLower = phrase.toLowerCase().trim();
        return inputLower === phraseLower || 
               inputLower.startsWith(phraseLower + ' ') ||
               inputLower.endsWith(' ' + phraseLower) ||
               inputLower.includes(' ' + phraseLower + ' ');
    });
    
    if (matchedPhrase) {
        trouble = true;
        reason = 'TROUBLE_PHRASE';
    }
    
    // Check 2: Low STT confidence
    if (!trouble && sttConfidence < threshold) {
        trouble = true;
        reason = 'LOW_STT_CONFIDENCE';
    }
    
    if (!trouble) {
        return { 
            trouble: false, 
            reason: null, 
            action: 'CONTINUE',
            troubleCount: 0 // Reset on clean turn
        };
    }
    
    // Trouble detected
    const newTroubleCount = troubleCount + 1;
    
    if (newTroubleCount >= maxRetries) {
        // Max retries exceeded - DTMF escape
        return {
            trouble: true,
            reason,
            action: 'DTMF_ESCAPE',
            message: dtmfMessage,
            troubleCount: newTroubleCount
        };
    }
    
    // Re-greet
    return {
        trouble: true,
        reason,
        action: 'REGREET',
        message: clarificationPrompt,
        troubleCount: newTroubleCount
    };
}

module.exports = {
    check,
    DEFAULT_TROUBLE_PHRASES,
    DEFAULT_THRESHOLD,
    DEFAULT_MAX_RETRIES
};

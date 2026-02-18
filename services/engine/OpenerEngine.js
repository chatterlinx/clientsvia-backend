/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OPENER ENGINE — Pre-prompt micro-acknowledgment selector
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Architecture Layer 0: Runs BEFORE Discovery, scenarios, and LLM.
 *
 * Purpose:
 *   Eliminates dead air by prepending a fast micro-acknowledgment to the
 *   agent's response. The caller hears "Alright." or "I hear you." immediately
 *   while the full response (scenario + LLM) is still processing.
 *
 * Selection logic:
 *   1. If frustrationKeywords matched → pick from frustration[]
 *   2. Else if urgencyKeywords matched → pick from urgency[]
 *   3. Else if mode='reflect_first' and reason_short exists → reflectionTemplate
 *   4. Else pick from general[]
 *
 * Config path: frontDesk.conversationStyle.openers
 * Schema:      v2Company.frontDeskBehavior.openers
 *
 * All phrases are config-driven (UI → Control Plane Wiring → Runtime).
 * Global defaults are defined in runtimeReaders.map.js.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIG — Used when no company override exists
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULTS = {
    enabled: true,
    mode: 'reflect_first',
    general: [
        'Alright.',
        'Okay.',
        'Perfect.',
        'Sounds good.',
        'Understood.'
    ],
    frustration: [
        'I hear you.',
        "Yeah, that's frustrating.",
        'Sorry about that.'
    ],
    urgency: [
        "Okay — we'll move quick.",
        "Alright — let's get this handled."
    ],
    urgencyKeywords: [
        'asap', 'as soon as possible', 'today', 'right now',
        'immediately', 'urgent', 'emergency'
    ],
    frustrationKeywords: [
        'again', 'still', 'warranty', 'last week', 'second time',
        "didn't fix", 'did not fix', 'same problem', 'not working again'
    ],
    reflectionTemplate: '{reason_short} — okay.'
};

/**
 * Select a micro-acknowledgment based on caller tone and config.
 *
 * @param {Object} options
 * @param {string} options.userText          - Caller's utterance this turn
 * @param {string} [options.reasonShort]     - Short reason (from triage / call_reason_detail)
 * @param {Object} [options.openerConfig]    - Company opener config (from Control Plane)
 * @param {number} [options.turnCount=0]     - Current turn number
 * @param {string} [options.callSid]         - For logging
 * @param {string} [options.callerName]      - Caller's first name (if extracted)
 * @returns {{ opener: string|null, tone: string, debug: Object }}
 */
function selectOpener({ userText, reasonShort, openerConfig, turnCount = 0, callSid, callerName }) {
    const config = { ...DEFAULTS, ...(openerConfig || {}) };

    // ─── Guard: disabled or off ───
    if (!config.enabled || config.mode === 'off') {
        return {
            opener: null,
            tone: 'off',
            debug: { reason: 'openers_disabled', mode: config.mode }
        };
    }

    // ─── Guard: Turn 0 (greeting) — skip opener ───
    // The greeting is its own opener; don't prepend to it.
    if (turnCount === 0) {
        return {
            opener: null,
            tone: 'greeting',
            debug: { reason: 'turn_0_greeting_skip' }
        };
    }

    const lowerText = (userText || '').toLowerCase();

    // ─── Step 1: Detect caller tone via keywords ───
    const frustrationMatched = matchKeywords(lowerText, config.frustrationKeywords);
    const urgencyMatched = matchKeywords(lowerText, config.urgencyKeywords);

    let tone = 'general';
    let pool = config.general;

    if (frustrationMatched) {
        tone = 'frustration';
        pool = config.frustration?.length > 0 ? config.frustration : config.general;
    } else if (urgencyMatched) {
        tone = 'urgency';
        pool = config.urgency?.length > 0 ? config.urgency : config.general;
    }

    // ─── Step 2: Reflection mode check ───
    // If reflect_first and we have a reason, use the template instead of a pool pick
    if (config.mode === 'reflect_first' && reasonShort && tone === 'general') {
        const reflection = (config.reflectionTemplate || DEFAULTS.reflectionTemplate)
            .replace('{reason_short}', reasonShort);

        logger.debug('[OPENER_ENGINE] reflect_first: using reflection template', {
            callSid,
            reflection,
            reasonShort
        });

        return {
            opener: reflection,
            tone: 'reflection',
            debug: {
                mode: 'reflect_first',
                reasonShort,
                template: config.reflectionTemplate
            }
        };
    }

    // ─── Step 3: Pick from pool (deterministic-random) ───
    if (!pool || pool.length === 0) {
        return {
            opener: null,
            tone,
            debug: { reason: 'empty_pool', tone }
        };
    }

    let opener = pickRandom(pool);
    
    // ─── Step 4: Inject caller name if available ───
    // "Ok." becomes "Ok, Mark." when we have a confirmed name.
    // Only inject on turns 2-4 to feel natural, not every turn.
    const nameUsed = !!(callerName && turnCount >= 2 && turnCount <= 4);
    if (nameUsed) {
        opener = injectName(opener, callerName);
    }

    logger.debug('[OPENER_ENGINE] micro-ack selected', {
        callSid,
        opener,
        tone,
        nameUsed,
        callerName: nameUsed ? callerName : null,
        frustrationMatched: frustrationMatched || false,
        urgencyMatched: urgencyMatched || false
    });

    return {
        opener,
        tone,
        debug: {
            mode: config.mode,
            tone,
            poolSize: pool.length,
            nameUsed,
            frustrationMatched: frustrationMatched || false,
            urgencyMatched: urgencyMatched || false
        }
    };
}

/**
 * Prepend an opener to a response string.
 * Handles whitespace, duplicate openers, and empty responses gracefully.
 *
 * @param {string} opener   - The micro-ack (e.g., "Alright.")
 * @param {string} response - The full agent response
 * @returns {string}        - Combined response
 */
function prependOpener(opener, response) {
    if (!opener) return response || '';
    if (!response) return opener;

    const trimmedResponse = response.trim();
    const trimmedOpener = opener.trim();

    // Don't double-prepend if response already starts with the opener
    if (trimmedResponse.toLowerCase().startsWith(trimmedOpener.toLowerCase())) {
        return trimmedResponse;
    }

    // Don't prepend if response already starts with a similar micro-ack
    // (e.g., response starts with "Got it" and opener is "Alright.")
    const COMMON_OPENERS = /^(alright|okay|ok|perfect|sounds good|understood|got it|i hear you|sorry|i understand)/i;
    if (COMMON_OPENERS.test(trimmedResponse)) {
        return trimmedResponse;
    }

    return `${trimmedOpener} ${trimmedResponse}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Inject caller name into opener.
 * "Ok." → "Ok, Mark."
 * "Alright." → "Alright, Mark."
 * 
 * @param {string} opener - The micro-ack (e.g., "Okay.")
 * @param {string} name   - Caller's first name
 * @returns {string}      - Opener with name injected
 */
function injectName(opener, name) {
    if (!opener || !name) return opener;
    
    const trimmedName = name.trim();
    if (!trimmedName) return opener;
    
    // Capitalize first letter of name
    const capitalizedName = trimmedName.charAt(0).toUpperCase() + trimmedName.slice(1).toLowerCase();
    
    // Find where to inject: before the period/punctuation at end
    const match = opener.match(/^(.+?)([.!]?)$/);
    if (match) {
        const base = match[1].trim();
        const punct = match[2] || '.';
        return `${base}, ${capitalizedName}${punct}`;
    }
    
    return `${opener.replace(/[.!]$/, '')}, ${capitalizedName}.`;
}

/**
 * Check if any keyword from the list appears in the text.
 * @param {string} text       - Lowercased caller text
 * @param {string[]} keywords - Keyword list
 * @returns {string|null}     - Matched keyword or null
 */
function matchKeywords(text, keywords) {
    if (!text || !Array.isArray(keywords) || keywords.length === 0) return null;

    for (const keyword of keywords) {
        if (keyword && text.includes(keyword.toLowerCase())) {
            return keyword;
        }
    }
    return null;
}

/**
 * Pick a random element from an array.
 * Uses simple Math.random — no crypto needed for ack selection.
 */
function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════
module.exports = {
    selectOpener,
    prependOpener,
    DEFAULTS
};

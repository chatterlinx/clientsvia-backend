/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V110 TRIAGE ENGINE — Deterministic intent classification + symptom extraction
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * DOES NOT SPEAK TO THE CALLER. Produces signals only.
 *
 * INPUT:  userText (string) + company config
 * OUTPUT: { intentGuess, confidence, callReasonDetail, matchedCardId, signals }
 *
 * SCORING APPROACH (deterministic, no LLM):
 * 1. Keyword pattern matching for intent classification
 * 2. Symptom/problem extraction from utterance
 * 3. Urgency detection
 * 4. Optional: TriageCard matching (if cards exist and are active)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT PATTERNS — deterministic keyword matching
// ═══════════════════════════════════════════════════════════════════════════════

const INTENT_PATTERNS = {
    service_request: {
        strong: [
            /\b(not\s+(cool|heat|work)ing)\b/i,
            /\b(broken|leaking|stopped|won'?t\s+(turn|start|come|run|work))\b/i,
            /\b(no\s+(air|heat|cold|hot|water|power))\b/i,
            /\b(making\s+(noise|sound)s?)\b/i,
            /\b(smell|burning|smoke)\b/i,
            /\b(froze|frozen|ice|iced?\s+up)\b/i,
            /\b(drip|flood|water\s+damage)\b/i,
            /\b(tripped|blowing\s+fuse|breaker)\b/i,
            /\b(thermostat.{0,20}(not|won'?t|doesn'?t|isn'?t))/i,
            /\b(ac|a\.?c\.?|air\s+condition)\b.{0,30}\b(issue|problem|trouble|broke|repair|fix)/i,
            /\b(heat|heater|furnace|boiler)\b.{0,30}\b(issue|problem|trouble|broke|repair|fix)/i,
            /\b(need|want).{0,15}(repair|fix|service|someone\s+out|technician|tech)/i
        ],
        moderate: [
            /\b(issue|problem|trouble)\b/i,
            /\b(acting\s+(up|funny|weird|strange))\b/i,
            /\b(doesn'?t|isn'?t|won'?t|can'?t)\b.{0,20}\b(work|run|cool|heat|turn)/i,
            /\b(set\s+(it\s+)?to\s+\d+).{0,30}(won'?t|doesn'?t|not)\b/i,
            /\b(temperature).{0,20}(\d{2,3})/i
        ],
        weight: { strong: 0.35, moderate: 0.15 }
    },

    pricing: {
        strong: [
            /\b(how\s+much|price|cost|estimate|quote|pricing|rate)\b/i,
            /\b(what\s+(do|does|would)\s+(it|you)\s+charge)\b/i,
            /\b(free\s+estimate|free\s+quote)\b/i,
            /\b(new\s+(system|unit|install))\b.{0,20}\b(cost|price|how\s+much)/i
        ],
        moderate: [
            /\b(afford|budget|financing|payment\s+plan)\b/i,
            /\b(expensive|cheap|deal)\b/i
        ],
        weight: { strong: 0.35, moderate: 0.15 }
    },

    status: {
        strong: [
            /\b(status|update|progress|eta|when.{0,15}(coming|arrive|here|ready))\b/i,
            /\b(where\s+(is|are)\s+(the|my|your)\s+(tech|technician|guy|person))\b/i,
            /\b(tracking|on\s+the\s+way|running\s+late)\b/i,
            /\b(follow\s*up|checking\s+(in|on|back))\b/i
        ],
        moderate: [
            /\b(appointment|scheduled|booked)\b.{0,20}\b(when|time|date|still)/i
        ],
        weight: { strong: 0.40, moderate: 0.15 }
    },

    complaint: {
        strong: [
            /\b(complaint|complain|dissatisfied|terrible|horrible|worst)\b/i,
            /\b(never\s+coming\s+back|done\s+with\s+you|report|bbb|attorney|lawyer|sue)\b/i,
            /\b(ripped\s+(me\s+)?off|scam|fraud|steal|stole)\b/i,
            /\b(manager|supervisor|owner|boss|corporate)\b.{0,15}\b(speak|talk|get)/i
        ],
        moderate: [
            /\b(frustrated|angry|upset|disappointed|unhappy)\b/i,
            /\b(poor|bad|awful)\s+(service|work|job|experience)\b/i
        ],
        weight: { strong: 0.40, moderate: 0.15 }
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// URGENCY PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

const URGENCY_PATTERNS = {
    emergency: [
        /\b(gas\s+(leak|smell)|carbon\s+monoxide|co\s+detector|fire|smoke)\b/i,
        /\b(flood|water\s+(everywhere|pouring|damage))\b/i,
        /\b(no\s+heat).{0,20}(baby|infant|elderly|senior|sick|medical|freeze|freezing)\b/i,
        /\b(emergency|life\s+threatening|dangerous)\b/i
    ],
    urgent: [
        /\b(asap|right\s+away|immediately|today|urgent|rush)\b/i,
        /\b(no\s+(ac|heat|cooling|heating))\b/i,
        /\b(temperature).{0,10}(\d{2,3})\b/i,
        /\b(\d{2,3})\s*°?\s*(degree|in\s+(here|the\s+house|my\s+home))/i,
        /\b(can'?t\s+(sleep|breathe|stay|live))\b/i,
        /\b(been\s+(days?|weeks?)\s+without)\b/i
    ]
};

// ═══════════════════════════════════════════════════════════════════════════════
// SYMPTOM EXTRACTION — pull structured details from utterance
// ═══════════════════════════════════════════════════════════════════════════════

const SYMPTOM_PATTERNS = [
    { pattern: /\b(not\s+cool(?:ing)?|won'?t\s+cool)\b/i, symptom: 'not cooling' },
    { pattern: /\b(not\s+heat(?:ing)?|won'?t\s+heat)\b/i, symptom: 'not heating' },
    { pattern: /\b(not\s+work(?:ing)?|won'?t\s+work|stopped\s+work(?:ing)?)\b/i, symptom: 'not working' },
    { pattern: /\b(not\s+turn(?:ing)?\s+(on|off)|won'?t\s+turn\s+(on|off))\b/i, symptom: 'won\'t turn on/off' },
    { pattern: /\b(leak(?:ing)?|drip(?:ping)?)\b/i, symptom: 'leaking' },
    { pattern: /\b(noise|loud|bang(?:ing)?|rattle|rattling|hum(?:ming)?|buzz(?:ing)?|squeal(?:ing)?)\b/i, symptom: 'making noise' },
    { pattern: /\b(smell|odor|burning)\b/i, symptom: 'burning smell' },
    { pattern: /\b(froze|frozen|ice|iced?\s*up)\b/i, symptom: 'frozen/iced up' },
    { pattern: /\b(blow(?:ing)?\s+warm|warm\s+air|hot\s+air)\b/i, symptom: 'blowing warm air' },
    { pattern: /\b(blow(?:ing)?\s+cold|cold\s+air)\b/i, symptom: 'blowing cold air' },
    { pattern: /\b(thermostat).{0,20}(blank|dead|not\s+respond|unresponsive|wrong|inaccurate)/i, symptom: 'thermostat issue' },
    { pattern: /\b(short\s+cycling|keeps?\s+(turning|shutting|cycling))\b/i, symptom: 'short cycling' },
    { pattern: /\b(water\s+(damage|heater|leak))\b/i, symptom: 'water issue' },
    { pattern: /\b(tripped|breaker|fuse)\b/i, symptom: 'electrical trip' }
];

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPERATURE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

function extractTemperature(text) {
    // "set it to 74 and it's over 90"
    const setMatch = text.match(/set\s+(?:it\s+)?to\s+(\d{2,3})/i);
    const actualMatch = text.match(/(?:it'?s|it\s+is|over|at|reading|showing|says?)\s+(\d{2,3})/i);
    const degreesMatch = text.match(/(\d{2,3})\s*°?\s*(?:degrees?|in\s+(?:here|the\s+house|my\s+home))/i);

    return {
        setTo: setMatch ? parseInt(setMatch[1]) : null,
        actual: actualMatch ? parseInt(actualMatch[1]) : (degreesMatch ? parseInt(degreesMatch[1]) : null)
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EVALUATE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate user utterance for intent, symptoms, and urgency.
 *
 * @param {string} userText - Caller utterance
 * @param {object} options - { company, companyId, callSid, turnNumber, session, config }
 * @returns {object} Triage result matching the output contract
 */
async function evaluate(userText, options = {}) {
    const { companyId, callSid, turnNumber, config } = options;
    const text = (userText || '').trim();

    if (!text || text.length < 3) {
        return {
            intentGuess: 'other',
            confidence: 0,
            callReasonDetail: null,
            matchedCardId: null,
            signals: { urgency: 'normal' }
        };
    }

    const minConfidence = config?.minConfidence ?? 0.62;

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Score each intent category
    // ─────────────────────────────────────────────────────────────────────
    const intentScores = {};

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        let score = 0;
        const strongMatches = (patterns.strong || []).filter(p => p.test(text)).length;
        const moderateMatches = (patterns.moderate || []).filter(p => p.test(text)).length;

        score += strongMatches * (patterns.weight?.strong || 0.35);
        score += moderateMatches * (patterns.weight?.moderate || 0.15);

        // Cap at 1.0
        intentScores[intent] = Math.min(1.0, score);
    }

    // Find top intent
    let topIntent = 'other';
    let topScore = 0;

    for (const [intent, score] of Object.entries(intentScores)) {
        if (score > topScore) {
            topIntent = intent;
            topScore = score;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Extract symptoms
    // ─────────────────────────────────────────────────────────────────────
    const symptoms = [];
    for (const { pattern, symptom } of SYMPTOM_PATTERNS) {
        if (pattern.test(text)) {
            symptoms.push(symptom);
        }
    }

    // Temperature info
    const tempInfo = extractTemperature(text);
    if (tempInfo.actual && tempInfo.actual >= 85) {
        symptoms.push(`indoor temp ${tempInfo.actual}°`);
    }
    if (tempInfo.setTo && tempInfo.actual && (tempInfo.actual - tempInfo.setTo) > 10) {
        symptoms.push(`set to ${tempInfo.setTo}° but reading ${tempInfo.actual}°`);
    }

    // Build callReasonDetail
    const callReasonDetail = symptoms.length > 0 ? symptoms.join('; ') : null;

    // Boost confidence if we have specific symptoms
    if (symptoms.length > 0 && topIntent === 'service_request') {
        topScore = Math.min(1.0, topScore + (symptoms.length * 0.05));
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Detect urgency
    // ─────────────────────────────────────────────────────────────────────
    let urgency = 'normal';

    for (const pattern of URGENCY_PATTERNS.emergency) {
        if (pattern.test(text)) {
            urgency = 'emergency';
            break;
        }
    }

    if (urgency === 'normal') {
        for (const pattern of URGENCY_PATTERNS.urgent) {
            if (pattern.test(text)) {
                urgency = 'urgent';
                break;
            }
        }
    }

    // High indoor temperature = urgent
    if (urgency === 'normal' && tempInfo.actual && tempInfo.actual >= 90) {
        urgency = 'urgent';
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Optional TriageCard matching (if cards exist)
    // ─────────────────────────────────────────────────────────────────────
    let matchedCardId = null;

    // Only attempt card matching if TriageService is available
    // Cards are CONTENT, not gates — they enrich the result, not control it
    try {
        const TriageService = require('../../services/TriageService');
        const cardMatch = await TriageService.applyQuickTriageRules(
            text,
            options.companyId,
            options.company?.defaultTrade || null
        );

        if (cardMatch?.matched) {
            matchedCardId = cardMatch.triageCardId || null;

            // Boost confidence if card matched
            topScore = Math.min(1.0, topScore + 0.10);

            logger.debug('[V110_TRIAGE] Card matched', {
                callSid, cardId: matchedCardId,
                label: cardMatch.triageLabel
            });
        }
    } catch (err) {
        // Card matching is optional — don't fail triage if it breaks
        logger.debug('[V110_TRIAGE] Card matching unavailable (non-fatal)', {
            error: err.message
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Build final result
    // ─────────────────────────────────────────────────────────────────────

    // If no strong patterns matched, check if caller said enough words to suggest a service request
    // (long utterances describing problems often miss individual keywords)
    const wordCount = text.split(/\s+/).length;
    if (topScore < minConfidence && wordCount > 15 && symptoms.length > 0) {
        topIntent = 'service_request';
        topScore = Math.max(topScore, 0.55); // Moderate confidence for long symptomatic utterances
    }

    return {
        intentGuess: topScore >= 0.1 ? topIntent : 'other',
        confidence: Math.round(topScore * 100) / 100,
        callReasonDetail,
        matchedCardId,
        signals: {
            urgency,
            symptomCount: symptoms.length,
            wordCount,
            temperature: tempInfo.actual || null
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { evaluate };

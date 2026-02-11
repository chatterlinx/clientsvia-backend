/**
 * DiscoveryTruthWriter.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * V116: DISCOVERY TRUTH LAYER — Captures "why they called" before gates can
 * blank input. Runs at the TOP of every turn in FrontDeskRuntime.handleTurn(),
 * BEFORE ConnectionQualityGate, SilenceHandler, or lane determination.
 * 
 * RULE: Only writes slots that exist in V110 discoveryFlow.steps.
 *       If it's not in V110 UI, it doesn't exist.
 * 
 * OUTPUT CONTRACT (written to callState.discovery.truth):
 *   - first_utterance:       Write-once, Turn 1 only. Cleaned caller text (max 240 chars).
 *   - call_reason_detail:    Short symptom/reason summary. Deterministic keyword extraction.
 *   - call_intent_guess:     service_request | schedule | question | billing | complaint | other
 *   - call_intent_confidence: 0–1 score
 *   - updatedAtTurn:         Last turn this was written
 * 
 * WHY: Without this, when ConnectionQualityGate or SilenceHandler fires,
 * the scenario matcher gets "[unknown input]" and the LLM acts like it has
 * amnesia. This layer ensures the "why" never disappears.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../../utils/logger');

const VERSION = 'DISCOVERY_TRUTH_V1';

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT CLASSIFICATION (deterministic, no LLM)
// ═══════════════════════════════════════════════════════════════════════════════

const INTENT_PATTERNS = {
    service_request: {
        keywords: [
            'not working', 'broken', 'repair', 'fix', 'not cooling', 'not heating',
            'no cool', 'no heat', 'no ac', 'no air', 'warm air', 'hot air',
            'cold air', 'leaking', 'leak', 'water', 'dripping', 'noise', 'loud',
            'smell', 'burning', 'frozen', 'ice', 'thermostat', 'blank', 'dead',
            'not turning on', 'not running', 'stopped', 'quit', 'problem',
            'issue', 'trouble', 'not pulling', 'not blowing', 'weak air',
            'unit', 'system', 'furnace', 'compressor', 'condenser', 'duct',
            'maintenance', 'tune up', 'tune-up', 'service', 'check up',
            'inspection', 'filter', 'freon', 'refrigerant', 'recharge'
        ],
        weight: 0.85
    },
    schedule: {
        keywords: [
            'schedule', 'appointment', 'book', 'booking', 'come out',
            'send someone', 'technician', 'available', 'opening',
            'tomorrow', 'today', 'this week', 'next week', 'asap',
            'as soon as possible', 'earliest', 'when can'
        ],
        weight: 0.80
    },
    question: {
        keywords: [
            'how much', 'cost', 'price', 'estimate', 'quote',
            'do you', 'can you', 'are you', 'what is', 'what are',
            'hours', 'open', 'location', 'where', 'warranty',
            'how long', 'how often'
        ],
        weight: 0.70
    },
    billing: {
        keywords: [
            'bill', 'invoice', 'payment', 'charge', 'balance',
            'receipt', 'refund', 'credit', 'owe', 'pay'
        ],
        weight: 0.75
    },
    complaint: {
        keywords: [
            'complaint', 'unhappy', 'disappointed', 'terrible',
            'awful', 'horrible', 'manager', 'supervisor', 'escalate',
            'not satisfied', 'rude', 'unprofessional', 'wrong'
        ],
        weight: 0.80
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SYMPTOM/REASON EXTRACTION (deterministic, HVAC-aware)
// ═══════════════════════════════════════════════════════════════════════════════

const SYMPTOM_PATTERNS = [
    { match: /not\s+cool/i, label: 'AC not cooling' },
    { match: /no\s+cool/i, label: 'AC not cooling' },
    { match: /warm\s+air/i, label: 'AC not cooling' },
    { match: /hot\s+air/i, label: 'AC not cooling' },
    { match: /not\s+blow/i, label: 'not blowing' },
    { match: /weak\s+air/i, label: 'weak airflow' },
    { match: /not\s+heat/i, label: 'not heating' },
    { match: /no\s+heat/i, label: 'not heating' },
    { match: /not\s+pull/i, label: 'system not pulling' },
    { match: /leak/i, label: 'leaking' },
    { match: /drip/i, label: 'dripping' },
    { match: /water/i, label: 'water issue' },
    { match: /noise|loud|bang|rattle|squeal/i, label: 'unusual noise' },
    { match: /smell|burning|smoke/i, label: 'burning smell' },
    { match: /frozen|ice|frost/i, label: 'frozen unit' },
    { match: /thermostat.*blank|thermostat.*dead|thermostat.*not/i, label: 'thermostat issue' },
    { match: /not\s+turn/i, label: 'not turning on' },
    { match: /not\s+run/i, label: 'not running' },
    { match: /stopped|quit|shut.*off/i, label: 'system stopped' },
    { match: /tune.?up|maintenance|check.?up|inspection/i, label: 'maintenance request' },
    { match: /filter/i, label: 'filter service' },
    { match: /schedule|appointment|book/i, label: 'wants appointment' },
    { match: /emergency|urgent|asap/i, label: 'urgent' }
];

/**
 * Apply discovery truth to callState.
 * Must be called at the TOP of handleTurn(), BEFORE any gate.
 * 
 * @param {Object} params
 * @param {Object} params.callState - Mutable callState (will write to callState.discovery.truth)
 * @param {string} params.cleanedText - STT-cleaned caller utterance for this turn
 * @param {number} params.turn - Current turn number
 * @param {Object} params.discoveryFlow - V110 discoveryFlow config (frontDesk.discoveryFlow)
 * @param {string} params.callSid - For logging
 * @param {string} params.companyId - For logging
 * @returns {Object} The truth object that was written
 */
function apply({ callState, cleanedText, turn, discoveryFlow, callSid, companyId }) {
    // Initialize truth container if absent
    if (!callState.discovery) callState.discovery = {};
    if (!callState.discovery.truth) {
        callState.discovery.truth = {
            first_utterance: null,
            call_reason_detail: null,
            call_intent_guess: 'other',
            call_intent_confidence: 0,
            updatedAtTurn: 0
        };
    }
    
    const truth = callState.discovery.truth;
    const text = (cleanedText || '').trim();
    
    // Nothing to process if empty input
    if (!text || text.length === 0) {
        return truth;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V110 ENFORCEMENT: Only write slots that exist in discoveryFlow.steps
    // ═══════════════════════════════════════════════════════════════════════════
    const steps = discoveryFlow?.steps || [];
    const allowedSlotIds = new Set(steps.map(s => s.slotId));
    
    const canWriteReason = allowedSlotIds.has('call_reason_detail');
    
    // first_utterance is always written (it's structural, not a slot)
    // call_intent_guess is always written (it's structural, not a slot)
    // call_reason_detail requires the slot to exist in discoveryFlow
    
    // ═══════════════════════════════════════════════════════════════════════════
    // WRITE-ONCE: first_utterance (Turn 1 only)
    // ═══════════════════════════════════════════════════════════════════════════
    if (!truth.first_utterance && turn <= 1 && text.length > 0) {
        truth.first_utterance = text.substring(0, 240);
        
        logger.info('[DISCOVERY TRUTH] 📝 first_utterance captured', {
            callSid,
            companyId,
            turn,
            text: truth.first_utterance.substring(0, 80)
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // INTENT CLASSIFICATION (deterministic keyword matching)
    // ═══════════════════════════════════════════════════════════════════════════
    const intentResult = classifyIntent(text);
    
    // Only upgrade intent if confidence is higher than current
    if (intentResult.confidence > truth.call_intent_confidence) {
        truth.call_intent_guess = intentResult.intent;
        truth.call_intent_confidence = intentResult.confidence;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REASON/SYMPTOM EXTRACTION (only if V110 discoveryFlow allows it)
    // ═══════════════════════════════════════════════════════════════════════════
    if (canWriteReason) {
        const symptoms = extractSymptoms(text);
        if (symptoms.length > 0) {
            // On Turn 1, write fresh. On later turns, append new symptoms only.
            if (!truth.call_reason_detail || turn <= 1) {
                truth.call_reason_detail = symptoms.join('; ');
            } else {
                // Append new symptoms not already captured
                const existing = new Set(truth.call_reason_detail.split('; '));
                const newSymptoms = symptoms.filter(s => !existing.has(s));
                if (newSymptoms.length > 0) {
                    truth.call_reason_detail += '; ' + newSymptoms.join('; ');
                }
            }
        }
    }
    
    truth.updatedAtTurn = turn;
    
    logger.info('[DISCOVERY TRUTH] ✅ Truth applied', {
        callSid,
        companyId,
        turn,
        intent: truth.call_intent_guess,
        confidence: truth.call_intent_confidence,
        reasonDetail: truth.call_reason_detail,
        hasFirstUtterance: !!truth.first_utterance,
        canWriteReason,
        version: VERSION
    });
    
    return truth;
}

/**
 * Classify intent from text using keyword matching.
 * Returns { intent: string, confidence: number }
 */
function classifyIntent(text) {
    const lower = text.toLowerCase();
    let bestIntent = 'other';
    let bestScore = 0;
    
    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
        let matchCount = 0;
        for (const keyword of config.keywords) {
            if (lower.includes(keyword)) {
                matchCount++;
            }
        }
        
        if (matchCount > 0) {
            // Score = base weight * (1 + bonus for multiple matches)
            const score = config.weight * (1 + Math.min(matchCount - 1, 3) * 0.05);
            if (score > bestScore) {
                bestScore = score;
                bestIntent = intent;
            }
        }
    }
    
    return {
        intent: bestIntent,
        confidence: Math.round(bestScore * 100) / 100
    };
}

/**
 * Extract symptom labels from text using pattern matching.
 * Returns array of short symptom strings, deduplicated.
 */
function extractSymptoms(text) {
    const symptoms = [];
    const seen = new Set();
    
    for (const pattern of SYMPTOM_PATTERNS) {
        if (pattern.match.test(text) && !seen.has(pattern.label)) {
            symptoms.push(pattern.label);
            seen.add(pattern.label);
        }
    }
    
    return symptoms;
}

module.exports = {
    apply,
    classifyIntent,
    extractSymptoms,
    VERSION
};

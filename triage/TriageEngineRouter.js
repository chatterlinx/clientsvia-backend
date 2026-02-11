/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRIAGE ENGINE ROUTER — The ONLY triage entrypoint allowed at runtime
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * RULE: Every triage call in the entire codebase MUST go through this file.
 *       No other triage import is allowed. If you see one, it's a bug.
 *
 * SINGLE GATE: frontDesk.triage.enabled (per company)
 *   - true  → run V110TriageEngine
 *   - false → return null (no triage)
 *   - missing → return null (safe default)
 *
 * TRIAGE DOES NOT SPEAK TO THE CALLER.
 * It produces signals; the router decides the response.
 *
 * OUTPUT CONTRACT:
 * {
 *   intentGuess: "service_request|pricing|status|complaint|other",
 *   confidence: 0.0-1.0,
 *   callReasonDetail: "AC not cooling; leaking",
 *   matchedCardId: null | string,
 *   signals: { urgency: "normal|urgent|emergency" }
 * }
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// LAZY-LOADED ENGINE (single engine, no switching)
// ═══════════════════════════════════════════════════════════════════════════════
let V110TriageEngine = null;

function loadEngine() {
    if (!V110TriageEngine) {
        V110TriageEngine = require('./v110/V110TriageEngine');
    }
    return V110TriageEngine;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NULL RESULT — returned when triage is disabled or fails
// ═══════════════════════════════════════════════════════════════════════════════
const NULL_RESULT = Object.freeze({
    intentGuess: null,
    confidence: 0,
    callReasonDetail: null,
    matchedCardId: null,
    signals: {},
    _triageRan: false,
    _skipReason: null
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run triage on a user utterance.
 *
 * @param {string} userText - The caller's utterance
 * @param {object} options
 * @param {object} options.company - The company document (must have aiAgentSettings)
 * @param {string} options.companyId - Company ID string
 * @param {string} options.callSid - Call SID for logging
 * @param {number} [options.turnNumber=0] - Current turn number
 * @param {object} [options.session] - ConversationSession (optional, for context)
 * @returns {Promise<object>} Triage result matching the output contract, or null-result
 */
async function runTriage(userText, options = {}) {
    const { company, companyId, callSid, turnNumber = 0, session } = options;
    const startTime = Date.now();

    // ─────────────────────────────────────────────────────────────────────
    // GATE CHECK: frontDesk.triage.enabled is the ONLY gate
    // ─────────────────────────────────────────────────────────────────────
    const triageConfig = company?.aiAgentSettings?.frontDeskBehavior?.triage;
    const enabled = triageConfig?.enabled === true;

    if (!enabled) {
        const skipReason = !triageConfig ? 'triage_not_configured' : 'triage_disabled';
        logDecision({
            callSid, companyId, turnNumber, enabled: false,
            skipReason, durationMs: Date.now() - startTime
        });
        return { ...NULL_RESULT, _skipReason: skipReason };
    }

    // ─────────────────────────────────────────────────────────────────────
    // RUN V110 TRIAGE ENGINE
    // ─────────────────────────────────────────────────────────────────────
    try {
        const engine = loadEngine();
        const result = await engine.evaluate(userText, {
            company,
            companyId,
            callSid,
            turnNumber,
            session,
            config: triageConfig
        });

        // Normalize output to contract
        const normalized = {
            intentGuess: result.intentGuess || 'other',
            confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
            callReasonDetail: result.callReasonDetail || null,
            matchedCardId: result.matchedCardId || null,
            signals: {
                urgency: result.signals?.urgency || 'normal',
                ...(result.signals || {})
            },
            _triageRan: true,
            _skipReason: null,
            _engine: 'v110',
            _durationMs: Date.now() - startTime
        };

        logDecision({
            callSid, companyId, turnNumber, enabled: true,
            engine: 'v110', result: normalized, durationMs: Date.now() - startTime
        });

        logResult({ callSid, companyId, turnNumber, result: normalized });

        return normalized;

    } catch (err) {
        logger.error('[TRIAGE_ENGINE_ROUTER] V110TriageEngine error (non-fatal)', {
            callSid, companyId, turnNumber,
            error: err.message, stack: err.stack?.substring(0, 300)
        });

        logDecision({
            callSid, companyId, turnNumber, enabled: true,
            engine: 'v110', skipReason: 'engine_error', error: err.message,
            durationMs: Date.now() - startTime
        });

        return { ...NULL_RESULT, _skipReason: 'engine_error' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAW EVENT LOGGING — proof of every decision
// ═══════════════════════════════════════════════════════════════════════════════

let BlackBoxLogger = null;

function getBlackBox() {
    if (BlackBoxLogger === null) {
        try {
            BlackBoxLogger = require('../services/BlackBoxLogger');
        } catch {
            BlackBoxLogger = false; // Don't retry
        }
    }
    return BlackBoxLogger || null;
}

function logDecision(data) {
    const { callSid, companyId, turnNumber, enabled, engine, skipReason, error, durationMs } = data;

    logger.info('[TRIAGE_ROUTER_DECISION]', {
        callSid, companyId, turnNumber, enabled,
        engine: engine || null,
        skipReason: skipReason || null,
        error: error || null,
        durationMs
    });

    const bb = getBlackBox();
    if (bb) {
        bb.logEvent({
            callId: callSid,
            companyId,
            type: 'TRIAGE_ROUTER_DECISION',
            turn: turnNumber,
            data: {
                enabled,
                engine: engine || null,
                skipReason: skipReason || null,
                error: error || null,
                durationMs
            }
        }).catch(() => {});
    }
}

function logResult(data) {
    const { callSid, companyId, turnNumber, result } = data;

    logger.info('[TRIAGE_RESULT]', {
        callSid, companyId, turnNumber,
        intentGuess: result.intentGuess,
        confidence: result.confidence,
        callReasonDetail: result.callReasonDetail?.substring(0, 80),
        matchedCardId: result.matchedCardId,
        urgency: result.signals?.urgency,
        durationMs: result._durationMs
    });

    const bb = getBlackBox();
    if (bb) {
        bb.logEvent({
            callId: callSid,
            companyId,
            type: 'TRIAGE_RESULT',
            turn: turnNumber,
            data: {
                intentGuess: result.intentGuess,
                confidence: result.confidence,
                callReasonDetail: result.callReasonDetail?.substring(0, 200),
                matchedCardId: result.matchedCardId,
                signals: result.signals,
                engine: result._engine,
                durationMs: result._durationMs
            }
        }).catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS — this is the ONLY triage API
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    runTriage,
    NULL_RESULT
};

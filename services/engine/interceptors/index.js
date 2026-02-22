/**
 * ════════════════════════════════════════════════════════════════════════════
 * INTERCEPTORS - Pre-flow pattern matchers
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * NUCLEAR CLEANUP (Feb 2026): Legacy preemptors removed.
 * Agent 2.0 is now the ONLY responder during discovery.
 * 
 * Remaining:
 * - GreetingInterceptor: Short greetings only (under Agent2 control)
 * 
 * NUKED (hijacking Agent 2.0):
 * - ConnectionQualityGate: DELETED - was hijacking turn 1-2
 * - EscalationDetector: DELETED - was hijacking transfer requests
 * - CallReasonExtractor: DELETED - was hijacking acknowledgments
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const GreetingInterceptor = require('./GreetingInterceptor');

module.exports = {
    GreetingInterceptor
};

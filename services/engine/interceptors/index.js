/**
 * ════════════════════════════════════════════════════════════════════════════
 * INTERCEPTORS - Pre-flow pattern matchers
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * These run BEFORE the main Discovery/Booking flow to handle common patterns:
 * - Greetings ("good morning") → instant response, no LLM
 * - Escalation ("manager please") → bypass everything, transfer
 * - Connection trouble ("hello? are you there?") → re-greet
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const GreetingInterceptor = require('./GreetingInterceptor');
const EscalationDetector = require('./EscalationDetector');
const ConnectionQualityGate = require('./ConnectionQualityGate');
const CallReasonExtractor = require('./CallReasonExtractor');

module.exports = {
    GreetingInterceptor,
    EscalationDetector,
    ConnectionQualityGate,
    CallReasonExtractor
};

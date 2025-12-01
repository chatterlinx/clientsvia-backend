/**
 * ============================================================================
 * TRIAGE LAYER - Routes Brain-1 Decisions
 * ============================================================================
 * 
 * POSITION: Between Brain-1 and Brain-2
 * 
 * Given Brain-1's decision, determine:
 * - SCENARIO_ENGINE → Call Brain-2
 * - TRANSFER → Transfer Handler
 * - BOOKING_FLOW → Booking Handler
 * - MESSAGE_ONLY → Just speak
 * - END_CALL → End the call
 * 
 * EXPORTS:
 * - route: Route a Brain-1 decision to appropriate handler
 * 
 * ============================================================================
 */

const { route } = require('./TriageRouter');

module.exports = {
    route
};


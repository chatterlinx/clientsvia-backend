/**
 * ============================================================================
 * CALL LOGGER SERVICE - Agent 2.0 Call Event Logging
 * ============================================================================
 * 
 * THE SINGLE ENTRY POINT FOR ALL CALL EVENT LOGGING IN AGENT 2.0.
 * 
 * ARCHITECTURE NOTE:
 * - This file re-exports BlackBoxLogger for backwards compatibility
 * - All new Agent 2.0 code should import from this file
 * - BlackBoxLogger will be deprecated and eventually removed
 * 
 * METHODS:
 * - initCall()     → Start recording a new call
 * - logEvent()     → Append an event to the timeline
 * - appendError()  → Log an error
 * - addTranscript()→ Add caller/agent turn to transcript
 * - finalizeCall() → Compute summary, diagnosis, visualizations
 * 
 * USAGE:
 *   const CallLogger = require('../services/CallLogger');
 *   await CallLogger.initCall({ callId, companyId, from, to });
 *   await CallLogger.logEvent({ callId, companyId, type: 'SPEAK_PROVENANCE', data: {...} });
 *   await CallLogger.finalizeCall({ callId, companyId, summary: {...} });
 * 
 * ============================================================================
 */

const BlackBoxLogger = require('./BlackBoxLogger');

// Re-export the service with new name
// This allows gradual migration without breaking existing code
module.exports = BlackBoxLogger;

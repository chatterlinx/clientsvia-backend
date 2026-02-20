/**
 * ============================================================================
 * CALL RECORDING MODEL - Agent 2.0 Call Event Storage
 * ============================================================================
 * 
 * This is the canonical model for storing call events in Agent 2.0.
 * 
 * ARCHITECTURE NOTE:
 * - This file re-exports BlackBoxRecording for backwards compatibility
 * - All new Agent 2.0 code should import from this file
 * - BlackBoxRecording will be deprecated and eventually removed
 * 
 * USAGE:
 *   const CallRecording = require('../models/CallRecording');
 *   const recording = await CallRecording.getCallDetail(companyId, callSid);
 * 
 * ============================================================================
 */

const BlackBoxRecording = require('./BlackBoxRecording');

// Re-export the model with new name
// This allows gradual migration without breaking existing code
module.exports = BlackBoxRecording;

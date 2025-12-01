/**
 * ============================================================================
 * BRAIN-1 - FRONTLINE INTELLIGENCE ENGINE
 * ============================================================================
 * 
 * THE MANDATORY GATEWAY FOR ALL CALLER TURNS
 * 
 * Every user utterance flows through Brain-1 before anything else.
 * Brain-1 is the receptionist brain that:
 * - Preprocesses input (filler stripping, normalization)
 * - Detects emotion
 * - Extracts entities
 * - Decides action (route to scenario, transfer, book, ask followup, end)
 * 
 * EXPORTS:
 * - runTurn: Run a single turn through Brain-1 decision engine
 * - processTurn: Complete turn processing (Brain-1 + Triage + Brain-2 + Guardrails)
 * 
 * ============================================================================
 */

const { runTurn } = require('./FrontlineIntelEngine');
const { processTurn } = require('./Brain1Runtime');

module.exports = {
    runTurn,
    processTurn
};


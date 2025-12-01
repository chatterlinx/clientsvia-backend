/**
 * ============================================================================
 * PERSONALITY LAYER - EXPORTS
 * ============================================================================
 * 
 * PURPOSE: Human-like response generation
 * 
 * COMPONENTS:
 * - HumanLayerAssembler: Deterministic response assembly
 * 
 * USAGE:
 * const { HumanLayerAssembler } = require('./personality');
 * 
 * const response = HumanLayerAssembler.build({
 *   routing: { target: "HVAC_LEAK", thought: "leak detected" },
 *   memory: { callerHistory: [...] },
 *   emotion: { primary: "FRUSTRATED", intensity: 0.75 },
 *   company: { name: "ABC HVAC" }
 * });
 * // Returns: "I'm so sorry you're dealing with this. Sounds like a leak. 
 * //           Let me get someone out there right away."
 * 
 * ============================================================================
 */

module.exports = {
  HumanLayerAssembler: require('./HumanLayerAssembler')
};


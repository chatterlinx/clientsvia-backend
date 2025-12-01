/**
 * ============================================================================
 * ROUTING LAYER - EXPORTS
 * ============================================================================
 * 
 * PURPOSE: Fast, intelligent routing to scenarios
 * 
 * COMPONENTS:
 * - MicroLLMRouter: Fast routing using gpt-4o-mini
 * - CompactPromptCompiler: On-demand prompt compilation with caching
 * 
 * USAGE:
 * const { MicroLLMRouter, CompactPromptCompiler } = require('./routing');
 * 
 * const { prompt } = await CompactPromptCompiler.getPrompt(companyId, context);
 * const decision = await MicroLLMRouter.route({ prompt, userInput, companyId, callId });
 * // Returns: { target: "HVAC_REPAIR", confidence: 0.92, ... }
 * 
 * ============================================================================
 */

module.exports = {
  MicroLLMRouter: require('./MicroLLMRouter'),
  CompactPromptCompiler: require('./CompactPromptCompiler')
};


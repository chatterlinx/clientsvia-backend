/**
 * ============================================================================
 * ORCHESTRATION LAYER - MAIN EXPORTS
 * ============================================================================
 * 
 * PURPOSE: Enhanced LLM-0 Orchestration Engine Components
 * ARCHITECTURE: Domain-Driven Design (Industry Standard)
 * 
 * LAYER STRUCTURE:
 * 
 * 1. PREPROCESSING - Text cleaning and normalization
 *    - FillerStripper
 *    - TranscriptNormalizer
 * 
 * 2. INTELLIGENCE - Context and emotion analysis
 *    - EmotionDetector
 * 
 * 3. ROUTING - Fast scenario matching
 *    - MicroLLMRouter
 *    - CompactPromptCompiler
 * 
 * 4. PERSONALITY - Human-like response generation
 *    - HumanLayerAssembler
 * 
 * USAGE:
 * 
 * ```javascript
 * const {
 *   preprocessing: { FillerStripper, TranscriptNormalizer },
 *   intelligence: { EmotionDetector },
 *   routing: { MicroLLMRouter, CompactPromptCompiler },
 *   personality: { HumanLayerAssembler }
 * } = require('./orchestration');
 * 
 * // Step 1: Clean input
 * let text = "uh my like a/c is um broken";
 * text = FillerStripper.clean(text);
 * text = TranscriptNormalizer.normalize(text);
 * 
 * // Step 2: Detect emotion
 * const emotion = EmotionDetector.analyze(text, callerHistory);
 * 
 * // Step 3: Route to scenario
 * const { prompt } = await CompactPromptCompiler.getPrompt(companyId, { emotion });
 * const routing = await MicroLLMRouter.route({ prompt, userInput: text, companyId, callId });
 * 
 * // Step 4: Generate response
 * const response = HumanLayerAssembler.build({ routing, memory, emotion, company });
 * ```
 * 
 * ============================================================================
 */

module.exports = {
  preprocessing: require('./preprocessing'),
  intelligence: require('./intelligence'),
  routing: require('./routing'),
  personality: require('./personality')
};


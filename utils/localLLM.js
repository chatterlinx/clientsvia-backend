// utils/localLLM.js - STUBBED - Local LLM functionality disabled
// This utility now provides stub functions for cloud-only operation
// All functions return fallback responses instead of using Ollama

console.log('🔒 Local LLM utilities stubbed - cloud-only operation mode');

/**
 * Local LLM fallback - STUBBED (returns fallback response)
 * @param {string} prompt - The user input/prompt to send to the LLM
 * @param {string} model - The Ollama model to use (ignored in stub)
 * @param {object} options - Additional options for the LLM (ignored in stub)
 * @returns {Promise<string>} - The LLM response
 */
async function localLLM(prompt, model = 'stubbed-model', options = {}) {
  console.log(`[LocalLLM-STUB] 🔒 Local LLM disabled - returning fallback response`);
  // Return a generic fallback response
  return 'Local AI processing is currently unavailable. Please contact our support team for assistance.';
}

/**
 * Enhanced local LLM with context - STUBBED (returns fallback response)
 * @param {string} userInput - The user's question
 * @param {string} companyName - The company name for context (ignored in stub)
 * @param {string} tradeCategory - The trade category (ignored in stub)
 * @returns {Promise<string>} - Professional response
 */
async function localLLMWithContext(userInput, companyName = '', tradeCategory = 'hvac') {
  console.log(`[LocalLLM-STUB] 🔒 Local LLM with context disabled - returning fallback response`);
  // Return a generic fallback response
  return 'Thank you for your inquiry. Our support team will get back to you shortly with detailed information about your question.';
}

/**
 * Test if Ollama is running - STUBBED (always returns false)
 * @returns {Promise<boolean>} - Always false in stub mode
 */
async function testOllamaConnection() {
  console.log(`[LocalLLM-STUB] 🔒 Ollama connection test disabled - returning false`);
  return false; // Always false - local LLM disabled
}

module.exports = {
  localLLM,
  localLLMWithContext,
  testOllamaConnection
};

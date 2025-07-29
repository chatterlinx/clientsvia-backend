// localLLM.js - STUBBED - Local LLM functionality disabled
// This service now provides stub functions for cloud-only operation
// All functions return fallback responses instead of using Ollama

console.log('🔒 Local LLM service stubbed - cloud-only operation mode');

class LocalLLMService {
  constructor() {
    // Local LLM disabled - cloud-only approach
    this.isDisabled = true;
    this.model = 'stubbed-model';
  }

  /**
   * Check if Ollama service is available - ALWAYS FALSE (stubbed)
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    return false; // Always false - local LLM disabled
  }

  /**
   * Check if the specified model is available - ALWAYS FALSE (stubbed)
   * @returns {Promise<boolean>}
   */
  async isModelAvailable() {
    return false; // Always false - local LLM disabled
  }

  /**
   * Query the local LLM with a prompt - STUBBED (returns fallback response)
   * @param {string} prompt - The question/prompt to send to the LLM
   * @param {Object} options - Additional options
   * @param {string} options.context - Additional context for the conversation
   * @param {string} options.systemPrompt - System instruction for the LLM
   * @param {number} options.maxTokens - Maximum tokens in response
   * @returns {Promise<string>} The LLM response
   */
  async queryLLM(prompt, options = {}) {
    // Return a generic fallback response
    return 'I apologize, but local AI processing is currently unavailable. Please contact our support team for assistance.';
  }

  /**
   * Generate a customer service response - STUBBED (returns fallback response)
   * @param {string} customerQuery - The customer's question
   * @param {string} companyContext - Information about the company/service
   * @param {string} conversationHistory - Previous conversation context
   * @returns {Promise<string>}
   */
  async generateCustomerServiceResponse(customerQuery, companyContext = '', conversationHistory = '') {
    // Return a generic fallback response
    return 'Thank you for your inquiry. Our support team will get back to you shortly with detailed information about your question.';
  }

  /**
   * Get service status for monitoring - STUBBED
   * @returns {Promise<Object>}
   */
  async getStatus() {
    return {
      service: 'stubbed',
      model: 'disabled',
      modelName: 'stubbed-model',
      url: 'disabled',
      timestamp: new Date().toISOString(),
      message: 'Local LLM service is disabled - cloud-only operation'
    };
  }
}

// Create singleton instance
const localLLM = new LocalLLMService();

module.exports = localLLM;

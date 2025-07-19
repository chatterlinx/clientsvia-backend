// localLLM.js - Ollama Integration Service
// This service provides a local LLM fallback for the agent platform
// when custom knowledge base or predefined flows don't have an answer

const axios = require('axios');

class LocalLLMService {
  constructor() {
    this.ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'llama3.1:8b-instruct-q4_0';
    this.timeout = parseInt(process.env.OLLAMA_TIMEOUT) || 30000; // 30 seconds
  }

  /**
   * Check if Ollama service is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    try {
      const response = await axios.get(`${this.ollamaUrl}/api/tags`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.log('Ollama service not available:', error.message);
      return false;
    }
  }

  /**
   * Check if the specified model is available
   * @returns {Promise<boolean>}
   */
  async isModelAvailable() {
    try {
      const response = await axios.get(`${this.ollamaUrl}/api/tags`);
      const models = response.data.models || [];
      return models.some(model => model.name === this.model);
    } catch (error) {
      console.log('Error checking model availability:', error.message);
      return false;
    }
  }

  /**
   * Query the local LLM with a prompt
   * @param {string} prompt - The question/prompt to send to the LLM
   * @param {Object} options - Additional options
   * @param {string} options.context - Additional context for the conversation
   * @param {string} options.systemPrompt - System instruction for the LLM
   * @param {number} options.maxTokens - Maximum tokens in response
   * @returns {Promise<string>} The LLM response
   */
  async queryLLM(prompt, options = {}) {
    try {
      // Check if service is available first
      if (!(await this.isAvailable())) {
        throw new Error('Ollama service is not available');
      }

      if (!(await this.isModelAvailable())) {
        throw new Error(`Model ${this.model} is not available. Please download it first.`);
      }

      const messages = [];
      
      // Add system prompt if provided
      if (options.systemPrompt) {
        messages.push({
          role: 'system',
          content: options.systemPrompt
        });
      }

      // Add context if provided
      if (options.context) {
        messages.push({
          role: 'system',
          content: `Context: ${options.context}`
        });
      }

      // Add the main prompt
      messages.push({
        role: 'user',
        content: prompt
      });

      const requestBody = {
        model: this.model,
        messages: messages,
        stream: false
      };

      // Add max_tokens if specified
      if (options.maxTokens) {
        requestBody.options = {
          num_predict: options.maxTokens
        };
      }

      const response = await axios.post(
        `${this.ollamaUrl}/api/chat`,
        requestBody,
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data && response.data.message && response.data.message.content) {
        return response.data.message.content.trim();
      } else {
        throw new Error('Invalid response format from Ollama');
      }

    } catch (error) {
      console.error('Ollama query error:', error.message);
      
      // Return user-friendly error messages
      if (error.code === 'ECONNREFUSED') {
        return 'Local AI service is currently unavailable. Please try again later.';
      } else if (error.message.includes('Model') && error.message.includes('not available')) {
        return 'AI model is not ready. Please wait for the download to complete.';
      } else if (error.code === 'ETIMEDOUT') {
        return 'AI response took too long. Please try a simpler question.';
      } else {
        return 'I apologize, but I cannot provide an AI-generated response at this time.';
      }
    }
  }

  /**
   * Generate a customer service response using the local LLM
   * @param {string} customerQuery - The customer's question
   * @param {string} companyContext - Information about the company/service
   * @param {string} conversationHistory - Previous conversation context
   * @returns {Promise<string>}
   */
  async generateCustomerServiceResponse(customerQuery, companyContext = '', conversationHistory = '') {
    const systemPrompt = `You are a helpful customer service representative. 
    Provide professional, concise, and friendly responses. 
    If you don't know something specific about the company, acknowledge it and offer to help find the information.
    Keep responses under 200 words.`;

    const contextInfo = [
      companyContext,
      conversationHistory ? `Previous conversation: ${conversationHistory}` : ''
    ].filter(Boolean).join('\n\n');

    return await this.queryLLM(customerQuery, {
      systemPrompt,
      context: contextInfo,
      maxTokens: 300
    });
  }

  /**
   * Get service status for monitoring
   * @returns {Promise<Object>}
   */
  async getStatus() {
    try {
      const isAvailable = await this.isAvailable();
      const isModelReady = isAvailable ? await this.isModelAvailable() : false;
      
      return {
        service: isAvailable ? 'online' : 'offline',
        model: isModelReady ? 'ready' : 'not ready',
        modelName: this.model,
        url: this.ollamaUrl,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        service: 'error',
        model: 'unknown',
        modelName: this.model,
        url: this.ollamaUrl,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const localLLM = new LocalLLMService();

module.exports = localLLM;

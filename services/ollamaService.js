const axios = require('axios');

class OllamaService {
  constructor() {
    this.baseUrl = process.env.OLLAMA_API_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'llama3.2:3b';
    this.timeout = parseInt(process.env.OLLAMA_TIMEOUT) || 30000; // 30 seconds
    this.isAvailable = false;
    this.lastHealthCheck = 0;
    this.healthCheckInterval = 60000; // Check every minute
  }

  /**
   * Check if Ollama is available and running
   */
  async checkHealth() {
    const now = Date.now();
    
    // Rate limit health checks
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isAvailable;
    }

    try {
      console.log(`[Ollama] Checking health at ${this.baseUrl}`);
      const response = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000 // Quick health check
      });
      
      this.isAvailable = response.status === 200;
      this.lastHealthCheck = now;
      
      if (this.isAvailable) {
        console.log(`[Ollama] ✅ Service is available`);
        // Check if our model is available
        const models = response.data.models || [];
        const modelAvailable = models.some(m => m.name.includes(this.model.split(':')[0]));
        if (!modelAvailable) {
          console.warn(`[Ollama] ⚠️ Model ${this.model} not found. Available models:`, models.map(m => m.name));
        }
      } else {
        console.log(`[Ollama] ❌ Service not available`);
      }
      
      return this.isAvailable;
    } catch (error) {
      this.isAvailable = false;
      this.lastHealthCheck = now;
      console.log(`[Ollama] ❌ Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate a response using Ollama
   */
  async generateResponse(prompt, options = {}) {
    const startTime = Date.now();
    
    try {
      // Check if service is available
      const isHealthy = await this.checkHealth();
      if (!isHealthy) {
        throw new Error('Ollama service is not available');
      }

      console.log(`[Ollama] Generating response with model ${this.model}`);
      console.log(`[Ollama] Prompt (${prompt.length} chars): ${prompt.substring(0, 200)}...`);
      
      const requestBody = {
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options.temperature || 0.3,
          top_p: options.top_p || 0.8,
          top_k: options.top_k || 40,
          num_predict: options.max_tokens || 150,
          ...options.ollama_options
        }
      };

      const response = await axios.post(`${this.baseUrl}/api/generate`, requestBody, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const responseTime = Date.now() - startTime;
      const result = response.data.response || '';
      
      console.log(`[Ollama] ✅ Response received (${responseTime}ms): ${result.substring(0, 100)}...`);
      
      return {
        text: result.trim(),
        model: this.model,
        responseTime: responseTime,
        success: true
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error(`[Ollama] ❌ Generate failed (${responseTime}ms):`, error.message);
      
      return {
        text: null,
        model: this.model,
        responseTime: responseTime,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate a context-aware response for the agent platform
   */
  async generateAgentResponse(question, context = {}) {
    const { 
      companyName = 'the company',
      tradeCategory = 'service',
      personality = 'professional and helpful',
      conversationHistory = [],
      customInstructions = ''
    } = context;

    // Build a context-aware prompt
    const prompt = this.buildAgentPrompt(question, {
      companyName,
      tradeCategory,
      personality,
      conversationHistory,
      customInstructions
    });

    const options = {
      temperature: 0.3, // Lower for more consistent responses
      max_tokens: 100,   // Concise responses
      top_p: 0.8
    };

    return this.generateResponse(prompt, options);
  }

  /**
   * Build a context-aware prompt for agent responses
   */
  buildAgentPrompt(question, context) {
    const { companyName, tradeCategory, personality, conversationHistory, customInstructions } = context;
    
    let prompt = `You are a ${personality} customer service agent for ${companyName}, specializing in ${tradeCategory} services.\n\n`;
    
    if (customInstructions) {
      prompt += `Special Instructions: ${customInstructions}\n\n`;
    }
    
    // Add conversation history if available
    if (conversationHistory.length > 0) {
      prompt += `Previous conversation:\n`;
      conversationHistory.slice(-3).forEach(entry => {
        prompt += `${entry.role === 'customer' ? 'Customer' : 'Agent'}: ${entry.text}\n`;
      });
      prompt += '\n';
    }
    
    prompt += `Customer question: ${question}\n\n`;
    prompt += `Respond professionally and helpfully. Keep your response concise (1-2 sentences). `;
    prompt += `If you don't know something specific about ${companyName}, acknowledge this and offer to connect them with someone who can help.\n\n`;
    prompt += `Response:`;
    
    return prompt;
  }

  /**
   * Test the Ollama connection and get model info
   */
  async testConnection() {
    try {
      console.log(`[Ollama] Testing connection to ${this.baseUrl}`);
      
      // 1. Check if service is running
      const healthResult = await this.checkHealth();
      if (!healthResult) {
        return {
          success: false,
          error: 'Ollama service is not running or not accessible'
        };
      }

      // 2. List available models
      const modelsResponse = await axios.get(`${this.baseUrl}/api/tags`, {
        timeout: 5000
      });
      const models = modelsResponse.data.models || [];
      
      // 3. Test a simple generation
      const testResult = await this.generateResponse('Hello, this is a test. Please respond with "Test successful"', {
        max_tokens: 20
      });

      return {
        success: true,
        service_url: this.baseUrl,
        configured_model: this.model,
        available_models: models.map(m => ({ name: m.name, size: m.size })),
        test_generation: testResult
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        service_url: this.baseUrl,
        configured_model: this.model
      };
    }
  }
}

module.exports = new OllamaService();

// utils/localLLM.js
// Bulletproof Offline LLM Fallback using Ollama + Llama 3.1
// Privacy-first, no API keys, fully offline

const fetch = require('node-fetch');

/**
 * Local LLM fallback using Ollama
 * @param {string} prompt - The user input/prompt to send to the LLM
 * @param {string} model - The Ollama model to use (default: llama3.1:8b-instruct-q4_0)
 * @param {object} options - Additional options for the LLM
 * @returns {Promise<string>} - The LLM response
 */
async function localLLM(prompt, model = 'llama3.1:8b-instruct-q4_0', options = {}) {
  try {
    console.log(`[LocalLLM] 🧠 Sending prompt to offline LLM: "${prompt.substring(0, 100)}..."`);
    console.log(`[LocalLLM] 🤖 Using model: ${model}`);
    
    const payload = {
      model: model,
      prompt: prompt,
      stream: false,
      ...options
    };
    
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 
        'Content-Type': 'application/json',
      },
      timeout: 30000 // 30 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Ollama LLM request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.response) {
      throw new Error('No response from Ollama LLM');
    }
    
    console.log(`[LocalLLM] ✅ Received response (${data.response.length} chars): "${data.response.substring(0, 100)}..."`);
    
    return data.response.trim();
    
  } catch (error) {
    console.error(`[LocalLLM] ❌ Error calling offline LLM:`, error.message);
    throw error;
  }
}

/**
 * Enhanced local LLM with context and system prompt for HVAC assistance
 * @param {string} userInput - The user's question
 * @param {string} companyName - The company name for context
 * @param {string} tradeCategory - The trade category (e.g., 'hvac-residential')
 * @returns {Promise<string>} - Professional HVAC response
 */
async function localLLMWithContext(userInput, companyName = '', tradeCategory = 'hvac') {
  const contextPrompt = `You are a professional ${tradeCategory} assistant for ${companyName}. 
Provide helpful, accurate, and professional responses to customer questions about heating, ventilation, air conditioning, and related services.

Keep responses:
- Concise but complete (2-3 sentences max)
- Professional and friendly
- Focused on safety when applicable
- Clear about when professional service is needed

Customer question: ${userInput}

Professional response:`;

  return await localLLM(contextPrompt);
}

/**
 * Test if Ollama is running and accessible
 * @returns {Promise<boolean>} - True if Ollama is accessible
 */
async function testOllamaConnection() {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      timeout: 5000
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[LocalLLM] ✅ Ollama is running with ${data.models?.length || 0} models`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.log(`[LocalLLM] ❌ Ollama connection test failed:`, error.message);
    return false;
  }
}

module.exports = {
  localLLM,
  localLLMWithContext,
  testOllamaConnection
};

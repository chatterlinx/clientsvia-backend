/**
 * ============================================================================
 * OPENAI CLIENT - CONFIGURATION
 * ============================================================================
 * 
 * Central configuration for OpenAI API integration.
 * Used for:
 * - LLM Scenario Assistant (admin-side drafting)
 * - Frontline-Intel (intent extraction, customer lookup)
 * - Future: Tier 3 LLM Fallback (runtime matching)
 * 
 * Environment: OPENAI_API_KEY
 * 
 * IMPORTANT: Uses lazy initialization to prevent server crashes if API key
 * is not available during module load. Client is created on first use.
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../utils/logger');

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      logger.error('❌ [OPENAI] OPENAI_API_KEY environment variable is not set!');
      throw new Error('OPENAI_API_KEY is required but not configured');
    }
    
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    logger.info('🤖 [OPENAI] Client initialized successfully');
  }
  
  return openaiClient;
}

// For backward compatibility, export a Proxy that lazily initializes
module.exports = new Proxy({}, {
  get(target, prop) {
    const client = getOpenAIClient();
    return client[prop];
  }
});


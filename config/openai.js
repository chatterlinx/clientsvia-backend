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
 * IMPORTANT: Safe initialization - server will start even if API key is missing.
 * OpenAI features will fail gracefully with proper error messages.
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../utils/logger');

let openaiClient = null;

// Initialize OpenAI client safely (won't crash server if key is missing)
try {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    logger.info('🤖 [OPENAI] Client initialized successfully');
  } else {
    logger.warn('⚠️ [OPENAI] OPENAI_API_KEY not configured - LLM features will be unavailable');
  }
} catch (error) {
  logger.error('❌ [OPENAI] Failed to initialize OpenAI client:', error.message);
  openaiClient = null;
}

module.exports = openaiClient;


/**
 * ============================================================================
 * OPENAI CLIENT - CONFIGURATION
 * ============================================================================
 * 
 * Central configuration for OpenAI API integration.
 * Used for:
 * - LLM Scenario Assistant (admin-side drafting)
 * - Future: Tier 3 LLM Fallback (runtime matching)
 * 
 * Environment: OPENAI_API_KEY
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../utils/logger');

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

logger.info('🤖 [OPENAI] Client initialized (API key configured: %s)', 
  Boolean(process.env.OPENAI_API_KEY));

module.exports = openaiClient;


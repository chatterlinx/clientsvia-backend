const checkCustomKB = require('./checkCustomKB');
const ollamaService = require('../services/ollamaService');

/**
 * Enhanced Knowledge Base middleware with Ollama LLM fallback
 * This middleware first checks the custom KB, then falls back to Ollama if no good matches found
 */
async function checkKBWithFallback(transcript, companyID, traceLogger, options = {}) {
  const {
    ollamaFallbackEnabled = true,
    confidenceThreshold = 70,
    company = null,
    conversationHistory = [],
    selectedTradeCategories = []
  } = options;

  // Step 1: Check Custom Knowledge Base first with selected trade categories
  console.log(`[KB+Ollama] Checking custom knowledge base with trade categories: [${selectedTradeCategories.join(', ')}]`);
  const kbResult = await checkCustomKB(transcript, companyID, traceLogger, { selectedTradeCategories });
  
  // If we have a good KB match, use it
  if (kbResult && kbResult.answer) {
    console.log(`[KB+Ollama] ✅ Custom KB provided answer from selected trade categories`);
    return {
      answer: kbResult.answer,
      source: 'custom_kb',
      confidence: 0.9,
      trace: kbResult.trace,
      fallbackUsed: false
    };
  }

  // Step 2: Check if Ollama fallback is enabled and available
  if (!ollamaFallbackEnabled) {
    console.log(`[KB+Ollama] Ollama fallback disabled, returning null`);
    return {
      answer: null,
      source: 'none',
      confidence: 0,
      trace: kbResult?.trace || 'No KB matches found, Ollama disabled',
      fallbackUsed: false
    };
  }

  console.log(`[KB+Ollama] Custom KB had no good matches, trying Ollama fallback...`);
  
  try {
    // Check if Ollama is available
    const isOllamaHealthy = await ollamaService.checkHealth();
    if (!isOllamaHealthy) {
      console.log(`[KB+Ollama] ❌ Ollama not available, returning null`);
      return {
        answer: null,
        source: 'none',
        confidence: 0,
        trace: (kbResult?.trace || '') + '\nOllama fallback: Service not available',
        fallbackUsed: false
      };
    }

    // Build context for Ollama with selected trade categories
    const tradeCategories = selectedTradeCategories.length > 0 ? selectedTradeCategories : [getTradeCategory(company)];
    const context = {
      companyName: company?.companyName || 'the company',
      tradeCategory: tradeCategories.join(', '),
      tradeCategories: tradeCategories,
      personality: company?.aiSettings?.personality || 'professional and helpful',
      conversationHistory: conversationHistory,
      customInstructions: `Answer this customer service question based on general ${tradeCategories.join(', ')} knowledge. Be helpful but acknowledge if you need to connect them with a specialist.`
    };

    // Generate response using Ollama
    const ollamaResult = await ollamaService.generateAgentResponse(transcript, context);
    
    if (ollamaResult.success && ollamaResult.text) {
      console.log(`[KB+Ollama] ✅ Ollama provided fallback answer (${ollamaResult.responseTime}ms)`);
      
      const enhancedTrace = (kbResult?.trace || '') + 
        `\nOllama fallback: ✅ Generated response using ${ollamaResult.model} (${ollamaResult.responseTime}ms)`;
      
      return {
        answer: ollamaResult.text,
        source: 'ollama_fallback',
        confidence: 0.7, // Lower confidence since it's AI-generated
        trace: enhancedTrace,
        fallbackUsed: true,
        ollamaModel: ollamaResult.model,
        responseTime: ollamaResult.responseTime
      };
    } else {
      console.log(`[KB+Ollama] ❌ Ollama failed to generate response: ${ollamaResult.error}`);
      
      const errorTrace = (kbResult?.trace || '') + 
        `\nOllama fallback: ❌ Failed - ${ollamaResult.error}`;
      
      return {
        answer: null,
        source: 'none',
        confidence: 0,
        trace: errorTrace,
        fallbackUsed: false,
        error: ollamaResult.error
      };
    }

  } catch (error) {
    console.error(`[KB+Ollama] ❌ Ollama fallback error:`, error.message);
    
    const errorTrace = (kbResult?.trace || '') + 
      `\nOllama fallback: ❌ Exception - ${error.message}`;
    
    return {
      answer: null,
      source: 'none',
      confidence: 0,
      trace: errorTrace,
      fallbackUsed: false,
      error: error.message
    };
  }
}

/**
 * Helper function to extract trade category from company data
 */
function getTradeCategory(company) {
  if (!company) return 'general service';
  
  // Try different possible fields for trade category
  if (company.tradeCategory) return company.tradeCategory;
  if (company.trade) return company.trade;
  if (company.industry) return company.industry;
  if (company.businessType) return company.businessType;
  
  // Try to extract from trade types array
  if (company.tradeTypes && company.tradeTypes.length > 0) {
    return company.tradeTypes[0];
  }
  
  return 'general service';
}

/**
 * Backwards compatibility - export both the enhanced version and original
 */
module.exports = {
  checkKBWithFallback,
  checkCustomKB, // Original function for backwards compatibility
  getTradeCategory
};

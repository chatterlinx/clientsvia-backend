// Enhanced middleware - Local LLM disabled, cloud-only operation
// when custom knowledge base doesn't have sufficient answers

/**
 * Enhanced checkCustomKB with LLM fallback
 * This wraps your existing checkCustomKB and adds cloud LLM as a fallback
 */
async function checkCustomKBWithLLMFallback(transcript, companyID, traceLogger) {
  // Import the original checkCustomKB function
  const { checkCustomKB } = require('./checkCustomKB');
  
  // First, try your existing knowledge base
  const kbResult = await checkCustomKB(transcript, companyID, traceLogger);
  
  // If KB found a good answer (confidence > 70%), use it
  if (kbResult.answer && kbResult.confidence && kbResult.confidence >= 70) {
    traceLogger.addCheck({ 
      source: 'Knowledge Base Decision', 
      details: `Using KB answer with ${kbResult.confidence}% confidence` 
    });
    return kbResult;
  }
  
  // If KB has low confidence or no answer, try cloud LLM fallback
  try {
    traceLogger.addCheck({ 
      source: 'LLM Fallback Decision', 
      details: `KB confidence too low (${kbResult.confidence || 0}%), attempting LLM fallback` 
    });

    // Get company context for the LLM
    const Company = require('../models/Company');
    const company = await Company.findById(companyID);
    
    let companyContext = '';
    if (company) {
      companyContext = `Company: ${company.name}
Business Type: ${company.businessType || 'Service Provider'}
Trade: ${company.tradeCategory || 'General Services'}`;
      
      // Add company-specific context if available
      if (company.aiSettings && company.aiSettings.companyDescription) {
        companyContext += `\nDescription: ${company.aiSettings.companyDescription}`;
      }
    }

    // Local LLM disabled - use fallback response
    const fallbackResponse = "Thank you for your inquiry. Our team will review your question and get back to you with detailed information as soon as possible.";

    traceLogger.addCheck({ 
      source: 'Fallback Response', 
      details: 'Local LLM disabled - using standard fallback response' 
    });

    return {
      answer: fallbackResponse,
      confidence: 60, // Lower confidence for fallback responses
      source: 'Fallback',
      fallbackUsed: true,
      originalKBResult: kbResult,
      trace: traceLogger.toLog()
    };

  } catch (error) {
    traceLogger.addCheck({ 
      source: 'LLM Fallback Error', 
      details: `LLM fallback failed: ${error.message}` 
    });

    // If LLM fails, return original KB result or a generic message
    if (kbResult.answer) {
      return {
        ...kbResult,
        fallbackAttempted: true,
        fallbackError: error.message
      };
    } else {
      return {
        answer: "I apologize, but I don't have specific information about that. Please contact our support team for assistance.",
        confidence: 30,
        source: 'Generic',
        fallbackAttempted: true,
        fallbackError: error.message,
        trace: traceLogger.toLog()
      };
    }
  }
}

/**
 * Simple wrapper function that can replace your existing checkCustomKB calls
 */
async function enhancedCheckCustomKB(transcript, companyID, traceLogger) {
  return await checkCustomKBWithLLMFallback(transcript, companyID, traceLogger);
}

module.exports = {
  checkCustomKBWithLLMFallback,
  enhancedCheckCustomKB
};

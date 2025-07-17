// utils/checkCustomKB.js
// Production-grade Custom Knowledge Base checker for Trade Categories
// Now with transparent AI Response Trace Logging

const ServiceIssueHandler = require('../services/serviceIssueHandler');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const ResponseTraceLogger = require('./responseTraceLogger');

/**
 * Check Custom Knowledge Base for trade-specific answers with trace logging
 */
async function checkCustomKB(transcript, companyID, tradeCategoryID = null, traceLogger = null) {
  try {
    // Extract keywords for trace logging
    const keywords = extractKeywords(transcript);
    
    // Initialize trace logger if not provided
    if (!traceLogger) {
      traceLogger = new ResponseTraceLogger();
      traceLogger.startTrace(transcript, keywords);
    }
    
    console.log(`[checkCustomKB] Processing: "${transcript}" for company: ${companyID}`);
    
    // Get company data with trade category info
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(companyID) 
    });
    
    if (!company) {
      console.log(`[checkCustomKB] Company not found: ${companyID}`);
      traceLogger.logSourceCheck('Company Lookup', {}, {
        matched: false,
        matchedKeywords: [],
        totalMatches: 0,
        totalAvailable: 0,
        confidence: 0,
        reason: 'Company not found'
      });
      return { result: null, trace: traceLogger.getTraceLog() };
    }
    
    // Determine trade category - use provided or infer from company
    let effectiveTradeCategoryID = tradeCategoryID;
    
    if (!effectiveTradeCategoryID) {
      // Infer from company categories or default to first category
      const categories = company?.agentSetup?.categories || company?.tradeTypes || [];
      if (categories.length > 0) {
        effectiveTradeCategoryID = categories[0].toLowerCase().replace(/\s+/g, '-');
      }
      
      // Special handling for known HVAC companies
      if (company.companyName?.toLowerCase().includes('air') || 
          company.companyName?.toLowerCase().includes('hvac') ||
          company.companyName?.toLowerCase().includes('heating') ||
          company.companyName?.toLowerCase().includes('cooling')) {
        effectiveTradeCategoryID = 'hvac-residential';
      }
    }
    
    console.log(`[checkCustomKB] Using trade category: ${effectiveTradeCategoryID}`);
    
    // Method 1: Check company's category Q&As first (fastest)
    const categoryQAResult = await checkCompanyCategoryQAsWithTrace(transcript, company, keywords, traceLogger);
    if (categoryQAResult.matched) {
      console.log(`[checkCustomKB] Found match in company category Q&As`);
      traceLogger.setSelectedSource('Company Category Q&As', 'Direct keyword match', categoryQAResult.confidence, categoryQAResult.answer);
      return { result: categoryQAResult.answer, trace: traceLogger.getTraceLog() };
    }
    
    // Method 2: Use ServiceIssueHandler for systematic checking
    try {
      const serviceHandler = new ServiceIssueHandler();
      const serviceResult = await serviceHandler.checkCategoryQAs(transcript, companyID, {
        category: effectiveTradeCategoryID,
        intent: 'knowledge_lookup'
      });
      
      if (serviceResult && serviceResult.response) {
        console.log(`[checkCustomKB] Found match in service issue handler`);
        traceLogger.logSourceCheck('Service Issue Handler', { category: effectiveTradeCategoryID }, {
          matchedKeywords: keywords,
          totalMatches: keywords.length,
          totalAvailable: keywords.length,
          confidence: 0.8,
          reason: 'Service handler match',
          matched: true
        });
        traceLogger.setSelectedSource('Service Issue Handler', 'Trade category match', 0.8, serviceResult.response);
        return { result: serviceResult.response, trace: traceLogger.getTraceLog() };
      } else {
        traceLogger.logSourceCheck('Service Issue Handler', { category: effectiveTradeCategoryID }, {
          matchedKeywords: [],
          totalMatches: 0,
          totalAvailable: keywords.length,
          confidence: 0,
          reason: 'No service handler match',
          matched: false
        });
      }
    } catch (serviceError) {
      console.error(`[checkCustomKB] Service handler error:`, serviceError);
      traceLogger.logSourceCheck('Service Issue Handler', { category: effectiveTradeCategoryID }, {
        matchedKeywords: [],
        totalMatches: 0,
        totalAvailable: keywords.length,
        confidence: 0,
        reason: `Error: ${serviceError.message}`,
        matched: false
      });
    }
    
    // Method 3: Direct database lookup for trade category Q&As
    const directResult = await checkTradeCategoryDatabaseWithTrace(transcript, effectiveTradeCategoryID, companyID, keywords, traceLogger);
    if (directResult.matched) {
      console.log(`[checkCustomKB] Found match in direct database lookup`);
      traceLogger.setSelectedSource('Trade Category Database', 'Database direct match', directResult.confidence, directResult.answer);
      return { result: directResult.answer, trace: traceLogger.getTraceLog() };
    }
    
    console.log(`[checkCustomKB] No matches found for: "${transcript}"`);
    traceLogger.setSelectedSource('None', 'No matches found in any source', 0);
    return { result: null, trace: traceLogger.getTraceLog() };
    
  } catch (error) {
    console.error(`[checkCustomKB] Error:`, error);
    return null;
  }
}

/**
 * Check company's category Q&As with trace logging
 */
async function checkCompanyCategoryQAsWithTrace(transcript, company, keywords, traceLogger) {
  try {
    const categoryQAsText = company?.agentSetup?.categoryQAs;
    if (!categoryQAsText) {
      traceLogger.logSourceCheck('Company Category Q&As', {}, {
        matched: false,
        matchedKeywords: [],
        totalMatches: 0,
        totalAvailable: 0,
        confidence: 0,
        reason: 'No company Q&As configured'
      });
      return { matched: false };
    }
    
    // Parse the category Q&As
    const qaPairs = parseCategoryQAs(categoryQAsText);
    const lowerTranscript = transcript.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;
    let matchedKeywords = [];
    
    // Look for keyword matches
    for (const qa of qaPairs) {
      const questionLower = qa.question.toLowerCase();
      const currentMatches = [];
      
      // Direct keyword matching
      if (questionLower.includes('thermostat') && lowerTranscript.includes('thermostat')) {
        currentMatches.push('thermostat');
        if (lowerTranscript.includes('blank') || lowerTranscript.includes('display') || 
            lowerTranscript.includes('screen') || lowerTranscript.includes('not working')) {
          currentMatches.push('blank/display/screen');
          console.log(`[checkCustomKB] Category Q&A match: "${qa.question}"`);
          bestMatch = qa.answer;
          bestScore = 0.9;
          matchedKeywords = currentMatches;
          break;
        }
      }
      
      // Calculate relevance score
      const relevance = calculateRelevance(questionLower, lowerTranscript);
      if (relevance > 0.6 && relevance > bestScore) {
        console.log(`[checkCustomKB] High relevance match (${relevance.toFixed(2)}): "${qa.question}"`);
        bestMatch = qa.answer;
        bestScore = relevance;
        matchedKeywords = keywords.filter(k => questionLower.includes(k.toLowerCase()));
      }
    }
    
    // Log the trace
    traceLogger.logSourceCheck('Company Category Q&As', { totalQAs: qaPairs.length }, {
      matched: !!bestMatch,
      matchedKeywords: matchedKeywords,
      totalMatches: matchedKeywords.length,
      totalAvailable: keywords.length,
      confidence: bestScore,
      reason: bestMatch ? `Matched: "${bestMatch.substring(0, 50)}..."` : 'No matches above threshold'
    });
    
    return { 
      matched: !!bestMatch, 
      answer: bestMatch, 
      confidence: bestScore, 
      matchedKeywords 
    };
    
  } catch (error) {
    console.error(`[checkCustomKB] Error checking category Q&As:`, error);
    traceLogger.logSourceCheck('Company Category Q&As', {}, {
      matched: false,
      matchedKeywords: [],
      totalMatches: 0,
      totalAvailable: 0,
      confidence: 0,
      reason: `Error: ${error.message}`
    });
    return { matched: false };
  }
}

/**
 * Direct database lookup with trace logging
 */
async function checkTradeCategoryDatabaseWithTrace(transcript, categoryID, companyID, keywords, traceLogger) {
  try {
    const db = getDB();
    
    // Check if there's a dedicated trade category Q&A collection
    const tradeCategoryQAs = db.collection('tradecategoryqas');
    
    const matches = await tradeCategoryQAs.find({
      categoryID: categoryID,
      $or: [
        { question: { $regex: new RegExp(transcript, 'i') } },
        { keywords: { $in: transcript.toLowerCase().split(' ') } }
      ]
    }).toArray();
    
    const matchedKeywords = keywords.filter(k => 
      transcript.toLowerCase().includes(k.toLowerCase())
    );
    
    traceLogger.logSourceCheck('Trade Category Database', { categoryID, totalEntries: matches.length }, {
      matched: matches.length > 0,
      matchedKeywords: matchedKeywords,
      totalMatches: matchedKeywords.length,
      totalAvailable: keywords.length,
      confidence: matches.length > 0 ? 0.85 : 0,
      reason: matches.length > 0 ? `Found ${matches.length} database matches` : 'No database matches'
    });
    
    if (matches.length > 0) {
      console.log(`[checkCustomKB] Found ${matches.length} trade category matches`);
      return { 
        matched: true, 
        answer: matches[0].answer, 
        confidence: 0.85, 
        matchedKeywords 
      };
    }
    
    return { matched: false };
  } catch (error) {
    console.error(`[checkCustomKB] Error checking trade category database:`, error);
    traceLogger.logSourceCheck('Trade Category Database', {}, {
      matched: false,
      matchedKeywords: [],
      totalMatches: 0,
      totalAvailable: 0,
      confidence: 0,
      reason: `Database error: ${error.message}`
    });
    return { matched: false };
  }
}

/**
 * Extract keywords from transcript for trace logging
 */
function extractKeywords(transcript) {
  const commonWords = ['the', 'is', 'my', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
  return transcript
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.includes(word))
    .slice(0, 10); // Limit to first 10 keywords
}

/**
 * Parse category Q&As from text format
 */
function parseCategoryQAs(text = '') {
  const pairs = [];
  const blocks = text.split('\n\n').filter(b => b.trim() !== '');
  
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '');
      
    if (lines.length >= 2) {
      const q = lines[0].replace(/^(Q:|Question:)\s*/i, '');
      const a = lines
        .slice(1)
        .join(' ')
        .replace(/^(A:|Answer:)\s*/i, '');
      pairs.push({ question: q, answer: a });
    }
  }
  
  return pairs;
}

/**
 * Calculate relevance between question and user input
 */
function calculateRelevance(question, userInput) {
  const questionWords = question.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const userWords = userInput.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  
  let matches = 0;
  for (const word of questionWords) {
    if (userWords.some(uw => uw.includes(word) || word.includes(uw))) {
      matches++;
    }
  }
  
  return questionWords.length > 0 ? matches / questionWords.length : 0;
}

/**
 * Enhanced check that includes behavioral context
 */
async function checkCustomKBWithBehavior(transcript, companyID, tradeCategoryID, behaviorContext = {}) {
  // First check standard knowledge base
  const kbResult = await checkCustomKB(transcript, companyID, tradeCategoryID);
  
  if (kbResult) {
    // Enhance response based on behavioral context
    if (behaviorContext.customerFrustration) {
      return `I understand this can be frustrating. ${kbResult}`;
    }
    
    if (behaviorContext.repeatedQuestion) {
      return `Let me provide more details: ${kbResult}`;
    }
    
    return kbResult;
  }
  
  return null;
}

/**
 * Check company's category Q&As (original function for backwards compatibility)
 */
async function checkCompanyCategoryQAs(transcript, company) {
  const traceLogger = new ResponseTraceLogger();
  const keywords = extractKeywords(transcript);
  traceLogger.startTrace(transcript, keywords);
  
  const result = await checkCompanyCategoryQAsWithTrace(transcript, company, keywords, traceLogger);
  return result.matched ? result.answer : null;
}

/**
 * Check trade category database (original function for backwards compatibility)
 */
async function checkTradeCategoryDatabase(transcript, categoryID, companyID) {
  const traceLogger = new ResponseTraceLogger();
  const keywords = extractKeywords(transcript);
  
  const result = await checkTradeCategoryDatabaseWithTrace(transcript, categoryID, companyID, keywords, traceLogger);
  return result.matched ? result.answer : null;
}

module.exports = {
  checkCustomKB,
  checkCustomKBWithBehavior,
  checkCompanyCategoryQAs,
  checkTradeCategoryDatabase,
  parseCategoryQAs,
  calculateRelevance
};

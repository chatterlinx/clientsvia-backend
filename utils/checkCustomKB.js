// Deprecated: Use /middleware/checkCustomKB.js instead

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
    console.log(`[checkCustomKB] Database name:`, db.databaseName);
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(companyID) 
    });
    
    console.log(`[checkCustomKB] Company lookup result:`, company ? 'Found' : 'Not found');
    console.log(`[checkCustomKB] Company ID used:`, companyID);
    
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
    
    console.log(`[checkCustomKB] Company found: ${company.companyName}`);
    console.log(`[checkCustomKB] Has agentSetup:`, company.agentSetup ? 'Yes' : 'No');
    console.log(`[checkCustomKB] Has categoryQAs:`, company.agentSetup?.categoryQAs ? 'Yes' : 'No');
    
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
    
    // Debug company data
    console.log(`[checkCustomKB] Company found: ${company.companyName}`);
    console.log(`[checkCustomKB] Has agentSetup:`, company.agentSetup ? 'Yes' : 'No');
    console.log(`[checkCustomKB] Has categoryQAs:`, company.agentSetup?.categoryQAs ? 'Yes' : 'No');
    
    // Method 1: Check company's category Q&As first (fastest)
    const categoryQAResult = await checkCompanyCategoryQAsWithTrace(transcript, company, keywords, traceLogger);
    if (categoryQAResult.matched && categoryQAResult.confidence >= 0.7) {
      console.log(`[checkCustomKB] Found HIGH CONFIDENCE match in company category Q&As`);
      console.log(`[checkCustomKB] CRITICAL CHECK - Answer exists:`, !!categoryQAResult.answer);
      console.log(`[checkCustomKB] CRITICAL CHECK - Answer content:`, categoryQAResult.answer);
      
      // FORCE answer if confidence is high but answer is missing
      let finalAnswer = categoryQAResult.answer;
      if (categoryQAResult.confidence >= 0.9 && !finalAnswer) {
        finalAnswer = "I found a match for your question but the answer wasn't configured properly. Please contact support for assistance.";
        console.error(`[checkCustomKB] FORCED FALLBACK ANSWER due to missing content`);
      }
      
      // CRITICAL FIX: Properly set the selected source with ALL data
      traceLogger.setSelectedSource(
        'Company Category Q&As', 
        `Direct keyword match - ${categoryQAResult.confidence * 100}%`, 
        categoryQAResult.confidence * 100,
        {
          question: categoryQAResult.question || 'Unknown question',
          answer: finalAnswer,
          matchedKeywords: categoryQAResult.matchedKeywords || [],
          confidence: categoryQAResult.confidence
        }
      );
      
      return { result: finalAnswer, trace: traceLogger.getTraceLog() };
    } else if (categoryQAResult.matched) {
      console.log(`[checkCustomKB] Found LOW CONFIDENCE match in company category Q&As (${categoryQAResult.confidence * 100}%) - continuing to trade fallback`);
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
    
    // Method 3: Direct database lookup for trade category Q&As - ALWAYS EXECUTE
    console.log(`[checkCustomKB] Executing trade category fallback for: "${transcript}"`);
    const directResult = await checkTradeCategoryDatabaseWithTrace(transcript, effectiveTradeCategoryID, companyID, keywords, traceLogger);
    if (directResult.matched) {
      console.log(`[checkCustomKB] TRADE CATEGORY SUCCESS: Found match with confidence ${directResult.confidence * 100}%`);
      console.log(`[checkCustomKB] TRADE CATEGORY ANSWER:`, directResult.answer);
      
      // FORCE 100% confidence for trade category matches  
      const finalConfidence = directResult.confidence >= 0.85 || (directResult.matchedKeywords.length === keywords.length) ? 100 : directResult.confidence * 100;
      
      traceLogger.setSelectedSource(
        'Trade Category Database', 
        `Database direct match - ${finalConfidence}%`, 
        finalConfidence,
        {
          question: `Trade category question for: ${directResult.matchedKeywords.join(', ')}`,
          answer: directResult.answer,
          matchedKeywords: directResult.matchedKeywords,
          confidence: directResult.confidence
        }
      );
      return { result: directResult.answer, trace: traceLogger.getTraceLog() };
    }
    
    console.log(`[checkCustomKB] No matches found for: "${transcript}" - all sources exhausted`);
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
    let bestMatchQuestion = null;
    let bestScore = 0;
    let matchedKeywords = [];
    
    // Look for keyword matches
    for (const qa of qaPairs) {
      const questionLower = qa.question.toLowerCase();
      const currentMatches = [];
      
      // DEBUG: Log Q&A data structure
      console.log(`[checkCustomKB] DEBUG Q&A entry:`, { 
        question: qa.question, 
        answer: qa.answer,
        answerExists: !!qa.answer,
        answerLength: qa.answer?.length || 0
      });
      
      // Skip if no answer exists
      if (!qa.answer || qa.answer.trim() === '') {
        console.log(`[checkCustomKB] WARNING: Skipping Q&A with empty answer: "${qa.question}"`);
        continue;
      }
      
      // Direct keyword matching
      if (questionLower.includes('thermostat') && lowerTranscript.includes('thermostat')) {
        currentMatches.push('thermostat');
        if (lowerTranscript.includes('blank') || lowerTranscript.includes('display') || 
            lowerTranscript.includes('screen') || lowerTranscript.includes('not working')) {
          currentMatches.push('blank/display/screen');
          console.log(`[checkCustomKB] Category Q&A match: "${qa.question}"`);
          console.log(`[checkCustomKB] ANSWER FOUND: "${qa.answer}"`);
          bestMatch = qa.answer;
          bestMatchQuestion = qa.question; // Store the question too
          bestScore = 1.0; // 100% match for exact keyword combo
          matchedKeywords = currentMatches;
          break;
        }
      }
      
      // Calculate relevance score
      const relevance = calculateRelevance(questionLower, lowerTranscript);
      if (relevance > 0.6 && relevance > bestScore) {
        console.log(`[checkCustomKB] High relevance match (${relevance.toFixed(2)}): "${qa.question}"`);
        console.log(`[checkCustomKB] ANSWER FOUND: "${qa.answer}"`);
        bestMatch = qa.answer;
        bestMatchQuestion = qa.question; // Store the question too
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
    
    // CRITICAL FIX: Never return null answer for 100% match
    if (bestScore >= 0.9 && !bestMatch) {
      console.error(`[checkCustomKB] CRITICAL ERROR: 100% match but no answer! Setting fallback.`);
      bestMatch = "I found information about your question but the answer wasn't properly configured. Please contact support.";
    }
    
    // DEBUG: Final return values
    console.log(`[checkCustomKB] FINAL RETURN VALUES:`, {
      matched: !!bestMatch,
      answer: bestMatch,
      question: bestMatchQuestion,
      answerLength: bestMatch?.length || 0,
      confidence: bestScore
    });
    
    return { 
      matched: !!bestMatch, 
      answer: bestMatch, 
      question: bestMatchQuestion,
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
 * Direct database lookup with trace logging - ENHANCED FOR ALL COMPANIES
 */
async function checkTradeCategoryDatabaseWithTrace(transcript, categoryID, companyID, keywords, traceLogger) {
  try {
    const db = getDB();
    console.log(`[checkTradeCategoryDB] Searching for categoryID: ${categoryID}, companyID: ${companyID}`);
    
    // Use the new enterprise trade categories system
    const searchText = transcript.toLowerCase();
    
    // Try to match with enterprise trade categories
    const category = await db.collection('enterpriseTradeCategories').findOne({
      $or: [
        { name: categoryID },
        { name: { $regex: categoryID, $options: 'i' } }
      ],
      isActive: { $ne: false }
    });
    
    if (!category || !category.qnas) {
      console.log(`[checkTradeCategoryDB] No enterprise category found for: ${categoryID}`);
      
      if (traceLogger) {
        traceLogger.logSourceCheck('Enterprise Trade Categories', { 
          categoryID, 
          searchAttempt: 'enterprise-categories'
        }, {
          matched: false,
          matchedKeywords: [],
          totalMatches: 0,
          totalAvailable: 0,
          confidence: 0,
          reason: `No enterprise category found for: ${categoryID}`
        });
      }
      
      return { matched: false };
    }
    
    let bestMatch = null;
    let bestScore = 0;
    const matchedKeywords = [];
    
    // Search through Q&As in the enterprise category
    for (const qa of category.qnas) {
      if (qa.isActive === false) continue;
      
      let score = 0;
      
      // Check if transcript matches question
      if (qa.question.toLowerCase().includes(searchText)) {
        score += 0.5;
      }
      
      // Check if transcript matches answer
      if (qa.answer.toLowerCase().includes(searchText)) {
        score += 0.3;
      }
      
      // Check keyword matches
      if (qa.keywords && qa.keywords.length > 0) {
        for (const keyword of qa.keywords) {
          if (searchText.includes(keyword.toLowerCase())) {
            score += 0.2;
            if (!matchedKeywords.includes(keyword)) {
              matchedKeywords.push(keyword);
            }
          }
        }
      }
      
      // Check against provided keywords
      if (keywords && keywords.length > 0) {
        for (const keyword of keywords) {
          if (qa.question.toLowerCase().includes(keyword.toLowerCase()) ||
              qa.answer.toLowerCase().includes(keyword.toLowerCase())) {
            score += 0.2;
            if (!matchedKeywords.includes(keyword)) {
              matchedKeywords.push(keyword);
            }
          }
        }
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = qa;
      }
    }
    
    // Calculate confidence based on matches
    const keywordScore = keywords.length > 0 ? matchedKeywords.length / keywords.length : bestScore;
    const confidence = Math.min(keywordScore >= 1.0 ? 100 : (keywordScore >= 0.5 ? 85 : Math.round(bestScore * 100)), 100);
    
    if (traceLogger) {
      traceLogger.logSourceCheck('Enterprise Trade Categories', { 
        categoryID, 
        category: category.name,
        totalQnAs: category.qnas.length
      }, {
        matched: bestMatch !== null,
        matchedKeywords: matchedKeywords,
        totalMatches: matchedKeywords.length,
        totalAvailable: keywords.length,
        confidence: confidence / 100,
        reason: bestMatch ? `Found match in ${category.name} - ${confidence}% confidence` : 'No matching Q&As found'
      });
    }
    
    if (bestMatch && bestScore > 0.3) { // Minimum threshold for match
      console.log(`[checkTradeCategoryDB] Found enterprise match with score ${bestScore}:`, bestMatch.question.substring(0, 50));
      
      return {
        matched: true,
        answer: bestMatch.answer,
        question: bestMatch.question,
        confidence: confidence / 100,
        matchedKeywords: matchedKeywords,
        source: 'enterprise-trade-categories',
        category: category.name
      };
    }
    
    console.log(`[checkTradeCategoryDB] No adequate matches found in enterprise category: ${category.name}`);
    return { matched: false };
    
  } catch (error) {
    console.error(`[checkTradeCategoryDB] Error checking enterprise trade category database:`, error);
    
    if (traceLogger) {
      traceLogger.logSourceCheck('Enterprise Trade Categories', {}, {
        matched: false,
        matchedKeywords: [],
        totalMatches: 0,
        totalAvailable: 0,
        confidence: 0,
        reason: `Database error: ${error.message}`
      });
    }
    
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
  
  console.log(`[parseCategoryQAs] Parsing ${blocks.length} blocks from text:`, text.substring(0, 200));
  
  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map(l => l.trim())
      .filter(l => l !== '');
      
    if (lines.length >= 2) {
      const q = lines[0].replace(/^(Q:|Question:)\s*/i, '');
      
      // Find the actual answer line (starts with A: or Answer:)
      let answerStartIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].match(/^(A:|Answer:)\s*/i)) {
          answerStartIndex = i;
          break;
        }
      }
      
      let a = '';
      if (answerStartIndex >= 0) {
        // Join lines from answer start to end
        a = lines
          .slice(answerStartIndex)
          .join(' ')
          .replace(/^(A:|Answer:)\s*/i, '');
      } else {
        // Fallback: treat everything except first line as answer
        a = lines
          .slice(1)
          .join(' ')
          .replace(/^(A:|Answer:)\s*/i, '');
      }
      
      console.log(`[parseCategoryQAs] Parsed Q&A:`, { question: q, answer: a, answerLength: a.length });
      
      // Only add if both question and answer exist
      if (q.trim() && a.trim()) {
        pairs.push({ question: q, answer: a });
      } else {
        console.warn(`[parseCategoryQAs] Skipping incomplete Q&A: Q="${q}" A="${a}"`);
      }
    }
  }
  
  console.log(`[parseCategoryQAs] Total parsed pairs: ${pairs.length}`);
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
  calculateRelevance,
  extractKeywords
};

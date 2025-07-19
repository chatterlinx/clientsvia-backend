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
    
    // BULLETPROOF MATCHING LOGIC - NO MORE BROKEN RETURNS
    console.log(`[checkCustomKB] === STARTING BULLETPROOF MATCH LOGIC ===`);
    
    // Step 1: Gather ALL matches from all sources
    let companyMatches = [];
    let tradeMatches = [];
    
    // Get company category Q&A matches
    const categoryQAResult = await checkCompanyCategoryQAsWithTrace(transcript, company, keywords, traceLogger);
    if (categoryQAResult.matched && categoryQAResult.answer) {
      companyMatches.push({
        question: `Company Q&A Match`,
        answer: categoryQAResult.answer,
        confidence: categoryQAResult.confidence * 100, // Convert to percentage
        matches: `${categoryQAResult.matchedKeywords?.length || 0}/${keywords.length} matches - ${Math.round(categoryQAResult.confidence * 100)}% (${categoryQAResult.matchedKeywords?.join(', ') || 'no keywords'})`
      });
    }
    
    // Get service handler matches  
    try {
      const serviceHandler = new ServiceIssueHandler();
      const serviceResult = await serviceHandler.checkCategoryQAs(transcript, companyID, {
        category: effectiveTradeCategoryID,
        intent: 'knowledge_lookup'
      });
      
      if (serviceResult && serviceResult.response) {
        tradeMatches.push({
          question: `Service Handler Match`,
          answer: serviceResult.response,
          confidence: 80, // Fixed confidence for service handler
          matches: `Service handler - 80% (trade category match)`
        });
      }
    } catch (serviceError) {
      console.error(`[checkCustomKB] Service handler error:`, serviceError);
    }
    
    // Get direct database matches
    const directResult = await checkTradeCategoryDatabaseWithTrace(transcript, effectiveTradeCategoryID, companyID, keywords, traceLogger);
    if (directResult.matched && directResult.answer) {
      tradeMatches.push({
        question: `Trade Database Match`,
        answer: directResult.answer,
        confidence: directResult.confidence * 100, // Convert to percentage
        matches: `${directResult.matchedKeywords?.length || 0}/${keywords.length} matches - ${Math.round(directResult.confidence * 100)}% (${directResult.matchedKeywords?.join(', ') || 'no keywords'})`
      });
    }
    
    // Step 1: Gather all matches (companyMatches, tradeMatches)
    const allMatches = [
      ...(companyMatches || []),
      ...(tradeMatches || [])
    ];
    
    // DEBUG: Log all matches for debugging
    console.log('ALL MATCHES', allMatches);
    
    // Step 2: If no matches, log and bail out
    if (!allMatches.length) {
      console.log(`[checkCustomKB] No matches found anywhere`);
      traceLogger.setSelectedSource('No matches found, agent falling back to generic/no response');
      return { result: null, trace: traceLogger.getTraceLog() };
    }
    
    // Step 3: Find highest confidence match
    const best = allMatches.reduce((max, cur) => cur.confidence > max.confidence ? cur : max);
    
    console.log(`[checkCustomKB] BEST MATCH FOUND:`, {
      question: best.question,
      confidence: best.confidence,
      answer: best.answer,
      answerExists: !!best.answer,
      answerLength: best.answer?.length || 0
    });
    
    // Step 4: Return the answer if a match exists (NO MORE EXCUSES)
    if (best.confidence >= 70 && best.answer) {
      const source = companyMatches?.includes(best) ? 'Company' : 'Trade';
      traceLogger.setSelectedSource(`Selected: ${best.question} (${best.matches}) from ${source}`);
      console.log(`[checkCustomKB] === MATCH FOUND - RETURNING ANSWER ===`);
      console.log(`[checkCustomKB] FINAL ANSWER:`, best.answer);
      return { result: best.answer, trace: traceLogger.getTraceLog() };
    } else {
      traceLogger.setSelectedSource(`Best match did not meet threshold or answer missing: ${best.confidence}%`);
      console.log(`[checkCustomKB] === NO SUITABLE MATCH - CONFIDENCE TOO LOW ===`);
      return { result: null, trace: traceLogger.getTraceLog() };
    }
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
      answerLength: bestMatch?.length || 0,
      confidence: bestScore
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

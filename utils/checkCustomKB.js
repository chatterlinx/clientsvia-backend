// utils/checkCustomKB.js
// Production-grade Custom Knowledge Base checker for Trade Categories

const ServiceIssueHandler = require('../services/serviceIssueHandler');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

/**
 * Check Custom Knowledge Base for trade-specific answers
 * This function bridges the gap between conversation flow and trade category Q&As
 */
async function checkCustomKB(transcript, companyID, tradeCategoryID = null) {
  try {
    console.log(`[checkCustomKB] Processing: "${transcript}" for company: ${companyID}`);
    
    // Get company data with trade category info
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
      _id: new ObjectId(companyID) 
    });
    
    if (!company) {
      console.log(`[checkCustomKB] Company not found: ${companyID}`);
      return null;
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
    const categoryQAResult = await checkCompanyCategoryQAs(transcript, company);
    if (categoryQAResult) {
      console.log(`[checkCustomKB] Found match in company category Q&As`);
      return categoryQAResult;
    }
    
    // Method 2: Use ServiceIssueHandler for systematic checking
    const serviceHandler = new ServiceIssueHandler();
    const serviceResult = await serviceHandler.checkCategoryQAs(transcript, companyID, {
      category: effectiveTradeCategoryID,
      intent: 'knowledge_lookup'
    });
    
    if (serviceResult) {
      console.log(`[checkCustomKB] Found match in service issue handler`);
      return serviceResult.response;
    }
    
    // Method 3: Direct database lookup for trade category Q&As
    const directResult = await checkTradeCategoryDatabase(transcript, effectiveTradeCategoryID, companyID);
    if (directResult) {
      console.log(`[checkCustomKB] Found match in direct database lookup`);
      return directResult;
    }
    
    console.log(`[checkCustomKB] No matches found for: "${transcript}"`);
    return null;
    
  } catch (error) {
    console.error(`[checkCustomKB] Error:`, error);
    return null;
  }
}

/**
 * Check company's category Q&As (stored in agentSetup.categoryQAs)
 */
async function checkCompanyCategoryQAs(transcript, company) {
  try {
    const categoryQAsText = company?.agentSetup?.categoryQAs;
    if (!categoryQAsText) {
      return null;
    }
    
    // Parse the category Q&As
    const qaPairs = parseCategoryQAs(categoryQAsText);
    const lowerTranscript = transcript.toLowerCase();
    
    // Look for keyword matches
    for (const qa of qaPairs) {
      const questionLower = qa.question.toLowerCase();
      
      // Direct keyword matching
      if (questionLower.includes('thermostat') && lowerTranscript.includes('thermostat')) {
        if (lowerTranscript.includes('blank') || lowerTranscript.includes('display') || 
            lowerTranscript.includes('screen') || lowerTranscript.includes('not working')) {
          console.log(`[checkCustomKB] Category Q&A match: "${qa.question}"`);
          return qa.answer;
        }
      }
      
      // Calculate relevance score
      const relevance = calculateRelevance(questionLower, lowerTranscript);
      if (relevance > 0.6) {
        console.log(`[checkCustomKB] High relevance match (${relevance.toFixed(2)}): "${qa.question}"`);
        return qa.answer;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[checkCustomKB] Error checking category Q&As:`, error);
    return null;
  }
}

/**
 * Direct database lookup for trade category Q&As
 */
async function checkTradeCategoryDatabase(transcript, categoryID, companyID) {
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
    
    if (matches.length > 0) {
      console.log(`[checkCustomKB] Found ${matches.length} trade category matches`);
      return matches[0].answer;
    }
    
    return null;
  } catch (error) {
    console.error(`[checkCustomKB] Error checking trade category database:`, error);
    return null;
  }
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

module.exports = {
  checkCustomKB,
  checkCustomKBWithBehavior,
  checkCompanyCategoryQAs,
  checkTradeCategoryDatabase,
  parseCategoryQAs,
  calculateRelevance
};

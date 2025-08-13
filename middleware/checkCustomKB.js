const Company = require('../models/Company');
const { extractKeywords } = require('../utils/keywordExtractor');
const { getDB } = require('../db');

async function checkCustomKB(transcript, companyID, traceLogger, options = {}) {
  const { selectedTradeCategories = [] } = options;
  const keywords = extractKeywords(transcript);

  // Step 1: Load Company Q&As (Multi-Tenant)
  const company = await Company.findById(companyID);
  let companyMatches = [];
  if (!company || !company.aiSettings.companyQAs?.length) {
    traceLogger.addCheck({ source: 'Company Category Q&As', details: 'No company Q&As configured' });
  } else {
    companyMatches = company.aiSettings.companyQAs.map(qa => {
      const qaKeywords = extractKeywords(qa.question);
      const matches = keywords.filter(k => qaKeywords.includes(k));
      const confidence = (matches.length / keywords.length) * 100;
      return { question: qa.question, matches: `${matches.length}/${keywords.length} matches - ${confidence.toFixed(0)}% (${matches.join(', ')})`, answer: qa.answer, confidence };
    }).filter(m => m.confidence > 0);
    traceLogger.addCheck({ source: 'Company Category Q&As', details: companyMatches.map(m => `${m.question}: ${m.matches}`).join('\n') || 'No matches' });
  }

  // Step 2: ENHANCED Trade Category Q&As - Search through ALL selected trade categories
  let tradeMatches = [];
  const companyTradeCategories = selectedTradeCategories.length > 0 ? selectedTradeCategories : (company?.tradeTypes || []);
  
  if (companyTradeCategories.length === 0) {
    traceLogger.addCheck({ source: 'Trade Category Database', details: 'No trade categories selected for this company' });
  } else {
    console.log(`[checkCustomKB] Searching Q&As in selected trade categories: [${companyTradeCategories.join(', ')}]`);
    
    // Search through all selected trade categories using enterprise system
    const db = getDB();
    for (const tradeCategoryName of companyTradeCategories) {
      const trade = await db.collection('enterpriseTradeCategories').findOne({ 
        name: { $regex: new RegExp(`^${tradeCategoryName}$`, 'i') },
        isActive: { $ne: false }
      });
      
      if (trade && trade.qnas && trade.qnas.length > 0) {
        console.log(`[checkCustomKB] Found ${trade.qnas.length} Q&As in enterprise category: ${tradeCategoryName}`);
        
        const categoryMatches = trade.qnas.filter(qa => qa.isActive !== false).map(qa => {
          const qaKeywords = extractKeywords(qa.question);
          const matches = keywords.filter(k => qaKeywords.includes(k));
          const confidence = (matches.length / keywords.length) * 100;
          return { 
            question: qa.question, 
            matches: `${matches.length}/${keywords.length} matches - ${confidence.toFixed(0)}% (${matches.join(', ')})`, 
            answer: qa.answer, 
            confidence,
            category: tradeCategoryName
          };
        }).filter(m => m.confidence > 0);
        
        tradeMatches.push(...categoryMatches);
      } else {
        console.log(`[checkCustomKB] No Q&As found in enterprise category: ${tradeCategoryName}`);
      }
    }
    
    // Sort by confidence
    tradeMatches.sort((a, b) => b.confidence - a.confidence);
    
    const tradeDetails = tradeMatches.length > 0 ? 
      tradeMatches.map(m => `${m.question}: ${m.matches} [${m.category}]`).join('\n') : 
      `No matches found in categories: ${companyTradeCategories.join(', ')}`;
    
    traceLogger.addCheck({ source: 'Trade Category Database', details: tradeDetails });
  }

  // Step 3: Select Best Match (Company > Trade, Threshold 70%)
  const allMatches = [...companyMatches, ...tradeMatches];
  if (!allMatches.length) {
    // No matches anywhere
    console.log(`[checkCustomKB] No matches found in any source`);
    return { answer: null, trace: traceLogger.toLog() };
  }
  
  const best = allMatches.reduce((max, cur) => cur.confidence > max.confidence ? cur : max);
  
  console.log(`[checkCustomKB] Best match found:`, { 
    question: best.question, 
    confidence: best.confidence, 
    answer: best.answer,
    category: best.category || 'company',
    answerExists: !!best.answer,
    answerLength: best.answer?.length || 0
  });
  
  if (best.confidence < 70) {
    console.log(`[checkCustomKB] Best match confidence (${best.confidence}%) below threshold (70%)`);
    return { answer: null, trace: traceLogger.toLog() };
  }
  
  // CRITICAL FIX: Force answer for high confidence matches
  let finalAnswer = best.answer;
  if (best.confidence >= 90 && !finalAnswer) {
    finalAnswer = "I found a match for your question but the answer wasn't configured properly. Please contact support.";
    console.error(`[checkCustomKB] FORCED FALLBACK: High confidence but no answer`);
  }
  
  traceLogger.setSelected(`Selected: ${best.question} (${best.matches}) from ${companyMatches.includes(best) ? 'Company' : `Trade[${best.category}]`}`);
  
  // NEVER return null answer for matches above threshold
  return { answer: finalAnswer, trace: traceLogger.toLog() };
}

module.exports = checkCustomKB;

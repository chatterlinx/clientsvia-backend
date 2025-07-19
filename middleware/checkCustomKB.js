const Company = require('../models/Company');
const TradeCategory = require('../models/TradeCategory');
const { extractKeywords } = require('../utils/keywordExtractor');

async function checkCustomKB(transcript, companyID, traceLogger) {
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

  // Step 2: Load Trade Category Q&As (Via Company's Trade)
  let tradeMatches = [];
  const trade = await TradeCategory.findById(company.tradeCategory);
  if (!trade || !trade.serviceTypes.qaPairs?.length) {
    traceLogger.addCheck({ source: 'Trade Category Database', details: 'No trade Q&As configured' });
  } else {
    tradeMatches = trade.serviceTypes.qaPairs.map(qa => {
      const qaKeywords = extractKeywords(qa.question);
      const matches = keywords.filter(k => qaKeywords.includes(k));
      const confidence = (matches.length / keywords.length) * 100;
      return { question: qa.question, matches: `${matches.length}/${keywords.length} matches - ${confidence.toFixed(0)}% (${matches.join(', ')})`, answer: qa.answer, confidence };
    }).filter(m => m.confidence > 0).sort((a, b) => b.confidence - a.confidence);
    traceLogger.addCheck({ source: 'Trade Category Database', details: tradeMatches.map(m => `${m.question}: ${m.matches}`).join('\n') || 'No matches' });
  }

  // Step 3: Select Best Match (Company > Trade, Threshold 70%)
  const allMatches = [...companyMatches, ...tradeMatches];
  
  // DEBUG: Log all matches for debugging
  console.log('ALL MATCHES', allMatches);
  
  if (!allMatches.length) {
    // No matches anywhere
    return { answer: null, trace: traceLogger.toLog() };
  }
  
  const best = allMatches.reduce((max, cur) => cur.confidence > max.confidence ? cur : max);
  
  console.log(`[checkCustomKB] Best match found:`, { 
    question: best.question, 
    confidence: best.confidence, 
    answer: best.answer,
    answerExists: !!best.answer,
    answerLength: best.answer?.length || 0
  });
  
  if (best.confidence < 70) {
    return { answer: null, trace: traceLogger.toLog() };
  }
  
  // CRITICAL FIX: Force answer for high confidence matches
  let finalAnswer = best.answer;
  if (best.confidence >= 90 && !finalAnswer) {
    finalAnswer = "I found a match for your question but the answer wasn't configured properly. Please contact support.";
    console.error(`[checkCustomKB] FORCED FALLBACK: High confidence but no answer`);
  }
  
  traceLogger.setSelected(`Selected: ${best.question} (${best.matches}) from ${companyMatches.includes(best) ? 'Company' : 'Trade'}`);
  
  // NEVER return null answer for matches above threshold
  return { answer: finalAnswer, trace: traceLogger.toLog() };
}

module.exports = checkCustomKB;

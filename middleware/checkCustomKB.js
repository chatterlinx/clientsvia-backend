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
  if (!allMatches.length) return null;
  const best = allMatches.reduce((max, cur) => cur.confidence > max.confidence ? cur : max);
  if (best.confidence < 70) return null;
  traceLogger.setSelected(`Selected: ${best.question} (${best.matches}) from ${companyMatches.includes(best) ? 'Company' : 'Trade'}`);
  return { answer: best.answer, trace: traceLogger.toLog() };
}

module.exports = checkCustomKB;

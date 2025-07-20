// services/qaEngine.js
const CompanyQnA = require('../models/CompanyQnA');
const TradeQnA = require('../models/TradeQnA');
const { vectorSearch } = require('../clients/pinecone'); // if Pinecone is used
const { translateText } = require('../services/translation'); // optional
const { logQASearch } = require('../services/logger'); // optional logging

class QAEngine {
  constructor() {}

  async searchCompanyQAs(companyId, query, options = {}) {
    const regex = new RegExp(query, 'i');
    const matches = await CompanyQnA.find({
      companyId,
      $or: [
        { question: regex },
        { keywords: { $in: [query.toLowerCase()] } }
      ]
    }).lean();

    return matches || [];
  }

  async searchTradeQAs(tradeCategory, query, options = {}) {
    const regex = new RegExp(query, 'i');
    const matches = await TradeQnA.find({
      tradeCategory,
      $or: [
        { question: regex },
        { keywords: { $in: [query.toLowerCase()] } }
      ]
    }).lean();

    return matches || [];
  }

  async semanticSearch(query, context = {}, options = {}) {
    if (!vectorSearch) return [];

    const results = await vectorSearch(query, {
      namespace: context.namespace || 'global',
      topK: options.topK || 5,
      filter: {
        companyId: context.companyId,
        tradeCategory: context.tradeCategory
      }
    });

    return results.matches || [];
  }

  async searchWithFallback(companyId, query, options = {}) {
    const trade = options.tradeCategory || null;
    const context = { companyId, tradeCategory: trade };

    // Step 1: Company-specific Q&A
    const companyResults = await this.searchCompanyQAs(companyId, query);
    if (companyResults.length) {
      return {
        source: 'companyQnA',
        results: companyResults,
        confidence: this.calculateConfidence(companyResults[0], query)
      };
    }

    // Step 2: Trade-level Q&A
    if (trade) {
      const tradeResults = await this.searchTradeQAs(trade, query);
      if (tradeResults.length) {
        return {
          source: 'tradeQnA',
          results: tradeResults,
          confidence: this.calculateConfidence(tradeResults[0], query)
        };
      }
    }

    // Step 3: Semantic fallback (e.g., Pinecone)
    const semanticResults = await this.semanticSearch(query, context);
    if (semanticResults.length) {
      return {
        source: 'semantic',
        results: semanticResults,
        confidence: semanticResults[0].score || 0.6
      };
    }

    return {
      source: 'none',
      results: [],
      confidence: 0
    };
  }

  calculateConfidence(match, query, context = {}) {
    if (!match || !query) return 0;
    const base = match.keywords?.includes(query.toLowerCase()) ? 0.9 : 0.6;
    const lenDiff = Math.abs(match.question.length - query.length);
    const penalty = Math.min(lenDiff / 100, 0.3);
    return +(base - penalty).toFixed(2);
  }

  trackQAPerformance(match, query, ms) {
    logQASearch?.({
      questionAsked: query,
      matched: match?.question || 'none',
      source: match?.source || 'none',
      responseTime: ms
    });
  }
}

module.exports = new QAEngine();

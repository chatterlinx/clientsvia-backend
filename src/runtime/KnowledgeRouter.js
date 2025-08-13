/**
 * 🎯 BLUEPRINT COMPLIANCE: Knowledge Router
 * Implements priority flow + thresholds for AI agent decisions
 * Core component of the production-ready AI Agent Logic system
 * 
 * ENTERPRISE UPGRADE: Now uses EnterpriseKnowledgeRouter for optimal performance
 */

const EnterpriseKnowledgeRouter = require('./EnterpriseKnowledgeRouter');

class KnowledgeRouter {
    constructor() {
        this.enterpriseRouter = EnterpriseKnowledgeRouter;
        console.log('🚀 Knowledge Router initialized with Enterprise backend');
    }

    /**
     * Route a user query through the knowledge priority flow
     * Uses enterprise-grade caching and optimized algorithms
     */
    async route(params) {
        return await this.enterpriseRouter.route(params);
    }

    /**
     * Legacy methods for backward compatibility
     */
    async searchCompanyKB(companyID, text, cfg) {
        return await this.enterpriseRouter.searchCompanyKB(companyID, text, cfg);
    }

    async searchTradeQA(tradeCategories, text) {
        return await this.enterpriseRouter.searchTradeQA(tradeCategories, text);
    }

    /**
     * Get performance analytics
     */
    getAnalytics() {
        return this.enterpriseRouter.getAnalytics();
    }

    /**
     * Health check for monitoring
     */
    async healthCheck() {
        const enterpriseCache = require('../services/enterpriseCacheService');
        return {
            status: 'ok',
            cache: await enterpriseCache.healthCheck(),
            analytics: this.getAnalytics()
        };
    }
}

    /**
     * Route a user query through the knowledge priority flow
     * @param {Object} params - Routing parameters
     * @param {string} params.companyID - Company identifier
     * @param {string} params.text - User input text
     * @param {Object} params.context - Additional context (optional)
     * @returns {Object} Routing result with trace
     */
    async route({ companyID, text, context = {} }) {
        console.log(`🧠 Knowledge routing for company ${companyID}: "${text}"`);
        
        const cfg = await aiLoader.get(companyID);
        const trace = [];

        const trySource = async (source, fn, threshold) => {
            try {
                const r = await fn();
                const step = {
                    source,
                    score: r?.score || 0,
                    matches: r?.matches || 0,
                    selected: false,
                    keywords: r?.keywords || [],
                    timestamp: new Date()
                };
                
                trace.push(step);
                
                if (r && r.score >= threshold) {
                    step.selected = true;
                    console.log(`✅ Source selected: ${source} (score: ${r.score}, threshold: ${threshold})`);
                    return r;
                }
                
                console.log(`❌ Source rejected: ${source} (score: ${r?.score || 0}, threshold: ${threshold})`);
                return null;
            } catch (error) {
                console.error(`Error trying source ${source}:`, error);
                trace.push({
                    source,
                    score: 0,
                    matches: 0,
                    selected: false,
                    error: error.message,
                    timestamp: new Date()
                });
                return null;
            }
        };

        // Execute priority flow as defined in company configuration
        for (const src of cfg.answerPriority) {
            console.log(`🔍 Trying source: ${src}`);
            
            if (src === "companyKB") {
                const hit = await trySource(
                    "companyKB",
                    () => this.searchCompanyKB(companyID, text, cfg),
                    cfg.thresholds.companyKB
                );
                if (hit) return { result: hit, trace };
            }
            
            if (src === "tradeQA") {
                const hit = await trySource(
                    "tradeQA",
                    () => this.searchTradeQA(cfg.tradeCategories, text),
                    cfg.thresholds.tradeQA
                );
                if (hit) return { result: hit, trace };
            }
            
            if (src === "templates") {
                const hit = await trySource(
                    "templates",
                    () => this.matchTemplates(companyID, text, cfg),
                    0.0 // Templates always match if found
                );
                if (hit) return { result: hit, trace };
            }
            
            if (src === "learning") {
                const hit = await trySource(
                    "learning",
                    () => this.searchLearningInsights(companyID, text, cfg),
                    cfg.thresholds.vector || 0.70
                );
                if (hit) return { result: hit, trace };
            }
            
            if (src === "vector") {
                const hit = await trySource(
                    "vector",
                    () => this.vectorSearch(companyID, text),
                    cfg.thresholds.vector
                );
                if (hit) return { result: hit, trace };
            }
            
            if (src === "llmFallback") {
                const hit = await trySource(
                    "llmFallback",
                    () => this.llmClient.answer(cfg.modelConfig, companyID, text, context),
                    cfg.thresholds.llmFallback
                );
                if (hit) return { result: hit, trace };
            }
        }

        // If no source was selected, return a default response
        console.log(`❌ No source selected for company ${companyID}, using default response`);
        
        const defaultResponse = {
            text: "I understand you're looking for information. Let me connect you with someone who can help you better.",
            source: "default",
            score: 0.1,
            confidence: 0.1
        };

        trace.push({
            source: "default",
            score: 0.1,
            matches: 0,
            selected: true,
            timestamp: new Date()
        });

        return { result: defaultResponse, trace };
    }

    /**
     * Search company-specific knowledge base
     * @param {string} companyID - Company identifier
     * @param {string} text - Search text
     * @param {Object} cfg - Company configuration
     * @returns {Object} Search result
     */
    async searchCompanyKB(companyID, text, cfg) {
        console.log(`🏢 Searching company KB for: "${text}"`);
        
        try {
            const Company = require('../../models/Company');
            const company = await Company.findById(companyID).select('companyKB companyKBSettings');
            
            if (!company || !company.companyKB || company.companyKB.length === 0) {
                console.log('❌ No company KB entries found');
                return {
                    text: null,
                    source: 'companyKB',
                    score: 0,
                    matches: 0,
                    keywords: []
                };
            }

            const searchText = text.toLowerCase();
            let bestMatch = null;
            let bestScore = 0;
            let matches = 0;
            let keywords = [];

            // Get settings for threshold overrides
            const kbSettings = company.companyKBSettings || {};
            const fuzzyMatchEnabled = kbSettings.fuzzyMatchEnabled !== false;
            const fuzzyThreshold = kbSettings.fuzzyMatchThreshold || 0.85;

            for (const entry of company.companyKB) {
                // Skip inactive entries
                if (entry.isActive === false) continue;
                
                let score = 0;
                const entryKeywords = [];
                
                // Check question match (exact and partial)
                if (entry.question) {
                    const questionLower = entry.question.toLowerCase();
                    if (questionLower === searchText) {
                        score += 0.95; // Exact match gets highest score
                        entryKeywords.push('exact_question');
                    } else if (questionLower.includes(searchText) || searchText.includes(questionLower)) {
                        score += 0.8;
                        entryKeywords.push('question');
                    }
                }
                
                // Check for keyword matching
                const questionWords = entry.question ? entry.question.toLowerCase().split(/\s+/) : [];
                const searchWords = searchText.split(/\s+/);
                
                let wordMatches = 0;
                for (const searchWord of searchWords) {
                    if (searchWord.length > 2) { // Only match meaningful words
                        for (const questionWord of questionWords) {
                            if (questionWord.includes(searchWord) || searchWord.includes(questionWord)) {
                                wordMatches++;
                                entryKeywords.push(searchWord);
                                break;
                            }
                        }
                    }
                }
                
                if (wordMatches > 0) {
                    score += (wordMatches / Math.max(searchWords.length, questionWords.length)) * 0.7;
                }
                
                // Apply priority boost
                const priorityBoost = entry.priority === 'high' ? 0.1 : entry.priority === 'low' ? -0.05 : 0;
                score += priorityBoost;
                
                // Apply confidence boost from entry settings
                if (entry.confidenceBoost) {
                    score = Math.min(score * entry.confidenceBoost, 1.0);
                }

                if (score > 0) {
                    matches++;
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = entry;
                        keywords = entryKeywords;
                    }
                }
            }

            if (bestMatch) {
                // Track usage
                try {
                    await Company.findOneAndUpdate(
                        { _id: companyID, 'companyKB.id': bestMatch.id },
                        { 
                            $inc: { 'companyKB.$.usageCount': 1 },
                            $set: { 'companyKB.$.lastUsed': new Date() }
                        }
                    );
                } catch (updateError) {
                    console.warn('Failed to update usage count:', updateError);
                }

                return {
                    text: bestMatch.answer,
                    source: 'companyKB',
                    score: Math.min(bestScore, 1.0),
                    matches,
                    keywords,
                    entryId: bestMatch.id,
                    category: bestMatch.category,
                    priority: bestMatch.priority
                };
            }

            return {
                text: null,
                source: 'companyKB',
                score: 0,
                matches: 0,
                keywords: []
            };
            
        } catch (error) {
            console.error('❌ Company KB search error:', error);
            return {
                text: null,
                source: 'companyKB',
                score: 0,
                matches: 0,
                keywords: [],
                error: error.message
            };
        }
    }

    /**
     * Search trade-specific Q&A using Enterprise Trade Categories
     * @param {Array} tradeCategories - Enabled trade categories
     * @param {string} text - Search text
     * @returns {Object} Search result
     */
    async searchTradeQA(tradeCategories, text) {
        console.log(`🔧 Searching enterprise trade QA for categories: ${tradeCategories.join(', ')}`);
        
        try {
            const db = getDB();
            const searchText = text.toLowerCase();
            let bestMatch = null;
            let bestScore = 0;
            let totalMatches = 0;
            let keywords = [];

            // Search through enterprise trade categories
            for (const categoryName of tradeCategories) {
                const category = await db.collection('enterpriseTradeCategories').findOne({
                    name: categoryName,
                    isActive: { $ne: false }
                });
                
                if (!category || !category.qnas) continue;
                
                for (const qa of category.qnas) {
                    if (qa.isActive === false) continue;
                    
                    let score = 0;
                    const entryKeywords = [];
                    
                    // Check if search text contains QA keywords
                    if (qa.keywords && qa.keywords.length > 0) {
                        for (const keyword of qa.keywords) {
                            if (searchText.includes(keyword.toLowerCase())) {
                                score += 0.3;
                                entryKeywords.push(keyword);
                            }
                        }
                    }
                    
                    // Check question match
                    if (qa.question.toLowerCase().includes(searchText)) {
                        score += 0.5;
                        entryKeywords.push('question-match');
                    }
                    
                    // Check answer match (lower weight)
                    if (qa.answer.toLowerCase().includes(searchText)) {
                        score += 0.2;
                        entryKeywords.push('answer-match');
                    }

                    if (score > 0) {
                        totalMatches++;
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = {
                                question: qa.question,
                                answer: qa.answer,
                                keywords: qa.keywords || [],
                                category: categoryName,
                                confidence: qa.confidence || 1
                            };
                            keywords = entryKeywords;
                        }
                    }
                }
            }

            if (bestMatch) {
                return {
                    text: bestMatch.answer,
                    source: 'tradeQA',
                    score: Math.min(bestScore, 1.0),
                    matches: totalMatches,
                    keywords,
                    category: bestMatch.category
                };
            }

            return {
                text: null,
                source: 'tradeQA',
                score: 0,
                matches: 0,
                keywords: []
            };
            
        } catch (error) {
            console.error('Error searching enterprise trade QA:', error);
            return {
                text: null,
                source: 'tradeQA',
                score: 0,
                matches: 0,
                keywords: []
            };
        }
    }

    /**
     * Match response templates
     * @param {string} companyID - Company identifier
     * @param {string} text - Input text
     * @param {Object} cfg - Company configuration
     * @returns {Object} Template match result
     */
    async matchTemplates(companyID, text, cfg) {
        console.log(`📝 Matching templates for: "${text}"`);
        
        const responseCategories = cfg.responseCategories || {};
        const searchText = text.toLowerCase();
        
        // Intent mapping for template selection
        const intentMappings = {
            greeting: ['hello', 'hi', 'good morning', 'good afternoon'],
            hours: ['hours', 'open', 'closed', 'when'],
            hold: ['hold', 'wait', 'moment'],
            transfer: ['transfer', 'speak to', 'manager', 'supervisor'],
            farewell: ['goodbye', 'bye', 'thank you', 'thanks']
        };

        for (const [intent, triggers] of Object.entries(intentMappings)) {
            for (const trigger of triggers) {
                if (searchText.includes(trigger)) {
                    // Find template in response categories
                    const template = this.findTemplate(responseCategories, intent);
                    if (template) {
                        return {
                            text: template,
                            source: 'templates',
                            score: 0.9,
                            matches: 1,
                            keywords: [trigger],
                            intent
                        };
                    }
                }
            }
        }

        return {
            text: null,
            source: 'templates',
            score: 0,
            matches: 0,
            keywords: []
        };
    }

    /**
     * Find template text from response categories
     * @param {Object} responseCategories - Response categories object
     * @param {string} intent - Intent name
     * @returns {string|null} Template text
     */
    findTemplate(responseCategories, intent) {
        const categories = ['core', 'advanced', 'emotional'];
        
        for (const category of categories) {
            if (responseCategories[category]) {
                const templates = responseCategories[category];
                
                // Map intent to template key
                const templateKey = `${intent}-response`;
                if (templates[templateKey]) {
                    return templates[templateKey];
                }
            }
        }
        
        return null;
    }

    /**
     * Search learning insights (placeholder)
     * @param {string} companyID - Company identifier
     * @param {string} text - Search text
     * @param {Object} cfg - Company configuration
     * @returns {Object} Learning search result
     */
    async searchLearningInsights(companyID, text, cfg) {
        console.log(`🧠 Searching learning insights for: "${text}"`);
        
        // Placeholder for learning insights - would contain previously approved answers
        return {
            text: null,
            source: 'learning',
            score: 0,
            matches: 0,
            keywords: []
        };
    }

    /**
     * Vector search (placeholder)
     * @param {string} companyID - Company identifier
     * @param {string} text - Search text
     * @returns {Object} Vector search result
     */
    async vectorSearch(companyID, text) {
        console.log(`🔍 Vector search for: "${text}"`);
        
        // Placeholder for vector search implementation
        return {
            text: null,
            source: 'vector',
            score: 0,
            matches: 0,
            keywords: []
        };
    }
}

module.exports = {
  route: async (params) => {
    const router = new KnowledgeRouter();
    return await router.route(params);
  },
  KnowledgeRouter
};

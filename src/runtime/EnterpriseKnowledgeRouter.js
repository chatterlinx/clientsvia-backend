/**
 * 🚀 ENTERPRISE KNOWLEDGE ROUTER V2
 * High-performance, ML-enhanced routing with caching and analytics
 * Optimized for sub-500ms response times and 90%+ accuracy
 */

const aiLoader = require('../config/aiLoader');
const LLMClient = require('../config/llmClient');
const enterpriseCache = require('../services/enterpriseCacheService');
const { getDB } = require('../../db');

class EnterpriseKnowledgeRouter {
    constructor() {
        this.llmClient = new LLMClient();
        this.analytics = {
            routingHistory: new Map(),
            performanceMetrics: new Map(),
            confidenceDistribution: new Map()
        };
        
        // Performance thresholds
        this.performanceTargets = {
            responseTime: 500, // ms
            accuracy: 0.90,
            cacheHitRate: 0.75
        };
    }

    /**
     * 🎯 MAIN ROUTING METHOD - Enterprise optimized
     * Route user query through knowledge sources with caching and analytics
     */
    async route({ companyID, text, context = {} }) {
        const startTime = Date.now();
        const sessionId = context.sessionId || `session_${Date.now()}`;
        
        console.log(`🧠 Enterprise routing [${sessionId}] for company ${companyID}: "${text}"`);
        
        try {
            // Check cache first
            const cacheKey = enterpriseCache.generateKey('routing', companyID, text);
            const cachedResult = await enterpriseCache.get(cacheKey);
            
            if (cachedResult && this.isCacheValid(cachedResult)) {
                console.log(`⚡ Cache hit - routing completed in ${Date.now() - startTime}ms`);
                this.recordMetrics(companyID, 'cache_hit', Date.now() - startTime, cachedResult.result.score);
                return cachedResult;
            }

            // Load configuration with caching
            const cfg = await this.getConfigurationCached(companyID);
            const trace = [];
            let selectedResult = null;

            // Execute priority flow with enhanced matching
            for (const source of cfg.answerPriority) {
                const sourceResult = await this.trySource(source, companyID, text, cfg, context);
                trace.push(sourceResult.trace);

                if (sourceResult.result && sourceResult.result.score >= cfg.thresholds[source]) {
                    selectedResult = sourceResult.result;
                    selectedResult.source = source;
                    break;
                }
            }

            // Fallback if no source selected
            if (!selectedResult) {
                selectedResult = await this.getFallbackResponse(companyID, text, context);
                trace.push({
                    source: 'fallback',
                    score: 0.1,
                    selected: true,
                    timestamp: new Date()
                });
            }

            const finalResult = {
                result: selectedResult,
                trace,
                sessionId,
                responseTime: Date.now() - startTime,
                cached: false
            };

            // Cache the result
            await enterpriseCache.set(cacheKey, finalResult, 300000); // 5 min cache

            // Record analytics
            this.recordMetrics(companyID, selectedResult.source, finalResult.responseTime, selectedResult.score);
            
            console.log(`✅ Routing completed in ${finalResult.responseTime}ms - Source: ${selectedResult.source}`);
            return finalResult;

        } catch (error) {
            console.error(`❌ Routing error for company ${companyID}:`, error);
            const errorResult = {
                result: await this.getErrorResponse(error),
                trace: [{ source: 'error', error: error.message, timestamp: new Date() }],
                sessionId,
                responseTime: Date.now() - startTime,
                cached: false
            };
            
            this.recordMetrics(companyID, 'error', errorResult.responseTime, 0);
            return errorResult;
        }
    }

    /**
     * 🎯 ENHANCED COMPANY KB SEARCH with ML scoring
     */
    async searchCompanyKB(companyID, text, cfg, context = {}) {
        console.log(`🏢 Enhanced Company KB search for: "${text}"`);
        
        try {
            // Check cache first
            const cacheKey = enterpriseCache.generateKey('companyKB', companyID);
            let companyData = await enterpriseCache.getCompanyKB(companyID);
            
            if (!companyData) {
                const Company = require('../../models/Company');
                const company = await Company.findById(companyID).select('companyKB companyKBSettings');
                
                if (!company || !company.companyKB || company.companyKB.length === 0) {
                    return this.createEmptyResult('companyKB');
                }
                
                companyData = {
                    kb: company.companyKB,
                    settings: company.companyKBSettings || {}
                };
                
                // Cache for future use
                await enterpriseCache.setCompanyKB(companyID, companyData);
            }

            const searchText = text.toLowerCase().trim();
            const results = [];

            // Enhanced matching algorithm
            for (const entry of companyData.kb) {
                if (entry.isActive === false) continue;
                
                const score = this.calculateEnhancedScore(entry, searchText, context);
                
                if (score > 0) {
                    results.push({
                        entry,
                        score,
                        keywords: this.extractMatchingKeywords(entry, searchText)
                    });
                }
            }

            // Sort by score and apply business rules
            results.sort((a, b) => b.score - a.score);
            
            if (results.length > 0) {
                const bestMatch = results[0];
                
                // Track usage asynchronously
                this.trackUsage(companyID, bestMatch.entry.id).catch(console.error);
                
                return {
                    text: bestMatch.entry.answer,
                    source: 'companyKB',
                    score: bestMatch.score,
                    matches: results.length,
                    keywords: bestMatch.keywords,
                    entryId: bestMatch.entry.id,
                    category: bestMatch.entry.category,
                    priority: bestMatch.entry.priority,
                    confidence: Math.min(bestMatch.score, 1.0)
                };
            }

            return this.createEmptyResult('companyKB');

        } catch (error) {
            console.error('❌ Company KB search error:', error);
            return this.createErrorResult('companyKB', error);
        }
    }

    /**
     * 🎯 ENHANCED TRADE QA SEARCH with category optimization
     */
    async searchTradeQA(tradeCategories, text, context = {}) {
        console.log(`🔧 Enhanced Trade QA search for categories: ${tradeCategories.join(', ')}`);
        
        try {
            // Check cache
            let tradeData = await enterpriseCache.getTradeQA(tradeCategories);
            
            if (!tradeData) {
                const db = getDB();
                const categories = await db.collection('enterpriseTradeCategories').find({
                    name: { $in: tradeCategories },
                    isActive: { $ne: false }
                }).toArray();
                
                tradeData = { categories };
                await enterpriseCache.setTradeQA(tradeCategories, tradeData);
            }

            const searchText = text.toLowerCase().trim();
            const results = [];

            for (const category of tradeData.categories) {
                if (!category.qnas) continue;
                
                for (const qa of category.qnas) {
                    if (qa.isActive === false) continue;
                    
                    const score = this.calculateTradeQAScore(qa, searchText, category.name, context);
                    
                    if (score > 0) {
                        results.push({
                            qa,
                            score,
                            category: category.name,
                            keywords: this.extractTradeKeywords(qa, searchText)
                        });
                    }
                }
            }

            results.sort((a, b) => b.score - a.score);
            
            if (results.length > 0) {
                const bestMatch = results[0];
                
                return {
                    text: bestMatch.qa.answer,
                    source: 'tradeQA',
                    score: bestMatch.score,
                    matches: results.length,
                    keywords: bestMatch.keywords,
                    category: bestMatch.category,
                    confidence: bestMatch.qa.confidence || 1
                };
            }

            return this.createEmptyResult('tradeQA');

        } catch (error) {
            console.error('❌ Trade QA search error:', error);
            return this.createErrorResult('tradeQA', error);
        }
    }

    /**
     * 🎯 ENHANCED SCORING ALGORITHM
     * Multi-factor scoring with ML-like features
     */
    calculateEnhancedScore(entry, searchText, context) {
        let score = 0;
        const factors = {
            exactMatch: 0,
            partialMatch: 0,
            keywordMatch: 0,
            semanticMatch: 0,
            contextMatch: 0,
            priorityBoost: 0,
            recencyBoost: 0,
            popularityBoost: 0
        };

        const entryText = `${entry.question} ${entry.answer}`.toLowerCase();
        const searchWords = searchText.split(/\s+/).filter(word => word.length > 2);

        // Exact question match (highest weight)
        if (entry.question && entry.question.toLowerCase() === searchText) {
            factors.exactMatch = 0.95;
        }

        // Partial question match
        else if (entry.question && entry.question.toLowerCase().includes(searchText)) {
            factors.partialMatch = 0.80;
        }

        // Keyword matching with fuzzy logic
        if (entry.tags && entry.tags.length > 0) {
            let keywordMatches = 0;
            for (const tag of entry.tags) {
                const tagLower = tag.toLowerCase();
                if (searchText.includes(tagLower) || tagLower.includes(searchText)) {
                    keywordMatches++;
                }
                
                // Fuzzy matching for close keywords
                for (const word of searchWords) {
                    if (this.fuzzyMatch(word, tagLower, 0.8)) {
                        keywordMatches += 0.5;
                    }
                }
            }
            factors.keywordMatch = Math.min(keywordMatches / Math.max(entry.tags.length, 1) * 0.7, 0.7);
        }

        // Word overlap scoring
        let wordOverlap = 0;
        for (const word of searchWords) {
            if (entryText.includes(word)) {
                wordOverlap++;
            }
        }
        factors.semanticMatch = Math.min(wordOverlap / searchWords.length * 0.6, 0.6);

        // Context-aware scoring
        if (context.category && entry.category === context.category) {
            factors.contextMatch = 0.1;
        }

        // Priority boost
        const priorityWeights = { high: 0.15, normal: 0.05, low: -0.05 };
        factors.priorityBoost = priorityWeights[entry.priority] || 0;

        // Recency boost (newer entries get slight boost)
        if (entry.createdAt) {
            const daysSinceCreated = (Date.now() - new Date(entry.createdAt)) / (1000 * 60 * 60 * 24);
            factors.recencyBoost = Math.max(0, 0.05 - (daysSinceCreated / 365) * 0.05);
        }

        // Popularity boost (frequently used entries)
        if (entry.usageCount && entry.usageCount > 0) {
            factors.popularityBoost = Math.min(Math.log(entry.usageCount) / 10 * 0.05, 0.05);
        }

        // Apply confidence boost from entry
        const baseScore = Object.values(factors).reduce((sum, val) => sum + val, 0);
        score = entry.confidenceBoost ? Math.min(baseScore * entry.confidenceBoost, 1.0) : baseScore;

        return Math.max(0, Math.min(score, 1.0));
    }

    /**
     * Trade QA specific scoring
     */
    calculateTradeQAScore(qa, searchText, categoryName, context) {
        let score = 0;

        // Keyword matching
        if (qa.keywords && qa.keywords.length > 0) {
            let matches = 0;
            for (const keyword of qa.keywords) {
                if (searchText.includes(keyword.toLowerCase())) {
                    matches++;
                }
            }
            score += (matches / qa.keywords.length) * 0.6;
        }

        // Question similarity
        if (qa.question && qa.question.toLowerCase().includes(searchText)) {
            score += 0.7;
        }

        // Category relevance boost
        if (context.preferredCategory === categoryName) {
            score += 0.1;
        }

        return Math.min(score, 1.0);
    }

    /**
     * Fuzzy string matching
     */
    fuzzyMatch(str1, str2, threshold = 0.8) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length >= threshold;
    }

    levenshteinDistance(str1, str2) {
        const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + cost
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Enhanced configuration loading with caching
     */
    async getConfigurationCached(companyID) {
        let config = await enterpriseCache.getAIConfig(companyID);
        
        if (!config) {
            config = await aiLoader.get(companyID);
            await enterpriseCache.setAIConfig(companyID, config);
        }
        
        return config;
    }

    /**
     * Try a specific knowledge source
     */
    async trySource(source, companyID, text, cfg, context) {
        const startTime = Date.now();
        
        try {
            let result = null;
            
            switch (source) {
                case 'companyKB':
                    result = await this.searchCompanyKB(companyID, text, cfg, context);
                    break;
                case 'tradeQA':
                    result = await this.searchTradeQA(cfg.tradeCategories, text, context);
                    break;
                case 'templates':
                    result = await this.matchTemplates(companyID, text, cfg);
                    break;
                case 'learning':
                    result = await this.searchLearningInsights(companyID, text, cfg);
                    break;
                case 'vector':
                    result = await this.vectorSearch(companyID, text);
                    break;
                case 'llmFallback':
                    result = await this.llmClient.answer(cfg.modelConfig, companyID, text, context);
                    break;
                default:
                    result = this.createEmptyResult(source);
            }

            const trace = {
                source,
                score: result?.score || 0,
                matches: result?.matches || 0,
                selected: result && result.score >= (cfg.thresholds[source] || 0),
                keywords: result?.keywords || [],
                responseTime: Date.now() - startTime,
                timestamp: new Date()
            };

            return { result, trace };

        } catch (error) {
            console.error(`Error trying source ${source}:`, error);
            return {
                result: this.createErrorResult(source, error),
                trace: {
                    source,
                    score: 0,
                    matches: 0,
                    selected: false,
                    error: error.message,
                    responseTime: Date.now() - startTime,
                    timestamp: new Date()
                }
            };
        }
    }

    // === UTILITY METHODS ===

    createEmptyResult(source) {
        return {
            text: null,
            source,
            score: 0,
            matches: 0,
            keywords: []
        };
    }

    createErrorResult(source, error) {
        return {
            text: null,
            source,
            score: 0,
            matches: 0,
            keywords: [],
            error: error.message
        };
    }

    async getFallbackResponse(companyID, text, context) {
        return {
            text: "I understand you're looking for information. Let me connect you with someone who can help you better.",
            source: 'fallback',
            score: 0.1,
            confidence: 0.1
        };
    }

    async getErrorResponse(error) {
        return {
            text: "I'm experiencing a technical issue. Please hold while I connect you to someone who can assist you.",
            source: 'error',
            score: 0.05,
            confidence: 0.05,
            error: error.message
        };
    }

    isCacheValid(cachedResult) {
        // Cache is valid if it's less than 5 minutes old and has good confidence
        const age = Date.now() - new Date(cachedResult.timestamp || 0);
        return age < 300000 && (cachedResult.result?.score || 0) > 0.5;
    }

    async trackUsage(companyID, entryId) {
        try {
            const Company = require('../../models/Company');
            await Company.findOneAndUpdate(
                { _id: companyID, 'companyKB.id': entryId },
                { 
                    $inc: { 'companyKB.$.usageCount': 1 },
                    $set: { 'companyKB.$.lastUsed': new Date() }
                }
            );
        } catch (error) {
            console.warn('Failed to track usage:', error.message);
        }
    }

    extractMatchingKeywords(entry, searchText) {
        const keywords = [];
        if (entry.tags) {
            for (const tag of entry.tags) {
                if (searchText.includes(tag.toLowerCase())) {
                    keywords.push(tag);
                }
            }
        }
        return keywords;
    }

    extractTradeKeywords(qa, searchText) {
        const keywords = [];
        if (qa.keywords) {
            for (const keyword of qa.keywords) {
                if (searchText.includes(keyword.toLowerCase())) {
                    keywords.push(keyword);
                }
            }
        }
        return keywords;
    }

    recordMetrics(companyID, source, responseTime, score) {
        const key = `${companyID}:${source}`;
        const existing = this.analytics.performanceMetrics.get(key) || { 
            count: 0, 
            totalTime: 0, 
            totalScore: 0,
            successes: 0 
        };
        
        existing.count++;
        existing.totalTime += responseTime;
        existing.totalScore += score;
        if (score > 0.5) existing.successes++;
        
        this.analytics.performanceMetrics.set(key, existing);
    }

    getAnalytics() {
        const metrics = {};
        
        for (const [key, data] of this.analytics.performanceMetrics.entries()) {
            metrics[key] = {
                averageResponseTime: data.totalTime / data.count,
                averageScore: data.totalScore / data.count,
                successRate: data.successes / data.count,
                totalRequests: data.count
            };
        }
        
        return {
            performanceMetrics: metrics,
            cacheMetrics: enterpriseCache.getMetrics()
        };
    }

    // Placeholder methods for features to be implemented
    async matchTemplates(companyID, text, cfg) { return this.createEmptyResult('templates'); }
    async searchLearningInsights(companyID, text, cfg) { return this.createEmptyResult('learning'); }
    async vectorSearch(companyID, text) { return this.createEmptyResult('vector'); }
}

module.exports = new EnterpriseKnowledgeRouter();

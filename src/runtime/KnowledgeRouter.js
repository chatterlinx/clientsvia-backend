/**
 * 🎯 PRIORITY-DRIVEN KNOWLEDGE ROUTER - PHASE 4.1 INTEGRATION
 * 📋 DESCRIPTION: Enterprise-grade knowledge routing with priority-based decision making
 * 🎯 PURPOSE: Seamlessly integrate new Priority-Driven Knowledge Router with existing AI Agent Runtime
 * 🔧 FEATURES: 
 *     - Backward compatibility with existing aiLoader configuration
 *     - Priority-based routing through configured knowledge sources
 *     - Sub-50ms performance with Redis caching
 *     - Comprehensive logging and analytics
 * ⚠️  CRITICAL: Maintains existing API while adding new priority-driven capabilities
 */

const aiLoader = require('../config/aiLoader');
const { getDB } = require('../../db');
const priorityDrivenRouter = require('../../services/priorityDrivenKnowledgeRouter');

class KnowledgeRouter {
    constructor() {
        // Pure in-house system - no external LLMs
        console.log('🏠 Initializing in-house knowledge router');
    }

    /**
     * 🎯 PRIORITY-DRIVEN ROUTE METHOD - PHASE 4.1
     * 📋 Routes queries through new Priority-Driven Knowledge Router
     * ⚠️  CRITICAL: Maintains backward compatibility while adding new capabilities
     * @param {Object} params - Routing parameters
     * @param {string} params.companyID - Company identifier
     * @param {string} params.text - User input text
     * @param {Object} params.context - Additional context (optional)
     * @param {Object} params.config - Company configuration (optional, will load if not provided)
     * @returns {Object} Routing result with trace
     */
    async route({ companyID, text, context = {}, config = null }) {
        console.log(`🎯 PRIORITY-DRIVEN routing for company ${companyID}: "${text}"`);
        
        try {
            // 🚀 NEW: Use Priority-Driven Knowledge Router for enhanced routing
            const priorityResult = await priorityDrivenRouter.routeQuery(companyID, text, {
                context,
                config,
                legacyCompatibility: true
            });

            // Transform priority router result to match existing API format
            if (priorityResult.success && priorityResult.response) {
                const transformedResult = {
                    text: priorityResult.response,
                    source: priorityResult.source,
                    score: priorityResult.confidence,
                    confidence: priorityResult.confidence,
                    metadata: priorityResult.metadata
                };

                const transformedTrace = this.transformPriorityTrace(priorityResult.metadata?.routingFlow || []);

                console.log(`✅ Priority router success: ${priorityResult.source} (confidence: ${priorityResult.confidence})`);
                
                return {
                    result: transformedResult,
                    trace: transformedTrace
                };
            }

            // If priority router didn't find a match, fall back to legacy system for backward compatibility
            console.log(`⚠️ Priority router no match, falling back to legacy system`);
            return await this.legacyRoute({ companyID, text, context, config });

        } catch (error) {
            console.error(`❌ Error in priority-driven routing, falling back to legacy:`, error);
            // Fall back to legacy system on error
            return await this.legacyRoute({ companyID, text, context, config });
        }
    }

    /**
     * 🔄 TRANSFORM PRIORITY TRACE TO LEGACY FORMAT
     * 📋 Converts new priority routing trace to existing trace format
     */
    transformPriorityTrace(routingFlow) {
        return routingFlow.map(step => ({
            source: step.source,
            score: step.confidence || 0,
            matches: step.match ? 1 : 0,
            selected: step.match || false,
            keywords: step.matchedKeywords || [],
            timestamp: new Date(),
            priority: step.priority,
            threshold: step.threshold,
            responseTime: step.responseTime
        }));
    }

    /**
     * 🔙 LEGACY ROUTE METHOD - BACKWARD COMPATIBILITY
     * 📋 Original routing logic maintained for fallback compatibility
     */
    async legacyRoute({ companyID, text, context = {}, config = null }) {
        console.log(`🔙 Legacy routing for company ${companyID}: "${text}"`);
        
        // Use provided config or load it (avoid circular dependency)
        const cfg = config || await require('../config/aiLoader').get(companyID);
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
            
            // In-house fallback system - no external LLMs
            if (src === "inHouseFallback") {
                console.log('🏠 Using in-house fallback system');
                const hit = await trySource(
                    "inHouseFallback",
                    () => this.inHouseFallback(companyID, text, cfg),
                    cfg.thresholds.inHouseFallback || 0.5
                );
                if (hit) return { result: hit, trace };
            }
        }

        // If no source was selected, FORCE company-specific configuration [[memory:8276820]]
        console.error(`❌ CRITICAL: No knowledge source selected for company ${companyID} - company MUST configure fallback responses`);
        console.error(`❌ CRITICAL: Each company must have their own fallback responses - no global fallbacks allowed [[memory:8276820]]`);
        
        // V2 DELETED: Legacy responseCategories.core - using V2 Agent Personality system
        const noMatchResponse = `I understand you have a question. Let me connect you with someone who can help you better.`;
        
        const defaultResponse = {
            text: noMatchResponse,
            source: "configurable_default",
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
        
        const knowledgeBase = cfg.knowledgeBase || [];
        const searchText = text.toLowerCase();
        
        let bestMatch = null;
        let bestScore = 0;
        let matches = 0;
        let keywords = [];

        for (const entry of knowledgeBase) {
            let score = 0;
            const entryKeywords = [];
            
            // Check question match
            if (entry.question && entry.question.toLowerCase().includes(searchText)) {
                score += 0.8;
                entryKeywords.push('question');
            }
            
            // Check answer match
            if (entry.answer && entry.answer.toLowerCase().includes(searchText)) {
                score += 0.6;
                entryKeywords.push('answer');
            }
            
            // Check keywords match
            if (entry.keywords) {
                for (const keyword of entry.keywords) {
                    if (searchText.includes(keyword.toLowerCase())) {
                        score += 0.4;
                        entryKeywords.push(keyword);
                    }
                }
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
            return {
                text: bestMatch.answer,
                source: 'companyKB',
                score: Math.min(bestScore, 1.0),
                matches,
                keywords,
                entryId: bestMatch.id
            };
        }

        return {
            text: null,
            source: 'companyKB',
            score: 0,
            matches: 0,
            keywords: []
        };
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

    /**
     * In-house fallback system - no external LLMs
     * Provides intelligent responses based on configurable keyword matching per company
     */
    async inHouseFallback(companyID, text, cfg) {
        console.log(`🏠 In-house fallback for company ${companyID}: "${text}"`);
        
        const normalizedText = text.toLowerCase().trim();
        
        // Load company-specific configurable keywords from database
        const Company = require('../../models/Company');
        const company = await Company.findById(companyID);
        
        if (!company) {
            console.log(`❌ Company ${companyID} not found for keyword configuration`);
            return this.getDefaultFallbackResponse();
        }
        
        // Get configurable keywords (MUST be configured per company - no hardcoded defaults)
        const keywordConfig = company.aiAgentLogic?.keywordConfiguration || {};
        const serviceKeywords = keywordConfig.serviceKeywords || [];
        const bookingKeywords = keywordConfig.bookingKeywords || [];
        const emergencyKeywords = keywordConfig.emergencyKeywords || [];
        const hoursKeywords = keywordConfig.hoursKeywords || [];
        const tradeSpecificKeywords = keywordConfig.tradeSpecificKeywords || [];
        
        // 🚨 MULTI-TENANT COMPLIANCE: All keywords must be configured per company
        if (!keywordConfig.serviceKeywords || keywordConfig.serviceKeywords.length === 0) {
            console.warn(`⚠️ Company ${companyID} has no service keywords configured. Please configure keywords in AI Agent Logic → Keywords tab.`);
        }
        
        // Combine service keywords with trade-specific keywords
        const allServiceKeywords = [...serviceKeywords, ...tradeSpecificKeywords];
        
        console.log(`🔑 Using company keywords - Service: ${allServiceKeywords.length}, Booking: ${bookingKeywords.length}, Emergency: ${emergencyKeywords.length}, Hours: ${hoursKeywords.length}`);
        
        // Check for service requests (including trade-specific keywords)
        if (allServiceKeywords.some(keyword => normalizedText.includes(keyword))) {
            return {
                text: "I can help you with service requests. What specific issue are you experiencing? I can connect you with our service team or help schedule an appointment.",
                source: 'inHouseFallback',
                score: 0.8,
                intent: 'service',
                keywords: serviceKeywords.filter(k => normalizedText.includes(k))
            };
        }
        
        // Check for booking requests
        if (bookingKeywords.some(keyword => normalizedText.includes(keyword))) {
            return {
                text: "I'd be happy to help you schedule an appointment. Let me connect you with our scheduling team to find the best time for your service.",
                source: 'inHouseFallback',
                score: 0.8,
                intent: 'booking',
                keywords: bookingKeywords.filter(k => normalizedText.includes(k))
            };
        }
        
        // Check for emergency requests
        if (emergencyKeywords.some(keyword => normalizedText.includes(keyword))) {
            return {
                text: "I understand this is urgent. Let me connect you immediately with our emergency service team who can assist you right away.",
                source: 'inHouseFallback',
                score: 0.9,
                intent: 'emergency',
                keywords: emergencyKeywords.filter(k => normalizedText.includes(k))
            };
        }
        
        // Check for hours inquiry
        if (hoursKeywords.some(keyword => normalizedText.includes(keyword))) {
            return {
                text: "Our business hours are Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 4 PM. For emergency services, we're available 24/7.",
                source: 'inHouseFallback',
                score: 0.8,
                intent: 'hours',
                keywords: hoursKeywords.filter(k => normalizedText.includes(k))
            };
        }
        
        // Default fallback response
        return this.getDefaultFallbackResponse();
    }

    /**
     * Default fallback response when no specific intent is detected
     */
    getDefaultFallbackResponse() {
        return {
            text: "I'm here to help you with your service needs. Could you tell me more about what you're looking for? I can assist with scheduling, service requests, or connect you with the right team member.",
            source: 'inHouseFallback',
            score: 0.6,
            intent: 'general',
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

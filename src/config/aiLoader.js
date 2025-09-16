/**
 * 🎯 BLUEPRINT COMPLIANCE: AI Configuration Loader
 * Loads all AI agent configurations by companyID with Redis cache
 * Part of the production-ready AI Agent Logic system
 */

const Company = require('../../models/Company');

class AIConfigLoader {
    constructor() {
        this.cache = new Map(); // In-memory cache for coffee shop mode (Redis would be ideal)
        this.cacheTimeout = 60000; // 60 seconds cache
    }

    /**
     * Get complete AI configuration for a company
     * @param {string} companyID - The company identifier
     * @returns {Object} Complete AI configuration
     */
    async get(companyID) {
        const cacheKey = `ai_config_${companyID}`;
        
        // Check cache first
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                console.log(`🚀 AI Config cache hit for company: ${companyID}`);
                return cached.data;
            }
        }

        console.log(`🔍 Loading AI configuration for company: ${companyID}`);
        
        try {
            const company = await Company.findById(companyID);
            if (!company) {
                throw new Error(`Company not found: ${companyID}`);
            }

            const aiLogic = company.aiAgentLogic || {};
            
            // Build comprehensive configuration per Blueprint
            const config = {
                companyID,
                companyName: company.companyName || company.name,
                
                // Answer Priority Flow
                answerPriority: this.getAnswerPriority(aiLogic),
                
                // Confidence Thresholds
                thresholds: {
                    companyKB: 0.80,
                    tradeQA: 0.75,
                    vector: 0.70,
                    llmFallback: 0.60,
                    ...aiLogic.thresholds
                },
                
                // Memory Configuration
                memory: {
                    mode: aiLogic.memorySettings?.memoryMode || "conversational",
                    retentionMinutes: aiLogic.memorySettings?.contextRetention || 30
                },
                
                // Escalation Rules
                escalation: {
                    onNoMatch: aiLogic.fallbackBehavior?.escalateOnNoMatch !== undefined ? aiLogic.fallbackBehavior.escalateOnNoMatch : true,
                    rejectLowConfidence: aiLogic.fallbackBehavior?.rejectLowConfidence !== undefined ? aiLogic.fallbackBehavior.rejectLowConfidence : true,
                    strategy: "ask-confirm",
                    message: aiLogic.fallbackBehavior?.message || "I want to make sure I give you accurate information. Let me connect you with a specialist who can help."
                },
                
                // Conversation Management
                rePromptAfterTurns: aiLogic.rePromptAfterTurns || 3,
                maxPromptsPerCall: aiLogic.maxPromptsPerCall || 2,
                
                // LLM Configuration
                modelConfig: {
                    primary: "gemini-pro",
                    fallback: "gpt-4o-mini",
                    allowed: ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"],
                    ...aiLogic.modelConfig
                },
                
                // Trade Categories
                tradeCategories: company.tradeCategories || ["HVAC Residential", "Plumbing Residential"],
                
                // Agent Personality
                agentPersonality: {
                    voiceTone: "friendly",
                    speechPace: "moderate",
                    ...aiLogic.agentPersonality
                },
                
                // Behavior Controls
                behaviorControls: {
                    allowBargeIn: false,
                    acknowledgeEmotion: false,
                    useEmails: false,
                    silencePolicy: {
                        maxSilences: 2,
                        warnBeforeHangup: true
                    },
                    hangupScript: "I may have lost you. I'll send a text and follow up.",
                    ...aiLogic.behaviorControls
                },
                
                // Response Categories
                responseCategories: aiLogic.responseCategories || {},
                
                // Knowledge Base
                knowledgeBase: aiLogic.knowledgeBase || [],
                
                // Booking Flow
                bookingFlow: aiLogic.bookingFlow || {
                    steps: [
                        { prompt: "What's your full name?", field: "fullName", required: true },
                        { prompt: "What's the service address?", field: "address", required: true },
                        { prompt: "What service do you need?", field: "serviceType", required: true },
                        { prompt: "Best callback number?", field: "phone", required: true },
                        { prompt: "Morning or afternoon?", field: "timePref", required: false }
                    ]
                },
                
                // Metadata
                version: aiLogic.version || 1,
                lastUpdated: aiLogic.lastUpdated || new Date()
            };

            // Cache the configuration
            this.cache.set(cacheKey, {
                data: config,
                timestamp: Date.now()
            });

            console.log(`✅ AI configuration loaded and cached for company: ${companyID}`);
            return config;

        } catch (error) {
            console.error(`❌ Failed to load AI configuration for company ${companyID}:`, error);
            throw error;
        }
    }

    /**
     * Get answer priority array from configuration
     * @param {Object} aiLogic - AI logic configuration
     * @returns {Array} Priority order array
     */
    getAnswerPriority(aiLogic) {
        if (aiLogic.answerPriorityFlow && Array.isArray(aiLogic.answerPriorityFlow)) {
            // If we have detailed flow items, extract the IDs in priority order
            return aiLogic.answerPriorityFlow
                .sort((a, b) => (a.priority || 999) - (b.priority || 999))
                .filter(item => item.active !== false)
                .map(item => item.id);
        }
        
        // Default priority order per Blueprint
        return ["companyKB", "tradeQA", "templates", "learning", "llmFallback"];
    }

    /**
     * Invalidate cache for a specific company
     * @param {string} companyID - The company identifier
     */
    invalidate(companyID) {
        const cacheKey = `ai_config_${companyID}`;
        this.cache.delete(cacheKey);
        console.log(`🗑️ Cache invalidated for company: ${companyID}`);
    }

    /**
     * Clear all cache
     */
    clearCache() {
        this.cache.clear();
        console.log('🗑️ All AI configuration cache cleared');
    }
}

// Export singleton instance
module.exports = new AIConfigLoader();

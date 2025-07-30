/**
 * Central Agent Message Processing Pipeline
 * This service connects the beautiful UI settings with actual agent behavior
 * Provides complete admin control over agent operations
 */

const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const Company = require('../models/Company'); // Use Mongoose model instead of raw MongoDB
const { answerQuestion } = require('./agent');
// Local LLM imports removed - cloud-only operation

class AgentMessageProcessor {
    constructor() {
        this.db = null;
        this.responseCache = new Map();
        this.conversationState = new Map();
    }

    async initialize() {
        this.db = getDB();
        console.log('🧠 Agent Message Processor initialized');
    }

    /**
     * Main message processing function that respects ALL UI settings
     */
    async processMessage(companyId, message, options = {}) {
        const startTime = Date.now();
        const traceLog = [];
        
        try {
            traceLog.push(`[${new Date().toISOString()}] Starting message processing for company ${companyId}`);
            traceLog.push(`[${new Date().toISOString()}] Message: "${message.substring(0, 100)}..."`);

            // STEP 1: Load company settings from UI
            const companySettings = await this.loadCompanySettings(companyId);
            traceLog.push(`[${new Date().toISOString()}] Loaded company settings: ${JSON.stringify(companySettings, null, 2)}`);

            // STEP 2: Apply conversation memory mode
            const conversationHistory = await this.getConversationHistory(companyId, options.callSid, companySettings.memoryMode);
            traceLog.push(`[${new Date().toISOString()}] Conversation history loaded: ${conversationHistory.length} messages`);

            // STEP 3: Process through selected AI models with fallback
            const response = await this.generateResponse(companyId, message, companySettings, conversationHistory, traceLog);

            // STEP 4: Apply confidence threshold and escalation logic
            const finalResponse = await this.applyConfidenceThreshold(response, companySettings, traceLog);

            // STEP 5: Save conversation state if memory is enabled
            if (companySettings.memoryMode === 'conversation') {
                await this.saveConversationState(companyId, options.callSid, message, finalResponse.text);
            }

            // STEP 6: Track performance metrics
            await this.trackPerformance(companyId, message, finalResponse, startTime, traceLog);

            const processingTime = Date.now() - startTime;
            traceLog.push(`[${new Date().toISOString()}] Processing completed in ${processingTime}ms`);

            return {
                ...finalResponse,
                processingTime,
                traceLog,
                settings: companySettings
            };

        } catch (error) {
            traceLog.push(`[${new Date().toISOString()}] ERROR: ${error.message}`);
            console.error('❌ Agent Message Processing Error:', error);
            
            return {
                text: "I apologize, but I'm experiencing technical difficulties. Please hold while I connect you to someone who can help.",
                confidence: 0,
                responseMethod: 'error-fallback',
                escalate: true,
                traceLog,
                error: error.message
            };
        }
    }

    /**
     * Load all company settings from the database (respects UI configuration)
     */
    async loadCompanySettings(companyId) {
        try {
            console.log('🔍 Loading company settings for:', companyId);
            console.log('🔍 ObjectId.isValid:', ObjectId.isValid(companyId));
            
            // Use Mongoose model instead of raw MongoDB
            const company = await Company.findById(companyId).select({
                agentIntelligenceSettings: 1,
                aiSettings: 1,
                agentSetup: 1,
                tradeCategories: 1,
                personalityResponses: 1,
                bookingFlow: 1,
                companyName: 1
            });

            console.log('🔍 Company found:', company ? 'Yes' : 'No');
            if (company) {
                console.log('🔍 Company name:', company.companyName);
                console.log('🔍 agentIntelligenceSettings:', company.agentIntelligenceSettings ? 'Present' : 'Missing');
            }

            if (!company) {
                console.log('❌ Company not found in database');
                throw new Error(`Company ${companyId} not found`);
            }

            // Merge settings with defaults - RESPECTING ALL UI CONTROLS
            const settings = {
                // Core AI Configuration
                tradeCategories: company.agentIntelligenceSettings?.tradeCategories || [],
                useLLM: company.agentIntelligenceSettings?.useLLM !== false, // Default true
                primaryLLM: company.agentIntelligenceSettings?.primaryLLM || 'gemini-pro',
                fallbackLLM: company.agentIntelligenceSettings?.fallbackLLM || 'gemini-pro',
                allowedLLMs: company.agentIntelligenceSettings?.allowedLLMs || ['gemini-pro'],
                memoryMode: company.agentIntelligenceSettings?.memoryMode || 'conversation',

                // Intelligence Thresholds
                fallbackThreshold: company.agentIntelligenceSettings?.fallbackThreshold || 0.5,
                escalationMode: company.agentIntelligenceSettings?.escalationMode || 'ask',
                rePromptAfterTurns: company.agentIntelligenceSettings?.rePromptAfterTurns || 2,
                maxPromptsPerCall: company.agentIntelligenceSettings?.maxPromptsPerCall || 3,

                // Advanced Features
                semanticSearchEnabled: company.agentIntelligenceSettings?.semanticSearchEnabled || false,
                confidenceScoring: company.agentIntelligenceSettings?.confidenceScoring || true,
                autoLearningQueue: company.agentIntelligenceSettings?.autoLearningQueue || false,

                // Legacy settings for compatibility
                fuzzyMatchThreshold: company.aiSettings?.fuzzyMatchThreshold || 0.15,
                llmFallbackEnabled: company.aiSettings?.llmFallbackEnabled !== false,
                customEscalationMessage: company.aiSettings?.customEscalationMessage,

                // Company-specific data
                mainAgentScript: company.agentSetup?.mainAgentScript || '',
                categoryQAs: company.agentSetup?.categoryQAs || '',
                companyName: company.companyName || 'Service Company',
                placeholders: company.agentSetup?.placeholders || [],
                bookingFlow: company.bookingFlow || []
            };

            console.log('✅ Company settings loaded:', settings);
            return settings;

        } catch (error) {
            console.error('❌ Error loading company settings:', error);
            // Return safe defaults
            return {
                tradeCategories: [],
                useLLM: true,
                primaryLLM: 'gemini-pro',
                fallbackLLM: 'gemini-pro',
                allowedLLMs: ['gemini-pro'],
                memoryMode: 'conversation',
                fallbackThreshold: 0.5,
                escalationMode: 'ask',
                rePromptAfterTurns: 2,
                maxPromptsPerCall: 3,
                semanticSearchEnabled: false,
                confidenceScoring: true,
                autoLearningQueue: false,
                fuzzyMatchThreshold: 0.15,
                llmFallbackEnabled: true,
                mainAgentScript: '',
                categoryQAs: '',
                companyName: 'Service Company',
                placeholders: [],
                bookingFlow: []
            };
        }
    }

    /**
     * Get conversation history based on memory mode setting
     */
    async getConversationHistory(companyId, callSid, memoryMode) {
        if (memoryMode === 'short' || !callSid) {
            return [];
        }

        try {
            // Try to get from cache first
            const cacheKey = `${companyId}:${callSid}`;
            if (this.conversationState.has(cacheKey)) {
                return this.conversationState.get(cacheKey);
            }

            // Load from database if available
            const conversation = await this.db.collection('conversations').findOne({
                companyId: new ObjectId(companyId),
                callSid: callSid
            });

            const history = conversation?.messages || [];
            
            // Cache for quick access
            this.conversationState.set(cacheKey, history);
            
            return history;
        } catch (error) {
            console.error('❌ Error loading conversation history:', error);
            return [];
        }
    }

    /**
     * Generate response using configured LLM models with proper fallback
     */
    async generateResponse(companyId, message, settings, conversationHistory, traceLog) {
        traceLog.push(`[${new Date().toISOString()}] Attempting primary LLM: ${settings.primaryLLM}`);

        try {
            // Try primary LLM first
            const primaryResponse = await this.tryLLM(settings.primaryLLM, companyId, message, settings, conversationHistory, traceLog);
            
            if (primaryResponse && primaryResponse.confidence >= settings.fallbackThreshold) {
                traceLog.push(`[${new Date().toISOString()}] Primary LLM successful, confidence: ${primaryResponse.confidence}`);
                return primaryResponse;
            }

            traceLog.push(`[${new Date().toISOString()}] Primary LLM below threshold (${primaryResponse?.confidence || 0} < ${settings.fallbackThreshold}), trying fallback`);

            // Try fallback LLM
            const fallbackResponse = await this.tryLLM(settings.fallbackLLM, companyId, message, settings, conversationHistory, traceLog);
            
            if (fallbackResponse) {
                traceLog.push(`[${new Date().toISOString()}] Fallback LLM response, confidence: ${fallbackResponse.confidence}`);
                return fallbackResponse;
            }

            traceLog.push(`[${new Date().toISOString()}] All LLMs failed, using Q&A fallback`);

            // Final fallback to basic Q&A
            return await this.basicQAFallback(companyId, message, settings, traceLog);

        } catch (error) {
            traceLog.push(`[${new Date().toISOString()}] Response generation error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Try a specific LLM model
     */
    async tryLLM(modelName, companyId, message, settings, conversationHistory, traceLog) {
        try {
            traceLog.push(`[${new Date().toISOString()}] Trying ${modelName}...`);

            switch (modelName) {                case 'gemini-pro':
                    return await this.tryGemini(companyId, message, settings, conversationHistory, traceLog);
                
                case 'openai-gpt4':
                    return await this.tryOpenAI(companyId, message, settings, conversationHistory, traceLog);
                
                case 'claude-3':
                    return await this.tryClaude(companyId, message, settings, conversationHistory, traceLog);
                
                default:
                    traceLog.push(`[${new Date().toISOString()}] Unknown model: ${modelName}`);
                    return null;
            }
        } catch (error) {
            traceLog.push(`[${new Date().toISOString()}] ${modelName} failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Try local LLM - DISABLED (cloud-only operation)
     */
    async tryLocalLLM(modelName, companyId, message, settings, conversationHistory, traceLog) {
        // Local LLM disabled - return null to skip this method
        traceLog.push(`[${new Date().toISOString()}] Local LLM disabled (cloud-only operation) - skipping ${modelName}`);
        return null;
    }

    /**
     * Try Gemini Pro
     */
    async tryGemini(companyId, message, settings, conversationHistory, traceLog) {
        try {
            // Use existing agent service for Gemini calls
            const response = await answerQuestion(
                companyId,
                message,
                'concise',
                conversationHistory,
                settings.mainAgentScript,
                'friendly',
                settings.companyName,
                settings.categoryQAs
            );

            return {
                text: response.text,
                confidence: response.confidence || 0.7,
                responseMethod: 'gemini-pro',
                source: 'cloud-llm',
                debugInfo: response.debugInfo
            };
        } catch (error) {
            traceLog.push(`[${new Date().toISOString()}] Gemini error: ${error.message}`);
            return null;
        }
    }

    /**
     * Try OpenAI GPT-4 (placeholder - implement when needed)
     */
    async tryOpenAI(companyId, message, settings, conversationHistory, traceLog) {
        traceLog.push(`[${new Date().toISOString()}] OpenAI GPT-4 not implemented yet`);
        return null;
    }

    /**
     * Try Claude-3 (placeholder - implement when needed)
     */
    async tryClaude(companyId, message, settings, conversationHistory, traceLog) {
        traceLog.push(`[${new Date().toISOString()}] Claude-3 not implemented yet`);
        return null;
    }

    /**
     * Basic Q&A fallback when all LLMs fail
     */
    async basicQAFallback(companyId, message, settings, traceLog) {
        try {
            traceLog.push(`[${new Date().toISOString()}] Using basic Q&A fallback`);

            // Use existing agent service with LLM disabled
            const response = await answerQuestion(
                companyId,
                message,
                'concise',
                [],
                settings.mainAgentScript,
                'friendly',
                settings.companyName,
                settings.categoryQAs
            );

            return {
                text: response.text || "I'm not sure about that. Let me connect you with someone who can help.",
                confidence: response.confidence || 0.3,
                responseMethod: 'qa-fallback',
                source: 'knowledge-base'
            };
        } catch (error) {
            traceLog.push(`[${new Date().toISOString()}] Q&A fallback error: ${error.message}`);
            return {
                text: "I apologize, but I'm having technical difficulties. Please hold while I connect you to someone who can help.",
                confidence: 0,
                responseMethod: 'emergency-fallback',
                source: 'system'
            };
        }
    }

    /**
     * Apply confidence threshold and escalation logic from UI settings
     */
    async applyConfidenceThreshold(response, settings, traceLog) {
        const { confidence = 0 } = response;
        const { fallbackThreshold, escalationMode, customEscalationMessage } = settings;

        traceLog.push(`[${new Date().toISOString()}] Applying confidence threshold: ${confidence} vs ${fallbackThreshold}`);

        if (confidence < fallbackThreshold) {
            traceLog.push(`[${new Date().toISOString()}] Below threshold, escalation mode: ${escalationMode}`);

            if (escalationMode === 'auto') {
                // Auto escalate
                return {
                    ...response,
                    text: customEscalationMessage || "Let me connect you with one of our specialists who can better help you with that.",
                    escalate: true,
                    confidence: 0,
                    responseMethod: 'auto-escalation'
                };
            } else {
                // Ask before escalating
                return {
                    ...response,
                    text: customEscalationMessage || "I want to make sure I give you the best help possible. Would you like me to connect you with one of our specialists?",
                    escalate: 'ask',
                    confidence: confidence,
                    responseMethod: 'ask-escalation'
                };
            }
        }

        // Confidence is above threshold
        return response;
    }

    /**
     * Save conversation state for memory mode
     */
    async saveConversationState(companyId, callSid, userMessage, agentResponse) {
        if (!callSid) return;

        try {
            const cacheKey = `${companyId}:${callSid}`;
            
            // Update cache
            let history = this.conversationState.get(cacheKey) || [];
            history.push(
                { role: 'user', content: userMessage, timestamp: new Date() },
                { role: 'agent', content: agentResponse, timestamp: new Date() }
            );
            
            // Keep only last 20 messages to prevent memory bloat
            if (history.length > 20) {
                history = history.slice(-20);
            }
            
            this.conversationState.set(cacheKey, history);

            // Save to database
            await this.db.collection('conversations').updateOne(
                { companyId: new ObjectId(companyId), callSid },
                { 
                    $set: { 
                        messages: history,
                        lastUpdated: new Date()
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('❌ Error saving conversation state:', error);
        }
    }

    /**
     * Track performance metrics
     */
    async trackPerformance(companyId, message, response, startTime, traceLog) {
        try {
            const processingTime = Date.now() - startTime;
            
            const metrics = {
                companyId: new ObjectId(companyId),
                timestamp: new Date(),
                message: message.substring(0, 200), // Truncate for storage
                response: response.text?.substring(0, 200),
                confidence: response.confidence,
                responseMethod: response.responseMethod,
                processingTime,
                traceLog: traceLog.slice(-10) // Keep last 10 trace entries
            };

            await this.db.collection('agent_performance').insertOne(metrics);
        } catch (error) {
            console.error('❌ Error tracking performance:', error);
        }
    }
}

// Export singleton instance
const agentMessageProcessor = new AgentMessageProcessor();

module.exports = agentMessageProcessor;

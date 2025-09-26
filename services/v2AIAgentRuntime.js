/**
 * 🚀 V2 AI Agent Runtime - COMPLETELY NEW SYSTEM
 * 
 * This is the NEW V2 system that uses the Agent Personality tab configuration
 * NO LEGACY CODE - Built from scratch for V2 Agent Management Container
 * 
 * Reads from: company.aiAgentLogic (V2 system)
 * NOT from: legacy aiSettings, agentSetup, or personalityResponses
 */

const Company = require('../models/Company');
const { redisClient } = require('../clients');

class V2AIAgentRuntime {
    
    /**
     * 🎯 Initialize a new call with V2 Agent Personality system
     * @param {string} companyID - Company identifier
     * @param {string} callId - Twilio call SID
     * @param {string} from - Caller phone number
     * @param {string} to - Called phone number
     * @returns {Object} Initialization result with V2 greeting
     */
    static async initializeCall(companyID, callId, from, to) {
        console.log(`[V2 AGENT] 🚀 Initializing call for company ${companyID}`);
        
        try {
            // Load company with V2 configuration
            const company = await Company.findById(companyID);
            if (!company) {
                console.error(`❌ V2 AGENT: Company ${companyID} not found`);
                return {
                    greeting: `Configuration error: Company ${companyID} not found in V2 system`,
                    callState: { callId, from, to, stage: 'error' }
                };
            }

            // Check if V2 AI Agent Logic is configured
            if (!company.aiAgentLogic || !company.aiAgentLogic.enabled) {
                console.error(`❌ V2 AGENT: Company ${companyID} does not have V2 AI Agent Logic enabled`);
                return {
                    greeting: `Configuration error: Company ${company.businessName || company.companyName} must configure V2 Agent Personality`,
                    callState: { callId, from, to, stage: 'configuration_error' }
                };
            }

            console.log(`✅ V2 AGENT: Found V2 configuration for ${company.businessName || company.companyName}`);

            // Generate V2 greeting from Agent Personality system
            const greeting = this.generateV2Greeting(company);
            
            console.log(`🎤 V2 AGENT: Generated greeting: "${greeting}"`);

            return {
                greeting,
                callState: {
                    callId,
                    from,
                    to,
                    companyId: companyID,
                    startTime: new Date(),
                    stage: 'greeting',
                    v2System: true
                },
                voiceSettings: company.aiAgentLogic.voiceSettings || null,
                personality: company.aiAgentLogic.agentPersonality || null
            };

        } catch (error) {
            console.error(`❌ V2 AGENT: Error initializing call:`, error);
            return {
                greeting: `System error: Unable to initialize V2 Agent for this call`,
                callState: { callId, from, to, stage: 'system_error' }
            };
        }
    }

    /**
     * 🎭 Generate greeting from V2 Agent Personality system
     * @param {Object} company - Company document with V2 configuration
     * @returns {string} Personalized greeting
     */
    static generateV2Greeting(company) {
        console.log(`[V2 GREETING] 🎭 Generating greeting for ${company.businessName || company.companyName}`);
        
        const aiLogic = company.aiAgentLogic;
        let greeting = null;

        // V2 PRIORITY ORDER - AGENT PERSONALITY SYSTEM ONLY
        // 1. Check V2 Agent Personality opening phrases
        if (aiLogic.agentPersonality?.conversationPatterns?.openingPhrases?.length > 0) {
            const phrases = aiLogic.agentPersonality.conversationPatterns.openingPhrases;
            greeting = phrases[0]; // Use first opening phrase
            console.log(`✅ V2 GREETING: Using V2 opening phrase: "${greeting}"`);
        }
        
        // 2. Generate default V2 greeting based on Agent Personality settings
        else {
            const personality = aiLogic.agentPersonality || {};
            const tone = personality.corePersonality?.voiceTone || 'friendly';
            const companyName = company.businessName || company.companyName;
            
            switch (tone) {
                case 'professional':
                    greeting = `Thank you for calling ${companyName}. How may I assist you today?`;
                    break;
                case 'authoritative':
                    greeting = `${companyName} speaking. What can I help you with?`;
                    break;
                case 'empathetic':
                    greeting = `Hi there! Thanks for reaching out to ${companyName}. I'm here to help you with whatever you need.`;
                    break;
                default: // friendly
                    greeting = `Thanks for calling ${companyName}! How can I help you today?`;
            }
            console.log(`✅ V2 GREETING: Generated default greeting with ${tone} tone: "${greeting}"`);
        }

        // Apply V2 placeholder replacements
        greeting = this.applyV2Placeholders(greeting, company);
        
        return greeting;
    }

    /**
     * 🔄 Apply V2 placeholder replacements
     * @param {string} text - Text with placeholders
     * @param {Object} company - Company document
     * @returns {string} Text with placeholders replaced
     */
    static applyV2Placeholders(text, company) {
        if (!text) return text;

        const companyName = company.businessName || company.companyName || 'our company';
        
        // V2 placeholder system - clean and simple
        let result = text;
        result = result.replace(/\{companyName\}/gi, companyName);
        result = result.replace(/\{companyname\}/gi, companyName);
        result = result.replace(/\{businessName\}/gi, companyName);
        
        // Remove any unfilled placeholders
        result = result.replace(/\{[^}]+\}/g, '');
        
        return result.trim();
    }

    /**
     * 🗣️ Process user input during call
     * @param {string} companyID - Company identifier
     * @param {string} callId - Call identifier
     * @param {string} userInput - User speech input
     * @param {Object} callState - Current call state
     * @returns {Object} Response and updated call state
     */
    static async processUserInput(companyID, callId, userInput, callState) {
        console.log(`[V2 AGENT] 🗣️ Processing user input for call ${callId}: "${userInput}"`);
        
        try {
            // Load company V2 configuration
            const company = await Company.findById(companyID);
            if (!company || !company.aiAgentLogic?.enabled) {
                return {
                    response: "I'm sorry, there's a configuration issue. Let me connect you to someone who can help.",
                    action: 'transfer',
                    callState: { ...callState, stage: 'transfer' }
                };
            }

            // V2 Response Generation - uses new Agent Personality system
            const response = await this.generateV2Response(userInput, company, callState);
            
            // Update call state
            const updatedCallState = {
                ...callState,
                lastInput: userInput,
                lastResponse: response.text,
                turnCount: (callState.turnCount || 0) + 1,
                timestamp: new Date()
            };

            console.log(`✅ V2 AGENT: Generated response: "${response.text}"`);

            return {
                response: response.text,
                action: response.action || 'continue',
                callState: updatedCallState,
                confidence: response.confidence || 0.8
            };

        } catch (error) {
            console.error(`❌ V2 AGENT: Error processing user input:`, error);
            return {
                response: "I'm experiencing a technical issue. Let me connect you to our support team.",
                action: 'transfer',
                callState: { ...callState, stage: 'error' }
            };
        }
    }

    /**
     * 🧠 Generate V2 response using Agent Personality system
     * @param {string} userInput - User input
     * @param {Object} company - Company with V2 configuration
     * @param {Object} callState - Current call state
     * @returns {Object} Generated response
     */
    static async generateV2Response(userInput, company, callState) {
        console.log(`[V2 RESPONSE] 🧠 Generating V2 response for: "${userInput}"`);
        
        const aiLogic = company.aiAgentLogic;
        const personality = aiLogic.agentPersonality || {};
        
        // Simple V2 response logic - can be enhanced later
        let responseText = "I understand your question. Let me help you with that.";
        let action = 'continue';
        let confidence = 0.7;

        // Check for common patterns
        const input = userInput.toLowerCase();
        
        if (input.includes('hello') || input.includes('hi') || input.includes('hey')) {
            responseText = "Hello! How can I assist you today?";
            confidence = 0.9;
        }
        else if (input.includes('service') || input.includes('repair') || input.includes('fix')) {
            responseText = "I'd be happy to help you with service. Can you tell me more about what you need?";
            confidence = 0.8;
        }
        else if (input.includes('price') || input.includes('cost') || input.includes('quote')) {
            responseText = "I can help you with pricing information. Let me connect you with someone who can provide you with a detailed quote.";
            action = 'transfer';
            confidence = 0.8;
        }
        else if (input.includes('emergency') || input.includes('urgent')) {
            responseText = "This sounds urgent. Let me connect you with our emergency team right away.";
            action = 'transfer';
            confidence = 0.95;
        }

        // Apply personality tone to response
        responseText = this.applyV2PersonalityTone(responseText, personality);
        
        // Apply placeholders
        responseText = this.applyV2Placeholders(responseText, company);

        return {
            text: responseText,
            action,
            confidence,
            source: 'v2_agent_personality'
        };
    }

    /**
     * 🎭 Apply V2 personality tone to response
     * @param {string} response - Base response
     * @param {Object} personality - V2 personality configuration
     * @returns {string} Tone-adjusted response
     */
    static applyV2PersonalityTone(response, personality) {
        if (!personality.corePersonality) return response;

        const tone = personality.corePersonality.voiceTone;
        const formality = personality.corePersonality.formalityLevel;

        // Adjust based on V2 personality settings
        if (tone === 'professional' && formality === 'formal') {
            // Keep response formal and professional
            return response;
        }
        else if (tone === 'friendly' && formality === 'casual') {
            // Make response more casual and friendly
            if (!response.includes('!')) {
                response = response.replace('.', '!');
            }
        }
        else if (tone === 'empathetic') {
            // Add empathetic language
            if (!response.startsWith('I understand') && !response.startsWith('I hear')) {
                response = `I understand. ${response}`;
            }
        }

        return response;
    }

    /**
     * 🔄 Clear V2 cache for company
     * @param {string} companyID - Company identifier
     */
    static async clearV2Cache(companyID) {
        try {
            if (redisClient) {
                await redisClient.del(`v2_agent_${companyID}`);
                await redisClient.del(`v2_config_${companyID}`);
                console.log(`✅ V2 AGENT: Cache cleared for company ${companyID}`);
            }
        } catch (error) {
            console.warn(`⚠️ V2 AGENT: Cache clear failed for ${companyID}:`, error.message);
        }
    }
}

module.exports = {
    initializeCall: V2AIAgentRuntime.initializeCall.bind(V2AIAgentRuntime),
    processUserInput: V2AIAgentRuntime.processUserInput.bind(V2AIAgentRuntime),
    clearV2Cache: V2AIAgentRuntime.clearV2Cache.bind(V2AIAgentRuntime)
};

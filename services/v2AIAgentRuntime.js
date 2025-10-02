/**
 * 🚀 V2 AI Agent Runtime - COMPLETELY NEW SYSTEM
 * 
 * This is the NEW V2 system that uses the Agent Personality tab configuration
 * NO LEGACY CODE - Built from scratch for V2 Agent Management Container
 * 
 * Reads from: company.aiAgentLogic (V2 system)
 * NOT from: legacy aiSettings, agentSetup, or personalityResponses
 */

const Company = require('../models/v2Company');
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
                    greeting: "Configuration error: Company not found in V2 system",
                    callState: { callId, from, to, stage: 'error' }
                };
            }

            // Check if V2 AI Agent Logic is configured
            if (!company.aiAgentLogic || !company.aiAgentLogic.enabled) {
                console.error(`❌ V2 AGENT: Company ${companyID} does not have V2 AI Agent Logic enabled`);
                return {
                    greeting: "Configuration error: Company must configure V2 Agent Personality",
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

        // 🎤 PRIORITY 0: INITIAL GREETING (NEW SYSTEM - Highest Priority!)
        if (aiLogic.initialGreeting && aiLogic.initialGreeting.trim()) {
            greeting = aiLogic.initialGreeting;
            console.log(`✅ V2 GREETING: Using Initial Greeting (Priority -1): "${greeting}"`);
        }
        // V2 PRIORITY ORDER - AGENT PERSONALITY SYSTEM (Fallback 1)
        // 1. Check V2 Agent Personality opening phrases
        else if (aiLogic.agentPersonality?.conversationPatterns?.openingPhrases?.length > 0) {
            const phrases = aiLogic.agentPersonality.conversationPatterns.openingPhrases;
            greeting = phrases[0]; // Use first opening phrase
            console.log(`✅ V2 GREETING: Using V2 opening phrase: "${greeting}"`);
        }
        
        // 2. V2 PURE SYSTEM: Pre-configured greetings with NO dynamic insertion (Fallback 2)
        else {
            const personality = aiLogic.agentPersonality || {};
            const tone = personality.corePersonality?.voiceTone || 'friendly';
            
            // V2 PURE SYSTEM: Static greetings with no company name insertion
            // Companies should configure their own greetings in Agent Personality settings
            switch (tone) {
                case 'professional':
                    greeting = "Thank you for calling. How may I assist you today?";
                    break;
                case 'authoritative':
                    greeting = "How can I help you?";
                    break;
                case 'empathetic':
                    greeting = "Hi there! I'm here to help you with whatever you need.";
                    break;
                default: // friendly
                    greeting = "Thanks for calling! How can I help you today?";
            }
            console.log(`✅ V2 PURE: Using static greeting with ${tone} tone (no dynamic insertion)`);
        }

        // V2 PURE SYSTEM: No placeholder contamination - greeting is pre-built
        greeting = this.buildPureResponse(greeting, company);
        
        return greeting;
    }

    /**
     * 🚀 V2 PURE SYSTEM: NO PLACEHOLDERS - Direct string construction only
     * V2 responses are pre-built and contextual - no legacy placeholder contamination
     * @param {string} text - Pre-built response text
     * @param {Object} company - Company document (for context only)
     * @returns {string} Clean response text
     */
    static buildPureResponse(text, company) {
        if (!text) return text;

        // V2 PURE SYSTEM: No placeholders, no string replacement, no legacy contamination
        // All responses should be pre-built and contextual from the AI Agent Logic system
        console.log(`[V2 PURE] ✅ Using pre-built response without placeholder contamination`);
        
        return text.trim();
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
        
        // 🚀 V2 ENHANCED: Use Priority-Driven Knowledge Router for intelligent responses
        try {
            const PriorityRouter = require('./priorityDrivenKnowledgeRouter');
            const router = new PriorityRouter();
            
            // Execute priority routing with V2 enhanced matching
            const context = {
                companyId: company._id.toString(),
                query: userInput,
                callState,
                priorities: aiLogic.knowledgeSourcePriorities || {
                    priorityFlow: [
                        { source: 'companyQnA', priority: 1, threshold: 0.8, enabled: true },
                        { source: 'tradeQnA', priority: 2, threshold: 0.75, enabled: true },
                        { source: 'templates', priority: 3, threshold: 0.7, enabled: true },
                        { source: 'inHouseFallback', priority: 4, threshold: 0.5, enabled: true }
                    ]
                }
            };
            
            const routingResult = await router.executePriorityRouting(context);
            
            if (routingResult && routingResult.response && routingResult.confidence >= 0.5) {
                console.log(`[V2 KNOWLEDGE] ✅ Found answer from ${routingResult.source} (confidence: ${routingResult.confidence})`);
                
                let responseText = routingResult.response;
                
                // 🤖 AI AGENT ROLE INJECTION: If category has AI Agent Role, apply it to the response
                if (routingResult.metadata?.aiAgentRole) {
                    console.log(`🤖 [AI AGENT ROLE] Applying role from category: ${routingResult.metadata.category}`);
                    console.log(`🤖 [AI AGENT ROLE] Role instructions: ${routingResult.metadata.aiAgentRole.substring(0, 150)}...`);
                    
                    // Prefix the response with role-aware context
                    // This ensures the AI adopts the persona defined in the category
                    responseText = this.applyAIAgentRole(responseText, routingResult.metadata.aiAgentRole, company);
                }
                
                // Apply personality tone to response
                responseText = this.applyV2PersonalityTone(responseText, personality);
                
                // V2 PURE SYSTEM: No placeholder contamination - response is pre-built
                responseText = this.buildPureResponse(responseText, company);

                return {
                    text: responseText,
                    action: 'continue',
                    confidence: routingResult.confidence,
                    source: routingResult.source,
                    metadata: {
                        ...routingResult.metadata,
                        aiAgentRoleApplied: !!routingResult.metadata?.aiAgentRole
                    }
                };
            }
        } catch (knowledgeError) {
            console.warn(`[V2 KNOWLEDGE] ⚠️ Knowledge routing failed, using fallback:`, knowledgeError.message);
        }
        
        // 🔄 FALLBACK: Basic V2 response logic if knowledge routing fails
        let responseText = "I understand your question. Let me help you with that.";
        let action = 'continue';
        let confidence = 0.7;

        // Enhanced keyword matching for common queries
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
        
        // V2 PURE SYSTEM: No placeholder contamination - response is pre-built
        responseText = this.buildPureResponse(responseText, company);

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
            // V2 PURE SYSTEM: No dynamic string insertion - responses should be pre-built
            // Empathetic responses should be configured in Agent Personality settings
            if (!response.startsWith('I understand') && !response.startsWith('I hear')) {
                response = "I understand. " + response; // Simple concatenation, no template literals
            }
        }

        return response;
    }

    /**
     * 🤖 Apply AI Agent Role to Response
     * Takes the base answer and enhances it with the AI Agent's role/persona
     * @param {string} baseResponse - The base answer from Q&A
     * @param {string} aiAgentRole - The AI Agent role instructions from category
     * @param {Object} company - Company object
     * @returns {string} Role-enhanced response
     */
    static applyAIAgentRole(baseResponse, aiAgentRole, company) {
        console.log(`🤖 [AI ROLE] Applying AI Agent role to response`);
        
        // Parse role instructions to understand the persona
        const roleLower = aiAgentRole.toLowerCase();
        const companyName = company.companyName || 'our company';
        
        // Extract tone indicators from role
        const isFriendly = roleLower.includes('friendly') || roleLower.includes('warm');
        const isProfessional = roleLower.includes('professional') || roleLower.includes('formal');
        const isHelpful = roleLower.includes('helpful') || roleLower.includes('assist');
        const isReceptionist = roleLower.includes('receptionist');
        
        // 🎭 ROLE-AWARE RESPONSE ENHANCEMENT
        // Add natural, role-appropriate phrasing
        let enhancedResponse = baseResponse;
        
        // If role mentions scheduling/appointments and response doesn't offer to schedule
        if (isReceptionist && roleLower.includes('appointment') && 
            !baseResponse.toLowerCase().includes('schedule') && 
            !baseResponse.toLowerCase().includes('appointment')) {
            enhancedResponse += ` Would you like me to help you schedule an appointment?`;
        }
        
        // If role emphasizes helpfulness, add helpful closing
        if (isHelpful && !baseResponse.endsWith('?')) {
            enhancedResponse += ` Is there anything else I can help you with today?`;
        }
        
        // Replace generic company references with actual company name
        enhancedResponse = enhancedResponse.replace(/\[Company Name\]/gi, companyName);
        enhancedResponse = enhancedResponse.replace(/our company/gi, companyName);
        
        // 🔧 QUICK VARIABLES: Replace all Quick Variables with their actual values
        // Supports both [brackets] and {braces}, case-insensitive
        if (company.quickVariables && Array.isArray(company.quickVariables)) {
            console.log(`🔧 [QUICK-VARS] Replacing ${company.quickVariables.length} Quick Variables`);
            company.quickVariables.forEach(variable => {
                // Escape special regex characters in variable name
                const escapedName = variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Match both [Variable Name] and {Variable Name}, case-insensitive
                // Pattern: [\[{]variable name[\]}]
                const regex = new RegExp(`[\\[{]\\s*${escapedName}\\s*[\\]}]`, 'gi');
                
                const before = enhancedResponse;
                enhancedResponse = enhancedResponse.replace(regex, variable.value);
                
                if (before !== enhancedResponse) {
                    console.log(`🔧 [QUICK-VARS] Replaced [${variable.name}] or {${variable.name}} → ${variable.value}`);
                }
            });
        }
        
        console.log(`🤖 [AI ROLE] ✅ Response enhanced with role persona`);
        return enhancedResponse;
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

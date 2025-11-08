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
const AdminSettings = require('../models/AdminSettings');
const logger = require('../utils/logger.js');

const { redisClient } = require('../clients');

class V2AIAgentRuntime {
    
    /**
     * 🎯 Initialize a new call with V2 Agent Personality system
     * @param {string} companyID - Company identifier
     * @param {string} callId - Twilio call SID
     * @param {string} from - Caller phone number
     * @param {string} to - Called phone number
     * @param {string} callSource - Call source: 'company-test' | 'production'
     * @param {boolean} isTest - Test mode flag
     * @returns {Object} Initialization result with V2 greeting
     */
    static async initializeCall(companyID, callId, from, to, callSource = 'production', isTest = false) {
        logger.debug(`[V2 AGENT] 🚀 Initializing call for company ${companyID}`);
        logger.info(`🎯 [V2 AGENT] Call source: ${callSource.toUpperCase()} | Test: ${isTest}`);
        
        try {
            // Load company with V2 configuration
            const company = await Company.findById(companyID);
            if (!company) {
                logger.error(`❌ V2 AGENT: Company ${companyID} not found`);
                return {
                    greeting: "Configuration error: Company not found in V2 system",
                    callState: { callId, from, to, stage: 'error' }
                };
            }

            // Check if V2 AI Agent Logic is configured
            if (!company.aiAgentLogic || !company.aiAgentLogic.enabled) {
                logger.error(`❌ V2 AGENT: Company ${companyID} does not have V2 AI Agent Logic enabled`);
                return {
                    greeting: "Configuration error: Company must configure V2 Agent Personality",
                    callState: { callId, from, to, stage: 'configuration_error' }
                };
            }

            logger.debug(`✅ V2 AGENT: Found V2 configuration for ${company.businessName || company.companyName}`);
            
            // 🔍 DIAGNOSTIC: Log voice settings from database
            logger.debug(`🔍 V2 VOICE DEBUG: Raw voiceSettings from DB:`, JSON.stringify(company.aiAgentLogic?.voiceSettings, null, 2));
            logger.debug(`🔍 V2 VOICE DEBUG: Has voiceSettings: ${Boolean(company.aiAgentLogic?.voiceSettings)}`);
            logger.debug(`🔍 V2 VOICE DEBUG: Voice ID: ${company.aiAgentLogic?.voiceSettings?.voiceId || 'NOT SET'}`);
            logger.debug(`🔍 V2 VOICE DEBUG: API Source: ${company.aiAgentLogic?.voiceSettings?.apiSource || 'NOT SET'}`);

            // Generate V2 greeting from Agent Personality system (4-MODE SYSTEM)
            const greetingConfig = this.generateV2Greeting(company);
            
            logger.debug(`🎤 V2 AGENT: Generated greeting config:`, JSON.stringify(greetingConfig, null, 2));

            return {
                greetingConfig, // NEW: Full greeting configuration with mode
                greeting: greetingConfig.text || greetingConfig.audioUrl || '', // LEGACY: For backwards compatibility
                callState: {
                    callId,
                    from,
                    to,
                    companyId: companyID,
                    startTime: new Date(),
                    stage: 'greeting',
                    v2System: true,
                    greetingMode: greetingConfig.mode,
                    // 🎯 Phase 1: Test Pilot Integration
                    callSource,  // 'company-test' | 'production'
                    isTest       // boolean flag
                },
                voiceSettings: company.aiAgentLogic.voiceSettings || null,
                personality: company.aiAgentLogic.agentPersonality || null
            };

        } catch (error) {
            // Enhanced error reporting with company context
            logger.companyError({
                companyId: companyID,
                companyName: 'Unknown',
                code: 'AI_AGENT_INIT_FAILURE',
                message: `AI Agent failed to initialize call ${callId}`,
                severity: 'CRITICAL',
                error,
                meta: {
                    callId,
                    from,
                    to
                }
            });
            
            return {
                greeting: `System error: Unable to initialize V2 Agent for this call`,
                callState: { callId, from, to, stage: 'system_error' }
            };
        }
    }

    /**
     * 🎭 Generate greeting from V2 Agent Personality system with 4-MODE SYSTEM
     * @param {Object} company - Company document with V2 configuration
     * @returns {Object} Greeting configuration with mode and content
     */
    static generateV2Greeting(company) {
        logger.info(`[V2 GREETING] 🎭 Generating greeting for ${company.businessName || company.companyName}`);
        
        // ✅ FIX: Use ROOT LEVEL connectionMessages (AI Agent Settings tab)
        // NOT aiAgentLogic.connectionMessages (deleted legacy tab)
        const connectionMessages = company.connectionMessages;
        const voiceConfig = connectionMessages?.voice;

        // Check if connection messages are configured
        if (!voiceConfig) {
            logger.error(`❌ CRITICAL: No connection messages configured for company ${company._id}`);
            logger.error(`❌ HINT: Configure greeting in AI Agent Settings > Messages & Greetings tab`);
            return {
                mode: 'error',
                text: "CONFIGURATION ERROR: No greeting has been set. Please configure a greeting in the AI Agent Settings tab."
            };
        }

        const mode = voiceConfig.mode || 'disabled';
        logger.info(`🎯 V2 GREETING: Mode selected: ${mode}`);

        // MODE 1: PRE-RECORDED AUDIO
        if (mode === 'prerecorded') {
            if (voiceConfig.prerecorded?.activeFileUrl) {
                logger.info(`✅ V2 GREETING: Using pre-recorded audio: ${voiceConfig.prerecorded.activeFileUrl}`);
                return {
                    mode: 'prerecorded',
                    audioUrl: voiceConfig.prerecorded.activeFileUrl,
                    fileName: voiceConfig.prerecorded.activeFileName,
                    duration: voiceConfig.prerecorded.activeDuration
                };
            } 
                logger.warn(`⚠️ V2 GREETING: Pre-recorded mode selected but no file uploaded`);
                // Trigger fallback
                return this.triggerFallback(company, 'Pre-recorded audio file missing');
            
        }

        // MODE 2: REAL-TIME TTS (ELEVENLABS)
        if (mode === 'realtime') {
            const greetingText = voiceConfig.text || voiceConfig.realtime?.text;
            
            if (greetingText && greetingText.trim()) {
                const processedText = this.buildPureResponse(greetingText, company);
                logger.debug(`✅ V2 GREETING: Using real-time TTS: "${processedText}"`);
                return {
                    mode: 'realtime',
                    text: processedText,
                    voiceId: voiceConfig.realtime?.voiceId || company.voiceSettings?.selectedVoiceId
                };
            } 
                logger.warn(`⚠️ V2 GREETING: Real-time mode selected but no text configured`);
                // Trigger fallback
                return this.triggerFallback(company, 'Real-time TTS text missing');
            
        }

        // MODE 3: DISABLED (SKIP GREETING - GO STRAIGHT TO AI)
        if (mode === 'disabled') {
            logger.info(`✅ V2 GREETING: Greeting disabled - going straight to AI`);
            return {
                mode: 'disabled',
                text: null
            };
        }

        // MODE 4: FALLBACK (EMERGENCY BACKUP)
        logger.warn(`⚠️ V2 GREETING: Invalid or missing mode - triggering fallback`);
        return this.triggerFallback(company, 'Invalid greeting mode');
    }

    /**
     * 🆘 Trigger intelligent fallback system
     * @param {Object} company - Company document
     * @param {String} reason - Reason for fallback
     * @returns {Object} Fallback greeting configuration
     */
    static triggerFallback(company, reason) {
        logger.info(`🆘 V2 FALLBACK: Triggered for ${company.companyName} - Reason: ${reason}`);
        
        // ✅ FIX: Use ROOT LEVEL connectionMessages (AI Agent Settings tab)
        const fallbackConfig = company.connectionMessages?.voice?.fallback;
        
        if (!fallbackConfig || !fallbackConfig.enabled) {
            logger.error(`❌ FALLBACK: Fallback system is disabled or not configured`);
            logger.error(`❌ HINT: Configure fallback in AI Agent Settings > Messages & Greetings > Fallback tab`);
            return {
                mode: 'error',
                text: "We're experiencing technical difficulties. Please try again later."
            };
        }

        const fallbackText = fallbackConfig.voiceMessage || "We're experiencing technical difficulties. Please hold while we connect you to our team.";
        const processedText = this.buildPureResponse(fallbackText, company);

        logger.debug(`✅ V2 FALLBACK: Using fallback message: "${processedText}"`);

        // Queue async fallback actions (SMS + Admin notifications)
        this.executeFallbackActions(company, reason, fallbackConfig).catch(error => {
            logger.error(`❌ FALLBACK: Error executing fallback actions:`, error);
        });

        return {
            mode: 'fallback',
            text: processedText,
            reason,
            voiceId: company.voiceSettings?.selectedVoiceId
        };
    }

    /**
     * 📱 Execute fallback actions (SMS + Admin notifications)
     * @param {Object} company - Company document
     * @param {String} reason - Fallback reason
     * @param {Object} fallbackConfig - Fallback configuration
     */
    static async executeFallbackActions(company, reason, fallbackConfig) {
        try {
            const intelligentFallbackHandler = require('./intelligentFallbackHandler');
            
            await intelligentFallbackHandler.executeFallback({
                company,
                companyId: company._id,
                companyName: company.companyName || company.businessName,
                callerPhone: null, // Will be set by Twilio handler
                failureReason: reason,
                fallbackConfig
            });
        } catch (error) {
            logger.error(`❌ FALLBACK ACTIONS: Error:`, error);
        }
    }

    /**
     * 🚀 V2 PLACEHOLDER REPLACEMENT SYSTEM
     * 
     * REFACTORED: Now uses canonical placeholderReplacer
     * - Reads from: company.aiAgentSettings.variables
     * - Single source of truth for all variable replacement
     * 
     * @param {string} text - Response text with placeholders
     * @param {Object} company - Company document with variable definitions
     * @returns {string} Response with placeholders replaced
     */
    static buildPureResponse(text, company) {
        if (!text) {return text;}
        
        const { replacePlaceholders } = require('../utils/placeholderReplacer');
        return replacePlaceholders(text, company).trim();
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
        logger.debug(`[V2 AGENT] 🗣️ Processing user input for call ${callId}: "${userInput}"`);
        
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

            logger.info(`✅ V2 AGENT: Generated response: "${response.text}"`);

            return {
                response: response.text,
                action: response.action || 'continue',
                callState: updatedCallState,
                confidence: response.confidence || 0.8
            };

        } catch (error) {
            // Enhanced error reporting with company context
            logger.companyError({
                companyId: companyID,
                companyName: callState.companyName || 'Unknown',
                code: 'AI_AGENT_PROCESSING_FAILURE',
                message: `AI Agent failed to process user input for call ${callId}`,
                severity: 'WARNING',
                error,
                meta: {
                    callId,
                    userInput: userInput?.substring(0, 100), // Truncate for privacy
                    callStage: callState.stage,
                    turnCount: callState.turnCount || 0
                }
            });
            
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
        logger.info(`[V2 RESPONSE] 🧠 Generating V2 response for: "${userInput}"`);
        
        const aiLogic = company.aiAgentLogic;
        const personality = aiLogic.agentPersonality || {};
        
        // 🎯 Load company production intelligence settings
        let effectiveIntelligence = {};
        try {
            const prodInt = aiLogic.productionIntelligence || {};
            
            effectiveIntelligence = prodInt;
            logger.info(`✅ [INTELLIGENCE CONFIG] Using company production settings:`, {
                tier1: effectiveIntelligence.thresholds?.tier1 || 0.80,
                tier2: effectiveIntelligence.thresholds?.tier2 || 0.60,
                enableTier3: effectiveIntelligence.thresholds?.enableTier3 !== false,
                model: effectiveIntelligence.llmConfig?.model || 'gpt-4o-mini'
            });
        } catch (intError) {
            logger.warn(`⚠️ [INTELLIGENCE CONFIG] Failed to load intelligence settings:`, intError.message);
            // Use defaults if loading fails
            effectiveIntelligence = {
                thresholds: { tier1: 0.80, tier2: 0.60, enableTier3: true },
                llmConfig: { model: 'gpt-4o-mini', maxCostPerCall: 0.10 }
            };
        }
        
        // 🚀 V2 ENHANCED: Use Priority-Driven Knowledge Router for intelligent responses
        try {
            const PriorityRouter = require('./v2priorityDrivenKnowledgeRouter');
            const router = new PriorityRouter();
            
            // 🎯 TASK 3.1: Pass callSource and intelligenceConfig into router context
            const context = {
                // 🔧 FIX: Add required routing context properties
                routingId: `${callState.callId}-${Date.now()}`,
                startTime: Date.now(),
                routingFlow: [],
                finalMatch: null,
                performance: {},
                // Existing properties
                companyId: company._id.toString(),
                company,
                query: userInput,
                callState,
                // 🎯 NEW: Pass call source for Test Pilot vs Production tracking
                callSource: callState.callSource || 'production',
                isTest: callState.isTest || false,
                // 🎯 NEW: Pass effective intelligence configuration
                intelligenceConfig: effectiveIntelligence,
                // 🔧 FIX: Changed "priorities" to "priorityConfig" (router expects this name)
                priorityConfig: aiLogic.knowledgeSourcePriorities || {
                    priorityFlow: [
                        { source: 'companyQnA', priority: 1, threshold: 0.8, enabled: true },
                        { source: 'tradeQnA', priority: 2, threshold: 0.75, enabled: true },
                        { source: 'templates', priority: 3, threshold: 0.7, enabled: true },
                        { source: 'inHouseFallback', priority: 4, threshold: 0.5, enabled: true }
                    ]
                }
            };
            
            logger.info(`🎯 [ROUTER CONTEXT] Routing with callSource: ${context.callSource} | Test: ${context.isTest}`);
            
            // 🔍 DIAGNOSTIC: About to call knowledge router
            console.log('═'.repeat(80));
            console.log('[🔍 AI BRAIN] About to call executePriorityRouting');
            console.log('CompanyID:', company._id.toString());
            console.log('User input:', userInput);
            console.log('═'.repeat(80));
            
            const routingResult = await router.executePriorityRouting(context);
            
            // 🔍 DIAGNOSTIC: Knowledge router returned
            console.log('═'.repeat(80));
            console.log('[🔍 AI BRAIN] Knowledge router returned');
            console.log('Success:', Boolean(routingResult));
            console.log('Response:', routingResult?.response?.substring(0, 50));
            console.log('Confidence:', routingResult?.confidence);
            console.log('═'.repeat(80));
            
            if (routingResult && routingResult.response && routingResult.confidence >= 0.5) {
                logger.info(`[V2 KNOWLEDGE] ✅ Found answer from ${routingResult.source} (confidence: ${routingResult.confidence})`);
                
                let responseText = routingResult.response;
                
                // 🤖 AI AGENT ROLE INJECTION: If category has AI Agent Role, apply it to the response
                if (routingResult.metadata?.aiAgentRole) {
                    logger.info(`🤖 [AI AGENT ROLE] Applying role from category: ${routingResult.metadata.category}`);
                    logger.info(`🤖 [AI AGENT ROLE] Role instructions: ${routingResult.metadata.aiAgentRole.substring(0, 150)}...`);
                    
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
                        aiAgentRoleApplied: Boolean(routingResult.metadata?.aiAgentRole)
                    }
                };
            }
        } catch (knowledgeError) {
            // 🔍 DIAGNOSTIC: Full error details
            console.log('═'.repeat(80));
            console.log('[❌ AI BRAIN ERROR] Knowledge routing threw error:');
            console.log('Error message:', knowledgeError.message);
            console.log('Error stack:', knowledgeError.stack);
            console.log('═'.repeat(80));
            
            logger.warn(`[V2 KNOWLEDGE] ⚠️ Knowledge routing failed, using fallback:`, knowledgeError.message);
            logger.error(`[V2 KNOWLEDGE] Full error:`, knowledgeError);
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
        if (!personality.corePersonality) {return response;}

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
                response = `I understand. ${  response}`; // Simple concatenation, no template literals
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
        logger.info(`🤖 [AI ROLE] Applying AI Agent role to response`);
        
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
        
        // 🔧 PLACEHOLDERS: Replace all placeholders with their actual values
        // Supports both [brackets] and {braces}, case-insensitive
        if (company.aiAgentLogic?.placeholders && Array.isArray(company.aiAgentLogic.placeholders)) {
            logger.info(`🔧 [PLACEHOLDERS] Replacing ${company.aiAgentLogic.placeholders.length} placeholders in AI role response`);
            company.aiAgentLogic.placeholders.forEach(placeholder => {
                // Escape special regex characters in placeholder name
                const escapedName = placeholder.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Match both [Placeholder Name] and {Placeholder Name}, case-insensitive
                // Pattern: [\[{]placeholder name[\]}]
                const regex = new RegExp(`[\\[{]\\s*${escapedName}\\s*[\\]}]`, 'gi');
                
                const before = enhancedResponse;
                enhancedResponse = enhancedResponse.replace(regex, placeholder.value);
                
                if (before !== enhancedResponse) {
                    logger.info(`🔧 [PLACEHOLDERS] Replaced {${placeholder.name}} → ${placeholder.value}`);
                }
            });
        }
        
        logger.info(`🤖 [AI ROLE] ✅ Response enhanced with role persona`);
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
                logger.debug(`✅ V2 AGENT: Cache cleared for company ${companyID}`);
            }
        } catch (error) {
            logger.warn(`⚠️ V2 AGENT: Cache clear failed for ${companyID}:`, error.message);
        }
    }
}

module.exports = {
    initializeCall: V2AIAgentRuntime.initializeCall.bind(V2AIAgentRuntime),
    processUserInput: V2AIAgentRuntime.processUserInput.bind(V2AIAgentRuntime),
    clearV2Cache: V2AIAgentRuntime.clearV2Cache.bind(V2AIAgentRuntime)
};

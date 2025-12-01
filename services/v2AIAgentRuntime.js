/**
 * 🚀 V2 AI Agent Runtime - COMPLETELY NEW SYSTEM
 * 
 * This is the NEW V2 system that uses the Agent Personality tab configuration
 * NO LEGACY CODE - Built from scratch for V2 Agent Management Container
 * 
 * Reads from: company.aiAgentSettings (V2 system)
 * NOT from: legacy aiSettings, agentSetup, or personalityResponses
 */

const Company = require('../models/v2Company');
const AdminSettings = require('../models/AdminSettings');
const logger = require('../utils/logger.js');

const { redisClient } = require('../clients');

// ═══════════════════════════════════════════════════════════════════
// TRACE LOGGING - Visibility into production brain decisions
// ═══════════════════════════════════════════════════════════════════
const TraceLogger = require('./TraceLogger');

// ═══════════════════════════════════════════════════════════════════
// CHEAT SHEET SYSTEM - Phase 1 Integration
// ═══════════════════════════════════════════════════════════════════
const PolicyCompiler = require('./PolicyCompiler');
const CheatSheetEngine = require('./CheatSheetEngine');
const SessionManager = require('./SessionManager');

// ═══════════════════════════════════════════════════════════════════
// FRONTLINE-INTEL - The Command Layer
// ═══════════════════════════════════════════════════════════════════
const FrontlineIntel = require('./FrontlineIntel');
const CallFlowExecutor = require('./CallFlowExecutor');

// ═══════════════════════════════════════════════════════════════════
// BRAIN-1 RUNTIME - New Clean Architecture
// ═══════════════════════════════════════════════════════════════════
// Brain-1 is the mandatory gateway for all caller turns.
// Every utterance flows through Brain-1 before anything else.
// Brain-1 decides actions, Brain-2 (3-Tier) provides knowledge.
// ═══════════════════════════════════════════════════════════════════
const { processTurn: brain1ProcessTurn } = require('../src/services/brain1');

// ═══════════════════════════════════════════════════════════════════
// LAZY-LOADED SERVICES (moved from inline requires to top-level)
// These were previously require()'d inside functions. Moved here for:
// - Clear dependency graph
// - Easier testing/mocking
// - Consistent initialization
// ═══════════════════════════════════════════════════════════════════
const CheatSheetRuntimeService = require('./cheatsheet/CheatSheetRuntimeService');
const intelligentFallbackHandler = require('./intelligentFallbackHandler');
const MemoryEngine = require('./MemoryEngine');
const TriageService = require('./TriageService');
const PostCallLearningService = require('./PostCallLearningService');
const AIBrain3tierllm = require('./AIBrain3tierllm');
const { replacePlaceholders } = require('../utils/placeholderReplacer');

// ═══════════════════════════════════════════════════════════════════
// ERROR MESSAGES - Internal vs Caller-facing
// Internal messages for logs, caller messages for TTS
// ═══════════════════════════════════════════════════════════════════
const ERROR_MESSAGES = {
    internal: {
        companyNotFound: 'Company not found in V2 system',
        agentDisabled: 'AI Agent explicitly disabled for company',
        initFailure: 'AI Agent failed to initialize call',
        processingFailure: 'AI Agent failed to process user input'
    },
    caller: {
        technicalDifficulties: "We're experiencing technical difficulties. Please call back shortly, or press zero to speak with someone directly.",
        agentUnavailable: "Our automated assistant is currently unavailable. Please hold while I connect you with a team member."
    }
};

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
                logger.error(`❌ V2 AGENT: ${ERROR_MESSAGES.internal.companyNotFound}`, { companyID });
                return {
                    greeting: ERROR_MESSAGES.caller.technicalDifficulties,
                    callState: { callId, from, to, stage: 'error' }
                };
            }

            // Initialize aiAgentSettings if missing (for backward compatibility)
            // NOTE: Do NOT save to database - just set in memory to avoid validation errors
            if (!company.aiAgentSettings) {
                logger.warn(`⚠️ V2 AGENT: Company ${companyID} missing aiAgentSettings - auto-initializing (memory only)`);
                company.aiAgentSettings = { enabled: true };
            }
            
            // Auto-enable if enabled flag is missing
            if (company.aiAgentSettings.enabled === undefined) {
                logger.warn(`⚠️ V2 AGENT: Company ${companyID} missing enabled flag - auto-enabling (memory only)`);
                company.aiAgentSettings.enabled = true;
            }
            
            // Check if explicitly disabled
            if (company.aiAgentSettings.enabled === false) {
                logger.error(`❌ V2 AGENT: ${ERROR_MESSAGES.internal.agentDisabled}`, { companyID });
                return {
                    greeting: ERROR_MESSAGES.caller.agentUnavailable,
                    callState: { callId, from, to, stage: 'disabled' }
                };
            }

            logger.debug(`✅ V2 AGENT: Found V2 configuration for ${company.businessName || company.companyName}`);
            
            // 🔍 DIAGNOSTIC: Log voice settings from database
            logger.debug(`🔍 V2 VOICE DEBUG: Raw voiceSettings from DB:`, JSON.stringify(company.aiAgentSettings?.voiceSettings, null, 2));
            logger.debug(`🔍 V2 VOICE DEBUG: Has voiceSettings: ${Boolean(company.aiAgentSettings?.voiceSettings)}`);
            logger.debug(`🔍 V2 VOICE DEBUG: Voice ID: ${company.aiAgentSettings?.voiceSettings?.voiceId || 'NOT SET'}`);
            logger.debug(`🔍 V2 VOICE DEBUG: API Source: ${company.aiAgentSettings?.voiceSettings?.apiSource || 'NOT SET'}`);

            // ─────────────────────────────────────────────────────────────
            // 🧠 CHEAT SHEET V2: Load live config from CheatSheetVersion
            // ─────────────────────────────────────────────────────────────
            const liveCheatSheet = await CheatSheetRuntimeService.getLiveConfig(companyID);
            
            if (!liveCheatSheet) {
                logger.error('[V2 AGENT] ❌ No live CheatSheet V2 config found', {
                    companyId: companyID
                });
                // Graceful degradation - agent will run with minimal config
                // Do NOT fallback to V1 - V1 is dead to runtime
            } else {
                logger.info('[V2 AGENT] ✅ Loaded live CheatSheet V2 config', {
                    companyId: companyID,
                    versionId: liveCheatSheet.versionId,
                    versionName: liveCheatSheet.name
                });
                
                // Policy compilation now uses V2 config
                // Note: PolicyCompiler expects version/status, so we wrap the config
                try {
                    const configWithMeta = {
                        ...liveCheatSheet.config,
                        version: liveCheatSheet.config.schemaVersion || 1,
                        status: 'active', // Live versions are always active
                        versionId: liveCheatSheet.versionId
                    };
                    
                    await PolicyCompiler.compile(companyID, configWithMeta);
                    logger.info('[V2 AGENT] ✅ Cheat sheet V2 policy compiled successfully', {
                        versionId: liveCheatSheet.versionId
                    });
                } catch (compileErr) {
                    logger.error('[V2 AGENT] ❌ Cheat sheet V2 compilation failed', {
                        companyId: companyID,
                        versionId: liveCheatSheet.versionId,
                        error: compileErr.message
                    });
                    // Continue without cheat sheet (graceful degradation)
                }
            }

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
                voiceSettings: company.aiAgentSettings.voiceSettings || null,
                personality: company.aiAgentSettings.agentPersonality || null
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
        // NOT aiAgentSettings.connectionMessages (deleted legacy tab)
        const connectionMessages = company.connectionMessages;
        const voiceConfig = connectionMessages?.voice;

        // Check if connection messages are configured
        if (!connectionMessages) {
            logger.error(`❌ CRITICAL: connectionMessages object missing for company ${company._id}`);
            logger.error(`❌ HINT: Configure greeting in AI Agent Settings > Messages & Greetings tab`);
            logger.error(`❌ DEBUG: company.connectionMessages is:`, connectionMessages);
            return {
                mode: 'error',
                text: "Thank you for calling. Please configure your greeting in AI Agent Settings."
            };
        }
        
        if (!voiceConfig) {
            logger.error(`❌ CRITICAL: voice config missing in connectionMessages for company ${company._id}`);
            logger.error(`❌ HINT: Configure greeting in AI Agent Settings > Messages & Greetings tab`);
            logger.error(`❌ DEBUG: connectionMessages.voice is:`, voiceConfig);
            return {
                mode: 'error',
                text: "Thank you for calling. Please configure your greeting in AI Agent Settings."
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
     * 🆘 Trigger intelligent fallback system - HYBRID APPROACH
     * 
     * 🔥 NO GENERIC FALLBACK TEXT
     * When greeting infrastructure fails:
     * 1. Send SMS to customer (infrastructure issue detected)
     * 2. Alert admin CRITICAL (ops team investigates)
     * 3. Transfer to human (no masking)
     */
    static triggerFallback(company, reason) {
        logger.error(`🚨 [INFRASTRUCTURE FAILURE] V2 FALLBACK: Triggered for ${company.companyName} - Reason: ${reason}`);
        
        // ✅ Use ROOT LEVEL connectionMessages (AI Agent Settings tab)
        const fallbackConfig = company.connectionMessages?.voice?.fallback;

        logger.error(`🚨 [INFRASTRUCTURE FAILURE] Executing fallback protocol: SMS + Alert + Transfer`);

        // Queue async fallback actions (SMS + Critical admin alert)
        this.executeFallbackActions(company, reason, fallbackConfig).catch(error => {
            logger.error('[FALLBACK ACTIONS] Error executing fallback', { error: error.message });
        });

        // 🔥 NO GENERIC TEXT - Return transfer action immediately
        return {
            mode: 'transfer',  // Go directly to human agent
            reason: reason,
            voiceId: company.voiceSettings?.selectedVoiceId,
            action: 'transfer'  // Explicit transfer signal
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
            await intelligentFallbackHandler.executeFallback({
                company,
                companyId: company._id,
                companyName: company.companyName || company.businessName,
                callerPhone: null, // Will be set by Twilio handler
                failureReason: reason,
                fallbackConfig
            });
        } catch (error) {
            logger.error('[FALLBACK ACTIONS] Error executing fallback', { error: error.message });
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
        if (!text) { return text; }
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
        // ═══════════════════════════════════════════════════════════════════
        // INPUT VALIDATION - Protect against null, non-string, or huge inputs
        // ═══════════════════════════════════════════════════════════════════
        if (!userInput || typeof userInput !== 'string') {
            logger.warn('[V2 AGENT] Invalid userInput, using empty string', { 
                companyID, 
                callId, 
                type: typeof userInput,
                value: userInput === null ? 'null' : userInput === undefined ? 'undefined' : 'other'
            });
            userInput = '';
        }
        
        if (userInput.length > 5000) {
            logger.warn('[V2 AGENT] Truncating excessive input', { 
                companyID, 
                callId, 
                originalLength: userInput.length 
            });
            userInput = userInput.substring(0, 5000);
        }
        
        logger.debug(`[V2 AGENT] 🗣️ Processing user input for call ${callId}: "${userInput.substring(0, 100)}${userInput.length > 100 ? '...' : ''}"`);
        
        try {
            // Load company V2 configuration
            const company = await Company.findById(companyID);
            
            // Check if company exists
            if (!company) {
                logger.error('[V2 AGENT] ❌ Company not found', { companyID });
                return {
                    response: null,
                    action: 'transfer',
                    callState: { ...callState, stage: 'transfer' }
                };
            }
            
            // Check if AI Agent is enabled
            // Default to enabled if aiAgentSettings exists (backward compatibility)
            const isEnabled = company.aiAgentSettings?.enabled !== false;
            if (!isEnabled) {
                logger.warn('[V2 AGENT] ⚠️ AI Agent explicitly disabled for company', { companyID });
                return {
                    response: null,
                    action: 'transfer',
                    callState: { ...callState, stage: 'transfer' }
                };
            }

            // ═════════════════════════════════════════════════════════════════
            // 🎯 DYNAMIC CALL FLOW EXECUTION
            // ═════════════════════════════════════════════════════════════════
            // Execute steps based on callFlowConfig order and enabled flags
            // This replaces the old hardcoded: Frontline → generateV2Response → CheatSheet
            // ═════════════════════════════════════════════════════════════════
            
            logger.info('[CALL FLOW] 🎯 Starting dynamic call flow execution', {
                companyId: companyID,
                callId,
                userInput: userInput.substring(0, 100)
            });
            
            // ═════════════════════════════════════════════════════════════════
            // 🧠 BRAIN-4: MEMORY ENGINE - Hydrate caller history & resolution paths
            // ═════════════════════════════════════════════════════════════════
            const executionContext = {
                userInput,
                company,
                callState,
                callId,
                companyID,
                generateV2Response: this.generateV2Response.bind(this)
            };
            
            try {
                await MemoryEngine.hydrateMemoryContext(executionContext);
                logger.debug('[V2 AGENT] 🧠 Memory context hydrated', {
                    callId,
                    callerHistoryCount: executionContext.memory?.callerHistory?.length || 0,
                    resolutionPathsCount: executionContext.memory?.resolutionPaths?.length || 0
                });
            } catch (memErr) {
                logger.error('[V2 AGENT] ❌ Memory hydration failed (non-fatal)', {
                    callId,
                    error: memErr.message
                });
                // Explicitly set safe default so downstream code has predictable state
                executionContext.memory = { callerHistory: [], resolutionPaths: [] };
            }
            
            // ═════════════════════════════════════════════════════════════════
            // 🧠 BRAIN-1 RUNTIME - NEW CLEAN ARCHITECTURE
            // ═════════════════════════════════════════════════════════════════
            // Brain-1 is the MANDATORY GATEWAY for all caller turns.
            // Every utterance flows through Brain-1 before anything else.
            // Brain-1 decides actions, Brain-2 (3-Tier) provides knowledge.
            // 
            // To enable: AdminSettings.globalProductionIntelligence.brain1Enabled
            //        OR: company.agentSettings.brain1Enabled
            // ═════════════════════════════════════════════════════════════════
            
            const adminSettings = await AdminSettings.findOne({}).lean();
            const brain1Enabled = adminSettings?.globalProductionIntelligence?.brain1Enabled === true ||
                                  company?.agentSettings?.brain1Enabled === true;
            
            if (brain1Enabled) {
                logger.info('[V2 AGENT] 🧠 Using Brain-1 Runtime (new architecture)', {
                    companyId: companyID,
                    callId,
                    turn: (callState?.turnCount || 0) + 1
                });
                
                try {
                    const brain1Result = await brain1ProcessTurn(
                        companyID,
                        callId,
                        userInput,
                        callState
                    );
                    
                    logger.info('[V2 AGENT] ✅ Brain-1 turn complete', {
                        companyId: companyID,
                        callId,
                        action: brain1Result.action,
                        shouldTransfer: brain1Result.shouldTransfer,
                        shouldHangup: brain1Result.shouldHangup,
                        responseLength: brain1Result.text?.length
                    });
                    
                    // Return Brain-1 result directly
                    return {
                        text: brain1Result.text,
                        response: brain1Result.text,
                        action: brain1Result.action,
                        shouldTransfer: brain1Result.shouldTransfer,
                        shouldHangup: brain1Result.shouldHangup,
                        callState: brain1Result.callState
                    };
                    
                } catch (brain1Error) {
                    logger.error('[V2 AGENT] ❌ Brain-1 failed, falling back to legacy', {
                        companyId: companyID,
                        callId,
                        error: brain1Error.message
                    });
                    // Fall through to legacy path
                }
            } else {
                logger.info('[V2 AGENT] 🧠 Using legacy orchestration (Brain-1 disabled)', {
                    companyId: companyID,
                    callId
                });
            }
            
            // ═════════════════════════════════════════════════════════════════
            // 🎯 V22 TRIAGE: QUICK RULES (Brain-1 Tier-0 pre-check)
            // Uses TriageCard quickRuleConfig as fast-path before 3-Tier Router
            // ═════════════════════════════════════════════════════════════════
            
            try {
                const quickTriageResult = await TriageService.applyQuickTriageRules(
                    userInput,
                    companyID,
                    company.trade || null
                );

                if (quickTriageResult.matched) {
                    logger.info('[V2 AGENT] 🎯 Quick triage matched', {
                        callId,
                        triageCardId: quickTriageResult.triageCardId,
                        triageLabel: quickTriageResult.triageLabel,
                        action: quickTriageResult.action,
                        intent: quickTriageResult.intent,
                        serviceType: quickTriageResult.serviceType
                    });

                    // Attach to executionContext so Frontline-Intel / CallFlowExecutor can use it
                    executionContext.quickTriageResult = quickTriageResult;
                    
                    // If we have a linkedScenarioId, set it for Brain-5 optimization
                    if (quickTriageResult.linkedScenarioId) {
                        executionContext.forcedScenarioId = quickTriageResult.linkedScenarioId;
                    }
                } else {
                    logger.debug('[V2 AGENT] 🎯 No quick triage match', { callId });
                }
            } catch (triageErr) {
                logger.error('[V2 AGENT] ❌ Quick triage failed (non-fatal)', {
                    callId,
                    error: triageErr.message
                });
                // Continue without quick triage (graceful degradation)
            }
            
            // Execute call flow dynamically
            const contextAfterExecution = await CallFlowExecutor.execute(executionContext);
            
            logger.info('[CALL FLOW] ✅ Call flow execution complete', {
                shortCircuit: executionContext.shortCircuit,
                finalAction: executionContext.finalAction
            });
            
            // Check for short-circuit (early exit from any step)
            if (executionContext.shortCircuit) {
                logger.info('[CALL FLOW] 🔥 Short-circuit detected, returning early', {
                    response: executionContext.finalResponse?.substring(0, 100),
                    action: executionContext.finalAction
                });
                
                const shortCircuitCallState = {
                    ...callState,
                    lastInput: userInput,
                    lastResponse: executionContext.finalResponse,
                    frontlineIntel: executionContext.frontlineIntelResult,
                    triageDecision: executionContext.triageDecision,
                    shortCircuit: true,
                    turnCount: (callState.turnCount || 0) + 1
                };

                // ═════════════════════════════════════════════════════════════════
                // 📊 TRACE LOGGING: Log short-circuit turn (non-blocking)
                // ═════════════════════════════════════════════════════════════════
                const turnNumber = shortCircuitCallState.turnCount;
                const frontlineIntelResult = executionContext.frontlineIntelResult;
                
                const turnTrace = {
                    companyId: companyID,
                    callId,
                    source: 'v2AIAgentRuntime',
                    turnNumber,
                    timestamp: new Date(),

                    input: {
                        speaker: 'caller',
                        text: userInput,
                        textCleaned: frontlineIntelResult?.cleanedInput || null,
                        sttMetadata: null
                    },

                    frontlineIntel: frontlineIntelResult ? {
                        intent: frontlineIntelResult.detectedIntent || null,
                        confidence: frontlineIntelResult.confidence || null,
                        signals: {
                            customer: frontlineIntelResult.customer || {},
                            context: frontlineIntelResult.context || {},
                            triageDecision: executionContext.triageDecision || null
                        },
                        entities: null,
                        metadata: {
                            shortCircuit: true,
                            timeMs: frontlineIntelResult.timeMs || null
                        }
                    } : {},

                    orchestratorDecision: {
                        action: executionContext.finalAction || null,
                        nextPrompt: null,
                        updatedIntent: frontlineIntelResult?.detectedIntent || null,
                        updates: {},
                        knowledgeQuery: null,
                        debugNotes: 'Short-circuit: early exit from call flow'
                    },

                    knowledgeLookup: {
                        triggered: false,
                        result: null,
                        reason: null
                    },

                    bookingAction: {
                        triggered: false,
                        contactId: null,
                        locationId: null,
                        appointmentId: null,
                        result: null,
                        error: null
                    },

                    output: {
                        agentResponse: executionContext.finalResponse,
                        action: executionContext.finalAction || null,
                        nextState: shortCircuitCallState.stage || null
                    },

                    performance: {
                        frontlineIntelMs: frontlineIntelResult?.timeMs || null,
                        orchestratorMs: null,
                        knowledgeLookupMs: null,
                        bookingMs: null,
                        totalMs: null
                    },

                    cost: {
                        frontlineIntel: frontlineIntelResult?.cost || 0,
                        orchestrator: 0,
                        knowledgeLookup: 0,
                        booking: 0,
                        total: frontlineIntelResult?.cost || 0
                    },

                    contextSnapshot: {
                        currentIntent: frontlineIntelResult?.detectedIntent || null,
                        extractedData: shortCircuitCallState.collectedEntities || {},
                        conversationLength: turnNumber,
                        bookingReadiness: false
                    }
                };

                // Fire-and-forget logging (never blocks the call)
                TraceLogger.logTurn(turnTrace).catch(err => {
                    logger.error('[TRACE LOGGER] Failed to log short-circuit turn', {
                        error: err.message,
                        callId,
                        companyId: companyID,
                        turnNumber
                    });
                });
                
                return {
                    response: executionContext.finalResponse,
                    action: executionContext.finalAction,
                    callState: shortCircuitCallState,
                    confidence: executionContext.frontlineIntelResult?.confidence || 0.8,
                    frontlineIntelMeta: executionContext.frontlineIntelMeta,
                    cheatSheetMeta: executionContext.cheatSheetMeta
                };
            }
            
            // Extract results from execution context
            const finalResponse = contextAfterExecution.finalResponse;
            const finalAction = contextAfterExecution.finalAction;
            const frontlineIntelResult = contextAfterExecution.frontlineIntelResult;
            const cheatSheetMeta = contextAfterExecution.cheatSheetMeta;
            const baseResponse = contextAfterExecution.baseResponse;
            const behaviorMeta = contextAfterExecution.behaviorMeta; // V23: Behavior Engine
            
            // Update call state
            const updatedCallState = {
                ...callState,
                lastInput: userInput,
                lastResponse: finalResponse,
                turnCount: (callState.turnCount || 0) + 1,
                timestamp: new Date(),
                
                // Frontline-Intel metadata
                frontlineIntel: frontlineIntelResult ? {
                    cleanedInput: frontlineIntelResult.cleanedInput,
                    intent: frontlineIntelResult.detectedIntent,
                    confidence: frontlineIntelResult.confidence,
                    customer: frontlineIntelResult.customer,
                    context: frontlineIntelResult.context,
                    triageDecision: frontlineIntelResult.triageDecision,  // 🧠 THE BRAIN's decision
                    timeMs: frontlineIntelResult.timeMs,
                    cost: frontlineIntelResult.cost
                } : null,
                
                // Cheat Sheet metadata
                cheatSheetApplied: cheatSheetMeta !== null,
                cheatSheetMeta,
                
                // V23: Behavior Engine metadata
                behaviorMeta
            };
            
            // ─────────────────────────────────────────────────────────────
            // 💾 SESSION: Update session in hybrid cache (Phase 1)
            // ─────────────────────────────────────────────────────────────
            try {
                await SessionManager.setSession(callId, {
                    callId,
                    companyId: companyID,
                    templateId: company.aiAgentSettings?.templateId,
                    turnNumber: updatedCallState.turnCount,
                    capturedEntities: updatedCallState.collectedEntities || {},
                    lastInput: userInput,
                    lastResponse: finalResponse,
                    startedAt: callState.startTime || new Date(),
                    lastActivityAt: new Date()
                });
                
                logger.debug('[V2 AGENT] 💾 Session updated', {
                    callId,
                    turnNumber: updatedCallState.turnCount
                });
            } catch (sessionErr) {
                logger.error('[V2 AGENT] ❌ Session update failed', {
                    callId,
                    error: sessionErr.message
                });
                // Continue without session (graceful degradation)
            }

            logger.info(`✅ V2 AGENT: Final response: "${finalResponse}"`);

            // ═════════════════════════════════════════════════════════════════
            // 📚 BRAIN-5: POST-CALL LEARNING - Update memory after successful turn
            // ═════════════════════════════════════════════════════════════════
            
            try {
                await PostCallLearningService.learnFromCall({
                    companyID,
                    callState: updatedCallState,
                    matchedScenario: baseResponse?.matchedScenario || null,
                    finalAction,
                    triageResult: frontlineIntelResult?.triageDecision ? {
                        intent: frontlineIntelResult.detectedIntent,
                        category: frontlineIntelResult.triageDecision
                    } : null,
                    finalResponse,
                    userInput,
                    userInputNormalized: contextAfterExecution.userInputNormalized,
                    frontlineIntelResult,
                    callId
                });
                
                logger.debug('[V2 AGENT] 📚 Post-call learning complete', { callId });
            } catch (learningErr) {
                logger.error('[V2 AGENT] ❌ Post-call learning failed (non-fatal)', {
                    callId,
                    error: learningErr.message
                });
                // Continue - learning failures don't block calls
            }

            // ═════════════════════════════════════════════════════════════════
            // 📊 TRACE LOGGING: Log this turn for visibility (non-blocking)
            // ═════════════════════════════════════════════════════════════════
            const turnNumber = updatedCallState.turnCount || 1;
            const turnTrace = {
                companyId: companyID,
                callId,
                source: 'v2AIAgentRuntime',
                turnNumber,
                timestamp: new Date(),

                input: {
                    speaker: 'caller',
                    text: userInput,
                    textCleaned: frontlineIntelResult?.cleanedInput || null,
                    sttMetadata: null
                },

                frontlineIntel: frontlineIntelResult ? {
                    intent: frontlineIntelResult.detectedIntent || null,
                    confidence: frontlineIntelResult.confidence || null,
                    signals: {
                        customer: frontlineIntelResult.customer || {},
                        context: frontlineIntelResult.context || {}
                    },
                    entities: null,
                    metadata: {
                        triageDecision: frontlineIntelResult.triageDecision || null,
                        timeMs: frontlineIntelResult.timeMs || null
                    }
                } : {},

                orchestratorDecision: {
                    action: finalAction || null,
                    nextPrompt: null,
                    updatedIntent: frontlineIntelResult?.detectedIntent || null,
                    updates: {},
                    knowledgeQuery: null,
                    debugNotes: null
                },

                knowledgeLookup: {
                    triggered: false, // v2AIAgentRuntime doesn't use 3-tier yet
                    result: null,
                    reason: null
                },

                bookingAction: {
                    triggered: false, // will update when booking is integrated
                    contactId: null,
                    locationId: null,
                    appointmentId: null,
                    result: null,
                    error: null
                },

                output: {
                    agentResponse: finalResponse,
                    action: finalAction || null,
                    nextState: updatedCallState.stage || null
                },

                performance: {
                    frontlineIntelMs: frontlineIntelResult?.timeMs || null,
                    orchestratorMs: null,
                    knowledgeLookupMs: null,
                    bookingMs: null,
                    totalMs: null
                },

                cost: {
                    frontlineIntel: frontlineIntelResult?.cost || 0,
                    orchestrator: 0,
                    knowledgeLookup: 0,
                    booking: 0,
                    total: frontlineIntelResult?.cost || 0
                },

                contextSnapshot: {
                    currentIntent: frontlineIntelResult?.detectedIntent || null,
                    extractedData: updatedCallState.collectedEntities || {},
                    conversationLength: turnNumber,
                    bookingReadiness: false
                }
            };

            // Fire-and-forget logging (never blocks the call)
            TraceLogger.logTurn(turnTrace).catch(err => {
                logger.error('[TRACE LOGGER] Failed to log turn from v2AIAgentRuntime', {
                    error: err.message,
                    callId,
                    companyId: companyID,
                    turnNumber
                });
            });

            return {
                response: finalResponse,
                action: finalAction,
                callState: updatedCallState,
                confidence: baseResponse.confidence || 0.8,
                cheatSheetMeta,
                behaviorMeta // V23: Behavior Engine metadata (tone, styleInstructions, signals)
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
            
            // ═════════════════════════════════════════════════════════════════
            // 📊 TRACE LOGGING: Log error turn for debugging (non-blocking)
            // ═════════════════════════════════════════════════════════════════
            const turnNumber = (callState.turnCount || 0) + 1;
            const turnTrace = {
                companyId: companyID,
                callId,
                source: 'v2AIAgentRuntime',
                turnNumber,
                timestamp: new Date(),

                input: {
                    speaker: 'caller',
                    text: userInput,
                    textCleaned: null,
                    sttMetadata: null
                },

                frontlineIntel: {},

                orchestratorDecision: {
                    action: 'transfer',
                    nextPrompt: null,
                    updatedIntent: null,
                    updates: {},
                    knowledgeQuery: null,
                    debugNotes: `ERROR: ${error.message}`
                },

                knowledgeLookup: {
                    triggered: false,
                    result: null,
                    reason: null
                },

                bookingAction: {
                    triggered: false,
                    contactId: null,
                    locationId: null,
                    appointmentId: null,
                    result: null,
                    error: error.message
                },

                output: {
                    agentResponse: "I'm experiencing a technical issue. Let me connect you to our support team.",
                    action: 'transfer',
                    nextState: 'error'
                },

                performance: {
                    frontlineIntelMs: null,
                    orchestratorMs: null,
                    knowledgeLookupMs: null,
                    bookingMs: null,
                    totalMs: null
                },

                cost: {
                    frontlineIntel: 0,
                    orchestrator: 0,
                    knowledgeLookup: 0,
                    booking: 0,
                    total: 0
                },

                contextSnapshot: {
                    currentIntent: null,
                    extractedData: {},
                    conversationLength: turnNumber,
                    bookingReadiness: false
                }
            };

            // Fire-and-forget logging (never blocks the call)
            TraceLogger.logTurn(turnTrace).catch(err => {
                logger.error('[TRACE LOGGER] Failed to log error turn', {
                    error: err.message,
                    callId,
                    companyId: companyID,
                    turnNumber
                });
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
        
        const aiLogic = company.aiAgentSettings;
        
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
        
        // 🚀 V2 ENHANCED: Use AI Brain 3-Tier Intelligence for all responses
        try {
            
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
                // 🔥 CRITICAL FIX: Removed legacy companyQnA and tradeQnA (don't exist in new AI Brain system!)
                // 🔥 CRITICAL FIX #2: Changed 'templates' to 'instantResponses' (the NEW queryInstantResponses function!)
                // Router mapping: 'templates' → OLD queryTemplates() (LEGACY), 'instantResponses' → NEW queryInstantResponses() (REAL!)
                // New system: instantResponses → ScenarioPoolService → 3-tier intelligence → REAL AI BRAIN!
                priorityConfig: aiLogic.knowledgeSourcePriorities || {
                    priorityFlow: [
                        { source: 'instantResponses', priority: 1, threshold: 0.7, enabled: true }  // ← ONLY SOURCE! Tier 3 LLM is the fallback
                    ]
                }
            };
            
            logger.info(`🎯 [AI BRAIN] Routing with callSource: ${context.callSource} | Test: ${context.isTest}`);
            
            // 🔍 DIAGNOSTIC: About to call AI Brain
            logger.debug('[AI BRAIN] About to query 3-Tier Intelligence System', {
                companyId: company._id.toString(),
                userInputLength: userInput.length,
                userInputPreview: userInput.substring(0, 100)
            });
            
            const routingResult = await AIBrain3tierllm.query(company._id.toString(), userInput, context);
            
            // 🔍 DIAGNOSTIC: AI Brain returned
            logger.debug('[AI BRAIN] 3-Tier Intelligence returned', {
                success: Boolean(routingResult),
                responsePreview: routingResult?.response?.substring(0, 50),
                confidence: routingResult?.confidence
            });
            
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
                
                // V2 PURE SYSTEM: No placeholder contamination - response is pre-built
                responseText = this.buildPureResponse(responseText, company);

                // 🎯 PHASE A – STEP 3B: Include follow-up metadata for runtime use
                return {
                    text: responseText,
                    action: 'continue',
                    confidence: routingResult.confidence,
                    source: routingResult.source,
                    metadata: {
                        ...routingResult.metadata,
                        aiAgentRoleApplied: Boolean(routingResult.metadata?.aiAgentRole),
                        // 🎯 PHASE A – STEP 3B: Pass through follow-up for Twilio voice handling
                        followUp: routingResult.metadata?.followUp || {
                            mode: 'NONE',
                            questionText: null,
                            transferTarget: null
                        }
                    }
                };
            }
        } catch (knowledgeError) {
            // 🔍 DIAGNOSTIC: Full error details
            logger.error('[AI BRAIN ERROR] Knowledge routing threw error', {
                error: knowledgeError.message,
                stack: knowledgeError.stack
            });
            
            logger.warn(`[V2 KNOWLEDGE] ⚠️ Knowledge routing failed, using fallback:`, knowledgeError.message);
            logger.error(`[V2 KNOWLEDGE] Full error:`, knowledgeError);
        }
        
        // 🔥 NO FALLBACK TEXT! If AI Brain fails, transfer to human immediately
        // The ONLY fallback is LLM (Tier 3), which already ran and failed
        logger.error('🚨 [V2 AGENT] AI Brain completely failed, must transfer to human', {
            companyId: company._id,
            userInput: userInput.substring(0, 100)
        });

        return {
            text: null,  // ❌ NO GENERIC TEXT!
            action: 'transfer',  // Must transfer to human
            confidence: 0,
            source: 'ai-brain-critical-failure'
        };
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
        if (company.aiAgentSettings?.placeholders && Array.isArray(company.aiAgentSettings.placeholders)) {
            logger.info(`🔧 [PLACEHOLDERS] Replacing ${company.aiAgentSettings.placeholders.length} placeholders in AI role response`);
            company.aiAgentSettings.placeholders.forEach(placeholder => {
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

/**
 * 🎯 BLUEPRINT COMPLIANCE: AI Configuration Loader
 * Loads all AI agent configurations by companyID with Redis cache
 * Part of the production-ready AI Agent Logic system
 */

const Company = require('../../models/Company');
const AgentConfigSnapshot = require('../models/AgentConfigSnapshot');
const { buildCompiledConfig } = require('../services/aiConfigAssembler');
const { getDefaultPreset, applyPresetToCompanyDoc } = require('../../services/presets');
const { PRESETS_V1, PUBLISH_V1 } = require('../../config/flags');
const effectiveConfigService = require('../../../server/services/effectiveConfigService');
const { LIVE_RESOLVER_V1 } = require('../../config/flags');

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
            // Phase 8: Prefer published snapshot when PUBLISH_V1 is enabled
            if (PUBLISH_V1) {
                const snapshot = await AgentConfigSnapshot.getLatest(companyID);
                if (snapshot?.data) {
                    console.log(`📸 Using published config snapshot v${snapshot.version} for company: ${companyID}`);
                    const snapshotConfig = {
                        ...snapshot.data,
                        companyID,
                        loadedFrom: 'snapshot',
                        snapshotVersion: snapshot.version,
                        snapshotCreatedAt: snapshot.createdAt
                    };
                    
                    // Cache the snapshot
                    this.cache.set(cacheKey, {
                        data: snapshotConfig,
                        timestamp: Date.now()
                    });
                    
                    return snapshotConfig;
                }
                console.log(`📸 No published snapshot found for company: ${companyID}, falling back to dynamic compilation`);
            }

            let company = await Company.findById(companyID);
            if (!company) {
                throw new Error(`Company not found: ${companyID}`);
            }

            // Apply preset defaults if company has minimal configuration and presets are enabled
            if (PRESETS_V1 && this.needsPresetDefaults(company)) {
                const defaultPreset = getDefaultPreset();
                if (defaultPreset) {
                    console.log(`🎯 Applying default preset to company ${companyID} (minimal config detected)`);
                    // Use the preset ID from flags.PRESET_DEFAULT 
                    const { PRESET_DEFAULT } = require('../../config/flags');
                    company = applyPresetToCompanyDoc(company.toObject(), PRESET_DEFAULT);
                }
            }

            const aiLogic = company.aiAgentLogic || {};
            
            // Phase 8: Use the new assembler for consistent config structure
            let compiledConfig = buildCompiledConfig(company.toObject ? company.toObject() : company);
            
            // If live resolver is enabled, prefer using resolved effective settings for key modules
            if (LIVE_RESOLVER_V1) {
                try {
                    const effective = await effectiveConfigService.getEffectiveSettings(companyID);
                    if (effective && effective.config) {
                        console.log(`🧭 Using LIVE_RESOLVER_V1 effective settings for company ${companyID}`);
                        // Map effective config back into compiled shape where possible
                        compiledConfig = Object.assign({}, compiledConfig, effective.config);
                    }
                } catch (resolverErr) {
                    console.warn('[AIConfigLoader] Live resolver failed, falling back to compiled config:', resolverErr.message);
                }
            }

            // Build comprehensive configuration per Blueprint (merging new assembler with legacy fields)
            const config = {
                companyID,
                companyName: company.companyName || company.name,
                
                // Phase 8: Use compiled config as base
                ...compiledConfig,
                
                // Legacy fields for backward compatibility
                answerPriority: compiledConfig.routing.priority,
                
                // Confidence Thresholds (legacy compatibility - merge with compiled)
                thresholds: {
                    companyKB: compiledConfig.knowledge.thresholds.companyQnA,
                    tradeQA: compiledConfig.knowledge.thresholds.tradeQnA,
                    vector: compiledConfig.knowledge.thresholds.vectorSearch,
                    llmFallback: 0.60,
                    ...aiLogic.thresholds
                },
                
                // Memory Configuration
                memory: {
                    mode: "conversational",
                    retentionMinutes: 30,
                    ...aiLogic.memory
                },
                
                // Escalation Rules
                escalation: {
                    onNoMatch: true,
                    strategy: "ask-confirm",
                    ...aiLogic.escalation
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
                
                // Metadata (merge with compiled config meta)
                version: aiLogic.version || 1,
                lastUpdated: aiLogic.lastUpdated || new Date(),
                loadedFrom: 'dynamic_compilation',
                
                // Phase 8 metadata (override compiled meta to show this was dynamically compiled)
                meta: {
                    ...compiledConfig.meta,
                    loadedFrom: 'dynamic_compilation',
                    fallbackMode: !PUBLISH_V1 ? 'flag_disabled' : 'no_snapshot',
                    legacyCompatible: true,
                }
            };

            // Apply presets if available
            if (company.presetID && PRESETS_V1.includes(company.presetID)) {
                const preset = await getDefaultPreset(company.presetID);
                applyPresetToCompanyDoc(company, preset);
            }

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

    /**
     * Check if company needs preset defaults (has minimal configuration)
     * @param {Object} company - Company document
     * @returns {boolean} True if preset defaults should be applied
     */
    needsPresetDefaults(company) {
        // If preset was already applied, don't apply again
        if (company.appliedPreset) {
            return false;
        }
        
        // Check if company has minimal configuration
        const hasBasicInstructions = company.agentInstructions && company.agentInstructions.length > 50;
        const hasCompanyInfo = company.companyInfo && Object.keys(company.companyInfo).length > 0;
        const hasFallbackSettings = company.fallbackSettings && Object.keys(company.fallbackSettings).length > 0;
        
        // If missing key configuration, apply preset defaults
        return !hasBasicInstructions || !hasCompanyInfo || !hasFallbackSettings;
    }
}

// Export singleton instance
module.exports = new AIConfigLoader();

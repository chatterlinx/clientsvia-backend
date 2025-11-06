/**
 * ============================================================================
 * RUNTIME INTELLIGENCE CONFIG SERVICE
 * ============================================================================
 * 
 * PURPOSE: Load correct intelligence config at runtime based on call source
 * 
 * CRITICAL INTEGRATION POINT:
 * This is the glue that connects:
 * - Test Pilot Intelligence Settings (AdminSettings.testPilotIntelligence)
 * - Company Production Intelligence (company.aiAgentLogic.productionIntelligence)
 * - Runtime Tier 1/2/3 matching (IntelligentRouter.js)
 * - Cost tracking (todaysCost.amount, todaysCost.tier3Calls)
 * - LLM Learning Console (ProductionLLMSuggestion generation)
 * 
 * CALL SOURCES:
 * - 'test-pilot-template': Template Testing (uses AdminSettings)
 * - 'test-pilot-company': Company Testing (uses company settings)
 * - 'production': Real customer calls (uses company settings)
 * 
 * ============================================================================
 */

const AdminSettings = require('../models/AdminSettings');
const ProductionLLMSuggestion = require('../models/ProductionLLMSuggestion');
const logger = require('../utils/logger');

class RuntimeIntelligenceConfig {
    
    /**
     * ================================================================
     * DETECT CALL SOURCE
     * ================================================================
     * Determines if this is a test call or production call
     * 
     * @param {Object} company - Company object
     * @param {String} phoneNumber - Incoming phone number
     * @param {Object} adminSettings - AdminSettings (cached)
     * @returns {String} 'test-pilot-template' | 'test-pilot-company' | 'production'
     */
    static detectCallSource(company, phoneNumber, adminSettings) {
        logger.debug(`[RUNTIME CONFIG] Detecting call source for ${phoneNumber}`);
        
        // Check if phone number matches Test Pilot (Template Testing)
        if (adminSettings?.testMode?.phoneNumber === phoneNumber && 
            adminSettings?.testMode?.enabled) {
            logger.info(`[RUNTIME CONFIG] ✅ Call source: TEST-PILOT-TEMPLATE (${phoneNumber})`);
            return 'test-pilot-template';
        }
        
        // Check if phone number matches Company Testing
        if (adminSettings?.companyTestMode?.phoneNumber === phoneNumber && 
            adminSettings?.companyTestMode?.enabled) {
            logger.info(`[RUNTIME CONFIG] ✅ Call source: TEST-PILOT-COMPANY (${phoneNumber})`);
            return 'test-pilot-company';
        }
        
        // Default: Production call
        logger.info(`[RUNTIME CONFIG] ✅ Call source: PRODUCTION (${phoneNumber})`);
        return 'production';
    }
    
    /**
     * ================================================================
     * GET INTELLIGENCE CONFIG
     * ================================================================
     * Load correct intelligence config based on call source
     * 
     * @param {String} callSource - 'test-pilot-template' | 'test-pilot-company' | 'production'
     * @param {Object} company - Company object
     * @returns {Object} Intelligence config with thresholds, llmModel, etc.
     */
    static async getIntelligenceConfig(callSource, company) {
        logger.info(`[RUNTIME CONFIG] Loading intelligence config for call source: ${callSource}`);
        
        try {
            if (callSource === 'test-pilot-template') {
                // Template Testing: Use Test Pilot Intelligence settings
                const adminSettings = await AdminSettings.findOne({});
                const testPilotConfig = adminSettings?.testPilotIntelligence || {};
                
                logger.info(`[RUNTIME CONFIG] ✅ Loaded Test Pilot Intelligence:`, {
                    preset: testPilotConfig.preset || 'balanced',
                    tier1: testPilotConfig.thresholds?.tier1 || 0.80,
                    tier2: testPilotConfig.thresholds?.tier2 || 0.60,
                    model: testPilotConfig.llmConfig?.model || 'gpt-4o-mini'
                });
                
                return {
                    source: 'test-pilot',
                    preset: testPilotConfig.preset || 'balanced',
                    thresholds: {
                        tier1: testPilotConfig.thresholds?.tier1 || 0.80,
                        tier2: testPilotConfig.thresholds?.tier2 || 0.60,
                        enableTier3: true // Test Pilot always enables Tier 3 for learning
                    },
                    llmConfig: {
                        model: testPilotConfig.llmConfig?.model || 'gpt-4o-mini',
                        maxCostPerCall: testPilotConfig.llmConfig?.maxCostPerCall || 0.50,
                        contextWindow: testPilotConfig.llmConfig?.contextWindow || 'standard',
                        autoApply: testPilotConfig.llmConfig?.autoApply || 'manual'
                    },
                    costTracking: {
                        enabled: true,
                        trackingPath: 'AdminSettings.testPilotIntelligence.todaysCost'
                    }
                };
            }
            
            if (callSource === 'test-pilot-company' || callSource === 'production') {
                // ============================================================
                // CHECK INHERITANCE FLAG: Global vs Custom Intelligence
                // ============================================================
                const useGlobal = company?.aiAgentLogic?.useGlobalIntelligence !== false; // Default: true
                
                if (useGlobal) {
                    // GLOBAL: Load from AdminSettings.globalProductionIntelligence
                    const adminSettings = await AdminSettings.findOne({});
                    const globalConfig = adminSettings?.globalProductionIntelligence || {};
                    
                    logger.info(`[RUNTIME CONFIG] 🌐 Using GLOBAL Production Intelligence:`, {
                        tier1: globalConfig.thresholds?.tier1 || 0.80,
                        tier2: globalConfig.thresholds?.tier2 || 0.60,
                        enableTier3: globalConfig.thresholds?.enableTier3 !== false,
                        model: globalConfig.llmConfig?.model || 'gpt-4o-mini',
                        warmupEnabled: globalConfig.smartWarmup?.enabled || false
                    });
                    
                    return {
                        source: 'global-intelligence',
                        thresholds: {
                            tier1: globalConfig.thresholds?.tier1 || 0.80,
                            tier2: globalConfig.thresholds?.tier2 || 0.60,
                            enableTier3: globalConfig.thresholds?.enableTier3 !== false
                        },
                        llmConfig: {
                            model: globalConfig.llmConfig?.model || 'gpt-4o-mini',
                            maxCostPerCall: globalConfig.llmConfig?.maxCostPerCall || 0.10,
                            dailyBudget: globalConfig.llmConfig?.dailyBudget || null
                        },
                        smartWarmup: {
                            enabled: globalConfig.smartWarmup?.enabled || false,
                            confidenceThreshold: globalConfig.smartWarmup?.confidenceThreshold || 0.75,
                            dailyBudget: globalConfig.smartWarmup?.dailyBudget || 5.00,
                            enablePatternLearning: globalConfig.smartWarmup?.enablePatternLearning !== false,
                            minimumHitRate: globalConfig.smartWarmup?.minimumHitRate || 0.30,
                            alwaysWarmupCategories: globalConfig.smartWarmup?.alwaysWarmupCategories || [],
                            neverWarmupCategories: globalConfig.smartWarmup?.neverWarmupCategories || []
                        },
                        costTracking: {
                            enabled: callSource === 'production', // Only track costs for real calls
                            trackingPath: 'AdminSettings.globalProductionIntelligence.todaysCost'
                        }
                    };
                } else {
                    // CUSTOM: Load from company.aiAgentLogic.productionIntelligence
                    const productionConfig = company?.aiAgentLogic?.productionIntelligence || {};
                    
                    logger.info(`[RUNTIME CONFIG] 🎯 Using CUSTOM Company Intelligence:`, {
                        tier1: productionConfig.thresholds?.tier1 || 0.80,
                        tier2: productionConfig.thresholds?.tier2 || 0.60,
                        model: productionConfig.llmConfig?.model || 'gpt-4o-mini',
                        warmupEnabled: productionConfig.smartWarmup?.enabled || false
                    });
                    
                    return {
                        source: 'custom-company-intelligence',
                        thresholds: {
                            tier1: productionConfig.thresholds?.tier1 || 0.80,
                            tier2: productionConfig.thresholds?.tier2 || 0.60,
                            enableTier3: productionConfig.thresholds?.enableTier3 !== false
                        },
                        llmConfig: {
                            model: productionConfig.llmConfig?.model || 'gpt-4o-mini',
                            maxCostPerCall: productionConfig.llmConfig?.maxCostPerCall || 0.10,
                            dailyBudget: productionConfig.llmConfig?.dailyBudget || null
                        },
                        smartWarmup: {
                            enabled: productionConfig.smartWarmup?.enabled || false,
                            confidenceThreshold: productionConfig.smartWarmup?.confidenceThreshold || 0.75,
                            dailyBudget: productionConfig.smartWarmup?.dailyBudget || 5.00,
                            enablePatternLearning: productionConfig.smartWarmup?.enablePatternLearning !== false,
                            minimumHitRate: productionConfig.smartWarmup?.minimumHitRate || 0.30,
                            alwaysWarmupCategories: productionConfig.smartWarmup?.alwaysWarmupCategories || [],
                            neverWarmupCategories: productionConfig.smartWarmup?.neverWarmupCategories || []
                        },
                        costTracking: {
                            enabled: callSource === 'production', // Only track costs for real calls
                            trackingPath: 'company.aiAgentLogic.productionIntelligence.todaysCost'
                        }
                    };
                }
            }
            
            // Fallback: Default settings
            logger.warn(`[RUNTIME CONFIG] ⚠️ Unknown call source, using defaults`);
            return this.getDefaultConfig();
            
        } catch (error) {
            logger.error(`[RUNTIME CONFIG] ❌ Error loading intelligence config:`, error);
            return this.getDefaultConfig();
        }
    }
    
    /**
     * ================================================================
     * TRACK TIER 3 COST
     * ================================================================
     * Increment cost tracking when Tier 3 LLM is called
     * 
     * 🔥 CRITICAL: Cost tracking paths
     * - Template Testing → AdminSettings.testPilotIntelligence.todaysCost
     * - Company Testing → LLM Learning Console (ProductionLLMSuggestion records)
     * - Production Calls → LLM Learning Console (ProductionLLMSuggestion records)
     * 
     * @param {String} callSource - Call source
     * @param {Object} company - Company object
     * @param {Number} cost - LLM call cost in USD
     * @param {String} llmModel - Model used
     */
    static async trackTier3Cost(callSource, company, cost, llmModel) {
        logger.info(`[RUNTIME CONFIG] 💰 Tracking Tier 3 cost: $${cost.toFixed(4)} (${llmModel})`);
        
        try {
            if (callSource === 'test-pilot-template') {
                // Template Testing: Track to Test Pilot Intelligence dashboard
                const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                
                await AdminSettings.findOneAndUpdate(
                    {},
                    {
                        $inc: {
                            'testPilotIntelligence.todaysCost.amount': cost,
                            'testPilotIntelligence.todaysCost.tier3Calls': 1
                        },
                        $set: {
                            'testPilotIntelligence.todaysCost.date': today
                        }
                    },
                    { upsert: true }
                );
                
                logger.info(`[RUNTIME CONFIG] ✅ Cost tracked to Test Pilot Intelligence dashboard`);
            }
            
            // 🔥 Company Testing + Production: Costs are tracked via ProductionLLMSuggestion records!
            // The LLM Learning Console aggregates costs from suggestion records.
            // No need for separate cost tracking here - it's automatic via suggestion.cost field!
            if (callSource === 'test-pilot-company' || callSource === 'production') {
                logger.info(`[RUNTIME CONFIG] ✅ Cost will be tracked via LLM Learning Console (suggestion.cost = $${cost.toFixed(4)})`);
            }
            
        } catch (error) {
            logger.error(`[RUNTIME CONFIG] ❌ Error tracking cost:`, error);
            // Don't throw - cost tracking failure shouldn't break the call
        }
    }
    
    /**
     * ================================================================
     * GENERATE LLM SUGGESTION
     * ================================================================
     * Create ProductionLLMSuggestion record when Tier 3 is triggered
     * 
     * 🔥 CRITICAL: This is where the LLM Learning magic happens!
     * 
     * GENERATES SUGGESTIONS FOR:
     * ✅ Company Testing (Test Pilot → Company mode)
     * ✅ Production Calls (Real customers)
     * 
     * SKIPS SUGGESTIONS FOR:
     * ❌ Template Testing (Test Pilot → Template mode)
     * 
     * @param {Object} params - Suggestion parameters
     */
    static async generateLLMSuggestion(params) {
        const {
            callSource,
            company,
            template,
            userInput,
            tier1Score,
            tier2Score,
            llmResponse,
            llmModel,
            cost,
            phoneNumber
        } = params;
        
        logger.info(`[RUNTIME CONFIG] 💡 Generating LLM suggestion for call source: ${callSource}`);
        
        try {
            // 🔥 THE MAGIC: Generate suggestions for Company Testing + Production
            // These both use the SAME production settings and feed the LLM Learning Console!
            if (callSource !== 'production' && callSource !== 'test-pilot-company') {
                logger.info(`[RUNTIME CONFIG] ⏭️ Skipping suggestion for ${callSource} (Template Testing doesn't generate suggestions)`);
                return;
            }
            
            logger.info(`[RUNTIME CONFIG] 🔥 Generating suggestion for LLM Learning Console (${callSource})`);
            
            
            // Analyze what trigger/synonym is missing
            const analysisResult = this.analyzeMissingTrigger(userInput, template);
            
            if (!analysisResult) {
                logger.info(`[RUNTIME CONFIG] ⏭️ No clear suggestion detected`);
                return;
            }
            
            // Determine priority based on tier scores
            let priority = 'low';
            if (tier2Score >= 0.50) {
                priority = 'high'; // Close match, definitely add it
            } else if (tier2Score >= 0.35) {
                priority = 'medium';
            }
            
            // Create suggestion
            const suggestion = await ProductionLLMSuggestion.create({
                templateId: template._id,
                templateName: template.name,
                companyId: company._id,
                companyName: company.companyName || company.businessName || 'Unknown',
                suggestionType: analysisResult.type,
                suggestion: analysisResult.suggestion,
                suggestedValue: analysisResult.value,
                targetCategory: analysisResult.category,
                targetScenario: analysisResult.scenario,
                confidence: Math.max(tier2Score, 0.50), // Use Tier 2 score as confidence
                priority,
                impactScore: Math.round((1 - tier2Score) * 100), // Higher impact if score was very low
                customerPhrase: userInput.substring(0, 500),
                tier1Score,
                tier2Score,
                llmResponse: llmResponse?.substring(0, 1000),
                callDate: new Date(),
                phoneNumber,
                llmModel,
                cost,
                estimatedMonthlySavings: this.estimateSavings(priority),
                status: 'pending'
            });
            
            logger.info(`[RUNTIME CONFIG] ✅ LLM Suggestion created:`, {
                id: suggestion._id,
                type: suggestion.suggestionType,
                value: suggestion.suggestedValue,
                priority: suggestion.priority
            });
            
            return suggestion;
            
        } catch (error) {
            logger.error(`[RUNTIME CONFIG] ❌ Error generating suggestion:`, error);
            // Don't throw - suggestion generation failure shouldn't break the call
        }
    }
    
    /**
     * ================================================================
     * ANALYZE MISSING TRIGGER
     * ================================================================
     * Simple heuristic to detect what trigger/synonym is missing
     */
    static analyzeMissingTrigger(userInput, template) {
        // Simple heuristic: Extract key phrases (2-4 words)
        const words = userInput.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
        if (words.length >= 2) {
            // Try 2-word phrases first
            for (let i = 0; i < words.length - 1; i++) {
                const phrase = `${words[i]} ${words[i+1]}`;
                return {
                    type: 'trigger',
                    suggestion: `Add trigger: "${phrase}"`,
                    value: phrase,
                    category: null, // Would need NLP to determine
                    scenario: null
                };
            }
        }
        
        return null;
    }
    
    /**
     * ================================================================
     * ESTIMATE SAVINGS
     * ================================================================
     * Estimate monthly savings if this suggestion is applied
     */
    static estimateSavings(priority) {
        // Rough estimates based on priority
        const savingsMap = {
            high: 50.00,    // High-impact suggestions save $50/month
            medium: 20.00,  // Medium-impact suggestions save $20/month
            low: 5.00       // Low-impact suggestions save $5/month
        };
        
        return savingsMap[priority] || 10.00;
    }
    
    /**
     * ================================================================
     * GET DEFAULT CONFIG
     * ================================================================
     * Fallback configuration if all else fails
     */
    static getDefaultConfig() {
        return {
            source: 'default-fallback',
            thresholds: {
                tier1: 0.80,
                tier2: 0.60,
                enableTier3: true
            },
            llmConfig: {
                model: 'gpt-4o-mini',
                maxCostPerCall: 0.10
            },
            costTracking: {
                enabled: false
            }
        };
    }
}

module.exports = RuntimeIntelligenceConfig;


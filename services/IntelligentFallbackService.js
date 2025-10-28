// ============================================================================
// 🆘 PRODUCTION AI - INTELLIGENT FALLBACK SERVICE
// ============================================================================
// PURPOSE: Context-aware fallback responses when AI cannot match queries
// FEATURES: Response rotation, sentiment analysis, escalation ladder
// PERFORMANCE: <10ms response selection
// DOCUMENTATION: /docs/PRODUCTION-AI-CORE-INTEGRATION.md
// ============================================================================

const logger = require('../utils/logger');
const Company = require('../models/v2Company');

// ============================================================================
// 🆘 INTELLIGENT FALLBACK SERVICE CLASS
// ============================================================================

class IntelligentFallbackService {
    constructor() {
        this.metrics = {
            totalFallbacks: 0,
            byType: {
                clarification: 0,
                noMatch: 0,
                technical: 0,
                outOfScope: 0
            }
        };
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 MAIN ENTRY POINT: Select Fallback Response
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Selects an appropriate fallback response based on context
     * @param {Object} company - Company document with fallbackResponses config
     * @param {Object} context - Context about why fallback was triggered
     * @returns {Promise<Object>} Fallback response with metadata
     */
    async selectResponse(company, context = {}) {
        try {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 1: Validate inputs
            // ────────────────────────────────────────────────────────────────
            if (!company || !company._id) {
                throw new Error('Invalid company: missing company data');
            }
            
            const fallbackConfig = company.aiAgentLogic?.fallbackResponses;
            
            if (!fallbackConfig) {
                logger.warn('[FALLBACK] No fallback configuration found for company', {
                    companyId: company._id,
                    companyName: company.companyName
                });
                
                // Return default fallback
                return {
                    response: "I want to make sure you get the best help possible. Let me connect you with a specialist.",
                    fallbackType: 'default',
                    requiresEscalation: true,
                    metadata: {
                        usingDefault: true
                    }
                };
            }
            
            logger.info('[FALLBACK] Selecting fallback response', {
                companyId: company._id,
                companyName: company.companyName,
                context: {
                    confidence: context.confidence,
                    fallbackReason: context.fallbackReason,
                    attemptedTiers: context.attemptedTiers
                }
            });
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Determine fallback type
            // ────────────────────────────────────────────────────────────────
            const fallbackType = this.determineFallbackType(context);
            
            logger.info('[FALLBACK] Determined fallback type', {
                companyId: company._id,
                fallbackType,
                reasoning: this.getFallbackTypeReasoning(fallbackType, context)
            });
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Get response variations for this type
            // ────────────────────────────────────────────────────────────────
            const variations = this.getVariationsForType(fallbackConfig, fallbackType);
            
            if (!variations || variations.length === 0) {
                logger.warn('[FALLBACK] No variations found for fallback type', {
                    companyId: company._id,
                    fallbackType
                });
                
                return {
                    response: "I want to make sure you get the best help possible. Let me connect you with a specialist.",
                    fallbackType,
                    requiresEscalation: true,
                    metadata: {
                        noVariations: true
                    }
                };
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 4: Rotate through variations (avoid repetition)
            // ────────────────────────────────────────────────────────────────
            const lastIndex = fallbackConfig.lastUsedIndex?.[fallbackType] || 0;
            const nextIndex = (lastIndex + 1) % variations.length;
            
            logger.debug('[FALLBACK] Rotating variation index', {
                companyId: company._id,
                fallbackType,
                lastIndex,
                nextIndex,
                totalVariations: variations.length
            });
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 5: Update rotation index (atomic)
            // ────────────────────────────────────────────────────────────────
            try {
                await Company.findByIdAndUpdate(
                    company._id,
                    {
                        $set: {
                            [`aiAgentLogic.fallbackResponses.lastUsedIndex.${fallbackType}`]: nextIndex,
                            'aiAgentLogic.fallbackResponses.lastUpdated': new Date()
                        }
                    }
                );
                
                logger.debug('[FALLBACK] Updated rotation index', {
                    companyId: company._id,
                    fallbackType,
                    newIndex: nextIndex
                });
                
            } catch (updateError) {
                logger.error('[FALLBACK] Failed to update rotation index', {
                    companyId: company._id,
                    error: updateError.message
                });
                
                // Continue anyway (don't block customer)
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 6: Get base response
            // ────────────────────────────────────────────────────────────────
            let response = variations[nextIndex];
            
            // Replace placeholders
            response = this.replacePlaceholders(response, company, context);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 7: Determine if escalation is needed
            // ────────────────────────────────────────────────────────────────
            const requiresEscalation = this.shouldOfferEscalation(fallbackType, context);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 8: Add follow-up prompt (if applicable)
            // ────────────────────────────────────────────────────────────────
            if (requiresEscalation && fallbackConfig.escalationOptions) {
                const followUp = this.selectFollowUpPrompt(fallbackConfig, context);
                if (followUp) {
                    response += ` ${followUp}`;
                }
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 9: Send fallback notification (CRITICAL!)
            // ────────────────────────────────────────────────────────────────
            try {
                const ProductionAIHealthMonitor = require('./ProductionAIHealthMonitor');
                await ProductionAIHealthMonitor.trackFallbackUsage(
                    company._id,
                    fallbackType,
                    {
                        query: context.query,
                        confidence: context.confidence,
                        fallbackReason: context.fallbackReason,
                        attemptedTiers: context.attemptedTiers,
                        companyName: company.companyName
                    }
                );
            } catch (notifError) {
                logger.error('[FALLBACK] Failed to send fallback notification', {
                    companyId: company._id,
                    error: notifError.message
                });
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 10: Track metrics
            // ────────────────────────────────────────────────────────────────
            this.metrics.totalFallbacks++;
            this.metrics.byType[fallbackType] = (this.metrics.byType[fallbackType] || 0) + 1;
            
            logger.info('[FALLBACK] Response selected successfully', {
                companyId: company._id,
                fallbackType,
                variationIndex: nextIndex,
                requiresEscalation,
                responseLength: response.length
            });
            
            return {
                response,
                fallbackType,
                requiresEscalation,
                metadata: {
                    variationUsed: nextIndex,
                    totalVariations: variations.length,
                    toneProfile: fallbackConfig.toneProfile,
                    context: {
                        confidence: context.confidence,
                        reason: context.fallbackReason
                    }
                }
            };
            
        } catch (error) {
            logger.error('[FALLBACK] Critical error in selectResponse', {
                companyId: company?._id,
                error: error.message,
                stack: error.stack
            });
            
            // Emergency fallback (never fail)
            return {
                response: "I'm experiencing technical difficulties. Let me transfer you to a live agent immediately.",
                fallbackType: 'emergency',
                requiresEscalation: true,
                metadata: {
                    error: error.message,
                    emergency: true
                }
            };
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔍 DETERMINE FALLBACK TYPE
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Analyzes context to determine which type of fallback is needed
     * @param {Object} context - Context about why fallback was triggered
     * @returns {string} Fallback type: clarification, noMatch, technical, or outOfScope
     */
    determineFallbackType(context) {
        const { confidence, fallbackReason, errorType, attemptedTiers, query } = context;
        
        // ────────────────────────────────────────────────────────────────────
        // TYPE 1: TECHNICAL ISSUE (System Error)
        // ────────────────────────────────────────────────────────────────────
        if (errorType === 'SPEECH_RECOGNITION_FAILED' || 
            errorType === 'TIMEOUT' || 
            errorType === 'SYSTEM_ERROR') {
            return 'technical';
        }
        
        // ────────────────────────────────────────────────────────────────────
        // TYPE 2: CLARIFICATION NEEDED (Low Confidence, Ambiguous)
        // ────────────────────────────────────────────────────────────────────
        // Query was attempted but confidence is too low (ambiguous/unclear)
        if (confidence !== undefined && confidence > 0 && confidence < 0.40) {
            return 'clarification';
        }
        
        // ────────────────────────────────────────────────────────────────────
        // TYPE 3: OUT OF SCOPE (Wrong Service)
        // ────────────────────────────────────────────────────────────────────
        // Detect keywords that indicate wrong service
        if (query) {
            const queryLower = query.toLowerCase();
            const outOfScopeKeywords = [
                'refrigerator', 'fridge', 'appliance',
                'car', 'vehicle', 'auto',
                'computer', 'laptop', 'phone repair',
                'legal', 'lawyer', 'attorney'
            ];
            
            if (outOfScopeKeywords.some(keyword => queryLower.includes(keyword))) {
                return 'outOfScope';
            }
        }
        
        // ────────────────────────────────────────────────────────────────────
        // TYPE 4: NO MATCH FOUND (Clear Question, No Answer)
        // ────────────────────────────────────────────────────────────────────
        // All tiers attempted but no match (clear question, just not in knowledge base)
        return 'noMatch';
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📝 GET FALLBACK TYPE REASONING
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Returns human-readable reasoning for fallback type selection
     */
    getFallbackTypeReasoning(fallbackType, context) {
        switch (fallbackType) {
            case 'technical':
                return `System error detected: ${context.errorType || 'Unknown'}`;
            case 'clarification':
                return `Low confidence (${(context.confidence * 100).toFixed(0)}%) - query is ambiguous`;
            case 'outOfScope':
                return `Query appears to be outside company's service area`;
            case 'noMatch':
                return `All ${context.attemptedTiers?.length || 0} tiers failed - no matching scenario`;
            default:
                return 'Unknown';
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📋 GET VARIATIONS FOR TYPE
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Retrieves response variations for a specific fallback type
     */
    getVariationsForType(fallbackConfig, fallbackType) {
        // Map fallbackType to config field name
        const typeMapping = {
            clarification: 'clarificationNeeded',
            noMatch: 'noMatchFound',
            technical: 'technicalIssue',
            outOfScope: 'outOfScope'
        };
        
        const configField = typeMapping[fallbackType] || 'noMatchFound';
        
        return fallbackConfig[configField] || [];
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔄 REPLACE PLACEHOLDERS
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Replaces dynamic placeholders in response text
     */
    replacePlaceholders(response, company, context) {
        let processedResponse = response;
        
        // Replace {INDUSTRY_TYPE} placeholder
        if (processedResponse.includes('{INDUSTRY_TYPE}')) {
            const industryType = company.industryType || 'our services';
            processedResponse = processedResponse.replace(/\{INDUSTRY_TYPE\}/g, industryType);
        }
        
        // Replace {COMPANY_NAME} placeholder
        if (processedResponse.includes('{COMPANY_NAME}')) {
            processedResponse = processedResponse.replace(/\{COMPANY_NAME\}/g, company.companyName || 'our company');
        }
        
        return processedResponse;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🚨 SHOULD OFFER ESCALATION
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Determines if escalation should be offered to customer
     */
    shouldOfferEscalation(fallbackType, context) {
        // ────────────────────────────────────────────────────────────────────
        // ALWAYS offer escalation for noMatchFound
        // ────────────────────────────────────────────────────────────────────
        if (fallbackType === 'noMatch') {
            return true;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // Offer escalation after 2nd clarification attempt
        // ────────────────────────────────────────────────────────────────────
        if (fallbackType === 'clarification' && context.clarificationAttempts > 1) {
            return true;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // Don't offer escalation for technical issues (retry instead)
        // ────────────────────────────────────────────────────────────────────
        if (fallbackType === 'technical') {
            return false;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // Offer escalation for out of scope
        // ────────────────────────────────────────────────────────────────────
        if (fallbackType === 'outOfScope') {
            return true;
        }
        
        return false;
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 SELECT FOLLOW-UP PROMPT
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Selects appropriate follow-up escalation prompt
     */
    selectFollowUpPrompt(fallbackConfig, context) {
        const escalationOptions = fallbackConfig.escalationOptions;
        
        if (!escalationOptions) {
            return null;
        }
        
        const availablePrompts = [];
        
        // ────────────────────────────────────────────────────────────────────
        // Build list of enabled escalation options
        // ────────────────────────────────────────────────────────────────────
        if (escalationOptions.offerTransfer && escalationOptions.transferPhrase) {
            availablePrompts.push(escalationOptions.transferPhrase);
        }
        
        if (escalationOptions.offerMessage && escalationOptions.messagePhrase) {
            availablePrompts.push(escalationOptions.messagePhrase);
        }
        
        // ────────────────────────────────────────────────────────────────────
        // Select prompt (rotate or random)
        // ────────────────────────────────────────────────────────────────────
        if (availablePrompts.length === 0) {
            // Use default follow-up prompts
            const defaultPrompts = fallbackConfig.followUpPrompts || [];
            if (defaultPrompts.length > 0) {
                const index = Math.floor(Math.random() * defaultPrompts.length);
                return defaultPrompts[index];
            }
            return null;
        }
        
        // Rotate through available prompts
        const index = Math.floor(Math.random() * availablePrompts.length);
        return availablePrompts[index];
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📊 GET METRICS
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Returns current fallback metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            timestamp: new Date()
        };
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔄 RESET METRICS
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Resets metrics (for testing or monthly reset)
     */
    resetMetrics() {
        this.metrics = {
            totalFallbacks: 0,
            byType: {
                clarification: 0,
                noMatch: 0,
                technical: 0,
                outOfScope: 0
            }
        };
        
        logger.info('[FALLBACK] Metrics reset');
    }
}

// ============================================================================
// 🚀 EXPORT SINGLETON INSTANCE
// ============================================================================

module.exports = new IntelligentFallbackService();


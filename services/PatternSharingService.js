/**
 * ============================================================================
 * PATTERN SHARING SERVICE - CROSS-TEMPLATE INTELLIGENCE DISTRIBUTION
 * ============================================================================
 * 
 * PURPOSE:
 * Handles the 3-level sharing system:
 * 1. Template-Only (default): Patterns stay within originating template
 * 2. Industry-Wide (optional): Share with templates in same industry
 * 3. Global (admin approval): Share with ALL templates platform-wide
 * 
 * BUSINESS VALUE:
 * - Accelerates learning across similar templates
 * - HVAC templates teach each other (industry sharing)
 * - Universal patterns (fillers) benefit everyone (global sharing)
 * - Quality control via admin approval
 * 
 * ============================================================================
 */

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const SuggestionKnowledgeBase = require('../models/SuggestionKnowledgeBase');
const GlobalPattern = require('../models/GlobalPattern');
const AdminNotificationService = require('./AdminNotificationService');
const logger = require('../utils/logger');

class PatternSharingService {
    constructor() {
        this.config = {
            // Industry sharing thresholds
            industryShareMinConfidence: 0.85,
            industryShareMinFrequency: 10,
            
            // Global sharing thresholds
            globalShareMinConfidence: 0.90,
            globalShareMinUniversality: 0.80,
            globalShareMinFrequency: 20,
            
            // Template minimums for sharing
            minTemplatesInIndustry: 2  // Need 2+ templates to share
        };
    }
    
    /**
     * ============================================================================
     * EVALUATE PATTERN FOR SHARING
     * ============================================================================
     * Called by PatternLearningService after a pattern is applied
     */
    async evaluateForSharing({ pattern, template, confidence, callId }) {
        try {
            logger.info('🌍 [PATTERN SHARING] Evaluating pattern for sharing', {
                templateId: template._id,
                templateName: template.name,
                patternType: pattern.type,
                confidence
            });
            
            const result = {
                industrySharing: { evaluated: false, shared: false },
                globalProposal: { evaluated: false, proposed: false }
            };
            
            // ============================================
            // INDUSTRY-WIDE SHARING
            // ============================================
            if (template.learningSettings?.shareWithinIndustry) {
                result.industrySharing.evaluated = true;
                
                const industryResult = await this.evaluateForIndustrySharing({
                    pattern,
                    template,
                    confidence
                });
                
                if (industryResult.qualified) {
                    await this.shareWithIndustry({
                        pattern,
                        template,
                        confidence,
                        callId
                    });
                    result.industrySharing.shared = true;
                }
            }
            
            // ============================================
            // GLOBAL SHARING PROPOSAL
            // ============================================
            if (template.learningSettings?.proposeForGlobal) {
                result.globalProposal.evaluated = true;
                
                const globalResult = await this.evaluateForGlobalSharing({
                    pattern,
                    template,
                    confidence
                });
                
                if (globalResult.qualified) {
                    await this.proposeForGlobal({
                        pattern,
                        template,
                        confidence,
                        callId
                    });
                    result.globalProposal.proposed = true;
                }
            }
            
            return result;
            
        } catch (error) {
            logger.error('❌ [PATTERN SHARING] Evaluation error', {
                error: error.message,
                stack: error.stack,
                pattern: pattern.type
            });
            
            // 🚨 WARNING: Pattern sharing system failure
            await AdminNotificationService.sendAlert({
                code: 'AI_PATTERN_SHARING_FAILURE',
                severity: 'WARNING',
                companyId: null,
                companyName: 'Platform',
                title: '⚠️ AI Pattern Sharing System Failure',
                message: `Failed to evaluate ${pattern.type} pattern for cross-template sharing. Templates will not learn from each other.`,
                details: {
                    error: error.message,
                    stackTrace: error.stack,
                    patternType: pattern.type,
                    pattern: pattern,
                    templateId: template._id,
                    templateName: template.name,
                    callId,
                    confidence,
                    impact: 'Pattern stays template-only, industry/global sharing disabled, slower self-improvement across platform',
                    action: 'Check template.learningSettings, industry labels, and MongoDB queries'
                }
            });
            
            return {
                industrySharing: { evaluated: false, shared: false, error: error.message },
                globalProposal: { evaluated: false, proposed: false, error: error.message }
            };
        }
    }
    
    /**
     * ============================================================================
     * EVALUATE FOR INDUSTRY SHARING
     * ============================================================================
     */
    async evaluateForIndustrySharing({ pattern, template, confidence }) {
        try {
            // Check confidence threshold
            if (confidence < this.config.industryShareMinConfidence) {
                return {
                    qualified: false,
                    reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(this.config.industryShareMinConfidence * 100)}%`
                };
            }
            
            // Check if there are other templates in this industry
            const industryTemplates = await GlobalInstantResponseTemplate.countDocuments({
                industryLabel: template.industryLabel,
                _id: { $ne: template._id },
                isActive: true
            });
            
            if (industryTemplates < 1) {
                return {
                    qualified: false,
                    reason: `No other templates in ${template.industryLabel} industry`
                };
            }
            
            return {
                qualified: true,
                industryTemplates
            };
            
        } catch (error) {
            logger.error('❌ [EVALUATE INDUSTRY SHARING] Error', { error: error.message });
            return {
                qualified: false,
                reason: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * SHARE WITH INDUSTRY
     * ============================================================================
     */
    async shareWithIndustry({ pattern, template, confidence, callId }) {
        try {
            logger.info('📤 [SHARE WITH INDUSTRY] Starting industry-wide sharing', {
                templateId: template._id,
                industry: template.industryLabel,
                patternType: pattern.type
            });
            
            // Find all templates in same industry
            const industryTemplates = await GlobalInstantResponseTemplate.find({
                industryLabel: template.industryLabel,
                _id: { $ne: template._id },
                isActive: true
            });
            
            let sharedCount = 0;
            const errors = [];
            
            for (const targetTemplate of industryTemplates) {
                try {
                    // Apply pattern to target template
                    await this.applyPatternToTemplate(pattern, targetTemplate);
                    sharedCount++;
                    
                    logger.info('✅ [SHARE WITH INDUSTRY] Pattern shared', {
                        targetTemplateId: targetTemplate._id,
                        targetTemplateName: targetTemplate.name
                    });
                    
                } catch (error) {
                    errors.push({
                        templateId: targetTemplate._id,
                        templateName: targetTemplate.name,
                        error: error.message
                    });
                }
            }
            
            // Update suggestion with sharing details
            await this.updateSuggestionSharingStatus({
                pattern,
                template,
                scope: 'industry',
                sharedWith: industryTemplates.map(t => ({
                    templateId: t._id,
                    templateName: t.name
                }))
            });
            
            // Send notification
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_PATTERN_SHARED_INDUSTRY',
                severity: 'INFO',
                title: '🌍 AI Learning: Pattern Shared Across Industry',
                message: `A high-quality pattern was automatically shared within the ${template.industryLabel} industry.\n\nOrigin Template: "${template.name}"\nPattern Type: ${pattern.type}\nShared With: ${sharedCount} template(s)\nConfidence: ${(confidence * 100).toFixed(0)}%`,
                details: {
                    sourceTemplateId: template._id.toString(),
                    sourceTemplateName: template.name,
                    industry: template.industryLabel,
                    pattern,
                    sharedCount,
                    errors
                }
            });
            
            logger.info('✅ [SHARE WITH INDUSTRY] Industry sharing complete', {
                templatesShared: sharedCount,
                errors: errors.length
            });
            
            return {
                success: true,
                sharedCount,
                errors
            };
            
        } catch (error) {
            logger.error('❌ [SHARE WITH INDUSTRY] Error', { error: error.message });
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * EVALUATE FOR GLOBAL SHARING
     * ============================================================================
     */
    async evaluateForGlobalSharing({ pattern, template, confidence }) {
        try {
            // Check confidence threshold
            if (confidence < this.config.globalShareMinConfidence) {
                return {
                    qualified: false,
                    reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold ${(this.config.globalShareMinConfidence * 100)}%`
                };
            }
            
            // Calculate universality score
            const universalityScore = this.calculateUniversality(pattern, template);
            
            if (universalityScore < this.config.globalShareMinUniversality) {
                return {
                    qualified: false,
                    reason: `Universality ${(universalityScore * 100).toFixed(0)}% below threshold ${(this.config.globalShareMinUniversality * 100)}%`
                };
            }
            
            return {
                qualified: true,
                universalityScore
            };
            
        } catch (error) {
            logger.error('❌ [EVALUATE GLOBAL SHARING] Error', { error: error.message });
            return {
                qualified: false,
                reason: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * PROPOSE FOR GLOBAL SHARING
     * ============================================================================
     * Creates a suggestion with status 'global_pending' for admin review
     */
    async proposeForGlobal({ pattern, template, confidence, callId }) {
        try {
            logger.info('📋 [PROPOSE FOR GLOBAL] Submitting pattern for admin review', {
                templateId: template._id,
                patternType: pattern.type,
                confidence
            });
            
            // Check if already proposed
            const existing = await SuggestionKnowledgeBase.findOne({
                type: pattern.type,
                shareStatus: { $in: ['global_pending', 'global_approved'] },
                ...(pattern.technicalTerm && { technicalTerm: pattern.technicalTerm }),
                ...(pattern.colloquialTerm && { colloquialTerm: pattern.colloquialTerm }),
                ...(pattern.fillerWord && { fillerWord: pattern.fillerWord })
            });
            
            if (existing) {
                logger.info('ℹ️ [PROPOSE FOR GLOBAL] Pattern already proposed/approved', {
                    existingSuggestionId: existing._id,
                    status: existing.shareStatus
                });
                return {
                    success: true,
                    message: 'Already proposed or approved',
                    suggestionId: existing._id
                };
            }
            
            // Calculate universality and quality scores
            const universality = this.calculateUniversality(pattern, template);
            const qualityScore = this.calculateQualityScore(pattern, confidence, universality);
            
            // Create or update suggestion
            const suggestion = await SuggestionKnowledgeBase.create({
                templateId: template._id,
                type: pattern.type,
                
                // Pattern data
                ...(pattern.technicalTerm && { technicalTerm: pattern.technicalTerm }),
                ...(pattern.colloquialTerm && { colloquialTerm: pattern.colloquialTerm }),
                ...(pattern.fillerWord && { fillerWord: pattern.fillerWord }),
                ...(pattern.words && { fillerWord: pattern.words.join(', ') }),
                
                confidence,
                frequency: 1,
                priority: 'high',
                detectionMethod: 'llm_extraction',
                
                // Sharing scope
                scope: 'global',
                shareStatus: 'global_pending',
                
                // Quality scoring
                qualityScore: {
                    overall: qualityScore,
                    confidenceScore: confidence,
                    universalityScore: universality,
                    frequencyScore: 0.5,  // Initial
                    impactScore: 0.5,     // Estimated
                    calculatedAt: new Date()
                },
                
                // Global sharing details
                globalSharingDetails: {
                    submittedAt: new Date(),
                    submittedBy: null  // System-generated
                }
            });
            
            // Send notification to admin
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_GLOBAL_PATTERN_PROPOSED',
                severity: 'INFO',
                title: '🌍 AI Learning: Global Pattern Proposed for Review',
                message: `A high-quality universal pattern has been detected and submitted for admin approval.\n\nOrigin Template: "${template.name}"\nPattern Type: ${pattern.type}\nConfidence: ${(confidence * 100).toFixed(0)}%\nUniversality: ${(universality * 100).toFixed(0)}%\nQuality Score: ${qualityScore}/100\n\n⚠️ Admin review required before platform-wide sharing.`,
                details: {
                    suggestionId: suggestion._id.toString(),
                    sourceTemplateId: template._id.toString(),
                    sourceTemplateName: template.name,
                    pattern,
                    confidence,
                    universality,
                    qualityScore
                }
            });
            
            logger.info('✅ [PROPOSE FOR GLOBAL] Pattern proposed for admin review', {
                suggestionId: suggestion._id,
                qualityScore
            });
            
            return {
                success: true,
                suggestionId: suggestion._id
            };
            
        } catch (error) {
            logger.error('❌ [PROPOSE FOR GLOBAL] Error', { error: error.message });
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE UNIVERSALITY SCORE
     * ============================================================================
     * How universal is this pattern? (industry-specific vs universal)
     */
    calculateUniversality(pattern, template) {
        // Heuristics for universality
        let score = 0.5;  // Start at 50%
        
        if (pattern.type === 'filler') {
            // Fillers are usually universal
            score = 0.9;
            
            // Common conversational fillers are even more universal
            const universalFillers = ['um', 'uh', 'like', 'you know', 'i mean', 'basically'];
            const words = pattern.words || [pattern.fillerWord];
            
            if (words.some(w => universalFillers.includes(w.toLowerCase()))) {
                score = 1.0;
            }
        }
        
        if (pattern.type === 'synonym') {
            // Check if technical term is industry-specific
            const industryTerms = ['thermostat', 'furnace', 'compressor', 'hvac', 'duct'];
            
            if (industryTerms.some(t => pattern.technicalTerm.toLowerCase().includes(t))) {
                score = 0.3;  // Industry-specific
            } else {
                score = 0.7;  // More universal
            }
            
            // Some synonyms are universal
            const universalSynonyms = ['asap', 'okay', 'yes', 'no', 'help'];
            if (universalSynonyms.includes(pattern.colloquialTerm.toLowerCase())) {
                score = 0.9;
            }
        }
        
        return Math.max(0, Math.min(1, score));
    }
    
    /**
     * ============================================================================
     * CALCULATE QUALITY SCORE
     * ============================================================================
     * Overall quality score (0-100) for ranking patterns
     */
    calculateQualityScore(pattern, confidence, universality) {
        const weights = {
            confidence: 0.4,
            universality: 0.3,
            frequency: 0.2,
            impact: 0.1
        };
        
        const frequencyScore = 0.5;  // Placeholder (would need historical data)
        const impactScore = 0.5;     // Placeholder (estimated)
        
        const weighted = 
            (confidence * weights.confidence) +
            (universality * weights.universality) +
            (frequencyScore * weights.frequency) +
            (impactScore * weights.impact);
        
        return Math.round(weighted * 100);
    }
    
    /**
     * ============================================================================
     * APPLY PATTERN TO TEMPLATE
     * ============================================================================
     */
    async applyPatternToTemplate(pattern, template) {
        switch (pattern.type) {
            case 'synonym':
                const existing = template.synonymMap.get(pattern.technicalTerm) || [];
                if (!existing.includes(pattern.colloquialTerm)) {
                    const merged = [...new Set([...existing, pattern.colloquialTerm])];
                    template.synonymMap.set(pattern.technicalTerm, merged);
                    await template.save();
                }
                break;
                
            case 'filler':
                const words = pattern.words || [pattern.fillerWord];
                const existingFillers = template.fillerWords || [];
                const mergedFillers = [...new Set([...existingFillers, ...words])];
                
                if (mergedFillers.length > existingFillers.length) {
                    template.fillerWords = mergedFillers;
                    await template.save();
                }
                break;
                
            default:
                logger.warn('⚠️ [APPLY PATTERN] Unsupported pattern type for auto-application', {
                    type: pattern.type
                });
        }
    }
    
    /**
     * ============================================================================
     * UPDATE SUGGESTION SHARING STATUS
     * ============================================================================
     */
    async updateSuggestionSharingStatus({ pattern, template, scope, sharedWith }) {
        try {
            // Find matching suggestion
            const suggestion = await SuggestionKnowledgeBase.findOne({
                templateId: template._id,
                type: pattern.type,
                status: { $in: ['pending', 'applied'] },
                ...(pattern.technicalTerm && { technicalTerm: pattern.technicalTerm }),
                ...(pattern.colloquialTerm && { colloquialTerm: pattern.colloquialTerm }),
                ...(pattern.fillerWord && { fillerWord: pattern.fillerWord })
            }).sort({ createdAt: -1 });
            
            if (suggestion) {
                suggestion.scope = scope;
                suggestion.shareStatus = scope === 'industry' ? 'industry_approved' : 'global_approved';
                
                if (scope === 'industry') {
                    suggestion.industrySharingDetails = {
                        industryLabel: template.industryLabel,
                        sharedWithTemplates: sharedWith.map(t => ({
                            templateId: t.templateId,
                            templateName: t.templateName,
                            sharedAt: new Date(),
                            autoShared: true
                        })),
                        approvedAt: new Date()
                    };
                }
                
                await suggestion.save();
            }
            
        } catch (error) {
            logger.error('❌ [UPDATE SHARING STATUS] Error', { error: error.message });
        }
    }
}

module.exports = new PatternSharingService();


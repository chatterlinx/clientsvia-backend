/**
 * ============================================================================
 * PATTERN LEARNING SERVICE - THE SELF-IMPROVEMENT ENGINE
 * ============================================================================
 * 
 * PURPOSE:
 * This is the HEART of the self-improvement cycle. When Tier 3 (LLM) handles
 * a call, it extracts patterns (synonyms, fillers, keywords). This service
 * takes those patterns and teaches Tier 1 (rule-based) so that NEXT time,
 * Tier 1 can handle it FOR FREE.
 * 
 * THE MAGIC:
 * Week 1: Caller says "my thingy isn't working"
 *   → Tier 3 (LLM) analyzes: "thingy" = "thermostat" ($0.50)
 *   → PatternLearningService teaches Tier 1: thingy → thermostat
 * 
 * Week 2: Caller says "my thingy is broken"
 *   → Tier 1 matches instantly using learned synonym ($0.00)
 *   → Saved $0.50!
 * 
 * Over 6 months:
 * - Week 1: 70% use Tier 3 ($350/month)
 * - Week 24: 2% use Tier 3 ($10/month)
 * - Total savings: $340/month per template
 * 
 * ============================================================================
 */

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const SuggestionKnowledgeBase = require('../models/SuggestionKnowledgeBase');
const AdminNotificationService = require('./AdminNotificationService');
const PatternSharingService = require('./PatternSharingService');
const logger = require('../utils/logger');

class PatternLearningService {
    constructor() {
        this.config = {
            // Quality thresholds
            minConfidenceForAutoApply: 0.75,  // 75% confidence to auto-apply
            minConfidenceForSuggestion: 0.60, // 60% confidence to create suggestion
            
            // Deduplication
            deduplicationWindowHours: 24,  // Don't create duplicate suggestions within 24h
            
            // Learning limits (prevent spam)
            maxPatternsPerCall: 5,  // Max patterns to learn from single call
            maxPatternsPerHour: 20  // Max patterns to auto-apply per hour
        };
    }
    
    /**
     * ============================================================================
     * MAIN METHOD: Learn from LLM-extracted patterns
     * ============================================================================
     * @param {Object} params
     * @param {Array} params.patterns - Patterns extracted by Tier 3 LLM
     * @param {Object} params.template - GlobalInstantResponseTemplate object
     * @param {String} params.callId - Call identifier
     * @param {Number} params.confidence - Overall confidence of LLM analysis
     * @returns {Object} - { patternsApplied, patternsQueued, errors }
     */
    async learnFromLLM({ patterns, template, callId, confidence }) {
        const startTime = Date.now();
        
        logger.info('🧠 [PATTERN LEARNING] Starting learning from LLM', {
            templateId: template._id,
            templateName: template.name,
            patternCount: patterns.length,
            callId,
            overallConfidence: confidence
        });
        
        const result = {
            patternsApplied: [],
            patternsQueued: [],
            errors: [],
            summary: {
                synonymsApplied: 0,
                fillersApplied: 0,
                keywordsApplied: 0,
                patternsSkipped: 0
            }
        };
        
        // Limit patterns to prevent spam
        const patternsToProcess = patterns.slice(0, this.config.maxPatternsPerCall);
        
        for (const pattern of patternsToProcess) {
            try {
                // Validate pattern
                if (!this.validatePattern(pattern)) {
                    result.summary.patternsSkipped++;
                    continue;
                }
                
                // Check if pattern confidence meets threshold
                const patternConfidence = pattern.confidence || confidence;
                
                if (patternConfidence >= this.config.minConfidenceForAutoApply) {
                    // ✅ HIGH CONFIDENCE: Auto-apply immediately
                    const applied = await this.applyPattern(pattern, template, callId);
                    
                    if (applied.success) {
                        result.patternsApplied.push({
                            type: pattern.type,
                            data: pattern,
                            appliedAt: new Date()
                        });
                        
                        // Update summary
                        if (pattern.type === 'synonym') result.summary.synonymsApplied++;
                        if (pattern.type === 'filler') result.summary.fillersApplied++;
                        if (pattern.type === 'keyword') result.summary.keywordsApplied++;
                        
                        // 📢 Send notification
                        await this.sendLearningNotification(pattern, template, 'applied', patternConfidence);
                        
                        // 🌍 Check if should be shared (industry/global)
                        if (template.learningSettings?.shareWithinIndustry || template.learningSettings?.proposeForGlobal) {
                            await PatternSharingService.evaluateForSharing({
                                pattern,
                                template,
                                confidence: patternConfidence,
                                callId
                            });
                        }
                        
                    } else {
                        result.errors.push({
                            pattern,
                            error: applied.error
                        });
                    }
                    
                } else if (patternConfidence >= this.config.minConfidenceForSuggestion) {
                    // ⚠️ MEDIUM CONFIDENCE: Queue for review
                    const queued = await this.queueForReview(pattern, template, callId, patternConfidence);
                    
                    if (queued.success) {
                        result.patternsQueued.push({
                            type: pattern.type,
                            data: pattern,
                            suggestionId: queued.suggestionId
                        });
                    }
                    
                } else {
                    // ❌ LOW CONFIDENCE: Skip
                    result.summary.patternsSkipped++;
                    logger.debug('⏭️ [PATTERN LEARNING] Pattern confidence too low, skipping', {
                        pattern: pattern.type,
                        confidence: patternConfidence,
                        threshold: this.config.minConfidenceForSuggestion
                    });
                }
                
            } catch (error) {
                logger.error('❌ [PATTERN LEARNING] Error processing pattern', {
                    pattern,
                    error: error.message
                });
                result.errors.push({
                    pattern,
                    error: error.message
                });
            }
        }
        
        // Update template learning stats
        await this.updateLearningStats(template, result);
        
        const processingTime = Date.now() - startTime;
        
        logger.info('✅ [PATTERN LEARNING] Learning complete', {
            templateId: template._id,
            applied: result.patternsApplied.length,
            queued: result.patternsQueued.length,
            skipped: result.summary.patternsSkipped,
            errors: result.errors.length,
            processingTime: `${processingTime}ms`
        });
        
        return result;
    }
    
    /**
     * ============================================================================
     * APPLY PATTERN: Add to template immediately
     * ============================================================================
     */
    async applyPattern(pattern, template, callId) {
        try {
            switch (pattern.type) {
                case 'synonym':
                    return await this.applySynonym(pattern, template);
                    
                case 'filler':
                    return await this.applyFiller(pattern, template);
                    
                case 'keyword':
                    return await this.applyKeyword(pattern, template);
                    
                case 'negative_keyword':
                    return await this.applyNegativeKeyword(pattern, template);
                    
                default:
                    return {
                        success: false,
                        error: `Unknown pattern type: ${pattern.type}`
                    };
            }
            
        } catch (error) {
            logger.error('❌ [APPLY PATTERN] Error', {
                pattern: pattern.type,
                error: error.message
            });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Apply synonym pattern
     */
    async applySynonym(pattern, template) {
        const technicalTerm = pattern.technicalTerm?.toLowerCase().trim();
        const colloquialTerm = pattern.colloquialTerm?.toLowerCase().trim();
        
        if (!technicalTerm || !colloquialTerm) {
            return { success: false, error: 'Missing technical or colloquial term' };
        }
        
        // Get existing aliases
        const existing = template.synonymMap.get(technicalTerm) || [];
        
        // Check if already exists
        if (existing.includes(colloquialTerm)) {
            logger.debug('ℹ️ [APPLY SYNONYM] Already exists, skipping', {
                technicalTerm,
                colloquialTerm
            });
            return { success: true, message: 'Already exists' };
        }
        
        // Add new alias
        const merged = [...new Set([...existing, colloquialTerm])];
        template.synonymMap.set(technicalTerm, merged);
        
        await template.save();
        
        logger.info('✅ [APPLY SYNONYM] Synonym added', {
            technicalTerm,
            colloquialTerm,
            totalAliases: merged.length,
            templateId: template._id
        });
        
        return {
            success: true,
            message: 'Synonym added',
            data: { technicalTerm, colloquialTerm, totalAliases: merged.length }
        };
    }
    
    /**
     * Apply filler pattern
     */
    async applyFiller(pattern, template) {
        const words = pattern.words || (pattern.fillerWord ? [pattern.fillerWord] : []);
        
        if (!words || words.length === 0) {
            return { success: false, error: 'No filler words provided' };
        }
        
        // Normalize and deduplicate
        const normalized = words.map(w => w.toLowerCase().trim());
        const existing = template.fillerWords || [];
        const merged = [...new Set([...existing, ...normalized])];
        
        const addedCount = merged.length - existing.length;
        
        if (addedCount === 0) {
            return { success: true, message: 'All fillers already exist' };
        }
        
        template.fillerWords = merged;
        await template.save();
        
        logger.info('✅ [APPLY FILLER] Fillers added', {
            added: addedCount,
            total: merged.length,
            templateId: template._id
        });
        
        return {
            success: true,
            message: `${addedCount} filler(s) added`,
            data: { added: addedCount, total: merged.length }
        };
    }
    
    /**
     * Apply keyword pattern (to specific scenario)
     */
    async applyKeyword(pattern, template) {
        // Keywords require scenario context
        // For now, queue for manual application
        return { success: false, error: 'Keyword patterns require manual scenario selection' };
    }
    
    /**
     * Apply negative keyword pattern
     */
    async applyNegativeKeyword(pattern, template) {
        // Negative keywords require scenario context
        return { success: false, error: 'Negative keyword patterns require manual scenario selection' };
    }
    
    /**
     * ============================================================================
     * QUEUE FOR REVIEW: Create suggestion for admin approval
     * ============================================================================
     */
    async queueForReview(pattern, template, callId, confidence) {
        try {
            // Check for duplicate within window
            const windowStart = new Date(Date.now() - (this.config.deduplicationWindowHours * 60 * 60 * 1000));
            
            const existing = await SuggestionKnowledgeBase.findOne({
                templateId: template._id,
                type: pattern.type,
                status: 'pending',
                firstDetected: { $gte: windowStart },
                ...(pattern.technicalTerm && { technicalTerm: pattern.technicalTerm }),
                ...(pattern.colloquialTerm && { colloquialTerm: pattern.colloquialTerm }),
                ...(pattern.fillerWord && { fillerWord: pattern.fillerWord })
            });
            
            if (existing) {
                // Update frequency
                existing.frequency += 1;
                existing.lastUpdated = new Date();
                await existing.save();
                
                return {
                    success: true,
                    message: 'Updated existing suggestion',
                    suggestionId: existing._id
                };
            }
            
            // Create new suggestion
            const suggestion = await SuggestionKnowledgeBase.create({
                templateId: template._id,
                type: pattern.type,
                
                // Pattern-specific fields
                ...(pattern.technicalTerm && { technicalTerm: pattern.technicalTerm }),
                ...(pattern.colloquialTerm && { colloquialTerm: pattern.colloquialTerm }),
                ...(pattern.fillerWord && { fillerWord: pattern.fillerWord }),
                ...(pattern.words && { fillerWord: pattern.words.join(', ') }),
                ...(pattern.keyword && { keyword: pattern.keyword }),
                
                confidence,
                frequency: 1,
                priority: confidence > 0.75 ? 'high' : confidence > 0.65 ? 'medium' : 'low',
                detectionMethod: 'llm_extraction',
                exampleCalls: [{
                    callId,
                    input: pattern.context || '',
                    timestamp: new Date()
                }],
                
                // Scope (always starts as template-only)
                scope: 'template',
                shareStatus: 'template_only'
            });
            
            logger.info('📋 [QUEUE FOR REVIEW] Suggestion created', {
                suggestionId: suggestion._id,
                type: pattern.type,
                confidence,
                templateId: template._id
            });
            
            return {
                success: true,
                message: 'Suggestion created',
                suggestionId: suggestion._id
            };
            
        } catch (error) {
            logger.error('❌ [QUEUE FOR REVIEW] Error', { error: error.message });
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * UPDATE LEARNING STATS
     * ============================================================================
     */
    async updateLearningStats(template, result) {
        try {
            const stats = template.learningStats || {};
            
            // Increment counters
            stats.patternsLearnedTotal = (stats.patternsLearnedTotal || 0) + result.patternsApplied.length;
            stats.patternsLearnedThisMonth = (stats.patternsLearnedThisMonth || 0) + result.patternsApplied.length;
            stats.synonymsLearned = (stats.synonymsLearned || 0) + result.summary.synonymsApplied;
            stats.fillersLearned = (stats.fillersLearned || 0) + result.summary.fillersApplied;
            stats.keywordsLearned = (stats.keywordsLearned || 0) + result.summary.keywordsApplied;
            
            // Update timestamps
            if (!stats.firstLearningEvent) {
                stats.firstLearningEvent = new Date();
            }
            stats.lastLearningEvent = new Date();
            
            template.learningStats = stats;
            await template.save();
            
        } catch (error) {
            logger.error('❌ [UPDATE LEARNING STATS] Error', { error: error.message });
        }
    }
    
    /**
     * ============================================================================
     * SEND LEARNING NOTIFICATION
     * ============================================================================
     */
    async sendLearningNotification(pattern, template, action, confidence) {
        try {
            let title, message, code;
            
            if (pattern.type === 'synonym') {
                code = 'AI_LEARNING_SYNONYM_ADDED';
                title = '🤖 AI Learning: Synonym Mapping Added by LLM (Template)';
                message = `The AI learned a new synonym from a live call.\n\nTemplate: "${template.name}"\nTechnical Term: "${pattern.technicalTerm}"\nColloquial Term: "${pattern.colloquialTerm}"\nConfidence: ${(confidence * 100).toFixed(0)}%\n\n✨ Next time someone uses "${pattern.colloquialTerm}", Tier 1 will match instantly (FREE).`;
                
            } else if (pattern.type === 'filler') {
                code = 'AI_LEARNING_FILLER_ADDED';
                title = '🔇 AI Learning: Filler Words Added by LLM (Template)';
                const words = pattern.words || [pattern.fillerWord];
                message = `The AI learned new filler words from a live call.\n\nTemplate: "${template.name}"\nFillers: "${words.join(', ')}"\nConfidence: ${(confidence * 100).toFixed(0)}%\n\n✨ These words will now be filtered out before matching.`;
                
            } else {
                return;  // Don't notify for other types yet
            }
            
            await AdminNotificationService.sendAlert({
                code,
                severity: 'warning',
                title,
                message,
                details: {
                    source: 'LLM Learning',
                    scope: 'Template',
                    templateId: template._id.toString(),
                    templateName: template.name,
                    pattern,
                    confidence,
                    action
                }
            });
            
        } catch (error) {
            logger.error('❌ [SEND LEARNING NOTIFICATION] Error', { error: error.message });
        }
    }
    
    /**
     * ============================================================================
     * VALIDATE PATTERN
     * ============================================================================
     */
    validatePattern(pattern) {
        if (!pattern || !pattern.type) {
            return false;
        }
        
        switch (pattern.type) {
            case 'synonym':
                return !!(pattern.technicalTerm && pattern.colloquialTerm);
                
            case 'filler':
                return !!(pattern.words?.length > 0 || pattern.fillerWord);
                
            case 'keyword':
            case 'negative_keyword':
                return !!pattern.keyword;
                
            default:
                return false;
        }
    }
}

module.exports = new PatternLearningService();


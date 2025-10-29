// ============================================================================
// ⚙️ AI GATEWAY - SUGGESTION APPLIER SERVICE
// ============================================================================
// PURPOSE: Apply approved suggestions to templates, categories, scenarios
// FEATURES: Filler addition, synonym mapping, keyword enhancement, scenario creation
// INTEGRATIONS: Template models, Redis cache, NotificationCenter
// CREATED: 2025-10-29
// ============================================================================

const { AIGatewaySuggestion } = require('../../models/aiGateway');
const Template = require('../../models/GlobalInstantResponseTemplate');
const Category = require('../../models/GlobalInstantResponseCategory');
const Scenario = require('../../models/GlobalInstantResponseScenario');
const CacheHelper = require('../../utils/cacheHelper');
const AdminNotificationService = require('../AdminNotificationService');
const logger = require('../../utils/logger');

class SuggestionApplier {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [AI GATEWAY APPLIER] Initializing SuggestionApplier...');
        console.log('✅ [AI GATEWAY APPLIER] SuggestionApplier initialized');
    }
    
    // ========================================================================
    // ✅ APPLY SUGGESTION (Main Entry Point)
    // ========================================================================
    
    async applySuggestion(suggestionId, userId) {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 1: Loading Suggestion
        // ────────────────────────────────────────────────────────────────────
        console.log(`✅ [AI GATEWAY APPLIER] CHECKPOINT 1: Applying suggestion ${suggestionId}`);
        
        const suggestion = await AIGatewaySuggestion.findById(suggestionId)
            .populate('templateId')
            .populate('categoryId')
            .populate('scenarioId');
        
        if (!suggestion) {
            throw new Error(`Suggestion not found: ${suggestionId}`);
        }
        
        if (suggestion.status !== 'pending') {
            throw new Error(`Suggestion already ${suggestion.status}`);
        }
        
        console.log(`📥 [AI GATEWAY APPLIER] Loaded suggestion: ${suggestion.type}`);
        
        try {
            let result = null;
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Applying Based on Type
            // ────────────────────────────────────────────────────────────────
            console.log(`🔄 [AI GATEWAY APPLIER] CHECKPOINT 2: Applying ${suggestion.type} suggestion...`);
            
            switch (suggestion.type) {
                case 'filler-words':
                    result = await this._applyFillerWords(suggestion);
                    break;
                case 'synonym':
                    result = await this._applySynonymMapping(suggestion);
                    break;
                case 'keywords':
                    result = await this._applyKeywords(suggestion);
                    break;
                case 'negative-keywords':
                    result = await this._applyNegativeKeywords(suggestion);
                    break;
                case 'missing-scenario':
                    result = await this._createMissingScenario(suggestion);
                    break;
                default:
                    throw new Error(`Unknown suggestion type: ${suggestion.type}`);
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Clearing Cache
            // ────────────────────────────────────────────────────────────────
            console.log('🗑️ [AI GATEWAY APPLIER] CHECKPOINT 3: Clearing Redis cache...');
            await CacheHelper.clearTemplateCache(suggestion.templateId._id);
            console.log('✅ [AI GATEWAY APPLIER] Cache cleared');
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 4: Marking Suggestion as Applied
            // ────────────────────────────────────────────────────────────────
            console.log('💾 [AI GATEWAY APPLIER] CHECKPOINT 4: Marking suggestion as applied...');
            await suggestion.markApplied(userId);
            console.log('✅ [AI GATEWAY APPLIER] Suggestion marked as applied');
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Success Alert
            // ────────────────────────────────────────────────────────────────
            await AdminNotificationService.sendNotification({
                code: 'AI_GATEWAY_SUGGESTION_APPLIED',
                severity: 'INFO',
                message: `Suggestion applied: ${suggestion.getBriefDescription()}`,
                details: {
                    suggestionId: suggestion._id,
                    type: suggestion.type,
                    templateId: suggestion.templateId._id,
                    templateName: suggestion.templateId.name,
                    appliedBy: userId,
                    result: result
                },
                source: 'AIGatewaySuggestionApplier'
            });
            console.log('📢 [AI GATEWAY APPLIER] NOTIFICATION: Sent success alert');
            
            logger.info(`[AI GATEWAY APPLIER] Applied suggestion ${suggestionId} of type ${suggestion.type}`, {
                suggestionId,
                type: suggestion.type,
                templateId: suggestion.templateId._id,
                userId
            });
            
            return { success: true, result };
            
        } catch (error) {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT ERROR: Application Failed
            // ────────────────────────────────────────────────────────────────
            console.error('❌ [AI GATEWAY APPLIER] CHECKPOINT ERROR: Failed to apply suggestion');
            console.error('❌ [AI GATEWAY APPLIER] Error:', error.message);
            console.error('❌ [AI GATEWAY APPLIER] Stack:', error.stack);
            
            logger.error(`[AI GATEWAY APPLIER] Failed to apply suggestion ${suggestionId}`, {
                error: error.message,
                stack: error.stack,
                suggestionId,
                type: suggestion.type
            });
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Error Alert
            // ────────────────────────────────────────────────────────────────
            await AdminNotificationService.sendNotification({
                code: 'AI_GATEWAY_SUGGESTION_APPLY_FAILED',
                severity: 'ERROR',
                message: `Failed to apply suggestion: ${error.message}`,
                details: {
                    suggestionId: suggestion._id,
                    type: suggestion.type,
                    error: error.message,
                    stack: error.stack
                },
                source: 'AIGatewaySuggestionApplier'
            });
            console.log('📢 [AI GATEWAY APPLIER] NOTIFICATION: Sent error alert');
            
            throw error;
        }
    }
    
    // ========================================================================
    // 📝 APPLY FILLER WORDS
    // ========================================================================
    
    async _applyFillerWords(suggestion) {
        console.log(`📝 [AI GATEWAY APPLIER] Adding ${suggestion.fillerWords.length} filler words to template`);
        
        const template = await Template.findById(suggestion.templateId);
        
        // Add new filler words (avoid duplicates)
        const existingFillers = template.fillerWords || [];
        const newFillers = suggestion.fillerWords.filter(word => !existingFillers.includes(word));
        
        template.fillerWords = [...existingFillers, ...newFillers];
        await template.save();
        
        console.log(`✅ [AI GATEWAY APPLIER] Added ${newFillers.length} new filler words (${suggestion.fillerWords.length - newFillers.length} were duplicates)`);
        
        return {
            addedCount: newFillers.length,
            duplicateCount: suggestion.fillerWords.length - newFillers.length,
            totalFillers: template.fillerWords.length
        };
    }
    
    // ========================================================================
    // 🔄 APPLY SYNONYM MAPPING
    // ========================================================================
    
    async _applySynonymMapping(suggestion) {
        console.log(`🔄 [AI GATEWAY APPLIER] Adding synonym: "${suggestion.synonymMapping.colloquial}" → "${suggestion.synonymMapping.technical}"`);
        
        // Find or create category (synonyms are stored at category level)
        const template = await Template.findById(suggestion.templateId);
        let category = await Category.findOne({ 
            templateId: template._id, 
            name: 'General' 
        });
        
        if (!category) {
            // Create a general category if it doesn't exist
            category = await Category.create({
                templateId: template._id,
                name: 'General',
                description: 'General synonym mappings',
                synonyms: {}
            });
            console.log('✅ [AI GATEWAY APPLIER] Created General category for synonyms');
        }
        
        // Add synonym to category
        const technicalTerm = suggestion.synonymMapping.technical;
        const colloquialTerm = suggestion.synonymMapping.colloquial;
        
        if (!category.synonyms) {
            category.synonyms = {};
        }
        
        if (!category.synonyms[technicalTerm]) {
            category.synonyms[technicalTerm] = [];
        }
        
        // Add if not already present
        if (!category.synonyms[technicalTerm].includes(colloquialTerm)) {
            category.synonyms[technicalTerm].push(colloquialTerm);
            category.markModified('synonyms');
            await category.save();
            console.log(`✅ [AI GATEWAY APPLIER] Added synonym to category`);
        } else {
            console.log(`⏭️ [AI GATEWAY APPLIER] Synonym already exists, skipping`);
        }
        
        return {
            category: category.name,
            technicalTerm,
            colloquialTerm,
            totalSynonyms: category.synonyms[technicalTerm].length
        };
    }
    
    // ========================================================================
    // 🔑 APPLY KEYWORDS
    // ========================================================================
    
    async _applyKeywords(suggestion) {
        console.log(`🔑 [AI GATEWAY APPLIER] Adding ${suggestion.suggestedKeywords.length} keywords to scenario`);
        
        const scenario = await Scenario.findById(suggestion.scenarioId);
        
        if (!scenario) {
            throw new Error(`Scenario not found: ${suggestion.scenarioId}`);
        }
        
        // Add new keywords (avoid duplicates)
        const existingKeywords = scenario.keywords || [];
        const newKeywords = suggestion.suggestedKeywords.filter(kw => !existingKeywords.includes(kw));
        
        scenario.keywords = [...existingKeywords, ...newKeywords];
        await scenario.save();
        
        console.log(`✅ [AI GATEWAY APPLIER] Added ${newKeywords.length} new keywords to "${scenario.name}"`);
        
        return {
            scenarioName: scenario.name,
            addedCount: newKeywords.length,
            totalKeywords: scenario.keywords.length
        };
    }
    
    // ========================================================================
    // 🚫 APPLY NEGATIVE KEYWORDS
    // ========================================================================
    
    async _applyNegativeKeywords(suggestion) {
        console.log(`🚫 [AI GATEWAY APPLIER] Adding ${suggestion.suggestedNegativeKeywords.length} negative keywords to scenario`);
        
        const scenario = await Scenario.findById(suggestion.scenarioId);
        
        if (!scenario) {
            throw new Error(`Scenario not found: ${suggestion.scenarioId}`);
        }
        
        // Add new negative keywords (avoid duplicates)
        const existingNegativeKeywords = scenario.negativeKeywords || [];
        const newNegativeKeywords = suggestion.suggestedNegativeKeywords.filter(kw => !existingNegativeKeywords.includes(kw));
        
        scenario.negativeKeywords = [...existingNegativeKeywords, ...newNegativeKeywords];
        await scenario.save();
        
        console.log(`✅ [AI GATEWAY APPLIER] Added ${newNegativeKeywords.length} new negative keywords to "${scenario.name}"`);
        
        return {
            scenarioName: scenario.name,
            addedCount: newNegativeKeywords.length,
            totalNegativeKeywords: scenario.negativeKeywords.length
        };
    }
    
    // ========================================================================
    // ➕ CREATE MISSING SCENARIO
    // ========================================================================
    
    async _createMissingScenario(suggestion) {
        console.log(`➕ [AI GATEWAY APPLIER] Creating new scenario: "${suggestion.suggestedScenarioName}"`);
        
        const template = await Template.findById(suggestion.templateId);
        
        // Find or create category
        let category = await Category.findOne({
            templateId: template._id,
            name: suggestion.suggestedCategory
        });
        
        if (!category) {
            category = await Category.create({
                templateId: template._id,
                name: suggestion.suggestedCategory,
                description: `Category created by AI Gateway for: ${suggestion.suggestedScenarioName}`,
                isActive: true
            });
            console.log(`✅ [AI GATEWAY APPLIER] Created new category: "${category.name}"`);
        }
        
        // Create new scenario
        const newScenario = await Scenario.create({
            templateId: template._id,
            categoryId: category._id,
            name: suggestion.suggestedScenarioName,
            keywords: suggestion.suggestedKeywordsForScenario || [],
            negativeKeywords: suggestion.suggestedNegativeKeywordsForScenario || [],
            response: suggestion.suggestedResponse || '',
            actionHook: suggestion.suggestedActionHook || null,
            behavior: suggestion.suggestedBehavior || null,
            priority: 50, // Medium priority
            isActive: true,
            createdBy: 'AI Gateway Suggestion System'
        });
        
        console.log(`✅ [AI GATEWAY APPLIER] Created new scenario: "${newScenario.name}" in category "${category.name}"`);
        
        return {
            scenarioId: newScenario._id,
            scenarioName: newScenario.name,
            categoryName: category.name,
            keywordsCount: newScenario.keywords.length,
            negativeKeywordsCount: newScenario.negativeKeywords.length
        };
    }
    
    // ========================================================================
    // 🔄 APPLY MULTIPLE SUGGESTIONS (Batch)
    // ========================================================================
    
    async applyMultipleSuggestions(suggestionIds, userId) {
        console.log(`🔄 [AI GATEWAY APPLIER] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY APPLIER] BATCH APPLY: Processing ${suggestionIds.length} suggestions`);
        console.log(`🔄 [AI GATEWAY APPLIER] ═══════════════════════════════════════════`);
        
        const results = {
            successful: 0,
            failed: 0,
            errors: []
        };
        
        for (const suggestionId of suggestionIds) {
            try {
                await this.applySuggestion(suggestionId, userId);
                results.successful++;
                console.log(`✅ [AI GATEWAY APPLIER] [${results.successful + results.failed}/${suggestionIds.length}] Applied suggestion ${suggestionId}`);
            } catch (error) {
                results.failed++;
                results.errors.push({
                    suggestionId,
                    error: error.message
                });
                console.error(`❌ [AI GATEWAY APPLIER] [${results.successful + results.failed}/${suggestionIds.length}] Failed to apply suggestion ${suggestionId}`);
            }
        }
        
        console.log(`🔄 [AI GATEWAY APPLIER] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY APPLIER] BATCH COMPLETE: ${results.successful} successful, ${results.failed} failed`);
        console.log(`🔄 [AI GATEWAY APPLIER] ═══════════════════════════════════════════`);
        
        return results;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new SuggestionApplier();


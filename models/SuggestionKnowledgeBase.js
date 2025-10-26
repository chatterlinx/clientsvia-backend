/**
 * ============================================================================
 * SUGGESTION KNOWLEDGE BASE - INTELLIGENT PATTERN DETECTION
 * ============================================================================
 * 
 * PURPOSE:
 * Stores automatically-detected optimization suggestions from test call analysis.
 * The system learns from failed matches and successful patterns to suggest:
 * - Filler words to add (noise removal)
 * - Synonyms to map (colloquial → technical translation)
 * - Missing keywords (improve matching)
 * - Conflict resolution (overlapping scenarios)
 * 
 * WORKFLOW:
 * 1. IntelligentPatternDetector analyzes test calls
 * 2. Suggestions stored here with confidence scores
 * 3. Developer reviews in Intelligence dashboard
 * 4. One-click apply or ignore
 * 5. System tracks which suggestions improve match rates
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;
const logger = require('../utils/logger');

const suggestionKnowledgeBaseSchema = new Schema({
    // ============================================
    // CONTEXT: Where does this suggestion apply?
    // ============================================
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true
        // Template this suggestion applies to
    },
    
    categoryId: {
        type: String,
        index: true
        // Optional: If suggestion is category-specific
        // Null = template-wide suggestion
    },
    
    scenarioId: {
        type: String,
        index: true
        // Optional: If suggestion is scenario-specific (e.g., missing keyword)
        // Null = category or template-wide suggestion
    },
    
    // ============================================
    // SUGGESTION TYPE & CONTENT
    // ============================================
    
    type: {
        type: String,
        enum: ['filler', 'synonym', 'keyword', 'negative_keyword', 'conflict'],
        required: true,
        index: true
        // filler: Add word to filler list
        // synonym: Map colloquial → technical term
        // keyword: Add missing keyword to scenario
        // negative_keyword: Add negative keyword to avoid confusion
        // conflict: Overlapping keywords between scenarios
    },
    
    // For 'filler' type
    fillerWord: {
        type: String,
        trim: true,
        lowercase: true
        // Word to add to filler list
    },
    
    // For 'synonym' type
    colloquialTerm: {
        type: String,
        trim: true,
        lowercase: true
        // Non-technical term users say (e.g., "thingy")
    },
    
    technicalTerm: {
        type: String,
        trim: true,
        lowercase: true
        // Technical term to translate to (e.g., "thermostat")
    },
    
    // For 'keyword' or 'negative_keyword' type
    keyword: {
        type: String,
        trim: true,
        lowercase: true
        // Keyword to add (positive or negative)
    },
    
    // For 'conflict' type
    conflictDetails: {
        scenarioA: String,      // First conflicting scenario ID
        scenarioB: String,      // Second conflicting scenario ID
        overlappingKeywords: [String],  // Keywords that overlap
        resolution: String      // Suggested fix
    },
    
    // ============================================
    // INTELLIGENCE METRICS
    // ============================================
    
    confidence: {
        type: Number,
        required: true,
        min: 0,
        max: 1,
        index: true
        // How confident is the system in this suggestion? (0-1)
        // Based on frequency, context, and pattern strength
    },
    
    estimatedImpact: {
        type: Number,
        min: 0,
        max: 100
        // Expected improvement in match rate (percentage)
        // e.g., "Adding this synonym would fix 18 of 23 failed matches (+25%)"
    },
    
    frequency: {
        type: Number,
        default: 1
        // How many times this pattern was detected
        // Higher frequency = higher priority
    },
    
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium',
        index: true
        // Calculated from confidence + impact + frequency
    },
    
    // ============================================
    // EVIDENCE & CONTEXT
    // ============================================
    
    exampleCalls: [{
        callId: String,
        input: String,
        expectedMatch: String,
        actualMatch: String,
        confidence: Number,
        timestamp: Date
    }],
    // Sample test calls that triggered this suggestion
    // Limited to top 5 most relevant examples
    
    contextPhrases: [String],
    // Common phrases where this pattern appears
    // e.g., ["the thingy on the wall", "my temperature thingy"]
    
    // ============================================
    // STATUS & LIFECYCLE
    // ============================================
    
    status: {
        type: String,
        enum: ['pending', 'applied', 'ignored', 'dismissed', 'expired'],
        default: 'pending',
        index: true
        // pending: Awaiting review
        // applied: Developer accepted and applied
        // ignored: Developer saw but chose not to apply
        // dismissed: Developer permanently dismissed
        // expired: Too old or no longer relevant
    },
    
    appliedAt: {
        type: Date
        // When this suggestion was applied
    },
    
    appliedBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User'
        // Admin user who applied this suggestion
    },
    
    ignoredAt: {
        type: Date
    },
    
    ignoredBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User'
    },
    
    ignoredReason: {
        type: String
        // Optional: Why this was ignored
    },
    
    // ============================================
    // IMPACT TRACKING (Post-Application)
    // ============================================
    
    actualImpact: {
        beforeMatchRate: Number,    // Match rate before applying
        afterMatchRate: Number,     // Match rate after applying
        improvement: Number,        // Actual improvement (%)
        measuredAt: Date
    },
    // Track if suggestion actually helped (A/B testing)
    
    // ============================================
    // METADATA
    // ============================================
    
    firstDetected: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    
    detectionMethod: {
        type: String,
        enum: ['frequency_analysis', 'context_analysis', 'semantic_analysis', 'manual'],
        default: 'frequency_analysis'
        // How was this suggestion detected?
    },
    
    notes: {
        type: String
        // Optional admin notes
    }
    
}, {
    timestamps: true,
    collection: 'suggestionknowledgebase'
});

// ============================================
// INDEXES FOR PERFORMANCE
// ============================================

// Query by template + status (most common: "show me pending suggestions for this template")
suggestionKnowledgeBaseSchema.index({ templateId: 1, status: 1, priority: -1 });

// Query by category + type (category settings page)
suggestionKnowledgeBaseSchema.index({ templateId: 1, categoryId: 1, type: 1, status: 1 });

// Query by confidence (high-confidence suggestions first)
suggestionKnowledgeBaseSchema.index({ templateId: 1, confidence: -1, estimatedImpact: -1 });

// Cleanup old suggestions (auto-expire after 90 days)
suggestionKnowledgeBaseSchema.index({ firstDetected: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

// ============================================
// METHODS
// ============================================

/**
 * Apply this suggestion to the actual template/category/scenario
 */
suggestionKnowledgeBaseSchema.methods.apply = async function(appliedByUserId) {
    const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate');
    
    const template = await GlobalInstantResponseTemplate.findById(this.templateId);
    if (!template) throw new Error('Template not found');
    
    switch (this.type) {
        case 'filler':
            await this.applyFillerSuggestion(template);
            break;
        case 'synonym':
            await this.applySynonymSuggestion(template);
            break;
        case 'keyword':
            await this.applyKeywordSuggestion(template);
            break;
        case 'negative_keyword':
            await this.applyNegativeKeywordSuggestion(template);
            break;
        default:
            throw new Error(`Cannot auto-apply suggestion type: ${this.type}`);
    }
    
    // Mark as applied
    this.status = 'applied';
    this.appliedAt = new Date();
    this.appliedBy = appliedByUserId;
    await this.save();
    
    return { success: true, message: 'Suggestion applied successfully' };
};

/**
 * Apply filler suggestion
 */
suggestionKnowledgeBaseSchema.methods.applyFillerSuggestion = async function(template) {
    const AdminNotificationService = require('../services/AdminNotificationService');
    
    let category = null;
    if (this.categoryId) {
        // Add to category fillers
        category = template.categories.id(this.categoryId);
        if (!category) throw new Error('Category not found');
        
        if (!category.additionalFillerWords.includes(this.fillerWord)) {
            category.additionalFillerWords.push(this.fillerWord);
        }
    } else {
        // Add to template fillers
        if (!template.fillerWords.includes(this.fillerWord)) {
            template.fillerWords.push(this.fillerWord);
        }
    }
    
    await template.save();
    
    // ============================================
    // 📢 NOTIFY DEVELOPERS OF AI LEARNING
    // ============================================
    try {
        const scope = category ? 'Category' : 'Template';
        await AdminNotificationService.sendAlert({
            code: 'AI_LEARNING_FILLER_ADDED',
            severity: 'warning',
            title: `🤖 AI Learning: Filler Word Added by LLM (${scope})`,
            message: `The AI detected and added a new filler word for noise removal.\n\nTemplate: "${template.name}"${category ? `\nCategory: "${category.name}"` : ''}\nFiller Word: "${this.fillerWord}"\nConfidence: ${(this.confidence * 100).toFixed(0)}%\nEstimated Impact: ${this.estimatedImpact}%\nDetection Method: ${this.detectionMethod}\n\nThis was automatically detected from ${this.frequency} test call${this.frequency > 1 ? 's' : ''}.`,
            details: {
                source: 'LLM Learning',
                scope,
                templateId: template._id.toString(),
                templateName: template.name,
                categoryId: category?.id,
                categoryName: category?.name,
                fillerWord: this.fillerWord,
                confidence: this.confidence,
                estimatedImpact: this.estimatedImpact,
                frequency: this.frequency,
                detectionMethod: this.detectionMethod,
                suggestionId: this._id.toString()
            }
        });
    } catch (notifError) {
        logger.error('Failed to send filler suggestion notification', { error: notifError.message });
    }
};

/**
 * Apply synonym suggestion
 */
suggestionKnowledgeBaseSchema.methods.applySynonymSuggestion = async function(template) {
    const AdminNotificationService = require('../services/AdminNotificationService');
    
    let category = null;
    if (this.categoryId) {
        category = template.categories.id(this.categoryId);
    }
    
    const synonymMap = category ? category.synonymMap : template.synonymMap;
    
    // Get existing aliases or create empty array
    const existingAliases = synonymMap.get(this.technicalTerm) || [];
    
    // Add new alias if not already present
    if (!existingAliases.includes(this.colloquialTerm)) {
        existingAliases.push(this.colloquialTerm);
        synonymMap.set(this.technicalTerm, existingAliases);
    }
    
    await template.save();
    
    // ============================================
    // 📢 NOTIFY DEVELOPERS OF AI LEARNING
    // ============================================
    try {
        const scope = category ? 'Category' : 'Template';
        await AdminNotificationService.sendAlert({
            code: 'AI_LEARNING_SYNONYM_ADDED',
            severity: 'warning',
            title: `🤖 AI Learning: Synonym Mapping Added by LLM (${scope})`,
            message: `The AI detected and added a new synonym mapping.\n\nTemplate: "${template.name}"${category ? `\nCategory: "${category.name}"` : ''}\nTechnical Term: "${this.technicalTerm}"\nColloquial Term: "${this.colloquialTerm}"\nConfidence: ${(this.confidence * 100).toFixed(0)}%\nEstimated Impact: ${this.estimatedImpact}%\nDetection Method: ${this.detectionMethod}\n\nThis was automatically detected from ${this.frequency} test call${this.frequency > 1 ? 's' : ''}.`,
            details: {
                source: 'LLM Learning',
                scope,
                templateId: template._id.toString(),
                templateName: template.name,
                categoryId: category?.id,
                categoryName: category?.name,
                technicalTerm: this.technicalTerm,
                colloquialTerm: this.colloquialTerm,
                totalAliases: existingAliases.length,
                confidence: this.confidence,
                estimatedImpact: this.estimatedImpact,
                frequency: this.frequency,
                detectionMethod: this.detectionMethod,
                suggestionId: this._id.toString()
            }
        });
    } catch (notifError) {
        logger.error('Failed to send synonym suggestion notification', { error: notifError.message });
    }
};

/**
 * Apply keyword suggestion
 */
suggestionKnowledgeBaseSchema.methods.applyKeywordSuggestion = async function(template) {
    const AdminNotificationService = require('../services/AdminNotificationService');
    
    const category = template.categories.id(this.categoryId);
    if (!category) throw new Error('Category not found');
    
    const scenario = category.scenarios.id(this.scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    
    if (!scenario.intentKeywords.includes(this.keyword)) {
        scenario.intentKeywords.push(this.keyword);
    }
    
    await template.save();
    
    // ============================================
    // 📢 NOTIFY DEVELOPERS OF AI LEARNING
    // ============================================
    try {
        await AdminNotificationService.sendAlert({
            code: 'AI_LEARNING_KEYWORD_ADDED',
            severity: 'warning',
            title: '🤖 AI Learning: Keyword Added by LLM (Scenario)',
            message: `The AI detected a missing keyword and added it to improve matching.\n\nTemplate: "${template.name}"\nCategory: "${category.name}"\nScenario: "${scenario.name}"\nKeyword: "${this.keyword}"\nConfidence: ${(this.confidence * 100).toFixed(0)}%\nEstimated Impact: ${this.estimatedImpact}%\nDetection Method: ${this.detectionMethod}\n\nThis was detected from ${this.frequency} failed match${this.frequency > 1 ? 'es' : ''}.`,
            details: {
                source: 'LLM Learning',
                scope: 'Scenario',
                templateId: template._id.toString(),
                templateName: template.name,
                categoryId: category.id,
                categoryName: category.name,
                scenarioId: scenario.scenarioId,
                scenarioName: scenario.name,
                keyword: this.keyword,
                confidence: this.confidence,
                estimatedImpact: this.estimatedImpact,
                frequency: this.frequency,
                detectionMethod: this.detectionMethod,
                suggestionId: this._id.toString()
            }
        });
    } catch (notifError) {
        logger.error('Failed to send keyword suggestion notification', { error: notifError.message });
    }
};

/**
 * Apply negative keyword suggestion
 */
suggestionKnowledgeBaseSchema.methods.applyNegativeKeywordSuggestion = async function(template) {
    const AdminNotificationService = require('../services/AdminNotificationService');
    
    const category = template.categories.id(this.categoryId);
    if (!category) throw new Error('Category not found');
    
    const scenario = category.scenarios.id(this.scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    
    if (!scenario.negativeKeywords.includes(this.keyword)) {
        scenario.negativeKeywords.push(this.keyword);
    }
    
    await template.save();
    
    // ============================================
    // 📢 NOTIFY DEVELOPERS OF AI LEARNING
    // ============================================
    try {
        await AdminNotificationService.sendAlert({
            code: 'AI_LEARNING_NEGATIVE_KEYWORD_ADDED',
            severity: 'warning',
            title: '🤖 AI Learning: Negative Keyword Added by LLM (Scenario)',
            message: `The AI detected a conflicting keyword and added it as a negative keyword.\n\nTemplate: "${template.name}"\nCategory: "${category.name}"\nScenario: "${scenario.name}"\nNegative Keyword: "${this.keyword}"\nConfidence: ${(this.confidence * 100).toFixed(0)}%\nEstimated Impact: ${this.estimatedImpact}%\nDetection Method: ${this.detectionMethod}\n\nThis helps prevent false matches and improve accuracy.`,
            details: {
                source: 'LLM Learning',
                scope: 'Scenario',
                templateId: template._id.toString(),
                templateName: template.name,
                categoryId: category.id,
                categoryName: category.name,
                scenarioId: scenario.scenarioId,
                scenarioName: scenario.name,
                negativeKeyword: this.keyword,
                confidence: this.confidence,
                estimatedImpact: this.estimatedImpact,
                frequency: this.frequency,
                detectionMethod: this.detectionMethod,
                suggestionId: this._id.toString()
            }
        });
    } catch (notifError) {
        logger.error('Failed to send negative keyword suggestion notification', { error: notifError.message });
    }
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get pending suggestions for a template
 */
suggestionKnowledgeBaseSchema.statics.getPendingSuggestions = async function(templateId, options = {}) {
    const query = {
        templateId,
        status: 'pending'
    };
    
    if (options.categoryId) {
        query.categoryId = options.categoryId;
    }
    
    if (options.type) {
        query.type = options.type;
    }
    
    if (options.minConfidence) {
        query.confidence = { $gte: options.minConfidence };
    }
    
    return this.find(query)
        .sort({ priority: -1, confidence: -1, estimatedImpact: -1 })
        .limit(options.limit || 50);
};

/**
 * Get suggestions summary
 */
suggestionKnowledgeBaseSchema.statics.getSummary = async function(templateId) {
    const pipeline = [
        { $match: { templateId: mongoose.Types.ObjectId(templateId), status: 'pending' } },
        {
            $group: {
                _id: '$priority',
                count: { $sum: 1 },
                avgConfidence: { $avg: '$confidence' },
                totalImpact: { $sum: '$estimatedImpact' }
            }
        }
    ];
    
    const results = await this.aggregate(pipeline);
    
    return {
        high: results.find(r => r._id === 'high')?.count || 0,
        medium: results.find(r => r._id === 'medium')?.count || 0,
        low: results.find(r => r._id === 'low')?.count || 0,
        total: results.reduce((sum, r) => sum + r.count, 0)
    };
};

module.exports = mongoose.model('SuggestionKnowledgeBase', suggestionKnowledgeBaseSchema);


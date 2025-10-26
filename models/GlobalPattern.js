/**
 * ============================================================================
 * GLOBAL PATTERN MODEL - PLATFORM-WIDE APPROVED INTELLIGENCE
 * ============================================================================
 * 
 * PURPOSE:
 * Stores patterns that have been approved by admins for platform-wide sharing.
 * These are high-quality, universal patterns (fillers, synonyms, keywords) that
 * benefit ALL templates across all industries.
 * 
 * EXAMPLES:
 * - Fillers: "um", "uh", "like", "you know" (apply to everyone)
 * - Synonyms: "ASAP" → "as soon as possible" (universal)
 * - Keywords: "emergency", "urgent" (universal urgency indicators)
 * 
 * WORKFLOW:
 * 1. Pattern detected in template (e.g., HVAC)
 * 2. Confidence >90% + universality >80%
 * 3. Submitted to admin review queue
 * 4. Admin approves → Creates GlobalPattern
 * 5. Applied to ALL templates platform-wide
 * 6. Future templates inherit automatically
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalPatternSchema = new Schema({
    // ============================================
    // PATTERN IDENTITY
    // ============================================
    
    patternId: {
        type: String,
        required: true,
        unique: true,
        index: true
        // ULID for stable ID
    },
    
    type: {
        type: String,
        required: true,
        enum: ['filler', 'synonym', 'keyword', 'negative_keyword', 'urgency_keyword'],
        index: true
    },
    
    name: {
        type: String,
        required: true,
        trim: true
        // Human-readable name: "Generic Fillers", "Universal Urgency Keywords", etc.
    },
    
    description: {
        type: String,
        trim: true
        // Why this pattern is globally applicable
    },
    
    // ============================================
    // PATTERN DATA
    // ============================================
    
    // For 'filler' type
    fillerWords: {
        type: [String],
        default: []
        // Example: ["um", "uh", "like", "you know"]
    },
    
    // For 'synonym' type
    synonymMapping: {
        technicalTerm: { type: String, trim: true, lowercase: true },
        colloquialTerms: { type: [String], default: [] }
        // Example: { technicalTerm: "as soon as possible", colloquialTerms: ["asap", "a.s.a.p"] }
    },
    
    // For 'keyword', 'negative_keyword', or 'urgency_keyword' type
    keywords: {
        type: [String],
        default: []
        // Example: ["emergency", "urgent", "critical"]
    },
    
    // ============================================
    // QUALITY & APPROVAL
    // ============================================
    
    qualityMetrics: {
        confidence: {
            type: Number,
            required: true,
            min: 0.9,
            max: 1.0
            // Must be ≥90% to qualify for global
        },
        
        universality: {
            type: Number,
            required: true,
            min: 0.8,
            max: 1.0
            // Must be ≥80% universal (not industry-specific)
        },
        
        frequency: {
            type: Number,
            required: true,
            min: 20
            // Must appear in 20+ test calls across templates
        },
        
        estimatedImpact: {
            type: Number,
            min: 0,
            max: 100
            // Expected improvement percentage
        },
        
        // How many templates would benefit?
        applicableTemplateCount: {
            type: Number,
            default: 0
        }
    },
    
    // ============================================
    // APPROVAL WORKFLOW
    // ============================================
    
    submissionDetails: {
        // Original suggestion that triggered this
        suggestionId: {
            type: Schema.Types.ObjectId,
            ref: 'SuggestionKnowledgeBase'
        },
        
        // Which template detected this pattern
        originTemplateId: {
            type: Schema.Types.ObjectId,
            ref: 'GlobalInstantResponseTemplate',
            required: true
        },
        
        originTemplateName: {
            type: String,
            trim: true
        },
        
        originIndustry: {
            type: String,
            trim: true
        },
        
        // Who submitted for global review
        submittedBy: {
            type: Schema.Types.ObjectId,
            ref: 'v2User',
            required: true
        },
        
        submittedAt: {
            type: Date,
            default: Date.now
        },
        
        submissionNotes: {
            type: String,
            trim: true
        }
    },
    
    approvalDetails: {
        // Admin who approved
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'v2User',
            required: true
        },
        
        approvedAt: {
            type: Date,
            default: Date.now
        },
        
        approvalNotes: {
            type: String,
            trim: true
            // Why this was approved globally
        },
        
        // Evidence supporting approval
        evidenceCallIds: {
            type: [String],
            default: []
            // Sample call IDs where this pattern was useful
        }
    },
    
    // ============================================
    // APPLICATION TRACKING
    // ============================================
    
    appliedToTemplates: [{
        templateId: {
            type: Schema.Types.ObjectId,
            ref: 'GlobalInstantResponseTemplate',
            required: true
        },
        templateName: {
            type: String,
            trim: true
        },
        industryLabel: {
            type: String,
            trim: true
        },
        appliedAt: {
            type: Date,
            default: Date.now
        },
        appliedBy: {
            type: String,
            default: 'System (Auto-Apply)'
        },
        // Track if this actually helped
        impactMeasured: {
            beforeMatchRate: { type: Number },
            afterMatchRate: { type: Number },
            improvement: { type: Number },
            measuredAt: { type: Date }
        }
    }],
    
    totalTemplatesApplied: {
        type: Number,
        default: 0
    },
    
    // ============================================
    // STATUS & LIFECYCLE
    // ============================================
    
    status: {
        type: String,
        enum: ['active', 'deprecated', 'archived'],
        default: 'active',
        index: true
        // active: Currently applied to templates
        // deprecated: Being phased out
        // archived: Historical only
    },
    
    isActive: {
        type: Boolean,
        default: true,
        index: true
        // Quick toggle to disable without archiving
    },
    
    deprecationDetails: {
        deprecatedAt: { type: Date },
        deprecatedBy: { type: Schema.Types.ObjectId, ref: 'v2User' },
        reason: { type: String },
        replacedBy: { type: Schema.Types.ObjectId, ref: 'GlobalPattern' }
    },
    
    // ============================================
    // IMPACT METRICS (Post-Deployment)
    // ============================================
    
    impactMetrics: {
        // Aggregate impact across all templates
        totalCallsImproved: { type: Number, default: 0 },
        avgConfidenceIncrease: { type: Number, default: 0 },
        avgResponseTimeDecrease: { type: Number, default: 0 },
        
        // Cost impact
        estimatedMonthlySavings: { type: Number, default: 0 },  // USD
        actualMonthlySavings: { type: Number, default: 0 },     // USD
        
        // Quality metrics
        positiveTemplates: { type: Number, default: 0 },  // Templates that benefited
        neutralTemplates: { type: Number, default: 0 },   // No impact
        negativeTemplates: { type: Number, default: 0 },  // Negative impact (rare)
        
        lastImpactCalculation: { type: Date }
    },
    
    // ============================================
    // VERSIONING & UPDATES
    // ============================================
    
    version: {
        type: Number,
        default: 1,
        min: 1
    },
    
    versionHistory: [{
        version: { type: Number, required: true },
        changes: { type: String },
        changedBy: { type: Schema.Types.ObjectId, ref: 'v2User' },
        changedAt: { type: Date, default: Date.now },
        previousData: { type: Schema.Types.Mixed }
    }],
    
    // ============================================
    // METADATA
    // ============================================
    
    tags: {
        type: [String],
        default: [],
        index: true
        // Example: ["conversational", "urgency", "technical", "universal"]
    },
    
    category: {
        type: String,
        enum: ['conversational', 'technical', 'urgency', 'emotional', 'procedural', 'other'],
        default: 'other',
        index: true
    },
    
    priority: {
        type: Number,
        default: 50,
        min: 0,
        max: 100
        // Higher priority patterns are applied first
    },
    
    notes: {
        type: String,
        trim: true
        // Admin notes for future reference
    }
    
}, {
    timestamps: true,
    collection: 'globalpatterns'
});

// ============================================
// INDEXES FOR PERFORMANCE
// ============================================

// Query by type + status
globalPatternSchema.index({ type: 1, status: 1, isActive: 1 });

// Application queries
globalPatternSchema.index({ 'appliedToTemplates.templateId': 1, createdAt: -1 });

// Quality queries
globalPatternSchema.index({ 'qualityMetrics.universality': -1, 'qualityMetrics.confidence': -1 });

// ============================================
// METHODS
// ============================================

/**
 * Apply this global pattern to a template
 */
globalPatternSchema.methods.applyToTemplate = async function(templateId, templateName, industryLabel, appliedBy = 'System') {
    const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate');
    
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    // Apply based on pattern type
    switch (this.type) {
        case 'filler':
            // Add filler words (merge + deduplicate)
            template.fillerWords = [...new Set([...template.fillerWords, ...this.fillerWords])];
            break;
            
        case 'synonym':
            // Add synonym mapping
            const existing = template.synonymMap.get(this.synonymMapping.technicalTerm) || [];
            const merged = [...new Set([...existing, ...this.synonymMapping.colloquialTerms])];
            template.synonymMap.set(this.synonymMapping.technicalTerm, merged);
            break;
            
        case 'keyword':
        case 'urgency_keyword':
            // For keywords, we'd add to urgencyKeywords array (if it exists)
            // This is more complex as it may need to be applied to specific scenarios
            // For now, log that this pattern type needs manual application
            console.log(`Global pattern ${this.patternId} (${this.type}) requires manual scenario-level application`);
            break;
            
        default:
            throw new Error(`Cannot auto-apply pattern type: ${this.type}`);
    }
    
    await template.save();
    
    // Track application
    this.appliedToTemplates.push({
        templateId,
        templateName,
        industryLabel,
        appliedAt: new Date(),
        appliedBy
    });
    
    this.totalTemplatesApplied = this.appliedToTemplates.length;
    await this.save();
    
    return { success: true, message: `Global pattern applied to ${templateName}` };
};

/**
 * Get all active global patterns for a specific type
 */
globalPatternSchema.statics.getActivePatterns = async function(type = null) {
    const query = {
        status: 'active',
        isActive: true
    };
    
    if (type) {
        query.type = type;
    }
    
    return this.find(query).sort({ priority: -1, createdAt: -1 });
};

/**
 * Calculate impact metrics across all templates
 */
globalPatternSchema.methods.calculateImpact = async function() {
    // This would query LLMCallLog to see how this pattern affected calls
    // For now, return a placeholder
    return {
        totalCallsImproved: this.appliedToTemplates.length * 100,  // Estimate
        avgConfidenceIncrease: 0.05,
        estimatedMonthlySavings: this.appliedToTemplates.length * 2.50  // $2.50 per template
    };
};

module.exports = mongoose.model('GlobalPattern', globalPatternSchema);


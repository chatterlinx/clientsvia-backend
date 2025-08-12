/**
 * Knowledge Lifecycle Item Model
 * Enterprise-grade knowledge management with governance, audit trails, and lifecycle tracking
 */

const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const auditTrailSchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
        enum: ['created', 'updated', 'reviewed', 'approved', 'rejected', 'expired', 'renewed', 'archived']
    },
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    performedAt: {
        type: Date,
        required: true,
        default: Date.now
    },
    details: {
        type: String,
        required: true
    },
    modifications: {
        type: mongoose.Schema.Types.Mixed
    },
    previousValues: {
        type: mongoose.Schema.Types.Mixed
    }
});

const knowledgeLifecycleItemSchema = new mongoose.Schema({
    // Core identification
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // Knowledge content
    question: {
        type: String,
        required: true,
        minlength: 10,
        maxlength: 1000,
        trim: true
    },
    answer: {
        type: String,
        required: true,
        minlength: 20,
        maxlength: 5000,
        trim: true
    },
    
    // Enterprise categorization and governance
    category: {
        type: String,
        required: true,
        enum: [
            'general_information',
            'services',
            'pricing',
            'scheduling',
            'emergency',
            'support',
            'policies',
            'procedures',
            'compliance',
            'technical',
            'troubleshooting',
            'safety',
            'warranty',
            'billing',
            'contact_information'
        ],
        index: true
    },
    subcategory: {
        type: String,
        maxlength: 100
    },
    
    // Enterprise prioritization and management
    priority: {
        type: String,
        enum: ['critical', 'high', 'medium', 'low'],
        default: 'medium',
        index: true
    },
    tags: [{
        type: String,
        maxlength: 50,
        lowercase: true,
        trim: true
    }],
    
    // Governance and compliance
    sourceOfTruth: {
        type: String,
        required: true,
        enum: [
            'company_documentation',
            'website',
            'training_manual',
            'policy_document',
            'api_documentation',
            'support_ticket',
            'customer_feedback',
            'regulatory_requirement',
            'industry_standard',
            'expert_knowledge',
            'automated_extraction'
        ]
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // Lifecycle and validity management
    status: {
        type: String,
        enum: ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'archived'],
        default: 'pending_review',
        index: true
    },
    reviewStatus: {
        type: String,
        enum: ['needs_review', 'under_review', 'approved', 'requires_changes', 'rejected'],
        default: 'needs_review',
        index: true
    },
    
    // Review and approval tracking
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    rejectedAt: {
        type: Date
    },
    rejectionReason: {
        type: String,
        maxlength: 500
    },
    
    // Validity and review scheduling
    validFrom: {
        type: Date,
        default: Date.now
    },
    validThrough: {
        type: Date
    },
    reviewEveryDays: {
        type: Number,
        default: 90,
        min: 1,
        max: 365
    },
    nextReviewDate: {
        type: Date
    },
    lastReviewDate: {
        type: Date
    },
    
    // Usage and performance tracking
    usageCount: {
        type: Number,
        default: 0
    },
    successfulMatches: {
        type: Number,
        default: 0
    },
    failedMatches: {
        type: Number,
        default: 0
    },
    averageConfidence: {
        type: Number,
        min: 0,
        max: 1
    },
    lastUsed: {
        type: Date
    },
    
    // Quality and feedback tracking
    qualityRating: {
        type: Number,
        min: 1,
        max: 5
    },
    customerFeedbackScore: {
        type: Number,
        min: 1,
        max: 5
    },
    agentFeedbackScore: {
        type: Number,
        min: 1,
        max: 5
    },
    
    // Enterprise metadata and compliance
    metadata: {
        businessUnit: String,
        department: String,
        region: String,
        language: {
            type: String,
            default: 'en',
            lowercase: true
        },
        contentVersion: {
            type: String,
            default: '1.0'
        },
        complianceLevel: {
            type: String,
            enum: ['public', 'internal', 'confidential', 'restricted'],
            default: 'internal'
        },
        dataClassification: {
            type: String,
            enum: ['public', 'internal', 'confidential', 'restricted'],
            default: 'internal'
        },
        regulatoryRequirements: [String],
        relatedDocuments: [String],
        keywords: [String],
        alternativeQuestions: [String]
    },
    
    // Audit trail for enterprise governance
    auditTrail: [auditTrailSchema],
    
    // Enterprise analytics and reporting
    analytics: {
        creationSource: {
            type: String,
            enum: ['manual', 'automated', 'import', 'api', 'learning']
        },
        timeToApproval: Number, // in hours
        timeToFirstUse: Number, // in hours
        effectivenessScore: Number,
        businessImpact: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical']
        }
    },
    
    // Versioning and change management
    version: {
        type: Number,
        default: 1
    },
    previousVersionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'KnowledgeLifecycleItem'
    },
    isCurrentVersion: {
        type: Boolean,
        default: true
    },
    
    // Integration and sync
    externalSyncStatus: {
        lastSynced: Date,
        syncedWith: [String],
        syncErrors: [String]
    }
    
}, {
    timestamps: true,
    collection: 'knowledgeLifecycleItems'
});

// Indexes for enterprise performance
knowledgeLifecycleItemSchema.index({ companyId: 1, status: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, category: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, priority: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, reviewStatus: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, nextReviewDate: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, validThrough: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, tags: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, sourceOfTruth: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, owner: 1 });
knowledgeLifecycleItemSchema.index({ companyId: 1, isCurrentVersion: 1 });

// Text index for enterprise search
knowledgeLifecycleItemSchema.index({
    question: 'text',
    answer: 'text',
    'metadata.keywords': 'text',
    'metadata.alternativeQuestions': 'text'
});

// Virtual for effectiveness calculation
knowledgeLifecycleItemSchema.virtual('effectiveness').get(function() {
    if (this.usageCount === 0) return 0;
    return (this.successfulMatches / this.usageCount) * 100;
});

// Virtual for days until expiry
knowledgeLifecycleItemSchema.virtual('daysUntilExpiry').get(function() {
    if (!this.validThrough) return null;
    const now = new Date();
    const expiry = new Date(this.validThrough);
    const diffTime = expiry - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for days since last review
knowledgeLifecycleItemSchema.virtual('daysSinceLastReview').get(function() {
    if (!this.lastReviewDate) return null;
    const now = new Date();
    const lastReview = new Date(this.lastReviewDate);
    const diffTime = now - lastReview;
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
});

// Pre-save middleware for enterprise governance
knowledgeLifecycleItemSchema.pre('save', function(next) {
    // Calculate next review date if not set
    if (!this.nextReviewDate && this.reviewEveryDays) {
        this.nextReviewDate = new Date(Date.now() + (this.reviewEveryDays * 24 * 60 * 60 * 1000));
    }
    
    // Set valid through date if not provided (default 1 year)
    if (!this.validThrough) {
        this.validThrough = new Date(Date.now() + (365 * 24 * 60 * 60 * 1000));
    }
    
    // Update version if content changed
    if (this.isModified('question') || this.isModified('answer')) {
        if (!this.isNew) {
            this.version += 1;
        }
    }
    
    next();
});

// Static method for enterprise search
knowledgeLifecycleItemSchema.statics.enterpriseSearch = function(companyId, query, options = {}) {
    const {
        category,
        status = 'approved',
        priority,
        tags,
        limit = 10,
        minConfidence = 0.5
    } = options;
    
    const searchFilter = {
        companyId: mongoose.Types.ObjectId(companyId),
        status,
        isCurrentVersion: true,
        $or: [
            { validThrough: { $exists: false } },
            { validThrough: { $gt: new Date() } }
        ]
    };
    
    if (category) searchFilter.category = category;
    if (priority) searchFilter.priority = priority;
    if (tags && tags.length > 0) searchFilter.tags = { $in: tags };
    
    // Text search
    if (query) {
        searchFilter.$text = { $search: query };
    }
    
    return this.find(searchFilter)
        .sort(query ? { score: { $meta: 'textScore' } } : { priority: -1, usageCount: -1 })
        .limit(limit)
        .lean();
};

// Instance method for recording usage
knowledgeLifecycleItemSchema.methods.recordUsage = function(success = true, confidence = null) {
    this.usageCount += 1;
    this.lastUsed = new Date();
    
    if (success) {
        this.successfulMatches += 1;
    } else {
        this.failedMatches += 1;
    }
    
    if (confidence !== null) {
        // Calculate running average confidence
        if (this.averageConfidence) {
            this.averageConfidence = (this.averageConfidence + confidence) / 2;
        } else {
            this.averageConfidence = confidence;
        }
    }
    
    return this.save();
};

// Instance method for adding audit trail entry
knowledgeLifecycleItemSchema.methods.addAuditEntry = function(action, performedBy, details, modifications = null) {
    this.auditTrail.push({
        action,
        performedBy,
        performedAt: new Date(),
        details,
        modifications,
        previousValues: modifications ? this.toObject() : null
    });
    
    return this;
};

// Plugin for pagination
knowledgeLifecycleItemSchema.plugin(mongoosePaginate);

// Ensure virtuals are included in JSON output
knowledgeLifecycleItemSchema.set('toJSON', { virtuals: true });
knowledgeLifecycleItemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('KnowledgeLifecycleItem', knowledgeLifecycleItemSchema);

/**
 * 🏢 LOCAL COMPANY Q&A MODEL - V2 CLEAN SYSTEM
 * 
 * Multi-tenant Q&A system with complete admin CRUD operations
 * - Isolated per companyId for enterprise-grade multi-tenancy
 * - AI-generated Q&As based on business type and description
 * - Full edit/delete capabilities for admin management
 * - Zero legacy contamination - built from scratch
 */

const mongoose = require('mongoose');

const localCompanyQnASchema = new mongoose.Schema({
    // 🏢 Multi-tenant isolation
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'Company'
    },

    // 📝 Q&A Content
    question: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500
    },
    
    answer: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    },

    // 🏷️ Keywords for AI matching
    keywords: [{
        type: String,
        trim: true,
        lowercase: true
    }],

    // 📊 Metadata
    category: {
        type: String,
        default: 'general',
        enum: ['general', 'hours', 'services', 'pricing', 'emergency', 'insurance', 'location']
    },

    businessType: {
        type: String,
        required: true,
        lowercase: true,
        enum: ['dental', 'hvac', 'plumbing', 'electrical', 'auto', 'general']
    },

    // 🎯 AI Confidence & Performance
    confidence: {
        type: Number,
        default: 0.8,
        min: 0,
        max: 1
    },

    usageCount: {
        type: Number,
        default: 0
    },

    lastUsed: {
        type: Date,
        default: null
    },

    // 📈 Status Management
    status: {
        type: String,
        default: 'active',
        enum: ['active', 'inactive', 'draft', 'archived']
    },

    priority: {
        type: String,
        default: 'normal',
        enum: ['high', 'normal', 'low']
    },

    // 🤖 AI Generation Metadata
    aiGenerated: {
        type: Boolean,
        default: false
    },

    generationSource: {
        type: String,
        enum: ['ai_generated', 'admin_created', 'imported'],
        default: 'admin_created'
    },

    originalDescription: {
        type: String,
        trim: true,
        maxlength: 1000
    },

    // 👤 Admin Management
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    lastModifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // 📅 Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'localcompanyqnas' // Unique collection name
});

// 🔍 Indexes for performance
localCompanyQnASchema.index({ companyId: 1, status: 1 });
localCompanyQnASchema.index({ companyId: 1, businessType: 1 });
localCompanyQnASchema.index({ companyId: 1, category: 1 });
localCompanyQnASchema.index({ keywords: 1 });
localCompanyQnASchema.index({ createdAt: -1 });

// 🎯 Instance Methods
localCompanyQnASchema.methods.incrementUsage = function() {
    this.usageCount += 1;
    this.lastUsed = new Date();
    return this.save();
};

localCompanyQnASchema.methods.updateConfidence = function(newConfidence) {
    this.confidence = Math.max(0, Math.min(1, newConfidence));
    return this.save();
};

// 🔧 Static Methods
localCompanyQnASchema.statics.findByCompany = function(companyId, options = {}) {
    const query = { companyId, status: 'active' };
    
    if (options.businessType) {
        query.businessType = options.businessType;
    }
    
    if (options.category) {
        query.category = options.category;
    }
    
    return this.find(query)
        .sort({ priority: -1, confidence: -1, createdAt: -1 })
        .limit(options.limit || 50);
};

localCompanyQnASchema.statics.searchByKeywords = function(companyId, keywords, options = {}) {
    const query = {
        companyId,
        status: 'active',
        keywords: { $in: keywords }
    };
    
    return this.find(query)
        .sort({ confidence: -1, usageCount: -1 })
        .limit(options.limit || 10);
};

// 📊 Statistics
localCompanyQnASchema.statics.getCompanyStats = async function(companyId) {
    const stats = await this.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgConfidence: { $avg: '$confidence' },
                totalUsage: { $sum: '$usageCount' }
            }
        }
    ]);
    
    return stats.reduce((acc, stat) => {
        acc[stat._id] = {
            count: stat.count,
            avgConfidence: stat.avgConfidence,
            totalUsage: stat.totalUsage
        };
        return acc;
    }, {});
};

// 🔄 Pre-save middleware
localCompanyQnASchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Auto-generate keywords if empty
    if (!this.keywords || this.keywords.length === 0) {
        this.keywords = this.generateKeywords();
    }
    
    next();
});

// 🏷️ Keyword generation helper
localCompanyQnASchema.methods.generateKeywords = function() {
    const text = `${this.question} ${this.answer}`.toLowerCase();
    const words = text.match(/\b\w{3,}\b/g) || [];
    
    // Remove common stop words
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'man', 'men', 'put', 'say', 'she', 'too', 'use'];
    
    const keywords = [...new Set(words.filter(word => !stopWords.includes(word)))];
    
    return keywords.slice(0, 20); // Limit to 20 keywords
};

// 🏢 Export model
module.exports = mongoose.model('LocalCompanyQnA', localCompanyQnASchema);

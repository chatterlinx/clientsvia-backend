/**
 * 🏷️ TRADE CATEGORY MODEL
 * ========================
 * Mongoose model for Enterprise Trade Categories
 * Supports both global and company-specific categories
 * Optimized for AI Agent performance with Redis caching
 */

const mongoose = require('mongoose');

// Q&A Schema for embedded trade category questions
const TradeCategoryQnASchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true
    },
    question: {
        type: String,
        required: true,
        trim: true
    },
    answer: {
        type: String,
        required: true
    },
    keywords: [{
        type: String,
        lowercase: true,
        trim: true
    }],
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.75
    },
    difficulty: {
        type: String,
        enum: ['basic', 'intermediate', 'advanced', 'expert'],
        default: 'basic'
    },
    priority: {
        type: String,
        enum: ['low', 'normal', 'high', 'critical'],
        default: 'normal'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Main Trade Category Schema
const TradeCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    description: {
        type: String,
        trim: true
    },
    companyId: {
        type: String,
        required: true,
        index: true,
        // 'global' for shared categories, actual ObjectId for company-specific
        validate: {
            validator: function(v) {
                return v === 'global' || mongoose.Types.ObjectId.isValid(v);
            },
            message: 'CompanyId must be "global" or a valid ObjectId'
        }
    },
    qnas: [TradeCategoryQnASchema],
    
    // Auto-calculated fields
    totalQAs: {
        type: Number,
        default: 0
    },
    totalKeywords: {
        type: Number,
        default: 0
    },
    
    // Performance optimization
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Metadata
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: String,
        default: 'system'
    }
}, {
    // Enable automatic timestamps
    timestamps: true,
    
    // Optimize for queries
    collection: 'enterpriseTradeCategories'
});

// V2 OPTIMIZED INDEXES - Enterprise Performance
TradeCategorySchema.index({ companyId: 1, name: 1 }, { unique: true, name: 'v2_company_name_unique' });
TradeCategorySchema.index({ companyId: 1, isActive: 1 }, { name: 'v2_company_active' });
TradeCategorySchema.index({ 'qnas.keywords': 1 }, { name: 'v2_qna_keywords' });
TradeCategorySchema.index({ createdAt: 1 }, { name: 'v2_created_date' });

// Pre-save middleware to update calculated fields
TradeCategorySchema.pre('save', function(next) {
    // Update totalQAs and totalKeywords
    this.totalQAs = this.qnas ? this.qnas.filter(qna => qna.isActive).length : 0;
    this.totalKeywords = this.qnas ? 
        this.qnas.reduce((total, qna) => total + (qna.keywords ? qna.keywords.length : 0), 0) : 0;
    
    // Update timestamps
    this.updatedAt = new Date();
    
    next();
});

// Instance methods
TradeCategorySchema.methods.addQnA = function(qnaData) {
    const qna = {
        id: qnaData.id || new mongoose.Types.ObjectId().toString(),
        question: qnaData.question,
        answer: qnaData.answer,
        keywords: qnaData.keywords || [],
        confidence: qnaData.confidence || 0.75,
        difficulty: qnaData.difficulty || 'basic',
        priority: qnaData.priority || 'normal',
        isActive: qnaData.isActive !== false
    };
    
    this.qnas.push(qna);
    return qna;
};

TradeCategorySchema.methods.updateQnA = function(qnaId, updateData) {
    const qna = this.qnas.id(qnaId);
    if (qna) {
        Object.assign(qna, updateData);
        qna.updatedAt = new Date();
        return qna;
    }
    return null;
};

TradeCategorySchema.methods.removeQnA = function(qnaId) {
    const qna = this.qnas.id(qnaId);
    if (qna) {
        qna.remove();
        return true;
    }
    return false;
};

// Static methods
TradeCategorySchema.statics.findGlobal = function() {
    return this.find({ companyId: 'global', isActive: true }).sort({ name: 1 });
};

TradeCategorySchema.statics.findByCompany = function(companyId, includeGlobal = true) {
    const query = includeGlobal ? 
        { $or: [{ companyId }, { companyId: 'global' }], isActive: true } :
        { companyId, isActive: true };
    
    return this.find(query).sort({ name: 1 });
};

TradeCategorySchema.statics.searchQnAs = function(searchTerm, companyId = null) {
    const matchStage = {
        isActive: true,
        'qnas.isActive': true,
        $or: [
            { 'qnas.question': { $regex: searchTerm, $options: 'i' } },
            { 'qnas.answer': { $regex: searchTerm, $options: 'i' } },
            { 'qnas.keywords': { $in: [new RegExp(searchTerm, 'i')] } }
        ]
    };
    
    if (companyId) {
        matchStage.$or = [
            { companyId },
            { companyId: 'global' }
        ];
    }
    
    return this.aggregate([
        { $match: matchStage },
        { $unwind: '$qnas' },
        { $match: { 'qnas.isActive': true } },
        { $sort: { 'qnas.confidence': -1 } }
    ]);
};

module.exports = mongoose.model('TradeCategory', TradeCategorySchema);

/**
 * 🏢 COMPANY Q&A CATEGORY MODEL
 * =============================
 * Mongoose model for Company-Specific Q&A Categories
 * 100% SEPARATE from Global Trade Categories
 * Each company can create their own categories and Q&As
 */

const mongoose = require('mongoose');

// Q&A Schema for company-specific questions
const CompanyQnASchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
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
        default: 0.85
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

// Main Company Q&A Category Schema
const CompanyQnACategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    companyId: {
        type: String,
        required: true,
        index: true,
        validate: {
            validator(v) {
                return mongoose.Types.ObjectId.isValid(v);
            },
            message: 'CompanyId must be a valid ObjectId'
        }
    },
    qnas: [CompanyQnASchema],
    
    // Auto-calculated fields
    totalQAs: {
        type: Number,
        default: 0
    },
    totalKeywords: {
        type: Number,
        default: 0
    },
    
    isActive: {
        type: Boolean,
        default: true
    },
    
    metadata: {
        totalQAs: { type: Number, default: 0 },
        totalKeywords: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now },
        version: { type: String, default: '1.0.0' }
    },
    
    audit: {
        createdAt: { type: Date, default: Date.now },
        createdBy: { type: String, default: 'admin' },
        updatedAt: { type: Date, default: Date.now },
        updatedBy: { type: String, default: 'admin' }
    }
}, {
    timestamps: true,
    collection: 'companyqnacategories' // 🎯 SEPARATE COLLECTION!
});

// 🎯 COMPANY-SPECIFIC INDEXES
// Compound unique index: Each company can have unique category names
CompanyQnACategorySchema.index({ companyId: 1, name: 1 }, { unique: true, name: 'company_qna_unique' });
CompanyQnACategorySchema.index({ companyId: 1, isActive: 1 }, { name: 'company_qna_active' });
CompanyQnACategorySchema.index({ 'qnas.keywords': 1 }, { name: 'company_qna_keywords' });
CompanyQnACategorySchema.index({ createdAt: 1 }, { name: 'company_qna_created' });

// Pre-save middleware to update calculated fields
CompanyQnACategorySchema.pre('save', function(next) {
    // Update totalQAs and totalKeywords
    this.totalQAs = this.qnas ? this.qnas.filter(qna => qna.isActive).length : 0;
    this.totalKeywords = this.qnas ? 
        this.qnas.reduce((total, qna) => total + (qna.keywords ? qna.keywords.length : 0), 0) : 0;
    
    // Update metadata
    if (this.metadata) {
        this.metadata.totalQAs = this.totalQAs;
        this.metadata.totalKeywords = this.totalKeywords;
        this.metadata.lastUpdated = new Date();
    }
    
    // Update audit
    if (this.audit) {
        this.audit.updatedAt = new Date();
    }
    
    next();
});

// Instance methods
CompanyQnACategorySchema.methods.addQnA = function(qnaData) {
    const qna = {
        id: qnaData.id || new mongoose.Types.ObjectId().toString(),
        question: qnaData.question,
        answer: qnaData.answer,
        keywords: qnaData.keywords || [],
        confidence: qnaData.confidence || 0.85,
        isActive: qnaData.isActive !== false,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    this.qnas.push(qna);
    return qna;
};

CompanyQnACategorySchema.methods.updateQnA = function(qnaId, updateData) {
    const qna = this.qnas.id(qnaId);
    if (qna) {
        Object.assign(qna, updateData);
        qna.updatedAt = new Date();
        return qna;
    }
    return null;
};

CompanyQnACategorySchema.methods.removeQnA = function(qnaId) {
    const qna = this.qnas.id(qnaId);
    if (qna) {
        qna.remove();
        return true;
    }
    return false;
};

// Static methods
CompanyQnACategorySchema.statics.findByCompany = function(companyId) {
    return this.find({ companyId, isActive: true }).sort({ name: 1 });
};

CompanyQnACategorySchema.statics.searchQnAs = function(searchTerm, companyId) {
    const matchStage = {
        companyId,
        isActive: true,
        'qnas.isActive': true,
        $or: [
            { 'qnas.question': { $regex: searchTerm, $options: 'i' } },
            { 'qnas.answer': { $regex: searchTerm, $options: 'i' } },
            { 'qnas.keywords': { $in: [new RegExp(searchTerm, 'i')] } }
        ]
    };
    
    return this.aggregate([
        { $match: matchStage },
        { $unwind: '$qnas' },
        { $match: { 'qnas.isActive': true } },
        { $sort: { 'qnas.confidence': -1 } }
    ]);
};

module.exports = mongoose.model('CompanyQnACategory', CompanyQnACategorySchema);


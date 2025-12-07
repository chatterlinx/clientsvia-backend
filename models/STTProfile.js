/**
 * STTProfile.js - Speech-to-Text Configuration Model
 * 
 * Enterprise-grade STT intelligence system
 * One profile per template - complete isolation between industries
 * 
 * Features:
 * - Provider-agnostic (Twilio/Deepgram/Google)
 * - Filler word stripping
 * - Mishear corrections with context awareness
 * - Domain vocabulary boosting
 * - Auto-learning from Black Box
 * - GDPR-compliant with data retention
 * 
 * @module models/STTProfile
 * @version 1.0.0
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

const FillerSchema = new Schema({
    phrase: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 50
    },
    scope: {
        type: String,
        enum: ['global', 'template'],
        default: 'template'
    },
    enabled: { type: Boolean, default: true },
    addedBy: { type: String, default: 'system' },
    lastSeenAt: Date,
    lastSeenCallId: String,
    occurrences: { type: Number, default: 0 }
}, { _id: false });

const BoostedKeywordSchema = new Schema({
    phrase: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    type: {
        type: String,
        enum: ['triage_card', 'scenario', 'technician', 'service', 'location', 'manual'],
        default: 'manual'
    },
    source: { type: String, trim: true, maxlength: 200 },
    boostWeight: { type: Number, min: 1, max: 10, default: 5 },
    enabled: { type: Boolean, default: true }
}, { _id: false });

const CorrectionSchema = new Schema({
    heard: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 50
    },
    normalized: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    context: [{ type: String, trim: true, lowercase: true }],
    contextWindow: { type: Number, min: 1, max: 10, default: 5 },
    enabled: { type: Boolean, default: true },
    occurrences: { type: Number, default: 0 },
    lastSeenAt: Date,
    notes: { type: String, maxlength: 200 }
}, { _id: false });

const ImpossibleWordSchema = new Schema({
    word: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 50
    },
    reason: { type: String, trim: true, maxlength: 200 },
    suggestCorrection: { type: String, trim: true, maxlength: 50 },
    enabled: { type: Boolean, default: true }
}, { _id: false });

const SuggestionSchema = new Schema({
    type: {
        type: String,
        enum: ['filler', 'correction', 'vocabulary', 'impossible'],
        required: true
    },
    phrase: { type: String, required: true, trim: true, maxlength: 100 },
    context: { type: String, trim: true, maxlength: 200 },
    suggestedCorrection: { type: String, trim: true, maxlength: 50 },
    confidenceScore: { type: Number, min: 0, max: 1, default: 0.5 },
    count: { type: Number, default: 1 },
    lastSeenAt: Date,
    lastSeenCallId: String,
    status: {
        type: String,
        enum: ['pending', 'approved', 'ignored'],
        default: 'pending'
    },
    reviewedBy: String,
    reviewedAt: Date
}, { _id: false });

// ============================================================================
// MAIN SCHEMA
// ============================================================================

const STTProfileSchema = new Schema({
    // IDENTITY
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        unique: true,
        index: true
    },
    templateName: { type: String, required: true, trim: true, maxlength: 100 },
    templateSlug: { type: String, trim: true, lowercase: true },
    
    // PROVIDER CONFIG
    provider: {
        type: { type: String, enum: ['twilio', 'deepgram', 'google', 'whisper'], default: 'twilio' },
        language: { type: String, default: 'en-US' },
        model: { type: String, default: 'phone_call' },
        useHints: { type: Boolean, default: true },
        applyFillers: { type: Boolean, default: true },
        applyCorrections: { type: Boolean, default: true },
        applyImpossibleWords: { type: Boolean, default: true },
        maxHintChars: { type: Number, default: 1000, min: 100, max: 5000 },
        prioritizeByOccurrence: { type: Boolean, default: true }
    },
    
    // FILLERS
    fillers: {
        type: [FillerSchema],
        default: [],
        validate: { validator: v => v.length <= 500, message: 'Fillers limit: 500' }
    },
    
    // VOCABULARY
    vocabulary: {
        boostedKeywords: {
            type: [BoostedKeywordSchema],
            default: [],
            validate: { validator: v => v.length <= 1000, message: 'Keywords limit: 1000' }
        },
        autoSyncTriageCards: { type: Boolean, default: true },
        autoSyncScenarios: { type: Boolean, default: true },
        autoSyncTechnicianNames: { type: Boolean, default: true },
        autoSyncServiceNames: { type: Boolean, default: true },
        lastSyncAt: Date,
        lastSyncStats: {
            triageCardKeywords: Number,
            scenarioKeywords: Number,
            technicianNames: Number,
            serviceNames: Number
        }
    },
    
    // CORRECTIONS
    corrections: {
        type: [CorrectionSchema],
        default: [],
        validate: { validator: v => v.length <= 500, message: 'Corrections limit: 500' }
    },
    
    // IMPOSSIBLE WORDS
    impossibleWords: {
        type: [ImpossibleWordSchema],
        default: [],
        validate: { validator: v => v.length <= 200, message: 'Impossible words limit: 200' }
    },
    
    // SUGGESTIONS
    suggestions: {
        type: [SuggestionSchema],
        default: [],
        validate: { validator: v => v.length <= 1000, message: 'Suggestions limit: 1000' }
    },
    
    // METRICS
    metrics: {
        totalCallsProcessed: { type: Number, default: 0 },
        fillersStripped: { type: Number, default: 0 },
        correctionsApplied: { type: Number, default: 0 },
        impossibleWordsBlocked: { type: Number, default: 0 },
        lastProcessedAt: Date
    },
    
    // COMPLIANCE
    compliance: {
        retainCallIdsForDays: { type: Number, default: 30, min: 7, max: 365 },
        anonymizeAfterDays: { type: Number, default: 90 },
        lastCleanupAt: Date
    },
    
    // VERSIONING
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    
    changelog: [{
        action: String,
        field: String,
        oldValue: Schema.Types.Mixed,
        newValue: Schema.Types.Mixed,
        changedBy: String,
        changedAt: { type: Date, default: Date.now }
    }]
    
}, { timestamps: true, collection: 'stt_profiles' });

// ============================================================================
// INDEXES
// ============================================================================

STTProfileSchema.index({ templateId: 1 }, { unique: true });
STTProfileSchema.index({ 'fillers.phrase': 1 });
STTProfileSchema.index({ 'corrections.heard': 1 });
STTProfileSchema.index({ 'suggestions.status': 1, 'suggestions.count': -1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

STTProfileSchema.pre('save', function(next) {
    if (this.isModified() && !this.isNew) {
        this.version += 1;
    }
    next();
});

// ============================================================================
// METHODS
// ============================================================================

STTProfileSchema.methods.buildHints = function() {
    if (!this.provider.useHints) return '';
    
    const enabledKeywords = this.vocabulary.boostedKeywords
        .filter(k => k.enabled)
        .sort((a, b) => b.boostWeight - a.boostWeight);
    
    let hints = [];
    let totalChars = 0;
    const maxChars = this.provider.maxHintChars || 1000;
    
    for (const keyword of enabledKeywords) {
        if (totalChars + keyword.phrase.length + 2 > maxChars) break;
        hints.push(keyword.phrase);
        totalChars += keyword.phrase.length + 2;
    }
    
    return hints.join(', ');
};

STTProfileSchema.methods.checkImpossibleWord = function(word) {
    if (!this.provider.applyImpossibleWords) return { isImpossible: false };
    
    const normalized = word.toLowerCase().trim();
    const match = this.impossibleWords.find(iw => iw.enabled && iw.word === normalized);
    
    if (match) {
        return {
            isImpossible: true,
            word: match.word,
            reason: match.reason,
            suggestion: match.suggestCorrection
        };
    }
    return { isImpossible: false };
};

STTProfileSchema.methods.addSuggestion = function(suggestion) {
    const existing = this.suggestions.find(s => 
        s.phrase.toLowerCase() === suggestion.phrase.toLowerCase() &&
        s.type === suggestion.type &&
        s.status === 'pending'
    );
    
    if (existing) {
        existing.count += 1;
        existing.lastSeenAt = new Date();
        if (suggestion.lastSeenCallId) existing.lastSeenCallId = suggestion.lastSeenCallId;
        existing.confidenceScore = Math.min(1, existing.confidenceScore + 0.05);
        return false;
    }
    
    if (this.suggestions.length >= 1000) {
        const ignoredIndex = this.suggestions.findIndex(s => s.status === 'ignored');
        if (ignoredIndex > -1) this.suggestions.splice(ignoredIndex, 1);
        else {
            this.suggestions.sort((a, b) => a.count - b.count);
            this.suggestions.shift();
        }
    }
    
    this.suggestions.push({ ...suggestion, lastSeenAt: new Date(), status: 'pending' });
    return true;
};

STTProfileSchema.methods.approveSuggestion = function(suggestionIndex, approvalData = {}) {
    const suggestion = this.suggestions[suggestionIndex];
    if (!suggestion) return { success: false, error: 'Suggestion not found' };
    
    let result = { success: true, type: suggestion.type };
    
    switch (suggestion.type) {
        case 'filler':
            this.fillers.push({
                phrase: suggestion.phrase.toLowerCase(),
                scope: approvalData.scope || 'template',
                enabled: true,
                addedBy: approvalData.approvedBy || 'admin',
                occurrences: suggestion.count
            });
            result.addedTo = 'fillers';
            break;
        case 'correction':
            this.corrections.push({
                heard: suggestion.phrase.toLowerCase(),
                normalized: approvalData.normalized || suggestion.suggestedCorrection,
                context: approvalData.context || [],
                enabled: true,
                occurrences: suggestion.count,
                notes: 'Auto-approved from suggestion'
            });
            result.addedTo = 'corrections';
            break;
        case 'vocabulary':
            this.vocabulary.boostedKeywords.push({
                phrase: suggestion.phrase,
                type: 'manual',
                source: 'Approved from Black Box',
                boostWeight: 5,
                enabled: true
            });
            result.addedTo = 'vocabulary.boostedKeywords';
            break;
        case 'impossible':
            this.impossibleWords.push({
                word: suggestion.phrase.toLowerCase(),
                reason: approvalData.reason || 'Flagged by Black Box',
                suggestCorrection: suggestion.suggestedCorrection,
                enabled: true
            });
            result.addedTo = 'impossibleWords';
            break;
    }
    
    suggestion.status = 'approved';
    suggestion.reviewedBy = approvalData.approvedBy || 'admin';
    suggestion.reviewedAt = new Date();
    
    return result;
};

// ============================================================================
// STATICS
// ============================================================================

STTProfileSchema.statics.getByTemplateId = async function(templateId) {
    return this.findOne({ templateId, isActive: true }).lean();
};

STTProfileSchema.statics.createDefaultForTemplate = async function(template) {
    const defaultFillers = [
        { phrase: 'uh', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'um', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'like', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'you know', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'basically', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'i mean', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'sort of', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'kind of', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'okay so', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'well', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'hi', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'hello', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'hey', scope: 'global', enabled: true, addedBy: 'system' },
        { phrase: 'honey', scope: 'template', enabled: true, addedBy: 'system' },
        { phrase: 'dear', scope: 'template', enabled: true, addedBy: 'system' }
    ];
    
    const templateFillers = template.fillerWords || template.nlpSettings?.fillerWords || [];
    for (const filler of templateFillers) {
        if (!defaultFillers.find(f => f.phrase === filler.toLowerCase())) {
            defaultFillers.push({ phrase: filler.toLowerCase(), scope: 'template', enabled: true, addedBy: 'system' });
        }
    }
    
    const boostedKeywords = [];
    
    if (template.scenarios) {
        for (const scenario of template.scenarios) {
            if (scenario.keywords) {
                for (const kw of scenario.keywords) {
                    boostedKeywords.push({ phrase: kw, type: 'scenario', source: scenario.name || 'Scenario', boostWeight: 5, enabled: true });
                }
            }
            if (scenario.triggers) {
                for (const trigger of scenario.triggers) {
                    boostedKeywords.push({ phrase: trigger, type: 'scenario', source: scenario.name || 'Scenario', boostWeight: 6, enabled: true });
                }
            }
        }
    }
    
    if (template.categories) {
        for (const category of template.categories) {
            if (category.triageCards) {
                for (const card of category.triageCards) {
                    if (card.keywords) {
                        for (const kw of card.keywords) {
                            boostedKeywords.push({ phrase: kw, type: 'triage_card', source: card.issue || category.name, boostWeight: 7, enabled: true });
                        }
                    }
                    if (card.issue) {
                        boostedKeywords.push({ phrase: card.issue, type: 'triage_card', source: category.name, boostWeight: 7, enabled: true });
                    }
                }
            }
        }
    }
    
    const uniqueKeywords = [];
    const seenPhrases = new Set();
    for (const kw of boostedKeywords) {
        const norm = kw.phrase.toLowerCase().trim();
        if (!seenPhrases.has(norm)) {
            seenPhrases.add(norm);
            uniqueKeywords.push(kw);
        }
    }
    
    return this.create({
        templateId: template._id,
        templateName: template.name || 'Unknown Template',
        templateSlug: (template.name || '').toLowerCase().replace(/\s+/g, '-'),
        provider: {
            type: 'twilio',
            language: 'en-US',
            model: 'phone_call',
            useHints: true,
            applyFillers: true,
            applyCorrections: true,
            applyImpossibleWords: true
        },
        fillers: defaultFillers,
        vocabulary: {
            boostedKeywords: uniqueKeywords,
            autoSyncTriageCards: true,
            autoSyncScenarios: true,
            autoSyncTechnicianNames: true,
            autoSyncServiceNames: true,
            lastSyncAt: new Date(),
            lastSyncStats: {
                triageCardKeywords: uniqueKeywords.filter(k => k.type === 'triage_card').length,
                scenarioKeywords: uniqueKeywords.filter(k => k.type === 'scenario').length,
                technicianNames: 0,
                serviceNames: 0
            }
        },
        corrections: [],
        impossibleWords: [],
        suggestions: [],
        isActive: true
    });
};

module.exports = mongoose.model('STTProfile', STTProfileSchema);

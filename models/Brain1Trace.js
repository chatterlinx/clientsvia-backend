/**
 * ============================================================================
 * BRAIN-1 TRACE SCHEMA
 * ============================================================================
 * 
 * PURPOSE: Per-turn trace documents for LLM-0 Cortex-Intel debugging
 * 
 * STORED: One document per turn in the call
 * READ BY: /api/llm0/trace/:callId endpoint → LLM-0 Cortex-Intel UI
 * 
 * TRACE SHOWS:
 * - What Brain-1 saw (raw vs normalized text)
 * - What decision it made (action, intent, flags)
 * - Whether it called Brain-2 and which scenario Tier picked
 * - Final spoken text
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const Brain1TraceSchema = new Schema({
    // ========================================================================
    // IDENTIFIERS
    // ========================================================================
    callId: {
        type: String,
        required: true,
        index: true
    },
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true
    },
    turn: {
        type: Number,
        required: true
    },
    
    // ========================================================================
    // INPUT (What Brain-1 Saw)
    // ========================================================================
    input: {
        rawText: { type: String, required: true },
        normalizedText: { type: String, required: true },
        tokensStripped: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // EMOTION DETECTION
    // ========================================================================
    emotion: {
        primary: { 
            type: String, 
            enum: ['NEUTRAL', 'HUMOROUS', 'FRUSTRATED', 'ANGRY', 'STRESSED', 'PANICKED', 'SAD', 'URGENT'],
            default: 'NEUTRAL'
        },
        intensity: { type: Number, min: 0, max: 1, default: 0 },
        signals: [{ type: String }]
    },
    
    // ========================================================================
    // BRAIN-1 DECISION
    // ========================================================================
    decision: {
        action: {
            type: String,
            enum: [
                'ROUTE_TO_SCENARIO',  // → Brain-2 (3-Tier)
                'TRANSFER',           // → Transfer Handler
                'BOOK',               // → Booking Handler
                'ASK_FOLLOWUP',       // Stay in Brain-1, ask for more info
                'MESSAGE_ONLY',       // Just speak, no further routing
                'END',                // End the call
                'UNKNOWN'             // Couldn't determine
            ],
            required: true
        },
        triageTag: { type: String, default: null },  // e.g. 'SMELL_OF_GAS', 'NO_COOL'
        intentTag: { type: String, default: null },  // e.g. 'emergency', 'booking', 'info'
        confidence: { type: Number, min: 0, max: 1, default: 0 },
        reasoning: { type: String, default: null }
    },
    
    // ========================================================================
    // ENTITIES EXTRACTED
    // ========================================================================
    entities: {
        contact: {
            name: { type: String, default: null },
            phone: { type: String, default: null },
            email: { type: String, default: null }
        },
        location: {
            addressLine1: { type: String, default: null },
            city: { type: String, default: null },
            state: { type: String, default: null },
            zip: { type: String, default: null }
        },
        problem: {
            summary: { type: String, default: null },
            category: { type: String, default: null },
            urgency: { type: String, enum: ['normal', 'urgent', 'emergency'], default: 'normal' }
        },
        scheduling: {
            preferredDate: { type: String, default: null },
            preferredWindow: { type: String, default: null }
        }
    },
    
    // ========================================================================
    // FLAGS
    // ========================================================================
    flags: {
        needsKnowledgeSearch: { type: Boolean, default: false },
        isEmergency: { type: Boolean, default: false },
        isFrustrated: { type: Boolean, default: false },
        isSpam: { type: Boolean, default: false },
        isWrongNumber: { type: Boolean, default: false },
        readyToBook: { type: Boolean, default: false },
        wantsHuman: { type: Boolean, default: false }
    },
    
    // ========================================================================
    // BRAIN-2 RESULT (if called)
    // ========================================================================
    brain2: {
        called: { type: Boolean, default: false },
        tier: { type: Number, enum: [0, 1, 2, 3], default: 0 },
        scenarioId: { type: String, default: null },
        scenarioName: { type: String, default: null },
        confidence: { type: Number, min: 0, max: 1, default: 0 },
        responseText: { type: String, default: null },
        cost: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // TRIAGE RESULT
    // ========================================================================
    triage: {
        route: { 
            type: String, 
            enum: ['SCENARIO_ENGINE', 'TRANSFER', 'BOOKING_FLOW', 'MESSAGE_ONLY', 'END_CALL', null],
            default: null
        },
        matchedCardId: { type: String, default: null },
        matchedCardName: { type: String, default: null },
        reason: { type: String, default: null }
    },
    
    // ========================================================================
    // OUTPUT (What Brain-1 Spoke)
    // ========================================================================
    output: {
        spokenText: { type: String, default: null },
        action: { type: String, default: null },  // Final action taken
        nextState: { type: String, default: null }
    },
    
    // ========================================================================
    // PERFORMANCE
    // ========================================================================
    performance: {
        preprocessingMs: { type: Number, default: 0 },
        emotionMs: { type: Number, default: 0 },
        brain1Ms: { type: Number, default: 0 },
        triageMs: { type: Number, default: 0 },
        brain2Ms: { type: Number, default: 0 },
        guardrailsMs: { type: Number, default: 0 },
        totalMs: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // TIMESTAMPS
    // ========================================================================
    timestamps: {
        received: { type: Date, default: Date.now },
        preprocessed: { type: Date, default: null },
        brain1Complete: { type: Date, default: null },
        brain2Complete: { type: Date, default: null },
        responded: { type: Date, default: null }
    }
    
}, {
    timestamps: true,
    collection: 'brain1traces'
});

// ============================================================================
// INDEXES
// ============================================================================
Brain1TraceSchema.index({ callId: 1, turn: 1 }, { unique: true });
Brain1TraceSchema.index({ companyId: 1, createdAt: -1 });
Brain1TraceSchema.index({ 'decision.action': 1, createdAt: -1 });
Brain1TraceSchema.index({ 'brain2.tier': 1, createdAt: -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get all traces for a call
 */
Brain1TraceSchema.statics.getCallTrace = async function(callId) {
    return this.find({ callId }).sort({ turn: 1 }).lean();
};

/**
 * Get latest trace for a call
 */
Brain1TraceSchema.statics.getLatestTurn = async function(callId) {
    return this.findOne({ callId }).sort({ turn: -1 }).lean();
};

/**
 * Log a turn (upsert)
 */
Brain1TraceSchema.statics.logTurn = async function(traceData) {
    const { callId, turn } = traceData;
    
    return this.findOneAndUpdate(
        { callId, turn },
        { $set: traceData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

module.exports = mongoose.model('Brain1Trace', Brain1TraceSchema);


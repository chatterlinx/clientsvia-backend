/**
 * ============================================================================
 * CONVERSATION SESSION MODEL - Unified Session Tracking Across All Channels
 * ============================================================================
 * 
 * Every customer interaction creates a session. This is what appears in
 * the Call Center dashboard. One session = one conversation (regardless of
 * whether it's a phone call, SMS thread, or website chat).
 * 
 * CHANNELS:
 * - voice: Twilio phone call
 * - sms: Twilio SMS thread
 * - website: Website chat widget
 * 
 * LIFECYCLE:
 * 1. Session created when interaction starts
 * 2. Turns added as conversation progresses
 * 3. Session ends when call/chat ends or times out
 * 4. Running summary updated each turn
 * 5. Outcome recorded at end
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// --- Sub-schema for individual turn ---
const turnSchema = new Schema({
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    
    // Processing metadata
    latencyMs: { type: Number },
    tokensUsed: { type: Number },
    responseSource: { type: String },
    confidence: { type: Number, min: 0, max: 1 },
    
    // Slot extraction
    slotsExtracted: { type: Schema.Types.Mixed, default: {} },
    
    // For voice calls
    speechToText: {
        transcript: { type: String },
        confidence: { type: Number },
        duration: { type: Number }
    }
}, { _id: true });

// --- Main Session Schema ---
const conversationSessionSchema = new Schema({
    companyId: { 
        type: Schema.Types.ObjectId, 
        ref: 'v2Company', 
        required: true,
        index: true
    },
    
    customerId: { 
        type: Schema.Types.ObjectId, 
        ref: 'Customer',
        index: true
    },
    
    channel: {
        type: String,
        enum: ['voice', 'sms', 'website'],
        required: true,
        index: true
    },
    
    channelIdentifiers: {
        twilioCallSid: { type: String, index: true },
        callerPhone: { type: String },
        calledNumber: { type: String },
        smsThreadId: { type: String, index: true },
        smsPhone: { type: String },
        websiteSessionId: { type: String, index: true },
        visitorIp: { type: String },
        userAgent: { type: String },
        pageUrl: { type: String }
    },
    
    turns: [turnSchema],
    runningSummary: [{ type: String }],
    collectedSlots: { type: Schema.Types.Mixed, default: {} },
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🆕 DISCOVERY - What we learned about why they called (Enterprise Flow)
    // ════════════════════════════════════════════════════════════════════════════
    // Captured in DISCOVERY stage, persists throughout call
    // Used by LLM fallback to give intelligent, contextual responses
    // ════════════════════════════════════════════════════════════════════════════
    discovery: {
        // What's the caller's problem/need?
        issue: { type: String, default: null, trim: true },          // "thermostat acting up"
        issueConfidence: { type: Number, default: 0, min: 0, max: 1 }, // 🆕 Confidence score
        
        // Any relevant context they provided?
        context: { type: String, default: null, trim: true },        // "tech was here yesterday"
        contextConfidence: { type: Number, default: 0, min: 0, max: 1 }, // 🆕 Confidence score
        
        // What type of call is this?
        callType: { 
            type: String, 
            enum: ['service_issue', 'question', 'booking', 'billing', 'complaint', 'followup', 'unknown'],
            default: 'unknown'
        },
        callTypeConfidence: { type: Number, default: 0, min: 0, max: 1 }, // 🆕 Confidence score
        
        // Urgency level
        urgency: { 
            type: String, 
            enum: ['normal', 'repeat_issue', 'urgent', 'emergency'],
            default: 'normal'
        },
        
        // Caller's emotional state
        mood: { 
            type: String, 
            enum: ['neutral', 'frustrated', 'angry', 'anxious', 'friendly', 'confused'],
            default: 'neutral'
        },
        moodConfidence: { type: Number, default: 0, min: 0, max: 1 }, // 🆕 Confidence score
        
        // When was discovery completed?
        completedAt: { type: Date, default: null },
        
        // Turn number when issue was captured
        issueCapturedAtTurn: { type: Number, default: null }
    },
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🆕 TRIAGE STATE - Diagnostic flow tracking (Enterprise Flow)
    // ════════════════════════════════════════════════════════════════════════════
    // Tracks which triage card matched and what diagnostic questions were asked
    // ════════════════════════════════════════════════════════════════════════════
    triageState: {
        // Which triage card matched?
        matchedCardId: { type: String, default: null },
        matchedCardName: { type: String, default: null },
        
        // Diagnostic questions asked and answers received
        questionsAsked: [{ 
            question: { type: String },
            turnNumber: { type: Number },
            askedAt: { type: Date, default: Date.now }
        }],
        
        answersReceived: [{
            question: { type: String },
            answer: { type: String },
            turnNumber: { type: Number },
            receivedAt: { type: Date, default: Date.now }
        }],
        
        // Triage outcome
        outcome: { 
            type: String, 
            enum: ['needs_technician', 'self_resolve', 'escalate', 'more_info_needed', 'pending'],
            default: 'pending'
        },
        
        // Diagnosis summary (for confirmation)
        diagnosisSummary: { type: String, default: null, trim: true },
        
        // When was triage completed?
        completedAt: { type: Date, default: null }
    },
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🆕 CONVERSATION MEMORY - Full context for LLM fallback (Enterprise Flow)
    // ════════════════════════════════════════════════════════════════════════════
    // This is what the LLM sees when handling off-rails situations
    // Enables intelligent, contextual responses that reference the actual conversation
    // ════════════════════════════════════════════════════════════════════════════
    conversationMemory: {
        // Topics we've discussed (for "we already talked about X")
        discussedTopics: [{
            topic: { type: String, trim: true },
            turnNumber: { type: Number },
            resolved: { type: Boolean, default: false },
            timestamp: { type: Date, default: Date.now }
        }],
        
        // Key facts to remember (for intelligent responses)
        keyFacts: [{ type: String, trim: true }],
        
        // Off-rails recovery attempts (for escalation tracking)
        recoveryAttempts: [{
            trigger: { type: String },          // What triggered off-rails
            response: { type: String },         // What we said
            turnNumber: { type: Number },
            timestamp: { type: Date, default: Date.now }
        }],
        
        // Current stage in the flow
        currentStage: { 
            type: String, 
            enum: ['greeting', 'discovery', 'triage', 'booking', 'confirmation', 'complete', 'escalated', 'stalled'],
            default: 'greeting'
        },
        
        // Current step within the stage (e.g., 'ASK_NAME' within 'booking')
        currentStep: { type: String, default: null },
        
        // 🆕 ENTERPRISE: Turns spent in current stage (for stuck detection)
        turnsInCurrentStage: { type: Number, default: 0 },
        
        // 🆕 ENTERPRISE: Is LLM fallback currently active?
        isFallbackActive: { type: Boolean, default: false },
        
        // How many times we've gone off-rails this call
        offRailsCount: { type: Number, default: 0 },
        
        // Last time we went off-rails
        lastOffRailsAt: { type: Date, default: null },
        
        // 🆕 ENTERPRISE: Last system prompt (for context)
        lastSystemPrompt: { type: String, default: null, trim: true },
        
        // 🆕 ENTERPRISE: Booking confirmed flag
        bookingConfirmed: { type: Boolean, default: false },
        
        // 🆕 ENTERPRISE: Missing slots array (for deterministic collection)
        missingSlots: [{ type: String }],
        
        // 🆕 ENTERPRISE: Audit trail (complete history of decisions)
        auditTrail: [{
            turn: { type: Number },
            timestamp: { type: String },
            stage: { type: String },
            step: { type: String },
            type: { type: String },  // RESPONSE, STAGE_TRANSITION, OFF_RAILS, STUCK_DETECTED
            data: { type: Schema.Types.Mixed }
        }]
    },
    
    // ════════════════════════════════════════════════════════════════════════
    // STATE MACHINE FIELDS - For deterministic booking flow
    // ════════════════════════════════════════════════════════════════════════
    stateMachine: {
        lastAction: { type: String, default: null },      // e.g., 'ASK_NAME', 'ASK_PHONE'
        askCount: { type: Schema.Types.Mixed, default: {} }, // { name: 1, phone: 2 } - track attempts
        state: { type: String, default: 'INIT' }          // INIT, COLLECTING, CONFIRMING, COMPLETE
    },
    
    status: {
        type: String,
        enum: ['active', 'ended', 'transferred', 'abandoned', 'error'],
        default: 'active',
        index: true
    },
    
    phase: {
        type: String,
        enum: ['greeting', 'discovery', 'decision', 'booking', 'complete', 'transfer'],
        default: 'greeting'
    },
    
    outcome: {
        type: String,
        enum: [
            'booked',
            'answered',
            'transferred',
            'callback_requested',
            'abandoned',
            'no_action',
            'error'
        ],
        default: 'no_action'
    },
    
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    
    transferredTo: {
        name: { type: String },
        phone: { type: String },
        reason: { type: String }
    },
    
    signals: {
        isUrgent: { type: Boolean, default: false },
        isCallback: { type: Boolean, default: false },
        wasEscalated: { type: Boolean, default: false },
        customerFrustrated: { type: Boolean, default: false },
        isVIP: { type: Boolean, default: false }
    },
    
    metrics: {
        totalTurns: { type: Number, default: 0 },
        durationSeconds: { type: Number },
        avgLatencyMs: { type: Number },
        totalTokens: { type: Number, default: 0 },
        llmTurns: { type: Number, default: 0 },
        templateTurns: { type: Number, default: 0 },
        quickAnswerTurns: { type: Number, default: 0 }
    },
    
    recording: {
        url: { type: String },
        sid: { type: String },
        duration: { type: Number }
    },
    
    startedAt: { type: Date, default: Date.now, index: true },
    lastActivityAt: { type: Date, default: Date.now },
    endedAt: { type: Date }
    
}, { 
    timestamps: true,
    collection: 'conversation_sessions'
});

// INDEXES
conversationSessionSchema.index({ companyId: 1, startedAt: -1 });
conversationSessionSchema.index({ companyId: 1, channel: 1, startedAt: -1 });
conversationSessionSchema.index({ companyId: 1, status: 1, lastActivityAt: -1 });
conversationSessionSchema.index({ customerId: 1, startedAt: -1 });

// INSTANCE METHODS

conversationSessionSchema.methods.addTurn = function(role, content, metadata = {}) {
    const turn = {
        role,
        content,
        timestamp: new Date(),
        latencyMs: metadata.latencyMs,
        tokensUsed: metadata.tokensUsed,
        responseSource: metadata.responseSource,
        confidence: metadata.confidence,
        slotsExtracted: metadata.slotsExtracted || {},
        speechToText: metadata.speechToText
    };
    
    this.turns.push(turn);
    this.metrics.totalTurns = this.turns.length;
    this.lastActivityAt = new Date();
    
    if (metadata.responseSource === 'llm') {
        this.metrics.llmTurns = (this.metrics.llmTurns || 0) + 1;
    } else if (metadata.responseSource === 'template' || metadata.responseSource === 'triage') {
        this.metrics.templateTurns = (this.metrics.templateTurns || 0) + 1;
    } else if (metadata.responseSource === 'quick_answer') {
        this.metrics.quickAnswerTurns = (this.metrics.quickAnswerTurns || 0) + 1;
    } else if (metadata.responseSource === 'STATE_MACHINE') {
        // State machine turns don't use LLM - track separately
        this.metrics.templateTurns = (this.metrics.templateTurns || 0) + 1;
    }
    
    // Update state machine state if provided
    if (metadata.stateMachine) {
        this.stateMachine = {
            ...this.stateMachine,
            ...metadata.stateMachine
        };
    }
    
    if (metadata.tokensUsed) {
        this.metrics.totalTokens = (this.metrics.totalTokens || 0) + metadata.tokensUsed;
    }
    
    if (metadata.slotsExtracted && Object.keys(metadata.slotsExtracted).length > 0) {
        this.collectedSlots = { ...this.collectedSlots, ...metadata.slotsExtracted };
    }
    
    return turn;
};

conversationSessionSchema.methods.updateSummary = function(summaryBullets) {
    this.runningSummary = summaryBullets;
    return this;
};

conversationSessionSchema.methods.end = function(outcome, appointmentId = null) {
    this.status = 'ended';
    this.endedAt = new Date();
    this.outcome = outcome;
    
    if (appointmentId) {
        this.appointmentId = appointmentId;
    }
    
    if (this.startedAt) {
        this.metrics.durationSeconds = Math.floor((this.endedAt - this.startedAt) / 1000);
    }
    
    const latencies = this.turns.filter(t => t.latencyMs).map(t => t.latencyMs);
    if (latencies.length > 0) {
        this.metrics.avgLatencyMs = Math.floor(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    }
    
    return this;
};

conversationSessionSchema.methods.getTranscript = function() {
    return this.turns.map(t => {
        const speaker = t.role === 'user' ? 'Caller' : 'AI';
        return `${speaker}: ${t.content}`;
    }).join('\n');
};

conversationSessionSchema.methods.getHistoryForAI = function() {
    return this.turns.map(t => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.content
    }));
};

conversationSessionSchema.methods.getChannelIcon = function() {
    switch (this.channel) {
        case 'voice': return '📞';
        case 'sms': return '💬';
        case 'website': return '🌐';
        default: return '📱';
    }
};

conversationSessionSchema.methods.getStatusBadge = function() {
    switch (this.outcome) {
        case 'booked': return { text: 'Booked', color: 'green' };
        case 'answered': return { text: 'Answered', color: 'blue' };
        case 'transferred': return { text: 'Transferred', color: 'orange' };
        case 'callback_requested': return { text: 'Callback', color: 'yellow' };
        case 'abandoned': return { text: 'Abandoned', color: 'red' };
        case 'error': return { text: 'Error', color: 'red' };
        default: return { text: 'No Action', color: 'gray' };
    }
};

// STATIC METHODS

conversationSessionSchema.statics.getActiveCount = async function(companyId) {
    return this.countDocuments({ companyId, status: 'active' });
};

conversationSessionSchema.statics.getByChannel = async function(companyId, channel, options = {}) {
    const { limit = 50, skip = 0 } = options;
    
    const query = { companyId };
    if (channel && channel !== 'all') {
        query.channel = channel;
    }
    
    return this.find(query)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('customerId', 'name phoneNumbers')
        .lean();
};

conversationSessionSchema.statics.getChannelStats = async function(companyId, since = null) {
    const match = { companyId: new mongoose.Types.ObjectId(companyId) };
    if (since) {
        match.startedAt = { $gte: since };
    }
    
    return this.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$channel',
                count: { $sum: 1 },
                booked: { $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } }
            }
        }
    ]);
};

const ConversationSession = mongoose.model('ConversationSession', conversationSessionSchema);

module.exports = ConversationSession;


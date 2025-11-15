// ============================================================================
// AI AGENT CALL LOG MODEL - PERFORMANCE TRACKING & LEARNING
// 📋 DESCRIPTION: Logs every AI agent interaction for performance analysis
// 🎯 PURPOSE: Enable smart threshold optimization based on real call data
// 🔧 FEATURES: 
//     - Tracks every customer query and AI response
//     - Records confidence scores and routing decisions
//     - Enables historical analysis for optimization
//     - Company-specific performance tracking
// 📊 ANALYTICS:
//     - Success/failure rates per knowledge source
//     - Confidence score distributions over time
//     - Common query patterns and missed opportunities
//     - Optimal threshold calculations based on real data
// ============================================================================

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const aiAgentCallLogSchema = new mongoose.Schema({
    // Company Association
    companyId: {
        type: ObjectId,
        ref: 'Company',
        required: true,
        index: true // Critical for fast company-specific queries
    },
    
    // Call Metadata
    callId: {
        type: String,
        index: true // For tracking multi-turn conversations
    },
    
    sessionId: {
        type: String,
        index: true // For tracking entire customer sessions
    },
    
    // ============================================================================
    // 📞 CALL BASICS (Brain-Wired Analytics)
    // ============================================================================
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        default: 'inbound',
        index: true
    },
    
    fromNumber: {
        type: String,
        trim: true
    },
    
    toNumber: {
        type: String,
        trim: true
    },
    
    startedAt: {
        type: Date,
        index: true
    },
    
    endedAt: {
        type: Date
    },
    
    durationMs: {
        type: Number,
        min: 0
    },
    
    // ============================================================================
    // 🧠 BRAIN / CHEAT SHEET (Brain-Wired Analytics)
    // ============================================================================
    serviceType: {
        type: String, // e.g. 'REPAIR', 'MAINTENANCE', 'INSPECTION'
        trim: true,
        index: true
    },
    
    categorySlug: {
        type: String, // Triage category from Brain
        trim: true,
        index: true
    },
    
    matchedScenarioId: {
        type: ObjectId, // Which scenario from Cheat Sheet was triggered
        ref: 'GlobalInstantResponseTemplate',
        index: true
    },
    
    usedFallback: {
        type: Boolean,
        default: false,
        index: true
    },
    
    confidence: {
        type: Number, // 0-1 confidence from Brain matching
        min: 0,
        max: 1,
        index: true
    },
    
    // Query Information
    customerQuery: {
        type: String,
        required: true,
        trim: true,
        maxLength: 1000
    },
    
    queryType: {
        type: String,
        enum: ['hours', 'pricing', 'services', 'emergency', 'booking', 'general', 'other'],
        default: 'general',
        index: true
    },
    
    // AI Agent Routing Decision
    routingFlow: [{
        source: {
            type: String,
            enum: ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'],
            required: true
        },
        priority: {
            type: Number,
            min: 1,
            max: 4
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            required: true
        },
        threshold: {
            type: Number,
            min: 0,
            max: 1,
            required: true
        },
        result: {
            type: String,
            enum: ['matched', 'below_threshold', 'skipped', 'error'],
            required: true
        },
        responseTime: {
            type: Number, // milliseconds
            default: 0
        }
    }],
    
    // Final Result
    finalMatchedSource: {
        type: String,
        enum: ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback', 'none'],
        required: true,
        index: true
    },
    
    finalConfidence: {
        type: Number,
        min: 0,
        max: 1,
        required: true,
        index: true
    },
    
    aiResponse: {
        type: String,
        required: true,
        trim: true,
        maxLength: 2000
    },
    
    // Performance Metrics
    totalResponseTime: {
        type: Number, // milliseconds
        required: true,
        index: true
    },
    
    // Success Indicators
    wasSuccessful: {
        type: Boolean,
        default: null, // null = unknown, true = success, false = failure
        index: true
    },
    
    customerSatisfaction: {
        type: String,
        enum: ['satisfied', 'unsatisfied', 'escalated', 'unknown'],
        default: 'unknown',
        index: true
    },
    
    // ============================================================================
    // 🎯 OUTCOME (Brain-Wired Analytics)
    // ============================================================================
    outcome: {
        status: {
            type: String,
            enum: ['BOOKED', 'TRANSFERRED', 'MESSAGE_TAKEN', 'HUNG_UP', 'FAILED', 'IN_PROGRESS', 'UNKNOWN'],
            default: 'UNKNOWN',
            index: true
        },
        details: {
            type: String,
            trim: true,
            maxLength: 500
        },
        successScore: {
            type: Number, // 0-100 numeric score
            min: 0,
            max: 100,
            index: true
        },
        goodCall: {
            type: Boolean,
            default: null,
            index: true
        }
    },
    
    // ============================================================================
    // ⏱️ METRICS (Brain-Wired Analytics)
    // ============================================================================
    metrics: {
        avgAgentLatencyMs: {
            type: Number,
            min: 0
        },
        maxAgentLatencyMs: {
            type: Number,
            min: 0
        },
        deadAirMsTotal: {
            type: Number,
            min: 0
        },
        deadAirSegments: {
            type: Number,
            min: 0
        },
        turnsCaller: {
            type: Number,
            min: 0
        },
        turnsAgent: {
            type: Number,
            min: 0
        }
    },
    
    // ============================================================================
    // 📝 CALL SUMMARY & INTENT (Brain-Wired Analytics)
    // ============================================================================
    summary: {
        type: String,
        trim: true,
        maxLength: 1000 // One-paragraph call summary
    },
    
    callerIntent: {
        type: String,
        trim: true,
        maxLength: 500
    },
    
    sentiment: {
        type: String,
        enum: ['positive', 'neutral', 'negative', 'frustrated'],
        index: true
    },
    
    sentimentScore: {
        type: Number, // -1 to 1
        min: -1,
        max: 1
    },
    
    // ============================================================================
    // 📊 CALL EVENTS (Brain-Wired Analytics)
    // ============================================================================
    events: [{
        type: {
            type: String,
            enum: ['caller_utterance', 'agent_reply', 'booking_done', 'call_transfer', 'distress_transfer', 'hangup', 'escalation', 'other'],
            required: true
        },
        text: {
            type: String,
            trim: true
        },
        at: {
            type: Date,
            required: true
        },
        tOffsetMs: {
            type: Number, // milliseconds from call start
            min: 0
        },
        meta: {
            serviceType: String,
            categorySlug: String,
            scenarioId: String,
            confidence: Number
        }
    }],
    
    // Context Information
    timeOfDay: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'night'],
        index: true
    },
    
    dayOfWeek: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        index: true
    },
    
    // Optimization Tracking
    thresholdVersion: {
        type: Number,
        default: 1 // Tracks which threshold configuration was used
    },
    
    optimizationId: {
        type: String, // Links to specific optimization runs
        index: true
    },
    
    // ============================================================================
    // 📝 TRANSCRIPT & RECORDING (NEW - System 2)
    // ============================================================================
    conversation: {
        turns: [{
            timestamp: Date,
            tOffsetMs: Number, // milliseconds from call start (for playback sync)
            speaker: { type: String, enum: ['customer', 'ai', 'system'] },
            role: { type: String, enum: ['caller', 'agent', 'system'] }, // Alias for speaker
            text: String,
            audioUrl: String,
            confidence: Number,
            duration: Number
        }],
        
        fullTranscript: {
            formatted: String,    // "Customer: ...\nAI: ..."
            plainText: String,    // For search
            html: String,         // Styled version
            markdown: String      // For docs
        },
        
        recordingUrl: String,
        recordingSid: String,
        recordingDuration: Number,
        recordingStatus: {
            type: String,
            enum: ['processing', 'completed', 'failed', 'deleted'],
            default: 'processing'
        },
        
        transcriptionProvider: {
            type: String,
            enum: ['twilio', 'google', 'whisper', 'deepgram'],
            default: 'twilio'
        }
    },
    
    // ============================================================================
    // 📱 SMS DELIVERY (NEW - System 2)
    // ============================================================================
    transcriptDelivery: {
        smsEnabled: { type: Boolean, default: false },
        sentToCustomer: Boolean,
        sentAt: Date,
        smsContent: String,
        smsSid: String,
        deliveryStatus: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'failed', 'optout']
        },
        customerOptIn: { type: Boolean, default: false },
        deliveryPreference: {
            type: String,
            enum: ['immediate', 'end_of_call', 'end_of_day', 'manual'],
            default: 'end_of_call'
        }
    },
    
    // ============================================================================
    // 🔍 SEARCHABILITY (NEW - System 2)
    // ============================================================================
    searchMetadata: {
        keywords: [String],
        topics: [String],
        sentiment: {
            type: String,
            enum: ['positive', 'neutral', 'negative', 'frustrated']
        },
        language: { type: String, default: 'en' }
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
    }
}, {
    // Automatic timestamps
    timestamps: true,
    
    // Indexes for performance
    indexes: [
        { companyId: 1, createdAt: -1 }, // Company queries by date
        { companyId: 1, finalMatchedSource: 1 }, // Source performance by company
        { companyId: 1, wasSuccessful: 1 }, // Success rate by company
        { companyId: 1, queryType: 1 }, // Query patterns by company
        { finalConfidence: 1, wasSuccessful: 1 }, // Confidence vs success correlation
        // NEW: System 2 indexes
        { 'searchMetadata.keywords': 1 }, // Keyword search
        { 'searchMetadata.sentiment': 1 }, // Sentiment filtering
        { 'conversation.recordingStatus': 1 }, // Recording status filtering
        // NEW: Brain-Wired Analytics indexes
        { companyId: 1, startedAt: -1 }, // Call list by date
        { companyId: 1, 'outcome.status': 1 }, // Outcome filtering
        { companyId: 1, 'outcome.goodCall': 1 }, // Good/bad call filtering
        { companyId: 1, serviceType: 1 }, // Service type filtering
        { companyId: 1, categorySlug: 1 }, // Category filtering
        { companyId: 1, matchedScenarioId: 1 }, // Scenario performance
        { companyId: 1, sentiment: 1 }, // Sentiment filtering
        { 'outcome.successScore': 1 } // Success score sorting
    ]
});

// Full-text search index on transcript (System 2)
aiAgentCallLogSchema.index({ 'conversation.fullTranscript.plainText': 'text' });

// 📊 ANALYTICS METHODS
aiAgentCallLogSchema.statics.getPerformanceAnalytics = async function(companyId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const pipeline = [
        {
            $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                createdAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$finalMatchedSource',
                totalQueries: { $sum: 1 },
                successfulQueries: {
                    $sum: { $cond: [{ $eq: ['$wasSuccessful', true] }, 1, 0] }
                },
                averageConfidence: { $avg: '$finalConfidence' },
                averageResponseTime: { $avg: '$totalResponseTime' },
                confidenceScores: { $push: '$finalConfidence' }
            }
        }
    ];
    
    return this.aggregate(pipeline);
};

aiAgentCallLogSchema.statics.getOptimalThresholds = async function(companyId, days = 30) {
    const analytics = await this.getPerformanceAnalytics(companyId, days);
    
    const optimalThresholds = {};
    
    analytics.forEach(sourceData => {
        const source = sourceData._id;
        const successRate = sourceData.successfulQueries / sourceData.totalQueries;
        const avgConfidence = sourceData.averageConfidence;
        
        // Calculate optimal threshold based on success rate and confidence distribution
        let optimalThreshold;
        
        if (successRate > 0.8) {
            // High success rate - can lower threshold for more coverage
            optimalThreshold = Math.max(0.45, avgConfidence - 0.1);
        } else if (successRate < 0.6) {
            // Low success rate - raise threshold for better accuracy
            optimalThreshold = Math.min(0.85, avgConfidence + 0.1);
        } else {
            // Balanced - use average confidence as baseline
            optimalThreshold = avgConfidence;
        }
        
        optimalThresholds[source] = Math.round(optimalThreshold * 100) / 100;
    });
    
    return optimalThresholds;
};

// 🔄 MIDDLEWARE
aiAgentCallLogSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Auto-detect time of day
    const hour = this.createdAt.getHours();
    if (hour >= 6 && hour < 12) {this.timeOfDay = 'morning';}
    else if (hour >= 12 && hour < 17) {this.timeOfDay = 'afternoon';}
    else if (hour >= 17 && hour < 21) {this.timeOfDay = 'evening';}
    else {this.timeOfDay = 'night';}
    
    // Auto-detect day of week
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    this.dayOfWeek = days[this.createdAt.getDay()];
    
    next();
});

module.exports = mongoose.model('AIAgentCallLog', aiAgentCallLogSchema);

/**
 * ============================================================================
 * BOOKING REQUEST MODEL
 * ============================================================================
 * 
 * Records all booking requests captured by the AI agent.
 * This is the "fake booking" system - captures data for later processing.
 * 
 * STATUS FLOW:
 * - FAKE_CONFIRMED: AI told caller it's scheduled (no real calendar yet)
 * - PENDING_DISPATCH: Sent to dispatch for review
 * - CALLBACK_QUEUED: Waiting for human callback
 * - TRANSFERRED: Call was transferred to human scheduler
 * - AFTER_HOURS: Captured during off-hours
 * - COMPLETED: Real booking created (future integration)
 * - CANCELLED: Booking was cancelled
 * 
 * INTEGRATION READY:
 * - caseId field for future CRM/calendar integration
 * - externalBookingId for calendar system reference
 * - webhookSent flag for notification tracking
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const bookingRequestSchema = new mongoose.Schema({
    // ═══════════════════════════════════════════════════════════════════════
    // IDENTITY
    // ═══════════════════════════════════════════════════════════════════════
    companyId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'v2Company', 
        required: true,
        index: true
    },
    sessionId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'ConversationSession', 
        required: true,
        index: true
    },
    customerId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Customer',
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // BOOKING RULE REFERENCE
    // ═══════════════════════════════════════════════════════════════════════
    ruleId: { type: String, default: null },  // If using booking rules by trade/service
    trade: { type: String, default: null, trim: true },
    serviceType: { type: String, default: null, trim: true },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STATUS TRACKING
    // ═══════════════════════════════════════════════════════════════════════
    status: { 
        type: String, 
        enum: [
            'FAKE_CONFIRMED',    // AI confirmed on call (no real booking yet)
            'PENDING_DISPATCH',  // Sent to dispatch for review
            'CALLBACK_QUEUED',   // Waiting for human callback
            'TRANSFERRED',       // Call was transferred
            'AFTER_HOURS',       // Captured during off-hours
            'COMPLETED',         // Real booking created
            'CANCELLED',         // Booking cancelled
            'FAILED'             // Processing failed
        ],
        default: 'FAKE_CONFIRMED',
        index: true
    },
    outcomeMode: { 
        type: String, 
        enum: [
            'confirmed_on_call',
            'pending_dispatch',
            'callback_required',
            'transfer_to_scheduler',
            'after_hours_hold'
        ],
        default: 'confirmed_on_call'
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // COLLECTED SLOTS (THE BOOKING DATA)
    // ═══════════════════════════════════════════════════════════════════════
    slots: {
        name: {
            first: { type: String, default: null, trim: true },
            last: { type: String, default: null, trim: true },
            full: { type: String, default: null, trim: true }
        },
        phone: { type: String, default: null, trim: true },
        address: {
            full: { type: String, default: null, trim: true },
            street: { type: String, default: null, trim: true },
            city: { type: String, default: null, trim: true },
            unit: { type: String, default: null, trim: true }
        },
        time: {
            preference: { type: String, default: null, trim: true },  // "ASAP", "morning", "afternoon"
            window: { type: String, default: null, trim: true },      // "8-10", "2025-12-20 10am"
            isAsap: { type: Boolean, default: false }
        },
        // Custom slots (dynamic per company)
        custom: { type: Map, of: String, default: {} }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // DISCOVERY CONTEXT (What the call was about)
    // ═══════════════════════════════════════════════════════════════════════
    issue: { type: String, default: null, trim: true },
    issueSummary: { type: String, default: null, trim: true },
    urgency: { 
        type: String, 
        enum: ['normal', 'urgent', 'emergency'],
        default: 'normal'
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // FINAL SCRIPT USED
    // ═══════════════════════════════════════════════════════════════════════
    finalScriptUsed: { type: String, default: null, trim: true },
    
    // ═══════════════════════════════════════════════════════════════════════
    // INTEGRATION FIELDS (Future Use)
    // ═══════════════════════════════════════════════════════════════════════
    caseId: { type: String, default: null, trim: true },           // Generated case ID
    externalBookingId: { type: String, default: null, trim: true }, // Calendar system ID
    webhookSent: { type: Boolean, default: false },
    webhookSentAt: { type: Date, default: null },
    webhookResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    
    // ═══════════════════════════════════════════════════════════════════════
    // CALL METADATA
    // ═══════════════════════════════════════════════════════════════════════
    channel: { 
        type: String, 
        enum: ['phone', 'sms', 'website', 'test'],
        default: 'phone'
    },
    callSid: { type: String, default: null, trim: true },
    callerPhone: { type: String, default: null, trim: true },
    
    // ═══════════════════════════════════════════════════════════════════════
    // TIMESTAMPS
    // ═══════════════════════════════════════════════════════════════════════
    createdAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null }
    
}, { 
    timestamps: true,
    collection: 'bookingRequests'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════
bookingRequestSchema.index({ companyId: 1, status: 1 });
bookingRequestSchema.index({ companyId: 1, createdAt: -1 });
bookingRequestSchema.index({ companyId: 1, outcomeMode: 1 });
bookingRequestSchema.index({ callerPhone: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL: Display Name
// ═══════════════════════════════════════════════════════════════════════════
bookingRequestSchema.virtual('displayName').get(function() {
    if (this.slots?.name?.full) return this.slots.name.full;
    if (this.slots?.name?.first && this.slots?.name?.last) {
        return `${this.slots.name.first} ${this.slots.name.last}`;
    }
    if (this.slots?.name?.first) return this.slots.name.first;
    if (this.slots?.name?.last) return this.slots.name.last;
    return 'Unknown';
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC: Generate Case ID
// ═══════════════════════════════════════════════════════════════════════════
bookingRequestSchema.statics.generateCaseId = function() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `BK-${timestamp}-${random}`;
};

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE: Populate Final Script
// ═══════════════════════════════════════════════════════════════════════════
bookingRequestSchema.methods.populateFinalScript = function(template) {
    if (!template) return '';
    
    // V34 FIX: Don't say "your requested time" if no time was collected
    // Use "as soon as possible" as default, or omit time reference entirely
    const timeValue = this.slots?.time?.preference || this.slots?.time?.window;
    const timeDisplay = timeValue || 'as soon as possible';
    
    const replacements = {
        '{name}': this.slots?.name?.full || this.slots?.name?.first || 'there',
        '{phone}': this.slots?.phone || '',
        '{address}': this.slots?.address?.full || this.slots?.address?.street || '',
        '{timePreference}': timeDisplay,
        '{trade}': this.trade || 'service',
        '{serviceType}': this.serviceType || 'appointment',
        '{caseId}': this.caseId || '',
        '{issue}': this.issue || 'your request'
    };
    
    let script = template;
    for (const [placeholder, value] of Object.entries(replacements)) {
        script = script.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    return script;
};

module.exports = mongoose.model('BookingRequest', bookingRequestSchema);


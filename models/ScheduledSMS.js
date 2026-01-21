/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SCHEDULED SMS MODEL - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Tracks SMS notifications scheduled for future delivery.
 * Used for appointment reminders (24h, 1h before, day-of).
 * 
 * WORKFLOW:
 * 1. Booking completes → confirmation SMS sent immediately
 * 2. Reminders scheduled based on company settings
 * 3. Job runs every 5 minutes to send due reminders
 * 4. On send: status → 'sent', sentAt filled
 * 5. On failure: retryCount++, nextRetry set
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

const scheduledSMSSchema = new mongoose.Schema({
    // ═══════════════════════════════════════════════════════════════════════════
    // IDENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true
    },
    bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BookingRequest',
        required: true,
        index: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE TYPE
    // ═══════════════════════════════════════════════════════════════════════════
    type: {
        type: String,
        enum: [
            'confirmation',      // Sent immediately after booking
            'reminder_24h',      // 24 hours before appointment
            'reminder_1h',       // 1 hour before appointment
            'reminder_day_of',   // Morning of appointment day
            'on_the_way',        // Technician dispatched
            'follow_up'          // After service completion
        ],
        required: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RECIPIENT
    // ═══════════════════════════════════════════════════════════════════════════
    toPhone: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    toName: {
        type: String,
        trim: true,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MESSAGE CONTENT
    // ═══════════════════════════════════════════════════════════════════════════
    message: {
        type: String,
        required: true
    },
    // Template used (for audit/debugging)
    templateUsed: {
        type: String,
        default: null
    },
    // Placeholders that were substituted
    placeholdersUsed: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SCHEDULING
    // ═══════════════════════════════════════════════════════════════════════════
    scheduledFor: {
        type: Date,
        required: true,
        index: true
    },
    // Related appointment time (for context)
    appointmentTime: {
        type: Date,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'cancelled'],
        default: 'pending',
        index: true
    },
    
    // When actually sent
    sentAt: {
        type: Date,
        default: null
    },
    
    // Twilio message SID
    twilioSid: {
        type: String,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ERROR HANDLING
    // ═══════════════════════════════════════════════════════════════════════════
    lastError: {
        type: String,
        default: null
    },
    retryCount: {
        type: Number,
        default: 0
    },
    maxRetries: {
        type: Number,
        default: 3
    },
    nextRetry: {
        type: Date,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CANCELLATION
    // ═══════════════════════════════════════════════════════════════════════════
    cancelledAt: {
        type: Date,
        default: null
    },
    cancelReason: {
        type: String,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIMESTAMPS
    // ═══════════════════════════════════════════════════════════════════════════
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Find due messages (pending + scheduledFor <= now)
scheduledSMSSchema.index({ status: 1, scheduledFor: 1 });

// Find messages for a booking (to cancel all reminders if booking cancelled)
scheduledSMSSchema.index({ bookingId: 1, status: 1 });

// Find pending messages for retry
scheduledSMSSchema.index({ status: 1, nextRetry: 1 });

// ═══════════════════════════════════════════════════════════════════════════════
// METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mark as sent
 */
scheduledSMSSchema.methods.markSent = function(twilioSid) {
    this.status = 'sent';
    this.sentAt = new Date();
    this.twilioSid = twilioSid;
    return this.save();
};

/**
 * Mark as failed and schedule retry
 */
scheduledSMSSchema.methods.markFailed = function(error) {
    this.lastError = error;
    this.retryCount += 1;
    
    if (this.retryCount >= this.maxRetries) {
        this.status = 'failed';
    } else {
        // Exponential backoff: 5min, 15min, 45min
        const delayMinutes = 5 * Math.pow(3, this.retryCount - 1);
        this.nextRetry = new Date(Date.now() + delayMinutes * 60 * 1000);
    }
    
    return this.save();
};

/**
 * Cancel this message
 */
scheduledSMSSchema.methods.cancel = function(reason) {
    this.status = 'cancelled';
    this.cancelledAt = new Date();
    this.cancelReason = reason;
    return this.save();
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find messages due for sending
 */
scheduledSMSSchema.statics.findDue = function(limit = 100) {
    const now = new Date();
    return this.find({
        status: 'pending',
        scheduledFor: { $lte: now }
    })
    .sort({ scheduledFor: 1 })
    .limit(limit)
    .populate('companyId', 'companyName twilioConfig companyPhone');
};

/**
 * Find messages ready for retry
 */
scheduledSMSSchema.statics.findReadyForRetry = function(limit = 50) {
    const now = new Date();
    return this.find({
        status: 'pending',
        retryCount: { $gt: 0, $lt: 3 },
        nextRetry: { $lte: now }
    })
    .sort({ nextRetry: 1 })
    .limit(limit)
    .populate('companyId', 'companyName twilioConfig companyPhone');
};

/**
 * Cancel all pending reminders for a booking
 */
scheduledSMSSchema.statics.cancelForBooking = function(bookingId, reason = 'Booking cancelled') {
    return this.updateMany(
        { bookingId, status: 'pending' },
        {
            $set: {
                status: 'cancelled',
                cancelledAt: new Date(),
                cancelReason: reason
            }
        }
    );
};

/**
 * Get stats for a company
 */
scheduledSMSSchema.statics.getStats = async function(companyId, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const stats = await this.aggregate([
        { $match: { companyId: new mongoose.Types.ObjectId(companyId), createdAt: { $gte: since } } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        }
    ]);
    
    const result = { sent: 0, pending: 0, failed: 0, cancelled: 0 };
    for (const stat of stats) {
        result[stat._id] = stat.count;
    }
    
    return {
        ...result,
        total: result.sent + result.pending + result.failed + result.cancelled,
        period: `${days} days`
    };
};

module.exports = mongoose.model('ScheduledSMS', scheduledSMSSchema);

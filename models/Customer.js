/**
 * ============================================================================
 * CUSTOMER MODEL - Multi-Tenant Customer Memory System
 * ============================================================================
 * 
 * This is the CORE of customer recognition across all channels.
 * One customer record per unique person PER COMPANY.
 * 
 * LOOKUP PRIORITY:
 * 1. Phone number (primary - from caller ID or collected)
 * 2. Email (secondary - from website or collected)
 * 3. Session ID (temporary - until real identifier provided)
 * 
 * MULTI-TENANT: Always scoped by companyId. Company A's customers
 * are completely isolated from Company B's customers.
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// --- Sub-schema for Address ---
const customerAddressSchema = new Schema({
    label: { type: String, trim: true, default: 'Home' }, // Home, Work, etc.
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zip: { type: String, trim: true },
    country: { type: String, trim: true, default: 'USA' },
    notes: { type: String, trim: true }, // "Gate code 4521", "Dog in backyard"
    isPrimary: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

// --- Sub-schema for Service Visit ---
const serviceVisitSchema = new Schema({
    date: { type: Date, required: true },
    technicianName: { type: String, trim: true },
    technicianId: { type: Schema.Types.ObjectId, ref: 'TeamMember' },
    issueDescription: { type: String, trim: true },
    resolution: { type: String, trim: true },
    notes: { type: String, trim: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    wasCallback: { type: Boolean, default: false },
    customerRating: { type: Number, min: 1, max: 5 },
    invoiceAmount: { type: Number }
}, { _id: true });

// --- Sub-schema for Equipment (HVAC, Dental equipment, etc.) ---
const equipmentSchema = new Schema({
    type: { type: String, trim: true }, // "AC", "Furnace", "X-Ray Machine"
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    serialNumber: { type: String, trim: true },
    installDate: { type: Date },
    warrantyExpires: { type: Date },
    notes: { type: String, trim: true },
    lastServiceDate: { type: Date }
}, { _id: true });

// --- Sub-schema for Preferences ---
const preferencesSchema = new Schema({
    preferredTechnicianName: { type: String, trim: true },
    preferredTechnicianId: { type: Schema.Types.ObjectId, ref: 'TeamMember' },
    preferredTimeWindow: { type: String, trim: true }, // "morning", "afternoon", "8-10am"
    preferredContactMethod: { type: String, enum: ['phone', 'sms', 'email'], default: 'phone' },
    communicationStyle: { type: String, trim: true }, // "direct", "chatty", "formal"
    language: { type: String, trim: true, default: 'en' },
    specialInstructions: { type: String, trim: true } // "Call 30 min before arrival"
}, { _id: false });

// --- Main Customer Schema ---
const customerSchema = new Schema({
    // ═══════════════════════════════════════════════════════════════════════════
    // MULTI-TENANT ISOLATION (Required)
    // ═══════════════════════════════════════════════════════════════════════════
    companyId: { 
        type: Schema.Types.ObjectId, 
        ref: 'v2Company', 
        required: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // IDENTIFIERS - How we find this customer across channels
    // ═══════════════════════════════════════════════════════════════════════════
    phoneNumbers: [{
        number: { type: String, trim: true, required: true }, // Normalized: +16025551234
        label: { type: String, trim: true, default: 'Primary' }, // Primary, Work, Mobile
        isPrimary: { type: Boolean, default: false },
        addedAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date }
    }],
    
    emails: [{
        address: { type: String, trim: true, lowercase: true },
        label: { type: String, trim: true, default: 'Primary' },
        isPrimary: { type: Boolean, default: false },
        addedAt: { type: Date, default: Date.now }
    }],
    
    // Temporary session IDs (for website visitors before they provide contact info)
    temporarySessions: [{
        sessionId: { type: String, trim: true },
        channel: { type: String, enum: ['website', 'app'] },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date }
    }],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // IDENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    name: {
        full: { type: String, trim: true },
        first: { type: String, trim: true },
        last: { type: String, trim: true },
        nickname: { type: String, trim: true } // What they prefer to be called
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ADDRESSES
    // ═══════════════════════════════════════════════════════════════════════════
    addresses: [customerAddressSchema],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SERVICE HISTORY
    // ═══════════════════════════════════════════════════════════════════════════
    visits: [serviceVisitSchema],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // EQUIPMENT (Trade-specific, optional)
    // ═══════════════════════════════════════════════════════════════════════════
    equipment: [equipmentSchema],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PREFERENCES (Learned over time)
    // ═══════════════════════════════════════════════════════════════════════════
    preferences: { type: preferencesSchema, default: () => ({}) },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AI NOTES (Accumulated intelligence)
    // ═══════════════════════════════════════════════════════════════════════════
    // These are insights the AI has learned about this customer
    aiNotes: [{
        note: { type: String, trim: true },
        source: { type: String, enum: ['ai_extracted', 'manual', 'system'] },
        createdAt: { type: Date, default: Date.now },
        sessionId: { type: Schema.Types.ObjectId, ref: 'ConversationSession' }
    }],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RELATIONSHIP METRICS
    // ═══════════════════════════════════════════════════════════════════════════
    metrics: {
        totalInteractions: { type: Number, default: 0 },
        totalBookings: { type: Number, default: 0 },
        totalCalls: { type: Number, default: 0 },
        totalSMS: { type: Number, default: 0 },
        totalWebChats: { type: Number, default: 0 },
        lifetimeValue: { type: Number, default: 0 }, // In dollars
        averageRating: { type: Number, min: 1, max: 5 },
        lastInteractionAt: { type: Date },
        lastInteractionChannel: { type: String, enum: ['voice', 'sms', 'website'] }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    status: {
        type: String,
        enum: ['active', 'inactive', 'blocked', 'vip', 'placeholder', 'merged'],
        default: 'active'
    },
    
    tags: [{ type: String, trim: true }], // Custom tags: "VIP", "Difficult", "Referral source"
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REVIEW STATUS
    // ═══════════════════════════════════════════════════════════════════════════
    needsReview: { type: Boolean, default: null },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    
    // For merged records
    mergedInto: { type: Schema.Types.ObjectId, ref: 'Customer' },
    mergedAt: { type: Date },
    mergedFrom: [{
        customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
        mergedAt: { type: Date },
        mergedBy: { type: Schema.Types.ObjectId, ref: 'User' }
    }],
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIMESTAMPS
    // ═══════════════════════════════════════════════════════════════════════════
    firstContactAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
    
}, { 
    timestamps: true,
    collection: 'customers'
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES for fast lookups
// ═══════════════════════════════════════════════════════════════════════════════

// Primary lookup: company + phone number
customerSchema.index({ companyId: 1, 'phoneNumbers.number': 1 });

// Email lookup
customerSchema.index({ companyId: 1, 'emails.address': 1 });

// Temporary session lookup
customerSchema.index({ companyId: 1, 'temporarySessions.sessionId': 1 });

// Name search
customerSchema.index({ companyId: 1, 'name.full': 'text', 'name.first': 'text', 'name.last': 'text' });

// Recent interactions
customerSchema.index({ companyId: 1, 'metrics.lastInteractionAt': -1 });

// ═══════════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the primary phone number
 */
customerSchema.methods.getPrimaryPhone = function() {
    const primary = this.phoneNumbers.find(p => p.isPrimary);
    return primary?.number || this.phoneNumbers[0]?.number || null;
};

/**
 * Get the display name (first name preferred, then full, then "Customer")
 */
customerSchema.methods.getDisplayName = function() {
    return this.name.nickname || this.name.first || this.name.full || 'Customer';
};

/**
 * Get the primary address
 */
customerSchema.methods.getPrimaryAddress = function() {
    const primary = this.addresses.find(a => a.isPrimary);
    return primary || this.addresses[0] || null;
};

/**
 * Check if this is a returning customer (has previous interactions)
 */
customerSchema.methods.isReturning = function() {
    return this.metrics.totalInteractions > 1;
};

/**
 * Check if customer had a recent visit (within days)
 */
customerSchema.methods.hasRecentVisit = function(withinDays = 14) {
    if (!this.visits || this.visits.length === 0) return false;
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - withinDays);
    
    return this.visits.some(v => v.date >= cutoff);
};

/**
 * Get the most recent visit
 */
customerSchema.methods.getLastVisit = function() {
    if (!this.visits || this.visits.length === 0) return null;
    return this.visits.sort((a, b) => b.date - a.date)[0];
};

/**
 * Add a phone number (normalized)
 */
customerSchema.methods.addPhone = function(phoneNumber, label = 'Primary') {
    // Normalize phone number to E.164 format
    const normalized = phoneNumber.replace(/\D/g, '');
    const formatted = normalized.length === 10 
        ? `+1${normalized}` 
        : normalized.length === 11 && normalized.startsWith('1')
            ? `+${normalized}`
            : `+${normalized}`;
    
    // Check if already exists
    const exists = this.phoneNumbers.find(p => p.number === formatted);
    if (exists) {
        exists.lastUsedAt = new Date();
        return;
    }
    
    // Add new phone
    this.phoneNumbers.push({
        number: formatted,
        label,
        isPrimary: this.phoneNumbers.length === 0,
        addedAt: new Date(),
        lastUsedAt: new Date()
    });
};

/**
 * Record an interaction
 */
customerSchema.methods.recordInteraction = function(channel) {
    this.metrics.totalInteractions = (this.metrics.totalInteractions || 0) + 1;
    this.metrics.lastInteractionAt = new Date();
    this.metrics.lastInteractionChannel = channel;
    
    if (channel === 'voice') this.metrics.totalCalls = (this.metrics.totalCalls || 0) + 1;
    if (channel === 'sms') this.metrics.totalSMS = (this.metrics.totalSMS || 0) + 1;
    if (channel === 'website') this.metrics.totalWebChats = (this.metrics.totalWebChats || 0) + 1;
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS (Called on the Model, not instance)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a phone number to E.164 format
 */
customerSchema.statics.normalizePhone = function(phoneNumber) {
    if (!phoneNumber) return null;
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-SAVE MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

customerSchema.pre('save', function(next) {
    // Update the updatedAt timestamp
    this.updatedAt = new Date();
    
    // Parse full name into first/last if provided
    if (this.name.full && !this.name.first) {
        const parts = this.name.full.trim().split(' ');
        this.name.first = parts[0];
        this.name.last = parts.slice(1).join(' ') || null;
    }
    
    next();
});

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;

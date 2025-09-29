// models/Contact.js
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

// Contact interaction history schema
const interactionSchema = new mongoose.Schema({
    type: { 
        type: String, 
        enum: ['call', 'chat', 'sms', 'email', 'appointment'], 
        required: true 
    },
    direction: { 
        type: String, 
        enum: ['inbound', 'outbound'], 
        default: 'inbound' 
    },
    timestamp: { type: Date, default: Date.now },
    duration: { type: Number }, // seconds for calls
    summary: { type: String, trim: true },
    outcome: { 
        type: String, 
        enum: ['answered', 'booking', 'transferred', 'message', 'follow_up_needed'], 
        default: 'answered' 
    },
    twilioCallSid: { type: String, trim: true }, // Link to Twilio call
    agentNotes: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed } // Flexible data storage
}, { _id: true });

// Service request schema (links to your scheduling rules)
const serviceRequestSchema = new mongoose.Schema({
    serviceType: { type: String, trim: true, required: true }, // Links to schedulingRules.serviceName
    description: { type: String, trim: true },
    urgency: { 
        type: String, 
        enum: ['routine', 'urgent', 'emergency'], 
        default: 'routine' 
    },
    preferredTimeSlots: [{ type: String }], // e.g., ["morning", "afternoon"]
    requestedDate: { type: Date },
    status: { 
        type: String, 
        enum: ['pending', 'scheduled', 'completed', 'cancelled'], 
        default: 'pending' 
    },
    scheduledAppointment: {
        date: { type: Date },
        timeSlot: { type: String },
        calendarId: { type: String }, // Links to Google Calendar
        confirmationSent: { type: Boolean, default: false }
    },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

// Address schema (reusable)
const contactAddressSchema = new mongoose.Schema({
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    isServiceAddress: { type: Boolean, default: true },
    notes: { type: String, trim: true } // e.g., "gate code: 1234"
}, { _id: false });

// Main Contact/Lead schema
const contactSchema = new mongoose.Schema({
    // Company association (critical for multi-tenant)
    companyId: { type: ObjectId, ref: 'Company', required: true, index: true },
    
    // Basic contact information
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    fullName: { type: String, trim: true }, // AI extracted or computed
    
    // Communication details
    primaryPhone: { type: String, trim: true, required: true, index: true },
    alternatePhone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    preferredContact: { 
        type: String, 
        enum: ['phone', 'sms', 'email'], 
        default: 'phone' 
    },
    
    // Location information
    addresses: [contactAddressSchema],
    primaryAddress: { type: contactAddressSchema },
    
    // Lead/Customer status
    status: { 
        type: String, 
        enum: ['new_lead', 'contacted', 'quoted', 'customer', 'inactive'], 
        default: 'new_lead' 
    },
    leadSource: { 
        type: String, 
        enum: ['phone_call', 'website_chat', 'referral', 'marketing', 'repeat'], 
        default: 'phone_call' 
    },
    
    // Service information
    serviceRequests: [serviceRequestSchema],
    customerType: { 
        type: String, 
        enum: ['residential', 'commercial'], 
        default: 'residential' 
    },
    
    // Interaction history
    interactions: [interactionSchema],
    totalCalls: { type: Number, default: 0 },
    lastContactDate: { type: Date, default: Date.now },
    
    // AI extracted data
    extractedData: {
        hasEmergency: { type: Boolean, default: false },
        mentionedKeywords: [{ type: String }], // AI detected keywords
        sentimentScore: { type: Number }, // Positive/negative sentiment
        callSummary: { type: String, trim: true }
    },
    
    // Business value
    estimatedValue: { type: Number }, // Potential revenue
    actualValue: { type: Number, default: 0 }, // Completed revenue
    
    // Metadata
    tags: [{ type: String, trim: true }], // Flexible tagging
    notes: [{ 
        text: { type: String, trim: true },
        createdBy: { type: String, default: 'ai_agent' },
        timestamp: { type: Date, default: Date.now }
    }],
    
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for performance
contactSchema.index({ companyId: 1, primaryPhone: 1 }, { unique: true });
contactSchema.index({ companyId: 1, email: 1 });
contactSchema.index({ companyId: 1, lastContactDate: -1 });
contactSchema.index({ companyId: 1, status: 1 });
contactSchema.index({ 'interactions.twilioCallSid': 1 });

// Virtual for full name
contactSchema.virtual('displayName').get(function() {
    if (this.firstName && this.lastName) {
        return `${this.firstName} ${this.lastName}`;
    }
    return this.fullName || this.primaryPhone || 'Unknown Contact';
});

// Virtual for latest service request
contactSchema.virtual('latestServiceRequest').get(function() {
    if (this.serviceRequests && this.serviceRequests.length > 0) {
        return this.serviceRequests[this.serviceRequests.length - 1];
    }
    return null;
});

// Pre-save middleware
contactSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Auto-generate fullName if not provided
    if (!this.fullName && this.firstName && this.lastName) {
        this.fullName = `${this.firstName} ${this.lastName}`;
    }
    
    // Update interaction counts
    if (this.interactions) {
        this.totalCalls = this.interactions.filter(i => i.type === 'call').length;
        if (this.interactions.length > 0) {
            this.lastContactDate = this.interactions[this.interactions.length - 1].timestamp;
        }
    }
    
    next();
});

// Static methods for common queries
contactSchema.statics.findByPhone = function(companyId, phone) {
    return this.findOne({ companyId, primaryPhone: phone });
};

contactSchema.statics.findByCompany = function(companyId, options = {}) {
    const query = this.find({ companyId });
    
    if (options.status) {
        query.where('status', options.status);
    }
    
    if (options.limit) {
        query.limit(options.limit);
    }
    
    return query.sort({ lastContactDate: -1 });
};

// Instance methods
contactSchema.methods.addInteraction = function(interactionData) {
    this.interactions.push(interactionData);
    return this.save();
};

contactSchema.methods.addServiceRequest = function(serviceData) {
    this.serviceRequests.push(serviceData);
    return this.save();
};

contactSchema.methods.updateServiceRequest = function(requestId, updateData) {
    const request = this.serviceRequests.id(requestId);
    if (request) {
        Object.assign(request, updateData);
        return this.save();
    }
    throw new Error('Service request not found');
};

module.exports = mongoose.model('Contact', contactSchema);

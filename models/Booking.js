const mongoose = require('mongoose');

// Enhanced booking model for multi-tenant AI agent system
const bookingSchema = new mongoose.Schema({
  // Multi-tenant identification
  companyId: { type: String, required: true, trim: true, index: true },
  bookingId: { type: String, unique: true, required: true }, // Human-readable booking ID
  
  // Customer information
  customer: {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      zip: { type: String, trim: true },
      coordinates: {
        lat: { type: Number },
        lng: { type: Number }
      }
    },
    customerType: { type: String, enum: ['new', 'returning', 'commercial', 'residential'], default: 'new' },
    preferredContactMethod: { type: String, enum: ['phone', 'sms', 'email'], default: 'phone' },
    notes: { type: String, trim: true }
  },
  
  // Service details
  service: {
    category: { type: String, required: true, trim: true }, // Trade category
    type: { type: String, required: true, trim: true }, // Specific service
    description: { type: String, trim: true },
    urgency: { type: String, enum: ['routine', 'urgent', 'emergency'], default: 'routine' },
    estimatedDuration: { type: Number }, // minutes
    estimatedCost: {
      min: { type: Number },
      max: { type: Number },
      currency: { type: String, default: 'USD' }
    }
  },
  
  // Scheduling information
  scheduling: {
    requestedDate: { type: Date },
    requestedTime: { type: String }, // "morning", "afternoon", "anytime", specific time
    confirmedDate: { type: Date },
    confirmedTime: { type: String },
    timeZone: { type: String, default: 'America/New_York' },
    duration: { type: Number }, // confirmed duration in minutes
    bufferTime: { type: Number, default: 15 }, // buffer before/after in minutes
    calendarEventId: { type: String }, // Google Calendar/other calendar system ID
    calendarProvider: { type: String, enum: ['google', 'outlook', 'highlevel'] }
  },
  
  // Dynamic form fields collected during booking
  customFields: [{
    fieldName: { type: String, required: true, trim: true },
    fieldLabel: { type: String, required: true, trim: true },
    fieldType: { type: String, enum: ['text', 'phone', 'email', 'date', 'notes', 'dropdown', 'multi-select'], required: true },
    value: mongoose.Schema.Types.Mixed, // Can store strings, arrays, etc.
    required: { type: Boolean, default: false },
    isSystemField: { type: Boolean, default: false } // True for standard fields like name, phone
  }],
  
  // Booking status and workflow
  status: {
    current: { 
      type: String, 
      enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled', 'rescheduled', 'no-show'],
      default: 'pending'
    },
    history: [{
      status: { type: String },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: String }, // 'system', 'customer', 'agent', personnel name
      reason: { type: String },
      notes: { type: String }
    }]
  },
  
  // Personnel assignment
  assignedPersonnel: {
    name: { type: String, trim: true },
    role: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    assignedAt: { type: Date },
    assignedBy: { type: String, default: 'system' }
  },
  
  // Communication tracking
  communications: [{
    type: { type: String, enum: ['sms', 'email', 'call', 'system'], required: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    content: { type: String, trim: true },
    template: { type: String, trim: true }, // Template used for automated messages
    sentAt: { type: Date, default: Date.now },
    deliveryStatus: { type: String, enum: ['sent', 'delivered', 'failed', 'pending'] },
    readAt: { type: Date },
    respondedAt: { type: Date }
  }],
  
  // AI agent interaction data
  aiInteraction: {
    conversationId: { type: String }, // Link to conversation logs
    collectedVia: { type: String, enum: ['voice', 'sms', 'chat', 'form'], default: 'voice' },
    confidence: { type: Number, min: 0, max: 1 }, // AI confidence in booking accuracy
    extractedIntents: [{ type: String }],
    requiresVerification: { type: Boolean, default: false },
    verificationNotes: { type: String },
    agentNotes: { type: String } // Notes from AI agent about the booking
  },
  
  // Location and logistics
  location: {
    type: { type: String, enum: ['on-site', 'shop', 'remote', 'phone'], default: 'on-site' },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      zip: { type: String, trim: true },
      unit: { type: String, trim: true },
      specialInstructions: { type: String, trim: true }
    },
    travelTime: { type: Number }, // estimated travel time in minutes
    parkingNotes: { type: String, trim: true },
    accessInstructions: { type: String, trim: true }
  },
  
  // Follow-up and reminders
  reminders: {
    customerReminders: [{
      type: { type: String, enum: ['24hr', '2hr', '30min', 'custom'] },
      scheduledFor: { type: Date },
      sentAt: { type: Date },
      method: { type: String, enum: ['sms', 'email', 'call'] },
      status: { type: String, enum: ['scheduled', 'sent', 'failed', 'cancelled'] }
    }],
    staffReminders: [{
      type: { type: String, enum: ['preparation', 'departure', 'follow-up'] },
      scheduledFor: { type: Date },
      sentAt: { type: Date },
      recipientRole: { type: String },
      status: { type: String, enum: ['scheduled', 'sent', 'failed', 'cancelled'] }
    }]
  },
  
  // Payment and billing
  billing: {
    estimatedTotal: { type: Number },
    actualTotal: { type: Number },
    currency: { type: String, default: 'USD' },
    paymentMethod: { type: String, enum: ['cash', 'check', 'card', 'invoice', 'online'] },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'partial', 'overdue'], default: 'pending' },
    invoiceId: { type: String },
    paymentNotes: { type: String }
  },
  
  // Quality and feedback
  quality: {
    customerSatisfaction: { type: Number, min: 1, max: 5 },
    customerFeedback: { type: String, trim: true },
    internalNotes: { type: String, trim: true },
    issues: [{ type: String, trim: true }],
    photos: [{ type: String }], // URLs to before/after photos
    completionNotes: { type: String, trim: true }
  },
  
  // Integration data
  integrations: {
    crmId: { type: String }, // Integration with CRM systems
    invoiceSystemId: { type: String },
    calendarSystemId: { type: String },
    syncStatus: {
      lastSynced: { type: Date },
      errors: [{ type: String }]
    }
  },
  
  // Flags and special handling
  flags: {
    isRecurring: { type: Boolean, default: false },
    recurringSchedule: { type: String }, // cron-like schedule
    requiresSpecialEquipment: { type: Boolean, default: false },
    highPriority: { type: Boolean, default: false },
    requiresCallBack: { type: Boolean, default: false },
    isTestBooking: { type: Boolean, default: false }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
bookingSchema.index({ companyId: 1, 'scheduling.confirmedDate': 1 });
bookingSchema.index({ 'customer.phone': 1 });
bookingSchema.index({ 'status.current': 1, companyId: 1 });
// bookingId already indexed due to unique: true constraint
bookingSchema.index({ 'aiInteraction.conversationId': 1 });

// Virtual for human-readable booking reference
bookingSchema.virtual('displayId').get(function() {
  return `${this.service.category.toUpperCase()}-${this.bookingId}`;
});

// Middleware
bookingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Generate booking ID if not exists
  if (!this.bookingId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.bookingId = `${timestamp}${random}`.toUpperCase();
  }
  
  // Track status changes
  if (this.isModified('status.current')) {
    this.status.history.push({
      status: this.status.current,
      changedAt: new Date(),
      changedBy: this.modifiedBy || 'system'
    });
  }
  
  next();
});

// Instance methods
bookingSchema.methods.updateStatus = function(newStatus, changedBy = 'system', reason = '', notes = '') {
  this.status.current = newStatus;
  this.status.history.push({
    status: newStatus,
    changedAt: new Date(),
    changedBy,
    reason,
    notes
  });
  return this.save();
};

bookingSchema.methods.addCommunication = function(type, direction, content, template = null) {
  this.communications.push({
    type,
    direction,
    content,
    template,
    sentAt: new Date(),
    deliveryStatus: 'sent'
  });
  return this.save();
};

bookingSchema.methods.scheduleReminder = function(type, method, scheduledFor, recipientType = 'customer') {
  const reminderArray = recipientType === 'customer' ? this.reminders.customerReminders : this.reminders.staffReminders;
  
  reminderArray.push({
    type,
    scheduledFor,
    method,
    status: 'scheduled'
  });
  
  return this.save();
};

// Static methods
bookingSchema.statics.findByDateRange = function(companyId, startDate, endDate) {
  return this.find({
    companyId,
    'scheduling.confirmedDate': {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ 'scheduling.confirmedDate': 1 });
};

bookingSchema.statics.getBookingAnalytics = function(companyId, dateRange = null) {
  const matchStage = { companyId };
  
  if (dateRange) {
    matchStage.createdAt = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status.current',
        count: { $sum: 1 },
        avgDuration: { $avg: '$scheduling.duration' },
        avgSatisfaction: { $avg: '$quality.customerSatisfaction' }
      }
    }
  ]);
};

module.exports = mongoose.model('Booking', bookingSchema);

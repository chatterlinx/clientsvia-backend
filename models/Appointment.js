/**
 * ============================================================================
 * APPOINTMENT MODEL - BOOKING MANAGEMENT
 * ============================================================================
 * 
 * PURPOSE: Track scheduled appointments created from AI calls
 * ARCHITECTURE: Links to Contact, Location, and CallTrace
 * SCOPE: Per-company, indexed for calendar/scheduling queries
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const AppointmentSchema = new mongoose.Schema({
  // Company association
  companyId: { 
    type: String, 
    required: true,
    index: true 
  },
  
  // Customer references
  contactId: { 
    type: ObjectId, 
    ref: 'Contact',
    required: true,
    index: true 
  },
  locationId: { 
    type: ObjectId, 
    ref: 'Location',
    required: true,
    index: true 
  },
  
  // Call tracking
  callId: { 
    type: String, 
    index: true 
  },
  
  // Service details
  trade: { type: String }, // "hvac", "plumbing", etc
  serviceType: { 
    type: String,
    enum: ['repair', 'maintenance', 'install', 'inspection', 'emergency', 'quote', 'other'],
    default: 'repair'
  },
  
  // Status management
  status: { 
    type: String,
    enum: ['scheduled', 'confirmed', 'in_progress', 'completed', 'canceled', 'no_show'],
    default: 'scheduled',
    index: true 
  },
  
  // Scheduling
  scheduledDate: { 
    type: String, // ISO date string (YYYY-MM-DD)
    required: true,
    index: true 
  },
  timeWindow: { 
    type: String, // "8-10", "10-12", "1-3", etc
    required: true 
  },
  
  // Priority and urgency
  priority: {
    type: String,
    enum: ['routine', 'high', 'urgent', 'emergency'],
    default: 'routine'
  },
  urgencyScore: { type: Number, default: 0 }, // 0-100
  
  // Notes
  notesForTech: { type: String, trim: true },
  accessNotes: { type: String, trim: true },
  customerNotes: { type: String, trim: true },
  
  // Confirmation and reminders
  confirmationSent: { type: Boolean, default: false },
  confirmationSentAt: { type: Date },
  reminderSent: { type: Boolean, default: false },
  reminderSentAt: { type: Date },
  
  // Technician assignment (future feature)
  assignedTechId: { type: String },
  assignedTechName: { type: String },
  
  // Completion tracking
  completedAt: { type: Date },
  completedBy: { type: String },
  workPerformed: { type: String, trim: true },
  
  // Cancellation tracking
  canceledAt: { type: Date },
  canceledBy: { type: String },
  cancelReason: { type: String, trim: true },
  
  // Billing (optional)
  estimatedCost: { type: Number },
  actualCost: { type: Number },
  
  // Metadata
  tags: [{ type: String, trim: true }],
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
AppointmentSchema.index({ companyId: 1, scheduledDate: 1 });
AppointmentSchema.index({ companyId: 1, status: 1 });
AppointmentSchema.index({ companyId: 1, trade: 1, scheduledDate: 1 });
AppointmentSchema.index({ assignedTechId: 1, scheduledDate: 1 });
AppointmentSchema.index({ contactId: 1, scheduledDate: -1 });
AppointmentSchema.index({ locationId: 1 });

// Virtual for formatted time slot
AppointmentSchema.virtual('formattedTimeSlot').get(function() {
  if (!this.timeWindow) return 'TBD';
  
  const parts = this.timeWindow.split('-');
  if (parts.length !== 2) return this.timeWindow;
  
  const formatHour = (h) => {
    const num = parseInt(h);
    if (num === 12) return '12 PM';
    if (num === 0) return '12 AM';
    return num > 12 ? `${num - 12} PM` : `${num} AM`;
  };
  
  return `${formatHour(parts[0])} - ${formatHour(parts[1])}`;
});

// Virtual for days until appointment
AppointmentSchema.virtual('daysUntil').get(function() {
  if (!this.scheduledDate) return null;
  
  const scheduled = new Date(this.scheduledDate);
  const now = new Date();
  const diffTime = scheduled - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
});

// Static methods
AppointmentSchema.statics.findByCompany = function(companyId, options = {}) {
  const query = this.find({ companyId });
  
  if (options.status) {
    query.where('status', options.status);
  }
  
  if (options.trade) {
    query.where('trade', options.trade);
  }
  
  if (options.startDate || options.endDate) {
    const dateQuery = {};
    if (options.startDate) {
      dateQuery.$gte = options.startDate;
    }
    if (options.endDate) {
      dateQuery.$lte = options.endDate;
    }
    query.where('scheduledDate', dateQuery);
  }
  
  if (options.limit) {
    query.limit(options.limit);
  }
  
  return query.sort({ scheduledDate: 1, timeWindow: 1 });
};

AppointmentSchema.statics.findByContact = function(contactId, options = {}) {
  const query = this.find({ contactId });
  
  if (options.limit) {
    query.limit(options.limit);
  }
  
  return query.sort({ scheduledDate: -1 });
};

AppointmentSchema.statics.findUpcoming = function(companyId, days = 7) {
  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  const futureDateStr = futureDate.toISOString().split('T')[0];
  
  return this.find({
    companyId,
    scheduledDate: { $gte: today, $lte: futureDateStr },
    status: { $in: ['scheduled', 'confirmed'] }
  }).sort({ scheduledDate: 1, timeWindow: 1 });
};

// Instance methods
AppointmentSchema.methods.markConfirmed = function() {
  this.status = 'confirmed';
  this.confirmationSent = true;
  this.confirmationSentAt = new Date();
  return this.save();
};

AppointmentSchema.methods.markCompleted = function(completedBy, workPerformed) {
  this.status = 'completed';
  this.completedAt = new Date();
  this.completedBy = completedBy;
  if (workPerformed) {
    this.workPerformed = workPerformed;
  }
  return this.save();
};

AppointmentSchema.methods.cancel = function(canceledBy, reason) {
  this.status = 'canceled';
  this.canceledAt = new Date();
  this.canceledBy = canceledBy;
  if (reason) {
    this.cancelReason = reason;
  }
  return this.save();
};

AppointmentSchema.methods.assignTech = function(techId, techName) {
  this.assignedTechId = techId;
  this.assignedTechName = techName;
  return this.save();
};

module.exports = mongoose.model('Appointment', AppointmentSchema);


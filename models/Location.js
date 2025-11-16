/**
 * ============================================================================
 * LOCATION MODEL - SERVICE ADDRESS MANAGEMENT
 * ============================================================================
 * 
 * PURPOSE: Track service locations with access profiles
 * ARCHITECTURE: Links to Contact, stores gate codes/access notes
 * SCOPE: Per-company isolation, indexed for fast lookups
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const AccessProfileSchema = new mongoose.Schema({
  gateCode: { type: String, trim: true },
  doorCode: { type: String, trim: true },
  alarmInfo: { type: String, trim: true },
  petsInfo: { type: String, trim: true },
  notes: { type: String, trim: true },
  confirmOnEveryVisit: { type: Boolean, default: false }
}, { _id: false });

const LocationSchema = new mongoose.Schema({
  // Company association (multi-tenant)
  companyId: { 
    type: String, 
    required: true,
    index: true 
  },
  
  // Address details
  addressLine1: { 
    type: String, 
    trim: true,
    required: true 
  },
  addressLine2: { type: String, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  postalCode: { 
    type: String, 
    trim: true,
    index: true 
  },
  
  // Geocoding (optional, for future routing optimization)
  coordinates: {
    latitude: { type: Number },
    longitude: { type: Number }
  },
  
  // Contact association
  contactId: { 
    type: ObjectId, 
    ref: 'Contact',
    index: true 
  },
  
  // Access and visit information
  accessProfile: AccessProfileSchema,
  
  // Location metadata
  locationType: {
    type: String,
    enum: ['residential', 'commercial', 'industrial'],
    default: 'residential'
  },
  
  // Service history tracking
  visitCount: { type: Number, default: 0 },
  lastVisitDate: { type: Date },
  
  // Notes and tags
  notes: { type: String, trim: true },
  tags: [{ type: String, trim: true }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
LocationSchema.index({ companyId: 1, addressLine1: 1, postalCode: 1 });
LocationSchema.index({ companyId: 1, contactId: 1 });
LocationSchema.index({ companyId: 1, lastVisitDate: -1 });

// Virtual for full address
LocationSchema.virtual('fullAddress').get(function() {
  const parts = [
    this.addressLine1,
    this.addressLine2,
    this.city,
    this.state,
    this.postalCode
  ].filter(Boolean);
  
  return parts.join(', ');
});

// Virtual for access requirements
LocationSchema.virtual('hasAccessRequirements').get(function() {
  const profile = this.accessProfile;
  if (!profile) return false;
  
  return !!(
    profile.gateCode ||
    profile.doorCode ||
    profile.alarmInfo ||
    profile.petsInfo ||
    profile.notes
  );
});

// Static methods
LocationSchema.statics.findByAddress = function(companyId, addressLine1, postalCode) {
  return this.findOne({
    companyId,
    addressLine1: new RegExp(`^${addressLine1}$`, 'i'),
    postalCode
  });
};

LocationSchema.statics.findByContact = function(contactId, options = {}) {
  const query = this.find({ contactId });
  
  if (options.limit) {
    query.limit(options.limit);
  }
  
  return query.sort({ lastVisitDate: -1 });
};

LocationSchema.statics.findByCompany = function(companyId, options = {}) {
  const query = this.find({ companyId });
  
  if (options.locationType) {
    query.where('locationType', options.locationType);
  }
  
  if (options.limit) {
    query.limit(options.limit);
  }
  
  return query.sort({ lastVisitDate: -1 });
};

// Instance methods
LocationSchema.methods.recordVisit = function() {
  this.visitCount += 1;
  this.lastVisitDate = new Date();
  return this.save();
};

LocationSchema.methods.updateAccessProfile = function(updates) {
  this.accessProfile = {
    ...this.accessProfile,
    ...updates
  };
  return this.save();
};

module.exports = mongoose.model('Location', LocationSchema);


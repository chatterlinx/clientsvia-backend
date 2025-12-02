/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VENDOR MODEL
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Track non-customer contacts: suppliers, vendors, delivery drivers, etc.
 * 
 * Examples:
 * - Supply houses calling about parts orders
 * - Delivery drivers calling about packages
 * - Equipment reps calling about warranties
 * - Parts distributors with order updates
 * 
 * These are B2B operational calls, NOT customer service calls.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// VENDOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

const VENDOR_TYPES = {
  SUPPLY_HOUSE: 'supply_house',
  PARTS_DISTRIBUTOR: 'parts_distributor',
  EQUIPMENT_MANUFACTURER: 'equipment_manufacturer',
  DELIVERY_SERVICE: 'delivery_service',
  WHOLESALER: 'wholesaler',
  CONTRACTOR: 'contractor',
  UTILITY_COMPANY: 'utility_company',
  INSPECTOR: 'inspector',
  OTHER: 'other'
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const VendorSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Multi-tenant)
  // ─────────────────────────────────────────────────────────────────────────
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: [true, 'companyId is required for multi-tenant isolation'],
    index: true 
  },
  
  /**
   * Human-readable vendor ID
   * Format: "VEND-{timestamp}"
   */
  vendorId: { 
    type: String, 
    unique: true,
    sparse: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS INFORMATION
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Vendor company name
   * e.g., "Johnstone Supply", "FedEx", "Carrier Corporation"
   */
  businessName: { 
    type: String, 
    required: [true, 'businessName is required'],
    trim: true,
    maxLength: 200
  },
  
  /**
   * Type of vendor
   */
  vendorType: { 
    type: String, 
    enum: Object.values(VENDOR_TYPES),
    default: VENDOR_TYPES.OTHER,
    index: true
  },
  
  /**
   * Your account number with this vendor
   */
  accountNumber: { 
    type: String, 
    trim: true,
    maxLength: 50
  },
  
  /**
   * Main phone number
   */
  phone: { 
    type: String,
    index: true
  },
  
  /**
   * Secondary/alternate phones
   */
  secondaryPhones: {
    type: [String],
    default: []
  },
  
  /**
   * Email address
   */
  email: { 
    type: String,
    lowercase: true,
    trim: true
  },
  
  /**
   * Website
   */
  website: { 
    type: String,
    trim: true
  },
  
  /**
   * Physical address
   */
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true, uppercase: true, maxLength: 2 },
    zip: { type: String, trim: true }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CONTACTS (People at this vendor)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Known contacts at this vendor
   * e.g., "John at the counter", "Maria in accounting"
   */
  contacts: [{
    name: { type: String, maxLength: 100, required: true },
    role: { type: String, maxLength: 100 },  // "Sales Rep", "Driver", "Accounts"
    phone: { type: String },
    email: { type: String, lowercase: true },
    extension: { type: String, maxLength: 10 },
    isPrimary: { type: Boolean, default: false },
    notes: { type: String, maxLength: 200 }
  }],
  
  // ─────────────────────────────────────────────────────────────────────────
  // BUSINESS DETAILS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Business hours (for pickup scheduling)
   */
  businessHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String },
    notes: { type: String, maxLength: 200 }  // "Closed for lunch 12-1"
  },
  
  /**
   * Payment terms with this vendor
   */
  paymentTerms: {
    type: String,
    enum: ['cod', 'net_15', 'net_30', 'net_45', 'net_60', 'credit_card', 'account'],
    default: 'account'
  },
  
  /**
   * Discount or special pricing
   */
  discountInfo: { 
    type: String, 
    maxLength: 200 
  },
  
  /**
   * Delivery days (if they deliver)
   */
  deliveryDays: [{
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  }],
  
  /**
   * Minimum order amount
   */
  minimumOrder: { 
    type: Number, 
    min: 0 
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // TRACKING
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * How many calls from this vendor
   */
  totalCalls: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  /**
   * Last call from this vendor
   */
  lastCallAt: { 
    type: Date,
    index: true
  },
  
  /**
   * First contact with this vendor
   */
  firstContactAt: { 
    type: Date,
    default: Date.now
  },
  
  /**
   * Is this vendor currently active?
   */
  isActive: { 
    type: Boolean, 
    default: true,
    index: true
  },
  
  /**
   * Special notes
   */
  notes: { 
    type: String, 
    maxLength: 2000 
  },
  
  /**
   * Tags for organization
   */
  tags: [{
    type: String,
    maxLength: 50
  }]
  
}, {
  timestamps: true,
  collection: 'vendors'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Compound index for company + phone lookup
VendorSchema.index({ companyId: 1, phone: 1 }, { name: 'idx_company_phone' });
VendorSchema.index({ companyId: 1, secondaryPhones: 1 }, { name: 'idx_company_secondary_phones' });
VendorSchema.index({ companyId: 1, vendorType: 1 }, { name: 'idx_company_type' });
VendorSchema.index({ companyId: 1, businessName: 1 }, { name: 'idx_company_name' });

// Text search
VendorSchema.index(
  { businessName: 'text', notes: 'text', 'contacts.name': 'text' },
  { name: 'idx_vendor_text_search' }
);

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOKS
// ═══════════════════════════════════════════════════════════════════════════

VendorSchema.pre('save', function(next) {
  // Generate vendorId if not set
  if (!this.vendorId) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.vendorId = `VEND-${timestamp}${random}`;
    logger.debug('[VENDOR] Generated vendorId:', { vendorId: this.vendorId });
  }
  
  // Normalize phone
  if (this.phone && !this.phone.startsWith('+')) {
    const digits = this.phone.replace(/\D/g, '');
    if (digits.length === 10) {
      this.phone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      this.phone = `+${digits}`;
    }
  }
  
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find vendor by phone (company-scoped)
 */
VendorSchema.statics.findByPhone = async function(companyId, phone) {
  if (!companyId || !phone) return null;
  
  // Normalize phone
  let normalizedPhone = phone;
  if (!phone.startsWith('+')) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      normalizedPhone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      normalizedPhone = `+${digits}`;
    }
  }
  
  // Check primary phone
  let vendor = await this.findOne({ companyId, phone: normalizedPhone }).lean();
  
  // Check secondary phones
  if (!vendor) {
    vendor = await this.findOne({ 
      companyId, 
      secondaryPhones: normalizedPhone 
    }).lean();
  }
  
  return vendor;
};

/**
 * Get or create vendor by phone
 * Returns existing vendor or creates placeholder
 */
VendorSchema.statics.getOrCreateByPhone = async function(companyId, phone, callerName = null) {
  if (!companyId || !phone) {
    throw new Error('companyId and phone are required');
  }
  
  // Normalize phone
  let normalizedPhone = phone;
  if (!phone.startsWith('+')) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      normalizedPhone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      normalizedPhone = `+${digits}`;
    }
  }
  
  // Try to find existing
  let vendor = await this.findByPhone(companyId, normalizedPhone);
  
  if (vendor) {
    // Update last call
    await this.findByIdAndUpdate(vendor._id, {
      $set: { lastCallAt: new Date() },
      $inc: { totalCalls: 1 }
    });
    return { vendor, isNew: false };
  }
  
  // Create new vendor placeholder
  const newVendor = await this.create({
    companyId,
    phone: normalizedPhone,
    businessName: callerName || 'Unknown Vendor',
    vendorType: VENDOR_TYPES.OTHER,
    lastCallAt: new Date()
  });
  
  logger.info('[VENDOR] New vendor created', {
    vendorId: newVendor.vendorId,
    companyId,
    phone: normalizedPhone
  });
  
  return { vendor: newVendor, isNew: true };
};

/**
 * Search vendors
 */
VendorSchema.statics.search = async function(companyId, criteria = {}, options = {}) {
  const {
    query,
    vendorType,
    isActive = true,
    tags
  } = criteria;
  
  const {
    page = 1,
    limit = 50,
    sort = { businessName: 1 }
  } = options;
  
  const mongoQuery = { companyId };
  
  if (typeof isActive === 'boolean') {
    mongoQuery.isActive = isActive;
  }
  
  if (vendorType) {
    mongoQuery.vendorType = vendorType;
  }
  
  if (tags && tags.length > 0) {
    mongoQuery.tags = { $all: tags };
  }
  
  if (query) {
    mongoQuery.$or = [
      { businessName: { $regex: query, $options: 'i' } },
      { phone: { $regex: query, $options: 'i' } },
      { 'contacts.name': { $regex: query, $options: 'i' } },
      { accountNumber: { $regex: query, $options: 'i' } }
    ];
  }
  
  const skip = (page - 1) * Math.min(limit, 100);
  const actualLimit = Math.min(limit, 100);
  
  const [vendors, total] = await Promise.all([
    this.find(mongoQuery)
      .sort(sort)
      .skip(skip)
      .limit(actualLimit)
      .lean(),
    this.countDocuments(mongoQuery)
  ]);
  
  return {
    vendors,
    total,
    page,
    limit: actualLimit,
    pages: Math.ceil(total / actualLimit)
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Add a contact to this vendor
 */
VendorSchema.methods.addContact = async function(contactData) {
  this.contacts.push(contactData);
  await this.save();
  return this;
};

/**
 * Get primary contact
 */
VendorSchema.methods.getPrimaryContact = function() {
  return this.contacts.find(c => c.isPrimary) || this.contacts[0] || null;
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const Vendor = mongoose.model('Vendor', VendorSchema);

module.exports = Vendor;
module.exports.VENDOR_TYPES = VENDOR_TYPES;


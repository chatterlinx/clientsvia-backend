/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOMER MODEL (V2 - LEAN)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * CRITICAL DESIGN DECISIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Document size MUST stay < 4KB for Redis caching efficiency
 * 2. NO embedded arrays that can grow unboundedly (callHistory, notes, etc.)
 * 3. History is stored in CustomerEvent collection (event-sourced)
 * 4. Stats updated via $inc (atomic, no race conditions)
 * 5. Primary lookup key = phone (E.164 format)
 * 
 * WHY THIS DESIGN:
 * ─────────────────────────────────────────────────────────────────────────────
 * V1 had embedded arrays that would hit MongoDB's 16MB limit with high-volume
 * customers. A customer with 5,000 calls would break the system.
 * 
 * V2 keeps the customer document lean and fast. All history is event-sourced
 * in CustomerEvent, which is append-only and can scale infinitely.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const CustomerSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Multi-tenant required)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Company this customer belongs to
   * REQUIRED for multi-tenant isolation - every query MUST filter by this
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: [true, 'companyId is required for multi-tenant isolation'],
    index: true 
  },
  
  /**
   * Human-readable customer ID for display
   * Auto-generated on first save
   * Format: "CUST-{timestamp-base36}"
   */
  customerId: { 
    type: String, 
    unique: true,
    sparse: true  // Allow null during creation, unique when set
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CONTACT INFORMATION (Primary lookup = phone)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Primary phone number - THE lookup key for caller ID
   * Format: E.164 (+13055551234)
   * Unique per company (compound index below)
   */
  phone: { 
    type: String, 
    required: [true, 'phone is required'],
    index: true,
    validate: {
      validator: function(v) {
        // E.164 format: + followed by 10-15 digits
        return /^\+[1-9]\d{9,14}$/.test(v);
      },
      message: props => `${props.value} is not a valid E.164 phone number`
    }
  },
  
  /**
   * Secondary phone numbers (limited to 5 to keep document small)
   * Used for alternate number lookup
   */
  secondaryPhones: {
    type: [String],
    validate: [
      {
        validator: function(v) { return v.length <= 5; },
        message: 'Maximum 5 secondary phones allowed'
      }
    ],
    default: []
  },
  
  /**
   * Phone type detection
   * Used for: SMS capability, callback prioritization, shared line detection
   */
  phoneType: {
    type: String,
    enum: ['mobile', 'landline', 'voip', 'unknown'],
    default: 'unknown',
    index: true
  },
  
  /**
   * Can this phone receive SMS?
   * null = not yet determined
   */
  canSms: {
    type: Boolean,
    default: null
  },
  
  /**
   * Carrier name (if known from Twilio lookup)
   */
  carrier: {
    type: String,
    maxLength: 100
  },
  
  /**
   * Email address
   */
  email: { 
    type: String,
    lowercase: true,
    trim: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // PERSONAL INFORMATION
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Full name (auto-computed from first + last)
   */
  fullName: { 
    type: String,
    trim: true 
  },
  
  firstName: { 
    type: String,
    trim: true 
  },
  
  lastName: { 
    type: String,
    trim: true 
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // STATUS & LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Customer status
   * 
   * - placeholder: Created at call start, not yet enriched
   * - lead: Information captured but no service yet
   * - customer: Has completed at least one service
   * - inactive: No contact in 12+ months
   * - churned: Explicitly marked as lost
   * - dnc: Do Not Contact (legal/compliance)
   */
  status: { 
    type: String, 
    enum: {
      values: ['placeholder', 'lead', 'customer', 'inactive', 'churned', 'dnc'],
      message: '{VALUE} is not a valid customer status'
    },
    default: 'placeholder',
    index: true
  },
  
  /**
   * Customer type
   */
  customerType: { 
    type: String, 
    enum: {
      values: ['residential', 'commercial', 'property_manager'],
      message: '{VALUE} is not a valid customer type'
    },
    default: 'residential'
  },
  
  /**
   * Lifecycle timestamps
   */
  firstContactAt: { 
    type: Date,
    default: Date.now
  },
  
  lastContactAt: { 
    type: Date, 
    index: true,
    default: Date.now
  },
  
  becameCustomerAt: { 
    type: Date  // Set when first appointment is completed
  },
  
  /**
   * How did this customer find us?
   */
  source: { 
    type: String,
    enum: ['phone_call', 'website', 'referral', 'google', 'yelp', 'facebook', 'other', 'unknown'],
    default: 'phone_call'
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // STATISTICS (Updated via $inc - atomic, race-proof)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * These stats are updated atomically using $inc
   * Never read-modify-write, always $inc
   */
  totalCalls: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  totalAppointments: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  completedAppointments: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  cancelledAppointments: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  noShows: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  /**
   * Lifetime value in dollars (updated when invoices are paid)
   */
  lifetimeValue: { 
    type: Number, 
    default: 0,
    min: 0
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // PRIMARY ADDRESS (One only - additional addresses in CustomerEvent)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Primary service address
   * Additional addresses stored as events (address_added)
   */
  primaryAddress: {
    street: { type: String, trim: true },
    unit: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true, uppercase: true, maxLength: 2 },
    zip: { type: String, trim: true },
    
    // Access information for technicians
    accessNotes: { type: String, maxLength: 500 },
    keyLocation: { type: String, maxLength: 200 },
    gateCode: { type: String, maxLength: 50 },
    lockboxCode: { type: String, maxLength: 50 },
    
    // Alternate contact for this address
    alternateContact: {
      name: { type: String, maxLength: 100 },
      phone: { type: String },
      relationship: { type: String, maxLength: 50 }  // "Neighbor", "Property Manager"
    },
    
    // Pet information
    petInfo: { type: String, maxLength: 200 }
  },
  
  /**
   * Normalized address key for deduplication
   * Format: "123 MAIN ST|MIAMI|FL|33101"
   * Used to find other household members at same address
   * Auto-generated from primaryAddress on save
   */
  addressKey: {
    type: String,
    index: true,
    sparse: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // HOUSEHOLD MEMBERS (Limited to 10 to keep document small)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Other contacts at this household/property
   * Used for: husband/wife, property manager, tenant, etc.
   * When another person calls from this address, we link them here
   * 
   * IMPORTANT: This is bounded to 10 to prevent document bloat
   * Additional contacts go to CustomerEvent
   */
  householdMembers: {
    type: [{
      name: { type: String, maxLength: 100, required: true },
      phone: { type: String },  // E.164 format if known
      phoneType: { type: String, enum: ['mobile', 'landline', 'voip', 'unknown'] },
      relationship: { type: String, maxLength: 50 },  // "Spouse", "Tenant", "Property Manager"
      isPrimary: { type: Boolean, default: false },  // Who is the primary decision maker?
      canAuthorize: { type: Boolean, default: true },  // Can approve work?
      preferredContact: { type: Boolean, default: false },  // Who to call first?
      addedAt: { type: Date, default: Date.now }
    }],
    validate: [
      {
        validator: function(v) { return v.length <= 10; },
        message: 'Maximum 10 household members allowed (use CustomerEvent for more)'
      }
    ],
    default: []
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // PREFERENCES (Small, fixed structure)
  // ─────────────────────────────────────────────────────────────────────────
  
  preferences: {
    preferredTimeOfDay: { 
      type: String,
      enum: ['early_morning', 'morning', 'afternoon', 'evening', 'any']
    },
    
    preferredDays: [{
      type: String,
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    }],
    
    communicationMethod: { 
      type: String, 
      enum: ['call', 'text', 'email'],
      default: 'call'
    },
    
    language: { 
      type: String, 
      default: 'en',
      maxLength: 5
    },
    
    // Special handling instructions
    specialInstructions: { 
      type: String, 
      maxLength: 500 
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // TAGS (Small array - max 20 tags for segmentation)
  // ─────────────────────────────────────────────────────────────────────────
  
  tags: {
    type: [String],
    validate: [
      {
        validator: function(v) { return v.length <= 20; },
        message: 'Maximum 20 tags allowed'
      }
    ],
    default: []
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // COMPLIANCE FLAGS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Encryption status tracking
   * When true, the field value is encrypted
   */
  _encrypted: {
    phone: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    address: { type: Boolean, default: false }
  },
  
  /**
   * GDPR/CCPA consent
   */
  consent: {
    marketingOptIn: { type: Boolean, default: false },
    marketingOptInDate: { type: Date },
    dataProcessingConsent: { type: Boolean, default: true },
    dataProcessingConsentDate: { type: Date, default: Date.now }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // REMOVED FROM V1 (Moved to CustomerEvent collection):
  // ─────────────────────────────────────────────────────────────────────────
  // - callHistory: [ObjectId]     → customer_events with type: 'call_completed'
  // - notes: [...]                → customer_events with type: 'note_added'
  // - equipment: [...]            → customer_events with type: 'equipment_added'
  // - addresses: [...]            → customer_events with type: 'address_added'
  // - appointments: [ObjectId]    → customer_events with type: 'appointment_*'
  // ─────────────────────────────────────────────────────────────────────────
  
}, { 
  timestamps: true,  // Adds createdAt and updatedAt
  collection: 'customers',
  
  // Optimize for read-heavy workload
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Primary lookup: Phone number per company (UNIQUE)
 * This is THE critical index for customer recognition
 */
CustomerSchema.index(
  { companyId: 1, phone: 1 }, 
  { unique: true, name: 'idx_company_phone_unique' }
);

/**
 * Secondary phone lookup
 */
CustomerSchema.index(
  { companyId: 1, secondaryPhones: 1 },
  { name: 'idx_company_secondary_phones' }
);

/**
 * Recent activity (for "recently contacted" lists)
 */
CustomerSchema.index(
  { companyId: 1, lastContactAt: -1 },
  { name: 'idx_company_last_contact' }
);

/**
 * Status filtering
 */
CustomerSchema.index(
  { companyId: 1, status: 1 },
  { name: 'idx_company_status' }
);

/**
 * Tag filtering (for segmentation)
 */
CustomerSchema.index(
  { companyId: 1, tags: 1 },
  { name: 'idx_company_tags' }
);

/**
 * Email lookup (optional, sparse)
 */
CustomerSchema.index(
  { companyId: 1, email: 1 },
  { sparse: true, name: 'idx_company_email' }
);

/**
 * Text search on name and email
 */
CustomerSchema.index(
  { fullName: 'text', email: 'text', firstName: 'text', lastName: 'text' },
  { name: 'idx_text_search', weights: { fullName: 10, firstName: 5, lastName: 5, email: 3 } }
);

/**
 * Address key lookup for deduplication
 * Finds customers at the same address (household matching)
 */
CustomerSchema.index(
  { companyId: 1, addressKey: 1 },
  { sparse: true, name: 'idx_company_address_key' }
);

/**
 * Household member phone lookup
 * Find customer by any household member's phone
 */
CustomerSchema.index(
  { companyId: 1, 'householdMembers.phone': 1 },
  { sparse: true, name: 'idx_company_household_phones' }
);


// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOKS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Auto-generate customerId, fullName, and addressKey before save
 */
CustomerSchema.pre('save', function(next) {
  // Generate customerId if not set
  if (!this.customerId) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.customerId = `CUST-${timestamp}${random}`;
    logger.debug('[CUSTOMER] Generated customerId:', { customerId: this.customerId });
  }
  
  // Auto-compute fullName from firstName + lastName
  if (this.firstName || this.lastName) {
    this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }
  
  // Normalize phone to E.164 if it looks like a US number without +
  if (this.phone && !this.phone.startsWith('+')) {
    const digits = this.phone.replace(/\D/g, '');
    if (digits.length === 10) {
      this.phone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      this.phone = `+${digits}`;
    }
  }
  
  // Generate addressKey for deduplication
  if (this.primaryAddress && this.primaryAddress.street) {
    try {
      const { generateAddressKey } = require('../utils/addressNormalizer');
      this.addressKey = generateAddressKey(this.primaryAddress);
      logger.debug('[CUSTOMER] Generated addressKey:', { 
        customerId: this.customerId, 
        addressKey: this.addressKey 
      });
    } catch (err) {
      logger.warn('[CUSTOMER] Failed to generate addressKey:', { error: err.message });
      // Continue without addressKey - not critical
    }
  }
  
  next();
});


// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find customer by phone (company-scoped)
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} phone - Phone number (E.164 format)
 * @returns {Promise<Customer|null>}
 */
CustomerSchema.statics.findByPhone = async function(companyId, phone) {
  if (!companyId || !phone) {
    logger.warn('[CUSTOMER] findByPhone called with missing params', { companyId: !!companyId, phone: !!phone });
    return null;
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
  
  // Try primary phone first
  let customer = await this.findOne({ companyId, phone: normalizedPhone }).lean();
  
  // If not found, check secondary phones
  if (!customer) {
    customer = await this.findOne({ 
      companyId, 
      secondaryPhones: normalizedPhone 
    }).lean();
  }
  
  return customer;
};

/**
 * Atomic upsert for race-proof customer creation
 * This is THE critical method for handling concurrent calls
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} phone - Phone number (E.164 format)
 * @returns {Promise<{customer: Customer, isNew: boolean}>}
 */
CustomerSchema.statics.getOrCreatePlaceholder = async function(companyId, phone) {
  if (!companyId || !phone) {
    throw new Error('companyId and phone are required');
  }
  
  // Normalize phone to E.164
  let normalizedPhone = phone;
  if (!phone.startsWith('+')) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      normalizedPhone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      normalizedPhone = `+${digits}`;
    } else {
      throw new Error(`Invalid phone format: ${phone}`);
    }
  }
  
  const now = new Date();
  
  // Atomic upsert - this handles race conditions
  // If 100 calls come in simultaneously, only 1 customer is created
  // and all 100 get $inc'd on totalCalls
  const result = await this.findOneAndUpdate(
    { companyId, phone: normalizedPhone },
    {
      $setOnInsert: {
        status: 'placeholder',
        firstContactAt: now,
        source: 'phone_call'
      },
      $set: { 
        lastContactAt: now 
      },
      $inc: { 
        totalCalls: 1 
      }
    },
    { 
      upsert: true, 
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );
  
  // Determine if this was a new customer
  // If firstContactAt equals lastContactAt and totalCalls is 1, it's new
  const isNew = result.totalCalls === 1;
  
  logger.info('[CUSTOMER] getOrCreatePlaceholder completed', {
    companyId: companyId.toString(),
    phone: normalizedPhone,
    customerId: result.customerId,
    isNew,
    totalCalls: result.totalCalls
  });
  
  return { customer: result, isNew };
};

/**
 * Increment stats atomically
 * 
 * @param {ObjectId} customerId - Customer document ID
 * @param {Object} increments - Fields to increment { totalAppointments: 1, lifetimeValue: 150 }
 */
CustomerSchema.statics.incrementStats = async function(customerId, increments) {
  if (!customerId || !increments) {
    throw new Error('customerId and increments are required');
  }
  
  const allowedFields = [
    'totalCalls', 'totalAppointments', 'completedAppointments',
    'cancelledAppointments', 'noShows', 'lifetimeValue'
  ];
  
  const $inc = {};
  for (const [field, value] of Object.entries(increments)) {
    if (allowedFields.includes(field) && typeof value === 'number') {
      $inc[field] = value;
    }
  }
  
  if (Object.keys($inc).length === 0) {
    logger.warn('[CUSTOMER] incrementStats called with no valid increments', { customerId, increments });
    return null;
  }
  
  const result = await this.findByIdAndUpdate(
    customerId,
    { $inc, $set: { lastContactAt: new Date() } },
    { new: true }
  );
  
  logger.debug('[CUSTOMER] Stats incremented', { customerId, increments: $inc });
  
  return result;
};

/**
 * Find customers at the same address (household matching)
 * Used to prevent duplicates when different household members call
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Object} address - Address to match { street, city, state, zip }
 * @returns {Promise<Customer[]>} - Array of customers at this address
 */
CustomerSchema.statics.findByAddress = async function(companyId, address) {
  if (!companyId || !address || !address.street) {
    return [];
  }
  
  try {
    const { generateAddressKey } = require('../utils/addressNormalizer');
    const addressKey = generateAddressKey(address);
    
    if (!addressKey) {
      return [];
    }
    
    const customers = await this.find({
      companyId,
      addressKey: addressKey
    }).lean();
    
    logger.debug('[CUSTOMER] findByAddress', { 
      companyId: companyId.toString(), 
      addressKey, 
      matchCount: customers.length 
    });
    
    return customers;
  } catch (err) {
    logger.error('[CUSTOMER] findByAddress error:', { error: err.message });
    return [];
  }
};

/**
 * Comprehensive customer lookup with multiple matching strategies
 * 
 * Priority:
 * 1. Primary phone exact match
 * 2. Secondary phones match
 * 3. Household member phone match
 * 4. Address match (if provided)
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Object} criteria - Lookup criteria { phone, address }
 * @returns {Promise<{customer: Customer|null, matchType: string, confidence: number}>}
 */
CustomerSchema.statics.comprehensiveLookup = async function(companyId, criteria) {
  const { phone, address, name } = criteria || {};
  
  if (!companyId) {
    return { customer: null, matchType: 'none', confidence: 0 };
  }
  
  // Normalize phone if provided
  let normalizedPhone = null;
  if (phone) {
    normalizedPhone = phone;
    if (!phone.startsWith('+')) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 10) {
        normalizedPhone = `+1${digits}`;
      } else if (digits.length === 11 && digits.startsWith('1')) {
        normalizedPhone = `+${digits}`;
      }
    }
  }
  
  // Strategy 1: Primary phone match (highest confidence)
  if (normalizedPhone) {
    const primaryMatch = await this.findOne({ companyId, phone: normalizedPhone }).lean();
    if (primaryMatch) {
      return { 
        customer: primaryMatch, 
        matchType: 'primary_phone', 
        confidence: 1.0 
      };
    }
    
    // Strategy 2: Secondary phone match
    const secondaryMatch = await this.findOne({ 
      companyId, 
      secondaryPhones: normalizedPhone 
    }).lean();
    if (secondaryMatch) {
      return { 
        customer: secondaryMatch, 
        matchType: 'secondary_phone', 
        confidence: 0.95 
      };
    }
    
    // Strategy 3: Household member phone match
    const householdMatch = await this.findOne({
      companyId,
      'householdMembers.phone': normalizedPhone
    }).lean();
    if (householdMatch) {
      return { 
        customer: householdMatch, 
        matchType: 'household_phone', 
        confidence: 0.90 
      };
    }
  }
  
  // Strategy 4: Address match (if no phone match or no phone provided)
  if (address && address.street) {
    try {
      const { generateAddressKey } = require('../utils/addressNormalizer');
      const addressKey = generateAddressKey(address);
      
      if (addressKey) {
        const addressMatches = await this.find({
          companyId,
          addressKey: addressKey
        }).lean();
        
        if (addressMatches.length > 0) {
          // If multiple matches (different household members), prefer the primary
          const primaryContact = addressMatches.find(c => 
            c.householdMembers?.some(m => m.isPrimary)
          ) || addressMatches[0];
          
          return {
            customer: primaryContact,
            matchType: 'address',
            confidence: 0.80,
            allMatches: addressMatches  // Include all for UI to show
          };
        }
      }
    } catch (err) {
      logger.error('[CUSTOMER] Address matching error:', { error: err.message });
    }
  }
  
  // No match found
  return { customer: null, matchType: 'none', confidence: 0 };
};

/**
 * Add a new household member to an existing customer
 * 
 * @param {ObjectId} customerId - Customer document ID
 * @param {Object} member - New household member { name, phone, relationship, ... }
 * @returns {Promise<Customer>} - Updated customer
 */
CustomerSchema.statics.addHouseholdMember = async function(customerId, member) {
  if (!customerId || !member || !member.name) {
    throw new Error('customerId and member.name are required');
  }
  
  // Normalize phone if provided
  if (member.phone && !member.phone.startsWith('+')) {
    const digits = member.phone.replace(/\D/g, '');
    if (digits.length === 10) {
      member.phone = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith('1')) {
      member.phone = `+${digits}`;
    }
  }
  
  // Also add to secondaryPhones if phone provided
  const updateQuery = {
    $push: {
      householdMembers: {
        ...member,
        addedAt: new Date()
      }
    }
  };
  
  if (member.phone) {
    updateQuery.$addToSet = { secondaryPhones: member.phone };
  }
  
  const customer = await this.findByIdAndUpdate(
    customerId,
    updateQuery,
    { new: true }
  );
  
  if (customer) {
    logger.info('[CUSTOMER] Added household member', { 
      customerId: customer.customerId,
      memberName: member.name,
      memberPhone: member.phone,
      relationship: member.relationship
    });
  }
  
  return customer;
};


// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get display name (fullName or phone if no name)
 */
CustomerSchema.methods.getDisplayName = function() {
  return this.fullName || this.phone;
};

/**
 * Check if customer is a returning customer (not a placeholder)
 */
CustomerSchema.methods.isReturning = function() {
  return this.status !== 'placeholder' && this.totalCalls > 1;
};

/**
 * Get brief context for AI (used in LLM-0 prompts)
 */
CustomerSchema.methods.getAIContext = function() {
  return {
    customerId: this.customerId,
    name: this.fullName || null,
    isReturning: this.isReturning(),
    totalCalls: this.totalCalls,
    status: this.status,
    lastContactAt: this.lastContactAt,
    preferences: this.preferences || {},
    primaryAddress: this.primaryAddress ? {
      city: this.primaryAddress.city,
      state: this.primaryAddress.state,
      accessNotes: this.primaryAddress.accessNotes,
      keyLocation: this.primaryAddress.keyLocation,
      alternateContact: this.primaryAddress.alternateContact
    } : null
  };
};


// ═══════════════════════════════════════════════════════════════════════════
// VIRTUALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Full address as single string
 */
CustomerSchema.virtual('primaryAddress.full').get(function() {
  if (!this.primaryAddress) return null;
  
  const parts = [
    this.primaryAddress.street,
    this.primaryAddress.unit ? `Unit ${this.primaryAddress.unit}` : null,
    this.primaryAddress.city,
    this.primaryAddress.state,
    this.primaryAddress.zip
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(', ') : null;
});

/**
 * Days since last contact
 */
CustomerSchema.virtual('daysSinceLastContact').get(function() {
  if (!this.lastContactAt) return null;
  const diffMs = Date.now() - this.lastContactAt.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
});


// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const Customer = mongoose.model('Customer', CustomerSchema);

module.exports = Customer;


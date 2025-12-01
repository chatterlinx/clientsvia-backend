/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOMER LOOKUP SERVICE (Race-Proof Recognition)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * This is THE critical service for customer recognition.
 * Called at the START of every incoming call to identify the caller.
 * 
 * RACE-PROOF DESIGN:
 * ─────────────────────────────────────────────────────────────────────────────
 * Problem: 100 concurrent calls from same number = 100 customers created
 * Solution: Atomic upsert with $setOnInsert + Redis cache
 * 
 * Flow:
 * 1. Check Redis cache (< 1ms)
 * 2. If miss, atomic upsert in MongoDB
 * 3. Cache result in Redis (5 min TTL)
 * 4. Return customer context for LLM-0
 * 
 * PERFORMANCE TARGETS:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Cache hit: < 5ms
 * - Cache miss: < 50ms
 * - 100 concurrent lookups: No duplicates
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const logger = require('../utils/logger');

// Try to get Redis client (may not be available in all environments)
let redisClient = null;
try {
  const { getRedisClient } = require('../config/redis');
  redisClient = getRedisClient();
} catch (err) {
  logger.warn('[CUSTOMER_LOOKUP] Redis not available, using MongoDB only');
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Redis cache TTL in seconds
  CACHE_TTL: 300,  // 5 minutes
  
  // Redis key prefix
  CACHE_PREFIX: 'customer:',
  
  // Max phone number length (E.164)
  MAX_PHONE_LENGTH: 16,
  
  // Enable detailed logging
  DEBUG: process.env.NODE_ENV !== 'production'
};

// ═══════════════════════════════════════════════════════════════════════════
// PHONE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize phone number to E.164 format
 * 
 * @param {string} phone - Raw phone number
 * @returns {string} - Normalized E.164 phone (+13055551234)
 * @throws {Error} - If phone cannot be normalized
 */
function normalizePhone(phone) {
  if (!phone) {
    throw new Error('Phone number is required');
  }
  
  // Already in E.164 format
  if (phone.startsWith('+') && /^\+[1-9]\d{9,14}$/.test(phone)) {
    return phone;
  }
  
  // Extract digits only
  const digits = phone.replace(/\D/g, '');
  
  // US number (10 digits)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // US number with country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // International number (assume it's complete)
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  
  throw new Error(`Cannot normalize phone number: ${phone}`);
}

/**
 * Generate Redis cache key
 * 
 * @param {string} companyId - Company ID
 * @param {string} phone - Normalized phone
 * @returns {string} - Cache key
 */
function getCacheKey(companyId, phone) {
  return `${CONFIG.CACHE_PREFIX}${companyId}:${phone}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class CustomerLookup {
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * MAIN ENTRY POINT: Get or Create Customer
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * This is THE method called at the start of every incoming call.
   * It's race-proof - 100 concurrent calls will only create 1 customer.
   * 
   * @param {string} companyId - Company ID
   * @param {string} phone - Caller phone number (any format)
   * @returns {Promise<{customer: Object, isNew: boolean, fromCache: boolean}>}
   */
  static async getOrCreatePlaceholder(companyId, phone) {
    const startTime = Date.now();
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Validate inputs
    // ─────────────────────────────────────────────────────────────────────────
    if (!companyId) {
      throw new Error('[CUSTOMER_LOOKUP] companyId is required');
    }
    
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhone(phone);
    } catch (err) {
      logger.error('[CUSTOMER_LOOKUP] Phone normalization failed', {
        phone,
        error: err.message
      });
      throw err;
    }
    
    const cacheKey = getCacheKey(companyId, normalizedPhone);
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Check Redis cache
    // ─────────────────────────────────────────────────────────────────────────
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        
        if (cached) {
          const customer = JSON.parse(cached);
          
          // Update lastContactAt in background (don't wait)
          this._updateLastContact(customer._id, companyId).catch(err => {
            logger.warn('[CUSTOMER_LOOKUP] Background lastContact update failed', { error: err.message });
          });
          
          logger.debug('[CUSTOMER_LOOKUP] Cache HIT', {
            companyId,
            phone: normalizedPhone,
            customerId: customer.customerId,
            duration: Date.now() - startTime
          });
          
          return {
            customer,
            isNew: false,
            fromCache: true,
            lookupTime: Date.now() - startTime
          };
        }
      } catch (err) {
        // Redis error - continue to MongoDB
        logger.warn('[CUSTOMER_LOOKUP] Redis error, falling back to MongoDB', {
          error: err.message
        });
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Atomic upsert in MongoDB (race-proof)
    // ─────────────────────────────────────────────────────────────────────────
    const { customer, isNew } = await Customer.getOrCreatePlaceholder(companyId, normalizedPhone);
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Cache the result
    // ─────────────────────────────────────────────────────────────────────────
    if (redisClient) {
      try {
        await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(customer));
      } catch (err) {
        // Cache write failed - log but don't throw
        logger.warn('[CUSTOMER_LOOKUP] Failed to cache customer', { error: err.message });
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Log event if new customer
    // ─────────────────────────────────────────────────────────────────────────
    if (isNew) {
      try {
        await CustomerEvent.logEvent({
          companyId,
          customerId: customer._id,
          type: CustomerEvent.EVENT_TYPES.CUSTOMER_CREATED,
          data: {
            phone: normalizedPhone,
            source: 'phone_call',
            status: 'placeholder'
          },
          createdBy: 'system'
        });
      } catch (err) {
        // Event logging failed - log but don't throw
        logger.warn('[CUSTOMER_LOOKUP] Failed to log customer_created event', { error: err.message });
      }
    }
    
    logger.info('[CUSTOMER_LOOKUP] Lookup complete', {
      companyId,
      phone: normalizedPhone,
      customerId: customer.customerId,
      isNew,
      fromCache: false,
      duration: Date.now() - startTime
    });
    
    return {
      customer,
      isNew,
      fromCache: false,
      lookupTime: Date.now() - startTime
    };
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * LOOKUP ONLY (No Create)
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Find a customer by phone without creating if not found.
   * Used for search, admin lookups, etc.
   * 
   * @param {string} companyId - Company ID
   * @param {string} phone - Phone number
   * @returns {Promise<{found: boolean, customer: Object|null}>}
   */
  static async lookupByPhone(companyId, phone) {
    if (!companyId || !phone) {
      return { found: false, customer: null };
    }
    
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhone(phone);
    } catch (err) {
      return { found: false, customer: null };
    }
    
    const cacheKey = getCacheKey(companyId, normalizedPhone);
    
    // Check cache first
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return { found: true, customer: JSON.parse(cached) };
        }
      } catch (err) {
        // Continue to MongoDB
      }
    }
    
    // Query MongoDB
    const customer = await Customer.findByPhone(companyId, normalizedPhone);
    
    if (customer) {
      // Cache for future lookups
      if (redisClient) {
        try {
          await redisClient.setEx(cacheKey, CONFIG.CACHE_TTL, JSON.stringify(customer));
        } catch (err) {
          // Ignore cache errors
        }
      }
      return { found: true, customer };
    }
    
    return { found: false, customer: null };
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET AI CONTEXT
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get customer context formatted for LLM-0 / Frontline-Intel.
   * This is what the AI uses to personalize the conversation.
   * 
   * @param {string} companyId - Company ID
   * @param {string} phone - Phone number
   * @returns {Promise<Object>} - AI-ready context object
   */
  static async getAIContext(companyId, phone) {
    const { customer, isNew } = await this.getOrCreatePlaceholder(companyId, phone);
    
    // Build context for AI
    const context = {
      // Identity
      customerId: customer.customerId,
      isReturning: !isNew && customer.status !== 'placeholder',
      isPlaceholder: customer.status === 'placeholder',
      
      // Personal info (if known)
      name: customer.fullName || null,
      firstName: customer.firstName || null,
      
      // History
      totalCalls: customer.totalCalls,
      lastContactAt: customer.lastContactAt,
      daysSinceLastContact: customer.lastContactAt 
        ? Math.floor((Date.now() - new Date(customer.lastContactAt).getTime()) / (1000 * 60 * 60 * 24))
        : null,
      
      // Status
      status: customer.status,
      customerType: customer.customerType,
      lifetimeValue: customer.lifetimeValue,
      
      // Preferences
      preferences: customer.preferences || {},
      
      // Address context (for technician dispatching)
      hasAddress: !!customer.primaryAddress?.street,
      city: customer.primaryAddress?.city || null,
      state: customer.primaryAddress?.state || null,
      
      // Access notes (critical for appointments)
      accessNotes: customer.primaryAddress?.accessNotes || null,
      keyLocation: customer.primaryAddress?.keyLocation || null,
      gateCode: customer.primaryAddress?.gateCode || null,
      alternateContact: customer.primaryAddress?.alternateContact || null,
      
      // Tags for routing
      tags: customer.tags || []
    };
    
    // Add greeting suggestion
    if (context.isReturning && context.name) {
      context.suggestedGreeting = `Hi ${context.firstName || context.name}! Welcome back.`;
    } else if (context.isReturning) {
      context.suggestedGreeting = 'Welcome back!';
    } else {
      context.suggestedGreeting = null;  // Use default company greeting
    }
    
    return context;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ENRICH CUSTOMER
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Update a placeholder customer with captured information.
   * Called during/after a call when we learn more about the customer.
   * 
   * @param {string} customerId - Customer document ID
   * @param {Object} data - Data to update
   * @returns {Promise<Customer>}
   */
  static async enrichCustomer(customerId, data) {
    const {
      fullName,
      firstName,
      lastName,
      email,
      status,
      primaryAddress,
      preferences,
      tags,
      companyId  // Required for cache invalidation
    } = data;
    
    const updateData = {};
    
    if (fullName) updateData.fullName = fullName;
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (email) updateData.email = email;
    if (status) updateData.status = status;
    if (primaryAddress) updateData.primaryAddress = primaryAddress;
    if (preferences) updateData.preferences = preferences;
    if (tags) updateData.tags = tags;
    
    // Update status from placeholder to lead if we have a name
    if ((fullName || firstName) && !status) {
      updateData.status = 'lead';
    }
    
    const customer = await Customer.findByIdAndUpdate(
      customerId,
      { $set: updateData },
      { new: true }
    );
    
    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }
    
    // Invalidate cache
    if (redisClient && companyId) {
      const cacheKey = getCacheKey(companyId, customer.phone);
      try {
        await redisClient.del(cacheKey);
      } catch (err) {
        // Ignore cache errors
      }
    }
    
    // Log event
    try {
      await CustomerEvent.logEvent({
        companyId: customer.companyId,
        customerId: customer._id,
        type: CustomerEvent.EVENT_TYPES.CUSTOMER_UPDATED,
        data: {
          updatedFields: Object.keys(updateData),
          newStatus: customer.status
        },
        createdBy: 'system'
      });
    } catch (err) {
      logger.warn('[CUSTOMER_LOOKUP] Failed to log customer_updated event', { error: err.message });
    }
    
    logger.info('[CUSTOMER_LOOKUP] Customer enriched', {
      customerId: customer.customerId,
      updatedFields: Object.keys(updateData)
    });
    
    return customer;
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * INVALIDATE CACHE
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Force cache invalidation for a customer.
   * Call this after manual updates to ensure fresh data.
   * 
   * @param {string} companyId - Company ID
   * @param {string} phone - Phone number
   */
  static async invalidateCache(companyId, phone) {
    if (!redisClient) return;
    
    try {
      const normalizedPhone = normalizePhone(phone);
      const cacheKey = getCacheKey(companyId, normalizedPhone);
      await redisClient.del(cacheKey);
      
      logger.debug('[CUSTOMER_LOOKUP] Cache invalidated', { companyId, phone: normalizedPhone });
    } catch (err) {
      logger.warn('[CUSTOMER_LOOKUP] Cache invalidation failed', { error: err.message });
    }
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * SEARCH CUSTOMERS
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Search customers by various criteria.
   * Used for admin search functionality.
   * 
   * @param {string} companyId - Company ID
   * @param {Object} criteria - Search criteria
   * @param {Object} options - Pagination options
   * @returns {Promise<{customers: Customer[], total: number}>}
   */
  static async searchCustomers(companyId, criteria = {}, options = {}) {
    const {
      query,       // Text search (name, email, phone)
      status,      // Filter by status
      tags,        // Filter by tags
      hasPhone,    // Has secondary phone
      minCalls,    // Minimum total calls
      maxCalls,    // Maximum total calls
      since,       // Last contact since
      until        // Last contact until
    } = criteria;
    
    const {
      page = 1,
      limit = 50,
      sort = { lastContactAt: -1 }
    } = options;
    
    const mongoQuery = { companyId };
    
    // Text search
    if (query) {
      // Check if it looks like a phone number
      if (/^[\d\s\-\(\)\+]+$/.test(query) && query.replace(/\D/g, '').length >= 7) {
        try {
          const normalizedPhone = normalizePhone(query);
          mongoQuery.$or = [
            { phone: normalizedPhone },
            { secondaryPhones: normalizedPhone }
          ];
        } catch (err) {
          // Not a valid phone, search as text
          mongoQuery.$text = { $search: query };
        }
      } else {
        // Search in name and email
        mongoQuery.$or = [
          { fullName: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } },
          { firstName: { $regex: query, $options: 'i' } },
          { lastName: { $regex: query, $options: 'i' } }
        ];
      }
    }
    
    // Status filter
    if (status) {
      mongoQuery.status = status;
    }
    
    // Tags filter
    if (tags && tags.length > 0) {
      mongoQuery.tags = { $all: tags };
    }
    
    // Call count filters
    if (minCalls !== undefined) {
      mongoQuery.totalCalls = { ...mongoQuery.totalCalls, $gte: minCalls };
    }
    if (maxCalls !== undefined) {
      mongoQuery.totalCalls = { ...mongoQuery.totalCalls, $lte: maxCalls };
    }
    
    // Date filters
    if (since || until) {
      mongoQuery.lastContactAt = {};
      if (since) mongoQuery.lastContactAt.$gte = new Date(since);
      if (until) mongoQuery.lastContactAt.$lte = new Date(until);
    }
    
    const skip = (page - 1) * Math.min(limit, 100);
    const actualLimit = Math.min(limit, 100);
    
    const [customers, total] = await Promise.all([
      Customer.find(mongoQuery)
        .sort(sort)
        .skip(skip)
        .limit(actualLimit)
        .lean(),
      Customer.countDocuments(mongoQuery)
    ]);
    
    return {
      customers,
      total,
      page,
      limit: actualLimit,
      pages: Math.ceil(total / actualLimit)
    };
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * GET CUSTOMER WITH HISTORY
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Get full customer profile with recent history.
   * Used for customer detail view.
   * 
   * @param {string} companyId - Company ID
   * @param {string} customerId - Customer ID (ObjectId or customerId string)
   * @returns {Promise<Object>}
   */
  static async getCustomerWithHistory(companyId, customerId) {
    // Find customer
    let customer;
    if (customerId.match(/^[0-9a-fA-F]{24}$/)) {
      // ObjectId
      customer = await Customer.findOne({ _id: customerId, companyId }).lean();
    } else {
      // customerId string (CUST-xxx)
      customer = await Customer.findOne({ customerId, companyId }).lean();
    }
    
    if (!customer) {
      return null;
    }
    
    // Get recent history from events
    const [recentCalls, recentAppointments, notes, addresses, equipment] = await Promise.all([
      CustomerEvent.getCallHistory(companyId, customer._id, 10),
      CustomerEvent.getAppointmentHistory(companyId, customer._id, 10),
      CustomerEvent.getNotes(companyId, customer._id),
      CustomerEvent.getAddresses(companyId, customer._id),
      CustomerEvent.getEquipment(companyId, customer._id)
    ]);
    
    return {
      ...customer,
      history: {
        recentCalls,
        recentAppointments
      },
      notes,
      addresses: [
        // Primary address first
        customer.primaryAddress ? { ...customer.primaryAddress, isPrimary: true, type: 'primary' } : null,
        ...addresses
      ].filter(Boolean),
      equipment
    };
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * PRIVATE: Update last contact (background)
   * ═══════════════════════════════════════════════════════════════════════════
   */
  static async _updateLastContact(customerId, companyId) {
    await Customer.findByIdAndUpdate(customerId, {
      $set: { lastContactAt: new Date() },
      $inc: { totalCalls: 1 }
    });
    
    // Invalidate cache
    const customer = await Customer.findById(customerId).select('phone').lean();
    if (customer && redisClient) {
      const cacheKey = getCacheKey(companyId, customer.phone);
      await redisClient.del(cacheKey);
    }
  }
  
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * HEALTH CHECK
   * ═══════════════════════════════════════════════════════════════════════════
   * 
   * Check if the service is healthy.
   * Used by health monitoring.
   * 
   * @returns {Promise<Object>}
   */
  static async healthCheck() {
    const health = {
      status: 'HEALTHY',
      mongodb: 'UNKNOWN',
      redis: 'UNKNOWN',
      responseTime: null
    };
    
    const startTime = Date.now();
    
    // Check MongoDB
    try {
      await Customer.findOne().select('_id').lean().maxTimeMS(5000);
      health.mongodb = 'HEALTHY';
    } catch (err) {
      health.mongodb = 'DOWN';
      health.status = 'DEGRADED';
    }
    
    // Check Redis
    if (redisClient) {
      try {
        await redisClient.ping();
        health.redis = 'HEALTHY';
      } catch (err) {
        health.redis = 'DOWN';
        health.status = 'DEGRADED';
      }
    } else {
      health.redis = 'NOT_CONFIGURED';
    }
    
    health.responseTime = Date.now() - startTime;
    
    return health;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORT
// ═══════════════════════════════════════════════════════════════════════════

module.exports = CustomerLookup;
module.exports.normalizePhone = normalizePhone;


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHONE TYPE DETECTOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Detect if a phone number is mobile, landline, or VoIP.
 * Used to determine if we can send SMS to the caller.
 * 
 * Uses Twilio Lookup API for accurate detection, with fallback to heuristics.
 * Results are cached in Redis for 30 days to minimize API costs.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// Redis client (optional - graceful fallback if not available)
let redisClient = null;
try {
  redisClient = require('../config/redis');
} catch (err) {
  logger.warn('[PHONE_TYPE_DETECTOR] Redis not available, caching disabled');
}

// Twilio client (optional - graceful fallback if not configured)
let twilioClient = null;
try {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (accountSid && authToken) {
    twilioClient = require('twilio')(accountSid, authToken);
  }
} catch (err) {
  logger.warn('[PHONE_TYPE_DETECTOR] Twilio client not available');
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Redis cache settings
  cachePrefix: 'phone_type:',
  cacheTTL: 60 * 60 * 24 * 30, // 30 days in seconds
  
  // Twilio Lookup API timeout
  lookupTimeout: 5000, // 5 seconds
  
  // Cost threshold - don't lookup if we've done too many today
  dailyLookupLimit: 1000,
  dailyCounterKey: 'phone_type_lookups_today'
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect phone type for a given phone number
 * 
 * @param {string} phone - Phone number (E.164 format preferred)
 * @param {Object} [options] - Options
 * @param {boolean} [options.skipCache=false] - Skip cache lookup
 * @param {boolean} [options.skipApi=false] - Skip Twilio API (use heuristics only)
 * @returns {Promise<Object>} - { phoneType, canSms, carrier, source }
 */
async function detectPhoneType(phone, options = {}) {
  const { skipCache = false, skipApi = false } = options;
  
  if (!phone) {
    return createResult('unknown', false, null, 'invalid_input');
  }
  
  // Normalize phone to E.164
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return createResult('unknown', false, null, 'invalid_format');
  }
  
  logger.debug('[PHONE_TYPE_DETECTOR] Detecting type', { phone: normalizedPhone });
  
  // 1. Check cache first
  if (!skipCache) {
    const cached = await getFromCache(normalizedPhone);
    if (cached) {
      logger.debug('[PHONE_TYPE_DETECTOR] Cache hit', { phone: normalizedPhone, cached });
      return cached;
    }
  }
  
  // 2. Try Twilio Lookup API
  if (!skipApi && twilioClient) {
    try {
      const lookupResult = await lookupViaTwilio(normalizedPhone);
      if (lookupResult) {
        // Cache the result
        await saveToCache(normalizedPhone, lookupResult);
        return lookupResult;
      }
    } catch (err) {
      logger.warn('[PHONE_TYPE_DETECTOR] Twilio lookup failed, using heuristics', {
        phone: normalizedPhone,
        error: err.message
      });
    }
  }
  
  // 3. Fallback to heuristics
  const heuristicResult = detectViaHeuristics(normalizedPhone);
  
  // Cache heuristic result (with shorter TTL)
  await saveToCache(normalizedPhone, heuristicResult, CONFIG.cacheTTL / 2);
  
  return heuristicResult;
}

/**
 * Batch detect phone types for multiple numbers
 * 
 * @param {string[]} phones - Array of phone numbers
 * @returns {Promise<Map>} - Map of phone → result
 */
async function detectPhoneTypes(phones) {
  const results = new Map();
  
  // Process in parallel with concurrency limit
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < phones.length; i += BATCH_SIZE) {
    const batch = phones.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(phone => detectPhoneType(phone).then(r => [phone, r]))
    );
    
    for (const [phone, result] of batchResults) {
      results.set(phone, result);
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// TWILIO LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Look up phone type via Twilio Lookup API
 * 
 * @param {string} phone - E.164 phone number
 * @returns {Promise<Object|null>} - Result or null if lookup failed
 */
async function lookupViaTwilio(phone) {
  if (!twilioClient) {
    return null;
  }
  
  // Check daily limit
  const dailyCount = await getDailyLookupCount();
  if (dailyCount >= CONFIG.dailyLookupLimit) {
    logger.warn('[PHONE_TYPE_DETECTOR] Daily lookup limit reached', { 
      count: dailyCount, 
      limit: CONFIG.dailyLookupLimit 
    });
    return null;
  }
  
  try {
    // Increment counter
    await incrementDailyLookupCount();
    
    // Call Twilio Lookup API with carrier info
    const lookup = await Promise.race([
      twilioClient.lookups.v2.phoneNumbers(phone).fetch({ fields: 'line_type_intelligence' }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Lookup timeout')), CONFIG.lookupTimeout)
      )
    ]);
    
    // Parse the response
    const lineTypeIntelligence = lookup.lineTypeIntelligence || {};
    const type = lineTypeIntelligence.type || 'unknown';
    const carrier = lineTypeIntelligence.carrier_name || null;
    
    // Map Twilio types to our types
    const typeMap = {
      'mobile': 'mobile',
      'landline': 'landline',
      'fixedVoip': 'voip',
      'nonFixedVoip': 'voip',
      'voip': 'voip',
      'tollFree': 'landline',
      'premium': 'landline',
      'sharedCost': 'landline',
      'personalNumber': 'mobile',
      'pager': 'landline',
      'unknown': 'unknown'
    };
    
    const phoneType = typeMap[type] || 'unknown';
    const canSms = phoneType === 'mobile' || phoneType === 'voip';
    
    logger.info('[PHONE_TYPE_DETECTOR] Twilio lookup success', {
      phone,
      type: phoneType,
      canSms,
      carrier,
      rawType: type
    });
    
    return createResult(phoneType, canSms, carrier, 'twilio_lookup');
    
  } catch (err) {
    // Decrement counter on failure (don't count failed lookups)
    await decrementDailyLookupCount();
    
    logger.error('[PHONE_TYPE_DETECTOR] Twilio lookup error', {
      phone,
      error: err.message,
      code: err.code
    });
    
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HEURISTICS (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect phone type using heuristics (when API is unavailable)
 * 
 * This is less accurate but free. Based on known patterns:
 * - Toll-free numbers (800, 888, 877, 866, 855, 844, 833) → landline
 * - Some area codes are known to be primarily mobile or landline
 * 
 * @param {string} phone - E.164 phone number
 * @returns {Object} - Result with lower confidence
 */
function detectViaHeuristics(phone) {
  // Extract area code (first 3 digits after +1)
  const match = phone.match(/^\+1(\d{3})/);
  if (!match) {
    return createResult('unknown', false, null, 'heuristics');
  }
  
  const areaCode = match[1];
  
  // Toll-free numbers
  const tollFreeAreaCodes = ['800', '888', '877', '866', '855', '844', '833'];
  if (tollFreeAreaCodes.includes(areaCode)) {
    return createResult('landline', false, 'Toll-Free', 'heuristics');
  }
  
  // Premium numbers
  if (areaCode === '900') {
    return createResult('landline', false, 'Premium', 'heuristics');
  }
  
  // For other numbers, we can't determine reliably
  // Default to 'unknown' but allow SMS (many unknown numbers are mobile)
  return createResult('unknown', true, null, 'heuristics');
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get cached result
 */
async function getFromCache(phone) {
  if (!redisClient) return null;
  
  try {
    const key = CONFIG.cachePrefix + phone;
    const cached = await redisClient.get(key);
    
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn('[PHONE_TYPE_DETECTOR] Cache read error', { error: err.message });
  }
  
  return null;
}

/**
 * Save result to cache
 */
async function saveToCache(phone, result, ttl = CONFIG.cacheTTL) {
  if (!redisClient) return;
  
  try {
    const key = CONFIG.cachePrefix + phone;
    await redisClient.setEx(key, ttl, JSON.stringify(result));
  } catch (err) {
    logger.warn('[PHONE_TYPE_DETECTOR] Cache write error', { error: err.message });
  }
}

/**
 * Get daily lookup count
 */
async function getDailyLookupCount() {
  if (!redisClient) return 0;
  
  try {
    const count = await redisClient.get(CONFIG.dailyCounterKey);
    return parseInt(count || '0', 10);
  } catch (err) {
    return 0;
  }
}

/**
 * Increment daily lookup count
 */
async function incrementDailyLookupCount() {
  if (!redisClient) return;
  
  try {
    const key = CONFIG.dailyCounterKey;
    await redisClient.incr(key);
    
    // Set expiry to end of day (reset at midnight)
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const ttl = Math.floor((endOfDay - now) / 1000);
    
    await redisClient.expire(key, ttl);
  } catch (err) {
    logger.warn('[PHONE_TYPE_DETECTOR] Counter increment error', { error: err.message });
  }
}

/**
 * Decrement daily lookup count
 */
async function decrementDailyLookupCount() {
  if (!redisClient) return;
  
  try {
    await redisClient.decr(CONFIG.dailyCounterKey);
  } catch (err) {
    // Ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone) {
  if (!phone) return null;
  
  // Already E.164
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Extract digits
  const digits = phone.replace(/\D/g, '');
  
  // US number without country code
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // US number with country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // Invalid
  return null;
}

/**
 * Create a standardized result object
 */
function createResult(phoneType, canSms, carrier, source) {
  return {
    phoneType,
    canSms,
    carrier,
    source,
    detectedAt: new Date().toISOString()
  };
}

/**
 * Check if a phone can receive SMS
 * Quick method that checks cache first
 */
async function canReceiveSms(phone) {
  const result = await detectPhoneType(phone);
  return result.canSms;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  detectPhoneType,
  detectPhoneTypes,
  canReceiveSms,
  normalizePhone
};

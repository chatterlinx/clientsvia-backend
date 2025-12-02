/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PHONE TYPE DETECTOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2 - Customer Recognition
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Detect phone type (mobile, landline, voip) to:
 * - Know if we can send SMS
 * - Prioritize mobile for callbacks
 * - Identify shared landlines (offices, households)
 * 
 * METHODS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Twilio Lookup API (most accurate, paid)
 * 2. Pattern-based heuristics (fallback, free)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Cache TTL in seconds (phone types don't change often)
  CACHE_TTL: 60 * 60 * 24 * 30,  // 30 days
  
  // Use Twilio Lookup API if available
  USE_TWILIO_LOOKUP: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
  
  // Twilio Lookup costs ~$0.005 per lookup
  TWILIO_LOOKUP_COST: 0.005
};

// ═══════════════════════════════════════════════════════════════════════════
// PHONE TYPE ENUM
// ═══════════════════════════════════════════════════════════════════════════

const PHONE_TYPES = {
  MOBILE: 'mobile',
  LANDLINE: 'landline',
  VOIP: 'voip',
  UNKNOWN: 'unknown'
};

// ═══════════════════════════════════════════════════════════════════════════
// TWILIO LOOKUP (Most Accurate)
// ═══════════════════════════════════════════════════════════════════════════

let twilioClient = null;

function getTwilioClient() {
  if (!twilioClient && CONFIG.USE_TWILIO_LOOKUP) {
    try {
      const twilio = require('twilio');
      twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    } catch (err) {
      logger.warn('[PHONE_TYPE] Failed to initialize Twilio client', { error: err.message });
    }
  }
  return twilioClient;
}

/**
 * Lookup phone type using Twilio API
 * 
 * @param {string} phone - E.164 phone number
 * @returns {Promise<Object>} - Phone info
 */
async function twilioLookup(phone) {
  const client = getTwilioClient();
  if (!client) {
    return null;
  }
  
  try {
    const result = await client.lookups.v2
      .phoneNumbers(phone)
      .fetch({ fields: 'line_type_intelligence' });
    
    const lineType = result.lineTypeIntelligence?.type;
    
    return {
      phone,
      type: mapTwilioType(lineType),
      carrier: result.lineTypeIntelligence?.carrier_name || null,
      canSms: lineType === 'mobile' || lineType === 'voip',
      source: 'twilio',
      raw: result.lineTypeIntelligence
    };
  } catch (err) {
    logger.warn('[PHONE_TYPE] Twilio lookup failed', { phone, error: err.message });
    return null;
  }
}

function mapTwilioType(twilioType) {
  switch (twilioType) {
    case 'mobile':
      return PHONE_TYPES.MOBILE;
    case 'landline':
    case 'fixedVoip':
      return PHONE_TYPES.LANDLINE;
    case 'nonFixedVoip':
    case 'voip':
      return PHONE_TYPES.VOIP;
    default:
      return PHONE_TYPES.UNKNOWN;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN-BASED HEURISTICS (Fallback)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * US Area codes that are PREDOMINANTLY mobile
 * Note: This is heuristic only - not definitive
 * 
 * Mobile-heavy area codes are newer ones assigned after cell phones became common
 */
const MOBILE_HEAVY_AREA_CODES = [
  // These area codes were assigned after 1995 and tend to have more mobile numbers
  '279', '341', '442', '458', '463', '564', '628', '657', '669', '737',
  '747', '762', '820', '826', '838', '854', '959', '984'
];

/**
 * VoIP provider prefixes (incomplete - just common ones)
 */
const VOIP_INDICATORS = [
  // Google Voice typically uses these exchanges in certain areas
  // Note: This is very unreliable
];

/**
 * Guess phone type based on patterns
 * This is NOT reliable - use only as fallback
 * 
 * @param {string} phone - E.164 phone number
 * @returns {Object} - Best guess info
 */
function guessPhoneType(phone) {
  if (!phone) {
    return {
      phone,
      type: PHONE_TYPES.UNKNOWN,
      carrier: null,
      canSms: null,  // Unknown
      source: 'guess',
      confidence: 0
    };
  }
  
  // Extract area code (assumes US +1 format)
  const digits = phone.replace(/\D/g, '');
  let areaCode = null;
  
  if (digits.length === 11 && digits.startsWith('1')) {
    areaCode = digits.substring(1, 4);
  } else if (digits.length === 10) {
    areaCode = digits.substring(0, 3);
  }
  
  // Check if it's a mobile-heavy area code
  if (areaCode && MOBILE_HEAVY_AREA_CODES.includes(areaCode)) {
    return {
      phone,
      type: PHONE_TYPES.MOBILE,
      carrier: null,
      canSms: true,  // Likely
      source: 'heuristic',
      confidence: 0.6,
      note: 'Mobile-heavy area code'
    };
  }
  
  // Default: Unknown (could be either)
  return {
    phone,
    type: PHONE_TYPES.UNKNOWN,
    carrier: null,
    canSms: null,  // Unknown - assume yes for safety
    source: 'heuristic',
    confidence: 0.3,
    note: 'Could not determine type'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect phone type
 * Uses Twilio if available, falls back to heuristics
 * 
 * @param {string} phone - Phone number (any format)
 * @param {Object} options - Detection options
 * @returns {Promise<Object>} - Phone type info
 */
async function detectPhoneType(phone, options = {}) {
  const {
    useTwilio = CONFIG.USE_TWILIO_LOOKUP,
    skipCache = false
  } = options;
  
  if (!phone) {
    return {
      phone: null,
      type: PHONE_TYPES.UNKNOWN,
      error: 'No phone provided'
    };
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
  
  // Try Twilio lookup first
  if (useTwilio) {
    const twilioResult = await twilioLookup(normalizedPhone);
    if (twilioResult) {
      logger.debug('[PHONE_TYPE] Twilio lookup success', {
        phone: normalizedPhone,
        type: twilioResult.type
      });
      return twilioResult;
    }
  }
  
  // Fall back to heuristics
  const guess = guessPhoneType(normalizedPhone);
  logger.debug('[PHONE_TYPE] Using heuristic guess', {
    phone: normalizedPhone,
    type: guess.type,
    confidence: guess.confidence
  });
  
  return guess;
}

/**
 * Check if phone can receive SMS
 * 
 * @param {string} phone - Phone number
 * @returns {Promise<boolean|null>} - true/false/null (unknown)
 */
async function canReceiveSms(phone) {
  const info = await detectPhoneType(phone);
  
  if (info.canSms !== null && info.canSms !== undefined) {
    return info.canSms;
  }
  
  // If unknown, assume yes for mobile/voip, no for landline
  return info.type !== PHONE_TYPES.LANDLINE;
}

/**
 * Batch detect phone types
 * More efficient for multiple lookups
 * 
 * @param {string[]} phones - Array of phone numbers
 * @returns {Promise<Map<string, Object>>} - Map of phone → info
 */
async function detectPhoneTypes(phones) {
  const results = new Map();
  
  // Process in parallel with concurrency limit
  const BATCH_SIZE = 10;
  for (let i = 0; i < phones.length; i += BATCH_SIZE) {
    const batch = phones.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(phone => detectPhoneType(phone))
    );
    
    batchResults.forEach((result, idx) => {
      results.set(batch[idx], result);
    });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  detectPhoneType,
  canReceiveSms,
  detectPhoneTypes,
  guessPhoneType,
  PHONE_TYPES,
  CONFIG
};


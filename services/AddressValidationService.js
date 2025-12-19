/**
 * AddressValidationService.js
 * ═══════════════════════════════════════════════════════════════════════════════
 * V35: Google Maps Address Validation Service
 * 
 * PURPOSE: Silent background validation - does NOT drive conversation
 * - Validates addresses using Google Geocoding API
 * - Normalizes to standard format
 * - Returns confidence score for conditional confirmation
 * - Detects multi-unit buildings for unit number prompts
 * 
 * CRITICAL RULE: Google Maps is a VALIDATOR, not a CONVERSATION DRIVER
 * - Never block the conversation waiting for validation
 * - Never ask city/ZIP if already provided
 * - Only confirm when confidence is low or unit is needed
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEOCODING_API_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Confidence thresholds
const CONFIDENCE = {
    HIGH: 'HIGH',      // street_address + rooftop = perfect match
    MEDIUM: 'MEDIUM',  // route-level or missing unit
    LOW: 'LOW'         // approximate or failed
};

// Result types that indicate high confidence
const HIGH_CONFIDENCE_TYPES = ['street_address', 'premise'];
const MEDIUM_CONFIDENCE_TYPES = ['route', 'sublocality', 'locality'];

// Location types that indicate precision
const ROOFTOP_LOCATION = 'ROOFTOP';
const RANGE_INTERPOLATED = 'RANGE_INTERPOLATED';

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate an address using Google Geocoding API
 * 
 * @param {string} rawAddress - The raw address from user input
 * @param {Object} options - Validation options
 * @param {string} options.companyId - Company ID for logging
 * @param {boolean} options.enabled - Whether Google Maps validation is enabled
 * @returns {Object} Validation result with normalized address and confidence
 */
async function validateAddress(rawAddress, options = {}) {
    const { companyId = 'unknown', enabled = true } = options;
    
    const log = (msg, data = {}) => {
        logger.debug(`[ADDRESS VALIDATION] ${msg}`, { companyId, ...data });
    };
    
    // Return early if disabled or no API key
    if (!enabled) {
        log('⏭️ Validation disabled for this company');
        return createSkippedResult(rawAddress, 'disabled');
    }
    
    if (!GOOGLE_MAPS_API_KEY) {
        log('⚠️ Google Maps API key not configured');
        return createSkippedResult(rawAddress, 'no_api_key');
    }
    
    if (!rawAddress || rawAddress.trim().length < 5) {
        log('⚠️ Address too short for validation', { rawAddress });
        return createSkippedResult(rawAddress, 'too_short');
    }
    
    try {
        log('🔍 Validating address', { rawAddress });
        
        // Call Google Geocoding API
        const response = await callGeocodingAPI(rawAddress);
        
        if (!response || response.status !== 'OK' || !response.results?.length) {
            log('❌ Google Maps returned no results', { status: response?.status });
            return createFailedResult(rawAddress, response?.status || 'NO_RESULTS');
        }
        
        // Parse the best result
        const result = response.results[0];
        const parsed = parseGeocodingResult(result);
        
        log('✅ Address validated', {
            normalized: parsed.normalized,
            confidence: parsed.confidence,
            needsUnit: parsed.needsUnit
        });
        
        return {
            success: true,
            raw: rawAddress,
            normalized: parsed.normalized,
            validated: true,
            confidence: parsed.confidence,
            components: parsed.components,
            location: parsed.location,
            needsUnit: parsed.needsUnit,
            placeId: result.place_id,
            formattedAddress: result.formatted_address
        };
        
    } catch (error) {
        log('❌ Validation error', { error: error.message });
        return createFailedResult(rawAddress, 'API_ERROR', error.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE MAPS API CALL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Call Google Geocoding API
 * @param {string} address - Address to geocode
 * @returns {Object} API response
 */
async function callGeocodingAPI(address) {
    const url = new URL(GEOCODING_API_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
    
    // Prefer US addresses (can be made configurable per company)
    url.searchParams.set('region', 'us');
    
    const startTime = Date.now();
    
    const response = await fetch(url.toString());
    const data = await response.json();
    
    const latency = Date.now() - startTime;
    logger.debug('[ADDRESS VALIDATION] API call complete', { latency, status: data.status });
    
    return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse Google Geocoding result into our format
 * @param {Object} result - Google Geocoding result
 * @returns {Object} Parsed result with components and confidence
 */
function parseGeocodingResult(result) {
    const components = extractAddressComponents(result.address_components);
    const confidence = calculateConfidence(result);
    const needsUnit = detectNeedsUnit(result);
    
    // Build normalized address
    const normalized = buildNormalizedAddress(components);
    
    return {
        normalized,
        confidence,
        needsUnit,
        components,
        location: {
            lat: result.geometry?.location?.lat,
            lng: result.geometry?.location?.lng
        }
    };
}

/**
 * Extract address components from Google response
 * @param {Array} addressComponents - Google address_components array
 * @returns {Object} Parsed components
 */
function extractAddressComponents(addressComponents) {
    const components = {
        streetNumber: null,
        streetName: null,
        street: null,
        unit: null,
        city: null,
        county: null,
        state: null,
        stateShort: null,
        zip: null,
        country: null,
        countryShort: null
    };
    
    if (!addressComponents) return components;
    
    for (const component of addressComponents) {
        const types = component.types || [];
        const longName = component.long_name;
        const shortName = component.short_name;
        
        if (types.includes('street_number')) {
            components.streetNumber = longName;
        } else if (types.includes('route')) {
            components.streetName = longName;
        } else if (types.includes('subpremise')) {
            components.unit = longName;
        } else if (types.includes('locality')) {
            components.city = longName;
        } else if (types.includes('sublocality_level_1') && !components.city) {
            components.city = longName;
        } else if (types.includes('administrative_area_level_2')) {
            components.county = longName;
        } else if (types.includes('administrative_area_level_1')) {
            components.state = longName;
            components.stateShort = shortName;
        } else if (types.includes('postal_code')) {
            components.zip = longName;
        } else if (types.includes('country')) {
            components.country = longName;
            components.countryShort = shortName;
        }
    }
    
    // Build full street
    if (components.streetNumber && components.streetName) {
        components.street = `${components.streetNumber} ${components.streetName}`;
    } else if (components.streetName) {
        components.street = components.streetName;
    }
    
    return components;
}

/**
 * Calculate confidence level based on result types and location type
 * @param {Object} result - Google Geocoding result
 * @returns {string} Confidence level: HIGH, MEDIUM, or LOW
 */
function calculateConfidence(result) {
    const types = result.types || [];
    const locationType = result.geometry?.location_type;
    
    // Check for high confidence indicators
    const hasHighConfidenceType = types.some(t => HIGH_CONFIDENCE_TYPES.includes(t));
    const isRooftop = locationType === ROOFTOP_LOCATION;
    
    if (hasHighConfidenceType && isRooftop) {
        return CONFIDENCE.HIGH;
    }
    
    // Check for medium confidence
    const hasMediumConfidenceType = types.some(t => MEDIUM_CONFIDENCE_TYPES.includes(t));
    const isRangeInterpolated = locationType === RANGE_INTERPOLATED;
    
    if (hasHighConfidenceType || hasMediumConfidenceType || isRangeInterpolated) {
        return CONFIDENCE.MEDIUM;
    }
    
    return CONFIDENCE.LOW;
}

/**
 * Detect if address might need a unit number
 * @param {Object} result - Google Geocoding result
 * @returns {boolean} True if unit number might be needed
 */
function detectNeedsUnit(result) {
    const types = result.types || [];
    const components = result.address_components || [];
    
    // Check if it's a multi-unit building type
    const multiUnitTypes = ['premise', 'subpremise', 'establishment'];
    const isMultiUnit = types.some(t => multiUnitTypes.includes(t));
    
    // Check if unit already exists in components
    const hasUnit = components.some(c => c.types?.includes('subpremise'));
    
    // Needs unit if it's a multi-unit type but no unit provided
    // Also check for common multi-unit indicators in the address
    const formattedAddress = result.formatted_address?.toLowerCase() || '';
    const multiUnitIndicators = ['apartment', 'apt', 'suite', 'ste', 'unit', 'building', 'bldg', 'floor', 'fl'];
    const hasMultiUnitIndicator = multiUnitIndicators.some(ind => formattedAddress.includes(ind));
    
    return (isMultiUnit && !hasUnit) || hasMultiUnitIndicator;
}

/**
 * Build normalized address string from components
 * @param {Object} components - Parsed address components
 * @returns {string} Normalized address
 */
function buildNormalizedAddress(components) {
    const parts = [];
    
    if (components.street) {
        parts.push(components.street);
    }
    
    if (components.unit) {
        parts.push(`Unit ${components.unit}`);
    }
    
    if (components.city) {
        parts.push(components.city);
    }
    
    if (components.stateShort) {
        parts.push(components.stateShort);
    }
    
    if (components.zip) {
        parts.push(components.zip);
    }
    
    return parts.join(', ');
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a skipped result (when validation is disabled or not possible)
 */
function createSkippedResult(rawAddress, reason) {
    return {
        success: true,
        raw: rawAddress,
        normalized: rawAddress, // Use raw as normalized
        validated: false,
        skipped: true,
        skipReason: reason,
        confidence: CONFIDENCE.MEDIUM, // Assume medium if not validated
        components: null,
        location: null,
        needsUnit: false
    };
}

/**
 * Create a failed result (when API call fails)
 */
function createFailedResult(rawAddress, status, errorMessage = null) {
    return {
        success: false,
        raw: rawAddress,
        normalized: rawAddress, // Use raw as fallback
        validated: false,
        failed: true,
        failReason: status,
        errorMessage,
        confidence: CONFIDENCE.LOW,
        components: null,
        location: null,
        needsUnit: false
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determine if confirmation is needed based on validation result and config
 * @param {Object} validationResult - Result from validateAddress
 * @param {Object} config - Address slot configuration
 * @returns {Object} Confirmation decision with suggested phrase
 */
function shouldConfirmAddress(validationResult, config = {}) {
    const {
        googleMapsValidationMode = 'confirm_low_confidence',
        askUnitNumber = true
    } = config;
    
    // Mode: silent - never confirm
    if (googleMapsValidationMode === 'silent') {
        return {
            shouldConfirm: false,
            shouldAskUnit: false,
            reason: 'silent_mode'
        };
    }
    
    // Mode: always_confirm
    if (googleMapsValidationMode === 'always_confirm') {
        return {
            shouldConfirm: true,
            shouldAskUnit: askUnitNumber && validationResult.needsUnit,
            reason: 'always_confirm_mode',
            suggestedPhrase: buildConfirmationPhrase(validationResult, 'confirm')
        };
    }
    
    // Mode: confirm_low_confidence (default)
    const needsConfirm = validationResult.confidence !== CONFIDENCE.HIGH || 
                         validationResult.failed || 
                         !validationResult.validated;
    
    const needsUnit = askUnitNumber && validationResult.needsUnit && !validationResult.components?.unit;
    
    if (!needsConfirm && !needsUnit) {
        return {
            shouldConfirm: false,
            shouldAskUnit: false,
            reason: 'high_confidence'
        };
    }
    
    return {
        shouldConfirm: needsConfirm,
        shouldAskUnit: needsUnit,
        reason: needsConfirm ? `${validationResult.confidence.toLowerCase()}_confidence` : 'needs_unit',
        suggestedPhrase: buildConfirmationPhrase(validationResult, needsUnit ? 'unit' : 'confirm')
    };
}

/**
 * Build a human-like confirmation phrase
 * @param {Object} validationResult - Validation result
 * @param {string} type - 'confirm' or 'unit'
 * @returns {string} Confirmation phrase
 */
function buildConfirmationPhrase(validationResult, type) {
    const normalized = validationResult.normalized || validationResult.raw;
    const city = validationResult.components?.city;
    const street = validationResult.components?.street;
    
    if (type === 'unit') {
        if (street && city) {
            return `Got it — ${street} in ${city}. Is there an apartment or unit number?`;
        }
        return `Got that address. Is there an apartment or unit number?`;
    }
    
    // Confirm type
    if (validationResult.confidence === CONFIDENCE.HIGH) {
        if (street && city) {
            return `Perfect — I've got ${street} in ${city}.`;
        }
        return `Perfect — I've got ${normalized}.`;
    }
    
    if (validationResult.confidence === CONFIDENCE.MEDIUM) {
        if (street && city) {
            return `Just to confirm — is that ${street} in ${city}?`;
        }
        return `Just to confirm — is that ${normalized}?`;
    }
    
    // Low confidence
    return `I want to make sure we send the tech to the right place — can you confirm the address?`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    validateAddress,
    shouldConfirmAddress,
    buildConfirmationPhrase,
    CONFIDENCE
};


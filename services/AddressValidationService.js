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
            needsUnit: parsed.needsUnit,
            buildingType: parsed.unitDetection?.buildingType,
            buildingLabel: parsed.unitDetection?.buildingLabel
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
            unitDetection: parsed.unitDetection, // Full building type info
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
    const unitDetection = detectNeedsUnit(result);
    
    // Build normalized address
    const normalized = buildNormalizedAddress(components);
    
    return {
        normalized,
        confidence,
        needsUnit: unitDetection.needsUnit,
        unitDetection, // Full detection result with building type
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
 * Detect if address might need a unit number and identify building type
 * @param {Object} result - Google Geocoding result
 * @param {Object} options - Detection options
 * @returns {Object} Detection result with building type info
 */
function detectNeedsUnit(result, options = {}) {
    const types = result.types || [];
    const components = result.address_components || [];
    const formattedAddress = result.formatted_address?.toLowerCase() || '';
    
    // Check if unit already exists in components
    const hasUnit = components.some(c => c.types?.includes('subpremise'));
    
    // If unit already provided, don't ask again
    if (hasUnit) {
        return {
            needsUnit: false,
            reason: 'unit_already_provided',
            buildingType: null
        };
    }
    
    // Detect building type from Google Maps
    let buildingType = null;
    let needsUnit = false;
    let reason = 'no_signals';
    
    // Check Google Maps types for building classification
    if (types.includes('premise')) {
        // "premise" often indicates a named building/complex
        buildingType = 'building_complex';
        needsUnit = true;
        reason = 'google_premise_type';
    }
    
    // Check formatted address for specific building indicators
    const buildingPatterns = [
        { pattern: /\bapartment(s)?\b/i, type: 'apartment_building', label: 'an apartment building' },
        { pattern: /\bcondo(minium)?(s)?\b/i, type: 'condo_building', label: 'a condominium' },
        { pattern: /\btower(s)?\b/i, type: 'tower', label: 'a tower building' },
        { pattern: /\bplaza\b/i, type: 'plaza', label: 'a plaza' },
        { pattern: /\bcomplex\b/i, type: 'complex', label: 'a complex' },
        { pattern: /\bloft(s)?\b/i, type: 'lofts', label: 'a loft building' },
        { pattern: /\bresidence(s)?\b/i, type: 'residences', label: 'a residential building' },
        { pattern: /\bsuites?\b/i, type: 'office_suites', label: 'an office building' },
        { pattern: /\boffice\s*(building|park|center)?\b/i, type: 'office', label: 'an office building' },
        { pattern: /\bmedical\s*(center|building|plaza)?\b/i, type: 'medical', label: 'a medical building' },
        { pattern: /\bprofessional\s*(center|building)?\b/i, type: 'professional', label: 'a professional building' },
        { pattern: /\b(senior|assisted)\s*(living|care)\b/i, type: 'senior_living', label: 'a senior living facility' },
        { pattern: /\bstudent\s*(housing|living)\b/i, type: 'student_housing', label: 'student housing' },
        { pattern: /\bvillas?\b/i, type: 'villas', label: 'a villa complex' },
        { pattern: /\btownhome(s)?|townhouse(s)?\b/i, type: 'townhomes', label: 'a townhome community' },
        // Commercial/B2B building types
        { pattern: /\bwarehouse\b/i, type: 'warehouse', label: 'a warehouse' },
        { pattern: /\bindustrial\s*(park|center|building)?\b/i, type: 'industrial', label: 'an industrial facility' },
        { pattern: /\bbusiness\s*(park|center|complex)\b/i, type: 'business_park', label: 'a business park' },
        { pattern: /\bcorporate\s*(center|park|campus)\b/i, type: 'corporate', label: 'a corporate campus' },
        { pattern: /\bshopping\s*(center|plaza|mall)\b/i, type: 'shopping_center', label: 'a shopping center' },
        { pattern: /\bretail\s*(center|plaza|park)\b/i, type: 'retail', label: 'a retail center' },
        { pattern: /\bstrip\s*(mall|center|plaza)\b/i, type: 'strip_mall', label: 'a strip mall' },
        { pattern: /\bhotel\b/i, type: 'hotel', label: 'a hotel' },
        { pattern: /\bmotel\b/i, type: 'motel', label: 'a motel' },
        { pattern: /\bresort\b/i, type: 'resort', label: 'a resort' },
        { pattern: /\brestaurant\b/i, type: 'restaurant', label: 'a restaurant' },
        { pattern: /\bchurch|worship|temple|mosque|synagogue\b/i, type: 'religious', label: 'a place of worship' },
        { pattern: /\bschool|academy|university|college\b/i, type: 'educational', label: 'an educational facility' },
        { pattern: /\bhospital|clinic\b/i, type: 'healthcare', label: 'a healthcare facility' },
        { pattern: /\bbank\b/i, type: 'bank', label: 'a bank' },
        { pattern: /\bself\s*storage|storage\s*(facility|unit)\b/i, type: 'storage', label: 'a storage facility' },
        { pattern: /\bfactory|manufacturing\b/i, type: 'factory', label: 'a manufacturing facility' },
        { pattern: /\bdistribution\s*(center)?\b/i, type: 'distribution', label: 'a distribution center' },
        { pattern: /\bdata\s*center\b/i, type: 'data_center', label: 'a data center' }
    ];
    
    for (const { pattern, type, label } of buildingPatterns) {
        if (pattern.test(formattedAddress)) {
            buildingType = type;
            needsUnit = true;
            reason = 'google_address_pattern';
            return {
                needsUnit: true,
                reason,
                buildingType: type,
                buildingLabel: label,
                detectedFrom: 'google_maps'
            };
        }
    }
    
    // Check for generic multi-unit indicators
    const genericIndicators = ['apt', 'ste', 'unit', 'bldg', 'floor', 'fl', '#'];
    const hasGenericIndicator = genericIndicators.some(ind => formattedAddress.includes(ind));
    
    if (hasGenericIndicator) {
        return {
            needsUnit: true,
            reason: 'generic_indicator',
            buildingType: 'multi_unit',
            buildingLabel: 'a multi-unit building',
            detectedFrom: 'address_format'
        };
    }
    
    // Check if it's a premise type (named building)
    if (types.includes('premise')) {
        return {
            needsUnit: true,
            reason: 'google_premise_type',
            buildingType: 'named_building',
            buildingLabel: 'a building',
            detectedFrom: 'google_maps'
        };
    }
    
    return {
        needsUnit: false,
        reason: 'no_signals',
        buildingType: null
    };
}

/**
 * V35 WORLD-CLASS: Smart gate code detection
 * Detects if address is likely in a gated community and needs access instructions
 * 
 * @param {string} rawAddress - Original user input
 * @param {Object} googleResult - Google Maps validation result (optional)
 * @param {Object} config - Gate code configuration
 * @returns {Object} Detection result with reason
 */
function shouldAskForGateCode(rawAddress, googleResult, config = {}) {
    const {
        gateCodeMode = 'smart',
        gateTriggerWords = [],
        gateAlwaysAskZips = [],
        gateNeverAskZips = []
    } = config;
    
    // Mode: never - skip all detection
    if (gateCodeMode === 'never') {
        return { shouldAsk: false, reason: 'mode_never' };
    }
    
    // Mode: always - always ask
    if (gateCodeMode === 'always') {
        return { shouldAsk: true, reason: 'mode_always' };
    }
    
    // Mode: smart - use multiple signals
    const rawLower = (rawAddress || '').toLowerCase();
    const normalizedAddress = (googleResult?.normalized || rawAddress || '').toLowerCase();
    
    // Check if gate code already mentioned
    const gateCodePatterns = [
        /\bgate\s*(code|#)?\s*:?\s*[#*]?\d{3,6}\b/i,
        /\bcode\s*(is|:)?\s*[#*]?\d{3,6}\b/i,
        /\bcall\s*(the\s*)?(gate|guard|security)/i
    ];
    const hasGateCodeProvided = gateCodePatterns.some(p => p.test(rawLower));
    if (hasGateCodeProvided) {
        return { shouldAsk: false, reason: 'gate_code_already_provided' };
    }
    
    // Extract ZIP code for ZIP-based rules
    const zipMatch = rawLower.match(/\b(\d{5})(-\d{4})?\b/);
    const zipCode = zipMatch ? zipMatch[1] : null;
    
    // Check ZIP-based rules (highest priority)
    if (zipCode) {
        if (gateNeverAskZips.includes(zipCode)) {
            return { shouldAsk: false, reason: 'zip_never_ask', zip: zipCode };
        }
        if (gateAlwaysAskZips.includes(zipCode)) {
            return { shouldAsk: true, reason: 'zip_always_ask', zip: zipCode };
        }
    }
    
    // Default trigger words for gated communities
    const defaultGateTriggers = [
        // Explicit gate mentions
        'gated', 'gate', 'guard gate', 'guardhouse', 'security gate',
        // Common gated community naming patterns
        'country club', 'golf club', 'yacht club', 'beach club',
        'estates', 'preserve', 'sanctuary', 'reserve',
        'plantation', 'ranch', 'hacienda',
        'isle', 'isles', 'island', 'islands', 'key', 'keys', 'cay',
        'shores', 'harbor', 'harbour', 'bay', 'cove', 'pointe',
        'palms', 'pines', 'oaks', 'willows', 'cypress',
        'meadows', 'woods', 'forest', 'grove',
        'lakes', 'lake', 'pond', 'springs', 'creek', 'falls',
        'ridge', 'hills', 'highlands', 'bluffs', 'cliff',
        'crossing', 'commons', 'village', 'villas',
        'royal', 'imperial', 'colonial', 'heritage',
        // Florida-specific
        'pelican', 'heron', 'egret', 'ibis', 'flamingo',
        'coconut', 'palm beach', 'boca', 'bonita',
        // HOA indicators
        'hoa', 'homeowners', 'association'
    ];
    
    const allGateTriggers = [...new Set([...defaultGateTriggers, ...gateTriggerWords])];
    const foundTrigger = allGateTriggers.find(word => {
        const wordLower = word.toLowerCase();
        return rawLower.includes(wordLower) || normalizedAddress.includes(wordLower);
    });
    
    if (foundTrigger) {
        return { shouldAsk: true, reason: 'trigger_word', trigger: foundTrigger };
    }
    
    // Check Google Maps place types that suggest gated communities
    if (googleResult?.components) {
        const formattedAddress = (googleResult.formattedAddress || '').toLowerCase();
        // Check if formatted address contains gated indicators
        const gatedIndicators = ['gated', 'private', 'country club', 'golf'];
        if (gatedIndicators.some(ind => formattedAddress.includes(ind))) {
            return { shouldAsk: true, reason: 'google_maps_indicator' };
        }
    }
    
    // Default: don't ask (assume not gated)
    return { shouldAsk: false, reason: 'no_signals' };
}

/**
 * Build gate code prompt phrase
 * @param {string} companyName - Company name for personalization
 * @returns {string} Gate code prompt
 */
function buildGateCodePrompt(companyName = 'our technician') {
    const phrases = [
        `One more thing — is there a gate code, or should the tech call you to get buzzed in?`,
        `Is there a gate code for the community, or will ${companyName} need to call you at the gate?`,
        `Got it! Does ${companyName} need a gate code to access the property?`,
        `Perfect — is there a gate code, or should they call the guard?`
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
}

/**
 * V35 WORLD-CLASS: Equipment access detection and prompts
 * Determines if we should ask about equipment location/access
 * 
 * @param {Object} unitDetection - Building type detection result
 * @param {Object} config - Equipment access configuration
 * @returns {Object} Detection result with prompt
 */
function shouldAskEquipmentAccess(unitDetection, config = {}) {
    const {
        equipmentAccessMode = 'smart', // 'smart', 'always', 'never'
        equipmentType = 'HVAC',        // 'HVAC', 'electrical', 'plumbing', 'general'
        customEquipmentName = null,    // e.g., "condenser", "AC unit", "electrical panel"
        askForResidential = false,     // Usually not needed for houses
        askForCommercial = true        // Usually needed for commercial
    } = config;
    
    // Mode: never - skip
    if (equipmentAccessMode === 'never') {
        return { shouldAsk: false, reason: 'mode_never' };
    }
    
    const buildingType = unitDetection?.buildingType;
    const buildingLabel = unitDetection?.buildingLabel;
    
    // Determine if residential or commercial
    const residentialTypes = [
        'apartment_building', 'condo_building', 'townhomes', 'villas',
        'lofts', 'residences', 'senior_living', 'student_housing'
    ];
    const commercialTypes = [
        'office', 'office_suites', 'medical', 'professional', 'warehouse',
        'industrial', 'business_park', 'corporate', 'shopping_center',
        'retail', 'strip_mall', 'hotel', 'motel', 'resort', 'restaurant',
        'religious', 'educational', 'healthcare', 'bank', 'storage',
        'factory', 'distribution', 'data_center', 'tower', 'plaza', 'complex'
    ];
    
    const isResidential = residentialTypes.includes(buildingType);
    const isCommercial = commercialTypes.includes(buildingType);
    
    // Mode: always - always ask
    if (equipmentAccessMode === 'always') {
        return {
            shouldAsk: true,
            reason: 'mode_always',
            prompt: buildEquipmentAccessPrompt(equipmentType, customEquipmentName, buildingType)
        };
    }
    
    // Mode: smart - based on building type
    if (isCommercial && askForCommercial) {
        return {
            shouldAsk: true,
            reason: 'commercial_building',
            buildingType,
            prompt: buildEquipmentAccessPrompt(equipmentType, customEquipmentName, buildingType)
        };
    }
    
    if (isResidential && askForResidential) {
        return {
            shouldAsk: true,
            reason: 'residential_multi_unit',
            buildingType,
            prompt: buildEquipmentAccessPrompt(equipmentType, customEquipmentName, buildingType)
        };
    }
    
    // Special cases that always need access info
    const alwaysAskTypes = ['warehouse', 'industrial', 'factory', 'data_center', 'healthcare', 'hotel', 'resort'];
    if (alwaysAskTypes.includes(buildingType)) {
        return {
            shouldAsk: true,
            reason: 'high_access_complexity',
            buildingType,
            prompt: buildEquipmentAccessPrompt(equipmentType, customEquipmentName, buildingType)
        };
    }
    
    return { shouldAsk: false, reason: 'not_needed' };
}

/**
 * Build equipment access prompt based on equipment type and building
 * @param {string} equipmentType - Type of equipment (HVAC, electrical, plumbing)
 * @param {string} customName - Custom equipment name override
 * @param {string} buildingType - Detected building type
 * @returns {string} Natural language prompt
 */
function buildEquipmentAccessPrompt(equipmentType = 'HVAC', customName = null, buildingType = null) {
    // Equipment-specific terminology
    const equipmentTerms = {
        'HVAC': {
            name: customName || 'the AC unit or condenser',
            locations: ['rooftop', 'mechanical room', 'utility closet', 'outside'],
            accessTypes: ['roof access', 'a key to the mechanical room', 'building manager coordination']
        },
        'electrical': {
            name: customName || 'the electrical panel',
            locations: ['basement', 'utility room', 'garage', 'outside'],
            accessTypes: ['basement access', 'a key to the utility room']
        },
        'plumbing': {
            name: customName || 'the water heater or main shutoff',
            locations: ['basement', 'utility closet', 'garage', 'crawl space'],
            accessTypes: ['basement access', 'crawl space access']
        },
        'general': {
            name: customName || 'the equipment',
            locations: ['a specific location'],
            accessTypes: ['special access']
        }
    };
    
    const terms = equipmentTerms[equipmentType] || equipmentTerms['general'];
    
    // Building-specific prompts
    const buildingPrompts = {
        'warehouse': `For warehouse service — do you know where ${terms.name} is located? Will the tech need roof access or keys to any areas?`,
        'industrial': `Since this is an industrial facility — where is ${terms.name} located, and will our tech need any special access like roof keys or security clearance?`,
        'factory': `For factory service — is ${terms.name} on the roof, in a mechanical room, or another location? Any access requirements we should know about?`,
        'data_center': `Data centers often have specific access protocols — where is ${terms.name}, and does the tech need to coordinate with your facilities team?`,
        'hotel': `For hotel service — is ${terms.name} on the roof or in a mechanical room? Should the tech check in with engineering or the front desk?`,
        'resort': `For resort service — where is ${terms.name} located? Will our tech need to coordinate with your maintenance or engineering team?`,
        'healthcare': `Since this is a healthcare facility — where is ${terms.name}? Are there any access restrictions or coordination needed with facilities?`,
        'office': `Quick question — do you know where ${terms.name} is in the building? Is it rooftop, mechanical room, or somewhere the tech might need access to?`,
        'shopping_center': `For shopping center service — is ${terms.name} on the roof or behind the building? Will the tech need a key or to coordinate with property management?`,
        'condo_building': `One more thing — do you know where ${terms.name} is? Some condos have rooftop units that need building access.`,
        'apartment_building': `Quick question — is ${terms.name} in a utility closet, on the roof, or somewhere the tech might need building access?`
    };
    
    // Return building-specific prompt or generic one
    if (buildingPrompts[buildingType]) {
        return buildingPrompts[buildingType];
    }
    
    // Generic commercial prompt
    const genericPrompts = [
        `One more thing — do you know where ${terms.name} is located? Will our tech need roof access, keys, or to check in with anyone?`,
        `Quick question — is ${terms.name} somewhere that requires special access, like a rooftop or locked mechanical room?`,
        `Just to make sure our tech is prepared — where is ${terms.name}, and is there any special access needed?`
    ];
    
    return genericPrompts[Math.floor(Math.random() * genericPrompts.length)];
}

/**
 * V35 WORLD-CLASS: Advanced unit number detection
 * Checks multiple signals to determine if unit number should be asked
 * 
 * @param {string} rawAddress - Original user input
 * @param {Object} googleResult - Google Maps validation result (optional)
 * @param {Object} config - Address slot configuration
 * @returns {Object} Detection result with reason
 */
function shouldAskForUnit(rawAddress, googleResult, config = {}) {
    const {
        unitNumberMode = 'smart',
        unitTriggerWords = [],
        unitAlwaysAskZips = [],
        unitNeverAskZips = []
    } = config;
    
    // Mode: never - skip all detection
    if (unitNumberMode === 'never') {
        return { shouldAsk: false, reason: 'mode_never' };
    }
    
    // Mode: always - always ask
    if (unitNumberMode === 'always') {
        return { shouldAsk: true, reason: 'mode_always' };
    }
    
    // Mode: smart - use multiple signals
    const rawLower = (rawAddress || '').toLowerCase();
    const normalizedAddress = (googleResult?.normalized || rawAddress || '').toLowerCase();
    
    // Check if unit already provided in the address
    const unitPatterns = [
        /\b(apt|apartment|unit|suite|ste|bldg|building|fl|floor|#)\s*[a-z0-9\-]+\b/i,
        /\b[a-z]?\d{1,4}[a-z]?\b.*\b(floor|fl)\b/i
    ];
    const hasUnitInAddress = unitPatterns.some(p => p.test(rawLower));
    if (hasUnitInAddress) {
        return { shouldAsk: false, reason: 'unit_already_provided' };
    }
    
    // Extract ZIP code for ZIP-based rules
    const zipMatch = rawLower.match(/\b(\d{5})(-\d{4})?\b/);
    const zipCode = zipMatch ? zipMatch[1] : null;
    
    // Check ZIP-based rules (highest priority)
    if (zipCode) {
        if (unitNeverAskZips.includes(zipCode)) {
            return { shouldAsk: false, reason: 'zip_never_ask', zip: zipCode };
        }
        if (unitAlwaysAskZips.includes(zipCode)) {
            return { shouldAsk: true, reason: 'zip_always_ask', zip: zipCode };
        }
    }
    
    // Check Google Maps detection
    if (googleResult?.needsUnit) {
        return { shouldAsk: true, reason: 'google_maps_detected' };
    }
    
    // Check trigger words in address
    const defaultTriggerWords = [
        'apartment', 'apt', 'apartments',
        'condo', 'condominium', 'condos',
        'suite', 'ste',
        'tower', 'towers',
        'plaza', 'plz',
        'complex',
        'loft', 'lofts',
        'penthouse',
        'manor',
        'terrace',
        'village',
        'commons',
        'gardens',
        'heights',
        'pointe',
        'landing',
        'center', 'centre',
        'office',
        'professional',
        'medical',
        'business park'
    ];
    
    const allTriggerWords = [...new Set([...defaultTriggerWords, ...unitTriggerWords])];
    const foundTrigger = allTriggerWords.find(word => {
        const wordLower = word.toLowerCase();
        // Check both raw and normalized address
        return rawLower.includes(wordLower) || normalizedAddress.includes(wordLower);
    });
    
    if (foundTrigger) {
        return { shouldAsk: true, reason: 'trigger_word', trigger: foundTrigger };
    }
    
    // Check for common multi-unit street patterns
    const multiUnitPatterns = [
        /\b\d+\s+(n|s|e|w|north|south|east|west)?\s*(ocean|beach|bay|harbor|marina)\s+(dr|drive|blvd|boulevard|ave|avenue)\b/i, // Beach condos
        /\b\d+\s+(downtown|midtown|uptown)\b/i, // Urban areas
        /\bunit\s+\d+/i,
        /\b#\s*\d+/i
    ];
    
    const matchedPattern = multiUnitPatterns.find(p => p.test(rawLower) || p.test(normalizedAddress));
    if (matchedPattern) {
        return { shouldAsk: true, reason: 'pattern_match' };
    }
    
    // Default: don't ask (assume single-family)
    return { shouldAsk: false, reason: 'no_signals' };
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
 * @param {string} rawAddress - Original user input (for unit detection)
 * @param {string} companyName - Company name for gate code prompts
 * @returns {Object} Confirmation decision with suggested phrase
 */
function shouldConfirmAddress(validationResult, config = {}, rawAddress = '', companyName = 'our technician') {
    const {
        googleMapsValidationMode = 'confirm_low_confidence'
    } = config;
    
    // V35 WORLD-CLASS: Use advanced unit detection
    const unitDecision = shouldAskForUnit(rawAddress, validationResult, config);
    
    // V35 WORLD-CLASS: Use advanced gate code detection
    const gateDecision = shouldAskForGateCode(rawAddress, validationResult, config);
    
    // Mode: silent - never confirm
    if (googleMapsValidationMode === 'silent') {
        return {
            shouldConfirm: false,
            shouldAskUnit: false,
            shouldAskGateCode: false,
            reason: 'silent_mode',
            unitReason: unitDecision.reason,
            gateReason: gateDecision.reason
        };
    }
    
    // Mode: always_confirm
    if (googleMapsValidationMode === 'always_confirm') {
        return {
            shouldConfirm: true,
            shouldAskUnit: unitDecision.shouldAsk,
            shouldAskGateCode: gateDecision.shouldAsk,
            reason: 'always_confirm_mode',
            unitReason: unitDecision.reason,
            gateReason: gateDecision.reason,
            suggestedPhrase: buildConfirmationPhrase(validationResult, 'confirm'),
            gateCodePrompt: gateDecision.shouldAsk ? buildGateCodePrompt(companyName) : null
        };
    }
    
    // Mode: confirm_low_confidence (default)
    const needsConfirm = validationResult.confidence !== CONFIDENCE.HIGH || 
                         validationResult.failed || 
                         !validationResult.validated;
    
    if (!needsConfirm && !unitDecision.shouldAsk && !gateDecision.shouldAsk) {
        return {
            shouldConfirm: false,
            shouldAskUnit: false,
            shouldAskGateCode: false,
            reason: 'high_confidence',
            unitReason: unitDecision.reason,
            gateReason: gateDecision.reason
        };
    }
    
    return {
        shouldConfirm: needsConfirm,
        shouldAskUnit: unitDecision.shouldAsk,
        shouldAskGateCode: gateDecision.shouldAsk,
        reason: needsConfirm ? `${validationResult.confidence.toLowerCase()}_confidence` : (unitDecision.shouldAsk ? 'needs_unit' : 'needs_gate_code'),
        unitReason: unitDecision.reason,
        unitTrigger: unitDecision.trigger,
        gateReason: gateDecision.reason,
        gateTrigger: gateDecision.trigger,
        suggestedPhrase: buildConfirmationPhrase(validationResult, unitDecision.shouldAsk ? 'unit' : 'confirm'),
        gateCodePrompt: gateDecision.shouldAsk ? buildGateCodePrompt(companyName) : null
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
    const unitDetection = validationResult.unitDetection || {};
    const buildingLabel = unitDetection.buildingLabel;
    const detectedFrom = unitDetection.detectedFrom;
    
    if (type === 'unit') {
        // If Google Maps detected the building type, mention it!
        if (buildingLabel && detectedFrom === 'google_maps') {
            if (street && city) {
                return `Got it — ${street} in ${city}. Google Maps shows this is ${buildingLabel}. Is there an apartment or unit number I should include?`;
            }
            return `Got that address. It looks like this is ${buildingLabel}. Is there a unit or apartment number?`;
        }
        
        // Generic unit question
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
    shouldAskForUnit,
    shouldAskForGateCode,
    shouldAskEquipmentAccess,
    buildConfirmationPhrase,
    buildGateCodePrompt,
    buildEquipmentAccessPrompt,
    CONFIDENCE
};


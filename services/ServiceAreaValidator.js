// ============================================================================
// SERVICE AREA VALIDATOR - Check if address is within company's coverage
// ============================================================================
// V70: Validates caller addresses against company's service area config
// V71: Added Google Maps geocoding for city → coordinates → radius check
// Supports: ZIP codes, cities, counties, state, radius-based coverage
// ============================================================================

const logger = require('../utils/logger');
const axios = require('axios');

// Google Maps API key from environment
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Common city name variations for fuzzy matching
const CITY_ALIASES = {
    'ft myers': 'fort myers',
    'ft. myers': 'fort myers',
    'ft lauderdale': 'fort lauderdale',
    'ft. lauderdale': 'fort lauderdale',
    'st petersburg': 'saint petersburg',
    'st. petersburg': 'saint petersburg',
    'st pete': 'saint petersburg',
    'st. pete': 'saint petersburg',
    'la': 'los angeles',
    'nyc': 'new york',
    'philly': 'philadelphia',
    'vegas': 'las vegas',
    'dc': 'washington',
    'atl': 'atlanta',
    'chi': 'chicago',
    'miami beach': 'miami beach', // Keep as-is
    'south beach': 'miami beach',
    'sobe': 'miami beach'
};

/**
 * Normalize city name for comparison
 */
function normalizeCity(city) {
    if (!city) return '';
    const lower = city.toLowerCase().trim();
    return CITY_ALIASES[lower] || lower;
}

/**
 * Extract ZIP code from address string
 */
function extractZipCode(address) {
    if (!address) return null;
    // Match 5-digit ZIP or ZIP+4
    const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
    return match ? match[1] : null;
}

/**
 * Extract city from address (best effort)
 */
function extractCity(address) {
    if (!address) return null;
    // Try to find city before state abbreviation
    // Pattern: "city, STATE ZIP" or "city STATE ZIP"
    const match = address.match(/([A-Za-z\s]+?)(?:,?\s+)?(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
    return match ? match[1].trim() : null;
}

/**
 * Calculate distance between two lat/lng points (Haversine formula)
 * Returns distance in miles
 */
function calculateDistanceMiles(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * V71: Geocode a city/address to get lat/lng using Google Maps
 * This allows "Do you service Cape Coral?" to be checked against radius
 * 
 * @param {string} location - City name, ZIP code, or address
 * @param {string} state - Optional state to narrow results (e.g., 'FL')
 * @returns {Promise<{lat: number, lng: number, formattedAddress: string} | null>}
 */
async function geocodeLocation(location, state = null) {
    if (!location || !GOOGLE_MAPS_API_KEY) {
        logger.debug('[SERVICE AREA] Cannot geocode - missing location or API key', {
            hasLocation: !!location,
            hasApiKey: !!GOOGLE_MAPS_API_KEY
        });
        return null;
    }
    
    try {
        // Add state to query for better accuracy
        const query = state ? `${location}, ${state}` : location;
        
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: query,
                key: GOOGLE_MAPS_API_KEY
            },
            timeout: 3000 // 3 second timeout
        });
        
        if (response.data.status === 'OK' && response.data.results?.length > 0) {
            const result = response.data.results[0];
            const location = result.geometry?.location;
            
            if (location?.lat && location?.lng) {
                logger.debug('[SERVICE AREA] ✅ Geocoded location', {
                    query,
                    lat: location.lat,
                    lng: location.lng,
                    formattedAddress: result.formatted_address
                });
                
                return {
                    lat: location.lat,
                    lng: location.lng,
                    formattedAddress: result.formatted_address,
                    // Extract city from address components
                    city: result.address_components?.find(c => c.types.includes('locality'))?.long_name,
                    county: result.address_components?.find(c => c.types.includes('administrative_area_level_2'))?.long_name,
                    state: result.address_components?.find(c => c.types.includes('administrative_area_level_1'))?.short_name
                };
            }
        }
        
        logger.debug('[SERVICE AREA] ❌ Geocoding returned no results', {
            query,
            status: response.data.status
        });
        return null;
        
    } catch (error) {
        logger.warn('[SERVICE AREA] Geocoding failed', {
            location,
            error: error.message
        });
        return null;
    }
}

/**
 * V71: Smart service area check - geocodes city names to check against radius
 * Use this when caller asks "Do you service Cape Coral?" (city name only)
 * 
 * @param {string} cityOrLocation - City name, ZIP, or partial address
 * @param {Object} config - Company's serviceAreaConfig
 * @returns {Promise<Object>} Same format as validateServiceArea
 */
async function smartServiceAreaCheck(cityOrLocation, config) {
    if (!config?.enabled) {
        return {
            inServiceArea: true,
            confidence: 'high',
            reason: 'SERVICE_AREA_CHECK_DISABLED',
            details: { message: 'Service area validation is not enabled' }
        };
    }
    
    const normalizedInput = normalizeCity(cityOrLocation);
    
    // STEP 1: Quick check against city list (no API call needed)
    if (config.servicedCities?.length > 0) {
        const normalizedCities = config.servicedCities.map(c => normalizeCity(c));
        if (normalizedCities.includes(normalizedInput)) {
            return {
                inServiceArea: true,
                confidence: 'high',
                reason: 'CITY_IN_LIST',
                details: { city: cityOrLocation, matchedCity: cityOrLocation }
            };
        }
    }
    
    // STEP 2: Check if it's a ZIP code
    const zip = extractZipCode(cityOrLocation);
    if (zip) {
        if (config.servicedZipCodes?.includes(zip)) {
            return {
                inServiceArea: true,
                confidence: 'high',
                reason: 'ZIP_IN_LIST',
                details: { zipCode: zip }
            };
        }
        if (config.borderlineZipCodes?.includes(zip)) {
            return {
                inServiceArea: 'borderline',
                confidence: 'medium',
                reason: 'BORDERLINE_ZIP',
                details: { zipCode: zip }
            };
        }
        // ZIP not in list - definite no (unless we geocode and check radius)
    }
    
    // STEP 3: Geocode and check against radius (if radius is configured)
    if (config.radiusCoverage?.enabled && 
        config.radiusCoverage.centerLat && 
        config.radiusCoverage.centerLng) {
        
        const geocoded = await geocodeLocation(cityOrLocation, config.servicedState);
        
        if (geocoded?.lat && geocoded?.lng) {
            const distance = calculateDistanceMiles(
                config.radiusCoverage.centerLat,
                config.radiusCoverage.centerLng,
                geocoded.lat,
                geocoded.lng
            );
            
            const isWithinRadius = distance <= config.radiusCoverage.radiusMiles;
            
            logger.info('[SERVICE AREA] 🗺️ Geocode + radius check', {
                location: cityOrLocation,
                geocodedCity: geocoded.city,
                distance: Math.round(distance * 10) / 10,
                radiusMiles: config.radiusCoverage.radiusMiles,
                isWithinRadius
            });
            
            if (isWithinRadius) {
                return {
                    inServiceArea: true,
                    confidence: 'high',
                    reason: 'WITHIN_RADIUS',
                    details: {
                        city: geocoded.city || cityOrLocation,
                        distanceMiles: Math.round(distance * 10) / 10,
                        maxRadiusMiles: config.radiusCoverage.radiusMiles,
                        geocodedAddress: geocoded.formattedAddress
                    }
                };
            } else {
                return {
                    inServiceArea: false,
                    confidence: 'high',
                    reason: 'OUTSIDE_RADIUS',
                    details: {
                        city: geocoded.city || cityOrLocation,
                        distanceMiles: Math.round(distance * 10) / 10,
                        maxRadiusMiles: config.radiusCoverage.radiusMiles,
                        serviceAreaSummary: config.serviceAreaSummary
                    }
                };
            }
        }
    }
    
    // STEP 4: ZIP not in list and no radius to check
    if (zip && config.servicedZipCodes?.length > 0) {
        return {
            inServiceArea: false,
            confidence: 'high',
            reason: 'ZIP_NOT_IN_LIST',
            details: {
                zipCode: zip,
                serviceAreaSummary: config.serviceAreaSummary
            }
        };
    }
    
    // STEP 5: Couldn't determine - ask for more info
    return {
        inServiceArea: 'unknown',
        confidence: 'low',
        reason: 'COULD_NOT_VERIFY',
        details: {
            location: cityOrLocation,
            message: 'Could not verify service area - need ZIP code or more details'
        }
    };
}

/**
 * Validate if an address/location is within the company's service area
 * 
 * @param {Object} params
 * @param {string} params.address - Full address string
 * @param {string} params.city - City name (if known)
 * @param {string} params.zipCode - ZIP code (if known)
 * @param {string} params.county - County (if known)
 * @param {string} params.state - State (if known)
 * @param {number} params.lat - Latitude (if known, from Google Maps)
 * @param {number} params.lng - Longitude (if known, from Google Maps)
 * @param {Object} config - Company's serviceAreaConfig
 * @returns {Object} { inServiceArea: boolean, confidence: 'high'|'medium'|'low', reason: string, details: {} }
 */
function validateServiceArea({ address, city, zipCode, county, state, lat, lng }, config) {
    // If service area validation is disabled, always return true
    if (!config || !config.enabled) {
        return {
            inServiceArea: true,
            confidence: 'high',
            reason: 'SERVICE_AREA_CHECK_DISABLED',
            details: { message: 'Service area validation is not enabled' }
        };
    }
    
    // Extract data from address if not provided separately
    const extractedZip = zipCode || extractZipCode(address);
    const extractedCity = city || extractCity(address);
    const normalizedCity = normalizeCity(extractedCity);
    
    logger.debug('[SERVICE AREA] Validating', {
        address,
        extractedZip,
        extractedCity,
        normalizedCity,
        hasConfig: !!config
    });
    
    const results = {
        zipMatch: null,
        cityMatch: null,
        countyMatch: null,
        stateMatch: null,
        radiusMatch: null,
        borderlineMatch: null
    };
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 1: ZIP CODE (most precise)
    // ═══════════════════════════════════════════════════════════════════
    if (extractedZip && config.servicedZipCodes?.length > 0) {
        if (config.servicedZipCodes.includes(extractedZip)) {
            results.zipMatch = true;
            logger.debug('[SERVICE AREA] ✅ ZIP code match', { zip: extractedZip });
        } else if (config.borderlineZipCodes?.includes(extractedZip)) {
            results.borderlineMatch = true;
            logger.debug('[SERVICE AREA] ⚠️ Borderline ZIP code', { zip: extractedZip });
        } else {
            results.zipMatch = false;
            logger.debug('[SERVICE AREA] ❌ ZIP code not in service area', { zip: extractedZip });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 2: CITY
    // ═══════════════════════════════════════════════════════════════════
    if (normalizedCity && config.servicedCities?.length > 0) {
        const normalizedServicedCities = config.servicedCities.map(c => normalizeCity(c));
        
        if (config.matchStrictness === 'exact') {
            results.cityMatch = normalizedServicedCities.includes(normalizedCity);
        } else {
            // Fuzzy match - check if any serviced city contains or is contained by the input
            results.cityMatch = normalizedServicedCities.some(sc => 
                sc.includes(normalizedCity) || normalizedCity.includes(sc)
            );
        }
        
        logger.debug('[SERVICE AREA] City check', { 
            city: normalizedCity, 
            match: results.cityMatch,
            servicedCities: normalizedServicedCities.slice(0, 5)
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 3: COUNTY
    // ═══════════════════════════════════════════════════════════════════
    if (county && config.servicedCounties?.length > 0) {
        const normalizedCounty = county.toLowerCase().replace(' county', '').trim();
        const normalizedServicedCounties = config.servicedCounties.map(c => 
            c.toLowerCase().replace(' county', '').trim()
        );
        results.countyMatch = normalizedServicedCounties.includes(normalizedCounty);
        
        logger.debug('[SERVICE AREA] County check', { 
            county: normalizedCounty, 
            match: results.countyMatch 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 4: STATE
    // ═══════════════════════════════════════════════════════════════════
    if (state && config.servicedState) {
        results.stateMatch = state.toUpperCase() === config.servicedState.toUpperCase();
        
        logger.debug('[SERVICE AREA] State check', { 
            state, 
            servicedState: config.servicedState,
            match: results.stateMatch 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // CHECK 5: RADIUS (requires lat/lng from Google Maps)
    // ═══════════════════════════════════════════════════════════════════
    if (lat && lng && config.radiusCoverage?.enabled && 
        config.radiusCoverage.centerLat && config.radiusCoverage.centerLng) {
        const distance = calculateDistanceMiles(
            config.radiusCoverage.centerLat,
            config.radiusCoverage.centerLng,
            lat,
            lng
        );
        results.radiusMatch = distance <= config.radiusCoverage.radiusMiles;
        results.distanceMiles = Math.round(distance * 10) / 10;
        
        logger.debug('[SERVICE AREA] Radius check', { 
            distance: results.distanceMiles,
            radiusMiles: config.radiusCoverage.radiusMiles,
            match: results.radiusMatch 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════
    // DECISION LOGIC
    // ═══════════════════════════════════════════════════════════════════
    
    // Borderline case - special handling
    if (results.borderlineMatch) {
        return {
            inServiceArea: 'borderline',
            confidence: 'medium',
            reason: 'BORDERLINE_ZIP',
            details: {
                zipCode: extractedZip,
                message: config.borderlineResponse || 'This area may be serviceable, needs confirmation.'
            }
        };
    }
    
    // Definite NO - ZIP explicitly not in list
    if (results.zipMatch === false) {
        return {
            inServiceArea: false,
            confidence: 'high',
            reason: 'ZIP_NOT_SERVICED',
            details: {
                zipCode: extractedZip,
                city: extractedCity,
                servicedZips: config.servicedZipCodes?.slice(0, 10),
                serviceAreaSummary: config.serviceAreaSummary
            }
        };
    }
    
    // Definite NO - State mismatch
    if (results.stateMatch === false) {
        return {
            inServiceArea: false,
            confidence: 'high',
            reason: 'STATE_NOT_SERVICED',
            details: {
                state,
                servicedState: config.servicedState
            }
        };
    }
    
    // Definite NO - Outside radius
    if (results.radiusMatch === false) {
        return {
            inServiceArea: false,
            confidence: 'high',
            reason: 'OUTSIDE_RADIUS',
            details: {
                distanceMiles: results.distanceMiles,
                maxRadiusMiles: config.radiusCoverage.radiusMiles
            }
        };
    }
    
    // Definite YES - Any positive match
    if (results.zipMatch === true || results.cityMatch === true || 
        results.countyMatch === true || results.radiusMatch === true) {
        return {
            inServiceArea: true,
            confidence: 'high',
            reason: results.zipMatch ? 'ZIP_MATCHED' : 
                    results.cityMatch ? 'CITY_MATCHED' : 
                    results.countyMatch ? 'COUNTY_MATCHED' : 'RADIUS_MATCHED',
            details: {
                zipCode: extractedZip,
                city: extractedCity,
                matchedBy: Object.keys(results).filter(k => results[k] === true)
            }
        };
    }
    
    // UNCERTAIN - No data to validate against
    return {
        inServiceArea: 'unknown',
        confidence: 'low',
        reason: 'INSUFFICIENT_DATA',
        details: {
            extractedZip,
            extractedCity,
            message: 'Could not determine service area - need more address details'
        }
    };
}

/**
 * Generate response message based on validation result
 */
function generateResponse(validationResult, config) {
    if (!config) {
        return null;
    }
    
    if (validationResult.inServiceArea === true) {
        let response = config.inAreaResponse || "Great! We do service that area.";
        response = response.replace('{city}', validationResult.details?.city || 'your area');
        response = response.replace('{zip}', validationResult.details?.zipCode || '');
        return { type: 'IN_AREA', response };
    }
    
    if (validationResult.inServiceArea === false) {
        let response = config.outOfAreaResponse || "I'm sorry, we don't service that area.";
        response = response.replace('{area}', validationResult.details?.city || validationResult.details?.zipCode || 'that area');
        response = response.replace('{serviceAreaSummary}', config.serviceAreaSummary || 'our local area');
        
        // Add referral if configured
        if (config.offerReferral && config.referralCompanyName) {
            response += ' ' + (config.referralResponse || '');
        }
        
        return { type: 'OUT_OF_AREA', response };
    }
    
    if (validationResult.inServiceArea === 'borderline') {
        return { 
            type: 'BORDERLINE', 
            response: config.borderlineResponse || "That area is on the edge of our coverage. Let me check if we can help."
        };
    }
    
    if (validationResult.inServiceArea === 'unknown') {
        return { 
            type: 'UNCLEAR', 
            response: config.unclearAreaResponse || "Just to confirm — what city or ZIP code is the service address in?"
        };
    }
    
    return null;
}

/**
 * Quick check if text mentions a ZIP code or city
 * Used for detecting "do you service 33901?" questions
 */
function detectServiceAreaQuestion(text, config) {
    if (!text || !config?.enabled) return null;
    
    const lowerText = text.toLowerCase();
    
    // Check for explicit service area questions
    const serviceAreaPatterns = [
        /do you (service|cover|serve|work in|go to)\s+(.+)/i,
        /can you (come to|service|help me in)\s+(.+)/i,
        /are you (available in|serving)\s+(.+)/i,
        /i('m| am) (in|at|from|located in)\s+(.+)/i,
        /my (address|location|zip|city) is\s+(.+)/i
    ];
    
    for (const pattern of serviceAreaPatterns) {
        const match = text.match(pattern);
        if (match) {
            const locationPart = match[match.length - 1]; // Last capture group
            const zip = extractZipCode(locationPart);
            const city = !zip ? locationPart.trim() : null;
            
            return {
                isServiceAreaQuestion: true,
                extractedZip: zip,
                extractedCity: city,
                originalText: text
            };
        }
    }
    
    // Also check for standalone ZIP codes
    const zip = extractZipCode(text);
    if (zip && config.servicedZipCodes?.length > 0) {
        return {
            isServiceAreaQuestion: true,
            extractedZip: zip,
            extractedCity: null,
            originalText: text
        };
    }
    
    return null;
}

module.exports = {
    validateServiceArea,
    smartServiceAreaCheck,  // V71: Geocodes cities to check against radius
    geocodeLocation,        // V71: Get lat/lng for a location
    generateResponse,
    detectServiceAreaQuestion,
    extractZipCode,
    extractCity,
    normalizeCity,
    calculateDistanceMiles
};

/**
 * ============================================================================
 * PHONE NUMBER NORMALIZATION UTILITY
 * ============================================================================
 * 
 * PURPOSE: Normalize phone numbers to E.164 format
 * 
 * FEATURES:
 * - International format support
 * - US/Canada default region
 * - Validation
 * - Display formatting
 * 
 * USAGE:
 *   const { normalize, isValid } = require('./phoneNormalization');
 *   const result = normalize('(239) 555-0100'); // '+12395550100'
 * 
 * ============================================================================
 */

const { parsePhoneNumber, isValidPhoneNumber } = require('libphonenumber-js');

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Phone number in any format
 * @param {string} defaultRegion - Default country code (default: 'US')
 * @returns {object} { e164, display, isValid, error }
 */
function normalize(phone, defaultRegion = 'US') {
    if (!phone || typeof phone !== 'string') {
        return {
            e164: null,
            display: null,
            isValid: false,
            error: 'Phone number is required'
        };
    }
    
    // Clean input
    const cleaned = phone.trim();
    
    if (!cleaned) {
        return {
            e164: null,
            display: null,
            isValid: false,
            error: 'Phone number is required'
        };
    }
    
    try {
        // Parse with default region
        const phoneNumber = parsePhoneNumber(cleaned, defaultRegion);
        
        if (!phoneNumber) {
            return {
                e164: null,
                display: cleaned,
                isValid: false,
                error: 'Invalid phone number format'
            };
        }
        
        // Check if valid
        if (!phoneNumber.isValid()) {
            return {
                e164: null,
                display: cleaned,
                isValid: false,
                error: 'Phone number is not valid'
            };
        }
        
        // Return normalized formats
        return {
            e164: phoneNumber.number, // E.164: +12395550100
            display: phoneNumber.formatNational(), // National: (239) 555-0100
            international: phoneNumber.formatInternational(), // International: +1 239-555-0100
            country: phoneNumber.country, // Country code: US
            type: phoneNumber.getType(), // Type: MOBILE, FIXED_LINE, etc.
            isValid: true,
            error: null
        };
        
    } catch (error) {
        return {
            e164: null,
            display: cleaned,
            isValid: false,
            error: error.message || 'Failed to parse phone number'
        };
    }
}

/**
 * Quick validation without normalization
 * @param {string} phone - Phone number
 * @param {string} defaultRegion - Default country code
 * @returns {boolean}
 */
function isValid(phone, defaultRegion = 'US') {
    if (!phone || typeof phone !== 'string') {
        return false;
    }
    
    try {
        return isValidPhoneNumber(phone, defaultRegion);
    } catch {
        return false;
    }
}

/**
 * Format phone number for display (without normalizing)
 * @param {string} phone - Phone number
 * @param {string} format - 'national' or 'international'
 * @param {string} defaultRegion - Default country code
 * @returns {string}
 */
function format(phone, format = 'national', defaultRegion = 'US') {
    if (!phone) {
        return '';
    }
    
    try {
        const phoneNumber = parsePhoneNumber(phone, defaultRegion);
        
        if (!phoneNumber || !phoneNumber.isValid()) {
            return phone;
        }
        
        return format === 'international' 
            ? phoneNumber.formatInternational() 
            : phoneNumber.formatNational();
            
    } catch {
        return phone;
    }
}

module.exports = {
    normalize,
    isValid,
    format
};


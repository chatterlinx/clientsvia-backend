/**
 * ============================================================================
 * VARIABLE VALIDATORS
 * ============================================================================
 * 
 * PURPOSE: Validate company configuration variables by type
 * 
 * TYPES SUPPORTED:
 * 1. text - Non-empty string
 * 2. email - Valid email address
 * 3. phone - Valid phone number (E.164)
 * 4. url - Valid URL
 * 5. currency - Valid USD amount
 * 6. enum - Value from allowed list
 * 7. multiline - Non-empty text (allows newlines)
 * 
 * RETURNS: { isValid: boolean, errorMessage: string, formatted?: string }
 * 
 * ============================================================================
 */

const { normalize: normalizePhone } = require('./phoneNormalization');

/**
 * Validate text (non-empty string)
 */
function validateText(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'This field is required'
        };
    }
    
    const trimmed = value.trim();
    
    if (!trimmed) {
        return {
            isValid: false,
            errorMessage: 'This field cannot be empty'
        };
    }
    
    // Check min length
    if (definition.minLength && trimmed.length < definition.minLength) {
        return {
            isValid: false,
            errorMessage: `Must be at least ${definition.minLength} characters`
        };
    }
    
    // Check max length
    if (definition.maxLength && trimmed.length > definition.maxLength) {
        return {
            isValid: false,
            errorMessage: `Must be no more than ${definition.maxLength} characters`
        };
    }
    
    return {
        isValid: true,
        errorMessage: null,
        formatted: trimmed
    };
}

/**
 * Validate email address
 */
function validateEmail(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'Email address is required'
        };
    }
    
    const trimmed = value.trim().toLowerCase();
    
    if (!trimmed) {
        return {
            isValid: false,
            errorMessage: 'Email address is required'
        };
    }
    
    // RFC 5322 simplified regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(trimmed)) {
        return {
            isValid: false,
            errorMessage: 'Invalid email address format'
        };
    }
    
    // Additional checks
    const [localPart, domain] = trimmed.split('@');
    
    if (localPart.length > 64) {
        return {
            isValid: false,
            errorMessage: 'Email address is too long'
        };
    }
    
    if (domain.length > 255) {
        return {
            isValid: false,
            errorMessage: 'Email domain is too long'
        };
    }
    
    return {
        isValid: true,
        errorMessage: null,
        formatted: trimmed
    };
}

/**
 * Validate phone number
 */
function validatePhone(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'Phone number is required'
        };
    }
    
    const defaultRegion = definition.region || 'US';
    const result = normalizePhone(value, defaultRegion);
    
    if (!result.isValid) {
        return {
            isValid: false,
            errorMessage: result.error || 'Invalid phone number'
        };
    }
    
    return {
        isValid: true,
        errorMessage: null,
        formatted: result.e164, // Store as E.164
        display: result.display // For UI display
    };
}

/**
 * Validate URL
 */
function validateUrl(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'URL is required'
        };
    }
    
    const trimmed = value.trim();
    
    if (!trimmed) {
        return {
            isValid: false,
            errorMessage: 'URL is required'
        };
    }
    
    // Basic URL regex (http/https)
    const urlRegex = /^https?:\/\/[^\s]+\.[^\s]+$/;
    
    if (!urlRegex.test(trimmed)) {
        return {
            isValid: false,
            errorMessage: 'Invalid URL format. Must start with http:// or https://'
        };
    }
    
    // Try to parse as URL object
    try {
        const urlObj = new URL(trimmed);
        
        // Ensure it has a host
        if (!urlObj.hostname) {
            return {
                isValid: false,
                errorMessage: 'Invalid URL: missing hostname'
            };
        }
        
        // Require HTTPS if specified
        if (definition.requireHttps && urlObj.protocol !== 'https:') {
            return {
                isValid: false,
                errorMessage: 'URL must use HTTPS'
            };
        }
        
        return {
            isValid: true,
            errorMessage: null,
            formatted: trimmed
        };
        
    } catch (error) {
        return {
            isValid: false,
            errorMessage: 'Invalid URL format'
        };
    }
}

/**
 * Validate currency (USD)
 */
function validateCurrency(value, definition = {}) {
    if (value === null || value === undefined || value === '') {
        return {
            isValid: false,
            errorMessage: 'Amount is required'
        };
    }
    
    // Convert to string for parsing
    const str = String(value).trim();
    
    if (!str) {
        return {
            isValid: false,
            errorMessage: 'Amount is required'
        };
    }
    
    // Remove dollar sign and commas
    const cleaned = str.replace(/[$,]/g, '');
    
    // Validate format: optional negative, digits, optional decimal with 2 digits
    const currencyRegex = /^-?\d{1,10}(\.\d{1,2})?$/;
    
    if (!currencyRegex.test(cleaned)) {
        return {
            isValid: false,
            errorMessage: 'Invalid amount format. Use format: 123.45'
        };
    }
    
    const amount = parseFloat(cleaned);
    
    if (isNaN(amount)) {
        return {
            isValid: false,
            errorMessage: 'Invalid amount'
        };
    }
    
    // Check min/max
    if (definition.min !== undefined && amount < definition.min) {
        return {
            isValid: false,
            errorMessage: `Amount must be at least $${definition.min}`
        };
    }
    
    if (definition.max !== undefined && amount > definition.max) {
        return {
            isValid: false,
            errorMessage: `Amount must be no more than $${definition.max}`
        };
    }
    
    // Format as currency
    const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
    
    return {
        isValid: true,
        errorMessage: null,
        formatted, // $123.45
        value: amount // 123.45
    };
}

/**
 * Validate enum (value from allowed list)
 */
function validateEnum(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'Please select a value'
        };
    }
    
    const trimmed = value.trim();
    
    if (!trimmed) {
        return {
            isValid: false,
            errorMessage: 'Please select a value'
        };
    }
    
    const allowedValues = definition.enumValues || [];
    
    if (allowedValues.length === 0) {
        // No enum values defined, accept anything
        return {
            isValid: true,
            errorMessage: null,
            formatted: trimmed
        };
    }
    
    if (!allowedValues.includes(trimmed)) {
        return {
            isValid: false,
            errorMessage: `Invalid value. Must be one of: ${allowedValues.join(', ')}`
        };
    }
    
    return {
        isValid: true,
        errorMessage: null,
        formatted: trimmed
    };
}

/**
 * Validate multiline text
 */
function validateMultiline(value, definition = {}) {
    if (!value || typeof value !== 'string') {
        return {
            isValid: false,
            errorMessage: 'This field is required'
        };
    }
    
    const trimmed = value.trim();
    
    if (!trimmed) {
        return {
            isValid: false,
            errorMessage: 'This field cannot be empty'
        };
    }
    
    // Check min length
    if (definition.minLength && trimmed.length < definition.minLength) {
        return {
            isValid: false,
            errorMessage: `Must be at least ${definition.minLength} characters`
        };
    }
    
    // Check max length
    if (definition.maxLength && trimmed.length > definition.maxLength) {
        return {
            isValid: false,
            errorMessage: `Must be no more than ${definition.maxLength} characters`
        };
    }
    
    return {
        isValid: true,
        errorMessage: null,
        formatted: trimmed
    };
}

/**
 * Main validation function (routes to specific validator)
 */
function validate(value, definition) {
    const type = definition?.type || 'text';
    
    switch (type) {
        case 'text':
            return validateText(value, definition);
        case 'email':
            return validateEmail(value, definition);
        case 'phone':
            return validatePhone(value, definition);
        case 'url':
            return validateUrl(value, definition);
        case 'currency':
            return validateCurrency(value, definition);
        case 'enum':
            return validateEnum(value, definition);
        case 'multiline':
            return validateMultiline(value, definition);
        default:
            return validateText(value, definition);
    }
}

module.exports = {
    validate,
    validateText,
    validateEmail,
    validatePhone,
    validateUrl,
    validateCurrency,
    validateEnum,
    validateMultiline
};


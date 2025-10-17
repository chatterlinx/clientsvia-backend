/**
 * ============================================================================
 * VARIABLE VALIDATORS
 * ============================================================================
 * 
 * PURPOSE: Type-specific validation for company variables
 * 
 * SUPPORTED TYPES:
 * - text: Basic non-empty string
 * - email: RFC 5322 email validation
 * - phone: International phone with E.164 normalization
 * - url: Valid HTTP/HTTPS URL
 * - currency: US dollar format ($XX.XX)
 * - enum: Value from allowed list
 * - multiline: Multi-line text (same as text)
 * - required: Non-empty check
 * 
 * FEATURES:
 * - Returns normalized values (e.g., E.164 for phones)
 * - Helpful error messages
 * - Production-grade validation
 * 
 * ============================================================================
 */

const { parsePhoneNumber, isValidPhoneNumber } = require('libphonenumber-js');

/**
 * Main validation function
 * @param {string} value - Value to validate
 * @param {Object} definition - Variable definition with type and rules
 * @returns {Object} { isValid: boolean, errorMessage?: string, formatted?: string }
 */
function validate(value, definition) {
    const type = definition.type || 'text';
    
    // Check required first
    if (definition.required && (!value || value.trim() === '')) {
        return {
            isValid: false,
            errorMessage: `${definition.label || 'This field'} is required`
        };
    }
    
    // If not required and empty, it's valid
    if (!value || value.trim() === '') {
        return {
            isValid: true,
            formatted: ''
        };
    }
    
    // Dispatch to type-specific validator
    switch (type) {
        case 'email':
            return validateEmail(value, definition);
        case 'phone':
            return validatePhone(value, definition);
        case 'url':
            return validateURL(value, definition);
        case 'currency':
            return validateCurrency(value, definition);
        case 'enum':
            return validateEnum(value, definition);
        case 'text':
        case 'multiline':
            return validateText(value, definition);
        default:
            console.warn(`[VALIDATORS] Unknown type: ${type}, using text validation`);
            return validateText(value, definition);
    }
}

/**
 * Validate text
 */
function validateText(value, definition) {
    const trimmed = value.trim();
    
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
    
    // Check pattern (if provided)
    if (definition.pattern) {
        const regex = new RegExp(definition.pattern);
        if (!regex.test(trimmed)) {
            return {
                isValid: false,
                errorMessage: definition.patternError || `Invalid format`
            };
        }
    }
    
    return {
        isValid: true,
        formatted: trimmed
    };
}

/**
 * Validate email
 */
function validateEmail(value, definition) {
    const trimmed = value.trim().toLowerCase();
    
    // RFC 5322 simplified regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(trimmed)) {
        return {
            isValid: false,
            errorMessage: 'Invalid email format (example: name@company.com)'
        };
    }
    
    // Additional checks
    if (trimmed.length > 254) {
        return {
            isValid: false,
            errorMessage: 'Email address is too long'
        };
    }
    
    // Check for common typos
    const commonTypos = {
        'gamil.com': 'gmail.com',
        'gmai.com': 'gmail.com',
        'yahooo.com': 'yahoo.com',
        'hotmial.com': 'hotmail.com'
    };
    
    const domain = trimmed.split('@')[1];
    if (commonTypos[domain]) {
        return {
            isValid: false,
            errorMessage: `Did you mean @${commonTypos[domain]}?`
        };
    }
    
    return {
        isValid: true,
        formatted: trimmed
    };
}

/**
 * Validate phone number with international support
 */
function validatePhone(value, definition) {
    const trimmed = value.trim();
    
    try {
        // Default to US if no country specified
        const defaultCountry = definition.country || 'US';
        
        // Check if valid phone number
        if (!isValidPhoneNumber(trimmed, defaultCountry)) {
            return {
                isValid: false,
                errorMessage: 'Invalid phone number format (example: +1-555-123-4567 or 555-123-4567)'
            };
        }
        
        // Parse and format to E.164
        const phoneNumber = parsePhoneNumber(trimmed, defaultCountry);
        
        if (!phoneNumber) {
            return {
                isValid: false,
                errorMessage: 'Could not parse phone number'
            };
        }
        
        // Get E.164 format (international standard)
        const e164 = phoneNumber.format('E.164');
        
        // Also get national format for display
        const national = phoneNumber.formatNational();
        
        console.log(`[VALIDATORS] 📞 Phone: "${trimmed}" → E.164: "${e164}" (Display: "${national}")`);
        
        return {
            isValid: true,
            formatted: e164, // Store E.164 format
            display: national // Optional: for display purposes
        };
        
    } catch (error) {
        console.error(`[VALIDATORS] ❌ Phone validation error:`, error);
        return {
            isValid: false,
            errorMessage: 'Invalid phone number format'
        };
    }
}

/**
 * Validate URL
 */
function validateURL(value, definition) {
    const trimmed = value.trim();
    
    try {
        // Try to parse URL
        const url = new URL(trimmed);
        
        // Check protocol
        if (!['http:', 'https:'].includes(url.protocol)) {
            return {
                isValid: false,
                errorMessage: 'URL must start with http:// or https://'
            };
        }
        
        // Check for hostname
        if (!url.hostname || url.hostname.length < 3) {
            return {
                isValid: false,
                errorMessage: 'Invalid URL hostname'
            };
        }
        
        // Check for TLD
        if (!url.hostname.includes('.')) {
            return {
                isValid: false,
                errorMessage: 'URL must include a domain extension (e.g., .com)'
            };
        }
        
        return {
            isValid: true,
            formatted: url.toString() // Normalized URL
        };
        
    } catch (error) {
        // Try adding https:// if missing protocol
        if (!trimmed.startsWith('http')) {
            return validateURL('https://' + trimmed, definition);
        }
        
        return {
            isValid: false,
            errorMessage: 'Invalid URL format (example: https://www.company.com)'
        };
    }
}

/**
 * Validate currency (US dollar format)
 */
function validateCurrency(value, definition) {
    const trimmed = value.trim();
    
    // Remove $ and commas for parsing
    const cleaned = trimmed.replace(/[$,]/g, '');
    
    // Check if valid number
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
        return {
            isValid: false,
            errorMessage: 'Invalid currency format (example: $99.99 or 99.99)'
        };
    }
    
    const amount = parseFloat(cleaned);
    
    // Check min/max
    if (definition.min !== undefined && amount < definition.min) {
        return {
            isValid: false,
            errorMessage: `Amount must be at least $${definition.min.toFixed(2)}`
        };
    }
    
    if (definition.max !== undefined && amount > definition.max) {
        return {
            isValid: false,
            errorMessage: `Amount must not exceed $${definition.max.toFixed(2)}`
        };
    }
    
    // Format to $XX.XX
    const formatted = '$' + amount.toFixed(2);
    
    return {
        isValid: true,
        formatted
    };
}

/**
 * Validate enum (value from allowed list)
 */
function validateEnum(value, definition) {
    const trimmed = value.trim();
    
    if (!definition.enumValues || !Array.isArray(definition.enumValues)) {
        console.error(`[VALIDATORS] ❌ Enum validation missing enumValues`);
        return {
            isValid: false,
            errorMessage: 'Invalid configuration: no allowed values defined'
        };
    }
    
    // Case-insensitive comparison
    const lowerValue = trimmed.toLowerCase();
    const allowedValues = definition.enumValues.map(v => v.toLowerCase());
    
    if (!allowedValues.includes(lowerValue)) {
        return {
            isValid: false,
            errorMessage: `Must be one of: ${definition.enumValues.join(', ')}`
        };
    }
    
    // Return the original casing from allowed values
    const matchIndex = allowedValues.indexOf(lowerValue);
    const formatted = definition.enumValues[matchIndex];
    
    return {
        isValid: true,
        formatted
    };
}

/**
 * Validate required field (alias for empty check)
 */
function validateRequired(value, definition) {
    if (!value || value.trim() === '') {
        return {
            isValid: false,
            errorMessage: `${definition.label || 'This field'} is required`
        };
    }
    
    return {
        isValid: true,
        formatted: value.trim()
    };
}

/**
 * Batch validate multiple variables
 * @param {Object} variables - Object with variable key-value pairs
 * @param {Array} definitions - Array of variable definitions
 * @returns {Object} { isValid: boolean, errors: Array, formatted: Object }
 */
function validateBatch(variables, definitions) {
    const errors = [];
    const formatted = {};
    
    // Create lookup map
    const defMap = {};
    definitions.forEach(def => {
        defMap[def.key] = def;
    });
    
    // Validate each variable
    for (const [key, value] of Object.entries(variables)) {
        const definition = defMap[key];
        
        if (!definition) {
            console.warn(`[VALIDATORS] No definition found for variable: ${key}`);
            formatted[key] = value;
            continue;
        }
        
        const result = validate(value, definition);
        
        if (!result.isValid) {
            errors.push({
                key,
                label: definition.label || key,
                error: result.errorMessage,
                value
            });
        } else {
            formatted[key] = result.formatted || value;
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        formatted
    };
}

module.exports = {
    validate,
    validateText,
    validateEmail,
    validatePhone,
    validateURL,
    validateCurrency,
    validateEnum,
    validateRequired,
    validateBatch
};

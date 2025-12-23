/**
 * ============================================================================
 * PLACEHOLDER STANDARD - Unified Format for Multi-tenant Content
 * ============================================================================
 * 
 * STANDARD FORMAT: {{placeholderName}}
 * 
 * Examples:
 * - {{companyName}} - Company name
 * - {{companyPhone}} - Company phone number
 * - {{callerName}} - Caller's name (from call context)
 * - {{appointmentDate}} - Scheduled appointment date
 * 
 * This module provides:
 * - Alias mapping for backward compatibility
 * - Placeholder substitution engine
 * - Validation for placeholder syntax
 * 
 * ============================================================================
 */

/**
 * Standard placeholder format regex
 * Matches: {{placeholderName}}
 */
const PLACEHOLDER_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/**
 * Legacy format regexes for backward compatibility
 * 
 * CRITICAL: The single-brace regex MUST use negative lookbehind/lookahead
 * to avoid matching the inner braces of {{placeholder}} which would
 * incorrectly convert it to {{{placeholder}}}
 */
const LEGACY_FORMATS = [
    /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g,  // {placeholder} but NOT {{placeholder}}
    /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,              // ${placeholder}
    /%([a-zA-Z_][a-zA-Z0-9_]*)%/g                   // %placeholder%
];

/**
 * Alias mapping for common placeholders
 * Maps legacy/variant names to standard names (camelCase canonical)
 * 
 * CRITICAL: All variant spellings MUST map to camelCase canonical
 * Runtime substitution uses this map for both keys and values
 */
const PLACEHOLDER_ALIASES = {
    // Company name variants
    'companyname': 'companyName',
    'company_name': 'companyName',
    'COMPANYNAME': 'companyName',
    'COMPANY_NAME': 'companyName',
    'company': 'companyName',
    'CompanyName': 'companyName',
    
    // Company phone variants
    'companyphone': 'companyPhone',
    'company_phone': 'companyPhone',
    'phone': 'companyPhone',
    'phonenumber': 'companyPhone',
    'phone_number': 'companyPhone',
    'CompanyPhone': 'companyPhone',
    'COMPANYPHONE': 'companyPhone',
    
    // Emergency phone variants (CRITICAL: must match {{emergencyPhone}} in replies)
    'emergencyphone': 'emergencyPhone',
    'emergency_phone': 'emergencyPhone',
    'EmergencyPhone': 'emergencyPhone',
    'EMERGENCYPHONE': 'emergencyPhone',
    'emergency-phone': 'emergencyPhone',
    'afterhoursphone': 'emergencyPhone',
    'after_hours_phone': 'emergencyPhone',
    
    // Company address variants
    'companyaddress': 'companyAddress',
    'company_address': 'companyAddress',
    'address': 'companyAddress',
    'CompanyAddress': 'companyAddress',
    
    // Caller name variants
    'callername': 'callerName',
    'caller_name': 'callerName',
    'name': 'callerName',
    'customername': 'callerName',
    'customer_name': 'callerName',
    'CallerName': 'callerName',
    
    // Service area variants
    'servicearea': 'serviceArea',
    'service_area': 'serviceArea',
    'ServiceArea': 'serviceArea',
    'SERVICEAREA': 'serviceArea',
    
    // Hours variants
    'businesshours': 'businessHours',
    'business_hours': 'businessHours',
    'hours': 'businessHours',
    'BusinessHours': 'businessHours',
    'BUSINESSHOURS': 'businessHours',
    
    // Website variants
    'website': 'companyWebsite',
    'url': 'companyWebsite',
    'companyurl': 'companyWebsite',
    'companywebsite': 'companyWebsite',
    'CompanyWebsite': 'companyWebsite',
    
    // Email variants
    'email': 'companyEmail',
    'companyemail': 'companyEmail',
    'CompanyEmail': 'companyEmail',
    
    // Appointment variants
    'appointmentdate': 'appointmentDate',
    'appointment_date': 'appointmentDate',
    'date': 'appointmentDate',
    'AppointmentDate': 'appointmentDate',
    
    'appointmenttime': 'appointmentTime',
    'appointment_time': 'appointmentTime',
    'time': 'appointmentTime',
    'AppointmentTime': 'appointmentTime'
};

/**
 * Normalize a placeholder key to standard format
 * @param {String} key - Raw placeholder key
 * @returns {String} - Normalized key
 */
function normalizeKey(key) {
    if (!key) return key;
    
    // Check alias map first
    const lowerKey = key.toLowerCase();
    if (PLACEHOLDER_ALIASES[lowerKey]) {
        return PLACEHOLDER_ALIASES[lowerKey];
    }
    if (PLACEHOLDER_ALIASES[key]) {
        return PLACEHOLDER_ALIASES[key];
    }
    
    // Return as-is if no alias found
    return key;
}

/**
 * Convert legacy format placeholders to standard {{format}}
 * @param {String} text - Text with placeholders
 * @returns {String} - Text with standardized placeholders
 */
function standardizePlaceholders(text) {
    if (!text || typeof text !== 'string') return text;
    
    let result = text;
    
    // Convert legacy formats to standard
    for (const legacyRegex of LEGACY_FORMATS) {
        result = result.replace(legacyRegex, (match, key) => {
            const normalizedKey = normalizeKey(key);
            return `{{${normalizedKey}}}`;
        });
    }
    
    // Normalize keys in existing standard format
    result = result.replace(PLACEHOLDER_REGEX, (match, key) => {
        const normalizedKey = normalizeKey(key);
        return `{{${normalizedKey}}}`;
    });
    
    return result;
}

/**
 * Substitute placeholders with actual values
 * @param {String} text - Text with {{placeholders}}
 * @param {Object} values - Map of placeholder names to values
 * @param {Object} options - Options
 * @returns {String} - Text with placeholders replaced
 */
function substitutePlaceholders(text, values = {}, options = {}) {
    if (!text || typeof text !== 'string') return text;
    
    const {
        throwOnMissing = false,
        defaultValue = '',
        normalizeFirst = true
    } = options;
    
    // First standardize the format
    let result = normalizeFirst ? standardizePlaceholders(text) : text;
    
    // Build lookup map with normalized keys
    const normalizedValues = {};
    for (const [key, value] of Object.entries(values)) {
        const normalizedKey = normalizeKey(key);
        normalizedValues[normalizedKey] = value;
        // Also keep original key for exact matches
        normalizedValues[key] = value;
    }
    
    // Substitute placeholders
    result = result.replace(PLACEHOLDER_REGEX, (match, key) => {
        const normalizedKey = normalizeKey(key);
        
        // Try normalized key first, then original
        if (normalizedValues[normalizedKey] !== undefined) {
            return normalizedValues[normalizedKey];
        }
        if (normalizedValues[key] !== undefined) {
            return normalizedValues[key];
        }
        
        // Handle missing
        if (throwOnMissing) {
            throw new Error(`Missing placeholder value for: ${key}`);
        }
        
        return defaultValue !== '' ? defaultValue : match;
    });
    
    return result;
}

/**
 * Extract all placeholders from text
 * @param {String} text - Text with placeholders
 * @returns {Array} - Array of placeholder keys found
 */
function extractPlaceholders(text) {
    if (!text || typeof text !== 'string') return [];
    
    const placeholders = new Set();
    
    // Standard format
    let match;
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');
    while ((match = regex.exec(text)) !== null) {
        placeholders.add(normalizeKey(match[1]));
    }
    
    // Legacy formats
    for (const legacyRegex of LEGACY_FORMATS) {
        const legacyRegexGlobal = new RegExp(legacyRegex.source, 'g');
        while ((match = legacyRegexGlobal.exec(text)) !== null) {
            placeholders.add(normalizeKey(match[1]));
        }
    }
    
    return Array.from(placeholders);
}

/**
 * Validate placeholder syntax in text
 * @param {String} text - Text to validate
 * @returns {Object} - { valid: boolean, errors: string[], suggestions: string[] }
 */
function validatePlaceholders(text) {
    if (!text || typeof text !== 'string') {
        return { valid: true, errors: [], suggestions: [] };
    }
    
    const errors = [];
    const suggestions = [];
    
    // Check for unclosed placeholders
    const unclosedDouble = text.match(/\{\{[^}]+$/g);
    if (unclosedDouble) {
        errors.push(`Unclosed placeholder: ${unclosedDouble[0]}`);
    }
    
    // Check for legacy formats and suggest standardization
    for (const legacyRegex of LEGACY_FORMATS) {
        const matches = text.match(legacyRegex);
        if (matches) {
            for (const match of matches) {
                const key = match.replace(/[{}$%]/g, '');
                const normalized = normalizeKey(key);
                suggestions.push(`Convert "${match}" to "{{${normalized}}}"`);
            }
        }
    }
    
    // Check for case inconsistencies
    const foundPlaceholders = extractPlaceholders(text);
    for (const placeholder of foundPlaceholders) {
        // Warn if using non-standard casing
        if (placeholder !== normalizeKey(placeholder)) {
            suggestions.push(`Consider standardizing "${placeholder}" to "${normalizeKey(placeholder)}"`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        suggestions,
        placeholdersFound: foundPlaceholders
    };
}

/**
 * Get list of all standard placeholders
 * These are the CANONICAL keys that should be used in all templates and replies
 */
function getStandardPlaceholders() {
    return [
        { key: 'companyName', description: 'Company name', example: 'Penguin Air', isCritical: true },
        { key: 'companyPhone', description: 'Company phone number', example: '555-123-4567', isCritical: true },
        { key: 'emergencyPhone', description: 'Emergency/after-hours phone', example: '555-999-8888', isCritical: false },
        { key: 'companyAddress', description: 'Company address', example: '123 Main St, Phoenix, AZ', isCritical: false },
        { key: 'companyEmail', description: 'Company email', example: 'info@company.com', isCritical: false },
        { key: 'companyWebsite', description: 'Company website', example: 'www.company.com', isCritical: false },
        { key: 'serviceArea', description: 'Service area/region', example: 'Phoenix metro area', isCritical: false },
        { key: 'businessHours', description: 'Business hours', example: 'Mon-Fri 8am-5pm', isCritical: false },
        { key: 'callerName', description: 'Caller name (from call)', example: 'John', isCritical: false },
        { key: 'appointmentDate', description: 'Appointment date', example: 'Monday, Jan 15', isCritical: false },
        { key: 'appointmentTime', description: 'Appointment time', example: '2:00 PM', isCritical: false },
        { key: 'technicianName', description: 'Assigned technician', example: 'Mike', isCritical: false },
        { key: 'estimatedArrival', description: 'ETA for service', example: '30-45 minutes', isCritical: false }
    ];
}

module.exports = {
    // Core functions
    normalizeKey,
    standardizePlaceholders,
    substitutePlaceholders,
    extractPlaceholders,
    validatePlaceholders,
    
    // Reference data
    getStandardPlaceholders,
    PLACEHOLDER_ALIASES,
    PLACEHOLDER_REGEX,
    
    // Constants
    STANDARD_FORMAT: '{{placeholderName}}'
};


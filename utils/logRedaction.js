/**
 * ============================================================================
 * LOG REDACTION UTILITY
 * ============================================================================
 * 
 * PURPOSE: Prevent sensitive data from appearing in logs
 * 
 * REDACTS:
 * - Phone numbers
 * - Email addresses  
 * - Variable values (prices, addresses, etc.)
 * - API keys/tokens
 * 
 * USAGE:
 *   const safe = redactSensitiveData({ phone: '239-555-0100', email: 'user@example.com' });
 *   logger.security('[INFO]', safe); // { phone: '[REDACTED]', email: '[REDACTED]' }
 * 
 * ============================================================================
 */

/**
 * Patterns for detecting sensitive data
 */
const SENSITIVE_PATTERNS = {
    // Phone numbers (various formats)
    phone: /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    
    // Email addresses
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    
    // Credit card numbers (basic pattern)
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    
    // SSN (xxx-xx-xxxx)
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    
    // API keys/tokens (generic long alphanumeric strings)
    apiKey: /[a-zA-Z0-9]{32,}/g
};

/**
 * Field names that should always be redacted
 */
const SENSITIVE_FIELD_NAMES = [
    'password',
    'apiKey',
    'authToken',
    'secret',
    'accessToken',
    'refreshToken',
    'phoneNumber',
    'phone',
    'email',
    'ssn',
    'creditCard',
    'cardNumber',
    'cvv',
    'pin'
];

/**
 * Redact sensitive data from an object
 * Returns a new object with sensitive fields redacted
 */
function redactSensitiveData(data, options = {}) {
    const {
        redactValues = true,      // Redact variable values
        redactPatterns = true,    // Redact based on patterns (phone, email)
        redactFieldNames = true,  // Redact based on field names
        placeholder = '[REDACTED]'
    } = options;
    
    // Handle non-objects
    if (typeof data !== 'object' || data === null) {
        return data;
    }
    
    // Handle arrays
    if (Array.isArray(data)) {
        return data.map(item => redactSensitiveData(item, options));
    }
    
    // Handle objects
    const redacted = {};
    
    for (const [key, value] of Object.entries(data)) {
        // Check if field name is sensitive
        if (redactFieldNames && isSensitiveFieldName(key)) {
            redacted[key] = placeholder;
            continue;
        }
        
        // Recursively redact nested objects
        if (typeof value === 'object' && value !== null) {
            redacted[key] = redactSensitiveData(value, options);
            continue;
        }
        
        // Redact string values that match patterns
        if (typeof value === 'string' && redactPatterns) {
            redacted[key] = redactPatternMatches(value, placeholder);
            continue;
        }
        
        // Keep value as-is
        redacted[key] = value;
    }
    
    return redacted;
}

/**
 * Check if a field name is sensitive
 */
function isSensitiveFieldName(fieldName) {
    const lowerFieldName = fieldName.toLowerCase();
    return SENSITIVE_FIELD_NAMES.some(sensitive => 
        lowerFieldName.includes(sensitive.toLowerCase())
    );
}

/**
 * Redact values that match sensitive patterns
 */
function redactPatternMatches(value, placeholder) {
    let redacted = value;
    
    // Replace phone numbers
    redacted = redacted.replace(SENSITIVE_PATTERNS.phone, placeholder);
    
    // Replace emails
    redacted = redacted.replace(SENSITIVE_PATTERNS.email, placeholder);
    
    // Replace credit cards
    redacted = redacted.replace(SENSITIVE_PATTERNS.creditCard, placeholder);
    
    // Replace SSNs
    redacted = redacted.replace(SENSITIVE_PATTERNS.ssn, placeholder);
    
    return redacted;
}

/**
 * Redact variable values from configuration updates
 * This is specifically for AI Agent Settings variable updates
 */
function redactVariableValues(variables) {
    if (!variables || typeof variables !== 'object') {
        return variables;
    }
    
    const redacted = {};
    for (const key of Object.keys(variables)) {
        redacted[key] = '[REDACTED]';
    }
    
    return redacted;
}

/**
 * Create a log-safe version of request data
 * Use this before logging request bodies
 */
function createLogSafeRequest(req) {
    return {
        method: req.method,
        path: req.path,
        companyId: req.params?.companyId,
        userId: req.user?.userId,
        ip: req.auditInfo?.ip || req.ip,
        timestamp: new Date().toISOString(),
        // Redact body
        body: redactSensitiveData(req.body, { redactValues: true }),
        // Redact sensitive headers
        headers: {
            'user-agent': req.headers['user-agent'],
            'content-type': req.headers['content-type'],
            // Don't log authorization headers
        }
    };
}

/**
 * Safe console.log wrapper that auto-redacts
 * Use this instead of console.log for sensitive data
 */
function safeLog(level, message, data) {
    const timestamp = new Date().toISOString();
    
    if (data) {
        const redacted = redactSensitiveData(data);
        logger.info(`[${timestamp}] [${level}] ${message}`, redacted);
    } else {
        logger.info(`[${timestamp}] [${level}] ${message}`);
    }
}

/**
 * Express middleware to log requests safely
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    
    // Log request (redacted)
    if (process.env.LOG_LEVEL === 'DEBUG') {
        const logSafe = createLogSafeRequest(req);
        logger.debug('[REQUEST]', logSafe);
    }
    
    // Intercept response to log it
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - start;
        
        logger.debug(
            `[RESPONSE] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
        );
        
        originalSend.call(this, data);
    };
    
    next();
}

module.exports = {
    redactSensitiveData,
    redactVariableValues,
    createLogSafeRequest,
    safeLog,
    requestLogger,
    isSensitiveFieldName,
    SENSITIVE_PATTERNS
};


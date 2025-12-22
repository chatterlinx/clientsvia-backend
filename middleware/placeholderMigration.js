/**
 * ============================================================================
 * PLACEHOLDER MIGRATION MIDDLEWARE
 * ============================================================================
 * 
 * PURPOSE: Auto-migrate legacy placeholders to canonical format on save
 * 
 * LEGACY FORMATS (will be converted):
 *   {companyname} -> {{companyName}}
 *   ${companyName} -> {{companyName}}
 *   %companyname% -> {{companyName}}
 * 
 * CANONICAL FORMAT:
 *   {{camelCaseKey}}
 * 
 * ============================================================================
 */

const { migratePlaceholders } = require('../utils/configUnifier');

// Fields that allow placeholders and should be migrated
const PLACEHOLDER_FIELDS = [
    'connectionMessages.voice.text',
    'connectionMessages.voice.realtime.text',
    'frontDeskBehavior.greeting',
    'frontDeskBehavior.emotions.angerResponse',
    'frontDeskBehavior.emotions.confusionResponse',
    // Response defaults are handled separately
];

/**
 * Recursively migrate placeholders in an object
 */
function migrateObjectPlaceholders(obj, fieldsToMigrate, path = '') {
    if (!obj || typeof obj !== 'object') return obj;
    
    const result = Array.isArray(obj) ? [...obj] : { ...obj };
    
    for (const key of Object.keys(result)) {
        const currentPath = path ? `${path}.${key}` : key;
        const value = result[key];
        
        if (typeof value === 'string') {
            // Check if this field should be migrated
            const shouldMigrate = fieldsToMigrate.some(f => 
                currentPath === f || currentPath.endsWith(f)
            );
            
            if (shouldMigrate) {
                result[key] = migratePlaceholders(value);
            }
        } else if (typeof value === 'object' && value !== null) {
            result[key] = migrateObjectPlaceholders(value, fieldsToMigrate, currentPath);
        }
    }
    
    return result;
}

/**
 * Express middleware to auto-migrate placeholders on company save
 */
function placeholderMigrationMiddleware(req, res, next) {
    if (!req.body) {
        return next();
    }
    
    // Migrate placeholders in request body
    req.body = migrateObjectPlaceholders(req.body, PLACEHOLDER_FIELDS);
    
    // Also handle direct text fields that might be updated
    const directTextFields = [
        'text',
        'greeting',
        'angerResponse',
        'confusionResponse',
        'fullReply'
    ];
    
    for (const field of directTextFields) {
        if (typeof req.body[field] === 'string') {
            req.body[field] = migratePlaceholders(req.body[field]);
        }
    }
    
    next();
}

/**
 * Migrate placeholders in response defaults specifically
 */
function migrateResponseDefaults(defaults) {
    if (!defaults) return defaults;
    
    const result = { ...defaults };
    
    const replyFields = ['notOfferedReply', 'unknownIntentReply', 'afterHoursReply'];
    
    for (const field of replyFields) {
        if (result[field]?.fullReply) {
            result[field] = {
                ...result[field],
                fullReply: migratePlaceholders(result[field].fullReply)
            };
        }
    }
    
    return result;
}

module.exports = {
    placeholderMigrationMiddleware,
    migrateObjectPlaceholders,
    migrateResponseDefaults,
    PLACEHOLDER_FIELDS
};


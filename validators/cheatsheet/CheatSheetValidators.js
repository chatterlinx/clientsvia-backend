/**
 * ============================================================================
 * CHEATSHEET VALIDATORS - JOI SCHEMAS
 * ============================================================================
 * 
 * Input validation for all CheatSheet API operations.
 * Prevents malicious/malformed data from reaching the database.
 * 
 * KEY BENEFITS:
 * 1. Security: Prevent injection attacks, oversized payloads
 * 2. Data Quality: Ensure valid data types, formats, ranges
 * 3. User Experience: Clear error messages for invalid input
 * 4. Performance: Reject bad requests early (before DB queries)
 * 
 * VALIDATION STRATEGY:
 * - Strict validation in production (no unknown keys)
 * - Size limits on all strings and arrays
 * - Type checking for all fields
 * - Custom validators for complex rules
 * 
 * ============================================================================
 */

const Joi = require('joi');

// ============================================================================
// FIELD-LEVEL VALIDATORS (Reusable)
// ============================================================================

const versionIdValidator = Joi.string()
  .pattern(/^(version|draft)-\d{13}-[a-f0-9]{8}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid version ID format',
    'any.required': 'Version ID is required'
  });

const companyIdValidator = Joi.string()
  .pattern(/^[a-f0-9]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid company ID format (must be valid MongoDB ObjectId)',
    'any.required': 'Company ID is required'
  });

const versionNameValidator = Joi.string()
  .min(1)
  .max(200)
  .trim()
  .required()
  .messages({
    'string.min': 'Version name must be at least 1 character',
    'string.max': 'Version name cannot exceed 200 characters',
    'any.required': 'Version name is required'
  });

const notesValidator = Joi.string()
  .max(2000)
  .allow('')
  .trim()
  .optional()
  .messages({
    'string.max': 'Notes cannot exceed 2000 characters'
  });

const userEmailValidator = Joi.string()
  .email()
  .max(255)
  .required()
  .messages({
    'string.email': 'Invalid email format',
    'string.max': 'Email cannot exceed 255 characters',
    'any.required': 'User email is required'
  });

// ============================================================================
// CONFIG SECTION VALIDATORS
// ============================================================================

/**
 * Booking Rule Validator
 */
const bookingRuleValidator = Joi.object({
  id: Joi.string().required(),
  label: Joi.string().min(1).max(200).required(),
  trade: Joi.string().max(100).allow(''),
  serviceType: Joi.string().max(100).allow(''),
  priority: Joi.string().valid('normal', 'high', 'emergency').default('normal'),
  daysOfWeek: Joi.array().items(Joi.string()).max(7),
  timeWindow: Joi.object({
    start: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('08:00'),
    end: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).default('17:00')
  }),
  sameDayAllowed: Joi.boolean().default(true),
  weekendAllowed: Joi.boolean().default(false),
  notes: Joi.string().max(500).allow(''),
  createdAt: Joi.date().optional(),
  createdBy: Joi.string().max(255).optional()
}).messages({
  'string.pattern.base': 'Time must be in HH:MM format (24-hour)'
});

/**
 * Company Contact Validator
 */
const companyContactValidator = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().min(1).max(200).required(),
  role: Joi.string().max(100).default('General Contact'),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).allow(null, '').optional(),
  email: Joi.string().email().max(255).allow(null, '').optional(),
  isPrimary: Joi.boolean().default(false),
  availableHours: Joi.string().max(100).default('24/7'),
  notes: Joi.string().max(500).allow(''),
  createdAt: Joi.date().optional(),
  createdBy: Joi.string().max(255).optional()
}).messages({
  'string.pattern.base': 'Phone must be in E.164 format (e.g., +15551234567)'
});

/**
 * Link Validator
 */
const linkValidator = Joi.object({
  id: Joi.string().required(),
  label: Joi.string().min(1).max(200).required(),
  category: Joi.string().valid('financing', 'portal', 'policy', 'catalog', 'other').default('other'),
  url: Joi.string().uri().max(2000).required(),
  shortDescription: Joi.string().max(500).allow(''),
  notes: Joi.string().max(500).allow(''),
  createdAt: Joi.date().optional(),
  createdBy: Joi.string().max(255).optional()
}).messages({
  'string.uri': 'URL must be a valid URI'
});

/**
 * Calculator Validator
 */
const calculatorValidator = Joi.object({
  id: Joi.string().required(),
  label: Joi.string().min(1).max(200).required(),
  type: Joi.string().max(50).default('flat-fee'),
  baseAmount: Joi.number().min(0).max(999999.99).default(0),
  notes: Joi.string().max(500).allow(''),
  createdAt: Joi.date().optional(),
  createdBy: Joi.string().max(255).optional()
}).messages({
  'number.max': 'Base amount cannot exceed $999,999.99'
});

/**
 * Full Config Validator
 * 
 * Validates entire CheatSheet config structure.
 * Used when saving drafts or creating new versions.
 */
const configValidator = Joi.object({
  schemaVersion: Joi.number().integer().min(1).max(10).required(),
  
  // V1 Legacy sections (kept as objects for backward compatibility)
  triage: Joi.object().unknown(true).default({}),
  frontlineIntel: Joi.object().unknown(true).default({}),
  transferRules: Joi.object().unknown(true).default({}),
  edgeCases: Joi.object().unknown(true).default({}),
  behavior: Joi.object().unknown(true).default({}),
  guardrails: Joi.object().unknown(true).default({}),
  
  // V2 Structured sections
  bookingRules: Joi.array().items(bookingRuleValidator).max(100).default([]),
  companyContacts: Joi.array().items(companyContactValidator).max(50).default([]),
  links: Joi.array().items(linkValidator).max(100).default([]),
  calculators: Joi.array().items(calculatorValidator).max(50).default([])
})
.custom((value, helpers) => {
  // Custom validator: Check total config size
  const size = JSON.stringify(value).length;
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (size > maxSize) {
    return helpers.error('config.tooLarge', {
      size: (size / 1024 / 1024).toFixed(2),
      maxSize: 5
    });
  }
  
  return value;
})
.messages({
  'config.tooLarge': 'Configuration too large: {{#size}}MB (max {{#maxSize}}MB)'
});

// ============================================================================
// API OPERATION VALIDATORS
// ============================================================================

/**
 * Create Draft Validator
 */
const createDraftSchema = Joi.object({
  name: versionNameValidator,
  baseVersionId: Joi.string().pattern(/^(version|draft)-\d{13}-[a-f0-9]{8}$/).optional().allow(null),
  notes: notesValidator
}).messages({
  'string.pattern.base': 'Invalid base version ID format'
});

/**
 * Save Draft Validator
 */
const saveDraftSchema = Joi.object({
  config: configValidator.required(),
  expectedVersion: Joi.number().integer().min(0).optional().allow(null)
}).messages({
  'any.required': 'Config is required',
  'number.integer': 'Expected version must be an integer',
  'number.min': 'Expected version cannot be negative'
});

/**
 * Push Live Validator
 */
const pushLiveSchema = Joi.object({
  // No body required - draftVersionId comes from URL param
  // This is just for future extensibility
}).allow(null);

/**
 * Restore Version Validator
 */
const restoreVersionSchema = Joi.object({
  name: versionNameValidator,
  notes: notesValidator
});

/**
 * Get Version History Validator (Query Params)
 */
const getVersionHistorySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50)
}).messages({
  'number.integer': 'Limit must be an integer',
  'number.min': 'Limit must be at least 1',
  'number.max': 'Limit cannot exceed 100'
});

/**
 * Get Test Config Validator (Query Params)
 */
const getTestConfigSchema = Joi.object({
  source: Joi.string().valid('live', 'draft', 'version').default('live'),
  versionId: Joi.string().pattern(/^(version|draft)-\d{13}-[a-f0-9]{8}$/).when('source', {
    is: 'version',
    then: Joi.required(),
    otherwise: Joi.optional().allow(null)
  })
}).messages({
  'any.only': 'Source must be one of: live, draft, version',
  'string.pattern.base': 'Invalid version ID format',
  'any.required': 'Version ID is required when source=version'
});

// ============================================================================
// VALIDATION MIDDLEWARE FACTORY
// ============================================================================

/**
 * Create validation middleware for Express routes
 * 
 * Usage:
 *   router.post('/draft', validate('body', createDraftSchema), handler);
 * 
 * @param {string} location - Where to find data ('body', 'query', 'params')
 * @param {object} schema - Joi schema to validate against
 * @returns {Function} Express middleware
 */
function validate(location, schema) {
  return (req, res, next) => {
    const data = req[location];
    
    const { error, value } = schema.validate(data, {
      abortEarly: false, // Return all errors, not just first
      stripUnknown: true // Remove unknown keys (security)
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type
      }));
      
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        errors
      });
    }
    
    // Replace req data with validated/sanitized data
    req[location] = value;
    
    next();
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Validators
  validate,
  
  // Schemas
  createDraftSchema,
  saveDraftSchema,
  pushLiveSchema,
  restoreVersionSchema,
  getVersionHistorySchema,
  getTestConfigSchema,
  configValidator,
  
  // Sub-validators
  bookingRuleValidator,
  companyContactValidator,
  linkValidator,
  calculatorValidator,
  
  // Field validators
  versionIdValidator,
  companyIdValidator,
  versionNameValidator,
  notesValidator,
  userEmailValidator
};


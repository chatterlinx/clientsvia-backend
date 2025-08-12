/**
 * Enterprise Booking Flow Configuration Schema
 * Versioned, typed schema with validations and conditional logic
 * Per-company booking blueprint with guardrails
 */

const mongoose = require('mongoose');

// Field validation schema
const bookingFieldSchema = new mongoose.Schema({
    prompt: { 
        type: String, 
        required: true,
        trim: true,
        minlength: 10,
        maxlength: 500 
    },
    name: { 
        type: String, 
        required: true,
        match: /^[a-zA-Z][a-zA-Z0-9_.]*$/,
        maxlength: 100
    },
    type: { 
        type: String, 
        required: true,
        enum: ['string', 'phone', 'email', 'enum', 'boolean', 'date', 'number']
    },
    required: { 
        type: Boolean, 
        default: false 
    },
    validate: { 
        type: String,
        maxlength: 200
    },
    normalize: { 
        type: String,
        maxlength: 50
    },
    options: [{ 
        type: String,
        maxlength: 100
    }],
    requiredIf: { 
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    defaultValue: { 
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    order: { 
        type: Number,
        required: true,
        min: 1
    },
    enabled: { 
        type: Boolean, 
        default: true 
    }
}, { _id: false });

// Enterprise booking flow configuration
const enterpriseBookingFlowSchema = new mongoose.Schema({
    companyId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true,
        ref: 'Company',
        index: true
    },
    version: { 
        type: Number, 
        required: true, 
        default: 1,
        min: 1
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
        default: 'Standard Booking Flow'
    },
    description: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    
    // Core booking fields with enterprise validation
    fields: [bookingFieldSchema],
    
    // Guardrails and enterprise features
    guardrails: {
        requiredFieldEnforcement: { type: Boolean, default: true },
        idempotencyEnabled: { type: Boolean, default: true },
        autoResumeEnabled: { type: Boolean, default: true },
        maxFieldRetries: { type: Number, default: 3, min: 1, max: 10 },
        timeoutPerFieldSeconds: { type: Number, default: 60, min: 10, max: 300 },
        totalFlowTimeoutMinutes: { type: Number, default: 15, min: 5, max: 60 }
    },
    
    // SLA and performance requirements
    sla: {
        offerSlotMs: { type: Number, default: 12000, min: 5000, max: 30000 },
        confirmBookingMs: { type: Number, default: 300000, min: 60000, max: 900000 },
        handoffMs: { type: Number, default: 15000, min: 5000, max: 60000 }
    },
    
    // Conditional logic and branching
    conditionalLogic: {
        enabled: { type: Boolean, default: true },
        rules: [{
            condition: { type: String }, // JSONPath expression
            action: { 
                type: String, 
                enum: ['skip', 'required', 'optional', 'branch'] 
            },
            target: { type: String }, // Field name or flow step
            value: { type: mongoose.Schema.Types.Mixed }
        }]
    },
    
    // Integration settings
    integrations: {
        crmWebhook: { type: String, trim: true },
        calendarSync: { type: Boolean, default: true },
        smsConfirmation: { type: Boolean, default: true },
        emailConfirmation: { type: Boolean, default: true },
        webhookRetries: { type: Number, default: 3, min: 1, max: 5 },
        webhookTimeoutMs: { type: Number, default: 10000, min: 1000, max: 30000 }
    },
    
    // Audit and compliance
    audit: {
        createdBy: { type: String, required: true },
        lastModifiedBy: { type: String, required: true },
        approvedBy: { type: String },
        approvalDate: { type: Date },
        changeReason: { type: String, maxlength: 500 },
        isActive: { type: Boolean, default: true },
        environmentTag: { 
            type: String, 
            enum: ['dev', 'staging', 'production'], 
            default: 'production' 
        }
    },
    
    // Versioning and rollback
    previousVersion: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'EnterpriseBookingFlow' 
    },
    rollbackEnabled: { type: Boolean, default: true },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
enterpriseBookingFlowSchema.index({ companyId: 1, version: -1 });
enterpriseBookingFlowSchema.index({ 'audit.isActive': 1, 'audit.environmentTag': 1 });

// Pre-save middleware for versioning
enterpriseBookingFlowSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Static method to get production-ready default
enterpriseBookingFlowSchema.statics.getProductionDefault = function(companyId) {
    return {
        companyId: companyId,
        version: 1,
        name: 'Enterprise Booking Flow',
        description: 'Production-ready booking flow with full validation and guardrails',
        fields: [
            {
                prompt: "Ok. What's the service address, including city?",
                name: "address.full",
                type: "string",
                required: true,
                validate: "len>=8",
                order: 1
            },
            {
                prompt: "Is there a gate code or special access instruction?",
                name: "address.access",
                type: "string",
                required: false,
                order: 2
            },
            {
                prompt: "Is the number you're calling from the best cell for text updates?",
                name: "contact.phone",
                type: "phone",
                required: true,
                normalize: "+1E164",
                order: 3
            },
            {
                prompt: "What's the best name for the on-site contact?",
                name: "contact.name",
                type: "string",
                required: true,
                order: 4
            },
            {
                prompt: "Do you prefer morning or afternoon?",
                name: "slot.preference",
                type: "enum",
                options: ["morning", "afternoon"],
                required: true,
                order: 5
            },
            {
                prompt: "Any technician preference? Dustin, Marcello, or first available?",
                name: "tech.preference",
                type: "enum",
                options: ["dustin", "marcello", "first_available"],
                required: false,
                order: 6
            },
            {
                prompt: "Will you provide filters, or would you like us to supply them for an additional charge?",
                name: "filters.preference",
                type: "enum",
                options: ["customer_provides", "company_supplies_quote"],
                required: true,
                order: 7
            },
            {
                prompt: "If you'd like us to supply, do you know the filter size and quantity?",
                name: "filters.details",
                type: "string",
                requiredIf: {"filters.preference": "company_supplies_quote"},
                order: 8
            },
            {
                prompt: "Is this a repair issue or a maintenance tune-up?",
                name: "service.type",
                type: "enum",
                options: ["repair", "maintenance"],
                required: true,
                order: 9
            },
            {
                prompt: "Briefly, what's going on with the system?",
                name: "service.note",
                type: "string",
                required: false,
                order: 10
            },
            {
                prompt: "Email for the confirmation (optional).",
                name: "contact.email",
                type: "email",
                required: false,
                order: 11
            },
            {
                prompt: "Do we have permission to text updates to this number?",
                name: "consent.sms",
                type: "boolean",
                required: true,
                order: 12
            }
        ],
        guardrails: {
            requiredFieldEnforcement: true,
            idempotencyEnabled: true,
            autoResumeEnabled: true,
            maxFieldRetries: 3,
            timeoutPerFieldSeconds: 60,
            totalFlowTimeoutMinutes: 15
        },
        sla: {
            offerSlotMs: 12000,
            confirmBookingMs: 300000,
            handoffMs: 15000
        },
        conditionalLogic: {
            enabled: true,
            rules: [
                {
                    condition: "$.filters.preference == 'company_supplies_quote'",
                    action: "required",
                    target: "filters.details"
                }
            ]
        },
        integrations: {
            calendarSync: true,
            smsConfirmation: true,
            emailConfirmation: true,
            webhookRetries: 3,
            webhookTimeoutMs: 10000
        },
        audit: {
            createdBy: 'system',
            lastModifiedBy: 'system',
            isActive: true,
            environmentTag: 'production'
        }
    };
};

// Instance method to validate field data
enterpriseBookingFlowSchema.methods.validateFieldData = function(fieldName, value) {
    const field = this.fields.find(f => f.name === fieldName);
    if (!field) return { valid: false, error: 'Field not found' };
    
    // Type validation
    switch (field.type) {
        case 'phone':
            const phoneRegex = /^\+?[\d\s\-\(\)\.]{10,}$/;
            if (!phoneRegex.test(value)) {
                return { valid: false, error: 'Invalid phone number format' };
            }
            break;
        case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (value && !emailRegex.test(value)) {
                return { valid: false, error: 'Invalid email format' };
            }
            break;
        case 'enum':
            if (!field.options.includes(value)) {
                return { valid: false, error: `Value must be one of: ${field.options.join(', ')}` };
            }
            break;
    }
    
    // Custom validation
    if (field.validate) {
        if (field.validate.startsWith('len>=')) {
            const minLen = parseInt(field.validate.replace('len>=', ''));
            if (value.length < minLen) {
                return { valid: false, error: `Minimum length ${minLen} characters` };
            }
        }
    }
    
    return { valid: true };
};

module.exports = mongoose.model('EnterpriseBookingFlow', enterpriseBookingFlowSchema);

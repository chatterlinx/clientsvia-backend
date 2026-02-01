/**
 * ============================================================================
 * SERVICE CATALOG MODEL - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Global service definitions at the TEMPLATE level. This is the "Service Menu"
 * that defines what services exist in an industry template (e.g., HVAC).
 * 
 * ARCHITECTURE:
 * - Stored per-template (GlobalInstantResponseTemplate)
 * - Contains: service definitions, intent keywords, decline messages
 * - Companies toggle services ON/OFF in their ServiceSwitchboard
 * - Scenario generation respects the catalog (only generates for defined services)
 * 
 * RELATIONSHIP:
 * Template → ServiceCatalog (1:1, embedded or separate collection)
 * Company → ServiceSwitchboard (1:1, toggles per service)
 * 
 * FLOW:
 * 1. Admin defines services in template's Service Catalog
 * 2. Company selects template → inherits all services (with defaults)
 * 3. Company toggles services ON/OFF in their Switchboard
 * 4. Agent runtime checks Switchboard before responding
 * 5. Scenario generator only creates scenarios for enabled services
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * SERVICE DEFINITION SCHEMA
 * One entry per service type (e.g., "duct_cleaning", "commercial_hvac")
 */
const serviceDefinitionSchema = new Schema({
    // ============================================
    // IDENTITY
    // ============================================
    
    serviceKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
        // Stable identifier: "duct_cleaning", "commercial_hvac", "dryer_vent"
        // Used in switchboard, scenario linking, and runtime routing
    },
    
    displayName: {
        type: String,
        required: true,
        trim: true
        // Human-readable: "Duct Cleaning", "Commercial HVAC"
    },
    
    description: {
        type: String,
        trim: true,
        default: ''
        // Admin description for clarity
        // Example: "Air duct cleaning and sanitization services"
    },
    
    category: {
        type: String,
        trim: true,
        default: 'General'
        // Grouping for UI: "Cooling", "Heating", "Specialty", "Commercial"
    },
    
    // ============================================
    // SERVICE TYPE CLASSIFICATION (V1.2)
    // ============================================
    // Determines how agent handles this service at runtime
    
    serviceType: {
        type: String,
        enum: ['work', 'symptom', 'admin'],
        default: 'work'
        // work = Actual service you sell, has scenarios, can book
        // symptom = How customer describes problem, routes to WORK service
        // admin = Operational request, deterministic handler, no scenarios
    },
    
    // ============================================
    // SYMPTOM SERVICE FIELDS (only for serviceType: 'symptom')
    // ============================================
    
    // Which WORK services this symptom can route to (ordered by preference)
    routesTo: {
        type: [String],
        default: []
        // Array of WORK serviceKeys, e.g., ['ac_repair', 'refrigerant_leak_detection']
        // First enabled service in array wins
    },
    
    // How much triage before routing
    triageMode: {
        type: String,
        enum: ['none', 'light', 'full'],
        default: 'light'
        // none = route immediately to first enabled WORK
        // light = ask 1 question, then route (DEFAULT - tight dispatcher)
        // full = ask 2-3 questions for complex/dangerous symptoms
    },
    
    // Triage questions and routing hints
    triagePrompts: [{
        question: {
            type: String,
            trim: true
            // e.g., "Is the unit still running or has it completely shut off?"
        },
        answers: [{
            label: {
                type: String,
                trim: true
                // e.g., "Still running"
            },
            routeHint: {
                type: String,
                trim: true
                // Optional serviceKey to prefer if this answer selected
                // e.g., "refrigerant_leak_detection"
            }
        }]
    }],
    
    // ============================================
    // ADMIN SERVICE FIELDS (only for serviceType: 'admin')
    // ============================================
    // Deterministic handlers - no scenarios, no booking
    
    adminHandler: {
        type: {
            type: String,
            enum: ['transfer', 'message', 'link'],
            default: 'transfer'
            // transfer = connect to human (dispatch, manager, office)
            // message = static response with info
            // link = send a link (payment, portal)
        },
        transferTo: {
            type: String,
            trim: true
            // Department/queue: "dispatch", "manager", "billing"
        },
        message: {
            type: String,
            trim: true
            // What agent says before action
            // e.g., "Let me connect you with our dispatch team..."
        },
        linkUrl: {
            type: String,
            trim: true
            // URL template for link type
            // Can include placeholders: {companyId}, {customerId}
        }
    },
    
    // ============================================
    // DISABLED BEHAVIOR (all service types)
    // ============================================
    // What happens when company disables this service
    
    disabledBehavior: {
        action: {
            type: String,
            enum: ['decline', 'transfer', 'decline_with_alternative'],
            default: 'decline'
        },
        message: {
            type: String,
            trim: true
            // Custom decline message when disabled
        },
        transferTo: {
            type: String,
            trim: true
            // If action is 'transfer', where to send
        }
    },
    
    // ============================================
    // DEFAULT BEHAVIOR
    // ============================================
    
    defaultEnabled: {
        type: Boolean,
        default: true
        // true = Most companies offer this (e.g., AC Repair)
        // false = Niche service, opt-in (e.g., Duct Cleaning)
    },
    
    defaultSource: {
        type: String,
        enum: ['global', 'companyLocal', 'none'],
        default: 'global'
        // Where scenarios come from by default:
        // - global: Use template scenarios
        // - companyLocal: Use company's custom scenarios
        // - none: No scenarios, just decline message
    },
    
    // ============================================
    // INTENT DETECTION
    // ============================================
    // Keywords and phrases to detect when a caller is asking about this service
    
    intentKeywords: {
        type: [String],
        default: []
        // Single words: ["duct", "ducts", "ductwork", "air duct"]
    },
    
    intentPhrases: {
        type: [String],
        default: []
        // Full phrases for higher confidence: 
        // ["clean my ducts", "duct cleaning service", "need ducts cleaned"]
    },
    
    negativeKeywords: {
        type: [String],
        default: []
        // Words that indicate NOT this service (avoid false matches)
        // Example for duct_cleaning: ["duct tape"]
    },
    
    minIntentConfidence: {
        type: Number,
        default: 0.6,
        min: 0,
        max: 1
        // Minimum confidence to trigger service detection
    },
    
    // ============================================
    // DECLINE BEHAVIOR
    // ============================================
    // Used when company disables this service
    
    declineMessage: {
        type: String,
        trim: true,
        default: null
        // Default decline message when disabled
        // Example: "We don't offer duct cleaning, but we can help with AC repair, 
        //           maintenance, or system replacements. What do you need?"
        // null = use generic decline
    },
    
    suggestAlternatives: {
        type: Boolean,
        default: true
        // If true, suggest related services in decline message
    },
    
    alternativeServices: {
        type: [String],
        default: []
        // Service keys to suggest as alternatives
        // Example: ["ac_repair", "maintenance"] for disabled duct_cleaning
    },
    
    // ============================================
    // SCENARIO GENERATION METADATA
    // ============================================
    // Guides GPT-4 when generating scenarios for this service
    
    scenarioHints: {
        // Typical scenario types for this service
        typicalScenarioTypes: {
            type: [String],
            enum: ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'QUOTE', 'FOLLOW_UP'],
            default: ['BOOKING', 'FAQ']
        },
        
        // Target number of scenarios
        targetScenarioCount: {
            type: Number,
            default: 8,
            min: 1,
            max: 20
        },
        
        // Keywords GPT-4 should use in scenarios
        suggestedKeywords: {
            type: [String],
            default: []
        },
        
        // Context/notes for GPT-4
        generationNotes: {
            type: String,
            trim: true,
            default: ''
            // Example: "Include scenarios for residential and light commercial"
        }
    },
    
    // ============================================
    // AUDIT & TRACKING
    // ============================================
    
    isCore: {
        type: Boolean,
        default: false
        // Core services cannot be removed from catalog
        // Example: "general_inquiry", "emergency" are core
    },
    
    sortOrder: {
        type: Number,
        default: 100
        // Display order in UI (lower = first)
    },
    
    createdAt: {
        type: Date,
        default: Date.now
    },
    
    createdBy: {
        type: String,
        trim: true,
        default: 'system'
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    updatedBy: {
        type: String,
        trim: true,
        default: 'system'
    }
    
}, { _id: true });

/**
 * SERVICE CATALOG SCHEMA
 * The full catalog of services for a template
 */
const serviceCatalogSchema = new Schema({
    // ============================================
    // IDENTITY
    // ============================================
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        unique: true
        // One catalog per template
    },
    
    templateName: {
        type: String,
        trim: true
        // Denormalized for faster queries
    },
    
    industryType: {
        type: String,
        trim: true,
        default: 'universal'
        // 'hvac', 'plumbing', 'electrical', 'dental', etc.
    },
    
    // ============================================
    // SERVICES
    // ============================================
    
    services: {
        type: [serviceDefinitionSchema],
        default: []
    },
    
    // ============================================
    // CATALOG METADATA
    // ============================================
    
    version: {
        type: Number,
        default: 1
        // Increment when services are added/removed
    },
    
    lastPublishedAt: {
        type: Date,
        default: null
        // When this catalog was last "published" to companies
    },
    
    // Coverage targets
    coverageTarget: {
        totalScenarios: {
            type: Number,
            default: 200
            // Target total scenarios for this template
        },
        scenariosPerService: {
            type: Number,
            default: 8
            // Average scenarios per service
        }
    },
    
    // ============================================
    // AUDIT
    // ============================================
    
    createdAt: {
        type: Date,
        default: Date.now
    },
    
    createdBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    updatedBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    changeLog: [{
        action: {
            type: String,
            enum: ['service_added', 'service_removed', 'service_updated', 'catalog_created', 'catalog_reset'],
            required: true
        },
        serviceKey: String,
        details: String,
        changedBy: String,
        changedAt: {
            type: Date,
            default: Date.now
        }
    }]
    
}, { 
    timestamps: true,
    collection: 'servicecatalogs'
});

// ============================================
// INDEXES
// ============================================

serviceCatalogSchema.index({ templateId: 1 }, { unique: true });
serviceCatalogSchema.index({ 'services.serviceKey': 1 });
serviceCatalogSchema.index({ industryType: 1 });

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get or create catalog for a template
 */
serviceCatalogSchema.statics.getOrCreateForTemplate = async function(templateId, templateName, industryType) {
    let catalog = await this.findOne({ templateId });
    
    if (!catalog) {
        catalog = new this({
            templateId,
            templateName: templateName || 'Unknown Template',
            industryType: industryType || 'universal',
            services: [],
            version: 1,
            createdBy: 'system'
        });
        await catalog.save();
    }
    
    return catalog;
};

/**
 * Add a service to the catalog
 */
serviceCatalogSchema.statics.addService = async function(templateId, serviceData, addedBy = 'Platform Admin') {
    const catalog = await this.findOne({ templateId });
    if (!catalog) {
        throw new Error('Catalog not found for template');
    }
    
    // Check for duplicate
    const exists = catalog.services.some(s => s.serviceKey === serviceData.serviceKey);
    if (exists) {
        throw new Error(`Service "${serviceData.serviceKey}" already exists in catalog`);
    }
    
    // Add service
    catalog.services.push({
        ...serviceData,
        createdBy: addedBy,
        updatedBy: addedBy,
        createdAt: new Date(),
        updatedAt: new Date()
    });
    
    // Log change
    catalog.changeLog.push({
        action: 'service_added',
        serviceKey: serviceData.serviceKey,
        details: `Added service: ${serviceData.displayName}`,
        changedBy: addedBy,
        changedAt: new Date()
    });
    
    // Keep changelog limited
    if (catalog.changeLog.length > 100) {
        catalog.changeLog = catalog.changeLog.slice(-100);
    }
    
    catalog.version += 1;
    catalog.updatedAt = new Date();
    catalog.updatedBy = addedBy;
    
    await catalog.save();
    return catalog;
};

/**
 * Get service keys for a template
 */
serviceCatalogSchema.statics.getServiceKeys = async function(templateId) {
    const catalog = await this.findOne({ templateId }, 'services.serviceKey services.displayName services.defaultEnabled');
    if (!catalog) return [];
    return catalog.services.map(s => ({
        serviceKey: s.serviceKey,
        displayName: s.displayName,
        defaultEnabled: s.defaultEnabled
    }));
};

/**
 * Check if a service exists in the catalog
 */
serviceCatalogSchema.statics.hasService = async function(templateId, serviceKey) {
    const catalog = await this.findOne({ 
        templateId, 
        'services.serviceKey': serviceKey 
    });
    return !!catalog;
};

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Get a specific service definition
 */
serviceCatalogSchema.methods.getService = function(serviceKey) {
    return this.services.find(s => s.serviceKey === serviceKey);
};

/**
 * Update a service
 */
serviceCatalogSchema.methods.updateService = async function(serviceKey, updates, updatedBy = 'Platform Admin') {
    const serviceIndex = this.services.findIndex(s => s.serviceKey === serviceKey);
    if (serviceIndex === -1) {
        throw new Error(`Service "${serviceKey}" not found`);
    }
    
    // Apply updates
    Object.assign(this.services[serviceIndex], {
        ...updates,
        updatedAt: new Date(),
        updatedBy
    });
    
    // Log change
    this.changeLog.push({
        action: 'service_updated',
        serviceKey,
        details: `Updated service: ${Object.keys(updates).join(', ')}`,
        changedBy: updatedBy,
        changedAt: new Date()
    });
    
    this.version += 1;
    this.updatedAt = new Date();
    this.updatedBy = updatedBy;
    
    await this.save();
    return this;
};

/**
 * Remove a service (unless core)
 */
serviceCatalogSchema.methods.removeService = async function(serviceKey, removedBy = 'Platform Admin') {
    const service = this.services.find(s => s.serviceKey === serviceKey);
    if (!service) {
        throw new Error(`Service "${serviceKey}" not found`);
    }
    
    if (service.isCore) {
        throw new Error(`Cannot remove core service "${serviceKey}"`);
    }
    
    this.services = this.services.filter(s => s.serviceKey !== serviceKey);
    
    // Log change
    this.changeLog.push({
        action: 'service_removed',
        serviceKey,
        details: `Removed service: ${service.displayName}`,
        changedBy: removedBy,
        changedAt: new Date()
    });
    
    this.version += 1;
    this.updatedAt = new Date();
    this.updatedBy = removedBy;
    
    await this.save();
    return this;
};

/**
 * Get coverage statistics
 */
serviceCatalogSchema.methods.getCoverageStats = function() {
    const totalServices = this.services.length;
    const coreServices = this.services.filter(s => s.isCore).length;
    const optionalServices = totalServices - coreServices;
    const defaultEnabled = this.services.filter(s => s.defaultEnabled).length;
    const defaultDisabled = totalServices - defaultEnabled;
    
    return {
        totalServices,
        coreServices,
        optionalServices,
        defaultEnabled,
        defaultDisabled,
        targetScenarios: this.coverageTarget?.totalScenarios || 200,
        averageScenariosPerService: this.coverageTarget?.scenariosPerService || 8
    };
};

// ============================================
// EXPORT
// ============================================

const ServiceCatalog = mongoose.model('ServiceCatalog', serviceCatalogSchema);

module.exports = ServiceCatalog;

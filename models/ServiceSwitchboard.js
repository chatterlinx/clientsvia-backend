/**
 * ============================================================================
 * SERVICE SWITCHBOARD MODEL - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Company-level service toggles. This is the "Control Plane" that each company
 * uses to enable/disable services from the template's Service Catalog.
 * 
 * ARCHITECTURE:
 * - One switchboard per (company + template) pair
 * - References ServiceCatalog for service definitions
 * - Company admins toggle services ON/OFF
 * - Runtime checks this FIRST before routing to scenarios
 * 
 * RELATIONSHIP:
 * ServiceCatalog (template) → defines available services
 * ServiceSwitchboard (company) → enables/disables services
 * 
 * FLOW:
 * 1. Caller intent detected → "duct cleaning"
 * 2. ServiceIntentDetector → identifies serviceKey = "duct_cleaning"
 * 3. Check Switchboard: duct_cleaning.enabled?
 *    - false → Return deterministic decline (no LLM, no drift)
 *    - true → Route to source (global or companyLocal)
 * 4. Scenario matching proceeds normally for enabled services
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * SERVICE TOGGLE SCHEMA
 * Company's override settings for each service
 */
const serviceToggleSchema = new Schema({
    // ============================================
    // IDENTITY
    // ============================================
    
    serviceKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
        // Must match a serviceKey from ServiceCatalog
    },
    
    // ============================================
    // TOGGLE STATE
    // ============================================
    
    enabled: {
        type: Boolean,
        required: true
        // true = company offers this service
        // false = company does NOT offer this service
    },
    
    source: {
        type: String,
        enum: ['global', 'companyLocal', 'none'],
        default: 'global'
        // Where to get scenarios:
        // - global: Template scenarios (default)
        // - companyLocal: Company's custom scenarios
        // - none: No scenarios, just use decline message
    },
    
    // ============================================
    // CUSTOM OVERRIDES
    // ============================================
    
    // Override the catalog's decline message
    customDeclineMessage: {
        type: String,
        trim: true,
        default: null
        // null = use catalog's default decline message
        // Set to customize: "We don't clean ducts, but our partners at XYZ do!"
    },
    
    // Additional keywords specific to this company
    customKeywords: {
        type: [String],
        default: []
        // Extra intent keywords (merged with catalog keywords)
        // Example: ["dryer exhaust"] if company calls it differently
    },
    
    // ============================================
    // SCHEDULING OVERRIDES
    // ============================================
    
    scheduling: {
        // Custom booking rules for this service
        slotDuration: {
            type: Number,
            default: null
            // Minutes per appointment slot (null = use default)
        },
        
        requiresEstimate: {
            type: Boolean,
            default: false
            // If true, don't book directly - schedule estimate first
        },
        
        priority: {
            type: String,
            enum: ['normal', 'urgent', 'emergency'],
            default: 'normal'
            // Affects scheduling priority
        }
    },
    
    // ============================================
    // TRACKING
    // ============================================
    
    // When was this toggle last changed?
    lastModifiedAt: {
        type: Date,
        default: Date.now
    },
    
    lastModifiedBy: {
        type: String,
        trim: true,
        default: 'system'
    },
    
    // Was this inherited from catalog defaults or explicitly set?
    isExplicitlySet: {
        type: Boolean,
        default: false
        // true = company admin explicitly set this
        // false = auto-populated from catalog defaults
    }
    
}, { _id: false });

/**
 * SWITCHBOARD SCHEMA
 * Full company switchboard document
 */
const serviceSwitchboardSchema = new Schema({
    // ============================================
    // IDENTITY
    // ============================================
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true
    },
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true
    },
    
    // Denormalized for faster queries
    companyName: {
        type: String,
        trim: true
    },
    
    templateName: {
        type: String,
        trim: true
    },
    
    // ============================================
    // SERVICE TOGGLES
    // ============================================
    
    services: {
        type: [serviceToggleSchema],
        default: []
    },
    
    // ============================================
    // GLOBAL SWITCHBOARD SETTINGS
    // ============================================
    
    // Master kill switch
    globalEnabled: {
        type: Boolean,
        default: true
        // false = ALL services disabled (emergency override)
    },
    
    // Default decline for any unknown service request
    defaultDeclineMessage: {
        type: String,
        trim: true,
        default: "I'm not sure we offer that service. Let me connect you with someone who can help."
    },
    
    // Default source when not specified
    defaultSource: {
        type: String,
        enum: ['global', 'companyLocal'],
        default: 'global'
    },
    
    // ============================================
    // SYNC STATUS
    // ============================================
    
    // Track sync with catalog
    catalogVersion: {
        type: Number,
        default: 0
        // Matches ServiceCatalog.version
        // If different, switchboard needs sync
    },
    
    lastSyncedAt: {
        type: Date,
        default: null
    },
    
    // Services in catalog but not in switchboard (need review)
    pendingServices: {
        type: [String],
        default: []
        // Service keys that need company decision
    },
    
    // ============================================
    // STATISTICS
    // ============================================
    
    stats: {
        totalServices: { type: Number, default: 0 },
        enabledCount: { type: Number, default: 0 },
        disabledCount: { type: Number, default: 0 },
        globalSourceCount: { type: Number, default: 0 },
        localSourceCount: { type: Number, default: 0 },
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // ============================================
    // AUDIT
    // ============================================
    
    createdAt: {
        type: Date,
        default: Date.now
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    createdBy: {
        type: String,
        trim: true,
        default: 'system'
    },
    
    updatedBy: {
        type: String,
        trim: true,
        default: 'system'
    },
    
    changeLog: [{
        action: {
            type: String,
            enum: [
                'switchboard_created',
                'service_enabled',
                'service_disabled',
                'source_changed',
                'decline_message_updated',
                'synced_from_catalog',
                'bulk_update'
            ],
            required: true
        },
        serviceKey: String,
        oldValue: Schema.Types.Mixed,
        newValue: Schema.Types.Mixed,
        details: String,
        changedBy: String,
        changedAt: {
            type: Date,
            default: Date.now
        }
    }]
    
}, { 
    timestamps: true,
    collection: 'serviceswitchboards'
});

// ============================================
// INDEXES
// ============================================

// Unique constraint: one switchboard per company+template
serviceSwitchboardSchema.index({ companyId: 1, templateId: 1 }, { unique: true });

// Fast lookup by company
serviceSwitchboardSchema.index({ companyId: 1 });

// Fast lookup for stale switchboards
serviceSwitchboardSchema.index({ templateId: 1, catalogVersion: 1 });

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get or create switchboard for company+template
 * Initializes from ServiceCatalog defaults
 */
serviceSwitchboardSchema.statics.getOrCreateForCompany = async function(companyId, templateId, options = {}) {
    const { companyName, templateName, forceRefresh } = options;
    
    let switchboard = await this.findOne({ companyId, templateId });
    
    if (switchboard && !forceRefresh) {
        return switchboard;
    }
    
    // Get the service catalog for this template
    const ServiceCatalog = mongoose.model('ServiceCatalog');
    const catalog = await ServiceCatalog.findOne({ templateId });
    
    if (!switchboard) {
        // Create new switchboard
        switchboard = new this({
            companyId,
            templateId,
            companyName: companyName || 'Unknown Company',
            templateName: templateName || 'Unknown Template',
            services: [],
            catalogVersion: catalog?.version || 0,
            createdBy: 'system'
        });
    }
    
    // Sync from catalog
    if (catalog && catalog.services.length > 0) {
        await switchboard.syncFromCatalog(catalog, 'system');
    }
    
    return switchboard;
};

/**
 * Check if a service is enabled for a company
 * Returns { enabled, source, declineMessage } or null if service not found
 */
serviceSwitchboardSchema.statics.checkService = async function(companyId, templateId, serviceKey) {
    const switchboard = await this.findOne({ companyId, templateId });
    
    if (!switchboard) {
        // No switchboard = use catalog defaults
        const ServiceCatalog = mongoose.model('ServiceCatalog');
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) return null;
        
        const service = catalog.services.find(s => s.serviceKey === serviceKey);
        if (!service) return null;
        
        return {
            enabled: service.defaultEnabled,
            source: service.defaultSource,
            declineMessage: service.declineMessage
        };
    }
    
    // Check master switch
    if (!switchboard.globalEnabled) {
        return {
            enabled: false,
            source: 'none',
            declineMessage: switchboard.defaultDeclineMessage
        };
    }
    
    // Find service toggle
    const toggle = switchboard.services.find(s => s.serviceKey === serviceKey);
    
    if (!toggle) {
        // Not in switchboard = check if it's a new catalog service
        return null;
    }
    
    return {
        enabled: toggle.enabled,
        source: toggle.source,
        declineMessage: toggle.customDeclineMessage || null
    };
};

/**
 * Bulk update services for a company
 */
serviceSwitchboardSchema.statics.bulkUpdateServices = async function(companyId, templateId, updates, updatedBy = 'admin') {
    const switchboard = await this.findOne({ companyId, templateId });
    if (!switchboard) {
        throw new Error('Switchboard not found');
    }
    
    for (const update of updates) {
        await switchboard.setServiceToggle(update.serviceKey, {
            enabled: update.enabled,
            source: update.source,
            customDeclineMessage: update.customDeclineMessage
        }, updatedBy);
    }
    
    return switchboard;
};

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Sync services from catalog
 * Adds new services, preserves existing toggles
 */
serviceSwitchboardSchema.methods.syncFromCatalog = async function(catalog, syncedBy = 'system') {
    const existingKeys = new Set(this.services.map(s => s.serviceKey));
    const catalogKeys = new Set(catalog.services.map(s => s.serviceKey));
    
    let addedCount = 0;
    let removedKeys = [];
    
    // Add new services from catalog
    for (const catalogService of catalog.services) {
        if (!existingKeys.has(catalogService.serviceKey)) {
            this.services.push({
                serviceKey: catalogService.serviceKey,
                enabled: catalogService.defaultEnabled,
                source: catalogService.defaultSource,
                customDeclineMessage: null,
                customKeywords: [],
                isExplicitlySet: false,
                lastModifiedAt: new Date(),
                lastModifiedBy: syncedBy
            });
            addedCount++;
        }
    }
    
    // Mark services that no longer exist in catalog (but don't delete)
    for (const toggle of this.services) {
        if (!catalogKeys.has(toggle.serviceKey)) {
            removedKeys.push(toggle.serviceKey);
        }
    }
    
    // Update sync status
    this.catalogVersion = catalog.version;
    this.lastSyncedAt = new Date();
    this.pendingServices = removedKeys;
    
    // Update stats
    this.updateStats();
    
    // Log change
    if (addedCount > 0 || removedKeys.length > 0) {
        this.changeLog.push({
            action: 'synced_from_catalog',
            details: `Added ${addedCount} services, ${removedKeys.length} services no longer in catalog`,
            changedBy: syncedBy,
            changedAt: new Date()
        });
        
        // Keep changelog limited
        if (this.changeLog.length > 100) {
            this.changeLog = this.changeLog.slice(-100);
        }
    }
    
    this.updatedAt = new Date();
    this.updatedBy = syncedBy;
    
    await this.save();
    return { addedCount, removedKeys };
};

/**
 * Set toggle for a specific service
 */
serviceSwitchboardSchema.methods.setServiceToggle = async function(serviceKey, settings, updatedBy = 'admin') {
    const toggleIndex = this.services.findIndex(s => s.serviceKey === serviceKey);
    
    if (toggleIndex === -1) {
        // Service not in switchboard - add it
        this.services.push({
            serviceKey,
            enabled: settings.enabled ?? true,
            source: settings.source ?? 'global',
            customDeclineMessage: settings.customDeclineMessage ?? null,
            customKeywords: settings.customKeywords ?? [],
            isExplicitlySet: true,
            lastModifiedAt: new Date(),
            lastModifiedBy: updatedBy
        });
    } else {
        // Update existing
        const oldEnabled = this.services[toggleIndex].enabled;
        const oldSource = this.services[toggleIndex].source;
        
        if (settings.enabled !== undefined) this.services[toggleIndex].enabled = settings.enabled;
        if (settings.source !== undefined) this.services[toggleIndex].source = settings.source;
        if (settings.customDeclineMessage !== undefined) this.services[toggleIndex].customDeclineMessage = settings.customDeclineMessage;
        if (settings.customKeywords !== undefined) this.services[toggleIndex].customKeywords = settings.customKeywords;
        
        this.services[toggleIndex].isExplicitlySet = true;
        this.services[toggleIndex].lastModifiedAt = new Date();
        this.services[toggleIndex].lastModifiedBy = updatedBy;
        
        // Log changes
        if (oldEnabled !== settings.enabled) {
            this.changeLog.push({
                action: settings.enabled ? 'service_enabled' : 'service_disabled',
                serviceKey,
                oldValue: oldEnabled,
                newValue: settings.enabled,
                changedBy: updatedBy,
                changedAt: new Date()
            });
        }
        
        if (oldSource !== settings.source) {
            this.changeLog.push({
                action: 'source_changed',
                serviceKey,
                oldValue: oldSource,
                newValue: settings.source,
                changedBy: updatedBy,
                changedAt: new Date()
            });
        }
    }
    
    // Update stats
    this.updateStats();
    
    this.updatedAt = new Date();
    this.updatedBy = updatedBy;
    
    await this.save();
    return this;
};

/**
 * Get a service toggle
 */
serviceSwitchboardSchema.methods.getServiceToggle = function(serviceKey) {
    return this.services.find(s => s.serviceKey === serviceKey);
};

/**
 * Check if a service is enabled
 */
serviceSwitchboardSchema.methods.isServiceEnabled = function(serviceKey) {
    if (!this.globalEnabled) return false;
    const toggle = this.services.find(s => s.serviceKey === serviceKey);
    return toggle ? toggle.enabled : false;
};

/**
 * Update statistics
 */
serviceSwitchboardSchema.methods.updateStats = function() {
    this.stats = {
        totalServices: this.services.length,
        enabledCount: this.services.filter(s => s.enabled).length,
        disabledCount: this.services.filter(s => !s.enabled).length,
        globalSourceCount: this.services.filter(s => s.enabled && s.source === 'global').length,
        localSourceCount: this.services.filter(s => s.enabled && s.source === 'companyLocal').length,
        lastUpdated: new Date()
    };
};

/**
 * Get enabled services (for scenario routing)
 */
serviceSwitchboardSchema.methods.getEnabledServices = function() {
    if (!this.globalEnabled) return [];
    return this.services
        .filter(s => s.enabled)
        .map(s => ({
            serviceKey: s.serviceKey,
            source: s.source,
            customKeywords: s.customKeywords
        }));
};

/**
 * Get disabled services (for decline routing)
 */
serviceSwitchboardSchema.methods.getDisabledServices = function() {
    return this.services
        .filter(s => !s.enabled)
        .map(s => ({
            serviceKey: s.serviceKey,
            customDeclineMessage: s.customDeclineMessage
        }));
};

/**
 * Export switchboard as JSON
 */
serviceSwitchboardSchema.methods.toExport = function() {
    return {
        companyId: this.companyId,
        companyName: this.companyName,
        templateId: this.templateId,
        templateName: this.templateName,
        globalEnabled: this.globalEnabled,
        services: this.services.map(s => ({
            serviceKey: s.serviceKey,
            enabled: s.enabled,
            source: s.source,
            customDeclineMessage: s.customDeclineMessage
        })),
        stats: this.stats,
        catalogVersion: this.catalogVersion,
        lastSyncedAt: this.lastSyncedAt,
        exportedAt: new Date()
    };
};

// ============================================
// EXPORT
// ============================================

const ServiceSwitchboard = mongoose.model('ServiceSwitchboard', serviceSwitchboardSchema);

module.exports = ServiceSwitchboard;

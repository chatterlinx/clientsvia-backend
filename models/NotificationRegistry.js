// ============================================================================
// 📋 NOTIFICATION REGISTRY MODEL
// ============================================================================
// Purpose: Auto-discovery and validation of all notification points in codebase
// 
// Key Features:
// - Tracks every AdminNotificationService.sendAlert() call
// - Records file location (routes/v2twilio.js:234)
// - Validates notification system health
// - Monitors trigger frequency and success rate
// - Enables "green checkmark" validation in UI
//
// How It Works:
// 1. Developer adds: await AdminNotificationService.sendAlert({code: 'X', ...})
// 2. Service auto-registers the code on first call
// 3. Registry tracks: file location, last trigger, validation status
// 4. UI displays all registered notification points with ✅/❌ status
//
// Related Files:
// - services/AdminNotificationService.js (creates/updates registry)
// - public/admin-notification-center.html (displays registry table)
// ============================================================================

const mongoose = require('mongoose');

const notificationRegistrySchema = new mongoose.Schema({
    // ========================================================================
    // NOTIFICATION POINT IDENTIFICATION
    // ========================================================================
    code: { 
        type: String, 
        required: true, 
        unique: true,
        uppercase: true,
        index: true
    }, // 'TWILIO_GREETING_FALLBACK', 'AI_MATCHING_FAILED', etc.
    
    description: String,  // Human-readable description
    category: {
        type: String,
        enum: ['SYSTEM', 'TWILIO', 'AI_AGENT', 'SPAM_FILTER', 'DATABASE', 'API', 'OTHER'],
        default: 'OTHER'
    },
    
    // ========================================================================
    // CODE LOCATION (Auto-detected)
    // ========================================================================
    location: {
        file: String,        // 'routes/v2twilio.js'
        line: Number,        // 234
        function: String,    // 'handleIncomingCall'
        lastDetected: Date
    },
    
    // ========================================================================
    // NOTIFICATION CONFIGURATION
    // ========================================================================
    config: {
        severity: {
            type: String,
            enum: ['CRITICAL', 'WARNING', 'INFO'],
            required: true
        },
        
        channels: {
            sms: { type: Boolean, default: true },
            email: { type: Boolean, default: true },
            call: { type: Boolean, default: false }  // Only for critical level 4+
        },
        
        escalationEnabled: { type: Boolean, default: true },
        
        // Custom escalation intervals (in minutes)
        escalationIntervals: {
            type: [Number],
            default: [30, 30, 30, 15, 15]  // CRITICAL default
        }
    },
    
    // ========================================================================
    // VALIDATION STATUS
    // ========================================================================
    validation: {
        isValid: { type: Boolean, default: false },
        lastChecked: Date,
        errors: [String],
        warnings: [String],
        
        checks: {
            notificationCenterExists: { type: Boolean, default: false },
            adminContactsConfigured: { type: Boolean, default: false },
            smsClientWorking: { type: Boolean, default: false },
            emailClientWorking: { type: Boolean, default: false },
            twilioConfigured: { type: Boolean, default: false }
        }
    },
    
    // ========================================================================
    // TRIGGER STATISTICS
    // ========================================================================
    stats: {
        totalTriggered: { type: Number, default: 0 },
        lastTriggered: Date,
        firstTriggered: Date,
        
        // Last 7 days activity
        recentTriggers: [{
            date: Date,
            count: Number
        }],
        
        // Delivery success metrics
        successRate: { type: Number, default: 0 },  // 0.0 - 1.0
        avgAcknowledgmentTime: Number,              // milliseconds
        
        // Breakdown
        successfulDeliveries: { type: Number, default: 0 },
        failedDeliveries: { type: Number, default: 0 },
        totalAcknowledged: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // METADATA
    // ========================================================================
    registeredAt: { type: Date, default: Date.now },
    registeredBy: {
        type: String,
        default: 'auto'  // 'auto' or developer name
    },
    
    isActive: { type: Boolean, default: true, index: true },
    isDeprecated: { type: Boolean, default: false },
    
    notes: String,
    lastUpdated: { type: Date, default: Date.now }
});

// ============================================================================
// INDEXES
// ============================================================================

notificationRegistrySchema.index({ code: 1 });
notificationRegistrySchema.index({ 'config.severity': 1 });
notificationRegistrySchema.index({ isActive: 1 });
notificationRegistrySchema.index({ 'validation.isValid': 1 });

// ============================================================================
// MIDDLEWARE
// ============================================================================

notificationRegistrySchema.pre('save', function(next) {
    this.lastUpdated = new Date();
    next();
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Register or update a notification point
 */
notificationRegistrySchema.statics.registerOrUpdate = async function(data) {
    const { code, file, line, severity } = data;
    
    const existing = await this.findOne({ code });
    
    if (existing) {
        // Update existing registration
        existing.location = {
            file,
            line,
            lastDetected: new Date()
        };
        existing.stats.lastTriggered = new Date();
        existing.stats.totalTriggered += 1;
        
        if (!existing.stats.firstTriggered) {
            existing.stats.firstTriggered = new Date();
        }
        
        return existing.save();
    } 
        // Create new registration
        return this.create({
            code,
            location: {
                file,
                line,
                lastDetected: new Date()
            },
            config: {
                severity
            },
            stats: {
                totalTriggered: 1,
                firstTriggered: new Date(),
                lastTriggered: new Date()
            }
        });
    
};

/**
 * Get all notification points grouped by category
 */
notificationRegistrySchema.statics.getAllGrouped = async function() {
    const points = await this.find({ isActive: true }).sort({ code: 1 });
    
    const grouped = {
        SYSTEM: [],
        TWILIO: [],
        AI_AGENT: [],
        SPAM_FILTER: [],
        DATABASE: [],
        API: [],
        OTHER: []
    };
    
    points.forEach(point => {
        grouped[point.category].push(point);
    });
    
    return grouped;
};

/**
 * Get validation summary
 */
notificationRegistrySchema.statics.getValidationSummary = async function() {
    const total = await this.countDocuments({ isActive: true });
    const valid = await this.countDocuments({ isActive: true, 'validation.isValid': true });
    const invalid = total - valid;
    
    return {
        total,
        valid,
        invalid,
        percentage: total > 0 ? Math.round((valid / total) * 100) : 0
    };
};

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Validate this notification point configuration
 * Note: Renamed from 'validate' to avoid Mongoose method name collision
 */
notificationRegistrySchema.methods.validateNotificationPoint = async function() {
    const v2Company = require('./v2Company');
    const smsClient = require('../clients/smsClient');
    
    const checks = {
        notificationCenterExists: false,
        adminContactsConfigured: false,
        smsClientWorking: false,
        emailClientWorking: false,
        twilioConfigured: false
    };
    
    const errors = [];
    const warnings = [];
    
    try {
        // Check 1: Notification Center company exists
        const notificationCenter = await v2Company.findOne({
            'metadata.isNotificationCenter': true
        });
        
        if (notificationCenter) {
            checks.notificationCenterExists = true;
        } else {
            errors.push('Notification Center company not found');
        }
        
        // Check 2: Admin contacts configured
        const adminContacts = notificationCenter?.contacts?.filter(
            c => c.type === 'admin-alert' && c.smsNotifications
        ) || [];
        
        if (adminContacts.length > 0) {
            checks.adminContactsConfigured = true;
        } else {
            errors.push('No admin contacts configured');
        }
        
        // Check 3: SMS client configured
        if (smsClient && smsClient.isConfigured && smsClient.isConfigured()) {
            checks.smsClientWorking = true;
        } else {
            errors.push('SMS client not configured');
        }
        
        // Check 4: Twilio configured
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
            checks.twilioConfigured = true;
        } else {
            errors.push('Twilio credentials not configured');
        }
        
        // Check 5: Email client (if implemented)
        // checks.emailClientWorking = true;
        
    } catch (error) {
        errors.push(`Validation error: ${error.message}`);
    }
    
    // Determine if overall valid
    const isValid = checks.notificationCenterExists && 
                   checks.adminContactsConfigured && 
                   checks.smsClientWorking && 
                   checks.twilioConfigured;
    
    // Update validation status
    this.validation = {
        isValid,
        lastChecked: new Date(),
        errors,
        warnings,
        checks
    };
    
    return this.save();
};

/**
 * Update statistics after alert sent
 */
notificationRegistrySchema.methods.updateStats = async function(success, acknowledgmentTime = null) {
    this.stats.totalTriggered += 1;
    this.stats.lastTriggered = new Date();
    
    if (!this.stats.firstTriggered) {
        this.stats.firstTriggered = new Date();
    }
    
    if (success) {
        this.stats.successfulDeliveries += 1;
        if (acknowledgmentTime) {
            this.stats.totalAcknowledged += 1;
            
            // Update average acknowledgment time
            const total = this.stats.avgAcknowledgmentTime || 0;
            const count = this.stats.totalAcknowledged;
            this.stats.avgAcknowledgmentTime = Math.round((total * (count - 1) + acknowledgmentTime) / count);
        }
    } else {
        this.stats.failedDeliveries += 1;
    }
    
    // Calculate success rate
    const totalAttempts = this.stats.successfulDeliveries + this.stats.failedDeliveries;
    if (totalAttempts > 0) {
        this.stats.successRate = this.stats.successfulDeliveries / totalAttempts;
    }
    
    return this.save();
};

module.exports = mongoose.model('NotificationRegistry', notificationRegistrySchema);


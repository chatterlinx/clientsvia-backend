/**
 * ============================================================================
 * ADMIN SETTINGS MODEL - NOTIFICATION PREFERENCES
 * ============================================================================
 * 
 * PURPOSE:
 * Stores admin notification preferences for the Alert Center.
 * Enables SMS + Email alerts when critical issues arise across the platform.
 * 
 * ARCHITECTURE:
 * - Single document (singleton pattern) - only ONE admin settings record
 * - SMS notifications via Twilio REST API (outbound only)
 * - Email notifications via existing email client
 * - Dynamic message templates with variable substitution
 * 
 * NOTIFICATION FLOW:
 * 1. Alert generated (missing variables, errors, etc.)
 * 2. NotificationService checks AdminSettings
 * 3. If enabled, compose message from template
 * 4. Send SMS + Email to admin
 * 5. Admin receives instant notification
 * 
 * FEATURES:
 * - Toggle SMS/Email independently
 * - Customizable message templates
 * - Alert type filtering (only notify on critical, etc.)
 * - Test notification capability
 * - Multiple admin contacts (future)
 */

const mongoose = require('mongoose');

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

const adminSettingsSchema = new mongoose.Schema({
    // SMS Configuration
    sms: {
        enabled: {
            type: Boolean,
            default: false,
            description: 'Enable SMS notifications'
        },
        phoneNumber: {
            type: String,
            default: '',
            trim: true,
            description: 'Admin phone number to receive SMS alerts'
        },
        template: {
            type: String,
            default: '🚨 ALERT: {companyName} needs attention. {alertType}: {message}. Fix now: {fixUrl}',
            description: 'SMS message template with dynamic variables'
        }
    },
    
    // Email Configuration
    email: {
        enabled: {
            type: Boolean,
            default: false,
            description: 'Enable email notifications'
        },
        address: {
            type: String,
            default: '',
            trim: true,
            lowercase: true,
            description: 'Admin email address to receive alerts'
        },
        template: {
            type: String,
            default: '🚨 ALERT: {companyName} needs attention.\n\n{alertType}: {message}\n\nFix now: {fixUrl}',
            description: 'Email message template with dynamic variables'
        },
        subject: {
            type: String,
            default: '🚨 ClientsVia Alert: {companyName} Needs Attention',
            description: 'Email subject template'
        }
    },
    
    // Alert Type Filters
    alertTypes: {
        missingVariables: {
            type: Boolean,
            default: true,
            description: 'Notify on missing variable alerts'
        },
        criticalErrors: {
            type: Boolean,
            default: true,
            description: 'Notify on critical system errors'
        },
        warnings: {
            type: Boolean,
            default: false,
            description: 'Notify on warnings (optional)'
        },
        info: {
            type: Boolean,
            default: false,
            description: 'Notify on info messages (optional)'
        }
    },
    
    // Notification Center Configuration
    notificationCenter: {
        twilio: {
            accountSid: {
                type: String,
                default: '',
                trim: true,
                description: 'Twilio Account SID for SMS notifications'
            },
            authToken: {
                type: String,
                default: '',
                trim: true,
                description: 'Twilio Auth Token (encrypted in production)'
            },
            phoneNumber: {
                type: String,
                default: '',
                trim: true,
                description: 'Twilio phone number (E.164 format)'
            }
        },
        adminContacts: [{
            name: {
                type: String,
                required: true,
                description: 'Admin contact name'
            },
            phone: {
                type: String,
                required: true,
                description: 'Admin phone number (E.164 format)'
            },
            email: {
                type: String,
                default: '',
                description: 'Admin email address (optional)'
            },
            receiveSMS: {
                type: Boolean,
                default: true,
                description: 'Receive SMS alerts'
            },
            receiveEmail: {
                type: Boolean,
                default: false,
                description: 'Receive email alerts'
            },
            receiveCalls: {
                type: Boolean,
                default: true,
                description: 'Receive escalation calls'
            }
        }]
    },
    
    // Metadata
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: String,
        default: 'Admin'
    }
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get admin settings (singleton pattern)
 * Creates default settings if none exist
 */
adminSettingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne();
    
    if (!settings) {
        console.log('📋 [ADMIN SETTINGS] No settings found, creating default...');
        settings = await this.create({});
        console.log('✅ [ADMIN SETTINGS] Default settings created');
    }
    
    return settings;
};

/**
 * Update admin settings
 */
adminSettingsSchema.statics.updateSettings = async function(updates) {
    console.log('📝 [ADMIN SETTINGS] Updating settings...');
    
    let settings = await this.findOne();
    
    if (!settings) {
        settings = await this.create(updates);
        console.log('✅ [ADMIN SETTINGS] Settings created');
    } else {
        Object.assign(settings, updates);
        settings.lastUpdated = new Date();
        await settings.save();
        console.log('✅ [ADMIN SETTINGS] Settings updated');
    }
    
    return settings;
};

/**
 * Check if notifications are enabled for a specific alert type
 */
adminSettingsSchema.statics.shouldNotify = async function(alertType) {
    const settings = await this.getSettings();
    
    // Check if either SMS or Email is enabled
    const hasNotificationEnabled = settings.sms.enabled || settings.email.enabled;
    
    if (!hasNotificationEnabled) {
        return false;
    }
    
    // Check if this alert type should trigger notification
    switch(alertType) {
        case 'missing_variables':
            return settings.alertTypes.missingVariables;
        case 'error':
            return settings.alertTypes.criticalErrors;
        case 'warning':
            return settings.alertTypes.warnings;
        case 'info':
            return settings.alertTypes.info;
        default:
            return false;
    }
};

// ============================================================================
// EXPORT MODEL
// ============================================================================

const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);

module.exports = AdminSettings;


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
const logger = require('../utils/logger.js');


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
        }],
        
        // Escalation Intervals (minutes)
        escalation: {
            CRITICAL: {
                type: [Number],
                default: [30, 30, 30, 15, 15],
                description: 'CRITICAL alert resend intervals in minutes'
            },
            WARNING: {
                type: [Number],
                default: [60, 60, 60],
                description: 'WARNING alert resend intervals in minutes'
            },
            INFO: {
                type: [Number],
                default: [120],
                description: 'INFO alert resend intervals in minutes'
            }
        },
        
        // 📞 TWILIO TEST CONFIGURATION (Same pattern as Global AI Brain)
        // Allows admin to test system via dedicated test phone number
        twilioTest: {
            enabled: {
                type: Boolean,
                default: false,
                description: 'Toggle ON to enable test calls, OFF to disable'
            },
            phoneNumber: {
                type: String,
                trim: true,
                default: '',
                description: 'Test phone number (E.164 format: +15551234567)'
            },
            accountSid: {
                type: String,
                trim: true,
                default: '',
                description: 'Twilio Account SID for test number'
            },
            authToken: {
                type: String,
                trim: true,
                default: '',
                description: 'Twilio Auth Token (store encrypted in production)'
            },
            greeting: {
                type: String,
                trim: true,
                default: 'This is a ClientsVia system check. Your Twilio integration is working correctly. If you can hear this message, voice webhooks are properly configured. Thank you for calling.',
                description: 'Custom greeting spoken when test calls connect'
            },
            lastTestedAt: {
                type: Date,
                description: 'Track when last tested'
            },
            testCallCount: {
                type: Number,
                default: 0,
                description: 'Track how many test calls made'
            },
            notes: {
                type: String,
                trim: true,
                description: 'Admin notes about testing'
            }
        },
        
        // 🔔 NOTIFICATION POLICY - Smart Alert Management
        notificationPolicy: {
            // Severity-based delivery rules
            severityRules: {
                CRITICAL: {
                    sendSMS: { type: Boolean, default: true },
                    sendEmail: { type: Boolean, default: true },
                    logOnly: { type: Boolean, default: false }
                    // System down, database offline, payment failures
                },
                WARNING: {
                    sendSMS: { type: Boolean, default: false },
                    sendEmail: { type: Boolean, default: true },
                    logOnly: { type: Boolean, default: false }
                    // Degraded performance, non-critical failures
                },
                INFO: {
                    sendSMS: { type: Boolean, default: false },
                    sendEmail: { type: Boolean, default: false },
                    logOnly: { type: Boolean, default: true }
                    // Successful operations, health checks passing
                }
            },
            
            // Daily digest email (industry standard)
            dailyDigest: {
                enabled: { type: Boolean, default: true },
                time: { type: String, default: '08:00', description: 'Time in 24hr format (HH:MM)' },
                timezone: { type: String, default: 'America/New_York', description: 'IANA timezone' },
                includeStats: { type: Boolean, default: true },
                includeWarnings: { type: Boolean, default: true },
                includeCritical: { type: Boolean, default: true }
            },
            
            // Quiet hours (respect sleep)
            quietHours: {
                enabled: { type: Boolean, default: true },
                startTime: { type: String, default: '22:00', description: '10 PM' },
                endTime: { type: String, default: '07:00', description: '7 AM' },
                timezone: { type: String, default: 'America/New_York' },
                allowCritical: { type: Boolean, default: true, description: 'Always send CRITICAL even during quiet hours' },
                deferWarnings: { type: Boolean, default: true, description: 'Queue WARNING alerts for morning digest' }
            },
            
            // Smart grouping (prevent alert storms)
            smartGrouping: {
                enabled: { type: Boolean, default: true },
                threshold: { type: Number, default: 3, description: 'Group if 3+ same errors' },
                windowMinutes: { type: Number, default: 15, description: 'Within 15 minute window' },
                groupMessage: { type: String, default: '🚨 {count} {errorCode} failures detected in {window} minutes' }
            }
        }
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
        logger.info('📋 [ADMIN SETTINGS] No settings found, creating default...');
        settings = await this.create({});
        logger.info('✅ [ADMIN SETTINGS] Default settings created');
    }
    
    return settings;
};

/**
 * Update admin settings
 */
adminSettingsSchema.statics.updateSettings = async function(updates) {
    logger.info('📝 [ADMIN SETTINGS] Updating settings...');
    
    let settings = await this.findOne();
    
    if (!settings) {
        settings = await this.create(updates);
        logger.info('✅ [ADMIN SETTINGS] Settings created');
    } else {
        Object.assign(settings, updates);
        settings.lastUpdated = new Date();
        await settings.save();
        logger.info('✅ [ADMIN SETTINGS] Settings updated');
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

/**
 * Get default notification policy
 * Used for "Reset to Defaults" button
 */
adminSettingsSchema.statics.getDefaultNotificationPolicy = function() {
    return {
        severityRules: {
            CRITICAL: {
                sendSMS: true,
                sendEmail: true,
                logOnly: false,
                description: 'System down, database offline, payment failures'
            },
            WARNING: {
                sendSMS: false,
                sendEmail: true,
                logOnly: false,
                description: 'Degraded performance, non-critical failures'
            },
            INFO: {
                sendSMS: false,
                sendEmail: false,
                logOnly: true,
                description: 'Successful operations, health checks passing'
            }
        },
        dailyDigest: {
            enabled: true,
            time: '08:00',
            timezone: 'America/New_York',
            includeStats: true,
            includeWarnings: true,
            includeCritical: true
        },
        quietHours: {
            enabled: true,
            startTime: '22:00',
            endTime: '07:00',
            timezone: 'America/New_York',
            allowCritical: true,
            deferWarnings: true
        },
        smartGrouping: {
            enabled: true,
            threshold: 3,
            windowMinutes: 15,
            groupMessage: '🚨 {count} {errorCode} failures detected in {window} minutes'
        }
    };
};

/**
 * Check if notification should be sent based on severity and policy
 * @param {string} severity - CRITICAL, WARNING, or INFO
 * @returns {Object} { sendSMS: boolean, sendEmail: boolean, logOnly: boolean }
 */
adminSettingsSchema.statics.shouldSendNotification = async function(severity) {
    const settings = await this.getSettings();
    const policy = settings.notificationCenter?.notificationPolicy?.severityRules;
    
    if (!policy || !policy[severity]) {
        // Fallback to conservative defaults if policy not configured
        return {
            sendSMS: severity === 'CRITICAL',
            sendEmail: severity !== 'INFO',
            logOnly: severity === 'INFO'
        };
    }
    
    return {
        sendSMS: policy[severity].sendSMS,
        sendEmail: policy[severity].sendEmail,
        logOnly: policy[severity].logOnly
    };
};

/**
 * Check if we're currently in quiet hours
 * @returns {boolean}
 */
adminSettingsSchema.statics.isQuietHours = async function() {
    const settings = await this.getSettings();
    const quietHours = settings.notificationCenter?.notificationPolicy?.quietHours;
    
    if (!quietHours || !quietHours.enabled) {
        return false;
    }
    
    const now = new Date();
    const timezone = quietHours.timezone || 'America/New_York';
    
    // Convert current time to configured timezone
    const timeStr = now.toLocaleTimeString('en-US', { 
        timeZone: timezone, 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const [startHour, startMin] = quietHours.startTime.split(':').map(Number);
    const [endHour, endMin] = quietHours.endTime.split(':').map(Number);
    const [nowHour, nowMin] = timeStr.split(':').map(Number);
    
    const nowMinutes = nowHour * 60 + nowMin;
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startMinutes > endMinutes) {
        return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }
    
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
};

// ============================================================================
// EXPORT MODEL
// ============================================================================

const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);

module.exports = AdminSettings;


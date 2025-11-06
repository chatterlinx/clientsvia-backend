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
                // System down, database offline, payment failures
                CRITICAL: {
                    sendSMS: { type: Boolean, default: true },
                    sendEmail: { type: Boolean, default: true },
                    logOnly: { type: Boolean, default: false }
                },
                // Degraded performance, non-critical failures
                WARNING: {
                    sendSMS: { type: Boolean, default: false },
                    sendEmail: { type: Boolean, default: true },
                    logOnly: { type: Boolean, default: false }
                },
                // Successful operations, health checks passing
                INFO: {
                    sendSMS: { type: Boolean, default: false },
                    sendEmail: { type: Boolean, default: false },
                    logOnly: { type: Boolean, default: true }
                }
            },
            
            // Daily digest email (industry standard)
            dailyDigest: {
                enabled: { type: Boolean, default: true },
                time: { type: String, default: '08:00' },
                timezone: { type: String, default: 'America/New_York' },
                includeStats: { type: Boolean, default: true },
                includeWarnings: { type: Boolean, default: true },
                includeCritical: { type: Boolean, default: true }
            },
            
            // Quiet hours (respect sleep)
            quietHours: {
                enabled: { type: Boolean, default: true },
                startTime: { type: String, default: '22:00' },
                endTime: { type: String, default: '07:00' },
                timezone: { type: String, default: 'America/New_York' },
                allowCritical: { type: Boolean, default: true },
                deferWarnings: { type: Boolean, default: true }
            },
            
            // Smart grouping (prevent alert storms)
            smartGrouping: {
                enabled: { type: Boolean, default: true },
                threshold: { type: Number, default: 3 },
                windowMinutes: { type: Number, default: 15 },
                groupMessage: { type: String, default: '🚨 {count} {errorCode} failures detected in {window} minutes' }
            }
        }
    },
    
    // ============================================================================
    // 💊 AI GATEWAY HEALTH MONITORING CONFIGURATION (Enterprise-Grade)
    // ============================================================================
    // PURPOSE: Monitor OpenAI, MongoDB, Redis health with configurable auto-ping
    // ARCHITECTURE: Flexible intervals (minutes/hours/days), smart notifications
    // INTEGRATIONS: Notification Center, Alert Rules, Historical Tracking
    // ============================================================================
    aiGatewayHealthCheck: {
        // Enable/Disable auto-ping
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable automatic health checks'
        },
        
        // Check interval configuration
        interval: {
            value: {
                type: Number,
                default: 1,
                min: 1,
                max: 1440, // Max 1 day in any unit
                description: 'Health check interval value'
            },
            unit: {
                type: String,
                enum: ['minutes', 'hours', 'days'],
                default: 'hours',
                description: 'Health check interval unit'
            }
        },
        
        // Notification behavior
        notificationMode: {
            type: String,
            enum: ['never', 'errors_only', 'always'],
            default: 'errors_only',
            description: 'When to send notifications: never (silent), errors_only (default), always (verbose)'
        },
        
        // Timestamps
        lastCheck: {
            type: Date,
            description: 'When the last health check ran (manual or auto)'
        },
        
        nextScheduledCheck: {
            type: Date,
            description: 'When the next auto-check will run'
        },
        
        // Statistics tracking
        stats: {
            totalChecks: {
                type: Number,
                default: 0,
                description: 'Total number of health checks performed'
            },
            healthyChecks: {
                type: Number,
                default: 0,
                description: 'Number of checks where all systems were healthy'
            },
            errorChecks: {
                type: Number,
                default: 0,
                description: 'Number of checks where at least one system had errors'
            },
            lastError: {
                service: {
                    type: String,
                    enum: ['openai', 'mongodb', 'redis', 'tier3'],
                    description: 'Which service had the last error'
                },
                message: {
                    type: String,
                    description: 'Last error message'
                },
                timestamp: {
                    type: Date,
                    description: 'When the last error occurred'
                }
            }
        }
    },
    
    // ============================================================================
    // 🎯 ALERT THRESHOLDS - Configurable Monitoring Limits
    // ============================================================================
    // PURPOSE: Define when health alerts fire to reduce false positives
    // ARCHITECTURE: Per-service thresholds stored in DB, read by HealthMonitor
    // BENEFITS: Adjust in UI without code changes, optimize for environment
    // ============================================================================
    alertThresholds: {
        redis: {
            hitRate: {
                type: Number,
                default: 60,
                min: 30,
                max: 90,
                description: 'Alert if cache hit rate drops below this % (default: 60, lower after restarts)'
            },
            memory: {
                type: Number,
                default: 85,
                min: 50,
                max: 95,
                description: 'Alert if memory usage exceeds this % (default: 85)'
            },
            latency: {
                type: Number,
                default: 200,
                min: 50,
                max: 500,
                description: 'Alert if response time exceeds this in ms (default: 200 - increased for cross-region Redis)'
            }
        }
    },
    
    // ============================================================================
    // 🧠 GLOBAL AI BRAIN TEST CONFIGURATION (NEW - World-Class Refactor)
    // ============================================================================
    // PURPOSE: Single global test console for ALL AI Brain templates
    // ARCHITECTURE: Static config + dynamic template routing
    // BENEFITS: No duplicate phone numbers, persistent UI, clean UX
    // ============================================================================
    globalAIBrainTest: {
        // Test Phone Configuration (GLOBAL - shared across all templates)
        enabled: {
            type: Boolean,
            default: false,
            description: 'Enable/disable test calls globally'
        },
        phoneNumber: {
            type: String,
            trim: true,
            default: '',
            description: 'Global test phone number (E.164: +15551234567) - ONE number for ALL templates'
        },
        accountSid: {
            type: String,
            trim: true,
            default: '',
            description: 'Twilio Account SID for test calls'
        },
        authToken: {
            type: String,
            trim: true,
            default: '',
            description: 'Twilio Auth Token (encrypt in production)'
        },
        greeting: {
            type: String,
            trim: true,
            default: 'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.',
            description: 'Test call greeting (supports {template_name} variable)'
        },
        notes: {
            type: String,
            trim: true,
            default: '',
            description: 'Admin notes about testing setup'
        },
        
        // ROUTING MODE: Template Testing vs Company Testing
        mode: {
            type: String,
            enum: ['template', 'company'],
            default: 'template',
            description: 'Test mode: "template" = test global templates in isolation, "company" = test real company configurations'
        },
        
        // ROUTING: Which template receives test calls (for template mode)
        activeTemplateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GlobalInstantResponseTemplate',
            default: null,
            description: 'Currently active template for test routing (when mode = "template")'
        },
        
        // ROUTING: Which company receives test calls (for company mode)
        testCompanyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'v2Company',
            default: null,
            description: 'Company to test (when mode = "company") - tests REAL production configuration'
        },
        
        // TRACKING: Test call analytics
        lastTestedAt: {
            type: Date,
            description: 'Last time a test call was made'
        },
        testCallCount: {
            type: Number,
            default: 0,
            description: 'Total number of test calls made'
        },
        
        // METADATA
        createdAt: {
            type: Date,
            default: Date.now
        },
        lastUpdatedBy: {
            type: String,
            default: 'Admin',
            description: 'Who last updated this config'
        }
    },
    
    // ============================================================================
    // 🏢 COMPANY TEST MODE (NEW - Production Simulator)
    // ============================================================================
    // PURPOSE: Test REAL company configurations (not just templates)
    // ARCHITECTURE: Developer tests EXACT production setup
    // KEY DIFFERENCE: 
    //   - Global AI Brain Test = Tests templates in isolation
    //   - Company Test Mode = Tests FULL company setup (same as production!)
    // BENEFITS:
    //   - Tests real company Q&A, placeholders, overrides
    //   - Uses same Mongoose + Redis as production
    //   - Uses same v2AIAgentRuntime code path
    //   - 100% guaranteed what you test = what customers get!
    // ============================================================================
    companyTestMode: {
        // Test Phone Configuration
        enabled: {
            type: Boolean,
            default: false,
            description: 'Enable/disable company test mode globally'
        },
        phoneNumber: {
            type: String,
            trim: true,
            default: '',
            description: 'Test phone number for company testing (E.164: +15551234567) - separate from template testing'
        },
        greeting: {
            type: String,
            trim: true,
            default: 'Currently testing {company_name}.',
            maxlength: 500,
            description: 'Greeting message spoken when calling test number. Use {company_name} placeholder.'
        },
        
        // ROUTING: Which COMPANY to test (the key difference!)
        activeCompanyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'v2Company',
            default: null,
            description: 'Currently active company for test routing - loads REAL company from MongoDB!'
        },
        
        // TEST OPTIONS: What to enable during testing
        testOptions: {
            // Enable/disable specific features for focused testing
            enableCompanyQA: {
                type: Boolean,
                default: true,
                description: 'Test company-specific Q&A knowledge base'
            },
            enableTradeQA: {
                type: Boolean,
                default: true,
                description: 'Test trade-specific Q&A knowledge base'
            },
            enableTemplates: {
                type: Boolean,
                default: true,
                description: 'Test instant response templates'
            },
            enable3TierIntelligence: {
                type: Boolean,
                default: true,
                description: 'Test full 3-tier cascade (Tier 1 → 2 → 3)'
            },
            enablePlaceholders: {
                type: Boolean,
                default: true,
                description: 'Test placeholder replacement'
            },
            enablePersonality: {
                type: Boolean,
                default: true,
                description: 'Test personality tone application'
            }
        },
        
        // TRACKING: Test call analytics
        lastTestedAt: {
            type: Date,
            description: 'Last time a company test call was made'
        },
        testCallCount: {
            type: Number,
            default: 0,
            description: 'Total number of company test calls made'
        },
        
        // METADATA
        notes: {
            type: String,
            trim: true,
            default: '',
            description: 'Admin notes about company testing setup'
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        lastUpdatedBy: {
            type: String,
            default: 'Admin',
            description: 'Who last updated this config'
        }
    },
    
    // ============================================================================
    // 🔬 TEST PILOT INTELLIGENCE CONFIGURATION (NEW - Dual 3-Tier System)
    // ============================================================================
    // PURPOSE: Configure 3-Tier Intelligence for Test Pilot testing (NOT production)
    // ARCHITECTURE: Separate from production settings for aggressive learning
    // KEY DIFFERENCE:
    //   - Test Pilot Intelligence = Aggressive learning, higher LLM cost
    //   - Production Intelligence (per-company) = Conservative, cost-optimized
    // BENEFITS:
    //   - Test with aggressive learning to find gaps FAST
    //   - Production uses conservative settings to minimize cost
    //   - Presets prevent human mistakes (Conservative, Balanced, Aggressive, YOLO)
    //   - Safety mechanisms: cost limits, auto-revert, validation
    // ============================================================================
    testPilotIntelligence: {
        // PRESET SELECTION (recommended way to configure)
        preset: {
            type: String,
            enum: ['conservative', 'balanced', 'aggressive', 'yolo'],
            default: 'balanced',
            description: 'Intelligence preset: Conservative (5-8% Tier 3), Balanced (10-15%), Aggressive (20-30%), YOLO (50-70%)'
        },
        
        // THRESHOLDS (customizable if not using preset)
        thresholds: {
            tier1: {
                type: Number,
                min: 0.5,
                max: 0.95,
                default: 0.80,
                description: 'Tier 1 (Rule-Based) confidence threshold (0.50-0.95). Lower = more Tier 2/3 triggers.'
            },
            tier2: {
                type: Number,
                min: 0.3,
                max: 0.80,
                default: 0.60,
                description: 'Tier 2 (Semantic) confidence threshold (0.30-0.80). Lower = more Tier 3 triggers.'
            }
        },
        
        // LLM CONFIGURATION
        llmConfig: {
            model: {
                type: String,
                enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
                default: 'gpt-4o-mini',
                description: 'LLM model for Tier 3: gpt-4o (best quality, $0.10/call), gpt-4o-mini (balanced, $0.04/call), gpt-3.5-turbo (fast, $0.01/call)'
            },
            autoApply: {
                type: String,
                enum: ['manual', 'high-confidence', 'all'],
                default: 'manual',
                description: 'How to handle LLM suggestions: manual (human review), high-confidence (auto-apply 90%+), all (auto-apply everything - risky!)'
            },
            maxCallsPerDay: {
                type: Number,
                default: null,
                description: 'Max Tier 3 LLM calls per day (null = unlimited). Safety limit to prevent cost overruns.'
            },
            contextWindow: {
                type: String,
                enum: ['minimal', 'standard', 'extended', 'maximum'],
                default: 'standard',
                description: 'How much context to send to LLM: minimal (cheap), standard (balanced), extended (detailed), maximum (full history - expensive)'
            }
        },
        
        // COST CONTROLS (safety mechanisms)
        costControls: {
            dailyBudget: {
                type: Number,
                default: null,
                description: 'Daily LLM budget in USD (null = unlimited). System auto-disables Tier 3 if exceeded.'
            },
            perCallLimit: {
                type: Number,
                default: null,
                description: 'Max LLM cost per single call (null = unlimited). Prevents single call from costing too much.'
            },
            alertThreshold: {
                type: Number,
                default: null,
                description: 'Send email alert when daily cost reaches this amount (null = no alerts)'
            }
        },
        
        // TRACKING
        lastUpdated: {
            type: Date,
            default: Date.now,
            description: 'When settings were last changed'
        },
        updatedBy: {
            type: String,
            default: 'Admin',
            description: 'Who last updated settings'
        },
        
        // YOLO MODE AUTO-REVERT (safety mechanism)
        yoloModeActivatedAt: {
            type: Date,
            default: null,
            description: 'When YOLO mode was activated (auto-reverts to Balanced after 24h)'
        },
        
        // TODAY'S COST TRACKING
        todaysCost: {
            amount: {
                type: Number,
                default: 0,
                description: 'Total LLM cost spent today (resets at midnight)'
            },
            date: {
                type: String,
                default: () => new Date().toISOString().split('T')[0], // YYYY-MM-DD
                description: 'Date for cost tracking (resets daily)'
            },
            tier3Calls: {
                type: Number,
                default: 0,
                description: 'Number of Tier 3 LLM calls today'
            }
        }
    },
    
    // ============================================================================
    // GLOBAL PRODUCTION INTELLIGENCE - Platform-Wide Default (NEW)
    // ============================================================================
    // PURPOSE:
    //   - Serves as DEFAULT 3-tier intelligence settings for ALL companies
    //   - Companies inherit from this UNLESS they switch to custom settings
    //   - Used in production for REAL customer calls (not testing)
    // 
    // ARCHITECTURE:
    //   - Companies have flag: useGlobalIntelligence (true/false)
    //   - If true → use this global config
    //   - If false → use company.aiAgentLogic.productionIntelligence
    // 
    // INCLUDES:
    //   - Same settings as per-company intelligence
    //   - Tier thresholds, LLM config, warmup settings
    //   - Changes here affect ALL companies using global
    // ============================================================================
    globalProductionIntelligence: {
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable 3-tier intelligence system platform-wide'
        },
        
        // THRESHOLDS
        thresholds: {
            tier1: {
                type: Number,
                min: 0.5,
                max: 0.95,
                default: 0.80,
                description: 'Tier 1 (Rule-Based) confidence threshold. Lower = more Tier 2/3 triggers.'
            },
            tier2: {
                type: Number,
                min: 0.3,
                max: 0.80,
                default: 0.60,
                description: 'Tier 2 (Semantic) confidence threshold. Lower = more Tier 3 triggers.'
            },
            enableTier3: {
                type: Boolean,
                default: true,
                description: 'Enable Tier 3 (LLM fallback). Turn OFF for 100% free (Tier 1 & 2 only) but may fail on edge cases.'
            }
        },
        
        // LLM CONFIGURATION
        llmConfig: {
            model: {
                type: String,
                enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'],
                default: 'gpt-4o-mini',
                description: 'LLM model for Tier 3: gpt-4o (best, ~$0.10/call), gpt-4o-mini (balanced, ~$0.04/call), gpt-3.5-turbo (fast, ~$0.01/call)'
            },
            maxCostPerCall: {
                type: Number,
                default: 0.10,
                description: 'Max cost per single LLM call (USD). Prevents single call from costing too much.'
            },
            dailyBudget: {
                type: Number,
                default: null,
                description: 'Daily LLM budget in USD (null = unlimited). System auto-pauses Tier 3 if exceeded.'
            }
        },
        
        // SMART WARMUP (Premium Feature)
        smartWarmup: {
            enabled: {
                type: Boolean,
                default: false,
                description: 'Enable smart LLM pre-warming during Tier 2. Premium feature - charges extra for warmup calls.'
            },
            confidenceThreshold: {
                type: Number,
                min: 0.5,
                max: 0.85,
                default: 0.75,
                description: 'Only pre-warm if Tier 2 confidence below this threshold (0.50-0.85). Higher = more selective warmup.'
            },
            dailyBudget: {
                type: Number,
                default: 5.00,
                description: 'Max USD per day for warmup calls. Prevents runaway costs. Default: $5.00/day'
            },
            enablePatternLearning: {
                type: Boolean,
                default: true,
                description: 'Track which query patterns benefit most from warmup. Improves prediction accuracy over time.'
            },
            minimumHitRate: {
                type: Number,
                min: 0.20,
                max: 0.50,
                default: 0.30,
                description: 'Minimum warmup hit rate (0.20-0.50). If hit rate drops below, reduce warmup frequency.'
            },
            alwaysWarmupCategories: {
                type: [String],
                default: [],
                description: 'Category names to ALWAYS warmup (e.g., "Pricing", "Hours"). Useful for critical queries.'
            },
            neverWarmupCategories: {
                type: [String],
                default: [],
                description: 'Category names to NEVER warmup (e.g., "Small Talk"). Saves costs on low-value queries.'
            }
        },
        
        // TRACKING
        lastUpdated: {
            type: Date,
            default: Date.now,
            description: 'When global settings were last changed'
        },
        updatedBy: {
            type: String,
            default: 'Admin',
            description: 'Who last updated global settings'
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


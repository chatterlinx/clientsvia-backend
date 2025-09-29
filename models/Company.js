// models/Company.js
// 🤖 AI ROUTING REFERENCE: Company Q&A system links to this model
// See: /models/knowledge/CompanyQnA.js (companyId field references this model)
// AI Priority #1 knowledge source is company-specific Q&As
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;
// Legacy personality system removed - using modern AI Agent Logic responseCategories

// --- Sub-schema for Address ---
const addressSchema = new mongoose.Schema({
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zip: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'USA' }
}, { _id: false });

// --- Sub-schema for Enterprise Notes ---
const noteSchema = new mongoose.Schema({
    _id: { type: ObjectId, default: () => new mongoose.Types.ObjectId() },
    id: { type: String, required: true }, // Frontend ID for compatibility
    title: { type: String, trim: true, required: true },
    content: { type: String, trim: true, required: true }, // Replaces 'text'
    text: { type: String, trim: true }, // Legacy field for backward compatibility
    category: { type: String, enum: ['general', 'bug', 'feature', 'todo', 'meeting', 'documentation'], default: 'general' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    isPinned: { type: Boolean, default: false },
    tags: [{ type: String, trim: true }],
    author: { type: String, trim: true, default: 'Developer' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// --- Sub-schema for Twilio Phone Number ---
const twilioPhoneNumberSchema = new mongoose.Schema({
    phoneNumber: { type: String, trim: true, required: true },
    friendlyName: { type: String, trim: true, default: 'Unnamed' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    isPrimary: { type: Boolean, default: false }
}, { _id: false });

// --- Sub-schema for Twilio Configuration ---
const twilioConfigSchema = new mongoose.Schema({
    accountSid: { type: String, trim: true, default: null },
    authToken: { type: String, trim: true, default: null },
    apiKey: { type: String, trim: true, default: null },
    apiSecret: { type: String, trim: true, default: null },
    phoneNumber: { type: String, trim: true, default: null }, // Keep for backward compatibility
    phoneNumbers: { type: [twilioPhoneNumberSchema], default: [] } // New multiple phone numbers
}, { _id: false });

// --- Sub-schema for SMS Settings ---
const smsSettingsSchema = new mongoose.Schema({
    jobAlerts: { type: Boolean, default: false },
    customerReplies: { type: Boolean, default: false },
    appointmentReminders: { type: Boolean, default: false }
}, { _id: false });

// V2 DELETED: Legacy Google OAuth schema - using JWT-only authentication system

// V2 DELETED: Legacy integrations schema - HighLevel and Google OAuth eliminated

// --- Sub-schema for Learning Settings ---
const learningSettingsSchema = new mongoose.Schema({
    autoLearning: { type: Boolean, default: true },
    confidenceThreshold: { type: Number, default: 0.8, min: 0, max: 1 },
    maxSuggestionsPerDay: { type: Number, default: 10, min: 1, max: 100 },
    categories: { type: [String], default: ['general', 'pricing', 'services', 'policies'] },
    requireApproval: { type: Boolean, default: true },
    autoApproveHighConfidence: { type: Boolean, default: false },
    dailySummary: { type: Boolean, default: false }
}, { _id: false });

// --- CORRECTED: Sub-schema for AI Settings ---
const elevenLabsSettingsSchema = new mongoose.Schema({
    useOwnApiKey: { type: Boolean, default: false }, // Toggle: false = use ClientsVia global, true = use own API
    apiKey: { type: String, default: '' },
    voiceId: { type: String, trim: true, default: null },
    stability: { type: Number, default: 0.5 },
    similarityBoost: { type: Number, default: 0.7 },
    style: { type: String, trim: true, default: null },
    modelId: { type: String, trim: true, default: null }
}, { _id: false });

// V2 DELETED: Legacy aiSettingsSchema - replaced by aiAgentLogic system
// All AI configuration now handled through aiAgentLogic field with 100% in-house system
const daysOfWeekForOperatingHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const operatingHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } }, { _id: false });
const protocolSchema = new mongoose.Schema({ systemDelay: { type: String, default: '' }, messageTaking: { type: String, default: '' }, callerReconnect: { type: String, default: '' }, whenInDoubt: { type: String, default: '' }, callerFrustration: { type: String, default: '' }, telemarketerFilter: { type: String, default: '' }, behaviorGuidelines: { type: String, default: '' }, bookingConfirmation: { type: String, default: '' }, textToPay: { type: String, default: '' } }, { _id: false });
const dailyServiceHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, startTime: { type: String, default: '00:00' }, endTime: { type: String, default: '23:59' } }, { _id: false });
const schedulingRuleSchema = new mongoose.Schema({ serviceName: { type: String, required: true, trim: true }, schedulingType: { type: String, enum: ['immediate', 'future'], required: true }, futureBookingLeadDays: { type: Number, default: 0 }, dailyServiceHours: { type: [dailyServiceHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({ day: day, enabled: !['Saturday', 'Sunday'].includes(day), startTime: '08:00', endTime: '17:00' })) }, sameDayCutoffTime: { type: String, trim: true, default: "18:00" }, appointmentSlotIncrementMinutes: { type: Number, default: 60 }, roundTo: { type: String, enum: ['hour', 'half', 'none'], default: 'hour' }, initialBufferMinutes: { type: Number, default: 120 }, searchCalendar: { type: String, enum: ['next', 'same'], default: 'next' }, googleCalendarId: { type: String, trim: true, default: null } }, { _id: false }); 
const contactRecipientSchema = new mongoose.Schema({ contact: { type: String, trim: true } }, { _id: false });
const phoneRecipientSchema = new mongoose.Schema({ phoneNumber: { type: String, trim: true } }, { _id: false });
const namedPhoneRecipientSchema = new mongoose.Schema({ name: { type: String, trim: true }, phoneNumber: { type: String, trim: true } }, { _id: false });

// Legacy personality responses schema removed - using aiAgentLogic.responseCategories instead

const agentSetupSchema = new mongoose.Schema({
    agentMode: { type: String, default: 'full', trim: true },
    categories: { type: [String], default: [] },
    companySpecialties: { type: String, default: '', trim: true },
    timezone: { type: String, default: 'America/New_York', trim: true },
    operatingHours: { type: [operatingHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({day: day,enabled: !['Saturday', 'Sunday'].includes(day),start: '09:00',end: '17:00'})) },
    use247Routing: { type: Boolean, default: false },
    afterHoursAction: { type: String, default: 'message', trim: true },
    onCallForwardingNumber: { type: String, default: '', trim: true },
    greetingType: { type: String, enum: ['tts', 'audio'], default: 'tts' },
    greetingAudioUrl: { type: String, default: '', trim: true },
    agentGreeting: { type: String, default: '', trim: true },
    mainAgentScript: { type: String, default: '', trim: true },
    agentClosing: { type: String, default: '', trim: true },
    protocols: { type: protocolSchema, default: () => ({}) },
    textToPayPhoneSource: { type: String, default: 'callerID', trim: true },
    schedulingRules: { type: [schedulingRuleSchema], default: [] },
    callRouting: { type: [namedPhoneRecipientSchema], default: [] },
    afterHoursRouting: { type: [namedPhoneRecipientSchema], default: [] },
    summaryRecipients: { type: [contactRecipientSchema], default: [] },
    afterHoursRecipients: { type: [contactRecipientSchema], default: [] },
    malfunctionForwarding: { type: [phoneRecipientSchema], default: [] },
    malfunctionRecipients: { type: [phoneRecipientSchema], default: [] },
    placeholders: {
        type: [new mongoose.Schema({ name: { type: String, trim: true }, value: { type: String, trim: true } }, { _id: false })],
        default: []
    }
}, { _id: false });

// --- Main Company Schema ---
const companySchema = new mongoose.Schema({
    companyName: { type: String, required: [true, 'Company name is required.'], trim: true },
    
    // New simplified fields for basic company creation
    companyPhone: { type: String, trim: true, default: null }, // Primary company phone number
    companyAddress: { type: String, trim: true, default: null }, // Full address as single string
    
    // Business details fields for Overview tab
    businessPhone: { type: String, trim: true, default: null },
    businessEmail: { type: String, trim: true, default: null, lowercase: true },
    businessWebsite: { type: String, trim: true, default: null },
    businessAddress: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
    serviceArea: { type: String, trim: true, default: null },
    businessHours: { type: String, trim: true, default: null },
    
    // Legacy/detailed fields (now optional - filled in Overview tab)
    ownerName: { type: String, trim: true, default: null }, // Removed required validation
    ownerEmail: { type: String, trim: true, default: null, lowercase: true }, // Removed required validation
    ownerPhone: { type: String, trim: true, default: null },
    contactName: { type: String, trim: true, default: null },
    contactEmail: { type: String, trim: true, default: null, lowercase: true },
    contactPhone: { type: String, trim: true, default: null }, // Removed required validation
    
    // Additional contacts for Overview tab (legacy format)
    additionalContacts: { 
        type: [{
            name: { type: String, trim: true },
            role: { type: String, trim: true },
            email: { type: String, trim: true, lowercase: true },
            phone: { type: String, trim: true }
        }], 
        default: [] 
    },
    
    // Modern contacts format with multiple phones per contact
    contacts: {
        type: [{
            name: { type: String, trim: true },
            role: { type: String, trim: true },
            phones: [{
                type: { type: String, enum: ['cell', 'office', 'landline', 'fax', 'other'], default: 'cell' },
                value: { type: String, trim: true }
            }],
            notes: { type: String, trim: true }
        }],
        default: []
    },
    
    address: { type: addressSchema, default: () => ({}) }, // Detailed address object (optional)
    // 🚀 V2 SYSTEM: tradeTypes removed - use tradeCategories only
    timezone: { type: String, default: 'America/New_York', trim: true },
    
    // Profile completion tracking
    profileComplete: { type: Boolean, default: false }, // Track if detailed info has been added
    
    twilioConfig: { type: twilioConfigSchema, default: () => ({}) },
    smsSettings: { type: smsSettingsSchema, default: () => ({}) },
    // V2 DELETED: Legacy integrations field - HighLevel and Google OAuth eliminated 
    // REMOVED: Legacy aiSettings field - replaced by aiAgentLogic system
    agentSetup: { type: agentSetupSchema, default: () => ({}) },
    aiAgentSetup: { type: mongoose.Schema.Types.Mixed, default: null }, // New AI Agent Setup data
    
    // 🚀 ENTERPRISE AI AGENT SETTINGS - Multi-tenant gold standard
    tradeCategories: { 
        type: [String], 
        default: [],
        index: true
    },
    // 🚨 REMOVED: All LLM settings violate "no external LLM" business rule
    // All AI intelligence is now handled by aiAgentLogic configuration from UI
    
    // 🚨 REMOVED: All intelligence settings now come from aiAgentLogic UI configuration
    // This ensures true multi-tenant isolation and no hardcoded behavior
    
    // 🧠 REMOVED DUPLICATE - This was overwritten by the complete definition below at line 538
    
    bookingFlow: [{
        name: { type: String, required: true },
        prompt: { type: String, required: true },
        required: { type: Boolean, default: true },
        type: { type: String, enum: ['text', 'phone', 'email', 'date', 'notes'], default: 'text' }
    }],
    personnel: [{
        role: { type: String, required: true },
        name: { type: String },
        phone: { type: String },
        email: { type: String },
        hours: { type: Object, default: {} }, // e.g. { "mon-fri": "08:00-18:00" }
        allowDirectTransfer: { type: Boolean, default: true },
        messageOnly: { type: Boolean, default: false }
    }],
    calendars: [{
        trade: { type: String },
        calendarId: { type: String },
        cutoffTime: { type: String, default: '18:00' },
        bufferMinutes: { type: Number, default: 120 },
        slotDuration: { type: Number, default: 60 }
    }],
    messageTemplates: {
        bookingConfirmation: {
            sms: { type: String, default: "You're booked for {{time}} at {{companyName}}." },
            email: { type: String, default: "Hi {{name}}, your booking is confirmed for {{time}}." }
        },
        fallbackMessage: {
            sms: { type: String, default: "Message from customer: {{message}}" },
            email: { type: String, default: "Customer message: {{message}}" }
        }
    },
    
    // V2 DELETED: Legacy enterpriseAgent field - using aiAgentLogic system only
    // Legacy personalityResponses field removed - using aiAgentLogic.responseCategories instead
    learningSettings: { type: learningSettingsSchema, default: () => ({}) },
    
    // Legacy agentPersonalitySettings removed - using aiAgentLogic.personalitySystem instead
    
    // 📚 REMOVED: Legacy hardcoded knowledge settings - All settings now come from aiAgentLogic UI configuration
    // This ensures true multi-tenant isolation where each company configures their own priorities and thresholds
    
    // 🎯 Phase 1: Agent Priority Configuration (Database Model Only)
    agentPriorityConfig: {
        flow: [{
            id: { 
                type: String, 
                required: true,
                enum: ['company-knowledge', 'trade-categories', 'template-intelligence', 'learning-queue', 'emergency-llm']
            },
            priority: { type: Number, required: true, min: 1, max: 10 },
            enabled: { type: Boolean, default: true }
        }],
        settings: {
            knowledgeFirst: { type: Boolean, default: true },
            autoLearning: { type: Boolean, default: true },
            emergencyLLM: { type: Boolean, default: true }
        },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    
    // 🤖 AI Agent Logic Configuration
    aiAgentLogic: {
        // Enable/disable AI Agent Logic system
        enabled: { type: Boolean, default: true },
        
        // Versioning for configuration tracking
        version: { type: Number, default: 1 },
        lastUpdated: { type: Date, default: Date.now },
        
        // 🎯 IN-HOUSE ONLY: Knowledge Source Thresholds
                thresholds: {
                    companyQnA: { type: Number, min: 0, max: 1, default: 0.8 },
                    tradeQnA: { type: Number, min: 0, max: 1, default: 0.75 },
                    templates: { type: Number, min: 0, max: 1, default: 0.7 },
                    inHouseFallback: { type: Number, min: 0, max: 1, default: 0.5 }
                },
                autoOptimization: {
                    enabled: { type: Boolean, default: false },
                    frequency: { 
                        type: String, 
                        enum: ['daily', 'weekly', 'monthly'], 
                        default: 'weekly' 
                    },
                    lastRun: { type: Date, default: null },
                    nextRun: { type: Date, default: null },
                    minCallsRequired: { type: Number, default: 50 }, // Need enough data
                    notifyOnChanges: { type: Boolean, default: true },
                    maxThresholdChange: { type: Number, default: 0.15 }, // Safety limit
                    confidenceRequired: { type: Number, default: 0.7 } // Only auto-adjust if confident
                },
        
        // Memory & Intelligence Settings
        memorySettings: {
            memoryMode: { type: String, enum: ['short', 'conversational', 'persistent'], default: 'conversational' },
            contextRetention: { type: Number, min: 5, max: 120, default: 30 }
        },
        
        // Fallback Behavior Configuration
        fallbackBehavior: {
            rejectLowConfidence: { type: Boolean, default: true },
            escalateOnNoMatch: { type: Boolean, default: true },
            message: { type: String, default: 'I want to make sure I give you accurate information. Let me connect you with a specialist who can help.' }
        },
        
        // V2 DELETED: Legacy knowledgeSourcePriorities array - using V2 object structure instead
        // V2 DELETED: Legacy answerPriorityFlow - using V2 knowledgeSourcePriorities object instead
        
        // Response Categories configuration
        responseCategories: {
            core: {
                type: mongoose.Schema.Types.Mixed,
                default: {
                    'greeting-response': 'Hi {{callerName}}! Thanks for calling {{companyName}}. How can I help you today?',
                    'farewell-response': 'Thanks for calling {{companyName}}! Have a great day!',
                    'transfer-response': 'Let me connect you with {{departmentName}} who can better assist you.',
                    'service-unavailable-response': 'I\'m sorry, {{serviceType}} isn\'t available right now. Can I help with something else?',
                    'hold-response': 'Please hold for just a moment while I look that up for you.',
                    'business-hours-response': 'We\'re open {{businessHours}}. You can also visit our website at {{website}}.',
                    'knowledge-base-error-response': 'I\'m sorry, I\'m having trouble accessing my knowledge base right now. Please try calling back later or visit our website for assistance.',
                        'no-match-response': 'I understand you\'re looking for service. Let me connect you with one of our technicians who can help you right away.',
                        'technical-difficulty-response': 'I apologize, but I\'m having technical difficulties. Please hold while I connect you to someone who can help.',
                        'cant-understand-response': 'I want to make sure I understand what you need help with. Could you tell me a bit more about what\'s going on?',
                        'transfer-unavailable-response': 'I understand you\'re looking for service. Let me connect you with one of our technicians who can help you right away.',
                        'frustrated-caller-response': 'I understand your frustration, and I want to make sure you get the help you need. Let me connect you with one of our experienced technicians.',
                        'gratitude-response': 'You\'re very welcome! I\'m happy to help. What else can I do for you today?',
                        'urgency-response': 'I understand this is urgent. Let me get you connected with our emergency team right away. What\'s the situation?',
                        'connection-trouble-response': 'It sounds like the line is breaking up. Can you still hear me clearly?'
                }
            },
            advanced: {
                type: mongoose.Schema.Types.Mixed,
                default: {
                    'emergency-response': 'This sounds like an emergency. Let me connect you with our emergency team immediately.',
                    'after-hours-response': 'Thanks for calling! We\'re currently closed but will get back to you first thing in the morning.',
                    'appointment-confirmation': 'Perfect! I\'ve scheduled your appointment for {{appointmentTime}} on {{appointmentDate}}.',
                    'scheduling-conflict': 'That time slot isn\'t available. How about {{alternativeTime}} or {{alternativeTime2}}?'
                }
            },
            emotional: {
                type: mongoose.Schema.Types.Mixed,
                default: {
                    'frustrated-customer': 'I completely understand your frustration, and I\'m here to help make this right for you.',
                    'appreciative-response': 'Thank you so much for your patience and for choosing {{companyName}}. We truly appreciate your business!',
                    'problem-resolution': 'Don\'t worry, we\'ve handled this exact situation many times before. I\'ll make sure we get this resolved for you quickly.',
                    'quality-assurance': 'You can count on us to deliver the highest quality service. We stand behind all our work with a 100% satisfaction guarantee.'
                }
            }
        },
        
        // 🚀 ENTERPRISE FEATURES: Real-time Analytics
        analytics: {
            enabled: { type: Boolean, default: true },
            realTimeUpdates: { type: Boolean, default: true },
            retentionDays: { type: Number, default: 90 },
            
            // Metrics tracking
            metrics: {
                callVolume: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 },
                avgResponseTime: { type: Number, default: 0 },
                satisfactionScore: { type: Number, default: 0 }
            },
            
            // Export settings
            autoExports: {
                enabled: { type: Boolean, default: false },
                frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
                format: { type: String, enum: ['csv', 'json', 'pdf'], default: 'csv' },
                recipients: [{ type: String }]
            }
        },
        
        // V2 DELETED: Legacy conversationFlows - enterprise flow designer eliminated
        
        // V2 DELETED: Legacy A/B testing framework - enterprise bloat eliminated
        
        // V2 DELETED: Enterprise personalization engine - hijacking V2 system eliminated
            enabled: { type: Boolean, default: true },
            
            // Performance metrics
            metrics: {
                activeSegments: { type: Number, default: 0 },
                personalizedCalls: { type: Number, default: 0 }, // percentage
                satisfactionBoost: { type: Number, default: 0 }, // percentage
                learningAccuracy: { type: Number, default: 0 } // percentage
            },
            
            // Customer segments
            segments: [{
                id: { type: String, required: true },
                name: { type: String, required: true },
                description: { type: String, default: '' },
                active: { type: Boolean, default: true },
                priority: { type: Boolean, default: false },
                
                // Segment criteria
                criteria: [{
                    field: { type: String, required: true }, // e.g., 'call_count', 'last_call_date', 'satisfaction_score'
                    operator: { type: String, enum: ['equals', 'greater_than', 'less_than', 'contains', 'not_contains'], required: true },
                    value: { type: mongoose.Schema.Types.Mixed, required: true }
                }],
                
                // Segment metrics
                metrics: {
                    members: { type: Number, default: 0 },
                    avgCallTime: { type: Number, default: 0 },
                    avgResponseTime: { type: Number, default: 0 },
                    satisfaction: { type: Number, default: 0 },
                    resolutionRate: { type: Number, default: 0 }
                },
                
                // Personalization rules for this segment
                rules: [{ type: String }],
                
                // Metadata
                createdAt: { type: Date, default: Date.now },
                lastUpdated: { type: Date, default: Date.now }
            }],
            
            // Dynamic personalization rules
            dynamicRules: [{
                id: { type: String, required: true },
                name: { type: String, required: true },
                description: { type: String, default: '' },
                active: { type: Boolean, default: true },
                
                // Rule conditions
                trigger: { type: String, required: true },
                conditions: [{
                    field: { type: String, required: true },
                    operator: { type: String, required: true },
                    value: { type: mongoose.Schema.Types.Mixed, required: true }
                }],
                
                // Rule actions
                actions: [{ type: String, required: true }],
                
                // Rule performance
                performance: {
                    applicationsCount: { type: Number, default: 0 },
                    successRate: { type: Number, default: 0 },
                    improvementPercent: { type: Number, default: 0 }
                },
                
                // Metadata
                createdAt: { type: Date, default: Date.now },
                lastApplied: { type: Date }
            }],
            
            // Predictive insights
            insights: [{
                pattern: { type: String, required: true },
                confidence: { type: Number, required: true, min: 0, max: 100 },
                detectedDays: { type: Number, default: 0 },
                type: { type: String, enum: ['emerging', 'established', 'declining'], default: 'emerging' },
                recommendedAction: { type: String, default: '' },
                detectedAt: { type: Date, default: Date.now }
            }],
            
            // AI recommendations
            recommendations: [{
                id: { type: String, required: true },
                title: { type: String, required: true },
                description: { type: String, default: '' },
                type: { type: String, enum: ['segment-creation', 'rule-modification', 'timing-optimization', 'tone-adjustment'], required: true },
                priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
                
                // Expected impact
                impact: {
                    metric: { type: String, required: true },
                    expectedImprovement: { type: Number, default: 0 },
                    confidence: { type: Number, default: 0, min: 0, max: 100 }
                },
                
                // Implementation status
                status: { type: String, enum: ['pending', 'implemented', 'dismissed'], default: 'pending' },
                implementedAt: { type: Date },
                
                // Metadata
                createdAt: { type: Date, default: Date.now }
            }],
            
            // Privacy and compliance settings
            privacy: {
                dataRetentionDays: { type: Number, default: 90 },
                anonymizationLevel: { type: String, enum: ['none', 'partial', 'full'], default: 'partial' },
                gdprCompliance: { type: Boolean, default: true },
                automaticDeletion: { type: Boolean, default: true },
                
                // Data collection permissions
                permissions: {
                    behavioralPatterns: { type: Boolean, default: true },
                    callHistory: { type: Boolean, default: true },
                    sentimentAnalysis: { type: Boolean, default: true },
                    crmIntegration: { type: Boolean, default: false }
                }
            }
        },
        
        // 📞 Call Transfer & Escalation Configuration
        callTransferConfig: {
            dialOutEnabled: { type: Boolean, default: false },
            dialOutNumber: {
                type: String,
                trim: true,
                default: null,
                validate: {
                    validator: function(v) {
                        // Allow null/empty or valid phone number format
                        return !v || /^\+?[1-9]\d{1,14}$/.test(v.replace(/[\s\-\(\)]/g, ''));
                    },
                    message: 'Please enter a valid phone number (e.g., +1234567890)'
                }
            },
            transferMessage: {
                type: String,
                trim: true,
                default: 'Let me connect you with someone who can better assist you.'
            }
        },

        // 🔑 Configurable Keywords for Intent Detection (Multi-Tenant)
        keywordConfiguration: {
            serviceKeywords: {
                type: [String],
                default: ['service', 'repair', 'fix', 'broken', 'problem', 'issue', 'help']
            },
            bookingKeywords: {
                type: [String], 
                default: ['appointment', 'schedule', 'book', 'visit', 'come out', 'when can you']
            },
            emergencyKeywords: {
                type: [String],
                default: ['emergency', 'urgent', 'asap', 'right now', 'immediately']
            },
            hoursKeywords: {
                type: [String],
                default: ['hours', 'open', 'closed', 'when do you', 'what time']
            },
            tradeSpecificKeywords: {
                type: [String],
                default: [] // Will be populated based on selected trade categories
            }
        },

        // 🚀 ENTERPRISE AI AGENT MANAGEMENT SYSTEM - UNIFIED ARCHITECTURE
        // ================================================================
        // Complete Knowledge Management + Personality + Priorities System
        // Multi-tenant, Redis-cached, sub-50ms performance
        // ================================================================
        
        // 🎯 KNOWLEDGE SOURCE PRIORITIES - THE BRAIN
        knowledgeSourcePriorities: {
            enabled: { type: Boolean, default: true },
            version: { type: Number, default: 1 },
            lastUpdated: { type: Date, default: Date.now },
            
            // Priority Flow Configuration
            priorityFlow: [{
                source: { 
                    type: String, 
                    enum: ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'],
                    required: true 
                },
                priority: { type: Number, min: 1, max: 4, required: true },
                threshold: { type: Number, min: 0, max: 1, required: true },
                enabled: { type: Boolean, default: true },
                fallbackBehavior: { 
                    type: String, 
                    enum: ['continue', 'always_respond'], 
                    default: 'continue' 
                }
            }],
            
            // Default Priority Flow
            _defaultFlow: {
                type: [{
                    source: String,
                    priority: Number,
                    threshold: Number,
                    enabled: Boolean,
                    fallbackBehavior: String
                }],
                default: [
                    { source: 'companyQnA', priority: 1, threshold: 0.8, enabled: true, fallbackBehavior: 'continue' },
                    { source: 'tradeQnA', priority: 2, threshold: 0.75, enabled: true, fallbackBehavior: 'continue' },
                    { source: 'templates', priority: 3, threshold: 0.7, enabled: true, fallbackBehavior: 'continue' },
                    { source: 'inHouseFallback', priority: 4, threshold: 0.5, enabled: true, fallbackBehavior: 'always_respond' }
                ]
            },
            
            // Advanced Priority Settings
            memorySettings: {
                useConversationContext: { type: Boolean, default: true },
                contextWindow: { type: Number, min: 1, max: 10, default: 5 },
                personalizeResponses: { type: Boolean, default: true }
            },
            
            // Fallback Behavior Configuration
            fallbackBehavior: {
                noMatchFound: { 
                    type: String, 
                    enum: ['use_in_house_fallback', 'escalate_immediately'], 
                    default: 'use_in_house_fallback' 
                },
                lowConfidence: { 
                    type: String, 
                    enum: ['escalate_or_fallback', 'use_fallback'], 
                    default: 'escalate_or_fallback' 
                },
                systemError: { 
                    type: String, 
                    enum: ['emergency_fallback', 'escalate_immediately'], 
                    default: 'emergency_fallback' 
                }
            },
            
            // Performance Metrics
            performance: {
                avgResponseTime: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 },
                totalQueries: { type: Number, default: 0 },
                lastOptimized: { type: Date, default: Date.now }
            }
        },

        // 📚 KNOWLEDGE MANAGEMENT SYSTEM - THE DATA
        knowledgeManagement: {
            version: { type: Number, default: 1 },
            lastUpdated: { type: Date, default: Date.now },
            
            // Company Q&A (Priority #1)
            companyQnA: [{
                id: { type: String, required: true },
                question: { type: String, required: true, trim: true },
                answer: { type: String, required: true, trim: true },
                keywords: [{ type: String, trim: true }],
                confidence: { type: Number, min: 0, max: 1, default: 0.8 },
                status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'active' },
                category: { type: String, trim: true, default: 'general' },
                
                // Performance Tracking
                performance: {
                    responseTime: { type: Number, default: 0 },
                    accuracy: { type: Number, default: 0 },
                    usageCount: { type: Number, default: 0 },
                    lastUsed: { type: Date }
                },
                
                // Metadata
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now },
                createdBy: { type: String, default: 'admin' }
            }],
            
            // Trade Q&A (Priority #2)
            tradeQnA: [{
                id: { type: String, required: true },
                question: { type: String, required: true, trim: true },
                answer: { type: String, required: true, trim: true },
                tradeCategory: { type: String, required: true, trim: true },
                keywords: [{ type: String, trim: true }],
                confidence: { type: Number, min: 0, max: 1, default: 0.75 },
                status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'active' },
                isGlobal: { type: Boolean, default: false }, // global vs company-specific
                
                // Performance Tracking
                performance: {
                    responseTime: { type: Number, default: 0 },
                    accuracy: { type: Number, default: 0 },
                    usageCount: { type: Number, default: 0 },
                    lastUsed: { type: Date }
                },
                
                // Metadata
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now },
                source: { type: String, enum: ['company', 'global', 'imported'], default: 'company' }
            }],
            
            // Templates & Keywords (Priority #3)
            templates: [{
                id: { type: String, required: true },
                name: { type: String, required: true, trim: true },
                template: { type: String, required: true, trim: true },
                keywords: [{ type: String, trim: true }],
                category: { 
                    type: String, 
                    enum: ['greeting', 'service', 'booking', 'emergency', 'hours', 'closing'], 
                    required: true 
                },
                confidence: { type: Number, min: 0, max: 1, default: 0.7 },
                status: { type: String, enum: ['active', 'inactive'], default: 'active' },
                
                // Template Variables
                variables: [{
                    name: { type: String, required: true },
                    description: { type: String, default: '' },
                    required: { type: Boolean, default: false }
                }],
                
                // Performance Tracking
                performance: {
                    usageCount: { type: Number, default: 0 },
                    lastUsed: { type: Date }
                },
                
                // Metadata
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now }
            }],
            
            // In-House Fallback System (Priority #4)
            inHouseFallback: {
                enabled: { type: Boolean, default: true },
                
                // Intent Detection Keywords
                serviceKeywords: {
                    type: [String],
                    default: ['service', 'repair', 'fix', 'broken', 'problem', 'issue', 'help', 'maintenance']
                },
                bookingKeywords: {
                    type: [String],
                    default: ['appointment', 'schedule', 'book', 'visit', 'come out', 'when can you', 'available']
                },
                emergencyKeywords: {
                    type: [String],
                    default: ['emergency', 'urgent', 'asap', 'right now', 'immediately', 'broken down']
                },
                hoursKeywords: {
                    type: [String],
                    default: ['hours', 'open', 'closed', 'when do you', 'what time', 'available']
                },
                
                // Fallback Responses
                responses: {
                    service: {
                        type: String,
                        default: 'I understand you need service. Let me connect you with one of our technicians who can help you right away.'
                    },
                    booking: {
                        type: String,
                        default: 'I\'d be happy to help you schedule an appointment. Let me connect you with our scheduling team.'
                    },
                    emergency: {
                        type: String,
                        default: 'This sounds urgent. Let me connect you with our emergency team immediately.'
                    },
                    hours: {
                        type: String,
                        default: 'We\'re available during business hours. Let me connect you with someone who can provide our current schedule.'
                    },
                    general: {
                        type: String,
                        default: 'I want to make sure you get the best help possible. Let me connect you with a specialist.'
                    }
                },
                
                // Performance Tracking
                performance: {
                    totalFallbacks: { type: Number, default: 0 },
                    successRate: { type: Number, default: 0 },
                    avgConfidence: { type: Number, default: 0.5 }
                }
            },
            
            // Knowledge Management Statistics
            statistics: {
                totalEntries: { type: Number, default: 0 },
                activeEntries: { type: Number, default: 0 },
                avgConfidence: { type: Number, default: 0 },
                lastOptimized: { type: Date, default: Date.now }
            }
        },

        // 🎭 WORLD-CLASS AI AGENT PERSONALITY SYSTEM - THE STYLE
        personalitySystem: {
            version: { type: Number, default: 1 },
            lastUpdated: { type: Date, default: Date.now },
            isCustomized: { type: Boolean, default: false },
            safeZoneProfile: { type: String, default: 'enterprise-professional' },
            
            // Core Personality & Voice
            corePersonality: {
                voiceTone: { 
                    type: String, 
                    enum: ['friendly', 'professional', 'authoritative', 'empathetic'], 
                    default: 'friendly' 
                },
                speechPace: { 
                    type: String, 
                    enum: ['slow', 'normal', 'fast'], 
                    default: 'normal' 
                },
                formalityLevel: { 
                    type: String, 
                    enum: ['casual', 'business', 'formal'], 
                    default: 'business' 
                },
                empathyLevel: { 
                    type: Number, 
                    min: 1, 
                    max: 5, 
                    default: 4 
                },
                technicalDepth: { 
                    type: String, 
                    enum: ['simple', 'moderate', 'detailed'], 
                    default: 'moderate' 
                },
                useCustomerName: { type: Boolean, default: true },
                confidenceLevel: { 
                    type: String, 
                    enum: ['humble', 'balanced', 'confident'], 
                    default: 'balanced' 
                }
            },
            
            // Emotional Intelligence & Empathy
            emotionalIntelligence: {
                recognizeEmotions: { type: Boolean, default: true },
                respondToFrustration: { type: Boolean, default: true },
                showEmpathy: { type: Boolean, default: true },
                adaptToMood: { type: Boolean, default: true },
                
                // Emotional Response Phrases
                frustrationPhrases: {
                    type: [String],
                    default: [
                        'I understand your frustration',
                        'I can hear that this is really important to you',
                        'Let me make sure we get this resolved for you'
                    ]
                },
                empathyPhrases: {
                    type: [String],
                    default: [
                        'I completely understand',
                        'That must be really inconvenient',
                        'I can imagine how concerning that would be'
                    ]
                },
                reassurancePhrases: {
                    type: [String],
                    default: [
                        'We\'ll take care of this for you',
                        'You\'re in good hands',
                        'We\'ve handled this many times before'
                    ]
                }
            },
            
            // Advanced Conversation Patterns
            conversationPatterns: {
                // Natural Flow Control
                openingPhrases: {
                    type: [String],
                    default: [
                        'Thanks for calling! How can I help you today?',
                        'Good morning! What can I do for you?',
                        'Hi there! How may I assist you?'
                    ]
                },
                clarifyingQuestions: {
                    type: [String],
                    default: [
                        'Can you tell me a bit more about that?',
                        'Just to make sure I understand...',
                        'What specific issue are you experiencing?'
                    ]
                },
                closingPhrases: {
                    type: [String],
                    default: [
                        'Is there anything else I can help you with?',
                        'Thanks for calling! Have a great day!',
                        'We appreciate your business!'
                    ]
                },
                
                // Intelligent Response Patterns
                fillerPhrases: {
                    type: [String],
                    default: [
                        'Let me check that for you...',
                        'Give me just a moment...',
                        'Let me look into that...'
                    ]
                },
                waitAcknowledgments: {
                    type: [String],
                    default: [
                        'I\'m still here with you',
                        'Just a moment longer...',
                        'Almost got it...'
                    ]
                },
                understandingConfirmation: {
                    type: [String],
                    default: [
                        'So what I\'m hearing is...',
                        'Just to confirm...',
                        'Let me make sure I have this right...'
                    ]
                },
                
                // Response Timing
                responseDelay: {
                    type: String,
                    enum: ['immediate', 'brief', 'thoughtful'],
                    default: 'brief'
                },
                thinkingTime: { type: Number, min: 0, max: 3, default: 1 } // seconds
            },
            
            // Context Memory & Continuity
            contextMemory: {
                memorySpan: {
                    type: String,
                    enum: ['current_call', '24_hours', '1_week', '1_month', 'permanent'],
                    default: 'current_call'
                },
                
                // Customer Preference Memory
                rememberCustomerName: { type: Boolean, default: true },
                rememberPreviousIssues: { type: Boolean, default: true },
                rememberCommunicationStyle: { type: Boolean, default: true },
                
                // Conversation Continuity
                referToPreviousConversations: { type: Boolean, default: false },
                followUpReminders: { type: Boolean, default: false },
                returningCustomerGreeting: { type: Boolean, default: false },
                
                // Context Transition Phrases
                contextTransitions: {
                    type: [String],
                    default: [
                        'I see we spoke before about...',
                        'Following up on our previous conversation...',
                        'I remember you mentioned...'
                    ]
                }
            },
            
            // Proactive Intelligence & Assistance
            proactiveIntelligence: {
                anticipateNeeds: { type: Boolean, default: true },
                offerRelatedHelp: { type: Boolean, default: true },
                preventiveMaintenance: { type: Boolean, default: false },
                seasonalReminders: { type: Boolean, default: false },
                
                // Proactive Assistance Phrases
                suggestionPhrases: {
                    type: [String],
                    default: [
                        'While I have you, you might also want to consider...',
                        'Based on what you\'ve told me, I\'d recommend...',
                        'Many customers in your situation also ask about...'
                    ]
                },
                
                // Error Recovery & Uncertainty
                admitUncertainty: { type: Boolean, default: true },
                escalateWhenUnsure: { type: Boolean, default: true },
                uncertaintyPhrases: {
                    type: [String],
                    default: [
                        'I want to make sure I give you accurate information...',
                        'Let me connect you with someone who specializes in this...',
                        'I\'d rather have an expert confirm this for you...'
                    ]
                },
                
                // Graceful Error Recovery
                errorRecoveryPhrases: {
                    type: [String],
                    default: [
                        'Let me try a different approach...',
                        'I apologize for the confusion...',
                        'Let me get you to the right person...'
                    ]
                }
            },
            
            // System Configuration
            systemConfig: {
                applyToAllResponses: { type: Boolean, default: true },
                overrideKnowledgeBase: { type: Boolean, default: false },
                personalityWeight: { type: Number, min: 0, max: 1, default: 0.7 },
                
                // Performance Settings
                maxPersonalityProcessingTime: { type: Number, default: 200 }, // milliseconds
                fallbackToNeutral: { type: Boolean, default: true },
                
                // Integration Settings
                integrateWithKnowledge: { type: Boolean, default: true },
                adaptToContext: { type: Boolean, default: true },
                maintainConsistency: { type: Boolean, default: true }
            }
        },

        // 🧠 UNIFIED AI AGENT BRAIN - PHASE 1 INTEGRATION
        // Consolidates personality, instant responses, and templates into one cohesive system
        agentBrain: {
            version: { type: Number, default: 1 },
            lastUpdated: { type: Date, default: Date.now },
            
            // 👤 Core Identity (enhanced from personalitySystem)
            identity: {
                companyName: { type: String, trim: true, default: '' },
                role: { type: String, trim: true, default: 'customer service representative' }, // "HVAC receptionist", "Plumbing specialist"
                businessType: { type: String, trim: true, default: '' }, // "HVAC", "Plumbing", "Electrical"
                
                // Core personality settings (mirrors personalitySystem.corePersonality)
                corePersonality: {
                    voiceTone: { 
                        type: String, 
                        enum: ['friendly', 'professional', 'authoritative', 'empathetic'], 
                        default: 'friendly' 
                    },
                    speechPace: { 
                        type: String, 
                        enum: ['slow', 'normal', 'fast'], 
                        default: 'normal' 
                    },
                    formalityLevel: { 
                        type: String, 
                        enum: ['casual', 'business', 'formal'], 
                        default: 'business' 
                    },
                    empathyLevel: { 
                        type: Number, 
                        min: 1, 
                        max: 5, 
                        default: 4 
                    },
                    technicalDepth: { 
                        type: String, 
                        enum: ['simple', 'moderate', 'detailed'], 
                        default: 'moderate' 
                    }
                },
                
                // Conversation settings
                conversationSettings: {
                    useCustomerName: { type: Boolean, default: true },
                    acknowledgeEmotion: { type: Boolean, default: true },
                    mirrorTone: { type: Boolean, default: false },
                    offerReassurance: { type: Boolean, default: true }
                }
            },
            
            // ⚡ Instant Responses (0ms response time)
            instantResponses: [{
                id: { type: String, required: true },
                trigger: [{ type: String, trim: true }], // keywords that trigger this response
                response: { type: String, required: true, trim: true },
                category: { 
                    type: String, 
                    enum: ['greeting', 'emergency', 'common'], 
                    default: 'common' 
                },
                priority: { type: Number, min: 1, max: 10, default: 5 },
                enabled: { type: Boolean, default: true },
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now }
            }],
            
            // 📋 Response Templates (100ms response time) - migrated from knowledgeManagement.templates
            responseTemplates: [{
                id: { type: String, required: true },
                name: { type: String, required: true, trim: true },
                template: { type: String, required: true, trim: true },
                category: { 
                    type: String, 
                    enum: ['service', 'pricing', 'transfer', 'closing', 'greeting', 'emergency'], 
                    required: true 
                },
                keywords: [{ type: String, trim: true }],
                confidence: { type: Number, min: 0, max: 1, default: 0.7 },
                enabled: { type: Boolean, default: true },
                variables: [{
                    name: { type: String, required: true, trim: true },
                    description: { type: String, trim: true, default: '' },
                    required: { type: Boolean, default: false }
                }],
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now }
            }],
            
            // 🎯 Performance Metrics
            performance: {
                instantResponsesUsed: { type: Number, default: 0 },
                templatesUsed: { type: Number, default: 0 },
                avgResponseTime: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 },
                lastOptimized: { type: Date, default: Date.now }
            }
        },

        // 🎤 V2 VOICE SETTINGS - ELEVENLABS INTEGRATION
        // Migrated from legacy aiSettings.elevenLabs to aiAgentLogic.voiceSettings
        voiceSettings: {
            // API Configuration
            apiSource: { 
                type: String, 
                enum: ['clientsvia', 'own'], 
                default: 'clientsvia' 
            },
            apiKey: { 
                type: String, 
                trim: true, 
                default: null // Only used when apiSource = 'own'
            },
            voiceId: { 
                type: String, 
                trim: true, 
                default: null 
            },
            
            // Voice Quality Controls
            stability: { 
                type: Number, 
                min: 0, 
                max: 1, 
                default: 0.5 
            },
            similarityBoost: { 
                type: Number, 
                min: 0, 
                max: 1, 
                default: 0.7 
            },
            styleExaggeration: { 
                type: Number, 
                min: 0, 
                max: 1, 
                default: 0.0 
            },
            
            // Performance & Output
            speakerBoost: { 
                type: Boolean, 
                default: true 
            },
            aiModel: { 
                type: String, 
                enum: ['eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_monolingual_v1'], 
                default: 'eleven_turbo_v2_5' 
            },
            outputFormat: { 
                type: String, 
                enum: ['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_22050', 'pcm_24000'], 
                default: 'mp3_44100_128' 
            },
            streamingLatency: { 
                type: Number, 
                min: 0, 
                max: 4, 
                default: 0 // 0 = best quality, higher = lower latency
            },
            
            // Enterprise Features
            enabled: { 
                type: Boolean, 
                default: true 
            },
            lastUpdated: { 
                type: Date, 
                default: Date.now 
            },
            version: { 
                type: String, 
                default: '2.0' 
            }
        },
        
        // V2 DELETED: Legacy HighLevel integration fields - enterprise bloat eliminated
        // V2 DELETED: Legacy googleOAuth field - using JWT-only authentication system
    notes: { type: [noteSchema], default: [] },
    
    // Booking Scripts Configuration
    bookingScripts: [{
        tradeType: { type: String, required: true, trim: true },
        serviceType: { type: String, required: true, trim: true },
        script: [{ type: String, trim: true }], // Array of script steps
        lastUpdated: { type: Date, default: Date.now },
        isActive: { type: Boolean, default: true }
    }],
    
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    
    // Agent Settings for AI Agent Logic Tab
    agentSettings: {
        useLLM: { type: Boolean, default: true },
        llmModel: { 
            type: String, 
            default: 'gemini-pro',
            enum: ['gemini-pro', 'gpt-4o-mini', 'claude-3-haiku']
        },
        memoryMode: { 
            type: String, 
            enum: ['short', 'conversation'], 
            default: 'short' 
        },
        fallbackThreshold: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.5 
        },
        escalationMode: { 
            type: String, 
            enum: ['ask', 'auto'], 
            default: 'ask' 
        },
        rePromptAfterTurns: { 
            type: Number, 
            min: 1, 
            max: 10, 
            default: 3 
        },
        maxPromptsPerCall: { 
            type: Number, 
            min: 1, 
            max: 10, 
            default: 2 
        },
        firstPromptSoft: { type: Boolean, default: true },
        semanticSearchEnabled: { type: Boolean, default: true },
        confidenceScoring: { type: Boolean, default: true },
        autoLearningQueue: { type: Boolean, default: true }
    }
}, { timestamps: true });

// V2 DELETED: Enterprise AI Intelligence Control Center - massive legacy bloat eliminated

// --- Middleware ---
companySchema.pre('save', function(next) { 
    this.updatedAt = new Date();
    
    // Migrate old phone number to new format if needed
    if (this.twilioConfig && this.twilioConfig.phoneNumber && this.twilioConfig.phoneNumbers.length === 0) {
        this.twilioConfig.phoneNumbers.push({
            phoneNumber: this.twilioConfig.phoneNumber,
            friendlyName: 'Primary Number',
            status: 'active',
            isPrimary: true
        });
    }
    
    next();
});

companySchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: new Date() });
    next();
});

// --- Instance Methods ---
companySchema.methods.migrateTwilioPhoneNumbers = function() {
    if (this.twilioConfig && this.twilioConfig.phoneNumber && this.twilioConfig.phoneNumbers.length === 0) {
        this.twilioConfig.phoneNumbers.push({
            phoneNumber: this.twilioConfig.phoneNumber,
            friendlyName: 'Primary Number',
            status: 'active',
            isPrimary: true
        });
        return true; // Migration occurred
    }
    return false; // No migration needed
};

companySchema.methods.getPrimaryPhoneNumber = function() {
    if (this.twilioConfig && this.twilioConfig.phoneNumbers.length > 0) {
        const primary = this.twilioConfig.phoneNumbers.find(phone => phone.isPrimary && phone.status === 'active');
        return primary ? primary.phoneNumber : this.twilioConfig.phoneNumbers.find(phone => phone.status === 'active')?.phoneNumber;
    }
    return this.twilioConfig?.phoneNumber || null;
};

companySchema.methods.getActivePhoneNumbers = function() {
    if (this.twilioConfig && this.twilioConfig.phoneNumbers.length > 0) {
        return this.twilioConfig.phoneNumbers.filter(phone => phone.status === 'active');
    }
    return this.twilioConfig?.phoneNumber ? [{ phoneNumber: this.twilioConfig.phoneNumber, friendlyName: 'Primary', isPrimary: true }] : [];
};

const Company = mongoose.model('Company', companySchema, 'companiesCollection');
module.exports = Company;

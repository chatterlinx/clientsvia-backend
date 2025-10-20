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

// --- Sub-schema for V2 Notes ---
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
    phoneNumbers: { type: [twilioPhoneNumberSchema], default: [] }, // New multiple phone numbers
    
    // Call Routing Settings (AI Agent Settings tab - Twilio Control Center)
    callRoutingMode: { type: String, enum: ['ai-agent', 'voicemail', 'forward'], default: 'ai-agent' },
    forwardNumber: { type: String, trim: true, default: null },
    recordingEnabled: { type: Boolean, default: true },
    whisperMessage: { type: String, trim: true, default: null },
    
    // Metadata
    lastUpdated: { type: Date, default: Date.now }
}, { _id: false });

// --- Sub-schema for SMS Settings ---
const smsSettingsSchema = new mongoose.Schema({
    jobAlerts: { type: Boolean, default: false },
    customerReplies: { type: Boolean, default: false },
    appointmentReminders: { type: Boolean, default: false }
}, { _id: false });

// --- Sub-schema for Connection Messages (AI Agent Settings - Messages & Greetings tab) ---
const connectionMessagesSchema = new mongoose.Schema({
    // Voice Connection Message
    voice: {
        mode: { type: String, enum: ['prerecorded', 'realtime', 'disabled'], default: 'prerecorded' },
        
        // PRIMARY GREETING TEXT (used by AI Agent Runtime)
        text: { type: String, trim: true, default: null },
        
        // Pre-recorded audio file
        prerecorded: {
            activeFileUrl: { type: String, trim: true, default: null },
            activeFileName: { type: String, trim: true, default: null },
            activeDuration: { type: Number, default: null }, // seconds
            activeFileSize: { type: Number, default: null }, // bytes
            uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'v2User', default: null },
            uploadedAt: { type: Date, default: null }
        },
        
        // Real-time TTS (for TTS generation settings)
        realtime: {
            text: { type: String, trim: true, default: 'Thank you for calling. Please wait a moment while we connect you...' },
            voiceId: { type: String, trim: true, default: null }
        },
        
        // Intelligent Fallback System
        fallback: {
            enabled: { type: Boolean, default: true },
            // Voice fallback (ElevenLabs TTS)
            voiceMessage: { 
                type: String, 
                trim: true, 
                default: "We're experiencing technical difficulties. Please hold while we connect you to our team." 
            },
            // SMS fallback (text customer)
            smsEnabled: { type: Boolean, default: true },
            smsMessage: { 
                type: String, 
                trim: true, 
                default: "Sorry, our voice system missed your call. How can we help you?" 
            },
            // Admin notification
            notifyAdmin: { type: Boolean, default: true },
            adminNotificationMethod: { type: String, enum: ['sms', 'email', 'both'], default: 'sms' },
            adminPhone: { type: String, trim: true, default: null }, // Custom admin phone for notifications
            adminEmail: { type: String, trim: true, default: null }, // Custom admin email for notifications
            adminSmsMessage: {
                type: String,
                trim: true,
                default: "⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately."
            }
        }
    },
    
    // SMS Auto-Reply
    sms: {
        enabled: { type: Boolean, default: false },
        text: { type: String, trim: true, default: 'Thanks for contacting us! Our AI assistant will respond shortly.' },
        
        // Business hours variants
        businessHours: {
            enabled: { type: Boolean, default: false },
            duringHours: { type: String, trim: true, default: 'Thanks for texting! We\'ll respond right away...' },
            afterHours: { type: String, trim: true, default: 'Thanks for texting! We\'re currently closed but will respond first thing...' }
        }
    },
    
    // Web Chat Auto-Reply (future)
    webChat: {
        enabled: { type: Boolean, default: false },
        text: { type: String, trim: true, default: 'Thanks for reaching out! Our AI assistant will respond in a moment...' },
        showTypingIndicator: { type: Boolean, default: true },
        delaySeconds: { type: Number, default: 2 }
    },
    
    // Metadata
    lastUpdated: { type: Date, default: Date.now }
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

// 🔧 CRITICAL FIX: Define aiAgentLogic as a proper Mongoose Schema
// This ensures Mongoose properly tracks and persists nested changes (especially voice Settings)
const aiAgentLogicSchema = new mongoose.Schema({
    // Enable/disable AI Agent Logic system
    enabled: { type: Boolean, default: true },
    
    // Versioning for configuration tracking
    version: { type: Number, default: 1 },
    lastUpdated: { type: Date, default: Date.now },
    
    // ☢️ DEPRECATED: initialGreeting - REMOVED - Use connectionMessages.voice.text instead
    // Located in: AI Agent Settings > Messages & Greetings tab
    
    // 🎯 IN-HOUSE ONLY: Knowledge Source Thresholds
    thresholds: {
        companyQnA: { type: Number, min: 0, max: 1, default: 0.8 },
        tradeQnA: { type: Number, min: 0, max: 1, default: 0.75 },
        templates: { type: Number, min: 0, max: 1, default: 0.7 },
        inHouseFallback: { type: Number, min: 0, max: 1, default: 0.5 }
    },
    
    // Performance metrics
    metrics: {
        totalCalls: { type: Number, default: 0 },
        avgResponseTime: { type: Number, default: 0 },
        successRate: { type: Number, default: 0 }
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
        
        // V2 Features
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
    
    // 🎯 PLACEHOLDERS - Dynamic text replacement in AI responses
    // Location: AI Agent Logic > Placeholders Tab
    // Usage: [Company Name], {Business Hours}, etc. are replaced with actual values
    placeholders: {
        type: [{
            id: { type: String, required: true },
            name: { type: String, required: true, trim: true },
            value: { type: String, required: true, trim: true },
            category: { type: String, default: 'general', trim: true },
            usageCount: { type: Number, default: 0, min: 0 },
            createdAt: { type: Date, default: Date.now },
            updatedAt: { type: Date, default: Date.now }
        }],
        default: []
    }
}, { _id: false });

const agentSetupSchema = new mongoose.Schema({
    agentMode: { type: String, default: 'full', trim: true },
    categories: { type: [String], default: [] },
    companySpecialties: { type: String, default: '', trim: true },
    timezone: { type: String, default: 'America/New_York', trim: true },
    operatingHours: { type: [operatingHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({day: day,enabled: !['Saturday', 'Sunday'].includes(day),start: '09:00',end: '17:00'})) },
    use247Routing: { type: Boolean, default: false },
    afterHoursAction: { type: String, default: 'message', trim: true },
    onCallForwardingNumber: { type: String, default: '', trim: true },
    // ☢️ NUKED: greetingType, greetingAudioUrl, agentGreeting - replaced by aiAgentLogic.initialGreeting
    // ☢️ NUKED: mainAgentScript, agentClosing - legacy agent setup system eliminated
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
    
    // 🚨 Account Status Management - Critical for billing/service control
    accountStatus: {
        status: { 
            type: String, 
            enum: ['active', 'call_forward', 'suspended'], 
            default: 'active',
            index: true 
        },
        callForwardNumber: { type: String, trim: true, default: null }, // Where to forward calls when status is 'call_forward'
        callForwardMessage: { type: String, trim: true, default: null }, // Custom message to play before forwarding (supports {Company Name} placeholder)
        suspendedMessage: { type: String, trim: true, default: null }, // Custom message to play when account is suspended (supports {Company Name} placeholder)
        reason: { type: String, trim: true, default: null }, // Why status was changed (INTERNAL NOTES ONLY - not read to callers)
        changedBy: { type: String, trim: true, default: null }, // Admin/user who made the change
        changedAt: { type: Date, default: null }, // When status was changed
        history: [{
            status: { type: String, enum: ['active', 'call_forward', 'suspended'], required: true },
            callForwardNumber: { type: String, trim: true, default: null },
            callForwardMessage: { type: String, trim: true, default: null },
            suspendedMessage: { type: String, trim: true, default: null },
            reason: { type: String, trim: true, default: null },
            changedBy: { type: String, trim: true, required: true },
            changedAt: { type: Date, default: Date.now, required: true }
        }],
        notes: { type: String, trim: true, default: null } // Additional notes about account status
    },
    
    twilioConfig: { type: twilioConfigSchema, default: () => ({}) },
    connectionMessages: { type: connectionMessagesSchema, default: () => ({}) },
    smsSettings: { type: smsSettingsSchema, default: () => ({}) },
    // V2 DELETED: Legacy integrations field - HighLevel and Google OAuth eliminated 
    // REMOVED: Legacy aiSettings field - replaced by aiAgentLogic system
    agentSetup: { type: agentSetupSchema, default: () => ({}) },
    aiAgentSetup: { type: mongoose.Schema.Types.Mixed, default: null }, // New AI Agent Setup data
    
    // 🚀 V2 AI AGENT SETTINGS - Multi-tenant gold standard
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
    // ☢️ NUCLEAR ELIMINATION: messageTemplates removed - legacy booking templates eliminated
    
    // V2 DELETED: Legacy v2Agent field - using aiAgentLogic system only
    // Legacy personalityResponses field removed - using aiAgentLogic.responseCategories instead
    learningSettings: { type: learningSettingsSchema, default: () => ({}) },
    
    // Legacy agentPersonalitySettings removed - using aiAgentLogic.personalitySystem instead
    
    // 📚 REMOVED: Legacy hardcoded knowledge settings - All settings now come from aiAgentLogic UI configuration
    // This ensures true multi-tenant isolation where each company configures their own priorities and thresholds
    
    // ☢️ NUCLEAR ELIMINATION: agentPriorityConfig removed - legacy priority system eliminated
    
    // 🤖 AI Agent Logic Configuration
    // 🔧 CRITICAL FIX: Using proper schema reference instead of inline object  
    aiAgentLogic: {
        type: aiAgentLogicSchema,
        default: () => ({})
    },
    
    // ============================================================================
    // 🚀 AI AGENT SETTINGS - REFERENCE-BASED TEMPLATE SYSTEM
    // ============================================================================
    // PURPOSE: Multi-template support with smart placeholder management
    // ARCHITECTURE: References Global AI Brain templates (not clones)
    // BENEFITS: 10x smaller DB, 5x faster queries, auto-updates propagate
    // ============================================================================
    aiAgentSettings: {
        // -------------------------------------------------------------------
        // TEMPLATE REFERENCES - Multi-template support
        // -------------------------------------------------------------------
        // Companies can reference multiple templates (e.g., Plumbing + Electrical)
        // Templates are NOT cloned - just referenced by ID
        // Updates to Global AI Brain propagate instantly to all companies
        templateReferences: [{
            templateId: { 
                type: String, 
                required: true,
                trim: true
                // References GlobalInstantResponseTemplate._id
            },
            enabled: { 
                type: Boolean, 
                default: true 
            },
            priority: { 
                type: Number, 
                default: 1,
                min: 1
                // Lower number = higher priority (1 = search first)
                // Used for scenario matching when multiple templates exist
            },
            clonedAt: { 
                type: Date, 
                default: Date.now 
            }
        }],
        
        // -------------------------------------------------------------------
        // VARIABLE DEFINITIONS - Auto-detected placeholders from templates
        // -------------------------------------------------------------------
        // Generated by PlaceholderScanService.scanCompany()
        // Smart metadata: type inference, categorization, examples
        variableDefinitions: [{
            key: { 
                type: String, 
                required: true,
                trim: true
                // Normalized placeholder key (e.g., "companyName")
            },
            label: { 
                type: String, 
                required: true
                // Human-readable label (e.g., "Company Name")
            },
            description: { 
                type: String, 
                default: ''
                // Help text for admin (e.g., "Enter your full business name")
            },
            type: { 
                type: String, 
                enum: ['text', 'tel', 'email', 'url', 'currency', 'number', 'multiline'],
                default: 'text'
                // Smart type inference from placeholder name
            },
            category: { 
                type: String, 
                default: 'General'
                // Auto-categorization: Company Info, Contact, Pricing, etc.
            },
            required: { 
                type: Boolean, 
                default: false
                // Critical fields (companyName, phone, email) marked required
            },
            example: { 
                type: String, 
                default: ''
                // Example value to guide admin
            },
            usageCount: { 
                type: Number, 
                default: 0,
                min: 0
                // How many times placeholder appears in scenarios
            },
            deprecated: { 
                type: Boolean, 
                default: false
                // Marked true if placeholder removed from template but value kept
            }
        }],
        
        // -------------------------------------------------------------------
        // VARIABLES - Company-specific values for placeholders
        // -------------------------------------------------------------------
        // Key-value map: { "companyName": "Tesla Air", "phone": "+1-555-1234" }
        // Admin fills these in Variables tab
        // AI runtime replaces {companyName} with actual value
        variables: {
            type: Map,
            of: String,
            default: () => new Map()
        },
        
        // -------------------------------------------------------------------
        // CONFIGURATION ALERT - Dashboard TO-DO system
        // -------------------------------------------------------------------
        // Generated when required variables are missing
        // Displayed in Dashboard TO-DO widget
        // Auto-clears when all required fields filled
        configurationAlert: {
            type: { 
                type: String, 
                enum: ['missing_variables', 'template_outdated', 'configuration_incomplete'],
                default: 'missing_variables'
            },
            severity: { 
                type: String, 
                enum: ['info', 'warning', 'error'],
                default: 'warning'
            },
            message: { 
                type: String, 
                default: ''
                // Human-readable alert message
            },
            missingVariables: [{
                key: { type: String },
                label: { type: String },
                type: { type: String },
                category: { type: String }
            }],
            createdAt: { 
                type: Date, 
                default: Date.now 
            }
        },
        
        // -------------------------------------------------------------------
        // FILLER WORDS - AI Agent runtime word filtering
        // -------------------------------------------------------------------
        // Filler words (inherited from template + custom additions)
        // HybridScenarioSelector strips these from user input before matching
        fillerWords: {
            inherited: { 
                type: [String], 
                default: [] 
                // From active templates (read-only, auto-synced)
            },
            custom: { 
                type: [String], 
                default: [] 
                // Company-specific additions (editable via AiCore Filler Filter)
            },
            
            // Scan history for audit trail
            scanHistory: [{
                scanDate: { type: Date, required: true },
                templatesScanned: [{ 
                    templateId: { type: String, trim: true },
                    templateName: { type: String, trim: true },
                    categoriesCount: { type: Number, default: 0 },
                    scenariosCount: { type: Number, default: 0 },
                    fillersFound: { type: Number, default: 0 },
                    fillerWords: { type: [String], default: [] }
                }],
                totalFillersFound: { type: Number, default: 0 },
                newFillersAdded: { type: Number, default: 0 },
                newFillers: { type: [String], default: [] },
                status: { type: String, enum: ['success', 'no_templates', 'no_fillers', 'error'], default: 'success' },
                message: { type: String, trim: true },
                triggeredBy: { type: String, enum: ['manual', 'auto'], default: 'manual' }
            }]
        },
        
        // -------------------------------------------------------------------
        // METADATA - Tracking and debugging
        // -------------------------------------------------------------------
        lastScanDate: { 
            type: Date, 
            default: null
            // Last time PlaceholderScanService scanned this company
        },
        lastUpdated: { 
            type: Date, 
            default: Date.now
            // Last time any aiAgentSettings field was modified
        }
    },
    
    // OLD INLINE DEFINITIONS BELOW THIS LINE ARE NOW OBSOLETE - TO BE REMOVED
    // The schema is now properly defined above as aiAgentLogicSchema
    /*
        // Enable/disable AI Agent Logic system
        enabled: { type: Boolean, default: true },
        
        // Versioning for configuration tracking
        version: { type: Number, default: 1 },
        lastUpdated: { type: Date, default: Date.now },
        
        // ☢️ DEPRECATED: initialGreeting - REMOVED - Use connectionMessages.voice.text instead
        // Located in: AI Agent Settings > Messages & Greetings tab
        
        // 🎯 IN-HOUSE ONLY: Knowledge Source Thresholds
                thresholds: {
                    companyQnA: { type: Number, min: 0, max: 1, default: 0.8 },
                    tradeQnA: { type: Number, min: 0, max: 1, default: 0.75 },
                    templates: { type: Number, min: 0, max: 1, default: 0.7 },
                    inHouseFallback: { type: Number, min: 0, max: 1, default: 0.5 }
                },
                // ☢️ NUCLEAR ELIMINATION: autoOptimization removed - legacy optimization system eliminated
        
        // ☢️ NUCLEAR ELIMINATION: memorySettings and fallbackBehavior removed - legacy behavior systems eliminated
        
        // V2 DELETED: Legacy knowledgeSourcePriorities array - using V2 object structure instead
        // V2 DELETED: Legacy answerPriorityFlow - using V2 knowledgeSourcePriorities object instead
        
        // ☢️ NUCLEAR ELIMINATION: responseCategories removed - massive legacy response templates eliminated
        
        // ☢️ NUCLEAR ELIMINATION: analytics removed - legacy analytics system eliminated
        
        // V2 DELETED: Legacy conversationFlows - v2 flow designer eliminated
        
        // V2 DELETED: Legacy A/B testing framework - v2 bloat eliminated
        
        // ☢️ NUCLEAR ELIMINATION: V2 personalization engine eliminated
            
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
        
        // 🗑️ DELETED: quickVariables field - Replaced by aiAgentLogic.placeholders
        
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

        // 🚀 V2 AI AGENT MANAGEMENT SYSTEM - UNIFIED ARCHITECTURE
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
            safeZoneProfile: { type: String, default: 'v2-professional' },
            
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
                
                // V2 Features
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
            }
    */ // ← End of OLD inline aiAgentLogic definition (now obsolete)
        
    // V2 DELETED: Legacy HighLevel integration fields - v2 bloat eliminated
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
    
    // 🗑️ SOFT DELETE SYSTEM - Admin Cleanup Center
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'v2User', default: null },
    deleteReason: { type: String, trim: true, default: null },
    deleteNotes: { type: String, trim: true, default: null },
    autoPurgeAt: { type: Date, default: null, index: true }, // Auto-purge 30 days after soft delete
    
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
    },
    
    // AI AGENT SETTINGS - NEW ISOLATED SYSTEM (100% separate from AI Agent Logic)
    // Purpose: Company-specific configuration for cloned Global AI Brain templates
    // Location: AI Agent Settings tab (isolated from legacy AI Agent Logic)
    // Architecture: Template inheritance + company customization
    configuration: {
        // Template tracking
        clonedFrom: { type: ObjectId, ref: 'GlobalInstantResponseTemplate', default: null },
        clonedVersion: { type: String, default: null },
        clonedAt: { type: Date, default: null },
        lastSyncedAt: { type: Date, default: null },
        lastUpdatedAt: { type: Date, default: null },
        
        // Variables (company-specific data like {companyName}, {hvacServiceCall}, etc.)
        variables: {
            type: Map,
            of: String,
            default: {}
        },
        
        // Filler words (inherited from template + custom additions)
        fillerWords: {
            inherited: { type: [String], default: [] }, // From template (read-only)
            custom: { type: [String], default: [] }, // Company additions (editable)
            
            // Scan history for audit trail
            scanHistory: [{
                scanDate: { type: Date, required: true },
                templatesScanned: [{ 
                    templateId: { type: String, trim: true },
                    templateName: { type: String, trim: true },
                    categoriesCount: { type: Number, default: 0 },
                    scenariosCount: { type: Number, default: 0 },
                    fillersFound: { type: Number, default: 0 },
                    fillerWords: { type: [String], default: [] }
                }],
                totalFillersFound: { type: Number, default: 0 },
                newFillersAdded: { type: Number, default: 0 },
                newFillers: { type: [String], default: [] },
                status: { type: String, enum: ['success', 'no_templates', 'no_fillers', 'error'], default: 'success' },
                message: { type: String, trim: true },
                triggeredBy: { type: String, enum: ['manual', 'auto'], default: 'manual' }
            }]
        },
        
        // Urgency keywords (inherited from template + custom additions)
        // CRITICAL: Used by HybridScenarioSelector for emergency detection
        urgencyKeywords: {
            inherited: [{
                word: { type: String, lowercase: true, trim: true },
                weight: { type: Number, min: 0.1, max: 0.5 },
                category: { type: String, trim: true }
            }], // From template (read-only)
            custom: [{
                word: { type: String, lowercase: true, trim: true },
                weight: { type: Number, min: 0.1, max: 0.5 },
                category: { type: String, trim: true }
            }] // Company additions (editable)
        },
        
        // Customization tracking
        customization: {
            hasCustomVariables: { type: Boolean, default: false },
            hasCustomFillerWords: { type: Boolean, default: false },
            lastCustomizedAt: { type: Date, default: null }
        },
        
        // Readiness tracking (for Go Live feature)
        readiness: {
            lastCalculatedAt: { type: Date, default: null },
            score: { type: Number, default: 0, min: 0, max: 100 },
            canGoLive: { type: Boolean, default: false },
            isLive: { type: Boolean, default: false },
            goLiveAt: { type: Date, default: null },
            goLiveBy: { type: String, default: null }, // userId who triggered go-live
            components: {
                variables: { type: mongoose.Schema.Types.Mixed, default: {} },
                fillerWords: { type: mongoose.Schema.Types.Mixed, default: {} },
                scenarios: { type: mongoose.Schema.Types.Mixed, default: {} },
                voice: { type: mongoose.Schema.Types.Mixed, default: {} },
                testCalls: { type: mongoose.Schema.Types.Mixed, default: {} }
            }
        },
        
        // Test calls tracking
        testCallsMade: { type: Number, default: 0 }
    },
    
    // ============================================================================
    // 🧠 AI KNOWLEDGEBASE - PERFORMANCE MONITORING
    // ============================================================================
    // PURPOSE: Track AI knowledge gaps and resolved issues
    // ARCHITECTURE: Action items for admin based on low-confidence calls
    // ============================================================================
    aiKnowledgebase: {
        // Resolved issues (to prevent re-showing)
        resolvedIssues: [{
            question: { type: String, required: true, trim: true },
            resolvedAt: { type: Date, default: Date.now },
            resolvedBy: { type: String, trim: true, default: 'admin' },
            actionTaken: { type: String, trim: true, default: 'Marked as resolved' }
        }]
    },
    
    // ============================================================================
    // 🚫 CALL FILTERING - SPAM & SECURITY
    // ============================================================================
    // PURPOSE: Spam detection, robocall blocking, blacklist/whitelist
    // ARCHITECTURE: Integrated with SmartCallFilter service
    // ============================================================================
    callFiltering: {
        // Enable/disable filtering
        enabled: { type: Boolean, default: true },
        
        // Company-specific blacklist
        blacklist: [{
            phoneNumber: { type: String, required: true, trim: true },
            addedAt: { type: Date, default: Date.now },
            addedBy: { type: String, trim: true, default: 'admin' },
            reason: { type: String, trim: true, default: null },
            status: { 
                type: String, 
                enum: ['active', 'removed'], 
                default: 'active' 
            }
        }],
        
        // Company-specific whitelist (always allow)
        whitelist: [{
            phoneNumber: { type: String, required: true, trim: true },
            addedAt: { type: Date, default: Date.now },
            addedBy: { type: String, trim: true, default: 'admin' },
            reason: { type: String, trim: true, default: null }
        }],
        
        // Filter settings
        settings: {
            blockKnownSpam: { type: Boolean, default: true },      // Use GlobalSpamDatabase
            blockHighFrequency: { type: Boolean, default: true },  // Rate limiting
            blockRobocalls: { type: Boolean, default: true },      // Pattern detection
            blockInvalidNumbers: { type: Boolean, default: true }, // Format validation
            frequencyThreshold: { type: Number, default: 5 },      // Calls per 10 min
            notifyOnBlock: { type: Boolean, default: false }       // Email/SMS notification
        },
        
        // Statistics
        stats: {
            totalBlocked: { type: Number, default: 0 },
            lastBlockedAt: { type: Date, default: null }
        }
    }
}, { timestamps: true });

// V2 DELETED: V2 AI Intelligence Control Center - massive legacy bloat eliminated

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

// --- Soft Delete Middleware ---
// Auto-exclude deleted companies from queries unless explicitly requested
companySchema.pre(/^find/, function(next) {
    // Skip if this is a special query that wants deleted companies
    if (this.getOptions().includeDeleted) {
        return next();
    }
    
    // Auto-add isDeleted filter to exclude deleted companies
    const filter = this.getFilter();
    if (filter.isDeleted === undefined) {
        this.where({ isDeleted: { $ne: true } });
    }
    
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

// models/Company.js
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;
const { defaultResponses } = require('../utils/personalityResponses_enhanced');

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

// --- CORRECTED: Sub-schema for Google OAuth Tokens & Settings ---
const googleOAuthSchema = new mongoose.Schema({
    isAuthorized: { type: Boolean, default: false },
    googleAccountEmail: { type: String, trim: true, default: null },
    accessToken: { type: String, trim: true, default: null },
    refreshToken: { type: String, trim: true, default: null },
    expiryDate: { type: Number, default: null }, // Using Number for epoch milliseconds
    lastAuthError: { type: String, default: null },
    isEnabled: { type: Boolean, default: false } // Master switch for this integration
}, { _id: false });

// --- CORRECTED: Sub-schema for Integrations ---
const integrationsSchema = new mongoose.Schema({
    highlevelApiKey: { type: String, trim: true, default: null },
    highlevelCalendarId: { type: String, trim: true, default: null },
    googleOAuth: { type: googleOAuthSchema, default: () => ({}) }
}, { _id: false });

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
    apiKey: { type: String, default: '' },
    voiceId: { type: String, trim: true, default: null },
    stability: { type: Number, default: 0.5 },
    similarityBoost: { type: Number, default: 0.7 },
    style: { type: String, trim: true, default: null },
    modelId: { type: String, trim: true, default: null }
}, { _id: false });

const aiSettingsSchema = new mongoose.Schema({
    model: { type: String, default: 'gemini-1.5-pro', trim: true },
    personality: { type: String, default: 'friendly', trim: true },
    googleVoice: { type: String, default: 'en-US-Standard-A', trim: true },
    voicePitch: { type: Number, default: 0 },
    voiceSpeed: { type: Number, default: 1 },
    responseLength: { type: String, default: 'concise', trim: true },
    knowledgeBaseSource: { type: String, default: '', trim: true },
    escalationKeywords: { type: String, default: '', trim: true },
    sentimentAnalysis: { type: Boolean, default: false },
    dataLogging: { type: Boolean, default: true },
    proactiveOutreach: { type: Boolean, default: false },
    llmFallbackEnabled: { type: Boolean, default: true }, // Enable LLM by default for intelligent responses
    customEscalationMessage: {
        type: String,
        default: 'I understand you have a question I haven\'t been able to answer directly. Let me connect you with one of our specialists who can provide you with the exact information you need.',
        trim: true
    },
    ttsProvider: { type: String, default: 'elevenlabs', trim: true }, // Default to ElevenLabs for better voice quality
    elevenLabs: { type: elevenLabsSettingsSchema, default: () => ({}) },
    twilioSpeechConfidenceThreshold: { type: Number, default: 0.4 }, // Lower threshold for better speech recognition
    fuzzyMatchThreshold: { type: Number, default: 0.3 }, // Better Q&A matching for all companies
    ttsPitch: { type: Number, default: 0 },
    ttsSpeed: { type: Number, default: 1 },
    bargeIn: { type: Boolean, default: false }, // Let agent finish speaking for natural conversation flow
    humanLikeFillers: { type: Boolean, default: false },
    fillerPhrases: {
        type: [String],
        default: [
            'Let me check that...',
            'Alright, just a moment...'
        ]
    },
    maxRepeats: { type: Number, default: 3 },
    repeatEscalationMessage: {
        type: String,
        default: "I'm having trouble understanding. Let me connect you to a team member."
    },
    debugMode: { type: Boolean, default: false },
    twilioVoice: { type: String, default: 'alice', trim: true }, // Consistent fallback voice
    conversationContextTracking: { type: Boolean, default: true }, // Track conversation flow better
    preventRepetitiveQuestions: { type: Boolean, default: true }, // Prevent asking same questions
    
    // 🧠 AI Intelligence Engine Settings
    semanticKnowledge: {
        enabled: { type: Boolean, default: true },
        confidenceThreshold: { type: Number, default: 0.87, min: 0, max: 1 }
    },
    contextualMemory: {
        enabled: { type: Boolean, default: true },
        personalizationLevel: { type: String, default: 'medium', enum: ['low', 'medium', 'high'] },
        memoryRetentionHours: { type: Number, default: 24 }
    },
    dynamicReasoning: {
        enabled: { type: Boolean, default: true },
        useReActFramework: { type: Boolean, default: true },
        maxReasoningSteps: { type: Number, default: 3 }
    },
    smartEscalation: {
        enabled: { type: Boolean, default: true },
        sentimentTrigger: { type: Boolean, default: true },
        contextualHandoffs: { type: Boolean, default: true }
    },
    continuousLearning: {
        autoUpdateKnowledge: { type: Boolean, default: true },
        optimizeResponsePatterns: { type: Boolean, default: true },
        abTestStrategies: { type: Boolean, default: false },
        realTimeOptimization: { type: Boolean, default: true },
        predictiveIntentAnalysis: { type: Boolean, default: false }
    },
    performanceBenchmarks: {
        targetConfidenceRate: { type: Number, default: 0.87 },
        targetResponseTime: { type: Number, default: 1.8 },
        targetEscalationRate: { type: Number, default: 0.12 }
    }
}, { _id: false });

// --- Sub-schema for Agent Setup ---
const daysOfWeekForOperatingHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const operatingHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } }, { _id: false });
const protocolSchema = new mongoose.Schema({ systemDelay: { type: String, default: '' }, messageTaking: { type: String, default: '' }, callerReconnect: { type: String, default: '' }, whenInDoubt: { type: String, default: '' }, callerFrustration: { type: String, default: '' }, telemarketerFilter: { type: String, default: '' }, behaviorGuidelines: { type: String, default: '' }, bookingConfirmation: { type: String, default: '' }, textToPay: { type: String, default: '' } }, { _id: false });
const dailyServiceHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, startTime: { type: String, default: '00:00' }, endTime: { type: String, default: '23:59' } }, { _id: false });
const schedulingRuleSchema = new mongoose.Schema({ serviceName: { type: String, required: true, trim: true }, schedulingType: { type: String, enum: ['immediate', 'future'], required: true }, futureBookingLeadDays: { type: Number, default: 0 }, dailyServiceHours: { type: [dailyServiceHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({ day: day, enabled: !['Saturday', 'Sunday'].includes(day), startTime: '08:00', endTime: '17:00' })) }, sameDayCutoffTime: { type: String, trim: true, default: "18:00" }, appointmentSlotIncrementMinutes: { type: Number, default: 60 }, roundTo: { type: String, enum: ['hour', 'half', 'none'], default: 'hour' }, initialBufferMinutes: { type: Number, default: 120 }, searchCalendar: { type: String, enum: ['next', 'same'], default: 'next' }, googleCalendarId: { type: String, trim: true, default: null } }, { _id: false }); 
const contactRecipientSchema = new mongoose.Schema({ contact: { type: String, trim: true } }, { _id: false });
const phoneRecipientSchema = new mongoose.Schema({ phoneNumber: { type: String, trim: true } }, { _id: false });
const namedPhoneRecipientSchema = new mongoose.Schema({ name: { type: String, trim: true }, phoneNumber: { type: String, trim: true } }, { _id: false });

// Dynamic personality responses schema that allows custom categories
const personalityResponsesSchema = new mongoose.Schema({}, { 
    _id: false, 
    strict: false,  // Allow dynamic fields
    minimize: false // Don't remove empty objects
});

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
    tradeTypes: { type: [String], default: [] }, 
    timezone: { type: String, default: 'America/New_York', trim: true },
    
    // Profile completion tracking
    profileComplete: { type: Boolean, default: false }, // Track if detailed info has been added
    
    twilioConfig: { type: twilioConfigSchema, default: () => ({}) },
    smsSettings: { type: smsSettingsSchema, default: () => ({}) },
    integrations: { type: integrationsSchema, default: () => ({}) }, 
    aiSettings: { type: aiSettingsSchema, default: () => ({}) },
    agentSetup: { type: agentSetupSchema, default: () => ({}) },
    aiAgentSetup: { type: mongoose.Schema.Types.Mixed, default: null }, // New AI Agent Setup data
    
    // 🚀 ENTERPRISE AI AGENT SETTINGS - Multi-tenant gold standard
    tradeCategories: { 
        type: [String], 
        default: [],
        index: true
    },
    agentIntelligenceSettings: {
        useLLM: { type: Boolean, default: true },
        llmModel: { 
            type: String, 
            default: 'ollama-phi3',
            enum: ['ollama-phi3', 'ollama-mistral', 'gemini-pro', 'openai-gpt4', 'claude-3']
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
        
        // Enhanced enterprise features
        firstPromptSoft: { type: Boolean, default: true },
        semanticSearchEnabled: { type: Boolean, default: true },
        confidenceScoring: { type: Boolean, default: true },
        autoLearningQueue: { type: Boolean, default: true },
        contextRetention: { type: Boolean, default: true },
        intelligentRouting: { type: Boolean, default: true },
        sentimentAnalysis: { type: Boolean, default: false },
        realTimeOptimization: { type: Boolean, default: true }
    },
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
    
    enterpriseAgent: { type: mongoose.Schema.Types.Mixed, default: {} }, // Enterprise AI Agent Settings - using Mixed for flexibility
    personalityResponses: { type: personalityResponsesSchema, default: () => defaultResponses },
    learningSettings: { type: learningSettingsSchema, default: () => ({}) },
    
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
    updatedAt: { type: Date, default: Date.now }
});

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

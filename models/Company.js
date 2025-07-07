// models/Company.js
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;
const { defaultResponses } = require('../utils/personalityResponses');

// --- Sub-schema for Address ---
const addressSchema = new mongoose.Schema({
    street: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    zip: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: 'USA' }
}, { _id: false });

// --- Sub-schema for Notes ---
const noteSchema = new mongoose.Schema({
    _id: { type: ObjectId, default: () => new mongoose.Types.ObjectId() },
    text: { type: String, trim: true, required: true },
    isPinned: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// --- Sub-schema for Twilio Configuration ---
const twilioConfigSchema = new mongoose.Schema({
    accountSid: { type: String, trim: true, default: null },
    authToken: { type: String, trim: true, default: null },
    phoneNumber: { type: String, trim: true, default: null }
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
    responseDelayMs: { type: Number, default: 0 }, // No delay for faster responses
    twilioSpeechConfidenceThreshold: { type: Number, default: 0.4 }, // Lower threshold for better speech recognition
    fuzzyMatchThreshold: { type: Number, default: 0.3 }, // Better Q&A matching for all companies
    ttsPitch: { type: Number, default: 0 },
    ttsSpeed: { type: Number, default: 1 },
    speechConfirmation: {
        enabled: { type: Boolean, default: false },
        confirmKey: { type: Number, default: 5 },
        prompts: {
            type: [String],
            default: [
                "I heard: '{transcript}'. Press 5 or say yes to confirm. If not, say no or repeat."
            ]
        },
        maxAttempts: { type: Number, default: 2 }
    },
    logCalls: { type: Boolean, default: false },
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
    silenceTimeout: { type: Number, default: 8 }, // Longer timeout to prevent hangups
    debugMode: { type: Boolean, default: false }
    // The enableGoogleCalendarIntegration field was moved to integrations.googleOAuth.isEnabled
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

const personalityResponsesSchema = new mongoose.Schema({
    cantUnderstand: { type: [String], default: () => defaultResponses.cantUnderstand },
    speakClearly: { type: [String], default: () => defaultResponses.speakClearly },
    outOfCategory: { type: [String], default: () => defaultResponses.outOfCategory },
    transferToRep: { type: [String], default: () => defaultResponses.transferToRep },
    calendarHesitation: { type: [String], default: () => defaultResponses.calendarHesitation },
    businessClosed: { type: [String], default: () => defaultResponses.businessClosed },
    frustratedCaller: { type: [String], default: () => defaultResponses.frustratedCaller },
    businessHours: { type: [String], default: () => defaultResponses.businessHours },
    connectionTrouble: { type: [String], default: () => defaultResponses.connectionTrouble },
    agentNotUnderstood: { type: [String], default: () => defaultResponses.agentNotUnderstood }
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
    ownerName: { type: String, required: [true, 'Owner name is required.'], trim: true },
    ownerEmail: { type: String, required: [true, 'Owner email is required.'], trim: true, lowercase: true },
    ownerPhone: { type: String, trim: true, default: null },
    contactName: { type: String, trim: true, default: null },
    contactEmail: { type: String, trim: true, default: null, lowercase: true },
    contactPhone: { type: String, required: [true, 'Contact phone is required.'], trim: true },
    address: { type: addressSchema, default: () => ({}) },
    tradeTypes: { type: [String], default: [] }, 
    timezone: { type: String, default: 'America/New_York', trim: true },
    
    twilioConfig: { type: twilioConfigSchema, default: () => ({}) },
    smsSettings: { type: smsSettingsSchema, default: () => ({}) },
    integrations: { type: integrationsSchema, default: () => ({}) }, 
    aiSettings: { type: aiSettingsSchema, default: () => ({}) },
    agentSetup: { type: agentSetupSchema, default: () => ({}) },
    personalityResponses: { type: personalityResponsesSchema, default: () => defaultResponses },
    
    notes: { type: [noteSchema], default: [] },
    
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// --- Middleware ---
companySchema.pre('save', function(next) { 
    this.updatedAt = new Date();
    next();
});
companySchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: new Date() });
    next();
});

const Company = mongoose.model('Company', companySchema, 'companiesCollection');
module.exports = Company;

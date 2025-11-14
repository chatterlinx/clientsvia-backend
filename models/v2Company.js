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
const schedulingRuleSchema = new mongoose.Schema({ serviceName: { type: String, required: true, trim: true }, schedulingType: { type: String, enum: ['immediate', 'future'], required: true }, futureBookingLeadDays: { type: Number, default: 0 }, dailyServiceHours: { type: [dailyServiceHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({ day, enabled: !['Saturday', 'Sunday'].includes(day), startTime: '08:00', endTime: '17:00' })) }, sameDayCutoffTime: { type: String, trim: true, default: "18:00" }, appointmentSlotIncrementMinutes: { type: Number, default: 60 }, roundTo: { type: String, enum: ['hour', 'half', 'none'], default: 'hour' }, initialBufferMinutes: { type: Number, default: 120 }, searchCalendar: { type: String, enum: ['next', 'same'], default: 'next' }, googleCalendarId: { type: String, trim: true, default: null } }, { _id: false }); 
const contactRecipientSchema = new mongoose.Schema({ contact: { type: String, trim: true } }, { _id: false });
const phoneRecipientSchema = new mongoose.Schema({ phoneNumber: { type: String, trim: true } }, { _id: false });
const namedPhoneRecipientSchema = new mongoose.Schema({ name: { type: String, trim: true }, phoneNumber: { type: String, trim: true } }, { _id: false });

// Legacy personality responses schema removed - using aiAgentLogic.responseCategories instead

// 🔧 CRITICAL FIX: Define aiAgentLogic as a proper Mongoose Schema
// This ensures Mongoose properly tracks and persists nested changes (especially voice Settings)
// ============================================================================
// ⚠️ NAMING CLARIFICATION: Why "aiAgentLogic"?
// ============================================================================
// HISTORY: This field was created when we had an "AI Agent Logic" UI tab
// EVOLUTION: That tab was deleted and split into multiple tabs:
//   - "AI Voice Settings" tab (manages voiceSettings below)
//   - "AI Agent Settings" tab (manages aiAgentSettings field)
//   - "Configuration" tabs (various)
// 
// CURRENT STATE: Field name is LEGACY but data structure is ACTIVE
// WHY NOT RENAMED: 589 references across 79 files = high production risk
// 
// CONFUSION PREVENTION:
//   - aiAgentLogic ≠ aiAgentSettings (two separate systems)
//   - aiAgentLogic = Voice + Intelligence configuration
//   - aiAgentSettings = Template + Variable management
// 
// FUTURE: Consider alias system or gradual rename post-launch
// ============================================================================
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
    },
    
    // ════════════════════════════════════════════════════════════════════════════════
    // 🤖 AI GATEWAY - 3-TIER ROUTING SYSTEM
    // ════════════════════════════════════════════════════════════════════════════════
    // PURPOSE: Control 3-tier routing, budget management, fallback responses for 100+ companies
    // LOCATION: Global AI Brain → Overview → AI Gateway sub-tab
    // ARCHITECTURE: Sub-50ms performance, Redis-cached, multi-tenant isolated
    // DOCUMENTATION: /docs/ai-gateway/
    // ════════════════════════════════════════════════════════════════════════════════
    
    // ────────────────────────────────────────────────────────────────────────────────
    // 🔐 TEMPLATE GATEKEEPER - 3-Tier Routing Configuration
    // ────────────────────────────────────────────────────────────────────────────────
    // Controls how the AI routes queries through Tier 1 (Rule-Based), Tier 2 (Semantic),
    // and Tier 3 (LLM Fallback) with budget management and performance tracking
    templateGatekeeper: {
        // Master enable/disable switch
        enabled: { 
            type: Boolean, 
            default: false 
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // TIER CONFIDENCE THRESHOLDS
        // ────────────────────────────────────────────────────────────────────────
        // Minimum confidence required to accept a match from each tier
        tier1Threshold: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.70,
            // Tier 1 (Rule-Based): Pattern matching, keyword detection
            // Confidence: 0.70 = 70% match certainty
            // Cost: FREE (no LLM calls)
        },
        tier2Threshold: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.60,
            // Tier 2 (Semantic): Vector similarity, context matching
            // Confidence: 0.60 = 60% match certainty
            // Cost: FREE (no LLM calls)
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // TIER 3 (LLM) CONTROL
        // ────────────────────────────────────────────────────────────────────────
        enableLLMFallback: { 
            type: Boolean, 
            default: false,
            // If true: Queries that fail Tier 1 & 2 go to OpenAI GPT-4 (paid)
            // If false: Queries that fail Tier 1 & 2 go to fallback responses
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // BUDGET MANAGEMENT (LLM COST TRACKING)
        // ────────────────────────────────────────────────────────────────────────
        // Prevents LLM overspending by enforcing monthly budgets
        monthlyBudget: { 
            type: Number, 
            min: 0, 
            default: 0,
            // Monthly budget in USD (e.g., 200 = $200/month)
            // When spent, LLM is automatically disabled until reset
        },
        currentSpend: { 
            type: Number, 
            min: 0, 
            default: 0,
            // Real-time tracking of current month's LLM spend
            // Updated after each Tier 3 call (atomic $inc operation)
        },
        lastResetDate: { 
            type: Date, 
            default: Date.now,
            // Last time budget was reset (monthly cron job)
            // See: scripts/monthly-budget-reset.js
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // PERFORMANCE TRACKING
        // ────────────────────────────────────────────────────────────────────────
        metrics: {
            tier1Calls: { type: Number, default: 0 },              // Tier 1 successful matches
            tier2Calls: { type: Number, default: 0 },              // Tier 2 successful matches
            tier3Calls: { type: Number, default: 0 },              // Tier 3 LLM calls
            fallbackCalls: { type: Number, default: 0 },           // Total fallback responses
            avgResponseTime: { type: Number, default: 0 },         // Average response time (ms)
            lastUpdated: { type: Date, default: Date.now }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // METADATA
        // ────────────────────────────────────────────────────────────────────────
        version: { type: Number, default: 1 },
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // ────────────────────────────────────────────────────────────────────────────────
    // 🆘 INTELLIGENT FALLBACK RESPONSES - When AI Fails
    // ────────────────────────────────────────────────────────────────────────────────
    // Context-aware fallback responses used when:
    // 1. All 3 tiers fail to match (confidence too low)
    // 2. LLM budget exceeded
    // 3. System error (OpenAI down, timeout, etc.)
    fallbackResponses: {
        // ────────────────────────────────────────────────────────────────────────
        // TONE & PERSONALITY
        // ────────────────────────────────────────────────────────────────────────
        toneProfile: { 
            type: String, 
            enum: ['professional', 'friendly', 'empathetic', 'technical', 'casual'], 
            default: 'friendly',
            // Controls the overall tone of fallback responses
            // professional: "I'll connect you with a specialist."
            // friendly: "Let me get you to the right person!"
            // empathetic: "I understand your concern. Let me help."
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // RESPONSE VARIATIONS (Rotated to avoid repetition)
        // ────────────────────────────────────────────────────────────────────────
        
        // Type 1: Clarification Needed (Low Confidence, Ambiguous)
        clarificationNeeded: { 
            type: [String], 
            default: [
                "I'm sorry, I didn't quite understand your question. Could you please rephrase or give me a little more detail?",
                "Hmm, I may not be following you — could you please say that another way so I can help better?",
                "I want to make sure I get this right for you — would you mind rephrasing that question?"
            ]
        },
        
        // Type 2: No Match Found (Clear Question, No Answer)
        noMatchFound: { 
            type: [String], 
            default: [
                "I'm not sure about that one, but I can forward this to a specialist or take a message so someone from the team can assist you.",
                "That's a great question, but I'll need to connect you with someone from our team who can give you the best answer.",
                "I don't have that information right now, but I can make sure the right person gets back to you about this."
            ]
        },
        
        // Type 3: Technical Issue (System Error)
        technicalIssue: { 
            type: [String], 
            default: [
                "I'm having a bit of trouble processing that right now. Could you try saying it differently?",
                "I wasn't able to interpret that request correctly. Could you clarify what you'd like me to check or do?"
            ]
        },
        
        // Type 4: Out of Scope (Wrong Service)
        outOfScope: { 
            type: [String], 
            default: [
                "I appreciate you calling, but we specialize in {INDUSTRY_TYPE}. Is there anything else I can help with today?"
            ]
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // ESCALATION OPTIONS
        // ────────────────────────────────────────────────────────────────────────
        escalationOptions: {
            offerTransfer: { 
                type: Boolean, 
                default: true,
                // Offer to transfer to live agent
            },
            offerMessage: { 
                type: Boolean, 
                default: true,
                // Offer to take a message
            },
            offerCallback: { 
                type: Boolean, 
                default: true,
                // Offer callback option
            },
            transferPhrase: { 
                type: String, 
                default: "Would you like me to transfer you to someone who can help with that?",
                trim: true
            },
            messagePhrase: { 
                type: String, 
                default: "I can take a message and have someone call you back within the hour if that works better?",
                trim: true
            }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // FOLLOW-UP PROMPTS (Appended to responses)
        // ────────────────────────────────────────────────────────────────────────
        followUpPrompts: { 
            type: [String], 
            default: [
                "Or if you'd like, you can tell me what it's about, and I'll connect you to the right person.",
                "Would you like me to transfer you now?",
                "I can take a detailed message for you if you prefer?"
            ]
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // ROTATION TRACKING (Prevents Same Response Repetition)
        // ────────────────────────────────────────────────────────────────────────
        // Tracks which variation was last used for each fallback type
        // Incremented after each use (mod length for wrap-around)
        lastUsedIndex: {
            clarification: { type: Number, default: 0, min: 0 },
            noMatch: { type: Number, default: 0, min: 0 },
            technical: { type: Number, default: 0, min: 0 },
            outOfScope: { type: Number, default: 0, min: 0 }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // METADATA
        // ────────────────────────────────────────────────────────────────────────
        version: { type: Number, default: 1 },
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // ────────────────────────────────────────────────────────────────────────────────
    // 🧠 LEARNING SETTINGS - AI Pattern Detection & Suggestions
    // ────────────────────────────────────────────────────────────────────────────────
    // Controls how the AI learns from production calls and generates suggestions
    learningSettings: {
        // ────────────────────────────────────────────────────────────────────────
        // AUTO-LEARNING (Pattern Detection)
        // ────────────────────────────────────────────────────────────────────────
        autoLearn: { 
            type: Boolean, 
            default: true,
            // If true: System analyzes Tier 3 (LLM) calls to detect patterns
            // If false: No automatic learning (manual scenario creation only)
            // Location: AI Gateway tab → Learning Settings
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // PATTERN SHARING (Cross-Company Learning)
        // ────────────────────────────────────────────────────────────────────────
        sharePatterns: { 
            type: Boolean, 
            default: false,
            // If true: Learned patterns shared with other companies in same industry
            // If false: Patterns stay private to this company only
            // Example: HVAC Company A learns "thermostat" patterns, shares with HVAC Company B
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // SUGGESTION CONFIDENCE THRESHOLD
        // ────────────────────────────────────────────────────────────────────────
        minConfidenceForSuggestion: { 
            type: Number, 
            min: 0, 
            max: 1, 
            default: 0.80,
            // Minimum confidence for LLM to suggest a new scenario
            // 0.80 = Only suggest if 80%+ confident this is a real pattern
            // Lower = More suggestions (may be noisy)
            // Higher = Fewer suggestions (only high-quality)
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // PERFORMANCE TRACKING
        // ────────────────────────────────────────────────────────────────────────
        metrics: {
            totalSuggestionsGenerated: { type: Number, default: 0 },  // Lifetime suggestion count
            suggestionsApplied: { type: Number, default: 0 },          // How many were accepted
            suggestionsIgnored: { type: Number, default: 0 },          // How many were dismissed
            lastSuggestionAt: { type: Date, default: null },           // Most recent suggestion
            lastUpdated: { type: Date, default: Date.now }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // METADATA
        // ────────────────────────────────────────────────────────────────────────
        version: { type: Number, default: 1 },
        lastUpdated: { type: Date, default: Date.now }
    },
    
    // ============================================================================
    // 🌐 GLOBAL INTELLIGENCE INHERITANCE FLAG (NEW)
    // ============================================================================
    // PURPOSE:
    //   - Determines if company uses GLOBAL or CUSTOM intelligence settings
    //   - Global = Inherits from AdminSettings.globalProductionIntelligence
    //   - Custom = Uses company-specific productionIntelligence below
    // 
    // DEFAULT: true (all companies inherit from global by default)
    // SWITCH: Admin can switch company to custom settings in UI
    // RUNTIME: RuntimeIntelligenceConfig.js checks this flag first
    // ============================================================================
    useGlobalIntelligence: {
        type: Boolean,
        default: true,
        description: 'If true, use AdminSettings.globalProductionIntelligence. If false, use company-specific productionIntelligence below.'
    },
    
    // ============================================================================
    // 🏭 PRODUCTION INTELLIGENCE CONFIGURATION (Company-Specific)
    // ============================================================================
    // PURPOSE: Configure 3-Tier Intelligence for PRODUCTION customer calls
    // NOTE: ONLY USED when useGlobalIntelligence = false
    // ARCHITECTURE: Per-company customization overrides global defaults
    // KEY DIFFERENCE:
    //   - Global Intelligence (AdminSettings) = Platform-wide baseline for all companies
    //   - Production Intelligence (THIS) = Company-specific overrides
    // BENEFITS:
    //   - Most companies use global (easy management)
    //   - Special companies can customize (e.g., high-volume clients)
    //   - Safety mechanisms: cost limits, circuit breakers, fallbacks
    // ============================================================================
    productionIntelligence: {
        // Enable/disable production 3-tier system
        enabled: {
            type: Boolean,
            default: true,
            description: 'Enable 3-tier intelligence for production calls (Tier 1 → Tier 2 → Tier 3)'
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // THRESHOLDS (Production-optimized)
        // ────────────────────────────────────────────────────────────────────────
        thresholds: {
            tier1: {
                type: Number,
                min: 0.7,
                max: 0.95,
                default: 0.80,
                description: 'Tier 1 (Rule-Based) threshold for production (0.70-0.95). Higher = stricter matching, less Tier 2/3.'
            },
            tier2: {
                type: Number,
                min: 0.5,
                max: 0.80,
                default: 0.60,
                description: 'Tier 2 (Semantic) threshold for production (0.50-0.80). Higher = stricter matching, less Tier 3.'
            },
            enableTier3: {
                type: Boolean,
                default: true,
                description: 'Allow Tier 3 LLM fallback in production. Set to false to disable LLM completely (use only Tier 1/2).'
            }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // LLM CONFIGURATION (Production-optimized)
        // ────────────────────────────────────────────────────────────────────────
        llmConfig: {
            model: {
                type: String,
                enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
                default: 'gpt-4o-mini',
                description: 'LLM model for production Tier 3: gpt-4o (best), gpt-4o-mini (balanced), gpt-3.5-turbo (cheapest)'
            },
            maxCostPerCall: {
                type: Number,
                default: 0.10,
                description: 'Max LLM cost per single customer call (USD). Prevents single call from costing too much. Default: $0.10'
            }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // SMART WARMUP (Premium Feature - Optional LLM Pre-warming)
        // ────────────────────────────────────────────────────────────────────────
        // Purpose: Pre-warm LLM during Tier 2 to eliminate perceived delay for Tier 3
        // Strategy: Intelligent prediction-based warmup with AbortController
        // Cost: Only charges if Tier 2 fails and LLM response is used
        // ────────────────────────────────────────────────────────────────────────
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
                description: 'Only pre-warm if Tier 2 confidence below this threshold (0.50-0.85). Higher = more selective warmup. Default: 0.75'
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
                max: 0.80,
                default: 0.30,
                description: 'Auto-disable warmup if hit rate falls below this (0.20-0.80). Hit rate = warmup used / warmup triggered. Default: 0.30 (30%)'
            },
            alwaysWarmupCategories: {
                type: [String],
                default: [],
                description: 'Template categories that ALWAYS trigger warmup, regardless of confidence. Example: ["pricing", "emergency", "vip"]'
            },
            neverWarmupCategories: {
                type: [String],
                default: [],
                description: 'Template categories that NEVER trigger warmup. Example: ["greeting", "goodbye", "confirmation"]'
            }
        },
        
        // ────────────────────────────────────────────────────────────────────────
        // METADATA
        // ────────────────────────────────────────────────────────────────────────
        lastUpdated: {
            type: Date,
            default: Date.now,
            description: 'When settings were last changed'
        },
        updatedBy: {
            type: String,
            default: 'System',
            description: 'Who last updated settings'
        }
    }
}, { _id: false });

const agentSetupSchema = new mongoose.Schema({
    agentMode: { type: String, default: 'full', trim: true },
    categories: { type: [String], default: [] },
    companySpecialties: { type: String, default: '', trim: true },
    timezone: { type: String, default: 'America/New_York', trim: true },
    operatingHours: { type: [operatingHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({day,enabled: !['Saturday', 'Sunday'].includes(day),start: '09:00',end: '17:00'})) },
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
    // 🚀 INTELLIGENCE MODE SELECTOR - Global vs Custom Settings
    // ============================================================================
    // PURPOSE: Enforce mutually exclusive intelligence configuration modes
    // OPTIONS: 
    //   - 'global': Uses platform-wide AdminSettings (99% of companies)
    //   - 'custom': Uses company-specific aiAgentLogic (premium feature)
    // PROTECTION: Enum validation + audit logging on mode switches
    // BUSINESS LOGIC:
    //   - When 'global': aiAgentLogic is ignored, AdminSettings used
    //   - When 'custom': Company's own aiAgentLogic used independently
    // AUDIT: All mode switches logged with admin email + timestamp
    // ============================================================================
    intelligenceMode: {
        type: String,
        enum: {
            values: ['global', 'custom'],
            message: 'Intelligence mode must be either "global" or "custom"'
        },
        default: 'global',
        required: true,
        index: true  // Fast queries for "show all global companies"
    },
    
    // Metadata for intelligence mode switches
    intelligenceModeHistory: [{
        mode: { type: String, enum: ['global', 'custom'], required: true },
        switchedBy: { type: String, trim: true, required: true }, // Admin email
        switchedAt: { type: Date, default: Date.now },
        reason: { type: String, trim: true, default: null }
    }],
    
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
                enum: ['text', 'tel', 'phone', 'email', 'url', 'currency', 'number', 'multiline'],
                //             ^^^ Added 'phone' to match template schema (both 'tel' and 'phone' now valid)
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
        // CHEAT SHEET - Company-Level AI Agent Behavior Rules
        // -------------------------------------------------------------------
        // Global behavior rules, edge cases, transfer protocols, and guardrails
        // Applied AFTER scenario matching to ensure consistent behavior
        // Compiled into optimized runtime policy by PolicyCompiler service
        cheatSheet: {
            // Metadata & Versioning
            version: { type: Number, default: 1 },
            status: { 
                type: String, 
                enum: ['draft', 'active'], 
                default: 'draft' 
            },
            updatedBy: { type: String, default: 'System' },
            updatedAt: { type: Date, default: Date.now },
            lastCompiledAt: { type: Date, default: null },
            checksum: { type: String, default: null },
            compileLock: { type: String, default: null }, // UUID for optimistic locking
            
            // Behavior Rules (touch-and-go protocol)
            behaviorRules: [{
                type: String,
                enum: [
                    'ACK_OK', 'NEVER_INTERRUPT', 'USE_COMPANY_NAME',
                    'CONFIRM_ENTITIES', 'POLITE_PROFESSIONAL', 'WAIT_FOR_PAUSE'
                ]
            }],
            
            // Edge Cases (high-priority pattern-response pairs)
            edgeCases: [{
                id: { type: String, required: true },
                name: { type: String, required: true },
                triggerPatterns: [{ type: String }], // Regex patterns
                responseText: { type: String, required: true },
                priority: { type: Number, default: 100 },
                enabled: { type: Boolean, default: true },
                createdAt: { type: Date, default: Date.now },
                createdBy: { type: String, default: 'System' }
            }],
            
            // Transfer Rules (intent-based handoff protocol)
            transferRules: [{
                id: { type: String, required: true },
                intentTag: { 
                    type: String, 
                    enum: ['billing', 'emergency', 'scheduling', 'technical', 'general'], 
                    required: true 
                },
                contactNameOrQueue: { type: String, required: true },
                phoneNumber: { type: String, default: null },
                script: { type: String, default: null },
                collectEntities: [{
                    name: { type: String, required: true },
                    type: { 
                        type: String, 
                        enum: ['PERSON', 'PHONE', 'EMAIL', 'DATE', 'TIME', 'TEXT'], 
                        required: true 
                    },
                    required: { type: Boolean, default: false },
                    prompt: { type: String, default: null },
                    validationPattern: { type: String, default: null },
                    validationPrompt: { type: String, default: null },
                    maxRetries: { type: Number, default: 2 },
                    escalateOnFail: { type: Boolean, default: true }
                }],
                afterHoursOnly: { type: Boolean, default: false },
                priority: { type: Number, default: 50 },
                enabled: { type: Boolean, default: true },
                createdAt: { type: Date, default: Date.now },
                createdBy: { type: String, default: 'System' }
            }],
            
            // Guardrails (content filtering & compliance)
            guardrails: [{
                type: String,
                enum: [
                    'NO_PRICES', 'NO_DIAGNOSES', 'NO_APOLOGIES_SPAM',
                    'NO_PHONE_NUMBERS', 'NO_URLS', 'NO_MEDICAL_ADVICE',
                    'NO_LEGAL_ADVICE', 'NO_INTERRUPTING'
                ]
            }],
            
            // Action Allowlist (whitelist of permitted runtime actions)
            allowedActions: [{
                type: String,
                enum: [
                    'BOOK_APPT', 'TAKE_MESSAGE', 'TRANSFER_BILLING',
                    'TRANSFER_EMERGENCY', 'TRANSFER_GENERAL', 'COLLECT_INFO',
                    'PROVIDE_HOURS', 'PROVIDE_PRICING'
                ]
            }]
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
        // SCENARIO CONTROLS - Per-company enable/disable for scenarios
        // -------------------------------------------------------------------
        // Allows companies to disable specific scenarios without editing Global AI Brain templates
        // Default behavior: All scenarios are ENABLED unless explicitly disabled here
        scenarioControls: [{
            templateId: { 
                type: String, 
                required: true,
                trim: true
                // References GlobalInstantResponseTemplate._id
            },
            scenarioId: { 
                type: String, 
                required: true,
                trim: true
                // scenario.scenarioId from template (stable unique ID)
            },
            isEnabled: { 
                type: Boolean, 
                default: true
                // false = "do not use this scenario for this company"
            },
            disabledAt: { 
                type: Date, 
                default: null
                // Timestamp when disabled (for audit trail)
            },
            disabledBy: { 
                type: String, 
                trim: true,
                default: null
                // User who disabled it (for audit trail)
            },
            notes: { 
                type: String, 
                trim: true,
                default: null
                // Optional notes explaining why disabled
            }
        }],
        
        // -------------------------------------------------------------------
        // CHEAT SHEET - Company-specific behavior rules and protocols
        // -------------------------------------------------------------------
        // PURPOSE: Layer of company-specific behavior on top of shared scenarios
        // ARCHITECTURE: Scenarios = WHAT to say (shared), Cheat Sheet = HOW to say it (custom)
        // PRECEDENCE: EdgeCase → Transfer → Guardrails → Behavior (strict, deterministic)
        // PERFORMANCE: Compiled to runtime artifact, sub-10ms application budget
        // LEARNING: Separate learning loop from scenarios, both active and complementary
        // -------------------------------------------------------------------
        cheatSheet: {
            // METADATA & VERSIONING
            version: { 
                type: Number, 
                default: 1,
                min: 1
                // Incremented on each compilation
            },
            status: {
                type: String,
                enum: ['draft', 'active'],
                default: 'draft'
                // draft = being edited, active = live in production
            },
            updatedBy: {
                type: String,
                trim: true,
                default: null
                // Email of admin who last edited
            },
            updatedAt: {
                type: Date,
                default: Date.now
                // Last edit timestamp
            },
            lastCompiledAt: {
                type: Date,
                default: null
                // When policy artifact was last generated
            },
            checksum: {
                type: String,
                trim: true,
                default: null
                // SHA-256 of compiled artifact for immutability
            },
            compileLock: {
                type: String,
                trim: true,
                default: null
                // UUID for optimistic locking during compilation
                // Prevents race conditions when admin saves twice quickly
            },
            
            // -------------------------------------------------------------------
            // COMPANY INSTRUCTIONS - Free-form natural language guidance
            // -------------------------------------------------------------------
            // Purpose: Company-specific conversational protocols and behavior rules
            // Scope: Per companyId (NOT global - isolated to this business)
            // Format: Free-form text (natural language, no regex required)
            // Usage: Passed to AI agent as high-priority system prompt instructions
            // Precedence: HIGHER than structured rules (more specific guidance)
            // Examples:
            //   - "Never interrupt the caller"
            //   - "Always say 'Ok' instead of 'Got it!'"
            //   - "If caller says 'How are you?' respond with..."
            //   - "Round appointment times to next hour + 2 hour buffer"
            // -------------------------------------------------------------------
            // -------------------------------------------------------------------
            // FRONTLINE-INTEL - The Command Layer (formerly Company Instructions)
            // -------------------------------------------------------------------
            // The intelligent gatekeeper that processes EVERY call before routing
            // Acts as a human receptionist: thinks, verifies, organizes
            // 
            // Capabilities:
            // - Listens to rambling, extracts key request
            // - Looks up customer in database (returning customer?)
            // - Validates: Right company? Right service?
            // - Detects wrong number/service, politely redirects
            // - Normalizes messy input for Tier 1/2/3 routing
            // - Captures context for human-like responses
            // 
            // This is THE HUB - the intelligence layer that makes calls feel human
            // -------------------------------------------------------------------
            frontlineIntel: {
                type: String,
                trim: true,
                default: null
                // Large text field for Frontline-Intel protocols
                // Pre-filled with professional default template
                // Fully editable by admin per company
                // Can be reset to default via "Reset to Default" button
                // 
                // Example protocols:
                // - "Always say 'Ok' instead of 'Got it!'"
                // - "Extract key request from long stories"
                // - "If caller mentions wrong company, politely redirect"
                // - "Look up customer by name or phone"
            },
            
            // -------------------------------------------------------------------
            // CALL FLOW CONFIG - Dynamic execution order control
            // -------------------------------------------------------------------
            // Allows per-company customization of call processing sequence
            // Each step can be enabled/disabled and reordered
            // System validates dependencies and warns about cost/time impacts
            // -------------------------------------------------------------------
            callFlowConfig: [{
                id: {
                    type: String,
                    enum: [
                        'spamFilter',        // Phone number blacklist/whitelist (Layer 0, locked)
                        'edgeCases',         // AI spam, robocalls, dead air detection
                        'transferRules',     // Emergency, billing, scheduling transfers
                        'frontlineIntel',    // THE HUB - intelligent gatekeeper
                        'scenarioMatching',  // 3-tier intelligence (keywords → semantic → LLM)
                        'guardrails',        // Content filtering (prices, phone numbers, etc.)
                        'behaviorPolish',    // Text polishing (ACK_OK, POLITE_PROFESSIONAL)
                        'contextInjection'   // Inject context from Frontline-Intel
                    ],
                    required: true
                },
                enabled: {
                    type: Boolean,
                    default: true
                    // If false, step is skipped during call processing
                },
                locked: {
                    type: Boolean,
                    default: false
                    // If true, cannot be reordered (e.g., spamFilter always first)
                },
                params: {
                    type: Object,
                    default: {}
                    // Step-specific configuration
                    // Example for frontlineIntel:
                    // {
                    //   model: "gpt-4o-mini",
                    //   timeout: 5000,
                    //   enableCustomerLookup: true,
                    //   enableServiceValidation: true,
                    //   maxCostPerCall: 0.01,
                    //   fastPath: {
                    //     enabled: false,
                    //     patterns: [],
                    //     minCallsBeforeEnable: 1000,
                    //     minTier1HitRate: 0.90
                    //   }
                    // }
                }
            }],
            
            // -------------------------------------------------------------------
            // BEHAVIOR RULES - Deterministic tone/style flags
            // -------------------------------------------------------------------
            // Applied LAST in precedence chain (after guardrails)
            // Format: Enum flags for O(1) lookup (no parsing)
            // Examples: Prepend "Ok", inject {companyname}, confirm entities back
            // -------------------------------------------------------------------
            behaviorRules: [{
                type: String,
                enum: [
                    'ACK_OK',              // Prepend "Ok" to responses
                    'NEVER_INTERRUPT',     // Wait for caller pause
                    'USE_COMPANY_NAME',    // Inject {companyname} in first-turn greeting
                    'CONFIRM_ENTITIES',    // Repeat back collected info for verification
                    'POLITE_PROFESSIONAL', // Formal tone, avoid contractions
                    'WAIT_FOR_PAUSE'       // Delay before speaking (prevent talk-over)
                ],
                default: []
            }],
            
            // -------------------------------------------------------------------
            // EDGE CASES - Unusual caller inputs (highest precedence)
            // -------------------------------------------------------------------
            // Triggered: Pattern matching against caller input
            // Precedence: HIGHEST (overrides everything if matched)
            // Purpose: Handle "It's a machine", "System delay", etc.
            // Learning: Separate queue suggests new edge cases from Tier-3 calls
            // -------------------------------------------------------------------
            edgeCases: [{
                id: { 
                    type: String, 
                    required: true,
                    trim: true
                    // Unique ID for forensics/audit trail
                },
                name: { 
                    type: String, 
                    required: true,
                    trim: true
                    // Human-readable name (e.g., "Machine Detection")
                },
                triggerPatterns: [{
                    type: String,
                    lowercase: true,
                    trim: true
                    // Regex patterns: "machine|robot|ai"
                    // Matched case-insensitively at runtime
                }],
                responseText: { 
                    type: String, 
                    required: true,
                    maxlength: 500,
                    trim: true
                    // Pre-written response (no LLM, deterministic)
                },
                priority: { 
                    type: Number, 
                    default: 10,
                    min: 1,
                    max: 100
                    // Lower number = higher priority
                    // Used for conflict resolution (1 = highest)
                },
                enabled: { 
                    type: Boolean, 
                    default: true
                    // Soft delete without losing data
                },
                createdAt: {
                    type: Date,
                    default: Date.now
                },
                createdBy: {
                    type: String,
                    trim: true,
                    default: null
                }
            }],
            
            // -------------------------------------------------------------------
            // TRANSFER RULES - Company-specific routing protocols
            // -------------------------------------------------------------------
            // Triggered: Intent tag matching + optional patterns
            // Precedence: SECOND (after edge cases, before guardrails)
            // Purpose: Custom transfer contacts, scripts, entity collection
            // Learning: Suggests new transfer patterns from Tier-3 calls
            // -------------------------------------------------------------------
            transferRules: [{
                id: { 
                    type: String, 
                    required: true,
                    trim: true
                    // Unique ID for forensics
                },
                intentTag: { 
                    type: String, 
                    required: true,
                    enum: ['billing', 'emergency', 'scheduling', 'technical', 'general'],
                    trim: true
                    // Category of transfer (used for pattern matching)
                },
                contactNameOrQueue: { 
                    type: String, 
                    required: true,
                    trim: true
                    // "Steven Ferris, x105" or "billing_team"
                },
                phoneNumber: { 
                    type: String, 
                    trim: true,
                    default: null
                    // Direct phone number if not using queue
                },
                script: { 
                    type: String, 
                    required: true,
                    maxlength: 300,
                    trim: true
                    // What AI says before transfer
                    // Example: "Let me connect you to Steven Ferris. Please hold."
                },
                
                // FIRST-CLASS ENTITY COLLECTION
                // Collect info before transfer (name, phone, issue)
                // Retry logic, validation patterns, escalation handling
                collectEntities: [{
                    name: { 
                        type: String, 
                        required: true,
                        trim: true
                        // Entity name: "name", "phone", "email", "issue"
                    },
                    type: { 
                        type: String, 
                        required: true,
                        enum: ['PERSON', 'PHONE', 'EMAIL', 'DATE', 'TIME', 'ADDRESS', 'TEXT'],
                        // Data type for validation + formatting
                    },
                    required: { 
                        type: Boolean, 
                        default: true
                        // Must collect before proceeding?
                    },
                    prompt: { 
                        type: String, 
                        required: true,
                        trim: true
                        // "May I have your phone number?"
                    },
                    validationPattern: { 
                        type: String, 
                        trim: true,
                        default: null
                        // Regex: "^[0-9]{10}$" for phone validation
                    },
                    validationPrompt: { 
                        type: String, 
                        trim: true,
                        default: null
                        // Re-prompt: "Please provide a 10-digit phone number"
                    },
                    maxRetries: { 
                        type: Number, 
                        default: 2,
                        min: 1,
                        max: 5
                        // How many attempts before escalation
                    },
                    escalateOnFail: { 
                        type: Boolean, 
                        default: true
                        // If validation fails after maxRetries, transfer anyway?
                    }
                }],
                
                afterHoursOnly: { 
                    type: Boolean, 
                    default: false
                    // Only apply this rule after business hours (7pm-7am)
                },
                priority: { 
                    type: Number, 
                    default: 10,
                    min: 1,
                    max: 100
                    // Lower = higher priority (same as edge cases)
                },
                enabled: { 
                    type: Boolean, 
                    default: true
                },
                createdAt: {
                    type: Date,
                    default: Date.now
                },
                createdBy: {
                    type: String,
                    trim: true,
                    default: null
                }
            }],
            
            // -------------------------------------------------------------------
            // GUARDRAILS - Content filtering and safety (server-side enforcement)
            // -------------------------------------------------------------------
            // Applied: THIRD in precedence (after transfer rules)
            // Purpose: Block unauthorized content (prices, phone numbers, medical advice)
            // Format: Enum flags compiled to regex patterns
            // Enforcement: Server-side only (LLM cannot override)
            // -------------------------------------------------------------------
            guardrails: [{
                type: String,
                enum: [
                    'NO_PRICES',           // Block $ amounts not in approved variables
                    'NO_DIAGNOSES',        // Block technical diagnostic language
                    'NO_APOLOGIES_SPAM',   // Limit "sorry" to 1x per turn
                    'NO_PHONE_NUMBERS',    // Block phone # unless in variables
                    'NO_URLS',             // Block URLs unless whitelisted
                    'NO_MEDICAL_ADVICE',   // Block medical terminology
                    'NO_LEGAL_ADVICE',     // Block legal terminology
                    'NO_INTERRUPTING'      // Never speak over caller
                ],
                default: []
            }],
            
            // -------------------------------------------------------------------
            // ACTION ALLOWLIST - Security boundary (what AI can do)
            // -------------------------------------------------------------------
            // Purpose: Whitelist of permitted actions per company
            // Enforcement: Validated before execution (LLM can't invent actions)
            // Audit: Unauthorized attempts logged to SecurityLog
            // Default: Empty = no actions allowed (must explicitly enable)
            // -------------------------------------------------------------------
            allowedActions: [{
                type: String,
                enum: [
                    'BOOK_APPT',           // Schedule appointments
                    'TAKE_MESSAGE',        // Log caller info for callback
                    'TRANSFER_BILLING',    // Transfer to billing contact
                    'TRANSFER_EMERGENCY',  // Transfer to emergency line
                    'TRANSFER_GENERAL',    // Transfer to main queue
                    'COLLECT_INFO',        // Collect caller information
                    'PROVIDE_HOURS',       // Share business hours
                    'PROVIDE_PRICING'      // Share pricing from variables
                ],
                default: []
            }]
        },
        
        // -------------------------------------------------------------------
        // VARIABLE SCAN STATUS - Enterprise scan tracking
        // -------------------------------------------------------------------
        variableScanStatus: {
            lastReport: {
                type: mongoose.Schema.Types.Mixed,
                default: null
                // Full scan report from last enterprise scan
            },
            history: [{
                type: mongoose.Schema.Types.Mixed
                // Last 20 scan reports for differential analysis
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
                default: 'One moment while I transfer you to our team.'
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
                        default: 'We\'re available during business hours. I can help you with our schedule right now.'
                    },
                    general: {
                        type: String,
                        default: 'I want to make sure you get the best help possible. Let me get you to the right person.'
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
                        'Let me get you to a specialist who can help with this specifically...',
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
                
                // 📞 SPEECH DETECTION SETTINGS (Twilio Gather Configuration)
                // Controls how the AI detects when the caller has finished speaking
                speechDetection: {
                    // Speech Timeout: How long to wait (in seconds) after caller stops talking
                    // before considering their input complete
                    // Range: 1-10 seconds
                    // - Lower (1-3s) = Faster responses, but may cut off pauses
                    // - Higher (7-10s) = Allows long pauses, but feels slower
                    // - Recommended: 3-5s for most businesses
                    speechTimeout: {
                        type: Number,
                        min: 1,
                        max: 10,
                        default: 3 // Optimized for natural conversation flow
                    },
                    
                    // Initial Timeout: How long to wait for ANY speech to start (in seconds)
                    // If caller says nothing, system will timeout after this duration
                    initialTimeout: {
                        type: Number,
                        min: 3,
                        max: 15,
                        default: 5
                    },
                    
                    // Barge-In: Allow caller to interrupt AI while it's speaking
                    // true = Caller can interrupt mid-sentence (more natural)
                    // false = AI must finish speaking before caller can respond (more polite)
                    bargeIn: {
                        type: Boolean,
                        default: false
                    },
                    
                    // Enhanced Speech Recognition
                    enhancedRecognition: {
                        type: Boolean,
                        default: true // Uses Twilio's enhanced speech model for better accuracy
                    },
                    
                    // Speech Model: Which Twilio speech model to use
                    speechModel: {
                        type: String,
                        enum: ['default', 'numbers_and_commands', 'phone_call'],
                        default: 'phone_call' // Optimized for phone conversations
                    }
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
            
            // Pre-Activation Message (what callers hear before "Go Live" is clicked)
            preActivationMessage: { 
                type: String, 
                trim: true,
                default: "Thank you for calling {companyName}. Our AI receptionist is currently being configured and will be available shortly. For immediate assistance, please call our main office line. Thank you for your patience."
            },
            
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
    // ============================================================================
    // 🛡️ SPAM FILTER & CALL FILTERING SYSTEM
    // ============================================================================
    // Purpose: Multi-layer spam detection and call filtering for all incoming calls
    // 
    // IMPORTANT SCHEMA NOTES:
    // - ACTIVE SCHEMA (2025): checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection
    // - DEPRECATED SCHEMA (pre-2025): blockKnownSpam, blockHighFrequency, blockRobocalls
    // - Backend migration layer handles old → new schema automatically
    // - Frontend ONLY uses NEW SCHEMA (see: public/js/ai-agent-settings/SpamFilterManager.js)
    // 
    // ⚠️ WARNING FOR FUTURE ENGINEERS:
    // If you need to add new spam filter settings:
    // 1. Add the field HERE in the Mongoose schema
    // 2. Update backend GET migration logic (routes/admin/callFiltering.js:466-482)
    // 3. Update backend PUT save logic (routes/admin/callFiltering.js:565-570)
    // 4. Update frontend rendering (public/js/ai-agent-settings/SpamFilterManager.js)
    // 5. Run: node scripts/verify-spam-filter-schema.js
    // 
    // Documentation: docs/SPAM-FILTER-FIX-COMPLETE-REPORT.md
    // ============================================================================
    callFiltering: {
        // Master enable/disable switch
        enabled: { type: Boolean, default: true },
        
        // ========================================================================
        // BLACKLIST - Company-specific numbers to block
        // ========================================================================
        // 🆕 ENHANCED SCHEMA (Nov 2025): Added auto-blacklist support
        // ────────────────────────────────────────────────────────────────────────
        blacklist: [{
            phoneNumber: { type: String, required: true, trim: true },
            addedAt: { type: Date, default: Date.now },
            addedBy: { type: String, trim: true, default: 'admin' },
            reason: { type: String, trim: true, default: null },
            status: { 
                type: String, 
                enum: ['active', 'removed', 'pending'],  // 'pending' = awaiting admin approval
                default: 'active' 
            },
            
            // ────────────────────────────────────────────────────────────────────
            // 🤖 AUTO-BLACKLIST METADATA (Nov 2025)
            // ────────────────────────────────────────────────────────────────────
            // These fields track auto-detected spam numbers from edge case detection
            source: { 
                type: String, 
                enum: ['manual', 'auto'], 
                default: 'manual',
                index: true  // Index for filtering UI (show manual vs auto)
            },
            detectionMethod: { 
                type: String, 
                enum: ['admin', 'edge_case', 'frequency', 'robocall', 'global_db'], 
                default: 'admin' 
            },
            edgeCaseName: { 
                type: String, 
                trim: true, 
                default: null  // e.g., "AI Telemarketer", "Robocall Detection"
            },
            
            // ────────────────────────────────────────────────────────────────────
            // 📊 BLOCKING STATISTICS
            // ────────────────────────────────────────────────────────────────────
            timesBlocked: { 
                type: Number, 
                default: 0  // Incremented each time this number is blocked
            },
            lastBlockedAt: { 
                type: Date, 
                default: null  // Most recent block timestamp
            },
            
            // ────────────────────────────────────────────────────────────────────
            // ✅ APPROVAL TRACKING (for pending entries)
            // ────────────────────────────────────────────────────────────────────
            approvedAt: { type: Date, default: null },
            approvedBy: { type: String, trim: true, default: null }
        }],
        
        // ========================================================================
        // WHITELIST - Always allow these numbers (bypass all filters)
        // ========================================================================
        whitelist: [{
            phoneNumber: { type: String, required: true, trim: true },
            addedAt: { type: Date, default: Date.now },
            addedBy: { type: String, trim: true, default: 'admin' },
            reason: { type: String, trim: true, default: null }
        }],
        
        // ========================================================================
        // DETECTION SETTINGS - Core spam filter configuration
        // ========================================================================
        // ⚠️ SCHEMA MIGRATION IN PROGRESS (Oct 2025)
        // Old keys (blockKnownSpam, etc) → New keys (checkGlobalSpamDB, etc)
        // Both schemas coexist for backward compatibility during migration
        // ========================================================================
        settings: {
            // ----------------------------------------------------------------
            // ✅ ACTIVE SCHEMA (October 2025 onwards)
            // ----------------------------------------------------------------
            // These are the ONLY keys that should be used in new code
            checkGlobalSpamDB: { type: Boolean, default: false },           // Check against GlobalSpamDatabase
            enableFrequencyCheck: { type: Boolean, default: false },        // Rate limiting / frequency analysis
            enableRobocallDetection: { type: Boolean, default: false },     // AI-powered robocall pattern detection
            
            // ----------------------------------------------------------------
            // 🔧 DEPRECATED SCHEMA (pre-October 2025)
            // ----------------------------------------------------------------
            // ⚠️ DO NOT USE IN NEW CODE - Kept for migration compatibility only
            // Backend automatically migrates these to new schema on read
            // Will be removed in future version (target: Q2 2026)
            blockKnownSpam: { type: Boolean },                              // DEPRECATED → Use checkGlobalSpamDB
            blockHighFrequency: { type: Boolean },                          // DEPRECATED → Use enableFrequencyCheck
            blockRobocalls: { type: Boolean },                              // DEPRECATED → Use enableRobocallDetection
            
            // ----------------------------------------------------------------
            // 📊 SUPPLEMENTARY SETTINGS (still active)
            // ----------------------------------------------------------------
            blockInvalidNumbers: { type: Boolean, default: true },          // Format validation (e.g., non-E.164)
            frequencyThreshold: { type: Number, default: 5 },               // Max calls per 10 minutes
            notifyOnBlock: { type: Boolean, default: false },               // Send email/SMS on block
            
            // ----------------------------------------------------------------
            // 🤖 AUTO-BLACKLIST SETTINGS (Nov 2025)
            // ----------------------------------------------------------------
            // Automatic blacklisting from edge case detection
            autoBlacklistEnabled: { type: Boolean, default: false },        // Master toggle for auto-blacklist
            autoBlacklistThreshold: { 
                type: Number, 
                default: 1,                                                  // Add to blacklist after N detections
                min: 1,
                max: 10
            },
            autoBlacklistTriggers: { 
                type: [String], 
                enum: [
                    'ai_telemarketer',      // AI telemarketing script detected
                    'robocall',             // Robocall/IVR system detected
                    'dead_air',             // No response / dead air (risky - can be false positive)
                    'ivr_system',           // Automated IVR menu detected
                    'call_center_noise'     // Call center background noise detected
                ],
                default: ['ai_telemarketer', 'robocall']                     // Conservative defaults
            },
            requireAdminApproval: { 
                type: Boolean, 
                default: true                                                // If true, numbers added as 'pending' status
            },
            autoBlacklistExpiration: { 
                type: Number, 
                default: 0,                                                  // Days until auto-removal (0 = never expire)
                min: 0,
                max: 365
            }
        },
        
        // ========================================================================
        // STATISTICS - Spam filter performance metrics
        // ========================================================================
        stats: {
            totalBlocked: { type: Number, default: 0 },                     // Lifetime block count
            lastBlockedAt: { type: Date, default: null }                    // Most recent block timestamp
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

// ============================================================================
// P1 CHECKPOINT: Critical Credentials Validation (pre-save)
// ============================================================================
companySchema.pre('save', async function(next) {
    // Skip validation for new companies (they might not have creds yet)
    if (this.isNew) {
        return next();
    }
    
    // Only validate if company is marked as active
    if (this.isDeleted || this.accountStatus?.status === 'suspended') {
        return next();
    }
    
    try {
        const AdminNotificationService = require('../services/AdminNotificationService');
        const missingCredentials = [];
        
        // Check Twilio credentials
        if (!this.twilioConfig?.accountSID || !this.twilioConfig?.authToken) {
            missingCredentials.push('Twilio (accountSID/authToken)');
        }
        
        // Check ElevenLabs API key (check both old and new locations)
        if (!this.aiSettings?.elevenLabs?.apiKey && !this.aiAgentLogic?.voiceSettings?.apiKey) {
            missingCredentials.push('ElevenLabs API Key');
        }
        
        if (missingCredentials.length > 0) {
            await AdminNotificationService.sendAlert({
                code: 'COMPANY_MISSING_CREDENTIALS_ON_SAVE',
                severity: 'WARNING',
                companyId: this._id.toString(),
                companyName: this.companyName,
                message: `⚠️ Attempting to save company ${this.companyName} with missing credentials`,
                details: {
                    companyId: this._id.toString(),
                    companyName: this.companyName,
                    missingCredentials,
                    impact: 'Company cannot receive/make calls once saved, voice generation will fail',
                    suggestedFix: 'Add missing credentials before saving or mark company as suspended',
                    detectedBy: 'Company pre-save validation hook'
                }
            }).catch(err => console.error('Failed to send pre-save credentials alert:', err));
        }
    } catch (error) {
        // Don't block save if notification fails
        console.error('Error in Company pre-save hook:', error.message);
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

// ============================================================================
// CRITICAL INDEXES FOR PERFORMANCE (Phase 5 Audit)
// ============================================================================
// These indexes are ESSENTIAL for production performance. Without them:
// - Phone number lookups (EVERY incoming call) would do collection scans
// - Company searches in Data Center would be slow
// - Deleted company filtering would be inefficient
//
// INDEX RATIONALE:
// 1. twilioConfig.phoneNumber - MOST CRITICAL (queried on EVERY call)
// 2. twilioConfig.phoneNumbers.phoneNumber - Multi-phone support
// 3. isDeleted - Filtered in almost every query
// 4. Compound (isDeleted + companyName) - Data Center searches
// ============================================================================

companySchema.index({ 'twilioConfig.phoneNumber': 1 }, { 
    name: 'idx_twilio_phone',
    background: true,
    sparse: true // Only index documents with this field
});

companySchema.index({ 'twilioConfig.phoneNumbers.phoneNumber': 1 }, { 
    name: 'idx_twilio_phone_numbers',
    background: true,
    sparse: true
});

companySchema.index({ isDeleted: 1 }, { 
    name: 'idx_is_deleted',
    background: true
});

companySchema.index({ isDeleted: 1, companyName: 1 }, { 
    name: 'idx_deleted_name',
    background: true
});

companySchema.index({ isDeleted: 1, createdAt: -1 }, { 
    name: 'idx_deleted_created',
    background: true
});

const Company = mongoose.model('Company', companySchema, 'companiesCollection');
module.exports = Company;

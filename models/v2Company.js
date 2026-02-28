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

// ════════════════════════════════════════════════════════════════════════════════
// SMS NOTIFICATIONS - V88 (Jan 2026)
// ════════════════════════════════════════════════════════════════════════════════
// Automatic booking confirmations and appointment reminders via SMS.
// Fully UI-configurable templates with placeholders.
// ════════════════════════════════════════════════════════════════════════════════
const smsNotificationsSchema = new mongoose.Schema({
    // Master toggle
    enabled: { type: Boolean, default: false },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // BOOKING CONFIRMATION - Sent immediately after booking completes
    // ═══════════════════════════════════════════════════════════════════════════
    confirmation: {
        enabled: { type: Boolean, default: true },
        template: {
            type: String,
            default: `Hi {customerName}! Your appointment with {companyName} is confirmed for {appointmentTime}. Address: {customerAddress}. We look forward to helping you! Reply HELP for assistance.`
        },
        // Include action links
        includeRescheduleLink: { type: Boolean, default: false },
        includeCancelLink: { type: Boolean, default: false }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REMINDER - 24 HOURS BEFORE
    // ═══════════════════════════════════════════════════════════════════════════
    reminder24h: {
        enabled: { type: Boolean, default: true },
        template: {
            type: String,
            default: `Reminder: Hi {customerName}, your appointment with {companyName} is tomorrow at {appointmentTime}. Address: {customerAddress}. Please call us if you need to reschedule.`
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REMINDER - 1 HOUR BEFORE
    // ═══════════════════════════════════════════════════════════════════════════
    reminder1h: {
        enabled: { type: Boolean, default: false },
        template: {
            type: String,
            default: `Heads up, {customerName}! Your technician from {companyName} will arrive in about 1 hour for your {appointmentTime} appointment. Please ensure clear access to the service area.`
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REMINDER - DAY OF (Morning)
    // ═══════════════════════════════════════════════════════════════════════════
    reminderDayOf: {
        enabled: { type: Boolean, default: false },
        sendTime: { type: String, default: '08:00' }, // 24h format
        template: {
            type: String,
            default: `Good morning {customerName}! Just a reminder: {companyName} has you scheduled for today at {appointmentTime}. We look forward to serving you!`
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ON-THE-WAY NOTIFICATION (manually triggered or GPS-based future)
    // ═══════════════════════════════════════════════════════════════════════════
    onTheWay: {
        enabled: { type: Boolean, default: false },
        template: {
            type: String,
            default: `{companyName} update: Your technician {technicianName} is on the way and should arrive in approximately {eta} minutes.`
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // COMPLETION/FOLLOW-UP (after service)
    // ═══════════════════════════════════════════════════════════════════════════
    followUp: {
        enabled: { type: Boolean, default: false },
        delayHours: { type: Number, default: 2 }, // Hours after appointment
        template: {
            type: String,
            default: `Thank you for choosing {companyName}! We hope everything is working great. If you have any questions or feedback, please reply to this message or call {companyPhone}.`
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // RESCHEDULE/CANCEL LINKS
    // ═══════════════════════════════════════════════════════════════════════════
    links: {
        // Base URL for action links (company's booking portal)
        rescheduleUrl: { type: String, default: null, trim: true },
        cancelUrl: { type: String, default: null, trim: true },
        // Use short URL service
        useShortUrls: { type: Boolean, default: true }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // REPLY HANDLING
    // ═══════════════════════════════════════════════════════════════════════════
    replyHandling: {
        // What to do when customer replies
        enabled: { type: Boolean, default: true },
        // Keywords that trigger actions
        confirmKeywords: { type: [String], default: ['C', 'CONFIRM', 'YES', 'Y'] },
        rescheduleKeywords: { type: [String], default: ['R', 'RESCHEDULE', 'CHANGE'] },
        cancelKeywords: { type: [String], default: ['CANCEL', 'X'] },
        // Auto-response when we detect keyword
        confirmResponse: { type: String, default: 'Thanks for confirming! We\'ll see you at your scheduled time.' },
        rescheduleResponse: { type: String, default: 'No problem! Please call {companyPhone} to reschedule your appointment.' },
        cancelResponse: { type: String, default: 'Your appointment has been cancelled. Call {companyPhone} if you need to reschedule.' }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // QUIET HOURS (don't send during these times)
    // ═══════════════════════════════════════════════════════════════════════════
    quietHours: {
        enabled: { type: Boolean, default: true },
        startTime: { type: String, default: '21:00' }, // 9 PM
        endTime: { type: String, default: '08:00' }    // 8 AM
    }
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

// ════════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR INTEGRATION - V88 (Jan 2026)
// ════════════════════════════════════════════════════════════════════════════════
// Enables real-time availability checking and automatic appointment creation.
// OAuth2 tokens are stored encrypted per-company (multi-tenant safe).
// ════════════════════════════════════════════════════════════════════════════════
const googleCalendarSchema = new mongoose.Schema({
    // Connection status
    enabled: { type: Boolean, default: false },
    connected: { type: Boolean, default: false },
    connectedAt: { type: Date, default: null },
    connectedBy: { type: String, trim: true, default: null }, // Admin email who connected
    
    // OAuth2 tokens (encrypted at rest)
    accessToken: { type: String, default: null, select: false }, // Don't include in normal queries
    refreshToken: { type: String, default: null, select: false },
    tokenExpiresAt: { type: Date, default: null },
    scope: { type: String, default: 'https://www.googleapis.com/auth/calendar' },
    
    // Calendar selection
    calendarId: { type: String, trim: true, default: 'primary' }, // Which calendar to use
    calendarName: { type: String, trim: true, default: null }, // Display name
    calendarEmail: { type: String, trim: true, default: null }, // Google account email
    
    // Booking settings
    settings: {
        // Time buffer before first available slot (minutes)
        bufferMinutes: { type: Number, default: 60 },
        
        // Minimum appointment duration (minutes)
        defaultDurationMinutes: { type: Number, default: 60 },
        
        // How far ahead can customers book (days)
        maxBookingDaysAhead: { type: Number, default: 30 },
        
        // Working hours (override company operating hours if set)
        useCompanyHours: { type: Boolean, default: true },
        customWorkingHours: {
            type: [{
                day: { type: String, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
                enabled: { type: Boolean, default: true },
                startTime: { type: String, default: '08:00' }, // 24h format
                endTime: { type: String, default: '17:00' }
            }],
            default: []
        },
        
        // What to include in calendar event
        includeCustomerPhone: { type: Boolean, default: true },
        includeCustomerAddress: { type: Boolean, default: true },
        includeServiceNotes: { type: Boolean, default: true },
        
        // Event title template (placeholders: {customerName}, {serviceType}, {companyName})
        eventTitleTemplate: { type: String, default: '{serviceType} - {customerName}' },
        
        // Event description template
        eventDescriptionTemplate: { 
            type: String, 
            default: 'Customer: {customerName}\nPhone: {customerPhone}\nAddress: {customerAddress}\n\nService: {serviceType}\nNotes: {serviceNotes}\n\nBooked via {companyName} AI Receptionist'
        },
        
        // Send calendar invite to customer email
        sendCustomerInvite: { type: Boolean, default: false },
        
        // Fallback when calendar is unavailable
        fallbackMode: { 
            type: String, 
            enum: ['preference_capture', 'transfer_to_human', 'error_message'],
            default: 'preference_capture'
        },
        fallbackMessage: {
            type: String,
            default: "I'll note your preferred time and someone will confirm your appointment shortly."
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // EVENT COLOR/TAGS - V89 (Jan 2026)
    // Google Calendar colorId: 1=Lavender, 2=Sage, 3=Grape, 4=Flamingo, 5=Banana,
    // 6=Tangerine, 7=Peacock, 8=Graphite, 9=Blueberry, 10=Basil, 11=Tomato
    // ═══════════════════════════════════════════════════════════════════════════
    eventColors: {
        // Enable color-coding by service type
        enabled: { type: Boolean, default: true },
        
        // Map service types to Google Calendar colors
        // AI determines serviceType from conversation (repair, maintenance, estimate, etc.)
        // V88: Each service type now has its own scheduling rules
        // V89: canonicalType is now the authoritative field - serviceType kept for backward compatibility
        colorMapping: {
            type: [{
                // LEGACY: serviceType field - kept for backward compatibility
                // Can contain any string value from legacy data (e.g., 'repair_service', 'maintenance_call')
                serviceType: { 
                    type: String,
                    trim: true
                    // V89: Removed enum restriction - legacy data has non-standard values
                    // Use canonicalType for authoritative mapping
                },
                
                // V89: AUTHORITATIVE - canonicalType is the contract
                // This is what ServiceTypeResolver outputs and what the engine matches on
                // Valid values: repair, maintenance, emergency, estimate, sales, consultation, installation, inspection, service, other
                canonicalType: {
                    type: String,
                    enum: ['repair', 'maintenance', 'emergency', 'estimate', 'sales', 'consultation', 'installation', 'inspection', 'service', 'other', 'none'],
                    default: 'none'
                },
                
                colorId: { type: String, default: '1' }, // Google Calendar colorId (1-11)
                label: { type: String, trim: true }, // Display label for UI (can be anything)
                description: { type: String, trim: true }, // Optional description
                
                // ═══════════════════════════════════════════════════════════════════
                // V88: PER-SERVICE-TYPE SCHEDULING RULES
                // These override global calendar settings for this specific service
                // ═══════════════════════════════════════════════════════════════════
                scheduling: {
                    // Slot interval - time between appointments (minutes)
                    // Example: 60 = appointments at 9:00, 10:00, 11:00
                    // Example: 120 = appointments at 9:00, 11:00, 1:00
                    slotIntervalMinutes: { type: Number, default: 60, min: 15, max: 480 },
                    
                    // Lead time - minimum hours from NOW before first available slot
                    // This accounts for technician travel time
                    // Example: Caller at 10am, leadTimeMinutes=120 → first slot at 12pm
                    // Example: Emergency might be 60, Maintenance might be same-day not allowed
                    leadTimeMinutes: { type: Number, default: 60, min: 0, max: 480 },
                    
                    // Advance booking - minimum DAYS in advance
                    // 0 = same-day OK, 1 = next-day minimum, 7 = week out minimum
                    // Example: Emergency = 0 (same day), Maintenance = 7 (week out)
                    advanceBookingDays: { type: Number, default: 0, min: 0, max: 90 },
                    
                    // Same-day toggle (convenience - equivalent to advanceBookingDays > 0)
                    sameDayAllowed: { type: Boolean, default: true },
                    
                    // Custom working hours for this service type (overrides global)
                    // If not set, uses company's global calendar working hours
                    useCustomHours: { type: Boolean, default: false },
                    customHours: {
                        startHour: { type: Number, default: 8, min: 0, max: 23 },  // 8 AM
                        endHour: { type: Number, default: 17, min: 1, max: 24 }     // 5 PM
                    },
                    
                    // Which days this service is available (bitmask or array)
                    availableDays: {
                        type: [String],
                        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
                        default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
                    }
                }
            }],
            default: [
                { serviceType: 'service', colorId: '7', label: 'Service Call', description: 'General service request', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 60, advanceBookingDays: 0, sameDayAllowed: true } },
                { serviceType: 'repair', colorId: '11', label: 'Repair', description: 'Equipment repair (urgent)', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 60, advanceBookingDays: 0, sameDayAllowed: true } },
                { serviceType: 'emergency', colorId: '4', label: 'Emergency', description: 'Emergency/same-day service', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 30, advanceBookingDays: 0, sameDayAllowed: true } },
                { serviceType: 'maintenance', colorId: '10', label: 'Maintenance', description: 'Scheduled maintenance/tune-up', scheduling: { slotIntervalMinutes: 120, leadTimeMinutes: 0, advanceBookingDays: 7, sameDayAllowed: false } },
                { serviceType: 'estimate', colorId: '5', label: 'Estimate', description: 'Quote/estimate visit', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 120, advanceBookingDays: 1, sameDayAllowed: false } },
                { serviceType: 'sales', colorId: '9', label: 'Sales', description: 'Sales consultation', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 120, advanceBookingDays: 1, sameDayAllowed: false } },
                { serviceType: 'consultation', colorId: '3', label: 'Consultation', description: 'General consultation', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 60, advanceBookingDays: 0, sameDayAllowed: true } },
                { serviceType: 'installation', colorId: '2', label: 'Installation', description: 'New installation', scheduling: { slotIntervalMinutes: 180, leadTimeMinutes: 0, advanceBookingDays: 3, sameDayAllowed: false } },
                { serviceType: 'inspection', colorId: '6', label: 'Inspection', description: 'System inspection', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 60, advanceBookingDays: 1, sameDayAllowed: false } },
                { serviceType: 'other', colorId: '8', label: 'Other', description: 'Uncategorized', scheduling: { slotIntervalMinutes: 60, leadTimeMinutes: 60, advanceBookingDays: 0, sameDayAllowed: true } }
            ]
        },
        
        // Default color when service type can't be determined
        defaultColorId: { type: String, default: '7' } // Peacock (teal)
    },
    
    // Error tracking
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
    consecutiveErrors: { type: Number, default: 0 },
    
    // Token robustness (V89)
    tokenUpdatedAt: { type: Date, default: null },
    lastTokenRefreshError: { type: String, default: null },
    healthy: { type: Boolean, default: true }
}, { _id: false });

// V2 DELETED: Legacy aiSettingsSchema - replaced by aiAgentSettings system
// All AI configuration now handled through aiAgentSettings field with 100% in-house system
const daysOfWeekForOperatingHours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const operatingHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } }, { _id: false });
const protocolSchema = new mongoose.Schema({ systemDelay: { type: String, default: '' }, messageTaking: { type: String, default: '' }, callerReconnect: { type: String, default: '' }, whenInDoubt: { type: String, default: '' }, callerFrustration: { type: String, default: '' }, telemarketerFilter: { type: String, default: '' }, behaviorGuidelines: { type: String, default: '' }, bookingConfirmation: { type: String, default: '' }, textToPay: { type: String, default: '' } }, { _id: false });
const dailyServiceHourSchema = new mongoose.Schema({ day: { type: String, required: true, enum: daysOfWeekForOperatingHours }, enabled: { type: Boolean, default: true }, startTime: { type: String, default: '00:00' }, endTime: { type: String, default: '23:59' } }, { _id: false });
const schedulingRuleSchema = new mongoose.Schema({ serviceName: { type: String, required: true, trim: true }, schedulingType: { type: String, enum: ['immediate', 'future'], required: true }, futureBookingLeadDays: { type: Number, default: 0 }, dailyServiceHours: { type: [dailyServiceHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({ day, enabled: !['Saturday', 'Sunday'].includes(day), startTime: '08:00', endTime: '17:00' })) }, sameDayCutoffTime: { type: String, trim: true, default: "18:00" }, appointmentSlotIncrementMinutes: { type: Number, default: 60 }, roundTo: { type: String, enum: ['hour', 'half', 'none'], default: 'hour' }, initialBufferMinutes: { type: Number, default: 120 }, searchCalendar: { type: String, enum: ['next', 'same'], default: 'next' }, googleCalendarId: { type: String, trim: true, default: null } }, { _id: false }); 
const contactRecipientSchema = new mongoose.Schema({ contact: { type: String, trim: true } }, { _id: false });
const phoneRecipientSchema = new mongoose.Schema({ phoneNumber: { type: String, trim: true } }, { _id: false });
const namedPhoneRecipientSchema = new mongoose.Schema({ name: { type: String, trim: true }, phoneNumber: { type: String, trim: true } }, { _id: false });

// Legacy personality responses schema removed - using aiAgentSettings.responseCategories instead

// 🔧 CRITICAL FIX: Define aiAgentSettings as a proper Mongoose Schema
// This ensures Mongoose properly tracks and persists nested changes (especially voice Settings)
// ============================================================================
// ⚠️ NAMING CLARIFICATION: Why "aiAgentSettings"?
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

const agentSetupSchema = new mongoose.Schema({
    agentMode: { type: String, default: 'full', trim: true },
    categories: { type: [String], default: [] },
    companySpecialties: { type: String, default: '', trim: true },
    timezone: { type: String, default: 'America/New_York', trim: true },
    operatingHours: { type: [operatingHourSchema], default: () => daysOfWeekForOperatingHours.map(day => ({day,enabled: !['Saturday', 'Sunday'].includes(day),start: '09:00',end: '17:00'})) },
    use247Routing: { type: Boolean, default: false },
    afterHoursAction: { type: String, default: 'message', trim: true },
    onCallForwardingNumber: { type: String, default: '', trim: true },
    // ☢️ NUKED: greetingType, greetingAudioUrl, agentGreeting - replaced by aiAgentSettings.initialGreeting
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
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V23: TRADE & REGION PROFILE (for LLM-A Triage Architect)
    // ═══════════════════════════════════════════════════════════════════════════
    // These fields enable LLM-A to generate context-aware triage cards
    // and flag region conflicts (e.g., "furnace" for Florida cooling-only company)
    trade: { 
        type: String, 
        trim: true, 
        uppercase: true,
        default: null,
        description: 'Primary trade: HVAC, PLUMBING, ELECTRICAL, DENTAL, REAL_ESTATE, etc.'
    },
    regionProfile: {
        climate: { 
            type: String, 
            enum: ['HOT_ONLY', 'COLD_ONLY', 'MIXED'], 
            default: 'MIXED',
            description: 'Regional climate affects which services are relevant'
        },
        supportsHeating: { type: Boolean, default: true },
        supportsCooling: { type: Boolean, default: true },
        supportsMaintenance: { type: Boolean, default: true },
        supportsEmergency: { type: Boolean, default: true },
        // Future: region-specific keywords to exclude
        regionKeywordsExclude: { type: [String], default: [] }
    },
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V70: SERVICE AREA VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════
    // Validates if caller's address is within company's service area.
    // Used both for "do you service my area?" questions AND during booking.
    // ═══════════════════════════════════════════════════════════════════════════
    serviceAreaConfig: {
        // Master toggle - enable/disable service area checking
        enabled: { type: Boolean, default: false },
        
        // ═══════════════════════════════════════════════════════════════
        // SERVICE AREA DEFINITION - Multiple ways to define coverage
        // ═══════════════════════════════════════════════════════════════
        
        // ZIP codes we service (most precise)
        // Example: ['33901', '33903', '33904', '33905', '33907', '33908', '33909', '33912', '33913', '33916', '33919']
        servicedZipCodes: {
            type: [String],
            default: []
        },
        
        // Cities we service (for display and fuzzy matching)
        // Example: ['Fort Myers', 'Cape Coral', 'Naples', 'Bonita Springs', 'Estero']
        servicedCities: {
            type: [String],
            default: []
        },
        
        // Counties we service (broader coverage)
        // Example: ['Lee County', 'Collier County']
        servicedCounties: {
            type: [String],
            default: []
        },
        
        // State restriction (optional - most companies are single-state)
        // Example: 'FL', 'TX', 'CA'
        servicedState: { type: String, uppercase: true, default: null },
        
        // Radius-based coverage (for Google Maps validation)
        radiusCoverage: {
            enabled: { type: Boolean, default: false },
            // Center point (company address or service hub)
            centerLat: { type: Number, default: null },
            centerLng: { type: Number, default: null },
            // Service radius in miles
            radiusMiles: { type: Number, default: 30 }
        },
        
        // ═══════════════════════════════════════════════════════════════
        // VALIDATION BEHAVIOR - When to check and how strict
        // ═══════════════════════════════════════════════════════════════
        
        // When to validate service area
        validateOn: {
            type: String,
            enum: [
                'address_collected',     // Check when address is given (during booking)
                'zip_mentioned',         // Check when ZIP code is mentioned (anytime)
                'city_mentioned',        // Check when city is mentioned (anytime)
                'explicit_question',     // Only when caller asks "do you service X?"
                'all'                    // Check all of the above
            ],
            default: 'all'
        },
        
        // How strict to be with matching
        matchStrictness: {
            type: String,
            enum: [
                'exact',    // Must match exactly (ZIP in list, city exact match)
                'fuzzy',    // Allow typos, abbreviations (Ft. Myers = Fort Myers)
                'generous'  // Include nearby areas, partial matches
            ],
            default: 'fuzzy'
        },
        
        // ═══════════════════════════════════════════════════════════════
        // RESPONSES - What to say when in/out of service area
        // ═══════════════════════════════════════════════════════════════
        
        // When caller IS in service area
        inAreaResponse: {
            type: String,
            default: "Great news! We do service {city}. Let me help you get scheduled."
        },
        
        // When caller is NOT in service area
        outOfAreaResponse: {
            type: String,
            default: "I'm sorry, we don't currently service {area}. We cover {serviceAreaSummary}. Is there anything else I can help you with?"
        },
        
        // When we can't determine the area (unclear address)
        unclearAreaResponse: {
            type: String,
            default: "Just to make sure we can help you — what city or ZIP code is the service address in?"
        },
        
        // Offer referral when out of area? (for partner companies)
        offerReferral: { type: Boolean, default: false },
        referralResponse: {
            type: String,
            default: "While we don't service that area, I can give you the number for a trusted company that does. Would that help?"
        },
        referralCompanyName: { type: String, default: null },
        referralCompanyPhone: { type: String, default: null },
        
        // ═══════════════════════════════════════════════════════════════
        // EDGE CASES - Borders and special zones
        // ═══════════════════════════════════════════════════════════════
        
        // ZIP codes on the border (maybe we service, check with office)
        borderlineZipCodes: {
            type: [String],
            default: []
        },
        borderlineResponse: {
            type: String,
            default: "That area is right on the edge of our service area. Let me have someone from the office confirm and call you back. Can I get your phone number?"
        },
        
        // Display-friendly summary of service area
        // Example: "Fort Myers, Cape Coral, Naples, and surrounding areas"
        serviceAreaSummary: {
            type: String,
            default: null
        }
    },
    
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
    
    // ════════════════════════════════════════════════════════════════════════════════
    // SMS NOTIFICATIONS - Booking confirmations + Appointment reminders
    // ════════════════════════════════════════════════════════════════════════════════
    smsNotifications: { type: smsNotificationsSchema, default: () => ({}) },
    
    // ════════════════════════════════════════════════════════════════════════════════
    // GOOGLE CALENDAR INTEGRATION - Real-time availability + automatic booking
    // ════════════════════════════════════════════════════════════════════════════════
    googleCalendar: { type: googleCalendarSchema, default: () => ({}) },
    
    // V2 DELETED: Legacy integrations field - HighLevel and Google OAuth eliminated 
    // REMOVED: Legacy aiSettings field - replaced by aiAgentSettings system
    agentSetup: { type: agentSetupSchema, default: () => ({}) },
    aiAgentSetup: { type: mongoose.Schema.Types.Mixed, default: null }, // New AI Agent Setup data
    
    // 🚀 V2 AI AGENT SETTINGS - Multi-tenant gold standard
    tradeCategories: { 
        type: [String], 
        default: [],
        index: true
    },
    // 🚨 REMOVED: All LLM settings violate "no external LLM" business rule
    // All AI intelligence is now handled by aiAgentSettings configuration from UI
    
    // 🚨 REMOVED: All intelligence settings now come from aiAgentSettings UI configuration
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
    
    // V2 DELETED: Legacy v2Agent field - using aiAgentSettings system only
    // Legacy personalityResponses field removed - using aiAgentSettings.responseCategories instead
    learningSettings: { type: learningSettingsSchema, default: () => ({}) },
    
    // Legacy agentPersonalitySettings removed - using aiAgentSettings.personalitySystem instead
    
    // 📚 REMOVED: Legacy hardcoded knowledge settings - All settings now come from aiAgentSettings UI configuration
    // This ensures true multi-tenant isolation where each company configures their own priorities and thresholds
    
    // ☢️ NUCLEAR ELIMINATION: agentPriorityConfig removed - legacy priority system eliminated
    
    // 🚨 AI AGENT SETTINGS - EMERGENCY RESTORE (2025-11-26)
    // This field was removed but v2AIAgentRuntime still requires it
    // Contains: enabled flag, voiceSettings, and other AI configuration
    // ============================================================================
    // 🗑️ REMOVED: Duplicate aiAgentSettings Mixed type (was conflicting with structured schema)
    // The full aiAgentSettings schema is defined below at line ~455
    // ============================================================================
    
    // ============================================================================
    // 🚀 INTELLIGENCE MODE SELECTOR - Global vs Custom Settings
    // ============================================================================
    // PURPOSE: Enforce mutually exclusive intelligence configuration modes
    // OPTIONS: 
    //   - 'global': Uses platform-wide AdminSettings (99% of companies)
    //   - 'custom': Uses company-specific aiAgentSettings (premium feature)
    // PROTECTION: Enum validation + audit logging on mode switches
    // BUSINESS LOGIC:
    //   - When 'global': aiAgentSettings is ignored, AdminSettings used
    //   - When 'custom': Company's own aiAgentSettings used independently
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
    // 🔒 CHEATSHEET CATEGORY (Global Configuration Sharing)
    // ============================================================================
    // PURPOSE: Lock company to a specific category for Global Config sharing
    // SCOPE: Version History → Global Configurations feature only
    // LIFECYCLE: Once set, this is locked (cannot be changed without override)
    // EXAMPLES: HVAC, Plumbing, Dental, Legal, etc.
    // ============================================================================
    cheatSheetCategoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GlobalCategory',
        default: null
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
        // COMPANY LOCAL SCENARIOS - Custom template for company-specific scenarios
        // -------------------------------------------------------------------
        // Separate from global templates - stores niche/custom scenarios
        // that shouldn't pollute the global template
        customTemplateId: {
            type: String,
            trim: true,
            default: null
            // References a template in GlobalInstantResponseTemplate that is
            // specific to this company (e.g., "ABC Company - Custom Services")
        },
        
        // Service context description for GPT-4 to understand what custom
        // services this company offers (used when generating local scenarios)
        localServiceContext: {
            type: String,
            trim: true,
            default: ''
            // Example: "Fixture installation including chandeliers, ceiling fans,
            // decorative lighting, and custom electrical work"
        },
        
        // -------------------------------------------------------------------
        // SERVICE TOGGLES - Enable/disable services per company
        // -------------------------------------------------------------------
        // Controls which template categories (services) are active for this company
        // Runtime filters scenarios + provides deterministic decline for disabled services
        // 
        // Schema per serviceKey:
        // {
        //   enabled: boolean,                    // Service on/off
        //   overrideKeywords: [string],          // Extra keywords for intent detection
        //   overrideDeclineMessage: string       // Custom decline message
        // }
        //
        // If a serviceKey is not present, uses template's defaultEnabled value
        services: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
            // Example:
            // {
            //   duct_cleaning: { enabled: false, overrideDeclineMessage: "We don't do ducts" },
            //   dryer_vent: { enabled: true },
            //   commercial: { enabled: false }
            // }
        },

        // -------------------------------------------------------------------
        // BUSINESS HOURS (canonical, trade-agnostic)
        // -------------------------------------------------------------------
        // Used by:
        // - AfterHoursEvaluator (single source of truth)
        //
        // Shape (validated in runtime/evaluator; stored as object):
        // {
        //   timezone: "America/New_York",
        //   weekly: { mon:{open:"08:00",close:"17:00"}, ... , sat:null, sun:null },
        //   holidays: ["2026-01-01"]
        // }
        businessHours: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        
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
        // V23 ORCHESTRATION MODE - Precision Frontline-Intel vs Legacy LLM-0
        // -------------------------------------------------------------------
        // PURPOSE: Allow A/B testing of Precision Frontline-Intel V23 vs legacy LLM-0
        // OPTIONS:
        //   - LLM0_FULL: Use existing LLM-0 orchestration (orchestrationEngine.js)
        //   - FRONTLINE_PRECISION_V23: Use Precision Frontline-Intel V23 (380ms, $0.00011/turn)
        // DEFAULT: LLM0_FULL (backward compatible)
        // MIGRATION: Gradually roll out V23 to companies, monitor accuracy, rollback if needed
        orchestrationMode: {
            type: String,
            enum: ['LLM0_FULL', 'FRONTLINE_PRECISION_V23'],
            default: 'LLM0_FULL',
            index: true
        },
        
        // -------------------------------------------------------------------
        // 🤖 LLM CONFIGURATION - Per-Company Model Selection
        // -------------------------------------------------------------------
        // PURPOSE: Allow companies to choose their LLM model for routing decisions
        // DEFAULT: gpt-4o-mini (fast, cheap, sufficient for 95% of use cases)
        // PREMIUM: gpt-4o (slower, expensive, better for complex trades)
        // CONFIGURED VIA: Live Agent Status tab in Control Plane
        // USED BY: MicroLLMRouter.js for Frontline-Intel routing
        llmConfig: {
            routingModel: {
                type: String,
                enum: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
                default: 'gpt-4o-mini'
            },
            // Cost tracking
            estimatedCostPer1000Calls: {
                type: Number,
                default: 0.08  // $0.08 for gpt-4o-mini
            },
            // Performance expectations
            expectedLatencyMs: {
                type: Number,
                default: 500  // 500ms for gpt-4o-mini
            },
            // Last changed
            lastUpdatedAt: { type: Date, default: null },
            lastUpdatedBy: { type: String, default: null }
        },
        
        // -------------------------------------------------------------------
        // V22 MEMORY OPTIMIZATION - AI Maturity & Performance Tracking
        // -------------------------------------------------------------------
        // PURPOSE: Track company's AI learning progress and optimization stats
        // LIFECYCLE: LEARNING → MATURE → ULTRA_LEAN (auto-promoted by MemoryOptimizationEngine)
        // BENEFITS: Companies that mature use 0% LLM calls, saving ~$0.50/call
        aiMaturityLevel: {
            type: String,
            enum: ['LEARNING', 'MATURE', 'ULTRA_LEAN'],
            default: 'LEARNING'
        },
        optimizationStats: {
            lastEvaluatedAt: { type: Date, default: null },
            last30Days: {
                llmUsageRate: { type: Number, default: 1.0 },      // 1.0 = 100% LLM, 0.0 = 0% LLM
                cacheHitRate: { type: Number, default: 0.0 },      // Cache hits / total calls
                successRate: { type: Number, default: 0.0 },       // Successful resolutions
                totalCalls: { type: Number, default: 0 },          // Total calls in window
                totalLLMCalls: { type: Number, default: 0 },       // Calls that used LLM
                totalCachedCalls: { type: Number, default: 0 }     // Calls resolved from cache
            }
        },
        
        // ☢️ NUKED Feb 2026: cheatSheet - legacy system replaced by Agent 2.0 architecture
        // All cheatSheet functionality (edgeCases, transferRules, guardrails, etc.) is DEAD
        // Do NOT add any cheatSheet references back. Use Agent 2.0 systems instead.
        
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
        // V36: NAME STOP WORDS - Words that should NEVER be extracted as names
        // -------------------------------------------------------------------
        // These words are filtered out during name extraction to prevent false positives
        // Example: "I am trying to see if..." should NOT extract "to see" as a name
        // Inherited from template + custom additions (same pattern as fillers)
        nameStopWords: {
            enabled: { type: Boolean, default: true },
            // Custom company-specific stop words (editable in UI)
            custom: { 
                type: [String], 
                default: [] 
            }
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
        // VOICE SETTINGS - ElevenLabs TTS Configuration
        // -------------------------------------------------------------------
        // Migrated from aiAgentSettings.voiceSettings (nuked 2025-11-20)
        voiceSettings: {
            apiSource: { 
                type: String, 
                enum: ['clientsvia', 'own'], 
                default: 'clientsvia' 
            },
            apiKey: { 
                type: String, 
                trim: true, 
                default: null
            },
            voiceId: { 
                type: String, 
                trim: true, 
                default: null 
            },
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
                default: 0
            },
            speechDetection: {
                // V87: Lowered from 3s to 1.5s - 3s creates guaranteed dead air floor!
                speechTimeout: {
                    type: Number,
                    min: 1,
                    max: 10,
                    default: 1.5
                },
                initialTimeout: {
                    type: Number,
                    min: 3,
                    max: 15,
                    default: 5
                },
                bargeIn: {
                    type: Boolean,
                    default: false
                },
                enhancedRecognition: {
                    type: Boolean,
                    default: true
                },
                speechModel: {
                    type: String,
                    enum: ['default', 'numbers_and_commands', 'phone_call'],
                    default: 'phone_call'
                }
            },
            // -------------------------------------------------------------------
            // CALL EXPERIENCE SETTINGS - Response Timing & Voice (Dec 2025)
            // -------------------------------------------------------------------
            // These settings control how the AI listens, responds, and speaks
            // "Natural Flow Mode" is a preset that optimizes for conversation timing
            callExperience: {
                // === Response Timing ===
                // V87: Lowered from 3.0 to 1.5s - 3s creates guaranteed dead air floor!
                speechTimeout: { type: Number, default: 1.5, min: 1, max: 5 },     // Wait after caller stops
                endSilenceTimeout: { type: Number, default: 2.0, min: 0.5, max: 3 }, // Extra silence detection
                initialTimeout: { type: Number, default: 5, min: 3, max: 15 },     // Wait for caller to start
                
                // === Interruption Behavior ===
                allowInterruption: { type: Boolean, default: false },              // Barge-in enabled
                interruptSensitivity: { 
                    type: String, 
                    enum: ['low', 'medium', 'high'], 
                    default: 'medium' 
                },
                
                // === Voice & Speed ===
                speakingSpeed: { type: Number, default: 1.0, min: 0.8, max: 1.5 }, // TTS speed multiplier
                pauseBetweenSentences: { type: Number, default: 0.3, min: 0, max: 0.5 }, // Micro-pause
                
                // === AI Behavior ===
                llmTimeout: { type: Number, default: 6, min: 2, max: 10 },         // Max LLM wait
                maxSilenceBeforePrompt: { type: Number, default: 8, min: 3, max: 15 }, // "Still there?" trigger
                responseLength: { 
                    type: String, 
                    enum: ['short', 'medium', 'long'], 
                    default: 'medium' 
                },
                
                // === Preset Flag ===
                naturalFlowMode: { type: Boolean, default: false },                // Is Natural Flow Mode active?
                updatedAt: { type: Date, default: Date.now }
            },
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
        
        // -------------------------------------------------------------------
        // TRANSFER TARGETS - Phone numbers for call escalation
        // -------------------------------------------------------------------
        // Used by Call Protection rules (force_transfer action)
        // and runtime escalation flows
        // PATH: aiAgentSettings.transferTargets (NOT inside voiceSettings!)
        transferTargets: [{
            id: { type: String, required: true, trim: true },  // e.g., "service_advisor", "manager"
            name: { type: String, trim: true },                 // Display name
            label: { type: String, trim: true },                // UI label
            type: { type: String, enum: ['phone', 'queue', 'sip'], default: 'phone' },
            destination: { type: String, trim: true },          // Phone number or queue ID
            description: { type: String, trim: true },          // Help text
            priority: { type: Number, default: 1 },
            enabled: { type: Boolean, default: true },
            isDefault: { type: Boolean, default: false },       // Default escalation target
            afterHoursOnly: { type: Boolean, default: false },  // Only route here after hours
            whisper: { type: String, trim: true },              // Message to agent before connecting
            preTransferScript: { type: String, trim: true }     // What to say to caller before transfer
        }],
        
        // -------------------------------------------------------------------
        // LLM-0 CONTROLS - Call Edge Case Handling (Cleaned Feb 2026)
        // -------------------------------------------------------------------
        // ☢️ NUKED Feb 2026: loopDetection, spamFilter, bailoutRules, confidenceThresholds
        // These were never consumed at runtime - dead code removed.
        // 
        // KEPT (actually used):
        // - silenceHandling: EdgeCaseHandler.js uses for silence prompts
        // - customerPatience: EdgeCaseHandler.js uses for never-hangup mode
        // - lowConfidenceHandling: v2twilio.js uses for STT quality guard
        // - recoveryMessages: v2twilio.js uses for audio unclear/cutout messages
        // - frustrationDetection: Escalation trigger keywords
        // -------------------------------------------------------------------
        llm0Controls: {
            // SILENCE HANDLING - Used by EdgeCaseHandler.js
            silenceHandling: {
                enabled: { type: Boolean, default: true },
                thresholdSeconds: { type: Number, default: 5, min: 2, max: 30 },
                firstPrompt: { 
                    type: String, 
                    default: "I'm still here. Take your time.",
                    trim: true
                },
                secondPrompt: { 
                    type: String, 
                    default: "Are you still there? I'm happy to wait.",
                    trim: true
                },
                thirdPrompt: { 
                    type: String, 
                    default: "If you need a moment, I can call you back. Just let me know.",
                    trim: true
                },
                maxPrompts: { type: Number, default: 3, min: 1, max: 5 },
                offerCallback: { type: Boolean, default: true },
                callbackMessage: {
                    type: String,
                    default: "Would you like me to have someone call you back at this number?",
                    trim: true
                }
            },
            // CUSTOMER PATIENCE MODE - Used by EdgeCaseHandler.js
            customerPatience: {
                enabled: { type: Boolean, default: true },
                neverAutoHangup: { type: Boolean, default: true },
                maxPatiencePrompts: { type: Number, default: 5, min: 2, max: 10 },
                alwaysOfferCallback: { type: Boolean, default: true },
                patienceMessage: {
                    type: String,
                    default: "No rush at all. I'm here whenever you're ready.",
                    trim: true
                }
            },
            // LOW CONFIDENCE HANDLING - STT Quality Guard (Dec 2025)
            // When STT confidence is low, don't guess - ask caller to repeat
            // This prevents wrong interpretations, missed bookings, and bad UX
            lowConfidenceHandling: {
                enabled: { type: Boolean, default: true },
                // Threshold (0-100%) - below this, ask to repeat
                threshold: { type: Number, default: 60, min: 30, max: 90 },
                // Action when confidence is low
                action: { 
                    type: String, 
                    enum: ['repeat', 'guess_with_context', 'accept'],
                    default: 'repeat'
                    // repeat = ask caller to say again (safest)
                    // guess_with_context = use conversation history to infer (future)
                    // accept = trust low-confidence transcript anyway (risky)
                },
                // Phrase to ask caller to repeat
                repeatPhrase: {
                    type: String,
                    default: "Sorry, there's some background noise — could you say that again?",
                    trim: true
                },
                // Max times to ask for repeat before escalation
                maxRepeatsBeforeEscalation: { type: Number, default: 2, min: 1, max: 5 },
                // Phrase when escalating after max repeats
                escalatePhrase: {
                    type: String,
                    default: "I'm having trouble hearing you clearly. Let me get someone to help you.",
                    trim: true
                },
                // Preserve booking mode during low confidence (don't break the flow)
                preserveBookingOnLowConfidence: { type: Boolean, default: true },
                // Special phrase for booking flow interruption
                bookingRepeatPhrase: {
                    type: String,
                    default: "Sorry — could you say that again so I can get this right?",
                    trim: true
                },
                // Log low-confidence events to Black Box for training
                logToBlackBox: { type: Boolean, default: true },
                // Skip confirmation if caller repeats clearly (prevents double-confirmation annoyance)
                skipConfirmationOnClearRepeat: { type: Boolean, default: true },
                // DEEPGRAM FALLBACK - Hybrid STT (Premium Feature)
                // When Twilio confidence is low, try Deepgram instead of asking to repeat
                useDeepgramFallback: { type: Boolean, default: true },
                // Threshold to trigger Deepgram (0-100%) - usually same as main threshold
                deepgramFallbackThreshold: { type: Number, default: 60, min: 30, max: 90 },
                // Only accept Deepgram result if confidence is above this (0-100%)
                deepgramAcceptThreshold: { type: Number, default: 80, min: 50, max: 100 }
            },
            // RECOVERY MESSAGES - UI-configurable overrides for STT recovery phrases.
            // Runtime (getRecoveryMessage in v2twilio.js) uses randomized default
            // arrays when these are empty. Values can be strings (legacy) or arrays.
            // Keys: audioUnclear, noSpeech, connectionCutOut, silenceRecovery, etc.
            recoveryMessages: { type: mongoose.Schema.Types.Mixed, default: {} },
            // FRUSTRATION DETECTION - Escalate immediately on emotional keywords
            // Prevents loops when caller is clearly frustrated
            frustrationDetection: {
                enabled: { type: Boolean, default: true },
                // Keywords that trigger immediate escalation
                frustrationKeywords: {
                    type: [String],
                    default: [
                        "that's not what I said",
                        "you're not listening",
                        "this is ridiculous",
                        "I already told you",
                        "are you even listening",
                        "I said no",
                        "stop asking me",
                        "just transfer me",
                        "let me talk to a human",
                        "speak to a person",
                        "real person",
                        "actual human"
                    ]
                },
                // Action when frustration detected
                onFrustration: {
                    type: String,
                    enum: ['escalate', 'apologize_and_escalate', 'apologize_and_continue'],
                    default: 'apologize_and_escalate'
                },
                // Phrase before escalating
                escalationPhrase: {
                    type: String,
                    default: "I understand, and I apologize for any confusion. Let me connect you with someone who can help right away.",
                    trim: true
                },
                // Log frustration events to Black Box
                logToBlackBox: { type: Boolean, default: true }
            },
            // RESPONSE TIMING - Natural-feeling delays
            // Prevents machine-gun responses that feel robotic
            responseTiming: {
                enabled: { type: Boolean, default: true },
                // Random delay range before responding (milliseconds)
                minDelayMs: { type: Number, default: 80, min: 0, max: 500 },
                maxDelayMs: { type: Number, default: 140, min: 50, max: 1000 },
                // Add extra delay after caller finishes speaking
                postSpeechDelayMs: { type: Number, default: 200, min: 0, max: 500 }
            },
            // SMART CONFIRMATION - Prevents wrong decisions on critical actions
            smartConfirmation: {
                enabled: { type: Boolean, default: true },
                // When to ask for explicit confirmation
                confirmTransfers: { type: Boolean, default: true },      // ALWAYS confirm transfers
                confirmBookings: { type: Boolean, default: false },      // Optional for bookings
                confirmEmergency: { type: Boolean, default: true },      // ALWAYS confirm emergencies
                confirmCancellations: { type: Boolean, default: true },  // ALWAYS confirm cancellations
                // Confidence-based confirmation
                confirmBelowConfidence: { type: Number, default: 0.75, min: 0.5, max: 0.95 },
                // Confirmation style
                confirmationStyle: {
                    type: String,
                    enum: ['explicit', 'implicit', 'smart'],  // smart = based on severity
                    default: 'smart'
                },
                // Custom phrases
                transferConfirmPhrase: {
                    type: String,
                    default: "Before I transfer you, I want to make sure - you'd like to speak with a live agent, correct?",
                    trim: true
                },
                bookingConfirmPhrase: {
                    type: String,
                    default: "Just to confirm, you'd like to schedule a service appointment, is that right?",
                    trim: true
                },
                emergencyConfirmPhrase: {
                    type: String,
                    default: "This sounds like an emergency. I want to make sure - should I dispatch someone right away?",
                    trim: true
                },
                lowConfidencePhrase: {
                    type: String,
                    default: "I want to make sure I understand correctly. You're looking for help with {detected_intent}, is that right?",
                    trim: true
                },
                // Response handling
                onYesResponse: {
                    type: String,
                    enum: ['proceed', 'double_confirm'],
                    default: 'proceed'
                },
                onNoResponse: {
                    type: String,
                    enum: ['clarify', 'restart', 'apologize_and_clarify'],
                    default: 'apologize_and_clarify'
                },
                clarifyPhrase: {
                    type: String,
                    default: "I apologize for the confusion. Could you tell me more about what you need help with?",
                    trim: true
                }
            },
            // METADATA
            lastUpdated: { type: Date, default: Date.now },
            updatedBy: { type: String, default: null, trim: true }
        },
        
        // -------------------------------------------------------------------
        // 🛡️ DUPLICATE GATE - Prevents duplicate scenario creation (Feb 2026)
        // -------------------------------------------------------------------
        // Blocks scenarios that are too similar to existing ones
        // Uses OpenAI embeddings for semantic similarity comparison
        // Enforced at: scenario approval, import, and generation
        // -------------------------------------------------------------------
        duplicateGate: {
            // Master toggle - disable to allow all scenarios through
            enabled: { type: Boolean, default: true },
            
            // Similarity threshold (0.0 - 1.0)
            // 0.86 = ~86% similar, good balance of catch vs false positives
            // Higher = stricter (blocks more), Lower = permissive (allows more)
            threshold: { 
                type: Number, 
                default: 0.86, 
                min: 0.5, 
                max: 0.99 
            },
            
            // Action when duplicate detected
            // 'block': Hard block - return error and don't save
            // 'warn': Soft block - save but flag for review
            onDuplicate: {
                type: String,
                enum: ['block', 'warn'],
                default: 'block'
            },
            
            // Force admin override capability
            // If true, admin can bypass with ?force=true query param
            allowOverride: { type: Boolean, default: true },
            
            // Log all blocked/warned scenarios for audit
            logToAudit: { type: Boolean, default: true },
            
            // METADATA
            lastUpdated: { type: Date, default: Date.now },
            updatedBy: { type: String, default: null, trim: true }
        },
        
        // -------------------------------------------------------------------
        // 🎯 CALL FLOW ENGINE - Universal Flow Routing (Dec 2025)
        // -------------------------------------------------------------------
        // PURPOSE: Replace giant frontline scripts with code-driven flow decisions
        // ARCHITECTURE:
        //   - MissionCacheService: Auto-extracts triggers from triage/scenarios
        //   - FlowEngine: decideFlow() with priority ladder
        //   - BookingFlowEngine: State machine for each flow
        //   - LLM: Only generates words, doesn't make decisions
        // FLOWS: BOOKING, CANCEL, RESCHEDULE, TRANSFER, MESSAGE, EMERGENCY, GENERAL
        // -------------------------------------------------------------------
        callFlowEngine: {
            // Master toggle
            enabled: { type: Boolean, default: true }, // ON by default - production ready
            
            // ═══════════════════════════════════════════════════════════════
            // MISSION TRIGGERS - Auto-extracted + Manual Overrides
            // ═══════════════════════════════════════════════════════════════
            // Structure: { _default: { booking: {...}, emergency: {...} }, hvac: {...}, plumbing: {...} }
            missionTriggers: {
                type: mongoose.Schema.Types.Mixed,
                default: () => ({
                    _default: {
                        booking: { auto: [], manual: [], all: [], sources: {} },
                        emergency: { auto: [], manual: [], all: [], sources: {} },
                        cancel: { auto: [], manual: [], all: [], sources: {} },
                        reschedule: { auto: [], manual: [], all: [], sources: {} },
                        transfer: { auto: [], manual: [], all: [], sources: {} },
                        message: { auto: [], manual: [], all: [], sources: {} }
                    }
                })
            },
            
            // ═══════════════════════════════════════════════════════════════
            // BOOKING FIELDS - Configurable data collection
            // ═══════════════════════════════════════════════════════════════
            bookingFields: [{
                key: { type: String, required: true, trim: true },
                label: { type: String, required: true, trim: true },
                required: { type: Boolean, default: false },
                order: { type: Number, default: 0 },
                prompt: { type: String, trim: true },
                validation: { type: String, enum: ['none', 'phone', 'email', 'address'], default: 'none' }
            }],
            
            // ═══════════════════════════════════════════════════════════════
            // STYLE CONFIGURATION - Short, for LLM tone only
            // ═══════════════════════════════════════════════════════════════
            style: {
                preset: {
                    type: String,
                    enum: ['friendly', 'professional', 'casual', 'formal'],
                    default: 'friendly'
                },
                // Max ~300 words - enforced in UI
                customNotes: {
                    type: String,
                    maxLength: 2000,
                    default: '',
                    trim: true
                },
                // Greeting override
                greeting: { type: String, trim: true, default: '' },
                // Company name for personalization
                companyName: { type: String, trim: true, default: '' }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // QUICK ANSWERS - Common questions with instant responses
            // ═══════════════════════════════════════════════════════════════
            // NO LEGACY CONNECTION - Fresh implementation 2025-12
            // Structure: Array of { question, answer, triggers[], category }
            quickAnswers: [{
                id: { type: String, required: true },
                // The question this answers
                question: { type: String, required: true, trim: true },
                // The answer to give
                answer: { type: String, required: true, trim: true },
                // Trigger phrases that match this Q&A
                triggers: [{ type: String, trim: true }],
                // Category for organization
                category: { 
                    type: String, 
                    enum: ['hours', 'pricing', 'service_area', 'services', 'policies', 'general'],
                    default: 'general'
                },
                // Is this active?
                enabled: { type: Boolean, default: true },
                // Priority for matching (higher = checked first)
                priority: { type: Number, default: 0 }
            }],
            
            // ═══════════════════════════════════════════════════════════════
            // SYNONYM MAP - For better trigger matching
            // ═══════════════════════════════════════════════════════════════
            // Structure: { "reschedule": ["move my appointment", "change the time"], ... }
            synonymMap: {
                type: mongoose.Schema.Types.Mixed,
                default: () => ({})
            },
            
            // ═══════════════════════════════════════════════════════════════
            // CUSTOM BLOCKERS - Negative triggers per flow
            // ═══════════════════════════════════════════════════════════════
            // Structure: { cancel: ["don't cancel", "not cancel"], ... }
            customBlockers: {
                type: mongoose.Schema.Types.Mixed,
                default: () => ({})
            },
            
            // ═══════════════════════════════════════════════════════════════
            // TRADE CONFIGURATION - For multi-trade companies
            // ═══════════════════════════════════════════════════════════════
            trades: [{
                key: { type: String, required: true, trim: true }, // 'hvac', 'plumbing', etc.
                label: { type: String, required: true, trim: true },
                enabled: { type: Boolean, default: true }
            }],
            activeTrade: { type: String, default: '_default', trim: true },
            
            // ═══════════════════════════════════════════════════════════════
            // LEGACY SCRIPT (Read-only, deprecated)
            // ═══════════════════════════════════════════════════════════════
            legacyFrontlineScript: { type: String, default: '' },
            legacyScriptActive: { type: Boolean, default: false },
            
            // ═══════════════════════════════════════════════════════════════
            // METADATA
            // ═══════════════════════════════════════════════════════════════
            lastCacheRebuild: { type: Date, default: null },
            lastUpdated: { type: Date, default: Date.now },
            updatedBy: { type: String, default: null, trim: true }
        },
        
        // -------------------------------------------------------------------
        // SERVICE TYPE CLARIFICATION - "Is this repair or maintenance?"
        // -------------------------------------------------------------------
        // CRITICAL: Determines which CALENDAR to book into!
        // "I need AC service" is AMBIGUOUS - could be repair or maintenance
        // This system asks for clarification before routing to booking.
        // 
        // Template-level defaults are in ServiceTypeClarifier.js
        // Company overrides are stored here.
        // -------------------------------------------------------------------
        serviceTypeClarification: {
            // Master toggle
            enabled: { type: Boolean, default: true },
            
            // ═══════════════════════════════════════════════════════════════
            // AMBIGUOUS PHRASES - Trigger clarification question
            // ═══════════════════════════════════════════════════════════════
            // When caller uses these WITHOUT clear repair/maintenance keywords
            // e.g., "I need service" → ambiguous → ask which type
            ambiguousPhrases: [{
                type: String,
                trim: true,
                lowercase: true
            }],
            
            // ═══════════════════════════════════════════════════════════════
            // CLARIFICATION QUESTION - Asked when ambiguous
            // ═══════════════════════════════════════════════════════════════
            clarificationQuestion: {
                type: String,
                trim: true,
                default: "Absolutely — is this for a repair issue, or routine maintenance and tune-up?"
            },
            
            // ═══════════════════════════════════════════════════════════════
            // SERVICE TYPES - Each type has keywords and calendar mapping
            // ═══════════════════════════════════════════════════════════════
            serviceTypes: [{
                key: { type: String, required: true, trim: true, lowercase: true },
                label: { type: String, required: true, trim: true },
                keywords: [{
                    type: String,
                    trim: true,
                    lowercase: true
                }],
                calendarId: { type: String, default: null, trim: true },
                priority: { type: Number, default: 99 }, // Lower = higher priority
                enabled: { type: Boolean, default: true }
            }],
            
            // ═══════════════════════════════════════════════════════════════
            // METADATA
            // ═══════════════════════════════════════════════════════════════
            lastUpdated: { type: Date, default: Date.now },
            updatedBy: { type: String, default: null, trim: true }
        },
        
        // -------------------------------------------------------------------
        // ☢️ NUKED Feb 2026: FRONT DESK BEHAVIOR - LEGACY SCHEMA (DO NOT USE)
        // -------------------------------------------------------------------
        // This entire namespace is deprecated and scheduled for removal.
        // All functionality has been migrated to Agent 2.0 namespace.
        // 
        // Schema is preserved temporarily for database migration only.
        // DO NOT add new fields here.
        // DO NOT read from frontDeskBehavior in new code.
        // 
        // MIGRATION PATH: aiAgentSettings.agent2.* replaces frontDeskBehavior.*
        // -------------------------------------------------------------------
        frontDeskBehavior: {
            // Master toggle
            enabled: { type: Boolean, default: true },
            
            // ═══════════════════════════════════════════════════════════════
            // V111: STT PROTECTED WORDS - Company-specific words that must
            // never be stripped by filler removal, even if they appear in
            // the global STT template's filler list. Configured via UI in
            // Discovery Flow tab → Protected Words button.
            // Each item: { word: String, category: String }
            // ═══════════════════════════════════════════════════════════════
            sttProtectedWords: { type: mongoose.Schema.Types.Mixed, default: [] },
            
            // ═══════════════════════════════════════════════════════════════
            // V92: DEBUG LOGGING - Enhanced diagnostics for consent/booking flow
            // ═══════════════════════════════════════════════════════════════
            // When enabled, adds verbose logging at key checkpoints:
            // - Consent detection (what phrases matched/didn't match)
            // - Booking trigger decision (why it did/didn't enter booking)
            // - Booking snap response (full response and state)
            // Use for debugging specific company issues, disable in production
            debugLogging: { type: Boolean, default: false },
            
            // ═══════════════════════════════════════════════════════════════
            // PERSONALITY SETTINGS
            // ═══════════════════════════════════════════════════════════════
            personality: {
                agentName: { type: String, trim: true, default: '' },   // AI receptionist name (e.g., "Sarah", "Alex") - empty = no name
                tone: { type: String, enum: ['warm', 'professional', 'casual', 'formal'], default: 'warm' },
                verbosity: { type: String, enum: ['concise', 'balanced', 'detailed'], default: 'concise' },
                maxResponseWords: { type: Number, default: 30, min: 10, max: 100 },
                useCallerName: { type: Boolean, default: true },
                // V79: STYLE DEPTH CONTROLS (UI Controlled)
                // These are simple behavior knobs that influence how the LLM speaks.
                // They must be visible/editable in UI (no hidden magic).
                // warmth: 0.0 (cold/strict) → 1.0 (very warm)
                warmth: { type: Number, default: 0.6, min: 0, max: 1 },
                // speakingPace: how quickly the assistant moves through questions
                speakingPace: { type: String, enum: ['slow', 'normal', 'fast'], default: 'normal', trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // CONVERSATION STYLE - How the AI approaches booking
            // ═══════════════════════════════════════════════════════════════
            // confident: "Let's get you scheduled" - assumptive, decisive, guides caller
            // balanced: "I can help with that" - friendly, natural, universal default
            // polite: "Would you like me to...?" - deferential, respects autonomy
            // ═══════════════════════════════════════════════════════════════
            conversationStyle: { 
                type: String, 
                enum: ['confident', 'balanced', 'polite'], 
                default: 'balanced' 
            },
            
            // ═══════════════════════════════════════════════════════════════
            // STYLE ACKNOWLEDGMENTS - Custom phrases for each conversation style
            // 🚨 UI-CONTROLLED - These replace hardcoded acknowledgments
            // ═══════════════════════════════════════════════════════════════
            styleAcknowledgments: {
                confident: { type: String, trim: true, default: "Let's get this taken care of." },
                balanced: { type: String, trim: true, default: "I can help with that!" },
                polite: { type: String, trim: true, default: "I'd be happy to help." }
            },

            // ═══════════════════════════════════════════════════════════════
            // CONVERSATION STYLE: OPENERS
            // ═══════════════════════════════════════════════════════════════
            // Pre-prompt micro-acknowledgments that fire instantly when the
            // caller speaks. Eliminates dead air while LLM/scenario processes.
            //
            // Architecture: This is Layer 0 — runs BEFORE Discovery, scenarios,
            // or LLM. The opener is prepended to the final response so the
            // caller hears "Alright." or "I hear you." immediately.
            //
            // Config hierarchy:
            //   Global defaults → per-company override
            //   ☢️ NUKED Feb 2026: frontDesk paths removed - use Agent 2.0
            //
            // Modes:
            //   reflect_first: Use reflection template if reason captured,
            //                  else fall back to keyword-matched micro-ack
            //   micro_ack_only: Skip reflection, just use micro-acks
            //   off: No opener prepended
            // ═══════════════════════════════════════════════════════════════
            openers: {
                enabled: { type: Boolean, default: true },
                mode: {
                    type: String,
                    enum: ['reflect_first', 'micro_ack_only', 'off'],
                    default: 'reflect_first'
                },
                // General-purpose micro-acks (no frustration/urgency detected)
                general: [{
                    type: String, trim: true
                }],
                // Frustration-detected micro-acks
                frustration: [{
                    type: String, trim: true
                }],
                // Urgency-detected micro-acks
                urgency: [{
                    type: String, trim: true
                }],
                // Keywords that trigger urgency ack selection
                urgencyKeywords: [{
                    type: String, trim: true, lowercase: true
                }],
                // Keywords that trigger frustration ack selection
                frustrationKeywords: [{
                    type: String, trim: true, lowercase: true
                }],
                // Template for reflect_first mode
                // Placeholder: {reason_short}
                reflectionTemplate: {
                    type: String,
                    trim: true,
                    default: '{reason_short} — okay.'
                }
            },

            // ═══════════════════════════════════════════════════════════════
            // V110 RESPONSE TEMPLATES — "Discovery Before Discovery"
            // ═══════════════════════════════════════════════════════════════
            // Configurable response patterns for the three V110 phases.
            // These drive the LLM prompt rules so the agent responds
            // naturally based on what was captured vs what's missing.
            //
            // Phase 1 (Pre-Acceptance): Scenario speaks, funnel to scheduling
            // Phase 2 (Post-Acceptance, collecting): Confirm captured, ask missing
            // Phase 3 (Post-Acceptance, complete): Proceed to booking
            // ═══════════════════════════════════════════════════════════════
            discoveryResponseTemplates: {
                // Phase 1: Pre-acceptance — scenario acknowledges + offers scheduling
                preAcceptance: {
                    // How the agent offers scheduling after acknowledging the issue
                    schedulingOffer: { type: String, trim: true, default: 'Would you like me to schedule a service call?' },
                    // Rule: never assume scheduling — always ASK
                    neverAssume: { type: String, trim: true, default: 'NEVER say "Let me get you scheduled" — ASK first.' },
                    // Implicit consent phrases that skip the offer
                    implicitConsentNote: { type: String, trim: true, default: 'If caller says "I need service" / "send someone" / "come out" — that IS consent. Proceed to confirm.' }
                },
                // Phase 2: Post-acceptance — confirm captured, ask missing
                postAcceptance: {
                    // Template for confirming a captured slot
                    confirmTemplate: { type: String, trim: true, default: 'I have your {field} as {value} — is that correct?' },
                    // Template for asking a missing slot
                    askTemplates: {
                        name: { type: String, trim: true, default: "What's your first and last name?" },
                        phone: { type: String, trim: true, default: 'Is the number you\'re calling from the best one for text updates?' },
                        address: { type: String, trim: true, default: "What's the full service address?" }
                    },
                    // Combined confirm+ask example
                    combinedExample: { type: String, trim: true, default: 'I have you at {address} — is that correct? And is the number you\'re calling from the best one for text updates?' },
                    // Closer — end of info collection turn
                    closer: { type: String, trim: true, default: 'Once you confirm, I\'ll get this scheduled.' }
                },
                // Phase 3: Post-acceptance + complete — all info captured
                allCaptured: {
                    proceedMessage: { type: String, trim: true, default: 'Perfect — I have everything I need. Let me get this scheduled.' }
                }
            },

            // ═══════════════════════════════════════════════════════════════
            // VENDOR / SUPPLIER CALL HANDLING (Call Center Directory)
            // ═══════════════════════════════════════════════════════════════
            // Purpose: If an inbound caller matches a Vendor by phone, treat them as
            // a NON-CUSTOMER caller (do not create Customer placeholders).
            //
            // NOTE: This must be fully UI-controlled and visible in runtime-truth.
            //
            // vendorFirstEnabled:
            // - true: vendor directory lookup happens before CustomerLookup at call start
            // - false: legacy behavior (always treat caller as customer)
            //
            // enabled:
            // - true: runtime may run a dedicated vendor "take-a-message" flow
            // - false: runtime only tags callerType=vendor and continues normal flow
            vendorHandling: {
                vendorFirstEnabled: { type: Boolean, default: false },
                enabled: { type: Boolean, default: false },
                mode: {
                    type: String,
                    enum: ['collect_message', 'transfer', 'ignore'],
                    default: 'collect_message'
                },
                allowLinkToCustomer: { type: Boolean, default: false },
                prompts: {
                    // DEFAULT - OVERRIDE IN UI
                    greeting: { type: String, trim: true, default: "Thanks for calling. How can we help?" },
                    askSummary: { type: String, trim: true, default: "What can I help you with today?" },
                    askOrderNumber: { type: String, trim: true, default: "Do you have an order number or invoice number I should note?" },
                    askCustomerName: { type: String, trim: true, default: "Which customer is this regarding?" },
                    completion: { type: String, trim: true, default: "Got it. I’ll make sure the team gets this message right away." },
                    transferMessage: { type: String, trim: true, default: "Thank you. Let me connect you to our team." }
                }
            },

            // ═══════════════════════════════════════════════════════════════
            // UNIT OF WORK (UoW) - Universal multi-location / multi-job container
            // ═══════════════════════════════════════════════════════════════
            // This generalizes "work orders", "delivery stops", "appointments", etc.
            //
            // Enterprise-safe default:
            // - 1 unit of work per call
            // - only create additional units after explicit confirmation
            //
            // CRITICAL:
            // - All prompts/labels must be UI-controlled (multi-tenant, multi-trade)
            // - If not configured in UI, defaults below are safety nets only.
            unitOfWork: {
                enabled: { type: Boolean, default: false },
                allowMultiplePerCall: { type: Boolean, default: false },
                maxUnitsPerCall: { type: Number, default: 3, min: 1, max: 10 },

                // UI labels only (do NOT drive runtime logic)
                labelSingular: { type: String, trim: true, default: 'Job' },   // DEFAULT - OVERRIDE IN UI
                labelPlural: { type: String, trim: true, default: 'Jobs' },     // DEFAULT - OVERRIDE IN UI

                // Which bookingSlots should be re-collected per unit-of-work
                // Example: ['address', 'time', 'issue']
                perUnitSlotIds: { type: [String], default: ['address'] },

                // Confirmation gating (explicit request required)
                confirmation: {
                    // DEFAULT - OVERRIDE IN UI
                    askAddAnotherPrompt: { type: String, trim: true, default: "Is this for just this location, or do you have another location to add today?" },
                    clarifyPrompt: { type: String, trim: true, default: "Just to confirm — do you have another location or job to add today?" },
                    nextUnitIntro: { type: String, trim: true, default: "Okay — let’s get the details for the next one." },
                    // Final message when multiple units were captured (avoid single-address wording)
                    finalScriptMulti: { type: String, trim: true, default: "Perfect — I’ve got both locations. Our team will take it from here." },
                    yesWords: { type: [String], default: ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'another', 'one more'] },
                    noWords: { type: [String], default: ['no', 'nope', 'nah', 'just this', 'only this', 'that’s it', "that's it", 'all set'] }
                }
            },

            // ═══════════════════════════════════════════════════════════════
            // AFTER-HOURS MESSAGE CONTRACT (Deterministic message capture)
            // ═══════════════════════════════════════════════════════════════
            // Enterprise intent:
            // - Default: after-hours "message-taking" asks the booking minimum
            // - Optional: allow a separate after-hours contract (lighter/stricter)
            //
            // IMPORTANT:
            // - This is not trade-specific language; it's just required field keys.
            // - Prompt phrasing should come from existing company scripts (protocols/slots).
            afterHoursMessageContract: {
                mode: {
                    type: String,
                    enum: ['inherit_booking_minimum', 'custom'],
                    default: 'inherit_booking_minimum'
                },
                // Ordered list of required "fields" for after-hours message capture.
                // Supported values:
                // - built-ins: name, phone, address, problemSummary, preferredTime
                // - booking slot ids: any string that matches a bookingSlots slot id
                requiredFieldKeys: {
                    type: [String],
                    default: ['name', 'phone', 'address', 'problemSummary', 'preferredTime']
                },
                // Optional additional booking slot ids (collected as extra fields)
                extraSlotIds: { type: [String], default: [] }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // BOOKING SLOTS - Dynamic, customizable slots for booking
            // 🚨 AUTO-SEEDED on company creation - no hardcoded fallbacks elsewhere
            // ═══════════════════════════════════════════════════════════════
            bookingSlots: {
                type: [{
                    // ═══════════════════════════════════════════════════════════════
                    // CORE FIELDS (all slot types)
                    // ═══════════════════════════════════════════════════════════════
                    id: { type: String, required: true }, // e.g., 'name', 'phone', 'custom_insurance'
                    label: { type: String, required: true }, // Display name: "Full Name", "Phone Number"
                    question: { type: String, required: true }, // What AI asks: "May I have your full name?"
                    required: { type: Boolean, default: true },
                    order: { type: Number, default: 0 }, // For sorting
                    type: { 
                        type: String, 
                        enum: ['name', 'phone', 'address', 'email', 'date', 'time', 'datetime', 'select', 'yesno', 'number', 'text', 'textarea', 'custom'], 
                        default: 'text' 
                    },
                    validation: { type: String, default: null }, // Regex pattern for custom validation
                    confirmBack: { type: Boolean, default: false }, // Repeat value back for confirmation
                    confirmPrompt: { type: String, default: "Just to confirm, that's {value}, correct?" },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // ADVANCED OPTIONS (all slot types)
                    // ═══════════════════════════════════════════════════════════════
                    skipIfKnown: { type: Boolean, default: false }, // Skip for returning customers
                    helperNote: { type: String, default: null }, // Internal AI guidance note
                    
                    // ═══════════════════════════════════════════════════════════════
                    // 🆕 FEB 2026: PRODUCTION HARDENING FIELDS
                    // ═══════════════════════════════════════════════════════════════
                    // These fields are required for the deterministic BookingLogicEngine
                    maxAttempts: { type: Number, default: 3, min: 1, max: 10 }, // Strikes before escalation
                    allowSkip: { type: Boolean, default: false }, // Can caller skip this slot?
                    sensitive: { type: Boolean, default: false }, // Mask in Call Center UI (membership#, DOB, SSN)
                    retryPrompts: { 
                        type: [String], 
                        default: [] // ["I didn't catch that.", "Let me try again."]
                    },

                    // ═══════════════════════════════════════════════════════════════
                    // V93: MID-CALL HELPERS (SLOT-LEVEL, UI CONTROLLED)
                    // ═══════════════════════════════════════════════════════════════
                    // Handles common "human moments" *while collecting this slot*.
                    // Example: during PHONE slot:
                    // - "why do you need my number?"
                    // - "i gave too many digits"
                    //
                    // IMPORTANT:
                    // - This must NEVER change slot order.
                    // - When it fires, it should clarify and then re-ask the exact slot question.
                    midCallRules: {
                        type: [{
                            id: { type: String, required: true, trim: true }, // stable id for cooldown/max tracking
                            enabled: { type: Boolean, default: true },
                            matchType: { type: String, enum: ['exact', 'contains'], default: 'contains' },
                            trigger: { type: String, required: true, trim: true }, // what caller says
                            action: { type: String, enum: ['reply_reask', 'escalate'], default: 'reply_reask' },
                            // Placeholders: {slotQuestion}, {slotLabel}
                            // Optional (slot-type dependent): {exampleFormat}
                            responseTemplate: { type: String, required: true, trim: true },
                            cooldownTurns: { type: Number, default: 2, min: 0, max: 10 },
                            maxPerCall: { type: Number, default: 2, min: 1, max: 10 }
                        }],
                        default: []
                    },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // NAME-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    askFullName: { type: Boolean, default: true }, // Ask for first + last name
                    useFirstNameOnly: { type: Boolean, default: true }, // When referring back, use first name only
                    askMissingNamePart: { type: Boolean, default: false }, // 🔴 Ask once for missing first/last name
                    // V54: UI-configurable name prompts (no hardcodes!)
                    lastNameQuestion: { type: String, default: "And what's your last name?", trim: true },
                    firstNameQuestion: { type: String, default: "And what's your first name?", trim: true },
                    // V85: Duplicate/unclear last-name recovery (UI-controlled)
                    // Used when caller repeats first name when we asked for last name.
                    // Placeholders: {firstName}, {candidate}, {lastNameQuestion}
                    duplicateNamePartPrompt: {
                        type: String,
                        default: "DEFAULT - OVERRIDE IN UI: I just want to make sure I get this right — I have your first name as {firstName}, and I heard {candidate} for your last name. {lastNameQuestion}",
                        trim: true
                    },
                    // V63: Spelling variant confirmation (Mark/Marc, Brian/Bryan)
                    confirmSpelling: { type: Boolean, default: false }, // Check for spelling variants and confirm with caller
                    spellingVariantPrompt: { type: String, default: "Just to confirm — {optionA} or {optionB}?", trim: true },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // PHONE-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    offerCallerId: { type: Boolean, default: true }, // Offer to use caller ID
                    callerIdPrompt: { type: String, default: "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?" },
                    acceptTextMe: { type: Boolean, default: true }, // Accept "text me" as confirmation
                    breakDownIfUnclear: { type: Boolean, default: false }, // If unclear, ask area code first then rest of number
                    // V54: UI-configurable phone prompts (no hardcodes!)
                    areaCodePrompt: { type: String, default: "Let's go step by step - what's the area code?", trim: true },
                    restOfNumberPrompt: { type: String, default: "Got it. And the rest of the number?", trim: true },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // ADDRESS-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    addressConfirmLevel: { type: String, enum: ['street_only', 'street_city', 'full'], default: 'street_city' },
                    acceptPartialAddress: { type: Boolean, default: false }, // Accept partial if caller unsure
                    breakDownIfUnclear: { type: Boolean, default: false }, // If unclear, ask street → city → zip step by step
                    // V54: UI-configurable address prompts (no hardcodes!)
                    partialAddressPrompt: { type: String, default: "I got part of that. Can you give me the full address including city?", trim: true },
                    cityPrompt: { type: String, default: "And what city?", trim: true },
                    zipPrompt: { type: String, default: "And the zip code?", trim: true },
                    streetBreakdownPrompt: { type: String, default: "Let's go step by step - what's the street address?", trim: true },
                    
                    // 🆕 V35: GOOGLE MAPS ADDRESS VALIDATION
                    // Silent background validation - does NOT drive conversation
                    // Validates, normalizes, and adds confidence without asking extra questions
                    useGoogleMapsValidation: { type: Boolean, default: false }, // Toggle: Enable Google Maps validation
                    googleMapsValidationMode: { 
                        type: String, 
                        enum: ['silent', 'confirm_low_confidence', 'always_confirm'], 
                        default: 'confirm_low_confidence' 
                    },
                    // silent: Never ask, just normalize
                    // confirm_low_confidence: Only ask if Google returns low/medium confidence
                    // always_confirm: Always confirm normalized address
                    
                    // 🆕 V35: UNIT/APARTMENT NUMBER DETECTION (World-Class)
                    unitNumberMode: {
                        type: String,
                        enum: ['smart', 'always', 'never'],
                        default: 'smart'
                    },
                    // smart: Ask only when Google detects multi-unit OR address contains trigger words
                    // always: Always ask for unit/apt on every address
                    // never: Never ask (for single-family home service areas)
                    unitNumberPrompt: { type: String, default: "Is there an apartment or unit number?" },
                    
                    // Trigger words that indicate multi-unit (even if Google doesn't detect)
                    unitTriggerWords: {
                        type: [String],
                        default: [
                            // Building types
                            'apartment', 'apt', 'apartments',
                            'condo', 'condominium', 'condos',
                            'suite', 'ste',
                            'unit', 'units',
                            'building', 'bldg',
                            'floor', 'fl',
                            'tower', 'towers',
                            'plaza', 'plz',
                            'complex',
                            'loft', 'lofts',
                            'penthouse', 'ph',
                            'studio',
                            // Common multi-unit indicators
                            'manor',
                            'terrace',
                            'court', 'ct',
                            'village',
                            'commons',
                            'gardens',
                            'heights',
                            'pointe',
                            'landing',
                            'crossing',
                            'center', 'centre',
                            // Business/commercial
                            'office',
                            'commercial',
                            'professional',
                            'medical',
                            'business park'
                        ]
                    },
                    
                    // ZIP codes that ALWAYS ask for unit (downtown, apartment-heavy areas)
                    unitAlwaysAskZips: {
                        type: [String],
                        default: [] // Admin can add: ['33101', '33130', '33132'] for Miami downtown
                    },
                    
                    // ZIP codes that NEVER ask for unit (rural, single-family areas)
                    unitNeverAskZips: {
                        type: [String],
                        default: [] // Admin can add ZIPs for rural areas
                    },
                    
                    // Additional unit prompts for variety (agent picks randomly)
                    unitPromptVariants: {
                        type: [String],
                        default: [
                            "Is there an apartment or unit number?",
                            "What's the apartment or suite number?",
                            "Is there a unit or building number I should note?"
                        ]
                    },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // EMAIL-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    spellOutEmail: { type: Boolean, default: true }, // AI spells back email
                    offerToSendText: { type: Boolean, default: false }, // Offer to text for confirmation
                    
                    // ═══════════════════════════════════════════════════════════════
                    // DATE/TIME-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    offerAsap: { type: Boolean, default: true }, // Offer "as soon as possible"
                    offerMorningAfternoon: { type: Boolean, default: false }, // Accept "morning"/"afternoon"
                    asapPhrase: { type: String, default: 'first available' },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // SELECT/CHOICE-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    selectOptions: [{ type: String }], // Options for dropdown/choice
                    allowOther: { type: Boolean, default: false }, // Allow "Other" option
                    
                    // ═══════════════════════════════════════════════════════════════
                    // YES/NO-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    yesAction: { type: String, default: null }, // What to do if yes
                    noAction: { type: String, default: null }, // What to do if no
                    
                    // ═══════════════════════════════════════════════════════════════
                    // NUMBER-SPECIFIC OPTIONS
                    // ═══════════════════════════════════════════════════════════════
                    minValue: { type: Number, default: null },
                    maxValue: { type: Number, default: null },
                    unit: { type: String, default: null } // e.g., "years", "units"
                }],
                // 🚨 AUTO-SEED: These defaults are applied when company is created
                default: [
                    { id: 'name', label: 'Full Name', question: 'May I have your name please?', required: true, order: 0, type: 'name', confirmBack: false, askFullName: true, useFirstNameOnly: true, askMissingNamePart: false },
                    { id: 'phone', label: 'Phone Number', question: 'What is the best phone number to reach you?', required: true, order: 1, type: 'phone', confirmBack: true, confirmPrompt: "Just to confirm, that's {value}, correct?", offerCallerId: true, acceptTextMe: true, callerIdPrompt: "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?" },
                    { id: 'address', label: 'Service Address', question: 'What is the service address?', required: true, order: 2, type: 'address', confirmBack: false, addressConfirmLevel: 'street_city', acceptPartialAddress: false },
                    { id: 'time', label: 'Preferred Time', question: 'When works best for you?', required: false, order: 3, type: 'time', confirmBack: false, offerAsap: true, offerMorningAfternoon: true }
                ]
            },

            // ═══════════════════════════════════════════════════════════════
            // ☢️ DEPRECATED: BOOKING CONTRACT V2 (Slot Library + Slot Groups)
            // Nuked Jan 2026 - Beta feature never wired to runtime
            // Kept for data compatibility only. DO NOT USE.
            // ═══════════════════════════════════════════════════════════════
            bookingContractV2Enabled: { type: Boolean, default: false },
            slotLibrary: { type: [mongoose.Schema.Types.Mixed], default: [] },
            slotGroups: { type: [mongoose.Schema.Types.Mixed], default: [] },
            
            // ═══════════════════════════════════════════════════════════════
            // V110: SLOT REGISTRY + DISCOVERY FLOW + BOOKING FLOW (CANONICAL)
            // ═══════════════════════════════════════════════════════════════
            // These are the NEW canonical structures that replace legacy bookingSlots.
            // Runtime reads from these first, falls back to bookingSlots only if empty.
            // ═══════════════════════════════════════════════════════════════
            
            // Slot Registry: Defines what slots exist (schema/contract)
            slotRegistry: {
                type: mongoose.Schema.Types.Mixed,
                default: { version: 'v1', slots: [] }
            },
            
            // Discovery Flow: Phase 1 - passive capture during conversation
            discoveryFlow: {
                type: mongoose.Schema.Types.Mixed,
                default: { version: 'v1', enabled: true, steps: [] }
            },
            
            // Booking Flow: Phase 2 - confirmation after consent
            bookingFlow: {
                type: mongoose.Schema.Types.Mixed,
                default: { version: 'v1', enabled: true, confirmCapturedFirst: true, steps: [] }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // V115: TRIAGE CONFIG — The ONLY triage gate
            // ═══════════════════════════════════════════════════════════════
            // Single source of truth for whether triage runs at runtime.
            // Replaces: returnLane.enabled, autoTriageOnProblem, per-service toggles
            // ☢️ NUKED Feb 2026: frontDesk.triage removed - use Agent 2.0
            // UI: Control Plane → Front Desk → V110 → Triage section
            // ═══════════════════════════════════════════════════════════════
            triage: {
                // Master toggle — the ONLY gate for runtime triage
                enabled: { type: Boolean, default: false },
                
                // Minimum confidence threshold for triage results
                minConfidence: { type: Number, default: 0.62, min: 0, max: 1 },
                
                // Auto-run triage when caller describes a problem
                autoOnProblem: { type: Boolean, default: true },
                
                // Per-service triage toggles (from switchboard)
                perService: { type: mongoose.Schema.Types.Mixed, default: {} },
                
                // Engine version (always v110, reserved for future)
                engine: { type: String, default: 'v110', enum: ['v110'] }
            },
            
            // Flow Policies: Name parsing, booking behavior, address handling
            policies: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },
            
            // ═══════════════════════════════════════════════════════════════
            // ARCHITECTURE NOTES - System documentation (editable in UI)
            // ═══════════════════════════════════════════════════════════════
            // Markdown-formatted notes explaining how the call flow is wired.
            // Editable from V110 Discovery tab → "📋 Architecture Notes" button.
            // Per-company documentation for troubleshooting and onboarding.
            architectureNotes: { type: String, default: null },
            architectureNotesUpdated: { type: Date, default: null },
            
            // ═══════════════════════════════════════════════════════════════
            // V111: CONVERSATION MEMORY - Runtime Truth Configuration
            // ═══════════════════════════════════════════════════════════════
            // Configures the ConversationMemory system that tracks call state.
            // Defines capture goals (MUST/SHOULD/NICE), handler governance,
            // and context window policies.
            // 
            // Spec: docs/architecture/V111-ConversationMemory-Spec.md
            // UI: Discovery tab → Conversation Memory Config section
            // ═══════════════════════════════════════════════════════════════
            conversationMemory: {
                // Version identifier
                version: { type: String, default: 'v111' },
                
                // Master toggle - enables V111 runtime truth
                enabled: { type: Boolean, default: false },
                
                // ─────────────────────────────────────────────────────────────
                // CAPTURE GOALS - What MUST/SHOULD/NICE be captured
                // ─────────────────────────────────────────────────────────────
                captureGoals: {
                    // Required before booking can proceed
                    must: {
                        fields: { type: [String], default: ['name', 'issue'] },
                        deadline: { type: String, default: 'before_booking_confirmation' },
                        onMissing: { type: String, default: 'router_prompts' }
                    },
                    // Strongly desired but not blocking
                    should: {
                        fields: { type: [String], default: ['phone', 'address'] },
                        deadline: { type: String, default: 'end_of_discovery' },
                        onMissing: { type: String, default: 'log_warning' }
                    },
                    // Optional enrichment
                    nice: {
                        fields: { type: [String], default: [] },
                        deadline: { type: String, default: 'none' },
                        onMissing: { type: String, default: 'ignore' }
                    }
                },
                
                // ─────────────────────────────────────────────────────────────
                // CONTEXT WINDOW - What LLM sees
                // ─────────────────────────────────────────────────────────────
                contextWindow: {
                    maxTurns: { type: Number, default: 6 },
                    summarizeOlderTurns: { type: Boolean, default: true },
                    alwaysIncludeFacts: { type: Boolean, default: true },
                    maxTokenBudget: { type: Number, default: 600 }
                },
                
                // ─────────────────────────────────────────────────────────────
                // HANDLER GOVERNANCE - Who can respond when
                // ─────────────────────────────────────────────────────────────
                handlerGovernance: {
                    scenarioHandler: {
                        enabled: { type: Boolean, default: true },
                        minConfidence: { type: Number, default: 0.75 },
                        allowInBookingMode: { type: Boolean, default: false }
                    },
                    bookingHandler: {
                        enabled: { type: Boolean, default: true },
                        requiresConsent: { type: Boolean, default: true },
                        consentConfidence: { type: Number, default: 0.8 },
                        lockAfterConsent: { type: Boolean, default: true }
                    },
                    llmHandler: {
                        enabled: { type: Boolean, default: true },
                        isDefaultFallback: { type: Boolean, default: true },
                        canWriteFacts: { type: Boolean, default: false }
                    },
                    escalationHandler: {
                        enabled: { type: Boolean, default: true },
                        triggers: { type: [String], default: ['explicit_request', 'frustration_detected', 'loop_detected'] }
                    }
                },
                
                // ─────────────────────────────────────────────────────────────
                // ROUTER RULES - Decision logic
                // ─────────────────────────────────────────────────────────────
                routerRules: {
                    priority: { type: [String], default: ['escalation', 'booking_locked', 'scenario_match', 'llm_default'] },
                    captureInjection: {
                        enabled: { type: Boolean, default: true },
                        maxTurnsWithoutProgress: { type: Number, default: 2 }
                    },
                    loopDetection: {
                        enabled: { type: Boolean, default: true },
                        maxRepeatedResponses: { type: Number, default: 2 },
                        onLoop: { type: String, default: 'escalate' }
                    }
                },
                
                // ─────────────────────────────────────────────────────────────
                // BLACKBOX CONFIG - What gets logged
                // ─────────────────────────────────────────────────────────────
                blackbox: {
                    logTurnRecords: { type: Boolean, default: true },
                    logMilestones: { type: Boolean, default: true },
                    verbosity: { type: String, enum: ['minimal', 'standard', 'debug'], default: 'standard' }
                }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // 🆕 COMMON FIRST NAMES - UI-Configurable Name Recognition
            // ═══════════════════════════════════════════════════════════════
            // COMMON FIRST NAMES — GLOBAL ONLY (no per-company defaults)
            // ═══════════════════════════════════════════════════════════════
            // V84+: First names are stored in AdminSettings (global, shared by all companies).
            // Seeded from SSA data: data/seeds/ssaFirstNames.js (10,000 names, 96.7% coverage).
            // This per-company field exists ONLY for backward-compat with Mongoose reads.
            // The runtime NEVER reads from here — AWConfigReader intercepts and returns global.
            // Default: [] — AdminSettings is the single source of truth.
            // ═══════════════════════════════════════════════════════════════
            commonFirstNames: { type: [String], default: [] },
            
            // ═══════════════════════════════════════════════════════════════
            // V111: COMMON LAST NAMES - US Census top 50,000 surnames
            // ═══════════════════════════════════════════════════════════════
            // Source: US Census Bureau 2010 Decennial Census (Public Domain)
            // Coverage: ~83% of the US population
            //
            // Used for last name recognition and STT fuzzy-match validation.
            // Default seed loaded from data/seeds/censusLastNames.js.
            // Companies can add/remove names specific to their clientele.
            //
            // UI: Front Desk → Booking Prompts → Common Last Names
            // Runtime: BookingLogicEngine name extraction & validation
            // ═══════════════════════════════════════════════════════════════
            commonLastNames: { type: [String], default: [] },
            
            // ═══════════════════════════════════════════════════════════════
            // 🆕 V30: NAME SPELLING VARIANTS - "Mark with K or C?"
            // ═══════════════════════════════════════════════════════════════
            // V111: NAME STOP WORDS - Words that should NEVER be accepted
            // as a person's name during booking. If a caller says one of
            // these when asked for their name, the AI re-asks the question.
            //
            // System defaults are hardcoded in IdentitySlotFirewall.js.
            // Company-specific words here are MERGED with system defaults
            // at runtime — they add to the list, never replace it.
            //
            // UI: Front Desk → Booking Prompts → Name Rejection Words
            // Runtime: IdentitySlotFirewall.validateName()
            // ═══════════════════════════════════════════════════════════════
            nameStopWords: { type: [String], default: [] },
            
            // ═══════════════════════════════════════════════════════════════
            // Optional feature for dental/medical/membership contexts where
            // exact spelling matters for record lookup.
            // 
            // OFF by default - only enable when spelling is critical.
            // Uses Levenshtein distance to determine if variants are similar.
            // 
            // UI: Front Desk → Booking Prompts → Name Spelling Variants
            // ═══════════════════════════════════════════════════════════════
            nameSpellingVariants: {
                // Master toggle - OFF by default (don't annoy HVAC callers)
                enabled: { type: Boolean, default: false },
                
                // Where to get variant pairs from:
                // - 'curated_list': Use manually entered variantGroups below
                // - 'auto_scan': Auto-scan commonFirstNames for 1-char variants
                source: {
                    type: String,
                    enum: ['curated_list', 'auto_scan'],
                    default: 'curated_list'
                },
                
                // When to ask about spelling:
                // - '1_char_only': Only ask if variant differs by exactly 1 character (Mark/Marc)
                // - 'any_variant': Ask for any variant in the list (Steven/Stephen)
                mode: { 
                    type: String, 
                    enum: ['1_char_only', 'any_variant'], 
                    default: '1_char_only' 
                },
                
                // Script template for asking about spelling
                // Placeholders: {optionA}, {optionB} = names, {letterA}, {letterB} = differing letters
                // Example output: "Just to confirm — Mark with a K or Marc with a C?"
                script: { 
                    type: String, 
                    default: 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?',
                    trim: true
                },
                
                // Max spelling questions per call (hard cap to prevent annoyance)
                maxAsksPerCall: { type: Number, default: 1, min: 0, max: 3 },
                
                // Variant groups: { "Mark": ["Marc"], "Brian": ["Bryan"], ... }
                // AI will only ask if caller's name matches a group AND mode criteria is met
                variantGroups: {
                    type: Map,
                    of: [String],
                    default: new Map([
                        ['Mark', ['Marc']],
                        ['Brian', ['Bryan']],
                        ['Eric', ['Erik']],
                        ['Jon', ['John']],
                        ['Sara', ['Sarah']],
                        ['Cathy', ['Kathy']],
                        ['Steven', ['Stephen']],
                        ['Sean', ['Shawn', 'Shaun']]
                    ])
                },
                
                // V48: PRECOMPUTED VARIANT MAP (for runtime O(1) lookup)
                // Built by Admin UI "Scan Names" button from commonFirstNames list
                // Format: { "mark": ["marc"], "marc": ["mark"], ... }
                // Runtime uses this for instant lookup instead of O(n²) computation
                precomputedVariantMap: {
                    type: Map,
                    of: [String],
                    default: null
                },
                
                // Timestamp when precomputed map was last generated
                precomputedAt: { type: Date, default: null },
                
                // Number of names that were scanned to build the map
                precomputedFromCount: { type: Number, default: 0 }
            },

            // ═══════════════════════════════════════════════════════════════
            // V94: ACCESS FLOW (Property Type + Gated Access)
            // ═══════════════════════════════════════════════════════════════
            accessFlow: {
                enabled: { type: Boolean, default: false },
                tradeApplicability: { type: [String], default: ['hvac', 'plumbing', 'electrical', 'pest', 'carpet'] },
                propertyTypeEnabled: { type: Boolean, default: true },
                propertyTypeQuestion: { type: String, trim: true, default: 'Is that a house, condo, apartment, or commercial property?' },
                unitQuestion: { type: String, trim: true, default: "Got it. What's the unit number?" },
                commercialUnitQuestion: { type: String, trim: true, default: 'Got it. Is that a suite or floor number?' },
                accessInstructionsQuestion: { type: String, trim: true, default: 'Do we need a gate code, elevator access, or should we just knock?' },
                gatedQuestion: { type: String, trim: true, default: 'Thanks. One quick thing so the technician can get in — is that inside a gated community, or is it open access?' },
                openAccessFollowupQuestion: { type: String, trim: true, default: 'Got it. Any gate code, building code, or special access we should know about, or just pull up and knock?' },
                gateAccessTypeQuestion: { type: String, trim: true, default: 'Perfect. Do you have a gate code, a gate guard, or both?' },
                gateCodeQuestion: { type: String, trim: true, default: 'Great, what gate code should the technician use?' },
                gateGuardNotifyPrompt: { type: String, trim: true, default: 'No problem. Since there’s a gate guard, please let them know {companyName} will be coming during your appointment window so they’ll let our technician in without delays.' },
                gateGuardConfirmPrompt: { type: String, trim: true, default: 'Perfect. I’ll note that the gate guard has been notified for {companyName}.' },
                maxPropertyTypeFollowUps: { type: Number, default: 1, min: 0, max: 2 },
                maxUnitFollowUps: { type: Number, default: 1, min: 0, max: 2 },
                maxAccessFollowUps: { type: Number, default: 2, min: 0, max: 5 }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // BOOKING TEMPLATES - Confirmation and completion messages
            // ═══════════════════════════════════════════════════════════════
            bookingTemplates: {
                confirmTemplate: { type: String, default: "Let me confirm — I have {name} at {address}, {time}. Does that sound right?", trim: true },
                completeTemplate: { type: String, default: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.", trim: true },
                offerAsap: { type: Boolean, default: true },
                asapPhrase: { type: String, default: "Or I can send someone as soon as possible.", trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // SERVICE FLOW - Service-call consent/triage flow (UI-controlled)
            // ═══════════════════════════════════════════════════════════════
            serviceFlow: {
                mode: { type: String, enum: ['off', 'direct_to_booking', 'hybrid'], default: 'hybrid' },
                empathyEnabled: { type: Boolean, default: false },
                trades: [{ type: String, trim: true }],
                promptKeysByTrade: {
                    type: Map,
                    of: new mongoose.Schema({
                        nonUrgentConsent: { type: String, trim: true },
                        urgentTriageQuestion: { type: String, trim: true },
                        postTriageConsent: { type: String, trim: true },
                        consentClarify: { type: String, trim: true }
                    }),
                    default: undefined
                }
            },

            // Prompt map for per-trade booking/service templates (UI-controlled)
            bookingPromptsMap: {
                type: Map,
                of: String,
                default: {}
            },

            promptGuards: {
                // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
                missingPromptFallbackKey: { type: String, trim: true, default: 'booking:universal:guardrails:missing_prompt_fallback' }
            },

            // ⚠️ DEPRECATED Jan 2026 - promptPacks REMOVED (kept for backward compat)
            promptPacks: {
                enabled: { type: Boolean, default: true },
                selectedByTrade: {
                    type: Map,
                    of: String,
                    default: {}
                },
                migration: {
                    status: { type: String, enum: ['not_started', 'previewed', 'applied', 'skipped'], default: 'not_started' },
                    appliedAt: { type: Date, default: null },
                    appliedBy: { type: String, trim: true, default: null },
                    notes: { type: String, trim: true, default: null },
                    migratedKeysCount: { type: Number, default: 0 },
                    conflictsCount: { type: Number, default: 0 },
                    legacyKeysRemaining: { type: Number, default: 0 }
                },
                history: [{
                    tradeKey: { type: String, trim: true },
                    fromPack: { type: String, trim: true },
                    toPack: { type: String, trim: true },
                    changedAt: { type: Date, default: Date.now },
                    changedBy: { type: String, trim: true },
                    notes: { type: String, trim: true },
                    changedKeysCount: { type: Number, default: 0 },
                    overrideCount: { type: Number, default: 0 }
                }]
            },

            // ═══════════════════════════════════════════════════════════════
            // BOOKING INTERRUPTION - Slot-safe interruption handling
            // ═══════════════════════════════════════════════════════════════
            // Handles callers who ask questions mid-booking (FAQ, pricing, etc.)
            // Answer the question briefly, then return to the exact slot.
            // ═══════════════════════════════════════════════════════════════
            bookingInterruption: {
                enabled: { type: Boolean, default: true },
                oneSlotPerTurn: { type: Boolean, default: true },
                forceReturnToQuestionAsLastLine: { type: Boolean, default: true },
                allowEmpathyLanguage: { type: Boolean, default: false },
                maxSentences: { type: Number, default: 2, min: 1, max: 5 },
                shortClarificationPatterns: { type: [String], default: ['mark?', 'yes?', 'hello?', 'what?'] },
                
                // ═══════════════════════════════════════════════════════════════
                // 🆕 ALLOWED INTERRUPT CATEGORIES
                // ═══════════════════════════════════════════════════════════════
                // Which types of questions/scenarios can interrupt booking?
                // If caller asks something NOT in this list, AI stays on the slot.
                // Empty array = allow all interruptions (legacy behavior)
                allowedCategories: {
                    type: [String],
                    default: ['FAQ', 'HOURS', 'SERVICE_AREA', 'PRICING', 'SMALL_TALK', 'EMERGENCY']
                },
                
                // ═══════════════════════════════════════════════════════════════
                // 🆕 MAX INTERRUPTS BEFORE TRANSFER OFFER
                // ═══════════════════════════════════════════════════════════════
                // After X interruptions in one booking session, offer to transfer
                // to a human. Prevents endless tangents.
                // 0 = never offer transfer (not recommended)
                maxInterruptsBeforeTransfer: { type: Number, default: 3, min: 0, max: 10 },
                
                // What to say when max interrupts is reached
                // Placeholders: {interruptCount}
                transferOfferPrompt: {
                    type: String,
                    trim: true,
                    default: "I want to make sure I'm helping you the best way I can. Would you like me to connect you with someone who can answer all your questions, or should we continue with the scheduling?"
                },
                
                // ═══════════════════════════════════════════════════════════════
                // 🆕 RETURN-TO-SLOT PHRASING (MULTIPLE VARIANTS - AVOID ROBOTIC)
                // ═══════════════════════════════════════════════════════════════
                // After answering an interrupt, how does AI return to the slot?
                // AI picks RANDOMLY from these to sound natural, not robotic.
                // Placeholders: {slotQuestion}, {slotLabel}, {callerName}
                // ═══════════════════════════════════════════════════════════════
                returnToSlotVariants: {
                    type: [String],
                    default: [
                        "Now, back to scheduling — {slotQuestion}",
                        "Alright, {slotQuestion}",
                        "So, {slotQuestion}",
                        "Anyway, {slotQuestion}",
                        "Back to your appointment — {slotQuestion}"
                    ]
                },
                
                // Shorter variants for quick answers (1-2 sentence responses)
                returnToSlotShortVariants: {
                    type: [String],
                    default: [
                        "So, {slotQuestion}",
                        "{slotQuestion}",
                        "Alright — {slotQuestion}",
                        "Now, {slotQuestion}"
                    ]
                }
            },

            // LEGACY: Keep old bookingPrompts for backward compatibility
            bookingPrompts: {
                askName: { type: String, default: "May I have your name?", trim: true },
                askPhone: { type: String, default: "What's the best phone number to reach you?", trim: true },
                askAddress: { type: String, default: "What's the service address?", trim: true },
                askTime: { type: String, default: "When works best for you - morning or afternoon?", trim: true },
                confirmTemplate: { type: String, default: "So I have {name} at {address}, {time}. Does that sound right?", trim: true },
                completeTemplate: { type: String, default: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.", trim: true },
                offerAsap: { type: Boolean, default: true },
                asapPhrase: { type: String, default: "Or I can send someone as soon as possible.", trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // EMOTION RESPONSES - What to say when caller is emotional
            // ═══════════════════════════════════════════════════════════════
            emotionResponses: {
                stressed: {
                    enabled: { type: Boolean, default: true },
                    acknowledgments: [{ type: String, trim: true }],
                    followUp: { type: String, default: "Let me help you get this taken care of.", trim: true }
                },
                frustrated: {
                    enabled: { type: Boolean, default: true },
                    acknowledgments: [{ type: String, trim: true }],
                    followUp: { type: String, default: "I'll get someone scheduled right away.", trim: true },
                    reduceFriction: { type: Boolean, default: true }
                },
                angry: {
                    enabled: { type: Boolean, default: true },
                    acknowledgments: [{ type: String, trim: true }],
                    followUp: { type: String, default: "Let me make this right.", trim: true },
                    offerEscalation: { type: Boolean, default: true },
                    maxTriesBeforeEscalate: { type: Number, default: 2 }
                },
                friendly: {
                    enabled: { type: Boolean, default: true },
                    allowSmallTalk: { type: Boolean, default: true },
                    smallTalkLimit: { type: Number, default: 1 }
                },
                // UI already exposes these - schema must store them (no hidden UI-only toggles)
                joking: {
                    enabled: { type: Boolean, default: true },
                    respondInKind: { type: Boolean, default: true }
                },
                panicked: {
                    enabled: { type: Boolean, default: true },
                    bypassAllQuestions: { type: Boolean, default: false },
                    confirmFirst: { type: Boolean, default: true }
                }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FRUSTRATION TRIGGERS - Phrases that indicate losing patience
            // ═══════════════════════════════════════════════════════════════
            frustrationTriggers: [{
                type: String,
                trim: true,
                lowercase: true
            }],
            
            // ═══════════════════════════════════════════════════════════════
            // DEPRECATED (Feb 2026): ESCALATION SETTINGS - NUKED
            // Was hijacking Agent 2.0 with "manager"/"human" keyword detection.
            // Escalation/transfer now handled by Agent 2.0 Trigger Cards.
            // Schema kept for DB backward compatibility.
            // ═══════════════════════════════════════════════════════════════
            escalation: {
                enabled: { type: Boolean, default: true },
                maxLoopsBeforeOffer: { type: Number, default: 3 },
                triggerPhrases: [{ type: String, trim: true }],
                offerMessage: { type: String, default: "I can connect you to someone directly or take a message for a manager. Which would you prefer?", trim: true },
                transferMessage: { type: String, default: "Let me connect you to our team now.", trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // LOOP PREVENTION
            // ═══════════════════════════════════════════════════════════════
            loopPrevention: {
                enabled: { type: Boolean, default: true },
                maxSameQuestion: { type: Number, default: 2 },
                onLoop: { type: String, enum: ['rephrase', 'skip', 'escalate'], default: 'rephrase' },
                rephraseIntro: { type: String, default: "Let me try this differently - ", trim: true },
                // V54: Nudge prompts for partial input (no hardcodes!)
                nudgeAddressPrompt: { type: String, default: "No problem — go ahead with the street address, and include unit number if you have one.", trim: true },
                nudgePhonePrompt: { type: String, default: "Sure — go ahead with the area code first.", trim: true },
                nudgeNamePrompt: { type: String, default: "Sure — go ahead.", trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FORBIDDEN PHRASES - Never say these
            // ═══════════════════════════════════════════════════════════════
            forbiddenPhrases: [{ type: String, trim: true }],
            
            // ═══════════════════════════════════════════════════════════════
            // 🆕 VOCABULARY GUARDRAILS - Trade-safe language (Enterprise)
            // ═══════════════════════════════════════════════════════════════
            // Prevents cross-tenant contamination (no "technician" at dentist)
            // ═══════════════════════════════════════════════════════════════
            vocabularyGuardrails: {
                // Words that should NEVER appear in AI responses for this company
                // Example for Dental: ["technician", "dispatch", "unit", "repair"]
                forbiddenWords: [{ type: String, trim: true, lowercase: true }],
                
                // Automatic word replacement (before response is spoken)
                // Example: { "technician": "team member", "dispatch": "schedule" }
                replacementMap: { type: Map, of: String, default: new Map() },
                
                // Allowed nouns for this trade (used for response validation)
                // Example for HVAC: ["technician", "service call", "system", "unit"]
                // Example for Dental: ["appointment", "dentist", "hygienist", "cleaning"]
                allowedServiceNouns: [{ type: String, trim: true, lowercase: true }]
            },
            
            // ═══════════════════════════════════════════════════════════════
            // 🆕 CALLER VOCABULARY - Industry slang/synonym mapping
            // ═══════════════════════════════════════════════════════════════
            // When caller uses industry slang, AI understands what they mean.
            // Example: Caller says "not pulling" → AI understands "not cooling"
            // 
            // This is for INPUT (what caller says), not OUTPUT (what AI says).
            // Multi-tenant safe: Each company/trade has their own vocabulary.
            // ═══════════════════════════════════════════════════════════════
            callerVocabulary: {
                // Synonym map: caller word → standard meaning
                // Example HVAC: { "pulling": "cooling", "blowing hot": "not cooling", "froze up": "frozen" }
                // Example Dental: { "chompers": "teeth", "pearly whites": "teeth" }
                // Example Plumbing: { "stopped up": "clogged", "backed up": "clogged" }
                synonymMap: { 
                    type: Map, 
                    of: String, 
                    default: new Map([
                        // HVAC common slang (defaults for new companies)
                        ["pulling", "cooling"],
                        ["not pulling", "not cooling"],
                        ["blowing hot", "not cooling"],
                        ["blowing warm", "not cooling"],
                        ["froze up", "frozen coils"],
                        ["iced up", "frozen coils"],
                        ["making noise", "unusual noise"],
                        ["acting up", "malfunctioning"],
                        ["went out", "stopped working"],
                        ["died", "stopped working"],
                        ["quit", "stopped working"],
                        ["won't kick on", "won't start"],
                        ["won't come on", "won't start"]
                    ])
                },
                
                // Enable/disable vocabulary translation
                enabled: { type: Boolean, default: true },
                
                // Log when translations happen (for debugging)
                logTranslations: { type: Boolean, default: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // DETECTION TRIGGERS - What AI detects in caller speech
            // ═══════════════════════════════════════════════════════════════
            detectionTriggers: {
                // Trust Concern: Caller questions AI competence
                trustConcern: [{ type: String, trim: true, lowercase: true }],
                // Caller feels ignored
                callerFeelsIgnored: [{ type: String, trim: true, lowercase: true }],
                // Caller refuses to give info
                refusedSlot: [{ type: String, trim: true, lowercase: true }],
                // Caller describing problem (not answering booking question)
                describingProblem: [{ type: String, trim: true, lowercase: true }],
                // ═══════════════════════════════════════════════════════════════
                // 🚨 CONSENT GATE - These are the ONLY phrases that unlock booking
                // ═══════════════════════════════════════════════════════════════
                // NOT issue signals (broken/fix/need help) - those stay in DISCOVERY
                // ONLY explicit scheduling requests trigger booking mode
                // ═══════════════════════════════════════════════════════════════
                // Example HVAC: ["send a technician", "schedule service", "dispatch someone"]
                // Example Dental: ["schedule an appointment", "book a cleaning", "see the dentist"]
                // Example Legal: ["set up a consultation", "talk to an attorney"]
                // ═══════════════════════════════════════════════════════════════
                wantsBooking: [{ type: String, trim: true, lowercase: true }],
                
                // ═══════════════════════════════════════════════════════════════
                // V110: DIRECT INTENT PATTERNS - Bypass consent when caller clearly wants booking
                // ═══════════════════════════════════════════════════════════════
                // ☢️ NUKED Feb 2026: FrontDeskRuntime renamed to CallRuntime
                // These patterns are checked by CallRuntime.determineLane() in V110 STRICT MODE.
                // Without this field in the schema, mongoose silently drops the array on save,
                // causing the detector to always read [0 items] → agent stays stuck in Discovery.
                //
                // Example: ["book", "schedule", "appointment", "send a technician", "need service",
                //           "repair", "come out today", "as soon as possible", "asap"]
                // ═══════════════════════════════════════════════════════════════
                directIntentPatterns: [{ type: String, trim: true, lowercase: true }],
                
                // ═══════════════════════════════════════════════════════════════
                // V110: Implicit consent phrases — caller statements that count
                // as scheduling acceptance without explicitly asking.
                //
                // When a caller says "I need service" or "send someone out",
                // that IS consent. The agent should not waste a turn asking
                // "would you like to schedule?" — it should confirm captured
                // info and proceed.
                //
                // Config-driven per company/trade. Falls back to defaults if empty.
                // Examples: ["need service", "send someone", "come out",
                //            "need repair", "need it fixed", "need a technician"]
                // ═══════════════════════════════════════════════════════════════
                implicitConsentPhrases: [{ type: String, trim: true, lowercase: true }]
            },
            
            // ═══════════════════════════════════════════════════════════════
            // 🆕 DISCOVERY CONSENT SETTINGS - When booking is allowed
            // ═══════════════════════════════════════════════════════════════
            // Controls the hard gate between DISCOVERY and BOOKING modes
            // ═══════════════════════════════════════════════════════════════
            discoveryConsent: {
                // ═══════════════════════════════════════════════════════════════
                // V22 KILL SWITCHES - Safety toggles for production
                // ═══════════════════════════════════════════════════════════════
                
                // Master toggle: If ON, booking REQUIRES explicit consent
                // If OFF (legacy mode), issue detection can trigger booking
                bookingRequiresExplicitConsent: { type: Boolean, default: true },
                
                // KILL SWITCH #1: Force LLM to speak first in discovery
                // If ON: LLM ALWAYS speaks during discovery (no scripted responses)
                // If OFF: State machine may respond (legacy behavior)
                forceLLMDiscovery: { type: Boolean, default: true },
                
                // KILL SWITCH #2: Disable scenario auto-responses
                // If ON: Scenarios are context/tools only, LLM rephrases
                // If OFF: Scenarios may be played back verbatim (legacy)
                disableScenarioAutoResponses: { type: Boolean, default: true },

                // V23+ CONSENT SPLIT (Multi-tenant safe):
                // Allow specific scenario types to auto-reply BEFORE consent, while still requiring explicit consent for BOOKING.
                // This is trade-agnostic; the "HVAC blueprint" is just a preset that sets these values per company.
                // Example: ['FAQ','TROUBLESHOOT'] allows helpful answers without enabling booking actions.
                autoReplyAllowedScenarioTypes: {
                    type: [String],
                    enum: ['FAQ', 'TROUBLESHOOT', 'EMERGENCY', 'BOOKING', 'UNKNOWN'],
                    default: []
                },
                
                // The question AI asks to get consent (trade-specific)
                // HVAC: "Would you like me to schedule a service appointment?"
                // Dental: "Would you like me to schedule an appointment for you?"
                // Legal: "Would you like me to set up a consultation?"
                consentQuestionTemplate: { 
                    type: String, 
                    default: "Would you like me to schedule an appointment for you?", 
                    trim: true 
                },
                
                // V92: Auto-inject consent questions into scenario responses
                // When a scenario response implies scheduling ("We'll send a tech..."),
                // automatically replace with consent question to avoid being pushy.
                // Set to false if you want scenarios to control their own response text.
                autoInjectConsentInScenarios: { type: Boolean, default: true },
                
                // Simple yes/confirmation words (used after consent question)
                consentYesWords: {
                    type: [String],
                    default: ["yes", "yeah", "yep", "please", "sure", "okay", "ok", "correct", "that would be great", "sounds good"]
                },
                
                // If ON: "yes" only counts if it follows the consent question
                // Reduces false positives from "yes" in other contexts
                consentRequiresYesAfterPrompt: { type: Boolean, default: true },
                
                // What must be captured BEFORE asking consent question
                // Prevents "book now" before understanding caller's need
                minDiscoveryFieldsBeforeConsent: {
                    type: [String],
                    enum: ['issueSummary', 'serviceType', 'urgency', 'existingCustomer'],
                    default: ['issueSummary']
                },
                
                // When to ask the consent question
                consentQuestionTiming: {
                    type: String,
                    enum: ['after_issue_understood', 'after_one_followup', 'when_caller_asks'],
                    default: 'after_issue_understood'
                }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // 🚀 DISCOVERY FAST-PATH - Respect caller urgency
            // ═══════════════════════════════════════════════════════════════
            // When caller clearly wants service NOW ("I need you out here"),
            // skip troubleshooting and offer scheduling immediately.
            // Does NOT auto-switch to BOOKING - still requires explicit consent.
            // ═══════════════════════════════════════════════════════════════
            fastPathBooking: {
                // Master toggle: Enable fast-path for urgent callers
                enabled: { type: Boolean, default: true },
                
                // Keywords that trigger fast-path (caller wants service now)
                // These are DEFAULTS - clients can customize in UI
                // Matching is flexible: "somebody" matches "someone", etc.
                triggerKeywords: {
                    type: [String],
                    default: [
                        // Direct booking requests (with need/want variations)
                        "send someone", "send somebody", 
                        "get someone out", "get somebody out",
                        "need you out", "need someone out", "need somebody out",
                        "want someone out", "want somebody out", "want you out",
                        "come out", "come out here", "come today", "come out today",
                        "schedule", "book", "appointment", "technician",
                        // Frustration / done troubleshooting
                        "fix it", "just fix it", "just want it fixed",
                        "sick of it", "sick of this",
                        "don't want to troubleshoot", "done troubleshooting",
                        "stop asking", "enough questions",
                        "don't care what it is", "I don't care",
                        "just send", "just book",
                        // Urgency
                        "need service", "need help now",
                        "as soon as possible", "asap",
                        "emergency", "urgent", "right away", "immediately",
                        // Refusal to continue discovery
                        "I'm done", "just get someone", "just get somebody"
                    ]
                },
                
                // The offer script (empathetic + offers scheduling)
                offerScript: {
                    type: String,
                    default: "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?",
                    trim: true
                },
                
                // Optional: One question before offering (for tech preparation)
                // Leave empty to skip straight to offer
                oneQuestionScript: {
                    type: String,
                    default: "",
                    trim: true
                },
                
                // Max discovery questions before forcing offer (if urgency detected)
                maxDiscoveryQuestions: { type: Number, default: 2, min: 1, max: 5 }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // FALLBACK RESPONSES - What AI says when LLM fails
            // These ensure the call NEVER goes silent
            // ═══════════════════════════════════════════════════════════════
            fallbackResponses: {
                // Initial greeting (when call starts)
                greeting: { type: String, default: "Thanks for calling! How can I help you today?", trim: true },
                
                // ═══════════════════════════════════════════════════════════════
                // 🚨 TIERED FALLBACK - When AI didn't understand (HONESTY RULES)
                // - NEVER pretend to understand when you don't
                // - NEVER say "Got it" if you didn't get it
                // - Blame the connection, not the caller
                // ═══════════════════════════════════════════════════════════════
                
                // Tier 1 - First miss (soft, apologetic)
                didNotUnderstandTier1: { 
                    type: String, 
                    default: "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?", 
                    trim: true 
                },
                
                // Tier 2 - Second miss (still patient, ask to slow down)
                didNotUnderstandTier2: { 
                    type: String, 
                    default: "I'm still having trouble hearing you clearly. Could you repeat that a bit slower for me?", 
                    trim: true 
                },
                
                // Tier 3 - Final fail / bailout (offer callback)
                didNotUnderstandTier3: { 
                    type: String, 
                    default: "It sounds like this connection isn't great. Do you want me to have someone from the office call or text you back to help you?", 
                    trim: true 
                },
                
                // ═══════════════════════════════════════════════════════════════
                // Booking Slots (when collecting specific info)
                // ═══════════════════════════════════════════════════════════════
                askName: { type: String, default: "May I have your name please?", trim: true },
                askPhone: { type: String, default: "And what's the best phone number to reach you?", trim: true },
                askAddress: { type: String, default: "What's the service address?", trim: true },
                askTime: { type: String, default: "When works best for you?", trim: true },
                
                // Confirmation
                confirmBooking: { type: String, default: "Let me confirm your details. Does that sound right?", trim: true },
                bookingComplete: { type: String, default: "You're all set! You'll receive a confirmation shortly. Is there anything else?", trim: true },
                
                // Transfer
                transfering: { type: String, default: "Let me connect you with someone who can help you right away. Please hold.", trim: true },
                
                // ═══════════════════════════════════════════════════════════════
                // DEPRECATED - Keep for backward compatibility, replaced by tiered
                // ═══════════════════════════════════════════════════════════════
                didNotHear: { type: String, default: "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?", trim: true },
                connectionIssue: { type: String, default: "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?", trim: true },
                clarification: { type: String, default: "I'm sorry, I didn't quite catch that. Could you please repeat?", trim: true },
                discovery: { type: String, default: "I'm sorry, I didn't quite catch that. Could you please repeat?", trim: true },
                generic: { type: String, default: "I'm sorry, I didn't quite catch that. Could you please repeat?", trim: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // MODE SWITCHING - When to switch between modes
            // ═══════════════════════════════════════════════════════════════
            modeSwitching: {
                minTurnsBeforeBooking: { type: Number, default: 2, min: 0, max: 5 },
                bookingConfidenceThreshold: { type: Number, default: 0.75, min: 0.5, max: 1.0 },
                autoRescueOnFrustration: { type: Boolean, default: true },
                autoTriageOnProblem: { type: Boolean, default: true }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // AI GUARDS - Control post-processing safety checks
            // These guards can OVERRIDE what the LLM says
            // Set to false to let AI talk freely
            // ═══════════════════════════════════════════════════════════════
            aiGuards: {
                // Phase Guard: Blocks AI from asking for booking slots (name/phone/address)
                // unless in BOOKING phase. Disable to let AI naturally flow.
                phaseGuardEnabled: { type: Boolean, default: false },
                
                // Generic Reply Guard: Replaces "generic chatbot" responses
                // with smarter discovery questions
                genericGuardEnabled: { type: Boolean, default: false },
                
                // Turn 1 Guard: Prevents AI from jumping to booking on first turn
                turn1GuardEnabled: { type: Boolean, default: false },
                
                // Minimum turns before allowing slot collection (if phase guard enabled)
                minTurnsForSlots: { type: Number, default: 1, min: 0, max: 5 }
            },
            
            // ═══════════════════════════════════════════════════════════════════════
            // 🆕 CONVERSATION STAGES - Enterprise Flow Control (UI Controlled)
            // ═══════════════════════════════════════════════════════════════════════
            // This controls the deterministic conversation flow:
            // DISCOVERY → TRIAGE → BOOKING → CONFIRMATION
            // LLM is ONLY used for off-rails recovery, not flow control
            // ═══════════════════════════════════════════════════════════════════════
            conversationStages: {
                // Master toggle for stage-based flow
                enabled: { type: Boolean, default: true },
                
                // ═══════════════════════════════════════════════════════════════
                // STAGE 1: GREETING RESPONSES (0 tokens - no LLM)
                // V32: New format with greetingRules array (trigger + fuzzy + response)
                // Legacy greetingResponses kept for backward compatibility
                // ═══════════════════════════════════════════════════════════════
                
                // V32: New flexible greeting rules with exact/fuzzy matching
                greetingRules: [{
                    trigger: { type: String, trim: true, lowercase: true },  // e.g., "good morning", "hi"
                    fuzzy: { type: Boolean, default: true },  // If true, matches variations (morning, gm, etc.)
                    response: { type: String, trim: true }   // The response to send
                }],
                
                // Legacy format (auto-generated from greetingRules for backward compat)
                greetingResponses: {
                    morning: { type: String, default: "Good morning! How can I help you today?", trim: true },
                    afternoon: { type: String, default: "Good afternoon! How can I help you today?", trim: true },
                    evening: { type: String, default: "Good evening! How can I help you today?", trim: true },
                    generic: { type: String, default: "Hi there! How can I help you today?", trim: true }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // STAGE 2: DISCOVERY SETTINGS (0 tokens - no LLM)
                // Used when we need to understand what caller needs
                // ═══════════════════════════════════════════════════════════════
                discoveryPrompts: {
                    afterGreeting: { type: String, default: "How can I help you today?", trim: true },
                    needMoreInfo: { type: String, default: "Can you tell me a little more about what's going on?", trim: true },
                    clarifyIssue: { type: String, default: "Just to make sure I understand, what seems to be the problem?", trim: true },
                    clarifyService: { type: String, default: "What type of service are you looking for today?", trim: true }
                },
                
                // 🆕 DISCOVERY SETTINGS - Industry-specific configuration
                discoverySettings: {
                    // Industry keywords for issue detection (in addition to triage cards)
                    // These help the AI recognize when caller mentions something service-related
                    industryKeywords: {
                        type: [String],
                        default: []  // Empty = uses triage cards + trade categories
                    },
                    // Minimum confidence to accept an issue extraction
                    minConfidence: { type: Number, default: 0.7, min: 0.5, max: 1.0 }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // STAGE 3: TRIAGE SETTINGS
                // Uses triage cards for diagnostic questions
                // ═══════════════════════════════════════════════════════════════
                triageSettings: {
                    enabled: { type: Boolean, default: true },
                    // Auto-triage when service issue detected
                    autoTriageOnIssue: { type: Boolean, default: true },
                    // Max diagnostic questions before moving to booking
                    maxDiagnosticQuestions: { type: Number, default: 3, min: 1, max: 5 },
                    // Acknowledge issue before triage
                    acknowledgeIssueFirst: { type: Boolean, default: true },
                    issueAcknowledgment: { type: String, default: "I'm sorry to hear that. Let me help you get this resolved.", trim: true }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // STAGE 4: BOOKING (uses bookingSlots above)
                // Fixed questions from bookingSlots config
                // ═══════════════════════════════════════════════════════════════
                bookingSettings: {
                    // Transition message from discovery/triage to booking
                    transitionToBooking: { type: String, default: "Let's get you scheduled.", trim: true },
                    // Skip slots for returning customers with known info
                    skipKnownSlots: { type: Boolean, default: true },
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V33: ANTI-LOOP BREAKER - Prevent robotic repetition
                    // ═══════════════════════════════════════════════════════════════
                    // Max times to ask the same slot before escalating
                    maxAttemptsPerSlot: { type: Number, default: 3, min: 1, max: 5 },
                    // Script to use when max attempts exceeded (offer transfer)
                    escalationScript: { 
                        type: String, 
                        default: "No problem. If you'd rather, I can transfer you to a service advisor to get you booked.",
                        trim: true
                    }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // 🆕 BOOKING OUTCOME - What happens when all slots are collected
                // ═══════════════════════════════════════════════════════════════
                // CORE PRINCIPLE: The AI must never imply a follow-up action
                // the company did not explicitly enable.
                // DEFAULT: "Confirmed on Call" - no callback assumed.
                // ═══════════════════════════════════════════════════════════════
                bookingOutcome: {
                    // Outcome mode determines what the AI says at booking completion
                    mode: { 
                        type: String, 
                        enum: [
                            'confirmed_on_call',      // DEFAULT - no callback, appointment confirmed
                            'pending_dispatch',       // Sent to dispatch for review
                            'callback_required',      // Explicit opt-in for callbacks
                            'transfer_to_scheduler',  // Immediate transfer to human
                            'after_hours_hold'        // Special after-hours handling
                        ],
                        default: 'confirmed_on_call'
                    },
                    
                    // Final script templates per mode (with placeholders)
                    finalScripts: {
                        confirmed_on_call: {
                            type: String,
                            default: "Perfect, {name}. You're all set. Your appointment is scheduled for {timePreference}. If anything changes, you can call us back anytime. Is there anything else I can help you with today?",
                            trim: true
                        },
                        pending_dispatch: {
                            type: String,
                            default: "Thanks, {name}. I've logged everything and sent it to dispatch. They'll review and confirm the time shortly. Anything else I can help with?",
                            trim: true
                        },
                        callback_required: {
                            type: String,
                            default: "Thanks, {name}. A team member will reach out shortly to finalize your appointment. Is there anything else?",
                            trim: true
                        },
                        transfer_to_scheduler: {
                            type: String,
                            default: "I'm going to transfer you now to our scheduler to get this confirmed.",
                            trim: true
                        },
                        after_hours_hold: {
                            type: String,
                            default: "We're currently closed, but I've captured your request. We'll follow up first thing when we open. If this is urgent, I can transfer you now.",
                            trim: true
                        }
                    },
                    
                    // Custom override script (takes precedence over mode defaults)
                    customFinalScript: { type: String, default: null, trim: true },
                    
                    // ASAP variant script (used when timePreference = ASAP)
                    asapVariantScript: { 
                        type: String, 
                        default: "Perfect, {name}. I've marked this as urgent. Someone will be in touch shortly to confirm the earliest available time. Anything else?",
                        trim: true
                    },
                    
                    // Use ASAP variant when timePreference is ASAP
                    useAsapVariant: { type: Boolean, default: true }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // V27: SLOT REFUSAL HANDLING - "I forgot", "I don't know"
                // ═══════════════════════════════════════════════════════════════
                // When customer can't/won't provide a required slot, handle gracefully
                // ═══════════════════════════════════════════════════════════════
                slotRefusalHandling: {
                    // Max retry attempts before escalating
                    maxRetries: { type: Number, default: 2, min: 1, max: 5 },
                    
                    // Use alternative prompts before giving up
                    useAlternativePrompt: { type: Boolean, default: true },
                    
                    // Allow skipping required slots (creates booking with [NOT PROVIDED])
                    allowSkipRequired: { type: Boolean, default: false },
                    
                    // Let LLM intervene to handle the situation
                    llmIntervention: { type: Boolean, default: true },
                    
                    // Custom alternative prompts per slot (optional)
                    alternativePrompts: {
                        address: [{ type: String, trim: true }],
                        phone: [{ type: String, trim: true }],
                        name: [{ type: String, trim: true }],
                        time: [{ type: String, trim: true }]
                    },
                    
                    // What to say when giving up on a required slot
                    giveUpScript: {
                        type: String,
                        default: "I understand. Let me transfer you to someone who can help.",
                        trim: true
                    },
                    
                    // Action when slot cannot be collected
                    onGiveUp: {
                        type: String,
                        enum: ['transfer', 'take_message', 'continue_anyway', 'end_call'],
                        default: 'transfer'
                    }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // STAGE 5: CONFIRMATION
                // ═══════════════════════════════════════════════════════════════
                confirmationSettings: {
                    // Include issue summary in confirmation
                    includeIssueSummary: { type: Boolean, default: true },
                    // Include context (e.g., "tech was here yesterday")
                    includeContext: { type: Boolean, default: true },
                    // Template with all placeholders
                    template: { 
                        type: String, 
                        default: "Let me confirm: I have {name} at {phone}, service address {address}, for {issue}. {context} Appointment {time}. Is that correct?", 
                        trim: true 
                    }
                }
            },
            
            // ═══════════════════════════════════════════════════════════════════════
            // 🆕 OFF-RAILS RECOVERY - LLM Fallback Settings (UI Controlled)
            // ═══════════════════════════════════════════════════════════════════════
            // When caller goes off-script, LLM handles the human moment
            // then MUST return to the current stage's fixed question
            // ═══════════════════════════════════════════════════════════════════════
            offRailsRecovery: {
                enabled: { type: Boolean, default: true },
                
                // ═══════════════════════════════════════════════════════════════
                // DETECTION TRIGGERS - What indicates caller went off-rails
                // ═══════════════════════════════════════════════════════════════
                triggers: {
                    // Frustration expressions
                    frustration: [{ type: String, trim: true }],
                    // Questions about the problem
                    problemQuestions: [{ type: String, trim: true }],
                    // Requests to speak to human
                    humanRequest: [{ type: String, trim: true }],
                    // Confusion expressions
                    confusion: [{ type: String, trim: true }]
                },
                
                // Default triggers (seeded on company creation)
                // These are the actual trigger phrases
                defaultTriggers: {
                    frustration: { 
                        type: [String], 
                        default: [
                            "why can't you",
                            "this is ridiculous",
                            "I already told you",
                            "you're not listening",
                            "this is the third time",
                            "I've been waiting"
                        ]
                    },
                    problemQuestions: { 
                        type: [String], 
                        default: [
                            "why is this happening",
                            "what's causing",
                            "how do I fix",
                            "is this normal",
                            "should I be worried"
                        ]
                    },
                    humanRequest: { 
                        type: [String], 
                        default: [
                            "talk to a person",
                            "speak to someone",
                            "real person",
                            "human please",
                            "manager",
                            "supervisor"
                        ]
                    },
                    confusion: { 
                        type: [String], 
                        default: [
                            "I don't understand",
                            "what do you mean",
                            "that doesn't make sense",
                            "I'm confused"
                        ]
                    }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // RECOVERY RESPONSES - What AI says before returning to script
                // ═══════════════════════════════════════════════════════════════
                responses: {
                    // When caller is frustrated
                    frustrated: { 
                        type: String, 
                        default: "I completely understand your frustration, and I apologize for the trouble.", 
                        trim: true 
                    },
                    // When this is a repeat issue
                    repeatIssue: { 
                        type: String, 
                        default: "I'm sorry this issue is persisting. Let's make sure we get it resolved properly this time.", 
                        trim: true 
                    },
                    // When caller asks about the problem
                    problemQuestion: { 
                        type: String, 
                        default: "That's a great question. Based on what you've described, a technician will need to take a look to give you a proper answer.", 
                        trim: true 
                    },
                    // When caller is confused
                    confused: { 
                        type: String, 
                        default: "No problem, let me clarify.", 
                        trim: true 
                    },
                    // When caller wants a human
                    humanRequest: { 
                        type: String, 
                        default: "I understand. Let me get your information so we can have someone call you back, or I can connect you now.", 
                        trim: true 
                    },
                    // Generic recovery
                    generic: { 
                        type: String, 
                        default: "I understand.", 
                        trim: true 
                    }
                },
                
                // ═══════════════════════════════════════════════════════════════
                // BRIDGE BACK - How to return to the script after recovery
                // ═══════════════════════════════════════════════════════════════
                bridgeBack: {
                    enabled: { type: Boolean, default: true },
                    // Transition phrase before asking the fixed question again
                    transitionPhrase: { type: String, default: "Now, to help you best,", trim: true },
                    // Max recovery attempts before escalation
                    maxRecoveryAttempts: { type: Number, default: 3, min: 1, max: 5 },

                    // ═══════════════════════════════════════════════════════════════
                    // V77: RESUME BOOKING PROTOCOL (UI Controlled)
                    // ═══════════════════════════════════════════════════════════════
                    // After answering an off-rails question in BOOKING mode (cheat sheet or LLM),
                    // read a brief recap of what is already collected and resume with the next slot.
                    //
                    // IMPORTANT:
                    // - This is enterprise protocol text and must be visible/editable in UI
                    // - Defaults are safe but should be customized per company
                    resumeBooking: {
                        enabled: { type: Boolean, default: true },
                        includeValues: { type: Boolean, default: false }, // Avoid reading back PII by default
                        // Template for the resume block (answer is already given above this).
                        // Placeholders:
                        // - {collectedSummary} (e.g., "Name, Phone")
                        // - {nextQuestion} (exact UI slot question)
                        // - {nextSlotLabel} (e.g., "Address")
                        // - {missingSummary} (e.g., "Address, Time")
                        template: {
                            type: String,
                            default: "Okay — back to booking. I have {collectedSummary}. {nextQuestion}",
                            trim: true
                        },
                        // How to format each collected slot in {collectedSummary}
                        // Placeholders: {label}, {value}
                        collectedItemTemplate: { type: String, default: "{label}", trim: true },
                        collectedItemTemplateWithValue: { type: String, default: "{label}: {value}", trim: true },
                        // List separators
                        separator: { type: String, default: ", ", trim: true },
                        finalSeparator: { type: String, default: " and ", trim: true }
                    },

                    // ═══════════════════════════════════════════════════════════════
                    // V92: BOOKING CLARIFICATION (UI Controlled)
                    // ═══════════════════════════════════════════════════════════════
                    // When caller asks meta-questions during slot collection like:
                    // - "is that what you want?"
                    // - "what do you mean?"
                    //
                    // This is NOT a trade question and should NOT route to scenarios.
                    // We should clarify and then re-ask the next required slot question.
                    clarification: {
                        enabled: { type: Boolean, default: true },
                        triggers: {
                            type: [String],
                            default: [
                                "is that what you want",
                                "is that what you need",
                                "what do you want",
                                "what do you need",
                                "what do you mean",
                                "can you explain",
                                "sorry what do you mean"
                            ]
                        },
                        // Placeholders:
                        // - {nextQuestion} (exact UI slot question)
                        // - {nextSlotLabel} (e.g., "Customer Name")
                        template: {
                            type: String,
                            default: "No problem — {nextQuestion}",
                            trim: true
                        }
                    }
                }
            },

            // ═══════════════════════════════════════════════════════════════════════
            // V78: CONFIRMATION REQUESTS (UI Controlled)
            // ═══════════════════════════════════════════════════════════════════════
            // When caller asks “did you get my phone/address/name right?” during booking,
            // reply deterministically by repeating what we have using the slot’s confirmPrompt.
            // This is not off-rails: it’s a booking protocol feature.
            confirmationRequests: {
                enabled: { type: Boolean, default: true },
                // Trigger phrases (lowercased match) - UI editable
                triggers: {
                    type: [String],
                    default: [
                        "did you get my",
                        "did you catch my",
                        "did i give you the right",
                        "is that right",
                        "is that correct",
                        "can you repeat",
                        "can you read that back",
                        "can you confirm",
                        "what did you have for my"
                    ]
                }
            },
            
            // ═══════════════════════════════════════════════════════════════════════
            // 🆕 CONTEXT RECOGNITION - Detect important caller context (UI Controlled)
            // ═══════════════════════════════════════════════════════════════════════
            // ALL responses are UI-configurable. No hardcoded trade-specific text.
            // Defaults are GENERIC to work for any industry (HVAC, dental, legal, etc.)
            // ═══════════════════════════════════════════════════════════════════════
            contextRecognition: {
                enabled: { type: Boolean, default: true },
                
                // ─────────────────────────────────────────────────────────────────
                // REPEAT VISIT DETECTION
                // ─────────────────────────────────────────────────────────────────
                repeatVisitPatterns: {
                    type: [String],
                    default: [
                        "you were here",
                        "you guys were",
                        "you came out",
                        "someone came out",
                        "we had this fixed",
                        "this happened before",
                        "same problem again",
                        "still having issues",
                        "it's happening again",
                        "were here yesterday",
                        "were here last",
                        "came back",
                        "back again"
                    ]
                },
                repeatVisitAcknowledgment: { 
                    type: String, 
                    default: "I see we've worked with you before. I apologize that you're still experiencing this issue.", 
                    trim: true 
                },
                
                // ─────────────────────────────────────────────────────────────────
                // URGENCY DETECTION
                // ─────────────────────────────────────────────────────────────────
                urgencyPatterns: {
                    type: [String],
                    default: [
                        "emergency",
                        "urgent",
                        "asap",
                        "right away",
                        "immediately",
                        "can't wait"
                    ]
                },
                urgencyAcknowledgment: { 
                    type: String, 
                    default: "I understand this is urgent. Let me help you right away.", 
                    trim: true 
                },
                
                // ─────────────────────────────────────────────────────────────────
                // CONCERN/FRUSTRATION DETECTION
                // ─────────────────────────────────────────────────────────────────
                concernPatterns: {
                    type: [String],
                    default: [
                        "concern",
                        "concerned",
                        "worried",
                        "frustrated",
                        "upset",
                        "unhappy",
                        "disappointed"
                    ]
                },
                concernAcknowledgment: { 
                    type: String, 
                    default: "I understand your concern, and I want to make sure we take care of this for you.", 
                    trim: true 
                },
                
                // ─────────────────────────────────────────────────────────────────
                // RECURRING ISSUE DETECTION
                // ─────────────────────────────────────────────────────────────────
                recurringIssuePatterns: {
                    type: [String],
                    default: [
                        "same issue",
                        "same problem",
                        "still having",
                        "happening again",
                        "keeps happening",
                        "not fixed"
                    ]
                },
                recurringIssueAcknowledgment: { 
                    type: String, 
                    default: "I'm sorry to hear you're still experiencing this issue. Let me help get this resolved.", 
                    trim: true 
                },
                
                // ─────────────────────────────────────────────────────────────────
                // PREVIOUS WORK CONTEXT
                // ─────────────────────────────────────────────────────────────────
                previousWorkPatterns: {
                    type: [String],
                    default: [
                        "did some work",
                        "fixed",
                        "replaced",
                        "installed",
                        "repaired",
                        "worked on"
                    ]
                },
                previousWorkAcknowledgment: { 
                    type: String, 
                    default: "I see. Thank you for that context.", 
                    trim: true 
                },
                
                // ─────────────────────────────────────────────────────────────────
                // GENERIC CONTEXT (when customer is explaining but not matching above)
                // ─────────────────────────────────────────────────────────────────
                genericContextAcknowledgment: { 
                    type: String, 
                    default: "I understand.", 
                    trim: true 
                }
            },
            
            // ═══════════════════════════════════════════════════════════════════════
            // 🆕 OFF-RAILS RECOVERY - When caller goes off-script (UI Controlled)
            // ═══════════════════════════════════════════════════════════════════════
            // ALL responses are UI-configurable. No hardcoded trade-specific text.
            // ═══════════════════════════════════════════════════════════════════════
            offRailsRecovery: {
                enabled: { type: Boolean, default: true },
                
                // Triggers that indicate caller is going off-rails
                defaultTriggers: {
                    frustration: {
                        type: [String],
                        default: ["this is ridiculous", "I'm so frustrated", "this is unacceptable", "I'm done"]
                    },
                    humanRequest: {
                        type: [String],
                        default: ["speak to a person", "talk to someone", "real person", "human", "manager", "supervisor"]
                    },
                    confusion: {
                        type: [String],
                        default: ["I don't understand", "what do you mean", "I'm confused", "that doesn't make sense"]
                    }
                },
                
                // Response templates for different escalation scenarios
                responses: {
                    stalled: { 
                        type: String, 
                        default: "I apologize, we seem to be having some difficulty. Let me connect you with someone who can help directly.", 
                        trim: true 
                    },
                    longCall: { 
                        type: String, 
                        default: "I want to make sure we get this right. Let me have a team member call you back to complete this.", 
                        trim: true 
                    },
                    frustrated: { 
                        type: String, 
                        default: "I completely understand your frustration. Let me get you to someone who can help right away.", 
                        trim: true 
                    },
                    humanRequest: { 
                        type: String, 
                        default: "I understand. Let me connect you with a team member who can assist you directly.", 
                        trim: true 
                    }
                },
                
                // Bridge back settings - how to return to the flow after LLM handles off-rails
                bridgeBack: {
                    enabled: { type: Boolean, default: true },
                    transitionPhrase: { type: String, default: "Now, to help you best,", trim: true }
                }
            },
            
            // ═══════════════════════════════════════════════════════════════
            // METADATA
            // ═══════════════════════════════════════════════════════════════
            lastUpdated: { type: Date, default: Date.now },
            updatedBy: { type: String, default: null, trim: true }
        },

        // -------------------------------------------------------------------
        // AGENT 2.0 (ISOLATED, UI-CONTROLLED)
        // -------------------------------------------------------------------
        // A clean, modular namespace for the next-generation agent.
        // ☢️ NUKED Feb 2026: frontDeskBehavior references removed
        // Agent 2.0 is now the primary namespace for all agent behavior
        // routing/kill-switch entanglement.
        //
        // NOTE: Keep schema minimal early; expand only as sections are locked.
        agent2: {
            enabled: { type: Boolean, default: false },
            // V4: Global Negative Keywords - applies to ALL trigger cards
            globalNegativeKeywords: { type: [String], default: [] },
            // AC1: Consent/Escalation phrase lists (Agent Console editable)
            // Required for Agent2DiscoveryEngine.loadCompanyConfig() — without schema paths,
            // Mongoose drops the arrays on save and UI changes appear to "not persist".
            consentPhrases: [{ type: String, trim: true, lowercase: true }],
            escalationPhrases: [{ type: String, trim: true, lowercase: true }],
            // V129: Real bridge (latency filler) settings
            // Two-phase TwiML: play a short bridge line, then Redirect to continue.
            bridge: {
                enabled: { type: Boolean, default: false },
                // If processing crosses this threshold, we may send the bridge TwiML.
                thresholdMs: { type: Number, default: 1100 },
                // Absolute ceiling: after this, do not keep redirecting/waiting.
                hardCapMs: { type: Number, default: 6000 },
                // Caps to prevent spam
                maxBridgesPerCall: { type: Number, default: 2 },
                maxRedirectAttempts: { type: Number, default: 2 },
                // Keep bridge lines tight (≈ under ~1.2s spoken time)
                lines: {
                    type: [String],
                    default: [
                        'Ok — one moment.',
                        'Got it — give me just a second.',
                        "One sec — I’m pulling that up now.",
                        'Alright — hang with me for a moment.'
                    ]
                }
            },
            discovery: {
                enabled: { type: Boolean, default: false },
                // UI-driven playbook + style blocks (stored as structured JSON)
                style: { type: mongoose.Schema.Types.Mixed, default: {} },
                playbook: { type: mongoose.Schema.Types.Mixed, default: {} },
                // Vocabulary system (HARD_NORMALIZE, SOFT_HINT)
                vocabulary: { type: mongoose.Schema.Types.Mixed, default: {} },
                // Clarifier system (disambiguation questions)
                clarifiers: { type: mongoose.Schema.Types.Mixed, default: {} },
                
                // ═══════════════════════════════════════════════════════════
                // 🔍 SCRABENGINE - Unified Text Processing Pipeline
                // ═══════════════════════════════════════════════════════════
                // Enterprise-grade text normalization & token expansion.
                // Replaces scattered preprocessing with single, traceable pipeline.
                // 
                // ARCHITECTURE: Fillers → Vocabulary → Synonyms → Quality Gate
                // GUARANTEE: Raw text always preserved, expansion never replaces
                // PERFORMANCE: < 30ms for 99% of inputs
                // 
                // UI: /agent-console/scrabengine.html
                // Service: services/ScrabEngine.js
                // ═══════════════════════════════════════════════════════════
                scrabEngine: {
                    enabled: { type: Boolean, default: true },
                    version: { type: String, default: '1.0.0' },
                    
                    // STAGE 1: Filler Removal
                    fillers: {
                        enabled: { type: Boolean, default: true },
                        stripGreetings: { type: Boolean, default: true },
                        stripCompanyName: { type: Boolean, default: true },
                        customFillers: [{
                            id: { type: String, trim: true },
                            phrase: { type: String, trim: true },
                            enabled: { type: Boolean, default: true },
                            priority: { type: Number, default: 100 }
                        }]
                    },
                    
                    // STAGE 2: Vocabulary Normalization
                    vocabulary: {
                        enabled: { type: Boolean, default: true },
                        entries: [{
                            id: { type: String, trim: true },
                            enabled: { type: Boolean, default: true },
                            priority: { type: Number, default: 100 },
                            from: { type: String, trim: true },
                            to: { type: String, trim: true },
                            matchMode: { 
                                type: String, 
                                enum: ['EXACT', 'CONTAINS'], 
                                default: 'EXACT' 
                            }
                        }]
                    },
                    
                    // STAGE 3: Token Expansion (Synonyms)
                    synonyms: {
                        enabled: { type: Boolean, default: true },
                        
                        // Simple word-to-words expansion
                        wordSynonyms: [{
                            id: { type: String, trim: true },
                            enabled: { type: Boolean, default: true },
                            word: { type: String, trim: true },
                            synonyms: { type: [String] },
                            priority: { type: Number, default: 50 }
                        }],
                        
                        // Context-aware pattern matching
                        contextPatterns: [{
                            id: { type: String, trim: true },
                            enabled: { type: Boolean, default: true },
                            pattern: { type: [String] },  // ["thing", "garage"]
                            component: { type: String, trim: true },  // "air handler"
                            contextTokens: { type: [String] },  // ["ahu", "indoor", "unit"]
                            confidence: { type: Number, default: 0.9, min: 0, max: 1 },
                            priority: { type: Number, default: 100 }
                        }]
                    },
                    
                    // STAGE 4: Entity Extraction
                    extraction: {
                        enabled: { type: Boolean, default: true },
                        customPatterns: [{
                            id: { type: String, trim: true },
                            enabled: { type: Boolean, default: true },
                            entityName: { type: String, trim: true },  // "companyName", "urgency"
                            label: { type: String, trim: true },  // "Company Name"
                            pattern: { type: String, trim: true },  // Regex pattern
                            examples: { type: [String] },  // Test cases
                            confidence: { type: Number, default: 0.85, min: 0, max: 1 },
                            autoHandoff: { type: Boolean, default: true },  // Pass to booking
                            validateGlobalShare: { type: Boolean, default: false }  // Validate against names
                        }]
                    },
                    
                    // STAGE 5: Quality Gates
                    qualityGates: {
                        minWordCount: { type: Number, default: 2 },
                        minConfidence: { type: Number, default: 0.5 },
                        repromptOnLowQuality: { type: Boolean, default: true }
                    },
                    
                    // Metadata
                    meta: {
                        uiBuild: { type: String, default: null },
                        lastModified: { type: Date, default: Date.now }
                    }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: SPEECH PREPROCESSING - Clean input BEFORE matching
                // ═══════════════════════════════════════════════════════════
                // ⚠️ DEPRECATED: Use scrabEngine instead (above)
                // Kept for backward compatibility only
                // ═══════════════════════════════════════════════════════════
                preprocessing: {
                    enabled: { type: Boolean, default: false },  // Disabled by default
                    ignorePhrases: { type: [String], default: [] },
                    fillerWords: { type: [String], default: [] },
                    canonicalRewrites: { type: mongoose.Schema.Types.Mixed, default: [] },
                    stripPatterns: { type: [String], default: [] }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: CALL REASON CAPTURE - Sanitization/Summary Config
                // ═══════════════════════════════════════════════════════════
                // Controls how call_reason_detail is processed before display.
                // Prevents the "echo" problem where agent says caller's transcript.
                callReasonCapture: {
                    enabled: { type: Boolean, default: true },
                    // 'summary_label' = map to short label (recommended)
                    // 'truncate' = first N meaningful words
                    // 'passthrough' = raw (legacy behavior)
                    mode: { type: String, default: 'summary_label', trim: true },
                    maxWords: { type: Number, default: 6 },
                    stripLeadingPunctuation: { type: Boolean, default: true },
                    stripGreetingPhrases: { type: Boolean, default: true },
                    stripNamePhrases: { type: Boolean, default: true },
                    stripFillerWords: { type: Boolean, default: true },
                    // Custom intent → label mappings (extends defaults)
                    customMappings: { type: mongoose.Schema.Types.Mixed, default: [] }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: INTENT PRIORITY GATE - Prevents FAQ hijacking
                // ═══════════════════════════════════════════════════════════
                // Detects service_down/emergency intent BEFORE card matching.
                // Disqualifies/penalizes FAQ cards when caller has urgent issue.
                intentGate: {
                    enabled: { type: Boolean, default: true },
                    basePenalty: { type: Number, default: 50 },
                    emergencyFullDisqualify: { type: Boolean, default: true },
                    // Categories to block/penalize when service_down detected
                    disqualifiedCategories: { 
                        type: [String], 
                        default: ['faq', 'info', 'sales', 'financing', 'warranty', 
                                  'maintenance_plan', 'system_age', 'lifespan', 
                                  'replacement', 'upgrade', 'new_system', 'general']
                    },
                    // Additional service-down keywords (extends defaults)
                    serviceDownKeywords: { type: [String], default: [] },
                    emergencyKeywords: { type: [String], default: [] }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: HUMAN TONE - Empathy/professionalism templates
                // ═══════════════════════════════════════════════════════════
                // UI-owned text templates. NO DEFAULTS - must be configured in UI.
                // If not configured, system uses fallback chain → emergency fallback.
                // RULE: No UI = No speech. Zero hardcoded English strings.
                humanTone: {
                    enabled: { type: Boolean, default: true },
                    // Templates are UI-configured. Empty by default - MUST be set in UI.
                    templates: {
                        serviceDown: { type: [String], default: [] },
                        angry: { type: [String], default: [] },
                        afterHours: { type: [String], default: [] },
                        general: { type: [String], default: [] }
                    }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: DISCOVERY HANDOFF - Consent question (no time offers)
                // ═══════════════════════════════════════════════════════════
                // Discovery asks consent ONLY. Booking times are a different lane.
                // RULE: consentQuestion must be UI-configured. No hardcoded default.
                discoveryHandoff: {
                    enabled: { type: Boolean, default: true },
                    // Consent question - MUST be configured in UI. Empty = no question asked.
                    consentQuestion: { type: String, default: '', trim: true },
                    yesNext: { type: String, default: 'BOOKING_LANE', trim: true },
                    noNext: { type: String, default: 'MESSAGE_TAKING', trim: true },
                    forbidBookingTimes: { type: Boolean, default: true }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: LLM FALLBACK SETTINGS - Control when/how LLM can speak
                // ═══════════════════════════════════════════════════════════
                // RULE: LLM never "takes over the mic". It can only assist.
                // Sentence 2 is ALWAYS overridden by UI's discoveryHandoff.consentQuestion.
                llmFallback: {
                    enabled: { type: Boolean, default: false },
                    mode: { type: String, default: 'assist_only', enum: ['assist_only', 'full', 'disabled'] },
                    onlyWhenAllElseFails: { type: Boolean, default: true },
                    maxTurnsPerCall: { type: Number, default: 2 },
                    blockedIfTriggerMatched: { type: Boolean, default: true },
                    blockedIfPendingQuestion: { type: Boolean, default: true },
                    blockedIfCapturedReasonFlow: { type: Boolean, default: true },
                    blockedIfBookingLocked: { type: Boolean, default: true },
                    forbidBookingTimes: { type: Boolean, default: true }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: NORMALIZATION - Filler/noise cleanup for matching
                // ═══════════════════════════════════════════════════════════
                // Applied to input BEFORE trigger card matching.
                // Removes fillers, normalizes text for better match accuracy.
                normalization: {
                    enabled: { type: Boolean, default: true },
                    applyTo: { 
                        type: [String], 
                        default: ['trigger_matching', 'slot_extraction']
                    },
                    preserveTranscript: { type: Boolean, default: true },
                    fillerWords: { 
                        type: [String], 
                        default: ['uh', 'um', 'like', 'you know', 'kinda', 'sorta', 'basically']
                    },
                    stripGreetings: { 
                        type: [String], 
                        default: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening']
                    },
                    collapseWhitespace: { type: Boolean, default: true },
                    maxRepeatWordRun: { type: Number, default: 2 }
                },
                
                // ═══════════════════════════════════════════════════════════
                // V4: FOLLOW-UP CONSENT GATE - Caller yes/no classification
                // ═══════════════════════════════════════════════════════════
                // Configures how the agent classifies caller responses to
                // trigger card follow-up questions (yes/no/reprompt/hesitant/complex).
                // Each bucket has: phrases, response text, and routing direction.
                // UI-owned — configured in Triggers Console consent card section.
                followUpConsent: {
                    yes: {
                        phrases:   { type: [String], default: [] },
                        response:  { type: String, default: '', trim: true },
                        direction: { type: String, default: 'HANDOFF_BOOKING', trim: true }
                    },
                    no: {
                        phrases:   { type: [String], default: [] },
                        response:  { type: String, default: '', trim: true },
                        direction: { type: String, default: 'CONTINUE', trim: true }
                    },
                    reprompt: {
                        phrases:   { type: [String], default: [] },
                        response:  { type: String, default: '', trim: true }
                    },
                    hesitant: {
                        phrases:   { type: [String], default: [] },
                        response:  { type: String, default: '', trim: true }
                    },
                    complex: {
                        phrases:   { type: [String], default: [] },
                        response:  { type: String, default: '', trim: true },
                        direction: { type: String, default: 'AGENT', trim: true }
                    }
                },
                
                // ═══════════════════════════════════════════════════════════
                // NAME GREETING - Personalized greeting using extracted name
                // ═══════════════════════════════════════════════════════════
                // Fires after ScrabEngine extracts caller's first name.
                // Example: "Hello Marc, thank you for calling."
                // UI: /agent-console/triggers.html (Name Greeting section)
                // ═══════════════════════════════════════════════════════════
                nameGreeting: {
                    alwaysGreet: { type: Boolean, default: false },
                    greetingLine: { 
                        type: String, 
                        default: 'Hello {name}, thank you for calling.', 
                        trim: true, 
                        maxlength: 500 
                    },
                    updatedAt: { type: Date, default: null }
                },
                
                // ═══════════════════════════════════════════════════════════
                // PATIENCE SETTINGS - "Hold on" / "Wait" behavior
                // ═══════════════════════════════════════════════════════════
                // Configures how agent responds when caller needs time.
                // Example: "Take your time, I'll wait."
                // UI: /agent-console/triggers.html (Patience Settings section)
                // ═══════════════════════════════════════════════════════════
                patienceSettings: {
                    enabled: { type: Boolean, default: true },
                    response: { 
                        type: String, 
                        default: 'Take your time, I\'ll wait.', 
                        trim: true, 
                        maxlength: 500 
                    },
                    waitDurationMs: { type: Number, default: 10000, min: 3000, max: 60000 },
                    followUp: { 
                        type: String, 
                        default: 'I\'m still here whenever you\'re ready.', 
                        trim: true, 
                        maxlength: 500 
                    },
                    updatedAt: { type: Date, default: null }
                },
                
                updatedAt: { type: Date, default: null }
            },
            // ═══════════════════════════════════════════════════════════════
            // 🎙️ GREETINGS SYSTEM - Agent 2.0 Owned (Feb 2026)
            // ═══════════════════════════════════════════════════════════════
            // Two-phase greeting system: Call Start + Greeting Interceptor
            // Completely isolated from legacy greeting logic.
            // ═══════════════════════════════════════════════════════════════
            greetings: {
                // ───────────────────────────────────────────────────────────
                // CALL START GREETING
                // ───────────────────────────────────────────────────────────
                // First thing agent says when call connects (before caller speaks)
                // Example: "Penguin Air! This is John, how can I help you?"
                // ───────────────────────────────────────────────────────────
                callStart: {
                    enabled: { type: Boolean, default: true },
                    text: { 
                        type: String, 
                        trim: true, 
                        default: '',
                        maxlength: 500
                    },
                    emergencyFallback: {
                        type: String,
                        trim: true,
                        default: '',
                        maxlength: 500
                    },
                    audioUrl: { 
                        type: String, 
                        trim: true, 
                        default: null 
                    },
                    audioTextHash: { 
                        type: String, 
                        default: null 
                    },
                    audioGeneratedAt: { 
                        type: Date, 
                        default: null 
                    }
                },
                
                // ───────────────────────────────────────────────────────────
                // GREETING INTERCEPTOR
                // ───────────────────────────────────────────────────────────
                // Responds to short caller greetings ("hi", "hello", "good morning")
                // Runs BEFORE trigger cards to handle pleasantries
                // ───────────────────────────────────────────────────────────
                interceptor: {
                    enabled: { type: Boolean, default: true },
                    
                    // Short-Only Gate (prevents hijacking real intent)
                    // Example: "hi" triggers greeting, but "hi my AC is broken" does not
                    shortOnlyGate: {
                        maxWords: { 
                            type: Number, 
                            default: 2, 
                            min: 1, 
                            max: 5 
                        },
                        blockIfIntentWords: { 
                            type: Boolean, 
                            default: true 
                        }
                    },
                    
                    // Intent Words (comma-separated list)
                    // If caller input contains ANY of these words, greeting is blocked
                    // Falls through to trigger cards instead
                    intentWords: {
                        type: [String],
                        default: [
                            'repair', 'maintenance', 'tune-up', 'not cooling', 'no cool',
                            'no heat', 'leak', 'water', 'dripping', 'thermostat', 'blank',
                            'schedule', 'appointment', 'price', 'cost', 'how much',
                            'service call', 'diagnostic', 'emergency'
                        ]
                    },
                    
                    // Greeting Rules (priority-based matching)
                    // Each rule can have its own triggers, response, and audio
                    rules: [{
                        ruleId: { 
                            type: String, 
                            required: true, 
                            trim: true 
                        },
                        enabled: { 
                            type: Boolean, 
                            default: true 
                        },
                        priority: { 
                            type: Number, 
                            default: 50, 
                            min: 1, 
                            max: 1000 
                        },
                        matchType: { 
                            type: String, 
                            enum: ['EXACT', 'FUZZY', 'CONTAINS', 'REGEX'], 
                            default: 'EXACT' 
                        },
                        triggers: { 
                            type: [String], 
                            default: [] 
                        },
                        response: { 
                            type: String, 
                            trim: true, 
                            required: true,
                            maxlength: 300
                        },
                        audioUrl: { 
                            type: String, 
                            trim: true, 
                            default: null 
                        },
                        audioTextHash: { 
                            type: String, 
                            default: null 
                        },
                        audioGeneratedAt: { 
                            type: Date, 
                            default: null 
                        },
                        createdAt: { 
                            type: Date, 
                            default: Date.now 
                        },
                        updatedAt: { 
                            type: Date, 
                            default: Date.now 
                        }
                    }]
                }
            },
            // V126: Emergency Fallback Line - UI-OWNED LAST RESORT
            // This is the ONLY hardcoded-looking fallback allowed in the system.
            // It's used when all other speech sources fail validation.
            // MUST be configured in UI to work. If empty, system will log CRITICAL.
            emergencyFallbackLine: {
                text: { type: String, default: '', trim: true },
                enabled: { type: Boolean, default: true }
            },
            meta: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        
        // -------------------------------------------------------------------
        // CHEAT SHEET META - Version Control Pointers (NEW ARCHITECTURE)
        // -------------------------------------------------------------------
        // LIGHTWEIGHT POINTERS ONLY - actual configs stored in CheatSheetVersion collection
        // This prevents Company document bloat and enables clean version history
        // See: models/cheatsheet/CheatSheetVersion.js
        cheatSheetMeta: {
            liveVersionId: { 
                type: String, 
                default: null,
                trim: true
                // Points to CheatSheetVersion doc with status='live'
                // This is what production calls use
            },
            draftVersionId: { 
                type: String, 
                default: null,
                trim: true
                // Points to CheatSheetVersion doc with status='draft'
                // Only one draft allowed per company (enforced by service layer)
            }
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
        },
        
        // -------------------------------------------------------------------
        // RETURN LANE SYSTEM - V1 Post-Response Behavior (2026-02)
        // -------------------------------------------------------------------
        // PURPOSE: Deterministic flow control after 3-tier responses
        // Ensures agent doesn't get "stuck" answering questions without driving to booking
        // KILL SWITCH: enabled=false disables entire system (graceful fallback)
        // TRACE EVENTS: LANE_DECISION_SUMMARY, LANE_CONTEXT_RESET, LEGACY_CONSENT_SKIPPED
        returnLane: {
            // ─────────────────────────────────────────────────────────────
            // FEATURE FLAG (kill switch)
            // ─────────────────────────────────────────────────────────────
            enabled: { 
                type: Boolean, 
                default: false  // V1: OFF by default for safe rollout
            },
            
            // ─────────────────────────────────────────────────────────────
            // COMPANY DEFAULTS (when no card matches or card has no config)
            // ─────────────────────────────────────────────────────────────
            defaults: {
                lane: {
                    type: String,
                    enum: ['SYMPTOM', 'INQUIRY', 'BOOKING', 'EMERGENCY', 'OUT_OF_SCOPE', 'CALLBACK', 'BILLING', 'UNKNOWN'],
                    default: 'UNKNOWN'
                },
                postResponseAction: {
                    type: String,
                    enum: ['NONE', 'PUSH_BOOKING', 'START_BOOKING', 'ESCALATE', 'TAKE_MESSAGE', 'END_CALL', 'CONTINUE_DISCOVERY'],
                    default: 'CONTINUE_DISCOVERY'
                },
                pushPromptKey: { 
                    type: String, 
                    enum: ['default', 'soft', 'strong', 'emergency', 'custom'],
                    default: 'default' 
                }
            },
            
            // ─────────────────────────────────────────────────────────────
            // PUSH PROMPT TEMPLATES (reusable across all triage cards)
            // ─────────────────────────────────────────────────────────────
            // Admins configure once, cards reference by key
            // Prevents inconsistent copy across cards
            pushPromptTemplates: {
                default: { 
                    type: String, 
                    default: 'Would you like me to schedule a technician to take a look?',
                    trim: true
                },
                soft: { 
                    type: String, 
                    default: 'I can help schedule that if you\'d like.',
                    trim: true
                },
                strong: { 
                    type: String, 
                    default: 'Let me get a technician scheduled for you.',
                    trim: true
                },
                emergency: { 
                    type: String, 
                    default: 'This sounds urgent. Let me get someone out to you right away.',
                    trim: true
                }
            },
            
            // ─────────────────────────────────────────────────────────────
            // TIER 3 GOVERNANCE DEFAULTS
            // ─────────────────────────────────────────────────────────────
            tier3Governance: {
                // Which actions are blocked on Tier 3 responses (LLM fallback)
                // Rationale: LLM responses can be unpredictable; don't allow hard exits
                restrictedActions: {
                    type: [String],
                    default: ['ESCALATE', 'END_CALL', 'TAKE_MESSAGE']
                    // Only PUSH_BOOKING and CONTINUE_DISCOVERY allowed by default
                },
                // Override to allow hard actions on Tier 3 (use with caution)
                allowHardActions: { 
                    type: Boolean, 
                    default: false 
                }
            },
            
            // ─────────────────────────────────────────────────────────────
            // METADATA
            // ─────────────────────────────────────────────────────────────
            configuredAt: { type: Date, default: null },
            configuredBy: { type: String, default: null, trim: true }
        }
    },
    
    // OLD INLINE DEFINITIONS BELOW THIS LINE ARE NOW OBSOLETE - TO BE REMOVED
    // ☠️ REMOVED: aiAgentSettingsSchema (nuked 2025-11-20)
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
                    inHouseFallback: { type: Number, min: 0, max: 1, default: 0.5 },
                    
                    // V92: SCENARIO MATCHING THRESHOLDS
                    // These control when scenarios are used vs LLM fallback
                    
                    // Tier-1: Use scenario reply verbatim (0 tokens)
                    // Default 0.65 - Lower = more scenarios used directly
                    // Higher = more falls through to LLM
                    tier1DirectMatch: { type: Number, min: 0.4, max: 1, default: 0.65 },
                    
                    // Minimum confidence to include scenario as LLM context
                    // Default 0.35 - Below this, scenario isn't even shown to LLM
                    minScenarioContext: { type: Number, min: 0.1, max: 0.8, default: 0.35 }
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
            },
            
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
            
            // ☢️ NUKED Feb 2026: instantResponses - legacy greeting system replaced by Agent 2.0 greetings
            
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
                templatesUsed: { type: Number, default: 0 },
                avgResponseTime: { type: Number, default: 0 },
                successRate: { type: Number, default: 0 },
                lastOptimized: { type: Date, default: Date.now }
            },

            // 🎤 V2 VOICE SETTINGS - ELEVENLABS INTEGRATION
            // Migrated from legacy aiSettings.elevenLabs to aiAgentSettings.voiceSettings
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
                    // - Lower (1-2s) = Faster responses, but may cut off pauses
                    // - Higher (7-10s) = Allows long pauses, but feels slower
                    // - V87: Lowered default from 3s to 1.5s for faster perceived response
                    speechTimeout: {
                        type: Number,
                        min: 1,
                        max: 10,
                        default: 1.5 // V87: Optimized for speed - was 3.0
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
    */ // ← End of OLD inline aiAgentSettings definition (now obsolete)
        
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
    isDeleted: { type: Boolean, default: false },
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
        // LLM-0 Orchestration (Brain 1) - Per-company override
        llm0Enabled: { type: Boolean, default: false },
        // Brain-1 Runtime (New Architecture) - Per-company override
        brain1Enabled: { type: Boolean, default: false },
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
    },
    
    // ============================================================================
    // 🗃️ METADATA - Flexible storage for system features
    // ============================================================================
    // PURPOSE: Store arbitrary data that doesn't warrant dedicated schema fields
    // EXAMPLES: dismissedScenarioGaps, featureFlags, migrationState
    // ============================================================================
    metadata: { 
        type: mongoose.Schema.Types.Mixed, 
        default: {} 
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
        if (!this.aiSettings?.elevenLabs?.apiKey && !this.aiAgentSettings?.voiceSettings?.apiKey) {
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

// ============================================================================
// POST-SAVE HOOK: Auto-invalidate scenario pool cache on template binding changes
// ============================================================================
// This ensures that when templateReferences changes, the cached scenario pool
// is immediately invalidated so the next request rebuilds with the new binding.
// This prevents the "it's bound but still not loading" confusion.
// ============================================================================
companySchema.post('save', async function(doc) {
    // Check if templateReferences was modified
    if (this.isModified && this.isModified('aiAgentSettings.templateReferences')) {
        try {
            const companyId = doc._id.toString();
            const logger = require('../utils/logger');
            
            logger.info(`[COMPANY HOOK] 🔗 Template binding changed for ${companyId} - invalidating cache`);
            
            // Clear Redis cache
            try {
                const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');
                if (isRedisConfigured()) {
                    const redis = await getSharedRedisClient();
                    if (redis) {
                        await redis.del(`scenario-pool:${companyId}`);
                        await redis.del(`company:${companyId}`);
                        logger.info(`[COMPANY HOOK] ✅ Cache cleared for ${companyId}`);
                    }
                }
            } catch (cacheErr) {
                logger.warn(`[COMPANY HOOK] Cache clear warning: ${cacheErr.message}`);
            }
            
            // Emit BlackBox event for audit trail (optional but nice)
            try {
                const BlackBoxLogger = require('../services/BlackBoxLogger');
                await BlackBoxLogger.log({
                    companyId,
                    type: 'TEMPLATE_BINDING_UPDATED',
                    data: {
                        templateReferences: doc.aiAgentSettings?.templateReferences || [],
                        bindingCount: (doc.aiAgentSettings?.templateReferences || []).length,
                        enabledCount: (doc.aiAgentSettings?.templateReferences || []).filter(r => r.enabled !== false).length,
                        updatedAt: new Date().toISOString()
                    }
                });
                logger.info(`[COMPANY HOOK] ✅ BlackBox event emitted for template binding update`);
            } catch (bbErr) {
                // Non-blocking - don't fail the save
                logger.debug(`[COMPANY HOOK] BlackBox logging skipped: ${bbErr.message}`);
            }
        } catch (err) {
            // Non-blocking - don't fail the save
            const logger = require('../utils/logger');
            logger.error(`[COMPANY HOOK] Error in post-save hook: ${err.message}`);
        }
    }
});

const Company = mongoose.model('Company', companySchema, 'companiesCollection');
module.exports = Company;

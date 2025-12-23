/**
 * ════════════════════════════════════════════════════════════════════════════════
 * UNIVERSAL GOLDEN BLUEPRINT
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Fallback scenario configuration for any industry.
 * 
 * DESIGNED FOR:
 * - Any service business
 * - Companies without trade-specific templates
 * - Initial setup before customization
 * 
 * CATEGORIES (6 core categories that apply to any business):
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  PRIORITY 100: Emergency/Urgent                                             │
 * │  PRIORITY 50-70: Appointments & Scheduling                                  │
 * │  PRIORITY 30-49: Pricing & Estimates                                        │
 * │  PRIORITY 20-29: Business Info                                              │
 * │  PRIORITY 0-10: Greetings, Goodbye, Confused                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

module.exports = {
    trade: 'universal',
    name: 'Universal Golden Blueprint',
    version: '1.0.0',
    description: 'Generic scenario configuration applicable to any service business',
    
    categories: [
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 1: URGENT REQUESTS (Priority 100)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-urgent',
            name: 'Urgent Requests',
            icon: '🚨',
            enabled: true,
            priority: 100,
            description: 'Time-sensitive or emergency requests',
            disabledDefaultReply: 'For urgent matters, please call our emergency line at {{emergencyPhone}}.',
            _reasoning: 'Always prioritize urgent requests regardless of industry',
            
            scenarios: [
                {
                    scenarioId: 'universal-urgent-emergency',
                    name: 'Emergency Request',
                    enabled: true,
                    priority: 100,
                    _reasoning: {
                        priority: 'Maximum - never miss an emergency',
                        minConfidence: 'Low threshold to catch potential emergencies'
                    },
                    
                    triggers: [
                        'emergency',
                        'urgent',
                        'asap',
                        'right away',
                        'immediately',
                        'cant wait',
                        'need help now',
                        'crisis'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.5,
                    contextWeight: 0.3,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "I understand this is urgent. Let me help you right away. Can you tell me what's happening?",
                        "I hear you — let's get this handled quickly. What's going on?",
                        "Got it, this sounds urgent. Let me get you the help you need. What's the situation?"
                    ],
                    fullReplies: [
                        "I completely understand this is urgent and I want to get you help as quickly as possible. Can you tell me a bit more about what's happening so I can make sure we handle this the right way?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'Can you describe what\'s happening?',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 2,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'isUrgent', value: true },
                        { type: 'append_ledger', key: 'event', value: 'URGENT_REQUEST' }
                    ],
                    
                    tags: ['urgent', 'emergency', 'priority'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 2: APPOINTMENTS (Priority 50-70)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-appointments',
            name: 'Appointments',
            icon: '📅',
            enabled: true,
            priority: 60,
            description: 'Scheduling and appointment management',
            disabledDefaultReply: null,
            _reasoning: 'Core business function for most service businesses',
            
            scenarios: [
                {
                    scenarioId: 'universal-appointment-new',
                    name: 'New Appointment Request',
                    enabled: true,
                    priority: 58,
                    _reasoning: {
                        priority: 'Standard booking priority',
                        minConfidence: 'Moderate threshold for clear intent'
                    },
                    
                    triggers: [
                        'appointment',
                        'schedule',
                        'book',
                        'set up',
                        'come out',
                        'visit',
                        'service',
                        'available'
                    ],
                    negativeTriggers: [
                        'cancel',
                        'reschedule',
                        'change'
                    ],
                    minConfidence: 0.6,
                    contextWeight: 0.2,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "I'd be happy to help you schedule. What type of service do you need?",
                        "Of course! Let me get you on our calendar. What are you looking to have done?",
                        "Sure! Can you tell me what service you need so I can get you scheduled?"
                    ],
                    fullReplies: [
                        "I'd be happy to help you schedule an appointment. To make sure we set aside the right amount of time and have everything ready, could you tell me what type of service you're looking for?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What type of service do you need?',
                    transitionToMode: 'BOOKING',
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 4,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'intentType', value: 'booking' },
                        { type: 'append_ledger', key: 'event', value: 'APPOINTMENT_REQUEST' }
                    ],
                    
                    tags: ['booking', 'appointment', 'scheduling'],
                    version: '1.0.0'
                },
                
                {
                    scenarioId: 'universal-appointment-cancel',
                    name: 'Cancel Appointment',
                    enabled: true,
                    priority: 55,
                    _reasoning: {
                        priority: 'Important - need to handle cleanly to retain customer',
                        minConfidence: 'Higher threshold for clear cancellation intent'
                    },
                    
                    triggers: [
                        'cancel',
                        'cancel appointment',
                        'cant make it',
                        'need to cancel',
                        'remove appointment'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.25,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "I can help with that. Can I get your name or phone number to look up your appointment?",
                        "No problem. What name or phone number is the appointment under?",
                        "Of course. Let me find your appointment — what's your name?"
                    ],
                    fullReplies: [
                        "I understand. Let me help you cancel that appointment. Can you give me your name or the phone number on the account so I can look it up?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What name is the appointment under?',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 3,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'intentType', value: 'cancel' },
                        { type: 'append_ledger', key: 'event', value: 'CANCEL_REQUEST' }
                    ],
                    
                    tags: ['cancel', 'appointment'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 3: PRICING (Priority 30-49)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-pricing',
            name: 'Pricing Questions',
            icon: '💰',
            enabled: true,
            priority: 40,
            description: 'Cost inquiries and estimates',
            disabledDefaultReply: "I'd be happy to discuss pricing. Would you like someone to call you back with that information?",
            _reasoning: 'Price questions need careful handling - qualify the lead',
            
            scenarios: [
                {
                    scenarioId: 'universal-pricing-inquiry',
                    name: 'Price Inquiry',
                    enabled: true,
                    priority: 38,
                    _reasoning: {
                        priority: 'Standard pricing priority',
                        minConfidence: 'Moderate threshold'
                    },
                    
                    triggers: [
                        'how much',
                        'price',
                        'cost',
                        'rate',
                        'fee',
                        'charge',
                        'estimate',
                        'quote'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.6,
                    contextWeight: 0.2,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "Great question! Pricing depends on the specific service. Can you tell me what you're looking for?",
                        "I can help with that. What service are you interested in so I can give you accurate pricing?",
                        "Sure! What type of service did you have in mind? That'll help me give you the right information."
                    ],
                    fullReplies: [
                        "I appreciate you asking about pricing — we believe in transparency. Our pricing varies based on the specific service you need. Could you tell me a bit more about what you're looking for? That way I can give you accurate information or connect you with someone who can provide a detailed quote."
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What service are you interested in?',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 3,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'intentType', value: 'pricing' },
                        { type: 'append_ledger', key: 'event', value: 'PRICING_INQUIRY' }
                    ],
                    
                    tags: ['pricing', 'cost', 'pre-sale'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 4: BUSINESS INFO (Priority 20-29)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-info',
            name: 'Business Information',
            icon: 'ℹ️',
            enabled: true,
            priority: 25,
            description: 'Hours, location, and general information',
            disabledDefaultReply: null,
            _reasoning: 'Quick info requests - answer efficiently',
            
            scenarios: [
                {
                    scenarioId: 'universal-info-hours',
                    name: 'Business Hours',
                    enabled: true,
                    priority: 22,
                    _reasoning: {
                        priority: 'Low priority info request',
                        minConfidence: 'Standard threshold'
                    },
                    
                    triggers: [
                        'hours',
                        'open',
                        'close',
                        'when',
                        'business hours',
                        'schedule'
                    ],
                    negativeTriggers: [
                        'appointment',
                        'book'
                    ],
                    minConfidence: 0.65,
                    contextWeight: 0.1,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "We're available {{businessHours}}. How can I help you today?",
                        "Our hours are {{businessHours}}. Is there something I can help you with?",
                        "We're open {{businessHours}}. Were you looking to schedule something?"
                    ],
                    fullReplies: [
                        "Our regular business hours are {{businessHours}}. Is there something specific I can help you with today, or would you like to schedule an appointment?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'none',
                    followUpPrompt: '',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 5,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'wait',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'append_ledger', key: 'event', value: 'HOURS_INQUIRY' }
                    ],
                    
                    tags: ['info', 'hours'],
                    version: '1.0.0'
                },
                
                {
                    scenarioId: 'universal-info-location',
                    name: 'Location Question',
                    enabled: true,
                    priority: 20,
                    _reasoning: {
                        priority: 'Low priority info request',
                        minConfidence: 'Standard threshold'
                    },
                    
                    triggers: [
                        'location',
                        'address',
                        'where are you',
                        'directions',
                        'located'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.1,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "We're located at {{address}}. Is there anything else I can help with?",
                        "Our address is {{address}}. Were you looking to come in, or did you need service at your location?"
                    ],
                    fullReplies: [
                        "We're located at {{address}}. If you're looking for directions, just search for {{companyName}} in your maps app. Is there something else I can help you with?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'none',
                    followUpPrompt: '',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 5,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'wait',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'append_ledger', key: 'event', value: 'LOCATION_INQUIRY' }
                    ],
                    
                    tags: ['info', 'location'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 5: GRATITUDE / GOODBYE (Priority 0-5)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-goodbye',
            name: 'Goodbye',
            icon: '👋',
            enabled: true,
            priority: 2,
            description: 'End of conversation handling',
            disabledDefaultReply: null,
            _reasoning: 'Polite conversation endings',
            
            scenarios: [
                {
                    scenarioId: 'universal-goodbye-thanks',
                    name: 'Thank You / Goodbye',
                    enabled: true,
                    priority: 2,
                    _reasoning: {
                        priority: 'Very low - only when conversation is ending',
                        minConfidence: 'Higher threshold to avoid false matches'
                    },
                    
                    triggers: [
                        'thank you',
                        'thanks',
                        'bye',
                        'goodbye',
                        'thats all',
                        'have a good day',
                        'appreciate it'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.75,
                    contextWeight: 0.35,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "You're welcome! Thanks for calling {{companyName}}. Have a great day!",
                        "Happy to help! Take care!",
                        "Thank you for calling! We're here if you need us."
                    ],
                    fullReplies: [
                        "You're very welcome! Thank you for choosing {{companyName}}. If you have any other questions, we're just a call away. Have a wonderful day!"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'none',
                    followUpPrompt: '',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 5,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'wait',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'append_ledger', key: 'event', value: 'CALL_ENDED' }
                    ],
                    
                    tags: ['ending', 'goodbye'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 6: CONFUSED / FALLBACK (Priority 3-5)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'universal-confused',
            name: 'Confused / Need Help',
            icon: '🤔',
            enabled: true,
            priority: 4,
            description: 'When caller is unsure or needs guidance',
            disabledDefaultReply: null,
            _reasoning: 'Guide uncertain callers toward a service',
            
            scenarios: [
                {
                    scenarioId: 'universal-confused-help',
                    name: 'Need Guidance',
                    enabled: true,
                    priority: 4,
                    _reasoning: {
                        priority: 'Low but catches uncertain callers',
                        minConfidence: 'Moderate threshold'
                    },
                    
                    triggers: [
                        'not sure',
                        'dont know',
                        'confused',
                        'help me',
                        'what do i need',
                        'what should i do',
                        'im lost'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.6,
                    contextWeight: 0.3,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "No worries! I'm here to help. What brought you to call today?",
                        "That's okay — let me help you figure it out. What's going on?",
                        "Happy to help! Can you tell me what's on your mind?"
                    ],
                    fullReplies: [
                        "No problem at all — that's what I'm here for. Let's figure this out together. Can you tell me what's going on or what prompted you to call today? I can guide you from there."
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What brought you to call today?',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 3,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: {
                        enabled: true,
                        delaySeconds: 8,
                        message: "I'm still here. Would it help if I asked you some questions?"
                    },
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'callerState', value: 'uncertain' },
                        { type: 'append_ledger', key: 'event', value: 'CALLER_UNCERTAIN' }
                    ],
                    
                    tags: ['guidance', 'uncertain'],
                    version: '1.0.0'
                }
            ]
        }
    ]
};


/**
 * ════════════════════════════════════════════════════════════════════════════════
 * HVAC GOLDEN BLUEPRINT
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade scenario configuration for HVAC companies.
 * 
 * DESIGNED FOR:
 * - Residential HVAC service companies
 * - 24/7 emergency dispatch operations
 * - Seasonal service patterns (AC in summer, heating in winter)
 * 
 * CATEGORIES (14 total):
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  PRIORITY 100: Emergency Service (safety-critical)                         │
 * │  PRIORITY 80-99: Equipment Issues (urgent but not emergency)               │
 * │  PRIORITY 70-79: Maintenance (proactive service)                           │
 * │  PRIORITY 50-69: Appointments & Scheduling                                 │
 * │  PRIORITY 30-49: Billing, Pricing, Payment                                 │
 * │  PRIORITY 10-29: General Info, Hours, Location                             │
 * │  PRIORITY 0-9: Small talk, Goodbye, Confusion                              │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * FIELD REASONING:
 * Every field value includes _reasoning to explain WHY that value was chosen.
 * This enables admin review and future optimization.
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

module.exports = {
    trade: 'hvac',
    name: 'HVAC Golden Blueprint',
    version: '1.0.0',
    description: 'Comprehensive HVAC scenario configuration with industry best practices',
    
    categories: [
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 1: EMERGENCY SERVICE (Priority 100)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-emergency',
            name: 'Emergency Service',
            icon: '🚨',
            enabled: true,
            priority: 100,
            description: 'Life-safety and property-damage situations requiring immediate response',
            disabledDefaultReply: 'For emergencies, please call 911 or our emergency line at {{emergencyPhone}}.',
            _reasoning: 'Emergency is highest priority - safety first. Never disable this category.',
            
            scenarios: [
                {
                    scenarioId: 'hvac-emergency-no-ac-summer',
                    name: 'No AC Emergency (Summer)',
                    enabled: true,
                    priority: 95,
                    _reasoning: {
                        priority: 'High but below generic emergency (100) to allow gas/fire to take precedence',
                        minConfidence: 'Lower threshold (0.55) catches more potential emergencies'
                    },
                    
                    // MATCHING
                    triggers: [
                        'no ac',
                        'ac broken',
                        'ac not working',
                        'ac stopped',
                        'no air conditioning',
                        'no cool air',
                        'house is hot',
                        'its so hot',
                        'ac emergency',
                        'ac died',
                        'air conditioner broken'
                    ],
                    negativeTriggers: [
                        'schedule',
                        'appointment',
                        'next week',
                        'sometime',
                        'maintenance',
                        'tune up'
                    ],
                    minConfidence: 0.55,
                    contextWeight: 0.3,
                    requiresAllTriggers: false,
                    
                    // RESPONSES
                    quickReplies: [
                        "I understand — no AC in this heat is serious. Let me get a technician to you right away. Can I get your address?",
                        "That sounds urgent. We prioritize AC emergencies, especially in summer. What's your address so I can check availability?",
                        "I hear you — being without AC is miserable. Let me see who we can send out today. What's your service address?"
                    ],
                    fullReplies: [
                        "I completely understand how uncomfortable that is, especially in this heat. No AC can actually be dangerous in extreme temperatures. I'm going to flag this as a priority and get a technician scheduled as quickly as possible. First, can I get your address so I can see which technician is closest to you?",
                        "That's definitely something we need to address right away. Being without air conditioning in summer isn't just uncomfortable — it can be a health concern. Let me pull up our emergency schedule and find the first available technician. Can you give me your address?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    // FLOW CONTROL
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What address should we send the technician to?',
                    transitionToMode: 'BOOKING',
                    
                    // ESCALATION
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 2,
                    
                    // ENTITY VALIDATION
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: true,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    // TIMING
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    // HOOKS
                    actionHooks: [
                        { type: 'set_flag', key: 'isEmergency', value: true },
                        { type: 'set_flag', key: 'emergencyType', value: 'no_ac_summer' },
                        { type: 'append_ledger', key: 'event', value: 'EMERGENCY_DETECTED_NO_AC' }
                    ],
                    
                    // METADATA
                    tags: ['emergency', 'ac', 'summer', 'urgent'],
                    version: '1.0.0'
                },
                
                {
                    scenarioId: 'hvac-emergency-no-heat-winter',
                    name: 'No Heat Emergency (Winter)',
                    enabled: true,
                    priority: 96,
                    _reasoning: {
                        priority: 'Slightly higher than no-AC because hypothermia risk is more immediate',
                        minConfidence: 'Lower threshold catches elderly/infant situations'
                    },
                    
                    triggers: [
                        'no heat',
                        'heater broken',
                        'furnace not working',
                        'no hot air',
                        'house is freezing',
                        'furnace stopped',
                        'heat emergency',
                        'furnace died',
                        'heating not working',
                        'cold in house'
                    ],
                    negativeTriggers: [
                        'schedule',
                        'appointment',
                        'next week',
                        'tune up',
                        'maintenance'
                    ],
                    minConfidence: 0.55,
                    contextWeight: 0.3,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "No heat is serious, especially in cold weather. Let me get someone out to you right away. What's your address?",
                        "I understand — that's urgent. We prioritize heating emergencies. Can I get your address to dispatch a technician?",
                        "That's definitely an emergency. Let me check who can get to you fastest. What's your service address?"
                    ],
                    fullReplies: [
                        "I completely understand how urgent this is. Having no heat in cold weather isn't just uncomfortable — it can be dangerous, especially for young children or elderly family members. I'm going to prioritize this and get a technician to you as quickly as possible. What's your address?",
                        "No heat in winter is absolutely something we treat as an emergency. Your safety is our top concern. Let me find the closest available technician right now. Can you give me your address?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What address should we send the technician to?',
                    transitionToMode: 'BOOKING',
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 2,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: true,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'isEmergency', value: true },
                        { type: 'set_flag', key: 'emergencyType', value: 'no_heat_winter' },
                        { type: 'append_ledger', key: 'event', value: 'EMERGENCY_DETECTED_NO_HEAT' }
                    ],
                    
                    tags: ['emergency', 'heating', 'winter', 'urgent'],
                    version: '1.0.0'
                },
                
                {
                    scenarioId: 'hvac-emergency-gas-smell',
                    name: 'Gas Smell Emergency',
                    enabled: true,
                    priority: 100,
                    _reasoning: {
                        priority: 'Maximum priority - potential explosion/carbon monoxide risk',
                        minConfidence: 'Very low threshold - never miss a gas report'
                    },
                    
                    triggers: [
                        'gas smell',
                        'smell gas',
                        'gas leak',
                        'rotten egg smell',
                        'sulfur smell',
                        'smells like gas'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.45,
                    contextWeight: 0.1,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "If you smell gas, please leave the house immediately and call 911. Once you're safe, call us back and we'll send an emergency technician.",
                        "Gas smell is a safety emergency. Please evacuate your home right now and call 911. Do not use any electrical switches. Once you're outside and safe, call us back."
                    ],
                    fullReplies: [
                        "I need you to listen carefully — a gas smell is a serious safety concern. Please leave your home immediately. Don't turn on or off any lights or electrical switches. Once you're outside and at a safe distance, call 911 first. Then call us back and we'll dispatch an emergency technician right away. Your safety comes first."
                    ],
                    replySelection: 'first',
                    replyStrategy: 'quick_first',
                    
                    followUpMode: 'escalate',
                    followUpPrompt: '',
                    transitionToMode: 'EMERGENCY',
                    
                    transferHook: 'service_advisor',
                    transferMessage: 'Let me connect you with our emergency team right away.',
                    escalationThreshold: 1,
                    
                    entityValidation: {
                        requiresName: false,
                        requiresPhone: false,
                        requiresAddress: false,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'escalate',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'isEmergency', value: true },
                        { type: 'set_flag', key: 'emergencyType', value: 'gas_smell' },
                        { type: 'set_flag', key: 'requiresImmediateEscalation', value: true },
                        { type: 'append_ledger', key: 'event', value: 'EMERGENCY_GAS_SMELL_DETECTED' }
                    ],
                    
                    tags: ['emergency', 'gas', 'safety', 'critical'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 2: EQUIPMENT ISSUES (Priority 80-90)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-equipment',
            name: 'Equipment Issues',
            icon: '🔧',
            enabled: true,
            priority: 85,
            description: 'Non-emergency equipment problems requiring service',
            disabledDefaultReply: null,
            _reasoning: 'Second highest priority - equipment issues often become emergencies if not addressed',
            
            scenarios: [
                {
                    scenarioId: 'hvac-equipment-not-cooling',
                    name: 'AC Not Cooling Properly',
                    enabled: true,
                    priority: 82,
                    _reasoning: {
                        priority: 'High but not emergency - system is running, just underperforming',
                        minConfidence: 'Standard threshold for clear equipment issues'
                    },
                    
                    triggers: [
                        'not cooling',
                        'ac not cold',
                        'warm air',
                        'not getting cold',
                        'ac running but not cooling',
                        'blowing warm air',
                        'house not cooling down'
                    ],
                    negativeTriggers: [
                        'emergency',
                        'no ac at all',
                        'completely stopped'
                    ],
                    minConfidence: 0.65,
                    contextWeight: 0.25,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "That's frustrating. There could be a few things causing that. Let me get you scheduled so a technician can diagnose it. What works better for you — morning or afternoon?",
                        "I understand. When the AC runs but doesn't cool, it usually needs professional attention. Let me find an appointment that works for you.",
                        "Got it. That's a common issue we can definitely help with. Do you have a preferred day this week for a service call?"
                    ],
                    fullReplies: [
                        "I hear you — it's frustrating when the AC is running but the house isn't getting cool. There are several things that could cause this: low refrigerant, a dirty filter, or an issue with the compressor. The good news is our technicians can usually diagnose and fix this in one visit. What day works best for you?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What day and time work best for a technician visit?',
                    transitionToMode: 'BOOKING',
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 3,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: true,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'serviceType', value: 'ac_not_cooling' },
                        { type: 'append_ledger', key: 'event', value: 'EQUIPMENT_ISSUE_AC_NOT_COOLING' }
                    ],
                    
                    tags: ['equipment', 'ac', 'cooling', 'service'],
                    version: '1.0.0'
                },
                
                {
                    scenarioId: 'hvac-equipment-strange-noise',
                    name: 'Strange Noise from Unit',
                    enabled: true,
                    priority: 80,
                    _reasoning: {
                        priority: 'Important but not urgent - noise usually indicates developing problem',
                        minConfidence: 'Moderate threshold - noise complaints are common and varied'
                    },
                    
                    triggers: [
                        'strange noise',
                        'weird sound',
                        'making noise',
                        'loud noise',
                        'banging',
                        'clanking',
                        'squealing',
                        'grinding',
                        'clicking',
                        'humming loud'
                    ],
                    negativeTriggers: [
                        'normal',
                        'always sounds like that'
                    ],
                    minConfidence: 0.6,
                    contextWeight: 0.2,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "Unusual noises from the unit definitely warrant a look. Can you describe the sound a bit — is it more of a banging, squealing, or clicking?",
                        "That's good you noticed that. Catching noises early often prevents bigger problems. Let me get you scheduled for a diagnostic. What day works for you?",
                        "Strange noises are worth checking out. It could be something simple or a sign of a bigger issue. Let's get a technician out to diagnose it."
                    ],
                    fullReplies: [
                        "You're smart to call about that. Unusual noises often indicate something that's starting to fail — catching it early usually means a simpler repair. Different sounds point to different issues: grinding might be the motor bearings, clicking could be electrical, and banging often means something's loose. Our technician can pinpoint exactly what's causing it. Would you like to schedule a diagnostic visit?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'Can you describe the noise? And when does it typically happen?',
                    transitionToMode: null,
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 3,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: true,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'serviceType', value: 'strange_noise' },
                        { type: 'append_ledger', key: 'event', value: 'EQUIPMENT_ISSUE_STRANGE_NOISE' }
                    ],
                    
                    tags: ['equipment', 'noise', 'diagnostic', 'service'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 3: MAINTENANCE (Priority 70-79)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-maintenance',
            name: 'Maintenance',
            icon: '🛠️',
            enabled: true,
            priority: 75,
            description: 'Preventive maintenance, tune-ups, and filter changes',
            disabledDefaultReply: null,
            _reasoning: 'Proactive service requests - important for business but not urgent',
            
            scenarios: [
                {
                    scenarioId: 'hvac-maintenance-tuneup',
                    name: 'AC/Heating Tune-Up',
                    enabled: true,
                    priority: 72,
                    _reasoning: {
                        priority: 'Standard maintenance priority',
                        minConfidence: 'Higher threshold - clear intent needed'
                    },
                    
                    triggers: [
                        'tune up',
                        'tuneup',
                        'maintenance',
                        'annual service',
                        'preventive maintenance',
                        'seasonal maintenance',
                        'checkup',
                        'ac tune up',
                        'furnace tune up'
                    ],
                    negativeTriggers: [
                        'broken',
                        'not working',
                        'emergency'
                    ],
                    minConfidence: 0.7,
                    contextWeight: 0.15,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "Great thinking! Regular tune-ups really do extend the life of your system. We have appointments available this week. What day works for you?",
                        "Smart to stay on top of maintenance. I can get you scheduled — do you prefer morning or afternoon appointments?",
                        "Perfect timing for a tune-up. Let me check our schedule. Do you have a preferred day?"
                    ],
                    fullReplies: [
                        "That's a great idea. Regular maintenance not only helps your system run more efficiently — which can lower your energy bills — but it also helps us catch small problems before they become expensive repairs. Our tune-up includes checking refrigerant levels, cleaning coils, inspecting electrical connections, and making sure everything's running optimally. What day works best for you?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What day and time work best for your tune-up?',
                    transitionToMode: 'BOOKING',
                    
                    transferHook: null,
                    transferMessage: '',
                    escalationThreshold: 4,
                    
                    entityValidation: {
                        requiresName: true,
                        requiresPhone: true,
                        requiresAddress: true,
                        requiresZip: false,
                        requiresEmail: false
                    },
                    
                    silencePolicy: 'prompt_once',
                    timedFollowUp: null,
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'serviceType', value: 'tune_up' },
                        { type: 'append_ledger', key: 'event', value: 'MAINTENANCE_TUNEUP_REQUEST' }
                    ],
                    
                    tags: ['maintenance', 'tune-up', 'preventive'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 4: APPOINTMENT BOOKING (Priority 50-69)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-appointments',
            name: 'Appointment Booking',
            icon: '📅',
            enabled: true,
            priority: 60,
            description: 'Scheduling, rescheduling, and appointment management',
            disabledDefaultReply: null,
            _reasoning: 'Core business function - appointments are how we get paid',
            
            scenarios: [
                {
                    scenarioId: 'hvac-appointment-request',
                    name: 'Request Appointment',
                    enabled: true,
                    priority: 55,
                    _reasoning: {
                        priority: 'Standard booking priority - below emergencies and equipment',
                        minConfidence: 'Moderate threshold for clear booking intent'
                    },
                    
                    triggers: [
                        'schedule',
                        'appointment',
                        'book',
                        'schedule service',
                        'make appointment',
                        'set up appointment',
                        'need someone to come out',
                        'schedule a visit'
                    ],
                    negativeTriggers: [
                        'cancel',
                        'reschedule',
                        'change'
                    ],
                    minConfidence: 0.65,
                    contextWeight: 0.2,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "I'd be happy to help you schedule. What type of service do you need — repair, maintenance, or something else?",
                        "Of course! Let me get you on our schedule. What's the issue you're experiencing, or is this for routine maintenance?",
                        "Sure thing! Before I book you, can you tell me briefly what you need help with?"
                    ],
                    fullReplies: [
                        "Absolutely, I can help you schedule an appointment. To make sure we send the right technician with the right equipment, could you tell me a bit about what you're experiencing? Is this a repair for something that's not working, or are you looking to schedule preventive maintenance?"
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
                        requiresAddress: true,
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
                    scenarioId: 'hvac-appointment-reschedule',
                    name: 'Reschedule Appointment',
                    enabled: true,
                    priority: 52,
                    _reasoning: {
                        priority: 'Slightly lower than new bookings - retention of existing appointment',
                        minConfidence: 'Higher threshold - clear reschedule intent needed'
                    },
                    
                    triggers: [
                        'reschedule',
                        'change appointment',
                        'move appointment',
                        'different time',
                        'different day',
                        'need to change',
                        'cant make it'
                    ],
                    negativeTriggers: [
                        'cancel',
                        'new appointment'
                    ],
                    minConfidence: 0.7,
                    contextWeight: 0.25,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "No problem! Can you give me your name or phone number so I can pull up your appointment?",
                        "Of course. What name is the appointment under?",
                        "Sure, I can help with that. Let me look up your appointment — what's your phone number?"
                    ],
                    fullReplies: [
                        "I understand things come up. Let me help you find a better time. Can you give me your name or the phone number on the appointment so I can pull up your details and see what other times we have available?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
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
                        { type: 'set_flag', key: 'intentType', value: 'reschedule' },
                        { type: 'append_ledger', key: 'event', value: 'APPOINTMENT_RESCHEDULE_REQUEST' }
                    ],
                    
                    tags: ['booking', 'reschedule', 'appointment'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 5: PRICING QUESTIONS (Priority 30-49)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-pricing',
            name: 'Pricing Questions',
            icon: '💰',
            enabled: true,
            priority: 40,
            description: 'Service costs, estimates, and pricing inquiries',
            disabledDefaultReply: "I'd be happy to discuss pricing. Would you like me to have someone call you back with detailed information?",
            _reasoning: 'Price questions need careful handling - too specific can backfire',
            
            scenarios: [
                {
                    scenarioId: 'hvac-pricing-service-call',
                    name: 'Service Call Fee',
                    enabled: true,
                    priority: 38,
                    _reasoning: {
                        priority: 'Standard pricing inquiry priority',
                        minConfidence: 'Moderate threshold for clear pricing intent'
                    },
                    
                    triggers: [
                        'how much',
                        'cost',
                        'price',
                        'service call fee',
                        'diagnostic fee',
                        'trip charge',
                        'what do you charge',
                        'how much to come out'
                    ],
                    negativeTriggers: [
                        'estimate for install',
                        'new system'
                    ],
                    minConfidence: 0.6,
                    contextWeight: 0.2,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "Our service call fee covers the technician's visit and diagnosis. The exact price depends on the type of service, but I'd be happy to get you an estimate once I know more about what you need.",
                        "Great question. Our pricing varies based on the specific service. Can you tell me what you're experiencing so I can give you a better idea of cost?",
                        "We try to be upfront about pricing. To give you accurate information, can you tell me a bit about the issue? That way I can let you know what to expect."
                    ],
                    fullReplies: [
                        "I appreciate you asking about pricing upfront — we believe in transparency. Our service call fee includes the technician's travel and time to diagnose the issue. Once they identify the problem, they'll give you a complete quote before any repairs begin, so you'll never be surprised. The exact cost depends on what service you need. Can you tell me what's going on with your system?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'What type of service are you looking for?',
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
                        { type: 'set_flag', key: 'intentType', value: 'pricing_inquiry' },
                        { type: 'append_ledger', key: 'event', value: 'PRICING_QUESTION' }
                    ],
                    
                    tags: ['pricing', 'cost', 'pre-sale'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 6: BUSINESS HOURS (Priority 20-29)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-hours',
            name: 'Business Hours',
            icon: '🕐',
            enabled: true,
            priority: 25,
            description: 'Operating hours and availability questions',
            disabledDefaultReply: null,
            _reasoning: 'Quick info requests - low priority but important to answer',
            
            scenarios: [
                {
                    scenarioId: 'hvac-hours-operation',
                    name: 'Hours of Operation',
                    enabled: true,
                    priority: 22,
                    _reasoning: {
                        priority: 'Low priority - simple info request',
                        minConfidence: 'Standard threshold'
                    },
                    
                    triggers: [
                        'hours',
                        'when are you open',
                        'business hours',
                        'what time do you open',
                        'what time do you close',
                        'are you open',
                        'open today',
                        'open on weekends',
                        'saturday hours'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.7,
                    contextWeight: 0.1,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "We're available {{businessHours}}. For emergencies, we have 24/7 service at {{emergencyPhone}}. How can I help you today?",
                        "Our regular hours are {{businessHours}}. Is there something I can help you with?",
                        "We're open {{businessHours}}. Were you looking to schedule a service?"
                    ],
                    fullReplies: [
                        "Our office hours are {{businessHours}}. However, for HVAC emergencies like no heat or no AC, we offer 24/7 emergency service — you can always reach us at {{emergencyPhone}}. Is there something specific I can help you with today?"
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
                    
                    tags: ['info', 'hours', 'quick-answer'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 7: GRATITUDE / GOODBYE (Priority 0-5)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-goodbye',
            name: 'Gratitude / Goodbye',
            icon: '👋',
            enabled: true,
            priority: 2,
            description: 'Thank you and end of conversation handling',
            disabledDefaultReply: null,
            _reasoning: 'Lowest priority - only matches when nothing else does',
            
            scenarios: [
                {
                    scenarioId: 'hvac-goodbye-thanks',
                    name: 'Thank You / Goodbye',
                    enabled: true,
                    priority: 2,
                    _reasoning: {
                        priority: 'Very low - catch-all for conversation endings',
                        minConfidence: 'Higher threshold to avoid false matches'
                    },
                    
                    triggers: [
                        'thank you',
                        'thanks',
                        'bye',
                        'goodbye',
                        'thats all',
                        'thats it',
                        'have a good day',
                        'appreciate it'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.75,
                    contextWeight: 0.3,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "You're welcome! Thanks for calling {{companyName}}. Have a great day!",
                        "Happy to help! Take care, and don't hesitate to call if you need anything.",
                        "Thank you for calling! We're here if you need us. Have a great day!"
                    ],
                    fullReplies: [
                        "You're very welcome! Thank you for choosing {{companyName}}. If you have any other questions or need service in the future, we're just a phone call away. Have a wonderful day!"
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
                        { type: 'append_ledger', key: 'event', value: 'CALL_ENDING_GRATITUDE' }
                    ],
                    
                    tags: ['ending', 'goodbye', 'gratitude'],
                    version: '1.0.0'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════════
        // CATEGORY 8: CONFUSED / UNCERTAIN (Priority 3-5)
        // ═══════════════════════════════════════════════════════════════════════
        {
            categoryId: 'hvac-confused',
            name: 'Confused / Uncertain',
            icon: '🤔',
            enabled: true,
            priority: 4,
            description: 'When caller is unsure what they need',
            disabledDefaultReply: null,
            _reasoning: 'Help guide confused callers - better than letting them fall to LLM',
            
            scenarios: [
                {
                    scenarioId: 'hvac-confused-unsure',
                    name: 'Caller Unsure',
                    enabled: true,
                    priority: 4,
                    _reasoning: {
                        priority: 'Low but above small talk - guide them to service',
                        minConfidence: 'Moderate threshold'
                    },
                    
                    triggers: [
                        'im not sure',
                        'i dont know',
                        'confused',
                        'not certain',
                        'maybe',
                        'i guess',
                        'what should i do',
                        'what do you recommend'
                    ],
                    negativeTriggers: [],
                    minConfidence: 0.6,
                    contextWeight: 0.35,
                    requiresAllTriggers: false,
                    
                    quickReplies: [
                        "No worries! Let me ask a few questions to help figure out what you need. Is your heating or air conditioning having any issues?",
                        "That's okay — I can help you figure it out. Are you calling about a problem with your HVAC system, or looking for maintenance?",
                        "Happy to help you work through it. What made you call today — is something not working right, or did you have a question?"
                    ],
                    fullReplies: [
                        "No problem at all — that's what I'm here for. Let me ask a few questions to point you in the right direction. First, are you experiencing any issues with your heating or air conditioning right now? Or were you thinking more about preventive maintenance or a general question?"
                    ],
                    replySelection: 'random',
                    replyStrategy: 'adaptive',
                    
                    followUpMode: 'collect_info',
                    followUpPrompt: 'Is your heating or cooling system having any problems?',
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
                        message: "I'm still here. Would it help if I asked you some questions to figure out what you need?"
                    },
                    
                    actionHooks: [
                        { type: 'set_flag', key: 'callerState', value: 'uncertain' },
                        { type: 'append_ledger', key: 'event', value: 'CALLER_UNCERTAIN' }
                    ],
                    
                    tags: ['guidance', 'uncertain', 'help'],
                    version: '1.0.0'
                }
            ]
        }
    ]
};


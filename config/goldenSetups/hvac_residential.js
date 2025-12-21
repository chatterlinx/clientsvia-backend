/**
 * ============================================================================
 * GOLDEN HVAC RESIDENTIAL SETUP - PENGUIN AIR REFERENCE
 * ============================================================================
 * 
 * This is the canonical reference configuration for HVAC Residential companies.
 * Used for:
 * - Regression testing
 * - Sales demos
 * - Onboarding blueprints
 * - "Is the system broken?" canary
 * 
 * RULE: Everything here MUST be UI-editable after seed.
 * RULE: All enabled rules must be VALID (no empty triggers/actions)
 * 
 * ============================================================================
 */

module.exports = {
    profileKey: 'penguin_air',
    tradeCategoryKey: 'hvac_residential',
    
    // ═══════════════════════════════════════════════════════════════════════
    // A) COMPANY PROFILE (Placeholders)
    // ═══════════════════════════════════════════════════════════════════════
    placeholders: [
        { key: 'companyname', value: 'Penguin Air', isSystem: true },
        { key: 'phone', value: '(555) 123-4567', isSystem: true },
        { key: 'address', value: '123 Cool Breeze Lane, Phoenix, AZ 85001', isSystem: false },
        { key: 'servicearea', value: 'Greater Phoenix Metro Area', isSystem: false },
        { key: 'website', value: 'www.penguinair.com', isSystem: false },
        { key: 'email', value: 'service@penguinair.com', isSystem: false },
        { key: 'license', value: 'AZ ROC #123456', isSystem: false },
        { key: 'hours', value: 'Monday-Friday 8am-5pm, Saturday 9am-1pm', isSystem: false },
        { key: 'emergencyphone', value: '(555) 999-9999', isSystem: false }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // B) FRONT DESK BEHAVIOR
    // ═══════════════════════════════════════════════════════════════════════
    frontDeskBehavior: {
        greeting: {
            text: "Thank you for calling {companyname}! This is our AI assistant. How can I help you today?",
            enabled: true
        },
        conversationStyle: 'balanced', // confident | balanced | polite
        personality: {
            enabled: true,
            professionalismLevel: 4, // 1-5
            empathyLevel: 4 // 1-5
        },
        forbiddenPhrases: [
            "I don't know",
            "I can't help",
            "That's not my job",
            "Call back later",
            "We're too busy"
        ],
        blockPricing: true,
        pricingDeflection: "I'd be happy to have one of our comfort advisors discuss pricing options with you. Can I schedule a free estimate?"
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // C) BOOKING CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════
    booking: {
        enabled: true,
        slots: [
            { id: 'firstName', name: 'First Name', type: 'text', required: true, prompt: "What's your first name?" },
            { id: 'lastName', name: 'Last Name', type: 'text', required: true, prompt: "And your last name?" },
            { id: 'phone', name: 'Cell Phone', type: 'phone', required: true, preferred: true, prompt: "What's the best cell phone number to reach you?" },
            { id: 'address', name: 'Service Address', type: 'address', required: true, prompt: "What's the address where you need service?" },
            { id: 'serviceType', name: 'Service Type', type: 'select', required: true, prompt: "What type of service do you need today?", options: ['AC Repair', 'Heating Repair', 'Maintenance', 'New Installation', 'Air Quality', 'Other'] },
            { id: 'problemDescription', name: 'Problem Description', type: 'text', required: true, prompt: "Can you briefly describe what's happening?" },
            { id: 'timeWindow', name: 'Time Window', type: 'select', required: true, prompt: "What time window works best for you?", options: ['8-10 AM', '10 AM-12 PM', '12-2 PM', '2-4 PM'] }
        ],
        urgentBookingBehavior: 'transfer', // transfer | prioritize | standard
        urgentTransferTarget: 'service_advisor'
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // D) DEFAULT REPLIES (CRITICAL - Deterministic fallbacks)
    // ═══════════════════════════════════════════════════════════════════════
    defaultReplies: {
        notOfferedReply: {
            quickReply: "I'm sorry, we don't offer that service.",
            fullReply: "I'm sorry, that's not a service we currently provide. However, I'd be happy to help you with our AC repair, heating, maintenance, or air quality services. What can I help you with today?"
        },
        unknownIntentReply: {
            quickReply: "I'm not sure I understood that.",
            fullReply: "I'm sorry, I didn't quite catch that. Are you calling about your air conditioning, heating, or looking to schedule service? I'm here to help!"
        },
        afterHoursReply: {
            quickReply: "We're currently closed.",
            fullReply: "Thank you for calling {companyname}! Our office is currently closed. Our regular hours are {hours}. For emergencies, please call our 24/7 emergency line at {emergencyphone}. Otherwise, I can take a message and have someone call you back first thing tomorrow."
        },
        strictDisabledBehavior: true
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // E) TRANSFER TARGETS
    // ═══════════════════════════════════════════════════════════════════════
    transfers: [
        {
            id: 'service_advisor',
            name: 'Service Advisor',
            type: 'phone',
            destination: '+15551234568',
            description: 'Primary escalation for urgent calls and pricing questions',
            priority: 1,
            isDefault: true
        },
        {
            id: 'manager',
            name: 'Manager',
            type: 'phone',
            destination: '+15551234569',
            description: 'Escalation for complaints or complex issues',
            priority: 2,
            isDefault: false
        },
        {
            id: 'after_hours_voicemail',
            name: 'After Hours Voicemail',
            type: 'voicemail',
            destination: 'voicemail_box_1',
            description: 'Message capture when office is closed',
            priority: 3,
            isDefault: false
        }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // F) CALL PROTECTION (Enterprise schema with proper action objects)
    // ═══════════════════════════════════════════════════════════════════════
    callProtection: [
        {
            name: 'Voicemail Detection',
            description: 'Detects voicemail systems and politely disconnects',
            enabled: true,
            priority: 1,
            // Enterprise match
            match: {
                keywordsAny: ['leave a message', 'beep', 'voicemail', 'not available'],
                keywordsAll: [],
                regexPatterns: [],
                callerType: [],
                timeWindows: [],
                spamFlagsRequired: [],
                tradeRequired: []
            },
            // Enterprise action (OBJECT, not string)
            action: {
                type: 'polite_hangup',
                hangupMessage: 'This appears to be a voicemail. Goodbye.',
                responseTemplateId: '',
                inlineResponse: '',
                transferTarget: '',
                transferMessage: ''
            },
            sideEffects: {
                autoBlacklist: false,
                autoTag: ['voicemail'],
                notifyContacts: [],
                logSeverity: 'info'
            }
        },
        {
            name: 'Spam Call Detection',
            description: 'Detects robocalls and spam callers',
            enabled: true,
            priority: 2,
            match: {
                keywordsAny: [
                    'press 1 to',
                    'this is your captain',
                    'warranty expir',
                    'social security',
                    'irs',
                    'you have won'
                ],
                keywordsAll: [],
                regexPatterns: [],
                callerType: [],
                timeWindows: [],
                spamFlagsRequired: [],
                tradeRequired: []
            },
            action: {
                type: 'polite_hangup',
                hangupMessage: 'Thank you for calling. Goodbye.',
                responseTemplateId: '',
                inlineResponse: '',
                transferTarget: '',
                transferMessage: ''
            },
            sideEffects: {
                autoBlacklist: true,
                autoTag: ['spam'],
                notifyContacts: [],
                logSeverity: 'warning'
            }
        },
        {
            name: 'Frustration Escalation',
            description: 'Transfers caller to human when frustrated',
            enabled: true,
            priority: 5,
            match: {
                keywordsAny: [
                    'speak to a human',
                    'talk to someone',
                    'real person',
                    'supervisor',
                    'manager',
                    'this is ridiculous',
                    'fed up',
                    'unacceptable'
                ],
                keywordsAll: [],
                regexPatterns: [],
                callerType: [],
                timeWindows: [],
                spamFlagsRequired: [],
                tradeRequired: []
            },
            action: {
                type: 'force_transfer',
                transferTarget: 'service_advisor',
                transferMessage: "I understand you'd like to speak with someone directly. Let me connect you with our service team right away.",
                hangupMessage: '',
                responseTemplateId: '',
                inlineResponse: ''
            },
            sideEffects: {
                autoBlacklist: false,
                autoTag: ['escalation'],
                notifyContacts: [],
                logSeverity: 'info'
            }
        }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // G) DYNAMIC FLOWS (VALID triggers and actions)
    // ═══════════════════════════════════════════════════════════════════════
    dynamicFlows: [
        {
            flowKey: 'emergency_detection',
            name: 'Emergency Service Detection',
            priority: 100,
            isActive: true,
            trigger: {
                type: 'PHRASE_MATCH',
                phrases: [
                    'emergency',
                    'no heat',
                    'no air',
                    'gas smell',
                    'carbon monoxide',
                    'co detector',
                    'house is freezing',
                    'pipe burst',
                    'flooding',
                    'smoke',
                    'fire'
                ],
                minConfidence: 0.7
            },
            actions: [
                {
                    type: 'set_flag',
                    config: { path: 'callLedger.facts.isEmergency', value: true }
                },
                {
                    type: 'ack_once',
                    config: { text: "I understand this is urgent. Let me get you help right away." }
                },
                {
                    type: 'transition_mode',
                    config: { targetMode: 'EMERGENCY' }
                }
            ],
            settings: {
                allowConcurrent: false
            }
        },
        {
            flowKey: 'after_hours_routing',
            name: 'After Hours Detection',
            priority: 90,
            isActive: true,
            trigger: {
                type: 'CONDITION',
                conditions: { businessHours: false }
            },
            actions: [
                {
                    type: 'set_flag',
                    config: { path: 'callLedger.facts.isAfterHours', value: true }
                }
            ],
            settings: {
                allowConcurrent: true
            }
        },
        {
            flowKey: 'technician_request',
            name: 'Technician Request Detection',
            priority: 80,
            isActive: true,
            trigger: {
                type: 'PHRASE_MATCH',
                phrases: [
                    'dustin',
                    'marcello',
                    'speak to dustin',
                    'talk to marcello',
                    'is dustin there',
                    'is marcello available',
                    'my technician',
                    'the guy who came'
                ],
                minConfidence: 0.6
            },
            actions: [
                {
                    type: 'ack_once',
                    config: { text: "I see you're trying to reach one of our technicians. Let me connect you with our service team." }
                },
                {
                    type: 'append_ledger',
                    config: { type: 'TECHNICIAN_REQUEST', data: { matched: true } }
                }
            ],
            settings: {
                allowConcurrent: false
            }
        },
        {
            flowKey: 'booking_intent',
            name: 'Booking Intent Detection',
            priority: 50,
            isActive: true,
            trigger: {
                type: 'PHRASE_MATCH',
                phrases: [
                    'schedule',
                    'appointment',
                    'book',
                    'come out',
                    'send someone',
                    'need service',
                    'need repair',
                    'can you fix',
                    'available',
                    'when can you come'
                ],
                minConfidence: 0.6
            },
            actions: [
                {
                    type: 'ack_once',
                    config: { text: "I'd be happy to help you schedule service!" }
                },
                {
                    type: 'transition_mode',
                    config: { targetMode: 'BOOKING' }
                }
            ],
            settings: {
                allowConcurrent: false
            }
        }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // H) TEMPLATES TO ACTIVATE
    // ═══════════════════════════════════════════════════════════════════════
    templatesActivate: [
        { templateType: 'hvac', name: 'HVAC Trade Knowledge Template' },
        { templateType: 'universal', name: 'Universal AI Brain' }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // I) SCENARIO/CATEGORY TOGGLES
    // ═══════════════════════════════════════════════════════════════════════
    // Categories to DISABLE (to demonstrate "Not Offered" behavior)
    disabledCategories: [
        { name: 'Duct Cleaning', reason: 'Demonstrates Not Offered behavior' }
    ],
    
    // Selected trade category
    selectedTradeCategory: 'hvac_residential'
};


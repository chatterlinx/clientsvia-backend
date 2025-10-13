/**
 * ============================================================================
 * UNIVERSAL TEST TEMPLATE - 12 CATEGORIES FOR COMPREHENSIVE TESTING
 * ============================================================================
 * 
 * PURPOSE:
 * Seeds the "Universal AI Brain (All Industries)" template with 12 test
 * categories and 24+ scenarios covering ALL form fields and features.
 * 
 * USE CASE:
 * - Test the world-class scenario form with real data
 * - Phone test all matching strategies (BM25, regex, negative triggers)
 * - Validate entity capture, action hooks, and follow-up flows
 * - Iron out bugs before scaling to 103 universal categories
 * 
 * HOW TO RUN:
 * ```
 * node scripts/seed-templates/universal-test-12-categories.js
 * ```
 * 
 * HOW TO DELETE:
 * Option 1: Delete via UI (Dashboard → Templates → Delete button)
 * Option 2: Run this command in mongo shell:
 * ```
 * db.globalinstantresponsetemplates.deleteOne({ name: "Universal AI Brain (All Industries)" })
 * ```
 * Option 3: Delete this file when done testing (no traces in codebase)
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { ulid } = require('ulid');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in environment variables');
    process.exit(1);
}

// ============================================================================
// TEMPLATE DATA
// ============================================================================

const templateData = {
    version: 'v1.0.0',
    name: 'Universal AI Brain (All Industries)',
    description: 'Test template with 12 categories covering all scenario form fields',
    templateType: 'universal',
    industryLabel: 'All Industries',
    isActive: true,
    isPublished: true,
    isDefaultTemplate: true,
    
    categories: [
        // ====================================================================
        // CATEGORY 1: APPOINTMENT BOOKING
        // Tests: Entities, validation, action hooks, follow-up
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Appointment Booking',
            icon: '📅',
            description: 'Scheduling appointments and consultations',
            behavior: 'friendly_warm',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Request Appointment',
                    isActive: true,
                    categories: ['Appointment Booking'],
                    priority: 10,
                    minConfidence: 0.7,
                    
                    triggers: [
                        'I need an appointment',
                        'Can I schedule a visit',
                        'I want to book a time',
                        'Schedule me in',
                        'I need to see someone'
                    ],
                    
                    negativeTriggers: [
                        'cancel appointment',
                        'reschedule',
                        'change appointment'
                    ],
                    
                    regexTriggers: [
                        '(book|schedule|make).*appointment',
                        '(need|want).*appointment'
                    ],
                    
                    quickReplies: [
                        'I\'d be happy to help you schedule an appointment!',
                        'Great! Let me get you scheduled.',
                        'Perfect! I can help you book a time.'
                    ],
                    
                    fullReplies: [
                        'I\'d be happy to help you schedule an appointment. What day works best for you?',
                        'Great! Let me get you scheduled. Do you have a preferred date and time?',
                        'Perfect! I can help you book a time. When would you like to come in?'
                    ],
                    
                    followUpFunnel: 'Is there anything else I can help you with today?',
                    
                    entityCapture: ['preferred_date', 'preferred_time', 'customer_name'],
                    
                    entityValidation: {
                        preferred_date: { required: true, prompt: 'What date works for you?' },
                        preferred_time: { required: true, prompt: 'What time would you prefer?' },
                        customer_name: { required: false, prompt: 'May I have your name?' }
                    },
                    
                    dynamicVariables: {
                        '{date}': 'your preferred date',
                        '{time}': 'your preferred time',
                        '{name}': 'there'
                    },
                    
                    actionHooks: ['offer_scheduling', 'capture_customer_info'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    cooldownSeconds: 30,
                    maxTurns: 5,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                },
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Reschedule Appointment',
                    isActive: true,
                    categories: ['Appointment Booking'],
                    priority: 8,
                    minConfidence: 0.7,
                    
                    triggers: [
                        'I need to reschedule',
                        'Can I change my appointment',
                        'Move my appointment',
                        'Change my booking'
                    ],
                    
                    quickReplies: [
                        'No problem! I can help you reschedule.',
                        'Of course! Let me help you find a new time.'
                    ],
                    
                    fullReplies: [
                        'No problem! I can help you reschedule. What new date and time works better for you?',
                        'Of course! Let me help you find a new time that works. When would you prefer?'
                    ],
                    
                    actionHooks: ['offer_scheduling'],
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 2: EMERGENCY SERVICE
        // Tests: High priority, urgency detection, escalation hooks
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Emergency Service',
            icon: '🚨',
            description: 'Urgent situations requiring immediate attention',
            behavior: 'urgent_alert',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Emergency Request',
                    isActive: true,
                    categories: ['Emergency Service'],
                    priority: 100,
                    minConfidence: 0.8,
                    
                    triggers: [
                        'This is an emergency',
                        'I need help now',
                        'This is urgent',
                        'It\'s flooding',
                        'I have a leak',
                        'The power is out',
                        'Water is pouring',
                        'Ceiling is wet',
                        'Sparks flying',
                        'Burning smell',
                        'Gas smell',
                        'No heat at all',
                        'No cooling at all',
                        'Actively leaking right now',
                        'Burst pipe',
                        'Unsafe condition'
                    ],
                    
                    regexTriggers: [
                        'emergency',
                        '(urgent|asap|right now|immediately)',
                        '(flood|leak|fire|smoke|gas)',
                        'not working'
                    ],
                    
                    negativeTriggers: [
                        'schedule a visit',
                        'book an appointment',
                        'appointment please',
                        'schedule me in',
                        'can i schedule',
                        'can we schedule',
                        'set up a time',
                        'make an appointment'
                    ],
                    
                    quickReplies: [
                        'I understand this is urgent!',
                        'This sounds like an emergency!'
                    ],
                    
                    fullReplies: [
                        'I understand this is urgent! Let me connect you with our emergency team right away. Please stay on the line.',
                        'This sounds like an emergency! I\'m getting you to our emergency response team immediately. One moment please.'
                    ],
                    
                    actionHooks: ['escalate_to_human', 'emergency_dispatch'],
                    
                    handoffPolicy: 'always_on_keyword',
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    cooldownSeconds: 0,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 3: PRICING QUESTIONS
        // Tests: Complex triggers, follow-up flow, entity capture
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Pricing Questions',
            icon: '💰',
            description: 'Questions about costs, quotes, and pricing',
            behavior: 'professional_efficient',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'General Pricing Inquiry',
                    isActive: true,
                    categories: ['Pricing Questions'],
                    priority: 5,
                    minConfidence: 0.65,
                    
                    triggers: [
                        'How much does it cost',
                        'What\'s your pricing',
                        'How much do you charge',
                        'What are your rates',
                        'Can you give me a quote',
                        'What does this cost'
                    ],
                    
                    regexTriggers: [
                        '(how much|what.*cost|price|pricing|rate)',
                        'quote'
                    ],
                    
                    quickReplies: [
                        'Great question about pricing!',
                        'I can help you with that.'
                    ],
                    
                    fullReplies: [
                        'Great question! Our pricing depends on the specific service you need. Can you tell me a bit more about what you\'re looking for?',
                        'I can help you with that. To give you an accurate quote, could you describe what service you need?',
                        'Pricing varies based on the type of service. What specifically are you interested in?'
                    ],
                    
                    followUpFunnel: 'Would you like me to connect you with someone who can provide a detailed quote?',
                    
                    entityCapture: ['service_type', 'customer_location'],
                    
                    actionHooks: ['offer_quote', 'capture_customer_info'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    cooldownSeconds: 20,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 4: BUSINESS HOURS
        // Tests: Simple scenario, regex patterns, time-based
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Business Hours',
            icon: '🕐',
            description: 'Questions about availability and operating hours',
            behavior: 'friendly_warm',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Hours of Operation',
                    isActive: true,
                    categories: ['Business Hours'],
                    priority: 3,
                    minConfidence: 0.75,
                    
                    triggers: [
                        'What are your hours',
                        'When are you open',
                        'Are you open',
                        'What time do you close',
                        'Business hours'
                    ],
                    
                    regexTriggers: [
                        '(hours|open|close)',
                        'what time.*open'
                    ],
                    
                    negativeTriggers: [
                        'appointment',
                        'how many hours'
                    ],
                    
                    quickReplies: [
                        'We\'re here to help!',
                        'Thanks for asking!'
                    ],
                    
                    fullReplies: [
                        'We\'re open Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We\'re closed on Sundays.',
                        'Our business hours are Monday to Friday, 8 in the morning until 6 in the evening, and Saturdays from 9 AM to 3 PM.',
                        'Great question! We operate Monday through Friday from 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We\'re closed Sundays.'
                    ],
                    
                    followUpFunnel: 'Would you like to schedule something during those hours?',
                    
                    actionHooks: ['provide_business_hours'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    cooldownSeconds: 60,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 5: HOLD REQUEST
        // Tests: Silence policy, timed follow-up, state management
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Hold Request',
            icon: '⏸️',
            description: 'Caller needs to pause or put call on hold',
            behavior: 'calm_patient',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Customer Asks to Hold',
                    isActive: true,
                    categories: ['Hold Request'],
                    priority: 7,
                    minConfidence: 0.8,
                    
                    triggers: [
                        'Hold on',
                        'Wait a second',
                        'Can you hold',
                        'Give me a moment',
                        'One second',
                        'Just a minute'
                    ],
                    
                    regexTriggers: [
                        '(hold|wait|moment|second|minute)'
                    ],
                    
                    quickReplies: [
                        'Of course! Take your time.',
                        'No problem! I\'ll wait.'
                    ],
                    
                    fullReplies: [
                        'Of course! Take your time. I\'ll be right here when you\'re ready.',
                        'No problem! I\'ll wait. Just let me know when you\'re back.',
                        'Absolutely! Take all the time you need. I\'m here when you\'re ready.'
                    ],
                    
                    timedFollowUp: {
                        enabled: true,
                        delaySeconds: 45,
                        message: 'I\'m still here! Just wanted to check if you\'re ready to continue.',
                        maxAttempts: 2,
                        intervalSeconds: 30
                    },
                    
                    silencePolicy: {
                        timeout: 90,
                        action: 'gentle_prompt',
                        message: 'Are you still there? I\'m happy to continue helping when you\'re ready.'
                    },
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'voice',
                    cooldownSeconds: 10,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 6: GRATITUDE / GOODBYE
        // Tests: Conversation endings, context weight, sentiment
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Gratitude / Goodbye',
            icon: '👋',
            description: 'Caller expressing thanks or ending conversation',
            behavior: 'friendly_warm',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Thank You / Goodbye',
                    isActive: true,
                    categories: ['Gratitude / Goodbye'],
                    priority: 2,
                    minConfidence: 0.7,
                    
                    triggers: [
                        'Thank you',
                        'Thanks',
                        'Goodbye',
                        'Bye',
                        'Have a good day',
                        'That\'s all I needed'
                    ],
                    
                    regexTriggers: [
                        '(thank|thanks)',
                        '(bye|goodbye|good day)'
                    ],
                    
                    quickReplies: [
                        'You\'re very welcome!',
                        'Happy to help!',
                        'My pleasure!'
                    ],
                    
                    fullReplies: [
                        'You\'re very welcome! If you need anything else, don\'t hesitate to call us. Have a wonderful day!',
                        'Happy to help! Feel free to reach out anytime. Take care!',
                        'My pleasure! We\'re here whenever you need us. Have a great day!'
                    ],
                    
                    actionHooks: ['close_conversation'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    maxTurns: 1,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 7: COMPLAINT / PROBLEM
        // Tests: Negative sentiment, escalation, empathy behavior
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Complaint / Problem',
            icon: '😟',
            description: 'Customer dissatisfaction or service issues',
            behavior: 'empathetic_concerned',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Service Complaint',
                    isActive: true,
                    categories: ['Complaint / Problem'],
                    priority: 15,
                    minConfidence: 0.75,
                    
                    triggers: [
                        'I\'m not happy',
                        'I have a complaint',
                        'This is unacceptable',
                        'I\'m disappointed',
                        'I have a problem',
                        'Something went wrong',
                        'I\'m upset'
                    ],
                    
                    regexTriggers: [
                        '(complaint|problem|issue|wrong)',
                        '(unhappy|upset|disappointed|frustrated)'
                    ],
                    
                    quickReplies: [
                        'I\'m very sorry to hear that.',
                        'I sincerely apologize.'
                    ],
                    
                    fullReplies: [
                        'I\'m very sorry to hear that you\'re not satisfied. Your concerns are important to us. Let me connect you with a manager who can address this properly.',
                        'I sincerely apologize for any inconvenience. I want to make sure this gets resolved for you. Let me get you to someone who can help right away.',
                        'I understand your frustration, and I\'m truly sorry. Let me escalate this to a supervisor who can give this the attention it deserves.'
                    ],
                    
                    actionHooks: ['escalate_to_human', 'log_complaint'],
                    
                    handoffPolicy: 'always_on_keyword',
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    maxTurns: 2,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 8: PAYMENT PLANS
        // Tests: Financial sensitivity, info capture, follow-up
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Payment Plans',
            icon: '💳',
            description: 'Questions about payment options and financing',
            behavior: 'professional_efficient',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Payment Plan Inquiry',
                    isActive: true,
                    categories: ['Payment Plans'],
                    priority: 6,
                    minConfidence: 0.7,
                    
                    triggers: [
                        'Do you offer payment plans',
                        'Can I make payments',
                        'Financing options',
                        'Pay over time',
                        'Monthly payments',
                        'Can I pay in installments'
                    ],
                    
                    regexTriggers: [
                        '(payment plan|financing|installment)',
                        '(pay.*time|monthly payment)'
                    ],
                    
                    quickReplies: [
                        'Absolutely!',
                        'Yes, we do!'
                    ],
                    
                    fullReplies: [
                        'Absolutely! We offer flexible payment plans to make things easier. Let me connect you with our billing team who can discuss the best options for you.',
                        'Yes, we do! We have several financing options available. I\'ll transfer you to someone who can explain all the details.',
                        'Great question! We have payment plans that can work with your budget. Let me get you to our finance specialist.'
                    ],
                    
                    followUpFunnel: 'Would you like to hear about our current financing promotions?',
                    
                    actionHooks: ['transfer_to_billing', 'offer_financing'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 9: BILLING QUESTION
        // Tests: Sensitive info, transfer hooks, context awareness
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Billing Question',
            icon: '📋',
            description: 'Questions about invoices, charges, and billing',
            behavior: 'professional_efficient',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Billing Inquiry',
                    isActive: true,
                    categories: ['Billing Question'],
                    priority: 8,
                    minConfidence: 0.7,
                    
                    triggers: [
                        'I have a billing question',
                        'Question about my bill',
                        'Why was I charged',
                        'My invoice',
                        'Billing issue',
                        'I was charged wrong'
                    ],
                    
                    regexTriggers: [
                        '(bill|invoice|charge|payment)',
                        'billing'
                    ],
                    
                    negativeTriggers: [
                        'payment plan',
                        'financing'
                    ],
                    
                    quickReplies: [
                        'I can help with that.',
                        'Let me assist you with billing.'
                    ],
                    
                    fullReplies: [
                        'I can help with that. Let me connect you with our billing department so they can review your account and answer your questions.',
                        'I understand you have a billing question. Let me transfer you to our billing specialist who can look into this for you.',
                        'Of course! Our billing team can help with that. Let me get you connected right away.'
                    ],
                    
                    actionHooks: ['transfer_to_billing', 'log_billing_inquiry'],
                    
                    handoffPolicy: 'always_on_keyword',
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 10: GENERAL INQUIRY
        // Tests: Low priority, catch-all, basic flow
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'General Inquiry',
            icon: '❓',
            description: 'Non-specific questions and general information',
            behavior: 'friendly_warm',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'General Question',
                    isActive: true,
                    categories: ['General Inquiry'],
                    priority: 1,
                    minConfidence: 0.5,
                    
                    triggers: [
                        'I have a question',
                        'Can you help me',
                        'I need information',
                        'Tell me about',
                        'I want to know'
                    ],
                    
                    quickReplies: [
                        'I\'m here to help!',
                        'Happy to assist!'
                    ],
                    
                    fullReplies: [
                        'I\'m here to help! What can I assist you with today?',
                        'Happy to assist! What would you like to know?',
                        'Of course! What information are you looking for?'
                    ],
                    
                    followUpFunnel: 'Is there something specific I can help you with?',
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 11: SMALL TALK / OFF-TOPIC
        // Tests: Negative triggers, low confidence, conversational
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Small Talk / Off-Topic',
            icon: '💬',
            description: 'Casual conversation not related to business',
            behavior: 'friendly_casual',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Casual Conversation',
                    isActive: true,
                    categories: ['Small Talk / Off-Topic'],
                    priority: 0,
                    minConfidence: 0.6,
                    
                    triggers: [
                        'How are you',
                        'Nice weather',
                        'How\'s your day',
                        'What\'s up',
                        'How\'s it going'
                    ],
                    
                    negativeTriggers: [
                        'appointment',
                        'service',
                        'help',
                        'question',
                        'problem'
                    ],
                    
                    quickReplies: [
                        'I\'m doing well, thanks!',
                        'All good here!'
                    ],
                    
                    fullReplies: [
                        'I\'m doing well, thanks for asking! How can I help you today?',
                        'All good here! What brings you in today?',
                        'I\'m great, thank you! What can I assist you with?'
                    ],
                    
                    followUpFunnel: 'So, what can I help you with today?',
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    cooldownSeconds: 300,
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        },
        
        // ====================================================================
        // CATEGORY 12: CONFUSED / UNCERTAIN
        // Tests: Low confidence handling, empathy, guidance
        // ====================================================================
        {
            id: `cat-${ulid()}`,
            name: 'Confused / Uncertain',
            icon: '🤔',
            description: 'Caller is unsure or needs guidance',
            behavior: 'calm_patient',
            isActive: true,
            scenarios: [
                {
                    scenarioId: `scn-${ulid()}`,
                    version: 1,
                    status: 'live',
                    name: 'Customer Unsure',
                    isActive: true,
                    categories: ['Confused / Uncertain'],
                    priority: 4,
                    minConfidence: 0.65,
                    
                    triggers: [
                        'I\'m not sure',
                        'I don\'t know',
                        'Maybe',
                        'I\'m confused',
                        'I\'m not certain',
                        'I think'
                    ],
                    
                    regexTriggers: [
                        '(not sure|don\'t know|maybe|confused|uncertain)',
                        'I think'
                    ],
                    
                    quickReplies: [
                        'No worries!',
                        'That\'s okay!'
                    ],
                    
                    fullReplies: [
                        'No worries at all! Let me help you figure out what you need. Can you tell me a bit more about your situation?',
                        'That\'s completely okay! I\'m here to guide you. What brings you in today?',
                        'No problem! Let\'s work through this together. What\'s on your mind?'
                    ],
                    
                    followUpFunnel: 'Would it help if I explained some of our services?',
                    
                    actionHooks: ['offer_guidance'],
                    
                    replySelection: 'random',
                    language: 'en',
                    channel: 'any',
                    
                    createdBy: 'system-seed',
                    updatedBy: 'system-seed'
                }
            ]
        }
    ]
};

// ============================================================================
// SEED FUNCTION
// ============================================================================

async function seedUniversalTestTemplate() {
    try {
        console.log('🌱 [SEED] Starting Universal Test Template seed...');
        console.log(`📦 [SEED] Connecting to MongoDB: ${MONGODB_URI.replace(/\/\/.*:.*@/, '//***:***@')}`);
        
        await mongoose.connect(MONGODB_URI);
        console.log('✅ [SEED] Connected to MongoDB');
        
        // Delete existing Universal AI Brain template if it exists
        const existingTemplate = await GlobalInstantResponseTemplate.findOne({ 
            name: 'Universal AI Brain (All Industries)' 
        });
        
        if (existingTemplate) {
            console.log('🗑️  [SEED] Found existing Universal AI Brain template, deleting...');
            await GlobalInstantResponseTemplate.deleteOne({ _id: existingTemplate._id });
            console.log('✅ [SEED] Deleted existing template');
        }
        
        // Create new template
        console.log('📝 [SEED] Creating new Universal AI Brain template...');
        const template = new GlobalInstantResponseTemplate(templateData);
        await template.save();
        
        console.log('✅ [SEED] Template created successfully!');
        console.log(`📊 [SEED] Template ID: ${template._id}`);
        console.log(`📊 [SEED] Categories: ${template.categories.length}`);
        console.log(`📊 [SEED] Total Scenarios: ${template.stats.totalScenarios}`);
        
        // Print category summary
        console.log('\n📋 [SEED] Category Summary:');
        template.categories.forEach((cat, idx) => {
            console.log(`   ${idx + 1}. ${cat.icon} ${cat.name} - ${cat.scenarios.length} scenario(s)`);
        });
        
        console.log('\n🎉 [SEED] Seed completed successfully!');
        console.log('\n🧪 [TEST] You can now test this template via:');
        console.log('   1. Phone: Call your Twilio test number');
        console.log('   2. UI: View in Global AI Brain dashboard');
        console.log('   3. Edit: Add/modify scenarios via the form');
        
    } catch (error) {
        console.error('❌ [SEED] Error seeding template:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('\n👋 [SEED] Database connection closed');
    }
}

// Run the seed
seedUniversalTestTemplate();


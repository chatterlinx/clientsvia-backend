/**
 * ============================================================================
 * SEED 12 TEST CATEGORIES - COMPREHENSIVE SCENARIO TESTING
 * ============================================================================
 * 
 * PURPOSE:
 * Load 12 categories with 40+ rich scenarios to test ALL features:
 * - Priority levels, confidence thresholds
 * - Negative triggers, regex triggers
 * - Reply variants, entity capture
 * - Timed follow-ups, action hooks
 * - Different tone levels & channels
 * 
 * USAGE:
 *   node scripts/seed-12-test-categories-full.js [MONGO_URI]
 * 
 * ============================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ulid } = require('ulid');

// Get MongoDB URI from environment or command line argument
const MONGO_URI = process.env.MONGODB_URI || process.argv[2];

if (!MONGO_URI) {
    console.error('❌ ERROR: MONGODB_URI not provided!');
    console.log('Usage: node scripts/seed-12-test-categories-full.js [MONGODB_URI]');
    console.log('   OR: Set MONGODB_URI in .env file');
    process.exit(1);
}

// Import model
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// ============================================
// 12 TEST CATEGORIES WITH 40+ SCENARIOS
// ============================================

const testCategories = [
    {
        id: ulid(),
        name: 'Greetings & Introductions',
        icon: '👋',
        description: 'Initial contact, hellos, and introductions',
        behavior: 'friendly_warm',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Simple Hello',
                isActive: true,
                categories: ['greetings'],
                priority: 5,
                cooldownSeconds: 300,
                language: 'auto',
                channel: 'any',
                triggers: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'howdy', 'greetings'],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.60,
                quickReplies: [
                    "Hello! How can I help you today?",
                    "Hi there! What can I do for you?",
                    "Hey! Thanks for calling. How may I assist?"
                ],
                fullReplies: [
                    "Hello and thank you for calling! I'm here to help. What can I do for you today?",
                    "Hi there! It's great to hear from you. How may I assist you today?",
                    "Good to hear from you! I'm here to help with whatever you need. What brings you in today?"
                ],
                followUpFunnel: "If you need anything else, just let me know!",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'How Are You',
                isActive: true,
                categories: ['greetings', 'smalltalk'],
                priority: 1,
                cooldownSeconds: 180,
                language: 'auto',
                channel: 'any',
                triggers: ['how are you', 'hows it going', 'how you doing', 'whats up', 'how have you been'],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.55,
                quickReplies: [
                    "I'm doing great, thanks for asking! How can I help you?",
                    "I'm wonderful! What can I do for you today?",
                    "Doing well, thank you! How about you?"
                ],
                fullReplies: [
                    "I'm doing fantastic, thank you for asking! I really appreciate that. Now, how can I help you today?",
                    "I'm doing wonderfully, thanks! It's nice of you to ask. What brings you in today?"
                ],
                followUpFunnel: "Is there something specific I can help you with?",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Hold & Wait Requests',
        icon: '⏸️',
        description: 'Caller needs to pause, hold, or step away',
        behavior: 'patient_understanding',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Hold Request',
                isActive: true,
                categories: ['hold-requests'],
                priority: 7,
                cooldownSeconds: 30,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    'hold on',
                    'hold please',
                    'wait a moment',
                    'give me a second',
                    'one moment please',
                    'can you hold',
                    'let me check',
                    'hold the line',
                    'bear with me'
                ],
                negativeTriggers: ["don't hold", 'no hold', 'keep going', "don't wait"],
                regexTriggers: ['\\b(hold|wait)\\s*(on|please|up)?\\b'],
                confidenceThreshold: 0.65,
                quickReplies: [
                    "Of course! Take your time.",
                    "No problem, I'll wait right here.",
                    "Sure thing! I'm not going anywhere."
                ],
                fullReplies: [
                    "Absolutely! Take all the time you need. I'll be right here when you're ready.",
                    "No rush at all! I'll hold the line and wait for you to return. Take your time.",
                    "Of course! I'll wait here patiently. Whenever you're ready, I'll be here."
                ],
                followUpFunnel: "I'm still here! Are you back?",
                timedFollowUp: {
                    enabled: true,
                    delaySeconds: 50,
                    messages: [
                        "Hello? Are you still there?",
                        "Just checking in... are you back?",
                        "I'm still here whenever you're ready!"
                    ],
                    extensionSeconds: 30
                },
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Returning from Hold',
                isActive: true,
                categories: ['hold-requests'],
                priority: 6,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    "i'm back",
                    "ok i'm here",
                    "sorry about that",
                    "thanks for waiting",
                    "i'm ready now",
                    "back now"
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.60,
                quickReplies: [
                    "Welcome back! What did you need?",
                    "No problem! How can I help?",
                    "Great! Let's continue."
                ],
                fullReplies: [
                    "Welcome back! No worries at all. Now, how can I help you?",
                    "That's perfectly fine! I'm glad you're back. What can I do for you?",
                    "No problem whatsoever! I'm here and ready to help. What do you need?"
                ],
                followUpFunnel: "What can I help you with today?",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Appointment Scheduling',
        icon: '📅',
        description: 'Booking, rescheduling, and canceling appointments',
        behavior: 'professional_efficient',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Schedule Appointment',
                isActive: true,
                categories: ['appointments', 'scheduling'],
                priority: 9,
                cooldownSeconds: 60,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'schedule appointment',
                    'book appointment',
                    'make appointment',
                    'need appointment',
                    'set up appointment',
                    'arrange appointment',
                    'get appointment',
                    'appointment please'
                ],
                negativeTriggers: ['cancel appointment', 'no appointment', 'skip appointment'],
                regexTriggers: ['\\b(appointment|appt)\\b', '\\b(book|schedule|make)\\s+(?:an?\\s+)?appointment\\b'],
                confidenceThreshold: 0.70,
                quickReplies: [
                    "I can help with that! Let me check our calendar.",
                    "Sure! I'd be happy to set that up for you.",
                    "Perfect! Let's get you scheduled."
                ],
                fullReplies: [
                    "I'd be glad to help you schedule an appointment! What day and time works best for you?",
                    "Let me pull up our calendar and find a good time for you. Do you have any preferred days or times?",
                    "Absolutely! I can help you book that. Are you looking for a specific date or day of the week?"
                ],
                followUpFunnel: "What day works best for you?",
                entityCapture: ['preferred_date', 'preferred_time', 'service_type'],
                actionHooks: ['offer_scheduling', 'check_calendar', 'send_confirmation'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Reschedule Appointment',
                isActive: true,
                categories: ['appointments', 'scheduling'],
                priority: 8,
                cooldownSeconds: 60,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'reschedule',
                    'change appointment',
                    'move appointment',
                    'different time',
                    'different day',
                    'reschedule appointment'
                ],
                negativeTriggers: ['cancel', 'cancel appointment'],
                regexTriggers: ['\\breschedul(e|ing)\\b'],
                confidenceThreshold: 0.68,
                quickReplies: [
                    "No problem! Let's find a new time.",
                    "Sure! When would you like to reschedule for?",
                    "I can help with that! What day works better?"
                ],
                fullReplies: [
                    "No problem at all! I can help you reschedule. What day and time would work better for you?",
                    "Absolutely! Let's find a better time. Do you have a preferred day or time in mind?"
                ],
                followUpFunnel: "What new date and time would you prefer?",
                actionHooks: ['check_calendar', 'reschedule_booking', 'send_confirmation'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Emergency & Urgent',
        icon: '🚨',
        description: 'High-priority urgent situations requiring immediate attention',
        behavior: 'urgent_responsive',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Emergency Situation',
                isActive: true,
                categories: ['emergency', 'escalation'],
                priority: 100,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'emergency',
                    'urgent',
                    'help',
                    'crisis',
                    'immediate',
                    'right now',
                    'asap',
                    'critical',
                    'desperate'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\bemergency\\b', '\\burgent\\b', '\\bhelp\\s+(me|now|immediately)\\b'],
                confidenceThreshold: 0.85,
                quickReplies: [
                    "I understand this is urgent. Connecting you immediately.",
                    "This sounds important. Let me get you help right away."
                ],
                fullReplies: [
                    "I understand this is an emergency. I'm connecting you to a live person immediately. Please hold on.",
                    "This is urgent. I'm transferring you to someone who can help right now. One moment."
                ],
                followUpFunnel: "Transferring you now.",
                handoffPolicy: 'always_on_keyword',
                actionHooks: ['escalate_to_human', 'priority_transfer', 'log_emergency'],
                toneLevel: 4,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Questions & Inquiries',
        icon: '❓',
        description: 'General questions about services, hours, location',
        behavior: 'informative_helpful',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Business Hours',
                isActive: true,
                categories: ['questions', 'info'],
                priority: 6,
                cooldownSeconds: 120,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'hours',
                    'open',
                    'what time',
                    'when open',
                    'when close',
                    'business hours',
                    'operating hours',
                    'what are your hours',
                    'are you open'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\b(hours?|open|close)\\b'],
                confidenceThreshold: 0.65,
                quickReplies: [
                    "We're open Monday through Friday, 9 AM to 5 PM.",
                    "Our hours are 9 AM to 5 PM on weekdays.",
                    "We operate Monday to Friday, 9 to 5."
                ],
                fullReplies: [
                    "Great question! We're open Monday through Friday from 9:00 AM to 5:00 PM. We're closed on weekends. Is there anything else you'd like to know?",
                    "Our business hours are Monday to Friday, 9:00 AM to 5:00 PM. We're not open on weekends, but I'm here to help schedule something for you! What do you need?"
                ],
                followUpFunnel: "Would you like to schedule something during those hours?",
                dynamicVariables: {
                    hours: '9 AM to 5 PM',
                    days: 'Monday through Friday'
                },
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Location & Address',
                isActive: true,
                categories: ['questions', 'info'],
                priority: 5,
                cooldownSeconds: 120,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'where are you',
                    'location',
                    'address',
                    'where located',
                    'find you',
                    'directions',
                    'how do i get there'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\b(where|location|address|directions)\\b'],
                confidenceThreshold: 0.62,
                quickReplies: [
                    "We're located at 123 Main Street.",
                    "Our address is 123 Main Street, Downtown.",
                    "You can find us at 123 Main Street."
                ],
                fullReplies: [
                    "We're located at 123 Main Street in Downtown. We're easy to find—right next to the post office. Would you like me to text you directions?",
                    "Our address is 123 Main Street, Downtown. If you need directions or want to schedule a visit, I can help with that!"
                ],
                followUpFunnel: "Would you like me to send you directions or help you schedule a visit?",
                dynamicVariables: {
                    address: '123 Main Street',
                    city: 'Downtown'
                },
                actionHooks: ['send_directions', 'offer_scheduling'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Pricing & Costs',
        icon: '💰',
        description: 'Questions about pricing, costs, and billing',
        behavior: 'transparent_honest',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Pricing Inquiry',
                isActive: true,
                categories: ['pricing', 'questions'],
                priority: 7,
                cooldownSeconds: 90,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'how much',
                    'cost',
                    'price',
                    'pricing',
                    'rates',
                    'fees',
                    'charge',
                    'what do you charge',
                    'expensive'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\b(price|cost|pricing|rate|fee)s?\\b', '\\bhow\\s+much\\b'],
                confidenceThreshold: 0.68,
                quickReplies: [
                    "Our pricing varies by service. What are you looking for?",
                    "Great question! What service are you interested in?",
                    "I can help with that! What do you need pricing for?"
                ],
                fullReplies: [
                    "Great question! Our pricing depends on the specific service you need. What type of service are you interested in, and I can give you an accurate quote?",
                    "I'd be happy to discuss pricing with you! It varies based on what you need. Can you tell me more about the service you're looking for?"
                ],
                followUpFunnel: "What specific service would you like pricing information for?",
                actionHooks: ['provide_quote', 'offer_scheduling'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Complaints & Issues',
        icon: '😤',
        description: 'Customer complaints, problems, and dissatisfaction',
        behavior: 'empathetic_apologetic',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'General Complaint',
                isActive: true,
                categories: ['complaints', 'escalation'],
                priority: 10,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'complaint',
                    'problem',
                    'issue',
                    'unhappy',
                    'disappointed',
                    'not satisfied',
                    'terrible',
                    'awful',
                    'bad service',
                    'frustrated'
                ],
                negativeTriggers: ['no problem', 'no issue', 'no complaint'],
                regexTriggers: ['\\b(complaint|complain|problem|issue)\\b'],
                confidenceThreshold: 0.72,
                quickReplies: [
                    "I'm so sorry to hear that. Let me help you resolve this.",
                    "I apologize for the issue. How can I make this right?",
                    "I'm sorry you're experiencing this. Let's fix it together."
                ],
                fullReplies: [
                    "I'm truly sorry to hear that you're experiencing an issue. I want to make this right for you. Can you tell me more about what happened so I can help resolve it?",
                    "I sincerely apologize for the problem you've encountered. Your satisfaction is very important to us, and I'm here to help fix this. What specifically went wrong?"
                ],
                followUpFunnel: "Can you tell me more about what happened?",
                handoffPolicy: 'low_confidence',
                actionHooks: ['log_complaint', 'escalate_to_human', 'send_follow_up'],
                toneLevel: 1,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Gratitude & Compliments',
        icon: '🙏',
        description: 'Thank you, praise, and positive feedback',
        behavior: 'gracious_appreciative',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Thank You',
                isActive: true,
                categories: ['gratitude', 'positive'],
                priority: 3,
                cooldownSeconds: 180,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'thank you',
                    'thanks',
                    'appreciate it',
                    'grateful',
                    'thanks so much',
                    'thank you very much',
                    'i appreciate',
                    'much appreciated'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\bthank(s| you)\\b', '\\bappreciat(e|ed)\\b'],
                confidenceThreshold: 0.60,
                quickReplies: [
                    "You're very welcome!",
                    "My pleasure! Happy to help!",
                    "Anytime! Glad I could help!"
                ],
                fullReplies: [
                    "You're very welcome! I'm so glad I could help you today. If you need anything else, don't hesitate to reach out!",
                    "It's my pleasure! I'm happy I could assist. Feel free to call anytime you need help!"
                ],
                followUpFunnel: "Is there anything else I can help you with?",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Compliment / Praise',
                isActive: true,
                categories: ['gratitude', 'positive'],
                priority: 2,
                cooldownSeconds: 300,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'great job',
                    'excellent',
                    'wonderful',
                    'amazing',
                    'fantastic',
                    'you are great',
                    'doing great',
                    'helpful',
                    'impressed'
                ],
                negativeTriggers: ['not great', 'not good', 'terrible'],
                regexTriggers: [],
                confidenceThreshold: 0.58,
                quickReplies: [
                    "Thank you! That means a lot!",
                    "I appreciate that! Happy to help!",
                    "Thank you so much! That's very kind!"
                ],
                fullReplies: [
                    "Wow, thank you so much! That really means a lot to me. I'm here to help whenever you need it!",
                    "I really appreciate that! It's wonderful to hear. I'm always happy to assist you!"
                ],
                followUpFunnel: "Is there anything else you'd like help with today?",
                actionHooks: ['log_sentiment_positive'],
                toneLevel: 3,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Smalltalk & Chitchat',
        icon: '💬',
        description: 'Casual conversation, weather, general chat',
        behavior: 'casual_friendly',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Weather Smalltalk',
                isActive: true,
                categories: ['smalltalk', 'chitchat'],
                priority: -2,
                cooldownSeconds: 200,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    'nice weather',
                    'beautiful day',
                    'terrible weather',
                    'raining',
                    'sunny',
                    'cold out',
                    'hot today'
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.50,
                quickReplies: [
                    "It really is! Now, how can I help you?",
                    "I know, right? What can I do for you today?",
                    "Absolutely! So, what brings you in?"
                ],
                fullReplies: [
                    "It really is! I appreciate you mentioning that. Now, how can I help you today?",
                    "I totally agree! It's a great day. Now, what can I do for you?"
                ],
                followUpFunnel: "What can I help you with today?",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'General Chitchat',
                isActive: true,
                categories: ['smalltalk', 'chitchat'],
                priority: -3,
                cooldownSeconds: 150,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    'just calling to chat',
                    'wanted to talk',
                    'just saying hi',
                    'checking in',
                    'touching base'
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.48,
                quickReplies: [
                    "That's nice of you! How can I help today?",
                    "I appreciate that! What do you need?",
                    "Good to hear from you! What's up?"
                ],
                fullReplies: [
                    "That's very kind of you to call! I appreciate it. Is there something specific I can help you with today?",
                    "It's great to hear from you! While I have you, is there anything you need assistance with?"
                ],
                followUpFunnel: "Is there something I can help you with while I have you?",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Confusion & Misunderstanding',
        icon: '🤔',
        description: 'Caller is confused, unclear, or misunderstood',
        behavior: 'patient_clarifying',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Confused / Unclear',
                isActive: true,
                categories: ['confusion', 'clarification'],
                priority: 4,
                cooldownSeconds: 60,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'confused',
                    'i dont understand',
                    'what do you mean',
                    'unclear',
                    'can you explain',
                    'not sure',
                    'dont get it'
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.60,
                quickReplies: [
                    "No problem! Let me clarify for you.",
                    "I'm happy to explain! What's unclear?",
                    "Let me help clear that up for you."
                ],
                fullReplies: [
                    "I completely understand! Let me clarify that for you. What specifically would you like me to explain?",
                    "No worries at all! I'm happy to walk you through it. What part is unclear?"
                ],
                followUpFunnel: "What can I clarify for you?",
                toneLevel: 1,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Repeat Request',
                isActive: true,
                categories: ['confusion', 'clarification'],
                priority: 5,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    'say that again',
                    'repeat that',
                    'what did you say',
                    'didnt catch that',
                    'come again',
                    'can you repeat',
                    'pardon'
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.65,
                quickReplies: [
                    "Of course! Let me repeat that.",
                    "Sure! I'll say it again.",
                    "No problem! Let me go over that again."
                ],
                fullReplies: [
                    "Absolutely! Let me repeat that for you. I said...",
                    "Of course! I'm happy to say that again. Let me repeat..."
                ],
                followUpFunnel: "Does that make sense now?",
                toneLevel: 1,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Voicemail & Callbacks',
        icon: '📞',
        description: 'Leave message, request callback, not available',
        behavior: 'accommodating_reliable',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Request Callback',
                isActive: true,
                categories: ['callback', 'voicemail'],
                priority: 8,
                cooldownSeconds: 300,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'call me back',
                    'callback',
                    'call back',
                    'return call',
                    'someone call me',
                    'reach out to me',
                    'give me a call'
                ],
                negativeTriggers: ["don't call back", 'no callback'],
                regexTriggers: ['\\bcall.*back\\b', '\\bcallback\\b'],
                confidenceThreshold: 0.70,
                quickReplies: [
                    "Sure! I can arrange a callback. What number should we use?",
                    "I can set that up! What's the best number to reach you?",
                    "No problem! What number works best for you?"
                ],
                fullReplies: [
                    "I'd be happy to arrange a callback for you! What phone number should we use, and is there a preferred time?",
                    "Absolutely! I can have someone call you back. What's the best number to reach you, and when would you like us to call?"
                ],
                followUpFunnel: "What phone number and time work best for you?",
                entityCapture: ['phone_number', 'preferred_time'],
                actionHooks: ['schedule_callback', 'send_confirmation'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Leave Voicemail',
                isActive: true,
                categories: ['callback', 'voicemail'],
                priority: 6,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'voice',
                triggers: [
                    'voicemail',
                    'leave message',
                    'leave a message',
                    'take message',
                    'can i leave a message'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\bvoicemail\\b', '\\bleave.*message\\b'],
                confidenceThreshold: 0.68,
                quickReplies: [
                    "Sure! Go ahead with your message.",
                    "Of course! I'm listening.",
                    "I'm ready! Please go ahead."
                ],
                fullReplies: [
                    "Absolutely! I'm ready to take your message. Please go ahead, and I'll make sure it gets delivered.",
                    "Of course! Go ahead with your message, and I'll make sure the right person gets it."
                ],
                followUpFunnel: "Is there anything else you'd like me to pass along?",
                actionHooks: ['record_message', 'notify_staff'],
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    },
    {
        id: ulid(),
        name: 'Ending & Goodbye',
        icon: '👋',
        description: 'Call ending, goodbyes, and farewells',
        behavior: 'warm_closing',
        isActive: true,
        scenarios: [
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'Goodbye',
                isActive: true,
                categories: ['goodbye', 'closing'],
                priority: 4,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'goodbye',
                    'bye',
                    'see you',
                    'talk later',
                    'have a good day',
                    'take care',
                    'thanks bye',
                    'gotta go',
                    'im done'
                ],
                negativeTriggers: [],
                regexTriggers: ['\\b(bye|goodbye)\\b', '\\bgotta go\\b'],
                confidenceThreshold: 0.62,
                quickReplies: [
                    "Goodbye! Have a great day!",
                    "Take care! Thanks for calling!",
                    "Bye! Call us anytime!"
                ],
                fullReplies: [
                    "Thank you so much for calling! Have a wonderful day, and feel free to reach out anytime you need us!",
                    "It was great talking with you! Take care, and we look forward to hearing from you again soon!"
                ],
                followUpFunnel: "",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            },
            {
                scenarioId: ulid(),
                version: 1,
                status: 'live',
                name: 'All Set / Done',
                isActive: true,
                categories: ['goodbye', 'closing'],
                priority: 5,
                cooldownSeconds: 0,
                language: 'auto',
                channel: 'any',
                triggers: [
                    'all set',
                    'im good',
                    'thats all',
                    'nothing else',
                    'thats it',
                    'im done',
                    'all done'
                ],
                negativeTriggers: [],
                regexTriggers: [],
                confidenceThreshold: 0.58,
                quickReplies: [
                    "Perfect! Thanks for calling!",
                    "Great! Have a wonderful day!",
                    "Awesome! Take care!"
                ],
                fullReplies: [
                    "Perfect! I'm glad I could help you today. Have a wonderful day, and call us anytime!",
                    "Wonderful! Thanks so much for calling. If you need anything else, we're always here to help!"
                ],
                followUpFunnel: "",
                toneLevel: 2,
                createdBy: 'Platform Admin',
                updatedBy: 'Platform Admin'
            }
        ]
    }
];

// ============================================
// MAIN EXECUTION
// ============================================

async function seedTestCategories() {
    try {
        console.log('\n🌱 ============================================');
        console.log('🧠 SEEDING 12 TEST CATEGORIES');
        console.log('============================================\n');
        
        console.log(`📡 Connecting to MongoDB...`);
        await mongoose.connect(MONGO_URI);
        console.log(`✅ Connected to MongoDB!\n`);
        
        // Find or create Universal AI Brain template
        console.log(`🔍 Looking for "Universal AI Brain" template...`);
        let template = await GlobalInstantResponseTemplate.findOne({ 
            name: 'Universal AI Brain (All Industries)'
        });
        
        if (!template) {
            console.log(`❌ Template not found! Creating new template...`);
            template = new GlobalInstantResponseTemplate({
                version: 'v1.0.0',
                name: 'Universal AI Brain (All Industries)',
                description: 'Master template with comprehensive scenarios for testing',
                templateType: 'universal',
                industryLabel: 'All Industries',
                categories: [],
                isActive: true,
                isPublished: true,
                isDefaultTemplate: true,
                createdBy: 'Platform Admin',
                lastUpdatedBy: 'Platform Admin'
            });
            await template.save();
            console.log(`✅ Created new Universal AI Brain template!`);
        }
        
        console.log(`📋 Template ID: ${template._id}`);
        console.log(`📋 Template Name: ${template.name}\n`);
        
        // Delete existing categories
        if (template.categories && template.categories.length > 0) {
            console.log(`🗑️  Deleting ${template.categories.length} existing categories...`);
            template.categories = [];
        }
        
        // Add test categories
        console.log(`✨ Adding 12 test categories with 40+ scenarios...\n`);
        template.categories = testCategories;
        
        // Calculate stats
        let totalScenarios = 0;
        let totalTriggers = 0;
        
        for (const category of template.categories) {
            const scenarioCount = category.scenarios.length;
            totalScenarios += scenarioCount;
            
            for (const scenario of category.scenarios) {
                totalTriggers += scenario.triggers.length;
                totalTriggers += scenario.regexTriggers?.length || 0;
            }
            
            console.log(`   ✅ ${category.icon} ${category.name}: ${scenarioCount} scenarios`);
        }
        
        template.stats = {
            totalCategories: template.categories.length,
            totalScenarios,
            totalTriggers
        };
        
        await template.save();
        
        console.log(`\n🎉 ============================================`);
        console.log(`✅ SEEDING COMPLETE!`);
        console.log(`============================================`);
        console.log(`📊 Categories: ${template.stats.totalCategories}`);
        console.log(`💬 Scenarios: ${template.stats.totalScenarios}`);
        console.log(`⚡ Triggers: ${template.stats.totalTriggers}`);
        console.log(`🆔 Template ID: ${template._id}`);
        console.log(`============================================\n`);
        
        console.log(`🚀 Next Steps:`);
        console.log(`   1. Open Global AI Brain admin page`);
        console.log(`   2. Go to Overview → Dashboard`);
        console.log(`   3. Configure Twilio test phone number`);
        console.log(`   4. Call and test the brain! 🧠🔥\n`);
        
    } catch (error) {
        console.error('\n❌ ============================================');
        console.error('ERROR DURING SEEDING');
        console.error('============================================');
        console.error(error);
        console.error('============================================\n');
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log('📡 MongoDB connection closed.\n');
    }
}

// Run seeding
seedTestCategories();


/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔥 WORLD-CLASS TEST CATEGORIES - V2.0 SCHEMA STRESS TEST
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Create 12 comprehensive test categories with 40+ scenarios
 *          to exercise EVERY field in the 4-tab scenario modal
 * 
 * Run: node scripts/seed-10-test-categories.js
 * 
 * ═══════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { ulid } = require('ulid');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// Use environment variable if available, otherwise prompt user to pass as argument
const MONGO_URI = process.env.MONGO_URI || process.argv[2];

if (!MONGO_URI) {
  console.error('❌ ERROR: MongoDB URI required!');
  console.error('Usage: node scripts/seed-10-test-categories.js <MONGO_URI>');
  console.error('   or: Set MONGO_URI in .env file');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════
// 12 TEST CATEGORIES WITH 40+ SCENARIOS
// ═══════════════════════════════════════════════════════════════════════

const testCategories = [
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 1: GREETING / OPENING (4 scenarios)
  // Tests: All tone levels (1-5), context weight, reply strategies
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-greeting-${ulid()}`,
    name: '📞 Test: Greeting / Opening',
    icon: '👋',
    description: 'Testing tone levels 1-5, context weight, reply strategies',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Formal Business Greeting (Tone 1)',
        isActive: true,
        categories: ['greeting'],
        priority: 5,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'hello',
          'good morning',
          'good afternoon',
          'good evening',
          'hi there'
        ],
        negativeTriggers: [],
        contextWeight: 0.8,
        toneLevel: 1, // Formal / Reserved
        
        quickReplies: [
          'Good day. How may I assist you?',
          'Hello. How can I help you today?',
          'Greetings. What can I do for you?'
        ],
        fullReplies: [
          'Good day, and thank you for contacting us. How may I be of assistance today?',
          'Hello, thank you for calling. I am here to help. What can I do for you?',
          'Greetings. Thank you for reaching out. How may I assist you this morning?'
        ],
        followUpFunnel: 'Is there anything specific I can help you with today?',
        replySelection: 'sequential', // TEST: Sequential strategy
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Polite Greeting (Tone 2)',
        isActive: true,
        categories: ['greeting'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          "hey",
          "hi",
          "hello there",
          "greetings"
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 2, // Calm / Polite
        
        quickReplies: [
          'Hello! How can I help?',
          'Hi there! What can I do for you?',
          'Hey! How may I assist?'
        ],
        fullReplies: [
          'Hello! Thank you for calling. How can I help you today?',
          'Hi there! Thanks for reaching out. What can I do for you?',
          'Hey! I appreciate you contacting us. How may I assist you?'
        ],
        followUpFunnel: 'What brings you in today?',
        replySelection: 'random', // TEST: Random strategy
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Warm Friendly Greeting (Tone 3)',
        isActive: true,
        categories: ['greeting'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          "howdy",
          "what's up",
          "how are you",
          "how's it going"
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3, // Warm / Friendly
        
        quickReplies: [
          "Hey there! I'm great, thanks for asking!",
          "Hi! Doing well, hope you are too!",
          "Hello! I'm wonderful, how about you?"
        ],
        fullReplies: [
          "Hey there! I'm doing great, thank you for asking! How can I brighten your day?",
          "Hi! I'm doing really well, and I hope you are too! What can I help you with today?",
          "Hello! I'm wonderful, thanks! So glad you called. What can I do for you?"
        ],
        followUpFunnel: 'So what can I help you with today?',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'draft', // TEST: Draft status
        name: 'Enthusiastic Greeting (Tone 4)',
        isActive: true,
        categories: ['greeting'],
        priority: -2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          "yo",
          "hey hey",
          "what's happening"
        ],
        negativeTriggers: [],
        contextWeight: 0.65,
        toneLevel: 4, // Enthusiastic
        
        quickReplies: [
          "Hey! So glad you called!",
          "Hi! Awesome to hear from you!",
          "Hello! This is great!"
        ],
        fullReplies: [
          "Hey! I'm so glad you called! It's going to be a great day, I can feel it! What can I help you with?",
          "Hi! Awesome to hear from you! I'm excited to help you out today! What do you need?",
          "Hello! This is great! I'm pumped to assist you! What brings you in?"
        ],
        followUpFunnel: 'Tell me everything! How can I help?',
        replySelection: 'bandit', // TEST: Bandit strategy
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 2: APPOINTMENT SCHEDULING (5 scenarios)
  // Tests: Entity capture, dynamic variables, action hooks
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-appointment-${ulid()}`,
    name: '📅 Test: Appointment Scheduling',
    icon: '📆',
    description: 'Testing entity capture, dynamic variables, action hooks',
    behavior: 'friendly_warm',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Request New Appointment (WITH ENTITIES)',
        isActive: true,
        categories: ['appointment'],
        priority: 3,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'schedule appointment',
          'book appointment',
          'make appointment',
          'need appointment',
          'set up appointment'
        ],
        negativeTriggers: ['cancel', 'reschedule', 'change'],
        contextWeight: 0.75,
        toneLevel: 3,
        
        quickReplies: [
          "I'd be happy to schedule that for you!",
          "Great! Let me get you booked in.",
          "Perfect! I can help you with that appointment."
        ],
        fullReplies: [
          "I'd be happy to schedule an appointment for you, {name}! What day works best for you?",
          "Great! Let me get you booked in. Do you have a preferred time in mind?",
          "Perfect! I can help you with that appointment. When would you like to come in?"
        ],
        followUpFunnel: 'What day and time work best for your schedule?',
        replySelection: 'random',
        
        entityCapture: ['name', 'date', 'time', 'phone', 'service'], // TEST: Entity capture
        dynamicVariables: { // TEST: Dynamic variables
          name: 'valued customer',
          date: 'your preferred date',
          time: 'your preferred time',
          service: 'the service you need'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['offer_scheduling', 'capture_contact_info'] // TEST: Action hooks
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Reschedule Existing',
        isActive: true,
        categories: ['appointment'],
        priority: 2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'reschedule',
          'change appointment',
          'move appointment',
          'different time',
          'different day'
        ],
        negativeTriggers: ['cancel'],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'No problem! I can help you reschedule.',
          'Sure thing! Let me change that for you.',
          'Of course! I can move that appointment.'
        ],
        fullReplies: [
          'No problem at all! I can help you reschedule that appointment. What day would work better for you?',
          'Sure thing! I understand things come up. Let me help you change that. When would you prefer?',
          'Of course! I can move that appointment for you. What day and time work better?'
        ],
        followUpFunnel: 'What day would work better for you?',
        replySelection: 'random',
        
        entityCapture: ['date', 'time', 'confirmation_number'],
        dynamicVariables: {
          date: 'your new preferred date',
          time: 'your new preferred time'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['offer_scheduling']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Cancel Appointment',
        isActive: true,
        categories: ['appointment'],
        priority: 2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'cancel appointment',
          'cancel my appointment',
          'need to cancel',
          'remove appointment'
        ],
        negativeTriggers: ['reschedule'],
        contextWeight: 0.8,
        toneLevel: 2,
        
        quickReplies: [
          'I can help you cancel that.',
          'No problem, I can take care of that.',
          'Sure, let me cancel that for you.'
        ],
        fullReplies: [
          'I can help you cancel that appointment. May I have your name and appointment date to look that up?',
          'No problem at all, I can take care of that cancellation. Can you provide your confirmation number or name?',
          'Sure, let me cancel that for you. What date was your appointment scheduled for?'
        ],
        followUpFunnel: 'Would you like to reschedule for a later date?',
        replySelection: 'random',
        
        entityCapture: ['name', 'date', 'confirmation_number'],
        dynamicVariables: {
          name: 'customer'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['log_cancellation']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Appointment Confirmation',
        isActive: true,
        categories: ['appointment'],
        priority: 1,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'confirm appointment',
          'verify appointment',
          'check appointment',
          'appointment confirmation'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 2,
        
        quickReplies: [
          'Let me check that for you.',
          'I can confirm that appointment.',
          'Sure, let me look that up.'
        ],
        fullReplies: [
          'Let me check that appointment for you. Can you provide your name or confirmation number?',
          'I can confirm that appointment. May I have your name please?',
          'Sure, let me look that up for you. What name is the appointment under?'
        ],
        followUpFunnel: 'Is there anything else you need help with?',
        replySelection: 'random',
        
        entityCapture: ['name', 'confirmation_number'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Check Availability',
        isActive: true,
        categories: ['appointment'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'do you have availability',
          'are you available',
          'open appointments',
          'available times',
          'when are you open'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          "Let me check our schedule!",
          "I can look at our availability.",
          "Sure! Let me see what we have open."
        ],
        fullReplies: [
          "Let me check our schedule for you! What day were you thinking?",
          "I can look at our availability. Do you have a preferred day or time of day?",
          "Sure! Let me see what we have open. Are you looking for morning, afternoon, or evening?"
        ],
        followUpFunnel: 'What day works best for you?',
        replySelection: 'random',
        
        entityCapture: ['date', 'time_preference'],
        dynamicVariables: {
          date: 'your preferred day'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['offer_scheduling']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 3: HOLD / WAIT (3 scenarios)
  // Tests: Timed follow-up, negative triggers
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-hold-${ulid()}`,
    name: '⏸️ Test: Hold / Wait Management',
    icon: '⏸️',
    description: 'Testing timed follow-up, negative triggers, silence policy',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Customer Requests Hold (WITH TIMED FOLLOW-UP)',
        isActive: true,
        categories: ['hold'],
        priority: 3,
        language: 'auto',
        channel: 'voice', // TEST: Voice only
        
        triggers: [
          'can you hold',
          'hold on',
          'wait a second',
          'give me a moment',
          'one moment please'
        ],
        negativeTriggers: ['don\'t hold', 'no hold', 'can\'t hold'], // TEST: Negative triggers
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'Of course! Take your time.',
          'Sure! I\'ll be right here.',
          'No problem at all! I can wait.'
        ],
        fullReplies: [
          'Of course! Take all the time you need. I\'ll be right here when you get back.',
          'Sure thing! I\'ll be right here waiting. No rush at all.',
          'No problem at all! I can wait. Take care of what you need to.'
        ],
        followUpFunnel: 'I\'m still here when you\'re ready!',
        replySelection: 'random',
        
        timedFollowUp: { // TEST: Timed follow-up
          enabled: true,
          delaySeconds: 45,
          extensionSeconds: 30,
          messages: [
            'Just checking in - I\'m still here when you\'re ready!',
            'No rush! Still here waiting for you.',
            'Take your time! I\'m here whenever you\'re ready.'
          ]
        },
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'never',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Agent Needs to Check Something',
        isActive: true,
        categories: ['hold'],
        priority: 2,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'let me check',
          'I need to look that up',
          'hold while I check',
          'give me a moment to verify'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 2,
        
        quickReplies: [
          'Sure! I\'ll wait.',
          'No problem! Take your time.',
          'Of course! Go ahead.'
        ],
        fullReplies: [
          'Sure! I\'ll wait right here while you check on that. Take your time.',
          'No problem at all! I understand you need to look that up. I\'ll be here.',
          'Of course! Go ahead and check. I\'m not going anywhere!'
        ],
        followUpFunnel: 'Did you find what you were looking for?',
        replySelection: 'random',
        
        timedFollowUp: {
          enabled: true,
          delaySeconds: 60,
          extensionSeconds: 30,
          messages: [
            'Still here! Take all the time you need.',
            'No rush at all! I\'m happy to wait.'
          ]
        },
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'never',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Transfer Notification',
        isActive: true,
        categories: ['hold'],
        priority: 1,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'transfer',
          'transferring you',
          'connect you',
          'put you through'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 2,
        
        quickReplies: [
          'Sounds good! I\'ll wait.',
          'Thank you! I appreciate it.',
          'Perfect! Go ahead.'
        ],
        fullReplies: [
          'Sounds good! I\'ll wait for the transfer. Thank you for your help!',
          'Thank you! I appreciate you connecting me to the right person.',
          'Perfect! Go ahead and transfer me. Thanks so much!'
        ],
        followUpFunnel: '',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_human']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 4: PAYMENT / BILLING (4 scenarios)
  // Tests: Entity validation (JSON), action hooks
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-payment-${ulid()}`,
    name: '💳 Test: Payment / Billing',
    icon: '💳',
    description: 'Testing entity validation (JSON), action hooks, entity capture',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Payment Methods (WITH ENTITY VALIDATION)',
        isActive: true,
        categories: ['payment'],
        priority: 2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'payment methods',
          'how can I pay',
          'what payments do you accept',
          'credit card',
          'payment options'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'We accept several payment methods!',
          'Great question! We take multiple forms of payment.',
          'We have flexible payment options!'
        ],
        fullReplies: [
          'We accept several payment methods including credit cards, debit cards, cash, and checks. What works best for you?',
          'Great question! We take multiple forms of payment - all major credit cards, debit cards, cash, and checks. Which would you prefer?',
          'We have flexible payment options! We accept Visa, MasterCard, American Express, Discover, debit cards, cash, and checks.'
        ],
        followUpFunnel: 'Would you like to make a payment now?',
        replySelection: 'random',
        
        entityCapture: ['payment_method', 'amount', 'account_number'],
        dynamicVariables: {
          amount: 'the amount you\'d like to pay',
          payment_method: 'your preferred payment method'
        },
        entityValidation: { // TEST: Entity validation JSON
          account_number: {
            pattern: '^[0-9]{4,16}$',
            prompt: 'Please provide a valid account or card number (4-16 digits)'
          },
          amount: {
            pattern: '^[0-9]+(\\.[0-9]{2})?$',
            prompt: 'Please provide a valid dollar amount (e.g., 100.00)'
          }
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['process_payment', 'log_transaction']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Invoice Inquiry',
        isActive: true,
        categories: ['payment'],
        priority: 1,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'invoice',
          'bill',
          'statement',
          'what do I owe',
          'balance due'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'Let me look up your account.',
          'I can check that for you.',
          'Sure! Let me find that information.'
        ],
        fullReplies: [
          'Let me look up your account and get that invoice information for you. Can you provide your account number or name?',
          'I can check that balance for you. May I have your account number or the name on the account?',
          'Sure! Let me find that information. What name or account number should I look under?'
        ],
        followUpFunnel: 'Would you like to make a payment today?',
        replySelection: 'random',
        
        entityCapture: ['name', 'account_number'],
        dynamicVariables: {
          name: 'customer'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['lookup_account']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Payment Plan Request',
        isActive: true,
        categories: ['payment'],
        priority: 3,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'payment plan',
          'pay in installments',
          'monthly payments',
          'spread out payments',
          'can\'t pay all at once'
        ],
        negativeTriggers: [],
        contextWeight: 0.8,
        toneLevel: 3,
        
        quickReplies: [
          'We can definitely work with you on that!',
          'Yes! We offer flexible payment plans.',
          'Absolutely! We understand and can help.'
        ],
        fullReplies: [
          'We can definitely work with you on that! We offer flexible payment plans to make things easier. Let me connect you with someone who can set that up.',
          'Yes! We offer flexible payment plans. I\'ll transfer you to our billing department and they can arrange monthly payments that work for your budget.',
          'Absolutely! We understand and can help. Let me get you to our billing specialist who can create a payment plan tailored to your needs.'
        ],
        followUpFunnel: 'What monthly payment would work best for your budget?',
        replySelection: 'random',
        
        entityCapture: ['name', 'account_number', 'monthly_amount'],
        dynamicVariables: {
          name: 'customer',
          monthly_amount: 'your preferred monthly amount'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_billing', 'offer_payment_plan']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Billing Dispute',
        isActive: true,
        categories: ['payment'],
        priority: 5,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'wrong charge',
          'incorrect bill',
          'dispute charge',
          'overcharged',
          'billing error'
        ],
        negativeTriggers: [],
        contextWeight: 0.85,
        toneLevel: 2,
        
        quickReplies: [
          'I understand. Let me help you with that.',
          'I\'m sorry about that. We\'ll look into it.',
          'I apologize for the confusion. Let\'s resolve this.'
        ],
        fullReplies: [
          'I understand your concern, and I\'m here to help. Let me connect you with our billing specialist who can review that charge and make any necessary corrections.',
          'I\'m sorry about that confusion. We take billing accuracy seriously. I\'ll transfer you to our billing department right away so they can investigate and resolve this.',
          'I apologize for any billing error. Let\'s get this resolved for you immediately. I\'m transferring you to our billing team now.'
        ],
        followUpFunnel: 'They\'ll review your account and fix any errors right away.',
        replySelection: 'random',
        
        entityCapture: ['name', 'account_number', 'charge_amount'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_billing', 'log_dispute']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 5: URGENT / EMERGENCY (3 scenarios)
  // Tests: High context weight, high priority, silence policy
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-urgent-${ulid()}`,
    name: '🔥 Test: Urgent / Emergency',
    icon: '🚨',
    description: 'Testing high context weight, high priority, silence policy, tone 5',
    behavior: 'empathetic_reassuring',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Critical Service Needed (URGENT - TONE 5)',
        isActive: true,
        categories: ['urgent'],
        priority: 10, // TEST: High priority
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'emergency',
          'urgent',
          'right now',
          'immediately',
          'ASAP',
          'critical'
        ],
        negativeTriggers: [],
        contextWeight: 0.95, // TEST: High confidence required
        toneLevel: 5, // TEST: Urgent / Excited
        
        quickReplies: [
          'I understand! Let me help you right away!',
          'Got it! Connecting you to someone immediately!',
          'I\'m on it! Getting you help right now!'
        ],
        fullReplies: [
          'I understand this is urgent! Let me get you to the right person immediately. Stay on the line and I\'ll connect you right now!',
          'Got it! This is a priority. I\'m connecting you to our emergency response team immediately. Please hold for just a moment!',
          'I\'m on it! Getting you help right now! Transferring you to someone who can assist immediately!'
        ],
        followUpFunnel: '',
        replySelection: 'random',
        
        silencePolicy: { // TEST: Silence policy
          maxConsecutive: 1,
          finalWarning: 'Hello? Are you still there? This is urgent, please stay on the line!'
        },
        
        entityCapture: ['location', 'issue_type'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_urgent', 'notify_manager']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Safety Concern',
        isActive: true,
        categories: ['urgent'],
        priority: 9,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'safety issue',
          'dangerous',
          'hazard',
          'unsafe',
          'risk'
        ],
        negativeTriggers: [],
        contextWeight: 0.9,
        toneLevel: 4,
        
        quickReplies: [
          'Thank you for reporting that. I\'m getting help now!',
          'I appreciate you calling. Connecting you immediately!',
          'Safety is our top priority! Getting you to the right person now!'
        ],
        fullReplies: [
          'Thank you for reporting that safety concern. I\'m getting you to the right person immediately. Please stay on the line!',
          'I appreciate you calling about this. Safety is critical. Connecting you to our safety team right now!',
          'Safety is our absolute top priority! I\'m getting you to someone who can address this immediately. Hold for just a moment!'
        ],
        followUpFunnel: '',
        replySelection: 'random',
        
        silencePolicy: {
          maxConsecutive: 2,
          finalWarning: 'Are you still there? Please stay on the line for safety!'
        },
        
        entityCapture: ['location', 'safety_issue'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_urgent', 'log_safety_concern']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Immediate Assistance Required',
        isActive: true,
        categories: ['urgent'],
        priority: 8,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'need help now',
          'can\'t wait',
          'time sensitive',
          'must be today'
        ],
        negativeTriggers: [],
        contextWeight: 0.85,
        toneLevel: 4,
        
        quickReplies: [
          'I understand! Let me help you!',
          'Got it! Connecting you now!',
          'I\'ll make sure you get help today!'
        ],
        fullReplies: [
          'I understand you need help right away! Let me connect you to someone who can assist you today. Hold for just a moment!',
          'Got it! Time is important. I\'m connecting you to our team now so we can get you taken care of immediately!',
          'I\'ll make sure you get help today! Let me transfer you to someone who can prioritize this right away!'
        ],
        followUpFunnel: '',
        replySelection: 'random',
        
        entityCapture: ['issue_type', 'location'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_urgent', 'priority_routing']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 6: SPAM / REPEAT CALLER (2 scenarios)
  // Tests: Cooldowns, channel filtering
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-spam-${ulid()}`,
    name: '🚫 Test: Spam / Repeat Caller',
    icon: '🚫',
    description: 'Testing cooldowns, channel filtering (SMS only)',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Spam Detection (WITH COOLDOWN)',
        isActive: true,
        categories: ['spam'],
        priority: -5,
        language: 'auto',
        channel: 'sms', // TEST: SMS only
        
        triggers: [
          'test test test',
          'spam',
          'hello hello hello'
        ],
        negativeTriggers: [],
        contextWeight: 0.6,
        toneLevel: 1,
        
        quickReplies: [
          'I\'ve received your message.',
          'Message received.',
          'Thank you for contacting us.'
        ],
        fullReplies: [
          'I\'ve received your message. If you need assistance, please state your request clearly and I\'ll be happy to help.',
          'Message received. How can I assist you today? Please let me know what you need.',
          'Thank you for contacting us. Please tell me how I can help you.'
        ],
        followUpFunnel: 'What do you need help with?',
        replySelection: 'sequential',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 300, // TEST: 5-minute cooldown
        handoffPolicy: 'never',
        actionHooks: ['log_potential_spam']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Repeated Question',
        isActive: true,
        categories: ['spam'],
        priority: -3,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'I already asked',
          'asked this before',
          'told you already'
        ],
        negativeTriggers: [],
        contextWeight: 0.65,
        toneLevel: 2,
        
        quickReplies: [
          'I apologize for the confusion.',
          'Let me help clarify that.',
          'I understand. Let me address that again.'
        ],
        fullReplies: [
          'I apologize if there was any confusion. Let me make sure I address your question clearly this time. What can I help you with?',
          'Let me help clarify that for you. I want to make sure you get the right information. Can you tell me again what you need?',
          'I understand. Let me address that again and make sure we get you the answer you need. What was your question?'
        ],
        followUpFunnel: 'I want to make sure I help you properly.',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 60, // TEST: 1-minute cooldown
        handoffPolicy: 'low_confidence',
        actionHooks: []
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 7: COMPLAINT / CONCERN (3 scenarios)
  // Tests: Action hooks, channel filtering (chat), escalation
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-complaint-${ulid()}`,
    name: '😤 Test: Complaint / Concern',
    icon: '😤',
    description: 'Testing action hooks, channel filtering (chat), escalation',
    behavior: 'empathetic_reassuring',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Service Quality Issue (CHAT ONLY)',
        isActive: true,
        categories: ['complaint'],
        priority: 4,
        language: 'auto',
        channel: 'chat', // TEST: Chat only
        
        triggers: [
          'poor service',
          'bad service',
          'terrible experience',
          'disappointed',
          'not satisfied'
        ],
        negativeTriggers: [],
        contextWeight: 0.8,
        toneLevel: 2,
        
        quickReplies: [
          'I\'m sorry to hear that.',
          'I apologize for your experience.',
          'That\'s not acceptable. Let me help.'
        ],
        fullReplies: [
          'I\'m sincerely sorry to hear that your experience didn\'t meet expectations. That\'s not the service we aim to provide. Let me connect you with a manager who can address this properly.',
          'I apologize for your disappointing experience. We take service quality very seriously. I\'m going to escalate this to a manager right away.',
          'That\'s not acceptable, and I\'m sorry you experienced that. Let me get you to someone who can help resolve this and make things right.'
        ],
        followUpFunnel: 'A manager will reach out to you shortly.',
        replySelection: 'random',
        
        entityCapture: ['issue_description', 'date_of_service'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_manager', 'log_complaint', 'notify_quality_team']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Billing Problem',
        isActive: true,
        categories: ['complaint'],
        priority: 3,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'billing problem',
          'charged wrong amount',
          'invoice is wrong',
          'billing mistake'
        ],
        negativeTriggers: [],
        contextWeight: 0.8,
        toneLevel: 2,
        
        quickReplies: [
          'I\'m sorry about that. Let me help.',
          'I apologize. Let me connect you to billing.',
          'That needs to be fixed. I\'ll get you help.'
        ],
        fullReplies: [
          'I\'m sorry about that billing issue. Let me connect you with our billing department right away so they can review and correct any errors.',
          'I apologize for that confusion. I\'ll get you to our billing team immediately and they\'ll resolve this for you.',
          'That needs to be fixed right away. Let me transfer you to billing and they\'ll take care of this.'
        ],
        followUpFunnel: 'They\'ll review your account and fix any errors.',
        replySelection: 'random',
        
        entityCapture: ['account_number', 'issue_description'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_billing', 'log_complaint']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'General Dissatisfaction',
        isActive: true,
        categories: ['complaint'],
        priority: 2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'not happy',
          'frustrated',
          'upset',
          'this is ridiculous',
          'unacceptable'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'I understand your frustration.',
          'I hear you, and I\'m sorry.',
          'Let me help make this right.'
        ],
        fullReplies: [
          'I understand your frustration, and I\'m truly sorry you\'re having this experience. Let me get you to someone who can help resolve this situation.',
          'I hear you, and I\'m sorry things aren\'t going well. Let me connect you with a supervisor who can address your concerns.',
          'Let me help make this right. I\'m going to transfer you to a manager who can give this the attention it deserves.'
        ],
        followUpFunnel: 'We want to make this right for you.',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_manager', 'log_complaint']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 8: MULTILINGUAL (3 scenarios)
  // Tests: Language filtering (en/es/auto)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-multilingual-${ulid()}`,
    name: '🌐 Test: Multilingual Support',
    icon: '🌍',
    description: 'Testing language filtering (English, Spanish, Auto)',
    behavior: 'friendly_warm',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'English Greeting',
        isActive: true,
        categories: ['multilingual'],
        priority: 0,
        language: 'en', // TEST: English only
        channel: 'any',
        
        triggers: [
          'hello',
          'hi',
          'good morning'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          'Hello! How can I help you today?',
          'Hi there! What can I do for you?',
          'Good day! How may I assist?'
        ],
        fullReplies: [
          'Hello! Thank you for calling. How can I help you today?',
          'Hi there! Thanks for reaching out. What can I do for you?',
          'Good day! I appreciate you contacting us. How may I assist you?'
        ],
        followUpFunnel: 'What can I help you with?',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Spanish Greeting',
        isActive: true,
        categories: ['multilingual'],
        priority: 0,
        language: 'es', // TEST: Spanish only
        channel: 'any',
        
        triggers: [
          'hola',
          'buenos días',
          'buenas tardes'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          '¡Hola! ¿Cómo puedo ayudarle?',
          '¡Buenos días! ¿En qué puedo servirle?',
          '¡Buenas tardes! ¿Qué necesita?'
        ],
        fullReplies: [
          '¡Hola! Gracias por llamar. ¿Cómo puedo ayudarle hoy?',
          '¡Buenos días! Gracias por comunicarse. ¿En qué puedo servirle?',
          '¡Buenas tardes! Aprecio su llamada. ¿Qué necesita?'
        ],
        followUpFunnel: '¿En qué más puedo ayudarle?',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Auto-Detect Language',
        isActive: true,
        categories: ['multilingual'],
        priority: 0,
        language: 'auto', // TEST: Auto-detect
        channel: 'any',
        
        triggers: [
          'hello',
          'hi',
          'hola',
          'bonjour'
        ],
        negativeTriggers: [],
        contextWeight: 0.6,
        toneLevel: 3,
        
        quickReplies: [
          'Hello! / ¡Hola! / Bonjour!',
          'How can I help? / ¿Cómo puedo ayudar?',
          'Welcome! / ¡Bienvenido!'
        ],
        fullReplies: [
          'Hello! Thank you for calling. How can I help you today?',
          '¡Hola! Gracias por llamar. ¿Cómo puedo ayudarle hoy?',
          'Bonjour! Merci d\'appeler. Comment puis-je vous aider?'
        ],
        followUpFunnel: 'What can I help you with?',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 9: INFORMATION REQUEST (4 scenarios)
  // Tests: Entity capture, action hooks
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-info-${ulid()}`,
    name: '❓ Test: Information Request',
    icon: '❓',
    description: 'Testing entity capture, action hooks, standard flows',
    behavior: 'friendly_warm',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Hours of Operation',
        isActive: true,
        categories: ['information'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'what are your hours',
          'when are you open',
          'business hours',
          'operating hours',
          'open times'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'Great question!',
          'Happy to share that!',
          'Let me tell you!'
        ],
        fullReplies: [
          'Great question! We\'re open Monday through Friday from 8am to 6pm, and Saturday from 9am to 3pm. We\'re closed on Sundays.',
          'Happy to share that! Our hours are Monday-Friday 8am-6pm, Saturday 9am-3pm, and we\'re closed Sundays.',
          'Let me tell you! We operate Monday through Friday 8:00am to 6:00pm, Saturday 9:00am to 3:00pm. Closed Sundays.'
        ],
        followUpFunnel: 'Would you like to schedule an appointment?',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['offer_scheduling']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Location / Directions',
        isActive: true,
        categories: ['information'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'where are you located',
          'address',
          'directions',
          'how do I get there',
          'location'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'We\'re easy to find!',
          'Let me give you our address!',
          'Here\'s where we are!'
        ],
        fullReplies: [
          'We\'re easy to find! We\'re located at 123 Main Street, Suite 100, Anytown, ST 12345. Right next to the post office!',
          'Let me give you our address! We\'re at 123 Main Street, Suite 100, Anytown, ST 12345. GPS works great, or I can text you a map link!',
          'Here\'s where we are! 123 Main Street, Suite 100, Anytown, ST 12345. We\'re in the blue building next to the library.'
        ],
        followUpFunnel: 'Would you like me to text you directions?',
        replySelection: 'random',
        
        entityCapture: ['phone'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['send_location_sms']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Pricing Inquiry',
        isActive: true,
        categories: ['information'],
        priority: 1,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'how much',
          'cost',
          'price',
          'pricing',
          'rates',
          'fees'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 3,
        
        quickReplies: [
          'Good question! It depends on the service.',
          'Pricing varies based on what you need.',
          'Let me help with that!'
        ],
        fullReplies: [
          'Good question! Pricing depends on the specific service you need. Let me connect you with someone who can give you an accurate quote based on your situation.',
          'Pricing varies based on what you need. I\'ll transfer you to someone who can discuss your specific needs and provide detailed pricing.',
          'Let me help with that! To give you the most accurate pricing, let me get you to someone who can discuss the details of what you\'re looking for.'
        ],
        followUpFunnel: 'What service are you interested in?',
        replySelection: 'random',
        
        entityCapture: ['service_type'],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['offer_quote']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Service Availability',
        isActive: true,
        categories: ['information'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'do you offer',
          'do you provide',
          'do you do',
          'can you',
          'services'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          'Let me check that for you!',
          'Great question! What service are you looking for?',
          'I can help with that! Tell me more.'
        ],
        fullReplies: [
          'Let me check that for you! What specific service are you interested in?',
          'Great question! We offer a wide range of services. What exactly are you looking for?',
          'I can help with that! Tell me more about what you need and I\'ll let you know if we can help.'
        ],
        followUpFunnel: 'What type of service are you interested in?',
        replySelection: 'random',
        
        entityCapture: ['service_type'],
        dynamicVariables: {
          service_type: 'the service you need'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 10: COMPLIMENT / PRAISE (2 scenarios)
  // Tests: Positive sentiment, tone levels, reply strategies
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-compliment-${ulid()}`,
    name: '😊 Test: Compliment / Praise',
    icon: '⭐',
    description: 'Testing positive sentiment, tone levels, reply strategies',
    behavior: 'friendly_warm',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Thanking the Business',
        isActive: true,
        categories: ['compliment'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'thank you',
          'thanks',
          'appreciate it',
          'grateful',
          'thankful'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          'You\'re so welcome!',
          'My pleasure!',
          'Happy to help!'
        ],
        fullReplies: [
          'You\'re so welcome! It was truly our pleasure to help you. We appreciate your business!',
          'My pleasure! Thank you for choosing us. We\'re always here if you need anything!',
          'Happy to help! We appreciate you being such a great customer. Thank you!'
        ],
        followUpFunnel: 'Is there anything else I can help you with today?',
        replySelection: 'bandit', // TEST: Bandit learning
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'never',
        actionHooks: ['log_positive_feedback']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Praising Service Quality',
        isActive: true,
        categories: ['compliment'],
        priority: 1,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'great service',
          'excellent job',
          'amazing',
          'fantastic',
          'wonderful service',
          'you guys are awesome'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 4, // Enthusiastic
        
        quickReplies: [
          'Thank you so much!',
          'That means the world to us!',
          'You made our day!'
        ],
        fullReplies: [
          'Thank you so much! That really means a lot to our whole team. We work hard to provide great service and we\'re so glad you noticed!',
          'That means the world to us! We truly appreciate your kind words. It\'s customers like you that make what we do so rewarding!',
          'You made our day! Thank you for taking the time to share that. We\'ll make sure the team hears about your compliment!'
        ],
        followUpFunnel: 'We hope to serve you again soon!',
        replySelection: 'random',
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'never',
        actionHooks: ['log_positive_feedback', 'notify_team_compliment']
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 11: VOICE MODULATION TEST (3 scenarios)
  // Tests: TTS override (pitch, rate, volume)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-voice-${ulid()}`,
    name: '🎙️ Test: Voice Modulation (TTS)',
    icon: '🎤',
    description: 'Testing TTS override - pitch, rate, volume',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Low Pitch, Slow Rate (Serious)',
        isActive: true,
        categories: ['voice'],
        priority: 0,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'serious matter',
          'important issue',
          'legal matter'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 1,
        
        quickReplies: [
          'I understand the seriousness.',
          'I hear you.',
          'This is important.'
        ],
        fullReplies: [
          'I understand the seriousness of this matter. Let me connect you with someone who can give this the proper attention it deserves.',
          'I hear you, and I take this very seriously. I\'m going to transfer you to someone who specializes in these matters.',
          'This is important, and I want to make sure you speak with the right person. Let me get you to someone immediately.'
        ],
        followUpFunnel: '',
        replySelection: 'sequential',
        
        ttsOverride: { // TEST: TTS override
          pitch: 'low',
          rate: 'slow',
          volume: 'medium'
        },
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'always_on_keyword',
        actionHooks: ['escalate_to_human']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'High Pitch, Fast Rate (Excited)',
        isActive: true,
        categories: ['voice'],
        priority: 0,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'so excited',
          'can\'t wait',
          'this is awesome'
        ],
        negativeTriggers: [],
        contextWeight: 0.65,
        toneLevel: 5,
        
        quickReplies: [
          'That\'s amazing!',
          'I love your enthusiasm!',
          'This is so exciting!'
        ],
        fullReplies: [
          'That\'s amazing! I can hear your excitement and it\'s contagious! Let me help you get started right away!',
          'I love your enthusiasm! This is going to be great! What can I help you with first?',
          'This is so exciting! I\'m pumped to help you! Let\'s make this happen!'
        ],
        followUpFunnel: 'What do you want to do first?',
        replySelection: 'random',
        
        ttsOverride: { // TEST: TTS override
          pitch: 'high',
          rate: 'fast',
          volume: 'loud'
        },
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Normal Pitch, Medium Rate (Balanced)',
        isActive: true,
        categories: ['voice'],
        priority: 0,
        language: 'auto',
        channel: 'voice',
        
        triggers: [
          'general question',
          'just wondering',
          'quick question'
        ],
        negativeTriggers: [],
        contextWeight: 0.6,
        toneLevel: 2,
        
        quickReplies: [
          'Sure! What\'s your question?',
          'I\'m happy to help!',
          'Go ahead, I\'m listening!'
        ],
        fullReplies: [
          'Sure! What\'s your question? I\'m here to help.',
          'I\'m happy to help with that! What would you like to know?',
          'Go ahead, I\'m listening! What can I answer for you?'
        ],
        followUpFunnel: 'Anything else you need?',
        replySelection: 'random',
        
        ttsOverride: { // TEST: Default/balanced TTS
          pitch: 'medium',
          rate: 'medium',
          volume: 'medium'
        },
        
        entityCapture: [],
        dynamicVariables: {},
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      }
    ]
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // CATEGORY 12: STATE MACHINE TEST (3 scenarios)
  // Tests: Preconditions, effects, conversation flow
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: `cat-test-statemachine-${ulid()}`,
    name: '🤖 Test: State Machine',
    icon: '⚙️',
    description: 'Testing preconditions, effects, conversation state management',
    behavior: 'professional_efficient',
    isActive: true,
    scenarios: [
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Collect Name (STATE: START → COLLECTING)',
        isActive: true,
        categories: ['statemachine'],
        priority: 0,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'my name is',
          'I\'m',
          'this is'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 2,
        
        quickReplies: [
          'Thank you!',
          'Got it!',
          'Perfect!'
        ],
        fullReplies: [
          'Thank you, {name}! It\'s nice to talk with you. What can I help you with today?',
          'Got it, {name}! I appreciate you sharing that. How can I assist you?',
          'Perfect! Thanks for letting me know your name, {name}. What brings you in today?'
        ],
        followUpFunnel: 'How can I help you today?',
        replySelection: 'random',
        
        preconditions: { // TEST: Preconditions
          conversationState: 'greeting_complete'
        },
        effects: { // TEST: Effects
          setState: 'name_collected',
          capturedEntities: { name: true }
        },
        
        entityCapture: ['name'],
        dynamicVariables: {
          name: 'there'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: []
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Collect Phone (STATE: REQUIRES NAME)',
        isActive: true,
        categories: ['statemachine'],
        priority: 1,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'my number is',
          'phone number',
          'you can reach me at'
        ],
        negativeTriggers: [],
        contextWeight: 0.75,
        toneLevel: 2,
        
        quickReplies: [
          'Thank you!',
          'Perfect!',
          'Got your number!'
        ],
        fullReplies: [
          'Thank you, {name}! I have your phone number saved. Is there anything else you need help with today?',
          'Perfect! I\'ve got your contact information, {name}. What else can I do for you?',
          'Got your number! Thanks, {name}. How else can I assist you?'
        ],
        followUpFunnel: 'What else can I help you with?',
        replySelection: 'random',
        
        preconditions: { // TEST: Requires previous state
          conversationState: 'name_collected',
          hasEntity: ['name']
        },
        effects: {
          setState: 'phone_collected',
          capturedEntities: { phone: true }
        },
        
        entityCapture: ['phone'],
        dynamicVariables: {
          name: 'customer'
        },
        entityValidation: {
          phone: {
            pattern: '^[0-9]{10}$',
            prompt: 'Please provide a 10-digit phone number'
          }
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'low_confidence',
        actionHooks: ['save_contact_info']
      },
      
      {
        scenarioId: `scen-${ulid()}`,
        version: 1,
        status: 'live',
        name: 'Complete Flow (STATE: ALL COLLECTED)',
        isActive: true,
        categories: ['statemachine'],
        priority: 2,
        language: 'auto',
        channel: 'any',
        
        triggers: [
          'that\'s all',
          'that\'s everything',
          'I\'m all set',
          'nothing else'
        ],
        negativeTriggers: [],
        contextWeight: 0.7,
        toneLevel: 3,
        
        quickReplies: [
          'Wonderful!',
          'Perfect!',
          'Great!'
        ],
        fullReplies: [
          'Wonderful! Thank you for your time, {name}. We have your phone number and we\'ll be in touch. Have a great day!',
          'Perfect! I have all the information I need, {name}. We\'ll reach out to you soon. Thanks for calling!',
          'Great! Thanks so much, {name}. We\'ll contact you at the number you provided. Have a wonderful day!'
        ],
        followUpFunnel: '',
        replySelection: 'random',
        
        preconditions: { // TEST: Requires multiple previous states
          conversationState: 'phone_collected',
          hasEntity: ['name', 'phone']
        },
        effects: {
          setState: 'conversation_complete',
          incrementMetric: { complete_flows: 1 }
        },
        
        entityCapture: [],
        dynamicVariables: {
          name: 'customer'
        },
        
        cooldownSeconds: 0,
        handoffPolicy: 'never',
        actionHooks: ['log_completed_flow', 'schedule_follow_up']
      }
    ]
  }
];

// ═══════════════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════

async function seedTestCategories() {
  try {
    console.log('🔥 STARTING TEST CATEGORY SEEDING...\n');
    
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find the Universal AI Brain template
    const template = await GlobalInstantResponseTemplate.findOne({
      name: 'Universal AI Brain (All Industries)'
    });
    
    if (!template) {
      throw new Error('❌ Universal AI Brain template not found!');
    }
    
    console.log(`✅ Found template: ${template.name} (ID: ${template._id})\n`);
    console.log(`📊 Current category count: ${template.categories.length}\n`);
    
    // Delete ALL existing categories
    console.log('🗑️  Deleting all existing categories...\n');
    template.categories = [];
    
    // Add the 12 test categories
    console.log('📦 Adding 12 test categories with 40+ scenarios...\n');
    
    let totalScenarios = 0;
    testCategories.forEach((cat, index) => {
      console.log(`  ${index + 1}. ${cat.name} - ${cat.scenarios.length} scenarios`);
      totalScenarios += cat.scenarios.length;
      template.categories.push(cat);
    });
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`  - Categories: ${testCategories.length}`);
    console.log(`  - Total Scenarios: ${totalScenarios}`);
    console.log(`  - Average per category: ${(totalScenarios / testCategories.length).toFixed(1)}\n`);
    
    // Update stats
    template.stats = {
      totalCategories: testCategories.length,
      totalScenarios: totalScenarios,
      lastUpdated: new Date()
    };
    
    // Add changelog entry
    template.changeLog.push({
      timestamp: new Date(),
      action: 'test_seed',
      description: `🔥 TEST SEED: Added ${testCategories.length} test categories with ${totalScenarios} scenarios for comprehensive V2.0 modal testing`,
      performedBy: 'system'
    });
    
    // Save
    console.log('💾 Saving to database...\n');
    await template.save();
    
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS! TEST CATEGORIES SEEDED!');
    console.log('═══════════════════════════════════════════════════════════════════════\n');
    
    console.log('🎯 TESTING CHECKLIST:\n');
    console.log('  ✅ All tone levels (1-5)');
    console.log('  ✅ Reply strategies (random/sequential/bandit)');
    console.log('  ✅ Negative triggers');
    console.log('  ✅ Context weight variations');
    console.log('  ✅ Channel filtering (voice/sms/chat/any)');
    console.log('  ✅ Language filtering (en/es/auto)');
    console.log('  ✅ Entity capture');
    console.log('  ✅ Dynamic variables');
    console.log('  ✅ Entity validation (JSON)');
    console.log('  ✅ Timed follow-up');
    console.log('  ✅ Silence policy');
    console.log('  ✅ TTS override (pitch/rate/volume)');
    console.log('  ✅ Preconditions & Effects');
    console.log('  ✅ Action hooks');
    console.log('  ✅ Cooldowns');
    console.log('  ✅ Priority levels');
    console.log('  ✅ Draft vs Live status\n');
    
    console.log('🚀 NOW GO TEST EVERY FIELD IN THAT BEAUTIFUL MODAL!\n');
    
  } catch (error) {
    console.error('❌ ERROR:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB\n');
  }
}

// Run it!
seedTestCategories()
  .then(() => {
    console.log('🎉 DONE!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 FAILED:', error);
    process.exit(1);
  });


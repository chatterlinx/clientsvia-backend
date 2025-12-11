/**
 * ============================================================================
 * FRONT DESK PROMPT - LLM-0 Behavior Engine (UI-DRIVEN)
 * ============================================================================
 * 
 * ALL settings come from the company's UI configuration.
 * This file only provides DEFAULTS that admins can override.
 * 
 * Nothing is hidden - every response, every rule, every threshold
 * is visible and editable in the Control Plane.
 * 
 * ============================================================================
 */

/**
 * DEFAULT configuration - admins can override ALL of this in the UI
 * Stored in: company.aiAgentSettings.frontDeskBehavior
 */
const DEFAULT_FRONT_DESK_CONFIG = {
    // ════════════════════════════════════════════════════════════════════════
    // PERSONALITY SETTINGS
    // ════════════════════════════════════════════════════════════════════════
    personality: {
        tone: 'warm',  // warm | professional | casual | formal
        verbosity: 'concise',  // concise | balanced | detailed
        maxResponseWords: 30,
        useCallerName: true,
        companyIntro: 'Thank you for calling {companyName}, this is your AI assistant.'
    },

    // ════════════════════════════════════════════════════════════════════════
    // FUNNEL STAGES (The journey from hello to booked)
    // ════════════════════════════════════════════════════════════════════════
    funnelStages: {
        LISTEN_AND_ACK: {
            label: 'Listen & Acknowledge',
            description: 'Let caller speak, acknowledge their situation',
            enabled: true,
            maxTurns: 2,  // Move on after 2 turns of listening
            prompt: 'Listen to what they need and acknowledge their situation before moving forward.'
        },
        LOCK_GOAL: {
            label: 'Identify Goal',
            description: 'Determine if they want appointment or just info',
            enabled: true,
            bookingTriggers: ['service', 'appointment', 'schedule', 'book', 'technician', 'come out', 'someone', 'fix', 'repair'],
            infoTriggers: ['question', 'wondering', 'how much', 'do you', 'can you tell me']
        },
        BOOKING_NAME: {
            label: 'Collect Name',
            prompt: 'May I have your name?',
            alternatePrompts: [
                'And who am I speaking with?',
                'Can I get your name please?'
            ]
        },
        BOOKING_PHONE: {
            label: 'Collect Phone',
            prompt: 'What\'s the best phone number to reach you?',
            alternatePrompts: [
                'And your phone number?',
                'What number should the technician call?'
            ]
        },
        BOOKING_ADDRESS: {
            label: 'Collect Address',
            prompt: 'What\'s the service address?',
            alternatePrompts: [
                'And the address for the service call?',
                'Where would you like us to come out to?'
            ]
        },
        BOOKING_TIME: {
            label: 'Collect Time',
            prompt: 'When works best for you - morning or afternoon?',
            alternatePrompts: [
                'What day and time works best?',
                'When would you like us to come out?'
            ],
            offerAsap: true,
            asapPhrase: 'Or I can send someone as soon as possible.'
        },
        CONFIRM_APPT: {
            label: 'Confirm Appointment',
            template: 'So I have {name} at {address}, {time}. Does that sound right?',
            confirmationPhrases: ['yes', 'correct', 'right', 'that\'s right', 'sounds good', 'perfect']
        },
        COMPLETE: {
            label: 'Booking Complete',
            template: 'You\'re all set, {name}! A technician will {timeConfirmation}. You\'ll receive a confirmation text shortly. Is there anything else I can help with?',
            asapConfirmation: 'be out as soon as possible',
            scheduledConfirmation: 'be there {time}'
        }
    },

    // ════════════════════════════════════════════════════════════════════════
    // EMOTION RESPONSES (What to say when caller is emotional)
    // ════════════════════════════════════════════════════════════════════════
    emotionResponses: {
        stressed: {
            label: 'Stressed',
            description: 'Caller sounds worried or anxious',
            acknowledgments: [
                'I understand, that sounds stressful.',
                'I can hear this is frustrating.',
                'That must be really uncomfortable.'
            ],
            followUp: 'Let me help you get this taken care of.'
        },
        frustrated: {
            label: 'Frustrated',
            description: 'Caller is annoyed or impatient',
            acknowledgments: [
                'I completely understand.',
                'I hear you, let\'s get this sorted.',
                'I get it - let\'s just get this done.'
            ],
            followUp: 'I\'ll get someone scheduled right away.',
            reduceFriction: true  // Skip optional questions
        },
        angry: {
            label: 'Angry',
            description: 'Caller is upset or hostile',
            acknowledgments: [
                'I\'m really sorry you\'re dealing with this.',
                'I understand you\'re upset.',
                'I apologize for the frustration.'
            ],
            followUp: 'Let me make this right.',
            offerEscalation: true,
            maxTriesBeforeEscalate: 2
        },
        friendly: {
            label: 'Friendly',
            description: 'Caller is pleasant and chatty',
            acknowledgments: [],  // No special acknowledgment needed
            allowSmallTalk: true,
            smallTalkLimit: 1  // One exchange of pleasantries, then focus
        },
        joking: {
            label: 'Joking',
            description: 'Caller is humorous or playful',
            acknowledgments: [
                'Ha! I like that.',
                'That\'s a good one!'
            ],
            respondInKind: true  // Match their energy briefly
        },
        neutral: {
            label: 'Neutral',
            description: 'Caller is matter-of-fact',
            acknowledgments: [],
            straightToBusiness: true
        }
    },

    // ════════════════════════════════════════════════════════════════════════
    // FRUSTRATION TRIGGERS (Phrases that indicate caller is losing patience)
    // ════════════════════════════════════════════════════════════════════════
    frustrationTriggers: [
        'i don\'t care',
        'don\'t care',
        'just send someone',
        'just send',
        'this is ridiculous',
        'you\'re not listening',
        'i already told you',
        'we\'ve been through this',
        'stop asking',
        'forget it',
        'whatever',
        'i want to speak to someone',
        'get me a manager'
    ],

    // ════════════════════════════════════════════════════════════════════════
    // ESCALATION SETTINGS
    // ════════════════════════════════════════════════════════════════════════
    escalation: {
        enabled: true,
        maxLoopsBeforeOffer: 3,
        triggerPhrases: ['manager', 'supervisor', 'real person', 'human', 'someone else'],
        offerMessage: 'I don\'t want to keep you going in circles. I can connect you to someone directly or take a message for a manager. Which would you prefer?',
        transferMessage: 'Let me connect you to our team now.',
        messageMessage: 'I\'ll make sure a manager gets back to you right away. What\'s the best number to reach you?'
    },

    // ════════════════════════════════════════════════════════════════════════
    // LOOP PREVENTION
    // ════════════════════════════════════════════════════════════════════════
    loopPrevention: {
        enabled: true,
        maxSameQuestion: 2,  // Don't ask the same question more than 2 times
        onLoop: 'rephrase',  // rephrase | skip | escalate
        rephraseIntro: 'Let me try this differently - '
    },

    // ════════════════════════════════════════════════════════════════════════
    // FORBIDDEN PHRASES (Never say these)
    // ════════════════════════════════════════════════════════════════════════
    forbiddenPhrases: [
        'tell me more about what you need',
        'what specific issues',
        'can you please',
        'I\'m sorry, I didn\'t understand'
    ],

    // ════════════════════════════════════════════════════════════════════════
    // DETECTION TRIGGERS - What AI detects in caller speech
    // ════════════════════════════════════════════════════════════════════════
    detectionTriggers: {
        trustConcern: ['can you do', 'can you handle', 'can you fix', 'are you able', 'know what you\'re doing', 'qualified', 'sure you can', 'is this going to work', 'you guys any good'],
        callerFeelsIgnored: ['you\'re not listening', 'didn\'t listen', 'you didn\'t hear', 'you\'re ignoring', 'you don\'t get it', 'that\'s not what I said', 'you missed'],
        refusedSlot: ['i don\'t want to', 'not going to give', 'don\'t want to share', 'not comfortable', 'rather not'],
        describingProblem: ['water leak', 'thermostat', 'not cooling', 'not cool', 'won\'t turn', 'won\'t start', 'making noise', 'making sound', 'smell', 'broken', 'not working', 'problem is', 'issue is'],
        wantsBooking: ['fix', 'repair', 'service', 'appointment', 'schedule', 'technician', 'someone', 'come out', 'send']
    },

    // ════════════════════════════════════════════════════════════════════════
    // FALLBACK RESPONSES - What AI says when LLM fails
    // These ensure the call NEVER goes silent
    // ════════════════════════════════════════════════════════════════════════
    fallbackResponses: {
        // Initial & Discovery
        greeting: 'Thanks for calling! How can I help you today?',
        discovery: 'Got it, what\'s going on — is it not cooling, not heating, making noise, or something else?',
        // Booking Slots
        askName: 'May I have your name please?',
        askPhone: 'And what\'s the best phone number to reach you?',
        askAddress: 'What\'s the service address?',
        askTime: 'When works best for you — morning or afternoon? Or I can send someone as soon as possible.',
        // Confirmation
        confirmBooking: 'Let me confirm — I have you scheduled. Does that sound right?',
        bookingComplete: 'You\'re all set! A technician will be out and you\'ll receive a confirmation text shortly. Is there anything else?',
        // Error Recovery
        didNotHear: 'I\'m sorry, I didn\'t quite catch that. Could you please repeat?',
        connectionIssue: 'I\'m sorry, I think our connection isn\'t great. Could you please repeat that?',
        clarification: 'I want to make sure I understand correctly. Could you tell me a bit more?',
        // Transfer & Catch-All
        transfering: 'Let me connect you with someone who can help you right away. Please hold.',
        generic: 'I\'m here to help. What can I do for you?'
    },

    // ════════════════════════════════════════════════════════════════════════
    // MODE SWITCHING - When to switch between modes
    // ════════════════════════════════════════════════════════════════════════
    modeSwitching: {
        minTurnsBeforeBooking: 2,
        bookingConfidenceThreshold: 0.75,
        autoRescueOnFrustration: true,
        autoTriageOnProblem: true
    },

    // ════════════════════════════════════════════════════════════════════════
    // REQUIRED PHRASES (Always include when appropriate)
    // ════════════════════════════════════════════════════════════════════════
    requiredPhrases: {
        afterBooking: 'You\'ll receive a confirmation text shortly.',
        beforeTransfer: 'Please hold while I connect you.',
        techArrival: 'The technician will call or text before arriving.'
    }
};

/**
 * Build the system prompt using UI configuration
 * @param {Object} uiConfig - The frontDeskBehavior config from company settings
 * @param {Object} callContext - Current call state
 * @returns {string}
 */
function buildPromptFromUIConfig(uiConfig, callContext = {}) {
    const config = { ...DEFAULT_FRONT_DESK_CONFIG, ...uiConfig };
    const {
        companyName = 'our company',
        industry = 'HVAC',
        currentGoal = 'LISTEN_AND_ACK',
        bookingCollected = {},
        emotionHistory = []
    } = callContext;

    // Build collected data summary
    const collected = [];
    if (bookingCollected.name) collected.push(`Name: ${bookingCollected.name}`);
    if (bookingCollected.phone) collected.push(`Phone: ${bookingCollected.phone}`);
    if (bookingCollected.address) collected.push(`Address: ${bookingCollected.address}`);
    if (bookingCollected.time) collected.push(`Time: ${bookingCollected.time}`);
    
    // Build emotion acknowledgments section
    const emotionSection = Object.entries(config.emotionResponses)
        .map(([emotion, settings]) => {
            const acks = settings.acknowledgments?.join(' | ') || 'No special response';
            return `- ${emotion.toUpperCase()}: ${acks}`;
        }).join('\n');

    // Build funnel prompts section
    const funnelSection = Object.entries(config.funnelStages)
        .filter(([_, stage]) => stage.prompt || stage.template)
        .map(([key, stage]) => {
            return `- ${key}: "${stage.prompt || stage.template}"`;
        }).join('\n');

    return `You are the front desk for ${companyName} (${industry}).
Tone: ${config.personality.tone}
Max response length: ${config.personality.maxResponseWords} words
${config.personality.useCallerName ? 'Use caller\'s name once you know it.' : ''}

═══ CURRENT STATE ═══
Goal: ${currentGoal}
Collected: ${collected.length > 0 ? collected.join(', ') : 'Nothing yet'}
Recent emotions: ${emotionHistory.slice(-3).join(', ') || 'neutral'}

═══ EMOTION RESPONSES ═══
${emotionSection}

═══ BOOKING PROMPTS ═══
${funnelSection}

═══ RULES ═══
- If caller is frustrated: ${config.emotionResponses.frustrated?.followUp || 'Get straight to booking'}
- If stuck in loop: ${config.loopPrevention.onLoop === 'rephrase' ? 'Rephrase the question' : 'Offer escalation'}
- Max same question: ${config.loopPrevention.maxSameQuestion}
- Escalation offer: "${config.escalation.offerMessage}"

═══ NEVER SAY ═══
${config.forbiddenPhrases.map(p => `- "${p}"`).join('\n')}

═══ OUTPUT FORMAT ═══
{
  "reply": "<your response>",
  "nextGoal": "<${Object.keys(config.funnelStages).join(' | ')}>",
  "emotionGuess": "<neutral | friendly | joking | stressed | frustrated | angry>",
  "wantsAppointment": <true | false>,
  "extractedData": { "name": null, "phone": null, "address": null, "time": null }
}`;
}

/**
 * Get the default config for UI initialization
 */
function getDefaultConfig() {
    return DEFAULT_FRONT_DESK_CONFIG;
}

module.exports = {
    DEFAULT_FRONT_DESK_CONFIG,
    buildPromptFromUIConfig,
    getDefaultConfig
};

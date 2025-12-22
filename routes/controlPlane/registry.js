/**
 * ============================================================================
 * CONTROL PLANE REGISTRY - Self-Describing Schema + UI Registry
 * ============================================================================
 * 
 * PURPOSE: Make Control Plane fully inspectable and measurable
 * 
 * Returns:
 * - Every panel in Control Plane
 * - Every field with: key, label, uiType, validation, performanceNotes
 * - Placeholder allowlist
 * - Read/write endpoints
 * - Default values
 * 
 * USE CASES:
 * - "Line by line" control without sending code
 * - UI text optimization
 * - Performance constraint enforcement
 * - ChatGPT/Prime analysis workflow
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');

// Version for cache-busting and compatibility
const REGISTRY_VERSION = 'cp.v2.0';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTROL PLANE SCHEMA REGISTRY
 * Every field, every panel, fully documented
 * ═══════════════════════════════════════════════════════════════════════════
 */
const CONTROL_PLANE_REGISTRY = {
    version: REGISTRY_VERSION,
    lastUpdated: '2025-12-22',
    standardPlaceholderFormat: '{{placeholderName}}',
    
    // ═══════════════════════════════════════════════════════════════════════
    // PANELS - Each top-level tab/section in Control Plane
    // ═══════════════════════════════════════════════════════════════════════
    panels: [
        // ═══════════════════════════════════════════════════════════════════
        // PERSONALITY PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'personality',
            title: 'Personality',
            icon: '🎭',
            description: 'AI agent personality and tone settings',
            tab: 'Front Desk',
            subTab: 'Personality',
            fields: [
                {
                    key: 'frontDeskBehavior.personality.enabled',
                    label: 'Enable Custom Personality',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'When disabled, uses system defaults',
                    affectsLLM: true
                },
                {
                    key: 'frontDeskBehavior.personality.professionalismLevel',
                    label: 'Professionalism Level',
                    uiType: 'slider',
                    min: 1,
                    max: 10,
                    defaultValue: 7,
                    performanceNotes: 'Higher = more formal, lower = more casual',
                    affectsLLM: true
                },
                {
                    key: 'frontDeskBehavior.personality.empathyLevel',
                    label: 'Empathy Level',
                    uiType: 'slider',
                    min: 1,
                    max: 10,
                    defaultValue: 8,
                    performanceNotes: 'Higher = more acknowledgment phrases',
                    affectsLLM: true
                },
                {
                    key: 'frontDeskBehavior.personality.urgencyDetection',
                    label: 'Urgency Detection',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'Auto-detects emergency keywords and escalates tone',
                    affectsLLM: true
                },
                {
                    key: 'frontDeskBehavior.conversationStyle',
                    label: 'Conversation Style',
                    uiType: 'select',
                    options: ['confident', 'balanced', 'polite'],
                    defaultValue: 'balanced',
                    optionDescriptions: {
                        confident: 'Assumptive: "Let\'s get you scheduled"',
                        balanced: 'Friendly: "I can help with that"',
                        polite: 'Deferential: "Would you like me to...?"'
                    },
                    performanceNotes: 'Affects booking conversion rate',
                    affectsLLM: true
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // GREETING PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'greeting',
            title: 'Greeting',
            icon: '👋',
            description: 'Opening message when call connects',
            tab: 'Front Desk',
            subTab: 'Discovery & Consent',
            fields: [
                {
                    key: 'connectionMessages.voice.text',
                    label: 'Voice Greeting',
                    uiType: 'textarea',
                    maxLen: 280,
                    recommendedMaxWords: 25,
                    performanceNotes: 'Keep under 2.5s TTS. No filler phrases.',
                    placeholdersAllowed: ['{{companyName}}', '{{serviceArea}}', '{{businessHours}}'],
                    defaultValue: '',
                    examples: [
                        'Thanks for calling {{companyName}}. How can I help you today?',
                        'Hi, this is {{companyName}}. What can I do for you?'
                    ],
                    lintRules: ['MAX_WORDS_25', 'NO_FILLER', 'HAS_COMPANY_NAME']
                },
                {
                    key: 'connectionMessages.voice.realtime.text',
                    label: 'Realtime Voice Greeting',
                    uiType: 'textarea',
                    maxLen: 280,
                    recommendedMaxWords: 25,
                    performanceNotes: 'For OpenAI Realtime API sessions',
                    placeholdersAllowed: ['{{companyName}}', '{{serviceArea}}'],
                    defaultValue: ''
                },
                {
                    key: 'frontDeskBehavior.greeting',
                    label: 'Front Desk Greeting (Legacy)',
                    uiType: 'textarea',
                    deprecated: true,
                    migrateTo: 'connectionMessages.voice.text',
                    maxLen: 280
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // VOCABULARY PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'vocabulary',
            title: 'Vocabulary',
            icon: '📚',
            description: 'Forbidden phrases and word guardrails',
            tab: 'Front Desk',
            subTab: 'Vocabulary',
            fields: [
                {
                    key: 'frontDeskBehavior.vocabulary.forbiddenPhrases',
                    label: 'Forbidden Phrases',
                    uiType: 'tagList',
                    defaultValue: [],
                    performanceNotes: 'LLM will never say these. Add competitors, inappropriate words.',
                    examples: ['um', 'uh', 'competitor name', 'I don\'t know'],
                    affectsLLM: true
                },
                {
                    key: 'frontDeskBehavior.vocabulary.preferredTerms',
                    label: 'Preferred Terms',
                    uiType: 'keyValueList',
                    defaultValue: {},
                    performanceNotes: 'Replace generic terms with company-specific. E.g., "technician" → "comfort specialist"',
                    affectsLLM: true
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // BOOKING PROMPTS PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'bookingPrompts',
            title: 'Booking Prompts',
            icon: '📅',
            description: 'Questions asked during booking flow',
            tab: 'Front Desk',
            subTab: 'Booking Prompts',
            fields: [
                {
                    key: 'frontDeskBehavior.bookingSlots',
                    label: 'Booking Slots',
                    uiType: 'slotEditor',
                    defaultValue: [],
                    performanceNotes: 'Each slot = one question. Keep questions under 15 words.',
                    subFields: [
                        {
                            key: 'key',
                            label: 'Slot Key',
                            uiType: 'text',
                            required: true
                        },
                        {
                            key: 'label',
                            label: 'Display Label',
                            uiType: 'text',
                            required: true
                        },
                        {
                            key: 'question',
                            label: 'Question Text',
                            uiType: 'textarea',
                            maxLen: 150,
                            recommendedMaxWords: 15,
                            required: true,
                            performanceNotes: 'SACRED - LLM cannot modify this text'
                        },
                        {
                            key: 'required',
                            label: 'Required',
                            uiType: 'toggle',
                            defaultValue: true
                        },
                        {
                            key: 'validation',
                            label: 'Validation Type',
                            uiType: 'select',
                            options: ['none', 'phone', 'email', 'name', 'address', 'zip']
                        }
                    ]
                },
                {
                    key: 'frontDeskBehavior.bookingEnabled',
                    label: 'Enable Booking',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'When disabled, AI will not attempt to schedule'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // EMOTIONS PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'emotions',
            title: 'Emotions',
            icon: '😊',
            description: 'Emotional response handling',
            tab: 'Front Desk',
            subTab: 'Emotions',
            fields: [
                {
                    key: 'frontDeskBehavior.emotions.detectAnger',
                    label: 'Detect Anger',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'Triggers empathy response when caller is upset'
                },
                {
                    key: 'frontDeskBehavior.emotions.angerResponse',
                    label: 'Anger Response',
                    uiType: 'textarea',
                    maxLen: 200,
                    defaultValue: 'I completely understand your frustration. Let me help make this right.',
                    placeholdersAllowed: ['{{companyName}}']
                },
                {
                    key: 'frontDeskBehavior.emotions.detectConfusion',
                    label: 'Detect Confusion',
                    uiType: 'toggle',
                    defaultValue: true
                },
                {
                    key: 'frontDeskBehavior.emotions.confusionResponse',
                    label: 'Confusion Response',
                    uiType: 'textarea',
                    maxLen: 200,
                    defaultValue: 'No problem, let me clarify that for you.'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // FRUSTRATION PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'frustration',
            title: 'Frustration',
            icon: '😤',
            description: 'Escalation when caller becomes frustrated',
            tab: 'Front Desk',
            subTab: 'Frustration',
            fields: [
                {
                    key: 'frontDeskBehavior.frustration.enabled',
                    label: 'Enable Frustration Detection',
                    uiType: 'toggle',
                    defaultValue: true
                },
                {
                    key: 'frontDeskBehavior.frustration.threshold',
                    label: 'Escalation Threshold',
                    uiType: 'slider',
                    min: 1,
                    max: 5,
                    defaultValue: 3,
                    performanceNotes: 'Number of negative signals before escalation'
                },
                {
                    key: 'frontDeskBehavior.frustration.escalationAction',
                    label: 'Escalation Action',
                    uiType: 'select',
                    options: ['transfer_human', 'offer_callback', 'apologize_continue', 'supervisor'],
                    defaultValue: 'offer_callback'
                },
                {
                    key: 'frontDeskBehavior.frustration.transferTarget',
                    label: 'Transfer Target',
                    uiType: 'text',
                    defaultValue: '',
                    performanceNotes: 'Phone number or extension for escalation'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // ESCALATION PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'escalation',
            title: 'Escalation',
            icon: '🚨',
            description: 'When to transfer to human',
            tab: 'Front Desk',
            subTab: 'Escalation',
            fields: [
                {
                    key: 'frontDeskBehavior.escalation.rules',
                    label: 'Escalation Rules',
                    uiType: 'ruleEditor',
                    defaultValue: [],
                    subFields: [
                        {
                            key: 'trigger',
                            label: 'Trigger Phrase/Keyword',
                            uiType: 'text'
                        },
                        {
                            key: 'action',
                            label: 'Action',
                            uiType: 'select',
                            options: ['transfer', 'callback', 'message', 'flag']
                        },
                        {
                            key: 'target',
                            label: 'Transfer Target',
                            uiType: 'text'
                        }
                    ]
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // LOOPS PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'loops',
            title: 'Loops',
            icon: '🔄',
            description: 'Prevent repetitive responses',
            tab: 'Front Desk',
            subTab: 'Loops',
            fields: [
                {
                    key: 'frontDeskBehavior.loops.maxRepetitions',
                    label: 'Max Repetitions',
                    uiType: 'number',
                    min: 1,
                    max: 5,
                    defaultValue: 2,
                    performanceNotes: 'How many times to repeat before varying response'
                },
                {
                    key: 'frontDeskBehavior.loops.variationStrategy',
                    label: 'Variation Strategy',
                    uiType: 'select',
                    options: ['rephrase', 'escalate', 'ask_clarification'],
                    defaultValue: 'rephrase'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // FORBIDDEN PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'forbidden',
            title: 'Forbidden',
            icon: '🚫',
            description: 'Topics and behaviors to avoid',
            tab: 'Front Desk',
            subTab: 'Forbidden',
            fields: [
                {
                    key: 'frontDeskBehavior.policies.blockPricing',
                    label: 'Block Pricing Discussion',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'Prevents AI from giving price quotes'
                },
                {
                    key: 'frontDeskBehavior.policies.blockCompetitorMention',
                    label: 'Block Competitor Mentions',
                    uiType: 'toggle',
                    defaultValue: true
                },
                {
                    key: 'frontDeskBehavior.policies.forbiddenTopics',
                    label: 'Forbidden Topics',
                    uiType: 'tagList',
                    defaultValue: ['politics', 'religion', 'personal opinions'],
                    performanceNotes: 'AI will deflect these topics'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // DETECTION PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'detection',
            title: 'Detection',
            icon: '🔍',
            description: 'Intent and entity detection settings',
            tab: 'Front Desk',
            subTab: 'Detection',
            fields: [
                {
                    key: 'frontDeskBehavior.detection.minConfidence',
                    label: 'Minimum Confidence',
                    uiType: 'slider',
                    min: 0.3,
                    max: 0.9,
                    step: 0.05,
                    defaultValue: 0.5,
                    performanceNotes: 'Lower = more matches, higher = more precise'
                },
                {
                    key: 'frontDeskBehavior.detection.fallbackBehavior',
                    label: 'Fallback Behavior',
                    uiType: 'select',
                    options: ['ask_clarification', 'best_guess', 'transfer', 'generic_response'],
                    defaultValue: 'ask_clarification'
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // FALLBACKS PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'fallbacks',
            title: 'Fallbacks',
            icon: '🆘',
            description: 'Default responses when no scenario matches',
            tab: 'Front Desk',
            subTab: 'Fallbacks',
            fields: [
                {
                    key: 'companyResponseDefaults.notOfferedReply.fullReply',
                    label: 'Not Offered Reply',
                    uiType: 'textarea',
                    maxLen: 300,
                    defaultValue: 'I apologize, but we don\'t offer that service. Is there something else I can help you with?',
                    placeholdersAllowed: ['{{companyName}}', '{{serviceArea}}'],
                    performanceNotes: 'Used when service is explicitly disabled'
                },
                {
                    key: 'companyResponseDefaults.unknownIntentReply.fullReply',
                    label: 'Unknown Intent Reply',
                    uiType: 'textarea',
                    maxLen: 300,
                    defaultValue: 'I want to make sure I understand correctly. Could you tell me more about what you need?',
                    performanceNotes: 'Used when no scenario matches'
                },
                {
                    key: 'companyResponseDefaults.afterHoursReply.fullReply',
                    label: 'After Hours Reply',
                    uiType: 'textarea',
                    maxLen: 300,
                    defaultValue: 'Thanks for calling {{companyName}}. We\'re currently closed, but I\'d be happy to schedule a callback.',
                    placeholdersAllowed: ['{{companyName}}', '{{businessHours}}']
                }
            ]
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // MODES PANEL
        // ═══════════════════════════════════════════════════════════════════
        {
            panelId: 'modes',
            title: 'Modes',
            icon: '🔀',
            description: 'Conversation mode settings',
            tab: 'Front Desk',
            subTab: 'Modes',
            fields: [
                {
                    key: 'frontDeskBehavior.modes.startMode',
                    label: 'Start Mode',
                    uiType: 'select',
                    options: ['DISCOVERY', 'BOOKING', 'TRIAGE', 'TRANSFER'],
                    defaultValue: 'DISCOVERY',
                    performanceNotes: 'Initial conversation mode'
                },
                {
                    key: 'frontDeskBehavior.modes.autoTransitionToBooking',
                    label: 'Auto Transition to Booking',
                    uiType: 'toggle',
                    defaultValue: true,
                    performanceNotes: 'Automatically switch to booking when intent detected'
                }
            ]
        }
    ],
    
    // ═══════════════════════════════════════════════════════════════════════
    // GLOBAL LINT RULES
    // ═══════════════════════════════════════════════════════════════════════
    lintRules: {
        MAX_WORDS_25: {
            id: 'MAX_WORDS_25',
            description: 'Text should be under 25 words',
            severity: 'warning',
            maxWords: 25
        },
        MAX_WORDS_35: {
            id: 'MAX_WORDS_35',
            description: 'Text must be under 35 words for voice',
            severity: 'error',
            maxWords: 35
        },
        NO_FILLER: {
            id: 'NO_FILLER',
            description: 'No filler phrases like "Got it", "Um", "So"',
            severity: 'warning',
            patterns: ['got it', 'um', 'uh', 'so,', 'well,', 'basically']
        },
        HAS_COMPANY_NAME: {
            id: 'HAS_COMPANY_NAME',
            description: 'Should include {{companyName}} placeholder',
            severity: 'info',
            requiredPlaceholder: '{{companyName}}'
        },
        NO_ROBOTIC: {
            id: 'NO_ROBOTIC',
            description: 'Avoid robotic phrasing',
            severity: 'warning',
            patterns: ['I am an AI', 'I am a virtual', 'As an AI assistant']
        }
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // API ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════
    endpoints: {
        read: '/api/company/:companyId/control-plane',
        write: '/api/company/:companyId/control-plane',
        effective: '/api/company/:companyId/control-plane/effective',
        lint: '/api/company/:companyId/control-plane/lint',
        registry: '/api/control-plane/registry'
    }
};

/**
 * GET /api/control-plane/registry
 * Returns the full Control Plane schema registry
 */
router.get('/registry', (req, res) => {
    res.json({
        success: true,
        data: CONTROL_PLANE_REGISTRY
    });
});

/**
 * GET /api/control-plane/registry/panel/:panelId
 * Returns a specific panel's schema
 */
router.get('/registry/panel/:panelId', (req, res) => {
    const { panelId } = req.params;
    const panel = CONTROL_PLANE_REGISTRY.panels.find(p => p.panelId === panelId);
    
    if (!panel) {
        return res.status(404).json({
            success: false,
            error: `Panel "${panelId}" not found`,
            availablePanels: CONTROL_PLANE_REGISTRY.panels.map(p => p.panelId)
        });
    }
    
    res.json({
        success: true,
        data: panel
    });
});

/**
 * GET /api/control-plane/registry/fields
 * Returns flat list of all fields for easy lookup
 */
router.get('/registry/fields', (req, res) => {
    const allFields = [];
    
    for (const panel of CONTROL_PLANE_REGISTRY.panels) {
        for (const field of panel.fields) {
            allFields.push({
                ...field,
                panelId: panel.panelId,
                panelTitle: panel.title
            });
        }
    }
    
    res.json({
        success: true,
        data: {
            totalFields: allFields.length,
            fields: allFields
        }
    });
});

/**
 * GET /api/control-plane/registry/lint-rules
 * Returns all available lint rules
 */
router.get('/registry/lint-rules', (req, res) => {
    res.json({
        success: true,
        data: CONTROL_PLANE_REGISTRY.lintRules
    });
});

module.exports = router;
module.exports.CONTROL_PLANE_REGISTRY = CONTROL_PLANE_REGISTRY;


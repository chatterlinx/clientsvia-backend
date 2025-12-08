/**
 * ============================================================================
 * FRONT DESK BEHAVIOR - Admin API Routes
 * ============================================================================
 * 
 * Manage all LLM-0 conversation behavior settings through the UI.
 * Everything is visible and editable - no hidden controls.
 * 
 * ENDPOINTS:
 * - GET    /:companyId           - Get current config
 * - PATCH  /:companyId           - Update config
 * - POST   /:companyId/reset     - Reset to defaults
 * - POST   /:companyId/test      - Test a phrase with current settings
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../../config/frontDeskPrompt');

// ============================================================================
// DEFAULT VALUES (Shown in UI, can be customized per company)
// ============================================================================

const UI_DEFAULTS = {
    personality: {
        tone: 'warm',
        verbosity: 'concise',
        maxResponseWords: 30,
        useCallerName: true
    },
    bookingPrompts: {
        askName: "May I have your name?",
        askPhone: "What's the best phone number to reach you?",
        askAddress: "What's the service address?",
        askTime: "When works best for you - morning or afternoon?",
        confirmTemplate: "So I have {name} at {address}, {time}. Does that sound right?",
        completeTemplate: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.",
        offerAsap: true,
        asapPhrase: "Or I can send someone as soon as possible."
    },
    emotionResponses: {
        stressed: {
            enabled: true,
            acknowledgments: [
                "I understand, that sounds stressful.",
                "That must be really uncomfortable.",
                "I can hear this is frustrating."
            ],
            followUp: "Let me help you get this taken care of."
        },
        frustrated: {
            enabled: true,
            acknowledgments: [
                "I completely understand.",
                "I hear you, let's get this sorted.",
                "I get it - let's just get this done."
            ],
            followUp: "I'll get someone scheduled right away.",
            reduceFriction: true
        },
        angry: {
            enabled: true,
            acknowledgments: [
                "I'm really sorry you're dealing with this.",
                "I understand you're upset.",
                "I apologize for the frustration."
            ],
            followUp: "Let me make this right.",
            offerEscalation: true,
            maxTriesBeforeEscalate: 2
        },
        friendly: {
            enabled: true,
            allowSmallTalk: true,
            smallTalkLimit: 1
        }
    },
    frustrationTriggers: [
        "i don't care",
        "just send someone",
        "this is ridiculous",
        "you're not listening",
        "i already told you",
        "stop asking",
        "forget it",
        "whatever"
    ],
    escalation: {
        enabled: true,
        maxLoopsBeforeOffer: 3,
        triggerPhrases: ["manager", "supervisor", "real person", "human"],
        offerMessage: "I can connect you to someone directly or take a message for a manager. Which would you prefer?",
        transferMessage: "Let me connect you to our team now."
    },
    loopPrevention: {
        enabled: true,
        maxSameQuestion: 2,
        onLoop: 'rephrase',
        rephraseIntro: "Let me try this differently - "
    },
    forbiddenPhrases: [
        // Generic robot phrases that kill trust
        "tell me more about what you need",
        "what specific issues are you experiencing",
        "I'm sorry, I didn't understand",
        "let me clarify",
        "I'm here to help. Can you please tell me",
        "I understand. I can help you with that",
        "let me get some details",
        "can you please provide more information",
        "I need more information",
        "what exactly do you need",
        "could you be more specific",
        // Avoid these hedging phrases
        "I think",
        "I'm not sure but",
        "probably",
        "maybe I can",
        // These sound robotic
        "processing your request",
        "one moment please",
        "please hold while I"
    ],
    // Service area responses (admin-editable)
    serviceAreaResponses: {
        confirm: "Yes, we absolutely service {city} and all of Southwest Florida! We've been taking care of customers there for years.",
        ask: "We service most of Southwest Florida. What city or area are you located in?",
        decline: "I'm sorry, we don't currently service that area."
    },
    // Inquiry responses for common questions
    inquiryResponses: {
        ductCleaning: "Absolutely! Duct cleaning is one of our specialties. It helps improve air quality and system efficiency.",
        thermostatUpgrade: "Great choice! A new thermostat can save you money and make your home more comfortable. We install all major brands.",
        generalService: "We'd be happy to help! Let me get you scheduled with one of our technicians.",
        pricingInfo: "I'd be happy to get you a quote. Our pricing depends on the specific work needed - let me get your information and have someone reach out with details."
    }
};

// ============================================================================
// GET - Fetch current config
// ============================================================================
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Merge saved config with defaults
        const saved = company.aiAgentSettings?.frontDeskBehavior || {};
        const config = deepMerge(UI_DEFAULTS, saved);
        
        // Ensure enabled defaults to true
        if (config.enabled === undefined) {
            config.enabled = true;
        }
        
        res.json({
            success: true,
            data: {
                enabled: config.enabled,
                personality: config.personality,
                bookingPrompts: config.bookingPrompts,
                emotionResponses: config.emotionResponses,
                frustrationTriggers: config.frustrationTriggers,
                escalation: config.escalation,
                loopPrevention: config.loopPrevention,
                forbiddenPhrases: config.forbiddenPhrases,
                lastUpdated: saved.lastUpdated || null
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Get error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// PATCH - Update config
// ============================================================================
router.patch('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;
        
        logger.info('[FRONT DESK BEHAVIOR] Updating config', {
            companyId,
            fieldsUpdated: Object.keys(updates)
        });
        
        // Build the update object
        const updateObj = {};
        
        if (updates.enabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.enabled'] = updates.enabled;
        }
        
        if (updates.personality) {
            Object.entries(updates.personality).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.personality.${key}`] = value;
            });
        }
        
        if (updates.bookingPrompts) {
            Object.entries(updates.bookingPrompts).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.bookingPrompts.${key}`] = value;
            });
        }
        
        if (updates.emotionResponses) {
            Object.entries(updates.emotionResponses).forEach(([emotion, settings]) => {
                Object.entries(settings).forEach(([key, value]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.emotionResponses.${emotion}.${key}`] = value;
                });
            });
        }
        
        if (updates.frustrationTriggers) {
            updateObj['aiAgentSettings.frontDeskBehavior.frustrationTriggers'] = updates.frustrationTriggers;
        }
        
        if (updates.escalation) {
            Object.entries(updates.escalation).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.escalation.${key}`] = value;
            });
        }
        
        if (updates.loopPrevention) {
            Object.entries(updates.loopPrevention).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.loopPrevention.${key}`] = value;
            });
        }
        
        if (updates.forbiddenPhrases) {
            updateObj['aiAgentSettings.frontDeskBehavior.forbiddenPhrases'] = updates.forbiddenPhrases;
        }
        
        updateObj['aiAgentSettings.frontDeskBehavior.lastUpdated'] = new Date();
        updateObj['aiAgentSettings.frontDeskBehavior.updatedBy'] = req.user?.email || 'admin';
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { $set: updateObj },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Clear Redis cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:frontDeskBehavior`);
            }
        } catch (cacheErr) {
            logger.debug('[FRONT DESK BEHAVIOR] Cache clear failed (non-critical)');
        }
        
        res.json({
            success: true,
            message: 'Front Desk Behavior updated',
            data: result.aiAgentSettings?.frontDeskBehavior
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Reset to defaults
// ============================================================================
router.post('/:companyId/reset', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    'aiAgentSettings.frontDeskBehavior': {
                        enabled: true,
                        ...UI_DEFAULTS,
                        lastUpdated: new Date(),
                        updatedBy: req.user?.email || 'admin'
                    }
                }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        res.json({
            success: true,
            message: 'Reset to defaults',
            data: result.aiAgentSettings?.frontDeskBehavior
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Reset error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Test a phrase with current emotion detection
// ============================================================================
router.post('/:companyId/test-emotion', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;
        
        if (!phrase) {
            return res.status(400).json({ success: false, message: 'Phrase is required' });
        }
        
        const company = await v2Company.findById(companyId).lean();
        const config = company?.aiAgentSettings?.frontDeskBehavior || UI_DEFAULTS;
        
        const lowerPhrase = phrase.toLowerCase();
        
        // Check frustration triggers
        const frustrationTriggers = config.frustrationTriggers || UI_DEFAULTS.frustrationTriggers;
        const matchedFrustration = frustrationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        // Check escalation triggers
        const escalationTriggers = config.escalation?.triggerPhrases || UI_DEFAULTS.escalation.triggerPhrases;
        const matchedEscalation = escalationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        // Determine emotion
        let detectedEmotion = 'neutral';
        if (matchedFrustration.length > 0) {
            detectedEmotion = 'frustrated';
        }
        if (matchedEscalation.length > 0) {
            detectedEmotion = 'angry';
        }
        
        // Get appropriate response
        const emotionConfig = config.emotionResponses?.[detectedEmotion] || {};
        const acknowledgments = emotionConfig.acknowledgments || [];
        const followUp = emotionConfig.followUp || '';
        
        res.json({
            success: true,
            data: {
                phrase,
                detectedEmotion,
                matchedFrustration,
                matchedEscalation,
                wouldAcknowledge: acknowledgments.length > 0,
                sampleAcknowledgment: acknowledgments[0] || null,
                followUp,
                reduceFriction: emotionConfig.reduceFriction || false,
                offerEscalation: emotionConfig.offerEscalation || false
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Test emotion error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// HELPER: Deep merge objects
// ============================================================================
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    
    return result;
}

module.exports = router;


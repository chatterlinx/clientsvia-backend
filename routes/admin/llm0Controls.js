// ============================================================================
// LLM-0 CONTROLS ADMIN ROUTES
// ============================================================================
// 📋 PURPOSE: Configurable settings for LLM-0 (Brain-1) behavior
// 🎯 FEATURES:
//    - Silence handling (thresholds, prompts, callback offers)
//    - Loop detection (thresholds, escalation actions)
//    - Spam filter (Layer 3 LLM detection of telemarketer phrases)
//    - Customer patience mode (never hang up on real customers)
//    - Bailout rules (escalation thresholds, transfer targets)
//    - Confidence thresholds (high/medium/low/fallback)
// 🔒 AUTH: Admin only
// 💾 STORAGE: company.aiAgentSettings.llm0Controls
// ============================================================================

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { redisClient } = require('../../clients');

// ============================================================================
// DEFAULT LLM-0 CONTROLS (for new companies or reset)
// ============================================================================
const DEFAULT_LLM0_CONTROLS = {
    silenceHandling: {
        enabled: true,
        thresholdSeconds: 5,
        firstPrompt: "I'm still here. Take your time.",
        secondPrompt: "Are you still there? I'm happy to wait.",
        thirdPrompt: "If you need a moment, I can call you back. Just let me know.",
        maxPrompts: 3,
        offerCallback: true,
        callbackMessage: "Would you like me to have someone call you back at this number?"
    },
    loopDetection: {
        enabled: true,
        maxRepeatedResponses: 3,
        detectionWindow: 5,
        onLoopAction: 'escalate',
        escalationMessage: "I want to make sure I'm helping you correctly. Let me connect you with someone who can assist."
    },
    spamFilter: {
        enabled: true,
        telemarketerPhrases: [
            'google listing',
            'google business',
            'verify your business',
            'seo services',
            'website ranking',
            'marketing services',
            'special offer',
            'are you the owner',
            'decision maker',
            'person in charge'
        ],
        onSpamDetected: 'polite_dismiss',
        dismissMessage: "I appreciate the call, but we're not interested in any services at this time. Thank you, goodbye.",
        autoAddToBlacklist: false,
        logToBlackBox: true
    },
    customerPatience: {
        enabled: true,
        neverAutoHangup: true,
        maxPatiencePrompts: 5,
        alwaysOfferCallback: true,
        patienceMessage: "No rush at all. I'm here whenever you're ready."
    },
    bailoutRules: {
        enabled: true,
        maxTurnsBeforeEscalation: 10,
        confusionThreshold: 0.3,
        escalateOnBailout: true,
        bailoutMessage: "I want to make sure you get the help you need. Let me transfer you to our team.",
        transferTarget: null
    },
    confidenceThresholds: {
        highConfidence: 0.85,
        mediumConfidence: 0.65,
        lowConfidence: 0.45,
        fallbackToLLM: 0.4
    },
    // LOW CONFIDENCE HANDLING - STT Quality Guard (Dec 2025)
    lowConfidenceHandling: {
        enabled: true,
        threshold: 60,  // 0-100 percent
        action: 'repeat',
        repeatPhrase: "Sorry, there's some background noise — could you say that again?",
        maxRepeatsBeforeEscalation: 2,
        escalatePhrase: "I'm having trouble hearing you clearly. Let me get someone to help you.",
        preserveBookingOnLowConfidence: true,
        bookingRepeatPhrase: "Sorry, I didn't catch that. Could you repeat that for me?",
        logToBlackBox: true
    },
    // SMART CONFIRMATION - Prevent wrong decisions on critical actions
    smartConfirmation: {
        enabled: true,
        confirmTransfers: true,
        confirmBookings: false,
        confirmEmergency: true,
        confirmCancellations: true,
        confirmBelowConfidence: 0.75,
        confirmationStyle: 'smart',
        transferConfirmPhrase: "Before I transfer you, I want to make sure - you'd like to speak with a live agent, correct?",
        bookingConfirmPhrase: "Just to confirm, you'd like to schedule a service appointment, is that right?",
        emergencyConfirmPhrase: "This sounds like an emergency. I want to make sure - should I dispatch someone right away?",
        lowConfidencePhrase: "I want to make sure I understand correctly. You're looking for help with {detected_intent}, is that right?",
        onNoResponse: 'apologize_and_clarify',
        clarifyPhrase: "I apologize for the confusion. Could you tell me more about what you need help with?"
    }
};

// ============================================================================
// GET LLM-0 CONTROLS
// ============================================================================
router.get('/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;

        logger.info(`🧠 [LLM-0 CONTROLS] Fetching settings for company: ${companyId}`);

        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Get LLM-0 controls, merge with defaults for any missing fields
        const llm0Controls = {
            ...DEFAULT_LLM0_CONTROLS,
            ...(company.aiAgentSettings?.llm0Controls || {}),
            // Deep merge nested objects
            silenceHandling: {
                ...DEFAULT_LLM0_CONTROLS.silenceHandling,
                ...(company.aiAgentSettings?.llm0Controls?.silenceHandling || {})
            },
            loopDetection: {
                ...DEFAULT_LLM0_CONTROLS.loopDetection,
                ...(company.aiAgentSettings?.llm0Controls?.loopDetection || {})
            },
            spamFilter: {
                ...DEFAULT_LLM0_CONTROLS.spamFilter,
                ...(company.aiAgentSettings?.llm0Controls?.spamFilter || {})
            },
            customerPatience: {
                ...DEFAULT_LLM0_CONTROLS.customerPatience,
                ...(company.aiAgentSettings?.llm0Controls?.customerPatience || {})
            },
            bailoutRules: {
                ...DEFAULT_LLM0_CONTROLS.bailoutRules,
                ...(company.aiAgentSettings?.llm0Controls?.bailoutRules || {})
            },
            confidenceThresholds: {
                ...DEFAULT_LLM0_CONTROLS.confidenceThresholds,
                ...(company.aiAgentSettings?.llm0Controls?.confidenceThresholds || {})
            },
            lowConfidenceHandling: {
                ...DEFAULT_LLM0_CONTROLS.lowConfidenceHandling,
                ...(company.aiAgentSettings?.llm0Controls?.lowConfidenceHandling || {})
            },
            smartConfirmation: {
                ...DEFAULT_LLM0_CONTROLS.smartConfirmation,
                ...(company.aiAgentSettings?.llm0Controls?.smartConfirmation || {})
            }
        };

        res.json({
            success: true,
            data: llm0Controls,
            defaults: DEFAULT_LLM0_CONTROLS
        });

    } catch (error) {
        logger.error(`❌ [LLM-0 CONTROLS] Fetch failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch LLM-0 controls',
            error: error.message
        });
    }
});

// ============================================================================
// UPDATE LLM-0 CONTROLS
// ============================================================================
router.put('/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;

        logger.info(`🧠 [LLM-0 CONTROLS] Updating settings for company: ${companyId}`);
        logger.debug(`🧠 [LLM-0 CONTROLS] Update payload:`, JSON.stringify(updates, null, 2));

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiAgentSettings if not exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }

        // Merge updates with existing controls
        const existingControls = company.aiAgentSettings.llm0Controls || {};
        
        company.aiAgentSettings.llm0Controls = {
            silenceHandling: {
                ...DEFAULT_LLM0_CONTROLS.silenceHandling,
                ...existingControls.silenceHandling,
                ...(updates.silenceHandling || {})
            },
            loopDetection: {
                ...DEFAULT_LLM0_CONTROLS.loopDetection,
                ...existingControls.loopDetection,
                ...(updates.loopDetection || {})
            },
            spamFilter: {
                ...DEFAULT_LLM0_CONTROLS.spamFilter,
                ...existingControls.spamFilter,
                ...(updates.spamFilter || {}),
                // Special handling for array field
                telemarketerPhrases: updates.spamFilter?.telemarketerPhrases || 
                    existingControls.spamFilter?.telemarketerPhrases || 
                    DEFAULT_LLM0_CONTROLS.spamFilter.telemarketerPhrases
            },
            customerPatience: {
                ...DEFAULT_LLM0_CONTROLS.customerPatience,
                ...existingControls.customerPatience,
                ...(updates.customerPatience || {})
            },
            bailoutRules: {
                ...DEFAULT_LLM0_CONTROLS.bailoutRules,
                ...existingControls.bailoutRules,
                ...(updates.bailoutRules || {})
            },
            confidenceThresholds: {
                ...DEFAULT_LLM0_CONTROLS.confidenceThresholds,
                ...existingControls.confidenceThresholds,
                ...(updates.confidenceThresholds || {})
            },
            lowConfidenceHandling: {
                ...DEFAULT_LLM0_CONTROLS.lowConfidenceHandling,
                ...existingControls.lowConfidenceHandling,
                ...(updates.lowConfidenceHandling || {})
            },
            smartConfirmation: {
                ...DEFAULT_LLM0_CONTROLS.smartConfirmation,
                ...existingControls.smartConfirmation,
                ...(updates.smartConfirmation || {})
            },
            lastUpdated: new Date(),
            updatedBy: req.user?.email || 'admin'
        };

        company.markModified('aiAgentSettings.llm0Controls');
        await company.save();

        // Clear Redis cache (both company cache and LLM-0 controls cache)
        try {
            await redisClient.del(`company:${companyId}`);
            await redisClient.del(`llm0controls:${companyId}`);
            logger.debug(`✅ [LLM-0 CONTROLS] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LLM-0 CONTROLS] Cache clear failed (non-critical):`, cacheError.message);
        }

        logger.info(`✅ [LLM-0 CONTROLS] Settings updated successfully`, {
            companyId,
            updatedBy: req.user?.email
        });

        res.json({
            success: true,
            message: 'LLM-0 controls updated successfully',
            data: company.aiAgentSettings.llm0Controls
        });

    } catch (error) {
        logger.error(`❌ [LLM-0 CONTROLS] Update failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to update LLM-0 controls',
            error: error.message
        });
    }
});

// ============================================================================
// RESET LLM-0 CONTROLS TO DEFAULTS
// ============================================================================
router.post('/:companyId/reset', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;

        logger.info(`🧠 [LLM-0 CONTROLS] Resetting to defaults for company: ${companyId}`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiAgentSettings if not exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }

        // Reset to defaults
        company.aiAgentSettings.llm0Controls = {
            ...DEFAULT_LLM0_CONTROLS,
            lastUpdated: new Date(),
            updatedBy: req.user?.email || 'admin'
        };

        company.markModified('aiAgentSettings.llm0Controls');
        await company.save();

        // Clear Redis cache (both company cache and LLM-0 controls cache)
        try {
            await redisClient.del(`company:${companyId}`);
            await redisClient.del(`llm0controls:${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LLM-0 CONTROLS] Cache clear failed:`, cacheError.message);
        }

        logger.info(`✅ [LLM-0 CONTROLS] Reset to defaults complete`, { companyId });

        res.json({
            success: true,
            message: 'LLM-0 controls reset to defaults',
            data: company.aiAgentSettings.llm0Controls
        });

    } catch (error) {
        logger.error(`❌ [LLM-0 CONTROLS] Reset failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset LLM-0 controls',
            error: error.message
        });
    }
});

// ============================================================================
// ADD TELEMARKETER PHRASE (quick add from UI)
// ============================================================================
router.post('/:companyId/spam-phrase', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;

        if (!phrase || phrase.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Phrase must be at least 3 characters'
            });
        }

        logger.info(`🧠 [LLM-0 CONTROLS] Adding spam phrase: "${phrase}" for company: ${companyId}`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize if needed
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.llm0Controls) {
            company.aiAgentSettings.llm0Controls = { ...DEFAULT_LLM0_CONTROLS };
        }
        if (!company.aiAgentSettings.llm0Controls.spamFilter) {
            company.aiAgentSettings.llm0Controls.spamFilter = { ...DEFAULT_LLM0_CONTROLS.spamFilter };
        }
        if (!Array.isArray(company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases)) {
            company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases = [...DEFAULT_LLM0_CONTROLS.spamFilter.telemarketerPhrases];
        }

        const normalizedPhrase = phrase.toLowerCase().trim();
        const existingPhrases = company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases;

        // Check if already exists
        if (existingPhrases.includes(normalizedPhrase)) {
            return res.status(409).json({
                success: false,
                message: 'Phrase already exists in spam filter'
            });
        }

        // Add phrase
        existingPhrases.push(normalizedPhrase);
        company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases = existingPhrases;
        company.aiAgentSettings.llm0Controls.lastUpdated = new Date();
        company.aiAgentSettings.llm0Controls.updatedBy = req.user?.email || 'admin';

        company.markModified('aiAgentSettings.llm0Controls');
        await company.save();

        // Clear Redis cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LLM-0 CONTROLS] Cache clear failed:`, cacheError.message);
        }

        logger.info(`✅ [LLM-0 CONTROLS] Spam phrase added: "${normalizedPhrase}"`);

        res.json({
            success: true,
            message: `Phrase "${normalizedPhrase}" added to spam filter`,
            phrases: existingPhrases
        });

    } catch (error) {
        logger.error(`❌ [LLM-0 CONTROLS] Add spam phrase failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add spam phrase',
            error: error.message
        });
    }
});

// ============================================================================
// REMOVE TELEMARKETER PHRASE
// ============================================================================
router.delete('/:companyId/spam-phrase', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;

        if (!phrase) {
            return res.status(400).json({
                success: false,
                message: 'Phrase is required'
            });
        }

        logger.info(`🧠 [LLM-0 CONTROLS] Removing spam phrase: "${phrase}" for company: ${companyId}`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const normalizedPhrase = phrase.toLowerCase().trim();
        const existingPhrases = company.aiAgentSettings?.llm0Controls?.spamFilter?.telemarketerPhrases || [];
        
        const updatedPhrases = existingPhrases.filter(p => p !== normalizedPhrase);

        if (updatedPhrases.length === existingPhrases.length) {
            return res.status(404).json({
                success: false,
                message: 'Phrase not found in spam filter'
            });
        }

        company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases = updatedPhrases;
        company.aiAgentSettings.llm0Controls.lastUpdated = new Date();
        company.markModified('aiAgentSettings.llm0Controls');
        await company.save();

        // Clear Redis cache
        try {
            await redisClient.del(`company:${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LLM-0 CONTROLS] Cache clear failed:`, cacheError.message);
        }

        res.json({
            success: true,
            message: `Phrase "${normalizedPhrase}" removed from spam filter`,
            phrases: updatedPhrases
        });

    } catch (error) {
        logger.error(`❌ [LLM-0 CONTROLS] Remove spam phrase failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove spam phrase',
            error: error.message
        });
    }
});

// ============================================================================
// GET DEFAULTS (for UI reference)
// ============================================================================
router.get('/defaults', authenticateJWT, (req, res) => {
    res.json({
        success: true,
        data: DEFAULT_LLM0_CONTROLS
    });
});

module.exports = router;


/**
 * 📚 Knowledge Q&A Source Controls API Routes - Module 2
 * 
 * This module handles API routes for configuring AI agent knowledge source priorities,
 * confidence thresholds, and fallback behaviors per company.
 * 
 * Routes:
 * - GET /api/company/companies/:id/knowledge - Get knowledge settings
 * - PUT /api/company/companies/:id/knowledge - Update knowledge settings
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

/**
 * GET /api/company/:id/knowledge
 * Retrieve knowledge Q&A settings for a specific company
 */
router.get('/:id/knowledge', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Company ID is required' 
            });
        }

        const company = await Company.findById(id).select('agentKnowledgeSettings');
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        // Return knowledge settings with defaults if not set
        const knowledgeSettings = company.agentKnowledgeSettings || {
            sourcePriority: {
                companyQnA: 1,
                tradeQnA: 2,
                vectorSearch: 3,
                llmFallback: 4
            },
            confidenceThresholds: {
                companyQnA: 0.8,
                tradeQnA: 0.75,
                vectorSearch: 0.7,
                llmFallback: 0.6
            },
            memoryMode: 'conversational',
            contextRetentionMinutes: 30,
            rejectLowConfidence: true,
            escalateOnNoMatch: true,
            fallbackMessage: "I want to make sure I give you accurate information. Let me connect you with a specialist who can help.",
            fallbackOverrides: {
                kb_miss: "",
                router_config_missing: "",
                after_hours: "",
                runtime_error: ""
            }
        };

        res.json({
            success: true,
            data: {
                ...knowledgeSettings,
                fallbackOverrides: knowledgeSettings.fallbackOverrides || {
                    kb_miss: "",
                    router_config_missing: "",
                    after_hours: "",
                    runtime_error: ""
                },
                fallbackActions: knowledgeSettings.fallbackActions || {
                    offerSms: true,
                    smsTemplate: {
                        body: "Thanks for calling. Here's our booking link: {{booking_link}}",
                        includeBookingLink: true,
                        extraLinks: []
                    },
                    offerTransfer: true,
                    transferStrategy: "hours_only",
                    transferTargets: [],
                    retryTransferOnBusy: {
                        enabled: true,
                        attempts: 1,
                        backoffSeconds: 15
                    },
                    offerVoicemail: true,
                    voicemailStrategy: "after_hours_only",
                    offerCallback: true,
                    offerBooking: true,
                    bookingLink: "https://cal.clientsvia.ai/{{companyId}}",
                    notifyOnActions: {
                        sms: [],
                        email: []
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error fetching knowledge settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

/**
 * PUT /api/company/:id/knowledge
 * Update knowledge Q&A settings for a specific company
 */
router.put('/:id/knowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const knowledgeUpdates = req.body;

        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Company ID is required' 
            });
        }

        // Validate the knowledge settings structure
        if (knowledgeUpdates.sourcePriority) {
            const priorities = Object.values(knowledgeUpdates.sourcePriority);
            const uniquePriorities = new Set(priorities);
            
            if (uniquePriorities.size !== priorities.length) {
                return res.status(400).json({
                    success: false,
                    error: 'Source priorities must be unique (1-4)'
                });
            }
            
            if (priorities.some(p => p < 1 || p > 4)) {
                return res.status(400).json({
                    success: false,
                    error: 'Source priorities must be between 1 and 4'
                });
            }
        }

        // Validate confidence thresholds
        if (knowledgeUpdates.confidenceThresholds) {
            const thresholds = Object.values(knowledgeUpdates.confidenceThresholds);
            if (thresholds.some(t => t < 0 || t > 1)) {
                return res.status(400).json({
                    success: false,
                    error: 'Confidence thresholds must be between 0 and 1'
                });
            }
        }

        // Validate memory mode
        if (knowledgeUpdates.memoryMode && !['short', 'conversational', 'session'].includes(knowledgeUpdates.memoryMode)) {
            return res.status(400).json({
                success: false,
                error: 'Memory mode must be: short, conversational, or session'
            });
        }

        // Validate context retention
        if (knowledgeUpdates.contextRetentionMinutes) {
            const minutes = knowledgeUpdates.contextRetentionMinutes;
            if (minutes < 5 || minutes > 120) {
                return res.status(400).json({
                    success: false,
                    error: 'Context retention must be between 5 and 120 minutes'
                });
            }
        }

        // Validate fallback overrides (Phase 3)
        if (knowledgeUpdates.fallbackOverrides) {
            const validReasons = ['kb_miss', 'router_config_missing', 'after_hours', 'runtime_error'];
            const overrides = knowledgeUpdates.fallbackOverrides;
            
            for (const reason in overrides) {
                if (!validReasons.includes(reason)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid fallback override reason: ${reason}. Valid reasons: ${validReasons.join(', ')}`
                    });
                }
                
                // Optional: validate message length (reasonable limit)
                if (typeof overrides[reason] === 'string' && overrides[reason].length > 500) {
                    return res.status(400).json({
                        success: false,
                        error: `Fallback override message for ${reason} exceeds 500 character limit`
                    });
                }
            }
        }

        // Validate fallback actions (Phase 4)
        if (knowledgeUpdates.fallbackActions) {
            const fa = knowledgeUpdates.fallbackActions;
            
            // Validate transfer strategy
            if (fa.transferStrategy && !['hours_only', 'always', 'never'].includes(fa.transferStrategy)) {
                return res.status(400).json({
                    success: false,
                    error: 'Transfer strategy must be: hours_only, always, or never'
                });
            }
            
            // Validate voicemail strategy
            if (fa.voicemailStrategy && !['always', 'after_hours_only', 'on_fail'].includes(fa.voicemailStrategy)) {
                return res.status(400).json({
                    success: false,
                    error: 'Voicemail strategy must be: always, after_hours_only, or on_fail'
                });
            }
            
            // Validate SMS template body length
            if (fa.smsTemplate?.body && fa.smsTemplate.body.length > 500) {
                return res.status(400).json({
                    success: false,
                    error: 'SMS template body exceeds 500 character limit'
                });
            }
            
            // Validate booking link length
            if (fa.bookingLink && fa.bookingLink.length > 300) {
                return res.status(400).json({
                    success: false,
                    error: 'Booking link exceeds 300 character limit'
                });
            }
            
            // Validate transfer targets limit
            if (fa.transferTargets && Array.isArray(fa.transferTargets) && fa.transferTargets.length > 8) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot have more than 8 transfer targets'
                });
            }
            
            // Validate retry settings
            if (fa.retryTransferOnBusy) {
                const retry = fa.retryTransferOnBusy;
                if (retry.attempts && (retry.attempts < 0 || retry.attempts > 3)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Retry attempts must be between 0 and 3'
                    });
                }
                if (retry.backoffSeconds && (retry.backoffSeconds < 0 || retry.backoffSeconds > 60)) {
                    return res.status(400).json({
                        success: false,
                        error: 'Retry backoff must be between 0 and 60 seconds'
                    });
                }
            }
        }

        const company = await Company.findByIdAndUpdate(
            id,
            { agentKnowledgeSettings: knowledgeUpdates },
            { new: true, runValidators: true }
        ).select('agentKnowledgeSettings');

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        res.json({
            success: true,
            message: 'Knowledge settings updated successfully',
            data: company.agentKnowledgeSettings
        });

    } catch (error) {
        console.error('Error updating knowledge settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

module.exports = router;

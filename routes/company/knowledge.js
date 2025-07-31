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
            fallbackMessage: "I want to make sure I give you accurate information. Let me connect you with a specialist who can help."
        };

        res.json({
            success: true,
            data: knowledgeSettings
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

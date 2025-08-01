/**
 * Simple AI Agent Logic Routes - Production Safe Version
 * Basic endpoints without complex dependencies to avoid router middleware errors
 */

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');

/**
 * GET /api/admin/:companyID/ai-settings
 * Load AI settings for a specific company
 */
router.get('/admin/:companyID/ai-settings', async (req, res) => {
    try {
        const { companyID } = req.params;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        res.json({
            success: true,
            data: company.aiAgentLogic || {
                enabled: false,
                answerPriorityFlow: [],
                responseCategories: {},
                agentPersonality: {},
                behaviorControls: {}
            }
        });
    } catch (error) {
        console.error('Error loading AI settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to load AI settings',
            details: error.message 
        });
    }
});

/**
 * PUT /api/admin/:companyID/ai-settings
 * Update AI settings for a specific company
 */
router.put('/admin/:companyID/ai-settings', async (req, res) => {
    try {
        const { companyID } = req.params;
        const aiSettings = req.body;

        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        company.aiAgentLogic = {
            ...company.aiAgentLogic,
            ...aiSettings,
            lastUpdated: new Date()
        };
        
        await company.save();

        res.json({
            success: true,
            message: 'AI settings updated successfully',
            data: company.aiAgentLogic
        });
    } catch (error) {
        console.error('Error updating AI settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update AI settings',
            details: error.message 
        });
    }
});

/**
 * GET /api/tradeqa/:trade
 * Get trade-specific knowledge for AI responses
 */
router.get('/tradeqa/:trade', async (req, res) => {
    try {
        const { trade } = req.params;
        
        // Simple response for now - can be enhanced later
        res.json({
            success: true,
            trade: trade,
            data: {
                name: `${trade.toUpperCase()} Knowledge`,
                description: `Trade-specific knowledge for ${trade}`,
                questions: []
            }
        });
    } catch (error) {
        console.error('Error getting trade Q&A:', error);
        res.status(500).json({
            success: false,
            error: 'Trade QA lookup failed',
            details: error.message
        });
    }
});

module.exports = router;

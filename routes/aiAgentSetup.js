/**
 * AI Agent Setup Routes - HighLevel Competitive Mode
 * API endpoints for the new AI Agent Setup system
 */

const express = require('express');
const router = express.Router();
const AIAgentSetupService = require('../services/aiAgentSetup');
const { authenticateJWT } = require('../middleware/auth');

// Get business templates
router.get('/templates', authenticateJWT, async (req, res) => {
    try {
        const templates = AIAgentSetupService.getBusinessTemplates();
        res.json({
            success: true,
            templates: templates
        });
    } catch (error) {
        console.error('Failed to get business templates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get business templates',
            error: error.message
        });
    }
});

// Get personality presets
router.get('/personality-presets', authenticateJWT, async (req, res) => {
    try {
        const presets = AIAgentSetupService.getPersonalityPresets();
        res.json({
            success: true,
            presets: presets
        });
    } catch (error) {
        console.error('Failed to get personality presets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get personality presets',
            error: error.message
        });
    }
});

// Quick setup deployment
router.post('/quick-setup', authenticateJWT, async (req, res) => {
    try {
        const { templateType, personality } = req.body;
        const companyId = req.user.companyId;

        if (!templateType || !personality) {
            return res.status(400).json({
                success: false,
                message: 'Template type and personality are required'
            });
        }

        const result = await AIAgentSetupService.deployQuickSetup(companyId, templateType, personality);
        
        res.json(result);
    } catch (error) {
        console.error('Quick setup deployment failed:', error);
        res.status(500).json({
            success: false,
            message: 'Quick setup deployment failed',
            error: error.message
        });
    }
});

// Get current AI agent configuration
router.get('/config', authenticateJWT, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const config = await AIAgentSetupService.getAIAgentConfig(companyId);
        
        res.json({
            success: true,
            config: config
        });
    } catch (error) {
        console.error('Failed to get AI agent config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get AI agent configuration',
            error: error.message
        });
    }
});

// Save AI agent configuration
router.post('/config', authenticateJWT, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const config = req.body;

        const result = await AIAgentSetupService.saveAIAgentConfig(companyId, config);
        
        res.json(result);
    } catch (error) {
        console.error('Failed to save AI agent config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save AI agent configuration',
            error: error.message
        });
    }
});

// Generate scheduling preview
router.post('/scheduling-preview', authenticateJWT, async (req, res) => {
    try {
        const { serviceTypes, businessType } = req.body;
        const preview = AIAgentSetupService.generateSchedulingPreview(serviceTypes, businessType);
        
        res.json({
            success: true,
            preview: preview
        });
    } catch (error) {
        console.error('Failed to generate scheduling preview:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate scheduling preview',
            error: error.message
        });
    }
});

// Test call simulation
router.post('/test-call', authenticateJWT, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { scenario } = req.body;

        const result = await AIAgentSetupService.simulateTestCall(companyId, scenario);
        
        res.json(result);
    } catch (error) {
        console.error('Test call simulation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Test call simulation failed',
            error: error.message
        });
    }
});

// Get template preview
router.get('/template-preview/:templateType', authenticateJWT, async (req, res) => {
    try {
        const { templateType } = req.params;
        const templates = AIAgentSetupService.getBusinessTemplates();
        const template = templates[templateType];

        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        res.json({
            success: true,
            template: template
        });
    } catch (error) {
        console.error('Failed to get template preview:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get template preview',
            error: error.message
        });
    }
});

// Validate configuration
router.post('/validate', authenticateJWT, async (req, res) => {
    try {
        const config = req.body;
        const validation = {
            isValid: true,
            warnings: [],
            recommendations: []
        };

        // Basic validation
        if (!config.basic?.timezone) {
            validation.warnings.push('No timezone specified - defaulting to Eastern Time');
        }

        if (!config.scheduling?.serviceTypes?.length) {
            validation.warnings.push('No service types configured - customers may have difficulty booking');
        }

        if (!config.knowledge?.customQAs?.length && !config.knowledge?.selectedCategories?.length) {
            validation.warnings.push('No knowledge base configured - agent may not answer common questions');
        }

        // Recommendations based on HighLevel competitive analysis
        if (config.scheduling?.serviceTypes?.length > 5) {
            validation.recommendations.push('Consider reducing service types to 5 or fewer for better user experience');
        }

        if (config.personality?.preset === 'custom' && !config.personality?.formality) {
            validation.recommendations.push('Custom personality requires formality level setting');
        }

        res.json({
            success: true,
            validation: validation
        });
    } catch (error) {
        console.error('Configuration validation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Configuration validation failed',
            error: error.message
        });
    }
});

// AI Agent Setup Analytics
router.get('/analytics', authenticateJWT, async (req, res) => {
    try {
        const companyId = req.user.companyId;
        
        // This would integrate with your existing analytics
        // For now, return simulated data
        const analytics = {
            setupCompleteness: 85,
            lastUpdated: new Date(),
            quickSetupUsed: true,
            template: 'hvac',
            personalityPreset: 'professional',
            serviceTypesConfigured: 3,
            customQAsAdded: 5,
            testCallsRun: 2,
            estimatedEffectiveness: 92 // Based on configuration completeness
        };

        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        console.error('Failed to get AI agent analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get AI agent analytics',
            error: error.message
        });
    }
});

module.exports = router;

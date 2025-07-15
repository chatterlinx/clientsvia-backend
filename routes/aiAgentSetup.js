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

// Save AI agent setup data to company
router.post('/company/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const aiAgentSetupData = req.body;
        
        // Verify user has access to this company
        if (req.user.companyId !== companyId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied to this company'
            });
        }
        
        // Update company with AI agent setup data
        const Company = require('../models/Company');
        const company = await Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    aiAgentSetup: aiAgentSetupData,
                    updatedAt: new Date()
                }
            },
            { new: true }
        );
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        console.log(`[AI AGENT SETUP] Saved for company ${companyId}:`, aiAgentSetupData);
        
        res.json({
            success: true,
            message: 'AI agent setup saved successfully',
            data: aiAgentSetupData
        });
        
    } catch (error) {
        console.error('Failed to save AI agent setup:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save AI agent setup',
            error: error.message
        });
    }
});

// ============================================================
// SCRIPT DEBUGGING AND ANALYTICS ENDPOINTS
// ============================================================

// Test script with a sample question
router.post('/test-script', authenticateJWT, async (req, res) => {
    try {
        const { question, companyId } = req.body;
        
        if (!question || !companyId) {
            return res.status(400).json({
                success: false,
                message: 'Question and companyId are required'
            });
        }

        const { processMainAgentScript } = require('../services/agent');
        const { getDB } = require('../db');
        const { ObjectId } = require('mongodb');
        
        const db = getDB();
        const company = await db.collection('companiesCollection').findOne({ 
            _id: new ObjectId(companyId) 
        });
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const placeholders = company?.agentSetup?.placeholders || [];
        const scriptResult = await processMainAgentScript(
            company, 
            question, 
            [], // Empty conversation history for testing
            placeholders
        );

        res.json({
            success: true,
            scriptResult: scriptResult,
            scriptLength: company?.agentSetup?.mainAgentScript?.length || 0,
            hasScript: !!company?.agentSetup?.mainAgentScript,
            testQuestion: question
        });

    } catch (error) {
        console.error('Script test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Script test failed',
            error: error.message
        });
    }
});

// Get script analytics and gaps
router.get('/script-analytics/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { period = '7d' } = req.query;

        const { analyzeScriptGaps } = require('../services/agent');
        
        const analytics = await analyzeScriptGaps(companyId, period);
        
        res.json({
            success: true,
            analytics: analytics,
            period: period,
            companyId: companyId
        });

    } catch (error) {
        console.error('Failed to get script analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get script analytics',
            error: error.message
        });
    }
});

// Validate script syntax and structure
router.post('/validate-script', authenticateJWT, async (req, res) => {
    try {
        const { script, companyId } = req.body;
        
        if (!script) {
            return res.status(400).json({
                success: false,
                message: 'Script content is required'
            });
        }

        const validation = validateScriptStructure(script);
        
        res.json({
            success: true,
            validation: validation,
            scriptLength: script.length,
            companyId: companyId
        });

    } catch (error) {
        console.error('Script validation failed:', error);
        res.status(500).json({
            success: false,
            message: 'Script validation failed',
            error: error.message
        });
    }
});

// Helper function to validate script structure
function validateScriptStructure(script) {
    const validation = {
        isValid: true,
        warnings: [],
        suggestions: [],
        patterns: {
            conditionals: 0,
            qaPatterns: 0,
            businessRules: 0
        }
    };

    // Check for conditional patterns
    const conditionalPatterns = [
        /if\s+(?:the\s+)?(?:customer|caller|they|user)\s+(?:says?|asks?|mentions?)/gi,
        /when\s+(?:asked|someone\s+asks|they\s+ask)/gi,
        /for\s+(?:questions?\s+about|inquiries?\s+about)/gi
    ];

    conditionalPatterns.forEach(pattern => {
        const matches = script.match(pattern);
        if (matches) {
            validation.patterns.conditionals += matches.length;
        }
    });

    // Check for Q&A patterns
    const qaPatterns = [
        /(?:Q:|Question:)\s*([^?\n]+\??)[\s\n]*(?:A:|Answer:)\s*([^\n]+)/gi,
        /(?:If asked|When asked)\s+['""]([^'"]+)['""][\s\S]*?['""]([^'"]+)['"]/gi
    ];

    qaPatterns.forEach(pattern => {
        const matches = script.match(pattern);
        if (matches) {
            validation.patterns.qaPatterns += matches.length;
        }
    });

    // Check for business rules
    const businessRulePatterns = [
        /(?:always|never)\s+([^.\n]+)/gi,
        /(?:only|just)\s+([^.\n]+)/gi,
        /(?:must|should|need to)\s+([^.\n]+)/gi
    ];

    businessRulePatterns.forEach(pattern => {
        const matches = script.match(pattern);
        if (matches) {
            validation.patterns.businessRules += matches.length;
        }
    });

    // Generate suggestions based on analysis
    if (validation.patterns.conditionals === 0) {
        validation.suggestions.push('Consider adding conditional logic (if/when patterns) to handle specific customer scenarios');
    }

    if (validation.patterns.qaPatterns === 0) {
        validation.suggestions.push('Consider adding Q&A patterns for common questions');
    }

    if (validation.patterns.businessRules === 0) {
        validation.suggestions.push('Consider adding business rules (always/never/must patterns) for consistent behavior');
    }

    if (script.length < 100) {
        validation.warnings.push('Script is very short - consider adding more detailed guidance');
    }

    if (script.length > 5000) {
        validation.warnings.push('Script is very long - consider breaking it into sections for better performance');
    }

    if (!script.toLowerCase().includes('transfer') && !script.toLowerCase().includes('escalate')) {
        validation.suggestions.push('Consider adding escalation rules for complex situations');
    }

    return validation;
}

module.exports = router;

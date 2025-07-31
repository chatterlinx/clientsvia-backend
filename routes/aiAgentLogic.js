/**
 * ClientsVia AI Agent Logic API Routes
 * Powers the dynamic intelligence configuration UI
 * 
 * Endpoints for:
 * - Answer Priority Flow management
 * - Knowledge Source Controls
 * - Agent Personality fine-tuning
 * - Real-time performance analytics
 */

const express = require('express');
const router = express.Router();
const { authenticateSingleSession } = require('../middleware/auth'); // Use single session auth
const ClientsViaIntelligenceEngine = require('../services/clientsViaIntelligenceEngine');
const Company = require('../models/Company');

// Initialize intelligence engine
const intelligenceEngine = new ClientsViaIntelligenceEngine();

/**
 * 🎯 Answer Priority Flow Management
 */

// Get current priority flow configuration
router.get('/priority-flow/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const priorityFlow = company.aiAgentLogic?.answerPriorityFlow || [
            {
                id: 'company_knowledge',
                name: 'Company Knowledge Base',
                description: 'Company-specific Q&A and internal documentation',
                active: true,
                primary: true,
                priority: 1,
                icon: 'building',
                category: 'primary',
                confidenceThreshold: 0.8,
                intelligenceLevel: 'high',
                performance: {
                    successRate: 0.92,
                    avgConfidence: 0.87,
                    usageCount: 1247
                }
            },
            {
                id: 'trade_categories',
                name: 'Trade Categories Q&A',
                description: 'Industry-specific questions and answers',
                active: true,
                primary: false,
                priority: 2,
                icon: 'industry',
                category: 'industry',
                confidenceThreshold: 0.75,
                intelligenceLevel: 'medium',
                performance: {
                    successRate: 0.84,
                    avgConfidence: 0.79,
                    usageCount: 856
                }
            },
            {
                id: 'template_intelligence',
                name: 'Template Intelligence',
                description: 'Smart templates and conversation patterns',
                active: true,
                primary: false,
                priority: 3,
                icon: 'smart',
                category: 'smart',
                confidenceThreshold: 0.65,
                intelligenceLevel: 'smart',
                performance: {
                    successRate: 0.78,
                    avgConfidence: 0.72,
                    usageCount: 634
                }
            },
            {
                id: 'learning_insights',
                name: 'Learning Queue Insights',
                description: 'Previously learned patterns and approved answers',
                active: true,
                primary: false,
                priority: 4,
                icon: 'learning',
                category: 'learning',
                confidenceThreshold: 0.70,
                intelligenceLevel: 'adaptive',
                performance: {
                    successRate: 0.71,
                    avgConfidence: 0.68,
                    usageCount: 423
                }
            }
        ];

        res.json({
            success: true,
            priorityFlow,
            totalSources: priorityFlow.length,
            activeSources: priorityFlow.filter(s => s.active).length,
            lastOptimized: company.aiAgentLogic?.lastOptimized || null
        });

    } catch (error) {
        console.error('Priority flow fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch priority flow' });
    }
});

// Update priority flow configuration
router.post('/priority-flow/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { priorityFlow, autoOptimize = false } = req.body;

        const result = await intelligenceEngine.updateAnswerPriorityFlow(companyId, priorityFlow);
        
        // Auto-optimize if requested
        if (autoOptimize) {
            const optimizations = await intelligenceEngine.analyzeAndOptimize(companyId);
            result.optimizations = optimizations;
        }

        res.json(result);

    } catch (error) {
        console.error('Priority flow update error:', error);
        res.status(500).json({ error: 'Failed to update priority flow' });
    }
});

// Toggle knowledge source active/inactive
router.post('/priority-flow/:companyId/toggle', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { sourceId, active } = req.body;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Update the specific source's active status
        const priorityFlow = company.aiAgentLogic?.answerPriorityFlow || [];
        const sourceIndex = priorityFlow.findIndex(s => s.id === sourceId);
        
        if (sourceIndex === -1) {
            return res.status(404).json({ error: 'Knowledge source not found' });
        }

        priorityFlow[sourceIndex].active = active;
        
        company.aiAgentLogic = company.aiAgentLogic || {};
        company.aiAgentLogic.answerPriorityFlow = priorityFlow;
        company.aiAgentLogic.lastUpdated = new Date();
        
        await company.save();

        res.json({
            success: true,
            sourceId,
            active,
            message: `${sourceId} ${active ? 'enabled' : 'disabled'} successfully`
        });

    } catch (error) {
        console.error('Source toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle knowledge source' });
    }
});

// Reorder priority flow (drag & drop)  
router.post('/priority-flow/:companyId/reorder', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { order } = req.body; // Array of source IDs in new order

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Update priority order
        const priorityFlow = company.aiAgentLogic?.answerPriorityFlow || [];
        const reorderedFlow = order.map((sourceId, index) => {
            const source = priorityFlow.find(s => s.id === sourceId);
            if (!source) {
                throw new Error(`Source ${sourceId} not found`);
            }
            return { ...source, priority: index + 1 };
        });

        company.aiAgentLogic = company.aiAgentLogic || {};
        company.aiAgentLogic.answerPriorityFlow = reorderedFlow;
        company.aiAgentLogic.lastUpdated = new Date();
        
        await company.save();

        res.json({
            success: true,
            priorityFlow: reorderedFlow,
            message: 'Priority flow reordered successfully'
        });

    } catch (error) {
        console.error('Priority flow reorder error:', error);
        res.status(500).json({ error: 'Failed to reorder priority flow' });
    }
});

/**
 * 🧠 Knowledge Source Controls
 */

// Get knowledge source configuration
router.get('/knowledge-source/:companyId/:sourceType', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId, sourceType } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const sourceConfig = company.aiAgentLogic?.knowledgeSources?.[sourceType] || {
            enabled: true,
            confidenceThreshold: 0.7,
            intelligenceFeatures: {
                semanticSearch: true,
                contextualMatching: true,
                performanceOptimization: true,
                realTimeAdjustment: false
            },
            advancedSettings: {
                maxResults: 5,
                timeout: 2000,
                fallbackBehavior: 'escalate',
                cachingEnabled: true
            }
        };

        const performance = await intelligenceEngine.getSourcePerformance(companyId, sourceType);
        const recommendations = await intelligenceEngine.generateSourceRecommendations(companyId, sourceType);

        res.json({
            success: true,
            sourceType,
            configuration: sourceConfig,
            performance,
            recommendations,
            lastUpdated: sourceConfig.lastUpdated || null
        });

    } catch (error) {
        console.error('Knowledge source fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch knowledge source configuration' });
    }
});

// Update knowledge source configuration
router.post('/knowledge-source/:companyId/:sourceType', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId, sourceType } = req.params;
        const { configuration } = req.body;

        const result = await intelligenceEngine.configureKnowledgeSource(
            companyId, 
            sourceType, 
            configuration
        );

        res.json(result);

    } catch (error) {
        console.error('Knowledge source update error:', error);
        res.status(500).json({ error: 'Failed to update knowledge source configuration' });
    }
});

/**
 * 📊 Performance Analytics
 */

// Get comprehensive performance analytics
router.get('/analytics/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeframe = '7d' } = req.query;

        const analytics = await intelligenceEngine.analyzeAndOptimize(companyId, timeframe);
        
        res.json({
            success: true,
            timeframe,
            analytics,
            generatedAt: new Date()
        });

    } catch (error) {
        console.error('Analytics fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Get real-time performance metrics
router.get('/metrics/:companyId/realtime', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const metrics = await intelligenceEngine.getPerformanceMetrics(companyId, '1d');
        
        // Real-time status
        const status = {
            agentStatus: 'active',
            currentConfidence: metrics.avgConfidence,
            successRate: metrics.successRate,
            activeOptimizations: metrics.trends?.optimizations || 0,
            lastQuery: new Date(Date.now() - Math.random() * 300000), // Mock recent activity
            processingLoad: Math.round(Math.random() * 40 + 10) // Mock load %
        };

        res.json({
            success: true,
            metrics,
            status,
            updatedAt: new Date()
        });

    } catch (error) {
        console.error('Real-time metrics error:', error);
        res.status(500).json({ error: 'Failed to fetch real-time metrics' });
    }
});

/**
 * 🎨 Template Intelligence Configuration
 */

// Get template intelligence configuration
router.get('/template-intelligence/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const config = company.aiAgentLogic?.templateIntelligence || {
            enabled: true,
            intelligenceLevel: 'smart',
            categories: [
                { name: 'Primary Interactions', templates: 3, performance: 0.92 },
                { name: 'Service Interactions', templates: 4, performance: 0.87 },
                { name: 'Emergency Protocols', templates: 2, performance: 0.95 }
            ],
            aiEnhancements: {
                contextualAdaptation: true,
                personalityIntegration: true,
                performanceOptimization: true,
                realTimeAdjustment: false
            }
        };

        const optimizations = await intelligenceEngine.generateTemplateOptimizations(companyId);

        res.json({
            success: true,
            configuration: config,
            optimizations,
            intelligenceLevel: config.intelligenceLevel,
            lastOptimized: config.lastOptimized || null
        });

    } catch (error) {
        console.error('Template intelligence fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch template intelligence configuration' });
    }
});

// Update template intelligence configuration
router.post('/template-intelligence/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { configuration } = req.body;

        const result = await intelligenceEngine.configureTemplateIntelligence(companyId, configuration);
        
        res.json(result);

    } catch (error) {
        console.error('Template intelligence update error:', error);
        res.status(500).json({ error: 'Failed to update template intelligence configuration' });
    }
});

/**
 * 🚀 Quick Actions & Optimizations
 */

// Apply optimization suggestions
router.post('/optimize/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { optimizationType, autoApply = false } = req.body;

        const result = await intelligenceEngine.applyOptimization(companyId, {
            type: optimizationType,
            autoApply
        });

        res.json({
            success: true,
            optimization: result,
            appliedAt: new Date(),
            message: `${optimizationType} optimization applied successfully`
        });

    } catch (error) {
        console.error('Optimization error:', error);
        res.status(500).json({ error: 'Failed to apply optimization' });
    }
});

// Reset to intelligent defaults
router.post('/reset-defaults/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Reset to intelligent defaults
        company.aiAgentLogic = {
            answerPriorityFlow: intelligenceEngine.getDefaultPriorityFlow(),
            knowledgeSources: {},
            templateIntelligence: {
                enabled: true,
                intelligenceLevel: 'smart',
                aiEnhancements: {
                    contextualAdaptation: true,
                    personalityIntegration: true,
                    performanceOptimization: true,
                    realTimeAdjustment: false
                }
            },
            lastReset: new Date()
        };

        await company.save();

        res.json({
            success: true,
            message: 'AI Agent Logic reset to intelligent defaults',
            configuration: company.aiAgentLogic
        });

    } catch (error) {
        console.error('Reset defaults error:', error);
        res.status(500).json({ error: 'Failed to reset to defaults' });
    }
});

// Reset to defaults endpoint (frontend expects this path)
router.post('/priority-flow/:companyId/reset', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Reset to intelligent defaults
        const defaultPriorityFlow = [
            {
                id: 'company_knowledge',
                name: 'Company Knowledge Base',
                description: 'Company-specific Q&A and internal documentation',
                active: true,
                primary: true,
                priority: 1,
                icon: 'building',
                category: 'primary',
                confidenceThreshold: 0.8,
                intelligenceLevel: 'high',
                performance: {
                    successRate: 0.92,
                    avgConfidence: 0.87,
                    usageCount: 1247
                }
            },
            {
                id: 'trade_categories',
                name: 'Trade Categories Q&A',
                description: 'Industry-specific questions and answers',
                active: true,
                primary: false,
                priority: 2,
                icon: 'industry',
                category: 'industry',
                confidenceThreshold: 0.75,
                intelligenceLevel: 'medium',
                performance: {
                    successRate: 0.84,
                    avgConfidence: 0.79,
                    usageCount: 856
                }
            },
            {
                id: 'template_intelligence',
                name: 'Template Intelligence',
                description: 'Smart templates and conversation patterns',
                active: true,
                primary: false,
                priority: 3,
                icon: 'edit',
                category: 'template',
                confidenceThreshold: 0.65,
                intelligenceLevel: 'smart',
                performance: {
                    successRate: 0.78,
                    avgConfidence: 0.72,
                    usageCount: 634
                }
            }
        ];

        company.aiAgentLogic = company.aiAgentLogic || {};
        company.aiAgentLogic.answerPriorityFlow = defaultPriorityFlow;
        company.aiAgentLogic.lastUpdated = new Date();
        
        await company.save();

        res.json({
            success: true,
            priorityFlow: defaultPriorityFlow,
            message: 'Settings reset to intelligent defaults successfully'
        });

    } catch (error) {
        console.error('Reset defaults error:', error);
        res.status(500).json({ error: 'Failed to reset to defaults' });
    }
});

/**
 * 🎭 Response Categories Management
 */

// Get response categories for a company
router.get('/response-categories/:companyId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId } = req.params;
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Default response templates if none exist
        const defaultTemplates = {
            core: {
                'greeting-response': 'Hi {{callerName}}! Thanks for calling {{companyName}}. How can I help you today?',
                'farewell-response': 'Thanks for calling {{companyName}}! Have a great day!',
                'transfer-response': 'Let me connect you with {{departmentName}} who can better assist you.',
                'service-unavailable-response': 'I\'m sorry, {{serviceType}} isn\'t available right now. Can I help with something else?',
                'hold-response': 'Please hold for just a moment while I look that up for you.',
                'business-hours-response': 'We\'re open {{businessHours}}. You can also visit our website at {{website}}.'
            },
            advanced: {
                'emergency-response': 'This sounds like an emergency. Let me connect you with our emergency team immediately.',
                'after-hours-response': 'Thanks for calling! We\'re currently closed but will get back to you first thing in the morning.',
                'appointment-confirmation': 'Perfect! I\'ve scheduled your appointment for {{appointmentTime}} on {{appointmentDate}}.',
                'scheduling-conflict': 'That time slot isn\'t available. How about {{alternativeTime}} or {{alternativeTime2}}?'
            },
            emotional: {
                'frustrated-customer': 'I completely understand your frustration, and I\'m here to help make this right for you.',
                'appreciative-response': 'Thank you so much for your patience and for choosing {{companyName}}. We truly appreciate your business!',
                'problem-resolution': 'Don\'t worry, we\'ve handled this exact situation many times before. I\'ll make sure we get this resolved for you quickly.',
                'quality-assurance': 'You can count on us to deliver the highest quality service. We stand behind all our work with a 100% satisfaction guarantee.'
            }
        };

        const responseTemplates = company.aiAgentLogic?.responseCategories || defaultTemplates;

        res.json({
            success: true,
            data: responseTemplates,
            message: 'Response categories retrieved successfully'
        });

    } catch (error) {
        console.error('Get response categories error:', error);
        res.status(500).json({ error: 'Failed to retrieve response categories' });
    }
});

// Save response categories for a company
router.post('/response-categories', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId, responseTemplates } = req.body;
        
        if (!companyId || !responseTemplates) {
            return res.status(400).json({ error: 'Company ID and response templates are required' });
        }

        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Validate response templates structure
        const requiredCategories = ['core', 'advanced', 'emotional'];
        for (const category of requiredCategories) {
            if (!responseTemplates[category] || typeof responseTemplates[category] !== 'object') {
                return res.status(400).json({ 
                    error: `Invalid response templates structure: missing or invalid ${category} category` 
                });
            }
        }

        // Initialize aiAgentLogic if it doesn't exist
        company.aiAgentLogic = company.aiAgentLogic || {};
        
        // Save response categories
        company.aiAgentLogic.responseCategories = responseTemplates;
        company.aiAgentLogic.lastUpdated = new Date();
        
        await company.save();

        res.json({
            success: true,
            data: responseTemplates,
            message: 'Response categories saved successfully'
        });

    } catch (error) {
        console.error('Save response categories error:', error);
        res.status(500).json({ error: 'Failed to save response categories' });
    }
});

// Update individual response template
router.patch('/response-categories/:companyId/:category/:templateId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyId, category, templateId } = req.params;
        const { template } = req.body;
        
        if (!template) {
            return res.status(400).json({ error: 'Template content is required' });
        }

        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize structure if needed
        company.aiAgentLogic = company.aiAgentLogic || {};
        company.aiAgentLogic.responseCategories = company.aiAgentLogic.responseCategories || {};
        company.aiAgentLogic.responseCategories[category] = company.aiAgentLogic.responseCategories[category] || {};
        
        // Update specific template
        company.aiAgentLogic.responseCategories[category][templateId] = template;
        company.aiAgentLogic.lastUpdated = new Date();
        
        await company.save();

        res.json({
            success: true,
            data: {
                category,
                templateId,
                template
            },
            message: 'Response template updated successfully'
        });

    } catch (error) {
        console.error('Update response template error:', error);
        res.status(500).json({ error: 'Failed to update response template' });
    }
});

/**
 * 💾 Save Complete AI Agent Configuration
 * Saves all agent settings including priority flow, personality, and behavior controls
 */
router.post('/save-config', authenticateSingleSession, async (req, res) => {
    try {
        const { answerPriorityFlow, agentPersonality, behaviorControls } = req.body;
        const companyId = req.user.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize aiAgentLogic if it doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        // Update the configuration
        if (answerPriorityFlow) {
            company.aiAgentLogic.answerPriorityFlow = answerPriorityFlow;
        }
        
        if (agentPersonality) {
            company.aiAgentLogic.agentPersonality = {
                ...company.aiAgentLogic.agentPersonality,
                ...agentPersonality
            };
        }
        
        if (behaviorControls) {
            company.aiAgentLogic.behaviorControls = {
                ...company.aiAgentLogic.behaviorControls,
                ...behaviorControls
            };
        }

        // Add metadata
        company.aiAgentLogic.lastUpdated = new Date();
        company.aiAgentLogic.version = (company.aiAgentLogic.version || 0) + 1;

        // Save the company
        await company.save();

        console.log(`✅ AI Agent configuration saved for company ${companyId}`);

        res.json({
            success: true,
            message: 'AI Agent configuration saved successfully',
            data: {
                companyId,
                version: company.aiAgentLogic.version,
                lastUpdated: company.aiAgentLogic.lastUpdated
            }
        });

    } catch (error) {
        console.error('Save AI Agent config error:', error);
        res.status(500).json({ 
            error: 'Failed to save AI Agent configuration',
            details: error.message 
        });
    }
});

module.exports = router;

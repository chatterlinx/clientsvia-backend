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
const { authenticateJWT } = require('../middleware/auth');
const ClientsViaIntelligenceEngine = require('../services/clientsViaIntelligenceEngine');
const Company = require('../models/Company');

// Initialize intelligence engine
const intelligenceEngine = new ClientsViaIntelligenceEngine();

/**
 * 🎯 Answer Priority Flow Management
 */

// Get current priority flow configuration
router.get('/priority-flow/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/priority-flow/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/priority-flow/:companyId/toggle', authenticateJWT, async (req, res) => {
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
router.post('/priority-flow/:companyId/reorder', authenticateJWT, async (req, res) => {
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
router.get('/knowledge-source/:companyId/:sourceType', authenticateJWT, async (req, res) => {
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
router.post('/knowledge-source/:companyId/:sourceType', authenticateJWT, async (req, res) => {
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
router.get('/analytics/:companyId', authenticateJWT, async (req, res) => {
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
router.get('/metrics/:companyId/realtime', authenticateJWT, async (req, res) => {
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
router.get('/template-intelligence/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/template-intelligence/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/optimize/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/reset-defaults/:companyId', authenticateJWT, async (req, res) => {
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
router.post('/priority-flow/:companyId/reset', authenticateJWT, async (req, res) => {
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

module.exports = router;

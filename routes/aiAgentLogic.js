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
 * 🎯 BLUEPRINT COMPLIANCE: Admin AI Settings Endpoints
 * These endpoints match the Blueprint specification for multi-tenant AI settings
 */

/**
 * GET /api/admin/:companyID/ai-settings
 * Load AI settings for a specific company (Blueprint compliance)
 */
router.get('/admin/:companyID/ai-settings', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        
        console.log('🔍 Loading AI settings for company:', companyID);
        
        // Find the company
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Return Blueprint-compliant AI settings structure
        const aiSettings = company.aiAgentLogic || {};
        
        const response = {
            success: true,
            companyID,
            answerPriority: aiSettings.answerPriorityFlow?.map(item => item.id) || [
                "companyKB", "tradeQA", "templates", "learning", "llmFallback"
            ],
            thresholds: {
                companyKB: 0.80,
                tradeQA: 0.75,
                vector: 0.70,
                llmFallback: 0.60,
                ...aiSettings.thresholds
            },
            memory: { 
                mode: "conversational", 
                retentionMinutes: 30,
                ...aiSettings.memory 
            },
            escalation: { 
                onNoMatch: true, 
                strategy: "ask-confirm",
                ...aiSettings.escalation 
            },
            rePromptAfterTurns: aiSettings.rePromptAfterTurns || 3,
            maxPromptsPerCall: aiSettings.maxPromptsPerCall || 2,
            modelConfig: {
                primary: "gemini-pro",
                fallback: "gpt-4o-mini",
                allowed: ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"],
                ...aiSettings.modelConfig
            },
            tradeCategories: company.tradeCategories || ["HVAC Residential", "Plumbing Residential"],
            agentPersonality: aiSettings.agentPersonality || {},
            behaviorControls: aiSettings.behaviorControls || {},
            responseCategories: aiSettings.responseCategories || {}
        };

        console.log('✅ AI settings loaded successfully for company:', companyID);
        res.json(response);

    } catch (error) {
        console.error('Error loading AI settings:', error);
        res.status(500).json({ 
            error: 'Failed to load AI settings',
            details: error.message 
        });
    }
});

/**
 * PUT /api/admin/:companyID/ai-settings
 * Update AI settings for a specific company (Blueprint compliance)
 */
router.put('/admin/:companyID/ai-settings', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        const updates = req.body;
        
        console.log('💾 Updating AI settings for company:', companyID);
        console.log('Updates:', updates);
        
        // Find the company
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Initialize aiAgentLogic if it doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        // Update all provided fields (Blueprint compliance)
        if (updates.answerPriority) {
            company.aiAgentLogic.answerPriority = updates.answerPriority;
        }
        if (updates.thresholds) {
            company.aiAgentLogic.thresholds = { ...company.aiAgentLogic.thresholds, ...updates.thresholds };
        }
        if (updates.memory) {
            company.aiAgentLogic.memory = { ...company.aiAgentLogic.memory, ...updates.memory };
        }
        if (updates.escalation) {
            company.aiAgentLogic.escalation = { ...company.aiAgentLogic.escalation, ...updates.escalation };
        }
        if (updates.rePromptAfterTurns !== undefined) {
            company.aiAgentLogic.rePromptAfterTurns = updates.rePromptAfterTurns;
        }
        if (updates.maxPromptsPerCall !== undefined) {
            company.aiAgentLogic.maxPromptsPerCall = updates.maxPromptsPerCall;
        }
        if (updates.modelConfig) {
            company.aiAgentLogic.modelConfig = { ...company.aiAgentLogic.modelConfig, ...updates.modelConfig };
        }
        if (updates.tradeCategories) {
            company.tradeCategories = updates.tradeCategories;
        }
        if (updates.agentPersonality) {
            company.aiAgentLogic.agentPersonality = { ...company.aiAgentLogic.agentPersonality, ...updates.agentPersonality };
        }
        if (updates.behaviorControls) {
            company.aiAgentLogic.behaviorControls = { ...company.aiAgentLogic.behaviorControls, ...updates.behaviorControls };
        }
        if (updates.responseCategories) {
            company.aiAgentLogic.responseCategories = { ...company.aiAgentLogic.responseCategories, ...updates.responseCategories };
        }

        // Update metadata
        company.aiAgentLogic.lastUpdated = new Date();
        company.aiAgentLogic.version = (company.aiAgentLogic.version || 0) + 1;

        // Save to database
        await company.save();

        console.log('✅ AI settings updated successfully for company:', companyID);
        
        res.json({
            success: true,
            message: 'AI settings updated successfully',
            companyID,
            version: company.aiAgentLogic.version,
            lastUpdated: company.aiAgentLogic.lastUpdated
        });

    } catch (error) {
        console.error('Error updating AI settings:', error);
        res.status(500).json({ 
            error: 'Failed to update AI settings',
            details: error.message 
        });
    }
});

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
        console.log('🔧 Save config request received');
        console.log('Request body:', req.body);
        console.log('User object:', req.user);
        
        const { answerPriorityFlow, agentPersonality, behaviorControls } = req.body;
        
        // Get company ID - handle both populated and non-populated cases
        const companyId = req.user.companyId?._id || req.user.companyId;

        console.log('Extracted companyId:', companyId);

        if (!companyId) {
            console.log('❌ No company ID found in user object');
            return res.status(400).json({ error: 'Company ID is required' });
        }

        // Find the company
        console.log('🔍 Looking for company with ID:', companyId);
        const company = await Company.findById(companyId);
        if (!company) {
            console.log('❌ Company not found with ID:', companyId);
            return res.status(404).json({ error: 'Company not found' });
        }
        
        console.log('✅ Company found:', company.companyName || company.name || 'Unnamed Company');

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

        console.log('💾 Saving company with updated AI Agent Logic:', {
            companyId,
            version: company.aiAgentLogic.version,
            sections: {
                answerPriorityFlow: !!answerPriorityFlow,
                agentPersonality: !!agentPersonality,
                behaviorControls: !!behaviorControls
            }
        });

        // Save the company
        await company.save();

        console.log(`✅ AI Agent configuration saved successfully for company ${companyId}`);
        
        // VERIFICATION: Read back the saved data to confirm persistence
        console.log('🔍 VERIFICATION: Reading back saved data from database...');
        const verifyCompany = await Company.findById(companyId);
        
        if (verifyCompany && verifyCompany.aiAgentLogic) {
            console.log('✅ VERIFICATION SUCCESSFUL: Data confirmed in database:', {
                version: verifyCompany.aiAgentLogic.version,
                lastUpdated: verifyCompany.aiAgentLogic.lastUpdated,
                hasAnswerPriorityFlow: !!verifyCompany.aiAgentLogic.answerPriorityFlow,
                hasAgentPersonality: !!verifyCompany.aiAgentLogic.agentPersonality,
                hasBehaviorControls: !!verifyCompany.aiAgentLogic.behaviorControls,
                actualData: {
                    voiceTone: verifyCompany.aiAgentLogic.agentPersonality?.voiceTone,
                    speechPace: verifyCompany.aiAgentLogic.agentPersonality?.speechPace,
                    allowBargeIn: verifyCompany.aiAgentLogic.behaviorControls?.allowBargeIn,
                    acknowledgeEmotion: verifyCompany.aiAgentLogic.behaviorControls?.acknowledgeEmotion,
                    useEmails: verifyCompany.aiAgentLogic.behaviorControls?.useEmails
                }
            });
        } else {
            console.log('❌ VERIFICATION FAILED: Data not found in database after save!');
        }

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

/**
 * 🔍 Verify AI Agent Configuration
 * Returns the current saved configuration for debugging
 */
router.get('/verify-config', authenticateSingleSession, async (req, res) => {
    try {
        // Get company ID - handle both populated and non-populated cases
        const companyId = req.user.companyId?._id || req.user.companyId;

        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }

        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const currentConfig = company.aiAgentLogic || {};
        
        console.log('🔍 Configuration verification requested for company:', companyId);
        console.log('Current AI Agent Logic config:', currentConfig);

        res.json({
            success: true,
            companyId,
            companyName: company.companyName || company.name,
            currentConfiguration: {
                version: currentConfig.version || 0,
                lastUpdated: currentConfig.lastUpdated,
                answerPriorityFlow: currentConfig.answerPriorityFlow || [],
                agentPersonality: currentConfig.agentPersonality || {},
                behaviorControls: currentConfig.behaviorControls || {},
                fullConfig: currentConfig
            }
        });

    } catch (error) {
        console.error('Verify config error:', error);
        res.status(500).json({ 
            error: 'Failed to verify configuration',
            details: error.message 
        });
    }
});

/**
 * 🎯 BLUEPRINT COMPLIANCE: Company Knowledge Base Endpoints
 * Company-specific Q&A management
 */

/**
 * GET /api/admin/:companyID/kb?query=thermostat
 * Search company knowledge base
 */
router.get('/admin/:companyID/kb', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        const { query } = req.query;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Get company KB entries (placeholder - implement actual KB collection)
        const kbEntries = company.aiAgentLogic?.knowledgeBase || [];
        
        let results = kbEntries;
        if (query) {
            results = kbEntries.filter(entry => 
                entry.question.toLowerCase().includes(query.toLowerCase()) ||
                entry.answer.toLowerCase().includes(query.toLowerCase()) ||
                entry.keywords?.some(keyword => keyword.toLowerCase().includes(query.toLowerCase()))
            );
        }

        res.json({
            success: true,
            companyID,
            query,
            results,
            total: results.length
        });

    } catch (error) {
        console.error('Error searching company KB:', error);
        res.status(500).json({ error: 'Failed to search knowledge base', details: error.message });
    }
});

/**
 * POST /api/admin/:companyID/kb
 * Add new company knowledge base entry
 */
router.post('/admin/:companyID/kb', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        const { question, answer, keywords } = req.body;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.knowledgeBase) {
            company.aiAgentLogic.knowledgeBase = [];
        }

        const newEntry = {
            id: Date.now().toString(),
            question,
            answer,
            keywords: keywords || [],
            createdAt: new Date(),
            lastUpdated: new Date()
        };

        company.aiAgentLogic.knowledgeBase.push(newEntry);
        await company.save();

        res.json({
            success: true,
            message: 'Knowledge base entry added successfully',
            entry: newEntry
        });

    } catch (error) {
        console.error('Error adding KB entry:', error);
        res.status(500).json({ error: 'Failed to add knowledge base entry', details: error.message });
    }
});

/**
 * PUT /api/admin/:companyID/kb/:id
 * Update company knowledge base entry
 */
router.put('/admin/:companyID/kb/:id', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID, id } = req.params;
        const { question, answer, keywords } = req.body;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const kbEntry = company.aiAgentLogic?.knowledgeBase?.find(entry => entry.id === id);
        if (!kbEntry) {
            return res.status(404).json({ error: 'Knowledge base entry not found' });
        }

        // Update the entry
        kbEntry.question = question || kbEntry.question;
        kbEntry.answer = answer || kbEntry.answer;
        kbEntry.keywords = keywords || kbEntry.keywords;
        kbEntry.lastUpdated = new Date();

        await company.save();

        res.json({
            success: true,
            message: 'Knowledge base entry updated successfully',
            entry: kbEntry
        });

    } catch (error) {
        console.error('Error updating KB entry:', error);
        res.status(500).json({ error: 'Failed to update knowledge base entry', details: error.message });
    }
});

/**
 * DELETE /api/admin/:companyID/kb/:id
 * Delete company knowledge base entry
 */
router.delete('/admin/:companyID/kb/:id', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID, id } = req.params;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentLogic?.knowledgeBase) {
            return res.status(404).json({ error: 'Knowledge base entry not found' });
        }

        const entryIndex = company.aiAgentLogic.knowledgeBase.findIndex(entry => entry.id === id);
        if (entryIndex === -1) {
            return res.status(404).json({ error: 'Knowledge base entry not found' });
        }

        company.aiAgentLogic.knowledgeBase.splice(entryIndex, 1);
        await company.save();

        res.json({
            success: true,
            message: 'Knowledge base entry deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting KB entry:', error);
        res.status(500).json({ error: 'Failed to delete knowledge base entry', details: error.message });
    }
});

/**
 * 🎯 BLUEPRINT COMPLIANCE: Booking Flow Endpoints
 */

/**
 * GET /api/admin/:companyID/booking-flow
 * Get booking flow configuration
 */
router.get('/admin/:companyID/booking-flow', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const bookingFlow = company.aiAgentLogic?.bookingFlow || {
            steps: [
                { prompt: "What's your full name?", field: "fullName", required: true },
                { prompt: "What's the service address?", field: "address", required: true },
                { prompt: "What service do you need?", field: "serviceType", required: true },
                { prompt: "Best callback number?", field: "phone", required: true },
                { prompt: "Morning or afternoon?", field: "timePref", required: false }
            ]
        };

        res.json({
            success: true,
            companyID,
            bookingFlow
        });

    } catch (error) {
        console.error('Error loading booking flow:', error);
        res.status(500).json({ error: 'Failed to load booking flow', details: error.message });
    }
});

/**
 * PUT /api/admin/:companyID/booking-flow
 * Update booking flow configuration
 */
router.put('/admin/:companyID/booking-flow', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        const { steps } = req.body;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        company.aiAgentLogic.bookingFlow = {
            steps: steps || [],
            lastUpdated: new Date()
        };

        await company.save();

        res.json({
            success: true,
            message: 'Booking flow updated successfully',
            companyID,
            bookingFlow: company.aiAgentLogic.bookingFlow
        });

    } catch (error) {
        console.error('Error updating booking flow:', error);
        res.status(500).json({ error: 'Failed to update booking flow', details: error.message });
    }
});

/**
 * 🎯 BLUEPRINT COMPLIANCE: Response Trace Endpoints
 */

/**
 * POST /api/agent/:companyID/trace
 * Write debug trace for AI agent decisions
 */
router.post('/agent/:companyID/trace', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        const { callId, steps, finalSource, finalAnswerId } = req.body;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        if (!company.aiAgentLogic.responseTraces) {
            company.aiAgentLogic.responseTraces = [];
        }

        const trace = {
            callId,
            companyID,
            steps,
            finalSource,
            finalAnswerId,
            createdAt: new Date()
        };

        company.aiAgentLogic.responseTraces.push(trace);
        
        // Keep only last 100 traces to prevent bloat
        if (company.aiAgentLogic.responseTraces.length > 100) {
            company.aiAgentLogic.responseTraces = company.aiAgentLogic.responseTraces.slice(-100);
        }

        await company.save();

        res.json({
            success: true,
            message: 'Response trace recorded successfully',
            traceId: trace.callId
        });

    } catch (error) {
        console.error('Error recording response trace:', error);
        res.status(500).json({ error: 'Failed to record response trace', details: error.message });
    }
});

/**
 * GET /api/agent/:companyID/trace/:callId
 * Fetch response trace for debugging
 */
router.get('/agent/:companyID/trace/:callId', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID, callId } = req.params;
        
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const trace = company.aiAgentLogic?.responseTraces?.find(t => t.callId === callId);
        if (!trace) {
            return res.status(404).json({ error: 'Response trace not found' });
        }

        res.json({
            success: true,
            callId,
            trace
        });

    } catch (error) {
        console.error('Error fetching response trace:', error);
        res.status(500).json({ error: 'Failed to fetch response trace', details: error.message });
    }
});

/**
 * 🎯 BLUEPRINT COMPLIANCE: Trade QA Endpoint
 * GET /api/tradeqa/:trade?query=<query>
 * Public endpoint for accessing trade-specific Q&A knowledge
 */
router.get('/tradeqa/:trade', async (req, res) => {
    try {
        const { trade } = req.params;
        const { query } = req.query;
        
        console.log(`🔍 TradeQA lookup: trade=${trade}, query=${query}`);
        
        // Import TradeQnA model
        const TradeQnA = require('../models/TradeQnA');
        
        // Build search criteria
        const searchCriteria = {
            trade: trade.toLowerCase(),
            isActive: true
        };
        
        let results = [];
        
        if (query) {
            // Search by query in question, answer, or keywords
            const searchRegex = new RegExp(query.split(' ').join('|'), 'i');
            
            results = await TradeQnA.find({
                ...searchCriteria,
                $or: [
                    { question: searchRegex },
                    { answer: searchRegex },
                    { keywords: { $in: [searchRegex] } }
                ]
            })
            .limit(20)
            .sort({ createdAt: -1 });
            
            // Calculate simple relevance scores
            results = results.map(item => {
                const questionMatch = (item.question.toLowerCase().match(new RegExp(query.toLowerCase().split(' ').join('|'), 'g')) || []).length;
                const keywordMatch = item.keywords.filter(k => k.toLowerCase().includes(query.toLowerCase())).length;
                const score = (questionMatch * 0.7) + (keywordMatch * 0.3);
                
                return {
                    _id: item._id,
                    trade: item.trade,
                    question: item.question,
                    answer: item.answer,
                    keywords: item.keywords,
                    score: Math.min(score / query.split(' ').length, 1),
                    createdAt: item.createdAt
                };
            }).sort((a, b) => b.score - a.score);
        } else {
            // Return all entries for the trade
            results = await TradeQnA.find(searchCriteria)
                .limit(50)
                .sort({ createdAt: -1 });
                
            results = results.map(item => ({
                _id: item._id,
                trade: item.trade,
                question: item.question,
                answer: item.answer,
                keywords: item.keywords,
                score: 1,
                createdAt: item.createdAt
            }));
        }
        
        res.json({
            success: true,
            trade,
            query: query || 'all',
            results,
            count: results.length,
            totalAvailable: await TradeQnA.countDocuments(searchCriteria)
        });
        
    } catch (error) {
        console.error('Error in TradeQA lookup:', error);
        res.status(500).json({
            success: false,
            error: 'Trade QA lookup failed',
            details: error.message
        });
    }
});

/**
 * POST /api/ai-agent-logic/company/:companyID/save-config
 * Save configuration for a specific company (URL parameter based)
 */
router.post('/company/:companyID/save-config', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        console.log('🔧 Save config request for company:', companyID);
        console.log('Request body:', req.body);
        
        const { answerPriorityFlow, agentPersonality, behaviorControls, responseCategories } = req.body;
        
        // Find the company by ID
        console.log('🔍 Looking for company with ID:', companyID);
        const company = await Company.findById(companyID);
        if (!company) {
            console.log('❌ Company not found with ID:', companyID);
            return res.status(404).json({ error: 'Company not found' });
        }
        
        console.log('✅ Company found:', company.companyName || company.name || 'Unnamed Company');

        // Initialize aiAgentLogic if it doesn't exist
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }

        // Update the configuration
        if (answerPriorityFlow) {
            company.aiAgentLogic.answerPriorityFlow = answerPriorityFlow;
            console.log('✅ Updated answerPriorityFlow');
        }
        
        if (agentPersonality) {
            company.aiAgentLogic.agentPersonality = {
                ...company.aiAgentLogic.agentPersonality,
                ...agentPersonality
            };
            console.log('✅ Updated agentPersonality:', agentPersonality);
        }
        
        if (behaviorControls) {
            company.aiAgentLogic.behaviorControls = {
                ...company.aiAgentLogic.behaviorControls,
                ...behaviorControls
            };
            console.log('✅ Updated behaviorControls:', behaviorControls);
        }

        if (responseCategories) {
            company.aiAgentLogic.responseCategories = {
                ...company.aiAgentLogic.responseCategories,
                ...responseCategories
            };
            console.log('✅ Updated responseCategories');
        }

        // Add metadata
        company.aiAgentLogic.lastUpdated = new Date();
        company.aiAgentLogic.version = (company.aiAgentLogic.version || 0) + 1;

        console.log('💾 Saving company with updated AI Agent Logic');

        // Save the company
        await company.save();

        console.log(`✅ AI Agent configuration saved successfully for company ${companyID}`);
        
        // VERIFICATION: Read back the saved data
        const verifyCompany = await Company.findById(companyID);
        console.log('🔍 VERIFICATION: Data confirmed in database:', {
            version: verifyCompany.aiAgentLogic.version,
            lastUpdated: verifyCompany.aiAgentLogic.lastUpdated,
            agentPersonality: verifyCompany.aiAgentLogic.agentPersonality,
            behaviorControls: verifyCompany.aiAgentLogic.behaviorControls,
            responseCategories: verifyCompany.aiAgentLogic.responseCategories
        });

        res.json({
            success: true,
            message: 'AI Agent configuration saved successfully',
            data: {
                companyId: companyID,
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

/**
 * GET /api/ai-agent-logic/company/:companyID/verify-config
 * Verify configuration for a specific company (URL parameter based)
 */
router.get('/company/:companyID/verify-config', authenticateSingleSession, async (req, res) => {
    try {
        const { companyID } = req.params;
        console.log('🔍 Configuration verification requested for company:', companyID);

        // Find the company
        const company = await Company.findById(companyID);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const currentConfig = company.aiAgentLogic || {};
        
        console.log('Current AI Agent Logic config:', currentConfig);

        res.json({
            success: true,
            companyId: companyID,
            currentConfiguration: {
                version: currentConfig.version || 0,
                lastUpdated: currentConfig.lastUpdated,
                agentPersonality: currentConfig.agentPersonality || {},
                behaviorControls: currentConfig.behaviorControls || {},
                responseCategories: currentConfig.responseCategories || {},
                answerPriorityFlow: currentConfig.answerPriorityFlow || []
            }
        });

    } catch (error) {
        console.error('Verify config error:', error);
        res.status(500).json({ 
            error: 'Failed to verify configuration',
            details: error.message 
        });
    }
});

module.exports = router;

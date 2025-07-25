/**
 * Agent Testing and Processing API Routes
 * Connects the UI testing console with the actual agent logic
 * Provides full admin control over agent behavior
 */

const express = require('express');
const router = express.Router();
const agentMessageProcessor = require('../services/agentMessageProcessor');
const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const Company = require('../models/Company'); // Use Mongoose model

// Initialize the processor when routes are first accessed (after DB connection)
let processorInitialized = false;
async function ensureProcessorInitialized() {
    if (!processorInitialized) {
        await agentMessageProcessor.initialize();
        processorInitialized = true;
    }
}

/**
 * Test agent response (connects to testing console UI)
 * POST /api/agent/test
 */
router.post('/test', async (req, res) => {
    try {
        await ensureProcessorInitialized();
        
        const { companyId, message, callSid } = req.body;

        if (!companyId || !message) {
            return res.status(400).json({
                error: 'Missing required fields: companyId and message'
            });
        }

        console.log(`🧪 Testing agent for company ${companyId}: "${message}"`);

        // Process message through the new pipeline
        const result = await agentMessageProcessor.processMessage(companyId, message, {
            callSid: callSid || `test_${Date.now()}`,
            testing: true
        });

        // Return structured response for testing console
        res.json({
            success: true,
            response: {
                text: result.text,
                confidence: result.confidence,
                responseMethod: result.responseMethod,
                source: result.source,
                escalate: result.escalate,
                processingTime: result.processingTime
            },
            metadata: {
                responseTime: `${result.processingTime}ms`,
                confidenceScore: `${Math.round((result.confidence || 0) * 100)}%`,
                knowledgeSource: result.source || 'unknown',
                llmModel: result.responseMethod || 'unknown'
            },
            traceLogs: result.traceLog || [],
            settings: result.settings,
            debugInfo: result.debugInfo || {}
        });

    } catch (error) {
        console.error('❌ Agent test error:', error);
        res.status(500).json({
            error: 'Failed to test agent',
            message: error.message,
            traceLogs: [`Error: ${error.message}`]
        });
    }
});

/**
 * Process live message (for production use)
 * POST /api/agent/process
 */
router.post('/process', async (req, res) => {
    try {
        await ensureProcessorInitialized();
        
        const { companyId, message, callSid, from, channel } = req.body;

        if (!companyId || !message) {
            return res.status(400).json({
                error: 'Missing required fields: companyId and message'
            });
        }

        console.log(`📞 Processing live message for company ${companyId} from ${from}: "${message}"`);

        // Process message through the new pipeline
        const result = await agentMessageProcessor.processMessage(companyId, message, {
            callSid,
            from,
            channel: channel || 'phone',
            testing: false
        });

        // Return simple response for production use
        res.json({
            text: result.text,
            escalate: result.escalate,
            confidence: result.confidence,
            responseMethod: result.responseMethod,
            processingTime: result.processingTime
        });

    } catch (error) {
        console.error('❌ Agent process error:', error);
        res.status(500).json({
            text: "I apologize, but I'm experiencing technical difficulties. Please hold while I connect you to someone who can help.",
            escalate: true,
            confidence: 0,
            responseMethod: 'error-fallback'
        });
    }
});

/**
 * Get agent performance analytics
 * GET /api/agent/analytics/:companyId
 */
router.get('/analytics/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { days = 7 } = req.query;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }

        const db = getDB();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        // Get performance metrics
        const metrics = await db.collection('agent_performance').aggregate([
            {
                $match: {
                    companyId: new ObjectId(companyId),
                    timestamp: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalMessages: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' },
                    avgProcessingTime: { $avg: '$processingTime' },
                    responseMethodCounts: {
                        $push: '$responseMethod'
                    },
                    escalations: {
                        $sum: { $cond: [{ $eq: ['$escalate', true] }, 1, 0] }
                    }
                }
            }
        ]).toArray();

        const result = metrics[0] || {
            totalMessages: 0,
            avgConfidence: 0,
            avgProcessingTime: 0,
            responseMethodCounts: [],
            escalations: 0
        };

        // Count response methods
        const methodCounts = {};
        result.responseMethodCounts.forEach(method => {
            methodCounts[method] = (methodCounts[method] || 0) + 1;
        });

        res.json({
            summary: {
                totalMessages: result.totalMessages,
                avgConfidence: Math.round(result.avgConfidence * 100) / 100,
                avgProcessingTime: Math.round(result.avgProcessingTime),
                escalationRate: result.totalMessages > 0 ? 
                    Math.round((result.escalations / result.totalMessages) * 100) : 0
            },
            responseMethodBreakdown: methodCounts,
            period: `Last ${days} days`
        });

    } catch (error) {
        console.error('❌ Analytics error:', error);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

/**
 * Get test templates for quick testing
 * GET /api/agent/test-templates
 */
router.get('/test-templates', (req, res) => {
    const templates = {
        greeting: {
            message: "Hello, I'm looking for some help with my HVAC system.",
            description: "Basic greeting and service inquiry"
        },
        service_inquiry: {
            message: "My air conditioner isn't cooling properly and it's making weird noises. Can you help?",
            description: "Service issue that should trigger booking flow"
        },
        booking_request: {
            message: "I need to schedule a maintenance appointment for my heating system.",
            description: "Direct booking request"
        },
        pricing_question: {
            message: "How much does it cost to replace a central air conditioning unit?",
            description: "Pricing and cost inquiry"
        },
        emergency: {
            message: "Help! My furnace just stopped working completely and it's freezing in here!",
            description: "Emergency service request"
        },
        complex_technical: {
            message: "My heat pump is short cycling, the refrigerant lines are icing up, and I'm getting error code E3 on the thermostat. The indoor air handler is also making a grinding noise during startup.",
            description: "Complex technical issue requiring expertise"
        }
    };

    res.json(templates);
});

/**
 * Get agent settings (for UI integration)
 * GET /api/agent/settings/:companyId
 */
router.get('/settings/:companyId', async (req, res) => {
    try {
        await ensureProcessorInitialized();
        
        const { companyId } = req.params;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }

        console.log(`⚙️ Loading agent settings for company ${companyId}`);

        // Load settings using the same method as message processor
        const settings = await agentMessageProcessor.loadCompanySettings(companyId);

        res.json(settings);

    } catch (error) {
        console.error('❌ Error loading agent settings:', error);
        res.status(500).json({ error: 'Failed to load agent settings' });
    }
});

/**
 * Save agent settings (for UI integration)
 * PUT /api/agent/settings/:companyId
 */
router.put('/settings/:companyId', async (req, res) => {
    try {
        await ensureProcessorInitialized();
        
        const { companyId } = req.params;
        const settings = req.body;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }

        console.log(`💾 Saving agent settings for company ${companyId}:`, settings);

        // Use Mongoose model to update company settings  
        const updateResult = await Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    agentIntelligenceSettings: settings,
                    updatedAt: new Date()
                } 
            },
            { new: true }
        );

        if (!updateResult) {
            return res.status(404).json({ error: 'Company not found' });
        }

        console.log('✅ Agent settings saved successfully');
        res.json({ success: true, message: 'Agent settings saved successfully' });

    } catch (error) {
        console.error('❌ Error saving agent settings:', error);
        res.status(500).json({ error: 'Failed to save agent settings' });
    }
});

/**
 * Reset agent settings to defaults
 * POST /api/agent/settings/:companyId/reset
 */
router.post('/settings/:companyId/reset', async (req, res) => {
    try {
        await ensureProcessorInitialized();
        
        const { companyId } = req.params;

        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid company ID' });
        }

        console.log(`🔄 Resetting agent settings for company ${companyId}`);

        const defaultSettings = {
            useLLM: true,
            primaryLLM: 'ollama-phi3',
            fallbackLLM: 'gemini-pro',
            allowedLLMs: ['ollama-phi3', 'gemini-pro'],
            memoryMode: 'conversation',
            fallbackThreshold: 0.5,
            escalationMode: 'ask',
            rePromptAfterTurns: 2,
            maxPromptsPerCall: 3,
            semanticSearchEnabled: false,
            confidenceScoring: true,
            autoLearningQueue: false
        };

        // Use Mongoose model to reset settings
        const updateResult = await Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    agentIntelligenceSettings: defaultSettings,
                    updatedAt: new Date()
                } 
            },
            { new: true }
        );

        if (!updateResult) {
            return res.status(404).json({ error: 'Company not found' });
        }

        console.log('✅ Agent settings reset to defaults');
        res.json({ 
            success: true, 
            message: 'Agent settings reset to defaults',
            settings: defaultSettings
        });

    } catch (error) {
        console.error('❌ Error resetting agent settings:', error);
        res.status(500).json({ error: 'Failed to reset agent settings' });
    }
});

module.exports = router;

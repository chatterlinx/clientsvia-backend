/**
 * Intent Routing API Routes
 * Handles multi-tenant AI logic configuration and intent classification
 */

const express = require('express');
const router = express.Router();
const intentRoutingService = require('../services/intentRoutingService');
const winston = require('winston');

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} [${level.toUpperCase()}] [IntentRoutingAPI] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
        })
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/intent-routing-api.log' }),
        new winston.transports.Console()
    ]
});

/**
 * GET /api/agent/intent-routing/:companyId
 * Get intent routing configuration for a company
 */
router.get('/intent-routing/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('Getting intent routing configuration', { companyId });
        
        const result = await intentRoutingService.getIntentRoutingConfig(companyId);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        logger.error('Error in GET intent-routing', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * PUT /api/agent/intent-routing/:companyId
 * Update intent routing configuration for a company
 */
router.put('/intent-routing/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const config = req.body;
        
        logger.info('Updating intent routing configuration', { companyId });
        
        const result = await intentRoutingService.updateIntentRoutingConfig(companyId, config);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        logger.error('Error in PUT intent-routing', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/agent/classify-intent
 * Classify caller intent from input text
 */
router.post('/classify-intent', async (req, res) => {
    try {
        const { companyId, inputText, context } = req.body;
        
        if (!companyId || !inputText) {
            return res.status(400).json({ 
                success: false, 
                error: 'companyId and inputText are required' 
            });
        }
        
        logger.info('Classifying intent', { 
            companyId, 
            inputLength: inputText.length 
        });
        
        const result = await intentRoutingService.classifyIntent(companyId, inputText, context);
        
        res.json(result);
    } catch (error) {
        logger.error('Error in POST classify-intent', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/agent/test-intent-flow
 * Test intent flow with sample input
 */
router.post('/test-intent-flow', async (req, res) => {
    try {
        const { companyId, testInput, scenario } = req.body;
        
        if (!companyId || !testInput) {
            return res.status(400).json({ 
                success: false, 
                error: 'companyId and testInput are required' 
            });
        }
        
        logger.info('Testing intent flow', { 
            companyId, 
            scenario, 
            inputLength: testInput.length 
        });
        
        const result = await intentRoutingService.testIntentFlow(companyId, testInput, scenario);
        
        res.json(result);
    } catch (error) {
        logger.error('Error in POST test-intent-flow', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/agent/validate-intent-flow
 * Validate intent flow configuration
 */
router.post('/validate-intent-flow', async (req, res) => {
    try {
        const { intentFlow } = req.body;
        
        if (!intentFlow) {
            return res.status(400).json({ 
                success: false, 
                error: 'intentFlow is required' 
            });
        }
        
        logger.info('Validating intent flow', { 
            intentCount: intentFlow.length 
        });
        
        const validation = intentRoutingService.validateIntentFlow(intentFlow);
        
        res.json({ 
            success: true, 
            data: validation 
        });
    } catch (error) {
        logger.error('Error in POST validate-intent-flow', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/agent/intent-routing-metrics/:companyId
 * Get performance metrics for intent routing
 */
router.get('/intent-routing-metrics/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeRange } = req.query;
        
        logger.info('Getting intent routing metrics', { companyId, timeRange });
        
        const result = await intentRoutingService.getPerformanceMetrics(companyId, timeRange);
        
        res.json(result);
    } catch (error) {
        logger.error('Error in GET intent-routing-metrics', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * POST /api/agent/reset-intent-flow/:companyId
 * Reset intent flow to default configuration
 */
router.post('/reset-intent-flow/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('Resetting intent flow to default', { companyId });
        
        // Get default configuration
        const defaultConfig = await intentRoutingService.getIntentRoutingConfig(companyId);
        
        if (defaultConfig.success) {
            // Update with default configuration
            const result = await intentRoutingService.updateIntentRoutingConfig(companyId, defaultConfig.data);
            
            res.json({
                success: true,
                data: {
                    message: 'Intent flow reset to default configuration',
                    config: defaultConfig.data
                }
            });
        } else {
            res.status(400).json(defaultConfig);
        }
    } catch (error) {
        logger.error('Error in POST reset-intent-flow', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

/**
 * GET /api/agent/intent-templates
 * Get available intent templates for different business types
 */
router.get('/intent-templates', async (req, res) => {
    try {
        const { businessType } = req.query;
        
        logger.info('Getting intent templates', { businessType });
        
        // Pre-defined templates for different business types
        const templates = {
            hvac: {
                name: 'HVAC & Air Conditioning',
                intents: [
                    {
                        id: 'emergency_service',
                        name: 'Emergency AC/Heating Service',
                        priority: 'high',
                        keywords: ['emergency', 'not working', 'broken', 'no cold air', 'no heat', 'stopped working']
                    },
                    {
                        id: 'maintenance_booking',
                        name: 'Maintenance Scheduling',
                        priority: 'high',
                        keywords: ['maintenance', 'tune-up', 'cleaning', 'inspection', 'preventive']
                    },
                    {
                        id: 'pricing_inquiry',
                        name: 'Pricing & Estimates',
                        priority: 'medium',
                        keywords: ['cost', 'price', 'estimate', 'how much', 'quote']
                    }
                ]
            },
            restaurant: {
                name: 'Restaurant & Food Service',
                intents: [
                    {
                        id: 'reservation',
                        name: 'Table Reservations',
                        priority: 'high',
                        keywords: ['reservation', 'table', 'book', 'tonight', 'tomorrow']
                    },
                    {
                        id: 'hours_menu',
                        name: 'Hours & Menu Info',
                        priority: 'medium',
                        keywords: ['hours', 'open', 'menu', 'specials', 'what time']
                    }
                ]
            },
            medical: {
                name: 'Medical & Healthcare',
                intents: [
                    {
                        id: 'appointment_scheduling',
                        name: 'Appointment Scheduling',
                        priority: 'high',
                        keywords: ['appointment', 'schedule', 'doctor', 'visit', 'check-up']
                    },
                    {
                        id: 'prescription',
                        name: 'Prescription Refills',
                        priority: 'medium',
                        keywords: ['prescription', 'refill', 'medication', 'pharmacy']
                    }
                ]
            }
        };
        
        if (businessType && templates[businessType]) {
            res.json({ success: true, data: templates[businessType] });
        } else {
            res.json({ success: true, data: { templates: Object.keys(templates) } });
        }
    } catch (error) {
        logger.error('Error in GET intent-templates', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;

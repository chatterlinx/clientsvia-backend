/**
 * AI Agent Analytics Routes
 * API endpoints for agent performance analytics and insights
 */

const express = require('express');
const router = express.Router();
const AIAgentAnalyticsService = require('../services/aiAgentAnalytics');
const { authenticateJWT } = require('../middleware/auth');

// Get comprehensive analytics (both paths for compatibility)
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const dateRange = { startDate, endDate };
        
        const analytics = await AIAgentAnalyticsService.getAgentAnalytics(req.params.companyId, dateRange);
        
        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        console.error('Failed to get analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve analytics',
            error: error.message
        });
    }
});

router.get('/analytics/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const dateRange = { startDate, endDate };
        
        const analytics = await AIAgentAnalyticsService.getAgentAnalytics(req.params.companyId, dateRange);
        
        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        console.error('Failed to get analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve analytics',
            error: error.message
        });
    }
});

// Get real-time metrics
router.get('/metrics/:companyId/realtime', authenticateJWT, async (req, res) => {
    try {
        const metrics = await AIAgentAnalyticsService.getRealTimeMetrics(req.params.companyId);
        
        res.json({
            success: true,
            metrics: metrics
        });
    } catch (error) {
        console.error('Failed to get real-time metrics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve real-time metrics',
            error: error.message
        });
    }
});

// Get insights and recommendations
router.get('/insights/:companyId', authenticateJWT, async (req, res) => {
    try {
        const insights = await AIAgentAnalyticsService.getInsights(req.params.companyId);
        
        res.json({
            success: true,
            insights: insights.insights
        });
    } catch (error) {
        console.error('Failed to get insights:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve insights',
            error: error.message
        });
    }
});

// Export analytics data
router.get('/export/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { format = 'csv', startDate, endDate } = req.query;
        const dateRange = { startDate, endDate };
        
        const exportData = await AIAgentAnalyticsService.exportAnalytics(
            req.params.companyId, 
            format, 
            dateRange
        );
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="agent-analytics-${new Date().toISOString().split('T')[0]}.csv"`);
            res.send(exportData);
        } else {
            res.json({
                success: true,
                data: exportData
            });
        }
    } catch (error) {
        console.error('Failed to export analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export analytics',
            error: error.message
        });
    }
});

// Get performance benchmarks
router.get('/benchmarks', authenticateJWT, async (req, res) => {
    try {
        const benchmarks = {
            industry: {
                responseTime: 2.0,
                completionRate: 80,
                appointmentBooking: 75,
                customerSatisfaction: 4.0
            },
            targets: {
                responseTime: 1.5,
                completionRate: 90,
                appointmentBooking: 85,
                customerSatisfaction: 4.5
            },
            competitive: {
                highlevel: {
                    responseTime: 1.8,
                    completionRate: 85,
                    appointmentBooking: 80,
                    customerSatisfaction: 4.2
                }
            }
        };
        
        res.json({
            success: true,
            benchmarks: benchmarks
        });
    } catch (error) {
        console.error('Failed to get benchmarks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve benchmarks',
            error: error.message
        });
    }
});

// A/B Testing endpoints (for frontend compatibility)
router.get('/:companyId/ab-tests', authenticateJWT, async (req, res) => {
    try {
        // Mock A/B testing data for now
        const abTests = {
            active: [],
            completed: [],
            draft: []
        };
        
        res.json({
            success: true,
            abTests: abTests
        });
    } catch (error) {
        console.error('Failed to get A/B tests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve A/B tests',
            error: error.message
        });
    }
});

// Personalization endpoints (for frontend compatibility)  
router.get('/:companyId/personalization', authenticateJWT, async (req, res) => {
    try {
        // Mock personalization data for now
        const personalization = {
            rules: [],
            segments: [],
            campaigns: []
        };
        
        res.json({
            success: true,
            personalization: personalization
        });
    } catch (error) {
        console.error('Failed to get personalization:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve personalization',
            error: error.message
        });
    }
});

module.exports = router;

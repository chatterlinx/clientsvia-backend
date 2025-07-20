// routes/monitoring.js
// API endpoints for the agent monitoring system and health checks

const express = require('express');
const router = express.Router();
const agentMonitoring = require('../services/agentMonitoring');
const Company = require('../models/Company');

console.log('🔧 Loading monitoring routes...');

// In-memory storage for monitoring data (in production, use Redis or database)
const monitoringData = {
    healthChecks: [],
    componentStatus: {},
    renderLogs: [],
    performanceMetrics: {},
    sessions: {}
};

/**
 * Health Check Endpoints
 */

// Basic health check endpoint
router.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    };
    
    res.json(health);
});

// Database health check
router.get('/health/database', async (req, res) => {
    try {
        // Try to query the database
        await Company.findOne().limit(1);
        
        res.json({
            status: 'healthy',
            database: 'connected',
            responseTime: Date.now() % 100, // Simulated response time
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Submit self-check results
router.post('/self-check', (req, res) => {
    try {
        const checkData = {
            ...req.body,
            serverTimestamp: new Date().toISOString(),
            id: `check_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        };
        
        // Store health check data
        monitoringData.healthChecks.push(checkData);
        
        // Keep only last 100 checks per company
        const companyChecks = monitoringData.healthChecks.filter(
            check => check.companyId === checkData.companyId
        );
        
        if (companyChecks.length > 100) {
            const toRemove = companyChecks.slice(0, companyChecks.length - 100);
            toRemove.forEach(check => {
                const index = monitoringData.healthChecks.indexOf(check);
                if (index > -1) {
                    monitoringData.healthChecks.splice(index, 1);
                }
            });
        }
        
        // Update component status
        if (checkData.components) {
            monitoringData.componentStatus[checkData.companyId] = {
                ...checkData.components,
                lastUpdate: new Date().toISOString()
            };
        }
        
        // Store session info
        if (checkData.sessionId) {
            monitoringData.sessions[checkData.sessionId] = {
                companyId: checkData.companyId,
                lastActivity: new Date().toISOString(),
                checkCount: (monitoringData.sessions[checkData.sessionId]?.checkCount || 0) + 1
            };
        }
        
        res.json({
            success: true,
            checkId: checkData.id,
            message: 'Self-check data recorded',
            timestamp: checkData.serverTimestamp
        });
        
    } catch (error) {
        console.error('❌ Error storing self-check data:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get self-check history for a company
router.get('/self-check/:companyId', (req, res) => {
    try {
        const { companyId } = req.params;
        const { limit = 20 } = req.query;
        
        const companyChecks = monitoringData.healthChecks
            .filter(check => check.companyId === companyId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, parseInt(limit));
        
        res.json({
            companyId,
            checks: companyChecks,
            totalChecks: companyChecks.length,
            latestStatus: companyChecks[0]?.status || 'unknown'
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get current component status for a company
router.get('/components/:companyId', (req, res) => {
    try {
        const { companyId } = req.params;
        const componentStatus = monitoringData.componentStatus[companyId];
        
        if (componentStatus) {
            res.json({
                companyId,
                components: componentStatus,
                found: true
            });
        } else {
            res.json({
                companyId,
                components: {},
                found: false,
                message: 'No component status data available'
            });
        }
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Agent Monitoring Endpoints (existing)
 */

// Get monitoring dashboard data
router.get('/dashboard/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Validate company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get pending reviews count
        const pendingReviews = await agentMonitoring.getPendingReviewsCount(companyId);
        
        // Get flagged interactions count
        const flaggedInteractions = await agentMonitoring.getFlaggedInteractionsCount(companyId);
        
        // Get approval rate
        const approvalRate = await agentMonitoring.getApprovalRate(companyId);
        
        // Get recent activity
        const recentActivity = await agentMonitoring.getRecentActivity(companyId, 10);
        
        // Get analytics
        const analytics = await agentMonitoring.getAnalytics(companyId, 7); // Last 7 days
        
        res.json({
            companyName: company.name,
            pendingReviews,
            flaggedInteractions,
            approvalRate,
            recentActivity,
            analytics
        });
    } catch (error) {
        console.error('Error getting monitoring dashboard data:', error);
        res.status(500).json({ error: 'Failed to get monitoring data' });
    }
});

// Get pending interactions for review
router.get('/pending/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        const interactions = await agentMonitoring.getPendingInteractions(companyId, page, limit);
        res.json(interactions);
    } catch (error) {
        console.error('Error getting pending interactions:', error);
        res.status(500).json({ error: 'Failed to get pending interactions' });
    }
});

// Get flagged interactions
router.get('/flagged/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        const interactions = await agentMonitoring.getFlaggedInteractions(companyId, page, limit);
        res.json(interactions);
    } catch (error) {
        console.error('Error getting flagged interactions:', error);
        res.status(500).json({ error: 'Failed to get flagged interactions' });
    }
});

// Approve an interaction
router.post('/approve/:interactionId', async (req, res) => {
    try {
        const { interactionId } = req.params;
        const { companyId } = req.body;
        
        const result = await agentMonitoring.approveInteraction(interactionId, companyId);
        
        if (result.success) {
            res.json({ success: true, message: 'Interaction approved successfully' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error approving interaction:', error);
        res.status(500).json({ error: 'Failed to approve interaction' });
    }
});

// Disapprove an interaction
router.post('/disapprove/:interactionId', async (req, res) => {
    try {
        const { interactionId } = req.params;
        const { companyId, reason } = req.body;
        
        const result = await agentMonitoring.disapproveInteraction(interactionId, companyId, reason);
        
        if (result.success) {
            res.json({ success: true, message: 'Interaction disapproved and blacklisted' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error disapproving interaction:', error);
        res.status(500).json({ error: 'Failed to disapprove interaction' });
    }
});

// Update monitoring configuration
router.post('/config/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const config = req.body;
        
        const result = await agentMonitoring.updateMonitoringConfig(companyId, config);
        
        if (result.success) {
            res.json({ success: true, message: 'Configuration updated successfully' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error updating monitoring config:', error);
        res.status(500).json({ error: 'Failed to update configuration' });
    }
});

// Get monitoring configuration
router.get('/config/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const config = await agentMonitoring.getMonitoringConfig(companyId);
        res.json(config);
    } catch (error) {
        console.error('Error getting monitoring config:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

// Export monitoring data
router.get('/export/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const format = req.query.format || 'csv';
        const days = parseInt(req.query.days) || 30;
        
        const data = await agentMonitoring.exportMonitoringData(companyId, days, format);
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="monitoring-data-${companyId}.csv"`);
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="monitoring-data-${companyId}.json"`);
        }
        
        res.send(data);
    } catch (error) {
        console.error('Error exporting monitoring data:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Get interaction details
router.get('/interaction/:interactionId', async (req, res) => {
    try {
        const { interactionId } = req.params;
        const interaction = await agentMonitoring.getInteractionDetails(interactionId);
        
        if (interaction) {
            res.json(interaction);
        } else {
            res.status(404).json({ error: 'Interaction not found' });
        }
    } catch (error) {
        console.error('Error getting interaction details:', error);
        res.status(500).json({ error: 'Failed to get interaction details' });
    }
});

// Edit interaction response
router.put('/interaction/:interactionId', async (req, res) => {
    try {
        const { interactionId } = req.params;
        const { newResponse, companyId } = req.body;
        
        const result = await agentMonitoring.editInteractionResponse(interactionId, newResponse, companyId);
        
        if (result.success) {
            res.json({ success: true, message: 'Interaction updated successfully' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error editing interaction:', error);
        res.status(500).json({ error: 'Failed to edit interaction' });
    }
});

// Get monitoring analytics
router.get('/analytics/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const days = parseInt(req.query.days) || 7;
        
        const analytics = await agentMonitoring.getDetailedAnalytics(companyId, days);
        res.json(analytics);
    } catch (error) {
        console.error('Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});

// Real-time monitoring status
router.get('/status/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const status = await agentMonitoring.getMonitoringStatus(companyId);
        res.json(status);
    } catch (error) {
        console.error('Error getting monitoring status:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// Webhook for real-time updates (if using WebSocket alternative)
router.post('/webhook/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const event = req.body;
        
        // Process the webhook event
        await agentMonitoring.processWebhookEvent(companyId, event);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Failed to process webhook' });
    }
});

console.log('✅ Monitoring routes loaded successfully');

module.exports = router;

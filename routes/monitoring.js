// routes/monitoring.js
// API endpoints for the agent monitoring system

const express = require('express');
const router = express.Router();
const agentMonitoring = require('../services/agentMonitoring');

// Get monitoring dashboard data
router.get('/dashboard/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
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

module.exports = router;

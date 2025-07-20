// routes/transfer.js
// API routes for intelligent call transfer routing

const express = require('express');
const router = express.Router();
const TransferRouter = require('../services/transferRouter');
const moment = require('moment');

// In-memory personnel cache (use database in production)
let personnelConfig = require('../config/personnelConfig.json');

// Initialize transfer router
const transferRouter = new TransferRouter(personnelConfig);

// Get transfer recommendation based on customer query
router.post('/resolve', (req, res) => {
    try {
        const { query, timestamp } = req.body;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query is required'
            });
        }
        
        const now = timestamp ? moment(timestamp) : moment();
        const result = transferRouter.findBestTransferOption(query, now);
        
        res.json({
            success: true,
            query,
            timestamp: now.toISOString(),
            ...result
        });
    } catch (error) {
        console.error('[Transfer API] Error resolving transfer:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve transfer'
        });
    }
});

// Get specific personnel information
router.get('/personnel/:role', (req, res) => {
    try {
        const { role } = req.params;
        
        const escalation = transferRouter.getEscalationPolicy(role);
        
        if (!escalation) {
            return res.status(404).json({
                success: false,
                error: 'Personnel not found for role'
            });
        }
        
        res.json({
            success: true,
            role,
            ...escalation
        });
    } catch (error) {
        console.error('[Transfer API] Error getting personnel:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get personnel information'
        });
    }
});

// Get transfer statistics
router.get('/stats', (req, res) => {
    try {
        const { timestamp } = req.query;
        const now = timestamp ? moment(timestamp) : moment();
        
        const stats = transferRouter.getTransferStats(now);
        
        res.json({
            success: true,
            timestamp: now.toISOString(),
            timeOfDay: now.format('dddd, MMMM Do YYYY, h:mm A'),
            ...stats
        });
    } catch (error) {
        console.error('[Transfer API] Error getting stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get transfer statistics'
        });
    }
});

// Get all personnel configuration
router.get('/personnel', (req, res) => {
    try {
        const { includeContact } = req.query;
        
        let personnel = personnelConfig.map(person => ({
            label: person.label,
            name: person.name,
            roles: person.roles,
            allowDirectTransfer: person.allowDirectTransfer,
            hours: person.hours
        }));
        
        // Include contact info if requested (admin only in production)
        if (includeContact === 'true') {
            personnel = personnelConfig;
        }
        
        res.json({
            success: true,
            personnel,
            count: personnel.length
        });
    } catch (error) {
        console.error('[Transfer API] Error getting personnel:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get personnel list'
        });
    }
});

// Update personnel configuration (admin only)
router.put('/personnel', (req, res) => {
    try {
        const { personnel } = req.body;
        
        if (!Array.isArray(personnel)) {
            return res.status(400).json({
                success: false,
                error: 'Personnel must be an array'
            });
        }
        
        // Validate personnel structure
        for (const person of personnel) {
            if (!person.name || !person.roles || !Array.isArray(person.roles)) {
                return res.status(400).json({
                    success: false,
                    error: 'Each person must have name and roles array'
                });
            }
        }
        
        // Update configuration
        personnelConfig = personnel;
        
        // Reinitialize transfer router with new config
        transferRouter.personnel = personnelConfig;
        
        console.log('[Transfer API] Updated personnel configuration');
        
        res.json({
            success: true,
            message: 'Personnel configuration updated',
            count: personnel.length
        });
    } catch (error) {
        console.error('[Transfer API] Error updating personnel:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update personnel configuration'
        });
    }
});

// Test transfer scenarios
router.post('/test', (req, res) => {
    try {
        const { queries, timestamp } = req.body;
        
        if (!Array.isArray(queries)) {
            return res.status(400).json({
                success: false,
                error: 'Queries must be an array'
            });
        }
        
        const now = timestamp ? moment(timestamp) : moment();
        
        const results = queries.map(query => ({
            query,
            result: transferRouter.findBestTransferOption(query, now)
        }));
        
        res.json({
            success: true,
            timestamp: now.toISOString(),
            testResults: results,
            stats: transferRouter.getTransferStats(now)
        });
    } catch (error) {
        console.error('[Transfer API] Error testing transfers:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test transfer scenarios'
        });
    }
});

// Health check
router.get('/health', (req, res) => {
    try {
        const stats = transferRouter.getTransferStats();
        
        res.json({
            success: true,
            status: 'healthy',
            personnelCount: stats.totalPersonnel,
            availableNow: stats.available,
            timestamp: moment().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

module.exports = router;

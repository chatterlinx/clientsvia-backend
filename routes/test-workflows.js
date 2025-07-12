// routes/test-workflows.js
// Simple test endpoint to create sample workflow data

const express = require('express');
const router = express.Router();
const Workflow = require('../models/Workflow');

// POST /api/test-workflows/create - Create sample workflows
router.post('/create/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`Creating test workflows for company: ${companyId}`);
        
        // Create sample workflows
        const workflows = [
            {
                name: 'New Customer Welcome Call',
                description: 'Automated workflow to follow up with new customers within 24 hours',
                companyId: companyId,
                category: 'customer_service',
                status: 'active',
                triggers: [{
                    type: 'manual',
                    enabled: true,
                    conditions: []
                }],
                steps: [],
                analytics: {
                    totalExecutions: 5,
                    successfulExecutions: 4,
                    failedExecutions: 1,
                    averageExecutionTime: 45000,
                    lastExecuted: new Date(Date.now() - 2 * 60 * 60 * 1000)
                },
                metadata: {
                    createdBy: 'admin',
                    version: '1.0'
                }
            },
            {
                name: 'Appointment Reminder SMS',
                description: 'Send SMS reminders to customers 24 hours before their appointment',
                companyId: companyId,
                category: 'scheduling',
                status: 'active',
                triggers: [{
                    type: 'schedule',
                    enabled: true,
                    conditions: [{ field: 'appointment_time', operator: 'minus', value: '24h' }]
                }],
                steps: [],
                analytics: {
                    totalExecutions: 12,
                    successfulExecutions: 11,
                    failedExecutions: 1,
                    averageExecutionTime: 15000,
                    lastExecuted: new Date(Date.now() - 30 * 60 * 1000)
                },
                metadata: {
                    createdBy: 'admin',
                    version: '1.1'
                }
            },
            {
                name: 'Service Follow-up Survey',
                description: 'Send follow-up survey 3 days after service completion',
                companyId: companyId,
                category: 'feedback',
                status: 'pending',
                triggers: [{
                    type: 'webhook',
                    enabled: true,
                    conditions: [{ field: 'service_status', operator: 'equals', value: 'completed' }]
                }],
                steps: [],
                analytics: {
                    totalExecutions: 8,
                    successfulExecutions: 7,
                    failedExecutions: 1,
                    averageExecutionTime: 30000,
                    lastExecuted: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                metadata: {
                    createdBy: 'admin',
                    version: '1.0'
                }
            }
        ];

        const createdWorkflows = await Workflow.insertMany(workflows);
        
        res.json({
            success: true,
            message: `Created ${createdWorkflows.length} test workflows`,
            workflows: createdWorkflows
        });
        
    } catch (error) {
        console.error('Error creating test workflows:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create test workflows',
            error: error.message
        });
    }
});

module.exports = router;

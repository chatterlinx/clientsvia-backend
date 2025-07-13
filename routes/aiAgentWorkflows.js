/**
 * AI Agent Setup Routes - Workflow Actions
 * Backend API for handling call workflows and actions
 */

const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { auth } = require('../middleware/auth');

// Get workflow configuration
router.get('/workflows/:companyId', auth, async (req, res) => {
    try {
        const company = await Company.findById(req.params.companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const workflows = {
            duringCallActions: company.agentSetup?.duringCallActions || [],
            afterCallActions: company.agentSetup?.afterCallActions || [],
            callSettings: company.agentSetup?.callSettings || {
                timeLimit: 10,
                responseSpeed: 'normal',
                idleTimeReminder: true,
                idleTime: 8,
                emailNotifications: true
            }
        };

        res.json(workflows);
    } catch (error) {
        console.error('Error fetching workflows:', error);
        res.status(500).json({ error: 'Failed to fetch workflows' });
    }
});

// Save workflow configuration
router.post('/workflows/:companyId', auth, async (req, res) => {
    try {
        const { duringCallActions, afterCallActions, callSettings } = req.body;
        
        const company = await Company.findById(req.params.companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        // Validate actions
        const validatedDuringActions = validateActions(duringCallActions);
        const validatedAfterActions = validateActions(afterCallActions);
        const validatedCallSettings = validateCallSettings(callSettings);

        // Update company configuration
        if (!company.agentSetup) {
            company.agentSetup = {};
        }

        company.agentSetup.duringCallActions = validatedDuringActions;
        company.agentSetup.afterCallActions = validatedAfterActions;
        company.agentSetup.callSettings = validatedCallSettings;
        company.agentSetup.lastUpdated = new Date();

        await company.save();

        res.json({
            success: true,
            message: 'Workflow configuration saved successfully',
            workflows: {
                duringCallActions: validatedDuringActions,
                afterCallActions: validatedAfterActions,
                callSettings: validatedCallSettings
            }
        });
    } catch (error) {
        console.error('Error saving workflows:', error);
        res.status(500).json({ error: 'Failed to save workflows' });
    }
});

// Test workflow action
router.post('/workflows/:companyId/test', auth, async (req, res) => {
    try {
        const { actionId, actionType, testData } = req.body;
        
        // Simulate workflow action execution
        const result = await simulateWorkflowAction(actionType, testData);
        
        res.json({
            success: true,
            message: `${actionType} action tested successfully`,
            result: result
        });
    } catch (error) {
        console.error('Error testing workflow:', error);
        res.status(500).json({ error: 'Failed to test workflow action' });
    }
});

// Get workflow analytics
router.get('/workflows/:companyId/analytics', auth, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
        // This would integrate with your call analytics system
        const analytics = await getWorkflowAnalytics(req.params.companyId, startDate, endDate);
        
        res.json(analytics);
    } catch (error) {
        console.error('Error fetching workflow analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// Helper functions
function validateActions(actions) {
    return (actions || []).map(action => {
        const validatedAction = {
            id: action.id || Date.now(),
            name: action.name || 'Unnamed Action',
            type: action.type,
            trigger: action.trigger || 'Manual',
            enabled: action.enabled !== false
        };

        // Validate type-specific configurations
        switch (action.type) {
            case 'extract-data':
                validatedAction.field = action.field || 'notes';
                validatedAction.validation = action.validation || 'optional';
                break;
            case 'call-transfer':
                validatedAction.phoneNumber = action.phoneNumber || '';
                validatedAction.department = action.department || '';
                break;
            case 'send-sms':
                validatedAction.message = action.message || '';
                validatedAction.recipients = action.recipients || ['customer'];
                break;
            case 'email-notification':
                validatedAction.template = action.template || 'default';
                validatedAction.recipients = action.recipients || ['admin'];
                break;
            case 'trigger-workflow':
                validatedAction.workflowId = action.workflowId || '';
                validatedAction.delay = action.delay || 0;
                break;
            case 'book-appointment':
                validatedAction.serviceType = action.serviceType || 'general';
                validatedAction.duration = action.duration || 60;
                break;
            case 'update-contact':
                validatedAction.field = action.field || 'notes';
                validatedAction.value = action.value || '';
                break;
        }

        return validatedAction;
    });
}

function validateCallSettings(settings) {
    return {
        timeLimit: Math.min(Math.max(parseInt(settings?.timeLimit) || 10, 5), 15),
        responseSpeed: ['normal', 'brisk', 'fast'].includes(settings?.responseSpeed) ? settings.responseSpeed : 'normal',
        idleTimeReminder: Boolean(settings?.idleTimeReminder),
        idleTime: Math.min(Math.max(parseInt(settings?.idleTime) || 8, 1), 20),
        emailNotifications: Boolean(settings?.emailNotifications),
        notificationRecipients: {
            allAdmins: Boolean(settings?.notificationRecipients?.allAdmins),
            allUsers: Boolean(settings?.notificationRecipients?.allUsers),
            assignedUser: Boolean(settings?.notificationRecipients?.assignedUser),
            customEmails: settings?.notificationRecipients?.customEmails || []
        }
    };
}

async function simulateWorkflowAction(actionType, testData) {
    // Simulate different action types for testing
    switch (actionType) {
        case 'call-transfer':
            return {
                action: 'Call Transfer',
                status: 'Simulated',
                message: `Would transfer call to ${testData.phoneNumber || 'configured number'}`,
                duration: '2.3 seconds'
            };
        case 'send-sms':
            return {
                action: 'Send SMS',
                status: 'Simulated',
                message: `Would send SMS: "${testData.message || 'Test message'}"`,
                recipient: testData.recipient || 'customer'
            };
        case 'extract-data':
            return {
                action: 'Extract Data',
                status: 'Simulated',
                message: `Would extract and store ${testData.field || 'customer data'}`,
                confidence: '95%'
            };
        case 'email-notification':
            return {
                action: 'Email Notification',
                status: 'Simulated',
                message: `Would send email notification to ${testData.recipients?.join(', ') || 'configured recipients'}`,
                template: testData.template || 'default'
            };
        default:
            return {
                action: actionType,
                status: 'Simulated',
                message: `Would execute ${actionType} action`,
                note: 'This is a simulation for testing purposes'
            };
    }
}

async function getWorkflowAnalytics(companyId, startDate, endDate) {
    // This would integrate with your actual analytics system
    // For now, return simulated data matching HighLevel's format
    return {
        totalCalls: 190,
        actionsTriggered: 100,
        sentiment: {
            positive: 58,
            neutral: 30,
            negative: 12
        },
        averageCallDuration: 0.5,
        callDurationTrend: {
            total: 95, // minutes
            average: 0.5,
            changeFromLastMonth: -17
        },
        actionBreakdown: {
            'call-transfer': 45,
            'extract-data': 32,
            'send-sms': 15,
            'email-notification': 8
        },
        monthlyTrend: [
            { date: '2025-07-01', calls: 16, actions: 8 },
            { date: '2025-07-02', calls: 15, actions: 7 },
            { date: '2025-07-03', calls: 23, actions: 12 },
            { date: '2025-07-04', calls: 0, actions: 0 },
            { date: '2025-07-05', calls: 5, actions: 3 },
            { date: '2025-07-06', calls: 6, actions: 4 },
            { date: '2025-07-07', calls: 3, actions: 2 },
            { date: '2025-07-08', calls: 28, actions: 15 },
            { date: '2025-07-09', calls: 15, actions: 8 },
            { date: '2025-07-10', calls: 15, actions: 8 },
            { date: '2025-07-11', calls: 29, actions: 16 },
            { date: '2025-07-12', calls: 20, actions: 11 },
            { date: '2025-07-13', calls: 8, actions: 4 }
        ]
    };
}

module.exports = router;

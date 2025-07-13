// routes/scheduler.js
// Workflow Scheduler API - Manage scheduled workflows and recurring automations

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const Joi = require('joi');
const { SchedulerService } = require('../services/schedulerService');

// Validation Schemas
const scheduleWorkflowSchema = Joi.object({
    workflowId: Joi.string().required(),
    schedule: Joi.object({
        cronExpression: Joi.string().required(),
        timezone: Joi.string().default('America/New_York'),
        enabled: Joi.boolean().default(true),
        description: Joi.string()
    }).required(),
    context: Joi.object().default({})
});

const createRecurringSchema = Joi.object({
    name: Joi.string().required(),
    workflowTemplate: Joi.object({
        steps: Joi.array().required(),
        variables: Joi.object().default({})
    }).required(),
    schedule: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'hourly').required(),
        time: Joi.string().pattern(/^\d{2}:\d{2}$/).default('09:00'),
        dayOfWeek: Joi.number().min(0).max(6),
        dayOfMonth: Joi.number().min(1).max(31),
        timezone: Joi.string().default('America/New_York')
    }).required(),
    targetCriteria: Joi.object().default({})
});

const scheduleFollowUpSchema = Joi.object({
    workflowId: Joi.string().required(),
    delayMinutes: Joi.number().min(1).max(10080).required(), // Max 1 week
    context: Joi.object().default({})
});

/**
 * POST /api/scheduler/schedule
 * Schedule a workflow to run at specific times
 */
router.post('/schedule', authenticateJWT, validate(scheduleWorkflowSchema), async (req, res) => {
    try {
        const { workflowId, schedule, context } = req.body;
        
        // Add company context
        const scheduleContext = {
            ...context,
            companyId: req.user.companyId,
            scheduledBy: req.user._id
        };
        
        const jobId = await SchedulerService.scheduleWorkflow(workflowId, schedule, scheduleContext);
        
        res.json({
            success: true,
            jobId,
            message: 'Workflow scheduled successfully',
            schedule
        });
        
    } catch (error) {
        console.error('Error scheduling workflow:', error);
        res.status(500).json({ error: 'Failed to schedule workflow' });
    }
});

/**
 * POST /api/scheduler/follow-up
 * Schedule a follow-up workflow with delay
 */
router.post('/follow-up', authenticateJWT, validate(scheduleFollowUpSchema), async (req, res) => {
    try {
        const { workflowId, delayMinutes, context } = req.body;
        
        const scheduleContext = {
            ...context,
            companyId: req.user.companyId,
            scheduledBy: req.user._id
        };
        
        const executeAt = await SchedulerService.scheduleFollowUp(workflowId, delayMinutes, scheduleContext);
        
        res.json({
            success: true,
            message: `Follow-up scheduled for ${delayMinutes} minutes`,
            executeAt,
            delayMinutes
        });
        
    } catch (error) {
        console.error('Error scheduling follow-up:', error);
        res.status(500).json({ error: 'Failed to schedule follow-up' });
    }
});

/**
 * POST /api/scheduler/recurring
 * Create recurring workflow
 */
router.post('/recurring', authenticateJWT, validate(createRecurringSchema), async (req, res) => {
    try {
        const { name, workflowTemplate, schedule, targetCriteria } = req.body;
        
        const recurringConfig = {
            name,
            companyId: req.user.companyId,
            workflowTemplate,
            schedule,
            targetCriteria,
            createdBy: req.user._id
        };
        
        const result = await SchedulerService.createRecurringWorkflow(recurringConfig);
        
        res.json({
            success: true,
            message: 'Recurring workflow created successfully',
            workflowId: result.workflowId,
            jobId: result.jobId,
            schedule
        });
        
    } catch (error) {
        console.error('Error creating recurring workflow:', error);
        res.status(500).json({ error: 'Failed to create recurring workflow' });
    }
});

/**
 * GET /api/scheduler/scheduled
 * Get all scheduled workflows for company
 */
router.get('/scheduled', authenticateJWT, async (req, res) => {
    try {
        const scheduledWorkflows = SchedulerService.getScheduledWorkflows();
        
        // Filter by company (if needed based on workflow ownership)
        res.json({
            scheduledWorkflows,
            total: scheduledWorkflows.length
        });
        
    } catch (error) {
        console.error('Error fetching scheduled workflows:', error);
        res.status(500).json({ error: 'Failed to fetch scheduled workflows' });
    }
});

/**
 * DELETE /api/scheduler/cancel/:jobId
 * Cancel a scheduled workflow
 */
router.delete('/cancel/:jobId', authenticateJWT, async (req, res) => {
    try {
        const { jobId } = req.params;
        
        const cancelled = SchedulerService.cancelScheduledWorkflow(jobId);
        
        if (cancelled) {
            res.json({
                success: true,
                message: 'Scheduled workflow cancelled successfully'
            });
        } else {
            res.status(404).json({ error: 'Scheduled workflow not found' });
        }
        
    } catch (error) {
        console.error('Error cancelling scheduled workflow:', error);
        res.status(500).json({ error: 'Failed to cancel scheduled workflow' });
    }
});

/**
 * GET /api/scheduler/cron-examples
 * Get cron expression examples and builder helper
 */
router.get('/cron-examples', authenticateJWT, async (req, res) => {
    try {
        const cronExamples = {
            'Every day at 9 AM': '0 9 * * *',
            'Every Monday at 8:30 AM': '30 8 * * 1',
            'Every hour': '0 * * * *',
            'Every 15 minutes': '*/15 * * * *',
            'First day of month at 9 AM': '0 9 1 * *',
            'Every weekday at 5 PM': '0 17 * * 1-5',
            'Every Sunday at 6 PM': '0 18 * * 0'
        };
        
        const frequencies = {
            daily: { description: 'Once per day', example: '0 9 * * *' },
            weekly: { description: 'Once per week', example: '0 9 * * 1' },
            monthly: { description: 'Once per month', example: '0 9 1 * *' },
            hourly: { description: 'Once per hour', example: '0 * * * *' }
        };
        
        res.json({
            cronExamples,
            frequencies,
            helper: {
                format: 'minute hour day month dayOfWeek',
                ranges: {
                    minute: '0-59',
                    hour: '0-23',
                    day: '1-31',
                    month: '1-12',
                    dayOfWeek: '0-6 (0=Sunday)'
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching cron examples:', error);
        res.status(500).json({ error: 'Failed to fetch cron examples' });
    }
});

/**
 * POST /api/scheduler/test-schedule
 * Test a cron expression
 */
router.post('/test-schedule', authenticateJWT, async (req, res) => {
    try {
        const { cronExpression } = req.body;
        
        if (!cronExpression) {
            return res.status(400).json({ error: 'Cron expression is required' });
        }
        
        const cron = require('node-cron');
        
        // Validate cron expression
        const isValid = cron.validate(cronExpression);
        
        if (!isValid) {
            return res.status(400).json({ 
                error: 'Invalid cron expression',
                valid: false 
            });
        }
        
        // Get next few execution times
        const cronSchedule = require('node-cron');
        const nextExecutions = [];
        
        // This is a simplified example - you'd use a proper cron parser for real next execution times
        res.json({
            valid: true,
            cronExpression,
            message: 'Cron expression is valid',
            nextExecutions: [
                'This would show next 5 execution times',
                'Use a proper cron parser library for actual implementation'
            ]
        });
        
    } catch (error) {
        console.error('Error testing cron expression:', error);
        res.status(500).json({ error: 'Failed to test cron expression' });
    }
});

module.exports = router;

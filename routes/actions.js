// routes/actions.js
// Action Management API - Create and manage workflow actions
// Building blocks for automation workflows

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const Joi = require('joi');

const Action = require('../models/Action');
const { ActionService } = require('../services/actionService');

// Validation Schemas
const createActionSchema = Joi.object({
    name: Joi.string().required().trim(),
    description: Joi.string().trim(),
    type: Joi.string().valid(
        // Communication
        'send_sms', 'send_email', 'make_call', 'send_voicemail',
        // Scheduling
        'book_appointment', 'send_calendar_invite', 'reschedule_appointment',
        // Contact Management
        'create_contact', 'update_contact', 'add_tag', 'remove_tag',
        // Data & Intelligence
        'extract_data', 'ai_analysis', 'sentiment_analysis',
        // Integrations
        'webhook', 'api_call',
        // Service Management
        'create_service_request',
        // Workflow Control
        'wait', 'condition'
    ).required(),
    category: Joi.string().valid(
        'communication', 'scheduling', 'contact_management', 
        'data_intelligence', 'integrations', 'service_management', 
        'workflow_control'
    ).required(),
    config: Joi.object().required(),
    conditions: Joi.array().items(Joi.object({
        field: Joi.string().required(),
        operator: Joi.string().valid('equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'exists', 'not_exists', 'in', 'not_in').required(),
        value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean(), Joi.array())
    })),
    retryPolicy: Joi.object({
        maxRetries: Joi.number().min(0).max(10).default(3),
        retryDelay: Joi.number().min(100).default(1000),
        backoffMultiplier: Joi.number().min(1).default(2)
    }),
    timeout: Joi.number().min(1000).max(300000).default(30000), // 30 seconds default
    tags: Joi.array().items(Joi.string().trim())
});

const testActionSchema = Joi.object({
    context: Joi.object(),
    testData: Joi.object()
});

// Routes

/**
 * GET /api/actions
 * Get all actions for company
 */
router.get('/', authenticateJWT, async (req, res) => {
    try {
        const { page = 1, limit = 20, type, category, search } = req.query;
        const query = { companyId: req.user.companyId };
        
        if (type) {
            query.type = type;
        }
        
        if (category) {
            query.category = category;
        }
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { tags: { $in: [new RegExp(search, 'i')] } }
            ];
        }
        
        const actions = await Action.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);
            
        const total = await Action.countDocuments(query);
        
        res.json({
            actions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('Error fetching actions:', error);
        res.status(500).json({ error: 'Failed to fetch actions' });
    }
});

/**
 * GET /api/actions/types
 * Get available action types and their schemas
 */
router.get('/types', authenticateJWT, async (req, res) => {
    try {
        const actionTypes = {
            communication: {
                send_sms: {
                    name: 'Send SMS',
                    description: 'Send text message to contact',
                    configSchema: {
                        messageTemplate: 'string (required)',
                        phoneNumber: 'string (optional - uses context.contact.phone if not provided)',
                        fromNumber: 'string (optional)'
                    }
                },
                send_email: {
                    name: 'Send Email',
                    description: 'Send email to contact',
                    configSchema: {
                        subject: 'string (required)',
                        messageTemplate: 'string (required)',
                        emailAddress: 'string (optional - uses context.contact.email if not provided)',
                        fromEmail: 'string (optional)',
                        attachments: 'array (optional)'
                    }
                },
                make_call: {
                    name: 'Make Call',
                    description: 'Initiate phone call to contact',
                    configSchema: {
                        phoneNumber: 'string (optional - uses context.contact.phone if not provided)',
                        scriptTemplate: 'string (optional)',
                        recordCall: 'boolean (default: false)'
                    }
                },
                send_voicemail: {
                    name: 'Send Voicemail',
                    description: 'Send voicemail message to contact',
                    configSchema: {
                        messageTemplate: 'string (required)',
                        phoneNumber: 'string (optional)',
                        voice: 'string (optional)'
                    }
                }
            },
            scheduling: {
                book_appointment: {
                    name: 'Book Appointment',
                    description: 'Schedule appointment with contact',
                    configSchema: {
                        serviceType: 'string (required)',
                        duration: 'number (minutes, required)',
                        preferredTimeSlots: 'array (optional)',
                        autoConfirm: 'boolean (default: false)'
                    }
                },
                send_calendar_invite: {
                    name: 'Send Calendar Invite',
                    description: 'Send calendar invitation to contact',
                    configSchema: {
                        title: 'string (required)',
                        description: 'string (optional)',
                        startTime: 'date (required)',
                        duration: 'number (minutes, required)',
                        location: 'string (optional)'
                    }
                },
                reschedule_appointment: {
                    name: 'Reschedule Appointment',
                    description: 'Reschedule existing appointment',
                    configSchema: {
                        appointmentId: 'string (required)',
                        newStartTime: 'date (required)',
                        sendNotification: 'boolean (default: true)'
                    }
                }
            },
            contact_management: {
                create_contact: {
                    name: 'Create Contact',
                    description: 'Create new contact record',
                    configSchema: {
                        contactData: 'object (required)',
                        tags: 'array (optional)',
                        assignTo: 'string (optional)'
                    }
                },
                update_contact: {
                    name: 'Update Contact',
                    description: 'Update existing contact information',
                    configSchema: {
                        contactId: 'string (optional - uses context.contact.id if not provided)',
                        updates: 'object (required)',
                        createIfNotExists: 'boolean (default: false)'
                    }
                },
                add_tag: {
                    name: 'Add Tag',
                    description: 'Add tag to contact',
                    configSchema: {
                        contactId: 'string (optional)',
                        tags: 'array (required)'
                    }
                },
                remove_tag: {
                    name: 'Remove Tag',
                    description: 'Remove tag from contact',
                    configSchema: {
                        contactId: 'string (optional)',
                        tags: 'array (required)'
                    }
                }
            },
            workflow_control: {
                wait: {
                    name: 'Wait',
                    description: 'Pause workflow execution',
                    configSchema: {
                        duration: 'number (milliseconds, required)',
                        condition: 'object (optional - wait until condition is met)'
                    }
                },
                condition: {
                    name: 'Condition',
                    description: 'Evaluate condition and branch workflow',
                    configSchema: {
                        conditions: 'array (required)',
                        onTrue: 'object (optional)',
                        onFalse: 'object (optional)'
                    }
                }
            }
        };
        
        res.json(actionTypes);
        
    } catch (error) {
        console.error('Error fetching action types:', error);
        res.status(500).json({ error: 'Failed to fetch action types' });
    }
});

/**
 * GET /api/actions/:id
 * Get specific action
 */
router.get('/:id', authenticateJWT, async (req, res) => {
    try {
        const action = await Action.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        });
        
        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        res.json(action);
        
    } catch (error) {
        console.error('Error fetching action:', error);
        res.status(500).json({ error: 'Failed to fetch action' });
    }
});

/**
 * POST /api/actions
 * Create new action
 */
router.post('/', authenticateJWT, validate(createActionSchema), async (req, res) => {
    try {
        const action = new Action({
            ...req.body,
            companyId: req.user.companyId,
            createdBy: req.user._id
        });
        
        await action.save();
        
        res.status(201).json(action);
        
    } catch (error) {
        console.error('Error creating action:', error);
        res.status(500).json({ error: 'Failed to create action' });
    }
});

/**
 * PUT /api/actions/:id
 * Update action
 */
router.put('/:id', authenticateJWT, validate(createActionSchema), async (req, res) => {
    try {
        const action = await Action.findOneAndUpdate(
            { _id: req.params.id, companyId: req.user.companyId },
            { ...req.body, updatedBy: req.user._id },
            { new: true, runValidators: true }
        );
        
        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        res.json(action);
        
    } catch (error) {
        console.error('Error updating action:', error);
        res.status(500).json({ error: 'Failed to update action' });
    }
});

/**
 * DELETE /api/actions/:id
 * Delete action
 */
router.delete('/:id', authenticateJWT, async (req, res) => {
    try {
        const action = await Action.findOneAndDelete({
            _id: req.params.id,
            companyId: req.user.companyId
        });
        
        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        res.json({ message: 'Action deleted successfully' });
        
    } catch (error) {
        console.error('Error deleting action:', error);
        res.status(500).json({ error: 'Failed to delete action' });
    }
});

/**
 * POST /api/actions/:id/test
 * Test action execution
 */
router.post('/:id/test', authenticateJWT, validate(testActionSchema), async (req, res) => {
    try {
        const action = await Action.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        });
        
        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        const context = {
            ...req.body.context,
            testMode: true,
            companyId: req.user.companyId,
            userId: req.user._id
        };
        
        const result = await ActionService.executeAction(action, context);
        
        res.json({
            message: 'Action test completed',
            result,
            testMode: true
        });
        
    } catch (error) {
        console.error('Error testing action:', error);
        res.status(500).json({ error: 'Failed to test action' });
    }
});

/**
 * POST /api/actions/:id/duplicate
 * Duplicate an action
 */
router.post('/:id/duplicate', authenticateJWT, async (req, res) => {
    try {
        const originalAction = await Action.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        });
        
        if (!originalAction) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        const duplicatedAction = new Action({
            name: `${originalAction.name} (Copy)`,
            description: originalAction.description,
            type: originalAction.type,
            category: originalAction.category,
            config: originalAction.config,
            conditions: originalAction.conditions,
            retryPolicy: originalAction.retryPolicy,
            timeout: originalAction.timeout,
            tags: originalAction.tags,
            companyId: req.user.companyId,
            createdBy: req.user._id
        });
        
        await duplicatedAction.save();
        
        res.status(201).json(duplicatedAction);
        
    } catch (error) {
        console.error('Error duplicating action:', error);
        res.status(500).json({ error: 'Failed to duplicate action' });
    }
});

/**
 * GET /api/actions/:id/usage
 * Get workflows that use this action
 */
router.get('/:id/usage', authenticateJWT, async (req, res) => {
    try {
        const action = await Action.findOne({
            _id: req.params.id,
            companyId: req.user.companyId
        });
        
        if (!action) {
            return res.status(404).json({ error: 'Action not found' });
        }
        
        const Workflow = require('../models/Workflow');
        const workflows = await Workflow.find({
            companyId: req.user.companyId,
            'steps.actionId': action._id
        }).select('name description category isActive');
        
        res.json({
            action: {
                name: action.name,
                type: action.type
            },
            usedInWorkflows: workflows,
            usageCount: workflows.length
        });
        
    } catch (error) {
        console.error('Error fetching action usage:', error);
        res.status(500).json({ error: 'Failed to fetch action usage' });
    }
});

module.exports = router;

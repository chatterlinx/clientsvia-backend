// models/Action.js
// Action System - Core component for workflow automation
// Inspired by HighLevel's action/workflow system

const mongoose = require('mongoose');

const ActionSchema = new mongoose.Schema({
    // Basic Action Info
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        required: true,
        enum: [
            // Communication Actions
            'send_sms', 'send_email', 'make_call', 'send_voicemail',
            
            // Scheduling Actions
            'book_appointment', 'send_calendar_invite', 'reschedule_appointment',
            
            // Contact Management
            'create_contact', 'update_contact', 'add_tag', 'remove_tag',
            'add_to_pipeline', 'move_pipeline_stage',
            
            // Data & Intelligence
            'extract_data', 'ai_analysis', 'sentiment_analysis',
            
            // Integration Actions
            'webhook', 'api_call', 'crm_sync',
            
            // Workflow Control
            'wait', 'condition', 'trigger_workflow',
            
            // Service Management
            'create_service_request', 'assign_technician', 'update_job_status'
        ]
    },
    
    // Company Association
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // Action Configuration
    config: {
        // Communication configs
        messageTemplate: String,
        emailSubject: String,
        emailTemplate: String,
        phoneNumber: String,
        voicemailScript: String,
        
        // Scheduling configs
        serviceType: String,
        duration: Number, // minutes
        bufferTime: Number, // minutes
        calendarId: String,
        
        // Contact management configs
        tags: [String],
        pipelineId: String,
        stageId: String,
        fieldMappings: mongoose.Schema.Types.Mixed,
        
        // Data extraction configs
        extractionRules: [{
            field: String,
            pattern: String,
            type: { type: String, enum: ['text', 'number', 'date', 'phone', 'email'] }
        }],
        
        // Integration configs
        webhookUrl: String,
        apiEndpoint: String,
        apiMethod: { type: String, enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        apiHeaders: mongoose.Schema.Types.Mixed,
        apiPayload: mongoose.Schema.Types.Mixed,
        
        // Workflow control configs
        waitDuration: Number, // minutes
        conditions: [{
            field: String,
            operator: { type: String, enum: ['equals', 'contains', 'greater_than', 'less_than', 'exists'] },
            value: mongoose.Schema.Types.Mixed
        }],
        
        // Service management configs
        serviceCategory: String,
        priority: { type: String, enum: ['low', 'medium', 'high', 'emergency'] },
        assignmentRules: mongoose.Schema.Types.Mixed
    },
    
    // Trigger Conditions
    triggers: [{
        type: {
            type: String,
            enum: [
                'call_received', 'call_ended', 'sms_received', 'email_received',
                'contact_created', 'contact_updated', 'appointment_booked',
                'service_requested', 'payment_received', 'form_submitted',
                'time_based', 'manual', 'webhook_received'
            ]
        },
        conditions: [{
            field: String,
            operator: String,
            value: mongoose.Schema.Types.Mixed
        }],
        enabled: { type: Boolean, default: true }
    }],
    
    // Execution Settings
    execution: {
        enabled: { type: Boolean, default: true },
        maxRetries: { type: Number, default: 3 },
        retryDelay: { type: Number, default: 5 }, // minutes
        timeout: { type: Number, default: 30 }, // seconds
        runAsync: { type: Boolean, default: false }
    },
    
    // Analytics & Tracking
    stats: {
        totalExecutions: { type: Number, default: 0 },
        successfulExecutions: { type: Number, default: 0 },
        failedExecutions: { type: Number, default: 0 },
        lastExecuted: Date,
        avgExecutionTime: Number // milliseconds
    },
    
    // Action Dependencies
    dependencies: [{
        actionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Action' },
        type: { type: String, enum: ['before', 'after', 'parallel'] }
    }],
    
    // Metadata
    isActive: { type: Boolean, default: true },
    isTemplate: { type: Boolean, default: false },
    templateCategory: String,
    tags: [String],
    
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
ActionSchema.index({ companyId: 1, type: 1 });
ActionSchema.index({ companyId: 1, isActive: 1 });
ActionSchema.index({ 'triggers.type': 1 });

// Update the updatedAt field before saving
ActionSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Instance Methods
ActionSchema.methods.execute = async function(context = {}) {
    // This will be implemented in the ActionService
    const ActionService = require('../services/actionService');
    return await ActionService.executeAction(this, context);
};

ActionSchema.methods.canExecute = function(context = {}) {
    if (!this.execution.enabled || !this.isActive) return false;
    
    // Check trigger conditions
    return this.triggers.some(trigger => {
        if (!trigger.enabled) return false;
        
        return trigger.conditions.every(condition => {
            const fieldValue = context[condition.field];
            
            switch (condition.operator) {
                case 'equals':
                    return fieldValue === condition.value;
                case 'contains':
                    return String(fieldValue).toLowerCase().includes(String(condition.value).toLowerCase());
                case 'greater_than':
                    return Number(fieldValue) > Number(condition.value);
                case 'less_than':
                    return Number(fieldValue) < Number(condition.value);
                case 'exists':
                    return fieldValue !== undefined && fieldValue !== null;
                default:
                    return false;
            }
        });
    });
};

// Static Methods
ActionSchema.statics.findByTrigger = function(triggerType, companyId) {
    return this.find({
        companyId,
        isActive: true,
        'execution.enabled': true,
        'triggers.type': triggerType,
        'triggers.enabled': true
    });
};

ActionSchema.statics.getTemplates = function(category = null) {
    const query = { isTemplate: true };
    if (category) query.templateCategory = category;
    return this.find(query);
};

module.exports = mongoose.model('Action', ActionSchema);

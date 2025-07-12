// models/Workflow.js
// Workflow Engine - Orchestrates multiple actions into intelligent sequences
// Provides advanced automation capabilities

const mongoose = require('mongoose');

const WorkflowSchema = new mongoose.Schema({
    // Basic Workflow Info
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        enum: [
            'lead_nurturing', 'appointment_booking', 'customer_service',
            'emergency_response', 'follow_up', 'onboarding',
            'payment_processing', 'service_delivery', 'feedback_collection'
        ]
    },
    
    // Company Association
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // Workflow Steps
    steps: [{
        stepId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        actionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Action',
            required: true
        },
        
        // Step Configuration
        config: {
            // Execution timing
            delay: Number, // minutes to wait before executing
            waitForPrevious: { type: Boolean, default: true },
            
            // Conditional execution
            conditions: [{
                field: String,
                operator: String,
                value: mongoose.Schema.Types.Mixed,
                source: { type: String, enum: ['context', 'previous_step', 'contact', 'company'] }
            }],
            
            // Error handling
            onError: {
                type: String,
                enum: ['stop', 'continue', 'retry', 'skip'],
                default: 'stop'
            },
            maxRetries: { type: Number, default: 3 }
        },
        
        // Step Dependencies
        dependsOn: [String], // Array of stepIds
        
        // Output mapping for next steps
        outputMapping: [{
            fromField: String,
            toField: String,
            transform: String // JavaScript expression for data transformation
        }],
        
        position: {
            x: Number,
            y: Number
        }
    }],
    
    // Workflow Triggers
    triggers: [{
        type: {
            type: String,
            enum: [
                'call_received', 'call_ended', 'sms_received', 'contact_created',
                'appointment_booked', 'service_requested', 'payment_received',
                'time_based', 'manual', 'webhook', 'form_submitted'
            ]
        },
        conditions: [{
            field: String,
            operator: String,
            value: mongoose.Schema.Types.Mixed
        }],
        enabled: { type: Boolean, default: true },
        
        // Time-based trigger settings
        schedule: {
            type: { type: String, enum: ['once', 'recurring'] },
            datetime: Date,
            cron: String, // For recurring schedules
            timezone: { type: String, default: 'UTC' }
        }
    }],
    
    // Workflow Settings
    settings: {
        enabled: { type: Boolean, default: true },
        maxConcurrentExecutions: { type: Number, default: 10 },
        timeout: { type: Number, default: 3600 }, // seconds
        retryFailedSteps: { type: Boolean, default: true },
        
        // Notification settings
        notifications: {
            onSuccess: { type: Boolean, default: false },
            onFailure: { type: Boolean, default: true },
            emailList: [String]
        }
    },
    
    // Analytics & Performance
    analytics: {
        totalExecutions: { type: Number, default: 0 },
        successfulExecutions: { type: Number, default: 0 },
        failedExecutions: { type: Number, default: 0 },
        avgExecutionTime: Number, // milliseconds
        lastExecuted: Date,
        
        // Step-level analytics
        stepStats: [{
            stepId: String,
            executions: { type: Number, default: 0 },
            successes: { type: Number, default: 0 },
            failures: { type: Number, default: 0 },
            avgDuration: Number
        }]
    },
    
    // Workflow State
    isActive: { type: Boolean, default: true },
    isTemplate: { type: Boolean, default: false },
    templateCategory: String,
    version: { type: Number, default: 1 },
    
    // Metadata
    tags: [String],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Execution History Schema (separate collection for performance)
const WorkflowExecutionSchema = new mongoose.Schema({
    workflowId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Workflow',
        required: true,
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // Execution Context
    triggerType: String,
    triggerData: mongoose.Schema.Types.Mixed,
    context: mongoose.Schema.Types.Mixed,
    
    // Execution State
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    
    // Step Execution Details
    stepExecutions: [{
        stepId: String,
        actionId: mongoose.Schema.Types.ObjectId,
        status: { type: String, enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
        startTime: Date,
        endTime: Date,
        duration: Number, // milliseconds
        input: mongoose.Schema.Types.Mixed,
        output: mongoose.Schema.Types.Mixed,
        error: String,
        retryCount: { type: Number, default: 0 }
    }],
    
    // Timing
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    totalDuration: Number, // milliseconds
    
    // Results
    finalOutput: mongoose.Schema.Types.Mixed,
    errorMessage: String,
    
    createdAt: { type: Date, default: Date.now }
});

// Indexes
WorkflowSchema.index({ companyId: 1, isActive: 1 });
WorkflowSchema.index({ 'triggers.type': 1 });
WorkflowSchema.index({ category: 1 });

WorkflowExecutionSchema.index({ workflowId: 1, createdAt: -1 });
WorkflowExecutionSchema.index({ companyId: 1, status: 1 });
WorkflowExecutionSchema.index({ startTime: 1 });

// Pre-save middleware
WorkflowSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// Instance Methods
WorkflowSchema.methods.execute = async function(context = {}, triggerType = 'manual') {
    const WorkflowService = require('../services/workflowService');
    return await WorkflowService.executeWorkflow(this, context, triggerType);
};

WorkflowSchema.methods.canExecute = function(context = {}) {
    if (!this.settings.enabled || !this.isActive) return false;
    
    // Check if any trigger conditions are met
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

WorkflowSchema.methods.validateSteps = function() {
    const stepIds = this.steps.map(s => s.stepId);
    const errors = [];
    
    // Check for circular dependencies
    this.steps.forEach(step => {
        if (step.dependsOn && step.dependsOn.includes(step.stepId)) {
            errors.push(`Step ${step.stepId} cannot depend on itself`);
        }
        
        // Check if dependencies exist
        step.dependsOn.forEach(depId => {
            if (!stepIds.includes(depId)) {
                errors.push(`Step ${step.stepId} depends on non-existent step ${depId}`);
            }
        });
    });
    
    return errors;
};

// Static Methods
WorkflowSchema.statics.findByTrigger = function(triggerType, companyId) {
    return this.find({
        companyId,
        isActive: true,
        'settings.enabled': true,
        'triggers.type': triggerType,
        'triggers.enabled': true
    });
};

WorkflowSchema.statics.getTemplates = function(category = null) {
    const query = { isTemplate: true };
    if (category) query.templateCategory = category;
    return this.find(query);
};

module.exports = mongoose.model('Workflow', WorkflowSchema);

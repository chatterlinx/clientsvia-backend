// models/WorkflowExecution.js
// Workflow Execution Tracking - Records and monitors workflow runs
// Provides audit trail and debugging capabilities

const mongoose = require('mongoose');

const WorkflowExecutionSchema = new mongoose.Schema({
    // Execution Identification
    executionId: {
        type: String,
        required: true,
        unique: true,
        default: () => new mongoose.Types.ObjectId().toString()
    },
    
    // Workflow Association
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
    
    // Execution Status
    status: {
        type: String,
        enum: ['running', 'completed', 'failed', 'cancelled', 'paused'],
        default: 'running',
        index: true
    },
    
    // Execution Context
    context: {
        // Trigger information
        trigger: {
            event: String,
            source: String,
            data: mongoose.Schema.Types.Mixed
        },
        
        // Contact/Lead information
        contact: {
            contactId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Contact'
            },
            phone: String,
            email: String,
            name: String
        },
        
        // Custom variables
        variables: mongoose.Schema.Types.Mixed,
        
        // Session data
        sessionData: mongoose.Schema.Types.Mixed
    },
    
    // Execution Steps
    steps: [{
        stepId: String,
        stepName: String,
        actionType: String,
        status: {
            type: String,
            enum: ['pending', 'running', 'completed', 'failed', 'skipped']
        },
        startedAt: Date,
        completedAt: Date,
        duration: Number, // milliseconds
        result: mongoose.Schema.Types.Mixed,
        error: String,
        retryCount: {
            type: Number,
            default: 0
        }
    }],
    
    // Timing Information
    startedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    completedAt: Date,
    duration: Number, // Total execution time in milliseconds
    
    // Results and Metrics
    result: {
        success: Boolean,
        completedSteps: Number,
        totalSteps: Number,
        errorMessage: String,
        data: mongoose.Schema.Types.Mixed
    },
    
    // Performance Metrics
    metrics: {
        memoryUsed: Number,
        cpuTime: Number,
        apiCalls: Number,
        webhooksSent: Number,
        emailsSent: Number,
        smsSent: Number
    },
    
    // Audit Trail
    logs: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        level: {
            type: String,
            enum: ['info', 'warn', 'error', 'debug']
        },
        message: String,
        data: mongoose.Schema.Types.Mixed
    }],
    
    // Parent/Child Relationships (for sub-workflows)
    parentExecutionId: String,
    childExecutions: [String]
    
}, {
    timestamps: true,
    // Index for performance
    indexes: [
        { workflowId: 1, startedAt: -1 },
        { companyId: 1, status: 1 },
        { 'context.contact.contactId': 1 },
        { status: 1, startedAt: -1 }
    ]
});

// Instance Methods

/**
 * Add a log entry to the execution
 */
WorkflowExecutionSchema.methods.addLog = function(level, message, data = null) {
    this.logs.push({
        timestamp: new Date(),
        level,
        message,
        data
    });
    
    // Keep only last 100 logs to prevent document size issues
    if (this.logs.length > 100) {
        this.logs = this.logs.slice(-100);
    }
    
    return this.save();
};

/**
 * Update step status
 */
WorkflowExecutionSchema.methods.updateStep = function(stepId, updates) {
    const step = this.steps.find(s => s.stepId === stepId);
    if (step) {
        Object.assign(step, updates);
        if (updates.status === 'completed' && step.startedAt) {
            step.completedAt = new Date();
            step.duration = step.completedAt - step.startedAt;
        }
        return this.save();
    }
    return Promise.resolve(this);
};

/**
 * Mark execution as completed
 */
WorkflowExecutionSchema.methods.complete = function(success = true, data = null) {
    this.status = success ? 'completed' : 'failed';
    this.completedAt = new Date();
    this.duration = this.completedAt - this.startedAt;
    
    this.result = {
        success,
        completedSteps: this.steps.filter(s => s.status === 'completed').length,
        totalSteps: this.steps.length,
        data
    };
    
    return this.save();
};

/**
 * Mark execution as failed
 */
WorkflowExecutionSchema.methods.fail = function(errorMessage, data = null) {
    this.status = 'failed';
    this.completedAt = new Date();
    this.duration = this.completedAt - this.startedAt;
    
    this.result = {
        success: false,
        completedSteps: this.steps.filter(s => s.status === 'completed').length,
        totalSteps: this.steps.length,
        errorMessage,
        data
    };
    
    return this.save();
};

// Static Methods

/**
 * Get execution statistics for a company
 */
WorkflowExecutionSchema.statics.getExecutionStats = async function(companyId, timeframe = '30d') {
    const match = { companyId };
    
    // Add timeframe filter
    if (timeframe !== 'all') {
        const days = parseInt(timeframe.replace('d', ''));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        match.startedAt = { $gte: startDate };
    }
    
    const stats = await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalExecutions: { $sum: 1 },
                successfulExecutions: {
                    $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                },
                failedExecutions: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                },
                runningExecutions: {
                    $sum: { $cond: [{ $eq: ['$status', 'running'] }, 1, 0] }
                },
                avgDuration: { $avg: '$duration' },
                totalDuration: { $sum: '$duration' }
            }
        }
    ]);
    
    return stats[0] || {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        runningExecutions: 0,
        avgDuration: 0,
        totalDuration: 0
    };
};

/**
 * Get workflow performance analytics
 */
WorkflowExecutionSchema.statics.getWorkflowPerformance = async function(workflowId, timeframe = '30d') {
    const match = { workflowId };
    
    if (timeframe !== 'all') {
        const days = parseInt(timeframe.replace('d', ''));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        match.startedAt = { $gte: startDate };
    }
    
    return await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgDuration: { $avg: '$duration' },
                minDuration: { $min: '$duration' },
                maxDuration: { $max: '$duration' }
            }
        }
    ]);
};

/**
 * Find stuck executions (running for too long)
 */
WorkflowExecutionSchema.statics.findStuckExecutions = async function(timeoutMinutes = 60) {
    const timeoutDate = new Date();
    timeoutDate.setMinutes(timeoutDate.getMinutes() - timeoutMinutes);
    
    return await this.find({
        status: 'running',
        startedAt: { $lt: timeoutDate }
    });
};

// Indexes for performance
WorkflowExecutionSchema.index({ workflowId: 1, startedAt: -1 });
WorkflowExecutionSchema.index({ companyId: 1, status: 1 });
WorkflowExecutionSchema.index({ 'context.contact.contactId': 1 });
WorkflowExecutionSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model('WorkflowExecution', WorkflowExecutionSchema);

/**
 * ============================================================================
 * SCENARIO GENERATION JOB MODEL - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Tracks scenario generation jobs - the "work orders" for the engine.
 * One job can cover multiple services, with progress tracking per service.
 * 
 * KEY FEATURES:
 * - Job queuing with status lifecycle
 * - Per-service progress tracking
 * - Rate limiting and budget controls
 * - Failure tracking with retry logic
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Service Run Schema - Progress per service within a job
 */
const serviceRunSchema = new Schema({
    serviceKey: {
        type: String,
        required: true
    },
    serviceType: {
        type: String,
        enum: ['work', 'symptom', 'admin'],
        default: 'work'
    },
    displayName: String,
    
    // Coverage targets
    targetCount: {
        type: Number,
        required: true
    },
    currentApproved: {
        type: Number,
        default: 0
    },
    currentPending: {
        type: Number,
        default: 0
    },
    gap: {
        type: Number,
        default: 0
    },
    
    // Status
    status: {
        type: String,
        enum: ['queued', 'running', 'done', 'skipped', 'failed', 'blocked'],
        default: 'queued'
    },
    
    // Execution
    attempts: {
        type: Number,
        default: 0
    },
    scenariosGenerated: {
        type: Number,
        default: 0
    },
    scenariosQueued: {
        type: Number,
        default: 0
    },
    lastError: String,
    skipReason: String,
    
    // Timing
    startedAt: Date,
    finishedAt: Date
}, { _id: false });

/**
 * Main Job Schema
 */
const scenarioGenerationJobSchema = new Schema({
    // Identity
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        default: null
        // null for global template jobs
    },
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true
    },
    
    // Job configuration
    mode: {
        type: String,
        enum: ['fill_gaps', 'generate_all', 'service_only'],
        default: 'fill_gaps'
        // fill_gaps: Only generate for services with coverage gaps
        // generate_all: Generate for all enabled services
        // service_only: Generate for specific service(s)
    },
    
    // Status lifecycle: queued → running → completed/failed/cancelled
    status: {
        type: String,
        enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'],
        default: 'queued'
    },
    
    // Who created this job
    createdBy: {
        userId: Schema.Types.ObjectId,
        name: String,
        email: String
    },
    
    // Limits and controls
    limits: {
        maxServices: {
            type: Number,
            default: 999
        },
        maxScenariosTotal: {
            type: Number,
            default: 500
        },
        maxScenariosPerService: {
            type: Number,
            default: 25
        },
        maxScenariosPerBatch: {
            type: Number,
            default: 8
            // How many scenarios to request per GPT call
        },
        dailyTokenBudget: {
            type: Number,
            default: 500000
        },
        maxRetries: {
            type: Number,
            default: 3
        },
        concurrency: {
            type: Number,
            default: 1
            // How many services to process in parallel
        }
    },
    
    // Progress tracking
    progress: {
        servicesTotal: { type: Number, default: 0 },
        servicesDone: { type: Number, default: 0 },
        servicesSkipped: { type: Number, default: 0 },
        servicesFailed: { type: Number, default: 0 },
        scenariosGenerated: { type: Number, default: 0 },
        scenariosQueuedForReview: { type: Number, default: 0 },
        scenariosApproved: { type: Number, default: 0 },
        scenariosRejected: { type: Number, default: 0 },
        tokensUsed: { type: Number, default: 0 },
        estimatedCost: { type: Number, default: 0 }
    },
    
    // Per-service runs
    serviceRuns: [serviceRunSchema],
    
    // Specific services (for service_only mode)
    targetServiceKeys: {
        type: [String],
        default: []
    },
    
    // Error tracking
    lastError: String,
    errorCount: {
        type: Number,
        default: 0
    },
    
    // Timing
    startedAt: Date,
    finishedAt: Date,
    pausedAt: Date,
    
    // Metadata
    notes: String
    
}, {
    timestamps: true,
    collection: 'scenariogenerationjobs'
});

// Indexes
scenarioGenerationJobSchema.index({ templateId: 1, status: 1 });
scenarioGenerationJobSchema.index({ companyId: 1, status: 1 });
scenarioGenerationJobSchema.index({ status: 1, createdAt: -1 });

/**
 * Find active job for a template
 */
scenarioGenerationJobSchema.statics.findActiveJob = async function(templateId, companyId = null) {
    const query = {
        templateId,
        status: { $in: ['queued', 'running', 'paused'] }
    };
    if (companyId) {
        query.companyId = companyId;
    }
    return this.findOne(query).sort({ createdAt: -1 });
};

/**
 * Create a new job if no active job exists
 */
scenarioGenerationJobSchema.statics.createJob = async function(params) {
    const { templateId, companyId, mode, limits, targetServiceKeys, createdBy, notes } = params;
    
    // Check for existing active job
    const existingJob = await this.findActiveJob(templateId, companyId);
    if (existingJob) {
        throw new Error(`Active job already exists: ${existingJob._id}`);
    }
    
    const job = new this({
        templateId,
        companyId,
        mode: mode || 'fill_gaps',
        limits: { ...limits },
        targetServiceKeys: targetServiceKeys || [],
        createdBy,
        notes
    });
    
    await job.save();
    return job;
};

/**
 * Update job progress
 */
scenarioGenerationJobSchema.methods.updateProgress = async function(updates) {
    for (const [key, value] of Object.entries(updates)) {
        if (this.progress[key] !== undefined) {
            this.progress[key] = value;
        }
    }
    await this.save();
};

/**
 * Update service run status
 */
scenarioGenerationJobSchema.methods.updateServiceRun = async function(serviceKey, updates) {
    const run = this.serviceRuns.find(r => r.serviceKey === serviceKey);
    if (run) {
        Object.assign(run, updates);
        await this.save();
    }
};

/**
 * Mark job as started
 */
scenarioGenerationJobSchema.methods.start = async function() {
    this.status = 'running';
    this.startedAt = new Date();
    await this.save();
};

/**
 * Mark job as completed
 */
scenarioGenerationJobSchema.methods.complete = async function() {
    this.status = 'completed';
    this.finishedAt = new Date();
    await this.save();
};

/**
 * Mark job as failed
 */
scenarioGenerationJobSchema.methods.fail = async function(error) {
    this.status = 'failed';
    this.lastError = error;
    this.errorCount += 1;
    this.finishedAt = new Date();
    await this.save();
};

/**
 * Cancel job
 */
scenarioGenerationJobSchema.methods.cancel = async function(reason) {
    this.status = 'cancelled';
    this.notes = reason || 'Cancelled by user';
    this.finishedAt = new Date();
    await this.save();
};

module.exports = mongoose.model('ScenarioGenerationJob', scenarioGenerationJobSchema);

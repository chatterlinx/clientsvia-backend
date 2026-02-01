/**
 * ============================================================================
 * SCENARIO ENGINE STATE MODEL - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Anti-loop protection and rate control for the Scenario Engine.
 * Prevents infinite generation, tracks daily usage, manages blocked services.
 * 
 * KEY FEATURES:
 * - Cooldown management (prevents spam generation)
 * - Daily usage tracking (budget control)
 * - Service blocking (stops problematic services)
 * - Rate limiting state
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Blocked service schema
 */
const blockedServiceSchema = new Schema({
    serviceKey: {
        type: String,
        required: true
    },
    reason: {
        type: String,
        enum: ['too_many_failures', 'lint_failures', 'manual_block', 'missing_config'],
        required: true
    },
    blockedAt: {
        type: Date,
        default: Date.now
    },
    blockedBy: String,
    failureCount: {
        type: Number,
        default: 0
    },
    lastError: String,
    // Auto-unblock after this date (null = permanent until manual)
    unblockAfter: Date
}, { _id: false });

/**
 * Daily usage schema
 */
const dailyUsageSchema = new Schema({
    date: {
        type: String, // YYYY-MM-DD
        required: true
    },
    tokensUsed: {
        type: Number,
        default: 0
    },
    requestsUsed: {
        type: Number,
        default: 0
    },
    scenariosGenerated: {
        type: Number,
        default: 0
    },
    scenariosApproved: {
        type: Number,
        default: 0
    },
    estimatedCost: {
        type: Number,
        default: 0
    }
}, { _id: false });

/**
 * Main Engine State Schema
 */
const scenarioEngineStateSchema = new Schema({
    // Identity - one state per company+template
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        default: null
    },
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true
    },
    
    // Engine status
    isEnabled: {
        type: Boolean,
        default: true
    },
    isPaused: {
        type: Boolean,
        default: false
    },
    pausedAt: Date,
    pausedBy: String,
    pauseReason: String,
    
    // Last run tracking
    lastRunAt: Date,
    lastRunStatus: {
        type: String,
        enum: ['success', 'partial', 'failed', 'skipped'],
        default: null
    },
    lastRunSummary: String,
    
    // Cooldown - prevents running too frequently
    cooldownUntil: Date,
    cooldownMinutes: {
        type: Number,
        default: 5
        // Minimum minutes between engine runs
    },
    
    // Daily usage tracking
    dailyUsage: dailyUsageSchema,
    
    // Daily limits
    dailyLimits: {
        maxTokens: {
            type: Number,
            default: 500000
        },
        maxRequests: {
            type: Number,
            default: 100
        },
        maxScenarios: {
            type: Number,
            default: 200
        }
    },
    
    // Blocked services (won't generate for these)
    blockedServices: [blockedServiceSchema],
    
    // Rate limiting
    consecutiveFailures: {
        type: Number,
        default: 0
    },
    lastFailureAt: Date,
    
    // Statistics
    stats: {
        totalRuns: { type: Number, default: 0 },
        totalScenariosGenerated: { type: Number, default: 0 },
        totalScenariosApproved: { type: Number, default: 0 },
        totalTokensUsed: { type: Number, default: 0 },
        totalCost: { type: Number, default: 0 }
    }
    
}, {
    timestamps: true,
    collection: 'scenarioenginestates'
});

// Unique constraint
scenarioEngineStateSchema.index({ companyId: 1, templateId: 1 }, { unique: true });

/**
 * Get or create state for a template
 */
scenarioEngineStateSchema.statics.getOrCreate = async function(templateId, companyId = null) {
    let state = await this.findOne({ templateId, companyId });
    
    if (!state) {
        state = new this({
            templateId,
            companyId,
            dailyUsage: {
                date: new Date().toISOString().split('T')[0],
                tokensUsed: 0,
                requestsUsed: 0,
                scenariosGenerated: 0
            }
        });
        await state.save();
    }
    
    return state;
};

/**
 * Check if engine can run (not in cooldown, not paused, budget OK)
 */
scenarioEngineStateSchema.methods.canRun = function() {
    // Check if paused
    if (this.isPaused) {
        return { canRun: false, reason: 'Engine is paused' };
    }
    
    // Check cooldown
    if (this.cooldownUntil && new Date() < this.cooldownUntil) {
        const remaining = Math.ceil((this.cooldownUntil - new Date()) / 1000 / 60);
        return { canRun: false, reason: `In cooldown for ${remaining} more minutes` };
    }
    
    // Check daily budget
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyUsage?.date === today) {
        if (this.dailyUsage.tokensUsed >= this.dailyLimits.maxTokens) {
            return { canRun: false, reason: 'Daily token budget exceeded' };
        }
        if (this.dailyUsage.requestsUsed >= this.dailyLimits.maxRequests) {
            return { canRun: false, reason: 'Daily request limit exceeded' };
        }
        if (this.dailyUsage.scenariosGenerated >= this.dailyLimits.maxScenarios) {
            return { canRun: false, reason: 'Daily scenario limit exceeded' };
        }
    }
    
    return { canRun: true };
};

/**
 * Check if a specific service is blocked
 */
scenarioEngineStateSchema.methods.isServiceBlocked = function(serviceKey) {
    const blocked = this.blockedServices.find(b => b.serviceKey === serviceKey);
    if (!blocked) return { blocked: false };
    
    // Check if auto-unblock time has passed
    if (blocked.unblockAfter && new Date() > blocked.unblockAfter) {
        return { blocked: false, wasBlocked: true };
    }
    
    return { blocked: true, reason: blocked.reason, blockedAt: blocked.blockedAt };
};

/**
 * Block a service
 */
scenarioEngineStateSchema.methods.blockService = async function(serviceKey, reason, lastError = null, autoUnblockHours = null) {
    // Remove existing block if any
    this.blockedServices = this.blockedServices.filter(b => b.serviceKey !== serviceKey);
    
    // Add new block
    const block = {
        serviceKey,
        reason,
        blockedAt: new Date(),
        lastError,
        unblockAfter: autoUnblockHours ? new Date(Date.now() + autoUnblockHours * 60 * 60 * 1000) : null
    };
    
    this.blockedServices.push(block);
    await this.save();
};

/**
 * Unblock a service
 */
scenarioEngineStateSchema.methods.unblockService = async function(serviceKey) {
    this.blockedServices = this.blockedServices.filter(b => b.serviceKey !== serviceKey);
    await this.save();
};

/**
 * Record a run
 */
scenarioEngineStateSchema.methods.recordRun = async function(result) {
    const { tokensUsed, scenariosGenerated, status, summary } = result;
    
    // Update last run
    this.lastRunAt = new Date();
    this.lastRunStatus = status;
    this.lastRunSummary = summary;
    
    // Set cooldown
    this.cooldownUntil = new Date(Date.now() + this.cooldownMinutes * 60 * 1000);
    
    // Update daily usage
    const today = new Date().toISOString().split('T')[0];
    if (!this.dailyUsage || this.dailyUsage.date !== today) {
        this.dailyUsage = {
            date: today,
            tokensUsed: 0,
            requestsUsed: 0,
            scenariosGenerated: 0
        };
    }
    
    this.dailyUsage.tokensUsed += tokensUsed || 0;
    this.dailyUsage.requestsUsed += 1;
    this.dailyUsage.scenariosGenerated += scenariosGenerated || 0;
    this.dailyUsage.estimatedCost = (this.dailyUsage.tokensUsed / 1000) * 0.01;
    
    // Update stats
    this.stats.totalRuns += 1;
    this.stats.totalScenariosGenerated += scenariosGenerated || 0;
    this.stats.totalTokensUsed += tokensUsed || 0;
    this.stats.totalCost = (this.stats.totalTokensUsed / 1000) * 0.01;
    
    // Track failures
    if (status === 'failed') {
        this.consecutiveFailures += 1;
        this.lastFailureAt = new Date();
    } else {
        this.consecutiveFailures = 0;
    }
    
    await this.save();
};

/**
 * Pause the engine
 */
scenarioEngineStateSchema.methods.pause = async function(reason, pausedBy) {
    this.isPaused = true;
    this.pausedAt = new Date();
    this.pausedBy = pausedBy;
    this.pauseReason = reason;
    await this.save();
};

/**
 * Resume the engine
 */
scenarioEngineStateSchema.methods.resume = async function() {
    this.isPaused = false;
    this.pausedAt = null;
    this.pausedBy = null;
    this.pauseReason = null;
    await this.save();
};

module.exports = mongoose.model('ScenarioEngineState', scenarioEngineStateSchema);

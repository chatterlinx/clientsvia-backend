// ============================================================================
// 📸 SYSTEM HEALTH SNAPSHOT MODEL
// ============================================================================
// Purpose: Track "last known good" states for regression detection
// 
// Key Features:
// - Captures system health every 5 minutes
// - Stores configuration checksums for change detection
// - Tracks error rates over time
// - Enables "what changed?" analysis
// - Supports comparative debugging
//
// Related Files:
// - services/ErrorIntelligenceService.js (uses snapshots for comparison)
// - services/PlatformHealthCheckService.js (creates snapshots)
// ============================================================================

const mongoose = require('mongoose');

const systemHealthSnapshotSchema = new mongoose.Schema({
    // ========================================================================
    // SNAPSHOT METADATA
    // ========================================================================
    timestamp: { 
        type: Date, 
        default: Date.now
    },
    
    snapshotType: {
        type: String,
        enum: ['SCHEDULED', 'ON_ERROR', 'MANUAL'],
        default: 'SCHEDULED'
    },
    
    // ========================================================================
    // SYSTEM STATUS
    // ========================================================================
    overallStatus: {
        type: String,
        enum: ['HEALTHY', 'WARNING', 'DEGRADED', 'CRITICAL', 'DOWN'],
        required: true,
        index: true
    },
    
    // ========================================================================
    // INFRASTRUCTURE HEALTH
    // ========================================================================
    infrastructure: {
        mongodb: {
            status: { type: String, enum: ['UP', 'DEGRADED', 'DOWN'] },
            latency: Number,  // milliseconds
            connections: Number,
            details: String
        },
        redis: {
            status: { type: String, enum: ['UP', 'DEGRADED', 'DOWN'] },
            latency: Number,
            memory: Number,   // bytes
            connections: Number,
            details: String
        },
        twilio: {
            status: { type: String, enum: ['UP', 'DEGRADED', 'DOWN', 'UNCONFIGURED'] },
            configured: Boolean,
            accountSid: String,  // Masked (last 4 chars only)
            details: String
        },
        elevenlabs: {
            status: { type: String, enum: ['UP', 'DEGRADED', 'DOWN', 'UNCONFIGURED'] },
            configured: Boolean,
            details: String
        }
    },
    
    // ========================================================================
    // DATA METRICS
    // ========================================================================
    data: {
        totalCompanies: Number,
        liveCompanies: Number,
        totalContacts: Number,
        totalTemplates: Number,
        totalQnAEntries: Number,
        companiesWithAI: Number,
        companiesWithTwilio: Number
    },
    
    // ========================================================================
    // ERROR METRICS (Last 5 minutes)
    // ========================================================================
    errorStats: {
        criticalCount: { type: Number, default: 0 },
        warningCount: { type: Number, default: 0 },
        infoCount: { type: Number, default: 0 },
        totalCount: { type: Number, default: 0 },
        
        // Top 5 most frequent errors
        topErrors: [{
            code: String,
            count: Number,
            lastOccurred: Date
        }],
        
        // New errors (first seen in this period)
        newErrors: [String]
    },
    
    // ========================================================================
    // PERFORMANCE METRICS
    // ========================================================================
    performance: {
        avgDbQueryTime: Number,     // milliseconds
        avgRedisQueryTime: Number,
        avgApiResponseTime: Number,
        totalRequests: Number,
        errorRate: Number,          // percentage
        p95ResponseTime: Number,
        p99ResponseTime: Number
    },
    
    // ========================================================================
    // CONFIGURATION CHECKSUMS (For change detection)
    // ========================================================================
    configChecksums: {
        envVarsChecksum: String,    // Hash of environment variables
        twilioConfig: String,       // Hash of Twilio settings
        notificationConfig: String, // Hash of notification settings
        aiConfig: String            // Hash of AI settings
    },
    
    // ========================================================================
    // ACTIVE ALERTS
    // ========================================================================
    activeAlerts: {
        total: Number,
        critical: Number,
        warning: Number,
        unacknowledged: Number,
        oldestUnacknowledged: Date
    },
    
    // ========================================================================
    // CHANGES DETECTED (Compared to previous snapshot)
    // ========================================================================
    changes: [{
        type: { 
            type: String,
            enum: ['ENV_VAR', 'CONFIG', 'DEPLOYMENT', 'DATA_MIGRATION', 'DEPENDENCY_UPDATE']
        },
        description: String,
        detectedAt: Date
    }],
    
    // ========================================================================
    // METADATA
    // ========================================================================
    duration: Number,  // Time to collect snapshot (ms)
    version: String,   // Application version (from package.json)
    nodeVersion: String,
    environment: { type: String, enum: ['production', 'development', 'staging'] }
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================
systemHealthSnapshotSchema.index({ timestamp: -1 });
systemHealthSnapshotSchema.index({ overallStatus: 1, timestamp: -1 });
systemHealthSnapshotSchema.index({ 'errorStats.criticalCount': 1, timestamp: -1 });

// ============================================================================
// BACKWARD COMPATIBILITY
// ============================================================================
systemHealthSnapshotSchema.pre('init', function(doc) {
    if (doc && doc.errors && !doc.errorStats) {
        doc.errorStats = doc.errors;
    }
});

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get the last known good snapshot (HEALTHY status)
 */
systemHealthSnapshotSchema.statics.getLastKnownGood = async function() {
    return this.findOne({ overallStatus: 'HEALTHY' })
        .sort({ timestamp: -1 })
        .exec();
};

/**
 * Compare two snapshots and identify differences
 */
systemHealthSnapshotSchema.statics.compareSnapshots = function(current, previous) {
    if (!previous) {
        return {
            isRegression: false,
            changes: [],
            message: 'No previous snapshot available for comparison'
        };
    }
    
    const changes = [];
    const regressions = [];
    
    // Check infrastructure changes
    if (current.infrastructure.mongodb.status !== previous.infrastructure.mongodb.status) {
        changes.push({
            category: 'INFRASTRUCTURE',
            component: 'MongoDB',
            before: previous.infrastructure.mongodb.status,
            after: current.infrastructure.mongodb.status,
            severity: current.infrastructure.mongodb.status === 'DOWN' ? 'CRITICAL' : 'WARNING'
        });
        
        if (previous.infrastructure.mongodb.status === 'UP') {
            regressions.push('MongoDB health degraded');
        }
    }
    
    if (current.infrastructure.redis.status !== previous.infrastructure.redis.status) {
        changes.push({
            category: 'INFRASTRUCTURE',
            component: 'Redis',
            before: previous.infrastructure.redis.status,
            after: current.infrastructure.redis.status,
            severity: current.infrastructure.redis.status === 'DOWN' ? 'CRITICAL' : 'WARNING'
        });
        
        if (previous.infrastructure.redis.status === 'UP') {
            regressions.push('Redis health degraded');
        }
    }
    
    // Check error rate changes
    const currentErrorRate = current.errorStats.totalCount;
    const previousErrorRate = previous.errorStats.totalCount;
    
    if (currentErrorRate > previousErrorRate * 2) {
        changes.push({
            category: 'ERRORS',
            component: 'Error Rate',
            before: previousErrorRate,
            after: currentErrorRate,
            severity: 'CRITICAL'
        });
        regressions.push(`Error rate spiked ${Math.round((currentErrorRate / previousErrorRate) * 100)}%`);
    }
    
    // Check for new errors
    if (current.errorStats.newErrors && current.errorStats.newErrors.length > 0) {
        changes.push({
            category: 'ERRORS',
            component: 'New Errors',
            before: 'None',
            after: current.errorStats.newErrors.join(', '),
            severity: 'WARNING'
        });
    }
    
    // Check configuration changes
    if (current.configChecksums.envVarsChecksum !== previous.configChecksums.envVarsChecksum) {
        changes.push({
            category: 'CONFIGURATION',
            component: 'Environment Variables',
            before: 'Changed',
            after: 'Modified',
            severity: 'INFO'
        });
        regressions.push('Environment variables changed - possible deployment');
    }
    
    // Check company count changes
    if (current.data.liveCompanies !== previous.data.liveCompanies) {
        const diff = current.data.liveCompanies - previous.data.liveCompanies;
        changes.push({
            category: 'DATA',
            component: 'Live Companies',
            before: previous.data.liveCompanies,
            after: current.data.liveCompanies,
            severity: diff < 0 ? 'WARNING' : 'INFO'
        });
        
        if (diff < 0) {
            regressions.push(`${Math.abs(diff)} companies disappeared`);
        }
    }
    
    return {
        isRegression: regressions.length > 0,
        changes,
        regressions,
        timeSinceLastGood: (current.timestamp - previous.timestamp) / 1000 / 60, // minutes
        message: regressions.length > 0 
            ? `${regressions.length} regression(s) detected` 
            : `${changes.length} change(s) detected`
    };
};

/**
 * Get system health trend (last N snapshots)
 */
systemHealthSnapshotSchema.statics.getTrend = async function(minutes = 60) {
    const since = new Date(Date.now() - minutes * 60 * 1000);
    
    return this.find({ timestamp: { $gte: since } })
        .sort({ timestamp: 1 })
        .select('timestamp overallStatus errorStats.totalCount errorStats.criticalCount performance.errorRate')
        .exec();
};

module.exports = mongoose.model('SystemHealthSnapshot', systemHealthSnapshotSchema);


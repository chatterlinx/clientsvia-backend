// ============================================================================
// 🏥 HEALTH CHECK LOG MODEL
// ============================================================================
// Purpose: Store platform health check results for historical analysis
// 
// Key Features:
// - Records results of full platform health checks
// - Tracks 10+ system component statuses
// - Stores response times for performance monitoring
// - Enables trend analysis (system degradation detection)
// - Provides audit trail for compliance
//
// Related Files:
// - services/PlatformHealthCheckService.js (creates logs)
// - routes/admin/adminNotifications.js (queries logs)
// - public/admin-notification-center.html (displays history)
// ============================================================================

const mongoose = require('mongoose');

const healthCheckLogSchema = new mongoose.Schema({
    // ========================================================================
    // HEALTH CHECK METADATA
    // ========================================================================
    timestamp: { type: Date, default: Date.now },
    
    triggeredBy: {
        type: String,
        enum: ['manual', 'scheduled', 'alert', 'api'],
        default: 'scheduled'
    },
    
    triggeredByUser: String,  // Admin name if manual
    
    // ========================================================================
    // OVERALL STATUS
    // ========================================================================
    overallStatus: {
        type: String,
        enum: ['HEALTHY', 'WARNING', 'CRITICAL', 'OFFLINE'],
        required: true,
        index: true
    },
    
    // ========================================================================
    // INDIVIDUAL COMPONENT CHECKS
    // ========================================================================
    checks: [{
        name: {
            type: String,
            required: true
        },  // 'MongoDB Connection', 'Redis Cache', etc.
        
        icon: String,  // '🗄️', '⚡', etc.
        
        status: {
            type: String,
            enum: ['PASS', 'FAIL', 'WARNING'],
            required: true
        },
        
        message: String,
        
        responseTime: Number,  // milliseconds
        
        details: mongoose.Schema.Types.Mixed  // Flexible object for component-specific data
    }],
    
    // ========================================================================
    // SUMMARY STATISTICS
    // ========================================================================
    summary: {
        total: { type: Number, required: true },
        passed: { type: Number, required: true },
        failed: { type: Number, required: true },
        warnings: { type: Number, required: true }
    },
    
    // ========================================================================
    // PERFORMANCE METRICS
    // ========================================================================
    totalDuration: Number,  // Total health check duration in ms
    
    avgResponseTime: Number,  // Average component response time
    
    slowestComponent: {
        name: String,
        responseTime: Number
    },
    
    // ========================================================================
    // NOTIFICATIONS SENT
    // ========================================================================
    notificationsSent: {
        sms: { type: Boolean, default: false },
        email: { type: Boolean, default: false },
        alertCreated: { type: Boolean, default: false },
        alertId: String  // Reference to NotificationLog if alert created
    },
    
    // ========================================================================
    // COMPARISON WITH PREVIOUS CHECK
    // ========================================================================
    comparison: {
        previousCheckId: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthCheckLog' },
        statusChanged: { type: Boolean, default: false },
        previousStatus: String,
        degradedComponents: [String],  // Components that got worse
        improvedComponents: [String]    // Components that got better
    },
    
    // ========================================================================
    // METADATA
    // ========================================================================
    serverInfo: {
        hostname: String,
        platform: String,
        nodeVersion: String,
        uptime: Number  // seconds
    },
    
    tags: [String]
});

// ============================================================================
// INDEXES
// ============================================================================

healthCheckLogSchema.index({ timestamp: -1 });
healthCheckLogSchema.index({ overallStatus: 1, timestamp: -1 });
healthCheckLogSchema.index({ triggeredBy: 1, timestamp: -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get latest health check
 */
healthCheckLogSchema.statics.getLatest = async function() {
    return this.findOne().sort({ timestamp: -1 }).limit(1);
};

/**
 * Get health check history (last N checks)
 */
healthCheckLogSchema.statics.getHistory = async function(limit = 10) {
    return this.find()
        .sort({ timestamp: -1 })
        .limit(limit)
        .select('timestamp overallStatus summary totalDuration');
};

/**
 * Get health check trend (last 24 hours)
 */
healthCheckLogSchema.statics.getTrend = async function() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const checks = await this.find({
        timestamp: { $gte: twentyFourHoursAgo }
    }).sort({ timestamp: 1 });
    
    return {
        total: checks.length,
        healthy: checks.filter(c => c.overallStatus === 'HEALTHY').length,
        warning: checks.filter(c => c.overallStatus === 'WARNING').length,
        critical: checks.filter(c => c.overallStatus === 'CRITICAL').length,
        offline: checks.filter(c => c.overallStatus === 'OFFLINE').length,
        checks: checks.map(c => ({
            timestamp: c.timestamp,
            status: c.overallStatus,
            duration: c.totalDuration
        }))
    };
};

/**
 * Get component health summary (aggregated over time)
 */
healthCheckLogSchema.statics.getComponentSummary = async function(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const checks = await this.find({
        timestamp: { $gte: since }
    });
    
    const componentStats = {};
    
    checks.forEach(check => {
        check.checks.forEach(component => {
            if (!componentStats[component.name]) {
                componentStats[component.name] = {
                    name: component.name,
                    icon: component.icon,
                    total: 0,
                    passed: 0,
                    failed: 0,
                    warnings: 0,
                    avgResponseTime: 0,
                    responseTimes: []
                };
            }
            
            const stats = componentStats[component.name];
            stats.total += 1;
            
            if (component.status === 'PASS') {stats.passed += 1;}
            if (component.status === 'FAIL') {stats.failed += 1;}
            if (component.status === 'WARNING') {stats.warnings += 1;}
            
            if (component.responseTime) {
                stats.responseTimes.push(component.responseTime);
            }
        });
    });
    
    // Calculate averages
    Object.values(componentStats).forEach(stats => {
        if (stats.responseTimes.length > 0) {
            stats.avgResponseTime = Math.round(
                stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length
            );
        }
        delete stats.responseTimes;  // Don't need full array in response
        
        stats.uptime = stats.total > 0 ? (stats.passed / stats.total) * 100 : 0;
    });
    
    return componentStats;
};

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Compare with previous health check
 */
healthCheckLogSchema.methods.compareWithPrevious = async function() {
    const previous = await this.constructor.findOne({
        timestamp: { $lt: this.timestamp }
    }).sort({ timestamp: -1 }).limit(1);
    
    if (!previous) {
        return; // No previous check to compare
    }
    
    const degraded = [];
    const improved = [];
    
    this.checks.forEach(currentCheck => {
        const previousCheck = previous.checks.find(c => c.name === currentCheck.name);
        
        if (previousCheck) {
            // Check if status changed
            if (currentCheck.status === 'FAIL' && previousCheck.status === 'PASS') {
                degraded.push(currentCheck.name);
            }
            if (currentCheck.status === 'PASS' && previousCheck.status === 'FAIL') {
                improved.push(currentCheck.name);
            }
        }
    });
    
    this.comparison = {
        previousCheckId: previous._id,
        statusChanged: this.overallStatus !== previous.overallStatus,
        previousStatus: previous.overallStatus,
        degradedComponents: degraded,
        improvedComponents: improved
    };
    
    return this.save();
};

module.exports = mongoose.model('HealthCheckLog', healthCheckLogSchema);


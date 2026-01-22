// ============================================================================
// 🔔 MONGODB PERFORMANCE MONITOR
// ============================================================================
// Purpose: Auto-detect when MongoDB needs scaling and send proactive alerts
//
// Key Features:
// - Monitors MongoDB latency, memory, connections, and query performance
// - Detects when approaching capacity limits
// - Sends proactive upgrade recommendations
// - Integrates with Notification Center for visibility
// - Prevents performance degradation before users notice
//
// Usage:
//   const MongoDBPerformanceMonitor = require('./services/MongoDBPerformanceMonitor');
//   await MongoDBPerformanceMonitor.checkPerformanceAndAlert();
//
// Alert Triggers:
// - Latency consistently >50ms (WARN: Consider M30)
// - Latency consistently >100ms (CRITICAL: Upgrade to M30 NOW)
// - Memory usage >70% (WARN: Scale up soon)
// - Memory usage >85% (CRITICAL: Out of memory risk)
// - Connection count >80% of max (WARN: Connection pool exhausted)
//
// Related Files:
// - routes/admin/diag.js (health check integration)
// - services/AdminNotificationService.js (sends alerts)
// - models/AdminSettings.js (stores thresholds)
// ============================================================================

const mongoose = require('mongoose');
const AdminNotificationService = require('./AdminNotificationService');
const logger = require('../utils/logger');

class MongoDBPerformanceMonitor {
    
    // ========================================================================
    // PERFORMANCE THRESHOLDS
    // ========================================================================
    
    static THRESHOLDS = {
        // Latency thresholds (ms)
        LATENCY_WARN: 50,      // >50ms = Consider upgrade
        LATENCY_CRITICAL: 100, // >100ms = Upgrade NOW
        
        // Memory thresholds (%)
        MEMORY_WARN: 70,       // >70% = Scale up soon
        MEMORY_CRITICAL: 85,   // >85% = Out of memory risk
        
        // Connection thresholds (%)
        CONNECTIONS_WARN: 80,  // >80% of max = Pool exhausted
        
        // Tier capacity estimates (concurrent users)
        M10_CAPACITY: 2000,
        M30_CAPACITY: 10000,
        
        // Alert cooldown (prevent spam)
        ALERT_COOLDOWN_HOURS: 24
    };

    // Cache serverStatus permission state to avoid noisy warnings
    static serverStatusAllowed = true;
    static serverStatusWarned = false;
    
    // ========================================================================
    // MAIN: CHECK PERFORMANCE AND SEND ALERTS
    // ========================================================================
    
    static async checkPerformanceAndAlert() {
        try {
            console.log('🔍 [MONGO MONITOR] Starting performance check...');
            
            // Get MongoDB metrics
            const metrics = await this.gatherMetrics();
            
            // Analyze performance and determine if alert needed
            const analysis = this.analyzePerformance(metrics);
            
            // Send alert if thresholds exceeded and not in cooldown
            if (analysis.shouldAlert) {
                await this.sendUpgradeAlert(analysis);
            }
            
            console.log('✅ [MONGO MONITOR] Performance check complete');
            return { metrics, analysis };
            
        } catch (error) {
            console.error('❌ [MONGO MONITOR] Failed to check performance:', error);
            logger.error('MongoDB performance monitor failed', { error: error.message });
            throw error;
        }
    }
    
    // ========================================================================
    // GATHER MONGODB METRICS
    // ========================================================================
    
    static async gatherMetrics() {
        // Check if MongoDB is connected
        if (!mongoose.connection || mongoose.connection.readyState !== 1) {
            throw new Error('MongoDB not connected (readyState: ' + mongoose.connection?.readyState + ')');
        }
        
        const db = mongoose.connection.db;
        
        if (!db) {
            throw new Error('MongoDB database instance not available');
        }
        
        const admin = db.admin();
        
        // Get server status (detailed metrics) - may fail if no permissions
        let serverStatus;
        if (this.serverStatusAllowed) {
            try {
                serverStatus = await admin.serverStatus();
            } catch (error) {
                const isUnauthorized = error?.code === 13 || /not authorized|unauthorized/i.test(String(error?.message || ''));
                if (isUnauthorized) {
                    this.serverStatusAllowed = false;
                }
                if (!this.serverStatusWarned) {
                    this.serverStatusWarned = true;
                    console.warn('[MongoDB Monitor] ⚠️ Cannot get serverStatus (permission issue?):', error.message);
                    logger.warn('[MongoDB Monitor] serverStatus permission missing - skipping in future checks', {
                        code: error?.code,
                        message: error?.message
                    });
                }
            }
        }

        // Fallback: use limited metrics when serverStatus not available
        if (!serverStatus) {
            serverStatus = {
                mem: { resident: 0, virtual: 0 },
                connections: { current: 0, available: 1000 },
                opcounters: { insert: 0, query: 0, update: 0, delete: 0 }
            };
        }
        
        // Get database stats
        const dbStats = await db.stats();
        
        // Measure query latency (simple ping test)
        const startTime = performance.now();
        await db.admin().ping();
        const latencyMs = (performance.now() - startTime).toFixed(2);
        
        // Extract key metrics
        const metrics = {
            // Latency
            latency: parseFloat(latencyMs),
            
            // Memory
            memoryUsedMB: (serverStatus.mem.resident || 0),
            memoryVirtualMB: (serverStatus.mem.virtual || 0),
            
            // Connections
            currentConnections: serverStatus.connections.current || 0,
            availableConnections: serverStatus.connections.available || 0,
            totalConnections: (serverStatus.connections.current || 0) + (serverStatus.connections.available || 0),
            connectionUtilization: ((serverStatus.connections.current / ((serverStatus.connections.current || 0) + (serverStatus.connections.available || 0))) * 100).toFixed(2),
            
            // Storage
            dataSize: dbStats.dataSize,
            storageSize: dbStats.storageSize,
            indexSize: dbStats.indexSize,
            
            // Operations
            opsInsert: serverStatus.opcounters.insert || 0,
            opsQuery: serverStatus.opcounters.query || 0,
            opsUpdate: serverStatus.opcounters.update || 0,
            opsDelete: serverStatus.opcounters.delete || 0,
            
            // Tier detection
            detectedTier: this.detectTier(serverStatus.mem.resident),
            
            // Timestamp
            timestamp: new Date()
        };
        
        console.log('📊 [MONGO MONITOR] Metrics gathered:', {
            latency: `${metrics.latency}ms`,
            memory: `${metrics.memoryUsedMB}MB`,
            connections: `${metrics.currentConnections}/${metrics.totalConnections} (${metrics.connectionUtilization}%)`,
            tier: metrics.detectedTier
        });
        
        return metrics;
    }
    
    // ========================================================================
    // DETECT CURRENT TIER FROM MEMORY
    // ========================================================================
    
    static detectTier(residentMemoryMB) {
        // Rough tier detection based on memory
        if (residentMemoryMB < 500) return 'FLEX';
        if (residentMemoryMB < 1500) return 'M10';
        if (residentMemoryMB < 3000) return 'M20';
        if (residentMemoryMB < 6000) return 'M30';
        if (residentMemoryMB < 12000) return 'M40';
        return 'M50+';
    }
    
    // ========================================================================
    // ANALYZE PERFORMANCE AND DETERMINE IF ALERT NEEDED
    // ========================================================================
    
    static analyzePerformance(metrics) {
        const issues = [];
        let severity = 'INFO';
        let shouldAlert = false;
        let recommendedTier = null;
        
        // Check latency
        if (metrics.latency >= this.THRESHOLDS.LATENCY_CRITICAL) {
            issues.push(`Critical latency: ${metrics.latency}ms (threshold: ${this.THRESHOLDS.LATENCY_CRITICAL}ms)`);
            severity = 'CRITICAL';
            shouldAlert = true;
            recommendedTier = 'M30';
        } else if (metrics.latency >= this.THRESHOLDS.LATENCY_WARN) {
            issues.push(`High latency: ${metrics.latency}ms (threshold: ${this.THRESHOLDS.LATENCY_WARN}ms)`);
            severity = severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
            shouldAlert = true;
            recommendedTier = 'M30';
        }
        
        // Check memory (if available)
        if (metrics.memoryUsedMB > 0) {
            const estimatedMaxMemory = this.getMaxMemoryForTier(metrics.detectedTier);
            const memoryPercent = (metrics.memoryUsedMB / estimatedMaxMemory) * 100;
            
            if (memoryPercent >= this.THRESHOLDS.MEMORY_CRITICAL) {
                issues.push(`Critical memory usage: ${memoryPercent.toFixed(1)}% (${metrics.memoryUsedMB}MB / ${estimatedMaxMemory}MB)`);
                severity = 'CRITICAL';
                shouldAlert = true;
                recommendedTier = 'M30';
            } else if (memoryPercent >= this.THRESHOLDS.MEMORY_WARN) {
                issues.push(`High memory usage: ${memoryPercent.toFixed(1)}% (${metrics.memoryUsedMB}MB / ${estimatedMaxMemory}MB)`);
                severity = severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
                shouldAlert = true;
                recommendedTier = 'M30';
            }
        }
        
        // Check connections
        if (parseFloat(metrics.connectionUtilization) >= this.THRESHOLDS.CONNECTIONS_WARN) {
            issues.push(`High connection usage: ${metrics.connectionUtilization}% (${metrics.currentConnections}/${metrics.totalConnections})`);
            severity = severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';
            shouldAlert = true;
            recommendedTier = recommendedTier || 'M30';
        }
        
        // Tier-specific recommendations
        if (metrics.detectedTier === 'M10' && issues.length > 0) {
            recommendedTier = 'M30'; // Skip M20, go straight to M30 for headroom
        }
        
        return {
            severity,
            shouldAlert,
            issues,
            recommendedTier,
            currentTier: metrics.detectedTier,
            metrics
        };
    }
    
    // ========================================================================
    // GET MAX MEMORY FOR TIER
    // ========================================================================
    
    static getMaxMemoryForTier(tier) {
        const memoryMap = {
            'FLEX': 512,   // Shared, ~0.5 GB
            'M10': 2048,   // 2 GB
            'M20': 4096,   // 4 GB
            'M30': 8192,   // 8 GB
            'M40': 16384,  // 16 GB
            'M50+': 32768  // 32+ GB
        };
        return memoryMap[tier] || 2048;
    }
    
    // ========================================================================
    // SEND UPGRADE ALERT TO NOTIFICATION CENTER
    // ========================================================================
    
    static async sendUpgradeAlert(analysis) {
        try {
            // Check cooldown (don't spam alerts)
            const lastAlert = await this.getLastAlert();
            if (lastAlert && this.isInCooldown(lastAlert.createdAt)) {
                console.log('⏰ [MONGO MONITOR] Alert in cooldown period, skipping...');
                return;
            }
            
            // Build alert message
            const message = this.buildAlertMessage(analysis);
            
            // Send alert via AdminNotificationService
            await AdminNotificationService.sendAlert({
                code: 'MONGODB_PERFORMANCE_DEGRADED',
                severity: analysis.severity,
                companyId: null, // Platform-wide alert
                companyName: 'Platform',
                message: `MongoDB ${analysis.severity}: Performance degradation detected`,
                details: message,
                metadata: {
                    currentTier: analysis.currentTier,
                    recommendedTier: analysis.recommendedTier,
                    latency: analysis.metrics.latency,
                    issues: analysis.issues
                }
            });
            
            console.log(`🚨 [MONGO MONITOR] ${analysis.severity} alert sent!`);
            
        } catch (error) {
            console.error('❌ [MONGO MONITOR] Failed to send alert:', error);
            logger.error('Failed to send MongoDB performance alert', { error: error.message });
        }
    }
    
    // ========================================================================
    // BUILD ALERT MESSAGE
    // ========================================================================
    
    static buildAlertMessage(analysis) {
        const { severity, issues, recommendedTier, currentTier, metrics } = analysis;
        
        let message = `MongoDB Performance ${severity}\n\n`;
        message += `Current Tier: ${currentTier}\n`;
        message += `Recommended Tier: ${recommendedTier}\n\n`;
        message += `Issues Detected:\n`;
        issues.forEach(issue => {
            message += `  • ${issue}\n`;
        });
        message += `\n`;
        message += `Current Metrics:\n`;
        message += `  • Latency: ${metrics.latency}ms\n`;
        message += `  • Memory: ${metrics.memoryUsedMB}MB\n`;
        message += `  • Connections: ${metrics.currentConnections}/${metrics.totalConnections} (${metrics.connectionUtilization}%)\n`;
        message += `\n`;
        
        if (severity === 'CRITICAL') {
            message += `⚠️ ACTION REQUIRED: Upgrade to ${recommendedTier} immediately to prevent user-facing issues!\n\n`;
            message += `Steps:\n`;
            message += `1. Log into MongoDB Atlas\n`;
            message += `2. Select CA Project → Cluster0\n`;
            message += `3. Click "Edit Configuration"\n`;
            message += `4. Change tier to ${recommendedTier}\n`;
            message += `5. Confirm upgrade (~$389/month for M30)\n`;
        } else {
            message += `💡 RECOMMENDATION: Consider upgrading to ${recommendedTier} for improved performance and headroom.\n`;
        }
        
        return message;
    }
    
    // ========================================================================
    // COOLDOWN HELPERS
    // ========================================================================
    
    static async getLastAlert() {
        const NotificationLog = require('../models/NotificationLog');
        return await NotificationLog.findOne({
            code: 'MONGODB_PERFORMANCE_DEGRADED'
        }).sort({ createdAt: -1 });
    }
    
    static isInCooldown(lastAlertTime) {
        const cooldownMs = this.THRESHOLDS.ALERT_COOLDOWN_HOURS * 60 * 60 * 1000;
        const timeSinceLastAlert = Date.now() - new Date(lastAlertTime).getTime();
        return timeSinceLastAlert < cooldownMs;
    }
}

module.exports = MongoDBPerformanceMonitor;


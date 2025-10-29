// ============================================================================
// 💊 AI GATEWAY - HEALTH MONITOR SERVICE
// ============================================================================
// PURPOSE: Monitor health of OpenAI, MongoDB, Redis, 3-Tier system
// FEATURES: Connection testing, response time tracking, status reporting
// INTEGRATIONS: NotificationCenter, DependencyHealthMonitor
// CREATED: 2025-10-29
// ============================================================================

const OpenAI = require('openai');
const mongoose = require('mongoose');
const db = require('../../db');
const logger = require('../../utils/logger');
const AdminNotificationService = require('../AdminNotificationService');
const AdminSettings = require('../../models/AdminSettings');
const { AIGatewayHealthLog } = require('../../models/aiGateway');
const AlertEngine = require('./AlertEngine');
const DiagnosticEngine = require('./DiagnosticEngine');

class AIGatewayHealthMonitor {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [AI GATEWAY HEALTH] Initializing HealthMonitor...');
        
        this.openai = null;
        this.openaiEnabled = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';
        
        if (this.openaiEnabled && process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }
        
        // Instance variables for dynamic interval management
        this.currentInterval = null; // Store the setInterval ID
        this.config = null; // Current configuration
        
        console.log('✅ [AI GATEWAY HEALTH] HealthMonitor initialized');
    }
    
    // ========================================================================
    // 🤖 OPENAI HEALTH CHECK
    // ========================================================================
    
    async checkOpenAI() {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 1: Starting OpenAI Health Check
        // ────────────────────────────────────────────────────────────────────
        console.log('🔍 [AI GATEWAY HEALTH] CHECKPOINT 1: Starting OpenAI health check...');
        
        const result = {
            status: 'UNKNOWN',
            responseTime: null,
            model: process.env.LLM_MODEL || 'gpt-4o-mini',
            error: null,
            timestamp: new Date()
        };
        
        try {
            // Check if OpenAI is enabled
            if (!this.openaiEnabled) {
                console.log('⚙️ [AI GATEWAY HEALTH] CHECKPOINT 2: OpenAI not enabled (ENABLE_3_TIER_INTELLIGENCE=false)');
                result.status = 'NOT_CONFIGURED';
                result.error = 'OpenAI not enabled. Set ENABLE_3_TIER_INTELLIGENCE=true to enable.';
                return result;
            }
            
            if (!process.env.OPENAI_API_KEY) {
                console.log('⚙️ [AI GATEWAY HEALTH] CHECKPOINT 2: OpenAI API key missing');
                result.status = 'NOT_CONFIGURED';
                result.error = 'OPENAI_API_KEY not configured';
                return result;
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Making Test API Call
            // ────────────────────────────────────────────────────────────────
            console.log('📡 [AI GATEWAY HEALTH] CHECKPOINT 2: Making test OpenAI API call...');
            
            const startTime = Date.now();
            
            const completion = await this.openai.chat.completions.create({
                model: result.model,
                messages: [{ role: 'user', content: 'Health check - respond with OK' }],
                max_tokens: 5
            });
            
            result.responseTime = Date.now() - startTime;
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: API Call Successful
            // ────────────────────────────────────────────────────────────────
            console.log(`✅ [AI GATEWAY HEALTH] CHECKPOINT 3: OpenAI responded in ${result.responseTime}ms`);
            
            if (completion && completion.choices && completion.choices.length > 0) {
                result.status = 'HEALTHY';
                console.log('✅ [AI GATEWAY HEALTH] OpenAI status: HEALTHY');
            } else {
                result.status = 'DEGRADED';
                result.error = 'Unexpected response format';
                console.warn('⚠️ [AI GATEWAY HEALTH] OpenAI status: DEGRADED (unexpected response)');
            }
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Send warning if slow
            // ────────────────────────────────────────────────────────────────
            if (result.responseTime > 5000) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_GATEWAY_OPENAI_SLOW',
                    severity: 'WARNING',
                    message: `OpenAI response time exceeded 5 seconds: ${result.responseTime}ms`,
                    details: {
                        responseTime: result.responseTime,
                        threshold: 5000,
                        model: result.model
                    },
                    source: 'AIGatewayHealthMonitor'
                });
                console.log('📢 [AI GATEWAY HEALTH] NOTIFICATION: Sent AI_GATEWAY_OPENAI_SLOW warning');
            }
            
        } catch (error) {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT ERROR: API Call Failed
            // ────────────────────────────────────────────────────────────────
            console.error('❌ [AI GATEWAY HEALTH] CHECKPOINT ERROR: OpenAI health check failed');
            console.error('❌ [AI GATEWAY HEALTH] Error:', error.message);
            
            result.status = 'UNHEALTHY';
            result.error = error.message;
            
            logger.error('[AI GATEWAY HEALTH] OpenAI health check failed', {
                error: error.message,
                stack: error.stack
            });
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Send critical alert
            // ────────────────────────────────────────────────────────────────
            await AdminNotificationService.sendAlert({
                code: 'AI_GATEWAY_OPENAI_UNHEALTHY',
                severity: 'CRITICAL',
                message: `OpenAI health check failed: ${error.message}`,
                details: {
                    error: error.message,
                    stack: error.stack
                },
                source: 'AIGatewayHealthMonitor',
                actionLink: '/admin-global-instant-responses.html#ai-gateway'
            });
            console.log('📢 [AI GATEWAY HEALTH] NOTIFICATION: Sent AI_GATEWAY_OPENAI_UNHEALTHY critical alert');
        }
        
        return result;
    }
    
    // ========================================================================
    // 💾 MONGODB HEALTH CHECK
    // ========================================================================
    
    async checkMongoDB() {
        console.log('🔍 [AI GATEWAY HEALTH] CHECKPOINT 1: Starting MongoDB health check...');
        
        const result = {
            status: 'UNKNOWN',
            queryTime: null,
            error: null,
            timestamp: new Date()
        };
        
        try {
            const startTime = Date.now();
            
            // Simple ping to database
            await mongoose.connection.db.admin().ping();
            
            result.queryTime = Date.now() - startTime;
            result.status = 'HEALTHY';
            
            console.log(`✅ [AI GATEWAY HEALTH] MongoDB status: HEALTHY (${result.queryTime}ms)`);
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] MongoDB health check failed:', error.message);
            result.status = 'UNHEALTHY';
            result.error = error.message;
            
            await AdminNotificationService.sendAlert({
                code: 'AI_GATEWAY_MONGODB_UNHEALTHY',
                severity: 'CRITICAL',
                message: `MongoDB health check failed: ${error.message}`,
                details: { error: error.message },
                source: 'AIGatewayHealthMonitor'
            });
        }
        
        return result;
    }
    
    // ========================================================================
    // 🔴 REDIS HEALTH CHECK
    // ========================================================================
    
    async checkRedis() {
        console.log('🔍 [AI GATEWAY HEALTH] CHECKPOINT 1: Starting Redis health check...');
        
        const redisClient = db.redisClient;

        const result = {
            status: 'UNKNOWN',
            latency: null,
            error: null,
            timestamp: new Date(),
            metrics: {
                memoryUsed: null,
                memoryMax: null,
                memoryUsagePercent: null,
                connectedClients: null,
                evictedKeys: null,
                hitRate: null,
                opsPerSec: null
            }
        };
        
        try {
            const startTime = Date.now();
            
            // ────────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Check if Redis client exists
            // ────────────────────────────────────────────────────────────────────
            if (!redisClient || !redisClient.isReady) {
                result.status = 'UNKNOWN';
                result.error = 'Redis client not initialized (server may still be starting)';
                // Don't send alert during startup
                return result;
            }
            
            // ────────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Ping Redis (with 2s timeout)
            // ────────────────────────────────────────────────────────────────────
            await Promise.race([
                redisClient.ping(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Redis ping timeout')), 2000)
                )
            ]);
            
            result.latency = Date.now() - startTime;
            
            // ────────────────────────────────────────────────────────────────────
            // CHECKPOINT 4: Get Redis INFO metrics (with timeout protection)
            // ────────────────────────────────────────────────────────────────────
            try {
                const infoTimeout = 3000; // 3s timeout for INFO commands
                const info = await Promise.race([
                    redisClient.info('stats'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('INFO timeout')), infoTimeout))
                ]);
                const memory = await Promise.race([
                    redisClient.info('memory'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('INFO timeout')), infoTimeout))
                ]);
                const clients = await Promise.race([
                    redisClient.info('clients'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('INFO timeout')), infoTimeout))
                ]);
            
            // Parse memory metrics
            const memoryUsedMatch = memory.match(/used_memory:(\d+)/);
            const memoryMaxMatch = memory.match(/maxmemory:(\d+)/);
            const evictedKeysMatch = info.match(/evicted_keys:(\d+)/);
            
            // Parse client metrics
            const connectedClientsMatch = clients.match(/connected_clients:(\d+)/);
            
            // Parse hit rate metrics
            const hitsMatch = info.match(/keyspace_hits:(\d+)/);
            const missesMatch = info.match(/keyspace_misses:(\d+)/);
            const opsMatch = info.match(/instantaneous_ops_per_sec:(\d+)/);
            
            if (memoryUsedMatch && memoryMaxMatch) {
                const memoryUsed = parseInt(memoryUsedMatch[1]);
                const memoryMax = parseInt(memoryMaxMatch[1]);
                const memoryUsagePercent = memoryMax > 0 ? (memoryUsed / memoryMax) * 100 : 0;
                
                result.metrics.memoryUsed = memoryUsed;
                result.metrics.memoryMax = memoryMax;
                result.metrics.memoryUsagePercent = Math.round(memoryUsagePercent * 100) / 100;
            }
            
            if (connectedClientsMatch) {
                result.metrics.connectedClients = parseInt(connectedClientsMatch[1]);
            }
            
            if (evictedKeysMatch) {
                result.metrics.evictedKeys = parseInt(evictedKeysMatch[1]);
            }
            
            if (hitsMatch && missesMatch) {
                const hits = parseInt(hitsMatch[1]);
                const misses = parseInt(missesMatch[1]);
                const total = hits + misses;
                result.metrics.hitRate = total > 0 ? Math.round((hits / total) * 100 * 100) / 100 : 100;
            }
            
            if (opsMatch) {
                result.metrics.opsPerSec = parseInt(opsMatch[1]);
            }
            
            // ────────────────────────────────────────────────────────────────────
            // CHECKPOINT 5: Check thresholds and send proactive alerts
            // ────────────────────────────────────────────────────────────────────
            
            // 🚨 CRITICAL: Memory usage > 90%
            if (result.metrics.memoryUsagePercent > 90) {
                await AdminNotificationService.sendAlert({
                    code: 'REDIS_MEMORY_CRITICAL',
                    severity: 'CRITICAL',
                    message: `Redis memory usage at ${result.metrics.memoryUsagePercent}% - UPGRADE REQUIRED IMMEDIATELY`,
                    details: {
                        memoryUsed: `${(result.metrics.memoryUsed / 1024 / 1024).toFixed(2)} MB`,
                        memoryMax: `${(result.metrics.memoryMax / 1024 / 1024).toFixed(2)} MB`,
                        usagePercent: result.metrics.memoryUsagePercent,
                        recommendation: 'Upgrade Redis plan immediately to prevent data loss'
                    },
                    source: 'AIGatewayHealthMonitor'
                });
            }
            // ⚠️ WARNING: Memory usage > 80%
            else if (result.metrics.memoryUsagePercent > 80) {
                await AdminNotificationService.sendAlert({
                    code: 'REDIS_MEMORY_HIGH',
                    severity: 'WARNING',
                    message: `Redis memory usage at ${result.metrics.memoryUsagePercent}% - Consider upgrading soon`,
                    details: {
                        memoryUsed: `${(result.metrics.memoryUsed / 1024 / 1024).toFixed(2)} MB`,
                        memoryMax: `${(result.metrics.memoryMax / 1024 / 1024).toFixed(2)} MB`,
                        usagePercent: result.metrics.memoryUsagePercent,
                        recommendation: 'Plan Redis upgrade within 7 days'
                    },
                    source: 'AIGatewayHealthMonitor'
                });
            }
            
            // ⚠️ WARNING: Keys being evicted (memory pressure)
            if (result.metrics.evictedKeys > 100) {
                await AdminNotificationService.sendAlert({
                    code: 'REDIS_EVICTION_DETECTED',
                    severity: 'WARNING',
                    message: `Redis is evicting keys due to memory pressure (${result.metrics.evictedKeys} keys evicted)`,
                    details: {
                        evictedKeys: result.metrics.evictedKeys,
                        memoryUsagePercent: result.metrics.memoryUsagePercent,
                        recommendation: 'Upgrade Redis to prevent cache data loss'
                    },
                    source: 'AIGatewayHealthMonitor'
                });
            }
            
            // ⚠️ WARNING: Low cache hit rate (< 70%)
            if (result.metrics.hitRate !== null && result.metrics.hitRate < 70) {
                await AdminNotificationService.sendAlert({
                    code: 'REDIS_LOW_HIT_RATE',
                    severity: 'WARNING',
                    message: `Redis cache hit rate is low (${result.metrics.hitRate}%)`,
                    details: {
                        hitRate: result.metrics.hitRate,
                        recommendation: 'Low hit rate may indicate memory pressure or inefficient caching strategy'
                    },
                    source: 'AIGatewayHealthMonitor'
                });
            }
            
            // ⚠️ WARNING: Slow response time (> 100ms)
            if (result.latency > 100) {
                await AdminNotificationService.sendAlert({
                    code: 'REDIS_SLOW_RESPONSE',
                    severity: 'WARNING',
                    message: `Redis response time is slow (${result.latency}ms)`,
                    details: {
                        latency: result.latency,
                        threshold: 100,
                        recommendation: 'Check Redis connection or consider upgrading to faster tier'
                    },
                    source: 'AIGatewayHealthMonitor'
                });
            }
            
            } catch (metricsError) {
                // INFO commands timed out - Redis is responsive but slow
                // This is acceptable during cold start, mark as DEGRADED not UNHEALTHY
                console.warn(`⚠️ [AI GATEWAY HEALTH] Redis metrics unavailable: ${metricsError.message}`);
                result.status = 'DEGRADED';
                result.error = `Ping OK but metrics timed out: ${metricsError.message}`;
                return result;
            }
            
            result.status = 'HEALTHY';
            
            console.log(`✅ [AI GATEWAY HEALTH] Redis status: HEALTHY (${result.latency}ms)`);
            console.log(`📊 [AI GATEWAY HEALTH] Redis metrics:`, {
                memory: `${result.metrics.memoryUsagePercent}%`,
                clients: result.metrics.connectedClients,
                hitRate: `${result.metrics.hitRate}%`,
                opsPerSec: result.metrics.opsPerSec
            });
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Redis health check failed:', error.message);
            result.status = 'UNHEALTHY';
            result.error = error.message;
            
            await AdminNotificationService.sendAlert({
                code: 'AI_GATEWAY_REDIS_UNHEALTHY',
                severity: 'CRITICAL',
                message: `Redis health check failed: ${error.message}`,
                details: { error: error.message },
                source: 'AIGatewayHealthMonitor'
            });
        }
        
        return result;
    }
    
    // ========================================================================
    // 🎯 3-TIER SYSTEM STATUS CHECK
    // ========================================================================
    
    check3TierSystem() {
        console.log('🔍 [AI GATEWAY HEALTH] CHECKPOINT 1: Checking 3-Tier system status...');
        
        const result = {
            status: 'UNKNOWN',
            enabled: this.openaiEnabled,
            info: '',
            timestamp: new Date()
        };
        
        if (this.openaiEnabled) {
            result.status = 'ENABLED';
            result.info = '3-Tier Intelligence System is active';
            console.log('✅ [AI GATEWAY HEALTH] 3-Tier system: ENABLED');
        } else {
            result.status = 'DISABLED';
            result.info = 'Set ENABLE_3_TIER_INTELLIGENCE=true to enable';
            console.log('⚙️ [AI GATEWAY HEALTH] 3-Tier system: DISABLED');
        }
        
        return result;
    }
    
    // ========================================================================
    // 🏥 FULL HEALTH CHECK (ALL SYSTEMS)
    // ========================================================================
    
    async checkAllSystems() {
        console.log('🏥 [AI GATEWAY HEALTH] ═══════════════════════════════════════════');
        console.log('🏥 [AI GATEWAY HEALTH] FULL SYSTEM HEALTH CHECK STARTING');
        console.log('🏥 [AI GATEWAY HEALTH] ═══════════════════════════════════════════');
        
        const results = {
            timestamp: new Date(),
            openai: await this.checkOpenAI(),
            mongodb: await this.checkMongoDB(),
            redis: await this.checkRedis(),
            tier3System: this.check3TierSystem()
        };
        
        console.log('🏥 [AI GATEWAY HEALTH] ═══════════════════════════════════════════');
        console.log('🏥 [AI GATEWAY HEALTH] FULL HEALTH CHECK COMPLETE');
        console.log('🏥 [AI GATEWAY HEALTH] OpenAI:', results.openai.status);
        console.log('🏥 [AI GATEWAY HEALTH] MongoDB:', results.mongodb.status);
        console.log('🏥 [AI GATEWAY HEALTH] Redis:', results.redis.status);
        console.log('🏥 [AI GATEWAY HEALTH] 3-Tier:', results.tier3System.status);
        console.log('🏥 [AI GATEWAY HEALTH] ═══════════════════════════════════════════');
        
        return results;
    }
    
    // ========================================================================
    // ⏰ DYNAMIC INTERVAL MANAGEMENT (Enterprise-Grade)
    // ========================================================================
    
    /**
     * Load configuration from AdminSettings and start auto-ping
     */
    async startPeriodicHealthChecks() {
        console.log('⏰ [AI GATEWAY HEALTH] Loading configuration from AdminSettings...');
        
        try {
            // Load or create default config
            let settings = await AdminSettings.findOne();
            if (!settings) {
                console.log('⚙️ [AI GATEWAY HEALTH] No AdminSettings found, creating defaults...');
                settings = await AdminSettings.create({});
            }
            
            this.config = settings.aiGatewayHealthCheck;
            
            // Check if enabled
            if (!this.config.enabled) {
                console.log('⚙️ [AI GATEWAY HEALTH] Auto-ping is DISABLED in settings');
                return;
            }
            
            console.log(`⏰ [AI GATEWAY HEALTH] Auto-ping enabled: every ${this.config.interval.value} ${this.config.interval.unit}`);
            console.log(`📢 [AI GATEWAY HEALTH] Notification mode: ${this.config.notificationMode}`);
            
            // Run immediately
            await this.runHealthCheckAndLog('auto');
            
            // Schedule recurring checks
            this.scheduleNextCheck();
            
            console.log('✅ [AI GATEWAY HEALTH] Periodic health checks started');
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to start periodic checks:', error.message);
        }
    }
    
    /**
     * Schedule the next health check based on current config
     */
    scheduleNextCheck() {
        // Clear existing interval if any
        if (this.currentInterval) {
            clearInterval(this.currentInterval);
            this.currentInterval = null;
        }
        
        // Calculate interval in milliseconds
        const intervalMs = this.convertToMilliseconds(
            this.config.interval.value,
            this.config.interval.unit
        );
        
        // Calculate next check time
        const nextCheck = new Date(Date.now() + intervalMs);
        
        console.log(`⏰ [AI GATEWAY HEALTH] Next check scheduled for: ${nextCheck.toLocaleString()}`);
        
        // Update AdminSettings with next check time
        this.updateNextCheckTime(nextCheck);
        
        // Schedule the interval
        this.currentInterval = setInterval(async () => {
            await this.runHealthCheckAndLog('auto');
        }, intervalMs);
    }
    
    /**
     * Convert interval value + unit to milliseconds
     */
    convertToMilliseconds(value, unit) {
        const multipliers = {
            minutes: 60 * 1000,
            hours: 60 * 60 * 1000,
            days: 24 * 60 * 60 * 1000
        };
        
        return value * (multipliers[unit] || multipliers.hours);
    }
    
    /**
     * Update next check time in database
     */
    async updateNextCheckTime(nextCheck) {
        try {
            await AdminSettings.updateOne(
                {},
                {
                    $set: {
                        'aiGatewayHealthCheck.nextScheduledCheck': nextCheck
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to update next check time:', error.message);
        }
    }
    
    /**
     * Run health check and save to database
     */
    async runHealthCheckAndLog(type, triggeredBy = 'auto-ping') {
        console.log(`🏥 [AI GATEWAY HEALTH] Running ${type} health check...`);
        
        try {
            // Run all health checks
            const results = await this.checkAllSystems();
            
            // Determine overall status
            let overallStatus = 'ALL_HEALTHY';
            let unhealthyCount = 0;
            
            if (results.openai.status !== 'HEALTHY' && results.openai.status !== 'NOT_CONFIGURED') unhealthyCount++;
            if (results.mongodb.status !== 'HEALTHY') unhealthyCount++;
            if (results.redis.status !== 'HEALTHY') unhealthyCount++;
            
            if (unhealthyCount === 0) {
                overallStatus = 'ALL_HEALTHY';
            } else if (unhealthyCount <= 1) {
                overallStatus = 'DEGRADED';
            } else {
                overallStatus = 'CRITICAL';
            }
            
            // Calculate total response time
            const totalResponseTime = 
                (results.openai.responseTime || 0) +
                (results.mongodb.queryTime || 0) +
                (results.redis.latency || 0);
            
            // ────────────────────────────────────────────────────────────────────
            // 🔬 RUN DIAGNOSTIC ANALYSIS
            // ────────────────────────────────────────────────────────────────────
            
            console.log('🔬 [AI GATEWAY HEALTH] Running diagnostic analysis...');
            const diagnostics = DiagnosticEngine.analyzeHealthCheck(results);
            
            // Add overallStatus to results for diagnostics
            results.overallStatus = overallStatus;
            
            // ────────────────────────────────────────────────────────────────────
            // 💾 SAVE TO DATABASE (with diagnostics)
            // ────────────────────────────────────────────────────────────────────
            
            const healthLog = await AIGatewayHealthLog.create({
                timestamp: results.timestamp,
                type,
                triggeredBy,
                openai: {
                    status: results.openai.status,
                    responseTime: results.openai.responseTime,
                    error: results.openai.error,
                    details: {
                        model: results.openai.model
                    }
                },
                mongodb: {
                    status: results.mongodb.status,
                    responseTime: results.mongodb.queryTime,
                    error: results.mongodb.error
                },
                redis: {
                    status: results.redis.status,
                    responseTime: results.redis.latency,
                    error: results.redis.error
                },
                tier3System: results.tier3System,
                overallStatus,
                unhealthyCount,
                totalResponseTime,
                
                // ═══ DIAGNOSTIC FIELDS ═══
                rootCauseAnalysis: diagnostics.rootCauseAnalysis,
                suggestedFixes: diagnostics.suggestedFixes,
                affectedSystems: diagnostics.affectedSystems,
                diagnosticDetails: diagnostics.diagnosticDetails,
                reportFormatted: diagnostics.reportFormatted,
                severity: diagnostics.severity
            });
            
            console.log(`✅ [AI GATEWAY HEALTH] Health check logged: ${overallStatus} (${unhealthyCount} unhealthy)`);
            
            // Update stats in AdminSettings
            await this.updateStats(overallStatus, results);
            
            // Send notification if needed
            await this.sendNotificationIfNeeded(overallStatus, results);
            
            // Evaluate alert rules (Phase 2)
            await AlertEngine.evaluateRules(results, triggeredBy);
            
            return { results, healthLog };
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to run health check:', error.message);
            throw error;
        }
    }
    
    /**
     * Update statistics in AdminSettings
     */
    async updateStats(overallStatus, results) {
        try {
            const update = {
                $inc: {
                    'aiGatewayHealthCheck.stats.totalChecks': 1
                },
                $set: {
                    'aiGatewayHealthCheck.lastCheck': new Date()
                }
            };
            
            if (overallStatus === 'ALL_HEALTHY') {
                update.$inc['aiGatewayHealthCheck.stats.healthyChecks'] = 1;
            } else {
                update.$inc['aiGatewayHealthCheck.stats.errorChecks'] = 1;
                
                // Update last error
                const unhealthyService = 
                    results.openai.status !== 'HEALTHY' ? 'openai' :
                    results.mongodb.status !== 'HEALTHY' ? 'mongodb' :
                    results.redis.status !== 'HEALTHY' ? 'redis' : null;
                
                if (unhealthyService) {
                    update.$set['aiGatewayHealthCheck.stats.lastError'] = {
                        service: unhealthyService,
                        message: results[unhealthyService].error || 'Unknown error',
                        timestamp: new Date()
                    };
                }
            }
            
            await AdminSettings.updateOne({}, update, { upsert: true });
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to update stats:', error.message);
        }
    }
    
    /**
     * Send notification based on notification mode and health status
     */
    async sendNotificationIfNeeded(overallStatus, results) {
        try {
            if (!this.config) return;
            
            const mode = this.config.notificationMode;
            
            // Never mode: no notifications
            if (mode === 'never') {
                return;
            }
            
            // Errors only mode: only notify on degraded/critical
            if (mode === 'errors_only' && overallStatus === 'ALL_HEALTHY') {
                return;
            }
            
            // Always mode: send notification for all checks
            if (mode === 'always' || overallStatus !== 'ALL_HEALTHY') {
                const severity = overallStatus === 'CRITICAL' ? 'CRITICAL' : 
                                 overallStatus === 'DEGRADED' ? 'WARNING' : 'INFO';
                
                const message = overallStatus === 'ALL_HEALTHY' ?
                    'All AI Gateway systems healthy' :
                    `AI Gateway health check: ${overallStatus}`;
                
                await AdminNotificationService.sendAlert({
                    code: `AI_GATEWAY_HEALTH_${overallStatus}`,
                    severity,
                    message,
                    details: {
                        openai: results.openai.status,
                        mongodb: results.mongodb.status,
                        redis: results.redis.status,
                        tier3: results.tier3System.status
                    },
                    source: 'AIGatewayHealthMonitor'
                });
                
                console.log(`📢 [AI GATEWAY HEALTH] Sent ${severity} notification: ${message}`);
            }
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to send notification:', error.message);
        }
    }
    
    /**
     * Dynamically update interval without server restart
     */
    async updateInterval(newValue, newUnit, notificationMode) {
        console.log(`🔄 [AI GATEWAY HEALTH] Updating interval to: ${newValue} ${newUnit}, notifications: ${notificationMode}`);
        
        try {
            // Update in database
            await AdminSettings.updateOne(
                {},
                {
                    $set: {
                        'aiGatewayHealthCheck.interval.value': newValue,
                        'aiGatewayHealthCheck.interval.unit': newUnit,
                        'aiGatewayHealthCheck.notificationMode': notificationMode
                    }
                },
                { upsert: true }
            );
            
            // Reload config
            const settings = await AdminSettings.findOne();
            this.config = settings.aiGatewayHealthCheck;
            
            // Reschedule checks
            this.scheduleNextCheck();
            
            console.log('✅ [AI GATEWAY HEALTH] Interval updated successfully');
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to update interval:', error.message);
            throw error;
        }
    }
    
    /**
     * Enable or disable auto-ping
     */
    async setEnabled(enabled) {
        console.log(`🔄 [AI GATEWAY HEALTH] ${enabled ? 'Enabling' : 'Disabling'} auto-ping...`);
        
        try {
            await AdminSettings.updateOne(
                {},
                {
                    $set: {
                        'aiGatewayHealthCheck.enabled': enabled
                    }
                },
                { upsert: true }
            );
            
            if (enabled) {
                await this.startPeriodicHealthChecks();
            } else {
                if (this.currentInterval) {
                    clearInterval(this.currentInterval);
                    this.currentInterval = null;
                }
            }
            
            console.log(`✅ [AI GATEWAY HEALTH] Auto-ping ${enabled ? 'enabled' : 'disabled'}`);
            
            return { success: true };
            
        } catch (error) {
            console.error('❌ [AI GATEWAY HEALTH] Failed to set enabled state:', error.message);
            throw error;
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new AIGatewayHealthMonitor();


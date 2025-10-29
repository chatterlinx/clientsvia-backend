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
const { redisClient } = require('../../db');
const logger = require('../../utils/logger');
const AdminNotificationService = require('../AdminNotificationService');

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
        
        const result = {
            status: 'UNKNOWN',
            latency: null,
            error: null,
            timestamp: new Date()
        };
        
        try {
            const startTime = Date.now();
            
            // Check if Redis client exists
            if (!redisClient) {
                throw new Error('Redis client not initialized');
            }
            
            // Simple ping to Redis
            await redisClient.ping();
            
            result.latency = Date.now() - startTime;
            result.status = 'HEALTHY';
            
            console.log(`✅ [AI GATEWAY HEALTH] Redis status: HEALTHY (${result.latency}ms)`);
            
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
    // ⏰ PERIODIC HEALTH CHECKS (8-hour interval)
    // ========================================================================
    
    startPeriodicHealthChecks() {
        console.log('⏰ [AI GATEWAY HEALTH] Starting periodic health checks (every 8 hours)...');
        
        // Run immediately
        this.checkAllSystems();
        
        // Then every 8 hours
        setInterval(() => {
            this.checkAllSystems();
        }, 8 * 60 * 60 * 1000); // 8 hours
        
        console.log('✅ [AI GATEWAY HEALTH] Periodic health checks scheduled');
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new AIGatewayHealthMonitor();


// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================
// 📋 PURPOSE: System health verification for all 3 new systems
// 🎯 FEATURES:
//    - Check MongoDB connection
//    - Check Redis connection
//    - Verify critical collections exist
//    - Test AI Performance endpoints readiness
//    - Test Call Archives readiness
//    - Test Spam Filter readiness
// 🔒 AUTH: Public (no auth required for health checks)
// ============================================================================

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { redisClient } = require('../clients');

// ============================================================================
// COMPREHENSIVE HEALTH CHECK
// ============================================================================
router.get('/health', async (req, res) => {
    try {
        console.log('🏥 [HEALTH CHECK] Starting comprehensive system check...');

        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            systems: {
                mongodb: 'unknown',
                redis: 'unknown',
                aiPerformance: 'unknown',
                callArchives: 'unknown',
                spamFilter: 'unknown'
            },
            details: {}
        };

        // ================================================================
        // CHECK 1: MongoDB Connection
        // ================================================================
        try {
            if (mongoose.connection.readyState === 1) {
                health.systems.mongodb = 'ok';
                health.details.mongodb = {
                    status: 'connected',
                    host: mongoose.connection.host,
                    database: mongoose.connection.name
                };
                console.log('✅ [HEALTH CHECK] MongoDB: Connected');
            } else {
                health.systems.mongodb = 'error';
                health.status = 'degraded';
                health.details.mongodb = {
                    status: 'disconnected',
                    readyState: mongoose.connection.readyState
                };
                console.error('❌ [HEALTH CHECK] MongoDB: Disconnected');
            }
        } catch (error) {
            health.systems.mongodb = 'error';
            health.status = 'degraded';
            health.details.mongodb = { error: error.message };
            console.error('❌ [HEALTH CHECK] MongoDB error:', error);
        }

        // ================================================================
        // CHECK 2: Redis Connection
        // ================================================================
        try {
            if (redisClient && redisClient.isOpen) {
                // Test Redis with a ping
                await redisClient.ping();
                health.systems.redis = 'ok';
                health.details.redis = {
                    status: 'connected',
                    isOpen: redisClient.isOpen
                };
                console.log('✅ [HEALTH CHECK] Redis: Connected');
            } else {
                health.systems.redis = 'error';
                health.status = 'degraded';
                health.details.redis = {
                    status: 'disconnected',
                    isOpen: redisClient ? redisClient.isOpen : false
                };
                console.error('❌ [HEALTH CHECK] Redis: Disconnected');
            }
        } catch (error) {
            health.systems.redis = 'error';
            health.status = 'degraded';
            health.details.redis = { error: error.message };
            console.error('❌ [HEALTH CHECK] Redis error:', error);
        }

        // ================================================================
        // CHECK 3: AI Performance System (System 1)
        // ================================================================
        try {
            const v2AIPerformanceMetric = require('../models/v2AIPerformanceMetric');
            const sampleMetric = await v2AIPerformanceMetric.findOne().limit(1);
            health.systems.aiPerformance = 'ok';
            health.details.aiPerformance = {
                status: 'ready',
                hasData: !!sampleMetric,
                message: sampleMetric ? 'Model and data accessible' : 'Model ready, no data yet'
            };
            console.log('✅ [HEALTH CHECK] AI Performance: Ready');
        } catch (error) {
            health.systems.aiPerformance = 'error';
            health.status = 'degraded';
            health.details.aiPerformance = { error: error.message };
            console.error('❌ [HEALTH CHECK] AI Performance error:', error);
        }

        // ================================================================
        // CHECK 4: Call Archives System (System 2)
        // ================================================================
        try {
            const v2AIAgentCallLog = require('../models/v2AIAgentCallLog');
            
            // Check if text index exists
            const indexes = await v2AIAgentCallLog.collection.getIndexes();
            const hasTextIndex = Object.keys(indexes).some(key => 
                key.includes('conversation.fullTranscript.plainText_text')
            );
            
            const sampleCall = await v2AIAgentCallLog.findOne().limit(1);
            
            health.systems.callArchives = 'ok';
            health.details.callArchives = {
                status: 'ready',
                hasData: !!sampleCall,
                textIndexExists: hasTextIndex,
                totalIndexes: Object.keys(indexes).length,
                message: hasTextIndex ? 'Search ready' : 'Warning: Text index missing'
            };
            
            if (!hasTextIndex) {
                health.status = 'degraded';
                console.warn('⚠️ [HEALTH CHECK] Call Archives: Text index missing!');
            } else {
                console.log('✅ [HEALTH CHECK] Call Archives: Ready with text index');
            }
        } catch (error) {
            health.systems.callArchives = 'error';
            health.status = 'degraded';
            health.details.callArchives = { error: error.message };
            console.error('❌ [HEALTH CHECK] Call Archives error:', error);
        }

        // ================================================================
        // CHECK 5: Spam Filter System (System 3)
        // ================================================================
        try {
            const v2Company = require('../models/v2Company');
            const BlockedCallLog = require('../models/BlockedCallLog');
            
            // Check if spam filter schema exists in companies
            const sampleCompany = await v2Company.findOne({ 'callFiltering': { $exists: true } }).limit(1);
            const sampleBlockedCall = await BlockedCallLog.findOne().limit(1);
            
            health.systems.spamFilter = 'ok';
            health.details.spamFilter = {
                status: 'ready',
                companiesWithSpamFilter: !!sampleCompany,
                hasBlockedCallLogs: !!sampleBlockedCall,
                message: 'Spam filter models ready'
            };
            console.log('✅ [HEALTH CHECK] Spam Filter: Ready');
        } catch (error) {
            health.systems.spamFilter = 'error';
            health.status = 'degraded';
            health.details.spamFilter = { error: error.message };
            console.error('❌ [HEALTH CHECK] Spam Filter error:', error);
        }

        // ================================================================
        // FINAL STATUS DETERMINATION
        // ================================================================
        const failedSystems = Object.values(health.systems).filter(s => s === 'error').length;
        
        if (failedSystems === 0) {
            health.status = 'ok';
            console.log('🎉 [HEALTH CHECK] All systems operational!');
        } else if (failedSystems < 3) {
            health.status = 'degraded';
            console.warn(`⚠️ [HEALTH CHECK] ${failedSystems} system(s) degraded`);
        } else {
            health.status = 'error';
            console.error(`❌ [HEALTH CHECK] ${failedSystems} system(s) down`);
        }

        // ================================================================
        // RESPONSE
        // ================================================================
        const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 207 : 503;
        
        res.status(statusCode).json({
            success: health.status === 'ok',
            data: health
        });

    } catch (error) {
        console.error('❌ [HEALTH CHECK] Critical error:', error);
        res.status(500).json({
            success: false,
            status: 'error',
            message: 'Health check failed',
            error: error.message
        });
    }
});

// ============================================================================
// SIMPLE PING ENDPOINT
// ============================================================================
router.get('/ping', (req, res) => {
    res.json({ 
        success: true, 
        message: 'pong',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;


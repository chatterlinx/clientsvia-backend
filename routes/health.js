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
const logger = require('../utils/logger.js');

const router = express.Router();
const mongoose = require('mongoose');
const { redisClient } = require('../clients');

// ============================================================================
// COMPREHENSIVE HEALTH CHECK
// ============================================================================
router.get('/health', async (req, res) => {
    try {
        logger.debug('🏥 [HEALTH CHECK] Starting comprehensive system check...');

        const health = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            systems: {
                mongodb: 'unknown',
                redis: 'unknown',
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
                logger.info('✅ [HEALTH CHECK] MongoDB: Connected');
            } else {
                health.systems.mongodb = 'error';
                health.status = 'degraded';
                health.details.mongodb = {
                    status: 'disconnected',
                    readyState: mongoose.connection.readyState
                };
                logger.error('❌ [HEALTH CHECK] MongoDB: Disconnected');
            }
        } catch (error) {
            health.systems.mongodb = 'error';
            health.status = 'degraded';
            health.details.mongodb = { error: error.message };
            logger.error('❌ [HEALTH CHECK] MongoDB error:', error);
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
                logger.info('✅ [HEALTH CHECK] Redis: Connected');
            } else {
                health.systems.redis = 'error';
                health.status = 'degraded';
                health.details.redis = {
                    status: 'disconnected',
                    isOpen: redisClient ? redisClient.isOpen : false
                };
                logger.error('❌ [HEALTH CHECK] Redis: Disconnected');
            }
        } catch (error) {
            health.systems.redis = 'error';
            health.status = 'degraded';
            health.details.redis = { error: error.message };
            logger.error('❌ [HEALTH CHECK] Redis error:', error);
        }

        // ================================================================
        // CHECK 3: Call Archives System
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
                hasData: Boolean(sampleCall),
                textIndexExists: hasTextIndex,
                totalIndexes: Object.keys(indexes).length,
                message: hasTextIndex ? 'Search ready' : 'Warning: Text index missing'
            };
            
            if (!hasTextIndex) {
                health.status = 'degraded';
                logger.warn('⚠️ [HEALTH CHECK] Call Archives: Text index missing!');
            } else {
                logger.info('✅ [HEALTH CHECK] Call Archives: Ready with text index');
            }
        } catch (error) {
            health.systems.callArchives = 'error';
            health.status = 'degraded';
            health.details.callArchives = { error: error.message };
            logger.error('❌ [HEALTH CHECK] Call Archives error:', error);
        }

        // ================================================================
        // CHECK 4: Spam Filter System
        // ================================================================
        try {
            const v2Company = require('../models/v2Company');
            const BlockedCallLog = require('../models/BlockedCallLog');
            
            // Check if spam filter schema exists in companies
            const sampleCompany = await v2Company.findOne({ callFiltering: { $exists: true } }).limit(1);
            const sampleBlockedCall = await BlockedCallLog.findOne().limit(1);
            
            health.systems.spamFilter = 'ok';
            health.details.spamFilter = {
                status: 'ready',
                companiesWithSpamFilter: Boolean(sampleCompany),
                hasBlockedCallLogs: Boolean(sampleBlockedCall),
                message: 'Spam filter models ready'
            };
            logger.security('✅ [HEALTH CHECK] Spam Filter: Ready');
        } catch (error) {
            health.systems.spamFilter = 'error';
            health.status = 'degraded';
            health.details.spamFilter = { error: error.message };
            logger.error('❌ [HEALTH CHECK] Spam Filter error:', error);
        }

        // ================================================================
        // FINAL STATUS DETERMINATION
        // ================================================================
        const failedSystems = Object.values(health.systems).filter(s => s === 'error').length;
        
        if (failedSystems === 0) {
            health.status = 'ok';
            logger.info('🎉 [HEALTH CHECK] All systems operational!');
        } else if (failedSystems < 3) {
            health.status = 'degraded';
            logger.warn(`⚠️ [HEALTH CHECK] ${failedSystems} system(s) degraded`);
        } else {
            health.status = 'error';
            logger.error(`❌ [HEALTH CHECK] ${failedSystems} system(s) down`);
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
        logger.error('❌ [HEALTH CHECK] Critical error:', error);
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

// ============================================================================
// VERSION ENDPOINT (PUBLIC - No Auth Required)
// ============================================================================
// Quick check to verify which version of code is deployed
// Usage: curl https://clientsvia-backend.onrender.com/api/version
// ============================================================================
router.get('/version', (req, res) => {
    // Lazy load to avoid circular dependencies
    let engineVersion = 'UNKNOWN';
    let llmVersion = 'UNKNOWN';
    
    try {
        // Get ConversationEngine version
        const ConversationEngine = require('../services/ConversationEngine');
        engineVersion = ConversationEngine.ENGINE_VERSION || 'NOT_EXPORTED';
    } catch (e) {
        engineVersion = `ERROR: ${e.message}`;
    }
    
    try {
        // Get HybridReceptionistLLM version
        const HybridReceptionistLLM = require('../services/HybridReceptionistLLM');
        llmVersion = HybridReceptionistLLM.LLM_VERSION || 'NOT_EXPORTED';
    } catch (e) {
        llmVersion = `ERROR: ${e.message}`;
    }
    
    res.json({
        success: true,
        versions: {
            conversationEngine: engineVersion,
            hybridReceptionistLLM: llmVersion
        },
        deployed: new Date().toISOString(),
        node: process.version,
        env: process.env.NODE_ENV || 'development'
    });
});

module.exports = router;


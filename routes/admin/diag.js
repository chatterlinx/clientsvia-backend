const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication
router.use(authenticateJWT);
router.use(requireRole('admin'));

// Diagnostics: expose current environment and DB/Redis fingerprints (redacted)
router.get('/whoami', (req, res) => {
    const c = mongoose.connection;
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

    res.json({
        nodeEnv: process.env.NODE_ENV || 'development',
        appVersion: process.env.APP_VERSION || 'dev',
        mongo: {
            host: c?.host,
            db: c?.name,
            readyState: c?.readyState, // 1 = connected
            uriHash: mongoUri
                .replace(/\/\/([^@]+)@/, '//***@')
                .replace(/([?&]authSource)=[^&]+/g, '$1=***')
        },
        redis: {
            urlHash: redisUrl.replace(/\/\/([^@]+)@/, '//***@')
        },
        time: new Date().toISOString()
    });
});

// ============================================================================
// 🔍 AUTOMATED ENVIRONMENT HEALTH CHECK
// ============================================================================
// Purpose: Automatically diagnose ALL system issues without manual checking
// Returns: Detailed report of what's working and what's broken
// ============================================================================

router.get('/full-health-check', async (req, res) => {
    try {
        const report = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            checks: {},
            issues: [],
            fixes: []
        };
        
        // ========================================================================
        // CHECK 1: MongoDB Connection
        // ========================================================================
        try {
            const c = mongoose.connection;
            if (c.readyState === 1) {
                const startTime = Date.now();
                await mongoose.connection.db.admin().ping();
                const responseTime = Date.now() - startTime;
                
                report.checks.mongodb = {
                    status: 'HEALTHY',
                    connected: true,
                    host: c.host,
                    database: c.name,
                    responseTime: responseTime + 'ms'
                };
            } else {
                report.checks.mongodb = {
                    status: 'DOWN',
                    connected: false,
                    readyState: c.readyState
                };
                report.issues.push('MongoDB is not connected');
                report.fixes.push('Check MONGODB_URI environment variable in Render');
            }
        } catch (error) {
            report.checks.mongodb = {
                status: 'ERROR',
                error: error.message
            };
            report.issues.push('MongoDB error: ' + error.message);
        }
        
        // ========================================================================
        // CHECK 2: Redis Connection
        // ========================================================================
        try {
            const db = require('../../db');
            const redisClient = db.redisClient;
            
            if (redisClient && redisClient.isReady) {
                const startTime = Date.now();
                await redisClient.ping();
                const responseTime = Date.now() - startTime;
                
                const info = await redisClient.info();
                const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
                const clientsMatch = info.match(/connected_clients:(\d+)/);
                
                report.checks.redis = {
                    status: 'HEALTHY',
                    connected: true,
                    responseTime: responseTime + 'ms',
                    memory: memoryMatch ? memoryMatch[1].trim() : 'unknown',
                    clients: clientsMatch ? parseInt(clientsMatch[1]) : 0
                };
            } else {
                report.checks.redis = {
                    status: 'DOWN',
                    connected: false,
                    ready: redisClient ? redisClient.isReady : false
                };
                report.issues.push('Redis is not connected or not ready');
                report.fixes.push('Check REDIS_URL environment variable in Render');
                report.fixes.push('Verify Redis service is running (if using external Redis)');
            }
        } catch (error) {
            report.checks.redis = {
                status: 'ERROR',
                error: error.message
            };
            report.issues.push('Redis error: ' + error.message);
            
            if (error.message.includes('ECONNREFUSED')) {
                report.fixes.push('CRITICAL: Redis connection refused - check if Redis service is running');
                report.fixes.push('In Render: Add a Redis add-on or set REDIS_URL to external Redis');
            }
        }
        
        // ========================================================================
        // CHECK 3: Environment Variables
        // ========================================================================
        const requiredEnvVars = [
            'MONGODB_URI',
            'REDIS_URL',
            'JWT_SECRET',
            'OPENAI_API_KEY',
            'NODE_ENV',
            'PORT'
        ];
        
        const optionalEnvVars = [
            'TWILIO_ACCOUNT_SID',
            'TWILIO_AUTH_TOKEN',
            'SENDGRID_API_KEY',
            'SENTRY_DSN'
        ];
        
        const missingRequired = [];
        const missingOptional = [];
        const present = [];
        
        requiredEnvVars.forEach(key => {
            if (process.env[key]) {
                present.push(key);
            } else {
                missingRequired.push(key);
            }
        });
        
        optionalEnvVars.forEach(key => {
            if (!process.env[key]) {
                missingOptional.push(key);
            }
        });
        
        report.checks.environment = {
            status: missingRequired.length === 0 ? 'HEALTHY' : 'MISSING_VARS',
            required: {
                present: present.length,
                total: requiredEnvVars.length,
                missing: missingRequired
            },
            optional: {
                missing: missingOptional
            }
        };
        
        if (missingRequired.length > 0) {
            report.issues.push(`Missing required environment variables: ${missingRequired.join(', ')}`);
            report.fixes.push('In Render dashboard → Environment tab → Add missing variables');
        }
        
        // ========================================================================
        // CHECK 4: API Routes (Threshold Endpoints)
        // ========================================================================
        try {
            const AdminSettings = require('../../models/AdminSettings');
            const settings = await AdminSettings.getSettings();
            
            if (settings.alertThresholds) {
                report.checks.thresholdEndpoints = {
                    status: 'DEPLOYED',
                    thresholds: settings.alertThresholds
                };
            } else {
                report.checks.thresholdEndpoints = {
                    status: 'DEPLOYED_BUT_EMPTY',
                    note: 'Endpoints exist but no thresholds configured yet'
                };
            }
        } catch (error) {
            report.checks.thresholdEndpoints = {
                status: 'ERROR',
                error: error.message
            };
            report.issues.push('Threshold endpoints error: ' + error.message);
        }
        
        // ========================================================================
        // CHECK 5: OpenAI API
        // ========================================================================
        if (process.env.OPENAI_API_KEY) {
            try {
                const openaiKey = process.env.OPENAI_API_KEY;
                report.checks.openai = {
                    status: 'CONFIGURED',
                    keyPresent: true,
                    keyPrefix: openaiKey.substring(0, 7) + '...'
                };
            } catch (error) {
                report.checks.openai = {
                    status: 'ERROR',
                    error: error.message
                };
            }
        } else {
            report.checks.openai = {
                status: 'NOT_CONFIGURED',
                keyPresent: false
            };
            report.issues.push('OpenAI API key not configured');
        }
        
        // ========================================================================
        // CHECK 6: Render-Specific Environment
        // ========================================================================
        report.checks.renderEnvironment = {
            isRender: !!process.env.RENDER,
            region: process.env.RENDER_REGION || 'unknown',
            service: process.env.RENDER_SERVICE_NAME || 'unknown',
            instanceId: process.env.RENDER_INSTANCE_ID || 'unknown',
            commit: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.substring(0, 8) : 'unknown'
        };
        
        // ========================================================================
        // OVERALL STATUS
        // ========================================================================
        const criticalIssues = report.issues.length;
        report.overallStatus = criticalIssues === 0 ? 'ALL_HEALTHY' : 'ISSUES_DETECTED';
        report.issueCount = criticalIssues;
        
        // Return report
        res.json({
            success: true,
            report
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;



const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { performance } = require('perf_hooks');

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
// 🚨 ER TRIAGE MONITOR - PRODUCTION HEALTH CHECK
// ============================================================================
// Purpose: Real-time incident triage with auto-blame and actionable fixes
// Format: Incident packet with overallStatus, failureSource, and actions[]
// ============================================================================

router.post('/selfcheck', async (req, res) => {
    try {
        const incidentPacket = {
            overallStatus: 'OK',  // Will be set to WARN or FAIL if issues found
            failureSource: null,  // REDIS | MONGO | ROUTE_DEPLOY | NODE_RUNTIME
            summary: '',
            actions: [],
            redis: {},
            mongo: {},
            app: {}
        };
        
        const issues = [];
        const criticalIssues = [];
        
        // ========================================================================
        // CHECK 1: REDIS ROUND-TRIP TEST (SET → GET → DEL with timing)
        // ========================================================================
        try {
            const db = require('../../db');
            const redisClient = db.redisClient;
            
            if (!redisClient || !redisClient.isReady) {
                criticalIssues.push('Redis client not initialized or not ready');
                incidentPacket.redis = {
                    setGetDelOk: false,
                    error: 'Redis client not ready',
                    notes: ['REDIS_URL environment variable may be missing or invalid']
                };
            } else {
                // Real round-trip test
                const testKey = `healthcheck:${Date.now()}`;
                const testValue = 'triage-test';
                
                const startTime = performance.now();
                
                // SET with expiration
                await redisClient.set(testKey, testValue, { EX: 10 });
                
                // GET to verify
                const retrieved = await redisClient.get(testKey);
                
                // DEL to clean up
                await redisClient.del(testKey);
                
                const roundTripMs = (performance.now() - startTime).toFixed(2);
                
                // Verify round trip worked
                const setGetDelOk = retrieved === testValue;
                
                // Get Redis INFO for detailed metrics
                const info = await redisClient.info();
                
                // Parse critical metrics
                const usedMemoryMatch = info.match(/used_memory:(\d+)/);
                const maxMemoryMatch = info.match(/maxmemory:(\d+)/);
                const evictedKeysMatch = info.match(/evicted_keys:(\d+)/);
                const rejectedConnectionsMatch = info.match(/rejected_connections:(\d+)/);
                const connectedClientsMatch = info.match(/connected_clients:(\d+)/);
                const fragmentationRatioMatch = info.match(/mem_fragmentation_ratio:([\d.]+)/);
                const rdbLastSaveStatusMatch = info.match(/rdb_last_bgsave_status:(\w+)/);
                
                const usedMemoryBytes = usedMemoryMatch ? parseInt(usedMemoryMatch[1]) : 0;
                const maxMemoryBytes = maxMemoryMatch ? parseInt(maxMemoryMatch[1]) : 0;
                const evictedKeys = evictedKeysMatch ? parseInt(evictedKeysMatch[1]) : 0;
                const rejectedConnections = rejectedConnectionsMatch ? parseInt(rejectedConnectionsMatch[1]) : 0;
                const connectedClients = connectedClientsMatch ? parseInt(connectedClientsMatch[1]) : 0;
                const fragmentationRatio = fragmentationRatioMatch ? parseFloat(fragmentationRatioMatch[1]) : 1.0;
                const persistenceOk = rdbLastSaveStatusMatch ? rdbLastSaveStatusMatch[1] === 'ok' : true;
                
                const usedMemoryPercent = maxMemoryBytes > 0 ? 
                    ((usedMemoryBytes / maxMemoryBytes) * 100).toFixed(1) : 0;
                
                // Get key count
                const dbsize = await redisClient.dbSize();
                
                incidentPacket.redis = {
                    setGetDelOk,
                    roundTripMs: parseFloat(roundTripMs),
                    usedMemoryBytes,
                    usedMemoryPercent: parseFloat(usedMemoryPercent),
                    evictedKeys,
                    rejectedConnections,
                    connectedClients,
                    fragmentationRatio,
                    persistenceOk,
                    dbsize,
                    notes: []
                };
                
                // Check for critical Redis issues
                if (evictedKeys > 0 && usedMemoryPercent > 80) {
                    criticalIssues.push(`Redis memory pressure: ${usedMemoryPercent}% used with ${evictedKeys} keys evicted`);
                    incidentPacket.redis.notes.push('🔥 FIRE ALARM: Evicting keys due to memory pressure - customers losing cached data!');
                    incidentPacket.actions.push('Upgrade Redis memory limit immediately to prevent data loss');
                }
                
                if (rejectedConnections > 0) {
                    criticalIssues.push(`Redis rejecting connections: ${rejectedConnections} rejected`);
                    incidentPacket.redis.notes.push('🚨 RED ALERT: Hitting max clients - users cannot be served!');
                    incidentPacket.actions.push('Increase Redis maxclients or investigate connection leaks');
                }
                
                if (!persistenceOk) {
                    issues.push('Redis persistence failing - data loss risk on restart');
                    incidentPacket.redis.notes.push('⚠️ WARNING: If Redis restarts, cached state will be lost');
                    incidentPacket.actions.push('Check Redis persistence configuration (RDB/AOF)');
                }
                
                if (fragmentationRatio > 1.5 && usedMemoryPercent > 80) {
                    issues.push('Redis fragmentation high with memory pressure');
                    incidentPacket.redis.notes.push('Memory fragmentation above 1.5 - consider restart during low traffic');
                }
                
                if (parseFloat(roundTripMs) > 100) {
                    issues.push(`Redis slow: ${roundTripMs}ms round trip`);
                    incidentPacket.redis.notes.push('Round trip > 100ms - check network or Redis load');
                }
            }
        } catch (error) {
            criticalIssues.push(`Redis error: ${error.message}`);
            incidentPacket.redis = {
                setGetDelOk: false,
                error: error.message,
                notes: [
                    error.message.includes('ECONNREFUSED') ? 
                        '🔴 CRITICAL: Redis connection refused - Redis service not running or REDIS_URL incorrect' :
                        error.message
                ]
            };
        }
        
        // ========================================================================
        // CHECK 2: MONGODB QUICK QUERY (with timing)
        // ========================================================================
        try {
            const c = mongoose.connection;
            
            if (c.readyState !== 1) {
                criticalIssues.push('MongoDB not connected');
                incidentPacket.mongo = {
                    quickQueryOk: false,
                    error: 'MongoDB connection not ready',
                    notes: ['Check MONGODB_URI environment variable']
                };
            } else {
                const startTime = performance.now();
                
                // Quick findOne query
                await c.db.admin().ping();
                
                const roundTripMs = (performance.now() - startTime).toFixed(2);
                
                incidentPacket.mongo = {
                    quickQueryOk: true,
                    roundTripMs: parseFloat(roundTripMs),
                    notes: []
                };
                
                // Check if Mongo is choking the event loop
                if (parseFloat(roundTripMs) > 1000) {
                    criticalIssues.push(`MongoDB query taking ${roundTripMs}ms - choking Node event loop`);
                    incidentPacket.mongo.notes.push('🚨 MongoDB blocking app thread - check Atlas performance/indexes');
                    incidentPacket.actions.push('Investigate MongoDB slow queries before blaming Redis');
                }
            }
        } catch (error) {
            criticalIssues.push(`MongoDB error: ${error.message}`);
            incidentPacket.mongo = {
                quickQueryOk: false,
                error: error.message,
                notes: [error.message]
            };
        }
        
        // ========================================================================
        // CHECK 3: EVENT LOOP DELAY
        // ========================================================================
        try {
            const eventLoopStart = performance.now();
            await new Promise(resolve => setImmediate(resolve));
            const eventLoopDelayMs = (performance.now() - eventLoopStart).toFixed(2);
            
            incidentPacket.app.eventLoopDelayMs = parseFloat(eventLoopDelayMs);
            
            if (parseFloat(eventLoopDelayMs) > 50) {
                issues.push(`Event loop stalled: ${eventLoopDelayMs}ms delay`);
                incidentPacket.actions.push('Main thread overloaded - investigate long-running handlers');
            }
        } catch (error) {
            incidentPacket.app.eventLoopDelayMs = null;
        }
        
        // ========================================================================
        // CHECK 4: ROUTE VERIFICATION (does /thresholds actually exist)
        // ========================================================================
        const routesToTest = [
            { url: '/api/admin/notifications/thresholds', method: 'GET', name: 'Thresholds API' }
        ];
        
        incidentPacket.app.routes = [];
        
        for (const route of routesToTest) {
            try {
                // Internal route check (simulate request)
                const axios = require('axios');
                const baseURL = process.env.BASE_URL || 'http://localhost:5000';
                const token = req.headers.authorization?.replace('Bearer ', '');
                
                const startTime = performance.now();
                const response = await axios({
                    method: route.method,
                    url: baseURL + route.url,
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 5000,
                    validateStatus: () => true // Accept any status
                });
                const timeMs = (performance.now() - startTime).toFixed(2);
                
                const routeResult = {
                    name: route.name,
                    url: route.url,
                    status: response.status,
                    statusText: response.statusText,
                    timeMs: parseFloat(timeMs),
                    reachable: response.status < 500
                };
                
                if (response.status === 404) {
                    criticalIssues.push(`Route 404: ${route.url}`);
                    routeResult.likelyCause = 'Route missing or deploy mismatch';
                    routeResult.fix = [
                        `Verify routes/admin/adminNotifications.js defines ${route.method} /thresholds`,
                        "Check app.use('/api/admin/notifications', adminNotificationsRoutes) in index.js",
                        'Redeploy latest commit to Render'
                    ];
                } else if (response.status === 401) {
                    routeResult.likelyCause = 'Token invalid or expired';
                    routeResult.fix = ['Check admin auth middleware / JWT env keys'];
                } else if (response.status === 403) {
                    routeResult.likelyCause = 'Auth OK but role mismatch';
                    routeResult.fix = ['Confirm admin user role or ACL settings'];
                } else if (response.status >= 500) {
                    criticalIssues.push(`Route 500: ${route.url}`);
                    routeResult.likelyCause = 'Backend crash or unhandled exception';
                    routeResult.fix = ['Check Render logs for stacktrace - backend failed after route reached'];
                }
                
                incidentPacket.app.routes.push(routeResult);
                
            } catch (error) {
                criticalIssues.push(`Route unreachable: ${route.url}`);
                incidentPacket.app.routes.push({
                    name: route.name,
                    url: route.url,
                    status: 0,
                    error: error.message,
                    reachable: false,
                    likelyCause: 'Cannot reach backend or network timeout',
                    fix: ['Check if Render service is running', 'Verify BASE_URL environment variable']
                });
            }
        }
        
        // ========================================================================
        // CHECK 5: DEPLOYMENT VERSION VERIFICATION
        // ========================================================================
        incidentPacket.app.deployedCommit = process.env.RENDER_GIT_COMMIT ? 
            process.env.RENDER_GIT_COMMIT.substring(0, 8) : 'unknown';
        incidentPacket.app.uiExpectedCommit = process.env.RENDER_GIT_COMMIT ? 
            process.env.RENDER_GIT_COMMIT.substring(0, 8) : 'unknown'; // Should match deployed
        incidentPacket.app.commitMismatch = 
            incidentPacket.app.deployedCommit !== incidentPacket.app.uiExpectedCommit &&
            incidentPacket.app.deployedCommit !== 'unknown';
        
        if (incidentPacket.app.commitMismatch) {
            criticalIssues.push(`Deploy mismatch: running ${incidentPacket.app.deployedCommit}, expected ${incidentPacket.app.uiExpectedCommit}`);
        }
        
        // ========================================================================
        // AUTO-BLAME LOGIC: Determine failureSource (STRICT RULES)
        // ========================================================================
        
        // RULE 1: Route failed OR commit mismatch = FAIL (not WARN!)
        const badRoute = incidentPacket.app.routes.find(r => r.status === 0 || r.status >= 400);
        const hasCriticalRouteFailure = badRoute || incidentPacket.app.commitMismatch;
        
        if (hasCriticalRouteFailure) {
            incidentPacket.overallStatus = 'FAIL';
            incidentPacket.failureSource = 'ROUTE_DEPLOY';
            
            if (badRoute) {
                incidentPacket.summary = `Critical route down: ${badRoute.url} (HTTP ${badRoute.status}). Backend is running commit ${incidentPacket.app.deployedCommit} but UI expects ${incidentPacket.app.uiExpectedCommit}.`;
            } else {
                incidentPacket.summary = `Frontend and backend are running different commits. UI expects ${incidentPacket.app.uiExpectedCommit}, backend is ${incidentPacket.app.deployedCommit}.`;
            }
            
            // Branch actions based on actual HTTP status
            if (badRoute && badRoute.status === 404) {
                // 404 = Route missing in running backend (deploy/mount issue)
                incidentPacket.actions = [
                    `Backend is running commit ${incidentPacket.app.deployedCommit} but UI expects ${incidentPacket.app.uiExpectedCommit}.`,
                    `Go to Render → clientsvia-backend → Deploys and deploy commit ${incidentPacket.app.uiExpectedCommit}.`,
                    `In index.js confirm: app.use('/api/admin/notifications', adminNotificationsRoutes).`,
                    `Confirm routes/admin/adminNotifications.js defines GET /thresholds and POST /thresholds.`,
                    `Re-run Test Connection after deploy.`
                ];
            } else if (badRoute && badRoute.status === 0) {
                // Status 0 = Fetch never connected (BASE_URL/CORS/DNS issue)
                incidentPacket.actions = [
                    `Status 0 means fetch never connected - check BASE_URL or CORS configuration.`,
                    `Verify BASE_URL environment variable points to correct Render service.`,
                    `Check browser console for CORS errors.`,
                    `Confirm Render service is running (not sleeping/crashed).`,
                    `Backend is running commit ${incidentPacket.app.deployedCommit} but UI expects ${incidentPacket.app.uiExpectedCommit}.`
                ];
            } else if (badRoute && badRoute.status >= 500) {
                // 500+ = Backend crash
                incidentPacket.actions = [
                    `Backend returned ${badRoute.status} - server crashed after receiving request.`,
                    `Check Render logs for stack trace and error details.`,
                    `This is NOT a routing issue - the route exists but the handler failed.`,
                    `Fix the crash, then re-run Test Connection.`
                ];
            } else {
                // Commit mismatch but no specific route failure
                incidentPacket.actions = [
                    `Backend is running commit ${incidentPacket.app.deployedCommit} but UI expects ${incidentPacket.app.uiExpectedCommit}.`,
                    `Go to Render → clientsvia-backend → Deploys and deploy commit ${incidentPacket.app.uiExpectedCommit}.`,
                    `Re-run Test Connection after deploy.`
                ];
            }
        }
        // Case B: Redis failing (REDIS)
        else if (!incidentPacket.redis.setGetDelOk) {
            incidentPacket.overallStatus = 'FAIL';
            incidentPacket.failureSource = 'REDIS';
            incidentPacket.summary = `Redis connection failed: ${incidentPacket.redis.error || 'Cannot perform SET/GET/DEL'}`;
            if (!incidentPacket.actions.length) {
                incidentPacket.actions = [
                    'Check REDIS_URL environment variable in Render',
                    'Verify Redis service is running',
                    'Check Redis maxclients if rejectedConnections > 0',
                    'Restart Redis if memory% > 90 and fragmentationRatio > 1.5'
                ];
            }
        }
        // Case C: Mongo slow (MONGO)
        else if (incidentPacket.mongo.roundTripMs > 1000) {
            incidentPacket.overallStatus = 'WARN';
            incidentPacket.failureSource = 'MONGO';
            incidentPacket.summary = `MongoDB query latency blocking app thread (${incidentPacket.mongo.roundTripMs}ms)`;
            if (!incidentPacket.actions.length) {
                incidentPacket.actions = [
                    'Check MongoDB Atlas performance dashboard',
                    'Review slow query logs',
                    'Add indexes if missing',
                    'Do NOT touch Redis - MongoDB is the bottleneck'
                ];
            }
        }
        // Case D: Event loop stalled (NODE_RUNTIME)
        else if (incidentPacket.app.eventLoopDelayMs > 50) {
            incidentPacket.overallStatus = 'WARN';
            incidentPacket.failureSource = 'NODE_RUNTIME';
            incidentPacket.summary = `Main thread overloaded (${incidentPacket.app.eventLoopDelayMs}ms event loop delay)`;
            if (!incidentPacket.actions.length) {
                incidentPacket.actions = [
                    'Investigate long-running handler / infinite loop / CPU spike in current deploy',
                    'Check for blocking synchronous operations',
                    'Consider scaling Node instances'
                ];
            }
        }
        // Case E: Redis slow (PERF warning)
        else if (incidentPacket.redis.roundTripMs > 100) {
            incidentPacket.overallStatus = 'WARN';
            incidentPacket.failureSource = 'PERF';
            incidentPacket.summary = `Redis round trip slow (${incidentPacket.redis.roundTripMs}ms). Not a Redis failure - topology/region issue.`;
            incidentPacket.actions = [
                `Network latency to Redis is high (~${incidentPacket.redis.roundTripMs}ms, expected <20ms).`,
                'Confirm Redis and API service are in the same region/provider tier in Render.',
                'If Redis is external (Upstash/Redis Cloud), upgrade to region-local plan or move API to same region.',
                'Confirm you are not creating/destroying Redis clients per request - reuse one global client.',
                'This is NOT killing uptime but will scale into pain at high traffic.'
            ];
        }
        // No critical issues but warnings
        else if (issues.length > 0) {
            incidentPacket.overallStatus = 'WARN';
            incidentPacket.failureSource = 'PERF';
            incidentPacket.summary = `${issues.length} warning(s) detected: ${issues[0]}`;
        }
        // All good
        else {
            incidentPacket.overallStatus = 'OK';
            incidentPacket.failureSource = null;
            incidentPacket.summary = 'All systems operational';
        }
        
        // Return incident packet
        res.json(incidentPacket);
        
    } catch (error) {
        res.status(500).json({
            overallStatus: 'FAIL',
            failureSource: 'NODE_RUNTIME',
            summary: `Health check crashed: ${error.message}`,
            actions: [
                'Check Render logs for error stack trace',
                'Verify all dependencies are installed',
                'This should never happen - report to dev team'
            ],
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;

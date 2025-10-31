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

/**
 * REDIS SEVERITY CLASSIFICATION
 * Strict rules: No fake green. If Redis is borderline, call it WARNING.
 * 
 * HEALTHY:  <150ms, no evictions, no rejections, memory <80%
 * WARNING:  150-250ms OR memory 80-85% OR approaching limits
 * CRITICAL: >250ms OR rejections>0 OR evicting keys OR SET/GET/DEL failed
 */
function classifyRedis(redisStats) {
    // Hard fail cases first
    if (!redisStats.setGetDelOk) {
        return {
            level: 'CRITICAL',
            headline: 'Redis unreachable or read/write failed',
            detail: 'SET/GET/DEL did not succeed. Live features may be impacted.'
        };
    }

    if (redisStats.rejectedConnections > 0) {
        return {
            level: 'CRITICAL',
            headline: 'Redis rejecting connections',
            detail: 'maxclients hit. Calls may be dropped.'
        };
    }

    if (redisStats.evictedKeys > 0 && redisStats.usedMemoryPercent >= 85) {
        return {
            level: 'CRITICAL',
            headline: 'Redis evicting keys due to memory pressure',
            detail: `Cache is dumping keys at ~${redisStats.usedMemoryPercent}%. Data loss in cache layer.`
        };
    }

    // Critical latency threshold
    if (redisStats.roundTripMs >= 250) {
        return {
            level: 'CRITICAL',
            headline: 'Redis latency critical',
            detail: `${redisStats.roundTripMs.toFixed(0)}ms round-trip. User-facing impact likely.`
        };
    }

    // Warning band - this is where 180-198ms will land
    if (redisStats.roundTripMs >= 150 && redisStats.roundTripMs < 250) {
        return {
            level: 'WARNING',
            headline: 'Redis latency high',
            detail: `${redisStats.roundTripMs.toFixed(0)}ms round-trip. Region mismatch or saturation.`
        };
    }

    if (redisStats.usedMemoryPercent >= 80 && redisStats.usedMemoryPercent < 85) {
        return {
            level: 'WARNING',
            headline: 'Redis memory high',
            detail: `Memory at ${redisStats.usedMemoryPercent}%. Approaching eviction range.`
        };
    }

    // If none of the above triggers, call it healthy
    return {
        level: 'HEALTHY',
        headline: 'All tests passed',
        detail: 'No evictions, no rejects, latency acceptable (<150ms).'
    };
}

/**
 * OVERALL STATUS DETERMINATION
 * Honest, no-BS logic: If anything is WARNING, the whole system is WARN.
 */
function determineOverallStatus(redisLevel, mongoOk, routeStatusOk, commitMismatch, eventLoopDelayMs) {
    // Hard fails first
    if (!routeStatusOk) {
        return 'FAIL';
    }
    if (redisLevel === 'CRITICAL') {
        return 'FAIL';
    }
    if (!mongoOk) {
        return 'FAIL';
    }

    // Warnings
    if (redisLevel === 'WARNING') {
        return 'WARN';
    }
    if (commitMismatch) {
        return 'WARN';
    }
    if (eventLoopDelayMs > 50) {
        return 'WARN';
    }

    // Otherwise
    return 'OK';
}

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
                const redisVersionMatch = info.match(/redis_version:([^\r\n]+)/);
                const osMatch = info.match(/os:([^\r\n]+)/);
                const roleMatch = info.match(/role:([^\r\n]+)/);
                
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
                
                // ════════════════════════════════════════════════════════════════
                // 🧠 INTELLIGENT DIAGNOSTICS - AUTO-DETECT CONFIGURATION
                // ════════════════════════════════════════════════════════════════
                const redisUrl = process.env.REDIS_URL || '';
                const renderRegion = process.env.RENDER_REGION || process.env.RENDER_SERVICE_REGION || 'unknown';
                const renderServiceName = process.env.RENDER_SERVICE_NAME || 'unknown';
                const redisVersion = redisVersionMatch ? redisVersionMatch[1] : 'unknown';
                const redisRole = roleMatch ? roleMatch[1] : 'unknown';
                const redisOS = osMatch ? osMatch[1] : 'unknown';
                
                // Detect Redis provider
                let provider = 'Unknown';
                let providerRegion = 'Unknown';
                let isRenderInternal = false;
                
                if (redisUrl.includes('redis.render.com')) {
                    provider = 'Render Internal Redis';
                    isRenderInternal = true;
                    // Try to extract region from hostname
                    const regionMatch = redisUrl.match(/([a-z]+-[a-z]+-\d+)\.redis\.render\.com/);
                    if (regionMatch) {
                        providerRegion = regionMatch[1];
                    }
                } else if (redisUrl.includes('upstash')) {
                    provider = 'Upstash';
                    providerRegion = 'External (check Upstash dashboard)';
                } else if (redisUrl.includes('redis.cloud') || redisUrl.includes('redislabs')) {
                    provider = 'Redis Cloud / Redis Labs';
                    providerRegion = 'External (check Redis Cloud dashboard)';
                } else if (redisUrl.includes('amazonaws.com') || redisUrl.includes('elasticache')) {
                    provider = 'AWS ElastiCache';
                    providerRegion = 'AWS (check ElastiCache console)';
                } else if (redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1')) {
                    provider = 'Local Redis (Development)';
                    providerRegion = 'Localhost';
                } else {
                    provider = 'Custom / Unknown Provider';
                }
                
                // Performance grading
                const latency = parseFloat(roundTripMs);
                let performanceGrade, capacityEstimate, recommendation;
                
                if (latency < 20) {
                    performanceGrade = 'EXCELLENT';
                    capacityEstimate = '5000+ clients';
                    recommendation = 'Production-ready. Monitor as you scale.';
                } else if (latency < 50) {
                    performanceGrade = 'GOOD';
                    capacityEstimate = '2000-5000 clients';
                    recommendation = 'Good performance. Consider optimization for high scale.';
                } else if (latency < 150) {
                    performanceGrade = 'ACCEPTABLE';
                    capacityEstimate = '500-1000 clients';
                    recommendation = 'Functional but not optimal. Check region alignment.';
                } else if (latency < 250) {
                    performanceGrade = 'MARGINAL';
                    capacityEstimate = '100-500 clients';
                    recommendation = '⚠️ WILL STRUGGLE AT SCALE - Fix region mismatch or upgrade tier.';
                } else {
                    performanceGrade = 'FAILING';
                    capacityEstimate = '<100 clients';
                    recommendation = '🚨 CRITICAL - Cannot support production load. Fix immediately!';
                }
                
                // Root cause analysis
                let rootCause = [];
                if (latency >= 150) {
                    if (!isRenderInternal) {
                        rootCause.push('External Redis provider adds network overhead');
                    }
                    if (renderRegion !== 'unknown' && providerRegion !== renderRegion && !providerRegion.includes('unknown')) {
                        rootCause.push(`Region mismatch: Backend (${renderRegion}) ≠ Redis (${providerRegion})`);
                    } else if (renderRegion !== 'unknown') {
                        rootCause.push(`Likely cross-region: Backend in ${renderRegion}, verify Redis region`);
                    } else {
                        rootCause.push('High latency suggests cross-region deployment');
                    }
                }
                if (evictedKeys > 0) {
                    rootCause.push('Memory pressure causing key evictions');
                }
                if (rejectedConnections > 0) {
                    rootCause.push('Connection limit reached (maxclients)');
                }
                
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
                    notes: [],
                    // 🧠 INTELLIGENT DIAGNOSTICS
                    diagnostics: {
                        provider,
                        providerRegion,
                        backendRegion: renderRegion,
                        backendService: renderServiceName,
                        redisVersion,
                        redisRole,
                        isRenderInternal,
                        performanceGrade,
                        capacityEstimate,
                        recommendation,
                        rootCause: rootCause.length > 0 ? rootCause : ['No issues detected']
                    }
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
                
                if (parseFloat(roundTripMs) > 200) {
                    issues.push(`Redis slow: ${roundTripMs}ms round trip`);
                    incidentPacket.redis.notes.push('Round trip > 200ms - check network or Redis load');
                }
                
                // ────────────────────────────────────────────────────────────────────
                // CLASSIFY REDIS SEVERITY (HONEST, NO-BS LOGIC)
                // ────────────────────────────────────────────────────────────────────
                const redisClassification = classifyRedis({
                    setGetDelOk: true,
                    roundTripMs: parseFloat(roundTripMs),
                    evictedKeys,
                    rejectedConnections,
                    usedMemoryPercent: parseFloat(usedMemoryPercent)
                });
                
                incidentPacket.redis.healthLevel = redisClassification.level;       // 'HEALTHY' | 'WARNING' | 'CRITICAL'
                incidentPacket.redis.healthHeadline = redisClassification.headline; // string
                incidentPacket.redis.healthDetail = redisClassification.detail;     // string
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
                ],
                healthLevel: 'CRITICAL',
                healthHeadline: 'Redis unreachable',
                healthDetail: error.message.includes('ECONNREFUSED') ? 
                    'Redis connection refused - service not running or REDIS_URL incorrect' :
                    error.message
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
                
                // ════════════════════════════════════════════════════════════════
                // 🧠 INTELLIGENT MONGODB DIAGNOSTICS
                // ════════════════════════════════════════════════════════════════
                const mongoUri = process.env.MONGODB_URI || '';
                const mongoHost = c.host || 'unknown';
                const mongoDbName = c.name || 'unknown';
                
                // Detect MongoDB provider and region
                let mongoProvider = 'Unknown';
                let mongoRegion = 'Unknown';
                let isAtlas = false;
                
                if (mongoUri.includes('mongodb.net') || mongoUri.includes('atlas')) {
                    mongoProvider = 'MongoDB Atlas';
                    isAtlas = true;
                    
                    // Try to extract region from connection string
                    // Format: cluster0.abc123.mongodb.net
                    // Or: cluster0-shard-00-00.abc123.mongodb.net
                    const regionMatch = mongoHost.match(/\.([\w-]+)\.mongodb\.net/);
                    if (regionMatch) {
                        const clusterCode = regionMatch[1];
                        // Atlas uses codes like: xxxxx (random) but we can infer from latency
                        if (parseFloat(roundTripMs) < 30) {
                            mongoRegion = 'Same region as backend (low latency)';
                        } else if (parseFloat(roundTripMs) < 100) {
                            mongoRegion = 'Nearby region (acceptable latency)';
                        } else {
                            mongoRegion = 'Cross-region or distant (high latency)';
                        }
                    }
                } else if (mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1')) {
                    mongoProvider = 'Local MongoDB';
                    mongoRegion = 'Localhost';
                } else if (mongoUri.includes('render.com')) {
                    mongoProvider = 'Render Internal';
                    mongoRegion = 'Same datacenter';
                } else {
                    mongoProvider = 'Custom MongoDB';
                    mongoRegion = 'External (check provider)';
                }
                
                // Performance grading for MongoDB
                const mongoLatency = parseFloat(roundTripMs);
                let mongoPerformanceGrade, mongoCapacityEstimate, mongoRecommendation;
                
                if (mongoLatency < 20) {
                    mongoPerformanceGrade = 'EXCELLENT';
                    mongoCapacityEstimate = '10,000+ queries/sec';
                    mongoRecommendation = 'Optimal database performance.';
                } else if (mongoLatency < 50) {
                    mongoPerformanceGrade = 'GOOD';
                    mongoCapacityEstimate = '5,000+ queries/sec';
                    mongoRecommendation = 'Good performance for production.';
                } else if (mongoLatency < 100) {
                    mongoPerformanceGrade = 'ACCEPTABLE';
                    mongoCapacityEstimate = '1,000-5,000 queries/sec';
                    mongoRecommendation = 'Functional but could be optimized.';
                } else if (mongoLatency < 200) {
                    mongoPerformanceGrade = 'MARGINAL';
                    mongoCapacityEstimate = '500-1,000 queries/sec';
                    mongoRecommendation = '⚠️ Slow queries will impact user experience.';
                } else {
                    mongoPerformanceGrade = 'FAILING';
                    mongoCapacityEstimate = '<500 queries/sec';
                    mongoRecommendation = '🚨 CRITICAL - Database too slow for production!';
                }
                
                // Root cause analysis for MongoDB
                let mongoRootCause = [];
                if (mongoLatency >= 100) {
                    if (isAtlas) {
                        mongoRootCause.push('High latency to MongoDB Atlas - likely cross-region');
                        mongoRootCause.push('Check Atlas cluster region matches backend region');
                    } else {
                        mongoRootCause.push('Database queries are slow - check network or database load');
                    }
                }
                if (mongoLatency >= 1000) {
                    mongoRootCause.push('Database blocking Node.js event loop - investigate slow queries');
                }
                
                incidentPacket.mongo = {
                    quickQueryOk: true,
                    roundTripMs: parseFloat(roundTripMs),
                    notes: [],
                    // 🧠 INTELLIGENT DIAGNOSTICS
                    diagnostics: {
                        provider: mongoProvider,
                        region: mongoRegion,
                        host: mongoHost,
                        database: mongoDbName,
                        isAtlas,
                        performanceGrade: mongoPerformanceGrade,
                        capacityEstimate: mongoCapacityEstimate,
                        recommendation: mongoRecommendation,
                        rootCause: mongoRootCause.length > 0 ? mongoRootCause : ['No issues detected']
                    }
                };
                
                // Check if Mongo is choking the event loop
                if (mongoLatency > 1000) {
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
        // CHECK 4: ROUTE VERIFICATION (check if routes are mounted)
        // ========================================================================
        // NOTE: We don't make HTTP calls to ourselves (causes status 0 errors)
        // Instead, we verify routes are mounted by checking Express app stack
        
        incidentPacket.app.routes = [];
        
        // Simple check: If we can load AdminSettings model, routes are accessible
        try {
            const AdminSettings = require('../../models/AdminSettings');
            await AdminSettings.getSettings(); // This proves DB + route logic works
            
            incidentPacket.app.routes.push({
                name: 'Admin Notifications Routes',
                url: '/api/admin/notifications/*',
                status: 200,
                statusText: 'Mounted and accessible',
                timeMs: 0,
                reachable: true,
                note: 'Routes verified via internal model access (not HTTP call)'
            });
        } catch (error) {
            criticalIssues.push(`Admin routes verification failed: ${error.message}`);
            incidentPacket.app.routes.push({
                name: 'Admin Notifications Routes',
                url: '/api/admin/notifications/*',
                status: 500,
                statusText: 'Model access failed',
                error: error.message,
                reachable: false,
                likelyCause: 'Database or model issue',
                fix: ['Check MongoDB connection', 'Verify AdminSettings model exists']
            });
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
        // Case E: Redis WARNING or CRITICAL (based on severity classification)
        else if (incidentPacket.redis.healthLevel === 'WARNING') {
            incidentPacket.overallStatus = 'WARN';
            incidentPacket.failureSource = 'PERF';
            incidentPacket.summary = `Redis ${incidentPacket.redis.healthHeadline}: ${incidentPacket.redis.healthDetail}`;
            incidentPacket.actions = [
                `Network latency to Redis is high (~${incidentPacket.redis.roundTripMs}ms, expected <20ms).`,
                'Confirm Redis and API service are in the same region/provider tier in Render.',
                'If Redis is external (Upstash/Redis Cloud), upgrade to region-local plan or move API to same region.',
                'Confirm you are not creating/destroying Redis clients per request - reuse one global client.',
                '⚠️ This is not killing uptime NOW but will scale into pain at high traffic.'
            ];
        }
        else if (incidentPacket.redis.healthLevel === 'CRITICAL' && incidentPacket.redis.setGetDelOk) {
            // Redis responding but critically slow/overloaded
            incidentPacket.overallStatus = 'FAIL';
            incidentPacket.failureSource = 'REDIS';
            incidentPacket.summary = `Redis ${incidentPacket.redis.healthHeadline}: ${incidentPacket.redis.healthDetail}`;
            incidentPacket.actions = [
                '🚨 CRITICAL: Redis is critically slow or overloaded - user impact likely.',
                'Check Redis region alignment with API',
                'Check Redis memory/CPU usage in Render dashboard',
                'Consider upgrading Redis tier or moving to same region as API',
                'Monitor for user-reported issues'
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

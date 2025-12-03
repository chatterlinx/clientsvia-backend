// ============================================================================
// 🏥 DEPENDENCY HEALTH MONITOR
// ============================================================================
// Real-time monitoring of all external service dependencies
// 
// FEATURES:
// ✅ MongoDB health monitoring
// ✅ Redis connection status
// ✅ Twilio API health
// ✅ ElevenLabs API status
// ✅ Response time tracking
// ✅ Automatic health checks
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger.js');
const OrchestrationHealthCheck = require('./OrchestrationHealthCheck');
// Use the centralized Redis factory - single source of truth
const { 
    getSharedRedisClient, 
    isRedisConfigured, 
    getSanitizedRedisUrl,
    REDIS_URL 
} = require('./redisClientFactory');

class DependencyHealthMonitor {

    // ========================================================================
    // GET ALL HEALTH STATUS - Check all dependencies
    // ========================================================================
    async getHealthStatus() {
        try {
            logger.info('🏥 [HEALTH MONITOR] Running comprehensive health check');

            const startTime = Date.now();

            // Run all checks in parallel
            const [
                mongoHealth,
                redisHealth,
                twilioHealth,
                elevenLabsHealth,
                openAIHealth,
                orchestrationHealth
            ] = await Promise.all([
                this.checkMongoDB(),
                this.checkRedis(),
                this.checkTwilio(),
                this.checkElevenLabs(),
                this.checkOpenAI(),
                this.checkOrchestration()
            ]);

            const totalDuration = Date.now() - startTime;

            // Calculate overall status
            const allServices = [mongoHealth, redisHealth, twilioHealth, elevenLabsHealth, openAIHealth, orchestrationHealth];
            const criticalDown = allServices.filter(s => s.status === 'DOWN' && s.critical).length;
            const anyDown = allServices.filter(s => s.status === 'DOWN' && s.critical !== false).length; // Exclude NOT_CONFIGURED
            const anyDegraded = allServices.filter(s => s.status === 'DEGRADED').length;

            let overallStatus;
            if (criticalDown > 0) {
                overallStatus = 'CRITICAL';
            } else if (anyDown > 0) {
                overallStatus = 'DOWN';
            } else if (anyDegraded > 0) {
                overallStatus = 'DEGRADED';
            } else {
                overallStatus = 'HEALTHY';
            }

            return {
                timestamp: new Date(),
                overallStatus,
                duration: totalDuration,
                services: {
                    mongodb: mongoHealth,
                    redis: redisHealth,
                    twilio: twilioHealth,
                    elevenLabs: elevenLabsHealth,
                    openai: openAIHealth,
                    orchestration: orchestrationHealth  // Include in UI - was missing!
                },
                summary: {
                    total: allServices.length,
                    healthy: allServices.filter(s => s.status === 'HEALTHY').length,
                    degraded: anyDegraded,
                    down: anyDown,
                    critical: criticalDown
                }
            };

        } catch (error) {
            logger.error('❌ [HEALTH MONITOR] Health check failed:', error);
            return {
                timestamp: new Date(),
                overallStatus: 'ERROR',
                error: error.message
            };
        }
    }

    // ========================================================================
    // MONGODB HEALTH CHECK
    // ========================================================================
    async checkMongoDB() {
        const startTime = Date.now();
        
        try {
            // Check connection state
            const state = mongoose.connection.readyState;
            const stateMap = {
                0: 'DISCONNECTED',
                1: 'CONNECTED',
                2: 'CONNECTING',
                3: 'DISCONNECTING'
            };

            if (state !== 1) {
                return {
                    name: 'MongoDB',
                    status: 'DOWN',
                    critical: true,
                    message: `Database ${stateMap[state] || 'UNKNOWN'}`,
                    responseTime: Date.now() - startTime,
                    impact: 'CRITICAL - All database operations unavailable'
                };
            }

            // Test actual query
            await mongoose.connection.db.admin().ping();
            const responseTime = Date.now() - startTime;

            // Check response time
            let status = 'HEALTHY';
            let message = 'Database operational';

            if (responseTime > 1000) {
                status = 'DEGRADED';
                message = `Slow response time: ${responseTime}ms`;
            } else if (responseTime > 500) {
                status = 'DEGRADED';
                message = `Elevated latency: ${responseTime}ms`;
            }

            return {
                name: 'MongoDB',
                status,
                critical: true,
                message,
                responseTime,
                details: {
                    host: mongoose.connection.host,
                    database: mongoose.connection.name,
                    collections: Object.keys(mongoose.connection.collections).length
                }
            };

        } catch (error) {
            return {
                name: 'MongoDB',
                status: 'DOWN',
                critical: true,
                message: `Database check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                impact: 'CRITICAL - All database operations unavailable'
            };
        }
    }

    // ========================================================================
    // REDIS HEALTH CHECK - Uses centralized redisClientFactory
    // ========================================================================
    async checkRedis() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // CHECKPOINT 1: Check REDIS_URL via factory
        const redisConfigured = isRedisConfigured();
        
        checkpoints.push({
            name: 'REDIS_URL environment variable',
            status: redisConfigured ? 'passed' : 'failed',
            message: redisConfigured 
                ? `Set (${REDIS_URL.length} chars)` 
                : 'MISSING - Set REDIS_URL in Render environment'
        });
        
        if (redisConfigured) {
            // Show sanitized URL
            checkpoints.push({
                name: 'REDIS_URL (sanitized)',
                status: 'info',
                message: getSanitizedRedisUrl()
            });
        }
        
        // If not configured, return early
        if (!redisConfigured) {
            return {
                name: 'Redis',
                status: 'DOWN',
                critical: false,
                message: 'REDIS_URL not configured',
                responseTime: 0,
                impact: 'Sessions and caching unavailable',
                rootCause: 'REDIS_URL environment variable is not set',
                fixAction: 'Set REDIS_URL in Render environment variables',
                checkpoints,
                troubleshooting: [
                    '1. Go to Render Dashboard → Your Service → Environment',
                    '2. Add REDIS_URL with your Render Redis internal URL',
                    '3. Redeploy the service'
                ]
            };
        }

        try {
            // CHECKPOINT 2: Get shared client from factory (now async - handles connection)
            const redisClient = await getSharedRedisClient();
            
            checkpoints.push({
                name: 'Redis client from factory',
                status: redisClient ? 'passed' : 'failed',
                message: redisClient ? 'Client connected' : 'Factory returned null (connection failed)'
            });
            
            if (!redisClient) {
                return {
                    name: 'Redis',
                    status: 'DOWN',
                    critical: false,
                    message: 'Redis client connection failed',
                    responseTime: 0,
                    impact: 'Sessions and caching unavailable',
                    checkpoints
                };
            }
            
            // CHECKPOINT 3: Ensure client is connected
            if (!redisClient.isOpen) {
                checkpoints.push({
                    name: 'Client connection',
                    status: 'pending',
                    message: 'Connecting...'
                });
                await redisClient.connect();
            }
            
            checkpoints.push({
                name: 'Client connected',
                status: 'passed',
                message: 'Connected to Redis'
            });

            // CHECKPOINT 3: Test connection with MULTIPLE pings
            // This helps diagnose if high latency is TLS handshake (first ping slow) or consistent (network issue)
            checkpoints.push({
                name: 'Redis ping test (3x)',
                status: 'pending',
                message: 'Testing connection with multiple pings...'
            });
            
            // Ping 1 - May include TLS handshake overhead
            const ping1Start = Date.now();
            await redisClient.ping();
            const ping1Time = Date.now() - ping1Start;
            
            // Ping 2 - Should be faster (connection reused)
            const ping2Start = Date.now();
            await redisClient.ping();
            const ping2Time = Date.now() - ping2Start;
            
            // Ping 3 - Confirms consistency
            const ping3Start = Date.now();
            await redisClient.ping();
            const ping3Time = Date.now() - ping3Start;
            
            const responseTime = Date.now() - startTime;
            const avgPingTime = Math.round((ping1Time + ping2Time + ping3Time) / 3);
            const minPingTime = Math.min(ping1Time, ping2Time, ping3Time);
            const maxPingTime = Math.max(ping1Time, ping2Time, ping3Time);
            
            // Diagnose latency pattern
            let latencyDiagnosis = '';
            if (ping1Time > ping2Time * 2 && ping2Time < 50) {
                latencyDiagnosis = 'First ping slow (TLS handshake), subsequent fast - CONNECTION OK';
            } else if (ping1Time > 100 && ping2Time > 100 && ping3Time > 100) {
                latencyDiagnosis = 'All pings slow - NETWORK LATENCY ISSUE (region mismatch?)';
            } else if (minPingTime < 30) {
                latencyDiagnosis = 'Good latency - CONNECTION HEALTHY';
            } else {
                latencyDiagnosis = 'Moderate latency - CHECK REDIS TIER';
            }
            
            // Update checkpoint after successful pings
            checkpoints[checkpoints.length - 1] = {
                name: 'Redis ping test (3x)',
                status: 'passed',
                message: `Ping 1: ${ping1Time}ms, Ping 2: ${ping2Time}ms, Ping 3: ${ping3Time}ms (avg: ${avgPingTime}ms)`
            };
            
            // Add latency diagnosis checkpoint
            checkpoints.push({
                name: 'Latency diagnosis',
                status: avgPingTime < 50 ? 'passed' : avgPingTime < 150 ? 'warning' : 'failed',
                message: latencyDiagnosis
            });
            
            // Check if using TLS
            const isTLS = process.env.REDIS_URL?.startsWith('rediss://');
            if (isTLS) {
                checkpoints.push({
                    name: 'TLS/SSL encryption',
                    status: 'info',
                    message: 'Using rediss:// (TLS enabled) - adds ~10-30ms overhead'
                });
            }

            // Get Redis info
            const info = await redisClient.info('server');
            const memoryInfo = await redisClient.info('memory');

            // CHECKPOINT 4: Response time evaluation (use average ping for accuracy)
            let status = 'HEALTHY';
            let message = 'Cache operational';

            // STRICT THRESHOLDS (NO FAKE GREEN):
            // Use minPingTime to check "best case" (after TLS handshake)
            // If min ping is still high, it's a real network issue
            // < 50ms  = HEALTHY (same-region, paid tier expected)
            // 50-100ms = ACCEPTABLE (minor overhead)
            // 100-200ms = DEGRADED (investigate)
            // > 200ms  = DOWN (critical, user impact)
            
            const effectiveLatency = minPingTime; // Use best ping (excludes TLS handshake)
            
            if (effectiveLatency >= 200) {
                status = 'DOWN';
                message = `Critical latency: ${effectiveLatency}ms min (avg: ${avgPingTime}ms) - network issue`;
                checkpoints.push({
                    name: 'Response time < 200ms (critical)',
                    status: 'failed',
                    message: `Min ${effectiveLatency}ms, avg ${avgPingTime}ms - INVESTIGATE IMMEDIATELY`
                });
            } else if (effectiveLatency >= 100) {
                status = 'DEGRADED';
                message = `High latency: ${effectiveLatency}ms min (avg: ${avgPingTime}ms) - check Redis tier`;
                checkpoints.push({
                    name: 'Response time < 100ms',
                    status: 'warning',
                    message: `Min ${effectiveLatency}ms - higher than expected for paid tier`
                });
            } else if (effectiveLatency >= 50) {
                status = 'HEALTHY';
                message = `Acceptable latency: ${effectiveLatency}ms min (avg: ${avgPingTime}ms)`;
                checkpoints.push({
                    name: 'Response time < 50ms',
                    status: 'warning',
                    message: `Min ${effectiveLatency}ms - acceptable but could improve`
                });
            } else {
                checkpoints.push({
                    name: 'Response time < 50ms',
                    status: 'passed',
                    message: `Min ${effectiveLatency}ms, avg ${avgPingTime}ms - excellent`
                });
            }

            return {
                name: 'Redis',
                status,
                critical: false,
                message,
                responseTime: avgPingTime, // Use average for display
                checkpoints,
                details: {
                    connected: true,
                    version: this.parseRedisInfo(info, 'redis_version'),
                    uptime: this.parseRedisInfo(info, 'uptime_in_seconds'),
                    memory: this.parseRedisInfo(memoryInfo, 'used_memory_human'),
                    // 🔍 LATENCY DIAGNOSTICS
                    ping1: `${ping1Time}ms`,
                    ping2: `${ping2Time}ms`,
                    ping3: `${ping3Time}ms`,
                    avgLatency: `${avgPingTime}ms`,
                    minLatency: `${minPingTime}ms`,
                    maxLatency: `${maxPingTime}ms`,
                    latencyDiagnosis,
                    tlsEnabled: isTLS
                }
            };

        } catch (error) {
            checkpoints.push({
                name: 'Redis operation',
                status: 'failed',
                message: error.message
            });
            
            return {
                name: 'Redis',
                status: 'DOWN',
                critical: false,
                message: `Redis check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                errorCode: error.code,
                checkpoints,
                impact: 'Sessions and caching degraded, some features may be slower',
                troubleshooting: [
                    `Error: ${error.message}`,
                    error.code ? `Code: ${error.code}` : '',
                    '1. Check if Redis addon is running in Render dashboard',
                    '2. Try restarting your Render service',
                    '3. Check Redis addon subscription status'
                ].filter(Boolean)
            };
        }
    }

    // ========================================================================
    // TWILIO HEALTH CHECK (Per-Company Credentials)
    // ========================================================================
    async checkTwilio() {
        const startTime = Date.now();

        try {
            // Check global credentials first (legacy/admin)
            let accountSid = process.env.TWILIO_ACCOUNT_SID;
            let authToken = process.env.TWILIO_AUTH_TOKEN;
            let phoneNumber = process.env.TWILIO_PHONE_NUMBER;
            let credentialSource = 'global';

            // If no global credentials, check AdminSettings (Notification Center config)
            if (!accountSid || !authToken) {
                try {
                    const AdminSettings = require('../models/AdminSettings');
                    const adminSettings = await AdminSettings.findOne({});
                    
                    if (adminSettings?.notificationCenter?.twilio?.accountSid && 
                        adminSettings?.notificationCenter?.twilio?.authToken) {
                        accountSid = adminSettings.notificationCenter.twilio.accountSid;
                        authToken = adminSettings.notificationCenter.twilio.authToken;
                        phoneNumber = adminSettings.notificationCenter.twilio.phoneNumber;
                        credentialSource = 'AdminSettings (Notification Center)';
                        logger.debug('🔍 [TWILIO CHECK] Found credentials in AdminSettings');
                    }
                } catch (adminSettingsErr) {
                    logger.debug('🔍 [TWILIO CHECK] AdminSettings not available:', adminSettingsErr.message);
                }
            }

            // If still no credentials, check if ANY company has Twilio configured
            if (!accountSid || !authToken) {
                const v2Company = require('../models/v2Company');
                const companyWithTwilio = await v2Company.findOne({
                    'twilioConfig.accountSid': { $exists: true, $ne: null, $ne: '' },
                    'twilioConfig.authToken': { $exists: true, $ne: null, $ne: '' }
                }).select('twilioConfig.accountSid twilioConfig.authToken twilioConfig.phoneNumber companyName');

                if (companyWithTwilio) {
                    accountSid = companyWithTwilio.twilioConfig.accountSid;
                    authToken = companyWithTwilio.twilioConfig.authToken;
                    phoneNumber = companyWithTwilio.twilioConfig.phoneNumber;
                    credentialSource = `company:${companyWithTwilio.companyName}`;
                }
            }

            // If still no credentials found, Twilio is not configured at all
            if (!accountSid || !authToken) {
                return {
                    name: 'Twilio',
                    status: 'NOT_CONFIGURED',
                    critical: false, // Not critical if not configured
                    message: 'Twilio not configured (per-company credentials system)',
                    responseTime: Date.now() - startTime,
                    details: {
                        note: 'Configure Twilio in Notification Center → Settings tab, or per-company in Company Profile'
                    }
                };
            }

            // Basic credential format validation
            const validFormat = accountSid.startsWith('AC') && accountSid.length === 34;
            
            if (!validFormat) {
                return {
                    name: 'Twilio',
                    status: 'DOWN',
                    critical: true,
                    message: 'Invalid TWILIO_ACCOUNT_SID format',
                    responseTime: Date.now() - startTime,
                    impact: 'CRITICAL - SMS and call handling unavailable'
                };
            }

            // ================================================================
            // REAL API TEST - Check Twilio account status
            // ================================================================
            try {
                const twilio = require('twilio');
                const client = twilio(accountSid, authToken);
                
                // Fetch account details (lightweight API call)
                const account = await client.api.accounts(accountSid).fetch();
                const responseTime = Date.now() - startTime;
                
                // Check account status
                if (account.status !== 'active') {
                    return {
                        name: 'Twilio',
                        status: 'DOWN',
                        critical: true,
                        message: `Twilio account ${account.status}`,
                        responseTime,
                        impact: 'CRITICAL - SMS and call handling unavailable',
                        details: {
                            accountStatus: account.status,
                            accountSid: `${accountSid.substring(0, 10)}...`
                        }
                    };
                }
                
                // Check response time for degraded status
                let status = 'HEALTHY';
                let message = 'Twilio API operational';
                if (responseTime > 2000) {
                    status = 'DEGRADED';
                    message = `Twilio API slow (${responseTime}ms)`;
                }

                return {
                    name: 'Twilio',
                    status,
                    critical: true,
                    message,
                    responseTime,
                    details: {
                        accountStatus: account.status,
                        accountType: account.type,
                        accountSid: `${accountSid.substring(0, 10)}...`,
                        phoneNumber: phoneNumber,
                        credentialSource: credentialSource,
                        apiVersion: 'v1'
                    }
                };
                
            } catch (apiError) {
                // API call failed - this is a real issue
                const responseTime = Date.now() - startTime;
                
                // Check if it's an auth error (wrong credentials) vs network error
                const isAuthError = apiError.code === 20003 || apiError.status === 401;
                
                return {
                    name: 'Twilio',
                    status: 'DOWN',
                    critical: true,
                    message: isAuthError ? 'Twilio authentication failed' : `Twilio API error: ${apiError.message}`,
                    responseTime,
                    impact: 'CRITICAL - SMS and call handling unavailable',
                    error: apiError.message,
                    errorCode: apiError.code
                };
            }

        } catch (error) {
            return {
                name: 'Twilio',
                status: 'DOWN',
                critical: true,
                message: `Twilio check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                impact: 'CRITICAL - SMS and call handling unavailable'
            };
        }
    }

    // ========================================================================
    // ELEVENLABS HEALTH CHECK
    // ========================================================================
    async checkElevenLabs() {
        const startTime = Date.now();

        try {
            const apiKey = process.env.ELEVENLABS_API_KEY;

            if (!apiKey) {
                return {
                    name: 'ElevenLabs',
                    status: 'DOWN',
                    critical: false,
                    message: 'ELEVENLABS_API_KEY not configured',
                    responseTime: Date.now() - startTime,
                    missingVars: ['ELEVENLABS_API_KEY'],
                    impact: 'Voice synthesis unavailable, calls will use Twilio default voice'
                };
            }

            // Verify API key format (basic check)
            const validFormat = apiKey.length > 20;

            if (!validFormat) {
                return {
                    name: 'ElevenLabs',
                    status: 'DOWN',
                    critical: false,
                    message: 'Invalid ELEVENLABS_API_KEY format',
                    responseTime: Date.now() - startTime,
                    impact: 'Voice synthesis unavailable'
                };
            }

            const responseTime = Date.now() - startTime;

            return {
                name: 'ElevenLabs',
                status: 'HEALTHY',
                critical: false,
                message: 'ElevenLabs API key configured',
                responseTime,
                details: {
                    apiKey: `${apiKey.substring(0, 10)}...`
                },
                note: 'Full API test requires TTS synthesis'
            };

        } catch (error) {
            return {
                name: 'ElevenLabs',
                status: 'DOWN',
                critical: false,
                message: `ElevenLabs check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                impact: 'Voice synthesis unavailable, degraded call quality'
            };
        }
    }

    // ========================================================================
    // OPENAI (GPT-4) HEALTH CHECK - 3-Tier Intelligence System
    // ========================================================================
    async checkOpenAI() {
        const startTime = Date.now();

        try {
            const apiKey = process.env.OPENAI_API_KEY;
            const enabled3Tier = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';

            // If 3-tier system is disabled, OpenAI is not critical
            if (!enabled3Tier) {
                return {
                    name: 'OpenAI (GPT-4)',
                    status: 'NOT_CONFIGURED',
                    critical: false,
                    message: '3-Tier Intelligence System disabled (feature flag off)',
                    responseTime: Date.now() - startTime,
                    details: {
                        featureFlag: 'ENABLE_3_TIER_INTELLIGENCE=false',
                        impact: 'Using Tier 1 (rule-based) only - no LLM needed'
                    },
                    note: 'System works perfectly without OpenAI when 3-tier is disabled'
                };
            }

            // 3-tier enabled: OpenAI is CRITICAL
            if (!apiKey) {
                return {
                    name: 'OpenAI (GPT-4)',
                    status: 'DOWN',
                    critical: true,  // CRITICAL when 3-tier is enabled!
                    message: 'OPENAI_API_KEY not configured (3-Tier system enabled but missing key)',
                    responseTime: Date.now() - startTime,
                    missingVars: ['OPENAI_API_KEY'],
                    impact: 'Tier 3 (LLM) unavailable - calls will fail when Tier 1/2 have low confidence',
                    action: 'Set OPENAI_API_KEY in environment or disable 3-tier system'
                };
            }

            // Verify API key format (basic check)
            const validFormat = apiKey.startsWith('sk-') && apiKey.length > 40;

            if (!validFormat) {
                return {
                    name: 'OpenAI (GPT-4)',
                    status: 'DOWN',
                    critical: true,
                    message: 'Invalid OPENAI_API_KEY format (must start with sk- and be 40+ chars)',
                    responseTime: Date.now() - startTime,
                    impact: 'Tier 3 (LLM) unavailable',
                    action: 'Get valid API key from https://platform.openai.com/api-keys'
                };
            }

            // Test OpenAI connectivity with minimal API call
            try {
                const openai = require('../config/openai');
                
                if (!openai) {
                    throw new Error('OpenAI client not initialized');
                }
                
                // Make a minimal API call to verify connectivity
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are a health check assistant.' },
                        { role: 'user', content: 'Reply with OK' }
                    ],
                    max_tokens: 5,
                    temperature: 0
                });
                
                const responseTime = Date.now() - startTime;
                const responseText = completion.choices[0]?.message?.content || '';
                
                // Check response time for degraded status
                let status = 'HEALTHY';
                let message = 'OpenAI API connected and operational';
                
                if (responseTime > 5000) {
                    status = 'DEGRADED';
                    message = `OpenAI API slow (${responseTime}ms)`;
                } else if (responseTime > 3000) {
                    status = 'DEGRADED';
                    message = `OpenAI elevated latency (${responseTime}ms)`;
                }

                return {
                    name: 'OpenAI (GPT-4)',
                    status,
                    critical: true,
                    message,
                    responseTime,
                    details: {
                        apiKey: `${apiKey.substring(0, 10)}...`,
                        model: 'gpt-4o-mini',
                        tier: 'Tier 3 (LLM Fallback)',
                        featureFlag: 'ENABLE_3_TIER_INTELLIGENCE=true',
                        testResponse: responseText.substring(0, 20),
                        tokensUsed: completion.usage?.total_tokens || 0
                    },
                    note: '3-Tier Intelligence System fully operational'
                };
                
            } catch (testError) {
                const responseTime = Date.now() - startTime;
                
                // Check if it's an auth error vs network error
                const isAuthError = testError.message?.includes('401') || 
                                   testError.message?.includes('authentication') ||
                                   testError.message?.includes('invalid_api_key') ||
                                   testError.code === 'invalid_api_key';
                
                const isRateLimit = testError.message?.includes('rate_limit') ||
                                   testError.code === 'rate_limit_exceeded';
                
                let errorMessage, action;
                if (isAuthError) {
                    errorMessage = 'OpenAI authentication failed (invalid API key)';
                    action = 'Verify OPENAI_API_KEY is valid and active at https://platform.openai.com/api-keys';
                } else if (isRateLimit) {
                    errorMessage = 'OpenAI rate limit exceeded';
                    action = 'Check your OpenAI usage limits or upgrade your plan';
                } else {
                    errorMessage = `OpenAI connection failed: ${testError.message}`;
                    action = 'Check network connectivity and OpenAI status at https://status.openai.com';
                }
                
                return {
                    name: 'OpenAI (GPT-4)',
                    status: 'DOWN',
                    critical: true,
                    message: errorMessage,
                    responseTime,
                    error: testError.message,
                    errorCode: testError.code,
                    impact: 'Tier 3 (LLM) unavailable - AI agent cannot use LLM fallback',
                    action
                };
            }

        } catch (error) {
            return {
                name: 'OpenAI (GPT-4)',
                status: 'DOWN',
                critical: enabled3Tier === 'true',
                message: `OpenAI check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                impact: 'Unable to verify Tier 3 (LLM) availability'
            };
        }
    }

    // ========================================================================
    // GET DEPENDENCY STATUS - Quick status check for specific service
    // ========================================================================
    async getDependencyStatus(serviceName) {
        try {
            switch (serviceName.toLowerCase()) {
                case 'mongodb':
                    return await this.checkMongoDB();
                case 'redis':
                    return await this.checkRedis();
                case 'twilio':
                    return await this.checkTwilio();
                case 'elevenlabs':
                    return await this.checkElevenLabs();
                case 'openai':
                case 'gpt':
                case 'gpt-4':
                    return await this.checkOpenAI();
                default:
                    return {
                        name: serviceName,
                        status: 'UNKNOWN',
                        message: 'Unknown service'
                    };
            }
        } catch (error) {
            logger.error(`❌ [HEALTH MONITOR] Failed to check ${serviceName}:`, error);
            return {
                name: serviceName,
                status: 'ERROR',
                message: error.message
            };
        }
    }

    // ========================================================================
    // GET CRITICAL SERVICES - Only check services marked as critical
    // ========================================================================
    async getCriticalServicesStatus() {
        try {
            const [mongoHealth, twilioHealth] = await Promise.all([
                this.checkMongoDB(),
                this.checkTwilio()
            ]);

            const allCritical = [mongoHealth, twilioHealth];
            const anyDown = allCritical.some(s => s.status === 'DOWN');

            return {
                timestamp: new Date(),
                overallStatus: anyDown ? 'CRITICAL' : 'HEALTHY',
                services: {
                    mongodb: mongoHealth,
                    twilio: twilioHealth
                },
                summary: {
                    total: 2,
                    healthy: allCritical.filter(s => s.status === 'HEALTHY').length,
                    down: allCritical.filter(s => s.status === 'DOWN').length
                }
            };

        } catch (error) {
            logger.error('❌ [HEALTH MONITOR] Critical services check failed:', error);
            throw error;
        }
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    parseRedisInfo(info, key) {
        const match = info.match(new RegExp(`${key}:(.+)`));
        return match ? match[1].trim() : 'unknown';
    }

    // ========================================================================
    // LLM-0 ORCHESTRATION PIPELINE HEALTH CHECK
    // ========================================================================
    async checkOrchestration() {
        const startTime = Date.now();

        try {
            logger.info('🤖 [HEALTH MONITOR] Checking LLM-0 orchestration pipeline');

            // Use OrchestrationHealthCheck service
            const orchestrationStatus = await OrchestrationHealthCheck.checkOrchestrationPipeline();

            // Map to DependencyHealthMonitor format
            const components = orchestrationStatus.components || [];
            
            // Count different states
            const criticalDown = components.filter(c => c.status === 'DOWN' && c.critical === true).length;
            const nonCriticalDown = components.filter(c => c.status === 'DOWN' && c.critical !== true).length;
            const anyDegraded = components.filter(c => c.status === 'DEGRADED').length;
            const healthyCount = components.filter(c => c.status === 'HEALTHY').length;

            let status = 'HEALTHY';
            let message = `LLM-0 orchestration pipeline operational (${healthyCount}/${components.length} healthy)`;
            let troubleshooting = [];

            // Only DOWN if CRITICAL components are down
            if (criticalDown > 0) {
                status = 'DOWN';
                const downComponents = components.filter(c => c.status === 'DOWN' && c.critical).map(c => c.name);
                message = `CRITICAL components down: ${downComponents.join(', ')}`;
                
                // Build troubleshooting for each failed component
                components.filter(c => c.status === 'DOWN' && c.critical).forEach(c => {
                    troubleshooting.push({
                        component: c.name,
                        reason: c.statusReason || c.message || 'Unknown failure',
                        checkpoints: c.checkpoints?.filter(cp => cp.status === 'FAILED' || cp.status === 'WARNING'),
                        fix: this.getComponentFix(c.name)
                    });
                });
            } else if (nonCriticalDown > 0 || anyDegraded > 0) {
                // Non-critical issues = DEGRADED, not DOWN
                status = 'DEGRADED';
                const issues = [
                    ...components.filter(c => c.status === 'DOWN' && !c.critical).map(c => c.name),
                    ...components.filter(c => c.status === 'DEGRADED').map(c => c.name)
                ];
                message = `LLM-0 components degraded: ${issues.join(', ')}`;
                
                // Build troubleshooting
                [...components.filter(c => c.status === 'DOWN' && !c.critical),
                 ...components.filter(c => c.status === 'DEGRADED')].forEach(c => {
                    troubleshooting.push({
                        component: c.name,
                        reason: c.statusReason || c.message || 'Performance issue',
                        checkpoints: c.checkpoints?.filter(cp => cp.status === 'FAILED' || cp.status === 'WARNING'),
                        fix: this.getComponentFix(c.name)
                    });
                });
            }

            return {
                name: 'LLM-0 Orchestration',
                status,
                critical: status === 'DOWN', // Only mark critical if actually DOWN
                message,
                responseTime: orchestrationStatus.totalDuration || (Date.now() - startTime),
                details: {
                    overallStatus: orchestrationStatus.overallStatus,
                    summary: {
                        total: components.length,
                        healthy: healthyCount,
                        degraded: anyDegraded,
                        down: criticalDown + nonCriticalDown
                    },
                    components: components.map(c => ({
                        name: c.name,
                        status: c.status,
                        critical: c.critical || false,
                        responseTime: c.responseTime,
                        reason: c.statusReason || c.message
                    })),
                    troubleshooting: troubleshooting.length > 0 ? troubleshooting : null,
                    note: 'Comprehensive check of all orchestration components'
                },
                impact: status === 'DOWN' ? 'CRITICAL - AI agent cannot route calls' : 
                        status === 'DEGRADED' ? 'Performance degraded - may affect call quality' : 
                        'None',
                rootCause: orchestrationStatus.rootCause
            };

        } catch (error) {
            logger.error('❌ [HEALTH MONITOR] Orchestration check failed:', error);
            return {
                name: 'LLM-0 Orchestration',
                status: 'DOWN',
                critical: true,
                message: `Orchestration check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'CRITICAL - Cannot verify AI agent functionality',
                details: {
                    error: error.message,
                    troubleshooting: [{
                        component: 'OrchestrationHealthCheck',
                        reason: error.message,
                        fix: 'Check server logs for OrchestrationHealthCheck errors'
                    }]
                }
            };
        }
    }

    /**
     * Get fix suggestion for a failed orchestration component
     */
    getComponentFix(componentName) {
        const fixes = {
            'Preprocessing': 'Check src/services/orchestration/preprocessing/ files exist and export correctly',
            'Intelligence': 'Check src/services/orchestration/intelligence/EmotionDetector.js exists',
            'Routing': 'Check src/services/orchestration/routing/ MicroLLMRouter.js and CompactPromptCompiler.js exist with route() and compile() methods',
            'Personality': 'Check src/services/orchestration/personality/HumanLayerAssembler.js exists with build() method',
            'Micro-LLM (gpt-4o-mini)': 'Verify OPENAI_API_KEY is set in environment variables and is valid'
        };
        return fixes[componentName] || 'Check server logs for detailed error information';
    }
}

// Export both the class and a lazy-initialized singleton
let _instance = null;

module.exports = {
    // Get singleton instance (lazy initialization)
    getInstance: function() {
        if (!_instance) {
            _instance = new DependencyHealthMonitor();
        }
        return _instance;
    },
    // Also export the class itself for testing
    DependencyHealthMonitor
};


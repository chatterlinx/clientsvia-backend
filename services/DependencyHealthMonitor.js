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
const { redisClient } = require('../db');
const logger = require('../utils/logger.js');
const OrchestrationHealthCheck = require('./OrchestrationHealthCheck');

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
                    openai: openAIHealth
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
    // REDIS HEALTH CHECK (with inline diagnostics)
    // ========================================================================
    async checkRedis() {
        const startTime = Date.now();
        
        // ========================================================================
        // INLINE DIAGNOSTIC CHECKPOINTS - These will appear in debug reports!
        // ========================================================================
        const checkpoints = [];
        
        // CHECKPOINT 1: Check REDIS_URL environment variable
        const redisUrlExists = !!process.env.REDIS_URL;
        const redisHostExists = !!process.env.REDIS_HOST;
        
        checkpoints.push({
            name: 'REDIS_URL environment variable',
            status: redisUrlExists ? 'passed' : 'failed',
            message: redisUrlExists 
                ? `Set (${process.env.REDIS_URL.length} chars)` 
                : 'MISSING - This is the root cause!'
        });
        
        if (redisUrlExists) {
            // CHECKPOINT 1.5: Validate URL format
            const url = process.env.REDIS_URL;
            const validProtocol = url.startsWith('redis://') || url.startsWith('rediss://');
            checkpoints.push({
                name: 'REDIS_URL format',
                status: validProtocol ? 'passed' : 'failed',
                message: validProtocol 
                    ? `Valid protocol (${url.startsWith('rediss://') ? 'rediss (TLS)' : 'redis (plain)'})` 
                    : `Invalid - must start with redis:// or rediss://. Got: ${url.substring(0, 15)}...`
            });
            
            // Show sanitized URL for debugging
            const sanitizedUrl = url.replace(/:([^@]+)@/, ':***@');
            checkpoints.push({
                name: 'REDIS_URL (sanitized)',
                status: 'info',
                message: sanitizedUrl.substring(0, 50) + (sanitizedUrl.length > 50 ? '...' : '')
            });
        } else if (redisHostExists) {
            checkpoints.push({
                name: 'REDIS_HOST fallback',
                status: 'warning',
                message: `REDIS_URL missing, falling back to REDIS_HOST=${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
            });
        }
        
        // CHECKPOINT 2: Check if client was initialized
        checkpoints.push({
            name: 'Redis client initialized',
            status: redisClient ? 'passed' : 'failed',
            message: redisClient ? 'Client exists' : 'NOT INITIALIZED - Check server startup logs for init errors'
        });

        try {
            if (!redisClient) {
                // Provide detailed diagnostic information
                const missingVars = [];
                if (!process.env.REDIS_URL) missingVars.push('REDIS_URL');
                
                let rootCause = 'Unknown';
                let fixAction = 'Check server startup logs for Redis initialization errors';
                
                if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
                    rootCause = 'REDIS_URL environment variable is not set';
                    fixAction = 'Set REDIS_URL in Render environment variables (Dashboard → Environment)';
                } else if (process.env.REDIS_URL) {
                    // URL exists but client is null - initialization failed
                    rootCause = 'Redis client initialization failed at server startup';
                    fixAction = 'Check Render server logs for "REDIS CHECKPOINT" messages to see where init failed';
                }
                
                checkpoints.push({
                    name: 'Redis ping test',
                    status: 'failed',
                    message: 'Cannot ping - client is null'
                });
                
                return {
                    name: 'Redis',
                    status: 'DOWN',
                    critical: false,
                    message: 'Redis client not initialized',
                    responseTime: 0,
                    impact: 'Sessions and caching unavailable',
                    rootCause,
                    fixAction,
                    missingVars: missingVars.length > 0 ? missingVars : undefined,
                    checkpoints,
                    envCheck: {
                        REDIS_URL_set: redisUrlExists,
                        REDIS_URL_length: redisUrlExists ? process.env.REDIS_URL.length : 0,
                        REDIS_HOST_set: redisHostExists,
                        NODE_ENV: process.env.NODE_ENV || 'development'
                    },
                    troubleshooting: [
                        '1. Go to Render Dashboard → Your Service → Environment',
                        '2. Verify REDIS_URL is listed and has a value',
                        '3. Check if Redis addon is connected (should start with redis:// or rediss://)',
                        '4. Go to Render Logs and search for "REDIS CHECKPOINT" to see startup diagnostics',
                        '5. If URL exists but client is null: restart the service to re-attempt connection'
                    ]
                };
            }

            // CHECKPOINT 3: Test connection with ping
            checkpoints.push({
                name: 'Redis ping test',
                status: 'pending',
                message: 'Testing connection...'
            });
            
            await redisClient.ping();
            const responseTime = Date.now() - startTime;
            
            // Update checkpoint after successful ping
            checkpoints[checkpoints.length - 1] = {
                name: 'Redis ping test',
                status: 'passed',
                message: `OK (${responseTime}ms)`
            };

            // Get Redis info
            const info = await redisClient.info('server');
            const memoryInfo = await redisClient.info('memory');

            // CHECKPOINT 4: Response time evaluation
            let status = 'HEALTHY';
            let message = 'Cache operational';

            // STRICT THRESHOLDS (NO FAKE GREEN):
            // < 150ms  = HEALTHY (same-region expected)
            // 150-250ms = DEGRADED (cross-region, borderline)
            // > 250ms  = DOWN (critical, user impact)
            if (responseTime >= 250) {
                status = 'DOWN';
                message = `Critical latency: ${responseTime}ms (user impact likely)`;
                checkpoints.push({
                    name: 'Response time < 250ms (critical)',
                    status: 'failed',
                    message: `${responseTime}ms exceeds 250ms threshold - check region mismatch`
                });
            } else if (responseTime >= 150) {
                status = 'DEGRADED';
                message = `High latency: ${responseTime}ms (region mismatch or saturation)`;
                checkpoints.push({
                    name: 'Response time < 150ms',
                    status: 'warning',
                    message: `${responseTime}ms - acceptable but not optimal`
                });
            } else {
                checkpoints.push({
                    name: 'Response time < 150ms',
                    status: 'passed',
                    message: `${responseTime}ms - excellent`
                });
            }

            return {
                name: 'Redis',
                status,
                critical: false,
                message,
                responseTime,
                checkpoints,
                details: {
                    connected: true,
                    version: this.parseRedisInfo(info, 'redis_version'),
                    uptime: this.parseRedisInfo(info, 'uptime_in_seconds'),
                    memory: this.parseRedisInfo(memoryInfo, 'used_memory_human')
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

            // If no global credentials, check if ANY company has Twilio configured
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
                        note: 'Configure Twilio per-company in Company Profile → Configuration tab'
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
            const components = Object.values(orchestrationStatus.components || {});
            const criticalDown = components.filter(c => c.status === 'DOWN' && c.critical).length;
            const anyDegraded = components.filter(c => c.status === 'DEGRADED').length;

            let status = 'HEALTHY';
            let message = 'LLM-0 orchestration pipeline operational';

            if (criticalDown > 0) {
                status = 'DOWN';
                const downComponents = components.filter(c => c.status === 'DOWN').map(c => c.name).join(', ');
                message = `LLM-0 components down: ${downComponents}`;
            } else if (anyDegraded > 0) {
                status = 'DEGRADED';
                const degradedComponents = components.filter(c => c.status === 'DEGRADED').map(c => c.name).join(', ');
                message = `LLM-0 components degraded: ${degradedComponents}`;
            }

            return {
                name: 'LLM-0 Orchestration',
                status,
                critical: true, // CRITICAL - this is the core AI routing engine
                message,
                responseTime: orchestrationStatus.totalDuration || (Date.now() - startTime),
                details: {
                    overallStatus: orchestrationStatus.overallStatus,
                    components: components.map(c => ({
                        name: c.name,
                        status: c.status,
                        responseTime: c.responseTime
                    })),
                    note: 'Comprehensive check of all orchestration components'
                },
                impact: status === 'DOWN' ? 'CRITICAL - AI agent cannot route calls' : 
                        status === 'DEGRADED' ? 'Performance degraded - may affect call quality' : 
                        'None'
            };

        } catch (error) {
            logger.error('❌ [HEALTH MONITOR] Orchestration check failed:', error);
            return {
                name: 'LLM-0 Orchestration',
                status: 'DOWN',
                critical: true,
                message: `Orchestration check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'CRITICAL - Cannot verify AI agent functionality'
            };
        }
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


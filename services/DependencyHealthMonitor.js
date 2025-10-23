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
                elevenLabsHealth
            ] = await Promise.all([
                this.checkMongoDB(),
                this.checkRedis(),
                this.checkTwilio(),
                this.checkElevenLabs()
            ]);

            const totalDuration = Date.now() - startTime;

            // Calculate overall status
            const allServices = [mongoHealth, redisHealth, twilioHealth, elevenLabsHealth];
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
                    elevenLabs: elevenLabsHealth
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
    // REDIS HEALTH CHECK
    // ========================================================================
    async checkRedis() {
        const startTime = Date.now();

        try {
            if (!redisClient) {
                return {
                    name: 'Redis',
                    status: 'DOWN',
                    critical: false,
                    message: 'Redis client not initialized',
                    responseTime: 0,
                    impact: 'Sessions and caching unavailable'
                };
            }

            // Test connection
            await redisClient.ping();
            const responseTime = Date.now() - startTime;

            // Get Redis info
            const info = await redisClient.info('server');
            const memoryInfo = await redisClient.info('memory');

            let status = 'HEALTHY';
            let message = 'Cache operational';

            if (responseTime > 500) {
                status = 'DEGRADED';
                message = `Slow response: ${responseTime}ms`;
            } else if (responseTime > 200) {
                status = 'DEGRADED';
                message = `Elevated latency: ${responseTime}ms`;
            }

            return {
                name: 'Redis',
                status,
                critical: false,
                message,
                responseTime,
                details: {
                    connected: true,
                    version: this.parseRedisInfo(info, 'redis_version'),
                    uptime: this.parseRedisInfo(info, 'uptime_in_seconds'),
                    memory: this.parseRedisInfo(memoryInfo, 'used_memory_human')
                }
            };

        } catch (error) {
            return {
                name: 'Redis',
                status: 'DOWN',
                critical: false,
                message: `Redis check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message,
                impact: 'Sessions and caching degraded, some features may be slower'
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


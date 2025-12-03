// ============================================================================
// 🏥 PLATFORM HEALTH CHECK SERVICE
// ============================================================================
// Purpose: Comprehensive health check of all critical platform components
// 
// Checks 10+ Systems:
// 1. MongoDB Connection & Query Performance
// 2. Redis Cache Read/Write
// 3. Twilio API Status
// 4. ElevenLabs TTS API
// 5. SMS Delivery System
// 6. Notification System
// 7. AI Agent Runtime
// 8. Company Database
// 9. Admin Contacts
// 10. Spam Filter System
//
// Features:
// - One-click health check button
// - Automatic scheduling (every 6 hours)
// - SMS notifications on failure
// - Full audit trail
// - Performance metrics
// - Trend analysis
//
// Related Files:
// - models/HealthCheckLog.js (stores results)
// - routes/admin/adminNotifications.js (API endpoint)
// - public/admin-notification-center.html (big green button)
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger.js');

// ✅ Use centralized Redis factory - single source of truth
const { getSharedRedisClient, isRedisConfigured } = require('./redisClientFactory');
const smsClient = require('../clients/smsClient');
const v2Company = require('../models/v2Company');
const HealthCheckLog = require('../models/HealthCheckLog');
const SystemHealthSnapshot = require('../models/SystemHealthSnapshot');
const AdminNotificationService = require('./AdminNotificationService');
const errorIntelligence = require('./ErrorIntelligenceService');
const os = require('os');
const crypto = require('crypto');

class PlatformHealthCheckService {
    
    /**
     * 🏥 RUN FULL PLATFORM HEALTH CHECK
     */
    static async runFullHealthCheck(triggeredBy = 'scheduled', triggeredByUser = null) {
        logger.debug(`🏥 [HEALTH CHECK] Starting full platform health check (triggered by: ${triggeredBy})...`);
        
        const startTime = Date.now();
        const results = {
            timestamp: new Date(),
            triggeredBy,
            triggeredByUser,
            overallStatus: 'HEALTHY',
            checks: [],
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                warnings: 0
            },
            serverInfo: {
                hostname: os.hostname(),
                platform: os.platform(),
                nodeVersion: process.version,
                uptime: process.uptime()
            }
        };
        
        // ========================================================================
        // RUN ALL HEALTH CHECKS
        // ========================================================================
        
        results.checks.push(await this.checkMongoDB());
        results.checks.push(await this.checkRedis());
        results.checks.push(await this.checkTwilio());
        results.checks.push(await this.checkElevenLabs());
        results.checks.push(await this.checkSMSDelivery());
        results.checks.push(await this.checkNotificationSystem());
        results.checks.push(await this.checkAIAgentRuntime());
        results.checks.push(await this.checkCompanyDatabase());
        results.checks.push(await this.checkAdminContacts());
        results.checks.push(await this.checkSpamFilter());
        
        // ========================================================================
        // CALCULATE SUMMARY
        // ========================================================================
        
        results.summary.total = results.checks.length;
        results.summary.passed = results.checks.filter(c => c.status === 'PASS').length;
        results.summary.failed = results.checks.filter(c => c.status === 'FAIL').length;
        results.summary.warnings = results.checks.filter(c => c.status === 'WARNING').length;
        
        // Determine overall status
        if (results.summary.failed > 0) {
            results.overallStatus = 'CRITICAL';
        } else if (results.summary.warnings > 0) {
            results.overallStatus = 'WARNING';
        } else {
            results.overallStatus = 'HEALTHY';
        }
        
        const endTime = Date.now();
        results.totalDuration = endTime - startTime;
        
        // Calculate average response time
        const responseTimes = results.checks.map(c => c.responseTime || 0);
        results.avgResponseTime = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
        
        // Find slowest component
        const slowest = results.checks.reduce((prev, current) => {
            return (current.responseTime > prev.responseTime) ? current : prev;
        });
        results.slowestComponent = {
            name: slowest.name,
            responseTime: slowest.responseTime
        };
        
        logger.info(`✅ [HEALTH CHECK] Completed in ${results.totalDuration}ms`);
        logger.info(`📊 [HEALTH CHECK] Results: ${results.summary.passed}/${results.summary.total} passed, ${results.summary.failed} failed, ${results.summary.warnings} warnings`);
        
        // ========================================================================
        // SEND SMS NOTIFICATION TO ADMINS (if issues or manual trigger)
        // ========================================================================
        
        const shouldSendSMS = results.overallStatus !== 'HEALTHY' || triggeredBy === 'manual';
        
        if (shouldSendSMS) {
            await this.sendHealthCheckSMS(results);
        }
        
        // ========================================================================
        // SAVE TO DATABASE
        // ========================================================================
        
        const savedLog = await this.saveHealthCheckResults(results);
        
        // Compare with previous check
        if (savedLog) {
            await savedLog.compareWithPrevious();
        }
        
        // ========================================================================
        // CREATE SYSTEM HEALTH SNAPSHOT (for comparative analysis)
        // ========================================================================
        
        await this.createHealthSnapshot(results);
        
        return results;
    }
    
    /**
     * 📸 CREATE HEALTH SNAPSHOT FOR COMPARATIVE ANALYSIS
     */
    static async createHealthSnapshot(healthCheckResults) {
        try {
            logger.debug('📸 [HEALTH CHECK] Creating system health snapshot...');
            
            // Get latest error counts (last 5 minutes)
            const NotificationLog = require('../models/NotificationLog');
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            
            const recentErrors = await NotificationLog.aggregate([
                {
                    $match: {
                        createdAt: { $gte: fiveMinutesAgo },
                        'acknowledgment.isAcknowledged': false
                    }
                },
                {
                    $group: {
                        _id: '$severity',
                        count: { $sum: 1 }
                    }
                }
            ]);
            
            const errorCounts = {
                CRITICAL: recentErrors.find(e => e._id === 'CRITICAL')?.count || 0,
                WARNING: recentErrors.find(e => e._id === 'WARNING')?.count || 0,
                INFO: recentErrors.find(e => e._id === 'INFO')?.count || 0
            };
            
            // Get top errors
            const topErrors = await NotificationLog.aggregate([
                {
                    $match: {
                        createdAt: { $gte: fiveMinutesAgo }
                    }
                },
                {
                    $group: {
                        _id: '$code',
                        count: { $sum: 1 },
                        lastOccurred: { $max: '$createdAt' }
                    }
                },
                {
                    $sort: { count: -1 }
                },
                {
                    $limit: 5
                }
            ]);
            
            // Get company counts
            const totalCompanies = await v2Company.countDocuments();
            const liveCompanies = await v2Company.countDocuments({ status: 'LIVE' });
            
            // Create configuration checksums
            const envVarsChecksum = this.hashConfig({
                MONGODB_URI: process.env.MONGODB_URI ? 'set' : 'unset',
                REDIS_URL: process.env.REDIS_URL ? 'set' : 'unset',
                TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'set' : 'unset',
                NODE_ENV: process.env.NODE_ENV
            });
            
            // Create snapshot
            const snapshot = await SystemHealthSnapshot.create({
                timestamp: new Date(),
                snapshotType: 'SCHEDULED',
                overallStatus: healthCheckResults.overallStatus,
                
                infrastructure: {
                    mongodb: {
                        status: healthCheckResults.checks.find(c => c.name === 'MongoDB Connection')?.status === 'PASS' ? 'UP' : 'DOWN',
                        latency: healthCheckResults.checks.find(c => c.name === 'MongoDB Connection')?.responseTime,
                        details: healthCheckResults.checks.find(c => c.name === 'MongoDB Connection')?.message
                    },
                    redis: {
                        status: healthCheckResults.checks.find(c => c.name === 'Redis Cache')?.status === 'PASS' ? 'UP' : 'DOWN',
                        latency: healthCheckResults.checks.find(c => c.name === 'Redis Cache')?.responseTime,
                        details: healthCheckResults.checks.find(c => c.name === 'Redis Cache')?.message
                    },
                    twilio: {
                        status: healthCheckResults.checks.find(c => c.name === 'Twilio API')?.status === 'PASS' ? 'UP' : 
                               healthCheckResults.checks.find(c => c.name === 'Twilio API')?.message.includes('not configured') ? 'UNCONFIGURED' : 'DOWN',
                        configured: !healthCheckResults.checks.find(c => c.name === 'Twilio API')?.message.includes('not configured'),
                        details: healthCheckResults.checks.find(c => c.name === 'Twilio API')?.message
                    },
                    elevenlabs: {
                        status: 'UNCONFIGURED',
                        configured: false,
                        details: 'Not checked in basic health check'
                    }
                },
                
                data: {
                    totalCompanies,
                    liveCompanies,
                    totalContacts: 0, // TODO: Add contact count
                    totalTemplates: 0, // TODO: Add template count
                    totalQnAEntries: 0 // TODO: Add Q&A count
                },
                
                errors: {
                    criticalCount: errorCounts.CRITICAL,
                    warningCount: errorCounts.WARNING,
                    infoCount: errorCounts.INFO,
                    totalCount: errorCounts.CRITICAL + errorCounts.WARNING + errorCounts.INFO,
                    topErrors: topErrors.map(e => ({
                        code: e._id,
                        count: e.count,
                        lastOccurred: e.lastOccurred
                    }))
                },
                
                performance: {
                    avgDbQueryTime: healthCheckResults.checks.find(c => c.name === 'MongoDB Connection')?.responseTime || 0,
                    avgRedisQueryTime: healthCheckResults.checks.find(c => c.name === 'Redis Cache')?.responseTime || 0,
                    avgApiResponseTime: healthCheckResults.avgResponseTime || 0,
                    errorRate: (errorCounts.CRITICAL + errorCounts.WARNING) / (healthCheckResults.summary.total || 1) * 100
                },
                
                configChecksums: {
                    envVarsChecksum
                },
                
                activeAlerts: {
                    total: await NotificationLog.countDocuments({ 'acknowledgment.isAcknowledged': false }),
                    critical: errorCounts.CRITICAL,
                    warning: errorCounts.WARNING,
                    unacknowledged: await NotificationLog.countDocuments({ 'acknowledgment.isAcknowledged': false })
                },
                
                duration: healthCheckResults.totalDuration,
                version: require('../package.json').version,
                nodeVersion: process.version,
                environment: process.env.NODE_ENV || 'production'
            });
            
            // ================================================================
            // COMPARATIVE ANALYSIS - Compare with last known good
            // ================================================================
            
            const lastKnownGood = await SystemHealthSnapshot.getLastKnownGood();
            
            if (lastKnownGood && snapshot.overallStatus !== 'HEALTHY') {
                const comparison = SystemHealthSnapshot.compareSnapshots(snapshot, lastKnownGood);
                
                if (comparison.isRegression) {
                    logger.warn(`⚠️ [HEALTH CHECK] ${comparison.regressions.length} regression(s) detected since last known good state`);
                    
                    // Send regression alert with comparative context
                    await AdminNotificationService.sendAlert({
                        code: 'SYSTEM_REGRESSION_DETECTED',
                        severity: 'WARNING',
                        message: `System regression detected: ${comparison.regressions.join(', ')}`,
                        details: `
Regressions Detected: ${comparison.regressions.length}
Time Since Last Good: ${Math.round(comparison.timeSinceLastGood)} minutes ago

Changes Detected:
${comparison.changes.map(c => `- ${c.component}: ${c.before} → ${c.after}`).join('\n')}

Last Known Good State:
- Status: ${lastKnownGood.overallStatus}
- Timestamp: ${lastKnownGood.timestamp}
- Companies: ${lastKnownGood.data.liveCompanies}
- Error Rate: ${lastKnownGood.performance.errorRate}%

Current State:
- Status: ${snapshot.overallStatus}
- Timestamp: ${snapshot.timestamp}
- Companies: ${snapshot.data.liveCompanies}
- Error Rate: ${snapshot.performance.errorRate}%

Suggested Actions:
1. Review recent deployments or configuration changes
2. Check if environment variables were modified
3. Investigate the ${comparison.changes.length} detected changes
4. Roll back recent changes if necessary
                        `.trim()
                    });
                }
            }
            
            logger.info(`✅ [HEALTH CHECK] Snapshot created successfully`);
            
        } catch (error) {
            logger.error('❌ [HEALTH CHECK] Failed to create snapshot:', error);
        }
    }
    
    /**
     * 🔐 HASH CONFIGURATION FOR CHANGE DETECTION
     */
    static hashConfig(config) {
        const json = JSON.stringify(config, Object.keys(config).sort());
        return crypto.createHash('sha256').update(json).digest('hex').substring(0, 16);
    }
    
    // ========================================================================
    // INDIVIDUAL HEALTH CHECKS
    // ========================================================================
    
    /**
     * 🗄️ CHECK MONGODB CONNECTION
     */
    static async checkMongoDB() {
        const check = {
            name: 'MongoDB Connection',
            icon: '🗄️',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // Test connection state
            if (mongoose.connection.readyState !== 1) {
                throw new Error(`MongoDB not connected (state: ${mongoose.connection.readyState})`);
            }
            
            // Test query performance
            const count = await v2Company.countDocuments({ status: 'LIVE' });
            
            check.responseTime = Date.now() - startTime;
            check.message = `Connected and operational (${count} LIVE companies)`;
            check.details = {
                readyState: mongoose.connection.readyState,
                host: mongoose.connection.host,
                database: mongoose.connection.name,
                liveCompanyCount: count
            };
            
            // Warn if response time is slow
            if (check.responseTime > 200) {
                check.status = 'WARNING';
                check.message += ` - Slow response (${check.responseTime}ms)`;
            }
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `MongoDB check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * ⚡ CHECK REDIS CACHE
     */
    static async checkRedis() {
        const check = {
            name: 'Redis Cache',
            icon: '⚡',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // ✅ Use centralized factory for Redis client
            if (!isRedisConfigured()) {
                throw new Error('REDIS_URL not configured');
            }
            const redisClient = getSharedRedisClient();
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Test write
            await redisClient.set('healthcheck:test', 'ok', { EX: 10 });
            
            // Test read
            const value = await redisClient.get('healthcheck:test');
            
            if (value !== 'ok') {
                throw new Error('Redis read/write test failed');
            }
            
            // Get cache statistics
            const keys = await redisClient.keys('company:*');
            
            check.responseTime = Date.now() - startTime;
            check.message = `Operational (${keys.length} companies cached)`;
            check.details = {
                cachedCompanyCount: keys.length,
                connected: true
            };
            
            // Warn if response time is slow
            if (check.responseTime > 50) {
                check.status = 'WARNING';
                check.message += ` - Slow response (${check.responseTime}ms)`;
            }
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `Redis check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 📱 CHECK TWILIO API
     */
    static async checkTwilio() {
        const check = {
            name: 'Twilio API',
            icon: '📱',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // Load Twilio credentials from AdminSettings (multi-tenant system)
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings?.notificationCenter?.twilio?.accountSid || 
                !settings?.notificationCenter?.twilio?.authToken) {
                throw new Error('Twilio credentials not configured');
            }
            
            const twilioClient = require('twilio')(
                settings.notificationCenter.twilio.accountSid,
                settings.notificationCenter.twilio.authToken
            );
            
            // Test API by fetching account info
            const account = await twilioClient.api.accounts(settings.notificationCenter.twilio.accountSid).fetch();
            
            check.responseTime = Date.now() - startTime;
            check.message = `API operational (Account: ${account.friendlyName})`;
            check.details = {
                accountSid: account.sid,
                status: account.status,
                phoneNumber: settings.notificationCenter.twilio.phoneNumber
            };
            
            // Warn if response time is slow
            if (check.responseTime > 500) {
                check.status = 'WARNING';
                check.message += ` - Slow response (${check.responseTime}ms)`;
            }
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `Twilio API check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 🎤 CHECK ELEVENLABS TTS
     */
    static async checkElevenLabs() {
        const check = {
            name: 'ElevenLabs TTS',
            icon: '🎤',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            if (!process.env.ELEVENLABS_API_KEY) {
                throw new Error('ElevenLabs API key not configured');
            }
            
            const elevenLabsService = require('./v2elevenLabsService');
            
            // Test by fetching voices (doesn't cost money)
            const voices = await elevenLabsService.getAvailableVoices();
            
            if (!voices || voices.length === 0) {
                throw new Error('No voices available');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `API operational (${voices.length} voices available)`;
            check.details = {
                voiceCount: voices.length,
                apiKeyConfigured: true
            };
            
            // Warn if response time is slow
            if (check.responseTime > 500) {
                check.status = 'WARNING';
                check.message += ` - Slow response (${check.responseTime}ms)`;
            }
            
        } catch (error) {
            check.status = 'WARNING';  // Non-critical
            check.message = `ElevenLabs check warning: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 📞 CHECK SMS DELIVERY SYSTEM
     */
    static async checkSMSDelivery() {
        const check = {
            name: 'SMS Delivery',
            icon: '📞',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // Verify SMS client is configured (don't actually send SMS to avoid spam)
            if (!smsClient || !smsClient.send) {
                throw new Error('SMS client not configured');
            }
            
            // Load Twilio phone number from AdminSettings (multi-tenant system)
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings?.notificationCenter?.twilio?.phoneNumber) {
                throw new Error('Twilio phone number not configured');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `SMS client configured and ready`;
            check.details = {
                configured: true,
                provider: 'Twilio',
                phoneNumber: settings.notificationCenter.twilio.phoneNumber
            };
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `SMS delivery check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 🔔 CHECK NOTIFICATION SYSTEM
     */
    static async checkNotificationSystem() {
        const check = {
            name: 'Notification System',
            icon: '🔔',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // Check AdminSettings for admin contacts (primary location in multi-tenant system)
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            const adminContacts = settings?.notificationCenter?.adminContacts || [];
            
            if (adminContacts.length === 0) {
                throw new Error('No admin contacts configured');
            }
            
            // Verify at least one contact has SMS enabled
            const smsEnabled = adminContacts.filter(c => c.smsEnabled !== false);
            
            if (smsEnabled.length === 0) {
                throw new Error('No admin contacts have SMS notifications enabled');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `Operational (${adminContacts.length} admin contacts, ${smsEnabled.length} SMS-enabled)`;
            check.details = {
                adminContactCount: adminContacts.length,
                smsEnabledCount: smsEnabled.length,
                adminPhones: smsEnabled.map(c => c.phoneNumber)
            };
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `Notification system check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 🧠 CHECK AI AGENT RUNTIME
     */
    static async checkAIAgentRuntime() {
        const check = {
            name: 'AI Agent Runtime',
            icon: '🧠',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            const AIAgentRuntime = require('./v2AIAgentRuntime');
            
            // Verify the service loads
            if (!AIAgentRuntime) {
                throw new Error('AI Agent Runtime not loaded');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `Service operational`;
            check.details = {
                loaded: true
            };
            
        } catch (error) {
            check.status = 'WARNING';
            check.message = `AI Agent check warning: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 📊 CHECK COMPANY DATABASE
     */
    static async checkCompanyDatabase() {
        const check = {
            name: 'Company Database',
            icon: '📊',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            const liveCompanies = await v2Company.countDocuments({ status: 'LIVE' });
            const totalCompanies = await v2Company.countDocuments();
            
            if (liveCompanies === 0) {
                check.status = 'WARNING';
                check.message = 'No LIVE companies found';
            } else {
                check.message = `${liveCompanies} active companies (${totalCompanies} total)`;
            }
            
            check.responseTime = Date.now() - startTime;
            check.details = {
                liveCompanies,
                totalCompanies
            };
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `Company database check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 👥 CHECK ADMIN CONTACTS
     */
    static async checkAdminContacts() {
        const check = {
            name: 'Admin Contacts',
            icon: '👥',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            // Load admin contacts from AdminSettings (multi-tenant system)
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            const adminContacts = settings?.notificationCenter?.adminContacts || [];
            
            if (adminContacts.length === 0) {
                throw new Error('No admin contacts configured');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `${adminContacts.length} admin contacts configured`;
            check.details = {
                count: adminContacts.length,
                contacts: adminContacts.map(c => ({
                    name: c.name,
                    phone: c.phoneNumber,
                    smsEnabled: c.smsEnabled !== false,
                    emailEnabled: Boolean(c.email)
                }))
            };
            
        } catch (error) {
            check.status = 'FAIL';
            check.message = `Admin contacts check failed: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    /**
     * 🛡️ CHECK SPAM FILTER
     */
    static async checkSpamFilter() {
        const check = {
            name: 'Spam Filter',
            icon: '🛡️',
            status: 'PASS',
            message: '',
            responseTime: 0,
            details: {}
        };
        
        const startTime = Date.now();
        
        try {
            const companiesWithFilter = await v2Company.countDocuments({ 
                'callFiltering.enabled': true 
            });
            
            check.responseTime = Date.now() - startTime;
            check.message = `Operational (${companiesWithFilter} companies using spam filter)`;
            check.details = {
                companiesWithFilterEnabled: companiesWithFilter
            };
            
        } catch (error) {
            check.status = 'WARNING';
            check.message = `Spam filter check warning: ${error.message}`;
            check.details = { error: error.message };
            check.responseTime = Date.now() - startTime;
        }
        
        return check;
    }
    
    // ========================================================================
    // NOTIFICATION & LOGGING
    // ========================================================================
    
    /**
     * 📱 SEND HEALTH CHECK RESULTS VIA SMS
     */
    static async sendHealthCheckSMS(results) {
        try {
            const statusEmoji = {
                HEALTHY: '✅',
                WARNING: '⚠️',
                CRITICAL: '🚨',
                OFFLINE: '⚫'
            };
            
            // Build failure details
            const failedChecks = results.checks.filter(c => c.status === 'FAIL');
            const warningChecks = results.checks.filter(c => c.status === 'WARNING');
            
            let detailsText = '';
            
            if (failedChecks.length > 0) {
                detailsText += '\n\n❌ FAILED:\n';
                failedChecks.forEach(c => {
                    detailsText += `${c.icon} ${c.name}: ${c.message}\n`;
                });
            }
            
            if (warningChecks.length > 0) {
                detailsText += '\n\n⚠️ WARNINGS:\n';
                warningChecks.forEach(c => {
                    detailsText += `${c.icon} ${c.name}: ${c.message}\n`;
                });
            }
            
            const message = `
${statusEmoji[results.overallStatus]} ClientsVia Health Check

Status: ${results.overallStatus}
Time: ${results.timestamp.toLocaleString()}
Duration: ${results.totalDuration}ms

Results: ${results.summary.passed}/${results.summary.total} passed
${results.summary.failed > 0 ? `❌ ${results.summary.failed} failed` : ''}
${results.summary.warnings > 0 ? `⚠️ ${results.summary.warnings} warnings` : ''}
${detailsText}
${results.overallStatus === 'HEALTHY' ? '\n🎉 All systems operational!' : '\n🔧 Action required!'}

View: https://app.clientsvia.com/admin-notification-center.html
            `.trim();
            
            // Send via AdminNotificationService
            await AdminNotificationService.sendAlert({
                code: 'PLATFORM_HEALTH_CHECK',
                severity: results.overallStatus === 'CRITICAL' ? 'CRITICAL' : (results.overallStatus === 'WARNING' ? 'WARNING' : 'INFO'),
                companyId: null,
                companyName: 'Platform Health Check',
                message: `Health check completed: ${results.overallStatus}`,
                details: message
            });
            
        } catch (error) {
            logger.error('❌ [HEALTH CHECK] Failed to send SMS:', error);
        }
    }
    
    /**
     * 💾 SAVE HEALTH CHECK RESULTS TO DATABASE
     */
    static async saveHealthCheckResults(results) {
        try {
            const savedLog = await HealthCheckLog.create(results);
            logger.info(`✅ [HEALTH CHECK] Results saved to database: ${savedLog._id}`);
            return savedLog;
        } catch (error) {
            logger.error('❌ [HEALTH CHECK] Failed to save results:', error);
            return null;
        }
    }
}

module.exports = PlatformHealthCheckService;


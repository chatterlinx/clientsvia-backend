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

const { redisClient } = require('../clients');
const smsClient = require('../clients/smsClient');
const v2Company = require('../models/v2Company');
const HealthCheckLog = require('../models/HealthCheckLog');
const AdminNotificationService = require('./AdminNotificationService');
const os = require('os');

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
        
        return results;
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
            if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
                throw new Error('Twilio credentials not configured');
            }
            
            const twilioClient = require('twilio')(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );
            
            // Test API by fetching account info
            const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
            
            check.responseTime = Date.now() - startTime;
            check.message = `API operational (Account: ${account.friendlyName})`;
            check.details = {
                accountSid: account.sid,
                status: account.status
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
            if (!smsClient || !smsClient.sendSMS) {
                throw new Error('SMS client not configured');
            }
            
            if (!process.env.TWILIO_PHONE_NUMBER) {
                throw new Error('Twilio phone number not configured');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `SMS client configured and ready`;
            check.details = {
                configured: true,
                provider: 'Twilio'
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
            // Check Notification Center company exists
            const notificationCenter = await v2Company.findOne({
                'metadata.isNotificationCenter': true
            });
            
            if (!notificationCenter) {
                throw new Error('Notification Center company not found');
            }
            
            // Check admin contacts
            const adminContacts = notificationCenter.contacts?.filter(
                c => c.type === 'admin-alert' && c.smsNotifications !== false
            ) || [];
            
            if (adminContacts.length === 0) {
                throw new Error('No admin contacts configured');
            }
            
            check.responseTime = Date.now() - startTime;
            check.message = `Operational (${adminContacts.length} admin contacts)`;
            check.details = {
                notificationCenterId: notificationCenter._id,
                adminContactCount: adminContacts.length,
                adminPhones: adminContacts.map(c => c.phoneNumber)
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
            const notificationCenter = await v2Company.findOne({
                'metadata.isNotificationCenter': true
            });
            
            const adminContacts = notificationCenter?.contacts?.filter(
                c => c.type === 'admin-alert'
            ) || [];
            
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
                    smsEnabled: c.smsNotifications !== false,
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


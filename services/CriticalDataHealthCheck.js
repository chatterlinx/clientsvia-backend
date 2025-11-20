/**
 * ============================================================================
 * CRITICAL DATA HEALTH CHECK SERVICE
 * ============================================================================
 * 
 * PURPOSE:
 * Proactively monitors critical database tables and configuration.
 * Sends alerts BEFORE users encounter issues.
 * 
 * RUNS: Automatically every 30 minutes (configurable)
 * 
 * CHECKS:
 * - Behaviors table not empty
 * - Templates exist
 * - Critical services configured
 * - Database connections healthy
 * 
 * PHILOSOPHY:
 * "Detect problems before customers do"
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const AdminNotificationService = require('./AdminNotificationService');

// Models
const GlobalAIBehaviorTemplate = require('../models/GlobalAIBehaviorTemplate');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const Company = require('../models/v2Company');

class CriticalDataHealthCheck {
    
    /**
     * Run all critical data health checks
     */
    static async runAllChecks() {
        logger.info('🏥 [HEALTH CHECK] Starting critical data health checks...');
        const startTime = Date.now();
        
        const results = {
            timestamp: new Date().toISOString(),
            checks: [],
            passed: 0,
            failed: 0,
            warnings: 0
        };
        
        // Run all checks
        await this.checkBehaviors(results);
        await this.checkTemplates(results);
        await this.checkCompanies(results);
        await this.checkDatabaseConnection(results);
        
        const duration = Date.now() - startTime;
        logger.info(`🏥 [HEALTH CHECK] Completed in ${duration}ms - Passed: ${results.passed}, Failed: ${results.failed}, Warnings: ${results.warnings}`);
        
        return results;
    }
    
    /**
     * Check if Behaviors table is populated
     */
    static async checkBehaviors(results) {
        try {
            const count = await GlobalAIBehaviorTemplate.countDocuments({ isActive: true });
            
            if (count === 0) {
                // CRITICAL: No behaviors available
                results.failed++;
                results.checks.push({
                    name: 'Behaviors Table',
                    status: 'CRITICAL',
                    issue: 'Database has 0 active behaviors',
                    impact: 'Categories and scenarios cannot select behaviors - AI Brain is non-functional'
                });
                
                // Send immediate alert
                await AdminNotificationService.sendAlert({
                    code: 'CRITICAL_DATA_BEHAVIORS_EMPTY',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    message: '🔴 CRITICAL: Behaviors database is empty',
                    details: {
                        check: 'CriticalDataHealthCheck',
                        table: 'GlobalAIBehaviorTemplate',
                        expectedMinimum: 6,
                        actualCount: 0,
                        issue: 'No active behaviors found in database',
                        impact: 'All AI templates cannot function - categories and scenarios have no behaviors to inherit',
                        action: 'Run seed script immediately: node scripts/seed-behaviors-quick.js',
                        suggestedFix: 'cd /Users/marc/MyProjects/clientsvia-backend && node scripts/seed-behaviors-quick.js',
                        urgency: 'IMMEDIATE - Platform is non-functional',
                        detectedBy: 'Automated health check (not user-triggered)',
                        timestamp: new Date().toISOString()
                    }
                });
                
                logger.error('🔴 [HEALTH CHECK] CRITICAL: Behaviors table is empty');
                
            } else if (count < 3) {
                // WARNING: Very few behaviors
                results.warnings++;
                results.checks.push({
                    name: 'Behaviors Table',
                    status: 'WARNING',
                    issue: `Only ${count} behaviors available (expected 6+)`,
                    impact: 'Limited behavior options for AI configuration'
                });
                
                await AdminNotificationService.sendAlert({
                    code: 'CRITICAL_DATA_BEHAVIORS_LOW',
                    severity: 'WARNING',
                    companyId: null,
                    companyName: 'Platform',
                    message: `⚠️ WARNING: Only ${count} behaviors in database`,
                    details: {
                        check: 'CriticalDataHealthCheck',
                        table: 'GlobalAIBehaviorTemplate',
                        expectedMinimum: 6,
                        actualCount: count,
                        issue: 'Fewer behaviors than expected',
                        impact: 'Limited behavior options for AI templates',
                        action: 'Review behaviors configuration, consider running seed script',
                        timestamp: new Date().toISOString()
                    }
                });
                
                logger.warn(`⚠️ [HEALTH CHECK] WARNING: Only ${count} behaviors in database`);
                
            } else {
                // PASS
                results.passed++;
                results.checks.push({
                    name: 'Behaviors Table',
                    status: 'PASS',
                    count: count
                });
                logger.debug(`✅ [HEALTH CHECK] Behaviors table OK (${count} behaviors)`);
            }
            
        } catch (error) {
            results.failed++;
            results.checks.push({
                name: 'Behaviors Table',
                status: 'ERROR',
                error: error.message
            });
            
            await AdminNotificationService.sendAlert({
                code: 'CRITICAL_DATA_CHECK_FAILED',
                severity: 'CRITICAL',
                companyId: null,
                companyName: 'Platform',
                message: '🔴 CRITICAL: Health check failed for Behaviors table',
                details: {
                    check: 'CriticalDataHealthCheck',
                    table: 'GlobalAIBehaviorTemplate',
                    error: error.message,
                    stack: error.stack,
                    impact: 'Cannot verify behaviors table status - potential database connectivity issue',
                    action: 'Check MongoDB connection, verify database health',
                    timestamp: new Date().toISOString()
                }
            });
            
            logger.error('🔴 [HEALTH CHECK] Failed to check behaviors:', error);
        }
    }
    
    /**
     * Check if Templates exist
     */
    static async checkTemplates(results) {
        try {
            const count = await GlobalInstantResponseTemplate.countDocuments({ isActive: true });
            
            if (count === 0) {
                results.warnings++;
                results.checks.push({
                    name: 'Templates Table',
                    status: 'WARNING',
                    issue: 'No active templates found',
                    impact: 'Companies cannot use AI agent'
                });
                
                await AdminNotificationService.sendAlert({
                    code: 'CRITICAL_DATA_TEMPLATES_EMPTY',
                    severity: 'WARNING',
                    companyId: null,
                    companyName: 'Platform',
                    message: '⚠️ WARNING: No active AI templates in database',
                    details: {
                        check: 'CriticalDataHealthCheck',
                        table: 'GlobalInstantResponseTemplate',
                        actualCount: 0,
                        issue: 'No active templates found',
                        impact: 'Companies cannot configure AI agents',
                        action: 'Create templates in Global AI Brain',
                        timestamp: new Date().toISOString()
                    }
                });
                
                logger.warn('⚠️ [HEALTH CHECK] WARNING: No active templates');
                
            } else {
                results.passed++;
                results.checks.push({
                    name: 'Templates Table',
                    status: 'PASS',
                    count: count
                });
                logger.debug(`✅ [HEALTH CHECK] Templates table OK (${count} templates)`);
            }
            
        } catch (error) {
            results.failed++;
            results.checks.push({
                name: 'Templates Table',
                status: 'ERROR',
                error: error.message
            });
            logger.error('🔴 [HEALTH CHECK] Failed to check templates:', error);
        }
    }
    
    /**
     * Check if Companies exist and are properly configured
     */
    static async checkCompanies(results) {
        try {
            const totalCount = await Company.countDocuments();
            const activeCount = await Company.countDocuments({ 'aiAgentSettings.enabled': true });
            
            if (totalCount === 0) {
                results.warnings++;
                results.checks.push({
                    name: 'Companies Table',
                    status: 'WARNING',
                    issue: 'No companies in database',
                    impact: 'Platform has no clients'
                });
                logger.warn('⚠️ [HEALTH CHECK] WARNING: No companies in database');
                
            } else {
                results.passed++;
                results.checks.push({
                    name: 'Companies Table',
                    status: 'PASS',
                    totalCompanies: totalCount,
                    activeAICompanies: activeCount
                });
                logger.debug(`✅ [HEALTH CHECK] Companies table OK (${totalCount} companies, ${activeCount} with AI enabled)`);
            }
            
        } catch (error) {
            results.failed++;
            results.checks.push({
                name: 'Companies Table',
                status: 'ERROR',
                error: error.message
            });
            logger.error('🔴 [HEALTH CHECK] Failed to check companies:', error);
        }
    }
    
    /**
     * Check database connection health
     */
    static async checkDatabaseConnection(results) {
        try {
            const mongoose = require('mongoose');
            const readyState = mongoose.connection.readyState;
            
            // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
            if (readyState === 1) {
                results.passed++;
                results.checks.push({
                    name: 'Database Connection',
                    status: 'PASS',
                    readyState: 'connected'
                });
                logger.debug('✅ [HEALTH CHECK] Database connection OK');
                
            } else {
                results.failed++;
                results.checks.push({
                    name: 'Database Connection',
                    status: 'CRITICAL',
                    issue: `Database not connected (readyState: ${readyState})`,
                    impact: 'All database operations will fail'
                });
                
                await AdminNotificationService.sendAlert({
                    code: 'DATABASE_CONNECTION_LOST',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    message: '🔴 CRITICAL: MongoDB connection lost',
                    details: {
                        check: 'CriticalDataHealthCheck',
                        readyState: readyState,
                        readyStateMap: {
                            0: 'disconnected',
                            1: 'connected',
                            2: 'connecting',
                            3: 'disconnecting'
                        },
                        currentState: ['disconnected', 'connected', 'connecting', 'disconnecting'][readyState],
                        impact: 'All database operations failing - platform is down',
                        action: 'Check MongoDB Atlas status, verify connection string, restart backend',
                        timestamp: new Date().toISOString()
                    }
                });
                
                logger.error(`🔴 [HEALTH CHECK] CRITICAL: Database not connected (state: ${readyState})`);
            }
            
        } catch (error) {
            results.failed++;
            results.checks.push({
                name: 'Database Connection',
                status: 'ERROR',
                error: error.message
            });
            logger.error('🔴 [HEALTH CHECK] Failed to check database connection:', error);
        }
    }
}

module.exports = CriticalDataHealthCheck;


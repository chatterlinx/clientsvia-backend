// ============================================================================
// AUTO-OPTIMIZATION SCHEDULER - BACKGROUND THRESHOLD OPTIMIZATION
// 🤖 DESCRIPTION: Runs automatic AI agent threshold optimization in background
// ⏰ SCHEDULE: Checks every hour for companies needing optimization
// 🎯 PURPOSE: Continuously improve AI agent performance without manual intervention
// 🔒 SAFETY: Multiple safeguards to prevent bad optimizations
// 📧 NOTIFICATIONS: Email alerts when thresholds are automatically adjusted
// ============================================================================

const cron = require('node-cron');
const Company = require('../models/v2Company');
const SmartThresholdOptimizer = require('./smartThresholdOptimizer');
const AIAgentCallLog = require('../models/v2AIAgentCallLog');
const logger = require('../utils/logger');

class AutoOptimizationScheduler {
    constructor() {
        this.isRunning = false;
        this.cronJob = null;
        this.optimizer = new SmartThresholdOptimizer();
    }

    // 🚀 START THE SCHEDULER
    start() {
        if (this.isRunning) {
            logger.warn('⚠️ Auto-optimization scheduler already running');
            return;
        }

        // Run every hour at minute 0 (e.g., 1:00, 2:00, 3:00, etc.)
        this.cronJob = cron.schedule('0 * * * *', async () => {
            await this.checkAndOptimizeCompanies();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        this.isRunning = true;
        logger.info('🤖 Auto-optimization scheduler STARTED - checking every hour');
    }

    // ⏹️ STOP THE SCHEDULER
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }
        this.isRunning = false;
        logger.info('⏹️ Auto-optimization scheduler STOPPED');
    }

    // 🔍 CHECK ALL COMPANIES FOR OPTIMIZATION NEEDS
    async checkAndOptimizeCompanies() {
        const startTime = Date.now();
        
        try {
            logger.info('🔍 Auto-optimization check starting...');

            // Find companies with auto-optimization enabled and due for optimization
            const companies = await Company.find({
                'aiAgentLogic.autoOptimization.enabled': true,
                'aiAgentLogic.autoOptimization.nextRun': { $lte: new Date() }
            }).select('_id name aiAgentLogic.autoOptimization');

            logger.info(`🎯 Found ${companies.length} companies due for auto-optimization`);

            let optimizedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;

            // Process each company
            for (const company of companies) {
                try {
                    const result = await this.optimizeCompany(company);
                    
                    if (result.optimized) {
                        optimizedCount++;
                        logger.info(`✅ Auto-optimized company ${company.name} (${company._id})`);
                    } else {
                        skippedCount++;
                        logger.info(`⏭️ Skipped company ${company.name}: ${result.reason}`);
                    }
                } catch (error) {
                    errorCount++;
                    logger.error(`❌ Auto-optimization failed for company ${company.name}`, {
                        companyId: company._id,
                        error: error.message
                    });
                }
            }

            const totalTime = Date.now() - startTime;
            
            logger.info('🏁 Auto-optimization check completed', {
                totalCompanies: companies.length,
                optimized: optimizedCount,
                skipped: skippedCount,
                errors: errorCount,
                totalTime: `${totalTime}ms`
            });

        } catch (error) {
            logger.error('❌ Auto-optimization check failed', {
                error: error.message,
                totalTime: `${Date.now() - startTime}ms`
            });
        }
    }

    // 🎯 OPTIMIZE A SINGLE COMPANY
    async optimizeCompany(company) {
        const companyId = company._id.toString();
        const settings = company.aiAgentLogic.autoOptimization;
        
        try {
            // 🔒 SAFETY CHECK 1: Minimum call volume
            const callCount = await AIAgentCallLog.countDocuments({
                companyId: company._id,
                createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            });

            if (callCount < settings.minCallsRequired) {
                await this.scheduleNextRun(company);
                return {
                    optimized: false,
                    reason: `Insufficient call volume (${callCount}/${settings.minCallsRequired} required)`
                };
            }

            // 🧠 RUN OPTIMIZATION
            const optimizationResult = await this.optimizer.optimizeThresholds(companyId);

            if (!optimizationResult.success) {
                await this.scheduleNextRun(company);
                return {
                    optimized: false,
                    reason: optimizationResult.message
                };
            }

            // 🔒 SAFETY CHECK 2: Confidence threshold
            if (optimizationResult.confidence < settings.confidenceRequired) {
                await this.scheduleNextRun(company);
                return {
                    optimized: false,
                    reason: `Low optimization confidence (${Math.round(optimizationResult.confidence * 100)}% < ${Math.round(settings.confidenceRequired * 100)}% required)`
                };
            }

            // 🔒 SAFETY CHECK 3: Maximum threshold change
            const hasLargeChanges = Object.values(optimizationResult.improvements).some(improvement => {
                const change = Math.abs(improvement.newThreshold - improvement.oldThreshold);
                return change > settings.maxThresholdChange;
            });

            if (hasLargeChanges) {
                await this.scheduleNextRun(company);
                return {
                    optimized: false,
                    reason: `Threshold changes too large (max ${Math.round(settings.maxThresholdChange * 100)}% allowed)`
                };
            }

            // ✅ OPTIMIZATION APPROVED - APPLY CHANGES
            await Company.findByIdAndUpdate(company._id, {
                $set: {
                    'aiAgentLogic.thresholds': optimizationResult.optimizedThresholds,
                    'aiAgentLogic.autoOptimization.lastRun': new Date()
                }
            });

            // 📧 SEND NOTIFICATION (if enabled)
            if (settings.notifyOnChanges) {
                await this.sendOptimizationNotification(company, optimizationResult);
            }

            // ⏰ SCHEDULE NEXT RUN
            await this.scheduleNextRun(company);

            // 📊 LOG SUCCESS
            logger.info(`🎯 Auto-optimization SUCCESS for company ${company.name}`, {
                companyId,
                oldThresholds: optimizationResult.analysis.currentThresholds,
                newThresholds: optimizationResult.optimizedThresholds,
                confidence: optimizationResult.confidence,
                callVolume: callCount
            });

            return {
                optimized: true,
                result: optimizationResult
            };

        } catch (error) {
            // ⚠️ ERROR HANDLING - Schedule next run even on error
            await this.scheduleNextRun(company);
            throw error;
        }
    }

    // ⏰ SCHEDULE NEXT OPTIMIZATION RUN
    async scheduleNextRun(company) {
        const settings = company.aiAgentLogic.autoOptimization;
        const now = new Date();
        const nextRun = new Date(now);

        switch (settings.frequency) {
            case 'daily':
                nextRun.setDate(now.getDate() + 1);
                nextRun.setHours(2, 0, 0, 0);
                break;
            case 'weekly':
                nextRun.setDate(now.getDate() + 7);
                nextRun.setHours(2, 0, 0, 0);
                break;
            case 'monthly':
                nextRun.setMonth(now.getMonth() + 1);
                nextRun.setDate(1);
                nextRun.setHours(2, 0, 0, 0);
                break;
        }

        await Company.findByIdAndUpdate(company._id, {
            $set: {
                'aiAgentLogic.autoOptimization.nextRun': nextRun
            }
        });

        logger.info(`⏰ Scheduled next auto-optimization for ${company.name}`, {
            companyId: company._id.toString(),
            nextRun: nextRun.toISOString(),
            frequency: settings.frequency
        });
    }

    // 📧 SEND OPTIMIZATION NOTIFICATION
    async sendOptimizationNotification(company, optimizationResult) {
        try {
            // TODO: Implement email notification
            // For now, just log the notification
            
            const changes = Object.keys(optimizationResult.improvements).map(source => {
                const improvement = optimizationResult.improvements[source];
                const sourceName = source.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                return `${sourceName}: ${Math.round(improvement.oldThreshold * 100)}% → ${Math.round(improvement.newThreshold * 100)}%`;
            }).join('\n');

            const notification = {
                to: 'admin@clientsvia.com', // TODO: Get from company settings
                subject: `🤖 AI Agent Auto-Optimization Complete - ${company.name}`,
                body: `
Your AI agent thresholds have been automatically optimized based on recent call patterns.

OPTIMIZATION RESULTS:
${changes}

Confidence: ${Math.round(optimizationResult.confidence * 100)}%
Call Volume Analyzed: Last 7 days

The AI agent will now perform better at matching customer queries to the right knowledge sources.

---
ClientsVia Auto-Optimization System
                `.trim()
            };

            logger.info(`📧 Notification prepared for company ${company.name}`, {
                companyId: company._id.toString(),
                notification
            });

            // TODO: Send actual email using your email service
            
        } catch (error) {
            logger.error(`❌ Failed to send optimization notification for company ${company.name}`, {
                companyId: company._id.toString(),
                error: error.message
            });
        }
    }

    // 📊 GET SCHEDULER STATUS
    getStatus() {
        return {
            isRunning: this.isRunning,
            nextCheck: this.cronJob ? 'Every hour at :00' : null,
            startedAt: this.isRunning ? new Date().toISOString() : null
        };
    }
}

// 🚀 CREATE SINGLETON INSTANCE
const autoOptimizationScheduler = new AutoOptimizationScheduler();

module.exports = autoOptimizationScheduler;

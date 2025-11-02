// ============================================================================
// CLIENTSVIA - INTELLIGENCE SAFETY MONITOR
// ============================================================================
// Purpose: Safety mechanisms for Test Pilot Intelligence system
// Created: 2025-11-02
// Features:
//   - YOLO mode auto-revert (24h limit)
//   - Daily cost alerts (email warnings)
//   - Budget enforcement (pause Tier 3 when exceeded)
//   - Daily cost reset (midnight UTC)
// ============================================================================

const AdminSettings = require('../models/AdminSettings');
const logger = require('../utils/logger');
const emailClient = require('../clients/emailClient');

// ============================================================================
// SAFETY MONITOR CLASS
// ============================================================================
class IntelligenceSafetyMonitor {
    
    // ========================================================================
    // AUTO-REVERT YOLO MODE (24h Safety Timer)
    // ========================================================================
    /**
     * Check if YOLO mode has been active for >24h and revert to Balanced
     * This prevents accidental long-term YOLO mode usage (expensive!)
     * 
     * @returns {Object} { reverted: boolean, message: string }
     */
    static async checkAndRevertYoloMode() {
        try {
            logger.info('🔍 [SAFETY MONITOR] Checking YOLO mode auto-revert...');
            
            const adminSettings = await AdminSettings.getSettings();
            const testPilotConfig = adminSettings.testPilotIntelligence;
            
            // Only check if currently in YOLO mode
            if (testPilotConfig.preset !== 'yolo') {
                logger.info('✅ [SAFETY MONITOR] Not in YOLO mode, no action needed');
                return {
                    reverted: false,
                    message: 'Not in YOLO mode'
                };
            }
            
            // Check activation timestamp
            const activatedAt = testPilotConfig.yoloModeActivatedAt;
            
            if (!activatedAt) {
                logger.warn('⚠️ [SAFETY MONITOR] YOLO mode active but no activation timestamp. Setting timestamp now.');
                adminSettings.testPilotIntelligence.yoloModeActivatedAt = new Date();
                await adminSettings.save();
                return {
                    reverted: false,
                    message: 'Timestamp set for YOLO mode'
                };
            }
            
            // Calculate hours since activation
            const now = new Date();
            const hoursSinceActivation = (now - activatedAt) / (1000 * 60 * 60);
            
            logger.info(`   YOLO mode active for ${hoursSinceActivation.toFixed(1)} hours`);
            
            // Auto-revert if >24 hours
            if (hoursSinceActivation >= 24) {
                logger.warn(`🔥 [SAFETY MONITOR] YOLO MODE AUTO-REVERT TRIGGERED! Active for ${hoursSinceActivation.toFixed(1)} hours (>24h limit)`);
                
                // Revert to Balanced preset
                adminSettings.testPilotIntelligence.preset = 'balanced';
                adminSettings.testPilotIntelligence.thresholds.tier1 = 0.80;
                adminSettings.testPilotIntelligence.thresholds.tier2 = 0.60;
                adminSettings.testPilotIntelligence.llmConfig.model = 'gpt-4o-mini';
                adminSettings.testPilotIntelligence.llmConfig.autoApply = 'manual';
                adminSettings.testPilotIntelligence.llmConfig.maxCallsPerDay = null;
                adminSettings.testPilotIntelligence.llmConfig.contextWindow = 'standard';
                adminSettings.testPilotIntelligence.yoloModeActivatedAt = null;
                adminSettings.testPilotIntelligence.lastUpdated = new Date();
                adminSettings.testPilotIntelligence.updatedBy = 'System (Auto-Revert)';
                
                await adminSettings.save();
                
                logger.info('✅ [SAFETY MONITOR] YOLO mode reverted to Balanced preset');
                
                // Send alert email
                await this.sendYoloRevertAlert(hoursSinceActivation);
                
                return {
                    reverted: true,
                    message: `YOLO mode auto-reverted to Balanced after ${hoursSinceActivation.toFixed(1)} hours`,
                    previousDuration: hoursSinceActivation
                };
            }
            
            logger.info(`✅ [SAFETY MONITOR] YOLO mode OK (${hoursSinceActivation.toFixed(1)}h / 24h limit)`);
            return {
                reverted: false,
                message: `YOLO mode active for ${hoursSinceActivation.toFixed(1)} hours`,
                hoursRemaining: (24 - hoursSinceActivation).toFixed(1)
            };
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to check YOLO mode:', error);
            return {
                reverted: false,
                message: 'Error checking YOLO mode',
                error: error.message
            };
        }
    }
    
    // ========================================================================
    // DAILY COST ALERT (Budget Warning Email)
    // ========================================================================
    /**
     * Check if daily cost has reached alert threshold
     * Send email warning if threshold exceeded
     * 
     * @param {number} currentCost - Current day's LLM cost (USD)
     * @returns {Object} { alertSent: boolean, message: string }
     */
    static async checkDailyCostAlert(currentCost) {
        try {
            logger.info(`💰 [SAFETY MONITOR] Checking daily cost alert (current: $${currentCost.toFixed(2)})...`);
            
            const adminSettings = await AdminSettings.getSettings();
            const testPilotConfig = adminSettings.testPilotIntelligence;
            
            const alertThreshold = testPilotConfig.costControls.alertThreshold;
            
            // No alert threshold set
            if (!alertThreshold) {
                logger.info('   No alert threshold configured, skipping');
                return {
                    alertSent: false,
                    message: 'No alert threshold set'
                };
            }
            
            // Cost below threshold
            if (currentCost < alertThreshold) {
                logger.info(`   Cost below threshold ($${currentCost.toFixed(2)} < $${alertThreshold})`);
                return {
                    alertSent: false,
                    message: 'Cost below alert threshold'
                };
            }
            
            // ALERT! Cost reached or exceeded threshold
            logger.warn(`⚠️ [SAFETY MONITOR] COST ALERT TRIGGERED! $${currentCost.toFixed(2)} >= $${alertThreshold} threshold`);
            
            await this.sendCostAlertEmail(currentCost, alertThreshold, testPilotConfig);
            
            return {
                alertSent: true,
                message: `Cost alert sent: $${currentCost.toFixed(2)} reached threshold of $${alertThreshold}`,
                currentCost: currentCost,
                threshold: alertThreshold
            };
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to check cost alert:', error);
            return {
                alertSent: false,
                message: 'Error checking cost alert',
                error: error.message
            };
        }
    }
    
    // ========================================================================
    // BUDGET ENFORCEMENT (Pause Tier 3 if Budget Exceeded)
    // ========================================================================
    /**
     * Check if daily budget has been exceeded
     * Pause Tier 3 LLM calls until midnight reset
     * 
     * @param {number} currentCost - Current day's LLM cost (USD)
     * @returns {Object} { budgetExceeded: boolean, tier3Paused: boolean }
     */
    static async enforceDailyBudget(currentCost) {
        try {
            logger.info(`🔒 [SAFETY MONITOR] Enforcing daily budget (current: $${currentCost.toFixed(2)})...`);
            
            const adminSettings = await AdminSettings.getSettings();
            const testPilotConfig = adminSettings.testPilotIntelligence;
            
            const dailyBudget = testPilotConfig.costControls.dailyBudget;
            
            // No budget limit set
            if (!dailyBudget) {
                logger.info('   No daily budget configured, unlimited spending allowed');
                return {
                    budgetExceeded: false,
                    tier3Paused: false,
                    message: 'No daily budget limit'
                };
            }
            
            // Budget not exceeded
            if (currentCost < dailyBudget) {
                logger.info(`   Budget OK: $${currentCost.toFixed(2)} / $${dailyBudget} (${(currentCost/dailyBudget*100).toFixed(1)}% used)`);
                return {
                    budgetExceeded: false,
                    tier3Paused: false,
                    message: 'Budget not exceeded',
                    percentUsed: (currentCost / dailyBudget * 100).toFixed(1)
                };
            }
            
            // BUDGET EXCEEDED - Pause Tier 3
            logger.warn(`🚨 [SAFETY MONITOR] DAILY BUDGET EXCEEDED! $${currentCost.toFixed(2)} >= $${dailyBudget}`);
            logger.warn('   🔒 TIER 3 LLM CALLS PAUSED until midnight reset');
            
            await this.sendBudgetExceededEmail(currentCost, dailyBudget, testPilotConfig);
            
            return {
                budgetExceeded: true,
                tier3Paused: true,
                message: `Daily budget exceeded: $${currentCost.toFixed(2)} / $${dailyBudget}`,
                currentCost: currentCost,
                budget: dailyBudget,
                overage: (currentCost - dailyBudget).toFixed(2)
            };
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to enforce budget:', error);
            return {
                budgetExceeded: false,
                tier3Paused: false,
                message: 'Error enforcing budget',
                error: error.message
            };
        }
    }
    
    // ========================================================================
    // DAILY COST RESET (Midnight UTC)
    // ========================================================================
    /**
     * Reset daily cost tracking at midnight
     * Should be called by cron job or at start of each day
     * 
     * @returns {Object} { reset: boolean, message: string }
     */
    static async resetDailyCost() {
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            
            logger.info(`🔄 [SAFETY MONITOR] Checking if daily cost reset needed (today: ${today})...`);
            
            const adminSettings = await AdminSettings.getSettings();
            const testPilotConfig = adminSettings.testPilotIntelligence;
            
            const trackedDate = testPilotConfig.todaysCost.date;
            
            // Already reset for today
            if (trackedDate === today) {
                logger.info('   Cost already reset for today, no action needed');
                return {
                    reset: false,
                    message: 'Cost already reset for today'
                };
            }
            
            // Reset needed - new day!
            const previousCost = testPilotConfig.todaysCost.amount;
            const previousCalls = testPilotConfig.todaysCost.tier3Calls;
            
            logger.info(`🔄 [SAFETY MONITOR] Resetting daily cost...`);
            logger.info(`   Previous day (${trackedDate}): $${previousCost.toFixed(2)} (${previousCalls} Tier 3 calls)`);
            
            adminSettings.testPilotIntelligence.todaysCost = {
                amount: 0,
                date: today,
                tier3Calls: 0
            };
            
            await adminSettings.save();
            
            logger.info(`✅ [SAFETY MONITOR] Daily cost reset complete for ${today}`);
            
            return {
                reset: true,
                message: `Daily cost reset for ${today}`,
                previousDate: trackedDate,
                previousCost: previousCost,
                previousCalls: previousCalls
            };
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to reset daily cost:', error);
            return {
                reset: false,
                message: 'Error resetting daily cost',
                error: error.message
            };
        }
    }
    
    // ========================================================================
    // RUN ALL SAFETY CHECKS (Master Check Function)
    // ========================================================================
    /**
     * Run all safety checks in one call
     * Ideal for cron job or middleware
     * 
     * @returns {Object} Results from all checks
     */
    static async runAllSafetyChecks() {
        try {
            logger.info('🛡️ [SAFETY MONITOR] Running all safety checks...');
            
            const adminSettings = await AdminSettings.getSettings();
            const currentCost = adminSettings.testPilotIntelligence.todaysCost.amount;
            
            // Run all checks
            const yoloCheck = await this.checkAndRevertYoloMode();
            const costReset = await this.resetDailyCost();
            const costAlert = await this.checkDailyCostAlert(currentCost);
            const budgetCheck = await this.enforceDailyBudget(currentCost);
            
            const results = {
                timestamp: new Date(),
                checks: {
                    yoloModeRevert: yoloCheck,
                    dailyCostReset: costReset,
                    costAlert: costAlert,
                    budgetEnforcement: budgetCheck
                },
                summary: {
                    yoloReverted: yoloCheck.reverted,
                    costReset: costReset.reset,
                    alertSent: costAlert.alertSent,
                    tier3Paused: budgetCheck.tier3Paused
                }
            };
            
            logger.info('✅ [SAFETY MONITOR] All safety checks complete');
            logger.info(`   YOLO reverted: ${yoloCheck.reverted}`);
            logger.info(`   Cost reset: ${costReset.reset}`);
            logger.info(`   Alert sent: ${costAlert.alertSent}`);
            logger.info(`   Tier 3 paused: ${budgetCheck.tier3Paused}`);
            
            return results;
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to run safety checks:', error);
            return {
                timestamp: new Date(),
                error: error.message
            };
        }
    }
    
    // ========================================================================
    // EMAIL ALERTS (Notification Functions)
    // ========================================================================
    
    /**
     * Send YOLO mode auto-revert alert email
     */
    static async sendYoloRevertAlert(hoursDuration) {
        try {
            const subject = '🔥 YOLO Mode Auto-Reverted to Balanced';
            const message = `
🔥 YOLO Mode Auto-Revert Alert

Your Test Pilot Intelligence was automatically reverted from YOLO mode to Balanced preset.

Duration: ${hoursDuration.toFixed(1)} hours (24 hour limit reached)

YOLO mode is designed for short-term research only and automatically reverts after 24 hours to prevent accidental high costs.

Current Settings:
- Preset: Balanced
- Tier 1: 80%
- Tier 2: 60%
- LLM Model: gpt-4o-mini
- Auto-apply: Manual

If you still need YOLO mode for research, you can re-enable it in the Test Pilot Intelligence Settings.

--
ClientsVia Safety Monitor
            `.trim();
            
            await emailClient.sendEmail('admin@clientsvia.com', subject, message);
            logger.info('✅ [SAFETY MONITOR] YOLO revert alert email sent');
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to send YOLO revert email:', error);
        }
    }
    
    /**
     * Send daily cost alert email
     */
    static async sendCostAlertEmail(currentCost, threshold, config) {
        try {
            const subject = `⚠️ LLM Cost Alert: $${currentCost.toFixed(2)} Reached Threshold`;
            const message = `
⚠️ Daily LLM Cost Alert

Your Test Pilot Intelligence has reached the cost alert threshold.

Current Cost: $${currentCost.toFixed(2)}
Alert Threshold: $${threshold.toFixed(2)}
Daily Budget: ${config.costControls.dailyBudget ? '$' + config.costControls.dailyBudget.toFixed(2) : 'Unlimited'}
Tier 3 Calls Today: ${config.todaysCost.tier3Calls}

Current Preset: ${config.preset}
LLM Model: ${config.llmConfig.model}

${config.costControls.dailyBudget 
    ? `\n⚠️ WARNING: ${((currentCost / config.costControls.dailyBudget) * 100).toFixed(0)}% of daily budget used!\n\nTier 3 will be automatically paused if budget is exceeded.` 
    : ''}

To reduce costs, consider switching to a more conservative preset:
- Conservative: 5-8% Tier 3 rate ($2-5 per 100 calls)
- Balanced: 10-15% Tier 3 rate ($5-10 per 100 calls)

--
ClientsVia Safety Monitor
            `.trim();
            
            await emailClient.sendEmail('admin@clientsvia.com', subject, message);
            logger.info('✅ [SAFETY MONITOR] Cost alert email sent');
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to send cost alert email:', error);
        }
    }
    
    /**
     * Send budget exceeded email
     */
    static async sendBudgetExceededEmail(currentCost, budget, config) {
        try {
            const subject = `🚨 URGENT: Daily Budget Exceeded - Tier 3 Paused`;
            const message = `
🚨 URGENT: Daily Budget Exceeded

Your Test Pilot Intelligence has exceeded the daily budget limit.
Tier 3 LLM calls have been PAUSED until midnight reset.

Current Cost: $${currentCost.toFixed(2)}
Daily Budget: $${budget.toFixed(2)}
Overage: $${(currentCost - budget).toFixed(2)}
Tier 3 Calls Today: ${config.todaysCost.tier3Calls}

⏸️ TIER 3 LLM CALLS ARE NOW PAUSED

Test calls will now use only Tier 1 (Rule-Based) and Tier 2 (Semantic) matching.
Tier 3 will automatically resume at midnight UTC when the daily cost resets.

Current Preset: ${config.preset}
LLM Model: ${config.llmConfig.model}

Recommendations:
1. Switch to Conservative preset to reduce future Tier 3 usage
2. Increase daily budget if more learning is needed
3. Review today's calls to understand what triggered high LLM usage

Budget will automatically reset at midnight UTC.

--
ClientsVia Safety Monitor
            `.trim();
            
            await emailClient.sendEmail('admin@clientsvia.com', subject, message);
            logger.info('✅ [SAFETY MONITOR] Budget exceeded email sent');
            
        } catch (error) {
            logger.error('❌ [SAFETY MONITOR] Failed to send budget exceeded email:', error);
        }
    }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = IntelligenceSafetyMonitor;


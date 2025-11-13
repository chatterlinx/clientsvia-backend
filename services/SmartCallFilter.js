// ============================================================================
// SMART CALL FILTER SERVICE
// ============================================================================
// 📋 PURPOSE: Intelligent spam/robocall detection and blocking
// 🎯 FEATURES:
//    - Global spam database check
//    - Company-specific blacklist
//    - Frequency analysis (rate limiting)
//    - Pattern detection (robocall behavior)
//    - AI-based suspicious behavior detection
// 🔒 SECURITY: Runs before AI agent processes call
// ============================================================================

const BlockedCallLog = require('../models/BlockedCallLog');
const logger = require('../utils/logger.js');

const GlobalSpamDatabase = require('../models/GlobalSpamDatabase');
const v2Company = require('../models/v2Company');
const { redisClient } = require('../clients');

class SmartCallFilter {
    /**
     * ────────────────────────────────────────────────────────────────────────
     * CHECK IF CALL SHOULD BE BLOCKED
     * ────────────────────────────────────────────────────────────────────────
     * @param {Object} callData - Incoming call data
     * @returns {Object} { shouldBlock: boolean, reason: string, details: object }
     */
    static async checkCall(callData) {
        const {
            callerPhone,
            companyId,
            companyPhone,
            twilioCallSid
        } = callData;

        logger.debug(`🔍 [SMART FILTER] CHECKPOINT 1: Checking call from ${callerPhone} to company ${companyId}`);

        try {
            // ================================================================
            // STEP 1: Check Global Spam Database
            // ================================================================
            logger.security(`🔍 [SMART FILTER] CHECKPOINT 2: Checking global spam database...`);
            const globalCheck = await this.checkGlobalSpamDatabase(callerPhone);
            
            if (globalCheck.shouldBlock) {
                logger.security(`🚫 [SMART FILTER] BLOCKED: Global spam database hit`);
                await this.logBlock({
                    callerPhone,
                    companyId,
                    companyPhone,
                    twilioCallSid,
                    blockReason: 'known_spammer',
                    blockReasonDetails: `Spam score: ${globalCheck.spamScore}`,
                    spamScore: globalCheck.spamScore,
                    detectionMethod: 'database'
                });
                return {
                    shouldBlock: true,
                    reason: 'known_spammer',
                    details: globalCheck
                };
            }

            // ================================================================
            // STEP 2: Check Company Blacklist
            // ================================================================
            logger.security(`🔍 [SMART FILTER] CHECKPOINT 3: Checking company blacklist...`);
            const companyCheck = await this.checkCompanyBlacklist(callerPhone, companyId);
            
            if (companyCheck.shouldBlock) {
                logger.security(`🚫 [SMART FILTER] BLOCKED: Company blacklist hit`);
                await this.logBlock({
                    callerPhone,
                    companyId,
                    companyPhone,
                    twilioCallSid,
                    blockReason: 'company_blacklist',
                    blockReasonDetails: 'Number in company blacklist',
                    spamScore: 100,
                    detectionMethod: 'manual'
                });
                return {
                    shouldBlock: true,
                    reason: 'company_blacklist',
                    details: companyCheck
                };
            }

            // ================================================================
            // STEP 3: Check Call Frequency (Rate Limiting)
            // ================================================================
            logger.security(`🔍 [SMART FILTER] CHECKPOINT 4: Checking call frequency...`);
            const frequencyCheck = await this.checkCallFrequency(callerPhone, companyId);
            
            if (frequencyCheck.shouldBlock) {
                logger.security(`🚫 [SMART FILTER] BLOCKED: High frequency detected`);
                await this.logBlock({
                    callerPhone,
                    companyId,
                    companyPhone,
                    twilioCallSid,
                    blockReason: 'high_frequency',
                    blockReasonDetails: `${frequencyCheck.callCount} calls in ${frequencyCheck.window} minutes`,
                    spamScore: 80,
                    detectionMethod: 'frequency_check'
                });
                return {
                    shouldBlock: true,
                    reason: 'high_frequency',
                    details: frequencyCheck
                };
            }

            // ================================================================
            // STEP 4: Check Robocall Patterns
            // ================================================================
            logger.security(`🔍 [SMART FILTER] CHECKPOINT 5: Checking robocall patterns...`);
            const patternCheck = await this.checkRobocallPattern(callerPhone, companyId);
            
            if (patternCheck.shouldBlock) {
                logger.security(`🚫 [SMART FILTER] BLOCKED: Robocall pattern detected`);
                await this.logBlock({
                    callerPhone,
                    companyId,
                    companyPhone,
                    twilioCallSid,
                    blockReason: 'robo_pattern',
                    blockReasonDetails: patternCheck.reason,
                    spamScore: 90,
                    detectionMethod: 'pattern_analysis'
                });
                
                // Report to global database
                await GlobalSpamDatabase.reportSpam({
                    phoneNumber: callerPhone,
                    spamType: 'robocall',
                    companyId
                });

                return {
                    shouldBlock: true,
                    reason: 'robo_pattern',
                    details: patternCheck
                };
            }

            // ================================================================
            // STEP 5: Validate Phone Number Format
            // ================================================================
            logger.security(`🔍 [SMART FILTER] CHECKPOINT 6: Validating phone format...`);
            const formatCheck = this.validatePhoneFormat(callerPhone);
            
            if (!formatCheck.isValid) {
                logger.security(`🚫 [SMART FILTER] BLOCKED: Invalid phone format`);
                await this.logBlock({
                    callerPhone,
                    companyId,
                    companyPhone,
                    twilioCallSid,
                    blockReason: 'invalid_number',
                    blockReasonDetails: formatCheck.reason,
                    spamScore: 70,
                    detectionMethod: 'pattern_analysis'
                });
                return {
                    shouldBlock: true,
                    reason: 'invalid_number',
                    details: formatCheck
                };
            }

            // ================================================================
            // ALL CHECKS PASSED - ALLOW CALL
            // ================================================================
            logger.security(`✅ [SMART FILTER] CHECKPOINT 7: All checks passed - call allowed`);
            return {
                shouldBlock: false,
                reason: null,
                details: { message: 'Call passed all security checks' }
            };

        } catch (error) {
            logger.security(`❌ [SMART FILTER] ERROR checking call:`, error);
            // On error, allow call (fail open for availability)
            return {
                shouldBlock: false,
                reason: null,
                details: { error: error.message }
            };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CHECK GLOBAL SPAM DATABASE
     * ────────────────────────────────────────────────────────────────────────
     */
    static async checkGlobalSpamDatabase(phoneNumber) {
        try {
            const result = await GlobalSpamDatabase.isSpam(phoneNumber);
            
            if (result.isSpam) {
                return {
                    shouldBlock: true,
                    spamScore: result.entry.spamScore,
                    reports: result.entry.reports.count,
                    spamType: result.entry.spamType
                };
            }

            return { shouldBlock: false };

        } catch (error) {
            logger.error(`❌ [SMART FILTER] Error checking global spam DB:`, error);
            return { shouldBlock: false };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CHECK COMPANY BLACKLIST
     * ────────────────────────────────────────────────────────────────────────
     */
    static async checkCompanyBlacklist(phoneNumber, companyId) {
        try {
            const company = await v2Company.findById(companyId).lean();
            
            if (!company) {return { shouldBlock: false };}

            // Check company's blacklist (stored in company.callFiltering.blacklist)
            const blacklist = company.callFiltering?.blacklist || [];
            const isBlacklisted = blacklist.some(entry => 
                entry.phoneNumber === phoneNumber && entry.status === 'active'
            );

            if (isBlacklisted) {
                return {
                    shouldBlock: true,
                    reason: 'Company manually blacklisted this number'
                };
            }

            return { shouldBlock: false };

        } catch (error) {
            logger.security(`❌ [SMART FILTER] Error checking company blacklist:`, error);
            return { shouldBlock: false };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CHECK CALL FREQUENCY (Rate Limiting)
     * ────────────────────────────────────────────────────────────────────────
     */
    static async checkCallFrequency(phoneNumber, companyId) {
        try {
            // Safety check: Redis might not be connected yet (cold start)
            if (!redisClient) {
                logger.warn('⚠️ [SMART FILTER] Redis not available, skipping frequency check');
                return { shouldBlock: false, callCount: 0 };
            }
            
            const redisKey = `call_freq:${companyId}:${phoneNumber}`;
            
            // Get current count from Redis
            const currentCount = await redisClient.get(redisKey);
            const callCount = currentCount ? parseInt(currentCount) : 0;

            // Threshold: More than 5 calls in 10 minutes = suspicious
            const threshold = 5;
            const window = 10; // minutes

            if (callCount >= threshold) {
                return {
                    shouldBlock: true,
                    callCount,
                    threshold,
                    window
                };
            }

            // Increment counter (expires in 10 minutes)
            await redisClient.setEx(redisKey, 600, (callCount + 1).toString()); // Convert to string for Redis v4+

            return { shouldBlock: false, callCount: callCount + 1 };

        } catch (error) {
            logger.error(`❌ [SMART FILTER] Error checking frequency:`, error);
            return { shouldBlock: false };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * CHECK ROBOCALL PATTERN
     * ────────────────────────────────────────────────────────────────────────
     */
    static async checkRobocallPattern(phoneNumber, companyId) {
        try {
            // Check if this number has called MULTIPLE companies in short time
            const recentBlocks = await BlockedCallLog.countDocuments({
                callerPhone: phoneNumber,
                attemptTime: { $gte: new Date(Date.now() - 3600000) }, // Last hour
                blockReason: { $in: ['robo_pattern', 'high_frequency'] }
            });

            // If blocked 3+ times across companies in last hour = robocaller
            if (recentBlocks >= 3) {
                return {
                    shouldBlock: true,
                    reason: `Blocked ${recentBlocks} times across multiple companies in last hour`
                };
            }

            // Check if number has suspicious pattern (e.g., sequential calls)
            // Safety check: Redis might not be connected yet (cold start)
            if (!redisClient) {
                logger.warn('⚠️ [SMART FILTER] Redis not available, skipping robocall pattern check');
                return { isRobocall: false, reason: 'Redis unavailable' };
            }
            
            const redisKey = `robo_pattern:${phoneNumber}`;
            const callTimes = await redisClient.lRange(redisKey, 0, -1);

            if (callTimes.length >= 10) {
                // More than 10 calls tracked - check if too regular
                const times = callTimes.map(t => parseInt(t));
                const intervals = [];
                
                for (let i = 1; i < times.length; i++) {
                    intervals.push(times[i] - times[i-1]);
                }

                // If intervals are suspiciously regular (within 10 seconds of each other)
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const variance = intervals.every(i => Math.abs(i - avgInterval) < 10000);

                if (variance && avgInterval < 60000) { // Less than 1 minute apart
                    return {
                        shouldBlock: true,
                        reason: 'Robocall pattern: Too regular call intervals'
                    };
                }
            }

            // Track this call attempt
            await redisClient.lPush(redisKey, Date.now().toString()); // Convert timestamp to string for Redis v4+
            await redisClient.lTrim(redisKey, 0, 19); // Keep last 20
            await redisClient.expire(redisKey, 86400); // 24 hours

            return { shouldBlock: false };

        } catch (error) {
            logger.error(`❌ [SMART FILTER] Error checking robocall pattern:`, error);
            return { shouldBlock: false };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * VALIDATE PHONE NUMBER FORMAT
     * ────────────────────────────────────────────────────────────────────────
     */
    static validatePhoneFormat(phoneNumber) {
        // E.164 format: +[country code][number]
        const e164Regex = /^\+[1-9]\d{1,14}$/;

        if (!e164Regex.test(phoneNumber)) {
            return {
                isValid: false,
                reason: 'Invalid E.164 phone format'
            };
        }

        // Check for suspicious patterns (all same digit, etc.)
        const digitsOnly = phoneNumber.replace(/\D/g, '');
        const uniqueDigits = new Set(digitsOnly.split(''));

        if (uniqueDigits.size === 1) {
            return {
                isValid: false,
                reason: 'Suspicious pattern: All same digit'
            };
        }

        return { isValid: true };
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * LOG BLOCKED CALL
     * ────────────────────────────────────────────────────────────────────────
     */
    static async logBlock(data) {
        try {
            await BlockedCallLog.logBlock(data);
            logger.security(`✅ [SMART FILTER] Block logged for ${data.callerPhone}`);
        } catch (error) {
            logger.security(`❌ [SMART FILTER] Error logging block:`, error);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * REPORT SPAM (manual admin action)
     * ────────────────────────────────────────────────────────────────────────
     */
    static async reportSpam(phoneNumber, companyId, spamType = 'other') {
        try {
            logger.info(`📝 [SMART FILTER] Reporting spam: ${phoneNumber}`);
            
            await GlobalSpamDatabase.reportSpam({
                phoneNumber,
                spamType,
                companyId
            });

            logger.info(`✅ [SMART FILTER] Spam reported successfully`);
            return { success: true };

        } catch (error) {
            logger.error(`❌ [SMART FILTER] Error reporting spam:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * WHITELIST NUMBER (remove from spam)
     * ────────────────────────────────────────────────────────────────────────
     */
    static async whitelistNumber(phoneNumber, reason) {
        try {
            logger.security(`✅ [SMART FILTER] Whitelisting: ${phoneNumber}`);
            
            await GlobalSpamDatabase.whitelist(phoneNumber, reason);

            logger.security(`✅ [SMART FILTER] Number whitelisted successfully`);
            return { success: true };

        } catch (error) {
            logger.security(`❌ [SMART FILTER] Error whitelisting:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * GET SPAM STATISTICS
     * ────────────────────────────────────────────────────────────────────────
     */
    static async getSpamStats(companyId = null) {
        try {
            if (companyId) {
                // Company-specific stats
                return await BlockedCallLog.getSpamStats(companyId);
            } 
                // Global stats
                return await GlobalSpamDatabase.getStats();
            
        } catch (error) {
            logger.error(`❌ [SMART FILTER] Error getting stats:`, error);
            return null;
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * 🤖 AUTO-ADD TO BLACKLIST (from edge case detection)
     * ────────────────────────────────────────────────────────────────────────
     * Purpose: Automatically add spam numbers to blacklist when edge cases detect them
     * 
     * Flow:
     * 1. Check if auto-blacklist is enabled for company
     * 2. Verify number isn't already blacklisted or whitelisted
     * 3. Check detection threshold (must be detected N times)
     * 4. Add to blacklist with appropriate status (pending or active)
     * 5. Clear Redis cache
     * 6. Log comprehensive audit trail
     * 
     * @param {Object} data - Auto-blacklist data
     * @param {String} data.companyId - Company MongoDB ID
     * @param {String} data.phoneNumber - E.164 phone number to blacklist
     * @param {String} data.edgeCaseName - Name of edge case that triggered detection
     * @param {String} data.detectionMethod - Detection method (default: 'edge_case')
     * @returns {Object} { success: boolean, status?: string, reason?: string, error?: string }
     * ────────────────────────────────────────────────────────────────────────
     */
    static async autoAddToBlacklist(data) {
        const { companyId, phoneNumber, edgeCaseName, detectionMethod = 'edge_case' } = data;
        
        // ====================================================================
        // CHECKPOINT 1: Input validation
        // ====================================================================
        logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 1: Triggered for ${phoneNumber} (Edge Case: ${edgeCaseName})`);
        
        if (!companyId || !phoneNumber || !edgeCaseName) {
            logger.error(`❌ [AUTO-BLACKLIST] CHECKPOINT 1 FAILED: Missing required fields`, {
                companyId: !!companyId,
                phoneNumber: !!phoneNumber,
                edgeCaseName: !!edgeCaseName
            });
            return { success: false, error: 'Missing required fields' };
        }
        
        try {
            // ====================================================================
            // CHECKPOINT 2: Load company settings
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 2: Loading company settings...`);
            
            const company = await v2Company.findById(companyId);
            if (!company) {
                logger.error(`❌ [AUTO-BLACKLIST] CHECKPOINT 2 FAILED: Company not found: ${companyId}`);
                return { success: false, error: 'Company not found' };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 2 PASSED: Company found`);
            
            // ====================================================================
            // CHECKPOINT 3: Check if auto-blacklist is enabled
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 3: Checking if auto-blacklist enabled...`);
            
            const autoBlacklistEnabled = company.callFiltering?.settings?.autoBlacklistEnabled || false;
            
            if (!autoBlacklistEnabled) {
                logger.info(`⏭️ [AUTO-BLACKLIST] CHECKPOINT 3 SKIPPED: Auto-blacklist disabled for company ${companyId}`);
                return { success: false, reason: 'Auto-blacklist disabled' };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 3 PASSED: Auto-blacklist enabled`);
            
            // ====================================================================
            // CHECKPOINT 4: Check if edge case is in triggers
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 4: Checking if edge case matches triggers...`);
            
            const triggers = company.callFiltering?.settings?.autoBlacklistTriggers || [];
            const edgeCaseId = edgeCaseName.toLowerCase().replace(/\s+/g, '_');
            
            if (!triggers.includes(edgeCaseId)) {
                logger.info(`⏭️ [AUTO-BLACKLIST] CHECKPOINT 4 SKIPPED: Edge case "${edgeCaseName}" (${edgeCaseId}) not in triggers`, {
                    configuredTriggers: triggers
                });
                return { success: false, reason: 'Edge case not in triggers' };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 4 PASSED: Edge case matches trigger "${edgeCaseId}"`);
            
            // ====================================================================
            // CHECKPOINT 5: Initialize callFiltering if needed
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 5: Initializing callFiltering structure...`);
            
            if (!company.callFiltering) {
                company.callFiltering = { 
                    enabled: true, 
                    blacklist: [], 
                    whitelist: [], 
                    settings: {}, 
                    stats: {} 
                };
                logger.info(`✅ [AUTO-BLACKLIST] CHECKPOINT 5: Initialized empty callFiltering`);
            } else {
                logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 5: callFiltering already exists`);
            }
            
            // ====================================================================
            // CHECKPOINT 6: Check if number is whitelisted (always override)
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 6: Checking whitelist...`);
            
            const isWhitelisted = company.callFiltering.whitelist?.some(entry => 
                entry.phoneNumber === phoneNumber && entry.status !== 'removed'
            ) || false;
            
            if (isWhitelisted) {
                logger.security(`⏭️ [AUTO-BLACKLIST] CHECKPOINT 6 BLOCKED: Number ${phoneNumber} is whitelisted - NEVER auto-blacklist`);
                return { success: false, reason: 'Number is whitelisted' };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 6 PASSED: Number not whitelisted`);
            
            // ====================================================================
            // CHECKPOINT 7: Check if already blacklisted
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 7: Checking if already blacklisted...`);
            
            const existing = company.callFiltering.blacklist.find(entry => 
                entry.phoneNumber === phoneNumber && 
                (entry.status === 'active' || entry.status === 'pending')
            );
            
            if (existing) {
                logger.info(`⏭️ [AUTO-BLACKLIST] CHECKPOINT 7 SKIPPED: Number already in blacklist`, {
                    status: existing.status,
                    source: existing.source,
                    addedAt: existing.addedAt
                });
                return { success: false, reason: 'Already blacklisted', existingStatus: existing.status };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 7 PASSED: Number not in blacklist`);
            
            // ====================================================================
            // CHECKPOINT 8: Check detection threshold
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 8: Checking detection threshold...`);
            
            const threshold = company.callFiltering.settings?.autoBlacklistThreshold || 1;
            
            // Count recent detections in BlockedCallLog
            const recentDetections = await BlockedCallLog.countDocuments({
                callerPhone: phoneNumber,
                companyId,
                detectionMethod: 'edge_case',
                attemptTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
            });
            
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 8: Recent detections: ${recentDetections}, Threshold: ${threshold}`);
            
            if (recentDetections < threshold) {
                logger.info(`⏭️ [AUTO-BLACKLIST] CHECKPOINT 8 NOT MET: Threshold not reached (${recentDetections}/${threshold})`);
                return { 
                    success: false, 
                    reason: 'Threshold not met', 
                    detections: recentDetections,
                    threshold
                };
            }
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 8 PASSED: Threshold met (${recentDetections}/${threshold})`);
            
            // ====================================================================
            // CHECKPOINT 9: Determine status (pending vs active)
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 9: Determining status...`);
            
            const requireApproval = company.callFiltering.settings?.requireAdminApproval !== false; // Default true
            const status = requireApproval ? 'pending' : 'active';
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 9: Status determined: "${status}" (requireApproval: ${requireApproval})`);
            
            // ====================================================================
            // CHECKPOINT 10: Add to blacklist
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 10: Adding to blacklist...`);
            
            company.callFiltering.blacklist.push({
                phoneNumber,
                reason: `Auto-detected: ${edgeCaseName}`,
                addedAt: new Date(),
                addedBy: 'system',
                status,
                source: 'auto',
                detectionMethod,
                edgeCaseName,
                timesBlocked: 0,  // Will be incremented when actually blocks a call
                lastBlockedAt: null
            });
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 10: Added to blacklist (status: ${status})`);
            
            // ====================================================================
            // CHECKPOINT 11: Save to MongoDB
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 11: Saving to MongoDB...`);
            
            await company.save();
            
            logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 11: Saved to MongoDB successfully`);
            
            // ====================================================================
            // CHECKPOINT 12: Clear Redis cache
            // ====================================================================
            logger.security(`🤖 [AUTO-BLACKLIST] CHECKPOINT 12: Clearing Redis cache...`);
            
            const { redisClient } = require('../clients');
            try {
                await redisClient.del(`company:${companyId}`);
                logger.security(`✅ [AUTO-BLACKLIST] CHECKPOINT 12: Redis cache cleared`);
            } catch (cacheError) {
                logger.warn(`⚠️ [AUTO-BLACKLIST] CHECKPOINT 12 WARNING: Cache clear failed (non-critical):`, cacheError.message);
            }
            
            // ====================================================================
            // SUCCESS: Log comprehensive summary
            // ====================================================================
            logger.security(`🎉 [AUTO-BLACKLIST] SUCCESS: Number auto-blacklisted`, {
                phoneNumber,
                edgeCaseName,
                status,
                requireApproval,
                companyId,
                detectionMethod,
                willBlockCalls: status === 'active'
            });
            
            return { 
                success: true, 
                status,
                message: status === 'pending' 
                    ? 'Added to blacklist (pending admin approval)' 
                    : 'Added to blacklist (active - blocking calls)'
            };
            
        } catch (error) {
            logger.error(`❌ [AUTO-BLACKLIST] CRITICAL ERROR:`, {
                error: error.message,
                stack: error.stack,
                companyId,
                phoneNumber,
                edgeCaseName
            });
            return { success: false, error: error.message };
        }
    }
}

// ============================================================================
// EXPORT
// ============================================================================
module.exports = SmartCallFilter;


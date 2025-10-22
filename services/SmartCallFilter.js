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

        console.log(`🔍 [SMART FILTER] CHECKPOINT 1: Checking call from ${callerPhone} to company ${companyId}`);

        try {
            // ================================================================
            // STEP 1: Check Global Spam Database
            // ================================================================
            console.log(`🔍 [SMART FILTER] CHECKPOINT 2: Checking global spam database...`);
            const globalCheck = await this.checkGlobalSpamDatabase(callerPhone);
            
            if (globalCheck.shouldBlock) {
                console.log(`🚫 [SMART FILTER] BLOCKED: Global spam database hit`);
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
            console.log(`🔍 [SMART FILTER] CHECKPOINT 3: Checking company blacklist...`);
            const companyCheck = await this.checkCompanyBlacklist(callerPhone, companyId);
            
            if (companyCheck.shouldBlock) {
                console.log(`🚫 [SMART FILTER] BLOCKED: Company blacklist hit`);
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
            console.log(`🔍 [SMART FILTER] CHECKPOINT 4: Checking call frequency...`);
            const frequencyCheck = await this.checkCallFrequency(callerPhone, companyId);
            
            if (frequencyCheck.shouldBlock) {
                console.log(`🚫 [SMART FILTER] BLOCKED: High frequency detected`);
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
            console.log(`🔍 [SMART FILTER] CHECKPOINT 5: Checking robocall patterns...`);
            const patternCheck = await this.checkRobocallPattern(callerPhone, companyId);
            
            if (patternCheck.shouldBlock) {
                console.log(`🚫 [SMART FILTER] BLOCKED: Robocall pattern detected`);
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
            console.log(`🔍 [SMART FILTER] CHECKPOINT 6: Validating phone format...`);
            const formatCheck = this.validatePhoneFormat(callerPhone);
            
            if (!formatCheck.isValid) {
                console.log(`🚫 [SMART FILTER] BLOCKED: Invalid phone format`);
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
            console.log(`✅ [SMART FILTER] CHECKPOINT 7: All checks passed - call allowed`);
            return {
                shouldBlock: false,
                reason: null,
                details: { message: 'Call passed all security checks' }
            };

        } catch (error) {
            console.error(`❌ [SMART FILTER] ERROR checking call:`, error);
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
            console.error(`❌ [SMART FILTER] Error checking global spam DB:`, error);
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
            console.error(`❌ [SMART FILTER] Error checking company blacklist:`, error);
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
            await redisClient.setex(redisKey, 600, callCount + 1);

            return { shouldBlock: false, callCount: callCount + 1 };

        } catch (error) {
            console.error(`❌ [SMART FILTER] Error checking frequency:`, error);
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
            const redisKey = `robo_pattern:${phoneNumber}`;
            const callTimes = await redisClient.lrange(redisKey, 0, -1);

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
            await redisClient.lpush(redisKey, Date.now());
            await redisClient.ltrim(redisKey, 0, 19); // Keep last 20
            await redisClient.expire(redisKey, 86400); // 24 hours

            return { shouldBlock: false };

        } catch (error) {
            console.error(`❌ [SMART FILTER] Error checking robocall pattern:`, error);
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
            console.log(`✅ [SMART FILTER] Block logged for ${data.callerPhone}`);
        } catch (error) {
            console.error(`❌ [SMART FILTER] Error logging block:`, error);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * REPORT SPAM (manual admin action)
     * ────────────────────────────────────────────────────────────────────────
     */
    static async reportSpam(phoneNumber, companyId, spamType = 'other') {
        try {
            console.log(`📝 [SMART FILTER] Reporting spam: ${phoneNumber}`);
            
            await GlobalSpamDatabase.reportSpam({
                phoneNumber,
                spamType,
                companyId
            });

            console.log(`✅ [SMART FILTER] Spam reported successfully`);
            return { success: true };

        } catch (error) {
            console.error(`❌ [SMART FILTER] Error reporting spam:`, error);
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
            console.log(`✅ [SMART FILTER] Whitelisting: ${phoneNumber}`);
            
            await GlobalSpamDatabase.whitelist(phoneNumber, reason);

            console.log(`✅ [SMART FILTER] Number whitelisted successfully`);
            return { success: true };

        } catch (error) {
            console.error(`❌ [SMART FILTER] Error whitelisting:`, error);
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
            console.error(`❌ [SMART FILTER] Error getting stats:`, error);
            return null;
        }
    }
}

// ============================================================================
// EXPORT
// ============================================================================
module.exports = SmartCallFilter;


// ============================================================================
// 📊 ERROR TREND TRACKER
// ============================================================================
// Track error patterns over time, detect regressions, and identify trends
// 
// FEATURES:
// ✅ Historical error tracking
// ✅ Trend analysis (increasing, decreasing, stable)
// ✅ Regression detection
// ✅ Anomaly detection
// ✅ Frequency analysis
// ============================================================================

const NotificationLog = require('../models/NotificationLog');
const SystemHealthSnapshot = require('../models/SystemHealthSnapshot');
const logger = require('../utils/logger.js');

class ErrorTrendTracker {
    
    // ========================================================================
    // GET ERROR TRENDS - Analyze error patterns over time periods
    // ========================================================================
    async getErrorTrends(periodHours = 24) {
        try {
            logger.info(`📊 [TREND TRACKER] Analyzing error trends for last ${periodHours} hours`);

            const now = new Date();
            const cutoffTime = new Date(now.getTime() - periodHours * 60 * 60 * 1000);

            // Get all errors in time period
            const errors = await NotificationLog.find({
                createdAt: { $gte: cutoffTime }
            }).sort({ createdAt: 1 });

            if (errors.length === 0) {
                return {
                    periodHours,
                    totalErrors: 0,
                    message: 'No errors in time period'
                };
            }

            // Group errors by hour
            const errorsByHour = this.groupByTimeInterval(errors, 'hour');
            
            // Group errors by code
            const errorsByCode = this.groupByCode(errors);

            // Calculate trends
            const trends = this.calculateTrends(errorsByHour);
            const topErrors = this.getTopErrors(errorsByCode, 10);
            const newErrors = await this.detectNewErrors(errors, periodHours);
            const anomalies = this.detectAnomalies(errorsByHour);

            return {
                periodHours,
                totalErrors: errors.length,
                errorRate: Math.round((errors.length / periodHours) * 10) / 10, // Errors per hour
                trend: trends.overall,
                trends: {
                    overall: trends.overall,
                    direction: trends.direction,
                    changePercentage: trends.changePercentage
                },
                topErrors,
                newErrors,
                anomalies,
                hourlyBreakdown: errorsByHour,
                severityDistribution: this.getSeverityDistribution(errors)
            };

        } catch (error) {
            logger.error('❌ [TREND TRACKER] Failed to get error trends:', error);
            throw error;
        }
    }

    // ========================================================================
    // CALCULATE TRENDS - Determine if errors are increasing/decreasing
    // ========================================================================
    calculateTrends(errorsByHour) {
        const hours = Object.keys(errorsByHour).sort();
        if (hours.length < 2) {
            return {
                overall: 'INSUFFICIENT_DATA',
                direction: 'UNKNOWN',
                changePercentage: 0
            };
        }

        // Compare first half vs second half
        const midpoint = Math.floor(hours.length / 2);
        const firstHalf = hours.slice(0, midpoint);
        const secondHalf = hours.slice(midpoint);

        const firstHalfAvg = firstHalf.reduce((sum, hour) => 
            sum + errorsByHour[hour].count, 0) / firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, hour) => 
            sum + errorsByHour[hour].count, 0) / secondHalf.length;

        const change = secondHalfAvg - firstHalfAvg;
        const changePercentage = firstHalfAvg > 0 
            ? Math.round((change / firstHalfAvg) * 100) 
            : 0;

        let direction, overall;

        if (Math.abs(changePercentage) < 10) {
            direction = 'STABLE';
            overall = 'STABLE';
        } else if (changePercentage > 0) {
            direction = 'INCREASING';
            overall = changePercentage > 50 ? 'CRITICAL_INCREASE' : 'INCREASING';
        } else {
            direction = 'DECREASING';
            overall = changePercentage < -50 ? 'SIGNIFICANT_DECREASE' : 'DECREASING';
        }

        return {
            overall,
            direction,
            changePercentage,
            firstHalfAvg: Math.round(firstHalfAvg * 10) / 10,
            secondHalfAvg: Math.round(secondHalfAvg * 10) / 10
        };
    }

    // ========================================================================
    // DETECT NEW ERRORS - Find errors that weren't present before
    // ========================================================================
    async detectNewErrors(currentErrors, periodHours) {
        try {
            // Get historical baseline (previous period of same length)
            const historicalCutoff = new Date(Date.now() - periodHours * 2 * 60 * 60 * 1000);
            const currentCutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000);

            const historicalErrors = await NotificationLog.find({
                createdAt: { 
                    $gte: historicalCutoff,
                    $lt: currentCutoff
                }
            }).distinct('code');

            const currentCodes = [...new Set(currentErrors.map(err => err.code))];
            const newCodes = currentCodes.filter(code => !historicalErrors.includes(code));

            if (newCodes.length === 0) {
                return {
                    hasNewErrors: false,
                    count: 0
                };
            }

            const newErrorDetails = newCodes.map(code => {
                const firstOccurrence = currentErrors.find(err => err.code === code);
                const occurrences = currentErrors.filter(err => err.code === code).length;

                return {
                    code,
                    firstSeen: firstOccurrence.createdAt,
                    occurrences,
                    severity: firstOccurrence.severity,
                    message: firstOccurrence.message
                };
            });

            return {
                hasNewErrors: true,
                count: newCodes.length,
                errors: newErrorDetails
            };

        } catch (error) {
            logger.error('❌ [TREND TRACKER] Failed to detect new errors:', error);
            return {
                hasNewErrors: false,
                count: 0,
                error: error.message
            };
        }
    }

    // ========================================================================
    // DETECT ANOMALIES - Find unusual error spikes
    // ========================================================================
    detectAnomalies(errorsByHour) {
        const hours = Object.keys(errorsByHour);
        if (hours.length < 3) {
            return {
                hasAnomalies: false,
                message: 'Insufficient data for anomaly detection'
            };
        }

        const counts = hours.map(hour => errorsByHour[hour].count);
        const average = counts.reduce((a, b) => a + b, 0) / counts.length;
        const stdDev = Math.sqrt(
            counts.reduce((sum, count) => sum + Math.pow(count - average, 2), 0) / counts.length
        );

        // Anomaly = value > 2 standard deviations from mean
        const threshold = average + (2 * stdDev);
        const anomalies = [];

        hours.forEach(hour => {
            const count = errorsByHour[hour].count;
            if (count > threshold) {
                anomalies.push({
                    hour,
                    errorCount: count,
                    average: Math.round(average),
                    deviation: Math.round(((count - average) / average) * 100),
                    severity: count > average * 3 ? 'CRITICAL' : 'WARNING'
                });
            }
        });

        return {
            hasAnomalies: anomalies.length > 0,
            count: anomalies.length,
            anomalies,
            baseline: {
                average: Math.round(average * 10) / 10,
                stdDev: Math.round(stdDev * 10) / 10,
                threshold: Math.round(threshold)
            }
        };
    }

    // ========================================================================
    // COMPARE WITH BASELINE - Detect regressions
    // ========================================================================
    async compareWithBaseline() {
        try {
            logger.info('📊 [TREND TRACKER] Comparing current state with baseline');

            // Get last known good snapshot
            const lastGood = await SystemHealthSnapshot.getLastKnownGood();
            if (!lastGood) {
                return {
                    hasBaseline: false,
                    message: 'No baseline snapshot available'
                };
            }

            // Get recent errors (last 1 hour)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const recentErrors = await NotificationLog.find({
                createdAt: { $gte: oneHourAgo }
            });

            const currentErrorRate = recentErrors.length;
            const baselineErrorRate = lastGood.errors?.last1Hour || 0;
            const errorRateChange = ((currentErrorRate - baselineErrorRate) / Math.max(baselineErrorRate, 1)) * 100;

            // Check for regressions
            const regressions = [];

            if (errorRateChange > 50) {
                regressions.push({
                    type: 'ERROR_RATE_SPIKE',
                    severity: 'CRITICAL',
                    message: `Error rate increased ${Math.round(errorRateChange)}% from baseline`,
                    baseline: baselineErrorRate,
                    current: currentErrorRate
                });
            }

            // Check for new critical errors
            const currentCritical = recentErrors.filter(err => err.severity === 'CRITICAL').length;
            const baselineCritical = lastGood.errors?.criticalCount || 0;

            if (currentCritical > baselineCritical) {
                regressions.push({
                    type: 'NEW_CRITICAL_ERRORS',
                    severity: 'CRITICAL',
                    message: `${currentCritical - baselineCritical} new critical error(s) detected`,
                    baseline: baselineCritical,
                    current: currentCritical
                });
            }

            return {
                hasBaseline: true,
                isRegression: regressions.length > 0,
                regressions,
                comparison: {
                    errorRate: {
                        baseline: baselineErrorRate,
                        current: currentErrorRate,
                        changePercentage: Math.round(errorRateChange)
                    },
                    criticalErrors: {
                        baseline: baselineCritical,
                        current: currentCritical
                    },
                    lastGoodState: lastGood.createdAt,
                    timeSinceGood: Math.round((Date.now() - lastGood.createdAt.getTime()) / 60000) // minutes
                }
            };

        } catch (error) {
            logger.error('❌ [TREND TRACKER] Baseline comparison failed:', error);
            throw error;
        }
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    groupByTimeInterval(errors, interval = 'hour') {
        const grouped = {};

        errors.forEach(error => {
            let key;
            const date = new Date(error.createdAt);

            if (interval === 'hour') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
            } else if (interval === 'day') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            }

            if (!grouped[key]) {
                grouped[key] = {
                    count: 0,
                    critical: 0,
                    warning: 0,
                    info: 0,
                    codes: []
                };
            }

            grouped[key].count++;
            grouped[key][error.severity.toLowerCase()]++;
            grouped[key].codes.push(error.code);
        });

        return grouped;
    }

    groupByCode(errors) {
        const grouped = {};

        errors.forEach(error => {
            if (!grouped[error.code]) {
                grouped[error.code] = {
                    count: 0,
                    severity: error.severity,
                    firstSeen: error.createdAt,
                    lastSeen: error.createdAt,
                    companies: new Set()
                };
            }

            grouped[error.code].count++;
            grouped[error.code].lastSeen = error.createdAt;
            if (error.companyId) {
                grouped[error.code].companies.add(error.companyId);
            }
        });

        // Convert Sets to counts
        Object.keys(grouped).forEach(code => {
            grouped[code].affectedCompanies = grouped[code].companies.size;
            delete grouped[code].companies;
        });

        return grouped;
    }

    getTopErrors(errorsByCode, limit = 10) {
        return Object.entries(errorsByCode)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit)
            .map(([code, data]) => ({
                code,
                count: data.count,
                severity: data.severity,
                affectedCompanies: data.affectedCompanies,
                firstSeen: data.firstSeen,
                lastSeen: data.lastSeen
            }));
    }

    getSeverityDistribution(errors) {
        const distribution = {
            CRITICAL: 0,
            WARNING: 0,
            INFO: 0
        };

        errors.forEach(error => {
            distribution[error.severity]++;
        });

        return distribution;
    }
}

// Export both the class and a lazy-initialized singleton
let _instance = null;

module.exports = {
    // Get singleton instance (lazy initialization)
    getInstance: function() {
        if (!_instance) {
            _instance = new ErrorTrendTracker();
        }
        return _instance;
    },
    // Also export the class itself for testing
    ErrorTrendTracker
};


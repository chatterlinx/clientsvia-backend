/**
 * ============================================================================
 * COMPANY HEALTH SERVICE
 * ============================================================================
 * Calculates health scores, flags, and metrics for companies
 * Used by Data Center to identify junk, stale, and problematic companies
 * ============================================================================
 */

const mongoose = require('mongoose');

class CompanyHealthService {
    /**
     * Calculate comprehensive health metrics for a company
     * @param {Object} company - Company document (can be lean or full)
     * @param {Object} aggregatedData - Pre-computed counts from aggregation
     * @returns {Object} Health metrics
     */
    static calculateHealth(company, aggregatedData = {}) {
        const health = {
            score: 0,
            isLive: false,
            flags: [],
            metrics: {
                callCount: aggregatedData.calls || 0,
                scenarioCount: 0,
                lastActivity: aggregatedData.lastActivity || null,
                dataSize: aggregatedData.approxStorageBytes || 0,
                readinessScore: 0
            }
        };

        // Extract scenario count
        const scenarios = company.aiAgentLogic?.instantResponses || [];
        health.metrics.scenarioCount = Array.isArray(scenarios) ? scenarios.length : 0;

        // Extract readiness score
        health.metrics.readinessScore = company.aiAgentLogic?.readiness?.score || 0;

        // Determine if company is "live"
        const hasPhone = company.twilioConfig?.phoneNumbers?.length > 0 ||
                        company.twilioConfig?.phoneNumber;
        const hasScenarios = health.metrics.scenarioCount > 0;
        const hasCalls = health.metrics.callCount > 0;
        
        health.isLive = hasPhone && hasScenarios && hasCalls;

        // Calculate health score (0-100)
        let score = 0;

        // Phone number configured: +20
        if (hasPhone) score += 20;

        // Has scenarios: +20
        if (hasScenarios) score += 20;

        // Has calls: +30
        if (hasCalls) score += 30;

        // Recent activity: +20
        const daysSinceActivity = health.metrics.lastActivity
            ? Math.floor((Date.now() - new Date(health.metrics.lastActivity)) / (1000 * 60 * 60 * 24))
            : Infinity;
        
        if (daysSinceActivity < 7) score += 20;
        else if (daysSinceActivity < 30) score += 10;
        else if (daysSinceActivity < 60) score += 5;

        // Readiness score: +10
        if (health.metrics.readinessScore >= 80) score += 10;
        else if (health.metrics.readinessScore >= 50) score += 5;

        health.score = Math.min(100, score);

        // Generate flags
        health.flags = this.generateFlags(company, health.metrics, daysSinceActivity);

        return health;
    }

    /**
     * Generate health flags for a company
     */
    static generateFlags(company, metrics, daysSinceActivity) {
        const flags = [];

        // NO_PHONE - No Twilio number configured
        if (!company.twilioConfig?.phoneNumbers?.length && !company.twilioConfig?.phoneNumber) {
            flags.push('NO_PHONE');
        }

        // NO_SCENARIOS - No instant responses configured
        if (metrics.scenarioCount === 0) {
            flags.push('NO_SCENARIOS');
        }

        // ZERO_CALLS - Never received a call
        if (metrics.callCount === 0) {
            flags.push('ZERO_CALLS');
        }

        // STALE_60D - No activity in 60+ days
        if (daysSinceActivity > 60) {
            flags.push('STALE_60D');
        }

        // STALE_30D - No activity in 30-60 days
        if (daysSinceActivity > 30 && daysSinceActivity <= 60) {
            flags.push('STALE_30D');
        }

        // TEST_ACCOUNT - Name suggests test/demo
        const name = (company.companyName || company.businessName || '').toLowerCase();
        if (/test|demo|sample|debug|trial|temp|temporary/i.test(name)) {
            flags.push('TEST_ACCOUNT');
        }

        // LOW_READINESS - Readiness score below 30
        if (metrics.readinessScore < 30) {
            flags.push('LOW_READINESS');
        }

        // NEVER_LIVE - Has phone but never went live
        const hasPhone = company.twilioConfig?.phoneNumbers?.length > 0 ||
                        company.twilioConfig?.phoneNumber;
        if (hasPhone && metrics.callCount === 0 && metrics.scenarioCount === 0) {
            flags.push('NEVER_LIVE');
        }

        // LARGE_DATA - Over 500MB of data
        if (metrics.dataSize > 500 * 1024 * 1024) {
            flags.push('LARGE_DATA');
        }

        // DELETED - Soft deleted
        if (company.isDeleted) {
            flags.push('DELETED');
        }

        // SUSPENDED - Account suspended
        if (company.accountStatus?.status === 'suspended') {
            flags.push('SUSPENDED');
        }

        return flags;
    }

    /**
     * Get health badge (visual indicator)
     * @returns {Object} {color, icon, label, tooltip}
     */
    static getHealthBadge(health) {
        if (health.flags.includes('DELETED')) {
            return {
                color: 'red',
                icon: '🗑️',
                label: 'Deleted',
                tooltip: 'Soft deleted - will auto-purge in 30 days'
            };
        }

        if (health.flags.includes('SUSPENDED')) {
            return {
                color: 'red',
                icon: '⛔',
                label: 'Suspended',
                tooltip: 'Account suspended'
            };
        }

        if (health.isLive && health.score >= 70) {
            return {
                color: 'green',
                icon: '🟢',
                label: 'Live',
                tooltip: 'Active and healthy'
            };
        }

        if (health.flags.includes('STALE_60D')) {
            return {
                color: 'yellow',
                icon: '🟡',
                label: 'Stale',
                tooltip: 'No activity in 60+ days'
            };
        }

        if (health.flags.includes('NEVER_LIVE') || health.flags.includes('ZERO_CALLS')) {
            return {
                color: 'red',
                icon: '🔴',
                label: 'Never Live',
                tooltip: 'Company never went live'
            };
        }

        if (health.flags.includes('TEST_ACCOUNT')) {
            return {
                color: 'blue',
                icon: '🧪',
                label: 'Test',
                tooltip: 'Test or demo account'
            };
        }

        return {
            color: 'yellow',
            icon: '🟡',
            label: 'Inactive',
            tooltip: 'Company configured but not fully active'
        };
    }

    /**
     * Format data size for display
     */
    static formatDataSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    /**
     * Format last activity for display
     */
    static formatLastActivity(date) {
        if (!date) return 'Never';
        
        const now = new Date();
        const activity = new Date(date);
        const diffMs = now - activity;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
        return `${Math.floor(diffDays / 365)}y ago`;
    }
}

module.exports = CompanyHealthService;


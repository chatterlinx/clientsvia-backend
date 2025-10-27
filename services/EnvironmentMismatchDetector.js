/**
 * ============================================================================
 * ENVIRONMENT MISMATCH DETECTOR
 * ============================================================================
 * 
 * PURPOSE:
 * Detects when local database differs significantly from production database
 * Prevents developers from making wrong assumptions about data state
 * 
 * ALERTS WHEN:
 * - Local has significantly different counts than production
 * - Developer runs scripts against wrong database
 * - Data integrity issues between environments
 * 
 * ============================================================================
 */

const axios = require('axios');
const logger = require('../utils/logger');
const AdminNotificationService = require('./AdminNotificationService');

class EnvironmentMismatchDetector {
    constructor() {
        this.productionUrl = process.env.RENDER_EXTERNAL_URL || 'https://clientsvia-backend.onrender.com';
        this.localUrl = process.env.LOCAL_URL || 'http://localhost:3000';
        this.isLocal = process.env.NODE_ENV !== 'production';
    }

    /**
     * Check if local and production databases are in sync
     * @param {String} collection - Collection name (behaviors, templates, companies)
     * @returns {Object} - Comparison results
     */
    async checkSync(collection) {
        try {
            const endpoints = {
                behaviors: '/api/admin/global-behaviors',
                templates: '/api/admin/global-instant-responses',
                companies: '/api/companies'
            };

            const endpoint = endpoints[collection];
            if (!endpoint) {
                throw new Error(`Unknown collection: ${collection}`);
            }

            // Get production count
            let productionCount = 0;
            let localCount = 0;

            try {
                const prodResponse = await axios.get(`${this.productionUrl}${endpoint}`, {
                    timeout: 5000,
                    headers: { 'User-Agent': 'EnvironmentMismatchDetector' }
                });
                productionCount = prodResponse.data?.data?.length || prodResponse.data?.length || 0;
            } catch (error) {
                logger.warn(`[ENV SYNC] Could not reach production: ${error.message}`);
            }

            // Get local count
            if (this.isLocal) {
                try {
                    const localResponse = await axios.get(`${this.localUrl}${endpoint}`, {
                        timeout: 2000,
                        headers: { 'User-Agent': 'EnvironmentMismatchDetector' }
                    });
                    localCount = localResponse.data?.data?.length || localResponse.data?.length || 0;
                } catch (error) {
                    logger.warn(`[ENV SYNC] Could not reach local: ${error.message}`);
                }
            }

            const difference = Math.abs(productionCount - localCount);
            const percentDiff = productionCount > 0 ? (difference / productionCount) * 100 : 0;

            const result = {
                collection,
                productionCount,
                localCount,
                difference,
                percentDiff,
                isSignificant: percentDiff > 20, // Alert if >20% difference
                isMismatch: productionCount !== localCount
            };

            // Send alert if significant mismatch
            if (result.isSignificant && this.isLocal) {
                await AdminNotificationService.sendAlert({
                    code: 'ENVIRONMENT_DATA_MISMATCH',
                    severity: 'WARNING',
                    companyId: null,
                    companyName: 'Platform',
                    message: `⚠️ Local and Production ${collection} counts differ significantly`,
                    details: {
                        collection,
                        productionCount,
                        localCount,
                        difference,
                        percentDifference: `${percentDiff.toFixed(1)}%`,
                        impact: 'Developer may be checking wrong database, could lead to data loss or incorrect assumptions',
                        suggestedFix: `Sync local database with production or use production database for testing. Run: node scripts/sync-from-production.js`,
                        detectedBy: 'EnvironmentMismatchDetector'
                    }
                }).catch(err => logger.error('Failed to send mismatch alert:', err));
            }

            return result;
        } catch (error) {
            logger.error(`[ENV SYNC] Error checking ${collection}:`, error);
            return {
                collection,
                error: error.message,
                productionCount: null,
                localCount: null,
                isSignificant: false,
                isMismatch: false
            };
        }
    }

    /**
     * Run comprehensive sync check across all collections
     * @returns {Array} - Results for all collections
     */
    async runFullCheck() {
        logger.info('🔍 [ENV SYNC] Running full environment sync check...');

        const results = await Promise.all([
            this.checkSync('behaviors'),
            this.checkSync('templates'),
            this.checkSync('companies')
        ]);

        // Log summary
        const mismatches = results.filter(r => r.isMismatch);
        const significant = results.filter(r => r.isSignificant);

        if (significant.length > 0) {
            logger.warn(`⚠️ [ENV SYNC] Found ${significant.length} significant mismatches:`);
            significant.forEach(r => {
                logger.warn(`  - ${r.collection}: Local ${r.localCount} vs Production ${r.productionCount} (${r.percentDiff.toFixed(1)}% diff)`);
            });
        } else {
            logger.info(`✅ [ENV SYNC] All collections in sync (or differences <20%)`);
        }

        return results;
    }

    /**
     * Get current environment info
     * @returns {Object} - Environment details
     */
    getEnvironmentInfo() {
        return {
            environment: process.env.NODE_ENV || 'development',
            isLocal: this.isLocal,
            databaseUrl: process.env.MONGODB_URI?.split('@')[1] || 'unknown', // Hide credentials
            productionUrl: this.productionUrl,
            localUrl: this.localUrl
        };
    }
}

module.exports = new EnvironmentMismatchDetector();


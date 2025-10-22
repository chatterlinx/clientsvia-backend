/**
 * ============================================================================
 * DATA CENTER PURGE SERVICE
 * ============================================================================
 * Handles safe, complete deletion of company data
 * Removes data from MongoDB, Redis, and external services
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger.js');

const Company = require('../models/v2Company');
const DataCenterAuditLog = require('../models/DataCenterAuditLog');
const { redisClient } = require('../db');

class DataCenterPurgeService {
    /**
     * Hard purge a company (irreversible)
     * @param {string} companyId - Company ID to purge
     * @param {Object} user - User performing the purge
     * @param {Object} options - Purge options
     * @returns {Object} Purge result with counts
     */
    static async hardPurge(companyId, user, options = {}) {
        logger.debug('[PURGE SERVICE] Starting hard purge for company:', companyId);
        
        const result = {
            success: false,
            companyId,
            documentsDeleted: 0,
            collectionsAffected: [],
            errors: []
        };

        try {
            // 1. Verify company exists and is soft-deleted
            const company = await Company.findById(companyId).option({ includeDeleted: true });
            if (!company) {
                throw new Error('Company not found');
            }

            if (!company.isDeleted) {
                throw new Error('Company must be soft-deleted before hard purge');
            }

            const companyName = company.companyName || company.businessName;

            // 2. Delete call logs
            logger.info('[PURGE SERVICE] Deleting call logs...');
            try {
                const callsResult = await mongoose.connection.db.collection('v2aiagentcalllogs')
                    .deleteMany({ companyId: company._id });
                result.documentsDeleted += callsResult.deletedCount;
                result.collectionsAffected.push('v2aiagentcalllogs');
                logger.info(`[PURGE SERVICE] Deleted ${callsResult.deletedCount} call logs`);
            } catch (error) {
                result.errors.push(`Call logs: ${error.message}`);
            }

            // 3. Delete contacts
            logger.info('[PURGE SERVICE] Deleting contacts...');
            try {
                const contactsResult = await mongoose.connection.db.collection('v2contacts')
                    .deleteMany({ companyId: company._id });
                result.documentsDeleted += contactsResult.deletedCount;
                result.collectionsAffected.push('v2contacts');
                logger.info(`[PURGE SERVICE] Deleted ${contactsResult.deletedCount} contacts`);
            } catch (error) {
                result.errors.push(`Contacts: ${error.message}`);
            }

            // 4. Delete notification logs
            logger.info('[PURGE SERVICE] Deleting notification logs...');
            try {
                const notificationsResult = await mongoose.connection.db.collection('v2notificationlogs')
                    .deleteMany({ companyId: company._id });
                result.documentsDeleted += notificationsResult.deletedCount;
                result.collectionsAffected.push('v2notificationlogs');
                logger.info(`[PURGE SERVICE] Deleted ${notificationsResult.deletedCount} notifications`);
            } catch (error) {
                result.errors.push(`Notifications: ${error.message}`);
            }

            // 5. Clear Redis cache
            logger.debug('[PURGE SERVICE] Clearing Redis cache...');
            try {
                await redisClient.del(`company:${companyId}`);
                await redisClient.del(`datacenter:inventory:${companyId}`);
                logger.debug('[PURGE SERVICE] Redis cache cleared');
            } catch (error) {
                result.errors.push(`Redis: ${error.message}`);
            }

            // 6. Delete the company document (LAST STEP)
            logger.info('[PURGE SERVICE] Deleting company document...');
            await Company.findByIdAndDelete(companyId).option({ includeDeleted: true });
            result.documentsDeleted += 1;
            result.collectionsAffected.push('companiesCollection');
            logger.info('[PURGE SERVICE] Company document deleted');

            result.success = true;

            // 7. Create audit log
            await DataCenterAuditLog.create({
                action: 'HARD_PURGE',
                targetType: 'COMPANY',
                targetId: companyId,
                targetName: companyName,
                userId: user._id || user.id,
                userEmail: user.email,
                metadata: {
                    reason: options.reason || 'Auto-purge after grace period',
                    ...options.metadata
                },
                success: true,
                impact: {
                    documentsDeleted: result.documentsDeleted,
                    collectionsAffected: result.collectionsAffected,
                    estimatedBytes: 0
                }
            });

            logger.info('[PURGE SERVICE] ✅ Hard purge complete:', companyId);

            return result;

        } catch (error) {
            logger.error('[PURGE SERVICE] ❌ Hard purge failed:', error);
            result.errors.push(error.message);

            // Log failure
            try {
                await DataCenterAuditLog.create({
                    action: 'HARD_PURGE',
                    targetType: 'COMPANY',
                    targetId: companyId,
                    userId: user._id || user.id,
                    userEmail: user.email,
                    success: false,
                    errorMessage: error.message
                });
            } catch (logError) {
                logger.error('[PURGE SERVICE] Failed to log error:', logError);
            }

            throw error;
        }
    }

    /**
     * Partial cleanup - delete specific collections
     * @param {string} companyId - Company ID
     * @param {Array} collections - Collections to clean
     * @param {Object} user - User performing cleanup
     * @returns {Object} Cleanup result
     */
    static async partialCleanup(companyId, collections, user) {
        logger.debug('[PURGE SERVICE] Starting partial cleanup:', companyId, collections);

        const result = {
            success: false,
            documentsDeleted: 0,
            collectionsAffected: []
        };

        const company = await Company.findById(companyId).option({ includeDeleted: true });
        if (!company) {
            throw new Error('Company not found');
        }

        const companyObjId = new mongoose.Types.ObjectId(companyId);

        for (const collection of collections) {
            try {
                let deleteResult;

                switch (collection) {
                    case 'calls':
                        deleteResult = await mongoose.connection.db.collection('v2aiagentcalllogs')
                            .deleteMany({ companyId: companyObjId });
                        break;
                    case 'contacts':
                        deleteResult = await mongoose.connection.db.collection('v2contacts')
                            .deleteMany({ companyId: companyObjId });
                        break;
                    case 'notifications':
                        deleteResult = await mongoose.connection.db.collection('v2notificationlogs')
                            .deleteMany({ companyId: companyObjId });
                        break;
                    default:
                        logger.warn(`[PURGE SERVICE] Unknown collection: ${collection}`);
                        continue;
                }

                result.documentsDeleted += deleteResult.deletedCount;
                result.collectionsAffected.push(collection);
                logger.info(`[PURGE SERVICE] Deleted ${deleteResult.deletedCount} from ${collection}`);

            } catch (error) {
                logger.error(`[PURGE SERVICE] Error cleaning ${collection}:`, error);
            }
        }

        // Clear cache
        try {
            await redisClient.del(`company:${companyId}`);
            await redisClient.del(`datacenter:inventory:${companyId}`);
        } catch (error) {
            logger.error('[PURGE SERVICE] Cache clear failed:', error);
        }

        // Create audit log
        await DataCenterAuditLog.create({
            action: 'PARTIAL_CLEANUP',
            targetType: 'COMPANY',
            targetId: companyId,
            targetName: company.companyName || company.businessName,
            userId: user._id || user.id,
            userEmail: user.email,
            metadata: {
                collections
            },
            success: true,
            impact: {
                documentsDeleted: result.documentsDeleted,
                collectionsAffected: result.collectionsAffected,
                estimatedBytes: 0
            }
        });

        result.success = true;
        return result;
    }
}

module.exports = DataCenterPurgeService;


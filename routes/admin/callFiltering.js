// ============================================================================
// CALL FILTERING ADMIN ROUTES
// ============================================================================
// 📋 PURPOSE: Admin API for managing spam detection and call filtering
// 🎯 FEATURES:
//    - View blocked calls
//    - Manage company blacklist/whitelist
//    - Report spam to global database
//    - View spam statistics
//    - Configure filtering settings
// 🔒 AUTH: Admin only
// ============================================================================

const express = require('express');
const router = express.Router();
const SmartCallFilter = require('../../services/SmartCallFilter');
const BlockedCallLog = require('../../models/BlockedCallLog');
const GlobalSpamDatabase = require('../../models/GlobalSpamDatabase');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// ============================================================================
// GET BLOCKED CALLS (for a company)
// ============================================================================
router.get('/admin/call-filtering/:companyId/blocked-calls', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { limit = 100 } = req.query;

        console.log(`🚫 [CALL FILTERING] Fetching blocked calls for company: ${companyId}`);

        const blockedCalls = await BlockedCallLog.getBlockedCallsForCompany(companyId, parseInt(limit));

        res.json({
            success: true,
            data: blockedCalls,
            count: blockedCalls.length
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch blocked calls',
            error: error.message
        });
    }
});

// ============================================================================
// GET SPAM STATISTICS (company or global)
// ============================================================================
router.get('/admin/call-filtering/stats', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.query;

        console.log(`📊 [CALL FILTERING] Fetching spam stats${companyId ? ` for company: ${companyId}` : ' (global)'}`);

        const stats = await SmartCallFilter.getSpamStats(companyId || null);

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch spam statistics',
            error: error.message
        });
    }
});

// ============================================================================
// REPORT SPAM NUMBER (add to global database)
// ============================================================================
router.post('/admin/call-filtering/report-spam', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { phoneNumber, spamType, companyId } = req.body;

        console.log(`📝 [CALL FILTERING] Reporting spam: ${phoneNumber}`);

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        const result = await SmartCallFilter.reportSpam(phoneNumber, companyId, spamType);

        res.json(result);

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to report spam',
            error: error.message
        });
    }
});

// ============================================================================
// WHITELIST NUMBER (remove from spam)
// ============================================================================
router.post('/admin/call-filtering/whitelist', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { phoneNumber, reason } = req.body;

        console.log(`✅ [CALL FILTERING] Whitelisting: ${phoneNumber}`);

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        const result = await SmartCallFilter.whitelistNumber(phoneNumber, reason);

        res.json(result);

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to whitelist number',
            error: error.message
        });
    }
});

// ============================================================================
// ADD TO COMPANY BLACKLIST
// ============================================================================
router.post('/admin/call-filtering/:companyId/blacklist', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber, reason } = req.body;

        console.log(`🚫 [CALL FILTERING] Adding ${phoneNumber} to company ${companyId} blacklist`);

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize callFiltering if not exists
        if (!company.callFiltering) {
            company.callFiltering = {
                enabled: true,
                blacklist: [],
                whitelist: [],
                settings: {},
                stats: {}
            };
        }

        // Check if already blacklisted
        const existing = company.callFiltering.blacklist.find(entry => 
            entry.phoneNumber === phoneNumber && entry.status === 'active'
        );

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Number already in blacklist'
            });
        }

        // Add to blacklist
        company.callFiltering.blacklist.push({
            phoneNumber,
            reason: reason || 'Manually blacklisted',
            addedAt: new Date(),
            addedBy: req.user.email || 'admin',
            status: 'active'
        });

        await company.save();

        // ✅ FIX #3: Clear Redis cache
        const { redisClient } = require('../../clients');
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`✅ [CALL FILTERING] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`⚠️ [CALL FILTERING] Failed to clear cache:`, cacheError);
        }

        res.json({
            success: true,
            message: 'Number added to blacklist'
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add to blacklist',
            error: error.message
        });
    }
});

// ============================================================================
// REMOVE FROM COMPANY BLACKLIST
// ============================================================================
router.delete('/admin/call-filtering/:companyId/blacklist/:phoneNumber', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId, phoneNumber } = req.params;

        console.log(`✅ [CALL FILTERING] Removing ${phoneNumber} from company ${companyId} blacklist`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        if (!company.callFiltering || !company.callFiltering.blacklist) {
            return res.status(404).json({
                success: false,
                message: 'No blacklist found'
            });
        }

        // Find and mark as removed
        const entry = company.callFiltering.blacklist.find(entry => 
            entry.phoneNumber === decodeURIComponent(phoneNumber) && entry.status === 'active'
        );

        if (!entry) {
            return res.status(404).json({
                success: false,
                message: 'Number not found in blacklist'
            });
        }

        entry.status = 'removed';
        await company.save();

        // ✅ FIX #3: Clear Redis cache
        const { redisClient } = require('../../clients');
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`✅ [CALL FILTERING] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`⚠️ [CALL FILTERING] Failed to clear cache:`, cacheError);
        }

        res.json({
            success: true,
            message: 'Number removed from blacklist'
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove from blacklist',
            error: error.message
        });
    }
});

// ============================================================================
// ADD TO COMPANY WHITELIST
// ============================================================================
router.post('/admin/call-filtering/whitelist/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber, reason } = req.body;

        console.log(`✅ [CALL FILTERING] Adding ${phoneNumber} to company ${companyId} whitelist`);

        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize callFiltering if not exists
        if (!company.callFiltering) {
            company.callFiltering = {
                enabled: true,
                blacklist: [],
                whitelist: [],
                settings: {},
                stats: {}
            };
        }

        // Check if already whitelisted
        const existing = company.callFiltering.whitelist.find(entry => 
            entry.phoneNumber === phoneNumber && entry.status === 'active'
        );

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Number already in whitelist'
            });
        }

        // Add to whitelist
        company.callFiltering.whitelist.push({
            phoneNumber,
            reason: reason || 'Manually whitelisted',
            addedAt: new Date(),
            addedBy: req.user.email || 'admin',
            status: 'active'
        });

        await company.save();

        // ✅ FIX #3: Clear Redis cache
        const { redisClient } = require('../../clients');
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`✅ [CALL FILTERING] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`⚠️ [CALL FILTERING] Failed to clear cache:`, cacheError);
        }

        res.json({
            success: true,
            message: 'Number added to whitelist'
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add to whitelist',
            error: error.message
        });
    }
});

// ============================================================================
// REMOVE FROM COMPANY WHITELIST
// ============================================================================
router.delete('/admin/call-filtering/whitelist/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber } = req.body;

        console.log(`❌ [CALL FILTERING] Removing ${phoneNumber} from company ${companyId} whitelist`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        if (!company.callFiltering || !company.callFiltering.whitelist) {
            return res.status(404).json({
                success: false,
                message: 'No whitelist found'
            });
        }

        // Find and mark as removed
        const entry = company.callFiltering.whitelist.find(entry => 
            entry.phoneNumber === phoneNumber && entry.status === 'active'
        );

        if (!entry) {
            return res.status(404).json({
                success: false,
                message: 'Number not found in whitelist'
            });
        }

        entry.status = 'removed';
        await company.save();

        // ✅ FIX #3: Clear Redis cache
        const { redisClient } = require('../../clients');
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`✅ [CALL FILTERING] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`⚠️ [CALL FILTERING] Failed to clear cache:`, cacheError);
        }

        res.json({
            success: true,
            message: 'Number removed from whitelist'
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove from whitelist',
            error: error.message
        });
    }
});

// ============================================================================
// GET COMPANY FILTERING SETTINGS
// ============================================================================
router.get('/admin/call-filtering/:companyId/settings', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;

        console.log(`⚙️ [CALL FILTERING] Fetching settings for company: ${companyId}`);

        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // 🔍 DEBUG: Log what's in the database
        console.log(`🔍 [CALL FILTERING] Raw callFiltering from DB:`, {
            exists: !!company.callFiltering,
            enabled: company.callFiltering?.enabled,
            settings: company.callFiltering?.settings,
            settingsKeys: company.callFiltering?.settings ? Object.keys(company.callFiltering.settings) : []
        });

        // ✅ FIX #2: Transform blacklist/whitelist to string arrays for frontend
        const callFiltering = company.callFiltering || {
            enabled: true,
            blacklist: [],
            whitelist: [],
            settings: {},
            stats: {}
        };

        // 🔧 MIGRATION: Handle old setting names → new setting names
        const oldSettings = callFiltering.settings || {};
        
        // Priority: NEW schema names ALWAYS win if they exist (even if false/undefined from user save)
        // Only use old schema names if NEW names have NEVER been saved
        const hasNewSchema = 'checkGlobalSpamDB' in oldSettings || 
                            'enableFrequencyCheck' in oldSettings || 
                            'enableRobocallDetection' in oldSettings;
        
        const migratedSettings = hasNewSchema ? {
            // NEW SCHEMA: Use exactly what's saved (including undefined/false)
            checkGlobalSpamDB: oldSettings.checkGlobalSpamDB,
            enableFrequencyCheck: oldSettings.enableFrequencyCheck,
            enableRobocallDetection: oldSettings.enableRobocallDetection
        } : {
            // OLD SCHEMA: Migrate from old names
            checkGlobalSpamDB: oldSettings.blockKnownSpam,
            enableFrequencyCheck: oldSettings.blockHighFrequency,
            enableRobocallDetection: oldSettings.blockRobocalls
        };

        console.log(`🔧 [CALL FILTERING] Schema detected: ${hasNewSchema ? 'NEW' : 'OLD'}`);
        console.log(`🔧 [CALL FILTERING] Migrated settings:`, migratedSettings);

        const transformedData = {
            enabled: callFiltering.enabled,
            blacklist: Array.isArray(callFiltering.blacklist)
                ? callFiltering.blacklist
                    .filter(entry => typeof entry === 'object' ? entry.status === 'active' : true)
                    .map(entry => typeof entry === 'object' ? entry.phoneNumber : entry)
                : [],
            whitelist: Array.isArray(callFiltering.whitelist)
                ? callFiltering.whitelist
                    .filter(entry => typeof entry === 'object' ? entry.status === 'active' : true)
                    .map(entry => typeof entry === 'object' ? entry.phoneNumber : entry)
                : [],
            settings: migratedSettings,
            stats: callFiltering.stats || {}
        };

        console.log(`✅ [CALL FILTERING] Sending to frontend:`, {
            enabled: transformedData.enabled,
            settings: transformedData.settings
        });

        res.json({
            success: true,
            data: transformedData
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch settings',
            error: error.message
        });
    }
});

// ============================================================================
// UPDATE COMPANY FILTERING SETTINGS
// ============================================================================
// Helper function to handle settings update (used by both PATCH and PUT)
async function updateFilteringSettings(req, res) {
    try {
        const { companyId } = req.params;
        const { enabled, settings } = req.body;

        console.log(`⚙️ [CALL FILTERING] Updating settings for company: ${companyId}`);

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize callFiltering if not exists
        if (!company.callFiltering) {
            company.callFiltering = {
                enabled: true,
                blacklist: [],
                whitelist: [],
                settings: {},
                stats: {}
            };
        }

        // Update enabled state if provided
        if (enabled !== undefined) {
            company.callFiltering.enabled = enabled;
        }

        // Update settings if provided
        if (settings) {
            company.callFiltering.settings = {
                ...company.callFiltering.settings,
                ...settings
            };
        }

        await company.save();

        // ✅ FIX #3: Clear Redis cache
        const { redisClient } = require('../../clients');
        try {
            await redisClient.del(`company:${companyId}`);
            console.log(`✅ [CALL FILTERING] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            console.warn(`⚠️ [CALL FILTERING] Failed to clear cache:`, cacheError);
        }

        res.json({
            success: true,
            message: 'Settings updated successfully',
            data: company.callFiltering
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to update settings',
            error: error.message
        });
    }
}

// PATCH route (original)
router.patch('/admin/call-filtering/:companyId/settings', authenticateJWT, requireRole('admin'), updateFilteringSettings);

// ✅ FIX #1: Add PUT route for frontend compatibility
router.put('/admin/call-filtering/:companyId/settings', authenticateJWT, requireRole('admin'), updateFilteringSettings);

// ============================================================================
// GET GLOBAL SPAM DATABASE (top spammers)
// ============================================================================
router.get('/admin/call-filtering/global-spam-database', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { limit = 100 } = req.query;

        console.log(`🌍 [CALL FILTERING] Fetching global spam database (limit: ${limit})`);

        const spamNumbers = await GlobalSpamDatabase.getTopSpamNumbers(parseInt(limit));

        res.json({
            success: true,
            data: spamNumbers,
            count: spamNumbers.length
        });

    } catch (error) {
        console.error(`❌ [CALL FILTERING] ERROR:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch global spam database',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORT
// ============================================================================
module.exports = router;


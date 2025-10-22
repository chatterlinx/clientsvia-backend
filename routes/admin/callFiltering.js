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
// Purpose: Retrieve spam filter settings for a company
// 
// ⚠️ SCHEMA MIGRATION LAYER (October 2025)
// This endpoint handles both OLD and NEW schema formats:
// - OLD: blockKnownSpam, blockHighFrequency, blockRobocalls (deprecated)
// - NEW: checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection (active)
// 
// Migration Logic:
// 1. If NEW schema keys exist → Use them (even if false/undefined)
// 2. If only OLD schema keys exist → Migrate to NEW schema names
// 3. Frontend receives ONLY new schema keys
// 
// Note: This migration layer will be removed in Q2 2026 once all companies
// have been migrated to the new schema.
// 
// Related Files:
// - Model: models/v2Company.js (lines 1707-1777)
// - Frontend: public/js/ai-agent-settings/SpamFilterManager.js
// - Tests: scripts/verify-spam-filter-schema.js
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
            exists: Boolean(company.callFiltering),
            enabled: company.callFiltering?.enabled,
            settings: company.callFiltering?.settings,
            settingsKeys: company.callFiltering?.settings ? Object.keys(company.callFiltering.settings) : []
        });
        console.log(`🔍 [CALL FILTERING] Full settings object from MongoDB:`, JSON.stringify(company.callFiltering?.settings, null, 2));

        // ✅ FIX #2: Transform blacklist/whitelist to string arrays for frontend
        const callFiltering = company.callFiltering || {
            enabled: true,
            blacklist: [],
            whitelist: [],
            settings: {},
            stats: {}
        };

        // ========================================================================
        // 🔧 SCHEMA MIGRATION LAYER - OLD → NEW
        // ========================================================================
        // ⚠️ DEPRECATED: This migration logic will be removed in Q2 2026
        // 
        // Why this exists:
        // - Pre-Oct 2025: settings used blockKnownSpam, blockHighFrequency, blockRobocalls
        // - Post-Oct 2025: settings use checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection
        // - This ensures backward compatibility during transition
        // 
        // Future Engineer Note:
        // Once all companies have new schema (verify with DB query), you can:
        // 1. Remove this migration block (lines 472-486)
        // 2. Remove old schema keys from Mongoose model (models/v2Company.js:1758-1760)
        // 3. Update this to just: const migratedSettings = callFiltering.settings || {};
        // ========================================================================
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
            // OLD SCHEMA: Migrate from old names on-the-fly
            checkGlobalSpamDB: oldSettings.blockKnownSpam,
            enableFrequencyCheck: oldSettings.blockHighFrequency,
            enableRobocallDetection: oldSettings.blockRobocalls
        };

        console.log(`🔧 [CALL FILTERING] Schema detected: ${hasNewSchema ? 'NEW' : 'OLD'}`);
        if (!hasNewSchema) {
            console.log(`⚠️ [CALL FILTERING] Company ${companyId} still using OLD schema - will be migrated on next save`);
        }
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
// UPDATE COMPANY FILTERING SETTINGS (PUT/PATCH)
// ============================================================================
// Purpose: Save spam filter settings for a company
// 
// ⚠️ CRITICAL SAVE LOGIC - Read carefully before modifying!
// 
// This function REPLACES the entire settings object (not merge) to ensure:
// 1. Old schema keys (blockKnownSpam, etc) are purged on save
// 2. Only NEW schema keys are saved (checkGlobalSpamDB, etc)
// 3. Values are explicitly cast to boolean (prevents undefined from being saved)
// 
// Why REPLACE and not MERGE?
// - Merging would keep old keys forever
// - Old + New keys coexisting caused Mongoose validation confusion
// - Replace ensures clean state after migration
// 
// Frontend Contract:
// - Frontend sends: { checkGlobalSpamDB, enableFrequencyCheck, enableRobocallDetection }
// - Backend saves: ONLY these 3 keys (as booleans)
// - GET endpoint returns: Same 3 keys (migrated from old if needed)
// 
// Related Files:
// - Model: models/v2Company.js (lines 1707-1777)
// - GET endpoint: This file (lines 452-559)
// - Frontend: public/js/ai-agent-settings/SpamFilterManager.js
// 
// Future Engineer Warning:
// If you add a new spam filter setting:
// 1. Add it to Mongoose schema (models/v2Company.js)
// 2. Add it to this REPLACE block (line 603-608)
// 3. Add it to GET migration logic (line 507-517)
// 4. Update frontend to send/receive it
// 5. Run: node scripts/verify-spam-filter-schema.js
// ============================================================================
// Helper function to handle settings update (used by both PATCH and PUT routes)
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

        // ========================================================================
        // 🔥 CRITICAL SAVE LOGIC - REPLACE (not merge!)
        // ========================================================================
        // Update settings if provided
        if (settings) {
            console.log(`📝 [CALL FILTERING] Incoming settings:`, settings);
            
            // ⚠️ IMPORTANT: We REPLACE the entire settings object
            // This purges old schema keys (blockKnownSpam, etc) on save
            // Do NOT use Object.assign() or spread operator - would merge old keys
            company.callFiltering.settings = {
                // Only save the new schema keys (with explicit true/false cast)
                // The "=== true" cast prevents undefined from being saved
                checkGlobalSpamDB: settings.checkGlobalSpamDB === true,
                enableFrequencyCheck: settings.enableFrequencyCheck === true,
                enableRobocallDetection: settings.enableRobocallDetection === true
            };
            
            // 🔥 CRITICAL: Mark the nested path as modified so Mongoose detects the change
            // Without this, Mongoose may not save changes to nested objects
            company.markModified('callFiltering.settings');
            
            console.log(`✅ [CALL FILTERING] Settings replaced (old schema purged):`, company.callFiltering.settings);
            console.log(`🔍 [CALL FILTERING] Mongoose detected as modified:`, company.isModified('callFiltering.settings'));
        }

        console.log(`💾 [CALL FILTERING] About to save to MongoDB...`);
        await company.save();
        console.log(`✅ [CALL FILTERING] Successfully saved to MongoDB!`);

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


/**
 * ============================================================================
 * 🌐 GLOBAL HUB - CROSS-TENANT SHARED RESOURCES API
 * ============================================================================
 * 
 * PURPOSE:
 * Manages global resources shared across ALL tenants (companies).
 * These are platform-wide dictionaries and settings that don't belong
 * to any specific company but are universally useful.
 * 
 * ARCHITECTURE:
 * - GLOBAL ONLY: No companyId accepted or stored
 * - SINGLETON: Stored in AdminSettings document (globalHub namespace)
 * - ADMIN ONLY: Requires authenticated admin access
 * 
 * CURRENT FEATURES:
 * - First Names Dictionary: Common first names for validation/matching
 * 
 * FUTURE CANDIDATES:
 * - Last Names Dictionary
 * - Common Titles
 * - Country/Region Codes
 * - Industry-specific terms
 * 
 * ENDPOINTS:
 * - GET  /api/admin/global-hub/first-names     → Get first names list
 * - POST /api/admin/global-hub/first-names     → Update first names list
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const AdminSettings = require('../../models/AdminSettings');
const { authenticateJWT } = require('../../middleware/auth');
const GlobalHubService = require('../../services/GlobalHubService');

// ============================================================================
// CONSTANTS & VALIDATION
// ============================================================================

const VALIDATION = {
    MAX_NAME_LENGTH: 50,
    MAX_NAMES_COUNT: 50000,
    MIN_NAME_LENGTH: 1
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize a name to Title Case
 * "john" → "John", "MARY" → "Mary", "josé" → "José"
 */
function toTitleCase(name) {
    if (!name || typeof name !== 'string') return '';
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/**
 * Process and normalize first names input
 * - Trim whitespace
 * - Remove empty lines
 * - Dedupe (case-insensitive)
 * - Normalize to Title Case
 * - Sort alphabetically
 */
function normalizeFirstNames(namesArray) {
    if (!Array.isArray(namesArray)) return [];
    
    const seen = new Set();
    const normalized = [];
    
    for (const name of namesArray) {
        if (typeof name !== 'string') continue;
        
        const trimmed = name.trim();
        if (!trimmed) continue;
        if (trimmed.length < VALIDATION.MIN_NAME_LENGTH) continue;
        if (trimmed.length > VALIDATION.MAX_NAME_LENGTH) continue;
        
        const titleCase = toTitleCase(trimmed);
        const lowerKey = titleCase.toLowerCase();
        
        if (!seen.has(lowerKey)) {
            seen.add(lowerKey);
            normalized.push(titleCase);
        }
    }
    
    return normalized.sort((a, b) => a.localeCompare(b));
}

/**
 * Validate first names array
 * Returns { valid: boolean, error?: string }
 */
function validateFirstNames(namesArray) {
    if (!Array.isArray(namesArray)) {
        return { valid: false, error: 'firstNames must be an array' };
    }
    
    if (namesArray.length > VALIDATION.MAX_NAMES_COUNT) {
        return { 
            valid: false, 
            error: `Maximum ${VALIDATION.MAX_NAMES_COUNT.toLocaleString()} names allowed` 
        };
    }
    
    for (let i = 0; i < namesArray.length; i++) {
        const name = namesArray[i];
        if (typeof name !== 'string') {
            return { valid: false, error: `Item at index ${i} is not a string` };
        }
        if (name.length > VALIDATION.MAX_NAME_LENGTH) {
            return { 
                valid: false, 
                error: `Name at index ${i} exceeds ${VALIDATION.MAX_NAME_LENGTH} characters` 
            };
        }
    }
    
    return { valid: true };
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/global-hub/first-names
 * 
 * Returns the global first names dictionary.
 * This is a GLOBAL resource - no companyId needed or accepted.
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     firstNames: string[],
 *     count: number,
 *     lastUpdated: ISO date string
 *   }
 * }
 */
router.get('/first-names', authenticateJWT, async (req, res) => {
    const requestId = `GH-FN-GET-${Date.now()}`;
    
    try {
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Fetching first names dictionary`);
        
        const settings = await AdminSettings.getSettings();
        
        const firstNames = settings?.globalHub?.dictionaries?.firstNames || [];
        const lastUpdated = settings?.globalHub?.dictionaries?.firstNamesUpdatedAt || null;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Returning ${firstNames.length} first names`);
        
        return res.json({
            success: true,
            data: {
                firstNames,
                count: firstNames.length,
                lastUpdated
            }
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error fetching first names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch first names dictionary',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/global-hub/first-names
 * 
 * Updates the global first names dictionary.
 * This is a GLOBAL resource - no companyId accepted.
 * 
 * Request Body:
 * {
 *   firstNames: string[]  // Array of names (will be normalized)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     firstNames: string[],
 *     count: number,
 *     lastUpdated: ISO date string,
 *     stats: {
 *       inputCount: number,
 *       outputCount: number,
 *       duplicatesRemoved: number
 *     }
 *   }
 * }
 */
router.post('/first-names', authenticateJWT, async (req, res) => {
    const requestId = `GH-FN-POST-${Date.now()}`;
    
    try {
        const { firstNames } = req.body;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Updating first names dictionary`);
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Input count: ${Array.isArray(firstNames) ? firstNames.length : 'invalid'}`);
        
        // Validate input
        const validation = validateFirstNames(firstNames);
        if (!validation.valid) {
            logger.warn(`🌐 [GLOBAL HUB] ${requestId} - Validation failed: ${validation.error}`);
            return res.status(400).json({
                success: false,
                error: validation.error
            });
        }
        
        // Normalize names
        const inputCount = firstNames.length;
        const normalizedNames = normalizeFirstNames(firstNames);
        const outputCount = normalizedNames.length;
        const duplicatesRemoved = inputCount - outputCount;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Normalized: ${inputCount} → ${outputCount} (${duplicatesRemoved} duplicates removed)`);
        
        // Get current settings
        const settings = await AdminSettings.getSettings();
        
        // Initialize globalHub structure if needed
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Update first names
        const now = new Date();
        settings.globalHub.dictionaries.firstNames = normalizedNames;
        settings.globalHub.dictionaries.firstNamesUpdatedAt = now;
        settings.globalHub.dictionaries.firstNamesUpdatedBy = req.user?.email || req.user?.userId || 'admin';
        
        // Mark as modified (Mongoose mixed type)
        settings.markModified('globalHub');
        
        // Save
        await settings.save();
        
        // Sync to Redis for fast runtime lookups
        await GlobalHubService.syncFirstNamesToRedis(normalizedNames);
        
        // Invalidate BookingLogicEngine cache
        try {
            const BookingLogicEngine = require('../../services/engine/booking/BookingLogicEngine');
            BookingLogicEngine.invalidateCache();
            logger.info(`🔄 [GLOBAL HUB] ${requestId} - BookingLogicEngine cache invalidated`);
        } catch (cacheErr) {
            logger.warn(`⚠️ [GLOBAL HUB] ${requestId} - Failed to invalidate BookingLogicEngine cache:`, cacheErr.message);
        }
        
        logger.info(`✅ [GLOBAL HUB] ${requestId} - First names dictionary updated successfully`);
        
        return res.json({
            success: true,
            data: {
                firstNames: normalizedNames,
                count: normalizedNames.length,
                lastUpdated: now.toISOString(),
                stats: {
                    inputCount,
                    outputCount,
                    duplicatesRemoved
                }
            },
            message: `Successfully saved ${outputCount.toLocaleString()} first names`
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error updating first names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update first names dictionary',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/global-hub/last-names
 * 
 * Returns the global last names (surnames) dictionary.
 * This is a GLOBAL resource - no companyId needed or accepted.
 */
router.get('/last-names', authenticateJWT, async (req, res) => {
    const requestId = `GH-LN-GET-${Date.now()}`;
    
    try {
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Fetching last names dictionary`);
        
        const settings = await AdminSettings.getSettings();
        
        const lastNames = settings?.globalHub?.dictionaries?.lastNames || [];
        const lastUpdated = settings?.globalHub?.dictionaries?.lastNamesUpdatedAt || null;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Returning ${lastNames.length} last names`);
        
        return res.json({
            success: true,
            data: {
                lastNames,
                count: lastNames.length,
                lastUpdated
            }
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error fetching last names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch last names dictionary',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/global-hub/last-names
 * 
 * Updates the global last names (surnames) dictionary.
 * This is a GLOBAL resource - no companyId accepted.
 */
router.post('/last-names', authenticateJWT, async (req, res) => {
    const requestId = `GH-LN-POST-${Date.now()}`;
    
    try {
        const { lastNames } = req.body;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Updating last names dictionary`);
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Input count: ${Array.isArray(lastNames) ? lastNames.length : 'invalid'}`);
        
        // Validate input (reuse validation with adjusted field name)
        if (!Array.isArray(lastNames)) {
            return res.status(400).json({
                success: false,
                error: 'lastNames must be an array'
            });
        }
        
        if (lastNames.length > 200000) { // Allow more for Census data
            return res.status(400).json({
                success: false,
                error: 'Maximum 200,000 names allowed'
            });
        }
        
        // Normalize names (reuse same logic)
        const inputCount = lastNames.length;
        const normalizedNames = normalizeFirstNames(lastNames); // Same normalization
        const outputCount = normalizedNames.length;
        const duplicatesRemoved = inputCount - outputCount;
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Normalized: ${inputCount} → ${outputCount} (${duplicatesRemoved} duplicates removed)`);
        
        // Get current settings
        const settings = await AdminSettings.getSettings();
        
        // Initialize globalHub structure if needed
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Update last names
        const now = new Date();
        settings.globalHub.dictionaries.lastNames = normalizedNames;
        settings.globalHub.dictionaries.lastNamesUpdatedAt = now;
        settings.globalHub.dictionaries.lastNamesUpdatedBy = req.user?.email || req.user?.userId || 'admin';
        
        // Mark as modified (Mongoose mixed type)
        settings.markModified('globalHub');
        
        // Save
        await settings.save();
        
        // Sync to Redis for fast runtime lookups
        await GlobalHubService.syncLastNamesToRedis(normalizedNames);
        
        // Invalidate BookingLogicEngine cache
        try {
            const BookingLogicEngine = require('../../services/engine/booking/BookingLogicEngine');
            BookingLogicEngine.invalidateCache();
            logger.info(`🔄 [GLOBAL HUB] ${requestId} - BookingLogicEngine cache invalidated`);
        } catch (cacheErr) {
            logger.warn(`⚠️ [GLOBAL HUB] ${requestId} - Failed to invalidate BookingLogicEngine cache:`, cacheErr.message);
        }
        
        logger.info(`✅ [GLOBAL HUB] ${requestId} - Last names dictionary updated successfully`);
        
        return res.json({
            success: true,
            data: {
                lastNames: normalizedNames,
                count: normalizedNames.length,
                lastUpdated: now.toISOString(),
                stats: {
                    inputCount,
                    outputCount,
                    duplicatesRemoved
                }
            },
            message: `Successfully saved ${outputCount.toLocaleString()} last names`
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error updating last names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update last names dictionary',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/global-hub/last-names/seed
 * 
 * Seeds the last names dictionary with US Census surnames (~162K names).
 */
router.post('/last-names/seed', authenticateJWT, async (req, res) => {
    const requestId = `GH-LN-SEED-${Date.now()}`;
    
    try {
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Seeding last names dictionary`);
        
        // Load the seed data
        const { LAST_NAMES_SEED } = require('../../data/lastNamesSeed');
        
        if (!LAST_NAMES_SEED || !Array.isArray(LAST_NAMES_SEED)) {
            return res.status(500).json({
                success: false,
                error: 'Seed data not available'
            });
        }
        
        // Normalize names
        const normalizedNames = normalizeFirstNames(LAST_NAMES_SEED);
        
        // Get current settings
        const settings = await AdminSettings.getSettings();
        
        // Initialize globalHub structure if needed
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Update last names
        const now = new Date();
        settings.globalHub.dictionaries.lastNames = normalizedNames;
        settings.globalHub.dictionaries.lastNamesUpdatedAt = now;
        settings.globalHub.dictionaries.lastNamesUpdatedBy = 'seed-endpoint';
        
        // Mark as modified and save
        settings.markModified('globalHub');
        await settings.save();
        
        // Sync to Redis
        await GlobalHubService.syncLastNamesToRedis(normalizedNames);
        
        logger.info(`✅ [GLOBAL HUB] ${requestId} - Seeded ${normalizedNames.length.toLocaleString()} last names`);
        
        return res.json({
            success: true,
            data: {
                count: normalizedNames.length,
                lastUpdated: now.toISOString(),
                source: 'us-census-2010'
            },
            message: `Successfully seeded ${normalizedNames.length.toLocaleString()} last names (US Census 2010)`
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error seeding last names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to seed last names dictionary',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/global-hub/status
 * 
 * Returns overview status of all Global Hub resources.
 * Useful for the main Global Hub dashboard.
 */
router.get('/status', authenticateJWT, async (req, res) => {
    const requestId = `GH-STATUS-${Date.now()}`;
    
    try {
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Fetching Global Hub status`);
        
        const settings = await AdminSettings.getSettings();
        const dictionaries = settings?.globalHub?.dictionaries || {};
        
        const status = {
            dictionaries: {
                firstNames: {
                    count: dictionaries.firstNames?.length || 0,
                    lastUpdated: dictionaries.firstNamesUpdatedAt || null,
                    updatedBy: dictionaries.firstNamesUpdatedBy || null
                },
                lastNames: {
                    count: dictionaries.lastNames?.length || 0,
                    lastUpdated: dictionaries.lastNamesUpdatedAt || null,
                    updatedBy: dictionaries.lastNamesUpdatedBy || null
                }
            }
        };
        
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Status retrieved successfully`);
        
        return res.json({
            success: true,
            data: status
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error fetching status:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch Global Hub status',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/global-hub/first-names/seed
 * 
 * Seeds the first names dictionary with a comprehensive starter list.
 * Uses curated names from SSA, Census, and international sources.
 * 
 * Request body options:
 * - source: 'curated' (default) - ~1,400 curated names
 * - names: string[] - Custom array of names to add (merged with existing)
 * - replace: boolean - If true, replaces all names; if false, merges (default: true)
 */
router.post('/first-names/seed', authenticateJWT, async (req, res) => {
    const requestId = `GH-FN-SEED-${Date.now()}`;
    
    try {
        logger.info(`🌐 [GLOBAL HUB] ${requestId} - Seeding first names dictionary`);
        
        // Load the seed data
        const { FIRST_NAMES_SEED } = require('../../data/firstNamesSeed');
        
        if (!FIRST_NAMES_SEED || !Array.isArray(FIRST_NAMES_SEED)) {
            return res.status(500).json({
                success: false,
                error: 'Seed data not available'
            });
        }
        
        // Normalize names
        const normalizedNames = normalizeFirstNames(FIRST_NAMES_SEED);
        
        // Get current settings
        const settings = await AdminSettings.getSettings();
        
        // Initialize globalHub structure if needed
        if (!settings.globalHub) {
            settings.globalHub = {};
        }
        if (!settings.globalHub.dictionaries) {
            settings.globalHub.dictionaries = {};
        }
        
        // Update first names
        const now = new Date();
        settings.globalHub.dictionaries.firstNames = normalizedNames;
        settings.globalHub.dictionaries.firstNamesUpdatedAt = now;
        settings.globalHub.dictionaries.firstNamesUpdatedBy = 'seed-endpoint';
        
        // Mark as modified and save
        settings.markModified('globalHub');
        await settings.save();
        
        // Sync to Redis
        await GlobalHubService.syncFirstNamesToRedis(normalizedNames);
        
        logger.info(`✅ [GLOBAL HUB] ${requestId} - Seeded ${normalizedNames.length.toLocaleString()} first names`);
        
        return res.json({
            success: true,
            data: {
                count: normalizedNames.length,
                lastUpdated: now.toISOString(),
                source: 'curated-seed'
            },
            message: `Successfully seeded ${normalizedNames.length.toLocaleString()} first names`
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Error seeding first names:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to seed first names dictionary',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/global-hub/health
 * 
 * Returns health status of Global Hub including Redis sync status.
 */
router.get('/health', authenticateJWT, async (req, res) => {
    const requestId = `GH-HEALTH-${Date.now()}`;
    
    try {
        const health = await GlobalHubService.healthCheck();
        
        return res.json({
            success: true,
            data: health
        });
        
    } catch (error) {
        logger.error(`❌ [GLOBAL HUB] ${requestId} - Health check failed:`, error);
        return res.status(500).json({
            success: false,
            error: 'Health check failed',
            details: error.message
        });
    }
});

module.exports = router;

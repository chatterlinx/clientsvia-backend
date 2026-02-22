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

module.exports = router;

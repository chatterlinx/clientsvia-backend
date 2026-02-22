/**
 * ============================================================================
 * 🌐 GLOBAL HUB SERVICE - Cross-Tenant Shared Resources
 * ============================================================================
 * 
 * PURPOSE:
 * Provides fast O(1) access to global shared resources (like first names)
 * across ALL companies using Redis Sets for runtime lookups.
 * 
 * ARCHITECTURE:
 * ┌─────────────────┐
 * │    MongoDB      │  Source of truth (AdminSettings.globalHub)
 * │  AdminSettings  │  - Persists data
 * └────────┬────────┘  - Admin edits via API
 *          │
 *          │ Sync on: server start, after save
 *          ▼
 * ┌─────────────────┐
 * │   Redis SET     │  Runtime cache for O(1) lookups
 * │ globalHub:*     │  - SISMEMBER for instant checks
 * └────────┬────────┘  - 50K names = ~3MB memory
 *          │
 *          │ SISMEMBER < 1ms
 *          ▼
 * ┌─────────────────┐
 * │  All Companies  │  Shared access, no per-tenant duplication
 * └─────────────────┘
 * 
 * REDIS KEYS:
 * - globalHub:firstNames          → SET of all first names (lowercase)
 * - globalHub:firstNames:meta     → HASH with count, lastUpdated
 * - globalHub:firstNames:original → SET with original casing (for display)
 * 
 * USAGE:
 *   const GlobalHubService = require('./services/GlobalHubService');
 *   
 *   // Check if "John" is a valid first name (O(1))
 *   const isFirstName = await GlobalHubService.isFirstName('John');
 *   
 *   // Get all first names (for admin UI)
 *   const names = await GlobalHubService.getFirstNames();
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const { redisClient } = require('../clients');

// Redis key constants
const REDIS_KEYS = {
    FIRST_NAMES: 'globalHub:firstNames',           // SET (lowercase for lookups)
    FIRST_NAMES_ORIGINAL: 'globalHub:firstNames:original', // SET (original casing)
    FIRST_NAMES_META: 'globalHub:firstNames:meta', // HASH (metadata)
    
    LAST_NAMES: 'globalHub:lastNames',             // SET (lowercase for lookups)
    LAST_NAMES_ORIGINAL: 'globalHub:lastNames:original',   // SET (original casing)
    LAST_NAMES_META: 'globalHub:lastNames:meta'    // HASH (metadata)
};

// In-memory fallback when Redis unavailable
let memoryFallback = {
    firstNames: new Set(),
    firstNamesOriginal: [],
    lastNames: new Set(),
    lastNamesOriginal: []
};

/**
 * ============================================================================
 * FIRST NAMES - Fast Lookup Functions
 * ============================================================================
 */

/**
 * Check if a name is in the first names dictionary
 * O(1) lookup via Redis SISMEMBER
 * 
 * @param {string} name - Name to check
 * @returns {Promise<boolean>} - True if name is a known first name
 */
async function isFirstName(name) {
    if (!name || typeof name !== 'string') return false;
    
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return false;
    
    try {
        // Try Redis first
        if (redisClient && redisClient.isReady) {
            const result = await redisClient.sIsMember(REDIS_KEYS.FIRST_NAMES, normalizedName);
            return result === 1 || result === true;
        }
        
        // Fallback to memory
        return memoryFallback.firstNames.has(normalizedName);
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error checking first name:', error);
        // Fallback to memory on error
        return memoryFallback.firstNames.has(normalizedName);
    }
}

/**
 * Get all first names (for admin UI display)
 * Returns original casing
 * 
 * @returns {Promise<string[]>} - Array of first names in Title Case
 */
async function getFirstNames() {
    try {
        // Try Redis first
        if (redisClient && redisClient.isReady) {
            const names = await redisClient.sMembers(REDIS_KEYS.FIRST_NAMES_ORIGINAL);
            return names.sort((a, b) => a.localeCompare(b));
        }
        
        // Fallback to memory
        return [...memoryFallback.firstNamesOriginal].sort((a, b) => a.localeCompare(b));
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error getting first names:', error);
        return [...memoryFallback.firstNamesOriginal].sort((a, b) => a.localeCompare(b));
    }
}

/**
 * Get first names count
 * 
 * @returns {Promise<number>} - Count of names in dictionary
 */
async function getFirstNamesCount() {
    try {
        if (redisClient && redisClient.isReady) {
            return await redisClient.sCard(REDIS_KEYS.FIRST_NAMES);
        }
        return memoryFallback.firstNames.size;
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error getting first names count:', error);
        return memoryFallback.firstNames.size;
    }
}

/**
 * ============================================================================
 * LAST NAMES - Fast Lookup Functions
 * ============================================================================
 */

/**
 * Check if a name is in the last names (surnames) dictionary
 * O(1) lookup via Redis SISMEMBER
 * 
 * @param {string} name - Name to check
 * @returns {Promise<boolean>} - True if name is a known last name
 */
async function isLastName(name) {
    if (!name || typeof name !== 'string') return false;
    
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return false;
    
    try {
        // Try Redis first
        if (redisClient && redisClient.isReady) {
            const result = await redisClient.sIsMember(REDIS_KEYS.LAST_NAMES, normalizedName);
            return result === 1 || result === true;
        }
        
        // Fallback to memory
        return memoryFallback.lastNames.has(normalizedName);
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error checking last name:', error);
        // Fallback to memory on error
        return memoryFallback.lastNames.has(normalizedName);
    }
}

/**
 * Get all last names (for admin UI display)
 * Returns original casing
 * 
 * @returns {Promise<string[]>} - Array of last names in Title Case
 */
async function getLastNames() {
    try {
        // Try Redis first
        if (redisClient && redisClient.isReady) {
            const names = await redisClient.sMembers(REDIS_KEYS.LAST_NAMES_ORIGINAL);
            return names.sort((a, b) => a.localeCompare(b));
        }
        
        // Fallback to memory
        return [...memoryFallback.lastNamesOriginal].sort((a, b) => a.localeCompare(b));
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error getting last names:', error);
        return [...memoryFallback.lastNamesOriginal].sort((a, b) => a.localeCompare(b));
    }
}

/**
 * Get last names count
 * 
 * @returns {Promise<number>} - Count of names in dictionary
 */
async function getLastNamesCount() {
    try {
        if (redisClient && redisClient.isReady) {
            return await redisClient.sCard(REDIS_KEYS.LAST_NAMES);
        }
        return memoryFallback.lastNames.size;
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error getting last names count:', error);
        return memoryFallback.lastNames.size;
    }
}

/**
 * ============================================================================
 * SYNC FUNCTIONS - MongoDB → Redis
 * ============================================================================
 */

/**
 * Sync first names from MongoDB to Redis
 * Called on server startup and after admin saves
 * 
 * @param {string[]} [namesFromDb] - Optional: names array (skips DB fetch if provided)
 * @returns {Promise<{success: boolean, count: number}>}
 */
async function syncFirstNamesToRedis(namesFromDb = null) {
    const startTime = Date.now();
    logger.info('🌐 [GLOBAL HUB] Syncing first names to Redis...');
    
    try {
        // Get names from MongoDB if not provided
        let names = namesFromDb;
        
        if (!names) {
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.getSettings();
            names = settings?.globalHub?.dictionaries?.firstNames || [];
        }
        
        if (!Array.isArray(names) || names.length === 0) {
            logger.warn('🌐 [GLOBAL HUB] No first names to sync');
            return { success: true, count: 0 };
        }
        
        // Update memory fallback first (always works)
        memoryFallback.firstNames = new Set(names.map(n => n.toLowerCase()));
        memoryFallback.firstNamesOriginal = [...names];
        
        // Sync to Redis if available
        if (redisClient && redisClient.isReady) {
            // Use pipeline for efficiency
            const pipeline = redisClient.multi();
            
            // Clear existing sets
            pipeline.del(REDIS_KEYS.FIRST_NAMES);
            pipeline.del(REDIS_KEYS.FIRST_NAMES_ORIGINAL);
            
            // Add lowercase names for lookups (batched)
            const lowercaseNames = names.map(n => n.toLowerCase());
            if (lowercaseNames.length > 0) {
                pipeline.sAdd(REDIS_KEYS.FIRST_NAMES, lowercaseNames);
            }
            
            // Add original casing for display
            if (names.length > 0) {
                pipeline.sAdd(REDIS_KEYS.FIRST_NAMES_ORIGINAL, names);
            }
            
            // Update metadata
            pipeline.hSet(REDIS_KEYS.FIRST_NAMES_META, {
                count: names.length.toString(),
                lastSynced: new Date().toISOString()
            });
            
            // Execute pipeline
            await pipeline.exec();
            
            const elapsed = Date.now() - startTime;
            logger.info(`✅ [GLOBAL HUB] Synced ${names.length.toLocaleString()} first names to Redis in ${elapsed}ms`);
        } else {
            logger.warn('⚠️ [GLOBAL HUB] Redis not available, using memory fallback only');
        }
        
        return { success: true, count: names.length };
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error syncing first names to Redis:', error);
        return { success: false, count: 0, error: error.message };
    }
}

/**
 * Sync last names from MongoDB to Redis
 * Called on server startup and after admin saves
 * 
 * @param {string[]} [namesFromDb] - Optional: names array (skips DB fetch if provided)
 * @returns {Promise<{success: boolean, count: number}>}
 */
async function syncLastNamesToRedis(namesFromDb = null) {
    const startTime = Date.now();
    logger.info('🌐 [GLOBAL HUB] Syncing last names to Redis...');
    
    try {
        // Get names from MongoDB if not provided
        let names = namesFromDb;
        
        if (!names) {
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.getSettings();
            names = settings?.globalHub?.dictionaries?.lastNames || [];
        }
        
        if (!Array.isArray(names) || names.length === 0) {
            logger.warn('🌐 [GLOBAL HUB] No last names to sync');
            return { success: true, count: 0 };
        }
        
        // Update memory fallback first (always works)
        memoryFallback.lastNames = new Set(names.map(n => n.toLowerCase()));
        memoryFallback.lastNamesOriginal = [...names];
        
        // Sync to Redis if available
        if (redisClient && redisClient.isReady) {
            // Use pipeline for efficiency
            const pipeline = redisClient.multi();
            
            // Clear existing sets
            pipeline.del(REDIS_KEYS.LAST_NAMES);
            pipeline.del(REDIS_KEYS.LAST_NAMES_ORIGINAL);
            
            // Add lowercase names for lookups (batched)
            const lowercaseNames = names.map(n => n.toLowerCase());
            if (lowercaseNames.length > 0) {
                pipeline.sAdd(REDIS_KEYS.LAST_NAMES, lowercaseNames);
            }
            
            // Add original casing for display
            if (names.length > 0) {
                pipeline.sAdd(REDIS_KEYS.LAST_NAMES_ORIGINAL, names);
            }
            
            // Update metadata
            pipeline.hSet(REDIS_KEYS.LAST_NAMES_META, {
                count: names.length.toString(),
                lastSynced: new Date().toISOString()
            });
            
            // Execute pipeline
            await pipeline.exec();
            
            const elapsed = Date.now() - startTime;
            logger.info(`✅ [GLOBAL HUB] Synced ${names.length.toLocaleString()} last names to Redis in ${elapsed}ms`);
        } else {
            logger.warn('⚠️ [GLOBAL HUB] Redis not available, using memory fallback only');
        }
        
        return { success: true, count: names.length };
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Error syncing last names to Redis:', error);
        return { success: false, count: 0, error: error.message };
    }
}

/**
 * Initialize Global Hub on server startup
 * Loads all dictionaries from MongoDB into Redis
 */
async function initialize() {
    logger.info('🌐 [GLOBAL HUB] Initializing Global Hub Service...');
    
    try {
        // Sync first names
        const firstResult = await syncFirstNamesToRedis();
        
        // Sync last names
        const lastResult = await syncLastNamesToRedis();
        
        logger.info(`✅ [GLOBAL HUB] Initialized - ${firstResult.count.toLocaleString()} first names, ${lastResult.count.toLocaleString()} last names loaded`);
        return { 
            success: true, 
            firstNames: firstResult.count, 
            lastNames: lastResult.count 
        };
        
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Initialization failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * ============================================================================
 * HEALTH CHECK
 * ============================================================================
 */

/**
 * Check Global Hub health status
 */
async function healthCheck() {
    const status = {
        redis: false,
        memoryFallback: true,
        firstNamesCount: 0,
        lastNamesCount: 0
    };
    
    try {
        if (redisClient && redisClient.isReady) {
            status.redis = true;
            status.firstNamesCount = await redisClient.sCard(REDIS_KEYS.FIRST_NAMES);
            status.lastNamesCount = await redisClient.sCard(REDIS_KEYS.LAST_NAMES);
        } else {
            status.firstNamesCount = memoryFallback.firstNames.size;
            status.lastNamesCount = memoryFallback.lastNames.size;
        }
    } catch (error) {
        logger.error('❌ [GLOBAL HUB] Health check error:', error);
        status.firstNamesCount = memoryFallback.firstNames.size;
        status.lastNamesCount = memoryFallback.lastNames.size;
    }
    
    return status;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // First Names - Lookup functions (for runtime use across all companies)
    isFirstName,
    getFirstNames,
    getFirstNamesCount,
    
    // Last Names - Lookup functions (for runtime use across all companies)
    isLastName,
    getLastNames,
    getLastNamesCount,
    
    // Sync functions (for admin operations)
    syncFirstNamesToRedis,
    syncLastNamesToRedis,
    
    // Initialization (called on server startup)
    initialize,
    
    // Health check
    healthCheck,
    
    // Constants (for external reference)
    REDIS_KEYS
};

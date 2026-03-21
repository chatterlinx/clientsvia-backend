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
const { levenshteinDistance } = require('../utils/stringDistance');

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

// Prefix indexes for fuzzy matching (built during initialize)
// Structure: { 'a': ['Aaron','Adam',...], 'b': ['Brian','Bryan',...], ... }
let firstNamePrefixIndex = {};
let lastNamePrefixIndex = {};

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
            // GUARD: If Redis has a large dataset, refuse to overwrite with nothing
            if (redisClient && redisClient.isReady) {
                try {
                    const currentRedisCount = await redisClient.sCard(REDIS_KEYS.FIRST_NAMES);
                    if (currentRedisCount > 1000) {
                        logger.error(`🚨 CRITICAL [GLOBAL HUB] MongoDB returned 0 first names but Redis has ${currentRedisCount.toLocaleString()}. REFUSING to sync empty data. Preserving Redis.`);
                        return { success: false, count: currentRedisCount, preserved: true };
                    }
                } catch (guardErr) {
                    logger.warn('⚠️ [GLOBAL HUB] Could not check Redis for empty-data guard:', guardErr.message);
                }
            }
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
            // GUARD: If Redis has a large dataset, refuse to overwrite with nothing
            if (redisClient && redisClient.isReady) {
                try {
                    const currentRedisCount = await redisClient.sCard(REDIS_KEYS.LAST_NAMES);
                    if (currentRedisCount > 1000) {
                        logger.error(`🚨 CRITICAL [GLOBAL HUB] MongoDB returned 0 last names but Redis has ${currentRedisCount.toLocaleString()}. REFUSING to sync empty data. Preserving Redis.`);
                        return { success: false, count: currentRedisCount, preserved: true };
                    }
                } catch (guardErr) {
                    logger.warn('⚠️ [GLOBAL HUB] Could not check Redis for empty-data guard:', guardErr.message);
                }
            }
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

        // AUTO-SEED: If both dictionaries are empty, seed from static data files
        if (firstResult.count === 0 && lastResult.count === 0) {
            logger.warn('🌐 [GLOBAL HUB] Both name dictionaries are EMPTY. Auto-seeding from static data files...');

            try {
                const { FIRST_NAMES_SEED } = require('../data/firstNamesSeed');
                const { LAST_NAMES_SEED } = require('../data/lastNamesSeed');

                if (Array.isArray(FIRST_NAMES_SEED) && FIRST_NAMES_SEED.length > 0 &&
                    Array.isArray(LAST_NAMES_SEED) && LAST_NAMES_SEED.length > 0) {

                    // Write to MongoDB using atomic $set (avoids race condition with getSettings + save)
                    const AdminSettings = require('../models/AdminSettings');
                    const now = new Date();
                    await AdminSettings.findOneAndUpdate(
                        {},
                        { $set: {
                            'globalHub.dictionaries.firstNames': FIRST_NAMES_SEED,
                            'globalHub.dictionaries.firstNamesUpdatedAt': now,
                            'globalHub.dictionaries.firstNamesUpdatedBy': 'auto-seed-startup',
                            'globalHub.dictionaries.lastNames': LAST_NAMES_SEED,
                            'globalHub.dictionaries.lastNamesUpdatedAt': now,
                            'globalHub.dictionaries.lastNamesUpdatedBy': 'auto-seed-startup'
                        }},
                        { upsert: true }
                    );

                    // Re-sync to Redis with the seeded data
                    const firstSeed = await syncFirstNamesToRedis(FIRST_NAMES_SEED);
                    const lastSeed = await syncLastNamesToRedis(LAST_NAMES_SEED);

                    logger.info(`🌱 [GLOBAL HUB] AUTO-SEEDED: ${firstSeed.count.toLocaleString()} first names, ${lastSeed.count.toLocaleString()} last names`);

                    // Build prefix indexes for fuzzy matching
                    rebuildPrefixIndexes();

                    return {
                        success: true,
                        firstNames: firstSeed.count,
                        lastNames: lastSeed.count,
                        autoSeeded: true
                    };
                } else {
                    logger.warn('⚠️ [GLOBAL HUB] Seed data files are empty or malformed');
                }
            } catch (seedError) {
                logger.error('❌ [GLOBAL HUB] Auto-seed failed:', seedError.message);
                // Not fatal — continue with 0 names
            }
        }

        // Build prefix indexes for fuzzy matching
        rebuildPrefixIndexes();

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
 * SMART NAME MATCHING — Dictionary-Backed Verification & Correction
 * ============================================================================
 *
 * Behavior model:
 * - Exact hit           → accept confidently, canonical casing
 * - Levenshtein 1, 1 candidate  → silently normalize (e.g. "Dustn" → "Dustin")
 * - Levenshtein 1, 2+ candidates → flag for confirmation (e.g. Marc/Mark)
 * - No hit              → allow through, mark unverified (foreign/rare names OK)
 *
 * Safety: Only matches within same first-letter bucket.
 *         "Marc" can match "Mark" but never "Karl".
 */

/**
 * @typedef {Object} NameMatchResult
 * @property {boolean} match       - Whether a dictionary match was found (exact or fuzzy)
 * @property {string}  value       - Recommended name to use (canonical casing if matched)
 * @property {string}  raw         - Original input before any correction
 * @property {number}  score       - Confidence 0.0-1.0
 * @property {'exact'|'fuzzy-auto'|'fuzzy-ambiguous'|'spelled'|'unknown'} verificationMode
 * @property {string|null}   correctedFrom - Original value if corrected, null otherwise
 * @property {string[]|null} candidates    - Alternative candidates if ambiguous, null otherwise
 */

/**
 * Build a prefix index from an array of names for fast fuzzy matching.
 * Groups names by their lowercase first character.
 *
 * @param {string[]} namesOriginal - Array of names in original casing
 * @returns {Object} Prefix index: { 'a': ['Aaron','Adam',...], ... }
 */
function buildPrefixIndex(namesOriginal) {
    const index = {};
    for (const name of namesOriginal) {
        if (!name || name.length === 0) continue;
        const key = name.charAt(0).toLowerCase();
        if (!index[key]) index[key] = [];
        index[key].push(name);
    }
    return index;
}

/**
 * Rebuild prefix indexes from current memory fallback data.
 * Called after sync or auto-seed completes.
 */
function rebuildPrefixIndexes() {
    firstNamePrefixIndex = buildPrefixIndex(memoryFallback.firstNamesOriginal);
    lastNamePrefixIndex = buildPrefixIndex(memoryFallback.lastNamesOriginal);
    logger.info('🔤 [GLOBAL HUB] Prefix indexes built', {
        firstNameBuckets: Object.keys(firstNamePrefixIndex).length,
        lastNameBuckets: Object.keys(lastNamePrefixIndex).length,
        firstNamesTotal: memoryFallback.firstNamesOriginal.length,
        lastNamesTotal: memoryFallback.lastNamesOriginal.length
    });
}

/**
 * Title-case a name string (first char uppercase, rest lowercase).
 * @param {string} str
 * @returns {string}
 */
function titleCase(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Find the canonical (original-cased) version of a name from the memory fallback.
 *
 * @param {string} name - Name to look up (any casing)
 * @param {string[]} originalArray - memoryFallback.*Original array
 * @returns {string|null} Canonical-cased name or null if not found
 */
function findCanonicalCasing(name, originalArray) {
    const lower = name.toLowerCase();
    for (const original of originalArray) {
        if (original.toLowerCase() === lower) return original;
    }
    return null;
}

/**
 * Smart matching against the first names dictionary.
 *
 * 1. Exact match (O(1) Redis SISMEMBER) → score 1.0, verificationMode 'exact'
 * 2. Fuzzy match (prefix-bucketed Levenshtein ≤ 1):
 *    - Single candidate → score 0.95, 'fuzzy-auto' (silent correction)
 *    - Multiple candidates → score 0.80, 'fuzzy-ambiguous' (needs confirmation)
 * 3. No match → score 0.50, 'unknown' (allow through)
 *
 * @param {string} name - Name to match
 * @returns {Promise<NameMatchResult>}
 */
async function matchFirstName(name) {
    return _matchName(name, 'first');
}

/**
 * Smart matching against the last names dictionary.
 * Same algorithm as matchFirstName but queries the last names dictionary.
 *
 * @param {string} name - Name to match
 * @returns {Promise<NameMatchResult>}
 */
async function matchLastName(name) {
    return _matchName(name, 'last');
}

/**
 * Internal: Unified matching algorithm for both first and last names.
 *
 * @param {string} name - Name to match
 * @param {'first'|'last'} type - Which dictionary to search
 * @returns {Promise<NameMatchResult>}
 * @private
 */
async function _matchName(name, type) {
    // Guard: invalid input
    if (!name || typeof name !== 'string' || !name.trim()) {
        return {
            match: false,
            value: name || '',
            raw: name || '',
            score: 0,
            verificationMode: 'unknown',
            correctedFrom: null,
            candidates: null
        };
    }

    const trimmed = name.trim();
    const isFirst = type === 'first';
    const exactCheckFn = isFirst ? isFirstName : isLastName;
    const originalArray = isFirst ? memoryFallback.firstNamesOriginal : memoryFallback.lastNamesOriginal;
    const prefixIndex = isFirst ? firstNamePrefixIndex : lastNamePrefixIndex;

    // ── Step 1: Exact match (O(1)) ──────────────────────────────────────
    const isExact = await exactCheckFn(trimmed);
    if (isExact) {
        const canonical = findCanonicalCasing(trimmed, originalArray) || titleCase(trimmed);
        return {
            match: true,
            value: canonical,
            raw: trimmed,
            score: 1.0,
            verificationMode: 'exact',
            correctedFrom: null,
            candidates: null
        };
    }

    // ── Step 2: Fuzzy match (prefix-bucketed Levenshtein ≤ 1) ───────────
    const prefix = trimmed.charAt(0).toLowerCase();
    const bucket = prefixIndex[prefix];

    if (bucket && bucket.length > 0) {
        const nameLower = trimmed.toLowerCase();
        const fuzzyHits = [];

        for (const dictName of bucket) {
            // Quick length filter: Levenshtein ≤ 1 requires length difference ≤ 1
            const lenDiff = Math.abs(nameLower.length - dictName.length);
            if (lenDiff > 1) continue;

            const dist = levenshteinDistance(nameLower, dictName.toLowerCase());
            if (dist === 1) {
                fuzzyHits.push(dictName);
            }
        }

        if (fuzzyHits.length === 1) {
            // Single candidate at distance 1 → silent auto-correct
            return {
                match: true,
                value: fuzzyHits[0],
                raw: trimmed,
                score: 0.95,
                verificationMode: 'fuzzy-auto',
                correctedFrom: trimmed,
                candidates: null
            };
        }

        if (fuzzyHits.length > 1) {
            // Multiple candidates → ambiguous, flag for confirmation
            return {
                match: true,
                value: fuzzyHits[0],
                raw: trimmed,
                score: 0.80,
                verificationMode: 'fuzzy-ambiguous',
                correctedFrom: trimmed,
                candidates: fuzzyHits
            };
        }
    }

    // ── Step 3: No match → allow through as unknown ─────────────────────
    return {
        match: false,
        value: titleCase(trimmed),
        raw: trimmed,
        score: 0.50,
        verificationMode: 'unknown',
        correctedFrom: null,
        candidates: null
    };
}

/**
 * ============================================================================
 * DICTIONARY-FIRST TOKEN SCAN
 * ============================================================================
 *
 * Scans an array of pre-tokenized words against the name dictionaries using a
 * single Redis pipeline round trip (all tokens checked simultaneously).
 *
 * This is the preferred approach for name extraction from messy speech — the
 * dictionary hit IS the extraction AND the validation in one step. Filler words
 * ("my", "name", "is", "um") are naturally ignored because they're not names.
 *
 * Algorithm:
 *   1. Pipeline all tokens into a single Redis MULTI/EXEC (1 round trip)
 *   2. Any token that hits the firstNames dict → firstName candidate (first hit wins)
 *   3. Any token that hits the lastNames dict  → lastName candidate (last hit wins —
 *      surname comes last in natural speech, e.g. "I'm Mark Gonzalez" → Gonzalez)
 *   4. Graceful degrade: Redis down → sequential memory fallback
 *
 * @param {string[]} tokens - Pre-tokenized words (e.g. from extractNameTokens())
 * @param {'first'|'last'|'both'} [mode='both'] - Which dictionary(ies) to scan
 * @returns {Promise<{firstName: NameMatchResult|null, lastName: NameMatchResult|null}>}
 */
async function scanTokensForNames(tokens, mode = 'both') {
  if (!tokens || tokens.length === 0) return { firstName: null, lastName: null };

  const cleanTokens = tokens
    .filter(t => typeof t === 'string' && t.trim().length >= 2)
    .map(t => t.trim());

  if (cleanTokens.length === 0) return { firstName: null, lastName: null };

  const checkFirst = mode !== 'last';
  const checkLast  = mode !== 'first';

  // ── Redis pipeline path (single round trip) ──────────────────────────────
  try {
    if (redisClient && redisClient.isReady) {
      const pipeline = redisClient.multi();
      for (const token of cleanTokens) {
        const lower = token.toLowerCase();
        if (checkFirst) pipeline.sIsMember(REDIS_KEYS.FIRST_NAMES, lower);
        if (checkLast)  pipeline.sIsMember(REDIS_KEYS.LAST_NAMES,  lower);
      }
      const results = await pipeline.exec();

      // results layout per token:
      //   both  → [firstHit, lastHit]  step=2, firstOffset=0, lastOffset=1
      //   first → [firstHit]           step=1, firstOffset=0
      //   last  → [lastHit]            step=1, lastOffset=0
      const step        = (checkFirst ? 1 : 0) + (checkLast ? 1 : 0);
      const firstOffset = 0;
      const lastOffset  = checkFirst ? 1 : 0;

      let firstName = null;
      let lastName  = null;

      for (let i = 0; i < cleanTokens.length; i++) {
        const token = cleanTokens[i];
        const lower = token.toLowerCase();

        if (checkFirst && !firstName) {
          const hit = results[i * step + firstOffset];
          if (hit === 1 || hit === true) {
            const canonical = findCanonicalCasing(lower, memoryFallback.firstNamesOriginal) || titleCase(token);
            firstName = { match: true, value: canonical, raw: token, score: 1.0, verificationMode: 'exact' };
          }
        }
        if (checkLast) {
          const hit = results[i * step + lastOffset];
          if (hit === 1 || hit === true) {
            // Always overwrite — last hit wins (surname is the last name token)
            const canonical = findCanonicalCasing(lower, memoryFallback.lastNamesOriginal) || titleCase(token);
            lastName = { match: true, value: canonical, raw: token, score: 1.0, verificationMode: 'exact' };
          }
        }
      }

      return { firstName, lastName };
    }
  } catch (err) {
    logger.warn('[GLOBAL HUB] scanTokensForNames Redis pipeline failed — sequential fallback', {
      error: err.message
    });
  }

  // ── Memory fallback (sequential) ─────────────────────────────────────────
  let firstName = null;
  let lastName  = null;

  for (const token of cleanTokens) {
    const lower = token.toLowerCase();
    if (checkFirst && !firstName && memoryFallback.firstNames.has(lower)) {
      const canonical = findCanonicalCasing(lower, memoryFallback.firstNamesOriginal) || titleCase(token);
      firstName = { match: true, value: canonical, raw: token, score: 1.0, verificationMode: 'exact' };
    }
    if (checkLast && memoryFallback.lastNames.has(lower)) {
      const canonical = findCanonicalCasing(lower, memoryFallback.lastNamesOriginal) || titleCase(token);
      lastName = { match: true, value: canonical, raw: token, score: 1.0, verificationMode: 'exact' };
    }
  }

  return { firstName, lastName };
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

    // Smart Name Matching - Dictionary-backed verification & correction
    matchFirstName,
    matchLastName,

    // Dictionary-first token scan — single Redis round trip for full utterances
    scanTokensForNames,

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

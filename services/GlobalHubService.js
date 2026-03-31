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
    LAST_NAMES_META: 'globalHub:lastNames:meta',   // HASH (metadata)

    // Conversation Signals — stored as JSON strings (simple, no SET needed)
    SIGNALS_AFFIRMATIVES:   'globalHub:signals:affirmatives',
    SIGNALS_NEGATIVES:      'globalHub:signals:negatives',
    SIGNALS_BOOKING:        'globalHub:signals:booking',
    SIGNALS_EXIT:           'globalHub:signals:exit',
    SIGNALS_TRANSFER:       'globalHub:signals:transfer'
};

// In-memory fallback when Redis unavailable
let memoryFallback = {
    firstNames: new Set(),
    firstNamesOriginal: [],
    lastNames: new Set(),
    lastNamesOriginal: []
};

// ============================================================================
// CONVERSATION SIGNALS — Module-level cache
// ============================================================================
//
// These are the phrase lists that the KC engine uses to understand caller
// intent at runtime. They are loaded from MongoDB at startup and cached here
// so every call gets O(1) access with zero async overhead.
//
// GROUPS:
//   affirmatives  — YES words/phrases  (upsell / confirmation)
//   negatives     — NO words/phrases   (decline)
//   bookingPhrases — booking intent    (ready to schedule)
//   exitPhrases    — exit intent       (end call / topic hop)
//   transferPhrases — transfer intent  (wants a human)
//
// FALLBACK: If MongoDB has no signals saved, the hardcoded defaults below
//           are used. This means the engine always works — even on first boot.
// ============================================================================

// Hardcoded defaults — identical to the lists in KCBookingIntentDetector.js
// and KCTransferIntentDetector.js and KCDiscoveryRunner.js.
// These are only used when no signals exist in the database.
const DEFAULT_AFFIRMATIVES = [
    'yes','yeah','yep','yap','yup','yah','uh-huh','uh huh','mhm','mm-hmm','mmhm',
    'sure','absolutely','of course','definitely','for sure','why not',
    'go ahead','go for it','please','proceed',
    'add it','let\'s do it','let\'s go','sounds good','sounds great',
    'do it','i\'ll take it','throw it in','count me in','make it happen',
    'deal','perfect','alright','ok','okay','right','roger','affirmative'
];

const DEFAULT_NEGATIVES = [
    'no','nah','nope','no way','not today','not right now','not for me',
    'not interested','maybe later','another time','nevermind','never mind',
    'skip it','skip','no thanks','no thank you','pass','don\'t',
    'i\'m good','i\'m fine','i\'m ok','i\'m alright','we\'re good',
    'hold off','forget it','negative'
];

const DEFAULT_BOOKING_PHRASES = [
    'yes','yeah','yep','yup','sure','ok','okay','alright','absolutely','definitely',
    'of course','for sure','ok go ahead','ok sounds good','okay go ahead',
    'okay sounds good','alright go ahead','alright sounds good','sounds great',
    'that works','works for me','yes please','please do',
    'book it','book a visit','book a service','book a service call',
    'book the appointment','book an appointment','schedule','schedule it',
    'schedule a visit','schedule a service','schedule a service call',
    'schedule an appointment','make an appointment','set up a visit',
    'set it up','set an appointment','let\'s do it','let\'s go ahead',
    'go ahead','sounds good','i\'m ready','ready to book','ready to schedule',
    'when can you come','when can someone come','when are you available',
    'when can you come out','send someone out','have someone come out',
    'need someone to come','please schedule','please book','i want to book',
    'i\'d like to book','i want to schedule','i\'d like to schedule',
    'sign me up','put me down','get me on the schedule','i\'ll take it','we\'ll take it'
];

const DEFAULT_EXIT_PHRASES = [
    'no','nope','no thanks','no thank you','not interested','not right now',
    'maybe later','not today','never mind','nevermind','forget it','forget about it',
    'that\'s fine','that\'s ok','that\'s okay','on second thought',
    'actually never mind','don\'t worry about it',
    'goodbye','bye','bye bye','goodbye for now','have a good day',
    'talk to you later','i\'ll call back','i\'ll call you back','i\'ll think about it'
];

const DEFAULT_TRANSFER_PHRASES = [
    'transfer me','transfer to','transfer me to','transfer me to a',
    'connect me to','connect me with','put me through','put me through to',
    'patch me through','patch me to','forward me to','route me to',
    'speak to someone','speak with someone','talk to someone','talk with someone',
    'speak to a person','speak with a person','talk to a person','talk with a person',
    'speak to an agent','talk to an agent','speak with an agent',
    'speak to a human','talk to a human','speak to a live','talk to a live',
    'speak to a real','talk to a real','live agent','live person',
    'live representative','live rep','real person','human agent','actual person',
    'speak to a representative','talk to a representative',
    'speak to your representative','speak to staff','speak to an associate',
    'speak to a team member','speak to the team','speak to someone on your team',
    'speak to one of your','get a representative','reach a representative',
    'speak to a manager','talk to a manager','speak to the manager','get a manager',
    'manager please','speak to a supervisor','talk to a supervisor',
    'need a manager','need a supervisor','get me a manager',
    'let me speak to a manager','i want a manager','i want to speak to a manager',
    'i need to speak to a manager','need your manager','speak to your manager',
    'need to speak to someone','need to talk to someone','must speak to someone',
    'have to speak to someone','can i speak to','can i talk to',
    'may i speak to','may i talk to','id like to speak to',
    'i\'d like to speak to','i\'d like to talk to','id like to talk to',
    'i want to speak to','i want to talk to','i need to speak to','i need to talk to',
    'could i speak to','could i talk to',
    'is there someone i can speak to','is there someone i can talk to',
    'is there anyone i can speak to',
    'operator please','get me an operator','speak to the operator','talk to the operator',
    'zero','i want to speak to a real person','just let me talk to someone',
    'stop the recording','i need a real person','stop the automated','this is an emergency'
];

// Runtime cache — populated by loadSignals() at startup
// Each entry is either the DB value (if saved) or the DEFAULT above.
let _signals = {
    affirmatives:   [...DEFAULT_AFFIRMATIVES],
    negatives:      [...DEFAULT_NEGATIVES],
    bookingPhrases: [...DEFAULT_BOOKING_PHRASES],
    exitPhrases:    [...DEFAULT_EXIT_PHRASES],
    transferPhrases: [...DEFAULT_TRANSFER_PHRASES]
};

// Pre-compiled regex for YES and NO (word-boundary, case-insensitive)
// Re-compiled whenever affirmatives/negatives change.
let _yesRegex = _buildWordRegex(DEFAULT_AFFIRMATIVES);
let _noRegex  = _buildWordRegex(DEFAULT_NEGATIVES);

/**
 * Build a word-boundary regex from a list of phrases.
 * Multi-word phrases use substring matching; single words use \b boundaries.
 * Fallback: returns null if list is empty (callers should guard).
 */
function _buildWordRegex(phrases) {
    if (!phrases || phrases.length === 0) return null;
    // For a word-boundary regex we include all phrases.
    // Multi-word: fine as-is inside alternation.
    // Escape special regex chars, join with |.
    const escaped = phrases.map(p =>
        p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    try {
        return new RegExp('\\b(' + escaped.join('|') + ')\\b', 'i');
    } catch (e) {
        logger.warn('[GLOBAL HUB] Failed to compile signals regex — using null', { error: e.message });
        return null;
    }
}

/**
 * Get the pre-compiled YES regex.
 * Falls back to DEFAULT_AFFIRMATIVES regex if cache is null.
 * @returns {RegExp}
 */
function getYesRegex() {
    return _yesRegex || _buildWordRegex(DEFAULT_AFFIRMATIVES);
}

/**
 * Get the pre-compiled NO regex.
 * Falls back to DEFAULT_NEGATIVES regex if cache is null.
 * @returns {RegExp}
 */
function getNoRegex() {
    return _noRegex || _buildWordRegex(DEFAULT_NEGATIVES);
}

/**
 * Get a signal group's current phrase list.
 * @param {'affirmatives'|'negatives'|'bookingPhrases'|'exitPhrases'|'transferPhrases'} group
 * @returns {string[]}
 */
function getSignals(group) {
    return _signals[group] || [];
}

/**
 * Load all signal groups from MongoDB into the module cache.
 * Called at startup AFTER initialize(). Also initialises detector modules
 * (KCBookingIntentDetector, KCTransferIntentDetector) with the loaded phrases.
 *
 * Graceful: if DB has no signals, defaults are preserved.
 */
async function loadSignals() {
    try {
        logger.info('🗣️  [GLOBAL HUB] Loading conversation signals...');
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.getSettings();
        const s = settings?.globalHub?.signals || {};

        // For each group: use DB value if non-empty, else keep default
        if (s.affirmatives?.length   > 0) _signals.affirmatives   = [...s.affirmatives];
        if (s.negatives?.length      > 0) _signals.negatives       = [...s.negatives];
        if (s.bookingPhrases?.length > 0) _signals.bookingPhrases  = [...s.bookingPhrases];
        if (s.exitPhrases?.length    > 0) _signals.exitPhrases     = [...s.exitPhrases];
        if (s.transferPhrases?.length > 0) _signals.transferPhrases = [...s.transferPhrases];

        // Rebuild compiled regexes
        _yesRegex = _buildWordRegex(_signals.affirmatives);
        _noRegex  = _buildWordRegex(_signals.negatives);

        // Sync to Redis for cross-process access (optional, fire-and-forget)
        _syncSignalsToRedis().catch(e =>
            logger.warn('[GLOBAL HUB] Signals Redis sync failed (non-fatal)', { error: e.message })
        );

        // Push live values into detector modules
        try {
            const KCBooking = require('./engine/kc/KCBookingIntentDetector');
            if (typeof KCBooking.initialize === 'function') {
                KCBooking.initialize({
                    bookingPhrases: _signals.bookingPhrases,
                    exitPhrases:    _signals.exitPhrases
                });
            }
        } catch (e) {
            logger.warn('[GLOBAL HUB] Could not initialize KCBookingIntentDetector', { error: e.message });
        }

        try {
            const KCTransfer = require('./engine/kc/KCTransferIntentDetector');
            if (typeof KCTransfer.initialize === 'function') {
                KCTransfer.initialize({ transferPhrases: _signals.transferPhrases });
            }
        } catch (e) {
            logger.warn('[GLOBAL HUB] Could not initialize KCTransferIntentDetector', { error: e.message });
        }

        const totals = Object.entries(_signals).map(([k, v]) => `${k}:${v.length}`).join(', ');
        logger.info(`✅ [GLOBAL HUB] Signals loaded — ${totals}`);
        return { success: true };

    } catch (error) {
        logger.error('❌ [GLOBAL HUB] loadSignals failed — defaults retained:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Save one signal group to MongoDB and refresh the module cache.
 * @param {'affirmatives'|'negatives'|'bookingPhrases'|'exitPhrases'|'transferPhrases'} group
 * @param {string[]} phrases
 * @param {string} [updatedBy]
 */
async function saveSignals(group, phrases, updatedBy = 'api') {
    const VALID_GROUPS = ['affirmatives','negatives','bookingPhrases','exitPhrases','transferPhrases'];
    if (!VALID_GROUPS.includes(group)) throw new Error(`Unknown signal group: ${group}`);
    if (!Array.isArray(phrases)) throw new Error('phrases must be an array');

    const AdminSettings = require('../models/AdminSettings');
    const now = new Date();

    // Map group → DB field names
    const groupToDbKey = {
        affirmatives:   'affirmatives',
        negatives:      'negatives',
        bookingPhrases: 'bookingPhrases',
        exitPhrases:    'exitPhrases',
        transferPhrases: 'transferPhrases'
    };
    const dbKey = `globalHub.signals.${groupToDbKey[group]}`;
    const atKey = `globalHub.signals.${groupToDbKey[group]}UpdatedAt`;
    const byKey = `globalHub.signals.${groupToDbKey[group]}UpdatedBy`;

    await AdminSettings.findOneAndUpdate(
        {},
        { $set: {
            [dbKey]: phrases,
            [atKey]: now,
            [byKey]: updatedBy,
            'globalHub.signals.lastUpdatedAt': now,
            'globalHub.signals.lastUpdatedBy': updatedBy
        }},
        { upsert: true }
    );

    // Update module cache
    _signals[group] = [...phrases];
    if (group === 'affirmatives') _yesRegex = _buildWordRegex(_signals.affirmatives);
    if (group === 'negatives')    _noRegex  = _buildWordRegex(_signals.negatives);

    // Sync to Redis
    await _syncSignalsToRedis();

    // Re-push to detector modules
    try {
        const KCBooking = require('./engine/kc/KCBookingIntentDetector');
        if (typeof KCBooking.initialize === 'function') {
            KCBooking.initialize({
                bookingPhrases: _signals.bookingPhrases,
                exitPhrases:    _signals.exitPhrases
            });
        }
    } catch (e) { /* non-fatal */ }

    try {
        const KCTransfer = require('./engine/kc/KCTransferIntentDetector');
        if (typeof KCTransfer.initialize === 'function') {
            KCTransfer.initialize({ transferPhrases: _signals.transferPhrases });
        }
    } catch (e) { /* non-fatal */ }

    logger.info(`✅ [GLOBAL HUB] Signals saved — group:${group}, count:${phrases.length}`);
}

/**
 * Persist all signal groups to Redis as JSON strings.
 * @private
 */
async function _syncSignalsToRedis() {
    if (!redisClient || !redisClient.isReady) return;
    const pipeline = redisClient.multi();
    pipeline.set(REDIS_KEYS.SIGNALS_AFFIRMATIVES,  JSON.stringify(_signals.affirmatives));
    pipeline.set(REDIS_KEYS.SIGNALS_NEGATIVES,     JSON.stringify(_signals.negatives));
    pipeline.set(REDIS_KEYS.SIGNALS_BOOKING,       JSON.stringify(_signals.bookingPhrases));
    pipeline.set(REDIS_KEYS.SIGNALS_EXIT,          JSON.stringify(_signals.exitPhrases));
    pipeline.set(REDIS_KEYS.SIGNALS_TRANSFER,      JSON.stringify(_signals.transferPhrases));
    await pipeline.exec();
}

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

    // Conversation Signals — phrase lists for intent detection
    loadSignals,
    saveSignals,
    getSignals,
    getYesRegex,
    getNoRegex,

    // Exposed defaults (for seed scripts and tests)
    DEFAULT_AFFIRMATIVES,
    DEFAULT_NEGATIVES,
    DEFAULT_BOOKING_PHRASES,
    DEFAULT_EXIT_PHRASES,
    DEFAULT_TRANSFER_PHRASES,

    // Health check
    healthCheck,

    // Constants (for external reference)
    REDIS_KEYS
};

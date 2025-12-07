/**
 * ============================================================================
 * MISSION CACHE SERVICE
 * ============================================================================
 * 
 * THE BRAIN'S TRIGGER SYSTEM
 * 
 * This service is the foundation of the Call Flow Engine. It:
 * 1. Auto-extracts triggers from Triage Cards and Scenarios
 * 2. Supports manual override triggers from UI
 * 3. Caches in Redis for fast runtime lookup
 * 4. Supports per-trade trigger separation
 * 
 * ARCHITECTURE:
 * 
 *   Triage Cards + Scenarios
 *           │
 *           ▼
 *   ┌─────────────────────┐
 *   │ MissionCacheService │ ← rebuildMissionCache()
 *   └─────────────────────┘
 *           │
 *           ▼
 *   ┌─────────────────────┐
 *   │ Redis Cache         │ ← getMissionTriggers()
 *   │ + Mongo Snapshot    │
 *   └─────────────────────┘
 *           │
 *           ▼
 *   ┌─────────────────────┐
 *   │ FlowEngine          │ ← decideFlow()
 *   └─────────────────────┘
 * 
 * TRIGGER SOURCES:
 * - [Triage] - From triage card keywords
 * - [Scenario] - From scenario triggers
 * - [Manual] - From admin UI overrides
 * 
 * FLOW PRIORITY (highest to lowest):
 * 1. EMERGENCY
 * 2. CANCEL
 * 3. RESCHEDULE
 * 4. TRANSFER
 * 5. BOOKING
 * 6. MESSAGE
 * 7. GENERAL_INQUIRY
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const { redisClient } = require('../clients');

// Models
let TriageCard, Scenario, Company;
try {
    TriageCard = require('../models/TriageCard');
} catch (e) {
    logger.warn('[MISSION CACHE] TriageCard model not found');
}
try {
    // Try multiple scenario model paths
    Scenario = require('../models/Scenario');
} catch (e) {
    try {
        Scenario = require('../models/v2Scenario');
    } catch (e2) {
        logger.warn('[MISSION CACHE] Scenario model not found');
    }
}
try {
    Company = require('../models/v2Company');
} catch (e) {
    logger.warn('[MISSION CACHE] Company model not found');
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MISSION_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_KEY_PREFIX = 'mission:';

// Flow types in priority order (CRITICAL - do not change order)
const FLOW_PRIORITY = [
    'emergency',
    'cancel',
    'reschedule',
    'transfer',
    'booking',
    'message'
];

// Map triage card actions to flow types
const ACTION_TO_FLOW_MAP = {
    // Booking flows
    'BOOK': 'booking',
    'DIRECT_TO_3TIER': 'booking',
    'EXPLAIN_AND_PUSH': 'booking',
    
    // Emergency
    'EMERGENCY_DISPATCH': 'emergency',
    'EMERGENCY': 'emergency',
    
    // Transfer
    'ESCALATE_TO_HUMAN': 'transfer',
    'TRANSFER': 'transfer',
    'TRANSFER_TO_HUMAN': 'transfer',
    
    // Message
    'TAKE_MESSAGE': 'message',
    'MESSAGE_ONLY': 'message',
    
    // Cancel/Reschedule (may need explicit triage cards)
    'CANCEL_APPOINTMENT': 'cancel',
    'CANCEL': 'cancel',
    'RESCHEDULE_APPOINTMENT': 'reschedule',
    'RESCHEDULE': 'reschedule',
    
    // End call (map to message for safety)
    'END_CALL_POLITE': 'message'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize a keyword for consistent matching
 */
function normalizeKeyword(keyword) {
    if (!keyword || typeof keyword !== 'string') return null;
    return keyword.trim().toLowerCase();
}

/**
 * Deduplicate and clean a list of keywords
 */
function dedupeKeywords(keywords) {
    const normalized = keywords
        .map(normalizeKeyword)
        .filter(k => k && k.length > 1); // Filter out empty/single chars
    return [...new Set(normalized)];
}

/**
 * Create empty mission structure
 */
function createEmptyMission() {
    return {
        booking: { auto: [], manual: [], sources: {} },
        emergency: { auto: [], manual: [], sources: {} },
        cancel: { auto: [], manual: [], sources: {} },
        reschedule: { auto: [], manual: [], sources: {} },
        transfer: { auto: [], manual: [], sources: {} },
        message: { auto: [], manual: [], sources: {} }
    };
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

class MissionCacheService {
    
    /**
     * ========================================================================
     * REBUILD MISSION CACHE
     * ========================================================================
     * 
     * Auto-extracts triggers from triage cards and scenarios, merges with
     * manual overrides, and caches the result.
     * 
     * Call this when:
     * - Triage cards are created/updated/deleted
     * - Scenarios are created/updated/deleted
     * - Manual triggers are updated in UI
     * 
     * @param {string} companyId - The company ID
     * @param {string} trade - Optional trade filter (e.g., 'hvac', 'plumbing')
     * @returns {object} The rebuilt mission triggers
     */
    static async rebuildMissionCache(companyId, trade = '_default') {
        const startTime = Date.now();
        logger.info(`[MISSION CACHE] 🔄 Rebuilding cache for company ${companyId}, trade: ${trade}`);
        
        try {
            // Load all data in parallel
            const [triageCards, scenarios, company] = await Promise.all([
                TriageCard ? TriageCard.find({ companyId, isActive: { $ne: false } }).lean() : [],
                Scenario ? Scenario.find({ companyId, isActive: { $ne: false } }).lean() : [],
                Company ? Company.findById(companyId).lean() : null
            ]);
            
            logger.debug(`[MISSION CACHE] Loaded: ${triageCards.length} triage cards, ${scenarios.length} scenarios`);
            
            // Initialize mission structure
            const mission = createEmptyMission();
            
            // ================================================================
            // 1. EXTRACT FROM TRIAGE CARDS
            // ================================================================
            for (const card of triageCards) {
                const cfg = card.quickRuleConfig || {};
                const action = cfg.action || card.action || '';
                const keywords = cfg.keywordsMustHave || card.keywords || [];
                
                // Determine flow type from action
                const flowType = ACTION_TO_FLOW_MAP[action];
                
                if (flowType && mission[flowType] && keywords.length > 0) {
                    // Add keywords to auto list
                    mission[flowType].auto.push(...keywords);
                    
                    // Track source for debugging
                    for (const kw of keywords) {
                        const normalizedKw = normalizeKeyword(kw);
                        if (normalizedKw) {
                            mission[flowType].sources[normalizedKw] = {
                                type: 'triage',
                                name: card.displayName || card.triageLabel || 'Unknown Card',
                                cardId: card._id?.toString()
                            };
                        }
                    }
                }
            }
            
            // ================================================================
            // 2. EXTRACT FROM SCENARIOS
            // ================================================================
            for (const scenario of scenarios) {
                const triggers = scenario.triggers || [];
                const actionType = scenario.actionType || scenario.scenarioType || '';
                const name = scenario.scenarioName || scenario.name || 'Unknown Scenario';
                
                // Determine flow type
                let flowType = ACTION_TO_FLOW_MAP[actionType];
                
                // If no explicit action type, infer from scenario name/content
                if (!flowType) {
                    const nameLower = name.toLowerCase();
                    if (nameLower.includes('emergency')) flowType = 'emergency';
                    else if (nameLower.includes('cancel')) flowType = 'cancel';
                    else if (nameLower.includes('reschedule')) flowType = 'reschedule';
                    else if (nameLower.includes('transfer')) flowType = 'transfer';
                    else if (nameLower.includes('message')) flowType = 'message';
                    else flowType = 'booking'; // Default to booking for service scenarios
                }
                
                if (flowType && mission[flowType] && triggers.length > 0) {
                    mission[flowType].auto.push(...triggers);
                    
                    for (const trigger of triggers) {
                        const normalizedTrigger = normalizeKeyword(trigger);
                        if (normalizedTrigger) {
                            mission[flowType].sources[normalizedTrigger] = {
                                type: 'scenario',
                                name: name,
                                scenarioId: scenario._id?.toString()
                            };
                        }
                    }
                }
            }
            
            // ================================================================
            // 3. MERGE MANUAL OVERRIDES
            // ================================================================
            const manualTriggers = company?.callFlowEngine?.missionTriggers?.[trade] || 
                                   company?.callFlowEngine?.missionTriggers?._default || {};
            
            for (const flowType of Object.keys(mission)) {
                const manualList = manualTriggers[flowType]?.manual || [];
                if (Array.isArray(manualList)) {
                    mission[flowType].manual = [...manualList];
                    
                    for (const kw of manualList) {
                        const normalizedKw = normalizeKeyword(kw);
                        if (normalizedKw) {
                            mission[flowType].sources[normalizedKw] = {
                                type: 'manual',
                                name: 'Admin Override'
                            };
                        }
                    }
                }
            }
            
            // ================================================================
            // 4. DEDUPLICATE AND FINALIZE
            // ================================================================
            const finalMission = {};
            for (const flowType of Object.keys(mission)) {
                finalMission[flowType] = {
                    auto: dedupeKeywords(mission[flowType].auto),
                    manual: dedupeKeywords(mission[flowType].manual),
                    // Combined list for runtime matching
                    all: dedupeKeywords([...mission[flowType].auto, ...mission[flowType].manual]),
                    sources: mission[flowType].sources
                };
            }
            
            // ================================================================
            // 5. SAVE TO COMPANY (snapshot)
            // ================================================================
            if (Company) {
                const updatePath = `callFlowEngine.missionTriggers.${trade}`;
                await Company.updateOne(
                    { _id: companyId },
                    { 
                        $set: { 
                            [updatePath]: finalMission,
                            'callFlowEngine.lastCacheRebuild': new Date()
                        }
                    }
                );
            }
            
            // ================================================================
            // 6. CACHE IN REDIS
            // ================================================================
            if (redisClient) {
                const cacheKey = `${CACHE_KEY_PREFIX}${companyId}:${trade}`;
                await redisClient.setEx(cacheKey, MISSION_CACHE_TTL_SECONDS, JSON.stringify(finalMission));
                logger.debug(`[MISSION CACHE] ✅ Cached to Redis: ${cacheKey}`);
            }
            
            const duration = Date.now() - startTime;
            logger.info(`[MISSION CACHE] ✅ Rebuilt in ${duration}ms`, {
                companyId,
                trade,
                counts: {
                    booking: finalMission.booking.all.length,
                    emergency: finalMission.emergency.all.length,
                    cancel: finalMission.cancel.all.length,
                    reschedule: finalMission.reschedule.all.length,
                    transfer: finalMission.transfer.all.length,
                    message: finalMission.message.all.length
                }
            });
            
            return finalMission;
            
        } catch (error) {
            logger.error(`[MISSION CACHE] ❌ Rebuild failed:`, error);
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * GET MISSION TRIGGERS (Runtime)
     * ========================================================================
     * 
     * Fast lookup for use in the call flow. Checks Redis first, then Mongo,
     * rebuilds if necessary.
     * 
     * @param {string} companyId - The company ID
     * @param {string} trade - Optional trade filter
     * @returns {object} Mission triggers
     */
    static async getMissionTriggers(companyId, trade = '_default') {
        const cacheKey = `${CACHE_KEY_PREFIX}${companyId}:${trade}`;
        
        // 1. Try Redis cache
        if (redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    logger.debug(`[MISSION CACHE] ✅ Cache hit: ${cacheKey}`);
                    return JSON.parse(cached);
                }
            } catch (e) {
                logger.warn(`[MISSION CACHE] Redis get failed:`, e.message);
            }
        }
        
        // 2. Try Mongo snapshot
        if (Company) {
            try {
                const company = await Company.findById(companyId).lean();
                const snapshot = company?.callFlowEngine?.missionTriggers?.[trade] ||
                                company?.callFlowEngine?.missionTriggers?._default;
                
                if (snapshot && snapshot.booking) {
                    // Rehydrate cache
                    if (redisClient) {
                        redisClient.setEx(cacheKey, MISSION_CACHE_TTL_SECONDS, JSON.stringify(snapshot))
                            .catch(e => logger.warn('[MISSION CACHE] Redis set failed:', e.message));
                    }
                    return snapshot;
                }
            } catch (e) {
                logger.warn(`[MISSION CACHE] Mongo get failed:`, e.message);
            }
        }
        
        // 3. Rebuild if nothing found
        logger.info(`[MISSION CACHE] Cache miss - rebuilding for ${companyId}`);
        return await this.rebuildMissionCache(companyId, trade);
    }
    
    /**
     * ========================================================================
     * ADD MANUAL TRIGGER
     * ========================================================================
     * 
     * Add a manual trigger override from the UI.
     * 
     * @param {string} companyId
     * @param {string} flowType - 'booking', 'emergency', etc.
     * @param {string} trigger - The trigger phrase
     * @param {string} trade - Optional trade
     */
    static async addManualTrigger(companyId, flowType, trigger, trade = '_default') {
        const normalizedTrigger = normalizeKeyword(trigger);
        if (!normalizedTrigger) {
            throw new Error('Invalid trigger');
        }
        
        if (!FLOW_PRIORITY.includes(flowType)) {
            throw new Error(`Invalid flow type: ${flowType}`);
        }
        
        const updatePath = `callFlowEngine.missionTriggers.${trade}.${flowType}.manual`;
        
        await Company.updateOne(
            { _id: companyId },
            { $addToSet: { [updatePath]: normalizedTrigger } }
        );
        
        // Rebuild cache
        await this.rebuildMissionCache(companyId, trade);
        
        logger.info(`[MISSION CACHE] ➕ Added manual trigger: "${normalizedTrigger}" → ${flowType}`);
    }
    
    /**
     * ========================================================================
     * REMOVE MANUAL TRIGGER
     * ========================================================================
     */
    static async removeManualTrigger(companyId, flowType, trigger, trade = '_default') {
        const normalizedTrigger = normalizeKeyword(trigger);
        if (!normalizedTrigger) return;
        
        const updatePath = `callFlowEngine.missionTriggers.${trade}.${flowType}.manual`;
        
        await Company.updateOne(
            { _id: companyId },
            { $pull: { [updatePath]: normalizedTrigger } }
        );
        
        // Rebuild cache
        await this.rebuildMissionCache(companyId, trade);
        
        logger.info(`[MISSION CACHE] ➖ Removed manual trigger: "${normalizedTrigger}" from ${flowType}`);
    }
    
    /**
     * ========================================================================
     * INVALIDATE CACHE
     * ========================================================================
     * 
     * Force cache invalidation. Call when triage/scenarios change.
     */
    static async invalidateCache(companyId, trade = '_default') {
        if (redisClient) {
            const cacheKey = `${CACHE_KEY_PREFIX}${companyId}:${trade}`;
            await redisClient.del(cacheKey);
            logger.debug(`[MISSION CACHE] 🗑️ Invalidated: ${cacheKey}`);
        }
    }
    
    /**
     * ========================================================================
     * GET TRIGGER SOURCE
     * ========================================================================
     * 
     * Get the source of a specific trigger (for UI display).
     */
    static async getTriggerSource(companyId, trigger, trade = '_default') {
        const mission = await this.getMissionTriggers(companyId, trade);
        const normalizedTrigger = normalizeKeyword(trigger);
        
        for (const flowType of Object.keys(mission)) {
            const source = mission[flowType].sources?.[normalizedTrigger];
            if (source) {
                return { flowType, ...source };
            }
        }
        
        return null;
    }
    
    /**
     * ========================================================================
     * GET STATS
     * ========================================================================
     * 
     * Get trigger statistics for a company (for UI display).
     */
    static async getStats(companyId, trade = '_default') {
        const mission = await this.getMissionTriggers(companyId, trade);
        
        const stats = {};
        for (const flowType of Object.keys(mission)) {
            stats[flowType] = {
                auto: mission[flowType].auto?.length || 0,
                manual: mission[flowType].manual?.length || 0,
                total: mission[flowType].all?.length || 0
            };
        }
        
        return stats;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = MissionCacheService;
module.exports.FLOW_PRIORITY = FLOW_PRIORITY;
module.exports.ACTION_TO_FLOW_MAP = ACTION_TO_FLOW_MAP;


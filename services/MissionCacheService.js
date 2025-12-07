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
// CRITICAL: Only map actions that indicate BOOKING INTENT
// Troubleshooting/service keywords should NOT be booking triggers!
const ACTION_TO_FLOW_MAP = {
    // Booking flows - ONLY explicit booking actions
    'BOOK': 'booking',
    'BOOK_APPOINTMENT': 'booking',
    'SCHEDULE': 'booking',
    'SCHEDULE_APPOINTMENT': 'booking',
    
    // NOTE: DIRECT_TO_3TIER, EXPLAIN_AND_PUSH are NOT booking!
    // They route to troubleshooting/triage, not booking flow.
    // Do NOT include them here - they go to GENERAL_INQUIRY.
    
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
    
    // Cancel/Reschedule
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
 * Create empty mission structure with UNIVERSAL default triggers
 * These are intent phrases that work across ALL industries
 */
function createEmptyMission() {
    return {
        booking: { 
            auto: [
                // Universal booking intent triggers
                'schedule', 'appointment', 'book', 'booking', 'schedule a technician',
                'schedule service', 'make an appointment', 'set up an appointment',
                'need someone to come out', 'send someone out', 'get someone out here',
                'schedule a visit', 'book a time', 'when can you come', 'available times',
                'next available', 'earliest appointment', 'schedule for today', 'schedule for tomorrow',
                // Service/repair triggers (HVAC, Plumbing, etc.)
                'service', 'repair', 'fix', 'need service', 'need repair', 'need a repair',
                'need help with', 'looking for service', 'looking to get', 'need a technician',
                'technician', 'come out', 'send a tech', 'get a tech', 'need someone',
                // AC/HVAC specific (very common)
                'ac service', 'ac repair', 'a c service', 'a c repair', 'air conditioning',
                'heating', 'hvac', 'furnace', 'air conditioner'
            ], 
            manual: [], 
            sources: {} 
        },
        emergency: { 
            auto: [
                // Universal emergency triggers
                'emergency', 'urgent', 'right now', 'immediately', 'asap',
                'gas leak', 'flooding', 'no heat', 'no ac', 'no air', 'no power',
                'water everywhere', 'smell gas', 'sparking', 'smoke', 'fire'
            ], 
            manual: [], 
            sources: {} 
        },
        cancel: { 
            auto: [
                'cancel', 'cancel my appointment', 'cancel the appointment',
                'need to cancel', 'want to cancel', 'canceling', 'cancellation'
            ], 
            manual: [], 
            sources: {} 
        },
        reschedule: { 
            auto: [
                'reschedule', 'move my appointment', 'change my appointment',
                'different time', 'different day', 'move it to', 'change the time',
                'push back', 'push it back', 'postpone'
            ], 
            manual: [], 
            sources: {} 
        },
        transfer: { 
            auto: [
                'speak to someone', 'speak to a person', 'talk to someone',
                'talk to a human', 'real person', 'live person', 'manager',
                'supervisor', 'representative', 'agent', 'operator'
            ], 
            manual: [], 
            sources: {} 
        },
        message: { 
            auto: [
                'leave a message', 'take a message', 'message for',
                'have someone call me', 'call me back', 'callback',
                'just wanted to leave', 'let them know'
            ], 
            manual: [], 
            sources: {} 
        }
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
     * @param {object} options - Optional settings { returnReport: boolean }
     * @returns {object} The rebuilt mission triggers (or detailed report if returnReport=true)
     */
    static async rebuildMissionCache(companyId, trade = '_default', options = {}) {
        const startTime = Date.now();
        const { returnReport = false } = options;
        
        logger.info(`[MISSION CACHE] 🔄 Rebuilding cache for company ${companyId}, trade: ${trade}`);
        
        // ====================================================================
        // SYNC REPORT - Track what we find for admin feedback
        // ====================================================================
        const syncReport = {
            triageCardsScanned: 0,
            scenariosScanned: 0,
            extracted: {
                booking: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 },
                emergency: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 },
                cancel: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 },
                reschedule: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 },
                transfer: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 },
                message: { fromTriage: 0, fromScenarios: 0, fromDefaults: 0 }
            },
            totals: {},
            newTriggersFound: 0,
            sources: {}
        };
        
        try {
            // Load all data in parallel
            const [triageCards, scenarios, company] = await Promise.all([
                TriageCard ? TriageCard.find({ companyId, isActive: { $ne: false } }).lean() : [],
                Scenario ? Scenario.find({ companyId, isActive: { $ne: false } }).lean() : [],
                Company ? Company.findById(companyId).lean() : null
            ]);
            
            syncReport.triageCardsScanned = triageCards.length;
            syncReport.scenariosScanned = scenarios.length;
            
            logger.debug(`[MISSION CACHE] Loaded: ${triageCards.length} triage cards, ${scenarios.length} scenarios`);
            
            // Initialize mission structure (with universal defaults)
            const mission = createEmptyMission();
            
            // Count default triggers
            for (const flowType of Object.keys(mission)) {
                syncReport.extracted[flowType].fromDefaults = mission[flowType].auto.length;
            }
            
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
                    
                    // Track for sync report
                    syncReport.extracted[flowType].fromTriage += keywords.length;
                    
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
                    else if (nameLower.includes('book') || nameLower.includes('schedul') || nameLower.includes('appointment')) flowType = 'booking';
                    // NOTE: Do NOT default to booking! Service/troubleshooting scenarios 
                    // should go to GENERAL_INQUIRY (triage), not booking flow.
                    // flowType remains null → skipped
                }
                
                if (flowType && mission[flowType] && triggers.length > 0) {
                    mission[flowType].auto.push(...triggers);
                    
                    // Track for sync report
                    syncReport.extracted[flowType].fromScenarios += triggers.length;
                    
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
            
            // Build final totals for sync report
            for (const flowType of Object.keys(finalMission)) {
                syncReport.totals[flowType] = finalMission[flowType].all.length;
                syncReport.sources[flowType] = {
                    defaults: syncReport.extracted[flowType].fromDefaults,
                    triage: syncReport.extracted[flowType].fromTriage,
                    scenarios: syncReport.extracted[flowType].fromScenarios,
                    total: finalMission[flowType].all.length
                };
            }
            
            // Calculate total new triggers found (from triage + scenarios)
            syncReport.newTriggersFound = Object.keys(syncReport.extracted).reduce((sum, flowType) => {
                return sum + syncReport.extracted[flowType].fromTriage + syncReport.extracted[flowType].fromScenarios;
            }, 0);
            
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
                },
                newFromTriage: Object.values(syncReport.extracted).reduce((s, e) => s + e.fromTriage, 0),
                newFromScenarios: Object.values(syncReport.extracted).reduce((s, e) => s + e.fromScenarios, 0)
            });
            
            // Return detailed report if requested (for UI feedback)
            if (returnReport) {
                return {
                    missionTriggers: finalMission,
                    ...syncReport,
                    rebuildDurationMs: duration
                };
            }
            
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


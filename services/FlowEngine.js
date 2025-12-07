/**
 * ============================================================================
 * FLOW ENGINE
 * ============================================================================
 * 
 * THE DECISION MAKER
 * 
 * This service determines which flow a caller should be routed to based on
 * their input. It is the "brain" that makes routing decisions - the LLM is
 * only the "mouth" that speaks.
 * 
 * FLOW PRIORITY (highest to lowest):
 * 1. EMERGENCY     - "no heat", "gas leak", "flooding"
 * 2. CANCEL        - "cancel my appointment"
 * 3. RESCHEDULE    - "move my appointment", "reschedule"
 * 4. TRANSFER      - "speak to a person", "manager"
 * 5. BOOKING       - "service", "schedule", "appointment"
 * 6. MESSAGE       - "leave a message", "have someone call"
 * 7. GENERAL_INQUIRY - Everything else (goes to triage/3-tier)
 * 
 * KEY FEATURES:
 * - Priority-based matching (emergency always wins over booking)
 * - Blocker support (negative triggers prevent false matches)
 * - Multi-intent detection (logs secondary intents)
 * - Synonym normalization (uses company's synonym map)
 * - Trade-aware (can use trade-specific triggers)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const MissionCacheService = require('./MissionCacheService');
const { FLOW_PRIORITY } = require('./MissionCacheService');

// ============================================================================
// FLOW TYPES
// ============================================================================

const FLOW_TYPES = {
    EMERGENCY: 'EMERGENCY',
    CANCEL: 'CANCEL',
    RESCHEDULE: 'RESCHEDULE',
    TRANSFER: 'TRANSFER',
    BOOKING: 'BOOKING',
    MESSAGE: 'MESSAGE',
    GENERAL_INQUIRY: 'GENERAL_INQUIRY'
};

// Default blockers that prevent flow activation
const DEFAULT_BLOCKERS = {
    cancel: ["don't cancel", "not cancel", "dont cancel", "do not cancel", "don't want to cancel"],
    reschedule: ["don't reschedule", "not reschedule", "dont reschedule"],
    emergency: ["not an emergency", "not emergency", "isn't an emergency"],
    transfer: ["don't transfer", "don't need to speak", "no need to speak"]
};

// ============================================================================
// MAIN ENGINE
// ============================================================================

class FlowEngine {
    
    /**
     * ========================================================================
     * DECIDE FLOW
     * ========================================================================
     * 
     * Main entry point. Determines which flow to route the caller to.
     * 
     * @param {string} text - The caller's utterance
     * @param {string} companyId - Company ID for loading triggers
     * @param {object} options - Additional options
     * @param {string} options.trade - Trade filter (e.g., 'hvac')
     * @param {object} options.synonymMap - Synonym replacements
     * @param {object} options.customBlockers - Additional blockers
     * @param {object} options.callState - Current call state (for context)
     * 
     * @returns {object} Decision result:
     *   {
     *     flow: 'BOOKING' | 'EMERGENCY' | etc.,
     *     confidence: number (0-1),
     *     matchedTriggers: string[],
     *     secondaryIntents: string[],
     *     blockedFlows: string[],
     *     normalizedText: string,
     *     meta: { ... }
     *   }
     */
    static async decideFlow(text, companyId, options = {}) {
        const startTime = Date.now();
        const {
            trade = '_default',
            synonymMap = {},
            customBlockers = {},
            callState = {}
        } = options;
        
        logger.debug(`[FLOW ENGINE] 🎯 Deciding flow for: "${text.substring(0, 50)}..."`);
        
        // 1. Normalize text
        let normalizedText = this.normalizeText(text);
        
        // 2. Apply synonyms
        normalizedText = this.applySynonyms(normalizedText, synonymMap);
        
        // 3. Get mission triggers
        const missionTriggers = await MissionCacheService.getMissionTriggers(companyId, trade);
        
        // 4. Merge blockers
        const blockers = this.mergeBlockers(DEFAULT_BLOCKERS, customBlockers);
        
        // 5. Score each flow
        const scores = this.scoreFlows(normalizedText, missionTriggers, blockers);
        
        // 6. Apply priority and select winner
        const decision = this.selectWinner(scores);
        
        const duration = Date.now() - startTime;
        
        logger.info(`[FLOW ENGINE] ✅ Decision: ${decision.flow} (${decision.confidence.toFixed(2)}) in ${duration}ms`, {
            matchedTriggers: decision.matchedTriggers,
            secondaryIntents: decision.secondaryIntents,
            blockedFlows: decision.blockedFlows
        });
        
        return {
            ...decision,
            normalizedText,
            meta: {
                duration,
                trade,
                companyId,
                originalText: text
            }
        };
    }
    
    /**
     * ========================================================================
     * NORMALIZE TEXT
     * ========================================================================
     * 
     * Clean and normalize input text for consistent matching.
     */
    static normalizeText(text) {
        if (!text || typeof text !== 'string') return '';
        
        return text
            .toLowerCase()
            .replace(/[^\w\s']/g, ' ')  // Remove punctuation except apostrophes
            .replace(/\s+/g, ' ')        // Collapse whitespace
            .trim();
    }
    
    /**
     * ========================================================================
     * APPLY SYNONYMS
     * ========================================================================
     * 
     * Replace synonyms with canonical terms for better matching.
     * 
     * Example: "move my appointment" → "reschedule my appointment"
     */
    static applySynonyms(text, synonymMap) {
        if (!synonymMap || typeof synonymMap !== 'object') return text;
        
        let result = text;
        
        for (const [canonical, synonyms] of Object.entries(synonymMap)) {
            if (!Array.isArray(synonyms)) continue;
            
            for (const synonym of synonyms) {
                const regex = new RegExp(`\\b${this.escapeRegex(synonym)}\\b`, 'gi');
                result = result.replace(regex, canonical);
            }
        }
        
        return result;
    }
    
    /**
     * ========================================================================
     * SCORE FLOWS
     * ========================================================================
     * 
     * Score each flow based on trigger matches and blockers.
     */
    static scoreFlows(text, missionTriggers, blockers) {
        const scores = {};
        
        for (const flowType of FLOW_PRIORITY) {
            const triggers = missionTriggers[flowType]?.all || [];
            const flowBlockers = blockers[flowType] || [];
            
            // Check for blockers first
            const blocked = flowBlockers.some(blocker => text.includes(blocker.toLowerCase()));
            
            if (blocked) {
                scores[flowType] = {
                    score: 0,
                    blocked: true,
                    matchedTriggers: [],
                    blockerMatched: flowBlockers.find(b => text.includes(b.toLowerCase()))
                };
                continue;
            }
            
            // Count trigger matches
            const matchedTriggers = triggers.filter(trigger => 
                text.includes(trigger.toLowerCase())
            );
            
            // Score based on matches (more matches = higher confidence)
            // Also give bonus for longer/more specific matches
            let score = 0;
            for (const match of matchedTriggers) {
                // Base score + length bonus
                score += 1 + (match.length / 20);
            }
            
            scores[flowType] = {
                score,
                blocked: false,
                matchedTriggers
            };
        }
        
        return scores;
    }
    
    /**
     * ========================================================================
     * SELECT WINNER
     * ========================================================================
     * 
     * Select the winning flow based on scores and priority.
     */
    static selectWinner(scores) {
        let bestFlow = FLOW_TYPES.GENERAL_INQUIRY;
        let bestScore = 0;
        const matchedTriggers = [];
        const secondaryIntents = [];
        const blockedFlows = [];
        
        // Check flows in priority order
        for (const flowType of FLOW_PRIORITY) {
            const flowScore = scores[flowType];
            
            if (flowScore.blocked) {
                blockedFlows.push({
                    flow: flowType.toUpperCase(),
                    blocker: flowScore.blockerMatched
                });
                continue;
            }
            
            if (flowScore.score > 0) {
                if (flowScore.score > bestScore) {
                    // New best - demote previous best to secondary
                    if (bestScore > 0) {
                        secondaryIntents.push(bestFlow);
                    }
                    
                    bestFlow = flowType.toUpperCase();
                    bestScore = flowScore.score;
                    matchedTriggers.length = 0;
                    matchedTriggers.push(...flowScore.matchedTriggers);
                } else if (flowScore.score === bestScore) {
                    // Tie - priority order wins (first in FLOW_PRIORITY)
                    secondaryIntents.push(flowType.toUpperCase());
                } else {
                    // Lower score - add to secondary if significant
                    if (flowScore.score > 0) {
                        secondaryIntents.push(flowType.toUpperCase());
                    }
                }
            }
        }
        
        // Calculate confidence (0-1)
        // Higher score = higher confidence, capped at 1
        const confidence = Math.min(1, bestScore / 3);
        
        return {
            flow: bestFlow,
            confidence,
            matchedTriggers,
            secondaryIntents: [...new Set(secondaryIntents)],
            blockedFlows
        };
    }
    
    /**
     * ========================================================================
     * MERGE BLOCKERS
     * ========================================================================
     */
    static mergeBlockers(defaults, custom) {
        const merged = { ...defaults };
        
        for (const [flowType, blockerList] of Object.entries(custom)) {
            if (Array.isArray(blockerList)) {
                merged[flowType] = [...(merged[flowType] || []), ...blockerList];
            }
        }
        
        return merged;
    }
    
    /**
     * ========================================================================
     * ESCAPE REGEX
     * ========================================================================
     */
    static escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    /**
     * ========================================================================
     * TEST SENTENCE (For UI Debugger)
     * ========================================================================
     * 
     * Test a sentence against the flow engine without affecting call state.
     * Returns detailed debug info for the UI.
     * 
     * @param {string} text - Test sentence
     * @param {string} companyId - Company ID
     * @param {object} options - Same as decideFlow
     * @returns {object} Detailed test result
     */
    static async testSentence(text, companyId, options = {}) {
        const decision = await this.decideFlow(text, companyId, options);
        const missionTriggers = await MissionCacheService.getMissionTriggers(companyId, options.trade);
        
        // Get sources for matched triggers
        const triggerSources = [];
        for (const trigger of decision.matchedTriggers) {
            const source = await MissionCacheService.getTriggerSource(companyId, trigger, options.trade);
            if (source) {
                triggerSources.push({
                    trigger,
                    ...source
                });
            }
        }
        
        return {
            input: text,
            normalizedInput: decision.normalizedText,
            decision: {
                flow: decision.flow,
                confidence: decision.confidence,
                confidencePercent: Math.round(decision.confidence * 100)
            },
            matchedTriggers: triggerSources,
            secondaryIntents: decision.secondaryIntents,
            blockedFlows: decision.blockedFlows,
            allTriggerCounts: {
                booking: missionTriggers.booking?.all?.length || 0,
                emergency: missionTriggers.emergency?.all?.length || 0,
                cancel: missionTriggers.cancel?.all?.length || 0,
                reschedule: missionTriggers.reschedule?.all?.length || 0,
                transfer: missionTriggers.transfer?.all?.length || 0,
                message: missionTriggers.message?.all?.length || 0
            },
            meta: decision.meta
        };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = FlowEngine;
module.exports.FLOW_TYPES = FLOW_TYPES;
module.exports.DEFAULT_BLOCKERS = DEFAULT_BLOCKERS;


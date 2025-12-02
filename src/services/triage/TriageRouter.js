/**
 * ============================================================================
 * TRIAGE ROUTER - Routes Brain-1 Decisions to Handlers
 * ============================================================================
 * 
 * POSITION: Between Brain-1 and Brain-2 (and other handlers)
 * 
 * Given the decision.action and triageTag from Brain-1, decide what to do:
 * - 'SCENARIO_ENGINE' → Call Brain-2 (AIBrain3tierllm)
 * - 'TRANSFER' → Transfer Handler
 * - 'MESSAGE_ONLY' → Just speak, no further routing
 * - 'BOOKING_FLOW' → Booking Handler
 * - 'END_CALL' → End the call
 * 
 * Also matches against TriageCards in the database for advanced routing.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const TriageCard = require('../../../models/TriageCard');

/**
 * @typedef {Object} TriageResult
 * @property {'SCENARIO_ENGINE'|'TRANSFER'|'MESSAGE_ONLY'|'BOOKING_FLOW'|'END_CALL'} route
 * @property {string|null} matchedCardId
 * @property {string|null} matchedCardName
 * @property {string|null} scenarioHint - Hint for Brain-2 scenario matching
 * @property {Object|null} transferConfig - Transfer configuration if TRANSFER
 * @property {string} reason - Why this route was chosen
 */

/**
 * Route a Brain-1 decision to the appropriate handler
 * 
 * @param {Object} decision - Brain-1 decision
 * @param {string} decision.action - ROUTE_TO_SCENARIO, TRANSFER, BOOK, ASK_FOLLOWUP, MESSAGE_ONLY, END
 * @param {string} decision.triageTag - e.g. 'SMELL_OF_GAS', 'NO_COOL'
 * @param {string} decision.intentTag - e.g. 'emergency', 'booking'
 * @param {Object} decision.flags - flags like needsKnowledgeSearch
 * @param {Object} company - Company document
 * @returns {Promise<TriageResult>}
 */
async function route(decision, company) {
    const companyId = company?._id?.toString();
    const startTime = Date.now();
    
    logger.debug('[TRIAGE] Routing decision', {
        companyId,
        action: decision.action,
        triageTag: decision.triageTag,
        intentTag: decision.intentTag
    });
    
    // ========================================================================
    // PRIORITY 1: Emergency flags override everything
    // ========================================================================
    if (decision.flags?.isEmergency) {
        return {
            route: 'TRANSFER',
            matchedCardId: null,
            matchedCardName: 'EMERGENCY_OVERRIDE',
            scenarioHint: null,
            transferConfig: { type: 'emergency', priority: 'high' },
            reason: 'Emergency flag detected - immediate transfer'
        };
    }
    
    // ========================================================================
    // PRIORITY 2: Direct action mapping
    // ========================================================================
    const actionRouteMap = {
        'ROUTE_TO_SCENARIO': 'SCENARIO_ENGINE',
        'TRANSFER': 'TRANSFER',
        'BOOK': 'BOOKING_FLOW',
        'ASK_FOLLOWUP': 'MESSAGE_ONLY',
        'MESSAGE_ONLY': 'MESSAGE_ONLY',
        'ROUTE_TO_VENDOR': 'VENDOR_HANDLING',
        'END': 'END_CALL'
    };
    
    // If action clearly maps to a route, use it
    if (actionRouteMap[decision.action] && decision.action !== 'ROUTE_TO_SCENARIO') {
        return {
            route: actionRouteMap[decision.action],
            matchedCardId: null,
            matchedCardName: null,
            scenarioHint: decision.triageTag,
            transferConfig: decision.action === 'TRANSFER' ? { type: 'standard' } : null,
            reason: `Direct action mapping: ${decision.action}`
        };
    }
    
    // ========================================================================
    // PRIORITY 3: Match against Triage Cards (for ROUTE_TO_SCENARIO)
    // ========================================================================
    if (decision.action === 'ROUTE_TO_SCENARIO' && companyId) {
        try {
            const triageCard = await matchTriageCard(decision, companyId);
            
            if (triageCard) {
                const cardRoute = cardActionToRoute(triageCard.quickRuleConfig?.action);
                
                logger.info('[TRIAGE] Matched triage card', {
                    companyId,
                    cardName: triageCard.displayName || triageCard.triageLabel,
                    cardAction: triageCard.quickRuleConfig?.action,
                    route: cardRoute
                });
                
                return {
                    route: cardRoute,
                    matchedCardId: triageCard._id.toString(),
                    matchedCardName: triageCard.displayName || triageCard.triageLabel,
                    scenarioHint: triageCard.linkedScenario?.scenarioKey || decision.triageTag,
                    transferConfig: cardRoute === 'TRANSFER' ? triageCard.actionPlaybooks?.escalateToHuman : null,
                    reason: `Matched triage card: ${triageCard.displayName || triageCard.triageLabel}`
                };
            }
        } catch (error) {
            logger.error('[TRIAGE] Error matching triage cards', {
                companyId,
                error: error.message
            });
        }
    }
    
    // ========================================================================
    // PRIORITY 4: Default to SCENARIO_ENGINE for knowledge searches
    // ========================================================================
    if (decision.action === 'ROUTE_TO_SCENARIO' || decision.flags?.needsKnowledgeSearch) {
        return {
            route: 'SCENARIO_ENGINE',
            matchedCardId: null,
            matchedCardName: null,
            scenarioHint: decision.triageTag,
            transferConfig: null,
            reason: 'Default routing to scenario engine for knowledge search'
        };
    }
    
    // ========================================================================
    // FALLBACK: MESSAGE_ONLY
    // ========================================================================
    return {
        route: 'MESSAGE_ONLY',
        matchedCardId: null,
        matchedCardName: null,
        scenarioHint: null,
        transferConfig: null,
        reason: 'Fallback to message only'
    };
}

/**
 * Match Brain-1 decision against triage cards
 */
async function matchTriageCard(decision, companyId) {
    // Load active triage cards sorted by priority
    const cards = await TriageCard.find({
        companyId,
        isActive: true
    }).sort({ priority: -1 }).lean();
    
    if (!cards.length) {
        return null;
    }
    
    const triageTag = decision.triageTag?.toLowerCase() || '';
    const intentTag = decision.intentTag?.toLowerCase() || '';
    
    // Try exact triageTag match first
    for (const card of cards) {
        if (card.triageLabel?.toLowerCase() === triageTag) {
            return card;
        }
    }
    
    // Try keyword matching
    for (const card of cards) {
        const mustHave = card.quickRuleConfig?.keywordsMustHave || [];
        const exclude = card.quickRuleConfig?.keywordsExclude || [];
        
        // Skip if any exclusion matches
        if (exclude.some(kw => triageTag.includes(kw.toLowerCase()) || intentTag.includes(kw.toLowerCase()))) {
            continue;
        }
        
        // Check if any must-have keyword matches
        if (mustHave.length > 0) {
            const hasMatch = mustHave.some(kw => 
                triageTag.includes(kw.toLowerCase()) || intentTag.includes(kw.toLowerCase())
            );
            if (hasMatch) {
                return card;
            }
        }
    }
    
    return null;
}

/**
 * Convert triage card action to route type
 */
function cardActionToRoute(cardAction) {
    const cardRouteMap = {
        'DIRECT_TO_3TIER': 'SCENARIO_ENGINE',
        'EXPLAIN_AND_PUSH': 'SCENARIO_ENGINE',
        'ESCALATE_TO_HUMAN': 'TRANSFER',
        'TAKE_MESSAGE': 'MESSAGE_ONLY',
        'END_CALL_POLITE': 'END_CALL'
    };
    
    return cardRouteMap[cardAction] || 'SCENARIO_ENGINE';
}

module.exports = {
    route
};


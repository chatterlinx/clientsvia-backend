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
            openingLine: null, // Emergency = go straight to transfer
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
            openingLine: null, // Direct action = no triage card opening line
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
                
                // ════════════════════════════════════════════════════════════
                // STANDARDIZED OPENING LINE EXTRACTION
                // openingLine is metadata ONLY - spoken by ResponseConstructor
                // on first turn of this scenario. NEVER spoken directly here.
                // 
                // Sources (in priority order):
                // 1. frontlinePlaybook.openingLines[0] - explicit opening
                // 2. actionPlaybooks.explainAndPush.explanationLines[0] - for push actions
                // 3. actionPlaybooks.escalateToHuman.preTransferLines[0] - for transfers
                // 4. quickRuleConfig.explanation - fallback explanation
                // ════════════════════════════════════════════════════════════
                const openingLine = extractOpeningLine(triageCard, cardRoute);
                
                logger.info('[TRIAGE] Matched triage card', {
                    companyId,
                    cardName: triageCard.displayName || triageCard.triageLabel,
                    cardAction: triageCard.quickRuleConfig?.action,
                    route: cardRoute,
                    hasOpeningLine: !!openingLine,
                    openingLineSource: openingLine ? 'extracted' : 'none'
                });
                
                return {
                    route: cardRoute,
                    matchedCardId: triageCard._id.toString(),
                    matchedCardName: triageCard.displayName || triageCard.triageLabel,
                    scenarioHint: triageCard.linkedScenario?.scenarioKey || decision.triageTag,
                    transferConfig: cardRoute === 'TRANSFER' ? triageCard.actionPlaybooks?.escalateToHuman : null,
                    openingLine, // Metadata for ResponseConstructor - NEVER spoken directly
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
            openingLine: null, // No card match = no opening line
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
        openingLine: null,
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

/**
 * ============================================================================
 * STANDARDIZED OPENING LINE EXTRACTION
 * ============================================================================
 * Extract the appropriate opening line from a triage card based on route type.
 * This is METADATA ONLY - ResponseConstructor speaks it, not TriageRouter.
 * 
 * @param {Object} triageCard - Full triage card document
 * @param {string} cardRoute - The determined route type
 * @returns {string|null} - Opening line or null
 */
function extractOpeningLine(triageCard, cardRoute) {
    if (!triageCard) return null;
    
    // Priority 1: Explicit frontline opening lines
    const frontlineOpening = triageCard.frontlinePlaybook?.openingLines?.[0];
    if (frontlineOpening && frontlineOpening.trim()) {
        return frontlineOpening.trim();
    }
    
    // Priority 2: Route-specific playbook lines
    const actionPlaybooks = triageCard.actionPlaybooks || {};
    
    switch (cardRoute) {
        case 'TRANSFER':
            // Use pre-transfer line for escalation
            const preTransfer = actionPlaybooks.escalateToHuman?.preTransferLines?.[0];
            if (preTransfer && preTransfer.trim()) {
                return preTransfer.trim();
            }
            break;
            
        case 'SCENARIO_ENGINE':
            // Use explain-and-push explanation for scenario routes
            const explanation = actionPlaybooks.explainAndPush?.explanationLines?.[0];
            if (explanation && explanation.trim()) {
                return explanation.trim();
            }
            break;
            
        case 'MESSAGE_ONLY':
            // Use take-message intro
            const intro = actionPlaybooks.takeMessage?.introLines?.[0];
            if (intro && intro.trim()) {
                return intro.trim();
            }
            break;
            
        case 'END_CALL':
            // Use end-call closing
            const closing = actionPlaybooks.endCallPolite?.closingLines?.[0];
            if (closing && closing.trim()) {
                return closing.trim();
            }
            break;
    }
    
    // Priority 3: Generic explanation from quickRuleConfig
    const genericExplanation = triageCard.quickRuleConfig?.explanation;
    if (genericExplanation && genericExplanation.trim()) {
        return genericExplanation.trim();
    }
    
    // Priority 4: Frontline goal as last resort
    const frontlineGoal = triageCard.frontlinePlaybook?.frontlineGoal;
    if (frontlineGoal && frontlineGoal.trim() && frontlineGoal.length < 100) {
        // Only use if it's short enough to be spoken
        return frontlineGoal.trim();
    }
    
    return null;
}

module.exports = {
    route,
    extractOpeningLine // Exported for testing/reuse
};


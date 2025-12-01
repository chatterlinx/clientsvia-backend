/**
 * ============================================================================
 * TRIAGE ROUTER - Routing Source of Truth
 * ============================================================================
 * 
 * POSITION IN ARCHITECTURE:
 *   Brain 1 (LLM-0) → [TRIAGE ROUTER] → Brain 2 (3-Tier)
 * 
 * This is the routing layer between LLM-0 and the scenario engine.
 * It reads from the "Triage Cards" tab in the Control Plane to determine
 * where each turn should go.
 * 
 * ROUTES:
 * - SCENARIO_ENGINE: Route to 3-Tier (Brain 2) for scenario matching
 * - BOOKING: Route to booking handler
 * - TRANSFER: Route to transfer handler (human escalation)
 * - MESSAGE_ONLY: Just speak the message, no further routing
 * - END_CALL: End the call politely
 * - UNKNOWN: Fallback (usually goes to SCENARIO_ENGINE)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const TriageCard = require('../models/TriageCard');

/**
 * Route types that this router can return
 * @typedef {'SCENARIO_ENGINE'|'BOOKING'|'TRANSFER'|'MESSAGE_ONLY'|'END_CALL'|'UNKNOWN'} RouteType
 */

/**
 * @typedef {Object} TriageResult
 * @property {RouteType} route - Where to route this turn
 * @property {string|null} matchedCardId - ID of the matched triage card (if any)
 * @property {string|null} matchedCardName - Name of the matched triage card
 * @property {string|null} scenarioKey - Hint for scenario matching (if routed to SCENARIO_ENGINE)
 * @property {string|null} categoryKey - Hint for category (if routed to SCENARIO_ENGINE)
 * @property {Object|null} transferTarget - Target for transfer (if routed to TRANSFER)
 * @property {string} reason - Why this route was chosen
 */

class TriageRouter {
    
    /**
     * Route an LLM-0 decision to the appropriate handler
     * 
     * @param {import('./orchestration/LLM0Contracts').LLM0Decision} decision - LLM-0's decision
     * @param {Object} company - Company document
     * @returns {Promise<TriageResult>}
     */
    static async route(decision, company) {
        const startTime = Date.now();
        const companyId = company._id?.toString() || company.companyId;
        
        logger.info('[TRIAGE ROUTER] Routing decision', {
            companyId,
            action: decision.action,
            intentTag: decision.intentTag,
            flags: decision.flags
        });
        
        // ====================================================================
        // PRIORITY 1: Check flags first (these override intent-based routing)
        // ====================================================================
        
        // Emergency or frustrated caller → Transfer immediately
        if (decision.flags.isEmergency) {
            return {
                route: 'TRANSFER',
                matchedCardId: null,
                matchedCardName: 'EMERGENCY_OVERRIDE',
                scenarioKey: null,
                categoryKey: null,
                transferTarget: { type: 'emergency', priority: 'high' },
                reason: 'Emergency flag detected - immediate transfer'
            };
        }
        
        // Spam or wrong number → End call
        if (decision.flags.isSpam || decision.flags.isWrongNumber) {
            return {
                route: 'END_CALL',
                matchedCardId: null,
                matchedCardName: 'SPAM_OR_WRONG_NUMBER',
                scenarioKey: null,
                categoryKey: null,
                transferTarget: null,
                reason: decision.flags.isSpam ? 'Spam detected' : 'Wrong number detected'
            };
        }
        
        // ====================================================================
        // PRIORITY 2: Match against Triage Cards from database
        // ====================================================================
        
        try {
            const triageCard = await this.matchTriageCard(decision, companyId);
            
            if (triageCard) {
                const route = this.cardActionToRoute(triageCard.quickRuleConfig?.action);
                
                logger.info('[TRIAGE ROUTER] Matched triage card', {
                    companyId,
                    cardId: triageCard._id,
                    cardName: triageCard.displayName || triageCard.triageLabel,
                    action: triageCard.quickRuleConfig?.action,
                    route
                });
                
                return {
                    route,
                    matchedCardId: triageCard._id.toString(),
                    matchedCardName: triageCard.displayName || triageCard.triageLabel,
                    scenarioKey: triageCard.threeTierLink?.scenarioKey || null,
                    categoryKey: triageCard.threeTierLink?.categoryKey || null,
                    transferTarget: triageCard.transferConfig || null,
                    reason: `Matched triage card: ${triageCard.displayName || triageCard.triageLabel}`
                };
            }
        } catch (error) {
            logger.error('[TRIAGE ROUTER] Error matching triage cards', {
                companyId,
                error: error.message
            });
            // Continue to action-based routing
        }
        
        // ====================================================================
        // PRIORITY 3: Route based on LLM-0 action code
        // ====================================================================
        
        const actionRoute = this.actionToRoute(decision.action);
        
        return {
            route: actionRoute,
            matchedCardId: null,
            matchedCardName: null,
            scenarioKey: decision.scenarioHints?.scenarioKey || null,
            categoryKey: decision.scenarioHints?.categoryKey || null,
            transferTarget: decision.action === 'TRANSFER_CALL' ? { type: 'human' } : null,
            reason: `Routed based on LLM-0 action: ${decision.action}`
        };
    }
    
    /**
     * Match LLM-0 decision against triage cards
     * @private
     */
    static async matchTriageCard(decision, companyId) {
        // Load active triage cards sorted by priority
        const cards = await TriageCard.find({
            companyId,
            active: true
        }).sort({ priority: -1 }).lean();
        
        if (!cards.length) {
            logger.debug('[TRIAGE ROUTER] No active triage cards for company', { companyId });
            return null;
        }
        
        // Try to match by intent tag first
        const intentTag = decision.intentTag?.toLowerCase();
        
        for (const card of cards) {
            const mustHave = card.quickRuleConfig?.keywordsMustHave || [];
            const exclude = card.quickRuleConfig?.keywordsExclude || [];
            
            // Check exclusions first
            if (exclude.some(kw => intentTag?.includes(kw.toLowerCase()))) {
                continue;
            }
            
            // Check must-have keywords
            if (mustHave.length === 0) {
                continue; // Skip cards with no keywords
            }
            
            const matches = mustHave.some(kw => intentTag?.includes(kw.toLowerCase()));
            
            if (matches) {
                return card;
            }
        }
        
        // No match found
        return null;
    }
    
    /**
     * Convert LLM-0 action to route type
     * @private
     */
    static actionToRoute(action) {
        const actionRouteMap = {
            'RUN_SCENARIO': 'SCENARIO_ENGINE',
            'BOOK_APPOINTMENT': 'BOOKING',
            'TRANSFER_CALL': 'TRANSFER',
            'ASK_QUESTION': 'MESSAGE_ONLY',
            'MESSAGE_ONLY': 'MESSAGE_ONLY',
            'END_CALL': 'END_CALL',
            'UNKNOWN': 'SCENARIO_ENGINE' // Default to scenario engine
        };
        
        return actionRouteMap[action] || 'SCENARIO_ENGINE';
    }
    
    /**
     * Convert triage card action to route type
     * @private
     */
    static cardActionToRoute(cardAction) {
        const cardRouteMap = {
            'DIRECT_TO_3TIER': 'SCENARIO_ENGINE',
            'ESCALATE_TO_HUMAN': 'TRANSFER',
            'BOOK_APPOINTMENT': 'BOOKING',
            'TAKE_MESSAGE': 'MESSAGE_ONLY',
            'END_CALL_POLITE': 'END_CALL',
            'EXPLAIN_AND_PUSH': 'SCENARIO_ENGINE'
        };
        
        return cardRouteMap[cardAction] || 'SCENARIO_ENGINE';
    }
}

module.exports = TriageRouter;


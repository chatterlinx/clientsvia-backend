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

// ═══════════════════════════════════════════════════════════════════════════
// 📼 BLACK BOX RECORDER - Enterprise Call Flight Recorder
// ═══════════════════════════════════════════════════════════════════════════
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../../services/BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL TAG NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL: Use this function on BOTH sides of any tag comparison.
// This ensures "NO_COOL", "no-cool", "No Cool", "no  cool" all become "NO_COOL"
// ═══════════════════════════════════════════════════════════════════════════
function normalizeTag(raw) {
    if (!raw) return null;
    return String(raw)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')   // everything non-alphanumeric → underscore
        .replace(/^_+|_+$/g, '');      // trim leading/trailing underscores
}

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
 * @param {Object} options - Additional options
 * @param {string} options.callId - Call SID for logging
 * @param {number} options.turn - Turn number for logging
 * @returns {Promise<TriageResult>}
 */
async function route(decision, company, options = {}) {
    const companyId = company?._id?.toString();
    const startTime = Date.now();
    const { callId, turn } = options;
    
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
    
    // ========================================================================
    // PRIORITY 2.5: If we have a triageTag, look up the card for content
    // ========================================================================
    // FrontlineIntelEngine may have done a fast match and returned a triageTag.
    // We need to look up that card to get its response content (openingLine).
    // This applies to MESSAGE_ONLY, ASK_FOLLOWUP, and other quick actions.
    // ========================================================================
    if (decision.triageTag && companyId) {
        logger.info('[TRIAGE] 🔍 STEP 2.5: Looking for card by triageTag', {
            companyId,
            searchingFor: decision.triageTag,
            action: decision.action
        });
        
        try {
            const triageCard = await matchTriageCardByTag(decision.triageTag, companyId);
            
            if (triageCard) {
                const cardRoute = actionRouteMap[decision.action] || 
                                  cardActionToRoute(triageCard.quickRuleConfig?.action) ||
                                  'MESSAGE_ONLY';
                
                const openingLine = extractOpeningLine(triageCard, cardRoute);
                
                logger.info('[TRIAGE] ✅ Found card by triageTag', {
                    companyId,
                    triageTag: decision.triageTag,
                    cardId: triageCard._id.toString(),
                    cardName: triageCard.displayName || triageCard.triageLabel,
                    triageLabel: triageCard.triageLabel,
                    route: cardRoute,
                    hasOpeningLine: !!openingLine,
                    openingLinePreview: openingLine?.substring(0, 80)
                });
                
                const result = {
                    route: cardRoute,
                    matchedCardId: triageCard._id.toString(),
                    matchedCardName: triageCard.displayName || triageCard.triageLabel,
                    scenarioHint: triageCard.linkedScenario?.scenarioKey || decision.triageTag,
                    transferConfig: cardRoute === 'TRANSFER' ? triageCard.actionPlaybooks?.escalateToHuman : null,
                    openingLine, // Card's response content for ResponseConstructor
                    reason: `Matched triage card by tag: ${decision.triageTag}`
                };
                
                // 📼 BLACK BOX: Log triage decision
                if (BlackBoxLogger && callId) {
                    BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'TRIAGE_DECISION',
                        turn,
                        data: {
                            route: result.route,
                            matched: true,
                            cardId: result.matchedCardId,
                            cardName: result.matchedCardName,
                            triageTag: decision.triageTag,
                            intentTag: decision.intentTag,
                            source: 'TRIAGE_CARD_MATCH'
                        }
                    }).catch(() => {});
                }
                
                return result;
            } else {
                // ⚠️ NO MATCH - Log what we searched for vs what exists
                logger.warn('[TRIAGE] ⚠️ NO CARD FOUND for triageTag - will use fallback', {
                    companyId,
                    searchedFor: decision.triageTag,
                    action: decision.action,
                    hint: 'Run GET /api/company/:companyId/triage-cards/diagnose-content to see available cards'
                });
            }
        } catch (error) {
            logger.error('[TRIAGE] ❌ Error looking up card by triageTag', {
                companyId,
                triageTag: decision.triageTag,
                error: error.message,
                stack: error.stack
            });
        }
    }
    
    // If action clearly maps to a route but no card found, use generic
    if (actionRouteMap[decision.action] && decision.action !== 'ROUTE_TO_SCENARIO') {
        const directRoute = actionRouteMap[decision.action];
        
        // 📼 BLACK BOX: Log direct action mapping (no card match)
        if (BlackBoxLogger && callId) {
            BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'TRIAGE_DECISION',
                turn,
                data: {
                    route: directRoute,
                    matched: false,
                    cardId: null,
                    cardName: null,
                    triageTag: decision.triageTag,
                    intentTag: decision.intentTag,
                    action: decision.action,
                    source: 'DIRECT_ACTION_MAP'
                }
            }).catch(() => {});
        }
        
        return {
            route: directRoute,
            matchedCardId: null,
            matchedCardName: null,
            scenarioHint: decision.triageTag,
            transferConfig: decision.action === 'TRANSFER' ? { type: 'standard' } : null,
            openingLine: null, // No card = no opening line
            reason: `Direct action mapping (no card): ${decision.action}`
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
/**
 * Match a triage card by its triageLabel (tag)
 * Uses CANONICAL NORMALIZATION: "NO_COOL", "no-cool", "No Cool" all become "NO_COOL"
 * 
 * @param {string} triageTag - The card's triageLabel identifier from Brain-1
 * @param {string} companyId - Company ID
 * @returns {Promise<Object|null>} - Full triage card document or null
 */
async function matchTriageCardByTag(triageTag, companyId) {
    if (!triageTag || !companyId) {
        logger.warn('[TRIAGE MATCH] Missing triageTag or companyId', { triageTag, companyId });
        return null;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CANONICAL NORMALIZATION - Same rule on BOTH sides
    // "NO_COOL", "no-cool", "No Cool", "no  cool" → "NO_COOL"
    // ═══════════════════════════════════════════════════════════════════════
    const normalizedSearch = normalizeTag(triageTag);
    
    // Load ALL active cards for this company
    const allCards = await TriageCard.find({
        companyId,
        isActive: true
    }).lean();
    
    // Build comparison details with NORMALIZED labels
    const comparisonDetails = allCards.map(card => {
        const label = card.triageLabel || '';
        const normalizedLabel = normalizeTag(label);
        const displayNormalized = normalizeTag(card.displayName);
        const scenarioKeyNormalized = normalizeTag(card.quickRuleConfig?.scenarioKey);
        
        return {
            cardId: card._id.toString(),
            triageLabel: label,
            displayName: card.displayName,
            normalizedLabel,
            displayNormalized,
            wouldMatch: normalizedLabel === normalizedSearch ||
                       displayNormalized === normalizedSearch ||
                       scenarioKeyNormalized === normalizedSearch
        };
    });
    
    logger.info('[TRIAGE MATCH] 🔍 SEARCHING with canonical normalization', {
        companyId,
        raw: triageTag,
        normalizedSearch,
        totalActiveCards: allCards.length,
        comparisonSample: comparisonDetails.slice(0, 10).map(c => ({
            label: c.triageLabel,
            normalized: c.normalizedLabel,
            wouldMatch: c.wouldMatch
        }))
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIND MATCH using normalized comparison
    // ═══════════════════════════════════════════════════════════════════════
    const matchedCard = allCards.find(card => {
        const labelNorm = normalizeTag(card.triageLabel);
        const displayNorm = normalizeTag(card.displayName);
        const scenarioKeyNorm = normalizeTag(card.quickRuleConfig?.scenarioKey);
        
        return labelNorm === normalizedSearch ||
               displayNorm === normalizedSearch ||
               scenarioKeyNorm === normalizedSearch;
    });
    
    if (matchedCard) {
        logger.info('[TRIAGE MATCH] ✅ MATCH FOUND via canonical normalization', {
            companyId,
            searchedFor: triageTag,
            normalizedSearch,
            matchedTriageLabel: matchedCard.triageLabel,
            matchedNormalized: normalizeTag(matchedCard.triageLabel),
            matchedDisplayName: matchedCard.displayName,
            cardId: matchedCard._id.toString()
        });
        return matchedCard;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // NO MATCH - Show detailed comparison
    // ═══════════════════════════════════════════════════════════════════════
    logger.warn('[TRIAGE MATCH] ❌ NO MATCH FOUND even after normalization', {
        companyId,
        searchedFor: triageTag,
        normalizedSearch,
        totalActiveCards: allCards.length,
        availableNormalizedLabels: comparisonDetails.slice(0, 15).map(c => c.normalizedLabel),
        suggestion: `Brain-1 returned "${triageTag}" (normalized: "${normalizedSearch}") but no card has a matching normalized label. Available: ${comparisonDetails.slice(0, 5).map(c => c.normalizedLabel).join(', ')}`
    });
    
    return null;
}

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
    
    // Priority 1: Explicit frontline opening line (singular - common pattern)
    const openingLine = triageCard.frontlinePlaybook?.openingLine;
    if (openingLine && openingLine.trim()) {
        logger.debug('[TRIAGE] Using frontlinePlaybook.openingLine', { 
            cardId: triageCard._id,
            preview: openingLine.substring(0, 50) 
        });
        return openingLine.trim();
    }
    
    // Priority 2: Explicit frontline opening lines array
    const frontlineOpening = triageCard.frontlinePlaybook?.openingLines?.[0];
    if (frontlineOpening && frontlineOpening.trim()) {
        logger.debug('[TRIAGE] Using frontlinePlaybook.openingLines[0]', { 
            cardId: triageCard._id,
            preview: frontlineOpening.substring(0, 50) 
        });
        return frontlineOpening.trim();
    }
    
    // Priority 3: quickRuleConfig.acknowledgment (very common field)
    const acknowledgment = triageCard.quickRuleConfig?.acknowledgment;
    if (acknowledgment && acknowledgment.trim()) {
        logger.debug('[TRIAGE] Using quickRuleConfig.acknowledgment', { 
            cardId: triageCard._id,
            preview: acknowledgment.substring(0, 50) 
        });
        return acknowledgment.trim();
    }
    
    // Priority 4: Direct response field (legacy)
    const directResponse = triageCard.response;
    if (directResponse && directResponse.trim()) {
        logger.debug('[TRIAGE] Using triageCard.response', { 
            cardId: triageCard._id,
            preview: directResponse.substring(0, 50) 
        });
        return directResponse.trim();
    }
    
    // Priority 5: Route-specific playbook lines
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
    
    // Priority 6: Generic explanation from quickRuleConfig
    const genericExplanation = triageCard.quickRuleConfig?.explanation;
    if (genericExplanation && genericExplanation.trim()) {
        return genericExplanation.trim();
    }
    
    // Priority 7: Frontline goal as last resort
    const frontlineGoal = triageCard.frontlinePlaybook?.frontlineGoal;
    if (frontlineGoal && frontlineGoal.trim() && frontlineGoal.length < 100) {
        // Only use if it's short enough to be spoken
        return frontlineGoal.trim();
    }
    
    logger.warn('[TRIAGE] No opening line found for card', {
        cardId: triageCard._id,
        cardName: triageCard.displayName || triageCard.triageLabel,
        hasPlaybook: !!triageCard.frontlinePlaybook,
        hasQuickRule: !!triageCard.quickRuleConfig,
        hasResponse: !!triageCard.response
    });
    
    return null;
}

module.exports = {
    route,
    extractOpeningLine // Exported for testing/reuse
};


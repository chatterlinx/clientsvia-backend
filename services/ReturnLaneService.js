/**
 * ============================================================================
 * RETURN LANE SERVICE - Post-Response Behavior Engine (V1 - 2026-02)
 * ============================================================================
 * 
 * PURPOSE:
 * Deterministic flow control after 3-tier responses. Prevents the AI from
 * getting "stuck" answering questions without driving toward booking.
 * 
 * HOW IT WORKS:
 * 1. TriageService matches a card → card has returnConfig
 * 2. After 3-tier response is generated, this service decides:
 *    - Should we append a "push to booking" prompt?
 *    - Should we force an action after N turns?
 * 3. Tracks lane context in session (turns in lane, pushes made)
 * 
 * KILL SWITCHES:
 * - company.aiAgentSettings.returnLane.enabled must be TRUE
 * - card.returnConfig.enabled must be TRUE
 * - If either is false, Return Lane is completely bypassed
 * 
 * CRITICAL RULE:
 * NEVER use `enabled ?? true` or any pattern that defaults to enabled.
 * Always check `enabled === true` explicitly.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const LANE_TYPES = ['SYMPTOM', 'INQUIRY', 'BOOKING', 'EMERGENCY', 'OUT_OF_SCOPE', 'CALLBACK', 'BILLING', 'UNKNOWN'];

const POST_RESPONSE_ACTIONS = [
  'NONE',
  'PUSH_BOOKING',      // Append a soft prompt to suggest booking
  'START_BOOKING',     // Immediately enter booking flow
  'ESCALATE',          // Transfer to human
  'TAKE_MESSAGE',      // Take a message and end
  'END_CALL',          // Politely end the call
  'CONTINUE_DISCOVERY' // Keep asking questions
];

// Actions that are "hard" - meaning they change call flow significantly
const HARD_ACTIONS = new Set(['ESCALATE', 'END_CALL', 'TAKE_MESSAGE', 'START_BOOKING']);

// ═══════════════════════════════════════════════════════════════════════════
// LANE CONTEXT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Initialize or reset lane context for a session.
 * Called when entering a new lane or starting fresh.
 */
function initializeLaneContext(cardMatch, returnConfig) {
  return {
    currentLane: returnConfig?.lane || 'UNKNOWN',
    enteredAt: new Date(),
    turnsInLane: 0,
    pushCount: 0,
    lastPushAt: null,
    matchedCardId: cardMatch?.triageCardId || null,
    matchedCardLabel: cardMatch?.triageLabel || null,
    postResponseAction: returnConfig?.postResponseAction || 'NONE',
    pushPromptKey: returnConfig?.pushPromptKey || 'default',
    maxTurnsBeforePush: returnConfig?.maxTurnsBeforePush ?? 2,
    forceActionAfterTurns: returnConfig?.forceActionAfterTurns ?? 4,
    forceActionType: returnConfig?.forceActionType || 'PUSH_BOOKING'
  };
}

/**
 * Update lane context after a turn.
 * Increments turn counter, checks for lane change.
 */
function updateLaneContext(existingContext, cardMatch, returnConfig) {
  if (!existingContext) {
    return initializeLaneContext(cardMatch, returnConfig);
  }
  
  const newLane = returnConfig?.lane || 'UNKNOWN';
  const existingLane = existingContext.currentLane;
  
  // Check if lane changed (different card matched)
  if (newLane !== existingLane) {
    logger.info('[RETURN_LANE] Lane changed', {
      from: existingLane,
      to: newLane,
      cardId: cardMatch?.triageCardId
    });
    
    // Reset context for new lane
    return initializeLaneContext(cardMatch, returnConfig);
  }
  
  // Same lane - increment turn counter
  return {
    ...existingContext,
    turnsInLane: existingContext.turnsInLane + 1,
    matchedCardId: cardMatch?.triageCardId || existingContext.matchedCardId,
    matchedCardLabel: cardMatch?.triageLabel || existingContext.matchedCardLabel
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POLICY APPLICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply Return Lane policy to determine post-response action.
 * 
 * @param {Object} params
 * @param {Object} params.company - Company document with aiAgentSettings
 * @param {Object} params.cardMatch - Result from TriageService.applyQuickTriageRules
 * @param {Object} params.card - Full TriageCard document (for returnConfig)
 * @param {Object} params.session - ConversationSession with laneContext
 * @param {string} params.responseTier - Which tier generated the response ('tier1', 'tier2', 'tier3')
 * @param {boolean} params.isAlreadyBooking - Is session already in BOOKING mode?
 * 
 * @returns {Object} Policy decision:
 *   {
 *     applied: boolean,        // Was Return Lane applied?
 *     action: string,          // Post-response action (NONE, PUSH_BOOKING, etc.)
 *     pushPrompt: string|null, // Text to append to response (if PUSH_BOOKING)
 *     reason: string,          // Why this decision was made
 *     laneContext: Object      // Updated lane context to save to session
 *   }
 */
function applyPolicy({
  company,
  cardMatch,
  card,
  session,
  responseTier,
  isAlreadyBooking = false
}) {
  const log = (msg, data = {}) => {
    logger.info(`[RETURN_LANE] ${msg}`, {
      companyId: company?._id?.toString(),
      sessionId: session?._id?.toString(),
      ...data
    });
  };
  
  // ─────────────────────────────────────────────────────────────────────────
  // KILL SWITCH #1: Company-level feature flag
  // ─────────────────────────────────────────────────────────────────────────
  const companyReturnLane = company?.aiAgentSettings?.returnLane;
  if (companyReturnLane?.enabled !== true) {
    log('BYPASSED: Company returnLane.enabled !== true', {
      enabled: companyReturnLane?.enabled
    });
    return {
      applied: false,
      action: 'NONE',
      pushPrompt: null,
      reason: 'COMPANY_DISABLED',
      laneContext: session?.laneContext || null
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // KILL SWITCH #2: No card matched
  // ─────────────────────────────────────────────────────────────────────────
  if (!cardMatch?.matched) {
    log('BYPASSED: No triage card matched');
    return {
      applied: false,
      action: 'NONE',
      pushPrompt: null,
      reason: 'NO_CARD_MATCH',
      laneContext: session?.laneContext || null
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // KILL SWITCH #3: Card-level feature flag
  // ─────────────────────────────────────────────────────────────────────────
  const returnConfig = card?.returnConfig;
  if (returnConfig?.enabled !== true) {
    log('BYPASSED: Card returnConfig.enabled !== true', {
      cardId: card?._id?.toString(),
      enabled: returnConfig?.enabled
    });
    return {
      applied: false,
      action: 'NONE',
      pushPrompt: null,
      reason: 'CARD_DISABLED',
      laneContext: session?.laneContext || null
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // GUARDRAIL: Already in booking mode
  // ─────────────────────────────────────────────────────────────────────────
  const guardrails = returnConfig.guardrails || {};
  if (isAlreadyBooking && guardrails.suppressIfAlreadyBooking !== false) {
    log('SUPPRESSED: Already in booking mode');
    return {
      applied: false,
      action: 'NONE',
      pushPrompt: null,
      reason: 'ALREADY_BOOKING',
      laneContext: session?.laneContext || null
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE LANE CONTEXT
  // ─────────────────────────────────────────────────────────────────────────
  const existingContext = session?.laneContext;
  const laneContext = updateLaneContext(existingContext, cardMatch, returnConfig);
  
  log('Lane context updated', {
    lane: laneContext.currentLane,
    turnsInLane: laneContext.turnsInLane,
    pushCount: laneContext.pushCount
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // TIER 3 GOVERNANCE
  // ─────────────────────────────────────────────────────────────────────────
  // Restrict certain actions on Tier 3 (LLM fallback) responses
  const tierPolicy = returnConfig.tierPolicy || {};
  const applyToTiers = tierPolicy.applyToTiers || ['tier1', 'tier2', 'tier3'];
  
  if (!applyToTiers.includes(responseTier)) {
    log('BYPASSED: Tier not in applyToTiers', {
      responseTier,
      applyToTiers
    });
    return {
      applied: false,
      action: 'NONE',
      pushPrompt: null,
      reason: 'TIER_EXCLUDED',
      laneContext
    };
  }
  
  // Check if action is restricted on Tier 3
  const tier3RestrictedActions = tierPolicy.tier3RestrictedActions || ['ESCALATE', 'END_CALL', 'TAKE_MESSAGE'];
  const allowTier3HardActions = tierPolicy.allowTier3HardActions === true;
  
  // ─────────────────────────────────────────────────────────────────────────
  // DETERMINE ACTION
  // ─────────────────────────────────────────────────────────────────────────
  let action = returnConfig.postResponseAction || 'NONE';
  let reason = 'POLICY_APPLIED';
  
  // Check turn-based thresholds
  const turnsInLane = laneContext.turnsInLane;
  const maxTurnsBeforePush = returnConfig.maxTurnsBeforePush ?? 2;
  const forceActionAfterTurns = returnConfig.forceActionAfterTurns ?? 4;
  
  // Force action after N turns?
  if (turnsInLane >= forceActionAfterTurns) {
    action = returnConfig.forceActionType || 'PUSH_BOOKING';
    reason = 'FORCE_ACTION_THRESHOLD';
    log('Force action triggered', { turnsInLane, forceActionAfterTurns, action });
  }
  // Should we push now?
  else if (turnsInLane >= maxTurnsBeforePush && action === 'PUSH_BOOKING') {
    reason = 'PUSH_THRESHOLD_MET';
    log('Push threshold met', { turnsInLane, maxTurnsBeforePush });
  }
  // Not enough turns yet - don't push
  else if (turnsInLane < maxTurnsBeforePush && action === 'PUSH_BOOKING') {
    action = 'NONE';
    reason = 'BELOW_PUSH_THRESHOLD';
    log('Below push threshold', { turnsInLane, maxTurnsBeforePush });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // TIER 3 RESTRICTION CHECK
  // ─────────────────────────────────────────────────────────────────────────
  if (responseTier === 'tier3' && HARD_ACTIONS.has(action) && !allowTier3HardActions) {
    if (tier3RestrictedActions.includes(action)) {
      log('Action restricted on Tier 3, downgrading', {
        originalAction: action,
        newAction: 'PUSH_BOOKING'
      });
      action = 'PUSH_BOOKING';
      reason = 'TIER3_RESTRICTION_DOWNGRADE';
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // BUILD PUSH PROMPT (if applicable)
  // ─────────────────────────────────────────────────────────────────────────
  let pushPrompt = null;
  
  if (action === 'PUSH_BOOKING') {
    const pushPromptKey = returnConfig.pushPromptKey || 'default';
    const companyTemplates = companyReturnLane.pushPromptTemplates || {};
    
    if (pushPromptKey === 'custom' && returnConfig.pushPromptCustom) {
      pushPrompt = returnConfig.pushPromptCustom;
    } else {
      pushPrompt = companyTemplates[pushPromptKey] || 
                   companyTemplates.default ||
                   'Would you like me to schedule a technician to take a look?';
    }
    
    // Update push count in context
    laneContext.pushCount += 1;
    laneContext.lastPushAt = new Date();
    
    log('Push prompt selected', {
      pushPromptKey,
      pushPromptPreview: pushPrompt.substring(0, 50),
      pushCount: laneContext.pushCount
    });
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // EMIT TRACE EVENT
  // ─────────────────────────────────────────────────────────────────────────
  log('LANE_DECISION_SUMMARY', {
    applied: true,
    action,
    reason,
    lane: laneContext.currentLane,
    turnsInLane: laneContext.turnsInLane,
    pushCount: laneContext.pushCount,
    responseTier,
    cardId: card?._id?.toString(),
    cardLabel: cardMatch?.triageLabel
  });
  
  return {
    applied: true,
    action,
    pushPrompt,
    reason,
    laneContext
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  applyPolicy,
  initializeLaneContext,
  updateLaneContext,
  
  // Constants for external use
  LANE_TYPES,
  POST_RESPONSE_ACTIONS,
  HARD_ACTIONS
};

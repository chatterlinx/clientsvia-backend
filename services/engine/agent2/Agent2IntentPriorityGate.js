/**
 * ============================================================================
 * AGENT 2.0 INTENT PRIORITY GATE
 * ============================================================================
 *
 * Global intent detection that runs BEFORE trigger card scoring.
 * Prevents FAQ/sales cards from hijacking service-down calls.
 *
 * Design Principles:
 * - Runs before TriggerCardMatcher
 * - Detects high-priority intents (service_down, emergency, urgent)
 * - Returns intent flags and card category penalties
 * - UI-configurable patterns and categories
 *
 * How it works:
 * 1. Detect if caller has "service down" or "urgent" intent
 * 2. If detected, mark FAQ/sales/info card categories as "disqualified"
 * 3. TriggerCardMatcher uses this to skip or heavily penalize those cards
 *
 * This solves the problem of:
 *   Caller: "I'm a longtime customer, my AC has problems"
 *   Bad Match: "system age / lifespan" FAQ card (because of "longtime")
 *   Correct: Service-down card should win
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// DEFAULT PATTERNS (UI-overridable)
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_SERVICE_DOWN_PATTERNS = [
  // AC/Heat not working - flexible patterns with optional suffixes
  /\b(not\s+cool(?:ing)?|no\s+cool(?:ing)?|stopped\s+cool(?:ing)?|won'?t\s+cool)/i,
  /\b(not\s+heat(?:ing)?|no\s+heat(?:ing)?|stopped\s+heat(?:ing)?|won'?t\s+heat)/i,
  /\b(not\s+work(?:ing)?|stopped\s+work(?:ing)?|won'?t\s+work|isn'?t\s+work(?:ing)?|broken|broke)/i,
  /\b(system\s+down|unit\s+down|ac\s+down|hvac\s+down)/i,
  /\b(not\s+turn(?:ing)?|won'?t\s+turn|not\s+run(?:ning)?|won'?t\s+run|won'?t\s+start)/i,
  
  // AC/HVAC problems mentioned generically
  /\b(ac\s+(?:problem|issue|trouble|broke)|a\.?c\.?\s+(?:problem|issue|trouble|broke))/i,
  /\b(air\s+condition(?:ing|er)?\s+(?:problem|issue|trouble|not))/i,
  /\b(hvac\s+(?:problem|issue|trouble|not))/i,
  
  // Thermostat issues
  /\b(thermostat\s+(?:is\s+)?(?:blank|dead|not|off|issue|problem))/i,
  /\b(blank\s+(?:thermostat|screen|display))/i,
  /\b(display\s+(?:blank|dead|not\s+work))/i,
  /\b(nothing\s+(?:is\s+)?work(?:ing)?)/i,
  
  // Temperature problems
  /\b(hot\s+in|warm\s+air|blowing\s+(?:warm|hot))/i,
  /\b(cold\s+in|freezing\s+in)/i,
  /\b(no\s+(?:air|airflow|cold\s+air))/i,
  /\b(house\s+(?:is\s+)?hot)/i,
  
  // Emergency indicators
  /\b(emergency|urgent|asap|right\s+away|immediately)/i,
  /\b(burning\s+smell|smell(?:s|ing)?\s+(?:like\s+)?burn|smoke|fire|gas\s+leak|carbon\s+monoxide)/i,
  /\b(water\s+leak|flooding|water\s+everywhere|leaking)/i,
  /\b(pregnant|baby|elderly|sick|medical)/i
];

const DEFAULT_DISQUALIFIED_CATEGORIES = [
  'faq',
  'info',
  'sales',
  'financing',
  'warranty',
  'maintenance_plan',
  'system_age',
  'lifespan',
  'replacement',
  'upgrade',
  'new_system',
  'general',
  'hours',
  'pricing'
];

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function buildPatternsFromConfig(config) {
  if (!config || !Array.isArray(config.patterns)) {
    return DEFAULT_SERVICE_DOWN_PATTERNS;
  }
  
  return config.patterns.map(p => {
    if (p instanceof RegExp) return p;
    if (typeof p === 'string') {
      try {
        return new RegExp(p, 'i');
      } catch (e) {
        logger.warn('[IntentPriorityGate] Invalid pattern string, skipping', { pattern: p });
        return null;
      }
    }
    return null;
  }).filter(Boolean);
}

function getDisqualifiedCategories(config) {
  if (!config || !Array.isArray(config.disqualifiedCategories)) {
    return DEFAULT_DISQUALIFIED_CATEGORIES;
  }
  return config.disqualifiedCategories.map(c => normalizeText(c));
}

// ────────────────────────────────────────────────────────────────────────────
// RESULT STRUCTURE
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} IntentGateResult
 * @property {boolean} serviceDownDetected - True if service-down intent detected
 * @property {boolean} emergencyDetected - True if emergency keywords found
 * @property {string[]} matchedPatterns - Which patterns matched (for logging)
 * @property {string[]} disqualifiedCategories - Card categories to block/penalize
 * @property {number} urgencyScore - 0-100 urgency rating
 * @property {Object} penalties - Category → penalty score to apply
 */

// ────────────────────────────────────────────────────────────────────────────
// INTENT PRIORITY GATE CLASS
// ────────────────────────────────────────────────────────────────────────────

class Agent2IntentPriorityGate {
  /**
   * Evaluate caller utterance for high-priority intents.
   * Run this BEFORE TriggerCardMatcher.match()
   *
   * @param {string} inputText - The caller's utterance
   * @param {Object} config - UI-configured gate settings (optional)
   * @returns {IntentGateResult}
   */
  static evaluate(inputText, config = {}) {
    const input = normalizeText(inputText);
    const patterns = buildPatternsFromConfig(config);
    const disqualifiedCategories = getDisqualifiedCategories(config);
    
    const result = {
      serviceDownDetected: false,
      emergencyDetected: false,
      matchedPatterns: [],
      disqualifiedCategories: [],
      urgencyScore: 0,
      penalties: {}
    };
    
    if (!input) {
      return result;
    }
    
    // Check each pattern
    let urgencyScore = 0;
    const emergencyTerms = ['emergency', 'urgent', 'burning', 'smoke', 'fire', 'gas leak', 'carbon monoxide', 'flooding'];
    
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        result.matchedPatterns.push(pattern.source || pattern.toString());
        
        // Check if this is an emergency pattern
        const patternStr = pattern.source || pattern.toString();
        const isEmergency = emergencyTerms.some(term => patternStr.includes(term));
        
        if (isEmergency) {
          result.emergencyDetected = true;
          urgencyScore += 40;
        } else {
          urgencyScore += 20;
        }
      }
    }
    
    // If any patterns matched, we have service-down intent
    if (result.matchedPatterns.length > 0) {
      result.serviceDownDetected = true;
      result.urgencyScore = Math.min(100, urgencyScore);
      result.disqualifiedCategories = disqualifiedCategories;
      
      // Build penalty map: higher penalty = less likely to match
      const basePenalty = config.basePenalty || 50;
      for (const category of disqualifiedCategories) {
        result.penalties[category] = basePenalty;
      }
      
      logger.info('[IntentPriorityGate] Service-down intent detected', {
        matchedCount: result.matchedPatterns.length,
        urgencyScore: result.urgencyScore,
        isEmergency: result.emergencyDetected,
        inputPreview: input.substring(0, 80)
      });
    }
    
    return result;
  }
  
  /**
   * Check if a card should be disqualified based on gate result.
   * Call this for each card in TriggerCardMatcher.
   *
   * @param {Object} card - Trigger card object
   * @param {IntentGateResult} gateResult - Result from evaluate()
   * @returns {{ disqualified: boolean, reason: string|null, penalty: number }}
   */
  static checkCard(card, gateResult) {
    if (!gateResult || !gateResult.serviceDownDetected) {
      return { disqualified: false, reason: null, penalty: 0 };
    }
    
    // Check card category
    const cardCategory = normalizeText(card.category || card.type || '');
    const cardId = normalizeText(card.id || '');
    const cardLabel = normalizeText(card.label || '');
    
    for (const disqualifiedCat of gateResult.disqualifiedCategories) {
      // Check if card belongs to disqualified category
      if (cardCategory.includes(disqualifiedCat) ||
          cardId.includes(disqualifiedCat) ||
          cardId.startsWith(`faq.`) ||
          cardId.startsWith(`info.`) ||
          cardId.startsWith(`sales.`)) {
        
        const penalty = gateResult.penalties[disqualifiedCat] || 50;
        
        // In strict mode (emergency), fully disqualify. Otherwise, just penalize.
        if (gateResult.emergencyDetected) {
          return {
            disqualified: true,
            reason: `INTENT_GATE:${disqualifiedCat}:emergency`,
            penalty: 100
          };
        }
        
        return {
          disqualified: false,
          reason: `INTENT_GATE:${disqualifiedCat}:penalized`,
          penalty
        };
      }
    }
    
    return { disqualified: false, reason: null, penalty: 0 };
  }
  
  /**
   * Apply gate result to modify card effective priorities.
   * Returns modified cards array with adjusted priorities.
   *
   * @param {Array} cards - Array of trigger cards
   * @param {IntentGateResult} gateResult - Result from evaluate()
   * @returns {Array} Cards with adjusted _effectivePriority and _gateResult
   */
  static applyToCards(cards, gateResult) {
    if (!gateResult || !gateResult.serviceDownDetected) {
      return cards;
    }
    
    return cards.map(card => {
      const check = this.checkCard(card, gateResult);
      
      if (check.disqualified) {
        return {
          ...card,
          _gateDisqualified: true,
          _gateReason: check.reason,
          _gatePenalty: check.penalty
        };
      }
      
      if (check.penalty > 0) {
        return {
          ...card,
          _gatePenalty: check.penalty,
          _gateReason: check.reason
        };
      }
      
      return card;
    });
  }
  
  /**
   * Get default configuration for UI display.
   * These values should be stored in company.aiAgentSettings.agent2.discovery.intentGate
   */
  static getDefaultConfig() {
    return {
      enabled: true,
      basePenalty: 50,
      patterns: DEFAULT_SERVICE_DOWN_PATTERNS.map(p => p.source),
      disqualifiedCategories: DEFAULT_DISQUALIFIED_CATEGORIES,
      // Keywords that trigger service-down detection (simplified for UI)
      serviceDownKeywords: [
        'not cooling', 'no cool', 'stopped cooling',
        'not heating', 'no heat', 'stopped heating',
        'not working', 'stopped working', 'broken',
        'thermostat blank', 'display blank',
        'hot in the house', 'warm air', 'blowing warm',
        'no air', 'no airflow', 'system down'
      ],
      emergencyKeywords: [
        'emergency', 'urgent', 'burning smell', 'smoke',
        'fire', 'gas leak', 'carbon monoxide', 'flooding',
        'water leak', 'water everywhere'
      ]
    };
  }
}

module.exports = { Agent2IntentPriorityGate };

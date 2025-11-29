// services/TriageValidatorHelper.js
// V23 Triage Validation Helper
// Used by both LLM-A service AND /validate-utterances endpoint
// Ensures SAME matching logic as runtime TriageService

/**
 * Normalize utterance to tokens for matching
 * Same logic as TriageService.normalizeText but returns tokens
 */
function normalizeUtterance(text) {
  if (!text) return [];
  
  let normalized = String(text)
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    // V22 normalizations
    .replace(/tune\s*up/g, 'tuneup')
    .replace(/air\s*conditioning/g, 'ac')
    .replace(/a\s*c\b/g, 'ac')
    .replace(/no\s*cool/g, 'not cooling')
    .replace(/wont\s*cool/g, 'not cooling')
    .replace(/isnt\s*cooling/g, 'not cooling')
    .replace(/doesnt\s*work/g, 'not working')
    .replace(/wont\s*work/g, 'not working')
    .replace(/isnt\s*working/g, 'not working')
    .replace(/\s+/g, ' ')
    .trim();
  
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Check if utterance contains all must-have keywords
 */
function utteranceContainsAll(tokens, mustHave) {
  if (!mustHave || mustHave.length === 0) return true;
  
  const normalizedMust = mustHave.map(k => k.toLowerCase().trim());
  const tokenString = tokens.join(' ');
  
  // Check each must-have keyword/phrase
  return normalizedMust.every(keyword => {
    // For multi-word phrases, check if they appear in the token string
    if (keyword.includes(' ')) {
      return tokenString.includes(keyword);
    }
    // For single words, check token array
    return tokens.includes(keyword);
  });
}

/**
 * Check if utterance contains any exclude keywords
 */
function utteranceContainsAny(tokens, exclude) {
  if (!exclude || exclude.length === 0) return false;
  
  const normalizedExclude = exclude.map(k => k.toLowerCase().trim());
  const tokenString = tokens.join(' ');
  
  return normalizedExclude.some(keyword => {
    if (keyword.includes(' ')) {
      return tokenString.includes(keyword);
    }
    return tokens.includes(keyword);
  });
}

/**
 * Simulate triage matching for a single utterance
 * Returns true if the utterance would match the given keywords
 * 
 * @param {string} utterance - The caller utterance to test
 * @param {string[]} mustHaveKeywords - Keywords that must ALL be present
 * @param {string[]} excludeKeywords - Keywords that must NOT be present
 * @returns {boolean} - True if utterance matches
 */
function simulateTriageMatch(utterance, mustHaveKeywords, excludeKeywords) {
  const tokens = normalizeUtterance(utterance);
  
  const must = (mustHaveKeywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
  const exclude = (excludeKeywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
  
  // Must contain ALL must-have keywords
  const hasAllMust = utteranceContainsAll(tokens, must);
  
  // Must NOT contain ANY exclude keywords
  const hasAnyExclude = utteranceContainsAny(tokens, exclude);
  
  return hasAllMust && !hasAnyExclude;
}

/**
 * Run validation against a test plan
 * Returns a complete validation report
 * 
 * @param {Object} quickRuleConfig - The card's quick rule config
 * @param {Object} testPlan - Test plan with positive/negative utterances
 * @returns {Object} - Validation report
 */
function validateAgainstTestPlan(quickRuleConfig, testPlan) {
  const must = quickRuleConfig?.mustHaveKeywords || [];
  const exclude = quickRuleConfig?.excludeKeywords || [];
  
  const positives = testPlan?.positiveUtterances || [];
  const negatives = testPlan?.negativeUtterances || [];
  
  const failures = [];
  let positiveMatchedCount = 0;
  let negativeMatchedCount = 0;
  
  // Test positive utterances (should match)
  for (const utt of positives) {
    const matched = simulateTriageMatch(utt, must, exclude);
    if (matched) {
      positiveMatchedCount++;
    } else {
      failures.push({
        type: 'POSITIVE_NOT_MATCHED',
        utterance: utt,
        reason: 'Expected to match but did not'
      });
    }
  }
  
  // Test negative utterances (should NOT match)
  for (const utt of negatives) {
    const matched = simulateTriageMatch(utt, must, exclude);
    if (matched) {
      negativeMatchedCount++;
      failures.push({
        type: 'NEGATIVE_MATCHED',
        utterance: utt,
        reason: 'Expected NOT to match but did'
      });
    }
  }
  
  // Determine status
  let status;
  if (failures.length === 0) {
    status = 'PASSED';
  } else if (positiveMatchedCount === 0 && positives.length > 0) {
    status = 'FAILED';
  } else {
    status = 'NEEDS_REVIEW';
  }
  
  return {
    status,
    coverage: {
      positiveMatchedCount,
      positiveTotal: positives.length,
      negativeMatchedCount,
      negativeTotal: negatives.length
    },
    failures
  };
}

/**
 * Check for region conflicts in keywords
 * 
 * @param {string[]} keywords - Keywords to check
 * @param {Object} regionProfile - Company region profile
 * @returns {string[]} - Array of guardrail flags
 */
function checkRegionConflicts(keywords, regionProfile) {
  const flags = [];
  
  if (!regionProfile || !keywords) return flags;
  
  const heatingWords = ['furnace', 'heater', 'boiler', 'heat pump', 'heating'];
  const coolingWords = ['ac', 'air conditioning', 'cooling', 'air conditioner'];
  
  const normalizedKeywords = keywords.map(k => k.toLowerCase());
  
  // Check for heating words in hot-only climate
  if (regionProfile.climate === 'HOT_ONLY' || regionProfile.supportsHeating === false) {
    for (const word of heatingWords) {
      if (normalizedKeywords.some(k => k.includes(word))) {
        flags.push('REGION_HEATING_MENTIONED_IN_HOT_ONLY');
        break;
      }
    }
  }
  
  // Check for cooling words in cold-only climate
  if (regionProfile.climate === 'COLD_ONLY' || regionProfile.supportsCooling === false) {
    for (const word of coolingWords) {
      if (normalizedKeywords.some(k => k.includes(word))) {
        flags.push('REGION_COOLING_MENTIONED_IN_COLD_ONLY');
        break;
      }
    }
  }
  
  return flags;
}

module.exports = {
  normalizeUtterance,
  utteranceContainsAll,
  utteranceContainsAny,
  simulateTriageMatch,
  validateAgainstTestPlan,
  checkRegionConflicts
};


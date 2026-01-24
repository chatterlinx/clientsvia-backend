/**
 * ============================================================================
 * COMPLIANCE CHECKER - Deterministic LLM Output Validation
 * ============================================================================
 * 
 * Purpose: Verify that LLM-generated responses actually comply with scenario
 * rules and company settings. This is the "missing link" between providing
 * context to the LLM and proving it followed the rules.
 * 
 * All checks are deterministic (regex/string) - no extra LLM calls needed.
 * 
 * Usage:
 *   const compliance = checkCompliance(reply, {
 *     company,
 *     callerName,
 *     scenarioType,
 *     expectedBookingMomentum: true
 *   });
 * 
 * Returns:
 *   {
 *     score: 85,           // 0-100 overall compliance
 *     passed: true,        // score >= threshold
 *     checks: {
 *       bannedPhrases: { passed: true, found: [] },
 *       troubleshooting: { passed: true, found: [] },
 *       nameUsage: { passed: true, usedCorrectly: true },
 *       bookingMomentum: { passed: true, found: ['morning', 'afternoon'] }
 *     },
 *     violations: []       // Array of violation strings for logging
 *   }
 * 
 * ============================================================================
 */

const logger = require('./logger');

// ============================================================================
// DEFAULT TROUBLESHOOTING PATTERNS (these should NOT appear in responses)
// ============================================================================
// These indicate the AI is trying to diagnose instead of booking/dispatching.
// Dispatchers don't troubleshoot - they schedule technicians.
// ============================================================================
const DEFAULT_TROUBLESHOOTING_PATTERNS = [
  // Direct troubleshooting questions
  /have you (tried|checked|looked at)/i,
  /did you (try|check|look at)/i,
  /is it (set|turned|plugged|connected)/i,
  /can you (try|check|look at|verify)/i,
  /could you (try|check|look at|verify)/i,
  /make sure (the|it|your)/i,
  /try (turning|resetting|unplugging|checking)/i,
  
  // Diagnostic questions
  /what (color|temperature|setting) is/i,
  /is the .* (on|off|blinking|flashing)/i,
  /when did you last (change|replace|clean)/i,
  /have you (changed|replaced|cleaned) the/i,
  
  // Tech support language
  /restart (the|your|it)/i,
  /reboot (the|your|it)/i,
  /reset (the|your|it)/i,
  /unplug .* and plug/i,
  /wait .* (seconds|minutes) and/i,
  
  // Deflection phrases
  /before we send/i,
  /before scheduling/i,
  /let me ask you a few questions/i,
  /let's troubleshoot/i
];

// ============================================================================
// BOOKING MOMENTUM PATTERNS (these SHOULD appear when booking)
// ============================================================================
// When in booking mode, the response should move toward scheduling.
// ============================================================================
const BOOKING_MOMENTUM_PATTERNS = [
  // Time slot language
  /morning|afternoon|evening/i,
  /today|tomorrow|this week/i,
  /\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /available|availability/i,
  /schedule|appointment|booking/i,
  /technician|tech|specialist/i,
  
  // Confirmation language
  /does .* work for you/i,
  /would .* work/i,
  /i can (get|have|schedule)/i,
  /we can (get|have|send)/i,
  /let me (get|have|schedule)/i
];

// ============================================================================
// NAME PLACEHOLDER PATTERNS
// ============================================================================
const NAME_PLACEHOLDER_PATTERN = /\{name\}/i;
const NAME_USAGE_PATTERN = /\b(hi|hello|thanks|thank you),?\s+\w+/i;

/**
 * Main compliance check function
 * 
 * @param {string} reply - The LLM-generated reply text
 * @param {Object} options - Configuration options
 * @param {Object} options.company - Company object with aiAgentSettings
 * @param {string|null} options.callerName - Caller's name if known
 * @param {string} options.scenarioType - Type of scenario (BOOKING, FAQ, etc.)
 * @param {boolean} options.expectedBookingMomentum - Whether booking language expected
 * @param {Array} options.customTroubleshootingPatterns - Additional patterns to check
 * @returns {Object} Compliance result with score, checks, and violations
 */
function checkCompliance(reply, options = {}) {
  const {
    company = {},
    callerName = null,
    scenarioType = null,
    expectedBookingMomentum = false,
    customTroubleshootingPatterns = []
  } = options;
  
  if (!reply || typeof reply !== 'string') {
    return {
      score: 0,
      passed: false,
      checks: {},
      violations: ['No reply to check']
    };
  }
  
  const checks = {};
  const violations = [];
  let totalWeight = 0;
  let weightedScore = 0;
  
  // =========================================================================
  // CHECK 1: Banned Phrases (weight: 30)
  // =========================================================================
  const bannedPhrases = company?.aiAgentSettings?.frontDeskBehavior?.forbiddenPhrases || [];
  const bannedFound = [];
  
  for (const phrase of bannedPhrases) {
    if (phrase && reply.toLowerCase().includes(phrase.toLowerCase())) {
      bannedFound.push(phrase);
    }
  }
  
  checks.bannedPhrases = {
    passed: bannedFound.length === 0,
    found: bannedFound,
    weight: 30
  };
  
  totalWeight += 30;
  if (checks.bannedPhrases.passed) {
    weightedScore += 30;
  } else {
    violations.push(`Banned phrases found: ${bannedFound.join(', ')}`);
  }
  
  // =========================================================================
  // CHECK 2: Troubleshooting Questions (weight: 25)
  // =========================================================================
  const allTroubleshootingPatterns = [
    ...DEFAULT_TROUBLESHOOTING_PATTERNS,
    ...customTroubleshootingPatterns
  ];
  
  const troubleshootingFound = [];
  for (const pattern of allTroubleshootingPatterns) {
    const match = reply.match(pattern);
    if (match) {
      troubleshootingFound.push(match[0]);
    }
  }
  
  // Dedupe
  const uniqueTroubleshooting = [...new Set(troubleshootingFound)];
  
  checks.troubleshooting = {
    passed: uniqueTroubleshooting.length === 0,
    found: uniqueTroubleshooting.slice(0, 5), // Limit to 5 for logging
    weight: 25
  };
  
  totalWeight += 25;
  if (checks.troubleshooting.passed) {
    weightedScore += 25;
  } else {
    violations.push(`Troubleshooting detected: ${uniqueTroubleshooting.slice(0, 3).join(', ')}`);
  }
  
  // =========================================================================
  // CHECK 3: Name Usage Correctness (weight: 20)
  // =========================================================================
  const hasCallerName = !!callerName && callerName.trim().length > 0;
  const hasNamePlaceholder = NAME_PLACEHOLDER_PATTERN.test(reply);
  const mentionsName = hasCallerName && reply.toLowerCase().includes(callerName.toLowerCase());
  
  let nameUsageCorrect = true;
  let nameUsageReason = 'correct';
  
  if (hasNamePlaceholder) {
    // CRITICAL: {name} placeholder should NEVER appear in final output
    nameUsageCorrect = false;
    nameUsageReason = 'placeholder_leaked';
    violations.push('Name placeholder {name} leaked into output');
  } else if (!hasCallerName && mentionsName) {
    // Somehow mentioned a name we don't have (weird edge case)
    nameUsageCorrect = true; // Not a violation, just odd
    nameUsageReason = 'name_present_unexpectedly';
  } else if (hasCallerName && !mentionsName) {
    // Has name but didn't use it - minor (not always required)
    nameUsageCorrect = true;
    nameUsageReason = 'name_available_not_used';
  }
  
  checks.nameUsage = {
    passed: nameUsageCorrect,
    hasCallerName,
    usedName: mentionsName,
    reason: nameUsageReason,
    weight: 20
  };
  
  totalWeight += 20;
  if (checks.nameUsage.passed) {
    weightedScore += 20;
  }
  
  // =========================================================================
  // CHECK 4: Booking Momentum (weight: 25, only when expected)
  // =========================================================================
  if (expectedBookingMomentum) {
    const bookingFound = [];
    for (const pattern of BOOKING_MOMENTUM_PATTERNS) {
      const match = reply.match(pattern);
      if (match) {
        bookingFound.push(match[0]);
      }
    }
    
    const uniqueBooking = [...new Set(bookingFound)];
    const hasBookingMomentum = uniqueBooking.length >= 1;
    
    checks.bookingMomentum = {
      passed: hasBookingMomentum,
      found: uniqueBooking.slice(0, 5),
      weight: 25
    };
    
    totalWeight += 25;
    if (checks.bookingMomentum.passed) {
      weightedScore += 25;
    } else {
      violations.push('Missing booking momentum (no time/scheduling language)');
    }
  }
  
  // =========================================================================
  // CALCULATE FINAL SCORE
  // =========================================================================
  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  const passed = score >= 70; // Threshold: 70%
  
  return {
    score,
    passed,
    checks,
    violations,
    // Metadata for logging
    _meta: {
      totalWeight,
      weightedScore,
      checksRun: Object.keys(checks).length
    }
  };
}

/**
 * Quick check for banned phrases only (lightweight)
 */
function quickBannedCheck(reply, forbiddenPhrases = []) {
  if (!reply || !Array.isArray(forbiddenPhrases)) return { passed: true, found: [] };
  
  const found = [];
  const replyLower = reply.toLowerCase();
  
  for (const phrase of forbiddenPhrases) {
    if (phrase && replyLower.includes(phrase.toLowerCase())) {
      found.push(phrase);
    }
  }
  
  return { passed: found.length === 0, found };
}

/**
 * Quick check for troubleshooting language only
 */
function quickTroubleshootingCheck(reply) {
  if (!reply) return { passed: true, found: [] };
  
  const found = [];
  for (const pattern of DEFAULT_TROUBLESHOOTING_PATTERNS) {
    const match = reply.match(pattern);
    if (match) {
      found.push(match[0]);
      if (found.length >= 3) break; // Early exit for performance
    }
  }
  
  return { passed: found.length === 0, found };
}

/**
 * Build compliance summary for logging (keep it compact)
 */
function buildComplianceSummary(complianceResult) {
  if (!complianceResult) return null;
  
  return {
    score: complianceResult.score,
    passed: complianceResult.passed,
    bannedHit: !complianceResult.checks.bannedPhrases?.passed,
    troubleshootHit: !complianceResult.checks.troubleshooting?.passed,
    nameCorrect: complianceResult.checks.nameUsage?.passed ?? true,
    bookingMomentum: complianceResult.checks.bookingMomentum?.passed ?? null,
    violationCount: complianceResult.violations?.length || 0
  };
}

module.exports = {
  checkCompliance,
  quickBannedCheck,
  quickTroubleshootingCheck,
  buildComplianceSummary,
  // Export patterns for testing/extension
  DEFAULT_TROUBLESHOOTING_PATTERNS,
  BOOKING_MOMENTUM_PATTERNS
};

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
 * HARD FAIL RULES:
 * - {name} placeholder leak → score capped at 40, always fails
 * - Banned phrase detected → score capped at 50, always fails
 * 
 * CLASSIFICATION vs TROUBLESHOOTING:
 * - Classification: "Is it running but not cooling?" → ALLOWED (symptom/severity)
 * - Troubleshooting: "Have you tried resetting it?" → NOT ALLOWED (diagnostic step)
 * 
 * Usage:
 *   const compliance = checkCompliance(reply, {
 *     company,
 *     callerName,
 *     scenarioType,
 *     bookingPhase: 'SCHEDULING',  // DISCOVERY|CLASSIFICATION|SCHEDULING|CONFIRMATION
 *     maxWords: 60
 *   });
 * 
 * Returns:
 *   {
 *     score: 85,
 *     passed: true,
 *     hardFail: false,
 *     hardFailReason: null,
 *     checks: { ... },
 *     violations: []
 *   }
 * 
 * ============================================================================
 */

const logger = require('./logger');

// ============================================================================
// TROUBLESHOOTING PATTERNS - "Try/fix this" language (NOT ALLOWED)
// ============================================================================
// These indicate the AI is trying to diagnose instead of dispatching.
// Dispatchers DON'T troubleshoot - they schedule technicians.
// 
// IMPORTANT: These are DISTINCT from classification questions.
// - Troubleshooting = "do something to fix it"
// - Classification = "describe symptom/severity"
// ============================================================================
const TROUBLESHOOTING_PATTERNS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: Explicit "try this" instructions (high confidence)
  // ═══════════════════════════════════════════════════════════════════════════
  /have you tried/i,
  /did you try/i,
  /can you try/i,
  /could you try/i,
  /try (turning|resetting|unplugging|restarting|rebooting|checking|changing)/i,
  /try to (turn|reset|unplug|restart|reboot|check|change)/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: "Make sure" / "Check" instructions (medium-high confidence)
  // ═══════════════════════════════════════════════════════════════════════════
  /make sure (the|it|your|that)/i,
  /can you check (the|if|that|whether)/i,
  /could you check (the|if|that|whether)/i,
  /please check (the|if|that|whether)/i,
  /have you checked (the|if|that|whether)/i,
  /did you check (the|if|that|whether)/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: Tech support verbs (high confidence)
  // ═══════════════════════════════════════════════════════════════════════════
  /restart (the|your|it)/i,
  /reboot (the|your|it)/i,
  /reset (the|your|it)/i,
  /unplug .{0,20} and plug/i,
  /turn it off and (back )?on/i,
  /wait .{0,10} (seconds|minutes) and/i,
  /power cycle/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 4: "Before we send" / deflection (high confidence)
  // ═══════════════════════════════════════════════════════════════════════════
  /before (we send|scheduling|I schedule|we can send)/i,
  /let's troubleshoot/i,
  /let me walk you through/i,
  /let me help you (fix|diagnose|troubleshoot)/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 5: "When did you last" maintenance questions (medium confidence)
  // ═══════════════════════════════════════════════════════════════════════════
  /when did you last (change|replace|clean|service)/i,
  /have you (changed|replaced|cleaned) the/i,
  /when was the last time you/i
];

// ============================================================================
// CLASSIFICATION PATTERNS - Safe symptom/severity questions (ALLOWED)
// ============================================================================
// These are LEGITIMATE classification questions that dispatchers ASK.
// They help determine urgency and dispatch priority - NOT troubleshooting.
// 
// If a reply matches these, DO NOT flag it as troubleshooting.
// ============================================================================
const CLASSIFICATION_SAFE_PATTERNS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // Symptom classification (what's happening)
  // ═══════════════════════════════════════════════════════════════════════════
  /is (it|the|your) .{0,30}(running|working|making|leaking|dripping|smoking)/i,
  /is .{0,20} (completely|totally|not) (dead|broken|working)/i,
  /is (water|gas|smoke|air) .{0,15}(coming|leaking|visible)/i,
  /not (cooling|heating|turning on|working)/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Severity/urgency classification (how bad is it)
  // ═══════════════════════════════════════════════════════════════════════════
  /is (anyone|someone) in danger/i,
  /is (it|this|there) an emergency/i,
  /is (water|gas) actively/i,
  /how long has/i,
  /when did (this|it) start/i,
  /right now/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Location/scope classification (where/what)
  // ═══════════════════════════════════════════════════════════════════════════
  /which (room|area|unit|zone|floor)/i,
  /where (is|are) (the|your)/i,
  /what type of (system|unit|equipment)/i,
  /is (it|this) .{0,15}(indoor|outdoor|upstairs|downstairs)/i,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // State observation (not "change this")
  // ═══════════════════════════════════════════════════════════════════════════
  /is the .{0,20} on or off/i,
  /is it (on|off|running|stopped)/i,
  /what (is|does) .{0,20} (look|sound|smell) like/i
];

// ============================================================================
// BOOKING MOMENTUM PATTERNS (SHOULD appear when in SCHEDULING phase)
// ============================================================================
// Only required when bookingPhase is 'SCHEDULING' or 'CONFIRMATION'.
// NOT required during DISCOVERY or CLASSIFICATION phases.
// ============================================================================
const BOOKING_MOMENTUM_PATTERNS = [
  // Time slot language
  /morning|afternoon|evening/i,
  /today|tomorrow|this week|next week/i,
  /\d{1,2}(:\d{2})?\s*(am|pm)/i,
  /available|availability/i,
  
  // Scheduling action language
  /schedule|appointment|booking/i,
  /technician|tech|specialist/i,
  /send (someone|a tech|our)/i,
  /get (someone|a tech) out/i,
  
  // Confirmation language
  /does .* work for you/i,
  /would .* work/i,
  /i can (get|have|schedule|send)/i,
  /we can (get|have|send|schedule)/i,
  /let me (get|have|schedule|book)/i
];

// ============================================================================
// HARD FAIL RULES
// ============================================================================
// These are dealbreakers that cap the score regardless of other checks.
// ============================================================================
const HARD_FAIL_RULES = {
  NAME_PLACEHOLDER_LEAK: {
    name: 'name_placeholder_leak',
    maxScore: 40,
    description: '{name} placeholder in final output - customer-facing cringe'
  },
  BANNED_PHRASE: {
    name: 'banned_phrase',
    maxScore: 50,
    description: 'Explicitly banned phrase detected'
  }
};

// ============================================================================
// VERBOSITY THRESHOLDS
// ============================================================================
// Dispatchers should be brief. Long replies kill TTS latency.
// ============================================================================
const DEFAULT_VERBOSITY_LIMITS = {
  maxWords: 60,           // Default max words for voice
  maxWordsBooking: 80,    // Slightly more for booking confirmations
  maxChars: 350,          // Character fallback
  idealWords: 25          // Under this is ideal
};

// ============================================================================
// PLACEHOLDER PATTERNS
// ============================================================================
// {name} is the most critical, but any placeholder leak is a quality problem.
// ============================================================================
const NAME_PLACEHOLDER_PATTERN = /\{name\}/i;
const ANY_PLACEHOLDER_PATTERN = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;  // Any {variable_name}

// ============================================================================
// MODES THAT DON'T REQUIRE BOOKING MOMENTUM
// ============================================================================
// Booking momentum is only checked when mode === 'BOOKING'
// These modes should NOT be penalized for missing scheduling language
// ============================================================================
const NON_BOOKING_MODES = [
  'DISCOVERY',      // Still figuring out what caller needs
  'SUPPORT',        // General support, not booking
  'TRANSFER',       // Transferring to human
  'MESSAGE_TAKE',   // After-hours message taking
  'EMERGENCY',      // Emergency dispatch (different flow)
  'COMPLETE'        // Already done
];

/**
 * Check if a phrase is a classification question (allowed) vs troubleshooting (not allowed)
 * 
 * @param {string} phrase - The matched phrase to check
 * @param {string} fullReply - The full reply for context
 * @returns {boolean} True if this is a safe classification question
 */
function isClassificationSafe(phrase, fullReply) {
  // Check if the full reply matches any classification-safe patterns
  for (const safePattern of CLASSIFICATION_SAFE_PATTERNS) {
    if (safePattern.test(fullReply)) {
      // Found a classification context - check if the phrase is part of it
      const match = fullReply.match(safePattern);
      if (match && phrase.toLowerCase().includes(match[0].toLowerCase().substring(0, 10))) {
        return true;
      }
    }
  }
  
  // Also check if the phrase itself matches safe patterns
  for (const safePattern of CLASSIFICATION_SAFE_PATTERNS) {
    if (safePattern.test(phrase)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Count words in a string
 */
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Main compliance check function
 * 
 * @param {string} reply - The LLM-generated reply text
 * @param {Object} options - Configuration options
 * @param {Object} options.company - Company object with aiAgentSettings
 * @param {string|null} options.callerName - Caller's name if known
 * @param {string} options.scenarioType - Type of scenario (BOOKING, FAQ, etc.)
 * @param {string} options.bookingPhase - CLASSIFICATION|SCHEDULING|CONFIRMATION (null if not booking)
 * @param {string} options.effectiveMode - DISCOVERY|SUPPORT|BOOKING|TRANSFER|MESSAGE_TAKE|EMERGENCY|COMPLETE
 * @param {number} options.maxWords - Override max words limit
 * @param {Array} options.customTroubleshootingPatterns - Additional patterns to check
 * @returns {Object} Compliance result with score, checks, and violations
 */
function checkCompliance(reply, options = {}) {
  const {
    company = {},
    callerName = null,
    scenarioType = null,
    bookingPhase = null,
    effectiveMode = 'DISCOVERY',  // NEW: Mode determines if booking momentum required
    expectedBookingMomentum = false, // Legacy support (deprecated)
    maxWords = null,
    customTroubleshootingPatterns = []
  } = options;
  
  if (!reply || typeof reply !== 'string') {
    return {
      score: 0,
      passed: false,
      hardFail: true,
      hardFailReason: 'no_reply',
      checks: {},
      violations: ['No reply to check']
    };
  }
  
  const checks = {};
  const violations = [];
  const hardFails = [];
  let totalWeight = 0;
  let weightedScore = 0;
  
  // =========================================================================
  // CHECK 1: Placeholder Leak (weight: 25, HARD FAIL for {name})
  // =========================================================================
  // {name} leak is HARD FAIL (customer-facing cringe)
  // Other placeholder leaks are soft fails (formatting problem)
  // =========================================================================
  const hasNamePlaceholder = NAME_PLACEHOLDER_PATTERN.test(reply);
  const hasAnyPlaceholder = ANY_PLACEHOLDER_PATTERN.test(reply);
  const otherPlaceholders = hasAnyPlaceholder && !hasNamePlaceholder 
    ? (reply.match(ANY_PLACEHOLDER_PATTERN) || []) 
    : [];
  
  const hasCallerName = !!callerName && callerName.trim().length > 0;
  const mentionsName = hasCallerName && reply.toLowerCase().includes(callerName.toLowerCase());
  
  let nameUsageCorrect = true;
  let nameUsageReason = 'correct';
  
  if (hasNamePlaceholder) {
    // CRITICAL HARD FAIL: {name} placeholder should NEVER appear in final output
    nameUsageCorrect = false;
    nameUsageReason = 'name_placeholder_leaked';
    violations.push('HARD FAIL: Name placeholder {name} leaked into output');
    hardFails.push(HARD_FAIL_RULES.NAME_PLACEHOLDER_LEAK);
  } else if (otherPlaceholders.length > 0) {
    // Soft fail: other placeholders leaked (formatting issue, not catastrophic)
    nameUsageCorrect = false;
    nameUsageReason = 'other_placeholder_leaked';
    violations.push(`Placeholder leaked: ${otherPlaceholders.slice(0, 3).join(', ')}`);
    // Not a hard fail, but still fails this check
  } else if (hasCallerName && !mentionsName) {
    nameUsageReason = 'name_available_not_used';
  } else if (hasCallerName && mentionsName) {
    nameUsageReason = 'name_used_correctly';
  }
  
  checks.nameUsage = {
    passed: nameUsageCorrect,
    hasCallerName,
    usedName: mentionsName,
    reason: nameUsageReason,
    otherPlaceholders: otherPlaceholders.slice(0, 3),
    weight: 25,
    hardFail: hasNamePlaceholder
  };
  
  totalWeight += 25;
  if (checks.nameUsage.passed) {
    weightedScore += 25;
  }
  
  // =========================================================================
  // CHECK 2: Banned Phrases (weight: 25, HARD FAIL if detected)
  // =========================================================================
  const bannedPhrases = company?.aiAgentSettings?.frontDeskBehavior?.forbiddenPhrases || [];
  const bannedFound = [];
  
  for (const phrase of bannedPhrases) {
    if (phrase && reply.toLowerCase().includes(phrase.toLowerCase())) {
      bannedFound.push(phrase);
    }
  }
  
  const hasBannedPhrase = bannedFound.length > 0;
  
  checks.bannedPhrases = {
    passed: !hasBannedPhrase,
    found: bannedFound,
    weight: 25,
    hardFail: hasBannedPhrase
  };
  
  totalWeight += 25;
  if (checks.bannedPhrases.passed) {
    weightedScore += 25;
  } else {
    violations.push(`HARD FAIL: Banned phrases found: ${bannedFound.slice(0, 3).join(', ')}`);
    hardFails.push(HARD_FAIL_RULES.BANNED_PHRASE);
  }
  
  // =========================================================================
  // CHECK 3: Troubleshooting Detection (weight: 20)
  // With classification-safe carveout
  // =========================================================================
  const allTroubleshootingPatterns = [
    ...TROUBLESHOOTING_PATTERNS,
    ...customTroubleshootingPatterns
  ];
  
  const troubleshootingFound = [];
  for (const pattern of allTroubleshootingPatterns) {
    const match = reply.match(pattern);
    if (match) {
      const matchedPhrase = match[0];
      // Check if this is actually a classification question (safe)
      if (!isClassificationSafe(matchedPhrase, reply)) {
        troubleshootingFound.push(matchedPhrase);
      }
    }
  }
  
  // Dedupe
  const uniqueTroubleshooting = [...new Set(troubleshootingFound)];
  
  checks.troubleshooting = {
    passed: uniqueTroubleshooting.length === 0,
    found: uniqueTroubleshooting.slice(0, 5),
    weight: 20
  };
  
  totalWeight += 20;
  if (checks.troubleshooting.passed) {
    weightedScore += 20;
  } else {
    violations.push(`Troubleshooting detected: ${uniqueTroubleshooting.slice(0, 3).join(', ')}`);
  }
  
  // =========================================================================
  // CHECK 4: Verbosity / Length (weight: 15)
  // =========================================================================
  const wordCount = countWords(reply);
  const charCount = reply.length;
  const effectiveMaxWords = maxWords || (bookingPhase === 'CONFIRMATION' 
    ? DEFAULT_VERBOSITY_LIMITS.maxWordsBooking 
    : DEFAULT_VERBOSITY_LIMITS.maxWords);
  
  const isUnderLimit = wordCount <= effectiveMaxWords;
  const isIdeal = wordCount <= DEFAULT_VERBOSITY_LIMITS.idealWords;
  
  checks.verbosity = {
    passed: isUnderLimit,
    wordCount,
    charCount,
    maxWords: effectiveMaxWords,
    isIdeal,
    weight: 15
  };
  
  totalWeight += 15;
  if (checks.verbosity.passed) {
    weightedScore += 15;
  } else {
    violations.push(`Too verbose: ${wordCount} words (max ${effectiveMaxWords})`);
  }
  
  // =========================================================================
  // CHECK 5: Booking Momentum (weight: 15, only when mode=BOOKING + phase=SCHEDULING/CONFIRMATION)
  // =========================================================================
  // CRITICAL: Only require booking momentum when:
  // - effectiveMode is 'BOOKING' (not TRANSFER, MESSAGE_TAKE, EMERGENCY, etc.)
  // - AND bookingPhase is SCHEDULING or CONFIRMATION
  // 
  // This prevents false "missing momentum" errors on:
  // - Message-taking calls (after hours)
  // - Transfer calls
  // - Emergency dispatch calls
  // - Discovery/classification phases
  // =========================================================================
  const isBookingModeForMomentum = effectiveMode === 'BOOKING' && !NON_BOOKING_MODES.includes(effectiveMode);
  const requireBookingMomentum = isBookingModeForMomentum && 
    (bookingPhase === 'SCHEDULING' || bookingPhase === 'CONFIRMATION');
  
  // Also check legacy support (deprecated)
  const legacyRequiresMomentum = expectedBookingMomentum && !NON_BOOKING_MODES.includes(effectiveMode);
  
  if (requireBookingMomentum || legacyRequiresMomentum) {
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
      bookingPhase,
      effectiveMode,
      weight: 15
    };
    
    totalWeight += 15;
    if (checks.bookingMomentum.passed) {
      weightedScore += 15;
    } else {
      violations.push(`Missing booking momentum in ${bookingPhase || 'booking'} phase (mode: ${effectiveMode})`);
    }
  } else {
    // Track that we skipped this check (for debugging)
    checks.bookingMomentum = {
      passed: true,
      skipped: true,
      reason: `Mode '${effectiveMode}' does not require booking momentum`,
      effectiveMode,
      bookingPhase,
      weight: 0
    };
  }
  
  // =========================================================================
  // CALCULATE FINAL SCORE (with hard fail caps)
  // =========================================================================
  let score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  
  // Apply hard fail caps
  let hardFail = false;
  let hardFailReason = null;
  
  if (hardFails.length > 0) {
    hardFail = true;
    // Use the lowest maxScore among hard fails
    const worstFail = hardFails.reduce((worst, fail) => 
      fail.maxScore < worst.maxScore ? fail : worst, hardFails[0]);
    hardFailReason = worstFail.name;
    
    // Cap the score
    if (score > worstFail.maxScore) {
      score = worstFail.maxScore;
    }
  }
  
  // Pass threshold is 70%, but hard fails always fail regardless of score
  const passed = !hardFail && score >= 70;
  
  return {
    score,
    passed,
    hardFail,
    hardFailReason,
    checks,
    violations,
    // Metadata for logging
    _meta: {
      totalWeight,
      weightedScore,
      checksRun: Object.keys(checks).length,
      hardFailCount: hardFails.length
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
 * Quick check for troubleshooting language only (with classification carveout)
 */
function quickTroubleshootingCheck(reply) {
  if (!reply) return { passed: true, found: [] };
  
  const found = [];
  for (const pattern of TROUBLESHOOTING_PATTERNS) {
    const match = reply.match(pattern);
    if (match) {
      // Check if it's actually a classification question
      if (!isClassificationSafe(match[0], reply)) {
        found.push(match[0]);
        if (found.length >= 3) break; // Early exit for performance
      }
    }
  }
  
  return { passed: found.length === 0, found };
}

/**
 * Quick check for name placeholder leak (critical)
 */
function quickNamePlaceholderCheck(reply) {
  if (!reply) return { passed: true, leaked: false };
  const leaked = NAME_PLACEHOLDER_PATTERN.test(reply);
  return { passed: !leaked, leaked };
}

/**
 * Quick verbosity check
 */
function quickVerbosityCheck(reply, maxWords = DEFAULT_VERBOSITY_LIMITS.maxWords) {
  if (!reply) return { passed: true, wordCount: 0 };
  const wordCount = countWords(reply);
  return { 
    passed: wordCount <= maxWords, 
    wordCount, 
    maxWords,
    isIdeal: wordCount <= DEFAULT_VERBOSITY_LIMITS.idealWords
  };
}

/**
 * Build compliance summary for logging (keep it compact)
 */
function buildComplianceSummary(complianceResult) {
  if (!complianceResult) return null;
  
  const nameCheck = complianceResult.checks.nameUsage;
  const bookingCheck = complianceResult.checks.bookingMomentum;
  
  return {
    score: complianceResult.score,
    passed: complianceResult.passed,
    hardFail: complianceResult.hardFail || false,
    hardFailReason: complianceResult.hardFailReason || null,
    bannedHit: !complianceResult.checks.bannedPhrases?.passed,
    troubleshootHit: !complianceResult.checks.troubleshooting?.passed,
    // Name/placeholder checks
    nameCorrect: nameCheck?.passed ?? true,
    namePlaceholderLeak: nameCheck?.reason === 'name_placeholder_leaked',
    otherPlaceholderLeak: nameCheck?.reason === 'other_placeholder_leaked',
    // Verbosity
    verbosityOk: complianceResult.checks.verbosity?.passed ?? true,
    wordCount: complianceResult.checks.verbosity?.wordCount || null,
    // Booking momentum (only relevant when not skipped)
    bookingMomentum: bookingCheck?.skipped ? null : (bookingCheck?.passed ?? null),
    bookingMomentumSkipped: bookingCheck?.skipped || false,
    // Metadata
    violationCount: complianceResult.violations?.length || 0
  };
}

module.exports = {
  checkCompliance,
  quickBannedCheck,
  quickTroubleshootingCheck,
  quickNamePlaceholderCheck,
  quickVerbosityCheck,
  buildComplianceSummary,
  // Export for testing/extension
  TROUBLESHOOTING_PATTERNS,
  CLASSIFICATION_SAFE_PATTERNS,
  BOOKING_MOMENTUM_PATTERNS,
  HARD_FAIL_RULES,
  DEFAULT_VERBOSITY_LIMITS,
  NON_BOOKING_MODES
};

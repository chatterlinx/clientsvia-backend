/**
 * ⚠️ DEPRECATED — PERMANENTLY EMPTIED — Mar 1, 2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file previously contained ~60 hardcoded keyword arrays across 6 behavior
 * buckets (describingProblem, trustConcern, callerFeelsIgnored, refusedSlot,
 * wantsBooking, directIntentPatterns).
 *
 * WHY THIS IS A VIOLATION:
 * - Keyword arrays ran silently at runtime with ZERO admin visibility
 * - Admins had no way to see, configure, or disable them
 * - They influenced call behavior without appearing in any UI or event log
 * - Classic hidden nightmare — directly violates the platform's UI-driven rule
 *
 * WHY THEY'RE GONE:
 * - Agent 2.0 with TriggerCardMatcher fully replaces all detection logic
 * - ScrabEngine handles vocabulary normalization and token expansion
 * - Agent2CallRouter handles intent classification (5-bucket system)
 * - All trigger content must live in GlobalTrigger system (Admin → Triggers)
 *
 * HISTORY:
 * - Created: V116 (pre-Agent2)
 * - ConsentGate.js (primary consumer) NUKED: Feb 22, 2026
 * - Remaining consumers verified dead: Mar 1, 2026
 *   routes/agentConsole/agentConsole.js checked for getDefaults() which never
 *   existed — always evaluated false. Effectively unreachable code.
 * - All arrays permanently emptied: Mar 1, 2026
 *
 * DO NOT RESTORE KEYWORD ARRAYS HERE.
 * All detection logic belongs in the GlobalTrigger system (UI-driven).
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// All arrays emptied — content moved to GlobalTrigger system
const PLATFORM_DEFAULTS = {
  describingProblem:   [],
  trustConcern:        [],
  callerFeelsIgnored:  [],
  refusedSlot:         [],
  wantsBooking:        [],
  directIntentPatterns: []
};

function mergeTriggers(companyTriggers) {
  return Array.isArray(companyTriggers) ? companyTriggers : [];
}

function getTriggers(companyConfig, triggerType) {
  const companyTriggers = companyConfig?.[triggerType];
  return Array.isArray(companyTriggers) ? companyTriggers : [];
}

module.exports = {
  PLATFORM_DEFAULTS,
  mergeTriggers,
  getTriggers
};

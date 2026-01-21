/**
 * ============================================================================
 * SCENARIO SUGGESTION ENGINE (Per-Call, Deterministic) - Jan 2026
 * ============================================================================
 *
 * Purpose:
 * - Convert a raw BlackBox event timeline into an actionable "scenarios to build"
 *   checklist for coders/template builders.
 *
 * IMPORTANT:
 * - This is DIAGNOSTIC TOOLING ONLY. It does NOT affect runtime agent behavior.
 * - No LLM usage here. Heuristics are deterministic and explainable.
 * - Output is safe to show in admin UI because it only references THIS call's
 *   customer utterances under the requesting companyId.
 *
 * Inputs:
 * - events[] from BlackBoxRecording
 *
 * Outputs:
 * - suggestions[] ranked by impact (frequency, cost, latency)
 *
 * ============================================================================
 */

const DEFAULTS = {
  maxSuggestions: 8,
  maxExamplesPerSuggestion: 3,
  minCharsToConsider: 6
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmptyUtterance(text) {
  return !text || !String(text).trim();
}

function classifyIntent(text) {
  const t = normalizeText(text);

  if (!t) return { key: 'silence_or_empty', label: 'Silence / Empty Input' };

  // Meta: repeat / confirm / clarification
  if (
    /\b(say that again|repeat|what (was|is) that|can you repeat|i didn'?t catch|i didn'?t hear|come again)\b/.test(t)
  ) {
    return { key: 'repeat_or_clarify', label: 'Repeat / Clarify' };
  }

  // Meta: number / phone / address confirmation
  if (
    /\b(what number|what phone|what address|which address|do you have (my )?address|do you have an address|what address do you have)\b/.test(t)
  ) {
    return { key: 'confirm_address_or_phone', label: 'Confirm Address/Phone We Have' };
  }

  // Service history / technician identity
  if (
    /\b(who (was|is) (the )?(tech|technician)|which tech|what was the technician|who came (out|by)|which technician)\b/.test(t)
  ) {
    return { key: 'technician_identity', label: 'Technician Identity / Prior Visit' };
  }

  // Frustration / "you didn't answer"
  if (
    /\b(you didn'?t answer|that'?s not what i asked|listen to what i said|i just asked you|are you listening)\b/.test(t)
  ) {
    return { key: 'conversation_repair', label: 'Conversation Repair / Frustration Recovery' };
  }

  // Booking intent (broad; scenario builders may already have it)
  if (/\b(schedule|appointment|book|set up|come out|technician to come)\b/.test(t)) {
    return { key: 'booking_request', label: 'Booking / Scheduling Request' };
  }

  // Default: unknown / misc
  return { key: 'unclassified_gap', label: 'Unclassified Coverage Gap' };
}

function buildScenarioSuggestion(intentKey, intentLabel, examples, meta) {
  const base = {
    intentKey,
    intentLabel,
    suggestedScenarioName: null,
    recommendedTier: 'tier1',
    triggers: [],
    negativeTriggers: [],
    responseGoal: null,
    examples,
    evidence: meta
  };

  switch (intentKey) {
    case 'silence_or_empty':
      return {
        ...base,
        suggestedScenarioName: 'No Response / Silence (Prompt Again)',
        triggers: ['[silence]', '[no input]'],
        negativeTriggers: [],
        responseGoal: 'Prompt politely again with one short question; do not call Tier-3.'
      };
    case 'repeat_or_clarify':
      return {
        ...base,
        suggestedScenarioName: 'Repeat / Clarify (Meta Control)',
        triggers: ['repeat that', 'say that again', "i didn't catch that", "i didn't hear you"],
        negativeTriggers: ['schedule', 'appointment', 'emergency'],
        responseGoal: 'Repeat the last key info (number/address/time) OR ask what they want repeated, then continue.'
      };
    case 'confirm_address_or_phone':
      return {
        ...base,
        suggestedScenarioName: 'Confirm Address/Phone On File (Meta Control)',
        triggers: ['what address do you have', 'do you have my address', 'what number is that', 'what phone number'],
        negativeTriggers: ['new address', 'change address', 'wrong number'],
        responseGoal: 'Confirm the stored address/phone and offer to update it; keep to one sentence + one question.'
      };
    case 'technician_identity':
      return {
        ...base,
        suggestedScenarioName: 'Who Was The Technician? (Service History)',
        triggers: ['who was the technician', 'which technician came out', 'who came out'],
        negativeTriggers: ['schedule', 'appointment', 'price'],
        responseGoal: 'Ask for identifying info (address/phone/date of visit). If history lookup exists, trigger it; otherwise offer follow-up.'
      };
    case 'conversation_repair':
      return {
        ...base,
        suggestedScenarioName: "Conversation Repair: 'You Didn't Answer' (De-escalation)",
        triggers: ["you didn't answer", "that's not what i asked", 'are you listening', 'i just asked you'],
        negativeTriggers: [],
        responseGoal: 'Acknowledge, restate their last question in your own words, then answer or ask one clarifier.'
      };
    case 'booking_request':
      return {
        ...base,
        suggestedScenarioName: 'Schedule Technician (Direct Booking Fast Path)',
        triggers: ['schedule', 'appointment', 'book', 'technician to come out'],
        negativeTriggers: ['cancel', 'reschedule', 'price only'],
        responseGoal: 'Enter booking flow immediately; ask next required slot question.'
      };
    default:
      return {
        ...base,
        suggestedScenarioName: 'Unmatched Caller Intent (Coverage Gap)',
        triggers: [],
        negativeTriggers: [],
        responseGoal: 'Create a new scenario for this repeated phrase pattern so Tier-3 is not needed.'
      };
  }
}

function scoreSuggestion({ count, tier3Count, avgTier3LatencyMs }) {
  // Simple explainable scoring: frequency + tier3 pain.
  const freq = Math.min(10, count);
  const tier3Penalty = Math.min(10, tier3Count * 2);
  const latencyPenalty = avgTier3LatencyMs ? Math.min(10, Math.round(avgTier3LatencyMs / 800)) : 0;
  return freq + tier3Penalty + latencyPenalty;
}

function suggestFromEvents(events = [], options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  // Collect "problem turns" from events. We prefer GATHER_FINAL text for user input.
  const gatherFinals = events.filter(e => e?.type === 'GATHER_FINAL');
  const noMatchEvents = events.filter(e => e?.type === 'SCENARIO_NO_MATCH');
  const tier3Events = events.filter(e => e?.type === 'TIER3_FALLBACK');
  const actualTimeouts = events.filter(e => e?.type === 'GATHER_TIMEOUT_ACTUAL');

  // Helper: find the most recent gather text before time t.
  const findPrevGatherText = (t) => {
    const prev = gatherFinals.filter(g => (g.t || 0) <= (t || 0)).pop();
    return prev?.data?.text ?? '';
  };

  const candidateUtterances = [];

  // Primary: scenario no match → utterance
  for (const nm of noMatchEvents) {
    const userText = findPrevGatherText(nm.t);
    if (isEmptyUtterance(userText)) continue;
    const normalized = normalizeText(userText);
    if (normalized.length < cfg.minCharsToConsider) continue;
    candidateUtterances.push({
      t: nm.t,
      userText,
      normalized,
      reason: 'scenario_no_match'
    });
  }

  // Secondary: actual no-input timeout → empty utterance marker
  for (const to of actualTimeouts) {
    candidateUtterances.push({
      t: to.t,
      userText: '',
      normalized: '',
      reason: 'gather_timeout_actual'
    });
  }

  // If we have none, return empty.
  if (candidateUtterances.length === 0) {
    return {
      available: true,
      suggestions: [],
      summary: {
        totalGaps: 0,
        totalTier3Fallbacks: tier3Events.length,
        message: 'No scenario gaps detected in this call timeline.'
      }
    };
  }

  // Group by intent classification.
  const groups = new Map(); // intentKey -> { label, examples[], stats }
  for (const u of candidateUtterances) {
    const { key, label } = classifyIntent(u.userText);
    if (!groups.has(key)) {
      groups.set(key, {
        intentKey: key,
        intentLabel: label,
        examples: [],
        stats: { count: 0, tier3Count: 0, tier3LatencyMs: [] }
      });
    }
    const g = groups.get(key);
    g.stats.count += 1;

    // Capture example utterances (keep unique)
    if (g.examples.length < cfg.maxExamplesPerSuggestion) {
      const ex = isEmptyUtterance(u.userText) ? '[silence]' : String(u.userText).trim();
      if (!g.examples.includes(ex)) g.examples.push(ex);
    }
  }

  // Attach tier3 pain stats by looking at tier3 events and mapping to the prior gather.
  for (const t3 of tier3Events) {
    const userText = findPrevGatherText(t3.t);
    const { key } = classifyIntent(userText);
    const g = groups.get(key);
    if (!g) continue;
    g.stats.tier3Count += 1;
    if (t3?.data?.latencyMs) g.stats.tier3LatencyMs.push(t3.data.latencyMs);
  }

  // Build ranked suggestions.
  const suggestions = Array.from(groups.values()).map(g => {
    const avgTier3LatencyMs =
      g.stats.tier3LatencyMs.length > 0
        ? Math.round(g.stats.tier3LatencyMs.reduce((a, b) => a + b, 0) / g.stats.tier3LatencyMs.length)
        : 0;

    const suggestion = buildScenarioSuggestion(
      g.intentKey,
      g.intentLabel,
      g.examples,
      {
        count: g.stats.count,
        tier3Count: g.stats.tier3Count,
        avgTier3LatencyMs
      }
    );

    return {
      ...suggestion,
      score: scoreSuggestion({
        count: g.stats.count,
        tier3Count: g.stats.tier3Count,
        avgTier3LatencyMs
      })
    };
  });

  suggestions.sort((a, b) => b.score - a.score);

  const top = suggestions.slice(0, cfg.maxSuggestions);
  const totalTier3 = tier3Events.length;

  return {
    available: true,
    suggestions: top,
    summary: {
      totalGaps: candidateUtterances.length,
      totalTier3Fallbacks: totalTier3,
      message: `Suggested ${top.length} scenario(s) to reduce Tier-3 fallbacks and improve speed.`
    }
  };
}

module.exports = {
  suggestFromEvents
};


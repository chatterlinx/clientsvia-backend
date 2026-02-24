/**
 * ============================================================================
 * AGENT 2.0 LLM TRIGGER SERVICE
 * ============================================================================
 *
 * Generates constrained LLM responses for LLM-mode trigger cards.
 * The LLM ONLY uses the provided fact packs - no external knowledge allowed.
 *
 * HARD RULES (NON-NEGOTIABLE):
 * 1. LLM runs ONLY when trigger has responseMode='llm' - nowhere else
 * 2. LLM outputs informational text ONLY - agent controls follow-up
 * 3. Post-filter ALL LLM output (strip questions, hard cut length)
 * 4. If LLM fails → use trigger's backupAnswer (deterministic, not generic fluff)
 * 5. Fact packs are kept tight (2500 chars max each)
 *
 * GUARDRAILS:
 * - Response capped at 3 sentences / 300 characters (HARD CUT)
 * - All question marks stripped (agent owns follow-up)
 * - Time slots and scheduling language blocked
 * - Tone hardcoded to "concise professional" (no admin tuning)
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION - TIGHT LIMITS
// ════════════════════════════════════════════════════════════════════════════════

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 100;
const DEFAULT_TEMPERATURE = 0.2;

const MAX_SENTENCES = 3;
const MAX_CHARACTERS = 300;
const MAX_FACT_PACK_CHARS = 2500;
const API_TIMEOUT_MS = 4000;

// ════════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT - HARDCODED TONE (no admin tuning)
// ════════════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(factPack) {
  const includedFacts = (factPack.includedFacts || '').substring(0, MAX_FACT_PACK_CHARS);
  const excludedFacts = (factPack.excludedFacts || '').substring(0, MAX_FACT_PACK_CHARS);

  return `You are a phone agent. Answer the caller's question using ONLY the facts below.

RULES:
- Use ONLY facts from the packs below. Do not add anything.
- 1-2 sentences max. Be concise.
- Do NOT ask questions. Do NOT offer to schedule.
- If caller asks something not in the facts, say "I'd need to check on that."
- End with a period, not a question.

WHAT'S INCLUDED:
${includedFacts || '(none provided)'}

WHAT'S NOT INCLUDED:
${excludedFacts || '(none provided)'}

Respond in 1-2 short sentences. No questions.`;
}

// ════════════════════════════════════════════════════════════════════════════════
// POST-FILTER - HARD ENFORCEMENT (dumb but strong)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Post-filter LLM output with HARD rules.
 * This runs AFTER validation - catches anything LLM slipped through.
 * 
 * @param {string} text - Raw LLM response
 * @returns {{ text: string, filtered: boolean, actions: string[] }}
 */
function postFilterResponse(text) {
  if (!text || typeof text !== 'string') {
    return { text: '', filtered: true, actions: ['EMPTY_INPUT'] };
  }

  const actions = [];
  let result = text.trim();

  // 1. Strip ALL question marks (agent owns follow-up)
  if (result.includes('?')) {
    result = result.replace(/\?/g, '.');
    actions.push('STRIPPED_QUESTIONS');
  }

  // 2. Remove any sentences that are questions (even without ?)
  const questionPatterns = [
    /would you like[^.!]*[.!]?/gi,
    /can I (help|get|schedule)[^.!]*[.!]?/gi,
    /shall I[^.!]*[.!]?/gi,
    /do you want[^.!]*[.!]?/gi,
    /how about[^.!]*[.!]?/gi,
    /is there anything else[^.!]*[.!]?/gi
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '');
      actions.push('REMOVED_QUESTION_PHRASE');
    }
  }

  // 3. Hard cut to MAX_SENTENCES (split on sentence endings)
  const sentences = result.split(/(?<=[.!])\s+/).filter(s => s.trim().length > 0);
  if (sentences.length > MAX_SENTENCES) {
    result = sentences.slice(0, MAX_SENTENCES).join(' ');
    actions.push(`CUT_TO_${MAX_SENTENCES}_SENTENCES`);
  }

  // 4. Hard cut to MAX_CHARACTERS
  if (result.length > MAX_CHARACTERS) {
    result = result.substring(0, MAX_CHARACTERS);
    const lastPeriod = result.lastIndexOf('.');
    if (lastPeriod > MAX_CHARACTERS * 0.5) {
      result = result.substring(0, lastPeriod + 1);
    } else {
      result = result.trim() + '.';
    }
    actions.push(`CUT_TO_${MAX_CHARACTERS}_CHARS`);
  }

  // 5. Clean up whitespace
  result = result.replace(/\s+/g, ' ').trim();

  // 6. Ensure ends with period (not mid-sentence)
  if (result.length > 0 && !/[.!]$/.test(result)) {
    result += '.';
    actions.push('ADDED_PERIOD');
  }

  return {
    text: result,
    filtered: actions.length > 0,
    actions
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATION - DETECT VIOLATIONS (before post-filter)
// ════════════════════════════════════════════════════════════════════════════════

function validateResponse(response) {
  const violations = [];

  if (!response || typeof response !== 'string' || response.trim().length === 0) {
    violations.push('EMPTY_RESPONSE');
    return { valid: false, violations };
  }

  // Time slot patterns (hard block)
  const timeSlotPatterns = [
    /\d{1,2}:\d{2}\s*(am|pm)?/i,
    /\d{1,2}\s*(am|pm)/i,
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at/i,
    /tomorrow\s+at/i,
    /this\s+(morning|afternoon|evening)\s+at/i
  ];

  for (const pattern of timeSlotPatterns) {
    if (pattern.test(response)) {
      violations.push('TIME_SLOT_MENTIONED');
      break;
    }
  }

  // Scheduling language (hard block - use backup answer)
  const schedulingPhrases = [
    /i can get you scheduled/i,
    /let me book that/i,
    /your appointment is/i,
    /we have (an? )?(opening|slot|availability)/i,
    /i('ll| will) schedule/i,
    /book(ing|ed)? (a |an |the )?appointment/i
  ];

  for (const pattern of schedulingPhrases) {
    if (pattern.test(response)) {
      violations.push('SCHEDULING_LANGUAGE');
      break;
    }
  }

  return {
    valid: violations.length === 0,
    violations
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate an LLM response for an LLM-mode trigger card.
 * 
 * CRITICAL: This is the ONLY place LLM runs for triggers.
 * If this function is called, the trigger MUST have responseMode='llm'.
 *
 * @param {Object} params
 * @param {string} params.callerInput - What the caller asked
 * @param {Object} params.factPack - { includedFacts, excludedFacts }
 * @param {string} params.backupAnswer - Deterministic fallback (NOT generic fluff)
 * @param {string} params.triggerLabel - Label of the matched trigger (for logging)
 * @param {string} params.triggerId - ID of the matched trigger
 * @param {string} params.companyId - Company ID
 * @param {Function} params.emit - Event emitter for observability
 * @returns {Promise<{ response: string, llmMeta: Object }>}
 */
async function generateLLMTriggerResponse({
  callerInput,
  factPack,
  backupAnswer,
  triggerLabel,
  triggerId,
  companyId,
  emit = () => {}
}) {
  const startTime = Date.now();

  // Deterministic backup - NEVER use generic fluff
  // If no backup provided, use a minimal acknowledgment that doesn't sound broken
  const fallbackResponse = backupAnswer && backupAnswer.trim().length > 0
    ? backupAnswer.trim()
    : "I can help with that.";

  const hasIncluded = factPack?.includedFacts && factPack.includedFacts.trim().length > 0;
  const hasExcluded = factPack?.excludedFacts && factPack.excludedFacts.trim().length > 0;

  // No facts = use backup answer (don't call LLM with nothing)
  if (!hasIncluded && !hasExcluded) {
    emit('A2_LLM_TRIGGER_SKIPPED', {
      triggerId,
      triggerLabel,
      reason: 'EMPTY_FACT_PACK',
      usedBackup: true
    });

    return {
      response: fallbackResponse,
      llmMeta: {
        called: false,
        usedBackup: true,
        reason: 'EMPTY_FACT_PACK'
      }
    };
  }

  emit('A2_LLM_TRIGGER_CALL_START', {
    triggerId,
    triggerLabel,
    inputPreview: callerInput?.substring(0, 80),
    factPackSize: {
      included: Math.min((factPack.includedFacts || '').length, MAX_FACT_PACK_CHARS),
      excluded: Math.min((factPack.excludedFacts || '').length, MAX_FACT_PACK_CHARS)
    }
  });

  try {
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const systemPrompt = buildSystemPrompt(factPack);
    const userPrompt = `Caller: "${callerInput}"\n\nAnswer in 1-2 sentences using only the facts above.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    const data = await response.json();
    const rawResponse = data.choices?.[0]?.message?.content?.trim() || '';
    const elapsedMs = Date.now() - startTime;

    // Step 1: Validate for hard violations
    const validation = validateResponse(rawResponse);

    if (!validation.valid) {
      logger.warn('[Agent2LLMTriggerService] Response violated hard rules - using backup', {
        triggerId,
        violations: validation.violations,
        responsePreview: rawResponse.substring(0, 60)
      });

      emit('A2_LLM_TRIGGER_VIOLATION', {
        triggerId,
        triggerLabel,
        violations: validation.violations,
        elapsedMs,
        usedBackup: true
      });

      return {
        response: fallbackResponse,
        llmMeta: {
          called: true,
          model: DEFAULT_MODEL,
          elapsedMs,
          tokensInput: data.usage?.prompt_tokens || 0,
          tokensOutput: data.usage?.completion_tokens || 0,
          usedBackup: true,
          reason: 'VALIDATION_FAILED',
          violations: validation.violations
        }
      };
    }

    // Step 2: Post-filter (strip questions, hard cut length)
    const filtered = postFilterResponse(rawResponse);

    // If post-filter resulted in empty/too-short, use backup
    if (filtered.text.length < 10) {
      emit('A2_LLM_TRIGGER_POST_FILTER_FAILED', {
        triggerId,
        triggerLabel,
        filterActions: filtered.actions,
        resultLength: filtered.text.length,
        usedBackup: true
      });

      return {
        response: fallbackResponse,
        llmMeta: {
          called: true,
          model: DEFAULT_MODEL,
          elapsedMs,
          usedBackup: true,
          reason: 'POST_FILTER_TOO_SHORT',
          filterActions: filtered.actions
        }
      };
    }

    emit('A2_LLM_TRIGGER_CALL_COMPLETE', {
      triggerId,
      triggerLabel,
      elapsedMs,
      model: DEFAULT_MODEL,
      tokensInput: data.usage?.prompt_tokens || 0,
      tokensOutput: data.usage?.completion_tokens || 0,
      responseLength: filtered.text.length,
      wasFiltered: filtered.filtered,
      filterActions: filtered.actions,
      usedBackup: false
    });

    return {
      response: filtered.text,
      llmMeta: {
        called: true,
        model: DEFAULT_MODEL,
        elapsedMs,
        tokensInput: data.usage?.prompt_tokens || 0,
        tokensOutput: data.usage?.completion_tokens || 0,
        usedBackup: false,
        wasFiltered: filtered.filtered,
        filterActions: filtered.actions
      }
    };

  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    const isTimeout = error.name === 'AbortError';

    logger.error('[Agent2LLMTriggerService] LLM call failed - using backup', {
      triggerId,
      error: error.message,
      isTimeout,
      elapsedMs
    });

    emit('A2_LLM_TRIGGER_ERROR', {
      triggerId,
      triggerLabel,
      error: isTimeout ? 'TIMEOUT' : error.message,
      elapsedMs,
      usedBackup: true
    });

    // CRITICAL: Use backup answer, not generic fluff
    return {
      response: fallbackResponse,
      llmMeta: {
        called: false,
        usedBackup: true,
        reason: isTimeout ? 'TIMEOUT' : 'LLM_CALL_FAILED',
        error: error.message,
        elapsedMs
      }
    };
  }
}

module.exports = {
  generateLLMTriggerResponse,
  postFilterResponse,
  validateResponse,
  MAX_SENTENCES,
  MAX_CHARACTERS,
  MAX_FACT_PACK_CHARS
};

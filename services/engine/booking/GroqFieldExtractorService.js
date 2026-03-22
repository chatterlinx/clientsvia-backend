'use strict';

/**
 * GroqFieldExtractorService
 *
 * Groq-powered field state detection for booking data collection.
 * Replaces pure regex extraction when caller speech is messy, uncertain,
 * contains self-corrections, or mixes data with off-topic questions.
 *
 * States:
 *   PROVIDING        — clean value, extract and advance
 *   CORRECTING       — self-correction detected, use last stated value
 *   UNCERTAIN        — has a value but caller isn't sure → confirm it back
 *   SEARCHING        — caller is physically looking, no value yet → patience response
 *   OFF_TOPIC        — question/concern, not providing data → flag for 123BRP
 *   PROVIDING_WITH_Q — gave value AND asked a question → capture value + 123BRP
 */

const logger = require('../../../utils/logger');
const GroqStreamAdapter = require('../../streaming/adapters/GroqStreamAdapter');

// ── Constants ────────────────────────────────────────────────────────────────

const STATES = Object.freeze({
  PROVIDING:       'PROVIDING',
  CORRECTING:      'CORRECTING',
  UNCERTAIN:       'UNCERTAIN',
  SEARCHING:       'SEARCHING',
  OFF_TOPIC:       'OFF_TOPIC',
  PROVIDING_WITH_Q: 'PROVIDING_WITH_Q',
});

const FIELD_TYPES = Object.freeze({
  PHONE:   'PHONE',
  ADDRESS: 'ADDRESS',
  NAME:    'NAME',
  DAY:     'DAY',
  TIME:    'TIME',
});

const GROQ_TIMEOUT_MS = 3000;
const MODEL = 'llama-3.3-70b-versatile';

// ── Hesitation word sets ──────────────────────────────────────────────────────
//
// GENUINE HESITATION — signals the caller is searching, self-correcting, or truly
// unsure of their value. Force Groq even when regex found something.
// e.g. "wait, actually it was 239-565-2202" → CORRECTING; "let me look for it" → SEARCHING
const GENUINE_HESITATION_WORDS = [
  'wait', 'hold on', 'hold a second', 'actually', 'let me',
  'one second', 'hang on', 'not sure', "i'm not sure",
  'looking for', 'where is', 'i meant', 'scratch that', 'never mind',
  'i need to check', 'let me check', 'let me look', 'i have to look',
  'just moved', 'i just moved', "i don't know", 'i forgot', "i can't remember",
];

// SPEECH FILLERS — verbal tics that accompany a clean value and do NOT indicate
// real uncertainty. Do NOT force Groq when regex already found a value.
// e.g. "I think that would be 239-565-2202" → trust the regex, skip Groq.
const SPEECH_FILLER_WORDS = [
  'i think', 'i believe', 'i guess', 'probably', 'should be', 'i suppose',
];

// ── System prompts (JSON mode — "json" keyword required by Groq) ─────────────

const PROMPTS = {
  [FIELD_TYPES.PHONE]: `You extract phone numbers from spoken speech transcripts. The caller may self-correct (always use the last number stated). Detect if the caller is searching for their number. Return ONLY valid JSON with these fields: state (one of PROVIDING/CORRECTING/UNCERTAIN/SEARCHING/OFF_TOPIC/PROVIDING_WITH_Q), value (digits string only, or null), confidence (high/medium/low/null), needsConfirmation (bool), correctionDetected (bool), embeddedQuestion (string or null).`,

  [FIELD_TYPES.ADDRESS]: `You extract US service addresses from spoken speech transcripts. The caller may self-correct or give partial info. Detect if they are searching for the address. Extract all available address components. Return ONLY valid JSON with these fields: state (one of PROVIDING/CORRECTING/UNCERTAIN/SEARCHING/OFF_TOPIC/PROVIDING_WITH_Q), value (best full address string or null), confidence (high/medium/low/null), needsConfirmation (bool), correctionDetected (bool), embeddedQuestion (string or null), missingComponents (array containing any of: street/city/state/zip that are absent from the value).`,

  [FIELD_TYPES.NAME]: `You extract a person's name from spoken speech transcripts. Handle filler words and intro phrases like "my name is". The caller may self-correct. Return ONLY valid JSON with these fields: state (one of PROVIDING/CORRECTING/UNCERTAIN/SEARCHING/OFF_TOPIC/PROVIDING_WITH_Q), value (object with firstName and lastName strings, or null), confidence (high/medium/low/null), needsConfirmation (bool), correctionDetected (bool), embeddedQuestion (string or null).`,

  [FIELD_TYPES.DAY]: `You extract a preferred appointment day or date from spoken speech transcripts. Return ONLY valid JSON with these fields: state (one of PROVIDING/CORRECTING/UNCERTAIN/SEARCHING/OFF_TOPIC/PROVIDING_WITH_Q), value (day name or date string, or null), confidence (high/medium/low/null), needsConfirmation (bool), correctionDetected (bool), embeddedQuestion (string or null).`,

  [FIELD_TYPES.TIME]: `You extract a preferred appointment time from spoken speech transcripts. Return ONLY valid JSON with these fields: state (one of PROVIDING/CORRECTING/UNCERTAIN/SEARCHING/OFF_TOPIC/PROVIDING_WITH_Q), value (time string like "morning", "afternoon", "2:00 PM", or null), confidence (high/medium/low/null), needsConfirmation (bool), correctionDetected (bool), embeddedQuestion (string or null).`,
};

// ── Fallback result (returned on timeout or parse error) ─────────────────────

const FALLBACK_RESULT = Object.freeze({
  state:             STATES.PROVIDING,
  value:             null,
  confidence:        null,
  needsConfirmation: false,
  correctionDetected: false,
  embeddedQuestion:  null,
  missingComponents: [],
  _fallback:         true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the input contains genuine hesitation — the caller is
 * searching, self-correcting, or truly uncertain about their value.
 * Genuine hesitation forces Groq even when regex found something.
 *
 * Excludes SPEECH_FILLER_WORDS ("I think", "I believe") which are verbal tics
 * that accompany a clean value — those do NOT warrant a Groq call.
 *
 * @param {string} input
 * @returns {boolean}
 */
function hasGenuineHesitation(input) {
  if (!input) return false;
  const lower = input.toLowerCase();
  return GENUINE_HESITATION_WORDS.some(w => lower.includes(w));
}

/**
 * Backward-compatible alias. External callers that import hasTriggerWords
 * continue to work; the check now includes both genuine hesitation and
 * speech fillers so existing callers see no behavioral change.
 *
 * @param {string} input
 * @returns {boolean}
 */
function hasTriggerWords(input) {
  if (!input) return false;
  const lower = input.toLowerCase();
  return [...GENUINE_HESITATION_WORDS, ...SPEECH_FILLER_WORDS].some(w => lower.includes(w));
}

/**
 * Determines if the Groq path should be used instead of the fast regex path.
 *
 * Decision logic:
 *   - Regex found a value + NO genuine hesitation → fast path (trust regex).
 *     "I think that would be 239-565-2202" — "I think" is a speech filler,
 *     not genuine uncertainty. Groq would classify as UNCERTAIN and trigger
 *     a needless confirm loop, frustrating the caller.
 *   - Regex found a value + genuine hesitation → Groq (may be CORRECTING).
 *     "Wait, actually it was 239-565-2202" — self-correction signal.
 *   - Regex found nothing → Groq (may do better with messy speech).
 *
 * @param {string} input        — raw STT transcript
 * @param {*}      regexResult  — result of existing regex extractor (null = failed)
 * @returns {boolean}           — true = run Groq; false = use regexResult directly
 */
function needsGroqPath(input, regexResult) {
  if (!input?.trim()) return false;
  if (regexResult && !hasGenuineHesitation(input)) return false; // fast path
  if (hasGenuineHesitation(input)) return true;
  if (!regexResult) return true; // regex failed, Groq may recover
  return false;
}

// ── Core parse function ───────────────────────────────────────────────────────

/**
 * Parse caller input for a specific field type using Groq.
 *
 * @param {string} fieldType  — one of FIELD_TYPES.*
 * @param {string} userInput  — raw STT transcript from caller
 * @param {object} [opts]
 * @param {string} [opts.callSid]   — for logging
 * @param {string} [opts.step]      — current booking step label
 * @returns {Promise<ExtractionResult>}
 */
async function parse(fieldType, userInput, opts = {}) {
  const { callSid = 'unknown', step = '' } = opts;

  if (!userInput?.trim()) return { ...FALLBACK_RESULT };

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn('[GroqFieldExtractor] GROQ_API_KEY not set — using fallback', { callSid, fieldType });
    return { ...FALLBACK_RESULT };
  }

  const prompt = PROMPTS[fieldType];
  if (!prompt) {
    logger.warn('[GroqFieldExtractor] Unknown fieldType', { fieldType, callSid });
    return { ...FALLBACK_RESULT };
  }

  const groqCall = GroqStreamAdapter.streamFull({
    apiKey,
    model:       MODEL,
    maxTokens:   150,
    temperature: 0.1,
    jsonMode:    true,
    system:      prompt,
    messages:    [{ role: 'user', content: userInput.trim() }],
  });

  const timeoutPromise = new Promise(resolve =>
    setTimeout(() => resolve({ _timeout: true }), GROQ_TIMEOUT_MS)
  );

  let raw;
  try {
    raw = await Promise.race([groqCall, timeoutPromise]);
  } catch (err) {
    logger.warn('[GroqFieldExtractor] streamFull error', { callSid, fieldType, step, err: err.message });
    return { ...FALLBACK_RESULT };
  }

  if (raw?._timeout) {
    logger.warn('[GroqFieldExtractor] timeout', { callSid, fieldType, step, limitMs: GROQ_TIMEOUT_MS });
    return { ...FALLBACK_RESULT };
  }

  if (!raw?.response) {
    return { ...FALLBACK_RESULT };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw.response);
  } catch (_) {
    logger.warn('[GroqFieldExtractor] JSON parse failed', { callSid, fieldType, raw: raw.response?.slice(0, 100) });
    return { ...FALLBACK_RESULT };
  }

  // Validate state is a known value; default to PROVIDING if unrecognized
  const validStates = Object.values(STATES);
  const state = validStates.includes(parsed.state) ? parsed.state : STATES.PROVIDING;

  const result = {
    state,
    value:              parsed.value             ?? null,
    confidence:         parsed.confidence        ?? null,
    needsConfirmation:  !!parsed.needsConfirmation,
    correctionDetected: !!parsed.correctionDetected,
    embeddedQuestion:   parsed.embeddedQuestion  ?? null,
    missingComponents:  Array.isArray(parsed.missingComponents) ? parsed.missingComponents : [],
    _latencyMs:         raw.latencyMs,
  };

  logger.debug('[GroqFieldExtractor] result', {
    callSid, fieldType, step,
    state:    result.state,
    hasValue: !!result.value,
    confidence: result.confidence,
    latencyMs: result.latencyMs,
  });

  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  parse,
  needsGroqPath,
  hasTriggerWords,
  hasGenuineHesitation,
  STATES,
  FIELD_TYPES,
};

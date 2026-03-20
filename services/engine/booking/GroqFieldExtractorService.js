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

// Words that signal the caller is doing something other than cleanly providing data.
// Presence of any of these forces the Groq path even if regex found a value.
const TRIGGER_WORDS = [
  'wait', 'hold on', 'hold a second', 'actually', 'i think', 'let me',
  'one second', 'hang on', 'not sure', "i'm not sure", 'just moved',
  'looking for', 'where is', 'i meant', 'scratch that', 'never mind',
  'i need to check', 'let me check', 'let me look', 'i have to look',
  'i just moved', "i don't know", 'i forgot', 'i can\'t remember',
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
 * Returns true if the input contains trigger words that indicate the caller
 * is doing something other than cleanly providing a value.
 * @param {string} input
 * @returns {boolean}
 */
function hasTriggerWords(input) {
  if (!input) return false;
  const lower = input.toLowerCase();
  return TRIGGER_WORDS.some(w => lower.includes(w));
}

/**
 * Determines if the Groq path should be used instead of the fast path.
 * Fast path: regex already found a value AND no trigger words present.
 *
 * @param {string} input        — raw STT transcript
 * @param {*}      regexResult  — result of existing regex extractor (null = failed)
 * @returns {boolean}           — true = run Groq; false = use regexResult directly
 */
function needsGroqPath(input, regexResult) {
  if (!input?.trim()) return false;
  if (hasTriggerWords(input)) return true;
  if (!regexResult) return true;  // regex failed, Groq may do better
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
  STATES,
  FIELD_TYPES,
};

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SPEECH SANITIZATION GATE
// ════════════════════════════════════════════════════════════════════════════
// Single chokepoint to prevent internal/debug/error text from reaching
// callers via TTS (Twilio <Say> or ElevenLabs synthesis).
//
// If text fails any check, it is replaced entirely with a safe fallback.
// Checks are targeted at code artifacts, NOT legitimate speech.
// LLM-generated responses (which may contain newlines or brand names)
// must pass through cleanly.
// ════════════════════════════════════════════════════════════════════════════

const SAFE_FALLBACK = 'Thank you for calling. How can I help you today?';

// ── Blocklist: substring terms that should never appear in spoken output ──
// These are safe as substring matches — they are code/debug artifacts that
// will never appear as part of a legitimate English word.
const BLOCKED_SUBSTRINGS = [
  'referenceerror',
  'typeerror',
  'syntaxerror',
  'rangeerror',
  'urierror',
  'evalerror',
  '[object',
  'stacktrace',
  'stack trace',
  'generalerror',
  'general_error',
  'general error',
  'fixme',
  'console.log',
];

// ── Blocklist: whole-word terms requiring \b boundaries ───────────────────
// These must be matched as whole words only to avoid false positives on
// legitimate English words.
//   'NaN'         → without \b, matches "mai[NaN]ce" (maintenance). NaN is a
//                   JavaScript arithmetic artifact ("Your cost is NaN dollars").
//   'placeholder' → without \b, could collide in edge cases; kept whole-word.
// NOTE: 'exception' was removed — it is a common English word ("with the
//       exception of...") and produced false positives in LLM responses.
const BLOCKED_WHOLE_WORDS = [
  'NaN',
  'placeholder',
];

// Precompile both regexes once at startup
const BLOCKED_SUBSTRING_RE = new RegExp(
  BLOCKED_SUBSTRINGS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

const BLOCKED_WORD_RE = new RegExp(
  '\\b(?:' + BLOCKED_WHOLE_WORDS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'i'
);

// ── Heuristic checks for code/config artifacts ───────────────────────────

/**
 * Detects code-like syntax: braces, brackets, arrows, triple-equals, etc.
 */
const CODE_SYNTAX_RE = /[{}[\]]{2,}|=>|===|!==|::|&&|\|\||console\.|require\(|module\./;

/**
 * Detects JSON-like structures: {"key": or {key:
 */
const JSON_LIKE_RE = /\{[\s]*["']?\w+["']?\s*:/;

/**
 * Detects stack-trace-like patterns: "at FunctionName (file.js:123:45)"
 */
const STACK_TRACE_RE = /at\s+\w+\s*\(.*:\d+:\d+\)/;

/**
 * Detects LLM structured output leaked into speech text.
 * Catches patterns like "responseText: ... extraction: firstName: Mark"
 * which happen when the intake parser fails to extract the response.
 */
const LLM_STRUCTURED_RE = /\b(?:responseText|extraction|firstName|lastName|nextLane|doNotReask|callReason)\s*:/i;

/**
 * Sanitize text before it reaches TTS output.
 *
 * @param {*} text - The text to validate. Non-strings are rejected.
 * @param {Object} [options]
 * @param {string} [options.fallback] - Custom fallback text (must itself be clean).
 * @returns {string} The original text if safe, or the fallback.
 */
function sanitizeForSpeech(text, options = {}) {
  const fallback = options.fallback || SAFE_FALLBACK;
  const trap = options._trap || null; // MOUSETRAP: optional diagnostic output

  // ── Type guard: only strings pass ──────────────────────────────────────
  if (typeof text !== 'string') {
    if (trap) trap.reason = 'NOT_STRING';
    return fallback;
  }

  // ── Normalize whitespace: replace newlines/tabs with spaces ────────────
  // LLM responses commonly contain \n characters. These are not dangerous —
  // they just need to be flattened to single-line text for TTS.
  const cleaned = text.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // ── Length guard ───────────────────────────────────────────────────────
  if (cleaned.length < 2 || cleaned.length > 1000) {
    if (trap) trap.reason = `LENGTH_${cleaned.length}`;
    return fallback;
  }

  // ── Blocklist check ───────────────────────────────────────────────────
  // Two passes: substring match (code artifacts) + whole-word match (NaN etc.)
  if (BLOCKED_SUBSTRING_RE.test(cleaned) || BLOCKED_WORD_RE.test(cleaned)) {
    if (trap) trap.reason = 'BLOCKED_TERM';
    return fallback;
  }

  // ── Heuristic: code-like syntax ───────────────────────────────────────
  if (CODE_SYNTAX_RE.test(cleaned)) {
    if (trap) trap.reason = 'CODE_SYNTAX';
    return fallback;
  }

  // ── Heuristic: JSON-like structures ───────────────────────────────────
  if (JSON_LIKE_RE.test(cleaned)) {
    if (trap) trap.reason = 'JSON_LIKE';
    return fallback;
  }

  // ── Heuristic: stack trace patterns ───────────────────────────────────
  if (STACK_TRACE_RE.test(cleaned)) {
    if (trap) trap.reason = 'STACK_TRACE';
    return fallback;
  }

  // ── Heuristic: LLM structured output leaked into speech ─────────────
  // Catches intake parser failures where YAML-like key:value text
  // ("responseText: Hi Mark, extraction: firstName: Mark") slips through
  if (LLM_STRUCTURED_RE.test(cleaned)) {
    if (trap) trap.reason = 'LLM_STRUCTURED_LEAK';
    return fallback;
  }

  // All checks passed — text is safe for speech
  return cleaned;
}

module.exports = { sanitizeForSpeech, SAFE_FALLBACK };

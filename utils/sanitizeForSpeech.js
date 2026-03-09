'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SPEECH SANITIZATION GATE
// ════════════════════════════════════════════════════════════════════════════
// Single chokepoint to prevent internal/debug/error text from reaching
// callers via TTS (Twilio <Say> or ElevenLabs synthesis).
//
// If text fails any check, it is replaced entirely with a safe fallback.
// This is intentionally aggressive — a false positive (replacing valid text)
// is far less damaging than speaking garbage to a live caller.
// ════════════════════════════════════════════════════════════════════════════

const SAFE_FALLBACK = 'I apologize, could you repeat that?';

// ── Blocklist: terms that should never appear in spoken output ────────────
const BLOCKED_TERMS = [
  'referenceerror',
  'typeerror',
  'syntaxerror',
  'rangeerror',
  'urierror',
  'evalerror',
  'undefined',
  'null',
  '[object',
  'NaN',
  'stacktrace',
  'stack trace',
  'exception',
  'placeholder',
  'generalerror',
  'general_error',
  'general error',
  'todo',
  'fixme',
  'hack',
  'debug',
  'console.log',
];

// Precompile a single regex from all blocked terms (case-insensitive)
const BLOCKED_REGEX = new RegExp(
  BLOCKED_TERMS.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

// ── Heuristic checks for code/config artifacts ───────────────────────────

/**
 * Detects camelCase or PascalCase identifiers (e.g., llmAgentResult, ReferenceError).
 * Allows common English contractions and short words.
 */
const CAMEL_CASE_RE = /[a-z][A-Z][a-zA-Z]{2,}/;

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
 * Sanitize text before it reaches TTS output.
 *
 * @param {*} text - The text to validate. Non-strings are rejected.
 * @param {Object} [options]
 * @param {string} [options.fallback] - Custom fallback text (must itself be clean).
 * @returns {string} The original text if safe, or the fallback.
 */
function sanitizeForSpeech(text, options = {}) {
  const fallback = options.fallback || SAFE_FALLBACK;

  // ── Type guard: only strings pass ──────────────────────────────────────
  if (typeof text !== 'string') {
    return fallback;
  }

  const trimmed = text.trim();

  // ── Length guard ───────────────────────────────────────────────────────
  if (trimmed.length < 2 || trimmed.length > 1000) {
    return fallback;
  }

  // ── Blocklist check ───────────────────────────────────────────────────
  if (BLOCKED_REGEX.test(trimmed)) {
    return fallback;
  }

  // ── Heuristic: camelCase/PascalCase identifiers ───────────────────────
  if (CAMEL_CASE_RE.test(trimmed)) {
    return fallback;
  }

  // ── Heuristic: code-like syntax ───────────────────────────────────────
  if (CODE_SYNTAX_RE.test(trimmed)) {
    return fallback;
  }

  // ── Heuristic: JSON-like structures ───────────────────────────────────
  if (JSON_LIKE_RE.test(trimmed)) {
    return fallback;
  }

  // ── Heuristic: stack trace patterns ───────────────────────────────────
  if (STACK_TRACE_RE.test(trimmed)) {
    return fallback;
  }

  // ── Heuristic: contains tab or newline (config/log artifacts) ─────────
  if (/[\t\n\r]/.test(trimmed)) {
    return fallback;
  }

  // All checks passed — text is safe for speech
  return trimmed;
}

module.exports = { sanitizeForSpeech, SAFE_FALLBACK };

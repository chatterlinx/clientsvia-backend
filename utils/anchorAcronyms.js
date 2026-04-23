'use strict';

/**
 * ============================================================================
 * ANCHOR ACRONYM EXPANSION — Item 4 (UAP/v1.md §24)
 * ============================================================================
 *
 * PURPOSE:
 *   When a caller's utterance uses an acronym ("AC is broken") and the KC
 *   container's callerPhrase anchor words carry only the expanded form
 *   ("air conditioning"), the Logic 1 Word Gate drops below 90% coverage and
 *   the anchor gate fails — even though the caller is unambiguously talking
 *   about air conditioning.
 *
 *   This module provides a curated bidirectional acronym table + an
 *   `expandAcronyms()` helper. Called from the AUTO_ANCHOR_WORDS_FILLED
 *   block in `/phrase-score` (i.e. "Re-score All" path), it ensures
 *   both forms live in every phrase's anchorWords array.
 *
 * DESIGN RULES (anti-gimmick guardrail):
 *   - CURATED table only. No ML, no "smart expansion", no LLM calls.
 *   - BIDIRECTIONAL. Phrase carrying "ac" → expansion includes
 *     "air conditioning". Phrase carrying "air conditioning" → expansion
 *     includes "ac".
 *   - CONSERVATIVE expansion — we only expand acronyms we have curated. If
 *     a company needs a trade-specific term, it's added here (or later, via
 *     per-company override — not yet built).
 *   - Admin override always wins. This module runs ONLY when an existing
 *     phrase has an empty anchorWords array (see caller — the
 *     AUTO_ANCHOR_WORDS_FILLED block already gates on existingAnchors.length = 0).
 *
 * OUTPUT CONTRACT:
 *   expandAcronyms(words: string[]) → string[]
 *   Returns a deduplicated union of:
 *     - All input words (unchanged, lowercase-trimmed).
 *     - Expansion tokens for each acronym key present in the input.
 *     - Acronym form for each expansion phrase present in the input.
 *
 * ============================================================================
 */

// ── CURATED ACRONYM TABLE ──────────────────────────────────────────────────
// Keys are the short (acronym) forms — lowercase. Values are arrays of
// expanded forms (also lowercase). Both keys and values may be single tokens
// or multi-word phrases. Multi-word expansions are split into individual
// tokens AND kept as compound anchors at expansion time.
//
// Domain note: the HVAC block exists because Penguin Air is the baseline
// company. As other trades come online, expand the table (not per-company
// override yet — that's a future extension). Do NOT add speculative acronyms
// without a caller-utterance reference.
const ACRONYMS = Object.freeze({
  // ── HVAC ────────────────────────────────────────────────────────────
  ac:         ['air conditioning', 'air conditioner'],
  hvac:       ['heating ventilation air conditioning', 'heating cooling'],
  'mini-split': ['mini split', 'ductless'],

  // ── Electronics / residential tech ───────────────────────────────────
  dvr:        ['digital video recorder'],
  tv:         ['television'],

  // ── Scheduling / logistics ───────────────────────────────────────────
  appt:       ['appointment'],
  biz:        ['business'],

  // ── Payment / finance ────────────────────────────────────────────────
  cc:         ['credit card'],
  ccard:      ['credit card'],

  // ── General ──────────────────────────────────────────────────────────
  diy:        ['do it yourself'],
  asap:       ['as soon as possible'],
  max:        ['maximum'],
  min:        ['minimum'],
});

// ── REVERSE INDEX: expansion phrase → [acronym1, acronym2, …] ──────────────
// Computed once at module load. Enables O(1) lookup for the "caller used
// the expanded form" path. Keys in this reverse map are full phrases
// (may be multi-word) — we `.includes()` the words.join(' ') text against
// them at expansion time.
const _REVERSE = (() => {
  const rev = {};
  for (const [key, expansions] of Object.entries(ACRONYMS)) {
    for (const exp of expansions) {
      if (!rev[exp]) rev[exp] = [];
      if (!rev[exp].includes(key)) rev[exp].push(key);
    }
  }
  return Object.freeze(rev);
})();

/**
 * Expand an anchor word list with acronym pairs.
 *
 * @param {string[]} words — existing anchor words (lowercase recommended,
 *                          but enforced internally).
 * @returns {string[]} — deduplicated superset:
 *                      original words + acronym expansions + reverse acronyms.
 *
 * Never throws. Returns [] on invalid input.
 */
function expandAcronyms(words) {
  if (!Array.isArray(words)) return [];

  const normalized = words
    .map(w => (typeof w === 'string' ? w.toLowerCase().trim() : ''))
    .filter(Boolean);

  const out = new Set(normalized);

  // ── PASS 1 — short form → expansion ──────────────────────────────────
  // For each input word, if it's a known acronym key, add every token of
  // every expansion AND the full expansion phrase as a compound anchor.
  for (const word of normalized) {
    if (ACRONYMS[word]) {
      for (const exp of ACRONYMS[word]) {
        for (const tok of exp.split(/\s+/)) out.add(tok);
        out.add(exp);   // full phrase as compound token
      }
    }
  }

  // ── PASS 2 — expanded phrase → acronym form ──────────────────────────
  // If the input text contains a known expansion phrase (e.g. the phrase
  // core was "air conditioning"), add the short-form acronym ("ac") too.
  const text = normalized.join(' ');
  for (const [expandedPhrase, shortForms] of Object.entries(_REVERSE)) {
    if (text.includes(expandedPhrase)) {
      for (const s of shortForms) out.add(s);
    }
  }

  return [...out];
}

/**
 * Pure read-access to the curated table (for test + admin tooling).
 *
 * @returns {Object} — frozen map, lowercase keys → string[] expansions.
 */
function getAcronymTable() {
  return ACRONYMS;
}

/**
 * Pure read-access to the reverse index (for test + admin tooling).
 *
 * @returns {Object} — frozen map, expansion-phrase → string[] acronyms.
 */
function getReverseIndex() {
  return _REVERSE;
}

module.exports = { expandAcronyms, getAcronymTable, getReverseIndex };

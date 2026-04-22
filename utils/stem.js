'use strict';

/**
 * ============================================================================
 * STEM — Shared morphological stemmer (<1µs)
 * ============================================================================
 *
 * Single source of truth for KC anchor-gate + CueExtractor inflection
 * normalization. Previously duplicated in two locations with drift:
 *
 *   - services/engine/kc/KCDiscoveryRunner.js (older, looser version)
 *   - services/cueExtractor/CueExtractorService.js (newer, hardened version)
 *
 * The drift caused a latent Anchor Gate failure: admin anchor word "schedule"
 * (base form, no final-e strip in KC's version) vs caller "scheduled" (strips
 * "ed" → "schedul"). Stems didn't match → Logic 1 miss on a correct utterance.
 * See Stage 12 audit, commit introducing this module.
 *
 * DESIGN:
 *   - Length guard (<4 chars → return as-is): protects short words like
 *     "her", "has", "yes", "was" from collapse.
 *   - Single-word only — multi-word idiomatic phrases ("do i have to",
 *     "right now") remain substring-matched verbatim by callers.
 *   - Null/undefined safe — returns '' for falsy input rather than throwing.
 *
 * KNOWN LIMITATIONS:
 *   Irregular past tense ("paid", "made", "took", "broke") does NOT stem to
 *   base form. Callers needing these collapses should match the irregular
 *   form as a separate pattern/phrase.
 *
 * PIPELINE POSITION:
 *   Hot-path utility. Called O(N) per turn where N = caller tokens + admin
 *   anchor words. Zero allocations beyond the single replaced string.
 * ============================================================================
 */

/**
 * Stem a single word by stripping common English inflections.
 *
 * @param {string} word  — input token (may be null/undefined — returns '')
 * @returns {string}      — lowercased stemmed form (or '' for falsy input)
 */
function stem(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 4) return w;
  return w
    .replace(/ings?$/,     '')   // scheduling/schedulings → schedul
    .replace(/ations?$/,   '')   // installation/installations → install
    .replace(/ers?$/,      '')   // installer/installers → install
    .replace(/ed$/,        '')   // scheduled → schedul
    .replace(/ly$/,        '')   // currently → current
    .replace(/ies$/,       'y')  // warranties → warranty
    .replace(/ves$/,       'f')  // leaves → leaf
    .replace(/s$/,         '')   // weekends → weekend
    .replace(/(\w{4,})e$/, '$1');// schedule → schedul (4+ char prefix only)
}

module.exports = { stem };

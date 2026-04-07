/**
 * kcHelpers.js — Shared KC utility functions.
 *
 * Tiny helpers used across the platform for KC identification.
 */

'use strict';

/**
 * Build a human-readable section ID from a KC ID and section index.
 *
 * Format: {kcId}-{sectionNumber}
 * Example: "700c4-29-01" (container 700c4-29, section 1)
 *
 * sectionIdx is 0-based (array position), output is 1-based zero-padded.
 *
 * @param {string} kcId       - Container kcId (e.g. "700c4-29")
 * @param {number} sectionIdx - 0-based section index
 * @returns {string|null}
 */
function buildSectionId(kcId, sectionIdx) {
  if (!kcId || sectionIdx == null || sectionIdx < 0) return null;
  return `${kcId}-${String(Number(sectionIdx) + 1).padStart(2, '0')}`;
}

module.exports = { buildSectionId };

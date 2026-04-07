/**
 * stopWords.js — Single source of truth for stop words / filler words.
 *
 * Every file in the codebase imports from here instead of maintaining its
 * own hardcoded list.  BASE_STOP_WORDS (pure grammar glue) are baked in.
 * Admin-managed additions come from GlobalShare → AdminSettings on startup.
 *
 * Usage:
 *   const StopWords = require('../utils/stopWords');
 *
 *   // Pure grammar set (sync, always available)
 *   StopWords.getStopWords().has('the')          // true
 *
 *   // Grammar + your domain words
 *   const MY_STOPS = StopWords.getStopWordsPlus(['technician', 'hvac']);
 *
 *   // Quick check
 *   StopWords.isStopWord('the')                  // true
 */

'use strict';

const logger = require('./logger');

// ── BASE SET: pure grammar glue (sync, always available) ─────────────
// Pronouns, articles, determiners, prepositions, conjunctions,
// auxiliaries, modals, adverbs, question words, conversational filler.
// NO nouns.  NO verbs.  NO words that could carry content meaning.
// Kept lean on purpose — admin adds more via GlobalShare if needed.
const BASE_STOP_WORDS = [
  // Pronouns (core forms only)
  'i', 'me', 'my', 'we', 'us', 'our',
  'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its',
  'they', 'them', 'their',
  // Articles
  'a', 'an', 'the',
  // Demonstratives
  'this', 'that', 'these', 'those',
  // Core prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by',
  // Conjunctions
  'and', 'but', 'or', 'so', 'if', 'as', 'than',
  // Auxiliary / copula / modals
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
  // Question words
  'what', 'which', 'who', 'how', 'when', 'where', 'why',
  // Speech fillers (zero meaning)
  'um', 'uh', 'ok', 'okay', 'yeah',
];

// ── Runtime state ────────────────────────────────────────────────────
let _mergedSet = new Set(BASE_STOP_WORDS);   // sync-safe from require time
let _adminWords = [];
let _initialized = false;

/**
 * Load admin-managed stop words from GlobalShare (AdminSettings) and merge
 * with BASE.  Call once after MongoDB is connected (server startup).
 * Safe to call multiple times (idempotent).
 */
async function initialize() {
  try {
    // Lazy require to avoid circular-dep issues at module load time
    const AdminSettings = require('../models/AdminSettings');
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence;
    _adminWords = Array.isArray(pi?.stopWords) && pi.stopWords.length > 0
      ? pi.stopWords
      : [];
    _rebuild();
    _initialized = true;
    logger.info('[StopWords] Initialized', {
      base: BASE_STOP_WORDS.length,
      admin: _adminWords.length,
      total: _mergedSet.size,
    });
  } catch (err) {
    logger.warn('[StopWords] Init failed, using BASE only', { error: err.message });
    _initialized = true;   // BASE set is fine as fallback
  }
}

/** Rebuild the merged Set from base + admin words. */
function _rebuild() {
  _mergedSet = new Set([
    ...BASE_STOP_WORDS,
    ..._adminWords.map(w => String(w).toLowerCase().trim()).filter(Boolean),
  ]);
}

/**
 * Sync — returns merged Set (base + admin).
 * Safe before initialize() — returns base-only in that case.
 */
function getStopWords() {
  return _mergedSet;
}

/**
 * Sync convenience — merged set plus caller's domain-specific extras.
 * Returns a NEW Set (does not mutate the shared one).
 */
function getStopWordsPlus(extras) {
  if (!extras || !extras.length) return _mergedSet;
  return new Set([
    ..._mergedSet,
    ...extras.map(w => String(w).toLowerCase().trim()).filter(Boolean),
  ]);
}

/** Quick check against the merged set. */
function isStopWord(word) {
  return _mergedSet.has(String(word).toLowerCase().trim());
}

/**
 * Cache bust — re-reads admin words from AdminSettings.
 * Call after admin saves stop words on globalshare.html.
 */
async function invalidateCache() {
  try {
    const AdminSettings = require('../models/AdminSettings');
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence;
    _adminWords = Array.isArray(pi?.stopWords) && pi.stopWords.length > 0
      ? pi.stopWords
      : [];
    _rebuild();
    logger.info('[StopWords] Cache invalidated', { total: _mergedSet.size });
  } catch (err) {
    logger.warn('[StopWords] Invalidation failed', { error: err.message });
  }
}

module.exports = {
  BASE_STOP_WORDS,
  getStopWords,
  getStopWordsPlus,
  isStopWord,
  initialize,
  invalidateCache,
};

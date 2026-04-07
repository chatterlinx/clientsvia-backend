/**
 * stopWords.js — Single source of truth for stop words / filler words.
 *
 * Every file in the codebase imports from here instead of maintaining its
 * own hardcoded list.  ZERO hardcoded words — GlobalShare (AdminSettings)
 * is the ONLY source.  Admin controls the full list from the Stop Words
 * tab on globalshare.html.
 *
 * IMPORTANT: _mergedSet is mutated in-place (clear + re-add), never
 * reassigned.  Consumers that cache the reference at module load time
 * (e.g. `const STOP = StopWords.getStopWords()`) stay in sync.
 *
 * Usage:
 *   const StopWords = require('../utils/stopWords');
 *
 *   // Full stop word set (sync after initialize())
 *   StopWords.getStopWords().has('the')          // true (if admin added 'the')
 *
 *   // Stop words + your domain extras
 *   const MY_STOPS = StopWords.getStopWordsPlus(['technician', 'hvac']);
 *
 *   // Quick check
 *   StopWords.isStopWord('the')                  // true (if admin added 'the')
 */

'use strict';

const logger = require('./logger');

// ── No hardcoded words — GlobalShare is the only source ─────────────
// Exported as empty array for backward compat with consumers that
// reference BASE_STOP_WORDS (e.g. PhraseReducerService fallback).
const BASE_STOP_WORDS = [];

// ── Runtime state ────────────────────────────────────────────────────
// Single Set instance — NEVER reassigned, only mutated (clear + add).
// This ensures all cached references stay valid.
const _mergedSet = new Set();
let _initialized = false;

/** Populate the shared set from an array of words. Mutates in place. */
function _populateSet(words) {
  _mergedSet.clear();
  for (const w of words) {
    const norm = String(w).toLowerCase().trim();
    if (norm) _mergedSet.add(norm);
  }
}

/**
 * Load stop words from GlobalShare (AdminSettings).
 * Call once after MongoDB is connected (server startup).
 * Safe to call multiple times (idempotent).
 */
async function initialize() {
  try {
    const AdminSettings = require('../models/AdminSettings');
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence;
    const words = Array.isArray(pi?.stopWords) ? pi.stopWords : [];
    _populateSet(words);
    _initialized = true;
    logger.info('[StopWords] Initialized from GlobalShare', {
      total: _mergedSet.size,
    });
  } catch (err) {
    logger.warn('[StopWords] Init failed — stop word set is empty until next load', { error: err.message });
    _initialized = true;
  }
}

/**
 * Sync — returns the shared Set loaded from GlobalShare.
 * Empty before initialize() is called.  Same object reference always.
 */
function getStopWords() {
  return _mergedSet;
}

/**
 * Sync convenience — stop words plus caller's domain-specific extras.
 * Returns a NEW Set (does not mutate the shared one).
 */
function getStopWordsPlus(extras) {
  if (!extras || !extras.length) return _mergedSet;
  return new Set([
    ..._mergedSet,
    ...extras.map(w => String(w).toLowerCase().trim()).filter(Boolean),
  ]);
}

/** Quick check against the set. */
function isStopWord(word) {
  return _mergedSet.has(String(word).toLowerCase().trim());
}

/**
 * Cache bust — re-reads stop words from AdminSettings.
 * Call after admin saves stop words on globalshare.html.
 */
async function invalidateCache() {
  try {
    const AdminSettings = require('../models/AdminSettings');
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence;
    const words = Array.isArray(pi?.stopWords) ? pi.stopWords : [];
    _populateSet(words);
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

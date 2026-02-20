/**
 * Agent2SpeechPreprocessor.js
 * 
 * V4: Speech Preprocessing - Cleans input BEFORE matching/extraction.
 * 
 * PURPOSE:
 * - Remove greetings, company names, filler words, noise from transcript
 * - Apply canonical rewrites (variations → standard form)
 * - This runs BEFORE trigger-card matching, call-reason capture, and LLM
 * 
 * CRITICAL RULES:
 * 1. Cleaned text is for INTERNAL USE ONLY - NEVER spoken to caller
 * 2. All config comes from UI (aiAgentSettings.agent2.discovery.preprocessing)
 * 3. Original text is always preserved and logged alongside cleaned text
 * 4. This is NOT sanitization (that's for output) - this is INPUT preprocessing
 * 
 * @module services/engine/agent2/Agent2SpeechPreprocessor
 */

'use strict';

const logger = require('../../../utils/logger');

/**
 * Built-in filler words (always stripped regardless of UI config).
 * These are universally noise and safe to remove.
 */
const DEFAULT_FILLER_WORDS = [
    'uh', 'um', 'er', 'ah', 'eh', 'hmm', 'hm',
    'like', 'basically', 'actually', 'literally',
    'you know', 'i mean', 'you see', 'kind of', 'sort of',
    'well um', 'so um', 'but um', 'and um'
];

/**
 * Built-in greeting phrases (always stripped regardless of UI config).
 * These are universally noise at the start of caller input.
 */
const DEFAULT_GREETING_PHRASES = [
    'hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there',
    'good morning', 'good afternoon', 'good evening',
    'hi good morning', 'hello good morning'
];

/**
 * Preprocess caller input for trigger-card matching and call-reason capture.
 * 
 * @param {string} text - Raw caller input text
 * @param {Object} config - Preprocessing config from UI (agent2.discovery.preprocessing)
 * @param {Object} options - Additional options
 * @param {string} [options.companyName] - Company name to strip (optional)
 * @returns {Object} { original, cleaned, appliedRules[] }
 */
function preprocess(text, config = {}, options = {}) {
    if (!text || typeof text !== 'string') {
        return { 
            original: text || '', 
            cleaned: text || '', 
            appliedRules: [],
            enabled: false
        };
    }

    // If preprocessing is disabled, return original unchanged
    if (config.enabled === false) {
        return { 
            original: text, 
            cleaned: text, 
            appliedRules: [],
            enabled: false
        };
    }

    const original = text;
    let cleaned = text.toLowerCase().trim();
    const appliedRules = [];

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: Strip company name if provided (often misheard as greeting)
    // ─────────────────────────────────────────────────────────────────────
    if (options.companyName) {
        const companyLower = options.companyName.toLowerCase();
        const companyRegex = new RegExp(`\\b${escapeRegex(companyLower)}\\b`, 'gi');
        if (companyRegex.test(cleaned)) {
            cleaned = cleaned.replace(companyRegex, '').trim();
            appliedRules.push({ type: 'strip_company_name', value: options.companyName });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: Strip default greeting phrases (always)
    // ─────────────────────────────────────────────────────────────────────
    for (const greeting of DEFAULT_GREETING_PHRASES) {
        const greetingRegex = new RegExp(`^${escapeRegex(greeting)}[.,!?\\s]*`, 'i');
        if (greetingRegex.test(cleaned)) {
            cleaned = cleaned.replace(greetingRegex, '').trim();
            appliedRules.push({ type: 'strip_greeting', value: greeting });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: Strip UI-configured ignorePhrases (whole phrase match)
    // ─────────────────────────────────────────────────────────────────────
    const ignorePhrases = Array.isArray(config.ignorePhrases) ? config.ignorePhrases : [];
    for (const phrase of ignorePhrases) {
        if (!phrase || typeof phrase !== 'string') continue;
        const phraseRegex = new RegExp(`\\b${escapeRegex(phrase.toLowerCase())}\\b`, 'gi');
        if (phraseRegex.test(cleaned)) {
            cleaned = cleaned.replace(phraseRegex, '').trim();
            appliedRules.push({ type: 'ignore_phrase', value: phrase });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: Strip filler words (default + UI-configured)
    // ─────────────────────────────────────────────────────────────────────
    const uiFillerWords = Array.isArray(config.fillerWords) ? config.fillerWords : [];
    const allFillerWords = [...new Set([...DEFAULT_FILLER_WORDS, ...uiFillerWords.map(w => w?.toLowerCase())])];
    
    for (const filler of allFillerWords) {
        if (!filler) continue;
        // Match as standalone word with optional trailing comma/period
        const fillerRegex = new RegExp(`\\b${escapeRegex(filler)}\\b[,.]?`, 'gi');
        if (fillerRegex.test(cleaned)) {
            const before = cleaned;
            cleaned = cleaned.replace(fillerRegex, ' ').trim();
            if (cleaned !== before) {
                appliedRules.push({ type: 'strip_filler', value: filler });
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: Apply canonical rewrites
    // ─────────────────────────────────────────────────────────────────────
    const rewrites = Array.isArray(config.canonicalRewrites) ? config.canonicalRewrites : [];
    for (const rewrite of rewrites) {
        if (!rewrite?.from || !rewrite?.to) continue;
        const fromRegex = new RegExp(`\\b${escapeRegex(rewrite.from.toLowerCase())}\\b`, 'gi');
        if (fromRegex.test(cleaned)) {
            cleaned = cleaned.replace(fromRegex, rewrite.to.toLowerCase()).trim();
            appliedRules.push({ type: 'rewrite', from: rewrite.from, to: rewrite.to });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 6: Apply custom strip patterns (regex strings from UI)
    // ─────────────────────────────────────────────────────────────────────
    const stripPatterns = Array.isArray(config.stripPatterns) ? config.stripPatterns : [];
    for (const pattern of stripPatterns) {
        if (!pattern || typeof pattern !== 'string') continue;
        try {
            const patternRegex = new RegExp(pattern, 'gi');
            if (patternRegex.test(cleaned)) {
                cleaned = cleaned.replace(patternRegex, '').trim();
                appliedRules.push({ type: 'strip_pattern', pattern });
            }
        } catch (err) {
            logger.warn('[Agent2SpeechPreprocessor] Invalid strip pattern regex', { pattern, error: err.message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 7: Clean up whitespace (multiple spaces → single space)
    // ─────────────────────────────────────────────────────────────────────
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // ─────────────────────────────────────────────────────────────────────
    // STEP 8: If cleaned is too short or empty, fall back to original
    // ─────────────────────────────────────────────────────────────────────
    // We don't want preprocessing to completely destroy the input
    if (cleaned.length < 3 && original.length >= 3) {
        logger.debug('[Agent2SpeechPreprocessor] Cleaned too short, preserving original', {
            original: original.substring(0, 50),
            cleaned
        });
        // Keep meaningful parts - strip only leading greetings
        cleaned = original.toLowerCase().replace(/^(hi|hello|hey)[.,!?\s]*/i, '').trim();
        appliedRules.push({ type: 'preserved_original', reason: 'cleaned_too_short' });
    }

    return {
        original,
        cleaned,
        appliedRules,
        enabled: true,
        changed: cleaned !== original.toLowerCase().trim()
    };
}

/**
 * Escape special regex characters in a string.
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in RegExp
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build preprocessing event for logging (for Call Review debugging).
 * 
 * @param {Object} result - Result from preprocess()
 * @returns {Object} Event data for logging
 */
function buildPreprocessingEvent(result) {
    return {
        enabled: result.enabled,
        originalPreview: result.original?.substring(0, 80),
        cleanedPreview: result.cleaned?.substring(0, 80),
        changed: result.changed,
        rulesApplied: result.appliedRules?.length || 0,
        rules: result.appliedRules?.slice(0, 10) // Limit to first 10 for event size
    };
}

module.exports = {
    preprocess,
    buildPreprocessingEvent,
    DEFAULT_FILLER_WORDS,
    DEFAULT_GREETING_PHRASES
};

/**
 * ============================================================================
 * SCRABENGINE - Enterprise Text Normalization & Expansion System
 * ============================================================================
 * 
 * MISSION:
 * Transform raw STT transcripts into clean, trigger-ready text with semantic
 * token expansion - WITHOUT changing meaning or losing the original.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  INPUT: Raw STT Result                                                  │
 * │  "um the thing in the garage isn't pulling you know"                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  STAGE 1: FILLER REMOVAL (Safe Normalization)                           │
 * │  Remove conversational noise: "um", "uh", "you know"                    │
 * │  Output: "the thing in the garage isn't pulling"                        │
 * │  Time: ~1-3ms                                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  STAGE 2: VOCABULARY NORMALIZATION (Mishear Corrections)                │
 * │  Fix known STT errors: "acee" → "ac", "tstat" → "thermostat"           │
 * │  Fix industry slang: "pulling" → "cooling"                              │
 * │  Output: "the thing in the garage isn't cooling"                        │
 * │  Time: ~2-8ms                                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  STAGE 3: TOKEN EXPANSION (Synonym Metadata)                            │
 * │  Detect: "thing" + "garage" → Component: "air handler"                  │
 * │  Expand: Add ["air", "handler", "ahu", "indoor", "unit"]               │
 * │  Original tokens preserved!                                              │
 * │  Time: ~5-15ms                                                           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *                                ↓
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  OUTPUT: Enhanced Text Package                                           │
 * │  {                                                                       │
 * │    rawText: "um the thing in the garage isn't pulling you know",        │
 * │    normalizedText: "the air handler isn't cooling",                     │
 * │    originalTokens: ["thing", "garage", "isn't", "cooling"],             │
 * │    expandedTokens: ["thing", "garage", "air", "handler", ...],          │
 * │    transformations: [...],                                               │
 * │    processingTimeMs: 12                                                  │
 * │  }                                                                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * CRITICAL GUARANTEES:
 * 1. rawText is NEVER mutated (immutable ground truth)
 * 2. All transformations are logged (full audit trail)
 * 3. Expansion adds tokens, never replaces (metadata only)
 * 4. Idempotent (same input + config = same output)
 * 5. Fast (< 30ms for 99% of inputs)
 * 
 * WIRING ENTRY POINT:
 * - Called from: Agent2DiscoveryRunner.js (Line ~550)
 * - Before: TriggerCardMatcher.match()
 * - After: Deepgram STT result received
 * 
 * CONFIGURATION:
 * - Stored in: company.aiAgentSettings.scrabEngine
 * - Managed via: /agent-console/scrabengine.html
 * - API routes: /api/agent-console/:companyId/scrabengine
 * 
 * ============================================================================
 */

'use strict';

const logger = require('../utils/logger');
const { isSpelledInput, parseSpelledName } = require('../utils/spelledNameParser');

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS - Built-in defaults that are always safe to apply
// ════════════════════════════════════════════════════════════════════════════

/**
 * Default filler words - universally safe to remove
 * These add no semantic value and only increase processing noise
 */
const DEFAULT_FILLERS = [
  'uh', 'um', 'er', 'ah', 'eh', 'hmm', 'hm',
  'like', 'basically', 'actually', 'literally',
  'you know', 'i mean', 'you see', 'kind of', 'sort of',
  'well um', 'so um', 'but um', 'and um', 'uh huh', 'mm hmm'
];

/**
 * Default greeting phrases - stripped from start of input only
 */
const DEFAULT_GREETINGS = [
  'hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there',
  'good morning', 'good afternoon', 'good evening',
  'hi good morning', 'hello good morning', 'hey good morning'
];

/**
 * Protected words - NEVER remove even if they look like fillers
 * These have semantic value in certain contexts
 */
const PROTECTED_WORDS = new Set([
  'no', 'yes', 'ok', 'okay', 'sure', 'right', 'wrong', 'maybe'
]);

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM LANGUAGE DEFAULTS
// These are surfaced in the ScrabEngine admin UI (Stage 2 → Language Defaults).
// Each block is individually toggleable per company via:
//   company.aiAgentSettings.scrabEngine.vocabulary.languageDefaults.contractionsEnabled
//   company.aiAgentSettings.scrabEngine.vocabulary.languageDefaults.laymanEnabled
//
// They are NOT hidden. Admins can see and disable them in the UI.
// They run BEFORE company vocabulary entries.
// ════════════════════════════════════════════════════════════════════════════

/**
 * English contraction expansion.
 * Ensures "isn't cooling" → "is not cooling" so keyword "not cooling" fires.
 * Without this, contraction forms never match expanded-form keywords.
 */
const DEFAULT_CONTRACTIONS = [
  { from: "isn't",    to: 'is not'     },
  { from: "won't",    to: 'will not'   },
  { from: "doesn't",  to: 'does not'   },
  { from: "can't",    to: 'cannot'     },
  { from: "couldn't", to: 'could not'  },
  { from: "wouldn't", to: 'would not'  },
  { from: "shouldn't",to: 'should not' },
  { from: "hasn't",   to: 'has not'    },
  { from: "haven't",  to: 'have not'   },
  { from: "wasn't",   to: 'was not'    },
  { from: "weren't",  to: 'were not'   },
  { from: "didn't",   to: 'did not'    },
  { from: "don't",    to: 'do not'     },
  { from: "aren't",   to: 'are not'    },
  { from: "it's",     to: 'it is'      },
  { from: "that's",   to: 'that is'    },
  { from: "there's",  to: 'there is'   },
  { from: "it'll",    to: 'it will'    },
  { from: "won't",    to: 'will not'   }
];

/**
 * Layman service vocabulary.
 * Normalizes informal customer speech into terms triggers are built for.
 * "my AC quit" → "my AC stopped working" → matches keyword "stopped working".
 */
const DEFAULT_LAYMAN_VOCABULARY = [
  { from: 'quit working',   to: 'stopped working' },
  { from: 'quit on me',     to: 'stopped working' },
  { from: 'went out',       to: 'stopped working' },
  { from: 'conked out',     to: 'stopped working' },
  { from: 'crapped out',    to: 'stopped working' },
  { from: 'on the fritz',   to: 'not working'     },
  { from: 'acting up',      to: 'not working'     },
  { from: 'acting weird',   to: 'not working'     },
  { from: 'gone out',       to: 'stopped working' },
  { from: 'broke down',     to: 'stopped working' }
];

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS - Pure, side-effect-free utilities
// ════════════════════════════════════════════════════════════════════════════

function safeArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function clip(text, maxLength) {
  const str = `${text || ''}`;
  return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractWords(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function tokenize(text) {
  return extractWords(text);
}

function createTransformation(stage, type, data) {
  return {
    stage,
    type,
    timestamp: Date.now(),
    ...data
  };
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE 1: FILLER REMOVAL
// ════════════════════════════════════════════════════════════════════════════

class FillerRemovalEngine {
  /**
   * Remove conversational noise from text
   * 
   * @param {string} text - Input text
   * @param {Object} config - Filler configuration
   * @param {Object} context - Processing context
   * @returns {Object} { cleaned, transformations, removed }
   */
  static process(text, config = {}, context = {}) {
    const startTime = Date.now();
    const transformations = [];
    const removed = [];
    
    let cleaned = text.toLowerCase().trim();
    
    // Early exit if disabled
    if (config.enabled === false) {
      return {
        cleaned,
        transformations,
        removed,
        processingTimeMs: Date.now() - startTime
      };
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Step 1.1: Strip company name (often misheard as greeting)
    // ────────────────────────────────────────────────────────────────────────
    if (config.stripCompanyName !== false && context.companyName) {
      const companyLower = normalizeText(context.companyName);
      if (companyLower) {
        const companyRegex = new RegExp(`\\b${escapeRegex(companyLower)}\\b`, 'gi');
        if (companyRegex.test(cleaned)) {
          removed.push({ type: 'company_name', value: context.companyName });
          cleaned = cleaned.replace(companyRegex, '').trim();
          transformations.push(createTransformation('fillers', 'company_name_removed', {
            value: context.companyName
          }));
        }
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Step 1.2: Strip greetings from start (only)
    // ────────────────────────────────────────────────────────────────────────
    if (config.stripGreetings !== false) {
      for (const greeting of DEFAULT_GREETINGS) {
        const greetingRegex = new RegExp(`^${escapeRegex(greeting)}[.,!?\\s]*`, 'i');
        if (greetingRegex.test(cleaned)) {
          removed.push({ type: 'greeting', value: greeting });
          cleaned = cleaned.replace(greetingRegex, '').trim();
          transformations.push(createTransformation('fillers', 'greeting_removed', {
            value: greeting,
            position: 'start'
          }));
          break; // Only remove one greeting
        }
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Step 1.3: Remove filler words
    // ────────────────────────────────────────────────────────────────────────
    
    // Combine default + custom fillers
    const allFillers = [
      ...DEFAULT_FILLERS,
      ...safeArr(config.customFillers)
        .filter(f => f.enabled !== false)
        .map(f => f.phrase)
    ].filter(Boolean);
    
    // Sort by length (longest first) to handle multi-word fillers correctly
    const sortedFillers = [...new Set(allFillers)].sort((a, b) => b.length - a.length);
    
    for (const filler of sortedFillers) {
      const fillerNorm = normalizeText(filler);
      
      // Skip if it's a protected word
      if (PROTECTED_WORDS.has(fillerNorm)) {
        continue;
      }
      
      // Use word boundaries for single words, plain substring for phrases
      const isMultiWord = fillerNorm.includes(' ');
      const pattern = isMultiWord 
        ? escapeRegex(fillerNorm)
        : `\\b${escapeRegex(fillerNorm)}\\b`;
      
      const regex = new RegExp(pattern, 'gi');
      const matches = cleaned.match(regex);
      
      if (matches) {
        const count = matches.length;
        removed.push({ type: 'filler', value: filler, count });
        cleaned = cleaned.replace(regex, ' ').trim();
        
        transformations.push(createTransformation('fillers', 'filler_removed', {
          value: filler,
          count
        }));
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Step 1.4: Collapse multiple spaces and clean up
    // ────────────────────────────────────────────────────────────────────────
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return {
      cleaned,
      transformations,
      removed,
      processingTimeMs: Date.now() - startTime
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE 2: VOCABULARY NORMALIZATION
// ════════════════════════════════════════════════════════════════════════════

class VocabularyNormalizationEngine {
  /**
   * Apply vocabulary corrections - fix known mishears and slang
   * 
   * @param {string} text - Input text (after filler removal)
   * @param {Object} config - Vocabulary configuration
   * @returns {Object} { normalized, transformations, applied }
   */
  static process(text, config = {}) {
    const startTime = Date.now();
    const transformations = [];
    const applied = [];
    
    let normalized = text;
    
    // Early exit if disabled
    if (config.enabled === false) {
      return {
        normalized,
        transformations,
        applied,
        processingTimeMs: Date.now() - startTime
      };
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // SYSTEM LANGUAGE DEFAULTS (run BEFORE company entries)
    // Controlled via: config.languageDefaults.contractionsEnabled / laymanEnabled
    // Surfaced in the ScrabEngine admin UI — not hidden, fully toggleable.
    // ────────────────────────────────────────────────────────────────────────
    const langDefaults = safeObj(config.languageDefaults, {});

    // Block 1: English Contraction Expansion
    if (langDefaults.contractionsEnabled !== false) {
      for (const entry of DEFAULT_CONTRACTIONS) {
        const regex = new RegExp(`\\b${escapeRegex(entry.from)}\\b`, 'gi');
        const matches = normalized.match(regex);
        if (matches) {
          normalized = normalized.replace(regex, entry.to);
          const count = matches.length;
          applied.push({ from: entry.from, to: entry.to, matchMode: 'EXACT', count, source: 'system_contraction' });
          transformations.push(createTransformation('vocabulary', 'system_contraction', {
            from: entry.from, to: entry.to, count
          }));
        }
      }
    }

    // Block 2: Layman Service Vocabulary
    if (langDefaults.laymanEnabled !== false) {
      for (const entry of DEFAULT_LAYMAN_VOCABULARY) {
        const regex = new RegExp(`\\b${escapeRegex(entry.from)}\\b`, 'gi');
        const matches = normalized.match(regex);
        if (matches) {
          normalized = normalized.replace(regex, entry.to);
          const count = matches.length;
          applied.push({ from: entry.from, to: entry.to, matchMode: 'EXACT', count, source: 'system_layman' });
          transformations.push(createTransformation('vocabulary', 'system_layman', {
            from: entry.from, to: entry.to, count
          }));
        }
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // COMPANY VOCABULARY ENTRIES (run AFTER system defaults)
    // ────────────────────────────────────────────────────────────────────────
    const entries = safeArr(config.entries)
      .filter(e => e.enabled !== false)
      .sort((a, b) => (a.priority || 100) - (b.priority || 100)); // Lower priority = first

    for (const entry of entries) {
      const from = normalizeText(entry.from);
      const to = `${entry.to || ''}`.trim();
      const matchMode = `${entry.matchMode || 'EXACT'}`.toUpperCase();
      
      if (!from || !to) continue;
      
      // Build regex based on match mode
      let regex;
      if (matchMode === 'EXACT') {
        // Word boundary match: "acee" matches "acee" but not "racee"
        regex = new RegExp(`\\b${escapeRegex(from)}\\b`, 'gi');
      } else {
        // CONTAINS: substring match anywhere
        regex = new RegExp(escapeRegex(from), 'gi');
      }
      
      const matches = normalized.match(regex);
      if (matches) {
        const count = matches.length;
        
        // Apply replacement while preserving capitalization of first letter
        normalized = normalized.replace(regex, (match) => {
          const isCapitalized = match[0] === match[0].toUpperCase() && 
                               match[0] !== match[0].toLowerCase();
          return isCapitalized 
            ? to.charAt(0).toUpperCase() + to.slice(1).toLowerCase()
            : to.toLowerCase();
        });
        
        applied.push({
          from: entry.from,
          to: entry.to,
          matchMode,
          count,
          priority: entry.priority || 100
        });
        
        transformations.push(createTransformation('vocabulary', 'normalized', {
          from: entry.from,
          to: entry.to,
          matchMode,
          count
        }));
      }
    }
    
    return {
      normalized,
      transformations,
      applied,
      processingTimeMs: Date.now() - startTime
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE 3: TOKEN EXPANSION
// ════════════════════════════════════════════════════════════════════════════

class TokenExpansionEngine {
  /**
   * Expand tokens with synonyms (metadata only - don't replace original)
   * 
   * @param {string} text - Normalized text
   * @param {Object} config - Synonym configuration
   * @returns {Object} { originalTokens, expandedTokens, expansionMap, transformations }
   */
  static process(text, config = {}) {
    const startTime = Date.now();
    const transformations = [];
    
    const originalTokens = tokenize(text);
    const expandedTokens = new Set(originalTokens); // Start with originals
    const expansionMap = {};
    
    // Early exit if disabled
    if (config.enabled === false) {
      return {
        originalTokens,
        expandedTokens: Array.from(expandedTokens),
        expansionMap,
        transformations,
        processingTimeMs: Date.now() - startTime
      };
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Type 1: Simple Word Synonyms
    // ────────────────────────────────────────────────────────────────────────
    const wordSynonyms = safeArr(config.wordSynonyms)
      .filter(s => s.enabled !== false);
    
    for (const syn of wordSynonyms) {
      const word = normalizeText(syn.word);
      const synonyms = safeArr(syn.synonyms).map(s => normalizeText(s)).filter(Boolean);
      
      if (!word || synonyms.length === 0) continue;
      
      // If the word exists in original tokens, add its synonyms
      if (originalTokens.includes(word)) {
        expansionMap[word] = expansionMap[word] || [];
        
        for (const synonym of synonyms) {
          expandedTokens.add(synonym);
          if (!expansionMap[word].includes(synonym)) {
            expansionMap[word].push(synonym);
          }
        }
        
        transformations.push(createTransformation('synonyms', 'word_expanded', {
          word,
          synonyms,
          addedCount: synonyms.length
        }));
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // Type 2: Context-Aware Pattern Synonyms
    // ────────────────────────────────────────────────────────────────────────
    const contextPatterns = safeArr(config.contextPatterns)
      .filter(p => p.enabled !== false)
      .sort((a, b) => (b.priority || 50) - (a.priority || 50)); // Higher priority first
    
    const textLower = text.toLowerCase();
    
    for (const pattern of contextPatterns) {
      const patternWords = safeArr(pattern.pattern).map(w => normalizeText(w)).filter(Boolean);
      const component = normalizeText(pattern.component);
      const contextTokens = safeArr(pattern.contextTokens).map(t => normalizeText(t)).filter(Boolean);
      
      if (patternWords.length === 0 || !component) continue;
      
      // Check if ALL pattern words exist in the text
      const allWordsPresent = patternWords.every(word => textLower.includes(word));
      
      if (allWordsPresent) {
        // Add component name and context tokens to expanded set
        const componentTokens = tokenize(component);
        componentTokens.forEach(token => expandedTokens.add(token));
        contextTokens.forEach(token => expandedTokens.add(token));
        
        transformations.push(createTransformation('synonyms', 'context_pattern_matched', {
          pattern: patternWords,
          component,
          addedTokens: [...componentTokens, ...contextTokens],
          confidence: pattern.confidence || 0.9
        }));
        
        // Store in expansion map
        const patternKey = patternWords.join('+');
        expansionMap[patternKey] = [...componentTokens, ...contextTokens];
      }
    }
    
    return {
      originalTokens,
      expandedTokens: Array.from(expandedTokens),
      expansionMap,
      transformations,
      processingTimeMs: Date.now() - startTime
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// QUALITY GATE - Filter garbage input before triggers
// ════════════════════════════════════════════════════════════════════════════

/**
 * Valid short responses — semantically complete even at 1-2 words.
 * These are real caller answers (affirmatives, negatives, consent) that
 * should never be downgraded by the minWordCount gate.
 *
 * Normalized (lowercase, trimmed) before lookup.
 */
const VALID_SHORT_RESPONSES = new Set([
  // Affirmatives
  'yes', 'yeah', 'yep', 'yup', 'yea', 'sure', 'ok', 'okay',
  'correct', 'right', 'absolutely', 'please', 'definitely',
  'uh huh', 'mm hmm', 'mhm',
  'sounds good', "that's fine", 'go ahead', 'do it', 'let\'s do it',
  'yes please', 'yeah please', 'sure thing',
  // Negatives
  'no', 'nope', 'nah', 'no thanks', 'not really',
  'not right now', "i'm good", 'im good', 'no thank you',
]);

class QualityGate {
  /**
   * Assess input quality and determine if it should proceed to triggers
   *
   * @param {string} text - Normalized text
   * @param {Object} config - Quality gate configuration
   * @returns {Object} { passed, reason, confidence, shouldReprompt }
   */
  static assess(text, config = {}) {
    const minWordCount = config.minWordCount || 2;
    const minConfidence = config.minConfidence || 0.5;

    const normalized = normalizeText(text);
    const tokens = tokenize(text);
    const wordCount = tokens.length;

    // Gate 0: Valid short responses bypass minWordCount entirely.
    // A caller saying "yes" or "no" to a question is a complete answer,
    // not noise. Full confidence — no reprompt.
    if (VALID_SHORT_RESPONSES.has(normalized)) {
      return {
        passed: true,
        reason: 'QUALITY_OK',
        confidence: 0.95,
        shouldReprompt: false,
        details: { wordCount, matchedShortResponse: normalized }
      };
    }

    // Gate 1: Too short
    if (wordCount < minWordCount) {
      return {
        passed: false,
        reason: 'INPUT_TOO_SHORT',
        confidence: 0.2,
        shouldReprompt: true,
        details: { wordCount, minRequired: minWordCount }
      };
    }

    // Gate 2: Mostly non-words (gibberish)
    const validWords = tokens.filter(t => t.length > 1 && /^[a-z]+$/.test(t));
    const validRatio = validWords.length / wordCount;
    if (validRatio < 0.5) {
      return {
        passed: false,
        reason: 'MOSTLY_GIBBERISH',
        confidence: validRatio,
        shouldReprompt: true,
        details: { validWords: validWords.length, total: wordCount, ratio: validRatio }
      };
    }

    // Gate 3: Check if it's just a repeat of common patterns
    const commonNoisePatterns = ['thank you', 'goodbye', 'bye', 'thanks'];
    const isJustNoise = commonNoisePatterns.some(pattern =>
      normalized === pattern
    );
    if (isJustNoise) {
      return {
        passed: true, // Let it through but mark as low quality
        reason: 'COMMON_NOISE',
        confidence: 0.6,
        shouldReprompt: false,
        details: { pattern: text }
      };
    }

    // Passed all gates
    return {
      passed: true,
      reason: 'QUALITY_OK',
      confidence: Math.min(0.95, validRatio + 0.2),
      shouldReprompt: false,
      details: { wordCount, validRatio }
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STAGE 4: ENTITY EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

class EntityExtractionEngine {
  /**
   * Extract structured entities from normalized text
   * MOVED FROM: Agent2DiscoveryEngine.extractCallerName, utils/nameExtraction.js
   * 
   * @param {string} text - Normalized text (after vocabulary/synonyms)
   * @param {Object} context - Extraction context
   * @param {Object} context.GlobalHubService - GlobalShare service for name validation
   * @returns {Promise<Object>} { entities, extractions, validations, processingTimeMs }
   */
  // Words that must NEVER be accepted as a surname.
  // These appear after name introductions ("this is Mark AND having issues")
  // and are conjunctions, prepositions, or verb fragments — never surnames.
  static SURNAME_CONNECTOR_BLOCKLIST = new Set([
    'and', 'or', 'but', 'nor', 'yet', 'so',
    'with', 'from', 'at', 'by', 'for', 'in', 'of', 'to', 'on', 'as',
    'having', 'just', 'because', 'since', 'then', 'when', 'where',
    'who', 'what', 'that', 'which', 'about', 'also', 'still', 'been',
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'he', 'she', 'they', 'we', 'it', 'my', 'your', 'their', 'our', 'its'
  ]);

  static isValidSurnameCandidate(word) {
    if (!word || word.length < 2) return false;
    return !ScrabEngine.SURNAME_CONNECTOR_BLOCKLIST.has(word.toLowerCase());
  }

  static async process(text, config = {}, context = {}) {
    const startTime = Date.now();
    const extractions = [];
    const validations = [];

    const entities = {
      firstName: null,
      lastName: null,
      fullName: null,
      firstNameMeta: null,  // NameMatchResult from GlobalHubService
      lastNameMeta: null,   // NameMatchResult from GlobalHubService
      phone: null,
      address: null,
      email: null
    };
    const handoffEntities = {};
    
    // ────────────────────────────────────────────────────────────────────────
    // HONORIFICS - Strip titles before name extraction
    // ────────────────────────────────────────────────────────────────────────
    const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'dr', 'doctor', 'prof', 'professor', 'sir', 'madam'];

    // ════════════════════════════════════════════════════════════════════════
    // STAGE 4.0: SPELLED NAME DETECTION (Fix B)
    // ════════════════════════════════════════════════════════════════════════
    // Before regex patterns, check if caller is spelling name letter-by-letter.
    // Handles: "D-U-S-T-I-N", "D as in David, U, S, T, I, N", NATO phonetic, etc.
    // If detected → parse, match against dictionary, return early.

    if (context.GlobalHubService && isSpelledInput(text)) {
      const spelled = parseSpelledName(text);
      if (spelled.parsed && spelled.name) {
        const firstMatch = await context.GlobalHubService.matchFirstName(spelled.name);
        const lastMatch = await context.GlobalHubService.matchLastName(spelled.name);

        // Classify as first or last based on which dictionary has a stronger match
        if (firstMatch.score >= lastMatch.score) {
          entities.firstName = firstMatch.value;
          entities.firstNameMeta = { ...firstMatch, verificationMode: 'spelled' };
          extractions.push({
            type: 'firstName',
            value: firstMatch.value,
            pattern: 'spelled_name',
            confidence: Math.max(firstMatch.score, spelled.confidence),
            validated: firstMatch.match,
            verificationMode: 'spelled',
            correctedFrom: firstMatch.correctedFrom,
            candidates: firstMatch.candidates,
            spelledLetters: spelled.letters
          });
          validations.push({
            entity: 'firstName',
            value: firstMatch.value,
            isValid: firstMatch.match,
            source: 'spelled_name_parser',
            spelledRaw: spelled.raw,
            assembledName: spelled.name,
            verificationMode: 'spelled'
          });
        } else {
          entities.lastName = lastMatch.value;
          entities.lastNameMeta = { ...lastMatch, verificationMode: 'spelled' };
          extractions.push({
            type: 'lastName',
            value: lastMatch.value,
            pattern: 'spelled_name',
            confidence: Math.max(lastMatch.score, spelled.confidence),
            validated: lastMatch.match,
            verificationMode: 'spelled',
            correctedFrom: lastMatch.correctedFrom,
            candidates: lastMatch.candidates,
            spelledLetters: spelled.letters
          });
          validations.push({
            entity: 'lastName',
            value: lastMatch.value,
            isValid: lastMatch.match,
            source: 'spelled_name_parser',
            spelledRaw: spelled.raw,
            assembledName: spelled.name,
            verificationMode: 'spelled'
          });
        }

        // Confidence gate: if neither dictionary recognized the assembled name AND
        // the score is below threshold, the spelled-name parser assembled garbage
        // (e.g. "john"→j, "nice"→n, "mike"→m → "Jahiaiuman"). Reset and fall through
        // to normal name-extraction patterns instead of committing the garbage name.
        const bestSpelledScore = Math.max(firstMatch.score, lastMatch.score);
        if (bestSpelledScore >= 0.65 || firstMatch.match || lastMatch.match) {
          // Return early — spelled input is fully handled
          ['firstName', 'lastName', 'fullName', 'phone', 'email', 'address'].forEach((key) => {
            if (entities[key]) handoffEntities[key] = entities[key];
          });
          if (entities.firstNameMeta) handoffEntities._firstNameMeta = entities.firstNameMeta;
          if (entities.lastNameMeta) handoffEntities._lastNameMeta = entities.lastNameMeta;

          return {
            entities, handoffEntities, extractions, validations,
            processingTimeMs: Date.now() - startTime
          };
        }

        // Low confidence, no match — reset entities and fall through to normal patterns
        entities.firstName = undefined;
        entities.firstNameMeta = undefined;
        entities.lastName = undefined;
        entities.lastNameMeta = undefined;
        extractions.length = 0;
        validations.length = 0;
      }
    }

    // ────────────────────────────────────────────────────────────────────────
    // INTELLIGENT NAME EXTRACTION WITH DICTIONARY-BACKED SMART MATCHING
    // ────────────────────────────────────────────────────────────────────────
    // Detects patterns like:
    // - "I'm Mr. Johnson" → lastName="Johnson"
    // - "I'm Mr. John Johnson" → firstName="John", lastName="Johnson"
    // - "my name is John" → firstName="John"
    // - "this is John Smith" → firstName="John", lastName="Smith"
    //
    // Uses GlobalHubService.matchFirstName/matchLastName for:
    // - Exact dictionary match → canonical casing (score 1.0)
    // - Fuzzy near-miss correction → silently normalize (score 0.95)
    // - Ambiguous near-hit → flag for confirmation (score 0.80)
    // - Unknown name → allow through, mark unverified (score 0.50)
    // ────────────────────────────────────────────────────────────────────────

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 1: "I'm Mr./Dr. [Name(s)]"
    // ════════════════════════════════════════════════════════════════════════

    const imHonorificPattern = /i'?m\s+(mr|mrs|ms|miss|dr|doctor|prof|professor)\.?\s+(\w+)(?:\s+(\w+))?/i;
    const imHonorificMatch = text.match(imHonorificPattern);

    if (imHonorificMatch) {
      const rawFirst = imHonorificMatch[2] ? this.capitalizeFirst(imHonorificMatch[2]) : null;
      const rawLast = imHonorificMatch[3] ? this.capitalizeFirst(imHonorificMatch[3]) : null;

      if (context.GlobalHubService && rawFirst && rawLast) {
        // Two names after honorific — smart match both
        const firstMatch = await context.GlobalHubService.matchFirstName(rawFirst);
        const lastMatch = await context.GlobalHubService.matchLastName(rawLast);

        validations.push({
          scenario: 'im_honorific_two_names',
          first_candidate: { value: rawFirst, ...firstMatch },
          second_candidate: { value: rawLast, ...lastMatch },
          source: 'GlobalShare'
        });

        if (firstMatch.match && lastMatch.match) {
          entities.firstName = firstMatch.value;
          entities.lastName = lastMatch.value;
          entities.fullName = `${firstMatch.value} ${lastMatch.value}`;
          entities.firstNameMeta = firstMatch;
          entities.lastNameMeta = lastMatch;

          extractions.push({
            type: 'fullName',
            firstName: firstMatch.value,
            lastName: lastMatch.value,
            pattern: 'im_honorific_full',
            confidence: Math.min(firstMatch.score, lastMatch.score),
            validated: true,
            verificationMode: firstMatch.verificationMode,
            correctedFrom: firstMatch.correctedFrom || lastMatch.correctedFrom || null
          });
        } else if (!firstMatch.match && lastMatch.match) {
          entities.lastName = lastMatch.value;
          entities.lastNameMeta = lastMatch;

          extractions.push({
            type: 'lastName',
            value: lastMatch.value,
            pattern: 'im_honorific_last',
            confidence: lastMatch.score,
            validated: true,
            verificationMode: lastMatch.verificationMode,
            correctedFrom: lastMatch.correctedFrom
          });
        } else {
          // Ambiguous — use best values
          entities.firstName = firstMatch.value;
          entities.lastName = lastMatch.value;
          entities.firstNameMeta = firstMatch;
          entities.lastNameMeta = lastMatch;

          extractions.push({
            type: 'fullName',
            firstName: firstMatch.value,
            lastName: lastMatch.value,
            pattern: 'im_honorific_ambiguous',
            confidence: Math.max(firstMatch.score, lastMatch.score) * 0.75,
            validated: false,
            verificationMode: 'unknown',
            note: 'Ambiguous — neither name strongly matches dictionary'
          });
        }
      } else if (rawFirst && !rawLast) {
        // Single name after honorific: "I'm Mr. Johnson"
        if (context.GlobalHubService) {
          const lastMatch = await context.GlobalHubService.matchLastName(rawFirst);

          if (lastMatch.match) {
            entities.lastName = lastMatch.value;
            entities.lastNameMeta = lastMatch;
            validations.push({ entity: 'lastName', value: lastMatch.value, isValid: true, source: 'GlobalShare', verificationMode: lastMatch.verificationMode });
            extractions.push({
              type: 'lastName', value: lastMatch.value, pattern: 'im_honorific_single',
              confidence: lastMatch.score, validated: true,
              verificationMode: lastMatch.verificationMode, correctedFrom: lastMatch.correctedFrom
            });
          } else {
            // Not in last names — try as first name
            const firstMatch = await context.GlobalHubService.matchFirstName(rawFirst);
            entities.firstName = firstMatch.value;
            entities.firstNameMeta = firstMatch;
            extractions.push({
              type: 'firstName', value: firstMatch.value, pattern: 'im_honorific_single',
              confidence: firstMatch.score, validated: firstMatch.match,
              verificationMode: firstMatch.verificationMode, correctedFrom: firstMatch.correctedFrom
            });
          }
        } else {
          entities.lastName = rawFirst;
          extractions.push({ type: 'lastName', value: rawFirst, pattern: 'im_honorific_single', confidence: 0.70 });
        }
      } else if (rawFirst && rawLast) {
        // Two names but no GlobalHubService
        entities.firstName = rawFirst;
        entities.lastName = rawLast;
        entities.fullName = `${rawFirst} ${rawLast}`;
        extractions.push({
          type: 'fullName', firstName: rawFirst, lastName: rawLast,
          pattern: 'im_honorific_full', confidence: 0.80
        });
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 2: "my name is [Name]"
    // ════════════════════════════════════════════════════════════════════════

    if (!entities.firstName && !entities.lastName) {
      const myNamePattern = /my name is (\w+)/i;
      const myNameMatch = text.match(myNamePattern);
      if (myNameMatch && myNameMatch[1]) {
        const candidate = this.capitalizeFirst(myNameMatch[1]);

        if (context.GlobalHubService) {
          try {
            const firstMatch = await context.GlobalHubService.matchFirstName(candidate);
            entities.firstName = firstMatch.value;
            entities.firstNameMeta = firstMatch;
            validations.push({
              entity: 'firstName', value: firstMatch.value, isValid: firstMatch.match,
              source: 'GlobalShare', verificationMode: firstMatch.verificationMode
            });
            extractions.push({
              type: 'firstName', value: firstMatch.value, pattern: 'my_name_is',
              confidence: firstMatch.score, validated: firstMatch.match,
              verificationMode: firstMatch.verificationMode,
              correctedFrom: firstMatch.correctedFrom, candidates: firstMatch.candidates
            });
          } catch (err) {
            // Non-blocking fallback
            entities.firstName = candidate;
            extractions.push({ type: 'firstName', value: candidate, pattern: 'my_name_is', confidence: 0.85, validated: false });
          }
        } else {
          entities.firstName = candidate;
          extractions.push({ type: 'firstName', value: candidate, pattern: 'my_name_is', confidence: 0.85 });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 3: "this is [First] [Last]"
    // ════════════════════════════════════════════════════════════════════════

    if (!entities.firstName || !entities.lastName) {
      const thisIsFullPattern = /this is (\w+)\s+(\w+)/i;
      const thisIsFullMatch = text.match(thisIsFullPattern);

      if (thisIsFullMatch && thisIsFullMatch[1] && thisIsFullMatch[2]
          && ScrabEngine.isValidSurnameCandidate(thisIsFullMatch[2])) {
        const firstCandidate = this.capitalizeFirst(thisIsFullMatch[1]);
        const secondCandidate = this.capitalizeFirst(thisIsFullMatch[2]);

        if (context.GlobalHubService) {
          const firstMatch = await context.GlobalHubService.matchFirstName(firstCandidate);
          const lastMatch = await context.GlobalHubService.matchLastName(secondCandidate);

          validations.push({
            scenario: 'this_is_full',
            first_candidate: { value: firstCandidate, ...firstMatch },
            second_candidate: { value: secondCandidate, ...lastMatch },
            source: 'GlobalShare'
          });

          // Always set firstName; only set lastName if it passes the connector blocklist
          entities.firstName = firstMatch.value;
          entities.firstNameMeta = firstMatch;
          if (lastMatch.value) {
            entities.lastName = lastMatch.value;
            entities.lastNameMeta = lastMatch;
          }
          if (entities.firstName && entities.lastName) {
            entities.fullName = `${entities.firstName} ${entities.lastName}`;
          }

          extractions.push({
            type: 'fullName',
            firstName: firstMatch.value,
            lastName: lastMatch.value,
            pattern: 'this_is_full',
            confidence: Math.min(firstMatch.score, lastMatch.score),
            validated: firstMatch.match && lastMatch.match,
            verificationMode: firstMatch.match && lastMatch.match ? 'exact' : (firstMatch.verificationMode || lastMatch.verificationMode),
            correctedFrom: firstMatch.correctedFrom || lastMatch.correctedFrom || null
          });
        } else {
          // No GlobalHubService — only accept firstName; skip secondCandidate
          // (already validated above by isValidSurnameCandidate)
          entities.firstName = firstCandidate;
          entities.lastName = secondCandidate;
          entities.fullName = `${firstCandidate} ${secondCandidate}`;
          extractions.push({
            type: 'fullName', firstName: firstCandidate, lastName: secondCandidate,
            pattern: 'this_is_full', confidence: 0.85
          });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 4: "call me [Name]"
    // ════════════════════════════════════════════════════════════════════════

    if (!entities.firstName) {
      const callMePattern = /call me (\w+)/i;
      const callMeMatch = text.match(callMePattern);
      if (callMeMatch && callMeMatch[1]) {
        const candidate = this.capitalizeFirst(callMeMatch[1]);

        if (context.GlobalHubService) {
          const firstMatch = await context.GlobalHubService.matchFirstName(candidate);
          entities.firstName = firstMatch.value;
          entities.firstNameMeta = firstMatch;
          validations.push({ entity: 'firstName', value: firstMatch.value, isValid: firstMatch.match, source: 'GlobalShare', verificationMode: firstMatch.verificationMode });
          extractions.push({
            type: 'firstName', value: firstMatch.value, pattern: 'call_me',
            confidence: firstMatch.score, validated: firstMatch.match,
            verificationMode: firstMatch.verificationMode,
            correctedFrom: firstMatch.correctedFrom, candidates: firstMatch.candidates
          });
        } else {
          entities.firstName = candidate;
          extractions.push({ type: 'firstName', value: candidate, pattern: 'call_me', confidence: 0.80 });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 5: "first name is [Name]"
    // ════════════════════════════════════════════════════════════════════════

    if (!entities.firstName) {
      const firstNamePattern = /(?:my\s+)?first\s+name\s+(?:is\s+)?(\w+)/i;
      const firstNameMatch = text.match(firstNamePattern);
      if (firstNameMatch && firstNameMatch[1]) {
        const candidate = this.capitalizeFirst(firstNameMatch[1]);

        if (context.GlobalHubService) {
          const firstMatch = await context.GlobalHubService.matchFirstName(candidate);
          entities.firstName = firstMatch.value;
          entities.firstNameMeta = firstMatch;
          validations.push({ entity: 'firstName', value: firstMatch.value, isValid: firstMatch.match, source: 'GlobalShare', verificationMode: firstMatch.verificationMode });
          extractions.push({
            type: 'firstName', value: firstMatch.value, pattern: 'first_name_is',
            confidence: firstMatch.score, validated: firstMatch.match,
            verificationMode: firstMatch.verificationMode,
            correctedFrom: firstMatch.correctedFrom, candidates: firstMatch.candidates
          });
        } else {
          entities.firstName = candidate;
          extractions.push({ type: 'firstName', value: candidate, pattern: 'first_name_is', confidence: 0.90 });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // PATTERN 6: "last name is [Name]"
    // ════════════════════════════════════════════════════════════════════════

    if (!entities.lastName) {
      const lastNamePattern = /(?:my\s+)?last\s+name\s+(?:is\s+)?(\w+)/i;
      const lastNameMatch = text.match(lastNamePattern);
      if (lastNameMatch && lastNameMatch[1]) {
        const candidate = this.capitalizeFirst(lastNameMatch[1]);

        if (context.GlobalHubService) {
          const lastMatch = await context.GlobalHubService.matchLastName(candidate);
          entities.lastName = lastMatch.value;
          entities.lastNameMeta = lastMatch;
          validations.push({ entity: 'lastName', value: lastMatch.value, isValid: lastMatch.match, source: 'GlobalShare', verificationMode: lastMatch.verificationMode });
          extractions.push({
            type: 'lastName', value: lastMatch.value, pattern: 'last_name_is',
            confidence: lastMatch.score, validated: lastMatch.match,
            verificationMode: lastMatch.verificationMode,
            correctedFrom: lastMatch.correctedFrom, candidates: lastMatch.candidates
          });
        } else {
          entities.lastName = candidate;
          extractions.push({ type: 'lastName', value: candidate, pattern: 'last_name_is', confidence: 0.85 });
        }
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // PHONE NUMBER EXTRACTION
    // ────────────────────────────────────────────────────────────────────────
    
    // Pattern: Various phone formats
    const phonePatterns = [
      /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/,  // 239-565-2202 or 2395652202
      /\((\d{3})\)\s*(\d{3})[-.\s]?(\d{4})/, // (239) 565-2202
      /(\d{10})/                          // 2395652202
    ];
    
    for (const pattern of phonePatterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract just digits
        const digits = match[0].replace(/\D/g, '');
        if (digits.length === 10) {
          entities.phone = digits;
          extractions.push({
            type: 'phone',
            value: digits,
            formatted: `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`,
            pattern: 'phone_format',
            confidence: 0.92
          });
          break;
        }
      }
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // EMAIL EXTRACTION
    // ────────────────────────────────────────────────────────────────────────
    
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const emailMatch = text.match(emailPattern);
    if (emailMatch) {
      entities.email = emailMatch[0].toLowerCase();
      extractions.push({
        type: 'email',
        value: entities.email,
        pattern: 'email_format',
        confidence: 0.98
      });
    }
    
    // ────────────────────────────────────────────────────────────────────────
    // ADDRESS EXTRACTION (Basic - can be enhanced)
    // ────────────────────────────────────────────────────────────────────────
    
    // Pattern: Street number + street name
    const addressPattern = /\b(\d+)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl)\b/i;
    const addressMatch = text.match(addressPattern);
    if (addressMatch) {
      entities.address = addressMatch[0];
      extractions.push({
        type: 'address',
        value: entities.address,
        pattern: 'street_address',
        confidence: 0.85
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // CUSTOM EXTRACTION PATTERNS (Config-Driven)
    // ────────────────────────────────────────────────────────────────────────
    const customPatterns = safeArr(config.customPatterns).filter(p => p && p.enabled !== false);
    for (const customPattern of customPatterns) {
      const entityName = `${customPattern.entityName || ''}`.trim();
      const regexSource = `${customPattern.pattern || ''}`.trim();
      if (!entityName || !regexSource) continue;

      let regex;
      try {
        regex = new RegExp(regexSource, 'i');
      } catch (err) {
        logger.warn('[ScrabEngine] Invalid custom extraction regex skipped', {
          entityName,
          pattern: regexSource,
          error: err.message
        });
        continue;
      }

      const match = text.match(regex);
      if (!match) continue;

      const extractedValue = `${match[1] || match[0] || ''}`.trim();
      if (!extractedValue) continue;

      let validated = false;
      if (customPattern.validateGlobalShare && context.GlobalHubService) {
        try {
          const lowerEntity = entityName.toLowerCase();
          if (lowerEntity.includes('firstname')) {
            validated = await context.GlobalHubService.isFirstName(extractedValue);
          } else if (lowerEntity.includes('lastname')) {
            validated = await context.GlobalHubService.isLastName(extractedValue);
          }
          validations.push({
            entity: entityName,
            value: extractedValue,
            isValid: validated,
            source: 'GlobalShare',
            type: 'custom_pattern'
          });
        } catch (err) {
          logger.debug('[ScrabEngine] GlobalShare validation skipped for custom extraction', {
            entityName,
            error: err.message
          });
        }
      }

      entities[entityName] = extractedValue;
      if (customPattern.autoHandoff !== false) {
        handoffEntities[entityName] = extractedValue;
      }

      extractions.push({
        type: entityName,
        label: customPattern.label || entityName,
        value: extractedValue,
        pattern: 'custom_regex',
        regex: regexSource,
        confidence: customPattern.confidence || 0.85,
        validated
      });
    }

    // Default built-ins are always wired to handoff when present
    ['firstName', 'lastName', 'fullName', 'phone', 'email', 'address'].forEach((key) => {
      if (entities[key]) {
        handoffEntities[key] = entities[key];
      }
    });

    // Propagate name verification metadata for downstream consumers
    if (entities.firstNameMeta) handoffEntities._firstNameMeta = entities.firstNameMeta;
    if (entities.lastNameMeta) handoffEntities._lastNameMeta = entities.lastNameMeta;

    return {
      entities,
      handoffEntities,
      extractions,
      validations,
      processingTimeMs: Date.now() - startTime
    };
  }
  
  static capitalizeFirst(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SCRABENGINE - Main Orchestrator
// ════════════════════════════════════════════════════════════════════════════

class ScrabEngine {
  /**
   * Process raw STT text through the complete pipeline
   * 
   * ENTRY POINT - Called from Agent2DiscoveryRunner
   * 
   * @param {Object} params
   * @param {string} params.rawText - Unprocessed STT result from Twilio/Deepgram
   * @param {Object} params.company - Company document with scrabEngine config
   * @param {Object} params.context - Call context (companyName, callSid, turn)
   * @returns {Promise<Object>} Complete scrab result with all stages
   */
  static async process({ rawText, company, context = {} }) {
    const T0 = Date.now();
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 0: INITIALIZE - Set up configuration and result structure
    // ════════════════════════════════════════════════════════════════════════
    
    const config = safeObj(company?.aiAgentSettings?.scrabEngine, {});
    
    // Global kill switch
    if (config.enabled === false) {
      logger.debug('[ScrabEngine] Disabled - returning raw text unprocessed');
      return this.buildDisabledResult(rawText);
    }
    
    logger.info('[ScrabEngine] 🚀 ENTRY - Processing text', {
      companyId: company?._id?.toString(),
      callSid: context.callSid,
      turn: context.turn,
      rawLength: rawText?.length || 0,
      rawPreview: clip(rawText, 60)
    });
    
    const result = {
      // IMMUTABLE - Never touched
      rawText: rawText,
      
      // Processing stages
      stage1_fillers: null,
      stage2_vocabulary: null,
      stage3_expansion: null,
      stage4_extraction: null,
      stage5_quality: null,
      
      // Final outputs
      normalizedText: null,
      originalTokens: null,
      expandedTokens: null,
      expansionMap: null,
      entities: null,
      handoffEntities: null,
      
      // Metadata
      transformations: [],
      quality: null,
      performance: {
        totalTimeMs: 0,
        stage1Ms: 0,
        stage2Ms: 0,
        stage3Ms: 0,
        stage4Ms: 0,
        stage5Ms: 0
      },
      meta: {
        scrabEngineVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        companyId: company?._id?.toString(),
        callSid: context.callSid,
        turn: context.turn
      }
    };
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 1: FILLER REMOVAL
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 1: Filler Removal');
    const T1 = Date.now();
    
    result.stage1_fillers = FillerRemovalEngine.process(
      rawText,
      config.fillers || {},
      {
        companyName: context.companyName || company?.businessName || company?.companyName
      }
    );
    
    result.performance.stage1Ms = Date.now() - T1;
    result.transformations.push(...result.stage1_fillers.transformations);
    
    logger.debug('[ScrabEngine] Stage 1 Complete', {
      removed: result.stage1_fillers.removed.length,
      timeMs: result.performance.stage1Ms,
      outputPreview: clip(result.stage1_fillers.cleaned, 60)
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 2: VOCABULARY NORMALIZATION
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 2: Vocabulary Normalization');
    const T2 = Date.now();
    
    result.stage2_vocabulary = VocabularyNormalizationEngine.process(
      result.stage1_fillers.cleaned,
      config.vocabulary || {}
    );
    
    result.performance.stage2Ms = Date.now() - T2;
    result.transformations.push(...result.stage2_vocabulary.transformations);
    
    logger.debug('[ScrabEngine] Stage 2 Complete', {
      applied: result.stage2_vocabulary.applied.length,
      timeMs: result.performance.stage2Ms,
      outputPreview: clip(result.stage2_vocabulary.normalized, 60)
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 3: TOKEN EXPANSION
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 3: Token Expansion');
    const T3 = Date.now();
    
    result.stage3_expansion = TokenExpansionEngine.process(
      result.stage2_vocabulary.normalized,
      config.synonyms || {}
    );
    
    result.performance.stage3Ms = Date.now() - T3;
    result.transformations.push(...result.stage3_expansion.transformations);
    
    logger.debug('[ScrabEngine] Stage 3 Complete', {
      originalTokens: result.stage3_expansion.originalTokens.length,
      expandedTokens: result.stage3_expansion.expandedTokens.length,
      expansionRatio: (result.stage3_expansion.expandedTokens.length / 
                      (result.stage3_expansion.originalTokens.length || 1)).toFixed(2),
      timeMs: result.performance.stage3Ms
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 4: ENTITY EXTRACTION
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 4: Entity Extraction');
    const T4 = Date.now();
    
    // Pass GlobalHubService for name validation
    const GlobalHubService = context.GlobalHubService || require('../services/GlobalHubService');
    
    result.stage4_extraction = await EntityExtractionEngine.process(
      result.stage2_vocabulary.normalized,
      config.extraction || {},
      {
        ...context,
        GlobalHubService
      }
    );
    
    result.performance.stage4Ms = Date.now() - T4;
    
    logger.debug('[ScrabEngine] Stage 4 Complete', {
      firstName: result.stage4_extraction.entities.firstName,
      lastName: result.stage4_extraction.entities.lastName,
      phone: result.stage4_extraction.entities.phone,
      extractions: result.stage4_extraction.extractions.length,
      validations: result.stage4_extraction.validations.length,
      timeMs: result.performance.stage4Ms
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // STAGE 5: QUALITY ASSESSMENT
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 5: Quality Assessment');
    const T5 = Date.now();
    
    result.stage5_quality = QualityGate.assess(
      result.stage2_vocabulary.normalized,
      config.qualityGates || {}
    );
    
    result.performance.stage5Ms = Date.now() - T5;
    
    logger.debug('[ScrabEngine] Stage 5 Complete', {
      passed: result.stage5_quality.passed,
      confidence: result.stage5_quality.confidence,
      reason: result.stage5_quality.reason,
      timeMs: result.performance.stage5Ms
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // FINALIZE RESULT
    // ════════════════════════════════════════════════════════════════════════
    
    result.normalizedText = result.stage2_vocabulary.normalized;
    result.originalTokens = result.stage3_expansion.originalTokens;
    result.expandedTokens = result.stage3_expansion.expandedTokens;
    result.expansionMap = result.stage3_expansion.expansionMap;
    result.entities = result.stage4_extraction.entities;
    result.handoffEntities = result.stage4_extraction.handoffEntities || result.stage4_extraction.entities;
    result.quality = result.stage5_quality;
    result.performance.totalTimeMs = Date.now() - T0;
    
    // ════════════════════════════════════════════════════════════════════════
    // EXIT LOG - Performance & Quality Summary
    // ════════════════════════════════════════════════════════════════════════
    
    logger.info('[ScrabEngine] ✅ EXIT - Processing complete', {
      companyId: company?._id?.toString(),
      callSid: context.callSid,
      turn: context.turn,
      rawPreview: clip(rawText, 40),
      normalizedPreview: clip(result.normalizedText, 40),
      transformations: result.transformations.length,
      tokensExpanded: result.expandedTokens.length - result.originalTokens.length,
      qualityPassed: result.quality.passed,
      totalTimeMs: result.performance.totalTimeMs,
      breakdown: {
        fillersMs: result.performance.stage1Ms,
        vocabMs: result.performance.stage2Ms,
        expansionMs: result.performance.stage3Ms,
        extractionMs: result.performance.stage4Ms,
        qualityMs: result.performance.stage5Ms
      },
      entitiesExtracted: {
        firstName: result.entities?.firstName || null,
        lastName: result.entities?.lastName || null,
        phone: result.entities?.phone || null,
        address: result.entities?.address || null
      }
    });
    
    // Performance warning if too slow
    if (result.performance.totalTimeMs > 50) {
      logger.warn('[ScrabEngine] ⚠️ Slow processing detected', {
        totalMs: result.performance.totalTimeMs,
        threshold: 50,
        recommendation: 'Consider optimizing rules or reducing entry count'
      });
    }
    
    return result;
  }
  
  /**
   * Build result structure when ScrabEngine is disabled
   */
  static buildDisabledResult(rawText) {
    const tokens = tokenize(rawText);
    return {
      rawText,
      normalizedText: rawText,
      originalTokens: tokens,
      expandedTokens: tokens,
      expansionMap: {},
      entities: { firstName: null, lastName: null, phone: null, address: null, email: null },
      handoffEntities: {},
      transformations: [],
      quality: { passed: true, reason: 'SCRABENGINE_DISABLED', confidence: 0.5 },
      performance: { totalTimeMs: 0, stage1Ms: 0, stage2Ms: 0, stage3Ms: 0, stage4Ms: 0, stage5Ms: 0 },
      meta: {
        scrabEngineVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        enabled: false
      }
    };
  }
  
  /**
   * Get processing statistics
   */
  static getStats(config = {}) {
    const fillerConfig = safeObj(config.fillers, {});
    const vocabConfig = safeObj(config.vocabulary, {});
    const synonymConfig = safeObj(config.synonyms, {});
    const extractionConfig = safeObj(config.extraction, {});
    
    const langDefaults = safeObj(vocabConfig.languageDefaults, {});

    return {
      enabled: config.enabled !== false,
      stages: {
        fillers: {
          enabled: fillerConfig.enabled !== false,
          customCount: safeArr(fillerConfig.customFillers).filter(f => f.enabled !== false).length,
          totalFillers: DEFAULT_FILLERS.length + (safeArr(fillerConfig.customFillers).filter(f => f.enabled !== false).length),
          builtinFillers: DEFAULT_FILLERS,
          builtinGreetings: DEFAULT_GREETINGS
        },
        vocabulary: {
          enabled: vocabConfig.enabled !== false,
          entryCount: safeArr(vocabConfig.entries).filter(e => e.enabled !== false).length,
          languageDefaults: {
            contractionsEnabled: langDefaults.contractionsEnabled !== false,
            laymanEnabled:       langDefaults.laymanEnabled       !== false,
            contractionCount:    DEFAULT_CONTRACTIONS.length,
            laymanCount:         DEFAULT_LAYMAN_VOCABULARY.length,
            contractionRules:    DEFAULT_CONTRACTIONS,
            laymanRules:         DEFAULT_LAYMAN_VOCABULARY
          }
        },
        synonyms: {
          enabled: synonymConfig.enabled !== false,
          wordSynonymCount: safeArr(synonymConfig.wordSynonyms).filter(s => s.enabled !== false).length,
          contextPatternCount: safeArr(synonymConfig.contextPatterns).filter(p => p.enabled !== false).length,
          totalExpansions: safeArr(synonymConfig.wordSynonyms).filter(s => s.enabled !== false)
            .reduce((sum, s) => sum + safeArr(s.synonyms).length, 0)
        },
        extraction: {
          enabled: extractionConfig.enabled !== false,
          customPatternCount: safeArr(extractionConfig.customPatterns).filter(p => p.enabled !== false).length,
          handoffPatternCount: safeArr(extractionConfig.customPatterns)
            .filter(p => p.enabled !== false && p.autoHandoff !== false).length
        }
      }
    };
  }
  
  /**
   * Generate Call Console visual trace events
   * 
   * Creates a comprehensive transformation story for Call Console transcript display
   * Shows the complete journey from raw STT → cleaned delivery to triggers
   * 
   * IMPORTANT: This is a diagnostic function. It must NEVER crash the call flow.
   * If any error occurs, we return an empty array and log the error.
   * 
   * @param {Object} scrabResult - Complete ScrabEngine result
   * @returns {Array} Array of trace events for Call Console
   */
  static generateCallConsoleTrace(scrabResult) {
    try {
    const events = [];
    
    // Entry event - Raw STT received
    events.push({
      stage: 'SCRABENGINE_ENTRY',
      icon: '🎤',
      title: 'Raw STT from Deepgram',
      text: scrabResult.rawText,
      status: 'received',
      timestamp: scrabResult.meta.timestamp,
      metadata: {
        length: scrabResult.rawText?.length || 0,
        wordCount: scrabResult.originalTokens?.length || 0
      }
    });
    
    // Stage 1: Fillers
    if (scrabResult.stage1_fillers) {
      const removed = scrabResult.stage1_fillers.removed || [];
      events.push({
        stage: 'SCRABENGINE_STAGE1',
        icon: '🧹',
        title: 'Stage 1: Filler Removal',
        text: scrabResult.stage1_fillers.cleaned,
        status: removed.length > 0 ? 'modified' : 'unchanged',
        processingTimeMs: scrabResult.stage1_fillers.processingTimeMs,
        changes: removed.map(r => ({
          type: r.type,
          action: 'removed',
          value: r.value,
          count: r.count || 1
        })),
        summary: removed.length > 0 
          ? `Removed ${removed.length} filler(s): ${removed.slice(0, 3).map(r => `"${r.value}"`).join(', ')}${removed.length > 3 ? '...' : ''}`
          : 'No fillers found'
      });
    }
    
    // Stage 2: Vocabulary
    if (scrabResult.stage2_vocabulary) {
      const applied = scrabResult.stage2_vocabulary.applied || [];
      events.push({
        stage: 'SCRABENGINE_STAGE2',
        icon: '📝',
        title: 'Stage 2: Vocabulary Normalization',
        text: scrabResult.stage2_vocabulary.normalized,
        status: applied.length > 0 ? 'modified' : 'unchanged',
        processingTimeMs: scrabResult.stage2_vocabulary.processingTimeMs,
        changes: applied.map(a => ({
          type: 'normalized',
          from: a.from,
          to: a.to,
          matchMode: a.matchMode,
          count: a.count
        })),
        summary: applied.length > 0
          ? `Applied ${applied.length} normalization(s): ${applied.slice(0, 3).map(a => `"${a.from}" → "${a.to}"`).join(', ')}${applied.length > 3 ? '...' : ''}`
          : 'No normalizations applied'
      });
    }
    
    // Stage 3: Token Expansion
    if (scrabResult.stage3_expansion) {
      const originalCount = scrabResult.stage3_expansion.originalTokens?.length || 0;
      const expandedCount = scrabResult.stage3_expansion.expandedTokens?.length || 0;
      const addedCount = expandedCount - originalCount;
      const expansionMap = scrabResult.stage3_expansion.expansionMap || {};
      
      events.push({
        stage: 'SCRABENGINE_STAGE3',
        icon: '🎯',
        title: 'Stage 3: Token Expansion',
        text: `Original: [${scrabResult.stage3_expansion.originalTokens?.join(', ')}]\nExpanded: [${scrabResult.stage3_expansion.expandedTokens?.join(', ')}]`,
        status: addedCount > 0 ? 'expanded' : 'unchanged',
        processingTimeMs: scrabResult.stage3_expansion.processingTimeMs,
        changes: Object.keys(expansionMap).map(key => ({
          type: 'expansion',
          source: key,
          addedTokens: expansionMap[key],
          count: expansionMap[key]?.length || 0
        })),
        summary: addedCount > 0
          ? `Expanded ${originalCount} tokens → ${expandedCount} tokens (+${addedCount} synonyms)`
          : 'No token expansion'
      });
    }
    
    // Stage 4: Entity Extraction
    if (scrabResult.stage4_extraction) {
      const extractions = scrabResult.stage4_extraction.extractions || [];
      const validations = scrabResult.stage4_extraction.validations || [];
      const entities = scrabResult.stage4_extraction.entities || {};
      
      const entitiesSummary = [];
      if (entities.firstName) {
        const validation = validations.find(v => v.entity === 'firstName');
        const validBadge = validation?.isValid ? ' ✅' : validation ? ' ⚠️' : '';
        entitiesSummary.push(`First: "${entities.firstName}"${validBadge}`);
      }
      if (entities.lastName) {
        const validation = validations.find(v => v.entity === 'lastName');
        const validBadge = validation?.isValid ? ' ✅' : validation ? ' ⚠️' : '';
        entitiesSummary.push(`Last: "${entities.lastName}"${validBadge}`);
      }
      if (entities.phone) entitiesSummary.push(`Phone: ${entities.phone}`);
      if (entities.address) entitiesSummary.push(`Address: ${entities.address}`);
      if (entities.email) entitiesSummary.push(`Email: ${entities.email}`);
      
      events.push({
        stage: 'SCRABENGINE_STAGE4',
        icon: '🏷️',
        title: 'Stage 4: Entity Extraction',
        text: entitiesSummary.length > 0 ? entitiesSummary.join(' | ') : 'No entities extracted',
        status: extractions.length > 0 ? 'extracted' : 'none',
        processingTimeMs: scrabResult.stage4_extraction.processingTimeMs,
        entities: entities,
        extractions: extractions,
        validations: validations,
        summary: extractions.length > 0
          ? `Extracted ${extractions.length} entit${extractions.length === 1 ? 'y' : 'ies'}: ${extractions.map(e => `${e.type}="${e.value}"${e.validated ? ' (validated ✅)' : ''}`).join(', ')}`
          : 'No entities found',
        globalShareCheck: validations.length > 0 
          ? validations.map(v => `${v.value} checked against ${v.dictionarySize?.toLocaleString?.() ?? 'N/A'} ${v.entity || 'entity'}s → ${v.isValid ? 'VALID ✅' : 'NOT FOUND ⚠️'}`).join('; ')
          : null
      });
    }
    
    // Stage 5: Quality Gate
    if (scrabResult.stage5_quality) {
      events.push({
        stage: 'SCRABENGINE_STAGE5',
        icon: scrabResult.stage5_quality.passed ? '✅' : '⚠️',
        title: 'Stage 5: Quality Assessment',
        status: scrabResult.stage5_quality.passed ? 'passed' : 'failed',
        reason: scrabResult.stage5_quality.reason,
        confidence: scrabResult.stage5_quality.confidence,
        details: scrabResult.stage5_quality.details,
        summary: scrabResult.stage5_quality.passed
          ? `Quality OK (${Math.round(scrabResult.stage5_quality.confidence * 100)}% confidence)`
          : `Quality ${scrabResult.stage5_quality.reason} - ${scrabResult.stage5_quality.shouldReprompt ? 'reprompt suggested' : 'proceeding'}`
      });
    }
    
    // Final delivery event
    events.push({
      stage: 'SCRABENGINE_DELIVERY',
      icon: '🚀',
      title: 'Delivery to Triggers',
      text: scrabResult.normalizedText,
      status: 'delivered',
      metadata: {
        totalTransformations: scrabResult.transformations?.length || 0,
        totalProcessingTimeMs: scrabResult.performance?.totalTimeMs || 0,
        tokensDelivered: scrabResult.expandedTokens?.length || 0
      },
      summary: `Processed in ${scrabResult.performance?.totalTimeMs || 0}ms. ${scrabResult.transformations?.length || 0} transformation(s) applied. Ready for trigger matching.`
    });
    
    return events;
    } catch (err) {
      logger.error('[ScrabEngine] generateCallConsoleTrace CRASHED - returning empty (non-fatal)', {
        error: err.message,
        stack: err.stack?.substring(0, 300)
      });
      return [];
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  ScrabEngine,
  FillerRemovalEngine,
  VocabularyNormalizationEngine,
  TokenExpansionEngine,
  EntityExtractionEngine,
  QualityGate,
  // Export system defaults so the admin route can serve them to the UI
  DEFAULT_FILLERS,
  DEFAULT_GREETINGS,
  DEFAULT_CONTRACTIONS,
  DEFAULT_LAYMAN_VOCABULARY
};

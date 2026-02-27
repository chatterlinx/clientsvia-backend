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
    
    const tokens = tokenize(text);
    const wordCount = tokens.length;
    
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
      normalizeText(text) === pattern
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
      stage4_quality: null,
      
      // Final outputs
      normalizedText: null,
      originalTokens: null,
      expandedTokens: null,
      expansionMap: null,
      
      // Metadata
      transformations: [],
      quality: null,
      performance: {
        totalTimeMs: 0,
        stage1Ms: 0,
        stage2Ms: 0,
        stage3Ms: 0,
        stage4Ms: 0
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
    // STAGE 4: QUALITY ASSESSMENT
    // ════════════════════════════════════════════════════════════════════════
    
    logger.debug('[ScrabEngine] Stage 4: Quality Assessment');
    const T4 = Date.now();
    
    result.stage4_quality = QualityGate.assess(
      result.stage2_vocabulary.normalized,
      config.qualityGates || {}
    );
    
    result.performance.stage4Ms = Date.now() - T4;
    
    logger.debug('[ScrabEngine] Stage 4 Complete', {
      passed: result.stage4_quality.passed,
      confidence: result.stage4_quality.confidence,
      reason: result.stage4_quality.reason,
      timeMs: result.performance.stage4Ms
    });
    
    // ════════════════════════════════════════════════════════════════════════
    // FINALIZE RESULT
    // ════════════════════════════════════════════════════════════════════════
    
    result.normalizedText = result.stage2_vocabulary.normalized;
    result.originalTokens = result.stage3_expansion.originalTokens;
    result.expandedTokens = result.stage3_expansion.expandedTokens;
    result.expansionMap = result.stage3_expansion.expansionMap;
    result.quality = result.stage4_quality;
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
        qualityMs: result.performance.stage4Ms
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
      transformations: [],
      quality: { passed: true, reason: 'SCRABENGINE_DISABLED', confidence: 0.5 },
      performance: { totalTimeMs: 0, stage1Ms: 0, stage2Ms: 0, stage3Ms: 0, stage4Ms: 0 },
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
    
    return {
      enabled: config.enabled !== false,
      stages: {
        fillers: {
          enabled: fillerConfig.enabled !== false,
          customCount: safeArr(fillerConfig.customFillers).filter(f => f.enabled !== false).length,
          totalFillers: DEFAULT_FILLERS.length + (safeArr(fillerConfig.customFillers).filter(f => f.enabled !== false).length)
        },
        vocabulary: {
          enabled: vocabConfig.enabled !== false,
          entryCount: safeArr(vocabConfig.entries).filter(e => e.enabled !== false).length
        },
        synonyms: {
          enabled: synonymConfig.enabled !== false,
          wordSynonymCount: safeArr(synonymConfig.wordSynonyms).filter(s => s.enabled !== false).length,
          contextPatternCount: safeArr(synonymConfig.contextPatterns).filter(p => p.enabled !== false).length,
          totalExpansions: safeArr(synonymConfig.wordSynonyms).filter(s => s.enabled !== false)
            .reduce((sum, s) => sum + safeArr(s.synonyms).length, 0)
        }
      }
    };
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
  QualityGate
};

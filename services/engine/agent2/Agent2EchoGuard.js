/**
 * Agent2EchoGuard.js
 * 
 * V4: HARD GUARD against echoing caller text in agent responses.
 * 
 * PROBLEM:
 * Fallback templates like "It sounds like {capturedReason}" can echo raw caller
 * transcript, making the agent say things like:
 *   "It sounds like . I'm having an issue with my AC..."
 * 
 * This is a Prime Directive violation: spoken text must be UI-owned,
 * and must NEVER include raw caller transcript tokens.
 * 
 * SOLUTION:
 * Before any response is spoken, check for suspicious overlap with caller input.
 * If overlap detected → BLOCK and use emergency fallback.
 * 
 * DETECTION RULES:
 * 1. 3+ consecutive words from caller appear in response → BLOCK
 * 2. 8+ consecutive characters from caller appear in response → BLOCK
 * 3. Known echo patterns ("It sounds like", "You said", "I heard") + caller text → BLOCK
 * 
 * @module services/engine/agent2/Agent2EchoGuard
 */

'use strict';

const logger = require('../../../utils/logger');

/**
 * Minimum consecutive words to trigger echo detection.
 */
const MIN_CONSECUTIVE_WORDS = 3;

/**
 * Minimum consecutive characters to trigger echo detection.
 */
const MIN_CONSECUTIVE_CHARS = 8;

/**
 * Known echo pattern prefixes that often precede caller text.
 * If response starts with these AND contains caller overlap, it's almost certainly an echo.
 */
const ECHO_PATTERN_PREFIXES = [
  'it sounds like',
  'you said',
  'i heard',
  'you mentioned',
  'so you',
  'so your',
  'sounds like you',
  'sounds like your',
  'i understand you',
  'i understand your'
];

/**
 * Words that are too common to count as meaningful overlap.
 * These won't trigger echo detection on their own.
 */
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'the', 'a', 'an',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'and', 'or', 'but', 'if', 'then', 'so', 'than', 'that', 'this', 'these',
  'not', 'no', 'yes', 'can', 'just', 'like', 'um', 'uh', 'oh', 'hi', 'hello',
  'okay', 'ok', 'yeah', 'yep', 'nope', 'well', 'right', 'got', 'get'
]);

/**
 * Extract words from text (lowercase, alphanumeric only).
 */
function extractWords(text) {
  if (!text || typeof text !== 'string') return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

/**
 * Extract meaningful words (excludes stop words).
 */
function extractMeaningfulWords(text) {
  return extractWords(text).filter(w => !STOP_WORDS.has(w));
}

/**
 * Check if response contains N consecutive words from caller input.
 * 
 * @param {string} callerText - The caller's utterance
 * @param {string} responseText - The proposed agent response
 * @param {number} minWords - Minimum consecutive words to trigger (default: 3)
 * @returns {{ detected: boolean, overlap: string|null, wordCount: number }}
 */
function detectConsecutiveWordOverlap(callerText, responseText, minWords = MIN_CONSECUTIVE_WORDS) {
  const callerWords = extractMeaningfulWords(callerText);
  const responseWords = extractWords(responseText);
  
  if (callerWords.length < minWords) {
    return { detected: false, overlap: null, wordCount: 0 };
  }
  
  // Slide a window of size minWords through caller words
  for (let windowSize = Math.min(callerWords.length, 6); windowSize >= minWords; windowSize--) {
    for (let i = 0; i <= callerWords.length - windowSize; i++) {
      const window = callerWords.slice(i, i + windowSize);
      const windowStr = window.join(' ');
      
      // Check if this window appears in response (as consecutive words)
      const responseStr = responseWords.join(' ');
      if (responseStr.includes(windowStr)) {
        return {
          detected: true,
          overlap: windowStr,
          wordCount: windowSize
        };
      }
    }
  }
  
  return { detected: false, overlap: null, wordCount: 0 };
}

/**
 * Check if response contains N consecutive characters from caller input.
 * 
 * @param {string} callerText - The caller's utterance
 * @param {string} responseText - The proposed agent response
 * @param {number} minChars - Minimum consecutive chars to trigger (default: 8)
 * @returns {{ detected: boolean, overlap: string|null, charCount: number }}
 */
function detectConsecutiveCharOverlap(callerText, responseText, minChars = MIN_CONSECUTIVE_CHARS) {
  if (!callerText || !responseText) {
    return { detected: false, overlap: null, charCount: 0 };
  }
  
  const callerLower = callerText.toLowerCase().trim();
  const responseLower = responseText.toLowerCase().trim();
  
  // Skip if caller text is too short
  if (callerLower.length < minChars) {
    return { detected: false, overlap: null, charCount: 0 };
  }
  
  // Find longest common substring
  let maxOverlap = '';
  for (let i = 0; i < callerLower.length - minChars + 1; i++) {
    for (let j = minChars; j <= Math.min(callerLower.length - i, 50); j++) {
      const substr = callerLower.substring(i, i + j);
      if (responseLower.includes(substr) && substr.length > maxOverlap.length) {
        // Make sure it's not just common phrases
        const words = extractMeaningfulWords(substr);
        if (words.length >= 2 || substr.length >= 12) {
          maxOverlap = substr;
        }
      }
    }
  }
  
  if (maxOverlap.length >= minChars) {
    return {
      detected: true,
      overlap: maxOverlap,
      charCount: maxOverlap.length
    };
  }
  
  return { detected: false, overlap: null, charCount: 0 };
}

/**
 * Check if response uses known echo patterns with caller text.
 * 
 * @param {string} callerText - The caller's utterance
 * @param {string} responseText - The proposed agent response
 * @returns {{ detected: boolean, pattern: string|null }}
 */
function detectEchoPattern(callerText, responseText) {
  if (!callerText || !responseText) {
    return { detected: false, pattern: null };
  }
  
  const responseLower = responseText.toLowerCase().trim();
  
  for (const prefix of ECHO_PATTERN_PREFIXES) {
    if (responseLower.startsWith(prefix) || responseLower.includes(`. ${prefix}`)) {
      // Check if anything after the prefix matches caller text
      const afterPrefix = responseLower.split(prefix)[1] || '';
      const callerWords = extractMeaningfulWords(callerText);
      const afterWords = extractMeaningfulWords(afterPrefix);
      
      // If 2+ meaningful words from caller appear after the echo prefix, it's an echo
      const matchCount = callerWords.filter(w => afterWords.includes(w)).length;
      if (matchCount >= 2) {
        return {
          detected: true,
          pattern: prefix
        };
      }
    }
  }
  
  return { detected: false, pattern: null };
}

/**
 * Main guard function: Check if a response echoes caller text.
 * 
 * @param {string} callerText - The caller's utterance (current turn)
 * @param {string} responseText - The proposed agent response
 * @param {Object} options - Optional settings
 * @param {number} options.minWords - Min consecutive words (default: 3)
 * @param {number} options.minChars - Min consecutive chars (default: 8)
 * @returns {Object} Detection result
 */
function checkForEcho(callerText, responseText, options = {}) {
  const minWords = options.minWords || MIN_CONSECUTIVE_WORDS;
  const minChars = options.minChars || MIN_CONSECUTIVE_CHARS;
  
  const result = {
    blocked: false,
    reason: null,
    details: {
      wordOverlap: null,
      charOverlap: null,
      echoPattern: null
    }
  };
  
  if (!callerText || !responseText) {
    return result;
  }
  
  // Check 1: Echo pattern detection (highest priority)
  const patternCheck = detectEchoPattern(callerText, responseText);
  if (patternCheck.detected) {
    result.blocked = true;
    result.reason = 'ECHO_PATTERN_DETECTED';
    result.details.echoPattern = patternCheck.pattern;
    return result;
  }
  
  // Check 2: Consecutive word overlap
  const wordCheck = detectConsecutiveWordOverlap(callerText, responseText, minWords);
  if (wordCheck.detected) {
    result.blocked = true;
    result.reason = 'CONSECUTIVE_WORD_OVERLAP';
    result.details.wordOverlap = {
      overlap: wordCheck.overlap,
      wordCount: wordCheck.wordCount
    };
    return result;
  }
  
  // Check 3: Consecutive character overlap
  const charCheck = detectConsecutiveCharOverlap(callerText, responseText, minChars);
  if (charCheck.detected) {
    result.blocked = true;
    result.reason = 'CONSECUTIVE_CHAR_OVERLAP';
    result.details.charOverlap = {
      overlap: charCheck.overlap,
      charCount: charCheck.charCount
    };
    return result;
  }
  
  return result;
}

/**
 * Build the event data for A2_SPOKEN_ECHO_BLOCKED.
 * 
 * @param {Object} checkResult - Result from checkForEcho()
 * @param {string} callerText - The caller's utterance
 * @param {string} responseText - The blocked response
 * @param {string} uiPath - The UI path that generated the response
 * @param {number} turn - Current turn number
 * @returns {Object} Event data
 */
function buildBlockedEvent(checkResult, callerText, responseText, uiPath, turn) {
  return {
    severity: 'CRITICAL',
    reason: checkResult.reason,
    details: checkResult.details,
    callerPreview: (callerText || '').substring(0, 80),
    responsePreview: (responseText || '').substring(0, 80),
    uiPathAttempted: uiPath || 'unknown',
    turn,
    action: 'REPLACED_WITH_EMERGENCY_FALLBACK',
    rule: 'Prime Directive: Spoken text must not include raw caller transcript'
  };
}

module.exports = {
  checkForEcho,
  buildBlockedEvent,
  detectConsecutiveWordOverlap,
  detectConsecutiveCharOverlap,
  detectEchoPattern,
  MIN_CONSECUTIVE_WORDS,
  MIN_CONSECUTIVE_CHARS
};

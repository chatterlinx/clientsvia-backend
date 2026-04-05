'use strict';

/**
 * ============================================================================
 * STRING DISTANCE & PHONETIC UTILITIES
 * Levenshtein distance/similarity + Double Metaphone phonetic encoding.
 * ============================================================================
 *
 * Used by:
 * - GlobalHubService (fuzzy name matching against dictionary)
 * - ConversationEngine (spelling variant detection)
 * - Agent2GreetingInterceptor (greeting fuzzy matching)
 * - scenarioGaps (trigger deduplication)
 * - BridgeService (phonetic index for UAP fuzzy recovery)
 * - UtteranceActParser (Pass 4 phonetic matching)
 */

/**
 * Calculate the Levenshtein edit distance between two strings.
 *
 * The edit distance is the minimum number of single-character insertions,
 * deletions, or substitutions required to transform string `a` into string `b`.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Integer edit distance (0 = identical)
 *
 * @example
 * levenshteinDistance('Dustin', 'Dustn')  // → 1  (deletion)
 * levenshteinDistance('Mark', 'Marc')     // → 1  (substitution)
 * levenshteinDistance('John', 'John')     // → 0  (identical)
 * levenshteinDistance('', 'abc')          // → 3
 */
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,      // insertion
                    matrix[i - 1][j] + 1       // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Calculate the Levenshtein similarity ratio between two strings.
 *
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 * Computed as: 1 - (editDistance / maxLength).
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity ratio 0.0-1.0
 *
 * @example
 * levenshteinSimilarity('Mark', 'Marc')     // → 0.75
 * levenshteinSimilarity('John', 'John')     // → 1.0
 * levenshteinSimilarity('abc', 'xyz')       // → 0.0
 */
function levenshteinSimilarity(a, b) {
    const lenA = a.length;
    const lenB = b.length;

    if (lenA === 0) return lenB === 0 ? 1 : 0;
    if (lenB === 0) return 0;

    const distance = levenshteinDistance(a, b);
    const maxLen = Math.max(lenA, lenB);
    return 1 - (distance / maxLen);
}

// ═════════════════════════════════════════════════════════════════════════════
// DOUBLE METAPHONE — Phonetic encoding for fuzzy/TTS-garble recovery
// ═════════════════════════════════════════════════════════════════════════════
//
// Implementation of Lawrence Philips' Double Metaphone algorithm (2000).
// Returns [primary, alternate] phonetic codes for an English word.
// Pure JS — no npm dependency (the `double-metaphone` package is ESM-only).
//
// Used by BridgeService to build phonetic phrase index, and by
// UtteranceActParser Pass 4B for runtime phonetic matching.

/**
 * Compute Double Metaphone codes for an English word.
 * @param {string} word — the word to encode
 * @returns {[string, string]} — [primary, alternate] codes (max 4 chars each)
 */
function doubleMetaphone(word) {
  if (!word || typeof word !== 'string') return ['', ''];
  const original = word.toUpperCase();
  const length   = original.length;
  if (length < 1) return ['', ''];

  let primary   = '';
  let secondary = '';
  let current   = 0;
  const last    = length - 1;
  const MAX     = 4;

  // Helpers
  const at      = (i) => (i >= 0 && i < length) ? original[i] : '';
  const substr  = (i, n) => original.substring(i, i + n);
  const isVowel = (c) => 'AEIOUY'.includes(c);
  const slavoGermanic = /W|K|CZ|WITZ/i.test(word);

  function add(main, alt) {
    if (primary.length   < MAX) primary   += main;
    if (secondary.length < MAX) secondary += (alt || main);
  }

  // Skip initial silent letters
  if (['GN', 'KN', 'PN', 'AE', 'WR'].includes(substr(0, 2))) current++;

  // Initial X → S
  if (at(0) === 'X') { add('S'); current++; }

  while (current < length && (primary.length < MAX || secondary.length < MAX)) {
    const ch = at(current);

    // ── Vowels — only encode at start ─────────────────────────────────
    if (isVowel(ch)) {
      if (current === 0) add('A');
      current++;
      continue;
    }

    switch (ch) {
      case 'B':
        add('P');
        current += (at(current + 1) === 'B') ? 2 : 1;
        break;

      case 'C': {
        // Italian vs English
        if (current > 1 && !isVowel(at(current - 2)) &&
            substr(current - 1, 3) === 'ACH' &&
            at(current + 2) !== 'I' && (at(current + 2) !== 'E' || substr(current - 2, 6) === 'BACHER' || substr(current - 2, 6) === 'MACHER')) {
          add('K'); current += 2; break;
        }
        if (current === 0 && substr(0, 6) === 'CAESAR') { add('S'); current += 2; break; }
        if (substr(current, 4) === 'CHIA') { add('K'); current += 2; break; }
        if (substr(current, 2) === 'CH') {
          if (current > 0 && substr(current, 4) === 'CHAE') { add('K', 'X'); current += 2; break; }
          if (current === 0 && (['HARAC', 'HARIS'].includes(substr(1, 5)) || ['HOR', 'HYM', 'HIA', 'HEM'].includes(substr(1, 3))) && substr(0, 5) !== 'CHORE') { add('K'); current += 2; break; }
          if (['VAN ', 'VON '].includes(substr(0, 4)) || substr(0, 3) === 'SCH' ||
              ['ORCHES', 'ARCHIT', 'ORCHID'].includes(substr(current - 2, 6)) ||
              'TS'.includes(at(current + 2)) ||
              ((current === 0 || 'AOUE'.includes(at(current - 1))) && 'BFHLMNRVW '.includes(at(current + 2)))) {
            add('K'); current += 2; break;
          }
          if (current > 0) { add(substr(0, 2) === 'MC' ? 'K' : 'X', 'K'); } else { add('X'); }
          current += 2; break;
        }
        if (substr(current, 2) === 'CZ' && substr(current - 2, 4) !== 'WICZ') { add('S', 'X'); current += 2; break; }
        if (substr(current + 1, 3) === 'CIA') { add('X'); current += 3; break; }
        if (substr(current, 2) === 'CC' && !(current === 1 && at(0) === 'M')) {
          if ('IEH'.includes(at(current + 2)) && substr(current + 2, 2) !== 'HU') {
            if ((current === 1 && at(0) === 'A') || ['UCCEE', 'UCCES'].includes(substr(current - 1, 5))) { add('KS'); } else { add('X'); }
            current += 3; break;
          } else { add('K'); current += 2; break; }
        }
        if ('CKQ'.includes(substr(current, 2)[1] || '')) { add('K'); current += 2; break; }
        if (['CI', 'CE', 'CY'].includes(substr(current, 2))) { add('S'); current += 2; break; }
        add('K'); current += ('C '.includes(at(current + 1)) && substr(current + 1, 2) !== 'CE' && substr(current + 1, 2) !== 'CI') ? 1 : (['CKQ'].includes(at(current + 1)) ? 2 : 1);
        break;
      }

      case 'D':
        if (substr(current, 2) === 'DG') {
          if ('IEY'.includes(at(current + 2))) { add('J'); current += 3; }
          else { add('TK'); current += 2; }
        } else if (['DT', 'DD'].includes(substr(current, 2))) { add('T'); current += 2; }
        else { add('T'); current++; }
        break;

      case 'F':
        add('F'); current += (at(current + 1) === 'F') ? 2 : 1;
        break;

      case 'G': {
        if (at(current + 1) === 'H') {
          if (current > 0 && !isVowel(at(current - 1))) { add('K'); current += 2; break; }
          if (current === 0) { add(at(current + 2) === 'I' ? 'J' : 'K'); current += 2; break; }
          if ((current > 1 && 'BHD'.includes(at(current - 2))) || (current > 2 && 'BHD'.includes(at(current - 3))) || (current > 3 && 'BH'.includes(at(current - 4)))) { current += 2; break; }
          if (current > 2 && at(current - 1) === 'U' && 'CGLRT'.includes(at(current - 3))) { add('F'); } else if (current > 0 && at(current - 1) !== 'I') { add('K'); }
          current += 2; break;
        }
        if (at(current + 1) === 'N') {
          if (current === 1 && isVowel(at(0)) && !slavoGermanic) { add('KN', 'N'); } else {
            if (substr(current + 2, 2) !== 'EY' && at(current + 1) !== 'Y' && !slavoGermanic) { add('N', 'KN'); } else { add('KN'); }
          }
          current += 2; break;
        }
        if (substr(current + 1, 2) === 'LI' && !slavoGermanic) { add('KL', 'L'); current += 2; break; }
        if (current === 0 && (at(1) === 'Y' || ['ES','EP','EB','EL','EY','IB','IL','IN','IE','EI','ER'].includes(substr(1, 2)))) { add('K', 'J'); current += 2; break; }
        if ((substr(current + 1, 2) === 'ER' || at(current + 1) === 'Y') && !['DANGER','RANGER','MANGER'].includes(substr(0, 6)) && !'EI'.includes(at(current - 1)) && !['RGY','OGY'].includes(substr(current - 1, 3))) { add('K', 'J'); current += 2; break; }
        if ('EIY'.includes(at(current + 1)) || ['AGGI','OGGI'].includes(substr(current - 1, 4))) {
          if (['VAN ','VON '].includes(substr(0, 4)) || substr(0, 3) === 'SCH' || substr(current + 1, 2) === 'ET') { add('K'); } else {
            add(substr(current + 1, 4) === 'IER ' ? 'J' : 'J', 'K');
          }
          current += 2; break;
        }
        add('K'); current += (at(current + 1) === 'G') ? 2 : 1;
        break;
      }

      case 'H':
        if ((current === 0 || isVowel(at(current - 1))) && isVowel(at(current + 1))) { add('H'); current += 2; } else { current++; }
        break;

      case 'J':
        if (substr(current, 4) === 'JOSE' || substr(0, 4) === 'SAN ') { add('H'); }
        else if (current === 0) { add('J', 'A'); }
        else if (isVowel(at(current - 1)) && !slavoGermanic && (at(current + 1) === 'A' || at(current + 1) === 'O')) { add('J', 'H'); }
        else { add('J'); }
        current += (at(current + 1) === 'J') ? 2 : 1;
        break;

      case 'K':
        add('K'); current += (at(current + 1) === 'K') ? 2 : 1;
        break;

      case 'L':
        if (at(current + 1) === 'L') {
          if ((current === length - 3 && ['ILLO','ILLA','ALLE'].includes(substr(current - 1, 4))) ||
              (['AS','OS'].includes(substr(last - 1, 2)) || 'AO'.includes(at(last))) && substr(current - 1, 4) === 'ALLE') {
            add('L', ''); current += 2; break;
          }
          current += 2;
        } else { current++; }
        add('L');
        break;

      case 'M':
        add('M');
        if (substr(current - 1, 3) === 'UMB' && (current + 1 === last || substr(current + 2, 2) === 'ER')) { current += 2; }
        else { current += (at(current + 1) === 'M') ? 2 : 1; }
        break;

      case 'N':
        add('N'); current += (at(current + 1) === 'N') ? 2 : 1;
        break;

      case 'P':
        if (at(current + 1) === 'H') { add('F'); current += 2; }
        else { add('P'); current += ('PB'.includes(at(current + 1))) ? 2 : 1; }
        break;

      case 'Q':
        add('K'); current += (at(current + 1) === 'Q') ? 2 : 1;
        break;

      case 'R':
        // French final -ER/-IER
        if (current === last && !slavoGermanic && substr(current - 2, 2) === 'IE' && !['ME','MA'].includes(substr(current - 4, 2))) {
          add('', 'R');
        } else { add('R'); }
        current += (at(current + 1) === 'R') ? 2 : 1;
        break;

      case 'S': {
        if (['ISL','YSL'].includes(substr(current - 1, 3))) { current++; break; }
        if (current === 0 && substr(0, 5) === 'SUGAR') { add('X', 'S'); current++; break; }
        if (substr(current, 2) === 'SH') {
          add((['HEIM','HOEK','HOLM','HOLZ'].includes(substr(current + 1, 4))) ? 'S' : 'X');
          current += 2; break;
        }
        if (['SIO','SIA'].includes(substr(current, 3)) || substr(current, 4) === 'SIAN') {
          add(slavoGermanic ? 'S' : 'X', slavoGermanic ? 'S' : 'S');
          current += 3; break;
        }
        if ((current === 0 && 'MNKL'.includes(at(1))) || substr(current + 1, 1) === 'Z') { add('S', 'X'); current += (at(current + 1) === 'Z') ? 2 : 1; break; }
        if (substr(current, 2) === 'SC') {
          if (at(current + 2) === 'H') {
            if (['OO','ER','EN','UY','ED','EM'].includes(substr(current + 3, 2))) { add((['ER','EN'].includes(substr(current + 3, 2))) ? 'X' : 'SK'); current += 3; break; }
            add(current === 0 && !isVowel(at(3)) && at(3) !== 'W' ? 'X' : 'X', 'S');
            current += 3; break;
          }
          if ('IEY'.includes(at(current + 2))) { add('S'); current += 3; break; }
          add('SK'); current += 3; break;
        }
        if (current === last && ['AI','OI'].includes(substr(current - 2, 2))) { add('', 'S'); } else { add('S'); }
        current += (['SZ'].includes(substr(current, 2)) || at(current + 1) === 'S') ? 2 : 1;
        break;
      }

      case 'T': {
        if (substr(current, 4) === 'TION' || ['TIA','TCH'].includes(substr(current, 3))) { add('X'); current += 3; break; }
        if (substr(current, 2) === 'TH' || substr(current, 3) === 'TTH') {
          if (['OM','AM'].includes(substr(current + 2, 2)) || ['VAN ','VON '].includes(substr(0, 4)) || substr(0, 3) === 'SCH') { add('T'); } else { add('0', 'T'); }
          current += 2; break;
        }
        add('T'); current += ('TD'.includes(at(current + 1))) ? 2 : 1;
        break;
      }

      case 'V':
        add('F'); current += (at(current + 1) === 'V') ? 2 : 1;
        break;

      case 'W': {
        if (substr(current, 2) === 'WR') { add('R'); current += 2; break; }
        if (current === 0) {
          if (isVowel(at(1))) { add('A', 'F'); } else if (substr(0, 2) === 'WH') { add('A'); }
        }
        if ((current === last && isVowel(at(current - 1))) || ['EWSKI','EWSKY','OWSKI','OWSKY'].includes(substr(current - 1, 5)) || substr(0, 3) === 'SCH') {
          add('', 'F'); current++; break;
        }
        if (['WICZ','WITZ'].includes(substr(current, 4))) { add('TS', 'FX'); current += 4; break; }
        current++;
        break;
      }

      case 'X':
        if (!(current === last && (['IAU','EAU'].includes(substr(current - 3, 3)) || ['AU','OU'].includes(substr(current - 2, 2))))) { add('KS'); }
        current += ('CX'.includes(at(current + 1))) ? 2 : 1;
        break;

      case 'Z': {
        if (at(current + 1) === 'H') { add('J'); current += 2; break; }
        if (['ZO','ZI','ZA'].includes(substr(current + 1, 2)) || (slavoGermanic && current > 0 && at(current - 1) !== 'T')) {
          add('S', 'TS');
        } else { add('S'); }
        current += (at(current + 1) === 'Z') ? 2 : 1;
        break;
      }

      default:
        current++;
    }
  }

  return [primary.slice(0, MAX), secondary.slice(0, MAX)];
}

/**
 * Check if two words match phonetically via Double Metaphone.
 * Returns true if any primary/alternate code pair matches.
 *
 * @param {[string,string]} codesA — from doubleMetaphone(wordA)
 * @param {[string,string]} codesB — from doubleMetaphone(wordB)
 * @returns {boolean}
 */
function phoneticMatch(codesA, codesB) {
  if (!codesA?.[0] || !codesB?.[0]) return false;
  return codesA[0] === codesB[0]
      || codesA[0] === codesB[1]
      || (codesA[1] && codesA[1] === codesB[0])
      || (codesA[1] && codesB[1] && codesA[1] === codesB[1]);
}

module.exports = {
    levenshteinDistance,
    levenshteinSimilarity,
    doubleMetaphone,
    phoneticMatch,
};

'use strict';

/**
 * ============================================================================
 * STRING DISTANCE UTILITIES
 * Shared Levenshtein distance and similarity functions.
 * ============================================================================
 *
 * Used by:
 * - GlobalHubService (fuzzy name matching against dictionary)
 * - ConversationEngine (spelling variant detection)
 * - Agent2GreetingInterceptor (greeting fuzzy matching)
 * - scenarioGaps (trigger deduplication)
 *
 * Algorithm: Standard dynamic-programming edit distance.
 * Complexity: O(n * m) time, O(n * m) space where n, m are string lengths.
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

module.exports = {
    levenshteinDistance,
    levenshteinSimilarity
};

const stringSimilarity = require('string-similarity');

/**
 * Returns answer if question or keyword matches, else null.
 * Uses exact, substring, and fuzzy matching against questions and keywords.
 *
 * @param {Array} entries - Q&A array for the company
 * @param {String} userQuestion - The incoming speech string
 * @returns {String|null} Matching answer or null
 */
function findCachedAnswer(entries, userQuestion, fuzzyThreshold = 0.5) {
  if (!entries || !Array.isArray(entries) || !userQuestion) return null;
  const qNorm = userQuestion.trim().toLowerCase();

  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ];
    if (questionVariants.some(q => qNorm === q || qNorm.includes(q) || q.includes(qNorm))) {
      return entry.answer;
    }
    const best = stringSimilarity.findBestMatch(qNorm, questionVariants);
    if (best.bestMatch.rating > fuzzyThreshold) {
      return entry.answer;
    }
  }
  return null;
}

module.exports = { findCachedAnswer };

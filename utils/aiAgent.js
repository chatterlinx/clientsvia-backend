const stringSimilarity = require('string-similarity');

/**
 * Returns answer if question or keyword matches, else null.
 * Uses exact, substring, and fuzzy matching against questions and keywords.
 *
 * @param {Array} entries - Q&A array for the company
 * @param {String} userQuestion - The incoming speech string
 * @param {Number} fuzzyThreshold - Similarity threshold (default 0.5)
 * @returns {String|null} Matching answer or null
 */
function findCachedAnswer(entries, userQuestion, fuzzyThreshold = 0.5) {
  if (!entries || !Array.isArray(entries) || !userQuestion) return null;
  const qNorm = userQuestion.trim().toLowerCase();

  // First pass: exact and substring matching
  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ];
    
    // Check for exact matches or substring matches
    if (questionVariants.some(q => q && (qNorm === q || qNorm.includes(q) || q.includes(qNorm)))) {
      return entry.answer;
    }
  }

  // Second pass: fuzzy matching with lower threshold for better matches
  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ].filter(q => q); // Remove empty strings

    if (questionVariants.length === 0) continue;

    const best = stringSimilarity.findBestMatch(qNorm, questionVariants);
    if (best.bestMatch.rating > fuzzyThreshold) {
      return entry.answer;
    }
  }

  // Third pass: word-level matching for better semantic understanding
  const userWords = qNorm.split(/\s+/).filter(w => w.length > 2); // Words longer than 2 chars
  
  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ].filter(q => q);

    for (const variant of questionVariants) {
      const variantWords = variant.split(/\s+/).filter(w => w.length > 2);
      
      // Check if significant portion of user words match variant words
      const matches = userWords.filter(userWord => 
        variantWords.some(variantWord => 
          userWord.includes(variantWord) || variantWord.includes(userWord) ||
          stringSimilarity.compareTwoStrings(userWord, variantWord) > 0.6
        )
      );
      
      // If more than 50% of user words match, consider it a match
      if (matches.length > 0 && matches.length / userWords.length >= 0.5) {
        return entry.answer;
      }
    }
  }

  return null;
}

module.exports = { findCachedAnswer };

const stringSimilarity = require('string-similarity');

/**
 * Returns answer if question or keyword matches, else null.
 * Uses exact, contextual, and fuzzy matching against questions and keywords.
 * Prevents false positives by requiring multiple word overlap or high similarity.
 *
 * @param {Array} entries - Q&A array for the company
 * @param {String} userQuestion - The incoming speech string
 * @param {Number} fuzzyThreshold - Similarity threshold (default 0.6)
 * @returns {String|null} Matching answer or null
 */
function findCachedAnswer(entries, userQuestion, fuzzyThreshold = 0.6) {
  if (!entries || !Array.isArray(entries) || !userQuestion) return null;
  
  const qNorm = userQuestion.trim().toLowerCase();
  const userWords = qNorm.split(/\s+/).filter(w => w.length > 2); // Words longer than 2 chars
  
  console.log(`🔍 [Q&A MATCHING] Input: "${userQuestion}" | Normalized: "${qNorm}"`);
  console.log(`📊 [Q&A MATCHING] Entries: ${entries.length} | User words: [${userWords.join(', ')}] | Threshold: ${fuzzyThreshold}`);

  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ].filter(q => q); // Remove empty strings
    
    console.log(`🎯 [Q&A CHECK] Entry: "${entry.question}" | Variants: [${questionVariants.join(', ')}]`);
    
    for (const variant of questionVariants) {
      // 1. Exact match - highest priority
      if (variant === qNorm) {
        console.log(`✅ [Q&A EXACT] Perfect match: "${entry.question}"`);
        return entry.answer;
      }
      
      // 2. High-confidence fuzzy match
      const similarity = stringSimilarity.compareTwoStrings(qNorm, variant);
      if (similarity > fuzzyThreshold) {
        console.log(`✅ [Q&A FUZZY] High similarity match: "${entry.question}" | Score: ${similarity.toFixed(3)}`);
        return entry.answer;
      }
      
      // 3. Contextual word matching (prevents false positives)
      const variantWords = variant.split(/\s+/).filter(w => w.length > 2);
      
      if (userWords.length === 0 || variantWords.length === 0) continue;
      
      // Find words that match exactly or with high similarity
      const matchingWords = userWords.filter(userWord => 
        variantWords.some(variantWord => {
          if (userWord === variantWord) return true;
          
          // For longer words, allow substring matching
          if (userWord.length > 4 && variantWord.length > 4) {
            if (userWord.includes(variantWord) || variantWord.includes(userWord)) return true;
          }
          
          // High word-level similarity for near-matches
          return stringSimilarity.compareTwoStrings(userWord, variantWord) > 0.7;
        })
      );
      
      // Require either:
      // - At least 2 matching words AND 50% coverage of user input
      // - At least 80% word coverage for shorter phrases
      const matchRatio = matchingWords.length / userWords.length;
      const minWords = userWords.length >= 4 ? 2 : 1;
      const minRatio = userWords.length >= 4 ? 0.5 : 0.8;
      
      if (matchingWords.length >= minWords && matchRatio >= minRatio) {
        console.log(`✅ [Q&A CONTEXTUAL] Word-based match: "${entry.question}" | Words: ${matchingWords.length}/${userWords.length} (${(matchRatio * 100).toFixed(1)}%) | Matched: [${matchingWords.join(', ')}]`);
        return entry.answer;
      } else if (matchingWords.length > 0) {
        console.log(`⚠️ [Q&A PARTIAL] Insufficient match: "${entry.question}" | Words: ${matchingWords.length}/${userWords.length} (${(matchRatio * 100).toFixed(1)}%) | Matched: [${matchingWords.join(', ')}]`);
      }
    }
  }

  console.log(`❌ [Q&A NO MATCH] No suitable Q&A match found for: "${userQuestion}"`);
  return null;
}

module.exports = { findCachedAnswer };

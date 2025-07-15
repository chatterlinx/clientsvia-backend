const stringSimilarity = require('string-similarity');

/**
 * Returns answer if question or keyword matches, else null.
 * Uses exact, contextual, and fuzzy matching against questions and keywords.
 * Prevents false positives by requiring multiple word overlap or high similarity.
 * Added negative context detection to avoid matching when customers are correcting/rejecting.
 *
 * @param {Array} entries - Q&A array for the company
 * @param {String} userQuestion - The incoming speech string
 * @param {Number} fuzzyThreshold - Similarity threshold (default 0.25)
 * @returns {String|null} Matching answer or null
 */
function findCachedAnswer(entries, userQuestion, fuzzyThreshold = 0.25) {
  if (!entries || !Array.isArray(entries) || !userQuestion) return null;
  
  const qNorm = userQuestion.trim().toLowerCase();
  const userWords = qNorm.split(/\s+/).filter(w => w.length > 2); // Words longer than 2 chars
  
  console.log(`🔍 [Q&A MATCHING] Input: "${userQuestion}" | Normalized: "${qNorm}"`);
  console.log(`📊 [Q&A MATCHING] Entries: ${entries.length} | User words: [${userWords.join(', ')}] | Threshold: ${fuzzyThreshold}`);

  // NEGATIVE CONTEXT DETECTION - Don't match if customer is correcting/rejecting
  const negativePatterns = [
    /\b(no|not|didn't|don't|doesn't|isn't|wasn't|never)\s+(?:say|said|want|need|looking|talking|asking)\b/i,
    /\bi\s+(didn't|don't|wasn't|never)\s+(say|said|want|need|ask|mean)\b/i,
    /\b(that's not|that isn't|not what|didn't say|don't want|not looking|not asking)\b/i,
    /\b(i said|i'm saying|i mean|actually|correction|no,?\s*i)\b/i
  ];
  
  const hasNegativeContext = negativePatterns.some(pattern => pattern.test(qNorm));
  if (hasNegativeContext) {
    console.log(`🚫 [Q&A NEGATIVE] Detected correction/rejection context - using stricter matching`);
    
    // Extract rejected terms more comprehensively
    const rejectedTerms = extractRejectedTerms(qNorm);
    console.log(`🚫 [Q&A REJECTED TERMS] Identified rejected terms: [${rejectedTerms.join(', ')}]`);
  }

  // Extract what the customer actually wants (after correction phrases)
  let actualRequest = qNorm;
  const correctionPatterns = [
    /\bi said,?\s*(.+)$/i,
    /\bi mean,?\s*(.+)$/i,
    /\bactually,?\s*(.+)$/i,
    /\bno,?\s*(.+)$/i,
    /\bnot .+?\. (.+)$/i // "I didn't say maintenance. I said blank thermostat"
  ];
  
  for (const pattern of correctionPatterns) {
    const match = qNorm.match(pattern);
    if (match) {
      actualRequest = match[1].trim();
      console.log(`✂️ [Q&A CORRECTION] Extracted actual request: "${actualRequest}"`);
      break;
    }
  }

  for (const entry of entries) {
    const questionVariants = [
      (entry.question || '').trim().toLowerCase(),
      ...(Array.isArray(entry.keywords)
        ? entry.keywords.map(k => k.trim().toLowerCase())
        : [])
    ].filter(q => q); // Remove empty strings
    
    console.log(`🎯 [Q&A CHECK] Entry: "${entry.question}" | Variants: [${questionVariants.join(', ')}]`);
    
    for (const variant of questionVariants) {
      // 1. Exact match - highest priority (but check both original and corrected request)
      if (variant === qNorm || variant === actualRequest) {
        console.log(`✅ [Q&A EXACT] Perfect match: "${entry.question}"`);
        return entry.answer;
      }
      
      // 2. High-confidence fuzzy match
      // For negative context, use the corrected request and require higher similarity
      const testString = hasNegativeContext ? actualRequest : qNorm;
      const requiredSimilarity = hasNegativeContext ? Math.max(fuzzyThreshold, 0.4) : fuzzyThreshold;
      
      const similarity = stringSimilarity.compareTwoStrings(testString, variant);
      if (similarity > requiredSimilarity) {
        // Additional check for negative context - make sure the variant doesn't match the rejected term
        if (hasNegativeContext) {
          const rejectedTerms = extractRejectedTerms(qNorm);
          const variantContainsRejected = rejectedTerms.some(term => variant.includes(term));
          if (variantContainsRejected) {
            console.log(`🚫 [Q&A REJECTED] Skipping "${entry.question}" - contains rejected term: [${rejectedTerms.join(', ')}]`);
            continue;
          }
        }
        
        console.log(`✅ [Q&A FUZZY] High similarity match: "${entry.question}" | Score: ${similarity.toFixed(3)}`);
        return entry.answer;
      }
      
      // 3. Contextual word matching (prevents false positives)
      const variantWords = variant.split(/\s+/).filter(w => w.length > 2);
      const requestWords = (hasNegativeContext ? actualRequest : qNorm).split(/\s+/).filter(w => w.length > 2);
      
      if (requestWords.length === 0 || variantWords.length === 0) continue;
      
      // For negative context, also check that we're not matching rejected terms
      if (hasNegativeContext) {
        const rejectedTerms = extractRejectedTerms(qNorm);
        const variantContainsRejected = rejectedTerms.some(term => variant.includes(term));
        if (variantContainsRejected) {
          console.log(`🚫 [Q&A REJECTED] Skipping "${entry.question}" - contains rejected term: [${rejectedTerms.join(', ')}]`);
          continue;
        }
      }
      
      // Find words that match exactly or with high similarity
      const matchingWords = requestWords.filter(userWord => 
        variantWords.some(variantWord => {
          if (userWord === variantWord) return true;
          
          // Handle common word variations (leaking/leakage, heating/heat, etc.)
          const userRoot = userWord.replace(/(ing|age|ed|er|ly)$/i, '');
          const variantRoot = variantWord.replace(/(ing|age|ed|er|ly)$/i, '');
          if (userRoot.length > 3 && variantRoot.length > 3 && userRoot === variantRoot) return true;
          
          // Special handling for thermostat-related keywords
          const thermostatKeywords = ['thermostat', 'blank', 'display', 'screen', 'dead', 'frozen', 'reset'];
          if (thermostatKeywords.includes(userWord) && thermostatKeywords.includes(variantWord)) return true;
          
          // Special handling for water-related keywords
          const waterKeywords = ['water', 'leak', 'leaking', 'leakage', 'drip', 'dripping', 'wet', 'moisture'];
          if (waterKeywords.includes(userWord) && waterKeywords.includes(variantWord)) return true;
          
          // Special handling for HVAC-related keywords  
          const hvacKeywords = ['ac', 'air', 'conditioning', 'heat', 'heating', 'cool', 'cooling', 'repair', 'broken', 'fix'];
          if (hvacKeywords.includes(userWord) && hvacKeywords.includes(variantWord)) return true;
          
          // For longer words, allow substring matching
          if (userWord.length > 4 && variantWord.length > 4) {
            if (userWord.includes(variantWord) || variantWord.includes(userWord)) return true;
          }
          
          // High word-level similarity for near-matches (lowered threshold for better matching)
          return stringSimilarity.compareTwoStrings(userWord, variantWord) > 0.6;
        })
      );
      
      // Require either:
      // - At least 1 matching word for short phrases (more lenient)
      // - At least 2 matching words for longer phrases, BUT more lenient for water/HVAC issues
      // - Minimum word coverage based on context
      const matchRatio = matchingWords.length / requestWords.length;
      
      // Check if this is a specific issue type (more lenient matching)
      const isWaterIssue = requestWords.some(word => ['water', 'leak', 'leaking', 'leakage', 'drip', 'wet'].includes(word));
      const isHVACIssue = requestWords.some(word => ['ac', 'air', 'conditioning', 'heat', 'cool', 'repair'].includes(word));
      const isThermostatIssue = requestWords.some(word => ['thermostat', 'blank', 'display', 'screen'].includes(word));
      
      let minWords, minRatio;
      if (isWaterIssue || isHVACIssue || isThermostatIssue) {
        // More lenient for specific technical issues
        minWords = requestWords.length >= 8 ? 2 : 1;
        minRatio = hasNegativeContext ? 0.4 : 0.3; // Slightly higher for negative context
      } else {
        // Standard matching - stricter for negative context
        minWords = requestWords.length >= 6 ? 2 : 1;
        minRatio = hasNegativeContext ? 0.6 : 0.4;
      }
      
      if (matchingWords.length >= minWords && matchRatio >= minRatio) {
        console.log(`✅ [Q&A CONTEXTUAL] Word-based match: "${entry.question}" | Words: ${matchingWords.length}/${requestWords.length} (${(matchRatio * 100).toFixed(1)}%) | Matched: [${matchingWords.join(', ')}]`);
        return entry.answer;
      } else if (matchingWords.length > 0) {
        console.log(`⚠️ [Q&A PARTIAL] Insufficient match: "${entry.question}" | Words: ${matchingWords.length}/${requestWords.length} (${(matchRatio * 100).toFixed(1)}%) | Matched: [${matchingWords.join(', ')}]`);
      }
    }
  }

  console.log(`❌ [Q&A NO MATCH] No suitable Q&A match found for: "${userQuestion}"`);
  return null;
}

/**
 * Extract terms that the customer is rejecting/correcting
 */
function extractRejectedTerms(text) {
  const rejectedTerms = [];
  
  // Pattern: "I didn't say X" or "not X"
  const patterns = [
    /\b(?:didn't|don't|not)\s+say\s+(\w+)/gi,
    /\b(?:not|no)\s+(\w+)/gi,
    /\b(?:wasn't|isn't)\s+(\w+)/gi
  ];
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      rejectedTerms.push(match[1].toLowerCase());
    }
  });
  
  return rejectedTerms;
}

module.exports = { findCachedAnswer };

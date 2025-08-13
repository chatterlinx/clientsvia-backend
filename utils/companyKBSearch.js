// utils/companyKBSearch.js
/**
 * Optimized search for Company Knowledge Base using auto-generated keywords
 * This enables the AI agent to find relevant answers much faster
 */

/**
 * Search Company KB entries using keyword matching
 * @param {Array} companyKB - Array of company Q&A entries
 * @param {string} userQuery - User's question/query
 * @param {Object} options - Search options
 * @returns {Array} Ranked search results
 */
function searchCompanyKB(companyKB, userQuery, options = {}) {
    const {
        maxResults = 5,
        minConfidence = 0.3,
        includeInactive = false,
        intentFilter = null
    } = options;

    if (!companyKB || companyKB.length === 0) {
        return [];
    }

    const queryWords = normalizeQuery(userQuery);
    const results = [];

    // Score each Q&A entry
    companyKB.forEach(qa => {
        // Skip inactive entries unless specified
        if (!includeInactive && !qa.isActive) return;
        
        // Filter by intent if specified
        if (intentFilter && qa.intent !== intentFilter) return;
        
        // Check if entry is still valid
        if (qa.validThrough && new Date(qa.validThrough) < new Date()) return;

        const score = calculateRelevanceScore(qa, queryWords, userQuery);
        
        if (score >= minConfidence) {
            results.push({
                ...qa,
                relevanceScore: score,
                matchType: getMatchType(qa, queryWords, userQuery)
            });
        }
    });

    // Sort by relevance score (highest first)
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Limit results
    return results.slice(0, maxResults);
}

/**
 * Calculate relevance score for a Q&A entry
 * @param {Object} qa - Q&A entry
 * @param {Array} queryWords - Normalized query words
 * @param {string} originalQuery - Original user query
 * @returns {number} Relevance score (0-1)
 */
function calculateRelevanceScore(qa, queryWords, originalQuery) {
    let score = 0;
    const weights = {
        exactQuestionMatch: 0.9,
        keywordMatch: 0.6,
        questionSimilarity: 0.4,
        answerMatch: 0.2,
        intentMatch: 0.3,
        negativeKeywordPenalty: -0.8
    };

    // Check for negative keywords first (early exit if found)
    if (qa.negativeKeywords && qa.negativeKeywords.length > 0) {
        const hasNegativeMatch = qa.negativeKeywords.some(negKeyword => 
            originalQuery.toLowerCase().includes(negKeyword.toLowerCase())
        );
        if (hasNegativeMatch) {
            return 0; // Exclude this result
        }
    }

    // Exact or near-exact question match
    const questionSimilarity = calculateTextSimilarity(originalQuery, qa.question);
    if (questionSimilarity > 0.8) {
        score += weights.exactQuestionMatch * questionSimilarity;
    } else {
        score += weights.questionSimilarity * questionSimilarity;
    }

    // Keyword matching
    if (qa.keywords && qa.keywords.length > 0) {
        const keywordMatches = qa.keywords.filter(keyword => 
            queryWords.some(queryWord => 
                queryWord.includes(keyword.toLowerCase()) || 
                keyword.toLowerCase().includes(queryWord)
            )
        );
        
        const keywordScore = keywordMatches.length / qa.keywords.length;
        score += weights.keywordMatch * keywordScore;
        
        // Boost for multiple keyword matches
        if (keywordMatches.length > 2) {
            score += 0.1;
        }
    }

    // Answer content matching (for comprehensive answers)
    const answerSimilarity = calculateTextSimilarity(originalQuery, qa.answer);
    score += weights.answerMatch * answerSimilarity;

    // Intent-based boosting
    const inferredIntent = inferIntentFromQuery(originalQuery);
    if (qa.intent === inferredIntent) {
        score += weights.intentMatch;
    }

    // Usage statistics boost (popular answers)
    if (qa.metadata && qa.metadata.usage) {
        const usageBoost = Math.min(qa.metadata.usage.timesMatched / 100, 0.1);
        score += usageBoost;
    }

    return Math.min(score, 1.0);
}

/**
 * Calculate text similarity between two strings
 * @param {string} text1 
 * @param {string} text2 
 * @returns {number} Similarity score (0-1)
 */
function calculateTextSimilarity(text1, text2) {
    const words1 = normalizeQuery(text1);
    const words2 = normalizeQuery(text2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const commonWords = words1.filter(word => words2.includes(word));
    const jaccard = commonWords.length / (words1.length + words2.length - commonWords.length);
    
    return jaccard;
}

/**
 * Normalize query into searchable words
 * @param {string} query 
 * @returns {Array} Normalized words
 */
function normalizeQuery(query) {
    if (!query) return [];
    
    return query
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2)
        .filter(word => !isStopWord(word));
}

/**
 * Check if word is a stop word
 * @param {string} word 
 * @returns {boolean}
 */
function isStopWord(word) {
    const stopWords = new Set([
        'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
        'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
        'to', 'was', 'were', 'will', 'with', 'would', 'could', 'should',
        'do', 'does', 'did', 'can', 'what', 'when', 'where', 'why', 'how'
    ]);
    return stopWords.has(word.toLowerCase());
}

/**
 * Infer intent from user query
 * @param {string} query 
 * @returns {string} Inferred intent
 */
function inferIntentFromQuery(query) {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('price') || lowerQuery.includes('cost') || lowerQuery.includes('charge')) {
        return 'pricing';
    }
    
    if (lowerQuery.includes('hour') || lowerQuery.includes('open') || lowerQuery.includes('close')) {
        return 'hours_availability';
    }
    
    if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent')) {
        return 'emergency';
    }
    
    if (lowerQuery.includes('where') || lowerQuery.includes('location') || lowerQuery.includes('address')) {
        return 'location';
    }
    
    if (lowerQuery.includes('contact') || lowerQuery.includes('phone') || lowerQuery.includes('call')) {
        return 'contact';
    }
    
    return 'general';
}

/**
 * Determine the type of match found
 * @param {Object} qa 
 * @param {Array} queryWords 
 * @param {string} originalQuery 
 * @returns {string} Match type
 */
function getMatchType(qa, queryWords, originalQuery) {
    const questionSimilarity = calculateTextSimilarity(originalQuery, qa.question);
    
    if (questionSimilarity > 0.8) {
        return 'exact_match';
    }
    
    if (qa.keywords && qa.keywords.some(keyword => 
        queryWords.some(queryWord => queryWord === keyword.toLowerCase())
    )) {
        return 'keyword_match';
    }
    
    if (questionSimilarity > 0.5) {
        return 'similar_question';
    }
    
    return 'partial_match';
}

/**
 * Update usage statistics for a Q&A entry
 * @param {Object} qa - Q&A entry to update
 * @param {number} confidence - Confidence score of the match
 */
function updateUsageStats(qa, confidence) {
    if (!qa.metadata) qa.metadata = {};
    if (!qa.metadata.usage) qa.metadata.usage = {
        timesMatched: 0,
        lastMatched: null,
        averageConfidence: 0
    };
    
    const usage = qa.metadata.usage;
    usage.timesMatched += 1;
    usage.lastMatched = new Date();
    
    // Update rolling average confidence
    usage.averageConfidence = (usage.averageConfidence * (usage.timesMatched - 1) + confidence) / usage.timesMatched;
}

module.exports = {
    searchCompanyKB,
    calculateRelevanceScore,
    updateUsageStats,
    normalizeQuery,
    inferIntentFromQuery
};

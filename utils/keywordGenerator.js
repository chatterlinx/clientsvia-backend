// utils/keywordGenerator.js
/**
 * Auto-generate keywords for Company Knowledge Base Q&A entries
 * This helps the AI agent quickly find relevant answers
 */

// Common stop words to exclude from keywords
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'would', 'could', 'should',
    'do', 'does', 'did', 'can', 'what', 'when', 'where', 'why', 'how',
    'i', 'you', 'we', 'they', 'my', 'your', 'our', 'their'
]);

// Business-specific keyword mappings for better matching
const BUSINESS_SYNONYMS = {
    'hours': ['schedule', 'time', 'open', 'closed', 'availability'],
    'price': ['cost', 'fee', 'rate', 'pricing', 'charge', 'payment'],
    'service': ['work', 'job', 'task', 'offering', 'solution'],
    'contact': ['reach', 'call', 'email', 'phone', 'communication'],
    'location': ['address', 'place', 'where', 'site', 'office'],
    'policy': ['rule', 'guideline', 'procedure', 'terms', 'conditions'],
    'appointment': ['booking', 'schedule', 'meeting', 'reservation'],
    'emergency': ['urgent', 'immediate', 'rush', 'asap', 'critical'],
    'warranty': ['guarantee', 'coverage', 'protection', 'assurance'],
    'payment': ['billing', 'invoice', 'cost', 'fee', 'charge']
};

/**
 * Extract keywords from question and answer text
 * @param {string} question - The Q&A question
 * @param {string} answer - The Q&A answer
 * @param {string[]} existingKeywords - Any manually provided keywords
 * @returns {Object} Generated keywords and suggestions
 */
function generateKeywords(question, answer, existingKeywords = []) {
    const allText = `${question} ${answer}`.toLowerCase();
    
    // Extract base keywords from text
    const words = allText
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .split(/\s+/)
        .filter(word => word.length > 2 && !STOP_WORDS.has(word))
        .filter((word, index, arr) => arr.indexOf(word) === index); // Remove duplicates
    
    // Generate synonyms and related terms
    const expandedKeywords = new Set([...existingKeywords]);
    
    words.forEach(word => {
        expandedKeywords.add(word);
        
        // Add synonyms if available
        if (BUSINESS_SYNONYMS[word]) {
            BUSINESS_SYNONYMS[word].forEach(synonym => expandedKeywords.add(synonym));
        }
        
        // Add partial matches for compound words
        if (word.length > 6) {
            const parts = word.match(/.{3,}/g);
            if (parts) {
                parts.forEach(part => {
                    if (part.length >= 3) expandedKeywords.add(part);
                });
            }
        }
    });
    
    // Convert to array and sort by relevance
    const keywordArray = Array.from(expandedKeywords)
        .filter(keyword => keyword.length >= 2)
        .sort((a, b) => {
            // Prioritize keywords that appear in question (higher relevance)
            const aInQuestion = question.toLowerCase().includes(a);
            const bInQuestion = question.toLowerCase().includes(b);
            
            if (aInQuestion && !bInQuestion) return -1;
            if (!aInQuestion && bInQuestion) return 1;
            
            // Then by length (longer keywords often more specific)
            return b.length - a.length;
        })
        .slice(0, 15); // Limit to top 15 keywords
    
    // Generate negative keywords (common false positives)
    const negativeKeywords = generateNegativeKeywords(question, answer);
    
    return {
        keywords: keywordArray,
        suggestedNegativeKeywords: negativeKeywords,
        confidence: calculateConfidence(question, answer, keywordArray)
    };
}

/**
 * Generate negative keywords to prevent false matches
 * @param {string} question 
 * @param {string} answer 
 * @returns {string[]} Suggested negative keywords
 */
function generateNegativeKeywords(question, answer) {
    const negativeKeywords = [];
    const text = `${question} ${answer}`.toLowerCase();
    
    // If it's specifically about one service, exclude others
    const services = ['plumbing', 'electrical', 'hvac', 'roofing', 'painting'];
    const mentionedServices = services.filter(service => text.includes(service));
    
    if (mentionedServices.length === 1) {
        services.forEach(service => {
            if (!mentionedServices.includes(service)) {
                negativeKeywords.push(service);
            }
        });
    }
    
    // Exclude opposite contexts
    if (text.includes('emergency')) {
        negativeKeywords.push('scheduled', 'routine', 'regular');
    }
    
    if (text.includes('weekday') || text.includes('monday') || text.includes('business hours')) {
        negativeKeywords.push('weekend', 'saturday', 'sunday');
    }
    
    return negativeKeywords;
}

/**
 * Calculate confidence score for keyword generation
 * @param {string} question 
 * @param {string} answer 
 * @param {string[]} keywords 
 * @returns {number} Confidence score 0-1
 */
function calculateConfidence(question, answer, keywords) {
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for longer, more detailed content
    if (question.length > 20) confidence += 0.1;
    if (answer.length > 50) confidence += 0.1;
    
    // Higher confidence if keywords cover main concepts
    if (keywords.length >= 5) confidence += 0.1;
    if (keywords.length >= 10) confidence += 0.1;
    
    // Check if keywords represent the content well
    const questionWords = question.toLowerCase().split(/\s+/);
    const keywordMatches = questionWords.filter(word => 
        keywords.some(keyword => keyword.includes(word) || word.includes(keyword))
    );
    
    confidence += (keywordMatches.length / questionWords.length) * 0.2;
    
    return Math.min(confidence, 1.0);
}

/**
 * Generate intent classification suggestions
 * @param {string} question 
 * @param {string} answer 
 * @returns {string} Suggested intent
 */
function suggestIntent(question, answer) {
    const text = `${question} ${answer}`.toLowerCase();
    
    // Intent classification based on content
    if (text.includes('price') || text.includes('cost') || text.includes('fee')) {
        return 'pricing';
    }
    
    if (text.includes('hour') || text.includes('schedule') || text.includes('time')) {
        return 'hours_availability';
    }
    
    if (text.includes('emergency') || text.includes('urgent')) {
        return 'emergency';
    }
    
    if (text.includes('location') || text.includes('address') || text.includes('where')) {
        return 'location';
    }
    
    if (text.includes('contact') || text.includes('phone') || text.includes('email')) {
        return 'contact';
    }
    
    if (text.includes('service') || text.includes('what') || text.includes('do')) {
        return 'services';
    }
    
    if (text.includes('policy') || text.includes('terms') || text.includes('condition')) {
        return 'policy';
    }
    
    return 'general';
}

module.exports = {
    generateKeywords,
    suggestIntent,
    BUSINESS_SYNONYMS
};

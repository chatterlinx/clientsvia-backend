/**
 * ============================================================================
 * QUICK ANSWERS MATCHER - Runtime Service
 * ============================================================================
 * 
 * FRESH IMPLEMENTATION - NO LEGACY CONNECTION
 * 
 * Matches caller input against configured Quick Answers.
 * Used by the AI brain to instantly respond to common questions.
 * 
 * USAGE:
 *   const match = await QuickAnswersMatcher.findBestMatch(companyId, userInput);
 *   if (match) {
 *       // Use match.answer as the response
 *   }
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const v2Company = require('../models/v2Company');

// Redis for caching
let redis;
try {
    redis = require('../config/redis');
} catch (e) {
    logger.warn('[QUICK ANSWERS] Redis not available, caching disabled');
}

// Cache TTL (5 minutes)
const CACHE_TTL = 300;

class QuickAnswersMatcher {
    
    /**
     * Get Quick Answers for a company (with caching)
     */
    static async getQuickAnswers(companyId) {
        const cacheKey = `qa:${companyId}`;
        
        // Try cache first
        try {
            if (redis?.client) {
                const cached = await redis.client.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            }
        } catch (e) {
            // Cache miss or error, continue to DB
        }
        
        // Fetch from DB
        try {
            const company = await v2Company.findById(companyId)
                .select('aiAgentSettings.callFlowEngine.quickAnswers')
                .lean();
            
            const answers = company?.aiAgentSettings?.callFlowEngine?.quickAnswers || [];
            
            // Cache for next time
            try {
                if (redis?.client && answers.length > 0) {
                    await redis.client.setex(cacheKey, CACHE_TTL, JSON.stringify(answers));
                }
            } catch (e) {
                // Cache write failed, non-critical
            }
            
            return answers;
            
        } catch (error) {
            logger.error('[QUICK ANSWERS] Failed to fetch from DB:', error.message);
            return [];
        }
    }
    
    /**
     * Find the best matching Quick Answer for user input
     * 
     * @param {string} companyId - Company ID
     * @param {string} userInput - What the caller said
     * @returns {object|null} - Best matching answer or null
     */
    static async findBestMatch(companyId, userInput) {
        if (!userInput || typeof userInput !== 'string') {
            return null;
        }
        
        const answers = await this.getQuickAnswers(companyId);
        if (!answers || answers.length === 0) {
            return null;
        }
        
        const lowerInput = userInput.toLowerCase();
        
        // Score each answer
        const scored = answers
            .filter(qa => qa.enabled !== false)
            .map(qa => {
                const triggers = qa.triggers || [];
                const matchedTriggers = triggers.filter(trigger => 
                    lowerInput.includes(trigger.toLowerCase())
                );
                
                // Calculate score based on:
                // - Number of matched triggers
                // - Priority setting
                // - Length of matched triggers (longer = more specific = better)
                let score = matchedTriggers.length * 10;
                score += (qa.priority || 0) * 5;
                score += matchedTriggers.reduce((sum, t) => sum + t.length, 0);
                
                return {
                    ...qa,
                    matchedTriggers,
                    score
                };
            })
            .filter(qa => qa.matchedTriggers.length > 0)
            .sort((a, b) => b.score - a.score);
        
        if (scored.length === 0) {
            return null;
        }
        
        const best = scored[0];
        
        logger.info('[QUICK ANSWERS] Match found', {
            companyId,
            input: userInput.substring(0, 50),
            matchedQuestion: best.question,
            matchedTriggers: best.matchedTriggers,
            score: best.score
        });
        
        return {
            id: best.id,
            question: best.question,
            answer: best.answer,
            category: best.category,
            matchedTriggers: best.matchedTriggers,
            score: best.score
        };
    }
    
    /**
     * Check if input is likely a common question (quick scan)
     * 
     * @param {string} userInput - What the caller said
     * @returns {boolean} - True if likely a question
     */
    static looksLikeQuestion(userInput) {
        if (!userInput) return false;
        
        const lower = userInput.toLowerCase();
        
        // Question starters
        const questionWords = ['what', 'when', 'where', 'how', 'do you', 'can you', 'are you', 'is there', 'will you'];
        if (questionWords.some(q => lower.startsWith(q) || lower.includes(' ' + q))) {
            return true;
        }
        
        // Common question patterns
        const questionPatterns = [
            /\bhours?\b/,
            /\bpric(e|ing)\b/,
            /\bcost\b/,
            /\bopen\b/,
            /\bservice (area|my area)\b/,
            /\bwarranty\b/,
            /\bguarantee\b/,
            /\bpay(ment)?\b/,
            /\baccept\b/,
            /\bemergency\b/,
            /\b24.?7\b/
        ];
        
        return questionPatterns.some(p => p.test(lower));
    }
    
    /**
     * Invalidate cache for a company
     */
    static async invalidateCache(companyId) {
        try {
            if (redis?.client) {
                await redis.client.del(`qa:${companyId}`);
                logger.info('[QUICK ANSWERS] Cache invalidated', { companyId });
            }
        } catch (e) {
            // Non-critical
        }
    }
}

module.exports = QuickAnswersMatcher;


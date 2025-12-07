/**
 * STTHintsBuilder.js - Build Twilio <Gather> hints from STT Profile
 * 
 * Builds optimized hint strings for Twilio speech recognition
 * using vocabulary from STTProfile (keywords, technician names, etc.)
 * 
 * @module services/STTHintsBuilder
 * @version 1.0.0
 */

const logger = require('../utils/logger');

// Cache for loaded hints (avoid DB hit on every gather)
const hintsCache = new Map();
const CACHE_TTL = 60000; // 1 minute

class STTHintsBuilder {
    
    /**
     * Build hints string for Twilio <Gather>
     * @param {ObjectId} templateId - Template ID
     * @param {Object} company - Company object (for trade/services fallback)
     * @returns {Promise<string>} Comma-separated hints (max 1000 chars)
     */
    static async buildHints(templateId, company = null) {
        try {
            // Check cache first
            const cacheKey = templateId?.toString() || 'default';
            const cached = hintsCache.get(cacheKey);
            
            if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
                return cached.hints;
            }
            
            // Try to load from STT Profile
            let hints = [];
            
            if (templateId) {
                const STTProfile = require('../models/STTProfile');
                const profile = await STTProfile.findOne({ 
                    templateId, 
                    isActive: true 
                }).lean();
                
                if (profile && profile.provider?.useHints !== false) {
                    // Get boosted keywords sorted by weight
                    const keywords = (profile.vocabulary?.boostedKeywords || [])
                        .filter(k => k.enabled)
                        .sort((a, b) => (b.boostWeight || 5) - (a.boostWeight || 5))
                        .map(k => k.phrase);
                    
                    hints = keywords;
                    
                    logger.debug('[STT HINTS] Loaded from profile', {
                        templateId,
                        keywordCount: hints.length
                    });
                }
            }
            
            // Fallback: Build from company trade/services if no profile
            if (hints.length === 0 && company) {
                const tradeHints = company.trade ? [company.trade.toLowerCase()] : [];
                const serviceHints = (company.aiAgentSettings?.serviceTypes || [])
                    .map(s => s.toLowerCase())
                    .filter(Boolean)
                    .slice(0, 10);
                    
                hints = [...tradeHints, ...serviceHints];
            }
            
            // Add universal defaults
            const defaultHints = [
                'appointment', 'schedule', 'emergency', 'help', 'question',
                'service', 'repair', 'maintenance', 'problem', 'issue'
            ];
            
            // Merge and deduplicate
            const allHints = [...new Set([...hints, ...defaultHints])];
            
            // Build string with Twilio limit (1000 chars)
            let hintsString = '';
            for (const hint of allHints) {
                const next = hintsString ? hintsString + ', ' + hint : hint;
                if (next.length > 1000) break;
                hintsString = next;
            }
            
            // Cache the result
            hintsCache.set(cacheKey, {
                hints: hintsString,
                loadedAt: Date.now()
            });
            
            return hintsString;
            
        } catch (error) {
            logger.debug('[STT HINTS] Build failed, using defaults', { 
                error: error.message 
            });
            
            // Return safe defaults on error
            return 'appointment, schedule, emergency, help, question, service, repair';
        }
    }
    
    /**
     * Clear cached hints (call when profile is updated)
     * @param {ObjectId} templateId - Template ID
     */
    static clearCache(templateId) {
        if (templateId) {
            hintsCache.delete(templateId.toString());
        } else {
            hintsCache.clear();
        }
    }
    
    /**
     * Get default filler words to help STT recognize common speech patterns
     * @returns {string} Comma-separated filler words
     */
    static getFillerHints() {
        return 'um, uh, like, you know, so, well, I mean, basically, actually';
    }
}

module.exports = STTHintsBuilder;

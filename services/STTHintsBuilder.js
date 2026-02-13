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
            
            // ═══════════════════════════════════════════════════════════════════
            // GLOBAL FIRST NAMES FOR STT ACCURACY
            // ═══════════════════════════════════════════════════════════════════
            // Names are read from global AdminSettings via AWConfigReader cache.
            // 10,000 SSA names (96.7% US population coverage).
            // 
            // Without these in STT hints, Twilio mishears:
            // - "Dustin" → "question"
            // - "Mark" → "bark"
            //
            // Twilio limit is 1000 chars, so we take the first ~150 names
            // (average 6 chars + comma = ~7 chars per name = ~150 names max)
            // ═══════════════════════════════════════════════════════════════════
            const AWConfigReader = require('./wiring/AWConfigReader');
            const commonFirstNames = AWConfigReader.getGlobalFirstNames();
            
            // Take first 150 names (Twilio has 1000 char limit for hints)
            const commonNames = commonFirstNames.slice(0, 150);
            
            logger.debug('[STT HINTS] Loaded global first names for STT accuracy', {
                totalGlobal: commonFirstNames.length,
                usedForHints: commonNames.length,
                sample: commonNames.slice(0, 10).join(', ')
            });
            
            // 🏠 Add address-related hints for booking flow
            // These help STT recognize street addresses, numbers, and common words
            const addressHints = [
                // Street types
                'street', 'avenue', 'road', 'lane', 'drive', 'court', 'circle',
                'boulevard', 'parkway', 'way', 'place', 'terrace', 'highway',
                // Common address words
                'north', 'south', 'east', 'west', 'suite', 'unit', 'apartment',
                'building', 'floor', 'number',
                // Numbers (critical for addresses and phone numbers)
                'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'zero',
                'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
                'twenty', 'thirty', 'forty', 'fifty', 'hundred', 'thousand',
                // Number patterns
                'one two', 'one five', 'two three', 'five five',
                // Phone patterns
                'area code', 'phone number', 'cell', 'mobile',
                '239', '305', '786', '954', '561', '407', '813', '727', // FL area codes
                // Time hints
                'morning', 'afternoon', 'tomorrow', 'today', 'asap', 'as soon as possible',
                // Names (common)
                'my name is', 'this is', 'speaking',
                // Service types (for clarification)
                'repair', 'maintenance', 'tune up', 'fix', 'broken', 'not working'
            ];
            
            // Merge and deduplicate (include address hints + common names for booking flow)
            // V87: commonNames added to prevent "Dustin" → "question" mishearing
            const allHints = [...new Set([...hints, ...defaultHints, ...addressHints, ...commonNames])];
            
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

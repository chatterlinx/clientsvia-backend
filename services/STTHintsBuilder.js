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
            // Cache key is per-company when a company is provided — prevents cross-tenant hits.
            const cacheKey = company?._id
                ? `${company._id.toString()}:${templateId?.toString() || 'notemplate'}`
                : (templateId?.toString() || 'default');
            const cached = hintsCache.get(cacheKey);

            if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
                return cached.hints;
            }

            // Detect STT provider from company speechDetection setting.
            // Deepgram (nova-2-phonecall / auto): weighted "phrase:boost" format supported.
            // Google (phone_call / default): flat CSV only — weights discarded.
            const speechModel = company?.aiAgentSettings?.agent2?.speechDetection?.speechModel || 'phone_call';
            const isDeepgram = (speechModel === 'nova-2-phonecall' || speechModel === 'auto');

            // Try to load from STT Profile
            let hints = []; // flat phrases (unweighted portion)
            let weightedHints = []; // { phrase, boost } — only used for Deepgram format

            // ── Priority 1: Company-managed keywords in agent2 speechDetection ──────────
            const companyKeywords = company?.aiAgentSettings?.agent2?.speechDetection?.keywords;
            if (companyKeywords && companyKeywords.length > 0) {
                const enabled = companyKeywords
                    .filter(k => k.enabled !== false)
                    .sort((a, b) => (b.boost || 3) - (a.boost || 3));

                if (isDeepgram) {
                    weightedHints = enabled.map(k => ({ phrase: k.phrase, boost: k.boost || 3 }));
                } else {
                    hints = enabled.map(k => k.phrase);
                }

                logger.debug('[STT HINTS] Using company keywords', {
                    companyId: company._id,
                    count: enabled.length,
                    provider: speechModel
                });

            // ── Priority 2: STT Profile template keywords (legacy path) ─────────────────
            } else if (templateId) {
                const STTProfile = require('../models/STTProfile');
                const profile = await STTProfile.findOne({
                    templateId,
                    isActive: true
                }).lean();

                if (profile && profile.provider?.useHints !== false) {
                    const keywords = (profile.vocabulary?.boostedKeywords || [])
                        .filter(k => k.enabled)
                        .sort((a, b) => (b.boostWeight || 5) - (a.boostWeight || 5));

                    if (isDeepgram) {
                        weightedHints = keywords.map(k => ({ phrase: k.phrase, boost: k.boostWeight || 5 }));
                    } else {
                        hints = keywords.map(k => k.phrase);
                    }

                    logger.debug('[STT HINTS] Loaded from profile', {
                        templateId,
                        keywordCount: hints.length || weightedHints.length
                    });
                }
            }

            // ── Priority 3: Trade + service types fallback (no custom keywords, no profile) ─
            if (hints.length === 0 && weightedHints.length === 0 && company) {
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
            
            // Merge and deduplicate the unweighted pool (defaults + address + names)
            // V87: commonNames added to prevent "Dustin" → "question" mishearing
            const flatHints = [...new Set([...hints, ...defaultHints, ...addressHints, ...commonNames])];

            // Build hints string with 1,000-char Twilio budget.
            // Deepgram: weighted keywords first ("phrase:boost"), then flat phrases.
            // Google: flat CSV only.
            let hintsString = '';

            if (isDeepgram && weightedHints.length > 0) {
                // Emit "phrase:boost" for custom keywords
                for (const { phrase, boost } of weightedHints) {
                    const token = `${phrase}:${boost}`;
                    const next = hintsString ? hintsString + ', ' + token : token;
                    if (next.length > 1000) break;
                    hintsString = next;
                }
                // Fill remaining budget with flat hints (names, defaults, etc.)
                const weightedPhrases = new Set(weightedHints.map(w => w.phrase.toLowerCase()));
                for (const hint of flatHints) {
                    if (weightedPhrases.has(hint.toLowerCase())) continue; // already included
                    const next = hintsString ? hintsString + ', ' + hint : hint;
                    if (next.length > 1000) break;
                    hintsString = next;
                }
            } else {
                // Google / legacy: flat CSV
                for (const hint of flatHints) {
                    const next = hintsString ? hintsString + ', ' + hint : hint;
                    if (next.length > 1000) break;
                    hintsString = next;
                }
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

/**
 * ============================================================================
 * SERVICE TYPE CLARIFIER
 * ============================================================================
 * 
 * PURPOSE:
 * When caller says "I need AC service" - we don't know if they mean:
 *   - Repair (something broken)
 *   - Maintenance (tune-up, cleaning)
 *   - Installation (new unit)
 * 
 * This service determines:
 *   1. Should we ask for clarification? (ambiguous input)
 *   2. What service type did they specify? (from keywords)
 * 
 * CRITICAL FOR:
 *   - Routing to correct calendar (repair vs maintenance)
 *   - Proper technician dispatch
 *   - Accurate appointment types
 * 
 * CONFIG SHAPE (per company / per trade):
 * {
 *   enabled: Boolean,
 *   ambiguousPhrases: ["service", "work", "come out", ...],
 *   clarificationQuestion: "Is this for repair or maintenance?",
 *   serviceTypes: [
 *     {
 *       key: "repair",
 *       label: "Repair",
 *       keywords: ["broken", "not cooling", "leak", "noise"],
 *       calendarId: "cal_repair_123",
 *       priority: 1
 *     },
 *     {
 *       key: "maintenance",
 *       label: "Maintenance / Tune-Up",
 *       keywords: ["tune up", "maintenance", "cleaning", "annual"],
 *       calendarId: "cal_maint_456",
 *       priority: 2
 *     }
 *   ]
 * }
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// ============================================================================
// DEFAULT CONFIGURATION (Template-level defaults for HVAC)
// ============================================================================

const DEFAULT_HVAC_CONFIG = {
    enabled: true,
    ambiguousPhrases: [
        'service', 'work', 'come out', 'look at', 'check', 'check out',
        'needs attention', 'acting up', 'not right', 'needs service',
        'service call', 'send someone', 'someone to come', 'come by'
    ],
    clarificationQuestion: "Absolutely — is this for a repair issue, or routine maintenance and tune-up?",
    serviceTypes: [
        {
            key: 'repair',
            label: 'Repair',
            keywords: [
                // Clear repair indicators
                'broken', 'not working', 'stopped working', 'won\'t turn on',
                'not cooling', 'not heating', 'no cool', 'no heat', 'no air',
                'leak', 'leaking', 'water', 'flooding',
                'noise', 'noisy', 'loud', 'strange sound', 'making noise',
                'smell', 'burning smell', 'weird smell',
                'emergency', 'urgent', 'right now', 'asap', 'immediately',
                'fix', 'repair', 'broke', 'busted', 'dead',
                'freon', 'refrigerant', 'compressor', 'fan not working',
                'blowing warm', 'blowing hot', 'not blowing cold'
            ],
            calendarId: null, // Company maps this
            priority: 1 // Higher priority = check first
        },
        {
            key: 'maintenance',
            label: 'Maintenance / Tune-Up',
            keywords: [
                // Clear maintenance indicators
                'tune up', 'tune-up', 'tuneup', 'maintenance',
                'cleaning', 'clean', 'annual', 'yearly', 'seasonal',
                'preventive', 'preventative', 'inspection', 'checkup', 'check-up',
                'routine', 'regular service', 'scheduled service',
                'filter', 'filter change', 'filter replacement'
            ],
            calendarId: null,
            priority: 2
        },
        {
            key: 'installation',
            label: 'Installation / Replacement',
            keywords: [
                // Clear installation indicators
                'new unit', 'new system', 'replace', 'replacement',
                'install', 'installation', 'upgrade', 'new ac',
                'new air conditioner', 'new hvac', 'quote', 'estimate',
                'how much for new', 'cost of new'
            ],
            calendarId: null,
            priority: 3
        }
    ]
};

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

class ServiceTypeClarifier {
    
    /**
     * ========================================================================
     * SHOULD CLARIFY
     * ========================================================================
     * 
     * Determine if this message requires clarification before booking.
     * 
     * @param {string} userInput - Raw user utterance (already transcribed)
     * @param {object} config - serviceTypeClarification block from company/trade config
     * @returns {{ needsClarification: boolean, reason: string, matchedPhrase?: string }}
     */
    static shouldClarify(userInput, config) {
        // Use defaults if no config provided
        const effectiveConfig = this._mergeWithDefaults(config);
        
        if (!effectiveConfig.enabled) {
            return { needsClarification: false, reason: 'disabled' };
        }
        
        if (!userInput || typeof userInput !== 'string') {
            return { needsClarification: false, reason: 'no_input' };
        }
        
        const input = userInput.toLowerCase();
        
        // 1) If we clearly match a serviceType via keywords → NO clarification needed
        const explicitMatch = this._detectServiceTypeFromText(input, effectiveConfig);
        if (explicitMatch) {
            logger.debug('[SERVICE CLARIFIER] Explicit match found, no clarification needed', {
                serviceType: explicitMatch.key,
                matchedKeyword: explicitMatch.matchedKeyword
            });
            return { 
                needsClarification: false, 
                reason: 'explicit_match',
                detectedType: explicitMatch
            };
        }
        
        // 2) If any ambiguous phrase is present → clarification REQUIRED
        const ambiguousPhrases = effectiveConfig.ambiguousPhrases || [];
        
        for (const phrase of ambiguousPhrases) {
            if (phrase && input.includes(phrase.toLowerCase())) {
                logger.info('[SERVICE CLARIFIER] Ambiguous phrase detected, clarification needed', {
                    phrase,
                    input: input.substring(0, 50)
                });
                return { 
                    needsClarification: true, 
                    reason: 'ambiguous_phrase',
                    matchedPhrase: phrase
                };
            }
        }
        
        // 3) If nothing matches, we DON'T force clarification
        // Let the normal booking / triage pipeline continue
        return { needsClarification: false, reason: 'no_match' };
    }
    
    /**
     * ========================================================================
     * DETECT SERVICE TYPE
     * ========================================================================
     * 
     * Try to resolve the serviceType from user input based on config.
     * 
     * @param {string} userInput
     * @param {object} config
     * @returns {{ key: string, label: string, calendarId?: string, matchedKeyword: string } | null}
     */
    static detectServiceType(userInput, config) {
        const effectiveConfig = this._mergeWithDefaults(config);
        
        if (!effectiveConfig.enabled) return null;
        if (!userInput || typeof userInput !== 'string') return null;
        
        const input = userInput.toLowerCase();
        return this._detectServiceTypeFromText(input, effectiveConfig);
    }
    
    /**
     * ========================================================================
     * GET CLARIFICATION QUESTION
     * ========================================================================
     * 
     * Return the clarification question to ask the caller.
     * Fallback to a sane default if none is configured.
     * 
     * @param {object} config
     * @returns {string}
     */
    static getClarificationQuestion(config) {
        const effectiveConfig = this._mergeWithDefaults(config);
        
        if (effectiveConfig.clarificationQuestion && 
            typeof effectiveConfig.clarificationQuestion === 'string' &&
            effectiveConfig.clarificationQuestion.trim()) {
            return effectiveConfig.clarificationQuestion.trim();
        }
        
        // Safe default
        return "Absolutely — is this for a repair issue, routine maintenance, or a new installation?";
    }
    
    /**
     * ========================================================================
     * GET SERVICE TYPES (for UI display)
     * ========================================================================
     * 
     * Returns the list of configured service types.
     * 
     * @param {object} config
     * @returns {Array}
     */
    static getServiceTypes(config) {
        const effectiveConfig = this._mergeWithDefaults(config);
        return effectiveConfig.serviceTypes || [];
    }
    
    /**
     * ========================================================================
     * GET DEFAULT CONFIG (for seeding new companies)
     * ========================================================================
     * 
     * @param {string} trade - Trade type (e.g., 'hvac', 'plumbing')
     * @returns {object}
     */
    static getDefaultConfig(trade = 'hvac') {
        // For now, we only have HVAC defaults
        // Add more trades as needed
        const configs = {
            hvac: DEFAULT_HVAC_CONFIG,
            // plumbing: DEFAULT_PLUMBING_CONFIG,
            // electrical: DEFAULT_ELECTRICAL_CONFIG,
        };
        
        return configs[trade] || DEFAULT_HVAC_CONFIG;
    }
    
    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================
    
    /**
     * Internal detection logic - finds matching service type from keywords
     * 
     * @param {string} lowerInput - Lowercase input
     * @param {object} config - Effective config
     * @returns {{ key: string, label: string, calendarId?: string, matchedKeyword: string } | null}
     * @private
     */
    static _detectServiceTypeFromText(lowerInput, config) {
        const serviceTypes = Array.isArray(config.serviceTypes) 
            ? config.serviceTypes 
            : [];
        
        // Sort by priority (lower = higher priority)
        const sorted = [...serviceTypes].sort((a, b) => 
            (a.priority || 99) - (b.priority || 99)
        );
        
        for (const st of sorted) {
            if (!st || !Array.isArray(st.keywords)) continue;
            
            for (const keyword of st.keywords) {
                if (!keyword) continue;
                
                const kw = keyword.toLowerCase();
                if (lowerInput.includes(kw)) {
                    return {
                        key: st.key,
                        label: st.label || st.key,
                        calendarId: st.calendarId || null,
                        matchedKeyword: keyword,
                        priority: st.priority
                    };
                }
            }
        }
        
        return null;
    }
    
    /**
     * Merge company config with defaults
     * 
     * @param {object} config - Company/trade config
     * @returns {object} - Merged config
     * @private
     */
    static _mergeWithDefaults(config) {
        if (!config) {
            return { ...DEFAULT_HVAC_CONFIG };
        }
        
        return {
            enabled: config.enabled !== false, // Default to enabled
            ambiguousPhrases: config.ambiguousPhrases?.length > 0 
                ? config.ambiguousPhrases 
                : DEFAULT_HVAC_CONFIG.ambiguousPhrases,
            clarificationQuestion: config.clarificationQuestion || DEFAULT_HVAC_CONFIG.clarificationQuestion,
            serviceTypes: config.serviceTypes?.length > 0 
                ? config.serviceTypes 
                : DEFAULT_HVAC_CONFIG.serviceTypes
        };
    }
}

module.exports = ServiceTypeClarifier;


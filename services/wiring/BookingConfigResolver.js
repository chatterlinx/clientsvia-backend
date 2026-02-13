/**
 * ============================================================================
 * BOOKING CONFIG RESOLVER - SINGLE SOURCE OF TRUTH FOR BOOKING CONFIGURATION
 * ============================================================================
 * 
 * THE NON-NEGOTIABLE CONTRACT:
 * 1. ALL booking config reads MUST go through this module
 * 2. ALL reads use AWConfigReader (traced to Raw Events)
 * 3. NO direct company.aiAgentSettings... reads for booking config
 * 4. NO multiple implementations (one resolver, one truth)
 * 
 * CONSUMERS:
 * - BookingFlowRunner (uses this for steps, prompts, templates)
 * - ConversationEngine (uses this for booking state)
 * - SlotExtractor (uses this for slot config)
 * 
 * REMOVED (V116 Clean Sweep):
 * - ConsentDetector — dead code, never called
 * - DirectBookingIntentDetector — dead code, removed entirely
 * 
 * WHY THIS EXISTS:
 * Before this, booking config was read from multiple places:
 * - BookingFlowRunner read directly from company.aiAgentSettings
 * - [REMOVED] ConsentDetector had its own fallback reads
 * - [REMOVED] DirectBookingIntentDetector used hardcoded patterns
 * 
 * This created "split-brain" behavior where UI config was ignored
 * because runtime was reading from legacy paths.
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

// ============================================================================
// BLACKBOX LOGGER INTEGRATION
// ============================================================================
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../BlackBoxLogger');
} catch (e) {
    logger.warn('[BOOKING CONFIG RESOLVER] BlackBoxLogger not available');
}

/**
 * BookingConfigResolver - Single source for all booking configuration
 * 
 * USAGE:
 *   const BookingConfigResolver = require('./services/wiring/BookingConfigResolver');
 *   
 *   // Create resolver for a call
 *   const resolver = BookingConfigResolver.forCall({ awReader, company, session });
 *   
 *   // Get booking config (all reads traced through AWConfigReader)
 *   const { slots, prompts, templates, intentPatterns, consentConfig } = resolver.getBookingConfig();
 */
class BookingConfigResolver {
    constructor({ awReader, company, session, callId, companyId }) {
        this.awReader = awReader;
        this.company = company || {};
        this.session = session || {};
        this.callId = callId || awReader?.callId;
        this.companyId = companyId || awReader?.companyId || company?._id?.toString();
        
        // Cache resolved config (computed once per turn)
        this._cache = null;
    }
    
    /**
     * Factory method for per-call resolvers
     */
    static forCall({ awReader, company, session, callId, companyId }) {
        return new BookingConfigResolver({ awReader, company, session, callId, companyId });
    }
    
    /**
     * ========================================================================
     * GET BOOKING CONFIG - The main entrypoint
     * ========================================================================
     * 
     * Returns ALL booking configuration in one call.
     * All reads go through AWConfigReader for tracing.
     * 
     * @returns {Object} Complete booking configuration
     */
    getBookingConfig() {
        if (this._cache) return this._cache;
        
        const config = {
            // ─────────────────────────────────────────────────────────────────
            // FEATURE FLAGS
            // ─────────────────────────────────────────────────────────────────
            enabled: this._read('frontDesk.bookingEnabled', true),
            requiresExplicitConsent: this._read('frontDesk.discoveryConsent.bookingRequiresExplicitConsent', true),
            
            // ─────────────────────────────────────────────────────────────────
            // SLOT CONFIGURATION (V110: slotRegistry + bookingFlow)
            // ─────────────────────────────────────────────────────────────────
            slots: this._readV110Slots(),
            
            // ─────────────────────────────────────────────────────────────────
            // PROMPT CONFIGURATION (what to say)
            // ─────────────────────────────────────────────────────────────────
            prompts: this._readBookingPrompts(),
            
            // ─────────────────────────────────────────────────────────────────
            // TEMPLATES (confirmation, completion messages)
            // ─────────────────────────────────────────────────────────────────
            templates: this._readBookingTemplates(),
            
            // ─────────────────────────────────────────────────────────────────
            // INTENT DETECTION (what triggers booking)
            // ─────────────────────────────────────────────────────────────────
            intentPatterns: this._readIntentPatterns(),
            
            // ─────────────────────────────────────────────────────────────────
            // CONSENT CONFIGURATION (consent detection)
            // ─────────────────────────────────────────────────────────────────
            consent: this._readConsentConfig(),
            
            // ─────────────────────────────────────────────────────────────────
            // VERIFICATION (address, name)
            // ─────────────────────────────────────────────────────────────────
            addressVerification: this._readAddressVerification(),
            nameParsing: this._readNameParsing(),
            nameSpellingVariants: this._readNameSpellingVariants(),
            
            // ─────────────────────────────────────────────────────────────────
            // FLOW CONTROL
            // ─────────────────────────────────────────────────────────────────
            outcome: this._read('frontDesk.bookingOutcome', {}),
            abortPhrases: this._read('frontDesk.bookingAbortPhrases', []),
            
            // ─────────────────────────────────────────────────────────────────
            // FAST PATH BOOKING
            // ─────────────────────────────────────────────────────────────────
            fastPath: this._read('frontDesk.fastPathBooking', {}),
            
            // ─────────────────────────────────────────────────────────────────
            // METADATA
            // ─────────────────────────────────────────────────────────────────
            _resolvedAt: new Date().toISOString(),
            _resolvedBy: 'BookingConfigResolver'
        };
        
        this._cache = config;
        this._emitConfigResolved(config);
        
        return config;
    }
    
    /**
     * ========================================================================
     * INDIVIDUAL GETTERS (for targeted reads)
     * ========================================================================
     */
    
    getSlots() {
        return this._readV110Slots();
    }
    
    getPrompts() {
        return this._readBookingPrompts();
    }
    
    /**
     * V110: Read slots from slotRegistry + bookingFlow (sole source)
     */
    _readV110Slots() {
        const slotRegistry = this._read('frontDesk.slotRegistry', {});
        const bookingFlow = this._read('frontDesk.bookingFlow', {});
        const v110Slots = slotRegistry.slots || [];
        const v110Steps = bookingFlow.steps || [];
        
        if (v110Slots.length === 0 || v110Steps.length === 0) {
            return [];
        }
        
        // Merge slots with step prompts
        return v110Slots.map(slot => {
            const step = v110Steps.find(s => s.slotId === (slot.id || slot.slotId));
            if (step) {
                return { ...slot, ...step, id: slot.id || slot.slotId };
            }
            return slot;
        });
    }
    
    getTemplates() {
        return this._readBookingTemplates();
    }
    
    getIntentPatterns() {
        return this._readIntentPatterns();
    }
    
    getConsentConfig() {
        return this._readConsentConfig();
    }
    
    getAddressVerification() {
        return this._readAddressVerification();
    }
    
    getNameParsing() {
        return this._readNameParsing();
    }
    
    /**
     * ========================================================================
     * PRIVATE: Read helpers (all go through AWConfigReader)
     * ========================================================================
     */
    
    /**
     * Core read method - goes through AWConfigReader if available
     */
    _read(awPath, defaultValue = undefined) {
        if (this.awReader && typeof this.awReader.get === 'function') {
            this.awReader.setReaderId('BookingConfigResolver');
            return this.awReader.get(awPath, defaultValue);
        }
        
        // Fallback: Direct read with warning (should be rare in production)
        logger.warn('[BOOKING CONFIG RESOLVER] ⚠️ No AWConfigReader - direct read', { awPath });
        return this._directRead(awPath, defaultValue);
    }
    
    /**
     * Direct read (fallback only - used when AWConfigReader not available)
     */
    _directRead(awPath, defaultValue) {
        const frontDesk = this.company.aiAgentSettings?.frontDeskBehavior || {};
        const aiSettings = this.company.aiAgentSettings || {};
        
        // Try frontDesk first, then aiSettings
        const parts = awPath.split('.');
        if (parts[0] === 'frontDesk') {
            const subPath = parts.slice(1).join('.');
            return this._getByPath(frontDesk, subPath) ?? defaultValue;
        }
        if (parts[0] === 'booking') {
            const subPath = parts.slice(1).join('.');
            return this._getByPath(frontDesk.booking || aiSettings.frontDesk?.booking || {}, subPath) ?? defaultValue;
        }
        
        return this._getByPath(aiSettings, awPath) ?? defaultValue;
    }
    
    _getByPath(obj, path) {
        if (!obj || !path) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current == null) return undefined;
            current = current[part];
        }
        return current;
    }
    
    /**
     * Read booking prompts from UI-configured paths
     */
    _readBookingPrompts() {
        // V110: Prompts come from bookingFlow.steps and bookingOutcome only
        const outcome = this._read('frontDesk.bookingOutcome', {});
        const bookingBehavior = this._read('frontDesk.bookingBehavior', {});
        
        return {
            // Confirmation/completion templates
            confirmTemplate: bookingBehavior.confirmationPrompt || outcome.confirmationPrompt,
            completeTemplate: bookingBehavior.completionPrompt || outcome.completionPrompt,
            
            // Consent question
            consentQuestion: this._read('frontDesk.discoveryConsent.consentQuestion', 
                "Would you like me to schedule a technician to come out?"),
            
            // Source tracking
            _source: {
                bookingBehavior: bookingBehavior ? 'frontDesk.bookingBehavior' : null,
                outcome: outcome ? 'frontDesk.bookingOutcome' : null
            }
        };
    }
    
    /**
     * Read booking templates (confirmation, completion messages)
     */
    _readBookingTemplates() {
        // V110: Templates come from bookingBehavior and bookingOutcome only
        const bookingBehavior = this._read('frontDesk.bookingBehavior', {});
        const outcome = this._read('frontDesk.bookingOutcome', {});
        
        return {
            confirmation: bookingBehavior.confirmationPrompt
                || outcome.confirmationPrompt 
                || outcome.scripts?.final_confirmation
                || null,
            completion: bookingBehavior.completionPrompt
                || outcome.completionPrompt 
                || outcome.scripts?.booking_complete
                || null,
            _confirmationSource: bookingBehavior.confirmationPrompt ? 'bookingBehavior' :
                outcome.confirmationPrompt ? 'bookingOutcome' :
                outcome.scripts?.final_confirmation ? 'bookingOutcome.scripts' : 'hardcoded_default',
            _completionSource: bookingBehavior.completionPrompt ? 'bookingBehavior' :
                outcome.completionPrompt ? 'bookingOutcome' :
                outcome.scripts?.booking_complete ? 'bookingOutcome.scripts' : 'hardcoded_default'
        };
    }
    
    /**
     * Read booking intent patterns (what triggers booking mode)
     * V96j CRITICAL FIX: These patterns MUST be UI-configurable
     */
    _readIntentPatterns() {
        // V110: Detection triggers from canonical paths only
        const wantsBookingPatterns = this._read('frontDesk.detectionTriggers.wantsBooking', []);
        const directIntentPatterns = this._read('frontDesk.detectionTriggers.directIntentPatterns', []);
        const bookingIntentDetection = this._read('frontDesk.bookingIntentDetection', {});
        
        // Merge all configured patterns
        const configuredPatterns = [
            ...wantsBookingPatterns,
            ...directIntentPatterns,
            ...(bookingIntentDetection.patterns || [])
        ].filter(Boolean);
        
        // Default fallback patterns (if nothing configured)
        // V96j: These are EXPANDED to catch natural language
        const defaultPatterns = [
            // Explicit scheduling
            'schedule', 'book', 'appointment', 'set up',
            
            // Urgency/timing (V96j FIX - expanded)
            'as soon as possible', 'asap', 'early as possible',
            'soonest', 'earliest', 'first available', 'next available',
            'right away', 'immediately', 'today', 'tomorrow',
            
            // Service requests
            'send someone', 'get someone', 'have someone come',
            'need someone', 'need a tech', 'need help',
            
            // Problem + implicit service (V96j FIX - expanded)
            'not working', 'not cooling', 'not heating', 'broken',
            'stopped working', 'won\'t work', 'isn\'t working',
            'no heat', 'no air', 'no cooling', 'no power',
            
            // Agreement after offer (V96j FIX - critical)
            'yes', 'yeah', 'sure', 'okay', 'please do',
            'sounds good', 'that works', 'let\'s do it'
        ];
        
        return {
            configured: configuredPatterns,
            defaults: defaultPatterns,
            all: configuredPatterns.length > 0 ? configuredPatterns : defaultPatterns,
            useDefaults: configuredPatterns.length === 0,
            _source: configuredPatterns.length > 0 
                ? (wantsBookingPatterns.length > 0 ? 'frontDesk.detectionTriggers.wantsBooking' :
                   directIntentPatterns.length > 0 ? 'frontDesk.detectionTriggers.directIntentPatterns' : 'frontDesk.bookingIntentDetection')
                : 'hardcoded_defaults'
        };
    }
    
    /**
     * Read consent configuration
     */
    _readConsentConfig() {
        const discoveryConsent = this._read('frontDesk.discoveryConsent', {});
        
        return {
            required: discoveryConsent.bookingRequiresExplicitConsent !== false,
            phrases: discoveryConsent.consentPhrases || [],
            question: discoveryConsent.consentQuestion 
                || "Would you like me to schedule a technician to come out?",
            minDiscoveryFields: discoveryConsent.minDiscoveryFieldsBeforeConsent || 0,
            autoInjectInScenarios: discoveryConsent.autoInjectConsentInScenarios || false,
            _source: 'frontDesk.discoveryConsent'
        };
    }
    
    /**
     * Read address verification configuration
     */
    _readAddressVerification() {
        const config = this._read('booking.addressVerification', {});
        
        return {
            enabled: config.enabled || false,
            provider: config.provider || 'google',
            requireCity: config.requireCity !== false,
            requireState: config.requireState !== false,
            requireZip: config.requireZip || false,
            requireUnitQuestion: config.requireUnitQuestion || false,
            unitQuestionMode: config.unitQuestionMode,
            missingCityStatePrompt: config.missingCityStatePrompt,
            unitTypePrompt: config.unitTypePrompt,
            _source: 'booking.addressVerification'
        };
    }
    
    /**
     * Read name parsing configuration
     */
    _readNameParsing() {
        const nameParsing = this._read('booking.nameParsing', {});
        
        return {
            acceptLastNameOnly: nameParsing.acceptLastNameOnly !== false,
            lastNameOnlyPrompt: nameParsing.lastNameOnlyPrompt,
            _source: 'booking.nameParsing'
        };
    }
    
    /**
     * Read name spelling variants configuration (Mark vs Marc, etc.)
     */
    _readNameSpellingVariants() {
        const variants = this._read('frontDesk.nameSpellingVariants', {});
        
        return {
            enabled: variants.enabled || false,
            mode: variants.mode || 'always_ask',
            script: variants.script,
            maxAsksPerCall: variants.maxAsksPerCall || 1,
            variantGroups: variants.variantGroups || [],
            precomputedVariantMap: variants.precomputedVariantMap || {},
            _source: 'frontDesk.nameSpellingVariants'
        };
    }
    
    /**
     * ========================================================================
     * EMIT BOOKING_CONFIG_RESOLVED event (for tracing)
     * ========================================================================
     */
    _emitConfigResolved(config) {
        if (!BlackBoxLogger?.logEvent || !this.callId || !this.companyId) return;
        
        try {
            BlackBoxLogger.logEvent({
                callId: this.callId,
                companyId: this.companyId,
                type: 'BOOKING_CONFIG_RESOLVED',
                turn: this.session?.metrics?.totalTurns || 0,
                data: {
                    enabled: config.enabled,
                    requiresExplicitConsent: config.requiresExplicitConsent,
                    slotsCount: config.slots?.length || 0,
                    hasCustomPrompts: !!(config.prompts?.confirmTemplate || config.prompts?.completeTemplate),
                    intentPatternSource: config.intentPatterns?._source,
                    intentPatternCount: config.intentPatterns?.all?.length || 0,
                    addressVerificationEnabled: config.addressVerification?.enabled,
                    addressVerificationSource: config.addressVerification?._source,
                    nameSpellingVariantsEnabled: config.nameSpellingVariants?.enabled,
                    _resolvedAt: config._resolvedAt
                }
            }).catch(() => {});
        } catch (err) {
            // Silent fail - never let tracing kill the call
        }
    }
    
    /**
     * Clear cache (call between turns if config might have changed)
     */
    clearCache() {
        this._cache = null;
    }
}

module.exports = BookingConfigResolver;

/**
 * ============================================================================
 * CONTROL PLANE EFFECTIVE CONFIG - Runtime-Merged Configuration
 * ============================================================================
 * 
 * PURPOSE: Returns the exact values the runtime uses (after defaults + overrides)
 * 
 * CRITICAL: Uses Config Unifier to resolve "two-config reality" bug
 *           All reads go through canonical keys, legacy is merged automatically
 * 
 * CANONICAL KEYS:
 * - Greeting: connectionMessages.voice.text
 * - Booking: frontDeskBehavior.bookingEnabled + frontDeskBehavior.bookingSlots
 * - Personality: frontDeskBehavior.personality.*
 * - Fallbacks: companyResponseDefaults.*Reply.fullReply
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const v2Company = require('../../models/v2Company');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { lintControlPlane } = require('../../utils/controlPlaneLinter');
const { substitutePlaceholders } = require('../../utils/placeholderStandard');
const { unifyConfig, migratePlaceholders } = require('../../utils/configUnifier');
const logger = require('../../utils/logger');

// TTS performance constants
const TTS_WORDS_PER_MINUTE = 150;
const TTS_WORDS_PER_SECOND = TTS_WORDS_PER_MINUTE / 60; // 2.5
const TARGET_GREETING_SECONDS = 2.5;
const MAX_GREETING_SECONDS = 4.0;

router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/control-plane/effective
 * Returns the merged final config used at runtime
 * 
 * CRITICAL: This endpoint is the SINGLE SOURCE OF TRUTH
 * Lint, runtime, and UI should all read from this output
 * 
 * AUTO-CONVERGENCE: If legacy sources are detected, writes back to canonical
 * to prevent perpetual legacy dependency
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const autoConverge = req.query.converge !== 'false'; // Default: converge
    
    try {
        // Load company (NOT lean - we need to potentially save)
        const [company, responseDefaults, placeholdersDoc] = await Promise.all([
            v2Company.findById(companyId),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD PLACEHOLDER MAP
        // ═══════════════════════════════════════════════════════════════════════
        const placeholderMap = {};
        (placeholdersDoc?.placeholders || []).forEach(p => {
            placeholderMap[p.key] = p.value;
        });
        // Add system placeholders
        placeholderMap.companyName = company.companyName;
        placeholderMap.companyPhone = company.companyPhone || company.phoneNumber;
        
        // ═══════════════════════════════════════════════════════════════════════
        // USE CONFIG UNIFIER - SINGLE SOURCE OF TRUTH
        // This resolves the "two-config reality" bug by reading from canonical
        // keys first, then falling back to legacy keys, then to defaults
        // ═══════════════════════════════════════════════════════════════════════
        const effectiveConfig = unifyConfig(company.toObject(), responseDefaults, {
            seedBookingSlotsIfEmpty: false // Don't auto-seed, show warning instead
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // AUTO-CONVERGENCE: Write back to canonical if using legacy sources
        // This ensures future reads don't need legacy fallback
        // ═══════════════════════════════════════════════════════════════════════
        const convergenceActions = [];
        
        if (autoConverge) {
            // Check if booking slots came from legacy
            if (effectiveConfig._meta.bookingSlotsSource.includes('legacy')) {
                if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
                company.frontDeskBehavior.bookingSlots = effectiveConfig.booking.slots;
                convergenceActions.push({
                    field: 'bookingSlots',
                    from: effectiveConfig._meta.bookingSlotsSource,
                    to: 'frontDeskBehavior.bookingSlots'
                });
            }
            
            // Check if greeting came from legacy
            if (effectiveConfig._meta.greetingSource.includes('legacy')) {
                if (!company.connectionMessages) company.connectionMessages = {};
                if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
                company.connectionMessages.voice.text = effectiveConfig.greeting.standardized;
                convergenceActions.push({
                    field: 'greeting',
                    from: effectiveConfig._meta.greetingSource,
                    to: 'connectionMessages.voice.text'
                });
            }
            
            // Check if greeting has legacy placeholders that were standardized
            if (effectiveConfig.greeting.hasLegacyPlaceholders) {
                if (!company.connectionMessages) company.connectionMessages = {};
                if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
                company.connectionMessages.voice.text = effectiveConfig.greeting.standardized;
                convergenceActions.push({
                    field: 'greeting.placeholders',
                    action: 'standardized',
                    to: 'connectionMessages.voice.text'
                });
            }
            
            // Check if conversationStyle needs migration
            if (effectiveConfig._meta.conversationStyleSource.includes('legacy')) {
                if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
                if (!company.frontDeskBehavior.personality) company.frontDeskBehavior.personality = {};
                company.frontDeskBehavior.personality.conversationStyle = effectiveConfig.personality.conversationStyle;
                convergenceActions.push({
                    field: 'conversationStyle',
                    from: effectiveConfig._meta.conversationStyleSource,
                    to: 'frontDeskBehavior.personality.conversationStyle'
                });
            }
            
            // Save if we made convergence changes
            if (convergenceActions.length > 0) {
                await company.save();
                
                // Clear Redis cache
                const { redisClient } = require('../../db');
                if (redisClient && redisClient.isOpen) {
                    await redisClient.del(`company:${companyId}`);
                }
                
                logger.info(`[CONTROL PLANE] Auto-converged ${convergenceActions.length} fields for company ${companyId}`);
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // COMPUTE GREETING PREVIEW (with placeholder substitution)
        // ═══════════════════════════════════════════════════════════════════════
        const greetingText = effectiveConfig.greeting.standardized || effectiveConfig.greeting.raw;
        const greetingPreview = substitutePlaceholders(greetingText, placeholderMap);
        effectiveConfig.greeting.preview = greetingPreview;
        
        // ═══════════════════════════════════════════════════════════════════════
        // COMPUTE PERFORMANCE METRICS
        // ═══════════════════════════════════════════════════════════════════════
        const greetingWords = greetingPreview ? greetingPreview.split(/\s+/).filter(w => w.length > 0).length : 0;
        const greetingChars = greetingPreview ? greetingPreview.length : 0;
        const greetingEstimatedSeconds = greetingWords / TTS_WORDS_PER_SECOND;
        const recommendedMaxWords = Math.floor(TARGET_GREETING_SECONDS * TTS_WORDS_PER_SECOND);
        const wordsOverTarget = Math.max(0, greetingWords - recommendedMaxWords);
        
        const computed = {
            performance: {
                greetingWordCount: greetingWords,
                greetingCharCount: greetingChars,
                greetingEstimatedSeconds: Math.round(greetingEstimatedSeconds * 10) / 10,
                greetingTTSRating: greetingEstimatedSeconds <= TARGET_GREETING_SECONDS ? 'GOOD' : 
                                   greetingEstimatedSeconds <= MAX_GREETING_SECONDS ? 'ACCEPTABLE' : 'TOO_LONG',
                tts: {
                    wordsPerMinute: TTS_WORDS_PER_MINUTE,
                    wordsPerSecond: TTS_WORDS_PER_SECOND,
                    targetSeconds: TARGET_GREETING_SECONDS,
                    maxSeconds: MAX_GREETING_SECONDS,
                    recommendedMaxWords,
                    currentWords: greetingWords,
                    wordsOverTarget,
                    needsOptimization: greetingEstimatedSeconds > TARGET_GREETING_SECONDS,
                    suggestion: greetingEstimatedSeconds > TARGET_GREETING_SECONDS 
                        ? `Remove ${wordsOverTarget} words to hit ${TARGET_GREETING_SECONDS}s target`
                        : null
                },
                // CRITICAL: These MUST read from unified config, not raw company
                bookingSlotsCount: effectiveConfig.booking.slotsCount,
                forbiddenPhrasesCount: effectiveConfig.vocabulary.forbiddenPhrasesCount,
                escalationRulesCount: effectiveConfig.escalation.rulesCount
            },
            
            completeness: {
                greetingConfigured: effectiveConfig.greeting.configured,
                bookingConfigured: effectiveConfig.booking.slotsCount > 0,
                fallbacksConfigured: effectiveConfig.fallbacks.notOfferedConfigured && 
                                     effectiveConfig.fallbacks.unknownIntentConfigured,
                escalationConfigured: effectiveConfig.escalation.rulesCount > 0,
                
                score: calculateCompletenessScore(effectiveConfig)
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // RUN LINTER ON UNIFIED CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        const lintResults = lintControlPlane(effectiveConfig, placeholderMap);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD WARNINGS
        // ═══════════════════════════════════════════════════════════════════════
        const warnings = [];
        
        // Greeting warnings
        if (!effectiveConfig.greeting.configured) {
            warnings.push({
                field: 'greeting',
                severity: 'error',
                message: 'No greeting configured',
                canonicalKey: 'connectionMessages.voice.text'
            });
        }
        
        if (effectiveConfig.greeting.hasLegacyPlaceholders) {
            warnings.push({
                field: 'greeting',
                severity: 'warning',
                message: 'Greeting contains legacy placeholders. Use {{companyName}} format.',
                canonicalKey: 'connectionMessages.voice.text'
            });
        }
        
        if (computed.performance.greetingEstimatedSeconds > 4) {
            warnings.push({
                field: 'greeting',
                severity: 'warning',
                message: `Greeting is too long (${greetingWords} words, ~${computed.performance.greetingEstimatedSeconds}s). Keep under 25 words.`
            });
        }
        
        // Fallback warnings
        if (!effectiveConfig.fallbacks.notOfferedConfigured) {
            warnings.push({
                field: 'fallbacks.notOfferedReply',
                severity: 'warning',
                message: 'No "Not Offered" fallback reply configured',
                canonicalKey: 'companyResponseDefaults.notOfferedReply.fullReply'
            });
        }
        
        if (effectiveConfig.fallbacks.afterHoursHasLegacyPlaceholders) {
            warnings.push({
                field: 'fallbacks.afterHoursReply',
                severity: 'warning',
                message: 'After-hours reply contains legacy placeholders. Use {{companyName}} format.',
                canonicalKey: 'companyResponseDefaults.afterHoursReply.fullReply'
            });
        }
        
        // Booking warnings
        if (effectiveConfig.booking.misconfigured) {
            warnings.push({
                field: 'booking',
                severity: 'warning',
                message: 'Booking is enabled but no slots are configured',
                canonicalKey: 'frontDeskBehavior.bookingSlots'
            });
        }
        
        // Source warnings (indicate legacy data)
        if (effectiveConfig._meta.bookingSlotsSource.includes('legacy')) {
            warnings.push({
                field: 'booking.slots',
                severity: 'info',
                message: `Booking slots read from legacy location: ${effectiveConfig._meta.bookingSlotsSource}`,
                action: 'Migrate to frontDeskBehavior.bookingSlots'
            });
        }
        
        if (effectiveConfig._meta.greetingSource.includes('legacy')) {
            warnings.push({
                field: 'greeting',
                severity: 'info',
                message: `Greeting read from legacy location: ${effectiveConfig._meta.greetingSource}`,
                action: 'Migrate to connectionMessages.voice.text'
            });
        }
        
        // Add lint warnings
        lintResults.issues.forEach(issue => {
            warnings.push({
                field: issue.field,
                severity: issue.severity,
                message: issue.message,
                rule: issue.rule
            });
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // RETURN UNIFIED RESPONSE
        // ═══════════════════════════════════════════════════════════════════════
        res.json({
            success: true,
            data: {
                companyId,
                companyName: company.companyName,
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime,
                
                // CRITICAL: This is the SINGLE SOURCE OF TRUTH
                // All systems (lint, runtime, UI) must read from effectiveConfig
                effectiveConfig,
                computed,
                
                lint: {
                    score: lintResults.score,
                    grade: lintResults.grade,
                    issuesCount: lintResults.issues.length,
                    issues: lintResults.issues
                },
                
                warnings,
                warningsCount: warnings.length,
                
                // Debug: Show where each value came from
                _sources: effectiveConfig._meta,
                
                // Auto-convergence: fields that were written back to canonical
                _convergence: {
                    enabled: autoConverge,
                    actionsPerformed: convergenceActions.length,
                    actions: convergenceActions
                },
                
                // API links
                _links: {
                    registry: '/api/control-plane/registry',
                    lint: `/api/company/${companyId}/control-plane/lint`,
                    save: `/api/company/${companyId}`,
                    migrate: `/api/company/${companyId}/control-plane/migrate`
                }
            }
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE EFFECTIVE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Calculate completeness score (0-100)
 */
function calculateCompletenessScore(config) {
    let score = 0;
    const weights = {
        greeting: 25,
        booking: 20,
        fallbacks: 20,
        personality: 15,
        escalation: 10,
        vocabulary: 10
    };
    
    // Greeting
    if (config.greeting.configured) score += weights.greeting;
    
    // Booking
    if (config.booking.slotsCount >= 3) score += weights.booking;
    else if (config.booking.slotsCount >= 1) score += weights.booking * 0.5;
    
    // Fallbacks
    if (config.fallbacks.notOfferedConfigured && config.fallbacks.unknownIntentConfigured) {
        score += weights.fallbacks;
    } else if (config.fallbacks.notOfferedConfigured || config.fallbacks.unknownIntentConfigured) {
        score += weights.fallbacks * 0.5;
    }
    
    // Personality
    if (config.personality.enabled) score += weights.personality;
    
    // Escalation
    if (config.escalation.rulesCount >= 1) score += weights.escalation;
    
    // Vocabulary
    if (config.vocabulary.forbiddenPhrasesCount >= 3) score += weights.vocabulary;
    else if (config.vocabulary.forbiddenPhrasesCount >= 1) score += weights.vocabulary * 0.5;
    
    return Math.round(score);
}

/**
 * POST /api/company/:companyId/control-plane/lint
 * Lint specific text against rules
 */
router.post('/lint', async (req, res) => {
    const { text, field } = req.body;
    
    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'text is required'
        });
    }
    
    const results = lintControlPlane({ [field || 'custom']: { raw: text } }, {});
    
    res.json({
        success: true,
        data: results
    });
});

/**
 * POST /api/company/:companyId/control-plane/migrate
 * Migrate legacy config to canonical keys
 */
router.post('/migrate', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const migrations = [];
        
        // Migrate greeting
        const legacyGreeting = company.frontDeskBehavior?.greeting;
        if (legacyGreeting && !company.connectionMessages?.voice?.text) {
            if (!company.connectionMessages) company.connectionMessages = {};
            if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
            company.connectionMessages.voice.text = migratePlaceholders(legacyGreeting);
            migrations.push({ field: 'greeting', from: 'frontDeskBehavior.greeting', to: 'connectionMessages.voice.text' });
        }
        
        // Migrate booking slots
        const legacySources = [
            { path: 'aiAgentSettings.bookingSlots', get: () => company.aiAgentSettings?.bookingSlots },
            { path: 'booking.slots', get: () => company.booking?.slots },
            { path: 'bookingSlots', get: () => company.bookingSlots }
        ];
        
        if (!company.frontDeskBehavior?.bookingSlots?.length) {
            for (const source of legacySources) {
                const slots = source.get();
                if (slots && slots.length > 0) {
                    if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
                    company.frontDeskBehavior.bookingSlots = slots;
                    migrations.push({ field: 'bookingSlots', from: source.path, to: 'frontDeskBehavior.bookingSlots' });
                    break;
                }
            }
        }
        
        // Migrate conversationStyle
        const rootConversationStyle = company.frontDeskBehavior?.conversationStyle;
        if (rootConversationStyle && !company.frontDeskBehavior?.personality?.conversationStyle) {
            if (!company.frontDeskBehavior.personality) company.frontDeskBehavior.personality = {};
            company.frontDeskBehavior.personality.conversationStyle = rootConversationStyle;
            migrations.push({ field: 'conversationStyle', from: 'frontDeskBehavior.conversationStyle', to: 'frontDeskBehavior.personality.conversationStyle' });
        }
        
        // Save if there were migrations
        if (migrations.length > 0) {
            await company.save();
        }
        
        res.json({
            success: true,
            data: {
                migrationsApplied: migrations.length,
                migrations
            }
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE MIGRATE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/control-plane/seed-booking-slots
 * Seed default HVAC booking slots if empty
 */
router.post('/seed-booking-slots', async (req, res) => {
    const { companyId } = req.params;
    const { force = false } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Check if slots already exist
        const existingSlots = company.frontDeskBehavior?.bookingSlots || [];
        
        if (existingSlots.length > 0 && !force) {
            return res.status(400).json({
                success: false,
                error: `Company already has ${existingSlots.length} booking slots. Use force=true to overwrite.`,
                existingSlots: existingSlots.map(s => s.key)
            });
        }
        
        // Import default slots from configUnifier
        const { DEFAULT_HVAC_BOOKING_SLOTS } = require('../../utils/configUnifier');
        
        // Initialize frontDeskBehavior if needed
        if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
        
        // Set default slots
        company.frontDeskBehavior.bookingSlots = DEFAULT_HVAC_BOOKING_SLOTS;
        company.frontDeskBehavior.bookingEnabled = true;
        
        await company.save();
        
        logger.info(`[CONTROL PLANE] Seeded ${DEFAULT_HVAC_BOOKING_SLOTS.length} booking slots for company ${companyId}`);
        
        res.json({
            success: true,
            data: {
                slotsSeeded: DEFAULT_HVAC_BOOKING_SLOTS.length,
                slotNames: DEFAULT_HVAC_BOOKING_SLOTS.map(s => s.key),
                message: 'Default HVAC booking slots seeded successfully'
            }
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE SEED SLOTS] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PATCH /api/company/:companyId/control-plane/save
 * Save control plane config with auto-placeholder migration
 */
router.patch('/save', async (req, res) => {
    const { companyId } = req.params;
    const { greeting, fallbacks } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const changes = [];
        
        // Update greeting with placeholder migration
        if (greeting !== undefined) {
            const migratedGreeting = migratePlaceholders(greeting);
            
            if (!company.connectionMessages) company.connectionMessages = {};
            if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
            company.connectionMessages.voice.text = migratedGreeting;
            
            changes.push({
                field: 'greeting',
                canonicalKey: 'connectionMessages.voice.text',
                original: greeting,
                migrated: migratedGreeting,
                wasMigrated: greeting !== migratedGreeting
            });
        }
        
        // Update fallbacks via CompanyResponseDefaults
        if (fallbacks) {
            const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
            const defaults = await CompanyResponseDefaults.getOrCreate(companyId);
            
            if (fallbacks.notOfferedReply !== undefined) {
                const migrated = migratePlaceholders(fallbacks.notOfferedReply);
                defaults.notOfferedReply = { fullReply: migrated };
                changes.push({
                    field: 'notOfferedReply',
                    canonicalKey: 'companyResponseDefaults.notOfferedReply.fullReply',
                    original: fallbacks.notOfferedReply,
                    migrated,
                    wasMigrated: fallbacks.notOfferedReply !== migrated
                });
            }
            
            if (fallbacks.unknownIntentReply !== undefined) {
                const migrated = migratePlaceholders(fallbacks.unknownIntentReply);
                defaults.unknownIntentReply = { fullReply: migrated };
                changes.push({
                    field: 'unknownIntentReply',
                    canonicalKey: 'companyResponseDefaults.unknownIntentReply.fullReply',
                    original: fallbacks.unknownIntentReply,
                    migrated,
                    wasMigrated: fallbacks.unknownIntentReply !== migrated
                });
            }
            
            if (fallbacks.afterHoursReply !== undefined) {
                const migrated = migratePlaceholders(fallbacks.afterHoursReply);
                defaults.afterHoursReply = { fullReply: migrated };
                changes.push({
                    field: 'afterHoursReply',
                    canonicalKey: 'companyResponseDefaults.afterHoursReply.fullReply',
                    original: fallbacks.afterHoursReply,
                    migrated,
                    wasMigrated: fallbacks.afterHoursReply !== migrated
                });
            }
            
            await defaults.save();
        }
        
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        logger.info(`[CONTROL PLANE SAVE] Saved ${changes.length} fields for company ${companyId}`);
        
        res.json({
            success: true,
            data: {
                changesApplied: changes.length,
                changes,
                placeholdersMigrated: changes.filter(c => c.wasMigrated).length
            }
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE SAVE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

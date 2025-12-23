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
 * - Greeting: connectionMessages.voice.text (+ .realtime.text)
 * - Booking: frontDeskBehavior.booking.enabled + frontDeskBehavior.bookingSlots
 * - Loop Prevention: frontDeskBehavior.loopPrevention.* (NOT .loops.*)
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
const goldenBlueprint = require('../../utils/goldenBlueprintValidator');
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
router.get('/effective', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const autoConverge = req.query.converge !== 'false'; // Default: converge
    
    try {
        // Load company
        // Use lean() for read-only performance unless we need to converge
        const useLean = !autoConverge || req.query.readonly === 'true';
        
        const [company, responseDefaults, placeholdersDoc] = await Promise.all([
            useLean 
                ? v2Company.findById(companyId).lean()
                : v2Company.findById(companyId),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // For lean queries, we can't save, so skip convergence
        const canConverge = autoConverge && !useLean && typeof company.save === 'function';
        
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
        // For lean queries, company is already a plain object
        // For non-lean, we need to convert to object
        const companyObj = useLean ? company : company.toObject();
        
        const effectiveConfig = unifyConfig(companyObj, responseDefaults, {
            seedBookingSlotsIfEmpty: false // Don't auto-seed, show warning instead
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // AUTO-CONVERGENCE: Write back to canonical if using legacy sources
        // This ensures future reads don't need legacy fallback
        // ═══════════════════════════════════════════════════════════════════════
        const convergenceActions = [];
        
        if (canConverge) {
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
            // WRAPPED IN TRY-CATCH: Don't let validation errors break the entire endpoint
            if (convergenceActions.length > 0) {
                try {
                    await company.save();
                    
                    // Clear Redis cache
                    const { redisClient } = require('../../db');
                    if (redisClient && redisClient.isOpen) {
                        await redisClient.del(`company:${companyId}`);
                    }
                    
                    logger.info(`[CONTROL PLANE] Auto-converged ${convergenceActions.length} fields for company ${companyId}`);
                } catch (saveError) {
                    // Log the error but DON'T fail the entire request
                    // The company document might have legacy data that fails validation
                    logger.warn(`[CONTROL PLANE] Auto-convergence save failed for ${companyId}: ${saveError.message}`);
                    logger.warn(`[CONTROL PLANE] Effective config will still be returned, but convergence was not persisted`);
                    convergenceActions.push({
                        field: '_CONVERGENCE_FAILED',
                        error: saveError.message.substring(0, 500),
                        note: 'Document has legacy data that fails current schema validation. Fix manually.'
                    });
                }
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
 * GET /api/company/:companyId/control-plane/raw
 * Returns RAW company document sections for debugging
 * 
 * This shows EXACTLY what's in the DB, no resolution/fallback
 * Use this to diagnose where data is actually stored
 */
router.get('/raw', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Build diagnosis first
        const diagnosis = {
            bookingSlotsLocation: 
                (company.aiAgentSettings?.frontDeskBehavior?.bookingSlots?.length > 0) ? 'aiAgentSettings.frontDeskBehavior.bookingSlots' :
                (company.frontDeskBehavior?.bookingSlots?.length > 0) ? 'frontDeskBehavior.bookingSlots' :
                (company.aiAgentSettings?.bookingSlots?.length > 0) ? 'aiAgentSettings.bookingSlots (flat legacy)' :
                (company.booking?.slots?.length > 0) ? 'booking.slots (legacy)' :
                (company.bookingSlots?.length > 0) ? 'bookingSlots (root legacy)' : 'NONE FOUND',
                
            greetingLocation:
                (company.connectionMessages?.voice?.text) ? 'connectionMessages.voice.text' :
                (company.frontDeskBehavior?.greeting) ? 'frontDeskBehavior.greeting' :
                (company.aiAgentSettings?.frontDeskBehavior?.greeting) ? 'aiAgentSettings.frontDeskBehavior.greeting' : 'NONE FOUND',
                
            personalityLocation:
                (company.aiAgentSettings?.frontDeskBehavior?.personality) ? 'aiAgentSettings.frontDeskBehavior.personality' :
                (company.frontDeskBehavior?.personality) ? 'frontDeskBehavior.personality' : 'NONE FOUND',
                
            needsMigration: 
                (company.aiAgentSettings?.frontDeskBehavior?.bookingSlots?.length > 0 && !company.frontDeskBehavior?.bookingSlots?.length) ||
                (company.aiAgentSettings?.frontDeskBehavior?.personality && !company.frontDeskBehavior?.personality)
        };
        
        // Return structure that matches what UI expects
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            
            // ═══════════════════════════════════════════════════════════════════
            // DATA WRAPPER - UI expects rawData.data.company
            // ═══════════════════════════════════════════════════════════════════
            data: {
                company: {
                    _id: company._id,
                    companyName: company.companyName,
                    frontDeskBehavior: company.frontDeskBehavior || null,
                    aiAgentSettings: company.aiAgentSettings || null,
                    connectionMessages: company.connectionMessages || null,
                    booking: company.booking || null,
                    bookingSlots: company.bookingSlots || null,
                    companyResponseDefaults: company.companyResponseDefaults || null,
                    placeholders: company.placeholders || null,
                    tradeKey: company.tradeKey || null,
                    tradeCategoryId: company.tradeCategoryId || null
                },
                
                // ALL raw paths for deep debugging
                rawPaths: {
                    'frontDeskBehavior': company.frontDeskBehavior || null,
                    'aiAgentSettings': company.aiAgentSettings || null,
                    'aiAgentSettings.frontDeskBehavior': company.aiAgentSettings?.frontDeskBehavior || null,
                    'frontDeskBehavior.bookingSlots': company.frontDeskBehavior?.bookingSlots || null,
                    'aiAgentSettings.frontDeskBehavior.bookingSlots': company.aiAgentSettings?.frontDeskBehavior?.bookingSlots || null,
                    'aiAgentSettings.bookingSlots': company.aiAgentSettings?.bookingSlots || null,
                    'booking.slots': company.booking?.slots || null,
                    'bookingSlots': company.bookingSlots || null,
                    'frontDeskBehavior.personality': company.frontDeskBehavior?.personality || null,
                    'aiAgentSettings.frontDeskBehavior.personality': company.aiAgentSettings?.frontDeskBehavior?.personality || null,
                    'connectionMessages': company.connectionMessages || null,
                    'connectionMessages.voice.text': company.connectionMessages?.voice?.text || null,
                    'frontDeskBehavior.greeting': company.frontDeskBehavior?.greeting || null,
                    'aiAgentSettings.frontDeskBehavior.greeting': company.aiAgentSettings?.frontDeskBehavior?.greeting || null,
                    'companyResponseDefaults': company.companyResponseDefaults || null
                },
                
                diagnosis
            },
            
            // Quick diagnosis at top level for convenience
            diagnosis,
            
            _note: 'This shows RAW DB paths. Use this to verify where Effective/ControlPlane should read from.'
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE] Raw config error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
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
        
        // Set default slots (CANONICAL paths)
        company.frontDeskBehavior.bookingSlots = DEFAULT_HVAC_BOOKING_SLOTS;
        if (!company.frontDeskBehavior.booking) company.frontDeskBehavior.booking = {};
        company.frontDeskBehavior.booking.enabled = true;
        
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
 * Writes to MULTIPLE paths for consistency
 */
router.patch('/save', async (req, res) => {
    const { companyId } = req.params;
    const { greeting, fallbacks, mirrorToRealtime } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const changes = [];
        const writtenTo = []; // Track all paths written
        
        // Update greeting with placeholder migration
        // WRITES TO MULTIPLE PATHS for consistency
        if (greeting !== undefined) {
            const migratedGreeting = migratePlaceholders(greeting);
            
            // PRIMARY: connectionMessages.voice.text
            if (!company.connectionMessages) company.connectionMessages = {};
            if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
            company.connectionMessages.voice.text = migratedGreeting;
            writtenTo.push('connectionMessages.voice.text');
            
            // SECONDARY: connectionMessages.voice.realtime.text (for realtime API)
            if (mirrorToRealtime !== false) {
                if (!company.connectionMessages.voice.realtime) {
                    company.connectionMessages.voice.realtime = {};
                }
                company.connectionMessages.voice.realtime.text = migratedGreeting;
                writtenTo.push('connectionMessages.voice.realtime.text');
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // CLEAR LEGACY PATHS (CRITICAL - prevents overwrite during snapshot read)
            // The snapshot provider checks canonical paths FIRST now, but we still
            // clear legacy to prevent confusion and ensure single source of truth.
            // ═══════════════════════════════════════════════════════════════════════
            const clearedLegacy = [];
            
            // CLEAR: frontDeskBehavior.greeting (was winning over canonical!)
            if (company.frontDeskBehavior?.greeting) {
                company.frontDeskBehavior.greeting = null;
                clearedLegacy.push('frontDeskBehavior.greeting');
            }
            
            // CLEAR: callFlowEngine.style.greeting
            if (company.callFlowEngine?.style?.greeting) {
                company.callFlowEngine.style.greeting = null;
                clearedLegacy.push('callFlowEngine.style.greeting');
            }
            
            // CLEAR: aiAgentSettings.greeting
            if (company.aiAgentSettings?.greeting) {
                company.aiAgentSettings.greeting = null;
                clearedLegacy.push('aiAgentSettings.greeting');
            }
            
            // CLEAR: aiAgentSettings.frontDeskBehavior.greeting
            if (company.aiAgentSettings?.frontDeskBehavior?.greeting) {
                company.aiAgentSettings.frontDeskBehavior.greeting = null;
                clearedLegacy.push('aiAgentSettings.frontDeskBehavior.greeting');
            }
            
            changes.push({
                field: 'greeting',
                canonicalKey: 'connectionMessages.voice.text',
                original: greeting,
                migrated: migratedGreeting,
                wasMigrated: greeting !== migratedGreeting,
                writtenTo,
                clearedLegacy: clearedLegacy.length > 0 ? clearedLegacy : undefined
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
        
        logger.info(`[CONTROL PLANE SAVE] Saved ${changes.length} fields for company ${companyId}, paths: ${writtenTo.join(', ')}`);
        
        res.json({
            success: true,
            writtenTo, // All paths that were written to
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

/**
 * ============================================================================
 * GET /api/company/:companyId/control-plane/effective-greeting
 * DEBUG ENDPOINT: Show EXACTLY what greeting runtime will speak
 * ============================================================================
 * 
 * This endpoint reads directly from DB and shows:
 * - Which path was resolved
 * - The raw stored value
 * - The rendered value (after placeholder substitution)
 * 
 * USE THIS TO DEBUG "greeting not sticking" issues.
 */
router.get('/effective-greeting', async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Get placeholders for rendering
        const Placeholder = require('../../models/Placeholder');
        const placeholders = await Placeholder.find({ companyId }).lean();
        const placeholderMap = {};
        placeholders.forEach(p => {
            placeholderMap[p.key] = p.value;
        });
        placeholderMap.companyName = placeholderMap.companyName || company.companyName || 'Company';
        
        // ═══════════════════════════════════════════════════════════════════════════
        // READ ALL POSSIBLE GREETING LOCATIONS (SAME ORDER AS SNAPSHOT PROVIDER)
        // ═══════════════════════════════════════════════════════════════════════════
        const locations = {
            'connectionMessages.voice.text': company.connectionMessages?.voice?.text || null,
            'connectionMessages.voice.realtime.text': company.connectionMessages?.voice?.realtime?.text || null,
            'frontDeskBehavior.greeting': company.frontDeskBehavior?.greeting || null,
            'aiAgentSettings.frontDeskBehavior.greeting': company.aiAgentSettings?.frontDeskBehavior?.greeting || null,
            'aiAgentSettings.greeting': company.aiAgentSettings?.greeting || null,
            'callFlowEngine.style.greeting': company.callFlowEngine?.style?.greeting || null
        };
        
        // ═══════════════════════════════════════════════════════════════════════════
        // RESOLVE GREETING (SAME LOGIC AS controlPlane.snapshot.js)
        // CANONICAL: connectionMessages.voice.text wins
        // ═══════════════════════════════════════════════════════════════════════════
        let resolvedPath = null;
        let rawValue = null;
        let source = 'none';
        
        if (company.connectionMessages?.voice?.text?.trim().length > 0) {
            resolvedPath = 'connectionMessages.voice.text';
            rawValue = company.connectionMessages.voice.text.trim();
            source = 'connectionMessages.voice (CANONICAL)';
        } else if (company.connectionMessages?.voice?.realtime?.text?.trim().length > 0) {
            resolvedPath = 'connectionMessages.voice.realtime.text';
            rawValue = company.connectionMessages.voice.realtime.text.trim();
            source = 'connectionMessages.voice.realtime (CANONICAL FALLBACK)';
        } else if (company.frontDeskBehavior?.greeting?.trim?.().length > 0) {
            resolvedPath = 'frontDeskBehavior.greeting';
            rawValue = company.frontDeskBehavior.greeting.trim();
            source = 'frontDeskBehavior (LEGACY)';
        } else if (company.aiAgentSettings?.frontDeskBehavior?.greeting?.trim?.().length > 0) {
            resolvedPath = 'aiAgentSettings.frontDeskBehavior.greeting';
            rawValue = company.aiAgentSettings.frontDeskBehavior.greeting.trim();
            source = 'aiAgentSettings.frontDeskBehavior (LEGACY)';
        }
        
        // Render placeholders
        const { substitutePlaceholders } = require('../../utils/placeholderStandard');
        const renderedValue = rawValue ? substitutePlaceholders(rawValue, placeholderMap) : null;
        
        // Realtime values (separate check)
        const rawRealtimeValue = company.connectionMessages?.voice?.realtime?.text || null;
        const renderedRealtimeValue = rawRealtimeValue ? substitutePlaceholders(rawRealtimeValue, placeholderMap) : null;
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            
            // RESOLVED GREETING (what runtime uses)
            source,
            resolvedPath,
            rawValue,
            renderedValue,
            
            // Realtime (for TTS fallback)
            isUsingRealtime: resolvedPath === 'connectionMessages.voice.realtime.text',
            realtimePath: 'connectionMessages.voice.realtime.text',
            rawRealtimeValue,
            renderedRealtimeValue,
            
            // ALL LOCATIONS (for debugging)
            allLocations: locations,
            
            // Placeholders used
            placeholdersAvailable: Object.keys(placeholderMap),
            
            // Metadata
            generatedAt: new Date().toISOString(),
            generatedInMs: Date.now() - startTime,
            
            // DIAGNOSTIC
            diagnostic: {
                canonicalHasValue: !!company.connectionMessages?.voice?.text?.trim(),
                legacyHasValue: !!company.frontDeskBehavior?.greeting?.trim?.(),
                legacyOverrideRisk: !!company.frontDeskBehavior?.greeting?.trim?.() && !company.connectionMessages?.voice?.text?.trim(),
                recommendation: !company.connectionMessages?.voice?.text?.trim() 
                    ? 'SAVE GREETING to connectionMessages.voice.text to fix!' 
                    : 'Canonical path is set correctly ✓'
            }
        });
        
    } catch (error) {
        logger.error('[EFFECTIVE-GREETING] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * ============================================================================
 * PUT /api/company/:companyId/control-plane/greeting
 * HARD SAVE: Write greeting to CANONICAL paths only, clear legacy
 * ============================================================================
 * 
 * This endpoint:
 * 1. Writes ONLY to canonical paths (connectionMessages.voice.text/realtime.text)
 * 2. CLEARS all legacy paths (frontDeskBehavior.greeting, etc.)
 * 3. Returns verification of what was written
 * 
 * USE THIS when greeting "isn't sticking" - it's a surgical fix.
 */
router.put('/greeting', async (req, res) => {
    const { companyId } = req.params;
    const { text, realtimeText } = req.body;
    
    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'text field is required'
        });
    }
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const before = {
            'connectionMessages.voice.text': company.connectionMessages?.voice?.text || null,
            'connectionMessages.voice.realtime.text': company.connectionMessages?.voice?.realtime?.text || null,
            'frontDeskBehavior.greeting': company.frontDeskBehavior?.greeting || null,
            'aiAgentSettings.greeting': company.aiAgentSettings?.greeting || null
        };
        
        // Migrate placeholders
        const migratedText = migratePlaceholders(text);
        const migratedRealtimeText = migratePlaceholders(realtimeText || text);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // 1. WRITE TO CANONICAL PATHS ONLY
        // ═══════════════════════════════════════════════════════════════════════════
        if (!company.connectionMessages) company.connectionMessages = {};
        if (!company.connectionMessages.voice) company.connectionMessages.voice = {};
        if (!company.connectionMessages.voice.realtime) company.connectionMessages.voice.realtime = {};
        
        company.connectionMessages.voice.text = migratedText;
        company.connectionMessages.voice.realtime.text = migratedRealtimeText;
        
        const writtenTo = [
            'connectionMessages.voice.text',
            'connectionMessages.voice.realtime.text'
        ];
        
        // ═══════════════════════════════════════════════════════════════════════════
        // 2. CLEAR ALL LEGACY PATHS (CRITICAL - prevents override)
        // ═══════════════════════════════════════════════════════════════════════════
        const clearedLegacy = [];
        
        if (company.frontDeskBehavior?.greeting) {
            company.frontDeskBehavior.greeting = null;
            clearedLegacy.push('frontDeskBehavior.greeting');
        }
        
        if (company.aiAgentSettings?.greeting) {
            company.aiAgentSettings.greeting = null;
            clearedLegacy.push('aiAgentSettings.greeting');
        }
        
        if (company.aiAgentSettings?.frontDeskBehavior?.greeting) {
            company.aiAgentSettings.frontDeskBehavior.greeting = null;
            clearedLegacy.push('aiAgentSettings.frontDeskBehavior.greeting');
        }
        
        if (company.callFlowEngine?.style?.greeting) {
            company.callFlowEngine.style.greeting = null;
            clearedLegacy.push('callFlowEngine.style.greeting');
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // 3. SAVE
        // ═══════════════════════════════════════════════════════════════════════════
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // 4. VERIFY (re-read)
        // ═══════════════════════════════════════════════════════════════════════════
        const verified = await v2Company.findById(companyId).lean();
        
        const after = {
            'connectionMessages.voice.text': verified.connectionMessages?.voice?.text || null,
            'connectionMessages.voice.realtime.text': verified.connectionMessages?.voice?.realtime?.text || null,
            'frontDeskBehavior.greeting': verified.frontDeskBehavior?.greeting || null,
            'aiAgentSettings.greeting': verified.aiAgentSettings?.greeting || null
        };
        
        logger.info(`[GREETING HARD SAVE] Company ${companyId}: "${migratedText}"`);
        
        res.json({
            success: true,
            companyId,
            
            // What was requested
            requested: { text, realtimeText },
            
            // What was written (after placeholder migration)
            written: {
                text: migratedText,
                realtimeText: migratedRealtimeText,
                placeholdersMigrated: text !== migratedText || (realtimeText && realtimeText !== migratedRealtimeText)
            },
            
            // Paths written to
            writtenTo,
            
            // Legacy paths cleared
            clearedLegacy,
            
            // Before/After comparison
            before,
            after,
            
            // Verification
            verified: after['connectionMessages.voice.text'] === migratedText
        });
        
    } catch (error) {
        logger.error('[GREETING HARD SAVE] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/control-plane/fix-conflict
 * Auto-fix known config conflicts
 */
router.post('/fix-conflict', async (req, res) => {
    const { companyId } = req.params;
    const { conflictCode, fixAction } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const fixes = [];
        
        switch (conflictCode) {
            case 'BOOKING_ENGINE_CONFLICT':
                // Fix: Use frontDeskBehavior.bookingSlots as canonical, ignore callFlowEngine
                if (fixAction === 'fix_booking_conflict') {
                    // If frontDeskBehavior.bookingSlots is empty but callFlowEngine.bookingFields exists,
                    // migrate the fields
                    const callFlowFields = company.callFlowEngine?.bookingFields || [];
                    const fdSlots = company.aiAgentSettings?.frontDeskBehavior?.bookingSlots || 
                                   company.frontDeskBehavior?.bookingSlots || [];
                    
                    if (fdSlots.length === 0 && callFlowFields.length > 0) {
                        // Migrate from callFlowEngine to frontDeskBehavior
                        const migratedSlots = callFlowFields.map(f => ({
                            key: f.name || f.key || f,
                            label: f.label || f.name || f,
                            required: f.required !== false,
                            type: 'text'
                        }));
                        
                        if (!company.frontDeskBehavior) company.frontDeskBehavior = {};
                        company.frontDeskBehavior.bookingSlots = migratedSlots;
                        
                        // Also update aiAgentSettings for consistency
                        if (!company.aiAgentSettings) company.aiAgentSettings = {};
                        if (!company.aiAgentSettings.frontDeskBehavior) company.aiAgentSettings.frontDeskBehavior = {};
                        company.aiAgentSettings.frontDeskBehavior.bookingSlots = migratedSlots;
                        
                        fixes.push(`Migrated ${migratedSlots.length} booking fields to frontDeskBehavior.bookingSlots`);
                    }
                    
                    // Mark callFlowEngine as deprecated source
                    if (!company._meta) company._meta = {};
                    company._meta.bookingEngineMode = 'SLOTS';
                    company._meta.bookingConflictResolved = new Date().toISOString();
                    
                    fixes.push('Set booking engine mode to SLOTS');
                }
                break;
                
            case 'SCENARIOS_BLOCKED':
                // Fix: Enable scenario auto-responses
                if (fixAction === 'fix_consent_blocking') {
                    if (!company.aiAgentSettings) company.aiAgentSettings = {};
                    if (!company.aiAgentSettings.discoveryConsent) company.aiAgentSettings.discoveryConsent = {};
                    
                    company.aiAgentSettings.discoveryConsent.disableScenarioAutoResponses = false;
                    company.aiAgentSettings.discoveryConsent.forceLLMDiscovery = false;
                    
                    fixes.push('Enabled scenario auto-responses');
                    fixes.push('Disabled forceLLMDiscovery');
                }
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: `Unknown conflict code: ${conflictCode}`
                });
        }
        
        if (fixes.length === 0) {
            return res.json({
                success: true,
                message: 'No fixes needed',
                fixes: []
            });
        }
        
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        logger.info(`[CONTROL PLANE FIX] Fixed ${conflictCode} for company ${companyId}: ${fixes.join(', ')}`);
        
        res.json({
            success: true,
            message: `Fixed ${conflictCode}`,
            fixes
        });
        
    } catch (error) {
        logger.error('[CONTROL PLANE FIX] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/control-plane/legacy-report
 * Detect legacy keys that are not in the Golden Blueprint
 */
router.get('/legacy-report', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Validate against Golden Blueprint
        const validation = goldenBlueprint.validateConfig(company);
        
        // Get golden defaults for comparison
        const goldenDefaults = goldenBlueprint.getGoldenDefaults();
        
        res.json({
            success: true,
            data: {
                blueprintVersion: goldenBlueprint.getVersion(),
                companyId,
                companyName: company.name || company.profile?.name,
                
                // Summary
                health: validation.health,
                recommendation: validation.recommendation,
                
                // Counts
                totalKeys: validation.totalKeys,
                allowedCount: validation.allowedCount,
                legacyCount: validation.legacyCount,
                nukeEligibleCount: validation.nukeEligibleCount,
                
                // Details
                legacyKeys: validation.legacyKeys,
                deprecatedKeys: validation.deprecatedKeys,
                nukeEligible: validation.nukeEligible,
                warnings: validation.warnings,
                
                // Reference
                goldenDefaults
            }
        });
        
    } catch (error) {
        logger.error('[LEGACY REPORT] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/control-plane/nuke-legacy
 * Delete legacy keys that are safe to remove
 */
router.post('/nuke-legacy', async (req, res) => {
    const { companyId } = req.params;
    const { dryRun = true, confirmNuke = false } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Get nukeable keys
        const nukeableKeys = goldenBlueprint.getNukeableKeys(company.toObject());
        
        if (nukeableKeys.length === 0) {
            return res.json({
                success: true,
                message: 'No legacy keys to nuke - config is clean!',
                nuked: [],
                dryRun
            });
        }
        
        // If dry run, just return what would be deleted
        if (dryRun || !confirmNuke) {
            return res.json({
                success: true,
                dryRun: true,
                message: `Found ${nukeableKeys.length} keys that can be safely deleted`,
                wouldDelete: nukeableKeys,
                instruction: 'Set confirmNuke=true and dryRun=false to actually delete'
            });
        }
        
        // Actually delete the keys
        const nukedKeys = [];
        
        for (const keyPath of nukeableKeys) {
            const parts = keyPath.split('.');
            let obj = company;
            
            // Navigate to parent
            for (let i = 0; i < parts.length - 1; i++) {
                if (obj && obj[parts[i]]) {
                    obj = obj[parts[i]];
                } else {
                    obj = null;
                    break;
                }
            }
            
            // Delete the key using unset
            if (obj) {
                const lastKey = parts[parts.length - 1];
                if (obj[lastKey] !== undefined) {
                    obj[lastKey] = undefined;
                    nukedKeys.push(keyPath);
                }
            }
        }
        
        // Handle top-level deprecated namespaces
        if (company.variables) {
            delete company.variables;
            nukedKeys.push('variables');
        }
        
        if (company.callFlowEngine?.bookingFields) {
            delete company.callFlowEngine.bookingFields;
            nukedKeys.push('callFlowEngine.bookingFields');
        }
        
        // Save changes
        await company.save();
        
        // Clear Redis cache
        const { redisClient } = require('../../db');
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
        }
        
        logger.info(`[NUKE LEGACY] Deleted ${nukedKeys.length} legacy keys for company ${companyId}: ${nukedKeys.join(', ')}`);
        
        res.json({
            success: true,
            dryRun: false,
            message: `Successfully nuked ${nukedKeys.length} legacy keys`,
            nuked: nukedKeys
        });
        
    } catch (error) {
        logger.error('[NUKE LEGACY] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/control-plane/migrate-variables
 * Migrate legacy variables.* to placeholders.*
 */
router.post('/migrate-variables', async (req, res) => {
    const { companyId } = req.params;
    const { dryRun = true } = req.body;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Check for legacy variables
        const legacyVariables = company.variables || 
                               company.aiAgentSettings?.variables ||
                               company.aiAgentLogic?.variables || {};
        
        if (Object.keys(legacyVariables).length === 0) {
            return res.json({
                success: true,
                message: 'No legacy variables to migrate',
                migrated: []
            });
        }
        
        // Get or create placeholders
        let placeholders = await CompanyPlaceholders.findOne({ companyId });
        if (!placeholders) {
            placeholders = new CompanyPlaceholders({ companyId, placeholders: [] });
        }
        
        const migrated = [];
        
        // Migrate each variable to placeholder
        for (const [key, value] of Object.entries(legacyVariables)) {
            // Normalize key (lowercase → camelCase canonical)
            const canonicalKey = key.charAt(0).toLowerCase() + key.slice(1);
            
            // Check if placeholder already exists
            const existing = placeholders.placeholders.find(p => 
                p.key.toLowerCase() === canonicalKey.toLowerCase()
            );
            
            if (!existing && !dryRun) {
                placeholders.placeholders.push({
                    key: canonicalKey,
                    value: value,
                    isSystem: false,
                    migratedFrom: `variables.${key}`,
                    migratedAt: new Date()
                });
            }
            
            migrated.push({
                from: `variables.${key}`,
                to: `placeholders.${canonicalKey}`,
                value,
                alreadyExists: !!existing
            });
        }
        
        if (!dryRun) {
            await placeholders.save();
            
            // Delete legacy variables
            if (company.variables) delete company.variables;
            if (company.aiAgentSettings?.variables) delete company.aiAgentSettings.variables;
            if (company.aiAgentLogic?.variables) delete company.aiAgentLogic.variables;
            
            await company.save();
            
            // Clear cache
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
                await redisClient.del(`placeholders:${companyId}`);
            }
        }
        
        logger.info(`[MIGRATE VARIABLES] ${dryRun ? 'Would migrate' : 'Migrated'} ${migrated.length} variables for company ${companyId}`);
        
        res.json({
            success: true,
            dryRun,
            message: `${dryRun ? 'Would migrate' : 'Migrated'} ${migrated.length} variables to placeholders`,
            migrated
        });
        
    } catch (error) {
        logger.error('[MIGRATE VARIABLES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

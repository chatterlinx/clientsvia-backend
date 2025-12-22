/**
 * ============================================================================
 * CONTROL PLANE EFFECTIVE CONFIG - Runtime-Merged Configuration
 * ============================================================================
 * 
 * PURPOSE: Returns the exact values the runtime uses (after defaults + overrides)
 * 
 * INCLUDES:
 * - Merged final config
 * - Computed performance metrics
 * - Warnings and lint results
 * - Word counts, TTS estimates
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const v2Company = require('../../models/v2Company');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { lintControlPlane, LINT_RULES } = require('../../utils/controlPlaneLinter');
const { substitutePlaceholders } = require('../../utils/placeholderStandard');
const logger = require('../../utils/logger');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/control-plane/effective
 * Returns the merged final config used at runtime
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        // Load all relevant data
        const [company, responseDefaults, placeholdersDoc] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Build placeholder map for substitution
        const placeholderMap = {};
        (placeholdersDoc?.placeholders || []).forEach(p => {
            placeholderMap[p.key] = p.value;
        });
        // Add system placeholders
        placeholderMap.companyName = company.companyName;
        placeholderMap.companyPhone = company.companyPhone || company.phoneNumber;
        
        // Extract effective greeting (check multiple locations)
        const greetingText = 
            company.connectionMessages?.voice?.text ||
            company.connectionMessages?.voice?.realtime?.text ||
            company.frontDeskBehavior?.greeting ||
            '';
        
        // Substitute placeholders in greeting for preview
        const greetingPreview = substitutePlaceholders(greetingText, placeholderMap);
        
        // Extract effective config from various locations
        const effectiveConfig = {
            // ═══════════════════════════════════════════════════════════════════
            // GREETING
            // ═══════════════════════════════════════════════════════════════════
            greeting: {
                raw: greetingText,
                preview: greetingPreview,
                source: company.connectionMessages?.voice?.text ? 'connectionMessages.voice.text' :
                        company.connectionMessages?.voice?.realtime?.text ? 'connectionMessages.voice.realtime.text' :
                        company.frontDeskBehavior?.greeting ? 'frontDeskBehavior.greeting' : 'none',
                configured: !!greetingText
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // PERSONALITY
            // ═══════════════════════════════════════════════════════════════════
            personality: {
                enabled: company.frontDeskBehavior?.personality?.enabled ?? true,
                professionalismLevel: company.frontDeskBehavior?.personality?.professionalismLevel ?? 7,
                empathyLevel: company.frontDeskBehavior?.personality?.empathyLevel ?? 8,
                urgencyDetection: company.frontDeskBehavior?.personality?.urgencyDetection ?? true,
                conversationStyle: company.frontDeskBehavior?.conversationStyle ?? 'balanced'
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING
            // ═══════════════════════════════════════════════════════════════════
            booking: {
                enabled: company.frontDeskBehavior?.bookingEnabled ?? true,
                slots: company.frontDeskBehavior?.bookingSlots || [],
                slotsCount: (company.frontDeskBehavior?.bookingSlots || []).length,
                slotNames: (company.frontDeskBehavior?.bookingSlots || []).map(s => s.key)
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // VOCABULARY & POLICIES
            // ═══════════════════════════════════════════════════════════════════
            vocabulary: {
                forbiddenPhrases: company.frontDeskBehavior?.vocabulary?.forbiddenPhrases || [],
                forbiddenPhrasesCount: (company.frontDeskBehavior?.vocabulary?.forbiddenPhrases || []).length,
                preferredTerms: company.frontDeskBehavior?.vocabulary?.preferredTerms || {}
            },
            
            policies: {
                blockPricing: company.frontDeskBehavior?.policies?.blockPricing ?? true,
                blockCompetitorMention: company.frontDeskBehavior?.policies?.blockCompetitorMention ?? true,
                forbiddenTopics: company.frontDeskBehavior?.policies?.forbiddenTopics || []
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // ESCALATION
            // ═══════════════════════════════════════════════════════════════════
            escalation: {
                rules: company.frontDeskBehavior?.escalation?.rules || [],
                rulesCount: (company.frontDeskBehavior?.escalation?.rules || []).length,
                frustrationEnabled: company.frontDeskBehavior?.frustration?.enabled ?? true,
                frustrationThreshold: company.frontDeskBehavior?.frustration?.threshold ?? 3
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // FALLBACK RESPONSES
            // ═══════════════════════════════════════════════════════════════════
            fallbacks: {
                notOfferedReply: responseDefaults?.notOfferedReply?.fullReply || '',
                notOfferedConfigured: !!responseDefaults?.notOfferedReply?.fullReply,
                unknownIntentReply: responseDefaults?.unknownIntentReply?.fullReply || '',
                unknownIntentConfigured: !!responseDefaults?.unknownIntentReply?.fullReply,
                afterHoursReply: responseDefaults?.afterHoursReply?.fullReply || '',
                afterHoursConfigured: !!responseDefaults?.afterHoursReply?.fullReply
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // DETECTION
            // ═══════════════════════════════════════════════════════════════════
            detection: {
                minConfidence: company.frontDeskBehavior?.detection?.minConfidence ?? 0.5,
                fallbackBehavior: company.frontDeskBehavior?.detection?.fallbackBehavior ?? 'ask_clarification'
            },
            
            // ═══════════════════════════════════════════════════════════════════
            // MODES
            // ═══════════════════════════════════════════════════════════════════
            modes: {
                startMode: company.frontDeskBehavior?.modes?.startMode ?? 'DISCOVERY',
                autoTransitionToBooking: company.frontDeskBehavior?.modes?.autoTransitionToBooking ?? true
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // COMPUTED PERFORMANCE METRICS
        // ═══════════════════════════════════════════════════════════════════════
        const greetingWords = greetingPreview ? greetingPreview.split(/\s+/).filter(w => w.length > 0).length : 0;
        const greetingChars = greetingPreview ? greetingPreview.length : 0;
        
        // TTS estimate: ~150 words per minute for natural speech
        const ttsWordsPerSecond = 2.5;
        const greetingEstimatedSeconds = greetingWords / ttsWordsPerSecond;
        
        const computed = {
            performance: {
                greetingWordCount: greetingWords,
                greetingCharCount: greetingChars,
                greetingEstimatedSeconds: Math.round(greetingEstimatedSeconds * 10) / 10,
                greetingTTSRating: greetingEstimatedSeconds <= 2.5 ? 'GOOD' : 
                                   greetingEstimatedSeconds <= 4 ? 'ACCEPTABLE' : 'TOO_LONG',
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
        // RUN LINTER
        // ═══════════════════════════════════════════════════════════════════════
        const lintResults = lintControlPlane(effectiveConfig, placeholderMap);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD WARNINGS
        // ═══════════════════════════════════════════════════════════════════════
        const warnings = [];
        
        if (!effectiveConfig.greeting.configured) {
            warnings.push({
                field: 'greeting',
                severity: 'error',
                message: 'No greeting configured'
            });
        }
        
        if (computed.performance.greetingEstimatedSeconds > 4) {
            warnings.push({
                field: 'greeting',
                severity: 'warning',
                message: `Greeting is too long (${greetingWords} words, ~${computed.performance.greetingEstimatedSeconds}s). Keep under 25 words.`
            });
        }
        
        if (!effectiveConfig.fallbacks.notOfferedConfigured) {
            warnings.push({
                field: 'fallbacks.notOfferedReply',
                severity: 'warning',
                message: 'No "Not Offered" fallback reply configured'
            });
        }
        
        if (effectiveConfig.booking.slotsCount === 0 && effectiveConfig.booking.enabled) {
            warnings.push({
                field: 'booking.slots',
                severity: 'warning',
                message: 'Booking is enabled but no slots are configured'
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
        
        res.json({
            success: true,
            data: {
                companyId,
                companyName: company.companyName,
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime,
                
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
                
                // Debug endpoints
                _links: {
                    registry: '/api/control-plane/registry',
                    lint: `/api/company/${companyId}/control-plane/lint`,
                    save: `/api/company/${companyId}`
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
    const { text, field, rules } = req.body;
    
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

module.exports = router;


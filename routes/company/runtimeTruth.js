/**
 * ============================================================================
 * RUNTIME TRUTH - The SINGLE JSON That Shows What Actually Runs
 * ============================================================================
 * 
 * PURPOSE: One endpoint that returns EVERYTHING needed to understand
 *          what will happen when a call comes in.
 * 
 * CRITICAL: If it's not in this JSON, it doesn't exist for runtime.
 * 
 * COMBINES:
 * - Control Plane (greeting, booking, fallbacks, personality)
 * - Scenario Brain (templates, categories, scenarios)
 * - Dynamic Flows (triggers, actions, flow coordination)
 * - Matching Policy (tier thresholds, priority rules)
 * - Wiring (scenario → action → flow → booking mapping)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const v2Company = require('../../models/v2Company');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const DynamicFlow = require('../../models/DynamicFlow');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { unifyConfig } = require('../../utils/configUnifier');
const { substitutePlaceholders } = require('../../utils/placeholderStandard');
const logger = require('../../utils/logger');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/runtime-truth
 * 
 * Returns the complete runtime truth for this company - EVERYTHING in one JSON
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        console.log(`🎯 [RUNTIME TRUTH] Building for company: ${companyId}`);
        
        // ═══════════════════════════════════════════════════════════════════════
        // PARALLEL LOAD ALL DATA SOURCES
        // ═══════════════════════════════════════════════════════════════════════
        const [company, responseDefaults, placeholdersDoc, dynamicFlows] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyResponseDefaults.getOrCreate(companyId),
            CompanyPlaceholders.findOne({ companyId }).lean(),
            DynamicFlow.find({ companyId, enabled: true }).lean()
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
        placeholderMap.companyName = company.companyName;
        placeholderMap.companyPhone = company.companyPhone || company.phoneNumber;
        
        // ═══════════════════════════════════════════════════════════════════════
        // UNIFY CONTROL PLANE CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        const controlPlane = unifyConfig(company, responseDefaults, {
            seedBookingSlotsIfEmpty: false
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // LOAD ACTIVE TEMPLATES + SCENARIOS
        // ═══════════════════════════════════════════════════════════════════════
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId);
        
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: activeTemplateIds },
            isActive: true
        }).lean();
        
        // Flatten scenarios with category info
        const scenarios = [];
        const categories = [];
        let totalTriggers = 0;
        
        templates.forEach(template => {
            (template.categories || []).forEach(cat => {
                categories.push({
                    id: cat.id || cat._id,
                    name: cat.name,
                    templateId: template._id,
                    templateName: template.name,
                    scenarioCount: (cat.scenarios || []).length
                });
                
                (cat.scenarios || []).forEach(scenario => {
                    const triggers = scenario.triggers || [];
                    totalTriggers += triggers.length;
                    
                    scenarios.push({
                        id: scenario.scenarioId || scenario._id,
                        name: scenario.name,
                        categoryId: cat.id || cat._id,
                        categoryName: cat.name,
                        templateId: template._id,
                        templateName: template.name,
                        
                        // Matching
                        triggers: triggers.slice(0, 5), // First 5 for preview
                        triggerCount: triggers.length,
                        negativeTriggers: scenario.negativeTriggers || [],
                        negativeTriggerCount: (scenario.negativeTriggers || []).length,
                        minConfidence: scenario.minConfidence || scenario.contextWeight || 0.7,
                        priority: scenario.priority || 0,
                        
                        // Type & Action
                        scenarioType: scenario.scenarioType || 'UNKNOWN',
                        status: scenario.status || 'live',
                        
                        // Replies
                        quickReplyCount: (scenario.quickReplies || []).length,
                        fullReplyCount: (scenario.fullReplies || []).length,
                        
                        // Wiring - What happens when this matches?
                        wiring: {
                            action: detectScenarioAction(scenario),
                            flowId: scenario.flowId || null,
                            transferTarget: scenario.transferTarget || null,
                            bookingIntent: scenario.bookingIntent || false,
                            handoffPolicy: scenario.handoffPolicy || 'low_confidence',
                            actionHooks: scenario.actionHooks || [],
                            followUpMode: scenario.followUpMode || 'NONE'
                        },
                        
                        // Quality
                        quality: {
                            score: calculateScenarioQuality(scenario),
                            issues: getScenarioIssues(scenario)
                        }
                    });
                });
            });
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // FORMAT DYNAMIC FLOWS
        // ═══════════════════════════════════════════════════════════════════════
        const flows = dynamicFlows.map(flow => ({
            id: flow._id,
            flowKey: flow.flowKey,
            name: flow.name,
            enabled: flow.enabled,
            priority: flow.priority || 0,
            
            // Entry conditions
            triggers: (flow.triggers || []).map(t => ({
                type: t.type || 'phrase',
                phrases: (t.phrases || []).slice(0, 5),
                phraseCount: (t.phrases || []).length,
                matchMode: t.matchMode || 'contains',
                minConfidence: t.minConfidence || 0.7
            })),
            
            // Actions
            actions: (flow.actions || []).map(a => ({
                type: a.type,
                key: a.key,
                value: a.value
            })),
            
            // Settings
            allowConcurrent: flow.allowConcurrent || false,
            minConfidence: flow.minConfidence || 0.7
        }));
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD MATCHING POLICY
        // ═══════════════════════════════════════════════════════════════════════
        const aiSettings = company.aiAgentSettings || {};
        const thresholds = aiSettings.thresholds || {};
        
        const matchingPolicy = {
            tierOrder: ['RULE_BASED', 'SEMANTIC', 'LLM_FALLBACK'],
            thresholds: {
                tier1: thresholds.tier1Threshold || thresholds.companyQnAThreshold || 0.8,
                tier2: thresholds.tier2Threshold || thresholds.tradeQnAThreshold || 0.6,
                tier3: 'LLM_FALLBACK'
            },
            priorityRules: {
                emergencyBoost: 10,
                exactMatchBoost: 5,
                negativeMatchBlock: true
            },
            discoveryConsent: {
                required: aiSettings.discoveryConsent?.enabled || false,
                scenariosBlockedByConsent: aiSettings.discoveryConsent?.disableScenarioAutoResponses || false
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD BOOKING CONFIG
        // ═══════════════════════════════════════════════════════════════════════
        const booking = {
            enabled: controlPlane.booking.enabled,
            slots: controlPlane.booking.slots.map(s => ({
                key: s.key || s.name,
                label: s.label || s.name,
                required: s.required !== false,
                validation: s.validation || null
            })),
            slotsCount: controlPlane.booking.slotsCount,
            
            // Time windows (if configured)
            timeWindows: company.frontDeskBehavior?.bookingWindows || [
                '8:00 AM - 10:00 AM',
                '10:00 AM - 12:00 PM',
                '12:00 PM - 2:00 PM',
                '2:00 PM - 4:00 PM',
                '4:00 PM - 6:00 PM'
            ],
            
            // Consent rules
            consent: {
                required: aiSettings.discoveryConsent?.enabled || false,
                phrase: aiSettings.discoveryConsent?.consentPhrase || 'Would you like me to schedule that for you?'
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD WIRING MAP - The Critical Link
        // ═══════════════════════════════════════════════════════════════════════
        const wiringMap = {
            scenarioTypeToAction: {
                'EMERGENCY': { action: 'ESCALATE_OR_BOOK', priority: 'HIGH' },
                'BOOKING': { action: 'START_BOOKING', priority: 'MEDIUM' },
                'FAQ': { action: 'REPLY_ONLY', priority: 'LOW' },
                'TROUBLESHOOT': { action: 'REPLY_THEN_OFFER_BOOK', priority: 'MEDIUM' },
                'TRANSFER': { action: 'TRANSFER', priority: 'HIGH' },
                'SMALL_TALK': { action: 'REPLY_ONLY', priority: 'LOW' },
                'UNKNOWN': { action: 'REPLY_AND_ASK', priority: 'MEDIUM' }
            },
            
            // What percentage of scenarios are properly wired?
            coverage: {
                totalScenarios: scenarios.length,
                withScenarioType: scenarios.filter(s => s.scenarioType !== 'UNKNOWN').length,
                withTransferTarget: scenarios.filter(s => s.wiring.transferTarget).length,
                withFlowId: scenarios.filter(s => s.wiring.flowId).length,
                withBookingIntent: scenarios.filter(s => s.wiring.bookingIntent).length
            }
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD HEALTH STATUS
        // ═══════════════════════════════════════════════════════════════════════
        const issues = [];
        
        if (!controlPlane.greeting.configured) {
            issues.push({ severity: 'ERROR', area: 'greeting', message: 'No greeting configured' });
        }
        
        if (controlPlane.booking.slotsCount === 0 && controlPlane.booking.enabled) {
            issues.push({ severity: 'ERROR', area: 'booking', message: 'Booking enabled but no slots configured' });
        }
        
        if (scenarios.length === 0) {
            issues.push({ severity: 'ERROR', area: 'scenarios', message: 'No scenarios loaded' });
        }
        
        if (flows.length === 0) {
            issues.push({ severity: 'WARNING', area: 'flows', message: 'No dynamic flows enabled - scenarios will reply but not coordinate' });
        }
        
        const unknownScenarios = scenarios.filter(s => s.scenarioType === 'UNKNOWN').length;
        if (unknownScenarios > 0) {
            issues.push({ 
                severity: 'WARNING', 
                area: 'scenarios', 
                message: `${unknownScenarios} scenarios have scenarioType=UNKNOWN (no routing)` 
            });
        }
        
        if (matchingPolicy.discoveryConsent.scenariosBlockedByConsent) {
            issues.push({ 
                severity: 'WARNING', 
                area: 'consent', 
                message: 'disableScenarioAutoResponses=true - scenarios will not reply until consent given' 
            });
        }
        
        const health = {
            status: issues.some(i => i.severity === 'ERROR') ? 'RED' : 
                    issues.some(i => i.severity === 'WARNING') ? 'YELLOW' : 'GREEN',
            issues,
            criticalCount: issues.filter(i => i.severity === 'ERROR').length,
            warningCount: issues.filter(i => i.severity === 'WARNING').length
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD FINAL RESPONSE
        // ═══════════════════════════════════════════════════════════════════════
        const runtimeTruth = {
            _meta: {
                companyId,
                companyName: company.companyName,
                tradeKey: company.tradeKey || 'hvac',
                schemaVersion: 'V22',
                generatedAt: new Date().toISOString(),
                generationTimeMs: Date.now() - startTime
            },
            
            health,
            
            // Control Plane (greeting, booking, fallbacks)
            controlPlane: {
                greeting: {
                    configured: controlPlane.greeting.configured,
                    text: controlPlane.greeting.standardized,
                    preview: substitutePlaceholders(controlPlane.greeting.standardized, placeholderMap)
                },
                booking,
                fallbacks: {
                    notOffered: controlPlane.fallbacks.notOfferedReply,
                    unknownIntent: controlPlane.fallbacks.unknownIntentReply,
                    afterHours: controlPlane.fallbacks.afterHoursReply
                },
                personality: controlPlane.personality
            },
            
            // Scenario Brain
            scenarioBrain: {
                activeTemplates: templates.map(t => ({
                    id: t._id,
                    name: t.name,
                    categoryCount: (t.categories || []).length,
                    scenarioCount: (t.categories || []).reduce((sum, c) => sum + (c.scenarios || []).length, 0)
                })),
                categories,
                scenarios,
                totals: {
                    templates: templates.length,
                    categories: categories.length,
                    scenarios: scenarios.length,
                    triggers: totalTriggers
                }
            },
            
            // Dynamic Flows
            dynamicFlows: {
                enabled: flows.length > 0,
                flows,
                count: flows.length
            },
            
            // Matching Policy
            matchingPolicy,
            
            // Wiring Map - The critical link
            wiringMap,
            
            // Placeholders
            placeholders: placeholderMap
        };
        
        console.log(`✅ [RUNTIME TRUTH] Generated in ${Date.now() - startTime}ms`);
        
        res.json({
            success: true,
            data: runtimeTruth
        });
        
    } catch (error) {
        console.error('❌ [RUNTIME TRUTH] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Detect what action a scenario should trigger based on its configuration
 */
function detectScenarioAction(scenario) {
    // Explicit flowId → START_FLOW
    if (scenario.flowId) return 'START_FLOW';
    
    // Transfer target → TRANSFER
    if (scenario.transferTarget) return 'TRANSFER';
    
    // Booking intent → START_BOOKING
    if (scenario.bookingIntent) return 'START_BOOKING';
    
    // Emergency type → ESCALATE_OR_BOOK
    if (scenario.scenarioType === 'EMERGENCY') return 'ESCALATE_OR_BOOK';
    
    // Follow-up mode → REPLY_THEN_ASK
    if (scenario.followUpMode && scenario.followUpMode !== 'NONE') return 'REPLY_THEN_ASK';
    
    // Default → REPLY_ONLY
    return 'REPLY_ONLY';
}

/**
 * Calculate quality score for a scenario (0-100)
 */
function calculateScenarioQuality(scenario) {
    let score = 100;
    
    // Triggers
    const triggers = scenario.triggers || [];
    if (triggers.length < 8) score -= (8 - triggers.length) * 5;
    
    // Negatives
    const negatives = scenario.negativeTriggers || [];
    if (negatives.length < 3) score -= (3 - negatives.length) * 5;
    
    // Quick replies
    const quick = scenario.quickReplies || [];
    if (quick.length < 7) score -= (7 - quick.length) * 3;
    
    // Full replies
    const full = scenario.fullReplies || [];
    if (full.length < 3) score -= (3 - full.length) * 3;
    
    // Scenario type
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') score -= 10;
    
    return Math.max(0, score);
}

/**
 * Get list of issues for a scenario
 */
function getScenarioIssues(scenario) {
    const issues = [];
    
    const triggers = scenario.triggers || [];
    if (triggers.length < 8) issues.push(`triggers: ${triggers.length}/8`);
    
    const negatives = scenario.negativeTriggers || [];
    if (negatives.length < 3) issues.push(`negatives: ${negatives.length}/3`);
    
    const quick = scenario.quickReplies || [];
    if (quick.length < 7) issues.push(`quickReplies: ${quick.length}/7`);
    
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
        issues.push('scenarioType: UNKNOWN');
    }
    
    return issues;
}

module.exports = router;


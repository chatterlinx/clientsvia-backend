/**
 * ============================================================================
 * SCENARIO VALIDATOR - Red/Yellow/Green Quality Report
 * ============================================================================
 * 
 * PURPOSE: Mechanical proof that scenarios are production-ready
 *          No vibes. No "looks good." Hard grades.
 * 
 * VALIDATION:
 * - Required field check (name, triggers, replies)
 * - Trigger count (8+ required)
 * - Negative count (3+ required)
 * - Reply count (7+ quick, 7+ full)
 * - Scenario type classification
 * - Wiring completeness (actionType, flowId, transferTarget)
 * - Collision detection
 * - Placeholder validation
 * - Enum validation
 * 
 * OUTPUT:
 * - Per-scenario grade (A/B/C/D/F)
 * - Missing fields list
 * - Reply counts
 * - Trigger counts
 * - Collision warnings
 * - Overall health (RED/YELLOW/GREEN)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const DynamicFlow = require('../../models/DynamicFlow');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const logger = require('../../utils/logger');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const QUALITY_REQUIREMENTS = {
    minTriggers: 8,
    minNegativeTriggers: 3,
    minQuickReplies: 7,
    minFullReplies: 7,
    minKeywords: 3,
    minReplyLength: 10 // Minimum characters per reply
};

const SCENARIO_TYPE_ENUM = ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'BILLING', 'TRANSFER', 'SMALL_TALK', 'SYSTEM', 'UNKNOWN'];
const ACTION_TYPE_ENUM = ['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'];
const HANDOFF_POLICY_ENUM = ['never', 'low_confidence', 'always_on_keyword', 'emergency_only'];

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a single scenario and return detailed report
 */
function validateScenario(scenario, context) {
    const issues = [];
    const warnings = [];
    const errors = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // REQUIRED FIELD CHECKS
    // ═══════════════════════════════════════════════════════════════════════
    
    if (!scenario.name || scenario.name.length < 2) {
        errors.push({ field: 'name', issue: 'Missing or too short (min 2 chars)', severity: 'ERROR' });
    }
    
    if (!scenario.scenarioId) {
        warnings.push({ field: 'scenarioId', issue: 'Missing scenarioId', severity: 'WARNING' });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // TRIGGER VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const triggers = scenario.triggers || [];
    const triggerCount = triggers.length;
    
    if (triggerCount === 0) {
        errors.push({ field: 'triggers', issue: 'No triggers defined - scenario will never match', severity: 'ERROR' });
    } else if (triggerCount < QUALITY_REQUIREMENTS.minTriggers) {
        issues.push({ 
            field: 'triggers', 
            issue: `Only ${triggerCount} triggers (need ${QUALITY_REQUIREMENTS.minTriggers}+)`,
            severity: triggerCount < 3 ? 'ERROR' : 'WARNING',
            current: triggerCount,
            required: QUALITY_REQUIREMENTS.minTriggers
        });
    }
    
    // Check for short triggers
    const shortTriggers = triggers.filter(t => typeof t === 'string' && t.length < 3);
    if (shortTriggers.length > 0) {
        warnings.push({ 
            field: 'triggers', 
            issue: `${shortTriggers.length} very short triggers may cause false positives`,
            severity: 'WARNING',
            examples: shortTriggers.slice(0, 3)
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // NEGATIVE TRIGGER VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const negativeTriggers = scenario.negativeTriggers || [];
    const negativeCount = negativeTriggers.length;
    
    if (negativeCount < QUALITY_REQUIREMENTS.minNegativeTriggers) {
        issues.push({ 
            field: 'negativeTriggers', 
            issue: `Only ${negativeCount} negatives (need ${QUALITY_REQUIREMENTS.minNegativeTriggers}+)`,
            severity: 'WARNING',
            current: negativeCount,
            required: QUALITY_REQUIREMENTS.minNegativeTriggers
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // REPLY VALIDATION (Anti-robotic: 7+ each)
    // ═══════════════════════════════════════════════════════════════════════
    
    const quickReplies = scenario.quickReplies || [];
    const fullReplies = scenario.fullReplies || [];
    const quickCount = quickReplies.length;
    const fullCount = fullReplies.length;
    
    if (quickCount === 0 && fullCount === 0) {
        errors.push({ 
            field: 'replies', 
            issue: 'No replies defined - scenario cannot respond',
            severity: 'ERROR'
        });
    }
    
    if (quickCount < QUALITY_REQUIREMENTS.minQuickReplies) {
        issues.push({ 
            field: 'quickReplies', 
            issue: `Only ${quickCount} quick replies (need ${QUALITY_REQUIREMENTS.minQuickReplies}+ for variety)`,
            severity: quickCount < 3 ? 'ERROR' : 'WARNING',
            current: quickCount,
            required: QUALITY_REQUIREMENTS.minQuickReplies
        });
    }
    
    if (fullCount < QUALITY_REQUIREMENTS.minFullReplies) {
        issues.push({ 
            field: 'fullReplies', 
            issue: `Only ${fullCount} full replies (need ${QUALITY_REQUIREMENTS.minFullReplies}+ for variety)`,
            severity: fullCount < 1 ? 'ERROR' : 'WARNING',
            current: fullCount,
            required: QUALITY_REQUIREMENTS.minFullReplies
        });
    }
    
    // Check for short replies
    const allReplies = [
        ...quickReplies.map(r => typeof r === 'string' ? r : r.text || ''),
        ...fullReplies.map(r => typeof r === 'string' ? r : r.text || '')
    ];
    const shortReplies = allReplies.filter(r => r.length < QUALITY_REQUIREMENTS.minReplyLength);
    if (shortReplies.length > 0) {
        warnings.push({ 
            field: 'replies', 
            issue: `${shortReplies.length} replies are very short (<${QUALITY_REQUIREMENTS.minReplyLength} chars)`,
            severity: 'WARNING'
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO TYPE VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const scenarioType = scenario.scenarioType;
    
    if (!scenarioType || scenarioType === 'UNKNOWN') {
        issues.push({ 
            field: 'scenarioType', 
            issue: 'Scenario type is UNKNOWN - will not route properly',
            severity: 'WARNING',
            current: scenarioType || 'null',
            allowed: SCENARIO_TYPE_ENUM
        });
    } else if (!SCENARIO_TYPE_ENUM.includes(scenarioType)) {
        errors.push({ 
            field: 'scenarioType', 
            issue: `Invalid scenario type: ${scenarioType}`,
            severity: 'ERROR',
            current: scenarioType,
            allowed: SCENARIO_TYPE_ENUM
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // WIRING VALIDATION (What makes scenarios DO something)
    // ═══════════════════════════════════════════════════════════════════════
    
    const actionType = scenario.actionType || null;
    const flowId = scenario.flowId;
    const transferTarget = scenario.transferTarget;
    const bookingIntent = scenario.bookingIntent;
    
    // Validate actionType enum
    if (actionType && !ACTION_TYPE_ENUM.includes(actionType)) {
        errors.push({ 
            field: 'actionType', 
            issue: `Invalid actionType: ${actionType}`,
            severity: 'ERROR',
            current: actionType,
            allowed: ACTION_TYPE_ENUM
        });
    }
    
    // START_FLOW requires flowId
    if (actionType === 'START_FLOW' && !flowId) {
        errors.push({ 
            field: 'flowId', 
            issue: 'actionType=START_FLOW but no flowId specified',
            severity: 'ERROR'
        });
    }
    
    // Validate flowId exists
    if (flowId && context.flowIds && !context.flowIds.includes(flowId.toString())) {
        errors.push({ 
            field: 'flowId', 
            issue: `Flow not found: ${flowId}`,
            severity: 'ERROR'
        });
    }
    
    // TRANSFER requires transferTarget
    if (actionType === 'TRANSFER' && !transferTarget) {
        errors.push({ 
            field: 'transferTarget', 
            issue: 'actionType=TRANSFER but no transferTarget specified',
            severity: 'ERROR'
        });
    }
    
    // REQUIRE_BOOKING should have requiredSlots
    if ((actionType === 'REQUIRE_BOOKING' || bookingIntent) && 
        (!scenario.requiredSlots || scenario.requiredSlots.length === 0)) {
        warnings.push({ 
            field: 'requiredSlots', 
            issue: 'Booking intent without requiredSlots - will use company defaults',
            severity: 'WARNING'
        });
    }
    
    // EMERGENCY should have stopRouting
    if (scenarioType === 'EMERGENCY' && !scenario.stopRouting) {
        warnings.push({ 
            field: 'stopRouting', 
            issue: 'EMERGENCY scenarios should have stopRouting=true',
            severity: 'WARNING'
        });
    }
    
    // Validate handoffPolicy enum
    if (scenario.handoffPolicy && !HANDOFF_POLICY_ENUM.includes(scenario.handoffPolicy)) {
        errors.push({ 
            field: 'handoffPolicy', 
            issue: `Invalid handoffPolicy: ${scenario.handoffPolicy}`,
            severity: 'ERROR',
            allowed: HANDOFF_POLICY_ENUM
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PLACEHOLDER VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const allText = allReplies.join(' ');
    const placeholderMatches = allText.match(/\{\{(\w+)\}\}/g) || [];
    const usedPlaceholders = placeholderMatches.map(m => m.replace(/\{\{|\}\}/g, ''));
    
    usedPlaceholders.forEach(ph => {
        if (context.placeholderKeys && 
            !context.placeholderKeys.includes(ph) && 
            !['companyName', 'companyPhone'].includes(ph)) {
            warnings.push({ 
                field: 'placeholders', 
                issue: `Placeholder {{${ph}}} not found in company placeholders`,
                severity: 'WARNING',
                placeholder: ph
            });
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // CALCULATE GRADE
    // ═══════════════════════════════════════════════════════════════════════
    
    let score = 100;
    
    // Deduct for errors (critical)
    score -= errors.length * 20;
    
    // Deduct for issues
    issues.forEach(issue => {
        if (issue.severity === 'ERROR') score -= 15;
        else score -= 8;
    });
    
    // Deduct for warnings
    score -= warnings.length * 3;
    
    // Bonus for meeting requirements
    if (triggerCount >= QUALITY_REQUIREMENTS.minTriggers) score += 5;
    if (negativeCount >= QUALITY_REQUIREMENTS.minNegativeTriggers) score += 3;
    if (quickCount >= QUALITY_REQUIREMENTS.minQuickReplies) score += 5;
    if (fullCount >= QUALITY_REQUIREMENTS.minFullReplies) score += 5;
    if (scenarioType && scenarioType !== 'UNKNOWN') score += 5;
    if (actionType || flowId || transferTarget || bookingIntent) score += 5;
    
    score = Math.max(0, Math.min(100, score));
    
    // Grade mapping
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 65) grade = 'C';
    else if (score >= 50) grade = 'D';
    else grade = 'F';
    
    // Determine status (RED/YELLOW/GREEN)
    let status;
    if (errors.length > 0) status = 'RED';
    else if (issues.length > 0 || warnings.length > 2) status = 'YELLOW';
    else status = 'GREEN';
    
    return {
        scenarioId: scenario.scenarioId,
        name: scenario.name,
        grade,
        score,
        status,
        
        counts: {
            triggers: triggerCount,
            negativeTriggers: negativeCount,
            quickReplies: quickCount,
            fullReplies: fullCount,
            keywords: (scenario.keywords || []).length
        },
        
        meetsRequirements: {
            triggers: triggerCount >= QUALITY_REQUIREMENTS.minTriggers,
            negativeTriggers: negativeCount >= QUALITY_REQUIREMENTS.minNegativeTriggers,
            quickReplies: quickCount >= QUALITY_REQUIREMENTS.minQuickReplies,
            fullReplies: fullCount >= QUALITY_REQUIREMENTS.minFullReplies,
            scenarioType: scenarioType && scenarioType !== 'UNKNOWN',
            hasWiring: !!(actionType || flowId || transferTarget || bookingIntent)
        },
        
        classification: {
            scenarioType: scenarioType || 'UNKNOWN',
            actionType: actionType || 'inferred',
            hasFlowId: !!flowId,
            hasTransferTarget: !!transferTarget,
            hasBookingIntent: !!bookingIntent,
            stopRouting: scenario.stopRouting || false
        },
        
        errors,
        issues,
        warnings,
        
        errorCount: errors.length,
        issueCount: issues.length,
        warningCount: warnings.length
    };
}

/**
 * Detect trigger collisions between scenarios
 */
function detectCollisions(scenarios) {
    const triggerMap = new Map();
    const collisions = [];
    
    scenarios.forEach(scenario => {
        const triggers = scenario.triggers || [];
        triggers.forEach(trigger => {
            const normalized = String(trigger).toLowerCase().trim();
            if (!triggerMap.has(normalized)) {
                triggerMap.set(normalized, []);
            }
            triggerMap.get(normalized).push({
                scenarioId: scenario.scenarioId,
                name: scenario.name,
                scenarioType: scenario.scenarioType,
                priority: scenario.priority || 0
            });
        });
    });
    
    // Find collisions (trigger used by multiple scenarios)
    triggerMap.forEach((scenarios, trigger) => {
        if (scenarios.length > 1) {
            // Determine severity based on scenario types
            const hasEmergency = scenarios.some(s => s.scenarioType === 'EMERGENCY');
            const hasTransfer = scenarios.some(s => s.scenarioType === 'TRANSFER');
            const highPriorityConflict = scenarios.some(s => s.priority > 80);
            
            collisions.push({
                trigger,
                scenarios: scenarios.map(s => ({
                    scenarioId: s.scenarioId,
                    name: s.name,
                    scenarioType: s.scenarioType,
                    priority: s.priority
                })),
                severity: (hasEmergency || hasTransfer || highPriorityConflict) ? 'ERROR' : 'WARNING',
                resolution: 'Add negative triggers to disambiguate or adjust priorities'
            });
        }
    });
    
    return collisions;
}

// ============================================================================
// MAIN VALIDATION ENDPOINT
// ============================================================================

/**
 * POST /api/company/:companyId/scenarios/validate
 * 
 * Query params:
 * - templateId (optional): Filter to specific template
 * - categoryId (optional): Filter to specific category
 * 
 * Returns detailed validation report for all scenarios
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { templateId, categoryId } = req.query;
    
    try {
        logger.info(`🔍 [SCENARIO VALIDATE] Starting validation for company ${companyId}`);
        
        // ═══════════════════════════════════════════════════════════════════════
        // LOAD CONTEXT
        // ═══════════════════════════════════════════════════════════════════════
        
        const [company, placeholdersDoc, dynamicFlows] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyPlaceholders.findOne({ companyId }).lean(),
            DynamicFlow.find({ companyId }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const context = {
            companyId,
            flowIds: dynamicFlows.map(f => f._id.toString()),
            placeholderKeys: (placeholdersDoc?.placeholders || []).map(p => p.key)
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // LOAD TEMPLATES
        // ═══════════════════════════════════════════════════════════════════════
        
        const query = {};
        if (templateId) query._id = templateId;
        
        const templates = await GlobalInstantResponseTemplate.find(query).lean();
        
        if (templates.length === 0) {
            return res.json({
                success: true,
                data: {
                    health: 'GREEN',
                    message: 'No templates found to validate',
                    results: []
                }
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // VALIDATE ALL SCENARIOS
        // ═══════════════════════════════════════════════════════════════════════
        
        const allScenarios = [];
        const results = [];
        
        for (const template of templates) {
            for (const category of template.categories || []) {
                // Filter by categoryId if specified
                if (categoryId && category.id !== categoryId) continue;
                
                for (const scenario of category.scenarios || []) {
                    allScenarios.push(scenario);
                    
                    const validation = validateScenario(scenario, context);
                    results.push({
                        ...validation,
                        templateId: template._id.toString(),
                        templateName: template.name,
                        categoryId: category.id,
                        categoryName: category.name
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // DETECT COLLISIONS
        // ═══════════════════════════════════════════════════════════════════════
        
        const collisions = detectCollisions(allScenarios);
        
        // ═══════════════════════════════════════════════════════════════════════
        // CALCULATE SUMMARY
        // ═══════════════════════════════════════════════════════════════════════
        
        const gradeDistribution = {
            A: results.filter(r => r.grade === 'A').length,
            B: results.filter(r => r.grade === 'B').length,
            C: results.filter(r => r.grade === 'C').length,
            D: results.filter(r => r.grade === 'D').length,
            F: results.filter(r => r.grade === 'F').length
        };
        
        const statusDistribution = {
            GREEN: results.filter(r => r.status === 'GREEN').length,
            YELLOW: results.filter(r => r.status === 'YELLOW').length,
            RED: results.filter(r => r.status === 'RED').length
        };
        
        const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
        const totalIssues = results.reduce((sum, r) => sum + r.issueCount, 0);
        const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);
        const collisionErrors = collisions.filter(c => c.severity === 'ERROR').length;
        
        // Overall health
        let overallHealth;
        if (statusDistribution.RED > 0 || collisionErrors > 0) {
            overallHealth = 'RED';
        } else if (statusDistribution.YELLOW > results.length * 0.2) {
            overallHealth = 'YELLOW';
        } else {
            overallHealth = 'GREEN';
        }
        
        // Average score
        const avgScore = results.length > 0 
            ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
            : 0;
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD RESPONSE
        // ═══════════════════════════════════════════════════════════════════════
        
        res.json({
            success: true,
            data: {
                // ═══════════════════════════════════════════════════════════
                // OVERALL HEALTH
                // ═══════════════════════════════════════════════════════════
                health: overallHealth,
                healthMessage: overallHealth === 'GREEN' 
                    ? 'All scenarios meet quality requirements'
                    : overallHealth === 'YELLOW'
                    ? `${statusDistribution.YELLOW} scenarios need attention`
                    : `${statusDistribution.RED} scenarios have critical issues`,
                
                // ═══════════════════════════════════════════════════════════
                // SUMMARY STATS
                // ═══════════════════════════════════════════════════════════
                summary: {
                    totalScenarios: results.length,
                    averageScore: avgScore,
                    gradeDistribution,
                    statusDistribution,
                    totalErrors,
                    totalIssues,
                    totalWarnings,
                    collisions: collisions.length,
                    collisionErrors
                },
                
                // ═══════════════════════════════════════════════════════════
                // QUALITY REQUIREMENTS (for reference)
                // ═══════════════════════════════════════════════════════════
                qualityRequirements: QUALITY_REQUIREMENTS,
                
                // ═══════════════════════════════════════════════════════════
                // TOP ISSUES (Quick view of what needs fixing)
                // ═══════════════════════════════════════════════════════════
                topIssues: results
                    .filter(r => r.status !== 'GREEN')
                    .sort((a, b) => b.errorCount - a.errorCount || b.issueCount - a.issueCount)
                    .slice(0, 10)
                    .map(r => ({
                        scenarioId: r.scenarioId,
                        name: r.name,
                        grade: r.grade,
                        status: r.status,
                        errors: r.errors.slice(0, 3),
                        issues: r.issues.slice(0, 3)
                    })),
                
                // ═══════════════════════════════════════════════════════════
                // COLLISIONS
                // ═══════════════════════════════════════════════════════════
                collisions: collisions.slice(0, 20),
                
                // ═══════════════════════════════════════════════════════════
                // FULL RESULTS (Per-scenario detail)
                // ═══════════════════════════════════════════════════════════
                results,
                
                // ═══════════════════════════════════════════════════════════
                // METADATA
                // ═══════════════════════════════════════════════════════════
                meta: {
                    companyId,
                    companyName: company.companyName,
                    validatedAt: new Date().toISOString(),
                    validationTimeMs: Date.now() - startTime,
                    filters: {
                        templateId: templateId || 'all',
                        categoryId: categoryId || 'all'
                    }
                }
            }
        });
        
        logger.info(`✅ [SCENARIO VALIDATE] Validated ${results.length} scenarios in ${Date.now() - startTime}ms, health: ${overallHealth}`);
        
    } catch (error) {
        logger.error('[SCENARIO VALIDATE] Validation failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/scenarios/validate/requirements
 * 
 * Returns the quality requirements and allowed enum values
 */
router.get('/requirements', async (req, res) => {
    res.json({
        success: true,
        data: {
            qualityRequirements: QUALITY_REQUIREMENTS,
            allowedEnums: {
                scenarioType: SCENARIO_TYPE_ENUM,
                actionType: ACTION_TYPE_ENUM,
                handoffPolicy: HANDOFF_POLICY_ENUM
            },
            gradeMapping: {
                A: '90-100 - Production ready',
                B: '80-89 - Minor improvements needed',
                C: '65-79 - Needs work',
                D: '50-64 - Significant issues',
                F: '<50 - Critical failures'
            },
            statusMapping: {
                GREEN: 'No errors, few warnings',
                YELLOW: 'Issues but functional',
                RED: 'Critical errors - not production ready'
            }
        }
    });
});

module.exports = router;


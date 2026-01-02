/**
 * ============================================================================
 * SCENARIO IMPORT - Bulk Import Scenarios into Company Override Layer
 * ============================================================================
 * 
 * PURPOSE: Fast, validated, JSON-first scenario import
 *          Writes ONLY to company override layer (never touches GLOBAL)
 * 
 * MODES:
 *   - preview: Validate without saving
 *   - apply: Validate and save
 * 
 * VALIDATION:
 *   - Required fields
 *   - Enum values
 *   - Trigger collisions
 *   - Wiring completeness
 *   - Placeholder references
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const crypto = require('crypto');
const v2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const DynamicFlow = require('../../models/DynamicFlow');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const { ALL_SCENARIO_TYPES, isAllowedScenarioType, isUnknownOrBlankScenarioType } = require('../../utils/scenarioTypes');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ============================================================================
// VALIDATION RULES
// ============================================================================

const SCENARIO_TYPE_ENUM = ALL_SCENARIO_TYPES;
const ACTION_TYPE_ENUM = ['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'];
const HANDOFF_POLICY_ENUM = ['never', 'low_confidence', 'always_on_keyword', 'emergency_only'];
const FOLLOW_UP_MODE_ENUM = ['NONE', 'ASK_FOLLOWUP_QUESTION', 'ASK_IF_BOOK', 'TRANSFER'];
const REPLY_POLICY_ENUM = ['ROTATE_PER_CALLER', 'ROTATE_PER_SESSION', 'WEIGHTED_RANDOM', 'SEQUENTIAL'];

const QUALITY_REQUIREMENTS = {
    minTriggers: 8,
    minNegatives: 3,
    minQuickReplies: 5, // 7 recommended
    minFullReplies: 3,
    recommendedQuickReplies: 7,
    recommendedFullReplies: 7
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a single scenario
 * Returns { valid: boolean, errors: [], warnings: [] }
 */
function validateScenario(scenario, context) {
    const errors = [];
    const warnings = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // REQUIRED FIELDS
    // ═══════════════════════════════════════════════════════════════════════
    
    if (!scenario.name || typeof scenario.name !== 'string' || scenario.name.length < 3) {
        errors.push({ field: 'name', message: 'Name is required (min 3 chars)' });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // CLASSIFICATION
    // ═══════════════════════════════════════════════════════════════════════
    
    if (scenario.scenarioType && !isAllowedScenarioType(scenario.scenarioType)) {
        errors.push({ 
            field: 'scenarioType', 
            message: `Invalid scenarioType. Must be: ${SCENARIO_TYPE_ENUM.join(', ')}` 
        });
    }
    
    if (isUnknownOrBlankScenarioType(scenario.scenarioType)) {
        warnings.push({ 
            field: 'scenarioType', 
            message: 'scenarioType is blank/UNKNOWN - scenario will be treated as unclassified in governance checks' 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // TRIGGERS (Required for matching)
    // ═══════════════════════════════════════════════════════════════════════
    
    const triggers = scenario.triggers || [];
    if (triggers.length === 0) {
        errors.push({ field: 'triggers', message: 'At least one trigger is required' });
    } else if (triggers.length < QUALITY_REQUIREMENTS.minTriggers) {
        warnings.push({ 
            field: 'triggers', 
            message: `Only ${triggers.length} triggers (recommended: ${QUALITY_REQUIREMENTS.minTriggers}+)` 
        });
    }
    
    // Check for short triggers (likely to cause collisions)
    triggers.forEach((t, idx) => {
        if (typeof t === 'string' && t.length < 3) {
            warnings.push({ 
                field: `triggers[${idx}]`, 
                message: `Trigger "${t}" is very short (may cause false positives)` 
            });
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // NEGATIVES (Prevents false positives)
    // ═══════════════════════════════════════════════════════════════════════
    
    const negatives = scenario.negativeTriggers || [];
    if (negatives.length < QUALITY_REQUIREMENTS.minNegatives) {
        warnings.push({ 
            field: 'negativeTriggers', 
            message: `Only ${negatives.length} negatives (recommended: ${QUALITY_REQUIREMENTS.minNegatives}+)` 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // REPLIES (Anti-robotic)
    // ═══════════════════════════════════════════════════════════════════════
    
    const quickReplies = scenario.quickReplies || [];
    const fullReplies = scenario.fullReplies || [];
    
    if (quickReplies.length === 0 && fullReplies.length === 0) {
        errors.push({ field: 'replies', message: 'At least one reply is required (quickReplies or fullReplies)' });
    }
    
    if (quickReplies.length < QUALITY_REQUIREMENTS.minQuickReplies) {
        warnings.push({ 
            field: 'quickReplies', 
            message: `Only ${quickReplies.length} quick replies (recommended: ${QUALITY_REQUIREMENTS.recommendedQuickReplies})` 
        });
    }
    
    if (fullReplies.length < QUALITY_REQUIREMENTS.minFullReplies) {
        warnings.push({ 
            field: 'fullReplies', 
            message: `Only ${fullReplies.length} full replies (recommended: ${QUALITY_REQUIREMENTS.recommendedFullReplies})` 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // WIRING VALIDATION (Critical for scenarios to actually DO something)
    // ═══════════════════════════════════════════════════════════════════════
    
    const actionType = scenario.actionType || 'REPLY_ONLY';
    
    if (scenario.actionType && !ACTION_TYPE_ENUM.includes(scenario.actionType)) {
        errors.push({ 
            field: 'actionType', 
            message: `Invalid actionType. Must be: ${ACTION_TYPE_ENUM.join(', ')}` 
        });
    }
    
    // START_FLOW requires flowId
    if (actionType === 'START_FLOW' && !scenario.flowId) {
        errors.push({ 
            field: 'flowId', 
            message: 'flowId is required when actionType=START_FLOW' 
        });
    }
    
    // If flowId provided, validate it exists
    if (scenario.flowId && context.flowIds && !context.flowIds.includes(scenario.flowId)) {
        errors.push({ 
            field: 'flowId', 
            message: `Flow not found: ${scenario.flowId}` 
        });
    }
    
    // TRANSFER requires transferTarget
    if (actionType === 'TRANSFER' && !scenario.transferTarget) {
        errors.push({ 
            field: 'transferTarget', 
            message: 'transferTarget is required when actionType=TRANSFER' 
        });
    }
    
    // REQUIRE_BOOKING should have slots
    if ((actionType === 'REQUIRE_BOOKING' || scenario.bookingIntent) && 
        (!scenario.requiredSlots || scenario.requiredSlots.length === 0)) {
        warnings.push({ 
            field: 'requiredSlots', 
            message: 'bookingIntent=true but no requiredSlots specified' 
        });
    }
    
    // EMERGENCY should stop routing
    if (scenario.scenarioType === 'EMERGENCY' && scenario.stopRouting !== true) {
        warnings.push({ 
            field: 'stopRouting', 
            message: 'EMERGENCY scenarios should have stopRouting=true' 
        });
    }
    
    // Validate handoffPolicy enum
    if (scenario.handoffPolicy && !HANDOFF_POLICY_ENUM.includes(scenario.handoffPolicy)) {
        errors.push({ 
            field: 'handoffPolicy', 
            message: `Invalid handoffPolicy. Must be: ${HANDOFF_POLICY_ENUM.join(', ')}` 
        });
    }
    
    // Validate followUpMode enum
    if (scenario.followUpMode && !FOLLOW_UP_MODE_ENUM.includes(scenario.followUpMode)) {
        errors.push({ 
            field: 'followUpMode', 
            message: `Invalid followUpMode. Must be: ${FOLLOW_UP_MODE_ENUM.join(', ')}` 
        });
    }
    
    // Validate replyPolicy enum
    if (scenario.replyPolicy && !REPLY_POLICY_ENUM.includes(scenario.replyPolicy)) {
        errors.push({ 
            field: 'replyPolicy', 
            message: `Invalid replyPolicy. Must be: ${REPLY_POLICY_ENUM.join(', ')}` 
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PRIORITY & CONFIDENCE
    // ═══════════════════════════════════════════════════════════════════════
    
    if (scenario.priority !== undefined) {
        if (typeof scenario.priority !== 'number' || scenario.priority < -10 || scenario.priority > 100) {
            errors.push({ 
                field: 'priority', 
                message: 'Priority must be a number between -10 and 100' 
            });
        }
    }
    
    if (scenario.minConfidence !== undefined) {
        if (typeof scenario.minConfidence !== 'number' || scenario.minConfidence < 0 || scenario.minConfidence > 1) {
            errors.push({ 
                field: 'minConfidence', 
                message: 'minConfidence must be a number between 0 and 1' 
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PLACEHOLDER VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const allText = [
        ...quickReplies.map(r => typeof r === 'string' ? r : r.text || ''),
        ...fullReplies.map(r => typeof r === 'string' ? r : r.text || '')
    ].join(' ');
    
    // Find {{placeholder}} references
    const placeholderMatches = allText.match(/\{\{(\w+)\}\}/g) || [];
    const usedPlaceholders = placeholderMatches.map(m => m.replace(/\{\{|\}\}/g, ''));
    
    usedPlaceholders.forEach(ph => {
        if (context.placeholderKeys && !context.placeholderKeys.includes(ph) && 
            !['companyName', 'companyPhone'].includes(ph)) {
            warnings.push({ 
                field: 'placeholders', 
                message: `Placeholder {{${ph}}} not found in company placeholders` 
            });
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // CALCULATE QUALITY SCORE
    // ═══════════════════════════════════════════════════════════════════════
    
    let qualityScore = 100;
    
    // Deduct for missing triggers
    if (triggers.length < QUALITY_REQUIREMENTS.minTriggers) {
        qualityScore -= (QUALITY_REQUIREMENTS.minTriggers - triggers.length) * 5;
    }
    
    // Deduct for missing negatives
    if (negatives.length < QUALITY_REQUIREMENTS.minNegatives) {
        qualityScore -= (QUALITY_REQUIREMENTS.minNegatives - negatives.length) * 5;
    }
    
    // Deduct for missing replies
    if (quickReplies.length < QUALITY_REQUIREMENTS.minQuickReplies) {
        qualityScore -= (QUALITY_REQUIREMENTS.minQuickReplies - quickReplies.length) * 3;
    }
    
    // Deduct for UNKNOWN type
    if (!scenario.scenarioType || scenario.scenarioType === 'UNKNOWN') {
        qualityScore -= 10;
    }
    
    // Deduct for wiring issues
    if (errors.some(e => e.field === 'flowId' || e.field === 'transferTarget')) {
        qualityScore -= 15;
    }
    
    qualityScore = Math.max(0, qualityScore);
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        qualityScore
    };
}

/**
 * Check for trigger collisions between scenarios
 */
function checkTriggerCollisions(scenarios, existingScenarios) {
    const collisions = [];
    
    // Build map of existing triggers
    const existingTriggerMap = new Map();
    existingScenarios.forEach(s => {
        (s.triggers || []).forEach(t => {
            const normalized = String(t).toLowerCase().trim();
            if (!existingTriggerMap.has(normalized)) {
                existingTriggerMap.set(normalized, []);
            }
            existingTriggerMap.get(normalized).push({
                scenarioId: s.scenarioId || s._id?.toString(),
                scenarioName: s.name
            });
        });
    });
    
    // Check new scenarios against existing
    scenarios.forEach((scenario, idx) => {
        (scenario.triggers || []).forEach(t => {
            const normalized = String(t).toLowerCase().trim();
            const existing = existingTriggerMap.get(normalized);
            if (existing && existing.length > 0) {
                collisions.push({
                    newScenario: scenario.name || `scenarios[${idx}]`,
                    trigger: t,
                    existingIn: existing.map(e => e.scenarioName)
                });
            }
        });
    });
    
    // Check for collisions within the import batch
    const batchTriggerMap = new Map();
    scenarios.forEach((scenario, idx) => {
        (scenario.triggers || []).forEach(t => {
            const normalized = String(t).toLowerCase().trim();
            if (batchTriggerMap.has(normalized)) {
                collisions.push({
                    newScenario: scenario.name || `scenarios[${idx}]`,
                    trigger: t,
                    existingIn: [batchTriggerMap.get(normalized)]
                });
            } else {
                batchTriggerMap.set(normalized, scenario.name || `scenarios[${idx}]`);
            }
        });
    });
    
    return collisions;
}

// ============================================================================
// MAIN IMPORT ENDPOINT
// ============================================================================

/**
 * POST /api/company/:companyId/scenarios/import
 * 
 * Bulk import scenarios into company override layer
 * 
 * Body:
 *   {
 *     templateId: string (optional - target template),
 *     categoryId: string (optional - target category),
 *     mode: "preview" | "apply",
 *     scenarios: [ { ...scenario data } ]
 *   }
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        const { 
            templateId,
            categoryId,
            mode = 'preview',
            scenarios = []
        } = req.body;
        
        console.log(`📥 [SCENARIO IMPORT] ${mode.toUpperCase()} for company: ${companyId}, scenarios: ${scenarios.length}`);
        
        if (!scenarios || scenarios.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No scenarios provided'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // LOAD CONTEXT (company data for validation)
        // ═══════════════════════════════════════════════════════════════════════
        
        const [company, placeholdersDoc, dynamicFlows, templates] = await Promise.all([
            v2Company.findById(companyId).lean(),
            CompanyPlaceholders.findOne({ companyId }).lean(),
            DynamicFlow.find({ companyId }).lean(),
            GlobalInstantResponseTemplate.find({ isActive: true }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Build context for validation
        const context = {
            companyId,
            flowIds: dynamicFlows.map(f => f._id.toString()),
            placeholderKeys: (placeholdersDoc?.placeholders || []).map(p => p.key),
            templateId,
            categoryId
        };
        
        // Get existing scenarios for collision detection
        const existingScenarios = [];
        templates.forEach(t => {
            (t.categories || []).forEach(cat => {
                (cat.scenarios || []).forEach(s => {
                    existingScenarios.push(s);
                });
            });
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // VALIDATE ALL SCENARIOS
        // ═══════════════════════════════════════════════════════════════════════
        
        const validationResults = [];
        let totalErrors = 0;
        let totalWarnings = 0;
        
        scenarios.forEach((scenario, idx) => {
            const result = validateScenario(scenario, context);
            validationResults.push({
                index: idx,
                name: scenario.name || `scenarios[${idx}]`,
                scenarioId: scenario.scenarioId || null,
                valid: result.valid,
                errors: result.errors,
                warnings: result.warnings,
                qualityScore: result.qualityScore
            });
            
            totalErrors += result.errors.length;
            totalWarnings += result.warnings.length;
        });
        
        // Check for trigger collisions
        const collisions = checkTriggerCollisions(scenarios, existingScenarios);
        
        // Collisions with high-priority scenarios are errors
        const collisionErrors = collisions.filter(c => {
            // Find if existing scenario is high priority (EMERGENCY, TRANSFER)
            const existing = existingScenarios.find(s => c.existingIn.includes(s.name));
            return existing && ['EMERGENCY', 'TRANSFER'].includes(existing.scenarioType);
        });
        
        // Other collisions are warnings
        const collisionWarnings = collisions.filter(c => !collisionErrors.includes(c));
        
        // ═══════════════════════════════════════════════════════════════════════
        // PREVIEW MODE - Return validation results without saving
        // ═══════════════════════════════════════════════════════════════════════
        
        if (mode === 'preview') {
            const validCount = validationResults.filter(r => r.valid).length;
            const avgQuality = validationResults.reduce((sum, r) => sum + r.qualityScore, 0) / validationResults.length;
            
            return res.json({
                success: true,
                mode: 'preview',
                applied: false,
                summary: {
                    total: scenarios.length,
                    valid: validCount,
                    invalid: scenarios.length - validCount,
                    totalErrors,
                    totalWarnings,
                    collisions: collisions.length,
                    collisionErrors: collisionErrors.length,
                    averageQuality: Math.round(avgQuality)
                },
                validationResults,
                collisions: collisions.map(c => ({
                    trigger: c.trigger,
                    newScenario: c.newScenario,
                    existingIn: c.existingIn,
                    severity: collisionErrors.includes(c) ? 'ERROR' : 'WARNING'
                })),
                message: totalErrors === 0 
                    ? 'Validation passed. Set mode="apply" to save scenarios.'
                    : `${totalErrors} validation errors. Fix errors before applying.`
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // APPLY MODE - Reject if any hard errors
        // ═══════════════════════════════════════════════════════════════════════
        
        if (totalErrors > 0 || collisionErrors.length > 0) {
            return res.status(400).json({
                success: false,
                mode: 'apply',
                applied: false,
                error: 'Cannot apply - validation errors exist',
                summary: {
                    total: scenarios.length,
                    valid: validationResults.filter(r => r.valid).length,
                    invalid: validationResults.filter(r => !r.valid).length,
                    totalErrors,
                    collisionErrors: collisionErrors.length
                },
                validationResults: validationResults.filter(r => !r.valid),
                collisionErrors
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // APPLY - Save to company override layer
        // ═══════════════════════════════════════════════════════════════════════
        
        // Load fresh company for update
        const companyDoc = await v2Company.findById(companyId);
        if (!companyDoc.scenarioOverrides) {
            companyDoc.scenarioOverrides = {};
        }
        
        const importResults = [];
        let createdCount = 0;
        let updatedCount = 0;
        
        for (const scenario of scenarios) {
            const scenarioId = scenario.scenarioId || `sc_${crypto.randomBytes(8).toString('hex')}`;
            const isUpdate = companyDoc.scenarioOverrides[scenarioId] !== undefined;
            
            // Build the override object
            const override = {
                scenarioId,
                scenarioName: scenario.name,
                templateId: templateId || scenario.templateId,
                categoryId: categoryId || scenario.categoryId,
                
                // Classification
                scenarioType: scenario.scenarioType,
                
                // Matching
                triggers: scenario.triggers,
                negativeTriggers: scenario.negativeTriggers,
                keywords: scenario.keywords || [],
                negativeKeywords: scenario.negativeKeywords || [],
                priority: scenario.priority,
                minConfidence: scenario.minConfidence,
                
                // Replies
                quickReplies: scenario.quickReplies,
                fullReplies: scenario.fullReplies,
                replyPolicy: scenario.replyPolicy || 'ROTATE_PER_CALLER',
                
                // Wiring
                actionType: scenario.actionType,
                flowId: scenario.flowId,
                stopRouting: scenario.stopRouting,
                bookingIntent: scenario.bookingIntent,
                requiredSlots: scenario.requiredSlots,
                transferTarget: scenario.transferTarget,
                handoffPolicy: scenario.handoffPolicy,
                followUpMode: scenario.followUpMode,
                
                // Metadata
                scope: 'COMPANY',
                ownerCompanyId: companyId,
                status: scenario.status || 'live',
                createdAt: isUpdate ? companyDoc.scenarioOverrides[scenarioId]?.createdAt : new Date(),
                updatedAt: new Date(),
                importedBy: req.user?.email || 'api',
                importBatchId: `import_${Date.now()}`
            };
            
            companyDoc.scenarioOverrides[scenarioId] = override;
            
            importResults.push({
                scenarioId,
                name: scenario.name,
                action: isUpdate ? 'updated' : 'created',
                qualityScore: validationResults.find(r => r.name === scenario.name)?.qualityScore || 0
            });
            
            if (isUpdate) {
                updatedCount++;
            } else {
                createdCount++;
            }
        }
        
        companyDoc.markModified('scenarioOverrides');
        await companyDoc.save();
        
        // Generate audit record
        const auditId = `audit_${crypto.randomBytes(8).toString('hex')}`;
        console.log(`✅ [SCENARIO IMPORT] Created ${createdCount}, Updated ${updatedCount} scenarios, auditId: ${auditId}`);
        
        return res.json({
            success: true,
            mode: 'apply',
            applied: true,
            summary: {
                total: scenarios.length,
                created: createdCount,
                updated: updatedCount,
                failed: 0,
                warnings: totalWarnings
            },
            results: importResults,
            auditId,
            newVersion: `import_${Date.now()}`,
            message: `Successfully imported ${scenarios.length} scenarios (${createdCount} created, ${updatedCount} updated)`,
            generationTimeMs: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('❌ [SCENARIO IMPORT] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/scenarios/import/schema
 * 
 * Returns the expected scenario schema for import
 */
router.get('/schema', async (req, res) => {
    res.json({
        success: true,
        schemaVersion: 'V22.1',
        qualityRequirements: QUALITY_REQUIREMENTS,
        enums: {
            scenarioType: SCENARIO_TYPE_ENUM,
            actionType: ACTION_TYPE_ENUM,
            handoffPolicy: HANDOFF_POLICY_ENUM,
            followUpMode: FOLLOW_UP_MODE_ENUM,
            replyPolicy: REPLY_POLICY_ENUM
        },
        exampleScenario: {
            name: 'Gas Leak Emergency',
            scenarioType: 'EMERGENCY',
            priority: 100,
            minConfidence: 0.7,
            
            triggers: [
                'gas leak', 'smell gas', 'gas smell', 'natural gas',
                'gas odor', 'rotten eggs', 'propane leak', 'leaking gas',
                'gas emergency', 'smells like gas'
            ],
            
            negativeTriggers: [
                'gas bill', 'gas company', 'gas payment', 'gas prices'
            ],
            
            quickReplies: [
                "That's a safety emergency. Leave the house immediately and call 911 from outside.",
                "Gas leaks are dangerous. Please exit the building and call 911 right away.",
                "For your safety, get everyone outside immediately and call emergency services.",
                "This is urgent—leave the area now and dial 911 once you're outside.",
                "Don't use any switches or flames. Get outside and call 911 immediately.",
                "A gas leak requires immediate action. Exit the home and call 911 first.",
                "Your safety comes first. Please evacuate and contact 911 from a safe location."
            ],
            
            fullReplies: [
                "I understand you may be smelling gas, and that's a serious safety concern. Please leave your home immediately—don't turn on or off any lights or appliances. Once you're outside and at a safe distance, call 911. After you've contacted emergency services, please call us back and we can help with any HVAC follow-up.",
                "Gas leaks are extremely dangerous and require immediate action. Please evacuate everyone from the building right now, including pets. Don't use your phone until you're outside. Call 911 first, then give us a call back once you're safe.",
                "For your safety and the safety of anyone in the building, please leave immediately. Do not use any electrical switches or open flames. Once you're safely outside, call 911 and let them know you suspect a gas leak."
            ],
            
            actionType: 'TRANSFER',
            transferTarget: 'emergency_dispatch',
            stopRouting: true,
            handoffPolicy: 'emergency_only',
            
            replyPolicy: 'ROTATE_PER_CALLER'
        },
        requiredFields: ['name', 'triggers (min 1)', 'quickReplies or fullReplies (min 1)'],
        recommendedFields: [
            'scenarioType', 'actionType', 'priority', 'minConfidence',
            'negativeTriggers (min 3)', 'quickReplies (7)', 'fullReplies (3)',
            'flowId (if START_FLOW)', 'transferTarget (if TRANSFER)',
            'bookingIntent + requiredSlots (if REQUIRE_BOOKING)'
        ],
        modes: {
            preview: 'Validate without saving - returns errors, warnings, and quality scores',
            apply: 'Validate and save to company override layer'
        }
    });
});

/**
 * GET /api/company/:companyId/scenarios/overrides
 * 
 * Returns all company-specific scenario overrides
 */
router.get('/overrides', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const overrides = company.scenarioOverrides || {};
        const overrideList = Object.values(overrides);
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            totalOverrides: overrideList.length,
            overrides: overrideList.map(o => ({
                scenarioId: o.scenarioId,
                scenarioName: o.scenarioName,
                templateId: o.templateId,
                categoryId: o.categoryId,
                scenarioType: o.scenarioType,
                actionType: o.actionType,
                status: o.status,
                updatedAt: o.updatedAt
            }))
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/company/:companyId/scenarios/overrides/:scenarioId
 * 
 * Remove a company-specific scenario override (reverts to global)
 */
router.delete('/overrides/:scenarioId', async (req, res) => {
    const { companyId, scenarioId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        if (!company.scenarioOverrides || !company.scenarioOverrides[scenarioId]) {
            return res.status(404).json({
                success: false,
                error: 'Override not found'
            });
        }
        
        const overrideName = company.scenarioOverrides[scenarioId].scenarioName;
        delete company.scenarioOverrides[scenarioId];
        company.markModified('scenarioOverrides');
        await company.save();
        
        res.json({
            success: true,
            message: `Override for "${overrideName}" removed. Scenario will now use global version.`,
            scenarioId
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


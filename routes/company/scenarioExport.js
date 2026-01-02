/**
 * ============================================================================
 * FULL SCENARIO EXPORT API - Company-Scoped Deep Export
 * ============================================================================
 * 
 * PURPOSE: Export complete scenario configuration with ALL fields
 *          NO HIDDEN SETTINGS. If it's not in the export, it doesn't exist.
 * 
 * CRITICAL: This export is the PROOF that all fields are visible.
 *           The schemaMirror shows every field in the Mongoose schema.
 *           If a field is in schemaMirror but not in the scenario, that's a bug.
 * 
 * INCLUDES:
 * - All audit fields (editContext, lockReason, blocked attempts)
 * - All triggers (triggers, regexTriggers, negativeTriggers)
 * - All responses (quickReplies, fullReplies, replyBundles)
 * - All match config (minConfidence, keywords, contextFields)
 * - All action hooks (actionHooks, transferTarget, escalation)
 * - All WIRING fields (actionType, flowId, bookingIntent, requiredSlots, stopRouting)
 * - Scope lock info (scope, ownerCompanyId, overridesGlobalScenarioId)
 * - Quality requirements (minTriggers, minReplies, etc.)
 * - Everything needed to recreate the scenario
 * 
 * USE CASES:
 * - "Download Full Config JSON" button
 * - "Copy JSON to clipboard" feature
 * - ChatGPT/Prime analysis workflow
 * - Backup and restore
 * - Company-to-company migration
 * - Validator comparison (schemaMirror vs actual fields)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { getScopeDisplayInfo, getResolutionOrder, resolveEffectiveScenarios } = require('../../middleware/scopeGuard');
const logger = require('../../utils/logger');
const { isAllowedScenarioType, isUnknownOrBlankScenarioType } = require('../../utils/scenarioTypes');

// ============================================================================
// SCHEMA MIRROR - List of ALL fields in the scenario schema
// This is the PROOF that we're not hiding anything
// ============================================================================
const SCENARIO_SCHEMA_FIELDS = [
    // Identity & Lifecycle
    'scenarioId', 'name', 'version', 'status', 'isActive',
    
    // Scope Lock (Multi-tenant safety)
    'scope', 'ownerCompanyId', 'lockMode', 'lockReason', 'editPolicy',
    
    // Override Tracking
    'sourceTemplateId', 'sourceScenarioId', 'overridesGlobalScenarioId',
    'createdFromCloneAt', 'createdFromCloneBy',
    
    // Enterprise Audit
    'editContext', 'lastEditedAt', 'lastEditedBy', 'lastEditedFromContext',
    'lastEditAttemptBlockedAt', 'lastEditAttemptBlockedBy', 'lastEditAttemptBlockedReason', 'editBlockCount',
    
    // Categorization
    'categories', 'priority', 'cooldownSeconds',
    
    // Multilingual & Channel
    'language', 'channel',
    
    // HYBRID MATCHING (The Intelligence Core)
    'triggers', 'regexTriggers', 'negativeTriggers',
    'keywords', 'negativeKeywords',
    'exampleUserPhrases', 'negativeUserPhrases', 'testPhrases',
    'embeddingVector', 'contextWeight', 'minConfidence',
    
    // STATE MACHINE
    'preconditions', 'effects',
    
    // REPLIES (Anti-robotic - 7+ each)
    'quickReplies', 'fullReplies', 'followUpPrompts', 'followUpFunnel',
    'replySelection', 'replyStrategy',
    'replyBundles', 'replyPolicy',
    
    // SCENARIO TYPE (Classification)
    'scenarioType',
    
    // WIRING (What makes scenarios DO something)
    'actionType', 'flowId', 'bookingIntent', 'requiredSlots', 'stopRouting',
    
    // WIRING VALIDATION
    'wiringValidated', 'wiringValidatedAt', 'wiringIssues',
    
    // FOLLOW-UP BEHAVIOR
    'followUpMode', 'followUpQuestionText', 'transferTarget',
    
    // ENTITY CAPTURE
    'entityCapture', 'entityValidation', 'dynamicVariables',
    
    // ACTION HOOKS
    'actionHooks', 'handoffPolicy', 'escalationFlags',
    
    // AUTOFILL PROTECTION
    'autofillLock', 'lastAutofillAt', 'lastAutofillVersion',
    'lastManualTuneAt', 'lastManualTuneBy',
    
    // SENSITIVE DATA
    'sensitiveInfoRule', 'customMasking',
    
    // TIMING
    'timedFollowUp', 'silencePolicy',
    
    // AI INTELLIGENCE
    'qnaPairs', 'examples',
    
    // VOICE & TTS
    'behavior', 'toneLevel', 'ttsOverride',
    
    // METADATA
    'notes', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt',
    
    // LEGACY
    'quickReply', 'fullReply', 'legacyMigrated'
];

const CATEGORY_SCHEMA_FIELDS = [
    'id', 'name', 'icon', 'description', 'behavior', 'isActive',
    'scope', 'ownerCompanyId', 'lockMode', 'lockReason', 'editPolicy',
    'sourceTemplateId', 'sourceCategoryId', 'overridesGlobalCategoryId',
    'createdFromCloneAt', 'createdFromCloneBy',
    'editContext', 'lastEditedAt', 'lastEditedBy', 'lastEditedFromContext',
    'lastEditAttemptBlockedAt', 'lastEditAttemptBlockedBy', 'lastEditAttemptBlockedReason', 'editBlockCount',
    'additionalFillerWords', 'synonymMap',
    'scenarios'
];

// Quality requirements (non-negotiable)
const QUALITY_REQUIREMENTS = {
    minTriggers: 8,
    minNegativeTriggers: 3,
    minQuickReplies: 7,
    minFullReplies: 7,
    minKeywords: 3
};

/**
 * Calculate grade for a scenario based on quality metrics
 */
function calculateGrade(triggerCount, negativeCount, quickCount, fullCount, scenarioType) {
    let score = 0;
    
    // Triggers (25 points)
    if (triggerCount >= 8) score += 25;
    else if (triggerCount >= 5) score += 15;
    else if (triggerCount >= 3) score += 8;
    else score += triggerCount * 2;
    
    // Negatives (15 points)
    if (negativeCount >= 3) score += 15;
    else if (negativeCount >= 2) score += 10;
    else if (negativeCount >= 1) score += 5;
    
    // Quick replies (25 points)
    if (quickCount >= 7) score += 25;
    else if (quickCount >= 5) score += 18;
    else if (quickCount >= 3) score += 12;
    else score += quickCount * 3;
    
    // Full replies (25 points)
    if (fullCount >= 7) score += 25;
    else if (fullCount >= 3) score += 18;
    else if (fullCount >= 1) score += 10;
    
    // Scenario type (10 points)
    if (scenarioType && scenarioType !== 'UNKNOWN') score += 10;
    
    // Grade mapping
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 65) return 'C';
    if (score >= 50) return 'D';
    return 'F';
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
    triggerMap.forEach((scenariosList, trigger) => {
        if (scenariosList.length > 1) {
            // Determine severity based on scenario types
            const hasEmergency = scenariosList.some(s => s.scenarioType === 'EMERGENCY');
            const hasTransfer = scenariosList.some(s => s.scenarioType === 'TRANSFER');
            const highPriorityConflict = scenariosList.some(s => s.priority > 80);
            
            collisions.push({
                trigger,
                scenarios: scenariosList.map(s => ({
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

/**
 * Generate computed report block for a scenario
 * This is the PROOF that the scenario is set right
 */
function generateScenarioReport(scenario, context) {
    const issues = [];
    const warnings = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // A) Will it match the right calls?
    // ═══════════════════════════════════════════════════════════════════════
    
    const triggers = scenario.triggers || [];
    const negativeTriggers = scenario.negativeTriggers || [];
    const keywords = scenario.keywords || [];
    const negativeKeywords = scenario.negativeKeywords || [];
    
    const triggersCheck = {
        count: triggers.length,
        min: QUALITY_REQUIREMENTS.minTriggers,
        pass: triggers.length >= QUALITY_REQUIREMENTS.minTriggers,
        shortTriggers: triggers.filter(t => typeof t === 'string' && t.length < 3).length
    };
    if (!triggersCheck.pass) {
        issues.push(`triggers: ${triggers.length}/${QUALITY_REQUIREMENTS.minTriggers}`);
    }
    if (triggersCheck.shortTriggers > 0) {
        warnings.push(`${triggersCheck.shortTriggers} very short triggers may cause false positives`);
    }
    
    const negativesCheck = {
        count: negativeTriggers.length,
        min: QUALITY_REQUIREMENTS.minNegativeTriggers,
        pass: negativeTriggers.length >= QUALITY_REQUIREMENTS.minNegativeTriggers
    };
    if (!negativesCheck.pass) {
        issues.push(`negatives: ${negativeTriggers.length}/${QUALITY_REQUIREMENTS.minNegativeTriggers}`);
    }
    
    const keywordsCheck = {
        positiveCount: keywords.length,
        negativeCount: negativeKeywords.length,
        hasBoth: keywords.length > 0 && negativeKeywords.length > 0,
        pass: keywords.length >= 3 || triggers.length >= 5 // Keywords optional if triggers are strong
    };
    
    const confidenceCheck = {
        value: scenario.minConfidence,
        isSet: scenario.minConfidence !== null && scenario.minConfidence !== undefined,
        pass: true // Always passes, but shows if explicitly set
    };
    
    const priorityCheck = {
        value: scenario.priority ?? 0,
        isSet: scenario.priority !== null && scenario.priority !== undefined,
        pass: true // Always passes, but shows if explicitly set
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // B) Will it sound human, not robotic?
    // ═══════════════════════════════════════════════════════════════════════
    
    const quickReplies = scenario.quickReplies || [];
    const fullReplies = scenario.fullReplies || [];
    
    const quickRepliesCheck = {
        count: quickReplies.length,
        min: QUALITY_REQUIREMENTS.minQuickReplies,
        pass: quickReplies.length >= QUALITY_REQUIREMENTS.minQuickReplies,
        avgLength: quickReplies.length > 0 
            ? Math.round(quickReplies.reduce((sum, r) => sum + (typeof r === 'string' ? r.length : (r.text || '').length), 0) / quickReplies.length)
            : 0
    };
    if (!quickRepliesCheck.pass) {
        issues.push(`quickReplies: ${quickReplies.length}/${QUALITY_REQUIREMENTS.minQuickReplies}`);
    }
    
    const fullRepliesCheck = {
        count: fullReplies.length,
        min: QUALITY_REQUIREMENTS.minFullReplies,
        pass: fullReplies.length >= QUALITY_REQUIREMENTS.minFullReplies,
        avgLength: fullReplies.length > 0 
            ? Math.round(fullReplies.reduce((sum, r) => sum + (typeof r === 'string' ? r.length : (r.text || '').length), 0) / fullReplies.length)
            : 0
    };
    if (!fullRepliesCheck.pass) {
        issues.push(`fullReplies: ${fullReplies.length}/${QUALITY_REQUIREMENTS.minFullReplies}`);
    }
    
    const replyPolicyCheck = {
        selection: scenario.replySelection || 'bandit',
        policy: scenario.replyPolicy || 'ROTATE_PER_CALLER',
        strategy: scenario.replyStrategy || 'AUTO',
        pass: true // Informational
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // C) Will it do the right action when matched?
    // ═══════════════════════════════════════════════════════════════════════
    
    const scenarioType = scenario.scenarioType || 'UNKNOWN';
    const actionType = scenario.actionType || null;
    const handoffPolicy = scenario.handoffPolicy || 'low_confidence';
    const transferTarget = scenario.transferTarget || null;
    const followUpMode = scenario.followUpMode || 'NONE';
    const stopRouting = scenario.stopRouting || false;
    const flowId = scenario.flowId || null;
    const bookingIntent = scenario.bookingIntent || false;
    
    // Wiring validation
    const wiringIssues = [];
    
    // START_FLOW requires flowId
    if (actionType === 'START_FLOW' && !flowId) {
        wiringIssues.push('START_FLOW requires flowId');
    }
    
    // TRANSFER requires transferTarget
    if (actionType === 'TRANSFER' && !transferTarget) {
        wiringIssues.push('TRANSFER requires transferTarget');
    }
    
    // Validate flowId exists
    if (flowId && context.flowIds && !context.flowIds.includes(flowId.toString())) {
        wiringIssues.push(`flowId ${flowId} not found`);
    }
    
    // EMERGENCY/TRANSFER should have stopRouting
    if ((scenarioType === 'EMERGENCY' || scenarioType === 'TRANSFER') && !stopRouting) {
        warnings.push(`${scenarioType} should have stopRouting=true`);
    }
    
    // BOOKING should have bookingIntent or REQUIRE_BOOKING
    if (scenarioType === 'BOOKING' && !bookingIntent && actionType !== 'REQUIRE_BOOKING') {
        warnings.push('BOOKING scenario without bookingIntent or REQUIRE_BOOKING action');
    }
    
    const wiringCheck = {
        scenarioType,
        scenarioTypeValid: !isUnknownOrBlankScenarioType(scenarioType),
        actionType: actionType || 'inferred',
        handoffPolicy,
        transferTarget,
        transferTargetOk: actionType !== 'TRANSFER' || !!transferTarget,
        followUpMode,
        stopRouting,
        flowId,
        bookingIntent,
        issues: wiringIssues,
        pass: wiringIssues.length === 0
    };
    
    if (!wiringCheck.scenarioTypeValid) {
        issues.push('scenarioType is blank/UNKNOWN');
    }
    wiringIssues.forEach(w => issues.push(w));
    
    // ═══════════════════════════════════════════════════════════════════════
    // D) Does it pass the enterprise checklist?
    // ═══════════════════════════════════════════════════════════════════════
    
    // Enum validation
    const invalidEnums = [];
    if (scenarioType && !isAllowedScenarioType(scenarioType)) {
        invalidEnums.push(`scenarioType: ${scenarioType}`);
    }
    if (actionType && !['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'].includes(actionType)) {
        invalidEnums.push(`actionType: ${actionType}`);
    }
    if (handoffPolicy && !['never', 'low_confidence', 'always_on_keyword', 'emergency_only'].includes(handoffPolicy)) {
        invalidEnums.push(`handoffPolicy: ${handoffPolicy}`);
    }
    
    const enumsCheck = {
        invalid: invalidEnums,
        pass: invalidEnums.length === 0
    };
    invalidEnums.forEach(e => issues.push(`Invalid enum: ${e}`));
    
    // Placeholder validation
    const allText = [
        ...quickReplies.map(r => typeof r === 'string' ? r : r.text || ''),
        ...fullReplies.map(r => typeof r === 'string' ? r : r.text || '')
    ].join(' ');
    const placeholderMatches = allText.match(/\{\{(\w+)\}\}/g) || [];
    const usedPlaceholders = [...new Set(placeholderMatches.map(m => m.replace(/\{\{|\}\}/g, '')))];
    const missingPlaceholders = usedPlaceholders.filter(ph => 
        context.placeholderKeys && 
        !context.placeholderKeys.includes(ph) && 
        !['companyName', 'companyPhone'].includes(ph)
    );
    
    const placeholdersCheck = {
        used: usedPlaceholders,
        missing: missingPlaceholders,
        pass: missingPlaceholders.length === 0
    };
    if (missingPlaceholders.length > 0) {
        warnings.push(`Missing placeholders: ${missingPlaceholders.join(', ')}`);
    }
    
    // Missing fields check (vs schemaMirror)
    const missingFields = [];
    SCENARIO_SCHEMA_FIELDS.forEach(field => {
        // Check if field is completely missing (not just null)
        if (scenario[field] === undefined) {
            missingFields.push(field);
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // Calculate overall grade and status
    // ═══════════════════════════════════════════════════════════════════════
    
    const allChecks = [
        triggersCheck.pass,
        negativesCheck.pass,
        quickRepliesCheck.pass,
        fullRepliesCheck.pass,
        wiringCheck.pass,
        enumsCheck.pass,
        placeholdersCheck.pass
    ];
    
    const passCount = allChecks.filter(c => c).length;
    const failCount = allChecks.length - passCount;
    
    // Calculate score
    let score = 100;
    if (!triggersCheck.pass) score -= 15;
    if (!negativesCheck.pass) score -= 10;
    if (!quickRepliesCheck.pass) score -= 15;
    if (!fullRepliesCheck.pass) score -= 15;
    if (!wiringCheck.pass) score -= 20;
    if (!wiringCheck.scenarioTypeValid) score -= 10;
    if (!enumsCheck.pass) score -= 15;
    score -= warnings.length * 2;
    score = Math.max(0, Math.min(100, score));
    
    // Grade
    let grade;
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 65) grade = 'C';
    else if (score >= 50) grade = 'D';
    else grade = 'F';
    
    // Status
    let status;
    if (failCount === 0 && warnings.length <= 1) status = 'GREEN';
    else if (failCount <= 2 && issues.length <= 3) status = 'YELLOW';
    else status = 'RED';
    
    return {
        grade,
        score,
        status,
        passCount,
        failCount,
        
        checks: {
            triggers: triggersCheck,
            negatives: negativesCheck,
            keywords: keywordsCheck,
            confidence: confidenceCheck,
            priority: priorityCheck,
            quickReplies: quickRepliesCheck,
            fullReplies: fullRepliesCheck,
            replyPolicy: replyPolicyCheck,
            wiring: wiringCheck,
            enums: enumsCheck,
            placeholders: placeholdersCheck
        },
        
        issues,
        warnings,
        missingFields,
        
        enterpriseReady: status === 'GREEN' && missingFields.length < 10
    };
}

const DynamicFlow = require('../../models/DynamicFlow');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');

// Security middleware
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/scenario-export
 * 
 * Query params:
 * - templateId (optional): Filter to specific template
 * - categoryId (optional): Filter to specific category
 * - format (optional): 'full' (default) | 'summary'
 * - includeDisabled (optional): true/false (default true)
 * 
 * Returns complete scenario configuration with ALL fields
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { templateId, categoryId, format = 'full', includeDisabled = 'true' } = req.query;
    
    try {
        logger.info(`📦 [SCENARIO EXPORT] Starting export for company ${companyId}`);
        
        // Load company and context data in parallel
        const [company, placeholdersDoc, dynamicFlows] = await Promise.all([
            v2Company.findById(companyId).select('companyName tradeKey industryType').lean(),
            CompanyPlaceholders.findOne({ companyId }).lean(),
            DynamicFlow.find({ companyId }).lean()
        ]);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Build validation context
        const validationContext = {
            companyId,
            flowIds: dynamicFlows.map(f => f._id.toString()),
            placeholderKeys: (placeholdersDoc?.placeholders || []).map(p => p.key)
        };
        
        // Build query
        const query = {};
        if (templateId) {
            query._id = templateId;
        }
        
        // Load templates
        const templates = await GlobalInstantResponseTemplate.find(query).lean();
        
        if (templates.length === 0) {
            return res.json({
                success: true,
                data: {
                    meta: {
                        companyId,
                        companyName: company.companyName,
                        exportedAt: new Date().toISOString(),
                        format,
                        templatesFound: 0
                    },
                    templates: []
                }
            });
        }
        
        // Process templates
        const exportedTemplates = [];
        let totalCategories = 0;
        let totalScenarios = 0;
        const allScenariosForCollision = [];
        
        for (const template of templates) {
            const templateExport = {
                // ═══════════════════════════════════════════════════════════
                // TEMPLATE META
                // ═══════════════════════════════════════════════════════════
                templateId: template._id.toString(),
                name: template.name,
                description: template.description,
                templateType: template.templateType,
                industryLabel: template.industryLabel,
                version: template.version,
                isActive: template.isActive,
                isPublished: template.isPublished,
                isDefaultTemplate: template.isDefaultTemplate,
                
                // ═══════════════════════════════════════════════════════════
                // TEMPLATE-LEVEL CONFIG
                // ═══════════════════════════════════════════════════════════
                fillerWords: template.fillerWords || [],
                synonymMap: template.synonymMap || {},
                
                // ═══════════════════════════════════════════════════════════
                // CATEGORIES WITH FULL SCHEMA
                // ═══════════════════════════════════════════════════════════
                categories: []
            };
            
            for (const category of template.categories || []) {
                // Filter by categoryId if specified
                if (categoryId && category.id !== categoryId) continue;
                
                totalCategories++;
                const scopeInfo = getScopeDisplayInfo(category, companyId);
                
                const categoryExport = {
                    // ═══════════════════════════════════════════════════════
                    // CATEGORY IDENTITY
                    // ═══════════════════════════════════════════════════════
                    id: category.id,
                    name: category.name,
                    icon: category.icon,
                    description: category.description,
                    behavior: category.behavior,
                    isActive: category.isActive,
                    
                    // ═══════════════════════════════════════════════════════
                    // SCOPE LOCK FIELDS
                    // ═══════════════════════════════════════════════════════
                    scope: category.scope || 'GLOBAL',
                    ownerCompanyId: category.ownerCompanyId?.toString() || null,
                    lockMode: category.lockMode || 'HARD',
                    lockReason: category.lockReason || null,
                    editPolicy: category.editPolicy || {
                        allowEditsInCompanyUI: false,
                        allowEditsInGlobalUI: true,
                        requireCloneToEdit: true
                    },
                    
                    // ═══════════════════════════════════════════════════════
                    // OVERRIDE TRACKING
                    // ═══════════════════════════════════════════════════════
                    sourceTemplateId: category.sourceTemplateId?.toString() || null,
                    sourceCategoryId: category.sourceCategoryId || null,
                    overridesGlobalCategoryId: category.overridesGlobalCategoryId || null,
                    createdFromCloneAt: category.createdFromCloneAt || null,
                    createdFromCloneBy: category.createdFromCloneBy || null,
                    
                    // ═══════════════════════════════════════════════════════
                    // ENTERPRISE AUDIT FIELDS
                    // ═══════════════════════════════════════════════════════
                    editContext: category.editContext || null,
                    lastEditedAt: category.lastEditedAt || null,
                    lastEditedBy: category.lastEditedBy || null,
                    lastEditedFromContext: category.lastEditedFromContext || null,
                    lastEditAttemptBlockedAt: category.lastEditAttemptBlockedAt || null,
                    lastEditAttemptBlockedBy: category.lastEditAttemptBlockedBy || null,
                    lastEditAttemptBlockedReason: category.lastEditAttemptBlockedReason || null,
                    editBlockCount: category.editBlockCount || 0,
                    
                    // ═══════════════════════════════════════════════════════
                    // CATEGORY-LEVEL EXTENSIONS
                    // ═══════════════════════════════════════════════════════
                    additionalFillerWords: category.additionalFillerWords || [],
                    synonymMap: category.synonymMap || {},
                    
                    // ═══════════════════════════════════════════════════════
                    // COMPUTED SCOPE INFO
                    // ═══════════════════════════════════════════════════════
                    _scopeInfo: scopeInfo,
                    
                    // ═══════════════════════════════════════════════════════
                    // SCENARIOS WITH FULL SCHEMA
                    // ═══════════════════════════════════════════════════════
                    scenarios: []
                };
                
                for (const scenario of category.scenarios || []) {
                    // Skip disabled if requested
                    if (includeDisabled !== 'true' && !scenario.isActive) continue;
                    
                    totalScenarios++;
                    const scenarioScopeInfo = getScopeDisplayInfo(scenario, companyId);
                    
                    // Generate COMPUTED REPORT (the PROOF)
                    const report = generateScenarioReport(scenario, validationContext);
                    
                    // Track for collision detection
                    allScenariosForCollision.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        triggers: scenario.triggers || [],
                        scenarioType: scenario.scenarioType,
                        priority: scenario.priority || 0
                    });
                    
                    const scenarioExport = {
                        // ═══════════════════════════════════════════════════
                        // IDENTITY & LIFECYCLE
                        // ═══════════════════════════════════════════════════
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        version: scenario.version || 1,
                        status: scenario.status || 'live',
                        isActive: scenario.isActive !== false,
                        
                        // ═══════════════════════════════════════════════════
                        // SCOPE LOCK FIELDS
                        // ═══════════════════════════════════════════════════
                        scope: scenario.scope || 'GLOBAL',
                        ownerCompanyId: scenario.ownerCompanyId?.toString() || null,
                        lockMode: scenario.lockMode || 'HARD',
                        lockReason: scenario.lockReason || null,
                        editPolicy: scenario.editPolicy || {
                            allowEditsInCompanyUI: false,
                            allowEditsInGlobalUI: true,
                            requireCloneToEdit: true
                        },
                        
                        // ═══════════════════════════════════════════════════
                        // OVERRIDE TRACKING
                        // ═══════════════════════════════════════════════════
                        sourceTemplateId: scenario.sourceTemplateId?.toString() || null,
                        sourceScenarioId: scenario.sourceScenarioId || null,
                        overridesGlobalScenarioId: scenario.overridesGlobalScenarioId || null,
                        createdFromCloneAt: scenario.createdFromCloneAt || null,
                        createdFromCloneBy: scenario.createdFromCloneBy || null,
                        
                        // ═══════════════════════════════════════════════════
                        // ENTERPRISE AUDIT FIELDS
                        // ═══════════════════════════════════════════════════
                        editContext: scenario.editContext || null,
                        lastEditedAt: scenario.lastEditedAt || null,
                        lastEditedBy: scenario.lastEditedBy || null,
                        lastEditedFromContext: scenario.lastEditedFromContext || null,
                        lastEditAttemptBlockedAt: scenario.lastEditAttemptBlockedAt || null,
                        lastEditAttemptBlockedBy: scenario.lastEditAttemptBlockedBy || null,
                        lastEditAttemptBlockedReason: scenario.lastEditAttemptBlockedReason || null,
                        editBlockCount: scenario.editBlockCount || 0,
                        
                        // ═══════════════════════════════════════════════════
                        // CATEGORIZATION & ORGANIZATION
                        // ═══════════════════════════════════════════════════
                        categories: scenario.categories || [],
                        priority: scenario.priority ?? 0,
                        cooldownSeconds: scenario.cooldownSeconds ?? 0,
                        
                        // ═══════════════════════════════════════════════════
                        // MULTILINGUAL & CHANNEL SUPPORT
                        // ═══════════════════════════════════════════════════
                        language: scenario.language || 'auto',
                        channel: scenario.channel || 'any',
                        
                        // ═══════════════════════════════════════════════════
                        // HYBRID MATCHING - THE INTELLIGENCE CORE
                        // ═══════════════════════════════════════════════════
                        triggers: triggers,
                        regexTriggers: scenario.regexTriggers || [],
                        negativeTriggers: negativeTriggers,
                        keywords: keywords,
                        negativeKeywords: scenario.negativeKeywords || [],
                        exampleUserPhrases: scenario.exampleUserPhrases || [],
                        negativeUserPhrases: scenario.negativeUserPhrases || [],
                        testPhrases: scenario.testPhrases || [],
                        minConfidence: scenario.minConfidence ?? null,
                        contextWeight: scenario.contextWeight ?? 0.7,
                        embeddingVector: scenario.embeddingVector ? '[VECTOR_EXISTS]' : null,
                        
                        // ═══════════════════════════════════════════════════
                        // STATE MACHINE
                        // ═══════════════════════════════════════════════════
                        preconditions: scenario.preconditions || {},
                        effects: scenario.effects || {},
                        
                        // ═══════════════════════════════════════════════════
                        // RESPONSE SYSTEM - MULTI-REPLY MANAGEMENT (7+ each!)
                        // ═══════════════════════════════════════════════════
                        quickReplies: quickReplies,
                        fullReplies: fullReplies,
                        followUpPrompts: scenario.followUpPrompts || [],
                        followUpFunnel: scenario.followUpFunnel || null,
                        replySelection: scenario.replySelection || 'bandit',
                        replyStrategy: scenario.replyStrategy || 'AUTO',
                        replyBundles: scenario.replyBundles || { short: [], long: [] },
                        replyPolicy: scenario.replyPolicy || 'ROTATE_PER_CALLER',
                        
                        // ═══════════════════════════════════════════════════
                        // SCENARIO TYPE (Classification)
                        // ═══════════════════════════════════════════════════
                        scenarioType: scenario.scenarioType || 'UNKNOWN',
                        
                        // ═══════════════════════════════════════════════════
                        // 🔗 WIRING - What makes scenarios DO something
                        // ═══════════════════════════════════════════════════
                        actionType: scenario.actionType || null,
                        flowId: scenario.flowId?.toString() || null,
                        bookingIntent: scenario.bookingIntent || false,
                        requiredSlots: scenario.requiredSlots || [],
                        stopRouting: scenario.stopRouting || false,
                        
                        // WIRING VALIDATION
                        wiringValidated: scenario.wiringValidated || false,
                        wiringValidatedAt: scenario.wiringValidatedAt || null,
                        wiringIssues: scenario.wiringIssues || [],
                        
                        // ═══════════════════════════════════════════════════
                        // FOLLOW-UP BEHAVIOR
                        // ═══════════════════════════════════════════════════
                        followUpMode: scenario.followUpMode || 'NONE',
                        followUpQuestionText: scenario.followUpQuestionText || null,
                        transferTarget: scenario.transferTarget || null,
                        
                        // ═══════════════════════════════════════════════════
                        // ENTITY CAPTURE & VALIDATION
                        // ═══════════════════════════════════════════════════
                        entityCapture: scenario.entityCapture || [],
                        entityValidation: scenario.entityValidation || {},
                        dynamicVariables: scenario.dynamicVariables || {},
                        
                        // ═══════════════════════════════════════════════════
                        // ACTION HOOKS & HANDOFF
                        // ═══════════════════════════════════════════════════
                        actionHooks: scenario.actionHooks || [],
                        handoffPolicy: scenario.handoffPolicy || 'low_confidence',
                        escalationFlags: scenario.escalationFlags || [],
                        
                        // ═══════════════════════════════════════════════════
                        // AUTOFILL PROTECTION
                        // ═══════════════════════════════════════════════════
                        autofillLock: scenario.autofillLock || false,
                        lastAutofillAt: scenario.lastAutofillAt || null,
                        lastAutofillVersion: scenario.lastAutofillVersion || null,
                        lastManualTuneAt: scenario.lastManualTuneAt || null,
                        lastManualTuneBy: scenario.lastManualTuneBy || null,
                        
                        // ═══════════════════════════════════════════════════
                        // SENSITIVE DATA
                        // ═══════════════════════════════════════════════════
                        sensitiveInfoRule: scenario.sensitiveInfoRule || 'platform_default',
                        customMasking: scenario.customMasking || {},
                        
                        // ═══════════════════════════════════════════════════
                        // TIMING
                        // ═══════════════════════════════════════════════════
                        timedFollowUp: scenario.timedFollowUp || { enabled: false },
                        silencePolicy: scenario.silencePolicy || {},
                        
                        // ═══════════════════════════════════════════════════
                        // AI INTELLIGENCE
                        // ═══════════════════════════════════════════════════
                        qnaPairs: scenario.qnaPairs || [],
                        examples: scenario.examples || [],
                        
                        // ═══════════════════════════════════════════════════
                        // VOICE & TTS
                        // ═══════════════════════════════════════════════════
                        behavior: scenario.behavior || null,
                        toneLevel: scenario.toneLevel ?? 2,
                        ttsOverride: scenario.ttsOverride || {},
                        
                        // ═══════════════════════════════════════════════════
                        // METADATA
                        // ═══════════════════════════════════════════════════
                        notes: scenario.notes || '',
                        createdAt: scenario.createdAt || null,
                        updatedAt: scenario.updatedAt || null,
                        createdBy: scenario.createdBy || null,
                        updatedBy: scenario.updatedBy || null,
                        
                        // ═══════════════════════════════════════════════════
                        // LEGACY FIELDS
                        // ═══════════════════════════════════════════════════
                        quickReply: scenario.quickReply || null,
                        fullReply: scenario.fullReply || null,
                        legacyMigrated: scenario.legacyMigrated || false,
                        
                        // ═══════════════════════════════════════════════════
                        // 📊 COMPUTED REPORT (THE PROOF)
                        // This block proves the scenario is set right
                        // ═══════════════════════════════════════════════════
                        report: report,
                        
                        // ═══════════════════════════════════════════════════
                        // SCOPE INFO
                        // ═══════════════════════════════════════════════════
                        _scopeInfo: scenarioScopeInfo
                    };
                    
                    categoryExport.scenarios.push(scenarioExport);
                }
                
                templateExport.categories.push(categoryExport);
            }
            
            exportedTemplates.push(templateExport);
        }
        
        // Calculate quality distribution from reports
        const allScenarios = exportedTemplates.flatMap(t => 
            t.categories.flatMap(c => c.scenarios)
        );
        
        const gradeDistribution = {
            A: allScenarios.filter(s => s.report?.grade === 'A').length,
            B: allScenarios.filter(s => s.report?.grade === 'B').length,
            C: allScenarios.filter(s => s.report?.grade === 'C').length,
            D: allScenarios.filter(s => s.report?.grade === 'D').length,
            F: allScenarios.filter(s => s.report?.grade === 'F').length
        };
        
        const statusDistribution = {
            GREEN: allScenarios.filter(s => s.report?.status === 'GREEN').length,
            YELLOW: allScenarios.filter(s => s.report?.status === 'YELLOW').length,
            RED: allScenarios.filter(s => s.report?.status === 'RED').length
        };
        
        const qualitySummary = {
            meetsTriggers: allScenarios.filter(s => s.report?.checks?.triggers?.pass).length,
            meetsNegatives: allScenarios.filter(s => s.report?.checks?.negatives?.pass).length,
            meetsQuickReplies: allScenarios.filter(s => s.report?.checks?.quickReplies?.pass).length,
            meetsFullReplies: allScenarios.filter(s => s.report?.checks?.fullReplies?.pass).length,
            hasValidScenarioType: allScenarios.filter(s => s.report?.checks?.wiring?.scenarioTypeValid).length,
            hasValidWiring: allScenarios.filter(s => s.report?.checks?.wiring?.pass).length,
            enterpriseReady: allScenarios.filter(s => s.report?.enterpriseReady).length
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // COLLISION DETECTION
        // ═══════════════════════════════════════════════════════════════════════
        const collisions = detectCollisions(allScenariosForCollision);
        
        // Build response
        const response = {
            success: true,
            data: {
                // ═══════════════════════════════════════════════════════════
                // EXPORT METADATA
                // ═══════════════════════════════════════════════════════════
                meta: {
                    companyId,
                    companyName: company.companyName,
                    tradeKey: company.tradeKey || company.industryType || 'universal',
                    exportedAt: new Date().toISOString(),
                    exportedInMs: Date.now() - startTime,
                    format,
                    filters: {
                        templateId: templateId || 'all',
                        categoryId: categoryId || 'all',
                        includeDisabled: includeDisabled === 'true'
                    },
                    counts: {
                        templates: exportedTemplates.length,
                        categories: totalCategories,
                        scenarios: totalScenarios
                    },
                    schemaVersion: 'V22.1',
                    resolutionOrder: getResolutionOrder()
                },
                
                // ═══════════════════════════════════════════════════════════
                // SCHEMA MIRROR - Proof of completeness
                // If a field is here but not in scenario objects, that's a bug
                // ═══════════════════════════════════════════════════════════
                schemaMirror: {
                    scenarioFields: SCENARIO_SCHEMA_FIELDS,
                    scenarioFieldCount: SCENARIO_SCHEMA_FIELDS.length,
                    categoryFields: CATEGORY_SCHEMA_FIELDS,
                    categoryFieldCount: CATEGORY_SCHEMA_FIELDS.length,
                    qualityRequirements: QUALITY_REQUIREMENTS,
                    wiringFields: [
                        'actionType', 'flowId', 'bookingIntent', 'requiredSlots', 'stopRouting',
                        'transferTarget', 'handoffPolicy', 'followUpMode'
                    ],
                    allowedEnums: {
                        scenarioType: ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'BILLING', 'TRANSFER', 'SMALL_TALK', 'SYSTEM', 'UNKNOWN'],
                        actionType: ['REPLY_ONLY', 'START_FLOW', 'REQUIRE_BOOKING', 'TRANSFER', 'SMS_FOLLOWUP'],
                        handoffPolicy: ['never', 'low_confidence', 'always_on_keyword', 'emergency_only'],
                        followUpMode: ['NONE', 'ASK_FOLLOWUP_QUESTION', 'ASK_IF_BOOK', 'TRANSFER'],
                        replyPolicy: ['ROTATE_PER_CALLER', 'ROTATE_PER_SESSION', 'WEIGHTED_RANDOM', 'SEQUENTIAL'],
                        replySelection: ['sequential', 'random', 'bandit'],
                        replyStrategy: ['AUTO', 'FULL_ONLY', 'QUICK_ONLY', 'QUICK_THEN_FULL', 'LLM_WRAP', 'LLM_CONTEXT'],
                        status: ['draft', 'live', 'archived'],
                        scope: ['GLOBAL', 'COMPANY']
                    }
                },
                
                // ═══════════════════════════════════════════════════════════
                // OVERALL HEALTH - Quick answer: is this template production-ready?
                // ═══════════════════════════════════════════════════════════
                health: statusDistribution.RED > 0 ? 'RED' 
                    : statusDistribution.YELLOW > totalScenarios * 0.2 ? 'YELLOW' 
                    : 'GREEN',
                healthMessage: statusDistribution.RED > 0 
                    ? `${statusDistribution.RED} scenarios have critical issues`
                    : statusDistribution.YELLOW > 0 
                    ? `${statusDistribution.YELLOW} scenarios need attention`
                    : 'All scenarios meet quality requirements',
                
                // ═══════════════════════════════════════════════════════════
                // QUALITY SUMMARY - How many scenarios meet requirements
                // ═══════════════════════════════════════════════════════════
                qualitySummary: {
                    gradeDistribution,
                    statusDistribution,
                    compliance: qualitySummary,
                    totalScenarios,
                    percentMeetingTriggers: totalScenarios > 0 ? Math.round(qualitySummary.meetsTriggers / totalScenarios * 100) : 0,
                    percentMeetingReplies: totalScenarios > 0 ? Math.round(Math.min(qualitySummary.meetsQuickReplies, qualitySummary.meetsFullReplies) / totalScenarios * 100) : 0,
                    percentWithValidWiring: totalScenarios > 0 ? Math.round(qualitySummary.hasValidWiring / totalScenarios * 100) : 0,
                    percentEnterpriseReady: totalScenarios > 0 ? Math.round(qualitySummary.enterpriseReady / totalScenarios * 100) : 0
                },
                
                // ═══════════════════════════════════════════════════════════
                // COLLISIONS - Shared triggers between scenarios
                // ═══════════════════════════════════════════════════════════
                collisions: {
                    count: collisions.length,
                    errors: collisions.filter(c => c.severity === 'ERROR').length,
                    warnings: collisions.filter(c => c.severity === 'WARNING').length,
                    items: collisions.slice(0, 20) // Top 20 collisions
                },
                
                // ═══════════════════════════════════════════════════════════
                // TOP ISSUES - Quick view of what needs fixing
                // ═══════════════════════════════════════════════════════════
                topIssues: allScenarios
                    .filter(s => s.report?.status !== 'GREEN')
                    .sort((a, b) => {
                        // Sort by status (RED first), then by issue count
                        const statusOrder = { RED: 0, YELLOW: 1, GREEN: 2 };
                        const statusDiff = statusOrder[a.report?.status || 'GREEN'] - statusOrder[b.report?.status || 'GREEN'];
                        if (statusDiff !== 0) return statusDiff;
                        return (b.report?.issues?.length || 0) - (a.report?.issues?.length || 0);
                    })
                    .slice(0, 10)
                    .map(s => ({
                        scenarioId: s.scenarioId,
                        name: s.name,
                        grade: s.report?.grade,
                        status: s.report?.status,
                        issues: s.report?.issues?.slice(0, 5),
                        warnings: s.report?.warnings?.slice(0, 3)
                    })),
                
                // ═══════════════════════════════════════════════════════════
                // FULL TEMPLATE DATA
                // ═══════════════════════════════════════════════════════════
                templates: exportedTemplates
            }
        };
        
        logger.info(`✅ [SCENARIO EXPORT] Exported ${totalScenarios} scenarios in ${Date.now() - startTime}ms`);
        
        res.json(response);
        
    } catch (error) {
        logger.error('[SCENARIO EXPORT] Export failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/scenario-export/summary
 * 
 * Returns a lightweight summary without full scenario bodies
 * Useful for inventory views
 */
router.get('/summary', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const templates = await GlobalInstantResponseTemplate.find({})
            .select('name templateType version isActive isPublished categories.id categories.name categories.isActive categories.scenarios.scenarioId categories.scenarios.name categories.scenarios.isActive categories.scenarios.scope categories.scenarios.ownerCompanyId')
            .lean();
        
        const summary = {
            companyId,
            generatedAt: new Date().toISOString(),
            templates: templates.map(t => ({
                templateId: t._id.toString(),
                name: t.name,
                isActive: t.isActive,
                isPublished: t.isPublished,
                categories: (t.categories || []).map(c => ({
                    id: c.id,
                    name: c.name,
                    isActive: c.isActive,
                    scenarioCount: (c.scenarios || []).length,
                    globalCount: (c.scenarios || []).filter(s => (s.scope || 'GLOBAL') === 'GLOBAL').length,
                    companyOverrideCount: (c.scenarios || []).filter(s => 
                        s.scope === 'COMPANY' && s.ownerCompanyId?.toString() === companyId
                    ).length
                }))
            }))
        };
        
        res.json({ success: true, data: summary });
        
    } catch (error) {
        logger.error('[SCENARIO EXPORT] Summary failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


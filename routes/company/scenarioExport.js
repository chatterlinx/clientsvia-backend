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
        
        // Load company for context
        const company = await v2Company.findById(companyId)
            .select('companyName tradeKey industryType')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
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
                    
                    // Calculate quality metrics
                    const triggers = scenario.triggers || [];
                    const negativeTriggers = scenario.negativeTriggers || [];
                    const quickReplies = scenario.quickReplies || [];
                    const fullReplies = scenario.fullReplies || [];
                    const keywords = scenario.keywords || [];
                    
                    const qualityMetrics = {
                        triggerCount: triggers.length,
                        negativeTriggerCount: negativeTriggers.length,
                        quickReplyCount: quickReplies.length,
                        fullReplyCount: fullReplies.length,
                        keywordCount: keywords.length,
                        meetsMinTriggers: triggers.length >= QUALITY_REQUIREMENTS.minTriggers,
                        meetsMinNegatives: negativeTriggers.length >= QUALITY_REQUIREMENTS.minNegativeTriggers,
                        meetsMinQuickReplies: quickReplies.length >= QUALITY_REQUIREMENTS.minQuickReplies,
                        meetsMinFullReplies: fullReplies.length >= QUALITY_REQUIREMENTS.minFullReplies,
                        grade: calculateGrade(triggers.length, negativeTriggers.length, quickReplies.length, fullReplies.length, scenario.scenarioType)
                    };
                    
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
                        // COMPUTED QUALITY METRICS
                        // ═══════════════════════════════════════════════════
                        _qualityMetrics: qualityMetrics,
                        _scopeInfo: scenarioScopeInfo
                    };
                    
                    categoryExport.scenarios.push(scenarioExport);
                }
                
                templateExport.categories.push(categoryExport);
            }
            
            exportedTemplates.push(templateExport);
        }
        
        // Calculate quality distribution
        const allScenarios = exportedTemplates.flatMap(t => 
            t.categories.flatMap(c => c.scenarios)
        );
        const gradeDistribution = {
            A: allScenarios.filter(s => s._qualityMetrics.grade === 'A').length,
            B: allScenarios.filter(s => s._qualityMetrics.grade === 'B').length,
            C: allScenarios.filter(s => s._qualityMetrics.grade === 'C').length,
            D: allScenarios.filter(s => s._qualityMetrics.grade === 'D').length,
            F: allScenarios.filter(s => s._qualityMetrics.grade === 'F').length
        };
        
        const qualitySummary = {
            meetsTriggers: allScenarios.filter(s => s._qualityMetrics.meetsMinTriggers).length,
            meetsNegatives: allScenarios.filter(s => s._qualityMetrics.meetsMinNegatives).length,
            meetsQuickReplies: allScenarios.filter(s => s._qualityMetrics.meetsMinQuickReplies).length,
            meetsFullReplies: allScenarios.filter(s => s._qualityMetrics.meetsMinFullReplies).length,
            hasScenarioType: allScenarios.filter(s => s.scenarioType && s.scenarioType !== 'UNKNOWN').length,
            hasWiring: allScenarios.filter(s => s.actionType || s.flowId || s.transferTarget || s.bookingIntent).length
        };
        
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
                // QUALITY SUMMARY - How many scenarios meet requirements
                // ═══════════════════════════════════════════════════════════
                qualitySummary: {
                    gradeDistribution,
                    compliance: qualitySummary,
                    totalScenarios,
                    percentMeetingTriggers: totalScenarios > 0 ? Math.round(qualitySummary.meetsTriggers / totalScenarios * 100) : 0,
                    percentMeetingReplies: totalScenarios > 0 ? Math.round(Math.min(qualitySummary.meetsQuickReplies, qualitySummary.meetsFullReplies) / totalScenarios * 100) : 0,
                    percentWithWiring: totalScenarios > 0 ? Math.round(qualitySummary.hasWiring / totalScenarios * 100) : 0
                },
                
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


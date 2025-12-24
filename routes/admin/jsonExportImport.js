/**
 * ============================================================================
 * JSON EXPORT / IMPORT / PATCH API
 * ============================================================================
 * 
 * Enables ChatGPT (Prime) → AI Coder workflow:
 * 1) Export JSON - full config for analysis
 * 2) Apply Patch - update config from ChatGPT directives
 * 3) Validate - check for gaps and issues
 * 
 * ROUTES:
 * - GET  /api/export/company/:companyId          Full company config export
 * - GET  /api/export/template/:templateId        Full template export (all cats/scenarios)
 * - GET  /api/export/category/:templateId/:catId Single category export
 * - GET  /api/export/scenario/:templateId/:catId/:scenarioId  Single scenario export
 * - POST /api/apply-patch                        Apply JSON patch to template/company
 * - GET  /api/validate/template/:templateId      Validate template completeness
 * - POST /api/test-utterances                    Test utterances against scenarios
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Models
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const Company = require('../../models/v2Company');
const CompanyScenarioOverride = require('../../models/CompanyScenarioOverride');
const CompanyCategoryOverride = require('../../models/CompanyCategoryOverride');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const DynamicFlow = require('../../models/DynamicFlow');

// ============================================================================
// SCHEMA VERSION - Increment when export format changes
// ============================================================================
const EXPORT_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// MIDDLEWARE
// ============================================================================
router.use(authenticateJWT);

// ============================================================================
// HELPER: Build scenario export object - FULL SCHEMA V22
// ============================================================================
function buildScenarioExport(scenario, categoryId, categoryName, templateId) {
    return {
        // ═══════════════════════════════════════════════════════════════════
        // EXPORT METADATA
        // ═══════════════════════════════════════════════════════════════════
        _exportedAt: new Date().toISOString(),
        _schemaVersion: 'V22',
        _originalScenarioId: scenario.scenarioId || scenario.id || scenario._id?.toString(),
        _categoryId: categoryId,
        _templateId: templateId,
        
        // ═══════════════════════════════════════════════════════════════════
        // IDENTITY & LIFECYCLE
        // ═══════════════════════════════════════════════════════════════════
        scenarioId: scenario.scenarioId || scenario.id || scenario._id?.toString(),
        name: scenario.name,
        version: scenario.version || 1,
        status: scenario.status || 'draft',
        isActive: scenario.isActive !== false,
        
        // ═══════════════════════════════════════════════════════════════════
        // CLASSIFICATION
        // ═══════════════════════════════════════════════════════════════════
        scenarioType: scenario.scenarioType || '',
        priority: scenario.priority ?? 50,
        behaviorId: scenario.behaviorId || scenario.behavior || '',
        
        // ═══════════════════════════════════════════════════════════════════
        // CHANNEL & LANGUAGE
        // ═══════════════════════════════════════════════════════════════════
        channel: scenario.channel || 'any',
        language: scenario.language || 'auto',
        
        // ═══════════════════════════════════════════════════════════════════
        // TRIGGERS (THE MATCHING BRAIN)
        // ═══════════════════════════════════════════════════════════════════
        triggers: scenario.triggers || [],
        negativeTriggers: scenario.negativeTriggers || [],
        regexTriggers: scenario.regexTriggers || [],
        keywords: scenario.keywords || [],
        negativeKeywords: scenario.negativeKeywords || [],
        
        // ═══════════════════════════════════════════════════════════════════
        // MATCHING CONFIDENCE
        // ═══════════════════════════════════════════════════════════════════
        minConfidence: scenario.minConfidence ?? 0.7,
        contextWeight: scenario.contextWeight ?? 0.8,
        
        // ═══════════════════════════════════════════════════════════════════
        // REPLIES (NEED 7-10 FOR VARIETY)
        // ═══════════════════════════════════════════════════════════════════
        quickReplies: scenario.quickReplies || scenario.responses || [],
        fullReplies: scenario.fullReplies || [],
        
        // ═══════════════════════════════════════════════════════════════════
        // REPLY STRATEGY & FLOW
        // ═══════════════════════════════════════════════════════════════════
        replySelection: scenario.replySelection || 'random',
        replyStrategy: scenario.replyStrategy || 'AUTO',
        replyPolicy: scenario.replyPolicy || 'ROTATE_PER_CALLER',
        followUpFunnel: scenario.followUpFunnel || [],
        followUpMode: scenario.followUpMode || 'NONE',
        followUpQuestionText: scenario.followUpQuestionText || '',
        followUpPrompts: scenario.followUpPrompts || [],
        
        // ═══════════════════════════════════════════════════════════════════
        // TRANSFER & HANDOFF
        // ═══════════════════════════════════════════════════════════════════
        transferTarget: scenario.transferTarget || '',
        handoffPolicy: scenario.handoffPolicy || 'low_confidence',
        
        // ═══════════════════════════════════════════════════════════════════
        // WIRING (ACTION ON MATCH)
        // ═══════════════════════════════════════════════════════════════════
        actionType: scenario.actionType || 'REPLY_ONLY',
        flowId: scenario.flowId?.toString() || '',
        bookingIntent: scenario.bookingIntent || false,
        requiredSlots: scenario.requiredSlots || [],
        stopRouting: scenario.stopRouting || false,
        
        // ═══════════════════════════════════════════════════════════════════
        // ACTION HOOKS & ESCALATION
        // ═══════════════════════════════════════════════════════════════════
        actionHooks: scenario.actionHooks || [],
        escalationFlags: scenario.escalationFlags || [],
        
        // ═══════════════════════════════════════════════════════════════════
        // TIMING & SILENCE HANDLING
        // ═══════════════════════════════════════════════════════════════════
        cooldown: scenario.cooldown || scenario.cooldownSeconds || 0,
        timedFollowUp: scenario.timedFollowUp || {
            enabled: false,
            delay: 30,
            extension: 15,
            messages: []
        },
        silencePolicy: scenario.silencePolicy || {
            maxConsecutiveSilence: 2,
            finalWarning: ''
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // TTS OVERRIDES (VOICE SETTINGS)
        // ═══════════════════════════════════════════════════════════════════
        ttsOverride: scenario.ttsOverride || {
            pitch: '',
            rate: '',
            volume: ''
        },
        voiceSettings: scenario.voiceSettings || {},
        
        // ═══════════════════════════════════════════════════════════════════
        // ENTITY CAPTURE & VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        entityCapture: scenario.entityCapture || [],
        entityValidation: scenario.entityValidation || {},
        contextFields: scenario.contextFields || [],
        
        // ═══════════════════════════════════════════════════════════════════
        // PRECONDITIONS & EFFECTS (STATE MACHINE)
        // ═══════════════════════════════════════════════════════════════════
        preconditions: scenario.preconditions || {},
        effects: scenario.effects || {},
        
        // ═══════════════════════════════════════════════════════════════════
        // SCOPE LOCK (GLOBAL vs COMPANY)
        // ═══════════════════════════════════════════════════════════════════
        scope: scenario.scope || 'GLOBAL',
        ownerCompanyId: scenario.ownerCompanyId?.toString() || null,
        lockMode: scenario.lockMode || 'HARD',
        
        // ═══════════════════════════════════════════════════════════════════
        // METADATA & AUDIT
        // ═══════════════════════════════════════════════════════════════════
        tags: scenario.tags || [],
        notes: scenario.notes || '',
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
        createdBy: scenario.createdBy || null,
        updatedBy: scenario.updatedBy || null,
        
        // ═══════════════════════════════════════════════════════════════════
        // QUALITY STATS (COMPUTED)
        // ═══════════════════════════════════════════════════════════════════
        _stats: {
            triggerCount: (scenario.triggers || []).length,
            negativeTriggerCount: (scenario.negativeTriggers || []).length,
            keywordCount: (scenario.keywords || []).length,
            quickReplyCount: (scenario.quickReplies || scenario.responses || []).length,
            fullReplyCount: (scenario.fullReplies || []).length,
            hasFollowUp: (scenario.followUpMode && scenario.followUpMode !== 'NONE'),
            hasTransfer: !!(scenario.transferTarget),
            hasActionHooks: (scenario.actionHooks || []).length > 0,
            hasTimedFollowUp: !!(scenario.timedFollowUp?.enabled)
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // CATEGORY REFERENCE
        // ═══════════════════════════════════════════════════════════════════
        categoryId: categoryId,
        categoryName: categoryName
    };
}

// ============================================================================
// HELPER: Build category export object - FULL SCHEMA V22
// ============================================================================
function buildCategoryExport(category, templateId, templateName) {
    const categoryId = category.id || category._id?.toString();
    const scenarios = (category.scenarios || []).map(s => 
        buildScenarioExport(s, categoryId, category.name, templateId)
    );
    
    // Count triggers across all scenarios
    const totalTriggers = scenarios.reduce((sum, s) => sum + (s.triggers?.length || 0), 0);
    
    return {
        // ═══════════════════════════════════════════════════════════════════
        // IDENTITY
        // ═══════════════════════════════════════════════════════════════════
        categoryId: categoryId,
        name: category.name,
        icon: category.icon || '',
        description: category.description || '',
        behavior: category.behavior || '',
        
        // ═══════════════════════════════════════════════════════════════════
        // TEMPLATE REFERENCE
        // ═══════════════════════════════════════════════════════════════════
        templateId: templateId,
        templateName: templateName,
        
        // ═══════════════════════════════════════════════════════════════════
        // STATUS
        // ═══════════════════════════════════════════════════════════════════
        isActive: category.isActive !== false,
        priority: category.priority ?? 50,
        
        // ═══════════════════════════════════════════════════════════════════
        // SCOPE LOCK
        // ═══════════════════════════════════════════════════════════════════
        scope: category.scope || 'GLOBAL',
        ownerCompanyId: category.ownerCompanyId?.toString() || null,
        lockMode: category.lockMode || 'HARD',
        
        // ═══════════════════════════════════════════════════════════════════
        // CATEGORY-LEVEL NLP EXTENSIONS
        // ═══════════════════════════════════════════════════════════════════
        additionalFillerWords: category.additionalFillerWords || [],
        synonymMap: category.synonymMap || {},
        
        // ═══════════════════════════════════════════════════════════════════
        // STATS
        // ═══════════════════════════════════════════════════════════════════
        _stats: {
            scenarioCount: scenarios.length,
            totalTriggers: totalTriggers,
            activeScenarios: scenarios.filter(s => s.isActive).length
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // SCENARIOS (FULL EXPORT)
        // ═══════════════════════════════════════════════════════════════════
        scenarios: scenarios
    };
}

// ============================================================================
// HELPER: Validate scenario completeness
// ============================================================================
function validateScenario(scenario) {
    const issues = [];
    const warnings = [];
    
    // CRITICAL: Must have triggers
    if (!scenario.triggers || scenario.triggers.length === 0) {
        issues.push({
            type: 'MISSING_TRIGGERS',
            severity: 'error',
            message: 'Scenario has no triggers - will NEVER match'
        });
    }
    
    // CRITICAL: Need sufficient reply variety
    const quickCount = (scenario.quickReplies || []).length;
    const fullCount = (scenario.fullReplies || []).length;
    
    if (quickCount < 7) {
        issues.push({
            type: 'LOW_QUICK_REPLIES',
            severity: 'warning',
            message: `Only ${quickCount} quickReplies (need 7-10 for variety)`,
            current: quickCount,
            recommended: 7
        });
    }
    
    if (fullCount < 7) {
        issues.push({
            type: 'LOW_FULL_REPLIES',
            severity: 'warning',
            message: `Only ${fullCount} fullReplies (need 7-10 for variety)`,
            current: fullCount,
            recommended: 7
        });
    }
    
    // WARNING: High-collision scenarios need negative triggers
    const highCollisionTypes = ['pricing', 'hours', 'location', 'general_inquiry'];
    if (highCollisionTypes.includes(scenario.scenarioType) && 
        (!scenario.negativeTriggers || scenario.negativeTriggers.length === 0)) {
        warnings.push({
            type: 'MISSING_NEGATIVE_TRIGGERS',
            severity: 'warning',
            message: 'High-collision scenario type without negative triggers'
        });
    }
    
    // WARNING: Confidence sanity check
    if (scenario.minConfidence < 0.5) {
        warnings.push({
            type: 'CONFIDENCE_TOO_LOW',
            severity: 'warning',
            message: `minConfidence ${scenario.minConfidence} is very low - may cause false positives`
        });
    }
    if (scenario.minConfidence > 0.95) {
        warnings.push({
            type: 'CONFIDENCE_TOO_HIGH',
            severity: 'warning',
            message: `minConfidence ${scenario.minConfidence} is very high - may cause misses`
        });
    }
    
    return {
        valid: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        warnings,
        stats: {
            triggerCount: (scenario.triggers || []).length,
            negativeTriggerCount: (scenario.negativeTriggers || []).length,
            quickReplyCount: quickCount,
            fullReplyCount: fullCount
        }
    };
}

// ============================================================================
// GET /api/export/company/:companyId - Full company config export
// ============================================================================
router.get('/company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[JSON EXPORT] Company export request', { companyId });
        
        // Fetch company first to get template references
        const company = await Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Get active template IDs from company's templateReferences (the correct field)
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId?.toString())
            .filter(Boolean);
        
        logger.info('[JSON EXPORT] Template references found', { 
            companyId, 
            templateRefCount: templateRefs.length,
            activeTemplateIds 
        });
        
        // Fetch all data in parallel
        const [
            dynamicFlows,
            scenarioOverrides,
            categoryOverrides,
            responseDefaults,
            placeholders,
            activeTemplates
        ] = await Promise.all([
            DynamicFlow.find({ companyId: new mongoose.Types.ObjectId(companyId) }).lean(),
            CompanyScenarioOverride.find({ companyId: new mongoose.Types.ObjectId(companyId) }).lean(),
            CompanyCategoryOverride.find({ companyId: new mongoose.Types.ObjectId(companyId) }).lean(),
            CompanyResponseDefaults.findOne({ companyId: new mongoose.Types.ObjectId(companyId) }).lean(),
            CompanyPlaceholders.findOne({ companyId: new mongoose.Types.ObjectId(companyId) }).lean(),
            // Load templates by the IDs referenced by the company
            GlobalInstantResponseTemplate.find({ 
                _id: { $in: activeTemplateIds.map(id => new mongoose.Types.ObjectId(id)) }
            }).lean()
        ]);
        
        // Build categories/scenarios from active templates
        const categoriesExport = [];
        const scenariosExport = [];
        let totalTriggers = 0;
        
        for (const template of activeTemplates) {
            for (const category of (template.categories || [])) {
                const catExport = buildCategoryExport(category, template._id.toString(), template.name);
                categoriesExport.push(catExport);
                scenariosExport.push(...catExport.scenarios);
                // Count triggers
                for (const scenario of (category.scenarios || [])) {
                    totalTriggers += (scenario.triggers || []).length;
                }
            }
        }
        
        logger.info('[JSON EXPORT] Export data assembled', {
            companyId,
            templatesCount: activeTemplates.length,
            categoriesCount: categoriesExport.length,
            scenariosCount: scenariosExport.length,
            totalTriggers
        });
        
        // Build export object
        const exportObj = {
            _meta: {
                schemaVersion: EXPORT_SCHEMA_VERSION,
                exportType: 'company',
                exportedAt: new Date().toISOString(),
                companyId: companyId
            },
            
            company: {
                companyId: company._id.toString(),
                companyName: company.companyName,
                tradeKey: company.tradeKey || company.companyIndustry || 'unknown',
                environment: process.env.NODE_ENV || 'development'
            },
            
            // Summary counts for UI
            summary: {
                templatesCount: activeTemplates.length,
                categoriesCount: categoriesExport.length,
                scenariosCount: scenariosExport.length,
                totalTriggers: totalTriggers,
                dynamicFlowsCount: dynamicFlows.length
            },
            
            activeTemplates: activeTemplates.map(t => ({
                templateId: t._id.toString(),
                templateName: t.name, // Use 'name' not 'templateName'
                templateType: t.templateType,
                categoryCount: (t.categories || []).length,
                totalScenarios: (t.categories || []).reduce((sum, c) => sum + (c.scenarios || []).length, 0)
            })),
            
            categories: categoriesExport,
            scenarios: scenariosExport,
            
            overrides: {
                scenarioOverrides: scenarioOverrides.map(o => ({
                    scenarioId: o.scenarioId,
                    categoryId: o.categoryId,
                    enabled: o.enabled,
                    alternateReply: o.disabledAlternateReply,
                    fallbackPreference: o.fallbackPreference
                })),
                categoryOverrides: categoryOverrides.map(o => ({
                    categoryId: o.categoryId,
                    enabled: o.enabled,
                    defaultReply: o.disabledDefaultReply
                })),
                responseDefaults: responseDefaults ? {
                    notOfferedReply: responseDefaults.notOfferedReply,
                    unknownIntentReply: responseDefaults.unknownIntentReply,
                    afterHoursReply: responseDefaults.afterHoursReply,
                    strictDisabledBehavior: responseDefaults.strictDisabledBehavior
                } : null
            },
            
            placeholders: (placeholders?.placeholders || []).map(p => ({
                key: p.key,
                value: p.value
            })),
            
            dynamicFlows: dynamicFlows.map(f => ({
                flowKey: f.flowKey,
                name: f.name,
                enabled: f.enabled,
                priority: f.priority,
                triggerCount: (f.triggers || []).length,
                actionCount: (f.actions || []).length
            })),
            
            runtimeBindings: {
                scenarioEngineWired: true,
                dynamicFlowEngineWired: dynamicFlows.length > 0,
                callProtectionWired: true,
                transfersWired: true
            },
            
            completeness: {
                hasActiveTemplates: activeTemplates.length > 0,
                hasCategories: categoriesExport.length > 0,
                hasScenarios: scenariosExport.length > 0,
                hasPlaceholders: (placeholders?.placeholders || []).length > 0,
                hasDynamicFlows: dynamicFlows.length > 0
            }
        };
        
        res.json({
            success: true,
            export: exportObj
        });
        
    } catch (error) {
        logger.error('[JSON EXPORT] Company export failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/export/template/:templateId - Full template export
// ============================================================================
router.get('/template/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info('[JSON EXPORT] Template export request', { templateId });
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const categories = (template.categories || []).map(c => 
            buildCategoryExport(c, templateId, template.templateName)
        );
        
        const allScenarios = categories.flatMap(c => c.scenarios);
        
        // Validate all scenarios
        const validationResults = allScenarios.map(s => ({
            scenarioId: s.scenarioId,
            name: s.name,
            ...validateScenario(s)
        }));
        
        const exportObj = {
            _meta: {
                schemaVersion: EXPORT_SCHEMA_VERSION,
                exportType: 'template',
                exportedAt: new Date().toISOString(),
                templateId: templateId
            },
            
            template: {
                templateId: template._id.toString(),
                templateName: template.templateName,
                templateType: template.templateType,
                description: template.description,
                tradeCategory: template.tradeCategoryKey || template.tradeCategory,
                status: template.status,
                version: template.version
            },
            
            inheritedConfig: {
                synonyms: template.synonyms || {},
                fillers: template.fillers || [],
                urgencyKeywords: template.urgencyKeywords || []
            },
            
            learningSettings: template.learningSettings || {},
            
            categories: categories,
            
            summary: {
                categoryCount: categories.length,
                scenarioCount: allScenarios.length,
                enabledScenarios: allScenarios.filter(s => s.enabled).length,
                disabledScenarios: allScenarios.filter(s => !s.enabled).length
            },
            
            validation: {
                scenariosWithIssues: validationResults.filter(v => !v.valid).length,
                scenariosWithWarnings: validationResults.filter(v => v.warnings.length > 0).length,
                details: validationResults
            }
        };
        
        res.json({
            success: true,
            export: exportObj
        });
        
    } catch (error) {
        logger.error('[JSON EXPORT] Template export failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/export/category/:templateId/:categoryId - Single category export
// ============================================================================
router.get('/category/:templateId/:categoryId', async (req, res) => {
    try {
        const { templateId, categoryId } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const category = (template.categories || []).find(c => 
            (c.id || c._id?.toString()) === categoryId
        );
        
        if (!category) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }
        
        const categoryExport = buildCategoryExport(category, templateId, template.templateName);
        
        res.json({
            success: true,
            export: {
                _meta: {
                    schemaVersion: EXPORT_SCHEMA_VERSION,
                    exportType: 'category',
                    exportedAt: new Date().toISOString(),
                    templateId: templateId,
                    categoryId: categoryId
                },
                category: categoryExport
            }
        });
        
    } catch (error) {
        logger.error('[JSON EXPORT] Category export failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /api/export/scenario/:templateId/:categoryId/:scenarioId - Single scenario
// ============================================================================
router.get('/scenario/:templateId/:categoryId/:scenarioId', async (req, res) => {
    try {
        const { templateId, categoryId, scenarioId } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const category = (template.categories || []).find(c => 
            (c.id || c._id?.toString()) === categoryId
        );
        
        if (!category) {
            return res.status(404).json({ success: false, error: 'Category not found' });
        }
        
        const scenario = (category.scenarios || []).find(s =>
            (s.id || s._id?.toString()) === scenarioId
        );
        
        if (!scenario) {
            return res.status(404).json({ success: false, error: 'Scenario not found' });
        }
        
        const scenarioExport = buildScenarioExport(scenario, categoryId, category.name);
        const validation = validateScenario(scenarioExport);
        
        res.json({
            success: true,
            export: {
                _meta: {
                    schemaVersion: EXPORT_SCHEMA_VERSION,
                    exportType: 'scenario',
                    exportedAt: new Date().toISOString(),
                    templateId: templateId,
                    categoryId: categoryId,
                    scenarioId: scenarioId
                },
                scenario: scenarioExport,
                validation: validation
            }
        });
        
    } catch (error) {
        logger.error('[JSON EXPORT] Scenario export failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// POST /api/apply-patch - Apply JSON patch to template/company
// ============================================================================
router.post('/apply-patch', requireRole('admin', 'owner'), async (req, res) => {
    try {
        const { patch, dryRun = false } = req.body;
        
        if (!patch) {
            return res.status(400).json({ success: false, error: 'patch is required' });
        }
        
        logger.info('[JSON PATCH] Apply patch request', {
            patchType: patch.patchType,
            targetId: patch.targetId,
            dryRun
        });
        
        // Validate patch schema
        const validationErrors = validatePatchSchema(patch);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid patch schema',
                validationErrors
            });
        }
        
        // Build diff preview
        const diffPreview = await buildDiffPreview(patch);
        
        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                diff: diffPreview
            });
        }
        
        // Apply the patch
        const result = await applyPatch(patch, req.user?.userId);
        
        res.json({
            success: true,
            applied: true,
            diff: diffPreview,
            result
        });
        
    } catch (error) {
        logger.error('[JSON PATCH] Apply failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// HELPER: Validate patch schema
// ============================================================================
function validatePatchSchema(patch) {
    const errors = [];
    
    if (!patch.patchType) {
        errors.push('Missing patchType (template, category, scenario, company)');
    }
    
    if (!patch.targetId) {
        errors.push('Missing targetId');
    }
    
    if (!patch.operations || !Array.isArray(patch.operations)) {
        errors.push('Missing operations array');
    }
    
    // Validate each operation
    (patch.operations || []).forEach((op, idx) => {
        if (!op.op) {
            errors.push(`Operation[${idx}]: Missing op (create, update, delete)`);
        }
        if (!op.path) {
            errors.push(`Operation[${idx}]: Missing path`);
        }
    });
    
    return errors;
}

// ============================================================================
// HELPER: Build diff preview
// ============================================================================
async function buildDiffPreview(patch) {
    const diff = {
        creates: 0,
        updates: 0,
        deletes: 0,
        affectedIds: []
    };
    
    for (const op of (patch.operations || [])) {
        if (op.op === 'create') diff.creates++;
        else if (op.op === 'update') diff.updates++;
        else if (op.op === 'delete') diff.deletes++;
        
        if (op.id || op.scenarioId || op.categoryId) {
            diff.affectedIds.push(op.id || op.scenarioId || op.categoryId);
        }
    }
    
    return diff;
}

// ============================================================================
// HELPER: Apply patch
// ============================================================================
async function applyPatch(patch, userId) {
    const ChangeLog = mongoose.model('ChangeLog', new mongoose.Schema({
        patchType: String,
        targetId: String,
        userId: String,
        operations: Array,
        diff: Object,
        timestamp: { type: Date, default: Date.now }
    }, { collection: 'changeLogs' }));
    
    const results = {
        created: [],
        updated: [],
        deleted: [],
        errors: []
    };
    
    try {
        if (patch.patchType === 'template') {
            const template = await GlobalInstantResponseTemplate.findById(patch.targetId);
            if (!template) throw new Error('Template not found');
            
            for (const op of (patch.operations || [])) {
                try {
                    if (op.op === 'create' && op.path === 'category') {
                        template.categories.push(op.value);
                        results.created.push({ type: 'category', id: op.value.id });
                    }
                    else if (op.op === 'create' && op.path === 'scenario') {
                        const cat = template.categories.find(c => c.id === op.categoryId);
                        if (cat) {
                            cat.scenarios.push(op.value);
                            results.created.push({ type: 'scenario', id: op.value.id });
                        }
                    }
                    else if (op.op === 'update' && op.path === 'scenario') {
                        const cat = template.categories.find(c => c.id === op.categoryId);
                        if (cat) {
                            const scenarioIdx = cat.scenarios.findIndex(s => s.id === op.scenarioId);
                            if (scenarioIdx !== -1) {
                                Object.assign(cat.scenarios[scenarioIdx], op.value);
                                results.updated.push({ type: 'scenario', id: op.scenarioId });
                            }
                        }
                    }
                    else if (op.op === 'update' && op.path === 'category') {
                        const catIdx = template.categories.findIndex(c => c.id === op.categoryId);
                        if (catIdx !== -1) {
                            Object.assign(template.categories[catIdx], op.value);
                            results.updated.push({ type: 'category', id: op.categoryId });
                        }
                    }
                } catch (opError) {
                    results.errors.push({ operation: op, error: opError.message });
                }
            }
            
            template.updatedAt = new Date();
            await template.save();
        }
        
        // Log the change
        await ChangeLog.create({
            patchType: patch.patchType,
            targetId: patch.targetId,
            userId: userId,
            operations: patch.operations,
            diff: results,
            timestamp: new Date()
        });
        
    } catch (error) {
        results.errors.push({ error: error.message });
    }
    
    return results;
}

// ============================================================================
// GET /api/validate/template/:templateId - Validate template completeness
// ============================================================================
router.get('/validate/template/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const issues = [];
        const scenarios = [];
        const duplicateTriggers = new Map();
        
        // Check each category and scenario
        for (const category of (template.categories || [])) {
            if ((category.scenarios || []).length === 0) {
                issues.push({
                    type: 'EMPTY_CATEGORY',
                    severity: 'warning',
                    categoryId: category.id,
                    categoryName: category.name,
                    message: 'Category has no scenarios'
                });
            }
            
            for (const scenario of (category.scenarios || [])) {
                const validation = validateScenario(scenario);
                scenarios.push({
                    scenarioId: scenario.id,
                    name: scenario.name,
                    categoryId: category.id,
                    ...validation
                });
                
                // Track triggers for duplicate detection
                for (const trigger of (scenario.triggers || [])) {
                    const key = trigger.toLowerCase().trim();
                    if (!duplicateTriggers.has(key)) {
                        duplicateTriggers.set(key, []);
                    }
                    duplicateTriggers.get(key).push({
                        scenarioId: scenario.id,
                        scenarioName: scenario.name,
                        categoryId: category.id
                    });
                }
            }
        }
        
        // Find duplicate triggers
        const duplicates = [];
        for (const [trigger, usages] of duplicateTriggers.entries()) {
            if (usages.length > 1) {
                duplicates.push({
                    trigger,
                    usedIn: usages
                });
            }
        }
        
        if (duplicates.length > 0) {
            issues.push({
                type: 'DUPLICATE_TRIGGERS',
                severity: 'warning',
                message: `${duplicates.length} triggers are used in multiple scenarios`,
                duplicates
            });
        }
        
        const errorCount = scenarios.filter(s => !s.valid).length;
        const warningCount = scenarios.filter(s => s.warnings.length > 0).length;
        
        res.json({
            success: true,
            templateId,
            templateName: template.templateName,
            summary: {
                categoryCount: (template.categories || []).length,
                scenarioCount: scenarios.length,
                errorCount,
                warningCount,
                duplicateTriggerCount: duplicates.length,
                valid: errorCount === 0
            },
            issues,
            scenarios
        });
        
    } catch (error) {
        logger.error('[VALIDATE] Template validation failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// POST /api/test-utterances - Test utterances against scenarios
// ============================================================================
router.post('/test-utterances', async (req, res) => {
    try {
        const { templateId, utterances } = req.body;
        
        if (!templateId || !utterances || !Array.isArray(utterances)) {
            return res.status(400).json({
                success: false,
                error: 'templateId and utterances[] are required'
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        // Build scenario lookup
        const allScenarios = [];
        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                allScenarios.push({
                    ...scenario,
                    categoryId: category.id,
                    categoryName: category.name
                });
            }
        }
        
        // Test each utterance
        const results = [];
        for (const utterance of utterances) {
            const matches = [];
            
            for (const scenario of allScenarios) {
                const match = testUtteranceAgainstScenario(utterance, scenario);
                if (match.matched) {
                    matches.push({
                        scenarioId: scenario.id,
                        scenarioName: scenario.name,
                        categoryId: scenario.categoryId,
                        categoryName: scenario.categoryName,
                        confidence: match.confidence,
                        matchedTrigger: match.matchedTrigger,
                        matchType: match.matchType
                    });
                }
            }
            
            // Sort by confidence
            matches.sort((a, b) => b.confidence - a.confidence);
            
            results.push({
                utterance,
                matchCount: matches.length,
                topMatch: matches[0] || null,
                allMatches: matches,
                collision: matches.length > 1 && matches[0]?.confidence === matches[1]?.confidence
            });
        }
        
        const collisions = results.filter(r => r.collision);
        const noMatches = results.filter(r => r.matchCount === 0);
        
        res.json({
            success: true,
            summary: {
                totalUtterances: utterances.length,
                matched: results.filter(r => r.matchCount > 0).length,
                noMatch: noMatches.length,
                collisions: collisions.length
            },
            results,
            collisions,
            noMatches
        });
        
    } catch (error) {
        logger.error('[TEST UTTERANCES] Failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// HELPER: Test utterance against scenario
// ============================================================================
function testUtteranceAgainstScenario(utterance, scenario) {
    const normalizedUtterance = utterance.toLowerCase().trim();
    
    // Check negative triggers first
    for (const neg of (scenario.negativeTriggers || [])) {
        if (normalizedUtterance.includes(neg.toLowerCase())) {
            return { matched: false, reason: 'negative_trigger' };
        }
    }
    
    // Check positive triggers
    for (const trigger of (scenario.triggers || [])) {
        const normalizedTrigger = trigger.toLowerCase().trim();
        
        // Exact match
        if (normalizedUtterance === normalizedTrigger) {
            return {
                matched: true,
                confidence: 1.0,
                matchedTrigger: trigger,
                matchType: 'exact'
            };
        }
        
        // Contains match
        if (normalizedUtterance.includes(normalizedTrigger)) {
            const confidence = normalizedTrigger.length / normalizedUtterance.length;
            return {
                matched: true,
                confidence: Math.max(0.7, confidence),
                matchedTrigger: trigger,
                matchType: 'contains'
            };
        }
    }
    
    // Check regex triggers
    for (const regex of (scenario.regexTriggers || [])) {
        try {
            const re = new RegExp(regex, 'i');
            if (re.test(normalizedUtterance)) {
                return {
                    matched: true,
                    confidence: 0.85,
                    matchedTrigger: regex,
                    matchType: 'regex'
                };
            }
        } catch (e) {
            // Invalid regex, skip
        }
    }
    
    return { matched: false };
}

module.exports = router;


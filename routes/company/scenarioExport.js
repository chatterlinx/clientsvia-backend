/**
 * ============================================================================
 * FULL SCENARIO EXPORT API - Company-Scoped Deep Export
 * ============================================================================
 * 
 * PURPOSE: Export complete scenario configuration with ALL fields
 * 
 * INCLUDES:
 * - All audit fields (editContext, lockReason, blocked attempts)
 * - All triggers (triggers, regexTriggers, negativeTriggers)
 * - All responses (quickReplies, fullReplies)
 * - All match config (minConfidence, keywords, contextFields)
 * - All action hooks (actionHooks, transferTarget, escalation)
 * - Scope lock info (scope, ownerCompanyId, overridesGlobalScenarioId)
 * - Everything needed to recreate the scenario
 * 
 * USE CASES:
 * - "Download Full Config JSON" button
 * - "Copy JSON to clipboard" feature
 * - ChatGPT/Prime analysis workflow
 * - Backup and restore
 * - Company-to-company migration
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
                    
                    const scenarioExport = {
                        // ═══════════════════════════════════════════════════
                        // IDENTITY & LIFECYCLE
                        // ═══════════════════════════════════════════════════
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        version: scenario.version,
                        status: scenario.status,
                        isActive: scenario.isActive,
                        
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
                        triggers: scenario.triggers || [],
                        regexTriggers: scenario.regexTriggers || [],
                        negativeTriggers: scenario.negativeTriggers || [],
                        keywords: scenario.keywords || [],
                        negativeKeywords: scenario.negativeKeywords || [],
                        minConfidence: scenario.minConfidence ?? 0.5,
                        contextWeight: scenario.contextWeight ?? 0.8,
                        embeddingVector: scenario.embeddingVector ? '[VECTOR_EXISTS]' : null,
                        
                        // ═══════════════════════════════════════════════════
                        // RESPONSE SYSTEM - MULTI-REPLY MANAGEMENT
                        // ═══════════════════════════════════════════════════
                        quickReplies: scenario.quickReplies || [],
                        fullReplies: scenario.fullReplies || [],
                        replySelection: scenario.replySelection || 'sequential',
                        replyStrategy: scenario.replyStrategy || 'AUTO',
                        silencePolicy: scenario.silencePolicy || {},
                        
                        // ═══════════════════════════════════════════════════
                        // ENTITY CAPTURE & VALIDATION
                        // ═══════════════════════════════════════════════════
                        entityCapture: scenario.entityCapture || {},
                        entityValidation: scenario.entityValidation || {},
                        contextFields: scenario.contextFields || [],
                        
                        // ═══════════════════════════════════════════════════
                        // ADVANCED FLOW CONTROL
                        // ═══════════════════════════════════════════════════
                        followUpMode: scenario.followUpMode || 'NONE',
                        timedFollowUp: scenario.timedFollowUp || {},
                        
                        // ═══════════════════════════════════════════════════
                        // ACTION HOOKS & TRANSFER
                        // ═══════════════════════════════════════════════════
                        actionHooks: scenario.actionHooks || {},
                        handoffPolicy: scenario.handoffPolicy || 'never',
                        transferTarget: scenario.transferTarget || null,
                        
                        // ═══════════════════════════════════════════════════
                        // VOICE & TTS OVERRIDES
                        // ═══════════════════════════════════════════════════
                        ttsOverride: scenario.ttsOverride || {},
                        voiceSettings: scenario.voiceSettings || {},
                        
                        // ═══════════════════════════════════════════════════
                        // SCENARIO TYPE & METADATA
                        // ═══════════════════════════════════════════════════
                        scenarioType: scenario.scenarioType || 'FAQ',
                        notes: scenario.notes || '',
                        tags: scenario.tags || [],
                        
                        // ═══════════════════════════════════════════════════
                        // Q&A PAIRS (For training/fallback)
                        // ═══════════════════════════════════════════════════
                        qnaPairs: scenario.qnaPairs || [],
                        
                        // ═══════════════════════════════════════════════════
                        // AUDIT TIMESTAMPS
                        // ═══════════════════════════════════════════════════
                        createdAt: scenario.createdAt || null,
                        updatedAt: scenario.updatedAt || null,
                        createdBy: scenario.createdBy || null,
                        updatedBy: scenario.updatedBy || null,
                        
                        // ═══════════════════════════════════════════════════
                        // COMPUTED SCOPE INFO
                        // ═══════════════════════════════════════════════════
                        _scopeInfo: scenarioScopeInfo
                    };
                    
                    categoryExport.scenarios.push(scenarioExport);
                }
                
                templateExport.categories.push(categoryExport);
            }
            
            exportedTemplates.push(templateExport);
        }
        
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
                    schemaVersion: 'v2.0',
                    resolutionOrder: getResolutionOrder()
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


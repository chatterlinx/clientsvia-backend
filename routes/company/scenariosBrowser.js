/**
 * ============================================================================
 * SCENARIO BROWSER API - Enterprise Separated RAW vs AUDIT
 * ============================================================================
 * 
 * HARD RULE: RAW and AUDIT use SEPARATE serializers. No leakage.
 * 
 * ROUTES:
 * - GET /api/company/:companyId/scenarios-raw     Pure stored fields ONLY
 * - GET /api/company/:companyId/scenarios-audit   With computed proof blocks
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Models
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const v2Company = require('../../models/v2Company');

// Security
router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ============================================================================
// RAW SERIALIZER - PROVABLY RAW (No computed fields)
// ============================================================================
function serializeScenarioRAW(scenario, categoryId, categoryName, templateId) {
    // ONLY stored fields from the database schema
    // NO computed fields: _stats, _auditReport, health, report, missingFields, collisions
    return {
        // ═══════════════════════════════════════════════════════════════════
        // EXPORT METADATA (minimal)
        // ═══════════════════════════════════════════════════════════════════
        _exportedAt: new Date().toISOString(),
        _schemaVersion: 'V22-RAW',
        _mode: 'RAW',
        
        // ═══════════════════════════════════════════════════════════════════
        // IDENTITY (stored)
        // ═══════════════════════════════════════════════════════════════════
        scenarioId: scenario.scenarioId || scenario.id || scenario._id?.toString(),
        name: scenario.name,
        version: scenario.version,
        status: scenario.status,
        isActive: scenario.isActive,
        
        // ═══════════════════════════════════════════════════════════════════
        // CLASSIFICATION (stored)
        // ═══════════════════════════════════════════════════════════════════
        scenarioType: scenario.scenarioType,
        priority: scenario.priority,
        behaviorId: scenario.behaviorId || scenario.behavior,
        
        // ═══════════════════════════════════════════════════════════════════
        // CHANNEL & LANGUAGE (stored)
        // ═══════════════════════════════════════════════════════════════════
        channel: scenario.channel,
        language: scenario.language,
        
        // ═══════════════════════════════════════════════════════════════════
        // TRIGGERS (stored)
        // ═══════════════════════════════════════════════════════════════════
        triggers: scenario.triggers,
        negativeTriggers: scenario.negativeTriggers,
        regexTriggers: scenario.regexTriggers,
        keywords: scenario.keywords,
        negativeKeywords: scenario.negativeKeywords,
        
        // ═══════════════════════════════════════════════════════════════════
        // MATCHING (stored)
        // ═══════════════════════════════════════════════════════════════════
        minConfidence: scenario.minConfidence,
        contextWeight: scenario.contextWeight,
        
        // ═══════════════════════════════════════════════════════════════════
        // REPLIES (stored)
        // ═══════════════════════════════════════════════════════════════════
        quickReplies: scenario.quickReplies || scenario.responses,
        fullReplies: scenario.fullReplies,
        
        // ═══════════════════════════════════════════════════════════════════
        // REPLY STRATEGY (stored)
        // ═══════════════════════════════════════════════════════════════════
        replySelection: scenario.replySelection,
        replyStrategy: scenario.replyStrategy,
        replyPolicy: scenario.replyPolicy,
        followUpFunnel: scenario.followUpFunnel,
        followUpMode: scenario.followUpMode,
        followUpQuestionText: scenario.followUpQuestionText,
        followUpPrompts: scenario.followUpPrompts,
        
        // ═══════════════════════════════════════════════════════════════════
        // TRANSFER & HANDOFF (stored)
        // ═══════════════════════════════════════════════════════════════════
        transferTarget: scenario.transferTarget,
        handoffPolicy: scenario.handoffPolicy,
        
        // ═══════════════════════════════════════════════════════════════════
        // WIRING (stored)
        // ═══════════════════════════════════════════════════════════════════
        actionType: scenario.actionType,
        flowId: scenario.flowId?.toString(),
        bookingIntent: scenario.bookingIntent,
        requiredSlots: scenario.requiredSlots,
        stopRouting: scenario.stopRouting,
        
        // ═══════════════════════════════════════════════════════════════════
        // ACTION HOOKS (stored)
        // ═══════════════════════════════════════════════════════════════════
        actionHooks: scenario.actionHooks,
        escalationFlags: scenario.escalationFlags,
        
        // ═══════════════════════════════════════════════════════════════════
        // TIMING (stored)
        // ═══════════════════════════════════════════════════════════════════
        cooldown: scenario.cooldown || scenario.cooldownSeconds,
        timedFollowUp: scenario.timedFollowUp,
        silencePolicy: scenario.silencePolicy,
        
        // ═══════════════════════════════════════════════════════════════════
        // TTS (stored)
        // ═══════════════════════════════════════════════════════════════════
        ttsOverride: scenario.ttsOverride,
        voiceSettings: scenario.voiceSettings,
        
        // ═══════════════════════════════════════════════════════════════════
        // ENTITY (stored)
        // ═══════════════════════════════════════════════════════════════════
        entityCapture: scenario.entityCapture,
        entityValidation: scenario.entityValidation,
        contextFields: scenario.contextFields,
        
        // ═══════════════════════════════════════════════════════════════════
        // STATE MACHINE (stored)
        // ═══════════════════════════════════════════════════════════════════
        preconditions: scenario.preconditions,
        effects: scenario.effects,
        
        // ═══════════════════════════════════════════════════════════════════
        // SCOPE (stored)
        // ═══════════════════════════════════════════════════════════════════
        scope: scenario.scope,
        ownerCompanyId: scenario.ownerCompanyId?.toString(),
        lockMode: scenario.lockMode,
        
        // ═══════════════════════════════════════════════════════════════════
        // METADATA (stored)
        // ═══════════════════════════════════════════════════════════════════
        tags: scenario.tags,
        notes: scenario.notes,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
        createdBy: scenario.createdBy,
        updatedBy: scenario.updatedBy,
        
        // ═══════════════════════════════════════════════════════════════════
        // REFERENCES (stored)
        // ═══════════════════════════════════════════════════════════════════
        _categoryId: categoryId,
        _categoryName: categoryName,
        _templateId: templateId
    };
}

function serializeCategoryRAW(category, templateId, templateName) {
    const categoryId = category.id || category._id?.toString();
    
    return {
        categoryId: categoryId,
        name: category.name,
        icon: category.icon,
        description: category.description,
        behavior: category.behavior,
        isActive: category.isActive,
        priority: category.priority,
        scope: category.scope,
        ownerCompanyId: category.ownerCompanyId?.toString(),
        lockMode: category.lockMode,
        additionalFillerWords: category.additionalFillerWords,
        synonymMap: category.synonymMap,
        _templateId: templateId,
        _templateName: templateName,
        scenarios: (category.scenarios || []).map(s => 
            serializeScenarioRAW(s, categoryId, category.name, templateId)
        )
    };
}

// ============================================================================
// AUDIT SERIALIZER - Includes computed proof blocks
// ============================================================================
function serializeScenarioAUDIT(scenario, categoryId, categoryName, templateId, allScenarios) {
    // Start with RAW data
    const raw = serializeScenarioRAW(scenario, categoryId, categoryName, templateId);
    
    // Add computed audit blocks
    return {
        ...raw,
        _schemaVersion: 'V22-AUDIT',
        _mode: 'AUDIT',
        
        // ═══════════════════════════════════════════════════════════════════
        // COMPUTED: Statistics
        // ═══════════════════════════════════════════════════════════════════
        _stats: {
            triggerCount: (scenario.triggers || []).length,
            negativeTriggerCount: (scenario.negativeTriggers || []).length,
            keywordCount: (scenario.keywords || []).length,
            quickReplyCount: (scenario.quickReplies || scenario.responses || []).length,
            fullReplyCount: (scenario.fullReplies || []).length,
            hasFollowUp: !!(scenario.followUpMode && scenario.followUpMode !== 'NONE'),
            hasTransfer: !!scenario.transferTarget,
            hasActionHooks: (scenario.actionHooks || []).length > 0,
            hasTimedFollowUp: !!scenario.timedFollowUp?.enabled
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // COMPUTED: Validation Report
        // ═══════════════════════════════════════════════════════════════════
        _auditReport: generateAuditReport(scenario, allScenarios),
        
        // ═══════════════════════════════════════════════════════════════════
        // COMPUTED: Collision Detection
        // ═══════════════════════════════════════════════════════════════════
        _collisions: detectCollisions(scenario, allScenarios)
    };
}

function generateAuditReport(scenario, allScenarios) {
    const report = {
        generatedAt: new Date().toISOString(),
        checks: {},
        issues: [],
        warnings: [],
        grade: 'F',
        score: 0
    };
    
    let score = 100;
    
    // Check triggers (required: 8)
    const triggerCount = (scenario.triggers || []).length;
    report.checks.triggers = { count: triggerCount, required: 8, pass: triggerCount >= 8 };
    if (triggerCount < 8) {
        report.issues.push(`Triggers: ${triggerCount}/8 required`);
        score -= (8 - triggerCount) * 5;
    }
    
    // Check negative triggers (recommended: 3)
    const negCount = (scenario.negativeTriggers || []).length;
    report.checks.negativeTriggers = { count: negCount, recommended: 3, pass: negCount >= 3 };
    if (negCount < 3) {
        report.warnings.push(`Negative triggers: ${negCount}/3 recommended`);
        score -= (3 - negCount) * 3;
    }
    
    // Check quick replies (required: 7)
    const quickCount = (scenario.quickReplies || scenario.responses || []).length;
    report.checks.quickReplies = { count: quickCount, required: 7, pass: quickCount >= 7 };
    if (quickCount < 7) {
        report.issues.push(`Quick replies: ${quickCount}/7 required`);
        score -= (7 - quickCount) * 3;
    }
    
    // Check full replies (recommended: 7)
    const fullCount = (scenario.fullReplies || []).length;
    report.checks.fullReplies = { count: fullCount, recommended: 7, pass: fullCount >= 7 };
    if (fullCount < 7) {
        report.warnings.push(`Full replies: ${fullCount}/7 recommended`);
        score -= (7 - fullCount) * 2;
    }
    
    // Check scenarioType
    const hasType = scenario.scenarioType && scenario.scenarioType !== 'UNKNOWN' && scenario.scenarioType !== '';
    report.checks.scenarioType = { value: scenario.scenarioType || 'UNKNOWN', valid: hasType };
    if (!hasType) {
        report.issues.push('scenarioType is UNKNOWN or empty');
        score -= 10;
    }
    
    // Check wiring consistency
    const wiringIssues = [];
    if (scenario.actionType === 'START_FLOW' && !scenario.flowId) {
        wiringIssues.push('actionType=START_FLOW but no flowId');
    }
    if (scenario.actionType === 'TRANSFER' && !scenario.transferTarget) {
        wiringIssues.push('actionType=TRANSFER but no transferTarget');
    }
    report.checks.wiring = {
        actionType: scenario.actionType || 'REPLY_ONLY',
        flowId: scenario.flowId || null,
        transferTarget: scenario.transferTarget || null,
        bookingIntent: scenario.bookingIntent || false,
        issues: wiringIssues
    };
    if (wiringIssues.length > 0) {
        report.issues.push(...wiringIssues);
        score -= wiringIssues.length * 10;
    }
    
    // Calculate grade
    score = Math.max(0, Math.min(100, score));
    report.score = score;
    
    if (score >= 90) report.grade = 'A';
    else if (score >= 80) report.grade = 'B';
    else if (score >= 70) report.grade = 'C';
    else if (score >= 60) report.grade = 'D';
    else report.grade = 'F';
    
    report.enterpriseReady = report.issues.length === 0 && report.grade !== 'F';
    
    return report;
}

function detectCollisions(scenario, allScenarios) {
    if (!allScenarios || allScenarios.length === 0) return [];
    
    const myTriggers = (scenario.triggers || []).map(t => t.toLowerCase());
    const collisions = [];
    
    for (const other of allScenarios) {
        if (other.scenarioId === scenario.scenarioId) continue;
        if (!other.isActive && other.status !== 'live') continue;
        
        const otherTriggers = (other.triggers || []).map(t => t.toLowerCase());
        const shared = myTriggers.filter(t => otherTriggers.includes(t));
        
        if (shared.length > 0) {
            collisions.push({
                scenarioId: other.scenarioId,
                scenarioName: other.name,
                sharedTriggers: shared,
                otherPriority: other.priority || 0,
                severity: shared.length >= 3 ? 'HIGH' : shared.length >= 1 ? 'MEDIUM' : 'LOW'
            });
        }
    }
    
    return collisions;
}

function serializeCategoryAUDIT(category, templateId, templateName, allScenarios) {
    const categoryId = category.id || category._id?.toString();
    const scenarios = (category.scenarios || []).map(s => 
        serializeScenarioAUDIT(s, categoryId, category.name, templateId, allScenarios)
    );
    
    // Calculate category-level stats
    const totalTriggers = scenarios.reduce((sum, s) => sum + (s._stats?.triggerCount || 0), 0);
    const avgScore = scenarios.length > 0 
        ? Math.round(scenarios.reduce((sum, s) => sum + (s._auditReport?.score || 0), 0) / scenarios.length)
        : 0;
    const enterpriseReadyCount = scenarios.filter(s => s._auditReport?.enterpriseReady).length;
    
    return {
        categoryId: categoryId,
        name: category.name,
        icon: category.icon,
        description: category.description,
        behavior: category.behavior,
        isActive: category.isActive,
        priority: category.priority,
        scope: category.scope,
        ownerCompanyId: category.ownerCompanyId?.toString(),
        lockMode: category.lockMode,
        additionalFillerWords: category.additionalFillerWords,
        synonymMap: category.synonymMap,
        _templateId: templateId,
        _templateName: templateName,
        
        // Category-level computed stats
        _stats: {
            scenarioCount: scenarios.length,
            totalTriggers: totalTriggers,
            activeScenarios: scenarios.filter(s => s.isActive).length,
            avgScore: avgScore,
            enterpriseReadyCount: enterpriseReadyCount,
            enterpriseReadyPercent: scenarios.length > 0 
                ? Math.round((enterpriseReadyCount / scenarios.length) * 100) 
                : 0
        },
        
        scenarios: scenarios
    };
}

// ============================================================================
// GET /scenarios-raw - Pure stored fields ONLY
// ============================================================================
router.get('/scenarios-raw', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        logger.info(`[SCENARIOS-RAW] Request for company ${companyId}`);
        
        // Get company and active templates
        const company = await v2Company.findById(companyId)
            .select('companyName tradeKey aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Get active template IDs
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId?.toString())
            .filter(Boolean);
        
        if (activeTemplateIds.length === 0) {
            return res.json({
                success: true,
                mode: 'RAW',
                data: {
                    _exportedAt: new Date().toISOString(),
                    _schemaVersion: 'V22-RAW',
                    _mode: 'RAW',
                    companyId,
                    companyName: company.companyName,
                    categories: [],
                    _totalCategories: 0,
                    _totalScenarios: 0,
                    _totalTriggers: 0
                }
            });
        }
        
        // Load templates
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: activeTemplateIds.map(id => new mongoose.Types.ObjectId(id)) }
        }).lean();
        
        // Serialize using RAW serializer (NO computed fields)
        const categories = [];
        let totalScenarios = 0;
        let totalTriggers = 0;
        
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                const serialized = serializeCategoryRAW(category, template._id.toString(), template.name);
                categories.push(serialized);
                totalScenarios += serialized.scenarios.length;
                totalTriggers += serialized.scenarios.reduce((sum, s) => sum + (s.triggers?.length || 0), 0);
            }
        }
        
        res.json({
            success: true,
            mode: 'RAW',
            data: {
                _exportedAt: new Date().toISOString(),
                _schemaVersion: 'V22-RAW',
                _mode: 'RAW',
                _generatedInMs: Date.now() - startTime,
                companyId,
                companyName: company.companyName,
                tradeKey: company.tradeKey || 'unknown',
                categories,
                _totalCategories: categories.length,
                _totalScenarios: totalScenarios,
                _totalTriggers: totalTriggers
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIOS-RAW] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET /scenarios-audit - With computed proof blocks
// ============================================================================
router.get('/scenarios-audit', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    try {
        logger.info(`[SCENARIOS-AUDIT] Request for company ${companyId}`);
        
        // Get company and active templates
        const company = await v2Company.findById(companyId)
            .select('companyName tradeKey aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Get active template IDs
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId?.toString())
            .filter(Boolean);
        
        if (activeTemplateIds.length === 0) {
            return res.json({
                success: true,
                mode: 'AUDIT',
                data: {
                    _exportedAt: new Date().toISOString(),
                    _schemaVersion: 'V22-AUDIT',
                    _mode: 'AUDIT',
                    companyId,
                    companyName: company.companyName,
                    categories: [],
                    _summary: {
                        totalCategories: 0,
                        totalScenarios: 0,
                        totalTriggers: 0,
                        health: 'YELLOW',
                        healthMessage: 'No templates configured'
                    }
                }
            });
        }
        
        // Load templates
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: activeTemplateIds.map(id => new mongoose.Types.ObjectId(id)) }
        }).lean();
        
        // Collect ALL scenarios for collision detection
        const allScenarios = [];
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                for (const scenario of (category.scenarios || [])) {
                    allScenarios.push({
                        ...scenario,
                        scenarioId: scenario.scenarioId || scenario.id || scenario._id?.toString()
                    });
                }
            }
        }
        
        // Serialize using AUDIT serializer (WITH computed fields)
        const categories = [];
        let totalScenarios = 0;
        let totalTriggers = 0;
        let totalEnterpriseReady = 0;
        let totalCollisions = 0;
        const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        const topIssues = [];
        
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                const serialized = serializeCategoryAUDIT(category, template._id.toString(), template.name, allScenarios);
                categories.push(serialized);
                
                for (const scenario of serialized.scenarios) {
                    totalScenarios++;
                    totalTriggers += scenario._stats?.triggerCount || 0;
                    
                    if (scenario._auditReport?.enterpriseReady) {
                        totalEnterpriseReady++;
                    }
                    
                    gradeDistribution[scenario._auditReport?.grade || 'F']++;
                    
                    if (scenario._collisions?.length > 0) {
                        totalCollisions += scenario._collisions.length;
                    }
                    
                    // Collect top issues
                    if (scenario._auditReport?.issues?.length > 0) {
                        topIssues.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name,
                            grade: scenario._auditReport.grade,
                            issues: scenario._auditReport.issues
                        });
                    }
                }
            }
        }
        
        // Sort top issues by grade (F first)
        const gradeOrder = { F: 0, D: 1, C: 2, B: 3, A: 4 };
        topIssues.sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade]);
        
        // Determine overall health
        const enterpriseReadyPercent = totalScenarios > 0 
            ? Math.round((totalEnterpriseReady / totalScenarios) * 100)
            : 0;
        
        let health = 'GREEN';
        let healthMessage = 'All scenarios enterprise-ready';
        
        if (enterpriseReadyPercent < 50) {
            health = 'RED';
            healthMessage = `Only ${enterpriseReadyPercent}% of scenarios are enterprise-ready`;
        } else if (enterpriseReadyPercent < 80) {
            health = 'YELLOW';
            healthMessage = `${enterpriseReadyPercent}% of scenarios are enterprise-ready`;
        } else if (totalCollisions > 0) {
            health = 'YELLOW';
            healthMessage = `${totalCollisions} trigger collisions detected`;
        }
        
        res.json({
            success: true,
            mode: 'AUDIT',
            data: {
                _exportedAt: new Date().toISOString(),
                _schemaVersion: 'V22-AUDIT',
                _mode: 'AUDIT',
                _generatedInMs: Date.now() - startTime,
                companyId,
                companyName: company.companyName,
                tradeKey: company.tradeKey || 'unknown',
                categories,
                
                // AUDIT-only summary block
                _summary: {
                    totalCategories: categories.length,
                    totalScenarios,
                    totalTriggers,
                    totalEnterpriseReady,
                    enterpriseReadyPercent,
                    totalCollisions,
                    health,
                    healthMessage,
                    gradeDistribution,
                    topIssues: topIssues.slice(0, 10) // Top 10 worst
                }
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIOS-AUDIT] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;


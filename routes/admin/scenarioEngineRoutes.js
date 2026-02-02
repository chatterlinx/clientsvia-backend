/**
 * ============================================================================
 * SCENARIO ENGINE ROUTES - Feb 2026 (Full Engine)
 * ============================================================================
 * 
 * PURPOSE:
 * Complete API for the Scenario Coverage Engine including:
 * - Coverage analysis
 * - Job management (create, list, cancel)
 * - Pending review queue (list, approve, reject, bulk approve)
 * - Engine control (run once, pause, resume)
 * 
 * BASE PATH: /api/admin/scenario-engine
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

// Models
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const ServiceCatalog = require('../../models/ServiceCatalog');
const ServiceSwitchboard = require('../../models/ServiceSwitchboard');
const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
const ScenarioGenerationJob = require('../../models/ScenarioGenerationJob');
const PendingScenario = require('../../models/PendingScenario');
const ScenarioEngineState = require('../../models/ScenarioEngineState');
const v2Company = require('../../models/v2Company');

// Services
const { calculateTemplateCoverage, getGenerationQueue, COVERAGE_TARGETS } = require('../../services/scenarioEngine/coverageCalculator');
const { processJob, runOnce, getServicesWithCoverage } = require('../../services/scenarioEngine/engineWorker');
const { formatForGlobalBrain } = require('../../services/scenarioGeneration/serviceScenarioGenerator');

// ============================================================================
// COVERAGE ENDPOINTS (existing)
// ============================================================================

/**
 * GET /coverage/:templateId
 * Get full coverage report for a template
 */
router.get('/coverage/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId } = req.query;
        
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Extract scenarios from nested category structure
        const scenarios = [];
        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                scenarios.push({
                    ...scenario.toObject ? scenario.toObject() : scenario,
                    category: category.name
                });
            }
        }
        
        // Get catalog for metadata
        const catalog = await ServiceCatalog.findOne({ templateId });
        const catalogServices = catalog ? catalog.services : [];
        const catalogMap = new Map(catalogServices.map(s => [s.serviceKey, s.toObject()]));
        
        // Get services - merge switchboard with catalog
        let services = [];
        
        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            const switchboard = await ServiceSwitchboard.findOne({ companyId });
            if (switchboard && switchboard.services.length > 0) {
                services = switchboard.services.map(sw => {
                    const catalogData = catalogMap.get(sw.serviceKey) || {};
                    return {
                        ...catalogData,
                        serviceKey: sw.serviceKey,
                        enabled: sw.enabled,
                        sourcePolicy: sw.sourcePolicy,
                        customDeclineMessage: sw.customDeclineMessage
                    };
                });
            }
        }
        
        if (services.length === 0 && catalogServices.length > 0) {
            services = catalogServices.map(s => ({
                ...s.toObject(),
                enabled: true
            }));
        }
        
        // Get pending counts
        const pendingCounts = await PendingScenario.getPendingCountsByService(templateId);
        
        // Get audit results
        let auditResults = [];
        try {
            const auditDocs = await ScenarioAuditResult.find({ 
                templateId,
                'results.0': { $exists: true }
            }).sort({ createdAt: -1 }).limit(1);
            
            if (auditDocs.length > 0) {
                auditResults = auditDocs[0].results || [];
            }
        } catch (e) {
            logger.warn('[SCENARIO ENGINE] Could not load audit results', { error: e.message });
        }
        
        // Calculate coverage
        const coverageReport = calculateTemplateCoverage(services, scenarios, auditResults);
        
        // Enrich with pending counts
        for (const service of coverageReport.services) {
            const pending = pendingCounts[service.serviceKey] || { pending: 0, lintFailed: 0 };
            service.pendingCount = pending.pending;
            service.pendingLintFailed = pending.lintFailed;
        }
        
        // Get engine state
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        
        // Get active job if any
        const activeJob = await ScenarioGenerationJob.findActiveJob(templateId, companyId);
        
        logger.info('[SCENARIO ENGINE] Coverage calculated', {
            templateId,
            totalServices: coverageReport.summary.totalServices,
            coverage: coverageReport.summary.overallCoveragePercent + '%',
            gap: coverageReport.summary.gapTotal
        });
        
        res.json({
            success: true,
            templateId,
            templateName: template.name,
            ...coverageReport,
            engine: {
                state: {
                    isEnabled: state.isEnabled,
                    isPaused: state.isPaused,
                    lastRunAt: state.lastRunAt,
                    lastRunStatus: state.lastRunStatus,
                    cooldownUntil: state.cooldownUntil,
                    blockedServices: state.blockedServices.length
                },
                dailyUsage: state.dailyUsage,
                dailyLimits: state.dailyLimits,
                activeJob: activeJob ? {
                    jobId: activeJob._id,
                    status: activeJob.status,
                    progress: activeJob.progress
                } : null
            },
            pendingTotal: Object.values(pendingCounts).reduce((sum, c) => sum + c.pending, 0)
        });
        
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error calculating coverage', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /coverage/:templateId/export
 * Export coverage as JSON
 */
router.get('/coverage/:templateId/export', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId } = req.query;
        
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Extract scenarios from nested category structure
        const scenarios = [];
        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                scenarios.push({
                    ...scenario.toObject ? scenario.toObject() : scenario,
                    category: category.name
                });
            }
        }
        
        const catalog = await ServiceCatalog.findOne({ templateId });
        const catalogServices = catalog ? catalog.services : [];
        const catalogMap = new Map(catalogServices.map(s => [s.serviceKey, s.toObject()]));
        
        let services = [];
        let companyName = null;
        
        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            const switchboard = await ServiceSwitchboard.findOne({ companyId });
            if (switchboard && switchboard.services.length > 0) {
                services = switchboard.services.map(sw => {
                    const catalogData = catalogMap.get(sw.serviceKey) || {};
                    return { ...catalogData, serviceKey: sw.serviceKey, enabled: sw.enabled, sourcePolicy: sw.sourcePolicy };
                });
            }
            const company = await v2Company.findById(companyId, 'businessName');
            companyName = company?.businessName;
        }
        
        if (services.length === 0 && catalogServices.length > 0) {
            services = catalogServices.map(s => ({ ...s.toObject(), enabled: true }));
        }
        
        const coverageReport = calculateTemplateCoverage(services, scenarios, []);
        const pendingCounts = await PendingScenario.getPendingCountsByService(templateId);
        
        const exportData = {
            exportedAt: new Date().toISOString(),
            exportType: 'scenario_coverage_report',
            version: '2.0',
            template: { id: templateId, name: template.name, scenarioCount: scenarios.length },
            company: companyId ? { id: companyId, name: companyName } : null,
            coverageTargets: COVERAGE_TARGETS,
            summary: coverageReport.summary,
            typeSummaries: coverageReport.typeSummaries,
            services: coverageReport.services.map(s => ({
                ...s,
                pendingCount: (pendingCounts[s.serviceKey] || {}).pending || 0
            })),
            generationQueue: coverageReport.needsWork,
            pendingTotal: Object.values(pendingCounts).reduce((sum, c) => sum + c.pending, 0)
        };
        
        res.json(exportData);
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error exporting coverage', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /targets
 * Get coverage targets
 */
router.get('/targets', (req, res) => {
    res.json({ success: true, targets: COVERAGE_TARGETS });
});

// ============================================================================
// JOB ENDPOINTS
// ============================================================================

/**
 * POST /jobs
 * Create a new generation job
 */
router.post('/jobs', async (req, res) => {
    try {
        const { templateId, companyId, mode, limits, targetServiceKeys, notes } = req.body;
        
        if (!templateId || !mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Valid templateId required' });
        }
        
        // Check template exists
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Check for existing active job
        const existingJob = await ScenarioGenerationJob.findActiveJob(templateId, companyId);
        if (existingJob) {
            return res.status(409).json({
                error: 'Active job already exists',
                existingJobId: existingJob._id,
                status: existingJob.status
            });
        }
        
        // Create job
        const job = await ScenarioGenerationJob.createJob({
            templateId,
            companyId,
            mode: mode || 'fill_gaps',
            limits: limits || {},
            targetServiceKeys: targetServiceKeys || [],
            createdBy: {
                userId: req.user?._id,
                name: req.user?.name || 'Admin',
                email: req.user?.email
            },
            notes
        });
        
        logger.info('[SCENARIO ENGINE] Job created', { jobId: job._id, mode: job.mode });
        
        // Start processing in background
        processJob(job._id).catch(err => {
            logger.error('[SCENARIO ENGINE] Background job processing failed', { jobId: job._id, error: err.message });
        });
        
        res.status(201).json({
            success: true,
            message: 'Job created and started',
            job: {
                _id: job._id,
                status: job.status,
                mode: job.mode,
                limits: job.limits,
                createdAt: job.createdAt
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error creating job', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /jobs
 * List jobs
 */
router.get('/jobs', async (req, res) => {
    try {
        const { templateId, companyId, status, limit = 20 } = req.query;
        
        const query = {};
        if (templateId) query.templateId = templateId;
        if (companyId) query.companyId = companyId;
        if (status) query.status = status;
        
        const jobs = await ScenarioGenerationJob.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .select('-serviceRuns');
        
        res.json({ success: true, jobs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /jobs/:jobId
 * Get job details
 */
router.get('/jobs/:jobId', async (req, res) => {
    try {
        const job = await ScenarioGenerationJob.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ success: true, job });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /jobs/:jobId/cancel
 * Cancel a job
 */
router.post('/jobs/:jobId/cancel', async (req, res) => {
    try {
        const job = await ScenarioGenerationJob.findById(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        
        if (!['queued', 'running', 'paused'].includes(job.status)) {
            return res.status(400).json({ error: 'Job cannot be cancelled', status: job.status });
        }
        
        await job.cancel(req.body.reason);
        
        res.json({ success: true, message: 'Job cancelled', job: { _id: job._id, status: job.status } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// PENDING REVIEW ENDPOINTS
// ============================================================================

/**
 * GET /pending
 * List pending scenarios
 */
router.get('/pending', async (req, res) => {
    try {
        const { templateId, companyId, serviceKey, status = 'pending', limit = 50 } = req.query;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const query = { templateId, status };
        if (companyId) query.companyId = companyId;
        if (serviceKey) query.serviceKey = serviceKey;
        
        const pending = await PendingScenario.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));
        
        // Group by service
        const byService = {};
        for (const p of pending) {
            if (!byService[p.serviceKey]) {
                byService[p.serviceKey] = {
                    serviceKey: p.serviceKey,
                    serviceType: p.serviceType,
                    scenarios: [],
                    lintFailedCount: 0
                };
            }
            byService[p.serviceKey].scenarios.push(p);
            if (!p.lint?.passed) byService[p.serviceKey].lintFailedCount++;
        }
        
        res.json({
            success: true,
            total: pending.length,
            byService: Object.values(byService),
            scenarios: pending
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /pending/summary
 * Get pending summary by service
 */
router.get('/pending/summary', async (req, res) => {
    try {
        const { templateId } = req.query;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const counts = await PendingScenario.getPendingCountsByService(templateId);
        const total = Object.values(counts).reduce((sum, c) => sum + c.pending, 0);
        const lintFailed = Object.values(counts).reduce((sum, c) => sum + c.lintFailed, 0);
        
        res.json({
            success: true,
            total,
            lintFailed,
            byService: counts
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /pending/:id/approve
 * Approve a pending scenario
 */
router.post('/pending/:id/approve', async (req, res) => {
    try {
        const pending = await PendingScenario.findById(req.params.id);
        if (!pending) {
            return res.status(404).json({ error: 'Pending scenario not found' });
        }
        
        if (pending.status !== 'pending' && pending.status !== 'edited') {
            return res.status(400).json({ error: 'Scenario already processed', status: pending.status });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(pending.templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // DUPLICATE GATE (Feb 2026): Block if too similar to existing
        // ═══════════════════════════════════════════════════════════════
        const forceOverride = req.query.force === 'true';
        
        // Get company duplicate gate settings (default to enabled with 0.86 threshold)
        const Company = require('../../models/v2Company');
        const company = await Company.findById(pending.companyId).lean();
        const duplicateGate = company?.aiAgentSettings?.duplicateGate || {
            enabled: true,
            threshold: 0.86,
            onDuplicate: 'block',
            allowOverride: true
        };
        
        if (duplicateGate.enabled && !forceOverride) {
            try {
                const embeddingService = require('../../services/scenarioEngine/embeddingService');
                
                // Get all existing scenarios in same service
                const existingScenarios = [];
                const pendingPayload = pending.editedPayload || pending.payload;
                
                for (const cat of template.categories) {
                    for (const s of cat.scenarios || []) {
                        // Match by serviceKey or category name containing serviceKey
                        if (s.serviceKey === pending.serviceKey || 
                            (cat.name || '').toLowerCase().includes(pending.serviceKey.replace(/_/g, ' '))) {
                            existingScenarios.push(s);
                        }
                    }
                }
                
                if (existingScenarios.length > 0) {
                    // Get embedding for new scenario
                    const newEmbedding = await embeddingService.getScenarioEmbedding({
                        scenarioName: pendingPayload.scenarioName,
                        triggers: pendingPayload.triggers,
                        quickReplies: pendingPayload.quickReplies
                    });
                    
                    // Get embeddings for existing scenarios
                    const existingEmbeddings = await embeddingService.batchGetEmbeddings(existingScenarios);
                    const scenariosWithEmbeddings = existingScenarios.map((s, i) => ({
                        scenario: s,
                        embedding: existingEmbeddings[i]
                    }));
                    
                    // Check for duplicates
                    const similar = embeddingService.findSimilar(
                        newEmbedding, 
                        scenariosWithEmbeddings, 
                        duplicateGate.threshold
                    );
                    
                    if (similar.length > 0) {
                        const match = similar[0];
                        logger.warn('[SCENARIO ENGINE] Duplicate blocked at approval', {
                            newScenario: pendingPayload.scenarioName,
                            matchedScenario: match.scenario.scenarioName || match.scenario.name,
                            similarity: match.similarity,
                            threshold: duplicateGate.threshold
                        });
                        
                        if (duplicateGate.onDuplicate === 'block') {
                            return res.status(409).json({
                                error: 'DUPLICATE_SCENARIO',
                                blocked: true,
                                reason: 'This scenario is too similar to an existing one',
                                maxSimilarity: match.similarity,
                                threshold: duplicateGate.threshold,
                                matchedScenario: {
                                    id: match.scenario.scenarioId || match.scenario._id,
                                    name: match.scenario.scenarioName || match.scenario.name,
                                    serviceKey: match.scenario.serviceKey || pending.serviceKey
                                },
                                canOverride: duplicateGate.allowOverride,
                                overrideUrl: duplicateGate.allowOverride 
                                    ? `${req.originalUrl}?force=true` 
                                    : null
                            });
                        }
                        // If 'warn' mode, continue but flag for audit
                    }
                }
            } catch (gateError) {
                // Don't block on gate errors - log and continue
                logger.warn('[SCENARIO ENGINE] Duplicate gate check failed, allowing', {
                    error: gateError.message
                });
            }
        }
        
        // Format scenario for template
        const payload = pending.editedPayload || pending.payload;
        // ═══════════════════════════════════════════════════════════════
        // PASS ALL WIRING FIELDS (Feb 2026 fix)
        // ═══════════════════════════════════════════════════════════════
        const formatted = formatForGlobalBrain({
            // Core content
            scenarioName: payload.scenarioName,
            scenarioType: payload.scenarioType,
            category: payload.category,
            triggers: payload.triggers,
            quickReplies: payload.quickReplies,
            fullReplies: payload.fullReplies,
            generationNotes: payload.generationNotes,
            serviceKey: pending.serviceKey,
            
            // Agent wiring (CRITICAL)
            bookingIntent: payload.bookingIntent,
            actionType: payload.actionType,
            isEmergency: payload.isEmergency,
            entityCapture: payload.entityCapture,
            requiredSlots: payload.requiredSlots,
            stopRouting: payload.stopRouting,
            confirmBeforeAction: payload.confirmBeforeAction,
            followUpMode: payload.followUpMode,
            contextTags: payload.contextTags,
            
            // Matching
            priority: payload.priority,
            confidenceThreshold: payload.confidenceThreshold,
            
            // Compliance
            multiTenantCompliant: payload.multiTenantCompliant,
            placeholdersUsed: payload.placeholdersUsed
        }, pending.templateId);
        
        // Add to template - use nested category structure
        const targetCategoryName = payload.category || 'Generated Scenarios';
        let category = template.categories.find(c => c.name === targetCategoryName);
        
        if (!category) {
            // Create new category with required fields
            template.categories.push({
                id: `cat-${Date.now()}`,
                name: targetCategoryName,
                description: `Auto-generated category for ${targetCategoryName}`,
                icon: '🤖',
                isActive: true,
                scenarios: []
            });
            category = template.categories[template.categories.length - 1];
        }
        
        category.scenarios.push(formatted);
        await template.save();
        
        // Mark as approved
        await pending.approve(
            { userId: req.user?._id, name: req.user?.name || 'Admin', email: req.user?.email },
            formatted.scenarioId
        );
        
        logger.info('[SCENARIO ENGINE] Scenario approved', {
            pendingId: pending._id,
            scenarioId: formatted.scenarioId,
            serviceKey: pending.serviceKey
        });
        
        res.json({
            success: true,
            message: 'Scenario approved and added to template',
            scenarioId: formatted.scenarioId
        });
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error approving scenario', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /pending/:id/reject
 * Reject a pending scenario
 */
router.post('/pending/:id/reject', async (req, res) => {
    try {
        const pending = await PendingScenario.findById(req.params.id);
        if (!pending) {
            return res.status(404).json({ error: 'Pending scenario not found' });
        }
        
        if (pending.status !== 'pending' && pending.status !== 'edited') {
            return res.status(400).json({ error: 'Scenario already processed', status: pending.status });
        }
        
        await pending.reject(
            { userId: req.user?._id, name: req.user?.name || 'Admin' },
            req.body.reason || 'Rejected by reviewer'
        );
        
        res.json({ success: true, message: 'Scenario rejected' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /pending/bulk-approve
 * Bulk approve scenarios for a service
 */
router.post('/pending/bulk-approve', async (req, res) => {
    try {
        const { templateId, serviceKey, onlyLintPassed = true } = req.body;
        
        if (!templateId || !serviceKey) {
            return res.status(400).json({ error: 'templateId and serviceKey required' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Find pending scenarios
        const query = { templateId, serviceKey, status: 'pending' };
        if (onlyLintPassed) {
            query['lint.passed'] = true;
        }
        
        const pendingScenarios = await PendingScenario.find(query);
        
        let approved = 0;
        let skipped = 0;
        let blockedDuplicates = 0;
        
        // ═══════════════════════════════════════════════════════════════
        // DUPLICATE GATE SETUP (Feb 2026)
        // Load existing scenarios + gate settings once for efficiency
        // ═══════════════════════════════════════════════════════════════
        const forceOverride = req.query.force === 'true';
        const Company = require('../../models/v2Company');
        
        // Get first pending's companyId for settings
        const firstPending = pendingScenarios[0];
        const company = firstPending 
            ? await Company.findById(firstPending.companyId).lean() 
            : null;
        const duplicateGate = company?.aiAgentSettings?.duplicateGate || {
            enabled: true,
            threshold: 0.86,
            onDuplicate: 'block'
        };
        
        // Pre-load existing scenarios and embeddings for duplicate checking
        let existingEmbeddings = [];
        let embeddingService = null;
        
        if (duplicateGate.enabled && !forceOverride && pendingScenarios.length > 0) {
            try {
                embeddingService = require('../../services/scenarioEngine/embeddingService');
                
                // Collect all existing scenarios for this service
                const existingScenarios = [];
                for (const cat of template.categories) {
                    for (const s of cat.scenarios || []) {
                        if (s.serviceKey === serviceKey || 
                            (cat.name || '').toLowerCase().includes(serviceKey.replace(/_/g, ' '))) {
                            existingScenarios.push(s);
                        }
                    }
                }
                
                if (existingScenarios.length > 0) {
                    const embeddings = await embeddingService.batchGetEmbeddings(existingScenarios);
                    existingEmbeddings = existingScenarios.map((s, i) => ({
                        scenario: s,
                        embedding: embeddings[i]
                    }));
                    logger.info('[SCENARIO ENGINE] Bulk approve: loaded existing embeddings', {
                        count: existingEmbeddings.length
                    });
                }
            } catch (gateError) {
                logger.warn('[SCENARIO ENGINE] Bulk approve: duplicate gate setup failed', {
                    error: gateError.message
                });
            }
        }
        
        // Track categories we've added to
        const categoryCache = new Map();
        
        for (const pending of pendingScenarios) {
            try {
                const payload = pending.editedPayload || pending.payload;
                
                // ═══════════════════════════════════════════════════════════════
                // DUPLICATE CHECK FOR THIS SCENARIO
                // ═══════════════════════════════════════════════════════════════
                if (embeddingService && existingEmbeddings.length > 0 && !forceOverride) {
                    try {
                        const newEmbedding = await embeddingService.getScenarioEmbedding({
                            scenarioName: payload.scenarioName,
                            triggers: payload.triggers,
                            quickReplies: payload.quickReplies
                        });
                        
                        const similar = embeddingService.findSimilar(
                            newEmbedding, 
                            existingEmbeddings, 
                            duplicateGate.threshold
                        );
                        
                        if (similar.length > 0) {
                            logger.info('[SCENARIO ENGINE] Bulk approve: skipping duplicate', {
                                scenario: payload.scenarioName,
                                similarTo: similar[0].scenario.scenarioName || similar[0].scenario.name,
                                similarity: similar[0].similarity
                            });
                            
                            // Mark as rejected due to duplicate
                            await pending.reject(
                                { name: 'System - Duplicate Gate' },
                                `Duplicate of "${similar[0].scenario.scenarioName || similar[0].scenario.name}" (${(similar[0].similarity * 100).toFixed(1)}% similar)`
                            );
                            blockedDuplicates++;
                            continue;  // Skip this scenario
                        }
                        
                        // Add this scenario to existing embeddings (so we don't approve dupes in same batch)
                        existingEmbeddings.push({
                            scenario: { scenarioName: payload.scenarioName },
                            embedding: newEmbedding
                        });
                    } catch (dupError) {
                        logger.warn('[SCENARIO ENGINE] Duplicate check failed for single', {
                            error: dupError.message
                        });
                    }
                }
                // ═══════════════════════════════════════════════════════════════
                // PASS ALL WIRING FIELDS (Feb 2026 fix)
                // The payload contains full wiring from serviceScenarioGenerator
                // ═══════════════════════════════════════════════════════════════
                const formatted = formatForGlobalBrain({
                    // Core content
                    scenarioName: payload.scenarioName,
                    scenarioType: payload.scenarioType,
                    category: payload.category,
                    triggers: payload.triggers,
                    quickReplies: payload.quickReplies,
                    fullReplies: payload.fullReplies,
                    generationNotes: payload.generationNotes,
                    serviceKey: pending.serviceKey,
                    
                    // Agent wiring (CRITICAL)
                    bookingIntent: payload.bookingIntent,
                    actionType: payload.actionType,
                    isEmergency: payload.isEmergency,
                    entityCapture: payload.entityCapture,
                    requiredSlots: payload.requiredSlots,
                    stopRouting: payload.stopRouting,
                    confirmBeforeAction: payload.confirmBeforeAction,
                    followUpMode: payload.followUpMode,
                    contextTags: payload.contextTags,
                    
                    // Matching
                    priority: payload.priority,
                    confidenceThreshold: payload.confidenceThreshold,
                    
                    // Compliance
                    multiTenantCompliant: payload.multiTenantCompliant,
                    placeholdersUsed: payload.placeholdersUsed
                }, templateId);
                
                // Find or create category (using nested structure)
                const targetCategoryName = payload.category || 'Generated Scenarios';
                
                if (!categoryCache.has(targetCategoryName)) {
                    let category = template.categories.find(c => c.name === targetCategoryName);
                    if (!category) {
                        template.categories.push({
                            id: `cat-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                            name: targetCategoryName,
                            description: `Auto-generated category for ${targetCategoryName}`,
                            icon: '🤖',
                            isActive: true,
                            scenarios: []
                        });
                        category = template.categories[template.categories.length - 1];
                    }
                    categoryCache.set(targetCategoryName, category);
                }
                
                const category = categoryCache.get(targetCategoryName);
                category.scenarios.push(formatted);
                
                await pending.approve(
                    { userId: req.user?._id, name: req.user?.name || 'Admin' },
                    formatted.scenarioId
                );
                
                approved++;
            } catch (e) {
                logger.warn('[SCENARIO ENGINE] Bulk approve skip', { pendingId: pending._id, error: e.message });
                skipped++;
            }
        }
        
        await template.save();
        
        logger.info('[SCENARIO ENGINE] Bulk approve completed', { 
            serviceKey, 
            approved, 
            skipped, 
            blockedDuplicates 
        });
        
        res.json({
            success: true,
            message: blockedDuplicates > 0
                ? `Approved ${approved} scenarios (${blockedDuplicates} duplicates blocked)`
                : `Approved ${approved} scenarios`,
            approved,
            skipped,
            blockedDuplicates
        });
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error in bulk approve', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// ENGINE CONTROL ENDPOINTS
// ============================================================================

/**
 * POST /run-once
 * Manually trigger engine run
 */
router.post('/run-once', async (req, res) => {
    try {
        const { templateId, companyId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const result = await runOnce(templateId, companyId, {
            userId: req.user?._id,
            name: req.user?.name || 'Admin',
            email: req.user?.email
        });
        
        res.json(result);
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error in run-once', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /pause
 * Pause the engine
 */
router.post('/pause', async (req, res) => {
    try {
        const { templateId, companyId, reason } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        await state.pause(reason || 'Paused by admin', req.user?.name || 'Admin');
        
        res.json({ success: true, message: 'Engine paused', state: { isPaused: true, pauseReason: reason } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /resume
 * Resume the engine
 */
router.post('/resume', async (req, res) => {
    try {
        const { templateId, companyId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        await state.resume();
        
        res.json({ success: true, message: 'Engine resumed', state: { isPaused: false } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /state/:templateId
 * Get engine state
 */
router.get('/state/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId } = req.query;
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        
        res.json({ success: true, state });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /reset-daily
 * Reset daily usage counters (allows continuing work after hitting limit)
 */
router.post('/reset-daily', async (req, res) => {
    try {
        const { templateId, companyId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        
        // Reset daily counters
        state.dailyUsage = {
            date: new Date().toISOString().split('T')[0],
            tokensUsed: 0,
            requestsUsed: 0,
            scenariosGenerated: 0,
            estimatedCost: 0
        };
        
        await state.save();
        
        logger.info('[SCENARIO ENGINE] Daily usage reset', { templateId, companyId, by: req.user?.name || 'Admin' });
        
        res.json({ 
            success: true, 
            message: 'Daily usage counters reset',
            dailyUsage: state.dailyUsage,
            dailyLimits: state.dailyLimits
        });
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Reset daily error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /limits
 * Update daily limits
 */
router.put('/limits', async (req, res) => {
    try {
        const { templateId, companyId, maxScenarios, maxTokens, maxRequests } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        
        // Update limits
        if (maxScenarios !== undefined) state.dailyLimits.maxScenarios = maxScenarios;
        if (maxTokens !== undefined) state.dailyLimits.maxTokens = maxTokens;
        if (maxRequests !== undefined) state.dailyLimits.maxRequests = maxRequests;
        
        await state.save();
        
        logger.info('[SCENARIO ENGINE] Limits updated', { templateId, companyId, limits: state.dailyLimits, by: req.user?.name || 'Admin' });
        
        res.json({ 
            success: true, 
            message: 'Limits updated',
            dailyLimits: state.dailyLimits
        });
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Update limits error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /clear-cooldown
 * Clear the cooldown so you can run another job immediately
 */
router.post('/clear-cooldown', async (req, res) => {
    try {
        const { templateId, companyId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        
        // Clear cooldown
        state.cooldownUntil = null;
        await state.save();
        
        logger.info('[SCENARIO ENGINE] Cooldown cleared', { templateId, companyId, by: req.user?.name || 'Admin' });
        
        res.json({ 
            success: true, 
            message: 'Cooldown cleared - you can run another job now'
        });
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Clear cooldown error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /unblock-service
 * Unblock a service
 */
router.post('/unblock-service', async (req, res) => {
    try {
        const { templateId, companyId, serviceKey } = req.body;
        
        if (!templateId || !serviceKey) {
            return res.status(400).json({ error: 'templateId and serviceKey required' });
        }
        
        const state = await ScenarioEngineState.getOrCreate(templateId, companyId);
        await state.unblockService(serviceKey);
        
        res.json({ success: true, message: `Service ${serviceKey} unblocked` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// DUPLICATE DETECTION ENDPOINTS (Feb 2026)
// ============================================================================

// Lazy-load embedding services to avoid startup cost
let embeddingService = null;
let cleanupService = null;

function getEmbeddingService() {
    if (!embeddingService) {
        embeddingService = require('../../services/scenarioEngine/embeddingService');
    }
    return embeddingService;
}

function getCleanupService() {
    if (!cleanupService) {
        cleanupService = require('../../services/scenarioEngine/duplicateCleanupService');
    }
    return cleanupService;
}

/**
 * POST /duplicate-scan
 * Scan scenarios for duplicates using embedding similarity
 */
router.post('/duplicate-scan', async (req, res) => {
    try {
        const { templateId, serviceKey, threshold = 0.86 } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        const cleanup = getCleanupService();
        const embedding = getEmbeddingService();
        
        let scenarios;
        
        if (serviceKey) {
            // Scan specific service
            scenarios = await cleanup.getScenariosForService(templateId, serviceKey);
        } else {
            // Scan all - get grouped then flatten
            const grouped = await cleanup.getAllScenariosGrouped(templateId);
            scenarios = Object.values(grouped).flat();
        }
        
        if (scenarios.length === 0) {
            return res.json({
                success: true,
                message: 'No scenarios found to scan',
                groups: [],
                standalone: [],
                stats: { total: 0, groups: 0, duplicates: 0 }
            });
        }
        
        logger.info('[DUPLICATE SCAN] Starting scan', { 
            templateId, 
            serviceKey: serviceKey || 'all',
            scenarioCount: scenarios.length,
            threshold
        });
        
        // Run clustering
        const result = await embedding.clusterDuplicates(scenarios, threshold);
        
        logger.info('[DUPLICATE SCAN] Scan complete', result.stats);
        
        res.json({
            success: true,
            templateId,
            serviceKey: serviceKey || 'all',
            threshold,
            ...result
        });
        
    } catch (error) {
        logger.error('[DUPLICATE SCAN] Error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /duplicate-cleanup
 * Apply a cleanup plan (keep winners, merge triggers, delete duplicates)
 */
router.post('/duplicate-cleanup', async (req, res) => {
    try {
        const { templateId, plan } = req.body;
        
        if (!templateId || !plan || !Array.isArray(plan)) {
            return res.status(400).json({ error: 'templateId and plan array required' });
        }
        
        const cleanup = getCleanupService();
        
        logger.info('[DUPLICATE CLEANUP] Applying cleanup', { 
            templateId, 
            groupCount: plan.length 
        });
        
        const result = await cleanup.applyCleanupPlan(templateId, plan, {
            userId: req.user?._id,
            name: req.user?.name || 'Admin',
            email: req.user?.email
        });
        
        res.json({
            success: result.success,
            ...result
        });
        
    } catch (error) {
        logger.error('[DUPLICATE CLEANUP] Error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /duplicate-scan/preview/:templateId
 * Quick preview of duplicate counts per service (no embedding, uses fingerprint)
 */
router.get('/duplicate-scan/preview/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const cleanup = getCleanupService();
        const grouped = await cleanup.getAllScenariosGrouped(templateId);
        
        // Simple count by service
        const preview = {};
        for (const [serviceKey, scenarios] of Object.entries(grouped)) {
            preview[serviceKey] = {
                total: scenarios.length,
                // Quick name-based duplicate detection (not as accurate as embedding)
                potentialDuplicates: findPotentialDuplicatesByName(scenarios)
            };
        }
        
        res.json({
            success: true,
            templateId,
            services: preview,
            totalScenarios: Object.values(grouped).flat().length
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Quick name-based duplicate detection (fast, but less accurate)
 */
function findPotentialDuplicatesByName(scenarios) {
    const nameWords = scenarios.map(s => {
        const name = (s.scenarioName || s.name || '').toLowerCase();
        return new Set(name.split(/[\s_-]+/).filter(w => w.length > 3));
    });
    
    let potentialDupes = 0;
    for (let i = 0; i < scenarios.length; i++) {
        for (let j = i + 1; j < scenarios.length; j++) {
            const intersection = [...nameWords[i]].filter(w => nameWords[j].has(w));
            const union = new Set([...nameWords[i], ...nameWords[j]]);
            const jaccard = intersection.length / union.size;
            if (jaccard > 0.5) {
                potentialDupes++;
            }
        }
    }
    return potentialDupes;
}

module.exports = router;

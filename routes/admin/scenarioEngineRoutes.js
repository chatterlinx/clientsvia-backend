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
        
        // Track categories we've added to
        const categoryCache = new Map();
        
        for (const pending of pendingScenarios) {
            try {
                const payload = pending.editedPayload || pending.payload;
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
        
        logger.info('[SCENARIO ENGINE] Bulk approve completed', { serviceKey, approved, skipped });
        
        res.json({
            success: true,
            message: `Approved ${approved} scenarios`,
            approved,
            skipped
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

module.exports = router;

/**
 * ============================================================================
 * SCENARIO ENGINE WORKER - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * The core engine that fills coverage gaps automatically.
 * Runs as a job processor - picks up jobs and generates scenarios.
 * 
 * KEY BEHAVIORS (Anti-Loop Contract):
 * - Only generates for ENABLED services
 * - Only generates if gap exists (approved + pending < target)
 * - Respects cooldowns, budgets, and blocked services
 * - Stops immediately when coverage is met
 * - All scenarios go to PendingScenario (human approval required)
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const mongoose = require('mongoose');

// Models
const ScenarioGenerationJob = require('../../models/ScenarioGenerationJob');
const PendingScenario = require('../../models/PendingScenario');
const ScenarioEngineState = require('../../models/ScenarioEngineState');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const ServiceCatalog = require('../../models/ServiceCatalog');
const ServiceSwitchboard = require('../../models/ServiceSwitchboard');

// Services
const { generateScenariosForService, validateMultiTenantCompliance } = require('../scenarioGeneration/serviceScenarioGenerator');
const { calculateTemplateCoverage, COVERAGE_TARGETS } = require('./coverageCalculator');

/**
 * BATCH SIZES by service type
 * Smaller batches = better quality
 */
const BATCH_SIZES = {
    work: 6,      // 6 scenarios per GPT call for WORK
    symptom: 4,   // 4 for SYMPTOM
    admin: 2      // 2 for ADMIN
};

/**
 * Process a generation job
 * @param {string} jobId - Job ID to process
 * @returns {Object} Result summary
 */
async function processJob(jobId) {
    const job = await ScenarioGenerationJob.findById(jobId);
    if (!job) {
        throw new Error(`Job not found: ${jobId}`);
    }
    
    if (job.status === 'cancelled') {
        logger.info('[ENGINE] Job was cancelled, skipping', { jobId });
        return { status: 'cancelled' };
    }
    
    if (job.status === 'completed' || job.status === 'failed') {
        logger.info('[ENGINE] Job already finished', { jobId, status: job.status });
        return { status: job.status };
    }
    
    logger.info('[ENGINE] Starting job processing', {
        jobId,
        templateId: job.templateId,
        mode: job.mode
    });
    
    try {
        // Mark job as running
        await job.start();
        
        // Get engine state
        const state = await ScenarioEngineState.getOrCreate(job.templateId, job.companyId);
        
        // Check if engine can run
        const canRunCheck = state.canRun();
        if (!canRunCheck.canRun) {
            logger.warn('[ENGINE] Cannot run', { reason: canRunCheck.reason });
            await job.fail(canRunCheck.reason);
            return { status: 'failed', reason: canRunCheck.reason };
        }
        
        // Load template and services
        const template = await GlobalInstantResponseTemplate.findById(job.templateId);
        if (!template) {
            throw new Error('Template not found');
        }
        
        // Get services with metadata
        const services = await getServicesWithCoverage(job.templateId, job.companyId);
        
        // Filter to services that need work
        const servicesNeedingWork = services.filter(s => {
            // Must be enabled
            if (!s.enabled) return false;
            
            // Check if blocked
            const blockCheck = state.isServiceBlocked(s.serviceKey);
            if (blockCheck.blocked) return false;
            
            // Must have gap (counting pending)
            const effectiveCount = s.approvedCount + s.pendingCount;
            const target = getTargetForService(s.serviceType);
            if (effectiveCount >= target) return false;
            
            // For service_only mode, must be in target list
            if (job.mode === 'service_only' && job.targetServiceKeys.length > 0) {
                if (!job.targetServiceKeys.includes(s.serviceKey)) return false;
            }
            
            return true;
        });
        
        // Prioritize: WORK first, then SYMPTOM, then ADMIN
        // Within each type, sort by gap size (largest first)
        servicesNeedingWork.sort((a, b) => {
            const typeOrder = { work: 0, symptom: 1, admin: 2 };
            const typeA = typeOrder[a.serviceType] || 0;
            const typeB = typeOrder[b.serviceType] || 0;
            if (typeA !== typeB) return typeA - typeB;
            return b.gap - a.gap;
        });
        
        // Limit to maxServices
        const servicesToProcess = servicesNeedingWork.slice(0, job.limits.maxServices);
        
        // Initialize service runs
        job.serviceRuns = servicesToProcess.map(s => ({
            serviceKey: s.serviceKey,
            serviceType: s.serviceType,
            displayName: s.displayName,
            targetCount: getTargetForService(s.serviceType),
            currentApproved: s.approvedCount,
            currentPending: s.pendingCount,
            gap: s.gap,
            status: 'queued',
            attempts: 0
        }));
        job.progress.servicesTotal = servicesToProcess.length;
        await job.save();
        
        logger.info('[ENGINE] Services to process', {
            total: servicesToProcess.length,
            services: servicesToProcess.map(s => s.serviceKey)
        });
        
        // Process each service
        let totalGenerated = 0;
        let totalQueued = 0;
        let totalTokens = 0;
        
        for (const service of servicesToProcess) {
            // Check if job was cancelled
            const freshJob = await ScenarioGenerationJob.findById(jobId);
            if (freshJob.status === 'cancelled') {
                logger.info('[ENGINE] Job cancelled mid-process');
                break;
            }
            
            // Check budget
            if (totalTokens >= job.limits.dailyTokenBudget) {
                logger.warn('[ENGINE] Token budget exceeded, stopping');
                break;
            }
            
            if (totalGenerated >= job.limits.maxScenariosTotal) {
                logger.warn('[ENGINE] Scenario limit reached, stopping');
                break;
            }
            
            try {
                // Update service run to running
                await job.updateServiceRun(service.serviceKey, {
                    status: 'running',
                    startedAt: new Date()
                });
                
                // Calculate how many to generate
                const target = getTargetForService(service.serviceType);
                const effective = service.approvedCount + service.pendingCount;
                const needed = Math.min(
                    target - effective,
                    job.limits.maxScenariosPerService,
                    job.limits.maxScenariosTotal - totalGenerated
                );
                
                if (needed <= 0) {
                    await job.updateServiceRun(service.serviceKey, {
                        status: 'skipped',
                        skipReason: 'No gap remaining',
                        finishedAt: new Date()
                    });
                    job.progress.servicesSkipped += 1;
                    continue;
                }
                
                logger.info('[ENGINE] Generating for service', {
                    serviceKey: service.serviceKey,
                    needed,
                    approved: service.approvedCount,
                    pending: service.pendingCount
                });
                
                // Generate in batches
                const batchSize = BATCH_SIZES[service.serviceType] || 6;
                let serviceGenerated = 0;
                let serviceQueued = 0;
                let serviceTokens = 0;
                
                while (serviceGenerated < needed) {
                    const batchCount = Math.min(batchSize, needed - serviceGenerated);
                    
                    // Get existing scenarios for dedupe hints
                    const existingScenarios = template.scenarios
                        .filter(s => s.serviceKey === service.serviceKey || 
                                    (s.category || '').toLowerCase().includes(service.serviceKey))
                        .map(s => ({ scenarioName: s.scenarioName || s.name }));
                    
                    // Call GPT
                    const result = await generateScenariosForService(service, {
                        targetCount: batchCount,
                        templateName: template.name,
                        existingScenarios,
                        tradeType: 'hvac'
                    });
                    
                    if (!result.success) {
                        logger.error('[ENGINE] Generation failed', {
                            serviceKey: service.serviceKey,
                            error: result.error
                        });
                        
                        // Increment failure count
                        await job.updateServiceRun(service.serviceKey, {
                            attempts: (job.serviceRuns.find(r => r.serviceKey === service.serviceKey)?.attempts || 0) + 1,
                            lastError: result.error
                        });
                        
                        // Check if should block
                        const run = job.serviceRuns.find(r => r.serviceKey === service.serviceKey);
                        if (run && run.attempts >= job.limits.maxRetries) {
                            await state.blockService(service.serviceKey, 'too_many_failures', result.error, 24);
                            await job.updateServiceRun(service.serviceKey, { status: 'blocked' });
                        }
                        
                        break; // Move to next service
                    }
                    
                    serviceTokens += result.meta.tokensUsed || 0;
                    
                    // Process generated scenarios
                    for (const scenario of result.scenarios) {
                        // Run lint validation
                        const lintResult = validateMultiTenantCompliance(scenario);
                        
                        // Create pending scenario
                        const createResult = await PendingScenario.createPending({
                            templateId: job.templateId,
                            companyId: job.companyId,
                            serviceKey: service.serviceKey,
                            serviceType: service.serviceType,
                            payload: {
                                scenarioName: scenario.scenarioName,
                                scenarioType: scenario.scenarioType,
                                category: scenario.category,
                                triggers: scenario.triggers,
                                quickReplies: scenario.quickReplies,
                                fullReplies: scenario.fullReplies,
                                generationNotes: scenario.generationNotes
                            },
                            generatedBy: {
                                model: 'gpt-4o',
                                jobId: job._id,
                                tokensUsed: Math.round((result.meta.tokensUsed || 0) / result.scenarios.length)
                            }
                        });
                        
                        if (createResult.created) {
                            // Update lint results
                            await createResult.pending.updateLint({
                                passed: lintResult.isCompliant,
                                errors: lintResult.violations,
                                warnings: [],
                                placeholdersUsed: lintResult.placeholdersUsed
                            });
                            
                            serviceQueued++;
                        } else {
                            logger.debug('[ENGINE] Skipped duplicate', {
                                serviceKey: service.serviceKey,
                                fingerprint: createResult.fingerprint
                            });
                        }
                        
                        serviceGenerated++;
                    }
                }
                
                // Update service run
                await job.updateServiceRun(service.serviceKey, {
                    status: 'done',
                    scenariosGenerated: serviceGenerated,
                    scenariosQueued: serviceQueued,
                    finishedAt: new Date()
                });
                
                totalGenerated += serviceGenerated;
                totalQueued += serviceQueued;
                totalTokens += serviceTokens;
                job.progress.servicesDone += 1;
                
            } catch (error) {
                logger.error('[ENGINE] Service processing error', {
                    serviceKey: service.serviceKey,
                    error: error.message
                });
                
                await job.updateServiceRun(service.serviceKey, {
                    status: 'failed',
                    lastError: error.message,
                    finishedAt: new Date()
                });
                
                job.progress.servicesFailed += 1;
            }
            
            // Update progress
            job.progress.scenariosGenerated = totalGenerated;
            job.progress.scenariosQueuedForReview = totalQueued;
            job.progress.tokensUsed = totalTokens;
            job.progress.estimatedCost = (totalTokens / 1000) * 0.01;
            await job.save();
        }
        
        // Complete job
        await job.complete();
        
        // Record run in state
        await state.recordRun({
            tokensUsed: totalTokens,
            scenariosGenerated: totalGenerated,
            status: job.progress.servicesFailed > 0 ? 'partial' : 'success',
            summary: `Generated ${totalGenerated} scenarios, queued ${totalQueued} for review`
        });
        
        logger.info('[ENGINE] Job completed', {
            jobId,
            generated: totalGenerated,
            queued: totalQueued,
            tokens: totalTokens
        });
        
        return {
            status: 'completed',
            generated: totalGenerated,
            queued: totalQueued,
            tokens: totalTokens
        };
        
    } catch (error) {
        logger.error('[ENGINE] Job failed', { jobId, error: error.message });
        await job.fail(error.message);
        return { status: 'failed', error: error.message };
    }
}

/**
 * Get services with coverage data
 */
async function getServicesWithCoverage(templateId, companyId) {
    // Get catalog
    const catalog = await ServiceCatalog.findOne({ templateId });
    if (!catalog) return [];
    
    const catalogMap = new Map(catalog.services.map(s => [s.serviceKey, s.toObject()]));
    
    // Get switchboard
    let services = [];
    if (companyId) {
        const switchboard = await ServiceSwitchboard.findOne({ companyId });
        if (switchboard) {
            services = switchboard.services.map(sw => ({
                ...catalogMap.get(sw.serviceKey),
                serviceKey: sw.serviceKey,
                enabled: sw.enabled
            })).filter(s => s.displayName);
        }
    }
    
    // Fallback to catalog
    if (services.length === 0) {
        services = catalog.services.map(s => ({
            ...s.toObject(),
            enabled: true
        }));
    }
    
    // Get template for approved counts
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    const scenarios = template?.scenarios || [];
    
    // Get pending counts
    const pendingCounts = await PendingScenario.getPendingCountsByService(templateId);
    
    // Calculate coverage for each
    return services.map(s => {
        const serviceType = (s.serviceType || 'work').toLowerCase();
        const target = getTargetForService(serviceType);
        
        // Count approved scenarios for this service
        const approvedCount = scenarios.filter(sc => 
            sc.serviceKey === s.serviceKey ||
            (sc.category || '').toLowerCase().includes(s.serviceKey.replace(/_/g, ' '))
        ).length;
        
        // Get pending count
        const pendingData = pendingCounts[s.serviceKey] || { pending: 0 };
        const pendingCount = pendingData.pending;
        
        // Calculate gap (counting pending toward coverage)
        const effectiveCount = approvedCount + pendingCount;
        const gap = Math.max(0, target - effectiveCount);
        
        return {
            ...s,
            serviceType,
            approvedCount,
            pendingCount,
            effectiveCount,
            target,
            gap
        };
    });
}

/**
 * Get target count for a service type
 */
function getTargetForService(serviceType) {
    const targets = COVERAGE_TARGETS[serviceType] || COVERAGE_TARGETS.work;
    return targets.total;
}

/**
 * Run engine once (manual trigger)
 */
async function runOnce(templateId, companyId, createdBy) {
    // Check for existing active job
    const existingJob = await ScenarioGenerationJob.findActiveJob(templateId, companyId);
    if (existingJob) {
        return {
            success: false,
            error: 'Active job already running',
            jobId: existingJob._id
        };
    }
    
    // Create job
    const job = await ScenarioGenerationJob.createJob({
        templateId,
        companyId,
        mode: 'fill_gaps',
        createdBy
    });
    
    // Process immediately
    const result = await processJob(job._id);
    
    return {
        success: result.status === 'completed',
        jobId: job._id,
        ...result
    };
}

module.exports = {
    processJob,
    runOnce,
    getServicesWithCoverage,
    getTargetForService,
    BATCH_SIZES
};

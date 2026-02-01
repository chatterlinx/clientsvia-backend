/**
 * ============================================================================
 * SERVICE SCENARIO GENERATION ROUTES - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * API endpoints for generating scenarios from Service Catalog.
 * Follows Deep Audit style: one card at a time, admin review, auto-verify.
 * 
 * BASE PATH: /api/admin/scenario-generation
 * 
 * ENDPOINTS:
 * 
 * GENERATION:
 * POST /service/:serviceKey/generate      - Generate scenarios for a service
 * POST /service/:serviceKey/generate-one  - Generate single scenario
 * GET  /service/:serviceKey/queue         - Get generation queue (what's needed)
 * 
 * REVIEW FLOW:
 * POST /card/approve                      - Approve and save a card
 * POST /card/skip                         - Skip a card
 * GET  /card/:cardId/preview              - Preview card before approval
 * 
 * BATCH:
 * POST /batch/generate                    - Generate for multiple services
 * GET  /coverage                          - Get overall generation coverage
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

// Models
const ServiceCatalog = require('../../models/ServiceCatalog');
const ServiceSwitchboard = require('../../models/ServiceSwitchboard');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const ScenarioAuditResult = require('../../models/ScenarioAuditResult');

// Services
const {
    generateScenariosForService,
    generateSingleScenario,
    getGenerationQueue,
    formatForGlobalBrain
} = require('../../services/scenarioGeneration/serviceScenarioGenerator');

// ============================================================================
// GENERATION ENDPOINTS
// ============================================================================

/**
 * POST /service/:serviceKey/generate
 * Generate scenarios for a specific service
 */
router.post('/service/:serviceKey/generate', async (req, res) => {
    try {
        const { serviceKey } = req.params;
        const { templateId, companyId, targetCount } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get the service from catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Service catalog not found' });
        }
        
        const service = catalog.getService(serviceKey);
        if (!service) {
            return res.status(404).json({ error: `Service "${serviceKey}" not found in catalog` });
        }
        
        // Get existing scenarios for this service (to avoid duplicates)
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        const existingScenarios = [];
        
        if (template && template.categories) {
            for (const cat of template.categories) {
                for (const scenario of (cat.scenarios || [])) {
                    // Check if scenario belongs to this service
                    if (scenario.serviceKey === serviceKey || 
                        scenario.category === service.category ||
                        (scenario.scenarioName || '').toLowerCase().includes(serviceKey.replace(/_/g, ' '))) {
                        existingScenarios.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.scenarioName || scenario.name,
                            scenarioType: scenario.scenarioType
                        });
                    }
                }
            }
        }
        
        logger.info('[SCENARIO GENERATION] Starting generation', {
            serviceKey,
            templateId,
            existingCount: existingScenarios.length,
            targetCount: targetCount || service.scenarioHints?.targetScenarioCount
        });
        
        // Generate scenarios
        const result = await generateScenariosForService(service, {
            targetCount: targetCount || service.scenarioHints?.targetScenarioCount || 8,
            templateName: template?.name || 'Template',
            existingScenarios,
            tradeType: catalog.industryType || 'hvac'
        });
        
        if (!result.success) {
            return res.status(500).json({
                error: result.error,
                meta: result.meta
            });
        }
        
        // Format scenarios for review
        const cardsForReview = result.scenarios.map((scenario, idx) => ({
            cardId: `card-${Date.now()}-${idx}`,
            position: idx + 1,
            totalCards: result.scenarios.length,
            scenario,
            formatted: formatForGlobalBrain(scenario, templateId),
            status: 'pending_review'
        }));
        
        logger.info('[SCENARIO GENERATION] Generation complete', {
            serviceKey,
            generatedCount: cardsForReview.length,
            meta: result.meta
        });
        
        res.json({
            success: true,
            service: {
                serviceKey: service.serviceKey,
                displayName: service.displayName,
                category: service.category
            },
            cards: cardsForReview,
            meta: result.meta,
            existingCount: existingScenarios.length,
            reviewInstructions: {
                flow: 'sequential',
                description: 'Review each card one at a time. Approve to save, or skip.',
                afterApprove: 'Card saves to template and triggers Deep Audit verification'
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /service/:serviceKey/generate-one
 * Generate a single additional scenario
 */
router.post('/service/:serviceKey/generate-one', async (req, res) => {
    try {
        const { serviceKey } = req.params;
        const { templateId, existingNames } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get the service
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        const service = catalog.getService(serviceKey);
        if (!service) {
            return res.status(404).json({ error: `Service "${serviceKey}" not found` });
        }
        
        // Build existing list
        const existingScenarios = (existingNames || []).map(name => ({ scenarioName: name }));
        
        // Generate one
        const result = await generateSingleScenario(service, existingScenarios, {
            templateName: 'Template',
            tradeType: catalog.industryType || 'hvac'
        });
        
        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }
        
        res.json({
            success: true,
            card: {
                cardId: `card-${Date.now()}-single`,
                scenario: result.scenario,
                formatted: formatForGlobalBrain(result.scenario, templateId),
                status: 'pending_review'
            },
            meta: result.meta
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Error generating single', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /service/:serviceKey/queue
 * Get generation queue (what scenarios are needed)
 */
router.get('/service/:serviceKey/queue', async (req, res) => {
    try {
        const { serviceKey } = req.params;
        const { templateId } = req.query;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId query param required' });
        }
        
        // Get service
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        const service = catalog.getService(serviceKey);
        if (!service) {
            return res.status(404).json({ error: `Service "${serviceKey}" not found` });
        }
        
        // Get existing scenarios
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        const existingScenarios = [];
        
        if (template && template.categories) {
            for (const cat of template.categories) {
                for (const scenario of (cat.scenarios || [])) {
                    if (scenario.serviceKey === serviceKey) {
                        existingScenarios.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.scenarioName || scenario.name,
                            scenarioType: scenario.scenarioType
                        });
                    }
                }
            }
        }
        
        // Get queue
        const queue = getGenerationQueue(service, existingScenarios);
        
        res.json({
            success: true,
            service: {
                serviceKey: service.serviceKey,
                displayName: service.displayName,
                targetCount: service.scenarioHints?.targetScenarioCount || 8
            },
            queue,
            existing: existingScenarios
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Error getting queue', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// CARD REVIEW ENDPOINTS
// ============================================================================

/**
 * POST /card/approve
 * Approve a card and save to template
 */
router.post('/card/approve', async (req, res) => {
    try {
        const { templateId, categoryName, scenario, triggerDeepAudit } = req.body;
        
        if (!templateId || !scenario) {
            return res.status(400).json({ error: 'templateId and scenario required' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Find or create category
        const targetCategory = categoryName || scenario.category || 'Generated Scenarios';
        let category = template.categories.find(c => c.name === targetCategory);
        
        if (!category) {
            // Create new category with all required fields
            template.categories.push({
                id: `cat-${Date.now()}`,
                name: targetCategory,
                description: `Auto-generated category for ${targetCategory} scenarios`,
                icon: '🤖',
                isActive: true,
                scenarios: []
            });
            category = template.categories[template.categories.length - 1];
        }
        
        // Generate scenario ID if not present
        if (!scenario.scenarioId) {
            scenario.scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }
        
        // Add scenario to category
        category.scenarios.push({
            scenarioId: scenario.scenarioId,
            scenarioName: scenario.scenarioName || scenario.name,
            name: scenario.scenarioName || scenario.name,
            scenarioType: scenario.scenarioType,
            triggers: scenario.triggers,
            quickReplies: scenario.quickReplies,
            fullReplies: scenario.fullReplies,
            confidenceThreshold: scenario.confidenceThreshold || 0.75,
            priority: scenario.priority || 5,
            behavior: scenario.behavior || 'respond',
            isActive: true,
            scope: 'GLOBAL',
            serviceKey: scenario.serviceKey,
            createdAt: new Date(),
            createdBy: 'Service Scenario Generator'
        });
        
        // Update template stats
        template.stats = template.stats || {};
        template.stats.totalScenarios = (template.stats.totalScenarios || 0) + 1;
        
        await template.save();
        
        logger.info('[SCENARIO GENERATION] Card approved and saved', {
            templateId,
            scenarioId: scenario.scenarioId,
            scenarioName: scenario.scenarioName,
            category: targetCategory
        });
        
        // Trigger Deep Audit if requested
        let auditResult = null;
        if (triggerDeepAudit) {
            // TODO: Call Deep Audit service
            // auditResult = await runDeepAuditOnScenario(templateId, scenario.scenarioId);
            auditResult = { pending: true, message: 'Deep Audit will run on next audit cycle' };
        }
        
        res.json({
            success: true,
            saved: {
                scenarioId: scenario.scenarioId,
                scenarioName: scenario.scenarioName,
                category: targetCategory,
                templateId
            },
            auditResult,
            nextAction: {
                type: 'review_next_card',
                message: 'Card saved! Review the next card or finish.'
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Error approving card', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /card/skip
 * Skip a card (don't save)
 */
router.post('/card/skip', async (req, res) => {
    try {
        const { cardId, reason } = req.body;
        
        logger.info('[SCENARIO GENERATION] Card skipped', { cardId, reason });
        
        res.json({
            success: true,
            skipped: { cardId, reason },
            nextAction: {
                type: 'review_next_card',
                message: 'Card skipped. Review the next card or finish.'
            }
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// COVERAGE ENDPOINTS
// ============================================================================

/**
 * GET /coverage
 * Get overall scenario generation coverage for a template
 */
router.get('/coverage', async (req, res) => {
    try {
        const { templateId } = req.query;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        // Count scenarios per service
        const scenariosByService = {};
        if (template && template.categories) {
            for (const cat of template.categories) {
                for (const scenario of (cat.scenarios || [])) {
                    const key = scenario.serviceKey || 'uncategorized';
                    scenariosByService[key] = (scenariosByService[key] || 0) + 1;
                }
            }
        }
        
        // Build coverage report
        const coverage = [];
        let totalTarget = 0;
        let totalActual = 0;
        
        for (const service of catalog.services) {
            const target = service.scenarioHints?.targetScenarioCount || 8;
            const actual = scenariosByService[service.serviceKey] || 0;
            const percent = Math.min(100, Math.round((actual / target) * 100));
            
            totalTarget += target;
            totalActual += actual;
            
            coverage.push({
                serviceKey: service.serviceKey,
                displayName: service.displayName,
                category: service.category,
                targetCount: target,
                actualCount: actual,
                coveragePercent: percent,
                status: percent >= 100 ? 'complete' : percent >= 50 ? 'partial' : 'needs_work'
            });
        }
        
        // Sort by coverage (lowest first)
        coverage.sort((a, b) => a.coveragePercent - b.coveragePercent);
        
        res.json({
            success: true,
            template: {
                id: templateId,
                name: template?.name
            },
            summary: {
                totalServices: catalog.services.length,
                targetScenarios: totalTarget,
                actualScenarios: totalActual,
                overallPercent: Math.round((totalActual / totalTarget) * 100),
                complete: coverage.filter(c => c.status === 'complete').length,
                partial: coverage.filter(c => c.status === 'partial').length,
                needsWork: coverage.filter(c => c.status === 'needs_work').length
            },
            byService: coverage
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Error getting coverage', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /batch/generate
 * Generate scenarios for multiple services (batch)
 */
router.post('/batch/generate', async (req, res) => {
    try {
        const { templateId, serviceKeys, maxPerService } = req.body;
        
        if (!templateId || !serviceKeys || !Array.isArray(serviceKeys)) {
            return res.status(400).json({ error: 'templateId and serviceKeys array required' });
        }
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Generate for each service
        const results = [];
        for (const serviceKey of serviceKeys) {
            const service = catalog.getService(serviceKey);
            if (!service) {
                results.push({
                    serviceKey,
                    success: false,
                    error: 'Service not found'
                });
                continue;
            }
            
            const result = await generateScenariosForService(service, {
                targetCount: maxPerService || service.scenarioHints?.targetScenarioCount || 4,
                tradeType: catalog.industryType || 'hvac'
            });
            
            results.push({
                serviceKey,
                serviceName: service.displayName,
                success: result.success,
                generatedCount: result.scenarios?.length || 0,
                cards: result.scenarios?.map((s, i) => ({
                    cardId: `card-${serviceKey}-${i}`,
                    scenario: s,
                    formatted: formatForGlobalBrain(s, templateId)
                })) || [],
                meta: result.meta
            });
        }
        
        res.json({
            success: true,
            batchResults: results,
            summary: {
                total: serviceKeys.length,
                successful: results.filter(r => r.success).length,
                totalCards: results.reduce((sum, r) => sum + (r.generatedCount || 0), 0)
            }
        });
        
    } catch (error) {
        logger.error('[SCENARIO GENERATION] Batch error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

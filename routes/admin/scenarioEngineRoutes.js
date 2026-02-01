/**
 * ============================================================================
 * SCENARIO ENGINE ROUTES - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * API endpoints for the Scenario Coverage Engine.
 * Provides coverage analysis, generation queue, and engine status.
 * 
 * BASE PATH: /api/admin/scenario-engine
 * 
 * ENDPOINTS:
 * GET  /coverage/:templateId          - Get full coverage report
 * GET  /coverage/:templateId/export   - Export coverage as JSON
 * GET  /queue/:templateId             - Get generation queue
 * POST /generate/:templateId          - Trigger generation for gaps
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
const DeepAuditResult = require('../../models/DeepAuditResult');
const v2Company = require('../../models/v2Company');

// Services
const { calculateTemplateCoverage, getGenerationQueue, COVERAGE_TARGETS } = require('../../services/scenarioEngine/coverageCalculator');

/**
 * GET /coverage/:templateId
 * Get full coverage report for a template
 */
router.get('/coverage/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId } = req.query;
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        // Get template with scenarios
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Get scenarios from template
        const scenarios = template.scenarios || [];
        
        // Get services from switchboard (if companyId provided) or catalog
        let services = [];
        
        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            // Get company's switchboard
            const switchboard = await ServiceSwitchboard.findOne({ companyId });
            if (switchboard) {
                services = switchboard.services || [];
            }
        }
        
        // If no company services, get from catalog
        if (services.length === 0) {
            const catalog = await ServiceCatalog.findOne({ templateId });
            if (catalog) {
                // Convert catalog services to switchboard format (all enabled)
                services = catalog.services.map(s => ({
                    ...s.toObject(),
                    enabled: true
                }));
            }
        }
        
        // Get audit results for this template
        let auditResults = [];
        try {
            const auditDocs = await DeepAuditResult.find({ 
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
            ...coverageReport
        });
        
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error calculating coverage', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /coverage/:templateId/export
 * Export full coverage report as downloadable JSON
 */
router.get('/coverage/:templateId/export', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId } = req.query;
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const scenarios = template.scenarios || [];
        
        // Get services
        let services = [];
        let companyName = null;
        
        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            const switchboard = await ServiceSwitchboard.findOne({ companyId });
            if (switchboard) {
                services = switchboard.services || [];
            }
            
            const company = await v2Company.findById(companyId, 'businessName');
            companyName = company?.businessName;
        }
        
        if (services.length === 0) {
            const catalog = await ServiceCatalog.findOne({ templateId });
            if (catalog) {
                services = catalog.services.map(s => ({
                    ...s.toObject(),
                    enabled: true
                }));
            }
        }
        
        // Get audit results
        let auditResults = [];
        try {
            const auditDocs = await DeepAuditResult.find({ 
                templateId,
                'results.0': { $exists: true }
            }).sort({ createdAt: -1 }).limit(1);
            
            if (auditDocs.length > 0) {
                auditResults = auditDocs[0].results || [];
            }
        } catch (e) {
            // Ignore
        }
        
        // Calculate coverage
        const coverageReport = calculateTemplateCoverage(services, scenarios, auditResults);
        
        // Build export object
        const exportData = {
            exportedAt: new Date().toISOString(),
            exportType: 'scenario_coverage_report',
            version: '1.0',
            
            template: {
                id: templateId,
                name: template.name,
                scenarioCount: scenarios.length
            },
            
            company: companyId ? {
                id: companyId,
                name: companyName
            } : null,
            
            coverageTargets: COVERAGE_TARGETS,
            
            summary: coverageReport.summary,
            typeSummaries: coverageReport.typeSummaries,
            
            services: coverageReport.services,
            
            generationQueue: coverageReport.needsWork
        };
        
        res.json(exportData);
        
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error exporting coverage', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /queue/:templateId
 * Get generation queue (services needing scenarios)
 */
router.get('/queue/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { companyId, limit = 10 } = req.query;
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const scenarios = template.scenarios || [];
        
        // Get services
        let services = [];
        
        if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
            const switchboard = await ServiceSwitchboard.findOne({ companyId });
            if (switchboard) {
                services = switchboard.services || [];
            }
        }
        
        if (services.length === 0) {
            const catalog = await ServiceCatalog.findOne({ templateId });
            if (catalog) {
                services = catalog.services.map(s => ({
                    ...s.toObject(),
                    enabled: true
                }));
            }
        }
        
        // Calculate coverage
        const coverageReport = calculateTemplateCoverage(services, scenarios, []);
        
        // Get queue
        const queue = getGenerationQueue(coverageReport, parseInt(limit));
        
        res.json({
            success: true,
            templateId,
            queueLength: queue.length,
            totalGap: coverageReport.summary.gapTotal,
            queue
        });
        
    } catch (error) {
        logger.error('[SCENARIO ENGINE] Error getting queue', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /targets
 * Get coverage target configuration
 */
router.get('/targets', (req, res) => {
    res.json({
        success: true,
        targets: COVERAGE_TARGETS
    });
});

module.exports = router;

/**
 * DEBUG ENDPOINT - Force reload scenarios and clear cache
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const ScenarioPoolService = require('../services/ScenarioPoolService');
const logger = require('../utils/logger');

// ============================================================================
// POST /api/debug/reload-scenarios/:companyId
// Force reload scenarios and clear Redis cache
// ============================================================================
router.post('/reload-scenarios/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[DEBUG] Force reloading scenarios', { companyId });
        
        // Clear Redis cache
        const redis = req.app.locals.redis;
        if (redis) {
            const cacheKey = `scenarioPool:${companyId}`;
            await redis.del(cacheKey);
            logger.info('[DEBUG] Redis cache cleared', { cacheKey });
        }
        
        // Force reload fresh from database
        const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        
        // Analyze what we got
        const statusBreakdown = {};
        const categoryBreakdown = {};
        
        scenarios.forEach(s => {
            // Status
            const status = s.status || 'undefined';
            statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
            
            // Category
            const cat = s.categoryName || 'Uncategorized';
            categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        });
        
        // Sample first 3 scenarios
        const samples = scenarios.slice(0, 3).map(s => ({
            name: s.name,
            categoryName: s.categoryName,
            categoryId: s.categoryId,
            status: s.status,
            isActive: s.isActive
        }));
        
        res.json({
            success: true,
            companyId,
            totalScenarios: scenarios.length,
            templatesUsed: templatesUsed.length,
            statusBreakdown,
            categoryBreakdown,
            samples,
            message: 'Scenarios reloaded fresh from database'
        });
        
    } catch (error) {
        logger.error('[DEBUG] Reload scenarios failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/debug/audit-diagnostic/:templateId
// PUBLIC - No auth required - Temporary debug endpoint
// Shows scenarioId format comparison between saved results and template
// ============================================================================
router.get('/audit-diagnostic/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info('[AUDIT-DIAGNOSTIC] Running diagnostic', { templateId });
        
        const ScenarioAuditResult = require('../models/ScenarioAuditResult');
        const AuditProfile = require('../models/AuditProfile');
        const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
        const mongoose = require('mongoose');
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        if (!template) {
            return res.status(404).json({ error: 'Template not found', templateId });
        }
        
        // Get all profiles for this template
        const profiles = await AuditProfile.find({ templateId }).lean();
        
        // Get total results count
        const totalResultCount = await ScenarioAuditResult.countDocuments({ templateId });
        
        // Get sample results
        const sampleResults = await ScenarioAuditResult.find({ templateId })
            .limit(10)
            .sort({ createdAt: -1 })
            .select('scenarioId scenarioName score verdict createdAt auditProfileId')
            .lean();
        
        // Get ALL unique templateIds in the entire collection
        const allTemplateIds = await ScenarioAuditResult.distinct('templateId');
        
        // Get counts per templateId
        const countsByTemplateId = await ScenarioAuditResult.aggregate([
            { $group: { _id: '$templateId', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        // Get sample scenarioIds from the template
        const templateScenarioIds = [];
        (template.categories || []).slice(0, 2).forEach(cat => {
            (cat.scenarios || []).slice(0, 3).forEach(s => {
                templateScenarioIds.push({
                    scenarioId: s.scenarioId,
                    _id: s._id?.toString(),
                    id: s.id,
                    name: s.name || s.scenarioName,
                    derivedId: s.scenarioId || s._id?.toString() || s.id
                });
            });
        });
        
        // Get stored scenarioIds
        const storedScenarioIds = sampleResults.map(r => ({
            scenarioId: r.scenarioId,
            scenarioName: r.scenarioName,
            score: r.score
        }));
        
        res.json({
            success: true,
            queryTemplateId: templateId,
            templateName: template.name || template.templateName,
            
            profilesCount: profiles.length,
            profiles: profiles.map(p => ({ id: p._id.toString(), name: p.name, isActive: p.isActive })),
            
            resultsForThisTemplate: totalResultCount,
            
            storedScenarioIds_sample: storedScenarioIds,
            templateScenarioIds_sample: templateScenarioIds,
            
            globalState: {
                allTemplateIdsInDb: allTemplateIds,
                countsByTemplateId: countsByTemplateId
            },
            
            diagnosis: {
                resultsExist: totalResultCount > 0,
                templateIdMatch: allTemplateIds.includes(templateId),
                possibleIdMismatch: storedScenarioIds.length > 0 && templateScenarioIds.length > 0
                    ? storedScenarioIds[0].scenarioId !== templateScenarioIds[0].derivedId
                    : null,
                hint: totalResultCount === 0 && allTemplateIds.length > 0
                    ? 'Results exist but under different templateId - check format'
                    : totalResultCount === 0
                        ? 'No results saved at all - check Render logs for save errors'
                        : 'Results exist - check scenarioId format match'
            }
        });
        
    } catch (error) {
        logger.error('[AUDIT-DIAGNOSTIC] Error', { error: error.message, stack: error.stack });
        res.status(500).json({ error: 'Diagnostic failed', details: error.message });
    }
});

module.exports = router;

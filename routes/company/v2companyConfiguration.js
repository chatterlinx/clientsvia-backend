/**
 * ============================================================================
 * COMPANY CONFIGURATION API - 100% ISOLATED FROM LEGACY
 * ============================================================================
 * 
 * PURPOSE: Backend API for AI Agent Settings tab
 * ISOLATION: Zero dependencies on legacy AI Agent Logic routes
 * 
 * ENDPOINTS:
 * - GET    /api/company/:companyId/configuration
 * - GET    /api/company/:companyId/configuration/variables
 * - PATCH  /api/company/:companyId/configuration/variables
 * - GET    /api/company/:companyId/configuration/variables/:key/usage
 * - GET    /api/company/:companyId/configuration/filler-words
 * - POST   /api/company/:companyId/configuration/filler-words
 * - DELETE /api/company/:companyId/configuration/filler-words/:word
 * - POST   /api/company/:companyId/configuration/filler-words/reset
 * - GET    /api/company/:companyId/configuration/scenarios
 * - GET    /api/company/:companyId/configuration/template-info
 * - POST   /api/company/:companyId/configuration/sync
 * - GET    /api/company/:companyId/configuration/analytics
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authMiddleware } = require('../../middleware/auth');
const ConfigurationReadinessService = require('../../services/ConfigurationReadinessService');
const { redisClient } = require('../../db');

// Apply authentication to all routes
router.use(authMiddleware);

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration
 * Load complete configuration (overview)
 * ============================================================================
 */
router.get('/:companyId/configuration', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Return configuration overview
        const config = {
            variables: company.configuration?.variables || {},
            variablesStatus: calculateVariablesStatus(company),
            fillerWords: {
                inherited: company.configuration?.fillerWords?.inherited || [],
                custom: company.configuration?.fillerWords?.custom || [],
                active: [
                    ...(company.configuration?.fillerWords?.inherited || []),
                    ...(company.configuration?.fillerWords?.custom || [])
                ]
            },
            clonedFrom: company.configuration?.clonedFrom || null,
            lastSyncedAt: company.configuration?.lastSyncedAt || null
        };
        
        res.json(config);
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading configuration:', error);
        res.status(500).json({ error: 'Failed to load configuration' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/variables
 * Load variables and their definitions
 * ============================================================================
 */
router.get('/:companyId/configuration/variables', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/variables for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get variable definitions from cloned template
        let definitions = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template && template.availableVariables) {
                definitions = template.availableVariables;
            }
        }
        
        // Get current variable values
        const variables = company.configuration?.variables || {};
        
        res.json({
            variables,
            definitions
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading variables:', error);
        res.status(500).json({ error: 'Failed to load variables' });
    }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/configuration/variables
 * Update variable values
 * ============================================================================
 */
router.patch('/:companyId/configuration/variables', async (req, res) => {
    console.log(`[COMPANY CONFIG] PATCH /configuration/variables for company: ${req.params.companyId}`);
    
    try {
        const { variables } = req.body;
        
        if (!variables || typeof variables !== 'object') {
            return res.status(400).json({ error: 'Invalid variables data' });
        }
        
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Initialize configuration if needed
        if (!company.configuration) {
            company.configuration = {};
        }
        
        // Update variables
        company.configuration.variables = variables;
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        console.log(`[COMPANY CONFIG] Variables updated for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            variables: company.configuration.variables,
            variablesStatus: calculateVariablesStatus(company)
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error updating variables:', error);
        res.status(500).json({ error: 'Failed to update variables' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/variables/:key/usage
 * Get usage information for a specific variable
 * ============================================================================
 */
router.get('/:companyId/configuration/variables/:key/usage', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/variables/${req.params.key}/usage`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get template to find scenarios using this variable
        let scenarios = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template) {
                const variablePattern = `{${req.params.key}}`;
                
                // Search through all scenarios
                template.categories.forEach(category => {
                    category.scenarios.forEach(scenario => {
                        // Check if variable is used in replies
                        const usedInQuick = scenario.quickReplies?.some(r => r.includes(variablePattern));
                        const usedInFull = scenario.fullReplies?.some(r => r.includes(variablePattern));
                        
                        if (usedInQuick || usedInFull) {
                            scenarios.push({
                                name: scenario.name,
                                category: category.name,
                                exampleReply: scenario.quickReplies?.[0] || scenario.fullReplies?.[0] || ''
                            });
                        }
                    });
                });
            }
        }
        
        res.json({
            key: req.params.key,
            usageCount: scenarios.length,
            scenarios
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading variable usage:', error);
        res.status(500).json({ error: 'Failed to load variable usage' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/filler-words
 * Load filler words (inherited + custom)
 * ============================================================================
 */
router.get('/:companyId/configuration/filler-words', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/filler-words for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get inherited words from template
        let inherited = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template && template.fillerWords) {
                inherited = template.fillerWords;
            }
        }
        
        // Get custom words
        const custom = company.configuration?.fillerWords?.custom || [];
        
        res.json({
            inherited,
            custom,
            all: [...inherited, ...custom]
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading filler words:', error);
        res.status(500).json({ error: 'Failed to load filler words' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/filler-words
 * Add custom filler words
 * ============================================================================
 */
router.post('/:companyId/configuration/filler-words', async (req, res) => {
    console.log(`[COMPANY CONFIG] POST /configuration/filler-words for company: ${req.params.companyId}`);
    
    try {
        const { words } = req.body;
        
        if (!Array.isArray(words) || words.length === 0) {
            return res.status(400).json({ error: 'Invalid words array' });
        }
        
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Initialize configuration if needed
        if (!company.configuration) {
            company.configuration = {};
        }
        if (!company.configuration.fillerWords) {
            company.configuration.fillerWords = { custom: [] };
        }
        
        // Add new words (prevent duplicates)
        const existingCustom = company.configuration.fillerWords.custom || [];
        const newWords = words.filter(w => !existingCustom.includes(w));
        
        company.configuration.fillerWords.custom = [...existingCustom, ...newWords];
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        console.log(`[COMPANY CONFIG] Added ${newWords.length} filler words for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            added: newWords.length,
            custom: company.configuration.fillerWords.custom
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error adding filler words:', error);
        res.status(500).json({ error: 'Failed to add filler words' });
    }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/configuration/filler-words/:word
 * Delete a custom filler word
 * ============================================================================
 */
router.delete('/:companyId/configuration/filler-words/:word', async (req, res) => {
    console.log(`[COMPANY CONFIG] DELETE /configuration/filler-words/${req.params.word}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.fillerWords?.custom) {
            return res.status(400).json({ error: 'No custom filler words found' });
        }
        
        // Remove the word
        const word = decodeURIComponent(req.params.word);
        company.configuration.fillerWords.custom = company.configuration.fillerWords.custom.filter(w => w !== word);
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        console.log(`[COMPANY CONFIG] Deleted filler word "${word}" for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            custom: company.configuration.fillerWords.custom
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error deleting filler word:', error);
        res.status(500).json({ error: 'Failed to delete filler word' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/filler-words/reset
 * Reset filler words to template defaults (remove all custom)
 * ============================================================================
 */
router.post('/:companyId/configuration/filler-words/reset', async (req, res) => {
    console.log(`[COMPANY CONFIG] POST /configuration/filler-words/reset for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Clear custom filler words
        if (company.configuration?.fillerWords) {
            company.configuration.fillerWords.custom = [];
            company.configuration.lastUpdatedAt = new Date();
            await company.save();
        }
        
        console.log(`[COMPANY CONFIG] Reset filler words for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            custom: []
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error resetting filler words:', error);
        res.status(500).json({ error: 'Failed to reset filler words' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/scenarios
 * Load scenarios from cloned template
 * ============================================================================
 */
router.get('/:companyId/configuration/scenarios', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/scenarios for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        let scenarios = [];
        let categories = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template) {
                // Flatten scenarios from all categories
                template.categories.forEach(category => {
                    categories.push(category.name);
                    
                    category.scenarios.forEach(scenario => {
                        scenarios.push({
                            id: scenario._id,
                            name: scenario.name,
                            categories: scenario.categories || [category.name],
                            status: scenario.status || 'active',
                            triggers: scenario.triggers || [],
                            quickReplies: scenario.quickReplies || [],
                            fullReplies: scenario.fullReplies || [],
                            priority: scenario.priority || 5
                        });
                    });
                });
            }
        }
        
        res.json({
            scenarios,
            categories: [...new Set(categories)]
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading scenarios:', error);
        res.status(500).json({ error: 'Failed to load scenarios' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/template-info
 * Load template information and sync status
 * ============================================================================
 */
router.get('/:companyId/configuration/template-info', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/template-info for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.clonedFrom) {
            return res.status(404).json({ error: 'No template cloned' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            return res.status(404).json({ error: 'Cloned template not found' });
        }
        
        // Calculate stats
        let totalScenarios = 0;
        let totalCategories = template.categories.length;
        
        template.categories.forEach(cat => {
            totalScenarios += cat.scenarios.length;
        });
        
        // Determine sync status
        const clonedVersion = company.configuration.clonedVersion || '1.0.0';
        const currentVersion = template.version || '1.0.0';
        let syncStatus = 'up_to_date';
        
        if (clonedVersion !== currentVersion) {
            syncStatus = 'updates_available';
        }
        
        res.json({
            templateName: template.name,
            templateDescription: template.description,
            clonedVersion,
            currentVersion,
            clonedAt: company.configuration.clonedAt,
            lastSyncedAt: company.configuration.lastSyncedAt || company.configuration.clonedAt,
            syncStatus,
            stats: {
                scenarios: totalScenarios,
                categories: totalCategories,
                variables: template.availableVariables?.length || 0,
                fillerWords: template.fillerWords?.length || 0
            }
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading template info:', error);
        res.status(500).json({ error: 'Failed to load template info' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/sync
 * Sync updates from Global AI Brain template
 * ============================================================================
 */
router.post('/:companyId/configuration/sync', async (req, res) => {
    console.log(`[COMPANY CONFIG] POST /configuration/sync for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.clonedFrom) {
            return res.status(400).json({ error: 'No template cloned' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Update configuration with latest template data
        company.configuration.clonedVersion = template.version;
        company.configuration.lastSyncedAt = new Date();
        
        // Note: Actual scenario sync would happen here
        // For now, just update the metadata
        
        await company.save();
        
        console.log(`[COMPANY CONFIG] Synced company ${req.params.companyId} with template ${template._id}`);
        
        res.json({
            success: true,
            syncedVersion: template.version,
            syncedAt: company.configuration.lastSyncedAt
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error syncing template:', error);
        res.status(500).json({ error: 'Failed to sync template' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/readiness
 * Calculate readiness score with Redis caching
 * ============================================================================
 */
router.get('/:companyId/configuration/readiness', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/readiness for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        const cacheKey = `readiness:${companyId}`;
        
        // Check cache first (30 second TTL)
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                console.log(`[COMPANY CONFIG] ✅ Returning cached readiness for ${companyId}`);
                return res.json(JSON.parse(cached));
            }
        } catch (cacheError) {
            console.warn('[COMPANY CONFIG] Redis cache miss or error:', cacheError.message);
            // Continue without cache
        }
        
        // Load company
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate readiness
        const report = await ConfigurationReadinessService.calculateReadiness(company);
        
        // Update company readiness in DB (fire and forget)
        Company.findByIdAndUpdate(companyId, {
            'configuration.readiness': {
                lastCalculatedAt: report.calculatedAt,
                score: report.score,
                canGoLive: report.canGoLive,
                isLive: company.configuration?.readiness?.isLive || false,
                goLiveAt: company.configuration?.readiness?.goLiveAt || null,
                goLiveBy: company.configuration?.readiness?.goLiveBy || null,
                components: report.components
            }
        }).catch(err => {
            console.error('[COMPANY CONFIG] Error updating readiness in DB:', err);
        });
        
        // Cache for 30 seconds
        try {
            await redisClient.setex(cacheKey, 30, JSON.stringify(report));
        } catch (cacheError) {
            console.warn('[COMPANY CONFIG] Failed to cache readiness:', cacheError.message);
        }
        
        console.log(`[COMPANY CONFIG] ✅ Readiness calculated: ${report.score}/100, Can Go Live: ${report.canGoLive}`);
        
        res.json(report);
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error calculating readiness:', error);
        res.status(500).json({ error: 'Failed to calculate readiness' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/go-live
 * Mark company as live (requires readiness check)
 * ============================================================================
 */
router.post('/:companyId/configuration/go-live', async (req, res) => {
    console.log(`[COMPANY CONFIG] POST /configuration/go-live for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        
        // Load company
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate readiness first
        const report = await ConfigurationReadinessService.calculateReadiness(company);
        
        // Check if can go live
        if (!report.canGoLive) {
            return res.status(400).json({
                error: 'Company is not ready to go live',
                score: report.score,
                blockers: report.blockers,
                canGoLive: false
            });
        }
        
        // Mark as live
        company.configuration.readiness = {
            lastCalculatedAt: report.calculatedAt,
            score: report.score,
            canGoLive: report.canGoLive,
            isLive: true,
            goLiveAt: new Date(),
            goLiveBy: req.user?.userId || 'system',
            components: report.components
        };
        
        await company.save();
        
        // Invalidate cache
        try {
            await redisClient.del(`readiness:${companyId}`);
        } catch (err) {
            console.warn('[COMPANY CONFIG] Failed to invalidate cache:', err);
        }
        
        console.log(`[COMPANY CONFIG] 🚀 Company ${companyId} is now LIVE!`);
        
        res.json({
            success: true,
            isLive: true,
            goLiveAt: company.configuration.readiness.goLiveAt,
            score: report.score
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error going live:', error);
        res.status(500).json({ error: 'Failed to go live' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/analytics
 * Load analytics data
 * ============================================================================
 */
router.get('/:companyId/configuration/analytics', async (req, res) => {
    console.log(`[COMPANY CONFIG] GET /configuration/analytics for company: ${req.params.companyId}`);
    
    try {
        // Placeholder - will be implemented in Phase 2
        res.json({
            matchRate: 0,
            avgConfidence: 0,
            avgSpeed: 0,
            totalCalls: 0
        });
        
    } catch (error) {
        console.error('[COMPANY CONFIG] Error loading analytics:', error);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Calculate variables status
 */
function calculateVariablesStatus(company) {
    const variables = company.configuration?.variables || {};
    
    // This would normally check against template's availableVariables
    // For now, return a simple status
    const totalKeys = Object.keys(variables).length;
    const configuredKeys = Object.values(variables).filter(v => v && v.trim() !== '').length;
    
    return {
        required: totalKeys,
        configured: configuredKeys,
        missing: [],
        isValid: totalKeys > 0 && configuredKeys === totalKeys
    };
}

module.exports = router;


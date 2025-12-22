/**
 * ============================================================================
 * SCOPE OVERRIDES API - Clone GLOBAL to COMPANY
 * ============================================================================
 * 
 * Endpoints for cloning GLOBAL categories/scenarios to editable COMPANY overrides.
 * This is the ONLY way to modify GLOBAL content in company context.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const {
    assertWriteAllowed,
    cloneCategoryToCompany,
    cloneScenarioToCompany,
    getScopeDisplayInfo,
    isLockedForCompany
} = require('../../middleware/scopeGuard');

/**
 * POST /api/company/:companyId/categories/:templateId/:categoryId/clone
 * Clone a GLOBAL category to COMPANY scope
 */
router.post('/categories/:templateId/:categoryId/clone', async (req, res) => {
    try {
        const { companyId, templateId, categoryId } = req.params;
        const clonedBy = req.user?.email || req.user?.name || 'api';
        
        console.log(`[SCOPE] Cloning category ${categoryId} from template ${templateId} to company ${companyId}`);
        
        const result = await cloneCategoryToCompany({
            templateId,
            categoryId,
            companyId,
            clonedBy
        });
        
        res.json({
            success: true,
            message: 'Category cloned to company override successfully',
            data: {
                originalCategoryId: categoryId,
                newCategoryId: result.newCategoryId,
                scenariosCloned: result.scenarioCount,
                clonedAt: result.clonedAt,
                scope: 'COMPANY',
                ownerCompanyId: companyId
            },
            hint: 'The new category is now editable. Use the newCategoryId for updates.'
        });
        
    } catch (error) {
        console.error('[SCOPE] Clone category error:', error);
        res.status(400).json({
            success: false,
            error: error.message,
            errorCode: 'CLONE_FAILED'
        });
    }
});

/**
 * POST /api/company/:companyId/scenarios/:templateId/:categoryId/:scenarioId/clone
 * Clone a GLOBAL scenario to COMPANY scope
 */
router.post('/scenarios/:templateId/:categoryId/:scenarioId/clone', async (req, res) => {
    try {
        const { companyId, templateId, categoryId, scenarioId } = req.params;
        const clonedBy = req.user?.email || req.user?.name || 'api';
        
        console.log(`[SCOPE] Cloning scenario ${scenarioId} from category ${categoryId} to company ${companyId}`);
        
        const result = await cloneScenarioToCompany({
            templateId,
            categoryId,
            scenarioId,
            companyId,
            clonedBy
        });
        
        res.json({
            success: true,
            message: 'Scenario cloned to company override successfully',
            data: {
                originalScenarioId: scenarioId,
                newScenarioId: result.newScenarioId,
                clonedAt: result.clonedAt,
                scope: 'COMPANY',
                ownerCompanyId: companyId
            },
            hint: 'The new scenario is now editable. Use the newScenarioId for updates.'
        });
        
    } catch (error) {
        console.error('[SCOPE] Clone scenario error:', error);
        res.status(400).json({
            success: false,
            error: error.message,
            errorCode: 'CLONE_FAILED'
        });
    }
});

/**
 * GET /api/company/:companyId/scope-status
 * Get scope status for all categories/scenarios visible to company
 */
router.get('/scope-status', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get all published templates
        const templates = await GlobalInstantResponseTemplate.find({ isPublished: true });
        
        const scopeReport = {
            companyId,
            generatedAt: new Date().toISOString(),
            summary: {
                globalCategoriesCount: 0,
                companyOverrideCategoriesCount: 0,
                globalScenariosCount: 0,
                companyOverrideScenariosCount: 0,
                lockedCategoriesCount: 0,
                lockedScenariosCount: 0
            },
            categories: [],
            templates: []
        };
        
        for (const template of templates) {
            const templateInfo = {
                templateId: template._id.toString(),
                templateName: template.name,
                categories: []
            };
            
            for (const category of template.categories || []) {
                const categoryScope = getScopeDisplayInfo(category, companyId);
                const isLocked = isLockedForCompany(category, companyId);
                
                // Update summary
                if (category.scope === 'COMPANY') {
                    scopeReport.summary.companyOverrideCategoriesCount++;
                } else {
                    scopeReport.summary.globalCategoriesCount++;
                }
                
                if (isLocked) {
                    scopeReport.summary.lockedCategoriesCount++;
                }
                
                const categoryInfo = {
                    categoryId: category.id,
                    categoryName: category.name,
                    ...categoryScope,
                    scenarios: []
                };
                
                for (const scenario of category.scenarios || []) {
                    const scenarioScope = getScopeDisplayInfo(scenario, companyId);
                    const scenarioLocked = isLockedForCompany(scenario, companyId);
                    
                    // Update summary
                    if (scenario.scope === 'COMPANY') {
                        scopeReport.summary.companyOverrideScenariosCount++;
                    } else {
                        scopeReport.summary.globalScenariosCount++;
                    }
                    
                    if (scenarioLocked) {
                        scopeReport.summary.lockedScenariosCount++;
                    }
                    
                    categoryInfo.scenarios.push({
                        scenarioId: scenario.scenarioId,
                        scenarioName: scenario.name,
                        ...scenarioScope
                    });
                }
                
                templateInfo.categories.push(categoryInfo);
                scopeReport.categories.push(categoryInfo);
            }
            
            scopeReport.templates.push(templateInfo);
        }
        
        res.json({
            success: true,
            data: scopeReport
        });
        
    } catch (error) {
        console.error('[SCOPE] Scope status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/overrides
 * List all company overrides
 */
router.get('/overrides', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const templates = await GlobalInstantResponseTemplate.find({ isPublished: true });
        
        const overrides = {
            categories: [],
            scenarios: []
        };
        
        for (const template of templates) {
            for (const category of template.categories || []) {
                if (category.scope === 'COMPANY' && 
                    category.ownerCompanyId?.toString() === companyId) {
                    overrides.categories.push({
                        templateId: template._id.toString(),
                        categoryId: category.id,
                        categoryName: category.name,
                        overridesGlobalCategoryId: category.overridesGlobalCategoryId,
                        createdFromCloneAt: category.createdFromCloneAt,
                        createdFromCloneBy: category.createdFromCloneBy,
                        scenarioCount: category.scenarios?.length || 0
                    });
                }
                
                // Also check individual scenario overrides
                for (const scenario of category.scenarios || []) {
                    if (scenario.scope === 'COMPANY' && 
                        scenario.ownerCompanyId?.toString() === companyId) {
                        // Only add if not part of a category override
                        const categoryIsOverride = category.scope === 'COMPANY' && 
                            category.ownerCompanyId?.toString() === companyId;
                        
                        if (!categoryIsOverride) {
                            overrides.scenarios.push({
                                templateId: template._id.toString(),
                                categoryId: category.id,
                                scenarioId: scenario.scenarioId,
                                scenarioName: scenario.name,
                                overridesGlobalScenarioId: scenario.overridesGlobalScenarioId,
                                createdFromCloneAt: scenario.createdFromCloneAt,
                                createdFromCloneBy: scenario.createdFromCloneBy
                            });
                        }
                    }
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                companyId,
                totalCategoryOverrides: overrides.categories.length,
                totalScenarioOverrides: overrides.scenarios.length,
                ...overrides
            }
        });
        
    } catch (error) {
        console.error('[SCOPE] List overrides error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/company/:companyId/overrides/category/:categoryId
 * Delete a company override (reverts to GLOBAL)
 */
router.delete('/overrides/category/:categoryId', async (req, res) => {
    try {
        const { companyId, categoryId } = req.params;
        
        const templates = await GlobalInstantResponseTemplate.find({ isPublished: true });
        
        let deleted = false;
        
        for (const template of templates) {
            const categoryIndex = template.categories.findIndex(c => 
                c.id === categoryId && 
                c.scope === 'COMPANY' && 
                c.ownerCompanyId?.toString() === companyId
            );
            
            if (categoryIndex !== -1) {
                template.categories.splice(categoryIndex, 1);
                await template.save();
                deleted = true;
                break;
            }
        }
        
        if (deleted) {
            res.json({
                success: true,
                message: 'Company override deleted. Company will now use GLOBAL category.'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Company override not found'
            });
        }
        
    } catch (error) {
        console.error('[SCOPE] Delete override error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


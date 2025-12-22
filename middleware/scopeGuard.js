/**
 * ============================================================================
 * SCOPE GUARD MIDDLEWARE - GLOBAL vs COMPANY PROTECTION
 * ============================================================================
 * 
 * Prevents multi-tenant contamination by blocking writes to GLOBAL content
 * when accessed from company context. Requires clone-to-override flow.
 * 
 * HARD ENFORCEMENT - Cannot be bypassed via UI/devtools
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

/**
 * Main guard function - used by ALL write routes
 * 
 * @param {Object} options
 * @param {string} options.companyId - Company context (null for global admin routes)
 * @param {string} options.userRole - User's role (admin, superadmin, etc.)
 * @param {string} options.docScope - Document's scope field (GLOBAL or COMPANY)
 * @param {ObjectId} options.docOwnerCompanyId - Document's owner company
 * @param {boolean} options.isGlobalAdminOverride - Explicit admin override flag
 * @param {string} options.lockMode - HARD or SOFT (default HARD)
 * @returns {Object} { allowed: boolean, reason: string }
 */
function assertWriteAllowed({
    companyId,
    userRole,
    docScope,
    docOwnerCompanyId,
    isGlobalAdminOverride = false,
    lockMode = 'HARD'
}) {
    // Default scope for legacy docs without scope field
    const effectiveScope = docScope || 'GLOBAL';
    const effectiveLockMode = lockMode || 'HARD';
    
    // =====================================================
    // RULE 1: GLOBAL content cannot be edited in company context
    // =====================================================
    if (effectiveScope === 'GLOBAL' && companyId) {
        // Check for superadmin override
        if (userRole === 'superadmin' && isGlobalAdminOverride === true) {
            return {
                allowed: true,
                reason: 'Superadmin override allowed',
                warning: 'GLOBAL content modified with admin override'
            };
        }
        
        // SOFT mode: allow with warning
        if (effectiveLockMode === 'SOFT') {
            return {
                allowed: true,
                reason: 'SOFT lock - write allowed with warning',
                warning: 'Writing to GLOBAL content from company context (SOFT mode)'
            };
        }
        
        // HARD mode: block
        return {
            allowed: false,
            reason: 'GLOBAL content cannot be edited in company context. Clone to Company Override to edit safely.',
            errorCode: 'SCOPE_LOCK_GLOBAL_IN_COMPANY'
        };
    }
    
    // =====================================================
    // RULE 2: COMPANY content can only be edited by owner
    // =====================================================
    if (effectiveScope === 'COMPANY' && docOwnerCompanyId) {
        const ownerIdStr = docOwnerCompanyId.toString();
        const companyIdStr = companyId ? companyId.toString() : null;
        
        if (companyIdStr && ownerIdStr !== companyIdStr) {
            return {
                allowed: false,
                reason: 'This company override belongs to a different company.',
                errorCode: 'SCOPE_LOCK_WRONG_COMPANY'
            };
        }
    }
    
    // =====================================================
    // RULE 3: Global admin routes (no companyId) can edit GLOBAL
    // =====================================================
    if (effectiveScope === 'GLOBAL' && !companyId) {
        return {
            allowed: true,
            reason: 'Global admin route - GLOBAL edit allowed'
        };
    }
    
    // =====================================================
    // DEFAULT: Allow
    // =====================================================
    return {
        allowed: true,
        reason: 'Write allowed'
    };
}

/**
 * Express middleware version - attach to routes
 */
function scopeGuardMiddleware(options = {}) {
    return async (req, res, next) => {
        try {
            // Extract context
            const companyId = req.params.companyId || req.body.companyId || req.query.companyId;
            const userRole = req.user?.role || 'user';
            const isGlobalAdminOverride = req.body.adminOverride === true || req.query.adminOverride === 'true';
            
            // Document scope should be set by the route handler
            // This middleware validates after document is fetched
            if (req.scopeCheckDoc) {
                const doc = req.scopeCheckDoc;
                const result = assertWriteAllowed({
                    companyId,
                    userRole,
                    docScope: doc.scope,
                    docOwnerCompanyId: doc.ownerCompanyId,
                    isGlobalAdminOverride,
                    lockMode: doc.lockMode
                });
                
                if (!result.allowed) {
                    return res.status(403).json({
                        success: false,
                        error: result.reason,
                        errorCode: result.errorCode,
                        scopeLockViolation: true,
                        hint: 'Use POST /api/company/:companyId/categories/:categoryId/clone to create an editable override'
                    });
                }
                
                // Attach warning if any
                if (result.warning) {
                    req.scopeWarning = result.warning;
                }
            }
            
            next();
        } catch (error) {
            console.error('[SCOPE GUARD] Error:', error);
            next(error);
        }
    };
}

/**
 * Helper: Check if document is locked for company context
 */
function isLockedForCompany(doc, companyId) {
    if (!doc) return false;
    
    const scope = doc.scope || 'GLOBAL';
    const lockMode = doc.lockMode || 'HARD';
    
    // GLOBAL + company context + HARD lock = locked
    if (scope === 'GLOBAL' && companyId && lockMode === 'HARD') {
        return true;
    }
    
    // COMPANY + different owner = locked
    if (scope === 'COMPANY' && doc.ownerCompanyId) {
        const ownerIdStr = doc.ownerCompanyId.toString();
        const companyIdStr = companyId ? companyId.toString() : null;
        if (companyIdStr && ownerIdStr !== companyIdStr) {
            return true;
        }
    }
    
    return false;
}

/**
 * Helper: Get scope display info for UI
 */
function getScopeDisplayInfo(doc, companyId) {
    const scope = doc?.scope || 'GLOBAL';
    const ownerCompanyId = doc?.ownerCompanyId;
    const lockMode = doc?.lockMode || 'HARD';
    
    const isLocked = isLockedForCompany(doc, companyId);
    const isOverride = scope === 'COMPANY' && ownerCompanyId;
    
    return {
        scope,
        ownerCompanyId: ownerCompanyId?.toString() || null,
        lockMode,
        isLocked,
        isOverride,
        displayLabel: scope === 'GLOBAL' ? '🌐 GLOBAL (Shared)' : '🏢 COMPANY (Override)',
        canEdit: !isLocked,
        requiresClone: scope === 'GLOBAL' && companyId && lockMode === 'HARD',
        overridesGlobalCategoryId: doc?.overridesGlobalCategoryId || null,
        overridesGlobalScenarioId: doc?.overridesGlobalScenarioId || null
    };
}

/**
 * Clone a category to company scope
 */
async function cloneCategoryToCompany({
    templateId,
    categoryId,
    companyId,
    clonedBy = 'system'
}) {
    const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
    
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    const category = template.categories.find(c => c.id === categoryId);
    if (!category) {
        throw new Error('Category not found');
    }
    
    // Check if it's already a COMPANY override
    if (category.scope === 'COMPANY') {
        throw new Error('Category is already a company override');
    }
    
    // Create cloned category
    const clonedCategory = JSON.parse(JSON.stringify(category));
    const now = new Date();
    
    // Update category scope fields
    clonedCategory.id = `${categoryId}_company_${companyId}`;
    clonedCategory.scope = 'COMPANY';
    clonedCategory.ownerCompanyId = new mongoose.Types.ObjectId(companyId);
    clonedCategory.lockMode = 'HARD';
    clonedCategory.editPolicy = {
        allowEditsInCompanyUI: true,
        allowEditsInGlobalUI: false,
        requireCloneToEdit: false
    };
    clonedCategory.sourceTemplateId = template._id;
    clonedCategory.sourceCategoryId = categoryId;
    clonedCategory.overridesGlobalCategoryId = categoryId;
    clonedCategory.createdFromCloneAt = now;
    clonedCategory.createdFromCloneBy = clonedBy;
    
    // Update all scenarios in category
    clonedCategory.scenarios = clonedCategory.scenarios.map(scenario => ({
        ...scenario,
        scenarioId: `${scenario.scenarioId}_company_${companyId}`,
        scope: 'COMPANY',
        ownerCompanyId: new mongoose.Types.ObjectId(companyId),
        lockMode: 'HARD',
        editPolicy: {
            allowEditsInCompanyUI: true,
            allowEditsInGlobalUI: false,
            requireCloneToEdit: false
        },
        sourceTemplateId: template._id,
        sourceScenarioId: scenario.scenarioId,
        overridesGlobalScenarioId: scenario.scenarioId,
        createdFromCloneAt: now,
        createdFromCloneBy: clonedBy
    }));
    
    // Add to template (or store in separate collection)
    template.categories.push(clonedCategory);
    await template.save();
    
    return {
        newCategoryId: clonedCategory.id,
        scenarioCount: clonedCategory.scenarios.length,
        clonedAt: now
    };
}

/**
 * Clone a single scenario to company scope
 */
async function cloneScenarioToCompany({
    templateId,
    categoryId,
    scenarioId,
    companyId,
    clonedBy = 'system'
}) {
    const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
    
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    const category = template.categories.find(c => c.id === categoryId);
    if (!category) {
        throw new Error('Category not found');
    }
    
    const scenario = category.scenarios.find(s => s.scenarioId === scenarioId);
    if (!scenario) {
        throw new Error('Scenario not found');
    }
    
    // Check if it's already a COMPANY override
    if (scenario.scope === 'COMPANY') {
        throw new Error('Scenario is already a company override');
    }
    
    // Create cloned scenario
    const clonedScenario = JSON.parse(JSON.stringify(scenario));
    const now = new Date();
    
    clonedScenario.scenarioId = `${scenarioId}_company_${companyId}`;
    clonedScenario.scope = 'COMPANY';
    clonedScenario.ownerCompanyId = new mongoose.Types.ObjectId(companyId);
    clonedScenario.lockMode = 'HARD';
    clonedScenario.editPolicy = {
        allowEditsInCompanyUI: true,
        allowEditsInGlobalUI: false,
        requireCloneToEdit: false
    };
    clonedScenario.sourceTemplateId = template._id;
    clonedScenario.sourceScenarioId = scenarioId;
    clonedScenario.overridesGlobalScenarioId = scenarioId;
    clonedScenario.createdFromCloneAt = now;
    clonedScenario.createdFromCloneBy = clonedBy;
    
    // Add to category
    category.scenarios.push(clonedScenario);
    await template.save();
    
    return {
        newScenarioId: clonedScenario.scenarioId,
        clonedAt: now
    };
}

module.exports = {
    assertWriteAllowed,
    scopeGuardMiddleware,
    isLockedForCompany,
    getScopeDisplayInfo,
    cloneCategoryToCompany,
    cloneScenarioToCompany
};


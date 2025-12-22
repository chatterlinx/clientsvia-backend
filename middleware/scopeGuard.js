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
 * ENTERPRISE FEATURES:
 * - Audit logging for all blocked attempts
 * - Edit context tracking
 * - Contamination detection support
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG - Track all scope guard events
// ═══════════════════════════════════════════════════════════════════════════
const scopeAuditLog = [];
const MAX_AUDIT_LOG_SIZE = 1000;

/**
 * Log a scope guard event for audit trail
 */
function logScopeEvent(event) {
    const entry = {
        timestamp: new Date().toISOString(),
        ...event
    };
    
    // Console log for immediate visibility
    if (event.blocked) {
        logger.warn(`🛡️ [SCOPE GUARD] BLOCKED: ${event.reason}`, {
            companyId: event.companyId,
            docType: event.docType,
            docId: event.docId,
            attemptedBy: event.attemptedBy,
            errorCode: event.errorCode
        });
    } else if (event.warning) {
        logger.info(`⚠️ [SCOPE GUARD] WARNING: ${event.warning}`, {
            companyId: event.companyId,
            docType: event.docType
        });
    }
    
    // Add to in-memory audit log (capped)
    scopeAuditLog.unshift(entry);
    if (scopeAuditLog.length > MAX_AUDIT_LOG_SIZE) {
        scopeAuditLog.pop();
    }
    
    return entry;
}

/**
 * Get recent scope audit events
 */
function getScopeAuditLog(limit = 100) {
    return scopeAuditLog.slice(0, limit);
}

/**
 * Get blocked attempts count
 */
function getBlockedAttemptsCount() {
    return scopeAuditLog.filter(e => e.blocked).length;
}

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
 * @param {string} options.docType - Type of document (category, scenario)
 * @param {string} options.docId - Document identifier
 * @param {string} options.attemptedBy - User attempting the write
 * @param {string} options.editContext - Where edit originated from
 * @returns {Object} { allowed: boolean, reason: string, auditEntry?: object }
 */
function assertWriteAllowed({
    companyId,
    userRole,
    docScope,
    docOwnerCompanyId,
    isGlobalAdminOverride = false,
    lockMode = 'HARD',
    docType = 'unknown',
    docId = null,
    attemptedBy = null,
    editContext = null
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
            const auditEntry = logScopeEvent({
                action: 'SUPERADMIN_OVERRIDE',
                allowed: true,
                warning: 'GLOBAL content modified with superadmin override',
                companyId,
                docType,
                docId,
                attemptedBy,
                editContext
            });
            
            return {
                allowed: true,
                reason: 'Superadmin override allowed',
                warning: 'GLOBAL content modified with admin override',
                auditEntry
            };
        }
        
        // SOFT mode: allow with warning
        if (effectiveLockMode === 'SOFT') {
            const auditEntry = logScopeEvent({
                action: 'SOFT_LOCK_ALLOWED',
                allowed: true,
                warning: 'Writing to GLOBAL content from company context (SOFT mode)',
                companyId,
                docType,
                docId,
                attemptedBy,
                editContext
            });
            
            return {
                allowed: true,
                reason: 'SOFT lock - write allowed with warning',
                warning: 'Writing to GLOBAL content from company context (SOFT mode)',
                auditEntry
            };
        }
        
        // HARD mode: block
        const auditEntry = logScopeEvent({
            action: 'BLOCKED',
            blocked: true,
            reason: 'GLOBAL content cannot be edited in company context',
            errorCode: 'SCOPE_LOCK_GLOBAL_IN_COMPANY',
            lockReason: 'GLOBAL_SHARED_MULTI_TENANT',
            companyId,
            docType,
            docId,
            attemptedBy,
            editContext
        });
        
        return {
            allowed: false,
            reason: 'GLOBAL content cannot be edited in company context. Clone to Company Override to edit safely.',
            errorCode: 'SCOPE_LOCK_GLOBAL_IN_COMPANY',
            lockReason: 'GLOBAL_SHARED_MULTI_TENANT',
            auditEntry
        };
    }
    
    // =====================================================
    // RULE 2: COMPANY content can only be edited by owner
    // =====================================================
    if (effectiveScope === 'COMPANY' && docOwnerCompanyId) {
        const ownerIdStr = docOwnerCompanyId.toString();
        const companyIdStr = companyId ? companyId.toString() : null;
        
        if (companyIdStr && ownerIdStr !== companyIdStr) {
            const auditEntry = logScopeEvent({
                action: 'BLOCKED',
                blocked: true,
                reason: 'Company override belongs to different company',
                errorCode: 'SCOPE_LOCK_WRONG_COMPANY',
                lockReason: 'COMPANY_OWNED',
                companyId,
                ownerCompanyId: ownerIdStr,
                docType,
                docId,
                attemptedBy,
                editContext
            });
            
            return {
                allowed: false,
                reason: 'This company override belongs to a different company.',
                errorCode: 'SCOPE_LOCK_WRONG_COMPANY',
                lockReason: 'COMPANY_OWNED',
                auditEntry
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
 * Deep clone helper that preserves all nested objects
 * Uses Mongoose's toObject() for proper serialization
 */
function deepCloneDocument(doc) {
    if (!doc) return null;
    
    // If it's a Mongoose document, convert to plain object first
    const plainObj = doc.toObject ? doc.toObject() : doc;
    
    // Deep clone while preserving types
    return JSON.parse(JSON.stringify(plainObj, (key, value) => {
        // Handle special types if needed
        if (value instanceof Date) {
            return { __type: 'Date', value: value.toISOString() };
        }
        return value;
    }), (key, value) => {
        // Restore special types
        if (value && value.__type === 'Date') {
            return new Date(value.value);
        }
        return value;
    });
}

/**
 * Clone a category to company scope
 * IMPORTANT: This performs a FULL DEEP CLONE of all 30+ scenario fields
 * Including: triggers, regexTriggers, negativeTriggers, keywords, negativeKeywords,
 * replySelection, minConfidence, cooldownSeconds, entityCapture, entityValidation,
 * actionHooks, timedFollowUp, silencePolicy, followUpMode, transferTarget, etc.
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FULL DEEP CLONE - Preserves ALL fields including:
    // - triggers, regexTriggers, negativeTriggers
    // - keywords, negativeKeywords
    // - replySelection, minConfidence, cooldownSeconds
    // - entityCapture, entityValidation, actionHooks
    // - timedFollowUp, silencePolicy
    // - followUpMode, transferTarget
    // - notes, scenarioType, replyStrategy
    // - quickReplies, fullReplies (with all variants)
    // - ttsOverride, voiceSettings
    // - contextFields, entityCapture
    // - AND ALL OTHER 30+ FIELDS
    // ═══════════════════════════════════════════════════════════════════════
    const clonedCategory = deepCloneDocument(category);
    const now = new Date();
    
    // Update category scope fields (OVERRIDE, not replace)
    clonedCategory.id = `${categoryId}_company_${companyId}`;
    clonedCategory.scope = 'COMPANY';
    clonedCategory.ownerCompanyId = new mongoose.Types.ObjectId(companyId);
    clonedCategory.lockMode = 'HARD';
    clonedCategory.lockReason = 'COMPANY_OWNED';
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
    clonedCategory.editContext = 'COMPANY_PROFILE';
    clonedCategory.lastEditedAt = now;
    clonedCategory.lastEditedBy = clonedBy;
    clonedCategory.lastEditedFromContext = 'COMPANY_PROFILE';
    
    // Count cloned fields for audit
    const originalFieldCount = Object.keys(category.toObject ? category.toObject() : category).length;
    
    // Update all scenarios in category (FULL DEEP CLONE)
    clonedCategory.scenarios = (clonedCategory.scenarios || []).map(scenario => {
        const originalScenarioId = scenario.scenarioId;
        
        // Scenario already deep-cloned, just update scope fields
        return {
            ...scenario,
            scenarioId: `${originalScenarioId}_company_${companyId}`,
            scope: 'COMPANY',
            ownerCompanyId: new mongoose.Types.ObjectId(companyId),
            lockMode: 'HARD',
            lockReason: 'COMPANY_OWNED',
            editPolicy: {
                allowEditsInCompanyUI: true,
                allowEditsInGlobalUI: false,
                requireCloneToEdit: false
            },
            sourceTemplateId: template._id,
            sourceScenarioId: originalScenarioId,
            overridesGlobalScenarioId: originalScenarioId,
            createdFromCloneAt: now,
            createdFromCloneBy: clonedBy,
            editContext: 'COMPANY_PROFILE',
            lastEditedAt: now,
            lastEditedBy: clonedBy,
            lastEditedFromContext: 'COMPANY_PROFILE'
        };
    });
    
    // Add to template
    template.categories.push(clonedCategory);
    await template.save();
    
    // Audit log
    logScopeEvent({
        action: 'CLONE_CATEGORY',
        allowed: true,
        companyId,
        docType: 'category',
        docId: categoryId,
        newDocId: clonedCategory.id,
        attemptedBy: clonedBy,
        editContext: 'COMPANY_PROFILE',
        scenariosCloned: clonedCategory.scenarios.length,
        fieldsPreserved: originalFieldCount
    });
    
    return {
        newCategoryId: clonedCategory.id,
        scenarioCount: clonedCategory.scenarios.length,
        clonedAt: now,
        fieldsPreserved: originalFieldCount
    };
}

/**
 * Clone a single scenario to company scope
 * FULL DEEP CLONE of all 30+ scenario fields
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
    
    // ═══════════════════════════════════════════════════════════════════════
    // FULL DEEP CLONE - ALL 30+ SCENARIO FIELDS
    // ═══════════════════════════════════════════════════════════════════════
    const clonedScenario = deepCloneDocument(scenario);
    const now = new Date();
    
    // Count original fields for audit
    const originalFieldCount = Object.keys(scenario.toObject ? scenario.toObject() : scenario).length;
    
    // Update scope fields (OVERRIDE existing, preserve all other fields)
    clonedScenario.scenarioId = `${scenarioId}_company_${companyId}`;
    clonedScenario.scope = 'COMPANY';
    clonedScenario.ownerCompanyId = new mongoose.Types.ObjectId(companyId);
    clonedScenario.lockMode = 'HARD';
    clonedScenario.lockReason = 'COMPANY_OWNED';
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
    clonedScenario.editContext = 'COMPANY_PROFILE';
    clonedScenario.lastEditedAt = now;
    clonedScenario.lastEditedBy = clonedBy;
    clonedScenario.lastEditedFromContext = 'COMPANY_PROFILE';
    
    // Add to category
    category.scenarios.push(clonedScenario);
    await template.save();
    
    // Audit log
    logScopeEvent({
        action: 'CLONE_SCENARIO',
        allowed: true,
        companyId,
        docType: 'scenario',
        docId: scenarioId,
        newDocId: clonedScenario.scenarioId,
        attemptedBy: clonedBy,
        editContext: 'COMPANY_PROFILE',
        fieldsPreserved: originalFieldCount
    });
    
    return {
        newScenarioId: clonedScenario.scenarioId,
        clonedAt: now,
        fieldsPreserved: originalFieldCount
    };
}

/**
 * Get resolution order for scenario matching
 * COMPANY overrides ALWAYS win over GLOBAL
 */
function getResolutionOrder() {
    return ['COMPANY_OVERRIDE', 'GLOBAL'];
}

/**
 * Find effective scenario (COMPANY override takes precedence)
 * @param {Array} scenarios - All scenarios (both GLOBAL and COMPANY)
 * @param {String} companyId - Company ID to match overrides
 * @returns {Map} Map of globalScenarioId → effectiveScenario
 */
function resolveEffectiveScenarios(scenarios, companyId) {
    const effectiveMap = new Map();
    const companyIdStr = companyId?.toString();
    
    // First pass: collect GLOBAL scenarios
    for (const scenario of scenarios) {
        const scope = scenario.scope || 'GLOBAL';
        if (scope === 'GLOBAL') {
            effectiveMap.set(scenario.scenarioId, {
                scenario,
                source: 'GLOBAL',
                overriddenBy: null
            });
        }
    }
    
    // Second pass: COMPANY overrides replace GLOBAL
    for (const scenario of scenarios) {
        const scope = scenario.scope || 'GLOBAL';
        const ownerCompanyId = scenario.ownerCompanyId?.toString();
        const overridesGlobalId = scenario.overridesGlobalScenarioId;
        
        if (scope === 'COMPANY' && ownerCompanyId === companyIdStr) {
            if (overridesGlobalId && effectiveMap.has(overridesGlobalId)) {
                // Replace GLOBAL with COMPANY override
                effectiveMap.set(overridesGlobalId, {
                    scenario,
                    source: 'COMPANY_OVERRIDE',
                    overrides: overridesGlobalId
                });
            } else {
                // Company-only scenario (no GLOBAL equivalent)
                effectiveMap.set(scenario.scenarioId, {
                    scenario,
                    source: 'COMPANY_ONLY',
                    overriddenBy: null
                });
            }
        }
    }
    
    return effectiveMap;
}

module.exports = {
    assertWriteAllowed,
    scopeGuardMiddleware,
    isLockedForCompany,
    getScopeDisplayInfo,
    cloneCategoryToCompany,
    cloneScenarioToCompany,
    // Enterprise audit
    logScopeEvent,
    getScopeAuditLog,
    getBlockedAttemptsCount,
    // Resolution order
    getResolutionOrder,
    resolveEffectiveScenarios,
    // Helper
    deepCloneDocument
};


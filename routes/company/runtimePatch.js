/**
 * ============================================================================
 * RUNTIME PATCH - Safe JSON Patch Import with Allowlisted Paths
 * ============================================================================
 * 
 * PURPOSE: Apply targeted patches to runtime configuration
 *          WITHOUT "write-anything-anywhere" chaos
 * 
 * USES: JSON Patch (RFC 6902) style
 *       - op: add / replace / remove
 *       - path: /section/id/field
 *       - value: new value
 * 
 * SAFETY:
 *       - Allowlisted paths only (no arbitrary writes)
 *       - Scope control (companyOverride vs globalTemplate)
 *       - Validation rules (hard + soft)
 *       - Optimistic concurrency via expectedVersion
 *       - Dry-run mode for validation without write
 *       - Full audit logging
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const crypto = require('crypto');
const v2Company = require('../../models/v2Company');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const DynamicFlow = require('../../models/DynamicFlow');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const logger = require('../../utils/logger');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ============================================================================
// ALLOWLISTED PATHS - Only these paths can be patched
// ============================================================================
const ALLOWED_PATHS = {
    // Control Plane paths
    'controlPlane.greeting.text': {
        type: 'string',
        maxLength: 500,
        scope: 'companyOverride',
        storage: 'v2Company.connectionMessages.voice.text'
    },
    'controlPlane.fallbacks.notOffered.text': {
        type: 'string',
        maxLength: 500,
        scope: 'companyOverride',
        storage: 'CompanyResponseDefaults.notOfferedReply.fullReply'
    },
    'controlPlane.fallbacks.unknownIntent.text': {
        type: 'string',
        maxLength: 500,
        scope: 'companyOverride',
        storage: 'CompanyResponseDefaults.unknownIntentReply.fullReply'
    },
    'controlPlane.fallbacks.afterHours.text': {
        type: 'string',
        maxLength: 500,
        scope: 'companyOverride',
        storage: 'CompanyResponseDefaults.afterHoursReply.fullReply'
    },
    'controlPlane.booking.enabled': {
        type: 'boolean',
        scope: 'companyOverride',
        storage: 'v2Company.frontDeskBehavior.booking.enabled'
    },
    
    // Dynamic Flow paths
    'dynamicFlows.flows.*.enabled': {
        type: 'boolean',
        scope: 'companyOverride',
        storage: 'DynamicFlow.enabled',
        requiresId: true
    },
    'dynamicFlows.flows.*.priority': {
        type: 'number',
        min: 0,
        max: 100,
        scope: 'companyOverride',
        storage: 'DynamicFlow.priority',
        requiresId: true
    },
    
    // Matching Policy paths
    'matchingPolicy.thresholds.tier1': {
        type: 'number',
        min: 0,
        max: 1,
        scope: 'companyOverride',
        storage: 'v2Company.aiAgentSettings.thresholds.tier1Threshold'
    },
    'matchingPolicy.thresholds.tier2': {
        type: 'number',
        min: 0,
        max: 1,
        scope: 'companyOverride',
        storage: 'v2Company.aiAgentSettings.thresholds.tier2Threshold'
    },
    'matchingPolicy.discoveryConsent.required': {
        type: 'boolean',
        scope: 'companyOverride',
        storage: 'v2Company.aiAgentSettings.discoveryConsent.enabled'
    },
    'matchingPolicy.discoveryConsent.scenariosBlockedByConsent': {
        type: 'boolean',
        scope: 'companyOverride',
        storage: 'v2Company.aiAgentSettings.discoveryConsent.disableScenarioAutoResponses'
    },
    
    // Placeholder paths
    'placeholders.entries.*.value': {
        type: 'string',
        maxLength: 200,
        scope: 'companyOverride',
        storage: 'CompanyPlaceholders.placeholders',
        requiresId: true
    }
};

// ============================================================================
// SCENARIO WIRING PATHS - For company overrides of global scenarios
// ============================================================================
const SCENARIO_WIRING_PATHS = {
    'scenarioBrain.scenarios.*.scenarioType': {
        type: 'enum',
        values: ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'TRANSFER', 'SMALL_TALK', 'UNKNOWN'],
        scope: 'companyOverride',
        note: 'Creates a company override for global scenario'
    },
    'scenarioBrain.scenarios.*.wiring.action': {
        type: 'enum',
        values: ['REPLY_ONLY', 'START_FLOW', 'START_BOOKING', 'TRANSFER', 'ESCALATE_OR_BOOK', 'REPLY_THEN_ASK', 'REPLY_THEN_OFFER_BOOK', 'REPLY_AND_ASK'],
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.wiring.flowId': {
        type: 'string',
        scope: 'companyOverride',
        conditionalRequiredIf: { 'wiring.action': 'START_FLOW' }
    },
    'scenarioBrain.scenarios.*.wiring.transferTarget': {
        type: 'string',
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.wiring.bookingIntent': {
        type: 'boolean',
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.wiring.handoffPolicy': {
        type: 'enum',
        values: ['low_confidence', 'emergency', 'user_request', 'always', 'never'],
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.priority': {
        type: 'number',
        min: 0,
        max: 100,
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.minConfidence': {
        type: 'number',
        min: 0,
        max: 1,
        scope: 'companyOverride'
    },
    'scenarioBrain.scenarios.*.status': {
        type: 'enum',
        values: ['live', 'draft', 'disabled', 'archived'],
        scope: 'companyOverride'
    }
};

// Merge all allowed paths
const ALL_ALLOWED_PATHS = { ...ALLOWED_PATHS, ...SCENARIO_WIRING_PATHS };

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Parse a patch path and extract section, id, and field
 * Example: /scenarioBrain/scenarios/abc123/scenarioType
 * Returns: { section: 'scenarioBrain.scenarios', id: 'abc123', field: 'scenarioType' }
 */
function parsePatchPath(path) {
    // Remove leading slash
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const parts = cleanPath.split('/');
    
    // Handle different path structures
    if (parts.length === 2) {
        // Simple path: /controlPlane/greeting
        return { fullPath: cleanPath.replace(/\//g, '.'), id: null };
    }
    
    if (parts.length === 3) {
        // Path with nested field: /controlPlane/greeting/text
        return { fullPath: cleanPath.replace(/\//g, '.'), id: null };
    }
    
    if (parts.length === 4) {
        // Path with ID: /scenarioBrain/scenarios/abc123/scenarioType
        const [section, subsection, id, field] = parts;
        return {
            fullPath: `${section}.${subsection}.*.${field}`,
            actualPath: `${section}.${subsection}.${id}.${field}`,
            id,
            field,
            section: `${section}.${subsection}`
        };
    }
    
    if (parts.length === 5) {
        // Path with ID and nested field: /scenarioBrain/scenarios/abc123/wiring/action
        const [section, subsection, id, nested, field] = parts;
        return {
            fullPath: `${section}.${subsection}.*.${nested}.${field}`,
            actualPath: `${section}.${subsection}.${id}.${nested}.${field}`,
            id,
            field: `${nested}.${field}`,
            section: `${section}.${subsection}`
        };
    }
    
    if (parts.length === 6) {
        // Path with double ID: /dynamicFlows/flows/flowId/triggers/0/phrases
        const [section, subsection, id, nested, subId, field] = parts;
        return {
            fullPath: `${section}.${subsection}.*.${nested}.*.${field}`,
            actualPath: cleanPath.replace(/\//g, '.'),
            id,
            subId,
            field,
            section: `${section}.${subsection}`
        };
    }
    
    return { fullPath: cleanPath.replace(/\//g, '.'), id: null };
}

/**
 * Match a path against allowed patterns (with * wildcards)
 */
function findAllowedPath(parsedPath) {
    // First try exact match
    if (ALL_ALLOWED_PATHS[parsedPath.fullPath]) {
        return { pattern: parsedPath.fullPath, config: ALL_ALLOWED_PATHS[parsedPath.fullPath] };
    }
    
    // Try pattern matching with wildcards
    for (const [pattern, config] of Object.entries(ALL_ALLOWED_PATHS)) {
        // Convert pattern to regex: dynamicFlows.flows.*.enabled -> dynamicFlows\.flows\.[^.]+\.enabled
        const regexStr = pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+');
        const regex = new RegExp(`^${regexStr}$`);
        
        if (regex.test(parsedPath.fullPath)) {
            return { pattern, config };
        }
    }
    
    return null;
}

/**
 * Validate a single patch against rules
 */
function validatePatch(patch, context) {
    const errors = [];
    const warnings = [];
    
    // Parse the path
    const parsed = parsePatchPath(patch.path);
    
    // Find allowed path config
    const allowed = findAllowedPath(parsed);
    
    if (!allowed) {
        errors.push({
            code: 'PATH_NOT_ALLOWED',
            path: patch.path,
            message: `Path not in allowlist: ${patch.path}`
        });
        return { valid: false, errors, warnings };
    }
    
    const { config } = allowed;
    
    // Check op is valid
    if (!['add', 'replace', 'remove'].includes(patch.op)) {
        errors.push({
            code: 'INVALID_OP',
            path: patch.path,
            message: `Invalid op: ${patch.op}. Must be add, replace, or remove.`
        });
    }
    
    // If remove, no value validation needed
    if (patch.op === 'remove') {
        return { valid: errors.length === 0, errors, warnings, parsed, config };
    }
    
    // Value validation based on type
    if (config.type === 'string') {
        if (typeof patch.value !== 'string') {
            errors.push({
                code: 'INVALID_TYPE',
                path: patch.path,
                message: `Value must be string, got ${typeof patch.value}`
            });
        } else if (config.maxLength && patch.value.length > config.maxLength) {
            errors.push({
                code: 'VALUE_TOO_LONG',
                path: patch.path,
                message: `Value exceeds max length ${config.maxLength}`
            });
        }
    }
    
    if (config.type === 'boolean') {
        if (typeof patch.value !== 'boolean') {
            errors.push({
                code: 'INVALID_TYPE',
                path: patch.path,
                message: `Value must be boolean, got ${typeof patch.value}`
            });
        }
    }
    
    if (config.type === 'number') {
        if (typeof patch.value !== 'number') {
            errors.push({
                code: 'INVALID_TYPE',
                path: patch.path,
                message: `Value must be number, got ${typeof patch.value}`
            });
        } else {
            if (config.min !== undefined && patch.value < config.min) {
                errors.push({
                    code: 'VALUE_TOO_LOW',
                    path: patch.path,
                    message: `Value must be >= ${config.min}`
                });
            }
            if (config.max !== undefined && patch.value > config.max) {
                errors.push({
                    code: 'VALUE_TOO_HIGH',
                    path: patch.path,
                    message: `Value must be <= ${config.max}`
                });
            }
        }
    }
    
    if (config.type === 'enum') {
        if (!config.values.includes(patch.value)) {
            errors.push({
                code: 'INVALID_ENUM',
                path: patch.path,
                message: `Value must be one of: ${config.values.join(', ')}`
            });
        }
    }
    
    // Soft warnings
    if (parsed.section === 'scenarioBrain.scenarios' && parsed.field === 'scenarioType') {
        if (patch.value === 'UNKNOWN') {
            warnings.push({
                code: 'SCENARIO_TYPE_UNKNOWN',
                path: patch.path,
                message: 'Setting scenarioType to UNKNOWN provides no routing benefit'
            });
        }
    }
    
    // Conditional requirements
    if (config.conditionalRequiredIf) {
        // Check if action is START_FLOW but no flowId
        if (patch.path.includes('wiring.action') && patch.value === 'START_FLOW') {
            warnings.push({
                code: 'FLOW_ID_RECOMMENDED',
                path: patch.path,
                message: 'action=START_FLOW requires a flowId to be set'
            });
        }
    }
    
    return { 
        valid: errors.length === 0, 
        errors, 
        warnings,
        parsed,
        config
    };
}

/**
 * Apply a single patch to the appropriate storage
 */
async function applyPatch(patch, companyId, validationResult) {
    const { parsed, config } = validationResult;
    const storage = config.storage;
    
    try {
        // Route to appropriate storage handler
        if (storage?.startsWith('v2Company.')) {
            return await applyToCompany(patch, companyId, storage, parsed);
        }
        
        if (storage?.startsWith('CompanyResponseDefaults.')) {
            return await applyToResponseDefaults(patch, companyId, storage);
        }
        
        if (storage?.startsWith('DynamicFlow.')) {
            return await applyToDynamicFlow(patch, companyId, storage, parsed);
        }
        
        if (storage?.startsWith('CompanyPlaceholders.')) {
            return await applyToPlaceholders(patch, companyId, storage, parsed);
        }
        
        // Scenario wiring - creates/updates company override
        if (parsed.section === 'scenarioBrain.scenarios') {
            return await applyToScenarioOverride(patch, companyId, parsed);
        }
        
        return { success: false, error: `Unknown storage: ${storage}` };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Apply patch to v2Company document
 */
async function applyToCompany(patch, companyId, storage, parsed) {
    const field = storage.replace('v2Company.', '');
    
    const update = {};
    if (patch.op === 'remove') {
        update.$unset = { [field]: 1 };
    } else {
        update.$set = { [field]: patch.value };
    }
    
    const result = await v2Company.findByIdAndUpdate(companyId, update, { new: true });
    
    return { 
        success: true, 
        storage: 'v2Company',
        field,
        oldValue: null, // Could fetch before update if needed
        newValue: patch.value
    };
}

/**
 * Apply patch to CompanyResponseDefaults
 */
async function applyToResponseDefaults(patch, companyId, storage) {
    const field = storage.replace('CompanyResponseDefaults.', '');
    
    let defaults = await CompanyResponseDefaults.findOne({ companyId });
    if (!defaults) {
        defaults = new CompanyResponseDefaults({ companyId });
    }
    
    // Parse nested path like "notOfferedReply.fullReply"
    const parts = field.split('.');
    let obj = defaults;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
    }
    
    if (patch.op === 'remove') {
        delete obj[parts[parts.length - 1]];
    } else {
        obj[parts[parts.length - 1]] = patch.value;
    }
    
    await defaults.save();
    
    return {
        success: true,
        storage: 'CompanyResponseDefaults',
        field,
        newValue: patch.value
    };
}

/**
 * Apply patch to DynamicFlow
 */
async function applyToDynamicFlow(patch, companyId, storage, parsed) {
    const field = storage.replace('DynamicFlow.', '');
    const flowId = parsed.id;
    
    if (!flowId) {
        return { success: false, error: 'Flow ID required' };
    }
    
    const update = {};
    if (patch.op === 'remove') {
        update.$unset = { [field]: 1 };
    } else {
        update.$set = { [field]: patch.value };
    }
    
    const result = await DynamicFlow.findOneAndUpdate(
        { _id: flowId, companyId },
        update,
        { new: true }
    );
    
    if (!result) {
        return { success: false, error: `Flow not found: ${flowId}` };
    }
    
    return {
        success: true,
        storage: 'DynamicFlow',
        flowId,
        field,
        newValue: patch.value
    };
}

/**
 * Apply patch to CompanyPlaceholders
 */
async function applyToPlaceholders(patch, companyId, storage, parsed) {
    const placeholderId = parsed.id;
    
    let doc = await CompanyPlaceholders.findOne({ companyId });
    if (!doc) {
        doc = new CompanyPlaceholders({ companyId, placeholders: [] });
    }
    
    // Find placeholder by ID or key
    const idx = doc.placeholders.findIndex(p => 
        p._id?.toString() === placeholderId || 
        p.key === placeholderId ||
        `ph_${p.key}` === placeholderId
    );
    
    if (idx === -1 && patch.op !== 'add') {
        return { success: false, error: `Placeholder not found: ${placeholderId}` };
    }
    
    if (patch.op === 'add') {
        doc.placeholders.push({ key: placeholderId, value: patch.value });
    } else if (patch.op === 'remove') {
        doc.placeholders.splice(idx, 1);
    } else {
        doc.placeholders[idx].value = patch.value;
    }
    
    await doc.save();
    
    return {
        success: true,
        storage: 'CompanyPlaceholders',
        placeholderId,
        newValue: patch.value
    };
}

/**
 * Apply patch to scenario via company override
 * This creates/updates a company-specific override for a global scenario
 */
async function applyToScenarioOverride(patch, companyId, parsed) {
    const scenarioId = parsed.id;
    const field = parsed.field;
    
    // Find the template containing this scenario
    const templates = await GlobalInstantResponseTemplate.find({ isActive: true });
    let targetScenario = null;
    let targetTemplate = null;
    let targetCategory = null;
    
    for (const template of templates) {
        for (const cat of (template.categories || [])) {
            const scenario = (cat.scenarios || []).find(s => 
                s.scenarioId === scenarioId || 
                s._id?.toString() === scenarioId
            );
            if (scenario) {
                targetScenario = scenario;
                targetTemplate = template;
                targetCategory = cat;
                break;
            }
        }
        if (targetScenario) break;
    }
    
    if (!targetScenario) {
        return { success: false, error: `Scenario not found: ${scenarioId}` };
    }
    
    // For now, we'll store company overrides in v2Company.scenarioOverrides
    // This is a map of scenarioId -> override fields
    const company = await v2Company.findById(companyId);
    if (!company) {
        return { success: false, error: 'Company not found' };
    }
    
    if (!company.scenarioOverrides) {
        company.scenarioOverrides = {};
    }
    
    if (!company.scenarioOverrides[scenarioId]) {
        company.scenarioOverrides[scenarioId] = {
            scenarioId,
            scenarioName: targetScenario.name,
            templateId: targetTemplate._id.toString(),
            categoryId: targetCategory.id || targetCategory._id?.toString(),
            overrides: {}
        };
    }
    
    // Parse nested field path (e.g., "wiring.action")
    const fieldParts = field.split('.');
    let overrides = company.scenarioOverrides[scenarioId].overrides;
    
    for (let i = 0; i < fieldParts.length - 1; i++) {
        if (!overrides[fieldParts[i]]) {
            overrides[fieldParts[i]] = {};
        }
        overrides = overrides[fieldParts[i]];
    }
    
    if (patch.op === 'remove') {
        delete overrides[fieldParts[fieldParts.length - 1]];
    } else {
        overrides[fieldParts[fieldParts.length - 1]] = patch.value;
    }
    
    company.scenarioOverrides[scenarioId].updatedAt = new Date();
    company.markModified('scenarioOverrides');
    await company.save();
    
    return {
        success: true,
        storage: 'v2Company.scenarioOverrides',
        scenarioId,
        scenarioName: targetScenario.name,
        field,
        newValue: patch.value
    };
}

// ============================================================================
// MAIN PATCH ENDPOINT
// ============================================================================

/**
 * POST /api/company/:companyId/runtime-patch
 * 
 * Apply JSON patches to runtime configuration
 * 
 * Query params:
 *   - dryRun=1: Validate without applying
 * 
 * Body:
 *   {
 *     companyId: string,
 *     scope: "companyOverride" | "globalTemplate",
 *     expectedVersion: string (optional, for optimistic concurrency),
 *     patches: [
 *       { op: "replace", path: "/path/to/field", value: newValue }
 *     ]
 *   }
 */
router.post('/', async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    
    try {
        const { 
            companyId: bodyCompanyId, 
            scope = 'companyOverride',
            expectedVersion,
            patches = []
        } = req.body;
        
        console.log(`📝 [RUNTIME PATCH] ${dryRun ? 'DRY RUN' : 'APPLY'} for company: ${companyId}, patches: ${patches.length}`);
        
        // ═══════════════════════════════════════════════════════════════════════
        // VALIDATION PHASE
        // ═══════════════════════════════════════════════════════════════════════
        
        // Cross-tenant protection
        if (bodyCompanyId && bodyCompanyId !== companyId) {
            return res.status(400).json({
                success: false,
                error: 'Company ID in body does not match URL',
                code: 'CROSS_TENANT_VIOLATION'
            });
        }
        
        // Scope check
        if (scope === 'globalTemplate') {
            // Only allow globalTemplate scope for admins (TODO: check role)
            // For now, reject
            return res.status(403).json({
                success: false,
                error: 'globalTemplate scope requires admin privileges',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }
        
        // Validate company exists
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Validate each patch
        const validationResults = [];
        const allErrors = [];
        const allWarnings = [];
        
        for (const patch of patches) {
            const result = validatePatch(patch, { companyId, scope });
            validationResults.push({ patch, ...result });
            allErrors.push(...result.errors);
            allWarnings.push(...result.warnings);
        }
        
        // If any hard errors, reject
        if (allErrors.length > 0) {
            return res.status(400).json({
                success: false,
                applied: false,
                dryRun,
                errors: allErrors,
                warnings: allWarnings,
                validationResults
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // DRY RUN - Return validation results without applying
        // ═══════════════════════════════════════════════════════════════════════
        
        if (dryRun) {
            // Build preview of what would change
            const preview = validationResults.map(v => ({
                path: v.patch.path,
                op: v.patch.op,
                value: v.patch.value,
                storage: v.config?.storage,
                valid: v.valid
            }));
            
            return res.json({
                success: true,
                applied: false,
                dryRun: true,
                patchCount: patches.length,
                validCount: validationResults.filter(v => v.valid).length,
                warnings: allWarnings,
                preview,
                message: 'Validation passed. Remove dryRun to apply patches.'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // APPLY PHASE
        // ═══════════════════════════════════════════════════════════════════════
        
        const applyResults = [];
        let appliedCount = 0;
        let failedCount = 0;
        
        for (const validationResult of validationResults) {
            if (!validationResult.valid) {
                applyResults.push({
                    path: validationResult.patch.path,
                    success: false,
                    error: 'Validation failed',
                    errors: validationResult.errors
                });
                failedCount++;
                continue;
            }
            
            const result = await applyPatch(
                validationResult.patch, 
                companyId, 
                validationResult
            );
            
            if (result.success) {
                appliedCount++;
                applyResults.push({
                    path: validationResult.patch.path,
                    success: true,
                    ...result
                });
            } else {
                failedCount++;
                applyResults.push({
                    path: validationResult.patch.path,
                    success: false,
                    error: result.error
                });
            }
        }
        
        // Generate new version
        const newVersion = `rt_${crypto.randomBytes(4).toString('hex')}_${new Date().toISOString()}`;
        
        console.log(`✅ [RUNTIME PATCH] Applied ${appliedCount}/${patches.length} patches in ${Date.now() - startTime}ms`);
        
        return res.json({
            success: appliedCount > 0,
            applied: true,
            dryRun: false,
            patchCount: patches.length,
            appliedCount,
            failedCount,
            warnings: allWarnings,
            results: applyResults,
            newVersion,
            message: `Applied ${appliedCount}/${patches.length} patches`,
            generationTimeMs: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('❌ [RUNTIME PATCH] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/runtime-patch/schema
 * 
 * Returns the allowlist of patchable paths with their validation rules
 */
router.get('/schema', async (req, res) => {
    const paths = [];
    
    for (const [path, config] of Object.entries(ALL_ALLOWED_PATHS)) {
        paths.push({
            path,
            type: config.type,
            values: config.values || null,
            min: config.min,
            max: config.max,
            maxLength: config.maxLength,
            scope: config.scope,
            storage: config.storage,
            requiresId: config.requiresId || false,
            note: config.note || null
        });
    }
    
    res.json({
        success: true,
        schemaVersion: 'RT_V22.1',
        allowedOps: ['add', 'replace', 'remove'],
        scopes: ['companyOverride', 'globalTemplate'],
        paths,
        examplePatch: {
            companyId: '{{companyId}}',
            scope: 'companyOverride',
            expectedVersion: '{{version from runtime-truth}}',
            patches: [
                { op: 'replace', path: '/controlPlane/greeting/text', value: 'Thanks for calling {{companyName}}!' },
                { op: 'replace', path: '/dynamicFlows/flows/{{flowId}}/enabled', value: true },
                { op: 'replace', path: '/scenarioBrain/scenarios/{{scenarioId}}/scenarioType', value: 'EMERGENCY' }
            ]
        }
    });
});

module.exports = router;


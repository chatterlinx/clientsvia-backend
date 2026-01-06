/**
 * ============================================================================
 * DYNAMIC FLOW API ROUTES
 * ============================================================================
 * 
 * API endpoints for managing Dynamic Flows per company.
 * 
 * ROUTES:
 * - GET    /api/company/:companyId/dynamic-flows           List company flows
 * - GET    /api/company/:companyId/dynamic-flows/templates List global templates
 * - GET    /api/company/:companyId/dynamic-flows/:flowId   Get flow detail
 * - POST   /api/company/:companyId/dynamic-flows           Create new flow
 * - PUT    /api/company/:companyId/dynamic-flows/:flowId   Update flow
 * - DELETE /api/company/:companyId/dynamic-flows/:flowId   Delete flow
 * - POST   /api/company/:companyId/dynamic-flows/:flowId/toggle  Enable/disable
 * - POST   /api/company/:companyId/dynamic-flows/from-template   Create from template
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const DynamicFlow = require('../../models/DynamicFlow');
const logger = require('../../utils/logger');

// ============================================================================
// FLOW VALIDATION - HARD RULES
// ============================================================================
// 
// RULE: A flow CANNOT be ENABLED unless triggers.length > 0
// This eliminates 50% of future bugs (dead flows that look active)
//

/**
 * Validate a dynamic flow before save.
 * Returns { valid: boolean, errors: string[] }
 */
function validateDynamicFlow(flowData) {
    const errors = [];
    
    // HARD RULE: Enabled flows MUST have at least one trigger
    const triggers = flowData.triggers || [];
    const enabled = flowData.enabled !== false;
    
    if (enabled && triggers.length === 0) {
        errors.push('INVALID: Flow cannot be ENABLED with 0 triggers. Add at least one trigger or set enabled=false.');
    }
    
    // Validate each trigger
    triggers.forEach((trigger, idx) => {
        if (!trigger.type) {
            errors.push(`Trigger[${idx}]: Missing "type" field`);
        }
        
        // Phrase triggers need phrases
        if (trigger.type === 'phrase') {
            const phrases = trigger.config?.phrases || [];
            if (phrases.length === 0) {
                errors.push(`Trigger[${idx}]: Phrase trigger has 0 phrases - it will NEVER fire`);
            } else if (phrases.length < 3) {
                // Warning but not error
                logger.warn('[FLOW VALIDATION] Phrase trigger has < 3 phrases (recommend 3+)', {
                    flowKey: flowData.flowKey,
                    phraseCount: phrases.length
                });
            }
        }
        
        // Keyword triggers need keywords
        if (trigger.type === 'keyword') {
            const keywords = trigger.config?.keywords || [];
            if (keywords.length === 0) {
                errors.push(`Trigger[${idx}]: Keyword trigger has 0 keywords - it will NEVER fire`);
            }
        }
    });
    
    // Validate actions have types
    const actions = flowData.actions || [];
    actions.forEach((action, idx) => {
        if (!action.type) {
            errors.push(`Action[${idx}]: Missing "type" field`);
        }
    });
    
    return {
        valid: errors.length === 0,
        errors,
        warnings: [], // Could add non-blocking warnings here
        triggerCount: triggers.length,
        actionCount: actions.length
    };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

// ============================================================================
// LIST COMPANY FLOWS
// ============================================================================
// GET /api/company/:companyId/dynamic-flows

router.get('/', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { includeTemplates = 'false' } = req.query;
        
        logger.info('[DYNAMIC FLOWS API] List request', { companyId });
        
        // Get company-specific flows
        const companyFlows = await DynamicFlow.find({
            companyId: new mongoose.Types.ObjectId(companyId)
        }).sort({ priority: -1, createdAt: -1 }).lean();
        
        let templates = [];
        if (includeTemplates === 'true') {
            templates = await DynamicFlow.getTemplates();
        }
        
        res.json({
            success: true,
            flows: companyFlows,
            templates: templates,
            total: companyFlows.length
        });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] List failed', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// LIST GLOBAL TEMPLATES (WITH VALIDATION STATUS)
// ============================================================================
// GET /api/company/:companyId/dynamic-flows/templates
//
// Returns templates with validation status so UI can:
// - Show "INVALID TEMPLATE" badge (red) if triggers.length === 0
// - Show "INCOMPLETE" badge (yellow) if actions < required
// - Disable "Copy to Company" for invalid templates

router.get('/templates', async (req, res) => {
    try {
        const { tradeType, tradeCategoryId } = req.query;
        
        logger.info('[DYNAMIC FLOWS API] Templates request', { tradeType, tradeCategoryId });
        
        let templates;
        if (tradeCategoryId) {
            templates = await DynamicFlow.getTemplatesByTradeCategory(tradeCategoryId);
        } else {
            templates = await DynamicFlow.getTemplates(tradeType);
        }
        
        // Add validation status to each template
        const templatesWithValidation = templates.map(t => {
            const validation = validateDynamicFlow(t);
            return {
                ...t,
                _validation: {
                    valid: validation.valid,
                    errors: validation.errors,
                    warnings: validation.warnings,
                    triggerCount: validation.triggerCount,
                    actionCount: validation.actionCount,
                    canCopy: validation.valid, // ← UI should check this
                    status: validation.valid 
                        ? (validation.warnings.length > 0 ? 'INCOMPLETE' : 'VALID')
                        : 'INVALID'
                }
            };
        });
        
        const validCount = templatesWithValidation.filter(t => t._validation.valid).length;
        const invalidCount = templatesWithValidation.filter(t => !t._validation.valid).length;
        
        res.json({
            success: true,
            templates: templatesWithValidation,
            total: templates.length,
            summary: {
                valid: validCount,
                invalid: invalidCount
            }
        });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Templates failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET FLOW DETAIL
// ============================================================================
// GET /api/company/:companyId/dynamic-flows/:flowId

router.get('/:flowId', async (req, res) => {
    try {
        const { companyId, flowId } = req.params;
        
        const flow = await DynamicFlow.findOne({
            _id: flowId,
            $or: [
                { companyId: new mongoose.Types.ObjectId(companyId) },
                { isTemplate: true }
            ]
        }).lean();
        
        if (!flow) {
            return res.status(404).json({ success: false, error: 'Flow not found' });
        }
        
        res.json({ success: true, flow });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Get failed', {
            flowId: req.params.flowId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// CREATE NEW FLOW
// ============================================================================
// POST /api/company/:companyId/dynamic-flows

router.post('/', async (req, res) => {
    try {
        const { companyId } = req.params;
        const flowData = req.body;
        
        logger.info('[DYNAMIC FLOWS API] Create request', {
            companyId,
            name: flowData.name,
            flowKey: flowData.flowKey
        });
        
        // Validate required fields
        if (!flowData.name || !flowData.flowKey) {
            return res.status(400).json({
                success: false,
                error: 'name and flowKey are required'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HARD RULE: Validate flow before save
        // A flow CANNOT be ENABLED with 0 triggers
        // ═══════════════════════════════════════════════════════════════════
        const validation = validateDynamicFlow(flowData);
        if (!validation.valid) {
            logger.warn('[DYNAMIC FLOWS API] Validation failed on CREATE', {
                companyId,
                flowKey: flowData.flowKey,
                errors: validation.errors
            });
            return res.status(400).json({
                success: false,
                error: 'Flow validation failed',
                validationErrors: validation.errors,
                triggerCount: validation.triggerCount,
                actionCount: validation.actionCount
            });
        }
        
        // Check for duplicate flowKey
        const existing = await DynamicFlow.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: flowData.flowKey.toLowerCase()
        });
        
        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Flow with key "${flowData.flowKey}" already exists`
            });
        }
        
        // Create flow
        const flow = await DynamicFlow.create({
            ...flowData,
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: flowData.flowKey.toLowerCase(),
            isTemplate: false,
            metadata: {
                createdBy: req.user?.userId,
                version: 1
            }
        });
        
        logger.info('[DYNAMIC FLOWS API] Flow created', {
            flowId: flow._id,
            flowKey: flow.flowKey
        });
        
        res.status(201).json({ success: true, flow });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Create failed', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// UPDATE FLOW
// ============================================================================
// PUT /api/company/:companyId/dynamic-flows/:flowId

router.put('/:flowId', async (req, res) => {
    try {
        const { companyId, flowId } = req.params;
        const updates = req.body;
        
        logger.info('[DYNAMIC FLOWS API] Update request', {
            companyId,
            flowId
        });
        
        // Find existing flow
        const existing = await DynamicFlow.findOne({
            _id: flowId,
            companyId: new mongoose.Types.ObjectId(companyId)
        });
        
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Flow not found' });
        }
        
        // Don't allow updating templates directly
        if (existing.isTemplate) {
            return res.status(400).json({
                success: false,
                error: 'Cannot modify global templates. Create a copy first.'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HARD RULE: Validate flow before update
        // A flow CANNOT be ENABLED with 0 triggers
        // ═══════════════════════════════════════════════════════════════════
        // Merge existing with updates for validation
        const mergedForValidation = {
            ...existing.toObject(),
            ...updates
        };
        const validation = validateDynamicFlow(mergedForValidation);
        if (!validation.valid) {
            logger.warn('[DYNAMIC FLOWS API] Validation failed on UPDATE', {
                flowId,
                flowKey: existing.flowKey,
                errors: validation.errors
            });
            return res.status(400).json({
                success: false,
                error: 'Flow validation failed',
                validationErrors: validation.errors,
                triggerCount: validation.triggerCount,
                actionCount: validation.actionCount
            });
        }
        
        // Update flow
        const flow = await DynamicFlow.findByIdAndUpdate(
            flowId,
            {
                ...updates,
                'metadata.lastModifiedBy': req.user?.userId,
                $inc: { 'metadata.version': 1 }
            },
            { new: true }
        ).lean();
        
        logger.info('[DYNAMIC FLOWS API] Flow updated', {
            flowId,
            version: flow.metadata?.version
        });
        
        res.json({ success: true, flow });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Update failed', {
            flowId: req.params.flowId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// DELETE FLOW
// ============================================================================
// DELETE /api/company/:companyId/dynamic-flows/:flowId

router.delete('/:flowId', async (req, res) => {
    try {
        const { companyId, flowId } = req.params;
        
        logger.info('[DYNAMIC FLOWS API] Delete request', {
            companyId,
            flowId
        });
        
        const flow = await DynamicFlow.findOneAndDelete({
            _id: flowId,
            companyId: new mongoose.Types.ObjectId(companyId),
            isTemplate: false  // Can't delete templates
        });
        
        if (!flow) {
            return res.status(404).json({
                success: false,
                error: 'Flow not found or cannot be deleted'
            });
        }
        
        logger.info('[DYNAMIC FLOWS API] Flow deleted', {
            flowId,
            flowKey: flow.flowKey
        });
        
        res.json({ success: true, deleted: true });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Delete failed', {
            flowId: req.params.flowId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// TOGGLE FLOW (Enable/Disable)
// ============================================================================
// POST /api/company/:companyId/dynamic-flows/:flowId/toggle

router.post('/:flowId/toggle', async (req, res) => {
    try {
        const { companyId, flowId } = req.params;
        const { enabled } = req.body;
        const wantEnabled = enabled !== false;
        
        logger.info('[DYNAMIC FLOWS API] Toggle request', {
            companyId,
            flowId,
            enabled: wantEnabled
        });
        
        // First, get the existing flow to validate
        const existing = await DynamicFlow.findOne({
            _id: flowId,
            companyId: new mongoose.Types.ObjectId(companyId)
        });
        
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Flow not found' });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HARD RULE: Cannot ENABLE a flow with 0 triggers
        // ═══════════════════════════════════════════════════════════════════
        if (wantEnabled) {
            const triggers = existing.triggers || [];
            if (triggers.length === 0) {
                logger.warn('[DYNAMIC FLOWS API] Cannot enable flow with 0 triggers', {
                    flowId,
                    flowKey: existing.flowKey
                });
                return res.status(400).json({
                    success: false,
                    error: 'Cannot enable flow with 0 triggers. Add at least one trigger first.',
                    flowKey: existing.flowKey,
                    triggerCount: 0
                });
            }
        }
        
        const flow = await DynamicFlow.findByIdAndUpdate(
            flowId,
            { enabled: wantEnabled },
            { new: true }
        ).lean();
        
        logger.info('[DYNAMIC FLOWS API] Flow toggled', {
            flowId,
            enabled: flow.enabled,
            triggerCount: (flow.triggers || []).length
        });
        
        res.json({ success: true, flow });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Toggle failed', {
            flowId: req.params.flowId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// CREATE FROM TEMPLATE
// ============================================================================
// POST /api/company/:companyId/dynamic-flows/from-template

router.post('/from-template', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { templateId, overrides = {}, tradeCategoryId = null, tradeCategoryName = null } = req.body;
        
        logger.info('[DYNAMIC FLOWS API] Create from template', {
            companyId,
            templateId
        });
        
        if (!templateId) {
            return res.status(400).json({
                success: false,
                error: 'templateId is required'
            });
        }
        
        // Check if company already has this flow
        const template = await DynamicFlow.findById(templateId).lean();
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // BLOCK COPYING INVALID TEMPLATES
        // A template with 0 triggers should NEVER be copied
        // ═══════════════════════════════════════════════════════════════════
        const templateValidation = validateDynamicFlow(template);
        if (!templateValidation.valid) {
            logger.warn('[DYNAMIC FLOWS API] Blocked copy of invalid template', {
                templateId,
                flowKey: template.flowKey,
                errors: templateValidation.errors
            });
            return res.status(400).json({
                success: false,
                error: 'Cannot copy invalid template. Template must be fixed first.',
                templateFlowKey: template.flowKey,
                validationErrors: templateValidation.errors,
                triggerCount: templateValidation.triggerCount,
                actionCount: templateValidation.actionCount
            });
        }
        
        const existing = await DynamicFlow.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            flowKey: template.flowKey
        });
        
        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Company already has a flow with key "${template.flowKey}"`
            });
        }
        
        // Create from template
        // ─────────────────────────────────────────────────────────────────────
        // IMPORTANT: Build overrides in a way Mongoose will actually persist.
        // Do NOT use dot-notation keys (e.g. "metadata.createdBy") inside objects;
        // those become literal keys and are silently lost.
        // ─────────────────────────────────────────────────────────────────────
        const mergedOverrides = {
            ...overrides,
            ...(tradeCategoryId ? { tradeCategoryId } : {}),
            ...(tradeCategoryName ? { tradeCategoryName } : {}),
            metadata: {
                ...(overrides?.metadata || {}),
                createdBy: req.user?.userId || null
            }
        };

        const flow = await DynamicFlow.createFromTemplate(
            templateId,
            new mongoose.Types.ObjectId(companyId),
            mergedOverrides
        );
        
        logger.info('[DYNAMIC FLOWS API] Flow created from template', {
            flowId: flow._id,
            templateId,
            flowKey: flow.flowKey
        });
        
        res.status(201).json({ success: true, flow });
        
    } catch (error) {
        // Schema validation errors must be returned as 400 with actionable details (never a blind 500).
        if (error && (error.name === 'ValidationError' || error._message?.includes('validation failed'))) {
            const errs = error.errors ? Object.values(error.errors) : [];
            const validationErrors = errs.map(e => {
                const path = e?.path || e?.properties?.path || 'unknown';
                const value = e?.value;
                const kind = e?.kind || e?.properties?.type || 'validation';
                const message = e?.message || `${path}: ${String(value)} failed ${kind}`;
                return `${path}: ${message}`;
            });

            logger.warn('[DYNAMIC FLOWS API] Create from template validation failed', {
                companyId: req.params.companyId,
                templateId: req.body?.templateId,
                validationErrors
            });

            return res.status(400).json({
                success: false,
                error: `DynamicFlow validation failed`,
                validationErrors,
                raw: {
                    name: error.name,
                    message: error.message
                }
            });
        }

        logger.error('[DYNAMIC FLOWS API] Create from template failed', {
            companyId: req.params.companyId,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;


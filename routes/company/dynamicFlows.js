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

    // HARD RULE (runtime truth): enabled V1 flows must not be "half wired"
    // Snapshot/runtime wiring expects these four action types to exist when a flow is enabled.
    if (enabled) {
        const types = actions.map(a => String(a.type || '').toLowerCase());
        const required = ['set_flag', 'append_ledger', 'ack_once', 'transition_mode'];
        const missing = required.filter(t => !types.includes(t));
        if (missing.length > 0) {
            errors.push(`INVALID: Enabled flow is missing required actions: ${missing.join(', ')}`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings: [], // Could add non-blocking warnings here
        triggerCount: triggers.length,
        actionCount: actions.length
    };
}

/**
 * Normalize legacy DFLOW_V1 payloads into the current DynamicFlow schema.
 * Returns: { flow: normalizedFlow, notes: string[] }
 *
 * This prevents "enabled but dead" flows and removes the need for per-client troubleshooting.
 */
function normalizeDynamicFlowInput(flowData) {
    const notes = [];
    const out = { ...(flowData || {}) };

    // Normalize enabled boolean
    out.enabled = out.enabled !== false;

    // ─────────────────────────────────────────────────────────────────────
    // Triggers: support legacy `trigger` object and legacy types
    // ─────────────────────────────────────────────────────────────────────
    if (!Array.isArray(out.triggers) || out.triggers.length === 0) {
        if (out.trigger && typeof out.trigger === 'object') {
            const t = out.trigger;
            // Legacy PHRASE_MATCH → phrase trigger
            const legacyType = String(t.type || '').toUpperCase();
            if (legacyType === 'PHRASE_MATCH') {
                out.triggers = [{
                    type: 'phrase',
                    config: {
                        phrases: Array.isArray(t.phrases) ? t.phrases : [],
                        fuzzy: t.fuzzy !== false,
                        minConfidence: typeof t.minConfidence === 'number' ? t.minConfidence : 0.7
                    },
                    priority: 10,
                    description: 'Migrated from legacy trigger'
                }];
                notes.push('Normalized legacy trigger → triggers[0] (phrase)');
            } else if (legacyType) {
                out.triggers = [{
                    type: legacyType.toLowerCase(),
                    config: t.config || {},
                    priority: 10,
                    description: 'Migrated from legacy trigger'
                }];
                notes.push(`Normalized legacy trigger type "${legacyType}"`);
            }
        }
    }

    // Special-case: after_hours_routing should use the built-in after_hours trigger (no phrases needed)
    if ((out.flowKey || '').toLowerCase() === 'after_hours_routing') {
        const hasAfterHours = Array.isArray(out.triggers) && out.triggers.some(tr => tr?.type === 'after_hours');
        const hasPhrase = Array.isArray(out.triggers) && out.triggers.some(tr => tr?.type === 'phrase');
        if (!hasAfterHours && hasPhrase) {
            const phrase = out.triggers.find(tr => tr?.type === 'phrase');
            const phrases = phrase?.config?.phrases || [];
            if (!Array.isArray(phrases) || phrases.length === 0) {
                out.triggers = [{ type: 'after_hours', config: {}, priority: 10, description: 'After-hours (built-in)' }];
                notes.push('Converted after_hours_routing trigger to built-in after_hours (no phrases required)');
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Actions: normalize casing + payload→config for DFLOW_V1
    // ─────────────────────────────────────────────────────────────────────
    if (Array.isArray(out.actions)) {
        out.actions = out.actions.map((a) => {
            if (!a || typeof a !== 'object') return a;
            const typeRaw = a.type || a.action || '';
            const type = String(typeRaw).toLowerCase();
            const timing = a.timing || 'on_activate';
            const config = a.config || a.payload || {};

            // Legacy payload field name normalization
            if (type === 'set_flag' || type === 'set-flag' || type === 'setflag') {
                const flagName = config.flagName || config.path || config.name;
                const flagValue = config.flagValue ?? config.value ?? true;
                return {
                    timing,
                    type: 'set_flag',
                    config: {
                        flagName,
                        flagValue,
                        alsoWriteToCallLedgerFacts: config.alsoWriteToCallLedgerFacts !== false
                    }
                };
            }
            if (type === 'ack_once' || type === 'ack-once' || type === 'ackonce') {
                return { timing, type: 'ack_once', config: { text: config.text || config.response || '' } };
            }
            if (type === 'append_ledger' || type === 'append-ledger') {
                return {
                    timing,
                    type: 'append_ledger',
                    config: {
                        type: config.type,
                        key: config.key,
                        note: config.note
                    }
                };
            }
            if (type === 'transition_mode' || type === 'transition-mode') {
                return {
                    timing,
                    type: 'transition_mode',
                    config: {
                        targetMode: config.targetMode,
                        setBookingLocked: config.setBookingLocked !== false
                    }
                };
            }
            // Default passthrough with normalized type/config
            return { ...a, timing, type, config };
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Auto-repair: If enabled, ensure required action types exist.
    // IMPORTANT: This is not hidden. We return explicit notes to the caller.
    // ─────────────────────────────────────────────────────────────────────
    if (out.enabled !== false) {
        const actions = Array.isArray(out.actions) ? out.actions : [];
        const types = actions.map(a => String(a?.type || '').toLowerCase());

        // Ensure set_flag exists (cannot invent a flagName safely)
        if (!types.includes('set_flag')) {
            notes.push('Auto-repair blocked: missing set_flag (requires user-supplied flagName)');
        }

        // Ensure ack_once exists (cannot invent words safely)
        if (!types.includes('ack_once')) {
            notes.push('Auto-repair blocked: missing ack_once (requires user-supplied text)');
        }

        // append_ledger: we can inject safe audit defaults if missing
        if (!types.includes('append_ledger')) {
            const key = (out.flowKey || 'FLOW').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            actions.push({
                timing: 'on_activate',
                type: 'append_ledger',
                config: {
                    type: 'EVENT',
                    key: `${key}_ACTIVATED`,
                    note: `Auto-injected audit entry for flow ${out.flowKey || ''}`.trim()
                }
            });
            notes.push('Auto-injected missing action: append_ledger');
        }

        // transition_mode: safe default is to NOT change mode unless flowKey is known.
        if (!types.includes('transition_mode')) {
            let targetMode = null;
            let setBookingLocked = true;
            const fk = String(out.flowKey || '').toLowerCase();
            if (fk === 'after_hours_routing') {
                targetMode = 'BOOKING';
                setBookingLocked = false;
            } else if (fk === 'technician_request') {
                targetMode = 'BOOKING';
                setBookingLocked = true;
            }

            if (targetMode) {
                actions.push({
                    timing: 'on_activate',
                    type: 'transition_mode',
                    config: { targetMode, setBookingLocked }
                });
                notes.push(`Auto-injected missing action: transition_mode (${targetMode})`);
            } else {
                notes.push('Auto-repair blocked: missing transition_mode (unknown safe targetMode for this flowKey)');
            }
        }

        out.actions = actions;
    }

    // Remove legacy top-level keys to avoid confusion (but do not delete if caller wants them)
    // Keep them if present; DB schema will ignore unknown keys anyway.
    return { flow: out, notes };
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
        const rawFlowData = req.body;
        const normalized = normalizeDynamicFlowInput(rawFlowData);
        const flowData = normalized.flow;
        
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
                actionCount: validation.actionCount,
                normalizationNotes: normalized.notes || []
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
        
        res.status(201).json({ success: true, flow, normalizationNotes: normalized.notes || [] });
        
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
        const rawUpdates = req.body;
        const normalized = normalizeDynamicFlowInput(rawUpdates);
        const updates = normalized.flow;
        
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
                actionCount: validation.actionCount,
                normalizationNotes: normalized.notes || []
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
        
        res.json({ success: true, flow, normalizationNotes: normalized.notes || [] });
        
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


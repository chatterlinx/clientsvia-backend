/**
 * ============================================================================
 * DYNAMIC FLOW TEMPLATE ADMIN
 * ============================================================================
 *
 * Admin endpoints to validate or purge global Dynamic Flow templates.
 *
 * GET /api/admin/dynamic-flow-templates/validate-all
 * DELETE /api/admin/dynamic-flow-templates/purge-invalid
 *
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const DynamicFlow = require('../../models/DynamicFlow');
const logger = require('../../utils/logger');

// ============================================================================
// VALIDATE TEMPLATE HELPER
// ============================================================================

function validateTemplate(template) {
    const errors = [];
    const warnings = [];
    
    // Required fields
    if (!template.flowKey) errors.push('Missing flowKey');
    if (!template.name) errors.push('Missing name');
    
    // Triggers validation
    const triggers = template.triggers || [];
    if (triggers.length === 0) {
        errors.push('No triggers defined - template will NEVER fire');
    } else {
        triggers.forEach((t, i) => {
            if (!t.type) errors.push(`Trigger[${i}]: Missing type`);
            if (t.type === 'phrase') {
                const phrases = t.config?.phrases || t.phrases || [];
                if (phrases.length === 0) {
                    errors.push(`Trigger[${i}]: Phrase trigger has 0 phrases`);
                } else if (phrases.length < 3) {
                    warnings.push(`Trigger[${i}]: Only ${phrases.length} phrases (recommend 3+)`);
                }
            }
        });
    }
    
    // Actions validation
    const actions = template.actions || [];
    if (actions.length === 0) {
        warnings.push('No actions defined');
    } else {
        actions.forEach((a, i) => {
            if (!a.type) errors.push(`Action[${i}]: Missing type`);
        });
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        triggerCount: triggers.length,
        actionCount: actions.length,
        phraseCount: triggers.reduce((sum, t) => sum + (t.config?.phrases?.length || t.phrases?.length || 0), 0)
    };
}

// ============================================================================
// VALIDATE ALL TEMPLATES
// ============================================================================
// GET /api/admin/dynamic-flow-templates/validate-all

router.get('/validate-all', async (req, res) => {
    try {
        const templates = await DynamicFlow.find({ isTemplate: true }).lean();
        
        const results = templates.map(t => ({
            flowKey: t.flowKey,
            name: t.name,
            enabled: t.enabled,
            ...validateTemplate(t)
        }));
        
        const valid = results.filter(r => r.valid);
        const invalid = results.filter(r => !r.valid);
        
        res.json({
            success: true,
            summary: {
                total: templates.length,
                valid: valid.length,
                invalid: invalid.length
            },
            templates: results
        });
        
    } catch (error) {
        logger.error('[VALIDATE TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// DELETE INVALID TEMPLATES (DANGEROUS)
// ============================================================================
// DELETE /api/admin/dynamic-flow-templates/purge-invalid

router.delete('/purge-invalid', async (req, res) => {
    try {
        const { confirm } = req.query;
        
        if (confirm !== 'yes-delete-invalid') {
            return res.status(400).json({
                success: false,
                error: 'Must confirm with ?confirm=yes-delete-invalid'
            });
        }
        
        const templates = await DynamicFlow.find({ isTemplate: true }).lean();
        
        const toDelete = [];
        for (const t of templates) {
            const validation = validateTemplate(t);
            if (!validation.valid) {
                toDelete.push(t);
            }
        }
        
        if (toDelete.length === 0) {
            return res.json({
                success: true,
                message: 'No invalid templates to delete',
                deleted: 0
            });
        }
        
        // Delete them
        const ids = toDelete.map(t => t._id);
        await DynamicFlow.deleteMany({ _id: { $in: ids } });
        
        logger.warn('[PURGE TEMPLATES] Deleted invalid templates', {
            count: toDelete.length,
            flowKeys: toDelete.map(t => t.flowKey)
        });
        
        res.json({
            success: true,
            message: `Deleted ${toDelete.length} invalid templates`,
            deleted: toDelete.map(t => ({ flowKey: t.flowKey, name: t.name }))
        });
        
    } catch (error) {
        logger.error('[PURGE TEMPLATES] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

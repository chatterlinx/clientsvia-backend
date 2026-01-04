/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GLOBAL TEMPLATES PATCH API - THE ONLY SAFE WRITE PATH FOR SCENARIOS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This is the SINGLE CORRECT endpoint for modifying scenario content.
 * 
 * HARD RULES (enforced in GlobalTemplatePatchService):
 * 1. All scenarios remain scope: "GLOBAL"
 * 2. All scenarios remain ownerCompanyId: null
 * 3. No writes to Company documents
 * 4. scenarioId must exist (update) or be server-generated (create)
 * 5. All operations are audited
 * 
 * Usage:
 *   POST /api/admin/global-templates/:templateId/scenarios/patch
 *   { dryRun: true, ops: [...] }
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const GlobalTemplatePatchService = require('../../services/GlobalTemplatePatchService');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE - Require Admin Auth
// ═══════════════════════════════════════════════════════════════════════════════

// Note: This route should be protected by admin auth middleware at the app level
// The auth middleware should set req.user with at minimum { email or username }

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/global-templates/:templateId/scenarios/patch
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Apply patch operations to a global template's scenarios.
 * 
 * @route POST /api/admin/global-templates/:templateId/scenarios/patch
 * 
 * @param {string} templateId - The global template ID (from URL)
 * 
 * @body {boolean} dryRun - If true, returns diff without writing (RECOMMENDED FIRST)
 * @body {string} [sourceExportHash] - Optional SHA256 of export file for verification
 * @body {Array} ops - Array of operations:
 *   - { op: "update", scenarioId: "xxx", set: { triggers: [...], ... } }
 *   - { op: "create", categoryId: "xxx", newScenario: { name: "...", triggers: [...] } }
 *   - { op: "delete", scenarioId: "xxx" }
 * 
 * @returns {Object} Result with diff, counts, changes, and errors
 * 
 * @example
 * // Dry run first (recommended)
 * POST /api/admin/global-templates/68fb535130d19aec696d8123/scenarios/patch
 * {
 *   "dryRun": true,
 *   "ops": [
 *     {
 *       "op": "update",
 *       "scenarioId": "scenario-1761397969597-lhg4k3qhb",
 *       "set": {
 *         "triggers": ["ac blowing warm", "no cool air", "warm air from vents"]
 *       }
 *     }
 *   ]
 * }
 */
router.post('/:templateId/scenarios/patch', async (req, res) => {
    const { templateId } = req.params;
    const patchPayload = req.body;
    const actor = req.user?.email || req.user?.username || 'admin';

    logger.info('[GLOBAL-TEMPLATES-PATCH] Received patch request', {
        templateId,
        actor,
        dryRun: patchPayload.dryRun,
        opsCount: patchPayload.ops?.length || 0
    });

    try {
        // ═══════════════════════════════════════════════════════════════════
        // INPUT VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        
        if (!templateId) {
            return res.status(400).json({
                success: false,
                error: 'templateId is required in URL path'
            });
        }

        if (!patchPayload.ops || !Array.isArray(patchPayload.ops)) {
            return res.status(400).json({
                success: false,
                error: 'Request body must contain ops array'
            });
        }

        if (patchPayload.ops.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'ops array cannot be empty'
            });
        }

        if (patchPayload.ops.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Maximum 100 operations per request (received ' + patchPayload.ops.length + ')'
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // APPLY PATCH (Service handles all enforcement)
        // ═══════════════════════════════════════════════════════════════════
        
        const result = await GlobalTemplatePatchService.applyPatch(
            templateId,
            patchPayload,
            actor
        );

        // ═══════════════════════════════════════════════════════════════════
        // RESPONSE
        // ═══════════════════════════════════════════════════════════════════
        
        const statusCode = result.ops.failed > 0 ? 207 : 200; // 207 = Multi-Status
        
        res.status(statusCode).json({
            success: result.ops.failed === 0,
            message: result.dryRun 
                ? `DRY RUN: ${result.ops.successful} operations would succeed, ${result.ops.failed} would fail`
                : `APPLIED: ${result.ops.successful} operations succeeded, ${result.ops.failed} failed`,
            result
        });

    } catch (error) {
        logger.error('[GLOBAL-TEMPLATES-PATCH] Error:', error);

        // Determine appropriate error code
        let statusCode = 500;
        if (error.message.includes('VALIDATION_ERROR')) statusCode = 400;
        if (error.message.includes('TEMPLATE_NOT_FOUND')) statusCode = 404;
        if (error.message.includes('CONTAMINATION_BLOCKED')) statusCode = 403;

        res.status(statusCode).json({
            success: false,
            error: error.message,
            code: error.message.split(':')[0] || 'INTERNAL_ERROR'
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/global-templates/:templateId/registry
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Get ID registry for a template (all categoryIds and scenarioIds).
 * Use this to build patch payloads with correct IDs.
 * 
 * @route GET /api/admin/global-templates/:templateId/registry
 * @returns {Object} Registry with all IDs
 */
router.get('/:templateId/registry', async (req, res) => {
    const { templateId } = req.params;

    try {
        const registry = await GlobalTemplatePatchService.generateRegistry(templateId);

        res.json({
            success: true,
            message: 'Registry generated successfully. Use these IDs in patch operations.',
            registry,
            summary: {
                templateId: registry.templateId,
                templateName: registry.templateName,
                categoryCount: registry.categories.length,
                scenarioCount: registry.categories.reduce((sum, c) => sum + c.scenarios.length, 0)
            }
        });

    } catch (error) {
        logger.error('[GLOBAL-TEMPLATES-REGISTRY] Error:', error);

        res.status(error.message.includes('not found') ? 404 : 500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/global-templates/:templateId/scenario/:scenarioId
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Get a single scenario by ID (for verification before patching).
 */
router.get('/:templateId/scenario/:scenarioId', async (req, res) => {
    const { templateId, scenarioId } = req.params;

    try {
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        if (!template) {
            return res.status(404).json({
                success: false,
                error: `Template ${templateId} not found`
            });
        }

        // Find scenario
        let foundScenario = null;
        let foundCategory = null;

        for (const category of template.categories || []) {
            const scenario = (category.scenarios || []).find(s => s.scenarioId === scenarioId);
            if (scenario) {
                foundScenario = scenario;
                foundCategory = { id: category.id, name: category.name };
                break;
            }
        }

        if (!foundScenario) {
            return res.status(404).json({
                success: false,
                error: `Scenario ${scenarioId} not found in template ${templateId}`
            });
        }

        res.json({
            success: true,
            scenario: foundScenario,
            category: foundCategory,
            template: {
                templateId: template._id.toString(),
                templateName: template.name
            }
        });

    } catch (error) {
        logger.error('[GLOBAL-TEMPLATES-SCENARIO] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


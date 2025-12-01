/**
 * ============================================================================
 * FRONTLINE SCRIPT BUILDER API
 * ============================================================================
 * 
 * PURPOSE: LLM-powered script generation for Frontline-Intel
 * 
 * ENDPOINTS:
 * - GET  /api/admin/frontline-script/context/:companyId - Load builder context
 * - POST /api/admin/frontline-script/generate - Generate script draft
 * - GET  /api/admin/frontline-script/presets - Get tone/aggro presets
 * - GET  /api/admin/frontline-script/drafts/:companyId - Get recent drafts
 * 
 * SECURITY: Admin-only via authMiddleware
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const FrontlineScriptBuilder = require('../../services/FrontlineScriptBuilder');
const FrontlineScriptDraft = require('../../models/FrontlineScriptDraft');
const { authMiddleware } = require('../../middleware/authMiddleware');

/**
 * GET /api/admin/frontline-script/context/:companyId
 * Load all context needed for the script builder UI
 */
router.get('/context/:companyId', authMiddleware, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!companyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        logger.info('[FRONTLINE SCRIPT API] Loading context', {
            companyId,
            userId: req.user?.id
        });
        
        const context = await FrontlineScriptBuilder.loadContext(companyId);
        
        res.json({
            success: true,
            ...context
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error loading context', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/frontline-script/generate
 * Generate a new script draft using LLM
 */
router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const {
            companyId,
            versionId,
            adminBrief,
            tonePreset,
            aggressiveness,
            includeExamples
        } = req.body;
        
        if (!companyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        logger.info('[FRONTLINE SCRIPT API] Generating script', {
            companyId,
            versionId,
            tonePreset,
            aggressiveness,
            userId: req.user?.id
        });
        
        const result = await FrontlineScriptBuilder.generateScript({
            companyId,
            versionId: versionId || `draft-${Date.now()}`,
            adminBrief: adminBrief || '',
            tonePreset: tonePreset || 'professional_warm',
            aggressiveness: aggressiveness || 'medium',
            includeExamples: includeExamples !== false,
            userId: req.user?.id
        });
        
        res.json({
            success: true,
            scriptText: result.scriptText,
            draft: result.draft
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error generating script', {
            companyId: req.body.companyId,
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/frontline-script/presets
 * Get available tone and aggressiveness presets
 */
router.get('/presets', authMiddleware, async (req, res) => {
    try {
        res.json({
            success: true,
            tonePresets: FrontlineScriptBuilder.getTonePresets(),
            aggressivenessLevels: FrontlineScriptBuilder.getAggressivenessLevels()
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error getting presets', {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/frontline-script/drafts/:companyId
 * Get recent script drafts for a company
 */
router.get('/drafts/:companyId', authMiddleware, async (req, res) => {
    try {
        const { companyId } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        
        if (!companyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        const drafts = await FrontlineScriptDraft.getRecentDrafts(companyId, limit);
        
        res.json({
            success: true,
            drafts: drafts.map(d => ({
                id: d._id.toString(),
                createdAt: d.createdAt,
                createdBy: d.createdBy?.email || 'Unknown',
                parameters: d.parameters,
                contextSnapshot: d.contextSnapshot,
                wasApplied: d.wasApplied,
                scriptPreview: d.scriptText?.substring(0, 200) + '...'
            }))
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error getting drafts', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/frontline-script/draft/:draftId
 * Get full script draft by ID
 */
router.get('/draft/:draftId', authMiddleware, async (req, res) => {
    try {
        const { draftId } = req.params;
        
        const draft = await FrontlineScriptDraft.findById(draftId)
            .populate('createdBy', 'email name')
            .lean();
        
        if (!draft) {
            return res.status(404).json({
                success: false,
                error: 'Draft not found'
            });
        }
        
        res.json({
            success: true,
            draft: {
                id: draft._id.toString(),
                companyId: draft.companyId.toString(),
                versionId: draft.versionId,
                scriptText: draft.scriptText,
                parameters: draft.parameters,
                contextSnapshot: draft.contextSnapshot,
                llmMetadata: draft.llmMetadata,
                createdAt: draft.createdAt,
                createdBy: draft.createdBy?.email || 'Unknown',
                wasApplied: draft.wasApplied,
                appliedAt: draft.appliedAt
            }
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error getting draft', {
            draftId: req.params.draftId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/frontline-script/draft/:draftId/apply
 * Mark a draft as applied (after user saves to cheatsheet)
 */
router.post('/draft/:draftId/apply', authMiddleware, async (req, res) => {
    try {
        const { draftId } = req.params;
        const { appliedToVersionId } = req.body;
        
        await FrontlineScriptDraft.markAsApplied(draftId, appliedToVersionId);
        
        res.json({
            success: true,
            message: 'Draft marked as applied'
        });
        
    } catch (error) {
        logger.error('[FRONTLINE SCRIPT API] Error marking draft as applied', {
            draftId: req.params.draftId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


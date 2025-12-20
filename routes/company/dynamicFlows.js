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
// LIST GLOBAL TEMPLATES
// ============================================================================
// GET /api/company/:companyId/dynamic-flows/templates

router.get('/templates', async (req, res) => {
    try {
        const { tradeType } = req.query;
        
        logger.info('[DYNAMIC FLOWS API] Templates request', { tradeType });
        
        const templates = await DynamicFlow.getTemplates(tradeType);
        
        res.json({
            success: true,
            templates,
            total: templates.length
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
        
        logger.info('[DYNAMIC FLOWS API] Toggle request', {
            companyId,
            flowId,
            enabled
        });
        
        const flow = await DynamicFlow.findOneAndUpdate(
            {
                _id: flowId,
                companyId: new mongoose.Types.ObjectId(companyId)
            },
            { enabled: enabled !== false },
            { new: true }
        ).lean();
        
        if (!flow) {
            return res.status(404).json({ success: false, error: 'Flow not found' });
        }
        
        logger.info('[DYNAMIC FLOWS API] Flow toggled', {
            flowId,
            enabled: flow.enabled
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
        const { templateId, overrides = {} } = req.body;
        
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
        const flow = await DynamicFlow.createFromTemplate(
            templateId,
            new mongoose.Types.ObjectId(companyId),
            {
                ...overrides,
                'metadata.createdBy': req.user?.userId
            }
        );
        
        logger.info('[DYNAMIC FLOWS API] Flow created from template', {
            flowId: flow._id,
            templateId,
            flowKey: flow.flowKey
        });
        
        res.status(201).json({ success: true, flow });
        
    } catch (error) {
        logger.error('[DYNAMIC FLOWS API] Create from template failed', {
            companyId: req.params.companyId,
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;


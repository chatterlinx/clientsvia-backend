// routes/workflows.js
// Comprehensive workflow management routes

const express = require('express');
const router = express.Router();
const { WorkflowService } = require('../services/workflowService');

// GET /api/workflows - List workflows for a company
router.get('/', async (req, res) => {
    try {
        const { companyId } = req.query;
        
        if (!companyId) {
            return res.status(400).json({ 
                message: 'Company ID is required' 
            });
        }

        const workflows = await WorkflowService.getWorkflowsForCompany(companyId);
        res.json(workflows);
    } catch (error) {
        console.error('[WorkflowRoutes] Error getting workflows:', error);
        res.status(500).json({ 
            message: 'Error fetching workflows' 
        });
    }
});

// GET /api/workflows/:id - Get specific workflow
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const workflow = await Workflow.findById(id).populate('steps.actionId');
        
        if (!workflow) {
            return res.status(404).json({ message: 'Workflow not found' });
        }
        
        res.json(workflow);
    } catch (error) {
        console.error('[WorkflowRoutes] Error getting workflow:', error);
        res.status(500).json({ 
            message: 'Error fetching workflow' 
        });
    }
});

// POST /api/workflows - Create workflow
router.post('/', async (req, res) => {
    try {
        const workflowData = req.body;
        
        if (!workflowData.name || !workflowData.companyId) {
            return res.status(400).json({ 
                message: 'Workflow name and company ID are required' 
            });
        }

        const workflow = await WorkflowService.createWorkflow(workflowData);
        res.status(201).json(workflow);
    } catch (error) {
        console.error('[WorkflowRoutes] Error creating workflow:', error);
        res.status(500).json({ 
            message: 'Error creating workflow' 
        });
    }
});

// PUT /api/workflows/:id - Update workflow
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        const workflow = await WorkflowService.updateWorkflow(id, updateData);
        
        if (!workflow) {
            return res.status(404).json({ message: 'Workflow not found' });
        }
        
        res.json(workflow);
    } catch (error) {
        console.error('[WorkflowRoutes] Error updating workflow:', error);
        res.status(500).json({ 
            message: 'Error updating workflow' 
        });
    }
});

// DELETE /api/workflows/:id - Delete workflow
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await WorkflowService.deleteWorkflow(id);
        res.json({ message: 'Workflow deleted successfully' });
    } catch (error) {
        console.error('[WorkflowRoutes] Error deleting workflow:', error);
        res.status(500).json({ 
            message: 'Error deleting workflow' 
        });
    }
});

// POST /api/workflows/:id/execute - Execute workflow
router.post('/:id/execute', async (req, res) => {
    try {
        const { id } = req.params;
        const context = req.body.context || {};
        
        const result = await WorkflowService.executeWorkflow(id, context);
        res.json(result);
    } catch (error) {
        console.error('[WorkflowRoutes] Error executing workflow:', error);
        res.status(500).json({ 
            message: 'Error executing workflow' 
        });
    }
});

module.exports = router;

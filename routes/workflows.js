// routes/workflows.js
// Basic workflow routes - Step 2

const express = require('express');
const router = express.Router();
const workflowService = require('../services/workflowService');

// GET /api/workflows - List workflows
router.get('/', async (req, res) => {
    try {
        const { companyId } = req.query;
        
        if (!companyId) {
            return res.status(400).json({ 
                message: 'Company ID is required' 
            });
        }

        const workflows = await workflowService.getWorkflows(companyId);
        res.json(workflows);
    } catch (error) {
        console.error('[WorkflowRoutes] Error getting workflows:', error);
        res.status(500).json({ 
            message: 'Error fetching workflows' 
        });
    }
});

// GET /api/workflows/company/:companyId - List workflows by company ID (alternative route)
router.get('/company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!companyId) {
            return res.status(400).json({ 
                message: 'Company ID is required' 
            });
        }

        const workflows = await workflowService.getWorkflows(companyId);
        res.json(workflows);
    } catch (error) {
        console.error('[WorkflowRoutes] Error getting workflows:', error);
        res.status(500).json({ 
            message: 'Error fetching workflows' 
        });
    }
});

// GET /api/workflows/:id - Get single workflow
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const workflow = await workflowService.getWorkflow(id);
        
        if (!workflow) {
            return res.status(404).json({ 
                message: 'Workflow not found' 
            });
        }
        
        res.json(workflow);
    } catch (error) {
        console.error('[WorkflowRoutes] Error getting workflow:', error);
        res.status(500).json({ 
            message: 'Error fetching workflow' 
        });
    }
});

// DELETE /api/workflows/:id - Delete workflow
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await workflowService.deleteWorkflow(id);
        res.json({ message: 'Workflow deleted successfully' });
    } catch (error) {
        console.error('[WorkflowRoutes] Error deleting workflow:', error);
        res.status(500).json({ 
            message: 'Error deleting workflow' 
        });
    }
});

// POST /api/workflows - Create workflow
router.post('/', async (req, res) => {
    try {
        const workflowData = req.body;
        
        if (!workflowData.name) {
            return res.status(400).json({ 
                message: 'Workflow name is required' 
            });
        }

        const workflow = await workflowService.createWorkflow(workflowData);
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
        const workflowData = req.body;
        
        const workflow = await workflowService.updateWorkflow(id, workflowData);
        
        if (!workflow) {
            return res.status(404).json({ 
                message: 'Workflow not found' 
            });
        }
        
        res.json(workflow);
    } catch (error) {
        console.error('[WorkflowRoutes] Error updating workflow:', error);
        res.status(500).json({ 
            message: 'Error updating workflow' 
        });
    }
});

module.exports = router;

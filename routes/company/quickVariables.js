const express = require('express');
const router = express.Router();
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// GET all quick variables for a company
router.get('/:companyId/quick-variables', authenticateJWT, async (req, res) => {
    try {
        const company = await v2Company.findById(req.params.companyId).select('quickVariables').lean();
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        res.json({
            success: true,
            data: company.quickVariables || []
        });
    } catch (error) {
        console.error('Error loading quick variables:', error);
        res.status(500).json({ success: false, message: 'Failed to load variables' });
    }
});

// POST create new quick variable
router.post('/:companyId/quick-variables', authenticateJWT, async (req, res) => {
    try {
        const { name, value } = req.body;
        
        if (!name || !value) {
            return res.status(400).json({ success: false, message: 'Name and value required' });
        }
        
        const company = await v2Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        if (!company.quickVariables) {
            company.quickVariables = [];
        }
        
        // Check duplicate
        const exists = company.quickVariables.find(v => v.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            return res.status(409).json({ success: false, message: 'Variable name already exists' });
        }
        
        const newVar = {
            id: uuidv4(),
            name: name.trim(),
            value: value.trim(),
            createdAt: new Date()
        };
        
        company.quickVariables.push(newVar);
        await company.save();
        
        res.status(201).json({
            success: true,
            message: 'Variable created',
            data: newVar
        });
    } catch (error) {
        console.error('Error creating quick variable:', error);
        res.status(500).json({ success: false, message: 'Failed to create variable' });
    }
});

// DELETE quick variable
router.delete('/:companyId/quick-variables/:id', authenticateJWT, async (req, res) => {
    try {
        const company = await v2Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        const before = company.quickVariables?.length || 0;
        company.quickVariables = company.quickVariables?.filter(v => v.id !== req.params.id) || [];
        
        if (company.quickVariables.length === before) {
            return res.status(404).json({ success: false, message: 'Variable not found' });
        }
        
        await company.save();
        
        res.json({
            success: true,
            message: 'Variable deleted'
        });
    } catch (error) {
        console.error('Error deleting quick variable:', error);
        res.status(500).json({ success: false, message: 'Failed to delete variable' });
    }
});

module.exports = router;


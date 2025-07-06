const express = require('express');
const router = express.Router();
const Company = require('../models/Company');
const { validateCompany } = require('../middleware/validate');

// Get all companies
router.get('/companies', async (req, res) => {
    try {
        const companies = await Company.find({}).sort({ createdAt: -1 });
        res.json({
            success: true,
            data: companies,
            count: companies.length
        });
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch companies'
        });
    }
});

// Get company by ID
router.get('/companies/:id', async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        res.json({
            success: true,
            data: company
        });
    } catch (error) {
        console.error('Error fetching company:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch company'
        });
    }
});

// Create new company
router.post('/companies', validateCompany, async (req, res) => {
    try {
        const company = new Company(req.body);
        const savedCompany = await company.save();
        res.status(201).json({
            success: true,
            data: savedCompany
        });
    } catch (error) {
        console.error('Error creating company:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create company'
        });
    }
});

// Update company
router.put('/companies/:id', validateCompany, async (req, res) => {
    try {
        const company = await Company.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        res.json({
            success: true,
            data: company
        });
    } catch (error) {
        console.error('Error updating company:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update company'
        });
    }
});

// Delete company
router.delete('/companies/:id', async (req, res) => {
    try {
        const company = await Company.findByIdAndDelete(req.params.id);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        res.json({
            success: true,
            message: 'Company deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting company:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete company'
        });
    }
});

// Get company stats
router.get('/companies/:id/stats', async (req, res) => {
    try {
        const company = await Company.findById(req.params.id);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }

        // Calculate stats - you can expand this based on your needs
        const stats = {
            totalCalls: company.totalCalls || 0,
            totalCallMinutes: company.totalCallMinutes || 0,
            knowledgeEntries: company.knowledgeEntries ? company.knowledgeEntries.length : 0,
            isActive: company.isActive || false,
            lastActivity: company.lastActivity || null
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching company stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch company stats'
        });
    }
});

module.exports = router;

/**
 * ============================================================================
 * GLOBAL INDUSTRY TYPES API ROUTES
 * ============================================================================
 * 
 * Admin-only routes for managing industry types
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-industry-types           - List all industries
 * - GET    /api/admin/global-industry-types/active    - List active industries
 * - POST   /api/admin/global-industry-types           - Create new industry
 * - PUT    /api/admin/global-industry-types/:id       - Update industry
 * - DELETE /api/admin/global-industry-types/:id       - Delete industry
 * - POST   /api/admin/global-industry-types/seed      - Seed default industries
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalIndustryType = require('../../models/GlobalIndustryType');

// GET all industry types
router.get('/', async (req, res) => {
    try {
        const industries = await GlobalIndustryType.find()
            .sort({ sortOrder: 1, name: 1 })
            .lean();
        
        res.json({
            success: true,
            count: industries.length,
            data: industries
        });
    } catch (error) {
        console.error('❌ Error fetching industry types:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch industry types',
            error: error.message
        });
    }
});

// GET active industry types only
router.get('/active', async (req, res) => {
    try {
        const industries = await GlobalIndustryType.getActiveIndustries();
        
        res.json({
            success: true,
            count: industries.length,
            data: industries
        });
    } catch (error) {
        console.error('❌ Error fetching active industries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch active industries',
            error: error.message
        });
    }
});

// POST create new industry type
router.post('/', async (req, res) => {
    try {
        const { industryId, name, displayLabel, icon, description, color, sortOrder, isActive } = req.body;
        
        // Validate required fields
        if (!industryId || !name || !displayLabel) {
            return res.status(400).json({
                success: false,
                message: 'industryId, name, and displayLabel are required'
            });
        }
        
        // Check if industry ID already exists
        const existing = await GlobalIndustryType.findOne({ industryId: industryId.toLowerCase() });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Industry ID already exists'
            });
        }
        
        const newIndustry = new GlobalIndustryType({
            industryId: industryId.toLowerCase(),
            name,
            displayLabel,
            icon: icon || '🏢',
            description,
            color: color || 'blue',
            sortOrder: sortOrder !== undefined ? sortOrder : 999,
            isActive: isActive !== undefined ? isActive : true,
            createdBy: 'Admin',
            isSystemDefault: false
        });
        
        await newIndustry.save();
        
        console.log(`✅ Created industry type: ${name}`);
        
        res.status(201).json({
            success: true,
            message: 'Industry type created successfully',
            data: newIndustry
        });
    } catch (error) {
        console.error('❌ Error creating industry type:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create industry type',
            error: error.message
        });
    }
});

// PUT update industry type
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, displayLabel, icon, description, color, sortOrder, isActive } = req.body;
        
        const industry = await GlobalIndustryType.findById(id);
        
        if (!industry) {
            return res.status(404).json({
                success: false,
                message: 'Industry type not found'
            });
        }
        
        // Update fields
        if (name) industry.name = name;
        if (displayLabel) industry.displayLabel = displayLabel;
        if (icon) industry.icon = icon;
        if (description !== undefined) industry.description = description;
        if (color) industry.color = color;
        if (sortOrder !== undefined) industry.sortOrder = sortOrder;
        if (isActive !== undefined) industry.isActive = isActive;
        industry.lastModifiedBy = 'Admin';
        
        await industry.save();
        
        console.log(`✅ Updated industry type: ${industry.name}`);
        
        res.json({
            success: true,
            message: 'Industry type updated successfully',
            data: industry
        });
    } catch (error) {
        console.error('❌ Error updating industry type:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update industry type',
            error: error.message
        });
    }
});

// DELETE industry type
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const industry = await GlobalIndustryType.findById(id);
        
        if (!industry) {
            return res.status(404).json({
                success: false,
                message: 'Industry type not found'
            });
        }
        
        // Prevent deletion of system defaults
        if (industry.isSystemDefault) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete system default industry types'
            });
        }
        
        await GlobalIndustryType.findByIdAndDelete(id);
        
        console.log(`✅ Deleted industry type: ${industry.name}`);
        
        res.json({
            success: true,
            message: 'Industry type deleted successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting industry type:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete industry type',
            error: error.message
        });
    }
});

// POST seed default industries
router.post('/seed', async (req, res) => {
    try {
        const existingCount = await GlobalIndustryType.countDocuments();
        
        if (existingCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Database already contains ${existingCount} industry types. Clear them first or use update endpoints.`
            });
        }
        
        const defaultIndustries = [
            {
                industryId: 'universal',
                name: 'Universal',
                displayLabel: 'Universal (All Industries)',
                icon: '🌐',
                description: 'General-purpose template suitable for all industries',
                color: 'blue',
                sortOrder: 1,
                isSystemDefault: true
            },
            {
                industryId: 'healthcare',
                name: 'Healthcare',
                displayLabel: 'Healthcare & Medical',
                icon: '🏥',
                description: 'Doctors, dentists, clinics, medical practices',
                color: 'red',
                sortOrder: 2,
                isSystemDefault: true
            },
            {
                industryId: 'homeservices',
                name: 'Home Services',
                displayLabel: 'Home Services',
                icon: '🔧',
                description: 'HVAC, plumbing, electrical, general contractors',
                color: 'orange',
                sortOrder: 3,
                isSystemDefault: true
            },
            {
                industryId: 'retail',
                name: 'Retail',
                displayLabel: 'Retail & E-commerce',
                icon: '🛍️',
                description: 'Stores, shops, online retail, e-commerce',
                color: 'green',
                sortOrder: 4,
                isSystemDefault: true
            },
            {
                industryId: 'professional',
                name: 'Professional Services',
                displayLabel: 'Professional Services',
                icon: '💼',
                description: 'Law firms, accounting, consulting, business services',
                color: 'purple',
                sortOrder: 5,
                isSystemDefault: true
            },
            {
                industryId: 'custom',
                name: 'Custom',
                displayLabel: 'Custom (Build from Scratch)',
                icon: '⚙️',
                description: 'Create a custom industry-specific template',
                color: 'gray',
                sortOrder: 99,
                isSystemDefault: true
            }
        ];
        
        await GlobalIndustryType.insertMany(defaultIndustries);
        
        console.log(`✅ Seeded ${defaultIndustries.length} default industry types`);
        
        res.status(201).json({
            success: true,
            message: `Successfully seeded ${defaultIndustries.length} default industry types`,
            count: defaultIndustries.length
        });
    } catch (error) {
        console.error('❌ Error seeding industry types:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to seed industry types',
            error: error.message
        });
    }
});

module.exports = router;


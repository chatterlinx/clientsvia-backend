/**
 * ============================================================================
 * ADMIN GLOBAL ACTION HOOK CATEGORIES API
 * ============================================================================
 * 
 * PURPOSE:
 * Admin-only API for managing action hook categories that organize hooks
 * into logical groups (Escalation, Scheduling, Communication, etc.)
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-action-hook-categories           - List all categories
 * - GET    /api/admin/global-action-hook-categories/:id       - Get specific category
 * - POST   /api/admin/global-action-hook-categories           - Create new category
 * - PUT    /api/admin/global-action-hook-categories/:id       - Update category
 * - DELETE /api/admin/global-action-hook-categories/:id       - Delete category
 * - POST   /api/admin/global-action-hook-categories/seed      - Seed default categories
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalActionHookCategory = require('../../models/GlobalActionHookCategory');

// ============================================================================
// GET ROUTES - READ OPERATIONS
// ============================================================================

/**
 * GET /api/admin/global-action-hook-categories
 * List all action hook categories
 */
router.get('/', async (req, res) => {
    try {
        const categories = await GlobalActionHookCategory.getActiveCategories();
        res.json({
            success: true,
            count: categories.length,
            data: categories
        });
    } catch (error) {
        console.error('Error fetching action hook categories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hook categories',
            error: error.message
        });
    }
});

/**
 * GET /api/admin/global-action-hook-categories/:id
 * Get a specific action hook category by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const category = await GlobalActionHookCategory.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Action hook category not found'
            });
        }
        res.json({
            success: true,
            data: category
        });
    } catch (error) {
        console.error('Error fetching action hook category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hook category',
            error: error.message
        });
    }
});

// ============================================================================
// POST ROUTES - CREATE OPERATIONS
// ============================================================================

/**
 * POST /api/admin/global-action-hook-categories
 * Create a new action hook category
 */
router.post('/', async (req, res) => {
    try {
        const { categoryId, name, icon, description, color, sortOrder } = req.body;
        
        // Check if category ID already exists
        const existing = await GlobalActionHookCategory.findOne({ categoryId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Category ID already exists'
            });
        }
        
        const newCategory = new GlobalActionHookCategory({
            categoryId,
            name,
            icon: icon || '⚡',
            description: description || '',
            color: color || 'gray',
            sortOrder: sortOrder || 999,
            isActive: true,
            isSystemDefault: false,
            createdBy: 'Admin'
        });
        
        await newCategory.save();
        
        res.status(201).json({
            success: true,
            message: 'Action hook category created successfully',
            data: newCategory
        });
    } catch (error) {
        console.error('Error creating action hook category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create action hook category',
            error: error.message
        });
    }
});

// ============================================================================
// PUT ROUTES - UPDATE OPERATIONS
// ============================================================================

/**
 * PUT /api/admin/global-action-hook-categories/:id
 * Update an existing action hook category
 */
router.put('/:id', async (req, res) => {
    try {
        const category = await GlobalActionHookCategory.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Action hook category not found'
            });
        }
        
        const { name, icon, description, color, sortOrder, isActive } = req.body;
        
        if (name) category.name = name;
        if (icon) category.icon = icon;
        if (description !== undefined) category.description = description;
        if (color) category.color = color;
        if (sortOrder !== undefined) category.sortOrder = sortOrder;
        if (isActive !== undefined) category.isActive = isActive;
        
        category.lastModifiedBy = 'Admin';
        
        await category.save();
        
        res.json({
            success: true,
            message: 'Action hook category updated successfully',
            data: category
        });
    } catch (error) {
        console.error('Error updating action hook category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update action hook category',
            error: error.message
        });
    }
});

// ============================================================================
// DELETE ROUTES - DELETE OPERATIONS
// ============================================================================

/**
 * DELETE /api/admin/global-action-hook-categories/:id
 * Delete an action hook category
 */
router.delete('/:id', async (req, res) => {
    try {
        const category = await GlobalActionHookCategory.findById(req.params.id);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Action hook category not found'
            });
        }
        
        if (category.isSystemDefault) {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete system default categories'
            });
        }
        
        await GlobalActionHookCategory.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Action hook category deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting action hook category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete action hook category',
            error: error.message
        });
    }
});

// ============================================================================
// SEED ROUTE - POPULATE DEFAULT CATEGORIES
// ============================================================================

/**
 * POST /api/admin/global-action-hook-categories/seed
 * Seed default action hook categories
 */
router.post('/seed', async (req, res) => {
    try {
        const existingCount = await GlobalActionHookCategory.countDocuments();
        if (existingCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Database already contains ${existingCount} categories. Clear them first or use update endpoints.`
            });
        }
        
        const defaultCategories = [
            { categoryId: 'escalation', name: 'Escalation', icon: '🚨', description: 'Transfer to human or manager when AI cannot help', color: 'red', sortOrder: 1, isSystemDefault: true },
            { categoryId: 'scheduling', name: 'Scheduling', icon: '📅', description: 'Appointment booking, rescheduling, cancellation', color: 'blue', sortOrder: 2, isSystemDefault: true },
            { categoryId: 'communication', name: 'Communication', icon: '💬', description: 'SMS, email, callback, information sharing', color: 'green', sortOrder: 3, isSystemDefault: true },
            { categoryId: 'payment', name: 'Payment', icon: '💳', description: 'Payment links, invoices, billing', color: 'purple', sortOrder: 4, isSystemDefault: true },
            { categoryId: 'information', name: 'Information', icon: '🔍', description: 'Quotes, availability checks, data lookup', color: 'cyan', sortOrder: 5, isSystemDefault: true },
            { categoryId: 'call_flow', name: 'Call Flow', icon: '📞', description: 'Hold, transfer, call control actions', color: 'indigo', sortOrder: 6, isSystemDefault: true },
            { categoryId: 'system', name: 'System', icon: '⚙️', description: 'System-level actions and triggers', color: 'gray', sortOrder: 7, isSystemDefault: true }
        ];
        
        await GlobalActionHookCategory.insertMany(defaultCategories);
        
        res.status(201).json({
            success: true,
            message: `Successfully seeded ${defaultCategories.length} default action hook categories`,
            count: defaultCategories.length
        });
    } catch (error) {
        console.error('Error seeding action hook categories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to seed action hook categories',
            error: error.message
        });
    }
});

module.exports = router;


/**
 * ============================================================================
 * ADMIN GLOBAL ACTION HOOK DIRECTORIES API
 * ============================================================================
 * 
 * PURPOSE:
 * Admin-only API for managing action hook directories that organize hooks
 * into logical groups (Escalation, Scheduling, Communication, etc.)
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-action-hook-directories           - List all directories
 * - GET    /api/admin/global-action-hook-directories/:id       - Get specific directory
 * - POST   /api/admin/global-action-hook-directories           - Create new directory
 * - PUT    /api/admin/global-action-hook-directories/:id       - Update directory
 * - DELETE /api/admin/global-action-hook-directories/:id       - Delete directory
 * - POST   /api/admin/global-action-hook-directories/seed      - Seed default directories
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const GlobalActionHookDirectory = require('../../models/GlobalActionHookDirectory');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication
router.use(authenticateJWT);
router.use(requireRole('admin'));

// ============================================================================
// GET ROUTES - READ OPERATIONS
// ============================================================================

/**
 * GET /api/admin/global-action-hook-directories
 * List all action hook directories (including inactive for admin management)
 */
router.get('/', async (req, res) => {
    try {
        // Get ALL directories (not just active) so admins can manage inactive ones
        const directories = await GlobalActionHookDirectory.find()
            .sort({ sortOrder: 1, name: 1 })
            .lean();
        res.json({
            success: true,
            count: directories.length,
            data: directories
        });
    } catch (error) {
        logger.error('Error fetching action hook directories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hook directories',
            error: error.message
        });
    }
});

/**
 * GET /api/admin/global-action-hook-directories/:id
 * Get a specific action hook directory by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const directory = await GlobalActionHookDirectory.findById(req.params.id);
        if (!directory) {
            return res.status(404).json({
                success: false,
                message: 'Action hook directory not found'
            });
        }
        res.json({
            success: true,
            data: directory
        });
    } catch (error) {
        logger.error('Error fetching action hook directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch action hook directory',
            error: error.message
        });
    }
});

// ============================================================================
// POST ROUTES - CREATE OPERATIONS
// ============================================================================

/**
 * POST /api/admin/global-action-hook-directories
 * Create a new action hook directory
 */
router.post('/', async (req, res) => {
    try {
        const { directoryId, name, icon, description, color, sortOrder } = req.body;
        
        // Check if directory ID already exists
        const existing = await GlobalActionHookDirectory.findOne({ directoryId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Directory ID already exists'
            });
        }
        
        const newDirectory = new GlobalActionHookDirectory({
            directoryId,
            name,
            icon: icon || '⚡',
            description: description || '',
            color: color || 'gray',
            sortOrder: sortOrder || 999,
            isActive: true,
            isSystemDefault: false,
            createdBy: 'Admin'
        });
        
        await newDirectory.save();
        
        res.status(201).json({
            success: true,
            message: 'Action hook directory created successfully',
            data: newDirectory
        });
    } catch (error) {
        logger.error('Error creating action hook directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create action hook directory',
            error: error.message
        });
    }
});

// ============================================================================
// PUT ROUTES - UPDATE OPERATIONS
// ============================================================================

/**
 * PUT /api/admin/global-action-hook-directories/:id
 * Update an existing action hook directory
 */
router.put('/:id', async (req, res) => {
    try {
        const directory = await GlobalActionHookDirectory.findById(req.params.id);
        if (!directory) {
            return res.status(404).json({
                success: false,
                message: 'Action hook directory not found'
            });
        }
        
        const { name, icon, description, color, sortOrder, isActive } = req.body;
        
        if (name) {directory.name = name;}
        if (icon) {directory.icon = icon;}
        if (description !== undefined) {directory.description = description;}
        if (color) {directory.color = color;}
        if (sortOrder !== undefined) {directory.sortOrder = sortOrder;}
        if (isActive !== undefined) {directory.isActive = isActive;}
        
        directory.lastModifiedBy = 'Admin';
        
        await directory.save();
        
        res.json({
            success: true,
            message: 'Action hook directory updated successfully',
            data: directory
        });
    } catch (error) {
        logger.error('Error updating action hook directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update action hook directory',
            error: error.message
        });
    }
});

// ============================================================================
// DELETE ROUTES - DELETE OPERATIONS
// ============================================================================

/**
 * DELETE /api/admin/global-action-hook-directories/:id
 * Delete an action hook directory
 */
router.delete('/:id', async (req, res) => {
    try {
        const directory = await GlobalActionHookDirectory.findById(req.params.id);
        if (!directory) {
            return res.status(404).json({
                success: false,
                message: 'Action hook directory not found'
            });
        }
        
        if (directory.isSystemDefault) {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete system default directories'
            });
        }
        
        await GlobalActionHookDirectory.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Action hook directory deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting action hook directory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete action hook directory',
            error: error.message
        });
    }
});

// ============================================================================
// SEED ROUTE - POPULATE DEFAULT DIRECTORIES
// ============================================================================

/**
 * POST /api/admin/global-action-hook-directories/seed
 * Seed default action hook directories
 */
router.post('/seed', async (req, res) => {
    try {
        const existingCount = await GlobalActionHookDirectory.countDocuments();
        if (existingCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Database already contains ${existingCount} directories. Clear them first or use update endpoints.`
            });
        }
        
        const defaultDirectories = [
            { directoryId: 'escalation', name: 'Escalation', icon: '🚨', description: 'Transfer to human or manager when AI cannot help', color: 'red', sortOrder: 1, isSystemDefault: true },
            { directoryId: 'scheduling', name: 'Scheduling', icon: '📅', description: 'Appointment booking, rescheduling, cancellation', color: 'blue', sortOrder: 2, isSystemDefault: true },
            { directoryId: 'communication', name: 'Communication', icon: '💬', description: 'SMS, email, callback, information sharing', color: 'green', sortOrder: 3, isSystemDefault: true },
            { directoryId: 'payment', name: 'Payment', icon: '💳', description: 'Payment links, invoices, billing', color: 'purple', sortOrder: 4, isSystemDefault: true },
            { directoryId: 'information', name: 'Information', icon: '🔍', description: 'Quotes, availability checks, data lookup', color: 'cyan', sortOrder: 5, isSystemDefault: true },
            { directoryId: 'call_flow', name: 'Call Flow', icon: '📞', description: 'Hold, transfer, call control actions', color: 'indigo', sortOrder: 6, isSystemDefault: true },
            { directoryId: 'system', name: 'System', icon: '⚙️', description: 'System-level actions and triggers', color: 'gray', sortOrder: 7, isSystemDefault: true }
        ];
        
        await GlobalActionHookDirectory.insertMany(defaultDirectories);
        
        res.status(201).json({
            success: true,
            message: `Successfully seeded ${defaultDirectories.length} default action hook directories`,
            count: defaultDirectories.length
        });
    } catch (error) {
        logger.error('Error seeding action hook directories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to seed action hook directories',
            error: error.message
        });
    }
});

module.exports = router;

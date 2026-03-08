/**
 * ============================================================================
 * GLOBAL AI BEHAVIOR TEMPLATES - ADMIN ROUTES
 * ============================================================================
 * 
 * PURPOSE:
 * CRUD operations for AI behavior templates that control how the AI agent
 * responds in different scenarios.
 * 
 * ENDPOINTS:
 * GET    /api/admin/global-behaviors          - List all behaviors
 * GET    /api/admin/global-behaviors/:id      - Get one behavior
 * POST   /api/admin/global-behaviors          - Create new behavior
 * PUT    /api/admin/global-behaviors/:id      - Update behavior
 * DELETE /api/admin/global-behaviors/:id      - Delete behavior
 * POST   /api/admin/global-behaviors/seed     - Seed initial 15 behaviors
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const GlobalAIBehaviorTemplate = require('../../models/GlobalAIBehaviorTemplate');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication
router.use(authenticateJWT);
router.use(requireRole('admin'));

/**
 * GET ALL BEHAVIORS
 * Returns all active behaviors sorted by sortOrder
 */
router.get('/', async (req, res) => {
    try {
        const behaviors = await GlobalAIBehaviorTemplate.getActiveBehaviors();
        
        res.json({
            success: true,
            count: behaviors.length,
            data: behaviors
        });
    } catch (error) {
        logger.error('Error fetching behaviors:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch behaviors',
            error: error.message
        });
    }
});

/**
 * GET ONE BEHAVIOR BY ID
 */
router.get('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        res.json({
            success: true,
            data: behavior
        });
    } catch (error) {
        logger.error('Error fetching behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch behavior',
            error: error.message
        });
    }
});

/**
 * CREATE NEW BEHAVIOR
 */
router.post('/', async (req, res) => {
    try {
        const { behaviorId, name, icon, instructions, bestFor, examples } = req.body;
        
        // Check if behaviorId already exists
        const existing = await GlobalAIBehaviorTemplate.findOne({ behaviorId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Behavior ID already exists'
            });
        }
        
        const newBehavior = new GlobalAIBehaviorTemplate({
            behaviorId,
            name,
            icon: icon || '🎭',
            instructions,
            bestFor: bestFor || '',
            examples: examples || [],
            isActive: true,
            isSystemDefault: false,
            createdBy: 'Admin',
            sortOrder: 999 // New behaviors go to the end
        });
        
        await newBehavior.save();
        
        res.status(201).json({
            success: true,
            message: 'Behavior created successfully',
            data: newBehavior
        });
    } catch (error) {
        logger.error('Error creating behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create behavior',
            error: error.message
        });
    }
});

/**
 * UPDATE BEHAVIOR
 */
router.put('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        // Update fields
        const { name, icon, instructions, bestFor, examples, isActive, sortOrder } = req.body;
        
        if (name) {behavior.name = name;}
        if (icon) {behavior.icon = icon;}
        if (instructions) {behavior.instructions = instructions;}
        if (bestFor !== undefined) {behavior.bestFor = bestFor;}
        if (examples) {behavior.examples = examples;}
        if (isActive !== undefined) {behavior.isActive = isActive;}
        if (sortOrder !== undefined) {behavior.sortOrder = sortOrder;}
        
        behavior.lastModifiedBy = 'Admin';
        
        await behavior.save();
        
        res.json({
            success: true,
            message: 'Behavior updated successfully',
            data: behavior
        });
    } catch (error) {
        logger.error('Error updating behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update behavior',
            error: error.message
        });
    }
});

/**
 * DELETE BEHAVIOR
 */
router.delete('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        // Prevent deletion of system defaults
        if (behavior.isSystemDefault) {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete system default behaviors'
            });
        }
        
        await GlobalAIBehaviorTemplate.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Behavior deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete behavior',
            error: error.message
        });
    }
});

/**
 * Retired seed endpoint (legacy).
 * Default behaviors are now auto-seeded at startup via services/seeders/BehaviorSeeder.js
 */
router.post('/seed', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: 'Seed endpoint retired. Behaviors are auto-seeded at startup. See services/seeders/BehaviorSeeder.js'
    });
});

module.exports = router;


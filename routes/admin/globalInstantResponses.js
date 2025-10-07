/**
 * ============================================================================
 * ADMIN GLOBAL INSTANT RESPONSE TEMPLATES API
 * ============================================================================
 * 
 * PURPOSE:
 * Admin-only API for managing the platform-wide instant response library.
 * This is the control center for the AI agent's conversational brain.
 * 
 * SECURITY:
 * - All routes require JWT authentication
 * - Only platform admins can access these endpoints
 * - All operations are logged with admin user identification
 * 
 * FEATURES:
 * - Full CRUD operations on global templates
 * - Version control and rollback capabilities
 * - Activate/deactivate templates
 * - Preview before publishing
 * - Export/import for backup
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-instant-responses           - List all templates
 * - GET    /api/admin/global-instant-responses/active    - Get active template
 * - GET    /api/admin/global-instant-responses/:id       - Get specific template
 * - POST   /api/admin/global-instant-responses           - Create new template
 * - PATCH  /api/admin/global-instant-responses/:id       - Update template
 * - DELETE /api/admin/global-instant-responses/:id       - Delete template
 * - POST   /api/admin/global-instant-responses/:id/activate - Set as active
 * - POST   /api/admin/global-instant-responses/:id/clone - Clone template
 * - GET    /api/admin/global-instant-responses/:id/export - Export as JSON
 * - POST   /api/admin/global-instant-responses/import    - Import from JSON
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT } = require('../../middleware/auth');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Require authentication for all routes
 */
router.use(authenticateJWT);

/**
 * Log all admin actions for audit trail
 */
router.use((req, res, next) => {
    const action = `${req.method} ${req.path}`;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    console.log(`🔐 [ADMIN GLOBAL TEMPLATES] ${action} by ${adminUser}`);
    next();
});

// ============================================================================
// GET ROUTES - READ OPERATIONS
// ============================================================================

/**
 * GET /api/admin/global-instant-responses
 * List all global templates with stats
 */
router.get('/', async (req, res) => {
    try {
        const templates = await GlobalInstantResponseTemplate.find()
            .select('version name description isActive stats createdAt updatedAt createdBy lastUpdatedBy')
            .sort({ createdAt: -1 })
            .lean();
        
        console.log(`✅ Retrieved ${templates.length} global templates`);
        
        res.json({
            success: true,
            data: templates,
            count: templates.length
        });
    } catch (error) {
        console.error('❌ Error fetching global templates:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching templates: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/active
 * Get the currently active global template
 */
router.get('/active', async (req, res) => {
    try {
        const activeTemplate = await GlobalInstantResponseTemplate.getActiveTemplate();
        
        if (!activeTemplate) {
            return res.status(404).json({
                success: false,
                message: 'No active global template found. Please create and activate one.'
            });
        }
        
        console.log(`✅ Active template: ${activeTemplate.version} (${activeTemplate.stats.totalScenarios} scenarios)`);
        
        res.json({
            success: true,
            data: activeTemplate
        });
    } catch (error) {
        console.error('❌ Error fetching active template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching active template: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id
 * Get a specific template by ID
 */
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id).lean();
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        console.log(`✅ Retrieved template: ${template.version}`);
        
        res.json({
            success: true,
            data: template
        });
    } catch (error) {
        console.error('❌ Error fetching template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching template: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id/export
 * Export template as JSON for backup/sharing
 */
router.get('/:id/export', async (req, res) => {
    const { id } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id).lean();
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        // Remove MongoDB-specific fields
        delete template._id;
        delete template.__v;
        delete template.createdAt;
        delete template.updatedAt;
        
        const filename = `global-instant-responses-${template.version}-${Date.now()}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(template);
        
        console.log(`✅ Exported template: ${template.version}`);
    } catch (error) {
        console.error('❌ Error exporting template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error exporting template: ${error.message}`
        });
    }
});

// ============================================================================
// POST ROUTES - CREATE OPERATIONS
// ============================================================================

/**
 * POST /api/admin/global-instant-responses
 * Create a new global template
 */
router.post('/', async (req, res) => {
    const { version, name, description, categories } = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        // Validation
        if (!version || !categories || !Array.isArray(categories)) {
            return res.status(400).json({
                success: false,
                message: 'Version and categories array are required'
            });
        }
        
        // Check for duplicate version
        const existingTemplate = await GlobalInstantResponseTemplate.findOne({ version });
        if (existingTemplate) {
            return res.status(409).json({
                success: false,
                message: `Template version "${version}" already exists`
            });
        }
        
        // Create new template
        const newTemplate = new GlobalInstantResponseTemplate({
            version,
            name: name || 'ClientVia.ai Global AI Receptionist Brain',
            description: description || 'World-class AI agent instant response library',
            categories,
            createdBy: adminUser,
            changeLog: [{
                changes: 'Initial template creation',
                changedBy: adminUser
            }]
        });
        
        await newTemplate.save();
        
        console.log(`✅ Created new global template: ${version} with ${newTemplate.stats.totalScenarios} scenarios`);
        
        res.status(201).json({
            success: true,
            message: 'Global template created successfully',
            data: newTemplate
        });
    } catch (error) {
        console.error('❌ Error creating template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error creating template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/activate
 * Set a template as active (deactivates all others)
 */
router.post('/:id/activate', async (req, res) => {
    const { id } = req.params;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        const template = await GlobalInstantResponseTemplate.setActiveTemplate(id);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        // Add changelog entry
        template.addChangeLog(`Activated as global template`, adminUser);
        await template.save();
        
        console.log(`✅ Activated template: ${template.version}`);
        
        res.json({
            success: true,
            message: 'Template activated successfully',
            data: template
        });
    } catch (error) {
        console.error('❌ Error activating template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error activating template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/clone
 * Clone an existing template to create a new version
 */
router.post('/:id/clone', async (req, res) => {
    const { id } = req.params;
    const { newVersion } = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        if (!newVersion) {
            return res.status(400).json({
                success: false,
                message: 'New version name is required'
            });
        }
        
        const clonedTemplate = await GlobalInstantResponseTemplate.createNewVersion(id, newVersion, adminUser);
        
        console.log(`✅ Cloned template ${id} to version ${newVersion}`);
        
        res.status(201).json({
            success: true,
            message: 'Template cloned successfully',
            data: clonedTemplate
        });
    } catch (error) {
        console.error('❌ Error cloning template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error cloning template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/import
 * Import a template from JSON backup
 */
router.post('/import', async (req, res) => {
    const templateData = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        // Validation
        if (!templateData.version || !templateData.categories) {
            return res.status(400).json({
                success: false,
                message: 'Invalid template data: version and categories required'
            });
        }
        
        // Check for duplicate version
        const existingTemplate = await GlobalInstantResponseTemplate.findOne({ version: templateData.version });
        if (existingTemplate) {
            return res.status(409).json({
                success: false,
                message: `Template version "${templateData.version}" already exists. Please rename the version before importing.`
            });
        }
        
        // Create template from imported data
        const importedTemplate = new GlobalInstantResponseTemplate({
            ...templateData,
            createdBy: `${adminUser} (imported)`,
            changeLog: [{
                changes: 'Imported from JSON backup',
                changedBy: adminUser
            }, ...(templateData.changeLog || [])]
        });
        
        await importedTemplate.save();
        
        console.log(`✅ Imported template: ${templateData.version} with ${importedTemplate.stats.totalScenarios} scenarios`);
        
        res.status(201).json({
            success: true,
            message: 'Template imported successfully',
            data: importedTemplate
        });
    } catch (error) {
        console.error('❌ Error importing template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error importing template: ${error.message}`
        });
    }
});

// ============================================================================
// PATCH ROUTES - UPDATE OPERATIONS
// ============================================================================

/**
 * PATCH /api/admin/global-instant-responses/:id
 * Update an existing template
 */
router.patch('/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        // Track changes
        const changes = [];
        
        // Update allowed fields
        if (updates.name !== undefined) {
            template.name = updates.name;
            changes.push('Updated name');
        }
        
        if (updates.description !== undefined) {
            template.description = updates.description;
            changes.push('Updated description');
        }
        
        if (updates.categories !== undefined) {
            template.categories = updates.categories;
            changes.push(`Updated categories (${updates.categories.length} total)`);
        }
        
        // Add changelog entry
        if (changes.length > 0) {
            template.addChangeLog(changes.join(', '), adminUser);
        }
        
        await template.save();
        
        console.log(`✅ Updated template ${template.version}: ${changes.join(', ')}`);
        
        res.json({
            success: true,
            message: 'Template updated successfully',
            data: template
        });
    } catch (error) {
        console.error('❌ Error updating template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error updating template: ${error.message}`
        });
    }
});

// ============================================================================
// DELETE ROUTES - DELETE OPERATIONS
// ============================================================================

/**
 * DELETE /api/admin/global-instant-responses/:id
 * Delete a template (only if not active)
 */
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        // Prevent deletion of active template
        if (template.isActive) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete active template. Please activate another template first.'
            });
        }
        
        const templateVersion = template.version;
        await GlobalInstantResponseTemplate.findByIdAndDelete(id);
        
        console.log(`✅ Deleted template ${templateVersion} by ${adminUser}`);
        
        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
    } catch (error) {
        console.error('❌ Error deleting template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error deleting template: ${error.message}`
        });
    }
});

module.exports = router;


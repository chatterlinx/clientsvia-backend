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
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const CacheHelper = require('../../utils/cacheHelper');
const { enhanceTemplate } = require('../../services/globalAIBrainEnhancer');

// Middleware alias for consistency
const adminOnly = requireRole('admin');
const logger = require('../../utils/logger');
const PlaceholderScanService = require('../../services/PlaceholderScanService');
const IntelligentPatternDetector = require('../../services/IntelligentPatternDetector');
const SuggestionKnowledgeBase = require('../../models/SuggestionKnowledgeBase');
const AdminNotificationService = require('../../services/AdminNotificationService');

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
    logger.info(`🔐 [ADMIN GLOBAL TEMPLATES] ${action} by ${adminUser}`);
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
            .select('version name description templateType industryLabel isActive isPublished isDefaultTemplate stats createdAt updatedAt createdBy lastUpdatedBy lineage')
            .sort({ createdAt: -1 })
            .lean();
        
        logger.debug(`✅ Retrieved ${templates.length} global templates`);
        logger.debug(`   Default template: ${templates.find(t => t.isDefaultTemplate)?.name || 'NONE'}`);
        
        res.json({
            success: true,
            data: templates,
            count: templates.length
        });
    } catch (error) {
        logger.error('❌ Error fetching global templates:', error.message, error.stack);
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
        
        logger.info(`✅ Active template: ${activeTemplate.version} (${activeTemplate.stats.totalScenarios} scenarios)`);
        
        res.json({
            success: true,
            data: activeTemplate
        });
    } catch (error) {
        logger.error('❌ Error fetching active template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching active template: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/published
 * Get all published templates (for selection dropdowns)
 * NOTE: This MUST come BEFORE /:id route to avoid "published" being treated as an ID
 */
router.get('/published', async (req, res) => {
    try {
        const templates = await GlobalInstantResponseTemplate.getPublishedTemplates();
        
        res.json({
            success: true,
            count: templates.length,
            data: templates
        });
    } catch (error) {
        logger.error('❌ Error fetching published templates:', error.message);
        res.status(500).json({
            success: false,
            message: `Error fetching published templates: ${error.message}`
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
        
        logger.debug(`✅ Retrieved template: ${template.version}`);
        
        res.json({
            success: true,
            data: template
        });
    } catch (error) {
        logger.error('❌ Error fetching template:', error.message, error.stack);
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
        
        logger.info(`✅ Exported template: ${template.version}`);
    } catch (error) {
        logger.error('❌ Error exporting template:', error.message, error.stack);
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
        await CacheHelper.invalidateTemplate(newTemplate._id);
        
        logger.info(`✅ Created new global template: ${version} with ${newTemplate.stats.totalScenarios} scenarios`);
        
        res.status(201).json({
            success: true,
            message: 'Global template created successfully',
            data: newTemplate
        });
    } catch (error) {
        logger.error('❌ Error creating template:', error.message, error.stack);
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
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info(`✅ Activated template: ${template.version}`);
        
        res.json({
            success: true,
            message: 'Template activated successfully',
            data: template
        });
    } catch (error) {
        logger.error('❌ Error activating template:', error.message, error.stack);
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
        
        logger.info(`✅ Cloned template ${id} to version ${newVersion}`);
        
        res.status(201).json({
            success: true,
            message: 'Template cloned successfully',
            data: clonedTemplate
        });
    } catch (error) {
        logger.error('❌ Error cloning template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error cloning template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/clone-industry
 * Clone template for a new industry
 */
router.post('/:id/clone-industry', async (req, res) => {
    const { id } = req.params;
    const { version, name, description, templateType, industryLabel, isPublished } = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Platform Admin';
    
    try {
        // Validate required fields
        if (!name || !templateType || !version) {
            return res.status(400).json({
                success: false,
                message: 'Name, version, and templateType are required'
            });
        }
        
        const clonedTemplate = await GlobalInstantResponseTemplate.cloneTemplate(
            id,
            {
                version,
                name,
                description: description || `${name} - Industry-specific AI receptionist brain`,
                templateType,
                industryLabel: industryLabel || name,
                isPublished: isPublished !== undefined ? isPublished : false
            },
            adminUser
        );
        
        logger.info(`✅ Cloned template ${id} for industry ${templateType}`);
        
        res.status(201).json({
            success: true,
            message: `Template cloned successfully for ${templateType}`,
            data: clonedTemplate
        });
    } catch (error) {
        logger.error('❌ Error cloning template for industry:', error.message, error.stack);
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
        await CacheHelper.invalidateTemplate(importedTemplate._id);
        
        logger.info(`✅ Imported template: ${templateData.version} with ${importedTemplate.stats.totalScenarios} scenarios`);
        
        res.status(201).json({
            success: true,
            message: 'Template imported successfully',
            data: importedTemplate
        });
    } catch (error) {
        logger.error('❌ Error importing template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error importing template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/set-default
 * Set a template as the default for new companies
 */
router.post('/:id/set-default', async (req, res) => {
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
        
        // Unset current default
        await GlobalInstantResponseTemplate.updateMany(
            { isDefaultTemplate: true },
            { isDefaultTemplate: false }
        );
        
        // Set new default
        template.isDefaultTemplate = true;
        template.isPublished = true; // Default template must be published
        template.lastUpdatedBy = adminUser;
        
        if (!template.changeLog) {
            template.changeLog = [];
        }
        template.changeLog.push({
            changes: 'Set as default template for new companies',
            changedBy: adminUser,
            date: new Date()
        });
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info(`✅ Set default template: ${template.name} (${template.version}) by ${adminUser}`);
        
        res.json({
            success: true,
            message: `Template "${template.name}" set as default successfully`,
            data: template
        });
    } catch (error) {
        logger.error('❌ Error setting default template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error setting default template: ${error.message}`
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
        
        if (updates.templateType !== undefined) {
            template.templateType = updates.templateType;
            changes.push('Updated template type');
        }
        
        if (updates.industryLabel !== undefined) {
            template.industryLabel = updates.industryLabel;
            changes.push('Updated industry label');
        }
        
        if (updates.isPublished !== undefined) {
            template.isPublished = updates.isPublished;
            changes.push(`Set published: ${updates.isPublished}`);
        }
        
        if (updates.categories !== undefined) {
            template.categories = updates.categories;
            changes.push(`Updated categories (${updates.categories.length} total)`);
        }
        
        // Update Twilio test configuration (direct DB update to skip validation)
        if (updates.twilioTest !== undefined) {
            // Build update object with proper null handling
            const twilioUpdate = {
                'twilioTest.enabled': updates.twilioTest.enabled === true, // Explicit boolean check
                'twilioTest.phoneNumber': updates.twilioTest.phoneNumber?.trim() || null,
                'twilioTest.accountSid': updates.twilioTest.accountSid?.trim() || null,
                'twilioTest.authToken': updates.twilioTest.authToken?.trim() || null,
                'twilioTest.greeting': updates.twilioTest.greeting?.trim() || 'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.',
                'twilioTest.notes': updates.twilioTest.notes?.trim() || ''
            };
            
            logger.security(`🔧 [TWILIO UPDATE] Saving:`, {
                enabled: twilioUpdate['twilioTest.enabled'],
                phoneNumber: twilioUpdate['twilioTest.phoneNumber'] ? twilioUpdate['twilioTest.phoneNumber'] : 'NULL',
                accountSid: twilioUpdate['twilioTest.accountSid'] ? `${twilioUpdate['twilioTest.accountSid'].substring(0, 10)  }...` : 'NULL',
                authToken: twilioUpdate['twilioTest.authToken'] ? '***' : 'NULL',
                greeting: twilioUpdate['twilioTest.greeting'] ? `${twilioUpdate['twilioTest.greeting'].substring(0, 50)  }...` : 'DEFAULT',
                notes: twilioUpdate['twilioTest.notes']
            });
            
            const updatedTemplate = await GlobalInstantResponseTemplate.findByIdAndUpdate(
                id,
                { $set: twilioUpdate },
                { new: true }
            );
            
            logger.info(`✅ Updated Twilio test config for template ${updatedTemplate.version}`);
            
            // If ONLY twilioTest is being updated, return early (skip full validation)
            if (Object.keys(updates).length === 1 && updates.twilioTest) {
                return res.json({
                    success: true,
                    message: 'Twilio test configuration updated successfully',
                    data: updatedTemplate
                });
            }
            
            changes.push('Updated Twilio test config');
        }
        
        // Add changelog entry
        if (changes.length > 0) {
            template.addChangeLog(changes.join(', '), adminUser);
        }
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.debug(`✅ Updated template ${template.version}: ${changes.join(', ')}`);
        
        // ========================================================================
        // 🔥 AUTO-SCAN & CACHE INVALIDATION
        // ========================================================================
        // Background job: Scan all companies using this template for placeholder updates
        // Non-blocking: Fire and forget
        // ========================================================================
        setImmediate(async () => {
            try {
                logger.debug(`🔍 [AUTO-SCAN] Triggering background scan for template ${id}`);
                
                // 1. Clear template cache
                await CacheHelper.clearTemplateCache(id);
                logger.debug(`✅ [AUTO-SCAN] Cache cleared for template ${id}`);
                
                // 2. Scan all companies using this template
                const scanResult = await PlaceholderScanService.scanAllCompaniesForTemplate(id);
                logger.debug(`✅ [AUTO-SCAN] Background scan complete: ${scanResult.companiesScanned} companies scanned, ${scanResult.companiesWithAlerts} alerts generated`);
                
            } catch (scanError) {
                logger.error(`❌ [AUTO-SCAN] Background scan failed for template ${id}:`, scanError.message);
                // Non-critical error - don't block response
            }
        });
        
        res.json({
            success: true,
            message: 'Template updated successfully',
            data: template,
            backgroundScan: {
                triggered: true,
                note: 'Companies using this template will be scanned for placeholder updates in the background'
            }
        });
    } catch (error) {
        logger.error('❌ Error updating template:', error.message, error.stack);
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
        
        // Prevent deletion of default template only
        if (template.isDefaultTemplate) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete the default template. Please set another template as default first.'
            });
        }
        
        const templateVersion = template.version;
        await GlobalInstantResponseTemplate.findByIdAndDelete(id);
        
        logger.info(`✅ Deleted template ${templateVersion} by ${adminUser}`);
        
        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
    } catch (error) {
        logger.error('❌ Error deleting template:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error deleting template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/seed
 * Seed the database with the 8-category test template
 */
router.post('/seed', authenticateJWT, async (req, res) => {
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    logger.security('🌱 [SEED CHECKPOINT 1] Seed endpoint called by:', adminUser);
    
    try {
        logger.info('🌱 [SEED CHECKPOINT 2] Checking for existing template...');
        // Check if template already exists
        const existing = await GlobalInstantResponseTemplate.findOne({ version: 'v1.0.0-test' });
        logger.info('🌱 [SEED CHECKPOINT 3] Existing template found:', existing ? 'YES' : 'NO');
        
        if (existing) {
            logger.info('🌱 [SEED CHECKPOINT 4] Template already exists, returning 409');
            return res.status(409).json({
                success: false,
                message: 'Test template already exists. Delete it first if you want to re-seed.'
            });
        }
        
        logger.info('🌱 [SEED CHECKPOINT 5] No existing template, proceeding to create...');
        
        // 8 essential categories
        const eightCategories = [
            {
                id: 'empathy-compassion',
                name: 'Empathy / Compassion',
                icon: '❤️',
                description: 'Calm, validating feelings, brief reassurance then action',
                behavior: 'empathetic_reassuring',
                scenarios: [{
                    id: 'upset-crying',
                    name: 'Upset / Distressed',
                    triggers: ["i'm so upset", "this is terrible", "i'm crying", "i don't know what to do", "i'm devastated"],
                    quickReplies: [
                        "I'm so sorry — I can help.",
                        "I hear you — let me help with this right away.",
                        "I'm really sorry you're going through this."
                    ],
                    fullReplies: [
                        "I'm really sorry you're going through that. I hear how upsetting this is — I'll stay with you and get this sorted. Can I confirm a few quick details so I can help right away?",
                        "I understand this is difficult. I'm here to help and I'll make sure we get this resolved. Let me get some information so I can assist you properly."
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'urgent-action',
                name: 'Urgent / Action-Oriented',
                icon: '🚨',
                description: 'Short sentences, decisive verbs, immediate action',
                behavior: 'urgent_action',
                scenarios: [{
                    id: 'urgent-asap',
                    name: 'Urgent / ASAP',
                    triggers: ["asap", "right now", "can't wait", "emergency", "immediately", "urgent"],
                    quickReplies: [
                        "Understood — I'll prioritize this now.",
                        "I'm on it — connecting you immediately.",
                        "Right away — I'll get someone to you fast."
                    ],
                    fullReplies: [
                        "I understand the urgency. I'm marking this as high priority and connecting you with the next available team member. Can you confirm your address while I connect?",
                        "I hear the urgency. I'm putting you through to the next available person right now. While we connect, what's your location?"
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'deescalation-frustration',
                name: 'De-escalation / Frustration',
                icon: '😤',
                description: 'Short empathy + ownership + immediate corrective steps',
                behavior: 'apologetic_solution',
                scenarios: [{
                    id: 'angry-frustrated',
                    name: 'Angry / Frustrated',
                    triggers: ["this is ridiculous", "i want a manager", "this is unacceptable", "i'm so frustrated", "this is terrible"],
                    quickReplies: [
                        "I'm sorry this happened — let me make it right.",
                        "I understand your frustration — let me fix this.",
                        "I apologize — tell me what happened and I'll resolve it."
                    ],
                    fullReplies: [
                        "I'm sorry you've been inconvenienced. I'll do everything I can to fix this quickly — can I get your account number so I can escalate if needed?",
                        "I apologize for the trouble. Let me get the details and make this right. What's your account or phone number?"
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'positive-enthusiastic',
                name: 'Positive / Enthusiastic',
                icon: '😊',
                description: 'Warm, upbeat, match energy but remain professional',
                behavior: 'enthusiastic_positive',
                scenarios: [{
                    id: 'happy-excited',
                    name: 'Happy / Excited',
                    triggers: ["great", "thanks", "that sounds good", "awesome", "perfect", "fantastic"],
                    quickReplies: [
                        "Fantastic — glad we could help!",
                        "Awesome! Happy to assist.",
                        "Perfect — excited to get this done for you!"
                    ],
                    fullReplies: [
                        "That's great to hear! I've booked that for you — you'll get a confirmation by text/email shortly. Anything else I can do?",
                        "Wonderful! You're all set. You'll receive a confirmation shortly. Is there anything else I can help with?"
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'hold-wait',
                name: 'Hold / Wait ("Let me check")',
                icon: '⏸️',
                description: 'Offer options, set expectations, handle silence gracefully',
                behavior: 'calm_patient',
                scenarios: [{
                    id: 'check-calendar',
                    name: 'Checking Calendar / Need Moment',
                    triggers: ["hold on", "let me check", "hang on", "one moment", "let me see", "hmm that day", "checking my calendar", "give me a second", "let me look that up"],
                    quickReplies: [
                        "No problem — take your time.",
                        "Of course — I'll wait.",
                        "Sure thing — I'm here when you're ready."
                    ],
                    fullReplies: [
                        "Sure — take your time. I'll stay on the line.",
                        "No rush at all. I'll be right here when you're ready.",
                        "Absolutely — take all the time you need."
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true,
                    
                    // ✅ SMART HOLD ENABLED for this scenario
                    enableSmartHold: true,
                    smartHoldConfig: {
                        timeoutIntervals: [60, 120, 180],  // Check in at 1min, 2min, 3min
                        maxDuration: 300,  // 5 minute max
                        activeListening: true,  // Monitor for customer return
                        checkInMessages: [
                            "I'm still here — take your time.",
                            "No rush — I'm right here when you're ready.",
                            "Still here for you — let me know when you're set."
                        ],
                        maxDurationMessage: "I want to make sure I'm still helping — would you like me to call you back when you're ready?"
                    }
                }],
                isActive: true
            },
            {
                id: 'booking-confirming',
                name: 'Booking / Confirming Appointment',
                icon: '📅',
                description: 'Repeat back details, give next steps, send confirmation',
                behavior: 'professional_efficient',
                scenarios: [{
                    id: 'schedule-appointment',
                    name: 'Schedule / Book Appointment',
                    triggers: ["book", "schedule", "appointment", "make a reservation", "set up a time", "when can you come"],
                    quickReplies: [
                        "I can schedule that for you.",
                        "I'd be happy to book that.",
                        "Let's get that scheduled."
                    ],
                    fullReplies: [
                        "I'd be happy to schedule that. What day and time works best for you?",
                        "Let's get that on the calendar. What date and time would you prefer?"
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'price-inquiry',
                name: 'Price Inquiry / Estimate',
                icon: '💰',
                description: 'Clear answer if available, otherwise promise follow-up with ETA',
                behavior: 'professional_efficient',
                scenarios: [{
                    id: 'how-much',
                    name: 'How Much / Cost / Price',
                    triggers: ["how much", "price", "cost", "estimate", "how much does it cost", "what do you charge"],
                    quickReplies: [
                        "Typical costs range from [range].",
                        "Let me get you pricing information.",
                        "I can provide an estimate for you."
                    ],
                    fullReplies: [
                        "For that service, typical costs range from $X to $Y depending on scope. I can get a precise estimate if you share more details, or schedule a technician for an exact quote.",
                        "Pricing typically falls between $X and $Y depending on the specifics. Would you like an exact quote? I can gather more details or schedule an assessment."
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            },
            {
                id: 'greeting-welcome',
                name: 'Greeting / Small Talk',
                icon: '👋',
                description: 'Brief friendly response then redirect to purpose',
                behavior: 'friendly_warm',
                scenarios: [{
                    id: 'how-are-you',
                    name: 'How Are You / What\'s Up',
                    triggers: ["how are you", "what's up", "how's it going", "good morning", "good afternoon", "hi", "hello"],
                    quickReplies: [
                        "Doing well, thanks — how can I help?",
                        "Great, thanks! What can I do for you?",
                        "I'm well, thank you! How may I assist you today?"
                    ],
                    fullReplies: [
                        "I'm doing well, thanks! How can I help you with your appointment or service today?",
                        "I'm great, thanks for asking! What can I help you with today?"
                    ],
                    keywords: [],
                    qnaPairs: [],
                    isActive: true
                }],
                isActive: true
            }
        ];
        
        logger.info('🌱 [SEED CHECKPOINT 6] Categories array created, total:', eightCategories.length);
        
        // Create the template
        logger.info('🌱 [SEED CHECKPOINT 7] Creating new GlobalInstantResponseTemplate document...');
        const template = new GlobalInstantResponseTemplate({
            version: 'v1.0.0-test',
            name: 'ClientVia.ai Global AI Brain (Testing)',
            description: 'Focused 8-category set for testing and validation',
            isActive: true,
            categories: eightCategories,
            createdBy: adminUser,
            changeLog: [{
                changes: 'Created focused 8-category test version via API',
                changedBy: adminUser
            }]
        });
        
        logger.info('🌱 [SEED CHECKPOINT 8] Template document created, attempting to save to MongoDB...');
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        logger.info('🌱 [SEED CHECKPOINT 9] ✅ Template saved successfully to database!');
        logger.info('🌱 [SEED CHECKPOINT 10] Template ID:', template._id);
        logger.info('🌱 [SEED CHECKPOINT 11] Stats - Categories:', template.stats.totalCategories, 'Scenarios:', template.stats.totalScenarios, 'Triggers:', template.stats.totalTriggers);
        
        logger.info(`✅ Seeded 8-category template by ${adminUser}`);
        
        logger.info('🌱 [SEED CHECKPOINT 12] Sending success response to client...');
        res.status(201).json({
            success: true,
            message: 'Global AI Brain seeded successfully!',
            data: {
                version: template.version,
                categories: template.stats.totalCategories,
                scenarios: template.stats.totalScenarios,
                triggers: template.stats.totalTriggers
            }
        });
        logger.info('🌱 [SEED CHECKPOINT 13] ✅ Success response sent!');
    } catch (error) {
        logger.error('❌ [SEED CHECKPOINT ERROR] Seeding failed at some point!');
        logger.error('❌ [SEED ERROR DETAILS] Message:', error.message);
        logger.error('❌ [SEED ERROR DETAILS] Stack:', error.stack);
        logger.error('❌ [SEED ERROR DETAILS] Full error object:', JSON.stringify(error, null, 2));
        res.status(500).json({
            success: false,
            message: `Error seeding template: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/enhance
 * Enhance a template with keywords and Q&A pairs
 */
router.post('/:id/enhance', async (req, res) => {
    const { id } = req.params;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    logger.info(`🧠 [ENHANCE] POST /api/admin/global-instant-responses/${id}/enhance by ${adminUser}`);
    
    try {
        // Find the template
        const template = await GlobalInstantResponseTemplate.findById(id);
        
        if (!template) {
            logger.warn(`🧠 [ENHANCE] Template not found: ${id}`);
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        logger.info(`🧠 [ENHANCE] Enhancing template: ${template.name} (${template.version})`);
        
        // Enhance the template with keywords and Q&A pairs
        const enhancedData = enhanceTemplate(template.toObject());
        
        // Update the template
        template.categories = enhancedData.categories;
        template.stats = enhancedData.stats;
        template.updatedAt = Date.now();
        
        // Add to change log
        template.changeLog.push({
            changes: `Enhanced with keywords and Q&A pairs: ${enhancedData.stats.totalKeywords} keywords, ${enhancedData.stats.totalQnAPairs} Q&A pairs`,
            changedBy: adminUser,
            date: Date.now()
        });
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info(`✅ [ENHANCE] Template enhanced successfully: ${template._id}`);
        logger.info(`📊 [ENHANCE] Stats: ${enhancedData.stats.totalKeywords} keywords, ${enhancedData.stats.totalQnAPairs} Q&A pairs`);
        
        res.status(200).json({
            success: true,
            message: 'Template enhanced successfully with keywords and Q&A pairs',
            data: {
                templateId: template._id,
                version: template.version,
                stats: template.stats
            }
        });
    } catch (error) {
        logger.error(`❌ [ENHANCE] Error enhancing template ${id}`, { 
            error: error.message, 
            stack: error.stack 
        });
        res.status(500).json({
            success: false,
            message: `Error enhancing template: ${error.message}`
        });
    }
});

// ============================================================================
// 🌳 LINEAGE & COMPARISON ROUTES
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:id/parent-updates
 * Check if parent template has updates since this template was cloned
 */
router.get('/:id/parent-updates', async (req, res) => {
    const { id } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        if (!template.hasParent()) {
            return res.json({
                success: true,
                hasParent: false,
                message: 'This template is not a clone'
            });
        }
        
        const updateInfo = await template.checkParentUpdates();
        
        logger.info(`🔍 Checked parent updates for ${template.name}: ${updateInfo.hasUpdates ? 'YES' : 'NO'}`);
        
        res.json({
            success: true,
            hasParent: true,
            ...updateInfo
        });
    } catch (error) {
        logger.error('❌ Error checking parent updates:', error.message);
        res.status(500).json({
            success: false,
            message: `Error checking parent updates: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id/compare-with-parent
 * Compare this template with its parent to see differences
 */
router.get('/:id/compare-with-parent', async (req, res) => {
    const { id } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        if (!template.hasParent()) {
            return res.json({
                success: true,
                hasParent: false,
                message: 'This template is not a clone, nothing to compare'
            });
        }
        
        const comparison = await template.compareWithParent();
        
        if (!comparison) {
            return res.status(404).json({
                success: false,
                message: 'Parent template not found'
            });
        }
        
        logger.info(`🔍 Compared ${template.name} with parent:`, {
            added: comparison.added.length,
            removed: comparison.removed.length,
            modified: comparison.modified.length,
            conflicts: comparison.conflicts.length
        });
        
        res.json({
            success: true,
            hasParent: true,
            parentName: template.lineage.clonedFromName,
            parentVersion: template.lineage.clonedFromVersion,
            clonedAt: template.lineage.clonedAt,
            comparison: {
                summary: {
                    total: comparison.added.length + comparison.removed.length + 
                           comparison.modified.length + comparison.unchanged.length,
                    custom: comparison.added.length,
                    availableToSync: comparison.removed.length,
                    modified: comparison.modified.length,
                    conflicts: comparison.conflicts.length,
                    unchanged: comparison.unchanged.length
                },
                details: comparison
            }
        });
    } catch (error) {
        logger.error('❌ Error comparing with parent:', error.message);
        res.status(500).json({
            success: false,
            message: `Error comparing with parent: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id/lineage
 * Get full lineage information for a template
 */
router.get('/:id/lineage', async (req, res) => {
    const { id } = req.params;
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(id)
            .select('name version lineage')
            .lean();
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        let parentInfo = null;
        if (template.lineage && template.lineage.clonedFrom) {
            const parent = await GlobalInstantResponseTemplate.findById(template.lineage.clonedFrom)
                .select('name version updatedAt')
                .lean();
            
            if (parent) {
                parentInfo = {
                    id: parent._id,
                    name: parent.name,
                    version: parent.version,
                    updatedAt: parent.updatedAt,
                    hasUpdates: parent.updatedAt > template.lineage.clonedAt
                };
            }
        }
        
        res.json({
            success: true,
            template: {
                id: template._id,
                name: template.name,
                version: template.version
            },
            lineage: template.lineage || { isClone: false },
            parent: parentInfo
        });
    } catch (error) {
        logger.error('❌ Error fetching lineage:', error.message);
        res.status(500).json({
            success: false,
            message: `Error fetching lineage: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/sync-from-parent
 * Sync selected scenarios from parent template to child template
 */
router.post('/:id/sync-from-parent', async (req, res) => {
    const { id } = req.params;
    const { scenariosToSync } = req.body; // Array of { categoryId, scenarioId }
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';

    try {
        logger.debug(`🔄 [SYNC] Starting sync for template ${id} by ${adminUser}`);
        logger.debug(`📥 [SYNC] Scenarios to sync:`, scenariosToSync);

        // Get child template
        const childTemplate = await GlobalInstantResponseTemplate.findById(id);

        if (!childTemplate) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        // Check if it has a parent
        if (!childTemplate.lineage || !childTemplate.lineage.isClone || !childTemplate.lineage.clonedFrom) {
            return res.status(400).json({
                success: false,
                message: 'Template is not a clone, cannot sync from parent'
            });
        }

        // Get parent template
        const parentTemplate = await GlobalInstantResponseTemplate.findById(childTemplate.lineage.clonedFrom);

        if (!parentTemplate) {
            return res.status(404).json({
                success: false,
                message: 'Parent template not found'
            });
        }

        let syncedCount = 0;
        const syncedItems = [];

        // Process each scenario to sync
        for (const item of scenariosToSync) {
            const { categoryId, scenarioId } = item;

            // Find scenario in parent template
            let parentScenario = null;
            let parentCategory = null;

            for (const cat of parentTemplate.categories) {
                const scenario = cat.scenarios.find(s => s.id === scenarioId);
                if (scenario) {
                    parentScenario = scenario;
                    parentCategory = cat;
                    break;
                }
            }

            if (!parentScenario || !parentCategory) {
                logger.info(`⚠️ [SYNC] Scenario ${scenarioId} not found in parent template, skipping`);
                continue;
            }

            // Find matching category in child template
            let childCategory = childTemplate.categories.find(c => c.id === categoryId);

            if (!childCategory) {
                // Category doesn't exist in child, create it
                logger.info(`➕ [SYNC] Creating new category: ${parentCategory.name}`);
                childCategory = {
                    id: parentCategory.id,
                    name: parentCategory.name,
                    description: parentCategory.description,
                    behavior: parentCategory.behavior,
                    scenarios: []
                };
                childTemplate.categories.push(childCategory);
            }

            // Check if scenario already exists in child
            const existingScenarioIndex = childCategory.scenarios.findIndex(s => s.id === scenarioId);

            if (existingScenarioIndex >= 0) {
                // Replace existing scenario
                logger.info(`🔄 [SYNC] Replacing existing scenario: ${parentScenario.name}`);
                childCategory.scenarios[existingScenarioIndex] = JSON.parse(JSON.stringify(parentScenario));
            } else {
                // Add new scenario
                logger.info(`➕ [SYNC] Adding new scenario: ${parentScenario.name}`);
                childCategory.scenarios.push(JSON.parse(JSON.stringify(parentScenario)));
            }

            syncedCount++;
            syncedItems.push({
                categoryName: parentCategory.name,
                scenarioName: parentScenario.name
            });

            // Record modification in lineage
            childTemplate.lineage.modifications.push({
                type: existingScenarioIndex >= 0 ? 'scenario_modified' : 'scenario_added',
                categoryId,
                categoryName: parentCategory.name,
                scenarioId,
                scenarioName: parentScenario.name,
                description: `Synced from parent template`,
                modifiedBy: adminUser,
                modifiedAt: new Date()
            });
        }

        // Update sync metadata
        childTemplate.lineage.lastSyncCheck = new Date();
        childTemplate.lineage.parentLastUpdatedAt = parentTemplate.updatedAt;

        // Add changelog entry
        childTemplate.addChangeLog(
            `Synced ${syncedCount} scenario${syncedCount > 1 ? 's' : ''} from parent template "${parentTemplate.name}"`,
            adminUser
        );

        await childTemplate.save();
        await CacheHelper.invalidateTemplate(childTemplate._id);

        logger.info(`✅ [SYNC] Successfully synced ${syncedCount} scenarios`);

        res.json({
            success: true,
            message: `Successfully synced ${syncedCount} scenario${syncedCount > 1 ? 's' : ''}`,
            syncedCount,
            syncedItems
        });

    } catch (error) {
        logger.error('❌ Error syncing scenarios:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error syncing scenarios: ${error.message}`
        });
    }
});

// ============================================================================
// SCENARIO CRUD ROUTES - V2.0 WORLD-CLASS AI
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:templateId/categories/:categoryId/scenarios/:scenarioId
 * Fetch a single scenario by ID (for editing)
 */
router.get('/:templateId/categories/:categoryId/scenarios/:scenarioId', async (req, res) => {
    const { templateId, categoryId, scenarioId } = req.params;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    logger.debug(`📖 [GET SCENARIO] ${adminUser} fetching scenario ${scenarioId} from category ${categoryId} in template ${templateId}`);
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        // Find the category
        const category = template.categories.find(cat => cat.id === categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }
        
        // Find the scenario
        const scenario = category.scenarios.find(scn => scn.scenarioId === scenarioId);
        if (!scenario) {
            return res.status(404).json({
                success: false,
                message: 'Scenario not found'
            });
        }
        
        logger.info(`✅ [GET SCENARIO] Found scenario: ${scenario.name}`);
        
        res.json({
            success: true,
            data: scenario
        });
        
    } catch (error) {
        logger.error('❌ [GET SCENARIO] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching scenario: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:templateId/categories/:categoryId/scenarios
 * Create a new scenario within a category
 */
router.post('/:templateId/categories/:categoryId/scenarios', async (req, res) => {
    const { templateId, categoryId } = req.params;
    const scenarioData = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';

    try {
        logger.info(`➕ [SCENARIO CREATE] Template: ${templateId}, Category: ${categoryId}`);
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        // Find the category
        const category = template.categories.find(c => c.id === categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Generate unique scenario ID if not provided
        if (!scenarioData.scenarioId) {
            scenarioData.scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }

        // Set defaults for V2.0 fields
        const newScenario = {
            scenarioId: scenarioData.scenarioId,
            version: 1,
            status: scenarioData.status || 'live',
            name: scenarioData.name,
            isActive: scenarioData.isActive !== undefined ? scenarioData.isActive : true,
            categories: [categoryId],
            priority: scenarioData.priority || 0,
            cooldownSeconds: scenarioData.cooldownSeconds || 0,
            language: scenarioData.language || 'auto',
            channel: scenarioData.channel || 'any',
            
            // Matching
            triggers: scenarioData.triggers || [],
            regexTriggers: scenarioData.regexTriggers || [],
            negativeTriggers: scenarioData.negativeTriggers || [],
            contextWeight: scenarioData.contextWeight !== undefined ? scenarioData.contextWeight : 0.7,
            preconditions: scenarioData.preconditions || {},
            effects: scenarioData.effects || {},
            
            // Replies
            quickReplies: scenarioData.quickReplies || [],
            fullReplies: scenarioData.fullReplies || [],
            followUpFunnel: scenarioData.followUpFunnel || '',
            replySelection: scenarioData.replySelection || 'bandit',
            
            // Entities
            entityCapture: scenarioData.entityCapture || [],
            entityValidation: scenarioData.entityValidation || {},
            dynamicVariables: scenarioData.dynamicVariables || {},
            
            // Actions & Safety
            actionHooks: scenarioData.actionHooks || [],
            handoffPolicy: scenarioData.handoffPolicy || 'low_confidence',
            sensitiveInfoRule: scenarioData.sensitiveInfoRule || 'platform_default',
            customMasking: scenarioData.customMasking || {},
            
            // Timing
            timedFollowUp: scenarioData.timedFollowUp || {
                enabled: false,
                delaySeconds: 50,
                messages: [],
                extensionSeconds: 30
            },
            silencePolicy: scenarioData.silencePolicy || {
                maxConsecutive: 2,
                finalWarning: 'Hello? Did I lose you?'
            },
            
            // Voice
            toneLevel: scenarioData.toneLevel || 2,
            ttsOverride: scenarioData.ttsOverride || {},
            
            // Metadata
            createdBy: adminUser,
            updatedBy: adminUser,
            createdAt: new Date(),
            updatedAt: new Date(),
            legacyMigrated: false
        };

        // Add to category
        category.scenarios.push(newScenario);

        // Update template stats
        template.stats.totalScenarios = (template.stats.totalScenarios || 0) + 1;
        template.stats.totalTriggers = (template.stats.totalTriggers || 0) + (scenarioData.triggers?.length || 0);
        
        // Add changelog
        template.addChangeLog(
            `Added scenario "${newScenario.name}" to category "${category.name}"`,
            adminUser
        );

        await template.save();
        await CacheHelper.invalidateTemplate(template._id);

        logger.info(`✅ [SCENARIO CREATE] Created: ${newScenario.name} (${newScenario.scenarioId})`);

        res.json({
            success: true,
            message: 'Scenario created successfully',
            data: newScenario
        });

    } catch (error) {
        logger.error('❌ [SCENARIO CREATE] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error creating scenario: ${error.message}`
        });
    }
});

/**
 * PATCH /api/admin/global-instant-responses/:templateId/categories/:categoryId/scenarios/:scenarioId
 * Update an existing scenario
 */
router.patch('/:templateId/categories/:categoryId/scenarios/:scenarioId', async (req, res) => {
    const { templateId, categoryId, scenarioId } = req.params;
    const updates = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';

    try {
        logger.info(`✏️ [SCENARIO UPDATE] Scenario: ${scenarioId}`);
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        // Find the category
        const category = template.categories.find(c => c.id === categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Find the scenario
        const scenarioIndex = category.scenarios.findIndex(s => s.scenarioId === scenarioId || s.id === scenarioId);
        if (scenarioIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Scenario not found'
            });
        }

        const scenario = category.scenarios[scenarioIndex];
        const changes = [];

        // Track what changed
        if (updates.name && updates.name !== scenario.name) {
            changes.push(`name: "${scenario.name}" → "${updates.name}"`);
            scenario.name = updates.name;
        }

        if (updates.triggers) {
            scenario.triggers = updates.triggers;
            changes.push('updated triggers');
        }

        if (updates.quickReplies) {
            scenario.quickReplies = updates.quickReplies;
            changes.push('updated quick replies');
        }

        if (updates.fullReplies) {
            scenario.fullReplies = updates.fullReplies;
            changes.push('updated full replies');
        }

        // Update all other fields
        const updatableFields = [
            'status', 'isActive', 'priority', 'cooldownSeconds', 'language', 'channel',
            'regexTriggers', 'negativeTriggers', 'contextWeight', 'preconditions', 'effects',
            'followUpFunnel', 'replySelection', 'entityCapture', 'entityValidation',
            'dynamicVariables', 'actionHooks', 'handoffPolicy', 'sensitiveInfoRule',
            'customMasking', 'timedFollowUp', 'silencePolicy', 'toneLevel', 'ttsOverride'
        ];

        updatableFields.forEach(field => {
            if (updates[field] !== undefined) {
                scenario[field] = updates[field];
                if (changes.length < 10) { // Limit change log verbosity
                    changes.push(`updated ${field}`);
                }
            }
        });

        // Increment version if moving from draft to live
        if (updates.status === 'live' && scenario.status === 'draft') {
            scenario.version = (scenario.version || 1) + 1;
            changes.push(`published v${scenario.version}`);
        }

        // Update metadata
        scenario.updatedBy = adminUser;
        scenario.updatedAt = new Date();

        // Update template changelog
        template.addChangeLog(
            `Updated scenario "${scenario.name}": ${changes.join(', ')}`,
            adminUser
        );

        await template.save();
        await CacheHelper.invalidateTemplate(template._id);

        logger.info(`✅ [SCENARIO UPDATE] Updated: ${scenario.name}`);

        res.json({
            success: true,
            message: 'Scenario updated successfully',
            data: scenario
        });

    } catch (error) {
        logger.error('❌ [SCENARIO UPDATE] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error updating scenario: ${error.message}`
        });
    }
});

/**
 * DELETE /api/admin/global-instant-responses/:templateId/categories/:categoryId/scenarios/:scenarioId
 * Delete a scenario
 */
router.delete('/:templateId/categories/:categoryId/scenarios/:scenarioId', async (req, res) => {
    const { templateId, categoryId, scenarioId } = req.params;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';

    try {
        logger.info(`🗑️ [SCENARIO DELETE] Scenario: ${scenarioId}`);
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        // Find the category
        const category = template.categories.find(c => c.id === categoryId);
        if (!category) {
            return res.status(404).json({
                success: false,
                message: 'Category not found'
            });
        }

        // Find the scenario
        const scenarioIndex = category.scenarios.findIndex(s => s.scenarioId === scenarioId || s.id === scenarioId);
        if (scenarioIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Scenario not found'
            });
        }

        const scenario = category.scenarios[scenarioIndex];
        const scenarioName = scenario.name;
        const triggerCount = scenario.triggers?.length || 0;

        // Remove scenario
        category.scenarios.splice(scenarioIndex, 1);

        // Update template stats
        template.stats.totalScenarios = Math.max(0, (template.stats.totalScenarios || 0) - 1);
        template.stats.totalTriggers = Math.max(0, (template.stats.totalTriggers || 0) - triggerCount);

        // Add changelog
        template.addChangeLog(
            `Deleted scenario "${scenarioName}" from category "${category.name}"`,
            adminUser
        );

        await template.save();
        await CacheHelper.invalidateTemplate(template._id);

        logger.info(`✅ [SCENARIO DELETE] Deleted: ${scenarioName}`);

        res.json({
            success: true,
            message: 'Scenario deleted successfully'
        });

    } catch (error) {
        logger.error('❌ [SCENARIO DELETE] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error deleting scenario: ${error.message}`
        });
    }
});

/**
 * GET /api/admin/global-instant-responses/:templateId/scenarios
 * Get all scenarios across all categories (for search/filter)
 */
router.get('/:templateId/scenarios', async (req, res) => {
    const { templateId } = req.params;
    const { status, language, channel, categoryId } = req.query;

    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            // 🚨 P0 CHECKPOINT: Template not found
            await AdminNotificationService.sendAlert({
                code: 'TEMPLATE_NOT_FOUND',
                severity: 'WARNING',
                companyId: null,
                companyName: 'Platform',
                message: '⚠️ Attempted to load non-existent AI template',
                details: {
                    templateId,
                    endpoint: `/api/admin/global-instant-responses/${templateId}/scenarios`,
                    impact: 'Cannot display scenarios, AI agent configuration blocked',
                    suggestedFix: 'Verify template ID is correct, check if template was deleted',
                    detectedBy: 'Template scenarios endpoint'
                }
            }).catch(err => logger.error('Failed to send template not found alert:', err));
            
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        // Collect all scenarios from all categories
        let allScenarios = [];
        template.categories.forEach(category => {
            category.scenarios.forEach(scenario => {
                allScenarios.push({
                    ...scenario.toObject(),
                    categoryId: category.id,
                    categoryName: category.name
                });
            });
        });

        // 🚨 P0 CHECKPOINT: Empty scenarios warning
        if (allScenarios.length === 0 && template.categories.length > 0) {
            await AdminNotificationService.sendAlert({
                code: 'TEMPLATE_EMPTY_SCENARIOS',
                severity: 'WARNING',
                companyId: null,
                companyName: 'Platform',
                message: `⚠️ Template "${template.name}" has categories but no scenarios`,
                details: {
                    templateId,
                    templateName: template.name,
                    categoriesCount: template.categories.length,
                    scenariosCount: 0,
                    impact: 'AI agent cannot respond to any queries - template is non-functional',
                    suggestedFix: 'Add scenarios to categories or seed default scenarios',
                    detectedBy: 'Template scenarios endpoint'
                },
                bypassPatternDetection: true // Empty state = immediate alert
            }).catch(err => logger.error('Failed to send empty scenarios alert:', err));
        }

        // Apply filters
        if (status) {
            allScenarios = allScenarios.filter(s => s.status === status);
        }
        if (language) {
            allScenarios = allScenarios.filter(s => s.language === language || s.language === 'auto');
        }
        if (channel) {
            allScenarios = allScenarios.filter(s => s.channel === channel || s.channel === 'any');
        }
        if (categoryId) {
            allScenarios = allScenarios.filter(s => s.categoryId === categoryId);
        }

        res.json({
            success: true,
            count: allScenarios.length,
            data: allScenarios
        });

    } catch (error) {
        logger.error('❌ Error fetching scenarios:', error.message, error.stack);
        
        // 🚨 P0 CHECKPOINT: Database query failure
        await AdminNotificationService.sendAlert({
            code: 'TEMPLATE_LOAD_FAILURE',
            severity: 'CRITICAL',
            companyId: null,
            companyName: 'Platform',
            message: '🔴 CRITICAL: Failed to load AI template from database',
            details: {
                templateId,
                error: error.message,
                endpoint: `/api/admin/global-instant-responses/${templateId}/scenarios`,
                impact: 'AI configuration UI broken, cannot manage scenarios',
                suggestedFix: 'Check MongoDB connection, review database logs',
                detectedBy: 'Template scenarios endpoint'
            },
            stackTrace: error.stack
        }).catch(err => logger.error('Failed to send template load failure alert:', err));
        
        res.status(500).json({
            success: false,
            message: `Error fetching scenarios: ${error.message}`
        });
    }
});

// ============================================================================
// TEMPLATE SEEDING ENDPOINT - WORLD-CLASS PRODUCTION SYSTEM
// ============================================================================

/**
 * POST /api/admin/global-instant-responses/seed-template
 * Seeds a pre-built template into the database
 * 
 * SECURITY: Admin authentication required
 * USE CASE: One-click seeding from UI, works on any environment
 * PRODUCTION-READY: Logs all actions, validates data, handles errors
 * 
 * Body Parameters:
 * - templateName: string (e.g., "universal-test-12-categories")
 * - replaceExisting: boolean (default: true)
 * 
 * Available Templates:
 * - "universal-test-12-categories" - Test template with 12 categories, 14 scenarios
 * - "universal-full-103-categories" - (Future) Production template
 */
router.post('/seed-template', async (req, res) => {
    const { templateName, replaceExisting = true } = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    logger.info(`🌱 [SEED API] Template seed requested by ${adminUser}`);
    logger.info(`🌱 [SEED API] Template: ${templateName}`);
    logger.info(`🌱 [SEED API] Replace existing: ${replaceExisting}`);
    
    try {
        // Validate template name
        const availableTemplates = {
            'universal-test-12-categories': {
                name: 'Universal AI Brain (All Industries)',
                description: 'Test template with 12 categories covering all scenario types',
                categories: 12,
                scenarios: 14
            }
        };
        
        if (!availableTemplates[templateName]) {
            return res.status(400).json({
                success: false,
                message: `Unknown template: ${templateName}`,
                availableTemplates: Object.keys(availableTemplates)
            });
        }
        
        const templateInfo = availableTemplates[templateName];
        logger.info(`✅ [SEED API] Valid template selected: ${templateInfo.name}`);
        
        // Load template data
        const { ulid } = require('ulid');
        const templateData = buildUniversalTestTemplate(ulid);
        
        // Check if existing template needs to be replaced
        let template;
        if (replaceExisting) {
            const existingTemplate = await GlobalInstantResponseTemplate.findOne({ 
                name: templateInfo.name 
            });
            
            if (existingTemplate) {
                logger.info(`🔄 [SEED API] Found existing template: ${existingTemplate._id}`);
                logger.info(`💾 [SEED API] PRESERVING Twilio configuration...`);
                
                // ✅ WORLD-CLASS: Backup Twilio config before updating
                const twilioBackup = existingTemplate.twilioTest ? {
                    enabled: existingTemplate.twilioTest.enabled,
                    phoneNumber: existingTemplate.twilioTest.phoneNumber,
                    accountSid: existingTemplate.twilioTest.accountSid,
                    authToken: existingTemplate.twilioTest.authToken,
                    greeting: existingTemplate.twilioTest.greeting,
                    lastTestedAt: existingTemplate.twilioTest.lastTestedAt,
                    testCallCount: existingTemplate.twilioTest.testCallCount,
                    notes: existingTemplate.twilioTest.notes
                } : null;
                
                if (twilioBackup) {
                    logger.info(`📞 [SEED API] Twilio config backed up:`);
                    logger.info(`   - Enabled: ${twilioBackup.enabled}`);
                    logger.info(`   - Phone: ${twilioBackup.phoneNumber || 'Not set'}`);
                    logger.info(`   - Account SID: ${twilioBackup.accountSid || 'Not set'}`);
                }
                
                // ✅ UPDATE categories and scenarios (core content)
                existingTemplate.categories = templateData.categories;
                existingTemplate.version = templateData.version;
                existingTemplate.description = templateData.description;
                existingTemplate.updatedAt = new Date();
                
                // ✅ CALCULATE stats from actual data (don't rely on templateData.stats)
                let totalScenarios = 0;
                let totalTriggers = 0;
                existingTemplate.categories.forEach(category => {
                    if (category.scenarios && Array.isArray(category.scenarios)) {
                        totalScenarios += category.scenarios.length;
                        category.scenarios.forEach(scenario => {
                            if (scenario.triggers && Array.isArray(scenario.triggers)) {
                                totalTriggers += scenario.triggers.length;
                            }
                        });
                    }
                });
                
                existingTemplate.stats = {
                    totalCategories: existingTemplate.categories.length,
                    totalScenarios,
                    totalTriggers
                };
                
                logger.info(`📊 [SEED API] Calculated stats: ${totalScenarios} scenarios, ${totalTriggers} triggers`);
                
                // ✅ RESTORE Twilio config (preserve user settings)
                if (twilioBackup) {
                    existingTemplate.twilioTest = twilioBackup;
                    logger.info(`✅ [SEED API] Twilio config RESTORED`);
                } else {
                    logger.info(`ℹ️  [SEED API] No Twilio config to restore (was empty)`);
                }
                
                await existingTemplate.save();
                await CacheHelper.invalidateTemplate(existingTemplate._id);
                template = existingTemplate;
                
                logger.info(`✅ [SEED API] Template UPDATED (categories/scenarios refreshed, Twilio preserved)`);
            } else {
                // No existing template found, create fresh
                logger.info(`📝 [SEED API] No existing template found, creating fresh...`);
                template = new GlobalInstantResponseTemplate(templateData);
                await template.save();
                await CacheHelper.invalidateTemplate(template._id);
                logger.info(`✅ [SEED API] Template CREATED from scratch`);
            }
        } else {
            // replaceExisting = false, always create new
            logger.info(`📝 [SEED API] Creating new template (replaceExisting=false)...`);
            template = new GlobalInstantResponseTemplate(templateData);
            await template.save();
            await CacheHelper.invalidateTemplate(template._id);
            logger.info(`✅ [SEED API] Template CREATED`);
        }
        
        logger.info(`✅ [SEED API] Template created successfully!`);
        logger.info(`📊 [SEED API] Template ID: ${template._id}`);
        logger.info(`📊 [SEED API] Categories: ${template.categories.length}`);
        logger.info(`📊 [SEED API] Scenarios: ${template.stats.totalScenarios}`);
        
        // Return success with stats
        res.json({
            success: true,
            message: `Successfully seeded ${templateInfo.name}`,
            data: {
                templateId: template._id,
                name: template.name,
                version: template.version,
                categories: template.categories.length,
                scenarios: template.stats.totalScenarios,
                isActive: template.isActive,
                isPublished: template.isPublished,
                isDefaultTemplate: template.isDefaultTemplate
            },
            stats: {
                categoriesByName: template.categories.map(c => ({
                    name: c.name,
                    icon: c.icon,
                    scenarios: c.scenarios.length
                }))
            }
        });
        
    } catch (error) {
        logger.error('❌ [SEED API] Error seeding template:', error.message);
        logger.error(error.stack);
        res.status(500).json({
            success: false,
            message: `Failed to seed template: ${error.message}`,
            error: error.stack
        });
    }
});

/**
 * Build Universal Test Template Data
 * This is the same data from seed-templates/universal-test-12-categories.js
 * but as a reusable function for the API endpoint
 */
function buildUniversalTestTemplate(ulid) {
    return {
        version: 'v1.0.0',
        name: 'Universal AI Brain (All Industries)',
        description: 'Test template with 12 categories covering all scenario form fields',
        templateType: 'universal',
        industryLabel: 'All Industries',
        isActive: true,
        isPublished: true,
        isDefaultTemplate: true,
        
        categories: [
            // Category 1: Appointment Booking
            {
                id: `cat-${ulid()}`,
                name: 'Appointment Booking',
                icon: '📅',
                description: 'Scheduling appointments and consultations',
                behavior: 'friendly_warm',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Request Appointment',
                        isActive: true,
                        categories: ['Appointment Booking'],
                        priority: 10,
                        minConfidence: 0.7,
                        triggers: [
                            'I need an appointment',
                            'Can I schedule a visit',
                            'I want to book a time',
                            'Schedule me in',
                            'I need to see someone'
                        ],
                        negativeTriggers: [
                            'cancel appointment',
                            'reschedule',
                            'change appointment'
                        ],
                        regexTriggers: [
                            '(book|schedule|make).*appointment',
                            '(need|want).*appointment'
                        ],
                        quickReplies: [
                            'I\'d be happy to help you schedule an appointment!',
                            'Great! Let me get you scheduled.',
                            'Perfect! I can help you book a time.'
                        ],
                        fullReplies: [
                            'I\'d be happy to help you schedule an appointment. What day works best for you?',
                            'Great! Let me get you scheduled. Do you have a preferred date and time?',
                            'Perfect! I can help you book a time. When would you like to come in?'
                        ],
                        followUpFunnel: 'Is there anything else I can help you with today?',
                        entityCapture: ['preferred_date', 'preferred_time', 'customer_name'],
                        entityValidation: {
                            preferred_date: { required: true, prompt: 'What date works for you?' },
                            preferred_time: { required: true, prompt: 'What time would you prefer?' },
                            customer_name: { required: false, prompt: 'May I have your name?' }
                        },
                        dynamicVariables: {
                            '{date}': 'your preferred date',
                            '{time}': 'your preferred time',
                            '{name}': 'there'
                        },
                        actionHooks: ['offer_scheduling', 'capture_customer_info'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        cooldownSeconds: 30,
                        maxTurns: 5,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    },
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Reschedule Appointment',
                        isActive: true,
                        categories: ['Appointment Booking'],
                        priority: 8,
                        minConfidence: 0.7,
                        triggers: [
                            'I need to reschedule',
                            'Can I change my appointment',
                            'Move my appointment',
                            'Change my booking'
                        ],
                        quickReplies: [
                            'No problem! I can help you reschedule.',
                            'Of course! Let me help you find a new time.'
                        ],
                        fullReplies: [
                            'No problem! I can help you reschedule. What new date and time works better for you?',
                            'Of course! Let me help you find a new time that works. When would you prefer?'
                        ],
                        actionHooks: ['offer_scheduling'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 2: Emergency Service
            {
                id: `cat-${ulid()}`,
                name: 'Emergency Service',
                icon: '🚨',
                description: 'Urgent situations requiring immediate attention',
                behavior: 'urgent_alert',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Emergency Request',
                        isActive: true,
                        categories: ['Emergency Service'],
                        priority: 100,
                        minConfidence: 0.8,
                        triggers: [
                            'This is an emergency',
                            'I need help now',
                            'This is urgent',
                            'It\'s flooding',
                            'I have a leak',
                            'The power is out'
                        ],
                        regexTriggers: [
                            'emergency',
                            '(urgent|asap|right now|immediately)',
                            '(flood|leak|fire|smoke|gas)',
                            'not working'
                        ],
                        quickReplies: [
                            'I understand this is urgent!',
                            'This sounds like an emergency!'
                        ],
                        fullReplies: [
                            'I understand this is urgent! Let me connect you with our emergency team right away. Please stay on the line.',
                            'This sounds like an emergency! I\'m getting you to our emergency response team immediately. One moment please.'
                        ],
                        actionHooks: ['escalate_to_human', 'emergency_dispatch'],
                        handoffPolicy: 'always_on_keyword',
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        cooldownSeconds: 0,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 3: Pricing Questions
            {
                id: `cat-${ulid()}`,
                name: 'Pricing Questions',
                icon: '💰',
                description: 'Questions about costs, quotes, and pricing',
                behavior: 'professional_efficient',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'General Pricing Inquiry',
                        isActive: true,
                        categories: ['Pricing Questions'],
                        priority: 5,
                        minConfidence: 0.65,
                        triggers: [
                            'How much does it cost',
                            'What\'s your pricing',
                            'How much do you charge',
                            'What are your rates',
                            'Can you give me a quote',
                            'What does this cost'
                        ],
                        regexTriggers: [
                            '(how much|what.*cost|price|pricing|rate)',
                            'quote'
                        ],
                        quickReplies: [
                            'Great question about pricing!',
                            'I can help you with that.'
                        ],
                        fullReplies: [
                            'Great question! Our pricing depends on the specific service you need. Can you tell me a bit more about what you\'re looking for?',
                            'I can help you with that. To give you an accurate quote, could you describe what service you need?',
                            'Pricing varies based on the type of service. What specifically are you interested in?'
                        ],
                        followUpFunnel: 'Would you like me to connect you with someone who can provide a detailed quote?',
                        entityCapture: ['service_type', 'customer_location'],
                        actionHooks: ['offer_quote', 'capture_customer_info'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        cooldownSeconds: 20,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 4: Business Hours
            {
                id: `cat-${ulid()}`,
                name: 'Business Hours',
                icon: '🕐',
                description: 'Questions about availability and operating hours',
                behavior: 'friendly_warm',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Hours of Operation',
                        isActive: true,
                        categories: ['Business Hours'],
                        priority: 3,
                        minConfidence: 0.75,
                        triggers: [
                            'What are your hours',
                            'When are you open',
                            'Are you open',
                            'What time do you close',
                            'Business hours'
                        ],
                        regexTriggers: [
                            '(hours|open|close)',
                            'what time.*open'
                        ],
                        negativeTriggers: [
                            'appointment',
                            'how many hours'
                        ],
                        quickReplies: [
                            'We\'re here to help!',
                            'Thanks for asking!'
                        ],
                        fullReplies: [
                            'We\'re open Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We\'re closed on Sundays.',
                            'Our business hours are Monday to Friday, 8 in the morning until 6 in the evening, and Saturdays from 9 AM to 3 PM.',
                            'Great question! We operate Monday through Friday from 8 AM to 6 PM, and Saturday 9 AM to 3 PM. We\'re closed Sundays.'
                        ],
                        followUpFunnel: 'Would you like to schedule something during those hours?',
                        actionHooks: ['provide_business_hours'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        cooldownSeconds: 60,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 5: Hold Request
            {
                id: `cat-${ulid()}`,
                name: 'Hold Request',
                icon: '⏸️',
                description: 'Caller needs to pause or put call on hold',
                behavior: 'calm_patient',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Customer Asks to Hold',
                        isActive: true,
                        categories: ['Hold Request'],
                        priority: 7,
                        minConfidence: 0.8,
                        triggers: [
                            'Hold on',
                            'Wait a second',
                            'Can you hold',
                            'Give me a moment',
                            'One second',
                            'Just a minute'
                        ],
                        regexTriggers: [
                            '(hold|wait|moment|second|minute)'
                        ],
                        quickReplies: [
                            'Of course! Take your time.',
                            'No problem! I\'ll wait.'
                        ],
                        fullReplies: [
                            'Of course! Take your time. I\'ll be right here when you\'re ready.',
                            'No problem! I\'ll wait. Just let me know when you\'re back.',
                            'Absolutely! Take all the time you need. I\'m here when you\'re ready.'
                        ],
                        timedFollowUp: {
                            enabled: true,
                            delaySeconds: 45,
                            message: 'I\'m still here! Just wanted to check if you\'re ready to continue.',
                            maxAttempts: 2,
                            intervalSeconds: 30
                        },
                        silencePolicy: {
                            timeout: 90,
                            action: 'gentle_prompt',
                            message: 'Are you still there? I\'m happy to continue helping when you\'re ready.'
                        },
                        replySelection: 'random',
                        language: 'en',
                        channel: 'voice',
                        cooldownSeconds: 10,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 6: Gratitude / Goodbye
            {
                id: `cat-${ulid()}`,
                name: 'Gratitude / Goodbye',
                icon: '👋',
                description: 'Caller expressing thanks or ending conversation',
                behavior: 'friendly_warm',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Thank You / Goodbye',
                        isActive: true,
                        categories: ['Gratitude / Goodbye'],
                        priority: 2,
                        minConfidence: 0.7,
                        triggers: [
                            'Thank you',
                            'Thanks',
                            'Goodbye',
                            'Bye',
                            'Have a good day',
                            'That\'s all I needed'
                        ],
                        regexTriggers: [
                            '(thank|thanks)',
                            '(bye|goodbye|good day)'
                        ],
                        quickReplies: [
                            'You\'re very welcome!',
                            'Happy to help!',
                            'My pleasure!'
                        ],
                        fullReplies: [
                            'You\'re very welcome! If you need anything else, don\'t hesitate to call us. Have a wonderful day!',
                            'Happy to help! Feel free to reach out anytime. Take care!',
                            'My pleasure! We\'re here whenever you need us. Have a great day!'
                        ],
                        actionHooks: ['close_conversation'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        maxTurns: 1,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 7: Complaint / Problem
            {
                id: `cat-${ulid()}`,
                name: 'Complaint / Problem',
                icon: '😟',
                description: 'Customer dissatisfaction or service issues',
                behavior: 'empathetic_concerned',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Service Complaint',
                        isActive: true,
                        categories: ['Complaint / Problem'],
                        priority: 15,
                        minConfidence: 0.75,
                        triggers: [
                            'I\'m not happy',
                            'I have a complaint',
                            'This is unacceptable',
                            'I\'m disappointed',
                            'I have a problem',
                            'Something went wrong',
                            'I\'m upset'
                        ],
                        regexTriggers: [
                            '(complaint|problem|issue|wrong)',
                            '(unhappy|upset|disappointed|frustrated)'
                        ],
                        quickReplies: [
                            'I\'m very sorry to hear that.',
                            'I sincerely apologize.'
                        ],
                        fullReplies: [
                            'I\'m very sorry to hear that you\'re not satisfied. Your concerns are important to us. Let me connect you with a manager who can address this properly.',
                            'I sincerely apologize for any inconvenience. I want to make sure this gets resolved for you. Let me get you to someone who can help right away.',
                            'I understand your frustration, and I\'m truly sorry. Let me escalate this to a supervisor who can give this the attention it deserves.'
                        ],
                        actionHooks: ['escalate_to_human', 'log_complaint'],
                        handoffPolicy: 'always_on_keyword',
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        maxTurns: 2,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 8: Payment Plans
            {
                id: `cat-${ulid()}`,
                name: 'Payment Plans',
                icon: '💳',
                description: 'Questions about payment options and financing',
                behavior: 'professional_efficient',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Payment Plan Inquiry',
                        isActive: true,
                        categories: ['Payment Plans'],
                        priority: 6,
                        minConfidence: 0.7,
                        triggers: [
                            'Do you offer payment plans',
                            'Can I make payments',
                            'Financing options',
                            'Pay over time',
                            'Monthly payments',
                            'Can I pay in installments'
                        ],
                        regexTriggers: [
                            '(payment plan|financing|installment)',
                            '(pay.*time|monthly payment)'
                        ],
                        quickReplies: [
                            'Absolutely!',
                            'Yes, we do!'
                        ],
                        fullReplies: [
                            'Absolutely! We offer flexible payment plans to make things easier. Let me connect you with our billing team who can discuss the best options for you.',
                            'Yes, we do! We have several financing options available. I\'ll transfer you to someone who can explain all the details.',
                            'Great question! We have payment plans that can work with your budget. Let me get you to our finance specialist.'
                        ],
                        followUpFunnel: 'Would you like to hear about our current financing promotions?',
                        actionHooks: ['transfer_to_billing', 'offer_financing'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 9: Billing Question
            {
                id: `cat-${ulid()}`,
                name: 'Billing Question',
                icon: '📋',
                description: 'Questions about invoices, charges, and billing',
                behavior: 'professional_efficient',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Billing Inquiry',
                        isActive: true,
                        categories: ['Billing Question'],
                        priority: 8,
                        minConfidence: 0.7,
                        triggers: [
                            'I have a billing question',
                            'Question about my bill',
                            'Why was I charged',
                            'My invoice',
                            'Billing issue',
                            'I was charged wrong'
                        ],
                        regexTriggers: [
                            '(bill|invoice|charge|payment)',
                            'billing'
                        ],
                        negativeTriggers: [
                            'payment plan',
                            'financing'
                        ],
                        quickReplies: [
                            'I can help with that.',
                            'Let me assist you with billing.'
                        ],
                        fullReplies: [
                            'I can help with that. Let me connect you with our billing department so they can review your account and answer your questions.',
                            'I understand you have a billing question. Let me transfer you to our billing specialist who can look into this for you.',
                            'Of course! Our billing team can help with that. Let me get you connected right away.'
                        ],
                        actionHooks: ['transfer_to_billing', 'log_billing_inquiry'],
                        handoffPolicy: 'always_on_keyword',
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 10: General Inquiry
            {
                id: `cat-${ulid()}`,
                name: 'General Inquiry',
                icon: '❓',
                description: 'Non-specific questions and general information',
                behavior: 'friendly_warm',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'General Question',
                        isActive: true,
                        categories: ['General Inquiry'],
                        priority: 1,
                        minConfidence: 0.5,
                        triggers: [
                            'I have a question',
                            'Can you help me',
                            'I need information',
                            'Tell me about',
                            'I want to know'
                        ],
                        quickReplies: [
                            'I\'m here to help!',
                            'Happy to assist!'
                        ],
                        fullReplies: [
                            'I\'m here to help! What can I assist you with today?',
                            'Happy to assist! What would you like to know?',
                            'Of course! What information are you looking for?'
                        ],
                        followUpFunnel: 'Is there something specific I can help you with?',
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 11: Small Talk / Off-Topic
            {
                id: `cat-${ulid()}`,
                name: 'Small Talk / Off-Topic',
                icon: '💬',
                description: 'Casual conversation not related to business',
                behavior: 'friendly_casual',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Casual Conversation',
                        isActive: true,
                        categories: ['Small Talk / Off-Topic'],
                        priority: 0,
                        minConfidence: 0.6,
                        triggers: [
                            'How are you',
                            'Nice weather',
                            'How\'s your day',
                            'What\'s up',
                            'How\'s it going'
                        ],
                        negativeTriggers: [
                            'appointment',
                            'service',
                            'help',
                            'question',
                            'problem'
                        ],
                        quickReplies: [
                            'I\'m doing well, thanks!',
                            'All good here!'
                        ],
                        fullReplies: [
                            'I\'m doing well, thanks for asking! How can I help you today?',
                            'All good here! What brings you in today?',
                            'I\'m great, thank you! What can I assist you with?'
                        ],
                        followUpFunnel: 'So, what can I help you with today?',
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        cooldownSeconds: 300,
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            },
            
            // Category 12: Confused / Uncertain
            {
                id: `cat-${ulid()}`,
                name: 'Confused / Uncertain',
                icon: '🤔',
                description: 'Caller is unsure or needs guidance',
                behavior: 'calm_patient',
                isActive: true,
                scenarios: [
                    {
                        scenarioId: `scn-${ulid()}`,
                        version: 1,
                        status: 'live',
                        name: 'Customer Unsure',
                        isActive: true,
                        categories: ['Confused / Uncertain'],
                        priority: 4,
                        minConfidence: 0.65,
                        triggers: [
                            'I\'m not sure',
                            'I don\'t know',
                            'Maybe',
                            'I\'m confused',
                            'I\'m not certain',
                            'I think'
                        ],
                        regexTriggers: [
                            '(not sure|don\'t know|maybe|confused|uncertain)',
                            'I think'
                        ],
                        quickReplies: [
                            'No worries!',
                            'That\'s okay!'
                        ],
                        fullReplies: [
                            'No worries at all! Let me help you figure out what you need. Can you tell me a bit more about your situation?',
                            'That\'s completely okay! I\'m here to guide you. What brings you in today?',
                            'No problem! Let\'s work through this together. What\'s on your mind?'
                        ],
                        followUpFunnel: 'Would it help if I explained some of our services?',
                        actionHooks: ['offer_guidance'],
                        replySelection: 'random',
                        language: 'en',
                        channel: 'any',
                        createdBy: 'api-seed',
                        updatedBy: 'api-seed'
                    }
                ]
            }
        ]
    };
}

// ============================================================================
// 🔇 FILLER WORDS MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:id/filler-words
 * Get all filler words for a template
 */
router.get('/:id/filler-words', async (req, res) => {
    try {
        const { id } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(id);
        if (!template) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        
        res.json({
            success: true,
            fillerWords: template.fillerWords || [],
            count: (template.fillerWords || []).length
        });
    } catch (error) {
        logger.error('Error fetching filler words', { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/filler-words
 * Add new filler word(s) to a template
 */
router.post('/:id/filler-words', async (req, res) => {
    try {
        const { id } = req.params;
        const { words } = req.body; // Array of words or single word
        
        if (!words || (Array.isArray(words) && words.length === 0)) {
            return res.status(400).json({ success: false, message: 'No words provided' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(id);
        if (!template) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        
        // Normalize input to array
        const wordsToAdd = Array.isArray(words) ? words : [words];
        
        // Normalize and filter duplicates
        const normalizedWords = wordsToAdd
            .map(w => String(w).toLowerCase().trim())
            .filter(w => w.length > 0);
        
        // Add only new words (avoid duplicates)
        const existingWords = new Set(template.fillerWords || []);
        const newWords = normalizedWords.filter(w => !existingWords.has(w));
        
        if (newWords.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'All words already exist in filter list' 
            });
        }
        
        template.fillerWords = [...(template.fillerWords || []), ...newWords];
        template.updatedAt = new Date();
        template.lastUpdatedBy = req.user?.username || 'admin';
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Filler words added', { 
            templateId: id, 
            added: newWords.length,
            words: newWords,
            by: req.user?.username 
        });
        
        res.json({
            success: true,
            message: `Added ${newWords.length} filler word(s)`,
            fillerWords: template.fillerWords,
            addedWords: newWords,
            count: template.fillerWords.length
        });
    } catch (error) {
        logger.error('Error adding filler words', { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/admin/global-instant-responses/:id/filler-words/:word
 * Remove a filler word from a template
 */
router.delete('/:id/filler-words/:word', async (req, res) => {
    try {
        const { id, word } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(id);
        if (!template) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        
        const normalizedWord = String(word).toLowerCase().trim();
        const originalCount = (template.fillerWords || []).length;
        
        template.fillerWords = (template.fillerWords || []).filter(w => w !== normalizedWord);
        
        if (template.fillerWords.length === originalCount) {
            return res.status(404).json({ 
                success: false, 
                message: 'Filler word not found in template' 
            });
        }
        
        template.updatedAt = new Date();
        template.lastUpdatedBy = req.user?.username || 'admin';
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Filler word removed', { 
            templateId: id, 
            word: normalizedWord,
            by: req.user?.username 
        });
        
        res.json({
            success: true,
            message: `Removed filler word: "${normalizedWord}"`,
            fillerWords: template.fillerWords,
            count: template.fillerWords.length
        });
    } catch (error) {
        logger.error('Error removing filler word', { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/admin/global-instant-responses/:id/filler-words
 * Replace all filler words (bulk update)
 */
router.put('/:id/filler-words', async (req, res) => {
    try {
        const { id } = req.params;
        const { words } = req.body; // Array of words
        
        if (!Array.isArray(words)) {
            return res.status(400).json({ success: false, message: 'Words must be an array' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(id);
        if (!template) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        
        // Normalize and deduplicate
        const normalizedWords = [...new Set(
            words
                .map(w => String(w).toLowerCase().trim())
                .filter(w => w.length > 0)
        )];
        
        template.fillerWords = normalizedWords;
        template.updatedAt = new Date();
        template.lastUpdatedBy = req.user?.username || 'admin';
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Filler words replaced (bulk update)', { 
            templateId: id, 
            count: normalizedWords.length,
            by: req.user?.username 
        });
        
        res.json({
            success: true,
            message: `Updated filler words list (${normalizedWords.length} words)`,
            fillerWords: template.fillerWords,
            count: template.fillerWords.length
        });
    } catch (error) {
        logger.error('Error replacing filler words', { error: error.message });
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// URGENCY KEYWORDS CRUD - EMERGENCY DETECTION SYSTEM
// ============================================================================

/**
 * GET /:id/urgency-keywords
 * Get all urgency keywords for a template
 */
router.get('/:id/urgency-keywords', async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const keywords = template.urgencyKeywords || [];
        
        // Group by category
        const byCategory = {};
        keywords.forEach(kw => {
            const cat = kw.category || 'Uncategorized';
            if (!byCategory[cat]) {
                byCategory[cat] = [];
            }
            byCategory[cat].push(kw);
        });
        
        res.json({
            keywords,
            byCategory,
            totalCount: keywords.length,
            categories: Object.keys(byCategory)
        });
        
    } catch (error) {
        logger.error('Error fetching urgency keywords', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch urgency keywords' });
    }
});

/**
 * POST /:id/urgency-keywords
 * Add new urgency keyword
 */
router.post('/:id/urgency-keywords', async (req, res) => {
    try {
        const { word, weight, category, examples } = req.body;
        
        if (!word || typeof word !== 'string') {
            return res.status(400).json({ error: 'Keyword word is required' });
        }
        
        if (!weight || typeof weight !== 'number' || weight < 0.1 || weight > 0.5) {
            return res.status(400).json({ error: 'Weight must be between 0.1 and 0.5' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Normalize word
        const normalized = word.trim().toLowerCase();
        
        // Check for duplicates
        const existing = template.urgencyKeywords?.find(kw => kw.word === normalized);
        if (existing) {
            return res.status(400).json({ error: 'Keyword already exists' });
        }
        
        // Add new keyword
        if (!template.urgencyKeywords) {
            template.urgencyKeywords = [];
        }
        
        template.urgencyKeywords.push({
            word: normalized,
            weight,
            category: category || 'General Emergency',
            examples: examples || []
        });
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Urgency keyword added', {
            templateId: req.params.id,
            word: normalized,
            weight,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Urgency keyword added',
            keyword: template.urgencyKeywords[template.urgencyKeywords.length - 1]
        });
        
    } catch (error) {
        logger.error('Error adding urgency keyword', { error: error.message });
        res.status(500).json({ error: 'Failed to add urgency keyword' });
    }
});

/**
 * PATCH /:id/urgency-keywords/:keywordId
 * Update urgency keyword
 */
router.patch('/:id/urgency-keywords/:keywordId', async (req, res) => {
    try {
        const { word, weight, category, examples } = req.body;
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const keyword = template.urgencyKeywords?.id(req.params.keywordId);
        
        if (!keyword) {
            return res.status(404).json({ error: 'Keyword not found' });
        }
        
        // Update fields
        if (word && typeof word === 'string') {
            keyword.word = word.trim().toLowerCase();
        }
        
        if (weight !== undefined) {
            if (typeof weight !== 'number' || weight < 0.1 || weight > 0.5) {
                return res.status(400).json({ error: 'Weight must be between 0.1 and 0.5' });
            }
            keyword.weight = weight;
        }
        
        if (category) {
            keyword.category = category;
        }
        
        if (examples) {
            keyword.examples = examples;
        }
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Urgency keyword updated', {
            templateId: req.params.id,
            keywordId: req.params.keywordId,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Urgency keyword updated',
            keyword
        });
        
    } catch (error) {
        logger.error('Error updating urgency keyword', { error: error.message });
        res.status(500).json({ error: 'Failed to update urgency keyword' });
    }
});

/**
 * DELETE /:id/urgency-keywords/:keywordId
 * Delete urgency keyword
 */
router.delete('/:id/urgency-keywords/:keywordId', async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const keyword = template.urgencyKeywords?.id(req.params.keywordId);
        
        if (!keyword) {
            return res.status(404).json({ error: 'Keyword not found' });
        }
        
        // Remove keyword
        template.urgencyKeywords.pull(req.params.keywordId);
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Urgency keyword deleted', {
            templateId: req.params.id,
            keywordId: req.params.keywordId,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Urgency keyword deleted'
        });
        
    } catch (error) {
        logger.error('Error deleting urgency keyword', { error: error.message });
        res.status(500).json({ error: 'Failed to delete urgency keyword' });
    }
});

/**
 * POST /:id/urgency-keywords/seed-defaults
 * Seed default urgency keywords
 */
router.post('/:id/urgency-keywords/seed-defaults', async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Default urgency keywords
        const defaults = [
            // Critical urgency (0.5 weight)
            { word: 'emergency', weight: 0.5, category: 'Critical', examples: ['This is an emergency!', 'Emergency situation here'] },
            { word: 'urgent', weight: 0.5, category: 'Critical', examples: ['This is urgent', 'I need urgent help'] },
            { word: 'immediately', weight: 0.4, category: 'Critical', examples: ['I need help immediately', 'Come immediately'] },
            
            // Water/plumbing emergencies (0.4 weight)
            { word: 'flooding', weight: 0.4, category: 'Water Emergency', examples: ['My basement is flooding', 'Flooding in the house'] },
            { word: 'leak', weight: 0.3, category: 'Water Emergency', examples: ['There\'s a leak', 'Water leak in bathroom'] },
            { word: 'burst', weight: 0.4, category: 'Water Emergency', examples: ['Pipe burst', 'Burst water line'] },
            { word: 'overflowing', weight: 0.3, category: 'Water Emergency', examples: ['Toilet overflowing', 'Sink overflowing'] },
            
            // Electrical emergencies (0.5 weight)
            { word: 'sparking', weight: 0.5, category: 'Electrical Emergency', examples: ['Outlet sparking', 'Sparks from panel'] },
            { word: 'smoke', weight: 0.5, category: 'Safety Hazard', examples: ['I smell smoke', 'Smoke from outlet'] },
            { word: 'burning', weight: 0.5, category: 'Safety Hazard', examples: ['Burning smell', 'Something burning'] },
            
            // HVAC emergencies (0.3 weight)
            { word: 'gas', weight: 0.4, category: 'Safety Hazard', examples: ['I smell gas', 'Gas leak'] },
            { word: 'carbon', weight: 0.5, category: 'Safety Hazard', examples: ['Carbon monoxide alarm', 'CO detector going off'] },
            
            // General urgency (0.2-0.3 weight)
            { word: 'asap', weight: 0.3, category: 'High Priority', examples: ['I need someone ASAP', 'Can you come ASAP'] },
            { word: 'today', weight: 0.2, category: 'High Priority', examples: ['I need it done today', 'Can you come today'] },
            { word: 'now', weight: 0.2, category: 'High Priority', examples: ['I need help now', 'Can someone come now'] },
            { word: 'help', weight: 0.2, category: 'General', examples: ['I need help', 'Please help'] }
        ];
        
        // Clear existing and add defaults
        template.urgencyKeywords = defaults;
        
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Default urgency keywords seeded', {
            templateId: req.params.id,
            count: defaults.length,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: `Seeded ${defaults.length} default urgency keywords`,
            keywords: template.urgencyKeywords
        });
        
    } catch (error) {
        logger.error('Error seeding urgency keywords', { error: error.message });
        res.status(500).json({ error: 'Failed to seed urgency keywords' });
    }
});

// ============================================================================
// 🔤 SYNONYM MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:id/synonyms
 * Get all synonyms for a template
 */
router.get('/:id/synonyms', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Convert Map to object for JSON response
        const synonymObj = {};
        if (template.synonymMap && template.synonymMap instanceof Map) {
            for (const [term, aliases] of template.synonymMap.entries()) {
                synonymObj[term] = aliases;
            }
        }
        
        res.json({
            success: true,
            templateId: template._id,
            synonyms: synonymObj,
            count: Object.keys(synonymObj).length
        });
        
    } catch (error) {
        logger.error('Error fetching synonyms', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch synonyms' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/synonyms
 * Add a synonym mapping to a template
 * Body: { technicalTerm: "thermostat", colloquialTerms: ["thingy", "box on wall"] }
 */
router.post('/:id/synonyms', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { technicalTerm, colloquialTerms, replace } = req.body;
        
        if (!technicalTerm || !colloquialTerms || !Array.isArray(colloquialTerms)) {
            return res.status(400).json({ 
                error: 'technicalTerm (string) and colloquialTerms (array) are required' 
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        let finalTerms;
        
        if (replace) {
            // REPLACE MODE: Use only new terms (for Edit operation)
            finalTerms = [...new Set(colloquialTerms.map(t => t.toLowerCase().trim()))];
            logger.info('Replacing synonym mapping', { technicalTerm, old: template.synonymMap.get(technicalTerm.toLowerCase().trim()), new: finalTerms });
        } else {
            // MERGE MODE: Combine with existing (for Add operation)
            const existing = template.synonymMap.get(technicalTerm.toLowerCase().trim()) || [];
            finalTerms = [...new Set([
                ...existing,
                ...colloquialTerms.map(t => t.toLowerCase().trim())
            ])];
            logger.info('Merging synonym mapping', { technicalTerm, existing, added: colloquialTerms, merged: finalTerms });
        }
        
        template.synonymMap.set(technicalTerm.toLowerCase().trim(), finalTerms);
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info(replace ? 'Synonym mapping replaced in template' : 'Synonym mapping added to template', {
            templateId: template._id,
            technicalTerm,
            operation: replace ? 'replace' : 'merge',
            newTermsCount: colloquialTerms.length,
            finalTermsCount: finalTerms.length,
            by: req.user?.username
        });
        
        // ============================================
        // 📢 NOTIFY DEVELOPERS OF AI LEARNING
        // ============================================
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_SYNONYM_ADDED',
                severity: 'WARNING',
                title: replace ? '✏️ AI Learning: Synonym Edited (Manual)' : '🧠 AI Learning: Synonym Added (Manual)',
                message: replace 
                    ? `Synonym mapping updated in template.\n\nTemplate: "${template.name}"\nTechnical Term: "${technicalTerm}"\nNew Colloquial Terms: "${colloquialTerms.join(', ')}"\nTotal Terms: ${finalTerms.length}\nEdited By: ${req.user?.username || 'Unknown'}\n\nThis improves the AI's ability to understand non-technical language.`
                    : `New synonym mapping added to template.\n\nTemplate: "${template.name}"\nTechnical Term: "${technicalTerm}"\nColloquial Terms: "${colloquialTerms.join(', ')}"\nTotal Terms: ${finalTerms.length}\nAdded By: ${req.user?.username || 'Unknown'}\n\nThis improves the AI's ability to understand non-technical language.`,
                details: {
                    source: 'Manual ' + (replace ? 'Edit' : 'Addition'),
                    operation: replace ? 'replace' : 'merge',
                    templateId: template._id.toString(),
                    templateName: template.name,
                    technicalTerm,
                    colloquialTerms,
                    totalAliases: finalTerms.length,
                    modifiedBy: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send synonym notification', { error: notifError.message });
        }
        
        res.json({
            success: true,
            message: replace ? 'Synonym mapping updated' : 'Synonym mapping added',
            operation: replace ? 'replace' : 'merge',
            technicalTerm,
            aliases: finalTerms
        });
        
    } catch (error) {
        logger.error('Error adding synonym', { error: error.message });
        res.status(500).json({ error: 'Failed to add synonym' });
    }
});

/**
 * DELETE /api/admin/global-instant-responses/:id/synonyms/:term
 * Remove a synonym mapping from a template
 */
router.delete('/:id/synonyms/:term', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const term = req.params.term.toLowerCase().trim();
        
        if (!template.synonymMap.has(term)) {
            return res.status(404).json({ error: 'Synonym mapping not found' });
        }
        
        template.synonymMap.delete(term);
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Synonym removed from template', {
            templateId: template._id,
            term,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Synonym mapping removed'
        });
        
    } catch (error) {
        logger.error('Error removing synonym', { error: error.message });
        res.status(500).json({ error: 'Failed to remove synonym' });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id/categories/:categoryId/synonyms
 * Get all synonyms for a category
 */
router.get('/:id/categories/:categoryId/synonyms', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const category = template.categories.id(req.params.categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        
        // Convert Map to object
        const synonymObj = {};
        if (category.synonymMap && category.synonymMap instanceof Map) {
            for (const [term, aliases] of category.synonymMap.entries()) {
                synonymObj[term] = aliases;
            }
        }
        
        res.json({
            success: true,
            categoryId: category.id,
            categoryName: category.name,
            synonyms: synonymObj,
            count: Object.keys(synonymObj).length
        });
        
    } catch (error) {
        logger.error('Error fetching category synonyms', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch category synonyms' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/categories/:categoryId/synonyms
 * Add a synonym mapping to a category
 */
router.post('/:id/categories/:categoryId/synonyms', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { technicalTerm, colloquialTerms } = req.body;
        
        if (!technicalTerm || !colloquialTerms || !Array.isArray(colloquialTerms)) {
            return res.status(400).json({ 
                error: 'technicalTerm (string) and colloquialTerms (array) are required' 
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const category = template.categories.id(req.params.categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        
        // Get existing aliases or create empty array
        const existing = category.synonymMap.get(technicalTerm.toLowerCase().trim()) || [];
        
        // Merge and deduplicate
        const merged = [...new Set([
            ...existing,
            ...colloquialTerms.map(t => t.toLowerCase().trim())
        ])];
        
        category.synonymMap.set(technicalTerm.toLowerCase().trim(), merged);
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Synonym added to category', {
            templateId: template._id,
            categoryId: category.id,
            categoryName: category.name,
            technicalTerm,
            added: colloquialTerms.length,
            total: merged.length,
            by: req.user?.username
        });
        
        // ============================================
        // 📢 NOTIFY DEVELOPERS OF AI LEARNING
        // ============================================
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_SYNONYM_ADDED',
                severity: 'WARNING',
                title: '🧠 AI Learning: Synonym Added to Category (Manual)',
                message: `New synonym mapping added to category.\n\nTemplate: "${template.name}"\nCategory: "${category.name}"\nTechnical Term: "${technicalTerm}"\nColloquial Terms: "${colloquialTerms.join(', ')}"\nAdded By: ${req.user?.username || 'Unknown'}\n\nThis improves the AI's understanding of domain-specific colloquial terms.`,
                details: {
                    source: 'Manual Addition',
                    scope: 'Category',
                    templateId: template._id.toString(),
                    templateName: template.name,
                    categoryId: category.id,
                    categoryName: category.name,
                    technicalTerm,
                    colloquialTerms,
                    totalAliases: merged.length,
                    addedBy: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send category synonym notification', { error: notifError.message });
        }
        
        res.json({
            success: true,
            message: 'Synonym mapping added to category',
            technicalTerm,
            aliases: merged
        });
        
    } catch (error) {
        logger.error('Error adding category synonym', { error: error.message });
        res.status(500).json({ error: 'Failed to add category synonym' });
    }
});

// ============================================================================
// 🔇 FILLER WORD MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:id/fillers
 * Get all filler words for a template
 */
router.get('/:id/fillers', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({
            success: true,
            templateId: template._id,
            fillers: template.fillerWords || [],
            count: (template.fillerWords || []).length
        });
        
    } catch (error) {
        logger.error('Error fetching fillers', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch fillers' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/fillers
 * Add filler words to a template
 * Body: { fillers: ["word1", "word2"] }
 */
router.post('/:id/fillers', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { fillers } = req.body;
        
        if (!fillers || !Array.isArray(fillers)) {
            return res.status(400).json({ error: 'fillers (array) is required' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Merge and deduplicate
        const existing = template.fillerWords || [];
        const merged = [...new Set([
            ...existing,
            ...fillers.map(f => f.toLowerCase().trim())
        ])];
        
        template.fillerWords = merged;
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Fillers added to template', {
            templateId: template._id,
            added: fillers.length,
            total: merged.length,
            by: req.user?.username
        });
        
        // ============================================
        // 📢 NOTIFY DEVELOPERS OF AI LEARNING
        // ============================================
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_FILLER_ADDED',
                severity: 'WARNING',
                title: '🔇 AI Learning: Filler Words Added (Manual)',
                message: `New filler words added to template for noise removal.\n\nTemplate: "${template.name}"\nFillers Added: "${fillers.join(', ')}"\nTotal Fillers: ${merged.length}\nAdded By: ${req.user?.username || 'Unknown'}\n\nThese words will be removed from caller input before matching, improving accuracy.`,
                details: {
                    source: 'Manual Addition',
                    templateId: template._id.toString(),
                    templateName: template.name,
                    fillersAdded: fillers,
                    totalFillers: merged.length,
                    addedBy: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send filler notification', { error: notifError.message });
        }
        
        res.json({
            success: true,
            message: 'Filler words added',
            fillers: merged,
            count: merged.length
        });
        
    } catch (error) {
        logger.error('Error adding fillers', { error: error.message });
        res.status(500).json({ error: 'Failed to add fillers' });
    }
});

/**
 * DELETE /api/admin/global-instant-responses/:id/fillers
 * Remove filler words from a template
 * Body: { fillers: ["word1", "word2"] }
 */
router.delete('/:id/fillers', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { fillers } = req.body;
        
        if (!fillers || !Array.isArray(fillers)) {
            return res.status(400).json({ error: 'fillers (array) is required' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const toRemove = new Set(fillers.map(f => f.toLowerCase().trim()));
        template.fillerWords = template.fillerWords.filter(f => !toRemove.has(f.toLowerCase().trim()));
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Fillers removed from template', {
            templateId: template._id,
            removed: fillers.length,
            remaining: template.fillerWords.length,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Filler words removed',
            fillers: template.fillerWords,
            count: template.fillerWords.length
        });
        
    } catch (error) {
        logger.error('Error removing fillers', { error: error.message });
        res.status(500).json({ error: 'Failed to remove fillers' });
    }
});

/**
 * GET /api/admin/global-instant-responses/:id/categories/:categoryId/fillers
 * Get all additional filler words for a category
 */
router.get('/:id/categories/:categoryId/fillers', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const category = template.categories.id(req.params.categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        
        res.json({
            success: true,
            categoryId: category.id,
            categoryName: category.name,
            fillers: category.additionalFillerWords || [],
            count: (category.additionalFillerWords || []).length,
            effectiveCount: (template.fillerWords || []).length + (category.additionalFillerWords || []).length
        });
        
    } catch (error) {
        logger.error('Error fetching category fillers', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch category fillers' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/categories/:categoryId/fillers
 * Add filler words to a category
 * Body: { fillers: ["word1", "word2"] }
 */
router.post('/:id/categories/:categoryId/fillers', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { fillers } = req.body;
        
        if (!fillers || !Array.isArray(fillers)) {
            return res.status(400).json({ error: 'fillers (array) is required' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const category = template.categories.id(req.params.categoryId);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        
        // Merge and deduplicate
        const existing = category.additionalFillerWords || [];
        const merged = [...new Set([
            ...existing,
            ...fillers.map(f => f.toLowerCase().trim())
        ])];
        
        category.additionalFillerWords = merged;
        await template.save();
        await CacheHelper.invalidateTemplate(template._id);
        
        logger.info('Fillers added to category', {
            templateId: template._id,
            categoryId: category.id,
            categoryName: category.name,
            added: fillers.length,
            total: merged.length,
            by: req.user?.username
        });
        
        // ============================================
        // 📢 NOTIFY DEVELOPERS OF AI LEARNING
        // ============================================
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_LEARNING_FILLER_ADDED',
                severity: 'WARNING',
                title: '🔇 AI Learning: Filler Words Added to Category (Manual)',
                message: `New filler words added to category for domain-specific noise removal.\n\nTemplate: "${template.name}"\nCategory: "${category.name}"\nFillers Added: "${fillers.join(', ')}"\nTotal Category Fillers: ${merged.length}\nAdded By: ${req.user?.username || 'Unknown'}\n\nThese words will be removed from caller input (in addition to template fillers).`,
                details: {
                    source: 'Manual Addition',
                    scope: 'Category',
                    templateId: template._id.toString(),
                    templateName: template.name,
                    categoryId: category.id,
                    categoryName: category.name,
                    fillersAdded: fillers,
                    totalCategoryFillers: merged.length,
                    addedBy: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send category filler notification', { error: notifError.message });
        }
        
        res.json({
            success: true,
            message: 'Filler words added to category',
            fillers: merged,
            count: merged.length
        });
        
    } catch (error) {
        logger.error('Error adding category fillers', { error: error.message });
        res.status(500).json({ error: 'Failed to add category fillers' });
    }
});

// ============================================================================
// 🧠 INTELLIGENT SUGGESTIONS API ROUTES
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/:id/suggestions
 * Get all pending suggestions for a template
 */
router.get('/:id/suggestions', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { status, type, priority, minConfidence } = req.query;
        
        const options = {};
        if (type) options.type = type;
        if (priority) options.priority = priority;
        if (minConfidence) options.minConfidence = parseFloat(minConfidence);
        
        const suggestions = await SuggestionKnowledgeBase.getPendingSuggestions(
            req.params.id,
            options
        );
        
        const summary = await SuggestionKnowledgeBase.getSummary(req.params.id);
        
        res.json({
            success: true,
            templateId: req.params.id,
            suggestions,
            summary,
            count: suggestions.length
        });
        
    } catch (error) {
        logger.error('Error fetching suggestions', { error: error.message });
        res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/suggestions/:suggestionId/apply
 * Apply a suggestion
 */
router.post('/:id/suggestions/:suggestionId/apply', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const suggestion = await SuggestionKnowledgeBase.findById(req.params.suggestionId);
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        if (suggestion.templateId.toString() !== req.params.id) {
            return res.status(400).json({ error: 'Suggestion does not belong to this template' });
        }
        
        const result = await suggestion.apply(req.user._id);
        
        logger.info('Suggestion applied', {
            suggestionId: suggestion._id,
            type: suggestion.type,
            templateId: req.params.id,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Suggestion applied successfully',
            result
        });
        
    } catch (error) {
        logger.error('Error applying suggestion', { error: error.message });
        res.status(500).json({ error: 'Failed to apply suggestion' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/suggestions/:suggestionId/ignore
 * Ignore a suggestion
 */
router.post('/:id/suggestions/:suggestionId/ignore', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { reason } = req.body;
        
        const suggestion = await SuggestionKnowledgeBase.findById(req.params.suggestionId);
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        if (suggestion.templateId.toString() !== req.params.id) {
            return res.status(400).json({ error: 'Suggestion does not belong to this template' });
        }
        
        suggestion.status = 'ignored';
        suggestion.ignoredAt = new Date();
        suggestion.ignoredBy = req.user._id;
        suggestion.ignoredReason = reason || 'Not applicable';
        await suggestion.save();
        await CacheHelper.invalidateSuggestions(req.params.id);
        
        logger.info('Suggestion ignored', {
            suggestionId: suggestion._id,
            type: suggestion.type,
            templateId: req.params.id,
            reason,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Suggestion ignored'
        });
        
    } catch (error) {
        logger.error('Error ignoring suggestion', { error: error.message });
        res.status(500).json({ error: 'Failed to ignore suggestion' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/suggestions/:suggestionId/dismiss
 * Permanently dismiss a suggestion
 */
router.post('/:id/suggestions/:suggestionId/dismiss', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const suggestion = await SuggestionKnowledgeBase.findById(req.params.suggestionId);
        if (!suggestion) {
            return res.status(404).json({ error: 'Suggestion not found' });
        }
        
        if (suggestion.templateId.toString() !== req.params.id) {
            return res.status(400).json({ error: 'Suggestion does not belong to this template' });
        }
        
        suggestion.status = 'dismissed';
        await suggestion.save();
        await CacheHelper.invalidateSuggestions(req.params.id);
        
        logger.info('Suggestion dismissed', {
            suggestionId: suggestion._id,
            type: suggestion.type,
            templateId: req.params.id,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Suggestion dismissed permanently'
        });
        
    } catch (error) {
        logger.error('Error dismissing suggestion', { error: error.message });
        res.status(500).json({ error: 'Failed to dismiss suggestion' });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/suggestions/apply-all-high
 * Apply all high-confidence suggestions (90%+)
 */
router.post('/:id/suggestions/apply-all-high', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const suggestions = await SuggestionKnowledgeBase.getPendingSuggestions(
            req.params.id,
            { minConfidence: 0.9 }
        );
        
        if (suggestions.length === 0) {
            return res.json({
                success: true,
                message: 'No high-confidence suggestions found',
                applied: 0,
                failed: 0
            });
        }
        
        let applied = 0;
        let failed = 0;
        const errors = [];
        
        for (const suggestion of suggestions) {
            try {
                await suggestion.apply(req.user._id);
                applied++;
                
                logger.info('Auto-applied high-confidence suggestion', {
                    suggestionId: suggestion._id,
                    type: suggestion.type,
                    confidence: suggestion.confidence,
                    templateId: req.params.id,
                    by: req.user?.username
                });
                
            } catch (error) {
                failed++;
                errors.push({
                    suggestionId: suggestion._id,
                    type: suggestion.type,
                    error: error.message
                });
                
                logger.error('Failed to apply suggestion', {
                    suggestionId: suggestion._id,
                    error: error.message
                });
            }
        }
        
        // Send notification about bulk apply
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_SUGGESTIONS_BULK_APPLIED',
                severity: 'INFO',
                title: '🟣 AI Suggestions Bulk Applied',
                message: `${applied} high-confidence suggestions applied automatically`,
                context: {
                    templateId: req.params.id,
                    applied,
                    failed,
                    confidence: '90%+',
                    by: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send bulk apply notification', { error: notifError.message });
        }
        
        logger.info('Bulk apply complete', {
            templateId: req.params.id,
            total: suggestions.length,
            applied,
            failed,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: `Applied ${applied} of ${suggestions.length} suggestions`,
            applied,
            failed,
            errors: failed > 0 ? errors : undefined
        });
        
    } catch (error) {
        logger.error('Error in bulk apply', { error: error.message });
        
        // Send critical notification
        try {
            await AdminNotificationService.sendAlert({
                code: 'AI_SUGGESTIONS_BULK_APPLY_FAILED',
                severity: 'CRITICAL',
                title: '❌ AI Suggestions Bulk Apply Failed',
                message: 'Failed to apply high-confidence suggestions',
                context: {
                    templateId: req.params.id,
                    error: error.message,
                    by: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send error notification', { error: notifError.message });
        }
        
        res.status(500).json({ error: 'Failed to apply suggestions', details: error.message });
    }
});

// ============================================================================
// 🟣 AI SUGGESTION ANALYSIS API - FULL CONTEXT FOR MODAL
// ============================================================================

/**
 * GET /api/admin/global-instant-responses/suggestions/:suggestionId/context
 * Get full context for a suggestion (call transcript, LLM reasoning, impact metrics)
 * Used to populate the analysis modal
 */
router.get('/suggestions/:suggestionId/context', authenticateJWT, adminOnly, async (req, res) => {
    try {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 1: Validate suggestion ID
        // ────────────────────────────────────────────────────────────────────
        
        if (!req.params.suggestionId) {
            logger.warn('[SUGGESTION CONTEXT API] Missing suggestion ID');
            
            try {
                await AdminNotificationService.sendAlert({
                    code: 'SUGGESTION_CONTEXT_API_VALIDATION_ERROR',
                    severity: 'WARNING',
                    title: '⚠️ Suggestion Context API: Validation Error',
                    message: 'Missing required suggestionId parameter',
                    context: {
                        endpoint: '/suggestions/:suggestionId/context',
                        by: req.user?.username
                    }
                });
            } catch (notifError) {
                logger.error('Failed to send validation error notification', { error: notifError.message });
            }
            
            return res.status(400).json({ error: 'suggestionId is required' });
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 2: Fetch context using SuggestionAnalysisService
        // ────────────────────────────────────────────────────────────────────
        
        logger.info('[SUGGESTION CONTEXT API] Fetching context', {
            suggestionId: req.params.suggestionId,
            by: req.user?.username
        });
        
        const SuggestionAnalysisService = require('../../services/SuggestionAnalysisService');
        const context = await SuggestionAnalysisService.fetchSuggestionContext(req.params.suggestionId);
        
        if (!context || !context.success) {
            logger.error('[SUGGESTION CONTEXT API] Context not found or invalid', {
                suggestionId: req.params.suggestionId
            });
            
            return res.status(404).json({ error: 'Suggestion context not found' });
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 3: Return formatted context
        // ────────────────────────────────────────────────────────────────────
        
        logger.info('[SUGGESTION CONTEXT API] Context fetched successfully', {
            suggestionId: req.params.suggestionId,
            hasCall: !!context.call,
            hasReasoning: !!context.suggestion.llmReasoning,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            ...context
        });
        
    } catch (error) {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 4: Error handling with notification
        // ────────────────────────────────────────────────────────────────────
        
        logger.error('[SUGGESTION CONTEXT API] Error fetching context', {
            suggestionId: req.params.suggestionId,
            error: error.message,
            stack: error.stack
        });
        
        try {
            await AdminNotificationService.sendAlert({
                code: 'SUGGESTION_CONTEXT_API_ERROR',
                severity: 'CRITICAL',
                title: '❌ Suggestion Context API: System Error',
                message: `Failed to fetch suggestion context: ${error.message}`,
                context: {
                    suggestionId: req.params.suggestionId,
                    error: error.message,
                    by: req.user?.username
                }
            });
        } catch (notifError) {
            logger.error('Failed to send error notification', { error: notifError.message });
        }
        
        res.status(500).json({
            error: 'Failed to fetch suggestion context',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/global-instant-responses/:id/analyze
 * Trigger pattern analysis on test calls
 * Body: { testCalls: [...] }
 */
router.post('/:id/analyze', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { testCalls } = req.body;
        
        if (!testCalls || !Array.isArray(testCalls)) {
            return res.status(400).json({ error: 'testCalls (array) is required' });
        }
        
        const result = await IntelligentPatternDetector.analyzeTestCalls(
            testCalls,
            req.params.id
        );
        
        logger.info('Pattern analysis complete', {
            templateId: req.params.id,
            callsAnalyzed: testCalls.length,
            suggestionsGenerated: result.totalSuggestions,
            by: req.user?.username
        });
        
        res.json({
            success: true,
            message: 'Pattern analysis complete',
            ...result
        });
        
    } catch (error) {
        logger.error('Error analyzing patterns', { error: error.message });
        res.status(500).json({ error: 'Failed to analyze patterns' });
    }
});

// ============================================================================
// 📊 TEST REPORT EXPORT API
// ============================================================================

/**
 * POST /api/admin/global-instant-responses/:id/test-report
 * Generate a detailed test report (Markdown or JSON)
 * Body: { testResults: {...}, format: 'markdown' | 'json' }
 */
router.post('/:id/test-report', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { testResults, format } = req.body;
        
        if (!testResults) {
            return res.status(400).json({ error: 'testResults is required' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        if (format === 'json') {
            // JSON format
            const report = {
                template: {
                    id: template._id,
                    name: template.name,
                    version: template.version
                },
                generatedAt: new Date().toISOString(),
                generatedBy: req.user?.username,
                testResults,
                summary: {
                    totalTests: testResults.tests?.length || 0,
                    passed: testResults.tests?.filter(t => t.matched).length || 0,
                    failed: testResults.tests?.filter(t => !t.matched).length || 0,
                    avgConfidence: testResults.tests?.reduce((sum, t) => sum + (t.confidence || 0), 0) / (testResults.tests?.length || 1)
                }
            };
            
            res.json({
                success: true,
                report,
                format: 'json'
            });
            
        } else {
            // Markdown format
            const report = generateMarkdownReport(template, testResults, req.user?.username);
            
            res.json({
                success: true,
                report,
                format: 'markdown'
            });
        }
        
    } catch (error) {
        logger.error('Error generating test report', { error: error.message });
        res.status(500).json({ error: 'Failed to generate test report' });
    }
});

/**
 * Helper: Generate Markdown test report
 */
function generateMarkdownReport(template, testResults, username) {
    const now = new Date().toISOString();
    const tests = testResults.tests || [];
    const passed = tests.filter(t => t.matched).length;
    const failed = tests.filter(t => !t.matched).length;
    const avgConfidence = tests.reduce((sum, t) => sum + (t.confidence || 0), 0) / (tests.length || 1);
    
    let markdown = `# 🧪 AI Test Report - ${template.name}\n\n`;
    markdown += `**Generated:** ${now}  \n`;
    markdown += `**Generated By:** ${username}  \n`;
    markdown += `**Template ID:** ${template._id}  \n`;
    markdown += `**Template Version:** ${template.version || 1}  \n\n`;
    
    markdown += `---\n\n`;
    markdown += `## 📊 Test Summary\n\n`;
    markdown += `| Metric | Value |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Total Tests | ${tests.length} |\n`;
    markdown += `| ✅ Passed | ${passed} (${((passed/tests.length)*100).toFixed(1)}%) |\n`;
    markdown += `| ❌ Failed | ${failed} (${((failed/tests.length)*100).toFixed(1)}%) |\n`;
    markdown += `| 📈 Avg Confidence | ${(avgConfidence * 100).toFixed(1)}% |\n\n`;
    
    if (failed > 0) {
        markdown += `---\n\n`;
        markdown += `## ❌ Failed Tests\n\n`;
        
        const failedTests = tests.filter(t => !t.matched);
        failedTests.forEach((test, idx) => {
            markdown += `### ${idx + 1}. ${test.phrase || 'Unknown phrase'}\n\n`;
            markdown += `**Expected:** ${test.expectedScenario || 'N/A'}  \n`;
            markdown += `**Actual:** ${test.matchedScenario || 'No match'}  \n`;
            markdown += `**Confidence:** ${((test.confidence || 0) * 100).toFixed(1)}%  \n\n`;
            
            if (test.trace) {
                markdown += `**Normalized Input:** \`${test.trace.normalizedPhrase || ''}\`  \n`;
                markdown += `**Terms Extracted:** ${test.trace.phraseTerms?.length || 0}  \n\n`;
            }
        });
    }
    
    markdown += `---\n\n`;
    markdown += `## ✅ Passed Tests\n\n`;
    
    const passedTests = tests.filter(t => t.matched);
    passedTests.forEach((test, idx) => {
        markdown += `${idx + 1}. **${test.phrase?.substring(0, 60)}...** → ${test.matchedScenario} (${((test.confidence || 0) * 100).toFixed(0)}%)\n`;
    });
    
    markdown += `\n---\n\n`;
    markdown += `## 🔍 Recommendations\n\n`;
    
    if (failed > 0) {
        markdown += `- **${failed} tests failed.** Review normalized inputs and add missing keywords.\n`;
    }
    
    if (avgConfidence < 0.7) {
        markdown += `- **Low average confidence (${(avgConfidence * 100).toFixed(1)}%).** Consider adding more keywords or synonyms.\n`;
    }
    
    if (failed === 0 && avgConfidence >= 0.8) {
        markdown += `- **🎉 Excellent performance!** All tests passed with high confidence.\n`;
    }
    
    markdown += `\n---\n\n`;
    markdown += `*Report generated by ClientsVia AI Testing System*\n`;
    
    return markdown;
}

// ============================================================================
// 🧠 LEARNING SETTINGS API
// ============================================================================

/**
 * PATCH /api/admin/global-instant-responses/:id/learning-settings
 * Update AI learning and sharing settings for a template
 * Body: { learningSettings: { ... } }
 */
router.patch('/:id/learning-settings', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { learningSettings } = req.body;
        
        if (!learningSettings || typeof learningSettings !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'learningSettings object is required'
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(req.params.id);
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        // Validate thresholds
        if (learningSettings.tier1Threshold !== undefined) {
            const val = parseFloat(learningSettings.tier1Threshold);
            if (val < 0.6 || val > 0.95) {
                return res.status(400).json({
                    success: false,
                    error: 'tier1Threshold must be between 0.6 and 0.95'
                });
            }
            template.learningSettings.tier1Threshold = val;
        }
        
        if (learningSettings.tier2Threshold !== undefined) {
            const val = parseFloat(learningSettings.tier2Threshold);
            if (val < 0.4 || val > 0.8) {
                return res.status(400).json({
                    success: false,
                    error: 'tier2Threshold must be between 0.4 and 0.8'
                });
            }
            template.learningSettings.tier2Threshold = val;
        }
        
        // Ensure tier2Threshold < tier1Threshold
        if (template.learningSettings.tier2Threshold >= template.learningSettings.tier1Threshold) {
            return res.status(400).json({
                success: false,
                error: 'tier2Threshold must be less than tier1Threshold'
            });
        }
        
        // Update sharing settings (checkboxes)
        if (learningSettings.shareWithinIndustry !== undefined) {
            template.learningSettings.shareWithinIndustry = Boolean(learningSettings.shareWithinIndustry);
        }
        
        if (learningSettings.proposeForGlobal !== undefined) {
            template.learningSettings.proposeForGlobal = Boolean(learningSettings.proposeForGlobal);
        }
        
        // Update budget controls
        if (learningSettings.llmBudgetMonthly !== undefined) {
            const val = parseFloat(learningSettings.llmBudgetMonthly);
            if (val < 0 || val > 10000) {
                return res.status(400).json({
                    success: false,
                    error: 'llmBudgetMonthly must be between 0 and 10000'
                });
            }
            template.learningSettings.llmBudgetMonthly = val;
        }
        
        if (learningSettings.llmCostPerCall !== undefined) {
            const val = parseFloat(learningSettings.llmCostPerCall);
            if (val < 0.01 || val > 5.0) {
                return res.status(400).json({
                    success: false,
                    error: 'llmCostPerCall must be between 0.01 and 5.0'
                });
            }
            template.learningSettings.llmCostPerCall = val;
        }
        
        // Update quality filters
        if (learningSettings.minPatternFrequency !== undefined) {
            const val = parseInt(learningSettings.minPatternFrequency);
            if (val < 1 || val > 20) {
                return res.status(400).json({
                    success: false,
                    error: 'minPatternFrequency must be between 1 and 20'
                });
            }
            template.learningSettings.minPatternFrequency = val;
        }
        
        if (learningSettings.industryShareThreshold !== undefined) {
            const val = parseFloat(learningSettings.industryShareThreshold);
            if (val < 0.7 || val > 0.95) {
                return res.status(400).json({
                    success: false,
                    error: 'industryShareThreshold must be between 0.7 and 0.95'
                });
            }
            template.learningSettings.industryShareThreshold = val;
        }
        
        if (learningSettings.globalProposeThreshold !== undefined) {
            const val = parseFloat(learningSettings.globalProposeThreshold);
            if (val < 0.85 || val > 0.98) {
                return res.status(400).json({
                    success: false,
                    error: 'globalProposeThreshold must be between 0.85 and 0.98'
                });
            }
            template.learningSettings.globalProposeThreshold = val;
        }
        
        // Ensure globalProposeThreshold > industryShareThreshold
        if (template.learningSettings.globalProposeThreshold <= template.learningSettings.industryShareThreshold) {
            return res.status(400).json({
                success: false,
                error: 'globalProposeThreshold must be greater than industryShareThreshold'
            });
        }
        
        if (learningSettings.autoApproveIndustry !== undefined) {
            template.learningSettings.autoApproveIndustry = Boolean(learningSettings.autoApproveIndustry);
        }
        
        await template.save();
        await CacheHelper.invalidateBulk({ 
            templateId: template._id, 
            llmMetrics: true 
        });
        
        logger.info('✅ [LEARNING SETTINGS] Settings updated', {
            templateId: template._id,
            templateName: template.name,
            updatedBy: req.user?.username,
            changes: learningSettings
        });
        
        res.json({
            success: true,
            message: 'Learning settings updated successfully',
            learningSettings: template.learningSettings
        });
        
    } catch (error) {
        logger.error('❌ [LEARNING SETTINGS] Error updating settings', {
            templateId: req.params.id,
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;


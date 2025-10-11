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
const { enhanceTemplate } = require('../../services/globalAIBrainEnhancer');
const logger = require('../../utils/logger');

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
            .select('version name description templateType industryLabel isActive isPublished isDefaultTemplate stats createdAt updatedAt createdBy lastUpdatedBy lineage')
            .sort({ createdAt: -1 })
            .lean();
        
        console.log(`✅ Retrieved ${templates.length} global templates`);
        console.log(`   Default template: ${templates.find(t => t.isDefaultTemplate)?.name || 'NONE'}`);
        
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
        console.error('❌ Error fetching published templates:', error.message);
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
        
        console.log(`✅ Cloned template ${id} for industry ${templateType}`);
        
        res.status(201).json({
            success: true,
            message: `Template cloned successfully for ${templateType}`,
            data: clonedTemplate
        });
    } catch (error) {
        console.error('❌ Error cloning template for industry:', error.message, error.stack);
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
        
        console.log(`✅ Set default template: ${template.name} (${template.version}) by ${adminUser}`);
        
        res.json({
            success: true,
            message: `Template "${template.name}" set as default successfully`,
            data: template
        });
    } catch (error) {
        console.error('❌ Error setting default template:', error.message, error.stack);
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
            const updatedTemplate = await GlobalInstantResponseTemplate.findByIdAndUpdate(
                id,
                {
                    $set: {
                        'twilioTest.enabled': updates.twilioTest.enabled || false,
                        'twilioTest.phoneNumber': updates.twilioTest.phoneNumber || null,
                        'twilioTest.accountSid': updates.twilioTest.accountSid || null,
                        'twilioTest.authToken': updates.twilioTest.authToken || null,
                        'twilioTest.notes': updates.twilioTest.notes || ''
                    }
                },
                { new: true }
            );
            
            console.log(`✅ Updated Twilio test config for template ${updatedTemplate.version}`);
            
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
        
        // Prevent deletion of default template only
        if (template.isDefaultTemplate) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete the default template. Please set another template as default first.'
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

/**
 * POST /api/admin/global-instant-responses/seed
 * Seed the database with the 8-category test template
 */
router.post('/seed', authenticateJWT, async (req, res) => {
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    
    console.log('🌱 [SEED CHECKPOINT 1] Seed endpoint called by:', adminUser);
    
    try {
        console.log('🌱 [SEED CHECKPOINT 2] Checking for existing template...');
        // Check if template already exists
        const existing = await GlobalInstantResponseTemplate.findOne({ version: 'v1.0.0-test' });
        console.log('🌱 [SEED CHECKPOINT 3] Existing template found:', existing ? 'YES' : 'NO');
        
        if (existing) {
            console.log('🌱 [SEED CHECKPOINT 4] Template already exists, returning 409');
            return res.status(409).json({
                success: false,
                message: 'Test template already exists. Delete it first if you want to re-seed.'
            });
        }
        
        console.log('🌱 [SEED CHECKPOINT 5] No existing template, proceeding to create...');
        
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
        
        console.log('🌱 [SEED CHECKPOINT 6] Categories array created, total:', eightCategories.length);
        
        // Create the template
        console.log('🌱 [SEED CHECKPOINT 7] Creating new GlobalInstantResponseTemplate document...');
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
        
        console.log('🌱 [SEED CHECKPOINT 8] Template document created, attempting to save to MongoDB...');
        await template.save();
        console.log('🌱 [SEED CHECKPOINT 9] ✅ Template saved successfully to database!');
        console.log('🌱 [SEED CHECKPOINT 10] Template ID:', template._id);
        console.log('🌱 [SEED CHECKPOINT 11] Stats - Categories:', template.stats.totalCategories, 'Scenarios:', template.stats.totalScenarios, 'Triggers:', template.stats.totalTriggers);
        
        console.log(`✅ Seeded 8-category template by ${adminUser}`);
        
        console.log('🌱 [SEED CHECKPOINT 12] Sending success response to client...');
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
        console.log('🌱 [SEED CHECKPOINT 13] ✅ Success response sent!');
    } catch (error) {
        console.error('❌ [SEED CHECKPOINT ERROR] Seeding failed at some point!');
        console.error('❌ [SEED ERROR DETAILS] Message:', error.message);
        console.error('❌ [SEED ERROR DETAILS] Stack:', error.stack);
        console.error('❌ [SEED ERROR DETAILS] Full error object:', JSON.stringify(error, null, 2));
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
        
        console.log(`🔍 Checked parent updates for ${template.name}: ${updateInfo.hasUpdates ? 'YES' : 'NO'}`);
        
        res.json({
            success: true,
            hasParent: true,
            ...updateInfo
        });
    } catch (error) {
        console.error('❌ Error checking parent updates:', error.message);
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
        
        console.log(`🔍 Compared ${template.name} with parent:`, {
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
        console.error('❌ Error comparing with parent:', error.message);
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
        console.error('❌ Error fetching lineage:', error.message);
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
        console.log(`🔄 [SYNC] Starting sync for template ${id} by ${adminUser}`);
        console.log(`📥 [SYNC] Scenarios to sync:`, scenariosToSync);

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
                console.log(`⚠️ [SYNC] Scenario ${scenarioId} not found in parent template, skipping`);
                continue;
            }

            // Find matching category in child template
            let childCategory = childTemplate.categories.find(c => c.id === categoryId);

            if (!childCategory) {
                // Category doesn't exist in child, create it
                console.log(`➕ [SYNC] Creating new category: ${parentCategory.name}`);
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
                console.log(`🔄 [SYNC] Replacing existing scenario: ${parentScenario.name}`);
                childCategory.scenarios[existingScenarioIndex] = JSON.parse(JSON.stringify(parentScenario));
            } else {
                // Add new scenario
                console.log(`➕ [SYNC] Adding new scenario: ${parentScenario.name}`);
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
                categoryId: categoryId,
                categoryName: parentCategory.name,
                scenarioId: scenarioId,
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

        console.log(`✅ [SYNC] Successfully synced ${syncedCount} scenarios`);

        res.json({
            success: true,
            message: `Successfully synced ${syncedCount} scenario${syncedCount > 1 ? 's' : ''}`,
            syncedCount,
            syncedItems
        });

    } catch (error) {
        console.error('❌ Error syncing scenarios:', error.message, error.stack);
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
 * POST /api/admin/global-instant-responses/:templateId/categories/:categoryId/scenarios
 * Create a new scenario within a category
 */
router.post('/:templateId/categories/:categoryId/scenarios', async (req, res) => {
    const { templateId, categoryId } = req.params;
    const scenarioData = req.body;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';

    try {
        console.log(`➕ [SCENARIO CREATE] Template: ${templateId}, Category: ${categoryId}`);
        
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

        console.log(`✅ [SCENARIO CREATE] Created: ${newScenario.name} (${newScenario.scenarioId})`);

        res.json({
            success: true,
            message: 'Scenario created successfully',
            data: newScenario
        });

    } catch (error) {
        console.error('❌ [SCENARIO CREATE] Error:', error.message, error.stack);
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
        console.log(`✏️ [SCENARIO UPDATE] Scenario: ${scenarioId}`);
        
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

        console.log(`✅ [SCENARIO UPDATE] Updated: ${scenario.name}`);

        res.json({
            success: true,
            message: 'Scenario updated successfully',
            data: scenario
        });

    } catch (error) {
        console.error('❌ [SCENARIO UPDATE] Error:', error.message, error.stack);
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
        console.log(`🗑️ [SCENARIO DELETE] Scenario: ${scenarioId}`);
        
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

        console.log(`✅ [SCENARIO DELETE] Deleted: ${scenarioName}`);

        res.json({
            success: true,
            message: 'Scenario deleted successfully'
        });

    } catch (error) {
        console.error('❌ [SCENARIO DELETE] Error:', error.message, error.stack);
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
        console.error('❌ Error fetching scenarios:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: `Error fetching scenarios: ${error.message}`
        });
    }
});

module.exports = router;


/**
 * ============================================================================
 * ADMIN GLOBAL AI BRAIN TEST CONFIGURATION API
 * ============================================================================
 * 
 * PURPOSE:
 * Manage the global Twilio test console for AI Brain templates.
 * Single source of truth for test phone configuration.
 * 
 * ARCHITECTURE CHANGE:
 * - OLD: Each template stored its own Twilio config (caused duplicates)
 * - NEW: One global config in AdminSettings routes to any template
 * 
 * BENEFITS:
 * ✅ No duplicate phone number errors
 * ✅ Static UI (doesn't reload on template switch)
 * ✅ Single test number for all templates
 * ✅ Clean data model
 * 
 * ENDPOINTS:
 * - GET    /api/admin/settings/global-ai-brain-test     - Fetch current config
 * - PATCH  /api/admin/settings/global-ai-brain-test     - Update config
 * - POST   /api/admin/settings/global-ai-brain-test/migrate  - Migrate old data
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const AdminSettings = require('../../models/AdminSettings');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
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
    logger.info(`🔐 [ADMIN AI BRAIN TEST] ${action} by ${adminUser}`);
    next();
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/admin/settings/global-ai-brain-test
 * Fetch current global AI Brain test configuration
 */
router.get('/', async (req, res) => {
    try {
        const settings = await AdminSettings.getSettings();
        const config = settings.globalAIBrainTest || {};
        
        // Populate activeTemplate details if set
        let activeTemplate = null;
        if (config.activeTemplateId) {
            activeTemplate = await GlobalInstantResponseTemplate.findById(config.activeTemplateId)
                .select('_id name version')
                .lean();
        }
        
        logger.info('✅ [AI BRAIN TEST] Config fetched', {
            enabled: config.enabled,
            hasPhone: !!config.phoneNumber,
            activeTemplateId: config.activeTemplateId,
            activeTemplateName: activeTemplate?.name || 'None'
        });
        
        res.json({
            success: true,
            data: {
                ...config,
                activeTemplate: activeTemplate
            }
        });
    } catch (error) {
        logger.error('❌ [AI BRAIN TEST] Error fetching config:', error);
        res.status(500).json({
            success: false,
            message: `Error fetching test config: ${error.message}`
        });
    }
});

/**
 * PATCH /api/admin/settings/global-ai-brain-test
 * Update global AI Brain test configuration
 */
router.patch('/', async (req, res) => {
    try {
        const adminUser = req.user?.email || req.user?.username || 'Admin';
        const updates = req.body;
        
        logger.info('📝 [AI BRAIN TEST] Updating config', {
            admin: adminUser,
            updates: {
                enabled: updates.enabled,
                mode: updates.mode,
                hasPhone: !!updates.phoneNumber,
                hasSid: !!updates.accountSid,
                hasToken: !!updates.authToken,
                activeTemplateId: updates.activeTemplateId,
                testCompanyId: updates.testCompanyId
            }
        });
        
        // Validate mode if provided
        if (updates.mode && !['template', 'company'].includes(updates.mode)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid mode: Must be "template" or "company"'
            });
        }
        
        // Validate activeTemplateId if provided
        if (updates.activeTemplateId) {
            const templateExists = await GlobalInstantResponseTemplate.findById(updates.activeTemplateId);
            if (!templateExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid activeTemplateId: Template not found'
                });
            }
        }
        
        // Validate testCompanyId if provided
        if (updates.testCompanyId) {
            const companyExists = await Company.findById(updates.testCompanyId);
            if (!companyExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid testCompanyId: Company not found'
                });
            }
        }
        
        // Get current settings
        let settings = await AdminSettings.getSettings();
        
        // Initialize globalAIBrainTest if it doesn't exist
        if (!settings.globalAIBrainTest) {
            settings.globalAIBrainTest = {};
        }
        
        // Update fields
        if (updates.enabled !== undefined) settings.globalAIBrainTest.enabled = updates.enabled;
        if (updates.mode !== undefined) settings.globalAIBrainTest.mode = updates.mode;
        if (updates.phoneNumber !== undefined) settings.globalAIBrainTest.phoneNumber = updates.phoneNumber;
        if (updates.accountSid !== undefined) settings.globalAIBrainTest.accountSid = updates.accountSid;
        if (updates.authToken !== undefined) settings.globalAIBrainTest.authToken = updates.authToken;
        if (updates.greeting !== undefined) settings.globalAIBrainTest.greeting = updates.greeting;
        if (updates.notes !== undefined) settings.globalAIBrainTest.notes = updates.notes;
        if (updates.activeTemplateId !== undefined) settings.globalAIBrainTest.activeTemplateId = updates.activeTemplateId;
        if (updates.testCompanyId !== undefined) settings.globalAIBrainTest.testCompanyId = updates.testCompanyId;
        
        // Update metadata
        settings.globalAIBrainTest.lastUpdatedBy = adminUser;
        settings.lastUpdated = new Date();
        
        // 🔧 CRITICAL: Mark nested object as modified so Mongoose saves it
        settings.markModified('globalAIBrainTest');
        
        // Save
        await settings.save();
        
        logger.info('✅ [AI BRAIN TEST] Config updated successfully');
        
        res.json({
            success: true,
            message: 'Global AI Brain test configuration updated successfully',
            data: settings.globalAIBrainTest
        });
    } catch (error) {
        logger.error('❌ [AI BRAIN TEST] Error updating config:', error);
        res.status(500).json({
            success: false,
            message: `Error updating test config: ${error.message}`
        });
    }
});

/**
 * POST /api/admin/settings/global-ai-brain-test/migrate
 * Migrate existing Twilio test data from Universal AI Brain template to global config
 */
router.post('/migrate', async (req, res) => {
    try {
        const adminUser = req.user?.email || req.user?.username || 'Admin';
        
        logger.info('🔄 [AI BRAIN TEST] Starting migration from template to AdminSettings...');
        
        // Find Universal AI Brain template (has Twilio data)
        const universalTemplate = await GlobalInstantResponseTemplate.findOne({
            name: /Universal AI Brain/i
        });
        
        if (!universalTemplate || !universalTemplate.twilioTest || !universalTemplate.twilioTest.phoneNumber) {
            return res.status(404).json({
                success: false,
                message: 'No Twilio test data found in Universal AI Brain template to migrate'
            });
        }
        
        logger.info('📦 [AI BRAIN TEST] Found source data', {
            templateId: universalTemplate._id,
            templateName: universalTemplate.name,
            phone: universalTemplate.twilioTest.phoneNumber
        });
        
        // Get AdminSettings
        let settings = await AdminSettings.getSettings();
        
        // Migrate data
        settings.globalAIBrainTest = {
            enabled: universalTemplate.twilioTest.enabled || false,
            phoneNumber: universalTemplate.twilioTest.phoneNumber || '',
            accountSid: universalTemplate.twilioTest.accountSid || '',
            authToken: universalTemplate.twilioTest.authToken || '',
            greeting: universalTemplate.twilioTest.greeting || 'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.',
            notes: universalTemplate.twilioTest.notes || '',
            activeTemplateId: universalTemplate._id, // Set to Universal AI Brain initially
            testCallCount: universalTemplate.twilioTest.testCallCount || 0,
            lastTestedAt: universalTemplate.twilioTest.lastTestedAt || null,
            createdAt: new Date(),
            lastUpdatedBy: adminUser
        };
        
        settings.lastUpdated = new Date();
        await settings.save();
        
        logger.info('✅ [AI BRAIN TEST] Migration complete!', {
            phone: settings.globalAIBrainTest.phoneNumber,
            activeTemplateId: settings.globalAIBrainTest.activeTemplateId,
            activeTemplateName: universalTemplate.name
        });
        
        res.json({
            success: true,
            message: 'Successfully migrated Twilio test config from Universal AI Brain to global config',
            data: {
                migratedFrom: {
                    templateId: universalTemplate._id,
                    templateName: universalTemplate.name
                },
                globalConfig: settings.globalAIBrainTest
            }
        });
    } catch (error) {
        logger.error('❌ [AI BRAIN TEST] Migration failed:', error);
        res.status(500).json({
            success: false,
            message: `Migration failed: ${error.message}`
        });
    }
});

module.exports = router;


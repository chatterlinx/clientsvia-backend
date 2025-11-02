/**
 * ============================================================================
 * COMPANY TEST MODE API
 * ============================================================================
 * 
 * PURPOSE:
 * Manage Company Test Mode configuration for Test Pilot.
 * Allows testing REAL company configurations before production deployment.
 * 
 * ARCHITECTURE:
 * - Test Mode 1: Template Testing (existing - Global AI Brain Test)
 * - Test Mode 2: Company Testing (new - this API)
 * 
 * KEY DIFFERENCE:
 * - Template Test: Tests template rules in isolation (no company context)
 * - Company Test: Tests FULL company setup (same as production calls!)
 * 
 * BENEFITS:
 * ✅ Test real company Q&A, placeholders, voice settings
 * ✅ Uses same Mongoose + Redis as production
 * ✅ Uses same v2AIAgentRuntime code path
 * ✅ 100% confidence: What you test = what customers get!
 * 
 * ENDPOINTS:
 * - GET    /api/admin/settings/company-test-mode          - Fetch current config
 * - PATCH  /api/admin/settings/company-test-mode          - Update config
 * - GET    /api/admin/test-pilot/companies                - List companies for dropdown
 * - GET    /api/admin/test-pilot/companies/:id            - Get company details
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const AdminSettings = require('../../models/AdminSettings');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Require authentication for all routes
 * NOTE: Admin-only access is enforced by route mounting at /api/admin/*
 */
router.use(authenticateJWT);

/**
 * Log all admin actions for audit trail
 */
router.use((req, res, next) => {
    const action = `${req.method} ${req.path}`;
    const adminUser = req.user?.email || req.user?.username || 'Unknown Admin';
    logger.info(`🔐 [ADMIN COMPANY TEST] ${action} by ${adminUser}`);
    next();
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/admin/settings/company-test-mode
 * Fetch current Company Test Mode configuration
 */
router.get('/settings/company-test-mode', async (req, res) => {
    try {
        logger.info('📋 [COMPANY TEST MODE] Fetching configuration...');
        
        const settings = await AdminSettings.getSettings();
        
        // Return company test mode config (or defaults if not set)
        const config = settings.companyTestMode || {
            enabled: false,
            phoneNumber: '',
            activeCompanyId: null,
            testOptions: {
                enableCompanyQA: true,
                enableTradeQA: true,
                enableTemplates: true,
                enable3TierIntelligence: true,
                enablePlaceholders: true,
                enablePersonality: true
            },
            testCallCount: 0,
            lastTestedAt: null
        };
        
        logger.info('✅ [COMPANY TEST MODE] Configuration fetched');
        
        res.json({
            success: true,
            config
        });
        
    } catch (error) {
        logger.error('❌ [COMPANY TEST MODE] Fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch Company Test Mode configuration',
            details: error.message
        });
    }
});

/**
 * PATCH /api/admin/settings/company-test-mode
 * Update Company Test Mode configuration
 */
router.patch('/settings/company-test-mode', async (req, res) => {
    try {
        const { enabled, phoneNumber, activeCompanyId, testOptions } = req.body;
        
        logger.info('💾 [COMPANY TEST MODE] Updating configuration...', {
            enabled,
            activeCompanyId,
            testOptions
        });
        
        // Validate company exists if provided
        if (activeCompanyId) {
            const company = await Company.findById(activeCompanyId);
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found',
                    details: `Company ID ${activeCompanyId} does not exist`
                });
            }
            logger.info(`✅ [COMPANY TEST MODE] Company validated: ${company.companyName || company.businessName}`);
        }
        
        // Get settings document
        const settings = await AdminSettings.getSettings();
        
        // Update company test mode config
        if (!settings.companyTestMode) {
            settings.companyTestMode = {};
        }
        
        if (enabled !== undefined) {
            settings.companyTestMode.enabled = enabled;
        }
        
        if (phoneNumber !== undefined) {
            settings.companyTestMode.phoneNumber = phoneNumber;
        }
        
        if (activeCompanyId !== undefined) {
            settings.companyTestMode.activeCompanyId = activeCompanyId;
        }
        
        if (testOptions !== undefined) {
            settings.companyTestMode.testOptions = {
                ...settings.companyTestMode.testOptions,
                ...testOptions
            };
        }
        
        // Update metadata
        settings.companyTestMode.lastUpdatedBy = req.user?.email || req.user?.username || 'Admin';
        settings.lastUpdated = new Date();
        settings.updatedBy = req.user?.email || req.user?.username || 'Admin';
        
        await settings.save();
        
        logger.info('✅ [COMPANY TEST MODE] Configuration saved successfully');
        
        res.json({
            success: true,
            message: 'Company Test Mode configuration updated successfully',
            config: settings.companyTestMode
        });
        
    } catch (error) {
        logger.error('❌ [COMPANY TEST MODE] Update error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update Company Test Mode configuration',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/test-pilot/companies
 * List active companies for Test Pilot dropdown (lightweight)
 */
router.get('/test-pilot/companies', async (req, res) => {
    try {
        logger.info('📋 [TEST PILOT] Fetching company list...');
        
        // Fetch only active companies with minimal data
        const companies = await Company.find({
            isDeleted: { $ne: true },
            isActive: { $ne: false }
        })
        .select('_id companyName businessName aiAgentLogic.templateId')
        .sort({ companyName: 1, businessName: 1 })
        .limit(1000) // Safety limit
        .lean();
        
        // Format for dropdown
        const formattedCompanies = companies.map(c => ({
            _id: c._id,
            name: c.companyName || c.businessName || 'Unnamed Company',
            hasTemplate: !!c.aiAgentLogic?.templateId
        }));
        
        logger.info(`✅ [TEST PILOT] Loaded ${formattedCompanies.length} companies`);
        
        res.json({
            success: true,
            companies: formattedCompanies,
            count: formattedCompanies.length
        });
        
    } catch (error) {
        logger.error('❌ [TEST PILOT] Company list error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch company list',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/test-pilot/companies/:id
 * Get detailed company info for testing
 */
router.get('/test-pilot/companies/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        logger.info(`📋 [TEST PILOT] Fetching company details: ${id}`);
        
        const company = await Company.findById(id)
            .select('_id companyName businessName aiAgentLogic')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Extract relevant testing info
        const companyInfo = {
            _id: company._id,
            name: company.companyName || company.businessName,
            template: {
                id: company.aiAgentLogic?.templateId || null,
                name: company.aiAgentLogic?.templateName || 'None assigned'
            },
            companyQA: {
                count: company.aiAgentLogic?.companyQA?.length || 0,
                hasData: (company.aiAgentLogic?.companyQA?.length || 0) > 0
            },
            tradeQA: {
                count: company.aiAgentLogic?.tradeQA?.length || 0,
                hasData: (company.aiAgentLogic?.tradeQA?.length || 0) > 0
            },
            placeholders: {
                count: company.aiAgentLogic?.placeholders?.length || 0,
                hasData: (company.aiAgentLogic?.placeholders?.length || 0) > 0
            },
            voiceSettings: {
                configured: !!company.aiAgentLogic?.voiceSettings?.voiceId,
                voiceId: company.aiAgentLogic?.voiceSettings?.voiceId || 'Default',
                speechTimeout: company.aiAgentLogic?.voiceSettings?.speechDetection?.speechTimeout || 3
            }
        };
        
        logger.info(`✅ [TEST PILOT] Company details loaded: ${companyInfo.name}`);
        
        res.json({
            success: true,
            company: companyInfo
        });
        
    } catch (error) {
        logger.error('❌ [TEST PILOT] Company details error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch company details',
            details: error.message
        });
    }
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;


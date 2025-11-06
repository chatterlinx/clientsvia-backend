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
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
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
        const { enabled, phoneNumber, greeting, activeCompanyId, testOptions } = req.body;
        
        logger.info('💾 [COMPANY TEST MODE] Updating configuration...', {
            enabled,
            activeCompanyId,
            greeting: greeting ? `${greeting.substring(0, 30)}...` : undefined,
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
        
        if (greeting !== undefined) {
            settings.companyTestMode.greeting = greeting;
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
        .select('_id companyName businessName aiAgentSettings.templateReferences')
        .sort({ companyName: 1, businessName: 1 })
        .limit(1000) // Safety limit
        .lean();
        
        // Format for dropdown
        const formattedCompanies = companies.map(c => ({
            _id: c._id,
            name: c.companyName || c.businessName || 'Unnamed Company',
            hasTemplate: Array.isArray(c.aiAgentSettings?.templateReferences) && 
                        c.aiAgentSettings.templateReferences.length > 0 &&
                        c.aiAgentSettings.templateReferences.some(ref => ref.enabled !== false)
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
 * GET /api/admin/test-pilot/companies/:id/intelligence-mode-debug
 * DIAGNOSTIC ENDPOINT: Check company's intelligence mode directly from database
 * Returns raw database value to diagnose UI/backend mismatches
 */
router.get('/test-pilot/companies/:id/intelligence-mode-debug', async (req, res) => {
    try {
        const { id } = req.params;
        logger.info(`🔍 [DIAGNOSTIC] Checking intelligence mode for: ${id}`);
        
        const company = await Company.findById(id).select('_id companyName intelligenceMode intelligenceModeHistory').lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        res.json({
            success: true,
            diagnostics: {
                companyId: company._id,
                companyName: company.companyName,
                intelligenceMode: company.intelligenceMode,
                intelligenceModeType: typeof company.intelligenceMode,
                intelligenceModeExists: company.hasOwnProperty('intelligenceMode'),
                intelligenceModeUndefined: company.intelligenceMode === undefined,
                intelligenceModeHistory: company.intelligenceModeHistory || [],
                schemaDefault: 'global',
                displayValue: company.intelligenceMode || 'global'
            }
        });
    } catch (error) {
        logger.error(`❌ [DIAGNOSTIC] Error:`, error);
        res.status(500).json({ success: false, error: error.message });
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
            .select('_id companyName businessName intelligenceMode aiAgentLogic aiAgentSettings')
            .lean();
        
        console.log('🔍🔍🔍 [TEST PILOT LOAD] ========== LOADING COMPANY ==========');
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Company ID:', id);
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Intelligence Mode:', company?.intelligenceMode || 'global (default)');
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Has aiAgentLogic:', !!company?.aiAgentLogic);
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Has productionIntelligence:', !!company?.aiAgentLogic?.productionIntelligence);
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Has smartWarmup:', !!company?.aiAgentLogic?.productionIntelligence?.smartWarmup);
        console.log('🔍🔍🔍 [TEST PILOT LOAD] smartWarmup.enabled:', company?.aiAgentLogic?.productionIntelligence?.smartWarmup?.enabled);
        console.log('🔍🔍🔍 [TEST PILOT LOAD] Full smartWarmup:', JSON.stringify(company?.aiAgentLogic?.productionIntelligence?.smartWarmup, null, 2));
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Extract relevant testing info
        const templateReferences = company.aiAgentSettings?.templateReferences || [];
        const activeTemplates = templateReferences.filter(ref => ref.enabled !== false);
        
        // Fetch FULL template details for rich UI cards
        const templatesWithDetails = await Promise.all(
            activeTemplates.map(async (ref) => {
                try {
                    const template = await GlobalInstantResponseTemplate.findById(ref.templateId)
                        .select('name description version categories stats fillerWords synonymMap createdAt updatedAt')
                        .lean();
                    
                    if (!template) return null;
                    
                    // Calculate stats
                    const totalScenarios = template.categories?.reduce((sum, cat) => 
                        sum + (cat.scenarios?.length || 0), 0) || 0;
                    
                    const totalTriggers = template.categories?.reduce((sum, cat) => {
                        const scenarioTriggers = cat.scenarios?.reduce((s, sc) => 
                            s + (sc.triggers?.length || 0), 0) || 0;
                        return sum + scenarioTriggers;
                    }, 0) || 0;
                    
                    return {
                        _id: template._id,
                        name: template.name,
                        description: template.description || 'No description',
                        version: template.version || 'v1.0.0',
                        priority: ref.priority,
                        enabled: ref.enabled,
                        stats: {
                            categories: template.categories?.length || 0,
                            scenarios: totalScenarios,
                            triggers: totalTriggers,
                            fillerWords: template.fillerWords?.length || 0,
                            synonyms: template.synonymMap?.size || 0
                        },
                        activatedAt: ref.clonedAt || template.createdAt
                    };
                } catch (error) {
                    logger.error(`❌ [TEST PILOT] Failed to load template ${ref.templateId}:`, error);
                    return null;
                }
            })
        );
        
        // Filter out failed template loads
        const loadedTemplates = templatesWithDetails.filter(t => t !== null);
        
        // ✅ TEMPLATE-BASED ARCHITECTURE: All content comes from templates
        // Company Q&A, Trade Q&A, Placeholders are now part of templates
        // Companies just reference templates via aiAgentSettings.templateReferences
        
        // Calculate company-specific customizations (overrides from templates)
        const customFillers = company.aiAgentSettings?.fillerWords?.custom || [];
        const disabledScenarioControls = (company.aiAgentSettings?.scenarioControls || [])
            .filter(sc => sc.isEnabled === false);
        const variables = company.aiAgentSettings?.variables || {};
        
        // Convert Map to Object if needed (Mongoose sometimes returns Map)
        const variablesObj = variables instanceof Map 
            ? Object.fromEntries(variables) 
            : variables;
        const variablesCount = Object.keys(variablesObj).length;
        
        // 🔍 LOOKUP DISABLED SCENARIO DETAILS - Get human-readable names
        const disabledScenariosWithDetails = await Promise.all(
            disabledScenarioControls.map(async (control) => {
                try {
                    // Find the template
                    const template = await GlobalInstantResponseTemplate.findById(control.templateId)
                        .select('name categories')
                        .lean();
                    
                    if (!template) {
                        return {
                            scenarioId: control.scenarioId,
                            scenarioName: 'Unknown Scenario',
                            templateName: 'Unknown Template',
                            category: 'Unknown',
                            trigger: null,
                            disabledAt: control.disabledAt
                        };
                    }
                    
                    // Find the specific scenario in the template
                    let foundScenario = null;
                    let foundCategory = null;
                    
                    for (const category of (template.categories || [])) {
                        const scenario = (category.scenarios || []).find(s => s.scenarioId === control.scenarioId);
                        if (scenario) {
                            foundScenario = scenario;
                            foundCategory = category.name;
                            break;
                        }
                    }
                    
                    if (!foundScenario) {
                        return {
                            scenarioId: control.scenarioId,
                            scenarioName: 'Scenario Not Found',
                            templateName: template.name,
                            category: 'Unknown',
                            trigger: null,
                            disabledAt: control.disabledAt
                        };
                    }
                    
                    return {
                        scenarioId: control.scenarioId,
                        scenarioName: foundScenario.name,
                        templateName: template.name,
                        category: foundCategory,
                        trigger: foundScenario.triggers?.[0] || null, // First trigger as example
                        disabledAt: control.disabledAt
                    };
                } catch (error) {
                    logger.error(`❌ Failed to lookup disabled scenario ${control.scenarioId}:`, error);
                    return {
                        scenarioId: control.scenarioId,
                        scenarioName: 'Error Loading',
                        templateName: 'Unknown',
                        category: 'Unknown',
                        trigger: null,
                        disabledAt: control.disabledAt
                    };
                }
            })
        );
        
        const companyInfo = {
            _id: company._id,
            name: company.companyName || company.businessName,
            intelligenceMode: company.intelligenceMode || 'global', // ✅ FIX: Include intelligenceMode for frontend UI
            templates: loadedTemplates,
            customizations: {
                customFillers: {
                    count: customFillers.length,
                    items: customFillers
                },
                disabledScenarios: {
                    count: disabledScenariosWithDetails.length,
                    items: disabledScenariosWithDetails
                },
                variables: {
                    count: variablesCount,
                    data: variablesObj,
                    configured: variablesCount > 0
                }
            },
            // ✅ FIX: Include aiAgentLogic so frontend can load productionIntelligence settings
            aiAgentLogic: company.aiAgentLogic
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


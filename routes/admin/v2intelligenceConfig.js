// ============================================================================
// CLIENTSVIA - INTELLIGENCE CONFIGURATION ROUTES
// ============================================================================
// Purpose: Manage Test Pilot Intelligence & Production Intelligence settings
// Created: 2025-11-02
// Architecture: Dual 3-Tier System (Test vs Production)
// ============================================================================

const express = require('express');
const router = express.Router();
const AdminSettings = require('../../models/AdminSettings');
const IntelligencePresetsService = require('../../services/IntelligencePresetsService');
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');

// ============================================================================
// MIDDLEWARE - Authenticate all routes
// ============================================================================
router.use(authenticateJWT);

// ============================================================================
// GET /api/admin/intelligence/presets
// ============================================================================
// PURPOSE: Get all available presets for dropdown/UI selection
// RETURNS: Array of preset metadata with descriptions, costs, recommendations
// ============================================================================
router.get('/presets', async (req, res) => {
    try {
        logger.info('📋 [INTELLIGENCE CONFIG] Fetching all preset metadata...');
        
        const presets = IntelligencePresetsService.getPresetMetadata();
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Returning ${presets.length} presets`);
        
        return res.status(200).json({
            success: true,
            presets: presets
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to fetch presets:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch intelligence presets',
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/intelligence/presets/:presetName
// ============================================================================
// PURPOSE: Get full details for a specific preset
// RETURNS: Complete preset configuration with thresholds, costs, recommendations
// ============================================================================
router.get('/presets/:presetName', async (req, res) => {
    try {
        const { presetName } = req.params;
        
        logger.info(`📋 [INTELLIGENCE CONFIG] Fetching preset: ${presetName}`);
        
        // Validate preset exists
        const validation = IntelligencePresetsService.validatePreset(presetName);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.errors[0]
            });
        }
        
        const preset = IntelligencePresetsService.getPreset(presetName);
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Returning preset: ${preset.name}`);
        
        return res.status(200).json({
            success: true,
            preset: preset
        });
        
    } catch (error) {
        logger.error(`❌ [INTELLIGENCE CONFIG] Failed to fetch preset:`, error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch preset details',
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/intelligence/test-pilot
// ============================================================================
// PURPOSE: Get current Test Pilot Intelligence configuration
// RETURNS: Current preset, thresholds, LLM config, cost controls, today's cost
// ============================================================================
router.get('/test-pilot', async (req, res) => {
    try {
        logger.info('📋 [INTELLIGENCE CONFIG] Fetching Test Pilot intelligence settings...');
        
        const adminSettings = await AdminSettings.getSettings();
        const testPilotConfig = adminSettings.testPilotIntelligence;
        
        // Check if daily cost needs to be reset
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        if (testPilotConfig.todaysCost.date !== today) {
            logger.info(`🔄 [INTELLIGENCE CONFIG] Resetting daily cost (new day: ${today})`);
            testPilotConfig.todaysCost = {
                amount: 0,
                date: today,
                tier3Calls: 0
            };
            await adminSettings.save();
        }
        
        // Get full preset details
        const presetDetails = IntelligencePresetsService.getPreset(testPilotConfig.preset);
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Current preset: ${testPilotConfig.preset}`);
        logger.info(`   Thresholds: Tier1=${testPilotConfig.thresholds.tier1}, Tier2=${testPilotConfig.thresholds.tier2}`);
        logger.info(`   Today's cost: $${testPilotConfig.todaysCost.amount.toFixed(2)} (${testPilotConfig.todaysCost.tier3Calls} Tier 3 calls)`);
        
        return res.status(200).json({
            success: true,
            config: {
                preset: testPilotConfig.preset,
                presetDetails: presetDetails,
                thresholds: testPilotConfig.thresholds,
                llmConfig: testPilotConfig.llmConfig,
                costControls: testPilotConfig.costControls,
                todaysCost: testPilotConfig.todaysCost,
                lastUpdated: testPilotConfig.lastUpdated,
                updatedBy: testPilotConfig.updatedBy,
                yoloModeActivatedAt: testPilotConfig.yoloModeActivatedAt
            }
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to fetch Test Pilot config:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch Test Pilot intelligence configuration',
            error: error.message
        });
    }
});

// ============================================================================
// PATCH /api/admin/intelligence/test-pilot
// ============================================================================
// PURPOSE: Update Test Pilot Intelligence configuration
// BODY: { preset, thresholds?, llmConfig?, costControls? }
// VALIDATIONS:
//   - Preset must exist
//   - Custom thresholds must be valid (tier1 > tier2, proper ranges)
//   - YOLO mode requires confirmation
//   - Auto-revert YOLO mode after 24h
// ============================================================================
router.patch('/test-pilot', async (req, res) => {
    try {
        const { preset, thresholds, llmConfig, costControls } = req.body;
        
        logger.info('📝 [INTELLIGENCE CONFIG] Updating Test Pilot intelligence settings...');
        logger.info(`   Requested preset: ${preset}`);
        
        // ====================================================================
        // STEP 1: VALIDATE PRESET
        // ====================================================================
        if (preset) {
            const presetValidation = IntelligencePresetsService.validatePreset(preset);
            if (!presetValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message: presetValidation.errors[0]
                });
            }
        }
        
        // ====================================================================
        // STEP 2: YOLO MODE CONFIRMATION CHECK
        // ====================================================================
        if (preset === 'yolo' && !req.body.yoloConfirmed) {
            const yoloPreset = IntelligencePresetsService.getPreset('yolo');
            
            logger.warn('⚠️ [INTELLIGENCE CONFIG] YOLO mode requires confirmation');
            
            return res.status(400).json({
                success: false,
                requiresConfirmation: true,
                message: 'YOLO mode requires confirmation',
                warnings: yoloPreset.warnings,
                estimatedCost: yoloPreset.estimatedCost,
                hint: 'Send yoloConfirmed: true in request body to proceed'
            });
        }
        
        // ====================================================================
        // STEP 3: VALIDATE CUSTOM SETTINGS (if provided)
        // ====================================================================
        if (thresholds || llmConfig) {
            const customSettings = {
                thresholds: thresholds || {},
                llmConfig: llmConfig || {},
                costControls: costControls || {}
            };
            
            const validation = IntelligencePresetsService.validateCustomSettings(customSettings);
            
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid custom settings',
                    errors: validation.errors
                });
            }
            
            if (validation.warnings.length > 0) {
                logger.warn('⚠️ [INTELLIGENCE CONFIG] Validation warnings:', validation.warnings);
            }
        }
        
        // ====================================================================
        // STEP 4: LOAD PRESET CONFIGURATION
        // ====================================================================
        const presetConfig = IntelligencePresetsService.getPreset(preset || 'balanced');
        
        // ====================================================================
        // STEP 5: BUILD UPDATE OBJECT
        // ====================================================================
        const updateData = {
            'testPilotIntelligence.preset': preset || 'balanced',
            'testPilotIntelligence.thresholds.tier1': thresholds?.tier1 ?? presetConfig.thresholds.tier1,
            'testPilotIntelligence.thresholds.tier2': thresholds?.tier2 ?? presetConfig.thresholds.tier2,
            'testPilotIntelligence.llmConfig.model': llmConfig?.model ?? presetConfig.llmConfig.model,
            'testPilotIntelligence.llmConfig.autoApply': llmConfig?.autoApply ?? presetConfig.llmConfig.autoApply,
            'testPilotIntelligence.llmConfig.maxCallsPerDay': llmConfig?.maxCallsPerDay ?? presetConfig.llmConfig.maxCallsPerDay,
            'testPilotIntelligence.llmConfig.contextWindow': llmConfig?.contextWindow ?? presetConfig.llmConfig.contextWindow,
            'testPilotIntelligence.costControls.dailyBudget': costControls?.dailyBudget ?? presetConfig.llmConfig.maxCallsPerDay ?? null,
            'testPilotIntelligence.costControls.perCallLimit': costControls?.perCallLimit ?? null,
            'testPilotIntelligence.costControls.alertThreshold': costControls?.alertThreshold ?? null,
            'testPilotIntelligence.lastUpdated': new Date(),
            'testPilotIntelligence.updatedBy': req.user?.email || 'Admin'
        };
        
        // ====================================================================
        // STEP 6: YOLO MODE ACTIVATION TIMESTAMP
        // ====================================================================
        if (preset === 'yolo') {
            updateData['testPilotIntelligence.yoloModeActivatedAt'] = new Date();
            logger.warn('🔥 [INTELLIGENCE CONFIG] YOLO MODE ACTIVATED! Auto-revert in 24 hours.');
        }
        
        // ====================================================================
        // STEP 7: SAVE TO DATABASE
        // ====================================================================
        const adminSettings = await AdminSettings.findOneAndUpdate(
            {},
            { $set: updateData },
            { new: true, upsert: true }
        );
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Test Pilot settings updated successfully`);
        logger.info(`   New preset: ${preset}`);
        logger.info(`   Tier 1 threshold: ${updateData['testPilotIntelligence.thresholds.tier1'] * 100}%`);
        logger.info(`   Tier 2 threshold: ${updateData['testPilotIntelligence.thresholds.tier2'] * 100}%`);
        logger.info(`   LLM model: ${updateData['testPilotIntelligence.llmConfig.model']}`);
        logger.info(`   Auto-apply: ${updateData['testPilotIntelligence.llmConfig.autoApply']}`);
        
        // ====================================================================
        // STEP 8: ESTIMATE COST IMPACT
        // ====================================================================
        const costEstimate = IntelligencePresetsService.estimateCost(preset, 100); // Estimate for 100 calls
        
        return res.status(200).json({
            success: true,
            message: `Intelligence preset updated to "${presetConfig.name}"`,
            config: adminSettings.testPilotIntelligence,
            presetDetails: presetConfig,
            costEstimate: costEstimate,
            warnings: preset === 'yolo' ? presetConfig.warnings : []
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to update Test Pilot config:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update Test Pilot intelligence configuration',
            error: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/intelligence/estimate-cost
// ============================================================================
// PURPOSE: Estimate cost for a given preset and call volume
// BODY: { preset, callsPerDay }
// RETURNS: Cost breakdown (daily, monthly, yearly, tier distribution)
// ============================================================================
router.post('/estimate-cost', async (req, res) => {
    try {
        const { preset, callsPerDay } = req.body;
        
        if (!preset || !callsPerDay) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: preset, callsPerDay'
            });
        }
        
        logger.info(`💰 [INTELLIGENCE CONFIG] Estimating cost for preset "${preset}" with ${callsPerDay} calls/day`);
        
        const estimate = IntelligencePresetsService.estimateCost(preset, callsPerDay);
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Estimated cost: ${estimate.monthly.costRange}/month`);
        
        return res.status(200).json({
            success: true,
            estimate: estimate
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to estimate cost:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to estimate cost',
            error: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/intelligence/recommend-preset
// ============================================================================
// PURPOSE: Get a recommended preset based on template/company criteria
// BODY: { templateAge, currentMatchRate, monthlyCallVolume, monthlyBudget, primaryGoal }
// RETURNS: Recommended preset with reasoning and alternatives
// ============================================================================
router.post('/recommend-preset', async (req, res) => {
    try {
        const criteria = req.body;
        
        logger.info('🤖 [INTELLIGENCE CONFIG] Generating preset recommendation...');
        logger.info(`   Criteria:`, criteria);
        
        const recommendation = IntelligencePresetsService.recommendPreset(criteria);
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Recommended: ${recommendation.recommendedPreset}`);
        logger.info(`   Reasoning: ${recommendation.reasoning.join(', ')}`);
        
        return res.status(200).json({
            success: true,
            recommendation: recommendation
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to generate recommendation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate preset recommendation',
            error: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/intelligence/compare-presets
// ============================================================================
// PURPOSE: Compare two presets side-by-side
// BODY: { preset1, preset2 }
// RETURNS: Comparison matrix with thresholds, costs, models, etc.
// ============================================================================
router.post('/compare-presets', async (req, res) => {
    try {
        const { preset1, preset2 } = req.body;
        
        if (!preset1 || !preset2) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: preset1, preset2'
            });
        }
        
        logger.info(`📊 [INTELLIGENCE CONFIG] Comparing presets: ${preset1} vs ${preset2}`);
        
        const comparison = IntelligencePresetsService.comparePresets(preset1, preset2);
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Comparison generated`);
        
        return res.status(200).json({
            success: true,
            comparison: comparison
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to compare presets:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to compare presets',
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/intelligence/cost-tracking
// ============================================================================
// PURPOSE: Get real-time cost tracking for Test Pilot
// RETURNS: Today's cost, Tier 3 call count, budget status, alerts
// ============================================================================
router.get('/cost-tracking', async (req, res) => {
    try {
        logger.info('💰 [INTELLIGENCE CONFIG] Fetching cost tracking data...');
        
        const adminSettings = await AdminSettings.getSettings();
        const testPilotConfig = adminSettings.testPilotIntelligence;
        
        // Check if daily cost needs to be reset
        const today = new Date().toISOString().split('T')[0];
        let costData = testPilotConfig.todaysCost;
        
        if (costData.date !== today) {
            costData = {
                amount: 0,
                date: today,
                tier3Calls: 0
            };
            adminSettings.testPilotIntelligence.todaysCost = costData;
            await adminSettings.save();
        }
        
        // Calculate budget status
        const dailyBudget = testPilotConfig.costControls.dailyBudget;
        const alertThreshold = testPilotConfig.costControls.alertThreshold;
        
        const budgetStatus = {
            currentCost: costData.amount,
            dailyBudget: dailyBudget,
            percentUsed: dailyBudget ? (costData.amount / dailyBudget * 100).toFixed(1) : null,
            remaining: dailyBudget ? (dailyBudget - costData.amount).toFixed(2) : null,
            isOverBudget: dailyBudget ? costData.amount >= dailyBudget : false,
            isNearAlert: alertThreshold ? costData.amount >= alertThreshold : false
        };
        
        logger.info(`✅ [INTELLIGENCE CONFIG] Current cost: $${costData.amount.toFixed(2)} (${costData.tier3Calls} Tier 3 calls)`);
        
        return res.status(200).json({
            success: true,
            costTracking: {
                today: costData,
                budget: budgetStatus,
                preset: testPilotConfig.preset,
                lastUpdated: new Date()
            }
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE CONFIG] Failed to fetch cost tracking:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch cost tracking data',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = router;


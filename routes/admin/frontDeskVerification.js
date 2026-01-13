/**
 * frontDeskVerification.js
 * V57: API endpoint for deep Front Desk verification
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { verifyFrontDesk } = require('../../services/verification/FrontDeskVerifier');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const { PRESET_VERSION, ALLOWED_PLACEHOLDERS, getMidCallRulePresets } = require('../../config/presets/midCallRulesPresets');

/**
 * GET /api/admin/front-desk/:companyId/verify
 * Run deep verification on Front Desk configuration
 */
router.get('/:companyId/verify', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    
    logger.info('[FRONT_DESK_VERIFY] Request received', { companyId });
    
    try {
        // Load full company document
        const company = await Company.findById(companyId).lean();
        
        if (!company) {
            logger.warn('[FRONT_DESK_VERIFY] Company not found', { companyId });
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Run verification
        const report = await verifyFrontDesk(companyId, company);
        
        const durationMs = Date.now() - startTime;
        logger.info('[FRONT_DESK_VERIFY] Complete', { 
            companyId, 
            score: report.overallScore,
            durationMs 
        });
        
        return res.json({
            success: true,
            ...report
        });
        
    } catch (error) {
        logger.error('[FRONT_DESK_VERIFY] Error', { 
            companyId, 
            error: error.message,
            stack: error.stack 
        });
        
        return res.status(500).json({
            success: false,
            error: 'Verification failed',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/front-desk/:companyId/verify/:subtab
 * Run verification for a specific sub-tab only
 */
router.get('/:companyId/verify/:subtab', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    const { companyId, subtab } = req.params;
    
    logger.info('[FRONT_DESK_VERIFY] Sub-tab request', { companyId, subtab });
    
    try {
        const company = await Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        const { verifySubTab, VERIFICATION_RULES } = require('../../services/verification/FrontDeskVerifier');
        
        if (!VERIFICATION_RULES[subtab]) {
            return res.status(400).json({ 
                success: false, 
                error: `Unknown sub-tab: ${subtab}`,
                validTabs: Object.keys(VERIFICATION_RULES)
            });
        }
        
        const config = company?.aiAgentSettings || {};
        const tradeKey = config?.tradeKey || company?.tradeKey || 'universal';
        
        const result = await verifySubTab(subtab, config, tradeKey, company, companyId);
        
        return res.json({
            success: true,
            companyId,
            tradeKey,
            subtab,
            ...result
        });
        
    } catch (error) {
        logger.error('[FRONT_DESK_VERIFY] Sub-tab error', { companyId, subtab, error: error.message });
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/admin/front-desk/:companyId/presets/midcall?slotId=preferredTime&slotType=time
 *
 * Provides backend-owned recommended mid-call rules for the Control Plane UI.
 * IMPORTANT: These presets are NOT used in runtime call handling; they only seed UI.
 */
router.get('/:companyId/presets/midcall', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
    const { companyId } = req.params;
    // Backward compatible:
    // - Old clients send: slotType
    // - New clients send: slotId + slotType (slotId wins)
    const slotIdRaw = String(req.query.slotId || '').trim();
    const slotTypeRaw = String(req.query.slotType || '').trim();
    const resolvedKey = slotIdRaw || slotTypeRaw;

    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const config = company?.aiAgentSettings || {};
        const tradeKey = config?.tradeKey || company?.tradeKey || 'universal';

        const rules = getMidCallRulePresets({ tradeKey, slotIdOrType: resolvedKey });

        return res.json({
            success: true,
            companyId,
            tradeKey,
            presetVersion: PRESET_VERSION,
            slotId: slotIdRaw || null,
            slotType: slotTypeRaw || null,
            resolvedPresetKey: resolvedKey || null,
            placeholdersAllowed: ALLOWED_PLACEHOLDERS,
            rules
        });
    } catch (error) {
        logger.error('[FRONT_DESK_PRESETS] Error', { companyId, slotId: slotIdRaw, slotType: slotTypeRaw, error: error.message });
        return res.status(500).json({ success: false, error: 'Preset lookup failed', details: error.message });
    }
});

module.exports = router;


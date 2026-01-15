/**
 * ============================================================================
 * PROMPT PACKS - Admin API Routes
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const { getPromptPackById } = require('../../config/promptPacks');
const {
    buildMigrationPreview,
    applyMigration,
    buildUpgradePreview,
    applyPackUpgrade
} = require('../../services/promptPacks/PromptPackMigrationService');

router.get('/migration/preview', authenticateJWT, requirePermission(PERMISSIONS.AI_AGENT_SETTINGS), async (req, res) => {
    try {
        const { companyId } = req.query;
        if (!companyId) {
            return res.status(400).json({ success: false, error: 'companyId is required' });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const preview = buildMigrationPreview(company);
        logger.info('[PROMPT PACKS] Migration preview', { companyId, legacyKeysFound: preview.legacyKeysFound.length });

        res.json({ success: true, data: preview });
    } catch (error) {
        logger.error('[PROMPT PACKS] Migration preview failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Migration preview failed' });
    }
});

router.post('/migration/apply', authenticateJWT, requirePermission(PERMISSIONS.AI_AGENT_SETTINGS), async (req, res) => {
    try {
        const { companyId, appliedBy, notes } = req.body || {};
        if (!companyId) {
            return res.status(400).json({ success: false, error: 'companyId is required' });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const result = applyMigration(company, {
            appliedBy: appliedBy || 'admin-migration-v1',
            notes: notes || null
        });
        await company.save();

        logger.info('[PROMPT PACKS] Migration applied', {
            companyId,
            migratedKeysCount: result.migratedKeysCount,
            conflicts: result.conflicts.length
        });

        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('[PROMPT PACKS] Migration apply failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Migration apply failed' });
    }
});

router.get('/upgrade/preview', authenticateJWT, requirePermission(PERMISSIONS.AI_AGENT_SETTINGS), async (req, res) => {
    try {
        const { companyId, tradeKey, toPack } = req.query;
        if (!companyId || !tradeKey || !toPack) {
            return res.status(400).json({ success: false, error: 'companyId, tradeKey, and toPack are required' });
        }
        if (!getPromptPackById(toPack)) {
            return res.status(400).json({ success: false, error: 'toPack not found' });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const preview = buildUpgradePreview(company, tradeKey, toPack);
        res.json({ success: true, data: preview });
    } catch (error) {
        logger.error('[PROMPT PACKS] Upgrade preview failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Upgrade preview failed' });
    }
});

router.post('/upgrade/apply', authenticateJWT, requirePermission(PERMISSIONS.AI_AGENT_SETTINGS), async (req, res) => {
    try {
        const { companyId, tradeKey, toPack, changedBy, notes } = req.body || {};
        if (!companyId || !tradeKey || !toPack) {
            return res.status(400).json({ success: false, error: 'companyId, tradeKey, and toPack are required' });
        }
        if (!getPromptPackById(toPack)) {
            return res.status(400).json({ success: false, error: 'toPack not found' });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const result = applyPackUpgrade(company, tradeKey, toPack, {
            changedBy: changedBy || 'admin-pack-upgrade',
            notes: notes || null
        });
        await company.save();

        logger.info('[PROMPT PACKS] Pack upgraded', {
            companyId,
            tradeKey,
            fromPack: result.fromPackId,
            toPack: result.toPackId,
            changedKeysCount: result.changedKeysCount,
            overrideCount: result.overrideCount
        });

        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('[PROMPT PACKS] Upgrade apply failed', { error: error.message });
        res.status(500).json({ success: false, error: 'Upgrade apply failed' });
    }
});

module.exports = router;

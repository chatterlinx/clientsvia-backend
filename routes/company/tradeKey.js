/**
 * ============================================================================
 * COMPANY TRADE KEY ROUTES (Onboarding / Data & Config)
 * ============================================================================
 *
 * PURPOSE:
 * - Read/write the company's trade key in a single, explicit endpoint.
 * - Used by Control Plane "Trade Key" selector (UI-only; affects template/scenario
 *   filtering and guardrails once saved into company config).
 *
 * SECURITY:
 * - Requires JWT auth + company access enforcement.
 * - Writes require CONFIG_WRITE permission.
 *
 * NOTE:
 * - We write BOTH `company.tradeKey` and `company.aiAgentSettings.tradeKey`
 *   to keep legacy readers consistent while the platform converges.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');

const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const ALLOWED_TRADE_KEYS = new Set([
  'hvac',
  'plumbing',
  'electrical',
  'dental',
  'medical',
  'legal',
  'real_estate',
  'auto',
  'roofing',
  'landscaping',
  'pest_control',
  'cleaning',
  'universal'
]);

function normalizeTradeKey(raw) {
  return String(raw || '').trim().toLowerCase();
}

router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/trade-key
 */
router.get('/', requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
  const { companyId } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: 'Invalid companyId format' });
    }

    const company = await Company.findById(companyId).select('tradeKey industryType aiAgentSettings.tradeKey').lean();
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const tradeKey =
      normalizeTradeKey(company?.aiAgentSettings?.tradeKey) ||
      normalizeTradeKey(company?.tradeKey) ||
      normalizeTradeKey(company?.industryType) ||
      'universal';

    return res.json({
      success: true,
      companyId,
      tradeKey: tradeKey || 'universal',
      allowedTradeKeys: Array.from(ALLOWED_TRADE_KEYS)
    });
  } catch (error) {
    logger.error('[TRADE KEY] GET failed', { companyId, error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to load trade key' });
  }
});

/**
 * PATCH /api/company/:companyId/trade-key
 * Body: { tradeKey: 'hvac' }
 */
router.patch('/', requirePermission(PERMISSIONS.CONFIG_WRITE), async (req, res) => {
  const { companyId } = req.params;
  const requested = normalizeTradeKey(req.body?.tradeKey);

  try {
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ success: false, error: 'Invalid companyId format' });
    }

    if (!requested) {
      return res.status(400).json({ success: false, error: 'tradeKey is required' });
    }

    if (!ALLOWED_TRADE_KEYS.has(requested)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid tradeKey',
        tradeKey: requested,
        allowedTradeKeys: Array.from(ALLOWED_TRADE_KEYS)
      });
    }

    const update = {
      tradeKey: requested,
      'aiAgentSettings.tradeKey': requested
    };

    const company = await Company.findByIdAndUpdate(companyId, { $set: update }, { new: true })
      .select('tradeKey aiAgentSettings.tradeKey')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    logger.info('[TRADE KEY] Updated', { companyId, tradeKey: requested, by: req.user?._id?.toString?.() || null });

    return res.json({
      success: true,
      companyId,
      tradeKey: requested
    });
  } catch (error) {
    logger.error('[TRADE KEY] PATCH failed', { companyId, tradeKey: requested, error: error.message });
    return res.status(500).json({ success: false, error: 'Failed to save trade key' });
  }
});

module.exports = router;


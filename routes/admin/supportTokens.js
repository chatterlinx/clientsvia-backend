const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const router = express.Router();

const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const SupportAccessToken = require('../../models/SupportAccessToken');
const ConfigAuditService = require('../../services/ConfigAuditService');

router.use(authenticateJWT);
router.use(requireRole('admin')); // platform-level only

function clampInt(n, def, min, max) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

/**
 * POST /api/admin/support-tokens/mint
 * Body:
 * {
 *   companyIds: string[],
 *   ttlMinutes?: number,
 *   allowedPathPrefixes?: string[],
 *   allowedMethods?: string[],
 *   reason?: string
 * }
 */
router.post('/support-tokens/mint', async (req, res) => {
  try {
    const { companyIds, allowedPathPrefixes, allowedMethods, reason } = req.body || {};
    const ttlMinutes = clampInt(req.body?.ttlMinutes, 60, 5, 24 * 60);

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return res.status(400).json({ success: false, message: 'companyIds[] is required' });
    }

    const jti = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const prefixes = Array.isArray(allowedPathPrefixes) && allowedPathPrefixes.length > 0
      ? allowedPathPrefixes.map(String)
      : ['/api/admin/front-desk-behavior/', '/api/company/'];

    const methods = Array.isArray(allowedMethods) && allowedMethods.length > 0
      ? allowedMethods.map(m => String(m).toUpperCase())
      : ['GET'];

    const doc = await SupportAccessToken.create({
      jti,
      issuedByUserId: req.user._id,
      issuedByEmail: req.user.email || null,
      companyIds,
      allowedPathPrefixes: prefixes,
      allowedMethods: methods,
      reason: reason ? String(reason).slice(0, 500) : null,
      expiresAt
    });

    const tokenPayload = {
      tokenType: 'support',
      jti,
      breakGlass: true,
      companyIds,
      allowedPathPrefixes: prefixes,
      allowedMethods: methods,
      issuedByUserId: req.user._id?.toString?.() || null,
      issuedByEmail: req.user.email || null
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: ttlMinutes * 60
    });

    // Audit (system-level; companyId not singular if multiple)
    await ConfigAuditService.logConfigChange({
      req,
      companyId: companyIds[0], // primary for indexing; full list is in updatedPaths
      action: 'supportToken.mint',
      updatedPaths: [
        `supportTokens.jti:${jti}`,
        `supportTokens.companyIds:${companyIds.join(',')}`,
        `supportTokens.ttlMinutes:${ttlMinutes}`,
        `supportTokens.allowedMethods:${methods.join(',')}`
      ],
      beforeCompanyDoc: null,
      afterCompanyDoc: null
    });

    return res.json({
      success: true,
      data: {
        jti: doc.jti,
        expiresAt: doc.expiresAt,
        allowedPathPrefixes: doc.allowedPathPrefixes,
        allowedMethods: doc.allowedMethods,
        token
      }
    });
  } catch (error) {
    logger.error('[SUPPORT TOKENS] mint failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/admin/support-tokens
 */
router.get('/support-tokens', async (req, res) => {
  try {
    const rows = await SupportAccessToken.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/admin/support-tokens/:jti/revoke
 */
router.post('/support-tokens/:jti/revoke', async (req, res) => {
  const { jti } = req.params;
  try {
    const doc = await SupportAccessToken.findOne({ jti });
    if (!doc) return res.status(404).json({ success: false, message: 'Token not found' });
    if (doc.revokedAt) return res.json({ success: true, message: 'Already revoked', data: doc });

    doc.revokedAt = new Date();
    doc.revokedByUserId = req.user._id;
    doc.revokedByEmail = req.user.email || null;
    await doc.save();

    await ConfigAuditService.logConfigChange({
      req,
      companyId: doc.companyIds?.[0] || null,
      action: 'supportToken.revoke',
      updatedPaths: [`supportTokens.jti:${jti}`],
      beforeCompanyDoc: null,
      afterCompanyDoc: null
    });

    return res.json({ success: true, data: doc });
  } catch (error) {
    logger.error('[SUPPORT TOKENS] revoke failed', { error: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;



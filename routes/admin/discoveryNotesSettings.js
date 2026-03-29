'use strict';

/**
 * ============================================================================
 * DISCOVERY NOTES SETTINGS — Admin API Routes
 * ============================================================================
 *
 * Owner-facing settings for the discoveryNotes system:
 *   - bookingFieldConfig: define what fields the agent collects per service type
 *   - snapshots: last 5 calls' discoveryNotes for the Monitor tab
 *
 * MOUNT: /api/admin/agent2/company/:companyId/discovery
 *
 * ENDPOINTS:
 *   GET   /:companyId/discovery/settings   — load bookingFieldConfig
 *   PATCH /:companyId/discovery/settings   — save bookingFieldConfig
 *   GET   /:companyId/discovery/snapshots  — last 5 calls' DN snapshots
 *
 * STORAGE:
 *   bookingFieldConfig lives at Company.agentSettings.discoverySettings.bookingFieldConfig
 *   Snapshots pulled from Customer.discoveryNotes[] (sorted by capturedAt desc, limit 5)
 *
 * NO HARDCODING:
 *   Standard booking fields are seeded to the DB via PATCH /settings when the
 *   owner clicks "Seed Standard Fields" in the UI. Code never holds field names.
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const Company             = require('../../models/v2Company');
const Customer            = require('../../models/Customer');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Access control ────────────────────────────────────────────────────────────

function _validateCompanyAccess(req, res, companyId) {
  if (!companyId) {
    res.status(400).json({ success: false, error: 'companyId is required' });
    return false;
  }
  const user    = req.user || {};
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(user.role);
  if (!isAdmin && user.companyId !== companyId) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /:companyId/discovery/settings
// Load bookingFieldConfig for this company.
// Returns empty object if not yet configured.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/discovery/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const company = await Company.findOne(
      { _id: companyId },
      { 'agentSettings.discoverySettings': 1 }
    ).lean();

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const discoverySettings  = company?.agentSettings?.discoverySettings || {};
    const bookingFieldConfig = discoverySettings.bookingFieldConfig || {};
    const uapbTemplates      = discoverySettings.uapbTemplates      || {};

    return res.json({ success: true, bookingFieldConfig, uapbTemplates });
  } catch (err) {
    logger.error('[DNSettings] GET settings error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load settings' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/discovery/settings
// Save bookingFieldConfig.
//
// Body: { bookingFieldConfig: { service_call: [...], maintenance: [...], ... } }
//
// Each service type is an array of field objects:
//   { key, label, required, isStandard }
//   isStandard=true → rendered read-only with lock icon in UI
//   isStandard=false → owner-created, fully editable
// ═══════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/discovery/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { bookingFieldConfig, uapbTemplates } = req.body;

  if (bookingFieldConfig === undefined && uapbTemplates === undefined) {
    return res.status(400).json({ success: false, error: 'bookingFieldConfig or uapbTemplates is required' });
  }

  if (bookingFieldConfig !== undefined && (typeof bookingFieldConfig !== 'object' || Array.isArray(bookingFieldConfig))) {
    return res.status(400).json({ success: false, error: 'bookingFieldConfig must be an object' });
  }

  try {
    const $set = {};
    if (bookingFieldConfig !== undefined) {
      $set['agentSettings.discoverySettings.bookingFieldConfig'] = bookingFieldConfig;
    }
    // uapbTemplates: { gracefulPivot, resumePrompt } — stored per company; runtime reads from DB
    if (uapbTemplates && typeof uapbTemplates === 'object') {
      if (uapbTemplates.gracefulPivot !== undefined) {
        $set['agentSettings.discoverySettings.uapbTemplates.gracefulPivot'] = uapbTemplates.gracefulPivot;
      }
      if (uapbTemplates.resumePrompt !== undefined) {
        $set['agentSettings.discoverySettings.uapbTemplates.resumePrompt'] = uapbTemplates.resumePrompt;
      }
    }

    const result = await Company.updateOne({ _id: companyId }, { $set });

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    logger.info('[DNSettings] settings saved', { companyId, fields: Object.keys($set) });
    return res.json({ success: true, bookingFieldConfig, uapbTemplates });
  } catch (err) {
    logger.error('[DNSettings] PATCH settings error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /:companyId/discovery/snapshots
// Last 5 calls' discoveryNotes for the Monitor tab.
//
// Queries: all Customers for this company who have discoveryNotes[],
// unwinds the array, sorts by capturedAt desc, limits to 5.
// Returns: [ { callSid, capturedAt, callerName, temp, confirmed, objective, turnCount } ]
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:companyId/discovery/snapshots', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const snapshots = await Customer.aggregate([
      // Only customers belonging to this company
      { $match: { companyId: companyId, 'discoveryNotes.0': { $exists: true } } },
      // Unwind to one doc per discoveryNotes entry
      { $unwind: '$discoveryNotes' },
      // Sort newest first
      { $sort: { 'discoveryNotes.capturedAt': -1 } },
      // Limit to 5 most recent across all customers
      { $limit: 5 },
      // Project only what the Monitor tab needs
      {
        $project: {
          _id:         0,
          callSid:     '$discoveryNotes.callSid',
          capturedAt:  '$discoveryNotes.capturedAt',
          callerName:  { $ifNull: ['$name', '$phone'] },
          callerPhone: '$phone',
          temp:        '$discoveryNotes.temp',
          confirmed:   '$discoveryNotes.confirmed',
          objective:   '$discoveryNotes.objective',
          turnCount:   '$discoveryNotes.turnCount',
          callReason:  '$discoveryNotes.callReason',
          urgency:     '$discoveryNotes.urgency'
        }
      }
    ]);

    return res.json({ success: true, snapshots });
  } catch (err) {
    logger.error('[DNSettings] GET snapshots error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load snapshots' });
  }
});

module.exports = router;

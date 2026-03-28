'use strict';

/**
 * ============================================================================
 * ENGINE HUB — ADMIN SETTINGS API ROUTES
 * ============================================================================
 *
 * Reads and writes the engineHub configuration block on the Company document.
 * Every field in engineHub is per-company — zero cross-tenant access possible.
 *
 * ROUTE TABLE:
 *   GET   /company/:companyId/engine-hub/settings   Read current settings
 *   PATCH /company/:companyId/engine-hub/settings   Update settings (partial, deep merge)
 *   GET   /company/:companyId/engine-hub/health      Status check — is engine active?
 *
 * BASE PATH registered in index.js:
 *   /api/admin/engine-hub
 *
 * MISSING CONFIG RULE:
 *   If engineHub has never been configured for a company, the GET /settings
 *   endpoint returns the default structure with { isConfigured: false }.
 *   The UI uses this flag to show the "Engine Hub not configured" warning banner.
 *   We NEVER silently apply defaults to live call behavior — the engine stays in
 *   passive mode until an admin explicitly enables it from the UI.
 *
 * RELATED:
 *   Model:  models/v2Company.js  (engineHub sub-schema)
 *   UI:     public/agent-console/enginehub.html
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const Company             = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const logger              = require('../../utils/logger');

// ============================================================================
// HELPERS
// ============================================================================

function _isValidObjectId(id) {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

/**
 * _defaultSettings — The Engine Hub default configuration object.
 *
 * Returned when a company has no engineHub field yet.
 * Also used by the UI to pre-populate the settings form for a new setup.
 *
 * KEY RULE: enabled defaults to FALSE. The engine is never active by default.
 * An admin must explicitly enable it from the UI. This is intentional —
 * it prevents unintended routing changes on companies not yet set up.
 */
function _defaultSettings() {
  return {
    enabled: false,
    mode:    'passive',   // passive = log only, no active call routing

    intentDetection: {
      multiIntentEnabled:  true,
      confidenceThreshold: 0.75,
      maxIntentsPerTurn:   2
    },

    policyRouter: {
      enabledPolicies: [
        'answer_then_book',
        'book_then_defer',
        'clarify_first',
        'pause_resume',
        'de_escalate',
        'offer_alternatives'
      ]
    },

    midFlowInterrupt: {
      bookingSlotSelection:  'pause_resume',
      bookingAddressCapture: 'pause_resume',
      bookingConfirmation:   'book_then_defer',
      afterHoursIntake:      'answer_then_book',
      transferInProgress:    'block_injection'
    },

    knowledgeEngine: {
      strictGroundedMode: true,
      onNoKcMatch:        'abstain',
      logKcMisses:        true
    },

    agendaState: {
      maxDeferredIntents:   3,
      autoSurfaceDeferred:  true,
      deferredTimeoutTurns: 5
    },

    trace: {
      enabled:               true,
      showInCallIntelligence: true,
      alertOnFallbackCount:  2
    }
  };
}

// ============================================================================
// GET /company/:companyId/engine-hub/settings
// Read Engine Hub settings. Returns defaults + isConfigured: false if never set.
// ============================================================================

router.get('/company/:companyId/engine-hub/settings', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  try {
    const company = await Company
      .findById(companyId)
      .select('engineHub companyName')
      .lean();

    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    // isConfigured: has the admin ever saved settings for this company?
    // When false, the UI shows the "not configured" warning banner.
    const isConfigured = !!(company.engineHub && company.engineHub.enabled !== undefined);
    const settings     = isConfigured ? company.engineHub : _defaultSettings();

    logger.info('[ENGINE HUB ROUTES] GET settings', { companyId, isConfigured });

    return res.json({
      ok:          true,
      settings,
      isConfigured,
      companyName: company.companyName
    });

  } catch (err) {
    logger.error('[ENGINE HUB ROUTES] GET settings failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to load Engine Hub settings' });
  }
});

// ============================================================================
// PATCH /company/:companyId/engine-hub/settings
//
// Partial update using MongoDB dot-notation $set.
// Nested sub-keys are written individually — sibling fields are never erased.
//
// Example: PATCH { intentDetection: { confidenceThreshold: 0.80 } }
//   Only sets engineHub.intentDetection.confidenceThreshold.
//   engineHub.intentDetection.multiIntentEnabled is untouched.
// ============================================================================

router.patch('/company/:companyId/engine-hub/settings', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
    return res.status(400).json({ ok: false, error: 'Request body is empty' });
  }

  // Only these top-level engineHub keys are writable from the UI.
  // Prevents arbitrary field injection into the company document.
  const ALLOWED_KEYS = [
    'enabled',
    'mode',
    'intentDetection',
    'policyRouter',
    'midFlowInterrupt',
    'knowledgeEngine',
    'agendaState',
    'trace'
  ];

  // Validate mode value if provided
  if (req.body.mode && !['active', 'learning', 'passive'].includes(req.body.mode)) {
    return res.status(400).json({
      ok:    false,
      error: 'mode must be "active", "learning", or "passive"'
    });
  }

  // Build $set payload using dot-notation for deep partial updates.
  // Nested objects: write each sub-key individually to avoid overwriting siblings.
  // Scalar values: write directly.
  const setPayload = {};

  for (const key of ALLOWED_KEYS) {
    if (req.body[key] === undefined) continue;

    const val = req.body[key];

    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      // Nested object — write each sub-key independently
      for (const [subKey, subVal] of Object.entries(val)) {
        // One more level deep for offerAlternatives inside midFlowInterrupt, etc.
        if (subVal !== null && typeof subVal === 'object' && !Array.isArray(subVal)) {
          for (const [deepKey, deepVal] of Object.entries(subVal)) {
            setPayload[`engineHub.${key}.${subKey}.${deepKey}`] = deepVal;
          }
        } else {
          setPayload[`engineHub.${key}.${subKey}`] = subVal;
        }
      }
    } else {
      setPayload[`engineHub.${key}`] = val;
    }
  }

  if (Object.keys(setPayload).length === 0) {
    return res.status(400).json({
      ok:    false,
      error: `No valid Engine Hub fields provided. Allowed top-level keys: ${ALLOWED_KEYS.join(', ')}`
    });
  }

  try {
    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: setPayload },
      { new: true, runValidators: false }   // runValidators: false — partial $set is always safe
    ).select('engineHub companyName').lean();

    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    logger.info('[ENGINE HUB ROUTES] ✅ Settings updated', {
      companyId,
      fields: Object.keys(setPayload)
    });

    return res.json({ ok: true, settings: company.engineHub });

  } catch (err) {
    logger.error('[ENGINE HUB ROUTES] PATCH settings failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to update Engine Hub settings' });
  }
});

// ============================================================================
// GET /company/:companyId/engine-hub/health
// Quick status check — used by the UI header status badge and monitoring.
// ============================================================================

router.get('/company/:companyId/engine-hub/health', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  try {
    const company = await Company
      .findById(companyId)
      .select('engineHub companyName')
      .lean();

    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }

    const hub          = company.engineHub || {};
    const isConfigured = hub.enabled !== undefined;
    const enabled      = hub.enabled ?? false;
    const mode         = hub.mode    ?? 'passive';

    // status string used by the UI status badge
    let status;
    if (!isConfigured)                   status = 'NOT_CONFIGURED';
    else if (!enabled)                   status = 'DISABLED';
    else if (mode === 'active')          status = 'ACTIVE';
    else if (mode === 'learning')        status = 'LEARNING';
    else                                 status = 'PASSIVE';

    return res.json({
      ok:           true,
      companyName:  company.companyName,
      isConfigured,
      enabled,
      mode,
      status
    });

  } catch (err) {
    logger.error('[ENGINE HUB ROUTES] GET health failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to load Engine Hub health' });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;

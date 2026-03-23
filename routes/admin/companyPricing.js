'use strict';

/**
 * ============================================================================
 * COMPANY PRICING — Admin API Routes
 * ============================================================================
 *
 * Manages per-company service pricing items with multi-layer voice responses.
 * All routes require companyId in the path — no cross-tenant access possible.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced: pricing:{companyId}
 *
 * ROUTE REGISTRATION ORDER (critical):
 *   Literal segment routes (/active, /settings) MUST be registered BEFORE
 *   the parameterised route (/:id) or Express will match the literal string
 *   as an :id value → 400/500 errors.
 *
 * ENDPOINTS:
 *   GET    /:companyId/pricing              — List all items (admin view)
 *   GET    /:companyId/pricing/active       — List only active items (runtime view)
 *   POST   /:companyId/pricing              — Create a new pricing item
 *   ⚠️ GET    /:companyId/pricing/:id       — Get single item (AFTER literal routes)
 *   PATCH  /:companyId/pricing/:id          — Update item (partial)
 *   DELETE /:companyId/pricing/:id          — Soft-delete (isActive=false)
 *   DELETE /:companyId/pricing/:id/hard     — Hard delete (permanent)
 *   POST   /:companyId/pricing/reorder      — Bulk priority update
 *
 * ============================================================================
 */

const express              = require('express');
const router               = express.Router();
const logger               = require('../../utils/logger');
const { authenticateJWT }  = require('../../middleware/auth');
const CompanyPricingItem   = require('../../models/CompanyPricingItem');
const PricingInterceptor   = require('../../services/engine/agent2/PricingInterceptor');
const InstantAudioService  = require('../../services/instantAudio/InstantAudioService');
const v2Company            = require('../../models/v2Company');
const { synthesizeSpeech } = require('../../services/v2elevenLabsService');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

const ALLOWED_FIELDS = [
  'label', 'category',
  'keywords', 'response', 'includesDetail',
  'layer2Keywords', 'layer2Response',
  'layer3Keywords', 'layer3Response',
  'action', 'actionPrompt', 'advisorCallbackPrompt',
  'isActive', 'priority'
];

function _sanitiseBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  // Normalise keyword arrays — trim, lowercase, deduplicate
  for (const kf of ['keywords', 'layer2Keywords', 'layer3Keywords']) {
    if (Array.isArray(out[kf])) {
      out[kf] = [...new Set(
        out[kf].map(k => `${k}`.toLowerCase().trim()).filter(Boolean)
      )];
    }
  }
  // Trim string fields
  for (const sf of ['label', 'category', 'response', 'includesDetail', 'layer2Response', 'layer3Response', 'actionPrompt', 'advisorCallbackPrompt']) {
    if (typeof out[sf] === 'string') out[sf] = out[sf].trim();
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/pricing — List ALL items (admin view)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/pricing', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const items = await CompanyPricingItem
      .find({ companyId })
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    return res.json({ success: true, items, total: items.length });
  } catch (err) {
    logger.error('[companyPricing] GET list error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load pricing items' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/pricing/active — Active items only (runtime view)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/pricing/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const items = await CompanyPricingItem.findActiveForCompany(companyId);
    return res.json({ success: true, items, total: items.length });
  } catch (err) {
    logger.error('[companyPricing] GET active error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active pricing items' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/pricing — Create a pricing item
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/pricing', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseBody(req.body || {});

  if (!body.label) {
    return res.status(400).json({ success: false, error: 'label is required' });
  }

  try {
    const item = await CompanyPricingItem.create({ companyId, ...body });

    // Invalidate runtime cache so next call sees fresh data
    PricingInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[companyPricing] cache invalidation failed on POST', { companyId, e: e.message })
    );

    logger.info('[companyPricing] Created pricing item', { companyId, id: item._id, label: item.label });

    // Pre-generate instant audio for all text responses — non-blocking, <50ms call latency at runtime
    _preGenAudio(companyId, item, 'created');

    return res.status(201).json({ success: true, item });
  } catch (err) {
    logger.error('[companyPricing] POST create error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create pricing item' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/pricing/reorder — Bulk priority update (drag-and-drop)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/pricing/reorder', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!order.length) {
    return res.status(400).json({ success: false, error: 'order array is required' });
  }

  try {
    const ops = order
      .filter(o => o.id && typeof o.priority === 'number')
      .map(o => ({
        updateOne: {
          filter: { _id: o.id, companyId },
          update: { $set: { priority: o.priority } }
        }
      }));

    if (ops.length) await CompanyPricingItem.bulkWrite(ops);

    PricingInterceptor.invalidateCache(companyId).catch(() => {});
    return res.json({ success: true, message: `Reordered ${ops.length} items` });
  } catch (err) {
    logger.error('[companyPricing] reorder error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder items' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET  /:companyId/pricing/voice-settings  — Load company-level pricing voice settings
// PATCH/:companyId/pricing/voice-settings  — Save company-level pricing voice settings
// ⚠️ MUST be registered BEFORE /:id — literal segment beats param segment only if registered first
// ─────────────────────────────────────────────────────────────────────────────

const VOICE_SETTINGS_FIELDS = ['advisorCallbackFallback', 'bookingOfferSuffix', 'notFoundResponse'];

router.get('/:companyId/pricing/voice-settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const company = await v2Company.findById(companyId, 'pricingVoiceSettings').lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });
    return res.json({ success: true, voiceSettings: company.pricingVoiceSettings || {} });
  } catch (err) {
    logger.error('[companyPricing] GET voice-settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load voice settings' });
  }
});

router.patch('/:companyId/pricing/voice-settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  // Build the $set payload — only allowed fields, strings trimmed, max 500 chars
  const updates = {};
  for (const field of VOICE_SETTINGS_FIELDS) {
    if (field in req.body) {
      const val = `${req.body[field] || ''}`.trim().slice(0, 500);
      updates[`pricingVoiceSettings.${field}`] = val;
    }
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const company = await v2Company.findByIdAndUpdate(
      companyId,
      { $set: updates },
      { new: true, select: 'pricingVoiceSettings' }
    ).lean();

    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    // Invalidate pricing cache so runtime picks up new settings immediately
    PricingInterceptor.invalidateCache(companyId).catch(() => {});

    logger.info('[companyPricing] Voice settings updated', { companyId, fields: Object.keys(updates) });
    return res.json({ success: true, voiceSettings: company.pricingVoiceSettings || {} });
  } catch (err) {
    logger.error('[companyPricing] PATCH voice-settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save voice settings' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/pricing/:id — Get single item
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/pricing/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const item = await CompanyPricingItem.findOne({ _id: id, companyId }).lean();
    if (!item) return res.status(404).json({ success: false, error: 'Pricing item not found' });
    return res.json({ success: true, item });
  } catch (err) {
    logger.error('[companyPricing] GET single error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load pricing item' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:companyId/pricing/:id — Partial update
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/pricing/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = _sanitiseBody(req.body || {});
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const item = await CompanyPricingItem.findOneAndUpdate(
      { _id: id, companyId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!item) return res.status(404).json({ success: false, error: 'Pricing item not found' });

    PricingInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[companyPricing] cache invalidation failed on PATCH', { companyId, e: e.message })
    );

    logger.info('[companyPricing] Updated pricing item', { companyId, id, fields: Object.keys(updates) });

    // Re-generate instant audio if any text field changed — non-blocking
    const textFields = ['response','layer2Response','layer3Response','actionPrompt','advisorCallbackPrompt','includesDetail'];
    const textChanged = textFields.some(f => f in updates);
    if (textChanged) _preGenAudio(companyId, item, 'updated');

    return res.json({ success: true, item });
  } catch (err) {
    logger.error('[companyPricing] PATCH error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update pricing item' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/pricing/:id — Soft delete (isActive = false)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/pricing/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const item = await CompanyPricingItem.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!item) return res.status(404).json({ success: false, error: 'Pricing item not found' });

    PricingInterceptor.invalidateCache(companyId).catch(() => {});
    logger.info('[companyPricing] Soft-deleted pricing item', { companyId, id });
    return res.json({ success: true, message: 'Pricing item deactivated' });
  } catch (err) {
    logger.error('[companyPricing] DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate pricing item' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/pricing/:id/hard — Permanent delete
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/pricing/:id/hard', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const result = await CompanyPricingItem.deleteOne({ _id: id, companyId });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Pricing item not found' });

    PricingInterceptor.invalidateCache(companyId).catch(() => {});
    logger.info('[companyPricing] Hard-deleted pricing item', { companyId, id });
    return res.json({ success: true, message: 'Pricing item permanently deleted' });
  } catch (err) {
    logger.error('[companyPricing] hard DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete pricing item' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/pricing/preview-voice — Synthesise text for UI playback
// ─────────────────────────────────────────────────────────────────────────────
// Used by the 🔊 button in pricing.html. Takes { text } and uses the company's
// stored voice settings — UI never needs to know voiceId or other params.
// ⚠️  Register BEFORE /:id routes (literal vs parameterised order rule).
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/pricing/preview-voice', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ success: false, error: 'text is required' });
  if (text.length > 600) return res.status(400).json({ success: false, error: 'text too long (max 600 chars)' });

  try {
    const company = await v2Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    const vs = company?.aiAgentSettings?.voiceSettings;
    if (!vs?.voiceId) {
      return res.status(422).json({ success: false, error: 'No voice configured for this company. Set a voice in Voice Settings first.' });
    }

    const audioBuffer = await synthesizeSpeech({
      text,
      voiceId:           vs.voiceId,
      company,
      stability:         vs.stability,
      similarityBoost:   vs.similarityBoost,
      styleExaggeration: vs.styleExaggeration,
      speakerBoost:      vs.speakerBoost,
      aiModel:           vs.aiModel,
      outputFormat:      vs.outputFormat || 'mp3_44100_128',
      streamingLatency:  vs.streamingLatency
    });

    res.set({
      'Content-Type':        'audio/mpeg',
      'Content-Length':      audioBuffer.length,
      'Content-Disposition': `inline; filename="pricing-preview-${Date.now()}.mp3"`,
      'Cache-Control':       'no-cache'
    });
    return res.send(audioBuffer);

  } catch (err) {
    logger.error('[companyPricing] preview-voice error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate voice preview' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTANT AUDIO PRE-GENERATION — called fire-and-forget from POST and PATCH
// ─────────────────────────────────────────────────────────────────────────────
// Mirrors the pattern in companyTriggers.js — generates MP3s to disk so the
// runtime can serve <Play> at call time instead of paying ElevenLabs latency.
// All four text fields are pre-generated independently (each gets its own hash).
// Graceful: any failure is logged but never surfaces to the caller.
// ─────────────────────────────────────────────────────────────────────────────
function _preGenAudio(companyId, item, reason) {
  const candidates = [
    { text: item.response,               label: 'layer1_response'   },
    { text: item.layer2Response,         label: 'layer2_response'   },
    { text: item.layer3Response,         label: 'layer3_response'   },
    { text: item.actionPrompt,           label: 'action_prompt'     },
    { text: item.advisorCallbackPrompt,  label: 'advisor_prompt'    },
    { text: item.includesDetail,         label: 'includes_detail'   }
  ].filter(c => typeof c.text === 'string' && c.text.trim());

  if (!candidates.length) return;

  (async () => {
    try {
      const company = await v2Company.findById(companyId).lean();
      const vs = company?.aiAgentSettings?.voiceSettings;
      if (!vs?.voiceId) return; // No voice configured yet — skip silently

      for (const { text, label } of candidates) {
        try {
          await InstantAudioService.generate({
            companyId,
            kind:          'PRICING_RESPONSE',
            text:          text.trim(),
            company,
            voiceSettings: vs
          });
        } catch (lineErr) {
          logger.warn('[companyPricing] Instant audio failed for one line (non-fatal)', {
            companyId, label, error: lineErr.message
          });
        }
      }

      logger.info('[companyPricing] Instant audio pre-generated', {
        companyId,
        label:      item.label,
        linesCount: candidates.length,
        reason
      });
    } catch (err) {
      logger.warn('[companyPricing] Instant audio pre-generation batch failed (non-fatal)', {
        companyId, label: item.label, error: err.message
      });
    }
  })();
}

module.exports = router;

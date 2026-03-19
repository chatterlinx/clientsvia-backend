/**
 * ============================================================================
 * COMPANY BOOKING TRIGGERS — Admin API Routes
 * ============================================================================
 *
 * Company-scoped trigger cards that fire INSIDE the BookingLogicEngine flow.
 * Same battle-tested 123RP keyword/phrase matching engine as Discovery triggers,
 * extended with three booking-specific fields:
 *
 *   firesOnSteps   — which booking steps activate this trigger
 *   behavior       — INFO | BLOCK | REDIRECT
 *   redirectMode   — freetext service-type key (REDIRECT only)
 *
 * MOUNT PATH:
 *   /api/admin/agent2/company  (same base as companyTriggers.js)
 *
 * ENDPOINTS:
 *   GET    /:companyId/booking-triggers               — List all + stats
 *   POST   /:companyId/booking-triggers               — Create + auto-audio
 *   GET    /:companyId/booking-triggers/:ruleId       — Get one
 *   PATCH  /:companyId/booking-triggers/:ruleId       — Update + auto-audio
 *   DELETE /:companyId/booking-triggers/:ruleId       — Soft-delete
 *
 *   POST   /:companyId/booking-triggers/:ruleId/generate-audio — Regenerate audio
 *   POST   /:companyId/booking-triggers/test-match             — Test phrase
 *   GET    /:companyId/booking-triggers/pool-stats             — Debug pool info
 *
 * AUTH:    authenticateJWT + PERMISSIONS.CONFIG_READ / CONFIG_WRITE
 * CACHE:   BookingTriggerMatcher.invalidateCache() on all mutations
 * AUDIO:   InstantAudioService pre-generates on create/update (fire-and-forget)
 *
 * ============================================================================
 */

'use strict';

const express = require('express');
const router  = express.Router();

const logger                  = require('../../utils/logger');
const { authenticateJWT }     = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const CompanyBookingTrigger   = require('../../models/CompanyBookingTrigger');
const v2Company               = require('../../models/v2Company');
const InstantAudioService     = require('../../services/instantAudio/InstantAudioService');
const { BookingTriggerMatcher } = require('../../services/engine/booking/BookingTriggerMatcher');
const HolidayService          = require('../../services/HolidayService');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STEPS     = ['ANY', 'COLLECT_NAME', 'COLLECT_PHONE', 'COLLECT_ADDRESS', 'OFFER_TIMES', 'CONFIRM'];
const VALID_BEHAVIORS = ['INFO', 'BLOCK', 'REDIRECT'];

// ruleId pattern — same rule as CompanyLocalTrigger
const RULE_ID_REGEX = /^[a-z0-9_.]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeRuleId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const n = raw.trim().toLowerCase();
  return RULE_ID_REGEX.test(n) ? n : null;
}

function getUserId(req) {
  return req.user?.id || req.user?._id?.toString() || 'unknown';
}

/**
 * Pre-generate instant audio for a booking trigger response (fire-and-forget).
 * Matches the pattern used in companyTriggers.js — never blocks the HTTP response.
 */
async function preGenerateAudio(companyId, ruleId, answerText, force = false) {
  if (!answerText?.trim()) return;

  (async () => {
    try {
      const company = await v2Company.findById(companyId).lean();
      const vs = company?.aiAgentSettings?.voiceSettings;

      if (!vs?.voiceId) {
        logger.debug('[BookingTriggers] No voiceId configured — skipping audio pre-gen', { companyId, ruleId });
        return;
      }

      await InstantAudioService.generate({
        companyId,
        kind:          'TRIGGER_RESPONSE',
        text:          answerText,
        company,
        voiceSettings: vs,
        force
      });

      logger.info('[BookingTriggers] ✅ Instant audio pre-generated', { companyId, ruleId, force });
    } catch (err) {
      logger.warn('[BookingTriggers] Instant audio pre-generation failed (non-fatal)', {
        companyId,
        ruleId,
        error: err.message,
        code:  err.code
      });
    }
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate the request body for create / update operations.
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validateBody(body, isCreate = true) {
  const { ruleId, label, responseMode, answerText, llmFactPack, behavior, redirectMode, firesOnSteps } = body;

  if (isCreate) {
    if (!ruleId || typeof ruleId !== 'string') {
      return { valid: false, error: 'ruleId is required (lowercase alphanumeric + dots/underscores)' };
    }
    if (!normalizeRuleId(ruleId)) {
      return { valid: false, error: 'ruleId must be lowercase alphanumeric with dots/underscores (e.g. "asap.block", "price.info")' };
    }
    if (!label || typeof label !== 'string') {
      return { valid: false, error: 'label is required' };
    }
  }

  const isLlm = responseMode === 'llm';

  if (isCreate && !isLlm && !answerText?.trim()) {
    return { valid: false, error: 'answerText is required for standard response mode' };
  }

  if (isCreate && isLlm && !llmFactPack?.includedFacts?.trim() && !llmFactPack?.excludedFacts?.trim()) {
    return { valid: false, error: 'LLM mode requires at least includedFacts or excludedFacts in llmFactPack' };
  }

  if (behavior && !VALID_BEHAVIORS.includes(behavior)) {
    return { valid: false, error: `behavior must be one of: ${VALID_BEHAVIORS.join(', ')}` };
  }

  if (behavior === 'REDIRECT' && !redirectMode?.trim()) {
    return { valid: false, error: 'redirectMode is required when behavior is REDIRECT' };
  }

  if (firesOnSteps !== undefined) {
    if (!Array.isArray(firesOnSteps) || firesOnSteps.length === 0) {
      return { valid: false, error: 'firesOnSteps must be a non-empty array' };
    }
    const invalid = firesOnSteps.filter(s => !VALID_STEPS.includes(s));
    if (invalid.length) {
      return { valid: false, error: `Invalid firesOnSteps values: ${invalid.join(', ')}. Valid: ${VALID_STEPS.join(', ')}` };
    }
  }

  return { valid: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// GET /:companyId/booking-triggers
// List all booking triggers for a company with pool stats
// ═════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/booking-triggers',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { includeDeleted } = req.query;

      const [triggers, stats] = await Promise.all([
        CompanyBookingTrigger.findByCompanyId(companyId, includeDeleted === 'true'),
        CompanyBookingTrigger.countActiveByCompanyId(companyId)
      ]);

      // Count by behavior + step for UI stats bar
      const active   = triggers.filter(t => !t.isDeleted && t.enabled);
      const byBehavior = {
        INFO:     active.filter(t => t.behavior === 'INFO').length,
        BLOCK:    active.filter(t => t.behavior === 'BLOCK').length,
        REDIRECT: active.filter(t => t.behavior === 'REDIRECT').length
      };

      logger.debug('[BookingTriggers] List', { companyId, total: triggers.length, active: active.length });

      return res.json({
        success: true,
        data:    triggers,
        total:   triggers.length,
        stats: {
          activeCount: stats,
          byBehavior
        }
      });
    } catch (error) {
      logger.error('[BookingTriggers] List error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/booking-triggers
// Create a booking trigger + auto-generate instant audio
// ═════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/booking-triggers',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = getUserId(req);

      // ── Validate ──────────────────────────────────────────────────────────
      const validation = validateBody(req.body, true);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      // ── Company exists guard ───────────────────────────────────────────────
      const company = await v2Company.findById(companyId).select('_id').lean();
      if (!company) {
        return res.status(404).json({ success: false, error: 'Company not found' });
      }

      // ── Extract all fields ─────────────────────────────────────────────────
      const {
        ruleId:           rawRuleId,
        label,
        description,
        enabled,
        priority,
        keywords,
        phrases,
        negativeKeywords,
        negativePhrases,
        maxInputWords,
        responseMode,
        answerText,
        llmFactPack,
        followUpQuestion,
        firesOnSteps,
        behavior,
        redirectMode,
        tags
      } = req.body;

      const ruleId  = normalizeRuleId(rawRuleId);
      const isLlm   = responseMode === 'llm';

      // ── Idempotency / soft-delete revival ─────────────────────────────────
      const existing = await CompanyBookingTrigger.findOne({
        companyId,
        ruleId,
        isDeleted: { $ne: true }
      }).lean();

      if (existing) {
        logger.info('[BookingTriggers] Idempotent create — returning existing', { companyId, ruleId });
        return res.status(200).json({ success: true, data: existing, alreadyExisted: true });
      }

      // Revival path: if a soft-deleted version exists, revive it
      const deletedDoc = await CompanyBookingTrigger.findOne({ companyId, ruleId, isDeleted: true });
      if (deletedDoc) {
        Object.assign(deletedDoc, {
          isDeleted:        false,
          deletedAt:        null,
          deletedBy:        null,
          deletedReason:    null,
          label,
          description:      description || '',
          enabled:          enabled !== false,
          priority:         priority   || 50,
          keywords:         keywords   || [],
          phrases:          phrases    || [],
          negativeKeywords: negativeKeywords || [],
          negativePhrases:  negativePhrases  || [],
          maxInputWords:    typeof maxInputWords === 'number' ? maxInputWords : null,
          responseMode:     responseMode || 'standard',
          answerText:       answerText || '',
          llmFactPack:      isLlm ? { includedFacts: llmFactPack?.includedFacts || '', excludedFacts: llmFactPack?.excludedFacts || '', backupAnswer: llmFactPack?.backupAnswer || '' } : undefined,
          followUpQuestion: followUpQuestion || '',
          firesOnSteps:     firesOnSteps?.length ? firesOnSteps : ['ANY'],
          behavior:         behavior   || 'INFO',
          redirectMode:     behavior === 'REDIRECT' ? redirectMode?.trim() : null,
          tags:             tags || [],
          state:            'published',
          publishedAt:      new Date(),
          updatedAt:        new Date(),
          updatedBy:        userId
        });
        await deletedDoc.save();

        BookingTriggerMatcher.invalidateCache(companyId);

        if (!isLlm && answerText?.trim()) preGenerateAudio(companyId, ruleId, answerText, false);

        logger.info('[BookingTriggers] Trigger revived from soft-delete', { companyId, ruleId, revivedBy: userId });
        return res.status(200).json({ success: true, data: deletedDoc, revived: true });
      }

      // ── Create new document ────────────────────────────────────────────────
      const trigger = await CompanyBookingTrigger.create({
        companyId,
        ruleId,
        label,
        description:      description || '',
        enabled:          enabled !== false,
        priority:         priority   || 50,
        keywords:         keywords   || [],
        phrases:          phrases    || [],
        negativeKeywords: negativeKeywords || [],
        negativePhrases:  negativePhrases  || [],
        maxInputWords:    typeof maxInputWords === 'number' ? maxInputWords : null,
        responseMode:     responseMode || 'standard',
        answerText:       answerText   || (isLlm ? '[LLM-generated response]' : ''),
        llmFactPack:      isLlm ? {
          includedFacts: llmFactPack?.includedFacts || '',
          excludedFacts: llmFactPack?.excludedFacts || '',
          backupAnswer:  llmFactPack?.backupAnswer  || ''
        } : undefined,
        followUpQuestion: followUpQuestion || '',
        firesOnSteps:     firesOnSteps?.length ? firesOnSteps : ['ANY'],
        behavior:         behavior   || 'INFO',
        redirectMode:     behavior === 'REDIRECT' ? redirectMode?.trim() || null : null,
        tags:             tags || [],
        state:            'published',
        publishedAt:      new Date(),
        createdBy:        userId,
        updatedBy:        userId
      });

      // ── Side-effects (both non-blocking) ───────────────────────────────────
      BookingTriggerMatcher.invalidateCache(companyId);

      if (!isLlm && answerText?.trim()) preGenerateAudio(companyId, ruleId, answerText, false);

      logger.info('[BookingTriggers] ✅ Trigger created', {
        companyId,
        ruleId,
        triggerId:   trigger.triggerId,
        behavior:    trigger.behavior,
        firesOnSteps: trigger.firesOnSteps,
        createdBy:   userId
      });

      return res.status(201).json({ success: true, data: trigger });

    } catch (error) {
      // Handle duplicate key race condition idempotently
      if (error.code === 11000) {
        try {
          const ruleId   = normalizeRuleId(req.body.ruleId);
          const existing = await CompanyBookingTrigger.findOne({
            companyId:  req.params.companyId,
            ruleId,
            isDeleted: { $ne: true }
          }).lean();
          if (existing) {
            return res.status(200).json({ success: true, data: existing, alreadyExisted: true });
          }
        } catch (_) { /* fall through */ }
        return res.status(409).json({ success: false, error: 'DUPLICATE_RULE_ID', message: 'Booking trigger already exists' });
      }
      logger.error('[BookingTriggers] Create error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// GET /:companyId/booking-triggers/pool-stats
// Debug endpoint — pool health for the admin console test panel
// NOTE: Must be registered BEFORE /:companyId/booking-triggers/:ruleId
//       to avoid Express matching "pool-stats" as a ruleId.
// ═════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/booking-triggers/pool-stats',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const stats = await BookingTriggerMatcher.getPoolStats(companyId);

      logger.debug('[BookingTriggers] Pool stats requested', { companyId, stats });

      return res.json({ success: true, data: stats });
    } catch (error) {
      logger.error('[BookingTriggers] Pool stats error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/booking-triggers/test-match
// Test a phrase against the live trigger pool
// NOTE: Must be registered BEFORE /:companyId/booking-triggers/:ruleId
// ═════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/booking-triggers/test-match',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { phrase, step = 'ANY' } = req.body;

      if (!phrase || typeof phrase !== 'string' || !phrase.trim()) {
        return res.status(400).json({ success: false, error: 'phrase is required' });
      }

      if (!VALID_STEPS.includes(step)) {
        return res.status(400).json({
          success: false,
          error: `Invalid step "${step}". Valid values: ${VALID_STEPS.join(', ')}`
        });
      }

      const result = await BookingTriggerMatcher.match(phrase.trim(), companyId, step);

      logger.info('[BookingTriggers] Test-match executed', {
        companyId,
        phrase:  phrase.substring(0, 60),
        step,
        matched: result.matched,
        ruleId:  result.card?.ruleId || null
      });

      return res.json({
        success: true,
        data: {
          phrase,
          step,
          matched:      result.matched,
          matchType:    result.matchType || null,
          matchedOn:    result.matchedOn || null,
          behavior:     result.behavior  || null,
          redirectMode: result.redirectMode || null,
          card:         result.matched ? {
            ruleId:      result.card?.ruleId,
            label:       result.card?.label,
            behavior:    result.card?.behavior,
            firesOnSteps: result.card?.firesOnSteps,
            answerText:  result.card?.answer?.answerText
          } : null,
          poolInfo: {
            stepPoolSize: result.stepPoolSize,
            totalLoaded:  result.totalLoaded,
            evaluated:    result.evaluated?.length || 0
          }
        }
      });
    } catch (error) {
      logger.error('[BookingTriggers] Test-match error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// GET /:companyId/booking-triggers/:ruleId
// Get a single booking trigger
// ═════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/booking-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;

      const trigger = await CompanyBookingTrigger.findOne({
        companyId,
        ruleId,
        isDeleted: { $ne: true }
      }).lean();

      if (!trigger) {
        return res.status(404).json({ success: false, error: 'Booking trigger not found' });
      }

      // Attach audio status for UI
      const audioStatus = InstantAudioService.getStatus({
        companyId,
        kind:          'TRIGGER_RESPONSE',
        text:          trigger.answerText || '',
        voiceSettings: {} // no voice — just file existence check
      });

      return res.json({
        success: true,
        data:    trigger,
        audio: {
          cached: audioStatus.exists,
          url:    audioStatus.exists ? audioStatus.url : null
        }
      });
    } catch (error) {
      logger.error('[BookingTriggers] Get error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/booking-triggers/:ruleId
// Update a booking trigger + auto-regenerate instant audio if text changed
// ═════════════════════════════════════════════════════════════════════════════

router.patch('/:companyId/booking-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const userId   = getUserId(req);
      const updates  = req.body;

      // ── Load existing ─────────────────────────────────────────────────────
      const trigger = await CompanyBookingTrigger.findOne({
        companyId,
        ruleId,
        isDeleted: { $ne: true }
      });

      if (!trigger) {
        return res.status(404).json({ success: false, error: 'Booking trigger not found' });
      }

      // ── Validate booking-specific fields if present ────────────────────────
      const validation = validateBody(updates, false);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }

      // ── Allowed update fields — explicit list prevents field-freeze bugs ───
      const ALLOWED = [
        'label', 'description', 'enabled', 'priority',
        'keywords', 'phrases', 'negativeKeywords', 'negativePhrases', 'maxInputWords',
        'responseMode', 'answerText', 'llmFactPack', 'followUpQuestion',
        'firesOnSteps', 'behavior', 'redirectMode',
        'tags'
      ];

      const cleanUpdates = {};
      for (const field of ALLOWED) {
        if (updates[field] !== undefined) {
          cleanUpdates[field] = updates[field];
        }
      }

      const textChanged    = cleanUpdates.answerText !== undefined && cleanUpdates.answerText !== trigger.answerText;
      const behaviorChanged = cleanUpdates.behavior !== undefined;

      // Enforce redirectMode rule if behavior is changing to/from REDIRECT
      const effectiveBehavior = cleanUpdates.behavior ?? trigger.behavior;
      if (effectiveBehavior === 'REDIRECT') {
        const effectiveRedirect = cleanUpdates.redirectMode ?? trigger.redirectMode;
        if (!effectiveRedirect?.trim()) {
          return res.status(400).json({
            success: false,
            error:   'redirectMode is required when behavior is REDIRECT'
          });
        }
      } else if (behaviorChanged && effectiveBehavior !== 'REDIRECT') {
        // Clear redirectMode when leaving REDIRECT
        cleanUpdates.redirectMode = null;
      }

      Object.assign(trigger, cleanUpdates);
      trigger.updatedAt = new Date();
      trigger.updatedBy = userId;

      await trigger.save();

      // ── Side-effects (non-blocking) ────────────────────────────────────────
      BookingTriggerMatcher.invalidateCache(companyId);

      const finalText    = cleanUpdates.answerText ?? trigger.answerText;
      const isStandard   = (cleanUpdates.responseMode ?? trigger.responseMode) !== 'llm';
      const needsAudioGen = isStandard && finalText?.trim() && textChanged;

      if (needsAudioGen) {
        preGenerateAudio(companyId, ruleId, finalText, true /* force re-gen */);
      }

      logger.info('[BookingTriggers] ✅ Trigger updated', {
        companyId,
        ruleId,
        updatedFields: Object.keys(cleanUpdates),
        textChanged,
        updatedBy:     userId
      });

      return res.json({
        success:        true,
        data:           trigger,
        audioScheduled: needsAudioGen
      });
    } catch (error) {
      logger.error('[BookingTriggers] Update error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// DELETE /:companyId/booking-triggers/:ruleId
// Soft-delete a booking trigger
// ═════════════════════════════════════════════════════════════════════════════

router.delete('/:companyId/booking-triggers/:ruleId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const userId = getUserId(req);
      const { reason } = req.body;

      const trigger = await CompanyBookingTrigger.findOne({
        companyId,
        ruleId,
        isDeleted: { $ne: true }
      });

      if (!trigger) {
        return res.status(404).json({ success: false, error: 'Booking trigger not found' });
      }

      trigger.isDeleted     = true;
      trigger.deletedAt     = new Date();
      trigger.deletedBy     = userId;
      trigger.deletedReason = reason?.trim() || null;

      await trigger.save();

      BookingTriggerMatcher.invalidateCache(companyId);

      logger.info('[BookingTriggers] Trigger soft-deleted', {
        companyId,
        ruleId,
        triggerId:  trigger.triggerId,
        deletedBy:  userId,
        reason:     trigger.deletedReason
      });

      return res.json({ success: true, message: 'Booking trigger deleted', ruleId });
    } catch (error) {
      logger.error('[BookingTriggers] Delete error', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ═════════════════════════════════════════════════════════════════════════════
// POST /:companyId/booking-triggers/:ruleId/generate-audio
// Manually trigger instant audio (re)generation for a trigger
// ═════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/booking-triggers/:ruleId/generate-audio',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, ruleId } = req.params;
      const { force = true }      = req.body;

      const trigger = await CompanyBookingTrigger.findOne({
        companyId,
        ruleId,
        isDeleted: { $ne: true }
      }).lean();

      if (!trigger) {
        return res.status(404).json({ success: false, error: 'Booking trigger not found' });
      }

      if (trigger.responseMode === 'llm') {
        return res.status(400).json({
          success: false,
          error:   'LLM-mode triggers cannot have pre-cached audio — audio is generated dynamically'
        });
      }

      if (!trigger.answerText?.trim()) {
        return res.status(400).json({ success: false, error: 'No answerText on this trigger — nothing to generate' });
      }

      const company = await v2Company.findById(companyId).lean();
      const vs      = company?.aiAgentSettings?.voiceSettings;

      if (!vs?.voiceId) {
        return res.status(400).json({
          success: false,
          error:   'No ElevenLabs voice configured for this company (voiceId missing)'
        });
      }

      const result = await InstantAudioService.generate({
        companyId,
        kind:          'TRIGGER_RESPONSE',
        text:          trigger.answerText,
        company,
        voiceSettings: vs,
        force:         Boolean(force)
      });

      logger.info('[BookingTriggers] Audio (re)generated', {
        companyId,
        ruleId,
        generated: result.generated,
        bytes:     result.bytes,
        url:       result.url
      });

      return res.json({
        success: true,
        data: {
          generated: result.generated,
          cached:    result.exists,
          url:       result.url,
          bytes:     result.bytes || null
        }
      });
    } catch (error) {
      logger.error('[BookingTriggers] Generate audio error', { error: error.message, code: error.code });
      return res.status(500).json({
        success: false,
        error:   error.message,
        code:    error.code || null
      });
    }
  }
);

// ============================================================================
// BOOKING CONFIG — Unified booking flow configuration
// GET  /:companyId/booking-config
// POST /:companyId/booking-config
// ============================================================================

router.get('/:companyId/booking-config',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const company = await v2Company.findById(companyId)
        .select([
          'aiAgentSettings.agent2.bookingConfig',
          'aiAgentSettings.agent2.bridge.bookingBridgePhrase',
          'aiAgentSettings.agent2.discovery.holdMessage',
          'aiAgentSettings.agent2.bookingPrompts',
          'aiAgentSettings.bookingLogic',
          'aiAgentSettings.bookingFields'
        ].join(' '))
        .lean();

      if (!company) return res.status(404).json({ error: 'Company not found' });

      const a2 = company.aiAgentSettings?.agent2 || {};
      const bc = a2.bookingConfig || {};
      const bp = a2.bookingPrompts || {};   // legacy — migrate into response
      const bl = company.aiAgentSettings?.bookingLogic || {};
      const bf = company.aiAgentSettings?.bookingFields || [];

      // Build unified response — bookingConfig is authoritative; legacy fields fill gaps
      const response = {
        bridgePhrase:      a2.bridge?.bookingBridgePhrase || '',
        callerRecognition: bc.callerRecognition || {},
        builtinPrompts: {
          // NAME — cold ask
          askName:                    bc.builtinPrompts?.askName                    || bp.askName  || '',
          nameReAnchor:               bc.builtinPrompts?.nameReAnchor               || '',
          // NAME — smart confirmation (LLM pre-fill)
          confirmFullName:            bc.builtinPrompts?.confirmFullName            || '',
          confirmFirstNameAskLast:    bc.builtinPrompts?.confirmFirstNameAskLast    || '',
          askLastNameOnly:            bc.builtinPrompts?.askLastNameOnly            || '',
          confirmNameAmbiguous:       bc.builtinPrompts?.confirmNameAmbiguous       || '',
          confirmNamePartialCorrected: bc.builtinPrompts?.confirmNamePartialCorrected || '',
          confirmFirstNameGotLastAsk: bc.builtinPrompts?.confirmFirstNameGotLastAsk  || '',
          // PHONE
          askPhone:                   bc.builtinPrompts?.askPhone                   || bp.askPhone || '',
          phoneReAnchor:              bc.builtinPrompts?.phoneReAnchor              || '',
          phoneInvalid:               bc.builtinPrompts?.phoneInvalid               || '',
          // ADDRESS
          askAddress:                 bc.builtinPrompts?.askAddress                 || bp.askAddress || '',
          addressReAnchor:            bc.builtinPrompts?.addressReAnchor            || '',
          // DIGRESSION
          t2DigressionAck:            bc.builtinPrompts?.t2DigressionAck            || ''
        },
        customFields: bc.customFields || bf.map(f => ({
          ...f,
          reAnchorPhrase:    '',
          maxAttempts:       3,
          fallbackAction:    'RE_ASK_PLAIN',
          choices:           [],
          confirmationLabel: f.label || ''
        })) || [],
        altContact:   bc.altContact   || {},
        confirmation: bc.confirmation || {},
        calendar: {
          holdMessage:         bc.calendar?.holdMessage         || a2.discovery?.holdMessage || '',
          offerTimesPrompt:    bc.calendar?.offerTimesPrompt    || '',
          noTimesPrompt:       bc.calendar?.noTimesPrompt       || '',
          appointmentDuration: bc.calendar?.appointmentDuration ?? bl.appointmentDuration ?? 60,
          bufferMinutes:       bc.calendar?.bufferMinutes       ?? bl.bufferMinutes       ?? 0,
          advanceBookingDays:  bc.calendar?.advanceBookingDays  ?? bl.advanceBookingDays  ?? 14,
          confirmationMessage: bc.calendar?.confirmationMessage || bl.confirmationMessage  || ''
        },
        slotFilling:          bc.slotFilling          || {},
        requiredFieldsConfig: bc.requiredFieldsConfig  || { address: true },
        // Address collection config — multi-step sub-flow toggles
        addressConfig: {
          requireCity:    bc.addressConfig?.requireCity  !== false,    // default: true
          requireState:   bc.addressConfig?.requireState === true,     // default: false
          requireZip:     bc.addressConfig?.requireZip   === true,     // default: false
          askCityPrompt:  bc.addressConfig?.askCityPrompt   || '',
          askStatePrompt: bc.addressConfig?.askStatePrompt  || '',
          askZipPrompt:   bc.addressConfig?.askZipPrompt    || ''
        },
        preferenceCapture: {
          enabled:            bc.preferenceCapture?.enabled !== false,
          askDayPrompt:       bc.preferenceCapture?.askDayPrompt        || '',
          askTimePrompt:      bc.preferenceCapture?.askTimePrompt       || '',
          noSlotsOnDayPrompt: bc.preferenceCapture?.noSlotsOnDayPrompt  || '',
          urgentPrompt:       bc.preferenceCapture?.urgentPrompt        || ''
        },

        // ── Team, Emergency Schedule & Holidays ─────────────────────────────
        technicians:       bc.technicians       || [],
        serviceTypes:      bc.serviceTypes      || [],
        emergencySchedule: bc.emergencySchedule || {
          enabled: false, mode: 'custom',
          windowStart: '07:00', windowEnd: '22:00',
          bufferMinutes: 60, daysOfWeek: [1,2,3,4,5,6],
          respectHolidays: false
        },
        // Holidays: merge stored prefs with catalog so UI always sees the full list
        // with this-year dates computed server-side
        holidays: HolidayService.mergeWithCompanyPrefs(bc.holidays || [])
      };

      return res.json({ success: true, bookingConfig: response });
    } catch (err) {
      logger.error('[booking-config] GET failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to load booking config' });
    }
  }
);

router.post('/:companyId/booking-config',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const body = req.body || {};

      const updates = {};

      // Bridge phrase lives in agent2.bridge.bookingBridgePhrase
      if (body.bridgePhrase !== undefined) {
        updates['aiAgentSettings.agent2.bridge.bookingBridgePhrase'] = (body.bridgePhrase || '').trim();
      }

      // Hold message lives in agent2.discovery.holdMessage (legacy location — keep in sync)
      if (body.calendar?.holdMessage !== undefined) {
        updates['aiAgentSettings.agent2.discovery.holdMessage'] = (body.calendar.holdMessage || '').trim();
      }

      // Keep legacy bookingPrompts in sync (backward compat for old engine reads)
      if (body.builtinPrompts) {
        if (body.builtinPrompts.askName  !== undefined) updates['aiAgentSettings.agent2.bookingPrompts.askName']  = (body.builtinPrompts.askName  || '').trim();
        if (body.builtinPrompts.askPhone !== undefined) updates['aiAgentSettings.agent2.bookingPrompts.askPhone'] = (body.builtinPrompts.askPhone || '').trim();
      }

      // Write unified bookingConfig
      const bcFields = ['callerRecognition', 'builtinPrompts', 'customFields', 'altContact', 'confirmation', 'calendar', 'slotFilling', 'requiredFieldsConfig', 'addressConfig', 'preferenceCapture', 'technicians', 'serviceTypes', 'emergencySchedule', 'holidays'];
      for (const field of bcFields) {
        if (body[field] !== undefined) {
          updates[`aiAgentSettings.agent2.bookingConfig.${field}`] = body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const updated = await v2Company.findByIdAndUpdate(
        companyId,
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!updated) return res.status(404).json({ error: 'Company not found' });

      logger.info('[booking-config] Saved', { companyId, fields: Object.keys(updates) });

      // ── Pre-generate InstantAudio for built-in booking prompts ────────────
      // Fire-and-forget — response is already sent.  Caches bridge, name, phone,
      // and address prompts as MP3 files so they play in <50 ms at call time.
      // ─────────────────────────────────────────────────────────────────────
      (async () => {
        try {
          const vs = updated.aiAgentSettings?.voiceSettings;
          if (!vs?.voiceId) return;   // no voice configured — skip

          const textsToCache = [];

          // Bridge phrase
          const bridge = (updated.aiAgentSettings?.agent2?.bridge?.bookingBridgePhrase || '').trim();
          if (bridge) textsToCache.push({ label: 'bridge',   text: bridge });

          // Built-in prompts
          const bp = updated.aiAgentSettings?.agent2?.bookingConfig?.builtinPrompts || {};
          if (bp.askName?.trim())    textsToCache.push({ label: 'askName',    text: bp.askName.trim()    });
          if (bp.askPhone?.trim())   textsToCache.push({ label: 'askPhone',   text: bp.askPhone.trim()   });
          if (bp.askAddress?.trim()) textsToCache.push({ label: 'askAddress', text: bp.askAddress.trim() });

          for (const item of textsToCache) {
            try {
              await InstantAudioService.generate({
                companyId,
                kind:          'TRIGGER_RESPONSE',
                text:          item.text,
                company:       updated,
                voiceSettings: vs,
                force:         true    // re-generate if text changed
              });
              logger.info(`[booking-config] ✅ Instant audio cached: ${item.label}`, { companyId });
            } catch (audioErr) {
              logger.warn(`[booking-config] Instant audio failed for ${item.label} (non-fatal)`, {
                companyId, error: audioErr.message, code: audioErr.code
              });
            }
          }
        } catch (bgErr) {
          logger.warn('[booking-config] Background audio pre-gen failed (non-fatal)', {
            companyId, error: bgErr.message
          });
        }
      })();

      return res.json({ success: true, message: 'Booking configuration saved' });
    } catch (err) {
      logger.error('[booking-config] POST failed', { error: err.message });
      return res.status(500).json({ error: 'Failed to save booking config' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = router;

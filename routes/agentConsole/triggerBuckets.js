/**
 * ============================================================================
 * TRIGGER BUCKETS — Agent Console API (Company-scoped)
 * ============================================================================
 *
 * Buckets are company-specific intent groupings for trigger pre-filtering.
 * These routes manage bucket CRUD and enforce tenant isolation.
 * ============================================================================
 */

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const TriggerBucket = require('../../models/TriggerBucket');
const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
const CompanyTriggerSettings = require('../../models/CompanyTriggerSettings');
const { TriggerBucketClassifier } = require('../../services/engine/agent2/TriggerBucketClassifier');
const TriggerService = require('../../services/engine/agent2/TriggerService');

function normalizeKeywords(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === 'string') {
    return input.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeBucketPayload(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const keywords = normalizeKeywords(payload.keywords)
    .map(k => `${k || ''}`.toLowerCase().trim())
    .filter(Boolean);
  const priority = typeof payload.priority === 'number' ? payload.priority : 50;
  const enabled = payload.enabled !== false;

  return { name, keywords, priority, enabled };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /:companyId/trigger-buckets — list buckets
// ════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/trigger-buckets',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const buckets = await TriggerBucket.findByCompanyId(companyId);
      const cacheInfo = TriggerBucketClassifier.getCacheInfo(companyId);

      res.json({
        success: true,
        data: {
          buckets: (buckets || []).map(b => ({
            id: b._id?.toString(),
            name: b.name,
            key: b.key,
            keywords: b.keywords || [],
            priority: b.priority ?? 50,
            enabled: b.enabled !== false,
            createdAt: b.createdAt || null,
            updatedAt: b.updatedAt || null
          })),
          cacheInfo: cacheInfo || null
        }
      });
    } catch (error) {
      logger.error('[TriggerBuckets] List error', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// POST /:companyId/trigger-buckets — create bucket
// ════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/trigger-buckets',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';
      const { name, keywords, priority, enabled } = normalizeBucketPayload(req.body);

      if (!name) {
        return res.status(400).json({ success: false, error: 'Bucket name is required' });
      }

      const key = TriggerBucket.buildKey(name);
      if (!key) {
        return res.status(400).json({ success: false, error: 'Invalid bucket name' });
      }

      const existing = await TriggerBucket.findOne({ companyId, $or: [{ key }, { name }] });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: 'Bucket already exists',
          message: `Bucket "${existing.name}" already exists`
        });
      }

      const bucket = await TriggerBucket.create({
        companyId,
        name,
        key,
        keywords,
        priority,
        enabled,
        createdBy: userId,
        updatedBy: userId
      });

      TriggerBucketClassifier.invalidateCache(companyId);

      res.json({
        success: true,
        data: {
          id: bucket._id?.toString(),
          name: bucket.name,
          key: bucket.key,
          keywords: bucket.keywords || [],
          priority: bucket.priority ?? 50,
          enabled: bucket.enabled !== false
        }
      });
    } catch (error) {
      logger.error('[TriggerBuckets] Create error', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// PATCH /:companyId/trigger-buckets/:bucketId — update bucket
// ════════════════════════════════════════════════════════════════════════════
router.patch('/:companyId/trigger-buckets/:bucketId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, bucketId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!mongoose.Types.ObjectId.isValid(bucketId)) {
        return res.status(400).json({ success: false, error: 'Invalid bucket id' });
      }

      const bucket = await TriggerBucket.findOne({ _id: bucketId, companyId });
      if (!bucket) {
        return res.status(404).json({ success: false, error: 'Bucket not found' });
      }

      const { name, keywords, priority, enabled } = normalizeBucketPayload(req.body);
      if (name) bucket.name = name;
      if (Array.isArray(keywords)) bucket.keywords = keywords;
      if (typeof priority === 'number') bucket.priority = priority;
      bucket.enabled = enabled;
      bucket.updatedBy = userId;

      await bucket.save();
      TriggerBucketClassifier.invalidateCache(companyId);

      res.json({
        success: true,
        data: {
          id: bucket._id?.toString(),
          name: bucket.name,
          key: bucket.key,
          keywords: bucket.keywords || [],
          priority: bucket.priority ?? 50,
          enabled: bucket.enabled !== false
        }
      });
    } catch (error) {
      logger.error('[TriggerBuckets] Update error', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════
// DELETE /:companyId/trigger-buckets/:bucketId — delete bucket
// ════════════════════════════════════════════════════════════════════════════
router.delete('/:companyId/trigger-buckets/:bucketId',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_WRITE),
  async (req, res) => {
    try {
      const { companyId, bucketId } = req.params;
      const userId = req.user.id || req.user._id?.toString() || 'unknown';

      if (!mongoose.Types.ObjectId.isValid(bucketId)) {
        return res.status(400).json({ success: false, error: 'Invalid bucket id' });
      }

      const bucket = await TriggerBucket.findOne({ _id: bucketId, companyId });
      if (!bucket) {
        return res.status(404).json({ success: false, error: 'Bucket not found' });
      }

      const bucketKey = bucket.key;

      await CompanyLocalTrigger.updateMany(
        { companyId, bucket: bucketKey },
        { $set: { bucket: null, bucketValidatedAt: null, updatedAt: new Date() } }
      );

      const settings = await CompanyTriggerSettings.findOne({ companyId });
      if (settings?.partialOverrides) {
        const overrides = settings.partialOverrides instanceof Map
          ? settings.partialOverrides
          : new Map(Object.entries(settings.partialOverrides || {}));

        overrides.forEach((value, key) => {
          if (value && typeof value === 'object' && value.bucket === bucketKey) {
            overrides.set(key, { ...value, bucket: null, updatedAt: new Date(), updatedBy: userId });
          }
        });

        settings.partialOverrides = overrides;
        settings.updatedAt = new Date();
        await settings.save();
      }

      await bucket.deleteOne();

      TriggerBucketClassifier.invalidateCache(companyId);
      TriggerService.invalidateCacheForCompany(companyId);

      res.json({
        success: true,
        message: `Bucket "${bucket.name}" deleted`
      });
    } catch (error) {
      logger.error('[TriggerBuckets] Delete error', { error: error.message });
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

module.exports = router;

/**
 * ============================================================================
 * TRIGGER BUCKET - Company-specific intent buckets for trigger filtering
 * ============================================================================
 *
 * Buckets are scoped to a company and define intent groupings used to
 * pre-filter trigger evaluation. Each bucket has:
 * - Stable key (used by triggers + runtime)
 * - Human-readable name (UI label)
 * - Classification keywords (ScrabEngine input matching)
 *
 * DESIGN:
 * - key is stable and NOT auto-changed on name edits
 * - companyId + key is unique (multi-tenant isolation)
 * - keywords are normalized to lowercase + deduped
 * ============================================================================
 */

'use strict';

const mongoose = require('mongoose');

const triggerBucketSchema = new mongoose.Schema({
  companyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 80,
    index: true
  },
  keywords: {
    type: [String],
    default: [],
    validate: {
      validator: function(values) {
        return (values || []).every(v => typeof v === 'string' && v.length <= 200);
      },
      message: 'Each keyword must be a string under 200 characters'
    }
  },
  priority: {
    type: Number,
    default: 50,
    min: 1,
    max: 1000
  },
  enabled: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String,
    default: null
  }
}, {
  collection: 'triggerBuckets'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES (multi-tenant isolation)
// ─────────────────────────────────────────────────────────────────────────────
triggerBucketSchema.index({ companyId: 1, key: 1 }, { unique: true });
triggerBucketSchema.index({ companyId: 1, name: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
triggerBucketSchema.statics.buildKey = function(name) {
  if (!name || typeof name !== 'string') return null;
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || null;
};

triggerBucketSchema.statics.findByCompanyId = function(companyId) {
  return this.find({ companyId })
    .sort({ priority: 1, name: 1 })
    .lean();
};

triggerBucketSchema.statics.existsForCompany = function(companyId, key) {
  const normalizedKey = `${key || ''}`.toLowerCase().trim();
  if (!normalizedKey) return Promise.resolve(false);
  return this.exists({ companyId, key: normalizedKey });
};

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────
triggerBucketSchema.pre('validate', function(next) {
  if (!this.key && this.name) {
    this.key = this.constructor.buildKey(this.name);
  }
  if (this.key) {
    this.key = this.key.toLowerCase().trim();
  }
  if (this.name) {
    this.name = this.name.trim();
  }
  next();
});

triggerBucketSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (Array.isArray(this.keywords)) {
    const normalized = this.keywords
      .map(k => `${k || ''}`.toLowerCase().trim())
      .filter(Boolean);
    this.keywords = Array.from(new Set(normalized));
  }
  next();
});

const TriggerBucketModel = mongoose.model('TriggerBucket', triggerBucketSchema);

// Drop legacy unique index on { companyId, name } if it exists (was created in earlier version)
TriggerBucketModel.collection.dropIndex('companyId_1_name_1').catch(() => {});

module.exports = TriggerBucketModel;

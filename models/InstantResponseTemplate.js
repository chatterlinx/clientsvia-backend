/**
 * INSTANT RESPONSE TEMPLATE MODEL
 * 
 * Purpose: Template library for instant responses
 * - Provides reusable templates for common business scenarios
 * - Supports multi-tenant template sharing
 * - Enables quick setup for new companies
 * 
 * Schema:
 * - name: Template name (e.g., "Plumber Basic Hours")
 * - category: Business category (e.g., "plumbing", "hvac", "general")
 * - description: What the template covers
 * - templates: Array of pre-configured instant responses
 * - isPublic: Whether template is available to all tenants
 * - createdBy: User who created the template
 * - tags: For searchability
 * 
 * Usage:
 * - Admins browse and apply templates to companies
 * - System suggests templates based on trade category
 * - Companies can save their configs as templates
 * 
 * Last Updated: 2025-10-02
 */

const mongoose = require('mongoose');

const instantResponseTemplateSchema = new mongoose.Schema({
  // Template Identification
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  category: {
    type: String,
    required: true,
    enum: [
      'general',
      'plumbing',
      'hvac',
      'electrical',
      'roofing',
      'landscaping',
      'cleaning',
      'automotive',
      'medical',
      'legal',
      'restaurant',
      'retail',
      'other'
    ],
    default: 'general',
    index: true
  },

  description: {
    type: String,
    required: true,
    trim: true
  },

  // Template Content
  templates: [{
    trigger: {
      type: String,
      required: true,
      trim: true
    },
    response: {
      type: String,
      required: true,
      trim: true
    },
    category: {
      type: String,
      enum: ['hours', 'location', 'pricing', 'services', 'contact', 'booking', 'emergency', 'other'],
      default: 'other'
    },
    priority: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    },
    notes: {
      type: String,
      trim: true
    }
  }],

  // Metadata
  isPublic: {
    type: Boolean,
    default: false,
    index: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'v2User',
    required: true
  },

  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],

  usageCount: {
    type: Number,
    default: 0
  },

  lastUsed: {
    type: Date
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
instantResponseTemplateSchema.index({ category: 1, isPublic: 1 });
instantResponseTemplateSchema.index({ tags: 1 });
instantResponseTemplateSchema.index({ createdBy: 1 });
instantResponseTemplateSchema.index({ usageCount: -1 });

// Methods

// Increment usage count
instantResponseTemplateSchema.methods.recordUsage = function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

// Get template responses in company-ready format
instantResponseTemplateSchema.methods.getFormattedResponses = function() {
  return this.templates.map(t => ({
    trigger: t.trigger,
    response: t.response,
    category: t.category,
    priority: t.priority,
    enabled: true,
    source: 'template',
    templateId: this._id,
    templateName: this.name
  }));
};

// Static Methods

// Find templates by category
instantResponseTemplateSchema.statics.findByCategory = function(category, publicOnly = true) {
  const query = { category };
  if (publicOnly) {
    query.isPublic = true;
  }
  return this.find(query).sort({ usageCount: -1, name: 1 });
};

// Find templates by tags
instantResponseTemplateSchema.statics.findByTags = function(tags, publicOnly = true) {
  const query = { tags: { $in: tags } };
  if (publicOnly) {
    query.isPublic = true;
  }
  return this.find(query).sort({ usageCount: -1, name: 1 });
};

// Search templates
instantResponseTemplateSchema.statics.search = function(searchTerm, publicOnly = true) {
  const query = {
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } }
    ]
  };
  if (publicOnly) {
    query.isPublic = true;
  }
  return this.find(query).sort({ usageCount: -1, name: 1 });
};

// Get most popular templates
instantResponseTemplateSchema.statics.getMostPopular = function(limit = 10, publicOnly = true) {
  const query = publicOnly ? { isPublic: true } : {};
  return this.find(query)
    .sort({ usageCount: -1 })
    .limit(limit);
};

// Pre-save middleware
instantResponseTemplateSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const InstantResponseTemplate = mongoose.model('InstantResponseTemplate', instantResponseTemplateSchema);

module.exports = InstantResponseTemplate;

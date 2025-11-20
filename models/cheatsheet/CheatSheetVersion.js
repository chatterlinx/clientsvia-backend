/**
 * ============================================================================
 * CHEATSHEET VERSION MODEL
 * ============================================================================
 * 
 * Separate collection for all config versions (live, draft, archived).
 * This prevents Company document bloat and enables clean version history.
 * 
 * Key Design Decisions:
 * 1. Separate collection (not embedded in Company)
 * 2. Single source of truth via CheatSheetConfigSchema import
 * 3. Optimistic concurrency control for multi-admin safety
 * 4. Compound indexes for fast queries
 * 
 * Status Flow:
 *   draft → live → archived
 * 
 * Invariants Enforced by Service Layer:
 * - At most ONE live version per company
 * - At most ONE draft version per company
 * - Live config is READ-ONLY (edits happen on draft clones)
 * ============================================================================
 */

const mongoose = require('mongoose');
const { CheatSheetConfigSchema } = require('./CheatSheetConfigSchema');

const CheatSheetVersionSchema = new mongoose.Schema({
  
  // ============================================================================
  // IDENTITY & OWNERSHIP
  // ============================================================================
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true,
    index: true 
  },
  
  versionId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  
  // ============================================================================
  // VERSION METADATA
  // ============================================================================
  
  status: { 
    type: String, 
    enum: ['live', 'draft', 'archived'], 
    required: true,
    index: true 
  },
  
  name: { 
    type: String, 
    required: true,
    maxlength: 200,
    trim: true
  },
  
  notes: { 
    type: String, 
    default: '',
    maxlength: 2000
  },
  
  // ============================================================================
  // INTEGRITY & VERIFICATION
  // ============================================================================
  
  checksum: { 
    type: String, 
    default: null,
    index: true
  },
  
  // ============================================================================
  // AUDIT TRAIL
  // ============================================================================
  
  createdBy: { 
    type: String, 
    required: true 
  },
  
  activatedAt: { 
    type: Date, 
    default: null,
    index: true
  },
  
  archivedAt: { 
    type: Date, 
    default: null 
  },
  
  // ============================================================================
  // THE CONFIG ITSELF - SINGLE SOURCE OF TRUTH
  // ============================================================================
  
  config: {
    type: CheatSheetConfigSchema,
    required: true,
    default: () => ({
      schemaVersion: 1,
      triage: {},
      frontlineIntel: {},
      transferRules: {},
      edgeCases: {},
      behavior: {},
      guardrails: {},
      bookingRules: [],
      companyContacts: [],
      links: [],
      calculators: []
    })
  }
  
}, { 
  timestamps: true  // Adds createdAt, updatedAt
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Find live/draft for a company (most common query)
CheatSheetVersionSchema.index({ companyId: 1, status: 1 });

// Version history queries (sorted by activation date)
CheatSheetVersionSchema.index({ companyId: 1, status: 1, activatedAt: -1 });

// Lookup by versionId (for restore operations)
CheatSheetVersionSchema.index({ versionId: 1 });

// Cleanup/archival queries
CheatSheetVersionSchema.index({ status: 1, archivedAt: 1 });

// ============================================================================
// OPTIMISTIC CONCURRENCY CONTROL
// ============================================================================
// Protects against two admins editing the same draft simultaneously
// Mongoose will throw VersionError if __v doesn't match
CheatSheetVersionSchema.set('optimisticConcurrency', true);

// ============================================================================
// VALIDATION HOOKS
// ============================================================================

/**
 * Pre-save validation: Ensure config size is reasonable
 */
CheatSheetVersionSchema.pre('save', function(next) {
  if (this.isModified('config')) {
    const configSize = JSON.stringify(this.config).length;
    const maxSize = 5 * 1024 * 1024; // 5MB
    
    if (configSize > maxSize) {
      const sizeMB = (configSize / 1024 / 1024).toFixed(2);
      return next(new Error(`Config too large: ${sizeMB}MB (max 5MB)`));
    }
  }
  next();
});

/**
 * Pre-save validation: Status transitions are valid
 */
CheatSheetVersionSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    const validTransitions = {
      draft: ['live', 'archived'],
      live: ['archived'],
      archived: [] // Cannot transition out of archived
    };
    
    const originalStatus = this._original?.status;
    const newStatus = this.status;
    
    if (originalStatus && !validTransitions[originalStatus]?.includes(newStatus)) {
      return next(new Error(`Invalid status transition: ${originalStatus} → ${newStatus}`));
    }
    
    // Set timestamps based on status change
    if (newStatus === 'live' && !this.activatedAt) {
      this.activatedAt = new Date();
    }
    if (newStatus === 'archived' && !this.archivedAt) {
      this.archivedAt = new Date();
    }
  }
  next();
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Clone this version to create a new draft
 */
CheatSheetVersionSchema.methods.cloneToDraft = function(name, userEmail) {
  const CheatSheetVersion = mongoose.model('CheatSheetVersion');
  
  return new CheatSheetVersion({
    companyId: this.companyId,
    status: 'draft',
    versionId: `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    notes: `Cloned from: ${this.name}`,
    createdBy: userEmail,
    config: this.config.toObject() // Deep clone
  });
};

/**
 * Get human-readable summary of this version
 */
CheatSheetVersionSchema.methods.getSummary = function() {
  return {
    versionId: this.versionId,
    name: this.name,
    status: this.status,
    createdBy: this.createdBy,
    createdAt: this.createdAt,
    activatedAt: this.activatedAt,
    checksum: this.checksum,
    schemaVersion: this.config.schemaVersion,
    stats: {
      bookingRules: this.config.bookingRules?.length || 0,
      companyContacts: this.config.companyContacts?.length || 0,
      links: this.config.links?.length || 0,
      calculators: this.config.calculators?.length || 0
    }
  };
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Find live version for a company
 */
CheatSheetVersionSchema.statics.findLive = function(companyId) {
  return this.findOne({ companyId, status: 'live' });
};

/**
 * Find draft version for a company
 */
CheatSheetVersionSchema.statics.findDraft = function(companyId) {
  return this.findOne({ companyId, status: 'draft' });
};

/**
 * Get version history for a company
 */
CheatSheetVersionSchema.statics.getHistory = function(companyId, limit = 50) {
  return this.find({
    companyId,
    status: { $in: ['live', 'archived'] }
  })
  .sort({ activatedAt: -1, createdAt: -1 })
  .limit(limit)
  .lean();
};

// ============================================================================
// MIDDLEWARE FOR DEBUGGING
// ============================================================================

/**
 * Log all saves for audit trail
 */
CheatSheetVersionSchema.post('save', function(doc) {
  const logger = require('../../utils/logger');
  logger.debug('CHEATSHEET_VERSION_SAVED', {
    versionId: doc.versionId,
    companyId: doc.companyId,
    status: doc.status,
    name: doc.name
  });
});

// ============================================================================
// EXPORT MODEL
// ============================================================================

module.exports = mongoose.model('CheatSheetVersion', CheatSheetVersionSchema);


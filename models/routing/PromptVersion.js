/**
 * ============================================================================
 * PROMPT VERSION MODEL - PRECISION FRONTLINE-INTEL V23
 * ============================================================================
 * 
 * PURPOSE: Version control for Micro-LLM routing prompts
 * ARCHITECTURE: MongoDB document per prompt version
 * 
 * FEATURES:
 * - A/B testing (deploy v1.1 to 10% of traffic)
 * - Rollback (instant revert to v1.0)
 * - Accuracy tracking per version
 * - Change history with tuning notes
 * 
 * LIFECYCLE:
 * DRAFT → TESTING → LIVE → ARCHIVED
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PromptVersionSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    
    version: {
      type: String,
      required: true,
      // Format: "v1.0", "v1.1", "v2.0"
    },
    
    versionHash: {
      type: String,
      required: true,
      index: true,
      // Murmurhash of compiled prompt for cache keys
    },
    
    promptTemplate: {
      type: String,
      required: true,
      // Full compiled prompt text
    },
    
    triageCardsSnapshot: {
      type: Array,
      default: [],
      // Snapshot of Triage Cards used to build this prompt
      // Allows reconstruction of exact state
    },
    
    status: {
      type: String,
      enum: ['DRAFT', 'TESTING', 'LIVE', 'ARCHIVED'],
      default: 'DRAFT',
      index: true
    },
    
    // A/B testing config
    trafficAllocation: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
      // Percentage of traffic using this version (0-100)
      // Example: v1.0 = 90%, v1.1 = 10%
    },
    
    // Performance metrics (auto-updated by routing system)
    metrics: {
      totalDecisions: {
        type: Number,
        default: 0
      },
      correctRoutes: {
        type: Number,
        default: 0
      },
      incorrectRoutes: {
        type: Number,
        default: 0
      },
      accuracy: {
        type: Number,
        default: 0,
        // Auto-calculated: correctRoutes / totalDecisions
      },
      avgConfidence: {
        type: Number,
        default: 0
      },
      avgLatency: {
        type: Number,
        default: 0,
        // Average ms to get routing decision
      },
      lastUpdated: {
        type: Date,
        default: null
      }
    },
    
    // Human-readable changelog
    tuningNotes: {
      type: String,
      default: '',
      // Example: "Added 'sweating' to LEAK keywords, removed 'maintenance' false positives"
    },
    
    // Audit trail
    createdBy: {
      type: String,
      default: 'system',
      // Admin ID who created this version
    },
    
    deployedBy: {
      type: String,
      default: null
    },
    
    deployedAt: {
      type: Date,
      default: null
    },
    
    archivedBy: {
      type: String,
      default: null
    },
    
    archivedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    // Adds createdAt and updatedAt
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for fast lookup of live version per company
PromptVersionSchema.index({ companyId: 1, status: 1 });

// Unique version per company
PromptVersionSchema.index({ companyId: 1, version: 1 }, { unique: true });

// ============================================================================
// METHODS
// ============================================================================

/**
 * Update metrics after a routing decision
 */
PromptVersionSchema.methods.recordDecision = async function(wasCorrect, confidence, latency) {
  this.metrics.totalDecisions += 1;
  
  if (wasCorrect) {
    this.metrics.correctRoutes += 1;
  } else {
    this.metrics.incorrectRoutes += 1;
  }
  
  // Recalculate accuracy
  this.metrics.accuracy = this.metrics.totalDecisions > 0
    ? this.metrics.correctRoutes / this.metrics.totalDecisions
    : 0;
  
  // Update running averages (exponential moving average)
  const alpha = 0.1; // Smoothing factor
  this.metrics.avgConfidence = this.metrics.avgConfidence > 0
    ? (alpha * confidence) + ((1 - alpha) * this.metrics.avgConfidence)
    : confidence;
  
  this.metrics.avgLatency = this.metrics.avgLatency > 0
    ? (alpha * latency) + ((1 - alpha) * this.metrics.avgLatency)
    : latency;
  
  this.metrics.lastUpdated = new Date();
  
  await this.save();
};

/**
 * Deploy this version to LIVE status
 */
PromptVersionSchema.methods.deploy = async function(deployedBy) {
  // Archive previous LIVE version
  await this.constructor.updateMany(
    { companyId: this.companyId, status: 'LIVE' },
    { 
      $set: { 
        status: 'ARCHIVED',
        archivedBy: deployedBy,
        archivedAt: new Date()
      }
    }
  );
  
  // Set this to LIVE
  this.status = 'LIVE';
  this.deployedBy = deployedBy;
  this.deployedAt = new Date();
  this.trafficAllocation = 100;
  
  await this.save();
};

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get current LIVE version for a company
 */
PromptVersionSchema.statics.getLiveVersion = async function(companyId) {
  return this.findOne({ companyId, status: 'LIVE' }).lean();
};

/**
 * Get all versions for a company (sorted by version number)
 */
PromptVersionSchema.statics.getVersionHistory = async function(companyId) {
  return this.find({ companyId })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Create a new version
 */
PromptVersionSchema.statics.createVersion = async function({
  companyId,
  version,
  versionHash,
  promptTemplate,
  triageCardsSnapshot,
  tuningNotes,
  createdBy
}) {
  return this.create({
    companyId,
    version,
    versionHash,
    promptTemplate,
    triageCardsSnapshot,
    tuningNotes,
    createdBy,
    status: 'DRAFT'
  });
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('PromptVersion', PromptVersionSchema);


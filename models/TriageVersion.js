/**
 * TriageVersion Model
 * 
 * PURPOSE: Version control for triage card configurations
 * - Every "Apply" creates a new version
 * - One-click rollback to any previous version
 * - Full audit trail of who changed what
 * 
 * ARCHITECTURE: Immutable snapshots - never modify, only create new
 * 
 * @module models/TriageVersion
 */

const mongoose = require('mongoose');

const triageVersionSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'V2Company',
    required: true,
    index: true
  },
  
  version: {
    type: Number,
    required: true,
    min: 1
  },
  
  versionName: {
    type: String,
    required: true,
    maxlength: 100
    // e.g., "2025-12-02-gas-leak-fix", "initial-setup", "post-evaluation-v3"
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT OF ALL CARDS AT THIS VERSION
  // ═══════════════════════════════════════════════════════════════════════════
  cards: [{
    originalCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TriageCard'
    },
    
    // Full card data snapshot (denormalized for immutability)
    triageLabel: String,
    displayName: String,
    intent: String,
    triageCategory: String,
    serviceType: String,
    isActive: Boolean,
    priority: Number,
    
    // Keywords at this version
    mustHaveKeywords: [String],
    excludeKeywords: [String],
    
    // Action configuration
    action: {
      type: String,
      enum: ['BOOK_APPOINTMENT', 'TRANSFER_TO_HUMAN', 'SEND_TO_VOICEMAIL', 
             'PLAY_MESSAGE', 'DIRECT_TO_3TIER', 'COLLECT_INFO', 'END_CALL',
             'ESCALATE_TO_HUMAN', 'ROUTE_TO_SCENARIO']
    },
    
    // Linked scenario
    linkedScenarioId: mongoose.Schema.Types.ObjectId,
    linkedScenarioName: String,
    
    // Playbook/explanation
    explanation: String,
    qnaCardRef: String
  }],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CHANGE TRACKING
  // ═══════════════════════════════════════════════════════════════════════════
  changeType: {
    type: String,
    enum: [
      'INITIAL_SETUP',           // First version
      'MANUAL_EDIT',             // Admin edited cards manually
      'LLM_SUGGESTION_APPLIED',  // Applied LLM recommendations
      'BULK_KEYWORD_ADD',        // Added keywords to multiple cards
      'CARD_CREATED',            // New card(s) created
      'CARD_DELETED',            // Card(s) deleted
      'ROLLBACK',                // Rolled back to previous version
      'IMPORT',                  // Imported from template/another company
      'EVALUATION_FIX'           // Applied fixes from evaluation
    ],
    required: true
  },
  
  changeSummary: {
    type: String,
    maxlength: 500
    // e.g., "Added 5 keywords to 'AC Not Cooling', created 'Pricing Questions' card"
  },
  
  changesDetail: [{
    cardId: mongoose.Schema.Types.ObjectId,
    cardName: String,
    changeType: {
      type: String,
      enum: ['CREATED', 'MODIFIED', 'DELETED', 'KEYWORDS_ADDED', 'KEYWORDS_REMOVED',
             'ACTION_CHANGED', 'PRIORITY_CHANGED', 'ENABLED', 'DISABLED']
    },
    before: mongoose.Schema.Types.Mixed,  // Previous value
    after: mongoose.Schema.Types.Mixed    // New value
  }],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT TRAIL
  // ═══════════════════════════════════════════════════════════════════════════
  appliedBy: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    email: String,
    role: String,
    ip: String
  },
  
  appliedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LLM SUGGESTION METADATA (if applicable)
  // ═══════════════════════════════════════════════════════════════════════════
  llmSuggestion: {
    wasLlmGenerated: {
      type: Boolean,
      default: false
    },
    
    suggestionId: String,  // Reference to the evaluation that generated this
    
    confidence: {
      type: Number,
      min: 0,
      max: 1
    },
    
    promptUsed: String,    // For debugging/auditing
    
    suggestionsApplied: [{
      type: {
        type: String,
        enum: ['KEYWORD_ADD', 'KEYWORD_REMOVE', 'CARD_CREATE', 'ACTION_CHANGE']
      },
      cardName: String,
      suggestion: String,
      confidence: Number
    }],
    
    suggestionsRejected: [{
      type: String,
      cardName: String,
      suggestion: String,
      rejectionReason: String
    }]
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  status: {
    type: String,
    enum: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK_FROM', 'ROLLED_BACK_TO'],
    default: 'ACTIVE',
    index: true
  },
  
  // If this version was created by rolling back, reference the source
  rolledBackFrom: {
    versionId: mongoose.Schema.Types.ObjectId,
    version: Number
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // METRICS AT TIME OF VERSION (for comparison)
  // ═══════════════════════════════════════════════════════════════════════════
  metricsSnapshot: {
    totalCards: Number,
    activeCards: Number,
    disabledCards: Number,
    totalKeywords: Number,
    avgKeywordsPerCard: Number,
    
    // Coverage metrics (if evaluation was run)
    evaluationGrade: String,
    coverageScore: Number,
    gapsIdentified: Number
  }
  
}, {
  timestamps: true,
  collection: 'triage_versions'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Unique version per company
triageVersionSchema.index({ companyId: 1, version: 1 }, { unique: true });

// Fast lookup for latest version
triageVersionSchema.index({ companyId: 1, appliedAt: -1 });

// Find active version quickly
triageVersionSchema.index({ companyId: 1, status: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the current active version for a company
 */
triageVersionSchema.statics.getCurrentVersion = async function(companyId) {
  return this.findOne({ 
    companyId, 
    status: 'ACTIVE' 
  }).sort({ version: -1 });
};

/**
 * Get version history for a company (most recent first)
 */
triageVersionSchema.statics.getVersionHistory = async function(companyId, limit = 20) {
  return this.find({ companyId })
    .sort({ version: -1 })
    .limit(limit)
    .select('version versionName changeType changeSummary appliedBy appliedAt status metricsSnapshot');
};

/**
 * Create a new version from current triage cards
 */
triageVersionSchema.statics.createVersion = async function({
  companyId,
  versionName,
  changeType,
  changeSummary,
  changesDetail,
  appliedBy,
  llmSuggestion,
  TriageCard // Pass the model to avoid circular dependency
}) {
  const logger = require('../utils/logger');
  
  // Get current version number
  const latestVersion = await this.findOne({ companyId }).sort({ version: -1 });
  const newVersionNumber = latestVersion ? latestVersion.version + 1 : 1;
  
  // Mark previous active version as superseded
  if (latestVersion && latestVersion.status === 'ACTIVE') {
    latestVersion.status = 'SUPERSEDED';
    await latestVersion.save();
  }
  
  // Get current state of all triage cards
  const currentCards = await TriageCard.find({ companyId }).lean();
  
  // Snapshot the cards
  const cardSnapshots = currentCards.map(card => ({
    originalCardId: card._id,
    triageLabel: card.triageLabel,
    displayName: card.displayName,
    intent: card.intent,
    triageCategory: card.triageCategory,
    serviceType: card.serviceType,
    isActive: card.isActive,
    priority: card.priority,
    mustHaveKeywords: card.mustHaveKeywords || [],
    excludeKeywords: card.excludeKeywords || [],
    action: card.action,
    linkedScenarioId: card.linkedScenarioId,
    linkedScenarioName: card.linkedScenarioName,
    explanation: card.explanation,
    qnaCardRef: card.qnaCardRef
  }));
  
  // Calculate metrics
  const activeCards = cardSnapshots.filter(c => c.isActive);
  const totalKeywords = cardSnapshots.reduce((sum, c) => 
    sum + (c.mustHaveKeywords?.length || 0), 0);
  
  const newVersion = new this({
    companyId,
    version: newVersionNumber,
    versionName: versionName || `v${newVersionNumber}-${new Date().toISOString().split('T')[0]}`,
    cards: cardSnapshots,
    changeType,
    changeSummary,
    changesDetail: changesDetail || [],
    appliedBy,
    llmSuggestion,
    status: 'ACTIVE',
    metricsSnapshot: {
      totalCards: cardSnapshots.length,
      activeCards: activeCards.length,
      disabledCards: cardSnapshots.length - activeCards.length,
      totalKeywords,
      avgKeywordsPerCard: cardSnapshots.length > 0 
        ? Math.round(totalKeywords / cardSnapshots.length * 10) / 10 
        : 0
    }
  });
  
  await newVersion.save();
  
  logger.info('[TRIAGE VERSION] Created new version', {
    companyId: String(companyId),
    version: newVersionNumber,
    versionName: newVersion.versionName,
    changeType,
    cardCount: cardSnapshots.length
  });
  
  return newVersion;
};

/**
 * Rollback to a specific version
 */
triageVersionSchema.statics.rollbackToVersion = async function({
  companyId,
  targetVersion,
  appliedBy,
  TriageCard // Pass the model to avoid circular dependency
}) {
  const logger = require('../utils/logger');
  
  // Find the target version
  const targetVersionDoc = await this.findOne({ companyId, version: targetVersion });
  if (!targetVersionDoc) {
    throw new Error(`Version ${targetVersion} not found for company ${companyId}`);
  }
  
  // Get current version
  const currentVersion = await this.getCurrentVersion(companyId);
  
  // Delete all current cards
  await TriageCard.deleteMany({ companyId });
  
  // Recreate cards from the target version snapshot
  const restoredCards = [];
  for (const cardSnapshot of targetVersionDoc.cards) {
    const newCard = new TriageCard({
      companyId,
      triageLabel: cardSnapshot.triageLabel,
      displayName: cardSnapshot.displayName,
      intent: cardSnapshot.intent,
      triageCategory: cardSnapshot.triageCategory,
      serviceType: cardSnapshot.serviceType,
      isActive: cardSnapshot.isActive,
      priority: cardSnapshot.priority,
      mustHaveKeywords: cardSnapshot.mustHaveKeywords,
      excludeKeywords: cardSnapshot.excludeKeywords,
      action: cardSnapshot.action,
      linkedScenarioId: cardSnapshot.linkedScenarioId,
      linkedScenarioName: cardSnapshot.linkedScenarioName,
      explanation: cardSnapshot.explanation,
      qnaCardRef: cardSnapshot.qnaCardRef
    });
    await newCard.save();
    restoredCards.push(newCard);
  }
  
  // Mark current version as rolled-back-from
  if (currentVersion) {
    currentVersion.status = 'ROLLED_BACK_FROM';
    await currentVersion.save();
  }
  
  // Create a new version entry for the rollback
  const newVersion = await this.createVersion({
    companyId,
    versionName: `rollback-to-v${targetVersion}`,
    changeType: 'ROLLBACK',
    changeSummary: `Rolled back from v${currentVersion?.version || '?'} to v${targetVersion}`,
    changesDetail: [{
      changeType: 'ROLLBACK',
      before: { version: currentVersion?.version },
      after: { version: targetVersion }
    }],
    appliedBy,
    TriageCard
  });
  
  // Update the new version with rollback reference
  newVersion.rolledBackFrom = {
    versionId: currentVersion?._id,
    version: currentVersion?.version
  };
  newVersion.status = 'ROLLED_BACK_TO';
  await newVersion.save();
  
  logger.info('[TRIAGE VERSION] Rollback completed', {
    companyId: String(companyId),
    fromVersion: currentVersion?.version,
    toVersion: targetVersion,
    newVersion: newVersion.version,
    cardsRestored: restoredCards.length
  });
  
  return {
    newVersion,
    restoredCards,
    previousVersion: currentVersion?.version
  };
};

/**
 * Compare two versions (for diff view)
 */
triageVersionSchema.statics.compareVersions = async function(companyId, versionA, versionB) {
  const [docA, docB] = await Promise.all([
    this.findOne({ companyId, version: versionA }),
    this.findOne({ companyId, version: versionB })
  ]);
  
  if (!docA || !docB) {
    throw new Error('One or both versions not found');
  }
  
  const cardsA = new Map(docA.cards.map(c => [c.triageLabel, c]));
  const cardsB = new Map(docB.cards.map(c => [c.triageLabel, c]));
  
  const diff = {
    added: [],      // In B but not A
    removed: [],    // In A but not B
    modified: [],   // In both but different
    unchanged: []   // In both and same
  };
  
  // Check cards in B
  for (const [label, cardB] of cardsB) {
    const cardA = cardsA.get(label);
    if (!cardA) {
      diff.added.push(cardB);
    } else {
      // Compare relevant fields
      const keywordsChanged = JSON.stringify(cardA.mustHaveKeywords?.sort()) !== 
                             JSON.stringify(cardB.mustHaveKeywords?.sort());
      const excludeChanged = JSON.stringify(cardA.excludeKeywords?.sort()) !== 
                            JSON.stringify(cardB.excludeKeywords?.sort());
      const actionChanged = cardA.action !== cardB.action;
      const activeChanged = cardA.isActive !== cardB.isActive;
      
      if (keywordsChanged || excludeChanged || actionChanged || activeChanged) {
        diff.modified.push({
          label,
          before: cardA,
          after: cardB,
          changes: {
            keywords: keywordsChanged,
            excludeKeywords: excludeChanged,
            action: actionChanged,
            isActive: activeChanged
          }
        });
      } else {
        diff.unchanged.push(label);
      }
    }
  }
  
  // Check for removed cards (in A but not B)
  for (const [label, cardA] of cardsA) {
    if (!cardsB.has(label)) {
      diff.removed.push(cardA);
    }
  }
  
  return {
    versionA: { version: versionA, date: docA.appliedAt, name: docA.versionName },
    versionB: { version: versionB, date: docB.appliedAt, name: docB.versionName },
    diff,
    summary: {
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      unchanged: diff.unchanged.length
    }
  };
};

const TriageVersion = mongoose.model('TriageVersion', triageVersionSchema);

module.exports = TriageVersion;


/**
 * ============================================================================
 * TRIGGER AUDIO - Company-specific audio recordings for trigger cards
 * ============================================================================
 *
 * Each document represents a company-specific audio recording for a trigger.
 * Audio is NEVER shared between companies - each companyId has their own.
 *
 * ISOLATION RULES:
 * - Audio is scoped by (companyId, ruleId) - unique per company
 * - Text hash tracks if answer text changed (invalidates audio)
 * - Each company uses their own ElevenLabs voice configuration
 *
 * LIFECYCLE:
 * - Created when company generates audio for a trigger
 * - Invalidated when trigger answer text changes
 * - Deleted when trigger is deleted
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const triggerAudioSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Company + Trigger)
  // ─────────────────────────────────────────────────────────────────────────
  companyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  ruleId: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIO DATA
  // ─────────────────────────────────────────────────────────────────────────
  audioUrl: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  // Hash of the answer text this audio was generated from
  // If text changes, hash changes, audio becomes stale
  textHash: {
    type: String,
    required: true,
    index: true
  },
  
  // The actual text that was used to generate this audio
  sourceText: {
    type: String,
    required: true,
    maxlength: 2000
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VOICE INFO (for debugging/audit)
  // ─────────────────────────────────────────────────────────────────────────
  voiceId: {
    type: String,
    default: null
  },
  voiceProvider: {
    type: String,
    enum: ['elevenlabs', 'google', 'azure', 'aws'],
    default: 'elevenlabs'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────────────────────
  isValid: {
    type: Boolean,
    default: true
  },
  invalidatedAt: {
    type: Date,
    default: null
  },
  invalidatedReason: {
    type: String,
    default: null
  },

  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
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
  timestamps: false,
  collection: 'triggerAudios'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

// Unique constraint: one audio per (company, ruleId)
triggerAudioSchema.index({ companyId: 1, ruleId: 1 }, { unique: true });

// Query by company
triggerAudioSchema.index({ companyId: 1, isValid: 1 });

// Cleanup old/invalid audio
triggerAudioSchema.index({ isValid: 1, createdAt: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate hash from text for comparison
 */
triggerAudioSchema.statics.hashText = function(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
};

/**
 * Find audio for a specific company + trigger
 */
triggerAudioSchema.statics.findByCompanyAndRule = function(companyId, ruleId) {
  return this.findOne({ companyId, ruleId, isValid: true }).lean();
};

/**
 * Find all audio for a company
 */
triggerAudioSchema.statics.findByCompanyId = function(companyId) {
  return this.find({ companyId, isValid: true }).sort({ createdAt: -1 }).lean();
};

/**
 * Save or update audio for a trigger
 */
triggerAudioSchema.statics.saveAudio = async function(companyId, ruleId, audioUrl, answerText, voiceId, userId) {
  const textHash = this.hashText(answerText);
  
  const existing = await this.findOne({ companyId, ruleId });
  
  if (existing) {
    // Update existing
    existing.audioUrl = audioUrl;
    existing.textHash = textHash;
    existing.sourceText = answerText;
    existing.voiceId = voiceId || existing.voiceId;
    existing.isValid = true;
    existing.invalidatedAt = null;
    existing.invalidatedReason = null;
    existing.updatedAt = new Date();
    existing.updatedBy = userId;
    return existing.save();
  } else {
    // Create new
    return this.create({
      companyId,
      ruleId,
      audioUrl,
      textHash,
      sourceText: answerText,
      voiceId,
      voiceProvider: 'elevenlabs',
      isValid: true,
      createdBy: userId,
      updatedBy: userId
    });
  }
};

/**
 * Check if audio is still valid for given text
 */
triggerAudioSchema.statics.isAudioValid = async function(companyId, ruleId, currentText) {
  const audio = await this.findOne({ companyId, ruleId, isValid: true });
  if (!audio) {
    return false;
  }
  
  const currentHash = this.hashText(currentText);
  return audio.textHash === currentHash;
};

/**
 * Invalidate audio (when text changes)
 */
triggerAudioSchema.statics.invalidateAudio = function(companyId, ruleId, reason) {
  return this.updateOne(
    { companyId, ruleId },
    {
      $set: {
        isValid: false,
        invalidatedAt: new Date(),
        invalidatedReason: reason || 'TEXT_CHANGED'
      }
    }
  );
};

/**
 * Delete audio for a trigger
 */
triggerAudioSchema.statics.deleteAudio = function(companyId, ruleId) {
  return this.deleteOne({ companyId, ruleId });
};

/**
 * Cleanup invalid audio older than X days
 */
triggerAudioSchema.statics.cleanupOldInvalid = function(daysOld = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  
  return this.deleteMany({
    isValid: false,
    invalidatedAt: { $lt: cutoff }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

triggerAudioSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('TriggerAudio', triggerAudioSchema);

/**
 * ============================================================================
 * LAP RESPONSE AUDIO - Company-specific pre-recorded audio for LAP responses
 * ============================================================================
 *
 * Each document stores a pre-recorded MP3 for a LAP entry's response text.
 * Audio is generated via ElevenLabs and cached both on disk (fast) and in
 * MongoDB (survives Render deploys).
 *
 * ARCHITECTURE:
 * - LAP phrases + responses are GLOBAL (AdminSettings.lapEntries)
 * - Audio is PER-COMPANY — each company generates in their own voice
 * - Scoped by (companyId, fileHash) — unique per company + response text
 *
 * LIFECYCLE:
 * - Created when admin clicks "Generate Audio" on lap.html for a company
 * - Purged when voice settings change
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const lapResponseAudioSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Company + Hash)
  // ─────────────────────────────────────────────────────────────────────────
  companyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  // 16-char hex hash from SHA256 of companyId + text + voiceFingerprint
  fileHash: {
    type: String,
    required: true,
    trim: true,
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

  // MP3 binary stored in MongoDB — survives deploys, no filesystem dependency
  audioData: {
    type: Buffer,
    default: null
  },

  // Hash of the source text this audio was generated from
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

  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'lapResponseAudios'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

// Unique constraint: one audio per (company, fileHash)
lapResponseAudioSchema.index({ companyId: 1, fileHash: 1 }, { unique: true });

// Query by company + validity
lapResponseAudioSchema.index({ companyId: 1, isValid: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate hash from text for comparison
 */
lapResponseAudioSchema.statics.hashText = function(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
};

/**
 * Save or update audio for a LAP response.
 * Uses findOneAndUpdate with $set to bypass Mongoose Buffer handling issues.
 */
lapResponseAudioSchema.statics.saveAudio = async function(companyId, fileHash, audioUrl, sourceText, voiceId, audioBuffer) {
  const logger = require('../utils/logger');
  const textHash = this.hashText(sourceText);
  const hasBuffer = audioBuffer !== undefined && audioBuffer !== null;
  const safeBuf = hasBuffer
    ? (Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer))
    : undefined;

  const setFields = {
    audioUrl,
    textHash,
    sourceText,
    voiceId: voiceId || undefined,
    voiceProvider: 'elevenlabs',
    isValid: true,
    updatedAt: new Date(),
  };

  if (hasBuffer) {
    setFields.audioData = safeBuf;
  }

  const result = await this.findOneAndUpdate(
    { companyId, fileHash },
    {
      $set: setFields,
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true, runValidators: false }
  );

  logger.info('[LAPResponseAudio.saveAudio] Saved', {
    companyId: companyId?.slice(0, 12),
    fileHash,
    audioUrl,
    bytes: safeBuf?.length || 0,
  });

  return result;
};

/**
 * Find audio binary by URL path (used by audioFallback.js)
 */
lapResponseAudioSchema.statics.findAudioDataByUrl = async function(audioUrl) {
  const doc = await this.findOne({ audioUrl, isValid: true }).select('audioData').lean();
  return doc?.audioData || null;
};

/**
 * Find audio binary by fileHash + companyId
 */
lapResponseAudioSchema.statics.findAudioDataByHash = async function(companyId, fileHash) {
  const doc = await this.findOne({ companyId, fileHash, isValid: true }).select('audioData audioUrl sourceText').lean();
  return doc || null;
};

/**
 * Get all valid audio for a company (for coverage checks)
 */
lapResponseAudioSchema.statics.getCompanyCoverage = async function(companyId) {
  return this.find({ companyId, isValid: true }).select('fileHash textHash sourceText audioUrl').lean();
};

/**
 * Purge all LAP response audio for a company (voice change)
 */
lapResponseAudioSchema.statics.purgeByCompany = async function(companyId) {
  const result = await this.deleteMany({ companyId });
  return { removed: result.deletedCount || 0 };
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

lapResponseAudioSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('LAPResponseAudio', lapResponseAudioSchema);

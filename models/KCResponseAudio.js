/**
 * ============================================================================
 * KC RESPONSE AUDIO - Company-specific pre-recorded audio for KC sections
 * ============================================================================
 *
 * Each document stores a pre-recorded MP3 for a KC section's fixed response.
 * Audio is generated via ElevenLabs and cached both on disk (fast) and in
 * MongoDB (survives Render deploys).
 *
 * ISOLATION RULES:
 * - Audio is scoped by (companyId, fileHash) — unique per company + content
 * - fileHash = the 16-char hash from InstantAudioService filename
 * - Text hash tracks if source text changed (invalidates audio)
 * - Each company uses their own ElevenLabs voice configuration
 *
 * LIFECYCLE:
 * - Created when owner generates/previews fixed audio in services UI
 * - Also created by _preGenAudioFixed() on container save
 * - Purged when voice or variable values change
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const kcResponseAudioSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Company + Hash)
  // ─────────────────────────────────────────────────────────────────────────
  companyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  // The 16-char hex hash from the InstantAudioService filename
  // (last 16 chars of SHA256 of companyId + kind + text + voiceFingerprint)
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
  collection: 'kcResponseAudios'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

// Unique constraint: one audio per (company, fileHash)
kcResponseAudioSchema.index({ companyId: 1, fileHash: 1 }, { unique: true });

// Query by company + validity
kcResponseAudioSchema.index({ companyId: 1, isValid: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate hash from text for comparison
 */
kcResponseAudioSchema.statics.hashText = function(text) {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
};

/**
 * Save or update audio for a KC response.
 * Uses findOneAndUpdate with $set to bypass Mongoose Buffer handling issues
 * (same pattern as TriggerAudio.saveAudio).
 *
 * @param {string} companyId
 * @param {string} fileHash   — 16-char hex hash from InstantAudioService filename
 * @param {string} audioUrl   — e.g. '/audio-safe/instant-lines/fd_KC_RESPONSE_xxx_hash.mp3'
 * @param {string} sourceText — the resolved text that was synthesised
 * @param {string} voiceId    — ElevenLabs voice ID
 * @param {Buffer} audioBuffer — MP3 binary
 */
kcResponseAudioSchema.statics.saveAudio = async function(companyId, fileHash, audioUrl, sourceText, voiceId, audioBuffer) {
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

  logger.info('[KCResponseAudio.saveAudio] Saved', {
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
kcResponseAudioSchema.statics.findAudioDataByUrl = async function(audioUrl) {
  const doc = await this.findOne({ audioUrl, isValid: true }).select('audioData').lean();
  return doc?.audioData || null;
};

/**
 * Find audio binary by fileHash
 */
kcResponseAudioSchema.statics.findAudioDataByHash = async function(fileHash) {
  const doc = await this.findOne({ fileHash, isValid: true }).select('audioData').lean();
  return doc?.audioData || null;
};

/**
 * Purge all KC response audio for a company (voice or variable change)
 */
kcResponseAudioSchema.statics.purgeByCompany = async function(companyId) {
  const result = await this.deleteMany({ companyId });
  return { removed: result.deletedCount || 0 };
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

kcResponseAudioSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('KCResponseAudio', kcResponseAudioSchema);

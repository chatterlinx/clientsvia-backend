/**
 * ============================================================================
 * GREETING AUDIO - MongoDB-persisted audio for greetings
 * ============================================================================
 *
 * Stores MP3 binary data for call start greetings and greeting interceptor
 * rules. Audio survives server deploys since it lives in MongoDB, not the
 * filesystem (Render's ephemeral disk wipes files on every deploy).
 *
 * TYPES:
 * - CALL_START: The initial greeting when a call connects
 * - RULE: A greeting interceptor rule response
 *
 * ISOLATION:
 * - Scoped by (companyId, type, ruleId) — unique per company
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const greetingAudioSchema = new mongoose.Schema({
  companyId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  // CALL_START or RULE
  type: {
    type: String,
    required: true,
    enum: ['CALL_START', 'RULE']
  },

  // For RULE type, the ruleId; for CALL_START, always 'call-start'
  ruleId: {
    type: String,
    required: true,
    trim: true,
    default: 'call-start'
  },

  // Relative URL path (e.g. /audio/greetings/callstart_xxx.mp3)
  audioUrl: {
    type: String,
    required: true,
    maxlength: 500
  },

  // MP3 binary stored in MongoDB
  audioData: {
    type: Buffer,
    required: true
  },

  textHash: {
    type: String,
    required: true
  },

  sourceText: {
    type: String,
    maxlength: 2000
  },

  voiceId: {
    type: String,
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'greetingAudios'
});

// One audio record per (company, type, ruleId)
greetingAudioSchema.index({ companyId: 1, type: 1, ruleId: 1 }, { unique: true });

// Lookup by URL path for the fallback serving route
greetingAudioSchema.index({ audioUrl: 1 });

/**
 * Save or update greeting audio
 */
greetingAudioSchema.statics.saveAudio = async function(companyId, type, ruleId, audioUrl, audioBuffer, textHash, sourceText, voiceId) {
  const safeBuf = audioBuffer
    ? (Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer))
    : null;
  const query = { companyId, type, ruleId };
  return this.findOneAndUpdate(
    query,
    {
      $set: {
        audioUrl,
        audioData: safeBuf,
        textHash,
        sourceText,
        voiceId,
        updatedAt: new Date()
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

/**
 * Find audio binary by URL path (used by the MongoDB fallback serving route)
 */
greetingAudioSchema.statics.findAudioDataByUrl = async function(audioUrl) {
  const doc = await this.findOne({ audioUrl }).select('audioData').lean();
  return doc?.audioData || null;
};

/**
 * Delete audio for a greeting rule
 */
greetingAudioSchema.statics.deleteAudio = function(companyId, type, ruleId) {
  return this.deleteOne({ companyId, type, ruleId });
};

module.exports = mongoose.model('GreetingAudio', greetingAudioSchema);

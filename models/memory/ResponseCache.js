// models/memory/ResponseCache.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const ResponseCacheSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    // Normalized + hashed version of the user utterance
    normalizedHash: {
      type: String,
      required: true,
      index: true
    },

    // Original text (optional, for debugging / UI)
    userText: {
      type: String,
      default: null
    },

    // Final response text we served for this utterance
    responseText: {
      type: String,
      required: true
    },

    // Optional tagging for analytics / future use
    intent: {
      type: String,
      default: null
    },

    triageCategory: {
      type: String,
      default: null
    },

    hitCount: {
      type: Number,
      default: 0
    },

    lastUsedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// One cache entry per (company, normalizedHash)
ResponseCacheSchema.index(
  { companyId: 1, normalizedHash: 1 },
  { unique: true }
);

// Simple "similar" lookup – exact hash for now.
// You can upgrade later to vector similarity if you want.
ResponseCacheSchema.statics.findSimilar = async function (
  companyId,
  normalizedHash
) {
  if (!companyId || !normalizedHash) return null;

  return this.findOne({ companyId, normalizedHash }).lean();
};

module.exports = mongoose.model("ResponseCache", ResponseCacheSchema);


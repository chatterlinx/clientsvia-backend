// models/memory/IntentResolutionPath.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const IntentResolutionPathSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    // Same intent names used in CallerIntentHistory / triage
    intent: {
      type: String,
      required: true,
      index: true
    },

    triageCategory: {
      type: String,
      default: null,
      index: true
    },

    // The scenario that historically resolved this intent
    scenarioId: {
      type: String,
      required: true,
      index: true
    },

    // Counts for how many times this path was used
    sampleSize: {
      type: Number,
      default: 0
    },

    successCount: {
      type: Number,
      default: 0
    },

    // successRate = successCount / sampleSize (kept denormalized for fast reads)
    successRate: {
      type: Number,
      default: 0.0
    }
  },
  {
    timestamps: true
  }
);

// Each company can have multiple resolution paths per intent/category/scenario
IntentResolutionPathSchema.index(
  { companyId: 1, intent: 1, triageCategory: 1, scenarioId: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "IntentResolutionPath",
  IntentResolutionPathSchema
);


// models/memory/CallerIntentHistory.js

const mongoose = require("mongoose");
const { Schema } = mongoose;

const CallerIntentHistorySchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true
    },

    phoneNumber: {
      type: String,
      required: true,
      index: true
    },

    // High-level, company-defined intent name, e.g. "AC_REPAIR", "MAINTENANCE"
    intent: {
      type: String,
      required: true,
      index: true
    },

    // Optional: triage category, e.g. "HVAC_SERVICE", "BILLING", etc.
    triageCategory: {
      type: String,
      default: null
    },

    totalCount: {
      type: Number,
      default: 0
    },

    successCount: {
      type: Number,
      default: 0
    },

    lastOutcome: {
      type: String,
      default: null // e.g. "BOOKED", "TRANSFER_SUCCESS", "NORMAL_END", "HANGUP"
    },

    lastCallAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Compound index for fast lookups
CallerIntentHistorySchema.index(
  { companyId: 1, phoneNumber: 1, intent: 1 },
  { unique: false }
);

module.exports = mongoose.model(
  "CallerIntentHistory",
  CallerIntentHistorySchema
);


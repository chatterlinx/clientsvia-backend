// models/LLMSettings.js
const mongoose = require('mongoose');

const LLMSettingsSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      default: 'global',
      unique: true
      // later you can have 'template:<id>' or 'company:<id>'
    },
    settings: {
      type: Object,
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('LLMSettings', LLMSettingsSchema);


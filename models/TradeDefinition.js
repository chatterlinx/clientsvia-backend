// models/TradeDefinition.js
// V23 Global Trade Registry - Defines available trades and their defaults
// Used by AI Triage Builder to populate dropdowns and preset options
// NOT used at runtime - only in admin factory

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TradeDefinitionSchema = new Schema(
  {
    // Unique key for this trade (e.g., "HVAC", "PLUMBING", "DENTAL")
    tradeKey: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },

    // Human-readable label
    label: {
      type: String,
      required: true,
      trim: true
      // e.g., "HVAC (Heating & Cooling)", "Plumbing (Residential)"
    },

    // Short description
    description: {
      type: String,
      trim: true,
      default: ''
    },

    // Default service types for this trade
    defaultServiceTypes: {
      type: [String],
      default: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'],
      enum: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER', 'CONSULTATION', 'INSTALLATION']
    },

    // Default triage categories for this trade
    defaultCategories: {
      type: [String],
      default: []
      // e.g., for HVAC: ["Cooling / No Cool", "Heating", "Thermostat", "Maintenance", "Emergency"]
      // e.g., for Plumbing: ["Leaks", "Clogs", "Water Heater", "Gas Lines", "Emergency"]
    },

    // Default intents for this trade (optional)
    defaultIntents: {
      type: [String],
      default: []
      // e.g., ["REPAIR", "MAINTENANCE", "EMERGENCY", "BILLING", "SCHEDULING"]
    },

    // Icon for UI display
    icon: {
      type: String,
      default: '🏢'
      // e.g., "❄️" for HVAC, "🔧" for Plumbing, "🦷" for Dental
    },

    // Color theme for UI
    colorTheme: {
      type: String,
      default: 'blue'
      // e.g., "blue", "green", "purple"
    },

    // Is this trade active/available?
    isActive: {
      type: Boolean,
      default: true
    },

    // Sort order for dropdown display
    sortOrder: {
      type: Number,
      default: 100
    },

    // Metadata
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true
  }
);

// Static: Get all active trades sorted by sortOrder
TradeDefinitionSchema.statics.getActiveTrades = async function () {
  return this.find({ isActive: true }).sort({ sortOrder: 1, label: 1 }).lean();
};

// Static: Get trade by key
TradeDefinitionSchema.statics.getByKey = async function (tradeKey) {
  return this.findOne({ tradeKey: tradeKey.toUpperCase() }).lean();
};

module.exports = mongoose.model('TradeDefinition', TradeDefinitionSchema);


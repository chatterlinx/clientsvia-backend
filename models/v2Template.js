const mongoose = require('mongoose');

const TemplateSchema = new mongoose.Schema({
  companyID: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company',
    required: true,
    index: true 
  },
  category: {
    type: String,
    required: true,
    enum: ["greeting", "hold", "hours", "callback", "escalation", "emotional", "transfer", "emergency", "booking", "farewell"]
  },
  subcategory: {
    type: String,
    enum: ["frustrated", "appreciative", "urgent", "general", "after-hours", "busy", "confirmation"]
  },
  text: { 
    type: String, 
    required: true,
    maxlength: 1000
  },
  variables: { 
    type: [String], 
    default: [],
    validate: {
      validator(arr) {
        return arr.every(v => v.startsWith('{{') && v.endsWith('}}'));
      },
      message: 'Variables must be in {{variableName}} format'
    }
  },
  priority: { type: Number, default: 1, min: 1, max: 10 },
  isActive: { type: Boolean, default: true },
  usageCount: { type: Number, default: 0 },
  lastUsed: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'templates'
});

// Compound indexes for performance
TemplateSchema.index({ companyID: 1, category: 1, isActive: 1 });
TemplateSchema.index({ companyID: 1, subcategory: 1 });
TemplateSchema.index({ companyID: 1, priority: -1 });

// Text search index
TemplateSchema.index({ text: 'text', category: 1 });

module.exports = mongoose.model('Template', TemplateSchema);

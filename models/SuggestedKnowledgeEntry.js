const mongoose = require('mongoose');

const suggestedKnowledgeEntrySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true }, // Changed from suggestedAnswer to answer
  category: { type: String, trim: true, default: 'general' },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['pending', 'reviewed', 'approved', 'rejected'], default: 'pending' },
  confidence: { type: Number, min: 0, max: 1 }, // AI's confidence in its own answer
  source: { type: String, default: 'ai_learning' }, // Source of the suggestion
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  originalCallSid: { type: String }, // Reference to the call that triggered the suggestion
  reviewedAt: { type: Date },
  reviewNotes: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

suggestedKnowledgeEntrySchema.index({ companyId: 1, status: 1 });
suggestedKnowledgeEntrySchema.index({ question: 1, status: 1 });
suggestedKnowledgeEntrySchema.index({ createdAt: -1 });

suggestedKnowledgeEntrySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const SuggestedKnowledgeEntry = mongoose.model('SuggestedKnowledgeEntry', suggestedKnowledgeEntrySchema);
module.exports = SuggestedKnowledgeEntry;

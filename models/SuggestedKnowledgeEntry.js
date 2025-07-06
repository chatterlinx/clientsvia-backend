const mongoose = require('mongoose');

const suggestedKnowledgeEntrySchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  suggestedAnswer: { type: String, required: true, trim: true },
  category: { type: String, trim: true }, // Optional, can be inferred or added later
  status: { type: String, enum: ['pending', 'reviewed', 'approved', 'rejected'], default: 'pending' },
  confidence: { type: Number }, // AI's confidence in its own answer, if available
  originalCallSid: { type: String }, // Reference to the call that triggered the suggestion
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

suggestedKnowledgeEntrySchema.index({ question: 1, status: 1 });

suggestedKnowledgeEntrySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const SuggestedKnowledgeEntry = mongoose.model('SuggestedKnowledgeEntry', suggestedKnowledgeEntrySchema);
module.exports = SuggestedKnowledgeEntry;

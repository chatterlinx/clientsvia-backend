const mongoose = require('mongoose');

const knowledgeEntrySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  category: { type: String, required: true, trim: true },
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  keywords: { type: [String], default: [] },
  approved: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
knowledgeEntrySchema.index({ companyId: 1, question: 1 });
knowledgeEntrySchema.index({ companyId: 1, keywords: 1 });

// Update the updatedAt field before saving
knowledgeEntrySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const KnowledgeEntry = mongoose.model('KnowledgeEntry', knowledgeEntrySchema);

module.exports = KnowledgeEntry;

const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema({
  line: { type: String, required: true },
  evidence: { type: String },
  tag: { type: String, enum: ['best-practice', 'anti-pattern'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Suggestion = mongoose.model('Suggestion', suggestionSchema);
module.exports = Suggestion;

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true },
  avatar: { type: String },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  role: { type: String, enum: ['admin', 'manager', 'staff'], default: 'admin' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  allowedDomains: { type: [String], default: [] }, // For multi-tenant support
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Index for efficient lookups
userSchema.index({ email: 1 });
userSchema.index({ googleId: 1 });

module.exports = mongoose.model('User', userSchema);

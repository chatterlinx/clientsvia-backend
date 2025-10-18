const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: { type: String, unique: true, sparse: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true },
  password: { type: String }, // For JWT authentication (optional, used when googleId is not present)
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

// Note: email and googleId indexes are already created by unique: true in schema definition
// No need for duplicate index definitions

module.exports = mongoose.model('User', userSchema);

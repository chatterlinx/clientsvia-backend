const mongoose = require('mongoose');

const scheduleItemSchema = new mongoose.Schema({
  day: { type: String },
  start: { type: String },
  end: { type: String }
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true, default: null },
  role: { type: String, enum: ['admin', 'manager', 'staff'], default: 'staff' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  schedule: { type: [scheduleItemSchema], default: [] },
  transferEligible: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

employeeSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Employee', employeeSchema);

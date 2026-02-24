/**
 * ============================================================================
 * GLOBAL CATEGORY MODEL
 * ============================================================================
 * 
 * ☢️ NUKED Feb 2026: CheatSheet references removed
 * Represents categories for organizing global shared configurations.
 * Examples: HVAC, Plumbing, Dental, Legal, etc.
 * 
 * KEY DESIGN:
 * - Admin-managed only (no companyId)
 * - Unique category names
 * - Used to filter/organize global shared configs
 * 
 * SCOPE:
 * - Version History → Global Configurations feature only
 * - Does NOT affect agent runtime
 * ============================================================================
 */

const mongoose = require('mongoose');

const GlobalCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 100
    }
  },
  {
    timestamps: true // createdAt, updatedAt
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Get sanitized summary for API responses
 */
GlobalCategorySchema.methods.getSummary = function() {
  return {
    _id: this._id,
    name: this.name,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('GlobalCategory', GlobalCategorySchema);


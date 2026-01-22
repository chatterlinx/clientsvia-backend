/**
 * ============================================================================
 * GLOBAL CONFIG REFERENCE MODEL
 * ============================================================================
 * 
 * Tracks which companies have shared their CheatSheet configs to the global library.
 * Always points to a company's CURRENT LIVE version.
 * 
 * KEY DESIGN:
 * - One reference per company (enforced by unique index)
 * - Auto-updates when company pushes new live version
 * - No historical tracking (just current live pointer)
 * 
 * LIFECYCLE:
 * 1. Company selects category for their CheatSheet
 * 2. Company clicks "Share to Global"
 * 3. GlobalConfigReference created/updated
 * 4. Every time company pushes new live → cheatSheetVersionId auto-updates
 * 5. Other companies can browse by category and import as draft
 * 
 * SCOPE:
 * - Version History → Global Configurations feature only
 * - Does NOT affect agent runtime
 * ============================================================================
 */

const mongoose = require('mongoose');

const GlobalConfigReferenceSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company', // Must match the model name in v2Company.js: mongoose.model('Company', ...)
      required: true
    },
    
    cheatSheetVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheatSheetVersion',
      required: true
    },
    
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GlobalCategory',
      required: true
    }
  },
  {
    timestamps: true // createdAt, updatedAt
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// One reference per company (prevent duplicates)
GlobalConfigReferenceSchema.index({ companyId: 1 }, { unique: true });

// Query by category (for browsing global configs)
GlobalConfigReferenceSchema.index({ categoryId: 1 });

// Compound index for category + company lookups
GlobalConfigReferenceSchema.index({ categoryId: 1, companyId: 1 });

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Get populated reference with company and version details
 */
GlobalConfigReferenceSchema.methods.getPopulatedSummary = async function() {
  await this.populate([
    { path: 'companyId', select: 'name' },
    { path: 'cheatSheetVersionId', select: 'name versionId updatedAt' },
    { path: 'categoryId', select: 'name' }
  ]);
  
  return {
    globalConfigId: this._id,
    companyId: this.companyId._id,
    companyName: this.companyId.name,
    cheatSheetVersionId: this.cheatSheetVersionId._id,
    configName: this.cheatSheetVersionId.name || 'Unnamed Configuration',
    categoryId: this.categoryId._id,
    categoryName: this.categoryId.name,
    updatedAt: this.updatedAt
  };
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('GlobalConfigReference', GlobalConfigReferenceSchema);


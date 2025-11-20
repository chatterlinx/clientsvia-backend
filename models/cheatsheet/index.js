/**
 * ============================================================================
 * CHEATSHEET MODELS - CENTRALIZED EXPORTS
 * ============================================================================
 * 
 * Single import point for all CheatSheet-related models and schemas.
 * 
 * Usage:
 *   const { CheatSheetVersion, CheatSheetAuditLog } = require('../models/cheatsheet');
 * ============================================================================
 */

const CheatSheetVersion = require('./CheatSheetVersion');
const CheatSheetAuditLog = require('./CheatSheetAuditLog');
const {
  CheatSheetConfigSchema,
  BookingRuleSchema,
  CompanyContactSchema,
  LinkSchema,
  CalculatorSchema
} = require('./CheatSheetConfigSchema');

module.exports = {
  // Models
  CheatSheetVersion,
  CheatSheetAuditLog,
  
  // Schemas (for reuse elsewhere if needed)
  CheatSheetConfigSchema,
  BookingRuleSchema,
  CompanyContactSchema,
  LinkSchema,
  CalculatorSchema
};


/**
 * ============================================================================
 * CHEATSHEET CONFIG SCHEMA - SINGLE SOURCE OF TRUTH
 * ============================================================================
 * 
 * This schema defines the structure of AI agent configuration.
 * It is imported by CheatSheetVersion model and NEVER duplicated elsewhere.
 * 
 * Schema Version: 1
 * Created: 2024-11-20
 * 
 * CRITICAL RULE: All config structure changes MUST happen here and increment
 * schemaVersion. This prevents the "duplicate schema" bug that cost 7 hours.
 * ============================================================================
 */

const mongoose = require('mongoose');

// ============================================================================
// SUB-SCHEMAS (Reusable Building Blocks)
// ============================================================================

/**
 * Booking Rule Schema
 * Defines when/how appointments can be booked per trade/service type
 */
const BookingRuleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  trade: { type: String, default: '' },
  serviceType: { type: String, default: '' },
  priority: { 
    type: String, 
    enum: ['normal', 'high', 'emergency'], 
    default: 'normal' 
  },
  daysOfWeek: [{ type: String }],
  timeWindow: {
    start: { type: String, default: '08:00' },
    end: { type: String, default: '17:00' }
  },
  sameDayAllowed: { type: Boolean, default: true },
  weekendAllowed: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, default: 'System' }
}, { _id: false });

/**
 * Company Contact Schema
 * Transfer targets, notification contacts, escalation chains
 */
const CompanyContactSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, default: 'General Contact' },
  phone: { type: String, default: null },
  email: { type: String, default: null },
  isPrimary: { type: Boolean, default: false },
  availableHours: { type: String, default: '24/7' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, default: 'System' }
}, { _id: false });

/**
 * Link Schema
 * URLs for financing, portals, policies, catalogs
 */
const LinkSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  category: { 
    type: String, 
    enum: [
      'payment',
      'scheduling',
      'service-area',
      'faq',
      'portal',
      'financing',
      'catalog',
      'policy',
      'other'
    ], 
    default: 'other' 
  },
  url: { type: String, default: '' }, // Changed: Not required, defaults to empty string
  shortDescription: { type: String, default: '' },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, default: 'System' }
}, { _id: false });

/**
 * Calculator Schema
 * Quick calculators for fees, discounts, pricing
 */
const CalculatorSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, default: 'flat-fee' },
  baseAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, default: 'System' }
}, { _id: false });

/**
 * Edge Case Schema - Enterprise Tier-1 Override System
 * Highest precedence rules that short-circuit all other AI logic
 * 
 * BACKWARD COMPATIBLE: Supports both legacy (triggerPatterns + responseText) 
 * and enterprise (match + action + sideEffects) modes
 */
const EdgeCaseSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════
  id: { type: String, required: false },  // Optional for backward compat, auto-generated if missing
  name: { type: String, required: true },
  description: { type: String, default: '' },
  
  // ═══════════════════════════════════════════════════════════════
  // CONTROL FLAGS
  // ═══════════════════════════════════════════════════════════════
  enabled: { type: Boolean, default: true },
  priority: { type: Number, default: 10, min: 1, max: 100 },
  
  // ═══════════════════════════════════════════════════════════════
  // LEGACY FIELDS (Backward Compatibility)
  // ═══════════════════════════════════════════════════════════════
  triggerPatterns: [String],  // Optional - allows detection of legacy vs enterprise mode
  responseText: String,        // Optional - allows detection of legacy vs enterprise mode
  
  // ═══════════════════════════════════════════════════════════════
  // ENTERPRISE MATCHING (Multi-dimensional conditions)
  // ═══════════════════════════════════════════════════════════════
  match: {
    keywordsAny: { type: [String], default: [] },      // ANY keyword triggers
    keywordsAll: { type: [String], default: [] },      // ALL required
    regexPatterns: { type: [String], default: [] },    // Advanced patterns
    callerType: { 
      type: [String], 
      enum: ['new', 'existing', 'vendor', 'unknown', ''],
      default: [] 
    },
    timeWindows: [{
      daysOfWeek: { type: [Number], default: [] },    // 0-6 (Sunday-Saturday)
      start: { type: String, default: '00:00' },      // HH:mm
      end: { type: String, default: '23:59' }         // HH:mm
    }],
    spamFlagsRequired: { type: [String], default: [] },
    tradeRequired: { type: [String], default: [] }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // ENTERPRISE ACTION (What to do when matched)
  // ═══════════════════════════════════════════════════════════════
  action: {
    type: { 
      type: String, 
      enum: ['override_response', 'force_transfer', 'polite_hangup', 'flag_only'],
      default: 'override_response'
    },
    
    // For override_response
    responseTemplateId: { type: String, default: '' },
    inlineResponse: { type: String, default: '' },
    
    // For force_transfer
    transferTarget: { type: String, default: '' },      // contactId, role, or phone
    transferMessage: { type: String, default: '' },
    
    // For polite_hangup
    hangupMessage: { type: String, default: '' }
  },
  
  // ═══════════════════════════════════════════════════════════════
  // SIDE EFFECTS (Auto-actions when triggered)
  // ═══════════════════════════════════════════════════════════════
  sideEffects: {
    type: {
      autoBlacklist: { type: Boolean, default: false },
      autoTag: { type: [String], default: [] },
      notifyContacts: { type: [String], default: [] },   // contactIds
      logSeverity: { 
        type: String, 
        enum: ['info', 'warning', 'critical'],
        default: 'info'
      }
    },
    default: () => ({
      autoBlacklist: false,
      autoTag: [],
      notifyContacts: [],
      logSeverity: 'info'
    })
  },
  
  // ═══════════════════════════════════════════════════════════════
  // AUDIT TRAIL
  // ═══════════════════════════════════════════════════════════════
  auditMeta: {
    type: {
      createdBy: { type: String, default: 'System' },
      createdAt: { type: Date, default: Date.now },
      updatedBy: { type: String, default: 'System' },
      updatedAt: { type: Date, default: Date.now }
    },
    default: () => ({
      createdBy: 'System',
      createdAt: new Date(),
      updatedBy: 'System',
      updatedAt: new Date()
    })
  }
}, { _id: false });

// ============================================================================
// MAIN CONFIG SCHEMA - THE SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * CheatSheetConfigSchema
 * Complete AI agent configuration structure
 * 
 * NEVER DUPLICATE THIS SCHEMA ELSEWHERE IN THE CODEBASE
 */
const CheatSheetConfigSchema = new mongoose.Schema({
  // Schema version for future migrations
  schemaVersion: { type: Number, default: 1, required: true },
  
  // ============================================================================
  // V1 LEGACY SECTIONS (Keep as Object for backward compatibility)
  // ============================================================================
  triage: { type: Object, default: {} },
  frontlineIntel: { type: Object, default: {} },
  transferRules: { type: Object, default: {} },
  behavior: { type: Object, default: {} },
  guardrails: { type: Object, default: {} },
  
  // ============================================================================
  // EDGE CASES (Upgraded from Object to Structured Array - Nov 2025)
  // ============================================================================
  // NOTE: This field was upgraded from { type: Object } to [EdgeCaseSchema]
  // to support enterprise features while maintaining backward compatibility.
  // Legacy edge cases stored as Object will be migrated to array format.
  edgeCases: { 
    type: [EdgeCaseSchema], 
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 50; // Reasonable limit
      },
      message: 'Cannot have more than 50 edge cases'
    }
  },
  
  // ============================================================================
  // V2 STRUCTURED SECTIONS (Type-safe, validated)
  // ============================================================================
  bookingRules: { 
    type: [BookingRuleSchema], 
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 100; // Prevent abuse
      },
      message: 'Cannot have more than 100 booking rules'
    }
  },
  
  companyContacts: { 
    type: [CompanyContactSchema], 
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 50; // Reasonable limit
      },
      message: 'Cannot have more than 50 company contacts'
    }
  },
  
  links: { 
    type: [LinkSchema], 
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 100;
      },
      message: 'Cannot have more than 100 links'
    }
  },
  
  calculators: { 
    type: [CalculatorSchema], 
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= 50;
      },
      message: 'Cannot have more than 50 calculators'
    }
  }
  
}, { _id: false });

// ============================================================================
// SIZE VALIDATION (Prevent 16MB+ documents)
// ============================================================================
CheatSheetConfigSchema.pre('validate', function(next) {
  const size = JSON.stringify(this.toObject()).length;
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB limit
  
  if (size > MAX_SIZE) {
    return next(new Error(`Config too large: ${(size / 1024 / 1024).toFixed(2)}MB (max 5MB)`));
  }
  
  next();
});

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  CheatSheetConfigSchema,
  BookingRuleSchema,
  CompanyContactSchema,
  LinkSchema,
  CalculatorSchema,
  EdgeCaseSchema
};


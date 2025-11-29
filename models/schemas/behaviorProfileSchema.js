/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BEHAVIOR PROFILE SCHEMA - V23 Mongoose Schema Definition
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Lock the structure of company.aiAgentSettings.behaviorProfile
 * INTEGRATION: Embedded in v2Company.aiAgentSettings
 * 
 * This schema ensures:
 * - Consistent structure across all companies
 * - Validation of numeric ranges (0-1 for levels)
 * - Proper defaults for optional fields
 * - Type safety for trade overrides
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════════════
// TRADE OVERRIDE SUB-SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const TradeOverrideSchema = new mongoose.Schema({
  emergencyKeywords: {
    type: [String],
    default: []
  },
  billingConflictKeywords: {
    type: [String],
    default: []
  },
  jokePatterns: {
    type: [String],
    default: []
  }
}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN BEHAVIOR PROFILE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const BehaviorProfileSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // MODE: Master switch for behavior engine
  // ─────────────────────────────────────────────────────────────────────────
  mode: {
    type: String,
    enum: ['OFF', 'HYBRID'],
    default: 'OFF',
    description: 'OFF = no behavior styling, HYBRID = adaptive tone based on signals'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LEVEL CONTROLS (0-1 range)
  // ─────────────────────────────────────────────────────────────────────────
  humorLevel: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.5,
    description: '0 = no humor allowed, 1 = maximum humor when safe'
  },
  
  empathyLevel: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.8,
    description: '0 = robotic, 1 = extremely warm and understanding'
  },
  
  directnessLevel: {
    type: Number,
    min: 0,
    max: 1,
    default: 0.7,
    description: '0 = verbose/elaborate, 1 = concise/to-the-point'
  },
  
  safetyStrictness: {
    type: Number,
    min: 0,
    max: 1,
    default: 1.0,
    description: '1.0 = never relax safety messaging (ALWAYS keep at 1.0)'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BEHAVIORAL LIMITS
  // ─────────────────────────────────────────────────────────────────────────
  maxHumorPerReply: {
    type: Number,
    min: 0,
    max: 3,
    default: 1,
    description: 'Maximum playful/humorous lines per reply'
  },
  
  allowSmallTalkSeconds: {
    type: Number,
    min: 0,
    max: 60,
    default: 15,
    description: 'How many seconds of small talk before redirecting to business'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL KEYWORD ARRAYS
  // These are checked for ALL calls, regardless of trade
  // ─────────────────────────────────────────────────────────────────────────
  globalEmergencyKeywords: {
    type: [String],
    default: [
      'burning smell',
      'smoke',
      'sparks',
      'fire',
      'gas smell',
      'leaking into ceiling',
      'water pouring',
      'flooding',
      'unconscious',
      'chest pain',
      'bleeding a lot'
    ],
    description: 'Keywords that trigger EMERGENCY_SERIOUS tone immediately'
  },
  
  globalBillingConflictKeywords: {
    type: [String],
    default: [
      'you charged',
      'my bill',
      'refund',
      'dispute',
      'overcharged',
      'chargeback',
      'billing error',
      'invoice is wrong'
    ],
    description: 'Keywords that trigger CONFLICT_SERIOUS tone immediately'
  },
  
  globalJokePatterns: {
    type: [String],
    default: [
      'lol',
      'lmao',
      'haha',
      'this thing is dead',
      "i'm dying here",
      'this is killing me'
    ],
    description: 'Patterns that indicate caller is joking/relaxed'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TRADE-SPECIFIC OVERRIDES
  // Merged with global keywords based on company.trade
  // ─────────────────────────────────────────────────────────────────────────
  tradeOverrides: {
    type: Map,
    of: TradeOverrideSchema,
    default: new Map(),
    description: 'Trade-specific keyword overrides keyed by trade (HVAC, PLUMBING, etc.)'
  }

}, { _id: false });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a complete behavior profile with all defaults filled in
 */
BehaviorProfileSchema.statics.getDefaultProfile = function() {
  return {
    mode: 'OFF',
    humorLevel: 0.5,
    empathyLevel: 0.8,
    directnessLevel: 0.7,
    safetyStrictness: 1.0,
    maxHumorPerReply: 1,
    allowSmallTalkSeconds: 15,
    globalEmergencyKeywords: [
      'burning smell', 'smoke', 'sparks', 'fire', 'gas smell',
      'leaking into ceiling', 'water pouring', 'flooding',
      'unconscious', 'chest pain', 'bleeding a lot'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute',
      'overcharged', 'chargeback', 'billing error', 'invoice is wrong'
    ],
    globalJokePatterns: [
      'lol', 'lmao', 'haha', 'this thing is dead',
      "i'm dying here", 'this is killing me'
    ],
    tradeOverrides: {}
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

module.exports = BehaviorProfileSchema;


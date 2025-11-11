/**
 * ============================================================================
 * LLM LEARNING TASK MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Lightweight queue for capturing Tier-3 LLM usage events.
 * When a call needs Tier-3 (because T1/T2 failed), a task is created.
 * Background worker processes tasks → calls OpenAI → creates AIGatewaySuggestion docs.
 * 
 * FLOW:
 * 1. IntelligentRouter: Tier-3 used → create LLMLearningTask (PENDING)
 * 2. LLMLearningWorker (every 30s): Find PENDING tasks → process → DONE/FAILED
 * 3. Each task generates 0+ AIGatewaySuggestion docs for admin console v2
 * 
 * DESIGN:
 * - Minimal fields: just enough context for worker to generate good suggestions
 * - Non-blocking: if creation fails, call continues normally
 * - Backwards compatible: new optional fields don't break existing code
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const llmLearningTaskSchema = new Schema(
  {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔄 TASK STATUS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'],
      default: 'PENDING',
      index: true,
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔑 IDENTIFIERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'GlobalInstantResponseTemplate',
      required: true,
      index: true,
    },

    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'v2Company',
      default: null,
      index: true,
    },

    callId: {
      type: String,
      required: true,
      index: true,
    },

    callSource: {
      type: String,
      enum: ['voice', 'sms', 'chat'],
      default: 'voice',
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📊 ROUTING CONTEXT (Why Tier-3 was needed)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    tierPath: {
      type: String,
      example: 'T1 (0.25) -> T2 (0.30) -> T3',
    },

    tier1Score: { type: Number, default: null },
    tier1Threshold: { type: Number, default: null },

    tier2Score: { type: Number, default: null },
    tier2Threshold: { type: Number, default: null },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🤖 TIER-3 LLM DATA (from Tier3LLMFallback result)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    tier3Confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    tier3Rationale: {
      type: String,
      default: null,
    },

    tier3LatencyMs: {
      type: Number,
      default: null,
    },

    tier3Tokens: {
      type: Number,
      default: null,
    },

    tier3Cost: {
      type: Number,
      default: null,
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📞 CALL CONTEXT (What the caller asked)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    primaryUtterance: {
      type: String,
      default: '',
    },

    chosenScenarioId: {
      type: Schema.Types.ObjectId,
      ref: 'GlobalInstantResponseScenario',
      default: null,
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ✅ WORKER OUTPUT (After processing)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    suggestionsCreatedCount: {
      type: Number,
      default: 0,
    },

    suggestionsCreatedIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'AIGatewaySuggestion',
      },
    ],

    workerError: {
      type: String,
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔍 INDEXES FOR WORKER QUERIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

llmLearningTaskSchema.index({ status: 1, createdAt: -1 });
llmLearningTaskSchema.index({ templateId: 1, status: 1 });
llmLearningTaskSchema.index({ companyId: 1, status: 1 });

module.exports =
  mongoose.models.LLMLearningTask ||
  mongoose.model('LLMLearningTask', llmLearningTaskSchema);


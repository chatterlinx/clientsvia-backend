'use strict';

/**
 * ============================================================================
 * KCIntelligenceReport — Knowledge Base Health & Gap Intelligence
 * ============================================================================
 *
 * One document per company. Upserted on every scan run.
 *
 * Scan sources:
 *   1. Customer.callHistory — real transferred/lost calls → gap signals
 *   2. KC keyword conflicts — KCKeywordHealthService.analyzeConflicts()
 *   3. Per-KC content scoring — deterministic (word count, keywords, age)
 *
 * Todo lifecycle:
 *   open      → auto-resolves if condition no longer detected on next scan
 *   dismissed → admin dismissed; stays dismissed across scans (permanent)
 *   resolved  → condition fixed; auto-set by next scan
 *
 * stableId: deterministic key for cross-scan matching so we never duplicate
 *   MISSING_KC:{topicSlug}
 *   FAILING_KC:{kcId}
 *   KEYWORD_CONFLICT:{kcAId}_{kcBId}  (kcIds sorted)
 *   THIN_CONTENT:{kcId}
 *   FEW_KEYWORDS:{kcId}
 *   STALE_CONTENT:{kcId}
 * ============================================================================
 */

const mongoose      = require('mongoose');
const { Schema }    = mongoose;

// ── Todo item ─────────────────────────────────────────────────────────────────
const todoSchema = new Schema({
  stableId:     { type: String, required: true },   // deterministic cross-scan key
  type:         { type: String, enum: ['MISSING_KC','FAILING_KC','KEYWORD_CONFLICT','THIN_CONTENT','FEW_KEYWORDS','STALE_CONTENT'], required: true },
  priority:     { type: String, enum: ['P1','P2','P3'], required: true },
  title:        { type: String, required: true },
  description:  { type: String },
  kcIds:        [{ type: String }],   // affected KC _id strings
  callerCount:  { type: Number, default: 0 },
  impactNote:   { type: String },
  samplePhrases:[{ type: String }],   // real caller phrases from callHistory
  status:       { type: String, enum: ['open','dismissed','resolved'], default: 'open' },
  createdAt:    { type: Date,   default: Date.now },
  resolvedAt:   { type: Date,   default: null },
  dismissedAt:  { type: Date,   default: null },
}, { _id: false });

// ── Per-KC health entry ────────────────────────────────────────────────────────
const kcHealthEntrySchema = new Schema({
  kcId:             { type: String },
  kcTitle:          { type: String },
  score:            { type: Number },
  grade:            { type: String },   // A/B/C/D/F
  wordCount:        { type: Number },
  keywordCount:     { type: Number },
  daysSinceUpdated: { type: Number },
  issues: [{
    type:    { type: String },
    message: { type: String },
  }],
}, { _id: false });

// ── Gap cluster (missing or failing) ──────────────────────────────────────────
const gapClusterSchema = new Schema({
  topic:        { type: String },
  callerCount:  { type: Number, default: 0 },
  samplePhrases:[{ type: String }],
  // For failing clusters only:
  kcId:         { type: String, default: null },
  kcTitle:      { type: String, default: null },
}, { _id: false });

// ── Conflict pair ─────────────────────────────────────────────────────────────
const conflictPairSchema = new Schema({
  kcAId:          { type: String },
  kcATitle:       { type: String },
  kcBId:          { type: String },
  kcBTitle:       { type: String },
  conflictType:   { type: String },
  sharedKeywords: [{ type: String }],
  severity:       { type: String },   // high | medium | low
}, { _id: false });

// ── Main report document ───────────────────────────────────────────────────────
const kcIntelligenceReportSchema = new Schema({
  companyId:      { type: Schema.Types.ObjectId, ref: 'v2Company', required: true, index: true },
  scannedAt:      { type: Date, default: Date.now },
  callDaysBack:   { type: Number, default: 30 },
  callsAnalyzed:  { type: Number, default: 0 },   // gap signal calls examined
  totalKCs:       { type: Number, default: 0 },

  healthScore: {
    overall:        { type: Number, default: 0 },
    coverage:       { type: Number, default: 0 },
    keywordHealth:  { type: Number, default: 0 },
    contentQuality: { type: Number, default: 0 },
  },

  todos:         [todoSchema],

  gapReport: {
    missing: [gapClusterSchema],   // topics with no KC at all
    failing: [gapClusterSchema],   // topics with KC that still transferred/lost
  },

  conflictPairs:  [conflictPairSchema],
  kcHealth:       [kcHealthEntrySchema],
}, {
  timestamps: true,
  collection: 'kcintelligencereports',
});

kcIntelligenceReportSchema.index({ companyId: 1 }, { unique: true });

module.exports = mongoose.model('KCIntelligenceReport', kcIntelligenceReportSchema);

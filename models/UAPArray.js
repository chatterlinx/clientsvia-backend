'use strict';

/**
 * UAPArray — Utterance Act Parser vocabulary per company.
 *
 * Each UAPArray represents a daType (e.g. PRICING_QUERY, AVAILABILITY_QUERY).
 * daSubTypes[] are the sub-topics within that intent, each with trigger phrases
 * used by the zero-latency rule-based classifier (Layer 1).
 *
 * Standard arrays are seeded via the UAP.html UI → /arrays/seed endpoint.
 * Runtime reads ONLY from this collection — no values are hardcoded in code.
 * Owner can add/edit/remove trigger phrases at any time via the UI.
 */

const mongoose = require('mongoose');

const DaSubTypeSchema = new mongoose.Schema({
  key: {
    type:     String,
    required: true
    // e.g. 'FINANCING', 'WARRANTY', 'SEASONAL'
  },
  label: {
    type:     String,
    required: true
    // e.g. 'Financing & Payment Plans'
  },
  triggerPhrases: {
    type:    [String],
    default: []
    // Low-level keyword/phrase list for Layer 1 rule-based matching.
    // Auto-generated at sub-topic save; owner can edit freely via UI.
  },
  attachedTo: {
    type:    [String],
    default: []
    // KC container IDs that have been mapped to this sub-type.
    // Populated by semantic auto-map (build step 4).
  },
  classificationStatus: {
    type:    String,
    enum:    ['AUTO_CONFIRMED', 'MANUAL', 'PENDING'],
    default: 'AUTO_CONFIRMED'
    // PENDING → appears in UAP Pending tab for owner review.
    // MANUAL  → owner explicitly overrode the auto-classification.
  },
  classificationScore: {
    type:    Number,
    default: null
    // Confidence score from semantic auto-map LLM call (0–1).
  }
}, { _id: false });

const UAPArraySchema = new mongoose.Schema({
  companyId: {
    type:     String,
    required: true,
    index:    true
  },
  daType: {
    type:     String,
    required: true
    // e.g. 'PRICING_QUERY', 'AVAILABILITY_QUERY', 'COMPLAINT', etc.
    // Unique per company — enforced by compound index below.
  },
  label: {
    type:     String,
    required: true
    // Human-readable name shown in UAP.html grid cards.
    // e.g. 'Pricing Questions', 'Availability & Scheduling'
  },
  isStandard: {
    type:    Boolean,
    default: true
    // true  = seeded standard array (shows 'Standard' badge in UI)
    // false = owner-created custom array (shows 'Custom' badge in UI)
  },
  daSubTypes: {
    type:    [DaSubTypeSchema],
    default: []
  },
  isActive: {
    type:    Boolean,
    default: true
    // false = soft-disabled; excluded from Bridge cache rebuild.
  }
}, {
  timestamps: true,
  collection: 'uapArrays'
});

// Unique daType per company — prevents duplicate seeds (idempotent seed endpoint).
UAPArraySchema.index({ companyId: 1, daType: 1 }, { unique: true });

module.exports = mongoose.model('UAPArray', UAPArraySchema);

'use strict';

/**
 * ============================================================================
 * KC GAP RESOLUTION — Closed-loop admin tracking for the Gaps & Todo workflow
 * ============================================================================
 *
 * Stores admin decisions about runtime gap events from Customer.discoveryNotes[].qaLog[].
 * The Gaps & Todo page surfaces every KC_SECTION_GAP / KC_LLM_FALLBACK / KC_GRACEFUL_ACK
 * event from the last N days. Admins author new callerPhrases / sections to cover the
 * missing content, then need a way to:
 *
 *   1. Verify the fix works (run the phrase back through KC routing)
 *   2. Mark the gap "resolved" so it stops nagging in the list
 *   3. Detect regression automatically if the same phrase pattern re-appears later
 *
 * This collection is the durable side of that loop. qaLog events are immutable history;
 * resolutions live here, keyed by a stable fingerprint of the caller phrase.
 *
 * ── KEY DESIGN ────────────────────────────────────────────────────────────────
 *
 * gapKey = sha1( companyId + ':' + normalizedPhrase )
 *
 *   normalizedPhrase = phrase.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ')
 *
 *   - companyId scopes multi-tenant isolation (enforced by index + query)
 *   - normalizedPhrase collapses "Do I HAVE to pay?" and "do i have to pay"
 *     to the same gap (callers repeat the same idea in slightly different ways)
 *   - sha1 (not sha256) — short, fast, collision-safe for this dataset size
 *
 * When the todo.html page renders the gap list, it joins rows to this collection
 * by gapKey. Rows with a matching RESOLVED doc are hidden by default.
 *
 * ── LIFECYCLE ─────────────────────────────────────────────────────────────────
 *
 *   admin clicks 🧪 Verify on a gap row
 *     → POST /knowledge/gaps/verify { phrase }
 *     → KCVerifyService runs the phrase through KC routing (side-effect-free)
 *     → returns { verdict: 'resolved'|'weak'|'failing', matchedContainer, ... }
 *     → UI shows green/amber/red badge, no write to this collection yet
 *
 *   admin clicks ✅ Mark Done on a green row
 *     → POST /knowledge/gaps/resolve { phrase, verifyResult }
 *     → upsert here with status='RESOLVED', lastVerifiedAt, resolvedBy
 *     → next page refresh hides this gap
 *
 *   future regression (same phrase re-appears in qaLog and still fails to route)
 *     → detected by server-side join + re-verify on load
 *     → status flipped to 'REGRESSED', reappears in the list with 🚨 badge
 *
 * ── MULTI-TENANT SAFETY ───────────────────────────────────────────────────────
 *
 *   Every query MUST include companyId. The unique index is (companyId, gapKey).
 *   Cross-tenant access is impossible at the database layer.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto   = require('crypto');

// ─── STATUS ENUM ─────────────────────────────────────────────────────────────
const STATUS = Object.freeze({
    RESOLVED:  'RESOLVED',    // Admin marked done AND verify passed at time of resolution
    WEAK:      'WEAK',        // Verify passed but scored near threshold — watch-list
    REGRESSED: 'REGRESSED',   // Previously RESOLVED but later verify failed — needs attention
    DISMISSED: 'DISMISSED',   // Admin explicitly dismissed (noise / out-of-scope)
});

// ─── VERDICT ENUM (from verify service, captured on resolve) ─────────────────
const VERDICT = Object.freeze({
    RESOLVED: 'resolved',     // Clean KC routing hit, container AND section matched
    WEAK:     'weak',         // KC matched but score near threshold or wrong container
    FAILING:  'failing',      // No KC match — would fall through to LLM fallback
});

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
const kcGapResolutionSchema = new mongoose.Schema({

    // ── Identity (multi-tenant isolation) ────────────────────────────────────
    companyId: {
        type:     String,
        required: true,
        trim:     true,
        index:    true,
    },

    // Stable fingerprint: sha1(companyId + ':' + normalizedPhrase)
    // Unique per company — see compound index below.
    gapKey: {
        type:     String,
        required: true,
        trim:     true,
    },

    // ── Source material ──────────────────────────────────────────────────────
    // Original phrase as the caller said it (for display)
    phrase: {
        type:      String,
        required:  true,
        maxlength: 2000,
    },

    // Normalized form used to compute gapKey (for debug / re-hash verification)
    normalizedPhrase: {
        type:      String,
        required:  true,
        maxlength: 2000,
    },

    // Original gap type from qaLog — helps prioritization and reporting
    originalType: {
        type: String,
        enum: ['KC_SECTION_GAP', 'KC_LLM_FALLBACK', 'KC_GRACEFUL_ACK'],
    },

    // Container the gap was associated with (if KC_SECTION_GAP)
    // Kept for regression detection: if verify later routes to a DIFFERENT
    // container, that's a signal the content authoring drifted.
    originalContainerId: {
        type:    mongoose.Schema.Types.Mixed,    // ObjectId or string
        default: null,
    },
    originalContainerTitle: {
        type:      String,
        maxlength: 300,
        default:   null,
    },

    // ── Resolution state ─────────────────────────────────────────────────────
    status: {
        type:     String,
        enum:     Object.values(STATUS),
        default:  STATUS.RESOLVED,
        required: true,
        index:    true,
    },

    // Last verification outcome (from KCVerifyService)
    lastVerdict: {
        type: String,
        enum: Object.values(VERDICT),
    },

    // Full verify snapshot at time of resolve — gates, matched container, score.
    // Stored as-is; the UI can replay it without re-running verify.
    lastVerifyResult: {
        type:    mongoose.Schema.Types.Mixed,
        default: null,
    },

    // Full GapReplayService trace captured at resolve time (6-gate diagnostic:
    // CueExtractor / UAP / WordGate / CoreConfirm / Semantic / Keyword). Mirrors
    // production routing module-for-module so the audit trail shows WHY each
    // gate returned what it did. Null if the resolution predates the v2 replay.
    replayTrace: {
        type:    mongoose.Schema.Types.Mixed,
        default: null,
    },

    // Fix Advisor output if the admin invoked it before resolving.
    // Shape: { type, confidence, target, proposal, reasoning, nearMisses,
    //          advisorModel, latencyMs, vetoed?, vetoReason? }
    // Captured for audit so we can measure advisor quality over time.
    fixAdvisor: {
        type:    mongoose.Schema.Types.Mixed,
        default: null,
    },

    // Container + section the phrase now routes to (ideal state)
    resolvedContainerId: {
        type:    mongoose.Schema.Types.Mixed,
        default: null,
    },
    resolvedContainerTitle: {
        type:      String,
        maxlength: 300,
        default:   null,
    },
    resolvedSectionLabel: {
        type:      String,
        maxlength: 300,
        default:   null,
    },

    // ── Audit trail ──────────────────────────────────────────────────────────
    resolvedBy: {
        type: String,
        trim: true,    // User email / id — set from JWT at write time
    },

    resolvedAt: {
        type:    Date,
        default: Date.now,
    },

    lastVerifiedAt: {
        type:    Date,
        default: Date.now,
    },

    // Number of times this phrase has been re-verified (regression checks)
    verifyCount: {
        type:    Number,
        default: 1,
    },

    // Free-form admin note (e.g. "added 3 callerPhrases to No Cooling §7")
    note: {
        type:      String,
        maxlength: 1000,
        trim:      true,
    },

}, {
    timestamps: true,                  // createdAt / updatedAt
    collection: 'kcGapResolutions',
});

// ─── INDEXES ─────────────────────────────────────────────────────────────────

// Primary lookup — one resolution per (company, phrase fingerprint)
kcGapResolutionSchema.index({ companyId: 1, gapKey: 1 }, { unique: true });

// Status filters on the todo page
kcGapResolutionSchema.index({ companyId: 1, status: 1, resolvedAt: -1 });

// Regression scans (find RESOLVED docs to re-verify on a schedule)
kcGapResolutionSchema.index({ status: 1, lastVerifiedAt: 1 });

// ─── STATICS ─────────────────────────────────────────────────────────────────

/**
 * Normalize a caller phrase to its comparable form.
 * Collapses case, punctuation, and whitespace so near-duplicate utterances
 * resolve to the same gapKey.
 *
 * @param  {string} phrase
 * @return {string}
 */
kcGapResolutionSchema.statics.normalizePhrase = function (phrase) {
    if (!phrase || typeof phrase !== 'string') return '';
    return phrase
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Build a stable gapKey from (companyId, phrase).
 * Same phrase in different casings / punctuation → same key.
 *
 * @param  {string} companyId
 * @param  {string} phrase
 * @return {string} sha1 hex (40 chars)
 */
kcGapResolutionSchema.statics.buildGapKey = function (companyId, phrase) {
    const norm = this.normalizePhrase(phrase);
    return crypto
        .createHash('sha1')
        .update(`${companyId}:${norm}`)
        .digest('hex');
};

/**
 * Fetch resolutions for a company as a gapKey→doc map for O(1) join
 * in the /gaps aggregation response.
 *
 * @param  {string}   companyId
 * @param  {string[]} [statuses]  — optional filter (default: all non-dismissed)
 * @return {Promise<Object<string, Object>>}
 */
kcGapResolutionSchema.statics.mapForCompany = async function (companyId, statuses = null) {
    const query = { companyId };
    if (Array.isArray(statuses) && statuses.length) {
        query.status = { $in: statuses };
    }
    const docs = await this.find(query).lean();
    const out  = {};
    for (const d of docs) out[d.gapKey] = d;
    return out;
};

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

const KCGapResolution = mongoose.model('KCGapResolution', kcGapResolutionSchema);

// Expose enums for route / service layer
KCGapResolution.STATUS  = STATUS;
KCGapResolution.VERDICT = VERDICT;

module.exports = KCGapResolution;

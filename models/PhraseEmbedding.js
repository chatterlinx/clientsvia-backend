/**
 * ============================================================================
 * PHRASE EMBEDDING — Sidecar storage for callerPhrase vectors
 * ============================================================================
 *
 * WHY THIS EXISTS:
 * callerPhrases[].embedding used to live inline on CompanyKnowledgeContainer.
 * That worked at ~50 phrases/container. At ~3,000 phrases (No Cooling), a
 * single container hit 17+ MB, blowing past MongoDB's hard 16 MB document
 * limit → BSON serializer crashes on save, silent GATE 2.8 failures on read.
 *
 * We store each embedding as its own small document keyed by:
 *   (companyId, containerId, phraseText)
 *
 * WHY TEXT, NOT POSITION:
 * The embedding is a pure function of the phrase text. Section reorders and
 * phrase moves don't invalidate it. Same-text phrases in different sections
 * of the same container share one embedding — that's correct, not a bug.
 *
 * READ PATTERN:
 *   PhraseEmbeddingService.hydrate(container)        // single container
 *   PhraseEmbeddingService.hydrateMany(containers)   // batched, one query
 * Both walk the container.sections[].callerPhrases[] tree and attach
 * `phrase.embedding` in-memory so downstream cosine-sim code is unchanged.
 *
 * WRITE PATTERN:
 *   PhraseEmbeddingService.saveBatch(containerId, companyId, entries)
 * Bulk upsert keyed on phraseText — idempotent, survives concurrent saves.
 *
 * INVALIDATION:
 *   PhraseEmbeddingService.deleteForContainer(containerId)     // on container delete
 *   PhraseEmbeddingService.deleteOrphans(containerId, texts)   // prune phrases no longer in container
 *
 * ISOLATION:
 * companyId and containerId are always present — multi-tenant safe.
 * Never cross-query by text alone.
 * ============================================================================
 */

const mongoose = require('mongoose');

const phraseEmbeddingSchema = new mongoose.Schema({
  // ── Identity ───────────────────────────────────────────────────────────────
  companyId: {
    type:     String,
    required: true,
    index:    true,
    comment:  'Owning company — isolation key.',
  },
  containerId: {
    type:     mongoose.Schema.Types.ObjectId,
    required: true,
    index:    true,
    comment:  'Owning CompanyKnowledgeContainer._id.',
  },

  // ── Phrase text — the natural key within a container ──────────────────────
  // We normalize on the way in (trim, lowercase) so duplicate text with
  // cosmetic differences shares one row.
  phraseText: {
    type:     String,
    required: true,
    maxlength: 500,
    comment:  'Normalized phrase text — the join key to container.callerPhrases[].text.',
  },

  // ── The vector ─────────────────────────────────────────────────────────────
  // 512-dim float array from OpenAI text-embedding-3-small. Stored as
  // BSON Double array (~4 KB/doc) — individual docs stay tiny, so the
  // 16 MB per-document ceiling is a non-issue no matter how many phrases
  // a container grows to.
  embedding: {
    type:     [Number],
    required: true,
    comment:  '512-dim embedding from text-embedding-3-small.',
  },

  // ── Diagnostics (not used for lookup) ──────────────────────────────────────
  // Keeping these for debugging / migration reconciliation. Never rely on
  // them for joins — sections can move, so sectionId is informational only.
  sectionId: {
    type:    mongoose.Schema.Types.ObjectId,
    default: null,
    comment: 'Debug-only. Section subdoc _id at last write. May drift after reorder.',
  },

  // ── Audit ──────────────────────────────────────────────────────────────────
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  collection: 'phraseembeddings',
  versionKey: false,
});

// ── Indexes ───────────────────────────────────────────────────────────────────
// Primary lookup: one row per (containerId, phraseText). Upserts hit this.
phraseEmbeddingSchema.index(
  { containerId: 1, phraseText: 1 },
  { unique: true, name: 'uniq_container_phraseText' },
);

// Fast tenant sweep (migrations, admin sweeps, cache invalidation).
phraseEmbeddingSchema.index(
  { companyId: 1, containerId: 1 },
  { name: 'company_container' },
);

// ── Hooks ─────────────────────────────────────────────────────────────────────
phraseEmbeddingSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.models.PhraseEmbedding
  || mongoose.model('PhraseEmbedding', phraseEmbeddingSchema);

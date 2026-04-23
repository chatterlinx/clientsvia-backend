/**
 * ============================================================================
 * PHRASE EMBEDDING SERVICE — Sidecar read/write for callerPhrase vectors
 * ============================================================================
 *
 * Abstracts the PhraseEmbedding collection so no runtime code has to know
 * that embeddings live outside the container doc. Three responsibilities:
 *
 *   1. hydrate(container)         — attach phrase.embedding to a single container
 *   2. hydrateMany(containers)    — same, for an array (one query)
 *   3. saveBatch / deleteForContainer / deleteOrphans — write side
 *
 * CRITICAL: hydrate mutates the container in place so downstream readers
 * (SemanticMatchService.findBestSection, KCDiscoveryRunner GATE 2.8,
 * GapReplayService, FixAdvisorService) continue to work unchanged.
 *
 * NORMALIZATION:
 * phraseText is lowercased + trimmed on write. Lookup normalizes the same
 * way, so cosmetic text diffs (trailing space, capitalization) share one
 * embedding. This matches how embedBatch processes text upstream.
 *
 * PERFORMANCE:
 * Single-container hydrate: 1 query, indexed on (containerId, phraseText).
 * Many-container hydrate: 1 query with $in on containerId. Grouped in JS.
 * Typical No Cooling hydrate: 3,022 rows × 4 KB = ~12 MB over the wire,
 * still well under BSON limits (cursor streams, never one BSON doc).
 * ============================================================================
 */

'use strict';

const logger = require('../../utils/logger');
const PhraseEmbedding = require('../../models/PhraseEmbedding');

// ── Normalization — must match the key written at upsert time ───────────────
function _normalizeText(text) {
  if (!text) return '';
  return String(text).trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// HYDRATE — attach phrase.embedding to a single container
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Loads all PhraseEmbedding rows for this container and attaches each
 * row's embedding to the matching callerPhrase in-memory. Mutates the
 * container object in place. Safe to call on containers with no phrases
 * (no-op) and on containers that were already hydrated (overwrites).
 *
 * @param {Object} container — mongoose doc or plain lean object
 * @returns {Promise<Object>} — same container, with embeddings attached
 */
async function hydrate(container) {
  if (!container?._id) return container;

  const rows = await PhraseEmbedding
    .find({ containerId: container._id })
    .select('phraseText embedding')
    .lean();

  if (!rows.length) return container;

  // Build lookup: text → embedding[]
  const byText = new Map();
  for (const r of rows) {
    byText.set(r.phraseText, r.embedding);
  }

  // Walk sections → phrases → attach
  for (const section of (container.sections || [])) {
    for (const phrase of (section.callerPhrases || [])) {
      const key = _normalizeText(phrase.text);
      const vec = byText.get(key);
      if (vec) phrase.embedding = vec;
    }
  }

  return container;
}

// ─────────────────────────────────────────────────────────────────────────────
// HYDRATE MANY — batched, one query for an array of containers
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Same as hydrate() but for multiple containers in a single DB call.
 * Used by KCDiscoveryRunner GATE 2.8 which loads all active containers.
 *
 * @param {Object[]} containers — array of container docs (mongoose or lean)
 * @returns {Promise<Object[]>} — same array, mutated
 */
async function hydrateMany(containers) {
  if (!containers?.length) return containers;

  const ids = containers.map(c => c._id).filter(Boolean);
  if (!ids.length) return containers;

  const rows = await PhraseEmbedding
    .find({ containerId: { $in: ids } })
    .select('containerId phraseText embedding')
    .lean();

  if (!rows.length) return containers;

  // Build lookup: containerId → (text → embedding)
  const byContainer = new Map();
  for (const r of rows) {
    const cid = String(r.containerId);
    if (!byContainer.has(cid)) byContainer.set(cid, new Map());
    byContainer.get(cid).set(r.phraseText, r.embedding);
  }

  // Attach per container
  for (const container of containers) {
    const cid = String(container._id);
    const byText = byContainer.get(cid);
    if (!byText) continue;
    for (const section of (container.sections || [])) {
      for (const phrase of (section.callerPhrases || [])) {
        const key = _normalizeText(phrase.text);
        const vec = byText.get(key);
        if (vec) phrase.embedding = vec;
      }
    }
  }

  return containers;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVE BATCH — bulk upsert for a set of (text, embedding) pairs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Persists embeddings for one container. Idempotent — running twice with
 * the same payload is a no-op. Skips entries with missing text or vector.
 *
 * @param {Object} args
 * @param {String} args.companyId
 * @param {ObjectId|String} args.containerId
 * @param {Array<{ text, embedding, sectionId? }>} args.entries
 * @returns {Promise<{ upserted: number, skipped: number }>}
 */
async function saveBatch({ companyId, containerId, entries }) {
  if (!companyId || !containerId || !Array.isArray(entries) || !entries.length) {
    return { upserted: 0, skipped: 0 };
  }

  const ops = [];
  let skipped = 0;

  for (const e of entries) {
    const text = _normalizeText(e.text);
    const vec  = Array.isArray(e.embedding) ? e.embedding : null;
    if (!text || !vec || !vec.length) { skipped++; continue; }

    ops.push({
      updateOne: {
        filter: { containerId, phraseText: text },
        update: {
          $set: {
            companyId:   String(companyId),
            containerId,
            phraseText:  text,
            embedding:   vec,
            sectionId:   e.sectionId || null,
            updatedAt:   new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    });
  }

  if (!ops.length) return { upserted: 0, skipped };

  try {
    // ordered:false so one bad row doesn't abort the whole batch. We still
    // chunk the bulkWrite in case callers hand us a huge array — each
    // bulkWrite op is its own tiny BSON doc (~4 KB), so the wire payload
    // never approaches the 16 MB limit.
    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const slice = ops.slice(i, i + CHUNK);
      const res = await PhraseEmbedding.bulkWrite(slice, { ordered: false });
      upserted += (res.upsertedCount || 0) + (res.modifiedCount || 0);
    }
    return { upserted, skipped };
  } catch (err) {
    logger.error('[PhraseEmbeddingService] saveBatch error', {
      companyId, containerId: String(containerId), count: ops.length, err: err.message,
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNT — how many embeddings exist for this container
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Used by the admin embed-plan endpoint to decide how many phrases are
 * still pending without loading the vectors themselves (fast).
 *
 * @param {ObjectId|String} containerId
 * @returns {Promise<number>}
 */
async function countForContainer(containerId) {
  if (!containerId) return 0;
  return await PhraseEmbedding.countDocuments({ containerId });
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH TEXT SET — which texts already have embeddings for this container
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns a Set of phraseText values already embedded for this container.
 * Used by the embed path to skip phrases that are already done.
 *
 * @param {ObjectId|String} containerId
 * @returns {Promise<Set<string>>}
 */
async function getEmbeddedTextSet(containerId) {
  if (!containerId) return new Set();
  const rows = await PhraseEmbedding
    .find({ containerId })
    .select('phraseText')
    .lean();
  return new Set(rows.map(r => r.phraseText));
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — remove rows when a container is deleted or phrases are pruned
// ─────────────────────────────────────────────────────────────────────────────
async function deleteForContainer(containerId) {
  if (!containerId) return 0;
  const res = await PhraseEmbedding.deleteMany({ containerId });
  return res.deletedCount || 0;
}

/**
 * Prune embeddings whose phraseText is no longer present in the container.
 * Called after a save that may have removed phrases — keeps the sidecar
 * collection clean.
 *
 * @param {ObjectId|String} containerId
 * @param {String[]} currentTexts — normalized texts still present
 * @returns {Promise<number>} — deleted count
 */
async function deleteOrphans(containerId, currentTexts) {
  if (!containerId) return 0;
  const keep = new Set((currentTexts || []).map(_normalizeText).filter(Boolean));
  const res = await PhraseEmbedding.deleteMany({
    containerId,
    phraseText: { $nin: Array.from(keep) },
  });
  return res.deletedCount || 0;
}

module.exports = {
  hydrate,
  hydrateMany,
  saveBatch,
  countForContainer,
  getEmbeddedTextSet,
  deleteForContainer,
  deleteOrphans,
  _normalizeText,  // exported for tests / migration
};

'use strict';

/**
 * ============================================================================
 * SEMANTIC MATCH SERVICE
 * ============================================================================
 *
 * Embedding-based semantic matching for Knowledge Container sections.
 * Gate 2.8 in the KCDiscoveryRunner pipeline — fires when UAP phrase match
 * misses but the caller's meaning is close to a section's content.
 *
 * Uses OpenAI text-embedding-3-small (512 dims) for all embeddings.
 *
 * PUBLIC API:
 *   findBestSection(companyId, utterance, containers)
 *     → { section, sectionIdx, container, similarity, matchedPhrase } | null
 *
 *   embedText(text)
 *     → [Number] (512-dim)
 *
 *   embedCallerPhrases(sections)
 *     → mutates sections[].callerPhrases[].embedding in place
 *
 *   embedSectionContent(sections)
 *     → mutates sections[].contentEmbedding in place
 *
 *   cosineSimilarity(vecA, vecB)
 *     → Number (0–1)
 *
 * GRACEFUL DEGRADE:
 *   OPENAI_API_KEY not set → all methods return null / skip → no crash.
 *   Network error → returns null → KCDiscoveryRunner falls through to Gate 3.
 *
 * ============================================================================
 */

const OpenAI  = require('openai');
const logger  = require('../../../utils/logger');

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  MODEL:       'text-embedding-3-small',
  DIMENSIONS:  512,
  // Minimum cosine similarity to consider a semantic match
  MIN_SIMILARITY: parseFloat(process.env.KC_SEMANTIC_THRESHOLD) || 0.50,
  // Batch size for embedding multiple texts in one API call
  MAX_BATCH:   64,
};

// ============================================================================
// OPENAI CLIENT (lazy-loaded, shared)
// ============================================================================

let _openai = null;
function _getOpenAI() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ============================================================================
// CORE EMBEDDING
// ============================================================================

/**
 * embedText — Generate a 512-dim embedding for a single text string.
 * Returns null if OPENAI_API_KEY is not set or API fails.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function embedText(text) {
  const client = _getOpenAI();
  if (!client || !text?.trim()) return null;

  try {
    const res = await client.embeddings.create({
      model:      CONFIG.MODEL,
      input:      text.trim(),
      dimensions: CONFIG.DIMENSIONS,
    });
    return res.data[0].embedding;
  } catch (err) {
    logger.warn('[SemanticMatch] embedText failed', { err: err.message });
    return null;
  }
}

/**
 * embedBatch — Generate embeddings for multiple texts in one API call.
 * Returns array of embeddings (null for any that failed).
 *
 * @param {string[]} texts
 * @returns {Promise<(number[]|null)[]>}
 */
async function embedBatch(texts) {
  const client = _getOpenAI();
  if (!client || !texts?.length) return texts.map(() => null);

  // Filter out empty strings, track original indices
  const valid = [];
  for (let i = 0; i < texts.length; i++) {
    const t = (texts[i] || '').trim();
    if (t) valid.push({ idx: i, text: t });
  }

  if (!valid.length) return texts.map(() => null);

  const results = new Array(texts.length).fill(null);

  // Process in batches
  for (let start = 0; start < valid.length; start += CONFIG.MAX_BATCH) {
    const batch = valid.slice(start, start + CONFIG.MAX_BATCH);
    try {
      const res = await client.embeddings.create({
        model:      CONFIG.MODEL,
        input:      batch.map(b => b.text),
        dimensions: CONFIG.DIMENSIONS,
      });
      for (let j = 0; j < res.data.length; j++) {
        results[batch[j].idx] = res.data[j].embedding;
      }
    } catch (err) {
      logger.warn('[SemanticMatch] embedBatch failed', {
        err: err.message,
        batchSize: batch.length,
      });
      // Partial failure — batch entries stay null
    }
  }

  return results;
}

// ============================================================================
// SIMILARITY
// ============================================================================

/**
 * cosineSimilarity — Compute cosine similarity between two vectors.
 * Returns 0 if either vector is empty or malformed.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0–1
 */
function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;

  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// ============================================================================
// SECTION MATCHING
// ============================================================================

/**
 * findBestSection — Find the section whose content is most semantically
 * similar to the caller's utterance. Compares against:
 *   1. section.callerPhrases[].embedding (best phrase wins)
 *   2. section.contentEmbedding (fallback)
 *
 * Returns null if no match exceeds MIN_SIMILARITY or OPENAI_API_KEY not set.
 *
 * CALLED FROM (Stage 13 audit):
 *   - routes/admin/companyKnowledge.js (admin verify/test-match tool)
 *   - services/kcVerify/GapReplayService.js (offline gap replay)
 *   KCDiscoveryRunner GATE 2.8 uses the Diagnostic variant — keep both.
 *
 * @param {string}   companyId   — for logging only
 * @param {string}   utterance   — raw caller utterance
 * @param {Object[]} containers  — lean KC containers with sections (must include embeddings via +select)
 * @returns {Promise<{section, sectionIdx, container, similarity, matchSource}|null>}
 */
async function findBestSection(companyId, utterance, containers, precomputedVec = null) {
  if (!_getOpenAI()) return null;
  if (!utterance?.trim() || !containers?.length) return null;

  // 1. Embed the caller utterance (skip if pre-computed vector supplied)
  const utteranceVec = precomputedVec || await embedText(utterance);
  if (!utteranceVec) return null;

  let best = null;

  for (const container of containers) {
    const sections = container.sections || [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];

      // Skip inactive sections — disabled by business owner, not eligible for matching
      if (section.isActive === false) continue;

      // A. Compare against each callerPhrase embedding
      for (const phrase of (section.callerPhrases || [])) {
        if (!phrase.embedding?.length) continue;
        const sim = cosineSimilarity(utteranceVec, phrase.embedding);
        if (sim >= CONFIG.MIN_SIMILARITY && (!best || sim > best.similarity)) {
          best = {
            section,
            sectionIdx:  sIdx,
            container,
            similarity:  sim,
            matchSource: 'CALLER_PHRASE',
            matchedPhrase: phrase.text,
          };
        }
      }

      // B. Compare against section contentEmbedding
      if (section.contentEmbedding?.length) {
        const sim = cosineSimilarity(utteranceVec, section.contentEmbedding);
        if (sim >= CONFIG.MIN_SIMILARITY && (!best || sim > best.similarity)) {
          best = {
            section,
            sectionIdx:  sIdx,
            container,
            similarity:  sim,
            matchSource: 'CONTENT_EMBEDDING',
            matchedPhrase: null,
          };
        }
      }
    }
  }

  if (best) {
    logger.info('[SemanticMatch] Match found', {
      companyId,
      containerId:  String(best.container._id),
      sectionIdx:   best.sectionIdx,
      sectionLabel: best.section.label,
      similarity:   best.similarity.toFixed(3),
      matchSource:  best.matchSource,
    });
  }

  return best;
}

/**
 * findBestSectionDiagnostic — Same as findBestSection, but also returns the
 * best-scoring candidate even when it falls below MIN_SIMILARITY. Used by
 * KCDiscoveryRunner to emit UAP_SEMANTIC_MISS qaLog events so admins can
 * see "closest section and score" on misses (actionable signal: either
 * tune the content, add a callerPhrase, or accept the gap).
 *
 * Return shape (always non-null when OPENAI available):
 *   {
 *     match:               best candidate above threshold (same shape as
 *                          findBestSection return value), or null if none.
 *     bestBelowThreshold:  best candidate seen regardless of threshold,
 *                          or null if no embeddings existed to compare.
 *     threshold:           MIN_SIMILARITY value in effect.
 *   }
 *
 * Returns null entirely when OPENAI_API_KEY not set or input invalid.
 */
async function findBestSectionDiagnostic(companyId, utterance, containers, precomputedVec = null) {
  if (!_getOpenAI()) return null;
  if (!utterance?.trim() || !containers?.length) return null;

  const utteranceVec = precomputedVec || await embedText(utterance);
  if (!utteranceVec) return null;

  let best           = null;  // above threshold
  let bestAny        = null;  // best seen regardless of threshold

  for (const container of containers) {
    const sections = container.sections || [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];
      if (section.isActive === false) continue;

      // A. Compare against each callerPhrase embedding
      for (const phrase of (section.callerPhrases || [])) {
        if (!phrase.embedding?.length) continue;
        const sim = cosineSimilarity(utteranceVec, phrase.embedding);
        const candidate = {
          section,
          sectionIdx:    sIdx,
          container,
          similarity:    sim,
          matchSource:   'CALLER_PHRASE',
          matchedPhrase: phrase.text,
        };
        if (!bestAny || sim > bestAny.similarity) bestAny = candidate;
        if (sim >= CONFIG.MIN_SIMILARITY && (!best || sim > best.similarity)) {
          best = candidate;
        }
      }

      // B. Compare against section contentEmbedding
      if (section.contentEmbedding?.length) {
        const sim = cosineSimilarity(utteranceVec, section.contentEmbedding);
        const candidate = {
          section,
          sectionIdx:    sIdx,
          container,
          similarity:    sim,
          matchSource:   'CONTENT_EMBEDDING',
          matchedPhrase: null,
        };
        if (!bestAny || sim > bestAny.similarity) bestAny = candidate;
        if (sim >= CONFIG.MIN_SIMILARITY && (!best || sim > best.similarity)) {
          best = candidate;
        }
      }
    }
  }

  if (best) {
    logger.info('[SemanticMatch] Match found', {
      companyId,
      containerId:  String(best.container._id),
      sectionIdx:   best.sectionIdx,
      sectionLabel: best.section.label,
      similarity:   best.similarity.toFixed(3),
      matchSource:  best.matchSource,
    });
  } else if (bestAny) {
    logger.debug('[SemanticMatch] Below threshold', {
      companyId,
      containerId:  String(bestAny.container._id),
      sectionIdx:   bestAny.sectionIdx,
      sectionLabel: bestAny.section.label,
      similarity:   bestAny.similarity.toFixed(3),
      threshold:    CONFIG.MIN_SIMILARITY,
    });
  }

  return {
    match:              best,
    bestBelowThreshold: (!best && bestAny) ? bestAny : null,
    threshold:          CONFIG.MIN_SIMILARITY,
  };
}

// ============================================================================
// EMBEDDING HELPERS (called on container save)
// ============================================================================

/**
 * embedCallerPhrases — Generate embeddings for all callerPhrases that
 * don't have one yet. Mutates the sections array in place.
 *
 * @param {Object[]} sections — mutable sections array from container
 * @returns {Promise<number>} — count of newly embedded phrases
 */
async function embedCallerPhrases(sections) {
  if (!_getOpenAI() || !sections?.length) return 0;

  // Collect all phrases needing embeddings
  const pending = [];
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    for (let pIdx = 0; pIdx < (sections[sIdx].callerPhrases || []).length; pIdx++) {
      const phrase = sections[sIdx].callerPhrases[pIdx];
      if (phrase.text?.trim() && !phrase.embedding?.length) {
        pending.push({ sIdx, pIdx, text: phrase.text.trim() });
      }
    }
  }

  if (!pending.length) return 0;

  const embeddings = await embedBatch(pending.map(p => p.text));
  let count = 0;
  for (let i = 0; i < pending.length; i++) {
    if (embeddings[i]) {
      const { sIdx, pIdx } = pending[i];
      sections[sIdx].callerPhrases[pIdx].embedding = embeddings[i];
      count++;
    }
  }

  return count;
}

/**
 * embedSectionContent — Generate contentEmbedding for each section
 * whose content has changed (or has no embedding yet).
 * Mutates the sections array in place.
 *
 * @param {Object[]} sections — mutable sections array from container
 * @returns {Promise<number>} — count of newly embedded sections
 */
async function embedSectionContent(sections) {
  if (!_getOpenAI() || !sections?.length) return 0;

  const pending = [];
  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const s = sections[sIdx];
    if (s.content?.trim() && !s.contentEmbedding?.length) {
      const text = `${s.label || ''}: ${s.content}`.trim();
      pending.push({ sIdx, text });
    }
  }

  if (!pending.length) return 0;

  const embeddings = await embedBatch(pending.map(p => p.text));
  let count = 0;
  for (let i = 0; i < pending.length; i++) {
    if (embeddings[i]) {
      sections[pending[i].sIdx].contentEmbedding = embeddings[i];
      sections[pending[i].sIdx].contentEmbeddingAt = new Date();
      count++;
    }
  }

  return count;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  findBestSection,
  findBestSectionDiagnostic,
  embedText,
  embedBatch,
  embedCallerPhrases,
  embedSectionContent,
  cosineSimilarity,
  CONFIG,
};

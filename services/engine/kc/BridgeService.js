'use strict';

/**
 * ============================================================================
 * BRIDGE SERVICE  (v2.0 — Semantic Section Matching)
 * ============================================================================
 *
 * PURPOSE:
 *   Pre-computed phrase index: callerPhrase → { containerId, sectionIdx }.
 *   Allows UtteranceActParser to resolve a caller utterance to the correct
 *   KC section in ~0ms — no scoring, no LLM.
 *
 *   v2 change: Data source moved from UAPArrays (deleted) to
 *   section.callerPhrases[] on CompanyKnowledgeContainer.
 *
 * STORAGE:
 *   HOT PATH → Redis   key = bridge:{companyId}   NO TTL (event-invalidated)
 *   Cold path → rebuilt from MongoDB on cache miss
 *
 * DATA STRUCTURE (stored as JSON in Redis):
 *   {
 *     builtAt:    ISO string,
 *     version:    2,
 *     companyId:  string,
 *     phraseCount: number,
 *     phraseIndex: {
 *       [normalisedPhrase]: {
 *         containerId:  string,
 *         sectionIdx:   number,
 *         sectionLabel: string,
 *       },
 *       ...
 *     }
 *   }
 *
 * MULTI-TENANT SAFETY:
 *   Every Redis key is scoped by companyId. No cross-tenant leakage.
 *
 * GRACEFUL DEGRADE:
 *   Redis unavailable → returns null → KCDiscoveryRunner falls through
 *   to keyword scoring. Call continues. No crash.
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../../redisClientFactory');
const CompanyKnowledgeContainer = require('../../../models/CompanyKnowledgeContainer');
const logger                   = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  KEY_PREFIX: 'bridge',  // Redis key: bridge:{companyId}
  VERSION:   2,          // v2 — callerPhrases-based (v1 was UAPArray-based)
};

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

function _redisKey(companyId) {
  return `${CONFIG.KEY_PREFIX}:${companyId}`;
}

/**
 * _getRedis — Get the shared Redis client (async).
 * Returns null if Redis is not available (graceful degrade).
 */
async function _getRedis() {
  try {
    return await getSharedRedisClient();
  } catch (_e) {
    return null;
  }
}

/**
 * _normalise — Lowercase + strip punctuation (match UAP normalisation).
 */
function _normalise(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// BUILD — construct phrase index from section.callerPhrases
// ============================================================================

/**
 * _buildBridge — Query MongoDB and assemble the phrase index.
 * Reads all active containers, iterates their sections' callerPhrases,
 * and builds a flat { phrase → { containerId, sectionIdx, sectionLabel } } map.
 *
 * @param {string} companyId
 * @returns {Object} bridge data structure
 */
async function _buildBridge(companyId) {
  const containers = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true })
    .select('_id kcId title sections.label sections.callerPhrases.text sections.order priority')
    .sort({ priority: 1, createdAt: 1 })
    .lean();

  const phraseIndex = {};

  for (const c of containers) {
    const cId = String(c._id);
    const sections = c.sections || [];

    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const section = sections[sIdx];
      for (const phrase of (section.callerPhrases || [])) {
        const norm = _normalise(phrase.text);
        if (!norm) continue;

        // First phrase wins if duplicates exist across sections
        if (!phraseIndex[norm]) {
          phraseIndex[norm] = {
            containerId:  cId,
            sectionIdx:   sIdx,
            sectionLabel: section.label || '',
          };
        }
      }
    }
  }

  return {
    builtAt:     new Date().toISOString(),
    version:     CONFIG.VERSION,
    companyId,
    phraseCount: Object.keys(phraseIndex).length,
    phraseIndex,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

const BridgeService = {

  /**
   * load — Load bridge from Redis or build from DB if missing.
   *
   * @param {string} companyId
   * @returns {Promise<Object|null>} — full bridge object or null
   */
  async load(companyId) {
    if (!companyId) return null;

    const redis = await _getRedis();
    const key   = _redisKey(companyId);

    // ── Try Redis first ──────────────────────────────────────────────────
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) {
          const bridge = JSON.parse(cached);
          if (bridge?.version === CONFIG.VERSION) return bridge;
          logger.info('[BridgeService] version mismatch — rebuilding', { companyId });
        }
      } catch (redisErr) {
        logger.warn('[BridgeService] Redis read error — falling through to build', {
          companyId, err: redisErr.message
        });
      }
    }

    // ── Cache miss / Redis unavailable → build from DB ───────────────────
    try {
      return await BridgeService.build(companyId);
    } catch (buildErr) {
      logger.warn('[BridgeService] build error', { companyId, err: buildErr.message });
      return null;
    }
  },

  /**
   * build — (Re)build the bridge from MongoDB and cache in Redis.
   *
   * @param {string} companyId
   * @returns {Promise<Object>} — built bridge object
   */
  async build(companyId) {
    const bridge = await _buildBridge(companyId);

    const redis = await _getRedis();
    if (redis) {
      try {
        await redis.set(_redisKey(companyId), JSON.stringify(bridge));
      } catch (redisErr) {
        logger.warn('[BridgeService] Redis write error (bridge still returned)', {
          companyId, err: redisErr.message
        });
      }
    }

    logger.info('[BridgeService] Built bridge', {
      companyId,
      phraseCount: bridge.phraseCount,
    });

    return bridge;
  },

  /**
   * invalidate — Delete the cached bridge + UAP in-process phrase cache.
   * Called whenever a KC container is saved (callerPhrases may have changed).
   *
   * @param {string} companyId
   * @returns {Promise<void>}
   */
  async invalidate(companyId) {
    if (!companyId) return;

    // Invalidate UAP in-process phrase cache (fixes stale cache bug)
    try {
      const UAP = require('./UtteranceActParser');
      UAP.invalidatePhraseCache(companyId);
    } catch (_e) { /* non-fatal */ }

    const redis = await _getRedis();
    if (!redis) return;

    try {
      await redis.del(_redisKey(companyId));
      logger.debug('[BridgeService] Cache invalidated', { companyId });
    } catch (err) {
      logger.warn('[BridgeService] invalidate error', { companyId, err: err.message });
    }
  },

  /**
   * getAllPhrases — Return the full phrase index.
   * Used by UtteranceActParser to build its matching structure.
   *
   * Returns: { [phrase]: { containerId, sectionIdx, sectionLabel } }
   *
   * @param {string} companyId
   * @returns {Promise<Object>}
   */
  async getAllPhrases(companyId) {
    if (!companyId) return {};
    try {
      const bridge = await BridgeService.load(companyId);
      return bridge?.phraseIndex || {};
    } catch (_e) {
      return {};
    }
  },

  /**
   * status — Debug/admin: return bridge metadata.
   *
   * @param {string} companyId
   * @returns {Promise<Object>}
   */
  async status(companyId) {
    if (!companyId) return { cached: false, phraseCount: 0 };
    try {
      const bridge = await BridgeService.load(companyId);
      if (!bridge) return { cached: false, phraseCount: 0 };
      return {
        cached:      true,
        builtAt:     bridge.builtAt,
        version:     bridge.version,
        phraseCount: bridge.phraseCount,
      };
    } catch (_e) {
      return { cached: false, phraseCount: 0 };
    }
  },
};

module.exports = BridgeService;

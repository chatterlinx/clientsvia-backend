'use strict';

/**
 * ============================================================================
 * BRIDGE SERVICE  (v1.0 — Build Step 5)
 * ============================================================================
 *
 * PURPOSE:
 *   Pre-computed routing table: daType → KC containers.
 *   Allows the UtteranceActParser (Step 6) to resolve a classified intent
 *   (daType) to the correct KC container in ~0ms — no scoring, no Groq.
 *
 *   The Bridge sits between the UAP classifier and the KC knowledge engine:
 *
 *     Caller utterance
 *       → UtteranceActParser (Layer 1 — rule-based, ~0ms)
 *           → daType (e.g. 'PRICING_QUERY')
 *               → BridgeService.lookup(companyId, daType)
 *                   → [containerId, ...] ordered by priority
 *                       → KCS.answer(containerId, utterance)
 *
 * STORAGE:
 *   HOT PATH → Redis   key = bridge:{companyId}   NO TTL (event-invalidated)
 *   Cold path → rebuilt from MongoDB on cache miss
 *
 * CACHE LIFECYCLE:
 *   Built:       On first lookup (lazy build)
 *   Invalidated: When KC container daType changes (companyKnowledge.js PATCH)
 *                When UAPArray trigger phrases are added/removed (uapArrays.js)
 *                Explicitly via BridgeService.invalidate(companyId)
 *   Never TTL'd: The bridge should always reflect current config.
 *                We want "stale = impossible" not "stale = eventually consistent".
 *
 * DATA STRUCTURE (stored as JSON in Redis):
 *   {
 *     builtAt: ISO string,
 *     version: 1,
 *     routes: {
 *       [daType]: {
 *         label:      string,        // daType human label from UAPArray
 *         containers: [              // sorted by priority ASC
 *           { id, kcId, title, priority },
 *           ...
 *         ],
 *         triggerPhrases: string[],  // all phrases for this daType across sub-types
 *       },
 *       ...
 *     }
 *   }
 *
 * MULTI-TENANT SAFETY:
 *   Every Redis key is scoped by companyId. No cross-tenant leakage.
 *
 * GRACEFUL DEGRADE:
 *   Redis unavailable → lookup returns null → KCDiscoveryRunner falls through
 *   to normal keyword scoring. Call continues. No crash.
 *
 * USAGE:
 *   const BridgeService = require('./BridgeService');
 *
 *   // At runtime (hot path — called from KCDiscoveryRunner):
 *   const containers = await BridgeService.lookup(companyId, daType);
 *   // returns [{ id, kcId, title, priority }] or null
 *
 *   // After KC save / UAP update:
 *   await BridgeService.invalidate(companyId);
 *
 *   // Force rebuild (admin debug):
 *   const bridge = await BridgeService.build(companyId);
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../../redisClientFactory');
const UAPArray                 = require('../../../models/UAPArray');
const CompanyKnowledgeContainer = require('../../../models/CompanyKnowledgeContainer');
const logger                   = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  KEY_PREFIX:   'bridge',    // Redis key: bridge:{companyId}
  VERSION:      1,
  // No TTL — bridge is event-invalidated, not time-invalidated.
  // Staleness is eliminated at the source (writes call invalidate()).
};

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

function _redisKey(companyId) {
  return `${CONFIG.KEY_PREFIX}:${companyId}`;
}

/**
 * _getRedis — Get the shared Redis client.
 * Returns null if Redis is not available (graceful degrade).
 */
function _getRedis() {
  try {
    return getSharedRedisClient();
  } catch (_e) {
    return null;
  }
}

// ============================================================================
// BUILD — construct bridge from UAPArrays + KC containers
// ============================================================================

/**
 * _buildBridge — Query MongoDB and assemble the routing table.
 * Called on cache miss or explicit rebuild request.
 *
 * @param {string} companyId
 * @returns {Object} bridge data structure
 */
async function _buildBridge(companyId) {
  // Load all active UAP arrays for this company
  const uapArrays = await UAPArray.find({ companyId, isActive: true }).lean();

  // Load all active KC containers that have a daType set
  const containers = await CompanyKnowledgeContainer
    .find({ companyId, isActive: true, daType: { $ne: null } })
    .select('_id kcId title daType daSubTypes priority')
    .sort({ priority: 1, createdAt: 1 })
    .lean();

  // Build daType → label map from UAPArrays
  const daTypeLabelMap = {};
  const daTypePhraseMap = {};   // daType → all trigger phrases across sub-types

  for (const array of uapArrays) {
    daTypeLabelMap[array.daType] = array.label;

    // Collect ALL trigger phrases across all sub-types for this daType
    const allPhrases = [];
    for (const sub of (array.daSubTypes || [])) {
      for (const phrase of (sub.triggerPhrases || [])) {
        if (phrase) allPhrases.push(phrase.toLowerCase().trim());
      }
    }
    daTypePhraseMap[array.daType] = [...new Set(allPhrases)];
  }

  // Aggregate containers by daType
  const routes = {};

  for (const c of containers) {
    const daType = c.daType;
    if (!daType) continue;

    if (!routes[daType]) {
      routes[daType] = {
        label:          daTypeLabelMap[daType] || daType,
        containers:     [],
        triggerPhrases: daTypePhraseMap[daType] || [],
      };
    }

    routes[daType].containers.push({
      id:       String(c._id),
      kcId:     c.kcId   || null,
      title:    c.title,
      priority: c.priority ?? 100,
    });
  }

  // Sort containers within each daType by priority
  for (const route of Object.values(routes)) {
    route.containers.sort((a, b) => a.priority - b.priority);
  }

  return {
    builtAt:    new Date().toISOString(),
    version:    CONFIG.VERSION,
    companyId,
    routeCount: Object.keys(routes).length,
    routes,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

const BridgeService = {

  /**
   * lookup — Return KC containers for a given daType.
   * Loads from Redis cache; builds if missing.
   *
   * Hot path — called every turn by UtteranceActParser/KCDiscoveryRunner.
   * Must be fast: Redis hit = ~1ms, cold build = ~20ms (one-time).
   *
   * @param {string} companyId
   * @param {string} daType       — e.g. 'PRICING_QUERY'
   * @returns {Promise<Array|null>} — [{id, kcId, title, priority}] or null
   */
  async lookup(companyId, daType) {
    if (!companyId || !daType) return null;

    try {
      const bridge = await BridgeService.load(companyId);
      if (!bridge) return null;
      return bridge.routes[daType]?.containers || null;
    } catch (err) {
      logger.warn('[BridgeService] lookup error', { companyId, daType, err: err.message });
      return null;
    }
  },

  /**
   * load — Load bridge from Redis or build from DB if missing.
   *
   * @param {string} companyId
   * @returns {Promise<Object|null>} — full bridge object or null
   */
  async load(companyId) {
    if (!companyId) return null;

    const redis = _getRedis();
    const key   = _redisKey(companyId);

    // ── Try Redis first ────────────────────────────────────────────────────
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) {
          const bridge = JSON.parse(cached);
          if (bridge?.version === CONFIG.VERSION) return bridge;
          // Version mismatch → rebuild
          logger.info('[BridgeService] version mismatch — rebuilding', { companyId });
        }
      } catch (redisErr) {
        logger.warn('[BridgeService] Redis read error — falling through to build', {
          companyId, err: redisErr.message
        });
      }
    }

    // ── Cache miss / Redis unavailable → build from DB ─────────────────────
    try {
      return await BridgeService.build(companyId);
    } catch (buildErr) {
      logger.warn('[BridgeService] build error', { companyId, err: buildErr.message });
      return null;
    }
  },

  /**
   * build — (Re)build the bridge from MongoDB and cache in Redis.
   * Called on cold path or forced rebuild.
   *
   * @param {string} companyId
   * @returns {Promise<Object>} — built bridge object
   */
  async build(companyId) {
    const bridge = await _buildBridge(companyId);

    // Cache in Redis (no TTL — event-invalidated)
    const redis = _getRedis();
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
      routeCount:     bridge.routeCount,
      containerCount: Object.values(bridge.routes).reduce((s, r) => s + r.containers.length, 0),
    });

    return bridge;
  },

  /**
   * invalidate — Delete the cached bridge for a company.
   * Called whenever KC container daType changes or UAPArray trigger phrases change.
   * Next lookup will trigger a fresh build.
   *
   * @param {string} companyId
   * @returns {Promise<void>}
   */
  async invalidate(companyId) {
    if (!companyId) return;

    const redis = _getRedis();
    if (!redis) return;

    try {
      await redis.del(_redisKey(companyId));
      logger.debug('[BridgeService] Cache invalidated', { companyId });
    } catch (err) {
      logger.warn('[BridgeService] invalidate error', { companyId, err: err.message });
    }
  },

  /**
   * getPhrasesForType — Return all trigger phrases for a daType.
   * Used by UtteranceActParser Layer 1 for phrase matching.
   *
   * @param {string} companyId
   * @param {string} daType
   * @returns {Promise<string[]>}
   */
  async getPhrasesForType(companyId, daType) {
    if (!companyId || !daType) return [];
    try {
      const bridge = await BridgeService.load(companyId);
      return bridge?.routes[daType]?.triggerPhrases || [];
    } catch (_e) {
      return [];
    }
  },

  /**
   * getAllPhrases — Return the full phrase index for all daTypes.
   * Used by UtteranceActParser to build its matching structure once per call.
   *
   * Returns: { [phrase]: daType }  (lowercased phrases, fastest for runtime lookup)
   *
   * @param {string} companyId
   * @returns {Promise<Object>} — { phrase: daType, ... }
   */
  async getAllPhrases(companyId) {
    if (!companyId) return {};
    try {
      const bridge = await BridgeService.load(companyId);
      if (!bridge?.routes) return {};

      const index = {};
      for (const [daType, route] of Object.entries(bridge.routes)) {
        for (const phrase of (route.triggerPhrases || [])) {
          index[phrase] = daType;
        }
      }
      return index;
    } catch (_e) {
      return {};
    }
  },

  /**
   * status — Debug/admin: return bridge metadata without full routes.
   * Used by discovery.html pipeline status API.
   *
   * @param {string} companyId
   * @returns {Promise<Object>}
   */
  async status(companyId) {
    if (!companyId) return { cached: false, routeCount: 0, containerCount: 0 };
    try {
      const bridge = await BridgeService.load(companyId);
      if (!bridge) return { cached: false, routeCount: 0, containerCount: 0 };
      return {
        cached:         true,
        builtAt:        bridge.builtAt,
        version:        bridge.version,
        routeCount:     bridge.routeCount,
        containerCount: Object.values(bridge.routes).reduce((s, r) => s + r.containers.length, 0),
        daTypes:        Object.keys(bridge.routes),
      };
    } catch (_e) {
      return { cached: false, routeCount: 0, containerCount: 0 };
    }
  },
};

module.exports = BridgeService;

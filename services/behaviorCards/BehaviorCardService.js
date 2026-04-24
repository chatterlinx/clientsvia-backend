'use strict';

/**
 * ============================================================================
 * BEHAVIOR CARD SERVICE
 * ============================================================================
 *
 * PURPOSE:
 *   Runtime retrieval of Behavior Cards (BC) — one per KC category.
 *   Each BC tells the KC answer path HOW to deliver the response:
 *   the tone, rules, and example responses Groq calibrates from.
 *
 * SCOPE (April 2026):
 *   Category-linked BCs only. The standalone BC variant + Engine Hub runtime
 *   were removed. Flow-level behavior (discovery, escalation, greeting,
 *   after-hours, mid-flow interrupt) now lives in
 *   `company.aiAgentSettings.llmAgent.behaviorRules[]` — edited in
 *   services.html Behavior tab and rendered on every LLM call.
 *
 * CACHING STRATEGY:
 *   HOT PATH  → Redis   key = behavior-card:{companyId}:category:{category}
 *                       TTL = 1 hour  (BC changes are admin-driven and infrequent)
 *   COLD PATH → MongoDB behaviorCards collection
 *
 *   Cache is invalidated immediately after any admin write (POST/PATCH/DELETE).
 *   The admin routes call invalidate() fire-and-forget after every write.
 *
 * GRACEFUL DEGRADE:
 *   Redis unavailable  → falls through to MongoDB, no error
 *   MongoDB returns null → returns null, engine continues without BC
 *   Engine behavior without BC: Groq responds using only KC content and
 *   discoveryNotes context — no BC behavior rules injected.
 *   Nothing breaks. Call continues.
 *
 * MULTI-TENANT SAFETY:
 *   Every Redis key includes companyId as the second segment.
 *   Every MongoDB query includes companyId as a required filter.
 *   No cross-tenant reads are possible through this service.
 *
 * USAGE:
 *   const BehaviorCardService = require('./behaviorCards/BehaviorCardService');
 *
 *   // For KC card delivery — load behavior for the card's category
 *   const bc = await BehaviorCardService.forCategory(companyId, 'Pricing & Trust');
 *
 *   // Format BC for injection into the Groq context package
 *   const block = BehaviorCardService.formatForGroq(bc);
 *
 *   // Invalidate cache after any admin write (fire-and-forget)
 *   BehaviorCardService.invalidate(companyId, 'Pricing & Trust')
 *     .catch(e => logger.warn('...', e));
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../redisClientFactory');
const BehaviorCard             = require('../../models/BehaviorCard');
const logger                   = require('../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  REDIS_TTL_SECONDS: 3600,           // 1 hour — BC edits are rare, long cache is safe
  KEY_PREFIX:        'behavior-card'  // Redis key prefix
};

// ============================================================================
// KEY BUILDERS  (multi-tenant safe — companyId always in key position 2)
// ============================================================================

/**
 * Build Redis key for a category-linked BC.
 * Format: behavior-card:{companyId}:category:{category}
 */
function _categoryKey(companyId, category) {
  return `${CONFIG.KEY_PREFIX}:${companyId}:category:${category}`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * forCategory — Load the Behavior Card that governs a KC category.
 *
 * Called by the KC answer path when delivering any KC card response.
 * The BC provides the tone rules, do/do-not rules, and example responses
 * that Groq uses to shape how the KC content is spoken.
 *
 * Returns null if no BC is configured for this category.
 * Engine continues without behavior rules — graceful degrade.
 *
 * @param  {string}          companyId   Required. Tenant scope.
 * @param  {string}          category    Must match KnowledgeContainer.category exactly.
 * @returns {Promise<Object|null>}
 */
async function forCategory(companyId, category) {
  if (!companyId || !category) {
    logger.warn('[BC SERVICE] forCategory: missing companyId or category — skipped');
    return null;
  }

  const key = _categoryKey(companyId, category);

  try {
    // ── Hot path: Redis ──────────────────────────────────────────────────────
    const redis = await getSharedRedisClient();
    if (redis) {
      const cached = await redis.get(key);
      if (cached) {
        logger.debug('[BC SERVICE] Cache hit — category', { companyId, category });
        return JSON.parse(cached);
      }
    }

    // ── Cold path: MongoDB ───────────────────────────────────────────────────
    const bc = await BehaviorCard.findForCategory(companyId, category);

    if (!bc) {
      logger.debug('[BC SERVICE] No BC configured for category', { companyId, category });
      return null;
    }

    // ── Warm Redis cache (fire-and-forget — never blocks response path) ──────
    if (redis) {
      redis.set(key, JSON.stringify(bc), { EX: CONFIG.REDIS_TTL_SECONDS })
        .catch(err => logger.warn('[BC SERVICE] Cache warm failed (non-fatal)', {
          companyId, category, error: err.message
        }));
    }

    logger.debug('[BC SERVICE] Loaded from MongoDB — category', { companyId, category });
    return bc;

  } catch (err) {
    logger.warn('[BC SERVICE] forCategory failed (non-fatal — graceful degrade)', {
      companyId, category, error: err.message
    });
    return null;
  }
}

/**
 * invalidate — Remove a BC from the Redis cache after an admin write.
 *
 * Called fire-and-forget by the admin API routes after any BC
 * POST, PATCH, or DELETE. Ensures the next read from MongoDB reflects
 * the admin's change rather than a stale cached value.
 *
 * @param  {string}  companyId   Tenant scope.
 * @param  {string}  category    KC category the BC governs.
 * @returns {Promise<void>}
 */
async function invalidate(companyId, category) {
  if (!companyId || !category) return;

  try {
    const redis = await getSharedRedisClient();
    if (!redis) return;

    const key = _categoryKey(companyId, category);
    await redis.del(key);
    logger.debug('[BC SERVICE] Cache invalidated', { companyId, category });

  } catch (err) {
    logger.warn('[BC SERVICE] invalidate failed (non-fatal)', {
      companyId, category, error: err.message
    });
  }
}

/**
 * formatForGroq — Format a BC document into the behavior block
 * that is injected into the Groq context package on every KC turn.
 *
 * This block tells Groq the tone, what to do, what not to do, and
 * provides example responses it uses to calibrate voice register and length.
 *
 * Returns empty string '' if bc is null — engine omits the block and Groq
 * responds using only KC content and discoveryNotes (graceful degrade).
 *
 * @param  {Object|null} bc   Behavior Card document (or null)
 * @returns {string}          Formatted behavior block ready for Groq injection
 */
function formatForGroq(bc) {
  if (!bc) return '';

  const lines   = [];
  const divider = '─'.repeat(63);

  lines.push(divider);
  lines.push(`BEHAVIOR RULES — ${bc.name}`);
  lines.push(divider);

  if (bc.tone) {
    lines.push(`TONE: ${bc.tone}`);
  }

  if (bc.rules?.do?.length > 0) {
    lines.push('\nDO:');
    bc.rules.do.forEach(rule => lines.push(`  ✓ ${rule}`));
  }

  if (bc.rules?.doNot?.length > 0) {
    lines.push('\nDO NOT:');
    bc.rules.doNot.forEach(rule => lines.push(`  ✗ ${rule}`));
  }

  if (bc.rules?.exampleResponses?.length > 0) {
    lines.push('\nEXAMPLE RESPONSES (calibrate your tone and length from these):');
    bc.rules.exampleResponses.forEach((ex, i) => lines.push(`  [${i + 1}] "${ex}"`));
  }

  lines.push(divider + '\n');

  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  forCategory,
  invalidate,
  formatForGroq,
  CONFIG
};

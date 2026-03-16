/**
 * ============================================================================
 * BOOKING TRIGGER MATCHER
 * ============================================================================
 *
 * Loads company booking triggers from MongoDB, filters them to the current
 * booking step, then delegates all keyword/phrase matching to the existing
 * TriggerCardMatcher — the same battle-tested engine used in Discovery.
 *
 * This service is intentionally thin. It owns:
 *   1. Loading + caching the booking trigger pool per company
 *   2. Filtering the pool to triggers relevant to the current step
 *   3. Returning the match result with booking-specific fields attached
 *
 * It does NOT own:
 *   - Keyword/phrase matching logic (TriggerCardMatcher does that)
 *   - Behavior execution (BookingLogicEngine does that)
 *   - Audio delivery (CallRuntime/TwiML layer does that)
 *
 * CACHE STRATEGY:
 *   In-memory Map, keyed by companyId, TTL = 60 seconds.
 *   Invalidated explicitly on any create/update/delete via invalidateCache().
 *   Identical pattern to TriggerService cache.
 *
 * 123RP PROVENANCE:
 *   When a booking trigger fires, lastPath = 'BOOKING_TRIGGER_MATCHED'.
 *   No match + normal step = 'BOOKING_STEP_{STEPNAME}'.
 *   LLM backup (future) = 'BOOKING_LLM_BACKUP'.
 *
 * ============================================================================
 */

'use strict';

const logger             = require('../../../utils/logger');
const { TriggerCardMatcher } = require('../agent2/TriggerCardMatcher');

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY CACHE
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS  = 60_000;   // 60 seconds — matches TriggerService TTL
const CACHE_MAX     = 500;       // Max companies in cache before LRU eviction

const _cache = new Map();        // key: companyId → { triggers: [], loadedAt: number }

// Simple LRU eviction: if cache exceeds max, delete oldest entry
function evictIfNeeded() {
  if (_cache.size > CACHE_MAX) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING TRIGGER MATCHER
// ─────────────────────────────────────────────────────────────────────────────

class BookingTriggerMatcher {

  // ── PUBLIC: match ──────────────────────────────────────────────────────────

  /**
   * Match caller input against the company's booking triggers for the current step.
   *
   * @param {string}      userInput    — The caller's raw utterance this turn
   * @param {string}      companyId    — Tenant company ID (isolation key)
   * @param {string}      currentStep  — Current STEPS value from BookingLogicEngine
   *                                     e.g. 'OFFER_TIMES', 'CONFIRM', 'ANY'
   * @returns {Promise<BookingTriggerMatchResult>}
   */
  static async match(userInput, companyId, currentStep) {

    // ── Load + cache the full booking trigger pool ─────────────────────────
    const allTriggers = await this._loadTriggers(companyId);

    // ── Filter to triggers active on this step ─────────────────────────────
    // A trigger fires if its firesOnSteps includes 'ANY' OR the current step.
    const stepPool = allTriggers.filter(t => {
      const steps = Array.isArray(t.firesOnSteps) ? t.firesOnSteps : ['ANY'];
      return steps.includes('ANY') || steps.includes(currentStep);
    });

    logger.debug('[BookingTriggerMatcher] Step pool built', {
      companyId,
      currentStep,
      totalTriggers: allTriggers.length,
      stepPoolSize:  stepPool.length
    });

    // ── Early-exit: no triggers eligible for this step ─────────────────────
    if (stepPool.length === 0) {
      return this._noMatch({ totalLoaded: allTriggers.length, stepPoolSize: 0, companyId, currentStep });
    }

    // ── Delegate matching to TriggerCardMatcher ────────────────────────────
    const matchResult = TriggerCardMatcher.match(userInput, stepPool);

    // ── No match ───────────────────────────────────────────────────────────
    if (!matchResult.matched) {
      logger.debug('[BookingTriggerMatcher] No trigger matched', {
        companyId,
        currentStep,
        stepPoolSize:  stepPool.length,
        evaluated:     matchResult.evaluated?.length || 0,
        inputPreview:  userInput?.substring(0, 60)
      });
      return {
        ...matchResult,
        behavior:      null,
        redirectMode:  null,
        stepPoolSize:  stepPool.length,
        totalLoaded:   allTriggers.length
      };
    }

    // ── Match found — attach booking-specific fields ───────────────────────
    const card = matchResult.card;

    logger.info('[BookingTriggerMatcher] ✅ Booking trigger matched', {
      companyId,
      currentStep,
      ruleId:       card.ruleId,
      label:        card.label,
      behavior:     card.behavior,
      redirectMode: card.redirectMode || null,
      matchType:    matchResult.matchType,
      matchedOn:    matchResult.matchedOn,
      inputPreview: userInput?.substring(0, 60)
    });

    return {
      ...matchResult,
      behavior:     card.behavior     || 'INFO',
      redirectMode: card.redirectMode || null,
      stepPoolSize: stepPool.length,
      totalLoaded:  allTriggers.length
    };
  }

  // ── PUBLIC: invalidateCache ────────────────────────────────────────────────

  /**
   * Flush the in-memory cache for a company.
   * MUST be called after any create / update / delete on CompanyBookingTrigger.
   *
   * @param {string} companyId
   */
  static invalidateCache(companyId) {
    const deleted = _cache.delete(companyId);
    logger.debug('[BookingTriggerMatcher] Cache invalidated', { companyId, wasPresent: deleted });
  }

  // ── PUBLIC: getPoolStats ───────────────────────────────────────────────────

  /**
   * Return pool health stats for a company — useful for the admin console
   * "test phrase" panel and for debugging missing-trigger issues.
   *
   * @param {string} companyId
   * @returns {Promise<Object>}
   */
  static async getPoolStats(companyId) {
    const triggers = await this._loadTriggers(companyId);
    return {
      total:    triggers.length,
      enabled:  triggers.filter(t => t.enabled !== false).length,
      byStep:   this._countByStep(triggers),
      byBehavior: {
        INFO:     triggers.filter(t => t.behavior === 'INFO').length,
        BLOCK:    triggers.filter(t => t.behavior === 'BLOCK').length,
        REDIRECT: triggers.filter(t => t.behavior === 'REDIRECT').length
      },
      cachedAt: _cache.get(companyId)?.loadedAt || null
    };
  }

  // ── PRIVATE: _loadTriggers ─────────────────────────────────────────────────

  /**
   * Load booking triggers from MongoDB with in-memory cache.
   * Returns TriggerCardMatcher-compatible format objects (plain objects, not Mongoose docs).
   *
   * @param {string} companyId
   * @returns {Promise<Array>}
   */
  static async _loadTriggers(companyId) {
    // Cache hit
    const cached = _cache.get(companyId);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      logger.debug('[BookingTriggerMatcher] Cache hit', {
        companyId,
        age: Math.round((Date.now() - cached.loadedAt) / 1000) + 's',
        count: cached.triggers.length
      });
      return cached.triggers;
    }

    // Cache miss — load from DB
    try {
      const CompanyBookingTrigger = require('../../models/CompanyBookingTrigger');

      const rawDocs = await CompanyBookingTrigger.findActiveByCompanyId(companyId);

      const triggers = rawDocs.map(doc =>
        CompanyBookingTrigger.formatForMatcher(doc)
      );

      evictIfNeeded();
      _cache.set(companyId, { triggers, loadedAt: Date.now() });

      logger.info('[BookingTriggerMatcher] Triggers loaded from DB', {
        companyId,
        count: triggers.length
      });

      return triggers;

    } catch (error) {
      logger.error('[BookingTriggerMatcher] Failed to load triggers — returning empty pool', {
        companyId,
        error: error.message
      });
      // Never crash the booking flow — return empty pool on DB error
      return [];
    }
  }

  // ── PRIVATE: _noMatch ─────────────────────────────────────────────────────

  static _noMatch({ totalLoaded, stepPoolSize, companyId, currentStep }) {
    return {
      matched:      false,
      card:         null,
      matchType:    null,
      matchedOn:    null,
      cardId:       null,
      cardLabel:    null,
      evaluated:    [],
      behavior:     null,
      redirectMode: null,
      totalLoaded,
      stepPoolSize,
      // Diagnostics
      _debug: { companyId, currentStep, reason: 'EMPTY_STEP_POOL' }
    };
  }

  // ── PRIVATE: _countByStep ─────────────────────────────────────────────────

  static _countByStep(triggers) {
    const counts = { ANY: 0, COLLECT_NAME: 0, COLLECT_PHONE: 0, COLLECT_ADDRESS: 0, OFFER_TIMES: 0, CONFIRM: 0 };
    for (const t of triggers) {
      const steps = Array.isArray(t.firesOnSteps) ? t.firesOnSteps : ['ANY'];
      for (const s of steps) {
        if (s in counts) counts[s]++;
      }
    }
    return counts;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { BookingTriggerMatcher };

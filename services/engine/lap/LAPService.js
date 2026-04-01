'use strict';

/**
 * ============================================================================
 * LAP SERVICE — ListenerActParser
 * ============================================================================
 *
 * PURPOSE:
 *   Pre-pipeline attention-signal detector.
 *   Fires on EVERY call turn, EVERY objective state, before ConversationEngine,
 *   KC, or BookingLogicEngine. Catches: connection distress, hold requests,
 *   repeat requests — and any custom groups the company defines.
 *
 * ARCHITECTURE:
 *   Two-layer keyword system:
 *     systemKeywords[]  — global, admin-managed in GlobalShare
 *     customKeywords[]  — per-company additions on top of system list
 *   Effective keywords = systemKeywords ∪ customKeywords  (merged at runtime)
 *
 *   Three built-in actions:
 *     'respond'     → play closedQuestion → Gather → normal pipeline resumes
 *     'hold'        → play hold message → silent Gather loop with dead-air timer
 *     'repeat_last' → read CallSummary.liveProgress.lastResponse → play it
 *
 * WIRE POINT:
 *   v2twilio.js  /v2-agent-respond  (after company load, before ConversationEngine)
 *   if (lapMatch?.matched) → return recovery TwiML immediately
 *
 * REDIS:
 *   globalHub:lapGroups           → system groups (no TTL, event-synced by admin)
 *   lap-config:{companyId}        → merged effective groups (TTL 1h)
 *   lap-hold:{companyId}:{callSid}→ hold loop state (TTL 5min)
 *
 * GRACEFUL DEGRADE:
 *   Redis unavailable → load from MongoDB directly, no cache
 *   Any error in match() → returns { matched: false } — call continues normally
 *
 * ============================================================================
 */

const logger              = require('../../../utils/logger');
const GlobalHubService    = require('../../GlobalHubService');
const { getSharedRedisClient } = require('../../redisClientFactory');

// ── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  CACHE_KEY_PREFIX:  'lap-config',
  HOLD_KEY_PREFIX:   'lap-hold',
  CACHE_TTL:         60 * 60,         // 1 hour — invalidated on PATCH lapConfig
  HOLD_TTL:          5  * 60,         // 5 min  — hold state clears after 5 min idle
  MAX_HOLD_CHECKINS: 3,               // max dead-air check-ins before force-resume
};

function _cacheKey(companyId) { return `${CONFIG.CACHE_KEY_PREFIX}:${companyId}`; }
function _holdKey(companyId, callSid) { return `${CONFIG.HOLD_KEY_PREFIX}:${companyId}:${callSid}`; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function _normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, '')   // strip punctuation except apostrophe
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * _textMatchesKeyword — check if a keyword appears in the transcript.
 * Keyword is matched as a whole word (or phrase) — not a substring of a larger word.
 */
function _textMatchesKeyword(normalizedText, keyword) {
  const kw = _normalize(keyword);
  if (!kw) return false;
  // Whole-word boundary match using word chars + spaces
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  return re.test(normalizedText);
}

// ── Core: effective group resolution ─────────────────────────────────────────

/**
 * getEffectiveGroups — build the runtime-ready group list for a company.
 *
 * Each group = {
 *   groupId, name, action, enabled,
 *   effectiveKeywords: Set<string>,   ← system + custom merged, normalized
 *   closedQuestion,
 *   holdConfig
 * }
 *
 * Result cached in Redis at lap-config:{companyId} for 1 hour.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
async function getEffectiveGroups(companyId) {
  if (!companyId) return [];

  const redis = await getSharedRedisClient().catch(() => null);
  const cacheKey = _cacheKey(companyId);

  // ── 1. Try cache ──────────────────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Restore Set from cached array
        return parsed.map(g => ({
          ...g,
          effectiveKeywords: new Set(g.effectiveKeywords || [])
        }));
      }
    } catch (_e) { /* fall through */ }
  }

  // ── 2. Load system groups from GlobalHub ──────────────────────────────────
  const systemGroups = await GlobalHubService.getLapGroups();

  // ── 3. Load company lapConfig ─────────────────────────────────────────────
  let companyGroups = [];
  try {
    const Company = require('../../../models/v2Company');
    const company = await Company.findById(companyId).select('lapConfig').lean();
    companyGroups = company?.lapConfig?.groups || [];
  } catch (err) {
    logger.warn('[LAPService] Could not load company lapConfig', { companyId, error: err.message });
  }

  // ── 4. Build company config map (groupId → company overrides) ─────────────
  const companyMap = new Map();
  for (const cg of companyGroups) {
    const key = cg.groupId || `custom:${cg.name}`;
    companyMap.set(key, cg);
  }

  // ── 5. Merge system groups with company overrides ─────────────────────────
  const effectiveGroups = [];

  for (const sg of systemGroups) {
    const override = companyMap.get(sg.id) || {};
    const enabled  = override.enabled !== false;  // default on

    // Merge keywords: system + company additions (normalized, deduped)
    const allKws = new Set([
      ...(sg.systemKeywords || []).map(_normalize),
      ...(override.customKeywords || []).map(_normalize)
    ]);
    allKws.delete('');  // remove empty strings

    effectiveGroups.push({
      groupId:          sg.id,
      name:             sg.name,
      action:           sg.action,
      enabled,
      effectiveKeywords: allKws,
      closedQuestion:   override.closedQuestion || sg.defaultClosedQuestion || null,
      holdConfig:       override.holdConfig     || sg.defaultHoldConfig     || null,
    });
  }

  // ── 6. Append custom groups (company-created, no system parent) ───────────
  for (const cg of companyGroups) {
    if (!cg.isCustom) continue;
    if (!cg.name || !cg.enabled) continue;

    const allKws = new Set((cg.customKeywords || []).map(_normalize));
    allKws.delete('');

    effectiveGroups.push({
      groupId:          null,
      name:             cg.name,
      action:           cg.action || 'respond',
      enabled:          true,
      effectiveKeywords: allKws,
      closedQuestion:   cg.closedQuestion || null,
      holdConfig:       cg.holdConfig     || null,
    });
  }

  // ── 7. Cache result (serialize Set → Array for JSON) ──────────────────────
  if (redis) {
    try {
      const serializable = effectiveGroups.map(g => ({
        ...g,
        effectiveKeywords: [...g.effectiveKeywords]
      }));
      await redis.set(cacheKey, JSON.stringify(serializable), { EX: CONFIG.CACHE_TTL });
    } catch (_e) { /* non-fatal */ }
  }

  return effectiveGroups;
}

// ── Core: match ───────────────────────────────────────────────────────────────

/**
 * match — check transcript against all enabled LAP groups for this company.
 *
 * Returns the first matching group result, or { matched: false }.
 * Any error → graceful degrade: { matched: false }.
 *
 * @param {string} companyId
 * @param {string} transcript  — raw STT text from Twilio
 * @returns {Promise<{ matched, groupId, name, action, closedQuestion, holdConfig }>}
 */
async function match(companyId, transcript) {
  try {
    if (!companyId || !transcript?.trim()) return { matched: false };

    const normalized = _normalize(transcript);
    if (!normalized) return { matched: false };

    const groups = await getEffectiveGroups(companyId);

    for (const group of groups) {
      if (!group.enabled) continue;
      if (!group.effectiveKeywords.size) continue;

      for (const kw of group.effectiveKeywords) {
        if (_textMatchesKeyword(normalized, kw)) {
          logger.info('[LAP] ✅ Match', {
            companyId,
            groupId: group.groupId,
            name:    group.name,
            action:  group.action,
            keyword: kw,
            transcript: transcript.substring(0, 80),
          });
          return {
            matched:        true,
            groupId:        group.groupId,
            name:           group.name,
            action:         group.action,
            closedQuestion: group.closedQuestion,
            holdConfig:     group.holdConfig,
          };
        }
      }
    }

    return { matched: false };

  } catch (err) {
    logger.warn('[LAP] match() error — graceful degrade (no interrupt)', {
      companyId, error: err.message
    });
    return { matched: false };
  }
}

// ── Hold state ────────────────────────────────────────────────────────────────

/**
 * setHoldState — write hold state to Redis when a hold-request fires.
 * @param {string} companyId
 * @param {string} callSid
 * @param {object} state  — { actionUrl, objective, holdConfig, checkInCount }
 */
async function setHoldState(companyId, callSid, state) {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return;
    await redis.set(
      _holdKey(companyId, callSid),
      JSON.stringify({ ...state, checkInCount: 0, startedAt: Date.now() }),
      { EX: CONFIG.HOLD_TTL }
    );
  } catch (err) {
    logger.warn('[LAP] setHoldState failed', { error: err.message });
  }
}

/**
 * getHoldState — load hold state for a call.
 * @returns {Promise<object|null>}
 */
async function getHoldState(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return null;
    const raw = await redis.get(_holdKey(companyId, callSid));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/**
 * incrementHoldCheckIn — bump checkInCount, refresh TTL.
 * @returns {Promise<number>} new checkInCount
 */
async function incrementHoldCheckIn(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return 1;
    const state = await getHoldState(companyId, callSid);
    if (!state) return 1;
    const updated = { ...state, checkInCount: (state.checkInCount || 0) + 1 };
    await redis.set(
      _holdKey(companyId, callSid),
      JSON.stringify(updated),
      { EX: CONFIG.HOLD_TTL }
    );
    return updated.checkInCount;
  } catch (err) {
    return 1;
  }
}

/**
 * clearHoldState — delete hold state (caller resumed or timed out).
 */
async function clearHoldState(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return;
    await redis.del(_holdKey(companyId, callSid));
  } catch (_e) { /* non-fatal */ }
}

// ── Cache invalidation ────────────────────────────────────────────────────────

/**
 * invalidate — clear the merged-group cache for a company.
 * Called when company PATCH /lap-config saves new settings.
 */
async function invalidate(companyId) {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return;
    await redis.del(_cacheKey(companyId));
    logger.debug('[LAPService] Cache invalidated', { companyId });
  } catch (err) {
    logger.warn('[LAPService] invalidate failed', { error: err.message });
  }
}

/**
 * invalidateAll — clear LAP cache for ALL companies (called when admin updates system keywords).
 * Uses Redis SCAN to find and delete all lap-config:* keys.
 */
async function invalidateAll() {
  try {
    const redis = await getSharedRedisClient().catch(() => null);
    if (!redis) return;
    const pattern = `${CONFIG.CACHE_KEY_PREFIX}:*`;
    let cursor = 0;
    let deleted = 0;
    do {
      const { cursor: next, keys } = await redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = next;
      if (keys.length) {
        await redis.del(keys);
        deleted += keys.length;
      }
    } while (cursor !== 0);
    logger.info('[LAPService] invalidateAll: cleared', { deleted });
  } catch (err) {
    logger.warn('[LAPService] invalidateAll failed', { error: err.message });
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // ── Runtime (called on every turn in v2twilio.js) ─────────────────────────
  match,

  // ── Hold state management ─────────────────────────────────────────────────
  setHoldState,
  getHoldState,
  incrementHoldCheckIn,
  clearHoldState,
  MAX_HOLD_CHECKINS: CONFIG.MAX_HOLD_CHECKINS,

  // ── Cache management ──────────────────────────────────────────────────────
  invalidate,           // called by PATCH /lap-config per company
  invalidateAll,        // called by PATCH /lap-groups (system keyword change)

  // ── Exposed for tests ─────────────────────────────────────────────────────
  getEffectiveGroups,
  _normalize,
  _textMatchesKeyword,
};

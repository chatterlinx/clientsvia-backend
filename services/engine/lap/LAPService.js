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
 *   repeat requests.
 *
 * ARCHITECTURE:
 *   Global phrase-response entries (AdminSettings.lapEntries).
 *   Each entry = one phrase + 1-3 response texts (rotated randomly).
 *   Audio is per-company (LAPResponseAudio model).
 *
 *   Three actions:
 *     'respond'     → play selected response → Gather → normal pipeline resumes
 *     'hold'        → play hold message → silent Gather loop with dead-air timer
 *     'repeat_last' → read CallSummary.liveProgress.lastResponse → play it
 *
 * WIRE POINT:
 *   v2twilio.js  /v2-agent-respond  (after company load, before ConversationEngine)
 *   if (lapMatch?.matched) → return recovery TwiML immediately
 *
 * REDIS:
 *   globalHub:lapEntries          → global entries (no TTL, event-synced by admin)
 *   lap-config:{companyId}        → cached enabled entries (TTL 1h)
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
  CACHE_TTL:         60 * 60,         // 1 hour — invalidated on settings change
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

// ── Core: effective entries resolution ───────────────────────────────────────

/**
 * getEffectiveEntries — build the runtime-ready entry list for a company.
 *
 * Loads global entries, filters by company enabled state.
 * Result cached in Redis at lap-config:{companyId} for 1 hour.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
async function getEffectiveEntries(companyId) {
  if (!companyId) return [];

  const redis = await getSharedRedisClient().catch(() => null);
  const cacheKey = _cacheKey(companyId);

  // ── 1. Try cache ──────────────────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_e) { /* fall through */ }
  }

  // ── 2. Load global entries from GlobalHub ─────────────────────────────────
  const allEntries = await GlobalHubService.getLapEntries();

  // ── 3. Filter: only enabled entries with non-empty phrase ─────────────────
  const effective = allEntries
    .filter(e => e.enabled !== false && e.phrase?.trim())
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  // ── 4. Cache result ───────────────────────────────────────────────────────
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(effective), { EX: CONFIG.CACHE_TTL });
    } catch (_e) { /* non-fatal */ }
  }

  return effective;
}

// ── Core: match ───────────────────────────────────────────────────────────────

/**
 * match — check transcript against all enabled LAP entries for this company.
 *
 * Returns the first matching entry result with a randomly selected response,
 * or { matched: false }. Any error → graceful degrade: { matched: false }.
 *
 * @param {string} companyId
 * @param {string} transcript  — raw STT text from Twilio
 * @returns {Promise<{ matched, entryId, phrase, action, response, holdConfig, audioHash }>}
 */
async function match(companyId, transcript) {
  try {
    if (!companyId || !transcript?.trim()) return { matched: false };

    const normalized = _normalize(transcript);
    if (!normalized) return { matched: false };

    const entries = await getEffectiveEntries(companyId);

    for (const entry of entries) {
      if (_textMatchesKeyword(normalized, entry.phrase)) {

        // ── TRAILING CONTENT GUARD (2026-04-16) ─────────────────────────
        // BUG FIX: "wait a minute, what about? How much is your service call?"
        // LAP matched "wait a minute" and swallowed the pricing question.
        //
        // Hold/respond actions should NOT intercept when there's substantive
        // content AFTER the matched phrase. "Wait a minute" followed by a
        // real question is a conversational pause, NOT a literal hold request.
        //
        // Guard: split at phrase position → check trailing content for
        // question words, substantive words, or significant length.
        // repeat_last is exempt — "can you repeat that, also I had a question"
        // still means repeat the last thing first.
        // ────────────────────────────────────────────────────────────────
        if (entry.action !== 'repeat_last') {
          const phraseNorm = _normalize(entry.phrase);
          const phraseIdx = normalized.indexOf(phraseNorm);
          if (phraseIdx >= 0) {
            const afterPhrase = normalized.substring(phraseIdx + phraseNorm.length).trim();

            // Strip filler words to see if there's real content after the phrase
            const stripped = afterPhrase
              .replace(/\b(um|uh|like|you know|well|so|and|but|oh|hmm|erm|ah)\b/g, '')
              .replace(/\s+/g, ' ')
              .trim();

            // Question indicators — caller is asking something, not requesting hold
            const hasQuestion = /\b(what|how|why|when|where|which|who|does|do you|can you|can i|is it|is there|is that|how much|how long|tell me|explain)\b/.test(stripped)
              || (transcript || '').includes('?');

            // Substantive trailing content (>4 real words after stripping fillers)
            const trailingWords = stripped.split(/\s+/).filter(Boolean);
            const hasSubstantiveTrailing = trailingWords.length > 4;

            if (hasQuestion || hasSubstantiveTrailing) {
              logger.info('[LAP] Trailing content guard — suppressing match (caller has more to say)', {
                companyId,
                entryId: entry.id,
                phrase:  entry.phrase,
                action:  entry.action,
                trailingWordCount: trailingWords.length,
                hasQuestion,
                trailingPreview: stripped.substring(0, 60),
                transcript: transcript.substring(0, 100),
              });
              continue;  // Skip this entry, try next (or fall through to no match)
            }
          }
        }

        // Pick random response from the list (if any)
        const responses = entry.responses || [];
        const response = responses.length > 0
          ? responses[Math.floor(Math.random() * responses.length)]
          : null;

        // Generate audioHash for pre-cached audio lookup
        let audioHash = null;
        if (response) {
          try {
            const crypto = require('crypto');
            audioHash = crypto.createHash('sha256').update(response.trim()).digest('hex');
          } catch (_e) { /* non-fatal */ }
        }

        logger.info('[LAP] Match', {
          companyId,
          entryId:  entry.id,
          phrase:   entry.phrase,
          action:   entry.action,
          keyword:  entry.phrase,
          response: response?.substring(0, 60),
          transcript: transcript.substring(0, 80),
        });

        return {
          matched:    true,
          entryId:    entry.id,
          phrase:     entry.phrase,
          action:     entry.action,
          response,
          holdConfig: entry.holdConfig || null,
          audioHash,
        };
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
 * invalidate — clear the cached entries for a company.
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
 * invalidateAll — clear LAP cache for ALL companies (called when admin updates global entries).
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
  invalidateAll,        // called by admin save (global entry change)

  // ── Exposed for tests ─────────────────────────────────────────────────────
  getEffectiveEntries,
  _normalize,
  _textMatchesKeyword,
};

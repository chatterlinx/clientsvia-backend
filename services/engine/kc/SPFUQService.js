'use strict';

/**
 * ============================================================================
 * SPFUQ SERVICE — Subject Pending Follow-Up Question
 * ============================================================================
 *
 * PURPOSE:
 *   Anchors an in-progress conversation to a specific Knowledge Container
 *   across turns. When a caller asks follow-up questions ("what does that
 *   include?" / "how about the gold plan?"), the KC engine picks up right
 *   where the last answer left off instead of re-matching from scratch.
 *
 *   Analogous to PFUQ (Pending Follow-Up Question) for booking consent, but
 *   for subject/topic continuity within a Knowledge Container dialogue.
 *
 * STORAGE:
 *   HOT PATH → Redis   key = spfuq:{companyId}:{callSid}   TTL = 4h
 *
 * MULTI-TENANT SAFETY:
 *   Every key is scoped by companyId. No cross-tenant leakage possible.
 *
 * GRACEFUL DEGRADE:
 *   Redis unavailable → all methods return null/void silently.
 *   KC engine continues without anchoring — no crash, no broken call.
 *
 * SCHEMA:
 *   {
 *     containerId:       String,   // container._id (or slug if no _id)
 *     containerTitle:    String,   // human-readable label for logs
 *     containerKeywords: String[], // keywords for topic-hop detection
 *     anchoredAt:        ISO,      // when the anchor was first set
 *     lastTurn:          Number,   // last turn that touched this anchor
 *     lastQuestion:      String,   // caller's last question in this topic
 *     lastAnswer:        String,   // Groq's last answer (clipped to 300 chars)
 *     subjectBrief:      String,   // 1-sentence running context injected into Groq
 *   }
 *
 * USAGE:
 *   const SPFUQService = require('./SPFUQService');
 *
 *   const spfuq = await SPFUQService.load(companyId, callSid);
 *   await SPFUQService.set(companyId, callSid, { containerId, containerTitle, ... });
 *   await SPFUQService.clear(companyId, callSid);
 *   const brief = SPFUQService.buildBrief(spfuq, newQuestion, newAnswer);
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../../redisClientFactory');
const logger                   = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  REDIS_TTL_SECONDS: 14400,  // 4 hours — matches call session max lifetime
  KEY_PREFIX:        'spfuq', // Redis key prefix: spfuq:{companyId}:{callSid}
  BRIEF_MAX_CHARS:   200,     // Cap on subjectBrief injected into Groq prompt
  ANSWER_MAX_CHARS:  300,     // Cap on lastAnswer stored in Redis
};

// ============================================================================
// KEY BUILDER  (multi-tenant safe)
// ============================================================================

function _buildKey(companyId, callSid) {
  return `${CONFIG.KEY_PREFIX}:${companyId}:${callSid}`;
}

// ============================================================================
// LOAD — Retrieve active SPFUQ anchor for this call
// ============================================================================

/**
 * load — Fetch the active subject anchor from Redis.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<Object|null>}  SPFUQ object, or null (no anchor / Redis down)
 */
async function load(companyId, callSid) {
  if (!companyId || !callSid) return null;

  const redis = await getSharedRedisClient();
  if (!redis) {
    logger.debug('[SPFUQ] Redis unavailable — anchor load skipped (graceful degrade)', { companyId, callSid });
    return null;
  }

  try {
    const raw = await redis.get(_buildKey(companyId, callSid));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('[SPFUQ] Load error', { companyId, callSid, err: err.message });
    return null;
  }
}

// ============================================================================
// SET — Write or update the SPFUQ anchor
// ============================================================================

/**
 * set — Persist the subject anchor to Redis.
 * Fire-and-forget safe — never await in the hot call path.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {Object} spfuq   — Partial or full SPFUQ schema
 * @returns {Promise<void>}
 */
async function set(companyId, callSid, spfuq) {
  if (!companyId || !callSid || !spfuq) return;

  const redis = await getSharedRedisClient();
  if (!redis) {
    logger.debug('[SPFUQ] Redis unavailable — anchor set skipped (graceful degrade)', { companyId, callSid });
    return;
  }

  try {
    const record = {
      containerId:       spfuq.containerId        || '',
      containerTitle:    spfuq.containerTitle      || '',
      containerKeywords: spfuq.containerKeywords   || [],
      anchoredAt:        spfuq.anchoredAt          || new Date().toISOString(),
      lastTurn:          spfuq.lastTurn            ?? 0,
      lastQuestion:      spfuq.lastQuestion        || '',
      lastAnswer:        (spfuq.lastAnswer         || '').slice(0, CONFIG.ANSWER_MAX_CHARS),
      subjectBrief:      (spfuq.subjectBrief       || '').slice(0, CONFIG.BRIEF_MAX_CHARS),
    };
    await redis.set(_buildKey(companyId, callSid), JSON.stringify(record), { EX: CONFIG.REDIS_TTL_SECONDS });
    logger.debug('[SPFUQ] Anchor set', { companyId, callSid, containerId: record.containerId, containerTitle: record.containerTitle });
  } catch (err) {
    logger.warn('[SPFUQ] Set error', { companyId, callSid, err: err.message });
  }
}

// ============================================================================
// CLEAR — Erase the anchor (topic change, booking, call end)
// ============================================================================

/**
 * clear — Delete the SPFUQ anchor for this call.
 * Called on: topic hop, booking intent, caller goodbye.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<void>}
 */
async function clear(companyId, callSid) {
  if (!companyId || !callSid) return;

  const redis = await getSharedRedisClient();
  if (!redis) return;

  try {
    await redis.del(_buildKey(companyId, callSid));
    logger.debug('[SPFUQ] Anchor cleared', { companyId, callSid });
  } catch (err) {
    logger.warn('[SPFUQ] Clear error', { companyId, callSid, err: err.message });
  }
}

// ============================================================================
// BUILD BRIEF — Derive a 1-sentence running context summary
// ============================================================================

/**
 * buildBrief — Compose the subjectBrief that will be injected into the
 * next Groq prompt as prior-context. Called AFTER a successful KC answer.
 *
 * Format: "Caller asked about {title}. Last Q: '{question}' A: '{answer}'"
 * Capped at BRIEF_MAX_CHARS to keep Groq prompts tight.
 *
 * @param {Object} spfuq       — existing SPFUQ object (or null for first turn)
 * @param {string} newQuestion — caller's latest question
 * @param {string} newAnswer   — Groq's latest answer
 * @returns {string}           — brief string for storage
 */
function buildBrief(spfuq, newQuestion, newAnswer) {
  const title = spfuq?.containerTitle || 'this topic';
  const q     = (newQuestion || '').trim().slice(0, 80);
  const a     = (newAnswer   || '').trim().slice(0, 100);
  const brief = `Caller asked about ${title}. Last Q: "${q}" A: "${a}"`;
  return brief.slice(0, CONFIG.BRIEF_MAX_CHARS);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  load,
  set,
  clear,
  buildBrief,
};

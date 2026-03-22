'use strict';

/**
 * ============================================================================
 * DISCOVERY NOTES SERVICE
 * ============================================================================
 *
 * PURPOSE:
 * Maintains live in-call state per turn so the LLM always knows:
 *   - What entities were captured (name, address, issue, urgency)
 *   - What was already asked (doNotReask[])
 *   - What the current objective is (INTAKE / DISCOVERY / BOOKING / etc.)
 *   - A running Q&A log (qaLog[])
 *
 * STORAGE:
 *   HOT PATH  → Redis   key = discovery-notes:{companyId}:{callSid}   TTL = 4h
 *   DURABLE   → MongoDB Customer.discoveryNotes[]
 *               - fire-and-forget mid-call (durability checkpoint)
 *               - full $push write at call end via persist()
 *
 * MULTI-TENANT SAFETY:
 *   Every Redis key and MongoDB write is scoped by companyId.
 *   Key format: discovery-notes:{companyId}:{callSid}
 *
 * GRACEFUL DEGRADE:
 *   If Redis is unavailable, all methods return null and the call continues
 *   normally. The LLM system prompt will simply omit the DISCOVERY STATE block.
 *   Nothing breaks.
 *
 * USAGE:
 *   const DiscoveryNotesService = require('./discoveryNotes/DiscoveryNotesService');
 *
 *   // Call start (turn 1)
 *   const notes = await DiscoveryNotesService.init(companyId, callSid, customerId);
 *
 *   // Subsequent turns
 *   const notes = await DiscoveryNotesService.load(companyId, callSid);
 *
 *   // After LLM responds (fire-and-forget, never await in hot path)
 *   DiscoveryNotesService.update(companyId, callSid, patch).catch(e => log(e));
 *
 *   // LLM prompt injection
 *   const block = DiscoveryNotesService.formatForLLM(notes);
 *
 *   // Call end (status-callback, non-blocking)
 *   await DiscoveryNotesService.persist(companyId, callSid, customerId);
 *   await DiscoveryNotesService.purge(companyId, callSid);
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../redisClientFactory');
const Customer = require('../../models/Customer');
const logger = require('../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  REDIS_TTL_SECONDS: 14400,      // 4 hours — matches max call session TTL
  KEY_PREFIX: 'discovery-notes', // Redis key prefix
  CURRENT_VERSION: 1,            // Schema version — increment on breaking changes
  QA_LOG_PROMPT_LIMIT: 3         // Max recent Q&A entries injected into LLM prompt
};

// ============================================================================
// KEY BUILDER  (multi-tenant safe — companyId always in key)
// ============================================================================

function _buildKey(companyId, callSid) {
  return `${CONFIG.KEY_PREFIX}:${companyId}:${callSid}`;
}

// ============================================================================
// EMPTY NOTES FACTORY
// ============================================================================

function _buildEmptyNotes(companyId, callSid, customerId = null) {
  const now = new Date().toISOString();
  return {
    version: CONFIG.CURRENT_VERSION,
    companyId: String(companyId),
    callSid: String(callSid),
    customerId: customerId ? String(customerId) : null,

    // ── Captured entities ───────────────────────────────────────────────────
    entities: {
      firstName: null,
      lastName: null,
      fullName: null,
      address: null,
      phone: null,
      email: null,
      confidence: {}   // { firstName: 0.95, address: 0.9 }
    },

    // ── Call understanding ──────────────────────────────────────────────────
    callReason: null,
    urgency: null,       // 'low' | 'medium' | 'high'
    priorVisit: null,    // boolean

    // ── In-call state machine ───────────────────────────────────────────────
    // INTAKE     → gathering name / address / issue
    // DISCOVERY  → clarifying or enriching (equipment, urgency, etc.)
    // BOOKING    → scheduling appointment
    // TRANSFER   → routing to human agent
    // CLOSING    → wrapping up confirmed booking / resolution
    objective: 'INTAKE',
    turnNumber: 0,
    doNotReask: [],           // field names already captured — anti-amnesia core
    lastMeaningfulInput: null,

    // ── Q&A log ─────────────────────────────────────────────────────────────
    // { turn: Number, question: String, answer: String|null, timestamp: ISO }
    qaLog: [],

    // ── Digression stack ─────────────────────────────────────────────────────
    // Pushed when a caller asks an off-topic question (e.g. "do you have any
    // specials?") mid-flow.  The interceptor saves exactly where the call was,
    // answers the question, then pops the stack to resume cleanly.
    //
    // Each entry shape:
    // {
    //   digressionType:  'PROMOTIONS_QUERY',          // type of digression
    //   digressionOrigin: 'DISCOVERY' | 'BOOKING',    // where the call was when it fired
    //   savedStep:        'COLLECT_PREFERRED_TIME',    // BookingLogicEngine step (BOOKING only)
    //   savedContext:     { preferredDay: 'Monday' },  // snapshot of live ctx (BOOKING only)
    //   returnPrompt:     'What time works for Monday?', // exact re-ask (BOOKING only)
    //   timestamp:        ISO string
    // }
    digressionStack: [],

    // ── Timestamps ──────────────────────────────────────────────────────────
    startedAt: now,
    updatedAt: now
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * init — Create empty discoveryNotes in Redis at call start (turn 1 only).
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string|null} customerId
 * @returns {Promise<Object|null>}  New notes object, or null if Redis unavailable
 */
async function init(companyId, callSid, customerId = null) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] Redis unavailable — init skipped (graceful degrade)', { callSid });
      return null;
    }

    const key = _buildKey(companyId, callSid);
    const notes = _buildEmptyNotes(companyId, callSid, customerId);

    await redis.set(key, JSON.stringify(notes), { EX: CONFIG.REDIS_TTL_SECONDS });

    // BUG-12 FIX: Push stub entry to MongoDB immediately so _persistToMongoFireAndForget
    // can $set in-place during the call (previously it was always a no-op because the
    // entry didn't exist until persist() ran at call end).
    if (customerId) {
      _initMongoStubFireAndForget(notes);
    }

    logger.info('[DISCOVERY NOTES] ✅ Initialized', {
      callSid,
      companyId: String(companyId),
      customerId: customerId ? String(customerId) : null
    });
    return notes;

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] init failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * load — Load current notes from Redis.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<Object|null>}  Notes object, or null if not found / Redis unavailable
 */
async function load(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] Redis unavailable — load skipped (graceful degrade)', { callSid });
      return null;
    }

    const key = _buildKey(companyId, callSid);
    const raw = await redis.get(key);
    if (!raw) return null;

    return JSON.parse(raw);

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] load failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * update — Merge patch into notes, write back to Redis, fire-and-forget MongoDB.
 *
 * CRITICAL: Never await this in the hot response path.
 * Caller pattern:
 *   DiscoveryNotesService.update(companyId, callSid, patch).catch(e => log(e));
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {Object} patch   Partial notes fields to merge
 * @returns {Promise<Object|null>}  Updated notes, or null on failure
 */
async function update(companyId, callSid, patch) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] Redis unavailable — update skipped (graceful degrade)', { callSid });
      return null;
    }

    const key = _buildKey(companyId, callSid);
    const raw = await redis.get(key);
    if (!raw) {
      logger.warn('[DISCOVERY NOTES] update: key not found in Redis — cannot merge', { callSid, key });
      return null;
    }

    const current = JSON.parse(raw);
    const updated = _mergePatch(current, patch);
    updated.updatedAt = new Date().toISOString();

    await redis.set(key, JSON.stringify(updated), { EX: CONFIG.REDIS_TTL_SECONDS });

    // Fire-and-forget MongoDB durability checkpoint (never awaited)
    if (updated.customerId) {
      _persistToMongoFireAndForget(updated);
    }

    return updated;

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] update failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * persist — Final authoritative write to Customer.discoveryNotes at call end.
 * This IS awaited — it runs in the status-callback handler, not the hot path.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string} customerId   Required: final resolved customerId
 * @returns {Promise<boolean>}
 */
async function persist(companyId, callSid, customerId) {
  try {
    if (!customerId) {
      logger.warn('[DISCOVERY NOTES] persist: no customerId — skipping MongoDB write', { callSid });
      return false;
    }

    const notes = await load(companyId, callSid);
    if (!notes) {
      logger.warn('[DISCOVERY NOTES] persist: notes not found in Redis — nothing to persist', { callSid });
      return false;
    }

    // BUG-12 FIX: Use $set with arrayFilters (not $push) since init() already pushed
    // the stub entry. This overwrites the stub with final data without duplicating it.
    const result = await Customer.updateOne(
      { _id: customerId, companyId, 'discoveryNotes.callSid': callSid },
      {
        $set: {
          'discoveryNotes.$[elem].entities':   notes.entities || {},
          'discoveryNotes.$[elem].callReason': notes.callReason || null,
          'discoveryNotes.$[elem].urgency':    notes.urgency || null,
          'discoveryNotes.$[elem].objective':  notes.objective || 'INTAKE',
          'discoveryNotes.$[elem].turnCount':  notes.turnNumber || 0,
          'discoveryNotes.$[elem].qaLog':      notes.qaLog || [],
          'discoveryNotes.$[elem].updatedAt':  new Date()
        }
      },
      { arrayFilters: [{ 'elem.callSid': callSid }] }
    );

    // Fallback: if no stub found (e.g. init() was skipped due to no customerId at call start),
    // $push the full record now so we never lose data.
    if (result.matchedCount === 0) {
      await Customer.updateOne(
        { _id: customerId, companyId },
        {
          $push: {
            discoveryNotes: {
              callSid,
              capturedAt: new Date(),
              entities: notes.entities || {},
              callReason: notes.callReason || null,
              urgency: notes.urgency || null,
              objective: notes.objective || 'INTAKE',
              turnCount: notes.turnNumber || 0,
              qaLog: notes.qaLog || [],
              startedAt: notes.startedAt || null,
              updatedAt: new Date()
            }
          }
        }
      );
    }

    logger.info('[DISCOVERY NOTES] ✅ Persisted to Customer.discoveryNotes', {
      callSid,
      customerId: String(customerId),
      objective: notes.objective,
      turns: notes.turnNumber
    });
    return true;

  } catch (err) {
    logger.error('[DISCOVERY NOTES] persist failed (non-fatal)', { callSid, error: err.message });
    return false;
  }
}

/**
 * formatForLLM — Returns the formatted string block injected into the system prompt.
 * Costs ~150-200 tokens depending on entities and qaLog length.
 *
 * @param {Object|null} notes
 * @returns {string}  Empty string if notes is null/invalid (graceful degrade)
 */
function formatForLLM(notes) {
  if (!notes) return '';

  const lines = [];
  const divider = '─'.repeat(63);

  lines.push(divider);
  lines.push('CALL DISCOVERY STATE (live — built turn by turn)');
  lines.push(divider);
  lines.push(`OBJECTIVE : ${notes.objective}`);
  lines.push(`TURN      : ${notes.turnNumber}`);

  // ── Captured entities ────────────────────────────────────────────────────
  lines.push('\nCAPTURED SO FAR:');
  const e = notes.entities || {};
  lines.push(`  name    : ${e.fullName || e.firstName || '(not yet captured)'}`);
  lines.push(`  address : ${e.address || '(not yet captured)'}`);
  lines.push(`  phone   : ${e.phone || '(not yet captured)'}`);

  if (notes.callReason) lines.push(`  issue   : ${notes.callReason}`);
  if (notes.urgency)    lines.push(`  urgency : ${notes.urgency}`);
  if (notes.priorVisit !== null && notes.priorVisit !== undefined) {
    lines.push(`  prior visit : ${notes.priorVisit ? 'yes' : 'no'}`);
  }

  // ── Anti-amnesia core ────────────────────────────────────────────────────
  if (notes.doNotReask && notes.doNotReask.length > 0) {
    lines.push(`\nDO NOT RE-ASK : ${notes.doNotReask.join(', ')}`);
    lines.push('  (already answered — asking again frustrates the caller)');
  }

  // ── Last meaningful input ────────────────────────────────────────────────
  if (notes.lastMeaningfulInput) {
    lines.push(`\nCALLER LAST SAID : "${notes.lastMeaningfulInput}"`);
  }

  // ── Recent Q&A (token-budgeted to last N entries) ────────────────────────
  if (notes.qaLog && notes.qaLog.length > 0) {
    const recent = notes.qaLog.slice(-CONFIG.QA_LOG_PROMPT_LIMIT);
    lines.push('\nRECENT Q&A:');
    for (const entry of recent) {
      lines.push(`  [T${entry.turn}] Q: ${entry.question}`);
      if (entry.answer) {
        lines.push(`         A: ${entry.answer}`);
      } else {
        lines.push(`         A: (no answer yet)`);
      }
    }
  }

  // ── Standing rules for LLM ──────────────────────────────────────────────
  lines.push(`\n${divider}`);
  lines.push('RULES:');
  lines.push('• NEVER ask for anything listed in DO NOT RE-ASK — it is already known.');
  lines.push('• Treat CAPTURED data as confirmed fact — do not re-verify unless caller corrects it.');
  lines.push('• Advance OBJECTIVE when current stage is complete. BOOKING when caller is ready to schedule.');
  lines.push(`${divider}\n`);

  return lines.join('\n');
}

/**
 * purge — Delete Redis key after call-end persist completes.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<void>}
 */
async function purge(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) return;
    const key = _buildKey(companyId, callSid);
    await redis.del(key);
    logger.info('[DISCOVERY NOTES] Purged from Redis', { callSid });
  } catch (err) {
    logger.warn('[DISCOVERY NOTES] purge failed (non-fatal)', { callSid, error: err.message });
  }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * _mergePatch — Deep merge a patch into the current notes object.
 *
 * Merge rules:
 *   - Scalar fields  : patch value wins if defined and non-null
 *   - entities{}     : deep merge — only defined keys in patch.entities override
 *   - doNotReask[]   : union (dedup) of both arrays
 *   - qaLog[]        : append new entries from patch
 *
 * @param {Object} current
 * @param {Object} patch
 * @returns {Object}  New merged notes object (does not mutate inputs)
 */
function _mergePatch(current, patch) {
  const merged = { ...current };

  // ── Scalar fields ────────────────────────────────────────────────────────
  const SCALAR_FIELDS = [
    'callReason', 'urgency', 'priorVisit',
    'objective', 'turnNumber', 'lastMeaningfulInput'
  ];
  for (const field of SCALAR_FIELDS) {
    if (patch[field] !== undefined && patch[field] !== null) {
      merged[field] = patch[field];
    }
  }

  // ── Deep merge entities ──────────────────────────────────────────────────
  if (patch.entities) {
    merged.entities = { ...(current.entities || {}) };
    for (const [k, v] of Object.entries(patch.entities)) {
      if (k === 'confidence') continue; // handled separately below
      if (v !== undefined && v !== null) {
        merged.entities[k] = v;
      }
    }
    if (patch.entities.confidence) {
      merged.entities.confidence = {
        ...(current.entities?.confidence || {}),
        ...patch.entities.confidence
      };
    }
  }

  // ── doNotReask: union/dedup ──────────────────────────────────────────────
  if (Array.isArray(patch.doNotReask) && patch.doNotReask.length > 0) {
    const existing = new Set(current.doNotReask || []);
    for (const field of patch.doNotReask) existing.add(field);
    merged.doNotReask = [...existing];
  }

  // ── qaLog: append ────────────────────────────────────────────────────────
  if (Array.isArray(patch.qaLog) && patch.qaLog.length > 0) {
    merged.qaLog = [...(current.qaLog || []), ...patch.qaLog];
  }

  return merged;
}

/**
 * _initMongoStubFireAndForget — Push an empty stub entry at call start.
 *
 * Called once by init() so _persistToMongoFireAndForget can $set in-place
 * throughout the call rather than being a no-op (BUG-12).
 *
 * NEVER await this function. It is intentionally fire-and-forget.
 */
function _initMongoStubFireAndForget(notes) {
  Customer.updateOne(
    { _id: notes.customerId, companyId: notes.companyId },
    {
      $push: {
        discoveryNotes: {
          callSid:    notes.callSid,
          capturedAt: new Date(),
          entities:   notes.entities || {},
          callReason: null,
          urgency:    null,
          objective:  'INTAKE',
          turnCount:  0,
          qaLog:      [],
          startedAt:  notes.startedAt || null,
          updatedAt:  new Date()
        }
      }
    },
    { upsert: false }
  ).catch(err => {
    logger.warn('[DISCOVERY NOTES] MongoDB init stub failed (non-fatal)', {
      callSid: notes.callSid,
      error: err.message
    });
  });
}

/**
 * _persistToMongoFireAndForget — Mid-call durability checkpoint.
 *
 * Updates the stub entry pushed by _initMongoStubFireAndForget in-place.
 * Uses arrayFilters positional $set — safe, never duplicates.
 * Stub must already exist (created by init() → _initMongoStubFireAndForget).
 *
 * NEVER await this function. It is intentionally fire-and-forget.
 */
function _persistToMongoFireAndForget(notes) {
  Customer.updateOne(
    { _id: notes.customerId, companyId: notes.companyId },
    {
      $set: {
        'discoveryNotes.$[elem].entities': notes.entities,
        'discoveryNotes.$[elem].callReason': notes.callReason,
        'discoveryNotes.$[elem].urgency': notes.urgency,
        'discoveryNotes.$[elem].objective': notes.objective,
        'discoveryNotes.$[elem].turnCount': notes.turnNumber,
        'discoveryNotes.$[elem].updatedAt': new Date()
      }
    },
    {
      arrayFilters: [{ 'elem.callSid': notes.callSid }],
      upsert: false
    }
  ).catch(err => {
    logger.warn('[DISCOVERY NOTES] Mid-call MongoDB checkpoint failed (non-fatal)', {
      callSid: notes.callSid,
      error: err.message
    });
  });
}

// ============================================================================
// DIGRESSION STACK HELPERS
// ============================================================================

/**
 * pushDigression — Save current call position before answering an off-topic
 * question (e.g. a promotions query mid-booking or mid-discovery).
 *
 * CALLER PATTERN (fire-and-forget — never await in the hot path):
 *   DiscoveryNotesService.pushDigression(companyId, callSid, data).catch(e => log(e));
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {Object} digressionData  — shape documented in _buildEmptyNotes.digressionStack
 * @returns {Promise<Object|null>}  Updated notes, or null on failure
 */
async function pushDigression(companyId, callSid, digressionData) {
  if (!digressionData || !digressionData.digressionType) {
    logger.warn('[DISCOVERY NOTES] pushDigression: missing digressionType — skipped', { callSid });
    return null;
  }

  const entry = {
    digressionType:    digressionData.digressionType,
    digressionOrigin:  digressionData.digressionOrigin  || 'DISCOVERY',
    savedStep:         digressionData.savedStep         || null,
    savedContext:      digressionData.savedContext       || {},
    returnPrompt:      digressionData.returnPrompt      || null,
    timestamp:         new Date().toISOString()
  };

  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] pushDigression: Redis unavailable — skipped (graceful degrade)', { callSid });
      return null;
    }

    const key = _buildKey(companyId, callSid);
    const raw = await redis.get(key);
    if (!raw) {
      logger.warn('[DISCOVERY NOTES] pushDigression: key not found — cannot push', { callSid, key });
      return null;
    }

    const current = JSON.parse(raw);
    const updated = { ...current };
    updated.digressionStack = [...(current.digressionStack || []), entry];
    updated.updatedAt = new Date().toISOString();

    await redis.set(key, JSON.stringify(updated), { EX: CONFIG.REDIS_TTL_SECONDS });

    logger.info('[DISCOVERY NOTES] ✅ Digression pushed', {
      callSid,
      digressionType:   entry.digressionType,
      digressionOrigin: entry.digressionOrigin,
      savedStep:        entry.savedStep,
      stackDepth:       updated.digressionStack.length
    });

    return updated;

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] pushDigression failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * popDigression — Retrieve and remove the most recent digression entry.
 * Called after the agent has answered the off-topic question and the caller
 * is ready to resume the original flow.
 *
 * Returns the popped entry (or null if stack was empty / Redis unavailable).
 * The caller uses entry.digressionOrigin to decide the return path:
 *   DISCOVERY → fire FUC ("Would you like to get scheduled?")
 *   BOOKING   → resume at entry.savedStep with entry.returnPrompt
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<Object|null>}  The popped digressionStack entry, or null
 */
async function popDigression(companyId, callSid) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] popDigression: Redis unavailable — skipped (graceful degrade)', { callSid });
      return null;
    }

    const key = _buildKey(companyId, callSid);
    const raw = await redis.get(key);
    if (!raw) {
      logger.warn('[DISCOVERY NOTES] popDigression: key not found', { callSid, key });
      return null;
    }

    const current = JSON.parse(raw);
    const stack   = current.digressionStack || [];

    if (stack.length === 0) {
      logger.info('[DISCOVERY NOTES] popDigression: stack already empty', { callSid });
      return null;
    }

    // Pop from the end (LIFO — supports nested digressions in the future)
    const popped  = stack[stack.length - 1];
    const updated = { ...current };
    updated.digressionStack = stack.slice(0, -1);
    updated.updatedAt       = new Date().toISOString();

    await redis.set(key, JSON.stringify(updated), { EX: CONFIG.REDIS_TTL_SECONDS });

    logger.info('[DISCOVERY NOTES] ✅ Digression popped', {
      callSid,
      digressionType:   popped.digressionType,
      digressionOrigin: popped.digressionOrigin,
      savedStep:        popped.savedStep,
      stackDepthAfter:  updated.digressionStack.length
    });

    return popped;

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] popDigression failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * peekDigression — Read the top of the stack without removing it.
 * Used by the return-path router to decide BEFORE committing to the action.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @returns {Promise<Object|null>}  Top entry, or null if empty / unavailable
 */
async function peekDigression(companyId, callSid) {
  try {
    const notes = await load(companyId, callSid);
    if (!notes) return null;
    const stack = notes.digressionStack || [];
    return stack.length > 0 ? stack[stack.length - 1] : null;
  } catch (err) {
    logger.warn('[DISCOVERY NOTES] peekDigression failed (non-fatal)', { callSid, error: err.message });
    return null;
  }
}

/**
 * updateDigressionTop — Partially update the top stack entry in-place.
 *
 * Used by the promotions clarification flow to transition state on the top
 * entry without popping + re-pushing (e.g. AWAITING_COUPON_INTENT →
 * AWAITING_COUPON_CODE once the caller confirms they have a coupon).
 *
 * Performs a shallow merge: only the keys in `updates` are changed.
 * All other top-entry fields are preserved.
 *
 * Graceful degrade: if Redis unavailable or stack is empty, returns null
 * and the call continues. Never throws.
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {Object} updates   Partial fields to merge into the top entry
 * @returns {Promise<Object|null>}  The updated top entry, or null
 */
async function updateDigressionTop(companyId, callSid, updates) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) {
      logger.warn('[DISCOVERY NOTES] updateDigressionTop: Redis unavailable — skipped', { callSid });
      return null;
    }

    const key = `${CONFIG.REDIS_KEY_PREFIX}:${companyId}:${callSid}`;
    const raw = await redis.get(key);
    if (!raw) {
      logger.warn('[DISCOVERY NOTES] updateDigressionTop: key not found', { callSid, key });
      return null;
    }

    const notes   = JSON.parse(raw);
    const stack   = notes.digressionStack || [];

    if (stack.length === 0) {
      logger.warn('[DISCOVERY NOTES] updateDigressionTop: stack is empty — skipped', { callSid });
      return null;
    }

    // Shallow merge updates into the top entry
    stack[stack.length - 1] = { ...stack[stack.length - 1], ...updates, updatedAt: new Date().toISOString() };
    notes.digressionStack   = stack;

    await redis.set(key, JSON.stringify(notes), { KEEPTTL: true });

    logger.debug('[DISCOVERY NOTES] updateDigressionTop applied', {
      callSid,
      updates: Object.keys(updates),
      newTop: stack[stack.length - 1]
    });

    return stack[stack.length - 1];

  } catch (err) {
    logger.warn('[DISCOVERY NOTES] updateDigressionTop failed (non-fatal)', {
      callSid, error: err.message
    });
    return null;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  init,
  load,
  update,
  persist,
  formatForLLM,
  purge,
  pushDigression,
  popDigression,
  peekDigression,
  updateDigressionTop,
  CONFIG
};

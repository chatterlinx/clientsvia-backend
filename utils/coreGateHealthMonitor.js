'use strict';

/**
 * ============================================================================
 * COREGATE HEALTH MONITOR — UAP Logic 2 three-tier judge observability
 * ============================================================================
 *
 * Surface the live state of the UAP Logic 2 core gate at `/health/coregate`:
 *
 *   • circuit breaker state (open/closed, expiresAt, failure count)
 *   • decision breakdown over the last 24h
 *       strict_pass / definite_fail / judge_pass / judge_fail
 *       judge_skipped / judge_error_fallback / legacy_fallback / no_embeddings
 *   • judge call rate, latency p50/p95/p99, cache hit rate
 *   • most recent judge error (code, message, when)
 *
 * Pattern mirrors utils/memoryMonitor.js + utils/cuePhrasesDriftMonitor.js:
 *   - Pure telemetry. Never blocks, never mutates, never throws.
 *   - Read-only against CallTranscriptV2 + the breaker module's getState().
 *   - Aggregations capped at the last 24h to bound query cost.
 *   - Multi-tenant safe — aggregates across all tenants by default; an
 *     optional `?companyId=` query parameter scopes a single tenant's view.
 *
 * MOUNT
 * -----
 *   const { healthCoreGateHandler } = require('./utils/coreGateHealthMonitor');
 *   app.get('/health/coregate', healthCoreGateHandler);
 *
 * ============================================================================
 */

const logger = require('./logger');

// Lazy-loaded to avoid load-order issues at startup.
let CallTranscriptV2 = null;
let CoreGateJudgeCircuitBreaker = null;
function _loadDeps() {
  if (!CallTranscriptV2) {
    try { CallTranscriptV2 = require('../models/CallTranscriptV2'); } catch (_e) { /* boot order */ }
  }
  if (!CoreGateJudgeCircuitBreaker) {
    try { CoreGateJudgeCircuitBreaker = require('../services/engine/kc/CoreGateJudgeCircuitBreaker'); } catch (_e) { /* boot order */ }
  }
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Decision keys we expect from KCDiscoveryRunner Logic 2. Listed here so an
// unknown / future decision string still shows up in the breakdown under
// `_other` rather than getting silently dropped.
const KNOWN_DECISIONS = [
  'strict_pass',
  'definite_fail',
  'judge_pass',
  'judge_fail',
  'judge_skipped',
  'judge_error_fallback',
  'legacy_fallback',
  'no_embeddings',
];

function _percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx];
}

/**
 * Aggregate CORE_GATE_* trace events from CallTranscriptV2.trace[] over the
 * last 24h. Optional companyId scopes to one tenant.
 *
 * Returns:
 *   {
 *     windowHours: 24,
 *     decisions: { strict_pass: 12, definite_fail: 33, ... , _other: 0 },
 *     totalScored: 87,
 *     judge: {
 *       calls: 14,
 *       cacheHits: 5,
 *       cacheHitRate: 0.357,
 *       latency: { p50: 64, p95: 187, p99: 213, samples: 14 },
 *       verdicts: { pass: 9, fail: 5 },
 *     },
 *     errors: {
 *       count: 1,
 *       last: { code: 'JUDGE_TIMEOUT', message: '…', ts: ISO },
 *       byCode: { JUDGE_TIMEOUT: 1 },
 *     },
 *   }
 */
async function aggregateRecent({ companyId = null } = {}) {
  _loadDeps();
  if (!CallTranscriptV2) return null;

  const since = new Date(Date.now() - WINDOW_MS);

  // Two cheap aggregations:
  //   1) decision breakdown from CORE_GATE_SCORE
  //   2) judge stats from CORE_GATE_JUDGE_CALLED + CORE_GATE_JUDGE_ERROR
  // We pull the relevant trace entries and aggregate in memory — typical
  // volume is ≤ a few thousand events / day, well below any concern.
  const match = {
    'trace.kind': { $in: ['CORE_GATE_SCORE', 'CORE_GATE_JUDGE_CALLED', 'CORE_GATE_JUDGE_ERROR', 'CORE_GATE_CIRCUIT_OPENED'] },
    updatedAt:    { $gte: since },
  };
  if (companyId) {
    try {
      const mongoose = require('mongoose');
      match.companyId = mongoose.Types.ObjectId.isValid(companyId)
        ? new mongoose.Types.ObjectId(companyId)
        : companyId;
    } catch (_e) {
      match.companyId = companyId;
    }
  }

  const pipeline = [
    { $match: match },
    { $unwind: '$trace' },
    { $match: {
        'trace.ts':   { $gte: since },
        'trace.kind': { $in: ['CORE_GATE_SCORE', 'CORE_GATE_JUDGE_CALLED', 'CORE_GATE_JUDGE_ERROR', 'CORE_GATE_CIRCUIT_OPENED'] },
    } },
    { $project: {
        _id:        0,
        kind:       '$trace.kind',
        ts:         '$trace.ts',
        payload:    '$trace.payload',
    } },
    { $limit: 50000 },  // hard cap so a runaway trace can't OOM the handler
  ];

  let rows = [];
  try {
    rows = await CallTranscriptV2.aggregate(pipeline).allowDiskUse(true);
  } catch (err) {
    logger.warn('[COREGATE_HEALTH] aggregation failed', { error: err.message });
    return null;
  }

  // ── Decision breakdown ────────────────────────────────────────────────
  const decisions = Object.fromEntries(KNOWN_DECISIONS.map(k => [k, 0]));
  decisions._other = 0;
  let totalScored = 0;

  // ── Judge stats ───────────────────────────────────────────────────────
  const judgeLatencies = [];
  const judgeVerdicts = { pass: 0, fail: 0 };
  let judgeCalls    = 0;
  let judgeCacheHits = 0;
  let circuitOpens  = 0;

  // ── Error stats ───────────────────────────────────────────────────────
  let errorCount = 0;
  const errorByCode = Object.create(null);
  let lastError = null;

  for (const r of rows) {
    const p = r.payload || {};
    if (r.kind === 'CORE_GATE_SCORE') {
      totalScored++;
      const d = p.decision;
      if (typeof d === 'string' && Object.prototype.hasOwnProperty.call(decisions, d)) {
        decisions[d]++;
      } else {
        decisions._other++;
      }
    } else if (r.kind === 'CORE_GATE_JUDGE_CALLED') {
      judgeCalls++;
      if (p.cached) judgeCacheHits++;
      if (typeof p.latencyMs === 'number' && Number.isFinite(p.latencyMs)) {
        judgeLatencies.push(p.latencyMs);
      }
      if (p.verdict === 'pass') judgeVerdicts.pass++;
      else if (p.verdict === 'fail') judgeVerdicts.fail++;
    } else if (r.kind === 'CORE_GATE_JUDGE_ERROR') {
      errorCount++;
      const code = `${p.code || 'unknown'}`;
      errorByCode[code] = (errorByCode[code] || 0) + 1;
      if (!lastError || (r.ts && new Date(r.ts) > new Date(lastError.ts))) {
        lastError = {
          code,
          message:    p.message || null,
          ts:         r.ts ? new Date(r.ts).toISOString() : null,
          fallbackPass: p.fallbackPass ?? null,
        };
      }
    } else if (r.kind === 'CORE_GATE_CIRCUIT_OPENED') {
      circuitOpens++;
    }
  }

  judgeLatencies.sort((a, b) => a - b);
  const judgeStats = {
    calls:        judgeCalls,
    cacheHits:    judgeCacheHits,
    cacheHitRate: judgeCalls ? Math.round((judgeCacheHits / judgeCalls) * 1000) / 1000 : 0,
    latency: {
      p50:     _percentile(judgeLatencies, 50),
      p95:     _percentile(judgeLatencies, 95),
      p99:     _percentile(judgeLatencies, 99),
      samples: judgeLatencies.length,
    },
    verdicts: judgeVerdicts,
  };

  return {
    windowHours: 24,
    totalScored,
    decisions,
    judge:       judgeStats,
    circuitOpensInWindow: circuitOpens,
    errors: {
      count:  errorCount,
      byCode: errorByCode,
      last:   lastError,
    },
  };
}

/**
 * Express handler for GET /health/coregate.
 *
 * Query params (all optional):
 *   companyId — scope aggregation to a single tenant
 *
 * Response shape:
 *   {
 *     ok: true,
 *     ts: ISO,
 *     circuit: { open, expiresAt, failureCount },
 *     activity: { ... aggregateRecent() ... },   // null if Mongo unavailable
 *   }
 *
 * Never throws. Always returns 200 with whatever data could be collected.
 */
async function healthCoreGateHandler(req, res) {
  _loadDeps();

  const out = {
    ok: true,
    ts: new Date().toISOString(),
    circuit: { open: false, expiresAt: null, failureCount: 0 },
    activity: null,
  };

  // Circuit state — never let getState() throw bubble out.
  if (CoreGateJudgeCircuitBreaker) {
    try {
      const s = await CoreGateJudgeCircuitBreaker.getState();
      out.circuit = {
        open:         !!s.open,
        expiresAt:    s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
        failureCount: Number(s.failureCount) || 0,
        threshold:    CoreGateJudgeCircuitBreaker.FAILURE_THRESHOLD,
        ttlSeconds:   CoreGateJudgeCircuitBreaker.CIRCUIT_BREAKER_TTL_S,
      };
    } catch (err) {
      logger.warn('[COREGATE_HEALTH] circuit getState failed', { error: err.message });
    }
  }

  // Activity aggregation — optional companyId scope.
  const companyId = (req?.query?.companyId || '').trim() || null;
  try {
    out.activity = await aggregateRecent({ companyId });
  } catch (err) {
    logger.warn('[COREGATE_HEALTH] aggregateRecent failed', { error: err.message });
  }

  return res.json(out);
}

module.exports = {
  aggregateRecent,
  healthCoreGateHandler,
  // exposed for tests
  KNOWN_DECISIONS,
  WINDOW_MS,
};

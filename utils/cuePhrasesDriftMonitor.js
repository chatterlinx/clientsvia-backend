'use strict';

/**
 * ============================================================================
 * CUE PHRASES DRIFT MONITOR — UAP/v1.md §29
 * ============================================================================
 *
 * Item 9 of the UAP 8-Cue + Anchor Hardening initiative.
 *
 * PURPOSE
 * -------
 * The cuePhrases dictionary + tradeVocabulary are the foundation of every
 * call's routing. Silent drift — a botched import, a reverted backup, an
 * accidental wipe, a token-type collapse — breaks the CueExtractor for
 * every tenant simultaneously, and the only feedback channel today is
 * "calls start failing."
 *
 * This module runs a daily heartbeat that snapshots the global dictionary
 * shape and warns when any axis drifts beyond a configured threshold. It
 * also exposes a `GET /health/drift` endpoint for on-demand inspection and
 * CI smoke-check wiring.
 *
 * DESIGN RULES (anti-gimmick guardrail)
 * -------------------------------------
 *   - Pure telemetry. Never blocks, never mutates, never throws.
 *   - Pattern mirrors `utils/memoryMonitor.js` exactly (known-good model).
 *   - In-memory last-snapshot only — no separate persistence layer. A
 *     process restart resets the baseline; the first post-restart run is
 *     always "no comparison, baseline recorded" (this is a feature — it
 *     means rolling deploys don't spam spurious alarms).
 *   - Thresholds are conservative. Real dictionary growth (admin adds 50
 *     new patterns) should NOT fire. Catastrophic drops (dictionary wipe,
 *     token-type collapse, ≥20 % swings) SHOULD fire.
 *   - No Redis, no cache, no DB writes. Read-only against AdminSettings
 *     and company documents.
 *
 * MOUNT
 * -----
 *   const { startDriftMonitor, healthDriftHandler } = require('./utils/cuePhrasesDriftMonitor');
 *   startDriftMonitor();                       // fire-and-forget daily cron
 *   app.get('/health/drift', healthDriftHandler);
 *
 * ============================================================================
 */

const logger = require('./logger');

let AdminSettings = null;
try { AdminSettings = require('../models/AdminSettings'); }
catch (_e) { /* loaded lazily if not yet resolvable */ }

// ── CONFIG ──────────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const VALID_TOKENS = [
  'requestCue', 'permissionCue', 'infoCue', 'directiveCue',
  'actionCore', 'urgencyCore', 'modifierCore',
];

// Warn thresholds — exceeded in EITHER direction (positive or negative).
const THRESHOLD = {
  cuePhrasesPct:  0.20,   // ±20 % total-count drift → warn
  perTokenPct:    0.30,   // ±30 % any single token-type drift → warn
  tradeVocabPct:  0.25,   // ±25 % total trade-term drift → warn
};

// In-memory last snapshot. Reset on process restart (deliberate — see DESIGN).
let _lastSnapshot = null;

// ── PURE HELPERS ─────────────────────────────────────────────────────────────

function _pctDelta(a, b) {
  // Δ (b - a) / a — handles a === 0 by returning Infinity when b > 0.
  if (a === 0) return b === 0 ? 0 : Infinity;
  return (b - a) / a;
}

/**
 * Count a cuePhrases array by token type.
 *
 * @param {Array<{pattern:string, token:string}>} patterns
 * @returns {{ total: number, byToken: Object<string, number> }}
 */
function _tallyCuePhrases(patterns) {
  const out = { total: 0, byToken: {} };
  for (const tok of VALID_TOKENS) out.byToken[tok] = 0;
  if (!Array.isArray(patterns)) return out;

  for (const row of patterns) {
    if (!row || typeof row !== 'object') continue;
    out.total++;
    const t = row.token;
    if (VALID_TOKENS.includes(t)) out.byToken[t]++;
  }
  return out;
}

/**
 * Walk company trade vocabularies and count total unique terms.
 * Global trade vocabularies live on AdminSettings.globalHub.tradeVocabularies.
 */
function _tallyTradeVocab(settings) {
  if (!settings || !settings.globalHub) return { total: 0, byTrade: {} };

  const out = { total: 0, byTrade: {} };
  const tv  = settings.globalHub.tradeVocabularies;
  if (!Array.isArray(tv)) return out;

  for (const trade of tv) {
    if (!trade || !trade.tradeKey) continue;
    const terms = Array.isArray(trade.terms) ? trade.terms.filter(Boolean) : [];
    out.byTrade[trade.tradeKey] = terms.length;
    out.total += terms.length;
  }
  return out;
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Read a fresh snapshot of the global cuePhrases dictionary + trade vocab.
 *
 * @returns {Promise<Object|null>} snapshot or null on fetch failure.
 */
async function getDriftSnapshot() {
  try {
    if (!AdminSettings) AdminSettings = require('../models/AdminSettings');

    const settings = await AdminSettings.findOne({}).lean();
    if (!settings) {
      logger.warn('[DRIFT] AdminSettings doc not found — skipping snapshot');
      return null;
    }

    const cp = settings.globalHub?.phraseIntelligence?.cuePhrases;
    const cueTally   = _tallyCuePhrases(cp);
    const tradeTally = _tallyTradeVocab(settings);

    return {
      timestamp:          new Date().toISOString(),
      cuePhrasesTotal:    cueTally.total,
      cuePhrasesByToken:  cueTally.byToken,
      tradeVocabTotal:    tradeTally.total,
      tradeVocabByTrade:  tradeTally.byTrade,
      phraseIntelligenceUpdatedAt: settings.globalHub?.phraseIntelligenceUpdatedAt || null,
      backupsCount:       Array.isArray(settings.globalHub?.phraseIntelligenceBackups)
                            ? settings.globalHub.phraseIntelligenceBackups.length : 0,
    };
  } catch (err) {
    logger.error('[DRIFT] snapshot failed', { err: err.message });
    return null;
  }
}

/**
 * Compare current vs previous snapshot. Returns { level, findings[] }.
 *
 * level:
 *   'info'     — no findings (healthy)
 *   'warn'     — at least one metric exceeded its drift threshold
 *   'critical' — cuePhrasesTotal dropped to zero OR dropped > 50 %
 */
function compareDrift(prev, curr) {
  const findings = [];
  let level = 'info';

  if (!prev || !curr) {
    return { level: 'info', findings: ['baseline-only (no prior snapshot)'] };
  }

  // ── Critical guard — total wipe or massive collapse ─────────────────
  if (curr.cuePhrasesTotal === 0 && prev.cuePhrasesTotal > 0) {
    findings.push('CRITICAL: cuePhrases dictionary is EMPTY (was ' + prev.cuePhrasesTotal + ')');
    level = 'critical';
  } else if (prev.cuePhrasesTotal > 0) {
    const pct = _pctDelta(prev.cuePhrasesTotal, curr.cuePhrasesTotal);
    if (pct <= -0.5) {
      findings.push(`CRITICAL: cuePhrases dropped ${Math.abs(Math.round(pct * 100))}% (${prev.cuePhrasesTotal} → ${curr.cuePhrasesTotal})`);
      level = 'critical';
    } else if (Math.abs(pct) >= THRESHOLD.cuePhrasesPct) {
      findings.push(`cuePhrases total drifted ${Math.round(pct * 100)}% (${prev.cuePhrasesTotal} → ${curr.cuePhrasesTotal})`);
      if (level !== 'critical') level = 'warn';
    }
  }

  // ── Per-token drift ─────────────────────────────────────────────────
  for (const tok of VALID_TOKENS) {
    const a = prev.cuePhrasesByToken?.[tok] ?? 0;
    const b = curr.cuePhrasesByToken?.[tok] ?? 0;
    if (a === 0 && b === 0) continue;
    const pct = _pctDelta(a, b);
    if (!Number.isFinite(pct)) {
      findings.push(`token ${tok}: new token class emerged (0 → ${b})`);
      if (level === 'info') level = 'warn';
      continue;
    }
    if (Math.abs(pct) >= THRESHOLD.perTokenPct) {
      findings.push(`token ${tok} drifted ${Math.round(pct * 100)}% (${a} → ${b})`);
      if (level === 'info') level = 'warn';
    }
  }

  // ── Trade vocabulary drift ──────────────────────────────────────────
  if (prev.tradeVocabTotal > 0) {
    const pct = _pctDelta(prev.tradeVocabTotal, curr.tradeVocabTotal);
    if (Math.abs(pct) >= THRESHOLD.tradeVocabPct) {
      findings.push(`tradeVocab total drifted ${Math.round(pct * 100)}% (${prev.tradeVocabTotal} → ${curr.tradeVocabTotal})`);
      if (level === 'info') level = 'warn';
    }
  }

  if (findings.length === 0) findings.push('no drift detected');
  return { level, findings };
}

/**
 * Start a daily drift heartbeat. First run records a baseline; subsequent
 * runs compare + log at info/warn/error based on severity.
 *
 * Returns the timer (unref'd so it never blocks process exit).
 */
function startDriftMonitor() {
  // Prime baseline on startup (async, fire-and-forget — must not block boot).
  getDriftSnapshot().then(snap => {
    if (!snap) return;
    _lastSnapshot = snap;
    logger.info('[DRIFT] Baseline snapshot recorded', {
      cuePhrasesTotal:  snap.cuePhrasesTotal,
      tradeVocabTotal:  snap.tradeVocabTotal,
      byToken:          snap.cuePhrasesByToken,
    });
  }).catch(err => {
    logger.warn('[DRIFT] Baseline failed', { err: err.message });
  });

  const timer = setInterval(async () => {
    const curr = await getDriftSnapshot();
    if (!curr) return; // swallow — try again tomorrow

    const { level, findings } = compareDrift(_lastSnapshot, curr);
    const payload = {
      cuePhrasesTotal:  curr.cuePhrasesTotal,
      tradeVocabTotal:  curr.tradeVocabTotal,
      byToken:          curr.cuePhrasesByToken,
      findings,
    };
    if (level === 'critical') logger.error('[DRIFT] CRITICAL drift', payload);
    else if (level === 'warn') logger.warn('[DRIFT] drift detected',  payload);
    else                       logger.info('[DRIFT] Daily heartbeat', payload);

    _lastSnapshot = curr;
  }, CHECK_INTERVAL_MS);

  timer.unref();
  return timer;
}

/**
 * Express route handler for GET /health/drift.
 * Returns current snapshot + last comparison. Never returns 5xx (drift
 * endpoint is for admin read, not a liveness probe).
 */
async function healthDriftHandler(_req, res) {
  const curr = await getDriftSnapshot();
  if (!curr) {
    return res.json({
      ok:     false,
      reason: 'snapshot-unavailable',
    });
  }
  const comparison = compareDrift(_lastSnapshot, curr);
  return res.json({
    ok:        true,
    snapshot:  curr,
    baseline:  _lastSnapshot,
    comparison,
    thresholds: THRESHOLD,
  });
}

// ── Internal accessors (for tests only) ──────────────────────────────────────

function _getLastSnapshot()  { return _lastSnapshot; }
function _setLastSnapshot(s) { _lastSnapshot = s; }
function _resetLastSnapshot(){ _lastSnapshot = null; }

module.exports = {
  // public
  getDriftSnapshot,
  compareDrift,
  startDriftMonitor,
  healthDriftHandler,
  // test access
  _tallyCuePhrases,
  _tallyTradeVocab,
  _getLastSnapshot,
  _setLastSnapshot,
  _resetLastSnapshot,
  _pctDelta,
  VALID_TOKENS,
  THRESHOLD,
};

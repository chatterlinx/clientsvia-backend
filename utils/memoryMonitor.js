'use strict';

/**
 * ============================================================================
 * MEMORY MONITOR — Lean Platform Health Telemetry
 * ============================================================================
 *
 * Daily memory snapshot + /health/memory endpoint.
 * Zero overhead — process.memoryUsage() reads kernel stats, no allocation.
 *
 * ============================================================================
 */

const logger = require('./logger');

function mb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function getMemorySnapshot() {
  const m = process.memoryUsage();
  return {
    rssMB:           mb(m.rss),
    heapTotalMB:     mb(m.heapTotal),
    heapUsedMB:      mb(m.heapUsed),
    externalMB:      mb(m.external),
    arrayBuffersMB:  mb(m.arrayBuffers || 0),
    uptimeHours:     Math.round(process.uptime() / 3600 * 10) / 10,
    pid:             process.pid,
    timestamp:       new Date().toISOString(),
  };
}

/**
 * Start a daily memory heartbeat log.
 * Runs once on startup, then every 24 hours.
 */
function startDailyHeartbeat() {
  const snap = getMemorySnapshot();
  logger.info('[MEMORY] Startup snapshot', snap);

  const timer = setInterval(() => {
    const s = getMemorySnapshot();
    const level = s.rssMB > 1400 ? 'warn' : 'info';
    logger[level]('[MEMORY] Daily heartbeat', s);
  }, 24 * 60 * 60 * 1000); // 24 hours

  timer.unref();
  return timer;
}

/**
 * Express route handler for GET /health/memory
 */
function healthMemoryHandler(_req, res) {
  return res.json({ ok: true, memory: getMemorySnapshot() });
}

module.exports = {
  getMemorySnapshot,
  startDailyHeartbeat,
  healthMemoryHandler,
};

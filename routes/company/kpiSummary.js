/**
 * ============================================================================
 * KPI SUMMARY (World-class MVP Metrics)
 * ============================================================================
 *
 * Purpose:
 * - Provide operator-grade KPIs for a company over a time range:
 *   1) Booking completion % (locked definition)
 *   2) Containment % (locked definition with exceptions)
 *   3) Median + p90 call seconds (bucketed)
 *
 * Enterprise rule:
 * - KPIs MUST be derived from persisted, auditable fields (CallSummary.kpi),
 *   not from ad-hoc UI guesses.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');

const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const CallSummary = require('../../models/CallSummary');
const logger = require('../../utils/logger');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

function clampInt(value, def, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc || sortedAsc.length === 0) return null;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w);
}

/**
 * GET /api/company/:companyId/kpi/summary?startDate=&endDate=&maxRows=
 */
router.get('/summary', async (req, res) => {
  const { companyId } = req.params;
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startDate = parseDate(req.query.startDate, defaultStart);
  const endDate = parseDate(req.query.endDate, now);
  const maxRows = clampInt(req.query.maxRows, 5000, 100, 20000);

  try {
    const match = {
      companyId: new mongoose.Types.ObjectId(companyId),
      startedAt: { $gte: startDate, $lte: endDate },
      processingStatus: 'complete'
    };

    // Keep this lean: only fields needed for KPI calculations.
    const rows = await CallSummary.find(match)
      .select({
        durationSeconds: 1,
        outcome: 1,
        'kpi.callerType': 1,
        'kpi.enteredBooking': 1,
        'kpi.bookingOutcome': 1,
        'kpi.bookingComplete': 1,
        'kpi.missingRequiredSlotsCount': 1,
        'kpi.containmentOutcome': 1,
        'kpi.containmentCountedAsSuccess': 1,
        'kpi.bucket': 1,
        'kpi.failureReason': 1
      })
      .sort({ startedAt: -1 })
      .limit(maxRows)
      .lean();

    const totals = {
      calls: rows.length
    };

    // Booking completion % (locked)
    const bookingEntered = rows.filter(r => r?.kpi?.enteredBooking === true);
    const bookingComplete = bookingEntered.filter(r =>
      r?.kpi?.bookingComplete === true &&
      (r?.kpi?.missingRequiredSlotsCount || 0) === 0 &&
      (r?.kpi?.bookingOutcome === 'SCHEDULED' || r?.kpi?.bookingOutcome === 'CONFIRMED_REQUEST')
    );

    // Containment % (locked)
    const containmentSuccess = rows.filter(r => r?.kpi?.containmentCountedAsSuccess === true);

    // Duration metrics (median + p90) by bucket
    const bucketed = { BOOKING: [], FAQ_ONLY: [], TRANSFER: [] };
    for (const r of rows) {
      const bucket = r?.kpi?.bucket || 'FAQ_ONLY';
      const secs = typeof r?.durationSeconds === 'number' ? r.durationSeconds : null;
      if (!secs || secs < 0) continue;
      if (!bucketed[bucket]) bucketed[bucket] = [];
      bucketed[bucket].push(secs);
    }
    const duration = {};
    for (const [bucket, arr] of Object.entries(bucketed)) {
      const sorted = arr.slice().sort((a, b) => a - b);
      const avg = sorted.length ? Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length) : null;
      duration[bucket] = {
        count: sorted.length,
        avgSeconds: avg,
        p50Seconds: percentile(sorted, 0.5),
        p90Seconds: percentile(sorted, 0.9)
      };
    }

    // Failure reason distribution (actionability)
    const failureReasons = rows.reduce((acc, r) => {
      const fr = r?.kpi?.failureReason || 'UNKNOWN';
      acc[fr] = (acc[fr] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        companyId,
        period: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        totals,
        booking: {
          denominatorEnteredBooking: bookingEntered.length,
          numeratorComplete: bookingComplete.length,
          completionRate: bookingEntered.length ? Number((bookingComplete.length / bookingEntered.length).toFixed(4)) : null
        },
        containment: {
          denominatorCalls: rows.length,
          numeratorSuccessCounted: containmentSuccess.length,
          rate: rows.length ? Number((containmentSuccess.length / rows.length).toFixed(4)) : null
        },
        durationSeconds: duration,
        failureReasons,
        _meta: {
          maxRows,
          note: rows.length === maxRows
            ? 'Results truncated by maxRows; widen later with server-side percentile aggregation if needed.'
            : 'Complete for this period.'
        }
      }
    });
  } catch (error) {
    logger.error('[KPI SUMMARY] Failed to compute KPI summary', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;



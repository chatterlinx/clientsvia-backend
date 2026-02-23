/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING LOGIC API - STANDALONE CONTROL PLANE ROUTES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * BASE PATH: /api/control-plane/booking-logic
 * 
 * This module provides the API for the Booking Logic tab in Control Plane.
 * It is STANDALONE - no imports from Agent 2.0 or legacy booking systems.
 * 
 * CRITICAL: Uses "bookingCtx" NOT "bookingState" to avoid legacy contamination.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTHENTICATION:
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * TWO AUTH MODES:
 * 
 * 1. Control Plane JWT (for human admin UI):
 *    - Header: Authorization: Bearer <jwt>
 *    - Used by: Control Plane UI, admin debugging
 * 
 * 2. Internal Server Auth (for runtime/server-to-server):
 *    - Header: X-Internal-Auth: <BOOKING_LOGIC_INTERNAL_KEY env var>
 *    - Used by: Agent 2.0 runtime, other internal services
 *    - DOES NOT require human JWT
 * 
 * RECOMMENDED FOR RUNTIME:
 *    - Best: Call BookingLogicEngine.computeStep() directly in-process (no HTTP)
 *    - If HTTP needed: Use X-Internal-Auth header, NOT Control Plane JWT
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * ENDPOINTS:
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * DEBUG-ONLY (UI):
 * - GET  /handoff/latest     - Get most recent payload (UI debug only)
 * - POST /handoff            - Store payload (UI debug only, NOT for runtime)
 * - GET  /handoff/history    - Recent payloads for debugging
 * 
 * CORE (Runtime + UI):
 * - POST /step               - Compute next booking step (fast, cached)
 * 
 * CACHE:
 * - POST /cache/invalidate   - Invalidate dictionary caches
 * - GET  /cache/status       - Check cache status
 * 
 * HEALTH:
 * - GET  /health             - Health check
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../../middleware/auth');
const BookingLogicEngine = require('../../services/engine/booking/BookingLogicEngine');
const logger = require('../../config/logger');

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL AUTH KEY (for server-to-server calls)
// ═══════════════════════════════════════════════════════════════════════════
const INTERNAL_AUTH_KEY = process.env.BOOKING_LOGIC_INTERNAL_KEY || null;

/**
 * Middleware: Allow either JWT auth OR internal auth header
 * 
 * Internal auth is for runtime/server-to-server calls.
 * JWT auth is for Control Plane UI.
 */
function authenticateJWTOrInternal(req, res, next) {
  // Check for internal auth header first
  const internalAuth = req.get('X-Internal-Auth');
  
  if (INTERNAL_AUTH_KEY && internalAuth === INTERNAL_AUTH_KEY) {
    // Internal auth valid - mark as internal caller
    req.isInternalAuth = true;
    req.user = { userId: 'internal', email: 'runtime@internal' };
    return next();
  }
  
  // Fall back to JWT auth
  return authenticateJWT(req, res, next);
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY PAYLOAD STORE (DEBUG ONLY)
// ═══════════════════════════════════════════════════════════════════════════
// WARNING: This is for UI debugging ONLY.
// Runtime must call /step directly with payload in hand.
// DO NOT call /handoff from live call hot path.

let latestPayload = null;
let latestPayloadId = null;
let latestPayloadCreatedAt = null;

const payloadHistory = [];
const MAX_HISTORY = 50;

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG-ONLY ROUTES (JWT auth only - not for runtime)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/control-plane/booking-logic/handoff/latest
 * 
 * DEBUG ONLY: Returns the most recent handoff payload stored.
 * Used by the UI to load the latest payload for debugging.
 * 
 * NOT FOR RUNTIME USE.
 */
router.get('/handoff/latest', authenticateJWT, async (req, res) => {
  try {
    if (!latestPayload) {
      return res.json({
        success: true,
        data: {
          payload: null,
          id: null,
          createdAt: null,
          message: 'No payload stored yet. This endpoint is for UI debugging only.'
        }
      });
    }
    
    return res.json({
      success: true,
      data: {
        payload: latestPayload,
        id: latestPayloadId,
        createdAt: latestPayloadCreatedAt
      }
    });
  } catch (err) {
    logger.error('[BookingLogic] GET /handoff/latest failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/control-plane/booking-logic/handoff
 * 
 * DEBUG ONLY: Store a new handoff payload for UI testing.
 * 
 * ⚠️ WARNING: DO NOT CALL THIS FROM RUNTIME HOT PATH.
 * This adds latency and is not needed for booking computation.
 * Runtime should call /step directly with the payload.
 * 
 * Body: { payload: {...}, meta: {...optional...} }
 */
router.post('/handoff', authenticateJWT, async (req, res) => {
  try {
    const { payload, meta } = req.body;
    
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'payload is required and must be an object'
      });
    }
    
    // Check for legacy keys in payload and warn
    const legacyTrace = [];
    const hasLegacy = BookingLogicEngine.checkForLegacyKeys(payload, 'payload', legacyTrace);
    
    const id = `handoff_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const createdAt = new Date().toISOString();
    
    latestPayload = payload;
    latestPayloadId = id;
    latestPayloadCreatedAt = createdAt;
    
    payloadHistory.unshift({
      id,
      payload,
      meta: meta || {},
      createdAt,
      source: meta?.source || 'ui_debug'
    });
    
    if (payloadHistory.length > MAX_HISTORY) {
      payloadHistory.length = MAX_HISTORY;
    }
    
    logger.info('[BookingLogic] Handoff payload stored (debug)', {
      id,
      assumptionsKeys: Object.keys(payload.assumptions || {}),
      source: meta?.source || 'ui_debug',
      hasLegacyKeys: hasLegacy
    });
    
    return res.json({
      success: true,
      data: {
        id,
        createdAt,
        legacyKeysWarning: hasLegacy ? legacyTrace : undefined,
        message: 'Payload stored for debugging. Runtime should use /step directly.'
      }
    });
  } catch (err) {
    logger.error('[BookingLogic] POST /handoff failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/control-plane/booking-logic/handoff/history
 * 
 * DEBUG ONLY: Returns recent handoff payloads for debugging.
 */
router.get('/handoff/history', authenticateJWT, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, MAX_HISTORY);
    
    return res.json({
      success: true,
      data: {
        history: payloadHistory.slice(0, limit),
        total: payloadHistory.length
      }
    });
  } catch (err) {
    logger.error('[BookingLogic] GET /handoff/history failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORE ROUTES (JWT or Internal auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/control-plane/booking-logic/step
 * 
 * CORE ENDPOINT: Compute the next booking step based on payload.
 * Used by both UI and runtime.
 * 
 * AUTH: JWT (for UI) OR X-Internal-Auth header (for runtime)
 * 
 * RECOMMENDED FOR RUNTIME:
 *   - Best: Import BookingLogicEngine and call computeStep() directly (no HTTP)
 *   - If HTTP needed: Use X-Internal-Auth header, set BOOKING_LOGIC_INTERNAL_KEY env
 * 
 * Body: { payload: {...}, bookingCtx: {...optional...}, userResponse: "caller utterance", debugAllowUnknown: false }
 * 
 * CRITICAL: Use "bookingCtx" NOT "bookingState" (legacy term).
 * 
 * Returns: { nextPrompt, bookingCtx, trace, latencyMs, cacheHit, bookingComplete }
 */
router.post('/step', authenticateJWTOrInternal, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { payload, bookingCtx, userResponse, debugAllowUnknown } = req.body;
    
    // ─────────────────────────────────────────────────────────────────────────
    // RULE A: Reject "bookingState" at request top level (contract violation)
    // ─────────────────────────────────────────────────────────────────────────
    if ('bookingState' in req.body) {
      logger.warn('[BookingLogic] Legacy bookingState parameter rejected', {
        isInternal: req.isInternalAuth || false
      });
      return res.status(400).json({
        success: false,
        error: 'Use "bookingCtx" not "bookingState". bookingState is a legacy term.'
      });
    }
    
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'payload is required and must be an object'
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Call engine (handles legacy key checks on payload and bookingCtx)
    // ─────────────────────────────────────────────────────────────────────────
    const result = await BookingLogicEngine.computeStep(
      payload,
      bookingCtx,
      { 
        userResponse: userResponse || null,
        debugAllowUnknown: debugAllowUnknown === true 
      }
    );
    
    const latencyMs = Date.now() - startTime;
    
    // Check for engine-level errors
    if (result.error) {
      logger.warn('[BookingLogic] Step rejected', {
        error: result.error,
        latencyMs,
        isInternal: req.isInternalAuth || false
      });
      return res.status(400).json({
        success: false,
        error: result.error,
        trace: result.trace,
        latencyMs
      });
    }
    
    logger.info('[BookingLogic] Step computed', {
      latencyMs,
      step: result.bookingCtx?.step,
      nameStage: result.bookingCtx?.name?.stage,
      traceCount: result.trace?.length,
      cacheHit: result.cacheHit,
      bookingComplete: result.bookingComplete || false,
      isInternal: req.isInternalAuth || false
    });
    
    return res.json({
      success: true,
      data: {
        nextPrompt: result.nextPrompt,
        bookingCtx: result.bookingCtx,
        trace: result.trace,
        latencyMs,
        cacheHit: result.cacheHit,
        bookingComplete: result.bookingComplete || false
      }
    });
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    logger.error('[BookingLogic] POST /step failed', {
      error: err.message,
      stack: err.stack,
      latencyMs,
      isInternal: req.isInternalAuth || false
    });
    return res.status(500).json({
      success: false,
      error: err.message,
      latencyMs
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE ROUTES (JWT or Internal auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/control-plane/booking-logic/cache/invalidate
 * 
 * Invalidate the dictionary caches.
 * Called after Global Hub saves dictionaries.
 * Also available for manual cache refresh from UI.
 */
router.post('/cache/invalidate', authenticateJWTOrInternal, async (req, res) => {
  try {
    BookingLogicEngine.invalidateCache();
    
    logger.info('[BookingLogic] Cache invalidated via API', {
      user: req.user?.email || req.user?.userId || 'unknown',
      isInternal: req.isInternalAuth || false
    });
    
    return res.json({
      success: true,
      message: 'Cache invalidated. Next /step call will reload dictionaries.'
    });
  } catch (err) {
    logger.error('[BookingLogic] POST /cache/invalidate failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/control-plane/booking-logic/cache/status
 * 
 * Get cache status for debugging.
 */
router.get('/cache/status', authenticateJWTOrInternal, async (req, res) => {
  try {
    const firstNamesResult = await BookingLogicEngine.getFirstNamesSet();
    const lastNamesResult = await BookingLogicEngine.getLastNamesSet();
    
    return res.json({
      success: true,
      data: {
        firstNames: {
          count: firstNamesResult.set.size,
          loaded: firstNamesResult.set.size > 0,
          cacheHit: firstNamesResult.cacheHit
        },
        lastNames: {
          count: lastNamesResult.set.size,
          loaded: lastNamesResult.set.size > 0,
          cacheHit: lastNamesResult.cacheHit
        }
      }
    });
  } catch (err) {
    logger.error('[BookingLogic] GET /cache/status failed', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH ROUTE (No auth required)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/control-plane/booking-logic/health
 * 
 * Health check endpoint.
 */
router.get('/health', async (req, res) => {
  return res.json({
    success: true,
    service: 'booking-logic',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    authModes: {
      jwt: 'Control Plane UI (Authorization: Bearer <jwt>)',
      internal: INTERNAL_AUTH_KEY ? 'Enabled (X-Internal-Auth header)' : 'Disabled (set BOOKING_LOGIC_INTERNAL_KEY env)'
    },
    endpoints: {
      core: 'POST /step (JWT or Internal auth)',
      debugOnly: 'GET/POST /handoff/* (JWT only)',
      cache: 'GET /cache/status, POST /cache/invalidate'
    },
    runtimeRecommendation: 'Call BookingLogicEngine.computeStep() directly in-process for best performance'
  });
});

module.exports = router;

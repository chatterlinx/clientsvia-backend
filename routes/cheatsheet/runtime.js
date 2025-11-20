/**
 * ============================================================================
 * CHEATSHEET RUNTIME API ROUTES
 * ============================================================================
 * 
 * Production-optimized routes for AI agent call runtime.
 * Separate from admin version management routes.
 * 
 * BASE PATH: /runtime-config
 * 
 * ROUTES:
 * - GET /runtime-config/:companyId        - Get live config (production)
 * - GET /runtime-config/test/:companyId   - Get test config (admin only)
 * - GET /runtime-config/health            - Health check
 * 
 * SECURITY:
 * - Production route: Internal only (no external access)
 * - Test route: Admin authentication required
 * - Health check: Public (for monitoring)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
const { validate, getTestConfigSchema } = require('../../validators/cheatsheet');
const { authenticateJWT: authMiddleware } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// PRODUCTION RUNTIME ROUTE (Internal Only)
// ============================================================================

/**
 * GET /runtime-config/:companyId
 * Get live config for production calls
 * 
 * This is THE endpoint that production call handler uses.
 * Optimized for speed with Redis caching.
 * NO authentication (internal service-to-service only)
 * 
 * Security: Should only be accessible from internal network
 * Use firewall rules to block external access
 */
router.get('/:companyId', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { companyId } = req.params;
    
    const config = await CheatSheetRuntimeService.getRuntimeConfig(companyId);
    
    const duration = Date.now() - startTime;
    
    logger.debug('CHEATSHEET_RUNTIME_GET', {
      companyId,
      duration,
      cached: duration < 20 // Likely cached if < 20ms
    });
    
    res.json({
      success: true,
      data: config,
      meta: {
        duration,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (err) {
    const duration = Date.now() - startTime;
    
    logger.error('CHEATSHEET_RUNTIME_GET_ERROR', {
      companyId: req.params.companyId,
      error: err.message,
      code: err.code,
      duration
    });
    
    const statusCode = err.code === 'NO_LIVE_CONFIG' ? 404 :
                      err.code === 'LIVE_CONFIG_NOT_FOUND' ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: err.code || 'INTERNAL_ERROR',
      message: err.message,
      meta: {
        duration,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// ============================================================================
// ADMIN TESTING ROUTE (Auth Required)
// ============================================================================

/**
 * GET /runtime-config/test/:companyId
 * Get config for admin testing
 * 
 * Allows testing draft or archived versions.
 * Requires authentication (admin only).
 * NOT cached (testing should use fresh data).
 * 
 * Query params:
 * - source: 'live', 'draft', or 'version'
 * - versionId: specific version ID (if source='version')
 */
router.get(
  '/test/:companyId',
  authMiddleware,
  validate('query', getTestConfigSchema),
  async (req, res) => {
    try {
      const { companyId } = req.params;
      const { source, versionId } = req.query;
      
      const config = await CheatSheetRuntimeService.getTestConfig(
        companyId,
        source,
        versionId
      );
      
      logger.info('CHEATSHEET_TEST_CONFIG', {
        companyId,
        source,
        versionId,
        user: req.user?.email || 'Unknown'
      });
      
      res.json({
        success: true,
        data: config,
        meta: {
          source,
          versionId: versionId || 'N/A',
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (err) {
      logger.error('CHEATSHEET_TEST_CONFIG_ERROR', {
        companyId: req.params.companyId,
        source: req.query.source,
        error: err.message
      });
      
      const statusCode = err.code === 'VERSION_NOT_FOUND' ? 404 :
                        err.code === 'NO_LIVE_CONFIG' ? 404 : 500;
      
      res.status(statusCode).json({
        success: false,
        error: err.code || 'INTERNAL_ERROR',
        message: err.message
      });
    }
  }
);

// ============================================================================
// HEALTH CHECK (Public)
// ============================================================================

/**
 * GET /runtime-config/health
 * Health check for runtime service
 * 
 * Public endpoint for monitoring systems.
 * Checks MongoDB, Redis, and sample config fetch.
 */
router.get('/health', async (req, res) => {
  try {
    const sampleCompanyId = req.query.sampleCompanyId || null;
    
    const health = await CheatSheetRuntimeService.healthCheck(sampleCompanyId);
    
    const statusCode = health.status === 'healthy' ? 200 :
                      health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json({
      success: health.status !== 'unhealthy',
      status: health.status,
      checks: health.checks,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_HEALTH_CHECK_ERROR', {
      error: err.message
    });
    
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================================================
// CACHE MANAGEMENT ROUTES (Admin Only)
// ============================================================================

/**
 * POST /runtime-config/cache/invalidate/:companyId
 * Manually invalidate cache for a company
 */
router.post('/cache/invalidate/:companyId', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    await CheatSheetRuntimeService.invalidateCache(companyId);
    
    logger.info('CHEATSHEET_CACHE_INVALIDATED', {
      companyId,
      user: req.user?.email || 'Unknown'
    });
    
    res.json({
      success: true,
      message: 'Cache invalidated successfully'
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_CACHE_INVALIDATE_ERROR', {
      companyId: req.params.companyId,
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * POST /runtime-config/cache/warm/:companyId
 * Manually warm cache for a company
 */
router.post('/cache/warm/:companyId', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    await CheatSheetRuntimeService.warmCache(companyId);
    
    logger.info('CHEATSHEET_CACHE_WARMED', {
      companyId,
      user: req.user?.email || 'Unknown'
    });
    
    res.json({
      success: true,
      message: 'Cache warmed successfully'
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_CACHE_WARM_ERROR', {
      companyId: req.params.companyId,
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

/**
 * GET /runtime-config/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', authMiddleware, async (req, res) => {
  try {
    const stats = await CheatSheetRuntimeService.getCacheStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_CACHE_STATS_ERROR', {
      error: err.message
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message
    });
  }
});

// ============================================================================
// ERROR HANDLER (Catch-all)
// ============================================================================

router.use((err, req, res, next) => {
  logger.error('CHEATSHEET_RUNTIME_UNHANDLED_ERROR', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack
  });
  
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
});

// ============================================================================
// EXPORT ROUTER
// ============================================================================

module.exports = router;


// ============================================================================
// METRICS & MONITORING API ROUTES
// ============================================================================
// Exposes application metrics for monitoring and observability
// ============================================================================

const express = require('express');
const router = express.Router();
const { getMetrics, resetMetrics } = require('../middleware/metricsCollector');
const { authenticateJWT, requireRole } = require('../middleware/auth');

// ============================================================================
// GET /api/metrics - Get current metrics
// ============================================================================

router.get('/metrics', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const metrics = getMetrics();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics
    });
  } catch (error) {
    console.error('Error retrieving metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve metrics',
      error: error.message
    });
  }
});

// ============================================================================
// GET /api/metrics/health - Quick health summary
// ============================================================================

router.get('/metrics/health', (req, res) => {
  try {
    const metrics = getMetrics();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      health: metrics.health,
      uptime: metrics.uptime,
      performance: {
        avgResponseTime: metrics.performance.avgResponseTime,
        p95: metrics.performance.p95
      }
    });
  } catch (error) {
    console.error('Error retrieving health metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve health metrics'
    });
  }
});

// ============================================================================
// GET /api/metrics/performance - Performance metrics
// ============================================================================

router.get('/metrics/performance', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const metrics = getMetrics();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      performance: metrics.performance,
      requests: {
        total: metrics.requests.total,
        successRate: metrics.requests.successRate,
        errorRate: metrics.requests.errorRate
      }
    });
  } catch (error) {
    console.error('Error retrieving performance metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve performance metrics'
    });
  }
});

// ============================================================================
// POST /api/metrics/reset - Reset metrics (admin only)
// ============================================================================

router.post('/metrics/reset', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    resetMetrics();
    res.json({
      success: true,
      message: 'Metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset metrics',
      error: error.message
    });
  }
});

// ============================================================================
// GET /api/metrics/errors - Recent errors
// ============================================================================

router.get('/metrics/errors', authenticateJWT, requireRole('admin'), (req, res) => {
  try {
    const metrics = getMetrics();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      errors: metrics.errors
    });
  } catch (error) {
    console.error('Error retrieving error metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error metrics'
    });
  }
});

module.exports = router;


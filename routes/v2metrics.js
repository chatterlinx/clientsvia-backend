// ============================================================================
// METRICS & MONITORING API ROUTES
// ============================================================================
// Exposes application metrics for monitoring and observability
// ============================================================================

const express = require('express');
const logger = require('../utils/logger.js');

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
    logger.error('Error retrieving metrics:', error);
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
    logger.error('Error retrieving health metrics:', error);
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
    logger.error('Error retrieving performance metrics:', error);
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
    logger.error('Error resetting metrics:', error);
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
    logger.error('Error retrieving error metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error metrics'
    });
  }
});

// ============================================================================
// GET /api/metrics/codebase - Codebase line count stats
// ============================================================================

const fs = require('fs');
const path = require('path');

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
  } catch (e) {
    return 0;
  }
}

function countLinesInDir(dirPath, extensions = ['.js', '.html']) {
  let total = 0;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        total += countLinesInDir(fullPath, extensions);
      } else if (item.isFile() && extensions.some(ext => item.name.endsWith(ext))) {
        total += countLines(fullPath);
      }
    }
  } catch (e) {
    // Skip inaccessible directories
  }
  return total;
}

// Cache the count (recalculate every 5 minutes max)
let cachedCodebaseStats = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCodebaseStats() {
  const now = Date.now();
  if (cachedCodebaseStats && (now - cacheTime) < CACHE_TTL) {
    return cachedCodebaseStats;
  }
  
  const rootDir = path.resolve(__dirname, '..');
  
  // Control Plane V2 NUKED Feb 2026 — counts zeroed
  const controlPlaneHtml = 0;
  const controlPlaneJs = 0;
  
  // Count backend
  const servicesDir = path.join(rootDir, 'services');
  const routesDir = path.join(rootDir, 'routes');
  const modelsDir = path.join(rootDir, 'models');
  
  const servicesLines = countLinesInDir(servicesDir, ['.js']);
  const routesLines = countLinesInDir(routesDir, ['.js']);
  const modelsLines = countLinesInDir(modelsDir, ['.js']);
  
  // Total backend JS
  const backendTotal = servicesLines + routesLines + modelsLines;
  
  // Control plane total
  const controlPlaneTotal = controlPlaneHtml + controlPlaneJs;
  
  cachedCodebaseStats = {
    controlPlane: {
      html: controlPlaneHtml,
      js: controlPlaneJs,
      total: controlPlaneTotal
    },
    backend: {
      services: servicesLines,
      routes: routesLines,
      models: modelsLines,
      total: backendTotal
    },
    total: controlPlaneTotal + backendTotal
  };
  cacheTime = now;
  
  return cachedCodebaseStats;
}

router.get('/metrics/codebase', (req, res) => {
  try {
    const stats = getCodebaseStats();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    logger.error('Error calculating codebase stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate codebase stats'
    });
  }
});

module.exports = router;


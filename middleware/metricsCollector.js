// ============================================================================
// METRICS COLLECTION MIDDLEWARE - Production Monitoring
// ============================================================================
// Collects application metrics for monitoring and performance analysis
// ============================================================================

const logger = require('../utils/logger');

// In-memory metrics store (use Redis or external service in production at scale)
const metrics = {
  requests: {
    total: 0,
    byMethod: {},
    byRoute: {},
    byStatusCode: {}
  },
  performance: {
    responseTimes: [],
    maxResponseTime: 0,
    minResponseTime: Infinity,
    avgResponseTime: 0
  },
  errors: {
    total: 0,
    byType: {},
    recent: []
  },
  system: {
    startTime: Date.now(),
    lastReset: Date.now()
  }
};

// ============================================================================
// REQUEST METRICS MIDDLEWARE
// ============================================================================

const collectRequestMetrics = (req, res, next) => {
  const startTime = Date.now();
  
  // Capture original end function
  const originalEnd = res.end;
  
  // Override end function to collect metrics
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    
    // Update metrics
    metrics.requests.total++;
    
    // By method
    metrics.requests.byMethod[req.method] = (metrics.requests.byMethod[req.method] || 0) + 1;
    
    // By route (simplified)
    const route = req.route?.path || req.path || 'unknown';
    metrics.requests.byRoute[route] = (metrics.requests.byRoute[route] || 0) + 1;
    
    // By status code
    metrics.requests.byStatusCode[res.statusCode] = (metrics.requests.byStatusCode[res.statusCode] || 0) + 1;
    
    // Performance metrics
    metrics.performance.responseTimes.push(duration);
    
    // Keep only last 1000 response times
    if (metrics.performance.responseTimes.length > 1000) {
      metrics.performance.responseTimes.shift();
    }
    
    // Update min/max
    if (duration > metrics.performance.maxResponseTime) {
      metrics.performance.maxResponseTime = duration;
    }
    if (duration < metrics.performance.minResponseTime) {
      metrics.performance.minResponseTime = duration;
    }
    
    // Calculate average
    if (metrics.performance.responseTimes.length > 0) {
      metrics.performance.avgResponseTime = 
        metrics.performance.responseTimes.reduce((a, b) => a + b, 0) / 
        metrics.performance.responseTimes.length;
    }
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        statusCode: res.statusCode
      });
    }
    
    // Call original end function
    originalEnd.apply(res, args);
  };
  
  next();
};

// ============================================================================
// ERROR TRACKING MIDDLEWARE
// ============================================================================

const trackErrors = (err, req, res, next) => {
  metrics.errors.total++;
  
  // By error type
  const errorType = err.name || 'UnknownError';
  metrics.errors.byType[errorType] = (metrics.errors.byType[errorType] || 0) + 1;
  
  // Store recent errors (keep last 100)
  metrics.errors.recent.unshift({
    type: errorType,
    message: err.message,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    stack: err.stack?.split('\n').slice(0, 3).join('\n') // First 3 lines
  });
  
  if (metrics.errors.recent.length > 100) {
    metrics.errors.recent.pop();
  }
  
  // Log error
  logger.error('Request error tracked', {
    type: errorType,
    message: err.message,
    path: req.path,
    method: req.method
  });
  
  // Pass to next error handler
  next(err);
};

// ============================================================================
// METRICS REPORTING
// ============================================================================

const getMetrics = () => {
  const uptime = Date.now() - metrics.system.startTime;
  const uptimeSeconds = Math.floor(uptime / 1000);
  
  return {
    timestamp: new Date().toISOString(),
    uptime: {
      milliseconds: uptime,
      seconds: uptimeSeconds,
      formatted: formatUptime(uptimeSeconds)
    },
    requests: {
      total: metrics.requests.total,
      byMethod: metrics.requests.byMethod,
      topRoutes: getTopRoutes(10),
      byStatusCode: metrics.requests.byStatusCode,
      successRate: calculateSuccessRate(),
      errorRate: calculateErrorRate()
    },
    performance: {
      avgResponseTime: Math.round(metrics.performance.avgResponseTime),
      minResponseTime: metrics.performance.minResponseTime === Infinity ? 0 : metrics.performance.minResponseTime,
      maxResponseTime: metrics.performance.maxResponseTime,
      p50: calculatePercentile(50),
      p95: calculatePercentile(95),
      p99: calculatePercentile(99)
    },
    errors: {
      total: metrics.errors.total,
      byType: metrics.errors.byType,
      recent: metrics.errors.recent.slice(0, 10) // Last 10 errors
    },
    system: {
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    health: {
      requestsPerSecond: Math.round(metrics.requests.total / (uptime / 1000)),
      avgMemoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      errorRate: calculateErrorRate(),
      status: determineHealthStatus()
    }
  };
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
};

const getTopRoutes = (limit) => {
  return Object.entries(metrics.requests.byRoute)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {});
};

const calculateSuccessRate = () => {
  const successCodes = [200, 201, 202, 204, 304];
  const successCount = successCodes.reduce((sum, code) => {
    return sum + (metrics.requests.byStatusCode[code] || 0);
  }, 0);
  
  return metrics.requests.total > 0 
    ? Math.round((successCount / metrics.requests.total) * 100) 
    : 100;
};

const calculateErrorRate = () => {
  const errorCodes = [400, 401, 403, 404, 500, 502, 503];
  const errorCount = errorCodes.reduce((sum, code) => {
    return sum + (metrics.requests.byStatusCode[code] || 0);
  }, 0);
  
  return metrics.requests.total > 0 
    ? Math.round((errorCount / metrics.requests.total) * 100) 
    : 0;
};

const calculatePercentile = (percentile) => {
  if (metrics.performance.responseTimes.length === 0) return 0;
  
  const sorted = [...metrics.performance.responseTimes].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  
  return Math.round(sorted[index] || 0);
};

const determineHealthStatus = () => {
  const errorRate = calculateErrorRate();
  const avgResponseTime = metrics.performance.avgResponseTime;
  const memoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
  
  if (errorRate > 10 || avgResponseTime > 500 || memoryUsage > 0.9) {
    return 'critical';
  } else if (errorRate > 5 || avgResponseTime > 200 || memoryUsage > 0.75) {
    return 'warning';
  } else {
    return 'healthy';
  }
};

const resetMetrics = () => {
  metrics.requests.total = 0;
  metrics.requests.byMethod = {};
  metrics.requests.byRoute = {};
  metrics.requests.byStatusCode = {};
  metrics.performance.responseTimes = [];
  metrics.performance.maxResponseTime = 0;
  metrics.performance.minResponseTime = Infinity;
  metrics.performance.avgResponseTime = 0;
  metrics.errors.total = 0;
  metrics.errors.byType = {};
  metrics.errors.recent = [];
  metrics.system.lastReset = Date.now();
  
  logger.info('Metrics reset successfully');
};

// ============================================================================
// PERIODIC METRICS LOGGING
// ============================================================================

const startPeriodicLogging = (intervalMinutes = 60) => {
  setInterval(() => {
    const currentMetrics = getMetrics();
    logger.info('Periodic metrics report', {
      requests: currentMetrics.requests.total,
      avgResponseTime: currentMetrics.performance.avgResponseTime,
      errorRate: currentMetrics.requests.errorRate,
      memoryUsage: currentMetrics.system.memory.heapUsed,
      status: currentMetrics.health.status
    });
  }, intervalMinutes * 60 * 1000);
  
  logger.info(`Periodic metrics logging started (every ${intervalMinutes} minutes)`);
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  collectRequestMetrics,
  trackErrors,
  getMetrics,
  resetMetrics,
  startPeriodicLogging
};


/**
 * ============================================================================
 * TIMING INSTRUMENTATION - Performance Metrics Collection
 * ============================================================================
 * 
 * PURPOSE: Collect real-world timing metrics for:
 * - Config fetch latency
 * - Scenario matching latency
 * - Placeholder substitution latency
 * - TTS generation latency
 * - Overall response time
 * 
 * STORAGE: Redis (short-term) + MongoDB (aggregated, long-term)
 * 
 * USE CASES:
 * - Debug drawer performance display
 * - API response headers (X-Timing-*)
 * - Performance regression detection
 * - Latency percentile tracking
 * 
 * ============================================================================
 */

const logger = require('./logger');

// In-memory ring buffer for recent timings (last 100)
const recentTimings = {
    configFetch: [],
    scenarioMatch: [],
    placeholderSub: [],
    ttsGen: [],
    totalResponse: []
};
const MAX_BUFFER_SIZE = 100;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TIMING HELPERS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Start a timing measurement
 * @returns {Object} Timer object with stop() method
 */
function startTimer(label) {
    const startTime = process.hrtime.bigint();
    const startMs = Date.now();
    
    return {
        label,
        startTime,
        startMs,
        
        /**
         * Stop the timer and get elapsed time in ms
         * @returns {number} Elapsed time in milliseconds
         */
        stop() {
            const endTime = process.hrtime.bigint();
            const elapsedNs = Number(endTime - startTime);
            const elapsedMs = elapsedNs / 1_000_000;
            return Math.round(elapsedMs * 100) / 100; // 2 decimal places
        },
        
        /**
         * Stop and record the timing
         * @param {String} category - Category to record under
         * @returns {number} Elapsed time in milliseconds
         */
        stopAndRecord(category) {
            const elapsedMs = this.stop();
            recordTiming(category, elapsedMs);
            return elapsedMs;
        }
    };
}

/**
 * Record a timing measurement
 * @param {String} category - Timing category
 * @param {Number} ms - Elapsed milliseconds
 */
function recordTiming(category, ms) {
    if (!recentTimings[category]) {
        recentTimings[category] = [];
    }
    
    recentTimings[category].push({
        ms,
        timestamp: Date.now()
    });
    
    // Keep buffer size limited
    if (recentTimings[category].length > MAX_BUFFER_SIZE) {
        recentTimings[category].shift();
    }
}

/**
 * Get timing statistics for a category
 * @param {String} category - Timing category
 * @returns {Object} Stats object with min, max, avg, p50, p95, p99
 */
function getTimingStats(category) {
    const timings = recentTimings[category] || [];
    
    if (timings.length === 0) {
        return {
            count: 0,
            min: null,
            max: null,
            avg: null,
            p50: null,
            p95: null,
            p99: null
        };
    }
    
    const values = timings.map(t => t.ms).sort((a, b) => a - b);
    const count = values.length;
    
    return {
        count,
        min: values[0],
        max: values[count - 1],
        avg: Math.round((values.reduce((a, b) => a + b, 0) / count) * 100) / 100,
        p50: values[Math.floor(count * 0.5)],
        p95: values[Math.floor(count * 0.95)],
        p99: values[Math.floor(count * 0.99)]
    };
}

/**
 * Get all timing statistics
 * @returns {Object} All category stats
 */
function getAllTimingStats() {
    const stats = {};
    for (const category of Object.keys(recentTimings)) {
        stats[category] = getTimingStats(category);
    }
    return stats;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL TIMING CONTEXT
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Create a timing context for a single call/request
 * Tracks all phases of processing
 */
function createCallTimingContext(callId) {
    const context = {
        callId,
        startedAt: Date.now(),
        phases: {},
        
        /**
         * Start timing a phase
         * @param {String} phaseName - Name of the phase
         */
        startPhase(phaseName) {
            this.phases[phaseName] = {
                startedAt: Date.now(),
                startHr: process.hrtime.bigint(),
                endedAt: null,
                durationMs: null
            };
        },
        
        /**
         * End timing a phase
         * @param {String} phaseName - Name of the phase
         * @returns {number} Duration in ms
         */
        endPhase(phaseName) {
            const phase = this.phases[phaseName];
            if (!phase) {
                logger.warn(`[TIMING] Phase "${phaseName}" was never started`);
                return 0;
            }
            
            phase.endedAt = Date.now();
            phase.durationMs = Number(process.hrtime.bigint() - phase.startHr) / 1_000_000;
            phase.durationMs = Math.round(phase.durationMs * 100) / 100;
            
            // Also record to global stats
            recordTiming(phaseName, phase.durationMs);
            
            return phase.durationMs;
        },
        
        /**
         * Get summary of all phases
         * @returns {Object} Phase durations and total
         */
        getSummary() {
            const summary = {
                callId: this.callId,
                startedAt: this.startedAt,
                totalMs: Date.now() - this.startedAt,
                phases: {}
            };
            
            for (const [name, phase] of Object.entries(this.phases)) {
                summary.phases[name] = phase.durationMs ?? 'in_progress';
            }
            
            return summary;
        },
        
        /**
         * Get X-Timing header value
         * @returns {String} Formatted timing header
         */
        getTimingHeader() {
            const parts = [];
            for (const [name, phase] of Object.entries(this.phases)) {
                if (phase.durationMs !== null) {
                    parts.push(`${name};dur=${phase.durationMs}`);
                }
            }
            return parts.join(', ');
        }
    };
    
    return context;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPRESS MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Express middleware to add timing context to requests
 */
function timingMiddleware(req, res, next) {
    req.timing = createCallTimingContext(req.headers['x-request-id'] || Date.now().toString());
    req.timing.startPhase('total');
    
    // Add timing header on response
    const originalEnd = res.end;
    res.end = function(...args) {
        req.timing.endPhase('total');
        
        // Add Server-Timing header
        const timingHeader = req.timing.getTimingHeader();
        if (timingHeader) {
            res.setHeader('Server-Timing', timingHeader);
        }
        
        // Add summary as JSON in custom header
        res.setHeader('X-Timing-Summary', JSON.stringify(req.timing.getSummary().phases));
        
        return originalEnd.apply(this, args);
    };
    
    next();
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TIMING API ENDPOINT
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Get timing statistics for API response
 */
function getTimingReport() {
    return {
        generatedAt: new Date().toISOString(),
        bufferSize: MAX_BUFFER_SIZE,
        categories: getAllTimingStats()
    };
}

module.exports = {
    startTimer,
    recordTiming,
    getTimingStats,
    getAllTimingStats,
    createCallTimingContext,
    timingMiddleware,
    getTimingReport
};


// ============================================================================
// AI PERFORMANCE TRACKER SERVICE
// ============================================================================
// 📋 PURPOSE: Real-time tracking of AI agent performance metrics
// 🎯 FEATURES:
//    - Track lookup speeds at each stage
//    - Monitor cache hit/miss rates
//    - Record source distribution
//    - Aggregate metrics in 15-minute intervals
// 🔍 USAGE: Automatically called by v2AIAgentRuntime
// ============================================================================

const v2AIPerformanceMetric = require('../models/v2AIPerformanceMetric');
const mongoose = require('mongoose');

class AIPerformanceTracker {
    // ========================================================================
    // IN-MEMORY BUFFER (aggregates before DB write)
    // ========================================================================
    static buffer = new Map(); // Key: `${companyId}:${intervalStart}`

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    static INTERVAL_MINUTES = 15; // Aggregate metrics every 15 minutes
    static SLOW_QUERY_THRESHOLD = 50; // milliseconds

    /**
     * ────────────────────────────────────────────────────────────────────────
     * TRACK SINGLE LOOKUP
     * ────────────────────────────────────────────────────────────────────────
     * @param {string} companyId - Company ID
     * @param {object} timings - Breakdown of timings for each stage
     * @param {string} source - Which knowledge source was used
     * @param {number} confidence - Confidence score
     * @param {boolean} cacheHit - Was Redis cache hit?
     * @param {string} customerQuery - User's question
     */
    static async trackLookup({
        companyId,
        timings,
        source,
        confidence,
        cacheHit,
        customerQuery
    }) {
        try {
            console.log(`📊 [PERF TRACKER] CHECKPOINT 1: Starting lookup tracking for company: ${companyId}`);
            console.log(`📊 [PERF TRACKER] CHECKPOINT 2: Timings:`, JSON.stringify(timings, null, 2));
            console.log(`📊 [PERF TRACKER] CHECKPOINT 3: Source: ${source}, Confidence: ${confidence}, Cache Hit: ${cacheHit}`);

            // ================================================================
            // STEP 1: Determine current interval
            // ================================================================
            const now = new Date();
            const intervalStart = this.getIntervalStart(now);
            const intervalEnd = new Date(intervalStart.getTime() + this.INTERVAL_MINUTES * 60 * 1000);
            const bufferKey = `${companyId}:${intervalStart.toISOString()}`;

            console.log(`📊 [PERF TRACKER] CHECKPOINT 4: Interval: ${intervalStart.toISOString()} to ${intervalEnd.toISOString()}`);
            console.log(`📊 [PERF TRACKER] CHECKPOINT 5: Buffer key: ${bufferKey}`);

            // ================================================================
            // STEP 2: Get or create buffer entry
            // ================================================================
            if (!this.buffer.has(bufferKey)) {
                console.log(`📊 [PERF TRACKER] CHECKPOINT 6: Creating new buffer entry`);
                this.buffer.set(bufferKey, {
                    companyId,
                    intervalStart,
                    intervalEnd,
                    lookupSpeed: {
                        mongoLookup: { sum: 0, min: Infinity, max: 0, count: 0 },
                        redisCache: { sum: 0, min: Infinity, max: 0, count: 0 },
                        templateLoading: { sum: 0, min: Infinity, max: 0, count: 0 },
                        scenarioMatching: { sum: 0, min: Infinity, max: 0, count: 0 },
                        confidenceCalculation: { sum: 0, min: Infinity, max: 0, count: 0 },
                        responseGeneration: { sum: 0, min: Infinity, max: 0, count: 0 },
                        total: { sum: 0, min: Infinity, max: 0, count: 0 }
                    },
                    sourceDistribution: {
                        companyQnA: 0,
                        tradeQnA: 0,
                        templates: 0,
                        inHouseFallback: 0,
                        totalLookups: 0
                    },
                    cacheStats: {
                        hits: 0,
                        misses: 0,
                        hitTimeSum: 0,
                        missTimeSum: 0
                    },
                    confidenceDistribution: {
                        high: 0,
                        medium: 0,
                        low: 0,
                        confidenceSum: 0
                    },
                    slowQueries: []
                });
            }

            const buffer = this.buffer.get(bufferKey);
            console.log(`📊 [PERF TRACKER] CHECKPOINT 7: Buffer entry retrieved`);

            // ================================================================
            // STEP 3: Update timing statistics
            // ================================================================
            console.log(`📊 [PERF TRACKER] CHECKPOINT 8: Updating timing statistics`);
            
            this.updateTimingStat(buffer.lookupSpeed.mongoLookup, timings.mongoLookup || 0);
            this.updateTimingStat(buffer.lookupSpeed.redisCache, timings.redisCache || 0);
            this.updateTimingStat(buffer.lookupSpeed.templateLoading, timings.templateLoading || 0);
            this.updateTimingStat(buffer.lookupSpeed.scenarioMatching, timings.scenarioMatching || 0);
            this.updateTimingStat(buffer.lookupSpeed.confidenceCalculation, timings.confidenceCalculation || 0);
            this.updateTimingStat(buffer.lookupSpeed.responseGeneration, timings.responseGeneration || 0);
            this.updateTimingStat(buffer.lookupSpeed.total, timings.total || 0);

            // ================================================================
            // STEP 4: Update source distribution
            // ================================================================
            console.log(`📊 [PERF TRACKER] CHECKPOINT 9: Updating source distribution`);
            
            buffer.sourceDistribution.totalLookups++;
            if (source === 'companyQnA') buffer.sourceDistribution.companyQnA++;
            else if (source === 'tradeQnA') buffer.sourceDistribution.tradeQnA++;
            else if (source === 'templates') buffer.sourceDistribution.templates++;
            else if (source === 'inHouseFallback') buffer.sourceDistribution.inHouseFallback++;

            // ================================================================
            // STEP 5: Update cache statistics
            // ================================================================
            console.log(`📊 [PERF TRACKER] CHECKPOINT 10: Updating cache statistics`);
            
            if (cacheHit) {
                buffer.cacheStats.hits++;
                buffer.cacheStats.hitTimeSum += (timings.redisCache || 0);
            } else {
                buffer.cacheStats.misses++;
                buffer.cacheStats.missTimeSum += (timings.mongoLookup || 0);
            }

            // ================================================================
            // STEP 6: Update confidence distribution
            // ================================================================
            console.log(`📊 [PERF TRACKER] CHECKPOINT 11: Updating confidence distribution`);
            
            buffer.confidenceDistribution.confidenceSum += confidence;
            if (confidence >= 0.8) buffer.confidenceDistribution.high++;
            else if (confidence >= 0.5) buffer.confidenceDistribution.medium++;
            else buffer.confidenceDistribution.low++;

            // ================================================================
            // STEP 7: Track slow queries
            // ================================================================
            console.log(`📊 [PERF TRACKER] CHECKPOINT 12: Checking for slow queries`);
            
            if (timings.total >= this.SLOW_QUERY_THRESHOLD) {
                console.log(`⚠️ [PERF TRACKER] SLOW QUERY DETECTED: ${timings.total}ms`);
                buffer.slowQueries.push({
                    queryType: source,
                    duration: timings.total,
                    timestamp: now,
                    customerQuery: customerQuery?.substring(0, 100) // Limit length
                });
                
                // Keep only last 10 slow queries per interval
                if (buffer.slowQueries.length > 10) {
                    buffer.slowQueries.shift();
                }
            }

            console.log(`✅ [PERF TRACKER] CHECKPOINT 13: Lookup tracked successfully`);
            console.log(`📊 [PERF TRACKER] Current buffer stats: ${buffer.sourceDistribution.totalLookups} lookups`);

            // ================================================================
            // STEP 8: Persist if interval ended
            // ================================================================
            if (now >= intervalEnd) {
                console.log(`⏰ [PERF TRACKER] Interval ended, persisting metrics...`);
                await this.persistBuffer(bufferKey);
            }

        } catch (error) {
            console.error(`❌ [PERF TRACKER] ERROR tracking lookup:`, error);
            console.error(`❌ [PERF TRACKER] Stack:`, error.stack);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * UPDATE TIMING STAT (helper)
     * ────────────────────────────────────────────────────────────────────────
     */
    static updateTimingStat(stat, value) {
        stat.sum += value;
        stat.count++;
        if (value < stat.min) stat.min = value;
        if (value > stat.max) stat.max = value;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * GET INTERVAL START (rounds down to nearest interval)
     * ────────────────────────────────────────────────────────────────────────
     */
    static getIntervalStart(date) {
        const minutes = date.getMinutes();
        const roundedMinutes = Math.floor(minutes / this.INTERVAL_MINUTES) * this.INTERVAL_MINUTES;
        const intervalStart = new Date(date);
        intervalStart.setMinutes(roundedMinutes);
        intervalStart.setSeconds(0);
        intervalStart.setMilliseconds(0);
        return intervalStart;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * PERSIST BUFFER TO DATABASE
     * ────────────────────────────────────────────────────────────────────────
     */
    static async persistBuffer(bufferKey) {
        try {
            console.log(`💾 [PERF TRACKER] CHECKPOINT 14: Persisting buffer: ${bufferKey}`);
            
            const buffer = this.buffer.get(bufferKey);
            if (!buffer) {
                console.log(`⚠️ [PERF TRACKER] Buffer not found: ${bufferKey}`);
                return;
            }

            // ================================================================
            // Calculate averages and hit rates
            // ================================================================
            const calculateAvg = (stat) => stat.count > 0 ? stat.sum / stat.count : 0;
            
            const cacheHitRate = (buffer.cacheStats.hits + buffer.cacheStats.misses) > 0
                ? (buffer.cacheStats.hits / (buffer.cacheStats.hits + buffer.cacheStats.misses)) * 100
                : 0;

            const avgHitTime = buffer.cacheStats.hits > 0
                ? buffer.cacheStats.hitTimeSum / buffer.cacheStats.hits
                : 0;

            const avgMissTime = buffer.cacheStats.misses > 0
                ? buffer.cacheStats.missTimeSum / buffer.cacheStats.misses
                : 0;

            const avgConfidence = buffer.sourceDistribution.totalLookups > 0
                ? buffer.confidenceDistribution.confidenceSum / buffer.sourceDistribution.totalLookups
                : 0;

            // ================================================================
            // Create database document
            // ================================================================
            const metricData = {
                companyId: buffer.companyId,
                timestamp: buffer.intervalStart,
                intervalStart: buffer.intervalStart,
                intervalEnd: buffer.intervalEnd,
                
                lookupSpeed: {
                    mongoLookup: {
                        avg: calculateAvg(buffer.lookupSpeed.mongoLookup),
                        min: buffer.lookupSpeed.mongoLookup.min === Infinity ? 0 : buffer.lookupSpeed.mongoLookup.min,
                        max: buffer.lookupSpeed.mongoLookup.max,
                        count: buffer.lookupSpeed.mongoLookup.count
                    },
                    redisCache: {
                        avg: calculateAvg(buffer.lookupSpeed.redisCache),
                        min: buffer.lookupSpeed.redisCache.min === Infinity ? 0 : buffer.lookupSpeed.redisCache.min,
                        max: buffer.lookupSpeed.redisCache.max,
                        count: buffer.lookupSpeed.redisCache.count
                    },
                    templateLoading: {
                        avg: calculateAvg(buffer.lookupSpeed.templateLoading),
                        min: buffer.lookupSpeed.templateLoading.min === Infinity ? 0 : buffer.lookupSpeed.templateLoading.min,
                        max: buffer.lookupSpeed.templateLoading.max,
                        count: buffer.lookupSpeed.templateLoading.count
                    },
                    scenarioMatching: {
                        avg: calculateAvg(buffer.lookupSpeed.scenarioMatching),
                        min: buffer.lookupSpeed.scenarioMatching.min === Infinity ? 0 : buffer.lookupSpeed.scenarioMatching.min,
                        max: buffer.lookupSpeed.scenarioMatching.max,
                        count: buffer.lookupSpeed.scenarioMatching.count
                    },
                    confidenceCalculation: {
                        avg: calculateAvg(buffer.lookupSpeed.confidenceCalculation),
                        min: buffer.lookupSpeed.confidenceCalculation.min === Infinity ? 0 : buffer.lookupSpeed.confidenceCalculation.min,
                        max: buffer.lookupSpeed.confidenceCalculation.max,
                        count: buffer.lookupSpeed.confidenceCalculation.count
                    },
                    responseGeneration: {
                        avg: calculateAvg(buffer.lookupSpeed.responseGeneration),
                        min: buffer.lookupSpeed.responseGeneration.min === Infinity ? 0 : buffer.lookupSpeed.responseGeneration.min,
                        max: buffer.lookupSpeed.responseGeneration.max,
                        count: buffer.lookupSpeed.responseGeneration.count
                    },
                    total: {
                        avg: calculateAvg(buffer.lookupSpeed.total),
                        min: buffer.lookupSpeed.total.min === Infinity ? 0 : buffer.lookupSpeed.total.min,
                        max: buffer.lookupSpeed.total.max,
                        count: buffer.lookupSpeed.total.count
                    }
                },
                
                sourceDistribution: buffer.sourceDistribution,
                
                cacheStats: {
                    hits: buffer.cacheStats.hits,
                    misses: buffer.cacheStats.misses,
                    hitRate: Math.round(cacheHitRate * 100) / 100,
                    avgHitTime: Math.round(avgHitTime * 100) / 100,
                    avgMissTime: Math.round(avgMissTime * 100) / 100
                },
                
                confidenceDistribution: {
                    high: buffer.confidenceDistribution.high,
                    medium: buffer.confidenceDistribution.medium,
                    low: buffer.confidenceDistribution.low,
                    avgConfidence: Math.round(avgConfidence * 100) / 100
                },
                
                slowQueries: buffer.slowQueries
            };

            console.log(`💾 [PERF TRACKER] CHECKPOINT 15: Saving to database...`);
            console.log(`💾 [PERF TRACKER] Total lookups: ${buffer.sourceDistribution.totalLookups}`);
            console.log(`💾 [PERF TRACKER] Avg speed: ${Math.round(calculateAvg(buffer.lookupSpeed.total))}ms`);
            console.log(`💾 [PERF TRACKER] Cache hit rate: ${Math.round(cacheHitRate)}%`);

            await v2AIPerformanceMetric.create(metricData);

            console.log(`✅ [PERF TRACKER] CHECKPOINT 16: Metrics persisted successfully`);

            // ================================================================
            // Remove from buffer
            // ================================================================
            this.buffer.delete(bufferKey);
            console.log(`🗑️ [PERF TRACKER] Buffer cleared: ${bufferKey}`);

        } catch (error) {
            console.error(`❌ [PERF TRACKER] ERROR persisting buffer:`, error);
            console.error(`❌ [PERF TRACKER] Stack:`, error.stack);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * FLUSH ALL BUFFERS (called on server shutdown)
     * ────────────────────────────────────────────────────────────────────────
     */
    static async flushAllBuffers() {
        console.log(`🔄 [PERF TRACKER] Flushing all buffers...`);
        
        const bufferKeys = Array.from(this.buffer.keys());
        console.log(`🔄 [PERF TRACKER] Found ${bufferKeys.length} buffers to flush`);
        
        for (const key of bufferKeys) {
            await this.persistBuffer(key);
        }
        
        console.log(`✅ [PERF TRACKER] All buffers flushed`);
    }
}

// ============================================================================
// AUTO-FLUSH EVERY 15 MINUTES
// ============================================================================
setInterval(async () => {
    console.log(`⏰ [PERF TRACKER] Auto-flush triggered`);
    
    const now = new Date();
    const currentIntervalStart = AIPerformanceTracker.getIntervalStart(now);
    
    // Flush all buffers from previous intervals
    for (const [key, buffer] of AIPerformanceTracker.buffer.entries()) {
        if (buffer.intervalEnd <= currentIntervalStart) {
            console.log(`⏰ [PERF TRACKER] Flushing expired buffer: ${key}`);
            await AIPerformanceTracker.persistBuffer(key);
        }
    }
}, AIPerformanceTracker.INTERVAL_MINUTES * 60 * 1000);

// ============================================================================
// EXPORT
// ============================================================================
module.exports = AIPerformanceTracker;


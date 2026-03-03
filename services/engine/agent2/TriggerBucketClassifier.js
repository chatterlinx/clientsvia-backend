/**
 * ============================================================================
 * TRIGGER BUCKET CLASSIFIER - Intent-based trigger pool filtering
 * ============================================================================
 * 
 * Classifies caller input into trigger buckets for faster response times.
 * 
 * PERFORMANCE IMPACT:
 * - Before: Evaluate all 43 triggers (~500ms)
 * - After: Evaluate ~15 bucket-matched triggers (~200ms)
 * - Savings: ~300ms per turn = less awkward silence
 * 
 * CLASSIFICATION ALGORITHM:
 * 1. Load company's buckets (cached, <1ms)
 * 2. Score each bucket against normalized input
 * 3. Return highest-scoring bucket above confidence threshold
 * 4. If no bucket matches threshold, return null (use full pool)
 * 
 * SCORING LOGIC:
 * - Word-based matching (same as TriggerCardMatcher)
 * - All words in keyword must appear in input
 * - Score = (matched keywords / total keywords) * bucket priority weight
 * - Higher score = better match
 * 
 * SAFETY:
 * - Graceful degradation if buckets fail to load
 * - Confidence threshold prevents false positives
 * - Always-evaluate buckets bypass filtering
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const TriggerBucket = require('../../../models/TriggerBucket');

// Cache buckets per company (refresh every 60s)
const bucketCache = new Map();
const BUCKET_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Normalize text for matching (lowercase, trim).
 */
function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

/**
 * Extract words from text (same logic as TriggerCardMatcher).
 */
function extractWords(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Check if all words in keyword appear in input.
 */
function matchesAllWords(input, keyword) {
  const inputWords = new Set(extractWords(input));
  const keywordWords = extractWords(keyword);
  
  if (keywordWords.length === 0) return false;
  
  return keywordWords.every(kw => inputWords.has(kw));
}

/**
 * Score a bucket against input text.
 * Returns score between 0.0 and 1.0.
 */
function scoreBucket(input, bucket) {
  const keywords = bucket.classificationKeywords || [];
  if (keywords.length === 0) return 0;
  
  let matchedCount = 0;
  const matchedKeywords = [];
  
  for (const keyword of keywords) {
    if (matchesAllWords(input, keyword)) {
      matchedCount++;
      matchedKeywords.push(keyword);
    }
  }
  
  if (matchedCount === 0) return 0;
  
  // Base score: percentage of keywords that matched
  const baseScore = matchedCount / keywords.length;
  
  // Apply priority weight (higher priority = higher score)
  // Priority 1-10 get 1.2x boost, 11-50 get 1.0x, 51+ get 0.8x
  const priorityWeight = bucket.priority <= 10 ? 1.2 :
                         bucket.priority <= 50 ? 1.0 : 0.8;
  
  const finalScore = Math.min(1.0, baseScore * priorityWeight);
  
  return {
    score: finalScore,
    matchedCount,
    totalKeywords: keywords.length,
    matchedKeywords
  };
}

class TriggerBucketClassifier {
  /**
   * Load buckets for a company (with caching).
   */
  static async loadBuckets(companyId) {
    const cacheKey = `buckets:${companyId}`;
    const cached = bucketCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < BUCKET_CACHE_TTL) {
      return cached.buckets;
    }
    
    try {
      const buckets = await TriggerBucket.findActiveByCompanyId(companyId);
      
      // Validate buckets have keywords
      const validBuckets = buckets.filter(b => {
        const hasKeywords = b.classificationKeywords?.length > 0;
        if (!hasKeywords) {
          logger.warn('[TriggerBucketClassifier] Bucket missing keywords - skipping', {
            companyId,
            bucketId: b.bucketId,
            name: b.name
          });
        }
        return hasKeywords;
      });
      
      // Cache result
      bucketCache.set(cacheKey, {
        buckets: validBuckets,
        timestamp: Date.now()
      });
      
      logger.debug('[TriggerBucketClassifier] Buckets loaded', {
        companyId,
        totalBuckets: buckets.length,
        validBuckets: validBuckets.length,
        bucketIds: validBuckets.map(b => b.bucketId)
      });
      
      return validBuckets;
      
    } catch (error) {
      logger.error('[TriggerBucketClassifier] Failed to load buckets', {
        companyId,
        error: error.message
      });
      return [];
    }
  }
  
  /**
   * Classify input text into a bucket.
   * 
   * @param {string} inputText - Normalized caller input (from ScrabEngine)
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Classification result
   */
  static async classify(inputText, companyId) {
    const input = normalizeText(inputText);
    
    const result = {
      matched: false,
      bucket: null,
      bucketName: null,
      confidence: 0,
      matchedKeywords: [],
      allScores: [],
      bucketsAvailable: 0,
      threshold: 0.70
    };
    
    if (!input) {
      logger.debug('[TriggerBucketClassifier] Empty input, no classification');
      return result;
    }
    
    // Load buckets for company
    const buckets = await this.loadBuckets(companyId);
    result.bucketsAvailable = buckets.length;
    
    if (buckets.length === 0) {
      logger.debug('[TriggerBucketClassifier] No buckets configured for company', {
        companyId
      });
      return result;
    }
    
    // Score each bucket
    const scores = [];
    for (const bucket of buckets) {
      const scoreResult = scoreBucket(input, bucket);
      
      if (scoreResult.score > 0) {
        scores.push({
          bucketId: bucket.bucketId,
          name: bucket.name,
          score: scoreResult.score,
          matchedCount: scoreResult.matchedCount,
          totalKeywords: scoreResult.totalKeywords,
          matchedKeywords: scoreResult.matchedKeywords,
          threshold: bucket.confidenceThreshold || 0.70,
          priority: bucket.priority,
          alwaysEvaluate: bucket.alwaysEvaluate
        });
      }
    }
    
    // Sort by score (descending)
    scores.sort((a, b) => b.score - a.score);
    result.allScores = scores;
    
    // Find first bucket above its confidence threshold
    const winner = scores.find(s => s.score >= s.threshold);
    
    if (winner) {
      result.matched = true;
      result.bucket = winner.bucketId;
      result.bucketName = winner.name;
      result.confidence = winner.score;
      result.matchedKeywords = winner.matchedKeywords;
      result.threshold = winner.threshold;
      
      logger.info('[TriggerBucketClassifier] Bucket matched', {
        companyId,
        bucket: winner.bucketId,
        bucketName: winner.name,
        confidence: winner.score,
        matchedKeywords: winner.matchedKeywords,
        inputPreview: input.substring(0, 60)
      });
      
      // Record usage (async, don't wait)
      TriggerBucket.recordUsage(companyId, winner.bucketId, winner.score)
        .catch(err => {
          logger.warn('[TriggerBucketClassifier] Failed to record usage', {
            companyId,
            bucketId: winner.bucketId,
            error: err.message
          });
        });
      
    } else {
      logger.debug('[TriggerBucketClassifier] No bucket matched above threshold', {
        companyId,
        highestScore: scores[0]?.score || 0,
        highestBucket: scores[0]?.bucketId || null,
        inputPreview: input.substring(0, 60)
      });
    }
    
    return result;
  }
  
  /**
   * Invalidate bucket cache for a company.
   * Call this when buckets are created/updated/deleted.
   */
  static invalidateCacheForCompany(companyId) {
    const cacheKey = `buckets:${companyId}`;
    bucketCache.delete(cacheKey);
    
    logger.debug('[TriggerBucketClassifier] Cache invalidated', {
      companyId
    });
  }
  
  /**
   * Invalidate all bucket caches.
   */
  static invalidateAllCache() {
    const size = bucketCache.size;
    bucketCache.clear();
    
    logger.info('[TriggerBucketClassifier] All cache cleared', {
      entriesCleared: size
    });
  }
  
  /**
   * Filter trigger pool by bucket classification.
   * 
   * @param {Array} triggers - Full trigger pool
   * @param {Object} bucketResult - Result from classify()
   * @returns {Object} Filtered pool and metadata
   */
  static filterTriggerPool(triggers, bucketResult) {
    // If no bucket matched, return full pool
    if (!bucketResult.matched) {
      return {
        filtered: false,
        pool: triggers,
        reason: 'No bucket matched above threshold'
      };
    }
    
    const detectedBucket = bucketResult.bucket;
    
    // Filter triggers: include if bucket matches OR alwaysEvaluate
    const filteredPool = triggers.filter(trigger => {
      // Always include emergency triggers
      if (trigger.alwaysEvaluate === true) return true;
      
      // Include if bucket matches
      return trigger.bucket === detectedBucket;
    });
    
    const alwaysEvaluateCount = filteredPool.filter(t => t.alwaysEvaluate).length;
    const bucketMatchCount = filteredPool.filter(t => !t.alwaysEvaluate).length;
    
    return {
      filtered: true,
      pool: filteredPool,
      detectedBucket,
      confidence: bucketResult.confidence,
      originalSize: triggers.length,
      filteredSize: filteredPool.length,
      alwaysEvaluateCount,
      bucketMatchCount,
      reduction: triggers.length > 0 
        ? Math.round((1 - filteredPool.length / triggers.length) * 100) 
        : 0
    };
  }
}

module.exports = { TriggerBucketClassifier };

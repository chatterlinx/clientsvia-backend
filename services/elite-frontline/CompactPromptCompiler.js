/**
 * ============================================================================
 * COMPACT PROMPT COMPILER - ELITE FRONTLINE-INTEL V23
 * ============================================================================
 * 
 * PURPOSE: On-demand compilation of Micro-LLM routing prompts
 * ARCHITECTURE: MongoDB (Triage Cards) → Compiled Prompt → Redis Cache
 * PERFORMANCE: <80ms first compile, <3ms cached
 * 
 * TOKEN BUDGET: <600 tokens total
 * - Fixed system (100 tokens)
 * - Dynamic triage rules (400 tokens)
 * - Caller context (50 tokens)
 * - Emotion hints (50 tokens)
 * 
 * CACHING STRATEGY:
 * - Key: `frontline:prompt:v23:{companyId}:{versionHash}`
 * - TTL: 1 hour
 * - Invalidate on Triage Card changes
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const TriageCard = require('../../models/TriageCard');
const PromptVersion = require('../../models/routing/PromptVersion');
const { murmurhashObject } = require('../../utils/murmurhash');
const { estimateTokenCount, checkTokenLimit } = require('../../utils/promptTokenCounter');
const redisClient = require('../../config/redis');

// ============================================================================
// FIXED TEMPLATE (100 tokens)
// ============================================================================

const SYSTEM_TEMPLATE = `You are Frontline-Intel for {companyName}.

YOUR ROLE: Analyze caller input and route to the correct scenario.
You are a ROUTER, not a conversationalist.

CRITICAL RULES:
- Return ONLY valid JSON (no extra text)
- Be fast, accurate, confident
- Match caller intent to scenario
- Consider emotion and urgency`;

// ============================================================================
// OUTPUT SCHEMA TEMPLATE (Fixed)
// ============================================================================

const OUTPUT_SCHEMA = `
OUTPUT FORMAT (strict JSON):
{
  "target": "SCENARIO_KEY",
  "thought": "1 sentence why",
  "confidence": 0.0 to 1.0,
  "priority": "NORMAL" | "HIGH" | "EMERGENCY"
}`;

// ============================================================================
// MAIN CLASS
// ============================================================================

class CompactPromptCompiler {
  
  /**
   * Get compiled prompt for a company (cached)
   * 
   * @param {string} companyId - Company ObjectId
   * @param {Object} context - { callerContext, emotion }
   * @returns {Promise<Object>} { prompt, version, versionHash }
   */
  static async getPrompt(companyId, context = {}) {
    const startTime = Date.now();
    
    try {
      // Step 1: Fetch active Triage Cards
      const triageCards = await TriageCard.find({
        companyId,
        active: true
      }).lean();
      
      if (!triageCards || triageCards.length === 0) {
        logger.warn('[COMPACT PROMPT COMPILER] No active Triage Cards found', {
          companyId
        });
        
        return this._buildFallbackPrompt(companyId, context);
      }
      
      // Step 2: Calculate version hash (for cache key)
      const versionHash = murmurhashObject(triageCards.map(c => c._id.toString()));
      const cacheKey = `frontline:prompt:v23:${companyId}:${versionHash}`;
      
      // Step 3: Check Redis cache
      const cached = await this._getFromCache(cacheKey);
      if (cached) {
        logger.debug('[COMPACT PROMPT COMPILER] Cache hit', {
          companyId,
          versionHash,
          latency: Date.now() - startTime
        });
        
        return {
          prompt: cached,
          version: cached.version || 'cached',
          versionHash,
          cached: true
        };
      }
      
      // Step 4: Compile prompt from scratch
      const compiled = await this._compile(companyId, triageCards, context);
      
      // Step 5: Check token limit
      const tokenCheck = checkTokenLimit(compiled.fullPrompt, 600);
      
      if (!tokenCheck.withinLimit) {
        logger.warn('[COMPACT PROMPT COMPILER] Token limit exceeded', {
          companyId,
          estimatedTokens: tokenCheck.estimatedTokens,
          limit: tokenCheck.limit,
          overagePercent: tokenCheck.overagePercent
        });
        
        // Truncate triage rules if needed
        compiled.fullPrompt = this._truncateTriageRules(compiled, 600);
      }
      
      // Step 6: Save to cache
      await this._saveToCache(cacheKey, compiled);
      
      // Step 7: Save as PromptVersion (for history tracking)
      await this._saveVersion(companyId, versionHash, compiled, triageCards);
      
      logger.info('[COMPACT PROMPT COMPILER] Prompt compiled', {
        companyId,
        versionHash,
        triageCardCount: triageCards.length,
        estimatedTokens: tokenCheck.estimatedTokens,
        latency: Date.now() - startTime
      });
      
      return {
        prompt: compiled.fullPrompt,
        version: compiled.version,
        versionHash,
        cached: false,
        tokenCount: tokenCheck.estimatedTokens
      };
      
    } catch (err) {
      logger.error('[COMPACT PROMPT COMPILER] Compilation failed', {
        error: err.message,
        stack: err.stack,
        companyId
      });
      
      // Safe fallback
      return this._buildFallbackPrompt(companyId, context);
    }
  }
  
  /**
   * Compile prompt from Triage Cards
   * @private
   */
  static async _compile(companyId, triageCards, context) {
    const companyName = context.companyName || 'this company';
    
    // Build system prompt
    let systemPrompt = SYSTEM_TEMPLATE.replace('{companyName}', companyName);
    
    // Build triage rules section
    const triageRules = this._buildTriageRulesSection(triageCards);
    
    // Build caller context section (if available)
    const callerContext = this._buildCallerContextSection(context.callerContext);
    
    // Build emotion hints section (if available)
    const emotionHints = this._buildEmotionHintsSection(context.emotion);
    
    // Assemble full prompt
    const fullPrompt = [
      systemPrompt,
      triageRules,
      callerContext,
      emotionHints,
      OUTPUT_SCHEMA
    ]
      .filter(Boolean)
      .join('\n\n');
    
    return {
      fullPrompt,
      version: 'v1.0', // Auto-increment in production
      systemPrompt,
      triageRules,
      callerContext,
      emotionHints
    };
  }
  
  /**
   * Build triage rules section from cards
   * @private
   */
  static _buildTriageRulesSection(triageCards) {
    const rules = [];
    
    for (const card of triageCards) {
      const rule = {
        scenario: card.linkedScenarioKey || card.adminDescription || 'UNKNOWN',
        keywords: card.triggerKeywords || [],
        negativeKeywords: card.negativeKeywords || [],
        action: card.actionType || 'DIRECT_TO_3TIER'
      };
      
      // Compact format
      rules.push(rule);
    }
    
    return `ROUTING RULES:\n${JSON.stringify(rules, null, 2)}`;
  }
  
  /**
   * Build caller context section
   * @private
   */
  static _buildCallerContextSection(callerContext) {
    if (!callerContext || !callerContext.callerHistory) {
      return null;
    }
    
    const caller = callerContext.callerHistory[0];
    if (!caller) return null;
    
    const returning = (caller.totalCount || 0) > 1;
    
    return `CALLER CONTEXT:
Name: ${caller.firstName || 'Unknown'}
Status: ${returning ? 'Returning customer' : 'New caller'}
Last Issue: ${caller.lastIntent || 'None'}
Call Count: ${caller.totalCount || 1}`;
  }
  
  /**
   * Build emotion hints section
   * @private
   */
  static _buildEmotionHintsSection(emotion) {
    if (!emotion || !emotion.primary) {
      return null;
    }
    
    return `EMOTIONAL STATE: ${emotion.primary} (intensity: ${emotion.intensity.toFixed(2)})
Adjust urgency/priority accordingly.`;
  }
  
  /**
   * Truncate triage rules if token limit exceeded
   * @private
   */
  static _truncateTriageRules(compiled, tokenLimit) {
    // Simple truncation: remove lowest priority rules
    // In production, this would be more sophisticated
    logger.warn('[COMPACT PROMPT COMPILER] Truncating triage rules to fit token limit');
    
    return compiled.systemPrompt + '\n\n' + 
           compiled.triageRules.substring(0, 2000) + '...' + '\n\n' +
           OUTPUT_SCHEMA;
  }
  
  /**
   * Build fallback prompt (when no cards exist)
   * @private
   */
  static _buildFallbackPrompt(companyId, context) {
    const fallback = `You are Frontline-Intel. Route caller to appropriate scenario.

OUTPUT FORMAT:
{
  "target": "GENERAL_INQUIRY",
  "thought": "reason for routing",
  "confidence": 0.0 to 1.0,
  "priority": "NORMAL"
}`;
    
    return {
      prompt: fallback,
      version: 'fallback',
      versionHash: 'fallback',
      cached: false,
      tokenCount: estimateTokenCount(fallback)
    };
  }
  
  /**
   * Get from Redis cache
   * @private
   */
  static async _getFromCache(cacheKey) {
    try {
      const cached = await redisClient.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (err) {
      logger.error('[COMPACT PROMPT COMPILER] Redis get failed', {
        error: err.message,
        cacheKey
      });
      return null;
    }
  }
  
  /**
   * Save to Redis cache
   * @private
   */
  static async _saveToCache(cacheKey, compiled) {
    try {
      await redisClient.setex(
        cacheKey,
        3600, // 1 hour TTL
        JSON.stringify(compiled)
      );
    } catch (err) {
      logger.error('[COMPACT PROMPT COMPILER] Redis save failed', {
        error: err.message,
        cacheKey
      });
    }
  }
  
  /**
   * Save prompt version to MongoDB
   * @private
   */
  static async _saveVersion(companyId, versionHash, compiled, triageCards) {
    try {
      // Check if this version already exists
      const existing = await PromptVersion.findOne({
        companyId,
        versionHash
      });
      
      if (existing) {
        // Already saved
        return;
      }
      
      // Auto-increment version number
      const latestVersion = await PromptVersion.findOne({ companyId })
        .sort({ createdAt: -1 })
        .lean();
      
      const versionNumber = latestVersion
        ? this._incrementVersion(latestVersion.version)
        : 'v1.0';
      
      await PromptVersion.createVersion({
        companyId,
        version: versionNumber,
        versionHash,
        promptTemplate: compiled.fullPrompt,
        triageCardsSnapshot: triageCards.map(c => ({
          id: c._id.toString(),
          adminDescription: c.adminDescription,
          linkedScenarioKey: c.linkedScenarioKey
        })),
        tuningNotes: 'Auto-compiled from active Triage Cards',
        createdBy: 'system'
      });
      
    } catch (err) {
      logger.error('[COMPACT PROMPT COMPILER] Failed to save version', {
        error: err.message,
        companyId
      });
    }
  }
  
  /**
   * Increment version number (v1.0 → v1.1 → v2.0)
   * @private
   */
  static _incrementVersion(currentVersion) {
    const match = currentVersion.match(/v(\d+)\.(\d+)/);
    if (!match) return 'v1.0';
    
    const major = parseInt(match[1]);
    const minor = parseInt(match[2]);
    
    // Increment minor version
    return `v${major}.${minor + 1}`;
  }
  
  /**
   * Invalidate cache for a company (call when Triage Cards change)
   * 
   * @param {string} companyId
   */
  static async invalidateCache(companyId) {
    try {
      // Delete all cached prompts for this company
      const pattern = `frontline:prompt:v23:${companyId}:*`;
      const keys = await redisClient.keys(pattern);
      
      if (keys && keys.length > 0) {
        await redisClient.del(...keys);
        logger.info('[COMPACT PROMPT COMPILER] Cache invalidated', {
          companyId,
          keysDeleted: keys.length
        });
      }
    } catch (err) {
      logger.error('[COMPACT PROMPT COMPILER] Cache invalidation failed', {
        error: err.message,
        companyId
      });
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = CompactPromptCompiler;


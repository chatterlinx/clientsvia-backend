// ═════════════════════════════════════════════════════════════════════════════
// TRIAGE CARD SERVICE
// ═════════════════════════════════════════════════════════════════════════════
// Purpose: Business logic for Triage Card management + runtime compilation
// Responsibilities:
//   - CRUD operations on TriageCard collection
//   - Compile active cards → CompiledTriageConfig (cached in Redis)
//   - Auto-sync Category documents when cards are saved
//   - Cache invalidation hooks
// ═════════════════════════════════════════════════════════════════════════════

const TriageCard = require('../models/TriageCard');
// NOTE: Category model does not exist in this codebase
// Category/Scenario management is handled differently in v2Company model
// const Category = require('../models/Category');
const logger = require('../utils/logger');
const { createIORedisClient, isRedisConfigured } = require('./redisClientFactory');

// Redis client (lazy initialization via factory)
let redisClient = null;
function getRedisClient() {
  if (!redisClient && isRedisConfigured()) {
    // Use centralized factory - REDIS_URL only, no localhost fallback
    redisClient = createIORedisClient({
      retryDelayOnFailover: 100,
    });
    
    if (redisClient) {
      redisClient.on('error', (err) => {
        logger.warn('[TRIAGE CARD SERVICE] Redis error (non-critical, will fallback to DB)', { error: err.message });
      });
    }
  }
  return redisClient;
}

class TriageCardService {

  // ───────────────────────────────────────────────────────────────────────────
  // CRUD OPERATIONS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a new Triage Card
   * @param {String} companyId
   * @param {Object} cardData - { frontlineIntelBlock, triageMap, responses, category, trade, serviceTypes }
   * @param {String} createdBy - Admin ID
   * @returns {Promise<TriageCard>}
   */
  static async createCard(companyId, cardData, createdBy = null) {
    logger.info('[TRIAGE CARD SERVICE] Creating new card', { companyId, trade: cardData.trade });

    try {
      const card = new TriageCard({
        companyId,
        ...cardData,
        createdBy,
        lastModifiedBy: createdBy
      });

      await card.save();

      logger.info('[TRIAGE CARD SERVICE] ✅ Card created', { 
        cardId: card._id,
        categorySlug: card.category.slug 
      });

      // Auto-sync category if status is ACTIVE
      if (card.status === 'ACTIVE') {
        // NOTE: Category auto-sync disabled - Category model doesn't exist in this codebase
        // Scenario/Category management handled differently via v2Company model
        // await this.autoSyncCategory(card);
        await this.invalidateCache(companyId);
      }

      return card;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Create failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all cards for a company
   * @param {String} companyId
   * @param {Object} filter - Optional { status, trade }
   * @returns {Promise<TriageCard[]>}
   */
  static async getCardsByCompany(companyId, filter = {}) {
    logger.debug('[TRIAGE CARD SERVICE] Fetching cards', { companyId, filter });

    try {
      const query = { companyId, ...filter };
      const cards = await TriageCard.find(query).sort({ createdAt: -1 });

      logger.debug('[TRIAGE CARD SERVICE] ✅ Cards fetched', { 
        companyId, 
        count: cards.length 
      });

      return cards;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Fetch failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a single card by ID
   * @param {String} companyId
   * @param {String} cardId
   * @returns {Promise<TriageCard>}
   */
  static async getCardById(companyId, cardId) {
    logger.debug('[TRIAGE CARD SERVICE] Fetching card by ID', { companyId, cardId });

    try {
      const card = await TriageCard.findOne({ _id: cardId, companyId });

      if (!card) {
        throw new Error('Triage Card not found');
      }

      return card;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Fetch by ID failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Update a card
   * @param {String} companyId
   * @param {String} cardId
   * @param {Object} updates
   * @param {String} modifiedBy - Admin ID
   * @returns {Promise<TriageCard>}
   */
  static async updateCard(companyId, cardId, updates, modifiedBy = null) {
    logger.info('[TRIAGE CARD SERVICE] Updating card', { companyId, cardId });

    try {
      const card = await this.getCardById(companyId, cardId);

      // Apply updates
      Object.keys(updates).forEach(key => {
        if (key !== '_id' && key !== 'companyId' && key !== 'createdAt') {
          card[key] = updates[key];
        }
      });

      // Track who modified and when
      card.lastModifiedBy = modifiedBy;
      card.updatedAt = new Date();

      await card.save();

      logger.info('[TRIAGE CARD SERVICE] ✅ Card updated', { 
        cardId: card._id
      });

      // Auto-sync category if status is ACTIVE
      if (card.status === 'ACTIVE') {
        // NOTE: Category auto-sync disabled - Category model doesn't exist
        // await this.autoSyncCategory(card);
        await this.invalidateCache(companyId);
      }

      return card;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Update failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete a card
   * @param {String} companyId
   * @param {String} cardId
   * @returns {Promise<void>}
   */
  static async deleteCard(companyId, cardId) {
    logger.info('[TRIAGE CARD SERVICE] Deleting card', { companyId, cardId });

    try {
      const card = await this.getCardById(companyId, cardId);
      
      await TriageCard.deleteOne({ _id: cardId, companyId });

      logger.info('[TRIAGE CARD SERVICE] ✅ Card deleted', { cardId });

      // Invalidate cache
      await this.invalidateCache(companyId);

      return { success: true };

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Delete failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate a card
   * @param {String} companyId
   * @param {String} cardId
   * @returns {Promise<TriageCard>}
   */
  static async activateCard(companyId, cardId) {
    logger.info('[TRIAGE CARD SERVICE] Activating card', { companyId, cardId });

    try {
      const card = await this.getCardById(companyId, cardId);
      await card.activate();

      logger.info('[TRIAGE CARD SERVICE] ✅ Card activated', { cardId });

      // Auto-sync category and invalidate cache
      // NOTE: Category auto-sync disabled - Category model doesn't exist
      // await this.autoSyncCategory(card);
      await this.invalidateCache(companyId);

      return card;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Activate failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Deactivate a card
   * @param {String} companyId
   * @param {String} cardId
   * @returns {Promise<TriageCard>}
   */
  static async deactivateCard(companyId, cardId) {
    logger.info('[TRIAGE CARD SERVICE] Deactivating card', { companyId, cardId });

    try {
      const card = await this.getCardById(companyId, cardId);
      await card.deactivate();

      logger.info('[TRIAGE CARD SERVICE] ✅ Card deactivated', { cardId });

      // Invalidate cache
      await this.invalidateCache(companyId);

      return card;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Deactivate failed', { error: error.message });
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RUNTIME COMPILATION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Compile all ACTIVE cards + manual rules into ONE unified runtime config
   * @param {String} companyId
   * @returns {Promise<CompiledTriageConfig>}
   */
  static async compileActiveCards(companyId) {
    logger.info('[TRIAGE CARD SERVICE] 🧠 Compiling unified triage brain (cards + manual rules)', { companyId });

    try {
      // Check cache first
      const cacheKey = `triage:compiled:${companyId}`;
      
      try {
        const redis = getRedisClient();
        const cached = await redis.get(cacheKey);
        if (cached) {
          logger.debug('[TRIAGE CARD SERVICE] ✅ Returning cached compiled config');
          return JSON.parse(cached);
        }
      } catch (redisErr) {
        logger.debug('[TRIAGE CARD SERVICE] Cache check failed, continuing without cache', { error: redisErr.message });
      }

      // 1️⃣ Fetch all ACTIVE TriageCards (AI-generated cards)
      const activeCards = await TriageCard.findActiveByCompany(companyId);
      logger.debug('[TRIAGE CARD SERVICE] Found active AI cards', { count: activeCards.length });

      // 2️⃣ Fetch manual triage rules from company settings
      const Company = require('../models/v2Company');
      const company = await Company.findById(companyId).select('aiAgentSettings.cheatSheet.manualTriageRules');
      const manualRules = company?.aiAgentSettings?.cheatSheet?.manualTriageRules || [];
      logger.debug('[TRIAGE CARD SERVICE] Found manual rules', { count: manualRules.length });

      // 3️⃣ Build compiled config structure
      const compiledConfig = {
        companyId,
        compiledAt: new Date().toISOString(),
        cardCount: activeCards.length,
        manualRuleCount: manualRules.length,
        
        // ONE unified triage rules array (manual + cards)
        triageRules: [],
        
        // Response library pools
        responsePools: {},
        
        // Category map for handoff
        categoryMap: {},
        
        // Frontline-Intel blocks (combined)
        frontlineIntelBlocks: []
      };

      // 4️⃣ Add all rules from TriageCards (AI-generated)
      activeCards.forEach(card => {
        
        // Extract triage rules from card
        card.triageMap.forEach(rule => {
          compiledConfig.triageRules.push({
            // Rule data
            keywords: rule.keywords || [],
            excludeKeywords: rule.excludeKeywords || [],
            serviceType: rule.serviceType,
            action: rule.action,
            categorySlug: rule.categorySlug || card.category.slug,
            priority: rule.priority,
            reason: rule.reason,
            
            // Metadata for tracing
            source: 'AI_CARD',
            cardId: card._id,
            updatedAt: card.updatedAt
          });
        });

        // Add responses to pools
        const poolKey = card.category.slug;
        if (!compiledConfig.responsePools[poolKey]) {
          compiledConfig.responsePools[poolKey] = [];
        }
        compiledConfig.responsePools[poolKey].push(...card.responses);

        // Add category mapping
        compiledConfig.categoryMap[card.category.slug] = {
          name: card.category.name,
          description: card.category.description,
          trade: card.trade,
          serviceTypes: card.serviceTypes
        };

        // Add Frontline-Intel block
        compiledConfig.frontlineIntelBlocks.push({
          cardId: card._id,
          trade: card.trade,
          categorySlug: card.category.slug,
          content: card.frontlineIntelBlock
        });

      });

      // 5️⃣ Add all MANUAL rules (from Quick Triage Table)
      manualRules.forEach((rule, index) => {
        compiledConfig.triageRules.push({
          // Rule data
          keywords: Array.isArray(rule.keywords) ? rule.keywords : [],
          excludeKeywords: Array.isArray(rule.excludeKeywords) ? rule.excludeKeywords : [],
          serviceType: rule.serviceType || 'OTHER',
          action: rule.action || 'DIRECT_TO_3TIER',
          categorySlug: rule.qnaCard || rule.categorySlug || 'manual-rule',
          priority: rule.priority || 100,
          reason: rule.explanation || '',
          
          // Metadata for tracing
          source: 'MANUAL',
          manualRuleIndex: index,
          updatedAt: company.updatedAt // Use company's updatedAt for manual rules
        });
      });

      // 6️⃣ Add FALLBACK rule (lowest priority, catches everything)
      // Changed from ESCALATE_TO_HUMAN to DIRECT_TO_3TIER to allow AI to handle unknown requests
      // instead of immediately transferring to human on first turn
      compiledConfig.triageRules.push({
        keywords: [],
        excludeKeywords: [],
        serviceType: 'UNKNOWN',
        action: 'DIRECT_TO_3TIER', // Let AI Brain handle it, don't transfer immediately
        categorySlug: 'general-question',
        priority: 0, // Lowest priority
        reason: 'Fallback rule - direct to AI Brain for intelligent routing',
        source: 'SYSTEM',
        isFallback: true,
        updatedAt: new Date()
      });

      // 7️⃣ Sort rules with TIE-BREAKER logic
      // Primary: priority (highest first)
      // Tie-breaker 1: source (MANUAL beats AI_CARD)
      // Tie-breaker 2: updatedAt (most recent wins)
      compiledConfig.triageRules.sort((a, b) => {
        // Primary: priority descending
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        
        // Tie-breaker 1: MANUAL > AI_CARD > SYSTEM
        const sourceRank = { MANUAL: 3, AI_CARD: 2, SYSTEM: 1 };
        const rankA = sourceRank[a.source] || 0;
        const rankB = sourceRank[b.source] || 0;
        if (rankA !== rankB) {
          return rankB - rankA;
        }
        
        // Tie-breaker 2: Most recent updatedAt wins
        const dateA = new Date(a.updatedAt).getTime();
        const dateB = new Date(b.updatedAt).getTime();
        return dateB - dateA;
      });

      logger.info('[TRIAGE CARD SERVICE] ✅ ONE BRAIN compiled successfully', {
        companyId,
        totalRules: compiledConfig.triageRules.length,
        aiCardRules: compiledConfig.triageRules.filter(r => r.source === 'AI_CARD').length,
        manualRules: compiledConfig.triageRules.filter(r => r.source === 'MANUAL').length,
        fallbackRules: compiledConfig.triageRules.filter(r => r.source === 'SYSTEM').length,
        responsePoolCount: Object.keys(compiledConfig.responsePools).length
      });

      // Cache the compiled config (TTL: 1 hour)
      try {
        const redis = getRedisClient();
        await redis.setex(cacheKey, 3600, JSON.stringify(compiledConfig));
        logger.debug('[TRIAGE CARD SERVICE] ✅ Compiled config cached');
      } catch (redisErr) {
        logger.debug('[TRIAGE CARD SERVICE] Cache set failed (non-critical)', { error: redisErr.message });
      }

      return compiledConfig;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Compilation failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY AUTO-SYNC (DISABLED - Category model doesn't exist in this codebase)
  // ───────────────────────────────────────────────────────────────────────────
  // NOTE: This functionality was designed to auto-create Category documents,
  // but the Category model doesn't exist in this codebase.
  // Scenario/Category management is handled differently via v2Company model.
  // Triage Cards remain fully functional without this feature.
  // Scenario seeds are stored in card.category.scenarioSeeds[] and can be
  // manually used in AI Scenario Architect when admin is ready.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Auto-create or update Category document based on card
   * @param {TriageCard} card
   * @returns {Promise<null>}
   * @deprecated Category model doesn't exist - feature disabled
   */
  // static async autoSyncCategory(card) {
  //   logger.info('[TRIAGE CARD SERVICE] Auto-syncing category', { 
  //     categorySlug: card.category.slug 
  //   });
  //   // DISABLED: Category model doesn't exist in this codebase
  //   return null;
  // }

  /**
   * Infer template type from service types
   * @private
   * @deprecated Not used since autoSyncCategory is disabled
   */
  // static _inferTemplateType(serviceTypes) {
  //   if (serviceTypes.includes('EMERGENCY')) return 'EMERGENCY';
  //   if (serviceTypes.includes('REPAIR')) return 'APPOINTMENT';
  //   if (serviceTypes.includes('MAINTENANCE')) return 'APPOINTMENT';
  //   if (serviceTypes.includes('INSTALL')) return 'QUOTE';
  //   return 'INQUIRY';
  // }

  // ───────────────────────────────────────────────────────────────────────────
  // CACHE MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Invalidate compiled config cache
   * @param {String} companyId
   */
  static async invalidateCache(companyId) {
    logger.debug('[TRIAGE CARD SERVICE] Invalidating cache', { companyId });

    try {
      const redis = getRedisClient();
      const cacheKey = `triage:compiled:${companyId}`;
      await redis.del(cacheKey);
      logger.debug('[TRIAGE CARD SERVICE] ✅ Cache invalidated');
    } catch (error) {
      logger.warn('[TRIAGE CARD SERVICE] ⚠️ Cache invalidation failed', { 
        error: error.message 
      });
      // Non-critical, don't throw
    }
  }

}

module.exports = TriageCardService;


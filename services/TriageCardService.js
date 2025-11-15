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
const Redis = require('ioredis');

// Redis client (lazy initialization)
let redisClient = null;
function getRedisClient() {
  if (!redisClient) {
    // Parse REDIS_URL if available, otherwise use individual env vars
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      redisClient = new Redis(redisUrl, {
        retryDelayOnFailover: 100,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });
    } else {
      redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || null,
        db: process.env.REDIS_DB || 0,
        retryDelayOnFailover: 100,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });
    }
    
    redisClient.on('error', (err) => {
      logger.warn('[TRIAGE CARD SERVICE] Redis error (non-critical, will fallback to DB)', { error: err.message });
    });
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

      card.incrementVersion();
      card.lastModifiedBy = modifiedBy;

      await card.save();

      logger.info('[TRIAGE CARD SERVICE] ✅ Card updated', { 
        cardId: card._id,
        version: card.version 
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
   * Compile all ACTIVE cards into runtime-optimized config
   * @param {String} companyId
   * @returns {Promise<CompiledTriageConfig>}
   */
  static async compileActiveCards(companyId) {
    logger.info('[TRIAGE CARD SERVICE] Compiling active cards', { companyId });

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

      // Fetch all active cards
      const activeCards = await TriageCard.findActiveByCompany(companyId);

      logger.debug('[TRIAGE CARD SERVICE] Found active cards', { count: activeCards.length });

      // Build compiled config
      const compiledConfig = {
        companyId,
        compiledAt: new Date().toISOString(),
        cardCount: activeCards.length,
        
        // Merge all triage rules (sorted by priority)
        triageRules: [],
        
        // Response library pools
        responsePools: {},
        
        // Category map for handoff
        categoryMap: {},
        
        // Frontline-Intel blocks (combined)
        frontlineIntelBlocks: []
      };

      // Process each card
      activeCards.forEach(card => {
        
        // Add triage rules (already sorted by priority in schema)
        card.triageMap.forEach(rule => {
          compiledConfig.triageRules.push({
            ...rule.toObject(),
            cardId: card._id,
            categorySlug: card.category.slug
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

      // Re-sort all triage rules by priority (highest first)
      compiledConfig.triageRules.sort((a, b) => b.priority - a.priority);

      logger.info('[TRIAGE CARD SERVICE] ✅ Compilation complete', {
        companyId,
        ruleCount: compiledConfig.triageRules.length,
        responsePoolCount: Object.keys(compiledConfig.responsePools).length
      });

      // Cache the compiled config (TTL: 1 hour)
      try {
        const redis = getRedisClient();
        await redis.setex(cacheKey, 3600, JSON.stringify(compiledConfig));
      } catch (redisErr) {
        logger.debug('[TRIAGE CARD SERVICE] Cache set failed (non-critical)', { error: redisErr.message });
      }

      return compiledConfig;

    } catch (error) {
      logger.error('[TRIAGE CARD SERVICE] ❌ Compilation failed', { error: error.message });
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


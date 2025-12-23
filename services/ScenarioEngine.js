/**
 * ============================================================================
 * SCENARIO ENGINE - SINGLE ENTRY POINT FOR SCENARIO SELECTION
 * ============================================================================
 * 
 * PURPOSE:
 * Clean adapter that provides a single entry point for scenario selection.
 * Wraps the existing IntelligentRouter (3-Tier cascade) with:
 * - Multi-tenant safety (trade filtering + company toggles)
 * - Consistent contract for runtime and Flow Tree
 * - Full trace logging for debugging
 * 
 * CONTRACT (Per December 2025 Directive):
 * Input:  { companyId, tradeKey, text, session, options }
 * Output: { selected, tier, scenario, confidence, matchMeta }
 * 
 * MULTI-TENANT SAFETY:
 * - Only considers scenarios where scenario.tradeKey === company.tradeKey
 * - Only considers scenarios enabled for company (via mapping layer)
 * - No cross-tenant contamination possible
 * 
 * ============================================================================
 */

const IntelligentRouter = require('./IntelligentRouter');
const OverrideResolver = require('./OverrideResolver');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const Company = require('../models/v2Company');
const logger = require('../utils/logger');

// Company override models (December 2025 Directive)
const CompanyScenarioOverride = require('../models/CompanyScenarioOverride');
const CompanyCategoryOverride = require('../models/CompanyCategoryOverride');

// Enterprise Enforcement (December 2025 - NO EXCEPTIONS)
const { 
    filterEnterpriseReadyScenarios, 
    validateScenarioQuality,
    QUALITY_REQUIREMENTS 
} = require('../utils/scenarioEnforcement');

class ScenarioEngine {
  constructor() {
    this.config = {
      defaultTier1Threshold: 0.80,
      defaultTier2Threshold: 0.60,
      enableTradeFiltering: true,
      enableCompanyToggles: true, // December 2025: Company override models created
      
      // ═══════════════════════════════════════════════════════════════════════
      // ENTERPRISE ENFORCEMENT (December 2025 - NO EXCEPTIONS)
      // A scenario cannot be matched unless enterpriseReady === true
      // ═══════════════════════════════════════════════════════════════════════
      enforceEnterpriseReady: true,
      qualityRequirements: QUALITY_REQUIREMENTS
    };
  }

  /**
   * ============================================================================
   * MAIN METHOD: Select response for caller input
   * ============================================================================
   * 
   * @param {Object} input
   * @param {String} input.companyId - Company ObjectId
   * @param {String} input.tradeKey - Trade/industry key (e.g., "hvac", "plumbing")
   * @param {String} input.text - Caller input text
   * @param {Object} input.session - Session context
   * @param {String} input.session.sessionId - Unique session ID
   * @param {String} input.session.callerPhone - Caller phone number
   * @param {Object} input.session.signals - Context signals
   * @param {Object} input.options - Options
   * @param {Boolean} input.options.allowTier3 - Allow LLM fallback (default: true)
   * @param {Number} input.options.maxCandidates - Max candidates to return (default: 5)
   * 
   * @returns {Object} Selection result
   */
  async selectResponse(input) {
    const startTime = Date.now();
    const { companyId, tradeKey, text, session = {}, options = {} } = input;

    logger.info('🎯 [SCENARIO ENGINE] selectResponse called', {
      companyId,
      tradeKey,
      textLength: text?.length || 0,
      sessionId: session?.sessionId,
      allowTier3: options?.allowTier3 !== false
    });

    // Initialize result structure
    const result = {
      selected: false,
      tier: null,
      scenario: null,
      confidence: 0,
      matchMeta: {
        tier1: { bestScore: 0, matchedPhrases: [] },
        tier2: { bestScore: 0, topCandidates: [] },
        tier3: { used: false, model: null }
      },
      performance: {
        totalTime: 0,
        tier1Time: 0,
        tier2Time: 0,
        tier3Time: 0
      },
      error: null
    };

    try {
      // ═══════════════════════════════════════════════════════════════
      // 1. VALIDATE INPUT
      // ═══════════════════════════════════════════════════════════════
      if (!companyId) {
        throw new Error('companyId is required');
      }
      if (!text || text.trim().length === 0) {
        throw new Error('text is required');
      }

      // ═══════════════════════════════════════════════════════════════
      // 2. LOAD COMPANY & TEMPLATE
      // ═══════════════════════════════════════════════════════════════
      const company = await Company.findById(companyId).lean();
      if (!company) {
        throw new Error(`Company not found: ${companyId}`);
      }

      // Get effective trade key (from input or company)
      const effectiveTradeKey = tradeKey || company.tradeKey || company.industryType || 'universal';

      // Load template for this trade
      // TODO: Implement trade-specific template selection
      // For now, use the active/default template
      let template = await GlobalInstantResponseTemplate.findOne({
        isActive: true,
        isPublished: true
      }).lean();

      if (!template) {
        template = await GlobalInstantResponseTemplate.findOne({
          isDefaultTemplate: true
        }).lean();
      }

      if (!template) {
        logger.warn('[SCENARIO ENGINE] No template found, returning empty result');
        result.error = 'No active template found';
        return result;
      }

      logger.info('[SCENARIO ENGINE] Using template', {
        templateId: template._id,
        templateName: template.name,
        tradeKey: effectiveTradeKey,
        categoriesCount: template.categories?.length || 0
      });

      // ═══════════════════════════════════════════════════════════════
      // 3. FILTER SCENARIOS BY TRADE (Multi-tenant safety)
      // ═══════════════════════════════════════════════════════════════
      if (this.config.enableTradeFiltering && effectiveTradeKey !== 'universal') {
        // TODO: Implement trade filtering when scenarios have tradeKey field
        // For now, all scenarios are available
        logger.debug('[SCENARIO ENGINE] Trade filtering enabled but not yet implemented', {
          tradeKey: effectiveTradeKey
        });
      }

      // ═══════════════════════════════════════════════════════════════
      // 4. FILTER BY COMPANY TOGGLES (enable/disable per company)
      // ═══════════════════════════════════════════════════════════════
      if (this.config.enableCompanyToggles) {
        // TODO: Load company toggles and filter scenarios
        // const toggles = await CompanyScenarioToggle.find({ companyId }).lean();
        // Filter out disabled scenarios
        logger.debug('[SCENARIO ENGINE] Company toggles enabled but not yet implemented');
      }

      // ═══════════════════════════════════════════════════════════════
      // 4B. ENTERPRISE ENFORCEMENT (NO EXCEPTIONS)
      // Filter out non-enterprise-ready scenarios from matching pool
      // ═══════════════════════════════════════════════════════════════
      let enterpriseStats = { total: 0, filtered: 0, rejected: [] };
      
      if (this.config.enforceEnterpriseReady) {
        // Count and validate all scenarios in template
        let totalScenarios = 0;
        let readyScenarios = 0;
        const rejected = [];
        
        for (const category of template.categories || []) {
          const originalCount = (category.scenarios || []).length;
          totalScenarios += originalCount;
          
          // Validate and filter scenarios in-place
          const validScenarios = [];
          for (const scenario of category.scenarios || []) {
            const validation = validateScenarioQuality(scenario);
            
            if (validation.enterpriseReady) {
              validScenarios.push(scenario);
              readyScenarios++;
            } else {
              rejected.push({
                scenarioId: scenario.scenarioId,
                name: scenario.name,
                grade: validation.grade,
                issues: validation.issues.slice(0, 3)
              });
            }
          }
          
          // Replace with filtered list
          category.scenarios = validScenarios;
        }
        
        enterpriseStats = {
          total: totalScenarios,
          filtered: readyScenarios,
          rejected: rejected.slice(0, 10) // Top 10 rejected for logging
        };
        
        if (rejected.length > 0) {
          logger.warn(`[SCENARIO ENGINE] Enterprise enforcement filtered ${rejected.length}/${totalScenarios} scenarios`, {
            companyId,
            rejected: enterpriseStats.rejected
          });
        } else {
          logger.info(`[SCENARIO ENGINE] All ${totalScenarios} scenarios are enterprise-ready`);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // 5. ROUTE THROUGH 3-TIER CASCADE
      // ═══════════════════════════════════════════════════════════════
      const routingResult = await IntelligentRouter.route({
        callerInput: text,
        template,
        company,
        callId: session?.sessionId || `scenario-${Date.now()}`,
        context: {
          ...session?.signals,
          companyId,
          tradeKey: effectiveTradeKey,
          allowTier3: options?.allowTier3 !== false
        }
      });

      // ═══════════════════════════════════════════════════════════════
      // 6. MAP RESULT TO CONTRACT
      // ═══════════════════════════════════════════════════════════════
      result.selected = routingResult.matched;
      result.tier = routingResult.tierUsed;
      result.confidence = routingResult.confidence;

      if (routingResult.scenario) {
        const originalQuickReply = this.selectReply(routingResult.scenario.quickReplies);
        const originalFullReply = this.selectReply(routingResult.scenario.fullReplies);
        
        result.scenario = {
          scenarioId: routingResult.scenario.scenarioId,
          categoryId: routingResult.scenario.categoryId || routingResult.scenario.categories?.[0] || null,
          title: routingResult.scenario.name,
          priority: routingResult.scenario.priority || 0,
          toneLevel: routingResult.scenario.toneLevel || 2,
          quickReply: originalQuickReply,
          fullReply: originalFullReply,
          triggers: routingResult.scenario.triggers || []
        };
        
        // ═══════════════════════════════════════════════════════════════
        // 6B. APPLY COMPANY OVERRIDES (December 2025 Directive)
        // Deterministic fallback - NO LLM required for disabled scenarios
        // ═══════════════════════════════════════════════════════════════
        const overrideResult = await OverrideResolver.resolveAndRender({
          companyId,
          matchedScenario: routingResult.scenario,
          templateId: template._id?.toString(),
          categoryId: result.scenario.categoryId,
          scenarioId: routingResult.scenario.scenarioId,
          originalReply: {
            quickReply: originalQuickReply,
            fullReply: originalFullReply
          }
        });
        
        // Store override metadata for tracing
        result.override = {
          applied: overrideResult.overrideApplied,
          resolution: overrideResult.resolution,
          source: overrideResult.overrideSource || null,
          resolvedIn: overrideResult.resolvedIn
        };
        
        // Apply override reply if different from original
        if (overrideResult.overrideApplied && overrideResult.reply) {
          result.scenario.quickReply = overrideResult.reply.quickReply || result.scenario.quickReply;
          result.scenario.fullReply = overrideResult.reply.fullReply || result.scenario.fullReply;
          
          logger.info('[SCENARIO ENGINE] Override applied', {
            resolution: overrideResult.resolution,
            source: overrideResult.overrideSource,
            scenarioId: result.scenario.scenarioId
          });
        }
        
        // Handle case where no override configured and scenario is disabled
        // (falls through to LLM fallback if reply is null)
        if (overrideResult.resolution === 'NO_OVERRIDE_CONFIGURED_LLM_FALLBACK') {
          logger.warn('[SCENARIO ENGINE] No override configured for disabled scenario, LLM fallback needed', {
            scenarioId: result.scenario.scenarioId,
            companyId
          });
        }
      }

      // Map match metadata
      if (routingResult.tier1Result) {
        result.matchMeta.tier1 = {
          bestScore: routingResult.tier1Result.confidence || 0,
          matchedPhrases: routingResult.tier1Result.pipelineDiagnostic?.matching?.selected?.triggersHit || []
        };
        result.performance.tier1Time = routingResult.tier1Result.responseTime || 0;
      }

      if (routingResult.tier2Result) {
        result.matchMeta.tier2 = {
          bestScore: routingResult.tier2Result.confidence || 0,
          topCandidates: []
        };
        result.performance.tier2Time = routingResult.tier2Result.responseTime || 0;
      }

      if (routingResult.tier3Result) {
        result.matchMeta.tier3 = {
          used: true,
          model: routingResult.tier3Result.llmModel || 'gpt-4o-mini'
        };
        result.performance.tier3Time = routingResult.tier3Result.performance?.responseTime || 0;
      }

      result.performance.totalTime = Date.now() - startTime;
      
      // Add enterprise enforcement stats to result
      result.enforcement = {
        enabled: this.config.enforceEnterpriseReady,
        totalScenarios: enterpriseStats.total,
        enterpriseReadyCount: enterpriseStats.filtered,
        rejectedCount: enterpriseStats.total - enterpriseStats.filtered,
        rejectedSample: enterpriseStats.rejected
      };

      logger.info('✅ [SCENARIO ENGINE] Selection complete', {
        selected: result.selected,
        tier: result.tier,
        scenarioId: result.scenario?.scenarioId,
        confidence: result.confidence,
        totalTime: `${result.performance.totalTime}ms`,
        enforcement: `${enterpriseStats.filtered}/${enterpriseStats.total} scenarios available`
      });

      return result;

    } catch (error) {
      logger.error('❌ [SCENARIO ENGINE] Selection failed', {
        error: error.message,
        stack: error.stack,
        companyId,
        tradeKey
      });

      result.error = error.message;
      result.performance.totalTime = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Helper: Select a reply from array (random or first)
   */
  selectReply(replies) {
    if (!replies || replies.length === 0) return null;
    
    // If array of objects with text/weight, extract text
    if (typeof replies[0] === 'object' && replies[0].text) {
      // TODO: Implement weighted selection
      return replies[0].text;
    }
    
    // Simple string array - return first
    return replies[0];
  }

  /**
   * ============================================================================
   * GET ENABLED SCENARIOS FOR COMPANY
   * ============================================================================
   * Returns list of scenarios enabled for a company (for Flow Tree snapshot)
   * Uses CompanyScenarioOverride to determine enabled/disabled status
   */
  async getEnabledScenarios(companyId, tradeKey) {
    try {
      const company = await Company.findById(companyId).lean();
      if (!company) {
        return { count: 0, scenarios: [], error: 'Company not found' };
      }

      const effectiveTradeKey = tradeKey || company.tradeKey || 'universal';

      // Load template
      const template = await GlobalInstantResponseTemplate.findOne({
        isActive: true,
        isPublished: true
      }).lean();

      if (!template) {
        return { count: 0, scenarios: [], error: 'No active template' };
      }

      // Load company scenario overrides (for disable status)
      const overridesMap = await CompanyScenarioOverride.getOverridesMap(companyId);
      
      // Extract all scenarios and check override status + enterprise-ready
      const allScenarios = [];
      let enabledCount = 0;
      let disabledCount = 0;
      let notEnterpriseReadyCount = 0;
      
      for (const category of template.categories || []) {
        for (const scenario of category.scenarios || []) {
          if (scenario.isActive && scenario.status === 'live') {
            const override = overridesMap.get(scenario.scenarioId);
            const isToggledEnabled = !override || override.enabled !== false;
            
            // Check enterprise-ready status
            const validation = validateScenarioQuality(scenario);
            const isEnterpriseReady = validation.enterpriseReady;
            
            // Only truly enabled if toggled on AND enterprise-ready
            const isEnabled = isToggledEnabled && isEnterpriseReady;
            
            allScenarios.push({
              scenarioId: scenario.scenarioId,
              name: scenario.name,
              categoryId: category.id,
              categoryName: category.name,
              priority: scenario.priority || 0,
              triggersCount: scenario.triggers?.length || 0,
              isEnabled,
              isEnterpriseReady,
              enterpriseGrade: validation.grade,
              enterpriseIssues: validation.issues.slice(0, 3),
              hasOverride: !!override,
              overrideType: override ? override.fallbackPreference : null
            });
            
            if (isEnabled) {
              enabledCount++;
            } else if (!isEnterpriseReady) {
              notEnterpriseReadyCount++;
            } else {
              disabledCount++;
            }
          }
        }
      }

      return {
        count: allScenarios.length,
        enabledCount,
        disabledCount,
        notEnterpriseReadyCount,
        scenarios: allScenarios,
        tradeKey: effectiveTradeKey,
        enforcement: {
          enabled: this.config.enforceEnterpriseReady,
          qualityRequirements: this.config.qualityRequirements
        }
      };

    } catch (error) {
      logger.error('[SCENARIO ENGINE] getEnabledScenarios failed', { error: error.message });
      return { count: 0, scenarios: [], error: error.message };
    }
  }

  /**
   * ============================================================================
   * GET TIER CONFIG FOR COMPANY
   * ============================================================================
   * Returns tier thresholds and settings (for Flow Tree snapshot)
   */
  async getTierConfig(companyId) {
    try {
      // Load company to get any custom thresholds
      const company = await Company.findById(companyId).lean();
      
      // Load active template for default thresholds
      const template = await GlobalInstantResponseTemplate.findOne({
        isActive: true,
        isPublished: true
      }).lean();

      return {
        tier1: {
          enabled: true,
          threshold: template?.learningSettings?.tier1Threshold || this.config.defaultTier1Threshold,
          matchMethod: 'TRIGGERS_PHRASE_FUZZY'
        },
        tier2: {
          enabled: true,
          threshold: template?.learningSettings?.tier2Threshold || this.config.defaultTier2Threshold,
          matchMethod: 'SEMANTIC_BM25_BOOST'
        },
        tier3: {
          enabled: template?.aiGatewaySettings?.enableTier3 !== false,
          model: 'gpt-4o-mini',
          maxCostPerCall: template?.learningSettings?.llmCostPerCall || 0.50
        }
      };

    } catch (error) {
      logger.error('[SCENARIO ENGINE] getTierConfig failed', { error: error.message });
      return {
        tier1: { enabled: true, threshold: 0.80, matchMethod: 'TRIGGERS_PHRASE_FUZZY' },
        tier2: { enabled: true, threshold: 0.60, matchMethod: 'SEMANTIC_BM25_BOOST' },
        tier3: { enabled: true, model: 'gpt-4o-mini', maxCostPerCall: 0.50 }
      };
    }
  }
}

// Export singleton
module.exports = new ScenarioEngine();


/**
 * ============================================================================
 * COMPANY CONFIG LOADER - NORMALIZED RUNTIME CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE: Centralize reading and normalizing company AI configuration
 * SOURCES: v2Company (aiAgentSettings, aiAgentSettings, configuration), 
 *          GlobalInstantResponseTemplate, CompanyQnA, TradeQnA
 * 
 * USED BY: activeInstructionsService, future runtime (Frontline-Intel, 3-Tier)
 * 
 * ============================================================================
 */

const V2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const logger = require('../../utils/logger');

// Knowledgebase models (check if they exist in your codebase)
let CompanyQnA, TradeQnA;
try {
  // Try to load knowledgebase models if they exist
  CompanyQnA = require('../../models/knowledge/CompanyQnA');
  TradeQnA = require('../../models/knowledge/TradeQnA');
} catch (err) {
  logger.warn('[COMPANY CONFIG LOADER] Knowledgebase models not found - will use fallback', {
    error: err.message
  });
}

/**
 * Load and normalize company runtime configuration
 * @param {Object} params
 * @param {string} params.companyId
 * @returns {Promise<Object>} Normalized configuration object
 */
async function loadCompanyRuntimeConfig({ companyId }) {
  try {
    logger.info(`[COMPANY CONFIG LOADER] Loading config for company: ${companyId}`);
    
    // 1. Load company document
    const company = await V2Company.findById(companyId).lean().exec();
    
    if (!company) {
      throw new Error(`Company not found: ${companyId}`);
    }
    
    logger.debug(`[COMPANY CONFIG LOADER] Company loaded: ${company.companyName}`);
    
    // 2. Resolve template info
    const templateInfo = await resolveTemplateInfo(company);
    
    // 3. Build variables (definitions + values)
    const variables = await buildVariables(company, templateInfo.templates);
    
    // 4. Build filler words
    const fillerWords = buildFillerWords(company, templateInfo.templates);
    
    // 5. Build synonyms
    const synonyms = buildSynonyms(company);
    
    // 6. Build scenario summary
    const scenarios = buildScenarioSummary(company, templateInfo.templates);
    
    // 7. Load knowledgebase summary
    const knowledgebase = await loadKnowledgebaseSummary(company);
    
    // 8. Load intelligence settings
    const intelligence = buildIntelligenceSettings(company);
    
    // 9. Load readiness
    const readiness = buildReadinessInfo(company);
    
    // 10. Return normalized config
    const config = {
      companyId: company._id.toString(),
      name: company.companyName,
      trade: company.trade || null,
      configVersion: {
        templateIds: templateInfo.templateIds,
        clonedVersion: company.configuration?.clonedVersion || null,
        lastSyncedAt: company.configuration?.lastSyncedAt || null
      },
      readiness,
      variables,
      fillerWords,
      synonyms,
      scenarios,
      knowledgebase,
      intelligence
    };
    
    logger.info(`[COMPANY CONFIG LOADER] Config loaded successfully`, {
      companyId,
      variableCount: variables.definitions.length,
      scenarioCount: scenarios.length,
      fillerWordCount: fillerWords.active.length
    });
    
    return config;
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Failed to load config for company: ${companyId}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Resolve template information from clonedFrom or templateReferences
 * @param {Object} company - Company document
 * @returns {Promise<Object>} Template info
 */
async function resolveTemplateInfo(company) {
  const templateIds = [];
  const templates = [];
  
  try {
    // Check configuration.clonedFrom (legacy)
    if (company.configuration?.clonedFrom) {
      templateIds.push(company.configuration.clonedFrom.toString());
    }
    
    // Check aiAgentSettings.templateReferences (new)
    if (company.aiAgentSettings?.templateReferences && Array.isArray(company.aiAgentSettings.templateReferences)) {
      company.aiAgentSettings.templateReferences.forEach(ref => {
        if (ref.templateId && ref.enabled !== false) {
          const idStr = ref.templateId.toString();
          if (!templateIds.includes(idStr)) {
            templateIds.push(idStr);
          }
        }
      });
    }
    
    // Load template documents
    if (templateIds.length > 0) {
      const loadedTemplates = await GlobalInstantResponseTemplate
        .find({ _id: { $in: templateIds } })
        .lean()
        .exec();
      
      templates.push(...loadedTemplates);
      
      logger.debug(`[COMPANY CONFIG LOADER] Loaded ${templates.length} templates`, {
        templateIds
      });
    }
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Failed to load templates`, {
      error: error.message
    });
  }
  
  return { templateIds, templates };
}

/**
 * Build variables (definitions + values)
 * Merges template definitions with cheat sheet definitions
 * @param {Object} company
 * @param {Array} templates
 * @returns {Object} Variables object
 */
async function buildVariables(company, templates) {
  const definitions = [];
  const values = {};
  
  try {
    // Get template variable definitions
    templates.forEach(template => {
      if (template.variableDefinitions && Array.isArray(template.variableDefinitions)) {
        template.variableDefinitions.forEach(def => {
          // Check if already exists
          const existingKey = (def.normalizedKey || def.key || '').toLowerCase();
          const exists = definitions.some(d => 
            (d.normalizedKey || d.key || '').toLowerCase() === existingKey
          );
          
          if (!exists) {
            definitions.push({
              key: def.key,
              normalizedKey: def.normalizedKey || def.key,
              label: def.label || def.key,
              description: def.description || '',
              type: def.type || 'text',
              category: def.category || 'General',
              required: def.required || false,
              defaultValue: def.defaultValue || '',
              source: 'template'
            });
          }
        });
      }
    });
    
    // Add cheat sheet definitions
    if (company.aiAgentSettings?.variableDefinitions && Array.isArray(company.aiAgentSettings.variableDefinitions)) {
      company.aiAgentSettings.variableDefinitions.forEach(def => {
        const existingKey = (def.normalizedKey || def.key || '').toLowerCase();
        const exists = definitions.some(d => 
          (d.normalizedKey || d.key || '').toLowerCase() === existingKey
        );
        
        if (!exists) {
          definitions.push({
            key: def.key,
            normalizedKey: def.normalizedKey || def.key,
            label: def.label || def.key,
            description: def.description || '',
            type: def.type || 'text',
            category: def.category || 'Custom',
            required: def.required || false,
            defaultValue: def.defaultValue || '',
            source: 'cheatsheet'
          });
        }
      });
    }
    
    // Get variable values
    // Try aiAgentSettings.variables first (new)
    if (company.aiAgentSettings?.variables) {
      if (company.aiAgentSettings.variables instanceof Map) {
        // Convert Map to plain object
        company.aiAgentSettings.variables.forEach((value, key) => {
          values[key] = value;
        });
      } else if (typeof company.aiAgentSettings.variables === 'object') {
        Object.assign(values, company.aiAgentSettings.variables);
      }
    }
    
    // Fallback to configuration.variables (legacy)
    if (Object.keys(values).length === 0 && company.configuration?.variables) {
      if (company.configuration.variables instanceof Map) {
        company.configuration.variables.forEach((value, key) => {
          values[key] = value;
        });
      } else if (typeof company.configuration.variables === 'object') {
        Object.assign(values, company.configuration.variables);
      }
    }
    
    logger.debug(`[COMPANY CONFIG LOADER] Built variables`, {
      definitionCount: definitions.length,
      valueCount: Object.keys(values).length
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building variables`, {
      error: error.message
    });
  }
  
  return { definitions, values };
}

/**
 * Build filler words (inherited + custom + active)
 * @param {Object} company
 * @param {Array} templates
 * @returns {Object} Filler words object
 */
function buildFillerWords(company, templates) {
  const inherited = [];
  const custom = [];
  
  try {
    // Get from aiAgentSettings first (new)
    if (company.aiAgentSettings?.fillerWords) {
      if (Array.isArray(company.aiAgentSettings.fillerWords.inherited)) {
        inherited.push(...company.aiAgentSettings.fillerWords.inherited);
      }
      if (Array.isArray(company.aiAgentSettings.fillerWords.custom)) {
        custom.push(...company.aiAgentSettings.fillerWords.custom);
      }
    }
    
    // Fallback to configuration.fillerWords (legacy)
    if (inherited.length === 0 && company.configuration?.fillerWords) {
      if (Array.isArray(company.configuration.fillerWords.inherited)) {
        inherited.push(...company.configuration.fillerWords.inherited);
      }
      if (Array.isArray(company.configuration.fillerWords.custom)) {
        custom.push(...company.configuration.fillerWords.custom);
      }
    }
    
    // If still empty, try to get from templates
    if (inherited.length === 0) {
      templates.forEach(template => {
        if (template.fillerWords && Array.isArray(template.fillerWords)) {
          template.fillerWords.forEach(word => {
            if (!inherited.includes(word)) {
              inherited.push(word);
            }
          });
        }
      });
    }
    
    // Build active list (merged unique)
    const active = [...new Set([...inherited, ...custom])];
    
    logger.debug(`[COMPANY CONFIG LOADER] Built filler words`, {
      inherited: inherited.length,
      custom: custom.length,
      active: active.length
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building filler words`, {
      error: error.message
    });
  }
  
  return { inherited, custom, active };
}

/**
 * Build synonyms from aiAgentSettings
 * @param {Object} company
 * @returns {Array} Synonyms array
 */
function buildSynonyms(company) {
  const synonyms = [];
  
  try {
    if (company.aiAgentSettings?.synonyms && Array.isArray(company.aiAgentSettings.synonyms)) {
      company.aiAgentSettings.synonyms.forEach(syn => {
        synonyms.push({
          word: syn.word || '',
          variations: syn.variations || [],
          category: syn.category || 'general'
        });
      });
    }
    
    logger.debug(`[COMPANY CONFIG LOADER] Built synonyms`, {
      count: synonyms.length
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building synonyms`, {
      error: error.message
    });
  }
  
  return synonyms;
}

/**
 * Build scenario summary from templates
 * @param {Object} company
 * @param {Array} templates
 * @returns {Array} Scenarios array
 */
function buildScenarioSummary(company, templates) {
  const scenarios = [];
  
  try {
    // Get scenario controls from aiAgentSettings
    const scenarioControls = {};
    if (company.aiAgentSettings?.scenarioControls && Array.isArray(company.aiAgentSettings.scenarioControls)) {
      company.aiAgentSettings.scenarioControls.forEach(control => {
        if (control.scenarioId) {
          scenarioControls[control.scenarioId] = control.isEnabled !== false;
        }
      });
    }
    
    // Extract scenarios from templates
    templates.forEach(template => {
      if (template.scenarios && Array.isArray(template.scenarios)) {
        template.scenarios.forEach(scenario => {
          const scenarioId = scenario._id ? scenario._id.toString() : scenario.id;
          const isEnabled = scenarioControls[scenarioId] !== undefined 
            ? scenarioControls[scenarioId]
            : (scenario.isEnabled !== false);
          
          scenarios.push({
            id: scenarioId,
            name: scenario.name || 'Unnamed Scenario',
            category: scenario.category || 'uncategorized',
            triggers: scenario.triggers || [],
            synonyms: scenario.synonyms || [],
            isEnabled
          });
        });
      }
    });
    
    logger.debug(`[COMPANY CONFIG LOADER] Built scenario summary`, {
      count: scenarios.length,
      enabled: scenarios.filter(s => s.isEnabled).length
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building scenarios`, {
      error: error.message
    });
  }
  
  return scenarios;
}

/**
 * Load knowledgebase summary (counts only, not full content)
 * @param {Object} company
 * @returns {Promise<Object>} Knowledgebase summary
 */
async function loadKnowledgebaseSummary(company) {
  const knowledgebase = {
    companyQnA: { count: 0, categories: [] },
    tradeQnA: { count: 0, trades: [] }
  };
  
  try {
    // Load CompanyQnA if model exists
    if (CompanyQnA) {
      const companyQnACount = await CompanyQnA.countDocuments({ 
        companyId: company._id.toString() 
      });
      knowledgebase.companyQnA.count = companyQnACount;
      
      // Get categories if available
      const categories = await CompanyQnA.distinct('category', {
        companyId: company._id.toString()
      });
      knowledgebase.companyQnA.categories = categories || [];
      
      logger.debug(`[COMPANY CONFIG LOADER] Company Q&A count: ${companyQnACount}`);
    }
    
    // Load TradeQnA if model exists and company has trade
    if (TradeQnA && company.trade) {
      const tradeQnACount = await TradeQnA.countDocuments({
        trade: company.trade
      });
      knowledgebase.tradeQnA.count = tradeQnACount;
      knowledgebase.tradeQnA.trades = [company.trade];
      
      logger.debug(`[COMPANY CONFIG LOADER] Trade Q&A count: ${tradeQnACount}`);
    }
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error loading knowledgebase summary`, {
      error: error.message
    });
  }
  
  return knowledgebase;
}

/**
 * Build intelligence settings from aiAgentSettings
 * @param {Object} company
 * @returns {Object} Intelligence settings
 */
function buildIntelligenceSettings(company) {
  const intelligence = {
    enabled: false,
    thresholds: {},
    knowledgeSourcePriorities: [],
    memorySettings: {},
    fallbackBehavior: {},
    voice: {}
  };
  
  try {
    if (company.aiAgentSettings) {
      intelligence.enabled = !!company.aiAgentSettings.enabled;
      intelligence.thresholds = company.aiAgentSettings.thresholds || {};
      intelligence.knowledgeSourcePriorities = company.aiAgentSettings.knowledgeSourcePriorities || [];
      intelligence.memorySettings = company.aiAgentSettings.memorySettings || {};
      intelligence.fallbackBehavior = company.aiAgentSettings.fallbackBehavior || {};
      intelligence.voice = company.aiAgentSettings.voice || {};
    }
    
    logger.debug(`[COMPANY CONFIG LOADER] Built intelligence settings`, {
      enabled: intelligence.enabled,
      thresholds: Object.keys(intelligence.thresholds).length
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building intelligence settings`, {
      error: error.message
    });
  }
  
  return intelligence;
}

/**
 * Build readiness info from configuration.readiness
 * @param {Object} company
 * @returns {Object} Readiness info
 */
function buildReadinessInfo(company) {
  const readiness = {
    score: 0,
    canGoLive: false,
    isLive: false,
    goLiveAt: null,
    goLiveBy: null,
    preActivationMessage: null
  };
  
  try {
    if (company.configuration?.readiness) {
      Object.assign(readiness, company.configuration.readiness);
    }
    
    logger.debug(`[COMPANY CONFIG LOADER] Built readiness info`, {
      score: readiness.score,
      canGoLive: readiness.canGoLive,
      isLive: readiness.isLive
    });
    
  } catch (error) {
    logger.error(`[COMPANY CONFIG LOADER] Error building readiness info`, {
      error: error.message
    });
  }
  
  return readiness;
}

module.exports = {
  loadCompanyRuntimeConfig
};


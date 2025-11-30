/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTIVE SCENARIOS HELPER - V23 Brain 2 Loader
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Fetch active scenarios from Brain 2 (AiCore Live Scenarios)
 * USAGE: Pre-flight check for Triage Builder, LLM-A scenario injection
 * 
 * CRITICAL: If this returns empty array, LLM-A MUST NOT generate cards.
 * The "Golden Rule": Build Brain 2 first, then Brain 1.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// Lazy load models to avoid circular dependencies
let Company;
let GlobalInstantResponseTemplate;

const getModels = () => {
  if (!Company) {
    Company = require('../models/v2Company');
  }
  if (!GlobalInstantResponseTemplate) {
    GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
  }
  return { Company, GlobalInstantResponseTemplate };
};

/**
 * Get all active scenarios for a company from Brain 2 (AiCore Templates)
 * 
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} { success: boolean, scenarios: Array, count: number, message: string }
 */
async function getActiveScenariosForCompany(companyId) {
  const startTime = Date.now();
  
  try {
    logger.info('[ACTIVE-SCENARIOS] ⏳ CHECKPOINT 1: Fetching active scenarios', { companyId });
    
    const { Company, GlobalInstantResponseTemplate } = getModels();
    
    // Step 1: Load company with template references
    logger.info('[ACTIVE-SCENARIOS] 🔍 CHECKPOINT 2: Loading company from database...');
    const company = await Company.findById(companyId)
      .select('aiAgentSettings.templateReferences aiAgentSettings.scenarioControls businessName companyName trade')
      .lean();
    
    if (!company) {
      logger.error('[ACTIVE-SCENARIOS] ❌ CHECKPOINT 2.1: Company not found in database', { companyId });
      return {
        success: false,
        scenarios: [],
        count: 0,
        message: 'Company not found'
      };
    }
    
    logger.info('[ACTIVE-SCENARIOS] ✅ CHECKPOINT 2.2: Company loaded', {
      companyId,
      businessName: company.businessName || company.companyName,
      trade: company.trade,
      hasAiAgentSettings: !!company.aiAgentSettings
    });
    
    // Step 2: Get activated template references
    const templateReferences = company.aiAgentSettings?.templateReferences || [];
    const scenarioControls = company.aiAgentSettings?.scenarioControls || {};
    
    logger.info('[ACTIVE-SCENARIOS] 📋 CHECKPOINT 3: Template references check', {
      templateReferencesCount: templateReferences.length,
      templateIds: templateReferences.map(ref => ref.templateId),
      scenarioControlsCount: Object.keys(scenarioControls).length
    });
    
    if (templateReferences.length === 0) {
      logger.warn('[ACTIVE-SCENARIOS] ⚠️ CHECKPOINT 3.1: NO TEMPLATES ACTIVATED', {
        companyId,
        businessName: company.businessName || company.companyName,
        message: 'Company has no templateReferences in aiAgentSettings. User must go to AiCore Templates and activate one.'
      });
      return {
        success: true,
        scenarios: [],
        count: 0,
        message: 'NO_TEMPLATES_ACTIVATED',
        companyName: company.businessName || company.companyName,
        trade: company.trade
      };
    }
    
    // Step 3: Load all activated templates
    const templateIds = templateReferences.map(ref => ref.templateId);
    logger.info('[ACTIVE-SCENARIOS] 🔍 CHECKPOINT 4: Loading templates from GlobalInstantResponseTemplate...', {
      templateIds
    });
    
    const templates = await GlobalInstantResponseTemplate.find({
      _id: { $in: templateIds },
      status: 'active'
    }).lean();
    
    logger.info('[ACTIVE-SCENARIOS] 📊 CHECKPOINT 4.1: Templates query result', {
      requestedCount: templateIds.length,
      foundCount: templates.length,
      templateNames: templates.map(t => t.name)
    });
    
    if (templates.length === 0) {
      logger.warn('[ACTIVE-SCENARIOS] ⚠️ CHECKPOINT 4.2: No active templates found', { 
        templateIds,
        message: 'Templates may be inactive or deleted. Check GlobalInstantResponseTemplate collection.'
      });
      return {
        success: true,
        scenarios: [],
        count: 0,
        message: 'TEMPLATES_NOT_FOUND_OR_INACTIVE',
        companyName: company.businessName || company.companyName,
        trade: company.trade
      };
    }
    
    // Step 4: Extract and filter scenarios
    logger.info('[ACTIVE-SCENARIOS] 🔍 CHECKPOINT 5: Extracting scenarios from templates...');
    const allScenarios = [];
    let totalCategoriesScanned = 0;
    let totalScenariosScanned = 0;
    let scenariosDisabledByControl = 0;
    
    for (const template of templates) {
      const categories = template.categories || [];
      logger.info('[ACTIVE-SCENARIOS] 📂 CHECKPOINT 5.1: Processing template', {
        templateName: template.name,
        templateId: template._id.toString(),
        categoriesCount: categories.length
      });
      
      for (const category of categories) {
        totalCategoriesScanned++;
        const scenarios = category.scenarios || [];
        
        logger.info('[ACTIVE-SCENARIOS] 📁 CHECKPOINT 5.2: Processing category', {
          categoryName: category.name || category.key,
          scenariosCount: scenarios.length
        });
        
        for (const scenario of scenarios) {
          totalScenariosScanned++;
          const scenarioKey = scenario.key || scenario.scenarioKey || scenario.name;
          
          // Check if scenario is enabled for this company
          const controlKey = `${template._id}_${category.name || category.key}_${scenarioKey}`;
          const isEnabled = scenarioControls[controlKey]?.enabled !== false; // Default to enabled
          
          if (isEnabled) {
            allScenarios.push({
              scenarioKey: scenarioKey,
              name: scenario.name || scenario.displayName || scenarioKey,
              description: scenario.description || '',
              categoryKey: category.key || category.name,
              categoryName: category.name || category.displayName,
              templateId: template._id.toString(),
              templateName: template.name,
              // Include quick replies for context
              hasQuickReplies: (scenario.quickReplies || []).length > 0,
              hasFullReplies: (scenario.replies || scenario.fullReplies || []).length > 0
            });
          } else {
            scenariosDisabledByControl++;
          }
        }
      }
    }
    
    const elapsed = Date.now() - startTime;
    logger.info('[ACTIVE-SCENARIOS] ✅ CHECKPOINT 6: Extraction complete', {
      companyId,
      activeScenarios: allScenarios.length,
      templatesLoaded: templates.length,
      totalCategoriesScanned,
      totalScenariosScanned,
      scenariosDisabledByControl,
      scenarioKeys: allScenarios.slice(0, 10).map(s => s.scenarioKey), // First 10 for log readability
      elapsed
    });
    
    if (allScenarios.length === 0 && totalScenariosScanned > 0) {
      logger.warn('[ACTIVE-SCENARIOS] ⚠️ CHECKPOINT 6.1: All scenarios were disabled by scenarioControls', {
        totalScenariosScanned,
        scenariosDisabledByControl
      });
    }
    
    if (totalScenariosScanned === 0) {
      logger.warn('[ACTIVE-SCENARIOS] ⚠️ CHECKPOINT 6.2: Templates have no scenarios defined', {
        templatesLoaded: templates.length,
        templateNames: templates.map(t => t.name),
        message: 'Check template structure: categories[].scenarios[] may be empty'
      });
    }
    
    return {
      success: true,
      scenarios: allScenarios,
      count: allScenarios.length,
      message: allScenarios.length > 0 ? 'SCENARIOS_LOADED' : 'NO_SCENARIOS_ENABLED',
      companyName: company.businessName || company.companyName,
      trade: company.trade,
      meta: {
        templatesLoaded: templates.length,
        totalCategoriesScanned,
        totalScenariosScanned,
        scenariosDisabledByControl,
        elapsed
      }
    };
    
  } catch (error) {
    logger.error('[ACTIVE-SCENARIOS] Failed to fetch scenarios', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      scenarios: [],
      count: 0,
      message: `Error: ${error.message}`
    };
  }
}

/**
 * Get simplified scenario list for LLM-A prompt injection
 * Returns minimal data to reduce token usage
 * 
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} Array of { key, name, description }
 */
async function getScenarioKeysForLLMA(companyId) {
  const result = await getActiveScenariosForCompany(companyId);
  
  if (!result.success || result.count === 0) {
    return [];
  }
  
  return result.scenarios.map(s => ({
    key: s.scenarioKey,
    name: s.name,
    description: s.description?.substring(0, 100) || '' // Truncate for token efficiency
  }));
}

/**
 * Pre-flight check for Triage Builder
 * Returns whether Brain 2 is ready for Brain 1 creation
 * 
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} { canProceed: boolean, scenarioCount: number, message: string }
 */
async function preFlightCheckForTriageBuilder(companyId) {
  const result = await getActiveScenariosForCompany(companyId);
  
  return {
    canProceed: result.count > 0,
    scenarioCount: result.count,
    scenarios: result.scenarios,
    message: result.count > 0 
      ? `Brain 2 ready: ${result.count} scenarios active`
      : 'NO_SCENARIOS_LOADED - Activate AiCore templates first',
    companyName: result.companyName,
    trade: result.trade
  };
}

module.exports = {
  getActiveScenariosForCompany,
  getScenarioKeysForLLMA,
  preFlightCheckForTriageBuilder
};


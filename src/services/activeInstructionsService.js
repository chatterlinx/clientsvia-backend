/**
 * ============================================================================
 * ACTIVE INSTRUCTIONS SERVICE V2 - FULL BRAIN X-RAY
 * ============================================================================
 * 
 * PURPOSE: Provide complete visibility into active AI configuration + call state
 * ARCHITECTURE: Phase 2 - integrates with CompanyConfigLoader
 * USED BY: /api/active-instructions endpoint, future Simulator UI
 * 
 * ============================================================================
 */

const { loadCompanyRuntimeConfig } = require('./companyConfigLoader');
const CallTrace = require('../../models/CallTrace');
const logger = require('../../utils/logger');

/**
 * Get active instructions (full brain X-ray) for a company and optional call
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} [params.callId] - Optional, includes call-specific context
 * @returns {Promise<Object>} Active instructions report
 */
async function getActiveInstructions({ companyId, callId }) {
  try {
    logger.info(`[ACTIVE INSTRUCTIONS V2] Getting active instructions`, {
      companyId,
      callId: callId || 'none'
    });
    
    // 1. Load normalized company runtime config
    const config = await loadCompanyRuntimeConfig({ companyId });
    
    // 2. Load call trace if callId provided
    let call = null;
    if (callId) {
      const callTrace = await CallTrace.findOne({ callId, companyId })
        .lean()
        .exec();
      
      if (callTrace) {
        call = {
          callId: callTrace.callId,
          startedAt: callTrace.startedAt,
          endedAt: callTrace.endedAt,
          durationSeconds: callTrace.durationSeconds,
          contextSnapshot: {
            currentIntent: callTrace.currentIntent,
            extracted: callTrace.extracted || {},
            triageMatches: callTrace.triageMatches || [],
            transcript: callTrace.transcript || [],
            readyToBook: callTrace.readyToBook || false,
            appointmentId: callTrace.appointmentId || null
          },
          tierTrace: callTrace.tierTrace || [],
          extracted: callTrace.extracted || {},
          readyToBook: callTrace.readyToBook || false
        };
        
        logger.debug(`[ACTIVE INSTRUCTIONS V2] Call trace loaded`, {
          callId,
          durationSeconds: call.durationSeconds,
          tierCount: call.tierTrace.length
        });
      } else {
        logger.warn(`[ACTIVE INSTRUCTIONS V2] Call trace not found: ${callId}`);
      }
    }
    
    // 3. Build response with full configuration + optional call data
    const response = {
      company: {
        id: config.companyId,
        name: config.name,
        trade: config.trade
      },
      readiness: config.readiness,
      configVersion: config.configVersion,
      intelligence: config.intelligence,
      variables: config.variables,
      fillerWords: config.fillerWords,
      synonyms: config.synonyms,
      scenarios: {
        total: config.scenarios.length,
        byCategory: groupByCategory(config.scenarios)
      },
      knowledgebase: config.knowledgebase,
      call: call || null
    };
    
    logger.info(`[ACTIVE INSTRUCTIONS V2] Successfully generated X-ray`, {
      companyId,
      callId: callId || 'none',
      variableCount: config.variables.definitions.length,
      scenarioCount: config.scenarios.length,
      hasCall: !!call
    });
    
    return response;
    
  } catch (error) {
    logger.error(`[ACTIVE INSTRUCTIONS V2] Failed to get active instructions`, {
      error: error.message,
      stack: error.stack,
      companyId,
      callId
    });
    throw error;
  }
}

/**
 * Group scenarios by category with counts
 * @param {Array} scenarios
 * @returns {Object} Category map
 */
function groupByCategory(scenarios) {
  const map = {};
  
  for (const scenario of scenarios) {
    const cat = scenario.category || 'uncategorized';
    if (!map[cat]) {
      map[cat] = { count: 0 };
    }
    map[cat].count += 1;
  }
  
  return map;
}

module.exports = {
  getActiveInstructions
};


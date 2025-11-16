/**
 * ============================================================================
 * ACTIVE INSTRUCTIONS SERVICE - CONFIGURATION INTROSPECTION
 * ============================================================================
 * 
 * PURPOSE: Provide visibility into what instructions are active for a company/call
 * ARCHITECTURE: Phase 1 skeleton - reads from existing models
 * FUTURE: Will expand with real-time prompt preview, checklist state, etc.
 * 
 * ============================================================================
 */

const CallTrace = require('../../models/CallTrace');
const TriageCard = require('../../models/TriageCard');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const logger = require('../../utils/logger');

/**
 * Compute active instructions for a given company (and optional call)
 * Shows what AI configuration is currently in play
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} [params.callId] - Optional, includes call-specific context
 * @returns {Promise<Object>} Active instructions report
 */
async function getActiveInstructions({ companyId, callId }) {
  try {
    logger.info(`[ACTIVE INSTRUCTIONS] Getting active instructions`, {
      companyId,
      callId
    });
    
    // Load company
    const company = await Company.findById(companyId).lean();
    if (!company) {
      throw new Error(`Company not found: ${companyId}`);
    }
    
    // Load call trace if callId provided
    let callTrace = null;
    if (callId) {
      callTrace = await CallTrace.findOne({ callId, companyId }).lean();
      
      if (!callTrace) {
        logger.warn(`[ACTIVE INSTRUCTIONS] Call trace not found: ${callId}`);
      }
    }
    
    // Get triage cards that matched (if call provided)
    let triageMatches = [];
    let tierTrace = [];
    
    if (callTrace) {
      // Fetch matched triage cards
      if (callTrace.triageMatches && callTrace.triageMatches.length > 0) {
        triageMatches = await TriageCard.find({
          _id: { $in: callTrace.triageMatches }
        }).lean();
      }
      
      tierTrace = callTrace.tierTrace || [];
    }
    
    // Get active template
    let activeTemplate = null;
    if (company.configuration?.clonedFrom) {
      activeTemplate = await GlobalInstantResponseTemplate
        .findById(company.configuration.clonedFrom)
        .lean();
    }
    
    // Build instruction blocks from company config
    const instructionBlocks = {
      // Global AI Brain settings (from AdminSettings - Phase 2)
      global: [],
      
      // Trade-specific instructions (from company.trade)
      trade: company.trade ? [{
        scope: 'trade',
        trade: company.trade,
        active: true,
        description: `Trade-specific configuration for ${company.trade}`
      }] : [],
      
      // Company-specific configuration
      company: [
        {
          scope: 'company',
          companyId,
          active: true,
          type: 'voice_settings',
          config: company.aiAgentLogic?.voice || {},
          description: 'ElevenLabs voice configuration'
        },
        {
          scope: 'company',
          companyId,
          active: true,
          type: 'intelligence_thresholds',
          config: company.aiAgentLogic?.thresholds || {},
          description: '3-tier intelligence confidence thresholds'
        },
        {
          scope: 'company',
          companyId,
          active: true,
          type: 'knowledge_priorities',
          config: company.aiAgentLogic?.knowledgeSourcePriorities || [],
          description: 'Knowledge source priority order'
        }
      ]
    };
    
    // Build response
    const response = {
      company: {
        id: company._id.toString(),
        name: company.companyName,
        trade: company.trade || null,
        status: company.accountStatus || 'unknown'
      },
      
      context: callTrace ? {
        callId: callTrace.callId,
        currentIntent: callTrace.currentIntent || null,
        readyToBook: callTrace.readyToBook || false,
        appointmentId: callTrace.appointmentId || null,
        durationSeconds: callTrace.durationSeconds || null,
        transcriptTurns: callTrace.transcript?.length || 0
      } : null,
      
      instructionBlocks,
      
      template: activeTemplate ? {
        id: activeTemplate._id.toString(),
        name: activeTemplate.name,
        version: company.configuration?.clonedVersion || 'unknown',
        clonedAt: company.configuration?.clonedAt || null,
        lastSyncedAt: company.configuration?.lastSyncedAt || null,
        scenarioCount: activeTemplate.scenarios?.length || 0
      } : null,
      
      triage: {
        matchedCards: triageMatches.map(card => ({
          id: card._id.toString(),
          name: card.name || 'Unnamed Card',
          category: card.category || 'uncategorized',
          triggers: card.triggers || [],
          confidence: card.confidence || 0
        })),
        tierTrace: tierTrace.map(t => ({
          tier: t.tier,
          confidence: t.confidence,
          sourceId: t.sourceId || null,
          reasoning: t.reasoning || null
        }))
      },
      
      variables: company.aiAgentSettings?.variables || {},
      
      generatedAt: new Date().toISOString()
    };
    
    logger.info(`[ACTIVE INSTRUCTIONS] Successfully generated instructions`, {
      companyId,
      callId,
      hasTemplate: !!activeTemplate,
      triageMatches: triageMatches.length,
      variableCount: Object.keys(response.variables).length
    });
    
    return response;
  } catch (error) {
    logger.error(`[ACTIVE INSTRUCTIONS] Failed to get active instructions`, {
      error: error.message,
      stack: error.stack,
      companyId,
      callId
    });
    throw error;
  }
}

module.exports = {
  getActiveInstructions
};


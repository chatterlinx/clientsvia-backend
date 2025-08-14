/**
 * Phase 8: AI Config Assembler
 * Single source of truth for building compiled agent configurations
 * Non-destructive: pulls from existing company doc and fills safe defaults
 */

const _ = require('lodash');

/**
 * Build the compiled agent config the runtime expects.
 * Non-destructive: pulls from existing company doc and fills safe defaults.
 * 
 * @param {Object} companyDoc - The company document from MongoDB
 * @returns {Object} Compiled agent configuration ready for runtime
 */
function buildCompiledConfig(companyDoc = {}) {
  const ai = companyDoc.agentIntelligenceSettings || {};
  const kn = companyDoc.agentKnowledgeSettings || {};
  const ent = companyDoc.agentEnterpriseSettings || {};

  // Routing priority with Phase 6 HVAC defaults
  const routingPriority =
    kn.routingPriority ||
    companyDoc.answerPriority ||
    ['company_kb', 'trade_kb', 'vector', 'llm'];

  // Knowledge thresholds (safe HVAC defaults)
  const thresholds = {
    companyQnA:   _.get(kn, 'thresholds.companyQnA',   0.80),
    tradeQnA:     _.get(kn, 'thresholds.tradeQnA',     0.75),
    vectorSearch: _.get(kn, 'thresholds.vectorSearch', 0.70),
  };

  // Knowledge sources (arrays)
  const knowledgeSources = {
    company: _.get(kn, 'sources.company', []),
    trade:   _.get(kn, 'sources.trade',   []),
    vector:  _.get(kn, 'sources.vector',  []),
  };

  // Enterprise composite threshold
  const compositeThreshold = _.get(ent, 'composite.threshold', 0.62);

  // Memory mode from AI Intelligence settings
  const memoryMode = ai.memoryMode || 'short';

  // TTS settings (Phase 6 integration)
  const tts = {
    provider: companyDoc.ttsProvider || 'elevenlabs',
    voice: companyDoc.elevenLabsVoice || 'default',
    stability: companyDoc.elevenLabsStability || 0.5,
    similarityBoost: companyDoc.elevenLabsSimilarityBoost || 0.5,
  };

  // Agent personality and behavior
  const personality = {
    systemPrompt: companyDoc.systemPrompt || '',
    personality: companyDoc.agentPersonality || 'professional',
    greeting: companyDoc.greeting || 'Hello! How can I help you today?',
  };

  return {
    routing: { 
      priority: routingPriority 
    },
    knowledge: {
      sources: knowledgeSources,
      thresholds,
    },
    enterprise: {
      composite: { 
        threshold: compositeThreshold 
      },
    },
    tts,
    personality,
    // Metadata for debugging and traceability
    meta: {
      memoryMode,
      generatedAt: new Date().toISOString(),
      configShape: 'compiled_v1',
      source: 'Phase8_ConfigAssembler',
    },
  };
}

/**
 * Validate that a compiled config has all required fields
 * 
 * @param {Object} config - Compiled configuration to validate
 * @returns {Array} Array of validation error messages (empty if valid)
 */
function validateCompiledConfig(config) {
  const errors = [];

  if (!config) {
    errors.push('Config is null or undefined');
    return errors;
  }

  // Check routing
  if (!config.routing?.priority || !Array.isArray(config.routing.priority)) {
    errors.push('routing.priority must be a non-empty array');
  }

  // Check knowledge thresholds
  const thresholds = config.knowledge?.thresholds;
  if (!thresholds) {
    errors.push('knowledge.thresholds is required');
  } else {
    ['companyQnA', 'tradeQnA', 'vectorSearch'].forEach(key => {
      if (typeof thresholds[key] !== 'number' || thresholds[key] < 0 || thresholds[key] > 1) {
        errors.push(`knowledge.thresholds.${key} must be a number between 0 and 1`);
      }
    });
  }

  // Check knowledge sources
  const sources = config.knowledge?.sources;
  if (!sources) {
    errors.push('knowledge.sources is required');
  } else {
    ['company', 'trade', 'vector'].forEach(key => {
      if (!Array.isArray(sources[key])) {
        errors.push(`knowledge.sources.${key} must be an array`);
      }
    });
  }

  // Check enterprise composite threshold
  const compositeThreshold = config.enterprise?.composite?.threshold;
  if (typeof compositeThreshold !== 'number' || compositeThreshold < 0 || compositeThreshold > 1) {
    errors.push('enterprise.composite.threshold must be a number between 0 and 1');
  }

  // Check TTS configuration
  if (!config.tts?.provider) {
    errors.push('tts.provider is required');
  }

  // Check personality
  if (!config.personality) {
    errors.push('personality configuration is required');
  }

  // Check meta
  if (!config.meta?.generatedAt) {
    errors.push('meta.generatedAt is required for traceability');
  }

  return errors;
}

module.exports = { 
  buildCompiledConfig, 
  validateCompiledConfig 
};

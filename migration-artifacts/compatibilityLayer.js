
/**
 * Backwards Compatibility - Ensures existing code continues working
 */
class BackwardsCompatibilityLayer {
  constructor() {
    this.defaultTenant = 'hvac_default_tenant';
  }

  // Wrap existing agent.js exports
  wrapLegacyAgent() {
    const originalAgent = require('./services/agent.js');
    
    return {
      ...originalAgent,
      
      // Override main processing function
      processTranscript: async (transcript, context = {}) => {
        const tenantId = context.tenantId || this.defaultTenant;
        const tenantAgent = new TenantAwareAgent(tenantId, 'hvac');
        
        return await tenantAgent.processRequest(transcript, context);
      }
    };
  }

  // Wrap existing aiAgent.js exports  
  wrapLegacyAIAgent() {
    const originalAIAgent = require('./utils/aiAgent.js');
    
    return {
      ...originalAIAgent,
      
      // Override Q&A matching
      findCachedAnswer: (entries, userQuestion, threshold = 0.25) => {
        // Add tenant context if missing
        if (!entries[0]?.tenantId) {
          entries = entries.map(entry => ({
            ...entry,
            tenantId: this.defaultTenant,
            industryType: 'hvac'
          }));
        }
        
        return originalAIAgent.findCachedAnswer(entries, userQuestion, threshold);
      }
    };
  }
}

// Apply compatibility layer
const compatLayer = new BackwardsCompatibilityLayer();
module.exports = {
  agent: compatLayer.wrapLegacyAgent(),
  aiAgent: compatLayer.wrapLegacyAIAgent()
};
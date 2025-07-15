
/**
 * Tenant-Aware Agent - Wraps existing functionality
 */
class TenantAwareAgent {
  constructor(tenantId, industryType = 'hvac') {
    this.tenantId = tenantId;
    this.tenantConfig = this.loadTenantConfig(industryType);
    
    // Wrap existing agent with tenant context
    this.legacyAgent = require('./services/agent.js');
    this.legacyAIAgent = require('./utils/aiAgent.js');
  }

  async processRequest(userInput, context = {}) {
    // Add tenant context to existing processing
    const tenantContext = {
      ...context,
      tenantId: this.tenantId,
      industryType: this.tenantConfig.industryType,
      complianceRules: this.tenantConfig.getComplianceRules(),
      brandingConfig: this.tenantConfig.getBrandingConfig()
    };

    // Use existing Q&A matching with tenant-specific entries
    const tenantQAEntries = await this.getTenantQAEntries();
    const matchedAnswer = this.legacyAIAgent.findCachedAnswer(
      tenantQAEntries, 
      userInput
    );

    if (matchedAnswer) {
      // Apply tenant-specific post-processing
      return this.applyTenantBranding(matchedAnswer, tenantContext);
    }

    // Fallback to legacy agent for now
    return this.legacyAgent.processTranscript(userInput, tenantContext);
  }

  async getTenantQAEntries() {
    // Load tenant-specific Q&A entries from database
    const db = require('./db.js');
    return await db.collection('knowledge_entries')
      .find({ tenantId: this.tenantId })
      .toArray();
  }

  applyTenantBranding(response, context) {
    // Apply industry-specific branding and compliance
    const brandingConfig = context.brandingConfig;
    
    if (brandingConfig.industry_focus.includes('energy_efficiency')) {
      response += '\n\n💡 Energy Tip: Regular maintenance improves efficiency by 15-20%';
    }

    // Apply compliance requirements
    const complianceRules = context.complianceRules;
    if (complianceRules.epa_regulations && response.includes('refrigerant')) {
      response += '\n\n⚠️ All refrigerant work performed by EPA-certified technicians';
    }

    return response;
  }
}
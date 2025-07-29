const AgentPrompt = require('../models/AgentPrompt');

class AgentPromptService {
  constructor() {
    this.globalPrompts = {};
    this.companyPrompts = {};
  }

  async loadAll() {
    console.log('[AgentPromptService] Starting to load prompts from database...');
    const startTime = Date.now();
    
    try {
      console.log('[AgentPromptService] Querying AgentPrompt collection...');
      const prompts = await AgentPrompt.find({});
      console.log(`[AgentPromptService] Found ${prompts.length} prompts in ${Date.now() - startTime}ms`);
      
      this.globalPrompts = {};
      this.companyPrompts = {};

      console.log('[AgentPromptService] Processing prompts...');
      for (const p of prompts) {
        if (!p.companyId) {
          this.globalPrompts[p.intent] = p.variants;
        } else {
          const id = String(p.companyId);
          if (!this.companyPrompts[id]) this.companyPrompts[id] = {};
          this.companyPrompts[id][p.intent] = p.variants;
        }
      }
      
      const globalCount = Object.keys(this.globalPrompts).length;
      const companyCount = Object.keys(this.companyPrompts).length;
      console.log(`[AgentPromptService] ✅ Loaded ${globalCount} global prompts and ${companyCount} company-specific prompts in ${Date.now() - startTime}ms`);
    } catch (error) {
      console.error('[AgentPromptService] ❌ Error loading prompts:', error.message);
      console.error('[AgentPromptService] Stack trace:', error.stack);
      throw error;
    }
  }

  getPrompt(intent, companyId = null) {
    let arr =
      (companyId && this.companyPrompts[companyId] && this.companyPrompts[companyId][intent]) ||
      this.globalPrompts[intent] ||
      [];
    if (!arr.length) return "";
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

module.exports = new AgentPromptService();

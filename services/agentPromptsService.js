const AgentPrompt = require('../models/AgentPrompt');

class AgentPromptService {
  constructor() {
    this.globalPrompts = {};
    this.companyPrompts = {};
  }

  async loadAll() {
    const prompts = await AgentPrompt.find({});
    this.globalPrompts = {};
    this.companyPrompts = {};

    for (const p of prompts) {
      if (!p.companyId) {
        this.globalPrompts[p.intent] = p.variants;
      } else {
        const id = String(p.companyId);
        if (!this.companyPrompts[id]) this.companyPrompts[id] = {};
        this.companyPrompts[id][p.intent] = p.variants;
      }
    }
    console.log('[AgentPromptService] Prompts loaded');
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

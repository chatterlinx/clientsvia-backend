// ═════════════════════════════════════════════════════════════════════════════
// AUTO-SCAN SERVICE
// ═════════════════════════════════════════════════════════════════════════════
// Purpose: Automatically generate triage cards from Brain 2 scenarios
// Features:
//   - Full scan: Generate cards for ALL active scenarios
//   - Rescan: Generate cards only for NEW scenarios
//   - Auto-categorization by scenario category
//   - LLM-A generates keywords, negative keywords, and synonyms
// ═════════════════════════════════════════════════════════════════════════════

const TriageCard = require('../models/TriageCard');
const logger = require('../utils/logger');

// Use centralized OpenAI client (handles missing API key gracefully)
const openai = require('../config/openai');

// Import ActiveScenariosHelper for Brain 2 access
const { getActiveScenariosForCompany } = require('./ActiveScenariosHelper');

// ═════════════════════════════════════════════════════════════════════════════
// LLM-A SYSTEM PROMPT (KEYWORD GENERATION)
// ═════════════════════════════════════════════════════════════════════════════

const AUTO_SCAN_SYSTEM_PROMPT = `
You are an expert at generating triage keywords for routing phone calls.

Your job: Given a scenario description, generate routing keywords.

CRITICAL RULES:
1. Keywords must be SHORT (1-3 words max)
2. Keywords are what CALLERS naturally say, not technical terms
3. Focus on symptoms, problems, requests
4. Include common variations and colloquial phrases
5. Negative keywords prevent false matches

OUTPUT FORMAT (JSON):
{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "negativeKeywords": ["exclude1", "exclude2"],
  "synonyms": ["synonym1", "synonym2"]
}

EXAMPLES:

Scenario: "AC Not Cooling - Emergency Repair"
{
  "keywords": ["ac not cooling", "warm air", "no cold air", "ac blowing warm"],
  "negativeKeywords": ["maintenance", "tune-up", "checkup"],
  "synonyms": ["air conditioner", "a/c", "ac unit", "cooling system"]
}

Scenario: "Furnace Not Heating"
{
  "keywords": ["furnace not heating", "no heat", "cold house", "heater not working"],
  "negativeKeywords": ["ac", "cooling", "tune-up"],
  "synonyms": ["heater", "heating system", "furnace"]
}

Scenario: "Schedule AC Maintenance"
{
  "keywords": ["ac maintenance", "tune-up", "ac checkup", "service"],
  "negativeKeywords": ["broken", "not working", "emergency"],
  "synonyms": ["ac service", "maintenance check", "tune up"]
}
`.trim();

// ═════════════════════════════════════════════════════════════════════════════
// MAIN AUTO-SCAN SERVICE
// ═════════════════════════════════════════════════════════════════════════════

class AutoScanService {
  
  /**
   * Full scan: Generate cards for ALL active scenarios
   * @param {String} companyId - Company ID
   * @returns {Object} - { totalScenarios, cardsGenerated, categories, cards }
   */
  static async scanAndGenerateCards(companyId) {
    const startTime = Date.now();
    
    logger.info('[AUTO-SCAN] Starting full scan', { companyId });
    
    try {
      // Step 1: Load all active scenarios from Brain 2
      const scenariosResult = await getActiveScenariosForCompany(companyId);
      
      if (!scenariosResult.success || scenariosResult.count === 0) {
        logger.warn('[AUTO-SCAN] No scenarios found', { companyId });
        return {
          success: false,
          error: 'NO_SCENARIOS',
          message: 'No active scenarios found in Brain 2',
          totalScenarios: 0,
          cardsGenerated: 0
        };
      }
      
      const scenarios = scenariosResult.scenarios;
      logger.info('[AUTO-SCAN] Loaded scenarios from Brain 2', { 
        companyId, 
        count: scenarios.length 
      });
      
      // Step 2: Generate cards for each scenario
      const cards = [];
      const errors = [];
      
      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        
        logger.info('[AUTO-SCAN] Processing scenario', {
          companyId,
          progress: `${i + 1}/${scenarios.length}`,
          scenarioKey: scenario.scenarioKey,
          scenarioName: scenario.name
        });
        
        try {
          const cardDraft = await this.generateCardForScenario(scenario, companyId);
          cards.push(cardDraft);
          
          logger.info('[AUTO-SCAN] Card generated', {
            scenarioKey: scenario.scenarioKey,
            keywords: cardDraft.quickRuleConfig.keywordsMustHave.length
          });
        } catch (error) {
          logger.error('[AUTO-SCAN] Failed to generate card', {
            scenarioKey: scenario.scenarioKey,
            error: error.message
          });
          errors.push({
            scenarioKey: scenario.scenarioKey,
            error: error.message
          });
        }
      }
      
      // Step 3: Organize by category
      const organized = this.organizeByCategory(cards);
      
      const elapsed = Date.now() - startTime;
      logger.info('[AUTO-SCAN] ✅ Full scan complete', {
        companyId,
        totalScenarios: scenarios.length,
        cardsGenerated: cards.length,
        categoriesFound: organized.length,
        errors: errors.length,
        elapsedMs: elapsed
      });
      
      return {
        success: true,
        totalScenarios: scenarios.length,
        cardsGenerated: cards.length,
        categoriesFound: organized.length,
        categories: organized,
        cards: cards,
        errors: errors,
        elapsedMs: elapsed
      };
      
    } catch (error) {
      logger.error('[AUTO-SCAN] Fatal error during full scan', {
        companyId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Rescan: Generate cards only for NEW scenarios
   * @param {String} companyId - Company ID
   * @returns {Object} - { totalScenarios, existingCards, newScenariosFound, newCards }
   */
  static async rescan(companyId) {
    const startTime = Date.now();
    
    logger.info('[AUTO-SCAN] Starting rescan', { companyId });
    
    try {
      // Step 1: Load all active scenarios from Brain 2
      const scenariosResult = await getActiveScenariosForCompany(companyId);
      
      if (!scenariosResult.success) {
        return {
          success: false,
          error: 'NO_SCENARIOS',
          message: 'Could not load scenarios from Brain 2'
        };
      }
      
      const scenarios = scenariosResult.scenarios;
      
      // Step 2: Load existing triage cards
      const existingCards = await TriageCard.find({ companyId }).lean();
      const existingScenarioKeys = existingCards
        .map(c => c.linkedScenario?.scenarioKey)
        .filter(Boolean);
      
      logger.info('[AUTO-SCAN] Comparing scenarios vs cards', {
        companyId,
        totalScenarios: scenarios.length,
        existingCards: existingCards.length,
        existingScenarioKeys: existingScenarioKeys.length
      });
      
      // Step 3: Find NEW scenarios (not in existing cards)
      const newScenarios = scenarios.filter(s => 
        !existingScenarioKeys.includes(s.scenarioKey)
      );
      
      logger.info('[AUTO-SCAN] Found new scenarios', {
        companyId,
        newScenariosFound: newScenarios.length,
        newScenarioKeys: newScenarios.map(s => s.scenarioKey)
      });
      
      if (newScenarios.length === 0) {
        logger.info('[AUTO-SCAN] No new scenarios to process', { companyId });
        return {
          success: true,
          totalScenarios: scenarios.length,
          existingCards: existingCards.length,
          newScenariosFound: 0,
          newCards: [],
          message: 'All scenarios already have triage cards'
        };
      }
      
      // Step 4: Generate cards only for new scenarios
      const newCards = [];
      const errors = [];
      
      for (let i = 0; i < newScenarios.length; i++) {
        const scenario = newScenarios[i];
        
        logger.info('[AUTO-SCAN] Processing new scenario', {
          companyId,
          progress: `${i + 1}/${newScenarios.length}`,
          scenarioKey: scenario.scenarioKey
        });
        
        try {
          const cardDraft = await this.generateCardForScenario(scenario, companyId);
          newCards.push(cardDraft);
        } catch (error) {
          logger.error('[AUTO-SCAN] Failed to generate card for new scenario', {
            scenarioKey: scenario.scenarioKey,
            error: error.message
          });
          errors.push({
            scenarioKey: scenario.scenarioKey,
            error: error.message
          });
        }
      }
      
      // Step 5: Organize new cards by category
      const organized = this.organizeByCategory(newCards);
      
      const elapsed = Date.now() - startTime;
      logger.info('[AUTO-SCAN] ✅ Rescan complete', {
        companyId,
        totalScenarios: scenarios.length,
        existingCards: existingCards.length,
        newScenariosFound: newScenarios.length,
        newCardsGenerated: newCards.length,
        errors: errors.length,
        elapsedMs: elapsed
      });
      
      return {
        success: true,
        totalScenarios: scenarios.length,
        existingCards: existingCards.length,
        newScenariosFound: newScenarios.length,
        newCardsGenerated: newCards.length,
        categories: organized,
        newCards: newCards,
        errors: errors,
        elapsedMs: elapsed
      };
      
    } catch (error) {
      logger.error('[AUTO-SCAN] Fatal error during rescan', {
        companyId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Generate a triage card for a single scenario using LLM-A
   * @param {Object} scenario - Scenario from Brain 2
   * @param {String} companyId - Company ID
   * @returns {Object} - Card draft (not saved to DB yet)
   */
  static async generateCardForScenario(scenario, companyId) {
    logger.debug('[AUTO-SCAN] Generating card for scenario', {
      scenarioKey: scenario.scenarioKey,
      scenarioName: scenario.name
    });
    
    // Build user prompt with scenario details
    const userPrompt = this.buildUserPrompt(scenario);
    
    // Call LLM-A
    let llmResponse;
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Fast and cheap for bulk operations
        messages: [
          { role: 'system', content: AUTO_SCAN_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Low temperature for consistent output
        max_tokens: 500,
        response_format: { type: 'json_object' }
      });
      
      llmResponse = completion.choices[0]?.message?.content;
      
      if (!llmResponse) {
        throw new Error('Empty response from LLM-A');
      }
      
      logger.debug('[AUTO-SCAN] LLM-A response received', {
        scenarioKey: scenario.scenarioKey,
        responseLength: llmResponse.length
      });
      
    } catch (error) {
      logger.error('[AUTO-SCAN] LLM-A API call failed', {
        scenarioKey: scenario.scenarioKey,
        error: error.message
      });
      throw new Error(`LLM-A generation failed: ${error.message}`);
    }
    
    // Parse LLM-A response
    let generated;
    try {
      generated = JSON.parse(llmResponse);
    } catch (error) {
      logger.error('[AUTO-SCAN] Failed to parse LLM-A response', {
        scenarioKey: scenario.scenarioKey,
        response: llmResponse
      });
      throw new Error('Invalid JSON from LLM-A');
    }
    
    // Validate generated keywords
    if (!generated.keywords || generated.keywords.length === 0) {
      throw new Error('LLM-A did not generate any keywords');
    }
    
    // Build card draft
    const cardDraft = {
      companyId,
      trade: scenario.trade || 'GENERAL',
      
      triageLabel: this.toTriageLabel(scenario.name),
      displayName: scenario.name,
      description: scenario.description || `Auto-generated from scenario: ${scenario.name}`,
      intent: scenario.intent || this.extractIntent(scenario.name),
      triageCategory: scenario.categoryKey || 'GENERAL',
      
      serviceType: scenario.serviceType || 'OTHER',
      priority: this.calculatePriority(scenario),
      isActive: false, // Admin must activate
      
      quickRuleConfig: {
        keywordsMustHave: (generated.keywords || []).map(k => k.toLowerCase().trim()),
        keywordsExclude: (generated.negativeKeywords || []).map(k => k.toLowerCase().trim()),
        action: 'DIRECT_TO_3TIER', // Always route to 3-Tier
        explanation: `Auto-generated routing card for ${scenario.name}`,
        qnaCardRef: null
      },
      
      linkedScenario: {
        scenarioId: null, // We only store the key, not ObjectId ref
        scenarioName: scenario.name,
        scenarioKey: scenario.scenarioKey // CRITICAL: V23 referential integrity
      },
      
      frontlinePlaybook: {
        frontlineGoal: `Route caller to ${scenario.name}`,
        openingLines: [
          `I can help you with that. Let me get some details.`
        ],
        explainAndPushLines: [],
        objectionHandling: []
      },
      
      threeTierPackageDraft: {
        categoryName: scenario.categoryKey || 'General',
        categoryDescription: scenario.categoryDescription || '',
        scenarioName: scenario.name,
        scenarioObjective: scenario.description || `Handle ${scenario.name}`,
        scenarioExamples: [],
        suggestedStepsOutline: [],
        notesForAdmin: `Auto-generated from Brain 2 scenario: ${scenario.scenarioKey}`
      },
      
      // V23: Store generated synonyms for reference
      generatedSynonyms: generated.synonyms || [],
      
      // Metadata
      autoGenerated: true,
      generatedAt: new Date(),
      generatedBy: 'AUTO_SCAN_V23'
    };
    
    logger.debug('[AUTO-SCAN] Card draft created', {
      scenarioKey: scenario.scenarioKey,
      triageLabel: cardDraft.triageLabel,
      keywordsCount: cardDraft.quickRuleConfig.keywordsMustHave.length,
      negativeKeywordsCount: cardDraft.quickRuleConfig.keywordsExclude.length
    });
    
    return cardDraft;
  }
  
  /**
   * Build user prompt for LLM-A
   * @param {Object} scenario - Scenario from Brain 2
   * @returns {String} - Formatted prompt
   */
  static buildUserPrompt(scenario) {
    return `
Generate triage keywords for this scenario:

Scenario Key: ${scenario.scenarioKey}
Scenario Name: ${scenario.name}
Description: ${scenario.description || 'N/A'}
Category: ${scenario.categoryKey || 'General'}
Service Type: ${scenario.serviceType || 'OTHER'}

Generate:
1. Keywords (3-6 short phrases customers might say)
2. Negative Keywords (2-4 phrases that disqualify this card)
3. Synonyms (2-5 variations)

Return JSON only.
`.trim();
  }
  
  /**
   * Organize cards by category
   * @param {Array} cards - Array of card drafts
   * @returns {Array} - Array of { categoryName, cards }
   */
  static organizeByCategory(cards) {
    const categoryMap = {};
    
    for (const card of cards) {
      const categoryName = card.threeTierPackageDraft.categoryName || 'Uncategorized';
      
      if (!categoryMap[categoryName]) {
        categoryMap[categoryName] = {
          categoryName,
          cards: []
        };
      }
      
      categoryMap[categoryName].cards.push(card);
    }
    
    // Convert to array and sort by category name
    const organized = Object.values(categoryMap).sort((a, b) => 
      a.categoryName.localeCompare(b.categoryName)
    );
    
    logger.debug('[AUTO-SCAN] Cards organized by category', {
      categoriesFound: organized.length,
      categories: organized.map(c => `${c.categoryName} (${c.cards.length})`)
    });
    
    return organized;
  }
  
  /**
   * Convert scenario name to SNAKE_CASE triage label
   * @param {String} name - Scenario name
   * @returns {String} - SNAKE_CASE label
   */
  static toTriageLabel(name) {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50); // Max 50 chars
  }
  
  /**
   * Extract intent from scenario name
   * @param {String} name - Scenario name
   * @returns {String} - Intent label
   */
  static extractIntent(name) {
    // Simple heuristic: take first 2-3 words
    const words = name.split(/\s+/).slice(0, 3);
    return words.join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  }
  
  /**
   * Calculate priority based on scenario keywords
   * @param {Object} scenario - Scenario object
   * @returns {Number} - Priority (50-150)
   */
  static calculatePriority(scenario) {
    const name = (scenario.name || '').toLowerCase();
    const description = (scenario.description || '').toLowerCase();
    const combined = `${name} ${description}`;
    
    // High priority keywords
    if (combined.match(/emergency|urgent|critical|asap|immediate/i)) {
      return 150;
    }
    
    // Medium-high priority
    if (combined.match(/repair|broken|not working|problem|issue/i)) {
      return 110;
    }
    
    // Normal priority
    return 100;
  }
  
}

module.exports = AutoScanService;


// ═════════════════════════════════════════════════════════════════════════════
// TRIAGE BUILDER SERVICE (LLM-Powered Content Generator)
// ═════════════════════════════════════════════════════════════════════════════
// Purpose: Generate complete Triage Cards using LLM
// Output: 4-part structured card (Frontline block, Triage table, Responses, Category)
// Role: OFFLINE admin tool - generates content for human review/approval
// NOT used for live call decisions
// ═════════════════════════════════════════════════════════════════════════════

const openaiClient = require('../config/openai');
const logger = require('../utils/logger');

class TriageBuilderService {

  /**
   * Generate complete Triage Card using LLM
   * @param {String} trade - HVAC, Plumbing, etc.
   * @param {String} situation - Description of the triage scenario
   * @param {String[]} serviceTypes - Array of service types (REPAIR, MAINTENANCE, etc.)
   * @returns {Promise<Object>} - { frontlineIntelBlock, triageMap, responses, category }
   */
  static async generateTriageCard(trade, situation, serviceTypes) {
    logger.info('[TRIAGE BUILDER] Generating triage card', {
      trade,
      situationLength: situation.length,
      serviceTypes
    });

    if (!openaiClient) {
      throw new Error('OpenAI client not configured. Please set OPENAI_API_KEY environment variable.');
    }

    const systemPrompt = this.buildSystemPrompt(trade, serviceTypes);
    const userPrompt = this.buildUserPrompt(situation, serviceTypes);

    logger.debug('[TRIAGE BUILDER] Calling OpenAI', {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      model: 'gpt-4o-mini'
    });

    let completion;
    try {
      completion = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 3000
      });
    } catch (error) {
      logger.error('[TRIAGE BUILDER] OpenAI API call failed', {
        error: error.message
      });
      throw new Error(`LLM API call failed: ${error.message}`);
    }

    const rawResponse = completion.choices[0]?.message?.content || '';
    
    if (!rawResponse) {
      throw new Error('LLM returned empty response');
    }

    logger.debug('[TRIAGE BUILDER] LLM response received', {
      length: rawResponse.length,
      preview: rawResponse.substring(0, 200)
    });

    const parsed = this.parseTriageCard(rawResponse);

    logger.info('[TRIAGE BUILDER] Triage card generated successfully', {
      frontlineIntelLength: parsed.frontlineIntelBlock.length,
      triageMapRules: parsed.triageMap.length,
      responseCount: parsed.responses.length,
      categorySlug: parsed.category.slug
    });

    return parsed;
  }

  /**
   * Build system prompt for LLM
   * @private
   */
  static buildSystemPrompt(trade, serviceTypes) {
    const serviceTypesStr = serviceTypes.join(', ');

    return `You are an expert triage rules architect for ClientsVia.ai, an AI receptionist platform for contractors.

Your job is to generate a COMPLETE TRIAGE CARD with 4 parts in strict JSON format.

Trade: ${trade}
Service types: ${serviceTypesStr}

---

OUTPUT STRUCTURE (MUST BE VALID JSON):

{
  "frontlineIntelBlock": "...",
  "triageMap": [ ... ],
  "responses": [ ... ],
  "category": { ... }
}

---

PART 1: frontlineIntelBlock (string)
Write procedural text explaining how Frontline-Intel should triage this situation.
- Human tone, bullet rules, clear decision tree
- Explain when to classify as each serviceType
- Explain how to handle conflicts (e.g., customer says "maintenance" but symptoms indicate "repair")
- Industry-specific to ${trade}

Example:
"When customer mentions maintenance but describes broken equipment symptoms (not cooling, no heat, leaking):
• Symptom detection wins over stated intent
• Use Response Library to educate customer
• Push to correct serviceType (REPAIR) before handoff
• Only send to 3-Tier once customer agrees"

---

PART 2: triageMap (array of objects)
This is THE DECISION TABLE - the brain of call distribution.

Each rule object must have:
{
  "keywords": ["array", "of", "phrases"],        // What MUST be present
  "excludeKeywords": ["array", "of", "phrases"], // What MUST NOT be present
  "serviceType": "REPAIR | MAINTENANCE | EMERGENCY | ...",
  "action": "DIRECT_TO_3TIER | EXPLAIN_AND_PUSH | ESCALATE_TO_HUMAN | TAKE_MESSAGE | END_CALL_POLITE",
  "responseCategory": "downgrade_prevention | general",
  "priority": 100,                               // Higher = checked first
  "reason": "Human-readable explanation"
}

ACTIONS EXPLAINED:
• DIRECT_TO_3TIER: Caller is clear → send to scenario engine
• EXPLAIN_AND_PUSH: Caller trying to downgrade → educate → then send to 3-Tier
• ESCALATE_TO_HUMAN: Transfer to human
• TAKE_MESSAGE: Collect info and end
• END_CALL_POLITE: Spam/wrong company

PRIORITY RULES:
• Conflict detection rules (e.g., "not cooling" + "maintenance") = priority 110-130
• Simple rules (e.g., "not cooling" alone) = priority 80-100
• Generic fallback rules = priority 50-70

Generate 5-8 rules covering:
1. Symptom alone → DIRECT_TO_3TIER
2. Symptom + downgrade attempt → EXPLAIN_AND_PUSH
3. Clear simple request → DIRECT_TO_3TIER
4. Edge cases → ESCALATE_TO_HUMAN or TAKE_MESSAGE

---

PART 3: responses (array of strings)
Generate 10-12 natural, human-like response variations for when customer tries to downgrade.

Requirements:
• Tone: calm, professional, empathetic, firm
• Length: 1-2 sentences max, voice-ready
• Natural language, not robotic
• ${trade}-specific terminology

Example:
"I understand you were looking at our maintenance special, but since your AC isn't cooling, that sounds like it needs a repair visit instead."

---

PART 4: category (object)
Generate category structure for 3-Tier system handoff + AI Scenario Architect.

{
  "name": "Human-readable name",
  "slug": "machine_readable_slug",
  "description": "Category description",
  "scenarioSeeds": [ "10 one-line scenario examples" ]
}

Example:
{
  "name": "AC Not Cooling - Repair",
  "slug": "ac_not_cooling_repair",
  "description": "Customer reports air conditioner running but not producing cold air, requires repair service",
  "scenarioSeeds": [
    "Schedule emergency AC repair for not cooling",
    "AC blowing warm air, need same-day service",
    "Thermostat showing high temp, AC not cooling house",
    ... (10 total)
  ]
}

---

CRITICAL REQUIREMENTS:
1. Output MUST be valid JSON (no markdown code fences, no extra text)
2. All 4 parts MUST be present
3. triageMap MUST have 5-8 rules
4. responses MUST have 10-12 variations
5. category.scenarioSeeds MUST have 10 examples
6. Keywords MUST be industry-specific to ${trade}

RETURN ONLY THE JSON OBJECT. NO MARKDOWN, NO EXPLANATIONS.`;
  }

  /**
   * Build user prompt for LLM
   * @private
   */
  static buildUserPrompt(situation, serviceTypes) {
    return `Generate a complete Triage Card for this situation:

"${situation}"

Service types to handle: ${serviceTypes.join(', ')}

Return the complete JSON structure with all 4 parts (frontlineIntelBlock, triageMap, responses, category).`;
  }

  /**
   * Parse LLM response into structured Triage Card
   * @private
   */
  static parseTriageCard(rawResponse) {
    logger.debug('[TRIAGE BUILDER] Parsing LLM response');

    // Remove markdown code fences if present
    let cleanResponse = rawResponse.trim();
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(cleanResponse);
    } catch (error) {
      logger.error('[TRIAGE BUILDER] JSON parse failed', {
        error: error.message,
        rawResponsePreview: cleanResponse.substring(0, 500)
      });
      throw new Error(`Failed to parse LLM output as JSON: ${error.message}`);
    }

    // Validate structure
    const errors = [];

    if (!parsed.frontlineIntelBlock || typeof parsed.frontlineIntelBlock !== 'string') {
      errors.push('frontlineIntelBlock missing or invalid');
    }

    if (!Array.isArray(parsed.triageMap) || parsed.triageMap.length === 0) {
      errors.push('triageMap must be a non-empty array');
    } else {
      // Validate each triage rule
      parsed.triageMap.forEach((rule, idx) => {
        if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) {
          errors.push(`triageMap[${idx}]: keywords must be a non-empty array`);
        }
        if (!rule.serviceType) {
          errors.push(`triageMap[${idx}]: serviceType is required`);
        }
        if (!rule.action) {
          errors.push(`triageMap[${idx}]: action is required`);
        }
        if (typeof rule.priority !== 'number') {
          errors.push(`triageMap[${idx}]: priority must be a number`);
        }
      });
    }

    if (!Array.isArray(parsed.responses) || parsed.responses.length < 5) {
      errors.push('responses must contain at least 5 variations');
    }

    if (!parsed.category || typeof parsed.category !== 'object') {
      errors.push('category object is required');
    } else {
      if (!parsed.category.name) errors.push('category.name is required');
      if (!parsed.category.slug) errors.push('category.slug is required');
      if (!parsed.category.description) errors.push('category.description is required');
      if (!Array.isArray(parsed.category.scenarioSeeds) || parsed.category.scenarioSeeds.length === 0) {
        errors.push('category.scenarioSeeds must be a non-empty array');
      }
    }

    if (errors.length > 0) {
      logger.error('[TRIAGE BUILDER] Validation failed', { errors });
      throw new Error(`LLM output validation failed: ${errors.join(', ')}`);
    }

    // Normalize data
    return {
      frontlineIntelBlock: parsed.frontlineIntelBlock.trim(),
      triageMap: parsed.triageMap.map(rule => ({
        keywords: rule.keywords,
        excludeKeywords: rule.excludeKeywords || [],
        serviceType: rule.serviceType,
        action: rule.action,
        responseCategory: rule.responseCategory || 'general',
        priority: rule.priority,
        reason: rule.reason || ''
      })),
      responses: parsed.responses.map(r => r.trim()),
      category: {
        name: parsed.category.name.trim(),
        slug: parsed.category.slug.trim().toLowerCase().replace(/\s+/g, '_'),
        description: parsed.category.description.trim(),
        scenarioSeeds: parsed.category.scenarioSeeds.map(s => s.trim())
      }
    };
  }

}

module.exports = TriageBuilderService;

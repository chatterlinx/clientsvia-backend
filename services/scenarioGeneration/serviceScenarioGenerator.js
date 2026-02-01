/**
 * ============================================================================
 * SERVICE SCENARIO GENERATOR - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * GPT-4 powered scenario generation based on Service Catalog definitions.
 * Generates high-quality scenarios one at a time for admin review.
 * 
 * FLOW (Deep Audit Style):
 * 1. Admin selects service from catalog
 * 2. Generator creates scenario cards based on service hints
 * 3. Admin reviews ONE card at a time (sequential)
 * 4. Admin approves → Save to template → Auto Deep Audit verify
 * 5. Next card...
 * 
 * ARCHITECTURE:
 * - Uses service.scenarioHints for generation guidance
 * - Respects persona standards from audit profile
 * - Generates content-only (no runtime fields)
 * - Cards are validated before presenting to admin
 * 
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../../utils/logger');
const ServiceCatalog = require('../../models/ServiceCatalog');

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * SCENARIO CARD STRUCTURE
 * What GPT-4 generates for admin review
 */
const CARD_STRUCTURE = {
    // Identity
    scenarioName: 'string',      // e.g., "AC Not Cooling - First Call"
    category: 'string',          // From service category
    scenarioType: 'string',      // EMERGENCY, BOOKING, FAQ, TROUBLESHOOT, QUOTE
    
    // Content (what GPT-4 generates)
    triggers: ['string'],        // 5-10 trigger phrases
    quickReplies: ['string'],    // 5-8 short responses (max 15 words)
    fullReplies: ['string'],     // 5-8 full responses (max 25 words)
    
    // Metadata
    serviceKey: 'string',        // Link to service catalog
    generatedAt: 'Date',
    generationNotes: 'string'    // Why this scenario was created
};

/**
 * PERSONA STANDARDS
 * Aligned with Deep Audit rubric
 */
const PERSONA_STANDARDS = `
DISPATCHER PERSONA STANDARDS (Non-Negotiable):
- Sound like a seasoned HVAC dispatcher, NOT a help desk
- Calm, confident, experienced tone
- Move towards diagnosis or booking, not small talk
- Empathy should be concise: "I understand" not "I'm so sorry to hear that"

WORD LIMITS:
- Quick replies: MAX 15 words
- Full replies: MAX 25 words

FORBIDDEN PHRASES:
- "Have you checked..." / "Have you tried..."
- "Absolutely" / "Definitely" / "Certainly"
- "Let me help you with that"
- "No worries" / "That's okay"
- Multiple questions in one response

REQUIRED ELEMENTS:
- Each response must move toward booking OR diagnosis
- At least one diagnostic question per scenario
- Clear call to action in full replies
`;

/**
 * Generate scenarios for a service
 * @param {Object} service - Service definition from catalog
 * @param {Object} options - Generation options
 * @returns {Array} Array of scenario cards
 */
async function generateScenariosForService(service, options = {}) {
    const {
        targetCount = service.scenarioHints?.targetScenarioCount || 8,
        templateName = 'HVAC Template',
        existingScenarios = [],
        tradeType = 'hvac'
    } = options;
    
    logger.info('[SCENARIO GENERATOR] Starting generation', {
        serviceKey: service.serviceKey,
        displayName: service.displayName,
        targetCount
    });
    
    // Build the prompt
    const prompt = buildGenerationPrompt(service, {
        targetCount,
        templateName,
        existingScenarios,
        tradeType
    });
    
    try {
        const startTime = Date.now();
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: getSystemPrompt(tradeType)
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
        });
        
        const elapsed = Date.now() - startTime;
        const content = response.choices[0]?.message?.content;
        
        if (!content) {
            throw new Error('Empty response from GPT-4');
        }
        
        // Parse response
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (parseError) {
            logger.error('[SCENARIO GENERATOR] Failed to parse GPT response', {
                content: content.substring(0, 500)
            });
            throw new Error('Invalid JSON response from GPT-4');
        }
        
        // Extract scenarios
        const scenarios = parsed.scenarios || [];
        
        // Validate and enrich each scenario
        const validatedScenarios = scenarios.map((s, idx) => validateAndEnrichScenario(s, service, idx));
        
        // Filter out invalid scenarios
        const validScenarios = validatedScenarios.filter(s => s.isValid);
        
        logger.info('[SCENARIO GENERATOR] Generation complete', {
            serviceKey: service.serviceKey,
            requested: targetCount,
            generated: scenarios.length,
            valid: validScenarios.length,
            elapsed: `${elapsed}ms`,
            tokensUsed: response.usage?.total_tokens
        });
        
        return {
            success: true,
            scenarios: validScenarios,
            meta: {
                serviceKey: service.serviceKey,
                serviceName: service.displayName,
                requested: targetCount,
                generated: scenarios.length,
                valid: validScenarios.length,
                elapsed,
                tokensUsed: response.usage?.total_tokens,
                estimatedCost: ((response.usage?.total_tokens || 0) / 1000 * 0.01).toFixed(4)
            }
        };
        
    } catch (error) {
        logger.error('[SCENARIO GENERATOR] Generation failed', {
            serviceKey: service.serviceKey,
            error: error.message
        });
        
        return {
            success: false,
            error: error.message,
            scenarios: [],
            meta: {
                serviceKey: service.serviceKey,
                serviceName: service.displayName
            }
        };
    }
}

/**
 * Get system prompt for GPT-4
 */
function getSystemPrompt(tradeType) {
    return `You are an expert HVAC dispatcher scenario writer for AI receptionist training.

Your job is to create realistic, high-quality scenarios that train an AI agent to handle ${tradeType.toUpperCase()} customer calls like a seasoned dispatcher.

${PERSONA_STANDARDS}

OUTPUT FORMAT:
You must respond with a JSON object containing a "scenarios" array.
Each scenario must have: scenarioName, scenarioType, triggers, quickReplies, fullReplies, generationNotes.

QUALITY STANDARDS:
- Triggers must be realistic caller phrases (5-10 per scenario)
- Quick replies are for voice (short, punchy, under 15 words)
- Full replies are more complete (under 25 words, includes call to action)
- Every scenario should ultimately lead toward booking or clear next steps
- Vary the scenarios to cover different caller emotions and situations`;
}

/**
 * Build generation prompt for a specific service
 */
function buildGenerationPrompt(service, options) {
    const { targetCount, templateName, existingScenarios, tradeType } = options;
    
    const hints = service.scenarioHints || {};
    const typicalTypes = hints.typicalScenarioTypes || ['BOOKING', 'FAQ'];
    const keywords = hints.suggestedKeywords || service.intentKeywords || [];
    const notes = hints.generationNotes || '';
    
    // Build existing scenarios list (to avoid duplicates)
    let existingList = '';
    if (existingScenarios.length > 0) {
        existingList = `
EXISTING SCENARIOS (DO NOT DUPLICATE):
${existingScenarios.map(s => `- ${s.scenarioName}`).join('\n')}
`;
    }
    
    return `
TASK: Generate ${targetCount} unique scenarios for the "${service.displayName}" service.

SERVICE DETAILS:
- Service Key: ${service.serviceKey}
- Display Name: ${service.displayName}
- Description: ${service.description || 'N/A'}
- Category: ${service.category || 'General'}
- Trade: ${tradeType.toUpperCase()}

SCENARIO TYPES TO INCLUDE:
${typicalTypes.map(t => `- ${t}`).join('\n')}

KEYWORDS TO USE:
${keywords.join(', ')}

${notes ? `SPECIAL NOTES:\n${notes}\n` : ''}
${existingList}

REQUIREMENTS:
1. Generate exactly ${targetCount} scenarios
2. Each scenario must be unique and non-overlapping
3. Cover different caller situations (urgent vs routine, first-time vs returning, etc.)
4. Triggers should be natural caller phrases
5. Responses must follow dispatcher persona standards
6. Include at least one EMERGENCY type if applicable
7. Include at least one FAQ type for common questions

SCENARIO TYPES EXPLAINED:
- EMERGENCY: Urgent issues requiring immediate attention
- BOOKING: Caller ready to schedule service
- FAQ: Common questions about the service
- TROUBLESHOOT: Diagnostic/problem-solving conversations
- QUOTE: Pricing and estimate requests

Respond with JSON:
{
  "scenarios": [
    {
      "scenarioName": "Descriptive name",
      "scenarioType": "EMERGENCY|BOOKING|FAQ|TROUBLESHOOT|QUOTE",
      "triggers": ["trigger 1", "trigger 2", ...],
      "quickReplies": ["reply 1", "reply 2", ...],
      "fullReplies": ["reply 1", "reply 2", ...],
      "generationNotes": "Why this scenario is important"
    }
  ]
}`;
}

/**
 * Validate and enrich a generated scenario
 */
function validateAndEnrichScenario(scenario, service, index) {
    const errors = [];
    
    // Check required fields
    if (!scenario.scenarioName) errors.push('Missing scenarioName');
    if (!scenario.triggers || !Array.isArray(scenario.triggers) || scenario.triggers.length < 3) {
        errors.push('Triggers must be array with at least 3 items');
    }
    if (!scenario.quickReplies || !Array.isArray(scenario.quickReplies) || scenario.quickReplies.length < 3) {
        errors.push('QuickReplies must be array with at least 3 items');
    }
    if (!scenario.fullReplies || !Array.isArray(scenario.fullReplies) || scenario.fullReplies.length < 3) {
        errors.push('FullReplies must be array with at least 3 items');
    }
    
    // Validate word counts
    if (scenario.quickReplies) {
        scenario.quickReplies.forEach((reply, i) => {
            const wordCount = (reply || '').split(/\s+/).length;
            if (wordCount > 20) { // Allow some flexibility
                errors.push(`quickReplies[${i}] exceeds word limit (${wordCount} words)`);
            }
        });
    }
    
    if (scenario.fullReplies) {
        scenario.fullReplies.forEach((reply, i) => {
            const wordCount = (reply || '').split(/\s+/).length;
            if (wordCount > 35) { // Allow some flexibility
                errors.push(`fullReplies[${i}] exceeds word limit (${wordCount} words)`);
            }
        });
    }
    
    // Enrich with metadata
    return {
        // Core content
        scenarioName: scenario.scenarioName || `${service.displayName} Scenario ${index + 1}`,
        scenarioType: scenario.scenarioType || 'FAQ',
        category: service.category || 'General',
        triggers: (scenario.triggers || []).slice(0, 10),
        quickReplies: (scenario.quickReplies || []).slice(0, 8),
        fullReplies: (scenario.fullReplies || []).slice(0, 8),
        
        // Metadata
        serviceKey: service.serviceKey,
        generationNotes: scenario.generationNotes || '',
        generatedAt: new Date(),
        
        // Validation
        isValid: errors.length === 0,
        validationErrors: errors,
        
        // Placeholders for future fields
        scenarioId: null, // Will be assigned on save
        contentHash: null // Will be computed on save
    };
}

/**
 * Generate a single scenario for a service
 * Used for "Generate One More" functionality
 */
async function generateSingleScenario(service, existingScenarios = [], options = {}) {
    const result = await generateScenariosForService(service, {
        ...options,
        targetCount: 1,
        existingScenarios
    });
    
    if (result.success && result.scenarios.length > 0) {
        return {
            success: true,
            scenario: result.scenarios[0],
            meta: result.meta
        };
    }
    
    return {
        success: false,
        error: result.error || 'No scenario generated',
        scenario: null
    };
}

/**
 * Get generation queue for a service
 * Returns list of scenario types that should be generated
 */
function getGenerationQueue(service, existingScenarios = []) {
    const hints = service.scenarioHints || {};
    const typicalTypes = hints.typicalScenarioTypes || ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT'];
    const targetCount = hints.targetScenarioCount || 8;
    
    // Count existing by type
    const existingByType = {};
    existingScenarios.forEach(s => {
        const type = s.scenarioType || 'FAQ';
        existingByType[type] = (existingByType[type] || 0) + 1;
    });
    
    // Build queue
    const queue = [];
    const perType = Math.ceil(targetCount / typicalTypes.length);
    
    for (const type of typicalTypes) {
        const existing = existingByType[type] || 0;
        const needed = Math.max(0, perType - existing);
        for (let i = 0; i < needed; i++) {
            queue.push({
                scenarioType: type,
                serviceKey: service.serviceKey,
                serviceName: service.displayName,
                position: queue.length + 1
            });
        }
    }
    
    return {
        totalNeeded: targetCount,
        existingCount: existingScenarios.length,
        remaining: Math.max(0, targetCount - existingScenarios.length),
        queue: queue.slice(0, targetCount - existingScenarios.length),
        byType: existingByType
    };
}

/**
 * Format scenario for Global Brain editor
 * Converts generated card to template-compatible format
 */
function formatForGlobalBrain(scenario, templateId) {
    const scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
        scenarioId,
        name: scenario.scenarioName,
        scenarioName: scenario.scenarioName,
        scenarioType: scenario.scenarioType,
        category: scenario.category,
        
        // Triggers with standard format
        triggers: scenario.triggers.map(t => ({
            phrase: t,
            intent: 'match',
            weight: 1.0
        })),
        
        // Replies
        quickReplies: scenario.quickReplies,
        fullReplies: scenario.fullReplies,
        
        // Standard defaults
        confidenceThreshold: 0.75,
        priority: 5,
        behavior: 'respond',
        isActive: true,
        scope: 'GLOBAL',
        
        // Metadata
        serviceKey: scenario.serviceKey,
        generationNotes: scenario.generationNotes,
        createdAt: new Date(),
        createdBy: 'Service Scenario Generator',
        
        // For audit tracking
        _generatedFromService: scenario.serviceKey,
        _generatedAt: scenario.generatedAt
    };
}

module.exports = {
    generateScenariosForService,
    generateSingleScenario,
    getGenerationQueue,
    formatForGlobalBrain,
    validateAndEnrichScenario,
    PERSONA_STANDARDS
};

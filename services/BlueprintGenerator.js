/**
 * ════════════════════════════════════════════════════════════════════════════════
 * BLUEPRINT GENERATOR - Audit-aware scenario generation from blueprint intents
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Generate scenarios for MISSING or WEAK intents from the Coverage Engine.
 * All generated scenarios are designed to pass Deep Audit from the start.
 * 
 * KEY FEATURES:
 * - Audit-aware: Uses blueprint spec + audit rules in generation prompt
 * - Placeholder-governed: Only uses {callerName} per governance
 * - 22-field compliant: Generates complete scenario objects
 * - Service-aware: Respects company's enabled services
 * - Batch processing: Generates in batches of 20
 * 
 * USAGE:
 * ```js
 * const generator = new BlueprintGenerator(blueprintSpec, openaiClient);
 * const result = await generator.generateForIntent(intentKey, {
 *     companyContext: { ... },
 *     serviceContext: { ... }
 * });
 * ```
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const { validateScenarioPlaceholders } = require('./placeholders/PlaceholderRegistry');

class BlueprintGenerator {
    constructor(blueprintSpec, openaiClient) {
        this.blueprint = blueprintSpec;
        this.openai = openaiClient;
        
        // Build intent index
        this.intentIndex = new Map();
        for (const category of (blueprintSpec.categories || [])) {
            for (const item of (category.items || [])) {
                this.intentIndex.set(item.itemKey, {
                    ...item,
                    categoryKey: category.categoryKey,
                    categoryName: category.name
                });
            }
        }
    }
    
    /**
     * Generate a scenario for a single intent
     * 
     * @param {String} intentKey - Blueprint item key
     * @param {Object} options - Generation options
     * @returns {Object} - { scenario, validation, readyToImport }
     */
    async generateForIntent(intentKey, options = {}) {
        const {
            companyContext = {},
            serviceContext = {},
            existingScenario = null, // For REPLACE - use as reference
            isReplacement = false
        } = options;
        
        const intent = this.intentIndex.get(intentKey);
        if (!intent) {
            return { 
                error: `Unknown intentKey: ${intentKey}`,
                readyToImport: false 
            };
        }
        
        try {
            // Build generation prompt
            const prompt = this._buildGenerationPrompt(intent, {
                companyContext,
                serviceContext,
                existingScenario,
                isReplacement
            });
            
            // Call GPT-4
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: this._getSystemPrompt() },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 2000,
                response_format: { type: 'json_object' }
            });
            
            const content = response.choices[0]?.message?.content;
            if (!content) {
                return { 
                    error: 'No response from GPT-4',
                    readyToImport: false 
                };
            }
            
            // Parse response
            let scenarioData;
            try {
                scenarioData = JSON.parse(content);
            } catch (e) {
                return {
                    error: 'Invalid JSON response',
                    rawContent: content,
                    readyToImport: false
                };
            }
            
            // Generate scenario ID
            const scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            // Build complete scenario object
            const scenario = {
                scenarioId,
                name: scenarioData.name || intent.name,
                
                // Triggers
                triggers: scenarioData.triggers || intent.triggerHints || [],
                regexTriggers: scenarioData.regexTriggers || [],
                negativeTriggers: scenarioData.negativeTriggers || intent.negativeTriggerHints || [],
                
                // Responses
                quickReplies: scenarioData.quickReplies || [],
                fullReplies: scenarioData.fullReplies || [],
                
                // Behavior
                scenarioType: scenarioData.scenarioType || intent.scenarioType || 'INFORMATIONAL',
                bookingIntent: scenarioData.bookingIntent ?? intent.bookingIntent ?? false,
                requiresHumanReview: scenarioData.requiresHumanReview ?? false,
                escalate: scenarioData.escalate ?? (intent.scenarioType === 'EMERGENCY'),
                
                // Priority
                priority: scenarioData.priority ?? (intent.priority === 'high' ? 100 : intent.priority === 'medium' ? 50 : 0),
                
                // Settings
                channel: 'any',
                language: 'auto',
                replyGoal: intent.replyGoal || 'classify',
                
                // Entity capture
                entityCapture: scenarioData.entityCapture || this._buildEntityCapture(intent),
                
                // Metadata
                isActive: true,
                status: 'live',
                categories: [intent.categoryName],
                notes: scenarioData.notes || intent.notes || '',
                source: 'blueprint-generator',
                
                // Compliance
                complianceTags: scenarioData.complianceTags || this._inferComplianceTags(intent),
                
                // Generation metadata
                generatedFromBlueprint: {
                    intentKey,
                    categoryKey: intent.categoryKey,
                    generatedAt: new Date().toISOString(),
                    isReplacement
                }
            };
            
            // ════════════════════════════════════════════════════════════════════
            // VALIDATION
            // ════════════════════════════════════════════════════════════════════
            const validation = this._validateScenario(scenario, intent);
            
            return {
                success: true,
                scenario,
                validation,
                readyToImport: validation.isValid,
                intentKey,
                intentName: intent.name,
                scope: intent.scope || 'global',
                serviceKey: intent.serviceKey
            };
            
        } catch (error) {
            logger.error('[BLUEPRINT GENERATOR] Error', { intentKey, error: error.message });
            return {
                error: error.message,
                intentKey,
                readyToImport: false
            };
        }
    }
    
    /**
     * Generate scenarios for multiple intents (batch)
     * 
     * @param {Array} intents - Array of { intentKey, action, existingScenarioId }
     * @param {Object} options - Generation options
     * @returns {Object} - { results, summary }
     */
    async generateBatch(intents, options = {}) {
        const { batchSize = 5, companyContext = {}, serviceContext = {} } = options;
        
        const results = [];
        const summary = {
            total: intents.length,
            success: 0,
            failed: 0,
            readyToImport: 0
        };
        
        // Process in batches
        for (let i = 0; i < intents.length; i += batchSize) {
            const batch = intents.slice(i, i + batchSize);
            
            // Process batch in parallel
            const batchResults = await Promise.all(
                batch.map(item => this.generateForIntent(item.intentKey, {
                    companyContext,
                    serviceContext,
                    existingScenario: item.existingScenario,
                    isReplacement: item.action === 'REPLACE'
                }))
            );
            
            for (const result of batchResults) {
                results.push(result);
                if (result.success) {
                    summary.success++;
                    if (result.readyToImport) {
                        summary.readyToImport++;
                    }
                } else {
                    summary.failed++;
                }
            }
            
            // Log progress
            logger.info('[BLUEPRINT GENERATOR] Batch progress', {
                processed: Math.min(i + batchSize, intents.length),
                total: intents.length,
                successSoFar: summary.success
            });
        }
        
        return { results, summary };
    }
    
    /**
     * Build generation prompt for a single intent
     */
    _buildGenerationPrompt(intent, options) {
        const { companyContext, serviceContext, existingScenario, isReplacement } = options;
        
        let prompt = `Generate a scenario for the following HVAC intent:

INTENT: ${intent.name}
ITEM KEY: ${intent.itemKey}
CATEGORY: ${intent.categoryName}
SCENARIO TYPE: ${intent.scenarioType}
REPLY GOAL: ${intent.replyGoal || 'classify'}
BOOKING INTENT: ${intent.bookingIntent ? 'Yes' : 'No'}

TRIGGER HINTS: ${(intent.triggerHints || []).join(', ')}
NEGATIVE TRIGGERS: ${(intent.negativeTriggerHints || []).join(', ')}
ENTITY CAPTURE HINTS: ${(intent.entityCaptureHints || []).join(', ')}

NOTES: ${intent.notes || 'None'}
`;

        if (isReplacement && existingScenario) {
            prompt += `
═══════════════════════════════════════════════════════════════
THIS IS A REPLACEMENT for an existing weak scenario.
EXISTING SCENARIO NAME: ${existingScenario.name}
EXISTING TRIGGERS: ${(existingScenario.triggers || []).slice(0, 5).join(', ')}

Improve upon this scenario while maintaining the same intent coverage.
═══════════════════════════════════════════════════════════════
`;
        }

        if (companyContext.companyName) {
            prompt += `
COMPANY CONTEXT:
- Company Name: ${companyContext.companyName}
- Business Tone: ${companyContext.tone || 'calm_professional'}
`;
        }

        if (serviceContext.serviceKey) {
            prompt += `
SERVICE CONTEXT:
- This is for the "${serviceContext.serviceKey}" service
- Service Description: ${serviceContext.description || 'Standard service'}
`;
        }

        prompt += `
═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS (JSON):
{
  "name": "Clear, descriptive name",
  "triggers": ["at least 5 trigger phrases"],
  "regexTriggers": [],
  "negativeTriggers": ["phrases that should NOT match"],
  "quickReplies": ["2-3 short responses under 160 chars"],
  "fullReplies": ["1-2 detailed responses with {callerName}"],
  "scenarioType": "${intent.scenarioType}",
  "bookingIntent": ${intent.bookingIntent || false},
  "requiresHumanReview": false,
  "escalate": ${intent.scenarioType === 'EMERGENCY'},
  "priority": ${intent.priority === 'high' ? 100 : intent.priority === 'medium' ? 50 : 0},
  "entityCapture": { /* address, phone if needed */ },
  "notes": "Any special handling notes",
  "complianceTags": []
}
═══════════════════════════════════════════════════════════════

CRITICAL RULES:
1. ONLY use {callerName} placeholder - NO OTHER PLACEHOLDERS
2. Keep quickReplies under 160 characters
3. Include at least 5 varied trigger phrases
4. Never include sensitive troubleshooting for gas/electrical
5. Always recommend professional service over DIY
`;

        return prompt;
    }
    
    /**
     * Get system prompt for GPT-4
     */
    _getSystemPrompt() {
        return `You are an expert HVAC call center scenario designer.
You create AI conversation scenarios that:
- Sound natural and professional
- Capture necessary information
- Guide callers to appropriate action (booking, transfer, FAQ)
- Follow strict compliance rules (no DIY gas/electrical advice)

TONE: ${this.blueprint.metadata?.companyTone || 'calm_professional'}

BANNED TOPICS:
${(this.blueprint.metadata?.disallowedTopics || []).map(t => `- ${t}`).join('\n')}

COMPLIANCE NOTES:
${(this.blueprint.metadata?.complianceNotes || []).map(n => `- ${n}`).join('\n')}

Always output valid JSON matching the specified schema.
Use ONLY {callerName} as a placeholder - no other dynamic fields.`;
    }
    
    /**
     * Build entity capture configuration
     */
    _buildEntityCapture(intent) {
        const capture = {};
        
        for (const hint of (intent.entityCaptureHints || [])) {
            switch (hint) {
                case 'address':
                    capture.address = {
                        required: true,
                        prompt: 'What is your service address?',
                        validation: 'address'
                    };
                    break;
                case 'name':
                    capture.name = {
                        required: true,
                        prompt: 'May I have your name?',
                        validation: 'name'
                    };
                    break;
                case 'phone':
                    capture.phone = {
                        required: true,
                        prompt: 'What is the best number to reach you?',
                        validation: 'phone'
                    };
                    break;
                case 'business_name':
                    capture.businessName = {
                        required: true,
                        prompt: 'What is the name of your business?',
                        validation: 'text'
                    };
                    break;
            }
        }
        
        return capture;
    }
    
    /**
     * Infer compliance tags from intent
     */
    _inferComplianceTags(intent) {
        const tags = [];
        
        if (intent.scenarioType === 'EMERGENCY') {
            tags.push('EMERGENCY_PROTOCOL');
        }
        if (intent.itemKey?.includes('gas')) {
            tags.push('NO_DIY_ADVICE', 'SAFETY_CRITICAL');
        }
        if (intent.bookingIntent) {
            tags.push('BOOKING_FLOW');
        }
        
        return tags;
    }
    
    /**
     * Validate generated scenario
     */
    _validateScenario(scenario, intent) {
        const issues = [];
        
        // Check triggers
        if (!scenario.triggers || scenario.triggers.length < 3) {
            issues.push({ field: 'triggers', message: 'Need at least 3 triggers' });
        }
        
        // Check replies
        if (!scenario.quickReplies || scenario.quickReplies.length === 0) {
            issues.push({ field: 'quickReplies', message: 'At least 1 quickReply required' });
        }
        if (!scenario.fullReplies || scenario.fullReplies.length === 0) {
            issues.push({ field: 'fullReplies', message: 'At least 1 fullReply required' });
        }
        
        // Check quickReply length
        for (const reply of (scenario.quickReplies || [])) {
            if (reply.length > 160) {
                issues.push({ field: 'quickReplies', message: `Reply exceeds 160 chars: "${reply.substring(0, 50)}..."` });
            }
        }
        
        // Check placeholder governance
        const placeholderCheck = validateScenarioPlaceholders(scenario);
        if (!placeholderCheck.isValid) {
            for (const error of (placeholderCheck.errors || [])) {
                issues.push({ field: 'placeholders', message: error });
            }
        }
        
        // Check scenario type matches intent
        if (scenario.scenarioType !== intent.scenarioType) {
            issues.push({ 
                field: 'scenarioType', 
                message: `Expected ${intent.scenarioType}, got ${scenario.scenarioType}` 
            });
        }
        
        return {
            isValid: issues.length === 0,
            issues
        };
    }
}

module.exports = BlueprintGenerator;

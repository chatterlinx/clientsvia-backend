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
 * ============================================================================
 * MULTI-TENANT PLACEHOLDER SYSTEM (CRITICAL)
 * ============================================================================
 * Global template scenarios must be company-agnostic.
 * They can ONLY contain:
 * - Placeholders (runtime injected per companyId)
 * - Generic HVAC truths
 * - Questions that collect info
 * 
 * If a scenario needs company-specific info: use placeholders or move to Company Local.
 * ============================================================================
 */

/**
 * ALLOWED PLACEHOLDERS REGISTRY
 * GPT can ONLY use these - no inventing placeholders
 */
const ALLOWED_PLACEHOLDERS = {
    // Company Identity
    'company.name': 'Company name (e.g., "Smith AC")',
    'company.phone': 'Company phone number',
    'company.website': 'Company website URL',
    'company.address': 'Company physical address',
    'company.serviceArea': 'Geographic service area description',
    'company.hours': 'Business hours',
    'company.afterHoursMessage': 'After-hours message/instructions',
    
    // Pricing
    'pricing.diagnostic': 'Diagnostic/service call fee',
    'pricing.serviceCall': 'Service call fee',
    'pricing.afterHours': 'After-hours surcharge',
    
    // Booking
    'booking.nextAvailable': 'Next available appointment slot',
    'booking.soonestWindow': 'Soonest scheduling window',
    
    // Branding (optional)
    'company.tagline': 'Company tagline/slogan',
    'company.yearsInBusiness': 'Years in business'
};

/**
 * MULTI-TENANT RULES (for GPT prompt)
 */
const MULTI_TENANT_RULES = `
CRITICAL MULTI-TENANT RULE (VIOLATION = REJECTION):
You are generating GLOBAL TEMPLATE scenarios that must work for ANY companyId.

- NEVER hardcode any company-specific facts:
  × Company names, phone numbers, websites, addresses
  × Prices, fees, costs, dollar amounts
  × Cities, states, service areas
  × Hours, schedules, availability
  × Brand names, warranties, guarantees, promises
  
- Use {placeholders} instead. They will be replaced at runtime per company.
- If information is unknown or differs by company, ASK A QUESTION or use placeholders.
- If a request requires specific company policy not in placeholders, respond generically and offer to schedule/transfer.

ALLOWED PLACEHOLDERS (ONLY USE THESE):
{company.name} - Company name
{company.phone} - Phone number
{company.website} - Website
{company.address} - Address
{company.serviceArea} - Service area
{company.hours} - Business hours
{company.afterHoursMessage} - After-hours message
{pricing.diagnostic} - Diagnostic fee
{pricing.serviceCall} - Service call fee
{pricing.afterHours} - After-hours surcharge

PLACEHOLDER USAGE EXAMPLES:
✓ "You've reached {company.name}, this is the service line."
✓ "Our diagnostic fee is {pricing.diagnostic}."
✓ "We service the {company.serviceArea} area."
✓ "Our hours are {company.hours}."
✗ "You've reached Smith AC..." (hardcoded name)
✗ "The diagnostic is $89..." (hardcoded price)
✗ "We service Phoenix metro..." (hardcoded area)

DO NOT mention placeholders, tokens, or template mechanics to the caller.
Write naturally as if speaking - placeholders are invisible to humans.
`;

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
 * FORBIDDEN PATTERNS - Post-generation validation
 * These patterns indicate hardcoded company data (multi-tenant violation)
 */
const FORBIDDEN_PATTERNS = [
    // Phone numbers (various formats)
    { pattern: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, name: 'phone_number', message: 'Hardcoded phone number detected' },
    { pattern: /\+1[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, name: 'phone_number', message: 'Hardcoded phone number detected' },
    
    // URLs and websites
    { pattern: /https?:\/\/[^\s]+/gi, name: 'url', message: 'Hardcoded URL detected' },
    { pattern: /www\.[^\s]+/gi, name: 'url', message: 'Hardcoded website detected' },
    
    // Emails
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, name: 'email', message: 'Hardcoded email detected' },
    
    // Currency (prices) - must be in placeholder
    { pattern: /\$\d+(?:\.\d{2})?(?!\})/g, name: 'price', message: 'Hardcoded price detected - use {pricing.*} placeholder' },
    
    // Street addresses (common patterns)
    { pattern: /\d+\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/gi, name: 'address', message: 'Hardcoded street address detected' }
];

/**
 * Validate scenario for multi-tenant compliance
 * @param {Object} scenario - Generated scenario
 * @returns {Object} { isCompliant, violations, fixSuggestions }
 */
function validateMultiTenantCompliance(scenario) {
    const violations = [];
    const fixSuggestions = [];
    
    // Combine all text to check
    const textToCheck = [
        ...(scenario.quickReplies || []),
        ...(scenario.fullReplies || []),
        scenario.generationNotes || ''
    ].join(' ');
    
    // Check forbidden patterns
    for (const { pattern, name, message } of FORBIDDEN_PATTERNS) {
        const matches = textToCheck.match(pattern);
        if (matches) {
            violations.push({
                type: name,
                message,
                matches: [...new Set(matches)], // Unique matches
                severity: 'error'
            });
            
            // Add fix suggestion
            if (name === 'phone_number') {
                fixSuggestions.push('Replace phone numbers with {company.phone}');
            } else if (name === 'url') {
                fixSuggestions.push('Replace URLs with {company.website}');
            } else if (name === 'price') {
                fixSuggestions.push('Replace prices with {pricing.diagnostic} or {pricing.serviceCall}');
            } else if (name === 'address') {
                fixSuggestions.push('Replace addresses with {company.address} or {company.serviceArea}');
            }
        }
    }
    
    // Check for placeholder usage (should have at least one if mentioning company)
    const companyMentionPatterns = [
        /\bwe are\b/i, /\byou'?ve reached\b/i, /\bcall us\b/i, /\bour (?:website|hours|address|area)\b/i,
        /\bdiagnostic (?:fee|charge|cost)\b/i, /\bservice call (?:fee|charge)\b/i
    ];
    
    const hasCompanyMention = companyMentionPatterns.some(p => p.test(textToCheck));
    const hasPlaceholder = /\{[a-z]+\.[a-z]+\}/i.test(textToCheck);
    
    if (hasCompanyMention && !hasPlaceholder) {
        violations.push({
            type: 'missing_placeholder',
            message: 'Scenario mentions company-specific info but uses no placeholders',
            severity: 'warning'
        });
        fixSuggestions.push('Add appropriate placeholders for company-specific information');
    }
    
    // Check for invented placeholders (not in registry)
    const usedPlaceholders = textToCheck.match(/\{([a-z]+\.[a-z]+)\}/gi) || [];
    for (const placeholder of usedPlaceholders) {
        const key = placeholder.replace(/[{}]/g, '');
        if (!ALLOWED_PLACEHOLDERS[key]) {
            violations.push({
                type: 'invalid_placeholder',
                message: `Unknown placeholder: ${placeholder}`,
                severity: 'error'
            });
            fixSuggestions.push(`Replace ${placeholder} with an allowed placeholder`);
        }
    }
    
    return {
        isCompliant: violations.filter(v => v.severity === 'error').length === 0,
        violations,
        fixSuggestions,
        placeholdersUsed: usedPlaceholders.map(p => p.replace(/[{}]/g, ''))
    };
}

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
 * Includes multi-tenant placeholder requirements
 */
function getSystemPrompt(tradeType) {
    return `YOU ARE: Scenario Developer for a multi-tenant AI receptionist platform.
You are generating GLOBAL TEMPLATE scenarios that must work for ANY companyId.

Your job is to create realistic, high-quality scenarios that train an AI agent to handle ${tradeType.toUpperCase()} customer calls like a seasoned dispatcher.

${MULTI_TENANT_RULES}

${PERSONA_STANDARDS}

OUTPUT FORMAT:
You must respond with a JSON object containing a "scenarios" array.
Each scenario must have: scenarioName, scenarioType, triggers, quickReplies, fullReplies, generationNotes.

QUALITY STANDARDS:
- Triggers must be realistic caller phrases (5-10 per scenario)
- Quick replies are for voice (short, punchy, under 15 words)
- Full replies are more complete (under 25 words, includes call to action)
- Every scenario should ultimately lead toward booking or clear next steps
- Vary the scenarios to cover different caller emotions and situations
- Use placeholders for ANY company-specific information

QUALITY CHECK BEFORE YOU OUTPUT:
✓ Verify agentResponse contains ZERO hardcoded company facts
✓ Verify placeholders are used wherever company-specific info appears
✓ If you used a price, it MUST be a {pricing.*} placeholder
✓ If you mentioned company name, it MUST be {company.name}
✓ If you mentioned service area, it MUST be {company.serviceArea}`;
}

/**
 * Build generation prompt for a specific service
 * Includes placeholder requirements for multi-tenant compliance
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
8. **USE PLACEHOLDERS** for all company-specific information

PLACEHOLDER EXAMPLES FOR RESPONSES:
✓ "You've reached {company.name}, how can I help?"
✓ "Our diagnostic fee is {pricing.diagnostic}."
✓ "We service the {company.serviceArea} area. What's your address?"
✓ "Our hours are {company.hours}."
✓ "I can get a tech out to you. The service call is {pricing.serviceCall}."
✗ "You've reached ABC Heating..." (NO hardcoded names)
✗ "The diagnostic is $89..." (NO hardcoded prices)
✗ "We service Phoenix..." (NO hardcoded areas)

SCENARIO TYPES EXPLAINED:
- EMERGENCY: Urgent issues requiring immediate attention (gas leaks, no heat in winter, etc.)
- BOOKING: Caller ready to schedule service
- FAQ: Common questions about the service
- TROUBLESHOOT: Diagnostic/problem-solving conversations
- QUOTE: Pricing and estimate requests

WIRING RULES (CRITICAL - determines agent behavior):
- bookingIntent: true if scenario should trigger booking slot collection
- entityCapture: what to extract from caller speech (name, phone, address, serviceType)
- actionType: REPLY_ONLY (just respond), REQUIRE_BOOKING (force booking flow), TRANSFER (send to human)
- isEmergency: true for life-safety scenarios (gas leak, no heat, flooding)
- stopRouting: true for high-priority scenarios that shouldn't be overridden
- confirmBeforeAction: true if should confirm before transferring

Respond with JSON:
{
  "scenarios": [
    {
      "scenarioName": "Descriptive name",
      "scenarioType": "EMERGENCY|BOOKING|FAQ|TROUBLESHOOT|QUOTE",
      "triggers": ["trigger 1", "trigger 2", ...],
      "quickReplies": ["reply 1 with {placeholders}", "reply 2", ...],
      "fullReplies": ["reply 1 with {placeholders}", "reply 2", ...],
      "bookingIntent": true|false,
      "entityCapture": ["name", "phone", "address"],
      "actionType": "REPLY_ONLY|REQUIRE_BOOKING|TRANSFER",
      "isEmergency": true|false,
      "stopRouting": true|false,
      "confirmBeforeAction": true|false,
      "contextTags": ["tag1", "tag2"],
      "generationNotes": "Why this scenario is important"
    }
  ]
}`;
}

/**
 * Validate and enrich a generated scenario
 * Includes multi-tenant compliance check
 */
function validateAndEnrichScenario(scenario, service, index) {
    const errors = [];
    const warnings = [];
    
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
    
    // MULTI-TENANT COMPLIANCE CHECK (Critical)
    const complianceResult = validateMultiTenantCompliance(scenario);
    
    // Add compliance violations to errors
    for (const violation of complianceResult.violations) {
        if (violation.severity === 'error') {
            errors.push(`[TENANT VIOLATION] ${violation.message}: ${(violation.matches || []).join(', ')}`);
        } else {
            warnings.push(`[TENANT WARNING] ${violation.message}`);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DERIVE WIRING FROM SCENARIO TYPE (if GPT didn't specify)
    // ═══════════════════════════════════════════════════════════════════════════
    const scenarioType = (scenario.scenarioType || 'FAQ').toUpperCase();
    
    // Default wiring based on scenarioType
    const typeDefaults = {
        EMERGENCY: {
            bookingIntent: true,
            isEmergency: true,
            actionType: 'REQUIRE_BOOKING',
            stopRouting: true,
            confirmBeforeAction: false,
            entityCapture: ['name', 'phone', 'address'],
            priority: 95,
            confidenceThreshold: 0.7
        },
        BOOKING: {
            bookingIntent: true,
            isEmergency: false,
            actionType: 'REQUIRE_BOOKING',
            stopRouting: false,
            confirmBeforeAction: false,
            entityCapture: ['name', 'phone', 'address', 'serviceType'],
            priority: 70,
            confidenceThreshold: 0.75
        },
        FAQ: {
            bookingIntent: false,
            isEmergency: false,
            actionType: 'REPLY_ONLY',
            stopRouting: false,
            confirmBeforeAction: false,
            entityCapture: [],
            priority: 50,
            confidenceThreshold: 0.75
        },
        TROUBLESHOOT: {
            bookingIntent: true,  // Troubleshoot often leads to booking
            isEmergency: false,
            actionType: 'REPLY_ONLY',  // Respond first, may trigger booking
            stopRouting: false,
            confirmBeforeAction: false,
            entityCapture: ['serviceType'],
            priority: 60,
            confidenceThreshold: 0.75
        },
        QUOTE: {
            bookingIntent: false,
            isEmergency: false,
            actionType: 'REPLY_ONLY',
            stopRouting: false,
            confirmBeforeAction: false,
            entityCapture: ['serviceType'],
            priority: 55,
            confidenceThreshold: 0.75
        },
        TRANSFER: {
            bookingIntent: false,
            isEmergency: false,
            actionType: 'TRANSFER',
            stopRouting: true,
            confirmBeforeAction: true,
            entityCapture: ['name', 'phone'],
            priority: 80,
            confidenceThreshold: 0.8
        }
    };
    
    const defaults = typeDefaults[scenarioType] || typeDefaults.FAQ;
    
    // Enrich with metadata + FULL WIRING
    return {
        // Core content
        scenarioName: scenario.scenarioName || `${service.displayName} Scenario ${index + 1}`,
        scenarioType: scenarioType,
        category: service.category || 'General',
        triggers: (scenario.triggers || []).slice(0, 10),
        quickReplies: (scenario.quickReplies || []).slice(0, 8),
        fullReplies: (scenario.fullReplies || []).slice(0, 8),
        
        // ═══════════════════════════════════════════════════════════════════════
        // AGENT WIRING (Critical for runtime behavior)
        // ═══════════════════════════════════════════════════════════════════════
        bookingIntent: scenario.bookingIntent ?? defaults.bookingIntent,
        isEmergency: scenario.isEmergency ?? defaults.isEmergency,
        actionType: scenario.actionType || defaults.actionType,
        stopRouting: scenario.stopRouting ?? defaults.stopRouting,
        confirmBeforeAction: scenario.confirmBeforeAction ?? defaults.confirmBeforeAction,
        entityCapture: scenario.entityCapture || defaults.entityCapture,
        contextTags: scenario.contextTags || [service.serviceKey, scenarioType.toLowerCase()],
        
        // Matching thresholds
        priority: scenario.priority ?? defaults.priority,
        confidenceThreshold: scenario.confidenceThreshold ?? defaults.confidenceThreshold,
        
        // Required slots for booking scenarios
        requiredSlots: (scenario.bookingIntent ?? defaults.bookingIntent) 
            ? ['firstName', 'phone', 'address'] 
            : [],
        
        // Follow-up behavior
        followUpMode: (scenario.bookingIntent ?? defaults.bookingIntent) ? 'ASK_IF_BOOK' : 'NONE',
        
        // Metadata
        serviceKey: service.serviceKey,
        generationNotes: scenario.generationNotes || '',
        generatedAt: new Date(),
        
        // Validation
        isValid: errors.length === 0,
        validationErrors: errors,
        validationWarnings: warnings,
        
        // Multi-tenant compliance
        multiTenantCompliant: complianceResult.isCompliant,
        placeholdersUsed: complianceResult.placeholdersUsed,
        complianceViolations: complianceResult.violations,
        complianceFixSuggestions: complianceResult.fixSuggestions,
        
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
        triggers: Array.isArray(scenario.triggers) 
            ? scenario.triggers.map(t => typeof t === 'string' ? t : t.phrase || t)
            : [],
        
        // Replies
        quickReplies: scenario.quickReplies || [],
        fullReplies: scenario.fullReplies || [],
        
        // ═══════════════════════════════════════════════════════════════════════
        // AGENT WIRING (Feb 2026 - Full runtime fields)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Booking behavior
        bookingIntent: scenario.bookingIntent || false,
        requiredSlots: scenario.requiredSlots || [],
        
        // Action type (CRITICAL for routing)
        actionType: scenario.actionType || 'REPLY_ONLY',
        
        // Emergency handling
        isEmergency: scenario.isEmergency || false,
        
        // Entity extraction
        entityCapture: scenario.entityCapture || [],
        
        // Routing control
        stopRouting: scenario.stopRouting || false,
        confirmBeforeAction: scenario.confirmBeforeAction || false,
        
        // Follow-up behavior
        followUpMode: scenario.followUpMode || 'NONE',
        
        // Context tags for routing
        contextTags: scenario.contextTags || [scenario.serviceKey],
        
        // Matching thresholds
        confidenceThreshold: scenario.confidenceThreshold || 0.75,
        priority: scenario.priority || 50,
        
        // Standard fields
        behavior: null,  // Let category/template default handle this
        isActive: true,
        scope: 'GLOBAL',
        status: 'draft',  // Pending review
        
        // Metadata
        serviceKey: scenario.serviceKey,
        generationNotes: scenario.generationNotes,
        createdAt: new Date(),
        createdBy: 'Service Scenario Generator',
        
        // For audit tracking
        _generatedFromService: scenario.serviceKey,
        _generatedAt: scenario.generatedAt,
        
        // Multi-tenant compliance
        multiTenantCompliant: scenario.multiTenantCompliant,
        placeholdersUsed: scenario.placeholdersUsed
    };
}

module.exports = {
    // Generation
    generateScenariosForService,
    generateSingleScenario,
    getGenerationQueue,
    formatForGlobalBrain,
    
    // Validation
    validateAndEnrichScenario,
    validateMultiTenantCompliance,
    
    // Constants
    PERSONA_STANDARDS,
    MULTI_TENANT_RULES,
    ALLOWED_PLACEHOLDERS,
    FORBIDDEN_PATTERNS
};

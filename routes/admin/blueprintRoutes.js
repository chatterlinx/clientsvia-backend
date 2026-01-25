/**
 * ════════════════════════════════════════════════════════════════════════════════
 * BLUEPRINT BUILDER ROUTES
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints for Blueprint-based template generation:
 * 
 * GET  /api/admin/blueprints                    - List available blueprints
 * GET  /api/admin/blueprints/:tradeKey          - Get blueprint spec
 * GET  /api/admin/blueprints/:tradeKey/assess   - Assess coverage vs blueprint
 * POST /api/admin/blueprints/:tradeKey/generate - Generate missing scenario cards
 * 
 * ARCHITECTURE:
 *   Blueprint Spec → Assessment → Missing Items → Generate Cards → Load into Template
 * 
 * All generated scenarios contain ONLY content-owned fields (22 fields).
 * Runtime/admin fields are NEVER generated - enforced by registry.
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

// Blueprint specs
const HVAC_BLUEPRINT_SPEC = require('../../config/blueprints/HVAC_BLUEPRINT_SPEC');
const { 
    validateBlueprintSpec, 
    getAllBlueprintItems, 
    getRequiredItems,
    getBlueprintStats 
} = require('../../config/blueprints/BlueprintSpecV1');

// Models
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// Services
const { enforceContentOwnership, getContentFields } = require('../../services/scenarioAudit/constants');

// LLM for generation (lazy-loaded)
const OpenAI = require('openai');
let openai = null;

function getOpenAI() {
    if (!openai) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

// ════════════════════════════════════════════════════════════════════════════════
// BLUEPRINT REGISTRY
// ════════════════════════════════════════════════════════════════════════════════

const BLUEPRINT_REGISTRY = {
    hvac: HVAC_BLUEPRINT_SPEC
    // plumbing: PLUMBING_BLUEPRINT_SPEC, // Future
    // electrical: ELECTRICAL_BLUEPRINT_SPEC, // Future
    // accounting: ACCOUNTING_BLUEPRINT_SPEC, // Future
};

// ════════════════════════════════════════════════════════════════════════════════
// GENERATOR CONFIG V1 - Locked GPT Settings (Enterprise Control)
// ════════════════════════════════════════════════════════════════════════════════
// Blueprint = inventory/spec (WHAT scenarios should exist)
// GeneratorConfig = operational settings (HOW GPT generates cards)
// These are SEPARATE concerns.
// ════════════════════════════════════════════════════════════════════════════════

const ALLOWED_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

const DEFAULT_GENERATOR_CONFIG = {
    _format: 'GeneratorConfigV1',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 2000,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPromptVersion: 'SCENARIO_CARD_GEN_V1',
    constraints: {
        oneQuestionRule: true,           // quickReplies = ONE question only
        maxQuickReplyWords: 25,          // Quick replies under 25 words
        maxFullReplyWords: 35,           // Full replies under 35 words
        noHelpdeskPhrases: true,         // No "definitely", "of course", etc.
        noChatbotPhrases: true,          // No "thank you for reaching out", etc.
        mustGenerateNoNameVariants: true, // Always create _noName versions
        mustHaveBookingIntent: true,     // BOOKING scenarios need bookingIntent=true
        minTriggers: 8,                  // At least 8 triggers
        minQuickReplies: 3,              // At least 3 quick replies
        minFullReplies: 3                // At least 3 full replies
    }
};

// ════════════════════════════════════════════════════════════════════════════════
// CARD VALIDATION - Enforce content-only + constraints
// ════════════════════════════════════════════════════════════════════════════════

const BANNED_PHRASES_FOR_VALIDATION = [
    'thank you for reaching out', 'happy to help', 'how can i assist',
    'definitely', 'absolutely', 'of course', 'sure thing', 'no problem',
    'i understand', 'i appreciate', 'great question'
];

function validateGeneratedCard(card, config = DEFAULT_GENERATOR_CONFIG) {
    const errors = [];
    const warnings = [];
    const scenario = card.scenario || card;
    const constraints = config.constraints || {};
    
    // 1. Required fields present
    if (!scenario.name) errors.push('Missing name');
    if (!scenario.scenarioType) errors.push('Missing scenarioType');
    if (!scenario.triggers || scenario.triggers.length === 0) errors.push('Missing triggers');
    if (!scenario.quickReplies || scenario.quickReplies.length === 0) errors.push('Missing quickReplies');
    if (!scenario.fullReplies || scenario.fullReplies.length === 0) errors.push('Missing fullReplies');
    
    // 2. Trigger count
    if (constraints.minTriggers && scenario.triggers && scenario.triggers.length < constraints.minTriggers) {
        warnings.push(`Only ${scenario.triggers.length} triggers (min: ${constraints.minTriggers})`);
    }
    
    // 3. Reply counts
    if (constraints.minQuickReplies && scenario.quickReplies && scenario.quickReplies.length < constraints.minQuickReplies) {
        warnings.push(`Only ${scenario.quickReplies.length} quickReplies (min: ${constraints.minQuickReplies})`);
    }
    if (constraints.minFullReplies && scenario.fullReplies && scenario.fullReplies.length < constraints.minFullReplies) {
        warnings.push(`Only ${scenario.fullReplies.length} fullReplies (min: ${constraints.minFullReplies})`);
    }
    
    // 4. Word count checks
    if (constraints.maxQuickReplyWords && scenario.quickReplies) {
        scenario.quickReplies.forEach((reply, i) => {
            const wordCount = (reply || '').split(/\s+/).length;
            if (wordCount > constraints.maxQuickReplyWords) {
                warnings.push(`quickReplies[${i}] has ${wordCount} words (max: ${constraints.maxQuickReplyWords})`);
            }
        });
    }
    if (constraints.maxFullReplyWords && scenario.fullReplies) {
        scenario.fullReplies.forEach((reply, i) => {
            const wordCount = (reply || '').split(/\s+/).length;
            if (wordCount > constraints.maxFullReplyWords) {
                warnings.push(`fullReplies[${i}] has ${wordCount} words (max: ${constraints.maxFullReplyWords})`);
            }
        });
    }
    
    // 5. Banned phrase check
    if (constraints.noHelpdeskPhrases || constraints.noChatbotPhrases) {
        const allText = [
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || [])
        ].join(' ').toLowerCase();
        
        for (const phrase of BANNED_PHRASES_FOR_VALIDATION) {
            if (allText.includes(phrase)) {
                warnings.push(`Contains banned phrase: "${phrase}"`);
            }
        }
    }
    
    // 6. bookingIntent check for BOOKING scenarios
    if (constraints.mustHaveBookingIntent && 
        ['BOOKING', 'EMERGENCY'].includes(scenario.scenarioType) && 
        scenario.bookingIntent !== true) {
        warnings.push(`${scenario.scenarioType} scenario should have bookingIntent=true`);
    }
    
    // 7. _noName variants
    if (constraints.mustGenerateNoNameVariants) {
        if (!scenario.quickReplies_noName || scenario.quickReplies_noName.length === 0) {
            warnings.push('Missing quickReplies_noName variants');
        }
        if (!scenario.fullReplies_noName || scenario.fullReplies_noName.length === 0) {
            warnings.push('Missing fullReplies_noName variants');
        }
    }
    
    // 8. Content-only field check
    const contentFields = getContentFields();
    const extraFields = Object.keys(scenario).filter(k => 
        !contentFields.includes(k) && 
        !['scenarioId', '_id', 'itemKey', 'blueprintId', 'generatedAt', 'source', 'model'].includes(k)
    );
    if (extraFields.length > 0) {
        warnings.push(`Non-content fields present: ${extraFields.join(', ')}`);
    }
    
    return {
        valid: errors.length === 0,
        passed: errors.length === 0 && warnings.length === 0,
        errors,
        warnings,
        stats: {
            triggerCount: scenario.triggers?.length || 0,
            quickReplyCount: scenario.quickReplies?.length || 0,
            fullReplyCount: scenario.fullReplies?.length || 0,
            hasBookingIntent: scenario.bookingIntent === true,
            hasNoNameVariants: !!(scenario.quickReplies_noName && scenario.fullReplies_noName)
        }
    };
}

function validateAllCards(cards, config = DEFAULT_GENERATOR_CONFIG) {
    const results = cards.map((card, idx) => ({
        index: idx,
        itemKey: card.itemKey || card.scenario?.name || `card-${idx}`,
        ...validateGeneratedCard(card, config)
    }));
    
    return {
        total: cards.length,
        passed: results.filter(r => r.passed).length,
        valid: results.filter(r => r.valid).length,
        failed: results.filter(r => !r.valid).length,
        withWarnings: results.filter(r => r.warnings.length > 0).length,
        results,
        failures: results.filter(r => !r.valid || r.warnings.length > 0).map(r => ({
            itemKey: r.itemKey,
            errors: r.errors,
            warnings: r.warnings
        }))
    };
}

// ════════════════════════════════════════════════════════════════════════════════
// LIST AVAILABLE BLUEPRINTS
// ════════════════════════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
    try {
        const blueprints = Object.entries(BLUEPRINT_REGISTRY).map(([key, spec]) => {
            const stats = getBlueprintStats(spec);
            return {
                tradeKey: key,
                name: spec.name,
                version: spec.version,
                description: spec.description,
                totalItems: stats.totalItems,
                requiredItems: stats.requiredItems,
                categories: stats.categories
            };
        });
        
        res.json({
            success: true,
            blueprints,
            count: blueprints.length
        });
    } catch (error) {
        logger.error('[BLUEPRINTS] Error listing blueprints:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET BLUEPRINT SPEC
// ════════════════════════════════════════════════════════════════════════════════

router.get('/:tradeKey', async (req, res) => {
    const { tradeKey } = req.params;
    
    try {
        const spec = BLUEPRINT_REGISTRY[tradeKey];
        if (!spec) {
            return res.status(404).json({ 
                success: false, 
                error: `Blueprint not found for trade: ${tradeKey}`,
                availableTrades: Object.keys(BLUEPRINT_REGISTRY)
            });
        }
        
        const validation = validateBlueprintSpec(spec);
        const stats = getBlueprintStats(spec);
        
        res.json({
            success: true,
            spec,
            stats,
            validation
        });
    } catch (error) {
        logger.error(`[BLUEPRINTS] Error getting blueprint ${tradeKey}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// ASSESS COVERAGE VS BLUEPRINT
// ════════════════════════════════════════════════════════════════════════════════

router.get('/:tradeKey/assess', async (req, res) => {
    const { tradeKey } = req.params;
    const { companyId, source = 'activePool' } = req.query;
    
    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId required' });
    }
    
    try {
        // Get blueprint spec
        const spec = BLUEPRINT_REGISTRY[tradeKey];
        if (!spec) {
            return res.status(404).json({ 
                success: false, 
                error: `Blueprint not found: ${tradeKey}` 
            });
        }
        
        // Load existing scenarios
        const scenarios = await loadScenarios(companyId, source);
        
        // Get all blueprint items
        const blueprintItems = getAllBlueprintItems(spec);
        const requiredItems = getRequiredItems(spec);
        
        // Assess coverage
        const assessment = assessCoverage(blueprintItems, scenarios);
        
        // Calculate coverage stats
        const totalRequired = requiredItems.length;
        const coveredRequired = requiredItems.filter(item => 
            assessment.matchedItems.some(m => m.itemKey === item.itemKey)
        ).length;
        
        const coveragePercent = totalRequired > 0 
            ? Math.round((coveredRequired / totalRequired) * 100) 
            : 0;
        
        // Group missing items by category
        const missingByCategory = {};
        for (const item of assessment.missingItems) {
            const cat = item.categoryKey || 'uncategorized';
            if (!missingByCategory[cat]) {
                missingByCategory[cat] = [];
            }
            missingByCategory[cat].push(item);
        }
        
        // ════════════════════════════════════════════════════════════════════════════════
        // MODE DETECTION: New Template vs Filling Gaps
        // ════════════════════════════════════════════════════════════════════════════════
        // - NEW_TEMPLATE: Template is empty or nearly empty (<10% coverage)
        //   → Show "Generate Full Pack" button, missing items are EXPECTED
        // - FILLING_GAPS: Template has substantial coverage (>=10%)
        //   → Show selective generation, missing items are GAPS to fill
        // ════════════════════════════════════════════════════════════════════════════════
        const mode = coveragePercent < 10 ? 'NEW_TEMPLATE' : 'FILLING_GAPS';
        const isNewTemplate = mode === 'NEW_TEMPLATE';
        
        res.json({
            success: true,
            blueprintId: spec.blueprintId,
            blueprintName: spec.name,
            blueprintVersion: spec.version,
            
            // Mode detection
            mode,
            modeDescription: isNewTemplate 
                ? 'New template detected - generate full scenario pack'
                : 'Existing template - fill coverage gaps',
            
            // Coverage summary
            coverage: {
                percent: coveragePercent,
                requiredCovered: coveredRequired,
                requiredTotal: totalRequired,
                totalCovered: assessment.matchedItems.length,
                totalInBlueprint: blueprintItems.length,
                existingScenarios: scenarios.length
            },
            
            // Detailed results
            matchedItems: assessment.matchedItems,
            missingItems: assessment.missingItems,
            missingByCategory,
            duplicates: assessment.duplicates,
            weakCoverage: assessment.weakCoverage,
            
            // Stats
            stats: {
                missingRequired: requiredItems.filter(item => 
                    !assessment.matchedItems.some(m => m.itemKey === item.itemKey)
                ).length,
                missingOptional: assessment.missingItems.filter(i => i.required === false).length,
                byType: getBlueprintStats(spec).byType
            },
            
            // UI helpers - mode-aware
            canGenerate: assessment.missingItems.length > 0,
            canGenerateFullPack: isNewTemplate && assessment.missingItems.length > 0,
            generateButtonLabel: isNewTemplate
                ? `Generate Full Pack (${blueprintItems.length} scenarios)`
                : assessment.missingItems.length > 0
                    ? `Generate ${assessment.missingItems.length} Missing Scenarios`
                    : 'All scenarios covered',
            
            source,
            companyId
        });
        
    } catch (error) {
        logger.error(`[BLUEPRINTS] Error assessing ${tradeKey}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GENERATE MISSING SCENARIO CARDS
// ════════════════════════════════════════════════════════════════════════════════

router.post('/:tradeKey/generate', async (req, res) => {
    const { tradeKey } = req.params;
    const { 
        companyId, 
        itemKeys = [], // Specific items to generate (empty = all missing)
        maxCards = 10,  // Limit cards per request
        templateId     // Target template for generated scenarios
    } = req.body;
    
    if (!companyId) {
        return res.status(400).json({ success: false, error: 'companyId required' });
    }
    
    try {
        // Get blueprint spec
        const spec = BLUEPRINT_REGISTRY[tradeKey];
        if (!spec) {
            return res.status(404).json({ 
                success: false, 
                error: `Blueprint not found: ${tradeKey}` 
            });
        }
        
        // Load company for context
        const company = await Company.findById(companyId).select('name trade').lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Load existing scenarios
        const scenarios = await loadScenarios(companyId, 'activePool');
        
        // Assess coverage to find missing
        const blueprintItems = getAllBlueprintItems(spec);
        const assessment = assessCoverage(blueprintItems, scenarios);
        
        // Determine which items to generate
        let itemsToGenerate = assessment.missingItems;
        
        // Filter by specific keys if provided
        if (itemKeys.length > 0) {
            itemsToGenerate = itemsToGenerate.filter(item => itemKeys.includes(item.itemKey));
        }
        
        // Limit cards
        itemsToGenerate = itemsToGenerate.slice(0, maxCards);
        
        if (itemsToGenerate.length === 0) {
            return res.json({
                success: true,
                message: 'No items to generate',
                cards: [],
                count: 0
            });
        }
        
        logger.info(`[BLUEPRINTS] Generating ${itemsToGenerate.length} cards for ${tradeKey}`, {
            companyId,
            itemKeys: itemsToGenerate.map(i => i.itemKey)
        });
        
        // Validate model is allowed (enterprise control)
        const generatorConfig = { ...DEFAULT_GENERATOR_CONFIG };
        if (!ALLOWED_MODELS.includes(generatorConfig.model)) {
            return res.status(400).json({
                success: false,
                error: `Model "${generatorConfig.model}" not in allowlist: ${ALLOWED_MODELS.join(', ')}`
            });
        }
        
        // Generate cards
        const cards = [];
        const generationErrors = [];
        
        for (const item of itemsToGenerate) {
            try {
                const card = await generateScenarioCard(item, spec, company, generatorConfig);
                cards.push(card);
            } catch (err) {
                logger.error(`[BLUEPRINTS] Error generating card for ${item.itemKey}:`, err);
                generationErrors.push({ itemKey: item.itemKey, error: err.message });
            }
        }
        
        // Validate all generated cards
        const validation = validateAllCards(cards, generatorConfig);
        
        res.json({
            success: true,
            _format: 'BlueprintGenerateResponseV1',
            tradeKey,
            companyId,
            templateId,
            generatedAt: new Date().toISOString(),
            
            // Generator config used
            generatorConfig,
            
            // Generated cards
            cards,
            count: cards.length,
            
            // Validation report
            validation,
            
            // Generation errors (items that failed to generate)
            generationErrors: generationErrors.length > 0 ? generationErrors : undefined,
            
            message: `Generated ${cards.length} cards (${validation.passed} passed, ${validation.withWarnings} with warnings)`
        });
        
    } catch (error) {
        logger.error(`[BLUEPRINTS] Error generating cards for ${tradeKey}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Load scenarios from the specified source
 */
async function loadScenarios(companyId, source) {
    let scenarios = [];
    
    try {
        if (source === 'activePool' || source === 'templates') {
            // Load from scenario pool service
            const ScenarioPoolService = require('../../services/ScenarioPoolService');
            const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            scenarios = poolResult?.scenarios || [];
        } else if (source === 'company') {
            // Load company-specific only
            const company = await Company.findById(companyId).select('scenarios aiCoreScenarios').lean();
            scenarios = company?.scenarios || company?.aiCoreScenarios || [];
        }
    } catch (e) {
        // Fallback to templates
        const templates = await GlobalInstantResponseTemplate.find({}).lean();
        for (const template of templates) {
            for (const category of (template.categories || [])) {
                scenarios.push(...(category.scenarios || []));
            }
        }
    }
    
    return scenarios;
}

/**
 * Assess coverage of existing scenarios against blueprint items
 */
function assessCoverage(blueprintItems, existingScenarios) {
    const matchedItems = [];
    const missingItems = [];
    const duplicates = [];
    const weakCoverage = [];
    
    // Build trigger fingerprint from existing scenarios
    const scenarioFingerprints = existingScenarios.map(scenario => ({
        scenarioId: scenario.scenarioId || scenario._id?.toString(),
        name: scenario.name,
        triggers: (scenario.triggers || []).map(t => t?.toLowerCase?.() || ''),
        examplePhrases: (scenario.exampleUserPhrases || []).map(t => t?.toLowerCase?.() || ''),
        scenarioType: scenario.scenarioType,
        fullReplies: scenario.fullReplies || [],
        quickReplies: scenario.quickReplies || []
    }));
    
    // Check each blueprint item
    for (const item of blueprintItems) {
        const triggerHints = (item.triggerHints || []).map(t => t.toLowerCase());
        
        // Find matching scenarios by trigger overlap
        const matches = [];
        
        for (const scenario of scenarioFingerprints) {
            const allScenarioTriggers = [...scenario.triggers, ...scenario.examplePhrases];
            
            // Count how many blueprint trigger hints match scenario triggers
            let hitCount = 0;
            for (const hint of triggerHints) {
                const hintWords = hint.split(' ');
                for (const trigger of allScenarioTriggers) {
                    // Check if hint is contained in trigger or trigger contains hint
                    if (trigger.includes(hint) || hint.includes(trigger)) {
                        hitCount++;
                        break;
                    }
                    // Also check word overlap
                    const triggerWords = trigger.split(' ');
                    const overlap = hintWords.filter(w => triggerWords.includes(w)).length;
                    if (overlap >= Math.min(2, hintWords.length)) {
                        hitCount++;
                        break;
                    }
                }
            }
            
            const coverage = triggerHints.length > 0 ? hitCount / triggerHints.length : 0;
            
            if (coverage >= 0.3) { // 30% trigger overlap = potential match
                matches.push({
                    scenarioId: scenario.scenarioId,
                    scenarioName: scenario.name,
                    coverage: Math.round(coverage * 100),
                    hitCount
                });
            }
        }
        
        if (matches.length > 0) {
            // Sort by coverage
            matches.sort((a, b) => b.coverage - a.coverage);
            
            matchedItems.push({
                itemKey: item.itemKey,
                name: item.name,
                scenarioType: item.scenarioType,
                required: item.required,
                categoryKey: item.categoryKey,
                bestMatch: matches[0],
                allMatches: matches
            });
            
            // Check for duplicates (multiple strong matches)
            if (matches.filter(m => m.coverage >= 60).length > 1) {
                duplicates.push({
                    itemKey: item.itemKey,
                    name: item.name,
                    matches: matches.filter(m => m.coverage >= 60)
                });
            }
            
            // Check for weak coverage
            if (matches[0].coverage < 50) {
                weakCoverage.push({
                    itemKey: item.itemKey,
                    name: item.name,
                    coverage: matches[0].coverage,
                    scenarioId: matches[0].scenarioId,
                    scenarioName: matches[0].scenarioName
                });
            }
        } else {
            missingItems.push(item);
        }
    }
    
    return {
        matchedItems,
        missingItems,
        duplicates,
        weakCoverage
    };
}

/**
 * Generate a content-only scenario card from a blueprint item
 * @param {Object} item - Blueprint item to generate
 * @param {Object} spec - Blueprint spec
 * @param {Object} company - Company context
 * @param {Object} config - GeneratorConfigV1
 */
async function generateScenarioCard(item, spec, company, config = DEFAULT_GENERATOR_CONFIG) {
    const contentFields = getContentFields();
    const constraints = config.constraints || {};
    
    // Build system prompt with constraints
    const systemPrompt = `You are a scenario generator for a dispatcher AI system.

CRITICAL RULES:
1. Generate ONLY content fields - no runtime or admin fields
2. Replies must be dispatcher-style (calm, professional, efficient)
3. NO chatbot phrases (thank you for reaching out, happy to help, etc.)
4. NO troubleshooting advice (have you tried, did you check, etc.)
5. NO helpdesk phrases (definitely, absolutely, of course, sure thing, no problem)
6. quickReplies = ONE classifying question (max ${constraints.maxQuickReplyWords || 25} words)
7. fullReplies = progress toward booking (max ${constraints.maxFullReplyWords || 35} words)
8. Include {name} placeholder in at least 3 replies
9. Triggers must be realistic phrases customers say
10. Generate at least ${constraints.minTriggers || 8} triggers
11. Generate at least ${constraints.minQuickReplies || 3} quickReplies
12. Generate at least ${constraints.minFullReplies || 3} fullReplies

Output JSON only - no markdown, no explanation.`;
    
    // Build prompt for GPT
    const prompt = buildGenerationPrompt(item, spec, company, constraints);
    
    try {
        const completion = await getOpenAI().chat.completions.create({
            model: config.model || 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            temperature: config.temperature || 0.7,
            max_tokens: config.maxTokens || 2000,
            top_p: config.topP || 1,
            frequency_penalty: config.frequencyPenalty || 0,
            presence_penalty: config.presencePenalty || 0,
            response_format: { type: 'json_object' }
        });
        
        // Parse response
        const content = completion.choices[0]?.message?.content;
        let generated = JSON.parse(content);
        
        // Generate unique scenarioId
        generated.scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        // Ensure required fields
        generated.name = generated.name || item.name;
        generated.scenarioType = generated.scenarioType || item.scenarioType;
        generated.status = 'live';
        generated.isActive = true;
        generated.bookingIntent = item.bookingIntent ?? false;
        
        // Default priority based on scenario type
        if (!generated.priority) {
            const priorityMap = {
                EMERGENCY: 95,
                TRANSFER: 85,
                BOOKING: 60,
                TROUBLESHOOT: 70,
                FAQ: 40,
                BILLING: 45,
                SUPPORT: 50,
                POLICY: 30,
                SMALL_TALK: 5,
                SYSTEM: 10
            };
            generated.priority = priorityMap[item.scenarioType] || 50;
        }
        
        // Default minConfidence
        if (!generated.minConfidence) {
            generated.minConfidence = item.scenarioType === 'EMERGENCY' ? 0.5 : 0.6;
        }
        
        // Enforce content ownership - strip any non-content fields
        const { sanitized, stripped } = enforceContentOwnership(generated, { 
            source: 'blueprint-generation',
            logWarnings: false 
        });
        
        // Add _noName variants if not present
        if (sanitized.quickReplies && !sanitized.quickReplies_noName) {
            sanitized.quickReplies_noName = sanitized.quickReplies.map(r => 
                r.replace(/\{name\}/gi, '').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
            );
        }
        if (sanitized.fullReplies && !sanitized.fullReplies_noName) {
            sanitized.fullReplies_noName = sanitized.fullReplies.map(r => 
                r.replace(/\{name\}/gi, '').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
            );
        }
        
        // Build card format (same as Gap cards)
        const card = {
            // Identification
            itemKey: item.itemKey,
            blueprintId: spec.blueprintId,
            
            // Generated scenario (content-only)
            scenario: sanitized,
            
            // Metadata
            categoryKey: item.categoryKey,
            categoryName: item.categoryName,
            required: item.required,
            priority: item.priority,
            
            // Generation info
            generatedAt: new Date().toISOString(),
            source: 'blueprint',
            model: 'gpt-4o',
            
            // If any fields were stripped
            strippedFields: stripped.length > 0 ? stripped : undefined
        };
        
        return card;
        
    } catch (error) {
        logger.error(`[BLUEPRINTS] GPT generation failed for ${item.itemKey}:`, error);
        throw error;
    }
}

/**
 * Build the generation prompt for a blueprint item
 * @param {Object} item - Blueprint item
 * @param {Object} spec - Blueprint spec
 * @param {Object} company - Company context
 * @param {Object} constraints - Generator constraints
 */
function buildGenerationPrompt(item, spec, company, constraints = {}) {
    const contentFields = getContentFields();
    const minTriggers = constraints.minTriggers || 10;
    const maxQuickWords = constraints.maxQuickReplyWords || 25;
    const maxFullWords = constraints.maxFullReplyWords || 35;
    
    return `Generate a scenario for: "${item.name}"

BLUEPRINT CONTEXT:
- Trade: ${spec.tradeKey.toUpperCase()}
- Category: ${item.categoryName || item.categoryKey}
- Scenario Type: ${item.scenarioType}
- Reply Goal: ${item.replyGoal || 'classify'}
- Booking Intent: ${item.bookingIntent ? 'YES - should lead to booking' : 'NO - informational'}
${item.notes ? `- Notes: ${item.notes}` : ''}

TRIGGER HINTS (expand these to ${minTriggers}+ realistic phrases):
${item.triggerHints.map(t => `- "${t}"`).join('\n')}

${item.negativeTriggerHints?.length > 0 ? `NEGATIVE TRIGGERS (phrases that should NOT match):
${item.negativeTriggerHints.map(t => `- "${t}"`).join('\n')}` : ''}

COMPANY: ${company?.name || 'Service Company'}

Generate a JSON object with ONLY these content fields:
${contentFields.slice(0, 15).map(f => `- ${f}`).join('\n')}

REQUIREMENTS:
1. "triggers": Array of ${minTriggers}+ realistic customer phrases
2. "negativeTriggers": Array of 3-5 phrases that should NOT match
3. "quickReplies": Array of 5 short replies (ONE question each, max ${maxQuickWords} words)
4. "fullReplies": Array of 5 longer replies (max ${maxFullWords} words)
5. "quickReplies_noName": Same as quickReplies but without {name}
6. "fullReplies_noName": Same as fullReplies but without {name}
7. Include {name} in at least 3 replies
8. "exampleUserPhrases": Array of 12-18 example customer phrases
9. "behavior": "calm_professional"
10. "bookingIntent": ${item.bookingIntent ? 'true' : 'false'}

BANNED PHRASES (never use these):
- "thank you for reaching out", "happy to help", "how can i assist"
- "definitely", "absolutely", "of course", "sure thing", "no problem"
- "i understand", "i appreciate", "great question"

Reply goal "${item.replyGoal}":
- "classify": quickReplies ask ONE classifying question
- "book": fullReplies progress toward scheduling
- "inform": provide information directly
- "transfer": acknowledge and transfer
- "close": end conversation gracefully

Output only valid JSON.`;
}

module.exports = router;

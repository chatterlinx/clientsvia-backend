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
        
        res.json({
            success: true,
            blueprintId: spec.blueprintId,
            blueprintName: spec.name,
            blueprintVersion: spec.version,
            
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
            
            // UI helpers
            canGenerate: assessment.missingItems.length > 0,
            generateButtonLabel: assessment.missingItems.length > 0
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
        
        // Generate cards
        const cards = [];
        const errors = [];
        
        for (const item of itemsToGenerate) {
            try {
                const card = await generateScenarioCard(item, spec, company);
                cards.push(card);
            } catch (err) {
                logger.error(`[BLUEPRINTS] Error generating card for ${item.itemKey}:`, err);
                errors.push({ itemKey: item.itemKey, error: err.message });
            }
        }
        
        res.json({
            success: true,
            cards,
            count: cards.length,
            errors: errors.length > 0 ? errors : undefined,
            templateId,
            message: `Generated ${cards.length} scenario cards`
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
 */
async function generateScenarioCard(item, spec, company) {
    const contentFields = getContentFields();
    
    // Build prompt for GPT
    const prompt = buildGenerationPrompt(item, spec, company);
    
    try {
        const completion = await getOpenAI().chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: `You are a scenario generator for a dispatcher AI system.
                    
CRITICAL RULES:
1. Generate ONLY content fields - no runtime or admin fields
2. Replies must be dispatcher-style (calm, professional, efficient)
3. NO chatbot phrases (thank you for reaching out, happy to help, etc.)
4. NO troubleshooting advice (have you tried, did you check, etc.)
5. quickReplies = ONE classifying question (under 25 words)
6. fullReplies = progress toward booking (under 30 words)
7. Include {name} placeholder in at least 3 replies
8. Triggers must be realistic phrases customers say

Output JSON only - no markdown, no explanation.`
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 2000,
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
 */
function buildGenerationPrompt(item, spec, company) {
    const contentFields = getContentFields();
    
    return `Generate a scenario for: "${item.name}"

BLUEPRINT CONTEXT:
- Trade: ${spec.tradeKey.toUpperCase()}
- Category: ${item.categoryName || item.categoryKey}
- Scenario Type: ${item.scenarioType}
- Reply Goal: ${item.replyGoal || 'classify'}
- Booking Intent: ${item.bookingIntent ? 'YES - should lead to booking' : 'NO - informational'}
${item.notes ? `- Notes: ${item.notes}` : ''}

TRIGGER HINTS (expand these to 10-15 realistic phrases):
${item.triggerHints.map(t => `- "${t}"`).join('\n')}

${item.negativeTriggerHints?.length > 0 ? `NEGATIVE TRIGGERS (phrases that should NOT match):
${item.negativeTriggerHints.map(t => `- "${t}"`).join('\n')}` : ''}

COMPANY: ${company?.name || 'HVAC Service Company'}

Generate a JSON object with ONLY these content fields:
${contentFields.slice(0, 15).map(f => `- ${f}`).join('\n')}

REQUIREMENTS:
1. "triggers": Array of 10-15 realistic customer phrases
2. "negativeTriggers": Array of 3-5 phrases that should NOT match
3. "quickReplies": Array of 5 short replies (ONE question each, <25 words)
4. "fullReplies": Array of 5 longer replies (<30 words)
5. "quickReplies_noName": Same as quickReplies but without {name}
6. "fullReplies_noName": Same as fullReplies but without {name}
7. Include {name} in at least 3 replies
8. "exampleUserPhrases": Array of 12-18 example customer phrases
9. "behavior": "calm_professional"

Reply goal "${item.replyGoal}":
- "classify": quickReplies ask ONE classifying question
- "book": fullReplies progress toward scheduling
- "inform": provide information directly
- "transfer": acknowledge and transfer
- "close": end conversation gracefully

Output only valid JSON.`;
}

module.exports = router;

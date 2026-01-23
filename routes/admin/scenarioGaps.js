/**
 * ============================================================================
 * SCENARIO GAPS API - Enterprise Intelligence System
 * ============================================================================
 * 
 * PURPOSE:
 * Surfaces missed scenarios from Tier 3 (LLM fallback) calls, enabling
 * one-click scenario creation with AI-generated triggers and responses.
 * 
 * ENDPOINTS:
 * GET  /:companyId/gaps         - Get all scenario gaps with priority ranking
 * GET  /:companyId/gaps/preview - Preview AI-generated scenario (query: representative, examples)
 * POST /:companyId/gaps/create  - Auto-create scenario from gap
 * POST /:companyId/gaps/dismiss - Dismiss a gap (won't show again)
 * 
 * FEATURES:
 * - Aggregates Tier 3 calls from past 7-30 days
 * - Clusters similar caller phrases using semantic analysis
 * - Calculates cost impact (tokens used, potential savings)
 * - AI-generates complete scenario with triggers, reply, placeholders
 * - Tracks dismissed gaps to avoid repetition
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');

// Authentication & Authorization
const { authenticateJWT } = require('../../middleware/auth');
const authorizeCompanyAccess = require('../../middleware/authorizeCompanyAccess');

// Models
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// Services
const openaiClient = require('../../config/openai');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE - All routes require authentication
// ============================================================================
router.use('/:companyId', authenticateJWT, authorizeCompanyAccess);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Analysis window
    DEFAULT_DAYS_BACK: 7,
    MAX_DAYS_BACK: 30,
    
    // Clustering
    MIN_CALLS_FOR_GAP: 2,           // Minimum calls to surface as a gap
    HIGH_PRIORITY_THRESHOLD: 5,     // 5+ calls = high priority
    MEDIUM_PRIORITY_THRESHOLD: 3,   // 3-4 calls = medium priority
    
    // Cost estimation (per 1K tokens)
    COST_PER_1K_INPUT_TOKENS: 0.00015,
    COST_PER_1K_OUTPUT_TOKENS: 0.0006,
    AVG_TOKENS_PER_TIER3_CALL: 800,
    
    // Limits
    MAX_GAPS_RETURNED: 20,
    MAX_EXAMPLES_PER_GAP: 5
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s''-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate similarity between two strings (Jaccard similarity on words)
 */
function calculateSimilarity(text1, text2) {
    const words1 = new Set(normalizeText(text1).split(' ').filter(w => w.length > 2));
    const words2 = new Set(normalizeText(text2).split(' ').filter(w => w.length > 2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

/**
 * Cluster similar phrases together
 */
function clusterPhrases(phrases, similarityThreshold = 0.5) {
    const clusters = [];
    const assigned = new Set();
    
    for (let i = 0; i < phrases.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = {
            representative: phrases[i].text,
            examples: [phrases[i]],
            totalCalls: phrases[i].count || 1,
            totalTokens: phrases[i].tokens || 0,
            callIds: phrases[i].callIds || []
        };
        assigned.add(i);
        
        // Find similar phrases
        for (let j = i + 1; j < phrases.length; j++) {
            if (assigned.has(j)) continue;
            
            const similarity = calculateSimilarity(phrases[i].text, phrases[j].text);
            if (similarity >= similarityThreshold) {
                cluster.examples.push(phrases[j]);
                cluster.totalCalls += phrases[j].count || 1;
                cluster.totalTokens += phrases[j].tokens || 0;
                cluster.callIds = [...cluster.callIds, ...(phrases[j].callIds || [])];
                assigned.add(j);
            }
        }
        
        clusters.push(cluster);
    }
    
    return clusters;
}

/**
 * Determine gap priority based on call count
 */
function getPriority(callCount) {
    if (callCount >= CONFIG.HIGH_PRIORITY_THRESHOLD) return 'high';
    if (callCount >= CONFIG.MEDIUM_PRIORITY_THRESHOLD) return 'medium';
    return 'low';
}

/**
 * Calculate estimated cost savings if scenario were created
 */
function calculateSavings(totalCalls, totalTokens) {
    const avgTokensPerCall = totalTokens / totalCalls || CONFIG.AVG_TOKENS_PER_TIER3_CALL;
    const weeklyCost = (totalCalls * avgTokensPerCall / 1000) * 
        (CONFIG.COST_PER_1K_INPUT_TOKENS + CONFIG.COST_PER_1K_OUTPUT_TOKENS);
    
    return {
        weeklyCallsSaved: totalCalls,
        weeklyTokensSaved: totalTokens || totalCalls * CONFIG.AVG_TOKENS_PER_TIER3_CALL,
        weeklyCostSaved: Math.round(weeklyCost * 100) / 100,
        monthlyCostSaved: Math.round(weeklyCost * 4.3 * 100) / 100
    };
}

/**
 * Clean raw caller text for better LLM processing
 */
function cleanCallerText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/^[,.\s]+/, '')           // Remove leading punctuation/spaces
        .replace(/[,.\s]+$/, '')           // Remove trailing punctuation/spaces
        .replace(/\s+/g, ' ')              // Normalize whitespace
        .replace(/\bi\s+i\b/gi, 'I')       // Fix "i i" stutter
        .replace(/\bum+\b/gi, '')          // Remove um
        .replace(/\buh+\b/gi, '')          // Remove uh
        .replace(/\s+/g, ' ')              // Re-normalize whitespace
        .trim();
}

/**
 * Generate scenario using LLM
 */
async function generateScenarioFromGap(gap, company) {
    const openai = openaiClient;
    if (!openai) {
        logger.warn('[SCENARIO GAPS] OpenAI client not available, using fallback generation');
        return generateFallbackScenario(gap, company);
    }
    
    // Clean up the examples for better LLM input
    const cleanedExamples = gap.examples
        .slice(0, 5)
        .map(e => cleanCallerText(e.text))
        .filter(t => t.length > 5);
    
    const examples = cleanedExamples.map(e => `- "${e}"`).join('\n');
    
    const prompt = `You are an expert at creating voice AI receptionist trigger scenarios for ${company.tradeKey?.toUpperCase() || 'service'} businesses.

COMPANY: ${company.companyName || 'Service Company'}
TRADE: ${company.tradeKey || 'general'}

CALLER PHRASES (asked ${gap.totalCalls} times, fell through to expensive LLM):
${examples}

Your job is to create a SCENARIO with TRIGGERS that will match these caller phrases.

═══════════════════════════════════════════════════════════════════════════════
TRIGGER RULES (CRITICAL - READ CAREFULLY):
═══════════════════════════════════════════════════════════════════════════════
1. Triggers must be CLEAN phrases - no leading commas, periods, or partial sentences
2. Include 8-12 trigger variations covering different ways to ask the same thing
3. Include both LONG and SHORT versions:
   - Short: "earliest available", "first opening", "soonest appointment"
   - Long: "what's the earliest you have", "when is your first available"
4. Include common phrasings people use:
   - Question format: "when is...", "what's the...", "do you have..."
   - Statement format: "i need the earliest", "looking for the soonest"
5. DO NOT include caller-specific details like names, times, or filler words
6. Each trigger should be 2-6 words ideally (some can be longer)

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only, no markdown code blocks):
═══════════════════════════════════════════════════════════════════════════════
{
    "name": "Short descriptive name (3-5 words, e.g., 'Earliest Appointment Availability')",
    "category": "One of: Scheduling, Pricing, Service Area, Hours, Emergency, FAQ, Warranty, General",
    "triggers": [
        "short trigger 1",
        "short trigger 2", 
        "medium trigger phrase",
        "longer trigger phrase variation",
        "another way to ask this",
        "yet another phrasing",
        "question format version",
        "statement format version"
    ],
    "negativeTriggers": ["phrases that look similar but mean something different"],
    "quickReply": "Helpful 1-2 sentence response. Use {placeholderName} for values the company needs to configure.",
    "suggestedPlaceholders": [
        {"key": "placeholderName", "description": "What this represents", "exampleValue": "example"}
    ],
    "responseGoal": "What this accomplishes for the caller"
}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { 
                    role: 'system', 
                    content: `You are an expert scenario trigger creator for voice AI systems. 
Your triggers must be CLEAN (no leading punctuation), VARIED (8-12 options), and cover SHORT + LONG phrasings.
Output valid JSON only. No markdown code blocks. No explanations.` 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.4,
            max_tokens: 1200
        });
        
        const content = response.choices[0]?.message?.content || '';
        
        // Parse JSON (handle potential markdown wrapping)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }
        
        const scenario = JSON.parse(jsonStr);
        
        return {
            success: true,
            scenario: {
                name: scenario.name || gap.representative,
                category: scenario.category || 'FAQ',
                triggers: scenario.triggers || [gap.representative],
                negativeTriggers: scenario.negativeTriggers || [],
                quickReply: scenario.quickReply || `I can help with that. ${gap.representative}`,
                suggestedPlaceholders: scenario.suggestedPlaceholders || [],
                responseGoal: scenario.responseGoal || 'Answer caller question',
                generatedBy: 'ai',
                confidence: 0.85
            },
            tokensUsed: response.usage?.total_tokens || 0
        };
    } catch (error) {
        logger.error('[SCENARIO GAPS] LLM generation failed', { error: error.message });
        return generateFallbackScenario(gap, company);
    }
}

/**
 * Fallback scenario generation (no LLM)
 */
function generateFallbackScenario(gap, company) {
    const normalized = normalizeText(gap.representative);
    
    // Extract potential category from keywords
    let category = 'FAQ';
    if (/price|cost|how much|rate|fee/.test(normalized)) category = 'Pricing';
    else if (/hour|open|close|available/.test(normalized)) category = 'Hours';
    else if (/service|area|location|zip/.test(normalized)) category = 'Service Area';
    else if (/warranty|guarantee/.test(normalized)) category = 'Warranty';
    else if (/emergency|urgent|asap/.test(normalized)) category = 'Emergency';
    
    // Generate triggers from examples
    const triggers = gap.examples
        .slice(0, 5)
        .map(e => normalizeText(e.text))
        .filter(t => t.length > 5);
    
    return {
        success: true,
        scenario: {
            name: gap.representative.substring(0, 50),
            category,
            triggers: triggers.length > 0 ? triggers : [normalized],
            negativeTriggers: [],
            quickReply: `I can help you with that. Let me get more information to assist you.`,
            suggestedPlaceholders: [],
            responseGoal: 'Answer caller question',
            generatedBy: 'fallback',
            confidence: 0.5
        },
        tokensUsed: 0
    };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /:companyId/gaps
 * 
 * Get all scenario gaps for a company, prioritized by impact
 */
router.get('/:companyId/gaps', async (req, res) => {
    const { companyId } = req.params;
    const { days = CONFIG.DEFAULT_DAYS_BACK, minCalls = CONFIG.MIN_CALLS_FOR_GAP } = req.query;
    
    logger.info('[SCENARIO GAPS] Request received', { companyId, days, minCalls });
    
    try {
        // Validate company
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate date range
        const daysBack = Math.min(parseInt(days) || CONFIG.DEFAULT_DAYS_BACK, CONFIG.MAX_DAYS_BACK);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        
        // Fetch Tier 3 calls from Black Box
        const recordings = await BlackBoxRecording.find({
            companyId: new mongoose.Types.ObjectId(companyId),
            createdAt: { $gte: startDate },
            'events.type': 'TIER3_FALLBACK'
        }).lean();
        
        logger.info('[SCENARIO GAPS] Analyzing recordings', { 
            companyId, 
            recordingsFound: recordings.length,
            daysBack 
        });
        
        // Extract Tier 3 caller phrases
        const tier3Phrases = [];
        
        for (const recording of recordings) {
            const events = recording.events || [];
            
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                
                if (event.type === 'TIER3_FALLBACK') {
                    // Find the preceding GATHER_FINAL to get what caller said
                    let callerText = '';
                    let tokens = event.data?.tokensUsed || 0;
                    
                    // Look backwards for the caller input
                    for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
                        if (events[j].type === 'GATHER_FINAL' && events[j].data?.text) {
                            callerText = events[j].data.text;
                            break;
                        }
                    }
                    
                    if (callerText && callerText.length > 5) {
                        tier3Phrases.push({
                            text: callerText,
                            tokens,
                            callIds: [recording._id.toString()],  // Array for clustering
                            timestamp: event.ts || recording.createdAt
                        });
                    }
                }
            }
        }
        
        logger.info('[SCENARIO GAPS] Extracted Tier 3 phrases', { count: tier3Phrases.length });
        
        // Cluster similar phrases
        const clusters = clusterPhrases(tier3Phrases, 0.4);
        
        // Filter by minimum calls and sort by impact
        const minCallsInt = parseInt(minCalls) || CONFIG.MIN_CALLS_FOR_GAP;
        const significantGaps = clusters
            .filter(c => c.totalCalls >= minCallsInt)
            .map((cluster, index) => ({
                id: `gap_${index}_${Date.now()}`,
                representative: cluster.representative,
                examples: cluster.examples.slice(0, CONFIG.MAX_EXAMPLES_PER_GAP).map(e => ({
                    text: e.text,
                    timestamp: e.timestamp
                })),
                callCount: cluster.totalCalls,
                totalTokens: cluster.totalTokens,
                priority: getPriority(cluster.totalCalls),
                savings: calculateSavings(cluster.totalCalls, cluster.totalTokens),
                callIds: cluster.callIds.slice(0, 10) // Limit for response size
            }))
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, CONFIG.MAX_GAPS_RETURNED);
        
        // Calculate summary stats
        const totalTier3Calls = tier3Phrases.length;
        const totalTokensUsed = tier3Phrases.reduce((sum, p) => sum + (p.tokens || 0), 0);
        const totalEstimatedCost = (totalTokensUsed / 1000) * 
            (CONFIG.COST_PER_1K_INPUT_TOKENS + CONFIG.COST_PER_1K_OUTPUT_TOKENS);
        
        const summary = {
            period: `Last ${daysBack} days`,
            totalTier3Calls,
            uniqueGaps: significantGaps.length,
            totalTokensUsed,
            estimatedCost: Math.round(totalEstimatedCost * 100) / 100,
            potentialSavings: significantGaps.reduce((sum, g) => sum + g.savings.weeklyCostSaved, 0),
            highPriorityCount: significantGaps.filter(g => g.priority === 'high').length,
            mediumPriorityCount: significantGaps.filter(g => g.priority === 'medium').length
        };
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            summary,
            gaps: significantGaps
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching gaps', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to analyze scenario gaps', details: error.message });
    }
});

/**
 * GET /:companyId/gaps/preview
 * 
 * Preview AI-generated scenario for a gap (without creating it)
 * Query params: representative (required), examples (optional JSON array)
 */
router.get('/:companyId/gaps/preview', async (req, res) => {
    const { companyId } = req.params;
    const { representative, examples } = req.query;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Build gap object from query params
        const gap = {
            representative: representative || 'Unknown question',
            examples: examples ? JSON.parse(examples) : [{ text: representative }],
            totalCalls: 1
        };
        
        // Generate scenario preview
        const result = await generateScenarioFromGap(gap, company);
        
        res.json({
            success: true,
            preview: result.scenario,
            tokensUsed: result.tokensUsed
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error generating preview', { error: error.message });
        res.status(500).json({ error: 'Failed to generate scenario preview', details: error.message });
    }
});

/**
 * POST /:companyId/gaps/create
 * 
 * Create a scenario from a gap
 */
router.post('/:companyId/gaps/create', async (req, res) => {
    const { companyId } = req.params;
    const { 
        representative, 
        examples = [], 
        // Optional overrides (if user edited the AI suggestion)
        name,
        category,
        triggers,
        negativeTriggers,
        quickReply,
        fullReply,
        placeholders
    } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template for this company's trade
        const template = await GlobalInstantResponseTemplate.findOne({
            tradeKey: company.tradeKey || 'universal'
        });
        
        if (!template) {
            return res.status(404).json({ error: 'No template found for company trade' });
        }
        
        // Generate or use provided scenario data
        let scenarioData;
        
        if (name && triggers && quickReply) {
            // User provided custom data
            scenarioData = {
                name,
                category: category || 'FAQ',
                triggers: Array.isArray(triggers) ? triggers : [triggers],
                negativeTriggers: negativeTriggers || [],
                quickReply,
                fullReply: fullReply || null
            };
        } else {
            // Generate from gap
            const gap = {
                representative,
                examples: examples.map(e => typeof e === 'string' ? { text: e } : e),
                totalCalls: examples.length || 1
            };
            
            const result = await generateScenarioFromGap(gap, company);
            scenarioData = result.scenario;
        }
        
        // Find or create the category
        let categoryDoc = template.categories.find(c => 
            c.name.toLowerCase() === scenarioData.category.toLowerCase()
        );
        
        if (!categoryDoc) {
            // Create new category
            categoryDoc = {
                name: scenarioData.category,
                description: `Auto-created category for ${scenarioData.category} scenarios`,
                scenarios: [],
                createdAt: new Date()
            };
            template.categories.push(categoryDoc);
        }
        
        // Create the scenario
        const newScenario = {
            name: scenarioData.name,
            description: `Auto-created from Scenario Gaps. Original phrase: "${representative}"`,
            triggers: scenarioData.triggers,
            negativeTriggers: scenarioData.negativeTriggers || [],
            quickReplies: [scenarioData.quickReply],
            fullReplies: scenarioData.fullReply ? [scenarioData.fullReply] : [],
            priority: 50,
            enabled: true,
            aiGenerated: true,
            createdAt: new Date(),
            createdBy: 'scenario_gaps_system',
            metadata: {
                source: 'scenario_gaps',
                originalPhrase: representative,
                exampleCount: examples.length,
                generatedBy: scenarioData.generatedBy || 'ai'
            }
        };
        
        // Add scenario to category
        const categoryIndex = template.categories.findIndex(c => c.name === categoryDoc.name);
        if (categoryIndex >= 0) {
            template.categories[categoryIndex].scenarios.push(newScenario);
        }
        
        // Save template
        template.markModified('categories');
        await template.save();
        
        // Add suggested placeholders to company if provided
        if (scenarioData.suggestedPlaceholders && scenarioData.suggestedPlaceholders.length > 0) {
            const existingPlaceholders = company.placeholders || {};
            let placeholdersAdded = 0;
            
            for (const ph of scenarioData.suggestedPlaceholders) {
                if (!existingPlaceholders[ph.key]) {
                    existingPlaceholders[ph.key] = ph.exampleValue || `[Set ${ph.key}]`;
                    placeholdersAdded++;
                }
            }
            
            if (placeholdersAdded > 0) {
                company.placeholders = existingPlaceholders;
                await company.save();
            }
        }
        
        logger.info('[SCENARIO GAPS] Scenario created', {
            companyId,
            scenarioName: newScenario.name,
            category: categoryDoc.name,
            triggersCount: newScenario.triggers.length
        });
        
        res.json({
            success: true,
            message: 'Scenario created successfully',
            scenario: {
                name: newScenario.name,
                category: categoryDoc.name,
                triggers: newScenario.triggers,
                quickReply: newScenario.quickReplies[0]
            },
            templateId: template._id.toString(),
            suggestedPlaceholders: scenarioData.suggestedPlaceholders || []
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error creating scenario', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to create scenario', details: error.message });
    }
});

/**
 * POST /:companyId/gaps/dismiss
 * 
 * Dismiss a gap (user doesn't want a scenario for this)
 */
router.post('/:companyId/gaps/dismiss', async (req, res) => {
    const { companyId } = req.params;
    const { representative, reason } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Store dismissed gaps in company metadata
        if (!company.metadata) company.metadata = {};
        if (!company.metadata.dismissedScenarioGaps) company.metadata.dismissedScenarioGaps = [];
        
        company.metadata.dismissedScenarioGaps.push({
            representative,
            reason: reason || 'User dismissed',
            dismissedAt: new Date()
        });
        
        // Keep only last 100 dismissed gaps
        if (company.metadata.dismissedScenarioGaps.length > 100) {
            company.metadata.dismissedScenarioGaps = company.metadata.dismissedScenarioGaps.slice(-100);
        }
        
        company.markModified('metadata');
        await company.save();
        
        res.json({
            success: true,
            message: 'Gap dismissed'
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error dismissing gap', { error: error.message });
        res.status(500).json({ error: 'Failed to dismiss gap', details: error.message });
    }
});

module.exports = router;

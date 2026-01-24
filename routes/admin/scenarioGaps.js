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
const { BOOKING_PHRASES, SCENARIO_SETTINGS_REGISTRY, getSettingsCount } = require('../../services/scenarioAudit/constants');

// Services
const openaiClient = require('../../config/openai');
const logger = require('../../utils/logger');
const { AuditEngine, getAvailableRules } = require('../../services/scenarioAudit');

// ============================================================================
// MIDDLEWARE - All routes require authentication
// ============================================================================
router.use('/:companyId', authenticateJWT, authorizeCompanyAccess);

// ============================================================================
// HELPER: Get company's assigned template (DRY - used by multiple routes)
// ============================================================================
// STRICT MODE: Returns { template, error } - caller MUST handle error
// No silent fallbacks - missing template = admin action required
// ============================================================================
async function getCompanyTemplate(company, options = {}) {
    const { lean = true, throwOnMissing = false } = options;
    const companyId = company._id?.toString();
    const companyName = company.companyName || company.businessName || 'Unknown';
    
    // Step 1: Check templateReferences exist
    const templateRefs = company.aiAgentSettings?.templateReferences || [];
    
    if (templateRefs.length === 0) {
        const error = {
            code: 'NO_TEMPLATE_REFERENCES',
            message: `Company "${companyName}" has no template references configured`,
            companyId,
            fix: 'Admin must assign a template in aiAgentSettings.templateReferences'
        };
        logger.error('[SCENARIO GAPS] HARD STOP - No template references', error);
        if (throwOnMissing) throw new Error(error.message);
        return { template: null, error };
    }
    
    // Step 2: Find the ACTIVE template (explicit selection, not [0] blindly)
    // Priority: enabled=true with lowest priority number, then first enabled, then first overall
    const enabledRefs = templateRefs.filter(ref => ref.enabled !== false);
    const sortedRefs = enabledRefs.sort((a, b) => (a.priority || 999) - (b.priority || 999));
    const activeRef = sortedRefs[0] || templateRefs[0];
    
    if (!activeRef?.templateId) {
        const error = {
            code: 'INVALID_TEMPLATE_REFERENCE',
            message: `Company "${companyName}" has template references but no valid templateId`,
            companyId,
            templateRefs: templateRefs.length,
            fix: 'Check templateReferences array - templateId may be missing'
        };
        logger.error('[SCENARIO GAPS] HARD STOP - Invalid template reference', error);
        if (throwOnMissing) throw new Error(error.message);
        return { template: null, error };
    }
    
    // Step 3: Fetch the template
    const query = GlobalInstantResponseTemplate.findById(activeRef.templateId);
    const template = lean ? await query.lean() : await query;
    
    if (!template) {
        const error = {
            code: 'TEMPLATE_NOT_FOUND',
            message: `Template ${activeRef.templateId} not found in database`,
            companyId,
            templateId: activeRef.templateId,
            fix: 'Template may have been deleted - reassign a valid template'
        };
        logger.error('[SCENARIO GAPS] HARD STOP - Template not found', error);
        if (throwOnMissing) throw new Error(error.message);
        return { template: null, error };
    }
    
    // Step 4: Log successful resolution (for debugging/tracing)
    // Include WHICH templateRef was selected for full traceability
    const scenarioCount = (template.categories || []).reduce((sum, c) => sum + (c.scenarios?.length || 0), 0);
    const categoryCount = (template.categories || []).length;
    
    logger.info('[SCENARIO GAPS] Template resolved', {
        companyId,
        companyName,
        // Template details
        templateId: template._id?.toString(),
        templateName: template.name,
        templateType: template.templateType,
        scenarioCount,
        categoryCount,
        // Selection details (which ref was chosen and why)
        selectedRef: {
            templateId: activeRef.templateId,
            priority: activeRef.priority || 'default',
            enabled: activeRef.enabled !== false,
            clonedAt: activeRef.clonedAt
        },
        selectionMethod: sortedRefs.length > 0 ? 'priority_sorted' : 'first_available',
        totalRefs: templateRefs.length,
        enabledRefs: enabledRefs.length
    });
    
    return { template, error: null };
}

// ============================================================================
// HELPER: Build full scenario list for GPT-4o context (duplicate detection)
// ============================================================================
function buildScenarioListForGPT(template) {
    const allScenarios = [];
    const toneExamples = [];
    
    for (const category of (template.categories || [])) {
        for (const scenario of (category.scenarios || [])) {
            // Collect ALL scenarios with name + triggers for duplicate detection
            allScenarios.push({
                scenarioId: scenario._id?.toString() || scenario.scenarioId,
                name: scenario.name,
                category: category.name,
                triggers: (scenario.triggers || []).slice(0, 5) // First 5 triggers for context
            });
            
            // Collect up to 5 tone examples (scenarios with good quickReplies)
            if (toneExamples.length < 5 && scenario.quickReplies?.length > 0) {
                const reply = scenario.quickReplies[0];
                // Only include if it's a string (not weighted object)
                const replyText = typeof reply === 'string' ? reply : reply?.text;
                if (replyText) {
                    toneExamples.push({
                        name: scenario.name,
                        trigger: scenario.triggers?.[0] || 'n/a',
                        reply: replyText
                    });
                }
            }
        }
    }
    
    return { allScenarios, toneExamples };
}

// ============================================================================
// STOPWORDS - Common words to remove for better matching
// ============================================================================
const STOPWORDS = new Set([
    // Articles
    'a', 'an', 'the',
    // Pronouns
    'i', 'my', 'me', 'we', 'our', 'you', 'your', 'it', 'its',
    // Prepositions
    'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'out',
    // Conjunctions
    'and', 'or', 'but', 'so',
    // Common verbs (low semantic value in triggers)
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'can', 'could', 'will', 'would', 'should', 'may', 'might',
    'get', 'got', 'getting',
    // Common filler
    'just', 'also', 'very', 'really', 'please', 'thanks', 'thank',
    // Question words (keep some context)
    'what', 'when', 'where', 'why', 'how',
    // Negations (important but handled separately)
    // 'not', "n't", 'no' - keep these for semantic meaning
]);

// ============================================================================
// HELPER: Extract meaningful tokens from text (stopwords removed)
// ============================================================================
function extractMeaningfulTokens(text) {
    return normalizeText(text)
        .split(' ')
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ============================================================================
// HELPER: Deterministic duplicate detection (BEFORE LLM - fast + cheap)
// ============================================================================
// Checks keyword overlap between gap phrase and existing triggers
// Uses stopword removal for better matching
// Returns match if overlap score > threshold (prevents LLM call for obvious cases)
// 
// LIMITATIONS (handled by LLM fallback):
// - Misses synonyms ("won't cool" vs "blowing warm air")
// - Word order differences
// - Very short/generic triggers
// ============================================================================
function findDeterministicDuplicate(gapPhrase, allScenarios, threshold = 0.5) {
    const gapTokens = extractMeaningfulTokens(gapPhrase);
    const gapWords = new Set(gapTokens);
    
    if (gapWords.size === 0) {
        logger.debug('[SCENARIO GAPS] No meaningful tokens in gap phrase', { gapPhrase });
        return null;
    }
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const scenario of allScenarios) {
        // Check ALL triggers for this scenario (not just first 5)
        const allTriggers = scenario.triggers || [];
        
        for (const trigger of allTriggers) {
            const triggerTokens = extractMeaningfulTokens(trigger);
            const triggerWords = new Set(triggerTokens);
            
            if (triggerWords.size === 0) continue;
            
            // Jaccard similarity on meaningful tokens
            const intersection = [...gapWords].filter(w => triggerWords.has(w)).length;
            const union = new Set([...gapWords, ...triggerWords]).size;
            const jaccardScore = intersection / union;
            
            // Bonus: Check if gap contains ALL trigger words (subset match)
            // "ac not cooling at all" should match "ac not cooling"
            const triggerCoverage = [...triggerWords].filter(w => gapWords.has(w)).length / triggerWords.size;
            
            // Combined score: Jaccard + bonus for high trigger coverage
            const score = jaccardScore + (triggerCoverage >= 0.9 ? 0.15 : 0);
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = {
                    scenarioId: scenario.scenarioId,
                    scenarioName: scenario.name,
                    category: scenario.category,
                    matchedTrigger: trigger,
                    similarityScore: Math.min(score, 1.0), // Cap at 1.0
                    jaccardScore,
                    triggerCoverage
                };
            }
        }
    }
    
    if (bestScore >= threshold) {
        logger.info('[SCENARIO GAPS] Deterministic duplicate found', {
            gapPhrase,
            gapTokens,
            match: {
                scenarioName: bestMatch.scenarioName,
                scenarioId: bestMatch.scenarioId,
                matchedTrigger: bestMatch.matchedTrigger,
                similarityScore: bestMatch.similarityScore.toFixed(3),
                jaccardScore: bestMatch.jaccardScore.toFixed(3),
                triggerCoverage: bestMatch.triggerCoverage.toFixed(3)
            }
        });
        return bestMatch;
    }
    
    logger.debug('[SCENARIO GAPS] No deterministic duplicate found', {
        gapPhrase,
        gapTokens,
        bestScore: bestScore.toFixed(3),
        threshold
    });
    
    return null;
}

// ============================================================================
// HELPER: Resolve scenario name to ID (server-side, don't trust GPT)
// ============================================================================
// When GPT returns a duplicate by name, we resolve to ID deterministically
// This prevents broken UI actions from GPT hallucinating wrong IDs
// ============================================================================
function resolveScenarioNameToId(scenarioName, allScenarios) {
    if (!scenarioName) return null;
    
    const normalized = scenarioName.toLowerCase().trim();
    
    // Exact match first
    const exactMatch = allScenarios.find(s => 
        s.name.toLowerCase().trim() === normalized
    );
    if (exactMatch) return exactMatch;
    
    // Fuzzy match (contains)
    const fuzzyMatch = allScenarios.find(s => 
        s.name.toLowerCase().includes(normalized) ||
        normalized.includes(s.name.toLowerCase())
    );
    if (fuzzyMatch) {
        logger.debug('[SCENARIO GAPS] Fuzzy matched scenario name', {
            input: scenarioName,
            matched: fuzzyMatch.name,
            scenarioId: fuzzyMatch.scenarioId
        });
    }
    
    return fuzzyMatch || null;
}

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
    
    // Show at least $0.01 if there's any cost, otherwise show more precision
    const displayWeeklyCost = weeklyCost < 0.01 && weeklyCost > 0 
        ? Math.round(weeklyCost * 1000) / 1000  // Show 3 decimal places for tiny amounts
        : Math.round(weeklyCost * 100) / 100;
    const displayMonthlyCost = weeklyCost * 4.3 < 0.01 && weeklyCost > 0
        ? Math.round(weeklyCost * 4.3 * 1000) / 1000
        : Math.round(weeklyCost * 4.3 * 100) / 100;
    
    return {
        weeklyCallsSaved: totalCalls,
        weeklyTokensSaved: totalTokens || totalCalls * CONFIG.AVG_TOKENS_PER_TIER3_CALL,
        weeklyCostSaved: displayWeeklyCost,
        monthlyCostSaved: displayMonthlyCost
    };
}

/**
 * Normalize scenario output to align with scenarioType
 */
function normalizeScenarioForType(scenario) {
    const normalized = { ...scenario };
    
    // Ensure replyStrategy always exists
    if (!normalized.replyStrategy) {
        normalized.replyStrategy = 'AUTO';
    }
    
    // Ensure follow-up question exists when required
    if ((normalized.followUpMode === 'ASK_IF_BOOK' || normalized.followUpMode === 'ASK_FOLLOWUP_QUESTION') &&
        (!normalized.followUpQuestionText || !String(normalized.followUpQuestionText).trim())) {
        normalized.followUpQuestionText = normalized.followUpMode === 'ASK_IF_BOOK'
            ? 'Would you like to schedule an appointment?'
            : 'What can I help you with today?';
    }
    
    // Small talk should not schedule or book
    if (normalized.scenarioType === 'SMALL_TALK') {
        normalized.actionType = 'REPLY_ONLY';
        normalized.bookingIntent = false;
        normalized.followUpMode = 'NONE';
        normalized.followUpQuestionText = null;
        if (normalized.cooldownSeconds === undefined || normalized.cooldownSeconds === null) {
            normalized.cooldownSeconds = 30;
        }
        
        normalized.quickReplies = sanitizeSmallTalkReplies(normalized.quickReplies);
        normalized.fullReplies = sanitizeSmallTalkReplies(normalized.fullReplies);
    }
    
    return normalized;
}

function sanitizeSmallTalkReplies(replies = []) {
    const list = Array.isArray(replies) ? replies : [];
    const filtered = list.filter(r => !containsBookingPhrase(r));
    
    if (filtered.length > 0) {
        return filtered;
    }
    
    return [
        "Thanks, {name}. How can I help you today?"
    ];
}

function containsBookingPhrase(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    return BOOKING_PHRASES.some(phrase => lower.includes(phrase));
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
 * Generate scenario using LLM - COMPREHENSIVE VERSION
 * Fills ALL useful scenario fields for the Global Brain form
 * 
 * FLOW:
 * 1. Get company's template (HARD STOP if missing)
 * 2. Run DETERMINISTIC duplicate check first (fast, cheap)
 * 3. If no deterministic match, call LLM for generation/secondary duplicate check
 */
async function generateScenarioFromGap(gap, company) {
    const openai = openaiClient;
    if (!openai) {
        logger.warn('[SCENARIO GAPS] OpenAI client not available, using fallback generation');
        return generateFallbackScenario(gap, company);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: FETCH COMPANY'S TEMPLATE (HARD STOP IF MISSING)
    // ═══════════════════════════════════════════════════════════════════════════
    const { template, error: templateError } = await getCompanyTemplate(company);
    
    if (templateError) {
        // HARD STOP - no silent fallback
        logger.error('[SCENARIO GAPS] Cannot generate scenario - template error', templateError);
        return {
            success: false,
            error: templateError,
            message: templateError.message
        };
    }
    
    const tradeType = template.templateType?.toLowerCase() || 'general';
    const templateId = template._id?.toString();
    
    // Build full scenario list for duplicate detection + tone examples
    const { allScenarios, toneExamples } = buildScenarioListForGPT(template);
    
    logger.info(`[SCENARIO GAPS] Processing gap`, {
        companyId: company._id?.toString(),
        templateId,
        templateName: template.name,
        tradeType,
        scenarioCount: allScenarios.length,
        gapPhrase: gap.representative
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: DETERMINISTIC DUPLICATE CHECK (fast, before LLM)
    // ═══════════════════════════════════════════════════════════════════════════
    const deterministicMatch = findDeterministicDuplicate(gap.representative, allScenarios, 0.6);
    
    if (deterministicMatch) {
        logger.info('[SCENARIO GAPS] Deterministic duplicate detected - skipping LLM', deterministicMatch);
        return {
            success: true,
            isDuplicate: true,
            duplicateScenarioId: deterministicMatch.scenarioId,
            duplicateScenarioName: deterministicMatch.scenarioName,
            duplicateCategory: deterministicMatch.category,
            matchedTrigger: deterministicMatch.matchedTrigger,
            similarityScore: deterministicMatch.similarityScore,
            recommendedAction: 'ADD_TRIGGERS',
            suggestedTriggers: gap.examples.map(e => cleanCallerText(e.text)).filter(t => t.length > 5),
            explanation: `Gap phrase "${gap.representative}" is ${Math.round(deterministicMatch.similarityScore * 100)}% similar to existing trigger "${deterministicMatch.matchedTrigger}" in scenario "${deterministicMatch.scenarioName}". Recommend adding as new trigger instead of creating duplicate.`,
            detectionMethod: 'deterministic',
            tokensUsed: 0
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: BUILD LLM CONTEXT (only if no deterministic match)
    // ═══════════════════════════════════════════════════════════════════════════
    let existingScenariosList = '';
    let toneExamplesList = '';
    
    // Build the FULL scenario list (names + key triggers) for LLM duplicate detection
    if (allScenarios.length > 0) {
        existingScenariosList = `
═══════════════════════════════════════════════════════════════════════════════
📋 ALL EXISTING SCENARIOS (${allScenarios.length} total) - DO NOT DUPLICATE
═══════════════════════════════════════════════════════════════════════════════
${allScenarios.map(s => `• "${s.name}" [${s.category}] - triggers: ${s.triggers.slice(0, 3).join(', ')}${s.triggers.length > 3 ? '...' : ''}`).join('\n')}

⚠️ CRITICAL: If the gap phrase matches ANY existing scenario above, respond with:
{
  "isDuplicate": true,
  "duplicateScenarioId": "id or name of matching scenario",
  "duplicateScenarioName": "Name of matching scenario",
  "recommendedAction": "ADD_TRIGGERS",
  "explanation": "Why this is a duplicate (1-2 sentences)"
}
Instead of creating a new scenario, the trigger should be added to the existing one.
`;
    }
    
    // Build tone examples (separate from duplicate list)
    if (toneExamples.length > 0) {
        toneExamplesList = `
═══════════════════════════════════════════════════════════════════════════════
🎯 TONE EXAMPLES (match this dispatcher style)
═══════════════════════════════════════════════════════════════════════════════
${toneExamples.map(s => `• "${s.name}" - Trigger: "${s.trigger}" → Reply: "${s.reply}"`).join('\n')}
`;
    }
    
    // Clean up the examples for better LLM input
    const cleanedExamples = gap.examples
        .slice(0, 5)
        .map(e => cleanCallerText(e.text))
        .filter(t => t.length > 5);
    
    const examples = cleanedExamples.map(e => `- "${e}"`).join('\n');
    
    const tradeName = tradeType.toUpperCase() || 'SERVICE';
    
    const prompt = `You are creating scenarios for an EXPERIENCED ${tradeName} SERVICE DISPATCHER.

═══════════════════════════════════════════════════════════════════════════════
🎯 WHO YOU ARE (THIS IS CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
You are NOT a chatbot.
You are NOT customer service.
You are NOT a hotel concierge.

You ARE: An experienced ${tradeName} service dispatcher who handles problems all day, every day.

YOUR TONE:
• Calm - never flustered
• Professional - but not corporate
• Friendly - but NOT chatty
• Confident - you've heard this 10,000 times
• Efficient - every word moves toward resolution
• Action-oriented - always progressing toward booking

Callers are often uncomfortable, frustrated, or impatient.
Your job: Make them feel HEARD quickly and move toward getting the problem FIXED.

═══════════════════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════════════════
COMPANY: ${company.companyName || 'Service Company'}
TRADE: ${tradeType}
${existingScenariosList}
${toneExamplesList}
CALLER PHRASES (asked ${gap.totalCalls} times - this is the GAP to fill):
${examples}

═══════════════════════════════════════════════════════════════════════════════
THE GOLDEN FORMULA: ACKNOWLEDGE → NARROW → BOOK
═══════════════════════════════════════════════════════════════════════════════
Every response must:
1. Briefly acknowledge (3 words max: "I understand." "Alright." "Okay.")
2. Ask ONE smart narrowing question that diagnoses the issue
3. Keep momentum toward scheduling service

═══════════════════════════════════════════════════════════════════════════════
⚡ TRIGGER RULES
═══════════════════════════════════════════════════════════════════════════════
Include 10-15 trigger variations:
- SHORT (2-3 words): "ac broken", "not cooling", "need repair"  
- LONG (5-8 words): "my air conditioning is not working"
- Questions AND statements
- Casual: "y'all", "gonna", "ain't working"

🔧 REGEX TRIGGERS (2-4 patterns):
- Use \\b for word boundaries
- Example: "\\b(ac|air conditioning|a\\.?c\\.?)\\s*(not|isn't|ain't|won't)\\s*(working|cooling|running)\\b"

═══════════════════════════════════════════════════════════════════════════════
🎯 RESPONSE RULES (READ THIS CAREFULLY)
═══════════════════════════════════════════════════════════════════════════════

KEEP RESPONSES UNDER 20 WORDS (unless collecting booking details)

quickReplies (5-7 variations) - DISPATCHER STYLE:
• Acknowledge briefly + ask ONE specific diagnostic question
• Sound like you've handled this 10,000 times
• Move toward understanding the problem
• MUST have 5-7 variations so AI never sounds like a robot!
• Vary the acknowledgment: "I understand." / "Alright." / "Okay." / "Thanks, {name}."
• Vary the question phrasing while asking the same thing

fullReplies (4-5 variations) - STILL DISPATCHER STYLE:
• Slightly more context but STILL under 25 words
• Never paragraphs, never fluffy
• MUST have 4-5 variations for natural conversation
• MUST include {name} in EACH reply (runtime will strip if unknown)
• Vary the acknowledgment: "Thanks, {name}." / "Alright, {name}." / "Okay, {name}."
• Vary the booking language: "Morning or afternoon?" / "What day works?" / "When would you like us out?"

═══════════════════════════════════════════════════════════════════════════════
❌ BANNED PHRASES (instant failure if you use these)
═══════════════════════════════════════════════════════════════════════════════
CHATBOT WORDS (ban these):
• "Wonderful to hear from you"
• "Great to have you back"  
• "We're here to help"
• "Let's sort this out together"
• "I apologize for the inconvenience"

HELP DESK WORDS (ban these - dispatchers don't say them):
• "Got it" 
• "No problem"
• "Absolutely"
• "Of course"

LAZY QUESTIONS (ban these):
• "Tell me more about..."
• "Can you describe..."
• "Could you explain..."
• "Have you checked..." (troubleshooting = technician's job)
• "Is it set correctly?" (troubleshooting)
• "Any unusual noises?" (technician question)

• Anything that sounds like a chatbot, concierge, or help desk
• Anything over 20 words

═══════════════════════════════════════════════════════════════════════════════
✅ HOW A PRO DISPATCHER SOUNDS (copy this style exactly)
═══════════════════════════════════════════════════════════════════════════════

QUICK REPLIES (classification questions):
❌ Bad: "I'm so sorry you're dealing with this. Let's figure this out together!"
✅ Good: "I understand. Is the unit running but not cooling, or not turning on?"

❌ Bad: "Got it. Can you tell me more about the problem?"
✅ Good: "Is air coming out of the vents?"

❌ Bad: "No problem. Have you checked the thermostat settings?"
✅ Good: "Is the thermostat screen on or blank?"

FULL REPLIES (booking momentum - use after classification):
❌ Bad: "I understand, {name}. Is the unit making any unusual noises?"
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

❌ Bad: "Have you checked if the thermostat is set correctly?"
✅ Good: "We'll get a technician out. Morning or afternoon?"

NATURAL BRIDGE (between classify → book):
Caller: "The screen is blank."
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

RETURNING CUSTOMER:
❌ Bad: "Great to hear from you again! How wonderful to have you back!"
✅ Good: "Good to hear from you, {name}. What's going on with the system today?"

GREETING:
❌ Bad: "Hi {name}! Thanks so much for reaching out to us today!"
✅ Good: "Hi {name}. What's going on?"

═══════════════════════════════════════════════════════════════════════════════
👤 PERSONALIZATION RULES (CRITICAL - Recognition ≠ Warmth)
═══════════════════════════════════════════════════════════════════════════════
A real receptionist acknowledges NAME and LOYALTY — then pivots to purpose.
This is NOT warmth. This is RECOGNITION + RESPECT.

PLACEHOLDER RULES:
• Only use {name} as a placeholder for caller's name
• Do NOT invent names - only use {name} as placeholder
• Runtime will replace {name} with actual name or remove it gracefully

NAME ACKNOWLEDGMENT (when caller provides name):
• Acknowledge the name ONCE in the next response
• Keep acknowledgment under 10 words
• Then immediately pivot to classify or book

APPROVED NAME ACKNOWLEDGMENTS (use these exactly):
• "Thanks, {name}."
• "Appreciate it, {name}."
• "Good to hear from you, {name}."

LOYALTY ACKNOWLEDGMENT (when caller mentions returning/long-time customer):
• Acknowledge loyalty ONCE, briefly
• Return customers are GOLD - never take them for granted
• Then pivot to the reason for their call

APPROVED LOYALTY ACKNOWLEDGMENTS:
• "We appreciate you, {name}."
• "Thanks for being a long-time customer, {name}."
• "Glad to have you back, {name}."
• "Good to hear from you again, {name}."

COMBINED EXAMPLE (name + loyalty + pivot):
Caller: "My name is Mark. I'm a long-time customer and I'm having AC issues."
❌ Bad: "Alright. What's going on with your system?"
✅ Good: "Thanks, {name} — we appreciate you being a long-time customer. What's going on with the AC today?"

THE THREE MICRO-ACKNOWLEDGMENTS (in order):
1. Name acknowledgment (once, immediately after capture)
2. Loyalty acknowledgment (only if mentioned)
3. Pivot to purpose (classify or book)

TWO-VARIANT REPLIES (provide BOTH for flexibility):
For scenarios where name may or may not be available:
• WITH NAME: "Thanks, {name}. What's going on with the AC today?"
• WITHOUT NAME: "Thanks. What's going on with the AC today?"

═══════════════════════════════════════════════════════════════════════════════
🔥 PRO DISPATCHER RULES (BULLETPROOF)
═══════════════════════════════════════════════════════════════════════════════
1. Ask only ONE question per response
2. Never ask caller to "describe" or "explain" - ask SPECIFIC questions
3. Empathy is just "I understand." or "Alright." - pick ONE, never stack
4. Never repeat what caller already said
5. Never sound surprised or curious - sound EXPERIENCED
6. If problem category is identified, begin scheduling IMMEDIATELY
7. Assume caller is uncomfortable and wants FAST action
8. NEVER ask homeowner to troubleshoot - that's technician territory
9. NEVER ask questions a technician would ask on site
10. Your job: Classify problem category → Book the call

ANTI-DRIFT RULES (prevents GPT from sneaking assistant tone back):
• Never stack acknowledgements: "I understand. Alright. Let's..." ❌ Pick ONE.
• Don't start more than 2 responses with "I understand" - vary with "Alright." "Okay."
• No extra questions if you already know enough to book

THE DISPATCHER FLOW:
• Quick replies = ONE classification question
• Bridge sentence (optional): "Alright. That's helpful."
• Full replies = BOOKING ("We'll get a technician out. Morning or afternoon?")

${tradeType === 'hvac' ? `
HVAC-SPECIFIC - ONLY THESE 3 CLASSIFICATION QUESTIONS:
• "Is the system running but not cooling, or not turning on?"
• "Is the thermostat screen on or blank?"
• "Is air coming out of the vents?"

BRIDGE SENTENCE (use between classify → book):
• "Alright. That's helpful."

Then BOOK (tight, no fluff):
• "We'll get a technician out. Morning or afternoon?"
• "Let's get you on the schedule. What day works?"

EXAMPLE FLOW:
Caller: "My thermostat screen is blank"
AI: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

NEVER ASK:
• "Have you checked..." (troubleshooting)
• "Any unusual noises?" (technician question)  
• "Is it set correctly?" (troubleshooting)
• Anything a technician would ask on site
` : ''}

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only, no markdown):
═══════════════════════════════════════════════════════════════════════════════
{
    "name": "Short descriptive name (3-5 words)",
    "status": "live",
    "category": "Scheduling|Pricing|Hours|Service Area|Emergency|FAQ|Warranty|Billing|General",
    
    "scenarioType": "FAQ|BOOKING|EMERGENCY|TROUBLESHOOT|BILLING|TRANSFER|SMALL_TALK",
    "priority": 0,
    "minConfidence": 0.6,
    
    "behavior": "calm_professional|empathetic_reassuring|professional_efficient",
    
    "triggers": [
        "short trigger",
        "another short one", 
        "medium length trigger",
        "what's the trigger question",
        "longer natural phrasing here",
        "different way to ask",
        "casual way to say it",
        "formal version of question",
        "i need statement version",
        "looking for variation"
    ],
    
    "regexTriggers": [
        "\\\\b(keyword1|keyword2)\\\\s*(optional)?\\\\b",
        "\\\\b(another|pattern)\\\\b"
    ],
    
    "negativeTriggers": ["phrases that look similar but mean something DIFFERENT"],
    
    "quickReplies": [
        "Thanks, {name}. Is the unit running but not cooling, or not turning on?",
        "I understand. Is the unit running but not cooling, or not turning on?",
        "Alright. Is air coming out of the vents?",
        "Okay, {name}. Is the system blowing warm air or nothing at all?",
        "Got the picture. Is it running but not cooling, or completely off?",
        "Appreciate it, {name}. Is the thermostat showing anything?"
    ],
    
    "quickReplies_noName": [
        "Thanks. Is the unit running but not cooling, or not turning on?",
        "I understand. Is the unit running but not cooling, or not turning on?",
        "Alright. Is air coming out of the vents?",
        "Okay. Is the system blowing warm air or nothing at all?",
        "Got the picture. Is it running but not cooling, or completely off?",
        "Appreciate it. Is the thermostat showing anything?"
    ],
    
    "fullReplies": [
        "Thanks, {name}. We'll get a technician out. Morning or afternoon?",
        "Alright, {name}. We'll get a technician out. Morning or afternoon?",
        "I understand, {name}. Let's get you on the schedule. What day works best?",
        "Okay, {name}. We can have someone out today or tomorrow. Which works better?",
        "Sounds good, {name}. When would you like us to come by?"
    ],
    
    "fullReplies_noName": [
        "Thanks. We'll get a technician out. Morning or afternoon?",
        "Alright. We'll get a technician out. Morning or afternoon?",
        "I understand. Let's get you on the schedule. What day works best?",
        "Okay. We can have someone out today or tomorrow. Which works better?",
        "Sounds good. When would you like us to come by?"
    ],
    
    "bookingIntent": false,
    
    "entityCapture": ["name", "issue"],
    
    "notes": "Internal note about when this scenario fires and edge cases"
}

⚠️ DO NOT GENERATE THESE (Runtime-owned):
- followUpMode, followUpFunnel, followUpQuestionText (Runtime decides based on context)
- actionType, handoffPolicy (Runtime decides based on confidence/booking flow)
- cooldown, actionHooks, entityValidation (Infrastructure settings)
- timedFollowUp, silencePolicy, followUpMessages (Global admin settings)

ENTITY CAPTURE GUIDE (what to extract from caller speech):
- name: Always include - caller's name
- phone: If they might provide callback number
- address: If location/service area matters
- issue: The problem or request description
- time_preference: Preferred appointment time
- equipment: For service calls (AC model, furnace type)
- urgency: Emergency indicators

PERSONALIZATION GUIDE (name + loyalty recognition):
1. ALWAYS include {name} in EVERY quickReply and EVERY fullReply
2. ALWAYS provide matching _noName variants (same count, same order)
3. Name acknowledgment = recognition, NOT warmth
4. Loyalty acknowledgment = respect for returning customers
5. Three micro-acknowledgments in order: Name → Loyalty → Purpose
6. Keep all acknowledgments under 10 words
7. Approved patterns:
   - "Thanks, {name}." / "Thanks."
   - "Appreciate it, {name}." / "Appreciate it."
   - "Alright, {name}." / "Alright."
   - "Okay, {name}." / "Okay."
   - "Good to hear from you, {name}." / "Good to hear from you."
8. For returning/long-time customer scenarios:
   - "We appreciate you, {name}."
   - "Thanks for being a long-time customer, {name}."
9. CRITICAL: fullReplies count MUST equal fullReplies_noName count (both 4-5)
10. CRITICAL: quickReplies count MUST equal quickReplies_noName count (both 5-7)

TEMPLATE VARIABLES GUIDE (fallbacks for {placeholders}):
- Format: key=fallback value
- Example: name=valued customer (if we don't have their name yet)
- Example: technician=our team member (if tech name not specified)
- Example: time=shortly (if no specific time mentioned)

BEHAVIOR GUIDE (for service dispatch):
- calm_professional: DEFAULT for all service calls - calm, in control, experienced
- empathetic_reassuring: For complaints, callbacks, service recovery
- professional_efficient: Business inquiries, billing, formal requests

DO NOT USE:
- friendly_warm (makes AI chatty)
- enthusiastic_positive (sounds like sales, not dispatch)

SCENARIO TYPE GUIDE (priority scale: -10 to +10):
- EMERGENCY: Urgent (no heat, leak, flood) - priority 8-10 (Critical), bookingIntent=true
- BOOKING: Wants to schedule - priority 5-8, bookingIntent=true
- TROUBLESHOOT: Problem-solving - priority 2-5
- FAQ: Informational (pricing, hours, area) - priority 0-3
- BILLING: Payment questions - priority 0-2
- SMALL_TALK: Greetings, thanks - priority -5 to 0 (Low)
- TRANSFER: Needs human - priority 3-6

MIN CONFIDENCE GUIDE (how certain AI must be to use this scenario):
- EMERGENCY: 0.5-0.7 (lower = catch more urgent calls, never miss emergency)
- BOOKING: 0.6-0.75 (medium)
- FAQ: 0.5-0.65 (medium)
- TROUBLESHOOT: 0.6-0.7 (medium-high)
- BILLING: 0.6-0.75 (medium-high, avoid wrong account issues)
- SMALL_TALK: 0.4-0.6 (lower = greetings match easily)
- TRANSFER: 0.7-0.85 (high = be sure before transferring)

FOLLOW-UP MODE GUIDE (what agent says NEXT, not timer):
- NONE: DEFAULT - Just answer, let conversation flow naturally (use for FAQ, BILLING, SMALL_TALK)
- ASK_IF_BOOK: ONLY for booking-eligible scenarios (BOOKING, EMERGENCY, TROUBLESHOOT with repair intent)
- ASK_FOLLOWUP_QUESTION: Rarely needed - only for complex multi-step flows

CRITICAL RULE: Only set followUpMode=ASK_IF_BOOK when bookingIntent=true.
Otherwise you get pushy behavior like asking to schedule after a billing question.

⚠️ DO NOT GENERATE: followUpMessages, timedFollowUp, silencePolicy
These are ADMIN-ONLY settings for silence recovery timers (global policy, not per-scenario).

ADVANCED SETTINGS (AI can generate):

cooldown: Seconds before scenario can fire again (spam prevention)
- Most scenarios: 0 (no cooldown)
- Greeting/small talk: 30-60 seconds
- Emergency: 0 (always allow)

handoffPolicy: When to transfer to human
- "low_confidence": Only when AI is unsure (DEFAULT for most)
- "always": Always offer human option (billing, complaints)
- "never": AI handles fully (simple FAQ, greetings)

actionHooks: System actions to trigger (comma-separated)
- offer_scheduling: Proactively offer to book
- escalate_to_human: Flag for manager review
- log_complaint: Record as complaint
- send_confirmation: Send SMS confirmation
- check_availability: Query calendar

entityValidation: JSON validation rules for captured entities
- phone: {"pattern": "^[0-9]{10}$", "prompt": "Could you give me a 10-digit number?"}
- email: {"pattern": "@", "prompt": "What's your email address?"}
- Only include if scenario captures these entities`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',  // 🚀 Using GPT-4o for highest quality scenario generation
            messages: [
                { 
                    role: 'system', 
                    content: `You are creating scenarios for an EXPERIENCED SERVICE DISPATCHER, not a chatbot.

YOUR MINDSET - THIS IS CRITICAL:
You are NOT creating chatbot responses.
You are creating how a SEASONED DISPATCHER who handles 50+ calls/day would respond.

DISPATCHER PERSONALITY:
• Calm, confident, experienced - heard this 10,000 times
• Friendly but NOT chatty - no fluff, no filler
• Every sentence moves toward DIAGNOSIS or BOOKING
• Empathy in 3 words max: "I understand." "Alright." "Okay."
• Never sounds surprised, never sounds curious - sounds EXPERIENCED

RESPONSE RULES:
• quickReplies: Under 15 words each. Acknowledge + ONE diagnostic question.
• fullReplies: Under 25 words each. Still brief, just slightly more context.
• Ask SPECIFIC questions, never "tell me more" or "can you describe"
• ONE question per response - dispatchers guide, not shotgun
• Sound like someone who turns calls into booked jobs

BANNED (instant failure):
• "Wonderful to hear from you" / "Great to have you back"
• "We're here to help" / "Let's sort this out together"  
• "Can you describe..." / "Tell me more..."
• Anything over 20 words (unless booking details)
• Anything that sounds like a chatbot or concierge

Output VALID JSON only. No markdown. No explanations.` 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,  // Lower for more consistent, professional responses
            max_tokens: 2000
        });
        
        const content = response.choices[0]?.message?.content || '';
        
        // Parse JSON (handle potential markdown wrapping)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }
        
        const s = JSON.parse(jsonStr);
        
        // Check if GPT-4o detected this as a duplicate
        if (s.isDuplicate === true) {
            // SERVER-SIDE RESOLUTION: Don't trust GPT's scenarioId - resolve by name
            const gptScenarioName = s.duplicateScenarioName || s.existingScenario;
            const resolvedScenario = resolveScenarioNameToId(gptScenarioName, allScenarios);
            
            // Use server-resolved ID if found, otherwise use what GPT provided
            const resolvedId = resolvedScenario?.scenarioId || s.duplicateScenarioId || null;
            const resolvedName = resolvedScenario?.name || gptScenarioName;
            const resolvedCategory = resolvedScenario?.category || s.duplicateCategory || null;
            
            logger.info('[SCENARIO GAPS] GPT-4o detected duplicate scenario', {
                gptProvidedName: gptScenarioName,
                gptProvidedId: s.duplicateScenarioId,
                serverResolvedId: resolvedId,
                serverResolvedName: resolvedName,
                resolutionMethod: resolvedScenario ? 'server_matched' : 'gpt_only',
                recommendedAction: s.recommendedAction || s.suggestedAction
            });
            
            return {
                success: true,
                isDuplicate: true,
                duplicateScenarioId: resolvedId,
                duplicateScenarioName: resolvedName,
                duplicateCategory: resolvedCategory,
                recommendedAction: s.recommendedAction || s.suggestedAction || 'ADD_TRIGGERS',
                suggestedTriggers: gap.examples.map(e => cleanCallerText(e.text)).filter(t => t.length > 5),
                explanation: s.explanation || `LLM detected this gap matches existing scenario "${resolvedName}"`,
                detectionMethod: 'llm',
                resolutionMethod: resolvedScenario ? 'server_matched' : 'gpt_only',
                tokensUsed: response.usage?.total_tokens || 0
            };
        }
        
        // Build comprehensive scenario object
        return {
            success: true,
            isDuplicate: false,
            scenario: normalizeScenarioForType({
                // Identity
                name: s.name || gap.representative.substring(0, 50),
                category: s.category || 'FAQ',
                
                // Classification
                scenarioType: s.scenarioType || 'FAQ',
                priority: typeof s.priority === 'number' ? s.priority : 50,
                minConfidence: typeof s.minConfidence === 'number' ? s.minConfidence : 0.6,
                behavior: s.behavior || 'calm_professional',
                replyStrategy: s.replyStrategy || 'AUTO',
                status: 'draft',
                
                // Triggers (required)
                triggers: Array.isArray(s.triggers) ? s.triggers : [gap.representative],
                negativeTriggers: Array.isArray(s.negativeTriggers) ? s.negativeTriggers : [],
                
                // Replies WITH {name} placeholder (primary)
                quickReplies: Array.isArray(s.quickReplies) ? s.quickReplies : 
                    (s.quickReply ? [s.quickReply] : ['I can help with that.']),
                fullReplies: Array.isArray(s.fullReplies) ? s.fullReplies : 
                    (s.fullReply ? [s.fullReply] : []),
                
                // Replies WITHOUT {name} placeholder (fallback when name not available)
                quickReplies_noName: Array.isArray(s.quickReplies_noName) ? s.quickReplies_noName : null,
                fullReplies_noName: Array.isArray(s.fullReplies_noName) ? s.fullReplies_noName : null,
                
                // Follow-up behavior
                followUpMode: s.followUpMode || 'NONE',
                followUpQuestionText: s.followUpQuestionText || null,
                
                // Wiring/Actions
                actionType: s.actionType || 'REPLY_ONLY',
                bookingIntent: s.bookingIntent === true,
                
                // Entity extraction
                entityCapture: Array.isArray(s.entityCapture) ? 
                    s.entityCapture.filter(e => e && e !== 'none') : [],
                
                // Admin notes
                notes: s.notes || `Auto-generated from Scenario Gaps. Detected ${gap.totalCalls} similar calls.`,
                
                // Placeholders for company values
                suggestedPlaceholders: Array.isArray(s.suggestedPlaceholders) ? s.suggestedPlaceholders : [],
                
                // Advanced settings (if provided by GPT)
                cooldownSeconds: typeof s.cooldownSeconds === 'number' ? s.cooldownSeconds : 0,
                followUpMessages: Array.isArray(s.followUpMessages) ? s.followUpMessages : null,
                actionHooks: Array.isArray(s.actionHooks) ? s.actionHooks : 
                    (typeof s.actionHooks === 'string' ? s.actionHooks.split(',').map(h => h.trim()) : []),
                handoffPolicy: s.handoffPolicy || 'low_confidence',
                
                // Regex triggers (if provided)
                regexTriggers: Array.isArray(s.regexTriggers) ? s.regexTriggers : [],
                
                // Template variables (if provided) - convert array to object
                dynamicVariables: Array.isArray(s.templateVariables) 
                    ? s.templateVariables.reduce((acc, v) => {
                        if (typeof v === 'string' && v.includes('=')) {
                            const [key, ...rest] = v.split('=');
                            acc[key.trim()] = rest.join('=').trim();
                        }
                        return acc;
                    }, {})
                    : (s.dynamicVariables || null),
                
                // Metadata
                generatedBy: 'ai',
                confidence: 0.85,
                sourceGap: gap.representative
            }),
            tokensUsed: response.usage?.total_tokens || 0
        };
    } catch (error) {
        logger.error('[SCENARIO GAPS] LLM generation failed', { error: error.message });
        return generateFallbackScenario(gap, company);
    }
}

/**
 * Fallback scenario generation (no LLM) - Comprehensive format
 */
function generateFallbackScenario(gap, company) {
    const normalized = normalizeText(gap.representative);
    
    // Extract potential category and type from keywords
    let category = 'FAQ';
    let scenarioType = 'FAQ';
    let priority = 50;
    let followUpMode = 'NONE';
    
    if (/price|cost|how much|rate|fee|charge/.test(normalized)) {
        category = 'Pricing';
        scenarioType = 'FAQ';
        priority = 50;
    } else if (/hour|open|close|when are you/.test(normalized)) {
        category = 'Hours';
        scenarioType = 'FAQ';
        priority = 45;
    } else if (/service|area|location|zip|where|serve/.test(normalized)) {
        category = 'Service Area';
        scenarioType = 'FAQ';
        priority = 45;
    } else if (/warranty|guarantee/.test(normalized)) {
        category = 'Warranty';
        scenarioType = 'FAQ';
        priority = 50;
    } else if (/emergency|urgent|asap|help|no heat|no ac|leak|flood/.test(normalized)) {
        category = 'Emergency';
        scenarioType = 'EMERGENCY';
        priority = 95;
    } else if (/book|schedule|appoint|earliest|soonest|available/.test(normalized)) {
        category = 'Scheduling';
        scenarioType = 'BOOKING';
        priority = 75;
        followUpMode = 'ASK_IF_BOOK';
    }
    
    // Generate triggers from examples
    const triggers = gap.examples
        .slice(0, 5)
        .map(e => normalizeText(e.text))
        .filter(t => t.length > 5);
    
    // Determine minConfidence based on scenarioType
    const minConfidenceMap = {
        'EMERGENCY': 0.55,
        'BOOKING': 0.65,
        'FAQ': 0.6,
        'TROUBLESHOOT': 0.65,
        'BILLING': 0.7,
        'SMALL_TALK': 0.5,
        'TRANSFER': 0.75
    };
    
    return {
        success: true,
        scenario: normalizeScenarioForType({
            name: gap.representative.substring(0, 50),
            category,
            scenarioType,
            priority,
            minConfidence: minConfidenceMap[scenarioType] || 0.6,
            behavior: scenarioType === 'EMERGENCY' ? 'empathetic_reassuring' : 'calm_professional',
            replyStrategy: 'AUTO',
            status: 'draft',
            triggers: triggers.length > 0 ? triggers : [normalized],
            negativeTriggers: [],
            regexTriggers: [],
            quickReplies: ['I can help you with that. Let me get more information to assist you.'],
            fullReplies: [],
            quickReplies_noName: null,
            fullReplies_noName: null,
            followUpMode,
            followUpQuestionText: followUpMode === 'ASK_IF_BOOK' ? 'Would you like to schedule an appointment?' : null,
            actionType: scenarioType === 'BOOKING' ? 'REQUIRE_BOOKING' : 'REPLY_ONLY',
            bookingIntent: scenarioType === 'BOOKING',
            entityCapture: [],
            cooldownSeconds: scenarioType === 'SMALL_TALK' ? 30 : 0,
            handoffPolicy: scenarioType === 'BILLING' ? 'always' : 'low_confidence',
            actionHooks: [],
            notes: `Auto-generated fallback. Detected ${gap.totalCalls} similar calls.`,
            suggestedPlaceholders: [],
            generatedBy: 'fallback',
            confidence: 0.5,
            sourceGap: gap.representative
        }),
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
        // Look for TIER3_LLM_FALLBACK_CALLED events (actual LLM calls that cost money)
        const recordings = await BlackBoxRecording.find({
            companyId: new mongoose.Types.ObjectId(companyId),
            createdAt: { $gte: startDate },
            'events.type': { $in: ['TIER3_LLM_FALLBACK_CALLED', 'TIER3_FALLBACK'] }  // Support both old and new event names
        }).lean();
        
        logger.info('[SCENARIO GAPS] Analyzing recordings', { 
            companyId, 
            recordingsFound: recordings.length,
            daysBack,
            startDate: startDate.toISOString()
        });
        
        // Extract Tier 3 caller phrases
        const tier3Phrases = [];
        
        for (const recording of recordings) {
            const events = recording.events || [];
            
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                
                // Match both event type names
                if (event.type === 'TIER3_LLM_FALLBACK_CALLED' || event.type === 'TIER3_FALLBACK') {
                    // Find the preceding GATHER_FINAL to get what caller said
                    let callerText = '';
                    
                    // Calculate tokens from cost (approx $0.00015 per 1K input + $0.0006 per 1K output)
                    // Average ~$0.00075 per 1K tokens total
                    const costUsd = event.data?.costUsd || 0;
                    let tokens = costUsd > 0 ? Math.round((costUsd / 0.00075) * 1000) : CONFIG.AVG_TOKENS_PER_TIER3_CALL;
                    
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
        
        // Handle template error (HARD STOP)
        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
                message: result.message
            });
        }
        
        // Handle duplicate detection
        if (result.isDuplicate) {
            return res.json({
                success: true,
                isDuplicate: true,
                duplicateScenarioId: result.duplicateScenarioId,
                duplicateScenarioName: result.duplicateScenarioName,
                duplicateCategory: result.duplicateCategory,
                recommendedAction: result.recommendedAction,
                suggestedTriggers: result.suggestedTriggers,
                explanation: result.explanation,
                detectionMethod: result.detectionMethod,
                similarityScore: result.similarityScore,
                tokensUsed: result.tokensUsed
            });
        }
        
        res.json({
            success: true,
            isDuplicate: false,
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
        
        // Get the company's assigned template (HARD STOP if missing)
        const { template, error: templateError } = await getCompanyTemplate(company, { lean: false });
        
        if (templateError) {
            return res.status(400).json({ 
                success: false,
                error: templateError.code,
                message: templateError.message,
                fix: templateError.fix
            });
        }
        
        logger.info(`[SCENARIO GAPS] Creating scenario in template: ${template.name} (${template._id})`);
        
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
 * GET /:companyId/scenarios
 * 
 * Get existing scenarios from the company's template for "Add to Existing" feature
 */
router.get('/:companyId/scenarios', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the company's assigned template (HARD STOP if missing)
        const { template, error: templateError } = await getCompanyTemplate(company);
        
        if (templateError) {
            return res.status(400).json({ 
                success: false, 
                scenarios: [], 
                categories: [],
                error: templateError.code,
                message: templateError.message,
                fix: templateError.fix
            });
        }
        
        // Extract scenarios with their categories
        const scenarios = [];
        const categoryNames = [];
        
        for (const category of (template.categories || [])) {
            categoryNames.push(category.name);
            
            for (const scenario of (category.scenarios || [])) {
                scenarios.push({
                    id: scenario._id?.toString() || scenario.scenarioId || `${category.name}_${scenario.name}`,
                    name: scenario.name,
                    category: category.name,
                    triggersCount: scenario.triggers?.length || 0,
                    triggers: (scenario.triggers || []).slice(0, 5), // Preview first 5
                    quickReply: scenario.quickReplies?.[0] || scenario.quickReply || ''
                });
            }
        }
        
        // Sort by name
        scenarios.sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({
            success: true,
            templateId: template._id.toString(),
            templateName: template.name,
            templateType: template.templateType,
            scenarioCount: scenarios.length,
            categoryCount: categoryNames.length,
            categories: categoryNames,
            scenarios
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching scenarios', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to fetch scenarios', details: error.message });
    }
});

/**
 * POST /:companyId/scenarios/add-triggers
 * 
 * Add triggers to an existing scenario (instead of creating new)
 */
router.post('/:companyId/scenarios/add-triggers', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, categoryName, scenarioName, newTriggers } = req.body;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the company's assigned template (need non-lean for save) - HARD STOP if missing
        const { template, error: templateError } = await getCompanyTemplate(company, { lean: false });
        
        if (templateError) {
            return res.status(400).json({ 
                success: false,
                error: templateError.code,
                message: templateError.message,
                fix: templateError.fix
            });
        }
        
        // Find the category and scenario
        let found = false;
        let addedCount = 0;
        let existingTriggers = [];
        
        for (const category of (template.categories || [])) {
            if (category.name !== categoryName) continue;
            
            for (const scenario of (category.scenarios || [])) {
                const matchById = scenarioId && scenario._id?.toString() === scenarioId;
                const matchByName = scenario.name === scenarioName;
                
                if (matchById || matchByName) {
                    existingTriggers = scenario.triggers || [];
                    
                    // Add new triggers that don't already exist
                    const existingSet = new Set(existingTriggers.map(t => t.toLowerCase()));
                    
                    for (const trigger of (newTriggers || [])) {
                        const normalized = trigger.toLowerCase().trim();
                        if (normalized && !existingSet.has(normalized)) {
                            scenario.triggers.push(trigger.trim());
                            existingSet.add(normalized);
                            addedCount++;
                        }
                    }
                    
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        
        if (!found) {
            return res.status(404).json({ error: 'Scenario not found in template' });
        }
        
        // Save template
        template.markModified('categories');
        await template.save();
        
        logger.info('[SCENARIO GAPS] Triggers added to existing scenario', {
            companyId,
            scenarioName,
            categoryName,
            addedCount,
            totalTriggers: existingTriggers.length + addedCount
        });
        
        res.json({
            success: true,
            message: `Added ${addedCount} new trigger${addedCount !== 1 ? 's' : ''} to "${scenarioName}"`,
            addedCount,
            totalTriggers: existingTriggers.length + addedCount
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error adding triggers', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to add triggers', details: error.message });
    }
});

/**
 * POST /:companyId/calls/preview
 * 
 * Get basic info for a list of call IDs (for "View Calls" modal)
 * MULTI-TENANT SAFE: Always filters by companyId
 * 
 * Uses BlackBoxRecording (the actual call recording model)
 */
router.post('/:companyId/calls/preview', async (req, res) => {
    const { companyId } = req.params;
    const { callIds } = req.body;
    
    try {
        if (!callIds || !Array.isArray(callIds) || callIds.length === 0) {
            return res.json({ success: true, calls: [] });
        }
        
        // MULTI-TENANT SAFETY: Query MUST include BOTH conditions
        // Even if someone passes callIds from another company, they get NOTHING
        const calls = await BlackBoxRecording.find({
            _id: { $in: callIds.slice(0, 20) }, // Limit to 20
            companyId: new mongoose.Types.ObjectId(companyId) // ← HARD FILTER - prevents bleeding
        })
        .select('_id companyId createdAt startedAt from durationMs callOutcome transcript callId')
        .sort({ createdAt: -1 })
        .lean();
        
        // Format for frontend
        const formatted = calls.map(call => {
            // Get first caller turn from transcript
            let firstLine = '';
            if (call.transcript?.callerTurns && call.transcript.callerTurns.length > 0) {
                const firstTurn = call.transcript.callerTurns[0];
                if (firstTurn?.text) {
                    firstLine = firstTurn.text.substring(0, 80);
                    if (firstTurn.text.length > 80) firstLine += '...';
                }
            }
            
            // Convert durationMs to seconds
            const durationSeconds = call.durationMs ? Math.round(call.durationMs / 1000) : 0;
            
            return {
                id: call._id.toString(),
                date: call.startedAt || call.createdAt,
                phone: call.from || 'Unknown',
                duration: durationSeconds,
                durationFormatted: formatDuration(durationSeconds),
                outcome: call.callOutcome || 'unknown',
                firstLine: firstLine || 'No transcript available',
                callId: call.callId
            };
        });
        
        logger.debug('[SCENARIO GAPS] Call preview fetched', {
            companyId,
            requestedIds: callIds.length,
            returnedCalls: formatted.length
        });
        
        res.json({
            success: true,
            calls: formatted
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching call preview', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to fetch calls', details: error.message });
    }
});

// Helper to format duration
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

// ============================================================================
// TEMPLATE AUDIT ROUTES - Scenario Quality Assurance
// ============================================================================

/**
 * GET /:companyId/audit/rules
 * 
 * Get list of available audit rules (for UI checkboxes)
 */
router.get('/:companyId/audit/rules', async (req, res) => {
    try {
        const rules = getAvailableRules();
        res.json({
            success: true,
            rules,
            totalRules: rules.length,
            deterministicRules: rules.filter(r => r.costType === 'deterministic').length,
            llmRules: rules.filter(r => r.costType === 'llm').length
        });
    } catch (error) {
        logger.error('[AUDIT] Error getting rules', { error: error.message });
        res.status(500).json({ error: 'Failed to get audit rules', details: error.message });
    }
});

/**
 * GET /:companyId/audit/settings-registry
 * 
 * Get the MASTER SETTINGS REGISTRY - SINGLE SOURCE OF TRUTH
 * 
 * V2 Architecture:
 * - ONE runtime contract (runtime + runtime_manual settings)
 * - Audit checks EVERYTHING in runtime contract automatically
 * - Gap Fill generates aiGenerable=true settings
 * - NO DRIFT POSSIBLE - all policies derived from purpose + aiGenerable
 */
router.get('/:companyId/audit/settings-registry', async (req, res) => {
    try {
        const { 
            SCENARIO_SETTINGS_REGISTRY,
            getSettingsCount,
            getSettingsByCategory 
        } = require('../../services/scenarioAudit/constants');
        
        const counts = getSettingsCount();
        const byCategory = getSettingsByCategory();
        
        // 🎯 THE RUNTIME CONTRACT - Single source of truth
        const runtimeContract = counts.runtimeContract;
        
        res.json({
            success: true,
            
            // ========================================
            // 🎯 RUNTIME CONTRACT (the main display)
            // ========================================
            runtimeContract: {
                total: runtimeContract.total,
                aiGenerates: runtimeContract.aiGenerates,
                adminConfigures: runtimeContract.adminConfigures,
                breakdown: {
                    auto: counts.byPurpose.runtime,      // AI can generate these
                    manual: counts.byPurpose.runtimeManual  // Admin must configure these
                }
            },
            
            // ========================================
            // DERIVED COUNTS (for backward compatibility)
            // ========================================
            summary: {
                totalSettings: counts.total,
                runtimeContractSettings: runtimeContract.total,
                auditedSettings: counts.audited,      // = runtimeContract.total (audit checks ALL)
                gapGeneratedSettings: counts.gapGenerated,  // = aiGenerates count
                agentUsedSettings: counts.agentUsed,
                coverage: {
                    // With single source of truth, coverage is deterministic
                    auditCoverage: '100%',  // Audit checks ALL runtime contract settings
                    gapCoverage: `${Math.round(runtimeContract.aiGenerates / runtimeContract.total * 100)}%`,
                    agentCoverage: `${Math.round(counts.agentUsed / counts.total * 100)}%`
                }
            },
            
            // ========================================
            // PURPOSE BREAKDOWN
            // ========================================
            byPurpose: {
                runtime: counts.byPurpose.runtime,
                runtimeManual: counts.byPurpose.runtimeManual,
                generation: counts.byPurpose.generation,
                system: counts.byPurpose.system,
                future: counts.byPurpose.future
            },
            
            // ========================================
            // AI vs ADMIN breakdown (the key insight)
            // ========================================
            aiGenerates: counts.aiGenerates,
            adminConfigures: counts.adminConfigures,
            
            // ========================================
            // ALIGNMENT STATUS (always 100% with single source)
            // ========================================
            alignment: {
                runtimeTotal: runtimeContract.total,
                runtimeAligned: runtimeContract.total,  // All aligned by definition!
                alignmentPct: 100,  // No drift possible
                status: 'PERFECT',  // Single source of truth = perfect alignment
                gaps: [],
                gapsCount: 0
            },
            
            // Legacy fields (for backward compatibility)
            warnings: {
                notUsedByAgent: [],
                notUsedByAgentCount: 0,
                unaudited: [],
                unauditedCount: 0
            },
            
            settingsByCategory: byCategory,
            allSettings: SCENARIO_SETTINGS_REGISTRY
        });
    } catch (error) {
        logger.error('[AUDIT] Error getting settings registry', { error: error.message });
        res.status(500).json({ error: 'Failed to get settings registry', details: error.message });
    }
});

/**
 * POST /:companyId/audit/run
 * 
 * Run full audit on company's template
 * 
 * Body:
 * - rules: string[] (optional) - specific rule IDs to run
 * - category: string (optional) - audit only this category
 */
router.post('/:companyId/audit/run', async (req, res) => {
    const { companyId } = req.params;
    const { rules: ruleIds, category } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get company's template
        const { template, error } = await getCompanyTemplate(company, { 
            populateCategories: true 
        });
        
        if (error) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                fix: error.fix
            });
        }
        
        // Run audit
        const engine = new AuditEngine({ logger });
        let report;
        
        if (category) {
            // Audit specific category
            report = await engine.auditCategory(template, category, {
                rules: ruleIds
            });
        } else {
            // Audit entire template
            report = await engine.auditTemplate(template, {
                rules: ruleIds
            });
        }
        
        logger.info('[AUDIT] Completed audit', {
            companyId,
            templateId: template._id,
            templateType: template.templateType,
            totalScenarios: report.summary?.totalScenarios || report.scenarios?.length,
            violations: report.summary?.totalViolations,
            healthScore: report.summary?.healthScore,
            duration: report.duration
        });
        
        res.json({
            success: true,
            companyId,
            templateId: template._id,
            templateType: template.templateType,
            ...report
        });
        
    } catch (error) {
        logger.error('[AUDIT] Error running audit', { 
            companyId, 
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            error: 'Failed to run audit', 
            details: error.message 
        });
    }
});

/**
 * POST /:companyId/audit/scenario
 * 
 * Audit a single scenario (for inline validation)
 * 
 * Body:
 * - scenario: object - the scenario to audit
 * - rules: string[] (optional) - specific rule IDs to run
 */
router.post('/:companyId/audit/scenario', async (req, res) => {
    const { companyId } = req.params;
    const { scenario, rules: ruleIds } = req.body;
    
    if (!scenario) {
        return res.status(400).json({ error: 'Scenario object is required' });
    }
    
    try {
        const engine = new AuditEngine({ logger });
        const result = await engine.auditScenario(scenario, {
            rules: ruleIds
        });
        
        res.json({
            success: true,
            ...result
        });
        
    } catch (error) {
        logger.error('[AUDIT] Error auditing scenario', { 
            companyId, 
            scenarioName: scenario?.name,
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to audit scenario', 
            details: error.message 
        });
    }
});

/**
 * GET /:companyId/audit/health
 * 
 * Quick health check - returns health score only
 */
router.get('/:companyId/audit/health', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const { template, error } = await getCompanyTemplate(company, {
            populateCategories: true
        });
        
        if (error) {
            return res.status(400).json({
                error: error.message,
                code: error.code,
                fix: error.fix
            });
        }
        
        const engine = new AuditEngine({ logger });
        const report = await engine.auditTemplate(template);
        
        res.json({
            success: true,
            companyId,
            templateId: template._id,
            templateType: template.templateType,
            healthScore: report.summary.healthScore,
            totalScenarios: report.summary.totalScenarios,
            scenariosWithErrors: report.summary.scenariosWithErrors,
            scenariosWithWarnings: report.summary.scenariosWithWarnings,
            scenariosPassing: report.summary.scenariosPassing,
            topViolations: report.summary.topViolations
        });
        
    } catch (error) {
        logger.error('[AUDIT] Error checking health', { 
            companyId, 
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to check health', 
            details: error.message 
        });
    }
});

/**
 * POST /:companyId/audit/fix
 * 
 * Generate AI fix for a specific violation
 */
router.post('/:companyId/audit/fix', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, scenarioName, field, currentValue, ruleId, message, suggestion } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template to find the full scenario
        const { template, error } = await getCompanyTemplate(company, {
            populateCategories: true
        });
        
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Find the scenario
        let scenario = null;
        for (const category of (template.categories || [])) {
            const found = (category.scenarios || []).find(s => 
                s.scenarioId === scenarioId || s._id?.toString() === scenarioId
            );
            if (found) {
                scenario = found;
                break;
            }
        }
        
        if (!scenario) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        // Get the current field value
        const fieldPath = field.replace(/\[(\d+)\]/g, '.$1').split('.');
        let currentFieldValue = scenario;
        for (const key of fieldPath) {
            currentFieldValue = currentFieldValue?.[key];
        }
        
        // Build FULL scenario context for GPT-4
        const scenarioContext = {
            name: scenario.name,
            scenarioType: scenario.scenarioType || 'UNKNOWN',
            category: scenario.categories?.[0] || scenario.category || 'General',
            behavior: scenario.behavior || 'calm_professional',
            triggers: (scenario.triggers || []).slice(0, 10), // First 10 triggers
            quickReplies: scenario.quickReplies || [],
            fullReplies: scenario.fullReplies || [],
            quickReplies_noName: scenario.quickReplies_noName || [],
            fullReplies_noName: scenario.fullReplies_noName || [],
            followUpMode: scenario.followUpMode,
            actionType: scenario.actionType,
            bookingIntent: scenario.bookingIntent,
            priority: scenario.priority
        };
        
        // Generate fix using GPT-4 with FULL context
        const fixPrompt = `You are fixing a dispatcher AI scenario that has a violation.

═══════════════════════════════════════════════════════════════════════════════
FULL SCENARIO CONTEXT (so you understand what this scenario does)
═══════════════════════════════════════════════════════════════════════════════
Name: ${scenarioContext.name}
Type: ${scenarioContext.scenarioType}
Category: ${scenarioContext.category}
Behavior: ${scenarioContext.behavior}
Action: ${scenarioContext.actionType || 'REPLY_ONLY'}
Booking Intent: ${scenarioContext.bookingIntent || false}
Priority: ${scenarioContext.priority || 0}

TRIGGERS (what callers say to activate this):
${scenarioContext.triggers.map(t => `  - "${t}"`).join('\n')}

CURRENT QUICK REPLIES:
${scenarioContext.quickReplies.map((r, i) => `  [${i}] "${typeof r === 'string' ? r : r?.text || r}"`).join('\n')}

CURRENT FULL REPLIES:
${scenarioContext.fullReplies.map((r, i) => `  [${i}] "${typeof r === 'string' ? r : r?.text || r}"`).join('\n')}

═══════════════════════════════════════════════════════════════════════════════
THE VIOLATION TO FIX
═══════════════════════════════════════════════════════════════════════════════
FIELD: ${field}
CURRENT VALUE: "${currentFieldValue || currentValue}"
VIOLATION: ${message}
SUGGESTED ACTION: ${suggestion || 'Fix this issue'}

═══════════════════════════════════════════════════════════════════════════════
DISPATCHER RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
WHO YOU ARE:
- You are an EXPERIENCED dispatcher, not a chatbot
- Calm, professional, confident - you've handled this 10,000 times
- Every word moves toward resolution (classify → book)

RESPONSE STRUCTURE:
- Quick replies: Acknowledge briefly + ONE classification question (under 20 words)
- Full replies: Move toward booking (under 25 words)
- Use {name} placeholder to personalize when appropriate

BANNED PHRASES (never use):
- "Got it", "No problem", "Absolutely", "Of course" (help desk)
- "Let me help you with that", "I'd be happy to help", "happy to help" (chatbot)
- "Have you checked...", "Have you tried...", "Is it set correctly?" (troubleshooting)
- "Wonderful", "Great", "Awesome" (over-enthusiastic)

APPROVED ACKNOWLEDGMENTS:
- "I understand."
- "Alright."
- "Okay."
- "Thanks, {name}."

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════
Fix the violation in field "${field}".
Make sure the fix:
1. Removes the banned phrase/pattern
2. Matches the dispatcher tone
3. Is appropriate for this scenario's purpose (based on triggers)
4. Is consistent with the other replies in this scenario

RETURN ONLY the fixed text, nothing else. No quotes, no explanation.
Just the corrected value that should replace the current one.`;
        
        logger.info('[AUDIT FIX] Generating fix with full context', {
            companyId,
            scenarioId,
            scenarioName: scenario.name,
            field,
            triggersCount: scenarioContext.triggers.length,
            quickRepliesCount: scenarioContext.quickReplies.length
        });

        const response = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a dispatcher scenario editor. Return ONLY the fixed text, no explanation.' },
                { role: 'user', content: fixPrompt }
            ],
            max_tokens: 200,
            temperature: 0.3
        });
        
        const suggestedFix = response.choices[0]?.message?.content?.trim();
        
        if (!suggestedFix) {
            return res.status(500).json({ error: 'Failed to generate fix' });
        }
        
        logger.info('[AUDIT FIX] Generated fix', {
            companyId,
            scenarioId,
            field,
            ruleId,
            currentValue: currentFieldValue,
            suggestedFix
        });
        
        res.json({
            success: true,
            scenarioId,
            field,
            currentValue: currentFieldValue || currentValue,
            suggestedFix,
            ruleId,
            tokensUsed: response.usage?.total_tokens || 0
        });
        
    } catch (error) {
        logger.error('[AUDIT FIX] Error generating fix', { 
            companyId, 
            scenarioId,
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to generate fix', 
            details: error.message 
        });
    }
});

/**
 * POST /:companyId/audit/apply-fix
 * 
 * Apply a fix to a scenario field
 */
router.post('/:companyId/audit/apply-fix', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, field, newValue } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template
        const { template, error } = await getCompanyTemplate(company, {
            populateCategories: true
        });
        
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Find and update the scenario
        let updated = false;
        let categoryIndex = -1;
        let scenarioIndex = -1;
        
        for (let ci = 0; ci < (template.categories || []).length; ci++) {
            const category = template.categories[ci];
            for (let si = 0; si < (category.scenarios || []).length; si++) {
                const scenario = category.scenarios[si];
                if (scenario.scenarioId === scenarioId || scenario._id?.toString() === scenarioId) {
                    categoryIndex = ci;
                    scenarioIndex = si;
                    
                    // Parse field path (e.g., "quickReplies[0]" -> ["quickReplies", "0"])
                    const fieldPath = field.replace(/\[(\d+)\]/g, '.$1').split('.');
                    
                    // Navigate to parent and set value
                    let target = scenario;
                    for (let i = 0; i < fieldPath.length - 1; i++) {
                        target = target[fieldPath[i]];
                    }
                    const lastKey = fieldPath[fieldPath.length - 1];
                    
                    const oldValue = target[lastKey];
                    target[lastKey] = newValue;
                    
                    // Mark as modified
                    scenario.lastEditedAt = new Date();
                    scenario.lastEditedBy = 'AI Audit Fix';
                    scenario.lastEditedFromContext = 'AUDIT_FIX';
                    
                    updated = true;
                    
                    logger.info('[AUDIT FIX] Applied fix', {
                        companyId,
                        templateId: template._id,
                        scenarioId,
                        field,
                        oldValue,
                        newValue
                    });
                    
                    break;
                }
            }
            if (updated) break;
        }
        
        if (!updated) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        // Save the template
        template.markModified(`categories.${categoryIndex}.scenarios.${scenarioIndex}`);
        await template.save();
        
        res.json({
            success: true,
            scenarioId,
            field,
            newValue,
            message: 'Fix applied successfully'
        });
        
    } catch (error) {
        logger.error('[AUDIT FIX] Error applying fix', { 
            companyId, 
            scenarioId,
            field,
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to apply fix', 
            details: error.message 
        });
    }
});

/**
 * POST /:companyId/audit/fix-scenario
 * 
 * Fix ALL violations in a single scenario at once
 * Uses GPT-4o to generate fixes for each violation, then applies them all
 */
router.post('/:companyId/audit/fix-scenario', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, violations } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template
        const { template, error } = await getCompanyTemplate(company, {
            populateCategories: true
        });
        
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        
        // Find the scenario - handle both scenarioId and _id formats
        let targetScenario = null;
        let categoryIndex = -1;
        let scenarioIndex = -1;
        const searchId = scenarioId?.toString();
        
        logger.info('[AUDIT FIX-SCENARIO] Searching for scenario', { searchId });
        
        for (let ci = 0; ci < (template.categories || []).length; ci++) {
            const category = template.categories[ci];
            for (let si = 0; si < (category.scenarios || []).length; si++) {
                const scenario = category.scenarios[si];
                const sId = scenario.scenarioId?.toString();
                const sObjId = scenario._id?.toString();
                
                if (sId === searchId || sObjId === searchId) {
                    targetScenario = scenario;
                    categoryIndex = ci;
                    scenarioIndex = si;
                    logger.info('[AUDIT FIX-SCENARIO] Found scenario', { 
                        name: scenario.name,
                        categoryIndex: ci,
                        scenarioIndex: si 
                    });
                    break;
                }
            }
            if (targetScenario) break;
        }
        
        if (!targetScenario) {
            logger.error('[AUDIT FIX-SCENARIO] Scenario not found', { 
                searchId,
                categoriesCount: template.categories?.length || 0
            });
            return res.status(404).json({ error: 'Scenario not found', searchId });
        }
        
        logger.info('[AUDIT FIX-SCENARIO] Starting batch fix', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            violationCount: violations?.length || 0
        });
        
        // Build full scenario context for GPT
        const scenarioContext = {
            name: targetScenario.name,
            scenarioType: targetScenario.scenarioType || 'FAQ',
            category: targetScenario.categories?.[0] || template.categories?.[categoryIndex]?.name || 'General',
            behavior: targetScenario.behavior || 'calm_professional',
            triggers: (targetScenario.triggers || []).slice(0, 10),
            quickReplies: targetScenario.quickReplies || [],
            fullReplies: targetScenario.fullReplies || [],
            followUpMode: targetScenario.followUpMode,
            actionType: targetScenario.actionType
        };
        
        // Generate fixes for all violations
        const fixes = [];
        let tokensUsed = 0;
        
        for (const violation of (violations || [])) {
            try {
                // Skip violations without a field
                if (!violation.field) {
                    logger.info('[AUDIT FIX-SCENARIO] Skipping violation without field');
                    continue;
                }
                
                // Get current value for this field
                const fieldPath = violation.field.replace(/\[(\d+)\]/g, '.$1').split('.');
                let currentValue = targetScenario;
                for (const key of fieldPath) {
                    if (currentValue === undefined || currentValue === null) break;
                    currentValue = currentValue[key];
                }
                
                // Skip if it's not a text field we can fix
                if (typeof currentValue !== 'string') {
                    // For array items, try to use the violation.value instead
                    if (violation.value && typeof violation.value === 'string') {
                        currentValue = violation.value;
                    } else {
                        logger.info('[AUDIT FIX-SCENARIO] Skipping non-text field', { 
                            field: violation.field,
                            valueType: typeof currentValue 
                        });
                        continue;
                    }
                }
                
                const valueToFix = currentValue || violation.value;
                
                if (!valueToFix || typeof valueToFix !== 'string') {
                    logger.info('[AUDIT FIX-SCENARIO] No value to fix', { field: violation.field });
                    continue;
                }
                
                // Generate fix using GPT-4o
                const fixPrompt = `Fix this dispatcher scenario text that has a violation.

SCENARIO CONTEXT:
- Name: ${scenarioContext.name}
- Type: ${scenarioContext.scenarioType}
- Purpose: ${scenarioContext.triggers.slice(0, 3).join(', ')}

CURRENT VALUE: "${valueToFix}"
VIOLATION: ${violation.message}
SUGGESTION: ${violation.suggestion || 'Fix the issue'}

RULES:
- Keep under 20 words for quick replies, 25 for full replies
- Use {name} placeholder appropriately
- Sound like an experienced dispatcher (calm, professional)
- Never use: "Got it", "No problem", "happy to help", "let me help"
- Approved: "I understand.", "Alright.", "Okay.", "Thanks, {name}."

Return ONLY the fixed text. No quotes, no explanation.`;

                const response = await openaiClient.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'Return only the corrected text. No quotes or explanation.' },
                        { role: 'user', content: fixPrompt }
                    ],
                    max_tokens: 150,
                    temperature: 0.3
                });
                
                const suggestedFix = response.choices[0]?.message?.content?.trim();
                tokensUsed += response.usage?.total_tokens || 0;
                
                if (suggestedFix && suggestedFix !== valueToFix) {
                    fixes.push({
                        field: violation.field,
                        oldValue: valueToFix,
                        newValue: suggestedFix,
                        ruleId: violation.ruleId,
                        message: violation.message
                    });
                }
                
            } catch (fixError) {
                logger.error('[AUDIT FIX-SCENARIO] Error generating fix for field', {
                    field: violation.field,
                    error: fixError.message
                });
            }
        }
        
        // Apply all fixes to the scenario
        let fixesApplied = 0;
        for (const fix of fixes) {
            try {
                const fieldPath = fix.field.replace(/\[(\d+)\]/g, '.$1').split('.');
                
                // Navigate to parent and set value
                let target = targetScenario;
                for (let i = 0; i < fieldPath.length - 1; i++) {
                    target = target[fieldPath[i]];
                }
                const lastKey = fieldPath[fieldPath.length - 1];
                
                if (target && lastKey !== undefined) {
                    target[lastKey] = fix.newValue;
                    fixesApplied++;
                    
                    logger.info('[AUDIT FIX-SCENARIO] Applied fix', {
                        field: fix.field,
                        oldValue: fix.oldValue?.substring(0, 50),
                        newValue: fix.newValue?.substring(0, 50)
                    });
                }
            } catch (applyError) {
                logger.error('[AUDIT FIX-SCENARIO] Error applying fix', {
                    field: fix.field,
                    error: applyError.message
                });
            }
        }
        
        // Mark scenario as modified
        targetScenario.lastEditedAt = new Date();
        targetScenario.lastEditedBy = 'AI Audit Batch Fix';
        targetScenario.lastEditedFromContext = 'AUDIT_FIX_SCENARIO';
        
        // Save the template
        template.markModified(`categories.${categoryIndex}.scenarios.${scenarioIndex}`);
        await template.save();
        
        logger.info('[AUDIT FIX-SCENARIO] Batch fix complete', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            totalViolations: violations?.length || 0,
            fixesGenerated: fixes.length,
            fixesApplied,
            tokensUsed
        });
        
        res.json({
            success: true,
            scenarioId,
            scenarioName: targetScenario.name,
            totalViolations: violations?.length || 0,
            fixesGenerated: fixes.length,
            fixesApplied,
            fixes: fixes.map(f => ({
                field: f.field,
                oldValue: f.oldValue?.substring(0, 50),
                newValue: f.newValue?.substring(0, 50)
            })),
            tokensUsed,
            message: `Applied ${fixesApplied} fixes to scenario`
        });
        
    } catch (error) {
        logger.error('[AUDIT FIX-SCENARIO] Error', { 
            companyId, 
            scenarioId,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            error: 'Failed to fix scenario', 
            details: error.message,
            scenarioId
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /registry - Expose SCENARIO_SETTINGS_REGISTRY (single source of truth)
// ════════════════════════════════════════════════════════════════════════════════
// This is the ONLY place ownership counts should come from.
// All UI, banners, health checks derive from this - no hardcoded values allowed.
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:companyId/registry', async (req, res) => {
    try {
        const counts = getSettingsCount();
        
        // Return the ownership model as the single source of truth
        res.json({
            success: true,
            
            // ════════════════════════════════════════════════════════════════════
            // OWNERSHIP MODEL (the constitution)
            // ════════════════════════════════════════════════════════════════════
            ownership: {
                content: {
                    count: counts.ownership.content,
                    description: 'WHAT to say - GPT generates these',
                    settings: counts.ownership.contentSettings.map(s => s.setting)
                },
                runtime: {
                    count: counts.ownership.runtime,
                    description: 'HOW/WHEN to behave - ConversationEngine decides at call time',
                    settings: counts.ownership.runtimeOwnedSettings.map(s => s.setting)
                },
                admin: {
                    count: counts.ownership.admin,
                    description: 'Infrastructure policies - Admin configures',
                    settings: counts.ownership.adminSettings.map(s => s.setting)
                },
                system: {
                    count: counts.ownership.system,
                    description: 'Auto-generated - Never touched'
                }
            },
            
            // ════════════════════════════════════════════════════════════════════
            // CONTENT FIELDS (what Gap Fill generates)
            // This is the canonical list - no hardcoded arrays elsewhere
            // ════════════════════════════════════════════════════════════════════
            contentFields: counts.ownership.contentSettings.map(s => s.setting),
            
            // ════════════════════════════════════════════════════════════════════
            // RUNTIME FIELDS (what Wiring must prove via blackbox)
            // ════════════════════════════════════════════════════════════════════
            runtimeFields: counts.ownership.runtimeOwnedSettings.map(s => s.setting),
            
            // ════════════════════════════════════════════════════════════════════
            // ADMIN FIELDS (what admin configures globally)
            // ════════════════════════════════════════════════════════════════════
            adminFields: counts.ownership.adminSettings.map(s => s.setting),
            
            // Legacy counts for backward compatibility
            legacy: {
                total: counts.total,
                audited: counts.audited,
                gapGenerated: counts.gapGenerated,
                agentUsed: counts.agentUsed
            }
        });
    } catch (error) {
        logger.error('Failed to get registry', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

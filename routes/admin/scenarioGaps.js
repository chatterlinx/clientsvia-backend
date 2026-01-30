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
const crypto = require('crypto');

// Authentication & Authorization
const { authenticateJWT } = require('../../middleware/auth');
const authorizeCompanyAccess = require('../../middleware/authorizeCompanyAccess');

// Models
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { BOOKING_PHRASES, SCENARIO_SETTINGS_REGISTRY, getSettingsCount, enforceContentOwnership } = require('../../services/scenarioAudit/constants');
const { runUnifiedAudit } = require('../../services/scenarioAudit/unifiedAuditEngine');

// Services
const openaiClient = require('../../config/openai');
const logger = require('../../utils/logger');
const { AuditEngine, getAvailableRules } = require('../../services/scenarioAudit');
const { buildPlaceholderGovernanceBlock, validateScenarioPlaceholders } = require('../../services/placeholders/PlaceholderRegistry');

// Coverage Engine
const HVAC_BLUEPRINT_SPEC = require('../../config/blueprints/HVAC_BLUEPRINT_SPEC');
const IntentMatcher = require('../../services/IntentMatcher');
const CoverageAssessor = require('../../services/CoverageAssessor');
const BlueprintGenerator = require('../../services/BlueprintGenerator');

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
 * Calculate Levenshtein similarity ratio between two strings
 * @returns {number} Similarity ratio between 0 and 1
 */
function levenshteinSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    
    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;
    
    // Create distance matrix
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));
    
    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            );
        }
    }
    
    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - (distance / maxLen);
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
    
    // Small talk should not schedule or book
    if (normalized.scenarioType === 'SMALL_TALK') {
        normalized.bookingIntent = false;
        
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
        "Thanks, {callerName}. How can I help you today?"
    ];
}

function extractReplyText(reply) {
    return typeof reply === 'string' ? reply : reply?.text;
}

function buildManualValidation(scenario, tradeKey) {
    const errors = [];
    const warnings = [];

    const placeholderValidation = validateScenarioPlaceholders(scenario, tradeKey);
    if (!placeholderValidation.valid) {
        const legacy = placeholderValidation.forbiddenLegacy || [];
        const unknown = placeholderValidation.unknownInvalid || [];

        if (legacy.length > 0) {
            errors.push({
                type: 'forbidden_legacy',
                message: `Legacy placeholders detected: ${legacy.map(l => l.key).join(', ')}`
            });
        }

        if (unknown.length > 0) {
            errors.push({
                type: 'unknown_placeholder',
                message: `Unknown placeholders detected: ${unknown.map(u => u.key).join(', ')}`
            });
        }

        if (errors.length === 0) {
            errors.push({
                type: 'invalid_placeholder',
                message: placeholderValidation.message || 'Invalid placeholders detected'
            });
        }
    }

    const noNameReplies = [
        ...(scenario.quickReplies_noName || []),
        ...(scenario.fullReplies_noName || [])
    ];
    const hasCallerNameInNoName = noNameReplies.some(r => {
        const text = extractReplyText(r);
        return text && text.toLowerCase().includes('{callername}');
    });

    if (hasCallerNameInNoName) {
        errors.push({
            type: 'noname_contains_callername',
            message: '_noName replies contain {callerName}'
        });
    }

    const mainReplies = [
        ...(scenario.quickReplies || []),
        ...(scenario.fullReplies || [])
    ];
    const hasCallerName = mainReplies.some(r => {
        const text = extractReplyText(r);
        return text && text.toLowerCase().includes('{callername}');
    });

    if (!hasCallerName) {
        warnings.push({
            type: 'missing_callername',
            message: 'No {callerName} found in replies'
        });
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        tokensUsed: placeholderValidation.tokens || []
    };
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
function sanitizeOverrideValue(value, maxLength = 80) {
    if (!value) return '';
    return String(value)
        .replace(/\s+/g, ' ')
        .replace(/[\r\n]+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

async function generateScenarioFromGap(gap, company, options = {}) {
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
    
    const overrideTradeKey = sanitizeOverrideValue(options.tradeKeyOverride).toLowerCase();
    const tradeType = overrideTradeKey || template.templateType?.toLowerCase() || 'general';
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
    const governanceBlock = buildPlaceholderGovernanceBlock(tradeType);
    const categoryOverride = sanitizeOverrideValue(options.categoryOverride);
    const scenarioTypeOverride = sanitizeOverrideValue(options.scenarioTypeOverride);
    
    const promptRaw = `You are creating scenarios for an EXPERIENCED ${tradeName} SERVICE DISPATCHER.

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

${categoryOverride ? `CATEGORY OVERRIDE: Use categories=["${categoryOverride}"]` : ''}
${scenarioTypeOverride ? `SCENARIO TYPE OVERRIDE: Use scenarioType="${scenarioTypeOverride}"` : ''}

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
• Vary the acknowledgment: "I understand." / "Alright." / "Okay." / "Thanks, {callerName}."
• Vary the question phrasing while asking the same thing

fullReplies (4-5 variations) - STILL DISPATCHER STYLE:
• Slightly more context but STILL under 25 words
• Never paragraphs, never fluffy
• MUST have 4-5 variations for natural conversation
• MUST include {callerName} in EACH reply (runtime will strip if unknown)
• Vary the acknowledgment: "Thanks, {callerName}." / "Alright, {callerName}." / "Okay, {callerName}."
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
❌ Bad: "I understand, {callerName}. Is the unit making any unusual noises?"
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

❌ Bad: "Have you checked if the thermostat is set correctly?"
✅ Good: "We'll get a technician out. Morning or afternoon?"

NATURAL BRIDGE (between classify → book):
Caller: "The screen is blank."
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

RETURNING CUSTOMER:
❌ Bad: "Great to hear from you again! How wonderful to have you back!"
✅ Good: "Good to hear from you, {callerName}. What's going on with the system today?"

GREETING:
❌ Bad: "Hi {callerName}! Thanks so much for reaching out to us today!"
✅ Good: "Hi {callerName}. What's going on?"

═══════════════════════════════════════════════════════════════════════════════
👤 PERSONALIZATION RULES (CRITICAL - Recognition ≠ Warmth)
═══════════════════════════════════════════════════════════════════════════════
A real receptionist acknowledges NAME and LOYALTY — then pivots to purpose.
This is NOT warmth. This is RECOGNITION + RESPECT.

PLACEHOLDER RULES:
• Only use {callerName} as a placeholder for caller's name
• Do NOT invent names - only use {callerName} as placeholder
• Runtime will replace {callerName} with actual name or remove it gracefully

NAME ACKNOWLEDGMENT (when caller provides name):
• Acknowledge the name ONCE in the next response
• Keep acknowledgment under 10 words
• Then immediately pivot to classify or book

APPROVED NAME ACKNOWLEDGMENTS (use these exactly):
• "Thanks, {callerName}."
• "Appreciate it, {callerName}."
• "Good to hear from you, {callerName}."

LOYALTY ACKNOWLEDGMENT (when caller mentions returning/long-time customer):
• Acknowledge loyalty ONCE, briefly
• Return customers are GOLD - never take them for granted
• Then pivot to the reason for their call

APPROVED LOYALTY ACKNOWLEDGMENTS:
• "We appreciate you, {callerName}."
• "Thanks for being a long-time customer, {callerName}."
• "Glad to have you back, {callerName}."
• "Good to hear from you again, {callerName}."

COMBINED EXAMPLE (name + loyalty + pivot):
Caller: "My name is Mark. I'm a long-time customer and I'm having AC issues."
❌ Bad: "Alright. What's going on with your system?"
✅ Good: "Thanks, {callerName} — we appreciate you being a long-time customer. What's going on with the AC today?"

THE THREE MICRO-ACKNOWLEDGMENTS (in order):
1. Name acknowledgment (once, immediately after capture)
2. Loyalty acknowledgment (only if mentioned)
3. Pivot to purpose (classify or book)

TWO-VARIANT REPLIES (provide BOTH for flexibility):
For scenarios where name may or may not be available:
• WITH NAME: "Thanks, {callerName}. What's going on with the AC today?"
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
    "status": "draft",
    "categories": ["Scheduling|Pricing|Hours|Service Area|Emergency|FAQ|Warranty|Billing|General"],
    
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
        "Thanks, {callerName}. Is the unit running but not cooling, or not turning on?",
        "I understand. Is the unit running but not cooling, or not turning on?",
        "Alright. Is air coming out of the vents?",
        "Okay, {callerName}. Is the system blowing warm air or nothing at all?",
        "Got the picture. Is it running but not cooling, or completely off?",
        "Appreciate it, {callerName}. Is the thermostat showing anything?"
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
        "Thanks, {callerName}. We'll get a technician out. Morning or afternoon?",
        "Alright, {callerName}. We'll get a technician out. Morning or afternoon?",
        "I understand, {callerName}. Let's get you on the schedule. What day works best?",
        "Okay, {callerName}. We can have someone out today or tomorrow. Which works better?",
        "Sounds good, {callerName}. When would you like us to come by?"
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
1. ALWAYS include {callerName} in EVERY quickReply and EVERY fullReply
2. ALWAYS provide matching _noName variants (same count, same order)
3. Name acknowledgment = recognition, NOT warmth
4. Loyalty acknowledgment = respect for returning customers
5. Three micro-acknowledgments in order: Name → Loyalty → Purpose
6. Keep all acknowledgments under 10 words
7. Approved patterns:
   - "Thanks, {callerName}." / "Thanks."
   - "Appreciate it, {callerName}." / "Appreciate it."
   - "Alright, {callerName}." / "Alright."
   - "Okay, {callerName}." / "Okay."
   - "Good to hear from you, {callerName}." / "Good to hear from you."
8. For returning/long-time customer scenarios:
   - "We appreciate you, {callerName}."
   - "Thanks for being a long-time customer, {callerName}."
9. CRITICAL: fullReplies count MUST equal fullReplies_noName count (both 4-5)
10. CRITICAL: quickReplies count MUST equal quickReplies_noName count (both 5-7)

PLACEHOLDER GOVERNANCE:
- Use ONLY placeholders listed in the governance block below
- Do NOT invent new tokens
- If a needed token isn't listed, request a new catalog entry

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

RUNTIME/ADMIN FIELDS (DO NOT GENERATE):
- followUpMode, followUpQuestionText, actionType, handoffPolicy
- cooldownSeconds, actionHooks, entityValidation, dynamicVariables
- timedFollowUp, silencePolicy, followUpMessages
These are runtime/admin policies and will be stripped.`;

    const prompt = `${promptRaw.replace(/\{name\}/g, '{callerName}')}\n\n${governanceBlock}`;

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
                tokensUsed: response.usage?.total_tokens || 0,
                tradeType
            };
        }
        
        const suggestedPlaceholders = Array.isArray(s.suggestedPlaceholders) ? s.suggestedPlaceholders : [];

        // Build content-only scenario object (22 fields)
        const resolvedScenarioType = scenarioTypeOverride || s.scenarioType || 'FAQ';
        const categoryValue = categoryOverride || s.category || s.categories?.[0] || 'FAQ';

        const scenario = normalizeScenarioForType({
            // Identity
            name: s.name || gap.representative.substring(0, 50),
            status: 'draft',
            isActive: true,
            categories: Array.isArray(s.categories) ? s.categories : [categoryValue],

            // Classification
            scenarioType: resolvedScenarioType,
            priority: typeof s.priority === 'number' ? s.priority : 50,
            minConfidence: typeof s.minConfidence === 'number' ? s.minConfidence : 0.6,
            behavior: s.behavior || 'calm_professional',
            replyStrategy: s.replyStrategy || 'AUTO',
            bookingIntent: s.bookingIntent === true,

            // Triggers (required)
            triggers: Array.isArray(s.triggers) ? s.triggers : [gap.representative],
            regexTriggers: Array.isArray(s.regexTriggers) ? s.regexTriggers : [],
            negativeTriggers: Array.isArray(s.negativeTriggers) ? s.negativeTriggers : [],
            exampleUserPhrases: Array.isArray(s.exampleUserPhrases) ? s.exampleUserPhrases : [],
            negativeUserPhrases: Array.isArray(s.negativeUserPhrases) ? s.negativeUserPhrases : [],

            // Replies WITH {callerName} placeholder (primary)
            quickReplies: Array.isArray(s.quickReplies) ? s.quickReplies :
                (s.quickReply ? [s.quickReply] : ['I can help with that.']),
            fullReplies: Array.isArray(s.fullReplies) ? s.fullReplies :
                (s.fullReply ? [s.fullReply] : []),

            // Replies WITHOUT {callerName} placeholder (fallback when name not available)
            quickReplies_noName: Array.isArray(s.quickReplies_noName) ? s.quickReplies_noName : null,
            fullReplies_noName: Array.isArray(s.fullReplies_noName) ? s.fullReplies_noName : null,

            // Entity extraction
            entityCapture: Array.isArray(s.entityCapture) ?
                s.entityCapture.filter(e => e && e !== 'none') : [],

            // Optional channel restriction
            channel: s.channel || 'voice',

            // Admin notes
            notes: s.notes || `Auto-generated from Scenario Gaps. Detected ${gap.totalCalls} similar calls.`
        });

    const { sanitized } = enforceContentOwnership(scenario, {
            source: 'scenario-gaps',
            logWarnings: false
        });

        const placeholderValidation = validateScenarioPlaceholders(sanitized, tradeType);
        if (!placeholderValidation.valid) {
            throw new Error(`PLACEHOLDER_INVALID: ${placeholderValidation.message}`);
        }

        return {
            success: true,
            isDuplicate: false,
            scenario: sanitized,
            category: categoryValue,
            suggestedPlaceholders,
            tokensUsed: response.usage?.total_tokens || 0,
            tradeType
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
    const tradeType = (company?.trade || 'general').toLowerCase();
    const normalized = normalizeText(gap.representative);
    
    // Extract potential category and type from keywords
    let category = 'FAQ';
    let scenarioType = 'FAQ';
    let priority = 50;
    
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
    
    const scenario = normalizeScenarioForType({
        name: gap.representative.substring(0, 50),
        status: 'draft',
        isActive: true,
        categories: [category],
        scenarioType,
        priority,
        minConfidence: minConfidenceMap[scenarioType] || 0.6,
        behavior: scenarioType === 'EMERGENCY' ? 'empathetic_reassuring' : 'calm_professional',
        replyStrategy: 'AUTO',
        triggers: triggers.length > 0 ? triggers : [normalized],
        negativeTriggers: [],
        regexTriggers: [],
        quickReplies: ['I can help you with that. Let me get more information to assist you.'],
        fullReplies: [],
        quickReplies_noName: null,
        fullReplies_noName: null,
        bookingIntent: scenarioType === 'BOOKING',
        entityCapture: [],
        channel: 'voice',
        notes: `Auto-generated fallback. Detected ${gap.totalCalls} similar calls.`
    });

    const { sanitized } = enforceContentOwnership(scenario, {
        source: 'scenario-gaps-fallback',
        logWarnings: false
    });

    return {
        success: true,
        scenario: sanitized,
        category,
        suggestedPlaceholders: [],
        tokensUsed: 0,
        tradeType
    };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /:companyId/local-config
 * 
 * Get company's local scenario configuration (custom template + service context)
 */
router.get('/:companyId/local-config', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId)
            .select('name aiAgentSettings.customTemplateId aiAgentSettings.localServiceContext')
            .lean();
            
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        return res.json({
            _id: company._id,
            name: company.name,
            customTemplateId: company.aiAgentSettings?.customTemplateId || null,
            localServiceContext: company.aiAgentSettings?.localServiceContext || ''
        });
    } catch (error) {
        logger.error('[COMPANY LOCAL] Error fetching company', { error: error.message, companyId });
        return res.status(500).json({ error: 'Failed to fetch company' });
    }
});

/**
 * GET /:companyId/services-config
 * 
 * SINGLE SOURCE OF TRUTH for service toggle configuration
 * Returns merged config: template defaults + company overrides
 * Called by: Blueprint Builder, Gap Fill, Company Local, Audit, Runtime
 */
router.get('/:companyId/services-config', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        // Load company with services config
        const company = await Company.findById(companyId)
            .select('name aiAgentSettings.templateReferences aiAgentSettings.services')
            .lean();
            
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get company's primary template
        const templateRef = company.aiAgentSettings?.templateReferences?.[0];
        if (!templateRef?.templateId) {
            return res.json({
                success: true,
                company: { id: companyId, name: company.name },
                template: null,
                services: {},
                toggleableCategories: [],
                enabledServiceKeys: [],
                disabledServiceKeys: []
            });
        }
        
        // Load template with categories
        const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId)
            .select('name categories.id categories.name categories.icon categories.serviceKey categories.isToggleable categories.defaultEnabled categories.serviceIntent categories.serviceDecline')
            .lean();
            
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Extract toggleable categories
        const toggleableCategories = (template.categories || [])
            .filter(cat => cat.isToggleable && cat.serviceKey)
            .map(cat => ({
                categoryId: cat.id,
                categoryName: cat.name,
                categoryIcon: cat.icon || '📋',
                serviceKey: cat.serviceKey,
                defaultEnabled: cat.defaultEnabled !== false, // Default to true if not specified
                intent: {
                    keywords: cat.serviceIntent?.keywords || [],
                    phrases: cat.serviceIntent?.phrases || [],
                    negative: cat.serviceIntent?.negative || [],
                    minConfidence: cat.serviceIntent?.minConfidence || 0.6
                },
                decline: {
                    defaultMessage: cat.serviceDecline?.defaultMessage || null,
                    suggestAlternatives: cat.serviceDecline?.suggestAlternatives !== false
                }
            }));
        
        // Merge with company overrides
        const companyServices = company.aiAgentSettings?.services || {};
        const mergedServices = {};
        const enabledServiceKeys = [];
        const disabledServiceKeys = [];
        
        for (const cat of toggleableCategories) {
            const companyOverride = companyServices[cat.serviceKey];
            
            // Determine if enabled (company override > template default)
            let isEnabled;
            if (companyOverride !== undefined && companyOverride.enabled !== undefined) {
                isEnabled = companyOverride.enabled;
            } else {
                isEnabled = cat.defaultEnabled;
            }
            
            // Build merged config
            mergedServices[cat.serviceKey] = {
                enabled: isEnabled,
                source: companyOverride?.enabled !== undefined ? 'company_override' : 'template_default',
                categoryId: cat.categoryId,
                categoryName: cat.categoryName,
                categoryIcon: cat.categoryIcon,
                // Merge keywords (template + company overrides)
                keywords: [
                    ...cat.intent.keywords,
                    ...(companyOverride?.overrideKeywords || [])
                ],
                phrases: cat.intent.phrases,
                negative: cat.intent.negative,
                minConfidence: cat.intent.minConfidence,
                // Decline message (company override > template default)
                declineMessage: companyOverride?.overrideDeclineMessage || cat.decline.defaultMessage,
                suggestAlternatives: cat.decline.suggestAlternatives,
                // Track if company has custom overrides
                hasOverrides: !!(companyOverride?.overrideKeywords?.length || companyOverride?.overrideDeclineMessage)
            };
            
            if (isEnabled) {
                enabledServiceKeys.push(cat.serviceKey);
            } else {
                disabledServiceKeys.push(cat.serviceKey);
            }
        }
        
        logger.info('[SERVICES CONFIG] Loaded', {
            companyId,
            templateName: template.name,
            toggleableCount: toggleableCategories.length,
            enabled: enabledServiceKeys.length,
            disabled: disabledServiceKeys.length
        });
        
        return res.json({
            success: true,
            company: {
                id: companyId,
                name: company.name
            },
            template: {
                id: templateRef.templateId,
                name: template.name
            },
            services: mergedServices,
            toggleableCategories,
            enabledServiceKeys,
            disabledServiceKeys,
            summary: {
                totalToggleable: toggleableCategories.length,
                enabled: enabledServiceKeys.length,
                disabled: disabledServiceKeys.length,
                withOverrides: Object.values(mergedServices).filter(s => s.hasOverrides).length
            }
        });
        
    } catch (error) {
        logger.error('[SERVICES CONFIG] Error', { error: error.message, companyId });
        return res.status(500).json({ error: 'Failed to load services config' });
    }
});

/**
 * PATCH /:companyId/services-config
 * 
 * Update company's service toggles and overrides
 */
router.patch('/:companyId/services-config', async (req, res) => {
    const { companyId } = req.params;
    const { services } = req.body;
    
    if (!services || typeof services !== 'object') {
        return res.status(400).json({ error: 'services object is required' });
    }
    
    try {
        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: { 'aiAgentSettings.services': services } },
            { new: true }
        ).select('name aiAgentSettings.services');
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        logger.info('[SERVICES CONFIG] Updated', {
            companyId,
            servicesCount: Object.keys(services).length,
            services: Object.entries(services).map(([k, v]) => `${k}:${v.enabled}`)
        });
        
        return res.json({
            success: true,
            services: company.aiAgentSettings?.services || {}
        });
        
    } catch (error) {
        logger.error('[SERVICES CONFIG] Update error', { error: error.message, companyId });
        return res.status(500).json({ error: 'Failed to update services config' });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// COVERAGE ENGINE - Blueprint-based intent coverage assessment
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/coverage
 * 
 * Assess how well the company's scenarios cover required intents from the blueprint.
 * This is the core of the Blueprint Builder's "Assess Coverage" feature.
 * 
 * Returns:
 * - summary: { good, weak, missing, skipped, needsReview }
 * - coveragePercent: Overall coverage %
 * - intents: Detailed status per intent
 * - recommendations: Actionable next steps
 */
router.get('/:companyId/coverage', async (req, res) => {
    const { companyId } = req.params;
    const { blueprint = 'hvac', includeAuditScores = 'false' } = req.query;
    
    try {
        // Select blueprint spec based on trade
        let blueprintSpec;
        if (blueprint === 'hvac' || blueprint === 'HVAC') {
            blueprintSpec = HVAC_BLUEPRINT_SPEC;
        } else {
            return res.status(400).json({ error: `Unknown blueprint: ${blueprint}. Supported: hvac` });
        }
        
        // Create assessor and run assessment
        const assessor = new CoverageAssessor(blueprintSpec);
        
        // Optionally load audit scores
        let auditScores = {};
        if (includeAuditScores === 'true') {
            // TODO: Load from last Deep Audit results
            // For now, this can be passed in via query or we skip it
        }
        
        const result = await assessor.assess(companyId, { auditScores });
        
        if (result.error) {
            return res.status(400).json(result);
        }
        
        logger.info('[COVERAGE] Assessment complete', {
            companyId,
            blueprint: blueprintSpec.blueprintId,
            coverage: `${result.coveragePercent}%`,
            good: result.summary.good,
            weak: result.summary.weak,
            missing: result.summary.missing,
            skipped: result.summary.skipped
        });
        
        return res.json(result);
        
    } catch (error) {
        logger.error('[COVERAGE] Error', { companyId, error: error.message });
        return res.status(500).json({ error: 'Coverage assessment failed', details: error.message });
    }
});

/**
 * POST /:companyId/coverage/match-scenario
 * 
 * Match a single scenario to blueprint intents (for debugging/testing)
 */
router.post('/:companyId/coverage/match-scenario', async (req, res) => {
    const { companyId } = req.params;
    const { scenario, blueprint = 'hvac' } = req.body;
    
    if (!scenario) {
        return res.status(400).json({ error: 'scenario object is required' });
    }
    
    try {
        let blueprintSpec;
        if (blueprint === 'hvac' || blueprint === 'HVAC') {
            blueprintSpec = HVAC_BLUEPRINT_SPEC;
        } else {
            return res.status(400).json({ error: `Unknown blueprint: ${blueprint}` });
        }
        
        const matcher = new IntentMatcher(blueprintSpec);
        const result = matcher.match(scenario);
        
        return res.json({
            success: true,
            scenario: {
                name: scenario.name,
                triggers: scenario.triggers?.slice(0, 5)
            },
            match: result
        });
        
    } catch (error) {
        logger.error('[COVERAGE] Match error', { error: error.message });
        return res.status(500).json({ error: 'Matching failed', details: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// REPLACE-NOT-ADD IMPORT - Safe scenario import with scope enforcement
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /:companyId/coverage/import
 * 
 * Import a generated scenario with scope enforcement and replace-not-add logic.
 * 
 * SCOPE RULES:
 * - scope: "global" → import to shared global template only
 * - scope: "companyLocal" → import to company's customTemplateId only
 * - scope: "either" → uses defaultDestination or explicit param
 * 
 * ACTIONS:
 * - ADD: Create new scenario (checks no existing coverage for this intentKey)
 * - REPLACE: Deprecate old scenario, create new one
 */
router.post('/:companyId/coverage/import', async (req, res) => {
    const { companyId } = req.params;
    const { 
        intentKey,
        action,           // 'ADD' or 'REPLACE'
        scenario,         // Full 22-field scenario object
        replaceTargetScenarioId, // Required when action = 'REPLACE'
        targetCategoryId, // Which category to add to
        forceDestination  // Override scope destination ('global' or 'companyLocal')
    } = req.body;
    
    // Validate required fields
    if (!intentKey) {
        return res.status(400).json({ error: 'intentKey is required' });
    }
    if (!action || !['ADD', 'REPLACE'].includes(action)) {
        return res.status(400).json({ error: 'action must be ADD or REPLACE' });
    }
    if (!scenario || typeof scenario !== 'object') {
        return res.status(400).json({ error: 'scenario object is required' });
    }
    if (action === 'REPLACE' && !replaceTargetScenarioId) {
        return res.status(400).json({ error: 'replaceTargetScenarioId required for REPLACE action' });
    }
    
    try {
        // ════════════════════════════════════════════════════════════════════
        // STEP 1: Load blueprint item to get scope
        // ════════════════════════════════════════════════════════════════════
        const blueprintItem = findBlueprintItem(intentKey);
        if (!blueprintItem) {
            return res.status(400).json({ error: `Unknown intentKey: ${intentKey}` });
        }
        
        const itemScope = blueprintItem.scope || 'global';
        const serviceKey = blueprintItem.serviceKey || null;
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 2: Determine destination template
        // ════════════════════════════════════════════════════════════════════
        const company = await Company.findById(companyId)
            .select('aiAgentSettings.templateReferences aiAgentSettings.customTemplateId companyName businessName')
            .lean();
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Determine destination based on scope
        let destination;
        let templateId;
        
        if (forceDestination === 'global' && itemScope !== 'companyLocal') {
            destination = 'global';
        } else if (forceDestination === 'companyLocal' || itemScope === 'companyLocal') {
            destination = 'companyLocal';
        } else if (itemScope === 'either') {
            destination = serviceKey ? 'companyLocal' : 'global';
        } else {
            destination = 'global';
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 3: SCOPE ENFORCEMENT - Hard stop on contamination
        // ════════════════════════════════════════════════════════════════════
        if (itemScope === 'companyLocal' && forceDestination === 'global') {
            return res.status(403).json({
                error: 'SCOPE_VIOLATION',
                message: `Intent "${intentKey}" is company-local only and cannot be added to a shared global template.`,
                itemScope,
                serviceKey,
                suggestion: 'Import to Company Local template instead.'
            });
        }
        
        // Get target template ID
        if (destination === 'companyLocal') {
            templateId = company.aiAgentSettings?.customTemplateId;
            if (!templateId) {
                return res.status(400).json({
                    error: 'NO_COMPANY_LOCAL_TEMPLATE',
                    message: 'Company does not have a Company Local template. Create one first.',
                    suggestion: 'Go to Company Local tab and assign a custom template.'
                });
            }
        } else {
            // Global template
            const templateRef = company.aiAgentSettings?.templateReferences?.[0];
            templateId = templateRef?.templateId;
            if (!templateId) {
                return res.status(400).json({ error: 'Company has no assigned global template' });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 4: Load target template
        // ════════════════════════════════════════════════════════════════════
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ error: `Template ${templateId} not found` });
        }
        
        // Find target category
        let category;
        if (targetCategoryId) {
            category = template.categories.find(c => c.id === targetCategoryId);
        }
        if (!category) {
            // Try to find by blueprint item's category
            const categoryKey = blueprintItem.categoryKey || blueprintItem.category;
            category = template.categories.find(c => 
                c.name?.toLowerCase().includes(categoryKey?.replace('hvac-', '').replace(/-/g, ' ')) ||
                c.id === categoryKey
            );
        }
        if (!category) {
            // Fall back to first category
            category = template.categories[0];
        }
        if (!category) {
            return res.status(400).json({ error: 'No suitable category found in template' });
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 5: Handle REPLACE action - deprecate old scenario
        // ════════════════════════════════════════════════════════════════════
        let deprecatedScenario = null;
        
        if (action === 'REPLACE') {
            // Find the scenario to replace
            for (const cat of template.categories) {
                const existing = cat.scenarios?.find(s => s.scenarioId === replaceTargetScenarioId);
                if (existing) {
                    // Mark as deprecated (don't delete)
                    existing.replacedByScenarioId = scenario.scenarioId;
                    existing.replacedAt = new Date();
                    existing.replacedReason = 'weak_audit_score';
                    existing.isActive = false;
                    deprecatedScenario = {
                        scenarioId: existing.scenarioId,
                        name: existing.name
                    };
                    break;
                }
            }
            
            if (!deprecatedScenario) {
                logger.warn('[IMPORT] Replace target not found, proceeding as ADD', { 
                    replaceTargetScenarioId, 
                    intentKey 
                });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 6: Handle ADD action - check for existing coverage
        // ════════════════════════════════════════════════════════════════════
        if (action === 'ADD') {
            // Check if another active scenario already covers this intentKey
            for (const cat of template.categories) {
                const existingCoverage = cat.scenarios?.find(s => 
                    s.blueprintItemKey === intentKey && 
                    s.isActive !== false &&
                    !s.replacedByScenarioId
                );
                if (existingCoverage) {
                    return res.status(409).json({
                        error: 'DUPLICATE_COVERAGE',
                        message: `Intent "${intentKey}" is already covered by scenario "${existingCoverage.name}"`,
                        existingScenarioId: existingCoverage.scenarioId,
                        suggestion: 'Use REPLACE action if you want to upgrade this scenario.'
                    });
                }
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 7: Prepare and add new scenario
        // ════════════════════════════════════════════════════════════════════
        const newScenarioId = scenario.scenarioId || `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const newScenario = {
            ...scenario,
            scenarioId: newScenarioId,
            
            // Blueprint mapping
            blueprintItemKey: intentKey,
            blueprintMatchConfidence: 1.0, // Generated from blueprint = perfect match
            blueprintMatchedAt: new Date(),
            blueprintMatchSource: 'import_generated',
            
            // Ensure active
            isActive: true,
            status: 'live',
            
            // Metadata
            createdAt: new Date(),
            lastEditedAt: new Date(),
            editContext: 'BLUEPRINT_BUILDER'
        };
        
        // Add to category
        if (!category.scenarios) {
            category.scenarios = [];
        }
        category.scenarios.push(newScenario);
        
        // ════════════════════════════════════════════════════════════════════
        // STEP 8: Save template
        // ════════════════════════════════════════════════════════════════════
        await template.save();
        
        logger.info('[IMPORT] Scenario imported successfully', {
            companyId,
            intentKey,
            action,
            destination,
            templateId,
            categoryId: category.id,
            newScenarioId,
            deprecatedScenarioId: deprecatedScenario?.scenarioId
        });
        
        return res.json({
            success: true,
            action,
            destination,
            templateId,
            categoryId: category.id,
            categoryName: category.name,
            scenario: {
                scenarioId: newScenarioId,
                name: newScenario.name,
                blueprintItemKey: intentKey
            },
            deprecated: deprecatedScenario,
            message: action === 'REPLACE' 
                ? `Replaced scenario "${deprecatedScenario?.name}" with new version`
                : `Added new scenario for intent "${intentKey}"`
        });
        
    } catch (error) {
        logger.error('[IMPORT] Error', { companyId, intentKey, error: error.message });
        return res.status(500).json({ error: 'Import failed', details: error.message });
    }
});

/**
 * Helper: Find blueprint item by intentKey
 */
function findBlueprintItem(intentKey) {
    for (const category of (HVAC_BLUEPRINT_SPEC.categories || [])) {
        for (const item of (category.items || [])) {
            if (item.itemKey === intentKey) {
                return { ...item, categoryKey: category.categoryKey };
            }
        }
    }
    return null;
}

/**
 * POST /:companyId/coverage/generate
 * 
 * Generate scenarios for MISSING or WEAK intents.
 * This is the "Fix Weak + Add Missing" button.
 * 
 * ACTIONS:
 * - For MISSING intents: Generate new scenario
 * - For WEAK intents: Generate replacement scenario
 */
router.post('/:companyId/coverage/generate', async (req, res) => {
    const { companyId } = req.params;
    const { 
        intents,  // Array of { intentKey, action: 'ADD'|'REPLACE', existingScenarioId? }
        blueprint = 'hvac',
        batchSize = 5
    } = req.body;
    
    if (!intents || !Array.isArray(intents) || intents.length === 0) {
        return res.status(400).json({ error: 'intents array is required' });
    }
    
    if (intents.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 intents per batch' });
    }
    
    try {
        // Select blueprint spec
        let blueprintSpec;
        if (blueprint === 'hvac' || blueprint === 'HVAC') {
            blueprintSpec = HVAC_BLUEPRINT_SPEC;
        } else {
            return res.status(400).json({ error: `Unknown blueprint: ${blueprint}` });
        }
        
        // Load company context
        const company = await Company.findById(companyId)
            .select('companyName businessName aiAgentSettings.services')
            .lean();
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Create generator
        const generator = new BlueprintGenerator(blueprintSpec, openaiClient);
        
        // Build company context
        const companyContext = {
            companyName: company.companyName || company.businessName,
            tone: blueprintSpec.metadata?.companyTone || 'calm_professional'
        };
        
        // Load existing scenarios for REPLACE actions
        const existingScenarios = new Map();
        const replaceIntents = intents.filter(i => i.action === 'REPLACE' && i.existingScenarioId);
        
        if (replaceIntents.length > 0) {
            const templateRef = (await Company.findById(companyId)
                .select('aiAgentSettings.templateReferences')
                .lean())?.aiAgentSettings?.templateReferences?.[0];
            
            if (templateRef?.templateId) {
                const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId)
                    .select('categories.scenarios.scenarioId categories.scenarios.name categories.scenarios.triggers')
                    .lean();
                
                if (template) {
                    for (const cat of (template.categories || [])) {
                        for (const scenario of (cat.scenarios || [])) {
                            existingScenarios.set(scenario.scenarioId, scenario);
                        }
                    }
                }
            }
        }
        
        // Prepare intents with existing scenario data
        const preparedIntents = intents.map(intent => ({
            ...intent,
            existingScenario: intent.existingScenarioId 
                ? existingScenarios.get(intent.existingScenarioId) 
                : null
        }));
        
        // Generate batch
        logger.info('[GENERATE] Starting batch generation', {
            companyId,
            totalIntents: intents.length,
            replaceCount: replaceIntents.length,
            addCount: intents.length - replaceIntents.length
        });
        
        const { results, summary } = await generator.generateBatch(preparedIntents, {
            batchSize,
            companyContext,
            serviceContext: {}
        });
        
        logger.info('[GENERATE] Batch complete', {
            companyId,
            success: summary.success,
            failed: summary.failed,
            readyToImport: summary.readyToImport
        });
        
        return res.json({
            success: true,
            summary,
            results: results.map(r => ({
                intentKey: r.intentKey,
                intentName: r.intentName,
                success: r.success,
                readyToImport: r.readyToImport,
                scope: r.scope,
                serviceKey: r.serviceKey,
                scenario: r.scenario ? {
                    scenarioId: r.scenario.scenarioId,
                    name: r.scenario.name,
                    triggers: r.scenario.triggers?.slice(0, 5),
                    scenarioType: r.scenario.scenarioType
                } : null,
                validation: r.validation,
                error: r.error
            })),
            // Include full scenarios for ready-to-import items
            fullScenarios: results
                .filter(r => r.readyToImport)
                .map(r => r.scenario)
        });
        
    } catch (error) {
        logger.error('[GENERATE] Error', { companyId, error: error.message });
        return res.status(500).json({ error: 'Generation failed', details: error.message });
    }
});

/**
 * POST /:companyId/coverage/fix-all
 * 
 * One-click: Generate + Import all fixable intents.
 * Combines generate + import in a single operation.
 * 
 * SAFETY: 
 * - Respects scope rules
 * - Only imports readyToImport=true scenarios
 * - Creates audit trail
 */
router.post('/:companyId/coverage/fix-all', async (req, res) => {
    const { companyId } = req.params;
    const { 
        blueprint = 'hvac',
        includeWeak = true,
        includeMissing = true,
        dryRun = false  // If true, generate but don't import
    } = req.body;
    
    try {
        // Step 1: Run coverage assessment
        let blueprintSpec;
        if (blueprint === 'hvac' || blueprint === 'HVAC') {
            blueprintSpec = HVAC_BLUEPRINT_SPEC;
        } else {
            return res.status(400).json({ error: `Unknown blueprint: ${blueprint}` });
        }
        
        const assessor = new CoverageAssessor(blueprintSpec);
        const coverage = await assessor.assess(companyId);
        
        if (coverage.error) {
            return res.status(400).json({ error: coverage.error });
        }
        
        // Step 2: Collect intents to fix
        const intentsToFix = [];
        
        if (includeMissing) {
            for (const intent of (coverage.byStatus?.missing || [])) {
                // Skip companyLocal intents for now (need custom template)
                if (intent.serviceKey) continue;
                
                intentsToFix.push({
                    intentKey: intent.itemKey,
                    action: 'ADD',
                    status: 'MISSING'
                });
            }
        }
        
        if (includeWeak) {
            for (const intent of (coverage.byStatus?.weak || [])) {
                if (intent.serviceKey) continue;
                
                intentsToFix.push({
                    intentKey: intent.itemKey,
                    action: 'REPLACE',
                    existingScenarioId: intent.scenario?.scenarioId,
                    status: 'WEAK'
                });
            }
        }
        
        if (intentsToFix.length === 0) {
            return res.json({
                success: true,
                message: 'Nothing to fix - all intents are covered!',
                coverage: {
                    coveragePercent: coverage.coveragePercent,
                    summary: coverage.summary
                }
            });
        }
        
        // Step 3: Generate scenarios
        const company = await Company.findById(companyId)
            .select('companyName businessName aiAgentSettings.templateReferences')
            .lean();
        
        const generator = new BlueprintGenerator(blueprintSpec, openaiClient);
        const { results, summary: genSummary } = await generator.generateBatch(intentsToFix, {
            batchSize: 5,
            companyContext: {
                companyName: company?.companyName || company?.businessName,
                tone: 'calm_professional'
            }
        });
        
        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                message: `Would fix ${genSummary.readyToImport} intents`,
                generated: genSummary,
                results: results.map(r => ({
                    intentKey: r.intentKey,
                    action: intentsToFix.find(i => i.intentKey === r.intentKey)?.action,
                    readyToImport: r.readyToImport,
                    validation: r.validation
                }))
            });
        }
        
        // Step 4: Import ready scenarios
        const importResults = [];
        const templateRef = company?.aiAgentSettings?.templateReferences?.[0];
        
        if (!templateRef?.templateId) {
            return res.status(400).json({ 
                error: 'Company has no assigned template',
                generated: genSummary
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        for (const result of results) {
            if (!result.readyToImport) {
                importResults.push({
                    intentKey: result.intentKey,
                    imported: false,
                    reason: result.error || 'Validation failed'
                });
                continue;
            }
            
            const intentConfig = intentsToFix.find(i => i.intentKey === result.intentKey);
            const scenario = result.scenario;
            
            // Find target category
            const blueprintItem = findBlueprintItem(result.intentKey);
            let category = template.categories.find(c => 
                c.name?.toLowerCase().includes(blueprintItem?.categoryKey?.replace('hvac-', '').replace(/-/g, ' '))
            ) || template.categories[0];
            
            if (!category) {
                importResults.push({
                    intentKey: result.intentKey,
                    imported: false,
                    reason: 'No suitable category found'
                });
                continue;
            }
            
            // Handle REPLACE - deprecate old
            if (intentConfig.action === 'REPLACE' && intentConfig.existingScenarioId) {
                for (const cat of template.categories) {
                    const existing = cat.scenarios?.find(s => s.scenarioId === intentConfig.existingScenarioId);
                    if (existing) {
                        existing.replacedByScenarioId = scenario.scenarioId;
                        existing.replacedAt = new Date();
                        existing.replacedReason = 'weak_audit_score';
                        existing.isActive = false;
                        break;
                    }
                }
            }
            
            // Add blueprint mapping
            scenario.blueprintItemKey = result.intentKey;
            scenario.blueprintMatchConfidence = 1.0;
            scenario.blueprintMatchedAt = new Date();
            scenario.blueprintMatchSource = 'import_generated';
            scenario.isActive = true;
            scenario.status = 'live';
            
            // Add to category
            if (!category.scenarios) category.scenarios = [];
            category.scenarios.push(scenario);
            
            importResults.push({
                intentKey: result.intentKey,
                imported: true,
                scenarioId: scenario.scenarioId,
                action: intentConfig.action,
                categoryName: category.name
            });
        }
        
        // Save template
        await template.save();
        
        const importedCount = importResults.filter(r => r.imported).length;
        
        logger.info('[FIX-ALL] Complete', {
            companyId,
            generated: genSummary.success,
            imported: importedCount,
            failed: importResults.filter(r => !r.imported).length
        });
        
        return res.json({
            success: true,
            message: `Fixed ${importedCount} intents`,
            generated: genSummary,
            importResults,
            newCoverage: {
                estimated: Math.round(((coverage.summary.good + coverage.summary.weak + importedCount) / coverage.summary.total) * 100)
            }
        });
        
    } catch (error) {
        logger.error('[FIX-ALL] Error', { companyId, error: error.message });
        return res.status(500).json({ error: 'Fix-all failed', details: error.message });
    }
});

/**
 * POST /:companyId/services-config/test
 * 
 * Test the Service Intent Detector with a sample input
 * Useful for debugging and verifying configuration
 */
router.post('/:companyId/services-config/test', async (req, res) => {
    const { companyId } = req.params;
    const { input } = req.body;
    
    if (!input) {
        return res.status(400).json({ error: 'input text is required' });
    }
    
    try {
        // Load services config
        const configResponse = await new Promise((resolve, reject) => {
            const mockReq = { params: { companyId } };
            const mockRes = {
                json: (data) => resolve(data),
                status: (code) => ({ json: (data) => reject(new Error(data.error || 'Error')) })
            };
            // We can't easily call our own route, so let's duplicate the logic
        });
        
        // Load company's services config directly
        const company = await Company.findById(companyId)
            .select('name aiAgentSettings.templateReferences aiAgentSettings.services')
            .lean();
            
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const templateRef = company.aiAgentSettings?.templateReferences?.[0];
        if (!templateRef?.templateId) {
            return res.json({
                success: true,
                detection: { detected: false, reason: 'no_template_assigned' }
            });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId)
            .select('categories.serviceKey categories.isToggleable categories.serviceIntent categories.serviceDecline categories.name')
            .lean();
        
        // Build services config
        const companyServices = company.aiAgentSettings?.services || {};
        const servicesConfig = { services: {} };
        
        for (const cat of (template?.categories || [])) {
            if (!cat.isToggleable || !cat.serviceKey) continue;
            
            const override = companyServices[cat.serviceKey];
            servicesConfig.services[cat.serviceKey] = {
                enabled: override?.enabled !== undefined ? override.enabled : (cat.defaultEnabled !== false),
                keywords: [...(cat.serviceIntent?.keywords || []), ...(override?.overrideKeywords || [])],
                phrases: cat.serviceIntent?.phrases || [],
                negative: cat.serviceIntent?.negative || [],
                minConfidence: cat.serviceIntent?.minConfidence || 0.6,
                declineMessage: override?.overrideDeclineMessage || cat.serviceDecline?.defaultMessage,
                categoryName: cat.name
            };
        }
        
        // Run detection
        const ServiceIntentDetector = require('../../services/ServiceIntentDetector');
        const detection = ServiceIntentDetector.detect(input, servicesConfig);
        
        // Generate decline if applicable
        let declineResponse = null;
        if (detection.detected && !detection.enabled) {
            declineResponse = ServiceIntentDetector.generateDeclineResponse(detection);
        }
        
        logger.info('[SERVICE INTENT TEST]', {
            companyId,
            input: input.substring(0, 50),
            detected: detection.detected,
            serviceKey: detection.serviceKey,
            enabled: detection.enabled
        });
        
        return res.json({
            success: true,
            input,
            detection,
            declineResponse,
            trace: ServiceIntentDetector.buildTraceEntry(detection, companyId)
        });
        
    } catch (error) {
        logger.error('[SERVICE INTENT TEST] Error', { error: error.message, companyId });
        return res.status(500).json({ error: 'Failed to test service intent' });
    }
});

/**
 * POST /services-config/migrate-hvac
 * 
 * Add service toggle configuration to HVAC template categories
 * This is a one-time migration that adds serviceKey, isToggleable, etc.
 */
router.post('/services-config/migrate-hvac', async (req, res) => {
    try {
        const { SERVICE_CONFIG, findServiceConfig } = require('../../scripts/migrations/add-service-keys-to-hvac-template');
        
        // Find HVAC template(s)
        const templates = await GlobalInstantResponseTemplate.find({
            $or: [
                { templateType: { $regex: /hvac/i } },
                { name: { $regex: /hvac/i } }
            ]
        });
        
        if (templates.length === 0) {
            return res.status(404).json({ error: 'No HVAC templates found' });
        }
        
        const results = [];
        
        for (const template of templates) {
            let updated = 0;
            let skipped = 0;
            let alwaysOn = 0;
            const configuredCategories = [];
            
            for (const category of (template.categories || [])) {
                // Use fuzzy matching to find config
                const config = typeof findServiceConfig === 'function' 
                    ? findServiceConfig(category.name)
                    : SERVICE_CONFIG[category.name];
                
                if (config) {
                    if (config.isToggleable === false) {
                        category.isToggleable = false;
                        category.serviceKey = null;
                        alwaysOn++;
                    } else {
                        category.serviceKey = config.serviceKey;
                        category.isToggleable = config.isToggleable;
                        category.defaultEnabled = config.defaultEnabled;
                        category.serviceIntent = config.serviceIntent;
                        category.serviceDecline = config.serviceDecline;
                        
                        configuredCategories.push({
                            name: category.name,
                            serviceKey: config.serviceKey,
                            isToggleable: config.isToggleable,
                            defaultEnabled: config.defaultEnabled
                        });
                        updated++;
                    }
                } else {
                    skipped++;
                }
            }
            
            await template.save();
            
            results.push({
                templateId: template._id,
                templateName: template.name,
                categoriesUpdated: updated,
                categoriesAlwaysOn: alwaysOn,
                categoriesSkipped: skipped,
                configuredCategories
            });
            
            logger.info('[SERVICE MIGRATION] Updated HVAC template', {
                templateId: template._id,
                templateName: template.name,
                updated,
                alwaysOn,
                skipped
            });
        }
        
        return res.json({
            success: true,
            message: `Updated ${templates.length} HVAC template(s)`,
            results
        });
        
    } catch (error) {
        logger.error('[SERVICE MIGRATION] Error', { error: error.message });
        return res.status(500).json({ error: 'Migration failed: ' + error.message });
    }
});

/**
 * PATCH /:companyId/local-config
 * 
 * Update company's custom template assignment and service context
 * SAFEGUARD: Custom templates can only be assigned to ONE company
 */
router.patch('/:companyId/local-config', async (req, res) => {
    const { companyId } = req.params;
    const { customTemplateId, localServiceContext } = req.body;
    
    try {
        const updateFields = {};
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // EXCLUSIVE ASSIGNMENT SAFEGUARD
        // A custom template can only be assigned to ONE company - prevents contamination
        // ═══════════════════════════════════════════════════════════════════════════════
        if (customTemplateId) {
            const template = await GlobalInstantResponseTemplate.findById(customTemplateId);
            
            if (!template) {
                return res.status(404).json({ error: 'Template not found' });
            }
            
            // Check if template is already linked to a DIFFERENT company
            if (template.linkedCompanyId && template.linkedCompanyId !== companyId) {
                // Find the other company's name for a helpful error message
                const otherCompany = await Company.findById(template.linkedCompanyId).select('name').lean();
                const otherCompanyName = otherCompany?.name || 'another company';
                
                logger.warn('[COMPANY LOCAL] Attempted to assign template already linked to another company', {
                    templateId: customTemplateId,
                    templateName: template.name,
                    requestingCompanyId: companyId,
                    linkedToCompanyId: template.linkedCompanyId
                });
                
                return res.status(400).json({ 
                    error: `This template is already assigned to ${otherCompanyName}. Custom templates can only be used by one company.`,
                    linkedCompanyId: template.linkedCompanyId,
                    linkedCompanyName: otherCompanyName
                });
            }
            
            // Mark template as linked to this company (if not already)
            if (!template.linkedCompanyId) {
                template.linkedCompanyId = companyId;
                template.isCompanyCustom = true;
                await template.save();
                
                logger.info('[COMPANY LOCAL] Template linked to company', {
                    templateId: customTemplateId,
                    templateName: template.name,
                    companyId
                });
            }
            
            updateFields['aiAgentSettings.customTemplateId'] = customTemplateId;
        } else if (customTemplateId === null) {
            // Unassigning - clear the link on the template too
            const company = await Company.findById(companyId).select('aiAgentSettings.customTemplateId').lean();
            const oldTemplateId = company?.aiAgentSettings?.customTemplateId;
            
            if (oldTemplateId) {
                await GlobalInstantResponseTemplate.findByIdAndUpdate(oldTemplateId, {
                    $unset: { linkedCompanyId: 1, isCompanyCustom: 1 }
                });
                
                logger.info('[COMPANY LOCAL] Template unlinked from company', {
                    templateId: oldTemplateId,
                    companyId
                });
            }
            
            updateFields['aiAgentSettings.customTemplateId'] = null;
        }
        
        if (localServiceContext !== undefined) {
            updateFields['aiAgentSettings.localServiceContext'] = localServiceContext;
        }
        
        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateFields },
            { new: true }
        ).select('name aiAgentSettings.customTemplateId aiAgentSettings.localServiceContext');
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        logger.info('[COMPANY LOCAL] Company updated', { 
            companyId, 
            customTemplateId: company.aiAgentSettings?.customTemplateId,
            localServiceContext: company.aiAgentSettings?.localServiceContext?.substring(0, 50)
        });
        
        return res.json({
            success: true,
            _id: company._id,
            name: company.name,
            customTemplateId: company.aiAgentSettings?.customTemplateId || null,
            localServiceContext: company.aiAgentSettings?.localServiceContext || ''
        });
    } catch (error) {
        logger.error('[COMPANY LOCAL] Error updating company', { error: error.message, companyId });
        return res.status(500).json({ error: 'Failed to update company' });
    }
});

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
        
        // ════════════════════════════════════════════════════════════════════════
        // FILTER 1: Get dismissed gaps to exclude
        // ════════════════════════════════════════════════════════════════════════
        const dismissedGaps = company.metadata?.dismissedScenarioGaps || [];
        const dismissedPhrases = new Set(
            dismissedGaps.map(d => d.representative?.toLowerCase().trim()).filter(Boolean)
        );
        
        logger.info('[SCENARIO GAPS] Filtering dismissed', { dismissedCount: dismissedPhrases.size });
        
        // ════════════════════════════════════════════════════════════════════════
        // FILTER 2: Get existing scenario triggers to detect duplicates
        // ════════════════════════════════════════════════════════════════════════
        const ScenarioPoolService = require('../../services/ScenarioPoolService');
        let existingTriggers = new Set();
        try {
            const poolResult = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
            if (poolResult.scenarios) {
                for (const scenario of poolResult.scenarios) {
                    const triggers = scenario.triggers || [];
                    for (const trigger of triggers) {
                        if (typeof trigger === 'string') {
                            existingTriggers.add(trigger.toLowerCase().trim());
                        }
                    }
                }
            }
            logger.info('[SCENARIO GAPS] Existing triggers loaded', { triggerCount: existingTriggers.size });
        } catch (poolErr) {
            logger.warn('[SCENARIO GAPS] Could not load scenario pool for duplicate detection:', poolErr.message);
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // BUILD GAPS with dismissal and duplicate checking
        // ════════════════════════════════════════════════════════════════════════
        const minCallsInt = parseInt(minCalls) || CONFIG.MIN_CALLS_FOR_GAP;
        const significantGaps = clusters
            .filter(c => c.totalCalls >= minCallsInt)
            .filter(c => {
                // Skip if dismissed
                const rep = c.representative?.toLowerCase().trim();
                if (dismissedPhrases.has(rep)) {
                    return false;
                }
                return true;
            })
            .map((cluster, index) => {
                // Check for duplicate/similar existing triggers
                const rep = cluster.representative?.toLowerCase().trim() || '';
                const isDuplicate = existingTriggers.has(rep);
                const similarTriggers = [...existingTriggers].filter(t => 
                    t.includes(rep) || rep.includes(t) || 
                    (rep.length > 10 && t.length > 10 && levenshteinSimilarity(rep, t) > 0.7)
                ).slice(0, 3);
                
                return {
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
                    callIds: cluster.callIds.slice(0, 10),
                    // Duplicate detection flags
                    isDuplicate,
                    similarTriggers: similarTriggers.length > 0 ? similarTriggers : undefined,
                    warning: isDuplicate ? 'Exact match exists in scenarios' : 
                             similarTriggers.length > 0 ? `Similar to existing triggers: ${similarTriggers.join(', ')}` : undefined
                };
            })
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
            suggestedPlaceholders: result.suggestedPlaceholders || [],
            tokensUsed: result.tokensUsed
        });
        
    } catch (error) {
        const isPlaceholderError = (error.message || '').startsWith('PLACEHOLDER_INVALID:');
        const cleanedMessage = isPlaceholderError
            ? error.message.replace('PLACEHOLDER_INVALID:', '').trim()
            : error.message;

        logger.error('[SCENARIO GAPS] Error generating preview', { error: error.message });
        res.status(isPlaceholderError ? 400 : 500).json({
            error: isPlaceholderError ? 'Invalid placeholders in generated scenario' : 'Failed to generate scenario preview',
            details: cleanedMessage
        });
    }
});

/**
 * GET /:companyId/manual/meta
 *
 * Returns manual builder options (trade + categories)
 */
router.get('/:companyId/manual/meta', async (req, res) => {
    const { companyId } = req.params;

    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const trades = [];
        const primaryTrade = company.trade ? company.trade.toLowerCase() : null;

        const configTrades = company.aiAgentSettings?.callFlowEngine?.trades || [];
        if (Array.isArray(configTrades) && configTrades.length > 0) {
            configTrades.forEach(t => {
                if (t?.enabled === false) return;
                trades.push({
                    key: String(t.key || '').toLowerCase(),
                    label: t.label || t.key
                });
            });
        }

        if (trades.length === 0 && primaryTrade) {
            trades.push({ key: primaryTrade, label: company.trade });
        }

        res.json({
            success: true,
            primaryTrade,
            trades
        });
    } catch (error) {
        logger.error('[SCENARIO GAPS] Manual meta error', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to load manual options' });
    }
});

/**
 * POST /:companyId/manual/generate
 *
 * Manual Scenario Builder (generate)
 * Body: { userPrompt: string, tradeKey?: string, category?: string, scenarioType?: string }
 */
router.post('/:companyId/manual/generate', async (req, res) => {
    const { companyId } = req.params;
    const { userPrompt, tradeKey, category, scenarioType } = req.body || {};

    if (!userPrompt || !String(userPrompt).trim()) {
        return res.status(400).json({ error: 'userPrompt is required' });
    }

    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const text = String(userPrompt).trim();
        const gap = {
            representative: text,
            examples: [{ text }],
            totalCalls: 1
        };

        const result = await generateScenarioFromGap(gap, company, {
            tradeKeyOverride: tradeKey,
            categoryOverride: category,
            scenarioTypeOverride: scenarioType
        });

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
                message: result.message
            });
        }

        if (result.isDuplicate) {
            return res.json({
                success: true,
                isDuplicate: true,
                duplicateScenarioId: result.duplicateScenarioId,
                duplicateScenarioName: result.duplicateScenarioName,
                duplicateCategory: result.duplicateCategory,
                recommendedAction: result.recommendedAction,
                explanation: result.explanation,
                detectionMethod: result.detectionMethod
            });
        }

        const validationTrade = tradeKey || result.tradeType || company.trade || 'general';
        const validation = buildManualValidation(result.scenario, validationTrade);
        const fieldsGenerated = Object.keys(result.scenario || {});

        return res.json({
            success: true,
            isDuplicate: false,
            generatedScenario: result.scenario,
            validation: {
                ...validation,
                fieldsGenerated
            }
        });
    } catch (error) {
        const isPlaceholderError = (error.message || '').startsWith('PLACEHOLDER_INVALID:');
        const cleanedMessage = isPlaceholderError
            ? error.message.replace('PLACEHOLDER_INVALID:', '').trim()
            : error.message;

        logger.error('[SCENARIO GAPS] Manual generate error', { error: error.message, companyId });
        res.status(isPlaceholderError ? 400 : 500).json({
            error: isPlaceholderError ? 'Invalid placeholders in generated scenario' : 'Failed to generate scenario',
            details: cleanedMessage
        });
    }
});

/**
 * POST /:companyId/generate-local
 *
 * Generate scenario for Company Local tab with custom service context
 * Uses a custom template separate from the global template
 * Body: { question: string, serviceContext: string, templateId: string, categoryId?: string, scenarioType?: string }
 */
router.post('/:companyId/generate-local', async (req, res) => {
    const { companyId } = req.params;
    const { question, serviceContext, templateId, categoryId, scenarioType, allowWarnings } = req.body || {};

    if (!question || !String(question).trim()) {
        return res.status(400).json({ error: 'Question is required' });
    }
    
    if (!serviceContext || !String(serviceContext).trim()) {
        return res.status(400).json({ error: 'Service context is required for GPT-4 to understand what services this company offers' });
    }
    
    if (!templateId) {
        return res.status(400).json({ error: 'Custom template ID is required' });
    }

    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Load the custom template (need the actual model for updates)
        const customTemplate = await GlobalInstantResponseTemplate.findById(templateId);
        if (!customTemplate) {
            return res.status(404).json({ error: 'Custom template not found' });
        }
        
        // Find or determine category
        let targetCategory = null;
        let targetCategoryId = categoryId;
        
        if (categoryId) {
            targetCategory = (customTemplate.categories || []).find(c => 
                (c.id || c._id?.toString()) === categoryId
            );
        }
        
        // Build GPT-4 prompt with custom service context
        const promptText = String(question).trim();
        
        // Ask GPT-4 to also suggest a category if we need to create one
        const existingCategories = (customTemplate.categories || []).map(c => c.name).join(', ') || 'None yet';
        
        const systemPrompt = `You are an expert AI scenario builder for a business phone answering service.

SERVICE CONTEXT (What this company offers):
${serviceContext}

COMPANY: ${company.name}

EXISTING CATEGORIES IN TEMPLATE: ${existingCategories}

Your task is to generate a complete scenario configuration based on a caller question. The scenario should help an AI dispatcher handle calls about the services described above.

DISPATCHER PERSONA:
- Sounds like a SEASONED dispatcher who handles 50+ calls/day
- Calm, confident, experienced - never surprised
- Friendly but NOT chatty - no fluff, no filler
- Every sentence moves toward DIAGNOSIS or BOOKING
- Uses "we" language (team member, not outsider)

Generate a JSON object with these fields:
{
  "name": "Short descriptive name (2-5 words)",
  "suggestedCategory": "Best category name for this scenario (use existing if appropriate, or suggest new)",
  "scenarioType": "${scenarioType || 'One of: FAQ, Booking, Emergency, Transfer, Objection'}",
  "priority": "normal, high, or critical",
  "triggers": ["array of 8-12 trigger phrases callers might say"],
  "quickReplies": ["2-3 short responses (1-2 sentences each)"],
  "fullReplies": ["1-2 detailed responses with placeholders like {{company_name}}"],
  "contextTags": ["relevant tags"],
  "requiresBooking": true/false,
  "isEmergency": true/false,
  "confidenceThreshold": 0.75,
  "confirmBeforeAction": true/false,
  "allowMultiIntent": false,
  "enabled": true,
  "notes": "Brief note about this scenario"
}

Important:
- Triggers should be natural phrases a caller might say
- Quick replies are for simple acknowledgments
- Full replies use placeholders: {{company_name}}, {{service_area}}, {{phone_number}}
- Match the tone to a professional service dispatcher
- For suggestedCategory: use an existing category if it fits, otherwise suggest a clear, descriptive name`;

        const userMessage = `Generate a scenario for this caller question: "${promptText}"

${targetCategory ? `Use this category: ${targetCategory.name}` : 'Suggest the best category based on the service context.'}`;

        // Call GPT-4
        const openaiClient = getOpenAIClient();
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            response_format: { type: 'json_object' }
        });
        
        const responseText = completion.choices[0]?.message?.content || '{}';
        let scenario;
        
        try {
            scenario = JSON.parse(responseText);
        } catch (parseError) {
            logger.error('[GENERATE LOCAL] Failed to parse GPT-4 response', { responseText });
            return res.status(500).json({ error: 'Failed to parse AI response' });
        }
        
        // Add required fields
        scenario.scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        scenario.createdAt = new Date().toISOString();
        scenario.source = 'company-local-builder';
        scenario.sourceQuestion = promptText;
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // AUTO-CREATE CATEGORY IF NEEDED
        // This is safe because it's a company-local template, not global
        // ═══════════════════════════════════════════════════════════════════════════════
        const suggestedCategoryName = scenario.suggestedCategory || 'Custom Services';
        delete scenario.suggestedCategory; // Remove from scenario object before saving
        
        let categoryName = suggestedCategoryName;
        let categoryCreated = false;
        
        if (!targetCategoryId) {
            // Check if suggested category already exists
            const existingCat = (customTemplate.categories || []).find(c => 
                c.name?.toLowerCase() === suggestedCategoryName.toLowerCase()
            );
            
            if (existingCat) {
                targetCategoryId = existingCat.id || existingCat._id?.toString();
                categoryName = existingCat.name;
                logger.info('[GENERATE LOCAL] Using existing category', { categoryName: existingCat.name });
            } else {
                // Auto-create the category
                const newCategoryId = `cat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newCategory = {
                    id: newCategoryId,
                    name: suggestedCategoryName,
                    description: `Auto-created for ${company.name} local scenarios`,
                    icon: '📋',
                    scenarios: [],
                    createdAt: new Date()
                };
                
                // Add to template
                if (!customTemplate.categories) {
                    customTemplate.categories = [];
                }
                customTemplate.categories.push(newCategory);
                await customTemplate.save();
                
                targetCategoryId = newCategoryId;
                categoryName = suggestedCategoryName;
                categoryCreated = true;
                logger.info('[GENERATE LOCAL] Auto-created category', { 
                    categoryName: suggestedCategoryName, 
                    categoryId: newCategoryId,
                    templateId 
                });
            }
        } else if (targetCategory) {
            categoryName = targetCategory.name;
        }
        
        // Basic validation
        const validation = {
            isValid: true,
            errors: [],
            warnings: []
        };
        
        if (!scenario.name) validation.errors.push('Missing scenario name');
        if (!scenario.triggers || scenario.triggers.length === 0) validation.errors.push('Missing triggers');
        if (!scenario.quickReplies || scenario.quickReplies.length === 0) validation.warnings.push('No quick replies generated');
        
        if (validation.errors.length > 0 && !allowWarnings) {
            validation.isValid = false;
        }
        
        logger.info('[GENERATE LOCAL] Scenario generated successfully', {
            companyId,
            templateId,
            scenarioName: scenario.name,
            categoryId: targetCategoryId
        });
        
        return res.json({
            success: true,
            scenario,
            categoryId: targetCategoryId,
            categoryName,
            categoryCreated,
            validation,
            tokensUsed: completion.usage?.total_tokens || 0
        });
        
    } catch (error) {
        logger.error('[GENERATE LOCAL] Error generating scenario', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to generate scenario', details: error.message });
    }
});

/**
 * POST /:companyId/gaps/manual/preview
 *
 * Manual Scenario Builder preview (content-only)
 * Body: { question: string, category?: string, scenarioType?: string }
 */
router.post('/:companyId/gaps/manual/preview', async (req, res) => {
    const { companyId } = req.params;
    const { question, category, scenarioType, tradeKey } = req.body || {};

    if (!question || !String(question).trim()) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const text = String(question).trim();
        const gap = {
            representative: text,
            examples: [{ text }],
            totalCalls: 1
        };

        const result = await generateScenarioFromGap(gap, company, {
            tradeKeyOverride: tradeKey,
            categoryOverride: category,
            scenarioTypeOverride: scenarioType
        });

        if (result.error) {
            return res.status(400).json({
                success: false,
                error: result.error,
                message: result.message
            });
        }

        if (result.isDuplicate) {
            return res.json({
                success: true,
                isDuplicate: true,
                duplicateScenarioId: result.duplicateScenarioId,
                duplicateScenarioName: result.duplicateScenarioName,
                duplicateCategory: result.duplicateCategory,
                recommendedAction: result.recommendedAction,
                explanation: result.explanation,
                detectionMethod: result.detectionMethod
            });
        }

        const validationTrade = tradeKey || result.tradeType || company.trade || 'general';
        const validation = buildManualValidation(result.scenario, validationTrade);
        const fieldsGenerated = Object.keys(result.scenario || {});

        return res.json({
            success: true,
            isDuplicate: false,
            preview: result.scenario,
            validation: {
                ...validation,
                fieldsGenerated
            }
        });
    } catch (error) {
        const isPlaceholderError = (error.message || '').startsWith('PLACEHOLDER_INVALID:');
        const cleanedMessage = isPlaceholderError
            ? error.message.replace('PLACEHOLDER_INVALID:', '').trim()
            : error.message;

        logger.error('[SCENARIO GAPS] Manual preview error', { error: error.message, companyId });
        res.status(isPlaceholderError ? 400 : 500).json({
            error: isPlaceholderError ? 'Invalid placeholders in generated scenario' : 'Failed to generate scenario preview',
            details: cleanedMessage
        });
    }
});

/**
 * POST /:companyId/gaps/manual/save
 *
 * Save Manual Scenario Builder draft (content-only)
 * Body: { scenario: object, allowWarnings?: boolean }
 */
async function handleManualSave(req, res) {
    const { companyId } = req.params;
    const { scenario, allowWarnings = false, tradeKey } = req.body || {};

    if (!scenario) {
        return res.status(400).json({ error: 'Scenario object is required' });
    }

    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const { template, error: templateError } = await getCompanyTemplate(company, { lean: false });
        if (templateError) {
            return res.status(400).json({
                success: false,
                error: templateError.code,
                message: templateError.message,
                fix: templateError.fix
            });
        }

        const scenarioCategory = scenario.categories?.[0] || scenario.category || 'General';

        const scenarioId = scenario.scenarioId || `scenario-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        const baseScenario = {
            ...scenario,
            scenarioId,
            status: 'draft',
            isActive: true,
            categories: [scenarioCategory],
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'manual-scenario-builder',
            source: 'manual-scenario-builder',
            sourceGap: null
        };
        delete baseScenario.category;

        const { sanitized } = enforceContentOwnership(baseScenario, {
            source: 'manual-scenario-builder',
            logWarnings: false
        });

        const validationTrade = tradeKey || template.templateType?.toLowerCase() || company.trade || 'general';
        const validation = buildManualValidation(sanitized, validationTrade);

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid placeholders in scenario',
                validation
            });
        }

        if (!allowWarnings && validation.warnings?.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Scenario has warnings',
                validation
            });
        }

        // Find or create the category
        let categoryDoc = template.categories.find(c =>
            c.name.toLowerCase() === scenarioCategory.toLowerCase()
        );

        if (!categoryDoc) {
            categoryDoc = {
                name: scenarioCategory,
                description: `Auto-created category for ${scenarioCategory} scenarios`,
                scenarios: [],
                createdAt: new Date()
            };
            template.categories.push(categoryDoc);
        }

        const categoryIndex = template.categories.findIndex(c => c.name === categoryDoc.name);
        template.categories[categoryIndex].scenarios.push(sanitized);

        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        await GlobalInstantResponseTemplate.updateOne(
            { _id: template._id },
            {
                $set: {
                    [`categories.${categoryIndex}.scenarios`]: template.categories[categoryIndex].scenarios,
                    updatedAt: new Date()
                }
            }
        );

        return res.json({
            success: true,
            scenarioId,
            category: scenarioCategory,
            message: 'Draft scenario saved'
        });
    } catch (error) {
        logger.error('[SCENARIO GAPS] Manual save error', { error: error.message, companyId });
        return res.status(500).json({
            error: 'Failed to save manual scenario',
            details: error.message
        });
    }
}

router.post('/:companyId/manual/save', async (req, res) => {
    return handleManualSave(req, res);
});

router.post('/:companyId/gaps/manual/save', async (req, res) => {
    return handleManualSave(req, res);
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
        let scenarioCategory;
        let suggestedPlaceholders = [];
        
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
            scenarioCategory = result.category || scenarioData?.categories?.[0] || 'FAQ';
            suggestedPlaceholders = result.suggestedPlaceholders || [];
        }

        if (!scenarioCategory) {
            scenarioCategory = scenarioData?.category || scenarioData?.categories?.[0] || 'FAQ';
        }
        
        // Find or create the category
        let categoryDoc = template.categories.find(c =>
            c.name.toLowerCase() === scenarioCategory.toLowerCase()
        );
        
        if (!categoryDoc) {
            // Create new category
            categoryDoc = {
                name: scenarioCategory,
                description: `Auto-created category for ${scenarioCategory} scenarios`,
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

        const placeholderValidation = validateScenarioPlaceholders(newScenario, company.trade);
        if (!placeholderValidation.valid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid placeholders in generated scenario',
                message: placeholderValidation.message,
                errors: {
                    forbiddenLegacy: placeholderValidation.forbiddenLegacy,
                    unknownInvalid: placeholderValidation.unknownInvalid
                }
            });
        }
        
        // Add scenario to category
        const categoryIndex = template.categories.findIndex(c => c.name === categoryDoc.name);
        if (categoryIndex >= 0) {
            template.categories[categoryIndex].scenarios.push(newScenario);
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // Save using updateOne to bypass full document validation
        // This avoids triggering validation on unrelated legacy fields
        // ════════════════════════════════════════════════════════════════════════
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        await GlobalInstantResponseTemplate.updateOne(
            { _id: template._id },
            { 
                $set: { 
                    [`categories.${categoryIndex}.scenarios`]: template.categories[categoryIndex].scenarios,
                    updatedAt: new Date()
                }
            }
        );
        
        // Add suggested placeholders to company if provided
        if (suggestedPlaceholders && suggestedPlaceholders.length > 0) {
            const existingPlaceholders = company.placeholders || {};
            let placeholdersAdded = 0;
            
            for (const ph of suggestedPlaceholders) {
                if (!existingPlaceholders[ph.key]) {
                    existingPlaceholders[ph.key] = ph.exampleValue || `[Set ${ph.key}]`;
                    placeholdersAdded++;
                }
            }
            
            if (placeholdersAdded > 0) {
                // Use updateOne to bypass validation on unrelated fields
                await Company.updateOne(
                    { _id: companyId },
                    { $set: { placeholders: existingPlaceholders } }
                );
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
            suggestedPlaceholders
        });
        
    } catch (error) {
        const isPlaceholderError = (error.message || '').startsWith('PLACEHOLDER_INVALID:');
        const cleanedMessage = isPlaceholderError
            ? error.message.replace('PLACEHOLDER_INVALID:', '').trim()
            : error.message;

        logger.error('[SCENARIO GAPS] Error creating scenario', { error: error.message, companyId });
        res.status(isPlaceholderError ? 400 : 500).json({
            error: isPlaceholderError ? 'Invalid placeholders in generated scenario' : 'Failed to create scenario',
            details: cleanedMessage
        });
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
        
        // Find the category and scenario with indices for targeted update
        let found = false;
        let addedCount = 0;
        let existingTriggers = [];
        let categoryIndex = -1;
        let scenarioIndex = -1;
        let updatedTriggers = [];
        
        for (let ci = 0; ci < (template.categories || []).length; ci++) {
            const category = template.categories[ci];
            if (category.name !== categoryName) continue;
            
            for (let si = 0; si < (category.scenarios || []).length; si++) {
                const scenario = category.scenarios[si];
                const matchById = scenarioId && scenario._id?.toString() === scenarioId;
                const matchByName = scenario.name === scenarioName;
                
                if (matchById || matchByName) {
                    existingTriggers = scenario.triggers || [];
                    updatedTriggers = [...existingTriggers];
                    
                    // Add new triggers that don't already exist
                    const existingSet = new Set(existingTriggers.map(t => t.toLowerCase()));
                    
                    for (const trigger of (newTriggers || [])) {
                        const normalized = trigger.toLowerCase().trim();
                        if (normalized && !existingSet.has(normalized)) {
                            updatedTriggers.push(trigger.trim());
                            existingSet.add(normalized);
                            addedCount++;
                        }
                    }
                    
                    categoryIndex = ci;
                    scenarioIndex = si;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        
        if (!found) {
            return res.status(404).json({ error: 'Scenario not found in template' });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // Save using updateOne to bypass full document validation
        // This avoids triggering validation on unrelated legacy fields
        // ════════════════════════════════════════════════════════════════════════
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        await GlobalInstantResponseTemplate.updateOne(
            { _id: template._id },
            { 
                $set: { 
                    [`categories.${categoryIndex}.scenarios.${scenarioIndex}.triggers`]: updatedTriggers,
                    updatedAt: new Date()
                }
            }
        );
        
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
        // Use updateOne to avoid full document validation
        // This prevents failures from unrelated schema issues in the company doc
        const dismissEntry = {
            representative,
            reason: reason || 'User dismissed',
            dismissedAt: new Date()
        };
        
        // First, push the new dismissed gap
        await Company.updateOne(
            { _id: companyId },
            { 
                $push: { 
                    'metadata.dismissedScenarioGaps': {
                        $each: [dismissEntry],
                        $slice: -100  // Keep only last 100
                    }
                }
            }
        );
        
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

// ════════════════════════════════════════════════════════════════════════════════
// UNIFIED AUDIT - Three layers, one registry
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /:companyId/audit
 * 
 * Unified audit with three layers:
 * - Content Audit: validates ownership=content fields in scenarios
 * - Runtime Audit: validates ownership=runtime fields via blackbox proof
 * - Admin Audit: validates ownership=admin fields in company config
 * 
 * Query params:
 * - mode: 'content' | 'runtime' | 'admin' | 'all' (default: 'all')
 * - source: 'activePool' | 'templates' | 'company' (default: 'activePool')
 *   - activePool: What runtime actually reads (best for production truth)
 *   - templates: Global templates only
 *   - company: Company-specific overrides only
 * - hours: time window for runtime proof (default: 24)
 */
router.get('/:companyId/audit', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { mode = 'all', source = 'activePool', hours = '24' } = req.query;
        
        logger.info(`[UNIFIED AUDIT] Running ${mode} audit for ${companyId} (source: ${source})`);
        
        const result = await runUnifiedAudit(companyId, {
            mode,
            scenarioSource: source,
            timeWindowHours: parseInt(hours)
        });
        
        res.json(result);
        
    } catch (error) {
        logger.error('[UNIFIED AUDIT] Error:', { error: error.message, stack: error.stack });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
 * Build service-aware audit scope
 * 
 * Returns scenarios bucketed by:
 * - enabled: Template scenarios from enabled service categories (AUDIT THESE)
 * - disabled: Template scenarios from disabled service categories (EXCLUDE, LABEL)
 * - companyLocal: Company Local template scenarios (AUDIT THESE)
 * 
 * This matches runtime truth: Template + Company Overlay + Service Toggles
 */
async function buildServiceAwareAuditScope(company) {
    const companyId = company._id?.toString();
    const companyServices = company.aiAgentSettings?.services || {};
    const customTemplateId = company.aiAgentSettings?.customTemplateId;
    
    // Get main template
    const { template, error } = await getCompanyTemplate(company, { populateCategories: true });
    if (error) {
        return { error };
    }
    
    // Build enabled/disabled service keys set
    const disabledServiceKeys = new Set();
    const disabledCategoryIds = new Set();
    
    for (const category of (template.categories || [])) {
        if (!category.isToggleable || !category.serviceKey) continue;
        
        // Check if service is disabled
        const override = companyServices[category.serviceKey];
        const isEnabled = override?.enabled !== undefined 
            ? override.enabled 
            : (category.defaultEnabled !== false);
        
        if (!isEnabled) {
            disabledServiceKeys.add(category.serviceKey);
            disabledCategoryIds.add(category.id || category._id?.toString());
        }
    }
    
    // Bucket template scenarios
    const enabledScenarios = [];
    const disabledScenarios = [];
    
    for (const category of (template.categories || [])) {
        const categoryId = category.id || category._id?.toString();
        const isDisabled = disabledCategoryIds.has(categoryId);
        
        for (const scenario of (category.scenarios || [])) {
            const scenarioData = {
                ...scenario,
                scenarioId: scenario.scenarioId || scenario._id?.toString(),
                categoryId: categoryId,
                categoryName: category.name,
                categoryIcon: category.icon,
                serviceKey: category.serviceKey,
                source: 'main_template'
            };
            
            if (isDisabled) {
                scenarioData.excludeReason = 'service_disabled';
                scenarioData.excludeLabel = `Service disabled: ${category.name}`;
                disabledScenarios.push(scenarioData);
            } else {
                enabledScenarios.push(scenarioData);
            }
        }
    }
    
    // Get Company Local scenarios (if custom template assigned)
    const companyLocalScenarios = [];
    let customTemplate = null;
    
    if (customTemplateId) {
        customTemplate = await GlobalInstantResponseTemplate.findById(customTemplateId).lean();
        
        if (customTemplate) {
            for (const category of (customTemplate.categories || [])) {
                for (const scenario of (category.scenarios || [])) {
                    companyLocalScenarios.push({
                        ...scenario,
                        scenarioId: scenario.scenarioId || scenario._id?.toString(),
                        categoryId: category.id || category._id?.toString(),
                        categoryName: category.name,
                        categoryIcon: category.icon,
                        source: 'company_local',
                        customTemplateId: customTemplateId,
                        customTemplateName: customTemplate.name
                    });
                }
            }
        }
    }
    
    logger.info('[AUDIT SCOPE] Built service-aware scope', {
        companyId,
        templateName: template.name,
        enabled: enabledScenarios.length,
        disabled: disabledScenarios.length,
        companyLocal: companyLocalScenarios.length,
        disabledServices: Array.from(disabledServiceKeys)
    });
    
    return {
        template,
        customTemplate,
        scope: {
            enabled: enabledScenarios,
            disabled: disabledScenarios,
            companyLocal: companyLocalScenarios
        },
        stats: {
            enabledCount: enabledScenarios.length,
            disabledCount: disabledScenarios.length,
            companyLocalCount: companyLocalScenarios.length,
            totalAuditable: enabledScenarios.length + companyLocalScenarios.length,
            disabledServices: Array.from(disabledServiceKeys)
        }
    };
}

/**
 * POST /:companyId/audit/run
 * 
 * Run full audit on company's ACTUAL runtime brain:
 * - Template scenarios (filtered by enabled services)
 * - Company Local scenarios
 * - Disabled services labeled but not audited
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
        
        // Build service-aware audit scope
        const auditScope = await buildServiceAwareAuditScope(company);
        
        if (auditScope.error) {
            return res.status(400).json({
                error: auditScope.error.message,
                code: auditScope.error.code,
                fix: auditScope.error.fix
            });
        }
        
        const { template, scope, stats } = auditScope;
        
        // Combine enabled + company local for audit
        let scenariosToAudit = [...scope.enabled, ...scope.companyLocal];
        
        // Filter by category if specified
        if (category) {
            scenariosToAudit = scenariosToAudit.filter(s => 
                s.categoryId === category || s.categoryName === category
            );
        }
        
        // Run audit on the filtered scenarios
        const engine = new AuditEngine({ logger });
        const report = await engine.auditScenarios(scenariosToAudit, template, {
            rules: ruleIds
        });
        
        // Add source labels to results
        if (report.scenarios) {
            for (const result of report.scenarios) {
                const original = scenariosToAudit.find(s => 
                    s.scenarioId === result.scenarioId
                );
                if (original) {
                    result.source = original.source;
                    result.customTemplateName = original.customTemplateName;
                }
            }
        }
        
        // Build bucketed summary
        const templateResults = (report.scenarios || []).filter(s => s.source === 'main_template');
        const companyLocalResults = (report.scenarios || []).filter(s => s.source === 'company_local');
        
        logger.info('[AUDIT] Completed service-aware audit', {
            companyId,
            templateId: template._id,
            templateType: template.templateType,
            enabled: stats.enabledCount,
            disabled: stats.disabledCount,
            companyLocal: stats.companyLocalCount,
            audited: scenariosToAudit.length,
            violations: report.summary?.totalViolations,
            healthScore: report.summary?.healthScore
        });
        
        res.json({
            success: true,
            companyId,
            templateId: template._id,
            templateType: template.templateType,
            customTemplateId: auditScope.customTemplate?._id,
            customTemplateName: auditScope.customTemplate?.name,
            
            // Service-aware scope info
            auditScope: {
                enabled: stats.enabledCount,
                disabled: stats.disabledCount,
                companyLocal: stats.companyLocalCount,
                totalAuditable: stats.totalAuditable,
                disabledServices: stats.disabledServices
            },
            
            // Excluded scenarios (for display, not audited)
            excludedScenarios: scope.disabled.map(s => ({
                scenarioId: s.scenarioId,
                name: s.name,
                categoryName: s.categoryName,
                excludeReason: s.excludeReason,
                excludeLabel: s.excludeLabel
            })),
            
            // Bucketed results
            buckets: {
                mainTemplate: {
                    count: templateResults.length,
                    passing: templateResults.filter(s => !s.violations?.length).length,
                    failing: templateResults.filter(s => s.violations?.length > 0).length,
                    scenarios: templateResults
                },
                companyLocal: {
                    count: companyLocalResults.length,
                    passing: companyLocalResults.filter(s => !s.violations?.length).length,
                    failing: companyLocalResults.filter(s => s.violations?.length > 0).length,
                    scenarios: companyLocalResults
                },
                disabled: {
                    count: scope.disabled.length,
                    services: stats.disabledServices,
                    message: `${scope.disabled.length} scenarios excluded (service disabled)`
                }
            },
            
            // Full report for backward compatibility
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

// ════════════════════════════════════════════════════════════════════════════════
// POST /:companyId/audit/deep
// 
// GPT-4 POWERED DEEP AUDIT - Comprehensive AI review of scenarios
// This catches nuanced issues that deterministic rules miss:
// - Awkward phrasing
// - Tone inconsistencies  
// - Responses that technically pass but sound robotic
// - Missing warmth where needed
// - Verbose responses even if under word limit
// - Classification questions that don't help classify
// 
// Cost: ~$0.02-0.05 per scenario (use on-demand, not automated)
// 
// Supports streaming progress via SSE when stream=true query param is set
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/audit/deep', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioIds, category, maxScenarios = 50, stream = false, listOnly = false, templateId: providedTemplateId } = req.body;
    
    // Set up SSE if streaming requested
    const isStreaming = stream === true || stream === 'true';
    if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.flushHeaders();
    }
    
    // Helper to send SSE events with explicit flush
    const sendProgress = (data) => {
        if (isStreaming) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            // Force flush to ensure data is sent immediately
            if (res.flush) {
                res.flush();
            }
        }
    };
    
    // Send initial connection confirmation immediately
    if (isStreaming) {
        res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`);
        if (res.flush) res.flush();
    }
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            if (isStreaming) {
                sendProgress({ type: 'error', message: 'Company not found' });
                res.end();
            } else {
                res.status(404).json({ error: 'Company not found' });
            }
            return;
        }
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // USE SERVICE-AWARE AUDIT SCOPE
        // Matches runtime truth: Template + Company Local + Service Toggles
        // ═══════════════════════════════════════════════════════════════════════════════
        const auditScope = await buildServiceAwareAuditScope(company);
        
        if (auditScope.error) {
            if (isStreaming) {
                sendProgress({ type: 'error', message: auditScope.error.message });
                res.end();
            } else {
                res.status(400).json({ error: auditScope.error.message });
            }
            return;
        }
        
        const { template, scope, stats } = auditScope;
        const tradeType = template.templateType?.toLowerCase() || 'general';
        
        // Combine enabled + company local for audit (same as Template Audit)
        let scenariosToAudit = [...scope.enabled, ...scope.companyLocal];
        
        // Filter by category if specified
        if (category) {
            scenariosToAudit = scenariosToAudit.filter(s => 
                s.categoryId === category || s.categoryName === category
            );
        }
        
        // Filter by specific scenario IDs if provided
        if (scenarioIds && scenarioIds.length > 0) {
            scenariosToAudit = scenariosToAudit.filter(s => 
                scenarioIds.includes(s.scenarioId) || scenarioIds.includes(s._id?.toString())
            );
        }
        
        // Limit to prevent runaway costs
        if (scenariosToAudit.length > maxScenarios) {
            scenariosToAudit = scenariosToAudit.slice(0, maxScenarios);
        }
        
        const totalCount = scenariosToAudit.length;
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // LIST ONLY MODE: Return just the scenario IDs for batch processing
        // ═══════════════════════════════════════════════════════════════════════════════
        if (listOnly) {
            logger.info('[DEEP AUDIT] List-only mode - returning service-aware scenario IDs', {
                companyId,
                templateId: template._id,
                enabled: stats.enabledCount,
                disabled: stats.disabledCount,
                companyLocal: stats.companyLocalCount,
                scenarioCount: totalCount
            });
            
            // Build scenario metadata for filtering
            const scenarioMetadata = {};
            for (const s of scenariosToAudit) {
                const id = s.scenarioId || s._id?.toString();
                scenarioMetadata[id] = {
                    categoryId: s.categoryId,
                    categoryName: s.categoryName,
                    source: s.source
                };
            }
            
            return res.json({
                success: true,
                listOnly: true,
                templateId: template._id?.toString(),
                customTemplateId: auditScope.customTemplate?._id?.toString(),
                scenarioIds: scenariosToAudit.map(s => s.scenarioId || s._id?.toString()),
                scenarioMetadata,
                totalCount: totalCount,
                tradeType: tradeType,
                
                // Service-aware scope info
                auditScope: {
                    enabled: stats.enabledCount,
                    disabled: stats.disabledCount,
                    companyLocal: stats.companyLocalCount,
                    totalAuditable: stats.totalAuditable,
                    disabledServices: stats.disabledServices
                },
                
                // Excluded scenarios list
                excludedScenarios: scope.disabled.map(s => ({
                    scenarioId: s.scenarioId,
                    name: s.name,
                    categoryName: s.categoryName,
                    excludeReason: s.excludeReason
                }))
            });
        }
        
        logger.info('[DEEP AUDIT] Starting GPT-4 deep audit', {
            companyId,
            templateId: template._id,
            scenarioCount: totalCount,
            tradeType,
            streaming: isStreaming
        });
        
        // Send initial progress
        sendProgress({ 
            type: 'start', 
            total: totalCount,
            message: `Starting deep audit of ${totalCount} scenarios...`
        });
        
        const results = [];
        let totalTokens = 0;
        let perfect = 0;
        let needsWork = 0;
        let processed = 0;
        let consecutiveErrors = 0;
        const MAX_CONSECUTIVE_ERRORS = 5;
        
        // Keepalive interval to prevent connection timeout (5 seconds for aggressive keep-alive)
        let keepaliveInterval;
        if (isStreaming) {
            keepaliveInterval = setInterval(() => {
                try {
                    res.write(`: keepalive ${Date.now()}\n\n`);
                    if (res.flush) res.flush();
                } catch (e) {
                    // Connection closed
                    clearInterval(keepaliveInterval);
                }
            }, 5000); // Every 5 seconds - more aggressive to prevent proxy timeouts
        }
        
        // Disable request timeout for this long-running request
        req.setTimeout(0);
        res.setTimeout(0);
        
        // ════════════════════════════════════════════════════════════════════════════
        // AUDIT PROFILE SYSTEM: Get or create active profile
        // This is the "standards contract" that makes "done" deterministic
        // ════════════════════════════════════════════════════════════════════════════
        const deepAuditService = require('../../services/deepAudit');
        const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
        
        const templateIdStr = template._id?.toString();
        const auditProfile = await deepAuditService.getActiveAuditProfile(templateIdStr);
        const auditProfileId = auditProfile._id.toString();
        
        logger.info('[DEEP AUDIT] Using audit profile', {
            auditProfileId,
            profileName: auditProfile.name,
            rubricVersion: auditProfile.rubricVersion
        });
        
        sendProgress({
            type: 'profile',
            auditProfile: {
                id: auditProfileId,
                name: auditProfile.name,
                rubricVersion: auditProfile.rubricVersion
            },
            message: `Using audit profile: ${auditProfile.name}`
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // BLUEPRINT-AWARE AUDIT: Create matcher for intent lookup
        // ════════════════════════════════════════════════════════════════════════════
        const matcher = new IntentMatcher(HVAC_BLUEPRINT_SPEC);
        
        let cachedCount = 0;
        
        for (const scenario of scenariosToAudit) {
            // Check if we've hit too many consecutive errors (likely API issue)
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                logger.error('[DEEP AUDIT] Too many consecutive errors, stopping', { consecutiveErrors });
                sendProgress({
                    type: 'error',
                    message: `Stopped after ${consecutiveErrors} consecutive errors. Processed ${processed}/${totalCount} scenarios.`
                });
                break;
            }
            
            try {
                // ════════════════════════════════════════════════════════════════
                // PROFILE-BASED CACHING: Check ScenarioAuditResult collection
                // Cache key: templateId + scenarioId + auditProfileId + contentHash
                // ════════════════════════════════════════════════════════════════
                const scenarioId = scenario.scenarioId || scenario._id?.toString();
                const contentHash = deepAuditService.hashScenarioContent(scenario);
                
                // Check for cached result in ScenarioAuditResult collection
                const cachedResult = await ScenarioAuditResult.findCached({
                    templateId: templateIdStr,
                    scenarioId,
                    auditProfileId,
                    scenarioContentHash: contentHash
                });
                
                if (cachedResult) {
                    // Valid cache hit - reuse result, no GPT call
                    cachedCount++;
                    processed++;
                    
                    const cachedScore = cachedResult.score;
                    if (cachedScore >= 9 && cachedResult.verdict !== 'NEEDS_WORK') perfect++;
                    else if (cachedScore < 7 || cachedResult.verdict === 'NEEDS_WORK') needsWork++;
                    
                    results.push({
                        scenarioId,
                        name: scenario.name,
                        scenarioType: scenario.scenarioType,
                        category: scenario.categoryName,
                        categoryId: scenario.categoryId,
                        templateId: templateIdStr,
                        auditProfileId,
                        score: cachedScore,
                        verdict: cachedResult.verdict,
                        issues: cachedResult.issues || [],
                        strengths: cachedResult.strengths || [],
                        rewriteNeeded: cachedResult.rewriteNeeded || cachedScore < 7,
                        cached: true,
                        cacheNote: `Cached under profile: ${auditProfile.name}`,
                        contentHash,
                        blueprintMatch: cachedResult.blueprintItemKey,
                        intentFulfilled: cachedResult.intentFulfilled
                    });
                    
                    sendProgress({
                        type: 'progress',
                        current: processed,
                        total: totalCount,
                        percent: Math.round((processed / totalCount) * 100),
                        scenario: { name: scenario.name, score: cachedScore, verdict: 'CACHED' },
                        message: `${processed}/${totalCount}: "${scenario.name}" → ${cachedScore}/10 (cached)`
                    });
                    
                    continue;
                }
                // ════════════════════════════════════════════════════════════════
                // Get blueprint context for this scenario
                // CRITICAL: Only use blueprint if we have HIGH confidence match
                // Wrong intent = worse than no intent
                // ════════════════════════════════════════════════════════════════
                let blueprintIntent = null;
                let blueprintContext = '';
                let matchConfidence = null;
                let matchSource = null;
                
                // PRIORITY 1: Explicit mapping (from generation or manual assignment)
                // These are trusted - never override
                if (scenario.blueprintItemKey) {
                    blueprintIntent = findBlueprintItem(scenario.blueprintItemKey);
                    matchSource = 'explicit_mapping';
                    matchConfidence = 1.0;
                }
                
                // PRIORITY 2: Auto-match ONLY if confidence >= 0.75 (high threshold)
                // Low confidence matches cause more harm than good
                if (!blueprintIntent) {
                    const matchResult = matcher.match(scenario);
                    
                    // Only use match if:
                    // 1. High confidence (>= 0.75)
                    // 2. Category aligns (prevents "Emergency" matching to "greeting")
                    const categoryAligns = matchResult.matchedItemKey && 
                        (scenario.categoryName?.toLowerCase().includes(
                            matchResult.matchedItemKey?.replace('hvac_', '').split('_')[0]
                        ) || matchResult.confidence >= 0.85);
                    
                    if (matchResult.matched && matchResult.confidence >= 0.75 && categoryAligns) {
                        blueprintIntent = findBlueprintItem(matchResult.matchedItemKey);
                        matchSource = 'auto_match';
                        matchConfidence = matchResult.confidence;
                    } else if (matchResult.matched && matchResult.confidence >= 0.5) {
                        // Log low-confidence matches for debugging
                        logger.info('[DEEP AUDIT] Skipping low-confidence match', {
                            scenarioName: scenario.name,
                            scenarioCategory: scenario.categoryName,
                            wouldMatchTo: matchResult.matchedItemKey,
                            confidence: matchResult.confidence,
                            reason: 'Below 0.75 threshold or category mismatch'
                        });
                    }
                }
                
                // Build blueprint context
                if (blueprintIntent) {
                    blueprintContext = `
═══════════════════════════════════════════════════════════════════════════════
BLUEPRINT INTENT (This scenario's PURPOSE):
Intent: ${blueprintIntent.name} (${blueprintIntent.itemKey})
Type: ${blueprintIntent.scenarioType} | Goal: ${blueprintIntent.replyGoal || 'classify'}
Booking: ${blueprintIntent.bookingIntent ? 'YES' : 'NO'}
Expected Triggers: ${(blueprintIntent.triggerHints || []).slice(0, 5).join(', ')}
Notes: ${blueprintIntent.notes || 'N/A'}

CRITICAL: Score based on how well this scenario fulfills this specific intent!
═══════════════════════════════════════════════════════════════════════════════
`;
                }
                
                const auditPrompt = `You are a SENIOR QA AUDITOR reviewing AI dispatcher scenarios for a ${tradeType.toUpperCase()} service company.

SCENARIO TO AUDIT:
Name: ${scenario.name}
Type: ${scenario.scenarioType || 'FAQ'}
Category: ${scenario.categoryName}
Triggers: ${(scenario.triggers || []).slice(0, 5).join(', ')}

Quick Replies (short responses):
${(scenario.quickReplies || []).map((r, i) => `${i + 1}. "${r}"`).join('\n') || '(none)'}

Full Replies (detailed responses):
${(scenario.fullReplies || []).map((r, i) => `${i + 1}. "${r}"`).join('\n') || '(none)'}
${blueprintContext}
DISPATCHER PERSONA STANDARDS:
- Sounds like a SEASONED dispatcher who handles 50+ calls/day
- Calm, confident, experienced - never surprised
- Friendly but NOT chatty - no fluff, no filler  
- Every sentence moves toward DIAGNOSIS or BOOKING
- Empathy in 3 words max: "I understand." "Alright." "Okay."
- Quick replies: Under 15 words, ONE diagnostic question
- Full replies: Under 25 words, moves toward booking

AUTOMATIC FAILURES:
- Chatbot phrases: "wonderful to hear", "we're here to help", "thank you for reaching out"
- Help desk phrases: "absolutely", "definitely", "of course", "certainly", "no problem"
- Troubleshooting: "have you tried", "have you checked" (technician's job, not dispatcher)
- Stacked acknowledgments: "I understand. Alright. Let's..." (pick ONE)
- Vague questions: "tell me more", "can you describe"

RATE THIS SCENARIO 1-10:
${blueprintIntent ? `
BLUEPRINT-AWARE SCORING (most important = intent fulfillment):
10 = Perfect: Fulfills intent perfectly + dispatcher tone
8-9 = Good: Fulfills intent well, minor polish
6-7 = Acceptable: Fulfills intent but tone issues
4-5 = Needs work: Partially fulfills intent OR wrong approach
1-3 = Fails: Does not fulfill its intended purpose` : `
GENERAL SCORING:
10 = Perfect dispatcher. Would hire this person.
8-9 = Good, minor tweaks possible
6-7 = Acceptable but noticeably imperfect
4-5 = Needs work, sounds like chatbot/help desk
1-3 = Fails completely, would confuse callers`}

Return JSON only:
{
  "score": <1-10>,
  "verdict": "<PERFECT|GOOD|NEEDS_WORK|FAILS>",
  "blueprintMatch": ${blueprintIntent ? `"${blueprintIntent.itemKey}"` : 'null'},
  "intentFulfilled": ${blueprintIntent ? '<true|false>' : 'null'},
  "issues": [
    { "field": "<quickReplies[0]|fullReplies[1]|general>", "issue": "<specific problem>", "suggestion": "<how to fix>" }
  ],
  "strengths": ["<what's good about this scenario>"],
  "rewriteNeeded": <true|false>
}`;

                // Add timeout wrapper for OpenAI call (30 second timeout)
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('OpenAI request timeout (30s)')), 30000)
                );
                
                const apiPromise = openaiClient.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { 
                            role: 'system', 
                            content: 'You are a strict QA auditor. Be critical but fair. Return valid JSON only.' 
                        },
                        { role: 'user', content: auditPrompt }
                    ],
                    max_tokens: 500,
                    temperature: 0.2,
                    response_format: { type: 'json_object' }
                });
                
                const response = await Promise.race([apiPromise, timeoutPromise]);
                
                // Reset consecutive errors on success
                consecutiveErrors = 0;
                
                totalTokens += response.usage?.total_tokens || 0;
                
                let auditResult;
                try {
                    auditResult = JSON.parse(response.choices[0]?.message?.content || '{}');
                } catch (parseErr) {
                    auditResult = { 
                        score: 5, 
                        verdict: 'PARSE_ERROR', 
                        issues: [{ field: 'general', issue: 'Could not parse GPT response', suggestion: 'Review manually' }],
                        strengths: [],
                        rewriteNeeded: true
                    };
                }
                
                // ════════════════════════════════════════════════════════════════════
                // GROUNDING VALIDATION: Filter out hallucinated issues
                // Verifies each issue references actual content in the scenario
                // ════════════════════════════════════════════════════════════════════
                const allScenarioText = [
                    scenario.name,
                    ...(scenario.triggers || []),
                    ...(scenario.quickReplies || []),
                    ...(scenario.fullReplies || [])
                ].join(' ').toLowerCase();
                
                const originalIssueCount = (auditResult.issues || []).length;
                const groundedIssues = [];
                let hallucinatedCount = 0;
                
                for (const issue of (auditResult.issues || [])) {
                    // General issues are always kept (they're subjective assessments)
                    if (issue.field === 'general') {
                        groundedIssues.push(issue);
                        continue;
                    }
                    
                    // Check for banned phrase claims
                    const bannedPhrases = [
                        "i'd be happy to", "thank you for reaching out", "wonderful to hear",
                        "we're here to help", "absolutely", "definitely", "of course",
                        "certainly", "no problem", "have you tried", "have you checked",
                        "tell me more", "can you describe", "let me"
                    ];
                    
                    const issueText = (issue.issue || '').toLowerCase();
                    const mentionsBanned = bannedPhrases.some(phrase => issueText.includes(phrase));
                    
                    if (mentionsBanned) {
                        // Verify the banned phrase actually exists
                        const foundBanned = bannedPhrases.some(phrase => allScenarioText.includes(phrase));
                        if (foundBanned) {
                            groundedIssues.push({ ...issue, grounded: true });
                        } else {
                            hallucinatedCount++;
                        }
                    } else {
                        // For other issues, check if key words from issue exist in scenario
                        const issueWords = issueText.split(/\s+/).filter(w => w.length > 4);
                        const foundWords = issueWords.filter(w => allScenarioText.includes(w));
                        const isGrounded = foundWords.length >= issueWords.length * 0.3 || issueWords.length < 3;
                        
                        if (isGrounded) {
                            groundedIssues.push({ ...issue, grounded: true });
                        } else {
                            hallucinatedCount++;
                        }
                    }
                }
                
                // Replace issues with grounded issues only
                auditResult.issues = groundedIssues;
                auditResult.hallucinatedIssuesFiltered = hallucinatedCount;
                
                // Recalculate score if we filtered out issues
                if (hallucinatedCount > 0 && groundedIssues.length === 0 && auditResult.score < 9) {
                    // Bump score up since all "issues" were hallucinations
                    auditResult.score = Math.min(9, auditResult.score + 2);
                    auditResult.rewriteNeeded = false;
                    auditResult.verdict = auditResult.score >= 9 ? 'PERFECT' : 'GOOD';
                }
                
                // Count by rewriteNeeded flag (more accurate than score threshold)
                if (auditResult.score >= 9 && !auditResult.rewriteNeeded) perfect++;
                else if (auditResult.rewriteNeeded || auditResult.score < 7) needsWork++;
                
                const resultEntry = {
                    scenarioId,
                    name: scenario.name,
                    scenarioType: scenario.scenarioType,
                    category: scenario.categoryName,
                    categoryId: scenario.categoryId,
                    templateId: templateIdStr,
                    auditProfileId,
                    ...auditResult,
                    // Content hash for caching
                    contentHash,
                    // Blueprint match metadata
                    matchConfidence,
                    matchSource,
                    // Supervision metadata
                    supervision: {
                        grounded: true,
                        originalIssueCount,
                        hallucinatedFiltered: hallucinatedCount,
                        verifiedIssueCount: groundedIssues.length
                    }
                };
                
                // ════════════════════════════════════════════════════════════════
                // PERSIST TO ScenarioAuditResult COLLECTION (profile-based cache)
                // This is the authoritative "done" memory
                // ════════════════════════════════════════════════════════════════
                try {
                    await ScenarioAuditResult.upsertResult({
                        templateId: templateIdStr,
                        scenarioId,
                        auditProfileId,
                        scenarioContentHash: contentHash,
                        score: auditResult.score,
                        verdict: auditResult.verdict,
                        rewriteNeeded: auditResult.rewriteNeeded,
                        issues: groundedIssues,
                        strengths: auditResult.strengths || [],
                        fixSuggestions: groundedIssues.map(i => i.suggestion).filter(Boolean),
                        blueprintItemKey: auditResult.blueprintMatch || null,
                        matchConfidence,
                        matchSource,
                        intentFulfilled: auditResult.intentFulfilled ?? null,
                        supervision: {
                            grounded: true,
                            originalIssueCount,
                            hallucinatedFiltered: hallucinatedCount,
                            verifiedIssueCount: groundedIssues.length
                        },
                        model: 'gpt-4o',
                        promptVersion: 'DEEP_AUDIT_PROMPT_V1',
                        rubricVersion: auditProfile.rubricVersion,
                        tokensUsed: 0, // TODO: track tokens
                        durationMs: 0, // TODO: track duration
                        cached: false,
                        scenarioName: scenario.name,
                        scenarioType: scenario.scenarioType,
                        categoryName: scenario.categoryName,
                        categoryId: scenario.categoryId
                    });
                } catch (cacheError) {
                    // Non-fatal - just log and continue
                    logger.warn('[DEEP AUDIT] Failed to cache result', {
                        scenarioId,
                        error: cacheError.message
                    });
                }
                
                results.push(resultEntry);
                processed++;
                
                // Send progress update with grounding info
                const groundingNote = hallucinatedCount > 0 ? ` (${hallucinatedCount} false+ filtered)` : '';
                sendProgress({
                    type: 'progress',
                    current: processed,
                    total: totalCount,
                    percent: Math.round((processed / totalCount) * 100),
                    scenario: {
                        name: scenario.name,
                        score: auditResult.score,
                        verdict: auditResult.verdict,
                        hallucinatedFiltered: hallucinatedCount
                    },
                    message: `${processed}/${totalCount}: "${scenario.name}" → ${auditResult.score}/10${groundingNote}`
                });
                
            } catch (scenarioError) {
                consecutiveErrors++;
                
                logger.error('[DEEP AUDIT] Error auditing scenario', {
                    scenarioId: scenario.scenarioId,
                    error: scenarioError.message,
                    consecutiveErrors
                });
                
                processed++;
                
                results.push({
                    scenarioId: scenario.scenarioId || scenario._id?.toString(),
                    name: scenario.name,
                    category: scenario.categoryName,
                    score: 0,
                    verdict: 'ERROR',
                    issues: [{ field: 'general', issue: scenarioError.message, suggestion: 'Review manually' }],
                    strengths: [],
                    rewriteNeeded: true
                });
                
                // Send error progress
                sendProgress({
                    type: 'progress',
                    current: processed,
                    total: totalCount,
                    percent: Math.round((processed / totalCount) * 100),
                    scenario: { name: scenario.name, score: 0, verdict: 'ERROR' },
                    message: `${processed}/${totalCount}: "${scenario.name}" → Error`
                });
            }
        }
        
        // Calculate summary
        const avgScore = results.length > 0 
            ? (results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length).toFixed(1)
            : 0;
        
        const summary = {
            totalScenarios: results.length,
            averageScore: parseFloat(avgScore),
            perfect: perfect,
            needsWork: needsWork,
            tokensUsed: totalTokens,
            estimatedCost: `$${(totalTokens * 0.00001).toFixed(4)}`,
            // Caching stats (profile-based)
            cached: cachedCount,
            freshAudited: results.length - cachedCount,
            cacheHitRate: results.length > 0 ? `${Math.round((cachedCount / results.length) * 100)}%` : '0%',
            // Audit profile info
            auditProfile: {
                id: auditProfileId,
                name: auditProfile.name,
                rubricVersion: auditProfile.rubricVersion
            }
        };
        
        // ════════════════════════════════════════════════════════════════════════════
        // UPDATE PROFILE STATS
        // ════════════════════════════════════════════════════════════════════════════
        try {
            await deepAuditService.updateProfileStats(auditProfileId, {
                perfectCount: perfect,
                needsWorkCount: needsWork
            });
        } catch (statsError) {
            logger.warn('[DEEP AUDIT] Failed to update profile stats', { error: statsError.message });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // PERSIST AUDIT SCORES TO SCENARIOS (for Coverage Engine integration)
        // ════════════════════════════════════════════════════════════════════════════
        try {
            const scoreMap = new Map();
            for (const r of results) {
                if (r.scenarioId && typeof r.score === 'number' && !r.cached) {
                    scoreMap.set(r.scenarioId, {
                        score: r.score,
                        verdict: r.verdict,
                        intentFulfilled: r.intentFulfilled ?? null,
                        blueprintMatch: r.blueprintMatch ?? null,
                        contentHash: r.contentHash ?? null,
                        matchConfidence: r.matchConfidence ?? null
                    });
                }
            }
            
            // Update scenarios in template with audit results + content hash
            let scoresUpdated = 0;
            for (const cat of (template.categories || [])) {
                for (const scenario of (cat.scenarios || [])) {
                    const scoreData = scoreMap.get(scenario.scenarioId);
                    if (scoreData) {
                        scenario.lastAuditScore = scoreData.score;
                        scenario.lastAuditedAt = new Date();
                        scenario.lastAuditVerdict = scoreData.verdict;
                        scenario.lastAuditIntentFulfilled = scoreData.intentFulfilled;
                        
                        // Store content hash for cache validation
                        scenario.lastAuditContentHash = scoreData.contentHash;
                        
                        // Auto-assign blueprint mapping if found during audit (only high confidence)
                        if (scoreData.blueprintMatch && !scenario.blueprintItemKey && scoreData.matchConfidence >= 0.75) {
                            scenario.blueprintItemKey = scoreData.blueprintMatch;
                            scenario.blueprintMatchSource = 'auto_match';
                            scenario.blueprintMatchConfidence = scoreData.matchConfidence;
                            scenario.blueprintMatchedAt = new Date();
                        }
                        
                        scoresUpdated++;
                    }
                }
            }
            
            if (scoresUpdated > 0) {
                await template.save();
                logger.info('[DEEP AUDIT] Persisted scores to scenarios', {
                    companyId,
                    scoresUpdated,
                    templateId: template._id.toString()
                });
            }
        } catch (persistError) {
            logger.error('[DEEP AUDIT] Failed to persist scores', {
                error: persistError.message
            });
            // Don't fail the audit, just log
        }
        
        logger.info('[DEEP AUDIT] Completed', {
            companyId,
            ...summary
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // FINAL RESULT: Include all critical identifiers for debugging/export
        // ════════════════════════════════════════════════════════════════════════════
        const finalResult = {
            success: true,
            auditType: 'deep',
            poweredBy: 'GPT-4o',
            
            // Critical identifiers (MUST be in export for debugging)
            templateId: templateIdStr,
            companyId,
            exportedAt: new Date().toISOString(),
            
            // Audit profile (proves we're using new system)
            auditProfile: {
                id: auditProfileId,
                name: auditProfile.name,
                rubricVersion: auditProfile.rubricVersion
            },
            
            summary,
            scenarios: results.sort((a, b) => (a.score || 0) - (b.score || 0)), // Worst first
            
            // Groupings for UI
            byVerdict: {
                PERFECT: results.filter(r => r.verdict === 'PERFECT').map(r => r.name),
                GOOD: results.filter(r => r.verdict === 'GOOD').map(r => r.name),
                ACCEPTABLE: results.filter(r => r.verdict === 'ACCEPTABLE').map(r => r.name),
                NEEDS_WORK: results.filter(r => r.verdict === 'NEEDS_WORK').map(r => r.name),
                FAILS: results.filter(r => r.verdict === 'FAILS').map(r => r.name)
            },
            
            // Common issues for quick analysis
            commonIssues: (() => {
                const issueCounts = {};
                results.forEach(r => {
                    (r.issues || []).forEach(issue => {
                        const key = (issue.issue || '').toLowerCase().substring(0, 50);
                        if (key) {
                            issueCounts[key] = (issueCounts[key] || 0) + 1;
                        }
                    });
                });
                return Object.entries(issueCounts)
                    .map(([issue, count]) => ({ issue, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 20);
            })()
        };
        
        // Clean up keepalive interval
        if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
        }
        
        if (isStreaming) {
            // Send final complete event
            sendProgress({
                type: 'complete',
                ...finalResult
            });
            res.end();
        } else {
            res.json(finalResult);
        }
        
    } catch (error) {
        logger.error('[DEEP AUDIT] Error', {
            companyId,
            error: error.message,
            stack: error.stack
        });
        
        if (isStreaming) {
            sendProgress({ type: 'error', message: error.message });
            res.end();
        } else {
            res.status(500).json({
                error: 'Deep audit failed',
                details: error.message
            });
        }
    }
});

/**
 * POST /:companyId/audit/scenario
 * 
 * Audit a single scenario (for inline validation)
 * 
 * Body:
 * - scenario: object - the scenario to audit (if provided directly)
 * - scenarioId: string - ID of scenario to look up and audit
 * - rules: string[] (optional) - specific rule IDs to run
 */
router.post('/:companyId/audit/scenario', async (req, res) => {
    const { companyId } = req.params;
    const { scenario: providedScenario, scenarioId, rules: ruleIds } = req.body;
    
    let scenario = providedScenario;
    
    // If scenarioId provided instead of scenario object, look it up
    if (!scenario && scenarioId) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                return res.status(404).json({ error: 'Company not found' });
            }
            
            // Search through all templates for this scenario
            const templates = await GlobalInstantResponse.find({
                company: companyId,
                status: { $in: ['active', 'draft'] }
            });
            
            for (const template of templates) {
                for (const category of (template.categories || [])) {
                    const found = (category.scenarios || []).find(s => s.scenarioId === scenarioId);
                    if (found) {
                        scenario = found;
                        break;
                    }
                }
                if (scenario) break;
            }
            
            if (!scenario) {
                return res.status(404).json({ error: `Scenario ${scenarioId} not found` });
            }
            
            logger.info('[AUDIT] Found scenario by ID', { scenarioId, name: scenario.name });
            
        } catch (lookupError) {
            logger.error('[AUDIT] Error looking up scenario', { scenarioId, error: lookupError.message });
            return res.status(500).json({ error: 'Failed to look up scenario', details: lookupError.message });
        }
    }
    
    if (!scenario) {
        return res.status(400).json({ error: 'Scenario object or scenarioId is required' });
    }
    
    try {
        const engine = new AuditEngine({ logger });
        const result = await engine.auditScenario(scenario, {
            rules: ruleIds
        });
        
        res.json({
            success: true,
            scenarioId: scenario.scenarioId,
            scenarioName: scenario.name,
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
 * POST /:companyId/audit/deep/single
 * 
 * SUPERVISED GPT-4 Deep Audit for a SINGLE scenario
 * 
 * Architecture (3-Layer Supervision):
 *   Layer 1: Primary Auditor (GPT-4) - Scores and identifies issues
 *   Layer 2: Grounding Validator - Verifies issues exist in actual text
 *   Layer 3: Supervisor Judge (GPT-4) - Reviews & confirms/overrides primary
 * 
 * This prevents hallucinated issues and ensures audit accuracy.
 * Cost: ~$0.06 per call (3 GPT calls)
 * 
 * Body:
 * - scenarioId: string - ID of scenario to audit
 * - skipSupervision: boolean - (optional) skip Layer 3 for faster/cheaper audit
 */
router.post('/:companyId/audit/deep/single', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, skipSupervision = false } = req.body;
    
    if (!scenarioId) {
        return res.status(400).json({ error: 'scenarioId is required' });
    }
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get template to find the scenario
        const { template, error } = await getCompanyTemplate(company, {
            populateCategories: true
        });
        
        if (error) {
            return res.status(400).json({ error: error.message });
        }
        
        const tradeType = template.templateType?.toLowerCase() || 'general';
        
        // Find the scenario
        let scenario = null;
        for (const category of (template.categories || [])) {
            const found = (category.scenarios || []).find(s => 
                s.scenarioId === scenarioId || s._id?.toString() === scenarioId
            );
            if (found) {
                scenario = {
                    ...found.toObject ? found.toObject() : found,
                    categoryName: category.name
                };
                break;
            }
        }
        
        if (!scenario) {
            return res.status(404).json({ error: `Scenario ${scenarioId} not found` });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // BLUEPRINT-AWARE AUDIT: Get intent context if scenario is mapped
        // CRITICAL: Only use blueprint if HIGH confidence - wrong intent = worse than none
        // ════════════════════════════════════════════════════════════════════════════
        const blueprintItemKey = scenario.blueprintItemKey;
        let blueprintIntent = null;
        let blueprintContext = '';
        let matchConfidence = null;
        let matchSource = null;
        
        // PRIORITY 1: Explicit mapping (trusted)
        if (blueprintItemKey) {
            blueprintIntent = findBlueprintItem(blueprintItemKey);
            matchSource = 'explicit_mapping';
            matchConfidence = 1.0;
        }
        
        // PRIORITY 2: Auto-match ONLY if high confidence (>= 0.75)
        if (!blueprintIntent && !blueprintItemKey) {
            const matcher = new IntentMatcher(HVAC_BLUEPRINT_SPEC);
            const matchResult = matcher.match(scenario);
            
            // Category alignment check - prevent "Emergency" matching to "greeting"
            const categoryAligns = matchResult.matchedItemKey && 
                (scenario.categoryName?.toLowerCase().includes(
                    matchResult.matchedItemKey?.replace('hvac_', '').split('_')[0]
                ) || matchResult.confidence >= 0.85);
            
            if (matchResult.matched && matchResult.confidence >= 0.75 && categoryAligns) {
                blueprintIntent = findBlueprintItem(matchResult.matchedItemKey);
                matchSource = 'auto_match';
                matchConfidence = matchResult.confidence;
                logger.info('[SUPERVISED AUDIT] Auto-matched to blueprint intent', {
                    scenarioId,
                    matchedIntent: matchResult.matchedItemKey,
                    confidence: matchResult.confidence
                });
            } else if (matchResult.matched) {
                logger.info('[SUPERVISED AUDIT] Skipping low-confidence match', {
                    scenarioId,
                    scenarioName: scenario.name,
                    wouldMatchTo: matchResult.matchedItemKey,
                    confidence: matchResult.confidence,
                    categoryAligns,
                    reason: 'Below threshold or category mismatch - will audit as generic scenario'
                });
            }
        }
        
        // Build blueprint context for the prompt
        if (blueprintIntent) {
            blueprintContext = `
═══════════════════════════════════════════════════════════════════════════════
BLUEPRINT INTENT REQUIREMENTS (This scenario MUST fulfill this purpose):
═══════════════════════════════════════════════════════════════════════════════
Intent: ${blueprintIntent.name} (${blueprintIntent.itemKey})
Purpose: ${blueprintIntent.scenarioType} scenario for ${blueprintIntent.categoryName}
Reply Goal: ${blueprintIntent.replyGoal || 'classify'}
Booking Intent: ${blueprintIntent.bookingIntent ? 'YES - must guide toward booking' : 'NO - informational only'}

Expected Trigger Coverage: ${(blueprintIntent.triggerHints || []).join(', ')}
Should NOT Match: ${(blueprintIntent.negativeTriggerHints || []).join(', ') || 'N/A'}

Special Notes: ${blueprintIntent.notes || 'None'}

CRITICAL AUDIT CRITERIA FOR THIS INTENT:
1. Does the scenario's triggers adequately cover the intent's trigger hints?
2. Does the reply goal (${blueprintIntent.replyGoal}) match what the responses actually do?
3. If booking intent is ${blueprintIntent.bookingIntent ? 'YES' : 'NO'}, do responses reflect this?
4. Are the responses appropriate for a ${blueprintIntent.scenarioType} scenario?
═══════════════════════════════════════════════════════════════════════════════
`;
        } else {
            blueprintContext = `
NOTE: This scenario is NOT mapped to a blueprint intent.
Audit for general quality standards only.
`;
        }
        
        logger.info('[SUPERVISED AUDIT] Starting 3-layer audit', { 
            scenarioId, 
            name: scenario.name,
            tradeType,
            skipSupervision,
            blueprintItemKey: blueprintItemKey || 'none',
            autoMatched: !blueprintItemKey && !!blueprintIntent
        });
        
        let totalTokens = 0;
        const supervisionTrace = [];
        
        // ════════════════════════════════════════════════════════════════════════════
        // LAYER 1: PRIMARY AUDITOR (GPT-4) - NOW BLUEPRINT-AWARE
        // ════════════════════════════════════════════════════════════════════════════
        const primaryPrompt = `You are a SENIOR QA AUDITOR reviewing AI dispatcher scenarios for a ${tradeType.toUpperCase()} service company.

SCENARIO TO AUDIT:
Name: ${scenario.name}
Type: ${scenario.scenarioType || 'FAQ'}
Category: ${scenario.categoryName}
Triggers: ${(scenario.triggers || []).slice(0, 5).join(', ')}

Quick Replies (short responses):
${(scenario.quickReplies || []).map((r, i) => `[${i}] "${r}"`).join('\n') || '(none)'}

Full Replies (detailed responses):
${(scenario.fullReplies || []).map((r, i) => `[${i}] "${r}"`).join('\n') || '(none)'}
${blueprintContext}
DISPATCHER PERSONA STANDARDS:
- Sounds like a SEASONED dispatcher who handles 50+ calls/day
- Calm, confident, experienced - never surprised
- Friendly but NOT chatty - no fluff, no filler  
- Moves callers toward booking efficiently
- Uses trade terminology naturally

WHAT TO CHECK:
1. INTENT FULFILLMENT: Does this scenario properly fulfill its blueprint purpose? (Most important!)
2. TONE: Does it sound like a real dispatcher? (Not a chatbot, not help desk)
3. BREVITY: Quick replies ≤20 words, full replies ≤25 words
4. STRUCTURE: Quick=diagnostic question, Full=move toward booking
5. BANNED PHRASES: "I'd be happy to", "Thank you for", "Let me", "Absolutely", "Definitely", "No problem"
6. FLOW: Does it move the conversation forward efficiently?

CRITICAL: For each issue you identify, you MUST quote the EXACT text from the scenario that contains the problem. If you cannot quote exact text, do not report the issue.

SCORING (Blueprint-aware):
10 = Perfect: Fulfills blueprint intent perfectly + excellent dispatcher tone
9 = Excellent: Fulfills intent well, minor polish possible  
7-8 = Good: Fulfills intent but needs revision for tone/structure
5-6 = Mediocre: Partially fulfills intent OR significant tone issues
3-4 = Poor: Does not adequately fulfill its intended purpose
1-2 = Fails: Wrong intent entirely or completely broken

Return JSON only:
{
  "score": <1-10>,
  "verdict": "<PERFECT|GOOD|NEEDS_WORK|FAILS>",
  "blueprintAlignment": {
    "intentFulfilled": <true|false>,
    "triggersCoverIntent": <true|false>,
    "replyGoalMatches": <true|false>,
    "notes": "<brief explanation>"
  },
  "issues": [
    { 
      "field": "<quickReplies[0]|fullReplies[1]|triggers|general|blueprintAlignment>", 
      "exactQuote": "<EXACT text from scenario that has the problem>",
      "issue": "<what's wrong>", 
      "suggestion": "<how to fix>" 
    }
  ],
  "strengths": ["<specific good things>"],
  "rewriteNeeded": <true|false>,
  "confidence": <0.0-1.0>
}`;

        const primaryResponse = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a QA auditor. Return only valid JSON. Be precise - only report issues you can prove with exact quotes.' },
                { role: 'user', content: primaryPrompt }
            ],
            temperature: 0.2,
            max_tokens: 1000
        });
        
        totalTokens += primaryResponse.usage?.total_tokens || 0;
        
        let primaryResult;
        try {
            primaryResult = JSON.parse(primaryResponse.choices[0]?.message?.content || '{}');
        } catch (parseErr) {
            primaryResult = { 
                score: 5, 
                verdict: 'PARSE_ERROR', 
                issues: [],
                strengths: [],
                rewriteNeeded: true,
                confidence: 0.5
            };
        }
        
        supervisionTrace.push({
            layer: 'PRIMARY_AUDITOR',
            score: primaryResult.score,
            issueCount: (primaryResult.issues || []).length,
            confidence: primaryResult.confidence
        });
        
        logger.info('[SUPERVISED AUDIT] Layer 1 complete', { 
            score: primaryResult.score,
            issues: (primaryResult.issues || []).length,
            confidence: primaryResult.confidence
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // LAYER 2: GROUNDING VALIDATOR
        // Verifies each issue's exactQuote actually exists in the scenario
        // ════════════════════════════════════════════════════════════════════════════
        const allScenarioText = [
            scenario.name,
            ...(scenario.triggers || []),
            ...(scenario.quickReplies || []),
            ...(scenario.fullReplies || [])
        ].join(' ').toLowerCase();
        
        const groundedIssues = [];
        const hallucinatedIssues = [];
        
        for (const issue of (primaryResult.issues || [])) {
            const quote = (issue.exactQuote || '').toLowerCase().trim();
            
            // Check if the quoted text actually exists in the scenario
            let isGrounded = false;
            
            if (quote.length >= 3) {
                // Direct match
                if (allScenarioText.includes(quote)) {
                    isGrounded = true;
                } else {
                    // Fuzzy match - check if most words from quote exist
                    const quoteWords = quote.split(/\s+/).filter(w => w.length > 2);
                    const matchedWords = quoteWords.filter(w => allScenarioText.includes(w));
                    isGrounded = matchedWords.length >= quoteWords.length * 0.7;
                }
            }
            
            // Also check for banned phrase issues - verify the phrase exists
            if (issue.issue?.toLowerCase().includes('banned') || issue.issue?.toLowerCase().includes('phrase')) {
                const bannedPhrases = ["i'd be happy to", "thank you for", "let me", "absolutely", "definitely", "no problem"];
                const foundBanned = bannedPhrases.some(phrase => allScenarioText.includes(phrase));
                if (!foundBanned && !isGrounded) {
                    isGrounded = false; // Hallucinated banned phrase
                }
            }
            
            if (isGrounded || issue.field === 'general') {
                groundedIssues.push({ ...issue, grounded: true });
            } else {
                hallucinatedIssues.push({ ...issue, grounded: false, reason: 'Quote not found in scenario' });
            }
        }
        
        supervisionTrace.push({
            layer: 'GROUNDING_VALIDATOR',
            totalIssues: (primaryResult.issues || []).length,
            groundedIssues: groundedIssues.length,
            hallucinatedIssues: hallucinatedIssues.length,
            removedIssues: hallucinatedIssues.map(i => i.issue?.substring(0, 50))
        });
        
        logger.info('[SUPERVISED AUDIT] Layer 2 complete', { 
            grounded: groundedIssues.length,
            hallucinated: hallucinatedIssues.length
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // LAYER 3: SUPERVISOR JUDGE (GPT-4)
        // Reviews the primary audit and confirms/adjusts the score
        // ════════════════════════════════════════════════════════════════════════════
        let finalResult;
        
        if (skipSupervision || groundedIssues.length === 0) {
            // Skip supervision if no issues or explicitly requested
            finalResult = {
                score: groundedIssues.length === 0 ? Math.max(primaryResult.score, 9) : primaryResult.score,
                verdict: groundedIssues.length === 0 ? 'PERFECT' : primaryResult.verdict,
                issues: groundedIssues,
                strengths: primaryResult.strengths || [],
                rewriteNeeded: groundedIssues.length > 0 && primaryResult.rewriteNeeded,
                supervisorAgreement: 'SKIPPED'
            };
            
            supervisionTrace.push({
                layer: 'SUPERVISOR_JUDGE',
                status: 'SKIPPED',
                reason: skipSupervision ? 'User requested skip' : 'No grounded issues to review'
            });
        } else {
            // Run supervisor to validate primary's judgment
            const supervisorPrompt = `You are a SUPERVISOR reviewing another auditor's work. Your job is to verify the audit is fair and accurate.

SCENARIO BEING AUDITED:
Name: ${scenario.name}
Quick Replies: ${JSON.stringify(scenario.quickReplies || [])}
Full Replies: ${JSON.stringify(scenario.fullReplies || [])}

PRIMARY AUDITOR'S ASSESSMENT:
Score: ${primaryResult.score}/10
Verdict: ${primaryResult.verdict}
Issues Found: ${JSON.stringify(groundedIssues, null, 2)}
Strengths: ${JSON.stringify(primaryResult.strengths || [])}

YOUR TASK:
1. Review each issue - is it a real problem or nitpicking?
2. Is the score fair given the issues?
3. Would you agree or adjust?

IMPORTANT:
- Be fair to the scenario author
- Don't penalize for minor style preferences
- Focus on real usability issues
- Banned phrases ARE serious (if actually present)
- Tone issues matter if they'd confuse a caller

Return JSON only:
{
  "agree": <true|false>,
  "adjustedScore": <1-10 or null if agree>,
  "adjustedVerdict": "<PERFECT|GOOD|NEEDS_WORK|FAILS or null if agree>",
  "reasoning": "<why you agree or disagree>",
  "validIssues": [<indices of issues you consider valid, e.g. [0, 2]>],
  "dismissedIssues": [<indices of issues you consider nitpicking, e.g. [1]>],
  "supervisorConfidence": <0.0-1.0>
}`;

            const supervisorResponse = await openaiClient.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a fair supervisor. Return only valid JSON. Be balanced - neither too harsh nor too lenient.' },
                    { role: 'user', content: supervisorPrompt }
                ],
                temperature: 0.2,
                max_tokens: 600
            });
            
            totalTokens += supervisorResponse.usage?.total_tokens || 0;
            
            let supervisorResult;
            try {
                supervisorResult = JSON.parse(supervisorResponse.choices[0]?.message?.content || '{}');
            } catch (parseErr) {
                supervisorResult = { agree: true, supervisorConfidence: 0.5 };
            }
            
            // Apply supervisor's adjustments
            const validIssueIndices = new Set(supervisorResult.validIssues || groundedIssues.map((_, i) => i));
            const finalIssues = groundedIssues.filter((_, i) => validIssueIndices.has(i));
            
            finalResult = {
                score: supervisorResult.adjustedScore || primaryResult.score,
                verdict: supervisorResult.adjustedVerdict || primaryResult.verdict,
                issues: finalIssues,
                strengths: primaryResult.strengths || [],
                rewriteNeeded: finalIssues.length > 0 && (supervisorResult.adjustedScore || primaryResult.score) < 9,
                supervisorAgreement: supervisorResult.agree ? 'AGREED' : 'ADJUSTED',
                supervisorReasoning: supervisorResult.reasoning
            };
            
            // Recalculate verdict based on final score
            if (finalResult.score >= 9) finalResult.verdict = 'PERFECT';
            else if (finalResult.score >= 7) finalResult.verdict = 'GOOD';
            else if (finalResult.score >= 5) finalResult.verdict = 'NEEDS_WORK';
            else finalResult.verdict = 'FAILS';
            
            supervisionTrace.push({
                layer: 'SUPERVISOR_JUDGE',
                primaryScore: primaryResult.score,
                supervisorAgreed: supervisorResult.agree,
                finalScore: finalResult.score,
                issuesValidated: finalIssues.length,
                issuesDismissed: groundedIssues.length - finalIssues.length,
                reasoning: supervisorResult.reasoning,
                confidence: supervisorResult.supervisorConfidence
            });
            
            logger.info('[SUPERVISED AUDIT] Layer 3 complete', { 
                agreed: supervisorResult.agree,
                primaryScore: primaryResult.score,
                finalScore: finalResult.score,
                validIssues: finalIssues.length
            });
        }
        
        const estimatedCost = (totalTokens * 0.00001).toFixed(4);
        
        logger.info('[SUPERVISED AUDIT] Complete', { 
            scenarioId, 
            finalScore: finalResult.score,
            finalVerdict: finalResult.verdict,
            totalTokens,
            layersRun: supervisionTrace.length
        });
        
        res.json({
            success: true,
            scenarioId,
            scenarioName: scenario.name,
            auditType: 'supervised-deep', // Indicates this was 3-layer supervised audit
            score: finalResult.score,
            verdict: finalResult.verdict,
            issues: finalResult.issues,
            strengths: finalResult.strengths,
            rewriteNeeded: finalResult.rewriteNeeded,
            supervisorAgreement: finalResult.supervisorAgreement,
            supervisorReasoning: finalResult.supervisorReasoning,
            // Transparency: show what was filtered out
            supervision: {
                trace: supervisionTrace,
                hallucinatedIssuesRemoved: hallucinatedIssues.length,
                totalTokens,
                estimatedCost: `$${estimatedCost}`
            }
        });
        
    } catch (error) {
        logger.error('[DEEP AUDIT SINGLE] Error', { 
            companyId, 
            scenarioId,
            error: error.message 
        });
        res.status(500).json({ 
            error: 'Failed to run deep audit', 
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
        
        const tradeKey = company.trade || template.templateType || null;
        const governanceBlock = buildPlaceholderGovernanceBlock(tradeKey);

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
- Use {callerName} placeholder to personalize when appropriate
- Do NOT invent placeholders

BANNED PHRASES (never use):
- "Got it", "No problem", "Absolutely", "Of course" (help desk)
- "Let me help you with that", "I'd be happy to help", "happy to help" (chatbot)
- "Have you checked...", "Have you tried...", "Is it set correctly?" (troubleshooting)
- "Wonderful", "Great", "Awesome" (over-enthusiastic)

APPROVED ACKNOWLEDGMENTS:
- "I understand."
- "Alright."
- "Okay."
- "Thanks, {callerName}."

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
Just the corrected value that should replace the current one.

${governanceBlock}`;
        
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
        
        // Import fix ledger service
        const deepAuditService = require('../../services/deepAudit');
        const ScenarioFixLedger = require('../../models/ScenarioFixLedger');
        const templateIdStr = template._id?.toString();
        
        // Find and update the scenario
        let updated = false;
        let categoryIndex = -1;
        let scenarioIndex = -1;
        let beforeHash = null;
        let afterHash = null;
        let targetScenario = null;
        
        for (let ci = 0; ci < (template.categories || []).length; ci++) {
            const category = template.categories[ci];
            for (let si = 0; si < (category.scenarios || []).length; si++) {
                const scenario = category.scenarios[si];
                if (scenario.scenarioId === scenarioId || scenario._id?.toString() === scenarioId) {
                    categoryIndex = ci;
                    scenarioIndex = si;
                    targetScenario = scenario;
                    
                    // ════════════════════════════════════════════════════════════════
                    // FIX LEDGER: Hash BEFORE the fix
                    // ════════════════════════════════════════════════════════════════
                    beforeHash = deepAuditService.hashScenarioContent(scenario);
                    
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
                    
                    // ════════════════════════════════════════════════════════════════
                    // FIX LEDGER: Hash AFTER the fix
                    // ════════════════════════════════════════════════════════════════
                    afterHash = deepAuditService.hashScenarioContent(scenario);
                    
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
                        newValue,
                        beforeHash,
                        afterHash,
                        contentChanged: beforeHash !== afterHash
                    });
                    
                    break;
                }
            }
            if (updated) break;
        }
        
        if (!updated) {
            return res.status(404).json({ error: 'Scenario not found' });
        }
        
        // ════════════════════════════════════════════════════════════════════════
        // Save using updateOne to bypass full document validation
        // This avoids triggering validation on unrelated legacy fields
        // ════════════════════════════════════════════════════════════════════════
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        await GlobalInstantResponseTemplate.updateOne(
            { _id: template._id },
            { 
                $set: { 
                    [`categories.${categoryIndex}.scenarios.${scenarioIndex}`]: template.categories[categoryIndex].scenarios[scenarioIndex],
                    updatedAt: new Date()
                }
            }
        );
        
        // ════════════════════════════════════════════════════════════════════════
        // FIX LEDGER: Record the fix for audit trail
        // ════════════════════════════════════════════════════════════════════════
        if (beforeHash !== afterHash && targetScenario) {
            try {
                const auditProfile = await deepAuditService.getActiveAuditProfile(templateIdStr);
                const auditProfileId = auditProfile._id.toString();
                const fixedScenarioId = targetScenario.scenarioId || scenarioId;
                
                await ScenarioFixLedger.recordFix({
                    templateId: templateIdStr,
                    scenarioId: fixedScenarioId,
                    auditProfileId,
                    beforeHash,
                    afterHash,
                    fixType: 'auto_gpt',
                    scenarioName: targetScenario.name,
                    scenarioType: targetScenario.scenarioType,
                    categoryName: targetScenario.categoryName,
                    appliedBy: req.user?.email || 'admin',
                    notes: `Fixed field: ${field}`
                });
                
                // ════════════════════════════════════════════════════════════════
                // PURGE CACHED RESULT: Content changed, old result is invalid
                // This forces re-audit on next Deep Audit run
                // ════════════════════════════════════════════════════════════════
                const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
                await ScenarioAuditResult.purgeForScenario(templateIdStr, fixedScenarioId, auditProfileId);
                
                logger.info('[AUDIT FIX] Recorded fix and purged cached result', {
                    scenarioId: fixedScenarioId,
                    beforeHash,
                    afterHash
                });
            } catch (ledgerError) {
                // Non-fatal - just log
                logger.warn('[AUDIT FIX] Failed to record fix in ledger', {
                    error: ledgerError.message
                });
            }
        }
        
        res.json({
            success: true,
            scenarioId,
            field,
            newValue,
            message: 'Fix applied successfully',
            contentChanged: beforeHash !== afterHash
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
        
        // Import fix ledger service
        const deepAuditService = require('../../services/deepAudit');
        const ScenarioFixLedger = require('../../models/ScenarioFixLedger');
        const templateIdStr = template._id?.toString();
        
        // FIX LEDGER: Hash BEFORE the fix
        const beforeHash = deepAuditService.hashScenarioContent(targetScenario);
        
        logger.info('[AUDIT FIX-SCENARIO] Starting batch fix', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            violationCount: violations?.length || 0,
            beforeHash
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
        let skipped = { noField: 0, infoLevel: 0, nonFixable: 0 };
        
        // Fields that shouldn't be "fixed" by AI - they're intentional configurations
        const NON_FIXABLE_FIELDS = [
            'dynamicVariables',  // Custom placeholders are intentional
            'entityCapture',     // Admin configures these
            'entityValidation',  // Admin configures these
            'actionHooks',       // Admin configures these
            'ttsOverride',       // Admin configures these
            'preconditions',     // State machine - admin configures
            'effects'            // State machine - admin configures
        ];
        
        for (const violation of (violations || [])) {
            try {
                // Skip violations without a field
                if (!violation.field) {
                    skipped.noField++;
                    logger.info('[AUDIT FIX-SCENARIO] Skipping violation without field');
                    continue;
                }
                
                // Skip INFO severity - these are informational, not errors
                if (violation.severity === 'info' || violation.severity === 'INFO') {
                    skipped.infoLevel++;
                    logger.info('[AUDIT FIX-SCENARIO] Skipping INFO-level violation', { 
                        field: violation.field 
                    });
                    continue;
                }
                
                // Skip non-fixable fields (admin-owned configurations)
                const fieldRoot = violation.field.split('.')[0].split('[')[0];
                if (NON_FIXABLE_FIELDS.includes(fieldRoot)) {
                    skipped.nonFixable++;
                    logger.info('[AUDIT FIX-SCENARIO] Skipping non-fixable field', { 
                        field: violation.field,
                        fieldRoot 
                    });
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
                const tradeKey = company.trade || template.templateType || null;
                const governanceBlock = buildPlaceholderGovernanceBlock(tradeKey);

                // ════════════════════════════════════════════════════════════════════
                // COMPREHENSIVE FIX PROMPT - Includes ALL banned phrases from audit rules
                // ════════════════════════════════════════════════════════════════════
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
- Use {callerName} placeholder appropriately (do NOT invent placeholders)
- Sound like an experienced dispatcher (calm, professional)

BANNED PHRASES (NEVER USE - these break dispatcher persona):
Chatbot: "wonderful to hear", "great to have you", "we're here to help", "let's sort this out", "i apologize for the inconvenience", "i'm sorry to hear", "thank you for reaching out", "how can i assist", "i'd be happy to help", "is there anything else", "thank you for your patience", "let me help you with that", "i'm here to assist", "thanks for contacting us"
Help desk: "got it", "no problem", "absolutely", "of course", "certainly", "definitely", "sure thing", "you bet", "my pleasure", "happy to help"
Troubleshooting: "have you checked", "have you tried", "have you noticed", "did you try", "can you check"

APPROVED ONLY: "I understand.", "Alright.", "Okay.", "Thanks, {callerName}."

Return ONLY the fixed text. No quotes, no explanation.

${governanceBlock}`;

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
        
        // ════════════════════════════════════════════════════════════════════════
        // Save using updateOne to bypass full document validation
        // This avoids triggering validation on unrelated legacy fields
        // ════════════════════════════════════════════════════════════════════════
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        await GlobalInstantResponseTemplate.updateOne(
            { _id: template._id },
            { 
                $set: { 
                    [`categories.${categoryIndex}.scenarios.${scenarioIndex}`]: targetScenario,
                    updatedAt: new Date()
                }
            }
        );
        
        // ════════════════════════════════════════════════════════════════════════
        // FIX LEDGER: Record the batch fix for audit trail
        // ════════════════════════════════════════════════════════════════════════
        const afterHash = deepAuditService.hashScenarioContent(targetScenario);
        
        if (beforeHash !== afterHash) {
            try {
                const auditProfile = await deepAuditService.getActiveAuditProfile(templateIdStr);
                const auditProfileId = auditProfile._id.toString();
                const fixedScenarioId = targetScenario.scenarioId || scenarioId;
                
                await ScenarioFixLedger.recordFix({
                    templateId: templateIdStr,
                    scenarioId: fixedScenarioId,
                    auditProfileId,
                    beforeHash,
                    afterHash,
                    fixType: 'auto_gpt',
                    issuesAddressed: violations?.map(v => v.ruleId || v.message).filter(Boolean) || [],
                    scenarioName: targetScenario.name,
                    scenarioType: targetScenario.scenarioType,
                    categoryName: targetScenario.categoryName,
                    appliedBy: req.user?.email || 'admin',
                    notes: `Batch fix: ${fixesApplied} fields fixed`
                });
                
                // ════════════════════════════════════════════════════════════════
                // PURGE CACHED RESULT: Content changed, old result is invalid
                // This forces re-audit on next Deep Audit run
                // ════════════════════════════════════════════════════════════════
                const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
                await ScenarioAuditResult.purgeForScenario(templateIdStr, fixedScenarioId, auditProfileId);
                
                logger.info('[AUDIT FIX-SCENARIO] Recorded batch fix and purged cached result', {
                    scenarioId: fixedScenarioId,
                    beforeHash,
                    afterHash,
                    fixesApplied
                });
            } catch (ledgerError) {
                // Non-fatal - just log
                logger.warn('[AUDIT FIX-SCENARIO] Failed to record fix in ledger', {
                    error: ledgerError.message
                });
            }
        }
        
        logger.info('[AUDIT FIX-SCENARIO] Batch fix complete', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            totalViolations: violations?.length || 0,
            fixesGenerated: fixes.length,
            fixesApplied,
            tokensUsed,
            contentChanged: beforeHash !== afterHash
        });
        
        res.json({
            success: true,
            scenarioId,
            scenarioName: targetScenario.name,
            contentChanged: beforeHash !== afterHash,
            totalViolations: violations?.length || 0,
            fixesGenerated: fixes.length,
            fixesApplied,
            // Show what was skipped for transparency
            skipped: {
                infoLevel: skipped.infoLevel,      // INFO severity = informational, not errors
                nonFixable: skipped.nonFixable,    // Admin-configured fields (dynamicVariables, etc)
                noField: skipped.noField           // Missing field path
            },
            fixes: fixes.map(f => ({
                field: f.field,
                oldValue: f.oldValue?.substring(0, 50),
                newValue: f.newValue?.substring(0, 50)
            })),
            tokensUsed,
            message: fixesApplied > 0 
                ? `Applied ${fixesApplied} fixes to scenario` 
                : `No fixable issues found (${skipped.infoLevel} info-only, ${skipped.nonFixable} admin-owned)`
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
// POST /:companyId/audit/generate-fix
// 
// Generate fixes for ALL violations in a scenario WITHOUT saving
// Returns the fixed scenario object for preview in Global Brain
// This mirrors Gap Fill's "Open in Global Brain" flow for Template Audit
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:companyId/audit/generate-fix', async (req, res) => {
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
        
        // Find the scenario
        let targetScenario = null;
        let categoryIndex = -1;
        let scenarioIndex = -1;
        let categoryData = null;
        const searchId = scenarioId?.toString();
        
        logger.info('[AUDIT GENERATE-FIX] Searching for scenario', { searchId });
        
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
                    categoryData = category;
                    logger.info('[AUDIT GENERATE-FIX] Found scenario', { 
                        name: scenario.name,
                        categoryIndex: ci,
                        scenarioIndex: si,
                        categoryId: category.id || category._id
                    });
                    break;
                }
            }
            if (targetScenario) break;
        }
        
        if (!targetScenario) {
            logger.error('[AUDIT GENERATE-FIX] Scenario not found', { searchId });
            return res.status(404).json({ error: 'Scenario not found', searchId });
        }
        
        logger.info('[AUDIT GENERATE-FIX] Generating fixes (no save)', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            violationCount: violations?.length || 0
        });
        
        // Create a DEEP COPY of the scenario to apply fixes to (don't modify original)
        const fixedScenario = JSON.parse(JSON.stringify(targetScenario));
        
        // Build scenario context for GPT
        const scenarioContext = {
            name: targetScenario.name,
            scenarioType: targetScenario.scenarioType || 'FAQ',
            category: targetScenario.categories?.[0] || categoryData?.name || 'General',
            behavior: targetScenario.behavior || 'calm_professional',
            triggers: (targetScenario.triggers || []).slice(0, 10),
            quickReplies: targetScenario.quickReplies || [],
            fullReplies: targetScenario.fullReplies || []
        };
        
        // Generate fixes for all violations
        const fixes = [];
        let tokensUsed = 0;
        let skipped = { noField: 0, infoLevel: 0, nonFixable: 0 };
        
        // Fields that shouldn't be "fixed" by AI
        const NON_FIXABLE_FIELDS = [
            'dynamicVariables', 'entityCapture', 'entityValidation',
            'actionHooks', 'ttsOverride', 'preconditions', 'effects',
            '_nonContentFields' // Info-only field about legacy fields
        ];
        
        for (const violation of (violations || [])) {
            try {
                // Skip violations without a field
                if (!violation.field) {
                    skipped.noField++;
                    continue;
                }
                
                // Skip INFO severity - these are informational, not errors
                if (violation.severity === 'info' || violation.severity === 'INFO') {
                    skipped.infoLevel++;
                    continue;
                }
                
                // Skip non-fixable fields
                const fieldRoot = violation.field.split('.')[0].split('[')[0];
                if (NON_FIXABLE_FIELDS.includes(fieldRoot)) {
                    skipped.nonFixable++;
                    continue;
                }
                
                // Get current value for this field
                const fieldPath = violation.field.replace(/\[(\d+)\]/g, '.$1').split('.');
                let currentValue = targetScenario;
                for (const key of fieldPath) {
                    if (currentValue === undefined || currentValue === null) break;
                    currentValue = currentValue[key];
                }
                
                // Handle non-text fields
                if (typeof currentValue !== 'string') {
                    if (violation.value && typeof violation.value === 'string') {
                        currentValue = violation.value;
                    } else {
                        continue;
                    }
                }
                
                const valueToFix = currentValue || violation.value;
                if (!valueToFix || typeof valueToFix !== 'string') {
                    continue;
                }
                
                // Generate fix using GPT-4o (for generate-fix preview endpoint)
                const tradeKey = company.trade || template.templateType || null;
                const governanceBlock = buildPlaceholderGovernanceBlock(tradeKey);
                
                // ════════════════════════════════════════════════════════════════════
                // COMPREHENSIVE FIX PROMPT - Includes ALL banned phrases from audit rules
                // This ensures GPT-4 generates fixes that will actually pass the audit
                // ════════════════════════════════════════════════════════════════════
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
- Use {callerName} placeholder appropriately (do NOT invent placeholders)
- Sound like an experienced dispatcher (calm, professional)

BANNED PHRASES (NEVER USE - these break dispatcher persona):
Chatbot: "wonderful to hear", "great to have you", "we're here to help", "let's sort this out", "i apologize for the inconvenience", "i'm sorry to hear", "thank you for reaching out", "how can i assist", "i'd be happy to help", "is there anything else", "thank you for your patience", "let me help you with that", "i'm here to assist", "thanks for contacting us"
Help desk: "got it", "no problem", "absolutely", "of course", "certainly", "definitely", "sure thing", "you bet", "my pleasure", "happy to help"
Troubleshooting: "have you checked", "have you tried", "have you noticed", "did you try", "can you check"

APPROVED ONLY: "I understand.", "Alright.", "Okay.", "Thanks, {callerName}."

Return ONLY the fixed text. No quotes, no explanation.

${governanceBlock}`;

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
                    // ════════════════════════════════════════════════════════════════════
                    // APPLY FIX: Handle both specific paths (quickReplies[0]) and 
                    // generic fields (replies) by searching for the exact value
                    // ════════════════════════════════════════════════════════════════════
                    let actualFieldPath = violation.field;
                    let fixApplied = false;
                    
                    // If field is generic "replies", find the actual location of the value
                    if (violation.field === 'replies' || violation.field === 'reply') {
                        // Search in quickReplies
                        const qrIndex = (fixedScenario.quickReplies || []).findIndex(r => r === valueToFix || r?.includes(valueToFix));
                        if (qrIndex !== -1) {
                            fixedScenario.quickReplies[qrIndex] = suggestedFix;
                            actualFieldPath = `quickReplies[${qrIndex}]`;
                            fixApplied = true;
                            logger.info('[AUDIT GENERATE-FIX] Fixed quickReplies[' + qrIndex + ']');
                        }
                        
                        // Search in fullReplies
                        const frIndex = (fixedScenario.fullReplies || []).findIndex(r => r === valueToFix || r?.includes(valueToFix));
                        if (frIndex !== -1) {
                            fixedScenario.fullReplies[frIndex] = suggestedFix;
                            actualFieldPath = fixApplied ? actualFieldPath + `, fullReplies[${frIndex}]` : `fullReplies[${frIndex}]`;
                            fixApplied = true;
                            logger.info('[AUDIT GENERATE-FIX] Fixed fullReplies[' + frIndex + ']');
                        }
                        
                        // Also check _noName variants
                        const qrNoNameIndex = (fixedScenario.quickReplies_noName || []).findIndex(r => r === valueToFix || r?.includes(valueToFix));
                        if (qrNoNameIndex !== -1) {
                            fixedScenario.quickReplies_noName[qrNoNameIndex] = suggestedFix;
                            fixApplied = true;
                        }
                        
                        const frNoNameIndex = (fixedScenario.fullReplies_noName || []).findIndex(r => r === valueToFix || r?.includes(valueToFix));
                        if (frNoNameIndex !== -1) {
                            fixedScenario.fullReplies_noName[frNoNameIndex] = suggestedFix;
                            fixApplied = true;
                        }
                    } else {
                        // Specific field path - use standard logic
                        const fixFieldPath = violation.field.replace(/\[(\d+)\]/g, '.$1').split('.');
                        let target = fixedScenario;
                        for (let i = 0; i < fixFieldPath.length - 1; i++) {
                            target = target[fixFieldPath[i]];
                        }
                        const lastKey = fixFieldPath[fixFieldPath.length - 1];
                        if (target && lastKey !== undefined) {
                            target[lastKey] = suggestedFix;
                            fixApplied = true;
                        }
                    }
                    
                    if (fixApplied) {
                        fixes.push({
                            field: actualFieldPath,
                            oldValue: valueToFix,
                            newValue: suggestedFix,
                            ruleId: violation.ruleId,
                            message: violation.message,
                            severity: violation.severity
                        });
                        logger.info('[AUDIT GENERATE-FIX] Fix applied', {
                            field: actualFieldPath,
                            oldValue: valueToFix?.substring(0, 30),
                            newValue: suggestedFix?.substring(0, 30)
                        });
                    } else {
                        logger.warn('[AUDIT GENERATE-FIX] Could not find location for fix', {
                            field: violation.field,
                            valueToFix: valueToFix?.substring(0, 50)
                        });
                    }
                }
                
            } catch (fixError) {
                logger.error('[AUDIT GENERATE-FIX] Error generating fix', {
                    field: violation.field,
                    error: fixError.message
                });
            }
        }
        
        // Add metadata for Global Brain prefill
        fixedScenario._auditFix = {
            fixedAt: new Date().toISOString(),
            fixedBy: 'Template Audit AI',
            fixCount: fixes.length,
            originalViolations: violations?.length || 0
        };
        
        logger.info('[AUDIT GENERATE-FIX] Fixes generated (NOT saved)', {
            companyId,
            scenarioId,
            scenarioName: targetScenario.name,
            fixesGenerated: fixes.length,
            tokensUsed
        });
        
        res.json({
            success: true,
            // The fixed scenario object (ready for Global Brain prefill)
            fixedScenario,
            // Original scenario for comparison
            originalScenario: targetScenario,
            // Template/category info for Global Brain navigation
            navigation: {
                templateId: template._id?.toString(),
                templateName: template.name,
                categoryId: categoryData?.id || categoryData?._id?.toString(),
                categoryIndex,
                categoryName: categoryData?.name,
                scenarioIndex,
                scenarioId: targetScenario.scenarioId || targetScenario._id?.toString()
            },
            // Fix details
            fixes: fixes.map(f => ({
                field: f.field,
                oldValue: f.oldValue,
                newValue: f.newValue,
                severity: f.severity,
                message: f.message
            })),
            // Stats
            stats: {
                totalViolations: violations?.length || 0,
                fixesGenerated: fixes.length,
                skipped: {
                    infoLevel: skipped.infoLevel,
                    nonFixable: skipped.nonFixable,
                    noField: skipped.noField
                },
                tokensUsed
            },
            message: fixes.length > 0 
                ? `Generated ${fixes.length} fixes - open in Global Brain to review and save`
                : `No fixable issues found (${skipped.infoLevel} info-only, ${skipped.nonFixable} admin-owned)`
        });
        
    } catch (error) {
        logger.error('[AUDIT GENERATE-FIX] Error', { 
            companyId, 
            scenarioId,
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            error: 'Failed to generate fixes', 
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

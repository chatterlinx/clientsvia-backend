// ============================================================================
// MISSING SCENARIO DETECTOR SERVICE
// ============================================================================
//
// Purpose: Detect patterns in Tier 3 (LLM fallback) calls that indicate 
//          missing scenarios in templates. Self-improving AI system that
//          learns from gaps in rule-based matching.
//
// Algorithm:
//   1. Fetch Tier 3 calls from past 7 days for a template
//   2. Group calls by semantic similarity using embeddings
//   3. Clusters with 3+ similar calls indicate a pattern
//   4. Ask LLM to analyze cluster and suggest scenario structure
//   5. Create suggestion in SuggestionKnowledgeBase for developer review
//
// Features:
//   - Configurable time window and minimum call threshold
//   - Semantic clustering to find similar caller intents
//   - LLM-powered scenario generation with pre-filled fields
//   - Cost tracking and impact estimation
//   - Notification alerts for high-value suggestions
//
// Dependencies:
//   - v2AIAgentCallLog: Call history with tier routing data
//   - SuggestionKnowledgeBase: Storage for generated suggestions
//   - OpenAI API: For embeddings and scenario generation
//   - AdminNotificationService: Alert developers of new suggestions
//
// ============================================================================

// ============================================================================
// IMPORTS
// ============================================================================

const logger = require('../utils/logger');
const v2AIAgentCallLog = require('../models/v2AIAgentCallLog');
const SuggestionKnowledgeBase = require('../models/SuggestionKnowledgeBase');
const AdminNotificationService = require('./AdminNotificationService');

// Use centralized OpenAI client (handles missing API key gracefully)
const openaiClient = require('../config/openai');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Analysis window (how far back to look for patterns)
    analysisWindowDays: 7,
    
    // Minimum calls to form a pattern
    minCallsForPattern: 3,
    
    // Semantic similarity threshold (0-1, higher = more similar)
    similarityThreshold: 0.85,
    
    // Maximum clusters to process per run (prevent overwhelming developers)
    maxClustersPerRun: 5,
    
    // Confidence thresholds
    minConfidence: 0.7,
    highConfidenceThreshold: 0.9
};

// Helper to get OpenAI client (returns null if not configured)
function getOpenAIClient() {
    return openaiClient;
}

// ============================================================================
// CORE DETECTION FUNCTION
// ============================================================================

/**
 * Detect missing scenarios from Tier 3 call patterns
 * 
 * @param {String} templateId - Template to analyze
 * @param {Object} options - Analysis options
 * @param {Number} options.daysBack - Days to look back (default: 7)
 * @param {Number} options.minCalls - Min calls to form pattern (default: 3)
 * @param {Number} options.similarityThreshold - Similarity threshold (default: 0.85)
 * @returns {Promise<Object>} Analysis results with generated suggestions
 * 
 * @example
 * const result = await analyzeMissingScenarios('abc123', { minCalls: 5 });
 * console.log(`Created ${result.suggestionsCreated} new scenario suggestions`);
 */
async function analyzeMissingScenarios(templateId, options = {}) {
    const startTime = Date.now();
    
    try {
        // ────────────────────────────────────────────────────────────────────
        // STEP 1: Validate inputs
        // ────────────────────────────────────────────────────────────────────
        
        if (!templateId) {
            throw new Error('templateId is required for missing scenario analysis');
        }
        
        logger.info('[MISSING SCENARIO DETECTOR] Starting analysis', {
            templateId,
            options
        });
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 2: Fetch Tier 3 calls
        // ────────────────────────────────────────────────────────────────────
        
        const tier3Calls = await fetchTier3Calls(templateId, options);
        
        if (tier3Calls.length === 0) {
            logger.info('[MISSING SCENARIO DETECTOR] No Tier 3 calls found', { templateId });
            return {
                success: true,
                suggestionsCreated: 0,
                message: 'No Tier 3 calls found in analysis window',
                analysisTime: Date.now() - startTime
            };
        }
        
        logger.info('[MISSING SCENARIO DETECTOR] Found Tier 3 calls', {
            count: tier3Calls.length,
            templateId
        });
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 3: Group by semantic similarity
        // ────────────────────────────────────────────────────────────────────
        
        const clusters = await groupCallsBySimilarity(tier3Calls, options);
        
        logger.info('[MISSING SCENARIO DETECTOR] Clustered calls', {
            clusterCount: clusters.length,
            templateId
        });
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 4: Generate suggestions for significant patterns
        // ────────────────────────────────────────────────────────────────────
        
        const suggestions = await generateSuggestionsFromClusters(
            clusters,
            templateId,
            options
        );
        
        logger.info('[MISSING SCENARIO DETECTOR] Analysis complete', {
            tier3Calls: tier3Calls.length,
            clusters: clusters.length,
            suggestionsCreated: suggestions.length,
            analysisTime: Date.now() - startTime,
            templateId
        });
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 5: Send notification if high-value suggestions found
        // ────────────────────────────────────────────────────────────────────
        
        if (suggestions.length > 0) {
            await notifyDevelopersOfSuggestions(suggestions, templateId);
        }
        
        return {
            success: true,
            suggestionsCreated: suggestions.length,
            tier3CallsAnalyzed: tier3Calls.length,
            clustersFound: clusters.length,
            analysisTime: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[MISSING SCENARIO DETECTOR] Error during analysis', {
            templateId,
            error: error.message,
            stack: error.stack
        });
        
        // Send critical notification
        try {
            await AdminNotificationService.sendAlert({
                code: 'MISSING_SCENARIO_DETECTION_FAILED',
                severity: 'CRITICAL',
                title: '❌ Missing Scenario Detection Failed',
                message: `Failed to analyze Tier 3 patterns for missing scenarios`,
                context: {
                    templateId,
                    error: error.message
                }
            });
        } catch (notifError) {
            logger.error('[MISSING SCENARIO DETECTOR] Failed to send error notification', {
                error: notifError.message
            });
        }
        
        throw error;
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Fetch Tier 3 fallback calls for analysis
 * @private
 */
async function fetchTier3Calls(templateId, options) {
    const daysBack = options.daysBack || CONFIG.analysisWindowDays;
    const cutoffDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));
    
    // Fetch calls that fell back to Tier 3 (LLM)
    const calls = await v2AIAgentCallLog.find({
        templateId,
        tier: 3,
        timestamp: { $gte: cutoffDate }
    }).select('transcript userInput companyId companyName timestamp cost').lean();
    
    return calls;
}

/**
 * Group calls by semantic similarity
 * @private
 */
async function groupCallsBySimilarity(calls, options) {
    const threshold = options.similarityThreshold || CONFIG.similarityThreshold;
    const minCalls = options.minCalls || CONFIG.minCallsForPattern;
    
    // Check if OpenAI is available for embeddings
    const openai = getOpenAIClient();
    if (!openai) {
        logger.warn('[MISSING SCENARIO DETECTOR] OpenAI not configured, using simple keyword clustering');
        return await fallbackKeywordClustering(calls, minCalls);
    }
    
    try {
        // Get embeddings for all calls
        const embeddings = await Promise.all(
            calls.map(async (call) => {
                const text = call.userInput || call.transcript || '';
                const response = await openai.embeddings.create({
                    model: 'text-embedding-ada-002',
                    input: text.substring(0, 8000) // Limit to 8000 chars
                });
                return {
                    call,
                    embedding: response.data[0].embedding
                };
            })
        );
        
        // Cluster by cosine similarity
        const clusters = [];
        const used = new Set();
        
        for (let i = 0; i < embeddings.length; i++) {
            if (used.has(i)) continue;
            
            const cluster = [embeddings[i]];
            used.add(i);
            
            for (let j = i + 1; j < embeddings.length; j++) {
                if (used.has(j)) continue;
                
                const similarity = cosineSimilarity(
                    embeddings[i].embedding,
                    embeddings[j].embedding
                );
                
                if (similarity >= threshold) {
                    cluster.push(embeddings[j]);
                    used.add(j);
                }
            }
            
            // Only keep clusters with enough calls
            if (cluster.length >= minCalls) {
                clusters.push({
                    calls: cluster.map(e => e.call),
                    size: cluster.length,
                    representativeText: cluster[0].call.userInput || cluster[0].call.transcript
                });
            }
        }
        
        // Sort by cluster size (largest first)
        clusters.sort((a, b) => b.size - a.size);
        
        // Limit clusters
        return clusters.slice(0, CONFIG.maxClustersPerRun);
        
    } catch (error) {
        logger.error('[MISSING SCENARIO DETECTOR] Embedding clustering failed, using fallback', {
            error: error.message
        });
        return await fallbackKeywordClustering(calls, minCalls);
    }
}

/**
 * Fallback clustering using simple keyword matching (when OpenAI unavailable)
 * @private
 */
async function fallbackKeywordClustering(calls, minCalls) {
    const clusters = [];
    const keywordMap = new Map();
    
    // Group by common keywords
    for (const call of calls) {
        const text = (call.userInput || call.transcript || '').toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length > 4);
        
        for (const word of words) {
            if (!keywordMap.has(word)) {
                keywordMap.set(word, []);
            }
            keywordMap.get(word).push(call);
        }
    }
    
    // Find clusters
    for (const [keyword, callList] of keywordMap.entries()) {
        if (callList.length >= minCalls) {
            clusters.push({
                calls: callList,
                size: callList.length,
                representativeText: callList[0].userInput || callList[0].transcript,
                keyword
            });
        }
    }
    
    // Sort and limit
    clusters.sort((a, b) => b.size - a.size);
    return clusters.slice(0, CONFIG.maxClustersPerRun);
}

/**
 * Calculate cosine similarity between two embeddings
 * @private
 */
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate scenario suggestions from call clusters using LLM
 * @private
 */
async function generateSuggestionsFromClusters(clusters, templateId, options) {
    const suggestions = [];
    const openai = getOpenAIClient();
    
    if (!openai) {
        logger.warn('[MISSING SCENARIO DETECTOR] OpenAI not configured, cannot generate scenarios');
        return suggestions;
    }
    
    for (const cluster of clusters) {
        try {
            // Ask LLM to suggest scenario
            const scenarioSuggestion = await askLLMToSuggestScenario(cluster, openai);
            
            if (!scenarioSuggestion) continue;
            
            // Create suggestion in database
            const suggestion = await SuggestionKnowledgeBase.create({
                type: 'missing_scenario',
                templateId,
                
                // Pre-filled scenario details from LLM
                suggestedScenarioName: scenarioSuggestion.name,
                suggestedCategory: scenarioSuggestion.category,
                suggestedKeywords: scenarioSuggestion.keywords,
                suggestedNegativeKeywords: scenarioSuggestion.negativeKeywords || [],
                suggestedResponse: scenarioSuggestion.response,
                suggestedActionHook: scenarioSuggestion.actionHook,
                suggestedBehavior: scenarioSuggestion.behavior,
                
                // Context
                confidence: scenarioSuggestion.confidence,
                priority: scenarioSuggestion.confidence >= CONFIG.highConfidenceThreshold ? 'high' : 'medium',
                frequency: cluster.size,
                contextPhrases: cluster.calls.slice(0, 5).map(c => c.userInput || c.transcript),
                estimatedImpact: Math.min(Math.round((cluster.size / 100) * 100), 50), // Max 50% impact
                
                // LLM reasoning
                llmReasoning: scenarioSuggestion.reasoning,
                llmModel: 'gpt-4o',
                sourceCallId: cluster.calls[0]._id,
                
                // Status
                status: 'pending',
                createdAt: new Date()
            });
            
            suggestions.push(suggestion);
            
            logger.info('[MISSING SCENARIO DETECTOR] Created missing scenario suggestion', {
                suggestionId: suggestion._id,
                scenarioName: scenarioSuggestion.name,
                confidence: scenarioSuggestion.confidence,
                clusterSize: cluster.size
            });
            
        } catch (error) {
            logger.error('[MISSING SCENARIO DETECTOR] Failed to generate suggestion for cluster', {
                error: error.message,
                clusterSize: cluster.size
            });
        }
    }
    
    return suggestions;
}

/**
 * Ask LLM to analyze cluster and suggest scenario
 * @private
 */
async function askLLMToSuggestScenario(cluster, openai) {
    const exampleCalls = cluster.calls.slice(0, 5).map((c, i) => 
        `Call ${i + 1}: "${c.userInput || c.transcript}"`
    ).join('\n');
    
    const prompt = `You are analyzing customer service call patterns to suggest new scenarios for an AI assistant.

CONTEXT:
- These ${cluster.size} calls all fell back to LLM (expensive) because no rule-based scenario matched
- They appear to share a common intent or topic
- We need to create a new scenario to handle this pattern efficiently

EXAMPLE CALLS:
${exampleCalls}

TASK:
Analyze these calls and suggest a new scenario. Respond in JSON format:

{
  "name": "Brief, descriptive scenario name",
  "category": "Best category (Emergency Service, Appointment Booking, Pricing Questions, etc.)",
  "keywords": ["array", "of", "keywords", "for", "matching"],
  "negativeKeywords": ["words", "that", "indicate", "different", "intent"],
  "response": "AI response template with [PLACEHOLDERS] for dynamic data",
  "actionHook": "schedule-appointment | check-pricing | emergency-dispatch | general-info | null",
  "behavior": "Professional | Empathetic | Urgent | Friendly | Technical",
  "confidence": 0.85,
  "reasoning": "Detailed explanation of why this scenario is needed"
}

GUIDELINES:
- Name should be clear and specific (e.g., "Water Heater Emergency" not "Plumbing Issue")
- Keywords should capture variations of how customers describe this issue
- Negative keywords prevent false matches (e.g., "cold" for water heater, since that's different)
- Response should be professional, helpful, and use [PLACEHOLDER] syntax
- Confidence should be 0.7-1.0 based on how clear the pattern is
- Reasoning should explain the gap and why this scenario would help

Respond ONLY with valid JSON, no additional text.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are an expert at analyzing customer service patterns and designing conversation scenarios.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3, // Lower temperature for more consistent output
            response_format: { type: 'json_object' }
        });
        
        const suggestion = JSON.parse(response.choices[0].message.content);
        
        // Validate required fields
        if (!suggestion.name || !suggestion.keywords || !suggestion.response) {
            logger.warn('[MISSING SCENARIO DETECTOR] LLM response missing required fields', {
                suggestion
            });
            return null;
        }
        
        return suggestion;
        
    } catch (error) {
        logger.error('[MISSING SCENARIO DETECTOR] LLM scenario generation failed', {
            error: error.message
        });
        return null;
    }
}

/**
 * Notify developers of new suggestions
 * @private
 */
async function notifyDevelopersOfSuggestions(suggestions, templateId) {
    try {
        const highPriority = suggestions.filter(s => s.priority === 'high').length;
        const totalCallsSaved = suggestions.reduce((sum, s) => sum + s.frequency, 0);
        const estimatedMonthlySavings = (totalCallsSaved * 0.02 * 4).toFixed(2);
        
        await AdminNotificationService.sendAlert({
            code: 'AI_MISSING_SCENARIOS_DETECTED',
            severity: 'INFO',
            title: '🟣 New AI Suggestions: Missing Scenarios',
            message: `Detected ${suggestions.length} missing scenario patterns from Tier 3 calls`,
            context: {
                templateId,
                suggestionsCount: suggestions.length,
                highPriority,
                callsAffected: totalCallsSaved,
                estimatedMonthlySavings: `$${estimatedMonthlySavings}`
            }
        });
        
    } catch (error) {
        logger.error('[MISSING SCENARIO DETECTOR] Failed to send notification', {
            error: error.message
        });
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    analyzeMissingScenarios,
    CONFIG
};


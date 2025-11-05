/**
 * ============================================================================
 * LEARNING ANALYZER - LLM ANALYSIS FOR TIER 3 EVENTS
 * ============================================================================
 * 
 * PURPOSE: Generate structured suggestions explaining why Tier 3 was triggered
 * 
 * FLOW:
 * 1. Tier 3 LLM responds to customer
 * 2. LearningAnalyzer analyzes the scores/thresholds/context
 * 3. Returns structured suggestion: { type, changes, reason, confidence, priority }
 * 4. Saved to ProductionLLMSuggestion for admin review
 * 
 * OUTPUT TYPES:
 * - ADD_KEYWORDS: Missing keywords in scenario triggers
 * - ADD_SYNONYMS: Missing synonyms in global template
 * - NEW_SCENARIO: Completely new use case
 * - UPDATE_SCENARIO: Existing scenario needs expansion
 * - UPDATE_VARIABLE: Variable/placeholder issue
 * - MARK_OUT_OF_SCOPE: Customer asking something out of scope
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

/**
 * Generate a structured suggestion for why Tier 3 fired
 * 
 * @param {Object} params
 * @param {string} params.userText - What the customer said
 * @param {number} params.tier1Score - Tier 1 confidence score
 * @param {number} params.tier2Score - Tier 2 confidence score
 * @param {number} params.tier1Threshold - Tier 1 threshold
 * @param {number} params.tier2Threshold - Tier 2 threshold
 * @param {Object} params.matchedScenario - Scenario that LLM matched (if any)
 * @param {string} params.templateName - Template name
 * @param {Function} params.callLLM - LLM gateway function
 * 
 * @returns {Promise<Object>} { type, changes, reason, confidence, priority }
 */
async function generateSuggestionAnalysis({
    userText,
    tier1Score,
    tier2Score,
    tier1Threshold,
    tier2Threshold,
    matchedScenario,
    templateName,
    callLLM
}) {
    try {
        logger.info('[LEARNING ANALYZER] Generating suggestion analysis', {
            userText: userText?.substring(0, 100),
            tier1Score,
            tier2Score,
            matchedScenario: matchedScenario?.name
        });
        
        // Build analysis prompt
        const prompt = `You are helping improve an AI phone agent system.

Caller said: "${userText}"

Current Performance:
- Tier 1 (keyword/rule) score: ${tier1Score || 0}
- Tier 2 (semantic) score: ${tier2Score || 0}
- Tier 1 threshold: ${tier1Threshold || 0.80}
- Tier 2 threshold: ${tier2Threshold || 0.60}
- Matched scenario: ${matchedScenario?.name || 'none'}
- Template: ${templateName || 'unknown'}

The LLM (Tier 3) had to be invoked because neither Tier 1 nor Tier 2 reached their thresholds.

Analyze WHY Tier 3 was needed and propose ONE actionable improvement to prevent future Tier 3 usage for similar queries.

Choose ONE suggestion type from:
- "ADD_KEYWORDS": Add missing keywords/triggers to existing scenario
- "ADD_SYNONYMS": Add missing synonyms to global template
- "NEW_SCENARIO": Create entirely new scenario for this use case
- "UPDATE_SCENARIO": Expand existing scenario's responses
- "UPDATE_VARIABLE": Fix variable/placeholder issues
- "MARK_OUT_OF_SCOPE": Customer asked something out of scope

Return ONLY valid JSON in this exact shape:

{
  "type": "ADD_KEYWORDS",
  "changes": ["specific keyword 1", "specific keyword 2"],
  "reason": "Brief explanation of why Tier 3 was needed and what's missing",
  "confidence": 0.85,
  "priority": "high"
}

Rules:
- "changes" array should contain 1-5 specific actionable items
- "reason" should be 1-2 sentences max
- "confidence" is 0.0-1.0 (how sure you are this fix will help)
- "priority" is "high" | "medium" | "low" based on impact
- Return ONLY the JSON object, no markdown, no explanation`;

        // Call LLM for analysis
        const rawResponse = await callLLM(prompt, 'gpt-4o-mini');
        
        // Parse response
        let analysis;
        if (typeof rawResponse === 'string') {
            // Try to extract JSON from markdown code blocks
            const jsonMatch = rawResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                             rawResponse.match(/(\{[\s\S]*?\})/);
            
            if (jsonMatch) {
                analysis = JSON.parse(jsonMatch[1]);
            } else {
                throw new Error('No JSON found in response');
            }
        } else {
            analysis = rawResponse;
        }
        
        // Validate analysis structure
        if (!analysis.type || !analysis.reason) {
            throw new Error('Invalid analysis structure');
        }
        
        // Ensure required fields
        analysis.changes = analysis.changes || [];
        analysis.confidence = analysis.confidence || 0.7;
        analysis.priority = analysis.priority || 'medium';
        
        logger.info('[LEARNING ANALYZER] Analysis generated successfully', {
            type: analysis.type,
            changesCount: analysis.changes.length,
            priority: analysis.priority
        });
        
        return analysis;
        
    } catch (error) {
        logger.error('[LEARNING ANALYZER] Failed to generate analysis:', error.message);
        
        // Return safe fallback
        return {
            type: 'UNKNOWN',
            changes: [],
            reason: `Tier 3 was needed but analysis failed: ${error.message}`,
            confidence: 0.5,
            priority: 'medium'
        };
    }
}

/**
 * Synchronous fallback when LLM analysis is not available
 * Uses heuristics based on scores
 */
function generateBasicSuggestion({
    userText,
    tier1Score,
    tier2Score,
    tier1Threshold,
    tier2Threshold,
    matchedScenario
}) {
    const tier1Gap = (tier1Threshold || 0.80) - (tier1Score || 0);
    const tier2Gap = (tier2Threshold || 0.60) - (tier2Score || 0);
    
    // Heuristic: If Tier 1 was very close, suggest keywords
    if (tier1Score > 0.5) {
        return {
            type: 'ADD_KEYWORDS',
            changes: [userText?.substring(0, 50) || 'unknown phrase'],
            reason: `Tier 1 score (${tier1Score?.toFixed(2)}) was close but missed threshold (${tier1Threshold}). Add keywords.`,
            confidence: 0.6,
            priority: tier1Gap < 0.15 ? 'high' : 'medium'
        };
    }
    
    // Heuristic: If Tier 2 was reasonable, suggest synonyms
    if (tier2Score > 0.4) {
        return {
            type: 'ADD_SYNONYMS',
            changes: [],
            reason: `Tier 2 semantic score (${tier2Score?.toFixed(2)}) suggests meaning was understood but phrasing differs. Add synonyms.`,
            confidence: 0.5,
            priority: 'medium'
        };
    }
    
    // Default: New scenario needed
    return {
        type: 'NEW_SCENARIO',
        changes: [],
        reason: `Both Tier 1 (${tier1Score?.toFixed(2)}) and Tier 2 (${tier2Score?.toFixed(2)}) scores were low. May need new scenario.`,
        confidence: 0.4,
        priority: 'low'
    };
}

module.exports = {
    generateSuggestionAnalysis,
    generateBasicSuggestion
};


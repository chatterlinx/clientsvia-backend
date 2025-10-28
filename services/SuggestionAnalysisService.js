// ============================================================================
// SUGGESTION ANALYSIS SERVICE
// ============================================================================
//
// Purpose: Fetch and format detailed context for AI suggestions to enable
//          informed developer review. Provides call transcripts, LLM reasoning,
//          and impact metrics for the analysis modal.
//
// Features:
//   - Fetch full suggestion context (call details, transcript, LLM reasoning)
//   - Format transcripts with timestamps for readability
//   - Calculate cost savings and performance impact
//   - Link suggestion to source call for traceability
//
// Dependencies:
//   - SuggestionKnowledgeBase: Suggestion storage
//   - v2AIAgentCallLog: Call history
//   - GlobalInstantResponseTemplate: Template metadata
//
// ============================================================================

// ============================================================================
// IMPORTS
// ============================================================================

const logger = require('../utils/logger');
const SuggestionKnowledgeBase = require('../models/SuggestionKnowledgeBase');
const v2AIAgentCallLog = require('../models/v2AIAgentCallLog');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const AdminNotificationService = require('./AdminNotificationService');

// ============================================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Fetch full context for a suggestion (call transcript + LLM reasoning)
 * 
 * @param {String} suggestionId - Suggestion ID
 * @returns {Promise<Object>} Complete context for analysis modal
 * 
 * @example
 * const context = await fetchSuggestionContext('abc123');
 * console.log(context.call.transcript); // Full call transcript
 * console.log(context.suggestion.llmReasoning); // Why LLM suggested this
 */
async function fetchSuggestionContext(suggestionId) {
    try {
        // ────────────────────────────────────────────────────────────────────
        // STEP 1: Validate input
        // ────────────────────────────────────────────────────────────────────
        
        if (!suggestionId) {
            throw new Error('suggestionId is required');
        }
        
        logger.info('[SUGGESTION ANALYSIS] Fetching context', { suggestionId });
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 2: Fetch suggestion with populated references
        // ────────────────────────────────────────────────────────────────────
        
        const suggestion = await SuggestionKnowledgeBase.findById(suggestionId)
            .populate('sourceCallId')
            .populate('templateId')
            .lean();
        
        if (!suggestion) {
            throw new Error(`Suggestion not found: ${suggestionId}`);
        }
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 3: Format call details
        // ────────────────────────────────────────────────────────────────────
        
        const call = suggestion.sourceCallId ? {
            companyId: suggestion.sourceCallId.companyId,
            companyName: suggestion.sourceCallId.companyName,
            callerPhone: suggestion.sourceCallId.callerPhone || 'Unknown',
            timestamp: suggestion.sourceCallId.timestamp,
            duration: suggestion.sourceCallId.duration,
            transcript: formatTranscript(suggestion.sourceCallId.transcript),
            rawTranscript: suggestion.sourceCallId.transcript,
            tier: suggestion.sourceCallId.tier,
            matchedScenario: suggestion.sourceCallId.matchedScenario,
            cost: suggestion.sourceCallId.cost
        } : null;
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 4: Format suggestion details
        // ────────────────────────────────────────────────────────────────────
        
        const formattedSuggestion = {
            _id: suggestion._id,
            type: suggestion.type,
            
            // Type-specific fields
            technicalTerm: suggestion.technicalTerm,
            colloquialTerm: suggestion.colloquialTerm,
            fillerWord: suggestion.fillerWord,
            keyword: suggestion.keyword,
            negativeKeyword: suggestion.negativeKeyword,
            
            // Missing scenario fields
            suggestedScenarioName: suggestion.suggestedScenarioName,
            suggestedCategory: suggestion.suggestedCategory,
            suggestedKeywords: suggestion.suggestedKeywords,
            suggestedNegativeKeywords: suggestion.suggestedNegativeKeywords,
            suggestedResponse: suggestion.suggestedResponse,
            suggestedActionHook: suggestion.suggestedActionHook,
            suggestedBehavior: suggestion.suggestedBehavior,
            
            // Metadata
            confidence: suggestion.confidence,
            priority: suggestion.priority,
            frequency: suggestion.frequency,
            estimatedImpact: suggestion.estimatedImpact,
            contextPhrases: suggestion.contextPhrases,
            
            // LLM context
            llmReasoning: suggestion.llmReasoning,
            llmModel: suggestion.llmModel,
            
            // Status
            status: suggestion.status,
            createdAt: suggestion.createdAt
        };
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 5: Calculate impact metrics
        // ────────────────────────────────────────────────────────────────────
        
        const impactMetrics = calculateImpactMetrics(suggestion);
        
        // ────────────────────────────────────────────────────────────────────
        // STEP 6: Format template info
        // ────────────────────────────────────────────────────────────────────
        
        const template = suggestion.templateId ? {
            _id: suggestion.templateId._id,
            name: suggestion.templateId.name,
            version: suggestion.templateId.version
        } : null;
        
        logger.info('[SUGGESTION ANALYSIS] Context fetched successfully', {
            suggestionId,
            hasCall: !!call,
            hasReasoning: !!suggestion.llmReasoning
        });
        
        return {
            success: true,
            suggestion: formattedSuggestion,
            call,
            template,
            impactMetrics
        };
        
    } catch (error) {
        logger.error('[SUGGESTION ANALYSIS] Error fetching context', {
            suggestionId,
            error: error.message
        });
        
        // Send error notification
        try {
            await AdminNotificationService.sendAlert({
                code: 'SUGGESTION_ANALYSIS_FETCH_FAILED',
                severity: 'WARNING',
                title: '⚠️ Failed to Load Suggestion Context',
                message: `Could not fetch context for suggestion: ${error.message}`,
                context: { suggestionId, error: error.message }
            });
        } catch (notifError) {
            logger.error('[SUGGESTION ANALYSIS] Failed to send error notification', {
                error: notifError.message
            });
        }
        
        throw error;
    }
}

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Format call transcript for display with timestamps
 * 
 * @param {String} transcript - Raw transcript
 * @returns {Array} Formatted transcript lines with timestamps
 * 
 * @example
 * const formatted = formatTranscript("00:00 AI: Hello\n00:03 Caller: Hi");
 * // Returns: [{ timestamp: "00:00", speaker: "AI", message: "Hello" }, ...]
 */
function formatTranscript(transcript) {
    if (!transcript) {
        return [];
    }
    
    try {
        // Split by lines
        const lines = transcript.split('\n').filter(line => line.trim());
        
        const formatted = lines.map(line => {
            // Try to parse format: "00:00 Speaker: Message"
            const match = line.match(/^(\d{2}:\d{2})\s+([^:]+):\s*(.+)$/);
            
            if (match) {
                return {
                    timestamp: match[1],
                    speaker: match[2].trim(),
                    message: match[3].trim()
                };
            }
            
            // Fallback: return as-is
            return {
                timestamp: null,
                speaker: null,
                message: line.trim()
            };
        });
        
        return formatted;
        
    } catch (error) {
        logger.error('[SUGGESTION ANALYSIS] Error formatting transcript', {
            error: error.message
        });
        
        // Return raw transcript as single entry
        return [{
            timestamp: null,
            speaker: null,
            message: transcript
        }];
    }
}

/**
 * Format LLM reasoning for display (convert markdown, add structure)
 * 
 * @param {String} reasoning - Raw LLM reasoning
 * @returns {String} Formatted HTML-safe reasoning
 */
function formatLLMReasoning(reasoning) {
    if (!reasoning) {
        return 'No reasoning provided by LLM.';
    }
    
    // Convert markdown-style formatting to HTML
    let formatted = reasoning
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold
        .replace(/\*(.+?)\*/g, '<em>$1</em>') // Italic
        .replace(/\n\n/g, '</p><p>') // Paragraphs
        .replace(/\n/g, '<br>'); // Line breaks
    
    // Wrap in paragraph tags
    formatted = `<p>${formatted}</p>`;
    
    return formatted;
}

// ============================================================================
// IMPACT CALCULATION
// ============================================================================

/**
 * Calculate impact metrics for a suggestion
 * 
 * @param {Object} suggestion - Suggestion document
 * @returns {Object} Impact metrics
 */
function calculateImpactMetrics(suggestion) {
    const frequency = suggestion.frequency || 1;
    
    // Tier 3 LLM cost per call
    const tier3CostPerCall = 0.02;
    
    // Calculate savings
    const totalCostSoFar = frequency * tier3CostPerCall;
    const weeklySavings = (frequency / 7) * 4 * tier3CostPerCall; // Assuming pattern continues
    const monthlySavings = weeklySavings * 4;
    const yearlySavings = monthlySavings * 12;
    
    // Response time improvement
    const tier3ResponseTime = 2000; // 2s average for LLM
    const tier1ResponseTime = 100; // 100ms for rule-based
    const timeImprovement = tier3ResponseTime - tier1ResponseTime;
    
    return {
        // Cost metrics
        totalCostSoFar: totalCostSoFar.toFixed(2),
        weeklySavings: weeklySavings.toFixed(2),
        monthlySavings: monthlySavings.toFixed(2),
        yearlySavings: yearlySavings.toFixed(2),
        
        // Performance metrics
        responseTimeImprovement: `${timeImprovement}ms`,
        responseTimeImprovementPercent: Math.round((timeImprovement / tier3ResponseTime) * 100),
        
        // Volume metrics
        callsAffected: frequency,
        estimatedWeeklyCalls: Math.round(frequency / 7),
        estimatedMonthlyCalls: Math.round((frequency / 7) * 4)
    };
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Fetch contexts for multiple suggestions (for batch analysis)
 * 
 * @param {Array<String>} suggestionIds - Array of suggestion IDs
 * @returns {Promise<Array>} Array of contexts
 */
async function fetchMultipleSuggestionContexts(suggestionIds) {
    if (!suggestionIds || !Array.isArray(suggestionIds)) {
        throw new Error('suggestionIds must be an array');
    }
    
    logger.info('[SUGGESTION ANALYSIS] Fetching multiple contexts', {
        count: suggestionIds.length
    });
    
    const contexts = await Promise.all(
        suggestionIds.map(id => fetchSuggestionContext(id).catch(err => {
            logger.error('[SUGGESTION ANALYSIS] Failed to fetch context', {
                suggestionId: id,
                error: err.message
            });
            return null;
        }))
    );
    
    // Filter out failures
    return contexts.filter(c => c !== null);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    fetchSuggestionContext,
    fetchMultipleSuggestionContexts,
    formatTranscript,
    formatLLMReasoning,
    calculateImpactMetrics
};


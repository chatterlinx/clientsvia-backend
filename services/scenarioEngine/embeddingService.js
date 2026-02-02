/**
 * ============================================================================
 * SCENARIO EMBEDDING SERVICE
 * ============================================================================
 * 
 * Provides embedding generation and similarity comparison for scenarios.
 * Used by:
 *   - Deep Audit (duplicate scan)
 *   - Scenario save gate (prevention)
 *   - Generator (pre-check)
 * 
 * ============================================================================
 */

const OpenAI = require('openai');
const logger = require('../../utils/logger');

// Lazy-load OpenAI client
let openai = null;
function getOpenAI() {
    if (!openai) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openai;
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

/**
 * Build the text to embed for a scenario
 * Combines the most semantically meaningful fields
 */
function buildEmbeddingText(scenario) {
    const parts = [];
    
    // Scenario name/title is most important
    if (scenario.scenarioName || scenario.name) {
        parts.push(scenario.scenarioName || scenario.name);
    }
    
    // Add first few triggers (most representative)
    if (scenario.triggers && scenario.triggers.length > 0) {
        const topTriggers = scenario.triggers.slice(0, 5).join('. ');
        parts.push(topTriggers);
    }
    
    // Add first quick reply (captures intent)
    if (scenario.quickReplies && scenario.quickReplies.length > 0) {
        parts.push(scenario.quickReplies[0]);
    }
    
    // Add scenario type for context
    if (scenario.scenarioType) {
        parts.push(`Type: ${scenario.scenarioType}`);
    }
    
    return parts.join(' | ');
}

/**
 * Get embedding vector for text using OpenAI
 */
async function getEmbedding(text) {
    try {
        const response = await getOpenAI().embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
            dimensions: 512  // Smaller dimension for efficiency
        });
        
        return response.data[0].embedding;
    } catch (error) {
        logger.error('[EMBEDDING] Failed to get embedding', { error: error.message });
        throw error;
    }
}

/**
 * Get embedding for a scenario
 */
async function getScenarioEmbedding(scenario) {
    const text = buildEmbeddingText(scenario);
    return getEmbedding(text);
}

/**
 * Batch get embeddings for multiple scenarios
 * More efficient than individual calls
 */
async function batchGetEmbeddings(scenarios) {
    const texts = scenarios.map(s => buildEmbeddingText(s));
    
    try {
        const response = await getOpenAI().embeddings.create({
            model: 'text-embedding-3-small',
            input: texts,
            dimensions: 512
        });
        
        return response.data.map(d => d.embedding);
    } catch (error) {
        logger.error('[EMBEDDING] Batch embedding failed', { error: error.message, count: scenarios.length });
        throw error;
    }
}

// ============================================================================
// SIMILARITY COMPARISON
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
        return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    
    return dotProduct / denominator;
}

/**
 * Find scenarios similar to a given scenario
 * @param {Object} scenario - The scenario to compare
 * @param {Array} candidates - Array of {scenario, embedding} objects
 * @param {number} threshold - Similarity threshold (default 0.86)
 * @returns {Array} Sorted array of {scenario, similarity} above threshold
 */
function findSimilar(scenarioEmbedding, candidates, threshold = 0.86) {
    const results = [];
    
    for (const candidate of candidates) {
        if (!candidate.embedding) continue;
        
        const similarity = cosineSimilarity(scenarioEmbedding, candidate.embedding);
        
        if (similarity >= threshold) {
            results.push({
                scenario: candidate.scenario,
                similarity: Math.round(similarity * 100) / 100
            });
        }
    }
    
    return results.sort((a, b) => b.similarity - a.similarity);
}

// ============================================================================
// TRIGGER & RESPONSE ANALYSIS (Feb 2026)
// ============================================================================

/**
 * Calculate trigger overlap between two scenarios
 * Returns detailed overlap info for duplicate analysis
 */
function calculateTriggerOverlap(leaderScenario, duplicateScenario) {
    const leaderTriggers = (leaderScenario.triggers || []).map(t => t.toLowerCase().trim());
    const dupTriggers = (duplicateScenario.triggers || []).map(t => t.toLowerCase().trim());
    
    const leaderSet = new Set(leaderTriggers);
    const dupSet = new Set(dupTriggers);
    
    // Find shared triggers (exact match)
    const shared = leaderTriggers.filter(t => dupSet.has(t));
    
    // Find fuzzy matches (one contains the other)
    const fuzzyShared = [];
    for (const lt of leaderTriggers) {
        for (const dt of dupTriggers) {
            if (lt !== dt && (lt.includes(dt) || dt.includes(lt))) {
                fuzzyShared.push({ leader: lt, duplicate: dt });
            }
        }
    }
    
    const totalUnique = new Set([...leaderTriggers, ...dupTriggers]).size;
    const overlapPercent = totalUnique > 0 
        ? Math.round((shared.length / totalUnique) * 100) 
        : 0;
    
    return {
        shared: shared.length,
        fuzzyMatches: fuzzyShared.length,
        leaderTotal: leaderTriggers.length,
        duplicateTotal: dupTriggers.length,
        overlapPercent,
        sharedTriggers: shared.slice(0, 5),  // First 5 for readability
        confusionRisk: overlapPercent >= 50 ? 'HIGH' : overlapPercent >= 25 ? 'MEDIUM' : 'LOW'
    };
}

/**
 * Check if responses are similar or divergent
 * Divergent responses on same intent = dangerous for UX
 */
function analyzeResponseDivergence(leaderScenario, duplicateScenario) {
    const leaderResponse = (leaderScenario.quickReplies?.[0] || leaderScenario.fullReplies?.[0] || '').toLowerCase();
    const dupResponse = (duplicateScenario.quickReplies?.[0] || duplicateScenario.fullReplies?.[0] || '').toLowerCase();
    
    if (!leaderResponse || !dupResponse) {
        return { similar: true, divergenceRisk: 'UNKNOWN', reason: 'Missing response data' };
    }
    
    // Quick similarity check using word overlap
    const leaderWords = new Set(leaderResponse.split(/\s+/).filter(w => w.length > 3));
    const dupWords = new Set(dupResponse.split(/\s+/).filter(w => w.length > 3));
    
    const shared = [...leaderWords].filter(w => dupWords.has(w)).length;
    const total = new Set([...leaderWords, ...dupWords]).size;
    const wordOverlap = total > 0 ? shared / total : 0;
    
    // Check for key action divergence (booking vs info vs transfer)
    const leaderHasBooking = /schedul|book|appoint|come out|send.*tech/i.test(leaderResponse);
    const dupHasBooking = /schedul|book|appoint|come out|send.*tech/i.test(dupResponse);
    const leaderHasPrice = /\$|price|cost|fee|charge/i.test(leaderResponse);
    const dupHasPrice = /\$|price|cost|fee|charge/i.test(dupResponse);
    const leaderHasTransfer = /transfer|connect|hold|speak.*with/i.test(leaderResponse);
    const dupHasTransfer = /transfer|connect|hold|speak.*with/i.test(dupResponse);
    
    const actionMismatch = (leaderHasBooking !== dupHasBooking) || 
                          (leaderHasPrice !== dupHasPrice) ||
                          (leaderHasTransfer !== dupHasTransfer);
    
    let divergenceRisk = 'LOW';
    let reason = 'Responses are similar';
    
    if (actionMismatch) {
        divergenceRisk = 'HIGH';
        reason = 'Different actions (booking/price/transfer mismatch)';
    } else if (wordOverlap < 0.3) {
        divergenceRisk = 'MEDIUM';
        reason = 'Low word overlap in responses';
    }
    
    return {
        similar: divergenceRisk === 'LOW',
        divergenceRisk,
        wordOverlapPct: Math.round(wordOverlap * 100),
        reason,
        leaderAction: leaderHasBooking ? 'BOOKING' : leaderHasPrice ? 'PRICING' : leaderHasTransfer ? 'TRANSFER' : 'INFO',
        duplicateAction: dupHasBooking ? 'BOOKING' : dupHasPrice ? 'PRICING' : dupHasTransfer ? 'TRANSFER' : 'INFO'
    };
}

/**
 * Build enhanced reason string with all analysis
 */
function buildEnhancedReason(similarity, triggerOverlap, responseDivergence, leaderName, intentMatch) {
    const parts = [];
    
    // Similarity
    parts.push(`${similarity}% similar to "${leaderName}"`);
    
    // Trigger overlap risk
    if (triggerOverlap.confusionRisk === 'HIGH') {
        parts.push(`⚠️ HIGH trigger overlap (${triggerOverlap.overlapPercent}%)`);
    } else if (triggerOverlap.shared > 0) {
        parts.push(`${triggerOverlap.shared} shared triggers`);
    }
    
    // Response divergence warning
    if (responseDivergence.divergenceRisk === 'HIGH') {
        parts.push(`🚨 RESPONSE DIVERGENCE: ${responseDivergence.reason}`);
    }
    
    // Intent type match
    if (intentMatch) {
        parts.push(`both ${intentMatch}`);
    }
    
    return parts.join(' • ');
}

// ============================================================================
// DUPLICATE CLUSTERING
// ============================================================================

/**
 * Cluster scenarios by semantic similarity
 * Uses a simple greedy clustering approach
 * 
 * @param {Array} scenarios - Array of scenario objects
 * @param {number} threshold - Similarity threshold (default 0.86)
 * @returns {Object} { groups: [...], standalone: [...], stats: {...} }
 */
async function clusterDuplicates(scenarios, threshold = 0.86) {
    if (!scenarios || scenarios.length === 0) {
        return { groups: [], standalone: [], stats: { total: 0, groups: 0, duplicates: 0 } };
    }
    
    logger.info('[EMBEDDING] Starting duplicate clustering', { 
        count: scenarios.length, 
        threshold 
    });
    
    // Get embeddings for all scenarios
    const embeddings = await batchGetEmbeddings(scenarios);
    
    // Create scenario objects with embeddings
    const scenariosWithEmbeddings = scenarios.map((s, i) => ({
        scenario: s,
        embedding: embeddings[i],
        clustered: false
    }));
    
    const groups = [];
    const standalone = [];
    
    // Greedy clustering
    for (let i = 0; i < scenariosWithEmbeddings.length; i++) {
        const current = scenariosWithEmbeddings[i];
        
        if (current.clustered) continue;
        
        // Find all similar scenarios
        const similar = [];
        for (let j = i + 1; j < scenariosWithEmbeddings.length; j++) {
            const other = scenariosWithEmbeddings[j];
            if (other.clustered) continue;
            
            const similarity = cosineSimilarity(current.embedding, other.embedding);
            if (similarity >= threshold) {
                similar.push({
                    scenario: other.scenario,
                    similarity: Math.round(similarity * 100),
                    index: j
                });
            }
        }
        
        if (similar.length > 0) {
            // Mark all as clustered
            current.clustered = true;
            similar.forEach(s => {
                scenariosWithEmbeddings[s.index].clustered = true;
            });
            
            // Create group with leader (oldest or highest priority)
            const members = [
                { 
                    scenario: current.scenario, 
                    similarity: 100,
                    isLeader: true 
                },
                ...similar.map(s => ({ 
                    scenario: s.scenario, 
                    similarity: s.similarity,
                    isLeader: false 
                }))
            ];
            
            // Sort by priority (highest first), then by createdAt (oldest first)
            members.sort((a, b) => {
                const priorityA = a.scenario.priority || 50;
                const priorityB = b.scenario.priority || 50;
                if (priorityB !== priorityA) return priorityB - priorityA;
                
                const dateA = new Date(a.scenario.createdAt || 0);
                const dateB = new Date(b.scenario.createdAt || 0);
                return dateA - dateB;
            });
            
            // Mark new leader
            members.forEach((m, idx) => m.isLeader = idx === 0);
            
            // ═══════════════════════════════════════════════════════════════
            // ENHANCED ANALYSIS (Feb 2026)
            // Add trigger overlap, response divergence, and enhanced reasons
            // ═══════════════════════════════════════════════════════════════
            const leader = members.find(m => m.isLeader);
            const leaderName = leader?.scenario?.scenarioName || leader?.scenario?.name || 'Leader';
            const leaderType = leader?.scenario?.scenarioType || 'FAQ';
            
            // Track group-level risks
            let hasHighTriggerOverlap = false;
            let hasResponseDivergence = false;
            
            // Analyze each non-leader member
            for (const member of members) {
                if (member.isLeader) {
                    member.triggerOverlap = null;
                    member.responseDivergence = null;
                    member.enhancedReason = 'Leader scenario - will be kept';
                    continue;
                }
                
                // Calculate trigger overlap
                member.triggerOverlap = calculateTriggerOverlap(leader.scenario, member.scenario);
                if (member.triggerOverlap.confusionRisk === 'HIGH') {
                    hasHighTriggerOverlap = true;
                }
                
                // Analyze response divergence
                member.responseDivergence = analyzeResponseDivergence(leader.scenario, member.scenario);
                if (member.responseDivergence.divergenceRisk === 'HIGH') {
                    hasResponseDivergence = true;
                }
                
                // Check intent type match
                const memberType = member.scenario?.scenarioType || 'FAQ';
                const intentMatch = leaderType === memberType ? leaderType : null;
                
                // Build enhanced reason
                member.enhancedReason = buildEnhancedReason(
                    member.similarity,
                    member.triggerOverlap,
                    member.responseDivergence,
                    leaderName,
                    intentMatch
                );
            }
            
            groups.push({
                id: `group-${groups.length + 1}`,
                avgSimilarity: Math.round(similar.reduce((sum, s) => sum + s.similarity, 100) / (similar.length + 1)),
                members,
                triggerCount: members.reduce((sum, m) => sum + (m.scenario.triggers?.length || 0), 0),
                // Group-level risk flags
                risks: {
                    hasHighTriggerOverlap,
                    hasResponseDivergence,
                    overallRisk: hasResponseDivergence ? 'HIGH' : hasHighTriggerOverlap ? 'MEDIUM' : 'LOW'
                }
            });
        } else {
            standalone.push(current.scenario);
        }
    }
    
    const stats = {
        total: scenarios.length,
        groups: groups.length,
        duplicates: groups.reduce((sum, g) => sum + g.members.length - 1, 0),
        standalone: standalone.length,
        afterCleanup: standalone.length + groups.length
    };
    
    logger.info('[EMBEDDING] Clustering complete', stats);
    
    return { groups, standalone, stats };
}

// ============================================================================
// DUPLICATE CHECK (for save-time gate)
// ============================================================================

/**
 * Check if a scenario is a duplicate of existing scenarios
 * Used as a gate before saving new scenarios
 * 
 * @param {Object} newScenario - The scenario to check
 * @param {Array} existingScenarios - Existing scenarios to compare against
 * @param {number} threshold - Similarity threshold
 * @returns {Object} { isDuplicate: boolean, matches: [...] }
 */
async function checkForDuplicate(newScenario, existingScenarios, threshold = 0.86) {
    if (!existingScenarios || existingScenarios.length === 0) {
        return { isDuplicate: false, matches: [] };
    }
    
    // Get embedding for new scenario
    const newEmbedding = await getScenarioEmbedding(newScenario);
    
    // Get embeddings for existing (batch for efficiency)
    const existingEmbeddings = await batchGetEmbeddings(existingScenarios);
    
    // Find matches
    const matches = [];
    for (let i = 0; i < existingScenarios.length; i++) {
        const similarity = cosineSimilarity(newEmbedding, existingEmbeddings[i]);
        if (similarity >= threshold) {
            matches.push({
                scenario: existingScenarios[i],
                similarity: Math.round(similarity * 100)
            });
        }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    
    return {
        isDuplicate: matches.length > 0,
        matches: matches.slice(0, 3)  // Top 3 matches
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Core functions
    buildEmbeddingText,
    getEmbedding,
    getScenarioEmbedding,
    batchGetEmbeddings,
    
    // Similarity
    cosineSimilarity,
    findSimilar,
    
    // Enhanced analysis (Feb 2026)
    calculateTriggerOverlap,
    analyzeResponseDivergence,
    buildEnhancedReason,
    
    // Clustering
    clusterDuplicates,
    
    // Duplicate check
    checkForDuplicate
};

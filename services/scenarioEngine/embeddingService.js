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
            
            groups.push({
                id: `group-${groups.length + 1}`,
                avgSimilarity: Math.round(similar.reduce((sum, s) => sum + s.similarity, 100) / (similar.length + 1)),
                members,
                triggerCount: members.reduce((sum, m) => sum + (m.scenario.triggers?.length || 0), 0)
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
    
    // Clustering
    clusterDuplicates,
    
    // Duplicate check
    checkForDuplicate
};

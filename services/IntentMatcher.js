/**
 * ════════════════════════════════════════════════════════════════════════════════
 * INTENT MATCHER - Maps scenarios to blueprint intents
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Given a scenario from a template, determine which blueprint intent it covers.
 * This enables the Coverage Engine to assess: Good / Weak / Missing / Skipped
 * 
 * MATCHING STRATEGY (Deterministic MVP):
 * 1. Normalize scenario triggers + name into phrase set
 * 2. Compare to each blueprint item's triggerHints
 * 3. Score by overlap (exact phrase > token overlap)
 * 4. Apply negativeTriggerHints penalty
 * 5. Category bonus if scenario.category matches blueprint category
 * 
 * FUTURE ENHANCEMENTS:
 * - Embeddings similarity for semantic matching
 * - Learning from manual corrections
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

class IntentMatcher {
    constructor(blueprintSpec) {
        this.blueprint = blueprintSpec;
        this.intentIndex = this._buildIntentIndex();
    }
    
    /**
     * Build a fast lookup index from blueprint items
     */
    _buildIntentIndex() {
        const index = {
            byItemKey: new Map(),
            byCategory: new Map(),
            allItems: []
        };
        
        for (const category of (this.blueprint.categories || [])) {
            const categoryKey = category.categoryKey;
            const categoryItems = [];
            
            for (const item of (category.items || [])) {
                const processedItem = {
                    ...item,
                    categoryKey,
                    categoryName: category.name,
                    // Normalize trigger hints for matching
                    normalizedTriggers: (item.triggerHints || []).map(t => this._normalize(t)),
                    normalizedNegatives: (item.negativeTriggerHints || []).map(t => this._normalize(t)),
                    // Build token set for fuzzy matching
                    triggerTokens: new Set(
                        (item.triggerHints || [])
                            .flatMap(t => this._tokenize(t))
                    )
                };
                
                index.byItemKey.set(item.itemKey, processedItem);
                categoryItems.push(processedItem);
                index.allItems.push(processedItem);
            }
            
            index.byCategory.set(categoryKey, categoryItems);
        }
        
        logger.info(`[INTENT MATCHER] Built index with ${index.allItems.length} intents`);
        return index;
    }
    
    /**
     * Normalize text for comparison
     */
    _normalize(text) {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    /**
     * Tokenize text into meaningful words
     */
    _tokenize(text) {
        const stopWords = new Set([
            'a', 'an', 'the', 'is', 'it', 'to', 'of', 'and', 'or', 'for',
            'my', 'me', 'i', 'we', 'you', 'your', 'our', 'can', 'do', 'does',
            'have', 'has', 'be', 'been', 'being', 'was', 'were', 'will',
            'not', 'no', 'yes', 'just', 'only', 'also', 'but', 'if', 'when'
        ]);
        
        return this._normalize(text)
            .split(' ')
            .filter(w => w.length > 2 && !stopWords.has(w));
    }
    
    /**
     * Match a single scenario to the best blueprint intent
     * 
     * @param {Object} scenario - Scenario from template
     * @param {Object} options - Matching options
     * @returns {Object} - { matchedItemKey, confidence, evidence, alternates }
     */
    match(scenario, options = {}) {
        const startTime = Date.now();
        
        // Build normalized phrase set from scenario
        const scenarioPhrases = this._buildScenarioPhrases(scenario);
        const scenarioTokens = new Set(
            [...scenarioPhrases.triggers, scenarioPhrases.name]
                .flatMap(p => this._tokenize(p))
        );
        
        // Score each blueprint item
        const scores = [];
        
        for (const item of this.intentIndex.allItems) {
            const score = this._scoreMatch(scenarioPhrases, scenarioTokens, item, scenario);
            
            if (score.total > 0) {
                scores.push({
                    itemKey: item.itemKey,
                    itemName: item.name,
                    categoryKey: item.categoryKey,
                    score: score.total,
                    confidence: Math.min(1, score.total / 100),
                    evidence: score.evidence
                });
            }
        }
        
        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);
        
        const best = scores[0] || null;
        const alternates = scores.slice(1, 4); // Top 3 alternatives
        
        const result = {
            matched: best !== null && best.confidence >= (options.minConfidence || 0.3),
            matchedItemKey: best?.confidence >= (options.minConfidence || 0.3) ? best.itemKey : null,
            matchedItemName: best?.confidence >= (options.minConfidence || 0.3) ? best.itemName : null,
            confidence: best?.confidence || 0,
            evidence: best?.evidence || [],
            alternates: alternates.map(a => ({
                itemKey: a.itemKey,
                itemName: a.itemName,
                confidence: a.confidence
            })),
            processingTimeMs: Date.now() - startTime
        };
        
        return result;
    }
    
    /**
     * Build phrase set from scenario
     */
    _buildScenarioPhrases(scenario) {
        return {
            name: this._normalize(scenario.name || ''),
            triggers: (scenario.triggers || []).map(t => this._normalize(t)),
            category: this._normalize(scenario.categoryName || scenario.category || ''),
            // Include quick/full replies for additional context
            replies: [
                ...(scenario.quickReplies || []),
                ...(scenario.fullReplies || [])
            ].map(r => this._normalize(r))
        };
    }
    
    /**
     * Score how well a scenario matches a blueprint item
     */
    _scoreMatch(scenarioPhrases, scenarioTokens, blueprintItem, scenario) {
        let score = 0;
        const evidence = [];
        
        // ════════════════════════════════════════════════════════════════════
        // 1. EXACT PHRASE MATCH (Highest value: 50 points each)
        // ════════════════════════════════════════════════════════════════════
        for (const trigger of scenarioPhrases.triggers) {
            for (const hint of blueprintItem.normalizedTriggers) {
                if (trigger === hint) {
                    score += 50;
                    evidence.push({ type: 'exact_trigger', trigger, hint, points: 50 });
                } else if (trigger.includes(hint) || hint.includes(trigger)) {
                    score += 30;
                    evidence.push({ type: 'partial_trigger', trigger, hint, points: 30 });
                }
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 2. NAME SIMILARITY (25 points for strong match)
        // ════════════════════════════════════════════════════════════════════
        const scenarioNameNorm = scenarioPhrases.name;
        const itemNameNorm = this._normalize(blueprintItem.name);
        
        if (scenarioNameNorm === itemNameNorm) {
            score += 40;
            evidence.push({ type: 'exact_name', points: 40 });
        } else if (scenarioNameNorm.includes(itemNameNorm) || itemNameNorm.includes(scenarioNameNorm)) {
            score += 25;
            evidence.push({ type: 'partial_name', points: 25 });
        } else {
            // Token overlap in names
            const nameTokens = this._tokenize(blueprintItem.name);
            const scenarioNameTokens = this._tokenize(scenario.name || '');
            const overlap = nameTokens.filter(t => scenarioNameTokens.includes(t)).length;
            if (overlap > 0) {
                const points = Math.min(20, overlap * 8);
                score += points;
                evidence.push({ type: 'name_token_overlap', overlap, points });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 3. TOKEN OVERLAP (Up to 30 points)
        // ════════════════════════════════════════════════════════════════════
        const tokenOverlap = [...scenarioTokens].filter(t => blueprintItem.triggerTokens.has(t));
        if (tokenOverlap.length > 0) {
            const points = Math.min(30, tokenOverlap.length * 5);
            score += points;
            evidence.push({ type: 'token_overlap', tokens: tokenOverlap, points });
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 4. CATEGORY MATCH BONUS (15 points)
        // ════════════════════════════════════════════════════════════════════
        if (scenarioPhrases.category) {
            const catNorm = scenarioPhrases.category;
            const itemCatNorm = this._normalize(blueprintItem.categoryName);
            
            if (catNorm.includes(itemCatNorm) || itemCatNorm.includes(catNorm)) {
                score += 15;
                evidence.push({ type: 'category_match', points: 15 });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 5. NEGATIVE TRIGGER PENALTY (-30 points each)
        // ════════════════════════════════════════════════════════════════════
        for (const trigger of scenarioPhrases.triggers) {
            for (const negative of blueprintItem.normalizedNegatives) {
                if (trigger.includes(negative)) {
                    score -= 30;
                    evidence.push({ type: 'negative_match', trigger, negative, points: -30 });
                }
            }
        }
        
        return {
            total: Math.max(0, score),
            evidence
        };
    }
    
    /**
     * Match all scenarios in a template against the blueprint
     * 
     * @param {Array} scenarios - Array of scenarios
     * @param {Object} options - Matching options
     * @returns {Object} - { matches, unmatched, coverage }
     */
    matchAll(scenarios, options = {}) {
        const results = {
            matches: [],
            unmatched: [],
            byIntent: new Map(),
            coverage: {
                total: this.intentIndex.allItems.length,
                covered: 0,
                uncovered: 0
            }
        };
        
        // Match each scenario
        for (const scenario of scenarios) {
            const match = this.match(scenario, options);
            
            const entry = {
                scenarioId: scenario.scenarioId || scenario._id?.toString(),
                scenarioName: scenario.name,
                categoryName: scenario.categoryName || scenario.category,
                ...match
            };
            
            if (match.matched) {
                results.matches.push(entry);
                
                // Track which intents are covered (first match wins)
                if (!results.byIntent.has(match.matchedItemKey)) {
                    results.byIntent.set(match.matchedItemKey, entry);
                }
            } else {
                results.unmatched.push(entry);
            }
        }
        
        // Calculate coverage
        results.coverage.covered = results.byIntent.size;
        results.coverage.uncovered = results.coverage.total - results.coverage.covered;
        results.coverage.percent = Math.round((results.coverage.covered / results.coverage.total) * 100);
        
        // List uncovered intents
        results.uncoveredIntents = this.intentIndex.allItems
            .filter(item => !results.byIntent.has(item.itemKey))
            .map(item => ({
                itemKey: item.itemKey,
                itemName: item.name,
                categoryKey: item.categoryKey,
                required: item.required,
                serviceKey: item.serviceKey || null
            }));
        
        return results;
    }
    
    /**
     * Get all intents that should be assessed for a company
     * (respects service toggles)
     * 
     * @param {Object} companyServices - company.aiAgentSettings.services
     * @returns {Array} - Filtered intent list
     */
    getAssessableIntents(companyServices = {}) {
        return this.intentIndex.allItems.filter(item => {
            // If no serviceKey, always assess
            if (!item.serviceKey) return true;
            
            // Check if service is enabled
            const serviceConfig = companyServices[item.serviceKey];
            if (serviceConfig?.enabled !== undefined) {
                return serviceConfig.enabled;
            }
            
            // Fall back to defaultEnabled
            return item.defaultEnabled !== false;
        });
    }
    
    /**
     * Get intents that are skipped due to disabled services
     * 
     * @param {Object} companyServices - company.aiAgentSettings.services
     * @returns {Array} - Skipped intents
     */
    getSkippedIntents(companyServices = {}) {
        return this.intentIndex.allItems.filter(item => {
            if (!item.serviceKey) return false;
            
            const serviceConfig = companyServices[item.serviceKey];
            if (serviceConfig?.enabled !== undefined) {
                return !serviceConfig.enabled;
            }
            
            return item.defaultEnabled === false;
        });
    }
}

module.exports = IntentMatcher;

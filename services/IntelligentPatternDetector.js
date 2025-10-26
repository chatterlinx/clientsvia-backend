/**
 * ============================================================================
 * INTELLIGENT PATTERN DETECTOR - SELF-LEARNING AI OPTIMIZATION
 * ============================================================================
 * 
 * PURPOSE:
 * Analyzes test call transcripts and production calls to automatically detect:
 * - Filler words (noise to remove)
 * - Synonyms (colloquial → technical term mappings)
 * - Missing keywords (improve matching)
 * - Conflicts (overlapping scenarios)
 * 
 * WORKFLOW:
 * 1. Analyze test call logs (from test-respond endpoint)
 * 2. Detect patterns in failed matches, low-confidence matches, and successful matches
 * 3. Generate suggestions with confidence scores and estimated impact
 * 4. Store in SuggestionKnowledgeBase for developer review
 * 5. Track which suggestions improve match rates (A/B testing)
 * 
 * INTELLIGENCE METHODS:
 * - Frequency analysis (detect repeated non-technical words)
 * - Context analysis (identify words appearing in failed matches)
 * - Semantic clustering (group similar failed queries)
 * - Conflict detection (find overlapping keywords)
 * 
 * ============================================================================
 */

const SuggestionKnowledgeBase = require('../models/SuggestionKnowledgeBase');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const logger = require('../utils/logger');

class IntelligentPatternDetector {
    constructor() {
        // ============================================
        // CONFIGURATION
        // ============================================
        
        this.config = {
            // Minimum occurrences before suggesting
            minFillerFrequency: 5,          // Word must appear 5+ times
            minSynonymFrequency: 3,         // Synonym pattern must appear 3+ times
            minConflictOverlap: 0.4,        // 40% keyword overlap = conflict
            
            // Confidence thresholds
            highConfidenceThreshold: 0.75,  // >= 75% = high priority
            mediumConfidenceThreshold: 0.5, // >= 50% = medium priority
            
            // Analysis windows
            analysisWindowDays: 7,          // Analyze last 7 days of calls
            minCallsForAnalysis: 10,        // Need 10+ calls for reliable patterns
            
            // Common technical terms (don't suggest as fillers)
            protectedTerms: new Set([
                'thermostat', 'furnace', 'air conditioner', 'ac', 'heat',
                'cool', 'filter', 'duct', 'vent', 'compressor', 'coil',
                'refrigerant', 'capacitor', 'contactor', 'blower', 'fan',
                'emergency', 'leak', 'water', 'noise', 'smell', 'smoke',
                'appointment', 'schedule', 'visit', 'technician', 'service'
            ])
        };
        
        // Common filler word patterns (baseline for detection)
        this.knownFillers = new Set([
            'um', 'uh', 'like', 'you know', 'i mean', 'basically', 'actually',
            'so', 'well', 'okay', 'alright', 'right', 'yeah', 'yep'
        ]);
    }
    
    // ============================================
    // MAIN ANALYSIS METHODS
    // ============================================
    
    /**
     * Analyze a batch of test calls and generate suggestions
     * @param {Array} testCalls - Array of test call objects
     * @param {String} templateId - Template ID
     * @returns {Object} - Analysis results
     */
    async analyzeTestCalls(testCalls, templateId) {
        logger.info('🧠 [PATTERN DETECTOR] Starting analysis', {
            templateId,
            callCount: testCalls.length
        });
        
        if (testCalls.length < this.config.minCallsForAnalysis) {
            logger.warn('🧠 [PATTERN DETECTOR] Not enough calls for reliable analysis', {
                have: testCalls.length,
                need: this.config.minCallsForAnalysis
            });
            return {
                success: false,
                message: `Need at least ${this.config.minCallsForAnalysis} test calls for reliable pattern detection`,
                suggestions: []
            };
        }
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            throw new Error('Template not found');
        }
        
        // Run all detection methods in parallel
        const [fillerSuggestions, synonymSuggestions, keywordSuggestions, conflicts] = await Promise.all([
            this.detectFillerWords(testCalls, template),
            this.detectSynonyms(testCalls, template),
            this.detectMissingKeywords(testCalls, template),
            this.detectConflicts(testCalls, template)
        ]);
        
        // Combine all suggestions
        const allSuggestions = [
            ...fillerSuggestions,
            ...synonymSuggestions,
            ...keywordSuggestions,
            ...conflicts
        ];
        
        // Save to database
        const savedCount = await this.saveSuggestions(allSuggestions, templateId);
        
        logger.info('✅ [PATTERN DETECTOR] Analysis complete', {
            templateId,
            totalSuggestions: allSuggestions.length,
            saved: savedCount,
            breakdown: {
                fillers: fillerSuggestions.length,
                synonyms: synonymSuggestions.length,
                keywords: keywordSuggestions.length,
                conflicts: conflicts.length
            }
        });
        
        return {
            success: true,
            totalSuggestions: allSuggestions.length,
            saved: savedCount,
            suggestions: allSuggestions
        };
    }
    
    // ============================================
    // FILLER WORD DETECTION
    // ============================================
    
    /**
     * Detect potential filler words from test calls
     * @param {Array} testCalls - Test call data
     * @param {Object} template - Template object
     * @returns {Array} - Filler word suggestions
     */
    async detectFillerWords(testCalls, template) {
        const existingFillers = new Set([
            ...(template.fillerWords || []),
            ...this.knownFillers
        ]);
        
        // Count word frequencies across all calls
        const wordFrequency = new Map();
        const wordContexts = new Map();
        
        for (const call of testCalls) {
            if (!call.input) continue;
            
            const words = call.input.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 2);
            
            for (const word of words) {
                // Skip if already a filler
                if (existingFillers.has(word)) continue;
                
                // Skip if it's a protected technical term
                if (this.config.protectedTerms.has(word)) continue;
                
                // Skip if it appears in scenario keywords (likely important)
                if (this.appearsInScenarioKeywords(word, template)) continue;
                
                // Track frequency
                wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
                
                // Track contexts (sample phrases)
                if (!wordContexts.has(word)) {
                    wordContexts.set(word, []);
                }
                if (wordContexts.get(word).length < 5) {
                    wordContexts.get(word).push(call.input.substring(0, 100));
                }
            }
        }
        
        // Generate suggestions for high-frequency words
        const suggestions = [];
        
        for (const [word, frequency] of wordFrequency.entries()) {
            if (frequency >= this.config.minFillerFrequency) {
                // Calculate confidence based on frequency and heuristics
                const confidence = Math.min(
                    0.5 + (frequency / testCalls.length) * 0.5,
                    0.95
                );
                
                // Estimate impact (how many calls would be affected)
                const estimatedImpact = (frequency / testCalls.length) * 100;
                
                suggestions.push({
                    type: 'filler',
                    fillerWord: word,
                    confidence,
                    estimatedImpact: Math.round(estimatedImpact),
                    frequency,
                    priority: this.calculatePriority(confidence, estimatedImpact),
                    contextPhrases: wordContexts.get(word) || [],
                    exampleCalls: this.extractExampleCalls(testCalls, word).slice(0, 5)
                });
            }
        }
        
        logger.info('🔇 [FILLER DETECTION] Complete', {
            candidatesEvaluated: wordFrequency.size,
            suggestionsGenerated: suggestions.length,
            highPriority: suggestions.filter(s => s.priority === 'high').length
        });
        
        return suggestions;
    }
    
    // ============================================
    // SYNONYM DETECTION
    // ============================================
    
    /**
     * Detect potential synonym mappings
     * @param {Array} testCalls - Test call data
     * @param {Object} template - Template object
     * @returns {Array} - Synonym suggestions
     */
    async detectSynonyms(testCalls, template) {
        const suggestions = [];
        
        // Get all technical terms from scenario keywords
        const technicalTerms = this.extractTechnicalTerms(template);
        
        // Look for low-confidence matches that might be using colloquial terms
        const lowConfidenceCalls = testCalls.filter(call => 
            call.confidence && call.confidence < 0.6 && call.confidence > 0
        );
        
        // Extract potential colloquial terms (words not in technical vocabulary)
        const colloquialCandidates = new Map();
        
        for (const call of lowConfidenceCalls) {
            if (!call.input) continue;
            
            const words = call.input.toLowerCase()
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 3);
            
            for (const word of words) {
                // Skip if it's already a technical term
                if (technicalTerms.has(word)) continue;
                
                // Skip if it's a known filler
                if (this.knownFillers.has(word)) continue;
                
                // Track potential colloquial terms
                if (!colloquialCandidates.has(word)) {
                    colloquialCandidates.set(word, {
                        frequency: 0,
                        contexts: [],
                        associatedScenarios: new Set()
                    });
                }
                
                const candidate = colloquialCandidates.get(word);
                candidate.frequency++;
                
                if (candidate.contexts.length < 5) {
                    candidate.contexts.push(call.input);
                }
                
                if (call.matchedScenario) {
                    candidate.associatedScenarios.add(call.matchedScenario);
                }
            }
        }
        
        // Try to match colloquial terms to technical terms based on context
        for (const [colloquialTerm, data] of colloquialCandidates.entries()) {
            if (data.frequency < this.config.minSynonymFrequency) continue;
            
            // Find most likely technical term match
            const technicalMatch = this.findMostLikelyTechnicalMatch(
                colloquialTerm,
                data.associatedScenarios,
                template
            );
            
            if (technicalMatch) {
                const confidence = Math.min(
                    0.4 + (data.frequency / lowConfidenceCalls.length) * 0.4,
                    0.85
                );
                
                const estimatedImpact = (data.frequency / testCalls.length) * 100;
                
                suggestions.push({
                    type: 'synonym',
                    colloquialTerm,
                    technicalTerm: technicalMatch,
                    confidence,
                    estimatedImpact: Math.round(estimatedImpact),
                    frequency: data.frequency,
                    priority: this.calculatePriority(confidence, estimatedImpact),
                    contextPhrases: data.contexts.slice(0, 5),
                    exampleCalls: this.extractExampleCalls(testCalls, colloquialTerm).slice(0, 5)
                });
            }
        }
        
        logger.info('🔤 [SYNONYM DETECTION] Complete', {
            candidatesEvaluated: colloquialCandidates.size,
            suggestionsGenerated: suggestions.length,
            highPriority: suggestions.filter(s => s.priority === 'high').length
        });
        
        return suggestions;
    }
    
    // ============================================
    // MISSING KEYWORD DETECTION
    // ============================================
    
    /**
     * Detect missing keywords in scenarios
     * @param {Array} testCalls - Test call data
     * @param {Object} template - Template object
     * @returns {Array} - Keyword suggestions
     */
    async detectMissingKeywords(testCalls, template) {
        const suggestions = [];
        
        // Look for failed matches or very low confidence matches
        const failedCalls = testCalls.filter(call => 
            !call.matchedScenario || (call.confidence && call.confidence < 0.3)
        );
        
        if (failedCalls.length === 0) {
            logger.info('🎯 [KEYWORD DETECTION] No failed matches to analyze');
            return suggestions;
        }
        
        // For each failed call, try to identify which scenario it SHOULD have matched
        for (const call of failedCalls) {
            if (!call.input || !call.expectedScenario) continue;
            
            // Find the scenario
            const scenario = this.findScenario(call.expectedScenario, template);
            if (!scenario) continue;
            
            // Extract key terms from the failed input
            const inputTerms = this.extractKeyTerms(call.input);
            const existingKeywords = new Set((scenario.intentKeywords || []).map(k => k.toLowerCase()));
            
            // Find terms that appear in input but not in scenario keywords
            const missingTerms = inputTerms.filter(term => !existingKeywords.has(term));
            
            for (const term of missingTerms) {
                // Check if this term appears frequently in failed matches for this scenario
                const termFrequency = this.countTermInFailedMatches(
                    term,
                    scenario,
                    failedCalls
                );
                
                if (termFrequency >= 2) {  // Appears in 2+ failed matches
                    const confidence = Math.min(0.5 + (termFrequency / failedCalls.length) * 0.3, 0.85);
                    const estimatedImpact = (termFrequency / failedCalls.length) * 100;
                    
                    suggestions.push({
                        type: 'keyword',
                        keyword: term,
                        scenarioId: scenario.scenarioId,
                        categoryId: this.findCategoryForScenario(scenario, template)?.id,
                        confidence,
                        estimatedImpact: Math.round(estimatedImpact),
                        frequency: termFrequency,
                        priority: this.calculatePriority(confidence, estimatedImpact),
                        contextPhrases: this.extractContextsForTerm(term, failedCalls).slice(0, 5),
                        exampleCalls: this.extractExampleCalls(failedCalls, term).slice(0, 5)
                    });
                }
            }
        }
        
        logger.info('🎯 [KEYWORD DETECTION] Complete', {
            failedCallsAnalyzed: failedCalls.length,
            suggestionsGenerated: suggestions.length,
            highPriority: suggestions.filter(s => s.priority === 'high').length
        });
        
        return suggestions;
    }
    
    // ============================================
    // CONFLICT DETECTION
    // ============================================
    
    /**
     * Detect conflicting scenarios (overlapping keywords)
     * @param {Array} testCalls - Test call data
     * @param {Object} template - Template object
     * @returns {Array} - Conflict suggestions
     */
    async detectConflicts(testCalls, template) {
        const suggestions = [];
        
        // Get all scenarios
        const allScenarios = [];
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                allScenarios.push({
                    ...scenario.toObject(),
                    categoryId: category.id
                });
            }
        }
        
        // Compare each scenario pair for keyword overlap
        for (let i = 0; i < allScenarios.length; i++) {
            for (let j = i + 1; j < allScenarios.length; j++) {
                const scenarioA = allScenarios[i];
                const scenarioB = allScenarios[j];
                
                // Get keywords
                const keywordsA = new Set((scenarioA.intentKeywords || []).map(k => k.toLowerCase()));
                const keywordsB = new Set((scenarioB.intentKeywords || []).map(k => k.toLowerCase()));
                
                if (keywordsA.size === 0 || keywordsB.size === 0) continue;
                
                // Calculate overlap
                const overlap = this.calculateSetOverlap(keywordsA, keywordsB);
                
                if (overlap >= this.config.minConflictOverlap) {
                    const overlappingKeywords = Array.from(keywordsA).filter(k => keywordsB.has(k));
                    
                    // Check if this causes issues in test calls
                    const affectedCalls = testCalls.filter(call => {
                        const input = call.input?.toLowerCase() || '';
                        return overlappingKeywords.some(keyword => input.includes(keyword));
                    });
                    
                    if (affectedCalls.length > 0) {
                        const confidence = Math.min(0.6 + overlap * 0.3, 0.9);
                        const estimatedImpact = (affectedCalls.length / testCalls.length) * 100;
                        
                        suggestions.push({
                            type: 'conflict',
                            conflictDetails: {
                                scenarioA: scenarioA.scenarioId,
                                scenarioB: scenarioB.scenarioId,
                                overlappingKeywords,
                                resolution: `Add negative keywords to differentiate: ${scenarioA.name} vs ${scenarioB.name}`
                            },
                            confidence,
                            estimatedImpact: Math.round(estimatedImpact),
                            frequency: affectedCalls.length,
                            priority: this.calculatePriority(confidence, estimatedImpact),
                            contextPhrases: affectedCalls.slice(0, 5).map(c => c.input),
                            exampleCalls: affectedCalls.slice(0, 5)
                        });
                    }
                }
            }
        }
        
        logger.info('⚠️ [CONFLICT DETECTION] Complete', {
            scenariosChecked: allScenarios.length,
            conflictsFound: suggestions.length,
            highPriority: suggestions.filter(s => s.priority === 'high').length
        });
        
        return suggestions;
    }
    
    // ============================================
    // HELPER METHODS
    // ============================================
    
    appearsInScenarioKeywords(word, template) {
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                const keywords = (scenario.intentKeywords || []).map(k => k.toLowerCase());
                if (keywords.includes(word)) return true;
            }
        }
        return false;
    }
    
    extractTechnicalTerms(template) {
        const terms = new Set();
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                (scenario.intentKeywords || []).forEach(k => terms.add(k.toLowerCase()));
            }
        }
        return terms;
    }
    
    findMostLikelyTechnicalMatch(colloquialTerm, associatedScenarios, template) {
        // Simple heuristic: find the most common keyword in associated scenarios
        const keywordFrequency = new Map();
        
        for (const scenarioId of associatedScenarios) {
            const scenario = this.findScenario(scenarioId, template);
            if (scenario) {
                (scenario.intentKeywords || []).forEach(keyword => {
                    const lower = keyword.toLowerCase();
                    keywordFrequency.set(lower, (keywordFrequency.get(lower) || 0) + 1);
                });
            }
        }
        
        // Return most frequent keyword
        let maxFreq = 0;
        let bestMatch = null;
        
        for (const [keyword, freq] of keywordFrequency.entries()) {
            if (freq > maxFreq) {
                maxFreq = freq;
                bestMatch = keyword;
            }
        }
        
        return bestMatch;
    }
    
    findScenario(scenarioId, template) {
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                if (scenario.scenarioId === scenarioId || scenario._id?.toString() === scenarioId) {
                    return scenario;
                }
            }
        }
        return null;
    }
    
    findCategoryForScenario(scenario, template) {
        for (const category of template.categories) {
            for (const s of category.scenarios || []) {
                if (s.scenarioId === scenario.scenarioId) {
                    return category;
                }
            }
        }
        return null;
    }
    
    extractKeyTerms(input) {
        return input.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 4 && !this.knownFillers.has(w));
    }
    
    countTermInFailedMatches(term, scenario, failedCalls) {
        return failedCalls.filter(call => 
            call.expectedScenario === scenario.scenarioId &&
            call.input?.toLowerCase().includes(term.toLowerCase())
        ).length;
    }
    
    extractContextsForTerm(term, calls) {
        return calls
            .filter(call => call.input?.toLowerCase().includes(term.toLowerCase()))
            .map(call => call.input.substring(0, 100));
    }
    
    extractExampleCalls(calls, term) {
        return calls
            .filter(call => call.input?.toLowerCase().includes(term.toLowerCase()))
            .map(call => ({
                callId: call.callId || call._id,
                input: call.input,
                expectedMatch: call.expectedScenario,
                actualMatch: call.matchedScenario,
                confidence: call.confidence,
                timestamp: call.timestamp || new Date()
            }));
    }
    
    calculateSetOverlap(setA, setB) {
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return union.size > 0 ? intersection.size / union.size : 0;
    }
    
    calculatePriority(confidence, estimatedImpact) {
        const score = (confidence * 0.6) + (estimatedImpact / 100 * 0.4);
        
        if (score >= 0.75) return 'high';
        if (score >= 0.5) return 'medium';
        return 'low';
    }
    
    async saveSuggestions(suggestions, templateId) {
        let savedCount = 0;
        
        for (const suggestion of suggestions) {
            try {
                // Check if similar suggestion already exists
                const existing = await SuggestionKnowledgeBase.findOne({
                    templateId,
                    type: suggestion.type,
                    status: 'pending',
                    ...(suggestion.fillerWord && { fillerWord: suggestion.fillerWord }),
                    ...(suggestion.colloquialTerm && { colloquialTerm: suggestion.colloquialTerm }),
                    ...(suggestion.keyword && { keyword: suggestion.keyword })
                });
                
                if (existing) {
                    // Update frequency and confidence
                    existing.frequency += suggestion.frequency;
                    existing.confidence = Math.max(existing.confidence, suggestion.confidence);
                    existing.lastUpdated = new Date();
                    await existing.save();
                } else {
                    // Create new suggestion
                    await SuggestionKnowledgeBase.create({
                        templateId,
                        ...suggestion
                    });
                }
                
                savedCount++;
            } catch (error) {
                logger.error('Error saving suggestion', { error: error.message, suggestion });
            }
        }
        
        return savedCount;
    }
}

module.exports = new IntelligentPatternDetector();


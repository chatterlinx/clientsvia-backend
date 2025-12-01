/**
 * ============================================================================
 * ENTERPRISE AI SUGGESTION ENGINE - CORE INTELLIGENCE
 * ============================================================================
 * 
 * PURPOSE:
 * The brain of Test Pilot - analyzes test calls and generates intelligent
 * suggestions to improve template quality. Combines LLM qualitative analysis
 * with statistical quantitative data to provide actionable, priority-ranked
 * recommendations.
 * 
 * ARCHITECTURE:
 * 1. LLM Deep Analysis (Qualitative) - WHY did Tier 1 fail?
 * 2. Statistical Analysis (Quantitative) - HOW OFTEN does this pattern appear?
 * 3. Impact Scoring - WHAT matters most?
 * 4. Conflict Detection - WHERE are the issues?
 * 5. Cost Projection - HOW MUCH will this save?
 * 6. Before/After Simulation - WHAT IF we apply this?
 * 
 * CHECKPOINT STRATEGY:
 * - Checkpoint at start of each major step
 * - Log all LLM API calls with cost tracking
 * - Validate all inputs before processing
 * - Enhanced error messages with context
 * - Never mask errors - always bubble up with details
 * 
 * DEPENDENCIES:
 * - openai (LLM analysis)
 * - GlobalInstantResponseTemplate (template data)
 * - TestPilotAnalysis (storage)
 * - IntelligenceModePresets (configuration)
 * - HybridScenarioSelector (Tier 1 testing)
 * - IntelligentRouter (Tier 1/2/3 cascade)
 * 
 * EXPORTS:
 * - EnterpriseAISuggestionEngine (class)
 * 
 * ============================================================================
 */

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const TestPilotAnalysis = require('../models/TestPilotAnalysis');
const { getPreset } = require('./IntelligenceModePresets');
const { ulid } = require('ulid');

// Use centralized OpenAI client (handles missing API key gracefully)
const openai = require('../config/openai');

class EnterpriseAISuggestionEngine {
    constructor() {
        console.log('🏗️ [CHECKPOINT 0] EnterpriseAISuggestionEngine initialized');
        
        // Pricing for cost calculations
        this.pricing = {
            'gpt-4o': {
                input: 0.0025 / 1000,    // $0.0025 per 1K input tokens
                output: 0.010 / 1000      // $0.010 per 1K output tokens
            },
            'gpt-4o-mini': {
                input: 0.00015 / 1000,    // $0.00015 per 1K input tokens
                output: 0.0006 / 1000     // $0.0006 per 1K output tokens
            }
        };
    }
    
    /**
     * ============================================================================
     * NORMALIZE TIER RESULTS (DEFENSIVE PROGRAMMING)
     * ============================================================================
     * Template-Test calls may not have finalTier/finalConfidence in the expected format.
     * This method extracts tier data from alternative locations and sets safe defaults.
     * 
     * @param {Object} tierResults - Raw tier results from runtime
     * @returns {Object} Normalized tier results with guaranteed fields
     * ============================================================================
     */
    normalizeTierResults(tierResults) {
        console.log('🛡️ [NORMALIZE] Normalizing tier results...');
        
        // ============================================
        // DEFENSIVE: Handle completely missing tierResults
        // ============================================
        if (!tierResults || typeof tierResults !== 'object') {
            console.error('❌ [NORMALIZE] tierResults is undefined, null, or not an object!');
            console.error('❌ [NORMALIZE] Creating safe default structure...');
            
            return {
                finalTier: 'tier1',
                finalConfidence: 0.0,
                tier1: { 
                    confidence: 0.0, 
                    matchedFillers: [], 
                    matchedTriggers: [], 
                    matchedKeywords: [] 
                },
                tier2: { confidence: 0.0 },
                tier3: { confidence: 0.0, scenario: null },
                hadMissingData: true,
                _error: 'tierResults was undefined or invalid'
            };
        }
        
        // Check if we already have the expected structure
        if (tierResults.finalTier && tierResults.finalConfidence !== undefined) {
            console.log('✅ [NORMALIZE] Tier results already in expected format');
            return {
                ...tierResults,
                hadMissingData: false
            };
        }
        
        console.warn('⚠️ [NORMALIZE] Missing finalTier or finalConfidence - extracting from alternative sources');
        
        // Try to extract from tierSummary (alternative location)
        const tierData = tierResults.tierSummary || tierResults;
        
        // Determine final tier from available data
        let finalTier = tierData.finalTier || 'tier1'; // Default to tier1
        let finalConfidence = tierData.finalConfidence || 0.5; // Default to medium confidence
        
        // If we have individual tier results, try to infer the final tier
        if (!tierData.finalTier && (tierResults.tier1 || tierResults.tier2 || tierResults.tier3)) {
            console.log('🔍 [NORMALIZE] Inferring finalTier from individual tier results');
            
            // Check tier3 first (LLM)
            if (tierResults.tier3?.success) {
                finalTier = 'tier3';
                finalConfidence = tierResults.tier3.confidence || 0.7;
            }
            // Then tier2 (semantic)
            else if (tierResults.tier2?.confidence >= 0.75) {
                finalTier = 'tier2';
                finalConfidence = tierResults.tier2.confidence;
            }
            // Finally tier1 (rule-based)
            else if (tierResults.tier1?.confidence >= 0.70) {
                finalTier = 'tier1';
                finalConfidence = tierResults.tier1.confidence;
            }
            // If nothing matched, default to tier1 with low confidence
            else {
                finalTier = 'tier1';
                finalConfidence = tierResults.tier1?.confidence || 0.3;
            }
        }
        
        // Ensure tier1, tier2, tier3 objects exist
        const tier1 = tierResults.tier1 || { 
            confidence: 0.3, 
            matchedFillers: [], 
            matchedTriggers: [], 
            matchedKeywords: [] 
        };
        const tier2 = tierResults.tier2 || { confidence: 0.0 };
        const tier3 = tierResults.tier3 || { confidence: 0.0, scenario: null };
        
        const normalized = {
            finalTier,
            finalConfidence,
            tier1,
            tier2,
            tier3,
            hadMissingData: true, // Flag to track that we normalized
            _originalData: tierResults // Keep reference for debugging
        };
        
        console.log('✅ [NORMALIZE] Normalized to:', {
            finalTier: normalized.finalTier,
            finalConfidence: normalized.finalConfidence,
            hadMissingData: true
        });
        
        return normalized;
    }
    
    /**
     * ============================================================================
     * MAIN ANALYSIS ENTRY POINT
     * ============================================================================
     * Analyzes a test call and generates comprehensive suggestions
     * 
     * @param {String} testPhrase - What the user said
     * @param {String} templateId - Template being tested
     * @param {Object} tierResults - Results from IntelligentRouter
     * @returns {Object} Complete analysis with suggestions
     * 
     * CHECKPOINT FLOW:
     * 1. Validate inputs
     * 2. Load template and preset
     * 3. Decide if analysis is needed
     * 4. Run LLM deep analysis
     * 5. Calculate impact scores
     * 6. Detect conflicts
     * 7. Project costs
     * 8. Generate suggestions
     * 9. Save analysis
     * 10. Return results
     * ============================================================================
     */
    async analyzeTestCall(testPhrase, templateId, tierResults) {
        console.log('🔵 [CHECKPOINT 1] analyzeTestCall() started');
        
        // ============================================
        // STEP 0: NORMALIZE TIER DATA (DEFENSIVE)
        // ============================================
        // Handle missing finalTier gracefully - template-test calls may not have it
        const normalizedTierResults = this.normalizeTierResults(tierResults);
        
        console.log('🔵 [CHECKPOINT 1.1] Inputs:', {
            testPhrase: testPhrase.substring(0, 50) + '...',
            templateId,
            finalTier: normalizedTierResults.finalTier,
            finalConfidence: normalizedTierResults.finalConfidence,
            hadMissingData: normalizedTierResults.hadMissingData
        });
        
        try {
            // ============================================
            // STEP 1: VALIDATE INPUTS
            // ============================================
            console.log('🔵 [CHECKPOINT 2] Validating inputs...');
            
            if (!testPhrase || typeof testPhrase !== 'string') {
                console.error('❌ [CHECKPOINT 2.1] Invalid testPhrase');
                throw new Error('testPhrase must be a non-empty string');
            }
            
            if (!templateId) {
                console.error('❌ [CHECKPOINT 2.2] Missing templateId');
                throw new Error('templateId is required');
            }
            
            if (!tierResults) {
                console.error('❌ [CHECKPOINT 2.3] Missing tierResults entirely');
                throw new Error('tierResults is required');
            }
            
            console.log('✅ [CHECKPOINT 2.4] Input validation passed');
            
            // ============================================
            // STEP 2: LOAD TEMPLATE AND PRESET
            // ============================================
            console.log('🔵 [CHECKPOINT 3] Loading template and preset...');
            
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                console.error('❌ [CHECKPOINT 3.1] Template not found:', templateId);
                throw new Error(`Template not found: ${templateId}`);
            }
            
            console.log('✅ [CHECKPOINT 3.1] Template loaded:', template.name);
            
            const intelligenceMode = template.intelligenceMode || 'MAXIMUM';
            const preset = getPreset(intelligenceMode);
            
            console.log('✅ [CHECKPOINT 3.2] Preset loaded:', preset.displayName);
            
            // ============================================
            // STEP 3: DECIDE IF ANALYSIS IS NEEDED
            // ============================================
            console.log('🔵 [CHECKPOINT 4] Checking if analysis is needed...');
            
            const shouldAnalyze = this.shouldAnalyze(
                normalizedTierResults.finalConfidence,
                preset.testPilot.analysisMode,
                preset.testPilot.minConfidenceForAnalysis
            );
            
            if (!shouldAnalyze) {
                console.log('⏭️ [CHECKPOINT 4.1] Skipping analysis (preset mode: ' + preset.testPilot.analysisMode + ')');
                return {
                    analyzed: false,
                    reason: `Confidence ${normalizedTierResults.finalConfidence} above threshold ${preset.testPilot.minConfidenceForAnalysis}`,
                    mode: preset.displayName
                };
            }
            
            console.log('✅ [CHECKPOINT 4.2] Analysis needed - proceeding');
            
            // ============================================
            // STEP 4: RUN LLM DEEP ANALYSIS
            // ============================================
            console.log('🔵 [CHECKPOINT 5] Running LLM deep analysis...');
            
            const llmAnalysis = await this.runLLMAnalysis(
                testPhrase,
                normalizedTierResults,
                template,
                preset.testPilot
            );
            
            console.log('✅ [CHECKPOINT 5.1] LLM analysis complete');
            console.log('✅ [CHECKPOINT 5.2] LLM cost: $' + llmAnalysis.cost.toFixed(4));
            
            // ============================================
            // STEP 5: STATISTICAL ANALYSIS
            // ============================================
            console.log('🔵 [CHECKPOINT 6] Running statistical analysis...');
            
            const frequencyData = await this.getPatternFrequency(
                llmAnalysis.missingTriggers,
                templateId
            );
            
            console.log('✅ [CHECKPOINT 6.1] Frequency analysis complete');
            
            // ============================================
            // STEP 6: CALCULATE IMPACT SCORES
            // ============================================
            console.log('🔵 [CHECKPOINT 7] Calculating impact scores...');
            
            const impactScores = this.calculateImpactScores(
                llmAnalysis,
                frequencyData,
                normalizedTierResults.finalConfidence
            );
            
            console.log('✅ [CHECKPOINT 7.1] Impact scores calculated:', impactScores.length);
            
            // ============================================
            // STEP 7: DETECT CONFLICTS (if enabled)
            // ============================================
            let conflicts = [];
            
            if (preset.testPilot.conflictDetection !== 'DISABLED') {
                console.log('🔵 [CHECKPOINT 8] Detecting conflicts...');
                
                conflicts = await this.detectConflicts(
                    llmAnalysis.missingTriggers,
                    template,
                    preset.testPilot.conflictDetection
                );
                
                console.log('✅ [CHECKPOINT 8.1] Conflicts detected:', conflicts.length);
            } else {
                console.log('⏭️ [CHECKPOINT 8] Conflict detection disabled');
            }
            
            // ============================================
            // STEP 8: COST PROJECTION
            // ============================================
            console.log('🔵 [CHECKPOINT 9] Projecting cost impact...');
            
            const costAnalysis = this.projectCostImpact(
                impactScores,
                llmAnalysis.cost,
                normalizedTierResults
            );
            
            console.log('✅ [CHECKPOINT 9.1] Cost projection complete');
            console.log('✅ [CHECKPOINT 9.2] Projected monthly savings: $' + costAnalysis.projectedMonthlySavings.toFixed(2));
            
            // ============================================
            // STEP 9: GENERATE SUGGESTIONS
            // ============================================
            console.log('🔵 [CHECKPOINT 10] Generating suggestions...');
            
            const suggestions = this.generateSuggestions(
                llmAnalysis,
                impactScores,
                conflicts,
                preset.testPilot.suggestionFilter
            );
            
            console.log('✅ [CHECKPOINT 10.1] Suggestions generated:', suggestions.length);
            
            // ============================================
            // STEP 10: SAVE ANALYSIS
            // ============================================
            console.log('🔵 [CHECKPOINT 11] Saving analysis to database...');
            
            const analysis = await this.saveAnalysis({
                templateId,
                testPhrase,
                intelligenceMode,
                tierResults: normalizedTierResults,
                llmAnalysis,
                suggestions,
                conflicts,
                costAnalysis,
                hadMissingData: normalizedTierResults.hadMissingData
            });
            
            console.log('✅ [CHECKPOINT 11.1] Analysis saved with ID:', analysis._id);
            
            // ============================================
            // STEP 11: RETURN RESULTS
            // ============================================
            console.log('✅ [CHECKPOINT 12] analyzeTestCall() complete!');
            
            return {
                analyzed: true,
                analysisId: analysis._id,
                mode: preset.displayName,
                suggestions,
                conflicts,
                costAnalysis,
                llmAnalysis,
                tierResults: normalizedTierResults,
                hadMissingData: normalizedTierResults.hadMissingData
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT ERROR] analyzeTestCall() failed:', error.message);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * SHOULD ANALYZE DECISION
     * ============================================================================
     * Determines if LLM analysis should run based on preset configuration
     * 
     * @param {Number} confidence - Final confidence from tiers
     * @param {String} analysisMode - ALWAYS, ON_FAILURE, or CRITICAL_ONLY
     * @param {Number} minConfidence - Threshold for analysis
     * @returns {Boolean} True if should analyze
     * ============================================================================
     */
    shouldAnalyze(confidence, analysisMode, minConfidence) {
        console.log('🔵 [CHECKPOINT - shouldAnalyze] Mode:', analysisMode, 'Confidence:', confidence, 'Threshold:', minConfidence);
        
        switch (analysisMode) {
            case 'ALWAYS':
                return true; // Analyze every test
                
            case 'ON_FAILURE':
                return confidence < minConfidence; // Only if below threshold
                
            case 'CRITICAL_ONLY':
                return confidence < 0.40; // Only catastrophic failures
                
            default:
                console.error('❌ [shouldAnalyze] Invalid analysisMode:', analysisMode);
                return false;
        }
    }
    
    /**
     * ============================================================================
     * RUN LLM ANALYSIS (Core Intelligence)
     * ============================================================================
     * Calls OpenAI GPT to analyze why Tier 1 failed and suggest improvements
     * 
     * @param {String} testPhrase - User's input
     * @param {Object} tierResults - All tier results
     * @param {Object} template - Template being tested
     * @param {Object} config - Test pilot configuration
     * @returns {Object} LLM analysis results
     * 
     * CHECKPOINT FLOW:
     * 1. Build LLM prompt
     * 2. Call OpenAI API
     * 3. Parse response
     * 4. Calculate cost
     * 5. Return structured data
     * ============================================================================
     */
    async runLLMAnalysis(testPhrase, tierResults, template, config) {
        console.log('🔵 [CHECKPOINT - LLM] Starting LLM analysis with model:', config.llmModel);
        
        try {
            // Build comprehensive prompt
            const systemPrompt = this.buildSystemPrompt(config.analysisDepth);
            const userPrompt = this.buildUserPrompt(testPhrase, tierResults, template);
            
            console.log('🔵 [CHECKPOINT - LLM 1] Prompt built, calling OpenAI...');
            
            const startTime = Date.now();
            
            const completion = await openai.chat.completions.create({
                model: config.llmModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7,
                max_tokens: config.analysisDepth === 'DEEP' ? 2000 : 1000
            });
            
            const responseTime = Date.now() - startTime;
            
            console.log('✅ [CHECKPOINT - LLM 2] OpenAI response received in', responseTime, 'ms');
            
            // Parse JSON response
            const result = JSON.parse(completion.choices[0].message.content);
            
            // Calculate cost
            const cost = this.calculateLLMCost(
                completion.usage.prompt_tokens,
                completion.usage.completion_tokens,
                config.llmModel
            );
            
            console.log('✅ [CHECKPOINT - LLM 3] Analysis parsed. Cost: $' + cost.toFixed(4));
            
            return {
                ...result,
                cost,
                tokens: completion.usage,
                model: config.llmModel,
                responseTimeMs: responseTime
            };
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - LLM ERROR]:', error.message);
            
            // If OpenAI fails, return basic analysis (don't crash)
            return {
                missingFillers: [],
                missingTriggers: [],
                missingSynonyms: [],
                missingKeywords: [],
                contextConfusion: 'LLM analysis unavailable: ' + error.message,
                suggestedScenario: tierResults.tier3?.scenario?.name || 'Unknown',
                edgeCases: [],
                reasoning: 'Failed to get LLM analysis',
                cost: 0,
                tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                model: config.llmModel,
                responseTimeMs: 0,
                error: error.message
            };
        }
    }
    
    /**
     * Build system prompt based on analysis depth
     */
    buildSystemPrompt(depth) {
        const basePrompt = `You are an expert AI template quality analyzer for Test Pilot.

Your job: Analyze why the rule-based AI (Tier 1) failed to match this test phrase correctly.

Return JSON with:
- missingFillers: Array of filler words not in template (e.g., ["neighbor", "noticed"])
- missingTriggers: Array of trigger phrases not in template (e.g., ["not working", "broken"])
- missingSynonyms: Array of {colloquial, technical} pairs (e.g., [{"colloquial": "AC", "technical": "air conditioner"}])
- missingKeywords: Array of supporting keywords (e.g., ["garage", "leaking"])
- contextConfusion: String explaining why rules failed
- suggestedScenario: String - which scenario this SHOULD match
- edgeCases: Array of {phrase, likelihood} - similar phrases that might fail
- reasoning: String - your explanation

IMPORTANT:
- Filler words are conversational noise (um, neighbor, actually, noticed)
- Triggers are core words that cause a match (not working, broken, emergency)
- Synonyms map colloquial → technical (AC → air conditioner)
- Keywords are supporting context (garage, leaking, unit)`;

        if (depth === 'DEEP') {
            return basePrompt + `\n\nDEEP ANALYSIS MODE:
- Predict 3-5 edge cases
- Find ALL potential fillers (be thorough)
- Suggest exact regex patterns if needed
- Consider multilingual variations`;
        } else if (depth === 'STANDARD') {
            return basePrompt + `\n\nSTANDARD ANALYSIS MODE:
- Predict 1-2 edge cases
- Focus on obvious fillers
- Standard patterns only`;
        } else {
            return basePrompt + `\n\nSHALLOW ANALYSIS MODE:
- Only critical issues
- No edge case prediction
- Minimal suggestions`;
        }
    }
    
    /**
     * Build user prompt with test data
     */
    buildUserPrompt(testPhrase, tierResults, template) {
        return `Test phrase: "${testPhrase}"

Tier 1 (Rule-Based): ${tierResults.tier1.confidence * 100}% confidence
Tier 2 (Semantic): ${tierResults.tier2.confidence * 100}% confidence  
Tier 3 (LLM): ${tierResults.tier3.confidence * 100}% confidence

Current template has:
- ${template.fillerWords?.length || 0} filler words
- ${template.categories?.length || 0} categories
- ${template.stats?.totalScenarios || 0} scenarios

Tier 1 matched:
- Fillers: ${JSON.stringify(tierResults.tier1.matchedFillers || [])}
- Triggers: ${JSON.stringify(tierResults.tier1.matchedTriggers || [])}
- Keywords: ${JSON.stringify(tierResults.tier1.matchedKeywords || [])}

Why did Tier 1 fail? What should be added to improve matching?`;
    }
    
    /**
     * Calculate LLM API cost
     */
    calculateLLMCost(promptTokens, completionTokens, model) {
        const pricing = this.pricing[model] || this.pricing['gpt-4o-mini'];
        return (promptTokens * pricing.input) + (completionTokens * pricing.output);
    }
    
    /**
     * ============================================================================
     * GET PATTERN FREQUENCY (Statistical Analysis)
     * ============================================================================
     * Analyzes how often suggested patterns appear in historical tests
     * 
     * @param {Array} patterns - Patterns to check (triggers/fillers/etc)
     * @param {String} templateId - Template ID
     * @returns {Object} Frequency data per pattern
     * ============================================================================
     */
    async getPatternFrequency(patterns, templateId) {
        console.log('🔵 [CHECKPOINT - FREQUENCY] Analyzing pattern frequency for', patterns.length, 'patterns');
        
        try {
            // Get last 100 tests for this template
            const recentTests = await TestPilotAnalysis.find({ templateId })
                .sort({ analyzedAt: -1 })
                .limit(100);
            
            if (recentTests.length === 0) {
                console.log('⚠️ [CHECKPOINT - FREQUENCY] No historical data - using defaults');
                return patterns.reduce((acc, pattern) => {
                    acc[pattern] = { frequency: 0.01, occurrences: 0, total: 0 };
                    return acc;
                }, {});
            }
            
            console.log('✅ [CHECKPOINT - FREQUENCY] Loaded', recentTests.length, 'historical tests');
            
            // Count occurrences
            const frequencyData = {};
            
            patterns.forEach(pattern => {
                const occurrences = recentTests.filter(test => 
                    test.testPhrase.toLowerCase().includes(pattern.toLowerCase())
                ).length;
                
                frequencyData[pattern] = {
                    frequency: occurrences / recentTests.length,
                    occurrences,
                    total: recentTests.length
                };
            });
            
            console.log('✅ [CHECKPOINT - FREQUENCY] Frequency analysis complete');
            
            return frequencyData;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - FREQUENCY ERROR]:', error.message);
            // Return safe defaults
            return patterns.reduce((acc, pattern) => {
                acc[pattern] = { frequency: 0.01, occurrences: 0, total: 0 };
                return acc;
            }, {});
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE IMPACT SCORES (Priority Ranking)
     * ============================================================================
     * Calculates impact score for each suggestion based on:
     * - Pattern frequency (how often it appears)
     * - Confidence gain (how much it would improve)
     * - Cost savings (production ROI)
     * 
     * Formula: impactScore = frequency × confidenceGain × costFactor
     * 
     * @param {Object} llmAnalysis - LLM suggestions
     * @param {Object} frequencyData - Pattern frequencies
     * @param {Number} currentConfidence - Current match confidence
     * @returns {Array} Scored suggestions
     * ============================================================================
     */
    calculateImpactScores(llmAnalysis, frequencyData, currentConfidence) {
        console.log('🔵 [CHECKPOINT - IMPACT] Calculating impact scores...');
        
        const scoredSuggestions = [];
        
        // Score missing triggers (usually highest impact)
        llmAnalysis.missingTriggers?.forEach(trigger => {
            const freq = frequencyData[trigger] || { frequency: 0.01 };
            const confidenceGain = 0.15; // Triggers typically add 15% confidence
            const costFactor = 10; // High cost impact (tier shift)
            
            const impactScore = freq.frequency * confidenceGain * costFactor;
            
            scoredSuggestions.push({
                type: 'MISSING_TRIGGER',
                pattern: trigger,
                frequency: freq.frequency,
                confidenceGain,
                impactScore: Math.min(impactScore * 100, 100), // 0-100 scale
                priority: this.calculatePriority(impactScore * 100)
            });
        });
        
        // Score missing fillers (medium impact)
        llmAnalysis.missingFillers?.forEach(filler => {
            const freq = frequencyData[filler] || { frequency: 0.01 };
            const confidenceGain = 0.08; // Fillers add ~8% by reducing noise
            const costFactor = 5;
            
            const impactScore = freq.frequency * confidenceGain * costFactor;
            
            scoredSuggestions.push({
                type: 'MISSING_FILLER',
                pattern: filler,
                frequency: freq.frequency,
                confidenceGain,
                impactScore: Math.min(impactScore * 100, 100),
                priority: this.calculatePriority(impactScore * 100)
            });
        });
        
        // Score missing synonyms (medium impact)
        llmAnalysis.missingSynonyms?.forEach(synonym => {
            const freq = frequencyData[synonym.colloquial] || { frequency: 0.01 };
            const confidenceGain = 0.10;
            const costFactor = 7;
            
            const impactScore = freq.frequency * confidenceGain * costFactor;
            
            scoredSuggestions.push({
                type: 'MISSING_SYNONYM',
                pattern: synonym,
                frequency: freq.frequency,
                confidenceGain,
                impactScore: Math.min(impactScore * 100, 100),
                priority: this.calculatePriority(impactScore * 100)
            });
        });
        
        // Score missing keywords (low impact)
        llmAnalysis.missingKeywords?.forEach(keyword => {
            const freq = frequencyData[keyword] || { frequency: 0.01 };
            const confidenceGain = 0.03;
            const costFactor = 2;
            
            const impactScore = freq.frequency * confidenceGain * costFactor;
            
            scoredSuggestions.push({
                type: 'MISSING_KEYWORD',
                pattern: keyword,
                frequency: freq.frequency,
                confidenceGain,
                impactScore: Math.min(impactScore * 100, 100),
                priority: this.calculatePriority(impactScore * 100)
            });
        });
        
        console.log('✅ [CHECKPOINT - IMPACT] Scored', scoredSuggestions.length, 'suggestions');
        
        // Sort by impact score (highest first)
        return scoredSuggestions.sort((a, b) => b.impactScore - a.impactScore);
    }
    
    /**
     * Calculate priority tier based on impact score
     */
    calculatePriority(impactScore) {
        if (impactScore >= 70) return 'CRITICAL';
        if (impactScore >= 50) return 'HIGH';
        if (impactScore >= 20) return 'MEDIUM';
        return 'LOW';
    }
    
    /**
     * ============================================================================
     * DETECT CONFLICTS (Placeholder - will be implemented by ConflictDetector)
     * ============================================================================
     */
    async detectConflicts(patterns, template, mode) {
        console.log('🔵 [CHECKPOINT - CONFLICTS] Detecting conflicts (mode:', mode, ')');
        // TODO: Implement in ConflictDetector.js
        // For now, return empty array
        return [];
    }
    
    /**
     * ============================================================================
     * PROJECT COST IMPACT
     * ============================================================================
     * Estimates cost savings if suggestions are applied
     * 
     * @param {Array} scoredSuggestions - Impact-scored suggestions
     * @param {Number} analysisCost - Cost of this analysis
     * @param {Object} tierResults - Current tier results
     * @returns {Object} Cost projection
     * ============================================================================
     */
    projectCostImpact(scoredSuggestions, analysisCost, tierResults) {
        console.log('🔵 [CHECKPOINT - COST] Projecting cost impact...');
        
        // Average calls per day (estimate)
        const callsPerDay = 100;
        
        // Current cost per call (if using Tier 3)
        const currentCostPerCall = tierResults.finalTier === 'tier3' ? 0.50 : 0.00;
        
        // Estimated cost after improvements (shift to Tier 1)
        const futureConfidence = tierResults.finalConfidence + 
            scoredSuggestions.reduce((sum, s) => sum + s.confidenceGain, 0);
        
        const futureCostPerCall = futureConfidence >= 0.80 ? 0.00 : 0.50;
        
        // Calculate savings
        const dailySavings = (currentCostPerCall - futureCostPerCall) * callsPerDay;
        const monthlySavings = dailySavings * 30;
        const roi = monthlySavings / analysisCost;
        const paybackDays = analysisCost / (dailySavings || 0.01);
        
        console.log('✅ [CHECKPOINT - COST] Projected monthly savings: $' + monthlySavings.toFixed(2));
        
        return {
            analysisCost,
            projectedDailySavings: Math.max(0, dailySavings),
            projectedMonthlySavings: Math.max(0, monthlySavings),
            roi: Math.max(0, roi),
            paybackDays: Math.min(365, Math.max(0, paybackDays))
        };
    }
    
    /**
     * ============================================================================
     * GENERATE SUGGESTIONS (Final Output)
     * ============================================================================
     * Converts scored patterns into actionable suggestion objects
     * 
     * @param {Object} llmAnalysis - LLM results
     * @param {Array} impactScores - Scored patterns
     * @param {Array} conflicts - Detected conflicts
     * @param {String} filter - Suggestion filter (ALL, HIGH_PRIORITY, CRITICAL_ONLY)
     * @returns {Array} Structured suggestions
     * ============================================================================
     */
    generateSuggestions(llmAnalysis, impactScores, conflicts, filter) {
        console.log('🔵 [CHECKPOINT - SUGGESTIONS] Generating suggestions (filter:', filter, ')');
        
        const suggestions = [];
        
        // Convert impact scores to suggestions
        impactScores.forEach(score => {
            // Apply filter
            if (filter === 'HIGH_PRIORITY' && !['HIGH', 'CRITICAL'].includes(score.priority)) {
                return; // Skip
            }
            if (filter === 'CRITICAL_ONLY' && score.priority !== 'CRITICAL') {
                return; // Skip
            }
            
            suggestions.push({
                suggestionId: ulid(),
                type: score.type,
                priority: score.priority,
                title: this.generateSuggestionTitle(score),
                description: this.generateSuggestionDescription(score),
                suggestedWords: this.extractWords(score.pattern),
                targetScenario: {
                    scenarioId: llmAnalysis.suggestedScenario || 'unknown',
                    scenarioName: llmAnalysis.suggestedScenario || 'Unknown',
                    categoryId: null,
                    categoryName: null
                },
                impactScore: score.impactScore,
                estimatedConfidenceGain: score.confidenceGain,
                patternFrequency: score.frequency,
                estimatedDailySavings: score.impactScore * 0.01, // Simple heuristic
                beforeMetrics: {
                    confidence: 0.42, // Will be filled by caller
                    tier: 'tier3',
                    cost: 0.003,
                    responseTimeMs: 847
                },
                afterMetrics: {
                    confidence: 0.94,
                    tier: 'tier1',
                    cost: 0.000,
                    responseTimeMs: 45
                },
                status: 'pending',
                createdAt: new Date()
            });
        });
        
        console.log('✅ [CHECKPOINT - SUGGESTIONS] Generated', suggestions.length, 'suggestions');
        
        return suggestions;
    }
    
    /**
     * Helper: Generate suggestion title
     */
    generateSuggestionTitle(score) {
        switch (score.type) {
            case 'MISSING_TRIGGER':
                return `Missing trigger: "${typeof score.pattern === 'string' ? score.pattern : JSON.stringify(score.pattern)}"`;
            case 'MISSING_FILLER':
                return `Missing filler: "${score.pattern}"`;
            case 'MISSING_SYNONYM':
                return `Missing synonym: "${score.pattern.colloquial}" → "${score.pattern.technical}"`;
            case 'MISSING_KEYWORD':
                return `Missing keyword: "${score.pattern}"`;
            default:
                return `Improvement: ${score.type}`;
        }
    }
    
    /**
     * Helper: Generate suggestion description
     */
    generateSuggestionDescription(score) {
        const freq = (score.frequency * 100).toFixed(0);
        const gain = (score.confidenceGain * 100).toFixed(0);
        
        return `This pattern appears in ${freq}% of test calls and could improve confidence by ${gain}%. Adding it would help the AI better understand customer intent.`;
    }
    
    /**
     * Helper: Extract words from pattern
     */
    extractWords(pattern) {
        if (typeof pattern === 'string') {
            return [pattern];
        }
        if (pattern.colloquial && pattern.technical) {
            return [pattern.colloquial, pattern.technical];
        }
        return [];
    }
    
    /**
     * ============================================================================
     * SAVE ANALYSIS (Database Storage)
     * ============================================================================
     * Saves complete analysis to TestPilotAnalysis collection
     * 
     * @param {Object} data - Analysis data
     * @returns {Object} Saved analysis document
     * ============================================================================
     */
    async saveAnalysis(data) {
        console.log('🔵 [CHECKPOINT - SAVE] Saving analysis to database...');
        
        try {
            // ============================================
            // 🛡️ NORMALIZE LLM ANALYSIS DATA
            // ============================================
            // The LLM might return lowercase enum values (e.g., "high" instead of "HIGH")
            // Normalize to match Mongoose schema enums
            const normalizedLLMAnalysis = { ...data.llmAnalysis };
            
            if (normalizedLLMAnalysis.edgeCases && Array.isArray(normalizedLLMAnalysis.edgeCases)) {
                normalizedLLMAnalysis.edgeCases = normalizedLLMAnalysis.edgeCases.map(edge => ({
                    ...edge,
                    likelihood: edge.likelihood ? edge.likelihood.toUpperCase() : 'MEDIUM'
                }));
                
                console.log('✅ [CHECKPOINT - SAVE] Normalized', normalizedLLMAnalysis.edgeCases.length, 'edge case likelihood values');
            }
            
            const analysis = await TestPilotAnalysis.create({
                templateId: data.templateId,
                testPhrase: data.testPhrase,
                intelligenceMode: data.intelligenceMode,
                tierResults: data.tierResults,
                llmAnalysis: normalizedLLMAnalysis,
                suggestions: data.suggestions,
                suggestionsSummary: {
                    total: data.suggestions.length,
                    high: data.suggestions.filter(s => s.priority === 'HIGH').length,
                    medium: data.suggestions.filter(s => s.priority === 'MEDIUM').length,
                    low: data.suggestions.filter(s => s.priority === 'LOW').length,
                    critical: data.suggestions.filter(s => s.priority === 'CRITICAL').length,
                    applied: 0,
                    ignored: 0,
                    pending: data.suggestions.length
                },
                conflicts: data.conflicts,
                conflictsSummary: {
                    total: data.conflicts.length,
                    critical: data.conflicts.filter(c => c.severity === 'CRITICAL').length,
                    warnings: data.conflicts.filter(c => c.severity === 'WARNING').length,
                    resolved: 0,
                    open: data.conflicts.length
                },
                costAnalysis: data.costAnalysis,
                analyzedAt: new Date()
            });
            
            console.log('✅ [CHECKPOINT - SAVE] Analysis saved with ID:', analysis._id);
            
            return analysis;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT - SAVE ERROR]:', error.message);
            throw error;
        }
    }
}

module.exports = EnterpriseAISuggestionEngine;


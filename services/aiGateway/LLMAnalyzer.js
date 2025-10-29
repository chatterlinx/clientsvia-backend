// ============================================================================
// 🧠 AI GATEWAY - LLM ANALYZER SERVICE
// ============================================================================
// PURPOSE: Analyze Tier 3 LLM calls and generate improvement suggestions
// FEATURES: Pattern detection, synonym extraction, missing scenario identification
// INTEGRATIONS: OpenAI GPT-4, SuggestionKnowledgeBase, NotificationCenter
// CREATED: 2025-10-29
// ============================================================================

const OpenAI = require('openai');
const { AIGatewayCallLog, AIGatewaySuggestion } = require('../../models/aiGateway');
const Template = require('../../models/GlobalInstantResponseTemplate');
const AdminNotificationService = require('../AdminNotificationService');
const logger = require('../../utils/logger');

class LLMAnalyzer {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [AI GATEWAY ANALYZER] Initializing LLMAnalyzer...');
        
        this.enabled = process.env.ENABLE_LLM_SUGGESTION_ANALYZER === 'true';
        this.model = process.env.LLM_SUGGESTION_MODEL || 'gpt-4o-mini';
        
        if (this.enabled && process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            console.log(`✅ [AI GATEWAY ANALYZER] Initialized with model: ${this.model}`);
        } else {
            console.log('⚙️ [AI GATEWAY ANALYZER] Disabled (ENABLE_LLM_SUGGESTION_ANALYZER not true)');
        }
    }
    
    // ========================================================================
    // 🔍 ANALYZE SINGLE CALL
    // ========================================================================
    
    async analyzeCall(callLog) {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 1: Starting Call Analysis
        // ────────────────────────────────────────────────────────────────────
        console.log(`🔍 [AI GATEWAY ANALYZER] CHECKPOINT 1: Analyzing call ${callLog.callId}`);
        
        if (!this.enabled) {
            console.log('⚙️ [AI GATEWAY ANALYZER] Analyzer disabled, skipping');
            return [];
        }
        
        if (callLog.tierUsed !== 'Tier3' && callLog.tierUsed !== 'Fallback') {
            console.log(`⏭️ [AI GATEWAY ANALYZER] Skipping non-Tier3 call (${callLog.tierUsed})`);
            return [];
        }
        
        if (callLog.analyzed) {
            console.log('⏭️ [AI GATEWAY ANALYZER] Call already analyzed, skipping');
            return [];
        }
        
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 2: Loading Template Context
        // ────────────────────────────────────────────────────────────────────
        console.log(`📥 [AI GATEWAY ANALYZER] CHECKPOINT 2: Loading template context...`);
        
        try {
            const template = await Template.findById(callLog.templateId);
            if (!template) {
                throw new Error(`Template not found: ${callLog.templateId}`);
            }
            
            const categories = template.categories || [];
            const scenarios = categories.flatMap(cat => cat.scenarios || []);
            
            console.log(`✅ [AI GATEWAY ANALYZER] Loaded template "${template.name}" with ${scenarios.length} scenarios`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Building Analysis Prompt
            // ────────────────────────────────────────────────────────────────
            console.log('📝 [AI GATEWAY ANALYZER] CHECKPOINT 3: Building analysis prompt...');
            
            const prompt = this._buildAnalysisPrompt(callLog, template, categories, scenarios);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 4: Calling OpenAI API
            // ────────────────────────────────────────────────────────────────
            console.log('📡 [AI GATEWAY ANALYZER] CHECKPOINT 4: Calling OpenAI API...');
            
            const startTime = Date.now();
            
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                response_format: { type: "json_object" }
            });
            
            const analysisTime = Date.now() - startTime;
            console.log(`✅ [AI GATEWAY ANALYZER] OpenAI responded in ${analysisTime}ms`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 5: Parsing LLM Response
            // ────────────────────────────────────────────────────────────────
            console.log('🔍 [AI GATEWAY ANALYZER] CHECKPOINT 5: Parsing LLM response...');
            
            const llmOutput = response.choices[0].message.content;
            const analysis = JSON.parse(llmOutput);
            
            console.log(`✅ [AI GATEWAY ANALYZER] Parsed analysis: ${Object.keys(analysis).length} suggestion types detected`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 6: Creating Suggestion Documents
            // ────────────────────────────────────────────────────────────────
            console.log('💾 [AI GATEWAY ANALYZER] CHECKPOINT 6: Creating suggestion documents...');
            
            const suggestions = await this._createSuggestions(analysis, callLog, template);
            
            console.log(`✅ [AI GATEWAY ANALYZER] Created ${suggestions.length} suggestions`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 7: Marking Call as Analyzed
            // ────────────────────────────────────────────────────────────────
            await callLog.markAnalyzed(true);
            console.log('✅ [AI GATEWAY ANALYZER] CHECKPOINT 7: Call marked as analyzed');
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Send alert for high-priority suggestions
            // ────────────────────────────────────────────────────────────────
            const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
            if (highPrioritySuggestions.length > 0) {
                await AdminNotificationService.sendNotification({
                    code: 'AI_GATEWAY_HIGH_PRIORITY_SUGGESTIONS',
                    severity: 'WARNING',
                    message: `${highPrioritySuggestions.length} high-priority suggestions generated for template: ${template.name}`,
                    details: {
                        templateId: template._id,
                        templateName: template.name,
                        callLogId: callLog._id,
                        suggestionsCount: suggestions.length,
                        highPriorityCount: highPrioritySuggestions.length
                    },
                    source: 'AIGatewayLLMAnalyzer',
                    actionLink: '/admin-global-instant-responses.html#ai-gateway'
                });
                console.log('📢 [AI GATEWAY ANALYZER] NOTIFICATION: Sent high-priority suggestions alert');
            }
            
            return suggestions;
            
        } catch (error) {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT ERROR: Analysis Failed
            // ────────────────────────────────────────────────────────────────
            console.error('❌ [AI GATEWAY ANALYZER] CHECKPOINT ERROR: Analysis failed');
            console.error('❌ [AI GATEWAY ANALYZER] Error:', error.message);
            console.error('❌ [AI GATEWAY ANALYZER] Stack:', error.stack);
            
            await callLog.markAnalyzed(false, error.message);
            
            logger.error(`[AI GATEWAY ANALYZER] Failed to analyze call ${callLog.callId}`, {
                error: error.message,
                stack: error.stack,
                callLogId: callLog._id
            });
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Send critical alert after 3 failures
            // ────────────────────────────────────────────────────────────────
            if (callLog.analysisAttempts >= 3) {
                await AdminNotificationService.sendNotification({
                    code: 'AI_GATEWAY_ANALYSIS_FAILED_CRITICAL',
                    severity: 'CRITICAL',
                    message: `Failed to analyze call after 3 attempts: ${error.message}`,
                    details: {
                        callLogId: callLog._id,
                        callId: callLog.callId,
                        error: error.message,
                        attempts: callLog.analysisAttempts
                    },
                    source: 'AIGatewayLLMAnalyzer'
                });
                console.log('📢 [AI GATEWAY ANALYZER] NOTIFICATION: Sent critical failure alert');
            }
            
            throw error;
        }
    }
    
    // ========================================================================
    // 📝 BUILD ANALYSIS PROMPT
    // ========================================================================
    
    _buildAnalysisPrompt(callLog, template, categories, scenarios) {
        const scenarioList = scenarios.map(s => `- ${s.name}: Keywords: ${s.keywords.join(', ')}`).join('\n');
        
        return `You are analyzing a customer service call where the AI agent used expensive LLM fallback (Tier 3) instead of cheaper rule-based or semantic matching.

Your task: Identify specific improvements to prevent future LLM calls.

Call Details:
- Template: ${template.name}
- User Input: "${callLog.userInput}"
- Tier 1 Result: ${callLog.tier1Result.matched ? 'Matched' : 'Failed'} (confidence: ${callLog.tier1Result.confidence || 0})
- Tier 2 Result: ${callLog.tier2Result.matched ? 'Matched' : 'Failed'} (confidence: ${callLog.tier2Result.confidence || 0})
- Tier 3 Result: Matched (confidence: ${callLog.tier3Result.confidence || 0})
- LLM Reasoning: ${callLog.tier3Result.llmReasoning || 'Not available'}

Existing Scenarios:
${scenarioList}

Analyze and return JSON with these improvement suggestions:

{
  "fillerWords": ["um", "like", "you know"],
  "synonymMappings": [
    {
      "colloquial": "thingy on wall",
      "technical": "thermostat",
      "confidence": 0.95,
      "occurrences": 12
    }
  ],
  "keywordEnhancements": [
    {
      "scenarioName": "Thermostat Battery Replacement",
      "suggestedKeywords": ["thingy", "wall device"],
      "reason": "These terms appeared but weren't recognized"
    }
  ],
  "negativeKeywords": [
    {
      "scenarioName": "Appointment Booking",
      "suggestedNegativeKeywords": ["don't need", "not interested"],
      "reason": "Prevents false positive matches"
    }
  ],
  "missingScenario": {
    "name": "Payment Plan Inquiry",
    "category": "Billing & Payment",
    "keywords": ["payment plan", "installments", "monthly payments"],
    "negativeKeywords": ["cancel", "refund"],
    "response": "We offer flexible payment plans for repairs over $500...",
    "reasoning": "23 similar calls this month with no matching scenario"
  },
  "impact": {
    "similarCallsThisMonth": 12,
    "estimatedMonthlySavings": 5.64,
    "performanceGain": 2785,
    "affectedCalls": 45
  },
  "reasoning": "Full explanation of why Tier 1/2 failed and how these improvements help..."
}

Return ONLY valid JSON. Be specific and actionable.`;
    }
    
    // ========================================================================
    // 💾 CREATE SUGGESTION DOCUMENTS
    // ========================================================================
    
    async _createSuggestions(analysis, callLog, template) {
        const suggestions = [];
        
        // Filler Words
        if (analysis.fillerWords && analysis.fillerWords.length > 0) {
            const suggestion = await AIGatewaySuggestion.create({
                type: 'filler-words',
                templateId: template._id,
                callLogId: callLog._id,
                priority: 'low',
                confidence: 0.8,
                fillerWords: analysis.fillerWords,
                llmReasoning: analysis.reasoning,
                llmModel: this.model,
                impact: {
                    affectedCalls: analysis.impact?.affectedCalls || 0,
                    performanceGain: analysis.impact?.performanceGain || 0
                }
            });
            suggestions.push(suggestion);
            console.log(`✅ [AI GATEWAY ANALYZER] Created filler-words suggestion: ${analysis.fillerWords.length} words`);
        }
        
        // Synonym Mappings
        if (analysis.synonymMappings && analysis.synonymMappings.length > 0) {
            for (const mapping of analysis.synonymMappings) {
                const suggestion = await AIGatewaySuggestion.create({
                    type: 'synonym',
                    templateId: template._id,
                    callLogId: callLog._id,
                    priority: mapping.occurrences > 10 ? 'high' : 'medium',
                    confidence: mapping.confidence || 0.7,
                    synonymMapping: {
                        colloquial: mapping.colloquial,
                        technical: mapping.technical
                    },
                    llmReasoning: analysis.reasoning,
                    llmModel: this.model,
                    impact: {
                        similarCallsThisMonth: mapping.occurrences || 0,
                        estimatedMonthlySavings: (mapping.occurrences || 0) * 0.47,
                        estimatedAnnualSavings: (mapping.occurrences || 0) * 0.47 * 12
                    }
                });
                suggestions.push(suggestion);
                console.log(`✅ [AI GATEWAY ANALYZER] Created synonym suggestion: "${mapping.colloquial}" → "${mapping.technical}"`);
            }
        }
        
        // Keyword Enhancements
        if (analysis.keywordEnhancements && analysis.keywordEnhancements.length > 0) {
            for (const enhancement of analysis.keywordEnhancements) {
                // Find scenario in template's embedded arrays
                let scenario = null;
                let categoryId = null;
                for (const cat of template.categories) {
                    const found = cat.scenarios.find(s => s.name === enhancement.scenarioName);
                    if (found) {
                        scenario = found;
                        categoryId = cat._id;
                        break;
                    }
                }
                
                if (scenario) {
                    const suggestion = await AIGatewaySuggestion.create({
                        type: 'keywords',
                        templateId: template._id,
                        scenarioId: scenario._id,
                        categoryId: categoryId,
                        callLogId: callLog._id,
                        priority: 'medium',
                        confidence: 0.75,
                        suggestedKeywords: enhancement.suggestedKeywords,
                        llmReasoning: enhancement.reason,
                        llmModel: this.model
                    });
                    suggestions.push(suggestion);
                    console.log(`✅ [AI GATEWAY ANALYZER] Created keywords suggestion for scenario: ${enhancement.scenarioName}`);
                }
            }
        }
        
        // Missing Scenario
        if (analysis.missingScenario && analysis.missingScenario.name) {
            const suggestion = await AIGatewaySuggestion.create({
                type: 'missing-scenario',
                templateId: template._id,
                callLogId: callLog._id,
                priority: 'high',
                confidence: 0.9,
                suggestedScenarioName: analysis.missingScenario.name,
                suggestedCategory: analysis.missingScenario.category,
                suggestedKeywordsForScenario: analysis.missingScenario.keywords,
                suggestedNegativeKeywordsForScenario: analysis.missingScenario.negativeKeywords || [],
                suggestedResponse: analysis.missingScenario.response,
                llmReasoning: analysis.missingScenario.reasoning,
                llmModel: this.model,
                impact: {
                    affectedCalls: analysis.impact?.similarCallsThisMonth || 0,
                    estimatedMonthlySavings: analysis.impact?.estimatedMonthlySavings || 0
                }
            });
            suggestions.push(suggestion);
            console.log(`✅ [AI GATEWAY ANALYZER] Created missing-scenario suggestion: ${analysis.missingScenario.name}`);
        }
        
        return suggestions;
    }
    
    // ========================================================================
    // 📊 BATCH ANALYSIS (Process Multiple Calls)
    // ========================================================================
    
    async analyzePendingCalls(limit = 10) {
        console.log(`🔄 [AI GATEWAY ANALYZER] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY ANALYZER] BATCH ANALYSIS: Processing up to ${limit} calls`);
        console.log(`🔄 [AI GATEWAY ANALYZER] ═══════════════════════════════════════════`);
        
        if (!this.enabled) {
            console.log('⚙️ [AI GATEWAY ANALYZER] Analyzer disabled, skipping batch');
            return { processed: 0, suggestions: 0, errors: 0 };
        }
        
        const pendingCalls = await AIGatewayCallLog.findPendingAnalysis(limit);
        console.log(`📥 [AI GATEWAY ANALYZER] Found ${pendingCalls.length} pending calls`);
        
        let processed = 0;
        let totalSuggestions = 0;
        let errors = 0;
        
        for (const call of pendingCalls) {
            try {
                const suggestions = await this.analyzeCall(call);
                processed++;
                totalSuggestions += suggestions.length;
                console.log(`✅ [AI GATEWAY ANALYZER] [${processed}/${pendingCalls.length}] Processed call ${call.callId}`);
            } catch (error) {
                errors++;
                console.error(`❌ [AI GATEWAY ANALYZER] [${processed + errors}/${pendingCalls.length}] Failed to process call ${call.callId}`);
            }
        }
        
        console.log(`🔄 [AI GATEWAY ANALYZER] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY ANALYZER] BATCH COMPLETE: ${processed} processed, ${totalSuggestions} suggestions, ${errors} errors`);
        console.log(`🔄 [AI GATEWAY ANALYZER] ═══════════════════════════════════════════`);
        
        return { processed, suggestions: totalSuggestions, errors };
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new LLMAnalyzer();


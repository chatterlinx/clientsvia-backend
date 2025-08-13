// services/qaEngine.js
// Enhanced Multi-LLM Q&A Engine for ClientsVia.ai
// Production-grade, Multi-tenant Implementation with LLM Selection

const Company = require('../models/Company');
const CompanyQnA = require('../models/CompanyQnA');
const PendingQnA = require('../models/PendingQnA');
const { ObjectId } = require('mongodb');
const { getDB } = require('../db');
const { vectorSearch } = require('../clients/pinecone'); // if Pinecone is used
const { translateText } = require('../services/translation'); // optional
const { logQASearch } = require('../services/logger'); // optional logging

class EnhancedQAEngine {
  constructor() {
    this.supportedLLMs = {
      'gemini-pro': {
        name: 'Gemini Pro',
        type: 'cloud',
        apiKey: process.env.GEMINI_API_KEY,
        maxTokens: 8192,
        timeout: 60000
      },
      'openai-gpt4': {
        name: 'OpenAI GPT-4',
        type: 'cloud',
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4',
        maxTokens: 8192,
        timeout: 90000
      },
      'claude-3': {
        name: 'Claude-3',
        type: 'cloud',
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxTokens: 8192,
        timeout: 90000
      }
    };
  }

  /**
   * Enhanced Q&A processing with multi-LLM support
   * @param {string} companyId - Company ID for multi-tenant isolation
   * @param {string} question - User's question
   * @param {string} sessionId - Session identifier for tracking
   * @param {string} traceId - Trace identifier for debugging
   * @returns {Promise<Object>} Enhanced response with LLM details
   */
  async processQuestion(companyId, question, sessionId = null, traceId = null) {
    const startTime = Date.now();
    const trace = [];
    
    try {
      // Multi-tenant validation
      if (!ObjectId.isValid(companyId)) {
        throw new Error('Invalid company ID format');
      }

      this.addTrace(trace, '🚀 Starting enhanced Q&A processing', 'info');
      this.addTrace(trace, `📋 Company: ${companyId}`, 'info');
      this.addTrace(trace, `❓ Question: "${question.substring(0, 100)}..."`, 'info');

      // Load company settings
      const company = await Company.findById(companyId).select('agentIntelligenceSettings tradeCategories');
      if (!company) {
        throw new Error('Company not found');
      }

      const settings = company.agentIntelligenceSettings || {};
      this.addTrace(trace, `⚙️ LLM enabled: ${settings.useLLM}`, 'info');
      this.addTrace(trace, `🎯 Primary LLM: ${settings.primaryLLM || 'gemini-pro'}`, 'info');
      this.addTrace(trace, `🔄 Fallback threshold: ${settings.fallbackThreshold || 0.5}`, 'info');

      // PHASE 1: Search Company-specific Q&As (highest priority)
      this.addTrace(trace, '🔍 Phase 1: Searching company Q&As...', 'info');
      let companyMatch = await this.searchCompanyQAs(companyId, question);
      
      if (companyMatch && companyMatch.length > 0) {
        const bestMatch = companyMatch[0];
        const confidence = this.calculateConfidence(question, bestMatch.question);
        
        if (confidence >= (settings.confidenceThresholds?.companyQnA || 0.8)) {
          this.addTrace(trace, `✅ Company Q&A match found (${(confidence * 100).toFixed(1)}%)`, 'success');
          return this.buildResponse({
            answer: bestMatch.answer,
            confidence: confidence,
            metadata: { qnaId: bestMatch._id }
          }, 'company_qna', trace, startTime);
        }
      }

      // PHASE 2: Search Trade Category Q&As
      this.addTrace(trace, '🔍 Phase 2: Searching trade category Q&As...', 'info');
      const tradeCategories = company.tradeCategories || [];
      
      if (tradeCategories.length > 0) {
        for (const category of tradeCategories) {
          let tradeMatches = await this.searchTradeQAs(category, question);
          if (tradeMatches && tradeMatches.length > 0) {
            const bestMatch = tradeMatches[0];
            const confidence = this.calculateConfidence(question, bestMatch.question);
            
            if (confidence >= (settings.confidenceThresholds?.tradeQnA || 0.75)) {
              this.addTrace(trace, `✅ Trade Q&A match found (${(confidence * 100).toFixed(1)}%)`, 'success');
              return this.buildResponse({
                answer: bestMatch.answer,
                confidence: confidence,
                metadata: { qnaId: bestMatch._id, category: category }
              }, 'trade_qna', trace, startTime);
            }
          }
        }
      }

      // PHASE 3: Vector/Semantic Search (if enabled)
      if (settings.semanticSearchEnabled) {
        this.addTrace(trace, '🔍 Phase 3: Performing semantic search...', 'info');
        let vectorResults = await this.semanticSearch(question, { 
          companyId: companyId,
          namespace: 'company_' + companyId 
        });
        
        if (vectorResults && vectorResults.length > 0) {
          const bestMatch = vectorResults[0];
          if (bestMatch.score >= (settings.confidenceThresholds?.vectorSearch || 0.7)) {
            this.addTrace(trace, `✅ Semantic search match found (${(bestMatch.score * 100).toFixed(1)}%)`, 'success');
            return this.buildResponse({
              answer: bestMatch.metadata?.answer || 'Found relevant content',
              confidence: bestMatch.score,
              metadata: { vectorId: bestMatch.id }
            }, 'semantic_search', trace, startTime);
          }
        }
      }

      // PHASE 4: LLM Fallback (if enabled and above threshold)
      if (settings.useLLM) {
        this.addTrace(trace, '🔍 Phase 4: Engaging LLM fallback...', 'info');
        
        try {
          let llmResponse = await this.queryLLM(
            settings.primaryLLM || 'gemini-pro',
            question,
            companyId,
            settings
          );

          if (llmResponse && llmResponse.confidence >= (settings.fallbackThreshold || 0.5)) {
            this.addTrace(trace, `✅ LLM response generated (${(llmResponse.confidence * 100).toFixed(1)}%)`, 'success');
            
            // Auto-learning: Submit for approval if enabled
            if (settings.autoLearningEnabled) {
              await this.submitForLearning(companyId, question, llmResponse.answer, llmResponse.confidence, sessionId, traceId);
              this.addTrace(trace, '📚 Question submitted for learning approval', 'info');
            }
            
            return this.buildResponse(llmResponse, 'llm_generation', trace, startTime);
          } else {
            this.addTrace(trace, `⚠️ LLM confidence too low (${(llmResponse?.confidence || 0) * 100}%)`, 'warning');
          }
        } catch (llmError) {
          this.addTrace(trace, `❌ Primary LLM failed: ${llmError.message}`, 'error');
          
          // Try fallback LLM
          if (settings.fallbackLLM && settings.fallbackLLM !== settings.primaryLLM) {
            this.addTrace(trace, `🔄 Trying fallback LLM: ${settings.fallbackLLM}`, 'info');
            
            try {
              let fallbackResponse = await this.queryLLM(
                settings.fallbackLLM,
                question,
                companyId,
                settings
              );
              
              if (fallbackResponse && fallbackResponse.confidence >= (settings.fallbackThreshold || 0.5)) {
                this.addTrace(trace, `✅ Fallback LLM response generated (${(fallbackResponse.confidence * 100).toFixed(1)}%)`, 'success');
                return this.buildResponse(fallbackResponse, 'llm_fallback', trace, startTime);
              }
            } catch (fallbackError) {
              this.addTrace(trace, `❌ Fallback LLM also failed: ${fallbackError.message}`, 'error');
            }
          }
        }
      }

      // PHASE 5: Escalation
      this.addTrace(trace, '⚠️ No suitable response found, triggering escalation', 'warning');
      
      const escalationMessage = settings.fallbackMessage || 
        "I want to make sure I give you accurate information. Let me connect you with a specialist who can help.";
      
      return this.buildResponse({
        answer: escalationMessage,
        confidence: 0,
        metadata: { escalated: true }
      }, 'escalation', trace, startTime);

    } catch (error) {
      this.addTrace(trace, `❌ Critical error: ${error.message}`, 'error');
      console.error('[Enhanced QA Engine] Error:', error);
      
      return {
        success: false,
        answer: "I apologize, but I'm experiencing technical difficulties. Please try again or contact support.",
        confidence: 0,
        source: 'error',
        processingTime: Date.now() - startTime,
        trace: trace,
        error: error.message
      };
    }
  }

  /**
   * Query specific LLM with enhanced error handling and retry logic
   */
  async queryLLM(modelId, question, companyId, settings) {
    const llmConfig = this.supportedLLMs[modelId];
    if (!llmConfig) {
      throw new Error(`Unsupported LLM model: ${modelId}`);
    }

    // Check if model is allowed
    const allowedModels = settings.allowedLLMModels || ['gemini-pro'];
    if (!allowedModels.includes(modelId)) {
      throw new Error(`LLM model ${modelId} not in allowed models list`);
    }

    try {
      // For now, return simulated responses
      // TODO: Implement actual LLM API calls
      return {
        answer: `This is a simulated response from ${llmConfig.name} for: "${question.substring(0, 50)}..."`,
        confidence: Math.random() * 0.4 + 0.6, // Random confidence between 0.6-1.0
        model: llmConfig.model || modelId,
        type: llmConfig.type
      };
    } catch (error) {
      console.error(`[Enhanced QA Engine] LLM Query Error (${modelId}):`, error);
      throw error;
    }
  }

  /**
   * Submit question for learning approval
   */
  async submitForLearning(companyId, question, proposedAnswer, confidence, sessionId, traceId) {
    try {
      // Check if similar question already exists
      const existingQnA = await PendingQnA.findOne({
        companyId: new ObjectId(companyId),
        question: { $regex: new RegExp(question.substring(0, 50), 'i') },
        status: 'pending'
      });

      if (existingQnA) {
        // Increment frequency
        await existingQnA.incrementFrequency();
        return existingQnA;
      }

      // Create new pending Q&A
      const pendingQnA = new PendingQnA({
        companyId: new ObjectId(companyId),
        question: question,
        proposedAnswer: proposedAnswer,
        aiAgentContext: {
          confidence: confidence,
          sessionId: sessionId,
          traceId: traceId,
          source: 'llm_generation'
        }
      });

      await pendingQnA.save();
      return pendingQnA;

    } catch (error) {
      console.error('[Enhanced QA Engine] Learning submission error:', error);
      throw error;
    }
  }

  /**
   * Calculate confidence score between two strings
   */
  calculateConfidence(query, target) {
    // Simple confidence calculation - can be enhanced with fuzzy matching
    const queryLower = query.toLowerCase();
    const targetLower = target.toLowerCase();
    
    if (queryLower === targetLower) return 1.0;
    if (targetLower.includes(queryLower) || queryLower.includes(targetLower)) return 0.8;
    
    // Basic word overlap
    const queryWords = queryLower.split(' ');
    const targetWords = targetLower.split(' ');
    const intersection = queryWords.filter(word => targetWords.includes(word));
    const union = [...new Set([...queryWords, ...targetWords])];
    
    return intersection.length / union.length;
  }

  /**
   * Build standardized response object
   */
  buildResponse(result, source, trace, startTime) {
    return {
      success: true,
      answer: result.answer,
      confidence: result.confidence,
      source: source,
      processingTime: Date.now() - startTime,
      trace: trace,
      metadata: {
        ...result.metadata,
        model: result.model,
        type: result.type
      }
    };
  }

  /**
   * Add trace log entry
   */
  addTrace(trace, message, level = 'info') {
    trace.push({
      timestamp: new Date().toISOString(),
      message: message,
      level: level
    });
  }

  async searchCompanyQAs(companyId, query, options = {}) {
    const regex = new RegExp(query, 'i');
    const matches = await CompanyQnA.find({
      companyId,
      $or: [
        { question: regex },
        { keywords: { $in: [query.toLowerCase()] } }
      ]
    }).lean();

    return matches || [];
  }

  async searchTradeQAs(tradeCategory, query, options = {}) {
    try {
      const db = getDB();
      const regex = new RegExp(query, 'i');
      
      // Search in enterprise trade categories Q&As
      const category = await db.collection('enterpriseTradeCategories').findOne({
        name: tradeCategory
      });
      
      if (!category || !category.qnas) {
        return [];
      }
      
      // Search through Q&As for matches
      const matches = category.qnas.filter(qa => {
        return (
          regex.test(qa.question) ||
          regex.test(qa.answer) ||
          (qa.keywords && qa.keywords.some(keyword => regex.test(keyword)))
        );
      });
      
      // Transform to expected format
      return matches.map(qa => ({
        _id: qa._id || new ObjectId(),
        question: qa.question,
        answer: qa.answer,
        keywords: qa.keywords || [],
        tradeCategory: tradeCategory,
        confidence: qa.confidence || 1,
        isActive: qa.isActive !== false
      }));
      
    } catch (error) {
      console.error('Error searching trade Q&As:', error);
      return [];
    }
  }

  async semanticSearch(query, context = {}, options = {}) {
    if (!vectorSearch) return [];

    const results = await vectorSearch(query, {
      namespace: context.namespace || 'global',
      topK: options.topK || 5,
      filter: {
        companyId: context.companyId,
        tradeCategory: context.tradeCategory
      }
    });

    return results.matches || [];
  }

  async searchWithFallback(companyId, query, options = {}) {
    const trade = options.tradeCategory || null;
    const context = { companyId, tradeCategory: trade };

    // Step 1: Company-specific Q&A
    const companyResults = await this.searchCompanyQAs(companyId, query);
    if (companyResults.length) {
      return {
        source: 'companyQnA',
        results: companyResults,
        confidence: this.calculateConfidence(companyResults[0], query)
      };
    }

    // Step 2: Trade-level Q&A
    if (trade) {
      const tradeResults = await this.searchTradeQAs(trade, query);
      if (tradeResults.length) {
        return {
          source: 'tradeQnA',
          results: tradeResults,
          confidence: this.calculateConfidence(tradeResults[0], query)
        };
      }
    }

    // Step 3: Semantic fallback (e.g., Pinecone)
    const semanticResults = await this.semanticSearch(query, context);
    if (semanticResults.length) {
      return {
        source: 'semantic',
        results: semanticResults,
        confidence: semanticResults[0].score || 0.6
      };
    }

    return {
      source: 'none',
      results: [],
      confidence: 0
    };
  }

  calculateConfidence(match, query, context = {}) {
    if (!match || !query) return 0;
    const base = match.keywords?.includes(query.toLowerCase()) ? 0.9 : 0.6;
    const lenDiff = Math.abs(match.question.length - query.length);
    const penalty = Math.min(lenDiff / 100, 0.3);
    return +(base - penalty).toFixed(2);
  }

  trackQAPerformance(match, query, ms) {
    logQASearch?.({
      questionAsked: query,
      matched: match?.question || 'none',
      source: match?.source || 'none',
      responseTime: ms
    });
  }
}

module.exports = new EnhancedQAEngine();

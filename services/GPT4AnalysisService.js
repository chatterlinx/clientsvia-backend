/**
 * GPT-4 Analysis Service
 * 
 * Handles all GPT-4 API interactions for call intelligence analysis.
 * Isolated service for easy toggling and cost management.
 * 
 * @module services/GPT4AnalysisService
 */

const OpenAI = require('openai');
const { SYSTEM_PROMPT, generateUserPrompt, generateQuickPrompt } = require('../utils/intelligencePrompts');

class GPT4AnalysisService {
  constructor() {
    this.client = null;
    this.isEnabled = false;
    this.modelVersion = 'gpt-4o';
    this.maxTokens = 4000;
    this.temperature = 0.3;
    
    this.initialize();
  }

  /**
   * Initialize OpenAI client
   * @private
   */
  initialize() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  GPT-4 Analysis: OPENAI_API_KEY not found - service disabled');
      this.isEnabled = false;
      return;
    }

    try {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      this.isEnabled = true;
      console.log('✅ GPT-4 Analysis Service: Initialized');
    } catch (error) {
      console.error('❌ GPT-4 Analysis Service: Failed to initialize:', error.message);
      this.isEnabled = false;
    }
  }

  /**
   * Check if GPT-4 analysis is enabled
   * @returns {boolean}
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      modelVersion: this.modelVersion,
      hasApiKey: !!process.env.OPENAI_API_KEY
    };
  }

  /**
   * Enable GPT-4 analysis
   */
  enable() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Cannot enable GPT-4: OPENAI_API_KEY not configured');
    }
    this.initialize();
  }

  /**
   * Disable GPT-4 analysis
   */
  disable() {
    this.isEnabled = false;
    console.log('🔴 GPT-4 Analysis Service: Disabled');
  }

  /**
   * Analyze call trace with GPT-4
   * @param {Object} callTrace - Full call trace data
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeCall(callTrace, options = {}) {
    if (!this.isEnabled) {
      throw new Error('GPT-4 Analysis is disabled');
    }

    const mode = options.mode || 'full';
    const startTime = Date.now();

    try {
      const userPrompt = mode === 'quick' 
        ? generateQuickPrompt(callTrace)
        : generateUserPrompt(callTrace);

      const completion = await this.client.chat.completions.create({
        model: this.modelVersion,
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: { type: 'json_object' }
      });

      const processingTime = Date.now() - startTime;
      const responseText = completion.choices[0].message.content;
      
      let analysis;
      try {
        analysis = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ GPT-4 returned invalid JSON:', parseError.message);
        throw new Error('GPT-4 returned invalid JSON response');
      }

      return {
        ...analysis,
        gpt4Metadata: {
          enabled: true,
          tokensUsed: completion.usage.total_tokens,
          processingTime,
          modelVersion: this.modelVersion,
          mode
        }
      };

    } catch (error) {
      console.error('❌ GPT-4 Analysis failed:', error.message);
      
      if (error.code === 'insufficient_quota') {
        this.disable();
        throw new Error('GPT-4 quota exceeded - service disabled');
      }
      
      throw error;
    }
  }

  /**
   * Batch analyze multiple calls
   * @param {Array<Object>} callTraces - Array of call traces
   * @param {Object} options - Analysis options
   * @returns {Promise<Array<Object>>} Analysis results
   */
  async batchAnalyze(callTraces, options = {}) {
    if (!this.isEnabled) {
      throw new Error('GPT-4 Analysis is disabled');
    }

    const maxConcurrent = options.maxConcurrent || 3;
    const results = [];

    for (let i = 0; i < callTraces.length; i += maxConcurrent) {
      const batch = callTraces.slice(i, i + maxConcurrent);
      const batchResults = await Promise.allSettled(
        batch.map(trace => this.analyzeCall(trace, options))
      );
      
      results.push(...batchResults.map((result, idx) => ({
        callSid: batch[idx].callSid,
        success: result.status === 'fulfilled',
        data: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason.message : null
      })));
    }

    return results;
  }

  /**
   * Estimate cost for analysis
   * @param {number} callCount - Number of calls to analyze
   * @param {string} mode - Analysis mode ('quick' or 'full')
   * @returns {Object} Cost estimate
   */
  estimateCost(callCount, mode = 'full') {
    const avgTokensPerCall = mode === 'quick' ? 1500 : 3500;
    // gpt-4o pricing: $2.50/1M input, $10/1M output — blended ~$5/1M
    const costPerMillionTokens = 5;

    const totalTokens = callCount * avgTokensPerCall;
    const estimatedCost = (totalTokens / 1000000) * costPerMillionTokens;

    return {
      callCount,
      mode,
      avgTokensPerCall,
      totalTokens,
      estimatedCostUSD: estimatedCost.toFixed(2),
      costPerCall: (estimatedCost / callCount).toFixed(4)
    };
  }
}

module.exports = new GPT4AnalysisService();

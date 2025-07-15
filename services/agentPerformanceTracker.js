// Agent Performance Intelligence System
// Tracks real-time agent performance and provides improvement insights

const { getDB } = require('../db');

class AgentPerformanceTracker {
  constructor() {
    this.performanceCache = new Map();
    this.conversationSessions = new Map();
  }

  // Track a single agent response with detailed metrics
  async trackAgentResponse(data) {
    const {
      companyId,
      callSid,
      question,
      responseMethod, // 'script', 'qa-direct', 'qa-intelligent', 'llm-fallback'
      responseTime,
      responseText,
      confidence,
      debugInfo = {}
    } = data;

    const timestamp = new Date();
    const responseId = `${callSid}_${Date.now()}`;

    const performanceRecord = {
      _id: responseId,
      companyId,
      callSid,
      timestamp,
      question: question.substring(0, 500), // Limit length
      responseMethod,
      responseTime,
      responseText: responseText.substring(0, 1000),
      confidence,
      questionLength: question.length,
      responseLength: responseText.length,
      debugInfo,
      // Agent intelligence metrics
      scriptMatchScore: debugInfo.scriptMatchScore || 0,
      qaMatchScore: debugInfo.qaMatchScore || 0,
      intelligenceLevel: this.calculateIntelligenceLevel(responseMethod, confidence, debugInfo)
    };

    try {
      const db = getDB();
      await db.collection('agentPerformance').insertOne(performanceRecord);
      
      // Update real-time cache
      this.updatePerformanceCache(companyId, performanceRecord);
      
      console.log(`[Performance] Tracked response: ${responseMethod} (${responseTime}ms) for company ${companyId}`);
      return responseId;
    } catch (error) {
      console.error('[Performance] Error tracking response:', error.message);
      return null;
    }
  }

  // Calculate agent intelligence level based on response quality
  calculateIntelligenceLevel(responseMethod, confidence, debugInfo) {
    let intelligenceScore = 0;

    // Base score by response method (script is most intelligent)
    switch (responseMethod) {
      case 'script': intelligenceScore += 90; break;
      case 'qa-intelligent': intelligenceScore += 80; break;
      case 'qa-direct': intelligenceScore += 70; break;
      case 'llm-fallback': intelligenceScore += 50; break;
      default: intelligenceScore += 30;
    }

    // Adjust for confidence
    intelligenceScore += (confidence || 0) * 20;

    // Adjust for script match quality
    if (debugInfo.scriptMatchScore) {
      intelligenceScore += debugInfo.scriptMatchScore * 10;
    }

    return Math.min(100, Math.max(0, intelligenceScore));
  }

  // Update real-time performance cache
  updatePerformanceCache(companyId, record) {
    if (!this.performanceCache.has(companyId)) {
      this.performanceCache.set(companyId, {
        totalResponses: 0,
        methodCounts: {},
        avgResponseTime: 0,
        avgIntelligence: 0,
        recentResponses: []
      });
    }

    const cache = this.performanceCache.get(companyId);
    cache.totalResponses++;
    cache.methodCounts[record.responseMethod] = (cache.methodCounts[record.responseMethod] || 0) + 1;
    
    // Update averages
    cache.avgResponseTime = ((cache.avgResponseTime * (cache.totalResponses - 1)) + record.responseTime) / cache.totalResponses;
    cache.avgIntelligence = ((cache.avgIntelligence * (cache.totalResponses - 1)) + record.intelligenceLevel) / cache.totalResponses;
    
    // Keep recent responses for analysis
    cache.recentResponses.unshift(record);
    if (cache.recentResponses.length > 100) {
      cache.recentResponses.pop();
    }

    this.performanceCache.set(companyId, cache);
  }

  // Get real-time performance metrics for a company
  async getPerformanceMetrics(companyId, timeRange = '24h') {
    try {
      const db = getDB();
      const startTime = this.getTimeRangeStart(timeRange);
      
      const pipeline = [
        {
          $match: {
            companyId,
            timestamp: { $gte: startTime }
          }
        },
        {
          $group: {
            _id: null,
            totalResponses: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            avgIntelligence: { $avg: '$intelligenceLevel' },
            avgConfidence: { $avg: '$confidence' },
            methodCounts: {
              $push: '$responseMethod'
            },
            fastResponses: {
              $sum: { $cond: [{ $lt: ['$responseTime', 1000] }, 1, 0] }
            },
            slowResponses: {
              $sum: { $cond: [{ $gt: ['$responseTime', 3000] }, 1, 0] }
            }
          }
        }
      ];

      const [metrics] = await db.collection('agentPerformance').aggregate(pipeline).toArray();
      
      if (!metrics) {
        return this.getDefaultMetrics();
      }

      // Process method counts
      const methodStats = {};
      metrics.methodCounts.forEach(method => {
        methodStats[method] = (methodStats[method] || 0) + 1;
      });

      return {
        totalResponses: metrics.totalResponses,
        avgResponseTime: Math.round(metrics.avgResponseTime),
        avgIntelligence: Math.round(metrics.avgIntelligence),
        avgConfidence: Math.round((metrics.avgConfidence || 0) * 100),
        methodDistribution: methodStats,
        performanceGrade: this.calculatePerformanceGrade(metrics),
        speedMetrics: {
          fastResponses: metrics.fastResponses,
          slowResponses: metrics.slowResponses,
          speedScore: Math.round((metrics.fastResponses / metrics.totalResponses) * 100)
        },
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('[Performance] Error getting metrics:', error.message);
      return this.getDefaultMetrics();
    }
  }

  // Generate intelligent improvement suggestions
  async getImprovementSuggestions(companyId) {
    const metrics = await this.getPerformanceMetrics(companyId);
    const suggestions = [];

    // Script usage analysis
    const scriptUsage = (metrics.methodDistribution.script || 0) / metrics.totalResponses;
    if (scriptUsage < 0.6) {
      suggestions.push({
        type: 'script_improvement',
        priority: 'high',
        title: 'Improve Script Coverage',
        description: `Only ${Math.round(scriptUsage * 100)}% of responses use your main script. Consider expanding your script to cover more scenarios.`,
        action: 'Review common questions that fall back to LLM and add them to your script.',
        impact: 'Could improve response consistency by 25%'
      });
    }

    // LLM fallback analysis
    const llmFallback = (metrics.methodDistribution['llm-fallback'] || 0) / metrics.totalResponses;
    if (llmFallback > 0.3) {
      suggestions.push({
        type: 'qa_enhancement',
        priority: 'medium',
        title: 'Reduce LLM Dependency',
        description: `${Math.round(llmFallback * 100)}% of responses fall back to LLM. This indicates gaps in your Q&A knowledge base.`,
        action: 'Add more Q&A entries for common customer questions.',
        impact: 'Could reduce response time by 200ms average'
      });
    }

    // Response time analysis
    if (metrics.avgResponseTime > 2000) {
      suggestions.push({
        type: 'performance_optimization',
        priority: 'high',
        title: 'Optimize Response Speed',
        description: `Average response time is ${metrics.avgResponseTime}ms. Customers expect sub-2-second responses.`,
        action: 'Consider optimizing your script length and Q&A complexity.',
        impact: 'Could improve customer satisfaction by 15%'
      });
    }

    // Intelligence level analysis
    if (metrics.avgIntelligence < 75) {
      suggestions.push({
        type: 'intelligence_boost',
        priority: 'medium',
        title: 'Enhance Agent Intelligence',
        description: `Agent intelligence score is ${metrics.avgIntelligence}/100. There's room for smarter responses.`,
        action: 'Add more specific scenario protocols and improve Q&A matching.',
        impact: 'Could increase conversion rate by 20%'
      });
    }

    return suggestions;
  }

  // Calculate overall performance grade
  calculatePerformanceGrade(metrics) {
    let score = 0;
    
    // Intelligence weight: 40%
    score += (metrics.avgIntelligence / 100) * 40;
    
    // Speed weight: 30%
    const speedScore = Math.max(0, Math.min(100, (3000 - metrics.avgResponseTime) / 20));
    score += (speedScore / 100) * 30;
    
    // Confidence weight: 30%
    score += ((metrics.avgConfidence || 50) / 100) * 30;

    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'B+';
    if (score >= 75) return 'B';
    if (score >= 70) return 'C+';
    if (score >= 65) return 'C';
    return 'D';
  }

  // Get conversation flow analysis
  async getConversationFlow(companyId, callSid) {
    try {
      const db = getDB();
      const responses = await db.collection('agentPerformance')
        .find({ companyId, callSid })
        .sort({ timestamp: 1 })
        .toArray();

      return {
        totalTurns: responses.length,
        avgTurnTime: responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length,
        methodFlow: responses.map(r => r.responseMethod),
        intelligenceFlow: responses.map(r => r.intelligenceLevel),
        conversationHealth: this.analyzeConversationHealth(responses)
      };
    } catch (error) {
      console.error('[Performance] Error getting conversation flow:', error.message);
      return null;
    }
  }

  // Helper methods
  getTimeRangeStart(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case '1h': return new Date(now - 60 * 60 * 1000);
      case '24h': return new Date(now - 24 * 60 * 60 * 1000);
      case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000);
      case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000);
      default: return new Date(now - 24 * 60 * 60 * 1000);
    }
  }

  getDefaultMetrics() {
    return {
      totalResponses: 0,
      avgResponseTime: 0,
      avgIntelligence: 0,
      avgConfidence: 0,
      methodDistribution: {},
      performanceGrade: 'N/A',
      speedMetrics: { fastResponses: 0, slowResponses: 0, speedScore: 0 },
      lastUpdated: new Date()
    };
  }

  analyzeConversationHealth(responses) {
    if (!responses.length) return 'unknown';
    
    const avgIntelligence = responses.reduce((sum, r) => sum + r.intelligenceLevel, 0) / responses.length;
    const hasEscalation = responses.some(r => r.responseMethod === 'escalation');
    
    if (hasEscalation) return 'escalated';
    if (avgIntelligence > 85) return 'excellent';
    if (avgIntelligence > 70) return 'good';
    if (avgIntelligence > 50) return 'fair';
    return 'poor';
  }
}

module.exports = new AgentPerformanceTracker();

// services/learningEngine.js
// AI Agent Logic - Q&A Learning Engine
// Spartan Coder - Enterprise Quantum Learning System
// STRICTLY CONFINED TO AI AGENT LOGIC TAB

const PendingQnA = require('../models/PendingQnA');
const mongoose = require('mongoose');

class LearningEngine {
  constructor() {
    this.learningCache = new Map(); // In-memory cache for frequent operations
    this.similarityThreshold = 0.8; // Semantic similarity threshold
    this.maxCacheSize = 1000; // Prevent memory leaks
  }

  /**
   * Enhanced Q&A submission with semantic analysis and duplicate detection
   * @param {Object} opts - learning options with enterprise validation
   */
  async submitPendingQnA({
    companyId,
    question,
    proposedAnswer = '',
    agentSessionId = '',
    traceId = '',
    source = 'ai_agent',
    confidence = 0,
    intent = '',
    metadata = {}
  }) {
    try {
      // Bulletproof input validation
      if (!question || !companyId) {
        console.warn('[LEARNING-ENGINE] Invalid input: missing question or companyId');
        return { success: false, error: 'Missing required fields' };
      }

      // Sanitize and validate inputs
      const sanitizedQuestion = question.trim().substring(0, 2000);
      const sanitizedAnswer = proposedAnswer.trim().substring(0, 5000);

      if (sanitizedQuestion.length < 5) {
        return { success: false, error: 'Question too short (minimum 5 characters)' };
      }

      console.log(`[LEARNING-ENGINE] Processing Q&A for company ${companyId}: "${sanitizedQuestion.substring(0, 50)}..."`);

      // Check for existing similar questions using our enhanced model
      const similarQuestions = await PendingQnA.findSimilarQuestions(
        companyId, 
        sanitizedQuestion, 
        this.similarityThreshold
      );

      // If we find a very similar question, increment its frequency
      if (similarQuestions.length > 0) {
        const existingQnA = similarQuestions[0];
        console.log(`[LEARNING-ENGINE] Found similar question, incrementing frequency (current: ${existingQnA.frequency})`);
        
        // Update with new context if provided
        if (confidence > existingQnA.aiAgentContext?.confidence) {
          existingQnA.aiAgentContext.confidence = confidence;
        }
        
        await existingQnA.incrementFrequency();
        
        // Update cache
        this.updateCache(companyId, existingQnA);
        
        return { 
          success: true, 
          qna: existingQnA, 
          action: 'frequency_incremented',
          similarityScore: similarQuestions[0].score 
        };
      }

      // Create new Q&A with enhanced AI Agent context
      const newQnA = new PendingQnA({
        companyId: new mongoose.Types.ObjectId(companyId),
        question: sanitizedQuestion,
        proposedAnswer: sanitizedAnswer,
        aiAgentContext: {
          traceId: traceId || `qna_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId: agentSessionId,
          source: source,
          confidence: confidence,
          intent: intent
        },
        frequency: 1,
        tags: this.extractTags(sanitizedQuestion),
        metadata: {
          ...metadata,
          submittedAt: new Date(),
          userAgent: 'ai_agent_learning_engine'
        }
      });

      const savedQnA = await newQnA.save();
      
      // Update cache
      this.updateCache(companyId, savedQnA);
      
      console.log(`[LEARNING-ENGINE] ✅ New Q&A created with ID: ${savedQnA._id}`);
      
      return { 
        success: true, 
        qna: savedQnA, 
        action: 'created_new',
        priority: savedQnA.priority
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Submission failed:', error);
      return { 
        success: false, 
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
  }

  /**
   * Enhanced pending Q&A retrieval with advanced filtering and analytics
   */
  async getPendingQnAs(companyId, options = {}) {
    try {
      const {
        status = 'pending',
        priority = null,
        limit = 50,
        offset = 0,
        sortBy = 'frequency',
        sortOrder = 'desc',
        search = '',
        minFrequency = 1
      } = options;

      console.log(`[LEARNING-ENGINE] Retrieving Q&As for company ${companyId} with filters:`, options);

      // Build query with advanced filtering
      const query = { 
        companyId: new mongoose.Types.ObjectId(companyId),
        frequency: { $gte: minFrequency }
      };

      if (status !== 'all') {
        query.status = status;
      }

      if (priority) {
        query.priority = priority;
      }

      // Add search functionality
      if (search && search.trim()) {
        query.$text = { $search: search.trim() };
      }

      // Build sort object
      const sortObj = {};
      sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

      // Execute query with analytics
      const [qnas, total, stats] = await Promise.all([
        PendingQnA.find(query)
          .sort(sortObj)
          .skip(offset)
          .limit(Math.min(limit, 100)) // Cap at 100 for performance
          .populate('companyId', 'name')
          .lean(),
        PendingQnA.countDocuments(query),
        PendingQnA.getStatsForCompany(companyId)
      ]);

      console.log(`[LEARNING-ENGINE] ✅ Retrieved ${qnas.length} Q&As (${total} total)`);

      return {
        success: true,
        qnas: qnas,
        pagination: {
          total,
          limit,
          offset,
          hasMore: (offset + limit) < total
        },
        stats,
        filters: options
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Retrieval failed:', error);
      return { 
        success: false, 
        error: error.message,
        qnas: [],
        pagination: { total: 0, limit, offset, hasMore: false }
      };
    }
  }

  /**
   * Enhanced approval with integration hooks and notifications
   */
  async approvePendingQnA(qnaId, reviewedBy = 'system', notes = '') {
    try {
      console.log(`[LEARNING-ENGINE] Approving Q&A ${qnaId} by ${reviewedBy}`);

      const qna = await PendingQnA.findById(qnaId);
      if (!qna) {
        return { success: false, error: 'Q&A not found' };
      }

      // Use the model's built-in approve method
      await qna.approve(reviewedBy);
      
      if (notes) {
        qna.notes = notes;
        await qna.save();
      }

      // Clear from cache
      this.clearCacheEntry(qna.companyId, qnaId);

      console.log(`[LEARNING-ENGINE] ✅ Q&A approved successfully`);

      // TODO: Integration point for moving to permanent knowledge base
      // await this.moveToKnowledgeBase(qna);

      return { 
        success: true, 
        qna: qna,
        action: 'approved',
        nextStep: 'manual_integration_to_knowledge_base'
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Approval failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Enhanced rejection with reason tracking and analytics
   */
  async rejectPendingQnA(qnaId, reviewedBy = 'system', reason = '') {
    try {
      console.log(`[LEARNING-ENGINE] Rejecting Q&A ${qnaId} by ${reviewedBy}`);

      const qna = await PendingQnA.findById(qnaId);
      if (!qna) {
        return { success: false, error: 'Q&A not found' };
      }

      // Use the model's built-in reject method
      await qna.reject(reviewedBy, reason);

      // Clear from cache
      this.clearCacheEntry(qna.companyId, qnaId);

      console.log(`[LEARNING-ENGINE] ✅ Q&A rejected successfully`);

      return { 
        success: true, 
        qna: qna,
        action: 'rejected',
        reason: reason
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Rejection failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Bulk operations for efficiency
   */
  async bulkApproveQnAs(qnaIds, reviewedBy = 'system') {
    try {
      console.log(`[LEARNING-ENGINE] Bulk approving ${qnaIds.length} Q&As`);

      const results = await Promise.allSettled(
        qnaIds.map(id => this.approvePendingQnA(id, reviewedBy))
      );

      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failed = results.length - successful;

      console.log(`[LEARNING-ENGINE] ✅ Bulk approval: ${successful} successful, ${failed} failed`);

      return {
        success: true,
        results: {
          total: qnaIds.length,
          successful,
          failed,
          details: results
        }
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Bulk approval failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Analytics and insights for AI Agent Logic tab
   */
  async getAnalytics(companyId, timeframe = '30d') {
    try {
      const timeframes = {
        '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
        '7d': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        '90d': new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      };

      const since = timeframes[timeframe] || timeframes['30d'];

      const [stats, topQuestions, recentActivity] = await Promise.all([
        PendingQnA.getStatsForCompany(companyId, since),
        this.getTopQuestions(companyId, since),
        this.getRecentActivity(companyId, since)
      ]);

      return {
        success: true,
        timeframe,
        stats,
        topQuestions,
        recentActivity,
        insights: this.generateInsights(stats, topQuestions)
      };

    } catch (error) {
      console.error('[LEARNING-ENGINE] ❌ Analytics failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cache management for performance
   */
  updateCache(companyId, qna) {
    const key = `${companyId}:${qna._id}`;
    
    // Prevent cache overflow
    if (this.learningCache.size >= this.maxCacheSize) {
      const firstKey = this.learningCache.keys().next().value;
      this.learningCache.delete(firstKey);
    }
    
    this.learningCache.set(key, {
      qna: qna,
      lastAccessed: Date.now()
    });
  }

  clearCacheEntry(companyId, qnaId) {
    const key = `${companyId}:${qnaId}`;
    this.learningCache.delete(key);
  }

  /**
   * Extract relevant tags from question content
   */
  extractTags(question) {
    const commonWords = ['what', 'how', 'when', 'where', 'why', 'who', 'can', 'do', 'is', 'are', 'the', 'a', 'an'];
    const words = question.toLowerCase().split(/\s+/)
      .map(word => word.replace(/[^\w]/g, ''))
      .filter(word => word.length > 3 && !commonWords.includes(word));
    
    return [...new Set(words)].slice(0, 5); // Max 5 unique tags
  }

  /**
   * Get top questions by frequency
   */
  async getTopQuestions(companyId, since) {
    return PendingQnA.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      createdAt: { $gte: since }
    })
    .sort({ frequency: -1, lastAsked: -1 })
    .limit(10)
    .select('question frequency lastAsked status priority')
    .lean();
  }

  /**
   * Get recent activity for timeline view
   */
  async getRecentActivity(companyId, since) {
    return PendingQnA.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      updatedAt: { $gte: since }
    })
    .sort({ updatedAt: -1 })
    .limit(20)
    .select('question status updatedAt reviewedBy frequency')
    .lean();
  }

  /**
   * Generate AI insights from analytics data
   */
  generateInsights(stats, topQuestions) {
    const insights = [];

    if (stats.totalPending > 10) {
      insights.push({
        type: 'attention',
        message: `${stats.totalPending} questions are pending review`,
        action: 'Review and approve frequently asked questions'
      });
    }

    if (stats.approvalRate < 50) {
      insights.push({
        type: 'warning',
        message: `Low approval rate (${stats.approvalRate}%)`,
        action: 'Review rejection reasons and adjust learning criteria'
      });
    }

    if (topQuestions.length > 0 && topQuestions[0].frequency > 5) {
      insights.push({
        type: 'success',
        message: `Top question asked ${topQuestions[0].frequency} times`,
        action: 'Consider prioritizing this for knowledge base'
      });
    }

    return insights;
  }

  /**
   * Health check for monitoring
   */
  async getHealthStatus() {
    try {
      const cacheSize = this.learningCache.size;
      const dbConnection = mongoose.connection.readyState === 1;
      
      return {
        status: 'healthy',
        cache: {
          size: cacheSize,
          maxSize: this.maxCacheSize,
          utilizationPercent: Math.round((cacheSize / this.maxCacheSize) * 100)
        },
        database: {
          connected: dbConnection
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
module.exports = new LearningEngine();

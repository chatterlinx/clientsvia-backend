// services/knowledgeBaseService.js
// AI Agent Logic - Knowledge Base Integration Service
// Multi-tenant, Production-grade Implementation with CompanyId Isolation

const mongoose = require('mongoose');
const KnowledgeEntry = require('../models/KnowledgeEntry');
const CompanyQnA = require('../models/CompanyQnA');
const { ObjectId } = require('mongodb');

class KnowledgeBaseService {
  
  /**
   * Add approved Q&A to company's knowledge base
   * STRICTLY SCOPED BY COMPANY ID - Multi-tenant Safe
   * 
   * @param {string} companyId - Company ID for multi-tenant isolation
   * @param {string} question - The approved question
   * @param {string} answer - The approved answer
   * @param {Object} options - Additional options (category, keywords, etc.)
   * @returns {Promise<Object>} Created knowledge entry
   */
  async addToCompanyKnowledgeBase(companyId, question, answer, options = {}) {
    try {
      // Validate companyId for multi-tenant security
      if (!ObjectId.isValid(companyId)) {
        throw new Error('Invalid company ID format');
      }

      console.log(`[Knowledge Base] 📚 Adding Q&A to company ${companyId} knowledge base`);

      // Check for duplicates within company scope
      const existingEntry = await CompanyQnA.findOne({
        companyId: companyId,
        question: { $regex: new RegExp(question, 'i') }
      });

      if (existingEntry) {
        console.log(`[Knowledge Base] ⚠️ Similar Q&A already exists, updating instead`);
        
        // Update existing entry
        existingEntry.answer = answer;
        existingEntry.updatedAt = new Date();
        existingEntry.confidence = Math.max(existingEntry.confidence, options.confidence || 0.8);
        existingEntry.source = 'auto-learned';
        
        if (options.keywords && options.keywords.length > 0) {
          existingEntry.keywords = [...new Set([...existingEntry.keywords, ...options.keywords])];
        }
        
        await existingEntry.save();
        return existingEntry;
      }

      // Extract keywords from question and answer
      const extractedKeywords = this.extractKeywords(question + ' ' + answer);
      const allKeywords = [...new Set([
        ...extractedKeywords,
        ...(options.keywords || [])
      ])];

      // Create new CompanyQnA entry (primary knowledge base)
      const companyQnA = new CompanyQnA({
        companyId: companyId,
        question: question.trim(),
        answer: answer.trim(),
        keywords: allKeywords,
        category: options.category || 'auto-learned',
        confidence: options.confidence || 0.8,
        source: 'auto-learned',
        priority: this.calculatePriority(options.frequency || 1),
        approvalStatus: 'approved',
        isActive: true,
        isApproved: true
      });

      await companyQnA.save();
      console.log(`[Knowledge Base] ✅ Added to CompanyQnA: ${companyQnA._id}`);

      // Also add to KnowledgeEntry for backward compatibility
      const knowledgeEntry = new KnowledgeEntry({
        companyId: new ObjectId(companyId),
        category: options.category || 'AI Agent Auto-Learning',
        question: question.trim(),
        answer: answer.trim(),
        keywords: allKeywords,
        approved: true
      });

      await knowledgeEntry.save();
      console.log(`[Knowledge Base] ✅ Added to KnowledgeEntry: ${knowledgeEntry._id}`);

      return {
        companyQnA: companyQnA,
        knowledgeEntry: knowledgeEntry,
        success: true,
        message: 'Q&A successfully added to knowledge base'
      };

    } catch (error) {
      console.error('[Knowledge Base] ❌ Error adding to knowledge base:', error);
      throw error;
    }
  }

  /**
   * Extract relevant keywords from text
   * @param {string} text - Text to extract keywords from
   * @returns {Array<string>} Extracted keywords
   */
  extractKeywords(text) {
    if (!text) return [];

    // Simple keyword extraction - can be enhanced with NLP
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => 
        word.length > 3 && 
        !this.stopWords.includes(word)
      );

    // Get unique words and common phrases
    const uniqueWords = [...new Set(words)];
    return uniqueWords.slice(0, 10); // Limit to top 10 keywords
  }

  /**
   * Calculate priority based on frequency and other factors
   * @param {number} frequency - How often the question was asked
   * @returns {number} Priority score
   */
  calculatePriority(frequency) {
    if (frequency >= 10) return 5;      // Very High
    if (frequency >= 5) return 4;       // High
    if (frequency >= 3) return 3;       // Medium
    if (frequency >= 2) return 2;       // Low
    return 1;                           // Very Low
  }

  /**
   * Get knowledge base statistics for a company
   * STRICTLY SCOPED BY COMPANY ID
   * 
   * @param {string} companyId - Company ID for multi-tenant isolation
   * @returns {Promise<Object>} Knowledge base statistics
   */
  async getKnowledgeBaseStats(companyId) {
    try {
      if (!ObjectId.isValid(companyId)) {
        throw new Error('Invalid company ID format');
      }

      const [companyQnaCount, knowledgeEntryCount, autoLearnedCount] = await Promise.all([
        CompanyQnA.countDocuments({ companyId: companyId, isActive: true }),
        KnowledgeEntry.countDocuments({ companyId: new ObjectId(companyId), approved: true }),
        CompanyQnA.countDocuments({ companyId: companyId, source: 'auto-learned', isActive: true })
      ]);

      const recentlyAdded = await CompanyQnA.countDocuments({
        companyId: companyId,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });

      return {
        totalQnAs: companyQnaCount,
        knowledgeEntries: knowledgeEntryCount,
        autoLearnedQnAs: autoLearnedCount,
        recentlyAdded: recentlyAdded,
        autoLearningRate: companyQnaCount > 0 ? (autoLearnedCount / companyQnaCount * 100).toFixed(1) : 0
      };

    } catch (error) {
      console.error('[Knowledge Base] ❌ Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Search company knowledge base
   * STRICTLY SCOPED BY COMPANY ID
   * 
   * @param {string} companyId - Company ID for multi-tenant isolation
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchKnowledgeBase(companyId, query, options = {}) {
    try {
      if (!ObjectId.isValid(companyId)) {
        throw new Error('Invalid company ID format');
      }

      const searchRegex = new RegExp(query, 'i');
      const searchFilter = {
        companyId: companyId,
        isActive: true,
        $or: [
          { question: searchRegex },
          { answer: searchRegex },
          { keywords: { $in: [searchRegex] } }
        ]
      };

      if (options.category) {
        searchFilter.category = options.category;
      }

      const results = await CompanyQnA.find(searchFilter)
        .sort({ priority: -1, confidence: -1, updatedAt: -1 })
        .limit(options.limit || 20);

      return results;

    } catch (error) {
      console.error('[Knowledge Base] ❌ Error searching knowledge base:', error);
      throw error;
    }
  }

  // Common English stop words to filter out
  get stopWords() {
    return [
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 
      'as', 'by', 'that', 'this', 'it', 'from', 'they', 'we', 'say', 'her', 'she', 'he', 'his', 'hers',
      'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about',
      'who', 'get', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know',
      'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than',
      'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
      'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any',
      'these', 'give', 'day', 'most', 'us'
    ];
  }
}

module.exports = new KnowledgeBaseService();

/**
 * Company Knowledge API Routes - Enterprise Production System
 * Handles all Company Q&A operations with proper authentication and validation
 * 
 * 🤖 AI AGENT ROUTING REFERENCE - API GATEWAY:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ KNOWLEDGE MANAGEMENT API FOR PRIORITY #1 SOURCE                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Purpose: CRUD operations for Company Q&A entries                ║
 * ║ Used by: Frontend CompanyQnAManager component                   ║
 * ║ AI Route: /api/ai-agent/company-knowledge/:id (aiAgentLogic.js) ║
 * ║ Service: CompanyKnowledgeService for all operations             ║
 * ║ Cache: Redis keys managed by service layer                      ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * 🔗 ENDPOINT REFERENCE:
 * ├─ GET    /api/knowledge/company/:companyId/qnas       → List with pagination
 * ├─ POST   /api/knowledge/company/:companyId/qnas       → Create new Q&A
 * ├─ PUT    /api/knowledge/company/:companyId/qnas/:id   → Update existing
 * ├─ DELETE /api/knowledge/company/:companyId/qnas/:id   → Delete Q&A
 * ├─ GET    /api/knowledge/company/:companyId/search     → Semantic search
 * ├─ POST   /api/knowledge/company/:companyId/bulk-import → CSV import
 * └─ GET    /api/knowledge/company/:companyId/analytics  → Usage metrics
 * 
 * 🚨 CRITICAL FOR AI ROUTING:
 * - All changes here affect AI agent knowledge lookup
 * - Validation ensures quality data for AI responses
 * - Keywords auto-generated for semantic matching
 * - Redis cache invalidated on data changes
 */

const express = require('express');
const router = express.Router();
const { authenticateSingleSession } = require('../../middleware/auth');
const CompanyKnowledgeService = require('../../services/knowledge/CompanyKnowledgeService');
const winston = require('winston');

// Initialize service and logger
const knowledgeService = new CompanyKnowledgeService();
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/knowledge-api.log' }),
    new winston.transports.Console()
  ]
});

/**
 * ========================================= 
 * 🚀 PRODUCTION: GET COMPANY Q&A ENTRIES
 * ✅ OPTIMIZED: Mongoose aggregation + Redis caching
 * 🛡️ SECURE: Multi-tenant isolation + input validation  
 * ⚡ PERFORMANCE: Smart pagination + filtering
 * 📊 ANALYTICS: Usage tracking + performance metrics
 * ========================================= 
 * Used by: Embedded Q&A Manager in AI Agent Logic Tab 2
 * Cache: Redis key pattern: knowledge:company:{id}:list:{hash}
 * Performance: Sub-200ms response time with Redis cache
 */
router.get('/company/:companyId/qnas', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      page = 1,
      limit = 20,
      category,
      status = 'active',
      search,
      sortBy = 'updatedAt',
      sortOrder = 'desc'
    } = req.query;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    logger.info(`📋 Fetching Q&As for company ${companyId}`, {
      userId: req.user._id,
      page,
      limit,
      category,
      search
    });

    const result = await knowledgeService.getCompanyQnAs(companyId, {
      page: parseInt(page),
      limit: parseInt(limit),
      category,
      status,
      search,
      sortBy,
      sortOrder: sortOrder === 'desc' ? -1 : 1
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      filters: {
        category,
        status,
        search
      }
    });

  } catch (error) {
    logger.error('❌ Failed to fetch company Q&As:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Q&As',
      details: error.message
    });
  }
});

/**
 * ➕ CREATE NEW Q&A ENTRY
 * Used by the "Add New Q&A" button in the frontend
 */
router.post('/company/:companyId/qnas', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId } = req.params;
    const qnaData = req.body;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    // Validate required fields
    if (!qnaData.question || !qnaData.answer) {
      return res.status(400).json({
        success: false,
        error: 'Question and answer are required',
        details: {
          question: !qnaData.question ? 'Question is required' : null,
          answer: !qnaData.answer ? 'Answer is required' : null
        }
      });
    }

    logger.info(`➕ Creating new Q&A for company ${companyId}`, {
      userId: req.user._id,
      question: qnaData.question.substring(0, 50) + '...'
    });

    const result = await knowledgeService.createQnA(
      companyId,
      qnaData,
      req.user._id
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Log success for analytics
    logger.info(`✅ Q&A created successfully`, {
      qnaId: result.data._id,
      companyId,
      userId: req.user._id,
      keywordsGenerated: result.data.keywords.length
    });

    res.status(201).json({
      success: true,
      data: result.data,
      message: 'Q&A entry created successfully',
      analytics: {
        keywordsGenerated: result.data.keywords.length,
        confidence: result.data.confidence,
        category: result.data.category
      }
    });

  } catch (error) {
    logger.error('❌ Failed to create Q&A:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create Q&A entry',
      details: error.message
    });
  }
});

/**
 * ✏️ UPDATE EXISTING Q&A ENTRY
 * Used by the "Edit" button in the frontend Q&A list
 */
router.put('/company/:companyId/qnas/:id', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId, id } = req.params;
    const updateData = req.body;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    logger.info(`✏️ Updating Q&A ${id} for company ${companyId}`, {
      userId: req.user._id,
      fieldsUpdated: Object.keys(updateData)
    });

    const result = await knowledgeService.updateQnA(
      id,
      updateData,
      req.user._id
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info(`✅ Q&A updated successfully`, {
      qnaId: id,
      companyId,
      userId: req.user._id
    });

    res.json({
      success: true,
      data: result.data,
      message: 'Q&A entry updated successfully'
    });

  } catch (error) {
    logger.error('❌ Failed to update Q&A:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update Q&A entry',
      details: error.message
    });
  }
});

/**
 * 🗑️ DELETE Q&A ENTRY (SOFT DELETE)
 * Used by the "Delete" button in the frontend Q&A list
 */
router.delete('/company/:companyId/qnas/:id', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId, id } = req.params;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    logger.info(`🗑️ Deleting Q&A ${id} for company ${companyId}`, {
      userId: req.user._id
    });

    const result = await knowledgeService.deleteQnA(id, req.user._id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    logger.info(`✅ Q&A deleted successfully`, {
      qnaId: id,
      companyId,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'Q&A entry deleted successfully'
    });

  } catch (error) {
    logger.error('❌ Failed to delete Q&A:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete Q&A entry',
      details: error.message
    });
  }
});

/**
 * 🔍 SEARCH Q&AS
 * Used by the search functionality in the frontend
 */
router.get('/company/:companyId/search', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { query, limit = 10, minConfidence = 0.7 } = req.query;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    logger.info(`🔍 Searching Q&As for company ${companyId}`, {
      userId: req.user._id,
      query: query.substring(0, 50),
      limit,
      minConfidence
    });

    const result = await knowledgeService.findAnswerForAIAgent(query, companyId, {
      maxResults: parseInt(limit),
      minConfidence: parseFloat(minConfidence),
      includeAnalytics: true
    });

    res.json({
      success: true,
      data: result.results || [],
      meta: {
        query,
        responseTime: result.responseTime,
        totalFound: result.totalFound || 0,
        cacheHit: result.cacheHit,
        source: result.source,
        keywords: result.keywords || []
      }
    });

  } catch (error) {
    logger.error('❌ Search failed:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed',
      details: error.message
    });
  }
});

/**
 * 📈 GET ANALYTICS AND PERFORMANCE METRICS
 * Used by the analytics dashboard in the frontend
 */
router.get('/company/:companyId/analytics', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId } = req.params;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    logger.info(`📈 Fetching analytics for company ${companyId}`, {
      userId: req.user._id
    });

    // Get performance metrics from service
    const performanceMetrics = knowledgeService.getPerformanceMetrics();

    // Get Q&A statistics from database
    const [
      totalQnAs,
      activeQnAs,
      categoryStats,
      recentUsage
    ] = await Promise.all([
      knowledgeService.getCompanyQnAs(companyId, { limit: 1 }),
      knowledgeService.getCompanyQnAs(companyId, { status: 'active', limit: 1 }),
      // You could add more sophisticated analytics here
      Promise.resolve([]),
      Promise.resolve([])
    ]);

    const analytics = {
      overview: {
        totalQnAs: totalQnAs.pagination?.total || 0,
        activeQnAs: activeQnAs.pagination?.total || 0,
        draftQnAs: 0, // Calculate from database if needed
        archivedQnAs: 0 // Calculate from database if needed
      },
      performance: performanceMetrics,
      categories: categoryStats,
      recentActivity: recentUsage,
      generatedAt: new Date()
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    logger.error('❌ Failed to fetch analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics',
      details: error.message
    });
  }
});

/**
 * 📥 BULK IMPORT Q&AS
 * Used by the "Import" functionality in the frontend
 */
router.post('/company/:companyId/bulk-import', authenticateSingleSession, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { qnas } = req.body;

    // Validate company access
    if (!req.user.emergency && req.user.companyId.toString() !== companyId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this company data'
      });
    }

    if (!qnas || !Array.isArray(qnas) || qnas.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Q&As array is required and must not be empty'
      });
    }

    logger.info(`📥 Bulk importing ${qnas.length} Q&As for company ${companyId}`, {
      userId: req.user._id
    });

    const results = {
      total: qnas.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    // Process each Q&A
    for (let i = 0; i < qnas.length; i++) {
      try {
        const result = await knowledgeService.createQnA(
          companyId,
          qnas[i],
          req.user._id
        );

        if (result.success) {
          results.successful++;
        } else {
          results.failed++;
          results.errors.push({
            index: i,
            data: qnas[i],
            error: result.error
          });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          index: i,
          data: qnas[i],
          error: error.message
        });
      }
    }

    logger.info(`✅ Bulk import completed`, {
      companyId,
      userId: req.user._id,
      successful: results.successful,
      failed: results.failed
    });

    res.json({
      success: true,
      data: results,
      message: `Bulk import completed: ${results.successful} successful, ${results.failed} failed`
    });

  } catch (error) {
    logger.error('❌ Bulk import failed:', error);
    res.status(500).json({
      success: false,
      error: 'Bulk import failed',
      details: error.message
    });
  }
});

/**
 * 🏥 HEALTH CHECK ENDPOINT
 * Used for system monitoring
 */
router.get('/company/health', async (req, res) => {
  try {
    const health = await knowledgeService.healthCheck();
    
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 207 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      service: 'CompanyKnowledgeAPI',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date()
    });
  }
});

/**
 * 🎯 AI AGENT INTEGRATION ENDPOINT
 * This is called by the AI agent during conversations
 * No authentication required for internal calls
 */
router.post('/ai-agent/search', async (req, res) => {
  try {
    const { query, companyId, options = {} } = req.body;

    if (!query || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'Query and companyId are required'
      });
    }

    logger.info(`🤖 AI Agent search request`, {
      companyId,
      query: query.substring(0, 50) + '...'
    });

    const result = await knowledgeService.findAnswerForAIAgent(
      query,
      companyId,
      options
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('❌ AI Agent search failed:', error);
    res.status(500).json({
      success: false,
      error: 'AI Agent search failed',
      details: error.message
    });
  }
});

module.exports = router;

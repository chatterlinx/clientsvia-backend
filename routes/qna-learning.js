// routes/qna-learning.js
// Q&A Learning Queue API Routes
// Spartan Coder - Enterprise Learning System
// STRICTLY CONFINED TO AI AGENT LOGIC TAB

const express = require('express');
const router = express.Router();
const learningEngine = require('../services/learningEngine');
const PendingQnA = require('../models/PendingQnA');
const mongoose = require('mongoose');

/**
 * GET /api/qna-learning/:companyId
 * 🔍 Get pending Q&As with advanced filtering and pagination
 */
router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      status = 'pending',
      priority,
      limit = 50,
      offset = 0,
      sortBy = 'frequency',
      sortOrder = 'desc',
      search,
      minFrequency = 1
    } = req.query;

    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid company ID format'
      });
    }

    console.log(`[Q&A-LEARNING-API] Fetching Q&As for company ${companyId}`);

    // Use the learning engine to get pending Q&As
    const result = await learningEngine.getPendingQnAs(companyId, {
      status,
      priority,
      limit: parseInt(limit),
      offset: parseInt(offset),
      sortBy,
      sortOrder,
      search,
      minFrequency: parseInt(minFrequency)
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to fetch pending Q&As'
      });
    }

    console.log(`[Q&A-LEARNING-API] ✅ Retrieved ${result.qnas.length} Q&As`);

    res.json({
      success: true,
      data: {
        qnas: result.qnas,
        pagination: result.pagination,
        stats: result.stats,
        filters: result.filters
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Q&A-LEARNING-API] Error fetching pending Q&As:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch learning queue',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/qna-learning/approve/:id
 * ✅ Approve Q&A and prepare for knowledge base integration
 */
router.post('/approve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewedBy = 'admin', notes = '', addToKnowledgeBase = true } = req.body;

    // Validate Q&A ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Q&A ID format'
      });
    }

    console.log(`[Q&A-LEARNING-API] Approving Q&A ${id} by ${reviewedBy}`);

    // Check if Q&A exists and is pending
    const qna = await PendingQnA.findById(id);
    if (!qna) {
      return res.status(404).json({
        success: false,
        error: 'Q&A not found'
      });
    }

    if (qna.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Q&A already processed (status: ${qna.status})`
      });
    }

    // Use learning engine to approve
    const result = await learningEngine.approvePendingQnA(id, reviewedBy, notes);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to approve Q&A'
      });
    }

    console.log(`[Q&A-LEARNING-API] ✅ Q&A approved successfully`);

    // TODO: Integration point for CompanyQnA model
    // If addToKnowledgeBase is true, we would create a CompanyQnA entry here
    // This is left as a TODO because CompanyQnA model structure may vary
    
    res.json({
      success: true,
      message: 'Q&A approved successfully',
      data: {
        qna: result.qna,
        action: result.action,
        nextStep: addToKnowledgeBase ? 'ready_for_knowledge_base' : 'approved_only',
        reviewedBy,
        notes
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Q&A-LEARNING-API] Error approving Q&A:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve Q&A',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/qna-learning/reject/:id
 * ❌ Reject Q&A and block from reuse
 */
router.post('/reject/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewedBy = 'admin', reason = '', blockSimilar = false } = req.body;

    // Validate Q&A ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Q&A ID format'
      });
    }

    console.log(`[Q&A-LEARNING-API] Rejecting Q&A ${id} by ${reviewedBy}`);

    // Check if Q&A exists and is pending
    const qna = await PendingQnA.findById(id);
    if (!qna) {
      return res.status(404).json({
        success: false,
        error: 'Q&A not found'
      });
    }

    if (qna.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Q&A already processed (status: ${qna.status})`
      });
    }

    // Use learning engine to reject
    const result = await learningEngine.rejectPendingQnA(id, reviewedBy, reason);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to reject Q&A'
      });
    }

    console.log(`[Q&A-LEARNING-API] ✅ Q&A rejected successfully`);

    // TODO: If blockSimilar is true, we could add logic to prevent similar questions
    // This would involve creating a "blocked patterns" system

    res.json({
      success: true,
      message: 'Q&A rejected successfully',
      data: {
        qna: result.qna,
        action: result.action,
        reason: result.reason,
        reviewedBy,
        blockSimilar
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Q&A-LEARNING-API] Error rejecting Q&A:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reject Q&A',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * POST /api/qna-learning/bulk-approve
 * ✅ Bulk approve multiple Q&As
 */
router.post('/bulk-approve', async (req, res) => {
  try {
    const { ids, reviewedBy = 'admin', notes = '' } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'IDs array is required and must not be empty'
      });
    }

    // Validate all IDs
    const invalidIds = ids.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid Q&A IDs: ${invalidIds.join(', ')}`
      });
    }

    console.log(`[Q&A-LEARNING-API] Bulk approving ${ids.length} Q&As by ${reviewedBy}`);

    // Use learning engine bulk operations
    const result = await learningEngine.bulkApproveQnAs(ids, reviewedBy);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to bulk approve Q&As'
      });
    }

    console.log(`[Q&A-LEARNING-API] ✅ Bulk approval completed: ${result.results.successful} successful, ${result.results.failed} failed`);

    res.json({
      success: true,
      message: `Bulk approval completed: ${result.results.successful} successful, ${result.results.failed} failed`,
      data: result.results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Q&A-LEARNING-API] Error in bulk approval:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk approve Q&As',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/qna-learning/analytics/:companyId
 * 📊 Get learning analytics and insights
 */
router.get('/analytics/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeframe = '30d' } = req.query;

    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid company ID format'
      });
    }

    console.log(`[Q&A-LEARNING-API] Getting analytics for company ${companyId}, timeframe: ${timeframe}`);

    // Use learning engine analytics
    const result = await learningEngine.getAnalytics(companyId, timeframe);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to get analytics'
      });
    }

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Q&A-LEARNING-API] Error getting analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get learning analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/qna-learning/health
 * 🔍 Health check for learning system
 */
router.get('/health', async (req, res) => {
  try {
    const health = await learningEngine.getHealthStatus();
    
    res.json({
      success: true,
      service: 'qna-learning',
      ...health
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      service: 'qna-learning',
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;

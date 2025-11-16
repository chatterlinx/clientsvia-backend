/**
 * ============================================================================
 * ACTIVE INSTRUCTIONS ROUTER - API ENDPOINT
 * ============================================================================
 * 
 * PURPOSE: Expose active instructions for UI/debugging
 * AUTHENTICATION: JWT required (add middleware when wiring to main app)
 * ENDPOINT: GET /api/active-instructions?companyId=...&callId=optional
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { getActiveInstructions } = require('../services/activeInstructionsService');
const logger = require('../../utils/logger');

/**
 * GET /api/active-instructions
 * Query params:
 * - companyId (required): Company ID to fetch instructions for
 * - callId (optional): Specific call ID to include call context
 */
router.get('/', async (req, res) => {
  try {
    const { companyId, callId } = req.query;
    
    // Validate required params
    if (!companyId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: companyId' 
      });
    }
    
    logger.info(`[ACTIVE INSTRUCTIONS API] Request received`, {
      companyId,
      callId: callId || 'none',
      ip: req.ip
    });
    
    // Get active instructions
    const data = await getActiveInstructions({ companyId, callId });
    
    // Return success
    res.json({
      success: true,
      data
    });
    
  } catch (error) {
    logger.error(`[ACTIVE INSTRUCTIONS API] Request failed`, {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch active instructions',
      message: error.message 
    });
  }
});

/**
 * GET /api/active-instructions/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'active-instructions',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;


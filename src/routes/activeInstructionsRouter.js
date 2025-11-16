/**
 * ============================================================================
 * ACTIVE INSTRUCTIONS ROUTER V2 - BRAIN X-RAY API
 * ============================================================================
 * 
 * PURPOSE: Expose active instructions (full brain X-ray) for UI/debugging
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
 * 
 * Response format:
 * {
 *   ok: true,
 *   data: {
 *     company: { id, name, trade },
 *     readiness: { score, canGoLive, isLive, ... },
 *     configVersion: { templateIds, clonedVersion, lastSyncedAt },
 *     intelligence: { enabled, thresholds, knowledgeSourcePriorities, ... },
 *     variables: { definitions: [...], values: {...} },
 *     fillerWords: { inherited: [...], custom: [...], active: [...] },
 *     synonyms: [...],
 *     scenarios: { total, byCategory: {...} },
 *     knowledgebase: { companyQnA: {...}, tradeQnA: {...} },
 *     call: null | { callId, startedAt, endedAt, contextSnapshot, tierTrace, ... }
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const { companyId, callId } = req.query;
    
    // Validate required params
    if (!companyId) {
      logger.warn(`[ACTIVE INSTRUCTIONS API V2] Missing companyId`, {
        query: req.query,
        ip: req.ip
      });
      
      return res.status(400).json({ 
        ok: false,
        error: 'Missing required parameter: companyId' 
      });
    }
    
    logger.info(`[ACTIVE INSTRUCTIONS API V2] Request received`, {
      companyId,
      callId: callId || 'none',
      ip: req.ip
    });
    
    // Get active instructions (full brain X-ray)
    const data = await getActiveInstructions({ companyId, callId });
    
    // Return success
    res.json({
      ok: true,
      data
    });
    
    logger.info(`[ACTIVE INSTRUCTIONS API V2] Request successful`, {
      companyId,
      callId: callId || 'none',
      hasCall: !!data.call
    });
    
  } catch (error) {
    logger.error(`[ACTIVE INSTRUCTIONS API V2] Request failed`, {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    
    // Return error with appropriate status code
    const statusCode = error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({ 
      ok: false,
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
    ok: true,
    status: 'operational',
    service: 'active-instructions-v2',
    version: '2.0',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;


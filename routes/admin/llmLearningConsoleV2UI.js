/**
 * ============================================================================
 * LLM LEARNING CONSOLE V2 - UI ROUTE
 * ============================================================================
 * 
 * PURPOSE: Serve the V2 LLM Learning Console standalone HTML
 * ROUTE: GET /admin/llm-learning-v2
 * AUTH: Admin only
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

/**
 * Serve LLM Learning Console V2 UI
 * GET /admin/llm-learning-v2
 * 
 * NOTE: Serves as static file without JWT check.
 * The API endpoints (/api/admin/llm-learning/v2/*) are protected with JWT.
 * This matches how other admin pages work (admin-global-instant-responses.html, etc.)
 */
router.get('/llm-learning-v2', (req, res) => {
  try {
    logger.info('[LLM LEARNING V2 UI] Serving console interface');
    
    const filePath = path.join(__dirname, '../../public/admin-llm-learning-console-v2.html');
    
    res.sendFile(filePath, (err) => {
      if (err) {
        logger.error('[LLM LEARNING V2 UI] Error serving file:', err);
        res.status(500).send('Failed to load LLM Learning Console V2');
      }
    });
  } catch (error) {
    logger.error('[LLM LEARNING V2 UI] Unexpected error:', error);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;


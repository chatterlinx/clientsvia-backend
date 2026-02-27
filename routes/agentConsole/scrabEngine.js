/**
 * ============================================================================
 * SCRABENGINE API ROUTES
 * ============================================================================
 * 
 * CRUD operations for ScrabEngine configuration
 * 
 * Endpoints:
 * - GET    /api/agent-console/:companyId/scrabengine        - Load config
 * - POST   /api/agent-console/:companyId/scrabengine        - Save config
 * - POST   /api/agent-console/:companyId/scrabengine/test   - Test pipeline
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../../db');
const { ObjectId } = require('mongodb');
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { ScrabEngine } = require('../../services/ScrabEngine');

// 🔒 All routes require authentication
router.use(authenticateJWT);

// ════════════════════════════════════════════════════════════════════════════
// GET /api/agent-console/:companyId/scrabengine
// Load ScrabEngine configuration
// ════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/scrabengine', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    logger.info('[ScrabEngine API] Loading config', { companyId });
    
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({
      _id: new ObjectId(companyId)
    });
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Get config or return defaults
    const config = company.aiAgentSettings?.scrabEngine || {
      enabled: true,
      fillers: { enabled: true, customFillers: [], stripGreetings: true, stripCompanyName: true },
      vocabulary: { enabled: true, entries: [] },
      synonyms: { enabled: true, wordSynonyms: [], contextPatterns: [] },
      extraction: { enabled: true, customPatterns: [] },
      qualityGates: { minWordCount: 2, minConfidence: 0.5, repromptOnLowQuality: true }
    };
    
    const stats = ScrabEngine.getStats(config);
    
    res.json({
      config,
      stats,
      meta: {
        companyId: company._id.toString(),
        companyName: company.businessName || company.companyName,
        version: config.version || '1.0.0'
      }
    });
    
  } catch (error) {
    logger.error('[ScrabEngine API] Load config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/agent-console/:companyId/scrabengine
// Save ScrabEngine configuration
// ════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/scrabengine', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { config } = req.body;
    
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Invalid config object' });
    }
    
    logger.info('[ScrabEngine API] Saving config', { 
      companyId,
      enabled: config.enabled,
      fillersEnabled: config.fillers?.enabled,
      vocabEnabled: config.vocabulary?.enabled,
      synonymsEnabled: config.synonyms?.enabled
    });
    
    const db = getDB();
    
    // Update with metadata
    config.meta = {
      ...config.meta,
      lastModified: new Date(),
      uiBuild: 'scrabengine-v1'
    };
    config.version = '1.0.0';
    
    const result = await db.collection('companiesCollection').updateOne(
      { _id: new ObjectId(companyId) },
      { 
        $set: { 
          'aiAgentSettings.scrabEngine': config 
        } 
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    logger.info('[ScrabEngine API] Config saved successfully', {
      companyId,
      modified: result.modifiedCount > 0
    });
    
    res.json({ 
      success: true,
      modified: result.modifiedCount > 0,
      config
    });
    
  } catch (error) {
    logger.error('[ScrabEngine API] Save config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/agent-console/:companyId/scrabengine/test
// Test ScrabEngine pipeline with sample text
// ════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/scrabengine/test', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { text, config } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid test text' });
    }
    
    logger.info('[ScrabEngine API] Testing pipeline', {
      companyId,
      textPreview: text.substring(0, 60)
    });
    
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({
      _id: new ObjectId(companyId)
    });
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Use provided config or load from company
    const testConfig = config || company.aiAgentSettings?.scrabEngine;
    
    // Create a mock company object with test config
    const mockCompany = {
      _id: company._id,
      businessName: company.businessName,
      companyName: company.companyName,
      aiAgentSettings: {
        scrabEngine: testConfig
      }
    };
    
    // Run ScrabEngine
    const result = await ScrabEngine.process({
      rawText: text,
      company: mockCompany,
      context: {
        companyName: company.businessName || company.companyName,
        callSid: 'test',
        turn: 0
      }
    });
    
    logger.info('[ScrabEngine API] Test complete', {
      companyId,
      processingTimeMs: result.performance.totalTimeMs,
      transformations: result.transformations.length
    });
    
    res.json(result);
    
  } catch (error) {
    logger.error('[ScrabEngine API] Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

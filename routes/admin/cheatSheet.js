// routes/admin/cheatSheet.js
// ============================================================================
// CHEAT SHEET ADMIN ROUTES
// ============================================================================
// PURPOSE: Admin endpoints for managing company cheat sheets
// ROUTES: Compile policy, test rules, get stats
// ============================================================================

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const PolicyCompiler = require('../../services/PolicyCompiler');
const CheatSheetEngine = require('../../services/CheatSheetEngine');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════
// GET /api/admin/cheat-sheet/:companyId
// ═══════════════════════════════════════════════════════════════════
// Fetch company's cheat sheet configuration
// ═══════════════════════════════════════════════════════════════════

router.get('/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  
  logger.info('[CHEAT SHEET API] Fetch request', { companyId });
  
  try {
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.aiAgentSettings?.cheatSheet || {
      version: 1,
      status: 'draft',
      behaviorRules: [],
      edgeCases: [],
      transferRules: [],
      guardrails: [],
      allowedActions: []
    };
    
    logger.info('[CHEAT SHEET API] Fetch successful', {
      companyId,
      status: cheatSheet.status,
      version: cheatSheet.version
    });
    
    return res.json({
      success: true,
      cheatSheet
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Fetch failed', {
      companyId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/admin/cheat-sheet/:companyId
// ═══════════════════════════════════════════════════════════════════
// Update company's cheat sheet configuration
// ═══════════════════════════════════════════════════════════════════

router.put('/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  const { cheatSheet } = req.body;
  
  logger.info('[CHEAT SHEET API] Update request', { 
    companyId,
    updates: Object.keys(cheatSheet || {})
  });
  
  try {
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    // Initialize aiAgentSettings if it doesn't exist
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    
    // Update cheat sheet
    const updatedCheatSheet = {
      ...company.aiAgentSettings.cheatSheet,
      ...cheatSheet,
      status: 'draft', // Mark as draft when edited
      updatedAt: new Date(),
      updatedBy: req.user.email || req.user._id.toString()
    };
    
    company.aiAgentSettings.cheatSheet = updatedCheatSheet;
    await company.save();
    
    logger.info('[CHEAT SHEET API] Update successful', {
      companyId,
      version: updatedCheatSheet.version,
      status: updatedCheatSheet.status
    });
    
    return res.json({
      success: true,
      cheatSheet: updatedCheatSheet
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Update failed', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/admin/cheat-sheet/compile/:companyId
// ═══════════════════════════════════════════════════════════════════
// Compile company's cheat sheet into runtime policy
// ═══════════════════════════════════════════════════════════════════

router.post('/compile/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  
  logger.info('[CHEAT SHEET API] Compile request', { companyId });
  
  try {
    // Load company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.aiAgentSettings?.cheatSheet;
    
    if (!cheatSheet) {
      return res.status(400).json({
        success: false,
        error: 'Company does not have a cheat sheet configured'
      });
    }
    
    // Compile policy
    const result = await PolicyCompiler.compile(companyId, cheatSheet);
    
    logger.info('[CHEAT SHEET API] Compilation successful', {
      companyId,
      checksum: result.checksum,
      conflictCount: result.conflicts?.length || 0
    });
    
    return res.json({
      success: true,
      checksum: result.checksum,
      redisKey: result.redisKey,
      conflicts: result.conflicts || [],
      compiledAt: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Compilation failed', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/admin/cheat-sheet/test/:companyId
// ═══════════════════════════════════════════════════════════════════
// Test cheat sheet rules with sample input
// ═══════════════════════════════════════════════════════════════════

router.post('/test/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  const { userInput, baseResponse } = req.body;
  
  logger.info('[CHEAT SHEET API] Test request', { companyId, userInput });
  
  try {
    // Load company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.aiAgentSettings?.cheatSheet;
    
    if (!cheatSheet || !cheatSheet.checksum) {
      return res.status(400).json({
        success: false,
        error: 'Cheat sheet must be compiled before testing'
      });
    }
    
    // Load compiled policy from Redis
    const { redisClient } = require('../../clients');
    const redisKey = `policy:${companyId}:active`;
    const activePolicyKey = await redisClient.get(redisKey);
    
    if (!activePolicyKey) {
      return res.status(404).json({
        success: false,
        error: 'Compiled policy not found in Redis'
      });
    }
    
    const policyCached = await redisClient.get(activePolicyKey);
    
    if (!policyCached) {
      return res.status(404).json({
        success: false,
        error: 'Policy artifact not found'
      });
    }
    
    const policy = JSON.parse(policyCached);
    
    // Apply cheat sheet to test input
    const result = await CheatSheetEngine.apply(
      baseResponse || 'Test response',
      userInput,
      {
        companyId,
        callId: 'test-' + Date.now(),
        turnNumber: 1,
        isFirstTurn: true,
        company,
        collectedEntities: {}
      },
      policy
    );
    
    logger.info('[CHEAT SHEET API] Test successful', {
      companyId,
      appliedBlocks: result.appliedBlocks.length,
      timeMs: result.timeMs
    });
    
    return res.json({
      success: true,
      result: {
        originalResponse: baseResponse || 'Test response',
        finalResponse: result.response,
        appliedBlocks: result.appliedBlocks,
        action: result.action,
        timeMs: result.timeMs,
        shortCircuit: result.shortCircuit,
        transferTarget: result.transferTarget
      }
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Test failed', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/admin/cheat-sheet/stats/:companyId
// ═══════════════════════════════════════════════════════════════════
// Get cheat sheet statistics and usage metrics
// ═══════════════════════════════════════════════════════════════════

router.get('/stats/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  
  logger.info('[CHEAT SHEET API] Stats request', { companyId });
  
  try {
    // Load company
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.aiAgentSettings?.cheatSheet;
    
    if (!cheatSheet) {
      return res.json({
        success: true,
        stats: {
          configured: false,
          behaviorRulesCount: 0,
          edgeCasesCount: 0,
          transferRulesCount: 0,
          guardrailsCount: 0,
          allowedActionsCount: 0
        }
      });
    }
    
    // Calculate stats
    const stats = {
      configured: true,
      status: cheatSheet.status,
      version: cheatSheet.version,
      checksum: cheatSheet.checksum,
      lastCompiledAt: cheatSheet.lastCompiledAt,
      updatedAt: cheatSheet.updatedAt,
      updatedBy: cheatSheet.updatedBy,
      
      behaviorRulesCount: (cheatSheet.behaviorRules || []).length,
      edgeCasesCount: (cheatSheet.edgeCases || []).filter(ec => ec.enabled !== false).length,
      transferRulesCount: (cheatSheet.transferRules || []).filter(tr => tr.enabled !== false).length,
      guardrailsCount: (cheatSheet.guardrails || []).length,
      allowedActionsCount: (cheatSheet.allowedActions || []).length
    };
    
    return res.json({
      success: true,
      stats
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Stats failed', {
      companyId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;


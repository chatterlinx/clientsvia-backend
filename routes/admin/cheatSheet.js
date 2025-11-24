// routes/admin/cheatSheet.js
// ============================================================================
// CHEAT SHEET ADMIN ROUTES (LEGACY - V1)
// ============================================================================
// ⚠️ DEPRECATED: This route family writes to V1 (aiAgentSettings.cheatSheet)
// ⚠️ STATUS: V1 is DEAD to runtime as of Phase C migration
// ⚠️ ACTION REQUIRED: All write operations should throw errors
// ⚠️ REPLACEMENT: Use /api/cheatsheet/versions/* routes (V2)
// ============================================================================
// PURPOSE: Admin endpoints for managing company cheat sheets
// ROUTES: Compile policy, test rules, get stats
// ============================================================================

const express = require('express');
const router = express.Router();

// Phase C Migration Guard: Prevent V1 writes
const V1_WRITE_DISABLED = true; // Set to false to temporarily re-enable V1 writes
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const PolicyCompiler = require('../../services/PolicyCompiler');
const CheatSheetEngine = require('../../services/CheatSheetEngine');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const defaultFrontlineIntel = require('../../config/defaultFrontlineIntel');

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
      frontlineIntel: null,
      behaviorRules: [],
      edgeCases: [],
      transferRules: [],
      guardrails: [],
      allowedActions: []
    };
    
    // If frontlineIntel is null/empty, provide default template
    if (!cheatSheet.frontlineIntel) {
      cheatSheet.frontlineIntel = defaultFrontlineIntel;
    }
    
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
  
  logger.info('[CHEAT SHEET API] Update request (V1 DEPRECATED)', { 
    companyId,
    updates: Object.keys(cheatSheet || {})
  });
  
  // Phase C Migration Guard: Block V1 writes
  if (V1_WRITE_DISABLED) {
    logger.error('[CHEAT SHEET API] V1 write attempted - BLOCKED', {
      companyId,
      endpoint: 'PUT /:companyId'
    });
    return res.status(410).json({
      success: false,
      error: 'LEGACY_V1_WRITE_DISABLED',
      message: 'CheatSheet V1 writes are disabled. Please use /api/cheatsheet/versions/* (V2) routes.',
      migrationGuide: 'https://docs.clientsvia.com/migration/v1-to-v2'
    });
  }
  
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

// ═══════════════════════════════════════════════════════════════════
// GET /api/admin/cheat-sheet/template/:templateId
// ═══════════════════════════════════════════════════════════════════
// Get default cheat sheet from template
// ═══════════════════════════════════════════════════════════════════

router.get('/template/:templateId', authenticateJWT, async (req, res) => {
  const { templateId } = req.params;
  
  logger.info('[CHEAT SHEET API] Template defaults request', { templateId });
  
  try {
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    const defaults = template.defaultCheatSheet || {
      behaviorRules: [],
      guardrails: [],
      actionAllowlist: [],
      edgeCases: [],
      transferRules: []
    };
    
    logger.info('[CHEAT SHEET API] Template defaults loaded', {
      templateId,
      templateName: template.name,
      behaviorRulesCount: defaults.behaviorRules.length,
      edgeCasesCount: defaults.edgeCases.length
    });
    
    return res.json({
      success: true,
      template: {
        id: template._id,
        name: template.name,
        industryLabel: template.industryLabel
      },
      defaultCheatSheet: defaults
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Template defaults failed', {
      templateId,
      error: error.message
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/admin/cheat-sheet/import/:companyId
// ═══════════════════════════════════════════════════════════════════
// Import cheat sheet from template or another company
// ═══════════════════════════════════════════════════════════════════

router.post('/import/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  const { templateId, sourceCompanyId, cheatSheetData } = req.body;
  
  logger.info('[CHEAT SHEET API] Import request', {
    companyId,
    templateId,
    sourceCompanyId,
    hasDirectData: !!cheatSheetData
  });
  
  try {
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Target company not found'
      });
    }
    
    let importedCheatSheet;
    
    // Import from template
    if (templateId) {
      const template = await GlobalInstantResponseTemplate.findById(templateId);
      
      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }
      
      importedCheatSheet = template.defaultCheatSheet || {};
      logger.info('[CHEAT SHEET API] Importing from template', {
        templateId,
        templateName: template.name
      });
    }
    // Import from another company
    else if (sourceCompanyId) {
      const sourceCompany = await Company.findById(sourceCompanyId);
      
      if (!sourceCompany) {
        return res.status(404).json({
          success: false,
          error: 'Source company not found'
        });
      }
      
      importedCheatSheet = sourceCompany.aiAgentSettings?.cheatSheet || {};
      logger.info('[CHEAT SHEET API] Importing from company', {
        sourceCompanyId,
        sourceCompanyName: sourceCompany.name
      });
    }
    // Import from direct JSON data
    else if (cheatSheetData) {
      importedCheatSheet = cheatSheetData;
      logger.info('[CHEAT SHEET API] Importing from direct data');
    }
    else {
      return res.status(400).json({
        success: false,
        error: 'Must provide templateId, sourceCompanyId, or cheatSheetData'
      });
    }
    
    // Initialize aiAgentSettings if needed
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    
    // Merge imported data with version/metadata
    const mergedCheatSheet = {
      version: 1,
      status: 'draft',
      behaviorRules: importedCheatSheet.behaviorRules || [],
      edgeCases: importedCheatSheet.edgeCases || [],
      transferRules: importedCheatSheet.transferRules || [],
      guardrails: importedCheatSheet.guardrails || [],
      actionAllowlist: importedCheatSheet.actionAllowlist || [],
      updatedAt: new Date(),
      updatedBy: req.user.email || req.user._id.toString(),
      importedFrom: templateId ? `template:${templateId}` : (sourceCompanyId ? `company:${sourceCompanyId}` : 'json')
    };
    
    company.aiAgentSettings.cheatSheet = mergedCheatSheet;
    await company.save();
    
    logger.info('[CHEAT SHEET API] Import successful', {
      companyId,
      source: mergedCheatSheet.importedFrom
    });
    
    return res.json({
      success: true,
      cheatSheet: mergedCheatSheet,
      message: 'Cheat sheet imported successfully. Review and customize for this company.'
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Import failed', {
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
// POST /api/admin/cheat-sheet/export-json/:companyId
// ═══════════════════════════════════════════════════════════════════
// Export company's cheat sheet as JSON (for copying to other companies)
// ═══════════════════════════════════════════════════════════════════

router.post('/export-json/:companyId', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  const { stripMetadata } = req.body;
  
  logger.info('[CHEAT SHEET API] Export JSON request', { companyId, stripMetadata });
  
  try {
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.aiAgentSettings?.cheatSheet;
    
    if (!cheatSheet) {
      return res.status(404).json({
        success: false,
        error: 'Company does not have a cheat sheet configured'
      });
    }
    
    // Create exportable copy
    let exportData = {
      behaviorRules: cheatSheet.behaviorRules || [],
      guardrails: cheatSheet.guardrails || [],
      actionAllowlist: cheatSheet.actionAllowlist || [],
      edgeCases: (cheatSheet.edgeCases || []).map(ec => ({
        name: ec.name,
        triggerPatterns: ec.triggerPatterns,
        responseText: ec.responseText,
        action: ec.action,
        priority: ec.priority,
        enabled: ec.enabled
      })),
      transferRules: (cheatSheet.transferRules || []).map(tr => ({
        name: tr.name,
        intentTag: tr.intentTag,
        contactNameOrQueue: tr.contactNameOrQueue,
        phoneNumber: tr.phoneNumber,
        script: tr.script,
        collectEntities: tr.collectEntities || [],
        afterHoursOnly: tr.afterHoursOnly,
        priority: tr.priority,
        enabled: tr.enabled
      }))
    };
    
    if (!stripMetadata) {
      exportData.exportedFrom = {
        companyId: company._id.toString(),
        companyName: company.name,
        exportedAt: new Date().toISOString(),
        exportedBy: req.user.email || req.user._id.toString()
      };
    }
    
    logger.info('[CHEAT SHEET API] Export successful', {
      companyId,
      companyName: company.name
    });
    
    return res.json({
      success: true,
      cheatSheet: exportData,
      filename: `cheatsheet-${company.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Export failed', {
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
// POST /api/admin/cheat-sheet/:companyId/reset-instructions
// ═══════════════════════════════════════════════════════════════════
// Reset Company Instructions to default template
// ═══════════════════════════════════════════════════════════════════

router.post('/:companyId/reset-instructions', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;
  
  logger.info('[CHEAT SHEET API] Reset instructions request', { companyId });
  
  try {
    const company = await Company.findById(companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    // Initialize aiAgentSettings if needed
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    if (!company.aiAgentSettings.cheatSheet) {
      company.aiAgentSettings.cheatSheet = {
        version: 1,
        status: 'draft',
        behaviorRules: [],
        edgeCases: [],
        transferRules: [],
        guardrails: [],
        allowedActions: []
      };
    }
    
    // Reset Frontline-Intel to default template
    company.aiAgentSettings.cheatSheet.frontlineIntel = defaultFrontlineIntel;
    company.aiAgentSettings.cheatSheet.status = 'draft'; // Mark as draft after reset
    company.aiAgentSettings.cheatSheet.updatedAt = new Date();
    company.aiAgentSettings.cheatSheet.updatedBy = req.user.email || req.user._id.toString();
    
    await company.save();
    
    logger.info('[CHEAT SHEET API] Frontline-Intel reset successful', {
      companyId,
      resetBy: req.user.email || req.user._id.toString()
    });
    
    return res.json({
      success: true,
      message: 'Frontline-Intel reset to default template',
      frontlineIntel: defaultFrontlineIntel
    });
    
  } catch (error) {
    logger.error('[CHEAT SHEET API] Reset instructions failed', {
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
// POST /api/admin/cheat-sheet/:companyId/reset-frontline-intel
// ═══════════════════════════════════════════════════════════════════
// Alias for reset-instructions (for consistency)
// ═══════════════════════════════════════════════════════════════════
router.post('/:companyId/reset-frontline-intel', authenticateJWT, async (req, res) => {
  // Just proxy to the existing reset-instructions endpoint
  req.url = `/${req.params.companyId}/reset-instructions`;
  return router.handle(req, res);
});

module.exports = router;


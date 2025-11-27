/**
 * ============================================================================
 * ACTIVE INSTRUCTIONS PREVIEW API
 * ============================================================================
 * 
 * REST API for viewing the LIVE AI agent configuration that's actually
 * running in production calls right now.
 * 
 * BASE PATH: /api/aicore/active-instructions
 * 
 * ROUTES:
 * - GET /:companyId - Get live runtime config (what agent is using NOW)
 * 
 * PURPOSE:
 * - Show exactly what the runtime agent is loading (not draft, not old)
 * - Display version ID, timestamp, and full config structure
 * - Read-only view for observability before/during production
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { CheatSheetRuntimeService } = require('../../services/cheatsheet');
const { authenticateJWT: authMiddleware } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /api/aicore/active-instructions/:companyId
 * Get live runtime config (what agent is using NOW)
 * 
 * Returns:
 * - versionId: Live version ID
 * - versionName: Live version name
 * - activatedAt: When this version went live
 * - config: Full config object (edgeCases, transferRules, behavior, etc.)
 * - metadata: Additional version metadata
 */
router.get('/:companyId', authMiddleware, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    logger.info('[ACTIVE INSTRUCTIONS] Fetching live config', {
      companyId,
      user: req.user?.email || 'Unknown'
    });
    
    // ────────────────────────────────────────────────────────────────
    // CRITICAL: Use the SAME service the runtime agent uses
    // ────────────────────────────────────────────────────────────────
    // This ensures we see exactly what live calls are using.
    // CheatSheetRuntimeService.getRuntimeConfig() returns:
    // { versionId, name, config, ...metadata }
    
    const liveConfig = await CheatSheetRuntimeService.getRuntimeConfig(companyId);
    
    if (!liveConfig) {
      logger.warn('[ACTIVE INSTRUCTIONS] No live config found', {
        companyId
      });
      
      return res.status(404).json({
        success: false,
        error: 'NO_LIVE_CONFIG',
        message: 'No live configuration found for this company. Please create and publish a CheatSheet version first.',
        data: null
      });
    }
    
    // ────────────────────────────────────────────────────────────────
    // STRUCTURE RESPONSE FOR UI DISPLAY
    // ────────────────────────────────────────────────────────────────
    // Break down config into sections for better UI rendering
    
    const config = liveConfig.config || {};
    
    const response = {
      success: true,
      data: {
        // Version metadata
        version: {
          versionId: liveConfig.versionId,
          name: liveConfig.name || 'Untitled Version',
          status: 'live',
          activatedAt: liveConfig.activatedAt || null,
          activatedBy: liveConfig.activatedBy || null,
          schemaVersion: config.schemaVersion || 1
        },
        
        // Config sections (structured for UI display)
        sections: {
          // Edge Cases (Tier-1 overrides)
          edgeCases: {
            count: (config.edgeCases || []).length,
            enabled: (config.edgeCases || []).filter(ec => ec.enabled !== false).length,
            items: config.edgeCases || []
          },
          
          // Transfer Rules
          transferRules: {
            raw: config.transferRules || {},
            isEmpty: !config.transferRules || Object.keys(config.transferRules).length === 0
          },
          
          // Frontline Intel (Triage)
          frontlineIntel: {
            raw: config.frontlineIntel || {},
            isEmpty: !config.frontlineIntel || Object.keys(config.frontlineIntel).length === 0
          },
          
          // Behavior Rules
          behavior: {
            raw: config.behavior || {},
            isEmpty: !config.behavior || Object.keys(config.behavior).length === 0
          },
          
          // Guardrails
          guardrails: {
            raw: config.guardrails || {},
            isEmpty: !config.guardrails || Object.keys(config.guardrails).length === 0
          },
          
          // Booking Rules
          bookingRules: {
            count: (config.bookingRules || []).length,
            items: config.bookingRules || []
          },
          
          // Company Contacts
          companyContacts: {
            count: (config.companyContacts || []).length,
            items: config.companyContacts || []
          },
          
          // Links
          links: {
            count: (config.links || []).length,
            items: config.links || []
          },
          
          // Calculators
          calculators: {
            count: (config.calculators || []).length,
            items: config.calculators || []
          }
        },
        
        // Full raw config (for advanced users / debugging)
        rawConfig: config,
        
        // Timestamp
        retrievedAt: new Date().toISOString()
      }
    };
    
    logger.info('[ACTIVE INSTRUCTIONS] Live config retrieved successfully', {
      companyId,
      versionId: liveConfig.versionId,
      edgeCasesCount: (config.edgeCases || []).length,
      user: req.user?.email || 'Unknown'
    });
    
    res.json(response);
    
  } catch (err) {
    logger.error('[ACTIVE INSTRUCTIONS] Error fetching live config', {
      companyId: req.params.companyId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: err.message,
      data: null
    });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;


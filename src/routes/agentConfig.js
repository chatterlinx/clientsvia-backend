/**
 * Phase 8: Agent Config Publishing Routes
 * API endpoints for managing compiled agent configuration snapshots
 * Provides publish, retrieve, and health check functionality
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AgentConfigSnapshot = require('../models/AgentConfigSnapshot');
const Company = require('../../models/Company');
const { buildCompiledConfig, validateCompiledConfig } = require('../services/aiConfigAssembler');
const { PUBLISH_V1 } = require('../../config/flags');
const logger = require('../../utils/logger');

/**
 * GET /api/company/:id/agent-config/latest
 * Retrieve the latest published agent config snapshot for a company
 */
router.get('/company/:id/agent-config/latest', async (req, res) => {
  try {
    if (!PUBLISH_V1) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Publish pipeline disabled (PUBLISH_V1=off)' 
      });
    }

    const { id } = req.params;
    
    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid company ID format' 
      });
    }

    const snap = await AgentConfigSnapshot.getLatest(new mongoose.Types.ObjectId(id));
    
    if (!snap) {
      return res.json({ 
        ok: true, 
        snapshot: null,
        message: 'No published config snapshot found'
      });
    }

    res.json({ 
      ok: true, 
      snapshot: { 
        version: snap.version, 
        createdAt: snap.createdAt, 
        data: snap.data 
      } 
    });

  } catch (e) {
    logger.error('[PUBLISH] Error retrieving latest config:', e);
    res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
});

/**
 * POST /api/company/:id/agent-config/publish
 * Compile and publish a new agent config snapshot
 */
router.post('/company/:id/agent-config/publish', async (req, res) => {
  try {
    if (!PUBLISH_V1) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Publish pipeline disabled (PUBLISH_V1=off)' 
      });
    }

    const { id } = req.params;
    
    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid company ID format' 
      });
    }

    // Fetch company document
    const company = await Company.findById(id).lean();
    if (!company) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Company not found' 
      });
    }

    // Build compiled configuration
    const compiled = buildCompiledConfig(company);
    
    // Validate the compiled configuration
    const errors = validateCompiledConfig(compiled);
    if (errors && errors.length > 0) {
      return res.status(422).json({ 
        ok: false, 
        error: 'Configuration validation failed', 
        details: errors, 
        compiled 
      });
    }

    // Create snapshot with auto-versioning
    const snapshot = await AgentConfigSnapshot.createSnapshot(company._id, compiled);

    logger.info(`[PUBLISH] Published config v${snapshot.version} for company ${company.name} (${id})`);

    res.json({ 
      ok: true, 
      version: snapshot.version, 
      compiled,
      createdAt: snapshot.createdAt,
      message: 'Agent configuration published successfully'
    });

  } catch (e) {
    logger.error('[PUBLISH] Error publishing config:', e);
    res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
});

/**
 * GET /api/company/:id/agent-config/health
 * Quick health check for UI status display
 */
router.get('/company/:id/agent-config/health', async (req, res) => {
  try {
    if (!PUBLISH_V1) {
      return res.status(200).json({ 
        ok: true, 
        enabled: false, 
        status: 'DISABLED',
        message: 'Publish pipeline disabled (PUBLISH_V1=off)'
      });
    }

    const { id } = req.params;
    
    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid company ID format' 
      });
    }

    const snap = await AgentConfigSnapshot.getLatest(new mongoose.Types.ObjectId(id));
    
    if (!snap) {
      return res.json({ 
        ok: true, 
        enabled: true, 
        status: 'MISSING', 
        lastPublished: null,
        message: 'No published configuration found - click Publish to create one'
      });
    }

    // Validate the existing snapshot
    const errors = validateCompiledConfig(snap.data);
    const isValid = !errors || errors.length === 0;

    res.json({
      ok: true, 
      enabled: true,
      status: isValid ? 'OK' : 'INVALID',
      lastPublished: snap.createdAt,
      version: snap.version,
      errors: errors || [],
      message: isValid ? 
        `Configuration healthy (v${snap.version})` :
        `Configuration has validation errors`
    });

  } catch (e) {
    logger.error('[PUBLISH] Error checking config health:', e);
    res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
});

/**
 * GET /api/company/:id/agent-config/preview
 * Preview what the compiled config would look like without publishing
 */
router.get('/company/:id/agent-config/preview', async (req, res) => {
  try {
    if (!PUBLISH_V1) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Publish pipeline disabled (PUBLISH_V1=off)' 
      });
    }

    const { id } = req.params;
    
    // Validate company ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid company ID format' 
      });
    }

    // Fetch company document
    const company = await Company.findById(id).lean();
    if (!company) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Company not found' 
      });
    }

    // Build compiled configuration (preview only)
    const compiled = buildCompiledConfig(company);
    
    // Validate the compiled configuration
    const errors = validateCompiledConfig(compiled);

    res.json({ 
      ok: true, 
      preview: compiled,
      valid: !errors || errors.length === 0,
      errors: errors || [],
      message: 'Configuration preview generated'
    });

  } catch (e) {
    logger.error('[PUBLISH] Error generating config preview:', e);
    res.status(500).json({ 
      ok: false, 
      error: e.message 
    });
  }
});

module.exports = router;

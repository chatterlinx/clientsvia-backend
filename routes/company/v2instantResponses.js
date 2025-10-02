/**
 * INSTANT RESPONSES API ROUTES
 * 
 * Purpose: CRUD operations and management for instant responses
 * - Create, read, update, delete instant responses
 * - Bulk operations (import, export, copy)
 * - Template library access
 * - Variation suggestions
 * - Coverage analysis
 * 
 * Authentication: All routes require company admin authentication
 * 
 * Base Path: /api/v2/company/:companyId/instant-responses
 * 
 * Last Updated: 2025-10-02
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const v2Company = require('../../models/v2Company');
const InstantResponseTemplate = require('../../models/InstantResponseTemplate');
const instantResponseMatcher = require('../../services/v2InstantResponseMatcher');
const variationSuggestionEngine = require('../../services/variationSuggestionEngine');
const Joi = require('joi');
const { authenticateJWT } = require('../../middleware/auth');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate company exists and user has access
 */
async function validateCompanyAccess(req, res, next) {
  try {
    const company = await v2Company.findById(req.params.companyId);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }

    // TODO: Add proper authorization check based on user role
    // For now, assume authenticated users have access
    
    req.company = company;
    next();
  } catch (error) {
    console.error('[InstantResponses] Company validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate company access'
    });
  }
}

/**
 * Validate instant response data using Joi
 */
const instantResponseSchema = Joi.object({
  trigger: Joi.string().trim().min(3).max(200).required(),
  response: Joi.string().trim().min(5).max(500).required(),
  category: Joi.string().valid(
    // Conversational AI Personality Categories (Priority 0)
    'acknowledgment', 'waiting', 'consultation', 'appreciation', 'smalltalk',
    // Business Information Categories
    'hours', 'location', 'pricing', 'services', 'contact', 'booking', 'emergency',
    // Other
    'other'
  ).optional(),
  priority: Joi.number().integer().min(0).max(100).optional(),
  enabled: Joi.boolean().optional(),
  notes: Joi.string().trim().allow('').optional()
});

function validateInstantResponse(req, res, next) {
  const { error } = instantResponseSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }
  next();
}

// ============================================================================
// INSTANT RESPONSE CRUD
// ============================================================================

/**
 * GET /:companyId/instant-responses
 * Get all instant responses for a company
 */
router.get('/:companyId/instant-responses', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const instantResponses = company.instantResponses || [];

    // Optional filtering
    const { category, enabled } = req.query;
    let filtered = instantResponses;

    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    if (enabled !== undefined) {
      const isEnabled = enabled === 'true';
      filtered = filtered.filter(r => r.enabled === isEnabled);
    }

    res.json({
      success: true,
      data: {
        instantResponses: filtered,
        total: filtered.length,
        categories: [...new Set(instantResponses.map(r => r.category))]
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve instant responses'
    });
  }
});

/**
 * POST /:companyId/instant-responses
 * Create a new instant response
 */
router.post('/:companyId/instant-responses', authenticateJWT, validateCompanyAccess, validateInstantResponse, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { trigger, response, category, priority, enabled, notes } = req.body;

    // Check for duplicate trigger in separate collection
    const existingTrigger = await InstantResponse.findOne({
      companyId,
      trigger: { $regex: new RegExp(`^${trigger}$`, 'i') }
    });

    if (existingTrigger) {
      return res.status(409).json({
        success: false,
        error: 'A response with this trigger already exists'
      });
    }

    // Auto-generate keywords from trigger and response
    const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
    const keywordService = new KeywordGenerationService();
    const keywords = await keywordService.generateAdvancedKeywords(trigger, response, { companyId });

    // Create new instant response in separate collection
    const newResponse = new InstantResponse({
      companyId,
      trigger,
      response,
      category: category || 'other',
      priority: priority !== undefined ? priority : 50,
      enabled: enabled !== undefined ? enabled : true,
      notes: notes || '',
      keywords: keywords.primary || [],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const saved = await newResponse.save();

    res.status(201).json({
      success: true,
      data: {
        instantResponse: saved,
        message: 'Instant response created successfully with auto-generated keywords'
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Create error:', error);
    console.error('[InstantResponses] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to create instant response'
    });
  }
});

/**
 * PUT /:companyId/instant-responses/:responseId
 * Update an instant response
 */
router.put('/:companyId/instant-responses/:responseId', authenticateJWT, validateCompanyAccess, validateInstantResponse, async (req, res) => {
  try {
    const { companyId, responseId } = req.params;
    const { trigger, response, category, priority, enabled, notes } = req.body;

    // Find the response to update in separate collection
    const existingResponse = await InstantResponse.findOne({ _id: responseId, companyId });

    if (!existingResponse) {
      return res.status(404).json({
        success: false,
        error: 'Instant response not found'
      });
    }

    // Check for duplicate trigger (excluding current response)
    const duplicateTrigger = await InstantResponse.findOne({
      companyId,
      _id: { $ne: responseId },
      trigger: { $regex: new RegExp(`^${trigger}$`, 'i') }
    });

    if (duplicateTrigger) {
      return res.status(409).json({
        success: false,
        error: 'Another response with this trigger already exists'
      });
    }

    // Auto-generate keywords if trigger or response changed
    let keywords = existingResponse.keywords || [];
    if (trigger !== existingResponse.trigger || response !== existingResponse.response) {
      const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
      const keywordService = new KeywordGenerationService();
      const generated = await keywordService.generateAdvancedKeywords(trigger, response, { companyId });
      keywords = generated.primary || [];
    }

    // Update the response
    existingResponse.trigger = trigger;
    existingResponse.response = response;
    existingResponse.category = category || existingResponse.category;
    existingResponse.priority = priority !== undefined ? priority : existingResponse.priority;
    existingResponse.enabled = enabled !== undefined ? enabled : existingResponse.enabled;
    existingResponse.notes = notes !== undefined ? notes : existingResponse.notes;
    existingResponse.keywords = keywords;
    existingResponse.updatedAt = new Date();

    const saved = await existingResponse.save();

    res.json({
      success: true,
      data: {
        instantResponse: saved,
        message: 'Instant response updated successfully with refreshed keywords'
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Update error:', error);
    console.error('[InstantResponses] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to update instant response'
    });
  }
});

/**
 * DELETE /:companyId/instant-responses/:responseId
 * Delete an instant response
 */
router.delete('/:companyId/instant-responses/:responseId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const { responseId } = req.params;

    const initialLength = company.instantResponses.length;
    company.instantResponses = company.instantResponses.filter(
      r => r._id.toString() !== responseId
    );

    if (company.instantResponses.length === initialLength) {
      return res.status(404).json({
        success: false,
        error: 'Instant response not found'
      });
    }

    await company.save();

    res.json({
      success: true,
      data: {
        message: 'Instant response deleted successfully'
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete instant response'
    });
  }
});

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * POST /api/v2/company/:companyId/instant-responses/bulk
 * Bulk create instant responses
 */
router.post('/:companyId/instant-responses/bulk', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const { instantResponses } = req.body;

    if (!Array.isArray(instantResponses) || instantResponses.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'instantResponses must be a non-empty array'
      });
    }

    const results = {
      created: [],
      skipped: [],
      errors: []
    };

    for (const response of instantResponses) {
      try {
        // Check for duplicate trigger
        const existingTrigger = company.instantResponses.find(
          r => r.trigger.toLowerCase() === response.trigger.toLowerCase()
        );

        if (existingTrigger) {
          results.skipped.push({
            trigger: response.trigger,
            reason: 'Duplicate trigger'
          });
          continue;
        }

        // Create new response
        const newResponse = {
          trigger: response.trigger,
          response: response.response,
          category: response.category || 'other',
          priority: response.priority !== undefined ? response.priority : 50,
          enabled: response.enabled !== undefined ? response.enabled : true,
          notes: response.notes || '',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        company.instantResponses.push(newResponse);
        results.created.push(response.trigger);
      } catch (error) {
        results.errors.push({
          trigger: response.trigger,
          error: error.message
        });
      }
    }

    await company.save();

    res.status(201).json({
      success: true,
      data: {
        summary: {
          total: instantResponses.length,
          created: results.created.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        details: results
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Bulk create error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk create instant responses'
    });
  }
});

/**
 * GET /api/v2/company/:companyId/instant-responses/export
 * Export instant responses
 */
router.get('/:companyId/instant-responses/export', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const instantResponses = company.instantResponses || [];

    const exportData = {
      companyId: company._id,
      companyName: company.name,
      exportedAt: new Date(),
      count: instantResponses.length,
      instantResponses: instantResponses.map(r => ({
        trigger: r.trigger,
        response: r.response,
        category: r.category,
        priority: r.priority,
        enabled: r.enabled,
        notes: r.notes
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="instant-responses-${company._id}-${Date.now()}.json"`
    );
    res.json(exportData);
  } catch (error) {
    console.error('[InstantResponses] Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export instant responses'
    });
  }
});

/**
 * POST /api/v2/company/:companyId/instant-responses/import
 * Import instant responses from JSON
 */
router.post('/:companyId/instant-responses/import', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const { instantResponses, mode } = req.body; // mode: 'append' or 'replace'

    if (!Array.isArray(instantResponses)) {
      return res.status(400).json({
        success: false,
        error: 'instantResponses must be an array'
      });
    }

    if (mode === 'replace') {
      company.instantResponses = [];
    }

    const results = {
      imported: [],
      skipped: [],
      errors: []
    };

    for (const response of instantResponses) {
      try {
        // Check for duplicate trigger
        const existingTrigger = company.instantResponses.find(
          r => r.trigger.toLowerCase() === response.trigger.toLowerCase()
        );

        if (existingTrigger) {
          results.skipped.push({
            trigger: response.trigger,
            reason: 'Duplicate trigger'
          });
          continue;
        }

        company.instantResponses.push({
          trigger: response.trigger,
          response: response.response,
          category: response.category || 'other',
          priority: response.priority !== undefined ? response.priority : 50,
          enabled: response.enabled !== undefined ? response.enabled : true,
          notes: response.notes || '',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        results.imported.push(response.trigger);
      } catch (error) {
        results.errors.push({
          trigger: response.trigger,
          error: error.message
        });
      }
    }

    await company.save();

    res.json({
      success: true,
      data: {
        summary: {
          total: instantResponses.length,
          imported: results.imported.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        details: results
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Import error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to import instant responses'
    });
  }
});

/**
 * POST /api/v2/company/:companyId/instant-responses/copy-from/:sourceCompanyId
 * Copy instant responses from another company
 */
router.post('/:companyId/instant-responses/copy-from/:sourceCompanyId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const targetCompany = req.company;
    const { sourceCompanyId } = req.params;
    const { mode } = req.body; // mode: 'append' or 'replace'

    // Get source company
    const sourceCompany = await v2Company.findById(sourceCompanyId);
    if (!sourceCompany) {
      return res.status(404).json({
        success: false,
        error: 'Source company not found'
      });
    }

    // TODO: Add authorization check - can user access source company?

    const sourceResponses = sourceCompany.instantResponses || [];

    if (mode === 'replace') {
      targetCompany.instantResponses = [];
    }

    const results = {
      copied: [],
      skipped: [],
      errors: []
    };

    for (const response of sourceResponses) {
      try {
        // Check for duplicate trigger
        const existingTrigger = targetCompany.instantResponses.find(
          r => r.trigger.toLowerCase() === response.trigger.toLowerCase()
        );

        if (existingTrigger) {
          results.skipped.push({
            trigger: response.trigger,
            reason: 'Duplicate trigger'
          });
          continue;
        }

        targetCompany.instantResponses.push({
          trigger: response.trigger,
          response: response.response,
          category: response.category,
          priority: response.priority,
          enabled: response.enabled,
          notes: response.notes ? `${response.notes} (Copied from ${sourceCompany.name})` : `Copied from ${sourceCompany.name}`,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        results.copied.push(response.trigger);
      } catch (error) {
        results.errors.push({
          trigger: response.trigger,
          error: error.message
        });
      }
    }

    await targetCompany.save();

    res.json({
      success: true,
      data: {
        summary: {
          total: sourceResponses.length,
          copied: results.copied.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        details: results,
        sourceCompany: {
          id: sourceCompany._id,
          name: sourceCompany.name
        }
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Copy error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to copy instant responses'
    });
  }
});

// ============================================================================
// TEMPLATE LIBRARY
// ============================================================================

/**
 * GET /api/v2/company/:companyId/instant-responses/templates
 * Get available templates
 */
router.get('/:companyId/instant-responses/templates', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { category, tags, search } = req.query;

    let templates;

    if (search) {
      templates = await InstantResponseTemplate.search(search, true);
    } else if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      templates = await InstantResponseTemplate.findByTags(tagArray, true);
    } else if (category) {
      templates = await InstantResponseTemplate.findByCategory(category, true);
    } else {
      templates = await InstantResponseTemplate.find({ isPublic: true })
        .sort({ usageCount: -1, name: 1 });
    }

    res.json({
      success: true,
      data: {
        templates,
        total: templates.length
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Get templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve templates'
    });
  }
});

/**
 * POST /api/v2/company/:companyId/instant-responses/apply-template/:templateId
 * Apply a template to company
 */
router.post('/:companyId/instant-responses/apply-template/:templateId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const { templateId } = req.params;
    const { mode } = req.body; // mode: 'append' or 'replace'

    const template = await InstantResponseTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }

    if (mode === 'replace') {
      company.instantResponses = [];
    }

    const formattedResponses = template.getFormattedResponses();
    
    const results = {
      applied: [],
      skipped: [],
      errors: []
    };

    for (const response of formattedResponses) {
      try {
        // Check for duplicate trigger
        const existingTrigger = company.instantResponses.find(
          r => r.trigger.toLowerCase() === response.trigger.toLowerCase()
        );

        if (existingTrigger) {
          results.skipped.push({
            trigger: response.trigger,
            reason: 'Duplicate trigger'
          });
          continue;
        }

        company.instantResponses.push({
          ...response,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        results.applied.push(response.trigger);
      } catch (error) {
        results.errors.push({
          trigger: response.trigger,
          error: error.message
        });
      }
    }

    await company.save();
    await template.recordUsage();

    res.json({
      success: true,
      data: {
        summary: {
          total: formattedResponses.length,
          applied: results.applied.length,
          skipped: results.skipped.length,
          errors: results.errors.length
        },
        details: results,
        template: {
          id: template._id,
          name: template.name
        }
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Apply template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply template'
    });
  }
});

// ============================================================================
// VARIATION SUGGESTIONS
// ============================================================================

/**
 * POST /api/v2/company/:companyId/instant-responses/suggest-variations
 * Get variation suggestions for a trigger
 */
router.post('/:companyId/instant-responses/suggest-variations', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { trigger } = req.body;

    if (!trigger) {
      return res.status(400).json({
        success: false,
        error: 'Trigger is required'
      });
    }

    // 🔧 FIX: Load existing instant responses from collection, not company document
    const existingResponses = await InstantResponse.find({ companyId }).select('trigger').lean();
    const existingTriggers = existingResponses.map(r => r.trigger);
    
    const suggestions = variationSuggestionEngine.suggestVariations(trigger, existingTriggers);

    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('[InstantResponses] Suggest variations error:', error);
    console.error('[InstantResponses] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions'
    });
  }
});

/**
 * GET /api/v2/company/:companyId/instant-responses/analyze-coverage
 * Analyze instant response coverage
 */
router.get('/:companyId/instant-responses/analyze-coverage', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    // 🔧 FIX: Load instant responses from collection, not company document
    const instantResponses = await InstantResponse.find({ companyId }).lean();

    const analysis = variationSuggestionEngine.analyzeCoverage(instantResponses);

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('[InstantResponses] Analyze coverage error:', error);
    console.error('[InstantResponses] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze coverage'
    });
  }
});

// ============================================================================
// TESTING & DEBUGGING
// ============================================================================

/**
 * POST /api/v2/company/:companyId/instant-responses/test-match
 * Test matching a query against instant responses
 */
router.post('/:companyId/instant-responses/test-match', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    const instantResponses = company.instantResponses || [];
    const match = instantResponseMatcher.match(query, instantResponses);

    res.json({
      success: true,
      data: {
        query,
        match: match || null,
        hasMatch: match !== null,
        instantResponsesCount: instantResponses.length
      }
    });
  } catch (error) {
    console.error('[InstantResponses] Test match error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test match'
    });
  }
});

/**
 * GET /:companyId/instant-responses/stats
 * Get instant response statistics
 */
router.get('/:companyId/instant-responses/stats', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const company = req.company;
    const instantResponses = company.instantResponses || [];

    const stats = {
      total: instantResponses.length,
      enabled: instantResponses.filter(r => r.enabled).length,
      disabled: instantResponses.filter(r => r.enabled === false).length,
      byCategory: {},
      averagePriority: 0
    };

    // Category breakdown
    for (const response of instantResponses) {
      const category = response.category || 'other';
      if (!stats.byCategory[category]) {
        stats.byCategory[category] = { total: 0, enabled: 0 };
      }
      stats.byCategory[category].total++;
      if (response.enabled) {
        stats.byCategory[category].enabled++;
      }
    }

    // Average priority
    if (instantResponses.length > 0) {
      const totalPriority = instantResponses.reduce((sum, r) => sum + (r.priority || 50), 0);
      stats.averagePriority = Math.round(totalPriority / instantResponses.length);
    }

    // Matcher stats
    stats.matcher = instantResponseMatcher.getStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[InstantResponses] Get stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve statistics'
    });
  }
});

module.exports = router;
